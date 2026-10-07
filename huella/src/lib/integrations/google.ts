import type { BusyInterval } from "../availability";
import type { Clinic } from "../types";

/**
 * Integración con Google Calendar vía OAuth 2.0 (una conexión por clínica).
 * La clínica conecta una cuenta de Google; cada podólogo puede tener su propio
 * calendario (compartido con esa cuenta) y la recepción recibe la invitación.
 */

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

export function isGoogleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

export function googleAuthUrl(redirectUri: string, state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const data = (await res.json()) as { refresh_token?: string; error_description?: string };
  if (!res.ok || !data.refresh_token) {
    throw new Error(data.error_description ?? "Google no devolvió un refresh token");
  }
  return data.refresh_token;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(clinic: Clinic): Promise<string | null> {
  if (!clinic.googleRefreshToken || !isGoogleConfigured()) return null;
  const cached = tokenCache.get(clinic.id);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: clinic.googleRefreshToken,
      grant_type: "refresh_token",
    }),
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new Error(`Google token ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache.set(clinic.id, {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  });
  return data.access_token;
}

export function isClinicConnected(clinic: Clinic): boolean {
  return Boolean(clinic.googleRefreshToken) && isGoogleConfigured();
}

export interface CalendarEvent {
  summary: string;
  description: string;
  start: string;
  end: string;
  timezone: string;
  attendees: string[];
}

async function call(
  clinic: Clinic,
  method: string,
  path: string,
  body?: object,
): Promise<Response | null> {
  const token = await accessToken(clinic);
  if (!token) return null;
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok && res.status !== 404 && res.status !== 410) {
    throw new Error(`Google Calendar ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res;
}

function toGoogle(e: CalendarEvent) {
  return {
    summary: e.summary,
    description: e.description,
    start: { dateTime: e.start, timeZone: e.timezone },
    end: { dateTime: e.end, timeZone: e.timezone },
    attendees: e.attendees.map((email) => ({ email })),
    reminders: { useDefault: true },
  };
}

const cal = (id: string) => `/calendars/${encodeURIComponent(id)}/events`;

/** Devuelve el id del evento creado, o null si la clínica no tiene Google conectado. */
export async function createEvent(
  clinic: Clinic,
  calendarId: string,
  event: CalendarEvent,
): Promise<string | null> {
  const res = await call(clinic, "POST", `${cal(calendarId)}?sendUpdates=all`, toGoogle(event));
  if (!res) return null;
  return ((await res.json()) as { id: string }).id;
}

export async function updateEvent(
  clinic: Clinic,
  calendarId: string,
  eventId: string,
  event: CalendarEvent,
): Promise<void> {
  await call(
    clinic,
    "PATCH",
    `${cal(calendarId)}/${encodeURIComponent(eventId)}?sendUpdates=all`,
    toGoogle(event),
  );
}

export async function deleteEvent(clinic: Clinic, calendarId: string, eventId: string) {
  await call(clinic, "DELETE", `${cal(calendarId)}/${encodeURIComponent(eventId)}?sendUpdates=all`);
}

/**
 * Bloques ocupados en Google Calendar (p. ej. citas que la recepción anotó
 * directamente en Google). Si Google falla, no bloquea las reservas.
 */
export async function freeBusy(
  clinic: Clinic,
  calendarIds: string[],
  timeMin: string,
  timeMax: string,
): Promise<Map<string, BusyInterval[]>> {
  const result = new Map<string, BusyInterval[]>();
  if (calendarIds.length === 0) return result;
  try {
    const res = await call(clinic, "POST", "/freeBusy", {
      timeMin,
      timeMax,
      items: calendarIds.map((id) => ({ id })),
    });
    if (!res) return result;
    const data = (await res.json()) as {
      calendars: Record<string, { busy?: { start: string; end: string }[] }>;
    };
    for (const [id, c] of Object.entries(data.calendars ?? {})) {
      result.set(
        id,
        (c.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) })),
      );
    }
  } catch (e) {
    console.error("[google] freeBusy falló, se ignora", e);
  }
  return result;
}
