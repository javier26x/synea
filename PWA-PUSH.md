# Synea — PWA + Notificaciones push

La app es instalable en el celular y avisa al admin de las horas del día
siguiente, aunque esté cerrada. El aviso lo dispara la función `dailyReminders`
(ver [`FUNCTIONS.md`](FUNCTIONS.md)) y se entrega por **FCM**.

Piezas:

- `manifest.webmanifest`, `icons/`, `firebase-messaging-sw.js` → PWA + recepción push.
- `index.html` → botón "Activar en este dispositivo" (Configuración) que registra el token.

## Sin conexión

El service worker guarda una copia del cascarón —la página, el manifest y los
iconos— en la caché `synea-shell`. Si el celular se queda sin señal, la app
instalada **abre igual** con la última versión que cargó, en vez de mostrar la
pantalla de error del navegador, y una barra arriba dice "Sin conexión. Estás
viendo lo último que se cargó"; al volver la red se confirma y se va sola.

Los datos siguen viniendo de Firebase en vivo: sin conexión no se pueden crear
ni ver reservas nuevas. Es un cascarón offline, no una app offline.

La página y el manifest van **primero a la red** (así una versión nueva entra de
inmediato) y solo caen a la copia si la red falla. Los iconos van al revés,
porque llevan `?v=` en la URL: cambiarlos cambia la dirección y entran solos. Si
alguna vez hay que invalidar todo a la fuerza, sube el número de `CACHE`
(`synea-shell-v2`) en `firebase-messaging-sw.js`.

## Accesos directos

Al mantener pulsado el icono de la app instalada aparecen tres atajos, definidos
en `shortcuts` del manifest: **Reservar** (la web pública), **Citas** y
**Avisos** (van directo a esas secciones del panel, con `#appointments` y
`#notifications` — el panel lee la sección del enlace al abrir).

## 1. Clave VAPID (obligatoria)

1. Firebase Console → ⚙️ Configuración del proyecto → **Cloud Messaging**.
2. En "Certificados push web" → **Generar par de claves**.
3. Copia la clave (empieza con `B...`) y pégala en `index.html`, reemplazando
   `TU_CLAVE_VAPID`:

```bash
cd ~/synea
nano index.html     # busca:  window.FCM_VAPID_KEY
```

4. Verifica que la **Cloud Messaging API (V1)** esté habilitada (normalmente lo está).

`firebase-messaging-sw.js` debe tener el **mismo** `firebaseConfig` que
`index.html`, o el service worker no recibirá nada.

## 2. Volver a publicar

```bash
cd ~/synea
firebase deploy --only hosting,database
```

Incluye el manifest, los iconos, el service worker y la regla `adminPushTokens`.

## 3. Activar y probar

1. Abre la web publicada e inicia sesión como admin.
2. En el celular conviene primero **Instalar app** (menú del navegador →
   "Agregar a pantalla de inicio").
3. Configuración → **Notificaciones Push** → "Activar en este dispositivo" →
   acepta el permiso.
4. Crea una hora **confirmada** para mañana y fuerza el envío:

```bash
gcloud scheduler jobs run firebase-schedule-dailyReminders-us-central1 --location=us-central1
```

Debería llegarte el push (y el email a la clienta de prueba).

## Notas

- **Cada dispositivo** donde quieras recibir avisos debe activarse una vez (paso 3).
- Los tokens muertos se limpian solos: la función los borra si FCM los rechaza.
- Funciona en Android y PC (Chrome, Edge, Firefox). En iPhone requiere instalar la
  PWA en la pantalla de inicio (iOS 16.4+).
- Qué avisos recibes se elige en Configuración → Notificaciones Push (nueva
  reserva, resumen diario, reagendada, cancelada, confirmada).
- FCM es gratis; no depende del plan Blaze.
