import { loadContext } from "@/lib/booking";
import { getRepo } from "@/lib/db";

export async function GET(_req: Request, ctx: RouteContext<"/api/cita/[token]/ics">) {
  const { token } = await ctx.params;
  const appt = await getRepo().getAppointmentByToken(token);
  if (!appt) return new Response("No encontrada", { status: 404 });
  const { clinic, practitioner, service } = await loadContext(appt);

  const stamp = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const esc = (s: string) => s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Huella//Citas//ES",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${appt.id}@huella`,
    `DTSTAMP:${stamp(new Date().toISOString())}`,
    `DTSTART:${stamp(appt.startsAt)}`,
    `DTEND:${stamp(appt.endsAt)}`,
    `SUMMARY:${esc(`${service.name} · ${clinic.name}`)}`,
    `DESCRIPTION:${esc(`Con ${practitioner.name}.`)}`,
    clinic.address ? `LOCATION:${esc(clinic.address)}` : "",
    appt.status === "cancelled" ? "STATUS:CANCELLED" : "STATUS:CONFIRMED",
    "BEGIN:VALARM",
    "TRIGGER:-PT2H",
    "ACTION:DISPLAY",
    "DESCRIPTION:Recordatorio de cita",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");

  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="cita-${clinic.slug}.ics"`,
    },
  });
}
