// Mi negocio > Menú de pedidos: lo que el menú online de los clientes toma de la calculadora.
// Se guarda en ajustes id "menu". Lo que se publica lo decide la base (menu_publico en supabase/menu.sql):
// datos de este formulario y, de cada producto marcado "Mostrar en el menú", nombre, precio, foto y opciones.
import { conCantidad } from "./plural.js";

const PAGOS = [["efectivo", "Efectivo"], ["transferencia", "Transferencia"], ["dividido", "Dividido (parte efectivo y parte transferencia)"]];
const DIAS = [[1, "Lun"], [2, "Mar"], [3, "Mié"], [4, "Jue"], [5, "Vie"], [6, "Sáb"], [0, "Dom"]];
const fmt = (n) => "$ " + Math.round(Number(n) || 0).toLocaleString("es-AR");
export const slugDe = (t) => String(t || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

// Productos que el menú va a mostrar (la misma regla que menu_vendible en la base).
export function productosDelMenu(productos) {
  return Object.entries(productos || {})
    .filter(([, p]) => p.enMenu && !p.esPreparacion && String(p.nombre || "").trim() && Number(p.precioVenta) > 0)
    .sort((a, b) => a[1].nombre.localeCompare(b[1].nombre, "es"));
}

// verPublico(slug) → lo que recibe el menú (con cuenta; null en el modo demo).
export function iniciarMenuNegocio(calc, nombreNegocio, verPublico) {
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  // sucio: hay cambios escritos sin guardar; mientras tanto el formulario no se vuelve a dibujar.
  const st = { msg: null, publico: null, cargando: false, sucio: false };
  const aviso = (ok, texto) => {
    const m = $("#mn-msg");
    m.className = "caja-msg " + (ok ? "ok" : "mal"); m.textContent = texto; m.hidden = false;
    m.setAttribute("role", ok ? "status" : "alert");
  };
  const menu = () => (calc.estado.ajustes || {}).menu || {};

  function leerForm() {
    const v = (s) => $(s).value.trim();
    return {
      publicado: $("#mn-publicado").checked,
      slug: slugDe(v("#mn-slug")),
      url: v("#mn-url"),
      whatsapp: v("#mn-wa").replace(/[^\d+]/g, ""),
      alias: v("#mn-alias"),
      pagos: PAGOS.map(([k]) => k).filter((k) => $("#mn-pago-" + k).checked),
      envio: v("#mn-envio") === "" ? null : Math.max(Number(v("#mn-envio")) || 0, 0),
      horarios: { dias: DIAS.map(([d]) => d).filter((d) => $("#mn-dia-" + d).checked), desde: v("#mn-desde"), hasta: v("#mn-hasta") },
      aviso: v("#mn-aviso"),
    };
  }

  async function guardar(e) {
    e.preventDefault();
    const m = leerForm();
    const falta = [];
    if (!m.slug) falta.push("la dirección del menú");
    if (m.whatsapp.replace(/\D/g, "").length < 10) falta.push("el WhatsApp con código de país (ej: 5493855702807)");
    if (!m.pagos.length) falta.push("al menos un medio de pago");
    if (m.publicado && falta.length) { aviso(false, "Para publicar falta " + falta.join(", ") + "."); return; }
    const ok = await calc.guardarAjuste("menu", Object.assign({}, menu(), m));
    if (ok === false) { aviso(false, "No se pudo guardar. Si la dirección del menú ya la usa otro negocio, elegí otra."); return; }
    st.sucio = false;
    st.msg = { ok: true, texto: m.publicado ? "Guardado. El menú ya muestra estos datos." : "Guardado. El menú no está publicado." };
    render();
  }

  async function probar() {
    st.cargando = true; st.publico = null; render();
    try {
      const r = await verPublico(menu().slug);
      st.publico = r ? { ok: true, r } : { ok: false, texto: "El menú no está publicado (o la cuenta no está activa)." };
    } catch (e) {
      st.publico = { ok: false, texto: "No se pudo leer el menú: " + (e.message || "sin conexión") + ". ¿Corriste supabase/menu.sql?" };
    }
    st.cargando = false; render();
  }

  function render() {
    const box = $("#menu-pedidos");
    if (!box) return;
    const m = menu();
    if (st.sucio && !st.cargando && !st.publico) return; // no pisar lo que se está escribiendo
    const delivery = (calc.estado.ajustes || {}).delivery || {};
    const h = m.horarios || {};
    const dias = Array.isArray(h.dias) ? h.dias : [];
    box.innerHTML = `
      <h3>Menú de pedidos</h3>
      <p class="hint">Tus clientes eligen en el menú online y te mandan el pedido armado por WhatsApp. Los precios salen de esta app: cambiás un precio acá y el menú lo muestra en el próximo pedido. Nunca se publican costos, recetas ni márgenes.</p>
      <form id="mn-form" class="neg-form menu-form">
        <label class="chk"><input type="checkbox" id="mn-publicado"> <span><b>Menú publicado</b> (los clientes lo pueden ver)</span></label>
        <label class="f">Dirección del menú (la usa la página de pedidos)<input id="mn-slug" maxlength="40" placeholder="ej: venutto" autocapitalize="none"></label>
        <label class="f">Link para compartir<input id="mn-url" type="url" maxlength="200" placeholder="https://…/pedir.html"></label>
        <label class="f">WhatsApp donde llegan los pedidos (con código de país)<input id="mn-wa" inputmode="tel" maxlength="20" placeholder="5493855702807"></label>
        <label class="f">Alias para transferencias<input id="mn-alias" maxlength="60" autocapitalize="none"></label>
        <fieldset class="f mn-grupo"><legend>Medios de pago que aceptás</legend>
          ${PAGOS.map(([k, t]) => `<label class="chk"><input type="checkbox" id="mn-pago-${k}"> <span>${t}</span></label>`).join("")}
        </fieldset>
        <label class="f">Envío con delivery ($)<input id="mn-envio" class="n" type="number" min="0" step="1" inputmode="numeric"></label>
        <p class="hint">Se suma al total del pedido. Vacío: el menú avisa que el envío se confirma por WhatsApp.</p>
        <fieldset class="f mn-grupo"><legend>Días y horario de atención</legend>
          <div class="mn-dias">${DIAS.map(([d, t]) => `<label class="chk"><input type="checkbox" id="mn-dia-${d}"> <span>${t}</span></label>`).join("")}</div>
          <div class="mn-horas"><label class="f">Desde<input id="mn-desde" type="time"></label><label class="f">Hasta<input id="mn-hasta" type="time"></label></div>
        </fieldset>
        <label class="f">Aviso en el menú (opcional)<input id="mn-aviso" maxlength="140" placeholder="Ej: Desde enero abrimos todos los días"></label>
        <button class="btn primary" type="submit">Guardar menú</button>
        <p id="mn-msg" hidden></p>
      </form>`;
    $("#mn-publicado").checked = !!m.publicado;
    $("#mn-slug").value = m.slug || slugDe(nombreNegocio());
    $("#mn-url").value = m.url || "";
    $("#mn-wa").value = m.whatsapp || "";
    $("#mn-alias").value = m.alias || "";
    PAGOS.forEach(([k]) => { $("#mn-pago-" + k).checked = (m.pagos || []).includes(k); });
    $("#mn-envio").value = m.envio == null ? "" : m.envio;
    $("#mn-envio").placeholder = delivery.cobroEnvio ? String(delivery.cobroEnvio) : "";
    DIAS.forEach(([d]) => { $("#mn-dia-" + d).checked = dias.includes(d); });
    $("#mn-desde").value = h.desde || ""; $("#mn-hasta").value = h.hasta || "";
    $("#mn-aviso").value = m.aviso || "";
    $("#mn-form").onsubmit = guardar;
    $("#mn-form").oninput = () => { st.sucio = true; };
    if (st.msg) { aviso(st.msg.ok, st.msg.texto); st.msg = null; }

    // Qué productos van al menú
    const prods = productosDelMenu(calc.estado.productos);
    const sinPrecio = Object.values(calc.estado.productos || {}).filter((p) => p.enMenu && !p.esPreparacion && !(Number(p.precioVenta) > 0));
    box.appendChild(el("h3", null, "Productos en el menú (" + prods.length + ")"));
    if (!prods.length) box.appendChild(el("p", "hint", 'Todavía ninguno. En Productos, abrí cada uno y marcá "Mostrar en el menú".'));
    else {
      const ul = el("ul", "mn-lista");
      prods.forEach(([, p]) => {
        const li = el("li");
        li.append(el("span", null, p.nombre + (p.agotado ? " (agotado)" : "") + (p.foto ? "" : " · sin foto")), el("span", "num", fmt(p.precioVenta)));
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }
    if (sinPrecio.length) box.appendChild(el("p", "caja-msg mal", "No se muestran porque no tienen precio de venta: " + sinPrecio.map((p) => p.nombre).join(", ") + "."));

    // Comprobar lo que realmente recibe el menú (desde la base, sin login)
    if (verPublico) {
      const b = el("button", "btn", st.cargando ? "Leyendo…" : "Ver lo que recibe el menú");
      b.type = "button"; b.id = "mn-probar"; b.disabled = st.cargando || !m.slug; b.onclick = probar;
      box.appendChild(b);
      if (st.publico && !st.publico.ok) box.appendChild(el("p", "caja-msg mal", st.publico.texto));
      if (st.publico && st.publico.ok) {
        const r = st.publico.r;
        box.appendChild(el("p", "caja-msg ok", "El menú recibe " + r.productos.length + " productos, sin costos ni márgenes. Ejemplo: " +
          (r.productos[0] ? conCantidad(2, r.productos[0].nombre, r.productos[0].plural) + " = " + fmt(r.productos[0].precio * 2) : "—") + "."));
        const det = el("details", "cuentas"); det.appendChild(el("summary", null, "Ver los datos exactos"));
        det.appendChild(el("pre", "mn-json", JSON.stringify(r, null, 2)));
        box.appendChild(det);
      }
      st.publico = st.publico && st.publico.ok ? st.publico : null;
    }
  }

  calc.alCambiar(render);
  render();
}
