// Pruebas del asistente: los números que recibe la IA y las cuentas de sus herramientas,
// y la función de Netlify completa con Supabase y Groq simulados. Correr con: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { armarContexto, ejecutarHerramienta, resumirVentas, instrucciones } from "../netlify/lib/asistente.mjs";

const datos = createRequire(import.meta.url)("./e2e/datos-demo.cjs");
const estado = () => structuredClone(datos);

// Lomito completo (a mano): lomo 180 g × 18/0,8/0,95 = $4.263,16; pan $500; huevo $200; papa 250 g × 0,9/0,85 = $264,71;
// caja $250 → $5.477,87 de insumos y packaging + $58,33 de gastos fijos (7.000 / 120) = $5.536,20.
// Vende a $10.000 con $1.000 de envío incluido → gana $3.463,80, margen 38%.
test("el contexto trae los números ya calculados, igual que la ficha", () => {
  const t = armarContexto(estado());
  const lomito = t.split("\n").find((l) => l.startsWith("- Lomito completo"));
  assert.match(lomito, /vende a \$10\.000 \(de eso \$1\.000 es envío incluido\)/);
  assert.match(lomito, /costo total \$5\.536/);
  assert.match(lomito, /gana \$3\.464 por unidad · margen 38%/);
  assert.match(lomito, /\$250 packaging/);
  assert.match(t, /- Hamburguesa completa \[Hamburguesas\]: sin precio de venta cargado.*COSTO INCOMPLETO/);
  assert.match(t, /- Lomo: compra 1 kg a \$18\.000, rendimiento 80%, merma 5% · costo de uso \$23\.684 por kg útil/);
  assert.match(t, /Mayonesa casera: la tanda cuesta/);
  assert.match(t, /GASTOS FIJOS DEL MES: total \$7\.000 \(Limpieza \$7\.000\)/);
  assert.match(t, /cada producto carga \$58 de gastos fijos/);
  assert.match(t, /nafta por pedido \$250/);
});

test("simular una suba de la carne recalcula cada producto que la usa", async () => {
  const r = await ejecutarHerramienta("simular_precios_insumos", { cambios: [{ insumo: "lomo", porcentaje: 15 }] }, { estado: estado() });
  assert.equal(r.cambios[0].precio_despues, "$20.700");
  const nombres = r.productos_afectados.map((p) => p.producto).sort();
  assert.deepEqual(nombres, ["Lomito completo", "Lomito simple", "Promo 3 lomitos"]);
  const lc = r.productos_afectados.find((p) => p.producto === "Lomito completo");
  // 4.263,16 × 15% = $639,47 más por lomito.
  assert.equal(lc.sube, "$639");
  assert.equal(lc.ganancia_despues, "$2.824");
  const promo = r.productos_afectados.find((p) => p.producto === "Promo 3 lomitos");
  assert.equal(promo.sube, "$1.918"); // 3 lomitos
  // El estado original no cambia.
  const r2 = await ejecutarHerramienta("simular_precios_insumos", { cambios: [{ insumo: "Lomo", precio_nuevo: 18000 }] }, { estado: estado() });
  assert.equal(r2.productos_afectados, "Ningún producto de venta usa esos insumos.");
});

test("nombres sin acentos, ambiguos o que no existen", async () => {
  const ok = await ejecutarHerramienta("ver_receta", { producto: "lomito completo" }, { estado: estado() });
  assert.equal(ok.producto, "Lomito completo");
  assert.equal(ok.renglones[0].insumo, "Lomo");
  assert.equal(ok.renglones[0].peso_en_el_costo, "78%");
  const amb = await ejecutarHerramienta("ver_receta", { producto: "lomito" }, { estado: estado() });
  assert.deepEqual(amb.opciones.sort(), ["Lomito completo", "Lomito simple"]);
  const no = await ejecutarHerramienta("simular_precios_insumos", { cambios: [{ insumo: "queso", porcentaje: 10 }] }, { estado: estado() });
  assert.match(no.error, /queso/);
  assert.ok(no.disponibles.includes("Pan árabe"));
  const pa = await ejecutarHerramienta("simular_precios_insumos", { cambios: [{ insumo: "pan arabe", porcentaje: 10 }] }, { estado: estado() });
  assert.equal(pa.cambios[0].insumo, "Pan árabe");
});

test("precio para una ganancia dada usa la fórmula y el redondeo de la calculadora", async () => {
  // 5.536,20 / 0,65 + 1.000 = 9.517,23 → $9.600
  const r = await ejecutarHerramienta("precio_para_ganancia", { producto: "Lomito completo", porcentaje: 35 }, { estado: estado() });
  assert.match(r.precio, /^\$9\.600 /);
  assert.equal(r.precio_actual, "$10.000");
});

test("ventas del período: suma por producto, sin envío incluido, con descuentos y fijos", async () => {
  const filas = [
    { total: 21000, descuento: 0, cargo_envio: 1000, venta_items: [{ nombre: "Lomito completo", cantidad: 2, precio_unitario: 10000, envio_incluido_unitario: 1000, costo_unitario: 5477.87, unidades: 1 }] },
    { total: 7500, descuento: 500, cargo_envio: 0, venta_items: [{ nombre: "Lomito simple", cantidad: 1, precio_unitario: 8000, envio_incluido_unitario: 0, costo_unitario: 4000, unidades: 1 }] },
  ];
  let pedido;
  const r = await ejecutarHerramienta("ventas_del_periodo", { desde: "2026-10-19", hasta: "2026-10-23" },
    { estado: estado(), leerVentas: async (d, h) => { pedido = [d, h]; return filas; } });
  assert.deepEqual(pedido, ["2026-10-19", "2026-10-23"]);
  assert.equal(r.ventas, 2);
  assert.equal(r.cobrado_total, "$28.500");
  // ingreso sin envío 18.000 + 8.000 = 26.000; − 500 descuento − (10.955,74 + 4.000) costo = 10.544
  assert.equal(r.ganancia_antes_de_gastos_fijos, "$10.544");
  assert.equal(r.gastos_fijos_que_corresponden, "$175"); // 3 productos × 58,33
  assert.equal(r.por_producto[0].producto, "Lomito completo");
  const mal = await ejecutarHerramienta("ventas_del_periodo", { desde: "ayer", hasta: "hoy" }, { estado: estado(), leerVentas: async () => [] });
  assert.match(mal.error, /AAAA-MM-DD/);
  assert.equal(resumirVentas([], "a", "b").por_producto, "No hubo ventas en ese período.");
});

test("las instrucciones dicen la fecha de Argentina", () => {
  // 02:00 UTC del 24 es todavía el 23 en Argentina.
  const t = instrucciones("Venutto", "DATOS", new Date("2026-10-24T02:00:00Z"));
  assert.match(t, /Hoy es viernes 2026-10-23/);
  assert.match(t, /"Venutto"/);
});

// ---------- La función completa, con Supabase y Groq simulados ----------
test("función: lee solo el negocio del usuario, pide la cuenta y devuelve la respuesta", async () => {
  process.env.SUPABASE_URL = "https://sb.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "srv";
  process.env.GROQ_API_KEY = "gk";
  const pedidosSb = [], pedidosGroq = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    const resp = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (u.startsWith("https://sb.test/auth/v1/user")) return init.headers.Authorization === "Bearer buen-token" ? resp(200, { id: "u1" }) : resp(401, {});
    if (u.startsWith("https://sb.test/rest/v1/")) {
      pedidosSb.push(u);
      if (u.includes("/negocios?")) return resp(200, [{ id: "n1", nombre: "Venutto", prueba_hasta: "2020-01-01", suscripcion_estado: "authorized" }]);
      const t = u.match(/rest\/v1\/(\w+)\?/)[1];
      return resp(200, Object.entries(datos[t] || {}).map(([id, d]) => ({ id, datos: d })));
    }
    if (u.startsWith("https://api.groq.com/")) {
      const body = JSON.parse(init.body);
      pedidosGroq.push(body);
      if (pedidosGroq.length === 1) {
        return resp(200, { choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: "c1", type: "function", function: { name: "simular_precios_insumos", arguments: '{"cambios":[{"insumo":"Lomo","porcentaje":15}]}' } }] } }] });
      }
      return resp(200, { choices: [{ message: { role: "assistant", content: "El lomito completo te sube $639." } }] });
    }
    throw new Error("fetch no esperado: " + u);
  };
  try {
    const { default: handler } = await import("../netlify/functions/asistente.mjs");
    const llamar = (token, body) => handler(new Request("https://x/.netlify/functions/asistente", { method: "POST", headers: { authorization: "Bearer " + token }, body: JSON.stringify(body) }));

    assert.equal((await llamar("malo", { pregunta: "hola" })).status, 401);

    const r = await llamar("buen-token", { pregunta: "Si la carne sube 15%?", historial: [{ rol: "usuario", texto: "hola" }, { rol: "asistente", texto: "¡Hola!" }, { rol: "sistema", texto: "ignorame" }] });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { respuesta: "El lomito completo te sube $639." });
    // Cada tabla se pide filtrada por el negocio del usuario.
    for (const t of ["insumos", "productos", "gastos", "ajustes"]) assert.ok(pedidosSb.some((u) => u.includes("/" + t + "?") && u.includes("negocio_id=eq.n1")), t);
    assert.ok(pedidosSb[0].includes("owner_id=eq.u1"));
    const primero = pedidosGroq[0];
    assert.equal(primero.model, "openai/gpt-oss-120b");
    assert.equal(primero.messages[0].role, "system");
    assert.match(primero.messages[0].content, /Lomito completo/);
    assert.deepEqual(primero.messages.slice(1).map((m) => m.role), ["user", "assistant", "user"]);
    // La segunda vuelta lleva el resultado de la cuenta.
    const tool = pedidosGroq[1].messages.find((m) => m.role === "tool");
    assert.match(tool.content, /"sube":"\$639"/);
  } finally {
    globalThis.fetch = original;
  }
});

test("función: si el modelo principal falla, usa el de respaldo; si fallan los dos, devuelve el detalle", async () => {
  process.env.SUPABASE_URL = "https://sb.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "srv";
  process.env.GROQ_API_KEY = "gk";
  const modelos = [];
  let fallarTodo = false;
  const original = globalThis.fetch;
  const resp = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.includes("/auth/v1/user")) return resp(200, { id: "u1" });
    if (u.includes("/negocios?")) return resp(200, [{ id: "n1", nombre: "Venutto", prueba_hasta: "2020-01-01", suscripcion_estado: "authorized" }]);
    if (u.includes("/rest/v1/")) return resp(200, []);
    const m = JSON.parse(init.body).model;
    modelos.push(m);
    if (fallarTodo || m === "openai/gpt-oss-120b") return resp(413, { error: { message: "Request too large", code: "rate_limit_exceeded" } });
    return resp(200, { choices: [{ message: { role: "assistant", content: "Hola" } }] });
  };
  try {
    const { default: handler } = await import("../netlify/functions/asistente.mjs");
    const llamar = () => handler(new Request("https://x/", { method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ pregunta: "hola" }) }));
    const r = await llamar();
    assert.deepEqual(await r.json(), { respuesta: "Hola" });
    assert.deepEqual(modelos, ["openai/gpt-oss-120b", "llama-3.3-70b-versatile"]);
    fallarTodo = true;
    const r2 = await llamar();
    assert.equal(r2.status, 500);
    assert.match((await r2.json()).detalle, /Groq 413 \(openai\/gpt-oss-120b\).*Groq 413 \(llama-3.3-70b-versatile\)/);
  } finally {
    globalThis.fetch = original;
  }
});
