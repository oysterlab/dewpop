// Look-ahead worker: runs the (deterministic) engine on a snapshot of the tank so previews never
// stall the game. Requests: { id, phys, snap, act } → { id, ... }
//   act.type 'drop'  : ghost of where the set settles + the first line it completes
//   act.type 'hints' : for each x in act.xs, which colour's line (0 = none) a drop there would complete
//   act.type 'tilt'  : where each body heads after a tilt (arrows), the first line, and a ghost of the result
import * as EP from './engine.js';
import * as EG from './engine-grid.js';

onmessage = e => {
  const { id, engine, phys, snap, act } = e.data;
  const E = engine === 'particle' ? EP : EG;
  E.tune(phys);
  const w = E.restoreWorld(snap);
  if (act.type === 'drop') {
    const r = E.predict(w, { type: 'drop', slot: act.slot, x: act.x }, 200);
    postMessage({ id, line: r?.line || null, pts: r?.pts || [] });
  } else if (act.type === 'hints') {
    const hits = [];
    for (const x of act.xs) { const r = E.predict(w, { type: 'drop', slot: act.slot, x }, 200); if (r?.line) hits.push([x, r.line.color]); }
    postMessage({ id, hits });
  } else if (act.type === 'tilt') {
    const steps = (phys.tiltMode === 'nudge' ? phys.nudgeSteps : phys.sloshSteps) + 120;
    const r = E.predict(w, { type: 'shake', dir: act.dir }, steps);
    const arrows = [];
    if (r) for (const b of act.before) {
      let best = null, bd = 1e9;
      for (const a of r.bodies || []) if (a.color === b.color) { const d = Math.hypot(a.cx - b.cx, a.cy - b.cy); if (d < bd) { bd = d; best = a; } }
      if (best && bd > .8) arrows.push({ x0: b.cx, y0: b.cy, x1: best.cx, y1: best.cy, color: b.color });
    }
    postMessage({ id, arrows, line: r?.line || null, pts: r?.pts || [] });
  }
};
