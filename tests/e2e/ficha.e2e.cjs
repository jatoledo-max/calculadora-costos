// Prueba de la ficha de producto en la calculadora: promos armadas con productos y opciones como pan árabe.
// Mismo uso que caja.e2e.cjs: node tests/e2e/ficha.e2e.cjs (con public/ servido en http://localhost:8765)
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict");
const datos = require("./datos-demo.cjs");

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await b.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 900 } });
  await ctx.route("**/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'export const CONFIG = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "" };' }));
  await ctx.addInitScript((d) => { localStorage.clear(); localStorage.setItem("costos-demo-v1", JSON.stringify(d)); localStorage.setItem("costos-tab", "productos"); }, datos);
  const p = await ctx.newPage();
  const errores = [];
  p.on("pageerror", (e) => errores.push(String(e)));
  await p.goto("http://localhost:8765/");
  const guardado = (id) => p.evaluate((id) => JSON.parse(localStorage.getItem("costos-demo-v1")).productos[id], id);

  // Promo 3 lomitos: el renglón es un producto, muestra la cantidad y "sin su caja" saca el packaging.
  await p.locator(".pitem", { hasText: "Promo 3 lomitos" }).click();
  assert.equal(await p.inputValue("#f-items input.n"), "3");
  const conCaja = await p.textContent("#f-items .num");
  await p.check("#f-items .sinpack input");
  assert.equal((await guardado("p3")).items[0].sinPackaging, true);
  assert.notEqual(await p.textContent("#f-items .num"), conCaja, "sin su caja no cambió el costo");

  // Agregar un producto a la receta de una promo desde el selector.
  await p.selectOption("#f-add-ins", "v:p2");
  await p.fill("#f-add-cant", "1");
  await p.click("#f-add button");
  assert.deepEqual((await guardado("p3")).items[1], { producto: "p2", cantidad: 1 });

  // Opción pan árabe y categoría en el Lomito simple.
  await p.locator(".pitem", { hasText: "Lomito simple" }).click();
  await p.fill("#f-op-nombre", "Pan árabe");
  await p.selectOption("#f-op-de", "i2");
  await p.selectOption("#f-op-por", "i10");
  await p.fill("#f-op-precio", "100");
  await p.click("#f-addop button");
  const op = (await guardado("p2")).opciones[0];
  assert.equal(op.nombre, "Pan árabe"); assert.equal(op.reemplaza, "i2"); assert.equal(op.por, "i10"); assert.equal(op.precioExtra, 100);
  // (la calculadora separa "$" del número con un espacio que no corta línea: por eso \s)
  assert.match(await p.textContent("#f-opciones .det"), /costo \+ \$\s100,00 · precio \+ \$\s100/);
  await p.selectOption("#f-ctipo", "extra");
  assert.equal((await guardado("p2")).tipo, "extra");
  await p.uncheck("#f-encaja");
  assert.equal((await guardado("p2")).enCaja, false);

  // Lista agrupada por categoría: Hamburguesas, Lomitos, después Promos/Extras/Otros y al final las preparaciones.
  const lista = () => p.$$eval("#plist > *", (els) => els.map((e) => (e.classList.contains("grp") ? "# " + e.textContent : e.querySelector(".nm").textContent.replace(/ (ejemplo|costo incompleto)/g, "").trim())));
  let l = await lista();
  const titulos = l.filter((x) => x.startsWith("# "));
  assert.deepEqual(titulos.slice(0, 2), ["# Hamburguesas", "# Lomitos"]);
  assert.equal(titulos[titulos.length - 1], "# Preparaciones propias");
  assert.ok(l.indexOf("Hamburguesa completa") < l.indexOf("# Lomitos") && l.indexOf("Lomito completo") > l.indexOf("# Lomitos"), l.join(" | "));

  // Producto nuevo con categoría (opcional) desde el formulario: va a su grupo.
  await p.fill("#newprod-name", "Sándwich de milanesa");
  await p.fill("#newprod-cat", "Sándwiches de milanesa");
  await p.click("#newprod button[type=submit]");
  const nuevo = await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem("costos-demo-v1")).productos).find((x) => x.nombre === "Sándwich de milanesa"));
  assert.equal(nuevo.categoria, "Sándwiches de milanesa");
  l = await lista();
  assert.equal(l[l.indexOf("# Sándwiches de milanesa") + 1], "Sándwich de milanesa");
  // Sin categoría también se puede: queda en "Otros".
  await p.fill("#newprod-name", "Papas cheddar");
  await p.click("#newprod button[type=submit]");
  assert.equal((await p.evaluate(() => Object.values(JSON.parse(localStorage.getItem("costos-demo-v1")).productos).find((x) => x.nombre === "Papas cheddar"))).categoria, undefined);
  l = await lista();
  assert.ok(l.indexOf("Papas cheddar") > l.indexOf("# Otros") && l.indexOf("Papas cheddar") < l.indexOf("# Preparaciones propias"), l.join(" | "));
  // Cambiar la categoría en la ficha mueve el producto.
  await p.fill("#f-cat", "Papas");
  await p.press("#f-cat", "Enter");
  await p.locator("#f-cat").blur();
  l = await lista();
  assert.equal(l[l.indexOf("# Papas") + 1], "Papas cheddar");
  await p.screenshot({ path: process.env.CAPTURA || "/tmp/lista-categorias.png", fullPage: false });

  assert.deepEqual(errores, []);
  console.log("Prueba de la ficha de producto: OK");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
