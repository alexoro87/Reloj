"use server";

import { z } from "zod";
import { getSession } from "@/lib/auth";
import { BookingError, createBooking, rescheduleAppointment } from "@/lib/booking";
import { getRepo } from "@/lib/db";
import { normalizePhone } from "@/lib/phone";
import { SlotTakenError } from "@/lib/types";

export type ActionResult =
  | { ok: true; token: string; appointmentId: string }
  | { ok: false; error: string; slotTaken?: boolean; fieldErrors?: Record<string, string> };

const bookSchema = z.object({
  slug: z.string().min(1),
  practitionerId: z.string().min(1),
  serviceId: z.string().min(1),
  start: z.iso.datetime(),
  name: z.string().trim().min(3, "Escribe tu nombre y apellido").max(80),
  phone: z.string().trim().min(8, "Escribe un teléfono válido"),
  email: z.union([z.literal(""), z.email("Correo no válido")]).optional(),
  whatsappOptIn: z.boolean(),
  notes: z.string().max(500).optional(),
  reception: z.boolean().optional(),
});

export async function bookAppointmentAction(input: z.input<typeof bookSchema>): Promise<ActionResult> {
  const parsed = bookSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0])] ??= issue.message;
    return { ok: false, error: "Revisa los datos marcados.", fieldErrors };
  }
  const data = parsed.data;
  const clinic = await getRepo().getClinicBySlug(data.slug);
  if (!clinic) return { ok: false, error: "Clínica no encontrada." };

  if (data.reception) {
    const session = await getSession();
    if (!session || session.clinic.id !== clinic.id) return { ok: false, error: "Sesión no válida." };
  }

  const phone = normalizePhone(data.phone, clinic.countryCode);
  if (!phone) {
    return {
      ok: false,
      error: "Revisa los datos marcados.",
      fieldErrors: { phone: "Escribe un número a 10 dígitos o con lada internacional (+…)" },
    };
  }

  return run(async () => {
    const appt = await createBooking({
      clinic,
      practitionerId: data.practitionerId,
      serviceId: data.serviceId,
      start: data.start,
      patient: {
        name: data.name,
        phone,
        email: data.email || null,
        whatsappOptIn: data.whatsappOptIn,
      },
      source: data.reception ? "reception" : "online",
      notes: data.notes || null,
    });
    return { ok: true, token: appt.manageToken, appointmentId: appt.id };
  });
}

const rescheduleSchema = z.object({
  token: z.string().min(10),
  practitionerId: z.string().min(1),
  start: z.iso.datetime(),
});

export async function rescheduleAction(
  input: z.input<typeof rescheduleSchema>,
): Promise<ActionResult> {
  const parsed = rescheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Datos no válidos." };
  const appt = await getRepo().getAppointmentByToken(parsed.data.token);
  if (!appt) return { ok: false, error: "No encontramos esa cita." };
  return run(async () => {
    const updated = await rescheduleAppointment(appt, parsed.data);
    return { ok: true, token: updated.manageToken, appointmentId: updated.id };
  });
}

async function run(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof SlotTakenError || e instanceof BookingError) {
      return { ok: false, error: e.message, slotTaken: true };
    }
    console.error(e);
    return { ok: false, error: "Algo salió mal. Inténtalo de nuevo en un momento." };
  }
}
