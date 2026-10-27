// Где преподаватель сейчас и где у него следующая пара — по расписаниям всех групп.
// Работает и в браузере (window.Teachers), и в node (require) — для тестов.
(function (root) {
  "use strict";

  var A = typeof module !== "undefined" && module.exports ? require("./agenda.js") : root.Agenda;
  var C = typeof module !== "undefined" && module.exports ? require("./calendar.js") : root.Calendar;

  function norm(s) {
    return String(s || "").replace(/Ё/g, "Е").replace(/ё/g, "е").replace(/\s+/g, " ").trim();
  }

  // schedules: [{ group, schedule }]; zamena(group) -> замены группы на эту дату или null
  // Возвращает { now: {...} | null, next: {...} | null, lessons: [...] } на этот день.
  function whereIs(teacher, date, minutes, schedules, bells, calendar, zamena) {
    var who = norm(teacher), lessons = [];
    schedules.forEach(function (s) {
      if (C.dayOff(date, calendar || {}, s.group)) return;
      var ag = A.build(date, s.schedule, bells, zamena ? zamena(s.group) : null);
      ag.items.forEach(function (it) {
        var names = String(it.teacher || "").split(" / ").map(norm);
        var i = names.indexOf(who);
        if (i < 0) return;
        var rooms = String(it.room || "").split(" / ");
        lessons.push({ group: s.group, subject: it.subject, room: rooms[i] || rooms[0] || "",
          start: it.start, end: it.end, startText: it.startText, endText: it.endText });
      });
    });
    lessons.sort(function (a, b) { return a.start - b.start; });
    var now = lessons.filter(function (l) { return l.start <= minutes && minutes < l.end; })[0] || null;
    var next = lessons.filter(function (l) { return l.start > minutes && (!now || l.start >= now.end); })[0] || null;
    return { now: now, next: next, lessons: lessons };
  }

  var api = { whereIs: whereIs };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Teachers = api;
})(this);
