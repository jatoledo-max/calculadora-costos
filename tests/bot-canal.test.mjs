// Bot de la PC (bot-whatsapp/): cómo se traducen los mensajes de WhatsApp Web al formato del asistente,
// y que los avisos de estado queden en cola para el bot cuando no hay API de Meta.
import test from "node:test";
import assert from "node:assert/strict";
import { telDe, jidDe, aMeta, esCharlaPrivada, demora } from "../bot-whatsapp/canal.mjs";

test("número del cliente: el de teléfono si WhatsApp lo da; si no, el identificador oculto", () => {
  assert.equal(telDe({ remoteJid: "5493855111111@s.whatsapp.net" }), "5493855111111");
  assert.equal(telDe({ remoteJid: "123456789012345@lid", remoteJidAlt: "5493855111111@s.whatsapp.net" }), "5493855111111");
  assert.equal(telDe({ remoteJid: "123456789012345@lid" }), "123456789012345@lid");
  assert.equal(jidDe("5493855111111"), "5493855111111@s.whatsapp.net");
  assert.equal(jidDe("123456789012345@lid"), "123456789012345@lid");
  assert.equal(esCharlaPrivada("120363000000@g.us"), false); // grupos no
  assert.equal(esCharlaPrivada("status@broadcast"), false);
  assert.equal(esCharlaPrivada("123@lid"), true);
});

test("mensajes de WhatsApp Web → formato del asistente", () => {
  const k = { id: "ABC" };
  assert.deepEqual(aMeta({ key: k, message: { conversation: "hola" } }, "549"), { id: "bl:ABC", from: "549", type: "text", text: { body: "hola" } });
  assert.equal(aMeta({ key: k, message: { extendedTextMessage: { text: "2 lomitos" } } }, "549").text.body, "2 lomitos");
  assert.equal(aMeta({ key: k, message: { ephemeralMessage: { message: { conversation: "temporal" } } } }, "549").text.body, "temporal");
  assert.deepEqual(aMeta({ key: k, message: { audioMessage: { mimetype: "audio/ogg; codecs=opus" } } }, "549").audio, { id: "ABC", mime_type: "audio/ogg; codecs=opus" });
  assert.deepEqual(aMeta({ key: k, message: { locationMessage: { degreesLatitude: -27.7, degreesLongitude: -64.2, address: "Belgrano 100" } } }, "549").location,
    { latitude: -27.7, longitude: -64.2, name: null, address: "Belgrano 100" });
  assert.equal(aMeta({ key: k, message: { imageMessage: { caption: "comprobante" } } }, "549").image.caption, "comprobante");
  assert.equal(aMeta({ key: k, message: { reactionMessage: { text: "👍" } } }, "549"), null);
  assert.equal(aMeta({ key: k, message: { protocolMessage: {} } }, "549"), null);
  assert.equal(aMeta({ key: k, message: null }, "549"), null);
});

test("pausa de 'escribiendo…' entre 1,5 y 3 segundos", () => {
  assert.equal(demora(""), 1500);
  assert.equal(demora("x".repeat(50)), 2100);
  assert.equal(demora("x".repeat(5000)), 3000);
});

test("sin API de Meta, el aviso de estado queda en cola para el bot", async () => {
  Object.assign(process.env, { SUPABASE_URL: "https://db.test", SUPABASE_SERVICE_ROLE_KEY: "srk" });
  delete process.env.WA_TOKEN;
  const pedidos = [];
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.endsWith("/auth/v1/user")) return Response.json({ id: "u1" });
    if (u.includes("/rest/v1/negocios")) return Response.json([{ id: "neg-1" }]);
    if (u.endsWith("/rpc/wa_cambiar_estado")) return Response.json({ id: "p1", negocio_id: "neg-1", numero: 5, telefono: "5493855111111", total: 9000, entrega: "retiro", envio: null });
    if (u.endsWith("/rest/v1/wa_salida")) { pedidos.push(JSON.parse(init.body)); return new Response(null, { status: 201 }); }
    throw new Error("inesperado " + u);
  };
  const { default: estado } = await import("../netlify/functions/pedido-estado.mjs");
  const r = await estado(new Request("https://sitio.test/.netlify/functions/pedido-estado", {
    method: "POST", headers: { authorization: "Bearer t" }, body: JSON.stringify({ id: "p1", estado: "en_camino" }),
  }));
  assert.equal((await r.json()).avisado, "en_cola");
  assert.deepEqual(pedidos, [{ negocio_id: "neg-1", telefono: "5493855111111", texto: "🛍️ Tu pedido #5 está listo para retirar. ¡Te esperamos!" }]);
});
