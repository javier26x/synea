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

// --------------------------------------------------------------- PWA offline --
// Antes esto era un passthrough vacío: la app instalada, sin señal, mostraba la
// pantalla de error del navegador. Ahora guarda una copia del cascarón (la
// página y los iconos) y la sirve cuando la red no responde. Los datos siguen
// viniendo de Firebase: sin conexión la app abre y avisa, no inventa reservas.
const CACHE = 'synea-shell-v2';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/logo.png', '/icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(SHELL))
      .catch(() => { })          // sin red al instalar: se llenará al navegar
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // Firebase y compañía tienen que ir siempre a la red: son datos, no cascarón.
  if (url.origin !== self.location.origin) return;

  // La página y el manifest: primero la red, para no servir una versión vieja
  // (el manifest no lleva ?v= y servirlo de caché dejaba los accesos directos
  // congelados). Si no hay red, se entrega la última copia guardada.
  if (req.mode === 'navigate' || url.pathname === '/manifest.webmanifest') {
    const clave = req.mode === 'navigate' ? '/index.html' : req;
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copia = res.clone();
            caches.open(CACHE).then((c) => c.put(clave, copia)).catch(() => { });
          }
          return res;
        })
        .catch(() => caches.match(clave).then((r) => r || caches.match('/')))
    );
    return;
  }

  // Iconos: de la copia, y se refresca por detrás. Van versionados con ?v=, así
  // que cambiarlos cambia la URL y entra solo.
  if (url.pathname.startsWith('/icons/')) {
    event.respondWith(
      caches.match(req).then((hit) => {
        const red = fetch(req).then((res) => {
          if (res && res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => { });
          return res;
        }).catch(() => hit);
        return hit || red;
      })
    );
  }
});
