import { chromium } from 'playwright';
const [,, name, script, times] = process.argv;
const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const logs = []; p.on('pageerror', e => logs.push('ERR ' + e.message));
await p.goto('http://localhost:4181/'); await p.waitForTimeout(1200);
await p.evaluate(script);
let t = 0;
for (const [k, at] of times.split(',').map(Number).entries()) { await p.waitForTimeout(at - t); t = at; await p.screenshot({ path: `shots/${name}${k}.png`, clip: { x: 20, y: 60, width: 350, height: 640 } }); }
console.log(logs.join('\n'), await p.evaluate(() => JSON.stringify({ n: __dewpop.world.n, pops: __dewpop.world.pops, fps: window.__fps })));
await b.close();
