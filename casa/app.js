/* Casa en Orden — app familiar instalable (PWA).
   Datos compartidos en Supabase (proyecto Finanzas Casa), separados por hogar con RLS.
   Modo demo: todo en este dispositivo, sin cuenta. */
(function () {
"use strict";

const SB_URL = "https://ksxvmtnotdmfgmhlidli.supabase.co";
const SB_KEY = "sb_publishable_WZenPPzFDL2eguiEmRb4Yw_BVThbn7S"; // llave pública: el acceso real lo limitan las políticas RLS

/* ---------- utilidades ---------- */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const iso = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const parse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const today = () => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; };
let TODAY = today();
const daysBetween = (a, b) => Math.round((b - a) / 86400000);
const monday = d => { const x = new Date(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const wkKey = () => iso(monday(TODAY));
const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const fmtLong = d => cap(d.toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long" }));
const fmtShort = d => d.toLocaleDateString("es-MX", { day: "numeric", month: "short" }).replace(".", "");
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { const b = a.slice(); for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; } return b; };
const listJoin = a => a.length <= 1 ? (a[0] || "") : a.slice(0, -1).join(", ") + " y " + a[a.length - 1];
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "x" + Math.random().toString(36).slice(2) + Date.now().toString(36));
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};
function toast(msg) { const t = $("#toast"); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, 2200); }
const TABLES = ["casa_super", "casa_tareas", "casa_eventos", "casa_mantenimiento", "casa_medicinas", "casa_tomas", "casa_config"];
const SINCE_TOMAS = () => new Date(Date.now() - 45 * 86400000).toISOString();

/* ---------- backend: Supabase ---------- */
function supaApi() {
  const sb = window.supabase.createClient(SB_URL, SB_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "casa-en-orden-auth" } });
  let channel = null;
  const must = r => { if (r.error) throw r.error; return r.data; };
  return {
    kind: "supa",
    async user() { const { data } = await sb.auth.getSession(); return data.session ? data.session.user : null; },
    onAuth(fn) { sb.auth.onAuthStateChange((ev, s) => fn(ev, s ? s.user : null)); },
    async signIn(email, password) { must(await sb.auth.signInWithPassword({ email, password })); },
    async signUp(email, password) {
      const d = must(await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.href.split("#")[0] } }));
      return !!d.session;
    },
    async reset(email) { must(await sb.auth.resetPasswordForEmail(email, { redirectTo: location.href.split("#")[0] })); },
    async setPassword(password) { must(await sb.auth.updateUser({ password })); },
    async signOut() { if (channel) sb.removeChannel(channel); channel = null; await sb.auth.signOut(); },
    async memberships() {
      return must(await sb.from("household_members").select("household_id,user_id,display_name,created_at,households(name,invite_code)").order("created_at"));
    },
    async createHousehold(name, display) { return must(await sb.rpc("create_household", { p_name: name, p_display_name: display })); },
    async joinHousehold(code, display) { return must(await sb.rpc("join_household", { p_code: code, p_display_name: display })); },
    async setMyName(hid, uid, name) { must(await sb.from("household_members").update({ display_name: name }).eq("household_id", hid).eq("user_id", uid)); },
    async list(t, hid) {
      if (t === "casa_config") return must(await sb.from(t).select("*").eq("household_id", hid));
      if (t === "casa_tomas") return must(await sb.from(t).select("*").eq("household_id", hid).gte("dada_en", SINCE_TOMAS()).order("dada_en"));
      return must(await sb.from(t).select("*").eq("household_id", hid).order("created_at"));
    },
    async saveConfig(hid, p) { must(await sb.from("casa_config").upsert(Object.assign({ household_id: hid, updated_at: new Date().toISOString() }, p), { onConflict: "household_id" })); },
    async vapidPublic() { return must(await sb.rpc("casa_vapid_public")); },
    async saveSub(row) { must(await sb.from("casa_push_subscriptions").upsert(row, { onConflict: "endpoint" })); },
    async removeSub(endpoint) { must(await sb.from("casa_push_subscriptions").delete().eq("endpoint", endpoint)); },
    async testPush() { const r = await sb.functions.invoke("casa-notify", { body: { type: "test" } }); if (r.error) throw r.error; return r.data; },
    async insert(t, row) { return must(await sb.from(t).insert(row).select().single()); },
    async update(t, id, patch) { must(await sb.from(t).update(patch).eq("id", id)); },
    async remove(t, id) { must(await sb.from(t).delete().eq("id", id)); },
    subscribe(hid, onChange, onStatus) {
      if (channel) sb.removeChannel(channel);
      channel = sb.channel("casa-" + hid);
      TABLES.forEach(t => channel.on("postgres_changes", { event: "*", schema: "public", table: t, filter: "household_id=eq." + hid }, () => onChange(t)));
      channel.subscribe(st => onStatus(st === "SUBSCRIBED" ? "vivo" : st === "CHANNEL_ERROR" || st === "TIMED_OUT" ? "sin-conexion" : null));
    },
  };
}

/* ---------- backend: demo local ---------- */
function demoApi() {
  const K = "casa-demo-db";
  const db = ls.get(K, null) || demoSeed();
  const persist = () => ls.set(K, db);
  persist();
  return {
    kind: "demo",
    async user() { return { id: "demo-yo", email: "demo" }; },
    onAuth() {}, async signIn() {}, async signUp() {}, async reset() {},
    async signOut() { ls.del("casa-modo"); ls.del(K); location.reload(); },
    async memberships() { return db.members.map(m => Object.assign({ households: { name: "Casa demo", invite_code: "DEMO1234" } }, m)); },
    async createHousehold() {}, async joinHousehold() {},
    async setMyName(hid, uid, name) { db.members.find(m => m.user_id === uid).display_name = name; persist(); },
    async list(t) { return (db[t] || []).slice(); },
    async saveConfig(hid, p) { db.casa_config = [Object.assign({ household_id: hid }, (db.casa_config || [])[0], p)]; persist(); },
    async vapidPublic() { throw new Error("demo"); }, async saveSub() {}, async removeSub() {}, async testPush() { throw new Error("demo"); },
    async insert(t, row) { const r = Object.assign({ id: uuid(), created_at: new Date().toISOString() }, t === "casa_tomas" ? { dada_en: new Date().toISOString(), dada_por: "demo-yo" } : {}, row); (db[t] = db[t] || []).push(r); persist(); return r; },
    async update(t, id, patch) { const r = db[t].find(x => x.id === id); if (r) Object.assign(r, patch); persist(); },
    async remove(t, id) { db[t] = (db[t] || []).filter(x => x.id !== id); if (t === "casa_medicinas") db.casa_tomas = (db.casa_tomas || []).filter(x => x.medicina_id !== id); persist(); },
    subscribe(hid, onChange, onStatus) { onStatus("demo"); },
  };
}
function demoSeed() {
  const H = "demo-hogar", ym = n => iso(new Date(TODAY.getFullYear(), TODAY.getMonth(), n));
  let c = 0; const r = o => Object.assign({ id: uuid(), household_id: H, created_at: new Date(Date.now() + (c++)).toISOString() }, o);
  return {
    members: [
      { household_id: H, user_id: "demo-yo", display_name: "Yo", created_at: "2026-01-01" },
      { household_id: H, user_id: "demo-ella", display_name: "Mi esposa", created_at: "2026-01-02" },
    ],
    casa_super: [r({ texto: "Leche entera", pasillo: "Lácteos", comprado: false }), r({ texto: "Plátanos", pasillo: "Frutas y verduras", comprado: false }),
      r({ texto: "Pechuga de pollo 1 kg", pasillo: "Carnes", comprado: false }), r({ texto: "Queso panela", pasillo: "Lácteos", comprado: true }),
      r({ texto: "Detergente", pasillo: "Limpieza", comprado: false })],
    casa_tareas: [[0, "Lavar ropa", "demo-ella"], [0, "Sacar la basura", "demo-yo"], [1, "Llevar a la niña a la escuela", "demo-yo"], [1, "Preparar lunch", "demo-ella"],
      [2, "Cocinar la cena", "demo-yo"], [2, "Regar plantas", "demo-ella"], [3, "Planchar uniforme", "demo-ella"], [4, "Hacer el súper", null],
      [5, "Limpieza general", null], [5, "Lavar el carro", "demo-yo"], [6, "Planear menú de la semana", "demo-ella"]]
      .map(([d, t, a]) => r({ dia: d, texto: t, asignado: a, hecho_semana: null })),
    casa_eventos: [r({ fecha: ym(5), hora: "18:00", texto: "Junta de padres", tipo: "escuela", emoji: "📚" }), r({ fecha: iso(addDays(TODAY, 2)), hora: null, texto: "Cena con los abuelos", tipo: "familia" }),
      r({ fecha: iso(addDays(TODAY, 6)), hora: "16:00", texto: "Cumpleaños de la prima", tipo: "cumple", emoji: "🎈" }), r({ fecha: iso(addDays(TODAY, 11)), hora: "09:00", texto: "Festival escolar", tipo: "escuela", emoji: "🎵" }),
      r({ fecha: ym(20), hora: "10:30", texto: "Pediatra", tipo: "salud", emoji: "💉" })],
    casa_mantenimiento: [["Cambiar filtro del purificador", "Cocina", 90, -97], ["Limpiar campana de la estufa", "Cocina", 30, -24], ["Limpiar filtro del minisplit", "Recámaras", 60, -63],
      ["Revisar detectores de humo", "General", 180, -40], ["Fumigación", "General", 180, -150]]
      .map(([t, a, f, d]) => r({ texto: t, area: a, frecuencia_dias: f, ultima: iso(addDays(TODAY, d)) }))
      .concat([r({ texto: "Arreglar la llave del baño", area: "Baños", frecuencia_dias: null, fecha_limite: iso(addDays(TODAY, 3)), ultima: iso(TODAY) })]),
    casa_config: [{ household_id: H, nina_nombre: "Sofi" }],
    casa_medicinas: [r({ id: "demo-med-1", nombre: "Amoxicilina", dosis: "5 ml", cada_horas: 8, inicio: new Date(Date.now() - 30 * 3600000).toISOString(), fin: iso(addDays(TODAY, 5)), notas: "Con alimento", activa: true, avisar: true }),
      r({ id: "demo-med-2", nombre: "Paracetamol infantil", dosis: "4 ml", cada_horas: null, inicio: new Date().toISOString(), fin: null, notas: "Solo si tiene fiebre de 38 °C o más", activa: true, avisar: false })],
    casa_tomas: [-30, -22, -14, -6.5].map(h => r({ medicina_id: "demo-med-1", dada_en: new Date(Date.now() + h * 3600000).toISOString(), dada_por: h === -14 ? "demo-ella" : "demo-yo" })),
  };
}

/* ---------- estado ---------- */
let api = null;
const S = {
  user: null, screen: "boot", hid: null, households: [], members: [], sync: "conectando",
  casa_super: [], casa_tareas: [], casa_eventos: [], casa_mantenimiento: [], casa_medicinas: [], casa_tomas: [], casa_config: [],
  sel: ls.get("casa-sel", { p: ["pollo"], s: ["arroz"], v: ["brocoli", "zanahoria"] }),
};
const VIEWS = ["inicio", "comida", "super", "agenda", "salud", "casa"];
let view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "inicio";
const sub = { comida: "menus", agenda: "semana" };
let whoFilter = "todos", calMonth = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1), calSel = iso(TODAY);
let authTab = "entrar", authMsg = "", authBusy = false;

const me = () => S.members.find(m => m.user_id === (S.user && S.user.id));
const memberIdx = uid => S.members.findIndex(m => m.user_id === uid);
const nameOf = uid => { if (!uid) return "Los dos"; const m = S.members.find(x => x.user_id === uid); return m ? (m.display_name || "Sin nombre") : "Ex-miembro"; };
const pillWho = uid => `<span class="pill ${!uid ? "p-both" : memberIdx(uid) % 2 ? "p-m2" : "p-m1"}">${esc(nameOf(uid))}</span>`;
const initial = s => esc((s || "?").trim().charAt(0).toUpperCase() || "?");
const nina = () => ((S.casa_config[0] || {}).nina_nombre || "").trim();
const ninaO = (fallback) => nina() || fallback;

/* ---------- carga y sincronización ---------- */
async function loadAll(t) {
  const list = t ? [t] : TABLES;
  try {
    const res = await Promise.all(list.map(x => api.list(x, S.hid)));
    list.forEach((x, i) => S[x] = res[i]);
    const c = {}; TABLES.forEach(x => c[x] = S[x]); ls.set("casa-cache-" + S.hid, c);
    if (S.sync === "sin-conexion") S.sync = "vivo";
  } catch (e) { S.sync = "sin-conexion"; }
  render();
}
const reloadT = {};
function scheduleReload(t) { clearTimeout(reloadT[t]); reloadT[t] = setTimeout(() => loadAll(t), 150); }

async function enter() {
  S.user = await api.user();
  if (!S.user) { S.screen = "auth"; return render(); }
  let rows;
  try { rows = await api.memberships(); } catch (e) { S.screen = "auth"; authMsg = "No se pudo conectar. Revisa tu internet."; return render(); }
  const mine = rows.filter(r => r.user_id === S.user.id);
  S.households = mine.map(r => ({ id: r.household_id, name: r.households ? r.households.name : "Hogar", code: r.households ? r.households.invite_code : "" }));
  if (!S.households.length) { S.screen = "hogar"; return render(); }
  const saved = ls.get("casa-hogar", null);
  S.hid = (S.households.find(h => h.id === saved) || S.households[0]).id;
  S.members = rows.filter(r => r.household_id === S.hid);
  const cache = ls.get("casa-cache-" + S.hid, null);
  if (cache) Object.assign(S, cache);
  S.screen = "app"; render();
  api.subscribe(S.hid, scheduleReload, st => { if (st) { S.sync = st; if (st === "vivo") loadAll(); else render(); } });
  loadAll();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden || S.screen !== "app") return;
  const t = today(); if (+t !== +TODAY) TODAY = t;
  loadAll();
});

async function write(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); }
  catch (e) { toast(navigator.onLine ? "No se pudo guardar. Intenta de nuevo." : "Sin internet: no se guardó."); loadAll(); }
}
const add = (t, row, msg) => write(async () => { const r = await api.insert(t, Object.assign({ household_id: S.hid }, row)); S[t] = S[t].concat(r); render(); }, msg);
const patch = (t, id, p, msg) => { const r = S[t].find(x => x.id === id); if (r) Object.assign(r, p); render(); return write(() => api.update(t, id, p), msg); };
const del = (t, id, msg) => { S[t] = S[t].filter(x => x.id !== id); render(); return write(() => api.remove(t, id), msg); };

/* ---------- catálogo de comida ---------- */
const PROT = {
  pollo: { n: "Pollo", full: "Pechuga de pollo", min: 15, sarten: "Corta el pollo en tiras, sazona con sal, pimienta y ajo en polvo y dóralo 6–8 min.", horno: "Unta el pollo con aceite, limón y orégano.", hornoMin: 25 },
  res: { n: "Res", full: "Bistec de res", min: 10, sarten: "Sazona la res y séllala a fuego alto 2–3 min por lado; córtala en tiras.", horno: "Marina la res en tiras con salsa de soya baja en sodio y ajo.", hornoMin: 18 },
  cerdo: { n: "Cerdo", full: "Lomo de cerdo", min: 15, sarten: "Corta el lomo en medallones y dóralos 4 min por lado.", horno: "Unta el lomo con mostaza, ajo y romero.", hornoMin: 30 },
  pescado: { n: "Pescado", full: "Filete de pescado blanco", min: 10, sarten: "Sazona el filete con limón y paprika; cocínalo 3–4 min por lado.", horno: "Coloca el filete sobre las verduras con rodajas de limón.", hornoMin: 15 },
  salmon: { n: "Salmón", full: "Salmón", min: 12, sarten: "Cocina el salmón con la piel hacia abajo 4 min, voltea y deja 3 min más.", horno: "Barniza el salmón con miel y mostaza.", hornoMin: 15 },
  huevo: { n: "Huevo", full: "Huevos", min: 8, sarten: "Bate 2 huevos por persona y revuelve a fuego medio hasta cuajar.", horno: "Haz huecos entre las verduras y rompe un huevo en cada uno.", hornoMin: 12 },
  atun: { n: "Atún", full: "Atún en agua", min: 3, sarten: "Escurre el atún y mézclalo con limón, cebolla picada y una cucharada de yogur natural.", horno: "Mezcla el atún con un poco de queso rallado.", hornoMin: 10 },
  frijol: { n: "Frijoles / lentejas", full: "Frijoles o lentejas", min: 10, sarten: "Calienta las leguminosas con comino, ajo y un poco de su caldo.", horno: "Mezcla las leguminosas con salsa de jitomate.", hornoMin: 15 },
  tofu: { n: "Tofu", full: "Tofu firme", min: 12, sarten: "Prensa el tofu, córtalo en cubos y dóralo 8 min con soya.", horno: "Marina el tofu en cubos con soya y ajo.", hornoMin: 25 },
};
const SIDE = {
  arroz: { n: "Arroz", min: 20, how: "Cocina 1 taza de arroz con 2 de agua, tapado, 18 min a fuego bajo." },
  integral: { n: "Arroz integral", min: 35, how: "Cocina 1 taza de arroz integral con 2½ de agua, tapado, 35 min." },
  pasta: { n: "Pasta", min: 12, how: "Hierve la pasta en agua con sal 9–11 min y escurre." },
  papa: { n: "Papa", min: 25, how: "Corta las papas en cubos con cáscara y cuécelas 20–25 min." },
  camote: { n: "Camote", min: 30, how: "Corta el camote en gajos y hornéalo 25–30 min a 200 °C con aceite de oliva." },
  quinoa: { n: "Quinoa", min: 15, how: "Enjuaga la quinoa y cuécela con el doble de agua 12–15 min." },
  tortilla: { n: "Tortillas", min: 3, how: "Calienta las tortillas de maíz en comal." },
  pan: { n: "Pan integral", min: 3, how: "Tuesta el pan integral." },
  ninguno: { n: "Sin acompañamiento", min: 0, how: "" },
};
const VEG = { brocoli: "brócoli", calabacita: "calabacita", espinaca: "espinaca", zanahoria: "zanahoria", pimiento: "pimiento", jitomate: "jitomate", ejote: "ejotes",
  champinon: "champiñones", coliflor: "coliflor", elote: "elote", cebolla: "cebolla", lechuga: "lechuga", pepino: "pepino", nopal: "nopales" };
const RAW = ["lechuga", "pepino", "jitomate"];
function buildDish(style, pk, sk, vks) {
  const P = PROT[pk], Sd = SIDE[sk], vs = vks.map(v => VEG[v]), vtxt = listJoin(vs) || "verduras de temporada";
  const cooked = vks.filter(v => !RAW.includes(v)).map(v => VEG[v]), raw = vks.filter(v => RAW.includes(v)).map(v => VEG[v]);
  const steps = [], sideStep = sk !== "ninguno" && Sd.how ? Sd.how : null; let name, min;
  if (style === "charola") {
    name = `Charola al horno: ${P.n.toLowerCase()} con ${vtxt}`;
    steps.push("Precalienta el horno a 200 °C y cubre una charola con papel aluminio.");
    if (cooked.length) steps.push(`Corta ${listJoin(cooked)} en trozos parejos y mézclalos con aceite de oliva, sal y pimienta.`);
    steps.push(P.horno + " Acomoda todo en la charola.");
    if (sk === "papa" || sk === "camote") steps.push(`Agrega el ${Sd.n.toLowerCase()} en gajos a la misma charola.`); else if (sideStep) steps.push(sideStep);
    steps.push(`Hornea ${P.hornoMin}–${P.hornoMin + 5} min, moviendo a la mitad.`);
    if (raw.length) steps.push(`Sirve con ${listJoin(raw)} fresco al lado.`);
    min = Math.max(P.hornoMin + 10, Sd.min);
  } else if (style === "bowl") {
    name = sk === "ninguno" ? `Bowl de ${P.n.toLowerCase()} con ${vtxt}` : `Bowl de ${Sd.n.toLowerCase()} con ${P.n.toLowerCase()} y ${vtxt}`;
    if (sideStep) steps.push(sideStep);
    steps.push(P.sarten);
    if (cooked.length) steps.push(`Saltea ${listJoin(cooked)} 4–5 min; deben quedar al dente.`);
    if (raw.length) steps.push(`Pica ${listJoin(raw)} en crudo.`);
    steps.push("Arma el bowl por secciones y termina con limón, aguacate o semillas.");
    min = Math.max(P.min, Sd.min) + 8;
  } else if (style === "tacos") {
    name = `Tacos de ${P.n.toLowerCase()} con ${vtxt}`;
    steps.push(P.sarten);
    if (cooked.length) steps.push(`En el mismo sartén saltea ${listJoin(cooked)} con cebolla 4 min.`);
    if (raw.length) steps.push(`Pica ${listJoin(raw)} para servir encima.`);
    steps.push("Calienta tortillas de maíz y sirve con salsa casera y limón.");
    min = P.min + 10;
  } else {
    name = (["frijol", "huevo", "atun"].includes(pk) ? `${P.n} con ${vtxt}` : `${P.n} salteado con ${vtxt}`) + (sk !== "ninguno" ? ` y ${Sd.n.toLowerCase()}` : "");
    if (sideStep) steps.push(sideStep);
    steps.push(P.sarten + " Retira y reserva.");
    if (cooked.length) steps.push(`En el mismo sartén cocina ${listJoin(cooked)} con ajo 5 min.`);
    steps.push("Regresa la proteína, ajusta sal y sirve" + (raw.length ? ` con ${listJoin(raw)} fresco.` : "."));
    min = Math.max(P.min, Sd.min) + 8;
  }
  return { name: cap(name), steps, min, style, shop: [P.full].concat(sk !== "ninguno" ? [Sd.n] : [], vs.map(cap)) };
}
const STYLE_LABEL = { sarten: "Un sartén", charola: "Al horno", bowl: "Bowl", tacos: "Tacos" };
let menus = [];
function genMenus() {
  const ps = S.sel.p.length ? S.sel.p : ["pollo"], ss = S.sel.s.length ? S.sel.s : ["arroz"], vs = S.sel.v.length ? S.sel.v : ["brocoli", "zanahoria"];
  let styles = shuffle(["sarten", "charola", "bowl"]);
  if (ss.includes("tortilla")) styles = ["tacos"].concat(styles.slice(0, 2));
  const noTort = ss.filter(s => s !== "tortilla");
  menus = styles.map(st => buildDish(st, pick(ps), st === "tacos" ? "tortilla" : pick(noTort.length ? noTort : ["arroz"]), shuffle(vs).slice(0, Math.min(vs.length, 2 + Math.floor(Math.random() * 2)))));
}
const LUNCHES = [
  { n: "Mini sándwich de pollo", p: "Pollo deshebrado en pan integral cortado en 4", f: "Gajos de mandarina", v: "Palitos de pepino", x: "Yogur natural", d: "Agua natural", shop: ["Pollo", "Pan integral", "Mandarinas", "Pepino", "Yogur natural"] },
  { n: "Quesadillitas de frijol", p: "2 tortillas pequeñas con frijol y queso", f: "Fresas en mitades", v: "Zanahoria rallada", x: "Yogur natural con canela", d: "Agua de jamaica sin azúcar", shop: ["Tortillas", "Frijoles", "Queso", "Fresas", "Zanahoria"] },
  { n: "Rollitos de pavo", p: "Pavo enrollado con queso panela", f: "Uvas cortadas a lo largo en 4", v: "Jícama en bastones", x: "Galletas de arroz", d: "Agua natural", shop: ["Jamón de pavo", "Queso panela", "Uvas", "Jícama", "Galletas de arroz"] },
  { n: "Pasta fría de colores", p: "Coditos con atún, elote y yogur", f: "Melón en cubos", v: "Chícharos", x: "Queso en cubitos", d: "Agua natural", shop: ["Pasta de coditos", "Atún", "Elote", "Melón", "Chícharos"] },
  { n: "Huevo y pan", p: "Huevo cocido en rebanadas", f: "Plátano", v: "Jitomate cherry en cuartos", x: "Pan integral con aguacate", d: "Leche", shop: ["Huevo", "Plátanos", "Jitomate cherry", "Aguacate", "Pan integral"] },
  { n: "Hotcakes mini de avena", p: "Hotcakes de avena y huevo", f: "Arándanos aplastados", v: "Pepino en rodajas", x: "Crema de cacahuate untada fina", d: "Agua natural", shop: ["Avena", "Huevo", "Arándanos", "Pepino"] },
  { n: "Arroz con verduritas", p: "Arroz con pollo y verduras", f: "Manzana en gajos delgados", v: "Brócoli al vapor", x: "Yogur natural", d: "Agua natural", shop: ["Arroz", "Pollo", "Manzanas", "Brócoli"] },
  { n: "Molletes mini", p: "Bolillo integral con frijol y queso", f: "Papaya en cubos", v: "Pico de gallo sin chile", x: "Pepino con limón", d: "Agua natural", shop: ["Bolillo integral", "Frijoles", "Queso", "Papaya", "Jitomate"] },
];
let lunchIdx = Math.floor(Math.random() * LUNCHES.length);

/* ---------- vistas ---------- */
const GLYPH = {
  inicio: '<path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  comida: '<path d="M4 3v8a3 3 0 0 0 3 3v7M7 3v6M10 3v8a3 3 0 0 1-3 3"/><path d="M17 21V3c-2 1-3 4-3 8h3"/>',
  super: '<path d="M3 4h2l2.4 11h11L21 7H6.2"/><circle cx="9" cy="19.5" r="1.5"/><circle cx="17" cy="19.5" r="1.5"/>',
  agenda: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  salud: '<rect x="3" y="8" width="18" height="8" rx="4" transform="rotate(-45 12 12)"/><path d="M9.2 9.2l5.6 5.6"/>',
  casa: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L3 17.8V21h3.2l6.3-6.3a4 4 0 0 0 5.2-5.4l-2.4 2.4-2.8-.6-.6-2.8z"/>',
};
const SYNC = { conectando: "Conectando", vivo: "En vivo", "sin-conexion": "Sin conexión", demo: "Modo demo" };
function hero(v, eyebrow, title, lead) {
  const m = me();
  return `<header class="hero gut"><svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">${GLYPH[v]}</svg><div class="wrap">
    <div class="bar"><button class="who-chip" id="openSheet" aria-label="Ajustes"><span class="av">${initial(m && m.display_name)}</span>${esc(S.households.find(h => h.id === S.hid)?.name || "")}</button>
    <span class="row" style="gap:10px;flex-wrap:nowrap"><span class="sync ${S.sync === "vivo" ? "live" : ""}"><i></i>${SYNC[S.sync] || ""}</span><button class="who-chip" id="nextTema" aria-label="Cambiar colores" style="padding:6px"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="13.5" cy="6.5" r="1.5"/><circle cx="17.5" cy="10.5" r="1.5"/><circle cx="8.5" cy="7.5" r="1.5"/><circle cx="6.5" cy="12.5" r="1.5"/><path d="M12 2a10 10 0 0 0 0 20c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A5.6 5.6 0 0 0 22 9.8C22 5.5 17.5 2 12 2z"/></svg></button></span></div>
    <div class="eyebrow">${esc(eyebrow)}</div><h1>${title}</h1>${lead ? `<p class="lead">${lead}</p>` : ""}</div></header>`;
}
const unaVez = m => !m.frecuencia_dias;
const mPend = m => !m.completada_en;
function mStatus(m) {
  const una = unaVez(m), next = una ? parse(m.fecha_limite) : addDays(parse(m.ultima), m.frecuencia_dias), diff = daysBetween(TODAY, next);
  const p = Math.max(0, Math.min(100, Math.round(100 * (1 - diff / (una ? 14 : m.frecuencia_dias)))));
  if (diff < 0) return { next, diff, p: 100, cls: "p-bad", txt: `Vencido hace ${-diff} d`, col: "var(--bad)" };
  if (diff <= 14) return { next, diff, p, cls: "p-warn", txt: diff === 0 ? "Toca hoy" : `En ${diff} d`, col: "var(--warn)" };
  return { next, diff, p, cls: "p-ok", txt: una ? `Faltan ${diff} d` : "Al día", col: "var(--ok)" };
}
const isDone = t => t.hecho_semana === wkKey();
const CATS = { escuela: "Escuela", salud: "Salud", familia: "Familia", cumple: "Cumpleaños", otro: "Pagos / otro" };
const TIPO_EMOJI = { escuela: "🏫", salud: "🩺", familia: "👨‍👩‍👧", cumple: "🎂", otro: "💳" };
const EMOJIS = ["🎂", "🎉", "🎁", "🎈", "🏫", "📚", "🎒", "🖍️", "🩺", "💉", "🦷", "💊", "👨‍👩‍👧", "👵", "👴", "❤️", "🍽️", "🍕", "⚽", "🏀",
  "🩰", "🏊", "🎵", "🎬", "✈️", "🏖️", "🚗", "💳", "🏠", "🐶", "⛪", "🎄", "🎃", "💐", "⭐"];
const emojiOf = e => e.emoji || TIPO_EMOJI[e.tipo] || "📌";
let evEmoji = null;
const PASILLOS = ["Frutas y verduras", "Carnes", "Lácteos", "Despensa", "Limpieza", "Otro"];
const greet = () => { const h = new Date().getHours(); return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches"; };

function evRow(e) {
  const d = parse(e.fecha);
  return `<div class="ev t-${esc(e.tipo)}"><div class="date"><b>${d.getDate()}</b><span>${d.toLocaleDateString("es-MX", { month: "short" }).replace(".", "")}</span></div>
    <span class="emo" aria-hidden="true">${esc(emojiOf(e))}</span><div class="t"><b>${esc(e.texto)}</b><div class="when">${cap(d.toLocaleDateString("es-MX", { weekday: "long" }))}${e.hora ? " · " + esc(String(e.hora).slice(0, 5)) : ""} · ${CATS[e.tipo] || ""}</div></div>
    <button class="x" data-del="casa_eventos:${e.id}" aria-label="Borrar evento">×</button></div>`;
}
function taskRow(t, withDel) {
  return `<label class="check ${isDone(t) ? "done" : ""}"><input type="checkbox" data-done="${t.id}" ${isDone(t) ? "checked" : ""}><span class="t">${esc(t.texto)}</span>${pillWho(t.asignado)}${withDel ? `<button class="x" data-del="casa_tareas:${t.id}" aria-label="Borrar">×</button>` : ""}</label>`;
}

function vInicio() {
  const dIdx = (TODAY.getDay() + 6) % 7, hoy = S.casa_tareas.filter(t => t.dia === dIdx), pend = hoy.filter(t => !isDone(t)).length;
  const prox = S.casa_eventos.filter(e => e.fecha >= iso(TODAY)).sort((a, b) => (a.fecha + (a.hora || "")).localeCompare(b.fecha + (b.hora || ""))).slice(0, 3);
  const mt = S.casa_mantenimiento.filter(mPend).map(m => ({ m, s: mStatus(m) })).filter(x => x.s.diff <= 14).sort((a, b) => a.s.diff - b.s.diff);
  const sup = S.casa_super.filter(i => !i.comprado), L = LUNCHES[lunchIdx], m = me();
  return hero("inicio", fmtLong(TODAY), `${greet()}${m && m.display_name ? ", " + esc(m.display_name) : ""}`, pend ? `Hoy quedan ${pend} ${pend === 1 ? "pendiente" : "pendientes"} en casa.` : "Lo de hoy ya está hecho.") + `
  <main class="gut"><div class="wrap pull stack">
    <div class="kpis">
      <button class="kpi" data-go="agenda"><i class="dot" style="background:var(--c-agenda)"></i><b>${pend}</b><span>tareas hoy</span></button>
      <button class="kpi" data-go="super"><i class="dot" style="background:var(--c-super)"></i><b>${sup.length}</b><span>en el súper</span></button>
      <button class="kpi" data-go="agenda" data-sub="mes"><i class="dot" style="background:var(--c-comida)"></i><b>${prox.length ? parse(prox[0].fecha).getDate() : "—"}</b><span>${prox.length ? "próximo evento · " + fmtShort(parse(prox[0].fecha)).split(" ")[1] : "sin eventos"}</span></button>
      <button class="kpi" data-go="casa"><i class="dot" style="background:var(--c-casa)"></i><b>${mt.filter(x => x.s.diff < 0).length}</b><span>mantenimiento vencido</span></button>
    </div>
    ${installCard()}
    <div class="grid2">
      <section class="card"><div class="tile-head"><h3><i style="background:var(--c-agenda)"></i>Tareas de hoy</h3><button class="link" data-go="agenda">Semana</button></div>
        ${hoy.length ? hoy.map(t => taskRow(t)).join("") : `<div class="empty">Nada asignado para hoy.</div>`}</section>
      <section class="card"><div class="tile-head"><h3><i style="background:var(--c-comida)"></i>Próximos eventos</h3><button class="link" data-go="agenda" data-sub="mes">Calendario</button></div>
        ${prox.length ? prox.map(evRow).join("") : `<div class="empty">No hay eventos próximos.</div>`}</section>
      ${medCardInicio()}
      <section class="card"><div class="tile-head"><h3><i style="background:var(--c-comida)"></i>Lunch de mañana</h3><button class="link" data-go="comida" data-sub="lunch">Más ideas</button></div>
        <b>${esc(L.n)}</b><div class="muted small">${esc(L.p)} · ${esc(L.f)} · ${esc(L.v)}</div></section>
      <section class="card"><div class="tile-head"><h3><i style="background:var(--c-casa)"></i>Casa: atender pronto</h3><button class="link" data-go="casa">Ver todo</button></div>
        ${mt.length ? mt.slice(0, 3).map(x => `<div class="row between" style="padding:6px 0"><span>${esc(x.m.texto)}</span><span class="pill ${x.s.cls}">${x.s.txt}</span></div>`).join("") : `<div class="empty">Todo al día.</div>`}</section>
    </div>
  </div></main>`;
}

function chipGroup(key, cat) {
  return `<div class="chips">${Object.entries(cat).map(([k, v]) => `<button class="chip" data-chip="${key}:${k}" aria-pressed="${S.sel[key].includes(k)}">${esc(typeof v === "string" ? cap(v) : v.n)}</button>`).join("")}</div>`;
}
function vComida() {
  const tabs = `<div class="seg" role="tablist"><button role="tab" data-sub="menus" aria-selected="${sub.comida === "menus"}">Menús saludables</button><button role="tab" data-sub="lunch" aria-selected="${sub.comida === "lunch"}">Lunch de ${esc(ninaO("la niña"))}</button></div>`;
  if (sub.comida === "lunch") {
    const L = LUNCHES[lunchIdx];
    return hero("comida", "Lunch para 4 años", nina() ? `Lonchera de ${esc(nina())}` : "Lonchera lista", "Fruta, verdura, cereal y proteína en cada idea.") + `<main class="gut"><div class="wrap pull stack">${tabs}
      <section class="card"><div class="row between"><span class="label">Idea ${lunchIdx + 1} de ${LUNCHES.length}</span></div>
        <h2 class="lunch-name" style="margin-top:6px">${esc(L.n)}</h2>
        <div class="lunchbox">
          <div class="lb wide"><span class="label">Proteína + cereal</span>${esc(L.p)}</div>
          <div class="lb"><span class="label">Fruta</span>${esc(L.f)}</div><div class="lb"><span class="label">Verdura</span>${esc(L.v)}</div>
          <div class="lb"><span class="label">Extra</span>${esc(L.x)}</div><div class="lb"><span class="label">Bebida</span>${esc(L.d)}</div>
        </div>
        <div class="row"><button class="btn" id="nextLunch">Otra idea</button><button class="btn soft" id="lunchSuper">Agregar al súper</button></div></section>
      <div class="tip"><b>Para su edad:</b> corta uvas, jitomates cherry y salchichas a lo largo en cuartos; evita frutos secos enteros y palomitas. Porción aproximada: el tamaño de su puño por grupo.</div>
      <p class="small muted" style="margin:0 4px">Ideas armadas con el criterio del Plato del Bien Comer. Son sugerencias generales; su pediatra puede ajustarlas a alergias o necesidades.</p>
    </div></main>`;
  }
  return hero("comida", "Cocina sencilla", "¿Qué hay en el refri?", "Elige lo que tienes y te armo 3 menús saludables.") + `<main class="gut"><div class="wrap pull stack">${tabs}
    <section class="card stack">
      <div><div class="label" style="margin-bottom:8px">Proteína</div>${chipGroup("p", PROT)}</div>
      <div><div class="label" style="margin-bottom:8px">Acompañamiento</div>${chipGroup("s", SIDE)}</div>
      <div><div class="label" style="margin-bottom:8px">Verduras</div>${chipGroup("v", VEG)}</div>
      <button class="btn wide" id="gen">Generar 3 menús</button>
    </section>
    ${menus.map((m, i) => `<article class="card dish"><div class="row between"><span class="pill" style="background:var(--sec-soft);color:var(--ink)">${STYLE_LABEL[m.style]}</span><span class="meta"><span>≈ ${m.min} min</span><span>2–3 porciones</span></span></div>
      <h3>${esc(m.name)}</h3><ol>${m.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol>
      <button class="btn soft sm" data-shop="${i}">Agregar ingredientes al súper</button></article>`).join("")}
  </div></main>`;
}

function vSuper() {
  const pend = S.casa_super.filter(i => !i.comprado), ok = S.casa_super.filter(i => i.comprado);
  const groups = PASILLOS.map(c => [c, pend.filter(i => (PASILLOS.includes(i.pasillo) ? i.pasillo : "Otro") === c)]).filter(g => g[1].length);
  const item = i => `<label class="check ${i.comprado ? "done" : ""}"><input type="checkbox" data-sup="${i.id}" ${i.comprado ? "checked" : ""} aria-label="Comprado"><span class="t">${esc(i.texto)}</span><button class="x" data-del="casa_super:${i.id}" aria-label="Borrar">×</button></label>`;
  return hero("super", "Lista compartida", pend.length ? `${pend.length} por comprar` : "Despensa llena", "Lo que uno agrega, el otro lo ve al instante.") + `<main class="gut"><div class="wrap pull stack">
    <form class="card addform inline" id="supForm">
      <input type="text" id="supText" placeholder="¿Qué falta? Ej. huevo, tortillas…" autocomplete="off" enterkeyhint="done">
      <select id="supCat" aria-label="Pasillo">${PASILLOS.map(c => `<option>${c}</option>`).join("")}</select>
      <button class="btn">Agregar</button>
    </form>
    ${groups.length ? groups.map(([c, it]) => `<section class="card"><div class="label">${c}</div>${it.map(item).join("")}</section>`).join("") : `<section class="card empty">Nada pendiente. Agrega lo que haga falta.</section>`}
    ${ok.length ? `<section class="card"><div class="row between"><span class="label">En el carrito · ${ok.length}</span><button class="link" id="clearOk">Quitar comprados</button></div>${ok.map(item).join("")}</section>` : ""}
  </div></main>`;
}

function vAgenda() {
  const tabs = `<div class="seg" role="tablist"><button role="tab" data-sub="semana" aria-selected="${sub.agenda === "semana"}">Tareas de la semana</button><button role="tab" data-sub="mes" aria-selected="${sub.agenda === "mes"}">Calendario familiar</button></div>`;
  if (sub.agenda === "mes") return vMes(tabs);
  const mon = monday(TODAY), tIdx = (TODAY.getDay() + 6) % 7;
  const vis = t => whoFilter === "todos" || t.asignado === whoFilter || !t.asignado;
  const scores = S.members.map((m, i) => { const all = S.casa_tareas.filter(t => t.asignado === m.user_id || !t.asignado); const d = all.filter(isDone).length;
    return `<div class="card"><span class="pill ${i % 2 ? "p-m2" : "p-m1"}">${esc(m.display_name || "Sin nombre")}</span><div style="margin-top:8px"><b>${d}</b><span class="muted"> / ${all.length}</span></div>
      <div class="bar-p"><i style="width:${all.length ? d / all.length * 100 : 0}%;background:var(${i % 2 ? "--m2" : "--m1"})"></i></div></div>`; }).join("");
  return hero("agenda", `Semana del ${fmtShort(mon)} al ${fmtShort(addDays(mon, 6))}`, "Quién hace qué", "Cada quien marca lo suyo; se reinicia cada lunes.") + `<main class="gut"><div class="wrap pull stack">${tabs}
    ${S.members.length > 1 ? `<div class="score">${scores}</div>` : `<div class="card small">Cuando tu esposa se una con el código de invitación (toca tu nombre arriba), podrás asignarle actividades.</div>`}
    <div class="filter">${[["todos", "Todos"]].concat(S.members.map(m => [m.user_id, m.display_name || "Sin nombre"])).map(([k, l]) => `<button data-who="${esc(k)}" aria-pressed="${whoFilter === k}">${esc(l)}</button>`).join("")}</div>
    <form class="card addform" id="wkForm">
      <input type="text" id="wkText" placeholder="Nueva actividad semanal" autocomplete="off" enterkeyhint="done">
      <div class="two"><select id="wkDay" aria-label="Día">${DIAS.map((d, i) => `<option value="${i}" ${i === tIdx ? "selected" : ""}>${d}</option>`).join("")}</select>
      <select id="wkWho" aria-label="Quién">${S.members.map(m => `<option value="${esc(m.user_id)}">${esc(m.display_name || "Sin nombre")}</option>`).join("")}<option value="">Los dos</option></select></div>
      <button class="btn">Asignar</button>
    </form>
    ${DIAS.map((d, i) => { const ts = S.casa_tareas.filter(t => t.dia === i && vis(t)); return `<section class="card day ${i === tIdx ? "today" : ""}">
      <h3>${d} ${i === tIdx ? `<span class="today-tag">Hoy</span>` : `<span class="muted small" style="font-family:var(--f-body);font-weight:600">${fmtShort(addDays(mon, i))}</span>`}</h3>
      ${ts.length ? ts.map(t => taskRow(t, true)).join("") : `<div class="empty">Día libre</div>`}</section>`; }).join("")}
  </div></main>`;
}
function vMes(tabs) {
  const y = calMonth.getFullYear(), m = calMonth.getMonth(), start = monday(new Date(y, m, 1)), cells = [];
  for (let i = 0; i < 42; i++) { const d = addDays(start, i); if (i >= 35 && d.getMonth() !== m) break; cells.push(d); }
  const byDay = {}; S.casa_eventos.forEach(e => (byDay[e.fecha] = byDay[e.fecha] || []).push(e));
  const sortEv = (a, b) => (a.fecha + (a.hora || "")).localeCompare(b.fecha + (b.hora || ""));
  const selEv = (byDay[calSel] || []).slice().sort(sortEv);
  const monthEv = S.casa_eventos.filter(e => e.fecha.startsWith(y + "-" + pad(m + 1))).sort(sortEv);
  return hero("agenda", "Calendario familiar", cap(calMonth.toLocaleDateString("es-MX", { month: "long" })), `${monthEv.length} ${monthEv.length === 1 ? "evento" : "eventos"} este mes.`) + `<main class="gut"><div class="wrap pull stack">${tabs}
    <section class="card">
      <div class="cal-head"><button class="x" id="prevM" aria-label="Mes anterior">‹</button><h3>${cap(calMonth.toLocaleDateString("es-MX", { month: "long", year: "numeric" }).replace(" de ", " "))}</h3><button class="x" id="nextM" aria-label="Mes siguiente">›</button></div>
      <div class="cal">${["L", "M", "M", "J", "V", "S", "D"].map(d => `<div class="dow">${d}</div>`).join("")}
        ${cells.map(d => { const k = iso(d), ev = byDay[k] || []; return `<button class="d ${d.getMonth() !== m ? "out" : ""} ${k === iso(TODAY) ? "today" : ""} ${k === calSel ? "sel" : ""}" data-day="${k}" aria-label="${fmtLong(d)}${ev.length ? ", " + ev.length + " eventos" : ""}"><span>${d.getDate()}</span><span class="emos">${ev.slice(0, 2).map(e => `<i>${esc(emojiOf(e))}</i>`).join("")}${ev.length > 2 ? `<small>+${ev.length - 2}</small>` : ""}</span></button>`; }).join("")}
      </div>
      <div class="legend">${Object.entries(CATS).map(([k, v]) => `<span class="t-${k}"><i></i>${v}</span>`).join("")}</div>
    </section>
    <section class="card">
      <h3>${fmtLong(parse(calSel))}</h3>
      ${selEv.length ? selEv.map(evRow).join("") : `<div class="empty">Sin eventos este día.</div>`}
      <form class="addform" id="evForm" style="margin-top:10px">
        <input type="text" id="evText" placeholder="Reunión, cita, cumpleaños…" autocomplete="off" enterkeyhint="done">
        <div class="two"><input type="date" id="evDate" value="${calSel}" aria-label="Fecha"><input type="time" id="evTime" aria-label="Hora"></div>
        <div class="field"><label>Emoji${evEmoji ? "" : " (automático según el tipo)"}</label><div class="emojis" role="group" aria-label="Emoji del evento">${EMOJIS.map(x => `<button type="button" class="emo-btn" data-emoji="${x}" aria-pressed="${evEmoji === x}">${x}</button>`).join("")}</div></div>
        <div class="two"><select id="evCat" aria-label="Tipo">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select><button class="btn">Agregar</button></div>
      </form>
    </section>
    <div class="sec-title"><h2>Todo el mes</h2></div>
    <section class="card">${monthEv.length ? monthEv.map(evRow).join("") : `<div class="empty">Nada registrado este mes.</div>`}</section>
  </div></main>`;
}

const FREQ = [[1, "Diario"], [7, "Cada semana"], [14, "Cada 2 semanas"], [30, "Cada mes"], [60, "Cada 2 meses"], [90, "Cada 3 meses"], [180, "Cada 6 meses"], [365, "Cada año"]];
const freqLabel = f => {
  if (!f) return "Una sola vez";
  const k = FREQ.find(x => x[0] === f); if (k) return k[1];
  if (f % 365 === 0) return `Cada ${f / 365} años`;
  if (f % 30 === 0) return `Cada ${f / 30} meses`;
  if (f % 7 === 0) return `Cada ${f / 7} semanas`;
  return `Cada ${f} días`;
};
let mtTipo = "30";
function vCasa() {
  const list = S.casa_mantenimiento.filter(mPend).map(m => ({ m, s: mStatus(m) })).sort((a, b) => a.s.diff - b.s.diff);
  const hechas = S.casa_mantenimiento.filter(m => !mPend(m)).sort((a, b) => b.completada_en.localeCompare(a.completada_en));
  const venc = list.filter(x => x.s.diff < 0).length;
  return hero("casa", "Mantenimiento", venc ? `${venc} ${venc === 1 ? "pendiente vencido" : "pendientes vencidos"}` : "La casa está al día", "Las tareas que se repiten se vuelven a programar al marcarlas como hechas.") + `<main class="gut"><div class="wrap pull stack">
    <form class="card addform" id="mtForm">
      <input type="text" id="mtText" placeholder="Ej. Limpiar canaletas" autocomplete="off" enterkeyhint="done">
      <div class="two"><select id="mtArea" aria-label="Área">${["General", "Cocina", "Baños", "Recámaras", "Exterior", "Auto"].map(a => `<option>${a}</option>`).join("")}</select>
      <select id="mtFreq" aria-label="Cada cuánto"><option value="una" ${mtTipo === "una" ? "selected" : ""}>Una sola vez</option>${FREQ.map(([d, l]) => `<option value="${d}" ${mtTipo === String(d) ? "selected" : ""}>${l}</option>`).join("")}<option value="otra" ${mtTipo === "otra" ? "selected" : ""}>Otra…</option></select></div>
      <div class="field" id="mtOtra" ${mtTipo === "otra" ? "" : "hidden"}><label for="mtN">Repetir cada</label><div class="two"><input type="number" id="mtN" min="1" max="365" value="3" inputmode="numeric" style="background:var(--bg);border:1.5px solid var(--line);border-radius:12px;padding:11px 12px;width:100%"><select id="mtUnidad" aria-label="Unidad"><option value="1">días</option><option value="7" selected>semanas</option><option value="30">meses</option></select></div></div>
      <div class="field"><label for="mtFecha" id="mtFechaLbl">${mtTipo === "una" ? "¿Para cuándo?" : "¿Cuándo toca la primera vez?"}</label><input type="date" id="mtFecha" value="${iso(TODAY)}"></div>
      <button class="btn">Agregar</button>
    </form>
    <section class="card">${list.length ? list.map(({ m, s }) => `<div class="mt">
      <div class="ring" style="--p:${s.p};--rc:${s.col}"><span>${s.diff < 0 ? "!" : s.diff + "d"}</span></div>
      <div class="t" data-mtedit-area="${m.id}"><b>${esc(m.texto)}</b><span class="small muted">${esc(m.area)} · ${freqLabel(m.frecuencia_dias)}${!unaVez(m) && m.fecha_inicio ? ` · desde ${fmtShort(parse(m.fecha_inicio))}` : ""} · ${unaVez(m) ? "para el" : "próxima"} ${fmtShort(s.next)}</span></div>
      <div class="mt-actions"><span class="pill ${s.cls}">${s.txt}</span><button class="btn sm" data-mtdone="${m.id}">Hecho</button></div>
      <div class="mt-side"><button class="x" data-mtedit="${m.id}" aria-label="Editar ${esc(m.texto)}" title="Editar"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg></button><button class="x" data-del="casa_mantenimiento:${m.id}" aria-label="Borrar">×</button></div></div>`).join("") : `<div class="empty">Agrega tareas como cambiar filtros, fumigar o arreglar la llave del baño.</div>`}</section>
    ${hechas.length ? `<div class="sec-title"><h2>Ya hechas</h2><p>Tareas de una sola vez</p></div><section class="card">${hechas.map(m => `<div class="check done" style="gap:10px"><span class="t">${esc(m.texto)}<br><span class="small muted">${esc(m.area)} · hecha el ${fmtShort(parse(m.completada_en))}</span></span><button class="link" data-mtundo="${m.id}">Deshacer</button><button class="x" data-del="casa_mantenimiento:${m.id}" aria-label="Borrar">×</button></div>`).join("")}</section>` : ""}
  </div></main>`;
}

/* ---------- medicinas ---------- */
const fmtHora = d => d.toLocaleTimeString("es-MX", { hour: "numeric", minute: "2-digit" });
function fmtDur(ms) {
  const m = Math.round(Math.abs(ms) / 60000), h = Math.floor(m / 60), r = m % 60;
  return h ? `${h} h${r ? " " + r + " min" : ""}` : `${r} min`;
}
const tomasDe = id => S.casa_tomas.filter(t => t.medicina_id === id).sort((a, b) => a.dada_en.localeCompare(b.dada_en));
function medEstado(m) {
  const ts = tomasDe(m.id), last = ts.length ? new Date(ts[ts.length - 1].dada_en) : null;
  const terminada = !m.activa || (m.fin && m.fin < iso(TODAY));
  if (terminada) return { last, terminada: true, txt: "Terminada", cls: "p-both" };
  if (!m.cada_horas) return { last, txt: "Solo si la necesita", cls: "p-both" };
  const next = last ? new Date(+last + Number(m.cada_horas) * 3600000) : new Date(m.inicio), diff = next - Date.now();
  if (diff > 0) return { last, next, diff, txt: `Siguiente ${fmtHora(next)} · en ${fmtDur(diff)}`, cls: diff < 30 * 60000 ? "p-warn" : "p-ok" };
  return { last, next, diff, txt: `Le tocaba a las ${fmtHora(next)} · hace ${fmtDur(diff)}`, cls: "p-bad", tarde: true };
}
function medCardInicio() {
  const act = S.casa_medicinas.filter(m => !medEstado(m).terminada);
  if (!act.length) return "";
  return `<section class="card"><div class="tile-head"><h3><i style="background:var(--c-salud)"></i>Medicinas de ${esc(ninaO("la niña"))}</h3><button class="link" data-go="salud">Ver</button></div>
    ${act.map(m => { const st = medEstado(m); return `<div class="row between" style="padding:6px 0;flex-wrap:nowrap"><span style="min-width:0"><b>${esc(m.nombre)}</b>${m.dosis ? ` <span class="muted small">${esc(m.dosis)}</span>` : ""}</span><span class="pill ${st.cls}">${st.next ? (st.tarde ? "¡Ya toca!" : fmtHora(st.next)) : "Si la necesita"}</span></div>`; }).join("")}</section>`;
}
let medFormOpen = false, medCada = "8", medDias = "7";
const cadaLabel = h => { h = Number(h); return h >= 24 && h % 24 === 0 ? (h === 24 ? "cada 24 h" : `cada ${h / 24} días`) : `cada ${h} h`; };
function vSalud() {
  const meds = S.casa_medicinas.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
  const act = meds.filter(m => !medEstado(m).terminada), fin = meds.filter(m => medEstado(m).terminada);
  const tarde = act.filter(m => medEstado(m).tarde).length;
  const n = nina();
  const card = m => { const st = medEstado(m), ts = tomasDe(m.id), hoy = ts.filter(t => iso(new Date(t.dada_en)) === iso(TODAY));
    return `<article class="card med ${st.tarde ? "late" : ""}">
      <div class="row between" style="flex-wrap:nowrap;align-items:flex-start"><div style="min-width:0"><h3 style="font-size:1.2rem">💊 ${esc(m.nombre)}</h3>
        <div class="muted small">${[m.dosis, m.cada_horas ? cadaLabel(m.cada_horas) : "según necesidad", m.fin ? `hasta el ${fmtShort(parse(m.fin))}` : ""].filter(Boolean).map(esc).join(" · ")}</div></div>
        <button class="x" data-del="casa_medicinas:${m.id}" aria-label="Borrar medicina">×</button></div>
      ${m.notas ? `<div class="small" style="margin-top:6px">📝 ${esc(m.notas)}</div>` : ""}
      ${st.terminada ? "" : `<div style="margin-top:10px"><span class="pill ${st.cls}">${esc(st.txt)}</span></div>`}
      <div class="small muted" style="margin-top:8px">${st.last ? `Última: ${cap(fmtRel(st.last))} · ${esc(nameOf(ts[ts.length - 1].dada_por))}` : "Aún no se registra ninguna toma."}${hoy.length ? ` · ${hoy.length} hoy` : ""}</div>
      <div class="row" style="margin-top:12px">${st.terminada ? `<button class="btn soft sm" data-medon="${m.id}">Reactivar</button>` : `<button class="btn" data-dar="${m.id}">Ya se la di</button><button class="btn soft sm" data-medoff="${m.id}">Terminar tratamiento</button>`}</div>
    </article>`; };
  const hist = S.casa_tomas.slice().sort((a, b) => b.dada_en.localeCompare(a.dada_en)).slice(0, 25);
  const medName = id => (S.casa_medicinas.find(m => m.id === id) || {}).nombre || "Medicina";
  return hero("salud", n ? `Salud de ${n}` : "Salud de la niña", tarde ? `${tarde === 1 ? "1 medicina" : tarde + " medicinas"} por dar` : act.length ? "Medicinas al día" : "Sin medicinas", act.length ? "Marca cada toma y los dos ven a qué hora le toca la siguiente." : "Agrega una medicina cuando la necesite y les avisamos a su hora.") + `<main class="gut"><div class="wrap pull stack">
    ${!n ? `<div class="card small">¿Cómo se llama tu hija? Ponlo en <button class="link" id="openSheet2">Ajustes</button> y la app la llamará por su nombre.</div>` : ""}
    ${act.map(card).join("") || `<section class="card empty">No hay tratamientos activos.</section>`}
    ${medFormOpen ? `<form class="card addform" id="medForm"><h3>Nueva medicina</h3>
      <div class="field"><label for="mNombre">Medicina</label><input type="text" id="mNombre" placeholder="Ej. Amoxicilina" required autocomplete="off"></div>
      <div class="two"><div class="field"><label for="mDosis">Dosis</label><input type="text" id="mDosis" placeholder="Ej. 5 ml"></div>
        <div class="field"><label for="mCada">Cada cuánto</label><select id="mCada">${[["", "Si la necesita"], ["4", "Cada 4 h"], ["6", "Cada 6 h"], ["8", "Cada 8 h"], ["12", "Cada 12 h"], ["24", "Cada 24 h"], ["otra", "Otro…"]].map(([v, l]) => `<option value="${v}" ${v === medCada ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
      <div class="field" id="mCadaOtra" ${medCada === "otra" ? "" : "hidden"}><label for="mCadaN">Dar cada</label><div class="two"><input type="number" id="mCadaN" min="0.5" step="0.5" value="3" inputmode="decimal" style="background:var(--bg);border:1.5px solid var(--line);border-radius:12px;padding:11px 12px;width:100%"><select id="mCadaU" aria-label="Unidad"><option value="1">horas</option><option value="24">días</option></select></div></div>
      <div class="two"><div class="field"><label for="mHora">Primera toma (hoy)</label><input type="time" id="mHora" value="${pad(new Date().getHours())}:${pad(new Date().getMinutes())}"></div>
        <div class="field"><label for="mDias">Días de tratamiento</label><select id="mDias"><option value="" ${medDias === "" ? "selected" : ""}>Sin fecha fin</option>${[3, 5, 7, 10, 14].map(d => `<option value="${d}" ${String(d) === medDias ? "selected" : ""}>${d} días</option>`).join("")}<option value="otra" ${medDias === "otra" ? "selected" : ""}>Otro…</option></select></div></div>
      <div class="field" id="mDiasOtra" ${medDias === "otra" ? "" : "hidden"}><label for="mDiasN">¿Cuántos días?</label><input type="number" id="mDiasN" min="1" max="365" value="21" inputmode="numeric" style="background:var(--bg);border:1.5px solid var(--line);border-radius:12px;padding:11px 12px;width:100%"></div>
      <div class="field"><label for="mNotas">Notas</label><input type="text" id="mNotas" placeholder="Ej. con alimento, agitar antes"></div>
      <label class="check" style="border:0;padding:4px 0"><input type="checkbox" id="mYa" checked><span class="t">Ya se le dio la primera toma</span></label>
      <label class="check" style="border:0;padding:4px 0"><input type="checkbox" id="mAvisar" checked><span class="t">Avisarnos a la hora de cada toma</span></label>
      <div class="row"><button class="btn">Guardar medicina</button><button class="btn soft" type="button" id="medCancel">Cancelar</button></div>
    </form>` : `<button class="btn wide" id="medNew">+ Agregar medicina</button>`}
    <p class="small muted" style="margin:0 4px">Sigue siempre la indicación de su pediatra. La app solo ayuda a recordar horarios.</p>
    ${hist.length ? `<div class="sec-title"><h2>Historial</h2><p>Últimas tomas</p></div><section class="card">${hist.map(t => { const d = new Date(t.dada_en); return `<div class="row between" style="padding:9px 0;border-bottom:1px solid var(--line);flex-wrap:nowrap"><span style="min-width:0"><b>${esc(medName(t.medicina_id))}</b><br><span class="small muted">${cap(fmtRel(d))} · ${esc(nameOf(t.dada_por))}</span></span><button class="x" data-del="casa_tomas:${t.id}" aria-label="Borrar toma">×</button></div>`; }).join("")}</section>` : ""}
    ${fin.length ? `<div class="sec-title"><h2>Terminadas</h2></div>${fin.map(card).join("")}` : ""}
  </div></main>`;
}
function fmtRel(d) {
  const dd = new Date(d); dd.setHours(0, 0, 0, 0);
  const k = daysBetween(dd, TODAY), dia = k === 0 ? "hoy" : k === 1 ? "ayer" : d.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
  return `${dia} ${fmtHora(d)}`;
}

/* ---------- notificaciones ---------- */
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
let pushOn = false;
async function refreshPushState() {
  try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); pushOn = !!sub && Notification.permission === "granted"; }
  catch (e) { pushOn = false; }
}
function b64u(s) { const pad = "=".repeat((4 - s.length % 4) % 4), b = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(b, c => c.charCodeAt(0)); }
async function enablePush() {
  if (api.kind !== "supa") return toast("Los avisos funcionan con tu cuenta, no en el demo");
  if (!pushSupported()) return toast(isIOS() ? "En iPhone primero instala la app en tu pantalla de inicio" : "Este navegador no permite avisos");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return toast("Permiso negado. Actívalo en los ajustes del navegador para este sitio.");
  try {
    const reg = await navigator.serviceWorker.ready;
    const key = await api.vapidPublic();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64u(key) });
    const j = sub.toJSON();
    await api.saveSub({ endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth, household_id: S.hid, user_id: S.user.id, user_agent: navigator.userAgent.slice(0, 300) });
    pushOn = true; toast("Avisos activados en este teléfono");
  } catch (e) { toast("No se pudieron activar los avisos"); }
  openSheet();
}
async function disablePush() {
  try { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); if (sub) { await api.removeSub(sub.endpoint).catch(() => {}); await sub.unsubscribe(); } } catch (e) {}
  pushOn = false; toast("Avisos desactivados en este teléfono"); openSheet();
}

/* ---------- acceso ---------- */
function vAuth() {
  return `<div class="auth v-inicio"><header class="hero gut"><svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">${GLYPH.inicio}</svg><div class="wrap">
    <div class="eyebrow">Menús · súper · agenda · casa</div><h1>Casa en Orden</h1><p class="lead">La app de la familia. Entra con la misma cuenta de Finanzas Casa.</p></div></header>
    <main class="gut"><div class="wrap"><section class="card" style="max-width:440px;margin-left:auto;margin-right:auto">
      <div class="tabs2"><button data-auth="entrar" aria-selected="${authTab === "entrar"}">Entrar</button><button data-auth="crear" aria-selected="${authTab === "crear"}">Crear cuenta</button></div>
      <form id="authForm" class="stack">
        <div class="field"><label for="aEmail">Correo</label><input type="email" id="aEmail" autocomplete="email" required></div>
        <div class="field"><label for="aPass">Contraseña</label><input type="password" id="aPass" autocomplete="${authTab === "crear" ? "new-password" : "current-password"}" minlength="6" required></div>
        <div class="err" id="aErr">${esc(authMsg)}</div>
        <button class="btn wide" ${authBusy ? "disabled" : ""}>${authTab === "crear" ? "Crear cuenta" : "Entrar"}</button>
      </form>
      <div class="field" style="margin-top:16px"><label>Elige tus colores</label>${temaPicker()}</div>
      ${authTab === "entrar" ? `<div class="row between" style="margin-top:12px"><button class="link" id="forgot" style="color:var(--m1)">Olvidé mi contraseña</button><button class="link" id="demo" style="color:var(--muted)">Probar sin cuenta</button></div>` : ""}
    </section>${installCard() ? `<div style="max-width:440px;margin:12px auto 0">${installCard()}</div>` : ""}</div></main></div>`;
}
function vHogar() {
  return `<div class="auth v-inicio"><header class="hero gut"><div class="wrap"><div class="eyebrow">Un paso más</div><h1>Tu hogar</h1><p class="lead">Únete con el código que te comparta tu pareja, o crea un hogar nuevo.</p></div></header>
    <main class="gut"><div class="wrap stack" style="max-width:440px;margin:-60px auto 0">
      <form class="card stack" id="joinForm"><h3>Unirme con código</h3>
        <div class="field"><label for="jName">Tu nombre</label><input type="text" id="jName" required></div>
        <div class="field"><label for="jCode">Código de invitación</label><input type="text" id="jCode" style="text-transform:uppercase;letter-spacing:.1em" required></div>
        <button class="btn wide">Unirme</button></form>
      <form class="card stack" id="newForm"><h3>Crear hogar nuevo</h3>
        <div class="field"><label for="nHome">Nombre del hogar</label><input type="text" id="nHome" value="Mi casa" required></div>
        <div class="field"><label for="nName">Tu nombre</label><input type="text" id="nName" required></div>
        <button class="btn wide">Crear</button></form>
      <div class="err" id="hErr">${esc(authMsg)}</div>
      <button class="link" id="logout" style="color:var(--muted)">Cerrar sesión</button>
    </div></main></div>`;
}

function vNewPass() {
  return `<div class="auth v-inicio"><header class="hero gut"><div class="wrap"><div class="eyebrow">Recuperar acceso</div><h1>Nueva contraseña</h1></div></header>
    <main class="gut"><div class="wrap"><form class="card stack" id="passForm" style="max-width:440px;margin:-60px auto 0">
      <div class="field"><label for="nPass">Contraseña nueva</label><input type="password" id="nPass" minlength="6" autocomplete="new-password" required></div>
      <div class="err">${esc(authMsg)}</div><button class="btn wide">Guardar y entrar</button></form></div></main></div>`;
}

/* ---------- paletas ---------- */
const TEMAS = { rosa: ["Rosa", "#E2468A", "#F2607A", "#F49BBE"], azul: ["Azul", "#2C6BE8", "#1E9BD7", "#8CBCF7"], morado: ["Morado", "#7A47E0", "#A657DE", "#BCA2F4"] };
const temaActual = () => document.documentElement.dataset.tema || "rosa";
function temaPicker() {
  return `<div class="temas" role="group" aria-label="Paleta de colores">${Object.entries(TEMAS).map(([k, [n, a, b, c]]) =>
    `<button class="tema" data-tema="${k}" aria-pressed="${temaActual() === k}"><span class="sw"><i style="background:${a}"></i><i style="background:${b}"></i><i style="background:${c}"></i></span>${n}</button>`).join("")}</div>`;
}
function setTema(k) {
  if (!TEMAS[k]) return;
  document.documentElement.dataset.tema = k; ls.set("casa-tema", k);
  if ($("#sheet").innerHTML) openSheet();
  render();
}

/* ---------- ajustes ---------- */
function openSheet() {
  const m = me(), h = S.households.find(x => x.id === S.hid);
  $("#sheet").innerHTML = `<div class="sheet-bg" id="sheetBg"><div class="sheet" role="dialog" aria-modal="true" aria-label="Ajustes"><div class="grab"></div>
    <div class="stack">
      <h2 style="font-size:1.5rem">${esc(h ? h.name : "Mi hogar")}</h2>
      <div class="field"><label>Colores de la app</label>${temaPicker()}</div>
      <div class="field"><label for="ninaName">Nombre de tu hija</label><div class="row" style="flex-wrap:nowrap"><input type="text" id="ninaName" placeholder="Ej. Sofía" value="${esc(nina())}"><button class="btn sm" id="saveNina" style="background:var(--ink);color:var(--bg)">Guardar</button></div></div>
      <div class="field"><label>Avisos en este teléfono</label>
        <div class="small muted">Medicinas a su hora, eventos de hoy y mañana, tus tareas del día y mantenimiento pendiente (resumen a las 8:00).</div>
        <div class="row">${pushOn ? `<span class="pill p-ok">Activados</span><button class="btn soft sm" id="pushTest" style="background:var(--sunk);color:var(--ink)">Probar</button><button class="link" id="pushOff" style="color:var(--bad)">Desactivar</button>` : `<button class="btn sm" id="pushOn" style="background:var(--c-inicio);color:#fff">🔔 Activar avisos</button>`}</div></div>
      <div class="field"><label for="myName">Tu nombre en la app</label><div class="row" style="flex-wrap:nowrap"><input type="text" id="myName" value="${esc(m ? m.display_name : "")}"><button class="btn sm" id="saveName" style="background:var(--ink);color:var(--bg)">Guardar</button></div></div>
      ${api.kind === "supa" && h && h.code ? `<div class="field"><label>Código para invitar a tu esposa</label><div class="code">${esc(h.code)}</div>
        <div class="small muted">Ella instala la app, crea su cuenta y elige “Unirme con código”. Ojo: este mismo código también le da acceso a Finanzas Casa.</div>
        <button class="btn soft sm" id="copyCode" style="background:var(--sunk);color:var(--ink);align-self:flex-start">Copiar código</button></div>` : ""}
      <div class="field"><label>Miembros</label>${S.members.map((x, i) => `<div class="row" style="padding:4px 0"><span class="pill ${i % 2 ? "p-m2" : "p-m1"}">${esc(x.display_name || "Sin nombre")}</span>${x.user_id === S.user.id ? `<span class="small muted">tú</span>` : ""}</div>`).join("")}</div>
      ${S.households.length > 1 ? `<div class="field"><label for="hSel">Cambiar de hogar</label><select id="hSel">${S.households.map(x => `<option value="${esc(x.id)}" ${x.id === S.hid ? "selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>` : ""}
      <div class="row between"><span class="small muted">${api.kind === "demo" ? "Modo demo: los datos viven solo en este teléfono." : esc(S.user.email || "")}</span><button class="link" id="logout" style="color:var(--bad)">${api.kind === "demo" ? "Salir del demo" : "Cerrar sesión"}</button></div>
    </div></div></div>`;
}
const closeSheet = () => { $("#sheet").innerHTML = ""; };

/* ---------- editar tarea de la casa ---------- */
const AREAS = ["General", "Cocina", "Baños", "Recámaras", "Exterior", "Auto"];
let editTipo = null;
function openEditMt(id) {
  const m = S.casa_mantenimiento.find(x => x.id === id); if (!m) return;
  const f = m.frecuencia_dias, enLista = f && FREQ.some(x => x[0] === f);
  editTipo = !f ? "una" : enLista ? String(f) : "otra";
  const unidad = f && f % 30 === 0 ? 30 : f && f % 7 === 0 ? 7 : 1, n = f ? f / unidad : 3;
  const fecha = iso(mStatus(m).next);
  const areas = AREAS.includes(m.area) ? AREAS : AREAS.concat(m.area);
  $("#sheet").innerHTML = `<div class="sheet-bg v-casa" id="sheetBg"><div class="sheet" role="dialog" aria-modal="true" aria-label="Editar tarea"><div class="grab"></div>
    <form class="stack" id="mtEditForm" data-id="${esc(m.id)}">
      <h2 style="font-size:1.4rem">Editar tarea</h2>
      <div class="field"><label for="meText">Tarea</label><input type="text" id="meText" value="${esc(m.texto)}" required autocomplete="off"></div>
      <div class="two"><div class="field"><label for="meArea">Área</label><select id="meArea">${areas.map(a => `<option ${a === m.area ? "selected" : ""}>${esc(a)}</option>`).join("")}</select></div>
        <div class="field"><label for="meFreq">Cada cuánto</label><select id="meFreq"><option value="una" ${editTipo === "una" ? "selected" : ""}>Una sola vez</option>${FREQ.map(([d, l]) => `<option value="${d}" ${editTipo === String(d) ? "selected" : ""}>${l}</option>`).join("")}<option value="otra" ${editTipo === "otra" ? "selected" : ""}>Otra…</option></select></div></div>
      <div class="field" id="meOtra" ${editTipo === "otra" ? "" : "hidden"}><label for="meN">Repetir cada</label><div class="two"><input type="number" id="meN" min="1" max="365" value="${n}" inputmode="numeric" style="background:var(--bg);border:1.5px solid var(--line);border-radius:12px;padding:11px 12px;width:100%"><select id="meUnidad" aria-label="Unidad">${[[1, "días"], [7, "semanas"], [30, "meses"]].map(([v, l]) => `<option value="${v}" ${v === unidad ? "selected" : ""}>${l}</option>`).join("")}</select></div></div>
      <div class="field"><label for="meFecha" id="meFechaLbl">${editTipo === "una" ? "¿Para cuándo?" : "¿Cuándo toca la próxima vez?"}</label><input type="date" id="meFecha" value="${fecha}"></div>
      ${!editTipo || editTipo === "una" ? "" : `<div class="small muted">Desde ahí se seguirá repitiendo con la frecuencia que elijas.</div>`}
      <div class="row"><button class="btn">Guardar cambios</button><button class="btn soft" type="button" id="meCancel">Cancelar</button></div>
    </form></div></div>`;
}

/* ---------- instalación ---------- */
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferredInstall = e; if (S.screen === "app") render(); });
window.addEventListener("appinstalled", () => { deferredInstall = null; ls.set("casa-installed", true); render(); });
const standalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function installCard() {
  if (standalone() || ls.get("casa-install-hide", false)) return "";
  if (deferredInstall) return `<div class="install"><p><b>Instala Casa en Orden</b><br>Ábrela como app desde tu pantalla de inicio.</p><button class="btn sm" id="doInstall">Instalar</button><button class="x" id="hideInstall" aria-label="Ocultar" style="color:inherit">×</button></div>`;
  if (isIOS()) return `<div class="install"><p><b>Instálala en tu iPhone:</b> ábrela en Safari, toca Compartir <span aria-hidden="true">⎋</span> y luego “Agregar a pantalla de inicio”.</p><button class="x" id="hideInstall" aria-label="Ocultar" style="color:inherit">×</button></div>`;
  return `<div class="install"><p><b>Bájala a tu cel:</b> en Chrome toca el menú <b>⋮</b> (arriba a la derecha) y elige <b>“Instalar app”</b> o “Agregar a la pantalla principal”.</p><button class="x" id="hideInstall" aria-label="Ocultar" style="color:inherit">×</button></div>`;
}

/* ---------- render ---------- */
function render() {
  const app = $("#app");
  const keep = {}; app.querySelectorAll("input[id]:not([type=checkbox]), select[id]").forEach(el => keep[el.id] = el.value);
  const focus = document.activeElement && document.activeElement.id;
  let html, cls;
  if (S.screen === "boot") { html = `<div class="auth v-inicio"><header class="hero gut"><div class="wrap"><div class="eyebrow">Cargando…</div><h1>Casa en Orden</h1></div></header></div>`; cls = "v-inicio"; }
  else if (S.screen === "auth") { html = vAuth(); cls = "v-inicio"; }
  else if (S.screen === "hogar") { html = vHogar(); cls = "v-inicio"; }
  else if (S.screen === "newpass") { html = vNewPass(); cls = "v-inicio"; }
  else { html = { inicio: vInicio, comida: vComida, super: vSuper, agenda: vAgenda, salud: vSalud, casa: vCasa }[view](); cls = "v-" + view; }
  if (api && api.kind === "demo" && S.screen === "app") html = `<div class="demo-banner">Modo demo: datos de ejemplo guardados solo en este teléfono</div>` + html;
  document.body.className = cls;
  app.innerHTML = html;
  Object.entries(keep).forEach(([id, v]) => { const el = document.getElementById(id); if (el && v !== "") el.value = v; });
  if (focus) { const el = document.getElementById(focus); if (el && el.tagName !== "BUTTON") el.focus({ preventScroll: true }); }
  const dock = $("#dock"); dock.hidden = S.screen !== "app";
  dock.querySelectorAll("button").forEach(b => b.dataset.go === view ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current"));
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(document.body).getPropertyValue("--sec").trim() || "#14171F";
}
function go(v, s) {
  if (s) sub[v] = s;
  const changed = v !== view; view = v;
  if (location.hash.slice(1) !== v) { try { history.replaceState(null, "", "#" + v); } catch (e) {} }
  render();
  if (changed) { window.scrollTo(0, 0); const m = $("#app main"); if (m) m.classList.add("view-enter"); }
}
window.addEventListener("hashchange", () => { const h = location.hash.slice(1); if (VIEWS.includes(h) && h !== view) go(h); });

/* ---------- eventos ---------- */
document.addEventListener("click", async e => {
  const b = e.target.closest("button"); if (!b) { const ed = e.target.closest("[data-mtedit-area]"); if (ed) return openEditMt(ed.dataset.mteditArea); if (e.target.id === "sheetBg") closeSheet(); return; }
  const d = b.dataset;
  if (d.go) { e.preventDefault(); return go(d.go, d.sub); }
  if (d.sub) { sub[view] = d.sub; return render(); }
  if (d.tema) return setTema(d.tema);
  if (d.emoji) { evEmoji = evEmoji === d.emoji ? null : d.emoji; return render(); }
  if (d.auth) { authTab = d.auth; authMsg = ""; return render(); }
  if (d.chip) { const [k, v] = d.chip.split(":"), a = S.sel[k], i = a.indexOf(v); i >= 0 ? a.splice(i, 1) : a.push(v); ls.set("casa-sel", S.sel); return render(); }
  if (d.dar) return add("casa_tomas", { medicina_id: d.dar, dada_en: new Date().toISOString(), dada_por: S.user.id }, "Toma registrada");
  if (d.medoff) return patch("casa_medicinas", d.medoff, { activa: false }, "Tratamiento terminado");
  if (d.medon) return patch("casa_medicinas", d.medon, { activa: true, fin: null }, "Tratamiento reactivado");
  if (d.del) { e.preventDefault(); const [t, id] = d.del.split(":"); if (t === "casa_medicinas") S.casa_tomas = S.casa_tomas.filter(x => x.medicina_id !== id); return del(t, id); }
  if (d.who) { whoFilter = d.who; return render(); }
  if (d.day) { calSel = d.day; const dd = parse(d.day); if (dd.getMonth() !== calMonth.getMonth()) calMonth = new Date(dd.getFullYear(), dd.getMonth(), 1); return render(); }
  if (d.mtdone) { const m = S.casa_mantenimiento.find(x => x.id === d.mtdone); return m && unaVez(m) ? patch("casa_mantenimiento", m.id, { completada_en: iso(TODAY), ultima: iso(TODAY) }, "¡Listo! Tarea terminada") : patch("casa_mantenimiento", d.mtdone, { ultima: iso(TODAY) }, "Listo, se programó la siguiente"); }
  if (d.mtedit) return openEditMt(d.mtedit);
  if (b.id === "meCancel") return closeSheet();
  if (d.mtundo) return patch("casa_mantenimiento", d.mtundo, { completada_en: null }, "Regresó a pendientes");
  if (d.shop) return addToSuper(menus[+d.shop].shop);
  switch (b.id) {
    case "gen": genMenus(); render(); return document.querySelector(".dish")?.scrollIntoView({ behavior: "smooth", block: "start" });
    case "nextLunch": lunchIdx = (lunchIdx + 1) % LUNCHES.length; return render();
    case "lunchSuper": return addToSuper(LUNCHES[lunchIdx].shop);
    case "clearOk": S.casa_super.filter(i => i.comprado).forEach(i => del("casa_super", i.id)); return toast("Comprados quitados de la lista");
    case "prevM": case "nextM": calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + (b.id === "prevM" ? -1 : 1), 1); return render();
    case "openSheet": case "openSheet2": await refreshPushState(); return openSheet();
    case "saveNina": { const n = $("#ninaName").value.trim(); S.casa_config = [Object.assign({ household_id: S.hid }, S.casa_config[0], { nina_nombre: n || null })]; closeSheet(); render(); return write(() => api.saveConfig(S.hid, { nina_nombre: n || null }), "Nombre guardado"); }
    case "pushOn": return enablePush();
    case "pushOff": return disablePush();
    case "pushTest": try { await api.testPush(); toast("Enviado: debe llegarte en unos segundos"); } catch (err) { toast("No se pudo enviar la prueba"); } return;
    case "medNew": medFormOpen = true; render(); return $("#mNombre") && $("#mNombre").focus();
    case "medCancel": medFormOpen = false; return render();
    case "nextTema": { const ks = Object.keys(TEMAS), n = ks[(ks.indexOf(temaActual()) + 1) % ks.length]; setTema(n); return toast("Paleta " + TEMAS[n][0].toLowerCase()); }
    case "saveName": { const n = $("#myName").value.trim(); if (!n) return; const m = me(); if (m) m.display_name = n; closeSheet(); render(); return write(() => api.setMyName(S.hid, S.user.id, n), "Nombre guardado"); }
    case "copyCode": { const c = S.households.find(x => x.id === S.hid).code; try { await navigator.clipboard.writeText(c); toast("Código copiado"); } catch (err) { toast("Código: " + c); } return; }
    case "logout": closeSheet(); await api.signOut(); ls.del("casa-modo"); location.reload(); return;
    case "doInstall": if (deferredInstall) { deferredInstall.prompt(); await deferredInstall.userChoice.catch(() => {}); deferredInstall = null; render(); } return;
    case "hideInstall": ls.set("casa-install-hide", true); return render();
    case "demo": ls.set("casa-modo", "demo"); location.reload(); return;
    case "forgot": {
      const em = $("#aEmail").value.trim(); if (!em) { authMsg = "Escribe tu correo y vuelve a tocar “Olvidé mi contraseña”."; return render(); }
      try { await api.reset(em); authMsg = "Te enviamos un correo para cambiar tu contraseña."; } catch (err) { authMsg = "No se pudo enviar el correo."; }
      return render();
    }
  }
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.dataset.done) return patch("casa_tareas", t.dataset.done, { hecho_semana: t.checked ? wkKey() : null });
  if (t.dataset.sup) return patch("casa_super", t.dataset.sup, { comprado: t.checked });
  if (t.id === "mCada") { medCada = t.value; $("#mCadaOtra").hidden = medCada !== "otra"; return; }
  if (t.id === "mDias") { medDias = t.value; $("#mDiasOtra").hidden = medDias !== "otra"; return; }
  if (t.id === "meFreq") { editTipo = t.value; $("#meOtra").hidden = editTipo !== "otra"; $("#meFechaLbl").textContent = editTipo === "una" ? "¿Para cuándo?" : "¿Cuándo toca la próxima vez?"; return; }
  if (t.id === "mtFreq") { mtTipo = t.value; $("#mtOtra").hidden = mtTipo !== "otra"; $("#mtFechaLbl").textContent = mtTipo === "una" ? "¿Para cuándo?" : "¿Cuándo toca la primera vez?"; return; }
  if (t.id === "hSel") { ls.set("casa-hogar", t.value); location.reload(); }
});
document.addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target.id, val = id => $("#" + id).value.trim(), clear = id => { $("#" + id).value = ""; };
  if (f === "supForm") { const v = val("supText"); if (!v) return; clear("supText"); return add("casa_super", { texto: v, pasillo: $("#supCat").value, comprado: false }); }
  if (f === "wkForm") { const v = val("wkText"); if (!v) return; clear("wkText"); return add("casa_tareas", { dia: +$("#wkDay").value, texto: v, asignado: $("#wkWho").value || null }, "Actividad asignada"); }
  if (f === "evForm") { const v = val("evText"), dt = $("#evDate").value; if (!v || !dt) return; clear("evText"); calSel = dt; const em = evEmoji; evEmoji = null; return add("casa_eventos", { fecha: dt, hora: $("#evTime").value || null, texto: v, tipo: $("#evCat").value, emoji: em }, "Evento agregado"); }
  if (f === "medForm") {
    const nombre = val("mNombre"); if (!nombre) return;
    const [hh, mm] = ($("#mHora").value || "").split(":").map(Number), ini = new Date(); if (!isNaN(hh)) ini.setHours(hh, mm || 0, 0, 0);
    let cada = $("#mCada").value, dias = $("#mDias").value;
    if (cada === "otra") { const h = Math.round((+$("#mCadaN").value || 0) * +$("#mCadaU").value * 100) / 100; if (!(h > 0 && h <= 168)) return toast("Elige entre media hora y 7 días"); cada = String(h); }
    dias = dias === "otra" ? Math.max(1, Math.min(365, Math.round(+$("#mDiasN").value || 1))) : +dias;
    medCada = "8"; medDias = "7";
    medFormOpen = false;
    const mid = uuid(), ya = $("#mYa").checked;
    await add("casa_medicinas", { id: mid, nombre, dosis: val("mDosis") || null, cada_horas: cada ? +cada : null, inicio: ini.toISOString(), fin: dias ? iso(addDays(TODAY, dias - 1)) : null, notas: val("mNotas") || null, activa: true, avisar: $("#mAvisar").checked }, "Medicina agregada");
    if (ya && S.casa_medicinas.some(m => m.id === mid)) add("casa_tomas", { medicina_id: mid, dada_en: ini.toISOString(), dada_por: S.user.id });
    return;
  }
  if (f === "mtEditForm") {
    const id = e.target.dataset.id, texto = val("meText"); if (!texto) return;
    const tipo = $("#meFreq").value, fecha = $("#meFecha").value || iso(TODAY), area = $("#meArea").value;
    let p;
    if (tipo === "una") p = { texto, area, frecuencia_dias: null, fecha_limite: fecha };
    else {
      const freq = Math.min(3650, tipo === "otra" ? Math.round(Math.max(1, Math.min(365, +$("#meN").value || 1)) * +$("#meUnidad").value) : +tipo);
      const m = S.casa_mantenimiento.find(x => x.id === id);
      p = { texto, area, frecuencia_dias: freq, fecha_limite: null, ultima: iso(addDays(parse(fecha), -freq)), fecha_inicio: (m && m.fecha_inicio) || fecha };
    }
    closeSheet();
    return patch("casa_mantenimiento", id, p, "Cambios guardados");
  }
  if (f === "mtForm") {
    const v = val("mtText"); if (!v) return;
    const tipo = $("#mtFreq").value, fecha = $("#mtFecha").value || iso(TODAY);
    if (tipo === "una") { clear("mtText"); return add("casa_mantenimiento", { texto: v, area: $("#mtArea").value, frecuencia_dias: null, fecha_limite: fecha, ultima: iso(TODAY) }, "Tarea agregada"); }
    const freq = tipo === "otra" ? Math.round(Math.max(1, Math.min(365, +$("#mtN").value || 1)) * +$("#mtUnidad").value) : +tipo;
    clear("mtText");
    return add("casa_mantenimiento", { texto: v, area: $("#mtArea").value, frecuencia_dias: Math.min(freq, 3650), fecha_inicio: fecha, ultima: iso(addDays(parse(fecha), -freq)) }, `Agregada: ${freqLabel(freq).toLowerCase()}, primera vez el ${fmtShort(parse(fecha))}`);
  }
  if (f === "authForm") {
    const em = val("aEmail"), pw = $("#aPass").value; authBusy = true; authMsg = ""; render();
    try {
      if (authTab === "crear") { const inNow = await api.signUp(em, pw); authMsg = inNow ? "" : "Cuenta creada. Revisa tu correo para confirmarla y luego entra aquí."; if (!inNow) authTab = "entrar"; }
      else await api.signIn(em, pw);
    } catch (err) { authMsg = /invalid login/i.test(err.message || "") ? "Correo o contraseña incorrectos." : /confirm/i.test(err.message || "") ? "Confirma tu correo antes de entrar." : /registered/i.test(err.message || "") ? "Ese correo ya tiene cuenta. Usa “Entrar”." : "No se pudo: " + (err.message || "error"); }
    authBusy = false; render();
    if (await api.user()) enter();
    return;
  }
  if (f === "passForm") {
    try { await api.setPassword($("#nPass").value); authMsg = ""; toast("Contraseña actualizada"); enter(); }
    catch (err) { authMsg = "No se pudo cambiar: " + (err.message || "error"); render(); }
    return;
  }
  if (f === "joinForm" || f === "newForm") {
    try {
      if (f === "joinForm") await api.joinHousehold(val("jCode"), val("jName"));
      else await api.createHousehold(val("nHome"), val("nName"));
      authMsg = ""; enter();
    } catch (err) { authMsg = f === "joinForm" ? "Código no válido. Revísalo con tu pareja." : "No se pudo crear el hogar."; render(); }
  }
});
function addToSuper(items) {
  const have = new Set(S.casa_super.filter(i => !i.comprado).map(i => i.texto.toLowerCase()));
  const nuevos = items.filter(t => !have.has(t.toLowerCase()));
  if (!nuevos.length) return toast("Ya estaba todo en la lista");
  nuevos.forEach(t => add("casa_super", { texto: t, pasillo: "Otro", comprado: false }));
  toast(`${nuevos.length} ${nuevos.length === 1 ? "artículo agregado" : "artículos agregados"} al súper`);
}

/* ---------- arranque ---------- */
genMenus();
setInterval(() => { if (S.screen === "app" && !document.hidden && (view === "salud" || view === "inicio") && !(document.activeElement && /INPUT|SELECT/.test(document.activeElement.tagName))) render(); }, 60000);
if ("serviceWorker" in navigator) navigator.serviceWorker.addEventListener("message", e => { if (e.data && e.data.go && VIEWS.includes(e.data.go)) go(e.data.go); });
render();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
if (ls.get("casa-modo", null) === "demo" || !window.supabase) {
  api = demoApi();
  if (!window.supabase && ls.get("casa-modo", null) !== "demo") { S.screen = "auth"; authMsg = "Sin conexión: no se pudo cargar el servicio. Puedes probar el modo demo."; api = supaStub(); render(); }
  else enter();
} else {
  api = supaApi();
  api.onAuth((ev) => { if (ev === "SIGNED_OUT") { S.screen = "auth"; render(); } if (ev === "PASSWORD_RECOVERY") { S.screen = "newpass"; render(); } });
  enter();
}
function supaStub() { const d = demoApi(); d.kind = "offline"; d.user = async () => null; return d; }
})();
