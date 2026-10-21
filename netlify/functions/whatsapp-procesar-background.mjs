// Contesta los mensajes de WhatsApp con la IA. Lo llama whatsapp.mjs con el aviso de Meta tal cual
// (y su firma, que se vuelve a comprobar: nadie más puede hacer hablar al asistente).
// Es una función "background": Netlify responde enseguida y esto puede tardar (audios largos, varias vueltas de la IA).
import { env } from "../lib/comun.mjs";
import { firmaMetaValida, enviarTexto, marcarLeido, transcribir } from "../lib/whatsapp.mjs";
import { atender, pausarCharla, rpc } from "../lib/atencion.mjs";

export const config = { background: true };

const META = { enviar: enviarTexto, marcarLeido, transcribir };

export default async (req) => {
  const cuerpo = await req.text();
  if (!firmaMetaValida(cuerpo, req.headers.get("x-hub-signature-256"))) return;
  let aviso;
  try { aviso = JSON.parse(cuerpo); } catch (e) { return; }

  const slug = env("WA_SLUG");
  let ctx;
  try { ctx = await rpc("wa_contexto", { p_slug: slug }); } catch (e) { console.error(e); return; }
  if (!ctx) { console.warn("Menú no publicado o negocio inactivo: el asistente no contesta"); return; }

  const tareas = [];
  for (const entry of aviso.entry || []) {
    for (const ch of entry.changes || []) {
      const v = ch.value || {};
      if (v.metadata && v.metadata.phone_number_id && v.metadata.phone_number_id !== env("WA_PHONE_NUMBER_ID")) continue;
      if (ch.field === "smb_message_echoes") {
        // El dueño contestó desde la app de WhatsApp Business: el asistente se corre de esa charla por un rato.
        for (const eco of v.message_echoes || []) {
          if (eco.to) tareas.push(pausarCharla(ctx.negocio_id, eco.to).catch((e) => console.error(e)));
        }
      } else if (ch.field === "messages") {
        const nombres = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile && c.profile.name]));
        for (const m of v.messages || []) tareas.push(atender(ctx, slug, m, nombres[m.from] || null, META));
      }
    }
  }
  await Promise.all(tareas);
};
