import { redirect } from "next/navigation";
import { getAppUrl } from "@/lib/app-url";
import { getSession } from "@/lib/auth";
import { googleAuthUrl, isGoogleConfigured } from "@/lib/integrations/google";
import { sign } from "@/lib/sign";

export async function GET() {
  const session = await getSession();
  if (!session) redirect("/panel/login");
  if (!isGoogleConfigured()) redirect("/panel/ajustes?google=sin-configurar");
  const state = sign({ cid: session.clinic.id, exp: Date.now() + 10 * 60_000 });
  redirect(googleAuthUrl(`${await getAppUrl()}/api/google/callback`, state));
}
