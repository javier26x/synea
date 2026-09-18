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
| Credenciales de Firebase | `index.html`, `firebase-messaging-sw.js` | ✅ proyecto `synea-app` |
| Correos con acceso al panel | `index.html` (`ADMIN_EMAILS`), `database.rules.json`, `storage.rules` | solo `javier.neo@gmail.com` |
| Clave VAPID (push) | `index.html` (`FCM_VAPID_KEY`) | `TU_CLAVE_VAPID` |
| ID del proyecto (si cambias) | `.firebaserc`, `functions/index.js`, `scripts/*.mjs` | `synea-app` |
| Ubicación de Storage | Consola → Storage | EE.UU. (no se puede cambiar) |
| Teléfono / WhatsApp | Panel → Configuración | `+56 9 6163 5077` |
| Correo de avisos | Panel → Configuración | vacío |
| Link de Webpay | Panel → Configuración | vacío (si no lo pones, no aparece el botón de pago) |
| Logo real | Panel → Configuración → Logo | provisorio: monograma en `icons/logo.png` |
| Fotos de la galería | Panel → Galería | vacía |
| Duración del paquete de promoción | Panel → Servicios | estimada en 75 min |

- **Fotos:** no se pudieron bajar desde Instagram (`@synea.studiospa`) — la red
  de este entorno bloquea el acceso. Súbelas desde **Panel → Galería**; se
  redimensionan solas y van a Firebase Storage. El link a Instagram en la web ya
  apunta al perfil correcto.
- **Catálogo:** nombres, precios, duraciones y descripciones son los publicados
  en AgendaPro. La única excepción es el paquete `ESMALTADO + PERFILADO`, que
  ahí figura sin duración: se estimó en 75 min (60 del esmaltado unicolor más el
  perfilado) y está marcado en `scripts/seed-catalog.mjs`.

### El catálogo

| Categoría | Servicios |
|---|---|
| MASOTERAPIA Y BIENESTAR | 10 |
| MANICURE | 10 |
| TERAPIAS COMPLEMENTARIAS Y BIENESTAR ENERGÉTICO | 4 |
| SERVICIOS ADICIONALES MANICURE | 7 |
| PROMOCIONES (categoría destacada) | 1 |

Los adicionales de manicure duran entre 5 y 15 minutos, por lo que el mínimo de
duración del panel bajó de 15 a 5 minutos. Si prefieres que no se agenden por
separado, la app también los admite como **adicionales** de un servicio (Panel →
Servicios → Editar → Adicionales opcionales), donde suman precio a la reserva.

---

## Puesta en marcha desde cero

> El proyecto **`synea-app` ya está creado** y sus credenciales están puestas en
> el código. Si usas ese proyecto, salta al paso 2.

### 1. Crear el proyecto de Firebase (solo si partes de otro)

En [console.firebase.google.com](https://console.firebase.google.com):

1. **Agregar proyecto** → nombre `synea-app`.
2. **Realtime Database** → Crear base de datos → modo bloqueado. Elige la región
   con cuidado: define dónde van también las Cloud Functions.
3. **Storage** → Comenzar. La ubicación queda fijada para siempre.
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

### 3. Credenciales (ya puestas)

`index.html` y `firebase-messaging-sw.js` ya traen el `firebaseConfig` de
`synea-app`. Solo hay que tocarlos si cambias de proyecto:

```bash
cd ~/synea
nano index.html                 # busca:  const firebaseConfig
nano firebase-messaging-sw.js   # busca:  firebase.initializeApp
```

**Región y bases de datos.** El proyecto tiene dos instancias de Realtime
Database y la app usa la de **us-central1**:

| Instancia | Región | Uso |
|---|---|---|
| `synea-app` | us-central1 | **la que usa la app** |
| `synea-app-default-rtdb` | europe-west1 | sin uso, desplegada con reglas cerradas |

La predeterminada quedó en Europa, pero el Storage del proyecto solo puede
crearse en EE.UU. (la ubicación de recursos predeterminada ya estaba fijada y no
se cambia). Como desde Chile us-central1 responde bastante mejor que Bélgica, se
usa la instancia de US y la europea se deja cerrada; no se puede borrar por ser
la predeterminada.

Los triggers de Realtime Database **no disparan si la función está en otra
región**, así que las Cloud Functions van en `us-central1` y el cliente las llama
ahí. Si alguna vez mueves la base, hay que cambiar los cuatro valores juntos:
`databaseURL` y `FUNCTIONS_REGION` en `index.html`, `DB_INSTANCE` y
`setGlobalOptions` en `functions/index.js`, más `DATABASE_URL` en `scripts/`.

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
firebase use synea-app
firebase deploy --only database,storage,hosting
```

Queda en `https://synea-app.web.app`.

### 6. Autorizar el dominio para el login

Firebase Console → **Authentication → Settings → Dominios autorizados** → agrega
`synea-app.web.app` (y después tu dominio real).

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
database.rules.json        reglas de la base de datos en uso
database.locked.rules.json reglas cerradas para la instancia sin uso
storage.rules              reglas de Storage (imágenes)
firebase.json / .firebaserc  hosting, reglas, funciones
functions/                 Cloud Functions: correos y recordatorios
icons/                     iconos PWA + logo provisorio
scripts/                   utilidades (catálogo, limpieza, iconos)
```
