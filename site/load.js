// Нагрузка по всем группам: у каких групп предмет (или преподаватель), сколько пар в неделю и когда.
// Работает и в браузере (window.Load), и в node (require) — для тестов.
(function (root) {
  "use strict";

  var DAYS = ["", "пн", "вт", "ср", "чт", "пт", "сб"];
  var CODE_RE = /^((?:МДК|ОП|ПМ|ОГСЭ|ЕН|УП|ПП)\.\d+(?:\.\d+)?)\.?\s*/;

  // Короткие названия специальностей по букве группы
  var SPECIALTY = { "А": "Автоматика и телемеханика", "В": "Вагоны", "Д": "Перевозки",
    "Л": "Локомотивы", "П": "Путь и путевое хозяйство", "С": "Связь и радиоэлектроника" };

  // Буква группы = специальность: «21-С» -> «С»
  function letter(group) { return String(group).split("-")[1] || ""; }

  // «МДК.02.02. Основы…» и «МДК.02.02 Основы…» — один предмет; сокращённые названия тоже сводятся по коду.
  // Номера МДК у каждой специальности свои, поэтому код дополняется буквой группы.
  function subjectKey(s, group) {
    s = String(s || "").replace(/\s+/g, " ").trim();
    var m = s.match(CODE_RE);
    return m ? m[1] + "|" + letter(group) : s.toLowerCase().replace(/ё/g, "е");
  }

  // Плоский список: одна запись — одна пара одной (под)группы; подгруппы «А / Б» разделяются
  function entries(schedules) {
    var out = [];
    schedules.forEach(function (s) {
      Object.keys(s.schedule.days).forEach(function (d) {
        s.schedule.days[d].forEach(function (e) {
          if (e.lessons[0] === 0) return; // «Разговоры о важном» — не пара
          var subj = e.subject.split(" / "), teach = String(e.teacher || "").split(" / "),
            rooms = String(e.room || "").split(" / ");
          subj.forEach(function (name, i) {
            out.push({ group: s.group, day: +d, week: e.week || 0, lessons: e.lessons,
              pairs: e.lessons.length / 2, subject: name.trim(), key: subjectKey(name, s.group),
              teacher: (teach[i] || teach[0] || "").trim(), room: (rooms[i] || rooms[0] || "").trim(),
              subgroup: subj.length > 1 });
          });
        });
      });
    });
    return out;
  }

  // Предметы для списка: ключ -> самое полное название
  function subjects(list) {
    var by = {};
    list.forEach(function (e) {
      if (!by[e.key] || e.subject.length > by[e.key].length) by[e.key] = e.subject;
    });
    return Object.keys(by).map(function (k) {
      var parts = k.split("|"), m = by[k].match(CODE_RE);
      return { key: k, name: by[k], code: m ? m[1] : "", title: m ? by[k].slice(m[0].length) : by[k],
        letter: parts[1] || "" };
    })
      .sort(function (a, b) { return a.name.localeCompare(b.name, "ru"); });
  }

  function teachers(list) {
    var seen = {};
    list.forEach(function (e) { if (e.teacher) seen[e.teacher] = true; });
    return Object.keys(seen).sort(function (a, b) { return a.localeCompare(b, "ru"); });
  }

  // Сводка по группам: пары в 1-ю и 2-ю неделю и сами занятия по порядку
  function summary(list, pick) {
    var by = {};
    list.filter(pick).forEach(function (e) {
      var g = by[e.group] || (by[e.group] = { group: e.group, w1: 0, w2: 0, slots: [] });
      if (e.week !== 2) g.w1 += e.pairs;
      if (e.week !== 1) g.w2 += e.pairs;
      g.slots.push(e);
    });
    var rows = Object.keys(by).map(function (k) { return by[k]; });
    rows.forEach(function (r) {
      r.slots.sort(function (a, b) { return a.day - b.day || a.lessons[0] - b.lessons[0] || a.week - b.week; });
    });
    rows.sort(function (a, b) { return a.group.localeCompare(b.group, "ru"); });
    var total = rows.reduce(function (t, r) { return { w1: t.w1 + r.w1, w2: t.w2 + r.w2 }; }, { w1: 0, w2: 0 });
    return { rows: rows, total: total };
  }

  function bySubject(list, key) { return summary(list, function (e) { return e.key === key; }); }
  function byTeacher(list, name) { return summary(list, function (e) { return e.teacher === name; }); }

  function slotText(e) {
    var p = e.lessons.length > 1 ? (e.lessons[0] + 1) / 2 : null;
    return DAYS[e.day] + ", " + (p ? p + "-я пара" : e.lessons[0] + "-й урок");
  }

  var api = { SPECIALTY: SPECIALTY, subjectKey: subjectKey, entries: entries, subjects: subjects, teachers: teachers,
    bySubject: bySubject, byTeacher: byTeacher, slotText: slotText };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Load = api;
})(this);
