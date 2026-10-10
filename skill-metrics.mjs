// Skill metrics: node skill-metrics.mjs '{"PHYS overrides"}'
//  1) endless: survival & pops for random vs heuristic bot, share of "passive" lines (formed without the latest piece)
//  2) slosh: on the same boards, lines from shaking LEFT vs RIGHT vs not shaking
import * as EP from './dist/engine.js';
import * as EG from './dist/engine-grid.js';
const E = process.env.ENGINE === 'particle' ? EP : EG;
import { play } from './sim.mjs';
const ov = JSON.parse(process.argv[2] || '{}'); E.tune(ov);
const N = +process.argv[3] || 5;
const res = {};
for (const smart of [false, true, 'look']) {
  const rs = []; for (let s = 1; s <= (smart === 'look' ? Math.min(N, 3) : N); s++) rs.push(play(s, { smart, cap: 160 }));
  const placed = rs.reduce((a, o) => a + o.placed, 0), pops = rs.reduce((a, o) => a + o.pops, 0), passive = rs.reduce((a, o) => a + o.w.passivePops, 0);
  res[smart === 'look' ? 'look' : smart ? 'smart' : 'random'] = { survive: rs.map(o => o.placed).join(','), popsPerMove: +(pops / placed).toFixed(2), passiveShare: pops ? Math.round(passive / pops * 100) + '%' : '-' };
}
const avg = s => s.split(',').reduce((a, b) => a + +b, 0) / s.split(',').length;
res.survivalRatio = +(avg(res.smart.survive) / avg(res.random.survive)).toFixed(2);
res.lookRatio = +(avg(res.look.survive) / avg(res.random.survive)).toFixed(2);
// slosh direction sensitivity
let L = 0, R = 0, none = 0, differ = 0, boards = 0;
for (let s = 1; s <= 12; s++) {
  const base = play(100 + s, { smart: false, cap: 14 }).w; if (base.overflow) continue; boards++;
  const out = {};
  for (const d of [0, -1, 1]) {
    const w = E.cloneWorld(base); w.charges = 3; const p0 = w.pops;
    if (d) E.startTilt(w, d);
    for (let k = 0; k < 500; k++) E.tick(w);
    out[d] = w.pops - p0;
  }
  none += out[0]; L += out[-1]; R += out[1]; if (out[-1] !== out[1]) differ++;
}
res.slosh = { boards, noShake: none, left: L, right: R, boardsWhereDirectionMatters: `${differ}/${boards}` };
console.log(JSON.stringify(ov), JSON.stringify(res));
