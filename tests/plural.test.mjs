import { test } from "node:test";
import assert from "node:assert/strict";
import { pluralSugerido, conCantidad } from "../public/plural.js";

test("singular y plural de los productos de Venutto", () => {
  assert.equal(conCantidad(1, "Hamburguesa completa"), "1 Hamburguesa completa");
  assert.equal(conCantidad(2, "Hamburguesa completa"), "2 Hamburguesas completas");
  assert.equal(conCantidad(1, "Lomito completo"), "1 Lomito completo");
  assert.equal(conCantidad(3, "Lomito completo"), "3 Lomitos completos");
  assert.equal(conCantidad(1, "Porción de papas con cheddar M"), "1 Porción de papas con cheddar M");
  assert.equal(conCantidad(2, "Porción de papas con cheddar M"), "2 Porciones de papas con cheddar M");
  assert.equal(conCantidad(1, "Potecito de mayonesa"), "1 Potecito de mayonesa");
  assert.equal(conCantidad(2, "Potecito de mayonesa"), "2 Potecitos de mayonesa");
});

test("el plural escrito en la ficha manda sobre la sugerencia", () => {
  assert.equal(conCantidad(2, "Promo 2 completas", "Promos de 2 completas"), "2 Promos de 2 completas");
  assert.equal(conCantidad(1, "Promo 2 completas", "Promos de 2 completas"), "1 Promo 2 completas");
  assert.equal(conCantidad(2, "Lomito completo", "  "), "2 Lomitos completos");
});

test("sugerencias: preposiciones, mayúsculas, irregulares y palabras que no cambian", () => {
  assert.equal(pluralSugerido("Lomito a caballo"), "Lomitos a caballo");
  assert.equal(pluralSugerido("Burger Doble Cheddar"), "Burgers Dobles Cheddar");
  assert.equal(pluralSugerido("Sándwich de milanesa"), "Sándwiches de milanesa");
  assert.equal(pluralSugerido("Papas con Cheddar XL"), "Papas con Cheddar XL");
  assert.equal(pluralSugerido("Pan árabe"), "Panes árabes");
  assert.equal(pluralSugerido("Extra de papas"), "Extras de papas");
  assert.equal(pluralSugerido("Milanesa Simple"), "Milanesas Simples");
  assert.equal(pluralSugerido(""), "");
  assert.ok(!/\bx\b|×/i.test(conCantidad(5, "Lomito completo")));
});
