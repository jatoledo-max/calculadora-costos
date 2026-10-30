// Prueba de punta a punta de los tickets de pedido en modo demo, en tamaño celular:
// el negocio arma el ticket, el cliente lo abre y pide un cambio, el negocio corrige, el cliente acepta
// y el ticket pasa a la Caja. Necesita public/ servido en http://localhost:8765.
// Uso: node tests/e2e/tickets.e2e.cjs [carpeta-para-capturas]
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict");
const datos = require("./datos-demo.cjs");
const capturas = process.argv[2];

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  const ctx = await b.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  await ctx.route("**/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'export const CONFIG = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "", PRECIO_MENSUAL_TEXTO: "$ 20.000" };' }));
  const d = JSON.parse(JSON.stringify(datos));
  d.ajustes.menu = { whatsapp: "5493855702807", alias: "venutto.mp", pagos: ["efectivo", "transferencia"], envio: 1000 };
  // La página del cliente se abre en otra pestaña: el sembrado se hace una sola vez para todo el navegador.
  await ctx.addInitScript((d) => {
    if (localStorage.getItem("e2e-sembrado")) return;
    localStorage.clear();
    localStorage.setItem("costos-demo-v1", JSON.stringify(d));
    localStorage.setItem("costos-demo-negocio", JSON.stringify({ nombre: "Venutto Fast Food", color: "#f27405" }));
    localStorage.setItem("e2e-sembrado", "1");
  }, d);
  const errores = [];
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errores.push(String(e)));
  const foto = async (pg, nombre, completa) => { if (capturas) await pg.screenshot({ path: `${capturas}/${nombre}.png`, fullPage: !!completa }); };
  await p.goto("http://localhost:8765/");
  await p.click("#tab-tickets");
  assert.match(await p.textContent("#tk-ticket"), /tocá los productos/);
  assert.match(await p.textContent("#tk-lista"), /Todavía no mandaste tickets/);

  // El cliente escribió "2 lomitos completos en pan árabe + extra de papas, con envío".
  const prod = (n) => p.locator("#tk-prods .pbtn", { hasText: n });
  await p.locator("#tk-cats .chip-cat", { hasText: "Lomitos" }).click();
  await prod("Lomito completo").click();
  await p.locator("#tk-prods .pbtn.op", { hasText: "Pan árabe" }).click();
  await p.locator("#tk-ticket .qty[aria-label='Uno más']").first().click();
  await p.locator("#tk-cats .chip-cat", { hasText: "Extras" }).click();
  await prod("Extra de papas").click();
  await p.locator("#tk-ticket .chip", { hasText: "Con envío" }).click();
  assert.equal(await p.inputValue("#tk-envio-monto"), "1000", "arranca con el envío del menú");
  await p.fill("#tk-envio-monto", "1500");
  await p.fill("#tk-cliente", "Juan");
  assert.equal(await p.textContent("#tk-total"), "$ 23.700"); // 2 × 10.100 + 2.000 + 1.500
  await foto(p, "1-armar-ticket", true);

  // Se recarga a mitad (por ejemplo, volvió de WhatsApp): el borrador sigue.
  await p.reload();
  await p.click("#tab-tickets");
  assert.equal(await p.textContent("#tk-total"), "$ 23.700");
  assert.equal(await p.inputValue("#tk-cliente"), "Juan");

  await p.click("#tk-crear");
  await p.waitForSelector(".tk-listo");
  assert.match(await p.textContent(".tk-listo"), /Ticket #1 listo · \$ 23\.700/);
  const wa = decodeURIComponent((await p.getAttribute(".tk-listo .tk-wa", "href")).split("text=")[1]);
  assert.equal(wa, "*Venutto Fast Food · Pedido #1*\n2 Lomitos completos (Pan árabe) — $ 20.200\n1 Extra de papas — $ 2.000\nEnvío — $ 1.500\n*TOTAL: $ 23.700*");
  assert.equal(await p.locator(".tk-listo a.btn.ghost").count(), 0, "sin link para el cliente");
  // La página del cliente sigue existiendo: se prueba con el código guardado.
  const token = (await p.evaluate(() => JSON.parse(localStorage.getItem("tickets-demo-v1"))))[0].token;
  assert.ok(token && token.length >= 20);
  assert.match(await p.textContent("#tk-lista"), /#1 · Juan[^]*Enviado[^]*\$ 23\.700[^]*2 Lomitos completos \(Pan árabe\), 1 Extra de papas[^]*Pasar a la Caja/);
  await foto(p, "2-ticket-listo");

  // ---------- El cliente abre el link ----------
  const c = await ctx.newPage();
  c.on("pageerror", (e) => errores.push(String(e)));
  await c.goto("http://localhost:8765/ticket.html?t=" + token);
  await c.waitForSelector("#tkc-aceptar");
  const pagina = await c.textContent("#tkc");
  assert.match(pagina, /Venutto Fast Food[^]*Tu pedido #1 · Juan[^]*2×Lomito completo \(Pan árabe\)\$ 20\.200[^]*Envío\$ 1\.500[^]*Total\$ 23\.700/);
  assert.match(pagina, /Podés pagar con: Efectivo, Transferencia\.[^]*Alias: venutto\.mp/);
  assert.doesNotMatch(pagina, /costo|margen/i);
  await foto(c, "3-cliente-ve-el-ticket", true);
  await c.click("#tkc-cambio");
  await c.click(".tkc-resp .btn.primary");
  assert.match(await c.textContent(".tkc-resp"), /Escribí qué querés cambiar/);
  await c.fill("#tkc-texto", "Uno sin huevo y sumame un pote de mayonesa");
  await c.click(".tkc-resp .btn.primary");
  await c.waitForSelector("text=Pediste un cambio");
  assert.ok(await c.isVisible(".tkc-wa"), "botón para avisar por WhatsApp");
  assert.match(await c.getAttribute(".tkc-wa", "href"), /^https:\/\/wa\.me\/5493855702807\?text=/);

  // ---------- El negocio ve el pedido de cambio y corrige ----------
  await p.click("#tk-lista .btn.ghost:has-text('Actualizar')");
  await p.waitForSelector(".tk-item.tk-cambio");
  assert.match(await p.textContent(".tk-item"), /Pide un cambio[^]*Pide: Uno sin huevo y sumame un pote de mayonesa/);
  await p.locator(".tk-item").scrollIntoViewIfNeeded();
  await foto(p, "4-cliente-pide-cambio");
  await p.click(".tk-item .btn:has-text('Corregir')");
  assert.match(await p.textContent(".tk-corrigiendo"), /Corrigiendo el ticket #1[^]*El cliente pidió: Uno sin huevo/);
  assert.equal(await p.inputValue("#tk-envio-monto"), "1500");
  await p.locator("#tk-cats .chip-cat", { hasText: "Extras" }).click();
  await prod("Pote de mayonesa").click();
  await p.fill("#tk-nota", "Uno de los lomitos va sin huevo");
  assert.equal(await p.textContent("#tk-total"), "$ 24.200");
  await p.click("#tk-crear");
  await p.waitForSelector(".tk-listo");
  assert.match(await p.textContent(".tk-listo"), /Ticket #1 corregido · \$ 24\.200[^]*Mandale el ticket corregido/);

  // La página del cliente se actualiza sola (o al recargar) y ahora puede aceptar.
  await c.reload();
  await c.waitForSelector("#tkc-aceptar");
  assert.match(await c.textContent("#tkc"), /1×Pote de mayonesa\$ 500[^]*Uno de los lomitos va sin huevo[^]*Total\$ 24\.200/);
  await c.click("#tkc-aceptar");
  await c.waitForSelector("text=¡Pedido confirmado!");
  await foto(c, "5-cliente-acepta");
  // Doble toque o respuesta repetida: no cambia nada.
  assert.equal((await c.evaluate(() => JSON.parse(localStorage.getItem("tickets-demo-v1"))))[0].estado, "aceptado");

  // ---------- Aceptado: pasa a la Caja ----------
  await p.click("#tk-lista .btn.ghost:has-text('Actualizar')");
  await p.waitForSelector(".tk-item.tk-aceptado");
  assert.equal(await p.locator(".tk-item .btn:has-text('Corregir')").count(), 0, "un ticket aceptado no se corrige");
  await foto(p, "6-ticket-aceptado");
  await p.click(".tk-item .btn:has-text('Pasar a la Caja')");
  assert.equal(await p.getAttribute("#tab-caja", "aria-selected"), "true");
  assert.match(await p.textContent("#caja-abrir-msg"), /Ticket #1 en el carrito\. Abrí la caja para cobrarlo/);
  await p.fill("#caja-saldo", "0");
  await p.click("#caja-btn-abrir");
  await p.waitForSelector("#caja-total-v");
  assert.equal(await p.textContent("#caja-total-v"), "$ 24.200");
  assert.match(await p.textContent("#caja-carrito"), /Lomito completo · Pan árabe[^]*Extra de papas[^]*Pote de mayonesa/);
  assert.equal(await p.getAttribute("#caja-carrito .chip[aria-pressed=true]", "aria-pressed"), "true");
  assert.match(await p.textContent("#caja-carrito .chip[aria-pressed=true]"), /Otro cargo/);
  assert.equal(await p.inputValue("#caja-envio-otro"), "1500");
  await foto(p, "7-en-la-caja");
  await p.locator("#caja-carrito .pago", { hasText: "Transferencia" }).click();
  await p.waitForSelector(".caja-msg.ok");
  assert.match(await p.textContent(".caja-msg.ok"), /Venta 1 guardada · \$ 24\.200/);

  // De vuelta en Tickets: avisa que ya se pasó.
  await p.click("#tab-tickets");
  assert.match(await p.textContent(".tk-item"), /Ya está en la Caja/);

  // Un ticket aceptado no se puede responder de nuevo ni corregir.
  await c.reload();
  assert.equal(await c.locator("#tkc-aceptar").count(), 0);
  const noExiste = await ctx.newPage();
  await noExiste.goto("http://localhost:8765/ticket.html?t=noexiste1234567890");
  assert.match(await noExiste.textContent("#tkc"), /no existe/);

  assert.deepEqual(errores, []);
  await b.close();
  console.log("Tickets: OK");
})().catch((e) => { console.error(e); process.exit(1); });
