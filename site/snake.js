// Пасхалка: змейка. Грузится только когда её вызвали (WASD на компьютере, 5 нажатий на плашку
// «Неофициальный сайт» на телефоне), поэтому сайт не утяжеляет. Пока окно закрыто — ничего не работает.
// Управление: стрелки (и WASD) или свайпы. Собрал 7 — на весь экран «67».
(function () {
  "use strict";
  var N = 15, GOAL = 7, el, cv, ctx, info, timer, snake, dir, nextDir, food, eaten, state, cell, touch;

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || "#2456c7"; }

  function build() {
    el = document.createElement("div");
    el.className = "snake";
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", "Змейка");
    el.innerHTML = '<div class="snake-box"><div class="snake-top"><span class="snake-info"></span>' +
      '<button type="button" class="snake-close" aria-label="Закрыть">✕</button></div><canvas></canvas>' +
      '<p class="snake-hint"></p></div><div class="snake-win" hidden>67</div>';
    document.body.appendChild(el);
    cv = el.querySelector("canvas");
    ctx = cv.getContext("2d");
    info = el.querySelector(".snake-info");
    el.querySelector(".snake-close").addEventListener("click", close);
    el.querySelector(".snake-win").addEventListener("click", close);
    cv.addEventListener("click", function () { if (state !== "play") start(); });
    // свайпы — только внутри змейки: сайт под ней не листает дни
    el.addEventListener("touchstart", function (e) {
      e.stopPropagation();
      touch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }, { passive: true });
    el.addEventListener("touchmove", function (e) { e.stopPropagation(); e.preventDefault(); }, { passive: false });
    el.addEventListener("touchend", function (e) {
      e.stopPropagation();
      if (!touch) return;
      var dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
      touch = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      if (state !== "play") { start(); return; }
      turn(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? [1, 0] : [-1, 0]) : (dy > 0 ? [0, 1] : [0, -1]));
    });
  }

  var KEYS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
    KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] };
  function onKey(e) {
    if (e.key === "Escape") { close(); return; }
    var d = KEYS[e.code] || KEYS[e.key];
    if (d) {
      e.preventDefault();
      e.stopPropagation();
      if (state === "play") turn(d);
    } else if ((e.key === " " || e.key === "Enter") && state !== "play") { e.preventDefault(); start(); }
  }
  function turn(d) {
    // развернуться назад в себя нельзя
    if (d[0] === -dir[0] && d[1] === -dir[1]) return;
    nextDir = d;
  }

  function size() {
    var s = Math.min(window.innerWidth - 32, window.innerHeight - 150, 480);
    cell = Math.floor(s / N);
    var px = window.devicePixelRatio || 1;
    cv.width = cell * N * px; cv.height = cell * N * px;
    cv.style.width = cv.style.height = cell * N + "px";
    ctx.setTransform(px, 0, 0, px, 0, 0);
    draw();
  }

  function place() {
    do { food = [Math.floor(Math.random() * N), Math.floor(Math.random() * N)]; }
    while (snake.some(function (p) { return p[0] === food[0] && p[1] === food[1]; }));
  }

  function start() {
    snake = [[7, 7], [6, 7], [5, 7]];
    dir = nextDir = [1, 0];
    eaten = 0;
    state = "play";
    place();
    el.querySelector(".snake-hint").textContent = matchMedia("(hover: hover)").matches ? "Стрелки — повернуть, Esc — выйти" : "Свайпы — повернуть";
    clearTimeout(timer);
    step();
  }

  function step() {
    if (state !== "play") return;
    if (document.hidden) { timer = setTimeout(step, 400); return; } // вкладка в фоне — пауза
    dir = nextDir;
    var head = [snake[0][0] + dir[0], snake[0][1] + dir[1]];
    var hit = head[0] < 0 || head[1] < 0 || head[0] >= N || head[1] >= N ||
      snake.some(function (p, i) { return i < snake.length - 1 && p[0] === head[0] && p[1] === head[1]; });
    if (hit) {
      state = "over";
      el.querySelector(".snake-hint").textContent = "Не вышло — нажмите или свайпните, чтобы заново";
      draw();
      return;
    }
    snake.unshift(head);
    if (head[0] === food[0] && head[1] === food[1]) {
      eaten++;
      if (eaten >= GOAL) { win(); return; }
      place();
    } else snake.pop();
    draw();
    timer = setTimeout(step, Math.max(95, 170 - eaten * 10)); // чуть быстрее с каждой едой
  }

  function draw() {
    if (!snake) return;
    var w = cell * N;
    ctx.fillStyle = css("--card");
    ctx.fillRect(0, 0, w, w);
    ctx.fillStyle = css("--line");
    for (var x = 0; x < N; x++) for (var y = 0; y < N; y++) if ((x + y) % 2) ctx.fillRect(x * cell, y * cell, cell, cell);
    // еда — оранжевая точка, змейка — цвет сайта
    ctx.fillStyle = css("--warn");
    ctx.beginPath();
    ctx.arc((food[0] + 0.5) * cell, (food[1] + 0.5) * cell, cell * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css("--accent");
    snake.forEach(function (p, i) {
      var pad = i ? cell * 0.12 : cell * 0.05;
      ctx.globalAlpha = state === "over" ? 0.45 : 1 - Math.min(i, 12) * 0.03;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(p[0] * cell + pad, p[1] * cell + pad, cell - 2 * pad, cell - 2 * pad, cell * 0.28);
      else ctx.rect(p[0] * cell + pad, p[1] * cell + pad, cell - 2 * pad, cell - 2 * pad);
      ctx.fill();
    });
    ctx.globalAlpha = 1;
    info.textContent = "Собрано " + eaten + " из " + GOAL;
  }

  function win() {
    state = "won";
    draw();
    var w = el.querySelector(".snake-win");
    w.hidden = false;
  }

  function open() {
    if (!el) build();
    if (!el.hidden && el.isConnected && state === "play") return;
    el.hidden = false;
    el.querySelector(".snake-win").hidden = true;
    document.documentElement.classList.add("snake-on");
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", size);
    size();
    start();
  }

  function close() {
    clearTimeout(timer);
    state = "closed";
    el.hidden = true;
    document.documentElement.classList.remove("snake-on");
    document.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", size);
  }

  window.Snake = { open: open };
})();
