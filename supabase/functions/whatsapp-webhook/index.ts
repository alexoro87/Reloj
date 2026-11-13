// MediHora — Recibe los mensajes de WhatsApp (Meta Cloud API):
//  · «ACTIVAR ABC123» activa los recordatorios en ese número
//  · botones «✓ Ya la tomé» y «⏱ En 10 min» de cada recordatorio
//  · «BAJA» deja de enviar recordatorios a ese número
// Secretos: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function responder(to: string, texto: string) {
  const r = await fetch(`https://graph.facebook.com/v21.0/${Deno.env.get("WHATSAPP_PHONE_ID")}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: texto } }),
  });
  if (!r.ok) console.error("No se pudo responder", r.status, await r.text());
}

// Comprueba que el mensaje viene de Meta (firma HMAC del cuerpo con el secreto de la app)
async function firmaValida(cuerpo: string, firma: string | null) {
  const secreto = Deno.env.get("WHATSAPP_APP_SECRET");
  if (!secreto) return false;
  if (!firma?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(cuerpo)));
  const esperado = [...mac].map((b) => b.toString(16).padStart(2, "0")).join("");
  const recibido = firma.slice(7);
  if (recibido.length !== esperado.length) return false;
  let dif = 0;
  for (let i = 0; i < esperado.length; i++) dif |= esperado.charCodeAt(i) ^ recibido.charCodeAt(i);
  return dif === 0;
}

const hhmm = (iso: string, tz: string) =>
  new Intl.DateTimeFormat("es-MX", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

async function activar(from: string, code: string) {
  const { data: link } = await db.from("whatsapp_links").select("id, profile_id, profiles(name)")
    .eq("code", code).eq("active", false).gt("expires_at", new Date().toISOString()).maybeSingle();
  if (!link) return responder(from, "Ese código no es válido o ya venció. Pide uno nuevo en la app: perfil de la persona → WhatsApp.");
  // deno-lint-ignore no-explicit-any
  const persona = (link as any).profiles?.name || "tu familiar";
  const { data: existe } = await db.from("whatsapp_links").select("id").eq("profile_id", link.profile_id).eq("phone", from).eq("active", true).maybeSingle();
  if (existe) {
    await db.from("whatsapp_links").delete().eq("id", link.id);
    return responder(from, `Este número ya recibe los recordatorios de ${persona}. ✅`);
  }
  await db.from("whatsapp_links").update({ phone: from, active: true, code: null, activated_at: new Date().toISOString() }).eq("id", link.id);
  return responder(from, `✅ Listo. Te avisaré aquí cuando sea hora de las medicinas de ${persona}.\n\nToca «✓ Ya la tomé» en cada aviso para registrarla. Para dejar de recibirlos, escribe BAJA.`);
}

async function boton(from: string, payload: string) {
  const [accion, linkId, ...resto] = payload.split("~");
  const doseKey = resto.join("~");
  const { data: link } = await db.from("whatsapp_links").select("id, profile_id, phone, tz, active, profiles(name)").eq("id", Number(linkId)).maybeSingle();
  if (!link || !link.active || link.phone !== from) return responder(from, "Este recordatorio ya no está activo en este número.");
  const medId = doseKey.split("|")[0];
  const { data: med } = await db.from("medications").select("id, data").eq("id", medId).eq("profile_id", link.profile_id).maybeSingle();
  if (!med) return responder(from, "Esta medicina ya no está en la app.");
  // deno-lint-ignore no-explicit-any
  const nombre = (med.data as any)?.name || "la medicina";
  // deno-lint-ignore no-explicit-any
  const persona = (link as any).profiles?.name || "";

  if (accion === "t") {
    const { data: reg } = await db.from("dose_logs").select("status, taken_at, by_name").eq("profile_id", link.profile_id).eq("dose_key", doseKey).maybeSingle();
    if (reg?.status === "taken") {
      return responder(from, `⚠️ ${nombre} ya estaba registrada${reg.by_name ? " por " + reg.by_name : ""} a las ${hhmm(reg.taken_at, link.tz)}. No la des de nuevo.`);
    }
    const { error } = await db.from("dose_logs").upsert({
      profile_id: link.profile_id, dose_key: doseKey, med_id: medId, status: "taken",
      taken_at: new Date().toISOString(), by_user: null, by_name: `WhatsApp${persona ? " (" + persona + ")" : ""}`.slice(0, 40),
    });
    if (error) { console.error(error); return responder(from, "No pude registrarla. Inténtalo desde la app."); }
    await db.from("whatsapp_sent").update({ next_at: null }).eq("profile_id", link.profile_id).eq("dose_key", doseKey);
    return responder(from, `✓ Registré ${nombre}. ¡Gracias!`);
  }
  if (accion === "s") {
    await db.from("whatsapp_sent").update({ next_at: new Date(Date.now() + 10 * 60000).toISOString() })
      .eq("profile_id", link.profile_id).eq("dose_key", doseKey).eq("phone", from);
    return responder(from, `⏱ Te recuerdo ${nombre} en 10 minutos.`);
  }
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  // Verificación inicial que hace Meta al configurar el webhook
  if (req.method === "GET") {
    const ok = url.searchParams.get("hub.mode") === "subscribe" &&
      url.searchParams.get("hub.verify_token") === Deno.env.get("WHATSAPP_VERIFY_TOKEN");
    return ok ? new Response(url.searchParams.get("hub.challenge") ?? "") : new Response("Token no válido", { status: 403 });
  }
  if (req.method !== "POST") return new Response("Método no permitido", { status: 405 });

  const cuerpo = await req.text();
  if (!(await firmaValida(cuerpo, req.headers.get("x-hub-signature-256")))) return new Response("Firma no válida", { status: 401 });

  try {
    const data = JSON.parse(cuerpo);
    for (const entry of data.entry ?? []) {
      for (const change of entry.changes ?? []) {
        for (const msg of change.value?.messages ?? []) {
          const from: string = msg.from;
          if (msg.type === "button" && msg.button?.payload) await boton(from, msg.button.payload);
          else if (msg.type === "interactive" && msg.interactive?.button_reply?.id) await boton(from, msg.interactive.button_reply.id);
          else if (msg.type === "text") {
            const t = (msg.text?.body || "").trim().toUpperCase();
            const m = t.match(/^ACTIVAR\s+([A-Z0-9]{6})$/);
            if (m) await activar(from, m[1]);
            else if (t === "BAJA" || t === "STOP") {
              await db.from("whatsapp_links").delete().eq("phone", from);
              await responder(from, "Listo, ya no te enviaré recordatorios. Puedes volver a activarlos desde la app.");
            } else {
              await responder(from, "Hola, soy MediHora 💊. Te aviso aquí cuando es hora de las medicinas.\nPara activar, manda «ACTIVAR» y el código que te da la app. Para dejar de recibir avisos, escribe BAJA.");
            }
          }
        }
      }
    }
  } catch (e) {
    console.error("whatsapp-webhook", e);
  }
  // Meta espera siempre 200 para no reintentar
  return new Response("ok");
});
