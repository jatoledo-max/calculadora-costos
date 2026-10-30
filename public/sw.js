// Service worker: permite instalar la app y abrirla aunque no haya internet.
// Regla: los archivos de la app se piden SIEMPRE primero a internet (así cada cambio llega enseguida) y,
// si no hay conexión o tarda demasiado, se usa la última copia guardada. Los datos (Supabase, Mercado Pago)
// nunca se guardan acá: una venta sin internet no se guarda en ningún lado y la pantalla lo avisa.
const CACHE = "ganancias-app-v10";
const APP = [
  "./", "index.html", "styles.css", "app.js", "calculadora.js", "caja.js", "informe.js", "informes.js", "copia.js", "menu.js", "plural.js", "fotos.js", "asistente.js", "costos.js", "dinero.js", "stores.js", "config.js", "legal.js", "tickets.js", "tickets-datos.js", "terminos.html", "privacidad.html", "arrepentimiento.html",
  "manifest.webmanifest", "iconos/icono-192.png", "iconos/favicon-32.png",
];
// Librerías y fuentes de afuera con versión fija: no cambian, se guardan la primera vez que se usan.
const EXTERNOS = ["cdn.jsdelivr.net", "fonts.googleapis.com", "fonts.gstatic.com"];
const ESPERA_MS = 4000;

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(APP)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys()
    .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (url.pathname.startsWith("/.netlify/")) return; // funciones (pagos): siempre a internet
    e.respondWith(primeroInternet(req));
  } else if (EXTERNOS.includes(url.hostname)) {
    e.respondWith(primeroGuardado(req));
  }
  // Todo lo demás (Supabase) va directo a internet, sin pasar por acá.
});

async function primeroInternet(req) {
  const cache = await caches.open(CACHE);
  const red = fetch(req).then((res) => {
    if (res.ok) cache.put(req, res.clone());
    return res;
  });
  const guardado = () => cache.match(req, { ignoreSearch: true })
    .then((r) => r || (req.mode === "navigate" ? cache.match("index.html") : undefined));
  // Si internet tarda más de 4 segundos y hay copia guardada, se usa la copia (la de internet igual actualiza la copia).
  const lento = new Promise((ok) => setTimeout(() => guardado().then((r) => r && ok(r)), ESPERA_MS));
  red.catch(() => {}); // si gana la copia y después falla internet, no es un error
  try {
    return await Promise.race([red, lento]);
  } catch (err) {
    const r = await guardado();
    if (r) return r;
    throw err;
  }
}

async function primeroGuardado(req) {
  const cache = await caches.open(CACHE);
  const r = await cache.match(req);
  if (r) return r;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") cache.put(req, res.clone());
  return res;
}
