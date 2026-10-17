// Plata: en JavaScript los decimales tienen errores chicos (0,1 + 0,2 = 0,30000000000000004).
// Para no arrastrarlos, las cuentas de la caja se hacen en centavos enteros y se pasan a pesos solo al mostrar o guardar.

// Redondeo a centavos (2 decimales) sin el error típico de 1,005 → 1,00.
export function redondear(n) {
  return Math.round((Number(n) || 0) * 100 + Number.EPSILON * 100) / 100;
}
export const aCentavos = (pesos) => Math.round(redondear(pesos) * 100);
export const aPesos = (centavos) => centavos / 100;

// "$ 10.000" o "$ 10.000,50" si hay centavos.
export function fmtPesos(pesos) {
  const n = redondear(pesos);
  const conCentavos = Math.round(n * 100) % 100 !== 0;
  return (n < 0 ? "− $ " : "$ ") + Math.abs(n).toLocaleString("es-AR", { minimumFractionDigits: conCentavos ? 2 : 0, maximumFractionDigits: 2 });
}
