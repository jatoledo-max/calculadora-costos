// El navegador llama acá cuando el negocio toca "Suscribirme".
// Crea una suscripción mensual en Mercado Pago y devuelve el link de pago.
import { env, json, supabaseAdmin, usuarioDelToken, mercadoPago } from "../lib/comun.mjs";

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Usá POST" });
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const user = await usuarioDelToken(token);
    if (!user) return json(401, { error: "Iniciá sesión de nuevo." });

    const negs = await supabaseAdmin("/rest/v1/negocios?select=id,nombre&owner_id=eq." + encodeURIComponent(user.id));
    if (!negs.length) return json(404, { error: "No encontramos tu negocio." });

    const sitio = process.env.URL || new URL(req.url).origin;
    const sus = await mercadoPago("/preapproval", {
      method: "POST",
      body: JSON.stringify({
        reason: "CalculadoraDeGananciasMV - suscripción mensual",
        external_reference: negs[0].id,
        payer_email: user.email,
        back_url: sitio + "/?pago=ok",
        status: "pending",
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: Number(env("MP_PRECIO_MENSUAL")),
          currency_id: "ARS",
        },
      }),
    });
    await supabaseAdmin("/rest/v1/negocios?id=eq." + negs[0].id, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ mp_preapproval_id: sus.id }),
    });
    return json(200, { url: sus.init_point });
  } catch (e) {
    console.error(e);
    return json(500, { error: "No se pudo crear la suscripción." });
  }
};
