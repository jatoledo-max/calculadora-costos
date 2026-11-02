// Compras del día a día (carnicería, verdulería, mayorista…): las cuentas y dónde se guardan.
// Una compra es { id, fecha "2026-11-02", categoria, descripcion, importe, cantidad, unidad, estimada, medio, en_caja, creado_en }.
//   en_caja: se descontó de la caja abierta (el movimiento de la caja tiene el mismo id que la compra).
//   cantidad/unidad: lo que compraste en kg, l o u. Si no pusiste el peso, la app lo estima con el último precio
//   que pagaste por eso (o con el precio de Insumos) y queda estimada = true. Puede quedar vacía (null).
// Lo que la app "aprende" (último precio por kilo de cada cosa, lo que comprás siempre) va en ajustes/compras:
//   { categorias: [...], refs: { "nalga": { nombre, categoria, precio, unidad, fecha, veces } } }
import { SinRespuesta } from "./stores.js";

export const CATEGORIAS_INICIALES = ["Mayorista", "Carnicería", "Verdulería", "Descartables", "Panadería", "Otros"];

// Unidades que se pueden poner al cargar; se guardan pasadas a kg, l o u.
export const UNIDADES = {
  kg: { base: "kg", factor: 1, nombre: "kg" },
  g: { base: "kg", factor: 0.001, nombre: "gramos" },
  u: { base: "u", factor: 1, nombre: "unidades" },
  l: { base: "l", factor: 1, nombre: "litros" },
};

// "  Nalga " y "nalga" son lo mismo; también sin tildes.
export const clave = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

// Fecha de hoy en el celular (no en UTC: a las 22 en Argentina en UTC ya es mañana).
export function hoyLocal(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}
// "2026-11" → primer y último día del mes.
export function rangoMes(mes) {
  const [a, m] = mes.split("-").map(Number);
  const ult = new Date(a, m, 0).getDate();
  return { desde: mes + "-01", hasta: mes + "-" + String(ult).padStart(2, "0"), dias: ult };
}
export function mesCorrido(mes, n) {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(a, m - 1 + n, 1);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
}
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
export const nombreMes = (mes) => MESES[Number(mes.slice(5, 7)) - 1];

// Precio de referencia de algo, por kg, l o u: primero lo último que pagaste en Compras, si no el de Insumos.
// → { precio, unidad, fuente: "compra" | "insumo" } o null.
export function precioReferencia(nombre, refs, insumos) {
  const k = clave(nombre);
  if (!k) return null;
  const r = (refs || {})[k];
  if (r && Number(r.precio) > 0 && UNIDADES[r.unidad]) return { precio: Number(r.precio), unidad: r.unidad, fuente: "compra" };
  const lista = Object.values(insumos || {}).filter((i) => i && Number(i.precio) > 0 && Number(i.cantidad) > 0 && UNIDADES[i.unidad]);
  const ins = lista.find((i) => clave(i.nombre) === k) ||
    (k.length >= 3 ? lista.find((i) => { const n = clave(i.nombre); return n.startsWith(k + " ") || k.startsWith(n + " "); }) : null);
  if (ins) return { precio: Number(ins.precio) / Number(ins.cantidad), unidad: ins.unidad, fuente: "insumo" };
  return null;
}

// Lo que pusiste en la carga → { cantidad (en kg, l o u), unidad, estimada } o null si no se puede saber.
export function cantidadDe(importe, exacta, unidadElegida, ref) {
  const u = UNIDADES[unidadElegida];
  if (Number(exacta) > 0 && u) return { cantidad: redondear3(Number(exacta) * u.factor), unidad: u.base, estimada: false };
  if (ref && Number(importe) > 0) return { cantidad: redondear3(Number(importe) / ref.precio), unidad: ref.unidad, estimada: true };
  return null;
}
const redondear3 = (n) => Math.round(n * 1000) / 1000;

// 1.75 kg → "1,75 kg"; 0.4 kg → "400 g"; 6 u → "6 u".
export function fmtCantidad(cantidad, unidad) {
  const n = Number(cantidad);
  if (!(n > 0)) return "";
  const num = (x, dec) => x.toLocaleString("es-AR", { maximumFractionDigits: dec });
  if (unidad === "kg") return n < 1 ? num(Math.round(n * 1000), 0) + " g" : num(n, 2) + " kg";
  if (unidad === "l") return n < 1 ? num(Math.round(n * 1000), 0) + " ml" : num(n, 2) + " l";
  return num(n, 1) + " u";
}
export const nombreUnidad = (u) => (u === "u" ? "la unidad" : "el " + (u === "l" ? "litro" : "kg"));

// Después de guardar una compra: recordar cuántas veces la cargaste y, si pusiste el peso, el precio nuevo.
// Se guardan como mucho 300 cosas (se olvidan las que hace más tiempo que no comprás).
export function actualizarRefs(refs, compra) {
  const k = clave(compra.descripcion);
  const nuevo = Object.assign({}, refs);
  const ant = nuevo[k] || {};
  const r = { nombre: compra.descripcion.trim(), categoria: compra.categoria, veces: (Number(ant.veces) || 0) + 1, fecha: compra.fecha };
  if (!compra.estimada && Number(compra.cantidad) > 0 && UNIDADES[compra.unidad]) {
    r.precio = Math.round((compra.importe / compra.cantidad) * 100) / 100; r.unidad = compra.unidad;
  } else if (ant.precio) { r.precio = ant.precio; r.unidad = ant.unidad; }
  nuevo[k] = r;
  const claves = Object.keys(nuevo);
  if (claves.length > 300) {
    claves.sort((a, b) => String(nuevo[a].fecha || "").localeCompare(String(nuevo[b].fecha || "")))
      .slice(0, claves.length - 300).forEach((x) => delete nuevo[x]);
  }
  return nuevo;
}

// "Lo de siempre" de una categoría: lo que más cargaste ahí.
export function loDeSiempre(refs, categoria, n = 8) {
  return Object.values(refs || {}).filter((r) => r.categoria === categoria)
    .sort((a, b) => (b.veces || 0) - (a.veces || 0) || String(b.fecha || "").localeCompare(String(a.fecha || "")))
    .slice(0, n).map((r) => r.nombre);
}

// Total de un grupo de compras, cuántos días compraste y cuánto fue a cada categoría (de mayor a menor).
export function resumen(compras) {
  const cats = new Map();
  let total = 0;
  const dias = new Set();
  compras.forEach((c) => {
    const imp = Math.round(Number(c.importe) * 100);
    total += imp; dias.add(c.fecha);
    const g = cats.get(c.categoria) || { categoria: c.categoria, total: 0, compras: [] };
    g.total += imp; g.compras.push(c);
    cats.set(c.categoria, g);
  });
  return {
    total: total / 100, dias: dias.size,
    porCategoria: [...cats.values()].map((g) => Object.assign(g, { total: g.total / 100 })).sort((a, b) => b.total - a.total),
  };
}

// Revisa una compra antes de guardarla. Devuelve el texto del error o null.
export function errorCompra(c) {
  if (!c.categoria) return "Elegí la categoría.";
  if (!String(c.descripcion || "").trim()) return "Escribí qué compraste.";
  if (!(Number(c.importe) > 0)) return "Poné cuánto pagaste.";
  if (Number(c.importe) >= 100000000) return "Revisá el monto: es demasiado grande.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(c.fecha || "")) return "Revisá la fecha.";
  return null;
}

// ---------- Dónde se guardan ----------
// listar(desde, hasta) → compras con fecha entre las dos (incluidas), la más nueva primero.
// guardar(compra)      → si ya estaba (reintento), no la duplica.
// borrar(id)
export function supabaseCompras(supabase, negocioId) {
  const llamar = async (fn) => {
    let r;
    try { r = await fn(); } catch (e) { throw new SinRespuesta("No hubo respuesta del servidor."); }
    if (r.error) {
      if (/fetch|network|Failed/i.test(r.error.message || "")) throw new SinRespuesta("No hubo respuesta del servidor.");
      throw new Error("No se pudo (" + (r.error.message || r.error.code) + "). ¿Corriste supabase/compras.sql?");
    }
    return r.data;
  };
  return {
    async listar(desde, hasta) {
      const filas = [];
      for (let i = 0; ; i += 1000) {
        const d = await llamar(() => supabase.from("compras").select("*").gte("fecha", desde).lte("fecha", hasta)
          .order("fecha", { ascending: false }).order("creado_en", { ascending: false }).range(i, i + 999));
        filas.push(...d);
        if (d.length < 1000) return filas.map((c) => Object.assign(c, { importe: Number(c.importe), cantidad: c.cantidad == null ? null : Number(c.cantidad) }));
      }
    },
    guardar: (c) => llamar(() => supabase.from("compras").upsert(Object.assign({ negocio_id: negocioId }, c), { onConflict: "id", ignoreDuplicates: true })),
    borrar: (id) => llamar(() => supabase.from("compras").delete().eq("id", id)),
  };
}

// Modo demo: en el navegador.
const CLAVE_DEMO = "compras-demo-v1";
export function localCompras() {
  const leer = () => { try { return JSON.parse(localStorage.getItem(CLAVE_DEMO)) || []; } catch (e) { return []; } };
  const escribir = (cs) => { try { localStorage.setItem(CLAVE_DEMO, JSON.stringify(cs)); } catch (e) {} };
  return {
    async listar(desde, hasta) {
      return leer().filter((c) => c.fecha >= desde && c.fecha <= hasta)
        .sort((a, b) => b.fecha.localeCompare(a.fecha) || String(b.creado_en).localeCompare(String(a.creado_en)));
    },
    async guardar(c) { const cs = leer(); if (!cs.some((x) => x.id === c.id)) { cs.push(c); escribir(cs); } },
    async borrar(id) { escribir(leer().filter((c) => c.id !== id)); },
  };
}
