// Pruebas de los cálculos de costos (public/costos.js). Correr con: npm test
// Los números esperados están hechos a mano en los comentarios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crearCostos, categoriaDe, ordenarCategorias } from "../public/costos.js";

const cerca = (real, esperado, msg) => assert.ok(Math.abs(real - esperado) < 0.005, `${msg}: dio ${real}, se esperaba ${esperado}`);

const estado = {
  insumos: {
    panf: { nombre: "Pan francés", cantidad: 12, unidad: "u", precio: 6000 },            // $500 c/u
    pana: { nombre: "Pan árabe", cantidad: 10, unidad: "u", precio: 6000 },              // $600 c/u
    carne: { nombre: "Carne", cantidad: 1, unidad: "kg", precio: 18000, rendimiento: 80, merma: 5 }, // 18 / 0,8 / 0,95 = $23,6842 por g
    caja: { nombre: "Caja", cantidad: 100, unidad: "u", precio: 25000, packaging: true },  // $250
    cajag: { nombre: "Caja grande", cantidad: 1, unidad: "u", precio: 400, packaging: true },
    pote: { nombre: "Pote", cantidad: 100, unidad: "u", precio: 5000, packaging: true },   // $50
    huevo: { nombre: "Huevo", cantidad: 30, unidad: "u", precio: 6000 },                 // $200
    aceite: { nombre: "Aceite", cantidad: 5, unidad: "l", precio: 9500 },                // $1,90 por ml
    cheddar: { nombre: "Cheddar", cantidad: 1, unidad: "kg", precio: "" },               // sin precio
  },
  productos: {
    lomito: { nombre: "Lomito", items: [{ insumo: "carne", cantidad: 100 }, { insumo: "panf", cantidad: 1 }, { insumo: "caja", cantidad: 1 }],
      precioVenta: 10000, opciones: [{ id: "arabe", nombre: "pan árabe", reemplaza: "panf", por: "pana", precioExtra: 100 }] },
    hamb: { nombre: "Hamburguesa", items: [{ insumo: "carne", cantidad: 100 }, { insumo: "panf", cantidad: 1 }, { insumo: "caja", cantidad: 1 }] },
    mayo: { nombre: "Mayonesa casera", esPreparacion: true, rinde: 750, rindeUnidad: "g", items: [{ insumo: "huevo", cantidad: 3 }, { insumo: "aceite", cantidad: 700 }] },
    potemayo: { nombre: "Pote de mayonesa", tipo: "extra", items: [{ prep: "mayo", cantidad: 30 }, { insumo: "pote", cantidad: 1 }] },
    promo2: { nombre: "Promo 2 hamburguesas", tipo: "promo", items: [{ producto: "hamb", cantidad: 2, sinPackaging: true }, { insumo: "cajag", cantidad: 1 }] },
    promo3: { nombre: "Promo 3 lomitos", tipo: "promo", items: [{ producto: "lomito", cantidad: 3 }] },
    cheddar: { nombre: "Lomito cheddar", items: [{ insumo: "carne", cantidad: 100 }, { insumo: "cheddar", cantidad: 40 }] },
    vacio: { nombre: "Sin receta", items: [] },
    bucle: { nombre: "Promo que se incluye a sí misma", items: [{ producto: "bucle", cantidad: 1 }] },
  },
  gastos: { g1: { monto: 7000 } },
  ajustes: { general: { unidadesMes: 120 }, delivery: { naftaMes: 20000, pedidosMes: 80 } },
};
const C = crearCostos(estado);
const CARNE_100 = (18000 / 1000 / 0.8 / 0.95) * 100; // 2368,42

test("costo de uso con rendimiento y merma", () => {
  cerca(C.costoUso(estado.insumos.carne), 18 / 0.8 / 0.95, "carne por g");
  cerca(C.costoUso(estado.insumos.panf), 500, "pan por unidad");
  assert.equal(C.costoUso(estado.insumos.cheddar), 0);
});

test("producto simple: insumos + packaging", () => {
  const r = C.costoProducto(estado.productos.lomito);
  cerca(r.total, CARNE_100 + 500 + 250, "lomito");
  cerca(r.packaging, 250, "packaging del lomito");
  assert.deepEqual(r.faltas, []);
});

test("preparación propia dentro de un producto", () => {
  // tanda: 3 huevos ($600) + 700 ml de aceite ($1.330) = $1.930 → $2,5733 por g; 30 g + pote $50
  const r = C.costoProducto(estado.productos.potemayo);
  cerca(r.total, (1930 / 750) * 30 + 50, "pote de mayonesa");
  cerca(r.packaging, 50, "packaging del pote");
});

test("promo con envase compartido: saca la caja de cada hamburguesa", () => {
  const r = C.costoProducto(estado.productos.promo2);
  cerca(r.total, 2 * (CARNE_100 + 500) + 400, "promo 2 hamburguesas");
  cerca(r.packaging, 400, "solo la caja grande");
});

test("promo con caja propia por producto", () => {
  const r = C.costoProducto(estado.productos.promo3);
  cerca(r.total, 3 * (CARNE_100 + 500 + 250), "promo 3 lomitos");
  cerca(r.packaging, 750, "tres cajas");
});

test("si cambia un insumo, cambia la promo", () => {
  const e2 = structuredClone(estado);
  e2.insumos.panf.precio = 7200; // $600 c/u
  cerca(crearCostos(e2).costoProducto(e2.productos.promo3).total, 3 * (CARNE_100 + 600 + 250), "promo con pan más caro");
});

test("opción pan árabe: reemplaza el pan francés", () => {
  cerca(C.costoConOpcion(estado.productos.lomito, "arabe").total, CARNE_100 + 600 + 250, "lomito con pan árabe");
  cerca(C.costoConOpcion(estado.productos.lomito, null).total, CARNE_100 + 500 + 250, "lomito sin opción");
  cerca(C.costoConOpcion(estado.productos.lomito, "no-existe").total, CARNE_100 + 500 + 250, "opción inexistente");
});

test("foto de costo para la venta: centavos y sin gastos fijos", () => {
  const r = C.costoParaVenta("lomito", "arabe");
  assert.equal(r.costo_unitario, 3218.42); // 2368,42 + 600 + 250
  assert.equal(r.packaging_unitario, 250);
  assert.equal(r.costo_incompleto, false);
  assert.deepEqual(r.faltas, []);
});

test("costo incompleto: falta un precio o falta la receta", () => {
  const a = C.costoParaVenta("cheddar");
  assert.equal(a.costo_incompleto, true);
  assert.match(a.faltas[0], /Cheddar/);
  const b = C.costoParaVenta("vacio");
  assert.equal(b.costo_incompleto, true);
  assert.equal(b.costo_unitario, 0);
  const c = C.costoParaVenta("no-existe");
  assert.equal(c.costo_incompleto, true);
});

test("una promo que se incluye a sí misma no cuelga la app", () => {
  const r = C.costoProducto(estado.productos.bucle);
  assert.equal(r.total, 0);
});

test("gastos fijos y delivery", () => {
  cerca(C.fijoPorUnidad(), 7000 / 120, "gasto fijo por unidad");
  assert.equal(C.naftaPorPedido(), 250);
  assert.equal(C.precioSugerido(3118.42, 35, 1000), 5800); // 3118,42 ÷ 0,65 = 4797,57 + 1000 = 5797,57 → $5.800
});

test("una promo cuenta como los productos que lleva (para gastos fijos)", () => {
  assert.equal(C.unidadesDe(estado.productos.lomito), 1);
  assert.equal(C.unidadesDe(estado.productos.promo3), 3);
  assert.equal(C.unidadesDe(estado.productos.promo2), 2);
  assert.equal(C.costoParaVenta("promo3").unidades, 3);
  assert.equal(C.costoParaVenta("lomito").unidades, 1);
  assert.equal(C.unidadesDe(estado.productos.bucle) >= 1, true);
});

test("categorías: opcionales, propias por nombre y después Promos, Extras y Otros", () => {
  assert.equal(categoriaDe({ categoria: "  Lomitos " }), "Lomitos");
  assert.equal(categoriaDe({ tipo: "promo" }), "Promos");
  assert.equal(categoriaDe({ tipo: "extra", categoria: "" }), "Extras");
  assert.equal(categoriaDe({}), "Otros");
  assert.deepEqual(ordenarCategorias(["Otros", "Lomitos", "Promos", "Hamburguesas", "Extras", "Lomitos"]), ["Hamburguesas", "Lomitos", "Promos", "Extras", "Otros"]);
});
