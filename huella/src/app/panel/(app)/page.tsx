import type { Metadata } from "next";
import Link from "next/link";
import { IconArrowLeft, IconArrowRight, IconPlus } from "@/components/icons";
import { Avatar, buttonClass, Card, cx } from "@/components/ui";
import { requireSession } from "@/lib/auth";
import { getRepo } from "@/lib/db";
import {
  addDays,
  capitalize,
  formatDay,
  formatTime,
  timeToMinutes,
  todayIn,
  weekdayOf,
  zonedParts,
  zonedToUtc,
} from "@/lib/time";
import type { AppointmentStatus } from "@/lib/types";

export const metadata: Metadata = { title: "Agenda" };

const HOUR_PX = 72;

const blockStyles: Record<AppointmentStatus, string> = {
  booked: "bg-warn-soft/80 border-warn",
  confirmed: "bg-ok-soft border-ok",
  completed: "bg-brand-soft border-brand",
  cancelled: "bg-danger-soft/60 border-danger opacity-60 line-through",
  no_show: "bg-sunken border-ink-mute opacity-70",
};

export default async function AgendaPage(props: PageProps<"/panel">) {
  const { clinic } = await requireSession();
  const q = await props.searchParams;
  const today = todayIn(clinic.timezone);
  const date = typeof q.fecha === "string" && /^\d{4}-\d{2}-\d{2}$/.test(q.fecha) ? q.fecha : today;

  const repo = getRepo();
  const from = zonedToUtc(date, "00:00", clinic.timezone).toISOString();
  const to = zonedToUtc(addDays(date, 1), "00:00", clinic.timezone).toISOString();
  const [practitioners, services, hours, appointments] = await Promise.all([
    repo.listPractitioners(clinic.id),
    repo.listServices(clinic.id),
    repo.listWorkingHours(clinic.id),
    repo.listAppointments(clinic.id, { from, to, includeCancelled: true }),
  ]);
  const patients = await repo.listPatients(clinic.id, [...new Set(appointments.map((a) => a.patientId))]);
  const active = practitioners.filter((p) => p.active);

  const weekday = weekdayOf(date);
  const todays = hours.filter((h) => h.weekday === weekday);
  const startHour = Math.min(8, ...todays.map((h) => Math.floor(timeToMinutes(h.start) / 60)));
  const endHour = Math.max(20, ...todays.map((h) => Math.ceil(timeToMinutes(h.end) / 60)));
  const gridHeight = (endHour - startHour) * HOUR_PX;
  const top = (iso: string) => ((zonedParts(iso, clinic.timezone).minutes - startHour * 60) / 60) * HOUR_PX;

  const live = appointments.filter((a) => a.status !== "cancelled");
  const stats = [
    { label: "Citas", value: live.length },
    { label: "Confirmadas", value: live.filter((a) => a.status === "confirmed").length, tone: "text-ok" },
    { label: "Por confirmar", value: live.filter((a) => a.status === "booked").length, tone: "text-warn" },
    {
      label: "Canceladas",
      value: appointments.filter((a) => a.status === "cancelled").length,
      tone: "text-danger",
    },
  ];

  const now = new Date();
  const nowParts = zonedParts(now, clinic.timezone);
  const showNow = date === today && nowParts.minutes >= startHour * 60 && nowParts.minutes <= endHour * 60;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-ink-mute">{date === today ? "Hoy" : "Agenda"}</p>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            {capitalize(formatDay(date, { weekday: "long", day: "numeric", month: "long" }))}
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/panel?fecha=${addDays(date, -1)}`} className={buttonClass("secondary", "sm")} aria-label="Día anterior">
            <IconArrowLeft width={18} height={18} />
          </Link>
          {date !== today && (
            <Link href="/panel" className={buttonClass("secondary", "sm")}>
              Hoy
            </Link>
          )}
          <Link href={`/panel?fecha=${addDays(date, 1)}`} className={buttonClass("secondary", "sm")} aria-label="Día siguiente">
            <IconArrowRight width={18} height={18} />
          </Link>
          <Link href="/panel/nueva" className={cx(buttonClass("primary", "sm"), "hidden sm:inline-flex")}>
            <IconPlus width={18} height={18} /> Nueva cita
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="p-4">
            <p className="text-sm text-ink-mute">{s.label}</p>
            <p className={cx("mt-1 text-3xl font-semibold tabular-nums", s.tone)}>{s.value}</p>
          </Card>
        ))}
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-fit">
            {/* Cabecera de columnas */}
            <div className="sticky top-0 z-10 flex border-b border-line bg-surface">
              <div className="w-14 shrink-0" />
              {active.map((p) => {
                const count = live.filter((a) => a.practitionerId === p.id).length;
                return (
                  <div key={p.id} className="flex min-w-56 flex-1 items-center gap-2.5 border-l border-line px-3 py-3">
                    <Avatar name={p.name} color={p.color} size={32} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{p.name}</p>
                      <p className="text-xs text-ink-mute">
                        {count} {count === 1 ? "cita" : "citas"}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Rejilla */}
            <div className="relative flex" style={{ height: gridHeight }}>
              <div className="relative w-14 shrink-0">
                {Array.from({ length: endHour - startHour }, (_, i) => (
                  <span
                    key={i}
                    className="absolute right-2 -translate-y-1/2 text-xs text-ink-mute tabular-nums"
                    style={{ top: i * HOUR_PX }}
                  >
                    {i === 0 ? "" : `${String(startHour + i).padStart(2, "0")}:00`}
                  </span>
                ))}
              </div>

              {active.map((p) => {
                const ranges = todays.filter((h) => h.practitionerId === p.id);
                return (
                  <div key={p.id} className="relative min-w-56 flex-1 border-l border-line bg-sunken/50">
                    {ranges.map((r) => (
                      <div
                        key={r.start}
                        className="absolute inset-x-0 bg-surface"
                        style={{
                          top: ((timeToMinutes(r.start) - startHour * 60) / 60) * HOUR_PX,
                          height: ((timeToMinutes(r.end) - timeToMinutes(r.start)) / 60) * HOUR_PX,
                        }}
                      />
                    ))}
                    {Array.from({ length: endHour - startHour }, (_, i) => (
                      <div key={i} className="absolute inset-x-0 border-t border-line/70" style={{ top: i * HOUR_PX }} />
                    ))}
                    {appointments
                      .filter((a) => a.practitionerId === p.id)
                      .map((a) => {
                        const patient = patients.find((pt) => pt.id === a.patientId);
                        const service = services.find((s) => s.id === a.serviceId);
                        const height = Math.max(
                          30,
                          ((new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 3_600_000) * HOUR_PX - 3,
                        );
                        return (
                          <Link
                            key={a.id}
                            href={`/panel/cita/${a.id}`}
                            className={cx(
                              "absolute inset-x-1.5 overflow-hidden rounded-lg border-l-4 px-2.5 py-1 text-xs transition hover:z-10 hover:shadow-[var(--shadow-pop)]",
                              blockStyles[a.status],
                              a.status === "cancelled" && "z-0",
                            )}
                            style={{ top: top(a.startsAt) + 1, height }}
                          >
                            {height < 50 ? (
                              <p className="truncate">
                                <span className="font-semibold text-ink">{patient?.name ?? "Paciente"}</span>
                                <span className="text-ink-soft"> · {formatTime(a.startsAt, clinic.timezone)} · {service?.name}</span>
                              </p>
                            ) : (
                              <>
                                <p className="truncate font-semibold text-ink">{patient?.name ?? "Paciente"}</p>
                                <p className="truncate text-ink-soft">
                                  {formatTime(a.startsAt, clinic.timezone)} · {service?.name}
                                </p>
                              </>
                            )}
                          </Link>
                        );
                      })}
                  </div>
                );
              })}

              {showNow && (
                <div
                  className="pointer-events-none absolute right-0 left-14 z-20 border-t-2 border-accent"
                  style={{ top: ((nowParts.minutes - startHour * 60) / 60) * HOUR_PX }}
                >
                  <span className="absolute -top-1.5 -left-1.5 h-3 w-3 rounded-full bg-accent" />
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      <div className="flex flex-wrap gap-4 text-xs text-ink-mute">
        <Legend cls="border-warn bg-warn-soft" label="Por confirmar" />
        <Legend cls="border-ok bg-ok-soft" label="Confirmada" />
        <Legend cls="border-brand bg-brand-soft" label="Atendida" />
        <Legend cls="border-danger bg-danger-soft" label="Cancelada" />
      </div>
    </div>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cx("h-3 w-3 rounded-sm border-l-4", cls)} /> {label}
    </span>
  );
}
