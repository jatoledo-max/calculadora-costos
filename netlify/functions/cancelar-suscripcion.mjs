// El navegador llama acá cuando el negocio toca "Dar de baja la suscripción" (Mi negocio).
// Cancela la suscripción en Mercado Pago (no se cobra más) y deja usar la app hasta el final del mes ya pagado.
import { json, supabaseAdmin, usuarioDelToken, mercadoPago, pagadoHasta } from "../lib/comun.mjs";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Usá POST" });
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const user = await usuarioDelToken(token);
    if (!user) return json(401, { error: "Iniciá sesión de nuevo." });

    const negs = await supabaseAdmin("/rest/v1/negocios?select=id,prueba_hasta,suscripcion_estado,mp_preapproval_id&owner_id=eq." + encodeURIComponent(user.id));
    const neg = negs[0];
    if (!neg || !neg.mp_preapproval_id) return json(404, { error: "No encontramos una suscripción para dar de baja." });

    const antes = await mercadoPago("/preapproval/" + encodeURIComponent(neg.mp_preapproval_id));
    if (antes.status !== "cancelled") {
      await mercadoPago("/preapproval/" + encodeURIComponent(neg.mp_preapproval_id), { method: "PUT", body: JSON.stringify({ status: "cancelled" }) });
    }
    const cambios = { suscripcion_estado: "cancelled" };
    const hasta = pagadoHasta(neg, antes);
    if (hasta) cambios.prueba_hasta = hasta;
    await supabaseAdmin("/rest/v1/negocios?id=eq." + neg.id, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(cambios),
    });
    return json(200, { ok: true, negocio: Object.assign({ prueba_hasta: neg.prueba_hasta }, cambios) });
  } catch (e) {
    console.error(e);
    return json(500, { error: "No se pudo dar de baja." });
  }
};
