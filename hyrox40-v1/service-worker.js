'use strict';
/* The 'hyrox40-' prefix is an internal cache identifier and must stay: the activate
   handler uses it to delete superseded caches. Bump the version on every shipped
   change so installed PWAs byte-diff this file, re-precache, and pick up the update. */
const CACHE = 'hyrox40-v1.3.0';
const FILES = [
  './', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png',
  './hyrox40-plan-config.json', './src/app.css', './src/app.js', './src/storage.js', './src/timer-engine.js'
];
function refresh(request, response) {
  if (response.ok) { const copy = response.clone(); caches.open(CACHE).then(cache => cache.put(request, copy)); }
  return response;
}
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('hyrox40-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  /* Navigations are network-first so an installed app cannot be pinned to a stale
     shell; the precache still answers when the network is unavailable. */
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).then(response => refresh(request, response)).catch(() => caches.match(request).then(cached => cached || caches.match('./index.html'))));
    return;
  }
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => refresh(request, response)).catch(() => caches.match('./index.html'))));
});
