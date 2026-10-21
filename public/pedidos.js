// Pestaña Pedidos: lo que el asistente de WhatsApp tomó. Suena cuando entra un pedido nuevo; cada botón
// cambia el estado y le avisa al cliente por WhatsApp (lo hace el servidor: netlify/functions/pedido-estado.mjs).
// backend (null en el modo demo): { pedidos(), charlas(), cambiarEstado(id, estado, motivo), soltarCharla(tel) }
import { fmtPesos } from "./dinero.js";

export const ESTADOS = {
  nuevo: "Nuevo", aceptado: "Aceptado", en_preparacion: "En preparación",
  en_camino: "En camino", entregado: "Entregado", rechazado: "Rechazado",
};
const PAGOS = { efectivo: "Efectivo", transferencia: "Transferencia", dividido: "Dividido" };
// El botón principal de cada estado: a cuál pasa y cómo se llama (depende de si es delivery o retiro).
export function siguiente(p) {
  switch (p.estado) {
    case "nuevo": return { estado: "aceptado", texto: "Aceptar pedido" };
    case "aceptado": return { estado: "en_preparacion", texto: "En preparación" };
    case "en_preparacion": return { estado: "en_camino", texto: p.entrega === "delivery" ? "En camino" : "Listo para retirar" };
    case "en_camino": return { estado: "entregado", texto: "Entregado" };
    default: return null;
  }
}
const terminado = (p) => p.estado === "entregado" || p.estado === "rechazado";
const CADA_MS = 15000;

export function iniciarPedidos(calc, backend) {
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
  const hora = (iso) => new Date(iso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", hour12: false });
  const st = { pedidos: [], charlas: [], error: "", cargado: false, enviando: null, msg: null, vistos: null, verTerminados: false };
  let audio = null;
  let sonido = false;
  try { sonido = localStorage.getItem("pedidos-sonido") === "1"; } catch (e) {}

  const box = $("#view-pedidos");
  if (!box) return;
  if (!backend) {
    box.innerHTML = "";
    const c = el("div", "card ped-card");
    c.append(el("h2", null, "Pedidos por WhatsApp"),
      el("p", "hint", "Acá aparecen los pedidos que toma el asistente de WhatsApp. Necesita una cuenta (no funciona en el modo demo)."));
    box.append(c);
    return;
  }

  // ---------- Aviso con sonido ----------
  function pitido() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const t = audio.currentTime;
      [0, 0.25, 0.5].forEach((d, i) => {
        const o = audio.createOscillator(), g = audio.createGain();
        o.frequency.value = i === 2 ? 1320 : 880;
        g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.4, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.2);
        o.connect(g).connect(audio.destination); o.start(t + d); o.stop(t + d + 0.22);
      });
    } catch (e) {}
  }
  async function avisar(nuevos) {
    if (sonido) pitido();
    if (navigator.vibrate) navigator.vibrate([300, 150, 300]);
    const texto = nuevos.length === 1 ? "Pedido #" + nuevos[0].numero + " · " + fmtPesos(nuevos[0].total) : nuevos.length + " pedidos nuevos";
    try {
      if (sonido && "Notification" in window && Notification.permission === "granted" && document.visibilityState !== "visible") {
        const reg = await navigator.serviceWorker.getRegistration();
        if (reg) reg.showNotification("Nuevo pedido por WhatsApp", { body: texto, tag: "pedido", renotify: true, icon: "iconos/icono-192.png", data: { url: "./?tab=pedidos" } });
      }
    } catch (e) {}
  }
  async function activarSonido() {
    sonido = !sonido;
    try { localStorage.setItem("pedidos-sonido", sonido ? "1" : "0"); } catch (e) {}
    if (sonido) {
      pitido(); // el navegador solo deja sonar después de un toque: este es ese toque
      if ("Notification" in window && Notification.permission === "default") { try { await Notification.requestPermission(); } catch (e) {} }
    }
    render();
  }

  // ---------- Datos ----------
  async function cargar() {
    try {
      const [pedidos, charlas] = await Promise.all([backend.pedidos(), backend.charlas()]);
      const nuevos = pedidos.filter((p) => p.estado === "nuevo");
      if (st.vistos) {
        const recien = nuevos.filter((p) => !st.vistos.has(p.id));
        if (recien.length) avisar(recien);
      }
      st.vistos = new Set(nuevos.map((p) => p.id).concat(st.vistos ? [...st.vistos] : []));
      st.pedidos = pedidos; st.charlas = charlas; st.error = ""; st.cargado = true;
    } catch (e) {
      st.error = "No se pudieron leer los pedidos. " + (navigator.onLine === false ? "Sin internet." : "¿Corriste supabase/whatsapp.sql?");
    }
    render();
  }
  async function cambiar(p, estado) {
    let motivo = null;
    if (estado === "rechazado") {
      motivo = window.prompt("¿Por qué no podés tomarlo? (se lo mandamos al cliente)", "Nos quedamos sin stock");
      if (motivo === null) return;
    }
    st.enviando = p.id; st.msg = null; render();
    try {
      const r = await backend.cambiarEstado(p.id, estado, motivo);
      Object.assign(p, r.pedido);
      st.msg = r.avisado === false
        ? { ok: false, texto: "Pedido #" + p.numero + ": " + ESTADOS[estado] + ". No se le pudo avisar al cliente por WhatsApp (pasaron más de 24 h de su último mensaje o hubo un error): avisale vos." }
        : { ok: true, texto: "Pedido #" + p.numero + ": " + ESTADOS[estado] + (r.avisado === "en_cola" ? ". El bot le avisa al cliente en unos segundos." : r.avisado ? ". Le avisamos al cliente." : ".") };
    } catch (e) {
      st.msg = { ok: false, texto: e.message || "No se pudo cambiar el estado." };
    }
    st.enviando = null; render();
  }
  async function soltar(c) {
    try { await backend.soltarCharla(c.telefono); st.charlas = st.charlas.filter((x) => x !== c); }
    catch (e) { st.msg = { ok: false, texto: "No se pudo reactivar el asistente en esa charla." }; }
    render();
  }

  // ---------- Pantalla ----------
  // Link a la charla de WhatsApp. Algunos clientes llegan al bot sin número visible (WhatsApp lo oculta): solo el nombre.
  function contacto(nombre, tel) {
    if (!/^\d{8,15}$/.test(tel || "")) return el("span", null, nombre || "Cliente de WhatsApp");
    const a = el("a", null, (nombre ? nombre + " · " : "") + "+" + tel);
    a.href = "https://wa.me/" + tel; a.target = "_blank"; a.rel = "noopener";
    return a;
  }
  function tarjetaPedido(p) {
    const c = el("article", "card ped-card ped-" + p.estado);
    const cab = el("div", "ped-cab");
    cab.append(el("strong", "ped-num", "#" + p.numero), el("span", "ped-hora num", hora(p.creado)), el("span", "ped-estado", ESTADOS[p.estado]));
    c.append(cab);
    const quien = el("p", "ped-quien");
    quien.append(contacto(p.nombre, p.telefono));
    c.append(quien);
    const ul = el("ul", "ped-items");
    (p.renglones || []).forEach((r) => {
      const li = el("li");
      li.append(el("span", null, r.cantidad + " × " + r.nombre + (r.opcion_nombre ? " (" + r.opcion_nombre + ")" : "")), el("span", "num", fmtPesos(r.subtotal)));
      ul.append(li);
    });
    if (p.entrega === "delivery") {
      const li = el("li");
      li.append(el("span", null, "Envío"), el("span", "num", p.envio == null ? "a confirmar" : fmtPesos(p.envio)));
      ul.append(li);
    }
    const tot = el("li", "ped-total");
    tot.append(el("span", null, "Total"), el("span", "num", fmtPesos(p.total)));
    ul.append(tot);
    c.append(ul);

    const datos = el("p", "ped-datos");
    datos.append(el("b", null, p.entrega === "delivery" ? "Delivery" : "Retira en el local"));
    if (p.entrega === "delivery") {
      if (p.ubicacion && p.ubicacion.lat != null) {
        const a = el("a", null, "Ver ubicación en el mapa");
        a.href = "https://www.google.com/maps?q=" + encodeURIComponent(p.ubicacion.lat + "," + p.ubicacion.lng); a.target = "_blank"; a.rel = "noopener";
        datos.append(" · ", a);
      }
      if (p.direccion) datos.append(" · " + p.direccion);
    }
    datos.append(" · Paga: " + (PAGOS[p.pago] || "sin definir"));
    c.append(datos);
    if (p.notas) c.append(el("p", "ped-notas", "Nota: " + p.notas));
    if (p.estado === "rechazado" && p.motivo_rechazo) c.append(el("p", "hint", "Motivo: " + p.motivo_rechazo));

    const sig = siguiente(p);
    if (sig) {
      const acc = el("div", "ped-acc");
      const b = el("button", "btn primary grande", st.enviando === p.id ? "Guardando…" : sig.texto);
      b.type = "button"; b.disabled = !!st.enviando; b.onclick = () => cambiar(p, sig.estado);
      acc.append(b);
      if (p.estado === "nuevo" || p.estado === "aceptado") {
        const r = el("button", "btn danger", "Rechazar");
        r.type = "button"; r.disabled = !!st.enviando; r.onclick = () => cambiar(p, "rechazado");
        acc.append(r);
      }
      c.append(acc);
    }
    return c;
  }

  function render() {
    const activos = st.pedidos.filter((p) => !terminado(p));
    const nuevos = activos.filter((p) => p.estado === "nuevo").length;
    const tab = $("#tab-pedidos");
    if (tab) tab.textContent = nuevos ? "Pedidos (" + nuevos + ")" : "Pedidos";

    box.innerHTML = "";
    const cfg = (calc.estado.ajustes || {}).whatsapp || {};
    const top = el("div", "card ped-card ped-top");
    top.append(el("h2", null, "Pedidos por WhatsApp"));
    const fila = el("div", "ped-acc");
    const on = el("button", "btn " + (cfg.activo ? "primary" : ""), cfg.activo ? "Asistente: encendido" : "Asistente: apagado");
    on.type = "button"; on.setAttribute("aria-pressed", cfg.activo ? "true" : "false");
    on.onclick = async () => { await calc.guardarAjuste("whatsapp", Object.assign({}, cfg, { activo: !cfg.activo })); render(); };
    const son = el("button", "btn " + (sonido ? "primary" : ""), sonido ? "Sonido: sí" : "Activar sonido");
    son.type = "button"; son.setAttribute("aria-pressed", sonido ? "true" : "false"); son.onclick = activarSonido;
    fila.append(on, son);
    top.append(fila,
      el("p", "hint", cfg.activo
        ? "El asistente contesta los WhatsApp, toma el pedido y te suena acá cuando está completo. Si contestás vos desde la app de WhatsApp, el asistente se corre de esa charla por 3 horas."
        : "Apagado: el asistente no contesta y los mensajes los ves solo en WhatsApp, como siempre."));
    if (!sonido) top.append(el("p", "hint", "Tocá \"Activar sonido\" para que suene cuando entra un pedido (con esta pestaña abierta)."));
    box.append(top);

    if (st.msg) {
      const m = el("p", "caja-msg " + (st.msg.ok ? "ok" : "mal"), st.msg.texto);
      m.setAttribute("role", st.msg.ok ? "status" : "alert");
      box.append(m);
    }
    if (st.error) box.append(el("p", "caja-msg mal", st.error));

    if (st.charlas.length) {
      const c = el("div", "card ped-card ped-ayuda");
      c.append(el("h3", null, "Te necesitan en WhatsApp"));
      st.charlas.forEach((ch) => {
        const f = el("div", "ped-charla");
        const a = contacto(ch.nombre, ch.telefono);
        const b = el("button", "btn", "Listo, que siga el asistente");
        b.type = "button"; b.onclick = () => soltar(ch);
        f.append(a, el("span", "hint", ch.necesita_humano), b);
        c.append(f);
      });
      box.append(c);
    }

    if (!st.cargado && !st.error) box.append(el("p", "hint", "Cargando pedidos…"));
    else if (!activos.length) box.append(el("p", "hint ped-vacio", "No hay pedidos en curso."));
    activos.forEach((p) => box.append(tarjetaPedido(p)));

    const hechos = st.pedidos.filter(terminado);
    if (hechos.length) {
      const d = el("details", "card ped-card");
      d.open = st.verTerminados;
      d.ontoggle = () => { st.verTerminados = d.open; };
      d.append(el("summary", null, "Terminados hoy (" + hechos.length + ")"));
      hechos.forEach((p) => d.append(tarjetaPedido(p)));
      box.append(d);
    }
  }

  render();
  cargar();
  setInterval(() => { if (navigator.onLine !== false && !st.enviando) cargar(); }, CADA_MS);
  calc.alCambiar(() => render());
}
