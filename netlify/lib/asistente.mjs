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

function lineaProducto(c, p) {
  const n = numerosProducto(c, p);
  const partes = [pesos(n.insumos) + " insumos"];
  if (n.packaging) partes.push(pesos(n.packaging) + " packaging");
  if (n.fijo) partes.push(pesos(n.fijo) + " gastos fijos");
  let t = "- " + p.nombre + " [" + categoriaDe(p) + "]: ";
  t += n.precio ? "vende a " + pesos(n.precio) + (n.envio ? " (de eso " + pesos(n.envio) + " es envío incluido)" : "") : "sin precio de venta cargado";
  t += " · costo total " + pesos(n.costoTotal) + " (" + partes.join(" + ") + ")";
  if (n.precio) t += " · " + (n.ganancia >= 0 ? "gana " + pesos(n.ganancia) : "PIERDE " + pesos(-n.ganancia)) + " por unidad · margen " + pct(n.margen);
  t += " · precio sugerido " + pesos(n.sugerido) + " para " + n.margenObjetivo + "% de " + (n.fijo ? "ganancia" : "margen");
  if (n.faltas.length) t += " · COSTO INCOMPLETO, falta: " + n.faltas.join("; ");
  return t;
}

function lineaInsumo(c, ins) {
  const u = ins.unidad || "u";
  const base = UNID[u] ? UNID[u].base : "u";
  const cu = c.costoUso(ins);
  // Costo de uso por kg / litro / unidad: más fácil de leer que por gramo.
  const uso = u === "u" ? pesos2(cu) + " por unidad" : pesos(cu * 1000) + " por " + (u === "kg" ? "kg" : "litro") + " útil (" + pesos2(cu) + " por " + base + ")";
  let t = "- " + ins.nombre + ": compra " + (ins.cantidad || "?") + " " + u + " a " + (ins.precio === "" || ins.precio == null ? "(sin precio)" : pesos(ins.precio));
  if (c.rendimiento(ins) < 100) t += ", rendimiento " + c.rendimiento(ins) + "%";
  if (c.merma(ins) > 0) t += ", merma " + c.merma(ins) + "%";
  t += " · costo de uso " + uso;
  if (ins.packaging) t += " · packaging";
  if (ins.actualizado) t += " · precio actualizado el " + new Date(ins.actualizado).toLocaleDateString("es-AR", { timeZone: "America/Argentina/Buenos_Aires" });
  return t;
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
  L.push("PRODUCTOS DE VENTA (" + venta.length + "):");
  venta.forEach((p) => L.push(lineaProducto(c, p)));
  if (preps.length) {
    L.push("", "PREPARACIONES PROPIAS (se usan dentro de otros productos):");
    preps.forEach((p) => {
      const { total } = c.costoProducto(p);
      const u = p.rindeUnidad || "g";
      L.push("- " + p.nombre + ": la tanda cuesta " + pesos(total) + (p.rinde > 0 ? " y rinde " + p.rinde + " " + u + " (" + (u === "u" ? pesos2(total / p.rinde) + " por unidad" : pesos2((total / p.rinde) * 100) + " cada 100 " + u) + ")" : " (falta cargar cuánto rinde)"));
    });
  }
  L.push("", "INSUMOS (" + ins.length + "):");
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
    description: "Receta de un producto o preparación: cada insumo con su cantidad, su costo y cuánto pesa en el costo. Usala para preguntas sobre qué lleva un producto o qué insumo lo encarece.",
    parameters: { type: "object", properties: { producto: { type: "string", description: "Nombre del producto, como figura en los datos" } }, required: ["producto"] },
  } },
  { type: "function", function: {
    name: "simular_precios_insumos",
    description: "Simula que cambia el precio de compra de uno o más insumos y devuelve, para cada producto afectado, el costo, la ganancia y el margen antes y después, y el nuevo precio sugerido. Usala para preguntas del tipo 'si la carne sube 15%' o 'si el pan pasa a $7000'.",
    parameters: { type: "object", properties: { cambios: { type: "array", items: { type: "object", properties: {
      insumo: { type: "string", description: "Nombre del insumo" },
      porcentaje: { type: "number", description: "Cuánto sube (positivo) o baja (negativo) en %, por ejemplo 15 o -10" },
      precio_nuevo: { type: "number", description: "Nuevo precio de compra en pesos por la misma cantidad que compra hoy (en vez de porcentaje)" },
    }, required: ["insumo"] } } }, required: ["cambios"] },
  } },
  { type: "function", function: {
    name: "precio_para_ganancia",
    description: "Calcula a cuánto tendría que vender un producto para ganar un porcentaje dado (sobre el precio de venta), con la misma fórmula y redondeo de la calculadora.",
    parameters: { type: "object", properties: { producto: { type: "string" }, porcentaje: { type: "number", description: "Ganancia buscada en %, entre 0 y 95" } }, required: ["producto", "porcentaje"] },
  } },
  { type: "function", function: {
    name: "ventas_del_periodo",
    description: "Lo que se vendió de verdad en la caja entre dos fechas (incluidas): cantidad por producto, plata que entró, costo de mercadería y ganancia antes de gastos fijos. Usala para preguntas sobre lo vendido (hoy, esta semana, este mes, qué se vende más).",
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
    "Sos el asistente de la calculadora de costos de \"" + nombreNegocio + "\", un negocio de comida de Argentina. Hablás con el dueño.",
    "Respondé en español rioplatense (vos), simple y corto: 2 a 6 renglones, sin vueltas. Usá listas cortas solo si ayudan. Nada de tablas.",
    "REGLAS DE NÚMEROS (muy importantes):",
    "- Nunca inventes precios, costos ni cantidades. Usá solo los números de los DATOS de abajo o los que devuelven las herramientas, tal cual.",
    "- No hagas cuentas vos. Si la pregunta necesita una cuenta que no está en los datos (subas de insumos, precio para cierto margen, ventas de un período, detalle de una receta), llamá a la herramienta que corresponde.",
    "- Si un dato no está cargado, decilo y explicá en qué pestaña cargarlo (Productos, Insumos, Gastos fijos, Delivery).",
    "- Si un producto dice COSTO INCOMPLETO, avisá que su costo real es más alto.",
    "- \"Margen\" y \"ganancia\" son porcentajes sobre el precio de venta, sin contar el envío incluido. Si hay gastos fijos cargados, la ganancia ya los descuenta.",
    "- Solo hablá de este negocio y de sus costos, precios, ventas y cómo usar la calculadora. Si te preguntan otra cosa, decí amablemente que solo ayudás con eso.",
    "Hoy es " + h.dia + " " + h.fecha + " (hora de Argentina). La semana empieza el lunes.",
    "",
    "DATOS DEL NEGOCIO (ya calculados por la calculadora):",
    contexto,
  ].join("\n");
}
