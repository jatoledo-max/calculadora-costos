// Prueba de la pestaña Compras en modo demo, en tamaño celular: Carnicería › Nalga › $ 21.600 con el peso,
// después la app estima los kilos sola, borrar con confirmación, el mes por categoría y editar categorías.
// Necesita public/ servido en http://localhost:8765.  Uso: node tests/e2e/compras.e2e.cjs [carpeta-para-capturas]
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict");
const datos = require("./datos-demo.cjs");
const capturas = process.argv[2];

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await b.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  await ctx.route("**/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'export const CONFIG = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "", PRECIO_MENSUAL_TEXTO: "$ 20.000" };' }));
  // Una compra del mes pasado, para comparar.
  const hoy = new Date(); const p2 = (n) => String(n).padStart(2, "0");
  const mesPasado = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 10);
  const fMesPasado = mesPasado.getFullYear() + "-" + p2(mesPasado.getMonth() + 1) + "-10";
  await ctx.addInitScript(([d, f]) => {
    if (localStorage.getItem("e2e-sembrado")) return;
    localStorage.clear();
    localStorage.setItem("costos-demo-v1", JSON.stringify(d));
    localStorage.setItem("costos-demo-negocio", JSON.stringify({ nombre: "Venutto Fast Food", color: "#f27405" }));
    localStorage.setItem("compras-demo-v1", JSON.stringify([{ id: "x1", fecha: f, categoria: "Carnicería", descripcion: "Lomo", importe: 155000, cantidad: null, unidad: null, estimada: false, creado_en: f + "T12:00:00Z" }]));
    localStorage.setItem("e2e-sembrado", "1");
  }, [datos, fMesPasado]);
  const errores = [];
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errores.push(String(e)));
  const foto = async (nombre) => { if (capturas) await p.screenshot({ path: `${capturas}/${nombre}.png`, fullPage: true }); };
  await p.goto("http://localhost:8765/");
  await p.click("#tab-compras");
  await p.waitForSelector("#cmp-hoy .hint");
  assert.match(await p.textContent("#cmp-hoy"), /Todavía no cargaste compras hoy/);
  assert.deepEqual(await p.locator("#cmp-cats button").allTextContents(), ["Mayorista", "Carnicería", "Verdulería", "Descartables", "Panadería", "Otros"]);

  // Sin categoría no guarda.
  await p.fill("#cmp-desc", "Nalga"); await p.fill("#cmp-importe", "21600");
  await p.click("#cmp-guardar");
  assert.match(await p.textContent("#cmp-msg"), /Elegí la categoría/);

  // Primera vez: no hay precio. Con el peso exacto, dice cuánto salió el kilo.
  const cat = (n) => p.locator("#cmp-cats button", { hasText: n });
  await cat("Carnicería").click();
  assert.match(await p.textContent("#cmp-calc"), /Primera vez que cargás nalga/);
  await p.click("#cmp-opc summary");
  await p.fill("#cmp-cant", "1.8");
  assert.match(await p.textContent("#cmp-calc"), /1,8 kg de nalga.*Te salió \$ 12\.000 el kg/s);
  await p.click("#cmp-guardar");
  await p.waitForFunction(() => /Guardada: Nalga/.test(document.querySelector("#cmp-msg").textContent));
  assert.match(await p.textContent("#cmp-msg"), /No había caja abierta: no se descontó/);
  assert.equal(await p.inputValue("#cmp-desc"), "");
  assert.equal(await cat("Carnicería").getAttribute("aria-pressed"), "true", "la categoría queda elegida");
  assert.match(await p.textContent("#cmp-chips"), /Nalga/);

  // Segunda vez: Carnicería › Nalga › $ 21.000 → ≈ 1,75 kg solo.
  await p.locator("#cmp-chips button", { hasText: "Nalga" }).click();
  await p.fill("#cmp-importe", "21000");
  assert.match(await p.textContent("#cmp-calc"), /≈ 1,75 kg de nalga.*\$ 12\.000 el kg \(lo que pagaste la última vez\)/s);
  await foto("1-cargar-compra");
  await p.click("#cmp-guardar");
  await p.waitForFunction(() => document.querySelectorAll("#cmp-hoy .cmp-lista li").length === 2);

  // Con precio de Insumos (Lomo: 1 kg $ 18.000) y algo sin precio en otra categoría.
  await p.fill("#cmp-desc", "lomo"); await p.fill("#cmp-importe", "36000");
  assert.match(await p.textContent("#cmp-calc"), /≈ 2 kg de lomo.*precio de tus Insumos/s);
  await p.click("#cmp-guardar");
  await p.waitForFunction(() => document.querySelectorAll("#cmp-hoy .cmp-lista li").length === 3);
  await cat("Descartables").click();
  await p.fill("#cmp-desc", "Folex"); await p.fill("#cmp-importe", "6500");
  await p.press("#cmp-importe", "Enter");
  await p.waitForFunction(() => document.querySelectorAll("#cmp-hoy .cmp-lista li").length === 4);
  const hoyTxt = await p.textContent("#cmp-hoy");
  assert.match(hoyTxt, /\$ 85\.100/);
  assert.match(hoyTxt, /Nalga · ≈ 1,75 kg/);
  assert.match(hoyTxt, /Nalga · 1,8 kg/);
  const mesTxt = await p.textContent("#cmp-mes");
  assert.match(mesTxt, /Gastaste en compras\$ 85\.100en 1 día/);
  assert.match(mesTxt, /\$ 155\.000/);
  assert.deepEqual(await p.locator("#cmp-mes .cmp-barra .c").allTextContents(), ["Carnicería", "Descartables"]);
  await foto("2-hoy-y-mes");

  // Tocar una categoría muestra sus compras; borrar pide confirmar.
  await p.locator("#cmp-mes .cmp-barra", { hasText: "Descartables" }).click();
  assert.match(await p.textContent("#cmp-mes .cmp-lista-cat"), /Folex/);
  await p.locator("#cmp-hoy li", { hasText: "Folex" }).locator("button.x").click();
  await p.locator("#cmp-hoy li", { hasText: "Folex" }).locator("button", { hasText: "Cancelar" }).click();
  assert.equal(await p.locator("#cmp-hoy .cmp-lista li").count(), 4);
  await p.locator("#cmp-hoy li", { hasText: "Folex" }).locator("button.x").click();
  await p.locator("#cmp-hoy li", { hasText: "Folex" }).locator("button", { hasText: "Borrar" }).click();
  await p.waitForFunction(() => document.querySelectorAll("#cmp-hoy .cmp-lista li").length === 3);
  assert.match(await p.textContent("#cmp-hoy"), /\$ 78\.600/);

  // Mes anterior.
  await p.click("#cmp-mes button[aria-label='Mes anterior']");
  await p.waitForFunction(() => /155\.000/.test(document.querySelector("#cmp-mes .kpi.hl").textContent));

  // Editar categorías.
  await p.click("#cmp-editar-cats");
  await p.fill("#cmp-cat-nueva", "Bebidas"); await p.press("#cmp-cat-nueva", "Enter");
  await p.waitForFunction(() => [...document.querySelectorAll("#cmp-cats button")].some((b) => b.textContent === "Bebidas"));
  await p.locator("#cmp-cats-editor li", { hasText: "Panadería" }).locator("button").click();
  await p.waitForFunction(() => ![...document.querySelectorAll("#cmp-cats button")].some((b) => b.textContent === "Panadería"));
  await p.click("#cmp-editar-cats");

  // Al recargar sigue todo.
  await p.reload();
  await p.waitForFunction(() => document.querySelectorAll("#cmp-hoy .cmp-lista li").length === 3);
  assert.equal(await p.locator("#view-compras").isVisible(), true);
  assert.match(await p.textContent("#cmp-cats"), /Bebidas/);

  // Con la caja abierta, la compra se descuenta sola del efectivo; al borrarla vuelve a la caja.
  await p.click("#tab-caja");
  await p.fill("#caja-saldo", "50000"); await p.click("#caja-btn-abrir");
  await p.waitForSelector("#caja-movs:not([hidden])");
  await p.click("#tab-compras");
  await cat("Verdulería").click();
  await p.fill("#cmp-desc", "Lechuga"); await p.fill("#cmp-importe", "4000"); await p.click("#cmp-guardar");
  await p.waitForFunction(() => /Guardada: Lechuga \$ 4\.000, descontada de la caja\.$/.test(document.querySelector("#cmp-msg").textContent));
  assert.match(await p.textContent("#cmp-hoy"), /Lechuga · de la caja/);
  // Más de lo que hay en efectivo: se guarda igual y avisa.
  await p.fill("#cmp-desc", "Papas"); await p.fill("#cmp-importe", "90000"); await p.click("#cmp-guardar");
  await p.waitForFunction(() => /Guardada: Papas.*No se descontó de la caja: En la caja debería haber \$ 46\.000/.test(document.querySelector("#cmp-msg").textContent));
  // Por transferencia: se descuenta aunque no alcance el efectivo, y después vuelve a Efectivo.
  await p.locator("#cmp-medio .chip", { hasText: "Transferencia" }).click();
  await p.fill("#cmp-desc", "Queso tybo"); await p.fill("#cmp-importe", "90000"); await p.click("#cmp-guardar");
  await p.waitForFunction(() => /Guardada: Queso tybo \$ 90\.000, descontada de la caja\.$/.test(document.querySelector("#cmp-msg").textContent));
  assert.equal(await p.locator("#cmp-medio .chip", { hasText: "Efectivo" }).getAttribute("aria-pressed"), "true");
  assert.match(await p.textContent("#cmp-hoy"), /Queso tybo · de la caja \(transferencia\)/);
  await p.click("#tab-caja");
  await p.waitForFunction(() => /Transferencia · Verdulería: Queso tybo/.test(document.querySelector("#caja-movs").textContent));
  await p.waitForFunction(() => /Verdulería: Lechuga/.test(document.querySelector("#caja-movs").textContent));
  assert.doesNotMatch(await p.textContent("#caja-movs"), /Papas/);
  await p.click("#tab-compras");
  await p.locator("#cmp-hoy li", { hasText: "Lechuga" }).locator("button.x").click();
  await p.locator("#cmp-hoy li", { hasText: "Lechuga" }).locator("button", { hasText: "Borrar" }).click();
  await p.waitForFunction(() => /Compra borrada y devuelta a la caja/.test(document.querySelector("#cmp-msg").textContent));
  await p.click("#tab-caja");
  await p.waitForFunction(() => /anulado: Compra borrada/.test(document.querySelector("#caja-movs").textContent));

  // Con la caja cerrada, la compra sale del disponible para retirar del último cierre.
  await p.click("#tab-compras");
  await p.locator("#cmp-hoy li", { hasText: "Queso tybo" }).locator("button.x").click();
  await p.locator("#cmp-hoy li", { hasText: "Queso tybo" }).locator("button", { hasText: "Borrar" }).click();
  await p.waitForFunction(() => /devuelta a la caja/.test(document.querySelector("#cmp-msg").textContent));
  assert.match(await p.textContent("#cmp-disp"), /Caja 1 abierta: las compras se descuentan de la caja/);
  await p.click("#tab-caja");
  await p.click("#caja-btn-cerrar");
  await p.fill("#caja-cierre-contado", "50000");
  await p.fill("#caja-cierre-fondo", "10000");
  await p.click("#caja-cierre-ok");
  await p.waitForFunction(() => /cerrada/.test(document.querySelector("#caja-estado").textContent));
  await p.click("#tab-compras");
  await p.waitForFunction(() => /Disponible para retirar\$ 40\.000/.test(document.querySelector("#cmp-disp").textContent));
  await cat("Bebidas").click();
  await p.fill("#cmp-desc", "Gaseosas"); await p.fill("#cmp-importe", "15000"); await p.click("#cmp-guardar");
  await p.waitForFunction(() => /descontada del disponible para retirar \(te quedan \$ 25\.000\)/.test(document.querySelector("#cmp-msg").textContent));
  assert.match(await p.textContent("#cmp-disp"), /\$ 25\.000.*\(\$ 40\.000\) menos \$ 15\.000 de compras/s);
  await p.click("#tab-caja");
  await p.waitForFunction(() => /Disponible después de compras\$ 25\.000/.test(document.querySelector("#caja-estado").textContent));
  await foto("3-caja-cerrada-disponible");
  await p.click("#tab-compras");
  await foto("4-compras-con-caja-cerrada");

  // Sin desborde horizontal en el celular.
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "la página no se corre de costado");
  assert.deepEqual(errores, []);
  await b.close();
  console.log("compras.e2e: OK");
})().catch((e) => { console.error(e); process.exit(1); });
