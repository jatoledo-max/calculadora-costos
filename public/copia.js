// Mi negocio > Copia de seguridad: descargar todo el negocio en un archivo y volver a cargarlo.
// Las reglas de qué se restaura las pone la base (restaurar_copia en caja.sql): nunca se pisa nada,
// del catálogo se agrega lo que falta y la caja solo se restaura si todavía no hay ninguna caja.
import { SinRespuesta } from "./stores.js";

const CLAVE_ULTIMA = "copia-ultima";

// Cuántas cosas trae una copia (sirve para la de Supabase y para la del modo demo).
export function contarCopia(c) {
  const n = (x) => (Array.isArray(x) ? x.length : 0);
  const caja = c.demo_caja || c;
  return { productos: n(c.productos), insumos: n(c.insumos), gastos: n(c.gastos), cajas: n(caja.cajas), ventas: n(caja.ventas), movimientos: n(caja.movimientos) };
}
const fechaHora = (iso) => new Date(iso).toLocaleString("es-AR", { day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
const plural = (n, uno, varios) => n + " " + (n === 1 ? uno : varios);
export function describirCopia(c) {
  const k = contarCopia(c);
  return [plural(k.productos, "producto", "productos"), plural(k.insumos, "insumo", "insumos"), plural(k.gastos, "gasto fijo", "gastos fijos"),
    plural(k.cajas, "caja", "cajas"), plural(k.ventas, "venta", "ventas"), plural(k.movimientos, "gasto o retiro de caja", "gastos o retiros de caja")].join(", ");
}

export function iniciarCopias(backend, nombreNegocio) {
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const boton = (cls, txt, fn) => { const b = el("button", cls, txt); b.type = "button"; b.onclick = fn; return b; };
  const st = { bajando: false, msg: null, archivo: null, copia: null, restaurando: false, hecho: null };

  async function descargar() {
    if (st.bajando) return;
    st.bajando = true; st.msg = null; render();
    try {
      const c = await backend.copia();
      const hoy = new Date().toISOString().slice(0, 10);
      const nombre = "copia-" + (nombreNegocio() || "negocio").toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") + "-" + hoy + ".json";
      const url = URL.createObjectURL(new Blob([JSON.stringify(c)], { type: "application/json" }));
      const a = el("a"); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      try { localStorage.setItem(CLAVE_ULTIMA, new Date().toISOString()); } catch (e) {}
      st.msg = { ok: true, texto: "Copia descargada: " + describirCopia(c) + ". Guardala fuera del celular (Drive o mail)." };
    } catch (e) {
      st.msg = { ok: false, texto: e instanceof SinRespuesta ? "Sin conexión: no se pudo armar la copia." : "No se pudo armar la copia (" + e.message + ")." };
    }
    st.bajando = false; render();
  }

  async function elegir(f) {
    st.copia = null; st.hecho = null; st.msg = null;
    if (!f) { render(); return; }
    try {
      const c = JSON.parse(await f.text());
      if (!c || typeof c !== "object" || c.formato !== "calculadora-copia") throw new Error();
      st.copia = c; st.archivo = f.name;
    } catch (e) {
      st.msg = { ok: false, texto: "Ese archivo no es una copia de seguridad de la app." };
    }
    render();
  }

  async function restaurar() {
    if (!st.copia || st.restaurando) return;
    st.restaurando = true; st.msg = null; render();
    try {
      const r = await backend.restaurar(st.copia);
      const partes = [plural(r.productos, "producto", "productos"), plural(r.insumos, "insumo", "insumos"), plural(r.gastos, "gasto fijo", "gastos fijos"),
        plural(r.ajustes, "ajuste", "ajustes")];
      const caja = r.caja_ya_tenia
        ? "La caja no se restauró porque este negocio ya tiene cajas: una copia nunca se mezcla con ventas cargadas."
        : "De la caja: " + plural(r.cajas, "caja", "cajas") + ", " + plural(r.ventas, "venta", "ventas") + " y " + plural(r.movimientos, "gasto o retiro", "gastos o retiros") + ".";
      st.hecho = "Se agregaron " + partes.join(", ") + " (lo que ya tenías no se tocó). " + caja;
      st.copia = null;
    } catch (e) {
      st.msg = { ok: false, texto: e instanceof SinRespuesta ? "No hubo respuesta. Probá de nuevo: restaurar dos veces no duplica nada." : e.message };
    }
    st.restaurando = false; render();
  }

  function render() {
    const box = $("#copia");
    box.textContent = "";
    box.appendChild(el("h3", null, "Copia de seguridad"));
    box.appendChild(el("p", "hint", "Descargá un archivo con todo: productos, insumos, gastos, cajas, ventas e informes. Guardalo en Drive o mandalo por mail. Conviene hacerlo una vez por semana."));
    let ultima = null;
    try { ultima = localStorage.getItem(CLAVE_ULTIMA); } catch (e) {}
    box.appendChild(el("p", "hint", ultima ? "Última copia descargada en este dispositivo: " + fechaHora(ultima) + "." : "Todavía no descargaste ninguna copia en este dispositivo."));
    const b = boton("btn primary", st.bajando ? "Armando la copia…" : "Descargar copia", descargar); b.id = "copia-bajar"; b.disabled = st.bajando;
    box.appendChild(b);
    if (st.msg) { const m = el("p", "caja-msg " + (st.msg.ok ? "ok" : "mal"), st.msg.texto); m.setAttribute("role", st.msg.ok ? "status" : "alert"); box.appendChild(m); }

    box.appendChild(el("h3", null, "Restaurar una copia"));
    box.appendChild(el("p", "hint", "Sirve si perdiste los datos o pasás a otra cuenta. No borra ni cambia nada: agrega los productos, insumos y gastos que falten, y las cajas y ventas solo si este negocio todavía no tiene ninguna caja."));
    const lab = el("label", "f", "Archivo de la copia (.json)");
    const inp = el("input"); inp.type = "file"; inp.accept = ".json,application/json"; inp.id = "copia-archivo";
    inp.onchange = () => elegir(inp.files[0]);
    lab.appendChild(inp);
    box.appendChild(lab);
    if (st.copia) {
      const c = st.copia;
      const p = el("p", "copia-previa");
      p.append(el("b", null, "Copia del " + (c.creada_en ? fechaHora(c.creada_en) : "?") + ": "), document.createTextNode(describirCopia(c) + "."),
        el("span", "copia-nombre", st.archivo));
      box.appendChild(p);
      const acc = el("div", "copia-acc");
      const ok = boton("btn danger", st.restaurando ? "Restaurando…" : "Restaurar esta copia", restaurar); ok.id = "copia-restaurar"; ok.disabled = st.restaurando;
      acc.append(ok, boton("btn ghost", "Cancelar", () => { st.copia = null; render(); }));
      box.appendChild(acc);
    }
    if (st.hecho) {
      const m = el("p", "caja-msg ok", st.hecho); m.setAttribute("role", "status");
      box.appendChild(m);
      const r = boton("btn primary", "Ver los datos restaurados", () => location.reload()); r.id = "copia-recargar";
      box.appendChild(r);
    }
  }
  render();
}
