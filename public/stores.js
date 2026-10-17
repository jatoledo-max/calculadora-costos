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
// Las dos variantes tienen la misma forma:
//   cargar()                          → { caja, ventas, movimientos } (la última caja; ventas y movimientos si está abierta)
//   abrirCaja(id, saldo)
//   confirmarVenta(venta)             → { id, numero, total, duplicada }
//   registrarMovimiento(mov)          mov = { id, tipo, medio, importe, descripcion, enGastosFijos }
//   anularMovimiento(id, motivo)
//   anularVenta(id, motivo)           → { id, numero, total, ya_estaba, misma_caja }
//   cerrarCaja(cierre)                cierre = { cajaId, efectivoContado, transferenciasBanco, fondoSiguiente, observaciones }
//   resumen(cajaId)                   → el informe de la caja (si está cerrada, la foto del cierre)
//   listarCajas(desde, hasta)         → cajas con fecha_operacion entre las dos fechas ("2026-10-01"), la más nueva primero,
//                                       cada una con su foto del cierre en "resumen"
//   detalle(cajaIds)                  → { ventas, movimientos } de esas cajas (también las anuladas), con renglones y pagos
// "venta" es { id, items: [{ producto, opcion, cantidad, costo_unitario, packaging_unitario, costo_incompleto, faltas }],
//              pagos: [{ medio, importe }], descuento, motivo, cargoEnvio, conEnvio }.

// Errores que no son de la base (sin internet, servidor caído): no sabemos si la operación llegó.
export class SinRespuesta extends Error {}

const COLS_VENTA = "id, caja_id, numero, creada_en, estado, bruto, total, descuento, motivo_descuento, cargo_envio, con_envio, costo_mercaderia, costo_incompleto, " +
  "anulada_en, motivo_anulacion, anulada_en_caja, venta_items(renglon, nombre, cantidad, precio_unitario, costo_unitario), venta_pagos(medio, importe)";

export function supabaseCaja(supabase) {
  const fallo = (error) => {
    // Los mensajes de las funciones de la base ya vienen en castellano y listos para mostrar.
    if (error && error.code === "P0001") return new Error(error.message);
    if (!error || !error.code || /fetch|network|Failed/i.test(error.message || "")) return new SinRespuesta("No hubo respuesta del servidor.");
    return new Error("No se pudo guardar (" + (error.message || error.code) + ").");
  };
  // Supabase devuelve como mucho 1000 filas por pedido: se piden de a páginas hasta traer todo.
  const todas = async (consulta) => {
    const filas = [];
    for (let desde = 0; ; desde += 1000) {
      let r;
      try { r = await consulta().range(desde, desde + 999); } catch (e) { throw new SinRespuesta("No hubo respuesta del servidor."); }
      if (r.error) throw fallo(r.error);
      filas.push(...r.data);
      if (r.data.length < 1000) return filas;
    }
  };
  const rpc = async (fn, args) => {
    let r;
    try { r = await supabase.rpc(fn, args); } catch (e) { throw new SinRespuesta("No hubo respuesta del servidor."); }
    if (r.error) throw fallo(r.error);
    return r.data;
  };
  return {
    mode: "supabase",
    async cargar() {
      const c = await supabase.from("cajas").select("*").order("numero", { ascending: false }).limit(1);
      if (c.error) throw fallo(c.error);
      const caja = c.data[0] || null;
      let ventas = [], movimientos = [];
      if (caja && caja.estado === "abierta") {
        const [v, m] = await Promise.all([
          supabase.from("ventas").select(COLS_VENTA).eq("caja_id", caja.id).order("numero", { ascending: false }),
          supabase.from("movimientos").select("*").eq("caja_id", caja.id).order("creado_en", { ascending: false }),
        ]);
        if (v.error) throw fallo(v.error);
        if (m.error) throw fallo(m.error);
        ventas = v.data; movimientos = m.data;
      }
      return { caja, ventas, movimientos };
    },
    async listarCajas(desde, hasta) {
      return todas(() => supabase.from("cajas").select("*").gte("fecha_operacion", desde).lte("fecha_operacion", hasta)
        .order("numero", { ascending: false }));
    },
    async detalle(cajaIds) {
      if (!cajaIds.length) return { ventas: [], movimientos: [] };
      const ventas = [], movimientos = [];
      // De a 50 cajas por pedido, para que la dirección no quede demasiado larga.
      for (let i = 0; i < cajaIds.length; i += 50) {
        const ids = cajaIds.slice(i, i + 50);
        const [v, m] = await Promise.all([
          todas(() => supabase.from("ventas").select(COLS_VENTA).in("caja_id", ids).order("creada_en").order("id")),
          todas(() => supabase.from("movimientos").select("*").in("caja_id", ids).order("creado_en").order("id")),
        ]);
        ventas.push(...v); movimientos.push(...m);
      }
      return { ventas, movimientos };
    },
    abrirCaja: (id, saldo) => rpc("abrir_caja", { p_id: id, p_saldo_inicial: saldo }),
    resumen: (cajaId) => rpc("resumen_caja", { p_caja_id: cajaId }),
    confirmarVenta: (v) => rpc("confirmar_venta", {
      p_id: v.id, p_items: v.items, p_pagos: v.pagos, p_descuento: v.descuento, p_motivo_descuento: v.motivo || null,
      p_cargo_envio: v.cargoEnvio, p_con_envio: v.conEnvio,
    }),
    registrarMovimiento: (m) => rpc("registrar_movimiento", {
      p_id: m.id, p_tipo: m.tipo, p_medio: m.medio, p_importe: m.importe, p_descripcion: m.descripcion || null, p_en_gastos_fijos: !!m.enGastosFijos,
    }),
    anularMovimiento: (id, motivo) => rpc("anular_movimiento", { p_id: id, p_motivo: motivo }),
    anularVenta: (id, motivo) => rpc("anular_venta", { p_id: id, p_motivo: motivo }),
    cerrarCaja: (c) => rpc("cerrar_caja", {
      p_caja_id: c.cajaId, p_efectivo_contado: c.efectivoContado, p_transferencias_banco: c.transferenciasBanco,
      p_fondo_siguiente: c.fondoSiguiente, p_observaciones: c.observaciones || null,
    }),
  };
}

// Modo demo: la caja vive en el navegador. Aplica las mismas reglas que caja.sql
// (precio del catálogo, pagos que suman el total, sin duplicar el mismo id, caja cerrada que no cambia)
// para poder probar la pantalla sin cuenta. Las cuentas del informe son las mismas que caja_informe.
export function localCaja(estado) {
  const key = "caja-demo-v1";
  let db = { cajas: [], ventas: [], movimientos: [] };
  try { db = JSON.parse(localStorage.getItem(key)) || db; } catch (e) {}
  db.movimientos = db.movimientos || [];
  const save = () => { try { localStorage.setItem(key, JSON.stringify(db)); } catch (e) {} };
  const abierta = () => db.cajas.find((c) => c.estado === "abierta") || null;
  const cent = (n) => Math.round((Number(n) || 0) * 100);
  const $ = (c) => c / 100;
  // Fecha del día en Argentina ("2026-10-17"), como fecha_operacion en la base.
  const fechaAR = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(d);
  db.cajas.forEach((c) => { if (!c.fecha_operacion) c.fecha_operacion = fechaAR(new Date(c.abierta_en)); });
  const pesos = (c) => (c < 0 ? "− " : "") + "$ " + (Math.abs(c) / 100).toLocaleString("es-AR", { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 });

  function informe(caja) {
    const vs = db.ventas.filter((v) => v.caja_id === caja.id && v.estado === "confirmada");
    const its = vs.flatMap((v) => v.venta_items);
    const mv = db.movimientos.filter((m) => m.caja_id === caja.id && m.estado === "vigente");
    const sum = (arr, f) => arr.reduce((a, x) => a + cent(f(x)), 0);
    const gastos = Object.values(estado.gastos || {}).reduce((a, g) => a + (Number(g.monto) || 0), 0);
    const aj = estado.ajustes || {};
    const um = Number((aj.general || {}).unidadesMes) || 0;
    const fijoU = um > 0 ? cent(gastos / um) : 0;
    const del = aj.delivery || {};
    const naftaP = Number(del.pedidosMes) > 0 ? cent((Number(del.naftaMes) || 0) / Number(del.pedidosMes)) : 0;
    const bruto = sum(vs, (v) => v.bruto), desc = sum(vs, (v) => v.descuento), envios = sum(vs, (v) => v.cargo_envio);
    const cmv = its.reduce((a, i) => a + cent(i.costo_unitario) * i.cantidad, 0);
    const unidades = its.reduce((a, i) => a + (i.unidades || 1) * i.cantidad, 0);
    const pedidos = vs.filter((v) => v.con_envio).length;
    const porProd = {};
    its.forEach((i) => {
      const x = porProd[i.nombre] || (porProd[i.nombre] = { nombre: i.nombre, cantidad: 0, ventas: 0, costo: 0, margen: 0, costo_incompleto: false });
      x.cantidad += i.cantidad; x.ventas += cent(i.precio_unitario) * i.cantidad; x.costo += cent(i.costo_unitario) * i.cantidad;
      x.costo_incompleto = x.costo_incompleto || i.costo_incompleto;
    });
    const porMedio = {};
    vs.forEach((v) => v.venta_pagos.forEach((p) => { porMedio[p.medio] = (porMedio[p.medio] || 0) + cent(p.importe); }));
    const deTipo = (t, f) => mv.filter((m) => m.tipo === t && (!f || f(m))).reduce((a, m) => a + cent(m.importe), 0);
    const flujo = (medio) => mv.filter((m) => m.medio === medio).reduce((a, m) =>
      a + (m.tipo === "aporte" || m.tipo === "ajuste" ? cent(m.importe) : m.tipo === "reserva" ? 0 : -cent(m.importe)), 0);
    const gastosOp = deTipo("gasto", (m) => !m.en_gastos_fijos);
    const netas = bruto - desc;
    const cobEf = porMedio.efectivo || 0, cobTr = porMedio.transferencia || 0;
    const anuladas = db.ventas.filter((v) => v.caja_id === caja.id && v.estado === "anulada");
    const anteriores = db.ventas.filter((v) => v.anulada_en_caja === caja.id && v.caja_id !== caja.id);
    const oblig = (((aj.obligaciones || {}).items) || []).filter((o) => /^\d{1,10}(\.\d+)?$/.test(String(o.monto)) && cent(o.monto) > 0)
      .map((o) => ({ nombre: String(o.nombre || "").slice(0, 80), monto: $(cent(o.monto)), vence: /^\d{4}-\d{2}-\d{2}$/.test(o.vence || "") ? o.vence : null }));
    return {
      caja: caja.id, numero: caja.numero, fecha_operacion: caja.fecha_operacion, estado: caja.estado, abierta_en: caja.abierta_en, saldo_inicial: caja.saldo_inicial, ventas: vs.length,
      ventas_brutas: $(bruto), descuentos: $(desc), ventas_netas: $(netas), envios_cobrados: $(envios), total_cobrado: $(sum(vs, (v) => v.total)),
      costo_mercaderia: $(cmv), packaging: $(its.reduce((a, i) => a + cent(i.packaging_unitario) * i.cantidad, 0)),
      margen_bruto: $(netas - cmv), margen_pct: netas > 0 ? Math.round(((netas - cmv) * 1000) / netas) / 10 : null,
      envio_incluido_en_precios: $(its.reduce((a, i) => a + cent(i.envio_incluido_unitario) * i.cantidad, 0)),
      unidades, gasto_fijo_por_unidad: $(fijoU), gastos_fijos_estimados: $(fijoU * unidades),
      pedidos_con_envio: pedidos, nafta_por_pedido: $(naftaP), nafta_estimada: $(naftaP * pedidos),
      gastos_operativos: $(gastosOp), gastos_en_fijos: $(deTipo("gasto", (m) => m.en_gastos_fijos)),
      resultado_estimado: $(netas - cmv + envios - gastosOp - fijoU * unidades - naftaP * pedidos),
      compras_mercaderia: $(deTipo("compra_mercaderia")), aportes: $(deTipo("aporte")), retiros: $(deTipo("retiro")), ajustes: $(deTipo("ajuste")),
      cobrado_efectivo: $(cobEf), movimientos_efectivo: $(flujo("efectivo")), efectivo_esperado: $(cent(caja.saldo_inicial) + cobEf + flujo("efectivo")),
      cobrado_transferencia: $(cobTr), movimientos_transferencia: $(flujo("transferencia")), transferencias_esperadas: $(cobTr + flujo("transferencia")),
      reserva_sugerida: $(cmv), reserva_apartada: $(deTipo("reserva")),
      ventas_costo_incompleto: vs.filter((v) => v.costo_incompleto).length,
      productos_costo_incompleto: [...new Set(its.filter((i) => i.costo_incompleto).map((i) => i.nombre))],
      por_producto: Object.values(porProd).map((x) => Object.assign(x, { ventas: $(x.ventas), costo: $(x.costo), margen: $(x.ventas - x.costo) })).sort((a, b) => b.ventas - a.ventas),
      por_medio: Object.fromEntries(Object.entries(porMedio).map(([k, v]) => [k, $(v)])),
      anuladas: anuladas.length, anuladas_total: $(sum(anuladas, (v) => v.total)),
      anulaciones_anteriores: anteriores.map((v) => ({ caja: (db.cajas.find((c) => c.id === v.caja_id) || {}).numero, venta: v.numero, total: v.total, motivo: v.motivo_anulacion })),
      anulaciones_anteriores_total: $(sum(anteriores, (v) => v.total)),
      obligaciones: oblig, obligaciones_pendientes: $(oblig.reduce((a, o) => a + cent(o.monto), 0)),
    };
  }

  return {
    mode: "local",
    async cargar() {
      const caja = db.cajas[db.cajas.length - 1] || null;
      const abiertaYa = caja && caja.estado === "abierta";
      const ventas = abiertaYa ? db.ventas.filter((v) => v.caja_id === caja.id).slice().reverse() : [];
      const movimientos = abiertaYa ? db.movimientos.filter((m) => m.caja_id === caja.id).slice().reverse() : [];
      return { caja, ventas, movimientos };
    },
    async abrirCaja(id, saldo) {
      if (!(Number(saldo) >= 0)) throw new Error("El efectivo inicial no puede ser negativo.");
      if (abierta()) return Object.assign({ ya_estaba: true }, abierta());
      const ahora = new Date();
      const c = { id, numero: db.cajas.length + 1, fecha_operacion: fechaAR(ahora), estado: "abierta", abierta_en: ahora.toISOString(), saldo_inicial: Number(saldo) };
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
        return { renglon: n + 1, nombre: p.nombre + (op ? " (" + op.nombre + ")" : ""), cantidad: it.cantidad, precio_unitario: precio / 100,
          costo_unitario: it.costo_unitario, packaging_unitario: it.packaging_unitario || 0, costo_incompleto: !!it.costo_incompleto,
          envio_incluido_unitario: Math.max(Number(p.envioIncluido) || 0, 0), unidades: it.unidades || 1 };
      });
      const desc = cent(v.descuento);
      if (desc > bruto) throw new Error("El descuento no puede ser mayor que la venta.");
      if (desc > 0 && !(v.motivo || "").trim()) throw new Error("Escribí el motivo del descuento.");
      const total = bruto - desc + cent(v.cargoEnvio);
      const pagado = v.pagos.reduce((a, p) => a + cent(p.importe), 0);
      if (pagado !== total) throw new Error("Los pagos suman " + pesos(pagado) + " y la venta es de " + pesos(total) + ".");
      const venta = {
        id: v.id, caja_id: caja.id, numero: db.ventas.filter((x) => x.caja_id === caja.id).length + 1, creada_en: new Date().toISOString(),
        estado: "confirmada", bruto: bruto / 100, total: total / 100, descuento: desc / 100, cargo_envio: cent(v.cargoEnvio) / 100, con_envio: !!v.conEnvio,
        costo_incompleto: v.items.some((it) => it.costo_incompleto), venta_items: items, venta_pagos: v.pagos,
      };
      db.ventas.push(venta); save();
      return { id: venta.id, numero: venta.numero, total: venta.total, duplicada: false };
    },
    async registrarMovimiento(m) {
      const ya = db.movimientos.find((x) => x.id === m.id);
      if (ya) return Object.assign({ duplicado: true }, ya);
      const caja = abierta();
      if (!caja) throw new Error("No hay una caja abierta.");
      const tipos = ["gasto", "compra_mercaderia", "aporte", "retiro", "reserva", "ajuste"];
      if (!tipos.includes(m.tipo)) throw new Error("Tipo de movimiento inválido.");
      if (!["efectivo", "transferencia"].includes(m.medio)) throw new Error("Medio de pago no habilitado: " + m.medio + ".");
      const imp = cent(m.importe);
      if (!imp || (m.tipo !== "ajuste" && imp < 0)) throw new Error("El importe tiene que ser mayor a $ 0.");
      const desc = (m.descripcion || "").trim();
      if (!desc && (m.tipo === "gasto" || m.tipo === "compra_mercaderia")) throw new Error("Escribí qué pagaste.");
      if (!desc && m.tipo === "ajuste") throw new Error("Escribí el motivo del ajuste.");
      if (m.medio === "efectivo" && (["gasto", "compra_mercaderia", "retiro"].includes(m.tipo) || (m.tipo === "ajuste" && imp < 0))) {
        const esperado = cent(informe(caja).efectivo_esperado);
        if (Math.abs(imp) > esperado) throw new Error("En la caja debería haber " + pesos(esperado) + " en efectivo: no alcanza para sacar " + pesos(Math.abs(imp)) + ". Si contaste más plata, cargá primero un ajuste o un aporte.");
      }
      const mov = { id: m.id, caja_id: caja.id, tipo: m.tipo, medio: m.medio, importe: imp / 100, descripcion: desc || null,
        en_gastos_fijos: m.tipo === "gasto" && !!m.enGastosFijos, creado_en: new Date().toISOString(), estado: "vigente" };
      db.movimientos.push(mov); save();
      return Object.assign({ duplicado: false }, mov);
    },
    async anularMovimiento(id, motivo) {
      const m = db.movimientos.find((x) => x.id === id);
      if (!m) throw new Error("No se encontró el movimiento.");
      if (m.estado === "anulado") return Object.assign({ ya_estaba: true }, m);
      if ((db.cajas.find((c) => c.id === m.caja_id) || {}).estado !== "abierta") throw new Error("La caja de ese movimiento ya está cerrada: no se puede cambiar.");
      if (!(motivo || "").trim()) throw new Error("Escribí el motivo de la anulación.");
      Object.assign(m, { estado: "anulado", anulado_en: new Date().toISOString(), motivo_anulacion: motivo.trim() }); save();
      return Object.assign({ ya_estaba: false }, m);
    },
    async anularVenta(id, motivo) {
      const v = db.ventas.find((x) => x.id === id);
      if (!v) throw new Error("No se encontró la venta.");
      const res = (ya) => ({ id: v.id, numero: v.numero, total: v.total, ya_estaba: ya, misma_caja: v.caja_id === v.anulada_en_caja });
      if (v.estado === "anulada") return res(true);
      if (!(motivo || "").trim()) throw new Error("Escribí el motivo de la anulación.");
      const caja = abierta();
      if (!caja) throw new Error("Abrí la caja para anular: la anulación queda registrada en la caja abierta.");
      Object.assign(v, { estado: "anulada", anulada_en: new Date().toISOString(), motivo_anulacion: motivo.trim(), anulada_en_caja: caja.id }); save();
      return res(false);
    },
    async cerrarCaja(c) {
      const caja = db.cajas.find((x) => x.id === c.cajaId);
      if (!caja) throw new Error("No se encontró la caja.");
      if (caja.estado === "cerrada") return Object.assign({}, caja.resumen, { ya_estaba: true });
      const contado = c.efectivoContado == null || c.efectivoContado === "" ? null : cent(c.efectivoContado);
      const banco = c.transferenciasBanco == null || c.transferenciasBanco === "" ? null : cent(c.transferenciasBanco);
      const fondo = cent(c.fondoSiguiente);
      const obs = (c.observaciones || "").trim() || null;
      if (contado == null || contado < 0) throw new Error("Poné el efectivo que contaste (puede ser 0).");
      if (banco != null && banco < 0) throw new Error("Lo que ves en el banco no puede ser negativo.");
      if (fondo < 0) throw new Error("El fondo para mañana no puede ser negativo.");
      if (fondo > contado) throw new Error("El fondo para mañana no puede ser más que el efectivo contado.");
      const r = informe(caja);
      const esperado = cent(r.efectivo_esperado), transf = cent(r.transferencias_esperadas);
      const dif = contado - esperado, difTr = banco == null ? null : banco - transf;
      if ((dif || difTr) && !obs) {
        throw new Error("Hay una diferencia de " + pesos(dif) + " en efectivo" + (difTr ? " y de " + pesos(difTr) + " en transferencias" : "") + ". Escribí una observación antes de cerrar.");
      }
      Object.assign(r, {
        estado: "cerrada", cerrada_en: new Date().toISOString(), efectivo_contado: $(contado), diferencia_efectivo: $(dif),
        transferencias_banco: banco == null ? null : $(banco), diferencia_transferencias: difTr == null ? null : $(difTr),
        fondo_siguiente: $(fondo), observaciones: obs,
        disponible_estimado: $(contado + (banco == null ? transf : banco) - fondo - cent(r.reserva_apartada) - cent(r.obligaciones_pendientes)),
      });
      // Las mismas columnas que la tabla cajas en la base.
      Object.assign(caja, { estado: "cerrada", cerrada_en: r.cerrada_en, efectivo_esperado: r.efectivo_esperado, efectivo_contado: r.efectivo_contado,
        diferencia_efectivo: r.diferencia_efectivo, transferencias_banco: r.transferencias_banco, diferencia_transferencias: r.diferencia_transferencias,
        fondo_siguiente: r.fondo_siguiente, observaciones: r.observaciones, resumen: r });
      save();
      return Object.assign({ ya_estaba: false }, r);
    },
    async listarCajas(desde, hasta) {
      return db.cajas.filter((c) => c.fecha_operacion >= desde && c.fecha_operacion <= hasta).slice().reverse();
    },
    async detalle(cajaIds) {
      const en = (id) => cajaIds.includes(id);
      return { ventas: db.ventas.filter((v) => en(v.caja_id)), movimientos: db.movimientos.filter((m) => en(m.caja_id)) };
    },
    async resumen(cajaId) {
      const caja = db.cajas.find((c) => c.id === cajaId);
      if (!caja) throw new Error("No se encontró la caja.");
      return caja.estado === "cerrada" && caja.resumen ? caja.resumen : informe(caja);
    },
  };
}
