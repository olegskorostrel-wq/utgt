(function () {
  "use strict";
  var A = window.Agenda, L = window.Load;
  var state = { mode: "s", list: [], bells: null, full: {} };
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
  function hhmm(m) { return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); }
  function pairs(n) {
    var w = n % 1 ? "пары" : (n % 10 === 1 && n % 100 !== 11 ? "пара" : (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "пары" : "пар"));
    return String(n).replace(".", ",") + " " + w;
  }
  function perWeek(r) {
    return r.w1 === r.w2 ? pairs(r.w1) + " в неделю" : pairs(r.w1) + " в 1-ю неделю, " + r.w2 + " во 2-ю";
  }

  function norm(t) { return String(t).toLowerCase().replace(/ё/g, "е"); }

  // Варианты для списка: { value, title, code, sub, section }
  function items() {
    if (state.mode === "s") {
      return L.subjects(state.list).map(function (x) {
        var n = L.bySubject(state.list, x.key).rows.length;
        return { value: x.key, title: shortTitle(x.title), full: x.title, code: x.code, sub: groupsText(n),
          section: x.letter ? L.SPECIALTY[x.letter] || "Группы …-" + x.letter : "Общие предметы" };
      }).sort(function (a, b) {
        var sa = a.section === "Общие предметы" ? "" : a.section, sb = b.section === "Общие предметы" ? "" : b.section;
        return sa.localeCompare(sb, "ru") || (a.code + a.title).localeCompare(b.code + b.title, "ru");
      });
    }
    return L.teachers(state.list).map(function (t) {
      var n = L.byTeacher(state.list, t).rows.length;
      return { value: t, title: state.full[t] || t, code: "", sub: groupsText(n), section: "" };
    });
  }
  // В списке — без хвостов «(по видам транспорта)», «(железнодорожном транспорте)» и т. п.
  function shortTitle(t) {
    return t.replace(/\s*\((?:по видам|на ж|железнодорож|жд)[^)]*\)/gi, "").replace(/\s+/g, " ").trim() || t;
  }
  function groupsText(n) { return n + " " + (n % 10 === 1 && n % 100 !== 11 ? "группа" : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? "группы" : "групп"); }

  function drawOptions() {
    var q = norm($("q").value.trim()), last = null, html = "";
    var list = state.items.filter(function (it) {
      return !q || norm(it.code + " " + it.title + " " + it.value).indexOf(q) >= 0;
    });
    list.forEach(function (it) {
      if (it.section && it.section !== last) { html += '<h4>' + esc(it.section) + "</h4>"; last = it.section; }
      html += '<button type="button" class="opt" data-value="' + esc(it.value) + '">' +
        (it.code ? '<span class="code">' + esc(it.code) + "</span>" : "") +
        '<span class="name">' + esc(it.title) + "</span><small>" + esc(it.sub) + "</small></button>";
    });
    $("options").innerHTML = html || '<p class="none">Ничего не найдено</p>';
  }

  // value пустой — показать список выбора; иначе — выбранное и результат
  function choose(value, animate) {
    var it = state.items.filter(function (x) { return x.value === value; })[0];
    $("chosen").hidden = !it;
    $("q").hidden = !!it;
    $("options").hidden = !!it;
    if (it) {
      $("chosen").innerHTML = (it.code ? '<span class="code">' + esc(it.code) + "</span>" : "") +
        '<span class="name">' + esc(it.full || it.title) + "</span><small>" + (it.section ? esc(it.section) + " · " : "") +
        "нажмите, чтобы выбрать другое</small>";
    } else {
      $("q").placeholder = state.mode === "s" ? "Найти предмет…" : "Найти преподавателя…";
      drawOptions();
    }
    show(it ? value : "", animate);
    remember(it ? value : "");
  }

  function fillPick() {
    state.items = items();
    $("q").value = "";
    document.querySelectorAll(".tabs button").forEach(function (b) {
      b.setAttribute("aria-selected", String(b.dataset.mode === state.mode));
    });
  }

  function show(value, animate) {
    var res = $("result"), total = $("total");
    res.classList.toggle("anim", !!animate);
    if (!value) { res.innerHTML = ""; total.hidden = true; return; }
    var sum = state.mode === "s" ? L.bySubject(state.list, value) : L.byTeacher(state.list, value);
    total.hidden = false;
    total.innerHTML = "<strong>" + sum.rows.length + " " + (sum.rows.length === 1 ? "группа" : sum.rows.length < 5 ? "группы" : "групп") +
      "</strong> · всего " + perWeek(sum.total);
    res.innerHTML = sum.rows.map(function (r, i) {
      return '<section class="wday" style="--i:' + i + '"><h3>' + esc(r.group) + ' <span class="tag state">' +
        esc(perWeek(r)) + "</span></h3><ul>" + r.slots.map(function (e) {
          var t = A.lessonTime(state.bells, e.day, e.lessons[0]);
          var other = state.mode === "s" ? e.teacher : e.subject;
          return '<li><span class="t">' + esc(L.slotText(e)) + "<small>" + hhmm(t.start) + "</small></span>" +
            '<span class="s">' + esc(other || "—") + (e.week ? ' <span class="tag">' + e.week + "-я неделя</span>" : "") +
            (e.subgroup ? ' <span class="tag">подгруппа</span>' : "") + "</span>" +
            '<span class="r">' + esc(e.room) + "</span></li>";
        }).join("") + "</ul></section>";
    }).join("");
  }

  function remember(value) {
    params.delete("s"); params.delete("t");
    if (value) params.set(state.mode, value);
    history.replaceState(null, "", params.toString() ? "?" + params.toString() : location.pathname);
  }

  document.querySelectorAll(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      if (state.mode === b.dataset.mode) return;
      state.mode = b.dataset.mode;
      fillPick();
      choose("", false);
    });
  });
  $("q").addEventListener("input", drawOptions);
  $("options").addEventListener("click", function (e) {
    var b = e.target.closest(".opt");
    if (b) { choose(b.dataset.value, true); window.scrollTo(0, 0); }
  });
  $("chosen").addEventListener("click", function () { choose("", false); $("q").focus(); });

  Promise.all([getJSON("data/groups/index.json"), getJSON("data/bells.json"),
    getJSON("data/teachers.json").catch(function () { return { by_short: {} }; })]).then(function (r) {
    state.bells = r[1];
    state.full = r[2].by_short || {};
    return Promise.all(r[0].groups.map(function (g) {
      return getJSON("data/groups/" + g.file).then(function (s) { return { group: g.group, schedule: s }; });
    }));
  }).then(function (schedules) {
    state.list = L.entries(schedules);
    state.mode = params.get("t") ? "t" : "s";
    fillPick();
    choose(params.get(state.mode) || "", true);
  }).catch(function (e) {
    $("status").textContent = "Не удалось загрузить данные: " + e.message;
  });
})();
