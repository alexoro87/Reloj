import { NextResponse, type NextRequest } from "next/server";
import { getAvailability } from "@/lib/booking";
import { getRepo } from "@/lib/db";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const slug = q.get("clinic") ?? "";
  const practitionerId = q.get("practitioner") ?? "";
  const serviceId = q.get("service") ?? "";
  const date = q.get("date") ?? "";
  const token = q.get("token");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
  }
  const repo = getRepo();
  const clinic = await repo.getClinicBySlug(slug);
  if (!clinic) return NextResponse.json({ error: "Clínica no encontrada" }, { status: 404 });

  // Al reprogramar, la cita actual no debe bloquear su propio horario.
  let ignoreAppointmentId: string | undefined;
  if (token) {
    const appt = await repo.getAppointmentByToken(token);
    if (appt?.clinicId === clinic.id) ignoreAppointmentId = appt.id;
  }

  const slots = await getAvailability(clinic, { practitionerId, serviceId, date, ignoreAppointmentId });
  return NextResponse.json({ slots }, { headers: { "Cache-Control": "no-store" } });
}
