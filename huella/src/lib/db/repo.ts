import type {
  Appointment,
  AppointmentSource,
  Clinic,
  FollowUp,
  MessageLog,
  Patient,
  Practitioner,
  PractitionerService,
  Service,
  StaffUser,
  TimeOff,
  WorkingHours,
} from "../types";

export interface NewAppointment {
  clinicId: string;
  practitionerId: string;
  serviceId: string;
  patientId: string;
  startsAt: string;
  endsAt: string;
  source: AppointmentSource;
  notes?: string | null;
}

export interface AppointmentFilter {
  from: string;
  to: string;
  practitionerId?: string;
  includeCancelled?: boolean;
}

export type NewMessage = Omit<MessageLog, "id" | "createdAt">;

export type AppointmentPatch = Partial<
  Pick<
    Appointment,
    | "practitionerId"
    | "startsAt"
    | "endsAt"
    | "status"
    | "googleEventId"
    | "reminderSentAt"
    | "confirmedAt"
    | "cancelledAt"
    | "notes"
  >
>;

/**
 * Acceso a datos. Hay dos implementaciones: en memoria (modo demo, sin
 * configuración) y Supabase/Postgres (producción). Toda consulta va acotada por
 * clinicId: es la frontera multi-clínica.
 */
export interface Repo {
  getClinicBySlug(slug: string): Promise<Clinic | null>;
  getClinic(id: string): Promise<Clinic | null>;
  updateClinic(id: string, patch: Partial<Omit<Clinic, "id" | "slug">>): Promise<void>;

  listPractitioners(clinicId: string): Promise<Practitioner[]>;
  listServices(clinicId: string): Promise<Service[]>;
  listPractitionerServices(clinicId: string): Promise<PractitionerService[]>;
  listWorkingHours(clinicId: string): Promise<WorkingHours[]>;
  listTimeOff(clinicId: string, from: string, to: string): Promise<TimeOff[]>;

  listAppointments(clinicId: string, filter: AppointmentFilter): Promise<Appointment[]>;
  getAppointment(id: string): Promise<Appointment | null>;
  getAppointmentByToken(token: string): Promise<Appointment | null>;
  /** Lanza SlotTakenError si se solapa con otra cita activa del mismo podólogo. */
  createAppointment(input: NewAppointment): Promise<Appointment>;
  /** Lanza SlotTakenError si el cambio de horario provoca solapamiento. */
  updateAppointment(id: string, patch: AppointmentPatch): Promise<Appointment>;
  /** Citas activas sin recordatorio que empiezan antes de `until` (todas las clínicas). */
  listUnremindedBefore(until: string): Promise<Appointment[]>;
  /** Próxima cita activa de un teléfono (para respuestas de texto libre por WhatsApp). */
  findNextAppointmentByPhone(phone: string, after: string): Promise<Appointment | null>;

  upsertPatient(
    clinicId: string,
    input: { name: string; phone: string; email: string | null; whatsappOptIn: boolean },
  ): Promise<Patient>;
  getPatient(id: string): Promise<Patient | null>;
  listPatients(clinicId: string, ids: string[]): Promise<Patient[]>;

  createFollowUp(input: Omit<FollowUp, "id" | "createdAt" | "sentAt" | "status">): Promise<FollowUp>;
  listFollowUps(clinicId: string): Promise<FollowUp[]>;
  /** Seguimientos pendientes con fecha <= `date` (todas las clínicas). */
  listDueFollowUps(date: string): Promise<FollowUp[]>;
  getFollowUp(id: string): Promise<FollowUp | null>;
  updateFollowUp(id: string, patch: Partial<Pick<FollowUp, "status" | "sentAt">>): Promise<void>;

  logMessage(input: NewMessage): Promise<MessageLog>;
  listMessages(clinicId: string, limit: number): Promise<MessageLog[]>;

  getStaffByEmail(email: string): Promise<StaffUser | null>;
  getStaff(id: string): Promise<StaffUser | null>;
}
