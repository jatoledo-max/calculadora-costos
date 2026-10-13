# CalculadoraDeGananciasMV

App web para que rotiserías y negocios de comida sepan cuánto les cuesta cada producto y a cuánto venderlo.
Cada negocio entra con su cuenta, ve solo sus datos y usa su propio logo y color.
Tiene 14 días de prueba gratis y después se cobra una suscripción mensual con Mercado Pago.

## Cómo está armada

- `public/`: la app (HTML, CSS y JavaScript, sin paso de compilación). Netlify la sirve tal cual.
  - `calculadora.js`: insumos, productos, preparaciones propias y precio sugerido.
  - `app.js`: ingreso, alta del negocio, marca propia y bloqueo cuando no hay suscripción.
  - `config.js`: URL y clave pública de Supabase. Si quedan vacías, la app abre en **modo demo** (datos en el navegador).
- `supabase/schema.sql`: tablas y reglas de seguridad. Cada negocio solo puede leer y escribir lo suyo, y solo con prueba vigente o suscripción activa.
- `netlify/functions/crear-suscripcion.mjs`: crea la suscripción mensual en Mercado Pago y devuelve el link de pago.
- `netlify/functions/mp-webhook.mjs`: recibe los avisos de Mercado Pago y activa o bloquea el negocio.

## Puesta en marcha

1. **Supabase** (supabase.com, plan gratis): crear un proyecto. En *SQL Editor*, pegar `supabase/schema.sql` y ejecutarlo.
   En *Authentication > URL Configuration*, poner la dirección de Netlify como *Site URL*.
2. Copiar de *Project Settings > API* la *Project URL* y la *anon public key* a `public/config.js`.
3. **Netlify**: *Add new site > Import from GitHub* y elegir este repositorio (no hace falta comando de build).
   En *Site configuration > Environment variables* cargar:
   - `SUPABASE_URL`: la misma Project URL.
   - `SUPABASE_SERVICE_ROLE_KEY`: la *service_role key* de Supabase (secreta, nunca en `config.js`).
   - `MP_ACCESS_TOKEN`: el Access Token de producción de Mercado Pago (*Tus integraciones > Credenciales*).
   - `MP_PRECIO_MENSUAL`: el precio en pesos, por ejemplo `20000`. Actualizar también `PRECIO_MENSUAL_TEXTO` en `config.js`.
   - `MP_WEBHOOK_SECRET` (recomendado): la clave secreta del webhook de Mercado Pago.
4. **Mercado Pago**: en *Tus integraciones > Webhooks*, poner `https://TU-SITIO.netlify.app/.netlify/functions/mp-webhook`
   y marcar el evento *Planes y suscripciones*.

## Para probar sin cuentas

Abrir `public/` con cualquier servidor local (por ejemplo `python3 -m http.server` dentro de `public`) y entrar a `http://localhost:8000`.
Con `config.js` vacío arranca en modo demo.
