"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { endSession, requireSession, startSession } from "@/lib/auth";
import {
  BookingError,
  cancelAppointment,
  completeAppointment,
  confirmAppointment,
  markNoShow,
  runFollowUps,
  runReminders,
  sendFollowUp,
  sendReminder,
} from "@/lib/booking";
import { getRepo } from "@/lib/db";
import { verifyPassword } from "@/lib/password";

export async function loginAction(_prev: string | null, form: FormData): Promise<string | null> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const user = await getRepo().getStaffByEmail(email);
  if (!user || !verifyPassword(password, user.passwordHash)) {
    return "Correo o contraseña incorrectos.";
  }
  await startSession(user);
  redirect("/panel");
}

export async function logoutAction() {
  await endSession();
  redirect("/panel/login");
}

async function ownAppointment(id: string) {
  const { clinic } = await requireSession();
  const appt = await getRepo().getAppointment(id);
  if (!appt || appt.clinicId !== clinic.id) throw new Error("Cita no encontrada");
  return appt;
}

const STATUS_ACTIONS = {
  confirm: confirmAppointment,
  cancel: cancelAppointment,
  complete: completeAppointment,
  no_show: markNoShow,
  remind: async (a: Parameters<typeof sendReminder>[0]) => {
    await sendReminder(a);
    return a;
  },
} as const;

export async function appointmentAction(id: string, action: keyof typeof STATUS_ACTIONS) {
  const appt = await ownAppointment(id);
  try {
    await STATUS_ACTIONS[action](appt);
  } catch (e) {
    if (!(e instanceof BookingError)) throw e;
  }
  revalidatePath("/panel", "layout");
}

async function ownFollowUp(id: string) {
  const { clinic } = await requireSession();
  const f = await getRepo().getFollowUp(id);
  if (!f || f.clinicId !== clinic.id) throw new Error("Seguimiento no encontrado");
  return f;
}

export async function sendFollowUpAction(id: string) {
  await ownFollowUp(id);
  await sendFollowUp(id);
  revalidatePath("/panel", "layout");
}

export async function dismissFollowUpAction(id: string) {
  await ownFollowUp(id);
  await getRepo().updateFollowUp(id, { status: "dismissed" });
  revalidatePath("/panel", "layout");
}

/** Ejecuta ahora la tarea programada (útil en la demo y para soporte). */
export async function runSchedulerAction() {
  await requireSession();
  await runReminders();
  await runFollowUps();
  revalidatePath("/panel", "layout");
}

const settingsSchema = z.object({
  name: z.string().trim().min(3).max(80),
  phone: z.string().trim().max(30),
  address: z.string().trim().max(160),
  receptionEmail: z.union([z.literal(""), z.email()]),
  reminderHoursBefore: z.coerce.number().int().min(1).max(168),
  minNoticeMinutes: z.coerce.number().int().min(0).max(10_080),
  bookingHorizonDays: z.coerce.number().int().min(1).max(180),
  whatsappPhoneNumberId: z.string().trim().max(40),
  googleCalendarId: z.string().trim().max(200),
});

export async function saveSettingsAction(_prev: string | null, form: FormData): Promise<string | null> {
  const { clinic, user } = await requireSession();
  if (user.role !== "owner") return "Solo el administrador puede cambiar los ajustes.";
  const parsed = settingsSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success) return "Revisa los campos: hay valores no válidos.";
  const d = parsed.data;
  await getRepo().updateClinic(clinic.id, {
    name: d.name,
    phone: d.phone || null,
    address: d.address || null,
    receptionEmail: d.receptionEmail || null,
    reminderHoursBefore: d.reminderHoursBefore,
    minNoticeMinutes: d.minNoticeMinutes,
    bookingHorizonDays: d.bookingHorizonDays,
    whatsappPhoneNumberId: d.whatsappPhoneNumberId || null,
    googleCalendarId: d.googleCalendarId || null,
  });
  revalidatePath("/panel", "layout");
  return "ok";
}

export async function disconnectGoogleAction() {
  const { clinic, user } = await requireSession();
  if (user.role !== "owner") return;
  await getRepo().updateClinic(clinic.id, { googleRefreshToken: null });
  revalidatePath("/panel", "layout");
}
