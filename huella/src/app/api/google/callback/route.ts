import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { getAppUrl } from "@/lib/app-url";
import { getSession } from "@/lib/auth";
import { getRepo } from "@/lib/db";
import { exchangeCode } from "@/lib/integrations/google";
import { unsign } from "@/lib/sign";

export async function GET(req: NextRequest) {
  const session = await getSession();
  if (!session) redirect("/panel/login");
  const q = req.nextUrl.searchParams;
  const state = unsign<{ cid: string; exp: number }>(q.get("state") ?? undefined);
  const code = q.get("code");
  if (!code || !state || state.exp < Date.now() || state.cid !== session.clinic.id) {
    redirect("/panel/ajustes?google=error");
  }
  let ok = true;
  try {
    const refreshToken = await exchangeCode(code, `${await getAppUrl()}/api/google/callback`);
    await getRepo().updateClinic(session.clinic.id, { googleRefreshToken: refreshToken });
  } catch (e) {
    console.error("[google] callback", e);
    ok = false;
  }
  redirect(`/panel/ajustes?google=${ok ? "conectado" : "error"}`);
}
