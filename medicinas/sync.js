/* MediHora — Sincronización de perfiles compartidos con Supabase.
   Los datos se guardan primero en el teléfono (funciona sin internet) y se envían
   al servidor en cuanto hay conexión. Los cambios de otros llegan en tiempo real. */
"use strict";

const SB_URL = "https://liixdnzdyxvobikjkrah.supabase.co";
// Clave pública (publishable): está pensada para ir dentro de la app; la seguridad
// la ponen las reglas del servidor (cada perfil solo lo ven sus miembros).
const SB_KEY = "sb_publishable_hTSHrIvD2ju9n4EtEsLKlQ_Vx-CiiQc";

let SB = null;
let sbUser = null;
let sbChannel = null;
let syncBusy = false;

function sbClient() {
  if (!SB && window.supabase?.createClient) {
    SB = window.supabase.createClient(SB_URL, SB_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "medihora-auth", detectSessionInUrl: false }
    });
  }
  return SB;
}

const syncUserId = () => sbUser?.id || null;
const hasShared = () => state.profiles.some(p => p.cloud);

// Sesión anónima: cada teléfono es un usuario sin correo ni contraseña
async function syncSession() {
  const sb = sbClient();
  if (!sb) throw new Error("No se pudo cargar la conexión con el servidor");
  const { data } = await sb.auth.getSession();
  if (data?.session?.user) { sbUser = data.session.user; return sbUser; }
  const { data: d2, error } = await sb.auth.signInAnonymously();
  if (error) throw error;
  sbUser = d2.user;
  return sbUser;
}

async function rpc(fn, args) {
  const { data, error } = await sbClient().rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}

/* ---------- Conversión entre el formato local y el del servidor ---------- */

function medToRow(med) {
  const { profileId, ...data } = med;
  return { id: med.id, profile_id: profileId, data, deleted: false };
}

function applyMedRow(row) {
  if (pendingFor("med", row.id)) return false; // hay un cambio local sin enviar: gana el local
  const i = state.meds.findIndex(m => m.id === row.id);
  if (row.deleted) {
    if (i >= 0) { rxDeleteForMed(state.meds[i]); state.meds.splice(i, 1); return true; }
    return false;
  }
  const med = { ...row.data, id: row.id, profileId: row.profile_id };
  if (i >= 0) state.meds[i] = med; else state.meds.push(med);
  return true;
}

function applyLogRow(row) {
  if (pendingFor("log", row.dose_key)) return false;
  if (!row.status) {
    if (!state.log[row.dose_key]) return false;
    delete state.log[row.dose_key];
    return true;
  }
  state.log[row.dose_key] = {
    status: row.status,
    at: row.taken_at ? Date.parse(row.taken_at) : Date.parse(row.updated_at),
    by: row.by_name || "",
    byUser: row.by_user || null
  };
  delete state.snooze[row.dose_key];
  return true;
}

/* ---------- Cola de cambios pendientes (funciona sin internet) ---------- */

const pendingFor = (t, id) => state.sync.outbox.some(o => o.t === t && o.id === id);

function queue(op) {
  const ob = state.sync.outbox;
  const i = ob.findIndex(o => o.t === op.t && o.id === op.id);
  if (i >= 0) ob.splice(i, 1);
  ob.push(op);
  save();
  flushSoon();
}

let flushTimer = null;
function flushSoon(ms = 400) {
  clearTimeout(flushTimer);
  flushTimer = setTimeout(syncFlush, ms);
}

// Llamadas desde la app cuando algo cambia
function syncMed(med) {
  if (!isShared(profileOf(med))) return;
  queue({ t: "med", id: med.id, profileId: med.profileId });
  for (const pid of med.rx?.photoIds || []) {
    if (!state.sync.uploaded[pid]) queue({ t: "photo", id: pid, profileId: med.profileId });
  }
}
function syncMedDeleted(med) {
  if (!isShared(profileOf(med))) return;
  queue({ t: "meddel", id: med.id, profileId: med.profileId, data: medToRow(med).data });
}
function syncLog(key) {
  const med = state.meds.find(m => m.id === key.split("|")[0]);
  if (!med || !isShared(profileOf(med))) return;
  queue({ t: "log", id: key, profileId: med.profileId, medId: med.id });
}
function syncPhotosRemoved(med, photoIds) {
  if (!isShared(profileOf(med))) return;
  for (const id of photoIds) queue({ t: "photodel", id, profileId: med.profileId });
}
function syncProfileMeta(p) {
  queue({ t: "profile", id: p.id, profileId: p.id });
}

async function syncFlush() {
  if (syncBusy || !state.sync.outbox.length || !navigator.onLine) return;
  syncBusy = true;
  try {
    await syncSession();
    const sb = sbClient();
    for (const op of [...state.sync.outbox]) {
      let error = null;
      if (op.t === "med") {
        const med = state.meds.find(m => m.id === op.id);
        if (med) ({ error } = await sb.from("medications").upsert(medToRow(med)));
      } else if (op.t === "meddel") {
        ({ error } = await sb.from("medications").upsert({ id: op.id, profile_id: op.profileId, data: op.data, deleted: true }));
        // y sus fotos de receta
        const files = (op.data?.rx?.photoIds || []).map(pid => `${op.profileId}/${pid}.jpg`);
        if (!error && files.length) await sb.storage.from("recetas").remove(files);
      } else if (op.t === "log") {
        const e = state.log[op.id];
        ({ error } = await sb.from("dose_logs").upsert({
          profile_id: op.profileId, dose_key: op.id, med_id: op.medId,
          status: e?.status || null, taken_at: e ? new Date(e.at).toISOString() : null
        }));
      } else if (op.t === "profile") {
        const p = profileById(op.id);
        if (p) ({ error } = await sb.from("profiles").update({ name: p.name, color: p.color }).eq("id", p.id));
      } else if (op.t === "photodel") {
        ({ error } = await sb.storage.from("recetas").remove([`${op.profileId}/${op.id}.jpg`]));
        if (!error) delete state.sync.uploaded[op.id];
      } else if (op.t === "photo") {
        const rec = await rxGet(op.id).catch(() => null);
        if (rec) {
          ({ error } = await sb.storage.from("recetas").upload(`${op.profileId}/${op.id}.jpg`, rec.blob, { upsert: true, contentType: "image/jpeg" }));
          if (!error) state.sync.uploaded[op.id] = true;
        }
      }
      if (error && /fetch|network/i.test(error.message || "")) break; // sin conexión: reintentar después
      if (error) {
        op.tries = (op.tries || 0) + 1;
        console.warn("Sincronización rechazada", op, error.message);
        if (op.tries < 5) continue;
      }
      state.sync.outbox = state.sync.outbox.filter(o => o !== op);
    }
    save();
  } catch (e) {
    console.warn("No se pudo sincronizar", e);
  } finally {
    syncBusy = false;
  }
}

/* ---------- Traer cambios del servidor ---------- */

async function syncPull(profileId) {
  const sb = sbClient();
  const since = state.sync.cursors[profileId];
  // margen de 5 minutos por si algún cambio se guardó con hora ligeramente anterior
  const from = since ? new Date(Date.parse(since) - 5 * 60000).toISOString() : "1970-01-01T00:00:00Z";
  let maxTs = since || null;
  let changed = false;

  const { data: prof, error: pe } = await sb.from("profiles").select("*").eq("id", profileId).maybeSingle();
  if (pe) throw pe;
  if (!prof) return "removed"; // ya no eres miembro (o el perfil se borró)
  const p = profileById(profileId);
  if (p && !pendingFor("profile", profileId) && (p.name !== prof.name || p.color !== prof.color)) {
    p.name = prof.name; p.color = prof.color; changed = true;
  }

  for (const [table, apply] of [["medications", applyMedRow], ["dose_logs", applyLogRow]]) {
    let page = 0;
    for (;;) {
      const { data, error } = await sb.from(table).select("*")
        .eq("profile_id", profileId).gt("updated_at", from)
        .order("updated_at").range(page * 1000, page * 1000 + 999);
      if (error) throw error;
      for (const row of data) {
        if (apply(row)) changed = true;
        if (!maxTs || row.updated_at > maxTs) maxTs = row.updated_at;
      }
      if (data.length < 1000) break;
      page++;
    }
  }
  if (maxTs) state.sync.cursors[profileId] = maxTs;
  await syncRefreshMembers(profileId).catch(() => {});
  return changed;
}

async function syncRefreshMembers(profileId) {
  await syncSession();
  const { data, error } = await sbClient().from("profile_members")
    .select("user_id, display_name, role, joined_at").eq("profile_id", profileId).order("joined_at");
  if (error) throw error;
  state.members[profileId] = data;
  save();
}

async function syncAll() {
  if (!hasShared() || !navigator.onLine) return;
  try {
    await syncSession();
    await syncFlush();
    let changed = false;
    for (const p of state.profiles.filter(x => x.cloud)) {
      const r = await syncPull(p.id);
      if (r === "removed") {
        // te quitaron del perfil: se conserva una copia solo en este teléfono
        p.cloud = false;
        p.name = p.name + " (copia)";
        delete state.members[p.id];
        toast(`Ya no tienes acceso compartido a ${p.name.replace(" (copia)", "")}`);
        changed = true;
      } else if (r) changed = true;
    }
    save();
    if (changed) { renderAll(); scheduleFutureNotifications(); }
    syncSubscribe();
  } catch (e) {
    console.warn("Sincronización pendiente", e?.message || e);
  }
}

/* ---------- Tiempo real ---------- */

let rtTimer = null;
function rtChanged() {
  clearTimeout(rtTimer);
  rtTimer = setTimeout(() => { save(); renderAll(); scheduleFutureNotifications(); }, 250);
}

function syncSubscribe() {
  if (sbChannel || !hasShared()) return;
  const sb = sbClient();
  const mine = pid => state.profiles.some(p => p.cloud && p.id === pid);
  sbChannel = sb.channel("medihora-cambios")
    .on("postgres_changes", { event: "*", schema: "public", table: "medications" }, ev => {
      const row = ev.new;
      if (row?.id && mine(row.profile_id) && applyMedRow(row)) rtChanged();
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "dose_logs" }, ev => {
      const row = ev.new;
      if (!row?.dose_key || !mine(row.profile_id)) return;
      const before = state.log[row.dose_key]?.status;
      if (applyLogRow(row)) {
        rtChanged();
        // aviso suave si otra persona registró una toma
        if (row.status === "taken" && before !== "taken" && row.by_user !== syncUserId()) {
          const med = state.meds.find(m => m.id === row.med_id);
          if (med) { toast(`✓ ${row.by_name || "Alguien"} registró ${med.name}`); closeNotification(row.dose_key); }
        }
      }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, ev => {
      const p = profileById(ev.new?.id);
      if (p && (p.name !== ev.new.name || p.color !== ev.new.color)) { p.name = ev.new.name; p.color = ev.new.color; rtChanged(); }
    })
    .on("postgres_changes", { event: "*", schema: "public", table: "profile_members" }, () => {
      for (const p of state.profiles.filter(x => x.cloud)) syncRefreshMembers(p.id).catch(() => {});
    })
    .subscribe();
}

/* ---------- Compartir, invitar, unirse, salir ---------- */

// Convierte un perfil local en compartido: lo crea en el servidor y sube todo
async function syncShareProfile(p) {
  await syncSession();
  const created = await rpc("create_profile", { p_name: p.name, p_color: p.color, p_display_name: myName() || "Yo" });
  const oldId = p.id;
  const newId = created.id;
  p.id = newId;
  p.cloud = true;
  for (const m of state.meds) if (m.profileId === oldId) m.profileId = newId;
  if (state.currentProfile === oldId) state.currentProfile = newId;
  save();

  const sb = sbClient();
  const meds = state.meds.filter(m => m.profileId === newId);
  if (meds.length) {
    const { error } = await sb.from("medications").upsert(meds.map(medToRow));
    if (error) throw error;
  }
  const medIds = new Set(meds.map(m => m.id));
  const logs = Object.entries(state.log).filter(([k]) => medIds.has(k.split("|")[0]))
    .map(([k, e]) => ({ profile_id: newId, dose_key: k, med_id: k.split("|")[0], status: e.status, taken_at: new Date(e.at).toISOString() }));
  for (let i = 0; i < logs.length; i += 500) {
    const { error } = await sb.from("dose_logs").upsert(logs.slice(i, i + 500));
    if (error) throw error;
  }
  for (const m of meds) for (const pid of m.rx?.photoIds || []) queue({ t: "photo", id: pid, profileId: newId });
  await syncRefreshMembers(newId);
  syncSubscribe();
  renderAll();
  return p;
}

async function syncCreateInvite(profileId) {
  await syncSession();
  return rpc("create_invite", { p_profile: profileId });
}

async function syncJoin(code) {
  await syncSession();
  const pid = await rpc("join_profile", { p_code: code, p_display_name: myName() || "Familiar" });
  let p = profileById(pid);
  if (!p) {
    p = { id: pid, name: "…", color: COLORS[0], cloud: true, alarms: true };
    state.profiles.push(p);
  }
  delete state.sync.cursors[pid];
  await syncPull(pid);
  save();
  syncSubscribe();
  scheduleFutureNotifications();
  return p;
}

async function syncLeave(profileId) {
  await syncSession();
  // Si eres la última persona, el perfil se borra: antes se borran sus fotos de recetas
  await syncRefreshMembers(profileId).catch(() => {});
  if ((state.members[profileId] || []).length <= 1) {
    const bucket = sbClient().storage.from("recetas");
    const { data } = await bucket.list(profileId, { limit: 1000 });
    if (data?.length) await bucket.remove(data.map(f => `${profileId}/${f.name}`));
  }
  await rpc("leave_profile", { p_profile: profileId });
}

async function syncRemoveMember(profileId, userId) {
  await syncSession();
  await rpc("remove_member", { p_profile: profileId, p_user: userId });
  await syncRefreshMembers(profileId);
}

// Cambio de nombre propio: se actualiza en todos los perfiles compartidos
async function syncMyName() {
  if (!hasShared() || !myName()) return;
  try {
    await syncSession();
    await sbClient().from("profile_members").update({ display_name: myName() }).eq("user_id", syncUserId());
  } catch { /* se reintenta en otro momento */ }
}

/* ---------- Eliminar la cuenta del servidor (Ajustes → Borrar todos mis datos) ---------- */

async function syncDeleteAccount() {
  const sb = sbClient();
  if (!sb) return;
  const { data } = await sb.auth.getSession();
  if (!data?.session) return; // nunca se conectó al servidor: no hay cuenta que borrar
  if (!navigator.onLine) throw new Error("Necesitas internet para borrar tu cuenta del servidor.");
  sbUser = data.session.user;
  // Fotos de recetas de los perfiles que solo usaba esta persona (el servidor borra el resto)
  for (const p of state.profiles.filter(x => x.cloud)) {
    await syncRefreshMembers(p.id).catch(() => {});
    if ((state.members[p.id] || []).length <= 1) {
      const bucket = sb.storage.from("recetas");
      const { data: files } = await bucket.list(p.id, { limit: 1000 });
      if (files?.length) await bucket.remove(files.map(f => `${p.id}/${f.name}`));
    }
  }
  await rpc("delete_my_account", {});
  if (sbChannel) { sb.removeChannel(sbChannel); sbChannel = null; }
  await sb.auth.signOut({ scope: "local" }).catch(() => {});
  sbUser = null;
}

/* ---------- Antes de marcar una toma: ¿ya la dio alguien más? ---------- */

async function syncCheckDose(key) {
  const med = state.meds.find(m => m.id === key.split("|")[0]);
  if (!med || !isShared(profileOf(med)) || !navigator.onLine) return null;
  try {
    await syncSession();
    const q = sbClient().from("dose_logs").select("*").eq("profile_id", med.profileId).eq("dose_key", key).maybeSingle();
    const timeout = new Promise(res => setTimeout(() => res({ data: null }), 2500));
    const { data } = await Promise.race([q, timeout]);
    if (data?.status === "taken" && data.by_user !== syncUserId()) { applyLogRow(data); return data; }
  } catch { /* sin conexión: se sigue normalmente */ }
  return null;
}

/* ---------- Fotos de recetas que subió otra persona ---------- */

async function syncDownloadPhoto(photoId) {
  const med = state.meds.find(m => m.rx?.photoIds?.includes(photoId));
  if (!med || !isShared(profileOf(med))) return null;
  try {
    await syncSession();
    const { data, error } = await sbClient().storage.from("recetas").download(`${med.profileId}/${photoId}.jpg`);
    if (error || !data) return null;
    await rxPut({ id: photoId, blob: data, w: 0, h: 0, createdAt: Date.now() });
    state.sync.uploaded[photoId] = true;
    return data;
  } catch { return null; }
}

/* ---------- Inicio ---------- */

function syncInit() {
  window.addEventListener("online", () => syncAll());
  document.addEventListener("visibilitychange", () => { if (!document.hidden) syncAll(); });
  setInterval(() => { if (!document.hidden) syncAll(); }, 5 * 60000);
  syncAll();
}
