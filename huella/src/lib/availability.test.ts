import { describe, expect, it } from "vitest";
import { computeSlots } from "./availability";
import { formatTime, zonedToUtc } from "./time";
import type { WorkingHours } from "./types";

const tz = "America/Mexico_City";
// 2026-10-12 es lunes
const monday: WorkingHours[] = [
  { practitionerId: "p1", weekday: 1, start: "09:00", end: "11:00" },
  { practitionerId: "p1", weekday: 1, start: "16:00", end: "17:00" },
];
const earlyNow = new Date("2026-10-01T00:00:00Z");

const times = (slots: Date[]) => slots.map((s) => formatTime(s, tz));

describe("computeSlots", () => {
  it("ofrece inicios cada 15 min que caben completos en cada tramo", () => {
    const slots = computeSlots({
      date: "2026-10-12",
      timezone: tz,
      durationMin: 45,
      workingHours: monday,
      busy: [],
      now: earlyNow,
      minNoticeMinutes: 0,
    });
    expect(times(slots)).toEqual([
      "09:00", "09:15", "09:30", "09:45", "10:00", "10:15",
      "16:00", "16:15",
    ]);
  });

  it("excluye horarios que se cruzan con citas ocupadas", () => {
    const slots = computeSlots({
      date: "2026-10-12",
      timezone: tz,
      durationMin: 30,
      workingHours: monday,
      busy: [
        {
          start: zonedToUtc("2026-10-12", "09:30", tz),
          end: zonedToUtc("2026-10-12", "10:00", tz),
        },
      ],
      now: earlyNow,
      minNoticeMinutes: 0,
    });
    expect(times(slots)).not.toContain("09:15");
    expect(times(slots)).not.toContain("09:30");
    expect(times(slots)).not.toContain("09:45");
    expect(times(slots)).toContain("09:00");
    expect(times(slots)).toContain("10:00");
  });

  it("respeta la antelación mínima", () => {
    const now = zonedToUtc("2026-10-12", "09:50", tz);
    const slots = computeSlots({
      date: "2026-10-12",
      timezone: tz,
      durationMin: 30,
      workingHours: monday,
      busy: [],
      now,
      minNoticeMinutes: 60,
    });
    expect(times(slots)[0]).toBe("16:00");
  });

  it("no ofrece nada en días sin horario", () => {
    const slots = computeSlots({
      date: "2026-10-11", // domingo
      timezone: tz,
      durationMin: 30,
      workingHours: monday,
      busy: [],
      now: earlyNow,
      minNoticeMinutes: 0,
    });
    expect(slots).toEqual([]);
  });

  it("maneja zonas con horario de verano", () => {
    // Madrid cambia de hora el 25-oct-2026; el horario de pared debe mantenerse.
    const slots = computeSlots({
      date: "2026-10-26",
      timezone: "Europe/Madrid",
      durationMin: 60,
      workingHours: [{ practitionerId: "p1", weekday: 1, start: "09:00", end: "10:00" }],
      busy: [],
      now: earlyNow,
      minNoticeMinutes: 0,
    });
    expect(slots.map((s) => s.toISOString())).toEqual(["2026-10-26T08:00:00.000Z"]);
  });
});
