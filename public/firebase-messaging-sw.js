/* Service worker para FCM em background — Draksyon */
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyD4tBKUiCjfeCMFfaZ8ROs5F7UoQ25HrrI",
  authDomain:        "animes-64408.firebaseapp.com",
  databaseURL:       "https://animes-64408-default-rtdb.firebaseio.com",
  projectId:         "animes-64408",
  storageBucket:     "animes-64408.firebasestorage.app",
  messagingSenderId: "887589860807",
  appId:             "1:887589860807:web:0000000000000000000000"
});

const messaging = firebase.messaging();
messaging.onBackgroundMessage(function (payload) {
  const n = (payload && payload.notification) || {};
  self.registration.showNotification(n.title || 'Draksyon', {
    body: n.body || '',
    icon: '/img/logo-blue.jpg',
    badge: '/img/logo-blue.jpg',
    data: (payload && payload.data) || {}
  });
});
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
