// Contesta los mensajes de WhatsApp con la IA. Lo llama whatsapp.mjs con el aviso de Meta tal cual
// (y su firma, que se vuelve a comprobar: nadie más puede hacer hablar al asistente).
// Es una función "background": Netlify responde enseguida y esto puede tardar (audios largos, varias vueltas de la IA).
import { env, supabaseAdmin } from "../lib/comun.mjs";
import { firmaMetaValida, enviarTexto, marcarLeido, transcribir, gemini } from "../lib/whatsapp.mjs";
import { estaAbierto, mensajeCerrado, responder, textoDelMensaje, HORAS_CHARLA_NUEVA, HORAS_ENTRE_AVISOS_CERRADO } from "../lib/asistente.mjs";

export const config = { background: true };

const ESPERA_MS = Number(process.env.WA_ESPERA_MS || 5000); // para juntar mensajes seguidos en una sola respuesta
const horasAtras = (iso, h) => !iso || Date.now() - new Date(iso).getTime() > h * 3600000;
const enHoras = (h) => new Date(Date.now() + h * 3600000).toISOString();
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpc(nombre, args) {
  try {
    return await supabaseAdmin("/rest/v1/rpc/" + nombre, { method: "POST", body: JSON.stringify(args) });
  } catch (e) {
    // Los errores de la base vienen como JSON con "message": es lo que se le muestra a la IA.
    const m = /\{.*\}$/s.exec(e.message || "");
    let texto = e.message;
    try { texto = JSON.parse(m[0]).message || texto; } catch (x) {}
    throw new Error(texto);
  }
}
const charlaUrl = (neg, tel) => "/rest/v1/wa_charlas?negocio_id=eq." + neg + "&telefono=eq." + encodeURIComponent(tel);
const patchCharla = (neg, tel, cambios) =>
  supabaseAdmin(charlaUrl(neg, tel), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(cambios) });

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
          if (eco.to) tareas.push(patchCharla(ctx.negocio_id, eco.to, { pausada_hasta: enHoras(3) }).catch((e) => console.error(e)));
        }
      } else if (ch.field === "messages") {
        const nombres = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile && c.profile.name]));
        for (const m of v.messages || []) tareas.push(atender(ctx, slug, m, nombres[m.from] || null));
      }
    }
  }
  await Promise.all(tareas);
};

async function atender(ctx, slug, m, nombre) {
  const neg = ctx.negocio_id, tel = m.from;
  try {
    // Meta a veces manda el mismo mensaje dos veces: solo se atiende la primera.
    const nuevo = await supabaseAdmin("/rest/v1/wa_mensajes", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
      body: JSON.stringify({ id: m.id }),
    });
    if (!nuevo || !nuevo.length) return;
    if (!ctx.activo) return; // asistente apagado desde la pestaña Pedidos: contesta el dueño

    const previa = (await supabaseAdmin(charlaUrl(neg, tel) + "&select=pausada_hasta,cerrado_avisado_en"))[0];
    if (previa && previa.pausada_hasta && new Date(previa.pausada_hasta) > new Date()) {
      await patchCharla(neg, tel, { ultimo_mensaje_en: new Date().toISOString() });
      return;
    }

    const publico = ctx.publico;
    if (!estaAbierto(publico.menu.horarios)) {
      // Fuera de horario solo se avisa que está cerrado, una vez cada tanto (no en cada mensaje).
      if (previa && !horasAtras(previa.cerrado_avisado_en, HORAS_ENTRE_AVISOS_CERRADO)) return;
      await enviarTexto(tel, mensajeCerrado(publico.negocio.nombre, publico.menu));
      await supabaseAdmin("/rest/v1/wa_charlas?on_conflict=negocio_id,telefono", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({ negocio_id: neg, telefono: tel, nombre, cerrado_avisado_en: new Date().toISOString(), ultimo_mensaje_en: new Date().toISOString() }),
      });
      return;
    }

    marcarLeido(m.id);
    const texto = await textoDelMensaje(m, transcribir);
    if (!texto) return;
    const ubicacion = m.type === "location" && m.location
      ? { lat: m.location.latitude, lng: m.location.longitude, nombre: m.location.name || null, direccion: m.location.address || null }
      : null;
    await rpc("wa_encolar", { p_negocio: neg, p_telefono: tel, p_nombre: nombre, p_id: m.id, p_texto: texto, p_ubicacion: ubicacion });

    // Si el cliente sigue escribiendo, contesta el último mensaje (con todos los anteriores juntos).
    await dormir(ESPERA_MS);
    const charla = await rpc("wa_tomar", { p_negocio: neg, p_telefono: tel, p_id: m.id });
    if (!charla) return;
    await contestar(ctx, slug, charla);
  } catch (e) {
    console.error(e);
    try {
      await enviarTexto(tel, "Perdón, tuve un problema para responderte 🙏 En un ratito te contesta alguien del local.");
      await patchCharla(neg, tel, { necesita_humano: "El asistente tuvo un error y no pudo responder", pausada_hasta: enHoras(2) });
    } catch (x) { console.error(x); }
  }
}

async function contestar(ctx, slug, charla) {
  const neg = ctx.negocio_id, tel = charla.telefono;
  const historial = horasAtras(charla.historial_en, HORAS_CHARLA_NUEVA) ? [] : charla.historial;
  const mensaje = charla.pendientes.map((p) => p.texto).join("\n");
  let ubicacion = charla.ubicacion;

  const r = await responder({ publico: ctx.publico, historial, mensaje }, {
    ia: gemini,
    cotizar: (items, entrega) => rpc("cotizar_pedido", { p_slug: slug, p_items: items || [], p_entrega: entrega }),
    async registrar(a) {
      if (a.entrega === "delivery" && !ubicacion && !String(a.direccion || "").trim()) {
        return { ok: false, error: "Falta saber adónde llevarlo: pedile la ubicación de WhatsApp o la dirección." };
      }
      const p = await rpc("wa_registrar_pedido", {
        p_slug: slug, p_telefono: tel, p_nombre: charla.nombre, p_items: a.items || [], p_entrega: a.entrega,
        p_pago: a.pago || null, p_ubicacion: a.entrega === "delivery" ? ubicacion : null,
        p_direccion: a.direccion || null, p_notas: a.notas || null,
      });
      if (p && p.ok) ubicacion = null; // la ubicación ya quedó en el pedido; el próximo pedido pide la suya
      return p;
    },
    derivar: (motivo) => patchCharla(neg, tel, { necesita_humano: motivo, pausada_hasta: enHoras(12) }),
  });

  if (r.texto) await enviarTexto(tel, r.texto);
  await patchCharla(neg, tel, { historial: r.historial, historial_en: new Date().toISOString(), ubicacion });
}
