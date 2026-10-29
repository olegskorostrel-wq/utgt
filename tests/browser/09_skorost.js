// Скорость на слабом интернете (1,6 Мбит/с, задержка 300 мс, процессор в 4 раза медленнее):
// первый заход и повторный (с офлайн-кешем). Пороги: первый — не дольше 7 с, повторный — 5 с.
const { URL, launch, report } = require('./lib');
(async () => {
  const b = await launch(); const P = [];
  const ctx = await b.newContext({ viewport: { width: 393, height: 800 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 300, downloadThroughput: 200000, uploadThroughput: 40000 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let bytes = 0; p.on('requestfinished', async (r) => { const s = await r.sizes().catch(() => ({})); bytes += Math.max(0, s.responseBodySize || 0); });
  for (const [label, limit] of [['первый заход', 7000], ['повторный заход', 5000], ['ещё раз', 5000]]) {
    bytes = 0; const t = Date.now();
    await p.goto(URL + '?group=11-%D0%90', { waitUntil: 'commit', timeout: 60000 });
    await p.waitForSelector('#list .lesson, #list .empty', { timeout: 60000 });
    const ms = Date.now() - t;
    console.log(label + ': расписание через', ms, 'мс, скачано', Math.round(bytes / 1024), 'КБ');
    if (ms > limit) P.push(`${label}: расписание показалось через ${(ms / 1000).toFixed(1)} с (порог ${limit / 1000} с)`);
    await p.waitForTimeout(6000);
  }
  await b.close();
  report('Скорость на слабом интернете', P);
})();
