// Pruebas de la baja de la suscripción: hasta cuándo puede seguir usando la app, y las funciones de Netlify
// "cancelar-suscripcion" y "mp-webhook" con Supabase y Mercado Pago simulados. Correr con: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { pagadoHasta } from "../netlify/lib/comun.mjs";

const AHORA = new Date("2026-11-10T12:00:00Z");

test("al dar de baja, sigue hasta el próximo cobro solo si ya había pagado", () => {
  const sus = { next_payment_date: "2026-11-25T12:00:00Z" };
  assert.equal(pagadoHasta({ suscripcion_estado: "authorized", prueba_hasta: "2026-10-20" }, sus, AHORA), "2026-11-25T12:00:00.000Z");
  assert.equal(pagadoHasta({ suscripcion_estado: "pending", prueba_hasta: "2026-10-20" }, sus, AHORA), null, "nunca pagó");
  assert.equal(pagadoHasta({ suscripcion_estado: "authorized", prueba_hasta: "2026-12-01" }, sus, AHORA), null, "no acorta la prueba");
  assert.equal(pagadoHasta({ suscripcion_estado: "authorized" }, { next_payment_date: "2026-11-01" }, AHORA), null, "fecha pasada");
  assert.equal(pagadoHasta({ suscripcion_estado: "authorized" }, { next_payment_date: "2027-03-01" }, AHORA), null, "más de un mes");
  assert.equal(pagadoHasta({ suscripcion_estado: "authorized" }, {}, AHORA), null);
});

function simular(negocio, preapproval) {
  process.env.SUPABASE_URL = "https://sb.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "srv";
  process.env.MP_ACCESS_TOKEN = "mp";
  const pedidos = [];
  const original = globalThis.fetch;
  const resp = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), metodo = init.method || "GET";
    pedidos.push({ u, metodo, body: init.body ? JSON.parse(init.body) : null });
    if (u.includes("/auth/v1/user")) return init.headers.Authorization === "Bearer buen-token" ? resp(200, { id: "u1" }) : resp(401, {});
    if (u.includes("/negocios?") && metodo === "GET") return resp(200, negocio ? [negocio] : []);
    if (u.includes("/negocios?") && metodo === "PATCH") return new Response(null, { status: 204 });
    if (u.includes("api.mercadopago.com/preapproval/")) {
      if (metodo === "PUT") { preapproval.status = "cancelled"; return resp(200, preapproval); }
      return resp(200, structuredClone(preapproval));
    }
    return resp(404, {});
  };
  return { pedidos, restaurar: () => { globalThis.fetch = original; } };
}

test("cancelar-suscripcion: cancela en Mercado Pago y deja usar hasta el próximo cobro", async () => {
  const proximo = new Date(Date.now() + 12 * 86400000).toISOString();
  const neg = { id: "n1", prueba_hasta: "2026-01-01T00:00:00Z", suscripcion_estado: "authorized", mp_preapproval_id: "pre1" };
  const sim = simular(neg, { id: "pre1", status: "authorized", next_payment_date: proximo, external_reference: "n1" });
  try {
    const { default: handler } = await import("../netlify/functions/cancelar-suscripcion.mjs");
    const llamar = (token) => handler(new Request("https://x/", { method: "POST", headers: { authorization: "Bearer " + token } }));

    assert.equal((await llamar("malo")).status, 401);
    const r = await llamar("buen-token");
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.equal(j.negocio.suscripcion_estado, "cancelled");
    assert.equal(j.negocio.prueba_hasta, proximo);
    const put = sim.pedidos.find((p) => p.metodo === "PUT");
    assert.ok(put && put.u.endsWith("/preapproval/pre1"));
    assert.deepEqual(put.body, { status: "cancelled" });
    const patch = sim.pedidos.find((p) => p.metodo === "PATCH");
    assert.ok(patch.u.includes("negocios?id=eq.n1"));
    assert.deepEqual(patch.body, { suscripcion_estado: "cancelled", prueba_hasta: proximo });
  } finally {
    sim.restaurar();
  }
});

test("cancelar-suscripcion: sin suscripción avisa y no toca nada", async () => {
  const sim = simular({ id: "n1", prueba_hasta: "2026-01-01", suscripcion_estado: "sin_suscripcion", mp_preapproval_id: null }, {});
  try {
    const { default: handler } = await import("../netlify/functions/cancelar-suscripcion.mjs");
    const r = await handler(new Request("https://x/", { method: "POST", headers: { authorization: "Bearer buen-token" } }));
    assert.equal(r.status, 404);
    assert.ok(!sim.pedidos.some((p) => p.metodo === "PUT" || p.metodo === "PATCH"));
  } finally {
    sim.restaurar();
  }
});

test("mp-webhook: si la cancelan desde Mercado Pago, también sigue hasta el próximo cobro", async () => {
  const proximo = new Date(Date.now() + 5 * 86400000).toISOString();
  const sim = simular({ prueba_hasta: "2026-01-01T00:00:00Z", suscripcion_estado: "authorized" },
    { id: "pre1", status: "cancelled", next_payment_date: proximo, external_reference: "n1" });
  try {
    const { default: handler } = await import("../netlify/functions/mp-webhook.mjs");
    const r = await handler(new Request("https://x/", { method: "POST", body: JSON.stringify({ type: "subscription_preapproval", data: { id: "pre1" } }) }));
    assert.equal(r.status, 200);
    const patch = sim.pedidos.find((p) => p.metodo === "PATCH");
    assert.deepEqual(patch.body, { suscripcion_estado: "cancelled", mp_preapproval_id: "pre1", prueba_hasta: proximo });
  } finally {
    sim.restaurar();
  }
});

test("mp-webhook: una suscripción autorizada solo cambia el estado", async () => {
  const sim = simular(null, { id: "pre1", status: "authorized", next_payment_date: "2026-12-01", external_reference: "n1" });
  try {
    const { default: handler } = await import("../netlify/functions/mp-webhook.mjs");
    await handler(new Request("https://x/", { method: "POST", body: JSON.stringify({ type: "subscription_preapproval", data: { id: "pre1" } }) }));
    const patch = sim.pedidos.find((p) => p.metodo === "PATCH");
    assert.deepEqual(patch.body, { suscripcion_estado: "authorized", mp_preapproval_id: "pre1" });
  } finally {
    sim.restaurar();
  }
});
