// Re-render recorded sessions as video + key-moment stills:  node replay.mjs [id ...]   (no ids = all not yet rendered)
// Output: recordings/<id>/replay.webm, recordings/<id>/pop-<n>.png, drop-<n>.png, end.png
import { chromium } from 'playwright';
import fs from 'node:fs';
const URL = process.env.URL || 'http://localhost:4181/';
let ids = process.argv.slice(2);
if (!ids.length) ids = fs.readdirSync('logs').filter(f => /^s[a-z0-9]+\.json$/i.test(f)).map(f => f.slice(0, -5)).filter(id => !fs.existsSync(`recordings/${id}/replay.webm`));
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
for (const id of ids) {
  const s = JSON.parse(fs.readFileSync(`logs/${id}.json`));
  if (!s.actions.length) { console.log(id, 'skipped (empty)'); continue; }
  const dir = `recordings/${id}`; fs.mkdirSync(dir, { recursive: true });
  const [vw, vh] = s.viewport;
  const ctx = await b.newContext({ viewport: { width: Math.min(vw, 480), height: vh }, recordVideo: { dir, size: { width: Math.min(vw, 480), height: vh } } });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log(id, 'ERR', e.message));
  await p.goto(URL + '?replay=' + id);
  await p.waitForFunction(() => window.__replay, null, { timeout: 60000 });
  const dropSteps = s.actions.filter(a => a.type === 'drop').map(a => a.step);
  let pops = 0, di = 0;
  const endStep = (s.end ? s.end.step : s.actions.at(-1).step) + 150;
  for (;;) {
    const st = await p.evaluate(() => ({ step: __dewpop.world.steps, pops: __dewpop.world.pops, mode: __dewpop.mode }));
    if (st.pops > pops) { pops = st.pops; await p.screenshot({ path: `${dir}/pop-${pops}.png` }); }
    while (di < dropSteps.length && st.step >= dropSteps[di]) { di++; if (di % 3 === 0) await p.screenshot({ path: `${dir}/drop-${di}.png` }); }
    if (st.step >= endStep || st.mode === 'over') break;
    await p.waitForTimeout(120);
  }
  await p.waitForTimeout(800); await p.screenshot({ path: `${dir}/end.png` });
  const v = p.video(); await ctx.close();
  fs.renameSync(await v.path(), `${dir}/replay.webm`);
  console.log(id, 'rendered', dir);
}
await b.close();
