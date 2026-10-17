// Prueba de la Fase 5 en un Chromium con pantalla de celular y toques (como Chrome de Android), en modo demo:
// que la app sea instalable, que abra sin internet, que el carrito sobreviva a una recarga,
// que todo se maneje con toques y que lo tocable mida al menos 44 px.
// Necesita Playwright. Levanta su propio servidor de public/ en el puerto 8766, con config.js en modo demo:
// el service worker pide los archivos por su cuenta y esos pedidos no pasan por page.route().
// Uso: node tests/e2e/celular.e2e.cjs [carpeta-para-capturas]
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const datos = require("./datos-demo.cjs");
const capturas = process.argv[2];
const PUERTO = 8766;
const URL_APP = "http://localhost:" + PUERTO + "/";

const PUBLICO = path.join(__dirname, "../../public");
const TIPOS = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webmanifest": "application/manifest+json" };
const servidor = http.createServer((req, res) => {
  let ruta = decodeURIComponent(new URL(req.url, URL_APP).pathname);
  if (ruta === "/") ruta = "/index.html";
  if (ruta === "/config.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    return res.end('export const CONFIG = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "", PRECIO_MENSUAL_TEXTO: "$ 20.000" };');
  }
  const archivo = path.join(PUBLICO, path.normalize(ruta));
  if (!archivo.startsWith(PUBLICO) || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "content-type": TIPOS[path.extname(archivo)] || "application/octet-stream", "cache-control": "no-cache" });
  fs.createReadStream(archivo).pipe(res);
});

(async () => {
  await new Promise((ok) => servidor.listen(PUERTO, ok));
  // Perfil de navegador normal (no incógnito): Chrome no ofrece instalar apps en incógnito.
  const perfil = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "celular-"));
  const ctx = await chromium.launchPersistentContext(perfil, Object.assign(
    { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
    process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {}));
  await ctx.addInitScript((d) => {
    if (!sessionStorage.getItem("sembrado")) {
      localStorage.clear();
      localStorage.setItem("costos-demo-v1", JSON.stringify(d));
      localStorage.setItem("costos-tab", "productos"); // la última pestaña usada no era la caja
      sessionStorage.setItem("sembrado", "1");
    }
  }, datos);
  const p = ctx.pages()[0] || await ctx.newPage();
  const errores = [];
  p.on("pageerror", (e) => errores.push(String(e)));
  const paso = async (nombre) => { if (capturas) await p.screenshot({ path: `${capturas}/${nombre}.png` }); };

  // 1. Manifiesto e íconos.
  await p.goto(URL_APP + "?tab=caja");
  const m = await p.evaluate(async () => (await fetch(document.querySelector("link[rel=manifest]").href)).json());
  assert.equal(m.display, "standalone");
  assert.equal(m.start_url, "/?tab=caja");
  assert.ok(m.short_name.length <= 12, "el nombre corto entra debajo del ícono");
  for (const ic of m.icons) {
    const tam = await p.evaluate((src) => new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i.naturalWidth + "x" + i.naturalHeight); i.onerror = mal; i.src = src; }), ic.src);
    assert.equal(tam, ic.sizes, "tamaño real del ícono " + ic.src);
  }
  assert.ok(m.icons.some((i) => i.purpose === "maskable"));

  // 2. Service worker activo y app instalable según el propio Chrome.
  await p.evaluate(() => navigator.serviceWorker.ready);
  await p.reload();
  assert.equal(await p.evaluate(() => !!navigator.serviceWorker.controller), true, "el service worker controla la página");
  const cdp = await ctx.newCDPSession(p);
  const inst = await cdp.send("Page.getInstallabilityErrors");
  assert.deepEqual(inst.installabilityErrors, [], "Chrome no la considera instalable: " + JSON.stringify(inst.installabilityErrors));

  // 3. ?tab=caja abre en la caja aunque la última pestaña usada fuera Productos.
  await p.waitForSelector("#pantalla-app:not([hidden])");
  assert.equal(await p.getAttribute("#tab-caja", "aria-selected"), "true");

  // 4. Todo con toques: abrir la caja y armar una venta.
  await p.waitForSelector("#caja-abrir:not([hidden])");
  await p.fill("#caja-saldo", "5000");
  await p.tap("#caja-btn-abrir");
  await p.waitForSelector("#caja-pos:not([hidden])");
  await p.locator(".chip-cat", { hasText: "Lomitos" }).tap();
  await p.locator(".pbtn", { hasText: "Lomito simple" }).tap();
  await p.locator(".linea .qty[aria-label='Uno más']").tap();
  await p.locator(".chip-cat", { hasText: "Extras" }).tap();
  await p.locator(".pbtn", { hasText: "Pote de mayonesa" }).tap();
  assert.equal(await p.textContent("#caja-total-v"), "$ 16.500");

  // 5. Se recarga la app a mitad de la venta: el carrito sigue.
  await p.reload();
  await p.waitForSelector("#caja-pos:not([hidden]) .linea");
  assert.equal(await p.locator(".linea").count(), 2);
  assert.equal(await p.textContent("#caja-total-v"), "$ 16.500");
  await p.tap(".pago.efectivo");
  await p.waitForFunction(() => /Venta 1 guardada/.test(document.querySelector(".caja-msg")?.textContent || ""));
  await p.reload();
  await p.waitForSelector("#caja-pos:not([hidden])");
  assert.match(await p.textContent("#caja-carrito"), /Tocá un producto/, "después de cobrar, el carrito queda vacío también al recargar");

  // 6. Lo tocable mide al menos 44 × 44 px (vendiendo, con descuento y envío abiertos, con gastos y cierre a la vista).
  await p.locator(".chip-cat", { hasText: "Extras" }).tap();
  await p.locator(".pbtn", { hasText: "Pote de mayonesa" }).tap();
  await p.locator(".fila-chips .chip", { hasText: "Descuento" }).tap();
  await p.locator(".fila-chips .chip", { hasText: "Otro cargo" }).tap();
  await p.locator("#caja-ventas .venta").first().getByRole("button", { name: "Anular" }).tap();
  await p.tap("#caja-btn-cerrar");
  const chicos = await p.evaluate(() => [...document.querySelectorAll("#pantalla-app header button, #view-caja button, #view-caja input, #view-caja select, #view-caja summary, #view-caja textarea")]
    .filter((e) => e.offsetParent !== null && e.type !== "checkbox")
    .map((e) => { const r = e.getBoundingClientRect(); return { e: (e.id || e.className) + " " + (e.textContent || e.placeholder || "").trim().slice(0, 20), w: r.width, h: r.height }; })
    .filter((x) => x.w < 44 || x.h < 44));
  assert.deepEqual(chicos, [], "botones o campos de menos de 44 px");
  // La casilla de "ya está en gastos fijos" es chica, pero se toca toda la fila.
  assert.ok((await p.locator("#caja-movs label.check").boundingBox()).height >= 44);
  const anchoPagina = await p.evaluate(() => document.documentElement.scrollWidth);
  assert.ok(anchoPagina <= 390, "la página se desborda a lo ancho: " + anchoPagina);
  await p.locator(".anular-form .btn.ghost").tap();
  await p.locator("#caja-cierre .btn.ghost", { hasText: "Cancelar" }).tap();

  // 7. Pantalla siempre encendida (si este Chrome lo permite).
  if (await p.isVisible("#caja-pantalla")) {
    await p.tap("#caja-pantalla");
    await p.waitForFunction(() => document.querySelector("#caja-pantalla").getAttribute("aria-pressed") === "true");
    assert.equal(await p.evaluate(() => localStorage.getItem("caja-pantalla")), "1");
    await p.tap("#caja-pantalla");
  }
  await p.evaluate(() => window.scrollTo(0, 0));
  await paso("1-caja-celular");

  // 8. Sin internet: la app abre igual desde lo guardado y avisa arriba. Al volver internet, el aviso se va.
  await ctx.setOffline(true);
  await p.reload();
  await p.waitForSelector("#pantalla-app:not([hidden])");
  assert.equal(await p.isVisible("#sin-conexion"), true, "falta el aviso sin conexión");
  assert.match(await p.textContent("#sin-conexion"), /Sin internet/);
  assert.equal(await p.locator(".linea").count(), 1, "el carrito sigue sin internet");
  await paso("2-sin-internet");
  await ctx.setOffline(false);
  await p.waitForFunction(() => document.querySelector("#sin-conexion").hidden);

  assert.deepEqual(errores, []);
  console.log("Prueba del celular: OK");
  await ctx.close();
  fs.rmSync(perfil, { recursive: true, force: true });
  servidor.close();
})().catch((e) => { console.error(e); process.exit(1); });
