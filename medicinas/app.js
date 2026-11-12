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
  settings: { name: "", sound: true, snoozeMin: 10, bigText: false },
  profiles: [],           // personas: { id, name, color, cloud, alarms }
  currentProfile: "all",  // "all" o el id de una persona
  members: {},            // perfil compartido -> miembros
  sync: { cursors: {}, outbox: [], uploaded: {} }
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
  migrateProfiles();
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
  catch (e) { toast("No se pudo guardar: " + e.message); }
  if (NATIVE) nativeReschedule();
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

// Tratamientos con duración: solo cuentan las tomas desde la primera hasta el final
function inWindow(med, due) {
  const t = due.getTime();
  if (med.startAt && t < med.startAt) return false;
  if (med.endAt && t >= med.endAt) return false;
  return true;
}

// scope: "view" = lo que se ve con la persona elegida, "alarm" = lo que avisa este teléfono, "all" = todo
function dosesFor(date, scope = "view") {
  const ds = ymd(date);
  const out = [];
  for (const med of state.meds) {
    if (scope === "view" && !medInView(med)) continue;
    if (scope === "alarm" && !medAlarm(med)) continue;
    if (!isScheduledOn(med, date)) continue;
    for (const time of med.times) {
      const key = doseKey(med.id, ds, time);
      const due = atTime(ds, time);
      if (!inWindow(med, due) && !state.log[key]) continue;
      out.push({ key, med, time, date: ds, due, entry: state.log[key] || null });
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
    state.log[key] = { status, at, by: myName(), byUser: syncUserId() };
    if (status === "taken") adjustStock(dose.med, -(dose.med.qty || 1));
  } else {
    delete state.log[key];
  }
  delete state.snooze[key];
  save();
  syncLog(key);
  if (dose.med.stockOn) syncMed(dose.med);
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
  if (NATIVE || !("serviceWorker" in navigator)) return;
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
  if (NATIVE) return nativeNotifyNow(title, body, tag);
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
  if (NATIVE) return nativeClear(tag);
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
    for (const dose of dosesFor(d, "alarm")) {
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
    if (NATIVE) continue; // en la app nativa la alarma ya la lanzó el sistema
    const extra = [d.med.food, d.med.notes].filter(Boolean).join(" · ");
    notify(
      "💊 Es hora de tu medicina",
      `${whoPrefix(d.med)}${d.med.name}${d.med.strength ? " " + d.med.strength : ""} · ${doseText(d.med)}${extra ? " · " + extra : ""}`,
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
  if (NATIVE) return nativeReschedule();
  if (!("showTrigger" in Notification.prototype) || typeof TimestampTrigger === "undefined") return;
  if (Notification.permission !== "granted" || !swReg) return;
  const now = new Date();
  for (const d of [now, addDays(now, 1)]) {
    for (const dose of dosesFor(d, "alarm")) {
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

// Campanita suave (Do-Mi-Sol), una sola vez: avisa sin asustar
function beepOnce() {
  if (!audioCtx || !state.settings.sound) return;
  const t0 = audioCtx.currentTime + 0.05;
  const master = audioCtx.createGain();
  master.gain.value = 0.22;
  master.connect(audioCtx.destination);
  [[523.25, 0], [659.25, 0.28], [783.99, 0.56]].forEach(([f, off]) => {
    [[1, 1], [2, 0.15], [3, 0.05]].forEach(([k, a]) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = "sine";
      o.frequency.value = f * k;
      const t = t0 + off;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(a, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (k === 1 ? 2.2 : 0.8));
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 2.3);
    });
  });
  navigator.vibrate?.(150);
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
  // Suena una vez por aviso nuevo (no se repite en bucle)
  if (!beepTimer && state.settings.sound && !NATIVE) {
    beepOnce();
    beepTimer = setTimeout(() => { beepTimer = null; }, 10000);
  }
}

function stopBeep() { /* el sonido es corto; no hay que detenerlo */ }
function hideAlarm() { document.getElementById("alarm").classList.add("hidden"); stopBeep(); }

/* ================= Render ================= */

let selectedDate = startOfDay(new Date());
let currentView = "today";

function renderPeople() {
  const el = document.getElementById("people-list");
  if (!el) return;
  el.innerHTML = state.profiles.map(p => `
    <button class="person-row" data-pid="${esc(p.id)}">${avatar(p, 32)}
      <span class="person-name">${esc(p.name)}<small>${isShared(p) ? "👨‍👩‍👧 Compartido" : "Solo en este teléfono"}${p.alarms === false ? " · sin recordatorios" : ""}</small></span>
      <span class="chev">›</span></button>`).join("");
}

function renderAll() {
  applyTextSize();
  renderProfileBars();
  renderPeople();
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
  const viewMeds = state.meds.filter(medInView);
  if (!viewMeds.length) {
    const who = state.currentProfile !== "all" ? profileById(state.currentProfile)?.name : null;
    list.innerHTML = `<div class="empty"><div class="big">💊</div>
      <p>${who ? `${esc(who)} todavía no tiene medicamentos.` : "Todavía no tienes medicamentos."}</p>
      <button class="btn" onclick="openMedForm()">Agregar medicamento</button></div>`;
    return;
  }
  if (!doses.length) {
    list.innerHTML = `<div class="empty"><div class="big">😌</div><p>No hay tomas programadas este día.</p></div>`;
    return;
  }

  // Tarjeta de tomas atrasadas (solo hoy)
  const overdue = isToday ? doses.filter(d => !d.entry && now - d.due > 30 * 60000) : [];
  const overdueHtml = overdue.length ? `
    <div class="overdue card">
      <div class="overdue-title">⏰ ${overdue.length === 1 ? "Tienes 1 toma atrasada" : `Tienes ${overdue.length} tomas atrasadas`}</div>
      ${overdue.map(d => `
        <div class="overdue-row">
          <span><b>${d.time}</b> · ${esc(whoPrefix(d.med))}${esc(d.med.name)}</span>
          <button class="btn small" data-quick="${esc(d.key)}">✓ Tomada</button>
        </div>`).join("")}
    </div>` : "";

  const groups = {};
  doses.forEach(d => (groups[d.time] ||= []).push(d));
  list.innerHTML = overdueHtml + Object.entries(groups).map(([time, items]) => {
    const due = items[0].due;
    const open = items.filter(i => !i.entry);
    const mins = (now - due) / 60000;
    let tag = "";
    if (open.length && mins > 30) tag = `<span class="tag late">Atrasada</span>`;
    else if (open.length && mins >= -15 && mins <= 30) tag = `<span class="tag now">Ahora</span>`;
    // "Marcar todas" cuando hay varias pendientes a la misma hora y ya es (casi) la hora
    const all = open.length > 1 && mins >= -60 ? `<button class="link small-link" data-markall="${esc(open.map(i => i.key).join(","))}">✓ Marcar todas</button>` : "";
    return `<div class="time-group">
      <div class="time-label">🕒 ${time} ${tag}<span class="spacer"></span>${all}</div>
      ${items.map(d => doseCard(d, now)).join("")}
    </div>`;
  }).join("");
}

// "tomada 08:05 por Papá" (el nombre solo en perfiles compartidos)
function entryText(e) {
  if (!e) return "";
  if (e.status === "skipped") return `omitida${e.by && e.byUser && e.byUser !== syncUserId() ? " por " + e.by : ""}`;
  const by = e.by && (e.byUser ? e.byUser !== syncUserId() : false) ? ` por ${e.by}` : "";
  return `tomada ${hhmm(new Date(e.at))}${by}`;
}

function doseCard(d, now) {
  const st = d.entry?.status || "";
  const late = !st && now - d.due > 30 * 60000;
  const snz = state.snooze[d.key] && state.snooze[d.key] > now.getTime() ? ` · pospuesta a ${hhmm(new Date(state.snooze[d.key]))}` : "";
  const when = st ? " · " + esc(entryText(d.entry)) : snz;
  const sub = [d.med.strength, doseText(d.med), d.med.food].filter(Boolean).map(esc).join(" · ") + when;
  const who = multiProfile() && state.currentProfile === "all"
    ? `<span class="who" style="--pc:${profileOf(d.med).color}">${esc(profileOf(d.med).name)}</span>` : "";
  return `<div class="dose ${st}" style="--c:${d.med.color}" data-key="${esc(d.key)}">
    <div class="pill-ico">${FORM_ICON[d.med.form] || "💊"}</div>
    <div class="dose-main">
      <div class="dose-name">${esc(d.med.name)} ${who}</div>
      <div class="dose-sub">${sub}</div>
    </div>
    <button class="status ${st} ${late ? "late" : ""}" data-quick="${esc(d.key)}" aria-label="Marcar como tomada">${st === "skipped" ? "✕" : "✓"}</button>
  </div>`;
}

function freqText(med) {
  if (med.plan && med.plan !== "custom") {
    if (med.plan === "h24") return "1 vez al día";
    if (med.plan.startsWith("h")) return `Cada ${med.plan.slice(1)} horas`;
    return `Cada ${med.plan.slice(1)} días`;
  }
  const f = med.freq || { type: "daily" };
  if (f.type === "weekdays") return [1, 2, 3, 4, 5, 6, 0].filter(x => f.days.includes(x)).map(x => DAY_NAME[x]).join(", ");
  if (f.type === "interval") return `Cada ${f.every} días`;
  return "Todos los días";
}

// "Día 3 de 7 · termina el 19 nov", "Uso continuo", etc.
function durationText(med) {
  if (!med.endDate) return "Uso continuo";
  const start = parseYmd(med.startDate), end = parseYmd(med.endDate);
  const total = med.durationDays || daysBetween(start, end) + 1;
  const today = startOfDay(new Date());
  const fmt = d => d.toLocaleDateString("es", { day: "numeric", month: "short" }).replace(".", "");
  if (med.endAt ? Date.now() >= med.endAt : today > end) return `Terminó el ${fmt(end)}`;
  if (today < start) return `${total} días · empieza el ${fmt(start)}`;
  const day = Math.min(total, daysBetween(start, today) + 1);
  return `Día ${day} de ${total} · termina el ${fmt(end)}`;
}

function renderMeds() {
  const el = document.getElementById("meds-list");
  const list = state.meds.filter(medInView);
  if (!list.length) {
    el.innerHTML = `<div class="empty"><div class="big">🗂️</div><p>Aquí verás los medicamentos.</p></div>`;
    return;
  }
  const now = Date.now();
  const ended = m => m.endAt ? now >= m.endAt : (m.endDate && startOfDay(new Date()) > parseYmd(m.endDate));
  const sections = [
    ["Activos", list.filter(m => !m.paused && !ended(m))],
    ["En pausa", list.filter(m => m.paused && !ended(m))],
    ["Terminados", list.filter(m => ended(m))]
  ];
  const card = m => {
    const low = m.stockOn && m.stock <= m.stockAlert;
    const stock = m.stockOn ? `<div class="stock-row"><span class="small ${low ? "stock-low" : "muted"}">${low ? "⚠️ " : ""}Quedan ${m.stock}${low ? " · ¡reponer!" : ""}</span>
      <button type="button" class="mini-chip" data-refill="${m.id}">+ Reponer</button></div>` : "";
    const who = multiProfile() && state.currentProfile === "all" ? `<span class="who" style="--pc:${profileOf(m).color}">${esc(profileOf(m).name)}</span>` : "";
    return `<div class="card med-item" data-med="${m.id}" style="--c:${m.color}">
      <div class="pill-ico">${FORM_ICON[m.form] || "💊"}</div>
      <div class="dose-main">
        <div class="dose-name">${esc(m.name)} <span class="muted small">${esc(m.strength || "")}</span> ${who}</div>
        <div class="dose-sub">${doseText(m)} · ${freqText(m)}</div>
        <div class="dose-sub">🕒 ${m.times.join(" · ")}</div>
        <div class="dose-sub">${durationText(m)}</div>
        ${stock}
        ${m.rx?.photoIds?.length ? `<button type="button" class="rx-chip" data-rx="${m.id}">📄 Ver receta${m.rx.photoIds.length > 1 ? ` (${m.rx.photoIds.length})` : ""}</button>` : ""}
      </div>
      <div class="chev">›</div>
    </div>`;
  };
  el.innerHTML = sections.filter(([, ms]) => ms.length).map(([title, ms]) => `
    <h3 class="section-title">${title} <span class="muted">${ms.length}</span></h3>
    ${ms.sort((a, b) => a.name.localeCompare(b.name)).map(card).join("")}`).join("");
}

async function refillFlow(id) {
  const m = state.meds.find(x => x.id === id);
  if (!m) return;
  const v = await ask({ title: `Reponer ${m.name}`, text: `Ahora quedan ${m.stock}. ¿Cuántas ${doseText({ qty: 2, form: m.form }).replace(/^2 /, "")} agregaste?`, ok: "Agregar", input: { type: "number", value: 30, min: 0 } });
  const n = Number(v);
  if (!v || !(n > 0)) return;
  m.stock = Math.round((m.stock + n) * 100) / 100;
  save(); syncMed(m); renderMeds();
  toast(`Ahora quedan ${m.stock}`);
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
  const pm = state.meds.filter(medInView).map(m => ({ m, a: adherence(addDays(today, -29), now, m.id) })).filter(x => x.a.total);
  document.getElementById("per-med").innerHTML = pm.length ? pm.map(({ m, a }) => `
    <div class="pm-row">
      <div class="pm-top"><span>${esc(m.name)}</span><span class="muted">${a.taken}/${a.total} · ${a.pct}%</span></div>
      <div class="pm-track"><div class="pm-fill" style="width:${a.pct}%;background:${m.color}"></div></div>
    </div>`).join("") : `<p class="muted small">Aún no hay datos.</p>`;

  // historial
  const hist = Object.entries(state.log)
    .map(([key, e]) => ({ dose: findDose(key), e }))
    .filter(x => x.dose && medInView(x.dose.med))
    .sort((a, b) => b.e.at - a.e.at)
    .slice(0, 20);
  document.getElementById("history").innerHTML = hist.length ? hist.map(({ dose, e }) => {
    const d = new Date(e.at);
    return `<div class="hist-row">
      <span>${e.status === "taken" ? "✅" : "⏭️"} ${esc(whoPrefix(dose.med))}${esc(dose.med.name)} <span class="muted">(${dose.time})</span></span>
      <span class="muted">${d.toLocaleDateString("es", { day: "numeric", month: "short" })} ${hhmm(d)}${e.by && e.byUser && e.byUser !== syncUserId() ? " · " + esc(e.by) : ""}</span>
    </div>`;
  }).join("") : `<p class="muted small">Aún no hay registros.</p>`;
}

function renderNotifUI() {
  if (NATIVE) return renderNativeNotifUI();
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
  const tab = v === "reports" ? "progress" : v;
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.view === tab));
  document.querySelectorAll(".prog-seg button").forEach(b => b.classList.toggle("active", b.dataset.go === v));
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
let formPlan = "h8";     // h4 h6 h8 h12 h24 d2 d3 custom
let formDur = "7";       // número de días, "other" o "0" (uso continuo)
let formStep = 0;
let formProfile = null;  // persona a la que pertenece el medicamento

function renderForChips() {
  const field = document.getElementById("for-field");
  field.classList.toggle("hidden", !multiProfile());
  document.getElementById("for-chips").innerHTML = state.profiles.map(p =>
    `<button type="button" class="pchip ${p.id === formProfile ? "active" : ""}" data-for="${esc(p.id)}">${avatar(p, 22)} ${esc(p.name)}</button>`).join("");
}
const STEPS = 4;

// Hora redondeada a los próximos 15 minutos (valor por defecto de la primera toma)
function nextQuarter() {
  const d = new Date(Date.now() + 5 * 60000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  return d;
}

function openMedForm(id = null) {
  editingId = id;
  const med = id ? state.meds.find(m => m.id === id) : null;
  const f = document.getElementById("med-form");
  f.reset();
  document.getElementById("sheet-title").textContent = med ? "Editar medicamento" : "Nuevo medicamento";
  document.getElementById("btn-delete-med").classList.toggle("hidden", !med);
  document.getElementById("btn-save-top").classList.toggle("invisible", !med);

  f.name.value = med?.name || "";
  f.strength.value = med?.strength || "";
  f.form.value = med?.form || "comprimido";
  f.qty.value = med?.qty ?? 1;
  f.food.value = med?.food || "";
  f.notes.value = med?.notes || "";
  f.stockOn.checked = !!med?.stockOn;
  f.stock.value = med?.stock ?? 30;
  f.stockAlert.value = med?.stockAlert ?? 5;
  f.every.value = med?.freq?.every || 2;

  // Frecuencia
  formPlan = med ? (med.plan || "custom") : "h8";
  formFreq = med?.freq?.type || "daily";
  formDays = med?.freq?.days ? [...med.freq.days] : [1, 2, 3, 4, 5];
  formColor = med?.color || COLORS[state.meds.length % COLORS.length];
  formProfile = med?.profileId || (state.currentProfile !== "all" ? state.currentProfile : state.profiles[0].id);
  renderForChips();
  const first = med?.startAt ? new Date(med.startAt)
    : med ? atTime(med.startDate, med.times[0]) : nextQuarter();
  f.firstDate.value = ymd(first);
  f.firstTime.value = hhmm(first);
  f.startDate.value = med?.startDate || ymd(new Date());

  // Duración
  let days = med?.durationDays ?? null;
  if (med && days == null && med.endDate) days = daysBetween(parseYmd(med.startDate), parseYmd(med.endDate)) + 1;
  if (!med) formDur = "7";
  else if (days == null) formDur = "0";
  else if ([3, 5, 7, 10, 14, 30].includes(days)) formDur = String(days);
  else { formDur = "other"; f.durDays.value = days; }

  renderColors();
  renderFreq();
  renderDays();
  renderTimes(med?.times || ["08:00"]);
  renderPlan();
  renderDur();
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
  goStep(0);
  document.getElementById("sheet").classList.remove("hidden");
  setTimeout(() => !med && f.name.focus(), 150);
}

function closeSheet(saved = false) {
  if (!saved) rxDiscard();
  document.getElementById("sheet").classList.add("hidden");
}

/* ----- Pasos ----- */

function goStep(n) {
  formStep = Math.max(0, Math.min(STEPS - 1, n));
  document.querySelectorAll("#med-form .step").forEach(s => s.classList.toggle("active", Number(s.dataset.panel) === formStep));
  document.querySelectorAll("#steps button").forEach(b => {
    const i = Number(b.dataset.step);
    b.classList.toggle("active", i === formStep);
    b.classList.toggle("done", i < formStep);
  });
  const last = formStep === STEPS - 1;
  document.getElementById("btn-step-back").classList.toggle("invisible", formStep === 0);
  document.getElementById("btn-step-next").classList.toggle("hidden", last);
  document.getElementById("btn-step-save").classList.toggle("hidden", !last);
  if (formStep === 2) renderSummary();
  if (formStep === 3) renderStockHint();
  document.querySelector("#med-form .sheet-body").scrollTop = 0;
}

// Revisa el paso actual antes de avanzar; devuelve un mensaje si falta algo
function stepError(step) {
  const f = document.getElementById("med-form");
  if (step === 0 && !f.name.value.trim()) return "Escribe el nombre del medicamento";
  if (step === 1) {
    if (formPlan === "custom") {
      if (!formTimes().length) return "Agrega al menos un horario";
      if (formFreq === "weekdays" && !formDays.length) return "Elige al menos un día";
      if (!f.startDate.value) return "Elige el día en que empieza";
    } else if (!f.firstDate.value || !f.firstTime.value) return "Indica el día y la hora de la primera toma";
  }
  if (step === 2 && formDur === "other") {
    const n = Number(f.durDays.value);
    if (!Number.isInteger(n) || n < 1 || n > 365) return "Escribe un número de días entre 1 y 365";
  }
  return null;
}

function nextStep() {
  const err = stepError(formStep);
  if (err) { toast(err); return; }
  goStep(formStep + 1);
}

/* ----- Frecuencia ----- */

function formTimes() {
  return [...new Set([...document.querySelectorAll("#times input")].map(i => i.value).filter(Boolean))].sort();
}

// Calcula horarios, fechas y ventana de tomas a partir de lo elegido en el asistente
function computePlan() {
  const f = document.getElementById("med-form");
  const r = { plan: formPlan, everyH: null, startAt: null, endAt: null, durationDays: null };
  if (formPlan === "custom") {
    r.freq = { type: formFreq, days: [...formDays].sort(), every: Math.max(2, Number(f.every.value) || 2) };
    r.times = formTimes();
    r.startDate = f.startDate.value || ymd(new Date());
  } else {
    const first = atTime(f.firstDate.value || ymd(new Date()), f.firstTime.value || "08:00");
    r.startAt = first.getTime();
    r.startDate = ymd(first);
    const firstMin = first.getHours() * 60 + first.getMinutes();
    if (formPlan.startsWith("h")) {
      const n = Number(formPlan.slice(1));
      r.everyH = n;
      r.freq = { type: "daily", days: [], every: 2 };
      const set = new Set();
      for (let k = 0; k < 24 / n; k++) {
        const m = (firstMin + k * n * 60) % 1440;
        set.add(`${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
      }
      r.times = [...set].sort();
    } else {
      r.freq = { type: "interval", days: [], every: Number(formPlan.slice(1)) };
      r.times = [hhmm(first)];
    }
  }
  const days = formDur === "0" ? null : formDur === "other" ? Number(f.durDays.value) || null : Number(formDur);
  if (days) {
    r.durationDays = days;
    const base = r.startAt ?? parseYmd(r.startDate).getTime();
    r.endAt = addDays(new Date(base), days).getTime();
    r.endDate = ymd(new Date(r.endAt - 1));
  } else {
    r.endDate = null;
  }
  return r;
}

// Tomas que genera el plan (para el resumen); limitado para planes largos
function planDoses(p, limit = 2000) {
  const out = [];
  const start = parseYmd(p.startDate);
  const lastDay = p.endDate ? parseYmd(p.endDate) : addDays(start, 0);
  const fake = { freq: p.freq, startDate: p.startDate, endDate: p.endDate, times: p.times, startAt: p.startAt, endAt: p.endAt };
  for (let d = start; d <= lastDay && out.length < limit; d = addDays(d, 1)) {
    if (!isScheduledOn(fake, d)) continue;
    for (const t of p.times) {
      const due = atTime(ymd(d), t);
      if (inWindow(fake, due)) out.push(due);
    }
  }
  return out.sort((a, b) => a - b);
}

function renderPlan() {
  document.querySelectorAll("#plan-chips button").forEach(b => b.classList.toggle("active", b.dataset.plan === formPlan));
  const custom = formPlan === "custom";
  document.getElementById("plan-auto").classList.toggle("hidden", custom);
  document.getElementById("plan-custom").classList.toggle("hidden", !custom);
  const prev = document.getElementById("plan-times-preview");
  if (!custom) {
    const p = computePlan();
    prev.innerHTML = formPlan.startsWith("h")
      ? `Horarios cada día: <b>${p.times.join(" · ")}</b>`
      : `Una toma a las <b>${p.times[0]}</b> cada ${p.freq.every} días`;
  }
}

function renderDur() {
  document.querySelectorAll("#dur-chips button").forEach(b => b.classList.toggle("active", b.dataset.dur === formDur));
  document.getElementById("dur-other").classList.toggle("hidden", formDur !== "other");
  renderSummary();
}

function fmtWhen(d) {
  const s = d.toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short" }).replace(/\./g, "");
  return `${s}, ${hhmm(d)}`;
}

function renderSummary() {
  const el = document.getElementById("plan-summary");
  if (!el || stepError(1)) { if (el) el.innerHTML = ""; return; }
  const f = document.getElementById("med-form");
  const p = computePlan();
  const qty = Math.max(0.25, Number(f.qty.value) || 1);
  const fakeMed = { qty, form: f.form.value };
  const name = esc(f.name.value.trim() || "tu medicamento");
  const freqLine = formPlan === "custom" ? freqText({ freq: p.freq }) + ` · ${p.times.join(" · ")}`
    : formPlan === "h24" ? `1 vez al día a las ${p.times[0]}`
    : formPlan.startsWith("h") ? `Cada ${p.everyH} horas (${p.times.join(" · ")})`
    : `Cada ${p.freq.every} días a las ${p.times[0]}`;
  if (!p.durationDays) {
    const perDay = formPlan.startsWith("d") ? null : (p.freq.type === "daily" ? p.times.length : null);
    el.innerHTML = `
      <div class="ps-title">🔁 Tratamiento continuo</div>
      <div class="ps-row"><span>Medicamento</span><b>${name}</b></div>
      <div class="ps-row"><span>Frecuencia</span><b>${esc(freqLine)}</b></div>
      <div class="ps-row"><span>Empieza</span><b>${fmtWhen(p.startAt ? new Date(p.startAt) : atTime(p.startDate, p.times[0]))}</b></div>
      ${perDay ? `<div class="ps-row"><span>Tomas por día</span><b>${perDay}</b></div>` : ""}
      <p class="hint">Se programará sin fecha de fin. Puedes pausarlo o terminarlo cuando quieras.</p>`;
    return;
  }
  const doses = planDoses(p);
  if (!doses.length) { el.innerHTML = `<p class="hint">Con estos datos no queda ninguna toma. Revisa la frecuencia o los días.</p>`; return; }
  const total = doses.length;
  el.innerHTML = `
    <div class="ps-title">✅ Se programarán <b>${total}</b> ${total === 1 ? "toma" : "tomas"}</div>
    <div class="ps-row"><span>Medicamento</span><b>${name}</b></div>
    <div class="ps-row"><span>Frecuencia</span><b>${esc(freqLine)}</b></div>
    <div class="ps-row"><span>Primera toma</span><b>${fmtWhen(doses[0])}</b></div>
    <div class="ps-row"><span>Última toma</span><b>${fmtWhen(doses[total - 1])}</b></div>
    <div class="ps-row"><span>Necesitarás</span><b>${doseText({ ...fakeMed, qty: Math.round(qty * total * 100) / 100 })}</b></div>`;
}

function renderStockHint() {
  const f = document.getElementById("med-form");
  const hint = document.getElementById("stock-hint");
  if (stepError(1)) { hint.textContent = ""; return; }
  const p = computePlan();
  if (!p.durationDays) { hint.textContent = ""; return; }
  const qty = Math.max(0.25, Number(f.qty.value) || 1);
  const need = Math.round(planDoses(p).length * qty * 100) / 100;
  hint.textContent = `Para todo el tratamiento necesitas ${doseText({ qty: need, form: f.form.value })}.`;
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
  const f = document.getElementById("med-form");
  for (let s = 0; s < STEPS; s++) {
    const err = stepError(s);
    if (err) { goStep(s); toast(err); return; }
  }
  const p = computePlan();
  if (p.durationDays && !planDoses(p, 1).length) { goStep(2); toast("Con estos datos no queda ninguna toma"); return; }

  const existing = editingId ? state.meds.find(m => m.id === editingId) : null;
  const med = {
    id: existing?.id || uid(),
    profileId: formProfile || state.profiles[0].id,
    name: f.name.value.trim(),
    strength: f.strength.value.trim(),
    form: f.form.value,
    qty: Math.max(0.25, Number(f.qty.value) || 1),
    color: formColor,
    plan: p.plan,
    everyH: p.everyH,
    freq: p.freq,
    times: p.times,
    startDate: p.startDate,
    endDate: p.endDate,
    startAt: p.startAt,
    endAt: p.endAt,
    durationDays: p.durationDays,
    food: f.food.value,
    notes: f.notes.value.trim(),
    stockOn: f.stockOn.checked,
    stock: Number(f.stock.value) || 0,
    stockAlert: Number(f.stockAlert.value) || 0,
    paused: existing?.paused || false,
    rx: rxCollect(),
    createdAt: existing?.createdAt || Date.now()
  };

  // Si cambió de persona y el perfil anterior era compartido, se borra de allá
  if (existing && existing.profileId !== med.profileId) syncMedDeleted(existing);
  const removedPhotos = [...rxForm.removed];
  if (existing) Object.assign(existing, med);
  else state.meds.push(med);
  save();
  rxCommit();
  if (removedPhotos.length) syncPhotosRemoved(existing || med, removedPhotos);
  syncMed(existing || med);
  closeSheet(true);
  renderAll();
  scheduleFutureNotifications();
  if (existing) toast("Cambios guardados");
  else {
    const n = p.durationDays ? planDoses(p).length : null;
    toast(n ? `Listo: ${n} tomas programadas` : "Medicamento agregado");
  }
  if (!existing && "Notification" in window && Notification.permission === "default") {
    setTimeout(askNotifPermission, 600);
  }
}

async function deleteMed() {
  const med = state.meds.find(m => m.id === editingId);
  if (!med) return;
  const shared = isShared(profileOf(med));
  if (!(await ask({ title: `¿Eliminar ${med.name}?`, text: shared ? "Se borrará también para tu familia, con su historial." : "Se borrará con su historial.", ok: "Eliminar", danger: true }))) return;
  syncMedDeleted(med);
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
        ${d.entry ? `<div class="entry-line ${d.entry.status}">${d.entry.status === "taken" ? "✓" : "✕"} ${esc(entryText(d.entry).replace(/^./, c => c.toUpperCase()))}</div>` : ""}
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

// Antes de registrar: si otra persona ya dio esta toma, avisar para no dar doble dosis
async function guardDouble(key) {
  const remote = await syncCheckDose(key);
  const e = remote ? state.log[key] : (state.log[key]?.status === "taken" ? state.log[key] : null);
  if (!e || e.status !== "taken") return true;
  save(); renderAll();
  const med = findDose(key)?.med;
  const who = e.by && e.byUser !== syncUserId() ? e.by : "Alguien";
  return ask({
    title: "⚠️ Esta toma ya está registrada",
    text: `${who} registró ${med?.name || "esta medicina"} a las ${hhmm(new Date(e.at))}. Para evitar una doble dosis, no la des de nuevo.`,
    ok: "Entendido", cancel: false
  }).then(() => false);
}

// Marca como tomada con opción de deshacer
async function markTaken(key, at) {
  if (!(await guardDouble(key))) return;
  setDose(key, "taken", at);
  toast("✓ Toma registrada", { action: "Deshacer", onAction: () => { setDose(key, null); toast("Registro deshecho"); } });
}

async function onAction(act) {
  const key = actionKey;
  document.getElementById("action-sheet").classList.add("hidden");
  if (!key || act === "close") return;
  if (act === "taken") markTaken(key);
  else if (act === "taken-other") {
    const d = findDose(key);
    const t = await askTime("¿A qué hora la tomó?", hhmm(new Date()));
    if (!t) return;
    markTaken(key, atTime(d.date, t).getTime());
  }
  else if (act === "skipped") { setDose(key, "skipped"); toast("Toma omitida"); }
  else if (act === "undo") { setDose(key, null); toast("Registro deshecho"); }
  else if (act === "snooze") snooze(key);
}

/* ================= Permisos / ajustes ================= */

function renderNativeNotifUI() {
  const banner = document.getElementById("notif-banner");
  banner.classList.toggle("hidden", !(nativePerm !== "granted" && state.meds.length));
  banner.querySelector("span").textContent = nativePerm === "denied"
    ? "Los recordatorios están bloqueados. Actívalas en Ajustes del teléfono → Apps → MediHora → Notificaciones."
    : "Activa los recordatorios para recibir un aviso a la hora de cada toma.";
  document.getElementById("btn-enable-notif").classList.toggle("hidden", nativePerm === "denied");
  const st = document.getElementById("notif-status");
  st.textContent = nativePerm === "granted"
    ? (nativeExact === "granted"
        ? "✅ Recordatorios activados. Llegan aunque la app esté cerrada."
        : "⚠️ Recordatorios activados, pero sin «Alarmas y recordatorios» pueden llegar con retraso. Toca «Activar» para permitirlo.")
    : nativePerm === "denied"
      ? "❌ Bloqueadas. Actívalas en Ajustes del teléfono → Apps → MediHora → Notificaciones."
      : "Aún no has dado permiso.";
  document.getElementById("btn-enable-notif-2").classList.toggle("hidden", nativePerm === "granted" && nativeExact === "granted");
}

async function askNotifPermission() {
  if (NATIVE) {
    if (nativePerm === "granted") { await nativeAskExact(); await nativeRefreshPerm(); }
    else await nativeRequestPermission();
    return;
  }
  if (!("Notification" in window)) { toast("Tu navegador no admite notificaciones"); return; }
  const p = await Notification.requestPermission();
  renderNotifUI();
  if (p === "granted") { toast("Notificaciones activadas"); scheduleFutureNotifications(); }
}

async function exportData() {
  toast("Preparando copia…");
  const photos = await rxExportAll();
  const blob = new Blob([JSON.stringify({ ...state, photos })], { type: "application/json" });
  if (NATIVE) {
    try { await nativeShareBlob(blob, `medihora-${ymd(new Date())}.json`, "Copia de seguridad de MediHora"); }
    catch (e) { toast("No se pudo exportar: " + e.message); }
    return;
  }
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
      if (!(await ask({ title: "¿Importar la copia?", text: "Esto reemplazará los datos de este teléfono.", ok: "Importar", danger: true }))) return;
      await rxImportAll(p.photos);
      state = { ...state, meds: p.meds, log: p.log || {}, snooze: p.snooze || {}, notified: {},
        settings: { ...state.settings, ...(p.settings || {}) },
        profiles: p.profiles || [], currentProfile: p.currentProfile || "all", members: p.members || {},
        sync: p.sync || { cursors: {}, outbox: [], uploaded: {} } };
      migrateProfiles();
      save(); loadSettingsUI(); renderAll(); syncAll();
      toast("Datos importados");
    } catch (e) { toast("No se pudo importar: " + e.message); }
  };
  r.readAsText(file);
}

function loadSettingsUI() {
  document.getElementById("set-name").value = state.settings.name || "";
  document.getElementById("set-sound").checked = !!state.settings.sound;
  document.getElementById("set-snooze").value = String(state.settings.snoozeMin);
  document.getElementById("set-big").checked = !!state.settings.bigText;
}

let toastTimer = null;
function toast(msg, opts = {}) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  if (opts.action) {
    const b = document.createElement("button");
    b.className = "toast-action";
    b.textContent = opts.action;
    b.onclick = () => { el.classList.add("hidden"); opts.onAction?.(); };
    el.appendChild(b);
  }
  el.classList.toggle("has-action", !!opts.action);
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), opts.action ? 6000 : 2600);
}

function applyTextSize() {
  document.documentElement.classList.toggle("big-text", !!state.settings.bigText);
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
  document.getElementById("med-form").stockOn.onchange = () => { toggleStockFields(); renderStockHint(); };
  // Asistente por pasos
  document.getElementById("btn-step-next").onclick = nextStep;
  document.getElementById("btn-step-back").onclick = () => goStep(formStep - 1);
  document.getElementById("steps").onclick = e => {
    const b = e.target.closest("[data-step]");
    if (!b) return;
    const to = Number(b.dataset.step);
    // al crear, solo se puede saltar hacia atrás o a pasos ya válidos
    for (let s = 0; s < to; s++) { const err = stepError(s); if (err) { goStep(s); toast(err); return; } }
    goStep(to);
  };
  document.getElementById("plan-chips").onclick = e => {
    const b = e.target.closest("[data-plan]");
    if (b) { formPlan = b.dataset.plan; renderPlan(); }
  };
  document.getElementById("dur-chips").onclick = e => {
    const b = e.target.closest("[data-dur]");
    if (!b) return;
    formDur = b.dataset.dur;
    renderDur();
    if (formDur === "other") document.getElementById("med-form").durDays.focus();
  };
  document.getElementById("med-form").addEventListener("input", e => {
    const n = e.target.name;
    if (n === "firstDate" || n === "firstTime") renderPlan();
    if (n === "durDays" || n === "qty") renderSummary();
    if (e.target.closest("#times") || n === "startDate" || n === "every") renderSummary();
  });
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
      markTaken(key);
      return;
    }
    const all = e.target.closest("[data-markall]");
    if (all) {
      const keys = all.dataset.markall.split(",");
      (async () => {
        let n = 0;
        for (const k of keys) { if (await guardDouble(k)) { setDose(k, "taken"); n++; } }
        if (n) toast(`✓ ${n} tomas registradas`, { action: "Deshacer", onAction: () => { keys.forEach(k => state.log[k]?.byUser === syncUserId() && setDose(k, null)); toast("Registros deshechos"); } });
      })();
      return;
    }
    const card = e.target.closest("[data-key]");
    if (card) openActionSheet(card.dataset.key);
  };
  document.getElementById("meds-list").onclick = e => {
    const refill = e.target.closest("[data-refill]");
    if (refill) { refillFlow(refill.dataset.refill); return; }
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
  let nameTimer = null;
  document.getElementById("set-name").oninput = e => {
    state.settings.name = e.target.value.trim(); save(); renderToday();
    clearTimeout(nameTimer); nameTimer = setTimeout(syncMyName, 1200);
  };
  document.getElementById("set-big").onchange = e => { state.settings.bigText = e.target.checked; save(); applyTextSize(); };
  document.querySelectorAll(".prog-seg").forEach(seg => seg.onclick = e => {
    const b = e.target.closest("[data-go]");
    if (b) showView(b.dataset.go);
  });
  document.getElementById("btn-add-person").onclick = addPersonFlow;
  document.getElementById("btn-join").onclick = joinFlow;
  document.getElementById("people-list").onclick = e => {
    const b = e.target.closest("[data-pid]");
    if (b) openProfileSheet(b.dataset.pid);
  };
  document.getElementById("for-chips").onclick = e => {
    const b = e.target.closest("[data-for]");
    if (b) { formProfile = b.dataset.for; renderForChips(); }
  };
  document.getElementById("set-sound").onchange = e => { state.settings.sound = e.target.checked; save(); if (e.target.checked) { unlockAudio(); beepOnce(); } };
  document.getElementById("set-snooze").onchange = e => { state.settings.snoozeMin = Number(e.target.value); save(); };
  document.getElementById("btn-enable-notif").onclick = askNotifPermission;
  document.getElementById("btn-enable-notif-2").onclick = askNotifPermission;
  document.getElementById("btn-test-notif").onclick = async () => {
    if (NATIVE) {
      const ok = await nativeNotifyNow("💊 Es hora de tu medicina", "Así sonarán tus recordatorios.", "test", 5000);
      toast(ok ? "El aviso de prueba llegará en 5 segundos. Puedes cerrar la app." : "Activa primero los recordatorios");
      return;
    }
    unlockAudio(); beepOnce();
    const ok = await notify("💊 Es hora de tu medicina", "Así se verán tus recordatorios.", "test");
    if (!ok) toast("Activa primero las notificaciones");
  };
  document.getElementById("btn-export").onclick = exportData;
  document.getElementById("file-import").onchange = e => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ""; };
  document.getElementById("btn-wipe").onclick = async () => {
    if (!(await ask({ title: "¿Borrar todos los datos?", text: "Se borrarán de este teléfono todos los medicamentos, el historial y las recetas. Los perfiles compartidos seguirán en el teléfono de tu familia.", ok: "Borrar todo", danger: true }))) return;
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
if (NATIVE) nativeInit();
syncInit();
checkReminders();
setInterval(tick, 20000);
