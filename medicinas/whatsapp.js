/* MediHora — Recordatorios por WhatsApp (sección en la ficha de cada persona).
   El servidor envía los avisos; aquí se activan números y se ven/quitan. */
"use strict";

// Número de WhatsApp de MediHora (solo dígitos, con código de país). Se llena al configurar Meta.
const WA_NUMBER = "";
// En pausa: Meta exige verificar la empresa para usar WhatsApp Business. Cambiar a true para mostrarlo.
const WA_ENABLED = false;

const waFmt = n => "+" + String(n || "").replace(/\D/g, "");

async function waLinks(profileId) {
  await syncSession();
  const { data, error } = await sbClient().from("whatsapp_links")
    .select("id, phone, active, activated_at").eq("profile_id", profileId).eq("active", true).order("activated_at");
  if (error) throw error;
  return data || [];
}

async function waRender(p) {
  const box = document.getElementById("pf-wa");
  if (!box) return;
  if (!isShared(p)) {
    box.innerHTML = `
      <p class="muted small">Recibe un mensaje de WhatsApp a la hora de cada toma, con botones «✓ Ya la tomé» y «⏱ En 10 min». Ideal para quien no usa la app (por ejemplo, la abuela).</p>
      <button class="btn ghost full" data-wa="add">💬 Activar WhatsApp</button>`;
  } else {
    box.innerHTML = `<p class="muted small">Cargando…</p>`;
    let links = [];
    try { links = await waLinks(p.id); } catch { /* sin conexión */ }
    if (openProfileId !== p.id) return;
    box.innerHTML = `
      ${links.length ? `<div class="members">${links.map(l => `
        <div class="member"><span>📱 ${esc(waFmt(l.phone))}</span>
          <button class="link danger-link" data-wa-del="${l.id}">Quitar</button></div>`).join("")}</div>`
        : `<p class="muted small">Recibe un mensaje de WhatsApp a la hora de cada toma, con botones «✓ Ya la tomé» y «⏱ En 10 min».</p>`}
      <div id="wa-code"></div>
      <button class="btn ghost full" data-wa="add">💬 ${links.length ? "Agregar otro WhatsApp" : "Activar WhatsApp"}</button>`;
  }
  box.onclick = async e => {
    e.stopPropagation();
    const del = e.target.closest("[data-wa-del]");
    if (del) return waRemove(p, Number(del.dataset.waDel));
    if (e.target.closest("[data-wa=add]")) return waAdd(p);
    if (e.target.closest("[data-wa=copy]")) {
      const txt = e.target.closest("[data-wa=copy]").dataset.txt;
      try { await navigator.clipboard.writeText(txt); toast("Copiado"); } catch { toast(txt); }
    }
  };
}

let waPoll = null;

async function waAdd(p) {
  try {
    if (!isShared(p)) {
      const ok = await ask({
        title: "Activar WhatsApp",
        text: "Los avisos por WhatsApp los envía el servidor de MediHora, así que las medicinas de este perfil se guardarán también en la nube (solo las verán las personas que tú invites).",
        ok: "Continuar"
      });
      if (!ok || !(await ensureMyName())) return;
      toast("Preparando…");
      await syncShareProfile(p);
      openProfileId = p.id;
      renderProfileSheet();
    }
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/Mexico_City";
    await syncSession();
    const { data: code, error } = await sbClient().rpc("whatsapp_request", { p_profile: p.id, p_tz: tz });
    if (error) throw new Error(error.message);
    const msg = `ACTIVAR ${code}`;
    const box = document.getElementById("wa-code");
    box.innerHTML = `
      <div class="invite">
        <div class="muted small">Desde el WhatsApp que recibirá los avisos, manda este mensaje${WA_NUMBER ? ` al <b>${esc(waFmt(WA_NUMBER))}</b>` : ""}:</div>
        <div class="invite-code">${esc(msg)}</div>
        ${WA_NUMBER ? "" : `<div class="muted small">⚠️ El número de WhatsApp de MediHora aún no está configurado.</div>`}
        <div class="muted small">El código vence en 2 días. Puede ser el teléfono de otra persona (por ejemplo, la abuela).</div>
        <div class="btn-row">
          <button class="btn ghost small" data-wa="copy" data-txt="${esc(msg)}">Copiar</button>
          ${WA_NUMBER ? `<a class="btn small" href="https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(msg)}" target="_blank" rel="noopener">Abrir WhatsApp</a>` : ""}
        </div>
        <div class="muted small" id="wa-wait">Esperando el mensaje…</div>
      </div>`;
    // Revisar cada 4 s si ya se activó (hasta 3 minutos)
    const before = (await waLinks(p.id).catch(() => [])).length;
    clearInterval(waPoll);
    let n = 0;
    waPoll = setInterval(async () => {
      if (++n > 45 || openProfileId !== p.id || document.getElementById("profile-sheet").classList.contains("hidden")) { clearInterval(waPoll); return; }
      const now = await waLinks(p.id).catch(() => null);
      if (now && now.length > before) {
        clearInterval(waPoll);
        toast("✅ WhatsApp activado");
        waRender(p);
      }
    }, 4000);
  } catch (e) {
    ask({ title: "No se pudo activar WhatsApp", text: friendlyError(e), ok: "Entendido", cancel: false });
  }
}

async function waRemove(p, id) {
  if (!(await ask({ title: "¿Quitar este WhatsApp?", text: "Dejará de recibir los recordatorios de este perfil.", ok: "Quitar", danger: true }))) return;
  try {
    await syncSession();
    const { error } = await sbClient().from("whatsapp_links").delete().eq("id", id);
    if (error) throw new Error(error.message);
    toast("WhatsApp quitado");
    waRender(p);
  } catch (e) { toast(friendlyError(e)); }
}
