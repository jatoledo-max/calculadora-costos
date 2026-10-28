// Completa los datos de contacto y del titular en el pie de la app y en las páginas legales
// (terminos.html, privacidad.html, arrepentimiento.html). Todo sale de config.js.
import { CONFIG } from "./config.js";

const FALTA = "(a completar)";

export function linkWhatsApp(texto) {
  const n = String(CONFIG.SOPORTE_WHATSAPP || "").replace(/\D/g, "");
  return n ? "https://wa.me/" + n + (texto ? "?text=" + encodeURIComponent(texto) : "") : "";
}

export function completarContacto(raiz = document) {
  const datos = { titular: CONFIG.TITULAR, cuit: CONFIG.CUIT, email: CONFIG.SOPORTE_EMAIL, whatsapp: CONFIG.SOPORTE_WHATSAPP ? "+" + String(CONFIG.SOPORTE_WHATSAPP).replace(/\D/g, "") : "" };
  raiz.querySelectorAll("[data-dato]").forEach((el) => { el.textContent = datos[el.dataset.dato] || FALTA; });
  raiz.querySelectorAll("[data-si]").forEach((el) => { el.hidden = !datos[el.dataset.si]; });
  raiz.querySelectorAll("a[data-wa]").forEach((a) => {
    const url = linkWhatsApp(a.dataset.wa);
    if (url) { a.href = url; a.target = "_blank"; a.rel = "noopener"; } else a.hidden = true;
  });
  raiz.querySelectorAll("a[data-mail]").forEach((a) => {
    if (CONFIG.SOPORTE_EMAIL) a.href = "mailto:" + CONFIG.SOPORTE_EMAIL + (a.dataset.mail ? "?subject=" + encodeURIComponent(a.dataset.mail) : "");
    else a.hidden = true;
  });
}
