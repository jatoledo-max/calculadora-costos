// Datos públicos de configuración. La "anon key" de Supabase está pensada para ir en el navegador:
// la seguridad la ponen las reglas (RLS) de supabase/schema.sql.
// Si SUPABASE_URL queda vacío, la app arranca en modo demo (sin usuarios, datos en el navegador).
export const CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  PRECIO_MENSUAL_TEXTO: "$ 15.000", // solo para mostrar; el monto real se cobra desde la función (MP_PRECIO_MENSUAL)
};
