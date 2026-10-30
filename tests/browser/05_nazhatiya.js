// Быстрые нажатия: всё раскрывающееся (новости, «где преподаватель», полезное, обычное расписание,
// карточки пар, дни недели, дни истории) — 1…7 нажатий подряд с паузами 40…450 мс. Итог должен
// совпадать с числом нажатий, а текст не вылезать за рамку ни во время анимации, ни после.
const { URL, lastZ, launch, page, report, tab } = require('./lib');
(async () => {
  const b = await launch(); const problems = []; let runs = 0;
  for (const s of [{ w: 393, mob: true }, { w: 1366, mob: false }]) {
    const p = await page(b, { w: s.w, h: 800, mob: s.mob });
    const go = async () => { await p.goto(URL + '?group=11-%D0%90&date=' + lastZ()); await p.waitForSelector('#list .lesson'); await p.waitForTimeout(800); };
    const check = async (label, sel, isOpen, spill) => {
      for (const n of [1, 2, 3, 5, 7]) for (const gap of [40, 120, 250, 450]) {
        runs++;
        const before = await p.evaluate(isOpen);
        for (let i = 0; i < n; i++) { await p.click(sel, { timeout: 5000 }); if (i < n - 1) await p.waitForTimeout(gap); }
        let worst = -99; for (let i = 0; i < 8; i++) { await p.waitForTimeout(90); worst = Math.max(worst, await p.evaluate(spill)); }
        await p.waitForTimeout(800);
        const end = await p.evaluate(isOpen), want = n % 2 ? !before : before;
        if (end !== want || worst > 1) problems.push(`${s.w}px ${label}: ${n} нажатий через ${gap} мс — открыт ${end}, нужно ${want}, вылезало ${worst}px`);
      }
    };
    // details: пока обрезка снята, содержимое не должно выходить за рамку
    const det = (id) => [new Function(`return document.getElementById('${id}').open`),
      new Function(`const d=document.getElementById('${id}');if(!d.open||d.style.overflow==='hidden')return 0;const k=[...d.children].filter(c=>c.tagName!=='SUMMARY');return Math.round(Math.max(...k.map(x=>x.getBoundingClientRect().bottom))-d.getBoundingClientRect().bottom);`)];
    try {
      await go();
      for (const id of ['news', 'whereD', 'useful', 'base']) {
        const vis = await p.evaluate((i) => { const d = document.getElementById(i); if (!d || d.hidden) return false; d.scrollIntoView({ block: 'center' }); return true; }, id);
        if (vis) await check(id, '#' + id + ' > summary', ...det(id));
      }
      await p.evaluate(() => document.querySelector('#list .lesson').scrollIntoView({ block: 'center' }));
      await check('карточка пары', '#list .lesson', () => document.querySelector('#list .lesson').classList.contains('open'),
        () => { const l = document.querySelector('#list .lesson'), c = l.querySelector('.full > div'); return Math.round(c.getBoundingClientRect().bottom - l.getBoundingClientRect().bottom); });
      await tab(p, 'week'); await p.waitForTimeout(900);
      await p.evaluate(() => document.querySelector('.wday[role=button]').scrollIntoView({ block: 'center' }));
      await check('день недели', '.wday[role=button] h3', () => document.querySelector('.wday[role=button]').classList.contains('open'),
        () => { const w = document.querySelector('.wday[role=button]'); return Math.round(Math.max(...[...w.querySelectorAll('.det')].map((d) => d.getBoundingClientRect().bottom)) - w.getBoundingClientRect().bottom); });
      await go(); await p.evaluate(() => { document.getElementById('useful').open = true; }); await p.waitForTimeout(300);
      await p.click('#historyBtn'); await p.waitForSelector('#historyList details'); await p.waitForTimeout(800);
      await p.evaluate(() => { document.querySelector('#historyList details').id = 'hd0'; });
      await check('день в истории', '#hd0 > summary', ...det('hd0'));
    } catch (e) { problems.push(`${s.w}px: не удалось — ${e.message.split('\n')[0]}`); }
    problems.push(...p.errs); await p.ctx.close();
  }
  await b.close(); console.log('прогонов:', runs);
  report('Быстрые нажатия на раскрывающееся', problems);
})();
