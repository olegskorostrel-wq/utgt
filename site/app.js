(function () {
  "use strict";
  var A = window.Agenda;
  var state = { offset: 0, data: null, zamena: {} };
  var params = new URLSearchParams(location.search);

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function getJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(url + ": " + r.status);
      return r.json();
    });
  }

  function load() {
    return Promise.all([
      getJSON("data/schedule_11A.json"),
      getJSON("data/bells.json"),
      getJSON("data/zameny/index.json").catch(function () { return { days: [] }; }),
      getJSON("status.json").catch(function () { return {}; })
    ]).then(function (r) {
      state.data = { schedule: r[0], bells: r[1], index: r[2], status: r[3] };
      state.zamena = {};
    });
  }

  function zamenaFor(date) {
    if (state.data.index.days.indexOf(date) < 0) return Promise.resolve(null);
    if (state.zamena[date] !== undefined) return Promise.resolve(state.zamena[date]);
    return getJSON("data/zameny/" + date + ".json")
      .catch(function () { return null; })
      .then(function (z) { state.zamena[date] = z; return z; });
  }

  function baseDate(now) {
    return params.get("date") || now.date;
  }

  function render() {
    var now = A.moscowNow();
    $("clock").textContent = now.time;
    var date = A.addDays(baseDate(now), state.offset);
    zamenaFor(date).then(function (z) {
      var ag = A.build(date, state.data.schedule, state.data.bells, z);
      if (date === now.date) A.markNow(ag, now.minutes);
      draw(ag, z, date, now);
    });
  }

  function draw(ag, z, date, now) {
    $("title").textContent = A.humanDate(date);
    document.querySelectorAll(".tabs button").forEach(function (b) {
      b.setAttribute("aria-selected", String(+b.dataset.day === state.offset));
    });

    // Плашка про замены
    var banner = $("banner"), cls = "info", html;
    if (z) {
      var mine = z.changes.length;
      if (z.po_raspisaniyu) {
        cls = "ok";
        html = "<strong>Замен нет</strong>На сайте техникума: занятия по расписанию.";
      } else if (!z.ocr_ok) {
        cls = "warn";
        html = "<strong>Замены опубликованы, но таблицу распознать не удалось</strong>Посмотрите картинку ниже.";
      } else if (mine) {
        cls = "warn";
        html = "<strong>Есть замены для 11-А</strong>Расписание ниже уже с их учётом." +
          (z.ocr_uncertain ? " Часть текста распознана неуверенно — сверьтесь с картинкой." : "");
      } else {
        cls = z.ocr_uncertain ? "warn" : "ok";
        html = "<strong>Замены опубликованы — 11-А в них нет</strong>" +
          (z.ocr_uncertain ? "Но часть строк распознана неуверенно — проверьте картинку." : "Занятия по обычному расписанию.");
      }
    } else if (ag.weekday === 7) {
      html = "<strong>Воскресенье</strong>Занятий нет.";
    } else {
      html = "<strong>Замен на этот день пока нет</strong>Обычно их публикуют накануне. Сайт проверяет страницу замен несколько раз в день.";
    }
    banner.className = "banner " + cls;
    banner.innerHTML = html;
    banner.hidden = false;

    // Уроки
    var list = $("list");
    if (!ag.items.length) {
      list.innerHTML = '<div class="empty">' + (ag.weekday === 7 ? "Выходной" : "Занятий нет") + "</div>";
    } else {
      list.innerHTML = ag.items.map(function (it) {
        var n = it.lessons.length ? (it.lessons[0] === 0 ? "классный час"
          : (it.lessons.length > 1 ? "уроки " + it.lessons[0] + "–" + it.lessons[it.lessons.length - 1] : "урок " + it.lessons[0])) : "";
        var tags = "";
        if (it.state === "now") tags += '<span class="tag state">идёт</span>';
        if (it.state === "next") tags += '<span class="tag state">далее</span>';
        if (it.changed) tags += '<span class="tag">замена</span>';
        if (it.uncertain) tags += '<span class="tag" title="распознано неуверенно">?</span>';
        var who = [it.teacher, it.was ? "вместо: " + it.was : ""].filter(Boolean).join(" · ");
        return '<article class="lesson ' + (it.state || "") + (it.changed ? " changed" : "") + '">' +
          '<div class="time">' + it.startText + "<small>" + it.endText + "</small></div>" +
          '<div><div class="subj">' + esc(it.subject) + tags + "</div>" +
          '<div class="who">' + [esc(who), n ? '<span class="nw">' + n + "</span>" : ""].filter(Boolean).join(" · ") + "</div></div>" +
          '<div class="room">' + (it.room ? "ауд. " + esc(it.room) : "") + "</div></article>";
      }).join("");
    }

    var c = $("cancelled");
    c.hidden = !ag.cancelled.length;
    c.innerHTML = ag.cancelled.length ? "Отменено: " + ag.cancelled.map(function (x) {
      return "<s>" + esc(x.subject) + "</s> (" + x.startText + "–" + x.endText + ")";
    }).join(", ") : "";

    // Картинки замен
    var imgs = $("images");
    imgs.hidden = !z;
    $("imageList").innerHTML = z ? z.images.map(function (i) {
      return '<a href="' + esc(i.url) + '"><img loading="lazy" src="data/zameny/' + esc(i.file) +
        '" alt="Распоряжение о замене занятий на ' + esc(A.humanDate(date)) + '"></a>';
    }).join("") : "";

    var st = state.data.status;
    $("status").textContent = st.checked_at
      ? "Страница замен проверена: " + st.checked_at.replace("T", " ").slice(0, 16) + " (МСК)" +
        (st.ok === false ? " — последняя проверка завершилась ошибкой" : "")
      : "";
  }

  document.querySelectorAll(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () { state.offset = +b.dataset.day; render(); });
  });

  load().then(function () {
    // После окончания занятий или в воскресенье сразу показываем завтра
    var now = A.moscowNow();
    if (!params.get("date")) {
      var today = A.build(now.date, state.data.schedule, state.data.bells, null);
      var last = today.items[today.items.length - 1];
      if (today.weekday === 7 || !last || now.minutes >= last.end) state.offset = 1;
    }
    render();
    setInterval(render, 30000);
    setInterval(function () { load().then(render); }, 10 * 60000);
  }).catch(function (e) {
    $("status").textContent = "Не удалось загрузить данные: " + e.message;
  });
})();
