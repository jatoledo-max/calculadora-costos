// Cerebro del asistente de WhatsApp. No habla con nadie directamente: recibe todo lo que necesita
// (la IA, cómo cotizar, cómo registrar el pedido) en "deps", así se puede probar sin internet.
// Los precios y totales salen siempre de la base (cotizar_pedido); la IA solo conversa y arma la lista.

export const ZONA_HORARIA_MIN = -180; // Argentina, UTC-3 todo el año
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const ORDEN_DIAS = [1, 2, 3, 4, 5, 6, 0];
export const MAX_HISTORIAL = 40;
export const HORAS_CHARLA_NUEVA = 6;      // sin mensajes por más de esto, se empieza una charla de cero
export const HORAS_ENTRE_AVISOS_CERRADO = 3;

const pesos = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");
const aMin = (hhmm) => { const m = /^(\d\d):(\d\d)$/.exec(hhmm || ""); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };

// ¿El local está abierto en este momento? Horarios como los guarda Mi negocio > Menú de pedidos:
// { dias: [0..6] (0 = domingo), desde: "21:00", hasta: "01:00" }. Si "hasta" es menor que "desde",
// el turno sigue después de medianoche y cuenta como del día en que empezó. Sin horarios cargados: abierto.
export function estaAbierto(horarios, fecha = new Date()) {
  const h = horarios || {};
  const dias = Array.isArray(h.dias) ? h.dias : [];
  const desde = aMin(h.desde), hasta = aMin(h.hasta);
  if (!dias.length || desde == null || hasta == null) return true;
  const local = new Date(fecha.getTime() + ZONA_HORARIA_MIN * 60000);
  const dia = local.getUTCDay(), ahora = local.getUTCHours() * 60 + local.getUTCMinutes();
  const ayer = (dia + 6) % 7;
  if (desde < hasta) return dias.includes(dia) && ahora >= desde && ahora < hasta;
  return (dias.includes(dia) && ahora >= desde) || (dias.includes(ayer) && ahora < hasta);
}

// "jueves, viernes, sábado y domingo de 21:00 a 01:00"
export function textoHorarios(horarios) {
  const h = horarios || {};
  const dias = ORDEN_DIAS.filter((d) => (h.dias || []).includes(d));
  if (!dias.length || !h.desde || !h.hasta) return "";
  const nombres = dias.length === 7 ? "todos los días" : dias.length === 1 ? "los " + plural(DIAS[dias[0]])
    : dias.slice(0, -1).map((d) => DIAS[d]).join(", ") + " y " + DIAS[dias[dias.length - 1]];
  return nombres + " de " + h.desde + " a " + h.hasta;
}
const plural = (dia) => (dia.endsWith("s") ? dia : dia + "s");

export function mensajeCerrado(nombreNegocio, menu) {
  const horas = textoHorarios(menu && menu.horarios);
  let t = "¡Hola! Gracias por escribir a " + (nombreNegocio || "nosotros") + ". En este momento estamos cerrados 🙏";
  if (horas) t += "\nAtendemos " + horas + ".";
  if (menu && menu.aviso) t += "\n" + menu.aviso;
  return t + "\n¡Te esperamos!";
}

// Lo que se le dice al cliente cuando el dueño cambia el estado en la pestaña Pedidos. null = no se avisa.
export function mensajeEstado(pedido, estado, motivo) {
  const n = "#" + pedido.numero;
  switch (estado) {
    case "aceptado": return "✅ ¡Aceptamos tu pedido " + n + "! Total: " + pesos(pedido.total) +
      (pedido.entrega === "delivery" && pedido.envio == null ? " más el envío" : "") + ". Ya lo empezamos a preparar.";
    case "en_preparacion": return "👨‍🍳 Tu pedido " + n + " está en preparación.";
    case "en_camino": return pedido.entrega === "delivery"
      ? "🛵 Tu pedido " + n + " está en camino. ¡Ya llega!"
      : "🛍️ Tu pedido " + n + " está listo para retirar. ¡Te esperamos!";
    case "rechazado": return "😔 Perdón, no podemos tomar tu pedido " + n + (motivo ? ": " + motivo : ".") + " Si querés, escribinos y lo vemos.";
    default: return null;
  }
}

export const ESTADOS = {
  nuevo: "Nuevo", aceptado: "Aceptado", en_preparacion: "En preparación",
  en_camino: "En camino", entregado: "Entregado", rechazado: "Rechazado",
};

// ---------- Lo que la IA sabe y puede hacer ----------
export function instrucciones(publico, ahora = new Date()) {
  const neg = (publico && publico.negocio) || {};
  const menu = (publico && publico.menu) || {};
  const pagos = { efectivo: "efectivo", transferencia: "transferencia", dividido: "parte efectivo y parte transferencia" };
  const lineas = ((publico && publico.productos) || []).map((p) => {
    let l = "- [" + p.id + "] " + p.nombre + " — " + pesos(p.precio) + " (" + p.categoria + ")";
    if (!p.disponible) l += " AGOTADO HOY";
    if (p.descripcion) l += ". " + p.descripcion;
    if (p.opciones && p.opciones.length) {
      l += "\n    opciones: " + p.opciones.map((o) => "[" + o.id + "] " + o.nombre + (o.precio_extra ? " (+" + pesos(o.precio_extra) + ")" : "")).join(", ");
    }
    return l;
  });
  const local = new Date(ahora.getTime() + ZONA_HORARIA_MIN * 60000);
  return `Sos el asistente de WhatsApp de ${neg.nombre || "una rotisería"}, una rotisería de comida rápida en Argentina.
Atendés a los clientes para tomar pedidos. Hoy es ${DIAS[local.getUTCDay()]}, son las ${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}.

Cómo hablar:
- Español rioplatense, cálido y simple, como un empleado amable del local. Tuteá o voseá. Emojis con moderación.
- Mensajes cortos y completos: juntá todo lo que tengas que decir en UN solo mensaje por respuesta. Nunca mandes listas largas si no te las piden.
- Muchos clientes son personas grandes y mandan audios: no uses palabras técnicas, repreguntá con calma si algo no quedó claro.
- Si el cliente saluda o pregunta qué hay, contale las categorías y 3 o 4 productos, y ofrecé mandarle el menú completo.

Reglas del pedido (importantes):
- Solo podés vender lo que está en el MENÚ de abajo, con esos nombres. Nunca inventes productos, precios, promociones ni descuentos.
- Si piden algo AGOTADO HOY, avisá y sugerí algo parecido.
- Para saber precios y totales usá SIEMPRE la herramienta "cotizar". No sumes vos.
- Necesitás saber: qué productos y cuántos (y la opción si el producto tiene opciones), si es delivery o retiro, y cómo paga (${(menu.pagos || []).map((p) => pagos[p] || p).join(", ") || "efectivo"}).
- Si es delivery, pedile que te mande la UBICACIÓN por WhatsApp (el clip 📎 > Ubicación) o que escriba la dirección. ${menu.envio != null ? "El envío cuesta " + pesos(menu.envio) + "." : "El costo del envío lo confirma el local."}
- Cuando tengas todo, mandá un resumen con cada producto, el total de "cotizar" y la forma de entrega y de pago, y preguntá "¿Confirmamos?".
- Solo cuando el cliente diga que sí, usá "confirmar_pedido". Después decile el número de pedido y que le vamos a avisar por acá cuando lo aceptemos.${menu.alias ? "\n- Si paga por transferencia, después de confirmar pasale el alias: " + menu.alias + " y pedile que mande el comprobante por acá." : ""}
- No pidas nombre ni datos de más: lo mínimo.

Cuándo pedir ayuda a una persona del local (herramienta "derivar_a_humano"):
- Quejas, reclamos, problemas con un pedido anterior, pedidos para eventos o muy grandes, o si el cliente pide hablar con una persona.
- Preguntas que no podés responder con lo que sabés acá. No inventes respuestas.
- Después de derivar, decile al cliente que en un ratito le responde alguien del local.

${menu.aviso ? "Aviso del local para los clientes: " + menu.aviso + "\n\n" : ""}Horario: ${textoHorarios(menu.horarios) || "no informado"}.

MENÚ (el [código] es solo para las herramientas, no se lo muestres al cliente):
${lineas.join("\n") || "(sin productos cargados)"}`;
}

const ITEMS = {
  type: "array",
  description: "Productos del pedido",
  items: {
    type: "object",
    properties: {
      producto: { type: "string", description: "Código del producto, el que está entre corchetes en el menú" },
      opcion: { type: "string", description: "Código de la opción, si el producto tiene opciones y el cliente eligió una" },
      cantidad: { type: "integer", description: "Cuántos" },
    },
    required: ["producto", "cantidad"],
  },
};
const ENTREGA = { type: "string", enum: ["retiro", "delivery"], description: "retiro = lo busca en el local" };

export const HERRAMIENTAS = [{
  functionDeclarations: [
    {
      name: "cotizar",
      description: "Calcula el precio de cada producto y el total del pedido con los precios vigentes del local. Usala siempre antes de decir un precio o un total.",
      parameters: { type: "object", properties: { items: ITEMS, entrega: ENTREGA }, required: ["items", "entrega"] },
    },
    {
      name: "confirmar_pedido",
      description: "Registra el pedido y le avisa al local. Usala solo cuando el cliente ya confirmó el resumen.",
      parameters: {
        type: "object",
        properties: {
          items: ITEMS, entrega: ENTREGA,
          pago: { type: "string", enum: ["efectivo", "transferencia", "dividido"] },
          direccion: { type: "string", description: "Dirección escrita por el cliente, si es delivery y no mandó la ubicación" },
          notas: { type: "string", description: "Aclaraciones del cliente: sin cebolla, timbre que no anda, etc." },
        },
        required: ["items", "entrega", "pago"],
      },
    },
    {
      name: "derivar_a_humano",
      description: "Le pasa la charla a una persona del local y el asistente deja de responder en esta charla.",
      parameters: { type: "object", properties: { motivo: { type: "string", description: "Por qué, en pocas palabras" } }, required: ["motivo"] },
    },
  ],
}];

// Recorta el historial sin dejarlo empezando por una respuesta de herramienta (la IA necesita el contexto completo).
export function recortar(historial, max = MAX_HISTORIAL) {
  let h = historial.slice(-max);
  const inicio = h.findIndex((c) => c.role === "user" && (c.parts || []).some((p) => typeof p.text === "string"));
  return inicio < 0 ? [] : h.slice(inicio);
}

// Una vuelta de conversación: agrega el mensaje del cliente, deja que la IA use herramientas y devuelve su respuesta.
// deps: { ia(body) → content, cotizar(items, entrega), registrar(args), derivar(motivo) }
export async function responder({ publico, historial, mensaje, ahora = new Date() }, deps) {
  const h = recortar(historial || []);
  h.push({ role: "user", parts: [{ text: mensaje }] });
  const resultado = { pedido: null, derivado: null };
  for (let vuelta = 0; vuelta < 6; vuelta++) {
    const content = await deps.ia({
      systemInstruction: { parts: [{ text: instrucciones(publico, ahora) }] },
      contents: h,
      tools: HERRAMIENTAS,
      generationConfig: { temperature: 0.4 },
    });
    if (!content || !Array.isArray(content.parts) || !content.parts.length) throw new Error("La IA no respondió");
    h.push({ role: "model", parts: content.parts });
    const llamadas = content.parts.filter((p) => p.functionCall);
    if (!llamadas.length) {
      const texto = content.parts.filter((p) => typeof p.text === "string" && !p.thought).map((p) => p.text).join("").trim();
      return { ...resultado, texto, historial: h };
    }
    const respuestas = [];
    for (const { functionCall: fc } of llamadas) {
      const args = fc.args || {};
      let r;
      try {
        if (fc.name === "cotizar") r = await deps.cotizar(args.items, args.entrega);
        else if (fc.name === "confirmar_pedido") {
          r = await deps.registrar(args);
          if (r && r.ok) resultado.pedido = r;
        } else if (fc.name === "derivar_a_humano") {
          await deps.derivar(args.motivo || "Pidió hablar con una persona");
          resultado.derivado = args.motivo || "Pidió hablar con una persona";
          r = { ok: true };
        } else r = { error: "Herramienta desconocida" };
      } catch (e) {
        r = { error: e.message || "No se pudo" };
      }
      respuestas.push({ functionResponse: { name: fc.name, response: r } });
    }
    h.push({ role: "user", parts: respuestas });
  }
  throw new Error("La IA no terminó de responder");
}

// Convierte un mensaje de WhatsApp en texto para la IA. transcribir(mediaId, mime) → texto del audio.
export async function textoDelMensaje(m, transcribir) {
  switch (m.type) {
    case "text": return m.text && m.text.body ? m.text.body : "";
    case "audio": {
      const t = await transcribir(m.audio.id, m.audio.mime_type || "audio/ogg");
      return "[Audio del cliente, transcripto]: " + (t || "(no se entendió el audio)");
    }
    case "location": {
      const l = m.location || {};
      return "[El cliente mandó su ubicación" + (l.name ? ": " + l.name : "") + (l.address ? ", " + l.address : "") + "]";
    }
    case "interactive": {
      const i = m.interactive || {};
      return (i.button_reply && i.button_reply.title) || (i.list_reply && i.list_reply.title) || "";
    }
    case "button": return (m.button && m.button.text) || "";
    case "image": return "[El cliente mandó una foto" + (m.image && m.image.caption ? " con el texto: " + m.image.caption : "") + ". No podés verla: si parece un comprobante de pago, agradecé y decí que el local lo revisa.]";
    case "sticker": case "reaction": return "";
    default: return "[El cliente mandó un mensaje de tipo " + m.type + " que no podés ver]";
  }
}
