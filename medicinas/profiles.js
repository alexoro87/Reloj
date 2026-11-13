/* MediHora — Perfiles por persona (Yo, Sofía, Abuela…) y ventanas de diálogo propias */
"use strict";

/* ================= Diálogos (reemplazan confirm/prompt del navegador) ================= */

let dialogResolve = null;

// ask({ title, text, ok, cancel, danger, input: { type, value, placeholder, min, max } })
// Devuelve true/false, o el valor escrito si hay campo de texto (null si se cancela).
function ask(opts) {
  const o = typeof opts === "string" ? { title: opts } : opts;
  const dlg = document.getElementById("dialog");
  document.getElementById("dlg-title").textContent = o.title || "";
  const txt = document.getElementById("dlg-text");
  txt.textContent = o.text || "";
  txt.classList.toggle("hidden", !o.text);
  const inp = document.getElementById("dlg-input");
  inp.classList.toggle("hidden", !o.input);
  if (o.input) {
    inp.type = o.input.type || "text";
    inp.value = o.input.value ?? "";
    inp.placeholder = o.input.placeholder || "";
    inp.min = o.input.min ?? ""; inp.max = o.input.max ?? "";
    inp.maxLength = o.input.maxLength || 60;
    inp.inputMode = o.input.inputMode || (o.input.type === "number" ? "decimal" : "text");
    inp.style.textTransform = o.input.upper ? "uppercase" : "";
  }
  const okBtn = document.getElementById("dlg-ok");
  okBtn.textContent = o.ok || "Aceptar";
  okBtn.className = "btn full " + (o.danger ? "danger-solid" : "");
  const cancelBtn = document.getElementById("dlg-cancel");
  cancelBtn.textContent = o.cancel || "Cancelar";
  cancelBtn.classList.toggle("hidden", o.cancel === false);
  dlg.classList.remove("hidden");
  if (o.input) setTimeout(() => { inp.focus(); inp.select?.(); }, 80);
  return new Promise(res => { dialogResolve = { res, input: !!o.input }; });
}

function closeDialog(ok) {
  const d = dialogResolve;
  dialogResolve = null;
  document.getElementById("dialog").classList.add("hidden");
  if (!d) return;
  if (!d.input) d.res(!!ok);
  else d.res(ok ? document.getElementById("dlg-input").value.trim() : null);
}

document.getElementById("dlg-ok").onclick = () => closeDialog(true);
document.getElementById("dlg-cancel").onclick = () => closeDialog(false);
document.getElementById("dialog").onclick = e => { if (e.target.id === "dialog") closeDialog(false); };
document.getElementById("dlg-input").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); closeDialog(true); } });

const askTime = (title, value) => ask({ title, ok: "Guardar", input: { type: "time", value } });

/* ================= Modelo de perfiles ================= */

const isShared = p => !!p?.cloud;
const profileById = id => state.profiles.find(p => p.id === id);
const profileOf = med => profileById(med.profileId) || state.profiles[0];
const multiProfile = () => state.profiles.length > 1;
const myName = () => (state.settings.name || "").trim();

// ¿Se ve esta medicina con el filtro actual (Todos / una persona)?
function medInView(med) {
  return state.currentProfile === "all" || med.profileId === state.currentProfile;
}
// ¿Este teléfono debe avisar de esta medicina?
function medAlarm(med) {
  return profileOf(med)?.alarms !== false;
}
// Prefijo con el nombre de la persona (solo si hay varias)
function whoPrefix(med) {
  return multiProfile() ? `${profileOf(med)?.name || ""} · ` : "";
}

// Datos antiguos (sin perfiles): todo pasa a un perfil "Yo"
function migrateProfiles() {
  if (!Array.isArray(state.profiles)) state.profiles = [];
  if (!state.profiles.length) {
    state.profiles.push({ id: "p-" + uid(), name: myName() || "Yo", color: COLORS[0], cloud: false, alarms: true });
  }
  const first = state.profiles[0].id;
  for (const m of state.meds) if (!m.profileId || !profileById(m.profileId)) m.profileId = first;
  if (state.currentProfile !== "all" && !profileById(state.currentProfile)) state.currentProfile = "all";
  state.members ||= {};
  state.sync ||= { cursors: {}, outbox: [], uploaded: {} };
}

function setCurrentProfile(id) {
  state.currentProfile = id;
  save();
  renderAll();
}

const initial = name => (name || "?").trim().charAt(0).toUpperCase() || "?";
function avatar(p, size = 26) {
  return `<span class="avatar" style="--pc:${p.color};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.48)}px">${esc(initial(p.name))}</span>`;
}

/* ================= Barra para elegir persona ================= */

function renderProfileBars() {
  const html = [];
  if (multiProfile()) {
    html.push(`<button class="pchip ${state.currentProfile === "all" ? "active" : ""}" data-pid="all">👥 Todos</button>`);
  }
  for (const p of state.profiles) {
    const active = state.currentProfile === p.id || (!multiProfile());
    html.push(`<button class="pchip ${active ? "active" : ""}" data-pid="${esc(p.id)}">${avatar(p, 22)} ${esc(p.name)}${isShared(p) ? ' <span class="shared-ico" title="Compartido">👨‍👩‍👧</span>' : ""}</button>`);
  }
  html.push(`<button class="pchip add" data-pid="+">+ Persona</button>`);
  document.querySelectorAll(".profile-bar").forEach(el => { el.innerHTML = html.join(""); });
}

document.querySelectorAll(".profile-bar").forEach(el => el.addEventListener("click", e => {
  const b = e.target.closest("[data-pid]");
  if (!b) return;
  const id = b.dataset.pid;
  if (id === "+") return addPersonFlow();
  // tocar la persona ya elegida abre su configuración
  if (id !== "all" && (state.currentProfile === id || !multiProfile())) return openProfileSheet(id);
  setCurrentProfile(id);
}));

/* ================= Agregar persona / unirse ================= */

async function addPersonFlow() {
  const sheet = document.getElementById("profile-sheet");
  const body = document.getElementById("profile-body");
  body.innerHTML = `
    <h3 class="ps-head">Agregar persona</h3>
    <p class="muted small">Lleva las medicinas de otra persona (un hijo, tu mamá…) o únete al perfil que alguien de tu familia ya comparte.</p>
    <div class="action-buttons">
      <button class="btn full" data-act="new">➕ Crear perfil nuevo</button>
      <button class="btn ghost full" data-act="join">🔑 Tengo un código de invitación</button>
      <button class="btn ghost full" data-act="close">Cancelar</button>
    </div>`;
  sheet.classList.remove("hidden");
  body.onclick = async e => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    sheet.classList.add("hidden");
    if (act === "new") createProfileFlow();
    if (act === "join") joinFlow();
  };
}

async function createProfileFlow() {
  const name = await ask({ title: "¿Para quién son las medicinas?", ok: "Crear", input: { placeholder: "Ej. Sofía", maxLength: 60 } });
  if (!name) return;
  const p = { id: "p-" + uid(), name, color: COLORS[state.profiles.length % COLORS.length], cloud: false, alarms: true };
  state.profiles.push(p);
  state.currentProfile = p.id;
  save();
  renderAll();
  toast(`Perfil de ${name} creado`);
}

async function ensureMyName() {
  if (myName()) return true;
  const n = await ask({ title: "¿Cómo te verán tus familiares?", text: "Aparecerá cuando registres una toma, por ejemplo «Tomada por Mamá».", ok: "Guardar", input: { placeholder: "Ej. Mamá", maxLength: 40 } });
  if (!n) return false;
  state.settings.name = n;
  save();
  loadSettingsUI();
  return true;
}

async function joinFlow() {
  const code = await ask({
    title: "Código de invitación",
    text: "Pídele el código a quien ya comparte el perfil (lo encuentra en el perfil → «Invitar a alguien»).",
    ok: "Unirme", input: { placeholder: "Ej. K7P2QX8M", maxLength: 12, upper: true }
  });
  if (!code) return;
  if (!(await ensureMyName())) return;
  try {
    toast("Uniéndote…");
    const p = await syncJoin(code);
    state.currentProfile = p.id;
    save();
    renderAll();
    toast(`Listo: ya ves las medicinas de ${p.name}`);
  } catch (e) {
    ask({ title: "No se pudo unir", text: friendlyError(e), ok: "Entendido", cancel: false });
  }
}

/* ================= Hoja de configuración de un perfil ================= */

let openProfileId = null;

function openProfileSheet(id) {
  const p = profileById(id);
  if (!p) return;
  openProfileId = id;
  renderProfileSheet();
  document.getElementById("profile-sheet").classList.remove("hidden");
  if (isShared(p)) syncRefreshMembers(p.id).then(() => { if (openProfileId === id) renderProfileSheet(); });
}

function renderProfileSheet() {
  const p = profileById(openProfileId);
  const body = document.getElementById("profile-body");
  if (!p) { document.getElementById("profile-sheet").classList.add("hidden"); return; }
  const members = state.members[p.id] || [];
  const me = members.find(m => m.user_id === syncUserId());
  const iAmOwner = me?.role === "owner";
  const nMeds = state.meds.filter(m => m.profileId === p.id).length;

  body.innerHTML = `
    <div class="ps-top">${avatar(p, 54)}<div><h3 class="ps-head">${esc(p.name)}</h3>
      <div class="muted small">${nMeds} ${nMeds === 1 ? "medicamento" : "medicamentos"}${isShared(p) ? " · compartido" : ""}</div></div></div>

    <label class="field"><span>Nombre</span><input id="pf-name" value="${esc(p.name)}" maxlength="60"></label>
    <div class="field"><span>Color</span><div class="colors" id="pf-colors">
      ${COLORS.map(c => `<button type="button" style="background:${c}" class="${c === p.color ? "active" : ""}" data-color="${c}" aria-label="Color"></button>`).join("")}
    </div></div>
    <label class="row-toggle"><span>Recibir sus recordatorios en este teléfono</span><input type="checkbox" id="pf-alarms" ${p.alarms !== false ? "checked" : ""}></label>

    <div class="card inner">
      <strong>👨‍👩‍👧 Familia</strong>
      ${!isShared(p) ? `
        <p class="muted small">Comparte este perfil para que otras personas vean y actualicen sus medicinas desde su teléfono. Todos verán quién dio cada toma.</p>
        <button class="btn full" data-act="share">Compartir con mi familia</button>
      ` : `
        <div class="members">
          ${members.length ? members.map(m => `
            <div class="member">
              <span>${esc(m.display_name)}${m.user_id === syncUserId() ? " <span class='muted'>(tú)</span>" : ""}</span>
              <span class="mrole">${m.role === "owner" ? "Administra" : ""}
                ${iAmOwner && m.user_id !== syncUserId() ? `<button class="link danger-link" data-remove="${esc(m.user_id)}">Quitar</button>` : ""}</span>
            </div>`).join("") : `<p class="muted small">Cargando miembros…</p>`}
        </div>
        <div id="pf-code"></div>
        <button class="btn full" data-act="invite">Invitar a alguien</button>
      `}
    </div>

    <div class="card inner">
      <strong>💬 Recordatorios por WhatsApp</strong>
      <div id="pf-wa"></div>
    </div>

    <div class="action-buttons">
      <button class="btn full" data-act="save">Guardar</button>
      ${isShared(p)
        ? `<button class="btn danger full" data-act="leave">Salir de este perfil</button>`
        : state.profiles.length > 1 ? `<button class="btn danger full" data-act="delete">Eliminar perfil</button>` : ""}
      <button class="btn ghost full" data-act="close">Cerrar</button>
    </div>`;

  waRender(p);

  body.onclick = async e => {
    const color = e.target.closest("[data-color]");
    if (color) {
      body.querySelectorAll("#pf-colors button").forEach(b => b.classList.toggle("active", b === color));
      return;
    }
    const rm = e.target.closest("[data-remove]");
    if (rm) return removeMemberFlow(p, rm.dataset.remove);
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (!act) return;
    if (act === "close") return document.getElementById("profile-sheet").classList.add("hidden");
    if (act === "save") return saveProfileSheet(p);
    if (act === "share") return shareFlow(p);
    if (act === "invite") return inviteFlow(p);
    if (act === "leave") return leaveFlow(p);
    if (act === "delete") return deleteProfileFlow(p);
  };
}

function saveProfileSheet(p) {
  const name = document.getElementById("pf-name").value.trim();
  if (!name) { toast("Escribe un nombre"); return; }
  const color = document.querySelector("#pf-colors button.active")?.dataset.color || p.color;
  const changed = name !== p.name || color !== p.color;
  p.name = name;
  p.color = color;
  p.alarms = document.getElementById("pf-alarms").checked;
  save();
  if (changed && isShared(p)) syncProfileMeta(p);
  document.getElementById("profile-sheet").classList.add("hidden");
  renderAll();
  scheduleFutureNotifications();
  toast("Perfil guardado");
}

async function shareFlow(p) {
  if (!(await ensureMyName())) return;
  try {
    toast("Preparando para compartir…");
    await syncShareProfile(p);
    openProfileId = p.id; // el id cambió al subirlo a la nube
    renderProfileSheet();
    await inviteFlow(p);
  } catch (e) {
    ask({ title: "No se pudo compartir", text: friendlyError(e), ok: "Entendido", cancel: false });
  }
}

async function inviteFlow(p) {
  const box = document.getElementById("pf-code");
  try {
    box.innerHTML = `<p class="muted small">Generando código…</p>`;
    const code = await syncCreateInvite(p.id);
    const pretty = code.slice(0, 4) + " " + code.slice(4);
    box.innerHTML = `
      <div class="invite">
        <div class="muted small">Código para unirse a <b>${esc(p.name)}</b></div>
        <div class="invite-code">${pretty}</div>
        <div class="muted small">Vence en 7 días. Quien lo use podrá ver y actualizar sus medicinas.</div>
        <div class="btn-row"><button class="btn ghost small" id="inv-copy">Copiar</button><button class="btn small" id="inv-share">Enviar</button></div>
      </div>`;
    const msg = `Te invito a ver las medicinas de ${p.name} en MediHora.\n\n1. Abre MediHora → «+ Persona» → «Tengo un código de invitación».\n2. Escribe este código: ${pretty}\n\n(El código vence en 7 días.)`;
    document.getElementById("inv-copy").onclick = async () => {
      try { await navigator.clipboard.writeText(code); toast("Código copiado"); } catch { toast(code); }
    };
    document.getElementById("inv-share").onclick = async () => {
      try {
        if (NATIVE) await SHARE.share({ title: "Invitación a MediHora", text: msg, dialogTitle: "Enviar invitación" });
        else if (navigator.share) await navigator.share({ title: "Invitación a MediHora", text: msg });
        else { await navigator.clipboard.writeText(msg); toast("Invitación copiada"); }
      } catch { /* cancelado */ }
    };
  } catch (e) {
    box.innerHTML = "";
    ask({ title: "No se pudo crear el código", text: friendlyError(e), ok: "Entendido", cancel: false });
  }
}

async function removeMemberFlow(p, userId) {
  const m = (state.members[p.id] || []).find(x => x.user_id === userId);
  if (!(await ask({ title: `¿Quitar a ${m?.display_name || "esta persona"}?`, text: "Ya no podrá ver ni actualizar las medicinas de este perfil.", ok: "Quitar", danger: true }))) return;
  try {
    await syncRemoveMember(p.id, userId);
    renderProfileSheet();
    toast("Miembro quitado");
  } catch (e) { toast(friendlyError(e)); }
}

async function leaveFlow(p) {
  const ok = await ask({
    title: `¿Salir del perfil de ${p.name}?`,
    text: "Dejarás de ver sus medicinas en este teléfono. Si eres la última persona, el perfil se borra de la nube.",
    ok: "Salir", danger: true
  });
  if (!ok) return;
  try {
    await syncLeave(p.id);
    removeProfileLocal(p.id);
    document.getElementById("profile-sheet").classList.add("hidden");
    toast("Saliste del perfil");
  } catch (e) { toast(friendlyError(e)); }
}

async function deleteProfileFlow(p) {
  const n = state.meds.filter(m => m.profileId === p.id).length;
  const ok = await ask({ title: `¿Eliminar el perfil de ${p.name}?`, text: n ? `Se borrarán sus ${n} medicamentos y su historial de este teléfono.` : "", ok: "Eliminar", danger: true });
  if (!ok) return;
  removeProfileLocal(p.id);
  document.getElementById("profile-sheet").classList.add("hidden");
  toast("Perfil eliminado");
}

function removeProfileLocal(id) {
  const ids = new Set(state.meds.filter(m => m.profileId === id).map(m => m.id));
  state.meds.filter(m => ids.has(m.id)).forEach(m => rxDeleteForMed(m));
  state.meds = state.meds.filter(m => !ids.has(m.id));
  for (const k of Object.keys(state.log)) if (ids.has(k.split("|")[0])) delete state.log[k];
  state.profiles = state.profiles.filter(p => p.id !== id);
  delete state.members[id];
  delete state.sync.cursors[id];
  state.sync.outbox = state.sync.outbox.filter(o => o.profileId !== id);
  migrateProfiles();
  if (state.currentProfile === id) state.currentProfile = "all";
  save();
  renderAll();
  scheduleFutureNotifications();
}

function friendlyError(e) {
  const m = String(e?.message || e || "");
  if (/anonymous/i.test(m) && /disabled/i.test(m)) return "El servidor todavía no permite conectarse. Falta activar «Allow anonymous sign-ins» en Supabase.";
  if (/Failed to fetch|NetworkError|network/i.test(m)) return "No hay conexión a internet. Inténtalo de nuevo cuando tengas señal.";
  return m || "Ocurrió un error. Inténtalo de nuevo.";
}

document.getElementById("profile-sheet").onclick = e => {
  if (e.target.id === "profile-sheet") e.target.classList.add("hidden");
};
