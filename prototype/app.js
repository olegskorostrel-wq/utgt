// Прототип: тот же сайт, но с выбором любой группы очного отделения.
(function () {
  "use strict";
  var A = window.Agenda, C = window.Calendar;
  var STORE_KEY = "utgt-group";
  var state = { offset: 0, data: null, zamena: {}, group: null, schedules: {}, open: {} };
  var params = new URLSearchParams(location.search);

  function $(id) { return document.getElementById(id); }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  // «МДК.03.01 Технологии ...» -> код отдельно, длинное название мельче
  function subjectHTML(text) {
    var m = String(text).match(/^((?:МДК|ПМ|ОП|ОГСЭ|ЕН|УП|ПП)\.?\s?[\d.]+)\s+(.+)$/);
    return m ? '<span class="code">' + esc(m[1]) + '</span> <span class="long">' + esc(m[2]) + "</span>" : esc(text);
  }
  function getJSON(url) {
    return fetch(url, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(url + ": " + r.status);
      return r.json();
    });
  }
  function store(key, value) {
    try {
      if (value === undefined) return localStorage.getItem(key);
      localStorage.setItem(key, value);
    } catch (e) { return null; }
  }

  function load() {
    return Promise.all([
      getJSON("data/groups/index.json"),
      getJSON("data/bells.json"),
      getJSON("data/zameny/index.json").catch(function () { return { days: [] }; }),
      getJSON("status.json").catch(function () { return {}; }),
      getJSON("data/calendar.json").catch(function () { return {}; }),
      getJSON("data/news.json").catch(function () { return { items: [] }; }),
      getJSON("data/teachers.json").catch(function () { return { by_short: {} }; }),
      getJSON("data/info.json").catch(function () { return null; })
    ]).then(function (r) {
      state.data = { groups: r[0].groups, bells: r[1], index: r[2], status: r[3], calendar: r[4], news: r[5],
        teachers: r[6], info: r[7] };
      state.zamena = {};
    });
  }

  function groupInfo(name) {
    return state.data.groups.filter(function (g) { return g.group === name; })[0] || null;
  }

  function scheduleFor(name) {
    if (state.schedules[name]) return Promise.resolve(state.schedules[name]);
    return getJSON("data/groups/" + groupInfo(name).file).then(function (s) {
      state.schedules[name] = s;
      return s;
    });
  }

  function zamenaFor(date) {
    if (state.data.index.days.indexOf(date) < 0) return Promise.resolve(null);
    if (state.zamena[date] !== undefined) return Promise.resolve(state.zamena[date]);
    return getJSON("data/zameny/" + date + ".json")
      .catch(function () { return null; })
      .then(function (z) { state.zamena[date] = z; return z; });
  }

  // Распоряжение одно на весь техникум — вырезаем строки выбранной группы
  function zamenaForGroup(z, group) {
    if (!z) return null;
    var all = z.all_changes;
    var mine = all ? (all[group] || []) : (group === z.group ? z.changes : []);
    return Object.assign({}, z, {
      changes: mine,
      // не по всем строкам распознана группа, или распоряжение старое (без разбивки по группам)
      ocr_uncertain: !all || !!all["?"] || mine.some(function (c) { return c.uncertain; })
    });
  }

  // animate — плавно показать карточки (при открытии и смене вкладки, но не при ежеминутном обновлении)
  function render(animate) {
    var now = A.moscowNow();
    $("clock").textContent = now.time;
    $("dayView").classList.toggle("anim", !!animate);
    $("weekView").classList.toggle("anim", !!animate);
    var g = state.group;
    drawCalendar(params.get("date") || now.date);
    drawUseful(now);
    document.querySelectorAll(".tabs button").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.dataset.day === String(state.offset)));
    });
    $("dayView").hidden = state.offset === "week";
    $("weekView").hidden = state.offset !== "week";
    if (state.offset === "week") return renderWeek(now);
    var date = A.addDays(params.get("date") || now.date, state.offset);
    Promise.all([scheduleFor(g), zamenaFor(date)]).then(function (r) {
      var schedule = r[0], z = zamenaForGroup(r[1], g);
      var ag = build(date, schedule, z);
      if (date === now.date) A.markNow(ag, now.minutes);
      draw(ag, z, date, schedule, now);
    });
  }

  // Неделя (пн–сб), в которой сегодняшний день; в воскресенье — следующая
  function renderWeek(now) {
    var base = params.get("date") || now.date, wd = A.isoWeekday(base), g = state.group;
    var monday = A.addDays(base, wd === 7 ? 1 : 1 - wd);
    var dates = [0, 1, 2, 3, 4, 5].map(function (i) { return A.addDays(monday, i); });
    Promise.all([scheduleFor(g)].concat(dates.map(zamenaFor))).then(function (r) {
      var schedule = r[0];
      var days = dates.map(function (d, i) { return build(d, schedule, zamenaForGroup(r[i + 1], g)); });
      document.title = "Расписание УТЖТ · " + g;
      $("groupName").textContent = g;
      $("title").textContent = "Неделя: " + C.dayMonth(dates[0]) + " — " + C.dayMonth(dates[5]);
      $("week").textContent = days[0].week + "-я неделя";
      $("weekView").innerHTML = days.map(function (ag, i) {
        var d = dates[i];
        var body = ag.items.length ? ag.items.map(function (it) {
          return '<li class="' + (it.changed ? "changed" : "") + '"><span class="t">' + it.startText + "</span>" +
            '<span class="s">' + esc(it.subject) + (it.changed ? ' <span class="tag">замена</span>' : "") + "</span>" +
            '<span class="r">' + esc(it.room || "") + "</span></li>";
        }).join("") : '<li class="none">' + (ag.off ? esc(ag.off.reason) : "Занятий нет") + "</li>";
        return '<section class="wday' + (d === now.date ? " today" : "") + '" style="--i:' + i + '"><h3>' + esc(A.humanDate(d)) +
          (d === now.date ? ' <span class="tag state">сегодня</span>' : "") + "</h3><ul>" + body + "</ul></section>";
      }).join("") + '<p class="hint">Замены показаны только на дни, на которые их уже опубликовали.</p>';
    });
  }

  // Расписание дня с учётом праздников, каникул и практики из учебного графика группы
  function build(date, schedule, z) {
    var ag = A.build(date, schedule, state.data.bells, z);
    ag.off = C.dayOff(date, state.data.calendar, state.group);
    if (ag.off && !(z && z.changes.length)) {
      ag.items = [];
      ag.cancelled = [];
    }
    return ag;
  }

  function drawCalendar(today) {
    var lines = C.countdown(today, state.data.calendar, state.group);
    var ul = $("calendar");
    ul.hidden = !lines.length;
    ul.innerHTML = lines.map(function (l) {
      return '<li class="cal-' + l.kind + '">' + esc(l.text) +
        (l.exams ? "<small>Экзамены: " + l.exams.map(esc).join(", ") + "</small>" : "") + "</li>";
    }).join("");
  }

  // «Изъюрова Н.М.» -> полное ФИО и как обращаться (по имени-отчеству)
  function teacherInfo(teacher) {
    if (!teacher) return "Преподаватель в замене не указан.";
    var byShort = state.data.teachers.by_short || {};
    return teacher.split(" / ").map(function (t) {
      var full = byShort[t.trim()];
      if (!full) return esc(t) + " — полного имени нет в списке преподавателей на сайте техникума.";
      var p = full.split(" ");
      return "<strong>" + esc(full) + "</strong><small>Обращаться: " + esc(p.slice(1).join(" ")) + "</small>";
    }).join("");
  }

  // «Полезное» для выбранной группы: учебная часть, ссылки, документы курса, курсовые, программа ГИА
  function drawUseful(now) {
    var info = state.data.info;
    $("useful").hidden = !info;
    if (!info) return;
    var g = state.group, course = g.charAt(0);
    var cg = (state.data.calendar.groups || {})[g] || {};
    var o = info.office, st = C.officeStatus(now.date, now.minutes, o, state.data.calendar);
    var links = info.links.concat(info.by_course[course] || []);
    var gia = course === "4" && cg.specialty && info.gia_by_specialty[cg.specialty.code];
    if (gia) links.push({ title: "Программа ГИА " + cg.specialty.code + " (на " + info.gia_year + " уч. год)", url: gia });
    var cw = cg.courseworks || {}, cwHtml = Object.keys(cw).map(function (sem) {
      return "<li>" + sem + " семестр: " + cw[sem].map(esc).join("; ") + "</li>";
    }).join("");
    $("usefulBody").innerHTML =
      '<div class="office"><strong>' + esc(o.name) + "</strong>" +
      '<span class="status ' + (st.open ? "on" : "off") + '">' + esc(st.text) + "</span>" +
      "<small>Кабинет " + esc(o.room) + ' · <a href="tel:' + esc(o.tel) + '">' + esc(o.phone) + "</a> · " +
      "пн–пт " + o.hours["1"].join("–") + ", сб " + o.hours["6"].join("–") + ", обед " + o.lunch.join("–") +
      "</small></div>" +
      (cwHtml ? '<div class="office"><strong>Курсовые работы и проекты</strong><ul class="plain">' + cwHtml + "</ul></div>" : "") +
      "<ul>" + links.map(function (l) {
        return '<li><a href="' + esc(l.url) + '" target="_blank" rel="noopener">' + esc(l.title) + "</a></li>";
      }).join("") + "</ul>";
  }

  function drawNews() {
    var items = (state.data.news.items || []).slice(0, 5);
    $("news").hidden = !items.length;
    $("newsList").innerHTML = items.map(function (n) {
      return '<li><a href="' + esc(n.url) + '" target="_blank" rel="noopener">' + esc(n.title) + "</a>" +
        (n.date ? "<small>" + esc(n.date) + "</small>" : "") + "</li>";
    }).join("");
  }

  function draw(ag, z, date, schedule, now) {
    var g = state.group;
    document.title = "Расписание УТЖТ · " + g;
    $("groupName").textContent = g;
    $("title").textContent = A.humanDate(date);
    $("week").textContent = ag.weekday === 7 ? "" : ag.week + "-я неделя";
    var spec = ((state.data.calendar.groups || {})[g] || {}).specialty;
    $("specialty").textContent = spec ? spec.code + " " + spec.name : "";

    var banner = $("banner"), cls = "info", html;
    if (z) {
      if (z.po_raspisaniyu) {
        cls = "ok";
        html = "<strong>Замен нет</strong>На сайте техникума: занятия по расписанию.";
      } else if (!z.ocr_ok) {
        cls = "warn";
        html = "<strong>Замены опубликованы, но таблицу распознать не удалось</strong>Посмотрите картинку ниже.";
      } else if (z.changes.length) {
        cls = "warn";
        html = "<strong>Есть замены для " + esc(g) + "</strong>Расписание ниже уже с их учётом." +
          (z.ocr_uncertain ? " Часть текста распознана неуверенно — сверьтесь с картинкой." : "");
      } else {
        cls = z.ocr_uncertain ? "warn" : "ok";
        html = "<strong>Замены опубликованы — " + esc(g) + " в них нет</strong>" +
          (z.ocr_uncertain ? "Но часть строк распознана неуверенно — проверьте картинку." : "Занятия по обычному расписанию.");
      }
    } else if (ag.off) {
      cls = "ok";
      html = ag.off.kind === "holiday"
        ? "<strong>Выходной — " + esc(ag.off.reason) + "</strong>Занятий нет."
        : "<strong>" + esc(ag.off.reason) + "</strong>Занятий по расписанию нет до " + C.dayMonth(ag.off.until) + " включительно.";
    } else if (ag.weekday === 7) {
      html = "<strong>Воскресенье</strong>Занятий нет.";
    } else {
      html = "<strong>Замен на этот день пока нет</strong>Обычно их публикуют накануне. Сайт проверяет страницу замен несколько раз в день.";
    }
    banner.className = "banner " + cls;
    banner.innerHTML = html;
    banner.hidden = false;

    var list = $("list");
    if (!ag.items.length) {
      list.innerHTML = '<div class="empty">' + (ag.off ? esc(ag.off.reason) : ag.weekday === 7 ? "Выходной" : "Занятий нет") + "</div>";
    } else {
      list.innerHTML = ag.items.map(function (it, idx) {
        var n = it.lessons.length ? (it.lessons[0] === 0 ? "классный час"
          : (it.lessons.length > 1 ? "уроки " + it.lessons[0] + "–" + it.lessons[it.lessons.length - 1] : "урок " + it.lessons[0])) : "";
        var tags = "";
        if (it.state === "now") tags += '<span class="tag state">идёт · ещё ' + (it.end - now.minutes) + " " +
          C.plural(it.end - now.minutes, "минута", "минуты", "минут") + "</span>";
        if (it.state === "next") tags += '<span class="tag state">далее</span>';
        if (it.changed) tags += '<span class="tag">замена</span>';
        if (it.uncertain) tags += '<span class="tag" title="распознано неуверенно">?</span>';
        var who = [it.teacher, it.was ? "вместо: " + it.was : ""].filter(Boolean).join(" · ");
        var key = it.startText + " " + it.subject;
        return '<article class="lesson ' + (it.state || "") + (it.changed ? " changed" : "") +
          (state.open[key] ? " open" : "") + '" style="--i:' + idx + '" data-key="' + esc(key) + '" tabindex="0" role="button" aria-expanded="' +
          !!state.open[key] + '">' +
          '<div class="time">' + it.startText + "<small>" + it.endText + "</small></div>" +
          '<div><div class="subj">' + subjectHTML(it.subject) + tags + "</div>" +
          '<div class="who">' + [esc(who), n ? '<span class="nw">' + n + "</span>" : ""].filter(Boolean).join(" · ") + "</div></div>" +
          '<div class="room">' + (it.room ? "ауд. " + esc(it.room) : "") + "</div>" +
          '<div class="full"><div><div class="in">' + teacherInfo(it.teacher) + "</div></div></div>" +
          (it.state === "now" ? '<div class="bar"><i style="width:' +
            Math.round(100 * (now.minutes - it.start) / (it.end - it.start)) + '%"></i></div>' : "") + "</article>";
      }).join("");
    }

    var c = $("cancelled");
    c.hidden = !ag.cancelled.length;
    c.innerHTML = ag.cancelled.length ? "Отменено: " + ag.cancelled.map(function (x) {
      return "<s>" + esc(x.subject) + "</s> (" + x.startText + "–" + x.endText + ")";
    }).join(", ") : "";
    $("unverified").hidden = !!schedule.verified;

    $("images").hidden = !z || !z.images.length;
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

  // ---------- выбор группы ----------

  function drawPicker() {
    var byCourse = {};
    state.data.groups.forEach(function (g) { (byCourse[g.course] = byCourse[g.course] || []).push(g); });
    $("courses").innerHTML = Object.keys(byCourse).sort().map(function (k) {
      return '<section class="course"><h3>' + k + " курс</h3><div class=\"grid\">" +
        byCourse[k].map(function (g) {
          return '<button type="button" data-group="' + esc(g.group) + '" aria-current="' +
            (g.group === state.group) + '">' + esc(g.group) + "</button>";
        }).join("") + "</div></section>";
    }).join("");
    $("pickerClose").hidden = !state.group;
    $("shareBtn").hidden = !state.group;
  }

  // Живое обновление: часы — каждую секунду, расписание — при смене минуты, данные — раз в 10 минут;
  // при возврате на вкладку (телефон «замораживает» страницу в фоне) — сразу.
  function startLive() {
    var start = A.moscowNow(), shown = start.time, day = start.date, loaded = Date.now();
    function tick() {
      var now = A.moscowNow();
      if (now.time === shown) return;
      shown = now.time;
      if (now.date !== day && !params.get("date")) { day = now.date; state.offset = 0; }
      if (Date.now() - loaded > 10 * 60000) {
        loaded = Date.now();
        load().then(function () { drawNews(); if (state.group) render(); }).catch(function () {});
      } else if (state.group) render();
    }
    setInterval(tick, 1000);
    function wake() { if (!document.hidden) tick(); }
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pageshow", wake);
    window.addEventListener("focus", wake);
  }

  function setGroup(name) {
    state.group = name;
    store(STORE_KEY, name);
    params.set("group", name);
    history.replaceState(null, "", "?" + params.toString());
    render(true);
  }

  function openPicker() {
    drawPicker();
    var d = $("picker");
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
  }

  $("groupBtn").addEventListener("click", openPicker);
  $("courses").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-group]");
    if (!b) return;
    setGroup(b.dataset.group);
    $("picker").close();
  });
  $("picker").addEventListener("cancel", function (e) {
    if (!state.group) e.preventDefault(); // первый вход: без группы закрыть нельзя
  });
  $("shareBtn").addEventListener("click", function () {
    var url = location.origin + location.pathname + "?group=" + encodeURIComponent(state.group);
    var b = $("shareBtn");
    var done = function () { b.textContent = "Ссылка скопирована"; };
    if (navigator.share) navigator.share({ title: state.group + " УТЖТ", url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { prompt("Ссылка:", url); });
    else prompt("Ссылка:", url);
  });
  // Нажатие на урок — показать/скрыть полное ФИО преподавателя
  function toggleLesson(e) {
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    var card = e.target.closest(".lesson");
    if (!card) return;
    e.preventDefault();
    var key = card.dataset.key;
    state.open[key] = !state.open[key];
    card.classList.toggle("open", state.open[key]);
    card.setAttribute("aria-expanded", String(state.open[key]));
  }
  $("list").addEventListener("click", toggleLesson);
  $("list").addEventListener("keydown", toggleLesson);

  document.querySelectorAll(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      state.offset = b.dataset.day === "week" ? "week" : +b.dataset.day;
      render(true);
      // переключились снизу длинной страницы — вернуть наверх, к заголовку с датой
      window.scrollTo(0, 0);
    });
  });

  load().then(function () {
    drawNews();
    var wanted = params.get("group") || store(STORE_KEY);
    if (wanted && groupInfo(wanted)) {
      state.group = wanted;
      store(STORE_KEY, wanted);
      return scheduleFor(wanted).then(function (s) {
        var now = A.moscowNow();
        if (!params.get("date")) {
          var today = build(now.date, s, null);
          var last = today.items[today.items.length - 1];
          if (today.weekday === 7 || !last || now.minutes >= last.end) state.offset = 1;
        }
        render(true);
      });
    }
    openPicker();
  }).then(function () {
    startLive();
  }).catch(function (e) {
    $("status").textContent = "Не удалось загрузить данные: " + e.message;
  });
})();
