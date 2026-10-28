// Ayudas compartidas por las funciones. Solo usan fetch: no hay dependencias que instalar.
const env = (k) => {
  const v = process.env[k];
  if (!v) throw new Error("Falta la variable de entorno " + k);
  return v;
};

export const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

// Llama a la API REST de Supabase con la service key (saltea RLS; usar solo en el servidor).
export async function supabaseAdmin(path, init = {}) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const r = await fetch(env("SUPABASE_URL") + path, {
    ...init,
    headers: { apikey: key, Authorization: "Bearer " + key, "content-type": "application/json", ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error("Supabase " + r.status + ": " + (await r.text()));
  return r.status === 204 ? null : r.json();
}

// Devuelve el usuario dueño del token que mandó el navegador, o null.
export async function usuarioDelToken(token) {
  if (!token) return null;
  const r = await fetch(env("SUPABASE_URL") + "/auth/v1/user", {
    headers: { apikey: env("SUPABASE_SERVICE_ROLE_KEY"), Authorization: "Bearer " + token },
  });
  return r.ok ? r.json() : null;
}

export async function mercadoPago(path, init = {}) {
  const r = await fetch("https://api.mercadopago.com" + path, {
    ...init,
    headers: { Authorization: "Bearer " + env("MP_ACCESS_TOKEN"), "content-type": "application/json", ...(init.headers || {}) },
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Mercado Pago " + r.status + ": " + JSON.stringify(body));
  return body;
}

export { env };

// Al cancelar o pausar una suscripción que estaba activa (ya pagó), el negocio sigue usando la app
// hasta la fecha del próximo cobro, que es hasta donde pagó. Usamos prueba_hasta para eso.
// Devuelve la nueva fecha (ISO) o null si no corresponde extender nada.
export function pagadoHasta(neg, sus, ahora = new Date()) {
  if (neg.suscripcion_estado !== "authorized" || !sus || !sus.next_payment_date) return null;
  const proximo = new Date(sus.next_payment_date);
  if (isNaN(proximo) || proximo <= ahora) return null;
  if (proximo - ahora > 35 * 86400000) return null; // más de un mes: dato raro, no regalamos tiempo
  if (neg.prueba_hasta && new Date(neg.prueba_hasta) >= proximo) return null;
  return proximo.toISOString();
}
