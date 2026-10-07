import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ClinicHeader } from "@/components/clinic-header";
import { IconCalendar, IconCheck, IconClock, IconPin, IconX } from "@/components/icons";
import { Avatar, Button, buttonClass, Card, cx, formatPrice, StatusBadge } from "@/components/ui";
import { loadContext } from "@/lib/booking";
import { getRepo } from "@/lib/db";
import { capitalize } from "@/lib/time";
import { patientCancel, patientConfirm } from "./actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tu cita", robots: { index: false } };

export default async function ManageAppointmentPage(props: PageProps<"/cita/[token]">) {
  const { token } = await props.params;
  const q = await props.searchParams;
  const appt = await getRepo().getAppointmentByToken(token);
  if (!appt) notFound();
  const ctx = await loadContext(appt);
  const { clinic, practitioner, service } = ctx;

  const active = appt.status === "booked" || appt.status === "confirmed";
  const isPast = new Date(appt.startsAt) < new Date();
  const canChange = active && !isPast;
  const intent = typeof q.accion === "string" ? q.accion : null;

  const banner = q.nueva
    ? { tone: "ok", title: "¡Cita reservada!", text: "Te esperamos. Guarda esta página para gestionar tu cita." }
    : q.cambiada
      ? { tone: "ok", title: "Cita cambiada", text: "Actualizamos tu cita con la nueva fecha." }
      : q.confirmada
        ? { tone: "ok", title: "¡Gracias por confirmar!", text: "Tu cita quedó confirmada." }
        : q.cancelada
          ? { tone: "info", title: "Cita cancelada", text: "Cuando quieras, puedes reservar otra fecha." }
          : null;

  const publicClinic = {
    id: clinic.id,
    slug: clinic.slug,
    name: clinic.name,
    timezone: clinic.timezone,
    phone: clinic.phone,
    address: clinic.address,
    bookingHorizonDays: clinic.bookingHorizonDays,
  };

  return (
    <main className="flex-1 pb-16">
      <ClinicHeader clinic={publicClinic} />
      <div className="mx-auto w-full max-w-2xl space-y-5 px-4">
        {banner && (
          <div
            className={cx(
              "flex animate-rise items-start gap-3 rounded-[var(--radius-card)] p-5",
              banner.tone === "ok" ? "bg-ok-soft" : "bg-sunken",
            )}
          >
            <span
              className={cx(
                "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-white",
                banner.tone === "ok" ? "bg-ok" : "bg-ink-soft",
              )}
            >
              {banner.tone === "ok" ? <IconCheck /> : <IconX />}
            </span>
            <div>
              <p className="text-lg font-semibold">{banner.title}</p>
              <p className="text-ink-soft">{banner.text}</p>
            </div>
          </div>
        )}

        <Card className="overflow-hidden">
          <div className="p-6">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-ink-mute">Tu cita</p>
              <StatusBadge status={appt.status} />
            </div>
            <p className={cx("mt-3 text-2xl font-semibold tracking-tight", !active && "text-ink-mute line-through")}>
              {capitalize(ctx.dateText)}
            </p>
            <p className="mt-1 flex items-center gap-2 text-lg font-medium text-ink-soft">
              <IconClock width={18} height={18} /> {ctx.timeText} h · {service.durationMin} min
            </p>
          </div>
          <div className="space-y-4 border-t border-line bg-sunken/40 p-6">
            <div className="flex items-center gap-3">
              <Avatar name={practitioner.name} color={practitioner.color} size={40} />
              <div>
                <p className="font-semibold">{service.name}</p>
                <p className="text-sm text-ink-soft">
                  con {practitioner.name}
                  {formatPrice(service.priceCents) ? ` · ${formatPrice(service.priceCents)}` : ""}
                </p>
              </div>
            </div>
            {clinic.address && (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(clinic.address)}`}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 text-sm text-ink-soft hover:text-ink"
              >
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-surface">
                  <IconPin />
                </span>
                {clinic.address}
              </a>
            )}
          </div>
        </Card>

        {canChange && intent === "cancelar" && (
          <Card className="animate-rise border border-danger/20 p-6">
            <p className="text-lg font-semibold">¿Seguro que quieres cancelar?</p>
            <p className="mt-1 text-ink-soft">
              Liberaremos tu horario para otro paciente. Si solo necesitas otra fecha, mejor cámbiala.
            </p>
            <div className="mt-5 grid gap-2 sm:grid-cols-2">
              <form action={patientCancel.bind(null, token)}>
                <Button variant="danger" className="w-full">Sí, cancelar cita</Button>
              </form>
              <Link href={`/cita/${token}/cambiar`} className={buttonClass("secondary")}>
                Mejor cambiar fecha
              </Link>
            </div>
          </Card>
        )}

        {canChange && intent !== "cancelar" && (
          <div className="grid gap-2 sm:grid-cols-3">
            {appt.status === "booked" && (
              <form action={patientConfirm.bind(null, token)} className="sm:col-span-3">
                <Button size="lg" className={cx("w-full", intent === "confirmar" && "ring-4 ring-brand/20")}>
                  <IconCheck /> Confirmar asistencia
                </Button>
              </form>
            )}
            <Link href={`/cita/${token}/cambiar`} className={buttonClass("secondary")}>
              Cambiar fecha
            </Link>
            <a href={`/api/cita/${token}/ics`} className={buttonClass("secondary")}>
              <IconCalendar width={18} height={18} /> Añadir a mi calendario
            </a>
            <Link href={`/cita/${token}?accion=cancelar`} className={buttonClass("ghost")}>
              Cancelar cita
            </Link>
          </div>
        )}

        {!canChange && (
          <Link href={`/c/${clinic.slug}`} className={buttonClass("primary", "lg") + " w-full"}>
            Reservar otra cita
          </Link>
        )}
      </div>
    </main>
  );
}
