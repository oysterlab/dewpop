// How often does the drop preview ("a line will pop" / "no line") match what really happens?  node predict-check.mjs [boards]
import * as EP from './dist/engine.js';
import * as EG from './dist/engine-grid.js';
const E = process.env.ENGINE === 'particle' ? EP : EG;
import { play } from './sim.mjs';
const N = +process.argv[2] || 20;
let agree = 0, total = 0, predYes = 0, realYes = 0, missed = 0, falseAlarm = 0;
for (let s = 1; s <= N; s++) {
  const base = play(500 + s, { smart: s % 2 === 0, cap: 6 + (s % 10) }).w;
  if (base.overflow) continue;
  for (let t = 0; t < 400; t++) E.tick(base); // let it calm down like a player would before aiming
  const r = E.rng(s);
  for (let trial = 0; trial < 4; trial++) {
    const slot = [0, 1, 2].find(k => base.tray[k]); if (slot == null) break;
    const x = r() * E.W;
    const pred = E.predict(base, { type: 'drop', slot, x });
    const v = E.cloneWorld(base); E.drop(v, slot, x);
    let popped = false; for (let k = 0; k < 500 && !popped; k++) for (const e of E.tick(v)) if (e.type === 'lock') popped = true;
    const p = !!pred.line; total++; if (p === popped) agree++; if (p) predYes++; if (popped) realYes++;
    if (popped && !p) missed++; if (p && !popped) falseAlarm++;
  }
}
console.log(JSON.stringify({ drops: total, agreement: (agree / total * 100).toFixed(1) + '%', predictedLines: predYes, realLines: realYes, missed, falseAlarm }));
