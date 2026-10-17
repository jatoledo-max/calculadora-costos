// Pestaña Informes: cierres de días anteriores con filtro por fechas, la suma del período, el detalle de cada cierre
// (con sus ventas para anular una venta de otro día), descargas en planilla y los pagos pendientes.
// Los números de cada día son la foto que guardó la base al cerrar: acá solo se suman y se muestran.
import { fmtPesos } from "./dinero.js";
import { MEDIOS, pintarInforme, sumarInformes, fechaCorta } from "./informe.js";
import { SinRespuesta } from "./stores.js";

// Fecha del día en Argentina ("2026-10-17"), la misma que usa la base para fecha_operacion.
export const fechaAR = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(d);

// Rango de un atajo: hoy, 7 (últimos 7 días, hoy incluido), mes (este mes) o pasado (el mes anterior completo).
export function rangoRapido(cual, hoy) {
  const [a, m, d] = hoy.split("-").map(Number);
  const iso = (dt) => dt.toISOString().slice(0, 10);
  if (cual === "hoy") return { desde: hoy, hasta: hoy };
  if (cual === "7") return { desde: iso(new Date(Date.UTC(a, m - 1, d - 6))), hasta: hoy };
  if (cual === "mes") return { desde: iso(new Date(Date.UTC(a, m - 1, 1))), hasta: hoy };
  if (cual === "pasado") return { desde: iso(new Date(Date.UTC(a, m - 2, 1))), hasta: iso(new Date(Date.UTC(a, m - 1, 0))) };
  throw new Error("Atajo desconocido: " + cual);
}

// Planillas: separadas por ";" y con coma decimal, como las abre Excel o Google Sheets en castellano.
const num = (n) => (n == null || n === "" ? "" : String(Math.round(Number(n) * 100) / 100).replace(".", ","));
const texto = (t) => {
  let s = t == null ? "" : String(t);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;          // que la planilla no lo tome como fórmula
  return /[";\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const fechaLarga = (iso) => { const [a, m, d] = String(iso || "").split("-"); return d ? d + "/" + m + "/" + a : ""; };
const fechaHora = (iso) => {
  if (!iso) return "";
  const d = new Date(iso), tz = { timeZone: "America/Argentina/Buenos_Aires" };
  return fechaLarga(fechaAR(d)) + " " + d.toLocaleTimeString("es-AR", Object.assign({ hour: "2-digit", minute: "2-digit", hour12: false }, tz));
};
const csv = (cab, filas) => "﻿" + [cab.join(";"), ...filas.map((f) => f.join(";"))].join("\r\n") + "\r\n";

export function csvCierres(cajas) {
  const cab = ["Caja", "Fecha", "Estado", "Abierta", "Cerrada", "Ventas", "Ventas netas", "Costo de mercadería", "Margen bruto", "Envíos cobrados",
    "Gastos del día", "Gastos fijos estimados", "Nafta estimada", "Resultado estimado", "Efectivo al abrir", "Efectivo esperado", "Efectivo contado",
    "Diferencia de efectivo", "Transferencias esperadas", "Transferencias en el banco", "Fondo para mañana", "Reserva apartada", "Pagos pendientes",
    "Disponible estimado", "Observaciones"];
  return csv(cab, cajas.slice().sort((a, b) => a.numero - b.numero).map((c) => {
    const r = c.resumen || {};
    const cerrada = c.estado === "cerrada";
    return [c.numero, fechaLarga(c.fecha_operacion), cerrada ? "Cerrada" : "Abierta", fechaHora(c.abierta_en), fechaHora(c.cerrada_en),
      cerrada ? r.ventas : "", ...["ventas_netas", "costo_mercaderia", "margen_bruto", "envios_cobrados", "gastos_operativos", "gastos_fijos_estimados",
        "nafta_estimada", "resultado_estimado"].map((k) => (cerrada ? num(r[k]) : "")),
      num(c.saldo_inicial), cerrada ? num(r.efectivo_esperado) : "", num(c.efectivo_contado), cerrada ? num(r.diferencia_efectivo) : "",
      cerrada ? num(r.transferencias_esperadas) : "", cerrada ? num(r.transferencias_banco) : "", num(c.fondo_siguiente),
      cerrada ? num(r.reserva_apartada) : "", cerrada ? num(r.obligaciones_pendientes) : "", cerrada ? num(r.disponible_estimado) : "",
      texto(c.observaciones != null ? c.observaciones : r.observaciones)];
  }));
}

// Una fila por renglón. Los importes de la venta (descuento, envío, total, pagos) van solo en su primer renglón,
// así la suma de cada columna da el total real.
export function csvVentas(cajas, ventas) {
  const caja = Object.fromEntries(cajas.map((c) => [c.id, c]));
  const cab = ["Caja", "Fecha", "Hora", "Venta", "Estado", "Producto", "Cantidad", "Precio unitario", "Subtotal", "Costo unitario", "Costo",
    "Descuento de la venta", "Envío cobrado", "Total de la venta", "Efectivo", "Transferencia", "Motivo del descuento", "Motivo de la anulación"];
  const filas = [];
  ventas.slice().sort((a, b) => (caja[a.caja_id] || {}).numero - (caja[b.caja_id] || {}).numero || a.numero - b.numero).forEach((v) => {
    const c = caja[v.caja_id] || {};
    const pago = (m) => (v.venta_pagos || []).filter((p) => p.medio === m).reduce((s, p) => s + Number(p.importe), 0);
    const hora = new Date(v.creada_en).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });
    (v.venta_items || []).slice().sort((a, b) => a.renglon - b.renglon).forEach((i, n) => {
      const primero = n === 0;
      filas.push([c.numero, fechaLarga(c.fecha_operacion), hora, v.numero, v.estado === "anulada" ? "Anulada" : "Confirmada", texto(i.nombre), i.cantidad,
        num(i.precio_unitario), num(Number(i.precio_unitario) * i.cantidad), num(i.costo_unitario), num(Number(i.costo_unitario) * i.cantidad),
        primero ? num(v.descuento) : "", primero ? num(v.cargo_envio) : "", primero ? num(v.total) : "",
        primero ? num(pago("efectivo")) : "", primero ? num(pago("transferencia")) : "",
        primero ? texto(v.motivo_descuento) : "", primero ? texto(v.motivo_anulacion) : ""]);
    });
  });
  return csv(cab, filas);
}

export const TIPOS_MOV = { gasto: "Gasto", compra_mercaderia: "Compra de mercadería", retiro: "Retiro", aporte: "Aporte", reserva: "Reserva", ajuste: "Ajuste" };
export function csvMovimientos(cajas, movimientos) {
  const caja = Object.fromEntries(cajas.map((c) => [c.id, c]));
  const cab = ["Caja", "Fecha", "Hora", "Tipo", "Medio", "Importe", "Detalle", "Ya está en gastos fijos", "Estado", "Motivo de la anulación"];
  return csv(cab, movimientos.slice().sort((a, b) => (caja[a.caja_id] || {}).numero - (caja[b.caja_id] || {}).numero || String(a.creado_en).localeCompare(String(b.creado_en)))
    .map((m) => {
      const c = caja[m.caja_id] || {};
      const hora = new Date(m.creado_en).toLocaleTimeString("es-AR", { timeZone: "America/Argentina/Buenos_Aires", hour: "2-digit", minute: "2-digit", hour12: false });
      return [c.numero, fechaLarga(c.fecha_operacion), hora, TIPOS_MOV[m.tipo] || m.tipo, MEDIOS[m.medio] || m.medio, num(m.importe), texto(m.descripcion),
        m.en_gastos_fijos ? "Sí" : "No", m.estado === "anulado" ? "Anulado" : "Vigente", texto(m.motivo_anulacion)];
    }));
}

export function iniciarInformes(calc, backend, caja) {
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const boton = (cls, txt, fn) => { const b = el("button", cls, txt); b.type = "button"; b.onclick = fn; return b; };
  const hora = (iso) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  const diaSemana = (iso) => { const [a, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(a, m - 1, d)).toLocaleDateString("es-AR", { weekday: "short", timeZone: "UTC" }); };
  const mensaje = (m) => { const d = el("div", "caja-msg " + (m.ok ? "ok" : "mal"), m.texto); d.setAttribute("role", m.ok ? "status" : "alert"); return d; };

  const st = {
    rapido: "mes", ...rangoRapido("mes", fechaAR(new Date())),
    cargando: false, cargado: false, error: "", cajas: [],
    sel: null, detalle: null, errorDetalle: "",   // caja abierta en el detalle y sus ventas y movimientos
    anular: null, msg: null,                      // { id, motivo, enviando, error } · mensaje después de anular
    descargando: "", errorDescarga: "",
    pend: { nombre: "", monto: "", vence: "", error: "" },
  };

  // ---------- Datos ----------
  let pedido = 0; // si se cambia el período mientras carga, solo vale la última respuesta
  async function cargar() {
    if (st.desde > st.hasta) { st.error = "La fecha \"desde\" es posterior a \"hasta\"."; st.cajas = []; render(); return; }
    const n = ++pedido;
    st.cargando = true; st.error = ""; render();
    try {
      const cajas = await backend.listarCajas(st.desde, st.hasta);
      if (n !== pedido) return;
      st.cajas = cajas;
      if (st.sel && !cajas.some((c) => c.id === st.sel)) { st.sel = null; st.detalle = null; }
    } catch (e) {
      if (n !== pedido) return;
      st.error = e instanceof SinRespuesta ? "Sin conexión: no se pudieron traer los cierres. Probá de nuevo." : "No se pudieron traer los cierres (" + e.message + ").";
    }
    st.cargando = false; st.cargado = true;
    render();
    if (st.sel) cargarDetalle(st.sel);
  }
  async function cargarDetalle(id) {
    st.errorDetalle = "";
    try {
      const d = await backend.detalle([id]);
      if (st.sel !== id) return;
      st.detalle = d;
    } catch (e) {
      if (st.sel !== id) return;
      st.errorDetalle = "No se pudieron traer las ventas de esta caja. Revisá la conexión.";
    }
    render();
  }
  function elegir(id) {
    st.anular = null; st.msg = null;
    if (st.sel === id) { st.sel = null; st.detalle = null; render(); return; }
    st.sel = id; st.detalle = null; render();
    const li = document.querySelector('[data-caja="' + id + '"]');
    if (li && li.scrollIntoView) li.scrollIntoView({ block: "start", behavior: "smooth" });
    cargarDetalle(id);
  }

  async function confirmarAnulacion(v, c) {
    const a = st.anular;
    if (!a || a.enviando) return;
    if (!a.motivo.trim()) { a.error = "Escribí el motivo."; render(); return; }
    a.enviando = true; a.error = ""; render();
    try {
      const r = await backend.anularVenta(v.id, a.motivo.trim());
      st.msg = { ok: true, texto: "Venta " + r.numero + " de la Caja " + c.numero + " anulada (" + fmtPesos(r.total) + "). " +
        (r.misma_caja ? "" : "El cierre de ese día no cambia: la anulación aparece en el informe de la caja abierta. Si devolviste plata, cargala como retiro en la Caja.") };
      st.anular = null;
      if (caja && caja.recargar) caja.recargar();
    } catch (e) {
      a.enviando = false;
      a.error = e instanceof SinRespuesta ? "No hubo respuesta. Probá de nuevo: si ya se había anulado, no pasa nada." : e.message;
    }
    render();
    cargarDetalle(v.caja_id);
  }

  async function descargar(cual) {
    if (st.descargando) return;
    st.descargando = cual; st.errorDescarga = ""; render();
    try {
      const cajas = st.cajas;
      let contenido;
      if (cual === "cierres") contenido = csvCierres(cajas);
      else {
        const d = await backend.detalle(cajas.map((c) => c.id));
        contenido = cual === "ventas" ? csvVentas(cajas, d.ventas) : csvMovimientos(cajas, d.movimientos);
      }
      const nombre = cual + "_" + st.desde + "_a_" + st.hasta + ".csv";
      const url = URL.createObjectURL(new Blob([contenido], { type: "text/csv;charset=utf-8" }));
      const a = el("a"); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      st.errorDescarga = "No se pudo armar la planilla. Revisá la conexión y probá de nuevo.";
    }
    st.descargando = ""; render();
  }

  // ---------- Pagos pendientes (se guardan en ajustes "obligaciones") ----------
  const pendientes = () => (((calc.estado.ajustes || {}).obligaciones || {}).items || []);
  function agregarPendiente() {
    const p = st.pend;
    const nombre = p.nombre.trim(), monto = Number(p.monto);
    if (!nombre) { p.error = "Escribí qué tenés que pagar."; render(); return; }
    if (!(monto > 0) || !/^\d{1,10}(\.\d+)?$/.test(String(p.monto).trim())) { p.error = "El monto tiene que ser mayor a $ 0."; render(); return; }
    calc.guardarAjuste("obligaciones", { items: [...pendientes(), { nombre: nombre.slice(0, 80), monto: Math.round(monto * 100) / 100, vence: p.vence || null }] });
    st.pend = { nombre: "", monto: "", vence: "", error: "" };
    render();
  }
  function quitarPendiente(n) {
    calc.guardarAjuste("obligaciones", { items: pendientes().filter((_, i) => i !== n) });
  }

  // ---------- Pantalla ----------
  function render() {
    renderPeriodo(); renderResumen(); renderCajas(); renderDescargas(); renderPendientes();
  }

  function renderPeriodo() {
    const box = $("#inf-periodo");
    box.textContent = "";
    box.appendChild(el("h2", "sec-t", "Período"));
    const chips = el("div", "fila-chips");
    [["hoy", "Hoy"], ["7", "Últimos 7 días"], ["mes", "Este mes"], ["pasado", "Mes pasado"]].forEach(([k, t]) => {
      const b = boton("chip", t, () => { Object.assign(st, { rapido: k }, rangoRapido(k, fechaAR(new Date()))); cargar(); });
      b.setAttribute("aria-pressed", st.rapido === k ? "true" : "false");
      chips.appendChild(b);
    });
    box.appendChild(chips);
    const fechas = el("div", "inf-fechas");
    const campo = (k, t) => {
      const lab = el("label", "f", t);
      const i = el("input"); i.type = "date"; i.id = "inf-" + k; i.value = st[k]; i.max = "2099-12-31";
      i.onchange = () => { if (!i.value) return; st[k] = i.value; st.rapido = null; cargar(); };
      lab.appendChild(i);
      return lab;
    };
    fechas.append(campo("desde", "Desde"), campo("hasta", "Hasta"));
    box.appendChild(fechas);
  }

  const cerradas = () => st.cajas.filter((c) => c.estado === "cerrada" && c.resumen);
  function renderResumen() {
    const box = $("#inf-resumen");
    box.textContent = "";
    const rango = st.desde === st.hasta ? "del " + fechaCorta(st.desde) : "del " + fechaCorta(st.desde) + " al " + fechaCorta(st.hasta);
    box.appendChild(el("h2", "sec-t", "Resumen " + rango));
    if (st.error) { box.appendChild(el("p", "caja-msg mal", st.error)); return; }
    if (!st.cargado) { box.appendChild(el("p", "empty", "Cargando…")); return; }
    const lista = cerradas();
    if (st.cajas.some((c) => c.estado === "abierta")) box.appendChild(el("p", "hint", "La caja abierta no entra en la suma hasta que la cierres."));
    if (!lista.length) { box.appendChild(el("p", "empty", "No hay cajas cerradas en estas fechas.")); return; }
    pintarInforme(box, sumarInformes(lista.map((c) => c.resumen)));
  }

  function renderCajas() {
    const box = $("#inf-cajas");
    box.textContent = "";
    box.appendChild(el("h2", "sec-t", "Cierres"));
    if (st.cargando && !st.cajas.length) { box.appendChild(el("p", "empty", "Cargando…")); return; }
    if (st.msg) box.appendChild(mensaje(st.msg));
    if (!st.cajas.length) { box.appendChild(el("p", "empty", st.error ? "" : "No hay cajas en estas fechas.")); return; }
    box.appendChild(el("p", "hint", "Tocá un cierre para ver su informe y sus ventas."));
    const ul = el("ul", "inf-lista");
    st.cajas.forEach((c) => {
      const li = el("li", "inf-caja" + (st.sel === c.id ? " abierto" : "")); li.dataset.caja = c.id;
      const r = c.resumen || {};
      const b = el("button", "inf-fila"); b.type = "button"; b.setAttribute("aria-expanded", st.sel === c.id ? "true" : "false");
      b.onclick = () => elegir(c.id);
      b.append(el("span", "n", "Caja " + c.numero), el("span", "d", diaSemana(c.fecha_operacion) + " " + fechaCorta(c.fecha_operacion)));
      if (c.estado === "abierta") b.appendChild(el("span", "tag", "abierta"));
      else {
        const dif = Number(r.diferencia_efectivo);
        b.append(el("span", "v num", fmtPesos(r.ventas_netas)), el("span", "res num", "Resultado " + fmtPesos(r.resultado_estimado)));
        b.appendChild(el("span", "tag" + (dif ? " falta" : ""), dif ? (dif < 0 ? "faltó " : "sobró ") + fmtPesos(Math.abs(dif)) : "coincidió"));
      }
      li.appendChild(b);
      if (st.sel === c.id) li.appendChild(detalle(c));
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  function detalle(c) {
    const d = el("div", "inf-detalle");
    if (c.estado === "abierta") {
      d.appendChild(el("p", "hint", "Esta caja sigue abierta: su informe, sus ventas y el cierre están en la pestaña Caja."));
      return d;
    }
    pintarInforme(d, Object.assign({ abierta_en: c.abierta_en, cerrada_en: c.cerrada_en }, c.resumen), { cerrada: true });
    if (st.errorDetalle) { d.appendChild(el("p", "caja-msg mal", st.errorDetalle)); return d; }
    if (!st.detalle) { d.appendChild(el("p", "empty", "Cargando ventas…")); return d; }
    const hayAbierta = caja && caja.hayAbierta && caja.hayAbierta();
    d.appendChild(el("h3", "res-sub", "Ventas"));
    d.appendChild(el("p", "hint", hayAbierta
      ? "Si anulás una venta de este día, el cierre no cambia: la anulación queda en la caja abierta."
      : "Para anular una venta de este día, primero abrí la caja: la anulación queda registrada en la caja abierta."));
    const vs = st.detalle.ventas.slice().sort((a, b) => b.numero - a.numero);
    if (!vs.length) d.appendChild(el("p", "empty", "No hubo ventas."));
    const ul = el("ul", "ventas");
    vs.forEach((v) => {
      const li = el("li", "venta" + (v.estado === "anulada" ? " anulada" : ""));
      const items = (v.venta_items || []).slice().sort((a, b) => a.renglon - b.renglon).map((i) => i.cantidad + "× " + i.nombre).join(", ");
      const medios = (v.venta_pagos || []).map((p) => MEDIOS[p.medio] || p.medio).join(" + ") || "Sin cobro";
      li.append(el("span", "n", "Venta " + v.numero), el("span", "h", hora(v.creada_en)), el("span", "it", items),
        el("span", "md", medios + (Number(v.cargo_envio) ? " · envío " + fmtPesos(v.cargo_envio) : "") + (Number(v.descuento) ? " · desc. " + fmtPesos(v.descuento) : "")),
        el("span", "t num", fmtPesos(v.total)));
      if (v.estado === "anulada") {
        const otra = v.anulada_en_caja && v.anulada_en_caja !== v.caja_id;
        li.appendChild(el("span", "tag", "anulada" + (otra ? " otro día" : "") + ": " + (v.motivo_anulacion || "")));
      } else if (st.anular && st.anular.id === v.id) li.appendChild(formAnular(v, c));
      else if (hayAbierta) li.appendChild(boton("btn ghost chico", "Anular", () => { st.anular = { id: v.id, motivo: "", enviando: false, error: "" }; st.msg = null; render(); }));
      ul.appendChild(li);
    });
    d.appendChild(ul);
    const ms = st.detalle.movimientos;
    if (ms.length) {
      d.appendChild(el("h3", "res-sub", "Gastos y retiros"));
      const t = el("table", "res-tabla");
      ms.forEach((m) => {
        const tr = el("tr", m.estado === "anulado" ? "anulado" : "");
        tr.append(el("td", null, hora(m.creado_en) + " · " + (TIPOS_MOV[m.tipo] || m.tipo) + " · " + (MEDIOS[m.medio] || m.medio) +
          (m.descripcion ? " · " + m.descripcion : "") + (m.estado === "anulado" ? " (anulado: " + (m.motivo_anulacion || "") + ")" : "")),
          el("td", "r num", fmtPesos(m.importe)));
        t.appendChild(tr);
      });
      d.appendChild(t);
    }
    return d;
  }

  function formAnular(v, c) {
    const a = st.anular;
    const f = el("div", "anular-form");
    const mo = el("input", "motivo"); mo.placeholder = "Motivo de la anulación (obligatorio)"; mo.maxLength = 120; mo.value = a.motivo;
    mo.setAttribute("aria-label", "Motivo de la anulación");
    mo.oninput = () => { a.motivo = mo.value; };
    const ok = boton("btn danger", a.enviando ? "Anulando…" : "Anular venta " + v.numero, () => confirmarAnulacion(v, c)); ok.disabled = a.enviando;
    const no = boton("btn ghost", "Cancelar", () => { st.anular = null; render(); });
    f.append(mo, ok, no);
    if (a.error) f.appendChild(el("p", "caja-msg mal", a.error));
    setTimeout(() => { if (st.anular && st.anular.id === v.id && document.activeElement !== mo) mo.focus(); });
    return f;
  }

  function renderDescargas() {
    const box = $("#inf-descargas");
    box.textContent = "";
    box.appendChild(el("h2", "sec-t", "Descargar planillas"));
    box.appendChild(el("p", "hint", "Archivos .csv del período elegido. Se abren con Excel o Google Sheets."));
    const fila = el("div", "inf-botones");
    [["cierres", "Cierres"], ["ventas", "Ventas (por producto)"], ["movimientos", "Gastos y retiros"]].forEach(([k, t]) => {
      const b = boton("btn", st.descargando === k ? "Armando…" : t, () => descargar(k));
      b.id = "inf-csv-" + k; b.disabled = !!st.descargando || !st.cajas.length;
      fila.appendChild(b);
    });
    box.appendChild(fila);
    if (st.errorDescarga) box.appendChild(el("p", "caja-msg mal", st.errorDescarga));
  }

  function renderPendientes() {
    const box = $("#inf-pendientes");
    const enfocado = document.activeElement && document.activeElement.id;
    box.textContent = "";
    box.appendChild(el("h2", "sec-t", "Pagos pendientes"));
    box.appendChild(el("p", "hint", "Lo que tenés que pagar pronto (alquiler, proveedor). Se resta del disponible para retirar en cada cierre. Cuando lo pagues, quitalo y cargalo como gasto en la Caja."));
    const items = pendientes();
    if (items.length) {
      const t = el("table", "res-tabla");
      let total = 0;
      items.forEach((o, n) => {
        const tr = el("tr");
        total += Number(o.monto) || 0;
        tr.append(el("td", null, o.nombre + (o.vence ? " · vence el " + fechaCorta(o.vence) : "")), el("td", "r num", fmtPesos(o.monto)));
        const td = el("td", "r");
        const x = boton("btn ghost", "✕", () => quitarPendiente(n)); x.setAttribute("aria-label", "Quitar " + o.nombre);
        td.appendChild(x); tr.appendChild(td);
        t.appendChild(tr);
      });
      const tr = el("tr", "tot");
      tr.append(el("td", null, "Total"), el("td", "r num", fmtPesos(total)), el("td"));
      t.appendChild(tr);
      box.appendChild(t);
    }
    const p = st.pend;
    const f = el("div", "inf-pend-form");
    const campo = (k, t, tipo, extra) => {
      const lab = el("label", "f", t);
      const i = el("input"); i.id = "inf-pend-" + k; i.type = tipo; i.value = p[k];
      Object.assign(i, extra || {});
      i.oninput = () => { p[k] = i.value; };
      lab.appendChild(i);
      return lab;
    };
    f.append(campo("nombre", "Qué tenés que pagar", "text", { maxLength: 80, placeholder: "Proveedor de carne" }),
      campo("monto", "Monto ($)", "number", { min: "0", step: "any", inputMode: "decimal", className: "n" }),
      campo("vence", "Vence (opcional)", "date"));
    f.appendChild(boton("btn primary", "Agregar", agregarPendiente));
    box.appendChild(f);
    if (p.error) box.appendChild(el("p", "caja-msg mal", p.error));
    if (enfocado && /^inf-pend-/.test(enfocado) && $("#" + enfocado)) $("#" + enfocado).focus();
  }

  // Se cargan los cierres al entrar en la pestaña (así aparece el cierre que se acaba de hacer).
  $("#tab-informes").addEventListener("click", cargar);
  calc.alCambiar(() => renderPendientes());
  render();
  if (!$("#view-informes").hidden) cargar();
}
