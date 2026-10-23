// Asistente de la calculadora: arma los datos del negocio para la IA y hace las cuentas que la IA pide.
// La IA nunca calcula precios ni costos: los lee de acá (ya calculados con costos.js, igual que la pantalla)
// o llama a una herramienta que hace la cuenta. Sin pantalla ni red: se prueba con npm test.
import { crearCostos, categoriaDe, UNID } from "../../public/costos.js";

const pesos = (n) => "$" + Math.round(Number(n) || 0).toLocaleString("es-AR");
const pesos2 = (n) => "$" + (Number(n) || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (n == null ? "—" : Math.round(n) + "%");
const sinAcentos = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

// Busca por nombre sin importar mayúsculas ni acentos: primero exacto, después "empieza con", después "contiene".
function buscar(mapa, nombre) {
  const q = sinAcentos(nombre);
  const todos = Object.entries(mapa || {});
  const exacto = todos.filter(([, x]) => sinAcentos(x.nombre) === q);
  if (exacto.length) return exacto;
  const empieza = todos.filter(([, x]) => q && sinAcentos(x.nombre).startsWith(q));
  if (empieza.length) return empieza;
  return todos.filter(([, x]) => q && (sinAcentos(x.nombre).includes(q) || q.includes(sinAcentos(x.nombre))));
}

// Los números de un producto de venta, con la misma cuenta que la ficha de la calculadora.
function numerosProducto(c, p) {
  const { total, packaging, faltas: f } = c.costoProducto(p);
  const faltas = (p.items || []).length ? f : ["la receta (no tiene insumos cargados)"].concat(f);
  const fijo = c.fijoPorUnidad() * c.unidadesDe(p);
  const costoTotal = total + fijo;
  const env = c.envioIncl(p);
  const pv = Number(p.precioVenta) || 0;
  const hayFijos = c.fijoPorUnidad() > 0;
  const margenObjetivo = p.margen ?? (hayFijos ? 30 : 60);
  return {
    insumos: total - packaging, packaging, fijo, costoTotal, envio: env, precio: pv,
    ganancia: pv ? pv - env - costoTotal : null,
    margen: pv ? c.margenReal(costoTotal, pv - env) : null,
    margenObjetivo, sugerido: c.precioSugerido(costoTotal, margenObjetivo, env), faltas,
  };
}

// Renglones cortos a propósito: el plan gratis de Groq deja pocos tokens por minuto y cada pregunta los manda todos.
function lineaProducto(c, p) {
  const n = numerosProducto(c, p);
  const partes = ["ins " + pesos(n.insumos)];
  if (n.packaging) partes.push("pack " + pesos(n.packaging));
  if (n.fijo) partes.push("fijos " + pesos(n.fijo));
  let t = "- " + p.nombre + " [" + categoriaDe(p) + "]: ";
  t += n.precio ? "precio " + pesos(n.precio) + (n.envio ? " (envío incl. " + pesos(n.envio) + ")" : "") : "SIN PRECIO";
  t += " · costo " + pesos(n.costoTotal) + " (" + partes.join(", ") + ")";
  if (n.precio) t += " · " + (n.ganancia >= 0 ? "gana " + pesos(n.ganancia) : "PIERDE " + pesos(-n.ganancia)) + " (" + pct(n.margen) + ")";
  t += " · sugerido " + pesos(n.sugerido) + " (" + n.margenObjetivo + "%)";
  if (n.faltas.length) t += " · COSTO INCOMPLETO: falta " + n.faltas.join("; ");
  return t;
}

function lineaInsumo(c, ins) {
  const u = ins.unidad || "u";
  const cu = c.costoUso(ins);
  // Costo de uso por kg / litro / unidad: más fácil de leer que por gramo.
  const uso = u === "u" ? pesos2(cu) + "/u" : pesos(cu * 1000) + "/" + (u === "kg" ? "kg" : "l") + " útil";
  let t = "- " + ins.nombre + ": " + (ins.cantidad || "?") + " " + u + " a " + (ins.precio === "" || ins.precio == null ? "(sin precio)" : pesos(ins.precio));
  const extra = [];
  if (c.rendimiento(ins) < 100) extra.push("rend " + c.rendimiento(ins) + "%");
  if (c.merma(ins) > 0) extra.push("merma " + c.merma(ins) + "%");
  if (ins.packaging) extra.push("pack");
  if (extra.length) t += " (" + extra.join(", ") + ")";
  return t + " → " + uso;
}

// Texto con todos los datos del negocio, ya calculados. Va en las instrucciones de la IA.
export function armarContexto(estado) {
  const c = crearCostos(estado);
  const prods = Object.values(estado.productos || {});
  const venta = prods.filter((p) => !p.esPreparacion).sort((a, b) => categoriaDe(a).localeCompare(categoriaDe(b), "es") || String(a.nombre).localeCompare(String(b.nombre), "es"));
  const preps = prods.filter((p) => p.esPreparacion);
  const ins = Object.values(estado.insumos || {}).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), "es"));
  const gastos = Object.values(estado.gastos || {});
  const d = c.delivery();
  const L = [];
  L.push("PRODUCTOS DE VENTA (" + venta.length + "). Ganancia y % son por unidad, sin el envío incluido; el sugerido es para el % objetivo de cada uno:");
  venta.forEach((p) => L.push(lineaProducto(c, p)));
  if (preps.length) {
    L.push("", "PREPARACIONES PROPIAS (se usan dentro de otros productos):");
    preps.forEach((p) => {
      const { total } = c.costoProducto(p);
      const u = p.rindeUnidad || "g";
      L.push("- " + p.nombre + ": la tanda cuesta " + pesos(total) + (p.rinde > 0 ? " y rinde " + p.rinde + " " + u + " (" + (u === "u" ? pesos2(total / p.rinde) + " por unidad" : pesos2((total / p.rinde) * 100) + " cada 100 " + u) + ")" : " (falta cargar cuánto rinde)"));
    });
  }
  L.push("", "INSUMOS (" + ins.length + "): cantidad comprada a precio → costo de uso:");
  ins.forEach((i) => L.push(lineaInsumo(c, i)));
  L.push("", "GASTOS FIJOS DEL MES: total " + pesos(c.totalFijos()) + (gastos.length ? " (" + gastos.map((g) => g.nombre + " " + pesos(g.monto)).join(", ") + ")" : " (no cargó ninguno)") + ".");
  L.push(c.unidadesMes() ? "Vende " + c.unidadesMes() + " productos por mes, así que cada producto carga " + pesos(c.fijoPorUnidad()) + " de gastos fijos (una promo cuenta como los productos que trae)." : "No cargó cuántos productos vende por mes, así que los gastos fijos no se reparten en los costos.");
  L.push("", "DELIVERY: nafta " + pesos(d.naftaMes) + " por mes, " + (Number(d.pedidosMes) || 0) + " pedidos con delivery por mes, nafta por pedido " + pesos(c.naftaPorPedido()) + ", cobra de envío aparte " + pesos(d.cobroEnvio) + " por pedido.");
  return L.join("\n");
}

// ---------- Herramientas: cuentas que la IA pide en vez de hacerlas ella ----------
export const HERRAMIENTAS = [
  { type: "function", function: {
    name: "ver_receta",
    description: "Receta de un producto: cada insumo con cantidad, costo y peso en el costo.",
    parameters: { type: "object", properties: { producto: { type: "string" } }, required: ["producto"] },
  } },
  { type: "function", function: {
    name: "simular_precios_insumos",
    description: "Simula subas o bajas de precio de insumos: costo, ganancia y margen antes y después de cada producto afectado, y nuevo sugerido.",
    parameters: { type: "object", properties: { cambios: { type: "array", items: { type: "object", properties: {
      insumo: { type: "string" },
      porcentaje: { type: "number", description: "% de suba (o negativo si baja)" },
      precio_nuevo: { type: "number", description: "O el precio nuevo por la misma cantidad que compra hoy" },
    }, required: ["insumo"] } } }, required: ["cambios"] },
  } },
  { type: "function", function: {
    name: "precio_para_ganancia",
    description: "A cuánto vender un producto para ganar cierto % sobre el precio.",
    parameters: { type: "object", properties: { producto: { type: "string" }, porcentaje: { type: "number" } }, required: ["producto", "porcentaje"] },
  } },
  { type: "function", function: {
    name: "ventas_del_periodo",
    description: "Ventas reales de la caja entre dos fechas incluidas: por producto, total cobrado, costo y ganancia.",
    parameters: { type: "object", properties: { desde: { type: "string", description: "AAAA-MM-DD" }, hasta: { type: "string", description: "AAAA-MM-DD" } }, required: ["desde", "hasta"] },
  } },
];

const noEncontrado = (tipo, nombre, mapa) => ({ error: "No hay ningún " + tipo + " que se llame \"" + nombre + "\".", disponibles: Object.values(mapa || {}).map((x) => x.nombre) });
const ambiguo = (nombre, encontrados) => ({ error: "\"" + nombre + "\" coincide con varios. Preguntale al usuario cuál.", opciones: encontrados.map(([, x]) => x.nombre) });

function verReceta(estado, { producto }) {
  const r = buscar(estado.productos, producto);
  if (!r.length) return noEncontrado("producto", producto, estado.productos);
  if (r.length > 1) return ambiguo(producto, r);
  const p = r[0][1];
  const c = crearCostos(estado);
  const { total, filas, faltas } = c.costoProducto(p);
  return {
    producto: p.nombre,
    renglones: filas.map(({ it, info, c: costo }) => ({
      insumo: info.nombre, cantidad: (Number(it.cantidad) || 0) + " " + (info.unidad || ""), costo: pesos2(costo),
      peso_en_el_costo: total > 0 ? Math.round((costo / total) * 100) + "%" : "—", ...(info.packaging ? { packaging: true } : {}),
    })),
    total_insumos_y_packaging: pesos2(total),
    ...(p.esPreparacion ? { rinde: (p.rinde || "?") + " " + (p.rindeUnidad || "g") } : numerosVisibles(c, p)),
    ...(faltas.length ? { costo_incompleto_falta: faltas } : {}),
  };
}

function numerosVisibles(c, p) {
  const n = numerosProducto(c, p);
  return {
    costo_total: pesos(n.costoTotal), ...(n.fijo ? { gastos_fijos: pesos(n.fijo) } : {}),
    precio_de_venta: n.precio ? pesos(n.precio) : "sin cargar", ...(n.envio ? { envio_incluido: pesos(n.envio) } : {}),
    ganancia_por_unidad: n.ganancia == null ? "—" : pesos(n.ganancia), margen: pct(n.margen),
    precio_sugerido: pesos(n.sugerido) + " (para " + n.margenObjetivo + "%)",
  };
}

function simular(estado, { cambios }) {
  if (!Array.isArray(cambios) || !cambios.length) return { error: "Faltan los cambios." };
  const nuevo = structuredClone(estado);
  const aplicados = [];
  for (const ch of cambios) {
    const r = buscar(estado.insumos, ch.insumo);
    if (!r.length) return noEncontrado("insumo", ch.insumo, estado.insumos);
    if (r.length > 1) return ambiguo(ch.insumo, r);
    const [id, ins] = r[0];
    const antes = Number(ins.precio) || 0;
    const despues = ch.precio_nuevo != null ? Number(ch.precio_nuevo) : antes * (1 + (Number(ch.porcentaje) || 0) / 100);
    if (!(despues >= 0)) return { error: "El precio nuevo de " + ins.nombre + " no es válido." };
    nuevo.insumos[id] = { ...nuevo.insumos[id], precio: despues };
    aplicados.push({ id, insumo: ins.nombre, compra: ins.cantidad + " " + (ins.unidad || "u"), precio_antes: pesos(antes), precio_despues: pesos(despues),
      variacion: antes ? (despues >= antes ? "+" : "") + Math.round(((despues - antes) / antes) * 1000) / 10 + "%" : "—" });
  }
  const c0 = crearCostos(estado), c1 = crearCostos(nuevo);
  const productos = [];
  for (const [id, p] of Object.entries(estado.productos || {})) {
    if (p.esPreparacion) continue;
    const a = numerosProducto(c0, p), b = numerosProducto(c1, nuevo.productos[id]);
    if (Math.abs(b.costoTotal - a.costoTotal) < 0.005) continue;
    productos.push({
      producto: p.nombre, costo_antes: pesos(a.costoTotal), costo_despues: pesos(b.costoTotal), sube: pesos(b.costoTotal - a.costoTotal),
      ...(a.precio ? { precio_de_venta: pesos(a.precio), ganancia_antes: pesos(a.ganancia), ganancia_despues: pesos(b.ganancia), margen_antes: pct(a.margen), margen_despues: pct(b.margen) } : { precio_de_venta: "sin cargar" }),
      precio_sugerido_nuevo: pesos(b.sugerido) + " (para " + b.margenObjetivo + "%)",
    });
  }
  return { cambios: aplicados.map(({ id, ...x }) => x), productos_afectados: productos.length ? productos : "Ningún producto de venta usa esos insumos." };
}

function precioParaGanancia(estado, { producto, porcentaje }) {
  const r = buscar(estado.productos, producto);
  if (!r.length) return noEncontrado("producto", producto, estado.productos);
  if (r.length > 1) return ambiguo(producto, r);
  const p = r[0][1];
  if (p.esPreparacion) return { error: p.nombre + " es una preparación propia: no se vende sola." };
  const m = Math.min(Math.max(Number(porcentaje) || 0, 0), 95);
  const c = crearCostos(estado);
  const n = numerosProducto(c, p);
  const precio = c.precioSugerido(n.costoTotal, m, n.envio);
  return {
    producto: p.nombre, ganancia_buscada: m + "%", precio: pesos(precio) + " (redondeado a $100" + (n.envio ? ", incluye " + pesos(n.envio) + " de envío" : "") + ")",
    costo_total: pesos(n.costoTotal), ganancia_por_unidad_a_ese_precio: pesos(precio - n.envio - n.costoTotal),
    precio_actual: n.precio ? pesos(n.precio) : "sin cargar",
  };
}

// Suma las ventas confirmadas (filas de Supabase: ventas con sus venta_items) para la IA.
export function resumirVentas(ventas, desde, hasta, fijoPorUnidad = 0) {
  const porProd = {};
  let total = 0, descuentos = 0, envios = 0, costo = 0, ingresoProd = 0, unidades = 0;
  for (const v of ventas) {
    total += Number(v.total) || 0;
    descuentos += Number(v.descuento) || 0;
    envios += Number(v.cargo_envio) || 0;
    for (const it of v.venta_items || []) {
      const q = Number(it.cantidad) || 0;
      const ing = ((Number(it.precio_unitario) || 0) - (Number(it.envio_incluido_unitario) || 0)) * q;
      const cos = (Number(it.costo_unitario) || 0) * q;
      const k = it.nombre;
      porProd[k] = porProd[k] || { producto: k, cantidad: 0, ingreso: 0, costo: 0 };
      porProd[k].cantidad += q; porProd[k].ingreso += ing; porProd[k].costo += cos;
      ingresoProd += ing; costo += cos; unidades += q * (Number(it.unidades) || 1);
    }
  }
  const lista = Object.values(porProd).sort((a, b) => b.cantidad - a.cantidad).map((x) => ({
    producto: x.producto, cantidad: x.cantidad, ingreso_sin_envio: pesos(x.ingreso), costo_mercaderia: pesos(x.costo), ganancia_antes_de_fijos: pesos(x.ingreso - x.costo),
  }));
  const fijos = fijoPorUnidad * unidades;
  return {
    periodo: desde + " al " + hasta, ventas: ventas.length, cobrado_total: pesos(total), descuentos: pesos(descuentos), envios_cobrados_aparte: pesos(envios),
    costo_mercaderia: pesos(costo), ganancia_antes_de_gastos_fijos: pesos(ingresoProd - descuentos - costo),
    ...(fijos ? { gastos_fijos_que_corresponden: pesos(fijos), ganancia_estimada_despues_de_fijos: pesos(ingresoProd - descuentos - costo - fijos) } : {}),
    por_producto: lista.length ? lista : "No hubo ventas en ese período.",
    nota: "Ventas anuladas no cuentan. El costo es el que tenía cada producto el día que se vendió.",
  };
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

// Ejecuta una herramienta. "leerVentas(desde, hasta)" trae las ventas de la base (se inyecta para poder probar sin red).
export async function ejecutarHerramienta(nombre, args, { estado, leerVentas }) {
  try {
    if (nombre === "ver_receta") return verReceta(estado, args || {});
    if (nombre === "simular_precios_insumos") return simular(estado, args || {});
    if (nombre === "precio_para_ganancia") return precioParaGanancia(estado, args || {});
    if (nombre === "ventas_del_periodo") {
      const { desde, hasta } = args || {};
      if (!FECHA.test(desde || "") || !FECHA.test(hasta || "")) return { error: "Las fechas van como AAAA-MM-DD." };
      if (!leerVentas) return { error: "Las ventas no están disponibles." };
      return resumirVentas(await leerVentas(desde, hasta), desde, hasta, crearCostos(estado).fijoPorUnidad());
    }
    return { error: "No existe la herramienta " + nombre };
  } catch (e) {
    return { error: "No se pudo hacer la cuenta: " + (e.message || e) };
  }
}

// Fecha de hoy en Argentina (AAAA-MM-DD) y día de la semana, para que la IA entienda "hoy" o "esta semana".
export function hoyArgentina(ahora = new Date()) {
  const f = ahora.toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const dia = ahora.toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", weekday: "long" });
  return { fecha: f, dia };
}

export function instrucciones(nombreNegocio, contexto, ahora) {
  const h = hoyArgentina(ahora);
  return [
    "Sos el asistente de costos de \"" + nombreNegocio + "\", un negocio de comida argentino. Hablás con el dueño, de vos, simple y corto (2 a 6 renglones, sin tablas).",
    "Reglas: nunca inventes ni calcules números; usá los de los DATOS o los que devuelven las herramientas, tal cual. Para subas de insumos, precio para cierto %, recetas o ventas de un período, llamá a la herramienta.",
    "Si falta un dato, decilo y en qué pestaña se carga (Productos, Insumos, Gastos fijos, Delivery). Si dice COSTO INCOMPLETO, avisá que el costo real es más alto.",
    "Si hay gastos fijos cargados, la ganancia ya los descuenta. Solo hablá de este negocio y de la calculadora.",
    "Hoy es " + h.dia + " " + h.fecha + " (Argentina). La semana empieza el lunes.",
    "",
    "DATOS:",
    contexto,
  ].join("\n");
}
