// Prueba de la pestaña Pedidos (asistente de WhatsApp) con un servidor de mentira: botones de estado,
// rechazar con motivo, charlas que necesitan al dueño, encender el asistente. Y que el modo demo la muestre sin errores.
// Uso: node tests/e2e/pedidos.e2e.cjs (con public/ servido en http://localhost:8765). CAPTURAS=carpeta guarda imágenes.
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict");
const path = require("node:path");

const PAGINA = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="styles.css"></head><body><div class="wrap">
<nav class="tabs"><button id="tab-pedidos" aria-selected="true">Pedidos</button></nav>
<section id="view-pedidos" class="ped-view"></section></div>
<script type="module">
import { iniciarPedidos } from "./pedidos.js";
const ahora = Date.now();
const pedidos = [
  { id: "p1", numero: 14, telefono: "5493855111111", nombre: "Marta", estado: "nuevo", entrega: "delivery", pago: "efectivo",
    renglones: [{ cantidad: 2, nombre: "Lomito completo", opcion_nombre: "Pan árabe", subtotal: 23600 }, { cantidad: 1, nombre: "Papas cheddar", subtotal: 6500 }],
    envio: 1000, total: 31100, ubicacion: { lat: -27.78, lng: -64.26 }, notas: "Sin cebolla", creado: new Date(ahora - 120000).toISOString() },
  { id: "p2", numero: 13, telefono: "5493855222222", nombre: null, estado: "en_preparacion", entrega: "retiro", pago: "transferencia",
    renglones: [{ cantidad: 1, nombre: "Hamburguesa doble", subtotal: 9000 }], envio: null, total: 9000, creado: new Date(ahora - 900000).toISOString() },
  { id: "p3", numero: 12, telefono: "5493855333333", nombre: "Rubén", estado: "entregado", entrega: "retiro", pago: "efectivo",
    renglones: [{ cantidad: 1, nombre: "Sándwich de milanesa", subtotal: 8000 }], envio: null, total: 8000, creado: new Date(ahora - 3600000).toISOString() },
];
const charlas = [{ telefono: "5493855444444", nombre: "Don Carlos", necesita_humano: "Quiere encargar 20 lomitos para un cumpleaños" }];
window.llamadas = [];
const ajustes = { whatsapp: { activo: false } };
const cambios = [];
const calc = { estado: { ajustes }, alCambiar: (fn) => cambios.push(fn),
  guardarAjuste: async (id, b) => { ajustes[id] = b; window.llamadas.push(["ajuste", id, b]); cambios.forEach((f) => f()); return true; } };
iniciarPedidos(calc, {
  pedidos: async () => pedidos.map((p) => ({ ...p })),
  charlas: async () => charlas.slice(),
  async cambiarEstado(id, estado, motivo) {
    window.llamadas.push(["estado", id, estado, motivo]);
    const p = pedidos.find((x) => x.id === id); p.estado = estado; if (motivo) p.motivo_rechazo = motivo;
    return { pedido: { ...p }, avisado: true };
  },
  async soltarCharla(tel) { window.llamadas.push(["soltar", tel]); charlas.splice(0); },
});
</script></body></html>`;

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await b.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 1100 } });
  await ctx.route("**/prueba-pedidos.html", (r) => r.fulfill({ contentType: "text/html", body: PAGINA }));
  const p = await ctx.newPage();
  const errores = [];
  p.on("pageerror", (e) => errores.push(String(e)));
  await p.goto("http://localhost:8765/prueba-pedidos.html");
  await p.waitForSelector(".ped-card.ped-nuevo");
  const capturas = process.env.CAPTURAS;
  if (capturas) await p.screenshot({ path: path.join(capturas, "pedidos-celular.png"), fullPage: true });

  // Pestaña con la cantidad de pedidos nuevos; terminados aparte.
  assert.equal(await p.textContent("#tab-pedidos"), "Pedidos (1)");
  const nuevo = p.locator(".ped-card.ped-nuevo");
  assert.match(await nuevo.textContent(), /#14/);
  assert.match(await nuevo.textContent(), /2 × Lomito completo \(Pan árabe\)\$ 23\.600/);
  assert.match(await nuevo.textContent(), /Total\$ 31\.100/);
  assert.match(await nuevo.textContent(), /Nota: Sin cebolla/);
  assert.equal(await nuevo.locator("a", { hasText: "Ver ubicación" }).getAttribute("href"), "https://www.google.com/maps?q=-27.78%2C-64.26");
  assert.match(await p.textContent("details.ped-card summary"), /Terminados hoy \(1\)/);
  assert.equal(await p.locator(".ped-en_preparacion button", { hasText: "Listo para retirar" }).count(), 1); // retiro, no "en camino"
  assert.equal(await p.locator(".ped-en_preparacion button", { hasText: "Rechazar" }).count(), 0);

  // Aceptar → En preparación → En camino.
  await nuevo.locator("button", { hasText: "Aceptar pedido" }).click();
  await p.waitForSelector(".ped-card.ped-aceptado");
  assert.match(await p.textContent(".caja-msg.ok"), /Pedido #14: Aceptado\. Le avisamos al cliente/);
  assert.equal(await p.textContent("#tab-pedidos"), "Pedidos");
  await p.locator(".ped-aceptado button", { hasText: "En preparación" }).click();
  await p.waitForSelector(".ped-card.ped-en_preparacion >> text=#14");
  await p.locator(".ped-card", { hasText: "#14" }).locator("button", { hasText: "En camino" }).click();
  await p.waitForSelector(".ped-card.ped-en_camino");

  // Rechazar pide el motivo; cancelar no hace nada.
  await p.locator(".ped-card", { hasText: "#13" }).locator("button", { hasText: "Listo para retirar" }).click();
  await p.waitForSelector(".ped-card.ped-en_camino >> text=#13");
  let llamadas = await p.evaluate(() => window.llamadas);
  assert.deepEqual(llamadas.map((l) => l.slice(1, 3)), [["p1", "aceptado"], ["p1", "en_preparacion"], ["p1", "en_camino"], ["p2", "en_camino"]]);

  // Charla que necesita al dueño: link a WhatsApp y botón para que siga el asistente.
  const ayuda = p.locator(".ped-ayuda");
  assert.match(await ayuda.textContent(), /Don Carlos.*20 lomitos/);
  assert.equal(await ayuda.locator("a").getAttribute("href"), "https://wa.me/5493855444444");
  await ayuda.locator("button").click();
  await p.waitForSelector(".ped-ayuda", { state: "detached" });

  // Encender el asistente.
  await p.locator("button", { hasText: "Asistente: apagado" }).click();
  await p.waitForSelector("button:has-text('Asistente: encendido')");
  llamadas = await p.evaluate(() => window.llamadas);
  assert.deepEqual(llamadas.slice(-2), [["soltar", "5493855444444"], ["ajuste", "whatsapp", { activo: true }]]);
  assert.deepEqual(errores, []);

  // Modo demo: la pestaña existe y explica que necesita cuenta.
  const ctx2 = await b.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  await ctx2.route("**/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'export const CONFIG = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "" };' }));
  const d = await ctx2.newPage();
  d.on("pageerror", (e) => errores.push(String(e)));
  await d.goto("http://localhost:8765/?tab=pedidos");
  await d.waitForSelector("#view-pedidos:not([hidden]) >> text=Necesita una cuenta");
  assert.deepEqual(errores, []);

  await b.close();
  console.log("Pedidos: OK");
})().catch((e) => { console.error(e); process.exit(1); });
