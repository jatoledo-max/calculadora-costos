// Pestaña Tickets: el negocio arma el pedido que el cliente le escribió por WhatsApp, le pone el envío
// y le manda un link. El cliente lo abre (ticket.html), lo acepta, pide un cambio o lo rechaza, y acá se ve la respuesta.
// Los precios salen de la calculadora; la base los vuelve a calcular al guardar (supabase/tickets.sql).
import { fmtPesos, aCentavos } from "./dinero.js";
import { SinRespuesta } from "./stores.js";
import { categoriaDe as catDe, ordenarCategorias } from "./costos.js";
import { ESTADOS, linkTicket, textoWhatsApp } from "./tickets-datos.js";

// caja: { cargarTicket(t) } para pasar un ticket aceptado al carrito de la Caja (null si no hay caja).
export function iniciarTickets(calc, backend, nombreNegocio, caja) {
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const hora = (iso) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  const dia = (iso) => {
    const d = new Date(iso), hoy = new Date();
    return d.toDateString() === hoy.toDateString() ? hora(iso) : d.toLocaleDateString("es-AR", { day: "numeric", month: "numeric" }) + " " + hora(iso);
  };

  const st = {
    lineas: [], envio: "retira", envioMonto: "", cliente: "", nota: "",
    editando: null,                 // { id, numero } cuando se corrige un ticket ya enviado
    pendienteId: null,              // id del ticket nuevo: se mantiene en los reintentos para no duplicar
    cat: null, opcionPara: null, enviando: false, msg: null,
    listo: null,                    // el ticket recién guardado, para mandarlo
    lista: [], cargado: false, errorLista: "", msgLista: null,
  };
  // El borrador se guarda en el celular: si vas a WhatsApp a releer el pedido y volvés, sigue ahí.
  const CLAVE = "tickets-borrador-v1";
  const CAMPOS = ["lineas", "envio", "envioMonto", "cliente", "nota", "editando", "pendienteId"];
  try {
    const g = JSON.parse(localStorage.getItem(CLAVE) || "null");
    if (g && Array.isArray(g.lineas)) CAMPOS.forEach((k) => { if (k in g) st[k] = g[k]; });
  } catch (e) {}
  function guardarBorrador() {
    try {
      if (!st.lineas.length && !st.editando) localStorage.removeItem(CLAVE);
      else localStorage.setItem(CLAVE, JSON.stringify(Object.fromEntries(CAMPOS.map((k) => [k, st[k]]))));
    } catch (e) {}
  }
  // Tickets que ya pasaste a la Caja (en este celular), para no cobrar dos veces el mismo.
  const CLAVE_CAJA = "tickets-en-caja-v1";
  let enCaja = [];
  try { enCaja = JSON.parse(localStorage.getItem(CLAVE_CAJA) || "[]"); } catch (e) {}

  const prods = () => calc.estado.productos;
  const vendible = (p) => p && !p.esPreparacion;
  const precioDe = (p, opcionId) => {
    const op = opcionId ? (p.opciones || []).find((o) => o.id === opcionId) : null;
    return (Number(p.precioVenta) || 0) + (op ? Number(op.precioExtra) || 0 : 0);
  };
  const envioHabitual = () => {
    const aj = calc.estado.ajustes || {};
    const m = (aj.menu || {}).envio, d = (aj.delivery || {}).cobroEnvio;
    return m != null && m !== "" ? Number(m) : Number(d) > 0 ? Number(d) : "";
  };
  function totales() {
    let sub = 0;
    st.lineas.forEach((l) => { const p = prods()[l.producto]; if (p) sub += aCentavos(precioDe(p, l.opcion)) * l.cantidad; });
    const envio = st.envio === "envio" ? aCentavos(st.envioMonto) : 0;
    return { sub, envio, total: sub + envio };
  }

  // ---------- Datos ----------
  async function recargar() {
    try { st.lista = await backend.listar(); st.errorLista = ""; }
    catch (e) { st.errorLista = e instanceof SinRespuesta ? "Sin conexión: no se pudieron traer los tickets." : e.message; }
    st.cargado = true;
    renderLista();
  }

  async function crear() {
    if (st.enviando || !st.lineas.length) return;
    if (st.envio === "envio" && (st.envioMonto === "" || Number(st.envioMonto) < 0)) {
      st.msg = { ok: false, texto: "Poné el monto del envío (0 si es sin cargo)." }; render(); $("#tk-envio-monto").focus(); return;
    }
    const id = st.editando ? st.editando.id : (st.pendienteId = st.pendienteId || crypto.randomUUID());
    st.enviando = true; st.msg = null; render();
    try {
      const t = await backend.guardar({
        id, items: st.lineas.map((l) => ({ producto: l.producto, opcion: l.opcion || null, cantidad: l.cantidad })),
        envio: st.envio === "envio" ? Number(st.envioMonto) : null, cliente: st.cliente.trim(), nota: st.nota.trim(),
      });
      st.listo = { t, corregido: !!st.editando };
      vaciar();
    } catch (e) {
      st.msg = { ok: false, texto: e instanceof SinRespuesta ? "No hubo respuesta. Tocá de nuevo: si ya se había guardado, no se duplica." : e.message };
    }
    st.enviando = false;
    render();
    recargar();
  }

  function vaciar() {
    st.lineas = []; st.envio = "retira"; st.envioMonto = ""; st.cliente = ""; st.nota = "";
    st.editando = null; st.pendienteId = null; st.opcionPara = null; st.msg = null;
  }

  function corregir(t) {
    if (st.lineas.length && !confirm("Tenés otro ticket a medio armar. ¿Lo reemplazás por el ticket #" + t.numero + "?")) return;
    st.lineas = t.items.filter((i) => prods()[i.producto]).map((i) => ({ producto: i.producto, opcion: i.opcion || null, cantidad: i.cantidad }));
    st.envio = t.envio == null ? "retira" : "envio"; st.envioMonto = t.envio == null ? "" : String(Number(t.envio));
    st.cliente = t.cliente || ""; st.nota = t.nota || "";
    st.editando = { id: t.id, numero: t.numero, respuesta: t.estado === "cambio" ? t.respuesta : null };
    st.pendienteId = null; st.listo = null; st.msg = null;
    render();
    $("#view-tickets").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function pasarACaja(t) {
    const r = caja.cargarTicket(t);
    if (!r) return;
    if (!enCaja.includes(t.id)) { enCaja = enCaja.concat(t.id).slice(-200); try { localStorage.setItem(CLAVE_CAJA, JSON.stringify(enCaja)); } catch (e) {} }
    $("#tab-caja").click();
  }

  function agregar(productoId, opcion) {
    const l = st.lineas.find((x) => x.producto === productoId && (x.opcion || null) === (opcion || null));
    if (l) l.cantidad = Math.min(l.cantidad + 1, 999);
    else st.lineas.push({ producto: productoId, opcion: opcion || null, cantidad: 1 });
    st.opcionPara = null; st.msg = null; st.listo = null;
    render();
  }

  // ---------- Pantalla ----------
  function render() {
    if (!$("#view-tickets")) return;
    renderCats(); renderProds(); renderTicket();
    guardarBorrador();
  }

  function renderCats() {
    const box = $("#tk-cats");
    const cats = ordenarCategorias(Object.values(prods()).filter(vendible).map(catDe));
    if (!cats.includes(st.cat)) st.cat = cats[0] || null;
    box.textContent = "";
    cats.forEach((c) => {
      const b = el("button", "chip-cat", c); b.type = "button";
      b.setAttribute("aria-pressed", c === st.cat ? "true" : "false");
      b.onclick = () => { st.cat = c; st.opcionPara = null; render(); };
      box.appendChild(b);
    });
  }

  function renderProds() {
    const box = $("#tk-prods");
    box.textContent = "";
    const lista = Object.entries(prods()).filter(([, p]) => vendible(p) && catDe(p) === st.cat)
      .sort((a, b) => (a[1].nombre || "").localeCompare(b[1].nombre || "", "es"));
    if (!lista.length) { box.appendChild(el("p", "empty", "No hay productos. Cargalos en la pestaña Productos.")); return; }
    lista.forEach(([id, p]) => {
      const sinPrecio = !(Number(p.precioVenta) > 0);
      if (st.opcionPara === id) {
        const grupo = el("div", "pbtn-opciones");
        grupo.appendChild(el("span", "pbtn-op-t", p.nombre));
        const bc = el("button", "pbtn op", "Común · " + fmtPesos(precioDe(p, null))); bc.type = "button"; bc.onclick = () => agregar(id, null);
        grupo.appendChild(bc);
        (p.opciones || []).forEach((o) => {
          const b = el("button", "pbtn op", o.nombre + " · " + fmtPesos(precioDe(p, o.id))); b.type = "button"; b.onclick = () => agregar(id, o.id);
          grupo.appendChild(b);
        });
        const bx = el("button", "btn ghost", "Cancelar"); bx.type = "button"; bx.onclick = () => { st.opcionPara = null; render(); };
        grupo.appendChild(bx);
        box.appendChild(grupo);
        return;
      }
      const b = el("button", "pbtn"); b.type = "button";
      b.append(el("span", "nm", p.nombre || "(sin nombre)"), el("span", "pr num", sinPrecio ? "sin precio" : fmtPesos(p.precioVenta)));
      if ((p.opciones || []).length) b.appendChild(el("span", "mas", "con opciones"));
      if (p.agotado) b.appendChild(el("span", "mas", "agotado en el menú"));
      b.disabled = sinPrecio || st.enviando;
      b.onclick = () => { if ((p.opciones || []).length) { st.opcionPara = id; render(); } else agregar(id, null); };
      box.appendChild(b);
    });
  }

  function renderTicket() {
    const box = $("#tk-ticket");
    const enfocado = document.activeElement && document.activeElement.id;
    box.textContent = "";
    if (st.listo) box.appendChild(panelEnviar(st.listo.t, st.listo.corregido));
    if (st.editando) {
      const c = el("div", "tk-corrigiendo");
      c.appendChild(el("b", null, "Corrigiendo el ticket #" + st.editando.numero));
      if (st.editando.respuesta) c.appendChild(el("span", null, "El cliente pidió: " + st.editando.respuesta));
      const x = el("button", "btn ghost", "Cancelar corrección"); x.type = "button";
      x.onclick = () => { vaciar(); render(); };
      c.appendChild(x);
      box.appendChild(c);
    }
    if (st.msg) { const m = el("div", "caja-msg " + (st.msg.ok ? "ok" : "mal"), st.msg.texto); m.setAttribute("role", st.msg.ok ? "status" : "alert"); box.appendChild(m); }
    box.classList.toggle("vacio", !st.lineas.length && !st.listo);
    if (!st.lineas.length) {
      if (!st.listo) box.appendChild(el("p", "empty", "Leé el pedido que te mandó el cliente y tocá los productos. Después ponés el envío y se lo mandás."));
      return;
    }

    const ul = el("ul", "lineas");
    st.lineas.forEach((l, n) => {
      const p = prods()[l.producto];
      const op = p && l.opcion ? (p.opciones || []).find((o) => o.id === l.opcion) : null;
      const li = el("li", "linea");
      const menos = el("button", "qty", "−"); menos.type = "button"; menos.setAttribute("aria-label", "Uno menos");
      const mas = el("button", "qty", "+"); mas.type = "button"; mas.setAttribute("aria-label", "Uno más");
      const quitar = el("button", "btn ghost", "✕"); quitar.type = "button"; quitar.setAttribute("aria-label", "Quitar");
      menos.onclick = () => { if (l.cantidad > 1) l.cantidad--; else st.lineas.splice(n, 1); render(); };
      mas.onclick = () => { l.cantidad = Math.min(l.cantidad + 1, 999); render(); };
      quitar.onclick = () => { st.lineas.splice(n, 1); render(); };
      li.append(menos, el("span", "cant num", String(l.cantidad)), mas,
        el("span", "nm", (p ? p.nombre : "(borrado)") + (op ? " · " + op.nombre : "")),
        el("span", "sub num", p ? fmtPesos(precioDe(p, l.opcion) * l.cantidad) : ""), quitar);
      ul.appendChild(li);
    });
    box.appendChild(ul);

    // Envío: retira o con envío (el monto lo escribís vos; arranca con el envío habitual).
    const env = el("div", "fila-chips");
    env.appendChild(el("span", "k", "Envío"));
    [["retira", "Retira"], ["envio", "Con envío"]].forEach(([k, txt]) => {
      const b = el("button", "chip", txt); b.type = "button";
      b.setAttribute("aria-pressed", st.envio === k ? "true" : "false");
      b.onclick = () => {
        st.envio = k;
        if (k === "envio" && st.envioMonto === "") st.envioMonto = String(envioHabitual());
        render();
        if (k === "envio") { const i = $("#tk-envio-monto"); i.focus(); i.select(); }
      };
      env.appendChild(b);
    });
    if (st.envio === "envio") {
      const i = el("input", "n"); i.id = "tk-envio-monto"; i.type = "number"; i.min = "0"; i.inputMode = "numeric"; i.placeholder = "$"; i.value = st.envioMonto;
      i.setAttribute("aria-label", "Monto del envío");
      i.oninput = () => { st.envioMonto = i.value; refrescar(); };
      env.appendChild(i);
    }
    box.appendChild(env);

    // Opcionales: para quién es (solo para reconocerlo en la lista) y una nota que ve el cliente.
    const extra = el("div", "tk-extra");
    const cli = el("input"); cli.id = "tk-cliente"; cli.maxLength = 60; cli.placeholder = "Cliente (opcional)"; cli.value = st.cliente;
    cli.setAttribute("aria-label", "Cliente"); cli.autocomplete = "off";
    cli.oninput = () => { st.cliente = cli.value; guardarBorrador(); };
    const nota = el("input"); nota.id = "tk-nota"; nota.maxLength = 200; nota.placeholder = "Nota para el cliente (opcional)"; nota.value = st.nota;
    nota.setAttribute("aria-label", "Nota para el cliente");
    nota.oninput = () => { st.nota = nota.value; guardarBorrador(); };
    extra.append(cli, nota);
    box.appendChild(extra);

    const tot = el("div", "caja-total");
    const tv = el("span", "v num"); tv.id = "tk-total";
    tot.append(el("span", "k", "Total"), tv);
    box.appendChild(tot);

    const ok = el("button", "btn primary grande", st.enviando ? "Guardando…" : st.editando ? "Guardar corrección" : "Crear ticket");
    ok.type = "button"; ok.id = "tk-crear"; ok.disabled = st.enviando; ok.onclick = crear;
    box.appendChild(ok);
    refrescar();
    if (enfocado && ["tk-envio-monto", "tk-cliente", "tk-nota"].includes(enfocado) && $("#" + enfocado)) $("#" + enfocado).focus();
  }
  function refrescar() {
    const tv = $("#tk-total"); if (tv) tv.textContent = fmtPesos(totales().total / 100);
    guardarBorrador();
  }

  // Botones para mandar el ticket por WhatsApp, copiar el mensaje o verlo como el cliente.
  function accionesEnviar(t, conCopiar) {
    const link = linkTicket(t.token);
    const texto = textoWhatsApp(t, nombreNegocio(), link);
    const fila = el("div", "tk-acciones");
    const wa = el("a", "btn primary tk-wa", "Enviar por WhatsApp");
    wa.href = "https://wa.me/?text=" + encodeURIComponent(texto); wa.target = "_blank"; wa.rel = "noopener";
    fila.appendChild(wa);
    if (conCopiar) {
      const cp = el("button", "btn", "Copiar mensaje"); cp.type = "button";
      cp.onclick = async () => {
        try { await navigator.clipboard.writeText(texto); cp.textContent = "Copiado ✓"; } catch (e) { cp.textContent = "No se pudo copiar"; }
        setTimeout(() => { cp.textContent = "Copiar mensaje"; }, 2000);
      };
      fila.appendChild(cp);
    }
    const ver = el("a", "btn ghost", "Ver como el cliente"); ver.href = link; ver.target = "_blank"; ver.rel = "noopener";
    fila.appendChild(ver);
    return fila;
  }

  function panelEnviar(t, corregido) {
    const box = el("div", "tk-listo");
    box.setAttribute("role", "status");
    box.appendChild(el("b", null, (corregido ? "Ticket #" + t.numero + " corregido" : "Ticket #" + t.numero + " listo") + " · " + fmtPesos(t.total)));
    box.appendChild(el("p", "hint", corregido ? "Mandale el link de nuevo: es el mismo y ya muestra la corrección." : "Mandáselo al cliente. Cuando responda, lo ves abajo en Tickets enviados."));
    box.appendChild(accionesEnviar(t, true));
    const otro = el("button", "btn ghost", "Cerrar"); otro.type = "button"; otro.onclick = () => { st.listo = null; render(); };
    box.appendChild(otro);
    return box;
  }

  function renderLista() {
    const box = $("#tk-lista");
    if (!box) return;
    box.textContent = "";
    const cab = el("div", "tk-lista-cab");
    cab.appendChild(el("h2", "sec-t", "Tickets enviados"));
    const act = el("button", "btn ghost", "Actualizar"); act.type = "button"; act.onclick = recargar;
    cab.appendChild(act);
    box.appendChild(cab);
    if (!st.cargado) { box.appendChild(el("p", "empty", "Cargando…")); return; }
    if (st.errorLista) { box.appendChild(el("p", "caja-msg mal", st.errorLista)); return; }
    if (!st.lista.length) { box.appendChild(el("p", "empty", "Todavía no mandaste tickets.")); return; }
    const ul = el("ul", "ventas tk-tickets");
    st.lista.forEach((t) => {
      const li = el("li", "venta tk-item tk-" + t.estado);
      li.append(el("span", "n", "#" + t.numero + (t.cliente ? " · " + t.cliente : "")), el("span", "h", dia(t.creado_en)),
        el("span", "md"), el("span", "t num", fmtPesos(t.total)));
      li.querySelector(".md").appendChild(el("span", "tag tk-estado", ESTADOS[t.estado] || t.estado));
      li.appendChild(el("span", "it", t.items.map((i) => i.cantidad + "× " + i.nombre + (i.opcion_nombre ? " (" + i.opcion_nombre + ")" : "")).join(", ") +
        (t.envio == null ? " · retira" : " · envío " + fmtPesos(t.envio))));
      if (t.estado === "cambio" && t.respuesta) li.appendChild(el("p", "tk-respuesta", "Pide: " + t.respuesta));
      if (t.estado === "rechazado" && t.respuesta) li.appendChild(el("p", "tk-respuesta", "Motivo: " + t.respuesta));
      const acc = el("div", "tk-acc");
      if (t.estado === "aceptado" && caja) {
        const yaEsta = enCaja.includes(t.id);
        const b = el("button", "btn" + (yaEsta ? "" : " primary"), yaEsta ? "Ya está en la Caja · pasar de nuevo" : "Pasar a la Caja"); b.type = "button";
        b.onclick = () => { if (!yaEsta || confirm("Este ticket ya lo pasaste a la Caja. ¿Pasarlo de nuevo?")) pasarACaja(t); };
        acc.appendChild(b);
      }
      if (t.estado === "pendiente" || t.estado === "cambio") {
        const c = el("button", "btn" + (t.estado === "cambio" ? " primary" : ""), "Corregir"); c.type = "button"; c.onclick = () => corregir(t);
        acc.appendChild(c);
        const r = accionesEnviar(t, false);
        r.querySelector(".tk-wa").textContent = "Reenviar";
        r.querySelector(".tk-wa").className = "btn tk-wa";
        acc.append(...r.childNodes);
      } else {
        const ver = el("a", "btn ghost", "Ver"); ver.href = linkTicket(t.token); ver.target = "_blank"; ver.rel = "noopener";
        acc.appendChild(ver);
      }
      li.appendChild(acc);
      ul.appendChild(li);
    });
    box.appendChild(ul);
  }

  // Mientras la pestaña está a la vista, se fija cada 20 segundos si algún cliente respondió.
  const visible = () => !$("#view-tickets").hidden && document.visibilityState === "visible";
  setInterval(() => { if (visible()) recargar(); }, 20000);
  $("#tab-tickets").addEventListener("click", recargar);
  document.addEventListener("visibilitychange", () => { if (visible()) recargar(); });
  calc.alCambiar(render);
  render();
  recargar();
}
