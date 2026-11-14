/* Service worker de MediHora: funciona sin conexión y maneja los toques en las notificaciones */
const CACHE = "medihora-v13";
const ASSETS = ["./", "index.html", "styles.css", "app.js", "reports.js", "pdf.js", "photos.js", "scan.js", "help.js", "ayuda/01-inicio.jpg", "ayuda/02-paso1.jpg", "ayuda/03-frecuencia.jpg", "ayuda/04-duracion.jpg", "ayuda/05-escaneo.jpg", "ayuda/06-hoy.jpg", "ayuda/07-deshacer.jpg", "ayuda/08-aviso.jpg", "ayuda/09-familia.jpg", "ayuda/10-doble-dosis.jpg", "ayuda/11-medicinas.jpg", "ayuda/12-reportes.jpg", "ayuda/13-ajustes.jpg", "native.js", "sync.js", "profiles.js", "vendor/supabase.js", "vendor/capacitor.js", "vendor/jspdf.umd.min.js", "manifest.webmanifest",
  "icons/icon.svg", "icons/icon-192.png", "icons/icon-512.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Red primero (para recibir actualizaciones), caché si no hay conexión
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});

self.addEventListener("notificationclick", e => {
  const key = e.notification.data?.key;
  const act = e.action || "open";
  e.notification.close();
  if (!key || key === "test" || key.startsWith("stock-")) {
    e.waitUntil(focusOrOpen("./"));
    return;
  }
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (all.length) {
      all[0].postMessage({ type: "dose-action", act, key });
      if (act === "open") return all[0].focus();
      return;
    }
    return self.clients.openWindow(`./?act=${encodeURIComponent(act)}&key=${encodeURIComponent(key)}`);
  })());
});

async function focusOrOpen(url) {
  const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  if (all.length) return all[0].focus();
  return self.clients.openWindow(url);
}
