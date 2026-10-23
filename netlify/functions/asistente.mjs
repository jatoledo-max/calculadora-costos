// El navegador llama acá cuando el dueño le hace una pregunta al asistente (botón "Preguntar" en Informes).
// Lee los datos del negocio de ese usuario (solo los suyos), los calcula con costos.js y le pregunta a Groq.
// Variables de entorno: GROQ_API_KEY (gratis en console.groq.com) y, opcional, GROQ_MODEL.
import { env, json, supabaseAdmin, usuarioDelToken } from "../lib/comun.mjs";
import { armarContexto, instrucciones, HERRAMIENTAS, ejecutarHerramienta, limpiarRespuesta } from "../lib/asistente.mjs";

// Modelos gratis de Groq, en orden. Cada uno tiene su propio límite por minuto: si uno se llena, se pasa al siguiente.
// (Los Llama gratis los dio de baja Groq en agosto de 2026.)
const MODELOS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b"];
const MAX_PREGUNTA = 600;
const MAX_HISTORIAL = 6; // mensajes anteriores que se mandan (las respuestas viejas no hacen falta enteras)
const MAX_VUELTAS = 4; // veces que la IA puede pedir una cuenta antes de contestar

async function groq(modelo, mensajes) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: "Bearer " + env("GROQ_API_KEY"), "content-type": "application/json" },
    body: JSON.stringify({
      model: modelo, messages: mensajes, tools: HERRAMIENTAS, tool_choice: "auto", temperature: 0.2, max_tokens: 700,
      ...(modelo.startsWith("openai/gpt-oss") ? { reasoning_effort: "low" } : {}),
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const e = new Error("Groq " + r.status + " (" + modelo + "): " + ((body.error && (body.error.code || body.error.message)) || JSON.stringify(body)).toString().slice(0, 200));
    e.status = r.status; e.codigo = body.error && body.error.code;
    throw e;
  }
  return body.choices[0].message;
}

// Groq a veces devuelve 400 "tool_use_failed" cuando el modelo arma mal un pedido de cuenta: se reintenta una vez.
async function groqConReintento(modelo, mensajes) {
  try {
    return await groq(modelo, mensajes);
  } catch (e) {
    if (e.codigo !== "tool_use_failed") throw e;
    console.error(e.message, "→ reintento");
    return groq(modelo, mensajes);
  }
}

// Prueba los modelos en orden desde "ronda.modelo" y recuerda cuál anduvo, así la vuelta siguiente
// (con el resultado de una cuenta) no vuelve a chocar con el que ya se llenó. Si la clave es mala, no sigue.
async function preguntarIA(mensajes, ronda) {
  const modelos = process.env.GROQ_MODEL ? [process.env.GROQ_MODEL, ...MODELOS.filter((m) => m !== process.env.GROQ_MODEL)] : MODELOS;
  const fallas = [];
  for (let i = ronda.modelo; i < modelos.length; i++) {
    try {
      const m = await groqConReintento(modelos[i], mensajes);
      ronda.modelo = i;
      return m;
    } catch (e) {
      if ([401, 403].includes(e.status)) throw e;
      console.error(e.message);
      fallas.push(e);
    }
  }
  const e = new Error(fallas.map((f) => f.message).join(" | "));
  e.status = fallas.every((f) => f.status === 429) ? 429 : 500;
  throw e;
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
    const ronda = { modelo: 0 };
    for (let vuelta = 0; vuelta <= MAX_VUELTAS; vuelta++) {
      const m = await preguntarIA(mensajes, ronda);
      if (!m.tool_calls || !m.tool_calls.length || vuelta === MAX_VUELTAS) {
        const texto = limpiarRespuesta(m.content);
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
    // "detalle" es el motivo técnico corto (sin claves), para poder ver qué pasó desde la pantalla.
    const detalle = String(e.message || e).slice(0, 400);
    if ([401, 403].includes(e.status)) return json(502, { error: "La clave de Groq no funciona. Revisá GROQ_API_KEY en Netlify.", detalle });
    if (e.status === 429) return json(429, { error: "El asistente gratis llegó a su límite por ahora. Probá de nuevo en un rato.", detalle });
    if (/GROQ_API_KEY/.test(e.message)) return json(503, { error: "El asistente todavía no está configurado." });
    return json(500, { error: "El asistente no pudo contestar. Probá de nuevo en un rato.", detalle });
  }
};
