// Datos de ejemplo para probar la caja en modo demo (precios inventados).
module.exports = {
  insumos: {
    i1: { nombre: "Lomo", cantidad: 1, unidad: "kg", precio: 18000, rendimiento: 80, merma: 5 },
    i2: { nombre: "Pan francés", cantidad: 12, unidad: "u", precio: 6000 },
    i10: { nombre: "Pan árabe", cantidad: 10, unidad: "u", precio: 6000 },
    i5: { nombre: "Huevo", cantidad: 30, unidad: "u", precio: 6000 },
    i7: { nombre: "Caja de lomito", cantidad: 100, unidad: "u", precio: 25000, packaging: true },
    i8: { nombre: "Aceite girasol", cantidad: 5, unidad: "l", precio: 9500 },
    i9: { nombre: "Papa", cantidad: 1, unidad: "kg", precio: 900, rendimiento: 85 },
    i11: { nombre: "Pote", cantidad: 100, unidad: "u", precio: 5000, packaging: true },
  },
  productos: {
    p1: { nombre: "Lomito completo", tipo: "producto", categoria: "Lomitos", precioVenta: 10000, envioIncluido: 1000, margen: 35,
      items: [{ insumo: "i1", cantidad: 180 }, { insumo: "i2", cantidad: 1 }, { insumo: "i5", cantidad: 1 }, { insumo: "i9", cantidad: 250 }, { insumo: "i7", cantidad: 1 }],
      opciones: [{ id: "arabe", nombre: "Pan árabe", reemplaza: "i2", por: "i10", precioExtra: 100 }] },
    p2: { nombre: "Lomito simple", categoria: "Lomitos", precioVenta: 8000, items: [{ insumo: "i1", cantidad: 180 }, { insumo: "i2", cantidad: 1 }, { insumo: "i7", cantidad: 1 }] },
    p3: { nombre: "Promo 3 lomitos", tipo: "promo", precioVenta: 27000, envioIncluido: 1000, items: [{ producto: "p1", cantidad: 3 }] },
    p4: { nombre: "Hamburguesa completa", categoria: "Hamburguesas", items: [], precioVenta: null },
    p5: { nombre: "Pote de mayonesa", tipo: "extra", precioVenta: 500, items: [{ prep: "p9", cantidad: 30 }, { insumo: "i11", cantidad: 1 }] },
    p6: { nombre: "Extra de papas", tipo: "extra", precioVenta: 2000, items: [] },
    p9: { nombre: "Mayonesa casera", esPreparacion: true, rinde: 750, rindeUnidad: "g", items: [{ insumo: "i5", cantidad: 3 }, { insumo: "i8", cantidad: 700 }] },
  },
  gastos: { g1: { nombre: "Limpieza", monto: 7000 } },
  ajustes: { general: { unidadesMes: 120 }, delivery: { naftaMes: 20000, pedidosMes: 80, cobroEnvio: 0 } },
};
