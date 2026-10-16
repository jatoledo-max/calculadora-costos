# CalculadoraDeGananciasMV

App web para que rotiserías y negocios de comida sepan cuánto les cuesta cada producto y a cuánto venderlo.
Cada negocio entra con su cuenta, ve solo sus datos y usa su propio logo y color.
Tiene 14 días de prueba gratis y después se cobra una suscripción mensual con Mercado Pago.

## Cómo está armada

- `public/`: la app (HTML, CSS y JavaScript, sin paso de compilación). Netlify la sirve tal cual.
  - `calculadora.js`: pantallas de insumos, productos, preparaciones propias, promos y precio sugerido.
  - `costos.js`: las cuentas de costos, sin pantalla. Las usan la calculadora y la caja, así existen una sola vez.
  - `caja.js`: pestaña Caja. Abrir la caja y registrar ventas con botones grandes desde el celular.
  - `dinero.js`: redondeo a centavos y formato en pesos.
  - `app.js`: ingreso, alta del negocio, marca propia y bloqueo cuando no hay suscripción.
  - `config.js`: URL y clave pública de Supabase. Si quedan vacías, la app abre en **modo demo** (datos en el navegador).
- `supabase/caja.sql`: tablas y funciones de la caja (cajas, ventas, renglones, pagos). Se corre después de `schema.sql`.
  El celular solo puede leer esas tablas: para vender llama a `abrir_caja` y `confirmar_venta`, que validan todo en una transacción.
- `supabase/schema.sql`: tablas y reglas de seguridad. Cada negocio solo puede leer y escribir lo suyo, y solo con prueba vigente o suscripción activa.
- `netlify/functions/crear-suscripcion.mjs`: crea la suscripción mensual en Mercado Pago y devuelve el link de pago.
- `netlify/functions/mp-webhook.mjs`: recibe los avisos de Mercado Pago y activa o bloquea el negocio.

## Puesta en marcha

1. **Supabase** (supabase.com, plan gratis): crear un proyecto. En *SQL Editor*, pegar `supabase/schema.sql` y ejecutarlo.
   Después, en otra consulta, pegar `supabase/caja.sql` y ejecutarlo (se puede volver a correr sin perder datos).
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

## Pruebas

- `npm test`: cálculos de costos y de plata (Node 22, sin instalar nada).
- `npm run test:db`: carga `schema.sql` y `caja.sql` en un Postgres de prueba y comprueba las reglas de la caja
  (sin duplicados, precios del catálogo, pagos que suman el total, cada negocio ve solo lo suyo).
  Necesita `psql` y un Postgres al que conectarse con `PGHOST`, `PGPORT` y `PGUSER`.
- `tests/e2e/`: recorren la caja y la ficha de producto en un navegador, en modo demo.
  Con `public/` servido en el puerto 8765: `node tests/e2e/caja.e2e.cjs` y `node tests/e2e/ficha.e2e.cjs` (necesitan Playwright).
