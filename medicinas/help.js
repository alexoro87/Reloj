/* MediHora — Ayuda dentro de la app: recorrido de bienvenida y guías con capturas reales. */
"use strict";

/* ---------- Recorrido de bienvenida (primera vez) ---------- */

const TOUR = [
  { img: "06-hoy", title: "Bienvenido a MediHora", text: "Aquí verás las tomas de cada día. Toca el círculo cuando tomes tu medicina y la app lleva el registro por ti." },
  { img: "03-frecuencia", title: "Agrega tus medicinas", text: "Con el botón + la app te pregunta qué medicina es, cada cuánto se toma y por cuántos días. Ella programa todas las tomas." },
  { img: "05-escaneo", title: "O escanea la receta", text: "Tómale foto a la receta y la app llena los datos. Revisa cada medicina antes de guardarla." },
  { img: "08-aviso", title: "Te avisamos con calma", text: "A la hora de cada toma suena una campanita suave. Si no la marcas, te vuelve a avisar cada 10 minutos." },
  { img: "09-familia", title: "Cuida a tu familia", text: "Agrega a otras personas y comparte su perfil con un código. Todos ven quién dio cada toma, y la app evita las dosis dobles." },
];

let tourStep = 0;

function openTour(start = 0) {
  tourStep = start;
  renderTour();
  document.getElementById("tour").classList.remove("hidden");
}

function closeTour() {
  document.getElementById("tour").classList.add("hidden");
  if (!state.settings.tourDone) { state.settings.tourDone = true; save(); }
}

function renderTour() {
  const s = TOUR[tourStep];
  const last = tourStep === TOUR.length - 1;
  document.getElementById("tour-card").innerHTML = `
    <div class="tour-shot"><img src="ayuda/${s.img}.jpg" alt=""></div>
    <div class="tour-dots" aria-hidden="true">${TOUR.map((_, i) => `<i class="${i === tourStep ? "on" : ""}"></i>`).join("")}</div>
    <h2 class="tour-title">${esc(s.title)}</h2>
    <p class="tour-text">${esc(s.text)}</p>
    <div class="tour-buttons">
      <button class="btn ghost" data-tour="${tourStep ? "back" : "skip"}">${tourStep ? "Atrás" : "Saltar"}</button>
      <button class="btn" data-tour="${last ? "done" : "next"}">${last ? "Empezar" : "Siguiente"}</button>
    </div>
    <p class="tour-step muted small">${tourStep + 1} de ${TOUR.length}</p>`;
}

document.getElementById("tour").onclick = e => {
  const act = e.target.closest("[data-tour]")?.dataset.tour;
  if (act === "next") { tourStep++; renderTour(); }
  else if (act === "back") { tourStep--; renderTour(); }
  else if (act === "skip" || act === "done") closeTour();
};

/* ---------- Guías (Ajustes → Ayuda) ---------- */

const GUIDES = [
  { group: "Agregar una medicina", items: [
    { img: "02-paso1", title: "Agregar una medicina", steps: [
      "Toca el botón <b>+</b> (abajo a la derecha) o <b>Agregar medicamento</b>.",
      "Escribe el nombre, la concentración (ej. 500 mg), la forma (pastilla, jarabe, gotas…) y cuánto se toma cada vez.",
      "Si llevas a varias personas, elige <b>¿Para quién?</b>." ] },
    { img: "03-frecuencia", title: "Cada cuánto y a qué hora", steps: [
      "Elige la frecuencia: cada 4, 6, 8 o 12 horas, 1 vez al día, cada 2 o 3 días, u <b>Horarios a mi medida</b>.",
      "Indica el día y la hora de la <b>primera toma</b>. La app calcula el resto de los horarios." ] },
    { img: "04-duracion", title: "Por cuántos días", steps: [
      "Elige los días del tratamiento o <b>Uso continuo</b>.",
      "Revisa el resumen: cuántas tomas se programan, la primera, la última y cuánto necesitas.",
      "En <b>Extras</b> puedes poner indicaciones (con comida, en ayunas), la foto de la receta y el inventario." ] },
    { img: "05-escaneo", title: "Escanear la receta", steps: [
      "Toca <b>📷 Escanear receta</b> y tómale foto a la receta con buena luz.",
      "Toca <b>Revisar y agregar</b> en cada medicina: el asistente se abre ya lleno.",
      "<b>Compara cada dato con tu receta</b> antes de guardar. Necesita internet." ] },
  ] },
  { group: "El día a día", items: [
    { img: "06-hoy", title: "La pantalla Hoy", steps: [
      "Arriba eliges a quién ver: <b>Todos</b>, tú o cada persona.",
      "Las tomas atrasadas salen en una tarjeta roja. Si hay varias a la misma hora, usa <b>Marcar todas</b>.",
      "Toca los días de la semana para ver otro día." ] },
    { img: "07-deshacer", title: "Registrar una toma", steps: [
      "Toca el <b>círculo</b> para marcarla como tomada. Si fue un error, toca <b>Deshacer</b>.",
      "Toca la tarjeta para <b>Omitir</b>, <b>Posponer</b> o registrar que la tomaste a otra hora." ] },
    { img: "08-aviso", title: "Los recordatorios", steps: [
      "A la hora de cada toma suena una campanita suave. Responde desde la notificación: <b>✓ Tomada</b> o <b>⏱ Posponer</b>.",
      "Si no la marcas, te vuelve a avisar cada 10 minutos, hasta 3 horas. Puedes cambiarlo en <b>Ajustes</b>." ] },
    { img: "10-doble-dosis", title: "Evitar dosis dobles", steps: [
      "Si alguien de tu familia ya dio la medicina, la app te avisa quién y a qué hora.",
      "Así nadie la vuelve a dar por error." ] },
  ] },
  { group: "Familia y seguimiento", items: [
    { img: "09-familia", title: "Compartir con tu familia", steps: [
      "Toca <b>+ Persona → Crear perfil nuevo</b> (por ejemplo, tu hija).",
      "Toca su nombre → <b>Compartir con mi familia</b> → <b>Invitar a alguien</b> y envía el código.",
      "La otra persona entra a <b>+ Persona → Tengo un código</b>. Todos ven los cambios al instante." ] },
    { img: "11-medicinas", title: "Tus medicinas", steps: [
      "En <b>Medicinas</b> ves los horarios y el avance (ej. «Día 3 de 7»).",
      "Con el inventario activado, te avisa cuando quedan pocas. Usa <b>+ Reponer</b> al comprar más.",
      "Toca una medicina para editarla, pausarla o eliminarla." ] },
    { img: "12-reportes", title: "Reportes para el médico", steps: [
      "En <b>Progreso → Horarios y reportes</b> ves la hora programada (azul) contra la real (naranja).",
      "Toca <b>PDF</b> para llevarle el reporte a tu médico o <b>CSV</b> para abrirlo en Excel." ] },
    { img: "13-ajustes", title: "Ajustes", steps: [
      "Escribe <b>tu nombre</b> para que tu familia sepa quién dio cada toma.",
      "Cambia cada cuánto se repite el aviso, activa <b>Letra grande</b> y haz una copia de seguridad con <b>Exportar</b>." ] },
  ] },
];

const FAQ = [
  ["¿Se borra algo al actualizar la app?", "No. La versión nueva se instala encima de la anterior. Aun así, antes de actualizar haz Ajustes → Exportar."],
  ["¿Funciona sin internet?", "Sí. Los recordatorios y el registro funcionan sin internet. Compartir con la familia y escanear recetas necesitan conexión; los cambios se envían al volver la señal."],
  ["¿Quién ve mis datos?", "Lo que no compartes se queda solo en tu teléfono. Un perfil compartido solo lo ven las personas que invitaste."],
  ["No me suenan los avisos", "Revisa que estén activas las notificaciones y «Alarmas y recordatorios» de MediHora, y quita el ahorro de batería para la app. Prueba con Ajustes → Probar."],
];

function openHelp() {
  const body = document.getElementById("help-body");
  if (!body.dataset.ready) {
    body.innerHTML = `
      <button class="help-tour" type="button" data-help="tour">
        <span class="help-tour-ico">▶</span>
        <span><b>Ver el recorrido de bienvenida</b><br><span class="muted small">5 pantallas con lo más importante</span></span>
      </button>
      ${GUIDES.map(g => `
        <h3 class="section-title">${esc(g.group)}</h3>
        ${g.items.map(it => `
          <details class="guide">
            <summary>${esc(it.title)}</summary>
            <div class="guide-body">
              <img src="ayuda/${it.img}.jpg" alt="" loading="lazy">
              <ol>${it.steps.map(s => `<li>${s}</li>`).join("")}</ol>
            </div>
          </details>`).join("")}`).join("")}
      <h3 class="section-title">Preguntas frecuentes</h3>
      ${FAQ.map(([q, a]) => `<details class="guide"><summary>${esc(q)}</summary><div class="guide-body faq"><p>${esc(a)}</p></div></details>`).join("")}
      <p class="muted small center" style="margin-top:18px">MediHora te ayuda a recordar y registrar tus tomas. No sustituye las indicaciones de tu médico o farmacéutico.</p>`;
    body.dataset.ready = "1";
  }
  document.getElementById("help").classList.remove("hidden");
}

function closeHelp() { document.getElementById("help").classList.add("hidden"); }

document.getElementById("help").onclick = e => {
  if (e.target.id === "help") return closeHelp();
  if (e.target.closest("[data-help=close]")) return closeHelp();
  if (e.target.closest("[data-help=tour]")) { closeHelp(); openTour(0); }
};
document.getElementById("btn-help").onclick = openHelp;

// Recorrido de bienvenida la primera vez que se abre la app (sin medicinas todavía)
if (!state.settings.tourDone && !state.meds.length) openTour(0);
