// Casa en Orden: avisos push (Edge Function "casa-notify" en el proyecto Finanzas Casa).
// Modos (POST JSON):
//   { type: 'tick' }                 <- pg_cron cada 5 min: medicinas a su hora y resumen diario (8:00 CDMX)
//   { type: 'test' } + Authorization <- botón "Probar" en Ajustes (solo al usuario que lo pide)
// No requiere JWT: todo se calcula en el servidor y cada aviso se envía una sola vez
// (claim_notification con llaves 'casa:...'), así que llamarla de más no genera avisos repetidos.
import webpush from 'npm:web-push@3.6.7'
import { createClient } from 'npm:@supabase/supabase-js@2'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
const TZ = 'America/Mexico_City'
const URL_APP = 'https://alexoro87.github.io/Reloj/casa/'

const mxParts = (d = new Date()) => {
  const s = d.toLocaleString('en-CA', { timeZone: TZ, hour12: false })
  return { date: s.slice(0, 10), hour: Number(s.slice(12, 14)) % 24 }
}
const addDaysISO = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
const hhmm = (d: Date) => d.toLocaleTimeString('es-MX', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })

let vapidReady: Promise<void> | null = null
function ensureVapid() {
  vapidReady ??= (async () => {
    const { data, error } = await sb.rpc('get_push_config')
    if (error || !data?.public || !data?.private) throw new Error('Sin llaves VAPID')
    webpush.setVapidDetails('mailto:avisos@finanzas-casa.app', data.public, data.private)
  })()
  return vapidReady
}

interface Payload { title: string; body: string; url?: string; tag?: string }

async function sendTo(filter: { household_id?: string; user_id?: string }, payload: Payload) {
  await ensureVapid()
  let q = sb.from('casa_push_subscriptions').select('id, user_id, endpoint, p256dh, auth')
  if (filter.household_id) q = q.eq('household_id', filter.household_id)
  if (filter.user_id) q = q.eq('user_id', filter.user_id)
  const { data: subs } = await q
  let sent = 0
  for (const s of subs ?? []) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, JSON.stringify({ ...payload, url: URL_APP + (payload.url ?? '') }), { TTL: 60 * 60 * 6 })
      sent++
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode
      if (code === 404 || code === 410) await sb.from('casa_push_subscriptions').delete().eq('id', s.id)
      else console.error('push error', code, (e as Error).message)
    }
  }
  return sent
}

async function claim(household: string, key: string): Promise<boolean> {
  const { data, error } = await sb.rpc('claim_notification', { p_household: household, p_key: 'casa:' + key })
  if (error) throw error
  return data === true
}

async function households(): Promise<string[]> {
  const { data } = await sb.from('casa_push_subscriptions').select('household_id')
  return [...new Set((data ?? []).map((r) => r.household_id as string))]
}

async function ninaDe(hid: string): Promise<string> {
  const { data } = await sb.from('casa_config').select('nina_nombre').eq('household_id', hid).maybeSingle()
  return (data?.nina_nombre as string | null)?.trim() || 'la niña'
}

// ---- medicinas a su hora ----
async function medicinas(hids: string[]) {
  if (!hids.length) return 0
  const today = mxParts().date
  const { data: meds } = await sb.from('casa_medicinas').select('*').in('household_id', hids).eq('activa', true).eq('avisar', true).not('cada_horas', 'is', null)
  let sent = 0
  for (const m of meds ?? []) {
    if (m.fin && m.fin < today) continue
    const { data: last } = await sb.from('casa_tomas').select('dada_en').eq('medicina_id', m.id).order('dada_en', { ascending: false }).limit(1).maybeSingle()
    const next = last ? new Date(Date.parse(last.dada_en) + Number(m.cada_horas) * 3600000) : new Date(m.inicio)
    const late = Date.now() - next.getTime()
    if (late < 0 || late > 6 * 3600000) continue
    if (!(await claim(m.household_id, `med:${m.id}:${next.toISOString()}`))) continue
    const nina = await ninaDe(m.household_id)
    sent += await sendTo({ household_id: m.household_id }, {
      title: `💊 Medicina de ${nina}: ${m.nombre}`,
      body: `${m.dosis ? m.dosis + ' · ' : ''}Le toca a las ${hhmm(next)}. Toca para marcarla como dada.`,
      url: '#salud', tag: `med-${m.id}`,
    })
  }
  return sent
}

// ---- resumen diario (8:00 CDMX) ----
const TIPO_EMOJI: Record<string, string> = { escuela: '🏫', salud: '🩺', familia: '👨‍👩‍👧', cumple: '🎂', otro: '💳' }
async function diario(hids: string[]) {
  const { date, hour } = mxParts()
  if (hour < 8) return 0
  const manana = addDaysISO(date, 1)
  const dia = (new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7
  let sent = 0
  for (const hid of hids) {
    if (!(await claim(hid, `daily:${date}`))) continue
    const [{ data: evs }, { data: mts }, { data: tareas }] = await Promise.all([
      sb.from('casa_eventos').select('*').eq('household_id', hid).in('fecha', [date, manana]).order('hora'),
      sb.from('casa_mantenimiento').select('*').eq('household_id', hid).is('completada_en', null),
      sb.from('casa_tareas').select('*').eq('household_id', hid).eq('dia', dia),
    ])
    const linea = (e: Record<string, string>) => `${e.emoji || TIPO_EMOJI[e.tipo] || '📌'} ${e.texto}${e.hora ? ' (' + e.hora.slice(0, 5) + ')' : ''}`
    const hoy = (evs ?? []).filter((e) => e.fecha === date), man = (evs ?? []).filter((e) => e.fecha === manana)
    if (hoy.length || man.length) {
      sent += await sendTo({ household_id: hid }, {
        title: hoy.length ? `📅 Hoy: ${hoy.length === 1 ? hoy[0].texto : hoy.length + ' eventos'}` : `📅 Mañana: ${man.length === 1 ? man[0].texto : man.length + ' eventos'}`,
        body: [...hoy.map(linea), ...(man.length && hoy.length ? ['Mañana: ' + man.map(linea).join(', ')] : hoy.length ? [] : man.map(linea))].join('\n'),
        url: '#agenda', tag: 'eventos',
      })
    }
    // Repetitivas: el día que toca, al día siguiente y a la semana de atraso.
    // De una sola vez: un día antes, el día límite, al día siguiente y a la semana de atraso.
    const toca = (mts ?? []).filter((m) => {
      const una = !m.frecuencia_dias
      const next = una ? m.fecha_limite : addDaysISO(m.ultima, m.frecuencia_dias)
      if (!next) return false
      const d = daysBetween(date, next)
      return d === 0 || d === -1 || d === -7 || (una && d === 1)
    })
    if (toca.length) {
      sent += await sendTo({ household_id: hid }, {
        title: `🔧 Casa: ${toca.length === 1 ? toca[0].texto : toca.length + ' pendientes'}`,
        body: toca.map((m) => m.texto).join(', '), url: '#casa', tag: 'mantenimiento',
      })
    }
    const ts = tareas ?? []
    if (ts.length) {
      const { data: miembros } = await sb.from('household_members').select('user_id').eq('household_id', hid)
      for (const mb of miembros ?? []) {
        const mias = ts.filter((t) => !t.asignado || t.asignado === mb.user_id).map((t) => t.texto)
        if (!mias.length) continue
        sent += await sendTo({ household_id: hid, user_id: mb.user_id }, { title: `✅ Hoy te toca (${mias.length})`, body: mias.join(', '), url: '#agenda', tag: 'tareas' })
      }
    }
  }
  return sent
}

async function handleTest(req: Request) {
  const jwt = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!jwt) return { error: 'Sin sesión' }
  const { data, error } = await sb.auth.getUser(jwt)
  if (error || !data.user) return { error: 'Sesión inválida' }
  const sent = await sendTo({ user_id: data.user.id }, { title: '✅ Avisos de Casa en Orden activos', body: 'Te avisaremos de medicinas, eventos, tareas y pendientes de la casa.', url: '#inicio' })
  return { sent }
}

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return new Response('Método no permitido', { status: 405, headers: cors })
  try {
    const body = await req.json().catch(() => ({}))
    let result: unknown
    if (body.type === 'tick') { const hids = await households(); result = { med: await medicinas(hids), daily: await diario(hids) } }
    else if (body.type === 'test') result = await handleTest(req)
    else return new Response(JSON.stringify({ error: 'Solicitud inválida' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } })
    return new Response(JSON.stringify(result), { headers: { ...cors, 'Content-Type': 'application/json' } })
  } catch (e) {
    console.error(e)
    return new Response(JSON.stringify({ error: (e as Error).message }), { status: 500, headers: { ...cors, 'Content-Type': 'application/json' } })
  }
})
