/**
 * Synea Studio Spa - Cloud Functions
 *
 * Envía los correos y recordatorios directamente desde Firebase, disparados por
 * los cambios en la base de datos. El navegador ya no manda correos.
 *
 *  - onAppointmentCreated : nueva reserva -> correo al cliente + aviso al admin
 *  - onAppointmentUpdated : confirmar / cancelar / reagendar -> correo al cliente
 *  - dailyReminders       : cada mañana -> recordatorio por email al cliente
 *                           y push (FCM) al admin con las citas de mañana
 *
 * SMTP: se configura por variables (functions/.env) + un secret SMTP_PASSWORD.
 */

const { onValueCreated, onValueUpdated } = require('firebase-functions/v2/database');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const { setGlobalOptions } = require('firebase-functions/v2');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
const nodemailer = require('nodemailer');

admin.initializeApp();
// us-central1: los triggers de Realtime Database deben estar en la misma
// región que la base de datos.
setGlobalOptions({ region: 'us-central1', maxInstances: 10 });

const SMTP_PASSWORD = defineSecret('SMTP_PASSWORD');
const DB_INSTANCE = 'synea-app';
const TZ = 'America/Santiago';
const ADMIN_EMAILS = ['javier.neo@gmail.com'];
const DEFAULT_LOGO = 'https://synea.frody.cl/icons/logo.png';

// ---------------- helpers ----------------
const db = () => admin.database();
const escHtml = (s) => s == null ? '' : String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const escAttr = (s) => escHtml(s).replace(/`/g, '&#96;');
const fmtLong = (dateStr) => new Date(dateStr + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

async function getConfig() { const s = await db().ref('config').get(); return s.val() || {}; }
async function getService(id) { const s = await db().ref('services/' + id).get(); return s.val(); }

// Preferencias de push del admin (toggles en Config del panel). Por defecto
// todo activado salvo 'confirmed' (es la acción más frecuente del propio admin).
const PUSH_DEFAULTS = { newBooking: true, dailySummary: true, rescheduled: true, cancelled: true, confirmed: false };
function pushPref(config, key) {
  const p = (config && config.pushPrefs) || {};
  return p[key] != null ? !!p[key] : PUSH_DEFAULTS[key];
}

function transporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '465'),
    secure: (process.env.SMTP_SECURE || 'true') === 'true',
    auth: { user: process.env.SMTP_USER, pass: SMTP_PASSWORD.value() }
  });
}

// Envía y DEJA RASTRO: si el SMTP falla tiene que verse en los logs.
// (Antes el error se perdía dentro de Promise.allSettled y el correo
// desaparecía sin dejar ninguna huella.)
async function sendMail(to, subject, html, replyTo) {
  if (!to) { logger.warn('sendMail sin destinatario', { subject }); return; }
  if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
    logger.error('SMTP sin configurar: faltan SMTP_HOST/SMTP_USER (functions/.env) en el deploy', { to, subject });
    return;
  }
  try {
    const info = await transporter().sendMail({
      from: `"${process.env.FROM_NAME || 'Synea Studio Spa'}" <${process.env.SMTP_USER}>`,
      to, subject, html, replyTo: replyTo || undefined
    });
    logger.info('📧 Correo enviado', { to, subject, messageId: info.messageId, accepted: info.accepted, rejected: info.rejected });
    return info;
  } catch (err) {
    logger.error('❌ Falló el envío de correo', { to, subject, code: err.code, command: err.command, error: err.message });
    throw err;
  }
}

// Prueba de correo bajo demanda desde el panel (botón en Config).
// Solo cuentas admin autenticadas: no expone nada públicamente.
exports.testMail = onCall({ secrets: [SMTP_PASSWORD] }, async (request) => {
  const email = ((request.auth && request.auth.token && request.auth.token.email) || '').toLowerCase();
  if (!ADMIN_EMAILS.includes(email)) throw new HttpsError('permission-denied', 'Solo el administrador puede probar el correo');
  const cfg = await getConfig();
  const to = String((request.data && request.data.to) || cfg.email || email || '').trim();
  const estado = {
    host: process.env.SMTP_HOST || '(sin configurar)',
    usuario: process.env.SMTP_USER || '(sin configurar)',
    puerto: process.env.SMTP_PORT || '465',
    destino: to || '(sin destino)'
  };
  if (!to) throw new HttpsError('failed-precondition', 'No hay dirección de destino configurada');
  try {
    const info = await sendMail(to, 'Prueba de correo — Synea Studio Spa', '<p>Si ves esto, el envío de correos está funcionando. 🎉</p>');
    return { ok: true, estado, messageId: info && info.messageId };
  } catch (err) {
    logger.error('testMail falló', { code: err.code, error: err.message });
    return { ok: false, estado, code: err.code || '', error: err.message || 'Error desconocido' };
  }
});

// Reenvía a la clienta el correo de su cita (según su estado actual).
// Permite además guardar el email si la reserva no lo traía.
exports.resendAppointmentEmail = onCall({ secrets: [SMTP_PASSWORD] }, async (request) => {
  const admEmail = ((request.auth && request.auth.token && request.auth.token.email) || '').toLowerCase();
  if (!ADMIN_EMAILS.includes(admEmail)) throw new HttpsError('permission-denied', 'Solo el administrador puede reenviar correos');
  const { aptId, email } = request.data || {};
  if (!aptId) throw new HttpsError('invalid-argument', 'Falta la cita');

  const snap = await db().ref('appointments/' + aptId).get();
  const apt = snap.val();
  if (!apt) throw new HttpsError('not-found', 'La cita ya no existe');

  // Si se indica un email nuevo, se guarda en la cita para futuros avisos
  const nuevo = String(email || '').trim();
  if (nuevo) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(nuevo)) throw new HttpsError('invalid-argument', 'El email no es válido');
    await db().ref('appointments/' + aptId + '/clientEmail').set(nuevo);
    apt.clientEmail = nuevo;
  }
  if (!apt.clientEmail) throw new HttpsError('failed-precondition', 'La cita no tiene email de la clienta');

  const [config, svc] = await Promise.all([getConfig(), getService(apt.serviceId)]);
  if (!svc) throw new HttpsError('failed-precondition', 'El servicio de la cita ya no existe');
  const biz = config.businessName || 'Synea Studio Spa';
  const adminEmail = config.email || undefined;

  let asunto, html;
  if (apt.status === 'cancelled') { asunto = 'Cita cancelada — ' + biz; html = cancellationEmail(config, apt, svc); }
  else if (apt.status === 'confirmed' || apt.status === 'completed') { asunto = 'Cita confirmada — ' + biz; html = confirmedEmail(config, apt, svc); }
  else { asunto = 'Reserva recibida — ' + biz; html = pendingEmail(config, apt, svc); }

  try {
    const info = await sendMail(apt.clientEmail, asunto, html, adminEmail);
    return { ok: true, to: apt.clientEmail, asunto, messageId: info && info.messageId };
  } catch (err) {
    logger.error('resendAppointmentEmail falló', { aptId, code: err.code, error: err.message });
    return { ok: false, to: apt.clientEmail, code: err.code || '', error: err.message || 'Error desconocido' };
  }
});

// Valida un código de giftcard desde la web pública (sin sesión). No expone
// datos de la giftcard: solo si sirve y para qué servicio es.
exports.validateGiftcard = onCall(async (request) => {
  const code = String((request.data && request.data.code) || '').trim().toUpperCase();
  const serviceId = String((request.data && request.data.serviceId) || '').trim();
  if (!code || code.length > 20) return { valid: false, reason: 'format', message: 'El código no es válido' };

  const snap = await db().ref('giftcards').orderByChild('code').equalTo(code).get();
  const found = snap.val();
  if (!found) return { valid: false, reason: 'notfound', message: 'No encontramos ese código' };
  const id = Object.keys(found)[0];
  const g = found[id];

  if (g.status === 'used') return { valid: false, reason: 'used', message: 'Esta giftcard ya fue canjeada' };
  if (g.status === 'cancelled') return { valid: false, reason: 'cancelled', message: 'Esta giftcard fue anulada' };
  if (g.status !== 'active') return { valid: false, reason: 'unpaid', message: 'Esta giftcard aún no está activa. Escríbenos para confirmarla.' };
  const hoy = new Date().toISOString().slice(0, 10);
  if (g.expiresAt && g.expiresAt < hoy) return { valid: false, reason: 'expired', message: 'Esta giftcard venció el ' + g.expiresAt };

  // Sirve. Si es de otro servicio, se avisa pero se permite (lo resuelve el salón).
  const mismoServicio = !serviceId || g.serviceId === serviceId;
  return {
    valid: true,
    serviceName: g.serviceName || '',
    toName: g.toName || '',
    sameService: mismoServicio,
    message: mismoServicio
      ? `Giftcard válida de ${g.serviceName}`
      : `Esta giftcard es de "${g.serviceName}". Puedes agendar igual y lo conversamos.`
  };
});

// Canjea la giftcard de una cita recién creada (server-side, para que el
// canje no dependa del navegador). Devuelve el texto para los avisos.
async function canjearGiftcard(aptId, apt) {
  const code = String(apt.giftCode || '').trim().toUpperCase();
  if (!code) return null;
  const snap = await db().ref('giftcards').orderByChild('code').equalTo(code).get();
  const found = snap.val();
  if (!found) { await db().ref('appointments/' + aptId + '/giftStatus').set('invalid'); return { ok: false, code, motivo: 'no existe' }; }
  const id = Object.keys(found)[0];
  const g = found[id];
  if (g.status === 'used') { await db().ref('appointments/' + aptId + '/giftStatus').set('used_before'); return { ok: false, code, motivo: 'ya estaba canjeada' }; }
  if (g.status !== 'active') { await db().ref('appointments/' + aptId + '/giftStatus').set('not_active'); return { ok: false, code, motivo: 'no está activa' }; }

  await db().ref('giftcards/' + id).update({ status: 'used', usedAt: new Date().toISOString(), usedByAppointment: aptId });
  await db().ref('appointments/' + aptId).update({ giftStatus: 'redeemed', giftcardId: id });
  logger.info('🎁 Giftcard canjeada', { code, aptId });
  return { ok: true, code, serviceName: g.serviceName || '', buyerName: g.buyerName || '' };
}

// ---------------- plantillas (portadas del frontend) ----------------
function emailTemplate(config, title, body, footer) {
  return `<div style="font-family:'Helvetica Neue',Arial,sans-serif;max-width:520px;margin:0 auto;background:#f8f5f0;border-radius:16px;overflow:hidden;border:1px solid #ece6dc">
    <div style="background:linear-gradient(135deg,#2f5d50,#7ba795);padding:28px 24px;text-align:center">
      <img src="${escAttr(config.logoUrl || DEFAULT_LOGO)}" alt="Synea Studio Spa" style="width:52px;height:52px;border-radius:50%;background:#fff;padding:4px">
      <h1 style="color:#fff;font-size:18px;margin:12px 0 0;font-weight:600">${title}</h1>
    </div>
    <div style="padding:28px 24px;color:#23302c;font-size:14px;line-height:1.7">${body}</div>
    <div style="padding:16px 24px;background:#eee8de;text-align:center;font-size:12px;color:#6d7a75">${footer || escHtml(config.businessName || 'Synea Studio Spa')}</div>
  </div>`;
}

// Servicios adicionales de la misma visita (facial + pestañas, etc.)
function emailExtraServices(apt) {
  if (!Array.isArray(apt.extraServices) || !apt.extraServices.length) return '';
  const rows = apt.extraServices.map(x => {
    const main = `<tr><td style="padding:4px 0;color:#6d7a75;width:20px">+</td><td style="padding:4px 0">${escHtml(x.name)}</td><td style="padding:4px 0;text-align:right;font-weight:600;color:#2f5d50">$${(x.price || 0).toLocaleString('es-CL')}</td></tr>`;
    const adds = Array.isArray(x.addons) ? x.addons.map(a => `<tr><td></td><td style="padding:2px 0 2px 12px;color:#6d7a75;font-size:12px">· ${escHtml(a.name)}</td><td style="padding:2px 0;text-align:right;font-size:12px;color:${a.price > 0 ? '#2f5d50' : '#5a9e6f'}">${a.price > 0 ? '+$' + a.price.toLocaleString('es-CL') : 'Gratis'}</td></tr>`).join('') : '';
    return main + adds;
  }).join('');
  return `<div style="margin-top:12px;padding-top:12px;border-top:1px dashed #ddd8cf">
    <p style="margin:0 0 8px;font-size:11px;color:#2f5d50;text-transform:uppercase;letter-spacing:1px;font-weight:600">También reservaste</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">${rows}</table>
    ${apt.totalDuration ? `<p style="margin:10px 0 0;font-size:12.5px;color:#6d7a75">⏱️ Duración total estimada: <strong>${apt.totalDuration} min</strong></p>` : ''}
  </div>`;
}

function emailAddonsSection(apt, svc) {
  if (!Array.isArray(apt.addons) || !apt.addons.length) return '';
  const rows = apt.addons.map(a => `<tr><td style="padding:4px 0;color:#6d7a75;width:20px">+</td><td style="padding:4px 0">${escHtml(a.name)}${a.duration > 0 ? ` <span style="color:#6d7a75;font-size:12px">· +${a.duration} min</span>` : ''}</td><td style="padding:4px 0;text-align:right;font-weight:600;color:${a.price > 0 ? '#2f5d50' : '#5a9e6f'}">${a.price > 0 ? '$' + a.price.toLocaleString('es-CL') : 'Gratis'}</td></tr>`).join('');
  const addonsTotal = apt.addons.reduce((s, a) => s + (a.price || 0), 0);
  const total = (apt.totalPrice != null ? apt.totalPrice : (svc.price + addonsTotal));
  return `<div style="margin-top:12px;padding-top:12px;border-top:1px dashed #ddd8cf">
    <p style="margin:0 0 8px;font-size:11px;color:#2f5d50;text-transform:uppercase;letter-spacing:1px;font-weight:600">✨ Adicionales</p>
    <table style="width:100%;border-collapse:collapse;font-size:13px">${rows}</table>
    <div style="margin-top:12px;padding-top:10px;border-top:2px solid #ddd8cf;display:flex;justify-content:space-between">
      <span style="color:#6d7a75;font-size:12px;text-transform:uppercase;letter-spacing:.8px;font-weight:600">Total</span>
      <span style="color:#2f5d50;font-weight:700;font-size:18px">$${total.toLocaleString('es-CL')}</span>
    </div>
  </div>`;
}

// Si la cita es de un viaje (atención en otra ciudad), la ubicación del correo
// es la del viaje, no la de la sede.
function emailLocationSection(config, apt) {
  const isTrip = !!(apt && apt.locationAddress);
  const address = isTrip ? apt.locationAddress : config.address;
  const detail = isTrip ? '' : config.addressDetail;
  const explicitMaps = isTrip ? '' : config.mapsUrl;
  if (!address && !explicitMaps) return '';
  const mapsLink = explicitMaps || (address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(address) : '');
  if (!mapsLink) return '';
  let displayAddress = '';
  if (address) displayAddress = escHtml(address);
  if (detail) displayAddress += (displayAddress ? '<br>' : '') + '<span style="color:#6d7a75">' + escHtml(detail) + '</span>';
  const heading = isTrip
    ? `📍 Te atiendo en ${escHtml(apt.locationCity || 'otra ciudad')}`
    : '📍 Dónde nos ubicamos';
  return `<div style="margin:20px 0;padding:18px;background:#fff;border:1px solid #ece6dc;border-radius:12px;text-align:center">
    <p style="margin:0 0 4px;font-size:11px;color:#2f5d50;text-transform:uppercase;letter-spacing:1.4px;font-weight:600">${heading}</p>
    ${displayAddress ? `<p style="margin:6px 0 14px;font-size:14px;color:#23302c;font-weight:500;line-height:1.5">${displayAddress}</p>` : '<div style="height:8px"></div>'}
    <a href="${escAttr(mapsLink)}" target="_blank" style="display:inline-block;background:linear-gradient(135deg,#2f5d50,#7ba795);color:#fff;text-decoration:none;padding:11px 26px;border-radius:24px;font-size:14px;font-weight:600;box-shadow:0 3px 10px rgba(47, 93, 80,.25)">🗺️ Cómo llegar</a>
  </div>`;
}

function pendingEmail(config, apt, svc) {
  const fd = fmtLong(apt.date);
  return emailTemplate(config, 'Reserva recibida', `
    <p>Hola <strong>${escHtml(apt.clientName)}</strong>,</p>
    <p>Recibimos tu reserva. En breve te confirmamos la hora:</p>
    <div style="background:#fef6e0;border-left:3px solid #d4a853;padding:12px 16px;margin:16px 0;border-radius:6px">
      <p style="margin:0;font-size:13px;color:#7c5f2f"><i>⏳ Estado: Pendiente de confirmación</i></p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px 0;color:#6d7a75;width:100px">Servicio</td><td style="padding:8px 0;font-weight:600">${escHtml(svc.name)}</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Fecha</td><td style="padding:8px 0;font-weight:600">${fd}</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Hora</td><td style="padding:8px 0;font-weight:600">${escHtml(apt.time)} hrs</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Duración</td><td style="padding:8px 0">${apt.totalDuration || svc.duration} min</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Precio base</td><td style="padding:8px 0;font-weight:600;color:#2f5d50">$${(svc.price || 0).toLocaleString('es-CL')}</td></tr>
    </table>
    ${emailExtraServices(apt)}${emailAddonsSection(apt, svc)}
    ${emailLocationSection(config, apt)}
    <p style="font-size:13px;color:#6d7a75;margin-top:20px">Recibirás otro correo cuando tu hora quede confirmada. Si necesitas modificar o cancelar, escríbenos${config.phone ? ' al ' + escHtml(config.phone) : ''}.</p>
    ${config.webpayUrl ? `<div style="text-align:center;margin-top:20px;padding-top:20px;border-top:1px solid #ece6dc">
      <p style="font-size:14px;color:#23302c;margin-bottom:12px"><strong>Asegura tu hora con el pago</strong></p>
      <a href="${escAttr(config.webpayUrl)}" style="display:inline-block;padding:14px 32px;background:linear-gradient(135deg,#b08b57,#b8944f);color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">💳 Pagar con Webpay</a>
      <p style="font-size:11px;color:#9aa5a0;margin-top:10px">Pago seguro · Transbank</p>
    </div>` : ''}
  `);
}

function confirmedEmail(config, apt, svc) {
  const fd = fmtLong(apt.date);
  return emailTemplate(config, '¡Hora confirmada! ✓', `
    <p>Hola <strong>${escHtml(apt.clientName)}</strong>,</p>
    <p>¡Buenas noticias! Tu hora quedó <strong style="color:#2d6e3f">confirmada</strong>. Te esperamos:</p>
    <div style="background:#e3f5e8;border-left:3px solid #5a9e6f;padding:12px 16px;margin:16px 0;border-radius:6px">
      <p style="margin:0;font-size:13px;color:#2d6e3f"><i>✓ Estado: Confirmada</i></p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px 0;color:#6d7a75;width:100px">Servicio</td><td style="padding:8px 0;font-weight:600">${escHtml(svc.name)}</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Fecha</td><td style="padding:8px 0;font-weight:600">${fd}</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Hora</td><td style="padding:8px 0;font-weight:600">${escHtml(apt.time)} hrs</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Duración</td><td style="padding:8px 0">${apt.totalDuration || svc.duration} min</td></tr>
    </table>
    ${emailExtraServices(apt)}${emailAddonsSection(apt, svc)}
    ${emailLocationSection(config, apt)}
    <p style="font-size:13px;color:#6d7a75;margin-top:20px">¿Necesitas cancelar o cambiar tu hora? Escríbenos${config.phone ? ' al ' + escHtml(config.phone) : ''}.</p>
  `);
}

function rescheduledEmail(config, apt, svc, oldDate, oldTime) {
  const fdOld = fmtLong(oldDate), fdNew = fmtLong(apt.date);
  return emailTemplate(config, 'Tu hora fue reagendada 📅', `
    <p>Hola <strong>${escHtml(apt.clientName)}</strong>,</p>
    <p>Tu hora fue <strong>reagendada</strong>. Estos son los nuevos detalles:</p>
    <div style="background:#f3f7f5;border-left:3px solid #2f5d50;padding:14px 18px;margin:16px 0;border-radius:6px">
      <p style="margin:0 0 8px 0;font-size:12px;color:#6d7a75;text-transform:uppercase;letter-spacing:1px"><i>Antes</i></p>
      <p style="margin:0;font-size:14px;color:#414f4a;text-decoration:line-through;opacity:.7">${fdOld} a las ${escHtml(oldTime)} hrs</p>
    </div>
    <div style="background:#e8f5ec;border-left:3px solid #5a9e6f;padding:14px 18px;margin:16px 0;border-radius:6px">
      <p style="margin:0 0 8px 0;font-size:12px;color:#2d6e3f;text-transform:uppercase;letter-spacing:1px"><i>✓ Nueva fecha y hora</i></p>
      <p style="margin:0;font-size:15px;color:#2d6e3f;font-weight:700">${fdNew} a las ${escHtml(apt.time)} hrs</p>
    </div>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px 0;color:#6d7a75;width:100px">Servicio</td><td style="padding:8px 0;font-weight:600">${escHtml(svc.name)}</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Duración</td><td style="padding:8px 0">${apt.totalDuration || svc.duration} min</td></tr>
    </table>
    ${emailExtraServices(apt)}${emailAddonsSection(apt, svc)}
    ${emailLocationSection(config, apt)}
    <p style="font-size:13px;color:#6d7a75;margin-top:20px">Si esta nueva fecha no te acomoda, por favor escríbenos${config.phone ? ' al ' + escHtml(config.phone) : ''} a la brevedad.</p>
  `);
}

function reminderEmail(config, apt, svc) {
  const fd = fmtLong(apt.date);
  return emailTemplate(config, 'Recordatorio de tu hora 🔔', `
    <p>Hola <strong>${escHtml(apt.clientName)}</strong>,</p>
    <p>Te recordamos que tienes hora <strong>mañana</strong>:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px 0;color:#6d7a75;width:100px">Servicio</td><td style="padding:8px 0;font-weight:600">${escHtml(svc.name)}</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Fecha</td><td style="padding:8px 0;font-weight:600">${fd}</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Hora</td><td style="padding:8px 0;font-weight:600">${escHtml(apt.time)} hrs</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Duración</td><td style="padding:8px 0">${apt.totalDuration || svc.duration} min</td></tr>
    </table>
    ${emailExtraServices(apt)}${emailAddonsSection(apt, svc)}
    <div style="background:#eee8de;border-radius:8px;padding:14px 18px;margin:16px 0">
      <p style="margin:0;font-size:13px;color:#414f4a">💡 <strong>Recomendación:</strong> Llega 5 minutos antes para comenzar puntualmente.</p>
    </div>
    ${emailLocationSection(config, apt)}
    <p style="font-size:13px;color:#6d7a75">Si no podrás asistir, por favor avísanos con anticipación${config.phone ? ' al ' + escHtml(config.phone) : ''}.</p>
  `);
}

function cancellationEmail(config, apt, svc) {
  const fd = fmtLong(apt.date);
  return emailTemplate(config, 'Hora cancelada', `
    <p>Hola <strong>${escHtml(apt.clientName)}</strong>,</p>
    <p>Lamentamos informarte que tu hora fue cancelada:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr><td style="padding:8px 0;color:#6d7a75;width:100px">Servicio</td><td style="padding:8px 0;font-weight:600">${escHtml(svc.name)}</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Fecha</td><td style="padding:8px 0">${fd}</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Hora</td><td style="padding:8px 0">${escHtml(apt.time)} hrs</td></tr>
    </table>
    <p>Si deseas reagendar, puedes hacerlo desde nuestra página de reservas.</p>
    <p style="font-size:13px;color:#6d7a75">Contáctanos${config.phone ? ' al ' + escHtml(config.phone) : ''} para cualquier consulta.</p>
  `);
}

function adminNewBookingEmail(config, apt, svc) {
  const fd = fmtLong(apt.date);
  return emailTemplate(config, '✨ Nueva reserva', `
    <p>Tienes una nueva reserva pendiente de confirmación:</p>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px 0;color:#6d7a75;width:100px">Cliente</td><td style="padding:8px 0;font-weight:600">${escHtml(apt.clientName)}</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Teléfono</td><td style="padding:8px 0">${escHtml(apt.clientPhone)}</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Email</td><td style="padding:8px 0">${apt.clientEmail ? escHtml(apt.clientEmail) : 'No proporcionado'}</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Servicio</td><td style="padding:8px 0;font-weight:600">${escHtml(svc.name)}</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Fecha</td><td style="padding:8px 0;font-weight:600">${fd}</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Hora</td><td style="padding:8px 0;font-weight:600">${escHtml(apt.time)} hrs</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Duración</td><td style="padding:8px 0">${apt.totalDuration || svc.duration} min</td></tr>
      ${apt.comments ? `<tr><td style="padding:8px 0;color:#6d7a75">Notas</td><td style="padding:8px 0;font-style:italic">${escHtml(apt.comments)}</td></tr>` : ''}
    </table>
    ${emailExtraServices(apt)}${emailAddonsSection(apt, svc)}
    <p style="font-size:13px;color:#6d7a75;margin-top:20px">Ingresa al panel para confirmar o cancelar esta cita.</p>
  `);
}

function giftcardEmail(config, g, paraQuienRecibe) {
  const exp = g.expiresAt ? new Date(g.expiresAt + 'T12:00:00').toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const titulo = paraQuienRecibe ? '🎁 ¡Tienes un regalo!' : '🎁 Tu giftcard está lista';
  const intro = paraQuienRecibe
    ? `<p>Hola <strong>${escHtml(g.toName)}</strong>,</p><p><strong>${escHtml(g.buyerName)}</strong> te regaló un servicio en ${escHtml(config.businessName || 'Synea Studio Spa')}:</p>`
    : `<p>Hola <strong>${escHtml(g.buyerName)}</strong>,</p><p>Esta es la giftcard que preparaste para <strong>${escHtml(g.toName)}</strong>. Puedes reenviarle este correo o entregarle el código.</p>`;
  return emailTemplate(config, titulo, `
    ${intro}
    <div style="background:#fff;border:2px solid #e3d2b4;border-radius:14px;padding:24px;margin:18px 0;text-align:center">
      <p style="margin:0;font-size:11px;letter-spacing:2.4px;text-transform:uppercase;color:#7c5f2f;font-weight:700">Giftcard</p>
      <p style="margin:8px 0 4px;font-size:21px;font-weight:700;color:#23302c">${escHtml(g.serviceName)}</p>
      <p style="margin:0;font-size:13px;color:#6d7a75">Para ${escHtml(g.toName)}</p>
      <div style="margin:16px 0 10px;padding:14px;background:#f8f5f0;border:1.5px dashed #9dbdb0;border-radius:8px;font-size:26px;font-weight:800;letter-spacing:4px;color:#1e3f36">${escHtml(g.code)}</div>
      ${exp ? `<p style="margin:0;font-size:12.5px;color:#6d7a75">Válida hasta el ${exp}</p>` : ''}
    </div>
    ${g.message ? `<div style="background:#eee8de;border-radius:8px;padding:14px 18px;margin:16px 0"><p style="margin:0;font-size:13px;color:#414f4a;font-style:italic">"${escHtml(g.message)}"</p></div>` : ''}
    <p style="font-size:13px;color:#6d7a75">Para usarla, ${paraQuienRecibe ? 'agenda' : 'quien la reciba debe agendar'} el servicio y presentar este código${config.phone ? ', o escribirnos al ' + escHtml(config.phone) : ''}.</p>
    ${emailLocationSection(config)}
  `);
}

function adminGiftcardEmail(config, g) {
  return emailTemplate(config, '🎁 Nueva giftcard vendida', `
    <p>Se compró una giftcard:</p>
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:8px 0;color:#6d7a75;width:110px">Código</td><td style="padding:8px 0;font-weight:700;letter-spacing:2px">${escHtml(g.code)}</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Servicio</td><td style="padding:8px 0;font-weight:600">${escHtml(g.serviceName)}</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Monto</td><td style="padding:8px 0;font-weight:600;color:#2f5d50">$${(g.price || 0).toLocaleString('es-CL')}</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">La compró</td><td style="padding:8px 0">${escHtml(g.buyerName)} · ${escHtml(g.buyerPhone || '')}</td></tr>
      <tr><td style="padding:8px 0;color:#6d7a75">Para</td><td style="padding:8px 0;font-weight:600">${escHtml(g.toName)}</td></tr>
    </table>
    <p style="font-size:13px;color:#6d7a75;margin-top:20px">Queda <strong>por pagar</strong> hasta que la marques como pagada en el panel.</p>
  `);
}

// ---------------- triggers ----------------

// Nueva reserva -> correo al cliente (si notificaciones ON) + aviso al admin
// (email + push, siempre). Las citas creadas por el admin (source: 'admin')
// no le avisan a sí misma y, si nacen confirmadas, el cliente recibe
// directamente el correo de confirmación.
exports.onAppointmentCreated = onValueCreated(
  { ref: '/appointments/{id}', instance: DB_INSTANCE, secrets: [SMTP_PASSWORD] },
  async (event) => {
    const apt = event.data.val();
    if (!apt || !apt.serviceId) return;
    const [config, svc] = await Promise.all([getConfig(), getService(apt.serviceId)]);
    if (!svc) { logger.warn('Servicio no encontrado', apt.serviceId); return; }
    const adminEmail = config.email || ADMIN_EMAILS[0];
    const biz = config.businessName || 'Synea Studio Spa';
    const fromAdmin = apt.source === 'admin';
    // Canje de giftcard (si la reserva trae código): se marca la giftcard como
    // usada y se refleja en los avisos para que el salón sepa que no se cobra.
    const canje = await canjearGiftcard(event.params.id, apt);
    const avisoGift = canje
      ? (canje.ok
        ? `<div style="background:#f7ecd9;border-left:3px solid #b08b57;padding:12px 16px;margin:16px 0;border-radius:6px"><p style="margin:0;font-size:13px;color:#7c5f2f"><strong>🎁 Canje de giftcard ${escHtml(canje.code)}</strong><br>No se cobra: ya fue pagada${canje.buyerName ? ' por ' + escHtml(canje.buyerName) : ''}.</p></div>`
        : `<div style="background:#f3f7f5;border-left:3px solid #c45656;padding:12px 16px;margin:16px 0;border-radius:6px"><p style="margin:0;font-size:13px;color:#a03d3d"><strong>⚠️ Giftcard ${escHtml(canje.code)} no válida</strong><br>Motivo: ${escHtml(canje.motivo)}. Conviene confirmar con la clienta.</p></div>`)
      : '';
    const tasks = [];
    if (!fromAdmin) {
      // Aviso al admin: siempre (no depende del toggle de notificaciones al cliente)
      tasks.push(sendMail(adminEmail, (canje && canje.ok ? '🎁 Canje de giftcard — ' : 'Nueva reserva — ') + apt.clientName, avisoGift + adminNewBookingEmail(config, apt, svc)));
      // Push inmediato al teléfono/PC del admin (según preferencias)
      if (pushPref(config, 'newBooking')) {
        const fecha = fmtLong(apt.date);
        tasks.push(pushToAdmins(
          canje && canje.ok ? '🎁 Canje de giftcard' : '✨ Nueva reserva',
          `${apt.clientName} — ${svc.name}, ${fecha} a las ${apt.time}` + (canje && canje.ok ? ' · no cobrar' : ''),
          'synea-new-' + (event.params.id || apt.date)
        ));
      }
    }
    // Correo al cliente: solo si las notificaciones están activadas
    if (config.emailNotificationsEnabled !== false && apt.clientEmail) {
      if (apt.status === 'confirmed') {
        tasks.push(sendMail(apt.clientEmail, 'Cita confirmada — ' + biz, confirmedEmail(config, apt, svc), adminEmail));
      } else {
        tasks.push(sendMail(apt.clientEmail, 'Reserva recibida — ' + biz, pendingEmail(config, apt, svc), adminEmail));
      }
    }
    const results = await Promise.allSettled(tasks);
    const fallos = results.filter(r => r.status === 'rejected');
    if (fallos.length) logger.error('Tareas de notificación fallidas', { total: results.length, fallidas: fallos.length, motivos: fallos.map(f => String((f.reason && f.reason.message) || f.reason)) });
  }
);

// Confirmar / cancelar / reagendar -> correo a la clienta + push al admin
// según los toggles de Config (los push no dependen del toggle de correos).
exports.onAppointmentUpdated = onValueUpdated(
  { ref: '/appointments/{id}', instance: DB_INSTANCE, secrets: [SMTP_PASSWORD] },
  async (event) => {
    const before = event.data.before.val();
    const after = event.data.after.val();
    if (!before || !after) return;
    const config = await getConfig();
    const svc = await getService(after.serviceId);
    const svcLabel = svc ? svc.name : 'Servicio';
    const fecha = fmtLong(after.date);
    const id = event.params.id || after.date;
    const tasks = [];

    const statusChanged = before.status !== after.status;
    const moved = after.status !== 'cancelled' && (before.date !== after.date || before.time !== after.time);

    // --- Push al admin (útil con dos administradoras: cada una se entera
    //     de lo que hizo la otra) ---
    if (statusChanged && after.status === 'confirmed' && pushPref(config, 'confirmed')) {
      tasks.push(pushToAdmins('✓ Cita confirmada', `${after.clientName} — ${svcLabel}, ${fecha} a las ${after.time}`, 'synea-conf-' + id));
    }
    if (statusChanged && after.status === 'cancelled' && pushPref(config, 'cancelled')) {
      tasks.push(pushToAdmins('✗ Cita cancelada', `${after.clientName} — ${svcLabel}, ${fecha} a las ${after.time}`, 'synea-canc-' + id));
    }
    if (moved && pushPref(config, 'rescheduled')) {
      tasks.push(pushToAdmins('📅 Cita reagendada', `${after.clientName} — ${svcLabel}: ahora ${fecha} a las ${after.time}`, 'synea-resch-' + id));
    }

    // --- Correos a la clienta (respetan el toggle de notificaciones email) ---
    if (config.emailNotificationsEnabled !== false && after.clientEmail && svc) {
      const adminEmail = config.email || ADMIN_EMAILS[0];
      const biz = config.businessName || 'Synea Studio Spa';
      if (statusChanged && after.status === 'confirmed') {
        tasks.push(sendMail(after.clientEmail, 'Cita confirmada — ' + biz, confirmedEmail(config, after, svc), adminEmail));
      } else if (statusChanged && after.status === 'cancelled') {
        tasks.push(sendMail(after.clientEmail, 'Cita cancelada — ' + biz, cancellationEmail(config, after, svc), adminEmail));
      }
      if (moved) {
        tasks.push(sendMail(after.clientEmail, 'Tu cita fue reagendada — ' + biz, rescheduledEmail(config, after, svc, before.date, before.time), adminEmail));
      }
    }
    const results = await Promise.allSettled(tasks);
    const fallos = results.filter(r => r.status === 'rejected');
    if (fallos.length) logger.error('Tareas de notificación fallidas', { total: results.length, fallidas: fallos.length, motivos: fallos.map(f => String((f.reason && f.reason.message) || f.reason)) });
  }
);

// Nueva giftcard -> correo a quien la compra (y a quien la recibe si dejó
// email) + aviso y push al admin.
exports.onGiftcardCreated = onValueCreated(
  { ref: '/giftcards/{id}', instance: DB_INSTANCE, secrets: [SMTP_PASSWORD] },
  async (event) => {
    const g = event.data.val();
    if (!g || !g.code) return;
    const config = await getConfig();
    const adminEmail = config.email || ADMIN_EMAILS[0];
    const biz = config.businessName || 'Synea Studio Spa';
    const tasks = [];
    tasks.push(sendMail(adminEmail, 'Nueva giftcard — ' + g.serviceName, adminGiftcardEmail(config, g)));
    if (pushPref(config, 'newBooking')) {
      tasks.push(pushToAdmins('🎁 Nueva giftcard', `${g.buyerName} regaló ${g.serviceName} a ${g.toName} · ${g.code}`, 'synea-gift-' + (event.params.id || g.code)));
    }
    if (config.emailNotificationsEnabled !== false) {
      if (g.buyerEmail) tasks.push(sendMail(g.buyerEmail, 'Tu giftcard — ' + biz, giftcardEmail(config, g, false), adminEmail));
      if (g.toEmail) tasks.push(sendMail(g.toEmail, '¡Tienes un regalo! — ' + biz, giftcardEmail(config, g, true), adminEmail));
    }
    const results = await Promise.allSettled(tasks);
    const fallos = results.filter(r => r.status === 'rejected');
    if (fallos.length) logger.error('Giftcard: notificaciones fallidas', { fallidas: fallos.length, motivos: fallos.map(f => String((f.reason && f.reason.message) || f.reason)) });
  }
);

// Recordatorio diario: emails a clientes + push al admin con las citas de mañana
exports.dailyReminders = onSchedule(
  { schedule: '0 9 * * *', timeZone: TZ, secrets: [SMTP_PASSWORD] },
  async () => {
    const tomorrow = tomorrowInTZ(TZ);
    const snap = await db().ref('appointments').orderByChild('date').equalTo(tomorrow).get();
    const all = snap.val() || {};
    const list = Object.values(all).filter(a => a && a.status !== 'cancelled');
    if (!list.length) { logger.info('Sin citas mañana', { date: tomorrow }); return; }

    const config = await getConfig();

    // 1) Recordatorios por email a las citas confirmadas (una sola vez)
    if (config.emailNotificationsEnabled !== false) {
      for (const [id, apt] of Object.entries(all)) {
        if (!apt || apt.status !== 'confirmed' || !apt.clientEmail || apt.reminderSent) continue;
        const svc = await getService(apt.serviceId);
        if (!svc) continue;
        try {
          await sendMail(apt.clientEmail, 'Recordatorio: tu hora es mañana — ' + (config.businessName || 'Synea Studio Spa'), reminderEmail(config, apt, svc), config.email || undefined);
          await db().ref('appointments/' + id + '/reminderSent').set(true);
        } catch (e) { logger.error('Recordatorio falló', { id, err: e.message }); }
      }
    }

    // 2) Push al admin con el resumen de mañana (según preferencias)
    if (pushPref(config, 'dailySummary')) await sendAdminPush(list, tomorrow);
  }
);

// Envía un push a todos los dispositivos del admin y limpia tokens muertos.
async function pushToAdmins(title, body, tag) {
  const tokensSnap = await db().ref('adminPushTokens').get();
  const tokensObj = tokensSnap.val() || {};
  const keys = [], tokens = [];
  for (const [k, v] of Object.entries(tokensObj)) { if (v && v.token) { keys.push(k); tokens.push(v.token); } }
  if (!tokens.length) return;

  const resp = await admin.messaging().sendEachForMulticast({
    tokens,
    data: { title: String(title), body: String(body), url: '/', tag: String(tag) },
    webpush: { headers: { TTL: '86400' } }
  });

  await Promise.allSettled(resp.responses.map((r, i) => {
    if (r.success) return null;
    const code = (r.error && r.error.code) || '';
    if (/registration-token-not-registered|invalid-argument|invalid-registration-token/.test(code)) {
      return db().ref('adminPushTokens/' + keys[i]).remove();
    }
    return null;
  }));
  logger.info('Push admin enviado', { title, ok: resp.successCount, fail: resp.failureCount });
}

async function sendAdminPush(list, tomorrow) {
  list.sort((a, b) => String(a.time).localeCompare(String(b.time)));
  const n = list.length;
  const title = `${n} cita${n > 1 ? 's' : ''} mañana`;
  const body = `${n === 1 ? 'Tienes 1 cita' : 'Tienes ' + n + ' citas'} mañana (empieza a las ${list[0].time}). Toca para ver la agenda.`;
  await pushToAdmins(title, body, 'synea-reminder-' + tomorrow);
}

// Fecha de "mañana" (YYYY-MM-DD) en la zona horaria dada.
function tomorrowInTZ(tz) {
  const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = todayStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}
