// Prueba de punta a punta de la Fase 6 en modo demo, tamaño celular: tres cajas en dos meses, filtros por fecha,
// suma del período, detalle de un cierre, anular una venta de un día anterior, pagos pendientes y planillas.
// Necesita Playwright y un servidor sirviendo public/ en http://localhost:8765. Uso: node tests/e2e/informes.e2e.cjs [carpeta-para-capturas]
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const datos = require("./datos-demo.cjs");
const capturas = process.argv[2];

(async () => {
  const { fechaAR, rangoRapido } = await import(path.join(__dirname, "../../public/informes.js"));
  const hoy = fechaAR(new Date());
  const pasado = rangoRapido("pasado", hoy);

  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await b.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true,
    locale: "es-AR", timezoneId: "America/Argentina/Buenos_Aires" });
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
  const prod = (nombre) => p.locator("#view-caja .pbtn", { hasText: nombre });
  const cat = (nombre) => p.locator("#view-caja .chip-cat", { hasText: nombre }).click();
  const esperaTexto = (sel, re) => p.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s)?.textContent || ""), [sel, re.source]);
  const paso = async (nombre, sel) => { if (!capturas) return; if (sel) await p.locator(sel).scrollIntoViewIfNeeded(); await p.screenshot({ path: `${capturas}/${nombre}.png` }); };
  const kpi = (box, k) => p.locator(box + " .res-kpi").filter({ has: p.locator(".k", { hasText: new RegExp("^" + k + "$") }) }).first();
  const filaRes = (box, k) => p.locator(box + " .res-tabla tr").filter({ has: p.locator("td:first-child", { hasText: new RegExp("^" + k + "$") }) }).first().locator("td.r").textContent();
  const vender = async (categoria, nombre, pago) => {
    await cat(categoria);
    await prod(nombre).click();
    await p.click(".pago." + pago);
    await esperaTexto(".caja-msg", /guardada/);
    await p.waitForTimeout(500); // después de cobrar, un toque en el mismo lugar se ignora (doble toque)
  };
  const cerrar = async (contado, obs) => {
    await p.click("#caja-btn-cerrar");
    await p.fill("#caja-cierre-contado", String(contado));
    if (obs) await p.fill("#caja-cierre-obs", obs);
    await p.click("#caja-cierre-ok");
    await esperaTexto("#caja-estado", /cerrada/);
  };
  const filas = () => p.locator("#inf-cajas .inf-fila .n").allTextContents();
  const esperarLista = (n) => p.waitForFunction((n) => document.querySelectorAll("#inf-cajas .inf-fila").length === n && !/Cargando/.test(document.querySelector("#inf-resumen").textContent), n);

  // Caja 1 (el mes pasado): un lomito simple en efectivo; contás justo.
  await p.waitForSelector("#caja-abrir:not([hidden])");
  await p.fill("#caja-saldo", "20000");
  await p.click("#caja-btn-abrir");
  await p.waitForSelector("#caja-pos:not([hidden])");
  await vender("Lomitos", "Lomito simple", "efectivo");
  await cerrar(28000);
  // Se pasa la Caja 1 al primer día del mes pasado, como si se hubiera abierto ese día.
  await p.evaluate((f) => {
    const db = JSON.parse(localStorage.getItem("caja-demo-v1"));
    db.cajas[0].fecha_operacion = f; db.cajas[0].resumen.fecha_operacion = f;
    localStorage.setItem("caja-demo-v1", JSON.stringify(db));
  }, pasado.desde);
  await p.reload();
  await p.click("#tab-caja");

  // Caja 2 (hoy): un pote en efectivo y un lomito por transferencia; faltan $ 100.
  await p.click("#caja-btn-abrir");
  await esperaTexto("#caja-estado", /Caja 2 abierta/);
  await vender("Extras", "Pote de mayonesa", "efectivo");
  await vender("Lomitos", "Lomito simple", "transferencia");
  await cerrar(20400, "Faltó cambio");
  // Caja 3 queda abierta.
  await p.click("#caja-btn-abrir");
  await esperaTexto("#caja-estado", /Caja 3 abierta/);

  // Informes, "Este mes" (lo que se ve al entrar): Caja 3 abierta y Caja 2 cerrada; la suma es solo la Caja 2.
  await p.click("#tab-informes");
  await esperarLista(2);
  assert.equal(await p.getAttribute('#inf-periodo .chip[aria-pressed="true"]', "aria-pressed"), "true");
  assert.equal(await p.textContent('#inf-periodo .chip[aria-pressed="true"]'), "Este mes");
  assert.deepEqual(await filas(), ["Caja 3", "Caja 2"]);
  assert.match(await p.textContent("#inf-resumen"), /La caja abierta no entra en la suma/);
  assert.equal(await kpi("#inf-resumen", "Ventas netas").locator(".v").textContent(), "$ 8.500");
  assert.match(await kpi("#inf-resumen", "Ventas netas").locator(".note").textContent(), /^2 ventas en 1 caja$/);
  assert.equal(await kpi("#inf-resumen", "Diferencias de caja").locator(".v").textContent(), "− $ 100");
  assert.equal(await filaRes("#inf-resumen", "Faltó en las cajas"), "$ 100");
  assert.match(await p.textContent("#inf-cajas"), /faltó \$ 100/);
  await paso("1-informes-este-mes", "#inf-periodo");

  // "Mes pasado": solo la Caja 1.
  await p.locator("#inf-periodo .chip", { hasText: "Mes pasado" }).click();
  await esperarLista(1);
  assert.deepEqual(await filas(), ["Caja 1"]);
  assert.equal(await p.inputValue("#inf-desde"), pasado.desde);
  assert.equal(await p.inputValue("#inf-hasta"), pasado.hasta);
  assert.equal(await kpi("#inf-resumen", "Ventas netas").locator(".v").textContent(), "$ 8.000");
  assert.equal(await kpi("#inf-resumen", "Diferencias de caja").locator(".note").textContent(), "todas coincidieron");

  // Fechas a mano: desde el mes pasado hasta hoy, las tres cajas; se suman las dos cerradas.
  await p.fill("#inf-hasta", hoy);
  await esperarLista(3);
  assert.equal(await p.locator('#inf-periodo .chip[aria-pressed="true"]').count(), 0, "con fechas a mano no queda marcado ningún atajo");
  assert.deepEqual(await filas(), ["Caja 3", "Caja 2", "Caja 1"]);
  assert.equal(await kpi("#inf-resumen", "Ventas netas").locator(".v").textContent(), "$ 16.500");
  assert.match(await kpi("#inf-resumen", "Ventas netas").locator(".note").textContent(), /^3 ventas en 2 cajas$/);
  // Gráficos del período: ventas por día (los dos días con caja), a dónde fue la plata, productos y medios de pago.
  assert.match(await p.textContent("#inf-resumen .graf"), /Ventas por día/);
  assert.match(await p.textContent("#inf-resumen"), new RegExp("Mejor día: " + Number(hoy.slice(8)) + "/" + Number(hoy.slice(5, 7)) + " con \\$ 8\\.500"));
  assert.ok(await p.locator("#inf-resumen .gd-col").count() >= 2);
  assert.match(await p.textContent("#inf-resumen"), /Qué se vendió más.*Lomito simple: 97% de lo vendido \(2 unidades\)/);
  assert.match(await p.textContent("#inf-resumen"), /Cómo te pagaron.*Transferencia 48%/);
  assert.equal(await p.locator("#inf-resumen details.cuentas").getAttribute("open"), null, "las cuentas completas arrancan cerradas");
  if (capturas) await p.locator("#inf-resumen").screenshot({ path: `${capturas}/1b-graficos.png` });
  // Desde posterior a hasta: avisa y no muestra nada.
  await p.fill("#inf-desde", "2099-01-01");
  await esperaTexto("#inf-resumen", /posterior/);
  await p.fill("#inf-desde", pasado.desde);
  await esperarLista(3);

  // Detalle de la Caja 1: la foto de su cierre y sus ventas. Se anula su venta desde acá (la Caja 3 está abierta).
  await p.locator("#inf-cajas .inf-fila", { hasText: "Caja 1" }).click();
  await p.waitForSelector("#inf-cajas .inf-detalle .venta");
  const det = "#inf-cajas .inf-detalle";
  assert.match(await p.textContent(det), /Este informe ya no cambia/);
  assert.equal(await kpi(det, "Disponible para retirar").locator(".v").textContent(), "$ 8.000");
  const v1 = p.locator(det + " .venta", { hasText: "Venta 1" });
  await v1.getByRole("button", { name: "Anular" }).click();
  await v1.getByRole("button", { name: "Anular venta 1" }).click();
  await esperaTexto(det + " .anular-form .caja-msg", /motivo/);
  await v1.locator(".anular-form input.motivo").fill("Devolución");
  await v1.getByRole("button", { name: "Anular venta 1" }).click();
  await esperaTexto("#inf-cajas > .caja-msg", /Venta 1 de la Caja 1 anulada \(\$ 8\.000\)\. El cierre de ese día no cambia/);
  await esperaTexto(det, /anulada otro día: Devolución/);
  assert.equal(await kpi(det, "Ventas netas").locator(".v").textContent(), "$ 8.000", "la foto del cierre no cambia");
  assert.equal(await kpi("#inf-resumen", "Ventas netas").locator(".v").textContent(), "$ 16.500");
  await paso("2-detalle-cierre-anulada", det + " .ventas");
  // La anulación aparece en el informe de la caja abierta.
  await p.click("#tab-caja");
  await esperaTexto("#caja-resumen", /Anulación de un día anterior: Venta 1 de la Caja 1, \$ 8\.000 \(Devolución\)/);

  // Pagos pendientes: se cargan en Informes y bajan el disponible al cerrar.
  await p.click("#tab-informes");
  await p.click("#inf-pendientes .btn.primary");
  await esperaTexto("#inf-pendientes", /Escribí qué tenés que pagar/);
  await p.fill("#inf-pend-nombre", "Alquiler");
  await p.fill("#inf-pend-monto", "5000");
  await p.fill("#inf-pend-vence", "2026-11-10");
  await p.click("#inf-pendientes .btn.primary");
  await esperaTexto("#inf-pendientes", /Alquiler · vence el 10\/11/);
  assert.equal(await filaRes("#inf-pendientes", "Total"), "$ 5.000");
  await paso("3-pagos-pendientes", "#inf-pendientes");
  await p.click("#tab-caja");
  await p.click("#caja-btn-cerrar");
  await p.fill("#caja-cierre-contado", "20000");
  assert.match(await p.textContent("#caja-cierre-disp"), /Disponible estimado para retirar: − \$ 5\.000 \(.*− \$ 5\.000 de pagos pendientes\)/);
  await p.click("#caja-cierre-ok");
  await esperaTexto("#caja-estado", /Caja 3 cerrada/);
  await p.waitForSelector("#caja-resumen:not([hidden]) .res-kpi");
  assert.equal(await filaRes("#caja-resumen", "− Pagos pendientes"), "$ 5.000");
  assert.equal(await filaRes("#caja-resumen", "= Disponible estimado para retirar"), "− $ 5.000");
  assert.match(await p.textContent("#caja-resumen"), /Pago pendiente: Alquiler \$ 5\.000 \(vence el 10\/11\)/);
  // Se quita el pendiente: el cierre ya guardado no cambia.
  await p.click("#tab-informes");
  await p.getByRole("button", { name: "Quitar Alquiler" }).click();
  await p.waitForFunction(() => !/Alquiler/.test(document.querySelector("#inf-pendientes").textContent));
  await esperarLista(3);
  await p.locator("#inf-cajas .inf-fila", { hasText: "Caja 3" }).click();
  await esperaTexto(det, /Pago pendiente: Alquiler/);
  await p.locator("#inf-cajas .inf-fila", { hasText: "Caja 3" }).click(); // se cierra el detalle
  assert.equal(await kpi("#inf-resumen", "Ventas netas").locator(".v").textContent(), "$ 16.500", "la Caja 3 no tuvo ventas");
  assert.match(await kpi("#inf-resumen", "Ventas netas").locator(".note").textContent(), /en 3 cajas$/);

  // Planillas del período.
  const bajar = async (cual) => {
    const [d] = await Promise.all([p.waitForEvent("download"), p.click("#inf-csv-" + cual)]);
    assert.equal(d.suggestedFilename(), cual + "_" + pasado.desde + "_a_" + hoy + ".csv");
    return fs.readFileSync(await d.path(), "utf8").replace(/^﻿/, "").trim().split("\r\n");
  };
  const cierres = await bajar("cierres");
  assert.equal(cierres.length, 4);
  assert.match(cierres[1], /^1;\d\d\/\d\d\/\d{4};Cerrada;/);
  assert.match(cierres[2], /^2;.*;Faltó cambio$/);
  const ventas = await bajar("ventas");
  assert.equal(ventas.length, 4);
  assert.match(ventas[1], /^1;.*;1;Anulada;Lomito simple;1;8000;8000;/);
  assert.ok(ventas[1].endsWith(";Devolución"));
  const movs = await bajar("movimientos");
  assert.equal(movs.length, 1, "no hubo gastos ni retiros: solo el encabezado");

  // En el celular: nada se desborda a lo ancho y lo que se toca mide al menos 44 px.
  await p.locator("#inf-cajas .inf-fila", { hasText: "Caja 2" }).click();
  await p.waitForSelector(det + " .venta");
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "la página se desborda a lo ancho");
  const chicos = await p.evaluate(() => [...document.querySelectorAll("#view-informes button, #view-informes input")]
    .filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent || e.id, w: r.width, h: r.height }; })
    .filter((x) => x.w < 44 || x.h < 44));
  assert.deepEqual(chicos, []);
  await paso("4-detalle-caja-2", det);

  assert.deepEqual(errores, []);
  console.log("Prueba de informes: OK");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
