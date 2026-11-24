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
const TABLES = ["casa_super", "casa_tareas", "casa_eventos", "casa_mantenimiento"];

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
    async list(t, hid) { return must(await sb.from(t).select("*").eq("household_id", hid).order("created_at")); },
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
    async insert(t, row) { const r = Object.assign({ id: uuid(), created_at: new Date().toISOString() }, row); db[t].push(r); persist(); return r; },
    async update(t, id, patch) { const r = db[t].find(x => x.id === id); if (r) Object.assign(r, patch); persist(); },
    async remove(t, id) { db[t] = db[t].filter(x => x.id !== id); persist(); },
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
    casa_eventos: [r({ fecha: ym(5), hora: "18:00", texto: "Junta de padres", tipo: "escuela" }), r({ fecha: iso(addDays(TODAY, 2)), hora: null, texto: "Cena con los abuelos", tipo: "familia" }),
      r({ fecha: iso(addDays(TODAY, 6)), hora: "16:00", texto: "Cumpleaños de la prima", tipo: "cumple" }), r({ fecha: iso(addDays(TODAY, 11)), hora: "09:00", texto: "Festival escolar", tipo: "escuela" }),
      r({ fecha: ym(20), hora: "10:30", texto: "Pediatra", tipo: "salud" })],
    casa_mantenimiento: [["Cambiar filtro del purificador", "Cocina", 90, -97], ["Limpiar campana de la estufa", "Cocina", 30, -24], ["Limpiar filtro del minisplit", "Recámaras", 60, -63],
      ["Revisar detectores de humo", "General", 180, -40], ["Fumigación", "General", 180, -150]]
      .map(([t, a, f, d]) => r({ texto: t, area: a, frecuencia_dias: f, ultima: iso(addDays(TODAY, d)) })),
  };
}

/* ---------- estado ---------- */
let api = null;
const S = {
  user: null, screen: "boot", hid: null, households: [], members: [], sync: "conectando",
  casa_super: [], casa_tareas: [], casa_eventos: [], casa_mantenimiento: [],
  sel: ls.get("casa-sel", { p: ["pollo"], s: ["arroz"], v: ["brocoli", "zanahoria"] }),
};
const VIEWS = ["inicio", "comida", "super", "agenda", "casa"];
let view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "inicio";
const sub = { comida: "menus", agenda: "semana" };
let whoFilter = "todos", calMonth = new Date(TODAY.getFullYear(), TODAY.getMonth(), 1), calSel = iso(TODAY);
let authTab = "entrar", authMsg = "", authBusy = false;

const me = () => S.members.find(m => m.user_id === (S.user && S.user.id));
const memberIdx = uid => S.members.findIndex(m => m.user_id === uid);
const nameOf = uid => { if (!uid) return "Los dos"; const m = S.members.find(x => x.user_id === uid); return m ? (m.display_name || "Sin nombre") : "Ex-miembro"; };
const pillWho = uid => `<span class="pill ${!uid ? "p-both" : memberIdx(uid) % 2 ? "p-m2" : "p-m1"}">${esc(nameOf(uid))}</span>`;
const initial = s => esc((s || "?").trim().charAt(0).toUpperCase() || "?");

/* ---------- carga y sincronización ---------- */
async function loadAll(t) {
  const list = t ? [t] : TABLES;
  try {
    const res = await Promise.all(list.map(x => api.list(x, S.hid)));
    list.forEach((x, i) => S[x] = res[i]);
    ls.set("casa-cache-" + S.hid, { casa_super: S.casa_super, casa_tareas: S.casa_tareas, casa_eventos: S.casa_eventos, casa_mantenimiento: S.casa_mantenimiento });
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
function mStatus(m) {
  const next = addDays(parse(m.ultima), m.frecuencia_dias), diff = daysBetween(TODAY, next);
  const p = Math.max(0, Math.min(100, Math.round(100 * (1 - diff / m.frecuencia_dias))));
  if (diff < 0) return { next, diff, p: 100, cls: "p-bad", txt: `Vencido hace ${-diff} d`, col: "var(--bad)" };
  if (diff <= 14) return { next, diff, p, cls: "p-warn", txt: diff === 0 ? "Toca hoy" : `En ${diff} d`, col: "var(--warn)" };
  return { next, diff, p, cls: "p-ok", txt: "Al día", col: "var(--ok)" };
}
const isDone = t => t.hecho_semana === wkKey();
const CATS = { escuela: "Escuela", salud: "Salud", familia: "Familia", cumple: "Cumpleaños", otro: "Pagos / otro" };
const PASILLOS = ["Frutas y verduras", "Carnes", "Lácteos", "Despensa", "Limpieza", "Otro"];
const greet = () => { const h = new Date().getHours(); return h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches"; };

function evRow(e) {
  const d = parse(e.fecha);
  return `<div class="ev t-${esc(e.tipo)}"><div class="date"><b>${d.getDate()}</b><span>${d.toLocaleDateString("es-MX", { month: "short" }).replace(".", "")}</span></div>
    <div class="t"><b>${esc(e.texto)}</b><div class="when">${cap(d.toLocaleDateString("es-MX", { weekday: "long" }))}${e.hora ? " · " + esc(String(e.hora).slice(0, 5)) : ""} · ${CATS[e.tipo] || ""}</div></div>
    <button class="x" data-del="casa_eventos:${e.id}" aria-label="Borrar evento">×</button></div>`;
}
function taskRow(t, withDel) {
  return `<label class="check ${isDone(t) ? "done" : ""}"><input type="checkbox" data-done="${t.id}" ${isDone(t) ? "checked" : ""}><span class="t">${esc(t.texto)}</span>${pillWho(t.asignado)}${withDel ? `<button class="x" data-del="casa_tareas:${t.id}" aria-label="Borrar">×</button>` : ""}</label>`;
}

function vInicio() {
  const dIdx = (TODAY.getDay() + 6) % 7, hoy = S.casa_tareas.filter(t => t.dia === dIdx), pend = hoy.filter(t => !isDone(t)).length;
  const prox = S.casa_eventos.filter(e => e.fecha >= iso(TODAY)).sort((a, b) => (a.fecha + (a.hora || "")).localeCompare(b.fecha + (b.hora || ""))).slice(0, 3);
  const mt = S.casa_mantenimiento.map(m => ({ m, s: mStatus(m) })).filter(x => x.s.diff <= 14).sort((a, b) => a.s.diff - b.s.diff);
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
  const tabs = `<div class="seg" role="tablist"><button role="tab" data-sub="menus" aria-selected="${sub.comida === "menus"}">Menús saludables</button><button role="tab" data-sub="lunch" aria-selected="${sub.comida === "lunch"}">Lunch de la niña</button></div>`;
  if (sub.comida === "lunch") {
    const L = LUNCHES[lunchIdx];
    return hero("comida", "Lunch para 4 años", "Lonchera lista", "Fruta, verdura, cereal y proteína en cada idea.") + `<main class="gut"><div class="wrap pull stack">${tabs}
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
        ${cells.map(d => { const k = iso(d), ev = byDay[k] || []; return `<button class="d ${d.getMonth() !== m ? "out" : ""} ${k === iso(TODAY) ? "today" : ""} ${k === calSel ? "sel" : ""}" data-day="${k}" aria-label="${fmtLong(d)}${ev.length ? ", " + ev.length + " eventos" : ""}"><span>${d.getDate()}</span><span class="dots">${ev.slice(0, 3).map(e => `<i class="t-${esc(e.tipo)}"></i>`).join("")}</span></button>`; }).join("")}
      </div>
      <div class="legend">${Object.entries(CATS).map(([k, v]) => `<span class="t-${k}"><i></i>${v}</span>`).join("")}</div>
    </section>
    <section class="card">
      <h3>${fmtLong(parse(calSel))}</h3>
      ${selEv.length ? selEv.map(evRow).join("") : `<div class="empty">Sin eventos este día.</div>`}
      <form class="addform" id="evForm" style="margin-top:10px">
        <input type="text" id="evText" placeholder="Reunión, cita, cumpleaños…" autocomplete="off" enterkeyhint="done">
        <div class="two"><input type="date" id="evDate" value="${calSel}" aria-label="Fecha"><input type="time" id="evTime" aria-label="Hora"></div>
        <div class="two"><select id="evCat" aria-label="Tipo">${Object.entries(CATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select><button class="btn">Agregar</button></div>
      </form>
    </section>
    <div class="sec-title"><h2>Todo el mes</h2></div>
    <section class="card">${monthEv.length ? monthEv.map(evRow).join("") : `<div class="empty">Nada registrado este mes.</div>`}</section>
  </div></main>`;
}

const FREQ = [[7, "Semanal"], [15, "Quincenal"], [30, "Mensual"], [60, "Cada 2 meses"], [90, "Trimestral"], [180, "Semestral"], [365, "Anual"]];
const freqLabel = f => (FREQ.find(x => x[0] === f) || [0, `Cada ${f} días`])[1];
function vCasa() {
  const list = S.casa_mantenimiento.map(m => ({ m, s: mStatus(m) })).sort((a, b) => a.s.diff - b.s.diff);
  const venc = list.filter(x => x.s.diff < 0).length;
  return hero("casa", "Mantenimiento", venc ? `${venc} ${venc === 1 ? "pendiente vencido" : "pendientes vencidos"}` : "La casa está al día", "Marca “Hecho” y se programa la siguiente vez.") + `<main class="gut"><div class="wrap pull stack">
    <form class="card addform" id="mtForm">
      <input type="text" id="mtText" placeholder="Ej. Limpiar canaletas" autocomplete="off" enterkeyhint="done">
      <div class="two"><select id="mtArea" aria-label="Área">${["General", "Cocina", "Baños", "Recámaras", "Exterior", "Auto"].map(a => `<option>${a}</option>`).join("")}</select>
      <select id="mtFreq" aria-label="Frecuencia">${FREQ.map(([d, l]) => `<option value="${d}" ${d === 90 ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <button class="btn">Agregar</button>
    </form>
    <section class="card">${list.length ? list.map(({ m, s }) => `<div class="mt">
      <div class="ring" style="--p:${s.p};--rc:${s.col}"><span>${s.diff < 0 ? "!" : s.diff + "d"}</span></div>
      <div class="t"><b>${esc(m.texto)}</b><span class="small muted">${esc(m.area)} · ${freqLabel(m.frecuencia_dias)} · próxima ${fmtShort(s.next)}</span></div>
      <div class="mt-actions"><span class="pill ${s.cls}">${s.txt}</span><button class="btn sm" data-mtdone="${m.id}">Hecho</button></div>
      <button class="x" data-del="casa_mantenimiento:${m.id}" aria-label="Borrar">×</button></div>`).join("") : `<div class="empty">Agrega tareas como cambiar filtros, fumigar o revisar el gas.</div>`}</section>
  </div></main>`;
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
  else { html = { inicio: vInicio, comida: vComida, super: vSuper, agenda: vAgenda, casa: vCasa }[view](); cls = "v-" + view; }
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
  const b = e.target.closest("button"); if (!b) { if (e.target.id === "sheetBg") closeSheet(); return; }
  const d = b.dataset;
  if (d.go) { e.preventDefault(); return go(d.go, d.sub); }
  if (d.sub) { sub[view] = d.sub; return render(); }
  if (d.tema) return setTema(d.tema);
  if (d.auth) { authTab = d.auth; authMsg = ""; return render(); }
  if (d.chip) { const [k, v] = d.chip.split(":"), a = S.sel[k], i = a.indexOf(v); i >= 0 ? a.splice(i, 1) : a.push(v); ls.set("casa-sel", S.sel); return render(); }
  if (d.del) { e.preventDefault(); const [t, id] = d.del.split(":"); return del(t, id); }
  if (d.who) { whoFilter = d.who; return render(); }
  if (d.day) { calSel = d.day; const dd = parse(d.day); if (dd.getMonth() !== calMonth.getMonth()) calMonth = new Date(dd.getFullYear(), dd.getMonth(), 1); return render(); }
  if (d.mtdone) return patch("casa_mantenimiento", d.mtdone, { ultima: iso(TODAY) }, "Listo, se programó la siguiente");
  if (d.shop) return addToSuper(menus[+d.shop].shop);
  switch (b.id) {
    case "gen": genMenus(); render(); return document.querySelector(".dish")?.scrollIntoView({ behavior: "smooth", block: "start" });
    case "nextLunch": lunchIdx = (lunchIdx + 1) % LUNCHES.length; return render();
    case "lunchSuper": return addToSuper(LUNCHES[lunchIdx].shop);
    case "clearOk": S.casa_super.filter(i => i.comprado).forEach(i => del("casa_super", i.id)); return toast("Comprados quitados de la lista");
    case "prevM": case "nextM": calMonth = new Date(calMonth.getFullYear(), calMonth.getMonth() + (b.id === "prevM" ? -1 : 1), 1); return render();
    case "openSheet": return openSheet();
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
  if (t.id === "hSel") { ls.set("casa-hogar", t.value); location.reload(); }
});
document.addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target.id, val = id => $("#" + id).value.trim(), clear = id => { $("#" + id).value = ""; };
  if (f === "supForm") { const v = val("supText"); if (!v) return; clear("supText"); return add("casa_super", { texto: v, pasillo: $("#supCat").value, comprado: false }); }
  if (f === "wkForm") { const v = val("wkText"); if (!v) return; clear("wkText"); return add("casa_tareas", { dia: +$("#wkDay").value, texto: v, asignado: $("#wkWho").value || null }, "Actividad asignada"); }
  if (f === "evForm") { const v = val("evText"), dt = $("#evDate").value; if (!v || !dt) return; clear("evText"); calSel = dt; return add("casa_eventos", { fecha: dt, hora: $("#evTime").value || null, texto: v, tipo: $("#evCat").value }, "Evento agregado"); }
  if (f === "mtForm") { const v = val("mtText"); if (!v) return; clear("mtText"); return add("casa_mantenimiento", { texto: v, area: $("#mtArea").value, frecuencia_dias: +$("#mtFreq").value, ultima: iso(TODAY) }); }
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
