// Стресс: «обезьяна» тысячи раз нажимает на всё подряд — кнопки, вкладки, пары, дни, окна, тему,
// подгруппу, фамилии, метки, свайпы и клавиши — на телефоне и компьютере, 3 прохода с разным «зерном».
// После каждой серии: нет ошибок, страница не шире экрана, расписание на месте, окна закрываются.
const { URL, launch, page, report } = require('./lib');
const STEPS = +(process.env.STEPS || 700);
function rnd(seed) { let x = seed; return () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648; }
(async () => {
  const b = await launch(); const problems = []; let actions = 0;
  const PASSES = [[1, { w: 393, mob: true }], [2, { w: 1366, mob: false }], [3, { w: 320, mob: true, dark: true }], [4, { w: 280, mob: true }], [5, { w: 1024, mob: false, dark: true }]]
    .filter((x) => !process.env.SEEDS || process.env.SEEDS.split(',').includes(String(x[0])));
  for (const [seed, s] of PASSES) {
    const R = rnd(seed), pick = (a) => a[Math.floor(R() * a.length)];
    const p = await page(b, { w: s.w, h: 800, mob: s.mob, dark: s.dark });
    await p.goto(URL + '?group=11-%D0%90'); await p.waitForSelector('#list .lesson, #list .empty');
    const SEL = ['#groupBtn', '#themeBtn', '#netBtn', '#infoBtn', '.tabs button', '#list .lesson', '#list .tlesson', '.wday[role=button] h3', '#base > summary', '#base li[role=button]',
      '#news > summary', '#whereD > summary', '#useful > summary', '#whereList button', '#calendar li', '#langSwitch', '#historyBtn', '#historyList summary', '#tiles .tile', '#panelClose',
      '#courses button[data-group]', '#whoSeg button', '#teacherList button[data-teacher]', '.close', '.disclaimer', '.snake canvas', '.snake-close'];
    for (let i = 0; i < STEPS; i++) {
      const r = R();
      try {
        if (r < 0.75) {
          const sel = pick(SEL);
          const els = await p.$$(sel);
          const vis = []; for (const e of els) if (await e.isVisible()) vis.push(e);
          if (vis.length) { await pick(vis).click({ timeout: 1500, force: R() < 0.2 }); actions++; }
        } else if (r < 0.85) {
          await p.keyboard.press(pick(['Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Enter', ' ', 'w', 'a', 's', 'd', 'Tab'])); actions++;
        } else if (r < 0.93) {
          const dx = pick([-160, 160, -40, 40]), dy = pick([0, 0, 200]);
          await p.dispatchEvent('#list', 'touchstart', { touches: [{ identifier: 1, clientX: 200, clientY: 500 }], changedTouches: [{ identifier: 1, clientX: 200, clientY: 500 }] }).catch(() => {});
          await p.dispatchEvent('#list', 'touchend', { touches: [], changedTouches: [{ identifier: 1, clientX: 200 + dx, clientY: 500 + dy }] }).catch(() => {});
          actions++;
        } else if (r < 0.97) {
          await p.fill('#whereInput', pick(['', 'ба', 'рыж', 'ззз', 'Е', 'ё']), { timeout: 1500 }).catch(() => {}); actions++;
        } else {
          await p.mouse.wheel(0, pick([-600, 600])); actions++;
        }
      } catch (e) { /* элемент пропал во время нажатия — это нормально */ }
      await p.waitForTimeout(R() < 0.3 ? 400 : 40);
      if (i % 50 === 49) {
        await p.waitForTimeout(900);
        const st = await p.evaluate(() => ({
          wide: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
            ? [...document.querySelectorAll('body *')].filter((e) => {
                if (e.getBoundingClientRect().right <= document.documentElement.clientWidth + 1) return false;
                for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).overflowX !== 'visible') return false;
                return true;
              }).slice(0, 4).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + String(e.className).split(' ')[0] + ' «' + (e.innerText || '').trim().slice(0, 30) + '» до ' + Math.round(e.getBoundingClientRect().right)).join(', ')
              || ('ширина ' + document.documentElement.scrollWidth + ', видно ' + document.documentElement.clientWidth + ' из ' + innerWidth + ', html: ' + getComputedStyle(document.documentElement).overflowY + '/' + document.documentElement.className + ', вылезают: ' + [...document.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 1).slice(0, 6).map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '') + '.' + String(e.className).split(' ')[0] + ' до ' + Math.round(e.getBoundingClientRect().right) + ' ' + getComputedStyle(e).position).join(', ')) : '',
          content: !!document.querySelector('#list .lesson, #list .empty, .tlesson, .empty, .wday'),
          dialogs: document.querySelectorAll('dialog[open]').length,
        }));
        if (st.wide) { problems.push(`проход ${seed} (${s.w}px), шаг ${i + 1}: страница стала шире экрана — ${st.wide}`); await p.screenshot({ path: require('./lib').SHOTS + `/stress_${seed}_${i + 1}.png` }); }
        if (!st.content) problems.push(`проход ${seed} (${s.w}px), шаг ${i + 1}: пропало расписание`);
        if (st.dialogs > 1) problems.push(`проход ${seed} (${s.w}px), шаг ${i + 1}: открыто ${st.dialogs} окна сразу`);
        // всё ли закрывается и возвращается
        await p.keyboard.press('Escape'); await p.evaluate(() => { const s = document.querySelector('.snake-close'); if (s && s.offsetParent) s.click(); });
        await p.waitForTimeout(300);
        if (await p.evaluate(() => document.querySelectorAll('dialog[open]').length)) problems.push(`проход ${seed}: окно не закрылось по Esc`);
      }
    }
    // после всего: обычная загрузка работает
    await p.goto(URL + '?group=21-%D0%A1'); await p.waitForSelector('#list .lesson, #list .empty', { timeout: 15000 }).catch(() => problems.push(`проход ${seed}: после стресса сайт не открылся`));
    problems.push(...p.errs.map((x) => `проход ${seed} (${s.w}px): ${x}`));
    await p.ctx.close();
  }
  await b.close(); console.log('действий:', actions);
  report('Стресс-тест «жми на всё подряд»', problems);
})();
