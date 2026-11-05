/* MediHora — Reporte en PDF para imprimir o compartir con el médico */
"use strict";

const PDF_COLORS = {
  text: [28, 43, 51], muted: [107, 124, 134], line: [227, 233, 237], soft: [243, 246, 248],
  brand: [15, 157, 138], plan: [42, 120, 214], real: [235, 104, 52],
  ok: [21, 115, 71], late: [178, 106, 0], early: [28, 92, 171], miss: [180, 35, 24]
};
const pdfOpts = { days: 30, medIds: null, table: true, photos: true };

/* ---------- Carga de la librería (solo cuando se necesita) ---------- */

let jsPdfPromise = null;
function loadJsPdf() {
  if (window.jspdf) return Promise.resolve(window.jspdf.jsPDF);
  jsPdfPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "vendor/jspdf.umd.min.js";
    s.onload = () => resolve(window.jspdf.jsPDF);
    s.onerror = () => { jsPdfPromise = null; reject(new Error("No se pudo cargar el generador de PDF")); };
    document.head.appendChild(s);
  });
  return jsPdfPromise;
}

// Las fuentes estándar del PDF solo admiten caracteres latinos básicos
const pdfText = s => String(s ?? "")
  .replace(/[−–—]/g, "-").replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  .replace(/[^\x20-\x7E\xA0-\xFF]/g, "").replace(/\s+/g, " ").trim();

function pdfStatus(p) {
  if (p.status === "skipped") return { key: "miss", txt: "Omitida" };
  if (p.real === null) return { key: "miss", txt: "Sin registrar" };
  if (p.diff > ON_TIME_MIN) return { key: "late", txt: "Tarde" };
  if (p.diff < -ON_TIME_MIN) return { key: "early", txt: "Antes" };
  return { key: "ok", txt: "A tiempo" };
}

function summarize(points) {
  const taken = points.filter(p => p.real !== null);
  const onTime = taken.filter(p => Math.abs(p.diff) <= ON_TIME_MIN).length;
  const avg = taken.length ? taken.reduce((s, p) => s + p.diff, 0) / taken.length : null;
  return {
    total: points.length, taken: taken.length, onTime,
    missed: points.length - taken.length,
    pctTaken: points.length ? Math.round((taken.length / points.length) * 100) : null,
    pctOnTime: points.length ? Math.round((onTime / points.length) * 100) : null,
    avg
  };
}

/* ---------- Generación ---------- */

function rxDescription(med) {
  const rx = med.rx || {};
  const parts = [];
  if (rx.doctor) parts.push(`Recetado por ${rx.doctor}`);
  if (rx.date) parts.push(`${rx.doctor ? "el" : "Receta del"} ${parseYmd(rx.date).toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" })}`);
  return parts.join(" ");
}

async function buildReportPdf({ days, medIds, table, photos }) {
  const JsPDF = await loadJsPdf();
  const doc = new JsPDF({ unit: "mm", format: "a4" });
  const PW = 210, PH = 297, ML = 15, MR = 15, CW = PW - ML - MR, BOTTOM = PH - 18;
  let y = 15;

  const color = (c, what = "text") => {
    if (what === "text") doc.setTextColor(...c);
    else if (what === "draw") doc.setDrawColor(...c);
    else doc.setFillColor(...c);
  };
  const font = (size, style = "normal", c = PDF_COLORS.text) => { doc.setFont("helvetica", style); doc.setFontSize(size); color(c); };
  const text = (s, x, yy, o) => doc.text(pdfText(s), x, yy, o);
  const ensure = h => { if (y + h > BOTTOM) { doc.addPage(); y = 15; return true; } return false; };

  const today = startOfDay(new Date());
  const from = addDays(today, -(days - 1));
  const longDate = d => d.toLocaleDateString("es", { day: "numeric", month: "long", year: "numeric" });
  const meds = state.meds.filter(m => !medIds || medIds.includes(m.id)).sort((a, b) => a.name.localeCompare(b.name));

  // Datos por medicamento y horario
  const sections = [];
  for (const med of meds) for (const t of med.times) sections.push({ med, time: t, points: reportPoints(med, t, days) });
  const all = summarize(sections.flatMap(s => s.points));

  /* Encabezado */
  color(PDF_COLORS.brand, "fill");
  doc.rect(0, 0, PW, 4, "F");
  y = 16;
  font(17, "bold");
  text("Reporte de tomas de medicamentos", ML, y);
  y += 7;
  font(10, "normal", PDF_COLORS.muted);
  if (state.settings.name) { text(`Paciente: ${state.settings.name}`, ML, y); y += 5; }
  text(`Periodo: ${longDate(from)} al ${longDate(today)} (${days} días)`, ML, y); y += 5;
  text(`Generado: ${longDate(new Date())}, ${hhmm(new Date())} h`, ML, y); y += 7;

  /* Resumen general */
  const boxes = [
    ["Tomas programadas", all.total ? String(all.total) : "-"],
    ["Tomadas", all.total ? `${all.taken} (${all.pctTaken}%)` : "-"],
    [`A tiempo (±${ON_TIME_MIN} min)`, all.total ? `${all.pctOnTime}%` : "-"],
    ["Omitidas o sin registrar", all.total ? String(all.missed) : "-"]
  ];
  const bw = (CW - 3 * 4) / 4;
  boxes.forEach(([label, val], i) => {
    const bx = ML + i * (bw + 4);
    color(PDF_COLORS.soft, "fill");
    doc.roundedRect(bx, y, bw, 18, 2, 2, "F");
    font(14, "bold", PDF_COLORS.brand);
    text(val, bx + bw / 2, y + 8, { align: "center" });
    font(7.5, "normal", PDF_COLORS.muted);
    text(label, bx + bw / 2, y + 14, { align: "center" });
  });
  y += 24;

  font(8.5, "normal", PDF_COLORS.muted);
  doc.text(doc.splitTextToSize(pdfText(
    `En cada gráfica, la línea azul punteada es la hora programada y la línea naranja la hora real en que se registró la toma. ` +
    `Un punto por encima de la línea azul indica que se tomó más tarde; por debajo, antes. La X roja marca tomas omitidas o no registradas. ` +
    `Se considera "a tiempo" una diferencia de hasta ${ON_TIME_MIN} minutos.`), CW), ML, y);
  y += 13;

  if (!sections.length) {
    font(11, "normal", PDF_COLORS.muted);
    text("No hay medicamentos para este reporte.", ML, y);
  }

  /* Secciones */
  for (const sec of sections) {
    const { med, time, points } = sec;
    const s = summarize(points);
    ensure(37 + 62);
    // título
    color(PDF_COLORS.line, "draw");
    doc.setLineWidth(0.3);
    doc.line(ML, y, ML + CW, y);
    y += 7;
    font(13, "bold");
    text(`${med.name}${med.strength ? " " + med.strength : ""}`, ML, y);
    font(11, "bold", PDF_COLORS.brand);
    text(`Toma de las ${time}`, ML + CW, y, { align: "right" });
    y += 5;
    font(9, "normal", PDF_COLORS.muted);
    const details = [doseText(med), med.food, freqText(med), med.paused ? "En pausa" : "", med.notes].filter(Boolean).join(" · ");
    text(details, ML, y);
    y += 5;
    const rxLine = rxDescription(med);
    if (rxLine) { text(rxLine, ML, y); y += 5; }
    font(9.5, "normal");
    text(s.total
      ? `Tomadas: ${s.taken} de ${s.total} (${s.pctTaken}%)   ·   A tiempo: ${s.pctOnTime}%   ·   Desfase promedio: ${fmtDiff(s.avg)}   ·   Omitidas o sin registrar: ${s.missed}`
      : "Sin tomas programadas en este periodo.", ML, y);
    y += 9;

    if (points.length) {
      drawPdfChart(doc, points, ML, y, CW, 56);
      y += 62;
      if (table) y = drawPdfTable(doc, points, y, { ML, CW, BOTTOM });
    }
    y += 4;
  }

  /* Anexo: fotos de las recetas (una por página para que se lean bien) */
  if (photos) {
    for (const med of meds) {
      const ids = med.rx?.photoIds || [];
      for (let k = 0; k < ids.length; k++) {
        const ph = await rxPhotoForPdf(ids[k]).catch(() => null);
        if (!ph) continue;
        doc.addPage();
        y = 16;
        font(14, "bold");
        text(`Receta médica: ${med.name}${med.strength ? " " + med.strength : ""}`, ML, y);
        y += 6;
        font(9.5, "normal", PDF_COLORS.muted);
        const sub = [rxDescription(med), ids.length > 1 ? `Foto ${k + 1} de ${ids.length}` : ""].filter(Boolean).join(" · ");
        if (sub) { text(sub, ML, y); y += 5; }
        y += 2;
        const maxW = CW, maxH = BOTTOM - y;
        const sc = Math.min(maxW / ph.w, maxH / ph.h);
        const w = ph.w * sc, h = ph.h * sc;
        const x = ML + (CW - w) / 2;
        doc.addImage(ph.data, "JPEG", x, y, w, h, undefined, "FAST");
        color(PDF_COLORS.line, "draw");
        doc.setLineWidth(0.3);
        doc.rect(x, y, w, h);
      }
    }
  }

  /* Pie de página */
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i);
    font(8, "normal", PDF_COLORS.muted);
    text("Generado con MediHora. Este reporte no sustituye el criterio de tu médico o farmacéutico.", ML, PH - 9);
    text(`Página ${i} de ${n}`, PW - MR, PH - 9, { align: "right" });
  }

  return { doc, filename: `reporte-medicinas-${ymd(today)}.pdf` };
}

function drawPdfChart(doc, pts, X, Y, W, H) {
  const pl = 13, pr = 3, pt = 3, pb = 8;
  const ix = X + pl, iy = Y + pt, iw = W - pl - pr, ih = H - pt - pb;
  const vals = pts.flatMap(p => p.real === null ? [p.plan] : [p.plan, p.real]);
  let lo = Math.min(...vals) - 10, hi = Math.max(...vals) + 10;
  if (hi - lo < 120) { const mid = (hi + lo) / 2; lo = mid - 60; hi = mid + 60; }
  const span = hi - lo;
  const step = span <= 180 ? 30 : span <= 360 ? 60 : span <= 720 ? 120 : 240;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const n = pts.length;
  const fy = v => iy + ih - ((v - lo) / (hi - lo)) * ih;
  const fx = i => ix + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);

  // cuadrícula + eje Y
  doc.setFont("helvetica", "normal"); doc.setFontSize(7); doc.setTextColor(...PDF_COLORS.muted);
  doc.setDrawColor(...PDF_COLORS.line); doc.setLineWidth(0.2); doc.setLineDashPattern([], 0);
  for (let v = lo; v <= hi; v += step) {
    doc.line(ix, fy(v), ix + iw, fy(v));
    doc.text(fmtMin(v).slice(0, 5), ix - 2, fy(v) + 1, { align: "right" });
  }
  // eje X
  const every = Math.max(1, Math.ceil(n / 10));
  pts.forEach((p, i) => {
    const isLast = i === n - 1;
    if (!isLast && (i % every || n - 1 - i < every / 2)) return;
    doc.text(`${p.date.getDate()}/${p.date.getMonth() + 1}`, fx(i), Y + H - 2, { align: "center" });
  });

  // línea programada
  doc.setDrawColor(...PDF_COLORS.plan); doc.setLineWidth(0.6); doc.setLineDashPattern([1.6, 1.1], 0);
  for (let i = 1; i < n; i++) doc.line(fx(i - 1), fy(pts[i - 1].plan), fx(i), fy(pts[i].plan));
  if (n === 1) doc.line(ix, fy(pts[0].plan), ix + iw, fy(pts[0].plan));
  doc.setLineDashPattern([], 0);

  // línea real (se corta en tomas no registradas)
  doc.setDrawColor(...PDF_COLORS.real); doc.setLineWidth(0.6);
  for (let i = 1; i < n; i++) {
    if (pts[i - 1].real !== null && pts[i].real !== null) doc.line(fx(i - 1), fy(pts[i - 1].real), fx(i), fy(pts[i].real));
  }
  const r = n > 45 ? 0.6 : 0.9;
  pts.forEach((p, i) => {
    if (p.real !== null) {
      doc.setFillColor(255, 255, 255); doc.circle(fx(i), fy(p.real), r + 0.35, "F");
      doc.setFillColor(...PDF_COLORS.real); doc.circle(fx(i), fy(p.real), r, "F");
    } else {
      const c = 1.1, cx = fx(i), cy = fy(p.plan);
      doc.setDrawColor(...PDF_COLORS.miss); doc.setLineWidth(0.5);
      doc.line(cx - c, cy - c, cx + c, cy + c); doc.line(cx - c, cy + c, cx + c, cy - c);
    }
  });

  // leyenda
  const ly = Y - 3;
  doc.setFontSize(7.5); doc.setTextColor(...PDF_COLORS.muted);
  let lx = X + W - 78;
  doc.setDrawColor(...PDF_COLORS.plan); doc.setLineWidth(0.6); doc.setLineDashPattern([1.6, 1.1], 0);
  doc.line(lx, ly - 1, lx + 6, ly - 1); doc.setLineDashPattern([], 0);
  doc.text("Programada", lx + 7.5, ly); lx += 26;
  doc.setDrawColor(...PDF_COLORS.real); doc.line(lx, ly - 1, lx + 6, ly - 1);
  doc.text("Real", lx + 7.5, ly); lx += 16;
  doc.setDrawColor(...PDF_COLORS.miss); doc.setLineWidth(0.5);
  doc.line(lx + 1, ly - 2.1, lx + 3.2, ly + 0.1); doc.line(lx + 1, ly + 0.1, lx + 3.2, ly - 2.1);
  doc.text("No tomada", lx + 5, ly);
}

// Tabla en dos columnas para ahorrar papel
function drawPdfTable(doc, pts, y, { ML, CW, BOTTOM }) {
  const rowH = 5, gap = 8, colW = (CW - gap) / 2;
  const cols = [0, 22, 40, 62]; // Fecha, Real, Desfase, Estado
  const rows = [...pts];
  const header = (x, yy) => {
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5); doc.setTextColor(...PDF_COLORS.muted);
    ["Fecha", "Real", "Desfase", "Estado"].forEach((h, i) => doc.text(h, x + cols[i], yy));
    doc.setDrawColor(...PDF_COLORS.line); doc.setLineWidth(0.2);
    doc.line(x, yy + 1.5, x + colW, yy + 1.5);
  };
  const row = (p, x, yy) => {
    const st = pdfStatus(p);
    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(...PDF_COLORS.text);
    const wd = p.date.toLocaleDateString("es", { weekday: "short" }).replace(".", "");
    doc.text(pdfText(`${wd} ${p.date.getDate()}/${p.date.getMonth() + 1}`), x + cols[0], yy);
    doc.text(p.real === null ? "-" : pdfText(fmtMin(p.real)), x + cols[1], yy);
    doc.text(pdfText(fmtDiff(p.diff)), x + cols[2], yy);
    doc.setFillColor(...PDF_COLORS[st.key]); doc.circle(x + cols[3] + 1, yy - 1, 0.9, "F");
    doc.setTextColor(...PDF_COLORS[st.key]); doc.setFont("helvetica", "bold");
    doc.text(st.txt, x + cols[3] + 3, yy);
  };

  let i = 0;
  while (i < rows.length) {
    if (y + rowH * 3 > BOTTOM) { doc.addPage(); y = 15; }
    const avail = Math.floor((BOTTOM - y - rowH) / rowH);
    const remaining = rows.length - i;
    const perCol = Math.min(Math.ceil(remaining / 2), avail);
    header(ML, y + 3.5);
    if (remaining > perCol) header(ML + colW + gap, y + 3.5);
    for (let c = 0; c < 2; c++) {
      for (let k = 0; k < perCol && i < rows.length; k++, i++) {
        row(rows[i], ML + c * (colW + gap), y + 3.5 + rowH * (k + 1));
      }
    }
    y += 3.5 + rowH * (perCol + 1);
  }
  return y;
}

/* ---------- Interfaz ---------- */

function openPdfSheet() {
  if (!state.meds.length) { toast("Agrega un medicamento primero"); return; }
  if (!pdfOpts.medIds) pdfOpts.medIds = state.meds.map(m => m.id);
  pdfOpts.medIds = pdfOpts.medIds.filter(id => state.meds.some(m => m.id === id));
  document.querySelectorAll("#pdf-range button").forEach(b => b.classList.toggle("active", Number(b.dataset.days) === pdfOpts.days));
  const list = document.getElementById("pdf-meds");
  list.innerHTML = "";
  [...state.meds].sort((a, b) => a.name.localeCompare(b.name)).forEach(m => {
    const lab = document.createElement("label");
    lab.className = "row-toggle";
    const sp = document.createElement("span");
    sp.textContent = m.name + (m.strength ? " " + m.strength : "");
    const cb = document.createElement("input");
    cb.type = "checkbox"; cb.value = m.id; cb.checked = pdfOpts.medIds.includes(m.id);
    lab.append(sp, cb);
    list.appendChild(lab);
  });
  document.getElementById("pdf-table").checked = pdfOpts.table;
  const anyRx = state.meds.some(m => m.rx?.photoIds?.length);
  document.getElementById("pdf-photos-row").classList.toggle("hidden", !anyRx);
  document.getElementById("pdf-photos").checked = pdfOpts.photos;
  document.getElementById("pdf-sheet").classList.remove("hidden");
}

function readPdfOpts() {
  pdfOpts.medIds = [...document.querySelectorAll("#pdf-meds input:checked")].map(i => i.value);
  pdfOpts.table = document.getElementById("pdf-table").checked;
  pdfOpts.photos = document.getElementById("pdf-photos").checked;
  if (!pdfOpts.medIds.length) { toast("Elige al menos un medicamento"); return false; }
  return true;
}

async function runPdf(mode) {
  if (!readPdfOpts()) return;
  const btns = document.querySelectorAll("#pdf-sheet .btn");
  btns.forEach(b => b.disabled = true);
  toast("Generando PDF…");
  try {
    const { doc, filename } = await buildReportPdf(pdfOpts);
    const blob = doc.output("blob");
    if (NATIVE) {
      await nativeShareBlob(blob, filename, "Reporte de medicinas");
      document.getElementById("pdf-sheet").classList.add("hidden");
      return;
    }
    if (mode === "share") {
      const file = new File([blob], filename, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        try { await navigator.share({ files: [file], title: "Reporte de medicinas" }); }
        catch (e) { if (e.name !== "AbortError") throw e; }
      } else {
        const url = URL.createObjectURL(blob);
        const w = window.open(url, "_blank");
        if (!w) location.href = url;
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }
    } else {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      toast("PDF descargado");
    }
    document.getElementById("pdf-sheet").classList.add("hidden");
  } catch (e) {
    console.error(e);
    toast("No se pudo crear el PDF: " + e.message);
  } finally {
    btns.forEach(b => b.disabled = false);
  }
}

document.getElementById("btn-pdf").onclick = openPdfSheet;
document.getElementById("pdf-range").onclick = e => {
  const b = e.target.closest("[data-days]");
  if (!b) return;
  pdfOpts.days = Number(b.dataset.days);
  document.querySelectorAll("#pdf-range button").forEach(x => x.classList.toggle("active", x === b));
};
document.getElementById("pdf-share").onclick = () => runPdf("share");
document.getElementById("pdf-download").onclick = () => runPdf("download");
document.getElementById("pdf-cancel").onclick = () => document.getElementById("pdf-sheet").classList.add("hidden");
document.getElementById("pdf-sheet").onclick = e => { if (e.target.id === "pdf-sheet") e.target.classList.add("hidden"); };
