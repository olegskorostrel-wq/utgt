// Раскладка для компьютера: слева колонка (группа, дата, часы, отсчёты, «Полезное», «Новости»),
// справа — пары и таблица замен рядом, неделя сеткой. Включается только на широком экране
// с мышью, поэтому на телефоне (даже повёрнутом) её не будет. На телефоне страница не меняется.
(function () {
  "use strict";
  var mq = window.matchMedia("(min-width: 1024px) and (hover: hover) and (pointer: fine)");
  var wrap = document.querySelector("main.wrap");
  var order = Array.prototype.slice.call(wrap.children); // исходный порядок — чтобы вернуть как было
  var day = document.getElementById("dayView");
  var dayOrder = Array.prototype.slice.call(day.children);
  var side, main, dayMain;

  function on() {
    side = document.createElement("aside");
    side.className = "desk-side";
    main = document.createElement("div");
    main.className = "desk-main";
    [".top", "#news", "#whereD", "#useful", ".foot"].forEach(function (s) {
      var el = wrap.querySelector(s);
      if (el) side.appendChild(el);
    });
    [".tabs", "#weekView", "#dayView"].forEach(function (s) {
      var el = wrap.querySelector(s);
      if (el) main.appendChild(el);
    });
    // в дне: слева пары, справа таблица замен
    dayMain = document.createElement("div");
    dayMain.className = "desk-day";
    dayOrder.forEach(function (el) { if (el.id !== "images") dayMain.appendChild(el); });
    day.insertBefore(dayMain, day.firstChild);
    wrap.appendChild(side);
    wrap.appendChild(main);
    document.documentElement.classList.add("desk");
  }

  function off() {
    document.documentElement.classList.remove("desk");
    dayOrder.forEach(function (el) { day.appendChild(el); });
    if (dayMain) dayMain.remove();
    order.forEach(function (el) { wrap.appendChild(el); });
    if (side) side.remove();
    if (main) main.remove();
    side = main = dayMain = null;
  }

  function apply() {
    var want = mq.matches;
    if (want && !side) on();
    else if (!want && side) off();
  }
  apply();
  if (mq.addEventListener) mq.addEventListener("change", apply);
  else if (mq.addListener) mq.addListener(apply);
})();
