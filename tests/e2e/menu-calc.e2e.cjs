// Prueba de la parte del menú de pedidos dentro de la calculadora (modo demo):
// ficha > "En el menú de pedidos" y Mi negocio > "Menú de pedidos".
// Uso: node tests/e2e/menu-calc.e2e.cjs (con public/ servido en http://localhost:8765)
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const datos = require("./datos-demo.cjs");

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await b.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  await ctx.route("**/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'export const CONFIG = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "" };' }));
  await ctx.addInitScript((d) => { if (sessionStorage.getItem("sembrado")) return; sessionStorage.setItem("sembrado", "1"); localStorage.clear(); localStorage.setItem("costos-demo-v1", JSON.stringify(d)); localStorage.setItem("costos-tab", "productos"); }, datos);
  const p = await ctx.newPage();
  const errores = [];
  p.on("pageerror", (e) => errores.push(String(e)));
  await p.goto("http://localhost:8765/");
  const guardado = () => p.evaluate(() => JSON.parse(localStorage.getItem("costos-demo-v1")));

  // Ficha del Lomito completo: marcarlo para el menú con descripción, plural y foto.
  await p.locator(".pitem", { hasText: "Lomito completo" }).click();
  assert.equal(await p.getAttribute("#f-plural", "placeholder"), "Lomitos completos");
  assert.match(await p.textContent("#f-plural-ej"), /1 Lomito completo · 2 Lomitos completos/);
  await p.check("#f-enmenu");
  await p.fill("#f-desc", "Con lechuga, tomate, huevo, jamón y queso.");
  await p.locator("#f-desc").blur();
  await p.setInputFiles("#f-foto", path.join(__dirname, "foto-prueba.jpeg"));
  await p.waitForFunction(() => (JSON.parse(localStorage.getItem("costos-demo-v1")).productos.p1.foto || "").startsWith("data:image/jpeg"));
  let d = (await guardado()).productos.p1;
  assert.equal(d.enMenu, true); assert.equal(d.descripcion, "Con lechuga, tomate, huevo, jamón y queso.");
  assert.ok(await p.isVisible("#f-foto-img"));
  assert.match(await p.textContent(".pitem[aria-current=true]"), /en el menú/);

  // Pote de mayonesa: plural propio y agotado.
  await p.locator(".pitem", { hasText: "Pote de mayonesa" }).click();
  await p.check("#f-enmenu");
  await p.fill("#f-plural", "Potes de mayonesa casera");
  await p.locator("#f-plural").blur();
  await p.check("#f-agotado");
  d = (await guardado()).productos.p5;
  assert.equal(d.plural, "Potes de mayonesa casera"); assert.equal(d.agotado, true);
  // Hamburguesa sin precio: se marca pero el menú no la puede mostrar.
  await p.locator(".pitem", { hasText: "Hamburguesa completa" }).click();
  await p.check("#f-enmenu");
  // Las preparaciones no tienen sección de menú.
  await p.locator(".pitem", { hasText: "Mayonesa casera" }).click();
  assert.ok(await p.isHidden("#f-menu"));

  // Mi negocio > Menú de pedidos
  await p.click("#tab-negocio");
  assert.equal(await p.inputValue("#mn-slug"), "demo");
  await p.check("#mn-publicado");
  await p.click("#mn-form button[type=submit]");
  assert.match(await p.textContent("#mn-msg"), /falta .*WhatsApp.*medio de pago/);
  assert.ok(await p.isChecked("#mn-publicado"), "el aviso borró lo que se había marcado");
  await p.fill("#mn-slug", "Venutto Fast Food");
  await p.fill("#mn-wa", "+54 9 385 570-2807");
  await p.fill("#mn-alias", "javier.toledo.nx");
  for (const k of ["efectivo", "transferencia", "dividido"]) await p.check("#mn-pago-" + k);
  await p.fill("#mn-envio", "1000");
  for (const dia of [4, 5, 6, 0]) await p.check("#mn-dia-" + dia);
  await p.fill("#mn-desde", "21:00"); await p.fill("#mn-hasta", "01:00");
  await p.click("#mn-form button[type=submit]");
  assert.match(await p.textContent("#mn-msg"), /Guardado. El menú ya muestra/);
  const m = (await guardado()).ajustes.menu;
  assert.deepEqual(m, { publicado: true, slug: "venutto-fast-food", url: "", whatsapp: "+5493855702807", alias: "javier.toledo.nx",
    pagos: ["efectivo", "transferencia", "dividido"], envio: 1000, horarios: { dias: [4, 5, 6, 0], desde: "21:00", hasta: "01:00" }, aviso: "" });
  const lista = await p.$$eval(".mn-lista li", (li) => li.map((x) => x.textContent.replace(/\s+/g, " ").trim()));
  assert.equal(lista.length, 2, lista.join(" | "));
  assert.match(lista[0], /Lomito completo.*\$\s10\.000/);
  assert.match(lista[1], /Pote de mayonesa \(agotado\) · sin foto/);
  assert.match(await p.textContent("#menu-pedidos"), /no tienen precio de venta: Hamburguesa completa/);
  // En el modo demo no hay botón para leer la base.
  assert.equal(await p.locator("#mn-probar").count(), 0);
  // Se recarga y queda todo.
  await p.reload();
  await p.click("#tab-negocio");
  assert.equal(await p.inputValue("#mn-slug"), "venutto-fast-food");
  assert.ok(await p.isChecked("#mn-pago-dividido"));
  if (process.env.CAPTURA) await p.locator("#menu-pedidos").screenshot({ path: process.env.CAPTURA });

  assert.deepEqual(errores, []);
  console.log("Prueba del menú en la calculadora: OK");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
