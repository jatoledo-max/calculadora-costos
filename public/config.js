// Datos públicos de configuración. La "anon key" de Supabase está pensada para ir en el navegador:
// la seguridad la ponen las reglas (RLS) de supabase/schema.sql.
// Si SUPABASE_URL queda vacío, la app arranca en modo demo (sin usuarios, datos en el navegador).
export const CONFIG = {
  SUPABASE_URL: "https://trroercvimupqlpbvndx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRycm9lcmN2aW11cHFscGJ2bmR4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5MjAzMDcsImV4cCI6MjEwNzQ5NjMwN30.At6SIQprAcsXaHI4zYGC9o4uD4lLgnoJEELfJ4vGC6g",
  PRECIO_MENSUAL_TEXTO: "$ 20.000", // solo para mostrar; el monto real se cobra desde la función (MP_PRECIO_MENSUAL)
  // Contacto y titular: aparecen en el botón de ayuda y en Términos, Privacidad y Arrepentimiento.
  SOPORTE_WHATSAPP: "5493855702807", // con código de país, sin + ni espacios
  SOPORTE_EMAIL: "",
  TITULAR: "", // nombre y apellido (o razón social) de quien vende el servicio
  CUIT: "",
};
