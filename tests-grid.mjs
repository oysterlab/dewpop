// grid-engine tests: node tests-grid.mjs
import * as E from './dist/engine-grid.js';
import { LEVELS, levelRules } from './dist/levels.js';
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };
const run = (w, n) => { const ev = []; for (let k = 0; k < n; k++) ev.push(...E.tick(w)); return ev; };
const settle = (w, max = 900) => { const ev = []; for (let k = 0; k < max; k++) { ev.push(...E.tick(w)); if (E.settled(w) && k > 20) break; } return ev; };
const SQ = [[0, 0], [1, 0], [0, 1], [1, 1]];
{ const w = E.createWorld(1); E.spawnPiece(w, SQ, 12, 1); settle(w);
  ok(w.n === 4 * E.DROP_N && w.bodies.length === 1 && w.bodies[0].span < .95, `a 2x2 set lands as one puddle short of the walls (span ${w.bodies[0]?.span.toFixed(2)})`);
  ok(E.settled(w) && w.moved === 0, 'it comes fully to rest'); }
{ // determinism
  const a = E.createWorld(5), b = E.createWorld(5);
  for (const w of [a, b]) { E.spawnPiece(w, SQ, 6, 1); run(w, 50); E.spawnPiece(w, [[0, 0], [1, 0], [2, 0]], 17, 4); run(w, 300); }
  let same = a.n === b.n; for (let i = 0; i < a.n && same; i++) if (a.gx[i] !== b.gx[i] || a.gy[i] !== b.gy[i]) same = false;
  ok(same, 'identical inputs → identical grid'); }
{ // wall to wall pops; the other colour stays
  const w = E.createWorld(2); E.loadPreset(w, { fills: [[0, 0, 8, 1.5, 4], [16, 0, 24, 1.5, 4], [8, 0, 16, 1, 2]] });
  ok(w.pops === 0, 'gap between two blue pools: no line');
  E.spawnPiece(w, SQ, 12, 4); const ev = settle(w, 1200).filter(e => e.type === 'pop');
  ok(ev.length >= 1 && ev[0].groups[0].color === 4, 'filling the gap joins wall to wall and pops'); }
{ // a lock precedes the pop
  const w = E.createWorld(3); E.loadPreset(w, { fills: [[0, 0, 9, 1.5, 1], [15, 0, 24, 1.5, 1]] }); E.spawnPiece(w, SQ, 12, 1);
  let lock = -1, pop = -1; for (let k = 0; k < 900 && pop < 0; k++) for (const e of E.tick(w)) { if (e.type === 'lock' && lock < 0) lock = k; if (e.type === 'pop') pop = k; }
  ok(lock >= 0 && pop - lock >= E.LOCK_STEPS - 3, `line locks then pops (${pop - lock} ticks later)`); }
{ // tilt slides liquid a bounded distance toward the side
  const w = E.createWorld(4); E.spawnPiece(w, [[0, 0], [1, 0]], 10, 2); settle(w);
  const cx = () => { let s = 0; for (let i = 0; i < w.n; i++) s += w.gx[i]; return s / w.n; };
  const x0 = cx(); w.charges = 1; ok(E.startTilt(w, 1), 'tilt starts'); settle(w);
  const dx = (cx() - x0) * E.CS; ok(dx > 1 && dx <= E.PHYS.tiltCells * E.CS + .01, `tilt slides right ${dx.toFixed(1)} units (≤ ${E.PHYS.tiltCells * E.CS})`); }
{ // the preview is exact
  const w = E.createWorld(6); E.loadPreset(w, { fills: [[0, 0, 9, 1.5, 1], [15, 0, 24, 1.5, 1]] }); E.refillTray(w);
  w.tray[2] = { cells: SQ, cols: [1, 1, 1, 1] };
  const pr = E.predict(w, { type: 'drop', slot: 2, x: 12 });
  const v = E.cloneWorld(w); E.drop(v, 2, 12); let locked = false; for (let k = 0; k < 600 && !locked; k++) for (const e of E.tick(v)) if (e.type === 'lock') locked = true;
  ok(!!pr.line === locked && locked, 'preview line matches the real outcome'); }
{ // mud washes, pearls collected
  const w = E.createWorld(7, levelRules({ goals: [{ type: 'mud', pct: 10 }], colors: 3 }));
  E.loadPreset(w, { fills: [[0, 0, 24, 1, E.MUD], [0, 1, 9, 2.5, 1], [15, 1, 24, 2.5, 1]], pearls: [[12, 4]] });
  E.spawnPiece(w, SQ, 12, 1); settle(w, 1500);
  ok(w.pops >= 1 && w.mudCleared > 0, `mud washed (${w.mudCleared}/${w.mudStart})`);
  ok(w.pearlsGot === 1, 'pearl collected'); }
{ // presets + snapshot round trip
  let bad = 0;
  for (const [k, def] of LEVELS.entries()) { const w = E.createWorld(10 + k, levelRules(def)); E.loadPreset(w, def.preset || {}); E.refillTray(w); const ev = run(w, 200); if (ev.some(e => e.type === 'pop') || w.overflow) { bad++; console.log('  level', k + 1, 'pops at load'); } }
  ok(!bad, `all ${LEVELS.length} level presets load without instant pops`);
  const w = E.createWorld(9); E.spawnPiece(w, SQ, 8, 3); run(w, 40);
  const v = E.restoreWorld(E.snapshotWorld(w)); run(w, 200); run(v, 200);
  let same = w.n === v.n; for (let i = 0; i < w.n && same; i++) if (w.gx[i] !== v.gx[i] || w.gy[i] !== v.gy[i]) same = false;
  ok(same, 'snapshot/restore continues identically'); }
if (fails) { console.log(fails + ' failed'); process.exit(1); }
console.log('all grid tests passed');
