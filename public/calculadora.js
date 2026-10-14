// Lógica de la calculadora: insumos, productos, preparaciones, gastos fijos y precio sugerido.
// Recibe un "store" con subscribe(col, cb), set(col, id, body) y del(col, id).
export function iniciarCalculadora(s) {
  const $ = (s) => document.querySelector(s);
  const fmt = (n) => "$ " + Math.round(n || 0).toLocaleString("es-AR");
  const fmt2 = (n) => "$ " + (n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const UNID = { kg: { base: "g", f: 1000 }, l: { base: "ml", f: 1000 }, u: { base: "u", f: 1 } };
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

  // ---------- Cálculos ----------
  function costoUso(ins) {
    // costo por g / ml / u
    if (!ins || !ins.cantidad || !ins.precio) return 0;
    return ins.precio / (ins.cantidad * UNID[ins.unidad || "u"].f);
  }
  // Un renglón de receta apunta a un insumo ({insumo}) o a una preparación propia ({prep}).
  function itemInfo(it, depth) {
    if (it.prep) {
      const pr = state.productos[it.prep];
      if (!pr) return { nombre: "(preparación borrada)", unidad: "", cu: 0 };
      const cu = pr.rinde > 0 && depth < 5 ? costoProducto(pr, depth + 1).total / pr.rinde : 0;
      return { nombre: pr.nombre, unidad: pr.rindeUnidad || "g", cu, prep: true };
    }
    const ins = state.insumos[it.insumo];
    if (!ins) return { nombre: "(insumo borrado)", unidad: "", cu: 0 };
    return { nombre: ins.nombre, unidad: UNID[ins.unidad].base, cu: costoUso(ins) };
  }
  function costoProducto(p, depth) {
    depth = depth || 0;
    let total = 0;
    const filas = (p.items || []).map((it) => {
      const info = itemInfo(it, depth);
      const c = info.cu * (Number(it.cantidad) || 0);
      total += c;
      return { it, info, c };
    });
    return { total, filas };
  }
  const porUnidadTxt = (p, total) => {
    const u = p.rindeUnidad || "g";
    if (!(p.rinde > 0)) return "Cargá cuánto rinde";
    return u === "u" ? fmt2(total / p.rinde) + " por unidad" : fmt2((total / p.rinde) * 100) + " cada 100 " + u;
  };
  function precioSugerido(costo, margen) {
    const m = Math.min(Math.max(Number(margen) || 0, 0), 95) / 100;
    const p = costo / (1 - m);
    return Math.ceil(p / 100) * 100; // redondeo a $100
  }
  const margenReal = (costo, precio) => (precio > 0 ? (1 - costo / precio) * 100 : null);
  // Sin gastos fijos el margen es "bruto" (solo insumos) y tiene que ser alto; con gastos fijos es ganancia neta.
  const clsMargen = (m) => (m == null ? "" : hayFijos() ? (m >= 20 ? "ok" : m >= 10 ? "mid" : "low") : (m >= 55 ? "ok" : m >= 40 ? "mid" : "low"));

  // ---------- Gastos fijos ----------
  // Se reparten en partes iguales entre todo lo que se vende en el mes.
  const totalFijos = () => Object.values(state.gastos).reduce((a, g) => a + (Number(g.monto) || 0), 0);
  const unidadesMes = () => Number((state.ajustes.general || {}).unidadesMes) || 0;
  const fijoPorUnidad = () => (unidadesMes() > 0 ? totalFijos() / unidadesMes() : 0);
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
    if (!state.sel || !state.productos[state.sel]) state.sel = (ventas[0] || prods[0])[0];
    ventas.concat(preps).forEach(([id, p], n) => {
      if (n === ventas.length && preps.length) {
        const h = document.createElement("div");
        h.className = "grp";
        h.textContent = "Preparaciones propias";
        el.appendChild(h);
      }
      const { total: tIns } = costoProducto(p);
      const total = p.esPreparacion ? tIns : tIns + fijoPorUnidad();
      const pv = Number(p.precioVenta) || 0;
      const m = margenReal(total, pv);
      const b = document.createElement("button");
      b.className = "pitem";
      b.setAttribute("aria-current", id === state.sel ? "true" : "false");
      b.innerHTML = '<span class="nm"></span><span class="det"></span>';
      b.querySelector(".nm").textContent = p.nombre || "(sin nombre)";
      if (p.ejemplo) b.querySelector(".nm").insertAdjacentHTML("beforeend", ' <span class="tag ej">ejemplo</span>');
      const det = b.querySelector(".det");
      const fila = (k, v) => '<span class="fila"><span class="k">' + k + '</span><span class="num">' + v + "</span></span>";
      if (p.esPreparacion) det.innerHTML = fila("Costo:", porUnidadTxt(p, total));
      else if (pv) {
        const gan = pv - total;
        det.innerHTML = fila("Precio actual:", fmt(pv)) + fila("Costo:", fmt(total)) +
          '<span class="gan ' + clsMargen(m) + '"><span class="k">' + (gan >= 0 ? (hayFijos() ? "Ganancia neta" : "Ganancia") : "Pérdida") + '</span><span class="num">' + fmt(Math.abs(gan)) + "</span></span>" +
          '<span class="mg">Margen ' + Math.round(m) + "%" + (hayFijos() ? "" : " (sin gastos fijos)") + "</span>";
      } else det.innerHTML = fila("Costo:", fmt(total)) + fila("Sugerido:", fmt(precioSugerido(total, p.margen ?? margenDefault())));
      b.onclick = () => { state.sel = id; render(); };
      el.appendChild(b);
    });
  }

  function renderFicha() {
    const el = $("#ficha");
    const p = state.productos[state.sel];
    if (!p) { el.innerHTML = ""; return; }
    const id = state.sel;
    const { total, filas } = costoProducto(p);
    const fijo = fijoPorUnidad();
    const costoTotal = total + fijo;
    const margen = p.margen ?? margenDefault();
    const sug = precioSugerido(costoTotal, margen);
    const pv = Number(p.precioVenta) || 0;
    const mr = margenReal(costoTotal, pv);

    el.innerHTML = `
      <div class="ficha sec">
        <h2 class="sec-t">Costos</h2>
        <div class="ficha-head">
          <input class="title" id="f-nombre" aria-label="Nombre del producto">
          <button class="btn ghost" id="f-del" type="button">Borrar producto</button>
        </div>
        <div class="prep-row">
          <label class="chk"><input type="checkbox" id="f-esprep"> <span>Es una preparación propia (se usa en otros productos, como la mayonesa casera)</span></label>
          <span id="f-rinde-wrap" ${p.esPreparacion ? "" : "hidden"}>Rinde <input id="f-rinde" class="n" type="number" step="any" min="0" style="width:6em"> <select id="f-rinde-u"><option value="g">g</option><option value="ml">ml</option><option value="u">unidades</option></select></span>
        </div>
        ${p.esPreparacion ? `<div class="precio">
            <div class="kpi"><span class="k">Costo de la tanda</span><span class="v">${fmt(total)}</span></div>
            <div class="kpi hl"><span class="k">Costo de uso</span><span class="v" style="font-size:1.1rem">${porUnidadTxt(p, total)}</span><span class="note">Este valor se usa en los productos que la llevan</span></div>
          </div>` : ""}
        <div class="precio" ${p.esPreparacion ? "hidden" : ""}>
          <div class="kpi"><span class="k">Costo total</span><span class="v">${fmt(costoTotal)}</span><span class="note">${fijo ? fmt(total) + " de insumos + " + fmt(fijo) + " de gastos fijos" : 'Solo insumos. <button type="button" class="linkbtn" id="f-ir-gastos">Cargá tus gastos fijos</button>'}</span></div>
          <div class="kpi"><label class="k" for="f-margen">${fijo ? "Ganancia que querés" : "Margen que querés"}</label><span class="v"><input id="f-margen" class="n" type="number" min="0" max="95" step="1" style="width:4.5em"> %</span><span class="note">sobre el precio de venta</span></div>
          <div class="kpi hl"><span class="k">Precio sugerido</span><span class="v">${fmt(sug)}</span><span class="note">redondeado a $100</span></div>
          <div class="kpi"><label class="k" for="f-pv">Precio al que vendés hoy</label><span class="v">$ <input id="f-pv" class="n" type="number" min="0" step="any"></span><span class="note">${mr == null ? "Cargalo para ver cuánto ganás" : (fijo ? "Ganancia neta " : "Margen real ") + '<b class="' + clsMargen(mr) + '">' + Math.round(mr) + "%</b> · " + (pv - costoTotal >= 0 ? "ganás " + fmt(pv - costoTotal) : "perdés " + fmt(costoTotal - pv)) + " por unidad"}</span></div>
        </div>
        <div class="ticket" ${p.esPreparacion ? "hidden" : ""}>${fijo
          ? `Fórmula: precio = costo total ÷ (1 − ganancia). Con ${margen}% de ganancia, de cada ${fmt(sug)} quedan ${fmt(sug - costoTotal)} de ganancia limpia, después de pagar insumos y gastos fijos.`
          : `Fórmula: precio = costo ÷ (1 − margen). Con ${margen}% de margen, de cada ${fmt(sug)} quedan ${fmt(sug - total)} para gastos fijos y ganancia.`}</div>
      </div>
      <div class="ficha sec">
        <h2 class="sec-t">Insumos</h2>
        <div>
          <h3>${p.esPreparacion ? "Receta (una tanda)" : "Receta (una porción)"}</h3>
          <div class="tbl-wrap"><table class="receta">
            <thead><tr><th>Insumo</th><th class="r">Cantidad</th><th></th><th class="r">Costo</th><th class="peso">Peso en el costo</th><th></th></tr></thead>
            <tbody id="f-items"></tbody>
            <tfoot><tr><td><b>Total insumos</b></td><td></td><td></td><td class="r num"><b>${fmt2(total)}</b></td><td class="peso"></td><td></td></tr></tfoot>
          </table></div>
          <form class="addrow" id="f-add" style="margin-top:12px">
            <label class="f">Agregar insumo<select id="f-add-ins"></select></label>
            <label class="f">Cantidad <span id="f-add-u"></span><input id="f-add-cant" class="n" type="number" step="any" min="0" required></label>
            <button class="btn" type="submit">Agregar</button>
          </form>
        </div>
      </div>`;

    const nombre = $("#f-nombre");
    nombre.value = p.nombre || "";
    nombre.onchange = () => saveProd(id, { nombre: nombre.value.trim() || p.nombre });
    $("#f-del").onclick = (ev) => {
      const b = ev.currentTarget;
      if (b.dataset.armed) { store.del("productos", id); state.sel = null; }
      else { b.dataset.armed = "1"; b.textContent = "¿Seguro? Tocá de nuevo"; setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = "Borrar producto"; } }, 3000); }
    };

    const tb = $("#f-items");
    if (!filas.length) tb.innerHTML = '<tr><td colspan="6" class="empty">Sin insumos todavía. Agregalos abajo.</td></tr>';
    const ep = $("#f-esprep"); ep.checked = !!p.esPreparacion;
    ep.onchange = () => saveProd(id, ep.checked ? { esPreparacion: true, rinde: p.rinde || 0, rindeUnidad: p.rindeUnidad || "g" } : { esPreparacion: false });
    const ri = $("#f-rinde"); ri.value = p.rinde || "";
    ri.onchange = () => saveProd(id, { rinde: Number(ri.value) || 0 });
    const ru = $("#f-rinde-u"); ru.value = p.rindeUnidad || "g";
    ru.onchange = () => saveProd(id, { rindeUnidad: ru.value });

    filas.forEach(({ it, info, c }, idx) => {
      const tr = document.createElement("tr");
      const pct = total ? (c / total) * 100 : 0;
      tr.innerHTML = `<td></td><td class="r"><input class="n" type="number" step="any" min="0"></td><td class="u"></td><td class="r num"></td><td class="peso"><div class="bar"><i style="width:${pct.toFixed(1)}%"></i></div></td><td><button class="btn ghost" type="button" aria-label="Quitar">✕</button></td>`;
      tr.cells[0].textContent = info.nombre;
      if (info.prep) tr.cells[0].insertAdjacentHTML("beforeend", ' <span class="tag">preparación</span>');
      tr.cells[2].textContent = info.unidad;
      tr.cells[3].innerHTML = '<span></span><span class="peso"> ' + pct.toFixed(0) + "%</span>";
      tr.cells[3].firstChild.textContent = fmt2(c);
      const inp = tr.querySelector("input");
      inp.value = it.cantidad;
      inp.id = "f-cant-" + idx;
      inp.onchange = () => { const items = (p.items || []).slice(); items[idx] = Object.assign({}, it, { cantidad: Number(inp.value) || 0 }); saveProd(id, { items }); };
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
    const selItem = () => { const [k, v] = sel.value.split(":"); return k === "p" ? { prep: v } : k === "i" ? { insumo: v } : null; };
    const updU = () => { const it = selItem(); const inf = it && itemInfo(it, 0); $("#f-add-u").textContent = inf && inf.unidad ? "(" + inf.unidad + ")" : ""; };
    sel.onchange = updU; updU();
    $("#f-add").onsubmit = (e) => {
      e.preventDefault();
      const it = selItem();
      if (!it) return;
      const items = (p.items || []).concat([Object.assign(it, { cantidad: Number($("#f-add-cant").value) || 0 })]);
      saveProd(id, { items });
    };

    const ir = $("#f-ir-gastos"); if (ir) ir.onclick = () => $("#tab-gastos").click();
    const mg = $("#f-margen"); mg.value = margen;
    mg.onchange = () => saveProd(id, { margen: Number(mg.value) || 0 });
    const pvi = $("#f-pv"); pvi.value = pv || "";
    pvi.onchange = () => saveProd(id, { precioVenta: Number(pvi.value) || null });
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
    if (!ins.length) { tb.innerHTML = '<tr><td colspan="7" class="empty">Todavía no cargaste insumos.</td></tr>'; return; }
    ins.forEach(([id, i]) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td><input class="nm" style="width:100%;min-width:140px"></td><td class="r"><input class="n cant" type="number" step="any" min="0"></td><td><select class="un"><option value="kg">kg</option><option value="l">litros</option><option value="u">unidades</option></select></td><td class="r"><input class="n pr" type="number" step="any" min="0"></td><td class="r num cu"></td><td class="upd" style="font-size:.8rem;color:var(--muted);white-space:nowrap"></td><td><button class="btn ghost" type="button" aria-label="Borrar insumo">✕</button></td>`;
      const nm = tr.querySelector(".nm"), ca = tr.querySelector(".cant"), un = tr.querySelector(".un"), pr = tr.querySelector(".pr");
      nm.id = "ins-nm-" + id; ca.id = "ins-ca-" + id; un.id = "ins-un-" + id; pr.id = "ins-pr-" + id;
      nm.value = i.nombre; ca.value = i.cantidad; un.value = i.unidad; pr.value = i.precio;
      const base = UNID[i.unidad].base;
      const cu = costoUso(i);
      tr.querySelector(".cu").textContent = base === "u" ? fmt2(cu) + " / u" : fmt2(cu * 100) + " / 100 " + base;
      const upd = tr.querySelector(".upd");
      upd.textContent = i.actualizado ? new Date(i.actualizado).toLocaleDateString("es-AR") : "—";
      if (i.ejemplo) upd.insertAdjacentHTML("beforeend", ' <span class="tag ej">ejemplo</span>');
      const save = () => {
        const body = { nombre: nm.value.trim() || i.nombre, cantidad: Number(ca.value) || 0, unidad: un.value, precio: Number(pr.value) || 0, actualizado: new Date().toISOString() };
        // un precio editado ya es dato real
        state.insumos[id] = body; render();
        store.set("insumos", id, body);
      };
      nm.onchange = save; ca.onchange = save; un.onchange = save; pr.onchange = save;
      const del = tr.querySelector("button");
      del.onclick = () => {
        if (del.dataset.armed) store.del("insumos", id);
        else { del.dataset.armed = "1"; del.textContent = "¿Borrar?"; setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = "✕"; } }, 3000); }
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
      tr.innerHTML = `<td><input class="nm" style="width:100%;min-width:140px"></td><td class="r"><input class="n mo" type="number" step="any" min="0"></td><td><button class="btn ghost" type="button" aria-label="Borrar gasto">✕</button></td>`;
      const nm = tr.querySelector(".nm"), mo = tr.querySelector(".mo");
      nm.id = "gas-nm-" + id; mo.id = "gas-mo-" + id;
      nm.value = g.nombre; mo.value = g.monto;
      const save = () => { const body = { nombre: nm.value.trim() || g.nombre, monto: Number(mo.value) || 0 }; state.gastos[id] = body; render(); store.set("gastos", id, body); };
      nm.onchange = save; mo.onchange = save;
      const del = tr.querySelector("button");
      del.onclick = () => {
        if (del.dataset.armed) store.del("gastos", id);
        else { del.dataset.armed = "1"; del.textContent = "¿Borrar?"; setTimeout(() => { if (del.isConnected) { delete del.dataset.armed; del.textContent = "✕"; } }, 3000); }
      };
      tb.appendChild(tr);
    });
    const um = $("#gas-unidades");
    if (document.activeElement !== um) um.value = unidadesMes() || "";
    $("#gas-total").textContent = fmt(totalFijos());
    $("#gas-por-unidad").textContent = unidadesMes() ? fmt(fijoPorUnidad()) : "—";
    $("#gas-nota").textContent = unidadesMes() ? "Esto se suma al costo de cada producto que vendés." : "Cargá cuántos productos vendés por mes para repartir los gastos.";
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
  $("#newprod").onsubmit = (e) => {
    e.preventDefault();
    const n = $("#newprod-name").value.trim();
    if (!n) return;
    const id = newId();
    state.productos[id] = { nombre: n, items: [], margen: margenDefault(), precioVenta: null };
    state.sel = id;
    $("#newprod-name").value = "";
    render();
    store.set("productos", id, state.productos[id]);
  };
  $("#newins").onsubmit = (e) => {
    e.preventDefault();
    const body = { nombre: $("#ni-nombre").value.trim(), cantidad: Number($("#ni-cant").value) || 0, unidad: $("#ni-unidad").value, precio: Number($("#ni-precio").value) || 0, actualizado: new Date().toISOString() };
    if (!body.nombre) return;
    const id = newId();
    state.insumos[id] = body;
    $("#ni-nombre").value = ""; $("#ni-precio").value = ""; $("#ni-cant").value = "1";
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
  try { const t = localStorage.getItem("costos-tab"); const b = t && document.querySelector('nav.tabs button[data-tab="' + t + '"]'); if (b) b.click(); } catch (e) {}

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
}
