// Nombres en singular y plural para el menú y el mensaje de WhatsApp: "1 Lomito completo", "3 Lomitos completos".
// Lo que manda es el plural que el negocio escribe en la ficha del producto. Si no escribió ninguno,
// se sugiere uno con reglas conservadoras: se pasa a plural la primera palabra y los adjetivos conocidos
// que la siguen ("Lomito completo" → "Lomitos completos"), y se deja igual desde la primera preposición
// ("Porción de papas con cheddar M" → "Porciones de papas con cheddar M").
// La misma copia de este archivo está en el menú de pedidos (repo venutto, js/plural.js): si se cambia acá, cambiar allá.

const ADJETIVOS = new Set([
  "completo", "completa", "simple", "mixto", "mixta", "especial", "doble", "triple", "clásico", "clásica",
  "casero", "casera", "grande", "chico", "chica", "picante", "gratinado", "gratinada", "frito", "frita",
  "árabe", "común", "vegetariano", "vegetariana", "relleno", "rellena", "tostado", "tostada",
]);
// Palabras que en plural no siguen la regla general.
const IRREGULARES = { burger: "burgers", sandwich: "sandwiches", "sándwich": "sándwiches", club: "clubs", combo: "combos", pancho: "panchos" };
const SIN_ACENTO = { á: "a", é: "e", í: "i", ó: "o", ú: "u" };

function pluralPalabra(p) {
  const low = p.toLowerCase();
  let r;
  if (IRREGULARES[low]) r = IRREGULARES[low];
  else if (/[sx]$/.test(low)) r = low;                                    // papas, tórax: no cambian
  else if (/[aeiouáéó]$/.test(low)) r = low + "s";                        // lomito → lomitos, café → cafés
  else if (/z$/.test(low)) r = low.slice(0, -1) + "ces";                  // luz → luces
  else if (/[íú]$/.test(low)) r = low + "es";                             // maní → maníes
  else if (/(án|én|ín|ón|ún)$/.test(low)) r = low.slice(0, -2) + SIN_ACENTO[low.slice(-2, -1)] + "nes"; // porción → porciones
  else if (/[a-zñ]$/.test(low)) r = low + "es";                           // pan → panes, flan → flanes
  else return p;                                                          // números, siglas con signos: igual
  // Mantener mayúsculas: "Lomito" → "Lomitos", "XL" queda igual porque no es una palabra.
  if (p === p.toUpperCase() && p.length > 1) return p;
  return p[0] === p[0].toUpperCase() ? r[0].toUpperCase() + r.slice(1) : r;
}

export function pluralSugerido(nombre) {
  const palabras = String(nombre || "").trim().split(/\s+/).filter(Boolean);
  if (!palabras.length) return "";
  const out = [pluralPalabra(palabras[0])];
  let i = 1;
  for (; i < palabras.length && ADJETIVOS.has(palabras[i].toLowerCase()); i++) out.push(pluralPalabra(palabras[i]));
  return out.concat(palabras.slice(i)).join(" ");
}

// "1 Lomito completo", "2 Lomitos completos". Nunca "2 x Lomito completo".
export function conCantidad(cantidad, nombre, plural) {
  const n = Number(cantidad);
  const nom = String(nombre || "").trim();
  return n + " " + (n === 1 ? nom : (String(plural || "").trim() || pluralSugerido(nom)));
}
