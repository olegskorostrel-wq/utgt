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

  function fillPick() {
    var opts = state.mode === "s"
      ? L.subjects(state.list).map(function (s) { return [s.key, s.name]; })
      : L.teachers(state.list).map(function (t) { return [t, state.full[t] || t]; });
    $("pickLabel").textContent = state.mode === "s" ? "Предмет" : "Преподаватель";
    $("pick").innerHTML = '<option value="">— выберите —</option>' + opts.map(function (o) {
      return '<option value="' + esc(o[0]) + '">' + esc(o[1]) + "</option>";
    }).join("");
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
      show("", false);
      remember("");
    });
  });
  $("pick").addEventListener("change", function (e) {
    show(e.target.value, true);
    remember(e.target.value);
  });

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
    var v = params.get(state.mode);
    if (v) { $("pick").value = v; show($("pick").value, true); }
  }).catch(function (e) {
    $("status").textContent = "Не удалось загрузить данные: " + e.message;
  });
})();
