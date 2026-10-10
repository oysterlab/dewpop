// Records a scripted session through the real UI code path, then replays it and checks the result is identical.
import { chromium } from 'playwright';
const URL = process.env.URL || 'http://localhost:4181/';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 } });
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto(URL); await p.waitForTimeout(800);
await p.evaluate(() => __dewpop.startGame('endless')); await p.waitForTimeout(500);
for (let i = 0; i < 10; i++) {
  await p.evaluate(i => { const d = __dewpop, k = [0, 1, 2].find(j => d.world.tray[j]); d.dropAt(k, 2 + (i * 7.7) % 20); }, i);
  await p.waitForTimeout(250 + (i % 3) * 300);
  if (i === 5) { await p.evaluate(() => { __dewpop.world.charges = Math.max(1, __dewpop.world.charges); }); }
}
await p.waitForTimeout(2500);
const live = await p.evaluate(() => ({ steps: __dewpop.world.steps }));
await p.click('#homeBtn'); await p.waitForTimeout(800);
const list = await (await fetch(URL + 'api/logs')).json();
const last = list.sort((a, c) => c.startedAt.localeCompare(a.startedAt))[0];
const rec = await (await fetch(URL + 'api/log/' + last.id)).json();
console.log('recorded', last.id, 'actions', rec.actions.length, 'end', JSON.stringify(rec.end));
// replay
const q = await b.newPage({ viewport: { width: 390, height: 844 } });
q.on('pageerror', e => console.log('ERR', e.message));
await q.goto(URL + '?replay=' + last.id);
await q.waitForFunction(s => window.__dewpop?.world?.steps >= s, rec.end.step, { timeout: 300000, polling: 50 });
const rp = await q.evaluate(() => { const w = __dewpop.world; return { step: w.steps, score: w.score, placed: w.placed, pops: w.pops, n: w.n }; });
console.log('replay at step', rp.step, JSON.stringify(rp));
const ok = rp.placed === rec.end.placed && rp.pops === rec.end.pops && rp.score === rec.end.score;
console.log(ok ? 'REPLAY MATCHES' : 'REPLAY DIFFERS');
await b.close();
(await import('node:fs')).rmSync(`logs/${last.id}.json`, { force: true }); // test session, not a real player
process.exit(ok ? 0 : 1);
