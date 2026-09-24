/* Service worker приложения «Интенсивное наблюдение».
   Задача — сделать приложение устанавливаемым и доступным без сети.
   Данные пациентов сюда не попадают: кэшируется только сама страница и её ресурсы. */
"use strict";
const CACHE = "icu-mon-2.1.1"; /* 2.1.1: прежний кэш мог содержать чужую страницу — при активации удаляется */
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

/* Область действия service worker — весь каталог сайта, включая вложенные приложения
   (например, febrile-neutropenia/). Своими считаются только файлы в корне каталога:
   иначе переход на соседнее приложение перезаписал бы сохранённую страницу ОРИТ. */
const SCOPE = new URL(self.registration.scope);
const isOwn = url => { const u = new URL(url);
  return u.origin === SCOPE.origin && u.pathname.startsWith(SCOPE.pathname) && !u.pathname.slice(SCOPE.pathname.length).includes("/"); };

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const sameOrigin = new URL(req.url).origin === self.location.origin;

  /* переходы на страницы других приложений — без участия service worker */
  if (req.mode === "navigate" && !isOwn(req.url)) return;

  /* переходы: сначала сеть (чтобы получать обновления), при отсутствии связи — сохранённая страница */
  if (req.mode === "navigate") {
    e.respondWith(fetch(req)
      .then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put("./index.html", copy)); return r; })
      .catch(() => caches.match("./index.html").then(r => r || caches.match("./"))));
    return;
  }

  /* остальное: сначала кэш, затем сеть с докладыванием в кэш.
     Запросы страниц других приложений (шрифты, pdf.js и т. п.) идут в сеть напрямую и в кэш ОРИТ не попадают. */
  e.respondWith((async () => {
    const client = e.clientId ? await self.clients.get(e.clientId) : null;
    if ((client && !isOwn(client.url)) || (sameOrigin && !isOwn(req.url))) return fetch(req);
    const hit = await caches.match(req);
    if (hit) return hit;
    const resp = await fetch(req);
    if (sameOrigin || resp.ok || resp.type === "opaque") {
      const copy = resp.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
    }
    return resp;
  })());
});
