import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s) return s;
  if (process.env.NODE_ENV === "production" && process.env.SUPABASE_URL) {
    throw new Error("SESSION_SECRET es obligatorio en producción");
  }
  return "huella-dev-secret-no-usar-en-produccion";
}

/** Firma un objeto JSON → "payload.firma" (base64url). */
export function sign(data: object): string {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const mac = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function unsign<T>(value: string | undefined): T | null {
  if (!value) return null;
  const [payload, mac] = value.split(".");
  if (!payload || !mac) return null;
  const expected = createHmac("sha256", secret()).update(payload).digest();
  const actual = Buffer.from(mac, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString()) as T;
  } catch {
    return null;
  }
}
