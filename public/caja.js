// Pestaña Caja: abrir la caja, vender con botones grandes (pensada para usar con una mano), cargar gastos y retiros,
// anular y cerrar con el conteo de la plata. Los productos y los costos salen de la calculadora (calc.estado y costos.js);
// cada operación la valida y la guarda la base.
import { fmtPesos, aCentavos } from "./dinero.js";
import { SinRespuesta } from "./stores.js";

export function iniciarCaja(calc, backend) {
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const uuid = () => crypto.randomUUID();
  const MEDIOS = { efectivo: "Efectivo", transferencia: "Transferencia" };
  const TIPOS = {
    gasto: { nombre: "Gasto", ayuda: "Algo que pagaste para el negocio (gas, cadete). Resta del resultado del día.", desc: "Qué pagaste (obligatorio)" },
    compra_mercaderia: { nombre: "Compra de mercadería", ayuda: "Insumos que compraste (pan, carne). Sale plata, pero no resta del resultado: ese costo ya entra cuando vendés.", desc: "Qué compraste (obligatorio)" },
    retiro: { nombre: "Retiro", ayuda: "Plata que sacás de la caja. No es un gasto: no cambia el resultado.", desc: "Detalle (opcional)" },
    aporte: { nombre: "Aporte", ayuda: "Plata que ponés en la caja, por ejemplo para tener cambio.", desc: "Detalle (opcional)" },
    reserva: { nombre: "Reserva", ayuda: "Plata que apartás para reponer mercadería o pagar algo. Sigue en la caja, pero no cuenta como disponible para retirar.", desc: "Para qué es (opcional)" },
    ajuste: { nombre: "Ajuste", ayuda: "Corrección si la plata no coincide por algo que no quedó registrado. Queda con su motivo.", desc: "Motivo (obligatorio)" },
  };
  const hora = (iso) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });

  const st = {
    cargado: false, caja: null, ventas: [], movimientos: [], errorCarga: "", resumen: null, errorResumen: "",
    cat: null, opcionPara: null,
    carrito: [],                          // [{ producto, opcion, cantidad }]
    envio: "retira", cargoOtro: "",       // retira | sin-cargo | cargo | otro
    descAbierto: false, descMonto: "", descMotivo: "",
    dividir: false, efectivoDividido: "",
    pendienteId: null,                    // id de la venta en curso: se mantiene en los reintentos para no duplicar
    enviando: false, msg: null,           // { ok, texto }
    mov: movVacio(),                      // formulario de gastos y retiros
    anular: null,                         // { id, motivo, enviando } de la venta o el movimiento que se está anulando
    msgVentas: null, msgMovs: null,
    cierre: cierreVacio(),
  };
  // El carrito se guarda en el celular: si se cierra la app o se recarga a mitad de una venta, sigue ahí.
  // Incluye el id de la venta en curso, así un reintento después de recargar tampoco duplica.
  const CLAVE_CARRITO = "caja-carrito-v1";
  const CAMPOS_CARRITO = ["carrito", "envio", "cargoOtro", "descAbierto", "descMonto", "descMotivo", "pendienteId"];
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE_CARRITO) || "null");
    if (g && Array.isArray(g.carrito)) CAMPOS_CARRITO.forEach((k) => { if (k in g) st[k] = g[k]; });
  } catch (e) {}
  function guardarCarrito() {
    try {
      if (!st.carrito.length && !st.pendienteId) localStorage.removeItem(CLAVE_CARRITO);
      else localStorage.setItem(CLAVE_CARRITO, JSON.stringify(Object.fromEntries(CAMPOS_CARRITO.map((k) => [k, st[k]]))));
    } catch (e) {}
  }

  // Pantalla siempre encendida mientras la caja está abierta (si el celular lo permite). Se recuerda la elección.
  const pantalla = { quiere: false, lock: null };
  try { pantalla.quiere = localStorage.getItem("caja-pantalla") === "1"; } catch (e) {}
  async function mantenerPantalla() {
    const abierta = st.caja && st.caja.estado === "abierta";
    if (pantalla.quiere && abierta && !pantalla.lock && document.visibilityState === "visible" && "wakeLock" in navigator) {
      try {
        pantalla.lock = await navigator.wakeLock.request("screen");
        pantalla.lock.addEventListener("release", () => { pantalla.lock = null; renderPantalla(); });
      } catch (e) { pantalla.lock = null; }
    } else if ((!pantalla.quiere || !abierta) && pantalla.lock) {
      await pantalla.lock.release().catch(() => {});
      pantalla.lock = null;
    }
    renderPantalla();
  }
  function renderPantalla() {
    const b = $("#caja-pantalla");
    b.hidden = !("wakeLock" in navigator) || !(st.caja && st.caja.estado === "abierta");
    b.setAttribute("aria-pressed", pantalla.quiere ? "true" : "false");
    b.textContent = pantalla.quiere ? "Pantalla siempre encendida: sí" : "Pantalla siempre encendida: no";
  }

  function movVacio() { return { tipo: "gasto", medio: "efectivo", signo: -1, importe: "", desc: "", fijos: false, pendienteId: null, enviando: false }; }
  function cierreVacio() { return { abierto: false, contado: "", banco: "", fondo: null, obs: "", enviando: false, msg: null }; }

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
      st.caja = r.caja; st.ventas = r.ventas; st.movimientos = r.movimientos || []; st.errorCarga = "";
    } catch (e) {
      st.errorCarga = "No se pudo cargar la caja. Revisá la conexión y recargá la página.";
    }
    st.resumen = null; st.errorResumen = "";
    if (st.caja && !st.errorCarga) {
      try { st.resumen = await backend.resumen(st.caja.id); }
      catch (e) { st.errorResumen = "No se pudo calcular el resumen. Si recién actualizaste la app, corré de nuevo supabase/caja.sql en Supabase."; }
    }
    st.cargado = true;
    render();
    mantenerPantalla();
  }

  async function abrir() {
    const inp = $("#caja-saldo");
    if (inp.value === "" || Number(inp.value) < 0) { inp.setCustomValidity("Poné cuánto efectivo hay al empezar (puede ser 0)."); inp.reportValidity(); return; }
    st.abriendo = true; renderAbrir();
    try {
      await backend.abrirCaja(uuid(), Number(inp.value));
      st.msg = null;
    } catch (e) {
      st.msg = { ok: false, texto: e instanceof SinRespuesta ? "Sin conexión. Probá de nuevo." : e.message };
    }
    st.abriendo = false;
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
      bloquearToques();
    } catch (e) {
      st.msg = e instanceof SinRespuesta
        ? { ok: false, texto: "No hubo respuesta. Tocá el medio de pago de nuevo: si ya se había guardado, no se duplica." }
        : { ok: false, texto: e.message || "No se pudo guardar la venta." };
    }
    st.enviando = false;
    await recargar();
  }

  // Después de cobrar, el carrito se vacía y la pantalla se acomoda: lo que queda bajo el dedo cambia.
  // Un segundo toque en el mismo lugar enseguida (doble toque) se ignora, así no agrega un producto a la venta
  // siguiente ni toca otro botón por accidente. Un toque en otro lugar funciona normal.
  let ultimoToque = { x: 0, y: 0 }, zonaBloqueada = null;
  function bloquearToques() { zonaBloqueada = { x: ultimoToque.x, y: ultimoToque.y, hasta: Date.now() + 400 }; }
  $("#view-caja").addEventListener("pointerdown", (e) => { ultimoToque = { x: e.clientX, y: e.clientY }; }, true);
  $("#view-caja").addEventListener("click", (e) => {
    const z = zonaBloqueada;
    if (z && Date.now() < z.hasta && Math.hypot(e.clientX - z.x, e.clientY - z.y) < 48) { e.preventDefault(); e.stopPropagation(); }
  }, true);

  function vaciar() {
    st.carrito = []; st.envio = "retira"; st.cargoOtro = ""; st.descAbierto = false; st.descMonto = ""; st.descMotivo = "";
    st.dividir = false; st.efectivoDividido = ""; st.pendienteId = null; st.opcionPara = null;
  }

  // ---------- Gastos, retiros y demás movimientos ----------
  async function guardarMovimiento() {
    const m = st.mov;
    if (m.enviando) return;
    const imp = aCentavos(m.importe);
    if (!(imp > 0)) { st.msgMovs = { ok: false, texto: "Poné el importe." }; render(); return; }
    m.pendienteId = m.pendienteId || uuid();
    m.enviando = true; st.msgMovs = null; render();
    try {
      const r = await backend.registrarMovimiento({
        id: m.pendienteId, tipo: m.tipo, medio: m.tipo === "reserva" ? "efectivo" : m.medio,
        importe: (m.tipo === "ajuste" ? m.signo : 1) * imp / 100, descripcion: m.desc.trim(), enGastosFijos: m.fijos,
      });
      st.msgMovs = { ok: true, texto: "Guardado: " + TIPOS[r.tipo].nombre.toLowerCase() + " de " + fmtPesos(Math.abs(r.importe)) + "." };
      const tipo = m.tipo, medio = m.medio;
      st.mov = Object.assign(movVacio(), { tipo, medio });
    } catch (e) {
      st.msgMovs = { ok: false, texto: e instanceof SinRespuesta ? "No hubo respuesta. Tocá Guardar de nuevo: si ya se había guardado, no se duplica." : e.message };
      m.enviando = false;
    }
    await recargar();
  }

  // Anular una venta o un movimiento: nunca se borra, queda marcado con el motivo.
  async function confirmarAnulacion(tipo) {
    const a = st.anular;
    if (!a || a.enviando) return;
    if (!a.motivo.trim()) { a.error = "Escribí el motivo."; render(); return; }
    a.enviando = true; a.error = ""; render();
    const clave = tipo === "venta" ? "msgVentas" : "msgMovs";
    try {
      if (tipo === "venta") {
        const r = await backend.anularVenta(a.id, a.motivo.trim());
        const pagos = ((st.ventas.find((v) => v.id === a.id) || {}).venta_pagos || []);
        const ef = pagos.filter((p) => p.medio === "efectivo").reduce((s, p) => s + Number(p.importe), 0);
        st[clave] = { ok: true, texto: "Venta " + r.numero + " anulada (" + fmtPesos(r.total) + ")." +
          (ef > 0 ? " Sus " + fmtPesos(ef) + " en efectivo ya no cuentan en el efectivo esperado: si los cobraste, devolvelos." : "") };
      } else {
        await backend.anularMovimiento(a.id, a.motivo.trim());
        st[clave] = { ok: true, texto: "Movimiento anulado." };
      }
      st.anular = null;
    } catch (e) {
      a.enviando = false;
      a.error = e instanceof SinRespuesta ? "No hubo respuesta. Probá de nuevo: si ya se había anulado, no pasa nada." : e.message;
    }
    await recargar();
  }

  // Cerrar la caja: una sola operación en la base. Si se corta, la caja sigue abierta y se vuelve a intentar.
  async function cerrar() {
    const c = st.cierre;
    if (c.enviando) return;
    if (c.contado === "") { c.msg = { ok: false, texto: "Poné el efectivo que contaste." }; render(); return; }
    c.enviando = true; c.msg = null; render();
    try {
      const r = await backend.cerrarCaja({
        cajaId: st.caja.id, efectivoContado: Number(c.contado), transferenciasBanco: c.banco === "" ? null : Number(c.banco),
        fondoSiguiente: Number(c.fondo) || 0, observaciones: c.obs.trim(),
      });
      st.cierre = cierreVacio();
      st.msg = { ok: true, texto: "Caja " + r.numero + " cerrada." };
    } catch (e) {
      c.enviando = false;
      c.msg = { ok: false, texto: e instanceof SinRespuesta ? "No hubo respuesta. Tocá Confirmar cierre de nuevo: si ya se había cerrado, vas a ver el informe." : e.message };
    }
    await recargar();
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
    renderResumen();
    renderMovs();
    renderVentas();
    renderCierre();
    renderPantalla();
    guardarCarrito();
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
      e.textContent = c ? "Caja " + c.numero + " cerrada" + (c.cerrada_en ? " a las " + hora(c.cerrada_en) : "") : "Caja cerrada";
    }
  }

  function renderAbrir() {
    const inp = $("#caja-saldo");
    if (document.activeElement !== inp && inp.value === "") {
      const fondo = st.caja && st.caja.fondo_siguiente != null ? st.caja.fondo_siguiente : ((calc.estado.ajustes || {}).caja || {}).fondoHabitual;
      if (fondo != null) inp.value = Number(fondo);
    }
    const b = $("#caja-btn-abrir");
    b.disabled = !!st.abriendo; b.textContent = st.abriendo ? "Abriendo…" : "Abrir caja";
    const m = $("#caja-abrir-msg");
    m.textContent = st.msg ? st.msg.texto : "";
    m.classList.toggle("ok", !!(st.msg && st.msg.ok));
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
    guardarCarrito();
  }

  // Cómo va la caja (abierta) o el informe del cierre (cerrada). Los números los calcula la base: resumen_caja.
  function renderResumen() {
    const box = $("#caja-resumen");
    const c = st.caja;
    box.hidden = !c || !!st.errorCarga;
    if (box.hidden) return;
    const cerrada = c.estado === "cerrada";
    const abiertoAntes = box.open;
    box.textContent = "";
    box.open = cerrada || abiertoAntes;
    box.appendChild(el("summary", "sec-t", cerrada ? "Informe del cierre · Caja " + c.numero : "Cómo va la caja"));
    if (st.errorResumen) { box.appendChild(el("p", "caja-msg mal", st.errorResumen)); return; }
    const r = st.resumen;
    if (!r) { box.appendChild(el("p", "empty", "Calculando…")); return; }
    if (cerrada && r.efectivo_contado == null) { box.appendChild(el("p", "empty", "Esta caja se cerró sin informe.")); return; }
    const hayAlgo = r.ventas || r.anuladas || (r.anulaciones_anteriores || []).length || st.movimientos.length;
    if (!cerrada && !hayAlgo) { box.appendChild(el("p", "empty", "Cuando registres ventas, acá vas a ver cuánto vendiste, cuánto costó y cuánto queda.")); return; }

    if (cerrada) {
      const d = new Date(r.cerrada_en || c.cerrada_en);
      box.appendChild(el("p", "hint", "Abierta el " + new Date(r.abierta_en || c.abierta_en).toLocaleDateString("es-AR") + " a las " + hora(r.abierta_en || c.abierta_en) +
        ", cerrada el " + d.toLocaleDateString("es-AR") + " a las " + hora(d) + ". Este informe ya no cambia."));
    }

    const kpis = el("div", "res-kpis");
    const kpi = (k, v, nota, cls) => {
      const d = el("div", "res-kpi" + (cls ? " " + cls : ""));
      d.append(el("span", "k", k), el("span", "v num", v)); // los cuadros grandes van sin centavos; el detalle los muestra
      if (nota) d.appendChild(el("span", "note", nota));
      kpis.appendChild(d);
    };
    kpi("Ventas netas", fmtPesos(Math.round(r.ventas_netas)), r.ventas + (r.ventas === 1 ? " venta" : " ventas"));
    kpi("Costo de mercadería", fmtPesos(Math.round(r.costo_mercaderia)), "insumos y packaging");
    kpi("Margen bruto", fmtPesos(Math.round(r.margen_bruto)), r.margen_pct != null ? r.margen_pct.toLocaleString("es-AR") + "% de las ventas netas" : "");
    kpi("Resultado estimado", fmtPesos(Math.round(r.resultado_estimado)), "después de gastos, gastos fijos y nafta", "hl");
    if (cerrada) {
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
    tabla("¿Cuánto gané?", [
      ["Ventas brutas (precio de lista)", fmtPesos(r.ventas_brutas)],
      r.descuentos ? ["− Descuentos", fmtPesos(r.descuentos)] : null,
      ["= Ventas netas", fmtPesos(r.ventas_netas), "tot"],
      ["− Costo de mercadería vendida", fmtPesos(r.costo_mercaderia)],
      ["= Margen bruto", fmtPesos(r.margen_bruto), "tot"],
      r.envios_cobrados ? ["+ Envíos cobrados aparte", fmtPesos(r.envios_cobrados)] : null,
      r.gastos_operativos ? ["− Gastos del día", fmtPesos(r.gastos_operativos)] : null,
      ["− Gastos fijos estimados (" + r.unidades + " productos × " + fmtPesos(r.gasto_fijo_por_unidad) + ")", fmtPesos(r.gastos_fijos_estimados)],
      ["− Nafta estimada (" + r.pedidos_con_envio + (r.pedidos_con_envio === 1 ? " pedido" : " pedidos") + " × " + fmtPesos(r.nafta_por_pedido) + ")", fmtPesos(r.nafta_estimada)],
      ["= Resultado estimado", fmtPesos(r.resultado_estimado), "tot hl"],
    ]);
    const notas = [];
    if (r.gastos_en_fijos) notas.push(fmtPesos(r.gastos_en_fijos) + " de gastos pagados hoy ya están en tus gastos fijos: no se restan de nuevo.");
    if (r.compras_mercaderia) notas.push("Las compras de mercadería (" + fmtPesos(r.compras_mercaderia) + ") no restan del resultado: ese costo entra cuando vendés.");
    if (notas.length) box.appendChild(el("p", "hint", notas.join(" ")));

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
        ["= Disponible estimado para retirar", fmtPesos(r.disponible_estimado), "tot hl"],
      ]);
    } else if (r.reserva_apartada) {
      box.appendChild(el("p", "hint", "Reserva apartada: " + fmtPesos(r.reserva_apartada) + "."));
    }
    box.appendChild(el("p", "hint", "Reserva sugerida para reponer mercadería: " + fmtPesos(r.reserva_sugerida) + " (lo que costó lo que vendiste)." +
      (cerrada && Number(r.reserva_apartada) < Number(r.reserva_sugerida) ? " Apartaste " + fmtPesos(r.reserva_apartada) + "." : "")));

    if (r.anuladas) box.appendChild(el("p", "hint", (r.anuladas === 1 ? "1 venta anulada" : r.anuladas + " ventas anuladas") + " en esta caja (" + fmtPesos(r.anuladas_total) + "): " + (r.anuladas === 1 ? "no cuenta" : "no cuentan") + " en nada."));
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

  // Campo de anulación (motivo + confirmar) para una venta o un movimiento.
  function formAnular(tipo, id, texto) {
    const a = st.anular;
    const f = el("div", "anular-form");
    const mo = el("input", "motivo"); mo.placeholder = "Motivo de la anulación (obligatorio)"; mo.maxLength = 120; mo.value = a.motivo;
    mo.setAttribute("aria-label", "Motivo de la anulación");
    mo.oninput = () => { a.motivo = mo.value; };
    const ok = el("button", "btn danger", a.enviando ? "Anulando…" : texto); ok.type = "button"; ok.disabled = a.enviando;
    ok.onclick = () => confirmarAnulacion(tipo);
    const no = el("button", "btn ghost", "Cancelar"); no.type = "button"; no.onclick = () => { st.anular = null; render(); };
    f.append(mo, ok, no);
    if (a.error) f.appendChild(el("p", "caja-msg mal", a.error));
    setTimeout(() => { if (st.anular && st.anular.id === id && document.activeElement !== mo) mo.focus(); });
    return f;
  }
  const botonAnular = (id) => {
    const b = el("button", "btn ghost chico", "Anular"); b.type = "button";
    b.onclick = () => { st.anular = { id, motivo: "", enviando: false, error: "" }; st.msgVentas = null; st.msgMovs = null; render(); };
    return b;
  };
  const mensaje = (m) => { const d = el("div", "caja-msg " + (m.ok ? "ok" : "mal"), m.texto); d.setAttribute("role", m.ok ? "status" : "alert"); return d; };

  // Gastos, compras, retiros, aportes, reservas y ajustes de la caja abierta.
  function renderMovs() {
    const box = $("#caja-movs");
    const abierta = st.caja && st.caja.estado === "abierta";
    box.hidden = !abierta;
    if (!abierta) return;
    const enfocado = document.activeElement && document.activeElement.id;
    box.textContent = "";
    box.appendChild(el("h2", "sec-t", "Gastos y retiros"));
    const m = st.mov;
    const chips = (k, opciones, actual, alElegir) => {
      const fila = el("div", "fila-chips");
      if (k) fila.appendChild(el("span", "k", k));
      opciones.forEach(([v, txt]) => {
        const b = el("button", "chip", txt); b.type = "button";
        b.setAttribute("aria-pressed", actual === v ? "true" : "false");
        b.onclick = () => { alElegir(v); render(); };
        fila.appendChild(b);
      });
      return fila;
    };
    const tiposBox = chips(null, Object.entries(TIPOS).map(([k, t]) => [k, t.nombre]), m.tipo, (v) => { m.tipo = v; m.pendienteId = null; st.msgMovs = null; });
    tiposBox.classList.add("mov-tipos");
    box.appendChild(tiposBox);
    box.appendChild(el("p", "hint", TIPOS[m.tipo].ayuda));
    if (m.tipo !== "reserva") box.appendChild(chips("Con", Object.entries(MEDIOS), m.medio, (v) => { m.medio = v; m.pendienteId = null; }));
    if (m.tipo === "ajuste") box.appendChild(chips(null, [[1, "Sobra plata (+)"], [-1, "Falta plata (−)"]], m.signo, (v) => { m.signo = v; m.pendienteId = null; }));

    const fila = el("div", "mov-campos");
    const imp = el("input", "n"); imp.id = "caja-mov-importe"; imp.type = "number"; imp.min = "0"; imp.step = "any"; imp.inputMode = "numeric"; imp.placeholder = "$";
    imp.value = m.importe; imp.setAttribute("aria-label", "Importe");
    imp.oninput = () => { m.importe = imp.value; m.pendienteId = null; };
    const de = el("input", "motivo"); de.id = "caja-mov-desc"; de.maxLength = 120; de.placeholder = TIPOS[m.tipo].desc; de.value = m.desc;
    de.setAttribute("aria-label", "Detalle");
    de.oninput = () => { m.desc = de.value; m.pendienteId = null; };
    fila.append(imp, de);
    box.appendChild(fila);
    if (m.tipo === "gasto") {
      const lab = el("label", "check");
      const cb = el("input"); cb.type = "checkbox"; cb.id = "caja-mov-fijos"; cb.checked = m.fijos;
      cb.onchange = () => { m.fijos = cb.checked; m.pendienteId = null; };
      lab.append(cb, document.createTextNode(" Ya está en mis gastos fijos (no lo resta de nuevo)"));
      box.appendChild(lab);
    }
    const ok = el("button", "btn primary", m.enviando ? "Guardando…" : "Guardar " + TIPOS[m.tipo].nombre.toLowerCase());
    ok.type = "button"; ok.id = "caja-mov-ok"; ok.disabled = m.enviando; ok.onclick = guardarMovimiento;
    box.appendChild(ok);
    if (st.msgMovs) box.appendChild(mensaje(st.msgMovs));
    if (enfocado && ["caja-mov-importe", "caja-mov-desc"].includes(enfocado)) $("#" + enfocado).focus();

    if (!st.movimientos.length) return;
    const ul = el("ul", "ventas movs");
    st.movimientos.forEach((x) => {
      const li = el("li", "venta" + (x.estado === "anulado" ? " anulada" : ""));
      const signo = x.tipo === "aporte" || (x.tipo === "ajuste" && x.importe > 0) ? "+ " : x.tipo === "reserva" ? "" : "− ";
      const detalle = [x.tipo === "reserva" ? "Apartada" : MEDIOS[x.medio] || x.medio, x.descripcion, x.en_gastos_fijos ? "ya está en gastos fijos" : ""];
      li.append(el("span", "n", TIPOS[x.tipo].nombre), el("span", "h", hora(x.creado_en)),
        el("span", "it", detalle.filter(Boolean).join(" · ")), el("span", "t num", signo + fmtPesos(Math.abs(x.importe))));
      if (x.estado === "anulado") li.appendChild(el("span", "tag", "anulado: " + x.motivo_anulacion));
      else if (st.anular && st.anular.id === x.id) li.appendChild(formAnular("movimiento", x.id, "Anular movimiento"));
      else li.appendChild(botonAnular(x.id));
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  function renderVentas() {
    const box = $("#caja-ventas");
    box.textContent = "";
    if (!(st.caja && st.caja.estado === "abierta")) { box.hidden = true; return; }
    box.hidden = false;
    box.appendChild(el("h2", "sec-t", "Ventas de esta caja"));
    if (st.msgVentas) box.appendChild(mensaje(st.msgVentas));
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
      if (v.estado === "anulada") li.appendChild(el("span", "tag", "anulada: " + (v.motivo_anulacion || "")));
      else if (st.anular && st.anular.id === v.id) li.appendChild(formAnular("venta", v.id, "Anular venta " + v.numero));
      else li.appendChild(botonAnular(v.id));
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  // Cerrar la caja: efectivo esperado contra contado, transferencias contra banco, fondo para mañana y observaciones.
  function renderCierre() {
    const box = $("#caja-cierre");
    const abierta = st.caja && st.caja.estado === "abierta";
    box.hidden = !abierta;
    if (!abierta) return;
    const c = st.cierre, r = st.resumen;
    const enfocado = document.activeElement && document.activeElement.id;
    box.textContent = "";
    box.appendChild(el("h2", "sec-t", "Cerrar la caja"));
    if (!c.abierto) {
      box.appendChild(el("p", "hint", "Contás la plata, la comparás con lo que tendría que haber y queda guardado el informe del día. Después no se puede modificar."));
      const b = el("button", "btn primary grande", "Cerrar caja"); b.type = "button"; b.id = "caja-btn-cerrar";
      b.onclick = () => { c.abierto = true; c.msg = null; render(); $("#caja-cierre-contado").focus(); };
      box.appendChild(b);
      return;
    }
    if (!r) { box.appendChild(el("p", st.errorResumen ? "caja-msg mal" : "empty", st.errorResumen || "Calculando…")); return; }
    if (c.fondo == null) c.fondo = String(Number(st.caja.saldo_inicial) || 0);
    if (st.carrito.length) box.appendChild(el("p", "caja-msg mal", "Hay una venta sin cobrar en el carrito. Cobrala o vaciá el carrito antes de cerrar."));

    const campo = (id, etiqueta, valor, alCambiar, extra) => {
      const lab = el("label", "f", etiqueta);
      const i = el("input", "n grande"); i.id = id; i.type = "number"; i.min = "0"; i.step = "any"; i.inputMode = "numeric"; i.value = valor;
      i.oninput = () => { alCambiar(i.value); refrescarCierre(); };
      lab.appendChild(i);
      if (extra) lab.appendChild(extra);
      return lab;
    };
    const esperado = el("div", "cierre-esperado");
    esperado.append(el("span", "k", "Efectivo que tendría que haber"), el("span", "v num", fmtPesos(r.efectivo_esperado)));
    box.appendChild(esperado);
    const dif = el("span", "cierre-dif"); dif.id = "caja-cierre-dif";
    box.appendChild(campo("caja-cierre-contado", "Efectivo que contaste ($)", c.contado, (v) => { c.contado = v; }, dif));

    const esperadoTr = el("div", "cierre-esperado chico");
    esperadoTr.append(el("span", "k", "Transferencias que tendrían que haber entrado"), el("span", "v num", fmtPesos(r.transferencias_esperadas)));
    box.appendChild(esperadoTr);
    const difTr = el("span", "cierre-dif"); difTr.id = "caja-cierre-dif-tr";
    box.appendChild(campo("caja-cierre-banco", "Lo que ves en el banco de hoy ($, opcional)", c.banco, (v) => { c.banco = v; }, difTr));
    box.appendChild(campo("caja-cierre-fondo", "Efectivo que queda de fondo para mañana ($)", c.fondo, (v) => { c.fondo = v; }));

    const lab = el("label", "f", "Observaciones (obligatorio si hay diferencia)");
    const obs = el("textarea", "obs"); obs.id = "caja-cierre-obs"; obs.rows = 2; obs.maxLength = 500; obs.value = c.obs;
    obs.oninput = () => { c.obs = obs.value; };
    lab.appendChild(obs);
    box.appendChild(lab);
    const disp = el("p", "cierre-disp"); disp.id = "caja-cierre-disp";
    box.appendChild(disp);

    const acc = el("div", "cierre-acc");
    const ok = el("button", "btn danger grande", c.enviando ? "Cerrando…" : "Confirmar cierre"); ok.type = "button"; ok.id = "caja-cierre-ok";
    ok.disabled = c.enviando || !!st.carrito.length;
    ok.onclick = cerrar;
    const no = el("button", "btn ghost", "Cancelar"); no.type = "button"; no.disabled = c.enviando;
    no.onclick = () => { st.cierre = cierreVacio(); render(); };
    acc.append(ok, no);
    box.appendChild(acc);
    if (c.msg) box.appendChild(mensaje(c.msg));
    if (enfocado && /^caja-cierre-/.test(enfocado) && $("#" + enfocado)) $("#" + enfocado).focus();
    refrescarCierre();
  }
  // Diferencias y disponible en vivo, mientras se escribe (sin redibujar los campos).
  function refrescarCierre() {
    const c = st.cierre, r = st.resumen;
    const d = $("#caja-cierre-dif"); if (!d || !r) return;
    const txtDif = (dif) => (dif === 0 ? "Coincide" : dif < 0 ? "Falta " + fmtPesos(-dif / 100) : "Sobra " + fmtPesos(dif / 100));
    const dEf = c.contado === "" ? null : aCentavos(c.contado) - aCentavos(r.efectivo_esperado);
    d.textContent = dEf == null ? "" : txtDif(dEf);
    d.className = "cierre-dif " + (dEf == null ? "" : dEf === 0 ? "ok" : "mal");
    const dTr = c.banco === "" ? null : aCentavos(c.banco) - aCentavos(r.transferencias_esperadas);
    const t = $("#caja-cierre-dif-tr");
    t.textContent = dTr == null ? "" : txtDif(dTr);
    t.className = "cierre-dif " + (dTr == null ? "" : dTr === 0 ? "ok" : "mal");
    const disp = $("#caja-cierre-disp");
    if (dEf == null) { disp.textContent = ""; return; }
    const tr = c.banco === "" ? aCentavos(r.transferencias_esperadas) : aCentavos(c.banco);
    const val = aCentavos(c.contado) + tr - aCentavos(c.fondo) - aCentavos(r.reserva_apartada);
    disp.textContent = "Disponible estimado para retirar: " + fmtPesos(val / 100) + " (contado + transferencias − fondo − reserva apartada).";
  }

  $("#caja-btn-abrir").onclick = abrir;
  $("#caja-saldo").addEventListener("input", (e) => e.target.setCustomValidity(""));
  calc.alCambiar(() => { if (st.cargado) render(); });
  $("#caja-pantalla").onclick = () => {
    pantalla.quiere = !pantalla.quiere;
    try { localStorage.setItem("caja-pantalla", pantalla.quiere ? "1" : "0"); } catch (e) {}
    mantenerPantalla();
  };
  // El celular suelta el bloqueo cuando la app pasa a segundo plano: al volver se pide de nuevo.
  document.addEventListener("visibilitychange", mantenerPantalla);
  // Cuando vuelve internet, si la caja no se había podido cargar, se intenta de nuevo sola.
  window.addEventListener("online", () => { if (st.errorCarga) recargar(); });
  render();
  recargar();
}
