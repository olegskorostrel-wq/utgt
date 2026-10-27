// Работа без интернета. Страница и данные (расписания, замены): сначала сеть — чтобы замены были
// свежими, — а без сети последнее сохранённое. Файлы с ?v=… (стили, скрипты) не меняются — из кэша.
// __BUILD__ подставляет build_site.py: новая сборка = новый кэш, старый удаляется.
var CACHE = "utgt-__BUILD__";

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(["./", "manifest.webmanifest", "icons/icon-192.png"]); })
    .then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function fromNetwork(req, key) {
  return fetch(req).then(function (res) {
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(key || req, copy); });
    }
    return res;
  });
}

self.addEventListener("fetch", function (e) {
  var req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || url.origin !== location.origin) return;
  if (url.searchParams.has("v")) {
    // стили и скрипты с версией — неизменны
    e.respondWith(caches.match(req).then(function (hit) { return hit || fromNetwork(req); }));
    return;
  }
  // страница (с любыми ?group=…) хранится под одним ключом
  var key = req.mode === "navigate" ? new Request(new URL("./", location.href)) : new Request(url.origin + url.pathname);
  // медленный интернет: если сеть не ответила за 3 с (страница) или 2 с (данные), а сохранённая копия
  // есть — сразу она. На обычном интернете ответ приходит быстрее, и показывается свежее.
  // (сеть при этом догружает свежее в кэш для следующего раза)
  var net = fromNetwork(req, key);
  var saved = function () {
    return caches.match(key).then(function (hit) { return hit || caches.match(new Request(new URL("./", location.href))); });
  };
  e.respondWith(new Promise(function (resolve, reject) {
    var done = false;
    var timer = setTimeout(function () {
      saved().then(function (hit) { if (hit && !done) { done = true; resolve(hit); } });
    }, req.mode === "navigate" ? 3000 : 2000);
    net.then(function (res) { if (!done) { done = true; clearTimeout(timer); resolve(res); } }, function () {
      clearTimeout(timer);
      saved().then(function (hit) { if (!done) { done = true; hit ? resolve(hit) : reject(new Error("нет сети")); } });
    });
  }));
});
