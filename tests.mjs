// engine tests: node tests.mjs
import * as E from './dist/engine.js';
import { LEVELS, levelRules } from './dist/levels.js';
let fails = 0;
const ok = (c, msg) => { if (!c) { fails++; console.log('FAIL', msg); } else console.log('ok  ', msg); };
const run = (w, n) => { const ev = []; for (let k = 0; k < n; k++) ev.push(...E.tick(w)); return ev; };
const SQ = [[0, 0], [1, 0], [0, 1], [1, 1]];
const bodies = (w, c) => (w.bodies || []).filter(b => b.color === c);
// drop single droplets into the gap between the leftmost and rightmost bodies of colour c until it pops
const bridge = (w, c, tries = 4) => {
  const ev = [];
  for (let t = 0; t < tries && !w.pops; t++) {
    const bs = bodies(w, c).sort((a, b) => a.x0 - b.x0); if (bs.length < 2) break;
    let gx = null; for (let k = 0; k + 1 < bs.length; k++) if (bs[k + 1].x0 - bs[k].x1 > .3) { gx = (bs[k].x1 + bs[k + 1].x0) / 2; break; }
    if (gx == null) break;
    E.spawnPiece(w, [[0, 0]], gx, c); ev.push(...run(w, 600));
  }
  return ev;
};

{ // a set falls, merges into one body and comes to rest (no endless jitter)
  const w = E.createWorld(1);
  E.spawnPiece(w, SQ, 12, 1);
  run(w, 900);
  ok(bodies(w, 1).length === 1 && bodies(w, 1)[0].drops === 4 && bodies(w, 1)[0].span < .9 && w.pops === 0, 'a 2x2 set lands as one body of 4 droplets, short of the walls');
  ok(w.meanSpeed < 0.0005, `liquid comes fully to rest (mean speed ${w.meanSpeed.toFixed(4)})`);
  ok(E.settled(w), 'settled() reports rest');
}
{ // a colour that reaches both side walls pops; other colours stay
  const w = E.createWorld(2);
  E.loadPreset(w, { fills: [[0, 0, 6, 1.4, 4], [18, 0, 24, 1.4, 4], [8.5, 0, 15.5, 1.2, 2]] });
  run(w, 200);
  ok(w.pops === 0 && bodies(w, 4).length === 2, 'two blue bodies on opposite walls with a gap: no pop yet');
  const before = w.n;
  E.spawnPiece(w, [[0, 0], [1, 0], [2, 0], [3, 0]], 12, 4);
  const ev = [...run(w, 600), ...bridge(w, 4)].filter(e => e.type === 'pop');
  ok(ev.length >= 1 && ev[0].groups[0].color === 4, 'bridging the gap joins wall to wall and pops');
  run(w, 60); ok(w.n > 0 && w.n < before && bodies(w, 4).every(b => b.drops <= 1) && bodies(w, 2).length === 1, 'the blue bodies are gone, yellow stays');
}
{ // a connected line locks (shows the join) before it pops
  const w = E.createWorld(8);
  E.loadPreset(w, { fills: [[0, 0, 9, 1.6, 1], [15, 0, 24, 1.6, 1]] });
  E.spawnPiece(w, SQ, 12, 1);
  let lockAt = -1, popAt = -1;
  for (let k = 0; k < 600 && popAt < 0; k++) for (const e of E.tick(w)) { if (e.type === 'lock' && lockAt < 0) lockAt = k; if (e.type === 'pop') popAt = k; }
  ok(lockAt >= 0 && popAt - lockAt >= E.LOCK_STEPS - 3, `the line locks first and pops ${popAt - lockAt} steps later`);
}
{ // different colours never merge into one body
  const w = E.createWorld(3);
  E.spawnPiece(w, SQ, 0, 1); E.spawnPiece(w, SQ, 24, 3); run(w, 700);
  ok(bodies(w, 1).length === 1 && bodies(w, 3).length === 1 && w.pops === 0, 'red on the left wall and green on the right wall stay separate');
}
{ // liquid only: weight on top squeezes the layer below until it reaches both walls
  const w = E.createWorld(7);
  E.loadPreset(w, { fills: [[0, 0, 24, 1.2, 2], [4, 1.2, 20, 2.4, 1]] }); run(w, 200);
  const p0 = w.pops;
  for (const x of [6, 18, 12]) { E.spawnPiece(w, SQ, x, 3); run(w, 400); }
  ok(w.pops > p0, 'pressing a layer from above spreads it wall to wall and pops it');
}
{ // mud next to a popping body washes away; pearls next to it are collected
  const w = E.createWorld(4, levelRules({ goals: [{ type: 'mud', pct: 10 }], colors: 3 }));
  E.loadPreset(w, { fills: [[0, 0, 24, 1.5, E.MUD], [0, 1.5, 9, 2.6, 1]], pearls: [[13, 3.2]] });
  const mud0 = w.mudStart;
  E.spawnPiece(w, SQ, 24, 1); run(w, 500);
  bridge(w, 1, 6);
  ok(w.pops >= 1 && w.mudCleared > 0 && w.mudCleared < mud0, `mud washed: ${w.mudCleared}/${mud0}`);
  ok(w.pearlsGot === 1, 'pearl collected by the pop');
}
{ // tilt pushes the liquid sideways
  const w = E.createWorld(5);
  E.spawnPiece(w, SQ, 12, 1); run(w, 500);
  const cx = () => { let s = 0; for (let i = 0; i < w.n; i++) s += w.x[i]; return s / w.n; };
  const x0 = cx(); ok(E.startTilt(w, 1), 'tilt starts with a charge'); run(w, 320);
  ok(cx() > x0 + 2 && cx() < x0 + 9, `a gentle tilt slides the liquid a few units right (${x0.toFixed(1)} → ${cx().toFixed(1)})`);
}
{ // overflow ends the game
  const w = E.createWorld(6);
  E.loadPreset(w, { fills: [[0, 0, 24, E.H + 4, E.MUD]], settle: 60 });
  run(w, 800);
  ok(w.overflow, 'liquid resting above the line overflows');
}
{ // every level preset loads cleanly: no NaN, no instant pop, pearls placed outside stones
  for (const [k, def] of LEVELS.entries()) {
    const w = E.createWorld(10 + k, levelRules(def));
    E.loadPreset(w, def.preset || {});
    E.refillTray(w);
    const ev = run(w, 240);
    let nan = false; for (let i = 0; i < w.n; i++) if (!Number.isFinite(w.x[i] + w.y[i])) nan = true;
    const pops = ev.filter(e => e.type === 'pop').length;
    if (nan || pops || w.overflow || !w.tray.every(Boolean)) ok(false, `level ${k + 1} preset: nan=${nan} pops=${pops} overflow=${w.overflow}`);
  }
  ok(true, `all ${LEVELS.length} level presets load cleanly`);
}
{ // the tray only uses the level palette
  const w = E.createWorld(9, levelRules({ goals: [{ type: 'pops', n: 1 }], palette: [2, 5] }));
  let good = true; for (let k = 0; k < 30; k++) { E.refillTray(w); if (!w.tray.every(p => p.cols.every(c => [2, 5].includes(c)) && p.cells.length === p.cols.length)) good = false; }
  ok(good, 'tray respects the palette and always has shapes');
}
{ // gel: once set, a body no longer creeps sideways into an open gap
  const w = E.createWorld(11);
  E.spawnPiece(w, SQ, 6, 1); run(w, 900); // well past gelEnd
  const b0 = bodies(w, 1)[0]; run(w, 600); const b1 = bodies(w, 1)[0];
  ok(b0 && b1 && Math.abs(b1.x1 - b0.x1) < .3 && Math.abs(b1.x0 - b0.x0) < .3, `a set body keeps its footprint (${b0?.x0.toFixed(1)}-${b0?.x1.toFixed(1)} → ${b1?.x0.toFixed(1)}-${b1?.x1.toFixed(1)})`);
}
{ // previews are exact: a cloned world evolves exactly like the original
  const w = E.createWorld(12); E.spawnPiece(w, SQ, 8, 2); E.spawnPiece(w, [[0, 0], [1, 0]], 17, 4); run(w, 200);
  const v = E.cloneWorld(w); E.startTilt(w, 1); E.startTilt(v, 1);
  run(w, 150); run(v, 150);
  let same = w.n === v.n; for (let i = 0; i < w.n && same; i++) if (w.x[i] !== v.x[i] || w.y[i] !== v.y[i]) same = false;
  ok(same, 'cloneWorld + identical input → identical future (shake preview is exact)');
}
if (fails) { console.log(`${fails} test(s) failed`); process.exit(1); }
console.log('all engine tests passed');
