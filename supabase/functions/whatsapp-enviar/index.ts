// MediHora — Envía por WhatsApp los recordatorios de las tomas que tocan ahora.
// Lo llama pg_cron cada minuto con el encabezado x-cron-secret.
// Secretos: WHATSAPP_TOKEN, WHATSAPP_PHONE_ID (la clave de la tarea vive en Vault: whatsapp_cron_secret)
// Opcionales: WHATSAPP_TEMPLATE (recordatorio_medicina), WHATSAPP_LANG (es_MX)
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const VENTANA_MIN = 3; // si el envío se retrasa, alcanza tomas de hasta 3 minutos antes

type Med = {
  id: string; name: string; strength?: string; form?: string; qty?: number; paused?: boolean;
  freq?: { type?: string; days?: number[]; every?: number }; times: string[];
  startDate: string; endDate?: string | null; startAt?: number | null; endAt?: number | null;
};

const UNIDADES: Record<string, [string, string]> = {
  "comprimido": ["comprimido", "comprimidos"], "cápsula": ["cápsula", "cápsulas"], "gota": ["gota", "gotas"],
  "ml": ["ml", "ml"], "inyección": ["inyección", "inyecciones"], "inhalación": ["inhalación", "inhalaciones"],
  "sobre": ["sobre", "sobres"], "aplicación": ["aplicación", "aplicaciones"], "unidad": ["unidad", "unidades"],
};
const doseText = (m: Med) => {
  const q = m.qty || 1;
  const [uno, varios] = UNIDADES[m.form || ""] || ["unidad", "unidades"];
  return `${q} ${q === 1 ? uno : varios}`;
};

// Fecha y minutos del día en la zona horaria de la persona
function ahoraLocal(tz: string, base = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(base).map((x) => [x.type, x.value]));
  return { fecha: `${p.year}-${p.month}-${p.day}`, min: Number(p.hour) * 60 + Number(p.minute) };
}
const diaDe = (fecha: string) => Date.UTC(+fecha.slice(0, 4), +fecha.slice(5, 7) - 1, +fecha.slice(8, 10));
const diasEntre = (a: string, b: string) => Math.round((diaDe(b) - diaDe(a)) / 864e5);
const restarDia = (fecha: string) => new Date(diaDe(fecha) - 864e5).toISOString().slice(0, 10);

// Misma regla que la app (isScheduledOn)
function tocaEseDia(m: Med, fecha: string) {
  if (m.paused) return false;
  if (fecha < m.startDate) return false;
  if (m.endDate && fecha > m.endDate) return false;
  const f = m.freq || { type: "daily" };
  if (f.type === "weekdays") return (f.days || []).includes(new Date(diaDe(fecha)).getUTCDay());
  if (f.type === "interval") return diasEntre(m.startDate, fecha) % Math.max(1, f.every || 1) === 0;
  return true;
}

async function enviarPlantilla(to: string, persona: string, medicina: string, hora: string, linkId: number, doseKey: string) {
  const body = {
    messaging_product: "whatsapp", to, type: "template",
    template: {
      name: Deno.env.get("WHATSAPP_TEMPLATE") || "recordatorio_medicina",
      language: { code: Deno.env.get("WHATSAPP_LANG") || "es_MX" },
      components: [
        { type: "body", parameters: [{ type: "text", text: persona }, { type: "text", text: medicina }, { type: "text", text: hora }] },
        { type: "button", sub_type: "quick_reply", index: "0", parameters: [{ type: "payload", payload: `t~${linkId}~${doseKey}` }] },
        { type: "button", sub_type: "quick_reply", index: "1", parameters: [{ type: "payload", payload: `s~${linkId}~${doseKey}` }] },
      ],
    },
  };
  const r = await fetch(`https://graph.facebook.com/v21.0/${Deno.env.get("WHATSAPP_PHONE_ID")}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.error("WhatsApp rechazó el envío", r.status, await r.text());
  return r.ok;
}

Deno.serve(async (req) => {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  // Solo la tarea programada conoce esta clave (guardada cifrada en Vault)
  const { data: autorizado } = await db.rpc("cron_secret_ok", { p: req.headers.get("x-cron-secret") ?? "" });
  if (!autorizado) return new Response("No autorizado", { status: 401 });
  if (!Deno.env.get("WHATSAPP_TOKEN") || !Deno.env.get("WHATSAPP_PHONE_ID")) {
    return Response.json({ enviados: 0, nota: "WhatsApp aún no está configurado" });
  }
  const ahora = new Date();

  const { data: links } = await db.from("whatsapp_links").select("id, profile_id, phone, tz, profiles(name)").eq("active", true);
  if (!links?.length) return Response.json({ enviados: 0 });

  const perfiles = [...new Set(links.map((l) => l.profile_id))];
  const { data: filas } = await db.from("medications").select("id, profile_id, data").in("profile_id", perfiles).eq("deleted", false);
  const medsPorPerfil = new Map<string, Med[]>();
  for (const f of filas || []) {
    const lista = medsPorPerfil.get(f.profile_id) || [];
    lista.push({ ...(f.data as Med), id: f.id });
    medsPorPerfil.set(f.profile_id, lista);
  }

  // 1) Tomas que tocan ahora
  type Cand = { link: typeof links[number]; med: Med; key: string; hora: string };
  const cands: Cand[] = [];
  for (const link of links) {
    const { fecha, min } = ahoraLocal(link.tz);
    const ayer = restarDia(fecha);
    for (const med of medsPorPerfil.get(link.profile_id) || []) {
      for (const hora of med.times || []) {
        const hm = Number(hora.slice(0, 2)) * 60 + Number(hora.slice(3, 5));
        for (const [dia, extra] of [[fecha, 0], [ayer, 1440]] as const) {
          const diff = min + extra - hm; // minutos desde la hora de la toma
          if (diff < 0 || diff >= VENTANA_MIN) continue;
          if (!tocaEseDia(med, dia)) continue;
          const due = ahora.getTime() - diff * 60000;
          if (med.startAt && due < med.startAt - 60000) continue;
          if (med.endAt && due >= med.endAt) continue;
          cands.push({ link, med, key: `${med.id}|${dia}|${hora}`, hora });
        }
      }
    }
  }

  // 2) Recordatorios pospuestos («En 10 min») que ya vencieron
  const { data: pospuestos } = await db.from("whatsapp_sent").select("profile_id, dose_key, phone")
    .lte("next_at", ahora.toISOString()).not("next_at", "is", null);
  for (const p of pospuestos || []) {
    const link = links.find((l) => l.profile_id === p.profile_id && l.phone === p.phone);
    const med = (medsPorPerfil.get(p.profile_id) || []).find((m) => m.id === p.dose_key.split("|")[0]);
    if (link && med) cands.push({ link, med, key: p.dose_key, hora: p.dose_key.split("|")[2] });
  }
  if (!cands.length) return Response.json({ enviados: 0 });

  // Quitar las que ya se registraron (tomada u omitida) y las ya enviadas
  const keys = [...new Set(cands.map((c) => c.key))];
  const { data: registradas } = await db.from("dose_logs").select("profile_id, dose_key, status").in("dose_key", keys).not("status", "is", null);
  const yaRegistrada = new Set((registradas || []).map((r) => `${r.profile_id}#${r.dose_key}`));
  const { data: enviados } = await db.from("whatsapp_sent").select("profile_id, dose_key, phone, next_at").in("dose_key", keys);
  const yaEnviado = new Set((enviados || []).filter((e) => !e.next_at || new Date(e.next_at) > ahora).map((e) => `${e.profile_id}#${e.dose_key}#${e.phone}`));

  let n = 0;
  for (const c of cands) {
    if (yaRegistrada.has(`${c.link.profile_id}#${c.key}`)) continue;
    if (yaEnviado.has(`${c.link.profile_id}#${c.key}#${c.link.phone}`)) continue;
    // deno-lint-ignore no-explicit-any
    const persona = (c.link as any).profiles?.name || "tu familiar";
    const medicina = `${c.med.name}${c.med.strength ? " " + c.med.strength : ""} · ${doseText(c.med)}`;
    if (await enviarPlantilla(c.link.phone!, persona, medicina, c.hora, c.link.id, c.key)) {
      await db.from("whatsapp_sent").upsert({ profile_id: c.link.profile_id, dose_key: c.key, phone: c.link.phone, sent_at: ahora.toISOString(), next_at: null });
      yaEnviado.add(`${c.link.profile_id}#${c.key}#${c.link.phone}`);
      n++;
    }
  }
  return Response.json({ enviados: n });
});
