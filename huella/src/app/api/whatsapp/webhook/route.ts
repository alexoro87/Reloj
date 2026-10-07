import { NextResponse, type NextRequest } from "next/server";
import { handleInbound } from "@/lib/booking";
import { parseWebhook, verifySignature } from "@/lib/integrations/whatsapp";

/** Verificación del webhook al darlo de alta en Meta. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  if (
    q.get("hub.mode") === "subscribe" &&
    q.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN &&
    process.env.WHATSAPP_VERIFY_TOKEN
  ) {
    return new Response(q.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/** Respuestas de pacientes (botones Confirmar / Cancelar o texto libre). */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new Response("Invalid signature", { status: 401 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  for (const msg of parseWebhook(payload)) {
    try {
      await handleInbound(msg);
    } catch (e) {
      // Meta reintenta si no respondemos 200; registramos y seguimos.
      console.error("[whatsapp] error procesando mensaje", e);
    }
  }
  return NextResponse.json({ ok: true });
}
