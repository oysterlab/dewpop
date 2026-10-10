// Skill gap in the 90 s time attack: a "mash" player (drops anywhere as fast as possible) vs a thinking
// player (look-ahead bot, takes its time). node blitz-skill.mjs '{"rules overrides as JS"}' [seeds]
import * as E from './dist/engine-grid.js';
import { lookahead } from './sim.mjs';
const seeds = +process.argv[3] || 6;
const variant = process.argv[2] ? JSON.parse(process.argv[2]) : {};
if (variant.phys) E.tune(variant.phys);
function rules() {
  const r = E.blitzRules();
  if (variant.colors) { const [a, b, at] = variant.colors; r.colorsAt = p => p < at ? a : b; }
  if (variant.mix != null) r.mixAt = () => variant.mix;
  if (variant.big != null) r.bigAt = () => variant.big;
  return r;
}
function run(seed, mode) {
  const w = E.createWorld(seed, rules()); E.refillTray(w);
  const r = E.rng(seed * 13 + 1);
  const gap = mode === 'mash' ? 24 : 75; // casual = random spot at a human pace // steps between drops (0.4 s vs 1.25 s of thinking)
  while (!w.timeUp && !w.overflow && E.timeLeft(w) > 0) {
    const slots = [0, 1, 2].filter(k => w.tray[k]);
    let k = slots[(r() * slots.length) | 0], x = 1 + r() * (E.W - 2);
    if (mode === 'think') ({ k, x } = lookahead(w, slots));
    E.drop(w, k, x);
    for (let t = 0; t < gap && E.timeLeft(w) > 0; t++) { E.tick(w); if (w.overflow) break; }
  }
  return { pops: w.pops, score: w.score, placed: w.placed, over: !!w.overflow };
}
const out = {};
const modes = (process.argv[4] || 'mash,casual,think').split(',');
for (const mode of modes) {
  const rs = []; for (let s = 1; s <= seeds; s++) rs.push(run(s, mode));
  const avg = f => +(rs.reduce((a, o) => a + f(o), 0) / rs.length).toFixed(2);
  out[mode] = { pops: avg(o => o.pops), score: Math.round(avg(o => o.score)), popsPerDrop: avg(o => o.pops / o.placed), overflow: rs.filter(o => o.over).length };
}
if (out.think && out.casual) out.ratio = +(out.think.popsPerDrop / Math.max(.01, out.casual.popsPerDrop)).toFixed(2);
console.log(JSON.stringify(variant), JSON.stringify(out));
