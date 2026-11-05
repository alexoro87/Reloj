/* MediHora — Fotos de la receta médica (guardadas en IndexedDB, solo en el dispositivo) */
"use strict";

const RX_DB = "medihora-photos";
const RX_STORE = "photos";
const RX_MAX_SIDE = 1600;   // px del lado más largo tras comprimir
const RX_QUALITY = 0.8;

/* ---------- IndexedDB ---------- */

let rxDbPromise = null;
function rxDb() {
  rxDbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(RX_DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(RX_STORE, { keyPath: "id" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { rxDbPromise = null; reject(req.error); };
  });
  return rxDbPromise;
}
async function rxTx(mode, fn) {
  const db = await rxDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(RX_STORE, mode);
    const store = tx.objectStore(RX_STORE);
    let result;
    Promise.resolve(fn(store)).then(r => { result = r; });
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Operación cancelada"));
  });
}
const rxReq = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

const rxPut = rec => rxTx("readwrite", s => { s.put(rec); });
const rxGet = id => rxTx("readonly", s => rxReq(s.get(id)));
const rxDelete = ids => rxTx("readwrite", s => { ids.forEach(id => s.delete(id)); });
const rxAll = () => rxTx("readonly", s => rxReq(s.getAll()));
const rxClear = () => rxTx("readwrite", s => { s.clear(); });

/* ---------- Imágenes ---------- */

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("No se pudo leer la imagen"));
    img.src = src;
  });
}

// Reduce la foto (las de cámara pesan varios MB) y la guarda como JPEG
async function compressImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url); // los navegadores actuales ya respetan la orientación EXIF
    const scale = Math.min(1, RX_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), h = Math.round(img.naturalHeight * scale);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise(r => c.toBlob(r, "image/jpeg", RX_QUALITY));
    if (!blob) throw new Error("No se pudo procesar la imagen");
    return { blob, w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

const blobToDataUrl = blob => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(r.result);
  r.onerror = () => rej(r.error);
  r.readAsDataURL(blob);
});
const dataUrlToBlob = async url => (await fetch(url)).blob();

/* ---------- Formulario del medicamento ---------- */

// Fotos mostradas en el formulario; las nuevas ya están en IndexedDB y se
// borran si el usuario cancela. Las quitadas solo se borran al guardar.
const rxForm = { ids: [], added: [], removed: [] };
const rxUrls = new Map(); // id -> objectURL para miniaturas

async function rxThumbUrl(id) {
  if (rxUrls.has(id)) return rxUrls.get(id);
  const rec = await rxGet(id);
  if (!rec) return null;
  const u = URL.createObjectURL(rec.blob);
  rxUrls.set(id, u);
  return u;
}

function rxOpenForm(med) {
  rxForm.ids = [...(med?.rx?.photoIds || [])];
  rxForm.added = [];
  rxForm.removed = [];
  const f = document.getElementById("med-form");
  f.rxDoctor.value = med?.rx?.doctor || "";
  f.rxDate.value = med?.rx?.date || "";
  rxRenderThumbs();
}

async function rxRenderThumbs() {
  const box = document.getElementById("rx-thumbs");
  box.innerHTML = "";
  for (const id of rxForm.ids) {
    const url = await rxThumbUrl(id);
    if (!url) continue;
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rx-thumb";
    b.dataset.id = id;
    b.setAttribute("aria-label", "Ver foto de la receta");
    const img = document.createElement("img");
    img.src = url; img.alt = "";
    b.appendChild(img);
    box.appendChild(b);
  }
  document.getElementById("rx-empty").classList.toggle("hidden", rxForm.ids.length > 0);
}

async function rxAddFiles(files) {
  const list = [...files].filter(f => f.type.startsWith("image/") || /\.(heic|heif|jpe?g|png|webp)$/i.test(f.name));
  if (!list.length) return;
  toast("Guardando foto…");
  for (const file of list) {
    try {
      const { blob, w, h } = await compressImage(file);
      const id = uid();
      await rxPut({ id, blob, w, h, createdAt: Date.now() });
      rxForm.ids.push(id);
      rxForm.added.push(id);
    } catch (e) {
      toast("No se pudo agregar la foto: " + e.message);
    }
  }
  rxRenderThumbs();
  toast(list.length > 1 ? "Fotos agregadas" : "Foto agregada");
  // Pide al navegador que no borre estos datos si le falta espacio
  navigator.storage?.persist?.().catch(() => {});
}

function rxRemoveFromForm(id) {
  rxForm.ids = rxForm.ids.filter(x => x !== id);
  if (rxForm.added.includes(id)) {
    rxForm.added = rxForm.added.filter(x => x !== id);
    rxDelete([id]).catch(() => {});
    rxForgetUrl(id);
  } else {
    rxForm.removed.push(id);
  }
  rxRenderThumbs();
}

function rxForgetUrl(id) {
  const u = rxUrls.get(id);
  if (u) { URL.revokeObjectURL(u); rxUrls.delete(id); }
}

// Datos que se guardan dentro del medicamento
function rxCollect() {
  const f = document.getElementById("med-form");
  return { photoIds: [...rxForm.ids], doctor: f.rxDoctor.value.trim(), date: f.rxDate.value || "" };
}

// Al guardar: borra definitivamente las fotos quitadas
function rxCommit() {
  if (rxForm.removed.length) {
    rxDelete(rxForm.removed).catch(() => {});
    rxForm.removed.forEach(rxForgetUrl);
  }
  rxForm.added = []; rxForm.removed = [];
}

// Al cancelar: borra las fotos nuevas que no se guardaron
function rxDiscard() {
  if (rxForm.added.length) {
    rxDelete(rxForm.added).catch(() => {});
    rxForm.added.forEach(rxForgetUrl);
  }
  rxForm.added = []; rxForm.removed = [];
}

function rxDeleteForMed(med) {
  const ids = med?.rx?.photoIds || [];
  if (ids.length) rxDelete(ids).catch(() => {});
  ids.forEach(rxForgetUrl);
}

/* ---------- Visor a pantalla completa ---------- */

let rxViewer = { ids: [], i: 0, editable: false, title: "" };

async function rxOpenViewer(ids, i, { editable = false, title = "" } = {}) {
  rxViewer = { ids, i, editable, title };
  document.getElementById("rx-viewer").classList.remove("hidden");
  await rxShowCurrent();
}

async function rxShowCurrent() {
  const { ids, i, editable, title } = rxViewer;
  const url = await rxThumbUrl(ids[i]);
  document.getElementById("rx-img").src = url || "";
  document.getElementById("rx-caption").textContent = `${title ? title + " · " : ""}Foto ${i + 1} de ${ids.length}`;
  document.getElementById("rx-prev").classList.toggle("hidden", ids.length < 2);
  document.getElementById("rx-next").classList.toggle("hidden", ids.length < 2);
  document.getElementById("rx-del").classList.toggle("hidden", !editable);
}

function rxCloseViewer() {
  document.getElementById("rx-viewer").classList.add("hidden");
  document.getElementById("rx-img").src = "";
}

async function rxShareCurrent() {
  const rec = await rxGet(rxViewer.ids[rxViewer.i]);
  if (!rec) return;
  const file = new File([rec.blob], `receta-${rxViewer.i + 1}.jpg`, { type: "image/jpeg" });
  if (NATIVE) {
    nativeShareBlob(rec.blob, file.name, "Receta médica").catch(e => toast("No se pudo compartir: " + e.message));
    return;
  }
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Receta médica" }); } catch { /* cancelado */ }
  } else {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(rec.blob);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }
}

/* ---------- Copia de seguridad ---------- */

async function rxExportAll() {
  const out = {};
  try {
    for (const rec of await rxAll()) {
      out[rec.id] = { data: await blobToDataUrl(rec.blob), w: rec.w, h: rec.h, createdAt: rec.createdAt };
    }
  } catch (e) { console.warn("No se pudieron exportar las fotos", e); }
  return out;
}

async function rxImportAll(photos) {
  await rxClear();
  for (const k of rxUrls.keys()) rxForgetUrl(k);
  for (const [id, p] of Object.entries(photos || {})) {
    await rxPut({ id, blob: await dataUrlToBlob(p.data), w: p.w, h: p.h, createdAt: p.createdAt || Date.now() });
  }
}

/* ---------- Para el PDF ---------- */

async function rxPhotoForPdf(id) {
  const rec = await rxGet(id);
  if (!rec) return null;
  return { data: await blobToDataUrl(rec.blob), w: rec.w, h: rec.h };
}

/* ---------- Eventos ---------- */

document.getElementById("rx-input").onchange = e => { rxAddFiles(e.target.files); e.target.value = ""; };
document.getElementById("rx-camera").onchange = e => { rxAddFiles(e.target.files); e.target.value = ""; };
document.getElementById("rx-thumbs").onclick = e => {
  const b = e.target.closest(".rx-thumb");
  if (!b) return;
  const name = document.getElementById("med-form").name.value.trim();
  rxOpenViewer(rxForm.ids, rxForm.ids.indexOf(b.dataset.id), { editable: true, title: name });
};
document.getElementById("rx-close").onclick = rxCloseViewer;
document.getElementById("rx-share").onclick = rxShareCurrent;
document.getElementById("rx-prev").onclick = () => { rxViewer.i = (rxViewer.i - 1 + rxViewer.ids.length) % rxViewer.ids.length; rxShowCurrent(); };
document.getElementById("rx-next").onclick = () => { rxViewer.i = (rxViewer.i + 1) % rxViewer.ids.length; rxShowCurrent(); };
document.getElementById("rx-del").onclick = () => {
  if (!confirm("¿Quitar esta foto de la receta?")) return;
  rxRemoveFromForm(rxViewer.ids[rxViewer.i]);
  rxCloseViewer();
};
document.addEventListener("keydown", e => {
  if (document.getElementById("rx-viewer").classList.contains("hidden")) return;
  if (e.key === "Escape") rxCloseViewer();
  if (e.key === "ArrowLeft") document.getElementById("rx-prev").click();
  if (e.key === "ArrowRight") document.getElementById("rx-next").click();
});
