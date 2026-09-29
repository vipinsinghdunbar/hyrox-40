'use strict';
const CACHE = 'hyrox40-v1.0.0';
const FILES = [
  './', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png',
  './hyrox40-plan-config.json', './src/app.css', './src/app.js', './src/storage.js', './src/timer-engine.js'
];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('hyrox40-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); }
    return response;
  }).catch(() => caches.match('./index.html'))));
});
