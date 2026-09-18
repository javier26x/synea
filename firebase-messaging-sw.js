/* Synea Studio Spa - Service Worker
 * - PWA: hace la app instalable y sirve un fallback offline mínimo.
 * - FCM: recibe notificaciones push en segundo plano (citas de mañana).
 *
 * Debe estar en la raíz del sitio: /firebase-messaging-sw.js
 */

importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.8.0/firebase-messaging-compat.js');

// Debe coincidir con el firebaseConfig de index.html.
firebase.initializeApp({
  apiKey: 'AIzaSyBh8rWlkZBeN44B6NmHoXdV-naa05PD9OA',
  authDomain: 'synea-app.firebaseapp.com',
  projectId: 'synea-app',
  storageBucket: 'synea-app.firebasestorage.app',
  messagingSenderId: '135290756716',
  appId: '1:135290756716:web:e84ae7bc4861107fa60249'
});

const messaging = firebase.messaging();

// Mensajes en segundo plano. El servidor manda "data" (no "notification") para
// que no se dupliquen y para controlar aquí cómo se muestra.
messaging.onBackgroundMessage((payload) => {
  const d = payload.data || {};
  const title = d.title || 'Synea Studio Spa';
  const options = {
    body: d.body || 'Tienes horas próximamente',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: d.tag || 'synea-reminder',
    data: { url: d.url || '/' }
  };
  return self.registration.showNotification(title, options);
});

// Al tocar la notificación, enfoca la pestaña abierta o abre la app.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) { c.navigate(url); return c.focus(); }
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});

// --- PWA mínima (necesario para que sea instalable) ---
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Passthrough de red. No cacheamos index.html para no servir versiones viejas.
self.addEventListener('fetch', (event) => {
  // Deja que el navegador maneje todo normalmente.
  return;
});
