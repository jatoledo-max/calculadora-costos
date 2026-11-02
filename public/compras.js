// Pestaña Compras: cada vez que comprás algo para el negocio lo cargás en tres toques:
// categoría (Carnicería) › qué compraste (nalga) › cuánto pagaste ($ 21.000). La app calcula cuántos kilos son
// con el último precio que pagaste por eso; si ponés el peso exacto, aprende el precio nuevo.
// Cada compra se descuenta sola de la caja abierta, en efectivo o transferencia. Con la caja cerrada se descuenta
// del "disponible para retirar" del último cierre (la foto del cierre no cambia: se muestra el disponible que queda) (como "Compra de mercadería"; no resta de la
// ganancia del día porque ese costo ya entra cuando vendés). Abajo: lo de hoy y el mes separado por categoría.
import { fmtPesos } from "./dinero.js";
import { SinRespuesta } from "./stores.js";
import {
  CATEGORIAS_INICIALES, UNIDADES, clave, hoyLocal, rangoMes, mesCorrido, nombreMes, precioReferencia, cantidadDe,
  fmtCantidad, nombreUnidad, actualizarRefs, loDeSiempre, resumen, errorCompra,
} from "./compras-datos.js";

export function iniciarCompras(calc, backend, caja, pantallaCaja) {
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const ajustes = () => calc.estado.ajustes.compras || {};
  const categorias = () => (Array.isArray(ajustes().categorias) && ajustes().categorias.length ? ajustes().categorias : CATEGORIAS_INICIALES);
  const refs = () => ajustes().refs || {};
  const guardarAjustes = (cambios) => calc.guardarAjuste("compras", Object.assign({ categorias: categorias(), refs: refs() }, ajustes(), cambios));

  let cat = null;
  try { cat = localStorage.getItem("compras-categoria"); } catch (e) {}
  const st = {
    hoy: hoyLocal(), mes: hoyLocal().slice(0, 7),
    deHoy: [], delMes: [], delAnterior: [], cargado: false, error: "",
    ultCaja: null, desdeCierre: [],         // última caja (si está cerrada: compras cargadas después de cerrarla)
    pendienteId: null, enviando: false, medio: "efectivo", editandoCats: false, borrando: null, catAbierta: null,
  };

  // ---------- Carga ----------
  async function cargar() {
    st.hoy = hoyLocal();
    const r = rangoMes(st.mes), ant = rangoMes(mesCorrido(st.mes, -1));
    try {
      const [h, m] = await Promise.all([backend.listar(st.hoy, st.hoy), backend.listar(ant.desde, r.hasta)]);
      st.deHoy = h;
      st.delMes = m.filter((c) => c.fecha >= r.desde);
      st.delAnterior = m.filter((c) => c.fecha < r.desde);
      st.cargado = true; st.error = "";
      await cargarDisponible();
    } catch (e) {
      st.error = e instanceof SinRespuesta ? "No se pudieron leer las compras: revisá la conexión." : e.message;
    }
    renderListas();
  }

  // Con la caja cerrada, las compras que cargás salen del disponible para retirar del último cierre.
  async function cargarDisponible() {
    st.ultCaja = null; st.desdeCierre = [];
    if (caja) {
      try { st.ultCaja = (await caja.cargar()).caja; } catch (e) { st.ultCaja = null; }
    }
    const c = st.ultCaja;
    if (c && c.estado === "cerrada" && c.cerrada_en && c.resumen && c.resumen.disponible_estimado != null) {
      const lista = await backend.listar(hoyLocal(new Date(c.cerrada_en)), st.hoy);
      st.desdeCierre = lista.filter((x) => !x.en_caja && String(x.creado_en) > String(c.cerrada_en));
    }
    if (pantallaCaja && pantallaCaja.comprasDesdeCierre) pantallaCaja.comprasDesdeCierre(conCierre() ? gananciaCierre() + resumen(st.desdeCierre).total : null);
    renderDisponible();
  }
  const conCierre = () => { const c = st.ultCaja; return c && c.estado === "cerrada" && c.resumen && c.resumen.disponible_estimado != null; };
  // Lo que queda para compras = disponible para retirar del cierre − tu ganancia de esa caja (es tuya) − compras ya cargadas.
  const gananciaCierre = () => Math.max(0, Math.round(Number(st.ultCaja.resumen.resultado_estimado) || 0));
  const quedaDisponible = () => Math.round(Number(st.ultCaja.resumen.disponible_estimado) - gananciaCierre() - resumen(st.desdeCierre).total);
  function renderDisponible() {
    const box = $("#cmp-disp");
    box.textContent = "";
    const c = st.ultCaja;
    if (c && c.estado === "abierta") {
      box.hidden = false; box.className = "cmp-disp abierta";
      box.appendChild(el("span", "k", "Caja " + c.numero + " abierta: las compras se descuentan de la caja."));
      return;
    }
    if (!conCierre()) { box.hidden = true; return; }
    box.hidden = false; box.className = "cmp-disp";
    const gastado = resumen(st.desdeCierre).total;
    const q = quedaDisponible();
    if (q < 0) box.classList.add("neg");
    box.append(el("span", "k", "Te queda para compras"), el("span", "v num", fmtPesos(q)),
      el("span", "note", "Disponible del cierre de la caja " + c.numero + " " + fmtPesos(Math.round(c.resumen.disponible_estimado)) +
        " − tu ganancia " + fmtPesos(gananciaCierre()) + (gastado ? " − compras " + fmtPesos(gastado) : "") + ". Las compras que cargues ahora se descuentan de acá."));
  }

  // ---------- Formulario ----------
  const desc = $("#cmp-desc"), imp = $("#cmp-importe"), cant = $("#cmp-cant"), uni = $("#cmp-unidad"), fecha = $("#cmp-fecha");
  const msg = (texto, ok) => { const m = $("#cmp-msg"); m.textContent = texto || ""; m.classList.toggle("ok", !!ok); };
  fecha.value = st.hoy; fecha.max = st.hoy;

  function renderCats() {
    const cats = categorias();
    if (!cats.includes(cat)) cat = null;
    const box = $("#cmp-cats");
    box.textContent = "";
    cats.forEach((c) => {
      const b = el("button", null, c); b.type = "button";
      b.setAttribute("aria-pressed", c === cat ? "true" : "false");
      b.onclick = () => { cat = c; try { localStorage.setItem("compras-categoria", c); } catch (e) {} st.pendienteId = null; msg(""); renderCats(); desc.focus(); };
      box.appendChild(b);
    });
    renderEditor();
    renderChips();
  }

  function renderChips() {
    const box = $("#cmp-chips");
    box.textContent = "";
    const lista = cat ? loDeSiempre(refs(), cat) : [];
    box.hidden = !lista.length;
    if (lista.length) box.appendChild(el("span", "hint", "Lo de siempre:"));
    lista.forEach((n) => {
      const b = el("button", null, n); b.type = "button";
      b.onclick = () => { desc.value = n; alEscribir(); imp.focus(); };
      box.appendChild(b);
    });
    // Sugerencias al escribir: todo lo que ya compraste y tus insumos.
    const dl = $("#cmp-sugeridos");
    dl.textContent = "";
    const nombres = new Map();
    Object.values(refs()).forEach((r) => nombres.set(clave(r.nombre), r.nombre));
    Object.values(calc.estado.insumos || {}).forEach((i) => { if (i && i.nombre && !nombres.has(clave(i.nombre))) nombres.set(clave(i.nombre), i.nombre); });
    [...nombres.values()].sort((a, b) => a.localeCompare(b, "es")).forEach((n) => { const o = el("option"); o.value = n; dl.appendChild(o); });
  }

  function renderEditor() {
    const box = $("#cmp-cats-editor");
    box.hidden = !st.editandoCats;
    $("#cmp-editar-cats").textContent = st.editandoCats ? "Listo" : "Editar categorías";
    if (!st.editandoCats) return;
    box.textContent = "";
    const ul = el("ul", "cmp-cats-lista");
    categorias().forEach((c) => {
      const li = el("li");
      li.appendChild(el("span", null, c));
      const x = el("button", "btn ghost chico", "Quitar"); x.type = "button";
      x.disabled = categorias().length <= 1;
      x.onclick = () => guardarAjustes({ categorias: categorias().filter((y) => y !== c) });
      li.appendChild(x);
      ul.appendChild(li);
    });
    box.appendChild(ul);
    const f = el("form", "addrow");
    const i = el("input"); i.id = "cmp-cat-nueva"; i.maxLength = 40; i.placeholder = "Nueva categoría (ej: Bebidas)";
    const ok = el("button", "btn primary chico", "Agregar"); ok.type = "submit";
    f.append(i, ok);
    f.onsubmit = (e) => {
      e.preventDefault();
      const n = i.value.trim();
      if (!n || categorias().some((y) => clave(y) === clave(n))) { i.focus(); return; }
      guardarAjustes({ categorias: [...categorias(), n] });
    };
    box.appendChild(f);
    box.appendChild(el("p", "hint", "Quitar una categoría no borra las compras que ya cargaste en ella."));
  }

  // El cuadro naranja: cuántos kilos son, o cuánto te salió el kilo si pusiste el peso.
  function alEscribir() {
    st.pendienteId = null;
    const box = $("#cmp-calc");
    const nombre = desc.value.trim();
    const ref = precioReferencia(nombre, refs(), calc.estado.insumos);
    if (ref && document.activeElement !== uni && !cant.value) uni.value = ref.unidad;
    const importe = Number(imp.value);
    const c = cantidadDe(importe, cant.value, uni.value, ref);
    box.textContent = "";
    box.hidden = !(nombre && importe > 0);
    if (box.hidden) return;
    const de = " de " + nombre.toLowerCase();
    if (c && !c.estimada) {
      const precio = importe / c.cantidad;
      box.append(el("b", null, fmtCantidad(c.cantidad, c.unidad)), document.createTextNode(de));
      let txt = "Te salió " + fmtPesos(Math.round(precio)) + " " + nombreUnidad(c.unidad);
      if (ref && ref.unidad === c.unidad) {
        const dif = Math.round(((precio - ref.precio) / ref.precio) * 100);
        txt += dif > 0 ? " · " + dif + "% más caro que antes" : dif < 0 ? " · " + -dif + "% más barato que antes" : " · igual que antes";
      }
      box.appendChild(el("span", null, txt));
    } else if (c) {
      box.append(document.createTextNode("≈ "), el("b", null, fmtCantidad(c.cantidad, c.unidad)), document.createTextNode(de));
      box.appendChild(el("span", null, "a " + fmtPesos(Math.round(ref.precio)) + " " + nombreUnidad(ref.unidad) +
        (ref.fuente === "compra" ? " (lo que pagaste la última vez)" : " (el precio de tus Insumos)")));
    } else {
      box.appendChild(document.createTextNode("Primera vez que cargás " + nombre.toLowerCase() + "."));
      box.appendChild(el("span", null, "Si ponés el peso abajo, la próxima vez la app calcula los kilos sola."));
    }
  }
  [desc, imp, cant, uni].forEach((x) => { x.oninput = () => { msg(""); alEscribir(); }; x.onchange = alEscribir; });
  fecha.onchange = () => { st.pendienteId = null; };
  // Efectivo o transferencia: viene marcado Efectivo; se toca solo si pagaste por transferencia.
  const pintarMedio = () => document.querySelectorAll("#cmp-medio .chip").forEach((b) => b.setAttribute("aria-pressed", b.dataset.medio === st.medio ? "true" : "false"));
  document.querySelectorAll("#cmp-medio .chip").forEach((b) => { b.onclick = () => { st.medio = b.dataset.medio; st.pendienteId = null; pintarMedio(); }; });

  $("#cmp-form").onsubmit = async (e) => {
    e.preventDefault();
    if (st.enviando) return;
    const escrito = desc.value.trim();
    const nombre = escrito.charAt(0).toUpperCase() + escrito.slice(1);
    const importe = Math.round(Number(imp.value) * 100) / 100;
    const ref = precioReferencia(nombre, refs(), calc.estado.insumos);
    const c = cantidadDe(importe, cant.value, uni.value, ref);
    if (!st.pendienteId) st.pendienteId = crypto.randomUUID();
    const compra = {
      id: st.pendienteId, fecha: fecha.value || st.hoy, categoria: cat, descripcion: nombre.slice(0, 120), importe,
      cantidad: c ? c.cantidad : null, unidad: c ? c.unidad : null, estimada: c ? c.estimada : false, medio: st.medio, creado_en: new Date().toISOString(),
    };
    const err = errorCompra(compra);
    if (err) { msg(err); (err.includes("categoría") ? $("#cmp-cats button") : err.includes("compraste") ? desc : err.includes("fecha") ? fecha : imp)?.focus(); return; }
    st.enviando = true; $("#cmp-guardar").disabled = true; $("#cmp-guardar").textContent = "Guardando…";
    try {
      // Primero se descuenta de la caja (mismo id que la compra: un reintento no la descuenta dos veces).
      // Si no hay caja abierta o no alcanza el efectivo, la compra se guarda igual y se avisa.
      let aviso = "";
      compra.en_caja = false;
      if (caja && compra.fecha === st.hoy) {
        try {
          await caja.registrarMovimiento({ id: compra.id, tipo: "compra_mercaderia", medio: compra.medio, importe: compra.importe,
            descripcion: (compra.categoria + ": " + compra.descripcion).slice(0, 120) });
          compra.en_caja = true;
        } catch (e3) {
          if (e3 instanceof SinRespuesta) throw e3;
          aviso = /No hay una caja abierta/.test(e3.message) ? " No había caja abierta: no se descontó de la caja." : " No se descontó de la caja: " + e3.message;
        }
      } else if (caja) aviso = " Es de otro día: no se descontó de la caja de hoy.";
      if (!compra.en_caja && /No había caja abierta|otro día/.test(aviso) && conCierre()) aviso = "";
      await backend.guardar(compra);
      if (compra.en_caja && pantallaCaja) pantallaCaja.recargar();
      st.pendienteId = null;
      guardarAjustes({ refs: actualizarRefs(refs(), compra) });
      desc.value = ""; imp.value = ""; cant.value = ""; fecha.value = hoyLocal(); $("#cmp-opc").open = false;
      st.medio = "efectivo"; pintarMedio();
      alEscribir();
      desc.focus();
      await cargar();
      const delDisp = !compra.en_caja && !aviso && conCierre();
      msg("Guardada: " + compra.descripcion + " " + fmtPesos(compra.importe) + (compra.en_caja ? ", descontada de la caja." :
        delDisp ? ", descontada del disponible (te quedan " + fmtPesos(quedaDisponible()) + " para compras)." : ".") + aviso, !aviso);
    } catch (e2) {
      msg(e2 instanceof SinRespuesta ? "No hubo respuesta. Revisá la conexión y tocá Guardar de nuevo (no se duplica)." : e2.message);
    } finally {
      st.enviando = false; $("#cmp-guardar").disabled = false; $("#cmp-guardar").textContent = "Guardar compra";
    }
  };
  $("#cmp-editar-cats").onclick = () => { st.editandoCats = !st.editandoCats; renderEditor(); if (st.editandoCats) $("#cmp-cat-nueva").focus(); };

  // ---------- Listas ----------
  const ddmm = (f) => f.slice(8) + "/" + f.slice(5, 7);
  const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const detalle = (c) => [c.descripcion, c.cantidad ? (c.estimada ? "≈ " : "") + fmtCantidad(c.cantidad, c.unidad) : "", c.en_caja ? (c.medio === "transferencia" ? "de la caja (transferencia)" : "de la caja") : ""].filter(Boolean).join(" · ");

  // Un renglón de compra con su ✕ (que pide confirmar antes de borrar).
  function renglon(c, primero) {
    const li = el("li");
    li.appendChild(el("span", "h", primero));
    const d = el("span", "d", c.categoria);
    d.appendChild(el("small", null, detalle(c)));
    li.append(d, el("span", "t num", fmtPesos(c.importe)));
    const acc = el("span", "acc");
    if (st.borrando === c.id) {
      const si = el("button", "btn danger chico", "Borrar"); si.type = "button";
      si.onclick = async () => {
        si.disabled = true;
        try {
          // Si se había descontado de la caja, se anula ese movimiento (solo se puede mientras esa caja siga abierta).
          let aviso = "";
          if (c.en_caja && caja) {
            try { await caja.anularMovimiento(c.id, "Compra borrada en la pestaña Compras"); if (pantallaCaja) pantallaCaja.recargar(); }
            catch (e2) { if (e2 instanceof SinRespuesta) throw e2; aviso = "La caja de esa compra ya está cerrada: ahí queda como estaba."; }
          }
          await backend.borrar(c.id); st.borrando = null;
          msg(aviso ? "Compra borrada. " + aviso : c.en_caja ? "Compra borrada y devuelta a la caja." : "Compra borrada.", !aviso);
          await cargar();
        }
        catch (e) { si.disabled = false; msg(e instanceof SinRespuesta ? "No se pudo borrar: revisá la conexión." : e.message); }
      };
      const no = el("button", "btn ghost chico", "Cancelar"); no.type = "button";
      no.onclick = () => { st.borrando = null; renderListas(); };
      acc.append(si, no);
    } else {
      const x = el("button", "x", "✕"); x.type = "button"; x.setAttribute("aria-label", "Borrar compra");
      x.onclick = () => { st.borrando = c.id; renderListas(); };
      acc.appendChild(x);
    }
    li.appendChild(acc);
    return li;
  }

  function renderListas() {
    const hoyBox = $("#cmp-hoy"), mesBox = $("#cmp-mes");
    hoyBox.textContent = ""; mesBox.textContent = "";
    if (st.error) { hoyBox.appendChild(el("p", "caja-msg-txt", st.error)); mesBox.hidden = true; return; }
    if (!st.cargado) { hoyBox.appendChild(el("p", "hint", "Cargando las compras…")); mesBox.hidden = true; return; }
    mesBox.hidden = false;

    // Hoy
    const d = new Date(st.hoy + "T12:00:00");
    const cab = el("div", "cmp-cab");
    cab.append(el("h2", "sec-t", "Hoy · " + DIAS[d.getDay()] + " " + d.getDate() + "/" + (d.getMonth() + 1)), el("b", "num cmp-tot", fmtPesos(resumen(st.deHoy).total)));
    hoyBox.appendChild(cab);
    if (!st.deHoy.length) hoyBox.appendChild(el("p", "hint", "Todavía no cargaste compras hoy."));
    else {
      const ul = el("ul", "cmp-lista");
      st.deHoy.forEach((c) => ul.appendChild(renglon(c, new Date(c.creado_en).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false }))));
      hoyBox.appendChild(ul);
    }

    // Mes
    const actual = st.hoy.slice(0, 7);
    const nav = el("div", "cmp-cab cmp-nav");
    const ant = el("button", "btn ghost chico", "‹"); ant.type = "button"; ant.setAttribute("aria-label", "Mes anterior");
    ant.onclick = () => { st.mes = mesCorrido(st.mes, -1); st.catAbierta = null; cargar(); };
    const sig = el("button", "btn ghost chico", "›"); sig.type = "button"; sig.setAttribute("aria-label", "Mes siguiente");
    sig.disabled = st.mes >= actual;
    sig.onclick = () => { st.mes = mesCorrido(st.mes, 1); st.catAbierta = null; cargar(); };
    const tit = nombreMes(st.mes);
    nav.append(ant, el("h2", "sec-t", tit.charAt(0).toUpperCase() + tit.slice(1) + " " + st.mes.slice(0, 4)), sig);
    mesBox.appendChild(nav);

    const r = resumen(st.delMes), ra = resumen(st.delAnterior);
    const mesAnt = mesCorrido(st.mes, -1);
    const kpis = el("div", "cmp-kpis");
    const k1 = el("div", "kpi hl");
    k1.append(el("span", "k", "Gastaste en compras"), el("span", "v num", fmtPesos(r.total)),
      el("span", "note", r.dias ? "en " + r.dias + (r.dias === 1 ? " día" : " días") : "sin compras cargadas"));
    const k2 = el("div", "kpi");
    k2.append(el("span", "k", nombreMes(mesAnt).charAt(0).toUpperCase() + nombreMes(mesAnt).slice(1) + (st.mes === actual ? " completo" : "")), el("span", "v num", fmtPesos(ra.total)),
      el("span", "note", ra.total ? "promedio " + fmtPesos(Math.round(ra.total / rangoMes(mesAnt).dias)) + " por día" : "sin compras cargadas"));
    kpis.append(k1, k2);
    mesBox.appendChild(kpis);

    if (!r.porCategoria.length) { mesBox.appendChild(el("p", "hint", "Cuando cargues compras, acá ves en qué se te fue la plata.")); return; }
    const max = r.porCategoria[0].total || 1;
    const barras = el("div", "cmp-barras");
    r.porCategoria.forEach((g) => {
      const b = el("button", "cmp-barra"); b.type = "button";
      b.setAttribute("aria-expanded", st.catAbierta === g.categoria ? "true" : "false");
      const barra = el("i"); barra.style.width = Math.max(2, (g.total / max) * 100) + "%";
      const caja = el("span", "bar"); caja.appendChild(barra);
      b.append(el("span", "c", g.categoria), caja, el("span", "num", fmtPesos(g.total)));
      b.onclick = () => { st.catAbierta = st.catAbierta === g.categoria ? null : g.categoria; renderListas(); };
      barras.appendChild(b);
      if (st.catAbierta === g.categoria) {
        const ul = el("ul", "cmp-lista cmp-lista-cat");
        g.compras.forEach((c) => ul.appendChild(renglon(c, ddmm(c.fecha))));
        barras.appendChild(ul);
      }
    });
    mesBox.appendChild(barras);
    mesBox.appendChild(el("p", "hint", "Tocá una categoría para ver todas sus compras del mes."));
  }

  // Al volver a la pestaña (por ejemplo al día siguiente), recargar.
  document.querySelector('nav.tabs button[data-tab="compras"]').addEventListener("click", () => {
    if (hoyLocal() !== st.hoy) { st.mes = hoyLocal().slice(0, 7); fecha.value = hoyLocal(); fecha.max = hoyLocal(); }
    cargar();
  });
  calc.alCambiar(() => { renderCats(); alEscribir(); });
  renderCats();
  renderListas();
  cargar();
}
