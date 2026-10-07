"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { bookAppointmentAction, rescheduleAction } from "@/app/actions/booking";
import type { PractitionerService, PublicClinic } from "@/lib/types";
import {
  IconArrowLeft,
  IconArrowRight,
  IconCalendar,
  IconCheck,
  IconClock,
  IconSparkle,
  IconWhatsApp,
} from "./icons";
import { Avatar, Button, Card, cx, Field, formatPrice, inputClass } from "./ui";

export interface FlowPractitioner {
  id: string;
  name: string;
  title: string | null;
  bio: string | null;
  color: string;
  workdays: number[];
}

export interface FlowService {
  id: string;
  name: string;
  description: string | null;
  durationMin: number;
  priceCents: number | null;
}

export type FlowMode =
  | { type: "new" }
  | { type: "reception" }
  | { type: "reschedule"; token: string; serviceId: string; practitionerId: string };

interface Props {
  clinic: PublicClinic;
  practitioners: FlowPractitioner[];
  services: FlowService[];
  links: PractitionerService[];
  today: string;
  mode: FlowMode;
  initial?: { practitionerId?: string; serviceId?: string };
}

type Step = "who" | "what" | "when" | "details";
interface Slot {
  start: string;
  practitionerId: string;
}

const ANY = "any";

export function BookingFlow({ clinic, practitioners, services, links, today, mode, initial }: Props) {
  const router = useRouter();
  const isReschedule = mode.type === "reschedule";
  const isReception = mode.type === "reception";

  const [practitionerId, setPractitionerId] = useState<string | null>(
    isReschedule ? mode.practitionerId : (initial?.practitionerId ?? null),
  );
  const [serviceId, setServiceId] = useState<string | null>(
    isReschedule ? mode.serviceId : (initial?.serviceId ?? null),
  );
  const [step, setStep] = useState<Step>(() => {
    if (isReschedule) return "when";
    if (initial?.practitionerId && initial?.serviceId) return "when";
    if (initial?.practitionerId) return "what";
    return "who";
  });
  const [pickedDate, setDate] = useState<string>(today);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [slotsResult, setSlotsResult] = useState<{ key: string; slots: Slot[]; error: string | null } | null>(
    null,
  );
  const [reloadKey, setReloadKey] = useState(0);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const practitioner = practitioners.find((p) => p.id === practitionerId) ?? null;
  const service = services.find((s) => s.id === serviceId) ?? null;
  const slotPractitioner = practitioners.find((p) => p.id === slot?.practitionerId) ?? null;

  const availableServices = useMemo(
    () =>
      services.filter((s) =>
        links.some(
          (l) => l.serviceId === s.id && (practitionerId === ANY || l.practitionerId === practitionerId),
        ),
      ),
    [services, links, practitionerId],
  );

  const days = useMemo(() => {
    const workdays = new Set(
      practitionerId === ANY || !practitionerId
        ? practitioners.flatMap((p) => p.workdays)
        : (practitioner?.workdays ?? []),
    );
    return Array.from({ length: clinic.bookingHorizonDays + 1 }, (_, i) => {
      const d = addDays(today, i);
      return { date: d, open: workdays.has(weekdayOf(d)) };
    });
  }, [clinic.bookingHorizonDays, practitioner, practitionerId, practitioners, today]);

  // Si el día elegido no tiene horario (p. ej. hoy es domingo), se usa el primer día abierto.
  const date = days.find((d) => d.date === pickedDate)?.open
    ? pickedDate
    : (days.find((d) => d.open)?.date ?? pickedDate);

  const slotsKey =
    step === "when" && practitionerId && serviceId
      ? `${practitionerId}|${serviceId}|${date}|${reloadKey}`
      : null;
  const slots = slotsResult && slotsResult.key === slotsKey ? slotsResult.slots : null;
  const slotsError = slotsResult && slotsResult.key === slotsKey ? slotsResult.error : null;

  useEffect(() => {
    if (!slotsKey) return;
    const [pid, sid, day] = slotsKey.split("|");
    const controller = new AbortController();
    const params = new URLSearchParams({ clinic: clinic.slug, practitioner: pid, service: sid, date: day });
    if (mode.type === "reschedule") params.set("token", mode.token);
    fetch(`/api/slots?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d: { slots?: Slot[]; error?: string }) =>
        setSlotsResult({ key: slotsKey, slots: d.slots ?? [], error: d.error ?? null }),
      )
      .catch((e: Error) => {
        if (e.name !== "AbortError") {
          setSlotsResult({ key: slotsKey, slots: [], error: "No pudimos cargar los horarios." });
        }
      });
    return () => controller.abort();
  }, [slotsKey, clinic.slug, mode]);

  const fmtTime = (iso: string) =>
    new Intl.DateTimeFormat("es-MX", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: clinic.timezone,
    }).format(new Date(iso));

  const hourOf = (iso: string) => Number(fmtTime(iso).slice(0, 2));

  function chooseSlot(s: Slot) {
    setSlot(s);
    if (isReschedule) return;
    setStep("details");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function back() {
    setFormError(null);
    if (step === "details") setStep("when");
    else if (step === "when") setStep(isReschedule ? "when" : "what");
    else if (step === "what") setStep("who");
  }

  function submit() {
    if (!slot || !serviceId) return;
    setFormError(null);
    setFieldErrors({});
    startTransition(async () => {
      const res = isReschedule
        ? await rescheduleAction({ token: mode.token, practitionerId: practitionerId!, start: slot.start })
        : await bookAppointmentAction({
            slug: clinic.slug,
            practitionerId: slot.practitionerId,
            serviceId,
            start: slot.start,
            name,
            phone,
            email,
            whatsappOptIn: optIn,
            notes: isReception ? notes : undefined,
            reception: isReception,
          });
      if (res.ok) {
        if (isReception) router.push(`/panel/cita/${res.appointmentId}?nueva=1`);
        else router.push(`/cita/${res.token}?${isReschedule ? "cambiada" : "nueva"}=1`);
        return;
      }
      setFormError(res.error);
      setFieldErrors(res.fieldErrors ?? {});
      if (res.slotTaken) {
        setSlot(null);
        setStep("when");
        setReloadKey((k) => k + 1);
      }
    });
  }

  const stepIndex = { who: 0, what: 1, when: 2, details: 3 }[step];
  const stepTitles = isReschedule
    ? null
    : ["Podólogo", "Servicio", "Fecha y hora", "Tus datos"];

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pb-32">
      {stepTitles && (
        <nav aria-label="Pasos" className="mb-6 flex items-center gap-2">
          {stepTitles.map((t, i) => (
            <div key={t} className="flex-1">
              <div
                className={cx(
                  "h-1.5 rounded-full transition-colors",
                  i <= stepIndex ? "bg-brand" : "bg-line",
                )}
              />
              <p
                className={cx(
                  "mt-2 hidden text-xs font-medium sm:block",
                  i === stepIndex ? "text-ink" : "text-ink-mute",
                )}
              >
                {t}
              </p>
            </div>
          ))}
        </nav>
      )}

      {step !== "who" && !(isReschedule && step === "when") && (
        <button
          type="button"
          onClick={back}
          className="mb-4 -ml-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-sm font-medium text-ink-soft hover:bg-sunken"
        >
          <IconArrowLeft width={18} height={18} /> Atrás
        </button>
      )}

      {step === "who" && (
        <section className="animate-rise" key="who">
          <h2 className="text-2xl font-semibold tracking-tight">¿Con quién quieres tu cita?</h2>
          <p className="mt-1 text-ink-soft">Elige a tu podólogo o deja que te asignemos el primero libre.</p>
          <div className="mt-6 grid gap-3">
            <OptionCard
              selected={practitionerId === ANY}
              onClick={() => {
                setPractitionerId(ANY);
                setServiceId(null);
                setSlot(null);
                setStep("what");
              }}
            >
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
                <IconSparkle />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">Primer podólogo disponible</span>
                <span className="block text-sm text-ink-soft">Más horarios para elegir</span>
              </span>
            </OptionCard>
            {practitioners.map((p) => (
              <OptionCard
                key={p.id}
                selected={practitionerId === p.id}
                onClick={() => {
                  setPractitionerId(p.id);
                  if (serviceId && !links.some((l) => l.practitionerId === p.id && l.serviceId === serviceId)) {
                    setServiceId(null);
                  }
                  setSlot(null);
                  setStep("what");
                }}
              >
                <Avatar name={p.name} color={p.color} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{p.name}</span>
                  <span className="block text-sm text-ink-soft">{p.title}</span>
                  {p.bio && <span className="mt-0.5 block text-sm text-ink-mute">{p.bio}</span>}
                </span>
              </OptionCard>
            ))}
          </div>
        </section>
      )}

      {step === "what" && (
        <section className="animate-rise" key="what">
          <h2 className="text-2xl font-semibold tracking-tight">¿Qué necesitas?</h2>
          <p className="mt-1 text-ink-soft">
            {practitioner ? `Servicios que ofrece ${practitioner.name}.` : "Elige el motivo de tu visita."}
          </p>
          <div className="mt-6 grid gap-3">
            {availableServices.map((s) => (
              <OptionCard
                key={s.id}
                selected={serviceId === s.id}
                onClick={() => {
                  setServiceId(s.id);
                  setSlot(null);
                  setStep("when");
                }}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{s.name}</span>
                  {s.description && <span className="block text-sm text-ink-soft">{s.description}</span>}
                  <span className="mt-1.5 flex items-center gap-3 text-sm text-ink-mute">
                    <span className="inline-flex items-center gap-1">
                      <IconClock width={16} height={16} /> {s.durationMin} min
                    </span>
                    {formatPrice(s.priceCents) && <span>{formatPrice(s.priceCents)}</span>}
                  </span>
                </span>
                <IconArrowRight className="text-ink-mute" />
              </OptionCard>
            ))}
          </div>
        </section>
      )}

      {step === "when" && (
        <section className="animate-rise" key="when">
          <h2 className="text-2xl font-semibold tracking-tight">
            {isReschedule ? "Elige tu nueva fecha" : "¿Cuándo te viene bien?"}
          </h2>
          <p className="mt-1 text-ink-soft">
            {service?.name} · {service?.durationMin} min
            {practitioner ? ` · ${practitioner.name}` : " · Primer podólogo disponible"}
          </p>
          {isReschedule && (
            <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar">
              {practitioners
                .filter((p) => links.some((l) => l.practitionerId === p.id && l.serviceId === serviceId))
                .map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setPractitionerId(p.id);
                      setSlot(null);
                    }}
                    className={cx(
                      "flex shrink-0 items-center gap-2 rounded-full border py-1.5 pr-4 pl-1.5 text-sm font-medium transition",
                      p.id === practitionerId
                        ? "border-brand bg-brand-soft text-brand-strong"
                        : "border-line bg-surface text-ink-soft hover:border-ink-mute/40",
                    )}
                  >
                    <Avatar name={p.name} color={p.color} size={28} /> {p.name}
                  </button>
                ))}
            </div>
          )}

          <DayStrip days={days} selected={date} onSelect={(d) => { setDate(d); setSlot(null); }} />

          <div className="mt-6 min-h-48">
            {slots === null && !slotsError && <SlotsSkeleton />}
            {slotsError && <p className="text-danger">{slotsError}</p>}
            {slots && slots.length === 0 && !slotsError && (
              <Card className="p-6 text-center">
                <IconCalendar className="mx-auto text-ink-mute" width={28} height={28} />
                <p className="mt-2 font-semibold">No quedan horarios este día</p>
                <p className="text-sm text-ink-soft">Prueba con otra fecha{practitionerId !== ANY && !isReschedule ? " o con «primer podólogo disponible»" : ""}.</p>
                {(() => {
                  const next = days.find((d) => d.open && d.date > date);
                  return next ? (
                    <Button variant="secondary" size="sm" className="mt-4" onClick={() => setDate(next.date)}>
                      Ver {formatDayShort(next.date)}
                    </Button>
                  ) : null;
                })()}
              </Card>
            )}
            {slots && slots.length > 0 && (
              <div className="space-y-6">
                {[
                  { label: "Mañana", items: slots.filter((s) => hourOf(s.start) < 12) },
                  { label: "Tarde", items: slots.filter((s) => hourOf(s.start) >= 12 && hourOf(s.start) < 19) },
                  { label: "Noche", items: slots.filter((s) => hourOf(s.start) >= 19) },
                ]
                  .filter((g) => g.items.length > 0)
                  .map((g) => (
                    <div key={g.label}>
                      <h3 className="mb-2 text-sm font-semibold text-ink-mute">{g.label}</h3>
                      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                        {g.items.map((s) => {
                          const selected = slot?.start === s.start;
                          return (
                            <button
                              key={s.start}
                              type="button"
                              onClick={() => chooseSlot(s)}
                              className={cx(
                                "h-12 rounded-xl border text-base font-semibold tabular-nums transition",
                                selected
                                  ? "border-brand bg-brand text-white shadow-sm"
                                  : "border-line bg-surface hover:border-brand hover:text-brand",
                              )}
                            >
                              {fmtTime(s.start)}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
          {formError && <p className="mt-4 rounded-xl bg-danger-soft p-3 text-sm text-danger">{formError}</p>}
        </section>
      )}

      {step === "details" && slot && service && (
        <section className="animate-rise" key="details">
          <h2 className="text-2xl font-semibold tracking-tight">
            {isReception ? "Datos del paciente" : "Ya casi está"}
          </h2>
          <p className="mt-1 text-ink-soft">
            {isReception ? "La cita se guardará como agendada por recepción." : "Solo necesitamos unos datos para reservar."}
          </p>

          <Summary
            serviceName={service.name}
            practitionerName={slotPractitioner?.name ?? ""}
            practitionerColor={slotPractitioner?.color ?? "#999"}
            when={`${capitalize(formatDayLong(slot.start, clinic.timezone))} · ${fmtTime(slot.start)}`}
            duration={service.durationMin}
            price={formatPrice(service.priceCents)}
            onChange={() => setStep("when")}
          />

          <form
            className="mt-6 space-y-5"
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
          >
            <Field label="Nombre y apellido" error={fieldErrors.name}>
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                placeholder="María González"
                required
              />
            </Field>
            <Field
              label="Celular (WhatsApp)"
              error={fieldErrors.phone}
              hint={isReception ? undefined : "Te enviaremos aquí la confirmación y el recordatorio."}
            >
              <input
                className={inputClass}
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="55 1234 5678"
                required
              />
            </Field>
            <Field label="Correo electrónico (opcional)" error={fieldErrors.email}>
              <input
                className={inputClass}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="maria@correo.com"
              />
            </Field>
            {isReception && (
              <Field label="Nota interna (opcional)">
                <textarea
                  className={cx(inputClass, "h-24 py-3")}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ej. viene derivado por su médico"
                />
              </Field>
            )}

            <label
              className={cx(
                "flex cursor-pointer gap-3 rounded-2xl border p-4 transition",
                optIn ? "border-whatsapp/50 bg-whatsapp/5" : "border-line bg-surface",
              )}
            >
              <input
                type="checkbox"
                checked={optIn}
                onChange={(e) => setOptIn(e.target.checked)}
                className="mt-0.5 h-5 w-5 shrink-0 accent-whatsapp"
              />
              <span className="text-sm">
                <span className="flex items-center gap-1.5 font-semibold text-ink">
                  <IconWhatsApp width={18} height={18} className="text-whatsapp" />
                  {isReception ? "El paciente acepta avisos por WhatsApp" : "Quiero recibir avisos por WhatsApp"}
                </span>
                <span className="mt-0.5 block text-ink-soft">
                  Confirmación, recordatorio un día antes con opción de confirmar, cambiar o cancelar, y
                  aviso cuando toque tu próxima revisión. Puedes darte de baja cuando quieras.
                </span>
              </span>
            </label>

            {formError && <p className="rounded-xl bg-danger-soft p-3 text-sm text-danger">{formError}</p>}

            <p className="text-xs text-ink-mute">
              Al reservar aceptas que {clinic.name} trate tus datos para gestionar tu cita.
            </p>

            <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-canvas/90 p-4 backdrop-blur sm:static sm:border-0 sm:bg-transparent sm:p-0">
              <Button type="submit" size="lg" className="w-full" disabled={pending}>
                {pending ? "Reservando…" : isReception ? "Guardar cita" : "Confirmar cita"}
              </Button>
            </div>
          </form>
        </section>
      )}

      {isReschedule && step === "when" && (
        <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-canvas/90 p-4 backdrop-blur">
          <div className="mx-auto max-w-2xl">
            <Button size="lg" className="w-full" disabled={!slot || pending} onClick={submit}>
              {pending
                ? "Guardando…"
                : slot
                  ? `Cambiar al ${formatDayShort(dateOf(slot.start, clinic.timezone))} · ${fmtTime(slot.start)}`
                  : "Elige un horario"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function OptionCard({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        "flex w-full items-center gap-4 rounded-[var(--radius-card)] border bg-surface p-4 text-left transition",
        "shadow-[var(--shadow-card)] hover:border-brand/60 active:scale-[0.99]",
        selected ? "border-brand ring-4 ring-brand/10" : "border-transparent",
      )}
    >
      {children}
      {selected && (
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-white">
          <IconCheck width={16} height={16} />
        </span>
      )}
    </button>
  );
}

function DayStrip({
  days,
  selected,
  onSelect,
}: {
  days: { date: string; open: boolean }[];
  selected: string;
  onSelect: (d: string) => void;
}) {
  useEffect(() => {
    document.getElementById(`day-${selected}`)?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }, [selected]);

  return (
    <div className="-mx-4 mt-6">
      <p className="mb-2 px-4 text-sm font-semibold text-ink-mute first-letter:uppercase">
        {formatDay(selected, { month: "long", year: "numeric" })}
      </p>
      <div className="flex gap-2 overflow-x-auto px-4 pb-2 no-scrollbar" role="listbox" aria-label="Días">
        {days.map((d) => {
          const isSel = d.date === selected;
          return (
            <button
              key={d.date}
              id={`day-${d.date}`}
              type="button"
              role="option"
              aria-selected={isSel}
              disabled={!d.open}
              onClick={() => onSelect(d.date)}
              className={cx(
                "flex h-20 w-16 shrink-0 flex-col items-center justify-center rounded-2xl border transition",
                isSel
                  ? "border-brand bg-brand text-white shadow-sm"
                  : d.open
                    ? "border-line bg-surface hover:border-brand"
                    : "border-transparent bg-transparent text-ink-mute/50",
              )}
            >
              <span className="text-xs font-medium uppercase">{formatDay(d.date, { weekday: "short" }).replace(".", "")}</span>
              <span className="text-xl font-semibold tabular-nums">{Number(d.date.slice(8))}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Summary(props: {
  serviceName: string;
  practitionerName: string;
  practitionerColor: string;
  when: string;
  duration: number;
  price: string | null;
  onChange: () => void;
}) {
  return (
    <Card className="mt-5 p-5">
      <div className="flex items-start gap-4">
        <Avatar name={props.practitionerName} color={props.practitionerColor} size={44} />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{props.serviceName}</p>
          <p className="text-sm text-ink-soft">con {props.practitionerName}</p>
          <p className="mt-2 flex items-center gap-1.5 text-sm font-medium">
            <IconCalendar width={16} height={16} className="text-brand" /> {props.when}
          </p>
          <p className="mt-1 text-sm text-ink-mute">
            {props.duration} min{props.price ? ` · ${props.price}` : ""}
          </p>
        </div>
        <button type="button" onClick={props.onChange} className="text-sm font-semibold text-brand hover:underline">
          Cambiar
        </button>
      </div>
    </Card>
  );
}

function SlotsSkeleton() {
  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="Cargando horarios">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-xl bg-sunken" />
      ))}
    </div>
  );
}

// --- utilidades de fecha (cliente) ---------------------------------------

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
function formatDay(date: string, opts: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("es-MX", { ...opts, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d, 12)));
}
function formatDayShort(date: string): string {
  return formatDay(date, { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "");
}
function formatDayLong(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: tz }).format(
    new Date(iso),
  );
}
function dateOf(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(iso));
}
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
