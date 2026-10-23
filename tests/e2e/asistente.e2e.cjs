// Prueba del asistente (botón flotante en Informes) en modo demo: solo aparece en Informes, preguntas sugeridas,
// aviso de que necesita la cuenta,
// y la charla (con un "preguntar" de prueba en vez de la IA) en compu y en celular.
// Mismo uso que caja.e2e.cjs: node tests/e2e/asistente.e2e.cjs [carpeta-para-capturas] (con public/ servido en http://localhost:8765)
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const assert = require("node:assert/strict");
const path = require("node:path");
const datos = require("./datos-demo.cjs");
const capturas = process.argv[2];

// Respuestas de ejemplo para las capturas: los números salen de la simulación real (tests/asistente.test.mjs).
const RESPUESTAS = {
  "Si la carne sube 15%, ¿cuánto me sube cada producto?":
    "Si el lomo pasa de $18.000 a $20.700 el kilo:\n• Lomito completo: el costo sube $639 y la ganancia baja de $3.464 a $2.824 (margen 31%).\n• Lomito simple: sube $639, ganás $2.290 (29%).\n• Promo 3 lomitos: sube $1.918, ganás $7.473 (29%).\nPara volver a tu 35% en el lomito completo, la calculadora sugiere $10.600.",
};

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  for (const [nombre, vista, tema] of [["escritorio", { width: 1280, height: 860 }, "light"], ["celular", { width: 390, height: 844 }, "dark"]]) {
    const ctx = await b.newContext({ serviceWorkers: "block", viewport: vista, colorScheme: tema, ...(nombre === "celular" ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
    await ctx.route("**/config.js", (r) => r.fulfill({ contentType: "text/javascript", body: 'export const CONFIG = { SUPABASE_URL: "", SUPABASE_ANON_KEY: "" };' }));
    await ctx.addInitScript((d) => { if (sessionStorage.getItem("sembrado")) return; sessionStorage.setItem("sembrado", "1"); localStorage.clear(); localStorage.setItem("costos-demo-v1", JSON.stringify(d)); localStorage.setItem("costos-tab", "informes"); }, datos);
    const p = await ctx.newPage();
    const errores = [];
    p.on("pageerror", (e) => errores.push(String(e)));
    await p.goto("http://localhost:8765/");

    // El botón flotante está en Informes y en ninguna otra pestaña.
    assert.ok(await p.isVisible("#asis-abrir"));
    assert.equal(await p.isVisible("#asis-panel"), false);
    await p.click("#tab-productos");
    assert.equal(await p.isVisible("#asis-abrir"), false);
    await p.click("#tab-informes");
    if (capturas) await p.screenshot({ path: path.join(capturas, "asistente-boton-" + nombre + ".png") });

    // Abre el panel con las preguntas sugeridas; Escape lo cierra y el ✕ también.
    await p.click("#asis-abrir");
    assert.ok(await p.isVisible("#asis-panel"));
    assert.equal(await p.isVisible("#asis-abrir"), false);
    await p.keyboard.press("Escape");
    assert.equal(await p.isVisible("#asis-panel"), false);
    await p.click("#asis-abrir");
    await p.click("#asis-cerrar");
    assert.equal(await p.isVisible("#asis-panel"), false);
    await p.click("#asis-abrir");
    assert.equal(await p.locator(".asis-sugeridas button").count(), 5);

    // En modo demo avisa que hace falta la cuenta.
    await p.fill("#asis-pregunta", "hola");
    await p.click("#asis-enviar");
    await p.waitForSelector(".asis-msg.error");
    assert.match(await p.textContent(".asis-msg.error"), /entrás con tu cuenta/);

    // Con una cuenta: la pregunta y la respuesta quedan en la charla. Se usa un "preguntar" de prueba.
    await p.evaluate(async (resp) => {
      const m = await import("/asistente.js");
      window.__preguntas = [];
      m.iniciarAsistente(async (q, hist) => { window.__preguntas.push({ q, hist }); await new Promise((r) => setTimeout(r, 150)); if (q === "falla") throw new Error("El asistente gratis llegó a su límite por ahora."); return resp[q] || "Respuesta de prueba."; });
    }, RESPUESTAS);
    await p.locator(".asis-sugeridas button", { hasText: "carne sube 15%" }).click();
    await p.waitForSelector(".asis-msg.pensando");
    await p.waitForFunction(() => document.querySelectorAll(".asis-msg.ia:not(.pensando)").length === 1);
    assert.match(await p.textContent(".asis-msg.ia"), /Lomito completo: el costo sube \$639/);
    assert.ok(await p.isVisible("#asis-borrar"));

    // Enter manda; la segunda pregunta lleva la charla anterior.
    await p.fill("#asis-pregunta", "¿Y si además el pan sube 10%?");
    await p.press("#asis-pregunta", "Enter");
    await p.waitForFunction(() => document.querySelectorAll(".asis-msg.ia").length === 2);
    const pregs = await p.evaluate(() => window.__preguntas);
    assert.equal(pregs[1].hist.length, 2);
    assert.equal(pregs[1].hist[0].rol, "usuario");

    if (capturas) {
      await p.evaluate(() => { const ms = document.querySelectorAll(".asis-msg"); ms[ms.length - 1].remove(); ms[ms.length - 2].remove(); });
      await p.screenshot({ path: path.join(capturas, "asistente-" + nombre + ".png") });
    }

    // Si falla, la pregunta vuelve al campo y se muestra el error.
    await p.fill("#asis-pregunta", "falla");
    await p.click("#asis-enviar");
    await p.waitForSelector(".asis-msg.error");
    assert.equal(await p.inputValue("#asis-pregunta"), "falla");
    assert.equal(await p.locator(".asis-msg.yo").count(), 2);

    // Empezar de nuevo borra la charla y vuelven las sugeridas.
    await p.click("#asis-borrar");
    assert.equal(await p.locator(".asis-msg").count(), 0);
    assert.equal(await p.locator(".asis-sugeridas button").count(), 5);

    assert.deepEqual(errores, []);
    await ctx.close();
  }
  await b.close();
  console.log("asistente.e2e: OK");
})().catch((e) => { console.error(e); process.exit(1); });
