// Dónde se guardan los datos de la calculadora.
// Las dos variantes tienen la misma forma: subscribe(col, cb), set(col, id, body), del(col, id).
// col es "insumos", "productos", "gastos" o "ajustes"; body es el objeto tal cual lo usa la calculadora.

export function localStore() {
  const key = "costos-demo-v1";
  let data = {};
  try { data = JSON.parse(localStorage.getItem(key)) || data; } catch (e) {}
  const subs = {};
  const save = () => { try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {} };
  const emit = (col) => subs[col] && subs[col](Object.assign({}, data[col]));
  return {
    mode: "local",
    subscribe(col, cb) { data[col] = data[col] || {}; subs[col] = cb; emit(col); },
    async set(col, id, body) { data[col][id] = body; save(); emit(col); },
    async del(col, id) { delete data[col][id]; save(); emit(col); },
  };
}

// Cada fila es { negocio_id, id, datos }; la seguridad (quién ve qué) la pone Supabase con RLS.
export function supabaseStore(supabase, negocioId) {
  const cache = {};
  const subs = {};
  const emit = (col) => subs[col] && subs[col](Object.assign({}, cache[col]));
  const store = {
    mode: "supabase",
    onError: () => {},
    onSaved: () => {},
    async subscribe(col, cb) {
      subs[col] = cb;
      const { data, error } = await supabase.from(col).select("id, datos").eq("negocio_id", negocioId);
      cache[col] = {};
      if (error) { store.onError("No se pudieron leer los datos. Recargá la página."); return; }
      data.forEach((r) => { cache[col][r.id] = r.datos; });
      emit(col);
    },
    async set(col, id, body) {
      cache[col] = cache[col] || {};
      cache[col][id] = body;
      emit(col);
      const { error } = await supabase.from(col).upsert({ negocio_id: negocioId, id, datos: body });
      if (error) store.onError("No se pudo guardar. Revisá tu conexión y probá de nuevo.");
      else store.onSaved();
    },
    async del(col, id) {
      if (cache[col]) delete cache[col][id];
      emit(col);
      const { error } = await supabase.from(col).delete().eq("negocio_id", negocioId).eq("id", id);
      if (error) store.onError("No se pudo borrar. Revisá tu conexión y probá de nuevo.");
    },
  };
  return store;
}

// ---------- Caja ----------
// Las dos variantes tienen la misma forma: cargar(), abrirCaja(id, saldo), confirmarVenta(venta).
// "venta" es { id, items: [{ producto, opcion, cantidad, costo_unitario, packaging_unitario, costo_incompleto, faltas }],
//              pagos: [{ medio, importe }], descuento, motivo, cargoEnvio, conEnvio }.
// confirmarVenta devuelve { id, numero, total, duplicada }.

// Errores que no son de la base (sin internet, servidor caído): no sabemos si la venta llegó.
export class SinRespuesta extends Error {}

export function supabaseCaja(supabase) {
  const fallo = (error) => {
    // Los mensajes de las funciones de la base ya vienen en castellano y listos para mostrar.
    if (error && error.code === "P0001") return new Error(error.message);
    if (!error || !error.code || /fetch|network|Failed/i.test(error.message || "")) return new SinRespuesta("No hubo respuesta del servidor.");
    return new Error("No se pudo guardar (" + (error.message || error.code) + ").");
  };
  const rpc = async (fn, args) => {
    let r;
    try { r = await supabase.rpc(fn, args); } catch (e) { throw new SinRespuesta("No hubo respuesta del servidor."); }
    if (r.error) throw fallo(r.error);
    return r.data;
  };
  return {
    mode: "supabase",
    // La última caja (abierta o cerrada) y, si está abierta, sus ventas.
    async cargar() {
      const c = await supabase.from("cajas").select("*").order("numero", { ascending: false }).limit(1);
      if (c.error) throw fallo(c.error);
      const caja = c.data[0] || null;
      let ventas = [];
      if (caja && caja.estado === "abierta") {
        const v = await supabase.from("ventas")
          .select("id, numero, creada_en, estado, total, descuento, cargo_envio, con_envio, costo_incompleto, venta_items(renglon, nombre, cantidad), venta_pagos(medio, importe)")
          .eq("caja_id", caja.id).order("numero", { ascending: false });
        if (v.error) throw fallo(v.error);
        ventas = v.data;
      }
      return { caja, ventas };
    },
    abrirCaja: (id, saldo) => rpc("abrir_caja", { p_id: id, p_saldo_inicial: saldo }),
    confirmarVenta: (v) => rpc("confirmar_venta", {
      p_id: v.id, p_items: v.items, p_pagos: v.pagos, p_descuento: v.descuento, p_motivo_descuento: v.motivo || null,
      p_cargo_envio: v.cargoEnvio, p_con_envio: v.conEnvio,
    }),
  };
}

// Modo demo: la caja vive en el navegador. Aplica las mismas reglas básicas que caja.sql
// (precio del catálogo, pagos que suman el total, sin duplicar el mismo id) para poder probar la pantalla sin cuenta.
export function localCaja(estado) {
  const key = "caja-demo-v1";
  let db = { cajas: [], ventas: [] };
  try { db = JSON.parse(localStorage.getItem(key)) || db; } catch (e) {}
  const save = () => { try { localStorage.setItem(key, JSON.stringify(db)); } catch (e) {} };
  const abierta = () => db.cajas.find((c) => c.estado === "abierta") || null;
  const cent = (n) => Math.round((Number(n) || 0) * 100);
  return {
    mode: "local",
    async cargar() {
      const caja = db.cajas[db.cajas.length - 1] || null;
      const ventas = caja && caja.estado === "abierta" ? db.ventas.filter((v) => v.caja_id === caja.id).slice().reverse() : [];
      return { caja, ventas };
    },
    async abrirCaja(id, saldo) {
      if (!(Number(saldo) >= 0)) throw new Error("El efectivo inicial no puede ser negativo.");
      if (abierta()) return Object.assign({ ya_estaba: true }, abierta());
      const c = { id, numero: db.cajas.length + 1, estado: "abierta", abierta_en: new Date().toISOString(), saldo_inicial: Number(saldo) };
      db.cajas.push(c); save();
      return Object.assign({ ya_estaba: false }, c);
    },
    async confirmarVenta(v) {
      const ya = db.ventas.find((x) => x.id === v.id);
      if (ya) return { id: ya.id, numero: ya.numero, total: ya.total, duplicada: true };
      const caja = abierta();
      if (!caja) throw new Error("No hay una caja abierta. Abrí la caja para vender.");
      if (!v.items.length) throw new Error("La venta no tiene productos.");
      let bruto = 0;
      const items = v.items.map((it, n) => {
        const p = estado.productos[it.producto];
        if (!p) throw new Error("Un producto de la venta ya no existe en el catálogo. Recargá la página.");
        if (!(Number(p.precioVenta) > 0)) throw new Error(p.nombre + " no tiene precio de venta. Cargalo en Productos.");
        const op = it.opcion ? (p.opciones || []).find((o) => o.id === it.opcion) : null;
        if (it.opcion && !op) throw new Error("La opción elegida para " + p.nombre + " ya no existe. Recargá la página.");
        const precio = cent(p.precioVenta) + cent(op ? op.precioExtra : 0);
        bruto += precio * it.cantidad;
        return { renglon: n + 1, nombre: p.nombre + (op ? " (" + op.nombre + ")" : ""), cantidad: it.cantidad };
      });
      const desc = cent(v.descuento);
      if (desc > bruto) throw new Error("El descuento no puede ser mayor que la venta.");
      if (desc > 0 && !(v.motivo || "").trim()) throw new Error("Escribí el motivo del descuento.");
      const total = bruto - desc + cent(v.cargoEnvio);
      const pagado = v.pagos.reduce((a, p) => a + cent(p.importe), 0);
      if (pagado !== total) throw new Error("Los pagos suman $ " + pagado / 100 + " y la venta es de $ " + total / 100 + ".");
      const venta = {
        id: v.id, caja_id: caja.id, numero: db.ventas.filter((x) => x.caja_id === caja.id).length + 1, creada_en: new Date().toISOString(),
        estado: "confirmada", total: total / 100, descuento: desc / 100, cargo_envio: cent(v.cargoEnvio) / 100, con_envio: !!v.conEnvio,
        costo_incompleto: v.items.some((it) => it.costo_incompleto), venta_items: items, venta_pagos: v.pagos,
      };
      db.ventas.push(venta); save();
      return { id: venta.id, numero: venta.numero, total: venta.total, duplicada: false };
    },
  };
}
