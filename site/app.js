(function () {
  "use strict";
  var A = window.Agenda, C = window.Calendar;
  var state = { offset: 0, data: null, zamena: {}, open: {} };
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
      getJSON("status.json").catch(function () { return {}; }),
      getJSON("data/calendar.json").catch(function () { return {}; }),
      getJSON("data/news.json").catch(function () { return { items: [] }; }),
      getJSON("data/teachers.json").catch(function () { return { by_short: {} }; }),
      getJSON("data/info.json").catch(function () { return null; })
    ]).then(function (r) {
      state.data = { schedule: r[0], bells: r[1], index: r[2], status: r[3], calendar: r[4], news: r[5],
        teachers: r[6], info: r[7] };
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
    drawCalendar(params.get("date") || now.date);
    drawUseful(now);
    drawTabs();
    $("dayView").hidden = state.offset === "week";
    $("weekView").hidden = state.offset !== "week";
    if (state.offset === "week") return renderWeek(now);
    var date = A.addDays(baseDate(now), state.offset);
    zamenaFor(date).then(function (z) {
      var ag = build(date, z);
      if (date === now.date) A.markNow(ag, now.minutes);
      draw(ag, z, date, now);
    });
  }

  function drawTabs() {
    document.querySelectorAll(".tabs button").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.dataset.day === String(state.offset)));
    });
  }

  // Неделя (пн–сб), в которой сегодняшний день; в воскресенье — следующая
  function renderWeek(now) {
    var base = baseDate(now), wd = A.isoWeekday(base);
    var monday = A.addDays(base, wd === 7 ? 1 : 1 - wd);
    var dates = [0, 1, 2, 3, 4, 5].map(function (i) { return A.addDays(monday, i); });
    Promise.all(dates.map(zamenaFor)).then(function (zs) {
      var days = dates.map(function (d, i) { return build(d, zs[i]); });
      $("title").textContent = "Неделя: " + C.dayMonth(dates[0]) + " — " + C.dayMonth(dates[5]);
      $("week").textContent = days[0].week + "-я неделя";
      $("weekView").innerHTML = days.map(function (ag, i) {
        var d = dates[i], head = A.humanDate(d);
        var body = ag.items.length ? ag.items.map(function (it) {
          return '<li class="' + (it.changed ? "changed" : "") + '"><span class="t">' + it.startText + "</span>" +
            '<span class="s">' + esc(it.subject) + (it.changed ? ' <span class="tag">замена</span>' : "") + "</span>" +
            '<span class="r">' + esc(it.room || "") + "</span></li>";
        }).join("") : '<li class="none">' + (ag.off ? esc(ag.off.reason) : "Занятий нет") + "</li>";
        return '<section class="wday' + (d === now.date ? " today" : "") + '"><h3>' + esc(head) +
          (d === now.date ? ' <span class="tag state">сегодня</span>' : "") + "</h3><ul>" + body + "</ul></section>";
      }).join("") + '<p class="hint">Замены показаны только на дни, на которые их уже опубликовали.</p>';
    });
  }

  // Расписание дня с учётом праздников и каникул из учебного графика
  function build(date, z) {
    var ag = A.build(date, state.data.schedule, state.data.bells, z);
    ag.off = C.dayOff(date, state.data.calendar, state.data.schedule.group);
    if (ag.off && !(z && z.changes.length)) {
      ag.items = [];
      ag.cancelled = [];
    }
    return ag;
  }

  // Строка вверху: каникулы, сессия, ближайший праздник
  function drawCalendar(today) {
    var lines = C.countdown(today, state.data.calendar, state.data.schedule.group);
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
      var where = '<small class="where" data-teacher="' + esc(t.trim()) + '"></small>';
      if (!full) return esc(t) + " — полного имени нет в списке преподавателей на сайте техникума." + where;
      var p = full.split(" ");
      return "<strong>" + esc(full) + "</strong><small>Обращаться: " + esc(p.slice(1).join(" ")) + "</small>" + where;
    }).join("");
  }

  // Расписания всех групп — грузятся только при первом нажатии на урок
  var groupsLoad = null;
  function allGroups() {
    if (!groupsLoad) groupsLoad = getJSON("data/groups/index.json").then(function (ix) {
      return Promise.all(ix.groups.map(function (g) {
        return getJSON("data/groups/" + g.file).then(function (s) { return { group: g.group, schedule: s }; });
      }));
    });
    return groupsLoad;
  }

  function zamenaForGroup(z, group) {
    if (!z) return null;
    var all = z.all_changes;
    return Object.assign({}, z, { changes: all ? (all[group] || []) : (group === z.group ? z.changes : []) });
  }

  // «Где сейчас»: по расписаниям всех групп и сегодняшним заменам (только для сегодняшнего дня)
  function fillWhere(card) {
    var now = A.moscowNow(), date = baseDate(now);
    var spots = card.querySelectorAll(".where");
    if (!spots.length || state.offset !== 0 || date !== now.date) return;
    Promise.all([allGroups(), zamenaFor(date)]).then(function (r) {
      spots.forEach(function (el) {
        var w = Teachers.whereIs(el.dataset.teacher, date, now.minutes, r[0], state.data.bells, state.data.calendar,
          function (g) { return zamenaForGroup(r[1], g); });
        var room = function (l) { return l.room ? "каб. " + l.room : "кабинет не указан"; };
        var parts = [];
        if (w.now) parts.push("Сейчас: " + room(w.now) + ", " + w.now.group + " (до " + w.now.endText + ")");
        if (w.next) parts.push("Дальше: " + w.next.startText + " — " + room(w.next) + ", " + w.next.group);
        if (!w.lessons.length) parts.push("Сегодня по расписанию пар нет");
        else if (!parts.length) parts.push("Пары на сегодня закончились");
        el.textContent = parts.join(" · ");
      });
    }).catch(function () {});
  }

  // «Полезное»: учебная часть (открыто/закрыто сейчас), ссылки, документы для своего курса
  function drawUseful(now) {
    var info = state.data.info;
    $("useful").hidden = !info;
    if (!info) return;
    var o = info.office, st = C.officeStatus(now.date, now.minutes, o, state.data.calendar);
    var course = String(state.data.schedule.group).charAt(0);
    var links = info.links.concat(info.by_course[course] || []);
    $("usefulBody").innerHTML =
      '<div class="office"><strong>' + esc(o.name) + "</strong>" +
      '<span class="status ' + (st.open ? "on" : "off") + '">' + esc(st.text) + "</span>" +
      "<small>Кабинет " + esc(o.room) + ' · <a href="tel:' + esc(o.tel) + '">' + esc(o.phone) + "</a> · " +
      "пн–пт " + o.hours["1"].join("–") + ", сб " + o.hours["6"].join("–") + ", обед " + o.lunch.join("–") +
      "</small></div>" +
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

  function draw(ag, z, date, now) {
    $("title").textContent = A.humanDate(date);
    $("week").textContent = ag.weekday === 7 ? "" : ag.week + "-я неделя";

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
    } else if (ag.off) {
      cls = "ok";
      html = ag.off.kind === "holiday"
        ? "<strong>Выходной — " + esc(ag.off.reason) + "</strong>Занятий нет."
        : "<strong>" + esc(ag.off.reason) + "</strong>Занятий нет до " + C.dayMonth(ag.off.until) + " включительно.";
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
      list.innerHTML = '<div class="empty">' + (ag.off ? esc(ag.off.reason) : ag.weekday === 7 ? "Выходной" : "Занятий нет") + "</div>";
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
        var key = it.startText + " " + it.subject;
        return '<article class="lesson ' + (it.state || "") + (it.changed ? " changed" : "") +
          (state.open[key] ? " open" : "") + '" data-key="' + esc(key) + '" tabindex="0" role="button" aria-expanded="' +
          !!state.open[key] + '">' +
          '<div class="time">' + it.startText + "<small>" + it.endText + "</small></div>" +
          '<div><div class="subj">' + esc(it.subject) + tags + "</div>" +
          '<div class="who">' + [esc(who), n ? '<span class="nw">' + n + "</span>" : ""].filter(Boolean).join(" · ") + "</div></div>" +
          '<div class="room">' + (it.room ? "ауд. " + esc(it.room) : "") + "</div>" +
          '<div class="full">' + teacherInfo(it.teacher) + "</div></article>";
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
    if (state.open[key]) fillWhere(card);
  }
  $("list").addEventListener("click", toggleLesson);
  $("list").addEventListener("keydown", toggleLesson);

  document.querySelectorAll(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      state.offset = b.dataset.day === "week" ? "week" : +b.dataset.day;
      render();
      // переключились снизу длинной страницы — вернуть наверх, к заголовку с датой
      window.scrollTo(0, 0);
    });
  });

  load().then(function () {
    // После окончания занятий или в воскресенье сразу показываем завтра
    var now = A.moscowNow();
    if (!params.get("date")) {
      var today = build(now.date, null);
      var last = today.items[today.items.length - 1];
      if (today.weekday === 7 || !last || now.minutes >= last.end) state.offset = 1;
    }
    render();
    drawNews();
    setInterval(render, 30000);
    setInterval(function () { load().then(function () { render(); drawNews(); }); }, 10 * 60000);
  }).catch(function (e) {
    $("status").textContent = "Не удалось загрузить данные: " + e.message;
  });
})();
