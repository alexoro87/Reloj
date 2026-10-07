import { timeToMinutes, weekdayOf, zonedToUtc } from "./time";
import type { WorkingHours } from "./types";

export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface SlotQuery {
  /** "YYYY-MM-DD" en la zona horaria de la clínica */
  date: string;
  timezone: string;
  durationMin: number;
  workingHours: WorkingHours[];
  busy: BusyInterval[];
  now: Date;
  minNoticeMinutes: number;
  /** Cada cuántos minutos se ofrece un inicio de cita. */
  stepMin?: number;
}

/**
 * Calcula los inicios de cita libres de un podólogo en un día.
 * Una cita cabe si queda entera dentro de un tramo laboral y no se cruza con
 * ningún intervalo ocupado (otras citas, ausencias o eventos de Google Calendar).
 */
export function computeSlots(q: SlotQuery): Date[] {
  const step = q.stepMin ?? 15;
  const weekday = weekdayOf(q.date);
  const earliest = q.now.getTime() + q.minNoticeMinutes * 60_000;
  const durationMs = q.durationMin * 60_000;
  const slots: Date[] = [];

  const ranges = q.workingHours
    .filter((w) => w.weekday === weekday)
    .sort((a, b) => timeToMinutes(a.start) - timeToMinutes(b.start));

  for (const range of ranges) {
    const rangeStart = zonedToUtc(q.date, range.start, q.timezone).getTime();
    const rangeEnd = zonedToUtc(q.date, range.end, q.timezone).getTime();

    for (let t = rangeStart; t + durationMs <= rangeEnd; t += step * 60_000) {
      if (t < earliest) continue;
      const end = t + durationMs;
      const overlaps = q.busy.some((b) => t < b.end.getTime() && end > b.start.getTime());
      if (!overlaps) slots.push(new Date(t));
    }
  }

  return slots;
}

export function overlaps(a: BusyInterval, b: BusyInterval): boolean {
  return a.start < b.end && a.end > b.start;
}
