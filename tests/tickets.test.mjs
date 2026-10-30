// Texto del ticket que se manda por WhatsApp (public/tickets-datos.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { textoWhatsApp, linkTicket } from "../public/tickets-datos.js";

const t = {
  numero: 12, envio: 1500, total: 22200, nota: "Sin huevo",
  items: [
    { nombre: "Lomito completo", opcion_nombre: "pan árabe", cantidad: 2, subtotal: 20200 },
    { nombre: "Extra de papas", opcion_nombre: null, cantidad: 1, subtotal: 500 },
  ],
};

test("el mensaje trae el detalle, el envío, el total y el link", () => {
  const link = linkTicket("AbCdEfGhIjKlMnOpQrStUv", "https://calculadoracostosmv.netlify.app");
  assert.equal(link, "https://calculadoracostosmv.netlify.app/t/AbCdEfGhIjKlMnOpQrStUv");
  assert.equal(textoWhatsApp(t, "Venutto", link), [
    "*Venutto · Pedido #12*",
    "2 × Lomito completo (pan árabe) — $ 20.200",
    "1 × Extra de papas — $ 500",
    "Envío — $ 1.500",
    "Nota: Sin huevo",
    "*TOTAL: $ 22.200*",
    "",
    "Para confirmar o pedir un cambio, tocá acá:",
    link,
  ].join("\n"));
});

test("retira en el local y envío sin cargo", () => {
  assert.match(textoWhatsApp(Object.assign({}, t, { envio: null, nota: null }), "", "x"), /^\*Pedido #12\*\n[^]*Retira en el local\n\*TOTAL/);
  assert.match(textoWhatsApp(Object.assign({}, t, { envio: 0 }), "V", "x"), /Envío — sin cargo/);
});
