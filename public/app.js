import { CONFIG } from "./config.js";
import { iniciarCalculadora } from "./calculadora.js";
import { localStore, supabaseStore, localCaja, supabaseCaja } from "./stores.js";
import { iniciarCaja } from "./caja.js";
import { iniciarInformes } from "./informes.js";
import { iniciarCopias } from "./copia.js";

const $ = (s) => document.querySelector(s);
const PANTALLAS = ["cargando", "login", "alta", "pago", "app"];
function mostrar(nombre) {
  PANTALLAS.forEach((p) => { $("#pantalla-" + p).hidden = p !== nombre; });
}

// ---------- Marca del negocio ----------
function aplicarMarca(neg) {
  $("#neg-titulo").textContent = neg.nombre || "Mi negocio";
  document.title = (neg.nombre ? neg.nombre + " · " : "") + "CalculadoraDeGananciasMV";
  const img = $("#neg-logo-img");
  if (neg.logo) { img.src = neg.logo; img.alt = neg.nombre || "Logo"; img.hidden = false; } else img.hidden = true;
  const root = document.documentElement;
  if (neg.color && /^#[0-9a-f]{6}$/i.test(neg.color)) {
    root.style.setProperty("--accent", neg.color);
    root.style.setProperty("--accent-ink", textoSobre(neg.color));
    root.classList.add("marca-propia");
  }
}
function textoSobre(hex) {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); });
  const L = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return L > 0.25 ? "#141210" : "#ffffff";
}
// Achica la imagen a 256 px para guardarla liviana junto al negocio.
function achicarLogo(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const lado = 256, k = Math.min(1, lado / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      resolve(file.type === "image/png" ? c.toDataURL("image/png") : c.toDataURL("image/jpeg", 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error("No se pudo leer la imagen."));
    img.src = URL.createObjectURL(file);
  });
}
function textoSuscripcion(neg) {
  if (!neg.prueba_hasta) return "Modo demo.";
  if (neg.suscripcion_estado === "authorized") return "Suscripción activa. Gracias por confiar.";
  const hasta = new Date(neg.prueba_hasta);
  const dias = Math.ceil((hasta - Date.now()) / 86400000);
  return dias > 0 ? "Prueba gratis: te quedan " + dias + (dias === 1 ? " día" : " días") + " (hasta el " + hasta.toLocaleDateString("es-AR") + ")." : "Tu prueba gratis terminó.";
}
const activo = (neg) => neg.suscripcion_estado === "authorized" || new Date(neg.prueba_hasta) > new Date();

// ---------- Pestaña "Mi negocio" ----------
function iniciarFormNegocio(neg, guardar) {
  $("#neg-nombre").value = neg.nombre || "";
  $("#neg-color").value = neg.color || "#b77900";
  $("#sub-estado").textContent = textoSuscripcion(neg);
  $("#neg-form").onsubmit = async (e) => {
    e.preventDefault();
    const cambios = { nombre: $("#neg-nombre").value.trim(), color: $("#neg-color").value };
    const f = $("#neg-logo").files[0];
    try {
      if (f) cambios.logo = await achicarLogo(f);
      await guardar(cambios);
      Object.assign(neg, cambios);
      aplicarMarca(neg);
      $("#neg-msg").textContent = "Guardado ✓";
    } catch (err) {
      $("#neg-msg").textContent = err.message || "No se pudo guardar.";
    }
  };
}

// ---------- Modo demo (sin Supabase configurado) ----------
function arrancarDemo() {
  let neg = { nombre: "Demo", color: "", logo: "" };
  try { neg = JSON.parse(localStorage.getItem("costos-demo-negocio")) || neg; } catch (e) {}
  aplicarMarca(neg);
  iniciarFormNegocio(neg, async (c) => { try { localStorage.setItem("costos-demo-negocio", JSON.stringify(Object.assign({}, neg, c))); } catch (e) {} });
  $("#btn-salir").hidden = true;
  mostrar("app");
  const calc = iniciarCalculadora(localStore());
  const caja = localCaja(calc.estado);
  iniciarInformes(calc, caja, iniciarCaja(calc, caja));
  iniciarCopias(caja, () => neg.nombre);
}

// ---------- Modo real (Supabase) ----------
async function arrancar() {
  if (!CONFIG.SUPABASE_URL) return arrancarDemo();
  const { createClient } = await import("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm");
  const supabase = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  const salir = async () => { await supabase.auth.signOut(); location.reload(); };
  $("#btn-salir").onclick = salir;
  $("#btn-salir-pago").onclick = salir;

  // Login / registro
  let registrando = false;
  $("#login-toggle").onclick = () => {
    registrando = !registrando;
    $("#login-btn").textContent = registrando ? "Crear cuenta" : "Entrar";
    $("#login-toggle").textContent = registrando ? "Ya tengo cuenta" : "¿No tenés cuenta? Creala gratis";
    $("#login-pass").autocomplete = registrando ? "new-password" : "current-password";
  };
  $("#login-olvide").onclick = async () => {
    const email = $("#login-email").value.trim();
    if (!email) { $("#login-msg").textContent = "Escribí tu email y tocá de nuevo."; return; }
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: location.origin });
    $("#login-msg").textContent = error ? "No se pudo enviar el mail. Probá de nuevo." : "Te mandamos un mail para cambiar la contraseña.";
  };
  $("#login-form").onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#login-email").value.trim(), password = $("#login-pass").value;
    $("#login-msg").textContent = "";
    const r = registrando
      ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: location.origin } })
      : await supabase.auth.signInWithPassword({ email, password });
    if (r.error) { $("#login-msg").textContent = registrando ? "No se pudo crear la cuenta: " + r.error.message : "Email o contraseña incorrectos."; return; }
    if (registrando && !r.data.session) { $("#login-msg").textContent = "Listo. Revisá tu mail y confirmá la cuenta para entrar."; return; }
    seguir(r.data.session);
  };
  supabase.auth.onAuthStateChange((evento, session) => {
    if (evento === "PASSWORD_RECOVERY") {
      // Vino del mail de "olvidé mi contraseña": el mismo formulario sirve para poner la nueva.
      mostrar("login");
      registrando = false;
      $("#login-msg").textContent = "Escribí tu nueva contraseña y tocá Entrar.";
      $("#login-form").onsubmit = async (e) => {
        e.preventDefault();
        const { error } = await supabase.auth.updateUser({ password: $("#login-pass").value });
        $("#login-msg").textContent = error ? "No se pudo cambiar: " + error.message : "Contraseña cambiada.";
        if (!error) seguir(session);
      };
    }
  });

  async function seguir(session) {
    if (!session) { mostrar("login"); return; }
    const { data: negs, error } = await supabase.from("negocios").select("*").limit(1);
    if (error) {
      mostrar("login");
      $("#login-msg").textContent = navigator.onLine === false ? "Sin internet. Conectate y recargá la página." : "No se pudo cargar tu cuenta. Recargá la página.";
      return;
    }
    let neg = negs[0];
    if (!neg) {
      mostrar("alta");
      $("#alta-form").onsubmit = async (e) => {
        e.preventDefault();
        const { error: err } = await supabase.from("negocios").insert({ nombre: $("#alta-nombre").value.trim() });
        if (err) { $("#alta-msg").textContent = "No se pudo crear el negocio. Probá de nuevo."; return; }
        seguir(session);
      };
      return;
    }
    if (!activo(neg)) {
      abrirPago(session, false);
      if (new URLSearchParams(location.search).has("pago")) $("#pago-msg").textContent = "Si ya pagaste, estamos esperando la confirmación de Mercado Pago. Recargá en un minuto.";
      return;
    }
    aplicarMarca(neg);
    iniciarFormNegocio(neg, async (cambios) => {
      const { error: err } = await supabase.from("negocios").update(cambios).eq("id", neg.id);
      if (err) throw new Error("No se pudo guardar. Si el logo es muy pesado, probá con otro.");
    });
    if (neg.suscripcion_estado !== "authorized") {
      const b = document.createElement("button");
      b.className = "btn primary"; b.type = "button"; b.textContent = "Suscribirme ahora (" + CONFIG.PRECIO_MENSUAL_TEXTO + " por mes)";
      b.onclick = () => abrirPago(session, true);
      $("#sub-estado").after(b);
    }
    mostrar("app");
    const calc = iniciarCalculadora(supabaseStore(supabase, neg.id));
    const caja = supabaseCaja(supabase);
    iniciarInformes(calc, caja, iniciarCaja(calc, caja));
    iniciarCopias(caja, () => neg.nombre);
  }

  // Pantalla de pago: al vencer la prueba, o desde la app si el negocio quiere suscribirse antes.
  function abrirPago(session, desdeApp) {
    $("#plan-precio").textContent = CONFIG.PRECIO_MENSUAL_TEXTO;
    $("#pago-titulo").textContent = desdeApp ? "Suscribirme" : "Tu prueba gratis terminó";
    $("#pago-texto").textContent = desdeApp
      ? "Seguís usando la prueba gratis hasta que termine; desde el pago, la suscripción se renueva sola cada mes."
      : "Tus insumos y productos siguen guardados. Suscribite para seguir usándolos.";
    if (!$("#pago-email").value) $("#pago-email").value = session.user.email || "";
    $("#pago-msg").textContent = "";
    $("#btn-volver-pago").hidden = !desdeApp;
    $("#btn-volver-pago").onclick = () => mostrar("app");
    $("#btn-suscribir").onclick = () => suscribir(session);
    mostrar("pago");
  }

  async function suscribir(session) {
    const email = $("#pago-email").value.trim();
    if (!$("#pago-email").checkValidity() || !email) { $("#pago-msg").textContent = "Escribí el email de tu cuenta de Mercado Pago."; return; }
    $("#pago-msg").textContent = "Abriendo Mercado Pago…";
    try {
      const r = await fetch("/.netlify/functions/crear-suscripcion", {
        method: "POST",
        headers: { Authorization: "Bearer " + session.access_token, "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const j = await r.json();
      if (!r.ok || !j.url) throw new Error(j.error || "error");
      location.href = j.url;
    } catch (e) {
      $("#pago-msg").textContent = "No se pudo abrir Mercado Pago. Probá de nuevo en un rato.";
    }
  }

  const { data } = await supabase.auth.getSession();
  seguir(data.session);
}

// ---------- Celular: instalar como app y avisar sin conexión ----------
function iniciarCelular() {
  // El service worker hace que la app se pueda instalar y que abra aunque no haya internet (sw.js).
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});

  const aviso = $("#sin-conexion");
  const conexion = () => { aviso.hidden = navigator.onLine !== false; };
  window.addEventListener("online", conexion);
  window.addEventListener("offline", conexion);
  conexion();

  // Android (Chrome) avisa cuando la app se puede instalar: guardamos el aviso y mostramos el botón.
  let pedido = null;
  const boton = $("#btn-instalar");
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); pedido = e; boton.hidden = false; });
  window.addEventListener("appinstalled", () => { pedido = null; boton.hidden = true; });
  boton.onclick = async () => {
    if (!pedido) return;
    pedido.prompt();
    await pedido.userChoice;
    pedido = null; boton.hidden = true;
  };
}

iniciarCelular();
arrancar();
