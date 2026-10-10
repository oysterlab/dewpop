// Visual audit: plays a scripted endless game and saves many board frames (falling, landing, pops, tilts)
import { chromium } from 'playwright';
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
await p.addInitScript(() => localStorage.setItem('dewpop-opts', JSON.stringify({ record: false })));
p.on('pageerror', e => console.log('ERR', e.message));
await p.goto(process.env.URL || 'http://localhost:4181/'); await p.waitForTimeout(800);
await p.evaluate(() => __dewpop.startGame('endless', 0, 4242));
const box = await p.evaluate(() => { const r = __dewpop.layout().boardRect; return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const clip = { x: Math.max(0, box.x - 4), y: Math.max(0, box.y - 4), width: box.w + 8, height: box.h + 8 };
let k = 0;
const shot = async tag => { await p.screenshot({ path: `shots/audit/${String(k++).padStart(3, '0')}-${tag}.png`, clip }); };
const xs = [4, 20, 12, 7, 17, 10, 3, 21, 14, 8, 18, 11, 5, 19, 13, 9, 16, 6, 22, 12, 4, 20, 10, 15];
for (let i = 0; i < xs.length; i++) {
  await p.evaluate(x => __dewpop.dropAt(2, x), xs[i]);
  for (const ms of [120, 200, 300, 500]) { await p.waitForTimeout(ms); if (i % 3 === 0 || ms === 500) await shot(`d${i}-${ms}`); }
  if (i === 10 || i === 18) { await p.evaluate(d => __dewpop.tilt(d), i === 10 ? -1 : 1); for (const ms of [200, 400, 700]) { await p.waitForTimeout(ms); await shot(`tilt${i}-${ms}`); } }
}
await p.waitForTimeout(2000); await shot('end');
await b.close();
console.log('frames', k);
