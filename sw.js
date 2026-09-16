/* Service worker приложения «Интенсивное наблюдение».
   Задача — сделать приложение устанавливаемым и доступным без сети.
   Данные пациентов сюда не попадают: кэшируется только сама страница и её ресурсы. */
"use strict";
const CACHE = "icu-mon-2.1.0";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", e => {
  /* addAll падает целиком, если хоть один файл недоступен, поэтому кладём по одному */
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(ASSETS.map(u => c.add(u).catch(() => null))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

/* страница просит применить уже загруженную новую версию */
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;

  /* переходы: сначала сеть (чтобы получать обновления), при отсутствии связи — сохранённая страница */
  if (req.mode === "navigate") {
    e.respondWith(fetch(req)
      .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put("./index.html", copy)); return r; })
      .catch(() => caches.match("./index.html").then(r => r || caches.match("./"))));
    return;
  }

  /* остальное: сначала кэш, затем сеть с докладыванием в кэш */
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(resp => {
    if (sameOrigin || resp.ok || resp.type === "opaque") {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return resp;
  })));
});
