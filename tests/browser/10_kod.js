// Код страницы без браузера и в браузере: синтаксис скриптов, все данные читаются, все $("id") из app.js
// есть в странице, все ссылки и файлы на месте, нет ключей и паролей в выкладке, у картинок есть описания,
// у кнопок — названия, повторяющихся id нет, внешние ссылки открываются безопасно.
const fs = require('fs'), path = require('path'), { execSync } = require('child_process');
const { ROOT, URL, launch, page, open, report } = require('./lib');
(async () => {
  const P = [];
  const site = path.join(ROOT, 'site'), out = path.join(ROOT, '_site');
  for (const f of fs.readdirSync(site).filter((x) => x.endsWith('.js'))) {
    try { execSync('node --check ' + JSON.stringify(path.join(site, f)), { stdio: 'pipe' }); } catch (e) { P.push('синтаксис ' + f + ': ' + String(e.stderr).split('\n').slice(0, 3).join(' ')); }
  }
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const f of walk(path.join(ROOT, 'data')).filter((x) => x.endsWith('.json'))) { try { JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { P.push('не читается ' + path.relative(ROOT, f) + ': ' + e.message); } }
  const html = fs.readFileSync(path.join(site, 'index.html'), 'utf8'), app = fs.readFileSync(path.join(site, 'app.js'), 'utf8');
  const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]));
  // элементы, которые app.js создаёт сам: через .id = "…" или вставкой разметки с id="…"
  const made = new Set([...app.matchAll(/\.id = ["']([^"']+)/g), ...app.matchAll(/id=\\?"([\w-]+)\\?"/g)].map((m) => m[1]));
  for (const m of new Set([...app.matchAll(/\$\("([\w-]+)"\)/g)].map((m) => m[1]))) if (!ids.has(m) && !made.has(m)) P.push('app.js ищет #' + m + ', а на странице его нет');
  // выкладка: файлы, на которые ссылается страница, существуют; секретов нет
  const built = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  for (const m of built.matchAll(/(?:src|href)="([^"#:?]+)(?:\?[^"]*)?"/g)) if (!m[1].startsWith('//') && !fs.existsSync(path.join(out, m[1]))) P.push('нет файла ' + m[1] + ' (ссылка в index.html)');
  for (const f of walk(out).filter((x) => /\.(html|js|css|json|webmanifest)$/.test(x))) {
    const t = fs.readFileSync(f, 'utf8');
    if (/github_pat_|ghp_[A-Za-z0-9]{20}|\d{9,10}:[A-Za-z0-9_-]{35}|-----BEGIN [A-Z ]*PRIVATE KEY/.test(t)) P.push('похоже на ключ или пароль в ' + path.relative(ROOT, f));
  }
  const man = JSON.parse(fs.readFileSync(path.join(out, 'manifest.webmanifest'), 'utf8'));
  (man.icons || []).forEach((i) => { if (!fs.existsSync(path.join(out, i.src))) P.push('нет иконки ' + i.src); });
  // в браузере: повторы id, картинки без описания, кнопки без названия, внешние ссылки
  const b = await launch();
  for (const q of ['?group=11-%D0%90', '?teacher=' + encodeURIComponent('Певцова Л.А.')]) {
    const p = await page(b); await open(p, q);
    await p.evaluate(() => { document.querySelectorAll('details').forEach((d) => { if (!d.hidden) d.open = true; }); });
    await p.waitForTimeout(1500);
    const r = await p.evaluate(() => {
      const bad = [], seen = {};
      document.querySelectorAll('[id]').forEach((e) => { seen[e.id] = (seen[e.id] || 0) + 1; });
      Object.entries(seen).forEach(([k, v]) => { if (v > 1) bad.push('id «' + k + '» повторяется ' + v + ' раз'); });
      document.querySelectorAll('img').forEach((i) => { if (!i.hasAttribute('alt')) bad.push('картинка без описания: ' + i.src.slice(-40)); });
      document.querySelectorAll('button').forEach((x) => { if (!(x.innerText.trim() || x.getAttribute('aria-label') || x.title)) bad.push('кнопка без названия: ' + (x.id || x.className)); });
      document.querySelectorAll('a[target=_blank]').forEach((a) => { if (!/noopener/.test(a.rel)) bad.push('внешняя ссылка без rel=noopener: ' + a.href.slice(0, 60)); });
      document.querySelectorAll('input').forEach((x) => { if (!(x.labels && x.labels.length) && !x.getAttribute('aria-label') && !x.placeholder) bad.push('поле без подписи: ' + (x.id || x.type)); });
      return bad;
    });
    r.forEach((x) => P.push(q + ': ' + x)); P.push(...p.errs.map((x) => q + ': ' + x));
    await p.ctx.close();
  }
  // все внутренние ссылки страницы отвечают
  const p = await page(b); await open(p);
  const links = await p.$$eval('a[href]', (a) => [...new Set(a.map((x) => x.href).filter((h) => h.startsWith(location.origin) && !h.includes('#')))]);
  for (const l of links) { const r = await p.request.get(l).catch(() => null); if (!r || r.status() >= 400) P.push('битая ссылка: ' + l.replace(URL, '') + ' (' + (r ? r.status() : 'нет ответа') + ')'); }
  await b.close();
  report('Код страницы', P);
})();
