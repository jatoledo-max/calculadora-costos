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
// dias: [{ fecha, ventas, resultado }] para el gráfico por día de un período.
// Arriba van los números clave y los gráficos; las cuentas completas quedan en un desplegable ("Ver todas las cuentas").
export function pintarInforme(box, r, { cerrada = false, dias = null } = {}) {
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
  const gan = Math.round(r.resultado_estimado);
  kpi(gan < 0 ? "Pérdida total" : "Ganancia total", fmtPesos(gan), r.margen_pct != null ? "estimada · margen bruto " + r.margen_pct.toLocaleString("es-AR") + "%" : "estimada, después de gastos", gan < 0 ? "perdida" : "ganancia");
  if (periodo) {
    const dif = Number(r.diferencia_efectivo);
    kpi("Diferencias de caja", dif ? fmtPesos(Math.round(dif)) : "$ 0",
      r.cajas_con_diferencia ? r.cajas_con_diferencia + (r.cajas_con_diferencia === 1 ? " caja" : " cajas") + " con diferencia" : "todas coincidieron", dif ? "mal" : "");
  } else if (cerrada) {
    const dif = Number(r.diferencia_efectivo);
    kpi("Diferencia de efectivo", dif ? fmtPesos(Math.round(dif)) : "$ 0", dif < 0 ? "falta plata" : dif > 0 ? "sobra plata" : "coincide", dif ? "mal" : "");
    kpi("Disponible para retirar", fmtPesos(Math.round(r.disponible_estimado)), "estimado", "hl");
  } else {
    kpi("Efectivo esperado", fmtPesos(Math.round(r.efectivo_esperado)), "lo que tendría que haber en la caja");
  }
  box.appendChild(kpis);

  if (r.ventas_costo_incompleto) {
    const a = el("div", "aviso-falta");
    a.append(el("b", null, "Rentabilidad provisional: "), document.createTextNode(
      r.ventas_costo_incompleto + (r.ventas_costo_incompleto === 1 ? " venta tiene" : " ventas tienen") + " productos con costo incompleto (" +
      r.productos_costo_incompleto.join(", ") + "). El costo real es más alto: completá sus recetas en Productos."));
    box.appendChild(a);
  }

  // ---------- Gráficos ----------
  if (periodo && dias && dias.filter((x) => x.ventas || x.resultado).length >= 2) graficoDias(box, dias);
  graficoPlata(box, r);
  graficoProductos(box, r);
  graficoMedios(box, r);

  // Avisos que importan: siempre a la vista.
  if (r.anuladas) box.appendChild(el("p", "hint", (r.anuladas === 1 ? "1 venta anulada" : r.anuladas + " ventas anuladas") + (periodo ? "" : " en esta caja") +
    " (" + fmtPesos(r.anuladas_total) + "): " + (r.anuladas === 1 ? "no cuenta" : "no cuentan") + " en nada."));
  (r.anulaciones_anteriores || []).forEach((x) => box.appendChild(el("p", "hint",
    "Anulación de un día anterior: Venta " + x.venta + " de la Caja " + x.caja + ", " + fmtPesos(x.total) + " (" + x.motivo + "). El cierre de ese día no cambia; si devolviste plata, cargala como retiro.")));
  if (cerrada && r.observaciones) { const o = el("p", "hint"); o.append(el("b", null, "Observaciones: "), document.createTextNode(r.observaciones)); box.appendChild(o); }

  // ---------- Cuentas completas, en un desplegable ----------
  const det = el("details", "cuentas");
  det.appendChild(el("summary", null, "Ver todas las cuentas"));
  box.appendChild(det);
  // Cada pregunta en su tabla, cada concepto por separado.
  const tabla = (titulo, filas) => {
    det.appendChild(el("h3", "res-sub", titulo));
    const t = el("table", "res-tabla");
    filas.filter(Boolean).forEach(([k, v, cls]) => { const tr = el("tr", cls || ""); tr.append(el("td", null, k), el("td", "r num", v)); t.appendChild(tr); });
    det.appendChild(t);
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
  if (notas.length) det.appendChild(el("p", "hint", notas.join(" ")));

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
      (r.obligaciones || []).forEach((o) => det.appendChild(el("p", "hint", "Pago pendiente: " + o.nombre + " " + fmtPesos(o.monto) + (o.vence ? " (vence el " + fechaCorta(o.vence) + ")" : "") + ".")));
    } else if (r.reserva_apartada) {
      det.appendChild(el("p", "hint", "Reserva apartada: " + fmtPesos(r.reserva_apartada) + "."));
    }
    det.appendChild(el("p", "hint", "Reserva sugerida para reponer mercadería: " + fmtPesos(r.reserva_sugerida) + " (lo que costó lo que vendiste)." +
      (cerrada && Number(r.reserva_apartada) < Number(r.reserva_sugerida) ? " Apartaste " + fmtPesos(r.reserva_apartada) + "." : "")));
  }

  if (r.por_producto.length) {
    det.appendChild(el("h3", "res-sub", "Por producto"));
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
    det.appendChild(wrap);
  }
  det.appendChild(el("p", "hint", "El resultado es una estimación, no la ganancia contable. El disponible no descuenta impuestos ni compras futuras que no hayas cargado. Los descuentos se restan del total, no de cada producto."));
}

// ---------- Gráficos (HTML y CSS, sin librerías: se ven igual sin internet) ----------
// Cada gráfico lleva su título y una frase que dice lo principal, para no tener que leer las barras.
const pct = (parte, total) => (total > 0 ? Math.max(0, Math.min(100, (parte * 100) / total)) : 0);
const pctTxt = (parte, total) => Math.round(pct(parte, total)) + "%";
function tarjeta(box, titulo, frase) {
  const g = el("figure", "graf");
  g.appendChild(el("figcaption", "graf-t", titulo));
  if (frase) g.appendChild(el("p", "graf-frase", frase));
  box.appendChild(g);
  return g;
}
function leyenda(g, items) {
  const l = el("ul", "graf-ley");
  items.forEach(([cls, txt]) => { const li = el("li"); li.append(el("span", "pto " + cls), document.createTextNode(txt)); l.appendChild(li); });
  g.appendChild(l);
}

// De cada $ 100 que entraron, cuánto se fue en mercadería, en gastos y cuánto quedó.
function graficoPlata(box, r) {
  const entra = aCentavos(r.ventas_netas) + aCentavos(r.envios_cobrados);
  if (entra <= 0) return;
  const partes = [
    ["c-merca", "Mercadería", aCentavos(r.costo_mercaderia)],
    ["c-fijos", "Gastos fijos y nafta", aCentavos(r.gastos_fijos_estimados) + aCentavos(r.nafta_estimada)],
    ["c-gastos", "Gastos del día", aCentavos(r.gastos_operativos)],
  ].filter((p) => p[2] > 0);
  const queda = aCentavos(r.resultado_estimado);
  const gastado = partes.reduce((a, p) => a + p[2], 0);
  const g = tarjeta(box, "¿A dónde fue la plata de las ventas?", queda >= 0
    ? "De cada $ 100 que vendiste te quedaron $ " + Math.round((queda * 100) / entra) + "."
    : "Los costos superaron a las ventas por " + fmtPesos(-queda / 100) + ".");
  const barra = el("div", "graf-apilada");
  barra.setAttribute("role", "img");
  const total = Math.max(entra, gastado);
  const seg = (cls, txt, v) => {
    const s = el("span", "seg " + cls); s.style.width = pct(v, total) + "%"; s.title = txt + ": " + fmtPesos(v / 100);
    if (pct(v, total) >= 12) s.textContent = pctTxt(v, entra);
    barra.appendChild(s);
  };
  partes.forEach(([cls, txt, v]) => seg(cls, txt, v));
  if (queda > 0) seg("c-queda", "Te quedó", queda);
  barra.setAttribute("aria-label", partes.map((p) => p[1] + " " + fmtPesos(p[2] / 100)).concat(queda > 0 ? ["te quedó " + fmtPesos(queda / 100)] : []).join(", "));
  g.appendChild(barra);
  leyenda(g, partes.map(([cls, txt, v]) => [cls, txt + " " + fmtPesos(Math.round(v / 100))]).concat(queda > 0 ? [["c-queda", "Te quedó " + fmtPesos(Math.round(queda / 100))]] : []));
}

// Qué se vendió más: barra = lo vendido; la parte oscura es el margen (lo que deja después de la mercadería).
function graficoProductos(box, r) {
  const lista = (r.por_producto || []).filter((x) => Number(x.ventas) > 0);
  if (!lista.length) return;
  const MAX = 6;
  const top = lista.slice(0, MAX);
  if (lista.length > MAX) {
    const resto = lista.slice(MAX);
    top.push({ nombre: "Otros (" + resto.length + ")", cantidad: resto.reduce((a, x) => a + x.cantidad, 0),
      ventas: resto.reduce((a, x) => a + Number(x.ventas), 0), margen: resto.reduce((a, x) => a + Number(x.margen), 0) });
  }
  const primero = lista[0];
  const g = tarjeta(box, "Qué se vendió más", primero.nombre + ": " + pctTxt(Number(primero.ventas), Number(r.ventas_brutas)) + " de lo vendido (" +
    primero.cantidad + (primero.cantidad === 1 ? " unidad" : " unidades") + ").");
  const max = Math.max(...top.map((x) => Number(x.ventas)));
  const ul = el("ul", "graf-prod");
  top.forEach((x) => {
    const li = el("li");
    const cab = el("div", "gp-cab");
    cab.append(el("span", "gp-n", x.cantidad + "× " + x.nombre), el("span", "gp-v num", fmtPesos(Math.round(Number(x.ventas)))));
    const barra = el("div", "gp-barra");
    barra.setAttribute("role", "img");
    barra.setAttribute("aria-label", x.nombre + ": vendiste " + fmtPesos(x.ventas) + ", margen " + fmtPesos(x.margen));
    const v = el("span", "gp-ventas"); v.style.width = pct(Number(x.ventas), max) + "%";
    const m = el("span", "gp-margen"); m.style.width = pct(Math.max(0, Number(x.margen)), Number(x.ventas)) + "%";
    v.appendChild(m); barra.appendChild(v);
    li.append(cab, barra);
    ul.appendChild(li);
  });
  g.appendChild(ul);
  leyenda(g, [["c-margen", "Margen (después de la mercadería)"], ["c-vendido", "Resto: costo de la mercadería"]]);
}

// Cómo te pagaron: efectivo contra transferencia.
function graficoMedios(box, r) {
  const medios = Object.entries(r.por_medio || {}).filter(([, v]) => Number(v) > 0);
  const total = medios.reduce((a, [, v]) => a + aCentavos(v), 0);
  if (total <= 0 || medios.length < 1) return;
  medios.sort((a, b) => Number(b[1]) - Number(a[1]));
  const g = tarjeta(box, "Cómo te pagaron", medios.map(([m, v]) => (MEDIOS[m] || m) + " " + pctTxt(aCentavos(v), total)).join(" · "));
  const barra = el("div", "graf-apilada");
  barra.setAttribute("role", "img");
  barra.setAttribute("aria-label", medios.map(([m, v]) => (MEDIOS[m] || m) + " " + fmtPesos(v)).join(", "));
  medios.forEach(([m, v]) => {
    const s = el("span", "seg m-" + m); s.style.width = pct(aCentavos(v), total) + "%"; s.title = (MEDIOS[m] || m) + ": " + fmtPesos(v);
    if (pct(aCentavos(v), total) >= 12) s.textContent = pctTxt(aCentavos(v), total);
    barra.appendChild(s);
  });
  g.appendChild(barra);
  leyenda(g, medios.map(([m, v]) => ["m-" + m, (MEDIOS[m] || m) + " " + fmtPesos(Math.round(Number(v)))]));
}

// Ventas y resultado de cada día del período. dias: [{ fecha: "2026-10-17", ventas, resultado }], en orden.
function graficoDias(box, dias) {
  const mejor = dias.reduce((a, x) => (x.ventas > a.ventas ? x : a), dias[0]);
  const conVentas = dias.filter((x) => x.ventas > 0);
  const prom = conVentas.length ? conVentas.reduce((a, x) => a + x.ventas, 0) / conVentas.length : 0;
  const g = tarjeta(box, "Ventas por día", "Mejor día: " + fechaCorta(mejor.fecha) + " con " + fmtPesos(Math.round(mejor.ventas)) +
    ". Promedio de los días que abriste: " + fmtPesos(Math.round(prom)) + ".");
  const maxPos = Math.max(1, ...dias.map((x) => Math.max(x.ventas, x.resultado)));
  const maxNeg = Math.max(0, ...dias.map((x) => -Math.min(0, x.resultado)));
  const alto = maxPos + maxNeg;
  const cont = el("div", "graf-dias");
  cont.setAttribute("role", "img");
  cont.setAttribute("aria-label", "Ventas por día: " + conVentas.map((x) => fechaCorta(x.fecha) + " " + fmtPesos(Math.round(x.ventas))).join(", "));
  cont.style.setProperty("--pos", (maxPos * 100) / alto + "%");
  const cadaCuanto = Math.ceil(dias.length / 8); // como mucho unas 8 fechas abajo, para que se lean
  dias.forEach((x, i) => {
    const col = el("div", "gd-col");
    col.title = fechaCorta(x.fecha) + ": vendiste " + fmtPesos(x.ventas) + ", resultado " + fmtPesos(x.resultado);
    const pos = el("div", "gd-pos"), neg = el("div", "gd-neg");
    const v = el("span", "gd-v"); v.style.height = pct(x.ventas, maxPos) + "%";
    const res = el("span", "gd-r"); res.style.height = pct(Math.max(0, x.resultado), maxPos) + "%";
    pos.append(v, res);
    if (x.resultado < 0) { const n = el("span", "gd-rn"); n.style.height = pct(-x.resultado, maxNeg) + "%"; neg.appendChild(n); }
    col.append(pos, neg, el("span", "gd-f", i % cadaCuanto === 0 || i === dias.length - 1 ? String(Number(x.fecha.slice(8))) : ""));
    cont.appendChild(col);
  });
  g.appendChild(cont);
  leyenda(g, [["c-vendido", "Ventas netas"], ["c-margen", "Resultado estimado"]].concat(maxNeg ? [["c-perdida", "Día con resultado negativo"]] : []));
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
