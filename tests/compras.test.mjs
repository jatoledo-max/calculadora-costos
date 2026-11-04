// Cuentas de la pestaña Compras (public/compras-datos.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { saldoCompras, precioReferencia, cantidadDe, fmtCantidad, actualizarRefs, loDeSiempre, resumen, errorCompra, hoyLocal, rangoMes, mesCorrido, clave } from "../public/compras-datos.js";

const insumos = { i1: { nombre: "Lomo", cantidad: 6, unidad: "u", precio: 123000 }, i2: { nombre: "Queso tybo", cantidad: 1, unidad: "kg", precio: 9000 } };

test("Carnicería › nalga › $21.000 con el último precio ($12.000 el kg) = 1,75 kg", () => {
  const refs = { nalga: { nombre: "Nalga", categoria: "Carnicería", precio: 12000, unidad: "kg", veces: 3 } };
  const ref = precioReferencia("  NALGA ", refs, insumos);
  assert.deepEqual(ref, { precio: 12000, unidad: "kg", fuente: "compra" });
  const c = cantidadDe(21000, "", "kg", ref);
  assert.deepEqual(c, { cantidad: 1.75, unidad: "kg", estimada: true });
  assert.equal(fmtCantidad(c.cantidad, c.unidad), "1,75 kg");
});

test("si nunca la compraste usa el precio de Insumos", () => {
  assert.deepEqual(precioReferencia("lomo", {}, insumos), { precio: 20500, unidad: "u", fuente: "insumo" });
  assert.deepEqual(precioReferencia("queso", {}, insumos), { precio: 9000, unidad: "kg", fuente: "insumo" });
  assert.equal(precioReferencia("folex", {}, insumos), null);
  assert.equal(cantidadDe(5000, "", "kg", null), null);
});

test("el peso exacto gana y se pasa a kg", () => {
  assert.deepEqual(cantidadDe(21000, "1800", "g", { precio: 12000, unidad: "kg" }), { cantidad: 1.8, unidad: "kg", estimada: false });
  assert.equal(fmtCantidad(0.4, "kg"), "400 g");
  assert.equal(fmtCantidad(6, "u"), "6 u");
});

test("aprende el precio nuevo solo con el peso exacto", () => {
  let refs = actualizarRefs({}, { descripcion: "Nalga", categoria: "Carnicería", importe: 21600, cantidad: 1.8, unidad: "kg", estimada: false, fecha: "2026-11-01" });
  assert.equal(refs.nalga.precio, 12000);
  refs = actualizarRefs(refs, { descripcion: "nalga", categoria: "Carnicería", importe: 30000, cantidad: 2.5, unidad: "kg", estimada: true, fecha: "2026-11-02" });
  assert.equal(refs.nalga.precio, 12000);
  assert.equal(refs.nalga.veces, 2);
  refs = actualizarRefs(refs, { descripcion: "Lechuga", categoria: "Verdulería", importe: 4000, cantidad: null, unidad: null, estimada: false, fecha: "2026-11-02" });
  assert.equal(refs.lechuga.precio, undefined);
  assert.deepEqual(loDeSiempre(refs, "Carnicería"), ["nalga"]);
  assert.deepEqual(loDeSiempre(refs, "Verdulería"), ["Lechuga"]);
});

test("resumen por categoría, de mayor a menor, sin errores de decimales", () => {
  const r = resumen([
    { fecha: "2026-11-01", categoria: "Verdulería", importe: 0.1 },
    { fecha: "2026-11-01", categoria: "Verdulería", importe: 0.2 },
    { fecha: "2026-11-02", categoria: "Carnicería", importe: 21000 },
  ]);
  assert.equal(r.total, 21000.3);
  assert.equal(r.dias, 2);
  assert.deepEqual(r.porCategoria.map((g) => [g.categoria, g.total]), [["Carnicería", 21000], ["Verdulería", 0.3]]);
});

test("validación y fechas", () => {
  const ok = { categoria: "Otros", descripcion: "Gas", importe: 100, fecha: "2026-11-02" };
  assert.equal(errorCompra(ok), null);
  assert.match(errorCompra(Object.assign({}, ok, { categoria: null })), /categoría/);
  assert.match(errorCompra(Object.assign({}, ok, { descripcion: " " })), /compraste/);
  assert.match(errorCompra(Object.assign({}, ok, { importe: 0 })), /pagaste/);
  assert.equal(hoyLocal(new Date(2026, 10, 2, 23, 30)), "2026-11-02");
  assert.deepEqual(rangoMes("2026-02"), { desde: "2026-02-01", hasta: "2026-02-28", dias: 28 });
  assert.equal(mesCorrido("2026-01", -1), "2025-12");
  assert.equal(clave("Carnicería  Ñandú"), "carniceria nandu");
});

test("lo que queda para compras se suma de un cierre al otro", () => {
  const cajas = [
    { estado: "cerrada", resumen: { disponible_estimado: 40000, resultado_estimado: 10000 } },
    { estado: "cerrada", resumen: { disponible_estimado: 30000, resultado_estimado: -2000 } },   // pérdida: no resta ganancia
    { estado: "abierta", resumen: null },
  ];
  const compras = [{ importe: 15000, en_caja: false }, { importe: 5000, en_caja: true }];   // la de la caja ya bajó el disponible
  assert.deepEqual(saldoCompras(cajas, compras), { cierres: 2, disponible: 70000, ganancia: 10000, compras: 15000, saldo: 45000 });
  assert.equal(saldoCompras([], []).cierres, 0);
});
