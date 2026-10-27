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

  // Избранное (звёздочка) — хранится только в этом браузере, отдельно для предметов и преподавателей
  var FAV_KEY = "utgt-nagruzka-fav";
  function favs() {
    try { return JSON.parse(localStorage.getItem(FAV_KEY)) || { s: [], t: [] }; } catch (e) { return { s: [], t: [] }; }
  }
  function isFav(value) { return favs()[state.mode].indexOf(value) >= 0; }
  function toggleFav(value) {
    var f = favs(), list = f[state.mode], i = list.indexOf(value);
    if (i >= 0) list.splice(i, 1); else list.push(value);
    try { localStorage.setItem(FAV_KEY, JSON.stringify(f)); } catch (e) { /* приватный режим — без избранного */ }
  }
  // Звёздочка со скруглёнными углами (заливка — только у избранного, через CSS)
  var STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.5 5.1 5.6.8-4.05 3.95.95 5.6L12 16.4l-5 2.65.95-5.6L3.9 9.5l5.6-.8z"/></svg>';
  function starHTML(value) {
    var on = isFav(value);
    return '<button type="button" class="star' + (on ? " on" : "") + '" data-star="' + esc(value) + '" aria-pressed="' + on +
      '" aria-label="' + (on ? "Убрать из избранного" : "В избранное") + '">' + STAR + "</button>";
  }
  function optHTML(it) {
    return '<div class="row"><button type="button" class="opt" data-value="' + esc(it.value) + '">' +
      (it.code ? '<span class="code">' + esc(it.code) + "</span>" : "") +
      '<span class="name">' + esc(it.title) + "</span><small>" + esc(it.sub) +
      (it.fav && it.section ? " · " + esc(it.section) : "") + "</small></button>" + starHTML(it.value) + "</div>";
  }

  function drawOptions() {
    var q = norm($("q").value.trim()), last = null, html = "";
    var list = state.items.filter(function (it) {
      return !q || norm(it.code + " " + it.title + " " + it.value).indexOf(q) >= 0;
    });
    var top = list.filter(function (it) { return isFav(it.value); });
    if (top.length) {
      html += "<h4>Избранное</h4>" + top.map(function (it) { return optHTML(Object.assign({ fav: true }, it)); }).join("");
      last = "★";
    }
    list.forEach(function (it) {
      var sec = it.section || (top.length ? "Все" : "");
      if (sec && sec !== last) { html += "<h4>" + esc(sec) + "</h4>"; last = sec; }
      html += optHTML(it);
    });
    $("options").innerHTML = html || '<p class="none">Ничего не найдено</p>';
  }

  // value пустой — показать список выбора; иначе — выбранное и результат
  function choose(value, animate) {
    var it = state.items.filter(function (x) { return x.value === value; })[0];
    $("chosenRow").hidden = !it;
    $("q").hidden = !!it;
    $("options").hidden = !!it;
    if (it) {
      $("chosen").innerHTML = (it.code ? '<span class="code">' + esc(it.code) + "</span>" : "") +
        '<span class="name">' + esc(it.full || it.title) + "</span><small>" + (it.section ? esc(it.section) + " · " : "") +
        "нажмите, чтобы выбрать другое</small>";
      $("chosenStar").outerHTML = starHTML(value).replace('class="star', 'id="chosenStar" class="star');
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
  // звёздочка: в списке — перерисовать (пункт переедет наверх), у выбранного — только сама звёздочка
  document.querySelector(".finder").addEventListener("click", function (e) {
    var st = e.target.closest(".star");
    if (!st) return;
    toggleFav(st.dataset.star);
    var v = st.dataset.star;
    if (st.id === "chosenStar") st.outerHTML = starHTML(v).replace('class="star', 'id="chosenStar" class="star');
    else drawOptions();
    // «подпрыгивает» только нажатая звёздочка
    document.querySelectorAll(".finder .star").forEach(function (x) {
      if (x.dataset.star === v && x.classList.contains("on")) x.classList.add("pop");
    });
  });
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
