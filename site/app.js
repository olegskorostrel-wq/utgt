// Расписание любой группы очного отделения УТЖТ: выбор группы, замены, неделя, «где сейчас преподаватель».
(function () {
  "use strict";
  var A = window.Agenda, C = window.Calendar;
  var STORE_KEY = "utgt-group", WHO_KEY = "utgt-who", TEACHER_KEY = "utgt-teacher", LANG_KEY = "utgt-lang";
  var state = { infoOpen: false, offset: 0, data: null, zamena: {}, group: null, teacher: null, schedules: {}, open: {}, pickWho: "group" };
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
  // «Иностранный язык (английский)» -> «Английский язык»
  function nice(subject) {
    return String(subject).replace(/Иностранный язык \((\S+)\)/g, function (m, l) {
      return l.charAt(0).toUpperCase() + l.slice(1) + " язык";
    });
  }
  // Подгруппы «А / Б»: каждая своей строкой (кабинеты — так же, по порядку)
  function subjectsHTML(subject) {
    var parts = nice(subject).split(" / ");
    if (parts.length < 2) return subjectHTML(parts[0]);
    return parts.map(function (x) { return '<span class="sg">' + subjectHTML(x) + "</span>"; }).join("");
  }
  function roomsHTML(room) {
    if (!room) return "";
    var parts = String(room).split(" / ");
    return parts.length < 2 ? "ауд. " + esc(room) : parts.map(function (r) { return '<span class="sg">' + esc(r) + "</span>"; }).join("");
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
    $("langSwitch").hidden = !!state.teacher;
    $("langToggle").checked = lang() === "немецкий";
    $("dayView").hidden = state.offset === "week";
    $("infoBtn").hidden = state.offset === "week";
    $("weekView").hidden = state.offset !== "week";
    if (state.teacher) return state.offset === "week" ? renderTeacherWeek(now) : renderTeacherDay(now);
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
            '<span class="s">' + esc(nice(it.subject)) + (it.changed ? ' <span class="tag">замена</span>' : "") + "</span>" +
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
    // в распоряжении о замене преподаватель не указан — подставляем того, кто ведёт этот предмет у группы
    ag.items.forEach(function (it) {
      if (it.changed && !it.teacher && it.subject !== A.CANCEL && window.Teachers) {
        it.teacher = Teachers.guessTeacher(schedule, it.subject);
        it.guessed = !!it.teacher;
      }
    });
    // иностранный язык: только своя подгруппа (если язык выбран)
    var off = C.dayOff(date, state.data.calendar, state.group);
    ag = A.forLanguage(ag, lang());
    ag.off = off;
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
    if (!teacher) return "Преподаватель неизвестен — этого предмета нет в расписании группы.";
    var byShort = state.data.teachers.by_short || {};
    return teacher.split(" / ").map(function (t) {
      var full = byShort[t.trim()];
      if (!full) return esc(t) + " — полного имени нет в списке преподавателей на сайте техникума.";
      var p = full.split(" ");
      return "<strong>" + esc(full) + "</strong><small>Обращаться: " + esc(p.slice(1).join(" ")) + "</small>";
    }).join("");
  }

  // Языковая подгруппа: по умолчанию английский (обычное расписание), тумблер — немецкий
  function lang() { return store(LANG_KEY) === "немецкий" ? "немецкий" : "английский"; }

  // Расписания всех групп — для режима преподавателя, грузятся при первом выборе
  function allGroups() {
    return Promise.all(state.data.groups.map(function (g) {
      return scheduleFor(g.group).then(function (s) { return { group: g.group, schedule: s }; });
    }));
  }

  // «Полезное» для выбранной группы: учебная часть, ссылки, документы курса, курсовые, программа ГИА
  function drawUseful(now) {
    var info = state.data.info;
    $("useful").hidden = !info;
    if (!info) return;
    var g = state.group || "", course = g.charAt(0);
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
        var ext = /^https?:/.test(l.url) ? ' target="_blank" rel="noopener"' : "";
        return '<li><a href="' + esc(l.url) + '"' + ext + ">" + esc(l.title) + "</a></li>";
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
    } else if ((C.current(date, state.data.calendar, g) || {}).type === "sessiya") {
      var ses = C.current(date, state.data.calendar, g);
      cls = "warn";
      html = "<strong>Сессия до " + C.dayMonth(ses.to) + "</strong>" +
        (ses.exams && ses.exams.length ? "Экзамены: " + ses.exams.map(esc).join(", ") + ". " : "") +
        "В дни сессии пары по расписанию могут не идти — расписание экзаменов уточняйте у куратора.";
    } else {
      html = "<strong>Замен на этот день пока нет</strong>Обычно их публикуют накануне. Сайт проверяет страницу замен несколько раз в день.";
    }
    showBanner(cls, html);
    drawBase(ag, z, date, schedule);

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
          '<div><div class="subj">' + subjectsHTML(it.subject) + tags + "</div>" +
          '<div class="who">' + [esc(who), n ? '<span class="nw">' + n + "</span>" : ""].filter(Boolean).join(" · ") + "</div></div>" +
          '<div class="room">' + roomsHTML(it.room) + "</div>" +
          '<div class="full"><div><div class="in">' + teacherInfo(it.teacher) +
            "</div></div></div>" +
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
    $("lessonHint").hidden = false;

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

  // «Обычное расписание на <день> (без замен)» — в дни с заменами, чтобы сравнить, не открывая PDF
  function drawBase(ag, z, date, schedule) {
    var box = $("base"), mine = z && z.changes && z.changes.length;
    box.hidden = !mine || state.teacher;
    if (box.hidden) return;
    var base = A.forLanguage(A.build(date, schedule, state.data.bells, null), lang());
    var day = A.humanDate(date).split(",")[0];
    var acc = { "понедельник": "понедельник", "вторник": "вторник", "среда": "среду", "четверг": "четверг",
      "пятница": "пятницу", "суббота": "субботу" }[day.toLowerCase()] || day;
    $("baseTitle").textContent = "Обычное расписание на " + acc + " (без замен)";
    $("baseList").innerHTML = base.items.length ? base.items.map(function (it) {
      var kept = ag.items.some(function (x) { return x.start === it.start && x.subject === it.subject && !x.changed; });
      return '<li class="' + (kept ? "" : "gone") + '"><span class="t">' + it.startText + "</span>" +
        '<span class="s">' + esc(nice(it.subject)) + (it.teacher ? "<small>" + esc(it.teacher) + "</small>" : "") +
        (kept ? "" : ' <span class="tag">изменено</span>') + "</span>" +
        '<span class="r">' + esc(it.room || "") + "</span></li>";
    }).join("") : '<li class="none">По расписанию пар нет</li>';
  }

  // Плашка о заменах спрятана за кнопкой «i» у даты: цвет кнопки — есть ли замены
  function showBanner(cls, html) {
    var banner = $("banner"), btn = $("infoBtn");
    banner.className = "banner " + cls;
    banner.innerHTML = html;
    banner.hidden = !state.infoOpen;
    btn.hidden = false;
    btn.className = "info-btn " + cls;
    btn.setAttribute("aria-expanded", String(state.infoOpen));
    btn.title = html.replace("</strong>", ". ").replace(/<[^>]+>/g, "");
  }

  // ---------- режим преподавателя ----------

  function teacherFull(t) { return (state.data.teachers.by_short || {})[t] || ""; }

  // Пары преподавателя на дату по расписаниям всех групп и заменам
  function teacherDay(date) {
    return Promise.all([allGroups(), zamenaFor(date)]).then(function (r) {
      var d = Teachers.day(state.teacher, date, r[0], state.data.bells, state.data.calendar,
        function (g) { return zamenaForGroup(r[1], g); });
      d.z = r[1];
      d.week = A.weekNumber(date, r[0][0].schedule, r[1]);
      d.weekday = A.isoWeekday(date);
      d.holiday = (state.data.calendar.holidays || []).filter(function (h) { return h.date === date; })[0] || null;
      return d;
    });
  }

  function teacherHeader() {
    var t = state.teacher, full = teacherFull(t);
    document.title = "Расписание УТЖТ · " + t;
    $("groupName").textContent = t;
    $("specialty").textContent = (full ? full + " · " : "") + "расписание преподавателя";
  }

  function lessonsLabel(ls) {
    return ls.length ? (ls[0] === 0 ? "классный час" : ls.length > 1 ? "уроки " + ls[0] + "–" + ls[ls.length - 1] : "урок " + ls[0]) : "";
  }

  function renderTeacherDay(now) {
    var date = A.addDays(params.get("date") || now.date, state.offset);
    teacherDay(date).then(function (d) {
      teacherHeader();
      $("title").textContent = A.humanDate(date);
      $("week").textContent = d.weekday === 7 ? "" : d.week + "-я неделя";
      var nextFound = false;
      d.items.forEach(function (it) {
        if (date !== now.date) return;
        if (now.minutes >= it.end) it.state = "past";
        else if (now.minutes >= it.start) it.state = "now";
        else if (!nextFound) { it.state = "next"; nextFound = true; }
      });

      var banner = $("banner"), cls = "info", html;
      if (d.z && !d.z.po_raspisaniyu) {
        var touched = d.removed.length || d.items.some(function (i) { return i.changed; });
        cls = touched ? "warn" : "ok";
        html = "<strong>Замены на этот день учтены</strong>" +
          (d.removed.length ? "Часть пар снята — см. ниже." : touched ? "Пары по замене отмечены." : "Ваших пар замены не коснулись.");
      } else if (d.z) {
        cls = "ok";
        html = "<strong>Замен нет</strong>На сайте техникума: занятия по расписанию.";
      } else if (d.holiday) {
        cls = "ok";
        html = "<strong>Выходной — " + esc(d.holiday.name) + "</strong>Занятий нет.";
      } else if (d.weekday === 7) {
        html = "<strong>Воскресенье</strong>Занятий нет.";
      } else {
        html = "<strong>Замен на этот день пока нет</strong>Обычно их публикуют накануне. Сайт проверяет страницу замен несколько раз в день.";
      }
      showBanner(cls, html);
      $("base").hidden = true;

      var list = $("list");
      list.innerHTML = d.items.length ? d.items.map(function (it, idx) {
        var tags = "";
        if (it.state === "now") tags += '<span class="tag state">идёт · ещё ' + (it.end - now.minutes) + " " +
          C.plural(it.end - now.minutes, "минута", "минуты", "минут") + "</span>";
        if (it.state === "next") tags += '<span class="tag state">далее</span>';
        if (it.changed) tags += '<span class="tag">замена</span>';
        if (it.uncertain) tags += '<span class="tag" title="распознано неуверенно">?</span>';
        var n = lessonsLabel(it.lessons);
        return '<article class="lesson tlesson ' + (it.state || "") + (it.changed ? " changed" : "") + '" style="--i:' + idx + '">' +
          '<div class="time">' + it.startText + "<small>" + it.endText + "</small></div>" +
          '<div><div class="subj">' + subjectsHTML(it.subject) + tags + "</div>" +
          '<div class="who"><span class="groups">' + it.groups.map(esc).join(", ") + "</span>" +
          (n ? ' · <span class="nw">' + n + "</span>" : "") + "</div></div>" +
          '<div class="room">' + (it.rooms.length ? "ауд. " + it.rooms.map(esc).join(", ") : "") + "</div>" +
          (it.state === "now" ? '<div class="bar"><i style="width:' +
            Math.round(100 * (now.minutes - it.start) / (it.end - it.start)) + '%"></i></div>' : "") + "</article>";
      }).join("") : '<div class="empty">' + (d.holiday ? esc(d.holiday.name) : d.weekday === 7 ? "Выходной" : "Пар нет") + "</div>";

      var c = $("cancelled");
      c.hidden = !d.removed.length;
      c.innerHTML = d.removed.length ? "Снято заменой: " + d.removed.map(function (x) {
        return "<s>" + esc(nice(x.subject)) + "</s> у " + esc(x.group) + " (" + x.startText + "–" + x.endText + ")";
      }).join(", ") : "";
      $("unverified").hidden = true;
      $("lessonHint").hidden = true;
      var z = d.z;
      $("images").hidden = !z || !z.images.length;
      $("imageList").innerHTML = z ? z.images.map(function (i) {
        return '<a href="' + esc(i.url) + '"><img loading="lazy" src="data/zameny/' + esc(i.file) +
          '" alt="Распоряжение о замене занятий на ' + esc(A.humanDate(date)) + '"></a>';
      }).join("") : "";
      drawStatus();
    });
  }

  function renderTeacherWeek(now) {
    var base = params.get("date") || now.date, wd = A.isoWeekday(base);
    var monday = A.addDays(base, wd === 7 ? 1 : 1 - wd);
    var dates = [0, 1, 2, 3, 4, 5].map(function (i) { return A.addDays(monday, i); });
    Promise.all(dates.map(teacherDay)).then(function (days) {
      teacherHeader();
      $("title").textContent = "Неделя: " + C.dayMonth(dates[0]) + " — " + C.dayMonth(dates[5]);
      $("week").textContent = days[0].week + "-я неделя";
      var total = days.reduce(function (n, d) { return n + d.items.length; }, 0);
      $("weekView").innerHTML = '<p class="total">' + total + " " + C.plural(total, "пара", "пары", "пар") + " за неделю</p>" +
        days.map(function (d, i) {
          var date = dates[i];
          var body = d.items.length ? d.items.map(function (it) {
            return '<li class="' + (it.changed ? "changed" : "") + '"><span class="t">' + it.startText + "</span>" +
              '<span class="s">' + esc(nice(it.subject)) + ' <span class="g">' + it.groups.map(esc).join(", ") + "</span>" +
              (it.changed ? ' <span class="tag">замена</span>' : "") + "</span>" +
              '<span class="r">' + it.rooms.map(esc).join(", ") + "</span></li>";
          }).join("") : '<li class="none">' + (d.holiday ? esc(d.holiday.name) : "Пар нет") + "</li>";
          return '<section class="wday' + (date === now.date ? " today" : "") + '" style="--i:' + i + '"><h3>' + esc(A.humanDate(date)) +
            (date === now.date ? ' <span class="tag state">сегодня</span>' : "") +
            (d.items.length ? ' <span class="cnt">' + d.items.length + " " + C.plural(d.items.length, "пара", "пары", "пар") + "</span>" : "") +
            "</h3><ul>" + body + "</ul></section>";
        }).join("") + '<p class="hint">Замены учтены на дни, на которые их уже опубликовали.</p>';
    });
  }

  function drawStatus() {
    var st = state.data.status;
    $("status").textContent = st.checked_at
      ? "Страница замен проверена: " + st.checked_at.replace("T", " ").slice(0, 16) + " (МСК)" +
        (st.ok === false ? " — последняя проверка завершилась ошибкой" : "")
      : "";
  }

  function setTeacher(name) {
    state.teacher = name;
    state.group = null;
    store(WHO_KEY, "teacher");
    store(TEACHER_KEY, name);
    params.delete("group");
    params.set("teacher", name);
    history.replaceState(null, "", "?" + params.toString());
    render(true);
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
    var teachers = state.teacherList || [];
    $("teacherList").innerHTML = teachers.map(function (t) {
      var full = teacherFull(t);
      return '<button type="button" data-teacher="' + esc(t) + '" aria-current="' + (t === state.teacher) + '">' +
        "<strong>" + esc(full || t) + "</strong>" + (full ? "<small>" + esc(t) + "</small>" : "") + "</button>";
    }).join("");
    var who = state.pickWho;
    document.querySelectorAll("#whoSeg button").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.dataset.who === who));
    });
    $("courses").hidden = who !== "group";
    $("teacherList").hidden = who !== "teacher";
    $("pickerTitle").textContent = who === "group" ? "Выберите группу" : "Выберите себя";
    $("pickerClose").hidden = !state.group && !state.teacher;
    $("shareBtn").hidden = !state.group && !state.teacher;
    $("shareBtn").textContent = state.teacher ? "Скопировать ссылку на расписание" : "Скопировать ссылку на группу";
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
        load().then(function () { drawNews(); if (state.group || state.teacher) render(); }).catch(function () {});
      } else if (state.group || state.teacher) render();
    }
    setInterval(tick, 1000);
    function wake() { if (!document.hidden) tick(); }
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pageshow", wake);
    window.addEventListener("focus", wake);
  }

  function setGroup(name) {
    state.group = name;
    state.teacher = null;
    store(STORE_KEY, name);
    store(WHO_KEY, "group");
    params.delete("teacher");
    params.set("group", name);
    history.replaceState(null, "", "?" + params.toString());
    render(true);
  }

  function openPicker() {
    state.pickWho = state.teacher ? "teacher" : "group";
    drawPicker();
    var d = $("picker");
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
    // фокус на заголовок, а не на первую группу — иначе 11-П выглядит «уже выбранной»
    var h = $("pickerTitle"); h.tabIndex = -1; h.focus();
  }

  $("groupBtn").addEventListener("click", openPicker);
  $("courses").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-group]");
    if (!b) return;
    setGroup(b.dataset.group);
    $("picker").close();
  });
  $("teacherList").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-teacher]");
    if (!b) return;
    setTeacher(b.dataset.teacher);
    $("picker").close();
  });
  document.querySelectorAll("#whoSeg button").forEach(function (b) {
    b.addEventListener("click", function () {
      state.pickWho = b.dataset.who;
      if (state.pickWho === "teacher" && !state.teacherList) {
        allGroups().then(function (gs) { state.teacherList = Teachers.list(gs); drawPicker(); });
      }
      drawPicker();
    });
  });
  $("picker").addEventListener("cancel", function (e) {
    if (!state.group && !state.teacher) e.preventDefault(); // первый вход: без выбора закрыть нельзя
  });
  $("shareBtn").addEventListener("click", function () {
    var url = location.origin + location.pathname + (state.teacher
      ? "?teacher=" + encodeURIComponent(state.teacher) : "?group=" + encodeURIComponent(state.group));
    var b = $("shareBtn");
    var done = function () { b.textContent = "Ссылка скопирована"; };
    if (navigator.share) navigator.share({ title: (state.teacher || state.group) + " УТЖТ", url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(done, function () { prompt("Ссылка:", url); });
    else prompt("Ссылка:", url);
  });
  // Нажатие на урок — показать/скрыть полное ФИО преподавателя
  function toggleLesson(e) {
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    var card = e.target.closest(".lesson");
    if (!card || !card.querySelector(".full")) return; // у преподавателя карточки не раскрываются
    e.preventDefault();
    var key = card.dataset.key;
    state.open[key] = !state.open[key];
    card.classList.toggle("open", state.open[key]);
    card.setAttribute("aria-expanded", String(state.open[key]));
  }
  $("list").addEventListener("click", toggleLesson);
  $("list").addEventListener("keydown", toggleLesson);

  $("infoBtn").addEventListener("click", function () {
    state.infoOpen = !state.infoOpen;
    $("banner").hidden = !state.infoOpen;
    this.setAttribute("aria-expanded", String(state.infoOpen));
  });

  $("langToggle").addEventListener("change", function (e) {
    store(LANG_KEY, e.target.checked ? "немецкий" : "английский");
    render(true);
  });

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
    // преподаватель: ?teacher=… или запомненный выбор (если в ссылке нет группы)
    var wantedT = params.get("teacher") || (!params.get("group") && store(WHO_KEY) === "teacher" ? store(TEACHER_KEY) : null);
    if (wantedT) {
      return allGroups().then(function (gs) {
        state.teacherList = Teachers.list(gs);
        if (state.teacherList.indexOf(wantedT) < 0) return openPicker();
        state.teacher = wantedT;
        store(WHO_KEY, "teacher");
        store(TEACHER_KEY, wantedT);
        var now = A.moscowNow();
        if (params.get("date")) return render(true);
        return teacherDay(now.date).then(function (d) {
          var last = d.items[d.items.length - 1];
          if (d.weekday === 7 || !last || now.minutes >= last.end) state.offset = 1;
          render(true);
        });
      });
    }
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
