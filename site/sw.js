// Работа без интернета. Страница и данные (расписания, замены): сначала сеть — чтобы замены были
// свежими, — а без сети последнее сохранённое. Файлы с ?v=… (стили, скрипты) не меняются — из кэша.
// __BUILD__ подставляет build_site.py: новая сборка = новый кэш, старый удаляется.
var CACHE = "utgt-__BUILD__";

// Сразу при установке сохраняем всё, что нужно для работы без интернета: страницу, стили и скрипты
// (их адреса с ?v=… берём из самой страницы), общие данные, расписания всех групп и последние замены.
var CORE = ["data/groups/index.json", "data/bells.json", "data/zameny/index.json", "status.json", "data/calendar.json",
  "data/news.json", "data/teachers.json", "data/info.json", "manifest.webmanifest", "icons/icon-192.png"];

function keyOf(u) { var x = new URL(u, location.href); return x.searchParams.has("v") ? x.href : x.origin + x.pathname; }

function precache(c) {
  var put = function (u) {
    return fetch(u, { cache: "no-cache" }).then(function (r) { if (r.ok) return c.put(keyOf(u), r); }).catch(function () {});
  };
  return fetch("./", { cache: "no-cache" }).then(function (r) {
    return r.clone().text().then(function (html) {
      var assets = (html.match(/(?:src|href)="([\w.-]+\.(?:js|css)\?v=[0-9a-f]+)"/g) || [])
        .map(function (m) { return m.replace(/^(?:src|href)="|"$/g, ""); });
      return c.put(new URL("./", location.href).href, r).then(function () {
        return Promise.all(assets.concat(CORE).map(put));
      });
    });
  }).then(function () {
    return Promise.all([
      fetch("data/groups/index.json").then(function (r) { return r.json(); }).then(function (ix) {
        return Promise.all(ix.groups.map(function (g) { return put("data/groups/" + g.file); }));
      }),
      fetch("data/zameny/index.json").then(function (r) { return r.json(); }).then(function (ix) {
        return Promise.all(ix.days.slice(-4).map(function (d) { return put("data/zameny/" + d + ".json"); }));
      })
    ]);
  }).catch(function () {});
}

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(CACHE).then(precache).then(function () { return self.skipWaiting(); }));
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
      caches.open(CACHE).then(function (c) { c.put(key || req.url, copy); });
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
  var key = req.mode === "navigate" ? new URL("./", location.href).href : url.origin + url.pathname;
  // медленный интернет: если сеть не ответила за 2 с, а сохранённая копия
  // есть — сразу она. На обычном интернете ответ приходит быстрее, и показывается свежее.
  // (сеть при этом догружает свежее в кэш для следующего раза)
  var net = fromNetwork(req, key);
  // сохранённая копия с пометкой — сайт по ней показывает «Показано сохранённое»
  var saved = function () {
    return caches.match(key)
      .then(function (hit) {
        if (!hit) return hit;
        return hit.blob().then(function (body) {
          var h = new Headers(hit.headers);
          h.set("X-Utgt-Saved", "1");
          return new Response(body, { status: hit.status, statusText: hit.statusText, headers: h });
        });
      });
  };
  e.respondWith(new Promise(function (resolve, reject) {
    var done = false;
    var timer = setTimeout(function () {
      saved().then(function (hit) { if (hit && !done) { done = true; resolve(hit); } });
    }, 2000);
    net.then(function (res) { if (!done) { done = true; clearTimeout(timer); resolve(res); } }, function () {
      clearTimeout(timer);
      saved().then(function (hit) { if (!done) { done = true; hit ? resolve(hit) : reject(new Error("нет сети")); } });
    });
  }));
});
