// Fotos de los productos para el menú de pedidos.
// Se achican en el celular antes de subir (lado mayor 900 px, JPG), así el menú carga rápido con datos móviles.

export function achicarFoto(file, lado = 900, calidad = 0.82) {
  return new Promise((resolve, reject) => {
    if (!/^image\//.test(file.type || "")) { reject(new Error("Elegí una imagen (JPG o PNG).")); return; }
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, lado / Math.max(img.width, img.height));
      const c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height); // PNG con transparencia → fondo blanco
      ctx.drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("No se pudo preparar la foto."))), "image/jpeg", calidad);
    };
    img.onerror = () => reject(new Error("No se pudo leer la imagen."));
    img.src = URL.createObjectURL(file);
  });
}

// Con cuenta: Supabase Storage, bucket público "menu-fotos", una carpeta por negocio (reglas en supabase/menu.sql).
// Cada foto nueva tiene otro nombre, así ningún celular se queda con la foto vieja guardada.
export function subirFotoSupabase(supabase, negocioId) {
  return async (file, productoId) => {
    const blob = await achicarFoto(file);
    const ruta = negocioId + "/" + String(productoId).replace(/[^a-z0-9_-]/gi, "") + "-" + Date.now() + ".jpg";
    const { error } = await supabase.storage.from("menu-fotos").upload(ruta, blob, { contentType: "image/jpeg", upsert: false, cacheControl: "31536000" });
    if (error) throw new Error("No se pudo subir la foto. ¿Corriste supabase/menu.sql en Supabase?");
    return supabase.storage.from("menu-fotos").getPublicUrl(ruta).data.publicUrl;
  };
}

// Modo demo: la foto queda en el navegador (el menú público no la ve; es para probar la pantalla).
export async function subirFotoDemo(file) {
  const blob = await achicarFoto(file, 480, 0.7);
  return new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.readAsDataURL(blob); });
}
