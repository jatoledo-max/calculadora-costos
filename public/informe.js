// Cómo se muestra un informe de caja: el de la caja abierta, el de un cierre o la suma de varios días.
// No calcula nada del día: los números de cada caja vienen de la base (resumen_caja / la foto del cierre).
// sumarInformes junta varios cierres en uno, en centavos para no arrastrar errores de redondeo.
import { fmtPesos, aCentavos } from "./dinero.js";

export const MEDIOS = { efectivo: "Efectivo", transferencia: "Transferencia" };
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const hora = (iso) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });

// Campos que se suman tal cual de un cierre a otro.
const SUMABLES = ["ventas_brutas", "descuentos", "ventas_netas", "envios_cobrados", "total_cobrado", "costo_mercaderia", "packaging",
  "margen_bruto", "envio_incluido_en_precios", "gastos_fijos_estimados", "nafta_estimada", "gastos_operativos", "gastos_en_fijos",
  "resultado_estimado", "compras_mercaderia", "aportes", "retiros", "ajustes", "reserva_sugerida", "reserva_apartada",
  "diferencia_efectivo", "anuladas_total", "anulaciones_anteriores_total"];
// No se suman: saldos (efectivo esperado, disponible, pagos pendientes) que pasan de un día al otro.
const CONTABLES = ["ventas", "unidades", "pedidos_con_envio", "ventas_costo_incompleto", "anuladas"];

// Suma los informes de varios cierres (la foto que guardó cada uno). Devuelve un informe con la misma forma, más:
// periodo: true, cajas, cajas_con_diferencia, faltante y sobrante (en pesos).
export function sumarInformes(lista) {
  const c = {}, n = {}, prod = {}, medio = {};
  SUMABLES.forEach((k) => { c[k] = 0; });
  CONTABLES.forEach((k) => { n[k] = 0; });
  let faltante = 0, sobrante = 0, conDif = 0;
  const incompletos = new Set();
  lista.forEach((r) => {
    SUMABLES.forEach((k) => { c[k] += aCentavos(r[k]); });
    CONTABLES.forEach((k) => { n[k] += Number(r[k]) || 0; });
    const d = aCentavos(r.diferencia_efectivo);
    if (d < 0) faltante -= d; else sobrante += d;
    if (d) conDif++;
    (r.productos_costo_incompleto || []).forEach((x) => incompletos.add(x));
    (r.por_producto || []).forEach((x) => {
      const p = prod[x.nombre] || (prod[x.nombre] = { nombre: x.nombre, cantidad: 0, ventas: 0, costo: 0, costo_incompleto: false });
      p.cantidad += Number(x.cantidad) || 0; p.ventas += aCentavos(x.ventas); p.costo += aCentavos(x.costo);
      p.costo_incompleto = p.costo_incompleto || !!x.costo_incompleto;
    });
    Object.entries(r.por_medio || {}).forEach(([m, v]) => { medio[m] = (medio[m] || 0) + aCentavos(v); });
  });
  const r = { periodo: true, cajas: lista.length, cajas_con_diferencia: conDif, faltante: faltante / 100, sobrante: sobrante / 100 };
  SUMABLES.forEach((k) => { r[k] = c[k] / 100; });
  Object.assign(r, n);
  r.margen_pct = c.ventas_netas > 0 ? Math.round((c.margen_bruto * 1000) / c.ventas_netas) / 10 : null;
  r.productos_costo_incompleto = [...incompletos];
  r.por_producto = Object.values(prod).map((p) => ({ nombre: p.nombre, cantidad: p.cantidad, ventas: p.ventas / 100, costo: p.costo / 100,
    margen: (p.ventas - p.costo) / 100, costo_incompleto: p.costo_incompleto })).sort((a, b) => b.ventas - a.ventas || a.nombre.localeCompare(b.nombre, "es"));
  r.por_medio = Object.fromEntries(Object.entries(medio).map(([k, v]) => [k, v / 100]));
  return r;
}

// Dibuja el informe dentro de "box" (no borra lo que ya hay). cerrada: foto de un cierre. r.periodo: suma de varios días.
export function pintarInforme(box, r, { cerrada = false } = {}) {
  const periodo = !!r.periodo;
  if (cerrada && !periodo) {
    const d = new Date(r.cerrada_en);
    box.appendChild(el("p", "hint", "Abierta el " + new Date(r.abierta_en).toLocaleDateString("es-AR") + " a las " + hora(r.abierta_en) +
      ", cerrada el " + d.toLocaleDateString("es-AR") + " a las " + hora(d) + ". Este informe ya no cambia."));
  }

  const kpis = el("div", "res-kpis");
  const kpi = (k, v, nota, cls) => {
    const d = el("div", "res-kpi" + (cls ? " " + cls : ""));
    d.append(el("span", "k", k), el("span", "v num", v)); // los cuadros grandes van sin centavos; el detalle los muestra
    if (nota) d.appendChild(el("span", "note", nota));
    kpis.appendChild(d);
  };
  kpi("Ventas netas", fmtPesos(Math.round(r.ventas_netas)), r.ventas + (r.ventas === 1 ? " venta" : " ventas") + (periodo ? " en " + r.cajas + (r.cajas === 1 ? " caja" : " cajas") : ""));
  kpi("Costo de mercadería", fmtPesos(Math.round(r.costo_mercaderia)), "insumos y packaging");
  kpi("Margen bruto", fmtPesos(Math.round(r.margen_bruto)), r.margen_pct != null ? r.margen_pct.toLocaleString("es-AR") + "% de las ventas netas" : "");
  kpi("Resultado estimado", fmtPesos(Math.round(r.resultado_estimado)), "después de gastos, gastos fijos y nafta", "hl");
  if (periodo) {
    const dif = Number(r.diferencia_efectivo);
    kpi("Diferencias de caja", dif ? fmtPesos(Math.round(dif)) : "$ 0",
      r.cajas_con_diferencia ? r.cajas_con_diferencia + (r.cajas_con_diferencia === 1 ? " caja" : " cajas") + " con diferencia" : "todas coincidieron", dif ? "mal" : "");
  } else if (cerrada) {
    const dif = Number(r.diferencia_efectivo);
    kpi("Diferencia de efectivo", dif ? fmtPesos(Math.round(dif)) : "$ 0", dif < 0 ? "falta plata" : dif > 0 ? "sobra plata" : "coincide", dif ? "mal" : "");
    kpi("Disponible para retirar", fmtPesos(Math.round(r.disponible_estimado)), "estimado", "hl");
  }
  box.appendChild(kpis);

  if (r.ventas_costo_incompleto) {
    const a = el("div", "aviso-falta");
    a.append(el("b", null, "Rentabilidad provisional: "), document.createTextNode(
      r.ventas_costo_incompleto + (r.ventas_costo_incompleto === 1 ? " venta tiene" : " ventas tienen") + " productos con costo incompleto (" +
      r.productos_costo_incompleto.join(", ") + "). El costo real es más alto: completá sus recetas en Productos."));
    box.appendChild(a);
  }

  // Cada pregunta en su tabla, cada concepto por separado.
  const tabla = (titulo, filas) => {
    box.appendChild(el("h3", "res-sub", titulo));
    const t = el("table", "res-tabla");
    filas.filter(Boolean).forEach(([k, v, cls]) => { const tr = el("tr", cls || ""); tr.append(el("td", null, k), el("td", "r num", v)); t.appendChild(tr); });
    box.appendChild(t);
  };
  tabla(periodo ? "¿Cuánto gané en estos días?" : "¿Cuánto gané?", [
    ["Ventas brutas (precio de lista)", fmtPesos(r.ventas_brutas)],
    r.descuentos ? ["− Descuentos", fmtPesos(r.descuentos)] : null,
    ["= Ventas netas", fmtPesos(r.ventas_netas), "tot"],
    ["− Costo de mercadería vendida", fmtPesos(r.costo_mercaderia)],
    ["= Margen bruto", fmtPesos(r.margen_bruto), "tot"],
    r.envios_cobrados ? ["+ Envíos cobrados aparte", fmtPesos(r.envios_cobrados)] : null,
    r.gastos_operativos ? ["− Gastos del día" + (periodo ? " (todos los días)" : ""), fmtPesos(r.gastos_operativos)] : null,
    periodo
      ? ["− Gastos fijos estimados (" + r.unidades + " productos)", fmtPesos(r.gastos_fijos_estimados)]
      : ["− Gastos fijos estimados (" + r.unidades + " productos × " + fmtPesos(r.gasto_fijo_por_unidad) + ")", fmtPesos(r.gastos_fijos_estimados)],
    periodo
      ? ["− Nafta estimada (" + r.pedidos_con_envio + (r.pedidos_con_envio === 1 ? " pedido" : " pedidos") + ")", fmtPesos(r.nafta_estimada)]
      : ["− Nafta estimada (" + r.pedidos_con_envio + (r.pedidos_con_envio === 1 ? " pedido" : " pedidos") + " × " + fmtPesos(r.nafta_por_pedido) + ")", fmtPesos(r.nafta_estimada)],
    ["= Resultado estimado", fmtPesos(r.resultado_estimado), "tot hl"],
  ]);
  const notas = [];
  if (r.gastos_en_fijos) notas.push(fmtPesos(r.gastos_en_fijos) + " de gastos pagados ya están en tus gastos fijos: no se restan de nuevo.");
  if (r.compras_mercaderia) notas.push("Las compras de mercadería (" + fmtPesos(r.compras_mercaderia) + ") no restan del resultado: ese costo entra cuando vendés.");
  if (notas.length) box.appendChild(el("p", "hint", notas.join(" ")));

  if (periodo) {
    // Los saldos de cada día no se suman (el fondo de ayer es el de hoy): se muestra lo que entró y salió y las diferencias.
    tabla("Plata de estos días", [
      ["Cobrado en total", fmtPesos(r.total_cobrado)],
      ...Object.entries(r.por_medio || {}).map(([m, v]) => ["   " + (MEDIOS[m] || m), fmtPesos(v)]),
      r.compras_mercaderia ? ["Compras de mercadería", fmtPesos(r.compras_mercaderia)] : null,
      r.retiros ? ["Retiros", fmtPesos(r.retiros)] : null,
      r.aportes ? ["Aportes", fmtPesos(r.aportes)] : null,
      ["Faltó en las cajas", fmtPesos(r.faltante), r.faltante ? "mal" : ""],
      ["Sobró en las cajas", fmtPesos(r.sobrante)],
      ["Reserva sugerida para reponer (costo de lo vendido)", fmtPesos(r.reserva_sugerida)],
      ["Reserva que apartaste", fmtPesos(r.reserva_apartada)],
    ]);
  } else {
    tabla("¿Cuánta plata tiene que haber?", [
      ["Efectivo al abrir", fmtPesos(r.saldo_inicial)],
      ["+ Cobrado en efectivo", fmtPesos(r.cobrado_efectivo)],
      Number(r.movimientos_efectivo) ? ["± Gastos, compras, retiros, aportes y ajustes en efectivo", fmtPesos(r.movimientos_efectivo)] : null,
      ["= Efectivo esperado", fmtPesos(r.efectivo_esperado), "tot"],
      cerrada ? ["Efectivo contado", fmtPesos(r.efectivo_contado)] : null,
      cerrada ? ["Diferencia", fmtPesos(r.diferencia_efectivo), "tot" + (Number(r.diferencia_efectivo) ? " mal" : "")] : null,
      ["Cobrado por transferencia", fmtPesos(r.cobrado_transferencia)],
      Number(r.movimientos_transferencia) ? ["± Pagado o recibido por transferencia", fmtPesos(r.movimientos_transferencia)] : null,
      ["= Transferencias esperadas", fmtPesos(r.transferencias_esperadas), "tot"],
      cerrada && r.transferencias_banco != null ? ["Lo que viste en el banco", fmtPesos(r.transferencias_banco)] : null,
      cerrada && r.transferencias_banco != null ? ["Diferencia", fmtPesos(r.diferencia_transferencias), "tot" + (Number(r.diferencia_transferencias) ? " mal" : "")] : null,
    ]);
    if (cerrada) {
      const banco = r.transferencias_banco != null;
      tabla("¿Cuánto puedo retirar?", [
        ["Efectivo contado", fmtPesos(r.efectivo_contado)],
        ["+ Transferencias del día" + (banco ? " (lo que viste en el banco)" : " (esperadas)"), fmtPesos(banco ? r.transferencias_banco : r.transferencias_esperadas)],
        ["− Fondo que queda para mañana", fmtPesos(r.fondo_siguiente)],
        ["− Reserva apartada", fmtPesos(r.reserva_apartada)],
        Number(r.obligaciones_pendientes) ? ["− Pagos pendientes", fmtPesos(r.obligaciones_pendientes)] : null,
        ["= Disponible estimado para retirar", fmtPesos(r.disponible_estimado), "tot hl"],
      ]);
      (r.obligaciones || []).forEach((o) => box.appendChild(el("p", "hint", "Pago pendiente: " + o.nombre + " " + fmtPesos(o.monto) + (o.vence ? " (vence el " + fechaCorta(o.vence) + ")" : "") + ".")));
    } else if (r.reserva_apartada) {
      box.appendChild(el("p", "hint", "Reserva apartada: " + fmtPesos(r.reserva_apartada) + "."));
    }
    box.appendChild(el("p", "hint", "Reserva sugerida para reponer mercadería: " + fmtPesos(r.reserva_sugerida) + " (lo que costó lo que vendiste)." +
      (cerrada && Number(r.reserva_apartada) < Number(r.reserva_sugerida) ? " Apartaste " + fmtPesos(r.reserva_apartada) + "." : "")));
  }

  if (r.anuladas) box.appendChild(el("p", "hint", (r.anuladas === 1 ? "1 venta anulada" : r.anuladas + " ventas anuladas") + (periodo ? "" : " en esta caja") +
    " (" + fmtPesos(r.anuladas_total) + "): " + (r.anuladas === 1 ? "no cuenta" : "no cuentan") + " en nada."));
  (r.anulaciones_anteriores || []).forEach((x) => box.appendChild(el("p", "hint",
    "Anulación de un día anterior: Venta " + x.venta + " de la Caja " + x.caja + ", " + fmtPesos(x.total) + " (" + x.motivo + "). El cierre de ese día no cambia; si devolviste plata, cargala como retiro.")));
  if (cerrada && r.observaciones) { const o = el("p", "hint"); o.append(el("b", null, "Observaciones: "), document.createTextNode(r.observaciones)); box.appendChild(o); }

  if (r.por_producto.length) {
    const tp = el("table", "res-prod");
    tp.innerHTML = "<thead><tr><th>Producto</th><th class='r'>Cant.</th><th class='r'>Ventas</th><th class='r'>Costo</th><th class='r'>Margen</th></tr></thead>";
    const tb = el("tbody");
    r.por_producto.forEach((x) => {
      const tr = el("tr");
      const nm = el("td", null, x.nombre);
      if (x.costo_incompleto) nm.append(" ", el("span", "tag falta", "costo incompleto"));
      tr.append(nm, el("td", "r num", String(x.cantidad)), el("td", "r num", fmtPesos(x.ventas)), el("td", "r num", fmtPesos(x.costo)), el("td", "r num", fmtPesos(x.margen)));
      tb.appendChild(tr);
    });
    tp.appendChild(tb);
    const wrap = el("div", "tbl-wrap"); wrap.appendChild(tp);
    box.appendChild(wrap);
  }
  box.appendChild(el("p", "hint", "El resultado es una estimación, no la ganancia contable. El disponible no descuenta impuestos ni compras futuras que no hayas cargado. Los descuentos se restan del total, no de cada producto."));
}

// "2026-10-17" → "17/10"
export function fechaCorta(iso) {
  const [, m, d] = String(iso).split("-");
  return d && m ? Number(d) + "/" + Number(m) : String(iso);
}

// Total de los pagos pendientes cargados en Informes (ajustes "obligaciones"), con la misma regla que la base:
// solo cuentan los montos válidos mayores a 0.
export function totalPendientes(obligaciones) {
  const items = (obligaciones && Array.isArray(obligaciones.items)) ? obligaciones.items : [];
  return items.reduce((a, o) => a + (/^\d{1,10}(\.\d+)?$/.test(String(o.monto)) ? aCentavos(o.monto) : 0), 0) / 100;
}
