/* MediHora — Reportes: hora programada vs. hora real de cada toma */
"use strict";

const ON_TIME_MIN = 30; // margen para considerar una toma "a tiempo"
const rep = { medId: null, time: null, days: 7 };
let repPoints = [];

const fmtMin = m => {
  const day = Math.floor(m / 1440);
  const x = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(x / 60))}:${pad(x % 60)}${day > 0 ? " (+1 día)" : day < 0 ? " (−1 día)" : ""}`;
};
const fmtDiff = d => {
  if (d === null) return "–";
  const a = Math.abs(Math.round(d));
  if (a === 0) return "0 min";
  const txt = a >= 60 ? `${Math.floor(a / 60)} h ${pad(a % 60)} min` : `${a} min`;
  return (d > 0 ? "+" : "−") + txt;
};
const fmtDay = d => d.toLocaleDateString("es", { weekday: "short", day: "numeric", month: "short" });

function statusOf(p) {
  if (p.status === "skipped") return { cls: "miss", txt: "✕ Omitida" };
  if (p.real === null) return { cls: "miss", txt: "✕ Sin registrar" };
  if (p.diff > ON_TIME_MIN) return { cls: "late", txt: "▲ Tarde" };
  if (p.diff < -ON_TIME_MIN) return { cls: "early", txt: "▼ Antes" };
  return { cls: "ok", txt: "✓ A tiempo" };
}

/* ---------- Datos ---------- */

function reportPoints(med, time, days) {
  const now = new Date();
  const today = startOfDay(now);
  const pts = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(today, -i);
    if (!isScheduledOnIgnoringPause(med, d)) continue;
    const ds = ymd(d);
    const key = doseKey(med.id, ds, time);
    const entry = state.log[key];
    const due = atTime(ds, time);
    if (!entry && due > now) continue; // todavía no toca
    if (!entry && !inWindow(med, due)) continue; // fuera del periodo del tratamiento
    const [h, m] = time.split(":").map(Number);
    const plan = h * 60 + m;
    let real = null, diff = null;
    if (entry?.status === "taken") {
      diff = (entry.at - due.getTime()) / 60000;
      real = plan + diff;
    }
    pts.push({ date: d, ds, plan, real, diff, status: entry?.status || null, key });
  }
  return pts;
}

// Para el historial no importa si el medicamento está pausado hoy
function isScheduledOnIgnoringPause(med, d) {
  return isScheduledOn({ ...med, paused: false }, d);
}

/* ---------- Filtros ---------- */

function syncReportFilters() {
  const meds = [...state.meds].sort((a, b) => a.name.localeCompare(b.name));
  const medSel = document.getElementById("rep-med");
  const timeSel = document.getElementById("rep-time");
  if (!meds.find(m => m.id === rep.medId)) rep.medId = meds[0]?.id || null;
  medSel.innerHTML = "";
  meds.forEach(m => {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = m.name + (m.strength ? " " + m.strength : "");
    medSel.appendChild(o);
  });
  medSel.value = rep.medId || "";

  const med = state.meds.find(m => m.id === rep.medId);
  const times = med ? med.times : [];
  if (!times.includes(rep.time)) rep.time = times[0] || null;
  timeSel.innerHTML = "";
  times.forEach(t => {
    const o = document.createElement("option");
    o.value = t;
    o.textContent = "Toma de las " + t;
    timeSel.appendChild(o);
  });
  timeSel.value = rep.time || "";
  timeSel.classList.toggle("hidden", times.length < 2);
  document.querySelectorAll("#rep-range button").forEach(b => b.classList.toggle("active", Number(b.dataset.days) === rep.days));
}

/* ---------- Render ---------- */

function renderReports() {
  syncReportFilters();
  const med = state.meds.find(m => m.id === rep.medId);
  document.getElementById("rep-empty").classList.toggle("hidden", !!med);
  document.getElementById("rep-body").classList.toggle("hidden", !med);
  if (!med) return;

  repPoints = reportPoints(med, rep.time, rep.days);
  const taken = repPoints.filter(p => p.real !== null);
  const onTime = taken.filter(p => Math.abs(p.diff) <= ON_TIME_MIN).length;
  document.getElementById("rep-ontime").textContent = repPoints.length ? Math.round((onTime / repPoints.length) * 100) + "%" : "–";
  const avg = taken.length ? taken.reduce((s, p) => s + p.diff, 0) / taken.length : null;
  document.getElementById("rep-avg").textContent = fmtDiff(avg);
  document.getElementById("rep-missed").textContent = repPoints.length ? String(repPoints.length - taken.length) : "–";

  document.getElementById("rep-table-title").textContent = `Detalle por día · programada a las ${rep.time}`;
  renderReportTable();
  drawChart();
}

function renderReportTable() {
  const tb = document.getElementById("rep-rows");
  tb.innerHTML = "";
  if (!repPoints.length) {
    const tr = tb.insertRow();
    const td = tr.insertCell();
    td.colSpan = 4; td.className = "muted"; td.textContent = "No hay tomas en este periodo.";
    return;
  }
  [...repPoints].reverse().forEach(p => {
    const st = statusOf(p);
    const tr = tb.insertRow();
    const dd = `${p.date.toLocaleDateString("es", { weekday: "short" }).replace(".", "")} ${p.date.getDate()}/${p.date.getMonth() + 1}`;
    [dd, p.real === null ? "–" : fmtMin(p.real), fmtDiff(p.diff)]
      .forEach(t => { tr.insertCell().textContent = t; });
    const b = document.createElement("span");
    b.className = "badge " + st.cls;
    b.textContent = st.txt;
    tr.insertCell().appendChild(b);
  });
}

const SVGNS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  parent?.appendChild(e);
  return e;
}

let chartGeom = null;

function drawChart() {
  const svg = document.getElementById("chart");
  const wrap = document.getElementById("chart-wrap");
  document.getElementById("tip").classList.add("hidden");
  svg.innerHTML = "";
  const W = Math.max(280, wrap.clientWidth || 320);
  const H = 240;
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("height", H);

  const pts = repPoints;
  if (!pts.length) {
    svgEl("text", { x: W / 2, y: H / 2, class: "axis", "text-anchor": "middle" }, svg).textContent = "Sin datos en este periodo";
    chartGeom = null;
    return;
  }

  const M = { l: 44, r: 78, t: 12, b: 28 };
  const iw = W - M.l - M.r, ih = H - M.t - M.b;

  // Escala Y en minutos del día (más tarde = más arriba)
  const vals = pts.flatMap(p => p.real === null ? [p.plan] : [p.plan, p.real]);
  let lo = Math.min(...vals) - 10, hi = Math.max(...vals) + 10;
  if (hi - lo < 120) { const mid = (hi + lo) / 2; lo = mid - 60; hi = mid + 60; }
  const span = hi - lo;
  const step = span <= 180 ? 30 : span <= 360 ? 60 : span <= 720 ? 120 : 240;
  lo = Math.floor(lo / step) * step;
  hi = Math.ceil(hi / step) * step;
  const y = v => M.t + ih - ((v - lo) / (hi - lo)) * ih;
  const n = pts.length;
  const x = i => M.l + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);

  // Cuadrícula y eje Y
  for (let v = lo; v <= hi; v += step) {
    svgEl("line", { x1: M.l, x2: M.l + iw, y1: y(v), y2: y(v), class: "grid" }, svg);
    svgEl("text", { x: M.l - 6, y: y(v) + 4, class: "axis", "text-anchor": "end" }, svg).textContent = fmtMin(v).slice(0, 5);
  }
  // Eje X: como máximo ~6 etiquetas
  const every = Math.max(1, Math.ceil(n / 6));
  pts.forEach((p, i) => {
    const isLast = i === n - 1;
    if (!isLast && (i % every || n - 1 - i < every / 2)) return; // deja espacio para la última
    svgEl("text", { x: x(i), y: H - 8, class: "axis", "text-anchor": "middle" }, svg)
      .textContent = `${p.date.getDate()}/${p.date.getMonth() + 1}`;
  });

  // Línea programada
  svgEl("path", { class: "plan", d: pts.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.plan)}`).join("") }, svg);

  // Línea real (se corta donde no hubo toma)
  let d = "", open = false;
  pts.forEach((p, i) => {
    if (p.real === null) { open = false; return; }
    d += `${open ? "L" : "M"}${x(i)},${y(p.real)}`;
    open = true;
  });
  if (d) svgEl("path", { class: "real", d }, svg);

  const cross = svgEl("line", { class: "cross", y1: M.t, y2: M.t + ih, x1: 0, x2: 0, visibility: "hidden" }, svg);

  // Marcas: punto si se tomó, ✕ sobre la hora programada si no
  const dots = pts.map((p, i) => {
    if (p.real === null) {
      svgEl("text", { x: x(i), y: y(p.plan), class: "miss" }, svg).textContent = "✕";
      return null;
    }
    return svgEl("circle", { cx: x(i), cy: y(p.real), r: 4, class: "dot" }, svg);
  });

  // Etiquetas directas al final de cada línea (evitando que se encimen)
  const last = pts[n - 1];
  const lastReal = [...pts].reverse().find(p => p.real !== null);
  let yPlan = y(last.plan), yReal = lastReal ? y(lastReal.real) : null;
  if (yReal !== null && Math.abs(yPlan - yReal) < 14) {
    const mid = (yPlan + yReal) / 2;
    if (yPlan <= yReal) { yPlan = mid - 7; yReal = mid + 7; } else { yPlan = mid + 7; yReal = mid - 7; }
  }
  svgEl("text", { x: M.l + iw + 8, y: yPlan + 4, class: "dlabel" }, svg).textContent = "Programada";
  if (yReal !== null) svgEl("text", { x: M.l + iw + 8, y: yReal + 4, class: "dlabel" }, svg).textContent = "Real";

  // Capa para hover / toque
  const hit = svgEl("rect", { x: M.l - 10, y: 0, width: iw + 20, height: H, fill: "transparent", tabindex: 0 }, svg);
  chartGeom = { x, n, M, iw, W, cross, dots, hit, svg };
  let active = -1;
  const show = i => {
    if (i === active) return;
    if (active >= 0) dots[active]?.classList.remove("on");
    active = i;
    dots[i]?.classList.add("on");
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i));
    cross.setAttribute("visibility", "visible");
    showTip(i, x(i), W);
  };
  const hide = () => {
    if (active >= 0) dots[active]?.classList.remove("on");
    active = -1;
    cross.setAttribute("visibility", "hidden");
    document.getElementById("tip").classList.add("hidden");
  };
  const fromEvent = ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (W / r.width);
    const i = n === 1 ? 0 : Math.round(((px - M.l) / iw) * (n - 1));
    return Math.max(0, Math.min(n - 1, i));
  };
  hit.addEventListener("pointermove", ev => show(fromEvent(ev)));
  hit.addEventListener("pointerdown", ev => show(fromEvent(ev)));
  hit.addEventListener("pointerleave", ev => { if (ev.pointerType === "mouse") hide(); });
  hit.addEventListener("focus", () => show(n - 1));
  hit.addEventListener("blur", hide);
  hit.addEventListener("keydown", ev => {
    if (ev.key === "ArrowLeft") { show(Math.max(0, (active < 0 ? n : active) - 1)); ev.preventDefault(); }
    if (ev.key === "ArrowRight") { show(Math.min(n - 1, active + 1)); ev.preventDefault(); }
    if (ev.key === "Escape") hide();
  });
}

function showTip(i, px, W) {
  const p = repPoints[i];
  const tip = document.getElementById("tip");
  const st = statusOf(p);
  tip.innerHTML = "";
  const date = document.createElement("div");
  date.className = "t-date";
  date.textContent = fmtDay(p.date);
  tip.appendChild(date);
  const row = (color, dashed, value, label) => {
    const r = document.createElement("div");
    r.className = "t-row";
    const k = document.createElement("i");
    k.className = "key";
    k.style.borderTop = `2px ${dashed ? "dashed" : "solid"} var(${color})`;
    const b = document.createElement("b"); b.textContent = value;
    const s = document.createElement("span"); s.textContent = label;
    r.append(k, b, s);
    tip.appendChild(r);
  };
  row("--plan", true, fmtMin(p.plan), "Programada");
  row("--real", false, p.real === null ? "—" : fmtMin(p.real), "Real");
  const foot = document.createElement("div");
  foot.style.marginTop = "6px";
  const badge = document.createElement("span");
  badge.className = "badge " + st.cls;
  badge.textContent = st.txt;
  foot.appendChild(badge);
  if (p.diff !== null) {
    const t = document.createElement("span");
    t.className = "muted";
    t.textContent = "  " + fmtDiff(p.diff);
    foot.appendChild(t);
  }
  tip.appendChild(foot);

  tip.classList.remove("hidden");
  const wrapW = document.getElementById("chart-wrap").clientWidth;
  const scale = wrapW / W;
  const tw = tip.offsetWidth;
  let left = px * scale + 12;
  if (left + tw > wrapW) left = px * scale - tw - 12;
  tip.style.left = Math.max(0, left) + "px";
}

/* ---------- CSV para compartir con el médico ---------- */

function exportReportCSV() {
  const rows = [["Medicamento", "Fecha", "Hora programada", "Hora real", "Diferencia (min)", "Estado"]];
  const today = startOfDay(new Date());
  const meds = [...state.meds].sort((a, b) => a.name.localeCompare(b.name));
  for (const med of meds) {
    for (const t of med.times) {
      for (const p of reportPoints(med, t, rep.days)) {
        rows.push([
          med.name + (med.strength ? " " + med.strength : ""),
          p.ds, t,
          p.real === null ? "" : fmtMin(p.real),
          p.diff === null ? "" : String(Math.round(p.diff)),
          statusOf(p).txt.replace(/^\S+\s/, "")
        ]);
      }
    }
  }
  const csv = "﻿" + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");
  if (NATIVE) {
    nativeShareBlob(new Blob([csv], { type: "text/csv" }), `medihora-reporte-${rep.days}d-${ymd(today)}.csv`, "Reporte de tomas")
      .catch(e => toast("No se pudo exportar: " + e.message));
    return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = `medihora-reporte-${rep.days}d-${ymd(today)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- Eventos ---------- */

document.getElementById("rep-med").onchange = e => { rep.medId = e.target.value; rep.time = null; renderReports(); };
document.getElementById("rep-time").onchange = e => { rep.time = e.target.value; renderReports(); };
document.getElementById("rep-range").onclick = e => {
  const d = e.target.closest("[data-days]");
  if (d) { rep.days = Number(d.dataset.days); renderReports(); }
};
document.getElementById("btn-csv").onclick = exportReportCSV;
let repResize = null;
window.addEventListener("resize", () => {
  clearTimeout(repResize);
  repResize = setTimeout(() => { if (currentView === "reports") drawChart(); }, 150);
});
