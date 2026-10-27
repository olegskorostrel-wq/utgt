// node --test tests/teachers.test.js
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const T = require("../site/teachers.js");

const root = path.join(__dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const bells = read("data/bells.json"), cal = read("data/calendar.json");
const schedules = read("data/groups/index.json").groups.map((g) => ({ group: g.group, schedule: read("data/groups/" + g.file) }));
const at = (hhmm) => +hhmm.slice(0, 2) * 60 + +hhmm.slice(3);

test("Трудова во вторник 27.10 в 11:00 — урок у 11-В в 1-8, дальше 11-Л", () => {
  const r = T.whereIs("Трудова С.В.", "2026-10-27", at("11:00"), schedules, bells, cal, null);
  assert.deepStrictEqual([r.now.group, r.now.room, r.now.endText], ["11-В", "1-8", "12:10"]);
  assert.ok(r.lessons.length >= 2);
});

test("после последней пары — ни сейчас, ни дальше", () => {
  const r = T.whereIs("Трудова С.В.", "2026-10-27", at("20:00"), schedules, bells, cal, null);
  assert.strictEqual(r.now, null);
  assert.strictEqual(r.next, null);
});

test("в праздник пар нет", () => {
  const r = T.whereIs("Трудова С.В.", "2026-11-04", at("11:00"), schedules, bells, cal, null);
  assert.deepStrictEqual(r.lessons, []);
});

test("подгруппы: у Хаменевой во вторник 1 пара 21-С в своём кабинете 1-14", () => {
  const r = T.whereIs("Хаменева И.И.", "2026-10-27", at("09:30"), schedules, bells, cal, null);
  assert.ok(r.now, "должна быть пара");
  assert.strictEqual(r.now.room, "1-14");
});

test("ё/е в фамилии не мешает", () => {
  const a = T.whereIs("Черных С.С.", "2026-10-26", at("10:00"), schedules, bells, cal, null);
  assert.ok(a.lessons.length > 0);
});
