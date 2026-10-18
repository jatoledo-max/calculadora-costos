// Cálculos de costos, sin pantalla: los usan la calculadora y la caja, así la cuenta existe una sola vez.
// "estado" es un objeto con insumos, productos, gastos y ajustes (se leen en cada llamada, así siempre están al día).

import { redondear } from "./dinero.js";

export const UNID = { kg: { base: "g", f: 1000 }, l: { base: "ml", f: 1000 }, u: { base: "u", f: 1 } };

// Categoría de un producto (opcional): la que puso el usuario, o una según el tipo.
// Orden: las categorías propias por nombre, después Promos, Extras y Otros. La usan la lista de Productos y la caja.
export const categoriaDe = (p) => (p.categoria || "").trim() || (p.tipo === "promo" ? "Promos" : p.tipo === "extra" ? "Extras" : "Otros");
export function ordenarCategorias(cats) {
  const peso = (c) => (c === "Promos" ? 1 : c === "Extras" ? 2 : c === "Otros" ? 3 : 0);
  return [...new Set(cats)].sort((a, b) => peso(a) - peso(b) || a.localeCompare(b, "es"));
}

export function crearCostos(estado) {
  // Rendimiento: cuánto producto útil sale de lo comprado (100% si no se cargó).
  // Merma: lo que se pierde al preparar, cocinar o por vencimiento (0% si no se cargó).
  const rendimiento = (ins) => (Number(ins.rendimiento) > 0 ? Math.min(Number(ins.rendimiento), 100) : 100);
  const merma = (ins) => Math.min(Math.max(Number(ins.merma) || 0, 0), 95);
  function costoUso(ins) {
    // costo por g / ml / u útil = (precio de compra / rendimiento) / (1 − merma):
    // si se pierde un 30%, para usar 70 g hay que preparar 100 g.
    if (!ins || !ins.cantidad || !ins.precio) return 0;
    const bruto = ins.precio / (ins.cantidad * UNID[ins.unidad || "u"].f);
    return bruto / (rendimiento(ins) / 100) / (1 - merma(ins) / 100);
  }

  // Un renglón de receta apunta a un insumo ({insumo}), a una preparación propia ({prep})
  // o, en las promos, a otro producto de venta ({producto}, por unidad).
  // "reemplazos" ({idInsumo: idOtroInsumo}) sirve para las opciones, como pan árabe en vez de pan francés.
  function itemInfo(it, depth, reemplazos) {
    if (it.producto) {
      const pr = estado.productos[it.producto];
      if (!pr) return { nombre: "(producto borrado)", unidad: "u", cu: 0, faltas: ["un producto de la promo fue borrado"] };
      const sub = depth < 5 ? costoProducto(pr, depth + 1, reemplazos) : { total: 0, packaging: 0, faltas: [] };
      // Sin packaging: la promo usa un envase compartido en vez de la caja propia de cada producto.
      const pack = it.sinPackaging ? 0 : sub.packaging;
      return { nombre: pr.nombre, unidad: "u", cu: sub.total - sub.packaging + pack, packU: pack, producto: true, faltas: sub.faltas.slice() };
    }
    if (it.prep) {
      const pr = estado.productos[it.prep];
      if (!pr) return { nombre: "(preparación borrada)", unidad: "", cu: 0, faltas: ["una preparación de la receta fue borrada"] };
      const sub = depth < 5 ? costoProducto(pr, depth + 1, reemplazos) : { total: 0, faltas: [] };
      const cu = pr.rinde > 0 ? sub.total / pr.rinde : 0;
      const faltas = sub.faltas.slice();
      if (!(pr.rinde > 0)) faltas.push("cuánto rinde la preparación " + pr.nombre);
      return { nombre: pr.nombre, unidad: pr.rindeUnidad || "g", cu, prep: true, faltas };
    }
    const insId = reemplazos && reemplazos[it.insumo] ? reemplazos[it.insumo] : it.insumo;
    const ins = estado.insumos[insId];
    if (!ins) return { nombre: "(insumo borrado)", unidad: "", cu: 0, faltas: ["un insumo de la receta fue borrado"] };
    const faltas = !(Number(ins.cantidad) > 0) || ins.precio == null || ins.precio === "" ? ["la cantidad o el precio de compra de " + ins.nombre + " (pestaña Insumos)"] : [];
    return { nombre: ins.nombre, unidad: UNID[ins.unidad].base, cu: costoUso(ins), packaging: !!ins.packaging, faltas };
  }

  function costoProducto(p, depth, reemplazos) {
    depth = depth || 0;
    // faltas: datos sin cargar que hacen que el costo dé más bajo que el real.
    let total = 0, packaging = 0;
    const faltas = [];
    const filas = (p.items || []).map((it) => {
      const info = itemInfo(it, depth, reemplazos);
      const cant = Number(it.cantidad) || 0;
      const c = info.cu * cant;
      total += c;
      if (info.packaging) packaging += c;
      if (info.producto) packaging += info.packU * cant;
      info.faltas.forEach((f) => { if (!faltas.includes(f)) faltas.push(f); });
      if (!(cant > 0)) faltas.push("la cantidad de " + info.nombre + " en la receta");
      return { it, info, c };
    });
    return { total, packaging, filas, faltas };
  }

  // Cuántos productos "cuenta" uno: 1, salvo las promos, que suman los productos que llevan
  // (la promo de 3 lomitos son 3). Sirve para repartir los gastos fijos por producto vendido.
  function unidadesDe(p, depth) {
    depth = depth || 0;
    const prods = (p && p.items || []).filter((it) => it.producto && estado.productos[it.producto]);
    if (!prods.length || depth >= 5) return 1;
    return prods.reduce((a, it) => a + (Number(it.cantidad) || 0) * unidadesDe(estado.productos[it.producto], depth + 1), 0) || 1;
  }

  // Opciones de un producto (por ejemplo "Pan árabe"): cambian un insumo de la receta por otro.
  const opcionDe = (p, opcionId) => (opcionId && p && (p.opciones || []).find((o) => o.id === opcionId)) || null;
  function costoConOpcion(p, opcionId) {
    const op = opcionDe(p, opcionId);
    return costoProducto(p, 0, op && op.reemplaza && op.por ? { [op.reemplaza]: op.por } : null);
  }

  // Lo que la caja guarda como foto de cada renglón: costo de insumos + packaging, sin gastos fijos,
  // redondeado a centavos una sola vez.
  function costoParaVenta(productoId, opcionId) {
    const p = estado.productos[productoId];
    if (!p) return { costo_unitario: 0, packaging_unitario: 0, costo_incompleto: true, faltas: ["el producto fue borrado"] };
    const r = costoConOpcion(p, opcionId);
    const faltas = r.faltas.slice();
    if (!(p.items || []).length) faltas.push("la receta de " + (p.nombre || "este producto"));
    return { costo_unitario: redondear(r.total), packaging_unitario: redondear(r.packaging), costo_incompleto: faltas.length > 0, faltas, unidades: Math.max(1, Math.round(unidadesDe(p))) };
  }

  // El envío incluido en el precio se suma aparte: no lleva margen porque es para pagar el delivery.
  function precioSugerido(costo, margen, envio) {
    const m = Math.min(Math.max(Number(margen) || 0, 0), 95) / 100;
    const p = costo / (1 - m) + (Number(envio) || 0);
    return Math.ceil(p / 100) * 100; // redondeo a $100
  }
  const margenReal = (costo, precio) => (precio > 0 ? (1 - costo / precio) * 100 : null);

  // Gastos fijos: se reparten en partes iguales entre todo lo que se vende en el mes.
  const totalFijos = () => Object.values(estado.gastos || {}).reduce((a, g) => a + (Number(g.monto) || 0), 0);
  const unidadesMes = () => Number(((estado.ajustes || {}).general || {}).unidadesMes) || 0;
  const fijoPorUnidad = () => (unidadesMes() > 0 ? totalFijos() / unidadesMes() : 0);

  // Delivery: la nafta se reparte entre los pedidos con delivery, no entre los productos.
  const delivery = () => (estado.ajustes || {}).delivery || {};
  const naftaPorPedido = () => (Number(delivery().pedidosMes) > 0 ? (Number(delivery().naftaMes) || 0) / Number(delivery().pedidosMes) : 0);
  const envioIncl = (p) => (p && !p.esPreparacion ? Math.max(Number(p.envioIncluido) || 0, 0) : 0);

  return {
    rendimiento, merma, costoUso, itemInfo, costoProducto, unidadesDe, opcionDe, costoConOpcion, costoParaVenta,
    precioSugerido, margenReal, totalFijos, unidadesMes, fijoPorUnidad, delivery, naftaPorPedido, envioIncl,
  };
}
