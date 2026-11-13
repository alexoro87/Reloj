/* MediHora — Escanear la receta: se toma una foto, la IA la lee en el servidor
   y cada medicina se abre en el asistente ya llenada para que la persona la revise. */
"use strict";

const scan = { results: null, blob: null, added: new Set(), current: null, active: false };

const PLAN_TEXT = { h4: "Cada 4 horas", h6: "Cada 6 horas", h8: "Cada 8 horas", h12: "Cada 12 horas", h24: "1 vez al día", d2: "Cada 2 días", d3: "Cada 3 días" };

function startScan() {
  const inp = document.getElementById("scan-input");
  inp.value = "";
  inp.click();
}

async function onScanFile(file) {
  if (!file) return;
  const loading = document.getElementById("scan-loading");
  loading.classList.remove("hidden");
  try {
    if (!navigator.onLine) throw new Error("Necesitas internet para leer la receta.");
    const { blob } = await compressImage(file);
    const image = (await blobToDataUrl(blob)).split(",")[1];
    await syncSession();
    const { data, error } = await sbClient().functions.invoke("leer-receta", { body: { image } });
    if (error) {
      let msg = "No se pudo leer la receta. Intenta de nuevo.";
      try { msg = (await error.context.json()).error || msg; } catch { /* sin detalle */ }
      throw new Error(msg);
    }
    scan.results = data;
    scan.blob = blob;
    scan.added = new Set();
    scan.active = true;
    renderScanSheet();
  } catch (e) {
    ask({ title: "No se pudo leer la receta", text: friendlyError(e), ok: "Entendido", cancel: false });
  } finally {
    loading.classList.add("hidden");
  }
}

function scanSummary(m) {
  const parts = [];
  if (m.dias_semana?.length && m.dias_semana.length < 7) parts.push([1, 2, 3, 4, 5, 6, 0].filter(x => m.dias_semana.includes(x)).map(x => DAY_NAME[x]).join(", ") + (m.horarios?.length ? " · " + m.horarios.join(", ") : ""));
  else if (m.plan && m.plan !== "custom") parts.push(PLAN_TEXT[m.plan]);
  else if (m.horarios?.length) parts.push("A las " + m.horarios.join(", "));
  else parts.push("Pauta especial");
  parts.push(m.dias ? `${m.dias} días` : "sin fecha de fin");
  if (m.cantidad) parts.push(doseText({ qty: m.cantidad, form: m.forma }));
  return parts.join(" · ");
}

function renderScanSheet() {
  const r = scan.results || {};
  const meds = r.medicamentos || [];
  const body = document.getElementById("scan-body");
  const allDone = meds.length && meds.every((_, i) => scan.added.has(i));
  body.innerHTML = `
    <h3 class="ps-head">${!r.legible || !meds.length ? "No encontré medicamentos" : `Encontré ${meds.length} ${meds.length === 1 ? "medicamento" : "medicamentos"}`}</h3>
    ${meds.length ? `<p class="muted small">Revisa cada uno con tu receta antes de guardarlo. La lectura automática puede equivocarse.</p>` : `<p class="muted small">La foto no parece una receta o no se lee bien. Intenta con buena luz, sin sombras y con la receta completa.</p>`}
    ${(r.avisos || []).length ? `<div class="scan-warn">⚠️ ${r.avisos.map(esc).join("<br>⚠️ ")}</div>` : ""}
    ${r.doctor || r.fecha ? `<p class="small muted">${r.doctor ? "Médico: <b>" + esc(r.doctor) + "</b>" : ""}${r.doctor && r.fecha ? " · " : ""}${r.fecha ? "Fecha: " + esc(r.fecha) : ""}</p>` : ""}
    <div class="scan-list">
      ${meds.map((m, i) => `
        <div class="scan-item ${scan.added.has(i) ? "done" : ""}">
          <div class="dose-main">
            <div class="dose-name">${esc(m.nombre)} <span class="muted small">${esc(m.concentracion || "")}</span></div>
            <div class="dose-sub">${esc(scanSummary(m))}</div>
            ${m.indicacion || m.notas ? `<div class="dose-sub">${esc([m.indicacion, m.notas].filter(Boolean).join(" · "))}</div>` : ""}
            ${!m.seguro ? `<div class="scan-doubt">⚠️ Algún dato no se leyó con claridad</div>` : ""}
          </div>
          ${scan.added.has(i) ? `<span class="scan-ok">✓ Agregado</span>` : `<button class="btn small" data-scan-add="${i}">Revisar y agregar</button>`}
        </div>`).join("")}
    </div>
    <div class="action-buttons">
      ${!meds.length ? `<button class="btn full" data-scan="retry">📷 Tomar otra foto</button>` : ""}
      <button class="btn ${allDone ? "" : "ghost"} full" data-scan="close">${allDone ? "Listo" : "Cerrar"}</button>
    </div>`;
  document.getElementById("scan-sheet").classList.remove("hidden");
}

// Abre el asistente con los datos leídos de la receta
function openScanItem(i) {
  const m = scan.results.medicamentos[i];
  scan.current = i;
  document.getElementById("scan-sheet").classList.add("hidden");
  openMedForm(null);
  const f = document.getElementById("med-form");
  f.name.value = m.nombre || "";
  f.strength.value = m.concentracion || "";
  if (m.forma) f.form.value = m.forma;
  f.qty.value = m.cantidad > 0 ? m.cantidad : 1;
  f.food.value = m.indicacion || "";
  f.notes.value = m.notas || "";
  // Frecuencia
  const weekdays = (m.dias_semana || []).filter(x => x >= 0 && x <= 6);
  if (m.plan && m.plan !== "custom" && !weekdays.length) formPlan = m.plan;
  else {
    formPlan = "custom";
    formFreq = weekdays.length && weekdays.length < 7 ? "weekdays" : "daily";
    if (formFreq === "weekdays") formDays = weekdays;
    renderFreq();
    renderDays();
    renderTimes(m.horarios?.length ? m.horarios : ["08:00"]);
  }
  // Duración
  const d = Number(m.dias) || 0;
  if (!d) formDur = "0";
  else if ([3, 5, 7, 10, 14, 30].includes(d)) formDur = String(d);
  else { formDur = "other"; f.durDays.value = d; }
  renderPlan();
  renderDur();
  // Receta: médico, fecha y la foto
  f.rxDoctor.value = scan.results.doctor || "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(scan.results.fecha || "")) f.rxDate.value = scan.results.fecha;
  if (scan.blob) {
    const id = uid();
    rxPut({ id, blob: scan.blob, w: 0, h: 0, createdAt: Date.now() }).then(() => {
      rxForm.ids.push(id);
      rxForm.added.push(id);
      rxRenderThumbs();
    });
  }
  document.getElementById("scan-banner").classList.remove("hidden");
  // Si algún dato es dudoso, empezar por la frecuencia para revisarla
  goStep(0);
}

// Llamadas desde el formulario
function scanAfterSave() {
  if (scan.current === null) return;
  scan.added.add(scan.current);
  scan.current = null;
  setTimeout(renderScanSheet, 250);
}
function scanAfterCancel() {
  if (scan.current === null) return;
  scan.current = null;
  setTimeout(renderScanSheet, 250);
}

document.getElementById("scan-input").onchange = e => onScanFile(e.target.files[0]);
document.getElementById("scan-sheet").onclick = e => {
  const add = e.target.closest("[data-scan-add]");
  if (add) return openScanItem(Number(add.dataset.scanAdd));
  const act = e.target.closest("[data-scan]")?.dataset.scan;
  if (act === "retry") { document.getElementById("scan-sheet").classList.add("hidden"); startScan(); }
  if (act === "close" || e.target.id === "scan-sheet") {
    document.getElementById("scan-sheet").classList.add("hidden");
    scan.active = false;
  }
};
document.querySelectorAll("[data-start-scan]").forEach(b => b.onclick = () => {
  if (!document.getElementById("sheet").classList.contains("hidden")) closeSheet();
  startScan();
});
