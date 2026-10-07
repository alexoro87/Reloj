import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IconArrowLeft, IconCalendar, IconCheck, IconWhatsApp } from "@/components/icons";
import { Avatar, Button, buttonClass, Card, cx, StatusBadge } from "@/components/ui";
import { MessageBubble } from "@/components/message-bubble";
import { requireSession } from "@/lib/auth";
import { loadContext } from "@/lib/booking";
import { getRepo } from "@/lib/db";
import { isClinicConnected } from "@/lib/integrations/google";
import { formatPhone } from "@/lib/phone";
import { capitalize, formatDay, formatTime } from "@/lib/time";
import { appointmentAction } from "../../../actions";

export const metadata: Metadata = { title: "Cita" };

const sourceLabel = { online: "Reserva en línea", reception: "Recepción", follow_up: "Seguimiento" };

export default async function AppointmentDetail(props: PageProps<"/panel/cita/[id]">) {
  const { clinic } = await requireSession();
  const { id } = await props.params;
  const q = await props.searchParams;
  const repo = getRepo();
  const appt = await repo.getAppointment(id);
  if (!appt || appt.clinicId !== clinic.id) notFound();
  const ctx = await loadContext(appt);
  const { patient, practitioner, service } = ctx;
  const [messages, followUps] = await Promise.all([repo.listMessages(clinic.id, 200), repo.listFollowUps(clinic.id)]);
  const own = messages.filter((m) => m.appointmentId === appt.id).reverse();
  const followUp = followUps.find((f) => f.sourceAppointmentId === appt.id);

  const active = appt.status === "booked" || appt.status === "confirmed";
  const act = (a: Parameters<typeof appointmentAction>[1]) => appointmentAction.bind(null, appt.id, a);
  const dateLink = new Intl.DateTimeFormat("en-CA", { timeZone: clinic.timezone }).format(new Date(appt.startsAt));

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href={`/panel?fecha=${dateLink}`}
        className="-ml-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-soft hover:bg-sunken"
      >
        <IconArrowLeft width={18} height={18} /> Agenda
      </Link>

      {q.nueva && (
        <div className="flex animate-rise items-center gap-3 rounded-[var(--radius-card)] bg-ok-soft p-4 text-ok">
          <IconCheck /> <span className="font-semibold">Cita guardada.</span>
        </div>
      )}

      <Card className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <StatusBadge status={appt.status} />
            <h1 className="mt-3 text-2xl font-semibold tracking-tight">{patient.name}</h1>
            <p className="text-ink-soft">
              {service.name} · {service.durationMin} min
            </p>
          </div>
          <a
            href={`https://wa.me/${patient.phone}`}
            target="_blank"
            rel="noreferrer"
            className={buttonClass("whatsapp", "sm")}
          >
            <IconWhatsApp width={18} height={18} /> {formatPhone(patient.phone)}
          </a>
        </div>

        <dl className="mt-6 grid gap-4 border-t border-line pt-5 text-sm sm:grid-cols-2">
          <Item label="Fecha">
            {capitalize(formatDay(dateLink, { weekday: "long", day: "numeric", month: "long" }))} ·{" "}
            {formatTime(appt.startsAt, clinic.timezone)}–{formatTime(appt.endsAt, clinic.timezone)}
          </Item>
          <Item label="Podólogo">
            <span className="inline-flex items-center gap-2">
              <Avatar name={practitioner.name} color={practitioner.color} size={22} /> {practitioner.name}
            </span>
          </Item>
          <Item label="Origen">{sourceLabel[appt.source]}</Item>
          <Item label="Avisos por WhatsApp">{patient.whatsappOptIn ? "Aceptados" : "No aceptados"}</Item>
          <Item label="Recordatorio">
            {appt.reminderSentAt
              ? `Enviado ${formatDay(new Intl.DateTimeFormat("en-CA", { timeZone: clinic.timezone }).format(new Date(appt.reminderSentAt)), { day: "numeric", month: "short" })} ${formatTime(appt.reminderSentAt, clinic.timezone)}`
              : "Pendiente"}
          </Item>
          <Item label="Google Calendar">
            {appt.googleEventId ? "Sincronizada" : isClinicConnected(clinic) ? "Sin evento" : "Google no conectado"}
          </Item>
          {appt.notes && <Item label="Nota interna">{appt.notes}</Item>}
          {followUp && (
            <Item label="Próxima revisión">
              {capitalize(formatDay(followUp.dueDate, { weekday: "long", day: "numeric", month: "long" }))}
            </Item>
          )}
        </dl>
      </Card>

      {active && (
        <Card className="p-5">
          <p className="mb-3 text-sm font-semibold text-ink-mute">Acciones</p>
          <div className="flex flex-wrap gap-2">
            {appt.status === "booked" && (
              <form action={act("confirm")}>
                <Button size="sm">
                  <IconCheck width={18} height={18} /> Confirmar
                </Button>
              </form>
            )}
            <form action={act("complete")}>
              <Button size="sm" variant="secondary">
                Marcar atendida
              </Button>
            </form>
            <form action={act("no_show")}>
              <Button size="sm" variant="secondary">
                No asistió
              </Button>
            </form>
            {patient.whatsappOptIn && (
              <form action={act("remind")}>
                <Button size="sm" variant="secondary">
                  <IconWhatsApp width={16} height={16} className="text-whatsapp" />
                  {appt.reminderSentAt ? "Reenviar recordatorio" : "Enviar recordatorio"}
                </Button>
              </form>
            )}
            <Link href={`/cita/${appt.manageToken}/cambiar`} className={buttonClass("secondary", "sm")}>
              <IconCalendar width={16} height={16} /> Cambiar fecha
            </Link>
            <form action={act("cancel")}>
              <Button size="sm" variant="danger">
                Cancelar cita
              </Button>
            </form>
          </div>
          {service.followUpWeeks && (
            <p className="mt-3 text-xs text-ink-mute">
              Al marcarla como atendida se programará una revisión en {service.followUpWeeks} semanas.
            </p>
          )}
        </Card>
      )}

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold text-ink-mute">Conversación de WhatsApp</p>
          <Link href={`/cita/${appt.manageToken}`} target="_blank" className="text-sm font-semibold text-brand hover:underline">
            Ver como paciente ↗
          </Link>
        </div>
        {own.length === 0 ? (
          <p className="text-sm text-ink-mute">Aún no hay mensajes para esta cita.</p>
        ) : (
          <div className={cx("space-y-3 rounded-2xl bg-[#efe8dc] p-4")}>
            {own.map((m) => (
              <MessageBubble key={m.id} message={m} timezone={clinic.timezone} />
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-ink-mute">{label}</dt>
      <dd className="mt-0.5 font-medium text-ink">{children}</dd>
    </div>
  );
}
