import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomToken } from "../password";
import {
  SlotTakenError,
  type Appointment,
  type Clinic,
  type FollowUp,
  type MessageLog,
  type Patient,
  type Practitioner,
  type Service,
  type StaffUser,
  type TimeOff,
  type WorkingHours,
} from "../types";
import type { AppointmentFilter, AppointmentPatch, NewAppointment, NewMessage, Repo } from "./repo";

type Row = Record<string, unknown>;

const OVERLAP_VIOLATION = "23P01";

/** Implementación de producción sobre Supabase/Postgres (service-role, solo servidor). */
export class SupabaseRepo implements Repo {
  private db: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.db = createClient(url, serviceRoleKey, { auth: { persistSession: false } });
  }

  async getClinicBySlug(slug: string) {
    const { data } = await this.db.from("clinics").select("*").eq("slug", slug).maybeSingle();
    return data ? toClinic(data) : null;
  }
  async getClinic(id: string) {
    const { data } = await this.db.from("clinics").select("*").eq("id", id).maybeSingle();
    return data ? toClinic(data) : null;
  }
  async updateClinic(id: string, patch: Partial<Clinic>) {
    must(await this.db.from("clinics").update(snake(patch)).eq("id", id));
  }

  async listPractitioners(clinicId: string) {
    const rows = must(
      await this.db.from("practitioners").select("*").eq("clinic_id", clinicId).order("name"),
    );
    return rows.map((r) => camel<Practitioner>(r));
  }
  async listServices(clinicId: string) {
    const rows = must(
      await this.db.from("services").select("*").eq("clinic_id", clinicId).order("name"),
    );
    return rows.map((r) => camel<Service>(r));
  }
  async listPractitionerServices(clinicId: string) {
    const rows = must(
      await this.db
        .from("practitioner_services")
        .select("practitioner_id, service_id, practitioners!inner(clinic_id)")
        .eq("practitioners.clinic_id", clinicId),
    );
    return rows.map((r) => ({
      practitionerId: r.practitioner_id as string,
      serviceId: r.service_id as string,
    }));
  }
  async listWorkingHours(clinicId: string) {
    const rows = must(
      await this.db
        .from("working_hours")
        .select("practitioner_id, weekday, start_time, end_time, practitioners!inner(clinic_id)")
        .eq("practitioners.clinic_id", clinicId),
    );
    return rows.map(
      (r): WorkingHours => ({
        practitionerId: r.practitioner_id as string,
        weekday: r.weekday as number,
        start: (r.start_time as string).slice(0, 5),
        end: (r.end_time as string).slice(0, 5),
      }),
    );
  }
  async listTimeOff(clinicId: string, from: string, to: string) {
    const rows = must(
      await this.db
        .from("time_off")
        .select("id, practitioner_id, starts_at, ends_at, reason, practitioners!inner(clinic_id)")
        .eq("practitioners.clinic_id", clinicId)
        .lt("starts_at", to)
        .gt("ends_at", from),
    );
    return rows.map((r) => {
      delete r.practitioners;
      return camel<TimeOff>(r);
    });
  }

  async listAppointments(clinicId: string, f: AppointmentFilter) {
    let q = this.db
      .from("appointments")
      .select("*")
      .eq("clinic_id", clinicId)
      .lt("starts_at", f.to)
      .gt("ends_at", f.from)
      .order("starts_at");
    if (f.practitionerId) q = q.eq("practitioner_id", f.practitionerId);
    if (!f.includeCancelled) q = q.neq("status", "cancelled");
    return must(await q).map((r) => camel<Appointment>(r));
  }
  async getAppointment(id: string) {
    const { data } = await this.db.from("appointments").select("*").eq("id", id).maybeSingle();
    return data ? camel<Appointment>(data) : null;
  }
  async getAppointmentByToken(token: string) {
    const { data } = await this.db
      .from("appointments")
      .select("*")
      .eq("manage_token", token)
      .maybeSingle();
    return data ? camel<Appointment>(data) : null;
  }
  async createAppointment(input: NewAppointment) {
    const { data, error } = await this.db
      .from("appointments")
      .insert(snake({ ...input, manageToken: randomToken() }))
      .select("*")
      .single();
    if (error?.code === OVERLAP_VIOLATION) throw new SlotTakenError();
    if (error) throw new Error(error.message);
    return camel<Appointment>(data);
  }
  async updateAppointment(id: string, patch: AppointmentPatch) {
    const { data, error } = await this.db
      .from("appointments")
      .update(snake(patch))
      .eq("id", id)
      .select("*")
      .single();
    if (error?.code === OVERLAP_VIOLATION) throw new SlotTakenError();
    if (error) throw new Error(error.message);
    return camel<Appointment>(data);
  }
  async listUnremindedBefore(until: string) {
    const rows = must(
      await this.db
        .from("appointments")
        .select("*")
        .in("status", ["booked", "confirmed"])
        .is("reminder_sent_at", null)
        .gt("starts_at", new Date().toISOString())
        .lte("starts_at", until),
    );
    return rows.map((r) => camel<Appointment>(r));
  }
  async findNextAppointmentByPhone(phone: string, after: string) {
    const { data } = await this.db
      .from("appointments")
      .select("*, patients!inner(phone)")
      .eq("patients.phone", phone)
      .in("status", ["booked", "confirmed"])
      .gt("starts_at", after)
      .order("starts_at")
      .limit(1)
      .maybeSingle();
    if (!data) return null;
    delete data.patients;
    return camel<Appointment>(data);
  }

  async upsertPatient(
    clinicId: string,
    input: { name: string; phone: string; email: string | null; whatsappOptIn: boolean },
  ) {
    const row: Row = { clinic_id: clinicId, name: input.name, phone: input.phone };
    if (input.email) row.email = input.email;
    if (input.whatsappOptIn) {
      row.whatsapp_opt_in = true;
      row.whatsapp_opt_in_at = new Date().toISOString();
    }
    const { data, error } = await this.db
      .from("patients")
      .upsert(row, { onConflict: "clinic_id,phone" })
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return toPatient(data);
  }
  async getPatient(id: string) {
    const { data } = await this.db.from("patients").select("*").eq("id", id).maybeSingle();
    return data ? toPatient(data) : null;
  }
  async listPatients(clinicId: string, ids: string[]) {
    if (ids.length === 0) return [];
    const rows = must(
      await this.db.from("patients").select("*").eq("clinic_id", clinicId).in("id", ids),
    );
    return rows.map(toPatient);
  }

  async createFollowUp(input: Omit<FollowUp, "id" | "createdAt" | "sentAt" | "status">) {
    const { data, error } = await this.db
      .from("follow_ups")
      .insert(snake(input))
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return camel<FollowUp>(data);
  }
  async listFollowUps(clinicId: string) {
    const rows = must(
      await this.db.from("follow_ups").select("*").eq("clinic_id", clinicId).order("due_date"),
    );
    return rows.map((r) => camel<FollowUp>(r));
  }
  async listDueFollowUps(date: string) {
    const rows = must(
      await this.db.from("follow_ups").select("*").eq("status", "pending").lte("due_date", date),
    );
    return rows.map((r) => camel<FollowUp>(r));
  }
  async getFollowUp(id: string) {
    const { data } = await this.db.from("follow_ups").select("*").eq("id", id).maybeSingle();
    return data ? camel<FollowUp>(data) : null;
  }
  async updateFollowUp(id: string, patch: Partial<Pick<FollowUp, "status" | "sentAt">>) {
    must(await this.db.from("follow_ups").update(snake(patch)).eq("id", id));
  }

  async logMessage(input: NewMessage) {
    const { data, error } = await this.db
      .from("message_log")
      .insert(snake(input))
      .select("*")
      .single();
    if (error) throw new Error(error.message);
    return camel<MessageLog>(data);
  }
  async listMessages(clinicId: string, limit: number) {
    const rows = must(
      await this.db
        .from("message_log")
        .select("*")
        .eq("clinic_id", clinicId)
        .order("created_at", { ascending: false })
        .limit(limit),
    );
    return rows.map((r) => camel<MessageLog>(r));
  }

  async getStaffByEmail(email: string) {
    const { data } = await this.db
      .from("staff_users")
      .select("*")
      .eq("email", email.toLowerCase())
      .maybeSingle();
    return data ? camel<StaffUser>(data) : null;
  }
  async getStaff(id: string) {
    const { data } = await this.db.from("staff_users").select("*").eq("id", id).maybeSingle();
    return data ? camel<StaffUser>(data) : null;
  }
}

function must(res: { data: unknown; error: { message: string } | null }): Row[] {
  if (res.error) throw new Error(res.error.message);
  return (res.data as Row[] | null) ?? [];
}

function toClinic(r: Row): Clinic {
  return camel<Clinic>(r);
}

function toPatient(r: Row): Patient {
  delete r.whatsapp_opt_in_at;
  return camel<Patient>(r);
}

function camel<T>(row: Row): T {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())] = v;
  }
  return out as T;
}

function snake(obj: object): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue;
    out[k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)] = v;
  }
  return out;
}
