// El webhook de WhatsApp de punta a punta, con Meta, Google y Supabase de mentira (se reemplaza fetch).
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

Object.assign(process.env, {
  WA_APP_SECRET: "secreto", WA_TOKEN: "tok", WA_PHONE_NUMBER_ID: "123", WA_VERIFY_TOKEN: "palabra", WA_SLUG: "venutto",
  GEMINI_API_KEY: "g", SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "srk", URL: "https://sitio.test", WA_ESPERA_MS: "5",
  GEMINI_ESPERAS_MS: "1,1",
});
const { default: procesar } = await import("../netlify/functions/whatsapp-procesar-background.mjs");
const { default: webhook } = await import("../netlify/functions/whatsapp.mjs");

const firmar = (cuerpo, secreto = "secreto") => "sha256=" + crypto.createHmac("sha256", secreto).update(cuerpo).digest("hex");
const respuesta = (status, body) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Un "internet" de mentira que anota todo lo que se pidió.
function simular({ activo = true, horarios = null, iaResponde = "¡Hola! ¿Qué te preparo?" } = {}) {
  const s = { enviados: [], parches: [], vistos: new Set(), pendientes: [], llamadasIA: 0, llamadas: [] };
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url), metodo = init.method || "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    s.llamadas.push(metodo + " " + u);
    if (u.startsWith("https://graph.facebook.com/")) {
      if (body && body.status === "read") return respuesta(200, { success: true });
      s.enviados.push(body);
      return respuesta(200, { messages: [{ id: "wamid.salida" }] });
    }
    if (u.startsWith("https://generativelanguage.googleapis.com/")) {
      s.llamadasIA++;
      return respuesta(200, { candidates: [{ content: { role: "model", parts: [{ text: iaResponde }] } }] });
    }
    if (u === "https://db.test/rest/v1/rpc/wa_contexto") {
      return respuesta(200, { negocio_id: "neg-1", activo, publico: { negocio: { nombre: "Venutto" }, menu: { horarios, pagos: ["efectivo"] }, productos: [] } });
    }
    if (u === "https://db.test/rest/v1/wa_mensajes") {
      if (s.vistos.has(body.id)) return respuesta(201, []);
      s.vistos.add(body.id);
      return respuesta(201, [body]);
    }
    if (u.startsWith("https://db.test/rest/v1/wa_charlas") && metodo === "GET") return respuesta(200, []);
    if (u.startsWith("https://db.test/rest/v1/wa_charlas")) { s.parches.push({ metodo, body }); return respuesta(204); }
    if (u === "https://db.test/rest/v1/rpc/wa_encolar") { s.pendientes.push({ id: body.p_id, texto: body.p_texto }); return respuesta(204); }
    if (u === "https://db.test/rest/v1/rpc/wa_tomar") {
      if (!s.pendientes.length || s.pendientes[s.pendientes.length - 1].id !== body.p_id) return new Response("null", { status: 200 }); // así responde PostgREST cuando la función devuelve null
      const pendientes = s.pendientes.splice(0);
      return respuesta(200, { telefono: body.p_telefono, nombre: "Marta", historial: [], historial_en: null, ubicacion: null, pendientes });
    }
    if (u === "https://db.test/rest/v1/rpc/wa_soltar") {
      if (!s.pendientes.length) return new Response("null", { status: 200 });
      return respuesta(200, { telefono: body.p_telefono, nombre: "Marta", historial: [], historial_en: null, ubicacion: null, pendientes: s.pendientes.splice(0) });
    }
    throw new Error("Pedido inesperado: " + metodo + " " + u);
  };
  return s;
}

const aviso = (mensajes) => JSON.stringify({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: {
  metadata: { phone_number_id: "123" }, contacts: [{ wa_id: "5493850000001", profile: { name: "Marta" } }], messages: mensajes } }] }] });
const texto = (id, t) => ({ id, from: "5493850000001", type: "text", text: { body: t } });
const llamar = (cuerpo, firma = firmar(cuerpo)) =>
  procesar(new Request("https://sitio.test/.netlify/functions/whatsapp-procesar-background", { method: "POST", headers: { "x-hub-signature-256": firma }, body: cuerpo }));

test("contesta con la IA y no repite si Meta manda el mismo mensaje dos veces", async () => {
  const s = simular();
  const cuerpo = aviso([texto("m1", "hola")]);
  await llamar(cuerpo);
  await llamar(cuerpo);
  assert.equal(s.enviados.length, 1);
  assert.deepEqual(s.enviados[0], { messaging_product: "whatsapp", to: "5493850000001", type: "text", text: { body: "¡Hola! ¿Qué te preparo?", preview_url: false } });
  assert.equal(s.llamadasIA, 1);
  const guardado = s.parches.find((p) => p.body.historial);
  assert.equal(guardado.body.historial[0].parts[0].text, "hola");
});

test("varios mensajes seguidos se contestan juntos, una sola vez", async () => {
  const s = simular();
  await llamar(aviso([texto("m2", "hola"), texto("m3", "quiero 2 lomitos")]));
  assert.equal(s.enviados.length, 1);
  assert.equal(s.llamadasIA, 1);
  assert.equal(s.parches.find((p) => p.body.historial).body.historial[0].parts[0].text, "hola\nquiero 2 lomitos");
});

test("fuera de horario solo avisa que está cerrado, sin gastar IA", async () => {
  const hoyAr = new Date(Date.now() - 3 * 3600000).getUTCDay();
  const s = simular({ horarios: { dias: [(hoyAr + 3) % 7], desde: "10:00", hasta: "11:00" } });
  await llamar(aviso([texto("m4", "hola, ¿están?")]));
  assert.equal(s.llamadasIA, 0);
  assert.equal(s.enviados.length, 1);
  assert.match(s.enviados[0].text.body, /estamos cerrados/);
  assert.ok(s.parches.some((p) => p.body.cerrado_avisado_en));
});

test("con el asistente apagado o con una firma falsa no contesta nada", async () => {
  let s = simular({ activo: false });
  await llamar(aviso([texto("m5", "hola")]));
  assert.equal(s.enviados.length, 0);
  s = simular();
  const cuerpo = aviso([texto("m6", "hola")]);
  await llamar(cuerpo, firmar(cuerpo, "otro"));
  assert.equal(s.llamadas.length, 0);
});

test("si el dueño contesta desde la app, el asistente se corre de esa charla", async () => {
  const s = simular();
  const cuerpo = JSON.stringify({ entry: [{ changes: [{ field: "smb_message_echoes", value: { metadata: { phone_number_id: "123" }, message_echoes: [{ to: "5493850000001" }] } }] }] });
  await llamar(cuerpo);
  assert.equal(s.parches.length, 1);
  assert.ok(new Date(s.parches[0].body.pausada_hasta) > new Date(Date.now() + 2 * 3600000));
});

test("si la IA falla, pide disculpas y le pasa la charla al dueño", async () => {
  const s = simular();
  const original = globalThis.fetch;
  globalThis.fetch = (u, i) => (String(u).includes("generativelanguage") ? Promise.resolve(respuesta(500, { error: "caído" })) : original(u, i));
  await llamar(aviso([texto("m7", "hola")]));
  assert.match(s.enviados[0].text.body, /Perdón/);
  assert.ok(s.parches.some((p) => p.body.necesita_humano));
});

test("si Google está saturado, reintenta y después prueba con el modelo liviano", async () => {
  const s = simular();
  const original = globalThis.fetch;
  const modelos = [];
  globalThis.fetch = (u, i) => {
    const url = String(u);
    if (!url.includes("generativelanguage")) return original(u, i);
    modelos.push(url.split("/models/")[1].split(":")[0]);
    if (modelos.length <= 3) return Promise.resolve(respuesta(503, { error: { code: 503, message: "high demand" } }));
    return Promise.resolve(respuesta(200, { candidates: [{ content: { role: "model", parts: [{ text: "¡Hola! Sí, tenemos." }] } }] }));
  };
  await llamar(aviso([texto("m8", "venden sanguchitos de miga?")]));
  assert.deepEqual(modelos, ["gemini-flash-latest", "gemini-flash-latest", "gemini-flash-latest", "gemini-flash-lite-latest"]);
  assert.equal(s.enviados[0].text.body, "¡Hola! Sí, tenemos.");
});

test("un error que no es pasajero (clave mala) no se reintenta", async () => {
  const s = simular();
  const original = globalThis.fetch;
  let llamadas = 0;
  globalThis.fetch = (u, i) => (String(u).includes("generativelanguage") ? (llamadas++, Promise.resolve(respuesta(400, { error: "clave" }))) : original(u, i));
  await llamar(aviso([texto("m9", "hola")]));
  assert.equal(llamadas, 1);
  assert.match(s.enviados[0].text.body, /Perdón/);
});

test("si el cliente escribe mientras la IA piensa, contesta después y no dos respuestas a la vez", async () => {
  const s = simular();
  const original = globalThis.fetch;
  let enCurso = 0, maximo = 0, vuelta = 0;
  globalThis.fetch = async (u, i) => {
    if (!String(u).includes("generativelanguage")) return original(u, i);
    enCurso++; maximo = Math.max(maximo, enCurso);
    vuelta++;
    if (vuelta === 1) s.pendientes.push({ id: "m11", texto: "y??" }); // llegó mientras pensaba
    const pedido = JSON.parse(i.body);
    const ultimo = pedido.contents[pedido.contents.length - 1].parts[0].text;
    await new Promise((r) => setTimeout(r, 5));
    enCurso--;
    return respuesta(200, { candidates: [{ content: { role: "model", parts: [{ text: "Respuesta a: " + ultimo }] } }] });
  };
  await llamar(aviso([texto("m10", "si por favor")]));
  assert.equal(maximo, 1);
  assert.deepEqual(s.enviados.map((e) => e.text.body), ["Respuesta a: si por favor", "Respuesta a: y??"]);
});

test("le pide a Gemini que piense poco (más rápido); si el modelo no lo acepta, pregunta sin eso", async () => {
  const s = simular();
  const original = globalThis.fetch;
  const configs = [];
  globalThis.fetch = (u, i) => {
    if (!String(u).includes("generativelanguage")) return original(u, i);
    const cfg = JSON.parse(i.body).generationConfig;
    configs.push(cfg.thinkingConfig || null);
    if (cfg.thinkingConfig) return Promise.resolve(respuesta(400, { error: { message: "thinking_level is not supported for this model" } }));
    return Promise.resolve(respuesta(200, { candidates: [{ content: { role: "model", parts: [{ text: "¡Hola!" }] } }] }));
  };
  await llamar(aviso([texto("m12", "hola")]));
  assert.deepEqual(configs, [{ thinkingLevel: "low" }, null]);
  assert.equal(s.enviados[0].text.body, "¡Hola!");
});

test("webhook: Meta verifica la URL y los avisos firmados pasan a procesarse", async () => {
  let r = await webhook(new Request("https://sitio.test/.netlify/functions/whatsapp?hub.mode=subscribe&hub.verify_token=palabra&hub.challenge=42"));
  assert.equal(await r.text(), "42");
  r = await webhook(new Request("https://sitio.test/.netlify/functions/whatsapp?hub.mode=subscribe&hub.verify_token=mal&hub.challenge=42"));
  assert.equal(r.status, 403);

  const reenvios = [];
  globalThis.fetch = async (url, init) => { reenvios.push({ url: String(url), firma: init.headers["x-hub-signature-256"] }); return new Response(null, { status: 202 }); };
  const cuerpo = aviso([texto("m8", "hola")]);
  r = await webhook(new Request("https://sitio.test/.netlify/functions/whatsapp", { method: "POST", headers: { "x-hub-signature-256": firmar(cuerpo) }, body: cuerpo }));
  assert.equal(r.status, 200);
  assert.deepEqual(reenvios, [{ url: "https://sitio.test/.netlify/functions/whatsapp-procesar-background", firma: firmar(cuerpo) }]);
  r = await webhook(new Request("https://sitio.test/.netlify/functions/whatsapp", { method: "POST", headers: { "x-hub-signature-256": "sha256=00" }, body: cuerpo }));
  assert.equal(r.status, 401);
});
