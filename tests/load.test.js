// node --test tests/load.test.js
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const fs = require("node:fs");
const L = require("../site/load.js");

const root = path.join(__dirname, "..");
const read = (p) => JSON.parse(fs.readFileSync(path.join(root, p), "utf8"));
const list = L.entries(read("data/groups/index.json").groups.map((g) => ({ group: g.group, schedule: read("data/groups/" + g.file) })));

test("математика: пары по группам с учётом недель", () => {
  const m = L.bySubject(list, L.subjectKey("Математика"));
  const a = m.rows.find((r) => r.group === "11-А");
  assert.deepStrictEqual([a.w1, a.w2], [4, 3]);
  const last = a.slots[a.slots.length - 1];
  assert.deepStrictEqual([L.slotText(last), last.week], ["сб, 3-я пара", 1]);
});

test("разговоры о важном не считаются парой", () => {
  assert.ok(!list.some((e) => /Разговоры/.test(e.subject)));
});

test("подгруппы делятся: немецкий у 21-С — Хаменева", () => {
  const t = L.byTeacher(list, "Хаменева И.И.");
  assert.ok(t.rows.some((r) => r.group === "21-С"));
  assert.ok(!L.byTeacher(list, "Баякчан Л.А.").rows.some((r) => r.slots.some((s) => /немецк/.test(s.subject))));
});

test("МДК одной специальности сводятся, разных — нет", () => {
  assert.strictEqual(L.subjectKey("МДК.02.02. Основы", "21-С"), L.subjectKey("МДК.02.02 Основы", "31-С"));
  assert.notStrictEqual(L.subjectKey("МДК.02.02 А", "21-С"), L.subjectKey("МДК.02.02 Б", "21-Д"));
  const names = L.subjects(list).map((s) => s.name);
  assert.strictEqual(new Set(names).size, names.length);
});
