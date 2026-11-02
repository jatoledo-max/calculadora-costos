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

  // Sin desborde horizontal en el celular.
  assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "la página no se corre de costado");
  assert.deepEqual(errores, []);
  await b.close();
  console.log("compras.e2e: OK");
})().catch((e) => { console.error(e); process.exit(1); });
