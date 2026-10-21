// La pestaña Pedidos llama acá cuando el dueño toca Aceptar, En preparación, En camino, Entregado o Rechazar.
// Cambia el estado en la base y le avisa al cliente por WhatsApp: directo por la API de Meta si está configurada
// (WA_TOKEN), o dejando el mensaje en wa_salida para que lo mande el bot de la PC (bot-whatsapp/).
import { json, supabaseAdmin, usuarioDelToken } from "../lib/comun.mjs";
import { enviarTexto } from "../lib/whatsapp.mjs";
import { mensajeEstado, ESTADOS } from "../lib/asistente.mjs";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Usá POST" });
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const user = await usuarioDelToken(token);
  if (!user) return json(401, { error: "Iniciá sesión de nuevo." });

  const b = await req.json().catch(() => ({}));
  if (!b.id || !ESTADOS[b.estado] || b.estado === "nuevo") return json(400, { error: "Pedido o estado inválido." });

  let pedido;
  try {
    const negs = await supabaseAdmin("/rest/v1/negocios?select=id&owner_id=eq." + encodeURIComponent(user.id));
    if (!negs.length) return json(404, { error: "No encontramos tu negocio." });
    pedido = await supabaseAdmin("/rest/v1/rpc/wa_cambiar_estado", {
      method: "POST",
      body: JSON.stringify({ p_id: b.id, p_negocio: negs[0].id, p_estado: b.estado, p_motivo: b.motivo || null }),
    });
  } catch (e) {
    const m = /"message"\s*:\s*"([^"]+)"/.exec(e.message || "");
    return json(400, { error: m ? m[1] : "No se pudo cambiar el estado." });
  }

  const texto = mensajeEstado(pedido, b.estado, b.motivo);
  let avisado = null;
  if (texto && process.env.WA_TOKEN) {
    try { await enviarTexto(pedido.telefono, texto); avisado = true; } catch (e) { console.error(e); avisado = false; }
  } else if (texto) {
    try {
      await supabaseAdmin("/rest/v1/wa_salida", {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ negocio_id: pedido.negocio_id, telefono: pedido.telefono, texto }),
      });
      avisado = "en_cola";
    } catch (e) { console.error(e); avisado = false; }
  }
  return json(200, { pedido, avisado });
};
