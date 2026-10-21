// WhatsApp (API oficial de Meta) y la IA de Google (Gemini). Solo fetch, sin dependencias.
// Variables de entorno (Netlify > Site configuration > Environment variables):
//   WA_TOKEN            token de acceso de la app de Meta (WhatsApp > Configuración de la API)
//   WA_PHONE_NUMBER_ID  id del número que atiende el asistente (no es el número de teléfono)
//   WA_VERIFY_TOKEN     una palabra secreta inventada, la misma que se pone al configurar el webhook en Meta
//   WA_APP_SECRET       clave secreta de la app de Meta (Configuración de la app > Básica): verifica que el aviso es de Meta
//   WA_SLUG             la dirección del menú del negocio (Mi negocio > Menú de pedidos), ej "venutto"
//   GEMINI_API_KEY      clave de Google AI Studio
//   GEMINI_MODEL        opcional, por defecto gemini-flash-latest (el Flash más nuevo de Google)
//   GEMINI_PENSAR       opcional, cuánto "piensa" antes de contestar: minimal, low (por defecto), medium, high
import crypto from "node:crypto";
import { env } from "./comun.mjs";

const graph = () => "https://graph.facebook.com/" + (process.env.WA_GRAPH_VERSION || "v23.0");

export function firmaMetaValida(cuerpo, encabezado) {
  const esperado = "sha256=" + crypto.createHmac("sha256", env("WA_APP_SECRET")).update(cuerpo).digest("hex");
  const recibido = String(encabezado || "");
  return recibido.length === esperado.length && crypto.timingSafeEqual(Buffer.from(recibido), Buffer.from(esperado));
}

export async function enviarTexto(para, texto) {
  const r = await fetch(graph() + "/" + env("WA_PHONE_NUMBER_ID") + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + env("WA_TOKEN"), "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: para, type: "text", text: { body: texto.slice(0, 4000), preview_url: false } }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("WhatsApp " + r.status + ": " + JSON.stringify(body.error || body));
  return body;
}

// Marca el mensaje como leído (los dos tildes azules). Es gratis; si falla no importa.
export async function marcarLeido(mensajeId) {
  await fetch(graph() + "/" + env("WA_PHONE_NUMBER_ID") + "/messages", {
    method: "POST",
    headers: { Authorization: "Bearer " + env("WA_TOKEN"), "content-type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", status: "read", message_id: mensajeId }),
  }).catch(() => {});
}

// Baja un audio (o cualquier archivo) que mandó el cliente. Devuelve { base64, mime }.
export async function bajarMedia(mediaId) {
  const auth = { Authorization: "Bearer " + env("WA_TOKEN") };
  const r = await fetch(graph() + "/" + encodeURIComponent(mediaId), { headers: auth });
  const info = await r.json().catch(() => ({}));
  if (!r.ok || !info.url) throw new Error("No se pudo ubicar el audio");
  if (Number(info.file_size) > 15 * 1024 * 1024) throw new Error("Audio demasiado grande");
  const a = await fetch(info.url, { headers: auth });
  if (!a.ok) throw new Error("No se pudo bajar el audio");
  return { base64: Buffer.from(await a.arrayBuffer()).toString("base64"), mime: (info.mime_type || "audio/ogg").split(";")[0] };
}

const modelo = () => process.env.GEMINI_MODEL || "gemini-flash-latest";
const MODELO_RESPALDO = "gemini-flash-lite-latest";
// Errores pasajeros de Google ("el modelo está saturado", límite por minuto): se reintenta en vez de fallar.
const PASAJERO = new Set([429, 500, 502, 503, 504]);
const ESPERAS_MS = () => (process.env.GEMINI_ESPERAS_MS || "1500,4000").split(",").map(Number);
const dormir = (ms) => new Promise((res) => setTimeout(res, ms));

async function llamarGemini(nombre, body) {
  let r;
  try {
    r = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + nombre + ":generateContent", {
      method: "POST",
      headers: { "x-goog-api-key": env("GEMINI_API_KEY"), "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return { pasajero: true, error: new Error("Gemini sin conexión: " + e.message) };
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { pasajero: PASAJERO.has(r.status), error: new Error("Gemini " + r.status + ": " + JSON.stringify(j.error || j)) };
  const c = j.candidates && j.candidates[0];
  return { content: c && c.content };
}

// Los modelos nuevos "piensan" antes de contestar y eso tarda; para charlar con clientes alcanza con poco.
const conPocoPensar = (body) => ({
  ...body,
  generationConfig: { ...body.generationConfig, thinkingConfig: { thinkingLevel: process.env.GEMINI_PENSAR || "low" } },
});

// Si el modelo está saturado, espera y reintenta; si sigue igual, prueba con uno más liviano.
export async function gemini(body) {
  try {
    return await geminiConReintentos(conPocoPensar(body));
  } catch (e) {
    // Un modelo que no acepta ese ajuste: se pregunta igual, sin él.
    if (/^Gemini 400/.test(e.message) && /thinking/i.test(e.message)) return geminiConReintentos(body);
    throw e;
  }
}

async function geminiConReintentos(body) {
  const modelos = [modelo(), MODELO_RESPALDO].filter((m, i, a) => a.indexOf(m) === i);
  let ultimo;
  for (const nombre of modelos) {
    const esperas = nombre === modelos[0] ? ESPERAS_MS() : ESPERAS_MS().slice(0, 1);
    for (let i = 0; ; i++) {
      const r = await llamarGemini(nombre, body);
      if (!r.error) return r.content;
      ultimo = r.error;
      if (!r.pasajero) throw r.error;
      if (i >= esperas.length) break;
      console.warn("Gemini ocupado (" + nombre + "), reintentando…");
      await dormir(esperas[i]);
    }
  }
  throw ultimo;
}

export async function transcribir(mediaId) {
  const { base64, mime } = await bajarMedia(mediaId);
  return transcribirAudio(base64, mime);
}

// Pasa a texto un audio (en base64). Lo usan la API de Meta y el bot de la PC.
export async function transcribirAudio(base64, mime) {
  const content = await gemini({
    contents: [{ role: "user", parts: [
      { inlineData: { mimeType: (mime || "audio/ogg").split(";")[0], data: base64 } },
      { text: "Transcribí este audio de un cliente de una rotisería argentina, tal cual lo dice, en español. Solo el texto, sin comentarios. Si no se entiende nada, respondé: (no se entiende)" },
    ] }],
    generationConfig: { temperature: 0 },
  });
  return ((content && content.parts) || []).map((p) => p.text || "").join("").trim();
}
