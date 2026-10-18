import { crearCostos, UNID, categoriaDe, ordenarCategorias } from "./costos.js";

// Lógica de la calculadora: insumos (con rendimiento y merma), productos, preparaciones, packaging,
// gastos fijos, delivery y precio sugerido.
// Recibe un "store" con subscribe(col, cb), set(col, id, body) y del(col, id).
export function iniciarCalculadora(s) {
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => "$ " + Math.round(n || 0).toLocaleString("es-AR");
  const fmt2 = (n) => "$ " + (n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const state = { insumos: {}, productos: {}, gastos: {}, ajustes: {}, sel: null, tab: "productos" };

  // ---------- Almacenamiento: db compartida si está, si no el navegador ----------
  let store = null;
  function setStatus(t) { $("#status").textContent = t; }
  let flashT;
  function flashSaved() {
    setStatus("Guardado ✓");
    clearTimeout(flashT);
    flashT = setTimeout(() => setStatus(statusText()), 1500);
  }
  function statusText() {
    return store && store.mode === "local"
      ? "Modo demo: los datos quedan solo en este navegador."
      : "Tus datos se guardan solos.";
  }
  const newId = () => Math.random().toString(36).slice(2, 10);
  // Cantidades en 0 o vacías dan costos falsos: se rechazan con un aviso en el mismo campo.
  const positivo = (v) => v !== "" && Number(v) > 0;
  function rechazar(inp, msg, valorAnterior) {
    if (valorAnterior !== undefined) inp.value = valorAnterior;
    inp.setCustomValidity(msg);
    inp.reportValidity();
    setStatus(msg);
    inp.addEventListener("input", () => inp.setCustomValidity(""), { once: true });
  }

  // ---------- Cálculos (en costos.js, compartidos con la caja) ----------
  const costos = crearCostos(state);
  const { rendimiento, merma, costoUso, itemInfo, costoProducto, unidadesDe, costoConOpcion, precioSugerido, margenReal,
    totalFijos, unidadesMes, fijoPorUnidad, delivery, naftaPorPedido, envioIncl } = costos;
  const alCambiar = []; // otras pestañas (la caja) que se redibujan cuando cambian los datos
  const porUnidadTxt = (p, total) => {
    const u = p.rindeUnidad || "g";
    if (!(p.rinde > 0)) return "Cargá cuánto rinde";
    return u === "u" ? fmt2(total / p.rinde) + " por unidad" : fmt2((total / p.rinde) * 100) + " cada 100 " + u;
  };
  // Sin gastos fijos el margen es "bruto" (solo insumos) y tiene que ser alto; con gastos fijos es ganancia neta.
  const clsMargen = (m) => (m == null ? "" : hayFijos() ? (m >= 20 ? "ok" : m >= 10 ? "mid" : "low") : (m >= 55 ? "ok" : m >= 40 ? "mid" : "low"));
  const hayFijos = () => fijoPorUnidad() > 0;
  const margenDefault = () => (hayFijos() ? 30 : 60);

  // ---------- Render ----------
  function render() {
    const anyEj = Object.values(state.insumos).some((i) => i.ejemplo) || Object.values(state.productos).some((p) => p.ejemplo);
    if ($("#ej-banner")) $("#ej-banner").hidden = !anyEj;
    renderLista();
    renderFicha();
    renderInsumos();
    renderGastos();
    renderDelivery();
    alCambiar.forEach((fn) => fn());
  }
  function prodsOrdenados() {
    return Object.entries(state.productos).sort((a, b) => (a[1].nombre || "").localeCompare(b[1].nombre || "", "es"));
  }
  function renderLista() {
    const el = $("#plist");
    el.textContent = "";
    const prods = prodsOrdenados();
    if (!prods.length) {
      el.innerHTML = '<div class="empty">Todavía no hay productos. Escribí el nombre abajo para crear el primero.</div>';
      return;
    }
    const ventas = prods.filter(([, p]) => !p.esPreparacion);
    const preps = prods.filter(([, p]) => p.esPreparacion);
    // Productos agrupados por categoría (Lomitos, Hamburguesas…). Si nadie puso categorías, la lista queda como siempre.
    const cats = ordenarCategorias(ventas.map(([, p]) => categoriaDe(p)));
    const conTitulos = cats.length > 1;
    const orden = cats.flatMap((c) => ventas.filter(([, p]) => categoriaDe(p) === c));
    if (!state.sel || !state.productos[state.sel]) state.sel = (orden[0] || prods[0])[0];
    const titulo = (txt, cls) => {
      const h = document.createElement("div");
      h.className = cls;
      h.textContent = txt;
      el.appendChild(h);
    };
    const dl = $("#newprod-cats");
    if (dl) {
      dl.textContent = "";
      ventas.map(([, p]) => (p.categoria || "").trim()).filter((c, i, a) => c && a.indexOf(c) === i).sort((a, b) => a.localeCompare(b, "es"))
        .forEach((c) => { const o = document.createElement("option"); o.value = c; dl.appendChild(o); });
    }
    let catActual = null;
    orden.concat(preps).forEach(([id, p], n) => {
      if (n < orden.length && conTitulos && categoriaDe(p) !== catActual) titulo((catActual = categoriaDe(p)), "grp");
      if (n === orden.length && preps.length) titulo("Preparaciones propias", "grp prep");
      const { total: tIns, faltas: fl } = costoProducto(p);
      const total = p.esPreparacion ? tIns : tIns + fijoPorUnidad() * unidadesDe(p);
      const pv = Number(p.precioVenta) || 0;
      const env = envioIncl(p);
      const m = margenReal(total, pv - env);
      const b = document.createElement("button");
      b.className = p.esPreparacion ? "pitem prep" : "pitem";
      b.setAttribute("aria-current", id === state.sel ? "true" : "false");
      b.innerHTML = '<span class="nm"></span><span class="det"></span>';
      b.querySelector(".nm").textContent = p.nombre || "(sin nombre)";
      if (p.ejemplo) b.querySelector(".nm").insertAdjacentHTML("beforeend", ' <span class="tag ej">ejemplo</span>');
      if (fl.length) b.querySelector(".nm").insertAdjacentHTML("beforeend", ' <span class="tag falta">costo incompleto</span>');
      const det = b.querySelector(".det");
      const fila = (k, v) => '<span class="fila"><span class="k">' + k + '</span><span class="num">' + v + "</span></span>";
      if (p.esPreparacion) det.innerHTML = fila("Costo:", porUnidadTxt(p, total));
      else if (pv) {
        const gan = pv - env - total;
        det.innerHTML = fila("Precio actual:", fmt(pv)) + (env ? fila("Envío incluido:", fmt(env)) : "") + fila("Costo:", fmt(total)) +
          '<span class="gan ' + clsMargen(m) + '"><span class="k">' + (gan >= 0 ? (hayFijos() ? "Ganancia neta" : "Ganancia") : "Pérdida") + '</span><span class="num">' + fmt(Math.abs(gan)) + "</span></span>" +
          '<span class="mg">Margen ' + Math.round(m) + "%" + (hayFijos() ? "" : " (sin gastos fijos)") + "</span>";
      } else det.innerHTML = fila("Costo:", fmt(total)) + fila("Sugerido:", fmt(precioSugerido(total, p.margen ?? margenDefault(), env)));
      b.onclick = () => { state.sel = id; render(); };
      el.appendChild(b);
    });
  }

  const ICON_BORRAR = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function renderFicha() {
    const el = $("#ficha");
    const p = state.productos[state.sel];
    if (!p) { el.innerHTML = ""; return; }
    const id = state.sel;
    const { total, packaging, filas, faltas } = costoProducto(p);
    const fijo = p.esPreparacion ? 0 : fijoPorUnidad() * unidadesDe(p);
    const costoTotal = total + fijo;
    const margen = p.margen ?? margenDefault();
    const env = envioIncl(p);
    const sug = precioSugerido(costoTotal, margen, env);
    const pv = Number(p.precioVenta) || 0;
    const ingreso = pv - env; // lo que queda para el producto, sin el envío
    const mr = margenReal(costoTotal, ingreso);
    const desglose = [fmt(total - packaging) + " de insumos"];
    if (packaging) desglose.push(fmt(packaging) + " de packaging");
    if (fijo) desglose.push(fmt(fijo) + " de gastos fijos" + (unidadesDe(p) > 1 ? " (cuenta como " + unidadesDe(p) + " productos)" : ""));

    el.innerHTML = `
      <div class="ficha sec">
        <h2 class="sec-t">Costos</h2>
        <div class="ficha-head">
          <input class="title" id="f-nombre" aria-label="Nombre del producto">
          ${p.esPreparacion ? '<span class="tag prep">Preparación propia</span>' : ""}
          <span class="ficha-acc">
            <button class="btn ghost" id="f-tipo" type="button">${p.esPreparacion ? "Pasar a producto de venta" : "Pasar a preparación propia"}</button>
            <button class="btn danger" id="f-del" type="button">${ICON_BORRAR}<span>Borrar producto</span></button>
          </span>
        </div>
        ${faltas.length ? `<div class="aviso-falta" role="alert"><b>Costo incompleto:</b> el costo da más bajo que el real porque falta cargar ${faltas.map((f) => "<span></span>").join(", ").replace(/, ([^,]*)$/, " y $1")}.</div>` : ""}
        ${p.esPreparacion ? `<div class="precio">
            <div class="kpi"><span class="k">Costo de la tanda</span><span class="v">${fmt(total)}</span></div>
            <div class="kpi hl"><span class="k">Costo de uso</span><span class="v" style="font-size:1.1rem">${porUnidadTxt(p, total)}</span><span class="note">Este valor se usa en los productos que la llevan</span></div>
          </div>` : ""}
        <div class="precio" ${p.esPreparacion ? "hidden" : ""}>
          <div class="kpi"><span class="k">Costo total</span><span class="v">${fmt(costoTotal)}</span><span class="note">${desglose.join(" + ")}${fijo ? "" : '. <button type="button" class="linkbtn" id="f-ir-gastos">Cargá tus gastos fijos</button>'}</span></div>
          <div class="kpi"><label class="k" for="f-margen">${fijo ? "Ganancia que querés" : "Margen que querés"}</label><span class="v"><input id="f-margen" class="n" type="number" min="0" max="95" step="1" style="width:4.5em"> %</span><span class="note">sobre el precio de venta</span></div>
          <div class="kpi hl"><span class="k">Precio sugerido</span><span class="v">${fmt(sug)}</span><span class="note">${env ? "incluye " + fmt(env) + " de envío, " : ""}redondeado a $100</span></div>
          <div class="kpi"><label class="k" for="f-pv">Precio al que vendés hoy</label><span class="v">$ <input id="f-pv" class="n" type="number" min="0" step="any"></span><span class="note">${mr == null ? "Cargalo para ver cuánto ganás" : (fijo ? "Ganancia neta " : "Margen real ") + '<b class="' + clsMargen(mr) + '">' + Math.round(mr) + "%</b> · " + (ingreso - costoTotal >= 0 ? "ganás " + fmt(ingreso - costoTotal) : "perdés " + fmt(costoTotal - ingreso)) + " por unidad" + (env ? ", sin contar el envío" : "")}</span></div>
          <div class="kpi"><label class="k" for="f-envio">Envío incluido en el precio</label><span class="v">$ <input id="f-envio" class="n" type="number" min="0" step="any"></span><span class="note">${env && pv ? "De " + fmt(pv) + ": " + fmt(ingreso) + " son del producto y " + fmt(env) + " pagan el delivery." : "Si el precio ya trae el envío adentro. Si cobrás el envío aparte, dejalo vacío."}</span></div>
        </div>
        <div class="ticket" ${p.esPreparacion ? "hidden" : ""}>${fijo
          ? `Fórmula: precio = costo total ÷ (1 − ganancia)${env ? " + envío" : ""}. Con ${margen}% de ganancia, de cada ${fmt(sug)} quedan ${fmt(sug - env - costoTotal)} de ganancia limpia, después de pagar insumos, packaging y gastos fijos${env ? " y separar el envío" : ""}.`
          : `Fórmula: precio = costo ÷ (1 − margen)${env ? " + envío" : ""}. Con ${margen}% de margen, de cada ${fmt(sug)} quedan ${fmt(sug - env - total)} para gastos fijos y ganancia.`}</div>
      </div>
      <div class="ficha sec">
        <h2 class="sec-t">Insumos</h2>
        ${p.esPreparacion ? `<div class="prep-row">
          <span>Rinde <input id="f-rinde" class="n" type="number" step="any" min="0" style="width:6em"> <select id="f-rinde-u"><option value="g">g</option><option value="ml">ml</option><option value="u">unidades</option></select> por tanda</span>
        </div>` : ""}
        <div>
          <h3>${p.esPreparacion ? "Receta (una tanda)" : "Receta (una porción)"}</h3>
          <div class="tbl-wrap"><table class="receta">
            <thead><tr><th>Insumo</th><th class="r">Cantidad</th><th></th><th class="r">Costo</th><th class="peso">Peso en el costo</th><th></th></tr></thead>
            <tbody id="f-items"></tbody>
            <tfoot>${packaging ? `<tr><td>Packaging</td><td></td><td></td><td class="r num">${fmt2(packaging)}</td><td class="peso"></td><td></td></tr>` : ""}<tr><td><b>${packaging ? "Total insumos y packaging" : "Total insumos"}</b></td><td></td><td></td><td class="r num"><b>${fmt2(total)}</b></td><td class="peso"></td><td></td></tr></tfoot>
          </table></div>
          <form class="addrow" id="f-add" style="margin-top:12px">
            <label class="f">Agregar insumo<select id="f-add-ins"></select></label>
            <label class="f">Cantidad <span id="f-add-u"></span><input id="f-add-cant" class="n" type="number" step="any" min="0.001" required></label>
            <button class="btn" type="submit">Agregar</button>
          </form>
        </div>
      </div>
      <div class="ficha sec" ${p.esPreparacion ? "hidden" : ""}>
        <h2 class="sec-t">En la caja</h2>
        <div class="caja-conf">
          <label class="f">Tipo<select id="f-ctipo"><option value="producto">Producto</option><option value="promo">Promo</option><option value="extra">Extra</option></select></label>
          <label class="f">Categoría (opcional)<input id="f-cat" list="f-cats" placeholder="Ej: Lomitos" maxlength="40"><datalist id="f-cats"></datalist></label>
          <label class="chk"><input type="checkbox" id="f-encaja"> <span>Mostrar en la caja</span></label>
        </div>
        <p class="hint">Para armar una promo, agregá en la receta los productos que lleva (por ejemplo 2 × Hamburguesa completa). Si van juntos en un envase más grande, marcá "sin su caja" y sumá el envase.</p>
        <h3>Opciones</h3>
        <p class="hint">Cambian un insumo por otro al vender, como pan árabe en vez de pan francés.</p>
        <div id="f-opciones" class="opciones"></div>
        <form class="addrow" id="f-addop">
          <label class="f">Nombre<input id="f-op-nombre" placeholder="Ej: Pan árabe" required maxlength="40"></label>
          <label class="f">Cambia<select id="f-op-de" required></select></label>
          <label class="f">Por<select id="f-op-por" required></select></label>
          <label class="f">Precio extra ($)<input id="f-op-precio" class="n" type="number" min="0" step="any" value="0"></label>
          <button class="btn" type="submit">Agregar opción</button>
        </form>
      </div>`;

    el.querySelectorAll(".aviso-falta span").forEach((sp, n) => { sp.textContent = faltas[n]; });
    const nombre = $("#f-nombre");
    nombre.value = p.nombre || "";
    nombre.onchange = () => saveProd(id, { nombre: nombre.value.trim() || p.nombre });
    $("#f-del").onclick = (ev) => {
      const b = ev.currentTarget;
      if (b.dataset.armed) { store.del("productos", id); state.sel = null; }
      else { b.dataset.armed = "1"; b.lastChild.textContent = "¿Seguro? Tocá de nuevo"; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.lastChild.textContent = "Borrar producto"; } }, 3000); }
    };

    const tb = $("#f-items");
    if (!filas.length) tb.innerHTML = '<tr><td colspan="6" class="empty">Sin insumos todavía. Agregalos abajo.</td></tr>';
    $("#f-tipo").onclick = () => saveProd(id, p.esPreparacion ? { esPreparacion: false } : { esPreparacion: true, rinde: p.rinde || 0, rindeUnidad: p.rindeUnidad || "g" });
    const ri = $("#f-rinde");
    if (ri) {
      ri.value = p.rinde || "";
      ri.onchange = () => saveProd(id, { rinde: Number(ri.value) || 0 });
      const ru = $("#f-rinde-u"); ru.value = p.rindeUnidad || "g";
      ru.onchange = () => saveProd(id, { rindeUnidad: ru.value });
    }

    filas.forEach(({ it, info, c }, idx) => {
      const tr = document.createElement("tr");
      const pct = total ? (c / total) * 100 : 0;
      tr.innerHTML = `<td></td><td class="r"><input class="n" type="number" step="any" min="0"></td><td class="u"></td><td class="r num"></td><td class="peso"><div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div></td><td><button class="btn ghost" type="button" aria-label="Quitar">✕</button></td>`;
      tr.cells[0].textContent = info.nombre;
      if (info.prep) tr.cells[0].insertAdjacentHTML("beforeend", ' <span class="tag">preparación</span>');
      if (info.packaging) tr.cells[0].insertAdjacentHTML("beforeend", ' <span class="tag">packaging</span>');
      if (info.producto) {
        tr.cells[0].insertAdjacentHTML("beforeend", ' <span class="tag">producto</span> <label class="sinpack"><input type="checkbox"> sin su caja</label>');
        const sp = tr.cells[0].querySelector(".sinpack input");
        sp.checked = !!it.sinPackaging;
        sp.onchange = () => { const items = (p.items || []).slice(); items[idx] = Object.assign({}, it, { sinPackaging: sp.checked }); saveProd(id, { items }); };
      }
      tr.cells[2].textContent = info.unidad;
      tr.cells[3].innerHTML = '<span></span><span class="peso"> ' + pct.toFixed(0) + "%</span>";
      tr.cells[3].firstChild.textContent = fmt2(c);
      const inp = tr.querySelector("input.n");
      inp.value = it.cantidad;
      inp.id = "f-cant-" + idx;
      inp.onchange = () => {
        if (!positivo(inp.value)) return rechazar(inp, "La cantidad tiene que ser mayor a 0. Para sacarlo de la receta usá la ✕.", it.cantidad);
        const items = (p.items || []).slice(); items[idx] = Object.assign({}, it, { cantidad: Number(inp.value) || 0 }); saveProd(id, { items }); };
      tr.querySelector("button").onclick = () => { const items = (p.items || []).slice(); items.splice(idx, 1); saveProd(id, { items }); };
      tb.appendChild(tr);
    });

    const sel = $("#f-add-ins");
    const ins = Object.entries(state.insumos).sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, "es"));
    sel.innerHTML = ins.length ? "" : '<option value="">Primero cargá insumos</option>';
    const g1 = document.createElement("optgroup"); g1.label = "Insumos";
    ins.forEach(([iid, i]) => { const o = document.createElement("option"); o.value = "i:" + iid; o.textContent = i.nombre; g1.appendChild(o); });
    if (ins.length) sel.appendChild(g1);
    const preps = prodsOrdenados().filter(([pid, x]) => x.esPreparacion && pid !== id);
    if (preps.length) {
      const g2 = document.createElement("optgroup"); g2.label = "Preparaciones propias";
      preps.forEach(([pid, x]) => { const o = document.createElement("option"); o.value = "p:" + pid; o.textContent = x.nombre; g2.appendChild(o); });
      sel.appendChild(g2);
    }
    const ventasSel = p.esPreparacion ? [] : prodsOrdenados().filter(([pid, x]) => !x.esPreparacion && pid !== id);
    if (ventasSel.length) {
      const g3 = document.createElement("optgroup"); g3.label = "Productos (para armar promos)";
      ventasSel.forEach(([pid, x]) => { const o = document.createElement("option"); o.value = "v:" + pid; o.textContent = x.nombre; g3.appendChild(o); });
      sel.appendChild(g3);
    }
    const selItem = () => { const [k, v] = sel.value.split(":"); return k === "p" ? { prep: v } : k === "i" ? { insumo: v } : k === "v" ? { producto: v } : null; };
    const updU = () => { const it = selItem(); const inf = it && itemInfo(it, 0); $("#f-add-u").textContent = inf && inf.unidad ? "(" + inf.unidad + ")" : ""; };
    sel.onchange = updU; updU();
    $("#f-add").onsubmit = (e) => {
      e.preventDefault();
      const it = selItem();
      if (!it) return;
      if (!positivo($("#f-add-cant").value)) return rechazar($("#f-add-cant"), "La cantidad tiene que ser mayor a 0.");
      const items = (p.items || []).concat([Object.assign(it, { cantidad: Number($("#f-add-cant").value) || 0 })]);
      saveProd(id, { items });
    };

    const ir = $("#f-ir-gastos"); if (ir) ir.onclick = () => $("#tab-gastos").click();
    const mg = $("#f-margen"); mg.value = margen;
    mg.onchange = () => saveProd(id, { margen: Number(mg.value) || 0 });
    const pvi = $("#f-pv"); pvi.value = pv || "";
    pvi.onchange = () => saveProd(id, { precioVenta: Number(pvi.value) || null });
    const evi = $("#f-envio"); evi.value = env || "";
    evi.onchange = () => saveProd(id, { envioIncluido: Number(evi.value) || 0 });
    if (!p.esPreparacion) renderEnCaja(id, p);
  }

  // ---------- Ficha: cómo aparece en la caja y sus opciones ----------
  function renderEnCaja(id, p) {
    const ct = $("#f-ctipo"); ct.value = p.tipo || "producto";
    ct.onchange = () => saveProd(id, { tipo: ct.value });
    const cat = $("#f-cat"); cat.value = p.categoria || "";
    cat.onchange = () => saveProd(id, { categoria: cat.value.trim() });
    const cats = [...new Set(Object.values(state.productos).map((x) => (x.categoria || "").trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "es"));
    const dl = $("#f-cats"); dl.textContent = "";
    cats.forEach((c) => { const o = document.createElement("option"); o.value = c; dl.appendChild(o); });
    const ec = $("#f-encaja"); ec.checked = p.enCaja !== false;
    ec.onchange = () => saveProd(id, { enCaja: ec.checked });

    const ops = p.opciones || [];
    const box = $("#f-opciones"); box.textContent = "";
    const nombreIns = (iid) => (state.insumos[iid] ? state.insumos[iid].nombre : "(insumo borrado)");
    const base = costoConOpcion(p, null).total;
    if (!ops.length) box.innerHTML = '<p class="empty">Sin opciones.</p>';
    ops.forEach((op, n) => {
      const row = document.createElement("div");
      row.className = "opcion";
      const dif = costoConOpcion(p, op.id).total - base;
      row.innerHTML = '<span class="nm"></span><span class="det"></span><button class="btn ghost" type="button" aria-label="Quitar opción">✕</button>';
      row.querySelector(".nm").textContent = op.nombre;
      row.querySelector(".det").textContent = nombreIns(op.reemplaza) + " → " + nombreIns(op.por) + " · costo " + (dif >= 0 ? "+ " : "− ") + fmt2(Math.abs(dif)) + " · precio + " + fmt(op.precioExtra);
      row.querySelector("button").onclick = () => { const o2 = ops.slice(); o2.splice(n, 1); saveProd(id, { opciones: o2 }); };
      box.appendChild(row);
    });
    // "Cambia": los insumos que la receta usa directo. "Por": cualquier insumo.
    const deSel = $("#f-op-de"), porSel = $("#f-op-por");
    const usados = [...new Set((p.items || []).filter((it) => it.insumo && state.insumos[it.insumo]).map((it) => it.insumo))];
    const llenar = (selEl, ids) => {
      selEl.textContent = "";
      ids.sort((a, b) => nombreIns(a).localeCompare(nombreIns(b), "es")).forEach((iid) => { const o = document.createElement("option"); o.value = iid; o.textContent = nombreIns(iid); selEl.appendChild(o); });
    };
    llenar(deSel, usados);
    llenar(porSel, Object.keys(state.insumos));
    $("#f-addop").onsubmit = (e) => {
      e.preventDefault();
      const nombre = $("#f-op-nombre").value.trim();
      if (!nombre || !deSel.value || !porSel.value) return;
      if (deSel.value === porSel.value) return rechazar(porSel, "Elegí un insumo distinto al que se cambia.");
      const precioExtra = Math.max(Number($("#f-op-precio").value) || 0, 0);
      saveProd(id, { opciones: ops.concat([{ id: newId(), nombre, reemplaza: deSel.value, por: porSel.value, precioExtra }]) });
    };
  }

  function saveProd(id, patch) {
    const body = Object.assign({}, state.productos[id], patch);
    state.productos[id] = body; // vista inmediata
    render();
    store.set("productos", id, body);
  }

  function renderInsumos() {
    const tb = $("#ins-body");
    tb.textContent = "";
    const ins = Object.entries(state.insumos).sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, "es"));
    if (!ins.length) { tb.innerHTML = '<tr><td colspan="10" class="empty">Todavía no cargaste insumos.</td></tr>'; return; }
    ins.forEach(([id, i]) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td><input class="nm" style="width:100%;min-width:140px"></td><td class="r"><input class="n cant" type="number" step="any" min="0"></td><td><select class="un"><option value="kg">kg</option><option value="l">litros</option><option value="u">unidades</option></select></td><td class="r"><input class="n pr" type="number" step="any" min="0"></td><td class="r"><input class="n pct rend" type="number" step="any" min="1" max="100"></td><td class="r"><input class="n pct mer" type="number" step="any" min="0" max="95"></td><td class="c"><input class="pk" type="checkbox"></td><td class="r num cu"></td><td class="upd" style="font-size:.8rem;color:var(--muted);white-space:nowrap"></td><td class="acc"><button class="btn ghost" type="button" aria-label="Borrar insumo">✕</button></td>`;
      const nm = tr.querySelector(".nm"), ca = tr.querySelector(".cant"), un = tr.querySelector(".un"), pr = tr.querySelector(".pr");
      const re = tr.querySelector(".rend"), me = tr.querySelector(".mer"), pk = tr.querySelector(".pk");
      nm.id = "ins-nm-" + id; ca.id = "ins-ca-" + id; un.id = "ins-un-" + id; pr.id = "ins-pr-" + id;
      re.id = "ins-re-" + id; me.id = "ins-me-" + id; pk.id = "ins-pk-" + id;
      re.setAttribute("aria-label", "Rendimiento %"); me.setAttribute("aria-label", "Merma %"); pk.setAttribute("aria-label", "Es packaging");
      nm.value = i.nombre; ca.value = i.cantidad; un.value = i.unidad; pr.value = i.precio;
      re.value = rendimiento(i); me.value = merma(i); pk.checked = !!i.packaging;
      const base = UNID[i.unidad].base;
      const cu = costoUso(i);
      tr.querySelector(".cu").textContent = base === "u" ? fmt2(cu) + " / u" : fmt2(cu * 100) + " / 100 " + base;
      const upd = tr.querySelector(".upd");
      upd.textContent = i.actualizado ? new Date(i.actualizado).toLocaleDateString("es-AR") : "—";
      if (i.ejemplo) upd.insertAdjacentHTML("beforeend", ' <span class="tag ej">ejemplo</span>');
      const save = () => {
        if (!positivo(ca.value)) return rechazar(ca, "La cantidad que comprás tiene que ser mayor a 0.", i.cantidad);
        if (pr.value === "" || Number(pr.value) < 0) return rechazar(pr, "Cargá el precio que pagás (puede ser 0 si no te cuesta nada).", i.precio);
        const body = { nombre: nm.value.trim() || i.nombre, cantidad: Number(ca.value) || 0, unidad: un.value, precio: Number(pr.value) || 0,
          rendimiento: Number(re.value) > 0 ? Math.min(Number(re.value), 100) : 100, merma: Math.max(Number(me.value) || 0, 0), packaging: pk.checked, actualizado: new Date().toISOString() };
        // un precio editado ya es dato real
        state.insumos[id] = body; render();
        store.set("insumos", id, body);
      };
      nm.onchange = save; ca.onchange = save; un.onchange = save; pr.onchange = save; re.onchange = save; me.onchange = save; pk.onchange = save;
      const del = tr.querySelector("button");
      del.onclick = () => {
        if (del.dataset.armed) store.del("insumos", id);
        else { del.dataset.armed = "1"; del.textContent = "¿Borrar?"; del.scrollIntoView({ block: "nearest", inline: "nearest" }); setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = "✕"; } }, 3000); }
      };
      tb.appendChild(tr);
    });
  }

  function renderGastos() {
    const tb = $("#gas-body");
    if (!tb) return;
    tb.textContent = "";
    const gs = Object.entries(state.gastos).sort((a, b) => (Number(b[1].monto) || 0) - (Number(a[1].monto) || 0));
    if (!gs.length) tb.innerHTML = '<tr><td colspan="3" class="empty">Todavía no cargaste gastos fijos.</td></tr>';
    gs.forEach(([id, g]) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td><input class="nm" style="width:100%;min-width:140px"></td><td class="r"><input class="n mo" type="number" step="any" min="0"></td><td class="acc"><button class="btn ghost" type="button" aria-label="Borrar gasto">✕</button></td>`;
      const nm = tr.querySelector(".nm"), mo = tr.querySelector(".mo");
      nm.id = "gas-nm-" + id; mo.id = "gas-mo-" + id;
      nm.value = g.nombre; mo.value = g.monto;
      const save = () => { const body = { nombre: nm.value.trim() || g.nombre, monto: Number(mo.value) || 0 }; state.gastos[id] = body; render(); store.set("gastos", id, body); };
      nm.onchange = save; mo.onchange = save;
      const del = tr.querySelector("button");
      del.onclick = () => {
        if (del.dataset.armed) store.del("gastos", id);
        else { del.dataset.armed = "1"; del.textContent = "¿Borrar?"; del.scrollIntoView({ block: "nearest", inline: "nearest" }); setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = "✕"; } }, 3000); }
      };
      tb.appendChild(tr);
    });
    const um = $("#gas-unidades");
    if (document.activeElement !== um) um.value = unidadesMes() || "";
    $("#gas-total").textContent = fmt(totalFijos());
    $("#gas-por-unidad").textContent = unidadesMes() ? fmt(fijoPorUnidad()) : "—";
    $("#gas-nota").textContent = unidadesMes() ? "Se suma igual al costo de cada producto que vendés, sea caro o barato." : "Cargá cuántos productos vendés por mes para repartir los gastos.";
  }

  function renderDelivery() {
    if (!$("#del-nafta")) return;
    const d = delivery();
    [["#del-nafta", "naftaMes"], ["#del-pedidos", "pedidosMes"], ["#del-cobro", "cobroEnvio"]].forEach(([sel, k]) => {
      if (document.activeElement !== $(sel)) $(sel).value = Number(d[k]) || "";
    });
    const npp = naftaPorPedido();
    const cobro = Number(d.cobroEnvio) || 0;
    $("#del-por-pedido").textContent = Number(d.pedidosMes) > 0 ? fmt(npp) : "—";
    const res = cobro - npp;
    const r = $("#del-resultado");
    r.textContent = Number(d.pedidosMes) > 0 ? (res >= 0 ? "+ " : "− ") + fmt(Math.abs(res)) : "—";
    r.className = "v num " + (Number(d.pedidosMes) > 0 ? (res >= 0 ? "ok" : "low") : "");
    $("#del-resultado-nota").textContent = Number(d.pedidosMes) > 0
      ? (res >= 0 ? "Te sobra por pedido" : "Te falta por pedido") + " · " + fmt(Math.abs(res) * Number(d.pedidosMes)) + " por mes" +
        (prodsOrdenados().some(([, p]) => envioIncl(p) > 0) ? ", sin contar el envío que ya viene en el precio" : "")
      : "Cargá la nafta y los pedidos para ver el resultado.";
    const conEnvio = prodsOrdenados().filter(([, p]) => envioIncl(p) > 0);
    $("#del-incluido").innerHTML = conEnvio.length
      ? "Productos con envío incluido en el precio: " + conEnvio.map(([, p]) => "<b></b> " + fmt(envioIncl(p))).join(", ") + ". Esa plata también paga la nafta."
      : "Ningún producto tiene envío incluido en el precio.";
    $("#del-incluido").querySelectorAll("b").forEach((b, n) => { b.textContent = conEnvio[n][1].nombre; });
  }

  // ---------- Formularios fijos ----------
  if ($("#newgas")) {
    $("#newgas").onsubmit = (e) => {
      e.preventDefault();
      const body = { nombre: $("#ng-nombre").value.trim(), monto: Number($("#ng-monto").value) || 0 };
      if (!body.nombre) return;
      const id = newId();
      state.gastos[id] = body;
      $("#ng-nombre").value = ""; $("#ng-monto").value = "";
      render();
      store.set("gastos", id, body);
    };
    document.querySelectorAll("#gas-sugeridos button").forEach((b) => {
      b.onclick = () => { $("#ng-nombre").value = b.textContent; $("#ng-monto").focus(); };
    });
    $("#gas-unidades").onchange = (e) => {
      const body = Object.assign({}, state.ajustes.general, { unidadesMes: Number(e.target.value) || 0 });
      state.ajustes = Object.assign({}, state.ajustes, { general: body });
      render();
      store.set("ajustes", "general", body);
    };
  }
  if ($("#del-nafta")) {
    [["#del-nafta", "naftaMes"], ["#del-pedidos", "pedidosMes"], ["#del-cobro", "cobroEnvio"]].forEach(([sel, k]) => {
      $(sel).onchange = (e) => {
        const body = Object.assign({}, delivery(), { [k]: Number(e.target.value) || 0 });
        state.ajustes = Object.assign({}, state.ajustes, { delivery: body });
        render();
        store.set("ajustes", "delivery", body);
      };
    });
  }
  $("#newprod").onsubmit = (e) => {
    e.preventDefault();
    const n = $("#newprod-name").value.trim();
    if (!n) return;
    const id = newId();
    state.productos[id] = $("#newprod-prep").checked
      ? { nombre: n, items: [], esPreparacion: true, rinde: 0, rindeUnidad: "g" }
      : { nombre: n, items: [], margen: margenDefault(), precioVenta: null };
    const cat = $("#newprod-cat").value.trim();
    if (cat && !state.productos[id].esPreparacion) state.productos[id].categoria = cat;
    state.sel = id;
    $("#newprod-name").value = "";
    $("#newprod-cat").value = "";
    $("#newprod-prep").checked = false;
    render();
    store.set("productos", id, state.productos[id]);
    // En el celular la ficha queda debajo del listado: llevar la vista al producto nuevo, donde está el botón de borrar
    if (matchMedia("(max-width: 760px)").matches) $("#ficha").scrollIntoView({ behavior: "smooth", block: "start" });
  };
  $("#newins").onsubmit = (e) => {
    e.preventDefault();
    const body = { nombre: $("#ni-nombre").value.trim(), cantidad: Number($("#ni-cant").value) || 0, unidad: $("#ni-unidad").value, precio: Number($("#ni-precio").value) || 0,
      rendimiento: Number($("#ni-rend").value) > 0 ? Math.min(Number($("#ni-rend").value), 100) : 100, merma: Math.max(Number($("#ni-merma").value) || 0, 0), packaging: $("#ni-pack").checked, actualizado: new Date().toISOString() };
    if (!body.nombre) return;
    if (!positivo($("#ni-cant").value)) return rechazar($("#ni-cant"), "La cantidad que comprás tiene que ser mayor a 0.");
    const id = newId();
    state.insumos[id] = body;
    $("#ni-nombre").value = ""; $("#ni-precio").value = ""; $("#ni-cant").value = "1"; $("#ni-rend").value = "100"; $("#ni-merma").value = "0"; $("#ni-pack").checked = false;
    render();
    store.set("insumos", id, body);
  };
  document.querySelectorAll("nav.tabs button").forEach((b) => {
    b.onclick = () => {
      state.tab = b.dataset.tab;
      document.querySelectorAll("nav.tabs button").forEach((x) => x.setAttribute("aria-selected", x === b ? "true" : "false"));
      document.querySelectorAll("[data-view]").forEach((v) => { v.hidden = v.dataset.view !== state.tab; });
      try { localStorage.setItem("costos-tab", state.tab); } catch (e) {}
    };
  });
  // Botón de modo claro / oscuro: se guarda la elección; sin elección sigue al sistema.
  const btnTema = $("#btn-tema");
  if (btnTema) {
    const oscuro = () => { const t = document.documentElement.dataset.theme; return t ? t === "dark" : matchMedia("(prefers-color-scheme: dark)").matches; };
    const pintar = () => { const o = oscuro(); btnTema.textContent = o ? "☀" : "☾"; btnTema.setAttribute("aria-label", o ? "Pasar a modo claro" : "Pasar a modo oscuro"); btnTema.title = btnTema.getAttribute("aria-label"); };
    btnTema.onclick = () => { const t = oscuro() ? "light" : "dark"; document.documentElement.dataset.theme = t; try { localStorage.setItem("costos-tema", t); } catch (e) {} pintar(); };
    pintar();
  }
  // Pestaña inicial: la que pide la dirección (la app instalada abre en ?tab=caja) o la última que usaste.
  try {
    const t = new URLSearchParams(location.search).get("tab") || localStorage.getItem("costos-tab");
    const b = /^[a-z]+$/.test(t || "") && document.querySelector('nav.tabs button[data-tab="' + t + '"]');
    if (b) b.click();
  } catch (e) {}

  // ---------- Arranque ----------
  store = s;
  store.onError = (msg) => setStatus(msg);
  store.onSaved = flashSaved;
  setStatus(statusText());
  render();
  store.subscribe("insumos", (m) => { state.insumos = m; render(); });
  store.subscribe("productos", (m) => { state.productos = m; render(); });
  store.subscribe("gastos", (m) => { state.gastos = m; render(); });
  store.subscribe("ajustes", (m) => { state.ajustes = m; render(); });
  // guardarAjuste: para que otras pestañas (Informes: pagos pendientes) guarden en "ajustes" con la misma conexión.
  const guardarAjuste = (id, body) => store.set("ajustes", id, body);
  return { estado: state, costos, alCambiar: (fn) => alCambiar.push(fn), guardarAjuste };
}
