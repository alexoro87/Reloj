/* MediHora — recordatorio de medicinas (PWA, datos solo en el dispositivo) */
"use strict";

const STORE_KEY = "medihora_v1";
const COLORS = ["#0f9d8a", "#3b82f6", "#8b5cf6", "#ec4899", "#ef4444", "#f59e0b", "#84cc16", "#64748b"];
const FORM_ICON = {
  "comprimido": "💊", "cápsula": "💊", "gota": "💧", "ml": "🥄", "inyección": "💉",
  "inhalación": "🌬️", "sobre": "🧂", "aplicación": "🧴", "unidad": "⚕️"
};
const DAY_SHORT = ["D", "L", "M", "X", "J", "V", "S"];
const DAY_NAME = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
const LATE_WINDOW_MIN = 120; // cuánto tiempo seguir avisando de una toma no registrada

/* ================= Estado ================= */

let state = {
  meds: [],
  log: {},        // key -> { status: "taken"|"skipped", at: timestamp }
  snooze: {},     // key -> timestamp hasta el que se pospone
  notified: {},   // key@ts -> true (para no repetir avisos)
  settings: { name: "", sound: true, snoozeMin: 10 }
};

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      state = { ...state, ...p, settings: { ...state.settings, ...(p.settings || {}) } };
    }
  } catch (e) { console.warn("No se pudo leer el estado", e); }
  cleanup();
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast("No se pudo guardar: " + e.message); }
}

// Borra marcas de avisos antiguas para que el almacenamiento no crezca sin fin
function cleanup() {
  const limit = Date.now() - 3 * 864e5;
  for (const k of Object.keys(state.notified)) {
    const ts = Number(k.split("@")[1]);
    if (!ts || ts < limit) delete state.notified[k];
  }
  for (const k of Object.keys(state.snooze)) {
    if (state.snooze[k] < limit) delete state.snooze[k];
  }
}

/* ================= Utilidades de fecha ================= */

const pad = n => String(n).padStart(2, "0");
const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const startOfDay = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const hhmm = d => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const atTime = (dateStr, time) => { const d = parseYmd(dateStr); const [h, m] = time.split(":").map(Number); d.setHours(h, m, 0, 0); return d; };
const daysBetween = (a, b) => Math.round((startOfDay(b) - startOfDay(a)) / 864e5);

function fmtLongDate(d) {
  return d.toLocaleDateString("es", { weekday: "long", day: "numeric", month: "long" });
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ================= Lógica de tomas ================= */

function isScheduledOn(med, date) {
  if (med.paused) return false;
  const day = startOfDay(date);
  const start = parseYmd(med.startDate);
  if (day < start) return false;
  if (med.endDate && day > parseYmd(med.endDate)) return false;
  const f = med.freq || { type: "daily" };
  if (f.type === "weekdays") return (f.days || []).includes(day.getDay());
  if (f.type === "interval") return daysBetween(start, day) % Math.max(1, f.every || 1) === 0;
  return true;
}

const doseKey = (medId, dateStr, time) => `${medId}|${dateStr}|${time}`;

function dosesFor(date) {
  const ds = ymd(date);
  const out = [];
  for (const med of state.meds) {
    if (!isScheduledOn(med, date)) continue;
    for (const time of med.times) {
      const key = doseKey(med.id, ds, time);
      out.push({ key, med, time, date: ds, due: atTime(ds, time), entry: state.log[key] || null });
    }
  }
  return out.sort((a, b) => a.time.localeCompare(b.time) || a.med.name.localeCompare(b.med.name));
}

function findDose(key) {
  const [medId, ds, time] = key.split("|");
  const med = state.meds.find(m => m.id === medId);
  if (!med) return null;
  return { key, med, time, date: ds, due: atTime(ds, time), entry: state.log[key] || null };
}

function adherence(fromDate, toDate, medId) {
  let total = 0, taken = 0;
  const now = new Date();
  for (let d = startOfDay(fromDate); d <= toDate; d = addDays(d, 1)) {
    for (const dose of dosesFor(d)) {
      if (medId && dose.med.id !== medId) continue;
      if (dose.due > now) continue; // aún no toca
      total++;
      if (dose.entry?.status === "taken") taken++;
    }
  }
  return { total, taken, pct: total ? Math.round((taken / total) * 100) : null };
}

function doseText(med) {
  const q = med.qty || 1;
  const unitMap = {
    "comprimido": ["comprimido", "comprimidos"], "cápsula": ["cápsula", "cápsulas"],
    "gota": ["gota", "gotas"], "ml": ["ml", "ml"], "inyección": ["inyección", "inyecciones"],
    "inhalación": ["inhalación", "inhalaciones"], "sobre": ["sobre", "sobres"],
    "aplicación": ["aplicación", "aplicaciones"], "unidad": ["unidad", "unidades"]
  };
  const [one, many] = unitMap[med.form] || ["unidad", "unidades"];
  return `${q} ${q === 1 ? one : many}`;
}

function setDose(key, status, at = Date.now()) {
  const dose = findDose(key);
  if (!dose) return;
  const prev = state.log[key]?.status;
  if (prev === "taken") adjustStock(dose.med, +(dose.med.qty || 1));
  if (status) {
    state.log[key] = { status, at };
    if (status === "taken") adjustStock(dose.med, -(dose.med.qty || 1));
  } else {
    delete state.log[key];
  }
  delete state.snooze[key];
  save();
  closeNotification(key);
  renderAll();
}

function adjustStock(med, delta) {
  if (!med.stockOn) return;
  const before = med.stock;
  med.stock = Math.max(0, Math.round((med.stock + delta) * 100) / 100);
  if (delta < 0 && before > med.stockAlert && med.stock <= med.stockAlert) {
    const msg = `Quedan ${med.stock} de ${med.name}. Es momento de reponer.`;
    toast("⚠️ " + msg);
    notify("Inventario bajo", msg, "stock-" + med.id);
  }
}

function snooze(key) {
  const mins = Number(state.settings.snoozeMin) || 10;
  state.snooze[key] = Date.now() + mins * 60000;
  save();
  closeNotification(key);
  toast(`Te lo recordaré en ${mins} min`);
  renderAll();
}

/* ================= Recordatorios ================= */

let swReg = null;

async function registerSW() {
  if (!("serviceWorker" in navigator)) return;
  try {
    swReg = await navigator.serviceWorker.register("sw.js");
    navigator.serviceWorker.addEventListener("message", ev => {
      const { type, act, key } = ev.data || {};
      if (type === "dose-action") handleExternalAction(act, key);
    });
  } catch (e) { console.warn("SW no registrado", e); }
}

function handleExternalAction(act, key) {
  if (!key || !findDose(key)) return;
  if (act === "take") { setDose(key, "taken"); toast("✓ Toma registrada"); }
  else if (act === "snooze") snooze(key);
  else openActionSheet(key);
}

async function notify(title, body, tag, actions) {
  if (!("Notification" in window) || Notification.permission !== "granted") return false;
  const opts = {
    body, tag, renotify: true, requireInteraction: true,
    icon: "icons/icon-192.png", badge: "icons/icon-192.png",
    vibrate: [300, 150, 300, 150, 300],
    data: { key: tag }
  };
  if (actions) opts.actions = actions;
  try {
    const reg = swReg || (await navigator.serviceWorker?.ready);
    if (reg) { await reg.showNotification(title, opts); return true; }
    new Notification(title, opts);
    return true;
  } catch (e) {
    try { new Notification(title, { body, tag }); return true; } catch { return false; }
  }
}

async function closeNotification(tag) {
  try {
    const reg = swReg || (await navigator.serviceWorker?.ready);
    const list = await reg?.getNotifications({ tag });
    list?.forEach(n => n.close());
  } catch { /* nada */ }
}

function pendingDue(now = new Date()) {
  // tomas de hoy y de ayer (por si hay horarios cerca de medianoche)
  const res = [];
  for (const d of [addDays(now, -1), now]) {
    for (const dose of dosesFor(d)) {
      if (dose.entry) continue;
      const fireAt = state.snooze[dose.key] || dose.due.getTime();
      if (fireAt <= now.getTime() && now.getTime() - fireAt < LATE_WINDOW_MIN * 60000) {
        res.push({ ...dose, fireAt });
      }
    }
  }
  return res;
}

function checkReminders() {
  const due = pendingDue();
  const fresh = due.filter(d => !state.notified[`${d.key}@${d.fireAt}`]);
  if (!fresh.length) return;

  for (const d of fresh) {
    state.notified[`${d.key}@${d.fireAt}`] = true;
    const extra = [d.med.food, d.med.notes].filter(Boolean).join(" · ");
    notify(
      `💊 ${d.med.name}${d.med.strength ? " " + d.med.strength : ""}`,
      `${d.time} — ${doseText(d.med)}${extra ? "\n" + extra : ""}`,
      d.key,
      [{ action: "take", title: "✓ Tomada" }, { action: "snooze", title: `⏱ ${state.settings.snoozeMin} min` }]
    );
  }
  save();
  showAlarm(due);
}

/* Si el navegador soporta disparadores programados (experimental), los usamos
   para que lleguen avisos aunque la app esté cerrada. */
async function scheduleFutureNotifications() {
  if (!("showTrigger" in Notification.prototype) || typeof TimestampTrigger === "undefined") return;
  if (Notification.permission !== "granted" || !swReg) return;
  const now = new Date();
  for (const d of [now, addDays(now, 1)]) {
    for (const dose of dosesFor(d)) {
      if (dose.entry || dose.due <= now) continue;
      try {
        await swReg.showNotification(`💊 ${dose.med.name}`, {
          body: `${dose.time} — ${doseText(dose.med)}`, tag: dose.key,
          showTrigger: new TimestampTrigger(dose.due.getTime()),
          icon: "icons/icon-192.png", data: { key: dose.key },
          actions: [{ action: "take", title: "✓ Tomada" }, { action: "snooze", title: "⏱ Posponer" }]
        });
      } catch { return; }
    }
  }
}

/* ----- Alarma en pantalla + sonido ----- */

let audioCtx = null;
let beepTimer = null;

function unlockAudio() {
  if (!audioCtx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (C) audioCtx = new C();
  }
  audioCtx?.resume?.();
}

function beepOnce() {
  if (!audioCtx || !state.settings.sound) return;
  const t = audioCtx.currentTime;
  [0, 0.25, 0.5].forEach((off, i) => {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "sine";
    o.frequency.value = i === 2 ? 1046 : 880;
    g.gain.setValueAtTime(0.0001, t + off);
    g.gain.exponentialRampToValueAtTime(0.35, t + off + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + off + 0.2);
    o.connect(g).connect(audioCtx.destination);
    o.start(t + off);
    o.stop(t + off + 0.22);
  });
  navigator.vibrate?.([300, 150, 300]);
}

function showAlarm(list) {
  const el = document.getElementById("alarm");
  if (!list.length) { hideAlarm(); return; }
  document.getElementById("alarm-list").innerHTML = list.map(d => `
    <div class="alarm-item">
      <div class="dose-name">${FORM_ICON[d.med.form] || "💊"} ${esc(d.med.name)} ${esc(d.med.strength || "")}</div>
      <div class="muted small">${d.time} · ${doseText(d.med)}${d.med.food ? " · " + esc(d.med.food) : ""}</div>
      <div class="btn-row">
        <button class="btn" data-alarm="take" data-key="${esc(d.key)}">✓ Tomada</button>
        <button class="btn warn" data-alarm="snooze" data-key="${esc(d.key)}">⏱ ${state.settings.snoozeMin} min</button>
        <button class="btn ghost" data-alarm="skip" data-key="${esc(d.key)}">Omitir</button>
      </div>
    </div>`).join("");
  el.classList.remove("hidden");
  if (!beepTimer && state.settings.sound) {
    beepOnce();
    beepTimer = setInterval(beepOnce, 4000);
    setTimeout(stopBeep, 60000); // suena como máximo 1 minuto
  }
}

function stopBeep() { clearInterval(beepTimer); beepTimer = null; }
function hideAlarm() { document.getElementById("alarm").classList.add("hidden"); stopBeep(); }

/* ================= Render ================= */

let selectedDate = startOfDay(new Date());
let currentView = "today";

function renderAll() {
  renderToday();
  renderMeds();
  if (currentView === "progress") renderProgress();
  if (currentView === "reports") renderReports();
  renderNotifUI();
}

function renderToday() {
  const now = new Date();
  const isToday = ymd(selectedDate) === ymd(now);
  const h = now.getHours();
  const hello = h < 12 ? "Buenos días" : h < 19 ? "Buenas tardes" : "Buenas noches";
  document.getElementById("greeting").textContent = state.settings.name ? `${hello}, ${state.settings.name}` : hello;
  const t = fmtLongDate(selectedDate);
  document.getElementById("today-title").textContent = isToday ? "Hoy" : t.charAt(0).toUpperCase() + t.slice(1);
  document.getElementById("btn-go-today").classList.toggle("hidden", isToday);

  // Semana (lunes a domingo)
  const monday = addDays(selectedDate, -((selectedDate.getDay() + 6) % 7));
  const week = document.getElementById("week");
  week.innerHTML = "";
  for (let i = 0; i < 7; i++) {
    const d = addDays(monday, i);
    const b = document.createElement("button");
    if (ymd(d) === ymd(selectedDate)) b.classList.add("sel");
    let dot = "";
    if (d <= now) {
      const a = adherence(d, d);
      if (a.total) dot = a.pct === 100 ? "full" : a.pct > 0 ? "part" : "none";
    }
    b.innerHTML = `<span>${DAY_SHORT[d.getDay()]}</span><b>${d.getDate()}</b><i class="dot ${dot}"></i>`;
    b.onclick = () => { selectedDate = d; renderToday(); };
    week.appendChild(b);
  }

  const doses = dosesFor(selectedDate);
  const taken = doses.filter(d => d.entry?.status === "taken").length;
  const pct = doses.length ? Math.round((taken / doses.length) * 100) : 0;
  document.getElementById("ring-fg").setAttribute("stroke-dasharray", `${pct} 100`);
  document.getElementById("ring-text").textContent = doses.length ? pct + "%" : "–";
  document.getElementById("summary-big").textContent = `${taken} de ${doses.length} tomas`;
  const pending = doses.filter(d => !d.entry && d.due > now);
  document.getElementById("summary-sub").textContent =
    !doses.length ? "Sin medicinas programadas" :
    taken === doses.length ? "¡Todo listo por hoy! 🎉" :
    pending.length && isToday ? `Próxima: ${pending[0].time} · ${pending[0].med.name}` :
    "Toca una toma para registrarla";

  const list = document.getElementById("today-list");
  if (!state.meds.length) {
    list.innerHTML = `<div class="empty"><div class="big">💊</div>
      <p>Todavía no tienes medicamentos.</p>
      <button class="btn" onclick="openMedForm()">Agregar el primero</button></div>`;
    return;
  }
  if (!doses.length) {
    list.innerHTML = `<div class="empty"><div class="big">😌</div><p>No hay tomas programadas este día.</p></div>`;
    return;
  }

  const groups = {};
  doses.forEach(d => (groups[d.time] ||= []).push(d));
  list.innerHTML = Object.entries(groups).map(([time, items]) => {
    const due = items[0].due;
    const anyOpen = items.some(i => !i.entry);
    const mins = (now - due) / 60000;
    let tag = "";
    if (anyOpen && mins > 30) tag = `<span class="tag late">Atrasada</span>`;
    else if (anyOpen && mins >= -15 && mins <= 30) tag = `<span class="tag now">Ahora</span>`;
    return `<div class="time-group">
      <div class="time-label">🕒 ${time} ${tag}</div>
      ${items.map(d => doseCard(d, now)).join("")}
    </div>`;
  }).join("");
}

function doseCard(d, now) {
  const st = d.entry?.status || "";
  const late = !st && now - d.due > 30 * 60000;
  const snz = state.snooze[d.key] && state.snooze[d.key] > now.getTime() ? ` · pospuesta a ${hhmm(new Date(state.snooze[d.key]))}` : "";
  const when = st === "taken" ? ` · tomada ${hhmm(new Date(d.entry.at))}` : st === "skipped" ? " · omitida" : snz;
  const sub = [d.med.strength, doseText(d.med), d.med.food].filter(Boolean).map(esc).join(" · ") + when;
  return `<div class="dose ${st}" style="--c:${d.med.color}" data-key="${esc(d.key)}">
    <div class="pill-ico">${FORM_ICON[d.med.form] || "💊"}</div>
    <div class="dose-main">
      <div class="dose-name">${esc(d.med.name)}</div>
      <div class="dose-sub">${sub}</div>
    </div>
    <button class="status ${st} ${late ? "late" : ""}" data-quick="${esc(d.key)}" aria-label="Marcar como tomada">${st === "skipped" ? "✕" : "✓"}</button>
  </div>`;
}

function freqText(med) {
  const f = med.freq || { type: "daily" };
  if (f.type === "weekdays") return [1, 2, 3, 4, 5, 6, 0].filter(x => f.days.includes(x)).map(x => DAY_NAME[x]).join(", ");
  if (f.type === "interval") return `Cada ${f.every} días`;
  return "Todos los días";
}

function renderMeds() {
  const el = document.getElementById("meds-list");
  if (!state.meds.length) {
    el.innerHTML = `<div class="empty"><div class="big">🗂️</div><p>Aquí verás tus medicamentos.</p></div>`;
    return;
  }
  const today = startOfDay(new Date());
  const meds = [...state.meds].sort((a, b) => a.name.localeCompare(b.name));
  el.innerHTML = meds.map(m => {
    const ended = m.endDate && parseYmd(m.endDate) < today;
    const low = m.stockOn && m.stock <= m.stockAlert;
    const stock = m.stockOn ? `<div class="small ${low ? "stock-low" : "muted"}">Inventario: ${m.stock}${low ? " · ¡reponer!" : ""}</div>` : "";
    return `<div class="card med-item" data-med="${m.id}" style="--c:${m.color}">
      <div class="pill-ico">${FORM_ICON[m.form] || "💊"}</div>
      <div class="dose-main">
        <div class="dose-name">${esc(m.name)} <span class="muted small">${esc(m.strength || "")}</span></div>
        <div class="dose-sub">${doseText(m)} · ${m.times.join(", ")}</div>
        <div class="dose-sub">${freqText(m)}${m.paused ? " · ⏸ en pausa" : ended ? " · finalizado" : ""}</div>
        ${stock}
        ${m.rx?.photoIds?.length ? `<button type="button" class="rx-chip" data-rx="${m.id}">📄 Ver receta${m.rx.photoIds.length > 1 ? ` (${m.rx.photoIds.length})` : ""}</button>` : ""}
      </div>
      <div class="chev">›</div>
    </div>`;
  }).join("");
}

function renderProgress() {
  const today = startOfDay(new Date());
  const now = new Date();
  const fmt = a => a.pct === null ? "–" : a.pct + "%";
  document.getElementById("st-7").textContent = fmt(adherence(addDays(today, -6), now));
  document.getElementById("st-30").textContent = fmt(adherence(addDays(today, -29), now));

  // racha de días completos (sin contar hoy si aún no termina)
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const doses = dosesFor(addDays(today, -i));
    if (!doses.length) continue;
    if (doses.every(x => x.entry?.status === "taken")) streak++;
    else if (i > 0) break; // hoy puede estar en curso
  }
  document.getElementById("st-streak").textContent = streak;

  // barras 14 días
  let bars = "";
  for (let i = 13; i >= 0; i--) {
    const d = addDays(today, -i);
    const a = adherence(d, d);
    const p = a.pct ?? 0;
    const cls = a.pct === null ? "" : p >= 90 ? "" : p >= 50 ? "mid" : "low";
    bars += `<div class="bar-col" title="${ymd(d)}: ${a.pct ?? "sin tomas"}${a.pct !== null ? "%" : ""}">
      <div class="bar-wrap"><div class="bar ${cls}" style="height:${a.pct === null ? 0 : Math.max(p, 3)}%"></div></div>
      <small>${DAY_SHORT[d.getDay()]}</small></div>`;
  }
  document.getElementById("bars").innerHTML = bars;

  // por medicamento
  const pm = state.meds.map(m => ({ m, a: adherence(addDays(today, -29), now, m.id) })).filter(x => x.a.total);
  document.getElementById("per-med").innerHTML = pm.length ? pm.map(({ m, a }) => `
    <div class="pm-row">
      <div class="pm-top"><span>${esc(m.name)}</span><span class="muted">${a.taken}/${a.total} · ${a.pct}%</span></div>
      <div class="pm-track"><div class="pm-fill" style="width:${a.pct}%;background:${m.color}"></div></div>
    </div>`).join("") : `<p class="muted small">Aún no hay datos.</p>`;

  // historial
  const hist = Object.entries(state.log)
    .map(([key, e]) => ({ dose: findDose(key), e }))
    .filter(x => x.dose)
    .sort((a, b) => b.e.at - a.e.at)
    .slice(0, 20);
  document.getElementById("history").innerHTML = hist.length ? hist.map(({ dose, e }) => {
    const d = new Date(e.at);
    return `<div class="hist-row">
      <span>${e.status === "taken" ? "✅" : "⏭️"} ${esc(dose.med.name)} <span class="muted">(${dose.time})</span></span>
      <span class="muted">${d.toLocaleDateString("es", { day: "numeric", month: "short" })} ${hhmm(d)}</span>
    </div>`;
  }).join("") : `<p class="muted small">Aún no hay registros.</p>`;
}

function renderNotifUI() {
  const supported = "Notification" in window;
  const perm = supported ? Notification.permission : "unsupported";
  const banner = document.getElementById("notif-banner");
  banner.classList.toggle("hidden", !(supported && perm === "default" && state.meds.length));
  const st = document.getElementById("notif-status");
  st.textContent = {
    granted: "✅ Notificaciones activadas.",
    denied: "❌ Bloqueadas. Actívalas en los ajustes del navegador para este sitio.",
    default: "Aún no has dado permiso.",
    unsupported: "Este navegador no admite notificaciones. En iPhone, primero agrega la app a la pantalla de inicio."
  }[perm];
  document.getElementById("btn-enable-notif-2").classList.toggle("hidden", perm === "granted" || perm === "unsupported");
}

/* ================= Vistas ================= */

function showView(v) {
  currentView = v;
  document.querySelectorAll(".view").forEach(s => s.classList.toggle("active", s.id === "view-" + v));
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.view === v));
  document.getElementById("btn-add-med").classList.toggle("hidden", v !== "today" && v !== "meds");
  if (v === "progress") renderProgress();
  if (v === "reports") renderReports();
  window.scrollTo(0, 0);
}

/* ================= Formulario de medicamento ================= */

let editingId = null;
let formFreq = "daily";
let formDays = [1, 2, 3, 4, 5];
let formColor = COLORS[0];

function openMedForm(id = null) {
  editingId = id;
  const med = id ? state.meds.find(m => m.id === id) : null;
  const f = document.getElementById("med-form");
  f.reset();
  document.getElementById("sheet-title").textContent = med ? "Editar medicamento" : "Nuevo medicamento";
  document.getElementById("btn-delete-med").classList.toggle("hidden", !med);

  f.name.value = med?.name || "";
  f.strength.value = med?.strength || "";
  f.form.value = med?.form || "comprimido";
  f.qty.value = med?.qty ?? 1;
  f.startDate.value = med?.startDate || ymd(new Date());
  f.endDate.value = med?.endDate || "";
  f.food.value = med?.food || "";
  f.notes.value = med?.notes || "";
  f.stockOn.checked = !!med?.stockOn;
  f.stock.value = med?.stock ?? 30;
  f.stockAlert.value = med?.stockAlert ?? 5;
  f.every.value = med?.freq?.every || 2;

  formFreq = med?.freq?.type || "daily";
  formDays = med?.freq?.days ? [...med.freq.days] : [1, 2, 3, 4, 5];
  formColor = med?.color || COLORS[state.meds.length % COLORS.length];

  renderColors();
  renderFreq();
  renderDays();
  renderTimes(med?.times || ["08:00"]);
  toggleStockFields();
  // botón de pausa solo al editar
  const del = document.getElementById("btn-delete-med");
  let pauseBtn = document.getElementById("btn-pause-med");
  if (!pauseBtn) {
    pauseBtn = document.createElement("button");
    pauseBtn.type = "button";
    pauseBtn.id = "btn-pause-med";
    pauseBtn.className = "btn ghost full";
    pauseBtn.style.marginBottom = "10px";
    del.before(pauseBtn);
    pauseBtn.onclick = () => {
      const m = state.meds.find(x => x.id === editingId);
      if (!m) return;
      m.paused = !m.paused;
      save(); closeSheet(); renderAll();
      toast(m.paused ? "Medicamento en pausa" : "Medicamento reactivado");
    };
  }
  pauseBtn.classList.toggle("hidden", !med);
  pauseBtn.textContent = med?.paused ? "▶ Reanudar recordatorios" : "⏸ Pausar recordatorios";

  rxOpenForm(med);
  document.getElementById("sheet").classList.remove("hidden");
  setTimeout(() => !med && f.name.focus(), 100);
}

function closeSheet(saved = false) {
  if (!saved) rxDiscard();
  document.getElementById("sheet").classList.add("hidden");
}

function renderColors() {
  const el = document.getElementById("colors");
  el.innerHTML = COLORS.map(c => `<button type="button" style="background:${c}" class="${c === formColor ? "active" : ""}" data-color="${c}" aria-label="Color"></button>`).join("");
}

function renderFreq() {
  document.querySelectorAll("#freq-seg button").forEach(b => b.classList.toggle("active", b.dataset.freq === formFreq));
  document.getElementById("weekdays-field").classList.toggle("hidden", formFreq !== "weekdays");
  document.getElementById("interval-field").classList.toggle("hidden", formFreq !== "interval");
}

function renderDays() {
  document.getElementById("days").innerHTML = [1, 2, 3, 4, 5, 6, 0]
    .map(d => `<button type="button" data-day="${d}" class="${formDays.includes(d) ? "active" : ""}">${DAY_SHORT[d]}</button>`).join("");
}

function renderTimes(times) {
  document.getElementById("times").innerHTML = times.map(t => `
    <div class="time-row"><input type="time" value="${t}" required><button type="button" class="rm-time" aria-label="Quitar">×</button></div>`).join("");
}

function toggleStockFields() {
  const f = document.getElementById("med-form");
  document.getElementById("stock-fields").classList.toggle("hidden", !f.stockOn.checked);
}

function saveMedFromForm(ev) {
  ev.preventDefault();
  const f = ev.target;
  const times = [...new Set([...document.querySelectorAll("#times input")].map(i => i.value).filter(Boolean))].sort();
  if (!times.length) { toast("Agrega al menos un horario"); return; }
  if (formFreq === "weekdays" && !formDays.length) { toast("Elige al menos un día"); return; }
  if (f.endDate.value && f.endDate.value < f.startDate.value) { toast("La fecha final es anterior al inicio"); return; }

  const existing = editingId ? state.meds.find(m => m.id === editingId) : null;
  const med = {
    id: existing?.id || uid(),
    name: f.name.value.trim(),
    strength: f.strength.value.trim(),
    form: f.form.value,
    qty: Math.max(0.25, Number(f.qty.value) || 1),
    color: formColor,
    freq: { type: formFreq, days: [...formDays].sort(), every: Math.max(2, Number(f.every.value) || 2) },
    times,
    startDate: f.startDate.value,
    endDate: f.endDate.value || null,
    food: f.food.value,
    notes: f.notes.value.trim(),
    stockOn: f.stockOn.checked,
    stock: Number(f.stock.value) || 0,
    stockAlert: Number(f.stockAlert.value) || 0,
    paused: existing?.paused || false,
    rx: rxCollect(),
    createdAt: existing?.createdAt || Date.now()
  };
  if (!med.name) { toast("Escribe el nombre"); return; }

  if (existing) Object.assign(existing, med);
  else state.meds.push(med);
  save();
  rxCommit();
  closeSheet(true);
  renderAll();
  scheduleFutureNotifications();
  toast(existing ? "Cambios guardados" : "Medicamento agregado");
  if (!existing && "Notification" in window && Notification.permission === "default") {
    setTimeout(askNotifPermission, 600);
  }
}

function deleteMed() {
  const med = state.meds.find(m => m.id === editingId);
  if (!med || !confirm(`¿Eliminar ${med.name} y su historial?`)) return;
  rxDiscard();
  rxDeleteForMed(med);
  state.meds = state.meds.filter(m => m.id !== editingId);
  for (const k of Object.keys(state.log)) if (k.startsWith(editingId + "|")) delete state.log[k];
  save();
  closeSheet(true);
  renderAll();
  toast("Medicamento eliminado");
}

/* ================= Hoja de acciones ================= */

let actionKey = null;

function openActionSheet(key) {
  const d = findDose(key);
  if (!d) return;
  actionKey = key;
  const future = d.due - Date.now() > 12 * 3600e3;
  document.getElementById("action-info").innerHTML = `
    <div class="dose" style="--c:${d.med.color};box-shadow:none;cursor:default">
      <div class="pill-ico">${FORM_ICON[d.med.form] || "💊"}</div>
      <div class="dose-main">
        <div class="dose-name">${esc(d.med.name)} ${esc(d.med.strength || "")}</div>
        <div class="dose-sub">${d.time} · ${doseText(d.med)}</div>
        ${d.med.food || d.med.notes ? `<div class="dose-sub">${esc([d.med.food, d.med.notes].filter(Boolean).join(" · "))}</div>` : ""}
      </div>
    </div>`;
  const st = d.entry?.status;
  const sheet = document.getElementById("action-sheet");
  sheet.querySelector('[data-act="taken"]').classList.toggle("hidden", st === "taken" || future);
  sheet.querySelector('[data-act="taken-other"]').classList.toggle("hidden", st === "taken" || future);
  sheet.querySelector('[data-act="snooze"]').classList.toggle("hidden", !!st || d.due > new Date());
  sheet.querySelector('[data-act="skipped"]').classList.toggle("hidden", st === "skipped");
  sheet.querySelector('[data-act="undo"]').classList.toggle("hidden", !st);
  sheet.classList.remove("hidden");
}

function onAction(act) {
  const key = actionKey;
  document.getElementById("action-sheet").classList.add("hidden");
  if (!key || act === "close") return;
  if (act === "taken") { setDose(key, "taken"); toast("✓ Toma registrada"); }
  else if (act === "taken-other") {
    const d = findDose(key);
    const t = prompt("¿A qué hora la tomaste? (HH:MM)", hhmm(new Date()));
    if (!t) return;
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(t.trim())) { toast("Hora no válida"); return; }
    setDose(key, "taken", atTime(d.date, t.trim().padStart(5, "0")).getTime());
    toast("✓ Toma registrada");
  }
  else if (act === "skipped") { setDose(key, "skipped"); toast("Toma omitida"); }
  else if (act === "undo") { setDose(key, null); toast("Registro deshecho"); }
  else if (act === "snooze") snooze(key);
}

/* ================= Permisos / ajustes ================= */

async function askNotifPermission() {
  if (!("Notification" in window)) { toast("Tu navegador no admite notificaciones"); return; }
  const p = await Notification.requestPermission();
  renderNotifUI();
  if (p === "granted") { toast("Notificaciones activadas"); scheduleFutureNotifications(); }
}

async function exportData() {
  toast("Preparando copia…");
  const photos = await rxExportAll();
  const blob = new Blob([JSON.stringify({ ...state, photos })], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `medihora-${ymd(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function importData(file) {
  const r = new FileReader();
  r.onload = async () => {
    try {
      const p = JSON.parse(r.result);
      if (!Array.isArray(p.meds)) throw new Error("Archivo no válido");
      if (!confirm("Esto reemplazará tus datos actuales. ¿Continuar?")) return;
      await rxImportAll(p.photos);
      state = { meds: p.meds, log: p.log || {}, snooze: p.snooze || {}, notified: {}, settings: { ...state.settings, ...(p.settings || {}) } };
      save(); loadSettingsUI(); renderAll();
      toast("Datos importados");
    } catch (e) { toast("No se pudo importar: " + e.message); }
  };
  r.readAsText(file);
}

function loadSettingsUI() {
  document.getElementById("set-name").value = state.settings.name || "";
  document.getElementById("set-sound").checked = !!state.settings.sound;
  document.getElementById("set-snooze").value = String(state.settings.snoozeMin);
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 2600);
}

/* ================= Eventos ================= */

function bind() {
  document.querySelectorAll(".tabs button").forEach(b => b.onclick = () => showView(b.dataset.view));
  document.getElementById("btn-add-med").onclick = () => openMedForm();
  document.getElementById("btn-add-med-2").onclick = () => openMedForm();
  document.getElementById("btn-go-today").onclick = () => { selectedDate = startOfDay(new Date()); renderToday(); };
  document.getElementById("btn-cancel").onclick = () => closeSheet();
  document.getElementById("med-form").onsubmit = saveMedFromForm;
  document.getElementById("btn-delete-med").onclick = deleteMed;
  document.getElementById("btn-add-time").onclick = () => {
    const cur = [...document.querySelectorAll("#times input")].map(i => i.value);
    const last = cur[cur.length - 1] || "08:00";
    const [h, m] = last.split(":").map(Number);
    renderTimes([...cur, `${pad((h + 4) % 24)}:${pad(m)}`]);
  };
  document.getElementById("times").onclick = e => {
    if (!e.target.classList.contains("rm-time")) return;
    const rows = document.querySelectorAll("#times .time-row");
    if (rows.length > 1) e.target.parentElement.remove();
  };
  document.getElementById("colors").onclick = e => {
    if (e.target.dataset.color) { formColor = e.target.dataset.color; renderColors(); }
  };
  document.getElementById("freq-seg").onclick = e => {
    if (e.target.dataset.freq) { formFreq = e.target.dataset.freq; renderFreq(); }
  };
  document.getElementById("days").onclick = e => {
    const d = e.target.dataset.day;
    if (d === undefined) return;
    const n = Number(d);
    formDays = formDays.includes(n) ? formDays.filter(x => x !== n) : [...formDays, n];
    renderDays();
  };
  document.getElementById("med-form").stockOn.onchange = toggleStockFields;
  document.getElementById("sheet").onclick = e => { if (e.target.id === "sheet") closeSheet(); };

  // Lista de hoy: tocar tarjeta abre acciones; tocar el círculo marca rápido
  document.getElementById("today-list").onclick = e => {
    const quick = e.target.closest("[data-quick]");
    if (quick) {
      e.stopPropagation();
      const key = quick.dataset.quick;
      const d = findDose(key);
      if (d.entry) { openActionSheet(key); return; }
      if (d.due - Date.now() > 12 * 3600e3) { toast("Todavía no toca esta toma"); return; }
      setDose(key, "taken"); toast("✓ Toma registrada");
      return;
    }
    const card = e.target.closest("[data-key]");
    if (card) openActionSheet(card.dataset.key);
  };
  document.getElementById("meds-list").onclick = e => {
    const rx = e.target.closest("[data-rx]");
    if (rx) {
      const m = state.meds.find(x => x.id === rx.dataset.rx);
      if (m) rxOpenViewer(m.rx.photoIds, 0, { title: m.name });
      return;
    }
    const c = e.target.closest("[data-med]");
    if (c) openMedForm(c.dataset.med);
  };

  document.getElementById("action-sheet").onclick = e => {
    if (e.target.id === "action-sheet") { onAction("close"); return; }
    const b = e.target.closest("[data-act]");
    if (b) onAction(b.dataset.act);
  };

  document.getElementById("alarm-list").onclick = e => {
    const b = e.target.closest("[data-alarm]");
    if (!b) return;
    const key = b.dataset.key;
    if (b.dataset.alarm === "take") setDose(key, "taken");
    else if (b.dataset.alarm === "skip") setDose(key, "skipped");
    else snooze(key);
    const rest = pendingDue().filter(d => !(state.snooze[d.key] > Date.now()));
    rest.length ? showAlarm(rest) : hideAlarm();
  };
  document.getElementById("alarm-close").onclick = hideAlarm;

  // Ajustes
  document.getElementById("set-name").oninput = e => { state.settings.name = e.target.value.trim(); save(); renderToday(); };
  document.getElementById("set-sound").onchange = e => { state.settings.sound = e.target.checked; save(); if (e.target.checked) { unlockAudio(); beepOnce(); } };
  document.getElementById("set-snooze").onchange = e => { state.settings.snoozeMin = Number(e.target.value); save(); };
  document.getElementById("btn-enable-notif").onclick = askNotifPermission;
  document.getElementById("btn-enable-notif-2").onclick = askNotifPermission;
  document.getElementById("btn-test-notif").onclick = async () => {
    unlockAudio(); beepOnce();
    const ok = await notify("💊 Prueba de MediHora", "Así se verán tus recordatorios.", "test");
    if (!ok) toast("Activa primero las notificaciones");
  };
  document.getElementById("btn-export").onclick = exportData;
  document.getElementById("file-import").onchange = e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ""; };
  document.getElementById("btn-wipe").onclick = () => {
    if (!confirm("¿Borrar todos tus medicamentos e historial? No se puede deshacer.")) return;
    localStorage.removeItem(STORE_KEY);
    rxClear().catch(() => {}).finally(() => location.reload());
  };

  // El audio solo puede sonar tras una interacción del usuario
  document.addEventListener("pointerdown", unlockAudio, { once: true });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) { checkReminders(); renderAll(); }
  });
}

/* ================= Inicio ================= */

function handleUrlAction() {
  const p = new URLSearchParams(location.search);
  const act = p.get("act"), key = p.get("key");
  if (act && key) {
    history.replaceState(null, "", location.pathname);
    setTimeout(() => handleExternalAction(act, key), 300);
  }
}

let lastDay = ymd(new Date());

function tick() {
  const today = ymd(new Date());
  if (today !== lastDay) { // cambió el día: mover la vista a hoy
    if (ymd(selectedDate) === lastDay) selectedDate = startOfDay(new Date());
    lastDay = today;
    scheduleFutureNotifications();
  }
  checkReminders();
  renderToday();
}

load();
bind();
loadSettingsUI();
renderAll();
registerSW().then(() => { handleUrlAction(); scheduleFutureNotifications(); });
checkReminders();
setInterval(tick, 20000);
