// Prueba integral de la Fase 7 en modo demo, tamaño celular: dos noches completas (vender, gastos, anular una venta
// de otro día, cerrar), informes, copia de seguridad, celular nuevo sin datos, restaurar la copia y seguir trabajando.
// Necesita Playwright y un servidor sirviendo public/ en http://localhost:8765. Uso: node tests/e2e/integral.e2e.cjs [carpeta-para-capturas]
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const datos = require("./datos-demo.cjs");
const capturas = process.argv[2];

(async () => {
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
  const prod = (nombre) => p.locator(".pbtn", { hasText: nombre });
  const cat = (nombre) => p.locator(".chip-cat", { hasText: nombre }).click();
  const esperaTexto = (sel, re) => p.waitForFunction(([s, r]) => new RegExp(r).test(document.querySelector(s)?.textContent || ""), [sel, re.source]);
  const paso = async (nombre, sel) => { if (!capturas) return; if (sel) await p.locator(sel).scrollIntoViewIfNeeded(); await p.screenshot({ path: `${capturas}/${nombre}.png` }); };
  const cobrar = async (pago, n) => {
    await p.click(".pago." + pago);
    await esperaTexto(".caja-msg", new RegExp("Venta " + n + " guardada"));
    await p.waitForTimeout(500); // después de cobrar, un toque en el mismo lugar se ignora (doble toque)
  };
  const mov = async (tipo, importe, desc) => {
    await p.locator(".mov-tipos .chip", { hasText: new RegExp("^" + tipo + "$") }).click();
    await p.fill("#caja-mov-importe", String(importe));
    await p.fill("#caja-mov-desc", desc || "");
    await p.click("#caja-mov-ok");
  };
  const cerrar = async (contado, obs, fondo) => {
    await p.click("#caja-btn-cerrar");
    await p.fill("#caja-cierre-contado", String(contado));
    if (fondo != null) await p.fill("#caja-cierre-fondo", String(fondo));
    if (obs) await p.fill("#caja-cierre-obs", obs);
    await p.click("#caja-cierre-ok");
    await esperaTexto("#caja-estado", /cerrada/).catch(async (e) => { console.error(await p.textContent("#caja-cierre")); throw e; });
  };
  const esperado = () => p.evaluate(() => { const db = JSON.parse(localStorage.getItem("caja-demo-v1")); return db; });

  // ---------- Noche 1 ----------
  await p.click("#tab-caja");
  await p.waitForSelector("#caja-abrir:not([hidden])");
  await p.fill("#caja-saldo", "20000");
  await p.click("#caja-btn-abrir");
  await p.waitForSelector("#caja-pos:not([hidden])");
  await cat("Lomitos");
  await prod("Lomito completo").click();
  await p.locator(".pbtn.op", { hasText: "Pan árabe" }).click();
  await cobrar("efectivo", 1);
  await cat("Promos");
  await prod("Promo 3 lomitos").click();
  await cobrar("transferencia", 2);
  await mov("Gasto", 3000, "Garrafa");
  await esperaTexto("#caja-movs .caja-msg", /gasto de \$ 3\.000/);
  // Efectivo esperado: 20.000 + 10.100 (lomito con pan árabe: 10.000 + 100) − 3.000 = 27.100
  await p.click("#caja-btn-cerrar");
  assert.match(await p.textContent(".cierre-esperado"), /\$ 27\.100/);
  await p.fill("#caja-cierre-contado", "27100");
  await p.click("#caja-cierre-ok");
  await esperaTexto("#caja-estado", /Caja 1 cerrada/);

  // ---------- Noche 2: se anula desde Informes una venta de la noche 1 ----------
  await p.click("#caja-btn-abrir");
  await esperaTexto("#caja-estado", /Caja 2 abierta/);
  await cat("Extras");
  await prod("Pote de mayonesa").click();
  await cobrar("efectivo", 1);
  await p.click("#tab-informes");
  await p.waitForSelector("#inf-cajas .inf-fila");
  await p.locator("#inf-cajas .inf-fila", { hasText: "Caja 1" }).click();
  await p.waitForSelector("#inf-cajas .inf-detalle .venta");
  const v1 = p.locator("#inf-cajas .inf-detalle .venta", { hasText: "Venta 1" });
  await v1.getByRole("button", { name: "Anular" }).click();
  await v1.locator(".anular-form input.motivo").fill("Lomito frío, se devolvió");
  await v1.getByRole("button", { name: "Anular venta 1" }).click();
  await esperaTexto("#inf-cajas > .caja-msg", /Venta 1 de la Caja 1 anulada/);
  await p.click("#tab-caja");
  await esperaTexto("#caja-resumen", /Anulación de un día anterior/);
  await mov("Retiro", 10100, "Devolución del lomito frío");
  await esperaTexto("#caja-movs .caja-msg", /retiro de \$ 10\.100/);
  // Abrió con el fondo de ayer (20.000) + pote 500 − 10.100 = 10.400; contás 10.300 → falta $ 100. Queda todo de fondo.
  await cerrar(10300, "Faltaron 100 de cambio", 10300);
  await esperaTexto("#caja-estado", /Caja 2 cerrada/);

  // ---------- Informes de las dos noches ----------
  await p.click("#tab-informes");
  await p.locator("#inf-periodo .chip", { hasText: "Últimos 7 días" }).click();
  await p.waitForFunction(() => document.querySelectorAll("#inf-cajas .inf-fila").length === 2 && document.querySelector("#inf-resumen .res-kpis"));
  const kpisAntes = await p.textContent("#inf-resumen .res-kpis");
  assert.match(kpisAntes, /Ventas netas\$ 37\.6003 ventas en 2 cajas/);   // 10.100 + 27.000 + 500: la anulación no cambia el cierre de la noche 1
  assert.match(kpisAntes, /Diferencias de caja− \$ 1001 caja con diferencia/);
  const cuentasAntes = await p.textContent("#inf-resumen details.cuentas");
  await paso("1-informes-antes", "#inf-resumen");

  // ---------- Copia de seguridad ----------
  await p.click("#tab-negocio");
  assert.match(await p.textContent("#copia"), /Todavía no descargaste ninguna copia/);
  const [descarga] = await Promise.all([p.waitForEvent("download"), p.click("#copia-bajar")]);
  assert.match(descarga.suggestedFilename(), /^copia-venutto-fast-food-\d{4}-\d{2}-\d{2}\.json$/);
  const archivo = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "copia-")), descarga.suggestedFilename());
  await descarga.saveAs(archivo);
  const copia = JSON.parse(fs.readFileSync(archivo, "utf8"));
  assert.equal(copia.formato, "calculadora-copia");
  assert.equal(copia.demo_caja.cajas.length, 2);
  assert.equal(copia.demo_caja.ventas.length, 3);
  assert.equal(copia.productos.length, Object.keys(datos.productos).length);
  await esperaTexto("#copia .caja-msg.ok", /Copia descargada: 7 productos, 8 insumos, 1 gasto fijo, 2 cajas, 3 ventas, 2 gastos o retiros de caja/);
  assert.match(await p.textContent("#copia"), /Última copia descargada en este dispositivo: /);
  await paso("2-copia-descargada", "#copia");
  const antes = await esperado();

  // ---------- Celular nuevo: sin ningún dato ----------
  await p.evaluate(() => { localStorage.clear(); localStorage.setItem("costos-demo-negocio", JSON.stringify({ nombre: "Venutto Fast Food" })); });
  await p.reload();
  await p.click("#tab-caja");
  await p.waitForSelector("#caja-abrir:not([hidden])");
  await p.click("#tab-negocio");

  // Un archivo que no es una copia se rechaza sin tocar nada.
  const malo = archivo.replace(/\.json$/, "-malo.json");
  fs.writeFileSync(malo, '{"hola": 1}');
  await p.setInputFiles("#copia-archivo", malo);
  await esperaTexto("#copia .caja-msg.mal", /no es una copia de seguridad/);
  assert.equal(await p.locator("#copia-restaurar").count(), 0);

  // Restaurar la copia: muestra qué trae, se confirma y se recarga.
  await p.setInputFiles("#copia-archivo", archivo);
  await esperaTexto("#copia .copia-previa", /7 productos, 8 insumos, 1 gasto fijo, 2 cajas, 3 ventas/);
  await paso("3-restaurar", "#copia");
  await p.click("#copia-restaurar");
  await esperaTexto("#copia .caja-msg.ok", /Se agregaron 7 productos, 8 insumos, 1 gasto fijo, 2 ajustes .*De la caja: 2 cajas, 3 ventas y 2 gastos o retiros\./);
  await p.click("#copia-recargar");
  await p.waitForSelector("#pantalla-app:not([hidden])");

  // Todo vuelve igual: la caja, los informes y el catálogo.
  const despues = await esperado();
  assert.deepEqual(despues, antes);
  await p.click("#tab-informes");
  await p.locator("#inf-periodo .chip", { hasText: "Últimos 7 días" }).click();
  await p.waitForFunction(() => document.querySelectorAll("#inf-cajas .inf-fila").length === 2 && document.querySelector("#inf-resumen .res-kpis"));
  assert.equal(await p.textContent("#inf-resumen .res-kpis"), kpisAntes);
  assert.equal(await p.textContent("#inf-resumen details.cuentas"), cuentasAntes);
  await p.click("#tab-productos");
  await esperaTexto("#view-productos", /Promo 3 lomitos/);

  // Y se sigue trabajando: la próxima caja es la 3, con el fondo que quedó.
  await p.click("#tab-caja");
  await esperaTexto("#caja-estado", /Caja 2 cerrada/);
  assert.equal(await p.inputValue("#caja-saldo"), "10300");
  await p.click("#caja-btn-abrir");
  await esperaTexto("#caja-estado", /Caja 3 abierta/);

  // Restaurar otra vez con cajas cargadas: no mezcla nada.
  await p.click("#tab-negocio");
  await p.setInputFiles("#copia-archivo", archivo);
  await p.click("#copia-restaurar");
  await esperaTexto("#copia .caja-msg.ok", /Se agregaron 0 productos, 0 insumos, 0 gastos fijos, 0 ajustes .*La caja no se restauró porque este negocio ya tiene cajas/);
  assert.equal((await esperado()).cajas.length, 3);

  // En el celular: nada se desborda y lo que se toca en Mi negocio mide al menos 44 px.
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "la página se desborda a lo ancho");
  const chicos = await p.evaluate(() => [...document.querySelectorAll("#copia button, #copia input")]
    .filter((e) => e.offsetParent).map((e) => { const r = e.getBoundingClientRect(); return { t: e.textContent || e.id, h: r.height }; })
    .filter((x) => x.h < 44));
  assert.deepEqual(chicos, []);

  assert.deepEqual(errores, []);
  console.log("Prueba integral: OK");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
