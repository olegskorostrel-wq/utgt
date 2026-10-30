// Подсказки «Ауд. …: этаж» в неделе у всех групп; кабинеты без этажа
const { read, URL, groups, zdays, launch, page, report, tab } = require('./lib');
const R = read('data/rooms.json').rooms;
(async () => {
  const b = await launch(); const problems = []; let ok = 0; const noFloor = {};
  const p = await page(b, { now: false });
  for (const date of [zdays().slice(-1)[0], new Date(Date.parse(zdays().slice(-1)[0]) + 7 * 864e5).toISOString().slice(0, 10)]) for (const g of groups()) {
    await p.goto(URL + '?group=' + encodeURIComponent(g) + '&date=' + date); await p.waitForSelector('#list .lesson, #list .empty');
    await tab(p, 'week'); await p.waitForSelector('.wday');
    const rows = await p.$$eval('.wday li:not(.none)', (ls) => ls.map((li) => ({ room: (li.querySelector('.r') || {}).textContent || '', det: (li.querySelector('.det') || {}).textContent || '' })));
    for (const r of rows) for (const room of r.room.split(' / ').map((x) => x.trim().replace(/^ауд\.\s*/, '')).filter(Boolean)) {
      if (room === '?') { r.det.includes('Кабинет на уточнении') ? ok++ : problems.push(g + ' ' + date + ': «?» без «Кабинет на уточнении»'); continue; }
      if (/^корп/.test(room)) { /уточнении/.test(r.det) ? ok++ : problems.push(g + ' ' + room + ' без «на уточнении»'); continue; }
      if (R[room]) { r.det.includes('Ауд. ' + room + ': ' + R[room]) ? ok++ : problems.push(g + ' ' + date + ' ' + room + ': нет подсказки об этаже'); }
      else { (noFloor[room] = noFloor[room] || new Set()).add(g); }
    }
  }
  Object.entries(noFloor).forEach(([k, v]) => problems.push(`кабинет ${k} без этажа в data/rooms.json (${[...v].join(', ')})`));
  problems.push(...p.errs); await b.close();
  console.log('верных подсказок:', ok);
  report('Кабинеты и этажи', problems);
})();
