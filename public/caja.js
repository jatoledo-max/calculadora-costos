// Pestaña Caja: abrir la caja y registrar ventas con botones grandes, pensada para usar con una mano.
// Los productos y los costos salen de la calculadora (calc.estado y costos.js); la venta la valida y guarda la base.
import { fmtPesos, aCentavos } from "./dinero.js";
import { SinRespuesta } from "./stores.js";

export function iniciarCaja(calc, backend) {
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const uuid = () => crypto.randomUUID();
  const MEDIOS = { efectivo: "Efectivo", transferencia: "Transferencia" };
  const hora = (iso) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });

  const st = {
    cargado: false, caja: null, ventas: [], errorCarga: "",
    cat: null, opcionPara: null,
    carrito: [],                          // [{ producto, opcion, cantidad }]
    envio: "retira", cargoOtro: "",       // retira | sin-cargo | cargo | otro
    descAbierto: false, descMonto: "", descMotivo: "",
    dividir: false, efectivoDividido: "",
    pendienteId: null,                    // id de la venta en curso: se mantiene en los reintentos para no duplicar
    enviando: false, msg: null,           // { ok, texto }
  };

  // ---------- Catálogo ----------
  const prods = () => calc.estado.productos;
  const vendible = (p) => p && !p.esPreparacion && p.enCaja !== false;
  const catDe = (p) => (p.categoria || "").trim() || (p.tipo === "promo" ? "Promos" : p.tipo === "extra" ? "Extras" : "Otros");
  const precioDe = (p, opcionId) => {
    const op = opcionId ? (p.opciones || []).find((o) => o.id === opcionId) : null;
    return (Number(p.precioVenta) || 0) + (op ? Number(op.precioExtra) || 0 : 0);
  };
  function categorias() {
    const peso = (c) => (c === "Promos" ? 1 : c === "Extras" ? 2 : c === "Otros" ? 3 : 0);
    const cats = [...new Set(Object.values(prods()).filter(vendible).map(catDe))];
    return cats.sort((a, b) => peso(a) - peso(b) || a.localeCompare(b, "es"));
  }
  const cargoEnvioDefault = () => Number(((calc.estado.ajustes || {}).delivery || {}).cobroEnvio) || 0;

  // ---------- Totales (en centavos) ----------
  function totales() {
    let bruto = 0;
    st.carrito.forEach((l) => { const p = prods()[l.producto]; if (p) bruto += aCentavos(precioDe(p, l.opcion)) * l.cantidad; });
    const desc = Math.min(aCentavos(st.descMonto), bruto);
    const envio = st.envio === "cargo" ? aCentavos(cargoEnvioDefault()) : st.envio === "otro" ? aCentavos(st.cargoOtro) : 0;
    return { bruto, desc, envio, total: bruto - desc + envio };
  }

  // ---------- Datos ----------
  async function recargar() {
    try {
      const r = await backend.cargar();
      st.caja = r.caja; st.ventas = r.ventas; st.errorCarga = "";
    } catch (e) {
      st.errorCarga = "No se pudo cargar la caja. Revisá la conexión y recargá la página.";
    }
    st.cargado = true;
    render();
  }

  async function abrir() {
    const inp = $("#caja-saldo");
    if (inp.value === "" || Number(inp.value) < 0) { inp.setCustomValidity("Poné cuánto efectivo hay al empezar (puede ser 0)."); inp.reportValidity(); return; }
    const b = $("#caja-btn-abrir"); b.disabled = true; b.textContent = "Abriendo…";
    try {
      await backend.abrirCaja(uuid(), Number(inp.value));
      st.msg = null;
    } catch (e) {
      st.msg = { ok: false, texto: e instanceof SinRespuesta ? "Sin conexión. Probá de nuevo." : e.message };
    }
    await recargar();
  }

  async function cobrar(pagos) {
    if (st.enviando || !st.carrito.length) return;
    const t = totales();
    if (t.desc > 0 && !st.descMotivo.trim()) { st.msg = { ok: false, texto: "Escribí el motivo del descuento." }; st.descAbierto = true; render(); return; }
    st.pendienteId = st.pendienteId || uuid();
    const items = st.carrito.map((l) => Object.assign({ producto: l.producto, opcion: l.opcion || null, cantidad: l.cantidad }, calc.costos.costoParaVenta(l.producto, l.opcion)));
    const venta = {
      id: st.pendienteId, items, pagos: pagos.filter((p) => p.importe > 0),
      descuento: t.desc / 100, motivo: st.descMotivo.trim(), cargoEnvio: t.envio / 100, conEnvio: st.envio !== "retira",
    };
    st.enviando = true; st.msg = null; render();
    try {
      const r = await backend.confirmarVenta(venta);
      const totalOk = aCentavos(r.total) === t.total;
      st.msg = r.duplicada
        ? { ok: true, texto: "Esta venta ya estaba guardada como Venta " + r.numero + " (" + fmtPesos(r.total) + ")." + (totalOk ? "" : " Revisá: el total guardado es distinto al del carrito.") }
        : { ok: true, texto: "Venta " + r.numero + " guardada · " + fmtPesos(r.total) };
      vaciar();
    } catch (e) {
      st.msg = e instanceof SinRespuesta
        ? { ok: false, texto: "No hubo respuesta. Tocá el medio de pago de nuevo: si ya se había guardado, no se duplica." }
        : { ok: false, texto: e.message || "No se pudo guardar la venta." };
    }
    st.enviando = false;
    await recargar();
  }

  function vaciar() {
    st.carrito = []; st.envio = "retira"; st.cargoOtro = ""; st.descAbierto = false; st.descMonto = ""; st.descMotivo = "";
    st.dividir = false; st.efectivoDividido = ""; st.pendienteId = null; st.opcionPara = null;
  }

  function agregar(productoId, opcion) {
    const l = st.carrito.find((x) => x.producto === productoId && (x.opcion || null) === (opcion || null));
    if (l) l.cantidad = Math.min(l.cantidad + 1, 999);
    else st.carrito.push({ producto: productoId, opcion: opcion || null, cantidad: 1 });
    st.opcionPara = null; st.msg = null;
    render();
  }

  // ---------- Pantalla ----------
  function render() {
    const vista = $("#view-caja");
    if (!vista) return;
    renderEstado();
    $("#caja-abrir").hidden = !st.cargado || !!st.errorCarga || (st.caja && st.caja.estado === "abierta");
    $("#caja-pos").hidden = !(st.caja && st.caja.estado === "abierta");
    if (!$("#caja-abrir").hidden) renderAbrir();
    if (!$("#caja-pos").hidden) { renderCats(); renderProds(); renderCarrito(); }
    renderVentas();
  }

  function renderEstado() {
    const e = $("#caja-estado");
    e.className = "caja-estado";
    if (!st.cargado) { e.textContent = "Cargando la caja…"; return; }
    if (st.errorCarga) { e.textContent = st.errorCarga; e.classList.add("mal"); return; }
    const c = st.caja;
    if (c && c.estado === "abierta") {
      const vs = st.ventas.filter((v) => v.estado === "confirmada");
      const tot = vs.reduce((a, v) => a + aCentavos(v.total), 0);
      e.classList.add("abierta");
      e.innerHTML = '<span class="punto" aria-hidden="true"></span><b></b><span></span>';
      e.querySelector("b").textContent = "Caja " + c.numero + " abierta";
      e.querySelector("span:last-child").textContent = " desde las " + hora(c.abierta_en) + " · " + vs.length + (vs.length === 1 ? " venta" : " ventas") + " · " + fmtPesos(tot / 100);
    } else {
      e.classList.add("cerrada");
      e.textContent = "Caja cerrada";
    }
  }

  function renderAbrir() {
    const inp = $("#caja-saldo");
    if (document.activeElement !== inp && inp.value === "") {
      const fondo = st.caja && st.caja.fondo_siguiente != null ? st.caja.fondo_siguiente : ((calc.estado.ajustes || {}).caja || {}).fondoHabitual;
      if (fondo != null) inp.value = Number(fondo);
    }
    $("#caja-abrir-msg").textContent = st.msg && !st.msg.ok ? st.msg.texto : "";
  }

  function renderCats() {
    const box = $("#caja-cats");
    const cats = categorias();
    if (!cats.includes(st.cat)) st.cat = cats[0] || null;
    box.textContent = "";
    cats.forEach((c) => {
      const b = el("button", "chip-cat", c);
      b.type = "button";
      b.setAttribute("aria-pressed", c === st.cat ? "true" : "false");
      b.onclick = () => { st.cat = c; st.opcionPara = null; render(); };
      box.appendChild(b);
    });
  }

  function renderProds() {
    const box = $("#caja-prods");
    box.textContent = "";
    const lista = Object.entries(prods()).filter(([, p]) => vendible(p) && catDe(p) === st.cat)
      .sort((a, b) => (a[1].nombre || "").localeCompare(b[1].nombre || "", "es"));
    if (!lista.length) { box.appendChild(el("p", "empty", "No hay productos para vender. Cargalos en la pestaña Productos.")); return; }
    lista.forEach(([id, p]) => {
      const sinPrecio = !(Number(p.precioVenta) > 0);
      if (st.opcionPara === id) {
        // Elegir la opción: la común o cada variante, todas como botones grandes.
        const grupo = el("div", "pbtn-opciones");
        grupo.appendChild(el("span", "pbtn-op-t", p.nombre));
        const bc = el("button", "pbtn op", "Común · " + fmtPesos(precioDe(p, null)));
        bc.type = "button"; bc.onclick = () => agregar(id, null); grupo.appendChild(bc);
        (p.opciones || []).forEach((o) => {
          const b = el("button", "pbtn op", o.nombre + " · " + fmtPesos(precioDe(p, o.id)));
          b.type = "button"; b.onclick = () => agregar(id, o.id); grupo.appendChild(b);
        });
        const bx = el("button", "btn ghost", "Cancelar");
        bx.type = "button"; bx.onclick = () => { st.opcionPara = null; render(); }; grupo.appendChild(bx);
        box.appendChild(grupo);
        return;
      }
      const b = el("button", "pbtn");
      b.type = "button";
      b.appendChild(el("span", "nm", p.nombre || "(sin nombre)"));
      b.appendChild(el("span", "pr num", sinPrecio ? "sin precio" : fmtPesos(p.precioVenta)));
      if ((p.opciones || []).length) b.appendChild(el("span", "mas", "con opciones"));
      b.disabled = sinPrecio || st.enviando;
      b.onclick = () => { if ((p.opciones || []).length) { st.opcionPara = id; render(); } else agregar(id, null); };
      box.appendChild(b);
    });
  }

  function renderCarrito() {
    const box = $("#caja-carrito");
    box.textContent = "";
    const t = totales();
    if (st.msg) {
      const m = el("div", "caja-msg " + (st.msg.ok ? "ok" : "mal"), st.msg.texto);
      m.setAttribute("role", st.msg.ok ? "status" : "alert");
      box.appendChild(m);
    }
    box.classList.toggle("vacio", !st.carrito.length);
    if (!st.carrito.length) { box.appendChild(el("p", "empty", "Tocá un producto para empezar la venta.")); return; }

    const ul = el("ul", "lineas");
    st.carrito.forEach((l, n) => {
      const p = prods()[l.producto];
      const op = p && l.opcion ? (p.opciones || []).find((o) => o.id === l.opcion) : null;
      const li = el("li", "linea");
      const menos = el("button", "qty", "−"); menos.type = "button"; menos.setAttribute("aria-label", "Uno menos");
      const mas = el("button", "qty", "+"); mas.type = "button"; mas.setAttribute("aria-label", "Uno más");
      const quitar = el("button", "btn ghost", "✕"); quitar.type = "button"; quitar.setAttribute("aria-label", "Quitar");
      menos.onclick = () => { if (l.cantidad > 1) l.cantidad--; else st.carrito.splice(n, 1); render(); };
      mas.onclick = () => { l.cantidad = Math.min(l.cantidad + 1, 999); render(); };
      quitar.onclick = () => { st.carrito.splice(n, 1); render(); };
      [menos, mas, quitar].forEach((b) => { b.disabled = st.enviando; });
      li.append(menos, el("span", "cant num", String(l.cantidad)), mas,
        el("span", "nm", (p ? p.nombre : "(borrado)") + (op ? " · " + op.nombre : "")),
        el("span", "sub num", p ? fmtPesos(precioDe(p, l.opcion) * l.cantidad) : ""), quitar);
      ul.appendChild(li);
    });
    box.appendChild(ul);

    // Envío: retira, delivery sin cargo, delivery con el cargo habitual u otro monto.
    const env = el("div", "fila-chips");
    env.appendChild(el("span", "k", "Envío"));
    const opcionesEnvio = [["retira", "Retira"], ["sin-cargo", "Delivery sin cargo"]];
    if (cargoEnvioDefault() > 0) opcionesEnvio.push(["cargo", "Delivery + " + fmtPesos(cargoEnvioDefault())]);
    opcionesEnvio.push(["otro", "Otro cargo"]);
    opcionesEnvio.forEach(([k, txt]) => {
      const b = el("button", "chip", txt); b.type = "button";
      b.setAttribute("aria-pressed", st.envio === k ? "true" : "false");
      b.onclick = () => { st.envio = k; render(); if (k === "otro") $("#caja-envio-otro").focus(); };
      env.appendChild(b);
    });
    if (st.envio === "otro") {
      const i = el("input", "n"); i.id = "caja-envio-otro"; i.type = "number"; i.min = "0"; i.inputMode = "numeric"; i.placeholder = "$"; i.value = st.cargoOtro;
      i.setAttribute("aria-label", "Cargo de envío");
      i.oninput = () => { st.cargoOtro = i.value; refrescarTotales(); };
      env.appendChild(i);
    }
    box.appendChild(env);

    // Descuento: monto y motivo obligatorio.
    const dsc = el("div", "fila-chips");
    const bd = el("button", "chip", "Descuento"); bd.id = "caja-desc-chip";
    bd.type = "button"; bd.setAttribute("aria-pressed", st.descAbierto ? "true" : "false");
    bd.onclick = () => { st.descAbierto = !st.descAbierto; if (!st.descAbierto) { st.descMonto = ""; st.descMotivo = ""; } render(); };
    dsc.appendChild(bd);
    if (st.descAbierto) {
      const im = el("input", "n"); im.type = "number"; im.min = "0"; im.inputMode = "numeric"; im.placeholder = "$"; im.value = st.descMonto;
      im.setAttribute("aria-label", "Monto del descuento");
      im.oninput = () => { st.descMonto = im.value; refrescarTotales(); };
      const mo = el("input", "motivo"); mo.placeholder = "Motivo (obligatorio)"; mo.maxLength = 80; mo.value = st.descMotivo;
      mo.setAttribute("aria-label", "Motivo del descuento");
      mo.oninput = () => { st.descMotivo = mo.value; };
      dsc.append(im, mo);
    }
    box.appendChild(dsc);

    const tot = el("div", "caja-total");
    const tv = el("span", "v num"); tv.id = "caja-total-v";
    tot.append(el("span", "k", "Total"), tv);
    box.appendChild(tot);

    // Cobrar: tocar el medio de pago confirma la venta.
    const pagos = el("div", "pagos");
    if (!st.dividir) {
      Object.entries(MEDIOS).forEach(([k, txt]) => {
        const b = el("button", "pago " + k, st.enviando ? "Guardando…" : txt); b.type = "button";
        b.disabled = st.enviando;
        b.onclick = () => cobrar([{ medio: k, importe: totales().total / 100 }]);
        pagos.appendChild(b);
      });
      const bdv = el("button", "pago dividir", "Dividir"); bdv.type = "button"; bdv.disabled = st.enviando;
      bdv.onclick = () => { st.dividir = true; render(); $("#caja-div-ef").focus(); };
      pagos.appendChild(bdv);
    } else {
      const lab = el("label", "f", "En efectivo");
      const i = el("input", "n"); i.id = "caja-div-ef"; i.type = "number"; i.min = "0"; i.inputMode = "numeric"; i.value = st.efectivoDividido;
      i.oninput = () => { st.efectivoDividido = i.value; refrescarTotales(); };
      lab.appendChild(i);
      const resto = el("span", "resto"); resto.id = "caja-div-resto";
      const ok = el("button", "pago confirmar", st.enviando ? "Guardando…" : "Confirmar"); ok.type = "button"; ok.id = "caja-div-ok";
      ok.onclick = () => { const d = dividido(); cobrar([{ medio: "efectivo", importe: d.ef / 100 }, { medio: "transferencia", importe: d.tr / 100 }]); };
      const vol = el("button", "btn ghost", "Volver"); vol.type = "button"; vol.onclick = () => { st.dividir = false; render(); };
      pagos.classList.add("dividido");
      pagos.append(lab, resto, ok, vol);
    }
    box.appendChild(pagos);
    refrescarTotales();
  }

  // Pago dividido: lo que no va en efectivo va por transferencia.
  function dividido() {
    const total = totales().total;
    const ef = Math.min(aCentavos(st.efectivoDividido), total);
    return { ef, tr: total - ef, valido: ef > 0 && ef < total };
  }
  // Actualiza montos sin redibujar el carrito, así no se pierde el campo donde se está escribiendo.
  function refrescarTotales() {
    const t = totales();
    const tv = $("#caja-total-v"); if (tv) tv.textContent = fmtPesos(t.total / 100);
    const dc = $("#caja-desc-chip"); if (dc) dc.textContent = t.desc ? "Descuento − " + fmtPesos(t.desc / 100) : "Descuento";
    const r = $("#caja-div-resto"); if (r) r.textContent = "Transferencia: " + fmtPesos(dividido().tr / 100);
    const ok = $("#caja-div-ok"); if (ok) ok.disabled = st.enviando || !dividido().valido;
  }

  function renderVentas() {
    const box = $("#caja-ventas");
    box.textContent = "";
    if (!(st.caja && st.caja.estado === "abierta")) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(el("h2", "sec-t", "Ventas de esta caja"));
    if (!st.ventas.length) { box.appendChild(el("p", "empty", "Todavía no hay ventas.")); return; }
    const ul = el("ul", "ventas");
    st.ventas.forEach((v) => {
      const li = el("li", "venta" + (v.estado === "anulada" ? " anulada" : ""));
      const items = (v.venta_items || []).slice().sort((a, b) => a.renglon - b.renglon).map((i) => i.cantidad + "× " + i.nombre).join(", ");
      const medios = (v.venta_pagos || []).map((p) => MEDIOS[p.medio] || p.medio).join(" + ") || "Sin cobro";
      li.append(el("span", "n", "Venta " + v.numero), el("span", "h", hora(v.creada_en)), el("span", "it", items),
        el("span", "md", medios + (Number(v.cargo_envio) ? " · envío " + fmtPesos(v.cargo_envio) : "") + (Number(v.descuento) ? " · desc. " + fmtPesos(v.descuento) : "")),
        el("span", "t num", fmtPesos(v.total)));
      if (v.costo_incompleto) li.appendChild(el("span", "tag falta", "costo incompleto"));
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  $("#caja-btn-abrir").onclick = abrir;
  $("#caja-saldo").addEventListener("input", (e) => e.target.setCustomValidity(""));
  calc.alCambiar(() => { if (st.cargado) render(); });
  render();
  recargar();
}
