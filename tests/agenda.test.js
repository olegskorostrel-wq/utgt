// node --test tests/agenda.test.js
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const A = require("../site/agenda.js");

const root = path.join(__dirname, "..");
const schedule = JSON.parse(fs.readFileSync(path.join(root, "data/schedule_11A.json"), "utf8"));
const bells = JSON.parse(fs.readFileSync(path.join(root, "data/bells.json"), "utf8"));
const brief = (ag) => ag.items.map((i) => `${i.startText}-${i.endText} ${i.subject} ${i.room}${i.changed ? " *" : ""}`);

test("понедельник 26.10 без замен", () => {
  assert.deepStrictEqual(brief(A.build("2026-10-26", schedule, bells, null)), [
    "08:30-09:15 Разговоры о важном ",
    "09:20-10:50 Информатика 1-25",
    "11:00-12:30 Математика 1-8",
    "13:10-14:40 География 2-7",
  ]);
});

test("пятница: пара из двух разных уроков делится по 45 минут", () => {
  assert.deepStrictEqual(brief(A.build("2026-10-30", schedule, bells, null)).slice(2), [
    "12:50-13:35 История 2-10",
    "13:35-14:20 Литература 2-18",
  ]);
});

test("суббота 24.10 с реальными заменами", () => {
  const z = { changes: [
    { lessons: [1, 2], subject: "Математика", room: "1-8" },
    { lessons: [5, 6], subject: "Химия", room: "2-7" },
    { lessons: [7, 8], subject: "Биология", room: "2-7" },
  ] };
  const ag = A.build("2026-10-24", schedule, bells, z);
  assert.deepStrictEqual(brief(ag), [
    "09:00-10:30 Математика 1-8 *",
    "10:40-12:10 Обществознание 2-10",
    "12:50-14:20 Химия 2-7 *",
    "14:30-16:00 Биология 2-7 *",
  ]);
  assert.strictEqual(ag.items[0].was, "Химия");
  assert.ok(ag.changed);
});

test("отмена урока попадает в список отменённых", () => {
  const ag = A.build("2026-10-27", schedule, bells, { changes: [{ lessons: [3, 4], subject: "Отменить", room: "" }] });
  assert.deepStrictEqual(brief(ag), ["09:00-10:30 Литература 2-18", "12:50-14:20 История 2-10"]);
  assert.deepStrictEqual(ag.cancelled.map((c) => `${c.subject} ${c.startText}-${c.endText}`), ["Физика 10:40-12:10"]);
});

test("замена с тем же предметом и кабинетом не считается изменением", () => {
  const ag = A.build("2026-10-26", schedule, bells, { changes: [{ lessons: [0], subject: "Разговоры о важном", room: "1-25" }] });
  assert.strictEqual(ag.items[0].room, "1-25");
  assert.strictEqual(ag.items[0].changed, true); // кабинет появился — это новая информация
  const same = A.build("2026-10-26", schedule, bells, { changes: [{ lessons: [1, 2], subject: "Информатика", room: "1-25" }] });
  assert.strictEqual(same.changed, false);
});

test("статусы идёт/далее", () => {
  const ag = A.markNow(A.build("2026-10-27", schedule, bells, null), 11 * 60);
  assert.deepStrictEqual(ag.items.map((i) => i.state), ["past", "now", "next"]);
});

test("воскресенье пустое, московская дата считается верно", () => {
  assert.strictEqual(A.build("2026-11-01", schedule, bells, null).items.length, 0);
  const now = A.moscowNow(new Date("2026-10-26T21:30:00Z"));
  assert.deepStrictEqual([now.date, now.time], ["2026-10-27", "00:30"]);
});
