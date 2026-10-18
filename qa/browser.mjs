// Real-Chrome regression suite. Usage: node qa/browser.mjs [baseUrl]   (needs playwright-core and Chrome; set CHROME_PATH if not /usr/bin/google-chrome)
import { chromium } from 'playwright-core';
const BASE = process.argv[2] || 'http://127.0.0.1:5199/';
const exe = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const results = []; const ok = (name, pass, info = '') => { results.push({ name, pass, info }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${info ? '  - ' + info : ''}`); };
const browser = await chromium.launch({ executablePath: exe, args: ['--no-sandbox'] });
const open = async (w, h, qs = '?demo', init, touch = false) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: touch, isMobile: touch && w < 800 });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', e => errs.push(String(e))); page.errs = errs;
  await page.goto(BASE + qs); await page.waitForSelector('.topbar'); await page.waitForTimeout(400); return page;
};
const rect = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom }; }, sel);
const hit = (a, b) => a && b && a.x < b.r - 1 && b.x < a.r - 1 && a.y < b.b - 1 && b.y < a.b - 1;

// P1-05 welcome reachable on small and short screens
for (const [w, h] of [[320, 568], [667, 375], [320, 180]]) {
  const p = await open(w, h, '?demo&welcome');
  const info = await p.evaluate(() => { const c = document.querySelector('.welcome'); const btn = [...document.querySelectorAll('.wcard .btn')].pop(); c.scrollTop = c.scrollHeight; const r = btn.getBoundingClientRect(); return { scrollable: c.scrollHeight > c.clientHeight, bottomVisible: r.bottom <= innerHeight + 1 && r.top >= 0, closeVisible: !!document.querySelector('.wclose') }; });
  ok(`P1-05 welcome last action reachable by scrolling @${w}x${h}`, info.bottomVisible && info.closeVisible, JSON.stringify(info));
  if (w === 320 && h === 568) await p.screenshot({ path: 'shots/welcome-320x568.png' });
  await p.context().close();
}
// P1-12 zoom buttons respond to real pointer clicks and taps
for (const [w, h, touch] of [[1440, 900, false], [390, 844, true]]) {
  const p = await open(w, h, '?demo', null, touch);
  await p.evaluate(() => {}); const z0 = await p.evaluate(() => window.__view.z);
  const b = await p.$('.zoombar button[aria-label="Zoom in"]'); touch ? await b.tap() : await b.click(); await p.waitForTimeout(700);
  const z1 = await p.evaluate(() => window.__view.z); ok(`P1-12 zoom in by ${touch ? 'tap' : 'mouse click'} @${w}x${h}`, z1 > z0 * 1.1, `${z0.toFixed(3)} -> ${z1.toFixed(3)}`);
  const o = await p.$('.zoombar button[aria-label="Zoom out"]'); touch ? await o.tap() : await o.click(); await p.waitForTimeout(700);
  const z2 = await p.evaluate(() => window.__view.z); ok(`P1-12 zoom out by ${touch ? 'tap' : 'mouse click'} @${w}x${h}`, z2 < z1 * 0.95, `${z1.toFixed(3)} -> ${z2.toFixed(3)}`);
  await p.context().close();
}
// P1-06 desktop -> phone resize leaves at most one drawer
{
  const p = await open(1440, 900); await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(400);
  const open2 = await p.evaluate(() => ({ pal: !!document.querySelector('.palette'), ins: !!document.querySelector('.inspector'), scrimShown: getComputedStyle(document.querySelector('.scrim')).display !== 'none' }));
  ok('P1-06 resize desktop->phone closes both drawers (no overlap, no scrim)', !open2.pal && !open2.ins && !open2.scrimShown, JSON.stringify(open2));
  await p.click('.edge-toggle.l'); await p.waitForTimeout(200); await p.click('.edge-toggle.r').catch(() => {});
  const one = await p.evaluate(() => [!!document.querySelector('.palette'), !!document.querySelector('.inspector')].filter(Boolean).length);
  ok('P1-06 opening the second drawer on a phone replaces the first', one <= 1, `open drawers=${one}`);
  await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(300);
  ok('P1-06 back to desktop restores both panels', await p.evaluate(() => !!document.querySelector('.palette') && !!document.querySelector('.inspector')));
  await p.screenshot({ path: 'shots/after-resize-desktop.png' }); await p.context().close();
}
// P1-07 topbar / dock collisions
for (const [w, h] of [[1100, 768], [1101, 768], [1180, 820], [1280, 720], [1366, 768], [1440, 900], [1500, 900], [1600, 900], [844, 390], [960, 540], [1024, 768]]) {
  const p = await open(w, h);
  const hud = await rect(p, '.hud'), right = await rect(p, '.right'), brand = await rect(p, '.brand'), dock = await rect(p, '.dock'), zb = await rect(p, '.zoombar'), tg = await rect(p, '.edge-toggle.l'), tr = await rect(p, '.edge-toggle.r');
  const spill = await p.evaluate(() => { const hud = document.querySelector('.hud'); const hr = hud.getBoundingClientRect(); return [...hud.querySelectorAll('.stat')].filter(e => e.offsetParent && (e.getBoundingClientRect().right > hr.right + 1)).length; });
  const bad = [hit(hud, right) && 'hud/right', hit(hud, brand) && 'hud/brand', dock && hit(dock, hud) && 'dock/hud', dock && hit(dock, zb) && 'dock/zoom', dock && hit(dock, tg) && 'dock/toggleL', dock && hit(dock, tr) && 'dock/toggleR', spill && 'stat spill'].filter(Boolean);
  ok(`P1-07 no topbar/dock collisions @${w}x${h}`, bad.length === 0, bad.join(','));
  if ([1101, 844].includes(w)) await p.screenshot({ path: `shots/topbar-${w}x${h}.png` });
  await p.context().close();
}
// P1-09 Academy isolation
{
  const p = await open(1440, 900); const n0 = await p.evaluate(() => document.querySelectorAll('.node').length);
  await p.click('.node'); await p.click('button[aria-label*="Academy" i], button[title*="Academy" i]').catch(async () => { await p.getByText('Academy').first().click(); }); await p.waitForSelector('.acad'); await p.waitForTimeout(300);
  const f = await p.evaluate(() => ({ inDlg: !!document.activeElement.closest('.acad'), inert: document.querySelector('.app').hasAttribute('inert'), modal: document.querySelector('.acad').getAttribute('aria-modal') }));
  ok('P1-09 focus moves into Academy, background inert, aria-modal', f.inDlg && f.inert && f.modal === 'true', JSON.stringify(f));
  let escaped = false; for (let i = 0; i < 60; i++) { await p.keyboard.press('Tab'); if (!(await p.evaluate(() => !!document.activeElement.closest('.acad')))) { escaped = true; break; } }
  ok('P1-09 Tab never leaves Academy', !escaped);
  const playing0 = await p.evaluate(() => !!document.querySelector('.ibtn.big')?.getAttribute('aria-label')?.match(/pause/i));
  await p.click('.acad h1, .acad h2, .acad .ahead').catch(() => {}); await p.keyboard.press('Delete'); await p.keyboard.press('Space');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  const n1 = await p.evaluate(() => document.querySelectorAll('.node').length);
  ok('P1-09 Delete/Space inside Academy do not change the canvas', n1 === n0, `${n0} -> ${n1}`);
  await p.context().close();
}
// P1-10 corrupt progress and corrupt canvas recover
for (const bad of ['{}', 'null', '"x"', '[1,{"a":1},null]', '{"a":']) {
  const p = await open(1440, 900, '?demo&academy', `localStorage.setItem('ostown2.academy.done', ${JSON.stringify(bad)})`);
  const alive = await p.evaluate(() => !!document.querySelector('.acad')); ok(`P1-10 Academy opens with progress=${bad}`, alive && p.errs.length === 0, p.errs[0] || ''); await p.context().close();
}
{ const p = await open(1440, 900, '?demo', `localStorage.setItem('ostown.v32','null')`); ok('P1-10 literal null canvas save does not crash', await p.evaluate(() => !!document.querySelector('.topbar')) && p.errs.length === 0, p.errs[0] || ''); await p.context().close(); }
// P2-01/13 deep links
{ const p = await open(1440, 900, '?academy&lesson=vfs'); ok('P2-01 ?academy&lesson=vfs opens that lesson without ?demo', await p.evaluate(() => !!document.querySelector('.acad') && /file|vfs|filesystem/i.test(document.querySelector('.acad').innerText)), ''); await p.context().close(); }
{ const p = await open(1440, 900, '?demo&s=__proto__&warm=999999999&dock=zzz&theme=evil'); ok('P2-13 hostile URL values are validated, no crash', p.errs.length === 0 && await p.evaluate(() => !!document.querySelector('.topbar'))); await p.context().close(); }
// P2-03 Escape cancels a field edit
{
  const p = await open(1440, 900, '?demo&sel=ram'); const inp = p.locator('.inspector input[aria-label="RAM size"]'); await inp.waitFor();
  const before = await inp.inputValue(); await inp.click(); await inp.fill('3'); await p.keyboard.press('Escape'); await p.waitForTimeout(200);
  ok('P2-03 Escape restores the previous RAM size', (await inp.inputValue()) === before, `${before} -> ${await inp.inputValue()}`); await p.context().close();
}
// desktop + phone + tablet screenshots
for (const [n, w, h, t] of [['phone', 390, 844, true], ['tablet', 820, 1180, true], ['desktop', 1440, 900, false]]) { const p = await open(w, h, '?demo&warm=600', null, t); await p.screenshot({ path: `shots/${n}-${w}x${h}.png` }); ok(`no runtime errors @${n}`, p.errs.length === 0, p.errs[0] || ''); await p.context().close(); }
await browser.close();
const failed = results.filter(r => !r.pass); console.log(`\n${results.length - failed.length}/${results.length} passed`); process.exit(failed.length ? 1 : 0);
