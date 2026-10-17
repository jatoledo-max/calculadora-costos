// Informes (Fase 6): suma de cierres, atajos de fechas, planillas y pagos pendientes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sumarInformes, totalPendientes } from "../public/informe.js";
import { rangoRapido, csvCierres, csvVentas, csvMovimientos, ventasPorDia } from "../public/informes.js";

// Dos cierres con la forma que guarda la base (la foto del informe).
const dia1 = {
  ventas: 3, unidades: 5, pedidos_con_envio: 1, ventas_costo_incompleto: 0, anuladas: 1,
  ventas_brutas: 38500, descuentos: 0, ventas_netas: 38500, envios_cobrados: 0, total_cobrado: 38500, costo_mercaderia: 15200.1, packaging: 900,
  margen_bruto: 23299.9, gastos_operativos: 0, gastos_fijos_estimados: 1125, nafta_estimada: 250, resultado_estimado: 16175,
  compras_mercaderia: 6000, retiros: 10000, aportes: 0, reserva_sugerida: 15200.1, reserva_apartada: 15000,
  diferencia_efectivo: -200, anuladas_total: 10500, disponible_estimado: 7300,
  por_producto: [{ nombre: "Lomito completo", cantidad: 1, ventas: 10500, costo: 5200, costo_incompleto: false },
    { nombre: "Promo 3 lomitos", cantidad: 1, ventas: 28000, costo: 10000.1, costo_incompleto: false }],
  por_medio: { efectivo: 18500, transferencia: 20000 }, productos_costo_incompleto: [],
};
const dia2 = {
  ventas: 1, unidades: 2, pedidos_con_envio: 0, ventas_costo_incompleto: 1, anuladas: 0,
  ventas_brutas: 1000, descuentos: 100, ventas_netas: 900, envios_cobrados: 500, total_cobrado: 1400, costo_mercaderia: 300.2, packaging: 0,
  margen_bruto: 599.8, gastos_operativos: 3000, gastos_fijos_estimados: 450, nafta_estimada: 0, resultado_estimado: -2350.2,
  compras_mercaderia: 0, retiros: 0, aportes: 2000, reserva_sugerida: 300.2, reserva_apartada: 0,
  diferencia_efectivo: 50, anuladas_total: 0, disponible_estimado: 500,
  por_producto: [{ nombre: "Lomito completo", cantidad: 2, ventas: 900, costo: 300.2, costo_incompleto: true }],
  por_medio: { efectivo: 1400 }, productos_costo_incompleto: ["Lomito completo"],
};

test("sumarInformes suma dos cierres en centavos exactos", () => {
  const r = sumarInformes([dia1, dia2]);
  assert.equal(r.periodo, true);
  assert.equal(r.cajas, 2);
  assert.equal(r.ventas, 4);
  assert.equal(r.ventas_netas, 39400);
  assert.equal(r.costo_mercaderia, 15500.3);      // 15200,1 + 300,2 sin errores de coma flotante
  assert.equal(r.margen_bruto, 23899.7);
  assert.equal(r.resultado_estimado, 13824.8);
  assert.equal(r.margen_pct, 60.7);                // 23.899,7 / 39.400
  assert.equal(r.faltante, 200);
  assert.equal(r.sobrante, 50);
  assert.equal(r.cajas_con_diferencia, 2);
  assert.equal(r.diferencia_efectivo, -150);
  assert.equal(r.disponible_estimado, undefined);  // es un saldo de cada día: no se suma
  assert.deepEqual(r.por_medio, { efectivo: 19900, transferencia: 20000 });
  assert.deepEqual(r.productos_costo_incompleto, ["Lomito completo"]);
  const lomito = r.por_producto.find((x) => x.nombre === "Lomito completo");
  assert.deepEqual(lomito, { nombre: "Lomito completo", cantidad: 3, ventas: 11400, costo: 5500.2, margen: 5899.8, costo_incompleto: true });
  assert.equal(r.por_producto[0].nombre, "Promo 3 lomitos"); // ordenado por ventas
});

test("sumarInformes sin cierres da todo en cero", () => {
  const r = sumarInformes([]);
  assert.equal(r.cajas, 0);
  assert.equal(r.ventas_netas, 0);
  assert.equal(r.margen_pct, null);
  assert.deepEqual(r.por_producto, []);
});

test("atajos de fechas", () => {
  assert.deepEqual(rangoRapido("hoy", "2026-10-17"), { desde: "2026-10-17", hasta: "2026-10-17" });
  assert.deepEqual(rangoRapido("7", "2026-10-03"), { desde: "2026-09-27", hasta: "2026-10-03" });
  assert.deepEqual(rangoRapido("mes", "2026-10-17"), { desde: "2026-10-01", hasta: "2026-10-17" });
  assert.deepEqual(rangoRapido("pasado", "2026-03-15"), { desde: "2026-02-01", hasta: "2026-02-28" });
  assert.deepEqual(rangoRapido("pasado", "2026-01-05"), { desde: "2025-12-01", hasta: "2025-12-31" });
});

test("totalPendientes usa la misma regla que la base", () => {
  assert.equal(totalPendientes({ items: [{ monto: 300 }, { monto: "0.5" }, { monto: "abc" }, { monto: -5 }, {}] }), 300.5);
  assert.equal(totalPendientes(undefined), 0);
});

const cajas = [
  { id: "c2", numero: 2, fecha_operacion: "2026-10-17", estado: "abierta", abierta_en: "2026-10-17T22:00:00Z", saldo_inicial: 20000 },
  { id: "c1", numero: 1, fecha_operacion: "2026-10-16", estado: "cerrada", abierta_en: "2026-10-16T22:00:00Z", cerrada_en: "2026-10-17T03:10:00Z",
    saldo_inicial: 20000, efectivo_contado: 22300, fondo_siguiente: 20000, observaciones: "Faltan 200; \"vuelto\" mal dado",
    resumen: Object.assign({}, dia1, { efectivo_esperado: 22500, transferencias_esperadas: 20000, transferencias_banco: null, obligaciones_pendientes: 0 }) },
];

test("planilla de cierres: punto y coma, coma decimal y texto entre comillas", () => {
  const lineas = csvCierres(cajas).replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lineas.length, 3);
  assert.match(lineas[0], /^Caja;Fecha;Estado;/);
  const c1 = lineas[1].split(";");
  assert.equal(c1[0], "1");
  assert.equal(c1[1], "16/10/2026");
  assert.equal(c1[2], "Cerrada");
  assert.equal(c1[7], "15200,1");               // costo de mercadería
  assert.ok(lineas[1].endsWith('"Faltan 200; ""vuelto"" mal dado"'));
  assert.match(lineas[2], /^2;17\/10\/2026;Abierta;/);
});

test("planilla de ventas: una fila por producto, importes de la venta solo en la primera", () => {
  const ventas = [{
    id: "v1", caja_id: "c1", numero: 1, creada_en: "2026-10-16T23:00:00Z", estado: "anulada", total: 10700, descuento: 0, cargo_envio: 0,
    motivo_anulacion: "=HYPERLINK(\"x\")",
    venta_items: [{ renglon: 2, nombre: "Pote de mayonesa", cantidad: 1, precio_unitario: 200, costo_unitario: 150 },
      { renglon: 1, nombre: "Lomito completo", cantidad: 1, precio_unitario: 10500, costo_unitario: 5200 }],
    venta_pagos: [{ medio: "efectivo", importe: 700 }, { medio: "transferencia", importe: 10000 }],
  }];
  const lineas = csvVentas(cajas, ventas).replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lineas.length, 3);
  const [l1, l2] = [lineas[1].split(";"), lineas[2].split(";")];
  assert.equal(l1[5], "Lomito completo");
  assert.equal(l1[4], "Anulada");
  assert.equal(l1[13], "10700");
  assert.equal(l1[14], "700");
  assert.equal(l1[15], "10000");
  assert.ok(l1[17].startsWith("\"'=HYPERLINK"));  // no se ejecuta como fórmula
  assert.equal(l2[5], "Pote de mayonesa");
  assert.equal(l2[13], "");
});

test("planilla de gastos y retiros", () => {
  const movs = [{ caja_id: "c1", tipo: "compra_mercaderia", medio: "efectivo", importe: 6000, descripcion: "Pan", en_gastos_fijos: false,
    creado_en: "2026-10-16T23:30:00Z", estado: "vigente" }];
  const lineas = csvMovimientos(cajas, movs).replace(/^﻿/, "").trim().split("\r\n");
  assert.equal(lineas[1], "1;16/10/2026;20:30;Compra de mercadería;Efectivo;6000;Pan;No;Vigente;");
});

test("ventas por día para el gráfico: todos los días hasta hoy, sumando dos cajas del mismo día", () => {
  const caja = (fecha, ventas, resultado) => ({ fecha_operacion: fecha, resumen: { ventas_netas: ventas, resultado_estimado: resultado } });
  const dias = ventasPorDia([caja("2026-10-02", 1000.1, 300), caja("2026-10-02", 500.2, -100), caja("2026-10-04", 800, 200)], "2026-10-01", "2026-10-31", "2026-10-05");
  assert.deepEqual(dias.map((x) => x.fecha), ["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]);
  assert.deepEqual(dias[1], { fecha: "2026-10-02", ventas: 1500.3, resultado: 200 });
  assert.equal(dias[2].ventas, 0);
  // Período largo: solo los días con caja.
  const largo = ventasPorDia([caja("2026-01-10", 1, 1), caja("2026-06-01", 2, 2)], "2026-01-01", "2026-06-30", "2026-10-05");
  assert.deepEqual(largo.map((x) => x.fecha), ["2026-01-10", "2026-06-01"]);
});
