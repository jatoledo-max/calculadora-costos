// Traducciones entre los mensajes del bot (Baileys, como WhatsApp Web) y la forma que usa el asistente
// (la de la API de Meta). Sin dependencias, así se prueba desde tests/ sin instalar nada.

const PN = "@s.whatsapp.net"; // cuenta identificada por número de teléfono
const LID = "@lid";           // cuenta con el número oculto (WhatsApp lo usa cada vez más)

export const esCharlaPrivada = (jid) => typeof jid === "string" && (jid.endsWith(PN) || jid.endsWith(LID));

// El "teléfono" con el que se guarda la charla: el número si WhatsApp lo da; si no, el identificador oculto entero.
export function telDe(key) {
  const pn = [key.remoteJidAlt, key.remoteJid].find((j) => typeof j === "string" && j.endsWith(PN));
  if (pn) return pn.split("@")[0].split(":")[0];
  return key.remoteJid;
}
// Y al revés, para mandarle un aviso de estado (Aceptado, En camino) a esa charla.
export const jidDe = (tel) => (/^\d+$/.test(tel) ? tel + PN : tel);

// Saca el contenido de los "envoltorios" (mensajes temporales, ver una vez, etc.).
function desenvolver(m) {
  for (let i = 0; i < 5 && m; i++) {
    const w = m.ephemeralMessage || m.viewOnceMessage || m.viewOnceMessageV2 || m.viewOnceMessageV2Extension || m.documentWithCaptionMessage || m.editedMessage;
    if (!w) break;
    m = w.message;
  }
  return m;
}

// Mensaje de Baileys → { id, from, type, ... } como los manda Meta. null = no hay nada que contestar.
export function aMeta(msg, tel) {
  const m = desenvolver(msg.message);
  if (!m) return null;
  const base = { id: "bl:" + msg.key.id, from: tel };
  const texto = m.conversation || (m.extendedTextMessage && m.extendedTextMessage.text);
  if (texto) return { ...base, type: "text", text: { body: texto } };
  if (m.audioMessage) return { ...base, type: "audio", audio: { id: msg.key.id, mime_type: m.audioMessage.mimetype || "audio/ogg" } };
  if (m.locationMessage || m.liveLocationMessage) {
    const l = m.locationMessage || m.liveLocationMessage;
    return { ...base, type: "location", location: { latitude: l.degreesLatitude, longitude: l.degreesLongitude, name: l.name || null, address: l.address || null } };
  }
  if (m.imageMessage) return { ...base, type: "image", image: { caption: m.imageMessage.caption || "" } };
  if (m.buttonsResponseMessage) return { ...base, type: "button", button: { text: m.buttonsResponseMessage.selectedDisplayText || "" } };
  if (m.listResponseMessage) return { ...base, type: "text", text: { body: m.listResponseMessage.title || "" } };
  if (m.stickerMessage) return { ...base, type: "sticker" };
  if (m.reactionMessage || m.protocolMessage || m.senderKeyDistributionMessage || m.pollUpdateMessage) return null;
  if (m.videoMessage) return { ...base, type: "video" };
  if (m.documentMessage) return { ...base, type: "document" };
  if (m.contactMessage || m.contactsArrayMessage) return { ...base, type: "contacts" };
  return null;
}

// Pausa antes de responder, con "escribiendo…": más larga cuanto más largo el mensaje (entre 1,5 y 3 segundos).
export const demora = (texto) => 1500 + Math.min(1500, String(texto || "").length * 12);
