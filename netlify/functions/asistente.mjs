// El navegador llama acá cuando el dueño le hace una pregunta al asistente (pestaña Asistente).
// Lee los datos del negocio de ese usuario (solo los suyos), los calcula con costos.js y le pregunta a Groq.
// Variables de entorno: GROQ_API_KEY (gratis en console.groq.com) y, opcional, GROQ_MODEL.
import { env, json, supabaseAdmin, usuarioDelToken } from "../lib/comun.mjs";
import { armarContexto, instrucciones, HERRAMIENTAS, ejecutarHerramienta } from "../lib/asistente.mjs";

const MODELO = "openai/gpt-oss-120b";
const MODELO_RESPALDO = "llama-3.3-70b-versatile"; // si el primero está saturado o llegó a su límite del día
const MAX_PREGUNTA = 600;
const MAX_HISTORIAL = 8; // mensajes anteriores que se mandan (las respuestas viejas no hacen falta enteras)
const MAX_VUELTAS = 4; // veces que la IA puede pedir una cuenta antes de contestar

async function groq(modelo, mensajes) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + env("GROQ_API_KEY"), "content-type": "application/json" },
    body: JSON.stringify({
      model: modelo, messages: mensajes, tools: HERRAMIENTAS, tool_choice: "auto", temperature: 0.2, max_tokens: 900,
      ...(modelo.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error("Groq " + r.status + ": " + JSON.stringify(body.error || body)); e.status = r.status; throw e; }
  return body.choices[0].message;
}

// Pide al modelo principal y, si está saturado, al de respaldo.
async function preguntarIA(mensajes) {
  const principal = process.env.GROQ_MODEL || MODELO;
  try {
    return await groq(principal, mensajes);
  } catch (e) {
    if (![429, 498, 500, 502, 503, 404].includes(e.status) || principal === MODELO_RESPALDO) throw e;
    console.error(e.message, "→ uso", MODELO_RESPALDO);
    return groq(MODELO_RESPALDO, mensajes);
  }
}

const lista = async (tabla, negId) => {
  const filas = await supabaseAdmin("/rest/v1/" + tabla + "?select=id,datos&negocio_id=eq." + negId);
  return Object.fromEntries(filas.map((f) => [f.id, f.datos]));
};

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "Usá POST" });
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const user = await usuarioDelToken(token);
    if (!user) return json(401, { error: "Iniciá sesión de nuevo." });
    const negs = await supabaseAdmin("/rest/v1/negocios?select=id,nombre,prueba_hasta,suscripcion_estado&owner_id=eq." + encodeURIComponent(user.id));
    const neg = negs[0];
    if (!neg) return json(404, { error: "No encontramos tu negocio." });
    if (neg.suscripcion_estado !== "authorized" && !(new Date(neg.prueba_hasta) > new Date())) return json(402, { error: "Tu prueba gratis terminó." });

    const pedido = await req.json().catch(() => ({}));
    const pregunta = String(pedido.pregunta || "").trim().slice(0, MAX_PREGUNTA);
    if (!pregunta) return json(400, { error: "Escribí una pregunta." });
    const historial = (Array.isArray(pedido.historial) ? pedido.historial : [])
      .filter((m) => (m.rol === "usuario" || m.rol === "asistente") && typeof m.texto === "string")
      .slice(-MAX_HISTORIAL)
      .map((m) => ({ role: m.rol === "usuario" ? "user" : "assistant", content: m.texto.slice(0, 1500) }));

    const [insumos, productos, gastos, ajustes] = await Promise.all(["insumos", "productos", "gastos", "ajustes"].map((t) => lista(t, neg.id)));
    const estado = { insumos, productos, gastos, ajustes };
    const leerVentas = (desde, hasta) => {
      // Días en hora de Argentina (UTC−3): de las 00:00 de "desde" a las 00:00 del día siguiente a "hasta".
      const fin = new Date(hasta + "T00:00:00-03:00");
      fin.setUTCDate(fin.getUTCDate() + 1);
      return supabaseAdmin("/rest/v1/ventas?select=total,descuento,cargo_envio,venta_items(nombre,cantidad,precio_unitario,envio_incluido_unitario,costo_unitario,unidades)" +
        "&negocio_id=eq." + neg.id + "&estado=eq.confirmada" +
        "&creada_en=gte." + encodeURIComponent(desde + "T00:00:00-03:00") + "&creada_en=lt." + encodeURIComponent(fin.toISOString()) + "&limit=5000");
    };

    const mensajes = [{ role: "system", content: instrucciones(neg.nombre, armarContexto(estado)) }, ...historial, { role: "user", content: pregunta }];
    for (let vuelta = 0; vuelta <= MAX_VUELTAS; vuelta++) {
      const m = await preguntarIA(mensajes);
      if (!m.tool_calls || !m.tool_calls.length || vuelta === MAX_VUELTAS) {
        const texto = (m.content || "").trim();
        return json(200, { respuesta: texto || "No pude armar una respuesta. Probá preguntarlo de otra forma." });
      }
      mensajes.push({ role: "assistant", content: m.content || "", tool_calls: m.tool_calls });
      for (const tc of m.tool_calls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments || "{}"); } catch (e) {}
        const res = await ejecutarHerramienta(tc.function.name, args, { estado, leerVentas });
        mensajes.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(res) });
      }
    }
  } catch (e) {
    console.error(e);
    if (e.status === 429) return json(429, { error: "El asistente gratis llegó a su límite por ahora. Probá de nuevo en un rato." });
    if (/GROQ_API_KEY/.test(e.message)) return json(503, { error: "El asistente todavía no está configurado." });
    return json(500, { error: "El asistente no pudo contestar. Probá de nuevo en un rato." });
  }
};
