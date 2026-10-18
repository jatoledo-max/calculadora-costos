# CalculadoraDeGananciasMV

App web para que rotiserías y negocios de comida sepan cuánto les cuesta cada producto y a cuánto venderlo.
Cada negocio entra con su cuenta, ve solo sus datos y usa su propio logo y color.
Tiene 14 días de prueba gratis y después se cobra una suscripción mensual con Mercado Pago.

## Cómo está armada

- `public/`: la app (HTML, CSS y JavaScript, sin paso de compilación). Netlify la sirve tal cual.
  - `calculadora.js`: pantallas de insumos, productos, preparaciones propias, promos y precio sugerido.
  - `costos.js`: las cuentas de costos, sin pantalla. Las usan la calculadora y la caja, así existen una sola vez.
  - `caja.js`: pestaña Caja. Abrir la caja, registrar ventas con botones grandes desde el celular, cargar gastos y retiros,
    anular ventas y cerrar la caja contando la plata.
  - `informe.js`: cómo se dibuja un informe de caja (el de la caja abierta, el de un cierre o la suma de varios días).
  - `informes.js`: pestaña Informes. Cierres por fechas (hoy, últimos 7 días, este mes, mes pasado o a mano), la suma del
    período, el informe de cada cierre con sus ventas (para anular una venta de otro día), planillas .csv y pagos pendientes.
  - `copia.js`: Mi negocio > Copia de seguridad. Descarga todo el negocio en un archivo .json y lo vuelve a cargar.
  - `dinero.js`: redondeo a centavos y formato en pesos.
  - `app.js`: ingreso, alta del negocio, marca propia y bloqueo cuando no hay suscripción.
  - `config.js`: URL y clave pública de Supabase. Si quedan vacías, la app abre en **modo demo** (datos en el navegador).
  - `manifest.webmanifest`, `iconos/` y `sw.js`: permiten instalarla en el celular como app. Abre en la caja (`?tab=caja`).
    El service worker pide siempre los archivos a internet primero y usa la última copia solo si no hay conexión;
    los datos de Supabase nunca se guardan ahí. Sin internet, la app abre y avisa que las ventas no se pueden guardar.
- `supabase/caja.sql`: tablas y funciones de la caja (cajas, ventas, renglones, pagos, movimientos). Se corre después de `schema.sql`.
  El celular solo puede leer esas tablas: para escribir llama a `abrir_caja`, `confirmar_venta`, `registrar_movimiento`,
  `anular_venta`, `anular_movimiento` y `cerrar_caja`, que validan todo en una transacción. `resumen_caja` devuelve el informe
  (en vivo si la caja está abierta; la foto guardada al cerrar si está cerrada). Los pagos pendientes se guardan en
  `ajustes` (id `obligaciones`) y el cierre los resta del disponible para retirar.
  `copia_negocio` arma la copia de seguridad y `restaurar_copia` la vuelve a cargar sin pisar nada: del catálogo agrega
  lo que falta y la caja solo la restaura si el negocio todavía no tiene cajas (queda registrado en la auditoría).
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

## Instalar en el celular (Android)

Abrir la dirección del sitio en **Chrome**, entrar con la cuenta y tocar **Instalar app** arriba
(o el menú ⋮ > *Instalar aplicación* / *Agregar a la pantalla principal*). Queda un ícono que abre directo en la caja,
a pantalla completa. Las actualizaciones llegan solas: al abrirla con internet usa siempre la última versión.

## Para probar sin cuentas

Abrir `public/` con cualquier servidor local (por ejemplo `python3 -m http.server` dentro de `public`) y entrar a `http://localhost:8000`.
Con `config.js` vacío arranca en modo demo.

## Pruebas

`npm run test:todo` (`tests/todas.sh`) corre todo lo de abajo de una vez y dice qué falló.

- `npm test`: cálculos de costos y de plata (Node 22, sin instalar nada).
- `npm run test:db`: carga `schema.sql` y `caja.sql` en un Postgres de prueba y comprueba las reglas de la caja
  (sin duplicados, precios del catálogo, pagos que suman el total, gastos y retiros, anulaciones, cierre con la noche de
  ejemplo del diseño, pagos pendientes, una caja cerrada que no cambia, cada negocio ve solo lo suyo).
  Necesita `psql` y un Postgres al que conectarse con `PGHOST`, `PGPORT` y `PGUSER`.
- `tests/e2e/`: recorren la caja y la ficha de producto en un navegador, en modo demo.
  Con `public/` servido en el puerto 8765: `node tests/e2e/caja.e2e.cjs`, `node tests/e2e/cierre.e2e.cjs`, `node tests/e2e/informes.e2e.cjs`
  y `node tests/e2e/ficha.e2e.cjs` (necesitan Playwright).
  `node tests/e2e/integral.e2e.cjs` recorre dos noches completas, informes, copia de seguridad, un celular nuevo sin datos
  y la restauración de la copia.
  `node tests/e2e/celular.e2e.cjs` levanta su propio servidor (puerto 8766) y prueba que sea instalable, que abra sin internet,
  el carrito guardado y que todo lo tocable mida al menos 44 px.
