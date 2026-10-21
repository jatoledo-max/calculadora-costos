# Asistente de WhatsApp en tu PC

El asistente se conecta a WhatsApp como un **dispositivo vinculado** (igual que WhatsApp Web). Contesta con la IA,
entiende audios, toma el pedido con los precios del menú y te lo manda a la pestaña **Pedidos**, que suena.
Cuando tocás Aceptar / En preparación / En camino, el aviso al cliente sale por acá.

> ⚠️ No es la conexión oficial de Meta: WhatsApp puede bloquear el número si detecta un bot. Para bajar el riesgo
> el asistente solo contesta a quien le escribe y muestra "escribiendo…" antes de responder.
> **Probalo primero con un chip secundario.**

## Una sola vez

1. **Base de datos.** En Supabase > SQL Editor, pegá y corré `supabase/whatsapp.sql` (se puede correr más de una vez).
2. **Node.js.** Instalalo desde https://nodejs.org (botón **LTS**), con las opciones que vienen marcadas.
3. **Esta carpeta.** En GitHub, *Code > Download ZIP*, descomprimilo y entrá a la carpeta `bot-whatsapp`.
4. **Claves.** Copiá `.env.ejemplo` y renombrá la copia a `.env` (sin "ejemplo"). Abrila con el Bloc de notas y completá:
   - `SUPABASE_SERVICE_ROLE_KEY`: Supabase > Project Settings > API > *service_role* (es secreta: no la compartas con nadie).
   - `GEMINI_API_KEY`: la misma clave de Google AI Studio que pusiste en Netlify.
   - Al guardar, elegí *Tipo: Todos los archivos* para que no quede como `.env.txt`.

## Cada vez que abrís

1. Doble clic en **`iniciar.bat`**. La primera vez instala lo que necesita (tarda un par de minutos).
2. La primera vez aparece un **código QR**. En el celular con el chip que va a atender:
   WhatsApp > ⋮ > **Dispositivos vinculados** > **Vincular un dispositivo**, y escanealo.
   Si el QR se ve mal, poné el número en `WA_NUMERO` del `.env` y te da un **código de 8 letras** para vincular.
3. Cuando diga **"✅ Conectado"**, dejá la ventana abierta (podés minimizarla). Las próximas veces no pide el QR.
4. En la app, pestaña **Pedidos**, tocá **Asistente: encendido** y **Activar sonido**.

Para apagarlo, cerrá la ventana. Si se corta internet, se reconecta solo.

## Para probar

- Escribile al chip desde otro celular: "hola, qué tienen?", mandale un audio pidiendo algo, confirmá el pedido.
- Fuera del horario solo contesta que está cerrado. Para probar a cualquier hora poné `WA_IGNORAR_HORARIO=1` en el `.env`
  (y borralo cuando termines).
- Si contestás vos desde el celular, el asistente deja de responder en esa charla por 3 horas.
