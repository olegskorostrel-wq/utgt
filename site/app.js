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
  // Кабинет на уточнении: «?» — неизвестен, «2-?» — известен только корпус
  // (в узкой колонке — коротко «ауд. ?», полностью «Кабинет на уточнении» — при нажатии на пару)
  function roomLabel(r) { return /-\?$/.test(r) ? "корп. " + r.charAt(0) : r; }
  function roomsHTML(room) {
    if (!room) return "";
    var parts = String(room).split(" / ").map(roomLabel);
    return parts.length < 2 ? (/^(\d|\?)/.test(parts[0]) ? "ауд. " : "") + esc(parts[0]) : parts.map(function (r) { return '<span class="sg">' + esc(r) + "</span>"; }).join("");
  }
  // Где кабинет: «Ауд. 1-28: 2 этаж, левое крыло» (этажи — data/rooms.json, со слов куратора;
  // корпус и так виден по первой цифре номера)
  function roomPlaces(room) {
    var R = (state.data.rooms || {}).rooms || {};
    return String(room || "").split(" / ").filter(Boolean).map(function (r) {
      if (r === "?") return "Кабинет на уточнении";
      if (/-\?$/.test(r)) return "Корпус " + r.charAt(0) + ", кабинет на уточнении";
      return R[r] ? "Ауд. " + r + ": " + R[r] : "";
    }).filter(Boolean);
  }

  function getJSON(url) {
    // запрос, начатый ещё в <head> (см. index.html), — забираем его ответ, второй раз не качаем
    // (только в первые полминуты — позже это уже устаревший ответ)
    var pre = window.__pre && window.__pre[url];
    if (pre) delete window.__pre[url];
    if (pre && Date.now() - window.__preAt > 30000) pre = null;
    return (pre || fetch(url, { cache: "no-cache" })).then(function (r) {
      if (!r.ok) throw new Error(url + ": " + r.status);
      // ответ из сохранённой копии (нет сети или она слишком медленная) — показать это над расписанием
      if (r.headers.get("X-Utgt-Saved") && !state.savedHit) {
        state.savedHit = true;
        if (state.data) setTimeout(function () { drawCalendar(params.get("date") || A.moscowNow().date); }, 0);
      }
      return r.json();
    });
  }
  var COUNTER = "https://script.google.com/macros/s/AKfycbxkVNaEgJqjMkCRt3MrcpXpaPKZ1DfhEt3qnq1Uv9LedPD5AfvjnugSVbdtS1OsFXNB/exec";
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
      getJSON("data/info.json").catch(function () { return null; }),
      getJSON("data/rooms.json").catch(function () { return {}; })
    ]).then(function (r) {
      state.data = { groups: r[0].groups, bells: r[1], index: r[2], status: r[3], calendar: r[4], news: r[5],
        teachers: r[6], info: r[7], rooms: r[8] };
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
    setClock(now.time);
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

  // Заголовок дня/недели: при смене — «печатается» по буквам за то же время, что появляются пары
  function setTitle(text) {
    var h = $("title");
    text = text.charAt(0).toUpperCase() + text.slice(1);
    if (h.getAttribute("aria-label") === text && !state.animNext) return;
    h.setAttribute("aria-label", text);
    if (!state.animNext || reducedMotion()) { h.textContent = text; return; }
    h.innerHTML = typeHTML(text, 650, 0); // вся строка — за ~0,65 с, как карточки
  }

  function reducedMotion() { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
  // Разметка «печати»: буквы появляются по очереди за total мс после delay мс;
  // буквы сгруппированы по словам — переносится только между словами
  function typeHTML(text, total, delay) {
    var step = total / Math.max(text.length, 1), i = 0;
    return text.split(" ").map(function (word) {
      var w = '<span class="w" aria-hidden="true">' + word.split("").map(function (ch) {
        return '<span class="ch" style="animation-delay:' + Math.round(delay + i++ * step) + 'ms">' + esc(ch) + "</span>";
      }).join("") + "</span>";
      i++; // пробел
      return w;
    }).join(" ");
  }
  // Короткая надпись (группа в кнопке, заголовок окна) «печатается», только когда меняется;
  // настоящий текст — в aria-label или спрятанном для глаз span
  function typeInto(el, text, force) {
    if (!force && el.dataset.typed === text) return;
    el.dataset.typed = text;
    if (reducedMotion()) { el.textContent = text; return; }
    el.innerHTML = '<span class="sr">' + esc(text) + "</span>" + typeHTML(text, Math.min(450, text.length * 40), 0);
  }

  // Часы: сменившиеся цифры мягко «перекатываются» снизу
  function setClock(time) {
    var el = $("clock"), prev = el.dataset.time || "";
    if (prev === time) return;
    el.dataset.time = time;
    if (reducedMotion()) { el.textContent = time; return; }
    el.innerHTML = time.split("").map(function (ch, i) {
      return ch === prev.charAt(i) ? esc(ch) : '<span class="roll">' + esc(ch) + "</span>";
    }).join("");
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
      typeInto($("groupName"), g);
      setTitle("Неделя: " + C.dayMonth(dates[0]) + " — " + C.dayMonth(dates[5]));
      $("week").textContent = days[0].week + "-я неделя";
      $("weekView").innerHTML = days.map(function (ag, i) {
        var d = dates[i];
        var body = ag.items.length ? ag.items.map(function (it) {
          var by = state.data.teachers.by_short || {};
          var who = String(it.teacher || "").split(" / ").map(function (t) { return by[t.trim()] || t.trim(); }).filter(Boolean).join(" / ");
          return '<li class="' + (it.changed ? "changed" : "") + '"><span class="t">' + it.startText + "</span>" +
            '<span class="s">' + esc(nice(it.subject)) + (it.changed ? ' <span class="tag">замена</span>' : "") + "</span>" +
            '<span class="r">' + esc(String(it.room || "").split(" / ").map(roomLabel).join(" / ")) + "</span>" +
            detHTML(it, [nice(it.subject) !== it.subject ? it.subject : "", who, it.was ? "Было по расписанию: " + nice(it.was) : ""].concat(roomPlaces(it.room))) + "</li>";
        }).join("") : '<li class="none">' + (ag.off ? esc(ag.off.reason) : "Занятий нет") + "</li>";
        return weekDayHTML(d, i, now, d === now.date ? ' <span class="tag state">сегодня</span>' : "", body, ag.items.length);
      }).join("") + '<p class="hint">Замены показаны только на дни, на которые их уже опубликовали.</p>';
      animIn($("weekView"));
    });
  }

  // Неделя: нажатие на день раскрывает его — время до, номера уроков, полные названия и ФИО
  function detHTML(it, lines) {
    var n = it.lessons && it.lessons.length ? (it.lessons[0] === 0 ? "классный час"
      : it.lessons.length > 1 ? "уроки " + it.lessons[0] + "–" + it.lessons[it.lessons.length - 1] : "урок " + it.lessons[0]) : "";
    var parts = [it.startText + "–" + it.endText + (n ? " · " + n : "")].concat(lines.filter(Boolean));
    return '<span class="det"><span>' + parts.map(esc).join("<br>") + "</span></span>";
  }
  // Шапка дня — дата (при смене недели «печатается» вместе с появлением карточки) и метки
  function weekDayHTML(date, i, now, tagsHTML, body, count) {
    var open = !!state.weekOpen[date], text = A.humanDate(date);
    text = text.charAt(0).toUpperCase() + text.slice(1);
    var head = state.animNext && !reducedMotion()
      ? '<span class="sr">' + esc(text) + "</span>" + typeHTML(text, 450, i * 70 + 150) : esc(text);
    return '<section class="wday' + (date === now.date ? " today" : "") + (open ? " open" : "") + '" style="--i:' + i +
      '" data-date="' + date + '"' + (count ? ' tabindex="0" role="button" aria-expanded="' + open + '"' : "") + "><h3>" +
      '<span class="dt">' + head + "</span>" + tagsHTML + "</h3><ul>" + body + "</ul></section>";
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

  // Значок интернета у часов (вайфай: две толстые скруглённые дуги и точка). Цвет — только когда есть повод:
  // всё хорошо — обычный, как текст рядом; медленный интернет или показано сохранённое — жёлтый, внешняя дуга
  // бледная; интернета нет — красный и перечёркнут. Нажатие — пояснение рядом, само пропадает.
  // Состояние проверяется каждые 15 с.
  var NET_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="a2" d="M4.2 11.2a11 11 0 0 1 15.6 0"/>' +
    '<path class="a1" d="M7.8 14.8a6 6 0 0 1 8.4 0"/><circle cx="12" cy="19.2" r="2.1"/><path class="x" d="M5 4l14 16.5"/></svg>';
  function drawNet() {
    var b = $("netBtn"), st = state.data.status.checked_at, kind, text;
    var saved = st ? " (данные от " + st.slice(8, 10) + "." + st.slice(5, 7) + " " + st.slice(11, 16) + ")" : "";
    if (!navigator.onLine || state.net === "off") { kind = "off"; text = "Нет интернета — показано сохранённое" + saved; }
    else if (state.savedHit) { kind = "slow"; text = "Медленный интернет — показано сохранённое" + saved; }
    else if (state.net === "slow") { kind = "slow"; text = "Медленный интернет" + (state.loadedAt ? " — данные обновлены в " + state.loadedAt : ""); }
    else if (state.loadedAt) { kind = "full"; text = "Интернет в порядке — данные обновлены в " + state.loadedAt; }
    else { b.hidden = true; return; }
    if (!b.firstChild) b.innerHTML = NET_SVG;
    b.hidden = false;
    b.className = "net-btn " + kind;
    b.setAttribute("aria-label", text);
    b.dataset.text = text;
    if (!$("netTip").hidden) $("netTip").textContent = text;
  }
  var netTimer;
  function netTip(show) {
    var t = $("netTip");
    clearTimeout(netTimer);
    if (show) {
      t.textContent = $("netBtn").dataset.text;
      t.classList.remove("out");
      t.hidden = false;
      netTimer = setTimeout(function () { netTip(false); }, 4500);
    } else if (!t.hidden) {
      t.classList.add("out");
      netTimer = setTimeout(function () { t.hidden = true; t.classList.remove("out"); }, 250);
    }
  }
  $("netBtn").addEventListener("click", function () { netTip($("netTip").hidden || $("netTip").classList.contains("out")); });
  document.addEventListener("click", function (e) { if (!e.target.closest("#netBtn")) netTip(false); });

  function drawCalendar(today) {
    var key = [today, state.group, navigator.onLine, state.data.status.checked_at, state.savedHit, state.loadedAt].join("|");
    if (drawCalendar.key === key) return;
    drawCalendar.key = key;
    var lines = C.countdown(today, state.data.calendar, state.group);
    drawNet();
    var ul = $("calendar");
    $("countdown").hidden = !lines.length;
    if (!drawCalendar.shown && lines.length) { drawCalendar.shown = true; $("countdown").classList.add("stagger"); }
    else $("countdown").classList.remove("stagger");
    // на строке коротко, полностью — в пояснении по нажатию
    ul.innerHTML = lines.map(function (l, i) {
      var tip = l.text + (l.exams && l.exams.length ? ". Экзамены: " + l.exams.join(", ") : "");
      return '<li class="cal-' + l.kind + '" style="--i:' + i + '" role="button" tabindex="0" data-tip="' + esc(tip) +
        '" aria-label="' + esc(tip) + '">' + esc(l.short || l.text) + "</li>";
    }).join("");
    // полоска: сколько прошло до каникул (или от идущего периода) — по первой строке, где это известно
    var pl = lines.filter(function (l) { return l.progress != null; })[0], bar = $("cdBar");
    bar.hidden = !pl;
    if (pl) {
      bar.className = "cd-bar cal-" + pl.kind;
      bar.setAttribute("aria-label", "Прошло " + Math.round(pl.progress * 100) + "%");
      var fill = bar.firstChild, w = (pl.progress * 100).toFixed(1) + "%";
      if (!fill.style.width) requestAnimationFrame(function () { requestAnimationFrame(function () { fill.style.width = w; }); });
      else fill.style.width = w;
    }
  }

  // Пояснение к метке отсчёта: появляется под меткой, само пропадает через несколько секунд
  var popTimer;
  function popTip(anchor) {
    var t = $("popTip");
    clearTimeout(popTimer);
    if (!anchor || (t.forEl === anchor && !t.hidden && !t.classList.contains("out"))) {
      if (!t.hidden) {
        t.classList.add("out");
        popTimer = setTimeout(function () { t.hidden = true; t.classList.remove("out"); t.forEl = null; }, 250);
      }
      return;
    }
    t.forEl = anchor;
    t.textContent = anchor.dataset.tip;
    t.classList.remove("out");
    t.hidden = false;
    var r = anchor.getBoundingClientRect(), vw = document.documentElement.clientWidth;
    t.style.left = Math.max(16, Math.min(r.left, vw - t.offsetWidth - 16)) + window.scrollX + "px";
    t.style.top = r.bottom + window.scrollY + 6 + "px";
    popTimer = setTimeout(function () { popTip(null); }, 5000);
  }
  function calTap(e) {
    if (e.type === "keydown" && e.key !== "Enter" && e.key !== " ") return;
    var li = e.target.closest("li[data-tip]");
    if (!li) return;
    e.preventDefault();
    popTip(li);
  }
  $("calendar").addEventListener("click", calTap);
  $("calendar").addEventListener("keydown", calTap);
  document.addEventListener("click", function (e) { if (!e.target.closest("#calendar li")) popTip(null); });

  // «Изъюрова Н.М.» -> полное ФИО и как обращаться (по имени-отчеству)
  function teacherInfo(teacher) {
    if (!teacher) return "Преподаватель неизвестен — этого предмета нет в расписании группы.";
    var byShort = state.data.teachers.by_short || {};
    return teacher.split(" / ").map(function (t) {
      var full = byShort[t.trim()];
      if (!full) return esc(t) + " — полного имени нет в списке преподавателей на сайте техникума.";
      return "<strong>" + esc(full) + "</strong>";
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
    var curator = g && (info.curators || {})[g];
    var links = info.links.concat(info.by_course[course] || []);
    var gia = course === "4" && cg.specialty && info.gia_by_specialty[cg.specialty.code];
    if (gia) links.push({ title: "Программа ГИА " + cg.specialty.code + " (на " + info.gia_year + " уч. год)", url: gia });
    var cw = cg.courseworks || {}, cwHtml = Object.keys(cw).map(function (sem) {
      return "<li>" + sem + " семестр: " + cw[sem].map(esc).join("; ") + "</li>";
    }).join("");
    refreshWhere(now);
    $("usefulBody").innerHTML =
      installHTML() +
      '<button type="button" class="history-btn" id="historyBtn">История замен' +
        "<small>все распоряжения о заменах по дням, начиная с 19 октября</small></button>" +
      '<div class="office"><strong>' + esc(o.name) + "</strong>" +
      '<span class="status ' + (st.open ? "on" : "off") + '">' + esc(st.text) + "</span>" +
      "<small>Кабинет " + esc(o.room) + ' · <a href="tel:' + esc(o.tel) + '">' + esc(o.phone) + "</a> · " +
      "пн–пт " + o.hours["1"].join("–") + ", сб " + o.hours["6"].join("–") + ", обед " + o.lunch.join("–") +
      "</small></div>" +
      (curator ? '<div class="office"><strong>Куратор группы</strong><small>' + esc(teacherFull(curator) || curator) + "</small></div>" : "") +
      (cwHtml ? '<div class="office"><strong>Курсовые работы и проекты</strong><ul class="plain">' + cwHtml + "</ul></div>" : "") +
      codesHTML(g) +
      "<ul>" + links.map(function (l) {
        var ext = /^https?:/.test(l.url) ? ' target="_blank" rel="noopener"' : "";
        return '<li><a href="' + esc(l.url) + '"' + ext + ">" + esc(l.title) + "</a></li>";
      }).join("") + "</ul>";
  }

  // «Расшифровка групп»: буква в названии группы — специальность, первая цифра — курс.
  // У одной буквы на разных курсах может быть разный шифр (новые стандарты) — показываем каждый.
  function codesHTML(mine) {
    var groups = (state.data.calendar.groups || {}), by = {}, order = [];
    Object.keys(groups).sort(function (a, b) { return a.localeCompare(b, "ru"); }).forEach(function (g) {
      var sp = groups[g].specialty, letter = g.split("-")[1];
      if (!sp || !letter) return;
      var k = letter + "|" + sp.code + "|" + sp.name;
      if (!by[k]) { by[k] = { letter: letter, code: sp.code, name: sp.name, groups: [] }; order.push(k); }
      by[k].groups.push(g);
    });
    if (!order.length) return "";
    order.sort(function (a, b) { return by[a].letter.localeCompare(by[b].letter, "ru") || by[a].groups[0].localeCompare(by[b].groups[0], "ru"); });
    var own = mine && groups[mine] && groups[mine].specialty;
    return '<div class="office codes"><strong>Расшифровка групп</strong>' +
      (own ? "<p class=\"own\">Группа " + esc(mine) + ": <b>" + esc(own.code) + "</b> " + esc(own.name) + "</p>" : "") +
      "<small>Буква в названии группы — специальность, первая цифра — курс.</small><ul class=\"plain\">" +
      order.map(function (k) {
        var x = by[k];
        return '<li' + (x.groups.indexOf(mine) >= 0 ? ' class="mine"' : "") + '><b class="lt">' + esc(x.letter) + "</b>" +
          "<span><b>" + esc(x.code) + "</b> " + esc(x.name) + "<small>" + x.groups.map(esc).join(", ") + "</small></span></li>";
      }).join("") + "</ul></div>";
  }

  // «Где сейчас преподаватель» (в «Полезном»): поиск по фамилии, быстрые кнопки — преподаватели своей группы.
  // Ответ — по расписаниям всех групп и заменам на сегодня: пара сейчас и следующая, с этажом кабинета.
  var WHERE_KEY = "utgt-where";
  function placeText(room) {
    if (!room) return "кабинет не указан";
    return String(room).split(" / ").map(function (r) {
      if (r === "?") return "кабинет на уточнении";
      var f = ((state.data.rooms || {}).rooms || {})[r];
      return "ауд. " + r + (f ? " (" + f + ")" : "");
    }).join(" / ");
  }
  function drawWhereList() {
    var q = $("whereInput").value.trim().toLowerCase().replace(/ё/g, "е"), list = $("whereList");
    if (!state.teacherList) { list.innerHTML = '<small>Загрузка списка преподавателей…</small>'; return; }
    var names;
    if (q) {
      names = state.teacherList.map(function (t) { return t.name || t; }).filter(function (n) {
        var full = (teacherFull(n) || n).toLowerCase().replace(/ё/g, "е");
        return full.split(" ").some(function (w) { return w.indexOf(q) === 0; }) || n.toLowerCase().replace(/ё/g, "е").indexOf(q) === 0;
      }).slice(0, 8);
      if (!names.length) { list.innerHTML = "<small>Не нашлось — проверьте фамилию.</small>"; return; }
    } else {
      names = state.whereMine || [];
    }
    list.innerHTML = names.map(function (n) {
      return '<button type="button" data-where="' + esc(n) + '"' + (n === state.whereT ? ' aria-current="true"' : "") + ">" + esc(n) + "</button>";
    }).join("");
  }
  function drawWhere() {
    var t = state.whereT, out = $("whereOut");
    if (!t) { out.innerHTML = ""; return; }
    var now = A.moscowNow();
    Promise.all([allGroups(), zamenaFor(now.date)]).then(function (r) {
      if (state.whereT !== t) return;
      var off = C.dayOff(now.date, state.data.calendar, (r[0][0] || {}).group);
      var w = Teachers.whereIs(t, now.date, now.minutes, r[0], state.data.bells, state.data.calendar,
        function (g) { return zamenaForGroup(r[1], g); });
      var html = "<strong>" + esc(teacherFull(t) || t) + "</strong>";
      if (A.isoWeekday(now.date) === 7 || (off && off.kind === "holiday")) {
        html += "<p>Сегодня выходной.</p>";
      } else if (!w.lessons.length) {
        html += "<p>Сегодня по расписанию пар нет.</p>";
      } else {
        html += w.now
          ? '<p><span class="lbl">Сейчас</span>пара у ' + esc(w.now.group) + " до " + w.now.endText + " — " + esc(placeText(w.now.room)) + "</p>"
          : '<p><span class="lbl">Сейчас</span>пары нет</p>';
        html += w.next
          ? '<p><span class="lbl">Дальше</span>в ' + w.next.startText + " у " + esc(w.next.group) + " — " +
            (w.now && w.now.room === w.next.room ? "там же" : esc(placeText(w.next.room))) + "</p>"
          : (w.now ? '<p><span class="lbl">Дальше</span>на сегодня последняя</p>' : '<p><span class="lbl">Дальше</span>сегодня пар больше нет</p>');
      }
      out.innerHTML = html;
      out.dataset.minute = now.date + " " + now.minutes;
    }).catch(function () { out.innerHTML = "<p>Не удалось загрузить расписания — нет интернета?</p>"; });
  }
  function initWhere() {
    if (initWhere.done) return;
    initWhere.done = true;
    state.whereT = store(WHERE_KEY) || null;
    $("whereInput").addEventListener("input", drawWhereList);
    $("whereList").addEventListener("click", function (e) {
      var b = e.target.closest("button[data-where]");
      if (!b) return;
      // повторное нажатие на выбранную фамилию — убрать ответ
      state.whereT = b.dataset.where === state.whereT ? null : b.dataset.where;
      store(WHERE_KEY, state.whereT || "");
      $("whereInput").value = "";
      drawWhereList();
      drawWhere();
    });
  }
  // при каждом обновлении «Полезного»: свои преподаватели для быстрых кнопок и свежий ответ раз в минуту
  function refreshWhere(now) {
    initWhere();
    $("whereD").hidden = false;
    loadTeacherList().then(function () {
      return state.group ? allGroups() : null;
    }).then(function (gs) {
      var mine = [];
      (gs || []).filter(function (x) { return x.group === state.group; }).forEach(function (x) {
        Object.keys(x.schedule.days || {}).forEach(function (d) {
          x.schedule.days[d].forEach(function (l) {
            String(l.teacher || "").split(" / ").forEach(function (t) { t = t.trim(); if (t && mine.indexOf(t) < 0) mine.push(t); });
          });
        });
      });
      state.whereMine = mine.sort(function (a, b) { return a.localeCompare(b, "ru"); });
      if (!$("whereInput").value) drawWhereList();
    }, function () { drawWhereList(); });
    if (state.whereT && $("whereOut").dataset.minute !== now.date + " " + now.minutes) drawWhere();
  }

  // На всякий случай и на самом сайте: без новостей про СВО, беспилотники, военную службу
  var NEWS_BLOCK = /(^|[^а-яё])СВО([^а-яё]|$)|специальн[а-яё]*\s+военн[а-яё]*\s+операц|беспилот|БПЛА|(^|[^а-яё])БАС([^а-яё]|$)|дрон|военн[а-яё]*\s+служб[а-яё]*\s+по\s+контракт|мобилизац|Минобороны|министерств[а-яё]*\s+обороны/i;
  function drawNews() {
    var items = (state.data.news.items || []).filter(function (n) { return !NEWS_BLOCK.test(n.title); }).slice(0, 5);
    $("news").hidden = !items.length;
    $("newsList").innerHTML = items.map(function (n) {
      return '<li><a href="' + esc(n.url) + '" target="_blank" rel="noopener">' + esc(n.title) + "</a>" +
        (n.date ? "<small>" + esc(n.date) + "</small>" : "") + "</li>";
    }).join("");
  }

  function draw(ag, z, date, schedule, now) {
    var g = state.group;
    document.title = "Расписание УТЖТ · " + g;
    typeInto($("groupName"), g);
    setTitle(A.humanDate(date));
    $("week").textContent = ag.weekday === 7 ? "" : ag.week + "-я неделя";
    // шифр и название специальности — не в шапке, а в «Полезном» («Расшифровка групп»)
    $("specialty").hidden = true;

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
        if (it.state === "now") tags += '<span class="tag state">идёт · ещё ' + C.minutesText(it.end - now.minutes) + "</span>";
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
            (roomPlaces(it.room).length ? '<small class="place">' + roomPlaces(it.room).map(esc).join("<br>") + "</small>" : "") +
            "</div></div></div>" +
          (it.state === "now" ? '<div class="corner" aria-hidden="true"></div>' : "") + "</article>";
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
        '<span class="r">' + esc(String(it.room || "").split(" / ").map(roomLabel).join(" / ")) + "</span>" +
        detHTML(it, [nice(it.subject) !== it.subject ? it.subject : "", who].concat(roomPlaces(it.room))) + "</li>";
    }).join("") : '<li class="none">По расписанию пар нет</li>';
  }

  // Плашка о заменах спрятана за кнопкой «i» в углу рамки с парами: цвет кнопки — есть ли замены
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
      // на сайте показываем WebP (в 2 раза легче, его делает build_site.py), PNG — запасной и для «открыть целиком»
      var img = function (style) {
        return '<picture><source type="image/webp" srcset="' + src.replace(/\.png$/, ".webp") + '"><img loading="lazy" decoding="async" src="' +
          src + '" alt="' + alt + '"' + (style ? ' style="' + style + '"' : "") + "></picture>";
      };
      var t = i.table;
      if (!t) return '<a href="' + esc(i.url) + '">' + img("") + "</a>";
      var pad = 6, x0 = Math.max(0, t[0] - pad), y0 = Math.max(0, t[1] - pad),
        w = Math.min(t[4], t[2] + pad) - x0, h = Math.min(t[5], t[3] + pad) - y0;
      var pct = function (v) { return (100 * v / w).toFixed(3) + "%"; };
      return '<a class="crop" href="' + src + '" style="aspect-ratio:' + w + "/" + h + '">' +
        img("width:" + pct(t[4]) + ";margin-left:-" + pct(x0) + ";margin-top:-" + pct(y0)) + "</a>" +
        '<a class="full-link" href="' + src + '" target="_blank" rel="noopener">Открыть распоряжение целиком</a>';
    }).join("");
  }

  // История замен (из архива): все распоряжения по дням, от новых к старым; день раскрывается
  // в таблицу по всем группам, своя группа — первой и выделена
  function openHistory() {
    var mine = state.group, d = $("history");
    typeInto($("historyTitle"), "История замен", true);
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
    // открыто из приложения во встроенной вкладке Chrome (вверху ✕ вместо адресной строки) — она не устанавливает
    if (android && /^android-app:\/\//.test(document.referrer)) return { text: "Сайт открыт из другого приложения " +
      "во встроенной вкладке — отсюда установить нельзя. Нажмите ⋮ (вверху справа) → «Открыть в Chrome» и установите там." };
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
      return { text: "Меню ⋮ (вверху справа) → «Установить приложение» или «Добавить на главный экран». " +
        "Если вверху ✕ вместо адресной строки и пишет «нельзя установить» — сайт открыт из другого приложения: " +
        "⋮ → «Открыть в Chrome», и установите уже там." };
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
    // чуть позже загрузки: на слабом интернете сохранение для офлайна не отнимает скорость у первой страницы
    window.addEventListener("load", function () {
      setTimeout(function () { navigator.serviceWorker.register("sw.js").catch(function () {}); }, 2500);
    });
    // Новая версия сайта: на медленном интернете страница открывается из сохранённой копии (старой), а новая
    // докачивается в фоне. Как только она сохранена и вступила в силу — тихо перезагружаем страницу, чтобы
    // правки дошли сразу, а не при следующем заходе. Первый заход (кеша ещё не было) не трогаем;
    // открытое окно (выбор группы, история) не прерываем — ждём, пока закроют.
    var hadWorker = !!navigator.serviceWorker.controller, reloading = false;
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (!hadWorker || reloading) return;
      reloading = true;
      (function go() {
        if (document.querySelector("dialog[open]") || document.documentElement.classList.contains("snake-on")) { setTimeout(go, 1500); return; }
        location.reload();
      })();
    });
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
    typeInto($("groupName"), t);
    $("specialty").textContent = (full ? full + " · " : "") + "расписание преподавателя";
    $("specialty").hidden = false;
  }

  function lessonsLabel(ls) {
    return ls.length ? (ls[0] === 0 ? "классный час" : ls.length > 1 ? "уроки " + ls[0] + "–" + ls[ls.length - 1] : "урок " + ls[0]) : "";
  }

  function renderTeacherDay(now) {
    var date = A.addDays(params.get("date") || now.date, state.offset);
    teacherDay(date).then(function (d) {
      teacherHeader();
      setTitle(A.humanDate(date));
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
        if (it.state === "now") tags += '<span class="tag state">идёт · ещё ' + C.minutesText(it.end - now.minutes) + "</span>";
        if (it.changed) tags += '<span class="tag">замена</span>';
        if (it.uncertain) tags += '<span class="tag" title="распознано неуверенно">?</span>';
        var n = lessonsLabel(it.lessons);
        return '<article class="lesson tlesson ' + (it.state || "") + (it.changed ? " changed" : "") + '" style="--i:' + idx + '">' +
          '<div class="time">' + it.startText + "<small>" + it.endText + "</small></div>" +
          '<div><div class="subj">' + subjectsHTML(it.subject) + tags + "</div>" +
          '<div class="who"><span class="groups">' + it.groups.map(esc).join(", ") + "</span>" +
          (n ? ' · <span class="nw">' + n + "</span>" : "") + "</div></div>" +
          '<div class="room">' + (it.rooms.length ? (it.rooms.every(function (r) { return /-\?$/.test(r); }) ? "" : "ауд. ") + it.rooms.map(roomLabel).map(esc).join(", ") : "") + "</div>" +
          (it.state === "now" ? '<div class="corner" aria-hidden="true"></div>' : "") + "</article>";
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
      setTitle("Неделя: " + C.dayMonth(dates[0]) + " — " + C.dayMonth(dates[5]));
      $("week").textContent = days[0].week + "-я неделя";
      var total = days.reduce(function (n, d) { return n + d.items.length; }, 0);
      $("weekView").innerHTML = '<p class="total">' + total + " " + C.plural(total, "пара", "пары", "пар") + " за неделю</p>" +
        days.map(function (d, i) {
          var date = dates[i];
          var body = d.items.length ? d.items.map(function (it) {
            return '<li class="' + (it.changed ? "changed" : "") + '"><span class="t">' + it.startText + "</span>" +
              '<span class="s">' + esc(nice(it.subject)) + ' <span class="g">' + it.groups.map(esc).join(", ") + "</span>" +
              (it.changed ? ' <span class="tag">замена</span>' : "") + "</span>" +
              '<span class="r">' + it.rooms.map(roomLabel).map(esc).join(", ") + "</span>" +
              detHTML(it, [nice(it.subject) !== it.subject ? it.subject : "",
                (it.groups.length > 1 ? "Поток: " : "Группа: ") + it.groups.join(", ")].concat(roomPlaces(it.rooms.join(" / ")))) + "</li>";
          }).join("") : '<li class="none">' + (d.holiday ? esc(d.holiday.name) : "Пар нет") + "</li>";
          return weekDayHTML(date, i, now, (date === now.date ? ' <span class="tag state">сегодня</span>' : "") +
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
    $("courses").innerHTML = Object.keys(byCourse).sort().map(function (k, i) {
      return '<section class="course" style="--i:' + i + '"><h3>' + k + " курс</h3><div class=\"grid\">" +
        byCourse[k].map(function (g) {
          return '<button type="button" data-group="' + esc(g.group) + '" aria-current="' +
            (g.group === state.group) + '">' + esc(g.group) + "</button>";
        }).join("") + "</div></section>";
    }).join("");
    var teachers = state.teacherList || [];
    $("teacherList").innerHTML = !state.teacherList ? '<p class="hint small">Загрузка списка…</p>' : teachers.map(function (t, i) {
      var full = teacherFull(t);
      // по очереди появляются первые строки, остальные (их не видно без прокрутки) — вместе с последней
      return '<button type="button" data-teacher="' + esc(t) + '" aria-current="' + (t === state.teacher) + '" style="--i:' + Math.min(i, 12) + '">' +
        "<strong>" + esc(full || t) + "</strong>" + (full ? "<small>" + esc(t) + "</small>" : "") + "</button>";
    }).join("");
    var who = state.pickWho;
    $("whoSeg").dataset.who = who;
    document.querySelectorAll("#whoSeg button").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.dataset.who === who));
    });
    $("courses").hidden = who !== "group";
    $("teacherList").hidden = who !== "teacher";
    // при переключении «Я студент / Я преподаватель» список мягко появляется
    ["courses", "teacherList"].forEach(function (id) { $(id).classList.toggle("appear", !!drawPicker.animate); });
    drawPicker.animate = false;
    $("pickerTitle").textContent = who === "group" ? "Выберите группу" : "Выберите себя";
    $("pickerClose").hidden = !state.group && !state.teacher;
  }

  // Живое обновление: часы — каждую секунду, расписание — при смене минуты, данные — раз в 10 минут;
  // при возврате на вкладку (телефон «замораживает» страницу в фоне) — сразу.
  function startLive() {
    var start = A.moscowNow(), shown = start.time, day = start.date, loaded = Date.now();
    function refresh() {
      loaded = Date.now();
      load().then(function () { drawNews(); if (state.group || state.teacher) render(); }).catch(function () {});
    }
    // медленный интернет: сначала быстро показали сохранённое — через несколько секунд тихо подтягиваем свежее
    // (сеть за это время успевает догрузить, плашка сменится на «Обновлено в …»)
    setTimeout(function () { if (state.savedHit && navigator.onLine) refresh(); }, 5000);
    // Анонимный счётчик устройств (tools/schetchik.gs, таблица на почте расписания): раз в день «+1»
    // и открыт ли сайт как приложение. Ни меток, ни адресов — на устройстве хранится только дата
    // последней отметки (см. privacy.html). Автопроверки (Playwright) не считаются.
    setTimeout(function () {
      var today = A.moscowNow().date;
      if (navigator.webdriver || !navigator.onLine || store("utgt-counted") === today) return;
      store("utgt-counted", today);
      fetch(COUNTER + "?app=" + (standalone() ? 1 : 0), { mode: "no-cors", cache: "no-store", keepalive: true }).catch(function () {});
    }, 4000);
    // Проверка интернета для значка: каждые 15 с, пока страница на экране, — крошечный запрос одних
    // заголовков мимо офлайн-кеша. Ответил быстро — всё хорошо, медленно — «медленный», не ответил — «нет».
    // Показано сохранённое, а связь появилась — сразу подтягиваем свежие данные.
    var probing = false;
    function setNet(v) { if (state.net !== v) { state.net = v; if (state.data) drawNet(); } }
    function probe() {
      if (probing || document.hidden) return;
      if (!navigator.onLine) { setNet("off"); return; }
      probing = true;
      var t0 = Date.now(), ctl = window.AbortController ? new AbortController() : null;
      var stop = setTimeout(function () { if (ctl) ctl.abort(); }, 6000);
      fetch("data/health.json?net=" + t0, { method: "HEAD", cache: "no-store", signal: ctl ? ctl.signal : undefined })
        .then(function (r) {
          if (!r.ok) throw new Error(r.status);
          setNet(Date.now() - t0 > 1500 ? "slow" : "full");
          if (state.savedHit && Date.now() - loaded > 15000) refresh();
        })
        .catch(function () { setNet("off"); })
        .then(function () { clearTimeout(stop); probing = false; });
    }
    setTimeout(probe, 3000);
    setInterval(probe, 15000);
    document.addEventListener("visibilitychange", probe);
    window.addEventListener("online", probe);
    window.addEventListener("offline", function () { setNet("off"); });
    function tick() {
      var now = A.moscowNow();
      if (now.time === shown) return;
      shown = now.time;
      if (now.date !== day && !params.get("date")) { day = now.date; state.offset = 0; }
      // свежие данные — раз в 10 минут; если показано сохранённое, а интернет есть — пробуем каждую минуту
      if (Date.now() - loaded > (state.savedHit && navigator.onLine ? 50000 : 10 * 60000)) refresh();
      else if (state.group || state.teacher) render();
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

  // Список преподавателей собирается из расписаний всех групп — грузим заранее, пока окно открывается,
  // чтобы первое нажатие «Я преподаватель» не подтормаживало
  function loadTeacherList() {
    if (!loadTeacherList.p) loadTeacherList.p = allGroups().then(function (gs) { state.teacherList = Teachers.list(gs); },
      function (e) { loadTeacherList.p = null; throw e; }); // без интернета — попробуем снова при следующем нажатии
    return loadTeacherList.p;
  }

  function openPicker() {
    state.pickWho = state.teacher ? "teacher" : "group";
    drawPicker();
    var d = $("picker");
    if (d.showModal) d.showModal(); else d.setAttribute("open", "");
    if (!state.teacherList) setTimeout(function () { loadTeacherList().then(function () { if (state.pickWho !== "teacher") drawPicker(); }, function () {}); }, 600);
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
      if (state.pickWho === b.dataset.who) return;
      state.pickWho = b.dataset.who;
      if (state.pickWho === "teacher" && !state.teacherList) {
        loadTeacherList().then(function () {
          drawPicker.animate = state.pickWho === "teacher";
          drawPicker();
        });
      }
      drawPicker.animate = true;
      drawPicker();
    });
  });
  $("picker").addEventListener("cancel", function (e) {
    if (!state.group && !state.teacher) e.preventDefault(); // первый вход: без выбора закрыть нельзя
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
    // нажатие посреди анимации: продолжаем с текущей высоты, а направление берём из того,
    // куда блок ехал (при закрытии он до конца анимации остаётся open)
    var from = d.getBoundingClientRect().height, opening = !d.open || !!d._closing, to;
    if (d._anim) { var old = d._anim; d._anim = null; old.cancel(); }
    if (opening) { d.open = true; to = d.offsetHeight; }
    else { d.open = false; to = d.offsetHeight; d.open = true; }
    d._closing = !opening;
    d.style.overflow = "hidden";
    var a = d._anim = d.animate({ height: [from + "px", to + "px"] }, { duration: 600, easing: "cubic-bezier(.33, 1, .68, 1)" });
    // отмена старой анимации приходит позже запуска новой — её не слушаем, иначе она снимет обрезку у новой
    a.onfinish = a.oncancel = function () {
      if (d._anim !== a) return;
      d._anim = null;
      d._closing = false;
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

  // Пасхалка — змейка: W A S D подряд на клавиатуре или 5 быстрых нажатий на плашку «Неофициальный сайт».
  // Сама игра в snake.js и грузится только в этот момент — обычной загрузке сайта не мешает.
  function openSnake() {
    if (window.Snake) { window.Snake.open(); return; }
    var sc = document.createElement("script");
    sc.src = "snake.js?v=" + SNAKE_V;
    sc.onload = function () { window.Snake.open(); };
    document.head.appendChild(sc);
  }
  (function () {
    var typed = "";
    document.addEventListener("keydown", function (e) {
      if (e.target.closest && e.target.closest("input, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
      // по коду клавиши — сработает и в русской раскладке (Ц Ф Ы В)
      var k = { KeyW: "w", KeyA: "a", KeyS: "s", KeyD: "d" }[e.code];
      typed = (typed + (k || "-")).slice(-4);
      if (typed === "wasd" && !document.documentElement.classList.contains("snake-on")) { typed = ""; openSnake(); }
    });
    var taps = [];
    document.querySelector(".disclaimer").addEventListener("click", function (e) {
      if (e.target.closest("a")) return;
      var t = Date.now();
      taps = taps.filter(function (x) { return t - x < 2500; }).concat(t);
      if (taps.length >= 5) { taps = []; openSnake(); }
    });
  })();

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
