import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getRepo } from "./db";
import { sign, unsign } from "./sign";
import type { Clinic, StaffUser } from "./types";

const COOKIE = "huella_session";
const MAX_AGE_S = 60 * 60 * 12;

interface SessionPayload {
  uid: string;
  exp: number;
}

export interface Session {
  user: StaffUser;
  clinic: Clinic;
}

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  const payload = unsign<SessionPayload>(jar.get(COOKIE)?.value);
  if (!payload || payload.exp < Date.now()) return null;
  const repo = getRepo();
  const user = await repo.getStaff(payload.uid);
  if (!user) return null;
  const clinic = await repo.getClinic(user.clinicId);
  return clinic ? { user, clinic } : null;
}

export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect("/panel/login");
  return session;
}

export async function startSession(user: StaffUser): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, sign({ uid: user.id, exp: Date.now() + MAX_AGE_S * 1000 }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
