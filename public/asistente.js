// Pestaña Asistente: el dueño le pregunta cosas a la calculadora con sus propios datos.
// Las cuentas las hace el servidor con costos.js (netlify/lib/asistente.mjs); la IA solo las explica.
// "preguntar(pregunta, historial)" → texto de la respuesta. En modo demo no hay (necesita la cuenta).

const SUGERIDAS = [
  "¿Qué producto me deja más ganancia?",
  "¿Hay algún producto que me haga perder plata?",
  "Si la carne sube 15%, ¿cuánto me sube cada producto?",
  "¿Cuánto vendí esta semana y cuánto gané?",
  "¿Qué insumo pesa más en el costo del lomito completo?",
];
const GUARDADO = "costos-asistente";

export function iniciarAsistente(preguntar) {
  const $ = (s) => document.querySelector(s);
  const lista = $("#asis-mensajes"), form = $("#asis-form"), campo = $("#asis-pregunta"), boton = $("#asis-enviar");
  let historial = [];
  try { historial = JSON.parse(sessionStorage.getItem(GUARDADO)) || []; } catch (e) {}
  const guardar = () => { try { sessionStorage.setItem(GUARDADO, JSON.stringify(historial.slice(-30))); } catch (e) {} };

  function burbuja(rol, texto, clase) {
    const d = document.createElement("div");
    d.className = "asis-msg " + (rol === "usuario" ? "yo" : "ia") + (clase ? " " + clase : "");
    d.textContent = texto;
    lista.appendChild(d);
    d.scrollIntoView({ block: "end", behavior: "smooth" });
    return d;
  }
  function render() {
    lista.textContent = "";
    if (!historial.length) {
      const v = document.createElement("div");
      v.className = "asis-vacio";
      v.innerHTML = '<p class="hint">Preguntá lo que quieras sobre tus costos, precios y ventas. Contesta con tus datos cargados.</p><div class="chips asis-sugeridas"></div>';
      const ch = v.querySelector(".chips");
      SUGERIDAS.forEach((t) => {
        const b = document.createElement("button");
        b.type = "button"; b.textContent = t;
        b.onclick = () => enviar(t);
        ch.appendChild(b);
      });
      lista.appendChild(v);
    }
    historial.forEach((m) => burbuja(m.rol, m.texto));
    $("#asis-borrar").hidden = !historial.length;
  }

  let ocupado = false;
  async function enviar(texto) {
    texto = (texto || "").trim();
    if (!texto || ocupado) return;
    if (!preguntar) { burbuja("asistente", "El asistente funciona cuando entrás con tu cuenta. En el modo demo no está disponible.", "error"); return; }
    ocupado = true; boton.disabled = true;
    const anterior = historial.slice();
    historial.push({ rol: "usuario", texto });
    render();
    campo.value = "";
    const espera = burbuja("asistente", "Haciendo las cuentas…", "pensando");
    try {
      const r = await preguntar(texto, anterior);
      historial.push({ rol: "asistente", texto: r });
      guardar();
      render();
    } catch (e) {
      espera.remove();
      historial.pop(); // la pregunta sin respuesta no queda en la charla: se vuelve a poner en el campo
      campo.value = texto;
      render();
      burbuja("asistente", e.message || "No se pudo contestar. Probá de nuevo.", "error");
    } finally {
      ocupado = false; boton.disabled = false;
      campo.focus();
    }
  }

  form.onsubmit = (e) => { e.preventDefault(); enviar(campo.value); };
  // Enter manda; Shift+Enter hace un renglón nuevo.
  campo.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enviar(campo.value); } });
  $("#asis-borrar").onclick = () => { historial = []; guardar(); render(); };
  render();
}

// Versión con cuenta: llama a la función de Netlify con el token de la sesión.
export function preguntarConCuenta(supabase) {
  return async (pregunta, historial) => {
    const { data } = await supabase.auth.getSession();
    let r;
    try {
      r = await fetch("/.netlify/functions/asistente", {
        method: "POST",
        headers: { Authorization: "Bearer " + (data.session ? data.session.access_token : ""), "content-type": "application/json" },
        body: JSON.stringify({ pregunta, historial }),
      });
    } catch (e) {
      throw new Error(navigator.onLine === false ? "Sin internet. Conectate y probá de nuevo." : "No se pudo conectar con el asistente.");
    }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.respuesta) throw new Error(j.error || "No se pudo contestar. Probá de nuevo.");
    return j.respuesta;
  };
}
