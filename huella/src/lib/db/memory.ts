import { randomUUID } from "node:crypto";
import { hashPassword, randomToken } from "../password";
import { addDays, todayIn, zonedToUtc } from "../time";
import {
  SlotTakenError,
  type Appointment,
  type Clinic,
  type FollowUp,
  type MessageLog,
  type Patient,
  type Practitioner,
  type PractitionerService,
  type Service,
  type StaffUser,
  type TimeOff,
  type WorkingHours,
} from "../types";
import type { AppointmentFilter, AppointmentPatch, NewAppointment, NewMessage, Repo } from "./repo";

interface Store {
  clinics: Clinic[];
  practitioners: Practitioner[];
  services: Service[];
  practitionerServices: PractitionerService[];
  workingHours: WorkingHours[];
  timeOff: TimeOff[];
  patients: Patient[];
  appointments: Appointment[];
  followUps: FollowUp[];
  messages: MessageLog[];
  staff: StaffUser[];
}

const ACTIVE = new Set(["booked", "confirmed"]);
const clone = <T>(v: T): T => structuredClone(v);

/**
 * Base de datos en memoria para el modo demo. Vive en globalThis para
 * sobrevivir a la recarga en caliente de desarrollo; se reinicia al reiniciar
 * el servidor.
 */
export class MemoryRepo implements Repo {
  private s: Store;

  constructor() {
    const g = globalThis as unknown as { __huellaStore?: Store };
    g.__huellaStore ??= seed();
    this.s = g.__huellaStore;
  }

  async getClinicBySlug(slug: string) {
    return clone(this.s.clinics.find((c) => c.slug === slug) ?? null);
  }
  async getClinic(id: string) {
    return clone(this.s.clinics.find((c) => c.id === id) ?? null);
  }
  async updateClinic(id: string, patch: Partial<Clinic>) {
    const c = this.s.clinics.find((c) => c.id === id);
    if (c) Object.assign(c, patch);
  }

  async listPractitioners(clinicId: string) {
    return clone(this.s.practitioners.filter((p) => p.clinicId === clinicId));
  }
  async listServices(clinicId: string) {
    return clone(this.s.services.filter((s) => s.clinicId === clinicId));
  }
  async listPractitionerServices(clinicId: string) {
    const ids = new Set(this.s.practitioners.filter((p) => p.clinicId === clinicId).map((p) => p.id));
    return clone(this.s.practitionerServices.filter((ps) => ids.has(ps.practitionerId)));
  }
  async listWorkingHours(clinicId: string) {
    const ids = new Set(this.s.practitioners.filter((p) => p.clinicId === clinicId).map((p) => p.id));
    return clone(this.s.workingHours.filter((w) => ids.has(w.practitionerId)));
  }
  async listTimeOff(clinicId: string, from: string, to: string) {
    const ids = new Set(this.s.practitioners.filter((p) => p.clinicId === clinicId).map((p) => p.id));
    return clone(
      this.s.timeOff.filter((t) => ids.has(t.practitionerId) && t.startsAt < to && t.endsAt > from),
    );
  }

  async listAppointments(clinicId: string, f: AppointmentFilter) {
    return clone(
      this.s.appointments
        .filter(
          (a) =>
            a.clinicId === clinicId &&
            a.startsAt < f.to &&
            a.endsAt > f.from &&
            (!f.practitionerId || a.practitionerId === f.practitionerId) &&
            (f.includeCancelled || a.status !== "cancelled"),
        )
        .sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
    );
  }
  async getAppointment(id: string) {
    return clone(this.s.appointments.find((a) => a.id === id) ?? null);
  }
  async getAppointmentByToken(token: string) {
    return clone(this.s.appointments.find((a) => a.manageToken === token) ?? null);
  }

  private assertFree(practitionerId: string, startsAt: string, endsAt: string, ignoreId?: string) {
    const clash = this.s.appointments.some(
      (a) =>
        a.id !== ignoreId &&
        a.practitionerId === practitionerId &&
        ACTIVE.has(a.status) &&
        a.startsAt < endsAt &&
        a.endsAt > startsAt,
    );
    if (clash) throw new SlotTakenError();
  }

  async createAppointment(input: NewAppointment) {
    this.assertFree(input.practitionerId, input.startsAt, input.endsAt);
    const a: Appointment = {
      id: randomUUID(),
      ...input,
      notes: input.notes ?? null,
      status: "booked",
      manageToken: randomToken(),
      googleEventId: null,
      reminderSentAt: null,
      confirmedAt: null,
      cancelledAt: null,
      createdAt: new Date().toISOString(),
    };
    this.s.appointments.push(a);
    return clone(a);
  }

  async updateAppointment(id: string, patch: AppointmentPatch) {
    const a = this.s.appointments.find((a) => a.id === id);
    if (!a) throw new Error("Cita no encontrada");
    const next = { ...a, ...patch };
    if (ACTIVE.has(next.status)) this.assertFree(next.practitionerId, next.startsAt, next.endsAt, id);
    Object.assign(a, patch);
    return clone(a);
  }

  async listUnremindedBefore(until: string) {
    const now = new Date().toISOString();
    return clone(
      this.s.appointments.filter(
        (a) => ACTIVE.has(a.status) && !a.reminderSentAt && a.startsAt > now && a.startsAt <= until,
      ),
    );
  }

  async findNextAppointmentByPhone(phone: string, after: string) {
    const patientIds = new Set(this.s.patients.filter((p) => p.phone === phone).map((p) => p.id));
    const next = this.s.appointments
      .filter((a) => patientIds.has(a.patientId) && ACTIVE.has(a.status) && a.startsAt > after)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
    return clone(next ?? null);
  }

  async upsertPatient(
    clinicId: string,
    input: { name: string; phone: string; email: string | null; whatsappOptIn: boolean },
  ) {
    let p = this.s.patients.find((p) => p.clinicId === clinicId && p.phone === input.phone);
    if (p) {
      p.name = input.name;
      p.email = input.email ?? p.email;
      p.whatsappOptIn = input.whatsappOptIn || p.whatsappOptIn;
    } else {
      p = { id: randomUUID(), clinicId, ...input, createdAt: new Date().toISOString() };
      this.s.patients.push(p);
    }
    return clone(p);
  }
  async getPatient(id: string) {
    return clone(this.s.patients.find((p) => p.id === id) ?? null);
  }
  async listPatients(clinicId: string, ids: string[]) {
    const set = new Set(ids);
    return clone(this.s.patients.filter((p) => p.clinicId === clinicId && set.has(p.id)));
  }

  async createFollowUp(input: Omit<FollowUp, "id" | "createdAt" | "sentAt" | "status">) {
    const f: FollowUp = {
      id: randomUUID(),
      ...input,
      status: "pending",
      sentAt: null,
      createdAt: new Date().toISOString(),
    };
    this.s.followUps.push(f);
    return clone(f);
  }
  async listFollowUps(clinicId: string) {
    return clone(
      this.s.followUps
        .filter((f) => f.clinicId === clinicId)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    );
  }
  async listDueFollowUps(date: string) {
    return clone(this.s.followUps.filter((f) => f.status === "pending" && f.dueDate <= date));
  }
  async getFollowUp(id: string) {
    return clone(this.s.followUps.find((f) => f.id === id) ?? null);
  }
  async updateFollowUp(id: string, patch: Partial<Pick<FollowUp, "status" | "sentAt">>) {
    const f = this.s.followUps.find((f) => f.id === id);
    if (f) Object.assign(f, patch);
  }

  async logMessage(input: NewMessage) {
    const m: MessageLog = { id: randomUUID(), ...input, createdAt: new Date().toISOString() };
    this.s.messages.push(m);
    return clone(m);
  }
  async listMessages(clinicId: string, limit: number) {
    return clone(
      this.s.messages
        .filter((m) => m.clinicId === clinicId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, limit),
    );
  }

  async getStaffByEmail(email: string) {
    return clone(this.s.staff.find((u) => u.email === email.toLowerCase()) ?? null);
  }
  async getStaff(id: string) {
    return clone(this.s.staff.find((u) => u.id === id) ?? null);
  }
}

export const DEMO_LOGIN = { email: "recepcion@piesano.demo", password: "demo1234" };

function seed(): Store {
  const tz = "America/Mexico_City";
  const clinic: Clinic = {
    id: "c0000000-0000-4000-8000-000000000001",
    slug: "pie-sano",
    name: "Clínica Podológica Pie Sano",
    timezone: tz,
    countryCode: "52",
    phone: "55 1234 5678",
    address: "Av. Insurgentes Sur 1234, Col. Del Valle, CDMX",
    receptionEmail: "recepcion@piesano.demo",
    reminderHoursBefore: 24,
    minNoticeMinutes: 60,
    bookingHorizonDays: 30,
    googleRefreshToken: null,
    googleCalendarId: null,
    whatsappPhoneNumberId: null,
  };

  const mk = (id: string, name: string, title: string, color: string, bio: string): Practitioner => ({
    id,
    clinicId: clinic.id,
    name,
    title,
    bio,
    color,
    googleCalendarId: null,
    active: true,
  });
  const practitioners = [
    mk("p1", "Dra. Laura Méndez", "Podóloga clínica", "#2f6f62", "Pie diabético y uñas encarnadas."),
    mk("p2", "Dr. Andrés Ruiz", "Podólogo deportivo", "#c2643f", "Estudio de la pisada y plantillas."),
    mk("p3", "Lic. Sofía Torres", "Podóloga", "#5b5fc7", "Quiropodia y tratamiento de hongos."),
  ];

  const sv = (
    id: string,
    name: string,
    durationMin: number,
    price: number,
    followUpWeeks: number | null,
    description: string,
  ): Service => ({
    id,
    clinicId: clinic.id,
    name,
    description,
    durationMin,
    priceCents: price * 100,
    followUpWeeks,
    active: true,
  });
  const services = [
    sv("s1", "Quiropodia", 30, 450, 6, "Corte y limpieza de uñas, durezas y callosidades."),
    sv("s2", "Uña encarnada", 45, 700, 2, "Tratamiento conservador o espiculotomía."),
    sv("s3", "Estudio de la pisada", 60, 900, null, "Análisis biomecánico para plantillas a medida."),
    sv("s4", "Revisión de pie diabético", 45, 600, 4, "Exploración vascular, neurológica y curación."),
    sv("s5", "Tratamiento de hongos", 30, 500, 4, "Onicomicosis: limpieza y aplicación tópica."),
    sv("s6", "Entrega de plantillas", 20, 0, null, "Prueba y ajuste de plantillas ortopédicas."),
  ];

  const offers: Record<string, string[]> = {
    p1: ["s1", "s2", "s4", "s5"],
    p2: ["s1", "s3", "s6"],
    p3: ["s1", "s2", "s5"],
  };
  const practitionerServices = Object.entries(offers).flatMap(([practitionerId, ids]) =>
    ids.map((serviceId) => ({ practitionerId, serviceId })),
  );

  const workingHours: WorkingHours[] = [];
  for (const wd of [1, 2, 3, 4, 5]) {
    workingHours.push({ practitionerId: "p1", weekday: wd, start: "09:00", end: "14:00" });
    workingHours.push({ practitionerId: "p1", weekday: wd, start: "16:00", end: "19:00" });
    workingHours.push({ practitionerId: "p2", weekday: wd, start: "11:00", end: "19:00" });
    if (wd !== 3) workingHours.push({ practitionerId: "p3", weekday: wd, start: "08:00", end: "15:00" });
  }
  workingHours.push({ practitionerId: "p1", weekday: 6, start: "09:00", end: "13:00" });
  workingHours.push({ practitionerId: "p3", weekday: 6, start: "09:00", end: "13:00" });

  const now = new Date().toISOString();
  const pt = (id: string, name: string, phone: string): Patient => ({
    id,
    clinicId: clinic.id,
    name,
    phone,
    email: null,
    whatsappOptIn: true,
    createdAt: now,
  });
  const patients = [
    pt("pt1", "María González", "525511112222"),
    pt("pt2", "José Hernández", "525533334444"),
    pt("pt3", "Guadalupe Ramírez", "525555556666"),
    pt("pt4", "Carmen López", "525577778888"),
    pt("pt5", "Roberto Sánchez", "525599990000"),
  ];

  const today = todayIn(tz);
  const durations = Object.fromEntries(services.map((s) => [s.id, s.durationMin]));
  const appt = (
    day: number,
    time: string,
    practitionerId: string,
    serviceId: string,
    patientId: string,
    status: Appointment["status"],
  ): Appointment => {
    const start = zonedToUtc(addDays(today, day), time, tz);
    return {
      id: randomUUID(),
      clinicId: clinic.id,
      practitionerId,
      serviceId,
      patientId,
      startsAt: start.toISOString(),
      endsAt: new Date(start.getTime() + durations[serviceId] * 60_000).toISOString(),
      status,
      source: "online",
      manageToken: randomToken(),
      googleEventId: null,
      reminderSentAt: status === "confirmed" ? now : null,
      confirmedAt: status === "confirmed" ? now : null,
      cancelledAt: null,
      notes: null,
      createdAt: now,
    };
  };
  const appointments = [
    appt(0, "09:00", "p1", "s4", "pt1", "completed"),
    appt(0, "10:00", "p1", "s2", "pt2", "confirmed"),
    appt(0, "11:30", "p2", "s3", "pt3", "confirmed"),
    appt(0, "12:00", "p3", "s1", "pt4", "booked"),
    appt(0, "17:00", "p1", "s1", "pt5", "booked"),
    appt(1, "10:30", "p3", "s5", "pt1", "booked"),
    appt(1, "13:00", "p2", "s6", "pt3", "booked"),
    appt(2, "09:30", "p1", "s4", "pt4", "booked"),
  ];

  const followUps: FollowUp[] = [
    {
      id: randomUUID(),
      clinicId: clinic.id,
      patientId: "pt5",
      practitionerId: "p1",
      serviceId: "s4",
      sourceAppointmentId: "seed-cita-pasada-1",
      dueDate: today,
      status: "pending",
      sentAt: null,
      createdAt: now,
    },
    {
      id: randomUUID(),
      clinicId: clinic.id,
      patientId: "pt2",
      practitionerId: "p3",
      serviceId: "s1",
      sourceAppointmentId: "seed-cita-pasada-2",
      dueDate: addDays(today, 9),
      status: "pending",
      sentAt: null,
      createdAt: now,
    },
  ];

  return {
    clinics: [clinic],
    practitioners,
    services,
    practitionerServices,
    workingHours,
    timeOff: [],
    patients,
    appointments,
    followUps,
    messages: [],
    staff: [
      {
        id: "u1",
        clinicId: clinic.id,
        email: DEMO_LOGIN.email,
        name: "Recepción Pie Sano",
        passwordHash: hashPassword(DEMO_LOGIN.password),
        role: "owner",
      },
    ],
  };
}
