/* Service worker приложения «Интенсивное наблюдение».
   Задача — сделать приложение устанавливаемым и доступным без сети.
   Данные пациентов сюда не попадают: кэшируется только сама страница и её ресурсы. */
"use strict";
const CACHE = "icu-mon-2.1.1";
const ASSETS = ["./", "./index.html", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png"];

/* шрифт подключается со сторонних адресов — его храним, остальную стороннюю сеть не трогаем */
const FONT_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

self.addEventListener("install", e => {
  /* addAll падает целиком, если хоть один файл недоступен, поэтому кладём по одному */
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(ASSETS.map(u => c.add(u).catch(() => null)))));
  /* skipWaiting здесь не вызываем: новая версия ждёт, пока её примет сам пользователь,
     иначе страница перезагрузится посреди заполнения формы */
});

self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {});
    const ks = await caches.keys();
    await Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* страница просит применить уже загруженную новую версию */
self.addEventListener("message", e => { if (e.data === "skipWaiting") self.skipWaiting(); });

/* в кэш кладём только полноценные ответы: 404, редиректы и ошибки хранить нельзя */
const storable = r => r && r.ok && (r.type === "basic" || r.type === "cors");

async function put(req, resp){
  if (!storable(resp)) return;
  const copy = resp.clone();
  try { const c = await caches.open(CACHE); await c.put(req, copy); } catch(e) {}
}

/* переходы: сначала сеть (чтобы получать обновления), при отсутствии связи — сохранённая страница */
async function navigation(e){
  try {
    const preload = e.preloadResponse ? await e.preloadResponse : null;
    const resp = preload || await fetch(e.request);
    if (storable(resp)) put("./index.html", resp);
    return resp;
  } catch(err) {
    const cached = await caches.match("./index.html") || await caches.match("./");
    if (cached) return cached;
    throw err;
  }
}

/* свои файлы: отдаём из кэша сразу, а в фоне забираем свежую копию */
async function swr(req){
  const cached = await caches.match(req);
  const network = fetch(req).then(resp => { put(req, resp); return resp; }).catch(() => null);
  return cached || await network || Response.error();
}

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  if (req.mode === "navigate") { e.respondWith(navigation(e)); return; }

  const url = new URL(req.url);
  if (url.origin === self.location.origin) { e.respondWith(swr(req)); return; }

  /* шрифт: он неизменен, поэтому сначала кэш; прочая сторонняя сеть идёт мимо кэша */
  if (FONT_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(resp => { put(req, resp); return resp; })));
  }
});
