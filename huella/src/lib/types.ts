export type AppointmentStatus =
  | "booked"
  | "confirmed"
  | "cancelled"
  | "completed"
  | "no_show";

export type AppointmentSource = "online" | "reception" | "follow_up";

export interface Clinic {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  /** Prefijo telefónico por defecto (sin "+"), p. ej. "52" para México. */
  countryCode: string;
  phone: string | null;
  address: string | null;
  receptionEmail: string | null;
  reminderHoursBefore: number;
  minNoticeMinutes: number;
  bookingHorizonDays: number;
  googleRefreshToken: string | null;
  googleCalendarId: string | null;
  whatsappPhoneNumberId: string | null;
}

/** Datos de la clínica que es seguro enviar al navegador. */
export type PublicClinic = Pick<
  Clinic,
  "id" | "slug" | "name" | "timezone" | "phone" | "address" | "bookingHorizonDays"
>;

export interface Practitioner {
  id: string;
  clinicId: string;
  name: string;
  title: string | null;
  bio: string | null;
  color: string;
  googleCalendarId: string | null;
  active: boolean;
}

export interface Service {
  id: string;
  clinicId: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number | null;
  /** Si se define, al completar la cita se programa un seguimiento N semanas después. */
  followUpWeeks: number | null;
  active: boolean;
}

export interface PractitionerService {
  practitionerId: string;
  serviceId: string;
}

export interface WorkingHours {
  practitionerId: string;
  /** 0 = domingo … 6 = sábado */
  weekday: number;
  /** "HH:mm" en la zona horaria de la clínica */
  start: string;
  end: string;
}

export interface TimeOff {
  id: string;
  practitionerId: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
}

export interface Patient {
  id: string;
  clinicId: string;
  name: string;
  /** E.164 sin "+", p. ej. "5215512345678" */
  phone: string;
  email: string | null;
  whatsappOptIn: boolean;
  createdAt: string;
}

export interface Appointment {
  id: string;
  clinicId: string;
  practitionerId: string;
  serviceId: string;
  patientId: string;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  manageToken: string;
  googleEventId: string | null;
  reminderSentAt: string | null;
  confirmedAt: string | null;
  cancelledAt: string | null;
  notes: string | null;
  createdAt: string;
}

export type FollowUpStatus = "pending" | "sent" | "booked" | "dismissed";

export interface FollowUp {
  id: string;
  clinicId: string;
  patientId: string;
  practitionerId: string;
  serviceId: string;
  sourceAppointmentId: string;
  /** "YYYY-MM-DD" en la zona horaria de la clínica */
  dueDate: string;
  status: FollowUpStatus;
  sentAt: string | null;
  createdAt: string;
}

export type MessageStatus = "sent" | "simulated" | "failed" | "received";

export interface MessageLog {
  id: string;
  clinicId: string;
  appointmentId: string | null;
  patientId: string | null;
  direction: "out" | "in";
  kind: string;
  body: string;
  status: MessageStatus;
  /** Botones mostrados al paciente (solo mensajes salientes). */
  buttons: { label: string; url?: string }[];
  error: string | null;
  createdAt: string;
}

export type StaffRole = "owner" | "reception" | "practitioner";

export interface StaffUser {
  id: string;
  clinicId: string;
  email: string;
  name: string;
  passwordHash: string;
  role: StaffRole;
}

export class SlotTakenError extends Error {
  constructor() {
    super("Ese horario acaba de ocuparse. Elige otro, por favor.");
  }
}
