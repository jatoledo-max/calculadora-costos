// Tickets de pedido: dónde se guardan (Supabase o, en el modo demo, el navegador) y el texto que va por WhatsApp.
// Las reglas son las de supabase/tickets.sql: los precios los pone el catálogo, un ticket respondido no se corrige,
// y el cliente responde una sola vez a la versión que está mirando.
import { fmtPesos } from "./dinero.js";
import { SinRespuesta } from "./stores.js";

export const ESTADOS = { pendiente: "Esperando respuesta", aceptado: "Aceptado", cambio: "Pide un cambio", rechazado: "Rechazado" };

// Link que abre el cliente.
export const linkTicket = (token, origen = location.origin) => origen + "/t/" + token;

// Mensaje de WhatsApp: el detalle completo (se lee aunque no abra el link) y el link para responder.
export function textoWhatsApp(t, negocio, link) {
  const renglones = (t.items || []).map((i) =>
    i.cantidad + " × " + i.nombre + (i.opcion_nombre ? " (" + i.opcion_nombre + ")" : "") + " — " + fmtPesos(i.subtotal));
  const envio = t.envio == null ? "Retira en el local" : "Envío — " + (Number(t.envio) ? fmtPesos(t.envio) : "sin cargo");
  return [
    "*" + (negocio ? negocio + " · " : "") + "Pedido #" + t.numero + "*",
    ...renglones,
    envio,
    t.nota ? "Nota: " + t.nota : null,
    "*TOTAL: " + fmtPesos(t.total) + "*",
    "",
    "Para confirmar o pedir un cambio, tocá acá:",
    link,
  ].filter((x) => x != null).join("\n");
}

export function supabaseTickets(supabase) {
  const llamar = async (fn) => {
    let r;
    try { r = await fn(); } catch (e) { throw new SinRespuesta("No hubo respuesta del servidor."); }
    if (r.error) {
      if (r.error.code === "P0001") throw new Error(r.error.message);
      if (/fetch|network|Failed/i.test(r.error.message || "")) throw new SinRespuesta("No hubo respuesta del servidor.");
      throw new Error("No se pudo (" + (r.error.message || r.error.code) + "). ¿Corriste supabase/tickets.sql?");
    }
    return r.data;
  };
  return {
    listar: () => llamar(() => supabase.from("tickets").select("*").order("creado_en", { ascending: false }).limit(40)),
    guardar: (t) => llamar(() => supabase.rpc("guardar_ticket", { p_id: t.id, p_items: t.items, p_envio: t.envio, p_cliente: t.cliente || null, p_nota: t.nota || null })),
  };
}

// ---------- Modo demo ----------
const CLAVE = "tickets-demo-v1";
const leer = () => { try { return JSON.parse(localStorage.getItem(CLAVE)) || []; } catch (e) { return []; } };
const escribir = (ts) => { try { localStorage.setItem(CLAVE, JSON.stringify(ts)); } catch (e) {} };
const centavos = (n) => Math.round((Number(n) || 0) * 100);

export function localTickets(estado) {
  return {
    async listar() { return leer().slice().sort((a, b) => b.numero - a.numero); },
    async guardar(t) {
      if (!t.items.length) throw new Error("Agregá al menos un producto.");
      const items = t.items.map((l) => {
        const p = estado.productos[l.producto];
        if (!p || p.esPreparacion) throw new Error("Uno de los productos ya no existe.");
        if (!(Number(p.precioVenta) > 0)) throw new Error('"' + p.nombre + '" no tiene precio de venta.');
        const op = l.opcion ? (p.opciones || []).find((o) => o.id === l.opcion) : null;
        if (l.opcion && !op) throw new Error('La opción elegida de "' + p.nombre + '" ya no existe.');
        const unit = centavos(p.precioVenta) + centavos(op ? Math.max(Number(op.precioExtra) || 0, 0) : 0);
        return { producto: l.producto, opcion: op ? op.id : null, nombre: p.nombre.trim(), opcion_nombre: op ? op.nombre.trim() : null,
          cantidad: l.cantidad, precio_unitario: unit / 100, subtotal: unit * l.cantidad / 100 };
      });
      const sub = items.reduce((a, i) => a + centavos(i.subtotal), 0);
      const envio = t.envio == null ? null : Number(t.envio);
      const ts = leer();
      let x = ts.find((y) => y.id === t.id);
      const campos = { items, envio, cliente: (t.cliente || "").trim() || null, nota: (t.nota || "").trim() || null,
        subtotal: sub / 100, total: (sub + centavos(envio)) / 100, actualizado_en: new Date().toISOString() };
      if (x) {
        if (["aceptado", "rechazado"].includes(x.estado)) throw new Error("El cliente ya respondió este ticket. Armá uno nuevo.");
        Object.assign(x, campos, { estado: "pendiente", version: x.version + 1 });
      } else {
        x = Object.assign({ id: t.id, numero: ts.reduce((m, y) => Math.max(m, y.numero), 0) + 1,
          token: crypto.randomUUID().replace(/-/g, "").slice(0, 22), estado: "pendiente", respuesta: null, respondido_en: null,
          version: 1, creado_en: new Date().toISOString() }, campos);
        ts.push(x);
      }
      escribir(ts);
      return x;
    },
  };
}

// Lo que ve el cliente en el modo demo (mismo navegador): como ver_ticket y responder_ticket.
export function localVerTicket(token) {
  const t = leer().find((x) => x.token === token);
  if (!t) return null;
  let neg = {}, datos = {};
  try { neg = JSON.parse(localStorage.getItem("costos-demo-negocio")) || {}; } catch (e) {}
  try { datos = JSON.parse(localStorage.getItem("costos-demo-v1")) || {}; } catch (e) {}
  const m = (datos.ajustes || {}).menu || {};
  return {
    negocio: { nombre: neg.nombre || "Demo", logo: neg.logo || null, color: neg.color || null },
    pago: { whatsapp: String(m.whatsapp || "").replace(/\D/g, ""), alias: m.alias || null, pagos: m.pagos || [] },
    ticket: t,
  };
}
export function localResponderTicket(token, estado, version, respuesta) {
  const ts = leer();
  const t = ts.find((x) => x.token === token);
  if (!t) throw new Error("Este ticket no existe.");
  if (t.estado === estado && t.version === version) return localVerTicket(token);
  if (t.estado !== "pendiente") throw new Error("Este ticket ya fue respondido.");
  if (t.version !== version) throw new Error("El negocio corrigió el ticket. Mirá el nuevo detalle antes de responder.");
  if (estado === "cambio" && !(respuesta || "").trim()) throw new Error("Escribí qué querés cambiar.");
  Object.assign(t, { estado, respondido_en: new Date().toISOString(), respuesta: estado === "aceptado" ? null : (respuesta || "").trim().slice(0, 500) || null });
  escribir(ts);
  return localVerTicket(token);
}
