// Dónde se guardan los datos de la calculadora.
// Las dos variantes tienen la misma forma: subscribe(col, cb), set(col, id, body), del(col, id).
// col es "insumos" o "productos"; body es el objeto tal cual lo usa la calculadora.

export function localStore() {
  const key = "costos-demo-v1";
  let data = { insumos: {}, productos: {} };
  try { data = JSON.parse(localStorage.getItem(key)) || data; } catch (e) {}
  const subs = {};
  const save = () => { try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {} };
  const emit = (col) => subs[col] && subs[col](Object.assign({}, data[col]));
  return {
    mode: "local",
    subscribe(col, cb) { subs[col] = cb; emit(col); },
    async set(col, id, body) { data[col][id] = body; save(); emit(col); },
    async del(col, id) { delete data[col][id]; save(); emit(col); },
  };
}

// Cada fila es { negocio_id, id, datos }; la seguridad (quién ve qué) la pone Supabase con RLS.
export function supabaseStore(supabase, negocioId) {
  const cache = { insumos: {}, productos: {} };
  const subs = {};
  const emit = (col) => subs[col] && subs[col](Object.assign({}, cache[col]));
  const store = {
    mode: "supabase",
    onError: () => {},
    onSaved: () => {},
    async subscribe(col, cb) {
      subs[col] = cb;
      const { data, error } = await supabase.from(col).select("id, datos").eq("negocio_id", negocioId);
      if (error) { store.onError("No se pudieron leer los datos. Recargá la página."); return; }
      cache[col] = {};
      data.forEach((r) => { cache[col][r.id] = r.datos; });
      emit(col);
    },
    async set(col, id, body) {
      cache[col][id] = body;
      emit(col);
      const { error } = await supabase.from(col).upsert({ negocio_id: negocioId, id, datos: body });
      if (error) store.onError("No se pudo guardar. Revisá tu conexión y probá de nuevo.");
      else store.onSaved();
    },
    async del(col, id) {
      delete cache[col][id];
      emit(col);
      const { error } = await supabase.from(col).delete().eq("negocio_id", negocioId).eq("id", id);
      if (error) store.onError("No se pudo borrar. Revisá tu conexión y probá de nuevo.");
    },
  };
  return store;
}
