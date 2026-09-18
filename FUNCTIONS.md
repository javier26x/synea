# Synea — Cloud Functions (correos + recordatorios)

Todo el correo lo envía **Firebase**, disparado por la base de datos. El
navegador no manda correos. Requiere plan **Blaze**.

Funciones (`functions/index.js`):

- `onAppointmentCreated` — nueva reserva → correo a la clienta + aviso al admin
  **por email y push inmediato**. Las horas que registras a mano desde el panel
  (`source: 'admin'`) no auto-notifican, y si nacen confirmadas la clienta recibe
  directamente el correo de confirmación.
- `onAppointmentUpdated` — confirmar / cancelar / reagendar → correo a la clienta.
- `onGiftcardCreated` — giftcard nueva → correo a quien compra (y a quien la
  recibe, si dejó su email) + push al admin.
- `validateGiftcard` / `resendAppointmentEmail` / `testMail` — llamadas desde el panel.
- `dailyReminders` — cada mañana (09:00 Chile) → recordatorio por email a las
  clientas de mañana **y push al admin** con el resumen.

## 1. Configurar el SMTP

```bash
cd ~/synea/functions
cp .env.example .env
nano .env       # host, puerto, usuario y remitente
```

`.env` (no lleva la contraseña):

```
SMTP_HOST=mail.frody.cl
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=synea@frody.cl
FROM_NAME=Synea Studio Spa
```

La contraseña va como **secret**, fuera del repo:

```bash
cd ~/synea
firebase functions:secrets:set SMTP_PASSWORD
# te pide pegar la contraseña de la casilla
```

## 2. Desplegar

```bash
cd ~/synea
firebase deploy --only functions,database
```

La primera vez te pedirá habilitar algunas APIs; acepta.

## 3. Probar

Nueva reserva, confirmación, cancelación y reagendo: hazlo desde la web y revisa
que lleguen los correos.

```bash
firebase functions:log
```

El recordatorio diario se puede forzar sin esperar a las 9 AM (crea antes una
hora **confirmada** para mañana, con email):

```bash
gcloud scheduler jobs run firebase-schedule-dailyReminders-us-central1 --location=us-central1
```

Y hay una prueba de correo directa en **Panel → Configuración → Probar correo**.

## Notas

- El aviso al admin por **nueva reserva** se envía siempre. Los correos a la
  clienta respetan el interruptor "Notificaciones Email" de Configuración.
- Si no configuras `config.email` en el panel, los avisos van al primer correo de
  `ADMIN_EMAILS` (`functions/index.js`).
- Las respuestas de las clientas llegan al correo del negocio vía `reply-to`.
- `DB_INSTANCE` en `functions/index.js` apunta a la instancia en uso,
  `synea-app` (us-central1), no a la predeterminada.
- **Región:** las funciones se despliegan en `us-central1`, la misma de esa base.
  Los triggers de Realtime Database solo disparan si coinciden. El cliente
  también llama ahí (`FUNCTIONS_REGION` en `index.html`); si cambias una, cambia
  las tres.
