// headless play-through: random or heuristic bot, reports pops / survival / perf
import * as EP from './dist/engine.js';
import * as EG from './dist/engine-grid.js';
const E = process.env.ENGINE === 'particle' ? EP : EG;
export function play(seed, { smart = false, cap = 150, rules, preset, log = false } = {}) {
  const w = E.createWorld(seed, rules || E.endlessRules());
  if (preset) E.loadPreset(w, preset);
  E.refillTray(w);
  const r = E.rng(seed * 7 + 3);
  let steps = 0;
  while (!w.overflow && w.placed < cap) {
    if (w.rules.moves && w.placed >= w.rules.moves) break;
    if (w.rules.goals.length && E.goalsMet(w)) break;
    const slots = [0, 1, 2].filter(k => w.tray[k]);
    let k = slots[(r() * slots.length) | 0], x = 1 + r() * (E.W - 2);
    if (smart === 'look') ({ k, x } = lookahead(w, slots));
    else if (smart) ({ k, x } = choose(w, slots, r));
    E.drop(w, k, x);
    // wait until things calm down (or a time cap) like a player would
    let t = 0;
    while (t < 90 || (!E.settled(w) && t < 600)) { E.tick(w); t++; if (w.overflow) break; }
    steps += t;
    if (log) console.log(w.placed, 'n', w.n, 'pops', w.pops, 'fill', E.fillLevel(w).toFixed(2));
  }
  return { placed: w.placed, pops: w.pops, score: w.score, overflow: w.overflow, steps, n: w.n, w };
}
// look-ahead bot: actually simulate each candidate drop and keep the best outcome
// (lines popped, then how close the bodies got to the walls, minus height) — a proxy for a skilled player
export function lookahead(w, slots) {
  let best = null;
  for (const k of slots) {
    const p = w.tray[k];
    for (let i = 0; i < 7; i++) {
      const x = E.clampPieceX(p.cells, 1 + i * (E.W - 2) / 6);
      const v = E.cloneWorld(w); v.tray = w.tray.map(t => t && { ...t }); v.rules = w.rules; v.placed = w.placed; v.sinceMud = 99; v.pending = [];
      v.rules = { ...w.rules, mudEvery: () => 0 };
      E.drop(v, k, x);
      for (let t = 0; t < 200; t++) E.tick(v);
      let reach = 0; for (const b of v.bodies || []) reach += b.span * b.span * b.drops;
      const sc = (v.pops - w.pops) * 100 + reach - E.fillLevel(v) * 40 - (v.overflow ? 1e4 : 0);
      if (!best || sc > best.sc) best = { sc, k, x };
    }
  }
  return best;
}
// heuristic for the wall-to-wall rule: extend a same-colour body toward a wall or bridge the gap
// between two same-colour bodies; avoid covering other colours' near-complete bodies.
export function choose(w, slots, r) {
  const bodies = w.bodies || [];
  let best = null;
  for (const k of slots) {
    const p = w.tray[k];
    const ph = E.shapeSize(p.cells).h, low = p.cols.filter((c, j) => p.cells[j][1] === ph - 1);
    const pc = low.sort((a, b) => low.filter(v => v === b).length - low.filter(v => v === a).length)[0];
    const half = (E.shapeSize(p.cells).w - 1) / 2 * E.CELL + E.dropR(E.DROP_N);
    const mine = bodies.filter(b => b.color === pc).sort((a, b) => a.x0 - b.x0);
    const cands = [];
    for (let k2 = 0; k2 + 1 < mine.length; k2++) { const g0 = mine[k2].x1, g1 = mine[k2 + 1].x0; if (g1 > g0) cands.push({ x: (g0 + g1) / 2, sc: 30 + (mine[k2].span + mine[k2 + 1].span) * 20 }); }
    for (const b of mine) {
      const touchL = b.x0 < 1, touchR = b.x1 > E.W - 1;
      if (!touchR) cands.push({ x: b.x1 + half * .8, sc: 12 + b.span * 20 + (touchL ? 8 : 0) });
      if (!touchL) cands.push({ x: b.x0 - half * .8, sc: 12 + b.span * 20 + (touchR ? 8 : 0) });
    }
    // start a new run at a wall
    cands.push({ x: 0, sc: 6 }, { x: E.W, sc: 6 });
    for (let t = 0; t < 4; t++) cands.push({ x: r() * E.W, sc: 2 });
    for (const c of cands) {
      const x = E.clampPieceX(p.cells, c.x);
      // penalty: landing on a different colour body that is already wide
      let pen = 0; for (const b of bodies) if (b.color !== pc && x > b.x0 - half && x < b.x1 + half) pen += b.span * 15;
      const sc = c.sc - pen + r();
      if (!best || sc > best.sc) best = { sc, k, x };
    }
  }
  return best;
}
if (process.argv[1]?.endsWith('sim.mjs')) {
  const n = +process.argv[2] || 3, smart = process.argv[3] === 'look' ? 'look' : process.argv[3] === 'smart';
  if (process.argv[5] && process.argv[5] !== '{}') Object.assign(E.ENDLESS, JSON.parse(process.argv[5]));
  if (process.argv[6]) E.tune(JSON.parse(process.argv[6]));
  const t0 = performance.now(); let res = [];
  for (let s = 1; s <= n; s++) { const o = play(s, { smart, cap: +process.argv[4] || 150 }); res.push(o); console.log(JSON.stringify({ seed: s, placed: o.placed, pops: o.pops, chain: o.w.bestChain, score: o.score, over: o.overflow })); }
  const steps = res.reduce((a, o) => a + o.steps, 0);
  console.log('ms/step', ((performance.now() - t0) / steps).toFixed(3));
}
