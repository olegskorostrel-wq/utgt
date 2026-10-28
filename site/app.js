// Расписание любой группы очного отделения УТЖТ: выбор группы, замены, неделя, «где сейчас преподаватель».
(function () {
  "use strict";
  var A = window.Agenda, C = window.Calendar;
  var STORE_KEY = "utgt-group", WHO_KEY = "utgt-who", TEACHER_KEY = "utgt-teacher", LANG_KEY = "utgt-lang";
  var state = { weekOpen: {}, infoOpen: false, offset: 0, data: null, zamena: {}, group: null, teacher: null, schedules: {}, open: {}, pickWho: "group" };
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
  // В карточке — коротко (полное название видно по нажатию на урок):
  // «Основы безопасности и защиты Родины» -> «ОБЗР», хвосты «(по видам транспорта)» убираются
  var SHORT = { "Основы безопасности и защиты Родины": "ОБЗР", "Безопасность жизнедеятельности": "БЖД" };
  function nice(subject) {
    return String(subject).split(" / ").map(function (x) {
      x = x.trim();
      return SHORT[x] || x.replace(/Иностранный язык \((\S+)\)/, function (m, l) {
        return l.charAt(0).toUpperCase() + l.slice(1) + " язык";
      }).replace(/\s*\(по видам[^)]*\)\s*$/, "");
    }).join(" / ");
  }
  // Полное название, если в карточке оно сокращено
  function fullSubject(subject) {
    return nice(subject) === subject ? "" : '<small class="fullsubj">' + esc(subject) + "</small>";
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
      // ответ из сохранённой копии (нет сети или она слишком медленная) — показать это над расписанием
      if (r.headers.get("X-Utgt-Saved") && !state.savedHit) {
        state.savedHit = true;
        if (state.data) setTimeout(function () { drawCalendar(params.get("date") || A.moscowNow().date); }, 0);
      }
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
    state.savedHit = false;
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
      state.loadedAt = A.moscowNow().time;
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
    state.animNext = animate ? (animate === "next" || animate === "prev" ? animate : true) : false;
    if (animate) {
      // старое содержимое прячем сразу — новое появится одной анимацией, когда будет готово
      ["dayView", "weekView"].forEach(function (id) { $(id).classList.add("pending"); });
      clearTimeout(render.safety);
      render.safety = setTimeout(function () {
        ["dayView", "weekView"].forEach(function (id) { $(id).classList.remove("pending"); });
      }, 2500);
    }
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

  // Плавное появление карточек — только для нового содержимого и только когда его просили
  function animIn(el) {
    el.classList.remove("anim", "slide-next", "slide-prev", "pending");
    if (!state.animNext) return;
    void el.offsetWidth; // перезапуск анимации
    // свайп — блок въезжает целиком с той стороны; иначе карточки появляются по очереди
    el.classList.add(state.animNext === "next" || state.animNext === "prev" ? "slide-" + state.animNext : "anim");
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
          var by = state.data.teachers.by_short || {};
          var who = String(it.teacher || "").split(" / ").map(function (t) { return by[t.trim()] || t.trim(); }).filter(Boolean).join(" / ");
          return '<li class="' + (it.changed ? "changed" : "") + '"><span class="t">' + it.startText + "</span>" +
            '<span class="s">' + esc(nice(it.subject)) + (it.changed ? ' <span class="tag">замена</span>' : "") + "</span>" +
            '<span class="r">' + esc(it.room || "") + "</span>" +
            detHTML(it, [nice(it.subject) !== it.subject ? it.subject : "", who, it.was ? "Было по расписанию: " + nice(it.was) : ""]) + "</li>";
        }).join("") : '<li class="none">' + (ag.off ? esc(ag.off.reason) : "Занятий нет") + "</li>";
        return weekDayHTML(d, i, now, A.humanDate(d) + (d === now.date ? ' <span class="tag state">сегодня</span>' : ""), body, ag.items.length);
      }).join("") + '<p class="hint">Замены показаны только на дни, на которые их уже опубликовали.</p>';
      animIn($("weekView"));
    });
  }

  // Неделя: нажатие на день раскрывает его — время до, номера уроков, полные названия и ФИО
  function detHTML(it, lines) {
    var n = it.lessons && it.lessons.length ? (it.lessons[0] === 0 ? "классный час"
      : it.lessons.length > 1 ? "уроки " + it.lessons[0] + "–" + it.lessons[it.lessons.length - 1] : "урок " + it.lessons[0]) : "";
    var parts = [it.startText + "–" + it.endText + (n ? " · " + n : "")].concat(lines.filter(Boolean));
    return '<span class="det">' + parts.map(esc).join("<br>") + "</span>";
  }
  function weekDayHTML(date, i, now, headHTML, body, count) {
    var open = !!state.weekOpen[date];
    return '<section class="wday' + (date === now.date ? " today" : "") + (open ? " open" : "") + '" style="--i:' + i +
      '" data-date="' + date + '"' + (count ? ' tabindex="0" role="button" aria-expanded="' + open + '"' : "") + "><h3>" +
      headHTML.charAt(0).toUpperCase() + headHTML.slice(1) + "</h3><ul>" + body + "</ul></section>";
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
    var key = [today, state.group, navigator.onLine, state.data.status.checked_at, state.savedHit, state.loadedAt].join("|");
    if (drawCalendar.key === key) return;
    drawCalendar.key = key;
    var lines = C.countdown(today, state.data.calendar, state.group);
    // свежесть данных: только что загружено с сервера или показана сохранённая копия
    if (!navigator.onLine || state.savedHit) {
      var st = state.data.status.checked_at;
      lines.unshift({ kind: "offline", text: (navigator.onLine ? "Медленный интернет" : "Нет интернета") +
        " — показано сохранённое" + (st ? " (данные от " + st.slice(8, 10) + "." + st.slice(5, 7) + " " + st.slice(11, 16) + ")" : "") });
    } else if (state.loadedAt) {
      lines.unshift({ kind: "fresh", text: "Обновлено в " + state.loadedAt });
    }
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
    var key = [state.group, state.teacher, now.date, now.minutes, !!installEvt, standalone()].join("|");
    if (drawUseful.key === key) return;
    drawUseful.key = key;
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
      installHTML() +
      '<button type="button" class="history-btn" id="historyBtn">История замен' +
        "<small>все распоряжения о заменах по дням, начиная с 19 октября</small></button>" +
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
          '<div class="full"><div><div class="in">' + fullSubject(it.subject) + teacherInfo(it.teacher) +
            "</div></div></div>" +
          (it.state === "now" ? '<div class="bar"><i style="width:' +
            Math.round(100 * (now.minutes - it.start) / (it.end - it.start)) + '%"></i></div>' : "") + "</article>";
      }).join("");
    }

    animIn($("dayView"));
    var c = $("cancelled");
    c.hidden = !ag.cancelled.length;
    c.innerHTML = ag.cancelled.length ? "Отменено: " + ag.cancelled.map(function (x) {
      return "<s>" + esc(x.subject) + "</s> (" + x.startText + "–" + x.endText + ")";
    }).join(", ") : "";
    $("unverified").hidden = !!schedule.verified;
    $("lessonHint").hidden = false;

    $("images").hidden = !z || !z.images.length;
    $("imageList").innerHTML = imagesHTML(z, date);

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
      var by = state.data.teachers.by_short || {};
      var who = String(it.teacher || "").split(" / ").map(function (t) { return by[t.trim()] || t.trim(); }).filter(Boolean).join(" / ");
      return '<li class="' + (kept ? "" : "gone") + '" tabindex="0" role="button"><span class="t">' + it.startText + "</span>" +
        '<span class="s"><span class="nm">' + esc(nice(it.subject)) + "</span>" + (it.teacher ? "<small>" + esc(it.teacher) + "</small>" : "") +
        (kept ? "" : ' <span class="tag">изменено</span>') + "</span>" +
        '<span class="r">' + esc(it.room || "") + "</span>" +
        detHTML(it, [nice(it.subject) !== it.subject ? it.subject : "", who]) + "</li>";
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

  // Картинка распоряжения: на сайте — только таблица замен, на всю ширину (на телефоне читается);
  // нажатие открывает полный лист. Рамку таблицы находит scraper.py (images[].table).
  function imagesHTML(z, date) {
    if (!z) return "";
    return z.images.map(function (i) {
      var alt = "Распоряжение о замене занятий на " + esc(A.humanDate(date));
      var src = "data/zameny/" + esc(i.file);
      var t = i.table;
      if (!t) return '<a href="' + esc(i.url) + '"><img loading="lazy" src="' + src + '" alt="' + alt + '"></a>';
      var pad = 6, x0 = Math.max(0, t[0] - pad), y0 = Math.max(0, t[1] - pad),
        w = Math.min(t[4], t[2] + pad) - x0, h = Math.min(t[5], t[3] + pad) - y0;
      var pct = function (v) { return (100 * v / w).toFixed(3) + "%"; };
      return '<a class="crop" href="' + src + '" style="aspect-ratio:' + w + "/" + h + '">' +
        '<img loading="lazy" src="' + src + '" alt="' + alt + '" style="width:' + pct(t[4]) +
        ";margin-left:-" + pct(x0) + ";margin-top:-" + pct(y0) + '"></a>' +
        '<a class="full-link" href="' + src + '" target="_blank" rel="noopener">Открыть распоряжение целиком</a>';
    }).join("");
  }

  // История замен (из архива): все распоряжения по дням, от новых к старым; день раскрывается
  // в таблицу по всем группам, своя группа — первой и выделена
  function openHistory() {
    var mine = state.group, d = $("history");
    $("historyTitle").textContent = "История замен";
    $("historyHint").textContent = "Загрузка…";
    $("historyList").innerHTML = "";
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
    getJSON("data/history/all.json").then(function (h) {
      var first = h.days.length ? h.days[h.days.length - 1].date : null;
      $("historyHint").innerHTML = '<span class="hnote">История ведётся с начала работы сайта' +
        (first ? " — первое сохранённое распоряжение на " + esc(C.dayMonth(first)) : "") +
        ". Более ранних замен здесь нет.</span>" + (h.days.length
          ? h.days.length + " " + C.plural(h.days.length, "распоряжение", "распоряжения", "распоряжений") +
            ". Нажмите на день, чтобы раскрыть." + (mine ? " Группа " + esc(mine) + " выделена." : "")
          : "Архив пока пуст.");
      $("historyList").innerHTML = h.days.map(function (day) {
        var wd = A.isoWeekday(day.date), names = Object.keys(day.groups);
        names.sort(function (a, b) { return (b === mine) - (a === mine) || a.localeCompare(b, "ru"); });
        var week = (day.title.match(/[12]\s*-?\s*я\s+неделя/i) || [""])[0];
        var count = day.po_raspisaniyu ? "занятия по расписанию" : names.length + " " + C.plural(names.length, "группа", "группы", "групп") +
          (mine && day.groups[mine] ? " · есть " + mine : "");
        var rows = names.map(function (g) {
          return day.groups[g].map(function (r, k) {
            var ls = r.lessons || [], cancel = r.subject === A.CANCEL;
            var t = ls.length ? A.lessonTime(state.data.bells, wd, ls[0]) : null;
            var when = ls.length ? (ls[0] === 0 ? "кл. час" : ls.length > 1 ? ls[0] + "–" + ls[ls.length - 1] : String(ls[0])) : (r.time || "");
            return '<tr class="' + (g === mine ? "mine" : "") + (k === 0 ? " first" : "") + '"><td class="g">' + (k === 0 ? esc(g === "?" ? "группа?" : g) : "") +
              '</td><td class="u">' + esc(when) + (t ? "<small>" + fromMinutes(t.start) + "</small>" : "") + "</td>" +
              '<td class="s' + (cancel ? " cancel" : "") + '">' + (cancel ? "Отменено" : esc(nice(r.subject))) +
              (r.uncertain ? ' <span class="tag">?</span>' : "") + '</td><td class="r">' + esc(r.room || "") + "</td></tr>";
          }).join("");
        }).join("");
        var imgs = (day.images || []).map(function (f) {
          return '<a href="data/history/img/' + esc(f) + '" target="_blank" rel="noopener">картинка распоряжения</a>';
        }).join(" · ");
        return '<details class="hday"><summary><strong>' + esc(A.humanDate(day.date)) + "</strong>" +
          (week ? " <small>" + esc(week) + "</small>" : "") + '<span class="cnt">' + esc(count) + "</span></summary>" +
          (rows ? '<table><thead><tr><th>Группа</th><th>Урок</th><th>Дисциплина</th><th>Ауд.</th></tr></thead><tbody>' + rows + "</tbody></table>" : "") +
          (imgs ? '<p class="himg">' + imgs + "</p>" : "") + "</details>";
      }).join("");
    }).catch(function () { $("historyHint").textContent = "Не удалось загрузить историю."; });
  }
  function fromMinutes(m) { return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
  $("usefulBody").addEventListener("click", function (e) { if (e.target.closest("#historyBtn")) openHistory(); });

  // ---------- приложение (PWA): установка с учётом браузера, работа без интернета ----------

  var installEvt = null;
  function standalone() {
    return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  }
  // Как установить в этом браузере: { button: true } или { text: "…" }; null — уже установлено
  function installWay() {
    if (standalone()) return null;
    if (installEvt) return { button: true };
    var ua = navigator.userAgent;
    var ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    var android = /Android/.test(ua);
    var inApp = /Telegram|VKAndroidApp|VKClient|vkontakte|Instagram|FBAN|FBAV|OKApp/i.test(ua) || (android && /; wv\)/.test(ua));
    if (inApp) return { text: "Сайт открыт внутри другого приложения (Телеграм, ВК…) — отсюда установить нельзя. " +
      "Откройте его в браузере: меню ⋮ или ⋯ → «Открыть в браузере», и установите там." };
    if (ios) {
      if (/CriOS|EdgiOS/.test(ua)) return { text: "Нажмите «Поделиться» (квадрат со стрелкой в адресной строке) → " +
        "«На экран „Домой“» → «Добавить». Нужен iOS 16.4 или новее; если пункта нет — откройте сайт в Safari." };
      if (/FxiOS|YaBrowser|OPiOS/.test(ua)) return { text: "В этом браузере на iPhone установить нельзя. " +
        "Откройте сайт в Safari → «Поделиться» (квадрат со стрелкой) → «На экран „Домой“» → «Добавить»." };
      return { text: "Нажмите «Поделиться» (квадрат со стрелкой внизу экрана) → прокрутите вниз → " +
        "«На экран „Домой“» → «Добавить»." };
    }
    if (android) {
      if (/SamsungBrowser/.test(ua)) return { text: "Меню ☰ (внизу справа) → «Добавить страницу на» → «Главный экран»." };
      if (/YaBrowser/.test(ua)) return { text: "Меню ⋮ → «Добавить ярлык» (или «Установить приложение»)." };
      if (/Firefox/.test(ua)) return { text: "Меню ⋮ → «Установить» (или «Добавить на главный экран»)." };
      if (/OPR|Opera/.test(ua)) return { text: "Меню ⋮ → «Главный экран» (или «Установить приложение»)." };
      return { text: "Меню ⋮ (вверху справа) → «Установить приложение» или «Добавить на главный экран»." };
    }
    if (/Firefox/.test(ua)) return { text: "Firefox на компьютере не устанавливает сайты как приложения — откройте сайт в Chrome, Edge или Яндекс Браузере." };
    if (/Safari/.test(ua) && !/Chrome|Chromium|Edg/.test(ua)) return { text: "Safari на Mac: меню «Файл» → «Добавить в Dock»." };
    return { text: "Значок установки ⊕ в правой части адресной строки, или меню ⋮ → «Установить приложение»." };
  }
  function installHTML() {
    var w = installWay();
    if (!w) return "";
    return '<div class="install"><strong>Установить как приложение</strong>' +
      '<ul class="plus"><li>В одно касание</li><li>На весь экран</li><li>Без интернета</li>' +
        "<li>Сразу своя группа</li><li>Обновляется само</li></ul>" +
      (w.button ? '<button type="button" id="installBtn">Установить</button>' : "<p>" + esc(w.text) + "</p>") + "</div>";
  }
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    installEvt = e;
    if (state.data) drawUseful(A.moscowNow());
  });
  window.addEventListener("appinstalled", function () {
    installEvt = null;
    if (state.data) drawUseful(A.moscowNow());
  });
  $("usefulBody").addEventListener("click", function (e) {
    if (!e.target.closest("#installBtn") || !installEvt) return;
    installEvt.prompt();
    installEvt.userChoice.then(function () { installEvt = null; drawUseful(A.moscowNow()); });
  });
  // интернет вернулся — сразу подтянуть свежее
  window.addEventListener("online", function () {
    if (state.data) load().then(function () { drawNews(); render(); }).catch(function () { render(); });
  });
  window.addEventListener("offline", function () { if (state.data) render(); });
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
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

      animIn($("dayView"));
      var c = $("cancelled");
      c.hidden = !d.removed.length;
      c.innerHTML = d.removed.length ? "Снято заменой: " + d.removed.map(function (x) {
        return "<s>" + esc(nice(x.subject)) + "</s> у " + esc(x.group) + " (" + x.startText + "–" + x.endText + ")";
      }).join(", ") : "";
      $("unverified").hidden = true;
      $("lessonHint").hidden = true;
      var z = d.z;
      $("images").hidden = !z || !z.images.length;
      $("imageList").innerHTML = imagesHTML(z, date);
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
              '<span class="r">' + it.rooms.map(esc).join(", ") + "</span>" +
              detHTML(it, [nice(it.subject) !== it.subject ? it.subject : "",
                (it.groups.length > 1 ? "Поток: " : "Группа: ") + it.groups.join(", ")]) + "</li>";
          }).join("") : '<li class="none">' + (d.holiday ? esc(d.holiday.name) : "Пар нет") + "</li>";
          return weekDayHTML(date, i, now, A.humanDate(date) + (date === now.date ? ' <span class="tag state">сегодня</span>' : "") +
            (d.items.length ? ' <span class="cnt">' + d.items.length + " " + C.plural(d.items.length, "пара", "пары", "пар") + "</span>" : ""),
            body, d.items.length);
        }).join("") + '<p class="hint">Замены учтены на дни, на которые их уже опубликовали.</p>';
      animIn($("weekView"));
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
      // свежие данные — раз в 10 минут; если показано сохранённое, а интернет есть — пробуем каждую минуту
      if (Date.now() - loaded > (state.savedHit && navigator.onLine ? 50000 : 10 * 60000)) {
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

  function toggleBase(e) {
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    var li = e.target.closest("#baseList li[role=button]");
    if (!li) return;
    e.preventDefault();
    li.classList.toggle("open");
  }
  $("baseList").addEventListener("click", toggleBase);
  $("baseList").addEventListener("keydown", toggleBase);

  // Раскрывающиеся блоки («Обычное расписание», «Новости», «Полезное», дни в истории) — плавно по высоте
  document.addEventListener("click", function (e) {
    var sum = e.target.closest("details > summary");
    if (!sum || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !sum.parentElement.animate) return;
    var d = sum.parentElement;
    e.preventDefault();
    if (d._anim) d._anim.cancel();
    var from = d.offsetHeight, opening = !d.open, to;
    if (opening) { d.open = true; to = d.offsetHeight; }
    else { d.open = false; to = d.offsetHeight; d.open = true; }
    d.style.overflow = "hidden";
    d._anim = d.animate({ height: [from + "px", to + "px"] }, { duration: 600, easing: "cubic-bezier(.33, 1, .68, 1)" });
    d._anim.onfinish = d._anim.oncancel = function () {
      d._anim = null;
      d.style.overflow = "";
      if (!opening) d.open = false;
    };
  });

  function toggleWeekDay(e) {
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    var card = e.target.closest(".wday[role=button]");
    if (!card || e.target.closest("a")) return;
    e.preventDefault();
    var d = card.dataset.date;
    state.weekOpen[d] = !state.weekOpen[d];
    card.classList.toggle("open", state.weekOpen[d]);
    card.setAttribute("aria-expanded", String(state.weekOpen[d]));
  }
  $("weekView").addEventListener("click", toggleWeekDay);
  $("weekView").addEventListener("keydown", toggleWeekDay);

  // Тема: как в телефоне -> светлая -> тёмная -> как в телефоне…
  var THEMES = [
    { id: "auto", name: "Как в телефоне", icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 4v16" /><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/></svg>' },
    { id: "light", name: "Светлая", icon: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>' },
    { id: "dark", name: "Тёмная", icon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg>' }
  ];
  function themeNow() { var t = store("utgt-theme"); return t === "light" || t === "dark" ? t : "auto"; }
  function drawTheme(flash) {
    var t = THEMES.filter(function (x) { return x.id === themeNow(); })[0], b = $("themeBtn");
    b.querySelector(".ico").innerHTML = t.icon;
    b.querySelector(".lbl").textContent = t.name;
    b.title = "Тема: " + t.name;
    if (flash) {
      b.classList.add("show");
      clearTimeout(drawTheme.timer);
      drawTheme.timer = setTimeout(function () { b.classList.remove("show"); }, 1600);
    }
  }
  $("themeBtn").addEventListener("click", function () {
    var i = THEMES.map(function (x) { return x.id; }).indexOf(themeNow()), next = THEMES[(i + 1) % THEMES.length].id;
    var root = document.documentElement;
    root.classList.add("theme-anim");
    if (next === "auto") { delete root.dataset.theme; try { localStorage.removeItem("utgt-theme"); } catch (e) {} }
    else { root.dataset.theme = next; store("utgt-theme", next); }
    drawTheme(true);
    setTimeout(function () { root.classList.remove("theme-anim"); }, 600);
  });
  drawTheme(false);

  $("infoBtn").addEventListener("click", function () {
    state.infoOpen = !state.infoOpen;
    $("banner").hidden = !state.infoOpen;
    this.setAttribute("aria-expanded", String(state.infoOpen));
  });

  $("langToggle").addEventListener("change", function (e) {
    store(LANG_KEY, e.target.checked ? "немецкий" : "английский");
    render(true);
  });

  // Свайп по расписанию: влево — следующая вкладка (Сегодня -> Завтра -> Неделя), вправо — предыдущая
  (function () {
    var TABS = [0, 1, "week"], x0 = null, y0 = 0, t0 = 0;
    var area = document.querySelector("main");
    area.addEventListener("touchstart", function (e) {
      x0 = null;
      if (e.touches.length !== 1 || e.target.closest(".tabs, .switch, input, dialog, .crop")) return;
      x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; t0 = Date.now();
    }, { passive: true });
    area.addEventListener("touchend", function (e) {
      if (x0 === null) return;
      var dx = e.changedTouches[0].clientX - x0, dy = e.changedTouches[0].clientY - y0;
      x0 = null;
      if (Math.abs(dx) < 60 || Math.abs(dx) < 1.8 * Math.abs(dy) || Date.now() - t0 > 800) return;
      var i = TABS.indexOf(state.offset), j = i + (dx < 0 ? 1 : -1);
      if (i < 0 || j < 0 || j >= TABS.length) return;
      state.offset = TABS[j];
      render(dx < 0 ? "next" : "prev");
    }, { passive: true });
  })();

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
