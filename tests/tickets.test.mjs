// Texto del ticket que se manda por WhatsApp (public/tickets-datos.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { textoWhatsApp, linkTicket } from "../public/tickets-datos.js";

const t = {
  numero: 12, envio: 1500, total: 22200, nota: "Sin huevo",
  items: [
    { producto: "p1", nombre: "Lomito completo", opcion_nombre: "pan árabe", cantidad: 2, subtotal: 20200 },
    { producto: "p6", nombre: "Extra de papas", opcion_nombre: null, cantidad: 1, subtotal: 500 },
  ],
};

test("el mensaje trae el detalle sin 'x', el envío y termina en el total", () => {
  assert.equal(textoWhatsApp(t, "Venutto"), [
    "*Venutto · Pedido #12*",
    "2 Lomitos completos (pan árabe) — $ 20.200",
    "1 Extra de papas — $ 500",
    "Envío — $ 1.500",
    "Nota: Sin huevo",
    "*TOTAL: $ 22.200*",
  ].join("\n"));
});

test("usa el plural cargado en el producto", () => {
  assert.match(textoWhatsApp(Object.assign({}, t, { items: [Object.assign({}, t.items[1], { cantidad: 3 })] }), "V", { p6: { plural: "Extras de papas fritas" } }),
    /^\*V · Pedido #12\*\n3 Extras de papas fritas — /);
});

test("retira en el local y envío sin cargo", () => {
  assert.match(textoWhatsApp(Object.assign({}, t, { envio: null, nota: null }), ""), /^\*Pedido #12\*\n[^]*Retira en el local\n\*TOTAL: \$ 22\.200\*$/);
  assert.match(textoWhatsApp(Object.assign({}, t, { envio: 0 }), "V"), /Envío — sin cargo/);
});

test("link del ticket", () => {
  assert.equal(linkTicket("AbCdEfGhIjKlMnOpQrStUv", "https://x.app"), "https://x.app/t/AbCdEfGhIjKlMnOpQrStUv");
});
