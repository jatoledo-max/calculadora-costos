// Página del cliente (ticket.html, se abre en /t/<código>): ve el pedido que le armó el negocio y responde.
// Lee y responde con ver_ticket y responder_ticket (supabase/tickets.sql), sin login: el código del link es la llave.
import { CONFIG } from "./config.js";
import { fmtPesos } from "./dinero.js";
import { localVerTicket, localResponderTicket } from "./tickets-datos.js";

const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const token = (location.pathname.match(/\/t\/([\w-]{10,40})/) || [])[1] || new URLSearchParams(location.search).get("t") || "";
const PAGOS = { efectivo: "Efectivo", transferencia: "Transferencia", dividido: "Parte efectivo y parte transferencia" };

async function rpc(fn, args) {
  if (!CONFIG.SUPABASE_URL) return fn === "ver_ticket" ? localVerTicket(args.p_token) : localResponderTicket(args.p_token, args.p_estado, args.p_version, args.p_respuesta);
  let r;
  try {
    r = await fetch(CONFIG.SUPABASE_URL + "/rest/v1/rpc/" + fn, {
      method: "POST",
      headers: { apikey: CONFIG.SUPABASE_ANON_KEY, Authorization: "Bearer " + CONFIG.SUPABASE_ANON_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch (e) { throw new Error("Sin conexión. Revisá internet y probá de nuevo."); }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(j && j.code === "P0001" ? j.message : "No se pudo. Probá de nuevo en un rato.");
  return j;
}

const st = { datos: null, modo: null, texto: "", enviando: false, error: "" };

async function cargar() {
  try { st.datos = await rpc("ver_ticket", { p_token: token }); st.error = ""; }
  catch (e) { if (!st.datos) st.error = e.message; }
  render();
}

async function responder(estado) {
  if (st.enviando) return;
  if (estado === "cambio" && !st.texto.trim()) { st.error = "Escribí qué querés cambiar."; render(); return; }
  st.enviando = true; st.error = ""; render();
  try {
    st.datos = await rpc("responder_ticket", { p_token: token, p_estado: estado, p_version: st.datos.ticket.version, p_respuesta: st.texto.trim() || null });
    st.modo = null; st.texto = "";
  } catch (e) {
    st.error = e.message;
    if (/corrigió|ya fue respondido/.test(e.message)) { const d = await rpc("ver_ticket", { p_token: token }).catch(() => null); if (d) st.datos = d; }
  }
  st.enviando = false;
  render();
}

function aplicarMarca(n) {
  document.title = "Tu pedido · " + (n.nombre || "");
  if (n.color && /^#[0-9a-f]{6}$/i.test(n.color)) {
    const v = parseInt(n.color.slice(1), 16);
    const [r, g, b] = [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
    document.documentElement.style.setProperty("--accent", n.color);
    document.documentElement.style.setProperty("--accent-ink", 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.25 ? "#141210" : "#ffffff");
  }
}

function render() {
  const box = $("#tkc");
  box.textContent = "";
  if (!st.datos) {
    box.appendChild(el("div", "card tkc-card", st.error || "Este pedido no existe o ya no está disponible. Pedile al negocio que te mande el link de nuevo."));
    return;
  }
  const { negocio: n, pago, ticket: t } = st.datos;
  aplicarMarca(n);

  const cab = el("header", "tkc-cab");
  if (n.logo) { const i = el("img"); i.src = n.logo; i.alt = ""; cab.appendChild(i); }
  cab.appendChild(el("h1", null, n.nombre));
  box.appendChild(cab);

  const card = el("section", "card tkc-card");
  card.appendChild(el("h2", null, "Tu pedido #" + t.numero + (t.cliente ? " · " + t.cliente : "")));
  const ul = el("ul", "tkc-items");
  t.items.forEach((i) => {
    const li = el("li");
    li.append(el("span", "c num", i.cantidad + "×"), el("span", "nm", i.nombre + (i.opcion_nombre ? " (" + i.opcion_nombre + ")" : "")), el("span", "num", fmtPesos(i.subtotal)));
    ul.appendChild(li);
  });
  const env = el("li", "tkc-envio");
  env.append(el("span", "c"), el("span", "nm", t.envio == null ? "Retirás en el local" : "Envío"),
    el("span", "num", t.envio == null ? "" : Number(t.envio) ? fmtPesos(t.envio) : "sin cargo"));
  ul.appendChild(env);
  card.appendChild(ul);
  if (t.nota) card.appendChild(el("p", "tkc-nota", t.nota));
  const tot = el("div", "caja-total");
  tot.append(el("span", "k", "Total"), el("span", "v num", fmtPesos(t.total)));
  card.appendChild(tot);

  const medios = (pago.pagos || []).map((p) => PAGOS[p]).filter(Boolean);
  if (medios.length || pago.alias) {
    const pg = el("div", "tkc-pago");
    if (medios.length) pg.appendChild(el("p", null, "Podés pagar con: " + medios.join(", ") + "."));
    if (pago.alias) {
      const fila = el("p", "tkc-alias");
      fila.append("Alias: ", el("b", "num", pago.alias));
      const cp = el("button", "btn", "Copiar"); cp.type = "button";
      cp.onclick = async () => { try { await navigator.clipboard.writeText(pago.alias); cp.textContent = "Copiado ✓"; } catch (e) { cp.textContent = "Mantené apretado el alias"; } };
      fila.appendChild(cp);
      pg.appendChild(fila);
    }
    card.appendChild(pg);
  }
  box.appendChild(card);
  box.appendChild(respuesta(t, n, pago));
}

function avisar(n, pago, texto) {
  if (!pago.whatsapp) return null;
  const a = el("a", "btn tkc-wa", "Avisar por WhatsApp");
  a.href = "https://wa.me/" + pago.whatsapp + "?text=" + encodeURIComponent(texto); a.target = "_blank"; a.rel = "noopener";
  return a;
}

function respuesta(t, n, pago) {
  const box = el("section", "card tkc-card tkc-resp");
  box.setAttribute("aria-live", "polite");
  if (st.error) { const e = el("p", "caja-msg mal", st.error); e.setAttribute("role", "alert"); box.appendChild(e); }

  if (t.estado === "aceptado") {
    box.classList.add("ok");
    box.appendChild(el("h2", null, "¡Pedido confirmado!"));
    box.appendChild(el("p", null, n.nombre + " ya ve que lo aceptaste."));
    const a = avisar(n, pago, "Hola! Acepté el pedido #" + t.numero + " (" + fmtPesos(t.total) + ").");
    if (a) box.appendChild(a);
    return box;
  }
  if (t.estado === "cambio") {
    box.appendChild(el("h2", null, "Pediste un cambio"));
    box.appendChild(el("p", "tkc-nota", t.respuesta));
    box.appendChild(el("p", "hint", "Cuando " + n.nombre + " lo corrija, este mismo link muestra el pedido nuevo para que lo confirmes."));
    const a = avisar(n, pago, "Hola! Te pedí un cambio en el pedido #" + t.numero + ": " + t.respuesta);
    if (a) box.appendChild(a);
    return box;
  }
  if (t.estado === "rechazado") {
    box.appendChild(el("h2", null, "Rechazaste este pedido"));
    box.appendChild(el("p", "hint", "Si fue un error, escribile a " + n.nombre + " por WhatsApp."));
    return box;
  }

  // Pendiente: aceptar, pedir un cambio o rechazar.
  if (st.modo === "cambio" || st.modo === "rechazo") {
    const cambio = st.modo === "cambio";
    const lab = el("label", "f", cambio ? "¿Qué querés cambiar?" : "¿Por qué? (opcional)");
    const ta = el("textarea"); ta.id = "tkc-texto"; ta.rows = 3; ta.maxLength = 500; ta.value = st.texto;
    ta.placeholder = cambio ? "Ej: sin huevo, y agregame una gaseosa" : "";
    ta.oninput = () => { st.texto = ta.value; };
    lab.appendChild(ta);
    box.appendChild(lab);
    const ok = el("button", "btn grande " + (cambio ? "primary" : "danger"), st.enviando ? "Enviando…" : cambio ? "Enviar cambio" : "Rechazar pedido");
    ok.type = "button"; ok.disabled = st.enviando; ok.onclick = () => responder(cambio ? "cambio" : "rechazado");
    const vol = el("button", "btn ghost", "Volver"); vol.type = "button"; vol.disabled = st.enviando;
    vol.onclick = () => { st.modo = null; st.texto = ""; st.error = ""; render(); };
    box.append(ok, vol);
    setTimeout(() => ta.focus());
    return box;
  }
  box.appendChild(el("p", "hint", "¿Está todo bien?"));
  const acepto = el("button", "btn primary grande", st.enviando ? "Enviando…" : "Aceptar pedido"); acepto.type = "button"; acepto.id = "tkc-aceptar";
  acepto.disabled = st.enviando; acepto.onclick = () => responder("aceptado");
  const cambio = el("button", "btn grande", "Pedir un cambio"); cambio.type = "button"; cambio.id = "tkc-cambio";
  cambio.disabled = st.enviando; cambio.onclick = () => { st.modo = "cambio"; st.error = ""; render(); };
  const rechazo = el("button", "btn ghost", "Rechazar"); rechazo.type = "button"; rechazo.id = "tkc-rechazar";
  rechazo.disabled = st.enviando; rechazo.onclick = () => { st.modo = "rechazo"; st.error = ""; render(); };
  box.append(acepto, cambio, rechazo);
  return box;
}

// Si pidió un cambio, la página se actualiza sola cuando el negocio lo corrige.
setInterval(() => {
  const t = st.datos && st.datos.ticket;
  if (t && t.estado === "cambio" && document.visibilityState === "visible" && !st.enviando) cargar();
}, 15000);
cargar();
