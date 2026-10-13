// Mercado Pago avisa acá cada vez que una suscripción cambia (se autoriza, se pausa, se cancela).
// No confiamos en el contenido del aviso: con el id volvemos a pedir la suscripción a Mercado Pago
// y guardamos su estado en el negocio (external_reference = id del negocio).
import crypto from "node:crypto";
import { json, supabaseAdmin, mercadoPago } from "../lib/comun.mjs";

// Firma opcional: si configurás MP_WEBHOOK_SECRET (Mercado Pago > Tus integraciones > Webhooks), se verifica.
function firmaValida(req, dataId) {
  const secreto = process.env.MP_WEBHOOK_SECRET;
  if (!secreto) return true;
  const partes = Object.fromEntries((req.headers.get("x-signature") || "").split(",").map((p) => p.trim().split("=")));
  const manifiesto = `id:${String(dataId).toLowerCase()};request-id:${req.headers.get("x-request-id") || ""};ts:${partes.ts};`;
  const esperado = crypto.createHmac("sha256", secreto).update(manifiesto).digest("hex");
  return !!partes.v1 && partes.v1.length === esperado.length && crypto.timingSafeEqual(Buffer.from(partes.v1), Buffer.from(esperado));
}

export default async (req) => {
  const url = new URL(req.url);
  const body = await req.json().catch(() => ({}));
  const tipo = body.type || url.searchParams.get("type") || url.searchParams.get("topic") || "";
  const id = (body.data && body.data.id) || url.searchParams.get("data.id") || url.searchParams.get("id");
  if (!tipo.includes("preapproval") || !id) return json(200, { ignorado: true });
  if (!firmaValida(req, id)) return json(401, { error: "Firma inválida" });

  try {
    const sus = await mercadoPago("/preapproval/" + encodeURIComponent(id));
    if (!sus.external_reference) return json(200, { ignorado: true });
    await supabaseAdmin("/rest/v1/negocios?id=eq." + encodeURIComponent(sus.external_reference), {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ suscripcion_estado: sus.status, mp_preapproval_id: sus.id }),
    });
    return json(200, { ok: true });
  } catch (e) {
    console.error(e);
    return json(500, { error: "No se pudo procesar" }); // Mercado Pago reintenta
  }
};
