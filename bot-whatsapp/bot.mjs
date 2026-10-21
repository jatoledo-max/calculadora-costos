// Asistente de WhatsApp que corre en la PC del negocio, conectado como un dispositivo vinculado
// (igual que WhatsApp Web). No usa la API de Meta: se escanea un QR una vez y queda la sesión guardada.
// Atiende igual que el asistente de Meta (netlify/lib/atencion.mjs): IA, audios, precios de la base, pedidos.
// Además manda los avisos que el dueño dispara desde la pestaña Pedidos (Aceptado, En camino...).
//
// Para no parecer un robot: solo contesta cuando le escriben, muestra "escribiendo…" antes de cada respuesta
// y nunca manda mensajes a quien no le escribió (los avisos de estado son a clientes con pedido hecho).
//
// Uso: ver LEEME.md. Necesita .env con SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GEMINI_API_KEY y WA_SLUG.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage, Browsers } from "baileys";
import pino from "pino";
import qrcode from "qrcode-terminal";
import { atender, pausarCharla, rpc, salidaPendiente, marcarSalida } from "../netlify/lib/atencion.mjs";
import { transcribirAudio } from "../netlify/lib/whatsapp.mjs";
import { esCharlaPrivada, telDe, jidDe, aMeta, demora } from "./canal.mjs";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SESION = path.join(DIR, "sesion");
const SLUG = process.env.WA_SLUG;
for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "GEMINI_API_KEY", "WA_SLUG"]) {
  if (!process.env[k]) { console.error("Falta " + k + " en el archivo .env (mirá LEEME.md)."); process.exit(2); }
}
const log = pino({ level: process.env.LOG || "warn" });
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
const hora = () => new Date().toLocaleTimeString("es-AR", { hour12: false });

let sock = null, conectado = false;
const enviados = new Set(); // ids de lo que mandó el bot: así se distingue de lo que escribe el dueño desde el celular
const recordar = (id) => { enviados.add(id); if (enviados.size > 2000) enviados.delete(enviados.values().next().value); };

// El menú y si el asistente está encendido se leen de la base, con un minuto de memoria.
let ctx = { valor: null, hasta: 0 };
async function contexto() {
  if (Date.now() < ctx.hasta) return ctx.valor;
  const valor = await rpc("wa_contexto", { p_slug: SLUG });
  if (!valor) console.warn(hora(), "El menú no está publicado o la cuenta no está activa: el asistente no contesta.");
  ctx = { valor, hasta: Date.now() + 60000 };
  return valor;
}

async function enviarA(jid, texto) {
  if (!sock || !conectado) throw new Error("WhatsApp desconectado");
  try {
    await sock.presenceSubscribe(jid);
    await sock.sendPresenceUpdate("composing", jid);
    await dormir(demora(texto));
    await sock.sendPresenceUpdate("paused", jid);
  } catch (e) { /* el "escribiendo…" es un detalle: si falla, se manda igual */ }
  const r = await sock.sendMessage(jid, { text: texto });
  if (r && r.key) recordar(r.key.id);
}

async function manejar(msg) {
  const jid = msg.key.remoteJid;
  if (!esCharlaPrivada(jid) || !msg.message) return; // grupos, estados y canales no
  const tel = telDe(msg.key);
  const m = aMeta(msg, tel);
  if (!m) return;
  const c = await contexto();
  if (!c) return;

  if (msg.key.fromMe) {
    // Lo escribió el dueño desde su celular: el asistente se corre de esa charla por 3 horas.
    if (enviados.has(msg.key.id)) return;
    await pausarCharla(c.negocio_id, tel);
    console.log(hora(), "Contestaste vos a", msg.pushName || tel, "→ el asistente no le responde por 3 horas.");
    return;
  }

  console.log(hora(), "Mensaje de", msg.pushName || tel, "(" + m.type + ")");
  await atender(c, SLUG, m, msg.pushName || null, {
    enviar: (_tel, texto) => enviarA(jid, texto),
    marcarLeido: () => sock.readMessages([msg.key]).catch(() => {}),
    async transcribir() {
      const buf = await downloadMediaMessage(msg, "buffer", {}, { logger: log, reuploadRequest: sock.updateMediaMessage });
      return transcribirAudio(buf.toString("base64"), m.audio.mime_type);
    },
  });
}

// Avisos de estado que el dueño tocó en la pestaña Pedidos.
async function mandarSalida() {
  if (!conectado) return;
  const c = await contexto();
  if (!c) return;
  for (const s of await salidaPendiente(c.negocio_id)) {
    try {
      await enviarA(jidDe(s.telefono), s.texto);
      await marcarSalida(s.id, { enviado: new Date().toISOString() });
      console.log(hora(), "Aviso enviado:", s.texto.split("\n")[0]);
    } catch (e) {
      await marcarSalida(s.id, { error: String(e.message || e).slice(0, 300) }).catch(() => {});
      console.error(hora(), "No se pudo mandar un aviso:", e.message);
    }
  }
}

async function conectar() {
  const { state, saveCreds } = await useMultiFileAuthState(SESION);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({}));
  sock = makeWASocket({
    auth: state, version, logger: log,
    browser: Browsers.windows("Venutto Asistente"),
    markOnlineOnConnect: false, // así al dueño le siguen llegando las notificaciones al celular
    syncFullHistory: false,
  });
  let codigoPedido = false;
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      const numero = (process.env.WA_NUMERO || "").replace(/\D/g, "");
      if (numero && !codigoPedido) {
        codigoPedido = true;
        const codigo = await sock.requestPairingCode(numero).catch((e) => { console.error(e.message); return null; });
        if (codigo) console.log("\nEn el celular: WhatsApp > Dispositivos vinculados > Vincular un dispositivo > Vincular con el número de teléfono.\nEscribí este código: " + codigo + "\n");
      } else if (!numero) {
        console.log("\nEn el celular: WhatsApp > Dispositivos vinculados > Vincular un dispositivo, y escaneá este código:\n");
        qrcode.generate(qr, { small: true });
      }
    }
    if (connection === "open") { conectado = true; console.log(hora(), "✅ Conectado. El asistente está atendiendo (dejá esta ventana abierta)."); }
    if (connection === "close") {
      conectado = false;
      const codigo = lastDisconnect && lastDisconnect.error && lastDisconnect.error.output && lastDisconnect.error.output.statusCode;
      if (codigo === DisconnectReason.loggedOut) {
        console.log(hora(), "Se desvinculó desde el celular. Se borra la sesión: al reiniciar te pide el código de nuevo.");
        fs.rmSync(SESION, { recursive: true, force: true });
        process.exit(1);
      }
      console.log(hora(), "Se cortó la conexión; reconectando…");
      setTimeout(() => conectar().catch((e) => { console.error(e); process.exit(1); }), 3000);
    }
  });
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return; // "append" = historial viejo al reconectar: no se contesta
    for (const msg of messages) manejar(msg).catch((e) => console.error(hora(), e.message || e));
  });
}

console.log("Asistente de WhatsApp de", SLUG, "— iniciando…");
await conectar();
setInterval(() => mandarSalida().catch((e) => console.error(hora(), e.message || e)), 5000);
