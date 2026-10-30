// Prueba de punta a punta de la Fase 4 en modo demo, tamaño celular: la noche de ejemplo del diseño
// (gastos y retiros, anular una venta, contar la plata y cerrar), y abrir la caja siguiente.
// Necesita Playwright y un servidor sirviendo public/ en http://localhost:8765. Uso: node tests/e2e/cierre.e2e.cjs [carpeta-para-capturas]
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict");
const datos = require("./datos-demo.cjs");
const capturas = process.argv[2];

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await b.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  await ctx.route("**/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'export const CONFIG = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "", PRECIO_MENSUAL_TEXTO: "$ 20.000" };' }));
  await ctx.addInitScript((d) => {
    if (!sessionStorage.getItem("sembrado")) {
      localStorage.clear();
      localStorage.setItem("costos-demo-v1", JSON.stringify(d));
      localStorage.setItem("costos-demo-negocio", JSON.stringify({ nombre: "Venutto Fast Food", color: "#f27405" }));
      sessionStorage.setItem("sembrado", "1");
    }
  }, datos);
  const p = await ctx.newPage();
  const errores = [];
  p.on("pageerror", (e) => errores.push(String(e)));
  await p.goto("http://localhost:8765/");
  await p.click("#tab-caja");
  const estado = () => p.textContent("#caja-estado");
  const prod = (nombre) => p.locator("#view-caja .pbtn", { hasText: nombre });
  const cat = (nombre) => p.locator("#view-caja .chip-cat", { hasText: nombre }).click();
  const esperaTexto = (sel, re) => p.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s)?.textContent || ""), [sel, re.source]);
  const db = () => p.evaluate(() => JSON.parse(localStorage.getItem("caja-demo-v1")));
  const paso = async (nombre, sel) => { if (!capturas) return; if (sel) await p.locator(sel).scrollIntoViewIfNeeded(); await p.screenshot({ path: `${capturas}/${nombre}.png` }); };
  const filaRes = (k) => p.locator(".res-tabla tr").filter({ has: p.locator("td:first-child", { hasText: new RegExp("^" + k + "$") }) }).first().locator("td.r").textContent();
  const mov = async (tipo, medio, importe, desc) => {
    await p.locator(".mov-tipos .chip", { hasText: new RegExp("^" + tipo + "$") }).click();
    if (medio) await p.locator("#caja-movs .fila-chips .chip", { hasText: new RegExp("^" + medio + "$") }).click();
    await p.fill("#caja-mov-importe", String(importe));
    await p.fill("#caja-mov-desc", desc || "");
    await p.click("#caja-mov-ok");
  };

  // 20:00 abrir con $ 20.000.
  await p.waitForSelector("#caja-abrir:not([hidden])");
  assert.equal(await p.locator("#caja-movs").isHidden(), true, "sin caja no se cargan gastos");
  await p.fill("#caja-saldo", "20000");
  await p.click("#caja-btn-abrir");
  await p.waitForSelector("#caja-pos:not([hidden])");

  // Venta 1: lomito + pote en efectivo. Venta 2: promo con $ 1.000 de envío, $ 8.000 en efectivo y $ 20.000 por transferencia.
  await cat("Lomitos");
  await prod("Lomito completo").click();
  await p.locator("#view-caja .pbtn.op", { hasText: "Común" }).click();
  await cat("Extras");
  await prod("Pote de mayonesa").click();
  await p.click(".pago.efectivo");
  await esperaTexto(".caja-msg", /Venta 1 guardada/);
  await cat("Promos");
  await prod("Promo 3 lomitos").click();
  await p.locator("#view-caja .fila-chips .chip", { hasText: "Otro cargo" }).click();
  await p.fill("#caja-envio-otro", "1000");
  await p.click(".pago.dividir");
  await p.fill("#caja-div-ef", "8000");
  await p.click("#caja-div-ok");
  await esperaTexto(".caja-msg", /Venta 2 guardada/);

  // Compra de pan, retiro y reserva.
  await mov("Compra de mercadería", "Efectivo", 6000, "Pan");
  await esperaTexto("#caja-movs .caja-msg", /Guardado: compra de mercadería de \$ 6\.000/);
  await mov("Retiro", "Efectivo", 10000);
  await esperaTexto("#caja-movs .caja-msg", /retiro de \$ 10\.000/);
  await mov("Reserva", null, 15000, "Para reponer");
  await esperaTexto("#caja-movs .caja-msg", /reserva de \$ 15\.000/);
  await paso("1-gastos-y-retiros", "#caja-movs");

  // No deja sacar más efectivo del que hay, ni un gasto sin decir qué fue.
  await mov("Retiro", "Efectivo", 50000);
  await esperaTexto("#caja-movs .caja-msg.mal", /debería haber \$ 22\.500 en efectivo/);
  await mov("Gasto", "Efectivo", 100, "");
  await esperaTexto("#caja-movs .caja-msg.mal", /Escribí qué pagaste/);
  assert.equal((await db()).movimientos.length, 3);

  // Venta 3 cobrada en efectivo y anulada con motivo: queda tachada y no cuenta.
  await cat("Lomitos");
  await prod("Lomito simple").click();
  await p.click(".pago.efectivo");
  await esperaTexto(".caja-msg", /Venta 3 guardada/);
  await p.waitForTimeout(500); // justo después de cobrar, un toque en el mismo lugar se toma como doble toque y se ignora
  const v3 = p.locator("#caja-ventas .venta", { hasText: "Venta 3" });
  await v3.getByRole("button", { name: "Anular" }).click();
  await v3.getByRole("button", { name: "Anular venta 3" }).click();
  await esperaTexto("#caja-ventas .anular-form .caja-msg", /motivo/);
  await v3.locator(".anular-form input.motivo").fill("Se cargó dos veces");
  await v3.getByRole("button", { name: "Anular venta 3" }).click();
  await esperaTexto("#caja-ventas > .caja-msg", /Venta 3 anulada/);
  assert.match(await p.textContent("#caja-ventas"), /anulada: Se cargó dos veces/);
  assert.match(await estado(), /2 ventas · \$ 38\.500/);
  await paso("2-venta-anulada", "#caja-ventas");

  // El informe en vivo: efectivo esperado = 20.000 + 10.500 + 8.000 − 6.000 − 10.000 = 22.500.
  await esperaTexto("#caja-resumen", /Efectivo esperado/);
  assert.equal(await filaRes("= Efectivo esperado"), "$ 22.500");
  assert.equal(await filaRes("= Transferencias esperadas"), "$ 20.000");
  assert.match(await p.textContent("#caja-resumen"), /1 venta anulada en esta caja \(\$ 8\.000\): no cuenta en nada/);

  // Cierre: contaste $ 22.300 → faltan $ 200. Sin observación no deja cerrar.
  await p.click("#caja-btn-cerrar");
  assert.match(await p.textContent(".cierre-esperado"), /\$ 22\.500/);
  await p.fill("#caja-cierre-contado", "22300");
  assert.equal(await p.textContent("#caja-cierre-dif"), "Falta $ 200");
  await p.fill("#caja-cierre-banco", "20000");
  assert.equal(await p.textContent("#caja-cierre-dif-tr"), "Coincide");
  assert.equal(await p.inputValue("#caja-cierre-fondo"), "20000");
  assert.match(await p.textContent("#caja-cierre-disp"), /\$ 7\.300/);
  await paso("3-cierre", "#caja-cierre");
  await p.click("#caja-cierre-ok");
  await esperaTexto("#caja-cierre .caja-msg", /diferencia de − \$ 200 en efectivo/);
  assert.match(await estado(), /Caja 1 abierta/);
  await p.fill("#caja-cierre-obs", "Vuelto mal dado");
  await p.click("#caja-cierre-ok");
  await esperaTexto("#caja-estado", /Caja 1 cerrada/);

  // Informe del cierre: la foto del día.
  const kpi = (k) => p.locator(".res-kpi").filter({ has: p.locator(".k", { hasText: new RegExp("^" + k + "$") }) }).locator(".v").textContent();
  await p.waitForSelector("#caja-resumen:not([hidden]) .res-kpi");
  assert.match(await p.textContent("#caja-resumen summary"), /Informe del cierre · Caja 1/);
  assert.equal(await kpi("Diferencia de efectivo"), "− $ 200");
  assert.equal(await kpi("Disponible para retirar"), "$ 7.300");
  assert.equal(await filaRes("= Disponible estimado para retirar"), "$ 7.300");
  assert.match(await p.textContent("#caja-resumen"), /Observaciones: Vuelto mal dado/);
  assert.equal(await p.locator("#caja-pos").isHidden(), true);
  assert.equal(await p.locator("#caja-movs").isHidden(), true);
  assert.equal(await p.locator("#caja-cierre").isHidden(), true);
  assert.equal(await p.inputValue("#caja-saldo"), "20000", "propone el fondo que quedó");
  assert.equal(await p.textContent("#caja-btn-abrir"), "Abrir caja");
  assert.equal(await p.isDisabled("#caja-btn-abrir"), false);
  await paso("4-informe-cierre", "#caja-resumen");
  if (capturas) { await p.locator("#caja-estado").scrollIntoViewIfNeeded(); await paso("5-cerrada-arriba"); }

  // Al recargar sigue cerrada con su informe; se abre la Caja 2 con el fondo de ayer.
  await p.reload();
  await p.click("#tab-caja");
  await esperaTexto("#caja-estado", /Caja 1 cerrada/);
  await p.waitForSelector("#caja-resumen:not([hidden]) .res-kpi");
  assert.equal(await kpi("Disponible para retirar"), "$ 7.300");
  await p.click("#caja-btn-abrir");
  await esperaTexto("#caja-estado", /Caja 2 abierta/);
  const d = await db();
  assert.equal(d.cajas[0].estado, "cerrada");
  assert.equal(d.cajas[1].saldo_inicial, 20000);

  assert.deepEqual(errores, []);
  console.log("Prueba del cierre de caja: OK");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
