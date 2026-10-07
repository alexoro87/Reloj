import "server-only";
import { computeSlots, type BusyInterval } from "./availability";
import { getRepo } from "./db";
import * as google from "./integrations/google";
import * as whatsapp from "./integrations/whatsapp";
import { formatPhone } from "./phone";
import { addDays, capitalize, formatLongDate, formatTime, todayIn, zonedToUtc } from "./time";
import type {
  Appointment,
  AppointmentSource,
  Clinic,
  Patient,
  Practitioner,
  Service,
} from "./types";

// ------------------------------------------------------------ disponibilidad

export interface Slot {
  start: string;
  practitionerId: string;
}

export const ANY_PRACTITIONER = "any";

/**
 * Huecos libres de un día. Con `practitionerId = "any"` se combinan todos los
 * podólogos que ofrecen el servicio, asignando a cada hora el que tenga menos
 * citas ese día para repartir la carga.
 */
export async function getAvailability(
  clinic: Clinic,
  input: { practitionerId: string; serviceId: string; date: string; ignoreAppointmentId?: string },
): Promise<Slot[]> {
  const repo = getRepo();
  const [practitioners, services, links, hours] = await Promise.all([
    repo.listPractitioners(clinic.id),
    repo.listServices(clinic.id),
    repo.listPractitionerServices(clinic.id),
    repo.listWorkingHours(clinic.id),
  ]);
  const service = services.find((s) => s.id === input.serviceId && s.active);
  if (!service) return [];

  const today = todayIn(clinic.timezone);
  if (input.date < today || input.date > addDays(today, clinic.bookingHorizonDays)) return [];

  const candidates = practitioners.filter(
    (p) =>
      p.active &&
      (input.practitionerId === ANY_PRACTITIONER || p.id === input.practitionerId) &&
      links.some((l) => l.practitionerId === p.id && l.serviceId === service.id),
  );
  if (candidates.length === 0) return [];

  const dayStart = zonedToUtc(input.date, "00:00", clinic.timezone).toISOString();
  const dayEnd = zonedToUtc(addDays(input.date, 1), "00:00", clinic.timezone).toISOString();
  const [appointments, timeOff, external] = await Promise.all([
    repo.listAppointments(clinic.id, { from: dayStart, to: dayEnd }),
    repo.listTimeOff(clinic.id, dayStart, dayEnd),
    google.isClinicConnected(clinic)
      ? google.freeBusy(
          clinic,
          candidates.flatMap((p) => (p.googleCalendarId ? [p.googleCalendarId] : [])),
          dayStart,
          dayEnd,
        )
      : Promise.resolve(new Map<string, BusyInterval[]>()),
  ]);

  const active = appointments.filter(
    (a) =>
      (a.status === "booked" || a.status === "confirmed") && a.id !== input.ignoreAppointmentId,
  );
  const now = new Date();
  const byTime = new Map<string, { practitionerId: string; load: number }>();

  for (const p of candidates) {
    const own = active.filter((a) => a.practitionerId === p.id);
    const busy: BusyInterval[] = [
      ...own.map((a) => ({ start: new Date(a.startsAt), end: new Date(a.endsAt) })),
      ...timeOff
        .filter((t) => t.practitionerId === p.id)
        .map((t) => ({ start: new Date(t.startsAt), end: new Date(t.endsAt) })),
      ...(p.googleCalendarId ? (external.get(p.googleCalendarId) ?? []) : []),
    ];
    const slots = computeSlots({
      date: input.date,
      timezone: clinic.timezone,
      durationMin: service.durationMin,
      workingHours: hours.filter((h) => h.practitionerId === p.id),
      busy,
      now,
      minNoticeMinutes: clinic.minNoticeMinutes,
    });
    for (const s of slots) {
      const key = s.toISOString();
      const current = byTime.get(key);
      if (!current || own.length < current.load) {
        byTime.set(key, { practitionerId: p.id, load: own.length });
      }
    }
  }

  return [...byTime.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([start, v]) => ({ start, practitionerId: v.practitionerId }));
}

// ------------------------------------------------------------ crear / cambiar

export interface BookingInput {
  clinic: Clinic;
  practitionerId: string;
  serviceId: string;
  start: string;
  patient: { name: string; phone: string; email: string | null; whatsappOptIn: boolean };
  source: AppointmentSource;
  notes?: string | null;
}

export class BookingError extends Error {}

export async function createBooking(input: BookingInput): Promise<Appointment> {
  const repo = getRepo();
  const { clinic } = input;
  const service = await getService(clinic.id, input.serviceId);
  const date = todayIn(clinic.timezone, new Date(input.start));

  // Se recalcula la disponibilidad en el servidor: nunca confiar en el navegador.
  const slots = await getAvailability(clinic, {
    practitionerId: input.practitionerId,
    serviceId: service.id,
    date,
  });
  const slot = slots.find((s) => s.start === new Date(input.start).toISOString());
  if (!slot) throw new BookingError("Ese horario ya no está disponible. Elige otro, por favor.");

  const patient = await repo.upsertPatient(clinic.id, input.patient);
  const start = new Date(slot.start);
  const appointment = await repo.createAppointment({
    clinicId: clinic.id,
    practitionerId: slot.practitionerId,
    serviceId: service.id,
    patientId: patient.id,
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + service.durationMin * 60_000).toISOString(),
    source: input.source,
    notes: input.notes ?? null,
  });

  // Si el paciente tenía un seguimiento pendiente de este servicio, queda resuelto.
  const followUps = await repo.listFollowUps(clinic.id);
  for (const f of followUps) {
    if (f.patientId === patient.id && f.serviceId === service.id && (f.status === "pending" || f.status === "sent")) {
      await repo.updateFollowUp(f.id, { status: "booked" });
    }
  }

  const ctx = await loadContext(appointment);
  await syncCalendar(ctx);
  if (patient.whatsappOptIn) await notify(ctx, "booked");
  return (await repo.getAppointment(appointment.id))!;
}

export async function rescheduleAppointment(
  appointment: Appointment,
  input: { practitionerId: string; start: string },
): Promise<Appointment> {
  const repo = getRepo();
  if (appointment.status !== "booked" && appointment.status !== "confirmed") {
    throw new BookingError("Esta cita ya no se puede cambiar.");
  }
  const clinic = (await repo.getClinic(appointment.clinicId))!;
  const service = await getService(clinic.id, appointment.serviceId);
  const slots = await getAvailability(clinic, {
    practitionerId: input.practitionerId,
    serviceId: service.id,
    date: todayIn(clinic.timezone, new Date(input.start)),
    ignoreAppointmentId: appointment.id,
  });
  const slot = slots.find((s) => s.start === new Date(input.start).toISOString());
  if (!slot) throw new BookingError("Ese horario ya no está disponible. Elige otro, por favor.");

  const start = new Date(slot.start);
  const oldPractitionerId = appointment.practitionerId;
  const updated = await repo.updateAppointment(appointment.id, {
    practitionerId: slot.practitionerId,
    startsAt: start.toISOString(),
    endsAt: new Date(start.getTime() + service.durationMin * 60_000).toISOString(),
    status: "booked",
    confirmedAt: null,
    reminderSentAt: null,
  });

  const ctx = await loadContext(updated);
  if (oldPractitionerId !== slot.practitionerId && appointment.googleEventId) {
    // Cambió de podólogo: el evento pasa a otro calendario.
    const oldPractitioner = (await repo.listPractitioners(clinic.id)).find(
      (p) => p.id === oldPractitionerId,
    );
    await safe(() =>
      google.deleteEvent(clinic, calendarFor(clinic, oldPractitioner), appointment.googleEventId!),
    );
    ctx.appointment = await repo.updateAppointment(updated.id, { googleEventId: null });
  }
  await syncCalendar(ctx);
  if (ctx.patient.whatsappOptIn) await notify(ctx, "booked");
  return (await repo.getAppointment(updated.id))!;
}

// ------------------------------------------------------------ cambios de estado

export async function confirmAppointment(appointment: Appointment): Promise<Appointment> {
  if (appointment.status === "confirmed") return appointment;
  if (appointment.status !== "booked") throw new BookingError("Esta cita ya no está activa.");
  const updated = await getRepo().updateAppointment(appointment.id, {
    status: "confirmed",
    confirmedAt: new Date().toISOString(),
  });
  await syncCalendar(await loadContext(updated));
  return updated;
}

export async function cancelAppointment(appointment: Appointment): Promise<Appointment> {
  if (appointment.status === "cancelled") return appointment;
  if (appointment.status !== "booked" && appointment.status !== "confirmed") {
    throw new BookingError("Esta cita ya no se puede cancelar.");
  }
  const updated = await getRepo().updateAppointment(appointment.id, {
    status: "cancelled",
    cancelledAt: new Date().toISOString(),
  });
  const ctx = await loadContext(updated);
  if (updated.googleEventId) {
    await safe(() =>
      google.deleteEvent(ctx.clinic, calendarFor(ctx.clinic, ctx.practitioner), updated.googleEventId!),
    );
  }
  return updated;
}

/** Marca la cita como atendida y, si el servicio lo pide, programa el seguimiento. */
export async function completeAppointment(appointment: Appointment): Promise<Appointment> {
  const repo = getRepo();
  const updated = await repo.updateAppointment(appointment.id, { status: "completed" });
  const ctx = await loadContext(updated);
  if (ctx.service.followUpWeeks) {
    const existing = await repo.listFollowUps(ctx.clinic.id);
    if (!existing.some((f) => f.sourceAppointmentId === updated.id)) {
      await repo.createFollowUp({
        clinicId: ctx.clinic.id,
        patientId: ctx.patient.id,
        practitionerId: ctx.practitioner.id,
        serviceId: ctx.service.id,
        sourceAppointmentId: updated.id,
        dueDate: addDays(
          todayIn(ctx.clinic.timezone, new Date(updated.startsAt)),
          ctx.service.followUpWeeks * 7,
        ),
      });
    }
  }
  return updated;
}

export async function markNoShow(appointment: Appointment): Promise<Appointment> {
  return getRepo().updateAppointment(appointment.id, { status: "no_show" });
}

// ------------------------------------------------------------ tareas programadas

export async function sendReminder(appointment: Appointment): Promise<void> {
  const ctx = await loadContext(appointment);
  if (ctx.patient.whatsappOptIn) await notify(ctx, "reminder");
  await getRepo().updateAppointment(appointment.id, { reminderSentAt: new Date().toISOString() });
}

/** Envía los recordatorios pendientes según la antelación configurada por cada clínica. */
export async function runReminders(): Promise<number> {
  const repo = getRepo();
  const now = Date.now();
  const upcoming = await repo.listUnremindedBefore(new Date(now + 168 * 3_600_000).toISOString());
  const clinics = new Map<string, Clinic | null>();
  let sent = 0;
  for (const a of upcoming) {
    if (!clinics.has(a.clinicId)) clinics.set(a.clinicId, await repo.getClinic(a.clinicId));
    const clinic = clinics.get(a.clinicId);
    if (!clinic) continue;
    const due = new Date(a.startsAt).getTime() - clinic.reminderHoursBefore * 3_600_000;
    if (due > now) continue;
    await safe(() => sendReminder(a));
    sent++;
  }
  return sent;
}

export async function sendFollowUp(followUpId: string): Promise<void> {
  const repo = getRepo();
  const f = await repo.getFollowUp(followUpId);
  if (!f || f.status !== "pending") return;
  const [clinic, patient, practitioners, services] = await Promise.all([
    repo.getClinic(f.clinicId),
    repo.getPatient(f.patientId),
    repo.listPractitioners(f.clinicId),
    repo.listServices(f.clinicId),
  ]);
  if (!clinic || !patient) return;
  const practitioner = practitioners.find((p) => p.id === f.practitionerId);
  const service = services.find((s) => s.id === f.serviceId);
  if (!practitioner || !service) return;

  if (patient.whatsappOptIn) {
    const appUrl = await appUrlSafe();
    const suffix = `${clinic.slug}?podologo=${practitioner.id}&servicio=${service.id}`;
    const result = await whatsapp.sendTemplate({
      kind: "follow_up",
      to: patient.phone,
      phoneNumberId: clinic.whatsappPhoneNumberId,
      params: [firstName(patient.name), clinic.name, service.name, practitioner.name],
      token: "",
      urlSuffix: suffix,
      appUrl,
    });
    await repo.logMessage({
      clinicId: clinic.id,
      appointmentId: null,
      patientId: patient.id,
      direction: "out",
      kind: "follow_up",
      ...result,
    });
  }
  await repo.updateFollowUp(f.id, { status: "sent", sentAt: new Date().toISOString() });
}

export async function runFollowUps(): Promise<number> {
  const repo = getRepo();
  // Se usa la fecha más adelantada posible; cada clínica filtra con su zona horaria.
  const due = await repo.listDueFollowUps(addDays(new Date().toISOString().slice(0, 10), 1));
  let sent = 0;
  for (const f of due) {
    const clinic = await repo.getClinic(f.clinicId);
    if (!clinic || f.dueDate > todayIn(clinic.timezone)) continue;
    await safe(() => sendFollowUp(f.id));
    sent++;
  }
  return sent;
}

// ------------------------------------------------------------ WhatsApp entrante

export async function handleInbound(msg: whatsapp.InboundMessage): Promise<void> {
  const repo = getRepo();
  const appointment = msg.token
    ? await repo.getAppointmentByToken(msg.token)
    : await repo.findNextAppointmentByPhone(msg.from, new Date().toISOString());
  if (!appointment) return;
  const ctx = await loadContext(appointment);
  if (ctx.patient.phone !== msg.from) return; // el botón debe venir del propio paciente

  await repo.logMessage({
    clinicId: ctx.clinic.id,
    appointmentId: appointment.id,
    patientId: ctx.patient.id,
    direction: "in",
    kind: "reply",
    body: msg.text || "(respuesta)",
    status: "received",
    buttons: [],
    error: null,
  });

  let reply: string | null = null;
  const when = `${ctx.dateText} a las ${ctx.timeText}`;
  const inactive = `Tu cita del ${when} ya no está activa. Si necesitas ayuda, llámanos${
    ctx.clinic.phone ? ` al ${ctx.clinic.phone}` : ""
  }.`;
  if (msg.action === "CONFIRM") {
    const ok = await safe(() => confirmAppointment(appointment));
    reply = ok
      ? `¡Gracias, ${firstName(ctx.patient.name)}! Tu cita del ${when} quedó confirmada. Te esperamos.`
      : inactive;
  } else if (msg.action === "CANCEL") {
    const ok = await safe(() => cancelAppointment(appointment));
    const appUrl = await appUrlSafe();
    reply = ok
      ? `Listo, cancelamos tu cita del ${when}. ` +
        `Si quieres agendar otra fecha, entra aquí: ${appUrl}/c/${ctx.clinic.slug}`
      : inactive;
  }
  if (reply) {
    const result = await whatsapp.sendText(ctx.clinic.whatsappPhoneNumberId, msg.from, reply);
    await repo.logMessage({
      clinicId: ctx.clinic.id,
      appointmentId: appointment.id,
      patientId: ctx.patient.id,
      direction: "out",
      kind: "reply",
      ...result,
    });
  }
}

// ------------------------------------------------------------ utilidades

export interface AppointmentContext {
  appointment: Appointment;
  clinic: Clinic;
  practitioner: Practitioner;
  service: Service;
  patient: Patient;
  dateText: string;
  timeText: string;
}

export async function loadContext(appointment: Appointment): Promise<AppointmentContext> {
  const repo = getRepo();
  const [clinic, practitioners, services, patient] = await Promise.all([
    repo.getClinic(appointment.clinicId),
    repo.listPractitioners(appointment.clinicId),
    repo.listServices(appointment.clinicId),
    repo.getPatient(appointment.patientId),
  ]);
  const practitioner = practitioners.find((p) => p.id === appointment.practitionerId);
  const service = services.find((s) => s.id === appointment.serviceId);
  if (!clinic || !practitioner || !service || !patient) {
    throw new Error(`Datos incompletos para la cita ${appointment.id}`);
  }
  return {
    appointment,
    clinic,
    practitioner,
    service,
    patient,
    dateText: formatLongDate(appointment.startsAt, clinic.timezone),
    timeText: formatTime(appointment.startsAt, clinic.timezone),
  };
}

async function getService(clinicId: string, serviceId: string): Promise<Service> {
  const service = (await getRepo().listServices(clinicId)).find(
    (s) => s.id === serviceId && s.active,
  );
  if (!service) throw new BookingError("Servicio no disponible.");
  return service;
}

function calendarFor(clinic: Clinic, practitioner?: Practitioner): string {
  return practitioner?.googleCalendarId ?? clinic.googleCalendarId ?? "primary";
}

/** Crea o actualiza el evento de Google Calendar de la cita (si la clínica lo tiene conectado). */
async function syncCalendar(ctx: AppointmentContext): Promise<void> {
  const { clinic, appointment: a } = ctx;
  if (!google.isClinicConnected(clinic)) return;
  const appUrl = await appUrlSafe();
  const statusLabel = a.status === "confirmed" ? "✅ " : "";
  const event: google.CalendarEvent = {
    summary: `${statusLabel}${ctx.patient.name} · ${ctx.service.name}`,
    // Sin datos clínicos: solo lo necesario para la agenda.
    description: [
      `Paciente: ${ctx.patient.name}`,
      `WhatsApp: ${formatPhone(ctx.patient.phone)}`,
      `Podólogo: ${ctx.practitioner.name}`,
      `Estado: ${a.status === "confirmed" ? "Confirmada" : "Pendiente de confirmar"}`,
      "",
      `Panel: ${appUrl}/panel/cita/${a.id}`,
    ].join("\n"),
    start: a.startsAt,
    end: a.endsAt,
    timezone: clinic.timezone,
    attendees: clinic.receptionEmail ? [clinic.receptionEmail] : [],
  };
  const calendarId = calendarFor(clinic, ctx.practitioner);
  await safe(async () => {
    if (a.googleEventId) {
      await google.updateEvent(clinic, calendarId, a.googleEventId, event);
    } else {
      const id = await google.createEvent(clinic, calendarId, event);
      if (id) ctx.appointment = await getRepo().updateAppointment(a.id, { googleEventId: id });
    }
  });
}

async function notify(ctx: AppointmentContext, kind: "booked" | "reminder"): Promise<void> {
  const appUrl = await appUrlSafe();
  const { clinic, patient, appointment } = ctx;
  const result = await whatsapp.sendTemplate({
    kind,
    to: patient.phone,
    phoneNumberId: clinic.whatsappPhoneNumberId,
    params: [
      firstName(patient.name),
      clinic.name,
      ctx.service.name,
      ctx.practitioner.name,
      ctx.dateText,
      ctx.timeText,
    ],
    token: appointment.manageToken,
    urlSuffix: kind === "reminder" ? `${appointment.manageToken}/cambiar` : appointment.manageToken,
    appUrl,
  });
  await getRepo().logMessage({
    clinicId: clinic.id,
    appointmentId: appointment.id,
    patientId: patient.id,
    direction: "out",
    kind,
    ...result,
  });
}

async function appUrlSafe(): Promise<string> {
  try {
    const { getAppUrl } = await import("./app-url");
    return await getAppUrl();
  } catch {
    return process.env.APP_URL ?? "http://localhost:3000";
  }
}

export function firstName(name: string): string {
  return capitalize(name.trim().split(/\s+/)[0] ?? name);
}

/** Las integraciones externas nunca deben tumbar una reserva ya guardada. */
async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e) {
    console.error("[huella]", e);
    return undefined;
  }
}
