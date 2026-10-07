import { TZDate } from "@date-fns/tz";

const LOCALE = "es-MX";

/** Instante UTC correspondiente a una fecha y hora "de pared" en una zona horaria. */
export function zonedToUtc(date: string, time: string, timezone: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  return new Date(new TZDate(y, m - 1, d, hh, mm, 0, timezone).getTime());
}

export interface ZonedParts {
  date: string;
  time: string;
  weekday: number;
  minutes: number;
}

export function zonedParts(instant: Date | string, timezone: string): ZonedParts {
  const t = new TZDate(new Date(instant).getTime(), timezone);
  const date = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}`;
  const time = `${pad(t.getHours())}:${pad(t.getMinutes())}`;
  return { date, time, weekday: t.getDay(), minutes: t.getHours() * 60 + t.getMinutes() };
}

export function todayIn(timezone: string, now = new Date()): string {
  return zonedParts(now, timezone).date;
}

/** Suma días a una fecha "YYYY-MM-DD" (aritmética de calendario, sin zona horaria). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function timeToMinutes(time: string): number {
  const [hh, mm] = time.split(":").map(Number);
  return hh * 60 + mm;
}

export function formatTime(instant: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: timezone,
  }).format(new Date(instant));
}

/** "martes 14 de octubre" */
export function formatLongDate(instant: Date | string, timezone: string): string {
  return new Intl.DateTimeFormat(LOCALE, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: timezone,
  }).format(new Date(instant));
}

/** Para fechas "YYYY-MM-DD" sin hora. */
export function formatDay(date: string, opts: Intl.DateTimeFormatOptions): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(LOCALE, { ...opts, timeZone: "UTC" }).format(
    new Date(Date.UTC(y, m - 1, d, 12)),
  );
}

export function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function pad(n: number): string {
  return n.toString().padStart(2, "0");
}
