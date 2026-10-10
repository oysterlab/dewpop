// end-to-end check on mobile + desktop viewports: node browser-test.mjs (server on :4181)
import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:4181/';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let fail = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };
for (const [label, vp] of [['mobile', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 860 }]]) {
  const p = await b.newPage({ viewport: vp, deviceScaleFactor: label === 'mobile' ? 2 : 1, hasTouch: false });
  await p.addInitScript(() => localStorage.setItem('dewpop-opts', JSON.stringify({ record: false })));
  const errs = []; p.on('pageerror', e => errs.push(e.message)); p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  await p.goto(URL); await p.waitForTimeout(1000);
  ok(await p.isVisible('#title:not(.hidden)'), `${label}: title screen`);
  ok(await p.evaluate(() => __dewpop.gl), `${label}: WebGL2 liquid renderer active`);
  await p.click('#playBtn'); await p.waitForTimeout(600);
  ok(await p.evaluate(() => __dewpop.mode === 'play' && __dewpop.game.level === 0), `${label}: tutorial starts`);
  // real drag: grab the 2x2 coral set and drop it over the coral puddle
  const slot = await p.locator('.slot').first().boundingBox();
  const board = await p.evaluate(() => __dewpop.layout().boardRect);
  await p.mouse.move(slot.x + slot.width / 2, slot.y + slot.height / 2); await p.mouse.down();
  await p.mouse.move(board.left + board.width / 2, board.top + board.height * .3, { steps: 8 });
  await p.mouse.up();
  await p.waitForFunction(() => __dewpop.world.pops >= 1, null, { timeout: 15000 }).catch(() => {});
  ok(await p.evaluate(() => __dewpop.world.pops >= 1), `${label}: dragged set merges and pops`);
  await p.waitForSelector('#over:not(.hidden)', { timeout: 8000 }).catch(() => {});
  ok((await p.textContent('#overTitle')).includes('클리어'), `${label}: level clear card`);
  await p.click('#againBtn'); await p.waitForTimeout(500);
  ok(await p.evaluate(() => __dewpop.game.level === 1), `${label}: next level`);
  ok((await p.locator('.goal').count()) >= 1, `${label}: goal chips shown`);
  await p.click('#homeBtn'); await p.waitForTimeout(300);
  ok(await p.isVisible('#map:not(.hidden)') && (await p.locator('.lv:not(.locked)').count()) === 2, `${label}: map unlocks level 2`);
  await p.click('#mapBack'); await p.click('#endlessBtn'); await p.waitForTimeout(400);
  ok(await p.evaluate(() => __dewpop.game.kind === 'endless' && __dewpop.world.tray.every(Boolean)), `${label}: endless with a full tray`);
  await p.evaluate(() => { __dewpop.dropAt(0, 6); __dewpop.dropAt(1, 18); });
  await p.waitForTimeout(1500);
  const n0 = await p.evaluate(() => __dewpop.world.n);
  ok(n0 > 0, `${label}: droplets in the tank (${n0})`);
  await p.click('#tiltR');
  await p.waitForFunction(() => !!__dewpop.world.tilt, null, { timeout: 4000 }).catch(() => {});
  ok(await p.evaluate(() => !!__dewpop.world.tilt), `${label}: tilt (after the tap preview)`);
  await p.waitForTimeout(1500);
  // force an overflow
  await p.evaluate(() => { const w = __dewpop.world, E = __dewpop.E; E.fillBox(w, 0, -8.5, 24, E.H - 3, E.MUD); });
  await p.waitForSelector('#over:not(.hidden)', { timeout: 40000 }).catch(() => {});
  ok((await p.textContent('#overTitle')).includes('넘쳤'), `${label}: overflow game over`);
  const scroll = await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  ok(scroll, `${label}: no horizontal overflow`);
  await p.screenshot({ path: `shots/test-${label}.png` });
  ok(!errs.length, `${label}: no console errors ${errs.slice(0, 2).join(' | ')}`);
  await p.close();
}
await b.close();
if (fail) { console.log(fail + ' failed'); process.exit(1); }
console.log('browser test passed');
