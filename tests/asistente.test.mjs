// Asistente de WhatsApp: horarios, mensajes al cliente y la conversación con la IA (con una IA de mentira).
import test from "node:test";
import assert from "node:assert/strict";
import { estaAbierto, textoHorarios, mensajeCerrado, mensajeEstado, recortar, responder, textoDelMensaje, instrucciones } from "../netlify/lib/asistente.mjs";
import { siguiente } from "../public/pedidos.js";

const VENUTTO = { dias: [4, 5, 6, 0], desde: "21:00", hasta: "01:00" };
// Hora argentina (UTC-3) → Date. 2026-10-22 es jueves.
const ar = (fecha, hora) => new Date(fecha + "T" + hora + ":00-03:00");

test("abierto jueves a domingo de 21 a 01, pasando la medianoche", () => {
  assert.equal(estaAbierto(VENUTTO, ar("2026-10-22", "20:59")), false); // jueves antes de abrir
  assert.equal(estaAbierto(VENUTTO, ar("2026-10-22", "21:00")), true);
  assert.equal(estaAbierto(VENUTTO, ar("2026-10-23", "00:30")), true);  // viernes de madrugada = turno del jueves
  assert.equal(estaAbierto(VENUTTO, ar("2026-10-23", "01:00")), false);
  assert.equal(estaAbierto(VENUTTO, ar("2026-10-26", "00:30")), true);  // lunes de madrugada = turno del domingo
  assert.equal(estaAbierto(VENUTTO, ar("2026-10-26", "21:30")), false); // lunes a la noche
  assert.equal(estaAbierto(VENUTTO, ar("2026-10-22", "00:30")), false); // jueves de madrugada: el miércoles no abre
  assert.equal(estaAbierto({ dias: [1], desde: "11:00", hasta: "15:00" }, ar("2026-10-26", "12:00")), true);
  assert.equal(estaAbierto(null), true);          // sin horarios cargados no se frena a nadie
  assert.equal(estaAbierto({ dias: [] }), true);
});

test("texto de horarios y aviso de cerrado", () => {
  assert.equal(textoHorarios(VENUTTO), "jueves, viernes, sábado y domingo de 21:00 a 01:00");
  assert.equal(textoHorarios({ dias: [0, 1, 2, 3, 4, 5, 6], desde: "21:00", hasta: "01:00" }), "todos los días de 21:00 a 01:00");
  assert.equal(textoHorarios({ dias: [6], desde: "20:00", hasta: "23:00" }), "los sábados de 20:00 a 23:00");
  const t = mensajeCerrado("Venutto Fast Food", { horarios: VENUTTO, aviso: "Desde enero abrimos todos los días" });
  assert.match(t, /estamos cerrados/);
  assert.match(t, /Atendemos jueves, viernes, sábado y domingo de 21:00 a 01:00/);
  assert.match(t, /Desde enero/);
});

test("avisos de estado al cliente", () => {
  const p = { numero: 7, total: 24600, entrega: "delivery", envio: 1000 };
  assert.match(mensajeEstado(p, "aceptado"), /#7.*\$24\.600/);
  assert.match(mensajeEstado(p, "en_camino"), /en camino/);
  assert.match(mensajeEstado({ ...p, entrega: "retiro" }, "en_camino"), /listo para retirar/);
  assert.match(mensajeEstado({ ...p, envio: null }, "aceptado"), /más el envío/);
  assert.match(mensajeEstado(p, "rechazado", "Sin pan"), /Sin pan/);
  assert.equal(mensajeEstado(p, "entregado"), null); // no se manda: cada mensaje cuesta
  assert.deepEqual(siguiente({ estado: "en_preparacion", entrega: "retiro" }), { estado: "en_camino", texto: "Listo para retirar" });
  assert.equal(siguiente({ estado: "entregado" }), null);
});

test("el historial recortado siempre empieza con un mensaje del cliente", () => {
  const h = [
    { role: "user", parts: [{ text: "hola" }] },
    { role: "model", parts: [{ functionCall: { name: "cotizar" } }] },
    { role: "user", parts: [{ functionResponse: { name: "cotizar" } }] },
    { role: "model", parts: [{ text: "son $10" }] },
    { role: "user", parts: [{ text: "dale" }] },
  ];
  assert.equal(recortar(h, 4)[0].parts[0].text, "dale");
  assert.equal(recortar(h, 5).length, 5);
});

const PUBLICO = {
  negocio: { nombre: "Venutto" },
  menu: { pagos: ["efectivo", "transferencia"], envio: 1000, horarios: VENUTTO, alias: "venutto.mp" },
  productos: [
    { id: "lc", nombre: "Lomito completo", precio: 11500, categoria: "Lomitos", disponible: true, opciones: [{ id: "arabe", nombre: "Pan árabe", precio_extra: 300 }] },
    { id: "lp", nombre: "Lomito picante", precio: 10000, categoria: "Lomitos", disponible: false, opciones: [] },
  ],
};

test("las instrucciones tienen el menú con códigos, agotados y reglas de precios", () => {
  const t = instrucciones(PUBLICO, ar("2026-10-22", "22:00"));
  assert.match(t, /\[lc\] Lomito completo — \$11\.500/);
  assert.match(t, /\[arabe\] Pan árabe \(\+\$300\)/);
  assert.match(t, /Lomito picante.*AGOTADO HOY/);
  assert.match(t, /Hoy es jueves, son las 22:00/);
  assert.match(t, /venutto\.mp/);
  assert.match(t, /Nunca inventes/);
});

test("conversación: la IA cotiza, el cliente confirma y el pedido se registra con el total de la base", async () => {
  const llamadas = [];
  // IA de mentira: primero pide cotizar, después contesta; en la segunda vuelta confirma.
  const guion = [
    { parts: [{ functionCall: { name: "cotizar", args: { items: [{ producto: "lc", cantidad: 2 }], entrega: "retiro" } } }] },
    { parts: [{ text: "Son 2 lomitos completos, total $23.000. ¿Confirmamos?" }] },
    { parts: [{ functionCall: { name: "confirmar_pedido", args: { items: [{ producto: "lc", cantidad: 2 }], entrega: "retiro", pago: "efectivo" } } }] },
    { parts: [{ text: "¡Listo! Tu pedido es el #1." }] },
  ];
  const deps = {
    async ia(body) { llamadas.push(body); return guion.shift(); },
    async cotizar(items, entrega) { return { total: 23000, renglones: items, entrega }; },
    async registrar(a) { return { ok: true, numero: 1, total: 23000, args: a }; },
    async derivar() { throw new Error("no debería derivar"); },
  };
  let r = await responder({ publico: PUBLICO, historial: [], mensaje: "[Audio del cliente, transcripto]: quiero dos lomitos completos" }, deps);
  assert.equal(r.texto, "Son 2 lomitos completos, total $23.000. ¿Confirmamos?");
  assert.equal(r.pedido, null);
  assert.equal(r.historial.length, 4); // cliente, pedido de cotizar, resultado, respuesta
  assert.equal(llamadas[1].contents[2].parts[0].functionResponse.response.total, 23000);
  assert.ok(llamadas[0].tools[0].functionDeclarations.some((f) => f.name === "confirmar_pedido"));

  r = await responder({ publico: PUBLICO, historial: r.historial, mensaje: "sí, pago en efectivo" }, deps);
  assert.equal(r.texto, "¡Listo! Tu pedido es el #1.");
  assert.equal(r.pedido.numero, 1);
  assert.equal(r.historial.length, 8);
});

test("conversación: un error de la base vuelve a la IA como texto, y derivar avisa al dueño", async () => {
  const guion = [
    { parts: [{ functionCall: { name: "cotizar", args: { items: [], entrega: "retiro" } } }] },
    { parts: [{ functionCall: { name: "derivar_a_humano", args: { motivo: "Reclamo por un pedido" } } }] },
    { parts: [{ thought: true, text: "pienso" }, { text: "Ya le aviso a alguien del local." }] },
  ];
  let respuestaCotizar, derivado;
  const r = await responder({ publico: PUBLICO, historial: [], mensaje: "me llegó frío" }, {
    async ia(body) {
      const ult = body.contents[body.contents.length - 1].parts[0];
      if (ult.functionResponse && ult.functionResponse.name === "cotizar") respuestaCotizar = ult.functionResponse.response;
      return guion.shift();
    },
    async cotizar() { throw new Error("El pedido está vacío."); },
    async registrar() {},
    async derivar(m) { derivado = m; },
  });
  assert.deepEqual(respuestaCotizar, { error: "El pedido está vacío." });
  assert.equal(derivado, "Reclamo por un pedido");
  assert.equal(r.derivado, "Reclamo por un pedido");
  assert.equal(r.texto, "Ya le aviso a alguien del local."); // sin el "pensamiento" interno
});

test("mensajes de WhatsApp a texto: audio transcripto, ubicación, foto", async () => {
  const tr = async (id, mime) => (id === "a1" && mime === "audio/ogg; codecs=opus" ? "quiero un lomito" : "");
  assert.equal(await textoDelMensaje({ type: "text", text: { body: "hola" } }, tr), "hola");
  assert.equal(await textoDelMensaje({ type: "audio", audio: { id: "a1", mime_type: "audio/ogg; codecs=opus" } }, tr), "[Audio del cliente, transcripto]: quiero un lomito");
  assert.match(await textoDelMensaje({ type: "location", location: { latitude: 1, longitude: 2, address: "Belgrano 100" } }, tr), /ubicación, Belgrano 100/);
  assert.match(await textoDelMensaje({ type: "image", image: {} }, tr), /foto/);
  assert.equal(await textoDelMensaje({ type: "sticker" }, tr), "");
});
