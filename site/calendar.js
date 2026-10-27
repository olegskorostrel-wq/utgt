// Календарь учебного года: праздники, каникулы, сессия (из календарного учебного графика).
// Работает и в браузере (window.Calendar), и в node (require) — для тестов.
(function (root) {
  "use strict";

  var MONTHS = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа",
    "сентября", "октября", "ноября", "декабря"];

  function days(a, b) {
    return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  }

  function plural(n, one, few, many) {
    var m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function daysText(n) {
    return n + " " + plural(n, "день", "дня", "дней");
  }

  function dayMonth(iso) {
    var p = iso.split("-");
    return +p[2] + " " + MONTHS[+p[1] - 1];
  }

  function periods(cal, group) {
    return ((cal.groups || {})[group] || {}).periods || [];
  }

  function holiday(date, cal) {
    return (cal.holidays || []).filter(function (h) { return h.date === date; })[0] || null;
  }

  // Нет занятий в этот день? -> { reason: "...", kind: "holiday"|"break" } или null
  function dayOff(date, cal, group) {
    var h = holiday(date, cal);
    if (h) return { kind: "holiday", reason: h.name };
    var p = periods(cal, group).filter(function (p) {
      return p.no_classes && p.from <= date && date <= p.to;
    })[0];
    return p ? { kind: "break", reason: p.name, until: p.to } : null;
  }

  // Короткие строки для плашки вверху: что идёт сейчас и сколько осталось до ближайшего важного
  function countdown(today, cal, group) {
    var out = [], ps = periods(cal, group);
    var now = ps.filter(function (p) { return p.from <= today && today <= p.to; })[0];
    if (now) {
      var left = days(today, now.to);
      out.push({ kind: now.type, text: now.name + " до " + dayMonth(now.to) +
        (left > 0 ? " — ещё " + daysText(left) : " — последний день"), exams: now.exams || null });
    }
    var nextBreak = ps.filter(function (p) { return p.type === "kanikuly" && p.from > today; })[0];
    if (nextBreak && !(now && now.type === "kanikuly")) {
      out.push({ kind: "kanikuly", text: "До каникул " + daysText(days(today, nextBreak.from)) +
        " (с " + dayMonth(nextBreak.from) + ")" });
    }
    var session = ps.filter(function (p) { return p.type === "sessiya" && p.from > today; })[0];
    if (session && days(today, session.from) <= 45) {
      out.push({ kind: "sessiya", text: "До сессии " + daysText(days(today, session.from)) +
        " (с " + dayMonth(session.from) + ")", exams: session.exams || null });
    }
    var h = (cal.holidays || []).filter(function (h) { return h.date > today; })[0];
    if (h && days(today, h.date) <= 14 && !dayOff(h.date, { groups: cal.groups }, group)) {
      var d = days(today, h.date);
      out.push({ kind: "holiday", text: (d === 1 ? "Завтра" : dayMonth(h.date)) + " выходной — " + h.name });
    }
    return out;
  }

  function toMin(hhmm) {
    var p = hhmm.split(":");
    return +p[0] * 60 + +p[1];
  }

  function weekday(iso) {
    var d = new Date(iso + "T00:00:00Z").getUTCDay();
    return d === 0 ? 7 : d;
  }

  function addDays(iso, n) {
    var d = new Date(iso + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  // Учебная часть сейчас: { open: bool, text: "Открыто до 16:30" | "Обед до 12:00" | "Закрыто, откроется …" }
  function officeStatus(date, minutes, office, cal) {
    function hours(d) {
      return holiday(d, cal || {}) ? null : office.hours[String(weekday(d))] || null;
    }
    var h = hours(date);
    if (h) {
      var open = toMin(h[0]), close = toMin(h[1]);
      var l0 = toMin(office.lunch[0]), l1 = toMin(office.lunch[1]);
      if (minutes >= l0 && minutes < l1) return { open: false, text: "Обед до " + office.lunch[1] };
      if (minutes >= open && minutes < close) return { open: true, text: "Открыто до " + h[1] };
      if (minutes < open) return { open: false, text: "Закрыто, откроется сегодня в " + h[0] };
    }
    for (var i = 1; i <= 14; i++) {
      var d = addDays(date, i), next = hours(d);
      if (next) {
        var when = i === 1 ? "завтра" : dayMonth(d);
        return { open: false, text: "Закрыто, откроется " + when + " в " + next[0] };
      }
    }
    return { open: false, text: "Закрыто" };
  }

  // Период учебного графика, в который попадает дата (сессия, практика, каникулы…), или null
  function current(date, cal, group) {
    return periods(cal, group).filter(function (p) { return p.from <= date && date <= p.to; })[0] || null;
  }

  var api = { current: current, dayOff: dayOff, countdown: countdown, officeStatus: officeStatus, plural: plural, daysText: daysText,
    dayMonth: dayMonth };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Calendar = api;
})(this);
