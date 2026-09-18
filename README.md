# Synea Studio Spa — Reservas online

App de reservas y panel de administración para **Synea Studio Spa** (Bosque de
Luz 1581, Puerto Montt). Misma arquitectura que PaoPai: una sola página
(`index.html`) sobre Firebase, instalable como PWA.

- **Clientas:** eligen servicio → día y hora → dejan sus datos. Reciben correo de
  confirmación y recordatorio el día antes.
- **Panel (`Acceso administración`):** servicios y categorías, calendario y
  reservas, horarios, bloqueo de días, galería de trabajos, giftcards, clientas
  frecuentes y notificaciones push.

Stack: HTML/CSS/JS sin build + Firebase (Hosting, Realtime Database, Storage,
Auth con Google, Cloud Functions, Cloud Messaging).

---

## Antes de publicar: lo que falta completar

La app está lista, pero estos valores son propios del negocio y hay que
rellenarlos. Están marcados en el código.

| Qué | Dónde | Estado |
|---|---|---|
| Credenciales de Firebase | `index.html` (`firebaseConfig`) y `firebase-messaging-sw.js` | `TU_API_KEY`, `TU_SENDER_ID`, `TU_APP_ID` |
| ID del proyecto | `.firebaserc`, `functions/index.js` (`DB_INSTANCE`), `scripts/*.mjs` | `synea-app` (cámbialo si usas otro) |
| Correos con acceso al panel | `index.html` (`ADMIN_EMAILS`), `database.rules.json`, `storage.rules` | solo `javier.neo@gmail.com` |
| Clave VAPID (push) | `index.html` (`FCM_VAPID_KEY`) | `TU_CLAVE_VAPID` |
| Teléfono / WhatsApp | Panel → Configuración | vacío |
| Correo de avisos | Panel → Configuración | vacío |
| Link de Webpay | Panel → Configuración | vacío (si no lo pones, no aparece el botón de pago) |
| Logo real | Panel → Configuración → Logo | provisorio: monograma en `icons/logo.png` |
| Fotos de la galería | Panel → Galería | vacía |
| Precios de 5 servicios | Panel → Servicios | cargados pero **ocultos** |

Sobre los dos últimos:

- **Fotos:** no se pudieron bajar desde Instagram (`@synea.studiospa`) — la red de
  este entorno bloquea el acceso. Súbelas desde **Panel → Galería**; se
  redimensionan solas y van a Firebase Storage. El link a Instagram en la web ya
  apunta al perfil correcto.
- **Precios:** el catálogo salió de la ficha pública de AgendaPro. Cinco
  servicios aparecían ahí sin precio ni duración visibles, así que quedaron
  cargados con `active: false` (no se muestran a las clientas) para no inventar
  valores. Ponles el precio real en **Panel → Servicios → Editar** y actívalos.

---

## Puesta en marcha desde cero

### 1. Crear el proyecto de Firebase

En [console.firebase.google.com](https://console.firebase.google.com):

1. **Agregar proyecto** → nombre `synea-app`.
2. **Realtime Database** → Crear base de datos → ubicación `us-central1` → modo bloqueado.
3. **Storage** → Comenzar.
4. **Authentication** → Sign-in method → habilitar **Google**.
5. **Configuración del proyecto → Tus apps → Web (`</>`)** → registra la app y
   copia el bloque `firebaseConfig`.
6. Sube el proyecto al plan **Blaze** (las Cloud Functions de correo lo requieren).

### 2. Instalar herramientas y clonar

```bash
npm install -g firebase-tools
firebase login

git clone https://github.com/javier26x/synea.git ~/synea
cd ~/synea
```

### 3. Pegar tus credenciales

Reemplaza los valores en los dos archivos (deben quedar idénticos):

```bash
cd ~/synea
nano index.html                 # busca:  const firebaseConfig
nano firebase-messaging-sw.js   # busca:  firebase.initializeApp
```

Si tu proyecto NO se llama `synea-app`, cambia el ID también aquí:

```bash
cd ~/synea
sed -i 's/synea-app/TU-PROJECT-ID/g' .firebaserc functions/index.js scripts/*.mjs firebase-messaging-sw.js index.html
```

### 4. Dar acceso al panel

Agrega el correo Google de cada persona que administre. En los **tres** archivos:

```bash
cd ~/synea
nano index.html            # const ADMIN_EMAILS = [...]
nano database.rules.json   # auth.token.email === '...'
nano storage.rules         # request.auth.token.email in [...]
```

La restricción real vive en las reglas; la lista de `index.html` solo decide
quién ve el panel.

### 5. Publicar reglas y sitio

```bash
cd ~/synea
firebase use TU-PROJECT-ID
firebase deploy --only database,storage,hosting
```

Queda en `https://TU-PROJECT-ID.web.app`.

### 6. Autorizar el dominio para el login

Firebase Console → **Authentication → Settings → Dominios autorizados** → agrega
`TU-PROJECT-ID.web.app` (y después tu dominio real).

### 7. Cargar el catálogo de servicios

Necesitas una clave de cuenta de servicio (Console → Configuración → Cuentas de
servicio → **Generar nueva clave privada**) guardada como
`scripts/serviceAccountKey.json` (está en `.gitignore`, no se sube al repo).

```bash
cd ~/synea/scripts
npm install
node seed-catalog.mjs            # muestra qué haría, sin escribir
node seed-catalog.mjs --write    # lo escribe de verdad
```

Es idempotente: si lo corres dos veces actualiza en vez de duplicar, y nunca toca
reservas ni disponibilidad.

### 8. Correos y push

Sigue [`FUNCTIONS.md`](FUNCTIONS.md) (correos y recordatorios) y
[`PWA-PUSH.md`](PWA-PUSH.md) (notificaciones al celular).

### 9. Dominio propio (opcional)

Console → **Hosting → Agregar dominio personalizado** → `synea.frody.cl` → sigue
las instrucciones de DNS. Después agrégalo también a Dominios autorizados (paso 6)
y actualiza el canonical:

```bash
cd ~/synea
sed -i 's#https://synea.frody.cl/#https://TU-DOMINIO/#g' index.html
sed -i "s#https://synea.frody.cl/icons/logo.png#https://TU-DOMINIO/icons/logo.png#" functions/index.js
firebase deploy --only hosting,functions
```

---

## Día a día

Publicar cambios de la web:

```bash
cd ~/synea
firebase deploy --only hosting
```

Publicar cambios de reglas o funciones:

```bash
cd ~/synea
firebase deploy --only database,storage
firebase deploy --only functions
```

Ver los logs de las funciones:

```bash
firebase functions:log
```

Borrar reservas de prueba de una clienta:

```bash
cd ~/synea/scripts
node delete-client.mjs "nombre apellido"             # solo muestra
node delete-client.mjs "nombre apellido" --delete    # borra
```

Probar la web en local antes de publicar:

```bash
cd ~/synea
firebase serve --only hosting     # http://localhost:5000
```

---

## Identidad visual

Cambia respecto de PaoPai: paleta y tipografías propias, definidas como tokens en
el `:root` de `index.html`.

| Token | Valor | Uso |
|---|---|---|
| `--jade` | `#2f5d50` | color principal |
| `--jade-light` / `--jade-dark` | `#7ba795` / `#1e3f36` | variantes |
| `--bronze` | `#b08b57` | acento, detalles |
| `--ivory` / `--ivory-dark` | `#f8f5f0` / `#eee8de` | fondos |
| `--charcoal` | `#23302c` | texto |

Tipografías: **Cormorant Garamond** (títulos) + **Manrope** (texto).

Los iconos de `icons/` y el logo provisorio se generaron con
`scripts/gen-icons.py`; para regenerarlos tras cambiar la paleta:

```bash
cd ~/synea && python3 scripts/gen-icons.py
```

---

## Estructura

```
index.html                 la app completa (cliente + panel)
firebase-messaging-sw.js   service worker: PWA + push
manifest.webmanifest       instalable como app
database.rules.json        reglas de la base de datos
storage.rules              reglas de Storage (imágenes)
firebase.json / .firebaserc  hosting, reglas, funciones
functions/                 Cloud Functions: correos y recordatorios
icons/                     iconos PWA + logo provisorio
scripts/                   utilidades (catálogo, limpieza, iconos)
```
