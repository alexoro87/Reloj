/* MediHora — Puente con la app nativa (Capacitor).
   En el navegador no hace nada; dentro de la app de Android/iOS programa las
   alarmas en el sistema para que suenen aunque la app esté cerrada. */
"use strict";

const CAP = window.capacitorExports;
const NATIVE = !!(CAP?.Capacitor?.isNativePlatform?.());
const NATIVE_MAX_PENDING = 60;   // iOS admite 64 notificaciones programadas
const NATIVE_DAYS_AHEAD = 14;
const NATIVE_CHANNEL = "tomas-alarma";

let LN = null, FS = null, SHARE = null, APP = null;
let nativePerm = "prompt";       // granted | denied | prompt
let nativeExact = "granted";     // Android 12+: alarmas exactas

if (NATIVE) {
  LN = CAP.registerPlugin("LocalNotifications");
  FS = CAP.registerPlugin("Filesystem");
  SHARE = CAP.registerPlugin("Share");
  APP = CAP.registerPlugin("App");
  document.documentElement.classList.add("native");
}

// Identificador numérico estable para cada toma (las notificaciones nativas usan enteros)
function nativeId(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 1) || 1;
}

async function nativeInit() {
  if (!NATIVE) return;
  try {
    if (CAP.Capacitor.getPlatform() === "android") {
      await LN.createChannel({
        id: NATIVE_CHANNEL, name: "Alarmas de medicinas",
        description: "Avisos a la hora de cada toma",
        importance: 5, visibility: 1, vibration: true, lights: true, lightColor: "#0f9d8a",
        sound: "alarma.wav"
      });
    }
    await LN.registerActionTypes({
      types: [{
        id: "DOSE",
        actions: [
          { id: "take", title: "✓ Tomada" },
          { id: "snooze", title: "⏱ Posponer" }
        ]
      }]
    });
    await LN.addListener("localNotificationActionPerformed", ev => {
      const key = ev?.notification?.extra?.key;
      const act = ev.actionId === "tap" ? "open" : ev.actionId;
      if (key) setTimeout(() => handleExternalAction(act, key), 200);
    });
    await APP.addListener("resume", () => { tick(); renderAll(); nativeRefreshPerm(); });
    await APP.addListener("backButton", nativeBack);
    await nativeRefreshPerm();
    nativeReschedule();
  } catch (e) {
    console.error("Error iniciando funciones nativas", e);
  }
}

async function nativeRefreshPerm() {
  try {
    const p = await LN.checkPermissions();
    nativePerm = p.display === "granted" ? "granted" : p.display === "denied" ? "denied" : "prompt";
    if (CAP.Capacitor.getPlatform() === "android" && LN.checkExactNotificationSetting) {
      const ex = await LN.checkExactNotificationSetting();
      nativeExact = ex.exact_alarm || "granted";
    }
  } catch { /* nada */ }
  renderNotifUI();
}

async function nativeRequestPermission() {
  try {
    const p = await LN.requestPermissions();
    nativePerm = p.display === "granted" ? "granted" : p.display === "denied" ? "denied" : "prompt";
    if (nativePerm === "granted") await nativeAskExact();
  } catch (e) { toast("No se pudo pedir el permiso: " + e.message); }
  await nativeRefreshPerm();
  if (nativePerm === "granted") { toast("Alarmas activadas"); nativeReschedule(); }
}

// Android 12+: sin este permiso las alarmas pueden llegar con minutos de retraso
async function nativeAskExact() {
  if (CAP.Capacitor.getPlatform() !== "android" || !LN.checkExactNotificationSetting) return;
  const ex = await LN.checkExactNotificationSetting();
  if (ex.exact_alarm === "granted") return;
  if (confirm("Para que las alarmas suenen a la hora exacta, activa «Alarmas y recordatorios» para MediHora en la siguiente pantalla.")) {
    await LN.changeExactNotificationSetting();
  }
}

/* ---------- Programación de alarmas ---------- */

function nativeDesired() {
  const now = Date.now();
  const list = [];
  const today = startOfDay(new Date());
  for (let i = -1; i <= NATIVE_DAYS_AHEAD; i++) {
    for (const d of dosesFor(addDays(today, i))) {
      if (d.entry) continue;
      const snz = state.snooze[d.key];
      const at = snz && snz > now ? snz : d.due.getTime();
      if (at <= now) continue;
      list.push({ ...d, at });
    }
  }
  list.sort((a, b) => a.at - b.at);
  return list.slice(0, NATIVE_MAX_PENDING);
}

let nativeTimer = null;
function nativeReschedule() {
  if (!NATIVE) return;
  clearTimeout(nativeTimer);
  nativeTimer = setTimeout(nativeRescheduleNow, 600);
}

async function nativeRescheduleNow() {
  if (nativePerm !== "granted") return;
  try {
    const desired = nativeDesired();
    const used = new Set();
    const notifs = desired.map(d => {
      let id = nativeId(d.key);
      while (used.has(id)) id = (id + 1) % 2147483647 || 1;
      used.add(id);
      const extra = [d.med.food, d.med.notes].filter(Boolean).join(" · ");
      return {
        id,
        title: `💊 ${d.med.name}${d.med.strength ? " " + d.med.strength : ""}`,
        body: `${d.time} — ${doseText(d.med)}${extra ? " · " + extra : ""}`,
        schedule: { at: new Date(d.at), allowWhileIdle: true },
        channelId: NATIVE_CHANNEL,
        sound: "alarma.wav",
        smallIcon: "ic_stat_medihora",
        iconColor: "#0f9d8a",
        actionTypeId: "DOSE",
        autoCancel: true,
        extra: { key: d.key, kind: "dose" }
      };
    });
    const pending = (await LN.getPending()).notifications || [];
    const keep = new Set(notifs.map(n => n.id));
    const cancel = pending
      .filter(p => !keep.has(Number(p.id)) && p.extra?.kind !== "info") // no tocar la alarma de prueba
      .map(p => ({ id: Number(p.id) }));
    if (cancel.length) await LN.cancel({ notifications: cancel });
    if (notifs.length) await LN.schedule({ notifications: notifs });
  } catch (e) {
    console.error("No se pudieron programar las alarmas", e);
  }
}

async function nativeNotifyNow(title, body, tag, delayMs = 0) {
  if (nativePerm !== "granted") return false;
  try {
    const n = {
      id: nativeId("now|" + tag), title, body,
      channelId: NATIVE_CHANNEL, sound: "alarma.wav",
      smallIcon: "ic_stat_medihora", iconColor: "#0f9d8a", autoCancel: true,
      extra: { kind: "info" }
    };
    if (delayMs) n.schedule = { at: new Date(Date.now() + delayMs), allowWhileIdle: true };
    await LN.schedule({ notifications: [n] });
    return true;
  } catch { return false; }
}

async function nativeClear(key) {
  try {
    const delivered = (await LN.getDeliveredNotifications()).notifications || [];
    const mine = delivered.filter(n => n.extra?.key === key || Number(n.id) === nativeId(key));
    if (mine.length) await LN.removeDeliveredNotifications({ notifications: mine });
  } catch { /* nada */ }
}

/* ---------- Archivos: compartir / guardar ---------- */

const blobToBase64 = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1]);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});

// Dentro de la app no existen las descargas del navegador: se guarda el
// archivo y se abre el menú «Compartir» (WhatsApp, correo, Drive, imprimir…)
async function nativeShareBlob(blob, filename, title) {
  const data = await blobToBase64(blob);
  const res = await FS.writeFile({ path: filename, data, directory: "CACHE" });
  try {
    await SHARE.share({ title: title || filename, dialogTitle: title || "Compartir", files: [res.uri] });
  } catch (e) {
    if (!/cancel/i.test(e?.message || "")) throw e;
  }
}

/* ---------- Botón «atrás» de Android ---------- */

function nativeBack() {
  const open = id => !document.getElementById(id).classList.contains("hidden");
  if (open("rx-viewer")) return rxCloseViewer();
  if (open("pdf-sheet")) return document.getElementById("pdf-sheet").classList.add("hidden");
  if (open("action-sheet")) return document.getElementById("action-sheet").classList.add("hidden");
  if (open("sheet")) return closeSheet();
  if (open("alarm")) return hideAlarm();
  if (currentView !== "today") return showView("today");
  APP.minimizeApp();
}
