// Prueba de punta a punta de la pantalla Caja en modo demo, en tamaño celular.
// Necesita Playwright y un servidor sirviendo public/ en http://localhost:8765
//   (por ejemplo: npx http-server public -p 8765 -c-1). Uso: node tests/e2e/caja.e2e.cjs [carpeta-para-capturas]
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict");
const datos = require("./datos-demo.cjs");
const capturas = process.argv[2];

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await b.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  // Modo demo: config.js vacío, datos de ejemplo en el navegador.
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
  const msg = () => p.textContent(".caja-msg");
  const total = () => p.textContent("#caja-total-v");
  const prod = (nombre) => p.locator(".pbtn", { hasText: nombre });
  const cat = (nombre) => p.locator(".chip-cat", { hasText: nombre }).click();
  const ventasGuardadas = () => p.evaluate(() => JSON.parse(localStorage.getItem("caja-demo-v1") || '{"ventas":[]}').ventas);
  const paso = async (nombre) => { if (capturas) await p.screenshot({ path: `${capturas}/${nombre}.png` }); };

  // 1. Sin caja: se ve el botón de abrir.
  await p.waitForSelector("#caja-abrir:not([hidden])");
  assert.match(await estado(), /Caja cerrada/);
  await paso("1-abrir");
  await p.click("#caja-btn-abrir");
  assert.equal(await p.locator("#caja-pos").isHidden(), true, "no abre sin efectivo inicial");
  await p.fill("#caja-saldo", "20000");
  await p.click("#caja-btn-abrir");
  await p.waitForSelector("#caja-pos:not([hidden])");
  assert.match(await estado(), /Caja 1 abierta.*0 ventas/);

  // 2. Lomito completo (común) + pote de mayonesa, en efectivo.
  await cat("Lomitos");
  assert.match(await p.textContent(".caja-prods"), /Lomito completo/);
  await prod("Lomito completo").click();
  await p.locator(".pbtn.op", { hasText: "Común" }).click();
  await cat("Extras");
  await prod("Pote de mayonesa").click();
  assert.equal(await total(), "$ 10.500");
  await paso("2-carrito");
  await p.click(".pago.efectivo");
  await p.waitForFunction(() => /Venta 1 guardada/.test(document.querySelector(".caja-msg")?.textContent || ""));
  assert.match(await msg(), /Venta 1 guardada · \$ 10\.500/);
  assert.match(await estado(), /1 venta · \$ 10\.500/);

  // 3. Promo con delivery y $1.000 de cargo, pago dividido: $8.000 en efectivo y el resto por transferencia.
  await cat("Promos");
  await prod("Promo 3 lomitos").click();
  await p.locator(".fila-chips .chip", { hasText: "Otro cargo" }).click();
  await p.fill("#caja-envio-otro", "1000");
  assert.equal(await total(), "$ 28.000");
  await p.click(".pago.dividir");
  await p.fill("#caja-div-ef", "8000");
  assert.match(await p.textContent("#caja-div-resto"), /Transferencia: \$ 20\.000/);
  await paso("3-dividido");
  await p.click("#caja-div-ok");
  await p.waitForFunction(() => /Venta 2 guardada/.test(document.querySelector(".caja-msg")?.textContent || ""));
  let v = (await ventasGuardadas())[1];
  assert.deepEqual(v.venta_pagos, [{ medio: "efectivo", importe: 8000 }, { medio: "transferencia", importe: 20000 }]);
  assert.equal(v.cargo_envio, 1000); assert.equal(v.con_envio, true); assert.equal(v.total, 28000);

  // 4. Dos lomitos con pan árabe (+$100 cada uno), por transferencia.
  await cat("Lomitos");
  await prod("Lomito completo").click();
  await p.locator(".pbtn.op", { hasText: "Pan árabe" }).click();
  await p.locator(".linea .qty[aria-label='Uno más']").click();
  assert.equal(await total(), "$ 20.200");
  await p.click(".pago.transferencia");
  await p.waitForFunction(() => /Venta 3 guardada/.test(document.querySelector(".caja-msg")?.textContent || ""));
  assert.equal((await ventasGuardadas())[2].venta_items[0].nombre, "Lomito completo (Pan árabe)");

  // 5. Descuento: sin motivo no deja cobrar; con motivo sí.
  await prod("Lomito simple").click();
  await p.locator(".fila-chips .chip", { hasText: "Descuento" }).click();
  await p.fill(".fila-chips input.n", "800");
  assert.equal(await total(), "$ 7.200");
  await p.click(".pago.efectivo");
  assert.match(await msg(), /motivo del descuento/);
  await p.fill(".fila-chips input.motivo", "Cliente frecuente");
  await p.click(".pago.efectivo");
  await p.waitForFunction(() => /Venta 4 guardada/.test(document.querySelector(".caja-msg")?.textContent || ""));

  // 6. Doble toque rápido sobre el medio de pago: una sola venta.
  await prod("Lomito simple").click();
  await p.locator(".pago.efectivo").dblclick();
  await p.waitForFunction(() => /Venta 5 guardada/.test(document.querySelector(".caja-msg")?.textContent || ""));
  await p.waitForTimeout(300);
  assert.equal((await ventasGuardadas()).length, 5, "el doble toque duplicó la venta");
  assert.match(await p.textContent("#caja-carrito"), /Tocá un producto/, "el segundo toque cayó en otro botón");
  assert.equal(await p.evaluate(() => document.querySelector("#caja-resumen").open), true, "el segundo toque cerró el resumen");

  // 7. Productos sin precio no se pueden tocar; el carrito se puede vaciar con ✕.
  await cat("Hamburguesas");
  assert.equal(await prod("Hamburguesa completa").isDisabled(), true);
  await cat("Lomitos");
  await prod("Lomito simple").click();
  await p.locator(".linea button[aria-label='Quitar']").click();
  assert.match(await p.textContent("#caja-carrito"), /Tocá un producto/);

  // 8. Listado de ventas y estado.
  assert.match(await estado(), /5 ventas · \$ 73\.900/);
  assert.equal(await p.locator(".venta").count(), 5);
  await paso("4-ventas");

  // 8b. Resumen de la caja: lo esperado se calcula con los mismos módulos de la app sobre los datos de ejemplo.
  const esperado = await p.evaluate(async (d) => {
    const { crearCostos } = await import("/costos.js");
    const { fmtPesos } = await import("/dinero.js");
    const C = crearCostos(d);
    const linea = (id, op, n) => C.costoParaVenta(id, op).costo_unitario * n;
    const cmv = Math.round((linea("p1", null, 1) + linea("p5", null, 1) + linea("p3", null, 1) + linea("p1", "arabe", 2) + linea("p2", null, 2)) * 100) / 100;
    const netas = 73700 - 800;
    const unidades = 1 + 1 + 3 + 2 + 2;                    // la promo cuenta 3
    const fijos = Math.round((7000 / 120) * 100) / 100 * unidades;
    const resultado = netas - cmv + 1000 - fijos - 250;    // 1 pedido con envío, nafta 20.000 / 80
    const r = (x) => fmtPesos(Math.round(x)); // los cuadros grandes van redondeados a pesos
    return { netas: r(netas), cmv: fmtPesos(cmv), margen: fmtPesos(netas - cmv), resultado: r(resultado), unidades };
  }, datos);
  const kpi = (k) => p.locator(".res-kpi").filter({ has: p.locator(".k", { hasText: new RegExp("^" + k + "$") }) }).locator(".v").textContent();
  await p.waitForSelector(".res-kpi");
  assert.equal(await kpi("Ventas netas"), esperado.netas);
  // Costo y margen están en las cuentas completas (desplegable), con centavos.
  const filaRes = (k) => p.locator("#caja-resumen .res-tabla tr").filter({ has: p.locator("td:first-child", { hasText: new RegExp("^" + k + "$") }) }).first().locator("td.r").textContent();
  assert.equal(await filaRes("− Costo de mercadería vendida"), esperado.cmv);
  assert.equal(await filaRes("= Margen bruto"), esperado.margen);
  // Gráficos: a dónde fue la plata, qué se vendió más y cómo pagaron.
  assert.match(await p.textContent("#caja-resumen"), /¿A dónde fue la plata de las ventas\?De cada \$ 100 que vendiste te quedaron \$ \d+\./);
  assert.match(await p.textContent("#caja-resumen"), /Qué se vendió más/);
  assert.match(await p.textContent("#caja-resumen"), /Cómo te pagaron/);
  assert.equal(await kpi("Ganancia total"), esperado.resultado);
  // La ganancia desde la apertura también va arriba, en verde, mientras la caja está abierta.
  assert.equal(await p.textContent("#caja-ganancia .v"), esperado.resultado);
  assert.match(await p.textContent("#caja-ganancia .k"), /Ganancia hasta ahora/);
  if (capturas) { await p.locator("#caja-estado").scrollIntoViewIfNeeded(); await paso("6-ganancia-arriba"); }
  assert.match(await p.textContent(".res-tabla"), new RegExp(esperado.unidades + " productos"));
  assert.doesNotMatch(await p.textContent(".caja-resumen"), /Rentabilidad provisional/); // todo lo vendido tiene receta completa
  if (capturas) { await p.locator("#caja-resumen").scrollIntoViewIfNeeded(); await paso("5-resumen"); }

  // 9. Al recargar la página la caja sigue abierta con sus ventas.
  await p.reload();
  await p.click("#tab-caja");
  await p.waitForFunction(() => /Caja 1 abierta/.test(document.querySelector("#caja-estado").textContent));
  assert.match(await estado(), /5 ventas/);

  assert.deepEqual(errores, []);
  console.log("Prueba de la caja de punta a punta: OK");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
