import { NextResponse, type NextRequest } from "next/server";
import { runFollowUps, runReminders } from "@/lib/booking";

/**
 * Tarea programada (cada 15 min, ver vercel.json): envía los recordatorios de
 * cita y los avisos de revisión pendientes. Protegida con CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    return new Response("CRON_SECRET no configurado", { status: 500 });
  }
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const reminders = await runReminders();
  const followUps = await runFollowUps();
  return NextResponse.json({ reminders, followUps });
}
