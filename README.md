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
| Logo real | `icons/` | ✅ monograma del logo de Synea |
| Fotos de la galería | Panel → Galería | vacía |
| Fotos de portada de cada servicio | `scripts/fetch-service-images.mjs` o el panel | vacías: se ve la portada de marca |
| Duración del paquete de promoción | Panel → Servicios | estimada en 75 min |

- **Fotos:** el perfil de Instagram (`@synea.studiospa`) sí se puede abrir, pero
  sus publicaciones son casi todas reels y tomas de ambiente, no fotos por
  servicio. Súbelas desde **Panel → Galería**; se redimensionan solas y van a
  Firebase Storage. El link a Instagram en la web ya apunta al perfil correcto.
- **Logo:** el de Instagram se sirve a 150×150, así que `scripts/logo-synea.png`
  se tomó de la ficha de AgendaPro, que publica el mismo logo a 200×200 y con
  más detalle.
- **Portadas de los servicios:** cada tarjeta muestra la foto del servicio si la
  tiene y, si no, una portada de marca (degradado según la familia del servicio
  más su icono). Antes se usaban fotos heredadas de PaoPai —de otro local y de
  servicios que Synea no ofrece—, así que se eliminaron. Para poblarlas de una
  vez con fotos referenciales, mira [Fotos referenciales](#fotos-referenciales);
  para cambiar una suelta, **Panel → Servicios → Editar**.
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
| PROMOCIONES (categoría destacada) | 1 |

### Los adicionales de manicure

En AgendaPro los 7 adicionales (pedrería, diseños, ojo de gato, decoración 3D…)
son una categoría aparte que se agenda sola. Acá no: **cuelgan de cada servicio
de manicure** como adicionales opcionales, porque son decoración que se suma a un
esmaltado, no una visita en sí. La clienta los marca con un check dentro de la
misma tarjeta del servicio, ordenados de lo más simple a lo más elaborado:

| Adicional | Suma | Precio |
|---|---|---|
| Diseño simple (por uña) | +5 min | $500 |
| Diseño medio (por uña) | +10 min | $1.000 |
| Diseño complejo | +15 min | $1.500 |
| Ojo de gato | +5 min | $1.000 |
| Degradé / francesa | +15 min | $4.000 |
| Pedrería | +10 min | $1.500 |
| Decoración 3D | +15 min | $3.000 |

Van en los seis servicios que terminan en uña esmaltada: esmaltado unicolor,
esmaltado francesa/degradé (sin el adicional de degradé, que ya viene incluido),
kapping, las dos extensiones y el paquete de promoción.

Cada adicional suma **precio y minutos**: la cita ocupa el tiempo real en la
agenda, así que un esmaltado unicolor con diseño complejo reserva 75 min y no 60.
Se editan en **Panel → Servicios → Editar → Adicionales opcionales** (nombre,
minutos, precio).

La categoría suelta `SERVICIOS ADICIONALES MANICURE` y sus 7 servicios quedan
**desactivados**, no borrados: las citas antiguas los referencian por id. El
`seed-catalog.mjs` los desactiva solo si una corrida anterior los había creado.

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

### 8. Fotos referenciales

Mientras no tengas fotos propias de cada servicio, `fetch-service-images.mjs`
busca una en [Pexels](https://www.pexels.com/) (licencia de uso comercial, sin
atribución obligatoria), la sube a tu Firebase Storage y guarda la URL en el
catálogo. Cada servicio lleva su propio término de búsqueda dentro del script:
el nombre comercial no sirve para un banco de fotos, "ALIVIO & CALMA SYNEA" no
significa nada fuera de Synea.

Una vez: consigue una API key gratis en <https://www.pexels.com/api/>.

```bash
cd ~/synea/scripts
npm install
export PEXELS_API_KEY="tu_key"

node fetch-service-images.mjs            # muestra qué elegiría, sin bajar nada
node fetch-service-images.mjs --write    # descarga, sube y guarda
```

La simulación imprime el término, el autor y el link de cada foto, para que las
revises antes. Por defecto **respeta las fotos que ya subiste** desde el panel;
`--force` las reemplaza. Para reintentar una sola que quedó fea:

```bash
node fetch-service-images.mjs --only "REIKI" --pick 2 --write --force
```

`--pick 2` toma el segundo resultado de la búsqueda en vez del primero.

Son fotos de stock: sirven para que la web no se vea vacía, no para representar
el trabajo real. Reemplázalas por fotos propias apenas las tengas.

### 9. Correos y push

Sigue [`FUNCTIONS.md`](FUNCTIONS.md) (correos y recordatorios) y
[`PWA-PUSH.md`](PWA-PUSH.md) (notificaciones al celular).

### 10. Dominio propio (opcional)

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

### El logo

`scripts/logo-synea.png` es el logo real de Synea (monograma + «Synea Studio Spa»),
el mismo que publica el negocio. De ahí salen todos los iconos: como cada lugar
donde la app muestra el logo es un círculo de 52 a 96 px —portada, pantalla de
carga, cabecera del panel, login y el encabezado de los correos—, se recorta
**solo el monograma**; la palabra no se leería a ese tamaño.

Ojo con los colores: el verde del logo (`#12361b`) es más oscuro que el `--jade`
de la paleta del sitio. El monograma conserva el suyo.

```bash
cd ~/synea
pip install pillow
python3 scripts/gen-icons.py
```

Regenera `icon-192`, `icon-512`, `icon-maskable-512`, `apple-touch-icon` y
`logo.png` (círculo marfil con anillo bronce). Si cambias los iconos, sube el
`?v=` de `manifest.webmanifest` e `index.html` para que las PWA ya instaladas
los vuelvan a pedir. Para el icono sobre fondo verde en vez de marfil, cambia
`FONDO` por `VERDE` en el script.

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
icons/                     iconos PWA generados desde el logo real
scripts/                   utilidades (catálogo, fotos, limpieza, iconos)
```
