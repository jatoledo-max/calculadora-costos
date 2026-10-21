// Webhook de WhatsApp (Meta). Se configura en developers.facebook.com > tu app > WhatsApp > Configuración:
//   URL de devolución de llamada: https://<tu sitio>/.netlify/functions/whatsapp
//   Token de verificación: el mismo texto que WA_VERIFY_TOKEN
//   Campos: messages (y smb_message_echoes si el número también se usa en la app WhatsApp Business)
// Meta quiere una respuesta rápida: acá solo se comprueba que el aviso es de Meta y se le pasa a
// whatsapp-procesar-background, que tiene hasta 15 minutos para transcribir audios y pensar la respuesta.
import { env, json } from "../lib/comun.mjs";
import { firmaMetaValida } from "../lib/whatsapp.mjs";

export default async (req) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    // Meta comprueba la URL una vez, al configurar el webhook.
    const ok = url.searchParams.get("hub.mode") === "subscribe" && url.searchParams.get("hub.verify_token") === env("WA_VERIFY_TOKEN");
    return ok ? new Response(url.searchParams.get("hub.challenge") || "", { status: 200 }) : new Response("No", { status: 403 });
  }
  if (req.method !== "POST") return json(405, { error: "Usá POST" });

  const cuerpo = await req.text();
  const firma = req.headers.get("x-hub-signature-256");
  if (!firmaMetaValida(cuerpo, firma)) return json(401, { error: "Firma inválida" });

  const sitio = process.env.URL || url.origin;
  try {
    const r = await fetch(sitio + "/.netlify/functions/whatsapp-procesar-background", {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": firma },
      body: cuerpo,
    });
    if (r.status !== 202 && !r.ok) throw new Error("Procesar respondió " + r.status);
  } catch (e) {
    console.error(e);
    return json(500, { error: "No se pudo procesar" }); // Meta reintenta
  }
  return json(200, { ok: true });
};
