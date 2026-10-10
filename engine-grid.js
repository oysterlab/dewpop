// DEWPOP grid engine — "liquid on the outside, cells on the inside".
// The tank is a grid of small cells (0.5 units). Every liquid cell follows a few local, deterministic
// rules (like falling-sand games, tuned for a thick liquid), so players can learn what a drop will do:
//   1. fall    — if the cell below is free, fall (accelerating)
//   2. slide   — else if the diagonal below is free, slip down the slope (liquid runs into holes)
//   3. spread  — else move sideways while it still has "flow budget" (budget is refilled when it falls;
//                mud is thick and barely spreads)
//   4. squeeze — landing on liquid gives the cells underneath extra budget: pressing makes them spread
//   5. tilt    — for a moment every cell may also slide toward the tilted side (max TILT_CELLS cells)
// A same-colour region touching both side walls locks (glows), then pops; what was above falls,
// refills its budget and flows again — chains happen naturally.
// The exported API mirrors engine.js so the app, renderer, previews and recorder work unchanged.

export const W = 24, H = 30, TOP = -14;
export const TPS = 120;
export const CS = 0.5, SPACING = CS;           // cell size in world units
export const COLS = W / CS, ROWS = (H - TOP) / CS, JAR_ROW = -TOP / CS;
export const DANGER = 4.5;
export const WALL = 0.25;
export const MAXP = 5000;
export const MUD = 6;
export const TILT_STEPS = 90, TILT_MAX = 3, TILT_METER = 700;
export const DROP_N = 52;                      // cells per droplet
export const CELL = 4.25;                      // droplet spacing inside a set (units)
export const LOCK_STEPS = 72;
export const SPAN_EDGE = 0.45;
export const ENGINE = 'grid';
export const TILT_UNLIMITED = true;
export const COMBO_GRACE = 2;          // drops without a line that a combo survives (Block-Blast-style streak)     // tilting is a basic move now (no charges); one at a time
export const DENSITY = null;                   // no weight sorting in the grid engine (app hides the legend)

export const COLORS = [null,
  { name: '코랄', hex: '#FF5A6E' }, { name: '레몬', hex: '#FFC83D' }, { name: '민트', hex: '#2FD39A' },
  { name: '하늘', hex: '#3FA9FF' }, { name: '포도', hex: '#A66BFF' }, { name: '진흙', hex: '#6B5A48' },
];

export const PHYS = {
  gAcc: 0.12, vMax: 3, budget: 3, mudBudget: 1, diagFree: 0, squeeze: 3, squeezeDepth: 5, tiltCells: 8,
  cascadeBudget: 6, cascadeTicks: 180, lerp: 0.35, springK: 0.1, springD: 0.2, glide: 0.09, rescueFill: 0.8,
  // fields the app reads (kept for compatibility)
  gel: 0, gelStart: 1, gelEnd: 2, tiltMode: 'nudge', nudgeSteps: TILT_STEPS, sloshSteps: TILT_STEPS, hover: 0,
};
export function tune(p) { for (const k in p) if (k in PHYS && !['gel', 'gelStart', 'gelEnd', 'tiltMode', 'nudgeSteps', 'sloshSteps'].includes(k)) PHYS[k] = p[k]; }

export const SHAPES = [
  { c: [[0, 0]], w: 2 },
  { c: [[0, 0], [1, 0]], w: 4 }, { c: [[0, 0], [0, 1]], w: 3 },
  { c: [[0, 0], [1, 0], [2, 0]], w: 4 }, { c: [[0, 0], [0, 1], [0, 2]], w: 2 },
  { c: [[0, 0], [1, 0], [0, 1]], w: 3 }, { c: [[0, 0], [1, 0], [1, 1]], w: 3 },
  { c: [[0, 0], [1, 0], [0, 1], [1, 1]], w: 4, big: 1 },
  { c: [[0, 0], [1, 0], [2, 0], [1, 1]], w: 2, big: 1 }, { c: [[1, 0], [0, 1], [1, 1], [2, 1]], w: 2, big: 1 },
  { c: [[0, 0], [0, 1], [1, 1], [2, 1]], w: 1, big: 1 }, { c: [[2, 0], [0, 1], [1, 1], [2, 1]], w: 1, big: 1 },
  { c: [[0, 0], [1, 0], [2, 0], [3, 0]], w: 1, big: 1 },
];
export const shapeSize = c => ({ w: Math.max(...c.map(p => p[0])) + 1, h: Math.max(...c.map(p => p[1])) + 1 });
export const dropR = n => Math.sqrt(n / Math.PI) * CS;
export function pieceLayout(cells) {
  const { w: pw, h: ph } = shapeSize(cells);
  return cells.map(([cx, cy]) => [(cx - (pw - 1) / 2) * CELL, -(ph - 1 - cy) * CELL]);
}
export function clampPieceX(cells, x) {
  const half = (shapeSize(cells).w - 1) / 2 * CELL + dropR(DROP_N) + .3;
  return Math.max(half + WALL, Math.min(W - half - WALL, x));
}
// integer cell offsets of a round droplet of n cells (closest-first, deterministic)
const DISC = (() => {
  const pts = [];
  for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) pts.push([dx * dx + dy * dy + (dy > 0 ? .01 : 0) + dx * .001, dx, dy]);
  pts.sort((a, b) => a[0] - b[0]);
  return pts.map(p => [p[1], p[2]]);
})();
export function discOffsets(n) {
  const out = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) { out[k * 2] = DISC[k][0] * CS; out[k * 2 + 1] = DISC[k][1] * CS; }
  return out;
}
export const spawnBaseY = (w, cells) => -dropR(DROP_N) - .4;

// --- rng -----------------------------------------------------------------------
function worldRand(w) {
  return () => { let s = w.rs; s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; w.rs = s; return s / 4294967296; };
}
export function rng(seed) { let s = seed >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

// --- rules ---------------------------------------------------------------------
export const ENDLESS = { c3: 0, c4: 40, c5: 90, mud: [[25, 7], [60, 5], [100, 4]], big: [[0, .8], [30, 1], [70, 1.3]], mix: [[0, .25], [20, .35], [50, .45], [90, .55]] };
const stepAt = (tbl, p) => { let v = 0; for (const [from, val] of tbl) if (p >= from) v = val; return v; };
// 90-second score attack: combos buy back time
export function blitzRules() {
  const r = endlessRules();
  return { ...r, kind: 'blitz', timeLimit: 90 * TPS, colorsAt: p => p < 30 ? 3 : 4, mudEvery: p => p < 20 ? 0 : 8 };
}
export const timeLeft = w => w.rules.timeLimit ? Math.max(0, (w.rules.timeLimit + w.timeBonus - w.steps) / TPS) : Infinity;
export function endlessRules() {
  return {
    kind: 'endless', charges: 1, earn: true, moves: 0, goals: [],
    colorsAt: p => p < (ENDLESS.c3 ?? 0) ? 2 : p < ENDLESS.c4 ? 3 : p < ENDLESS.c5 ? 4 : 5,
    bigAt: p => stepAt(ENDLESS.big, p), mixAt: p => stepAt(ENDLESS.mix, p), mudEvery: p => stepAt(ENDLESS.mud, p), palette: null,
  };
}

// --- world ---------------------------------------------------------------------
const NCELL = COLS * ROWS;
const SOLID_STONE = 1, SOLID_PEARL = 2;
export function createWorld(seed = 1, rules = endlessRules()) {
  const w = {
    seed, rs: (seed >>> 0) || 1, rules, n: 0,
    grid: new Int32Array(NCELL).fill(-1), solid: new Uint8Array(NCELL), pearlAt: new Int16Array(NCELL).fill(-1),
    gx: new Int16Array(MAXP), gy: new Int16Array(MAXP), x: new Float32Array(MAXP), y: new Float32Array(MAXP),
    c: new Uint8Array(MAXP), vel: new Float32Array(MAXP), bud: new Uint8Array(MAXP), fdir: new Int8Array(MAXP),
    tmv: new Uint8Array(MAXP), stamp: new Uint32Array(MAXP), rest: new Uint16Array(MAXP),
    pid: new Uint16Array(MAXP), lock: new Uint8Array(MAXP), prog: new Float32Array(MAXP),
    load: new Float32Array(MAXP).fill(1), age: new Uint16Array(MAXP), sleep: new Uint8Array(MAXP),
    rvx: new Float32Array(MAXP), rvy: new Float32Array(MAXP), rigid: new Uint8Array(MAXP), tag: new Uint8Array(MAXP),
    stones: [], pearls: [],
    tray: [null, null, null], placed: 0, score: 0, chain: 0, bestChain: 0, pops: 0,
    popsBy: [0, 0, 0, 0, 0, 0, 0], poppedP: 0, mudStart: 0, mudCleared: 0, pearlsGot: 0,
    charges: rules.charges ?? 1, meter: 0, tilt: null, tilts: 0,
    steps: 0, quiet: 0, moved: 0, meanSpeed: 0, maxSpeed: 0, overT: 0, overflow: false, noPop: false,
    pending: [], sinceMud: 0, lastPid: 0, merged: true, locks: [], lockSeq: 0, passivePops: 0, tiltPop: 0,
    bodies: [], spanSeen: new Map(), rigidGroups: [], cascade: 0, combo: 0, comboMiss: 0, bestCombo: 0, dropScored: false, timeBonus: 0, timeUp: false,
  };
  w.rand = worldRand(w);
  return w;
}
const idx = (c, r) => r * COLS + c;
const free = (w, c, r) => c >= 0 && c < COLS && r >= 0 && r < ROWS && w.grid[r * COLS + c] < 0 && !w.solid[r * COLS + c];
const cx2x = c => (c + .5) * CS, r2y = r => TOP + (r + .5) * CS;
const x2c = x => Math.max(0, Math.min(COLS - 1, Math.floor(x / CS))), y2r = y => Math.max(0, Math.min(ROWS - 1, Math.floor((y - TOP) / CS)));

function addCell(w, c, r, col, vel = 1) {
  if (w.n >= MAXP || !free(w, c, r)) return -1;
  const i = w.n++;
  w.gx[i] = c; w.gy[i] = r; w.x[i] = cx2x(c); w.y[i] = r2y(r); w.c[i] = col; w.vel[i] = vel;
  w.bud[i] = col === MUD ? PHYS.mudBudget : PHYS.budget; w.fdir[i] = (c + r) & 1 ? 1 : -1; w.tmv[i] = 0; w.stamp[i] = 0; w.rest[i] = 0;
  w.pid[i] = w.lastPid; w.lock[i] = 0; w.prog[i] = 0; w.load[i] = 1; w.age[i] = 0; w.sleep[i] = 0; w.rvx[i] = 0; w.rvy[i] = 0; w.rigid[i] = 0; w.tag[i] = ((c * 73856093) ^ (r * 19349663) ^ (w.lastPid * 83492791)) & 255;
  w.grid[idx(c, r)] = i;
  return i;
}
function moveCell(w, i, c, r) {
  w.grid[idx(w.gx[i], w.gy[i])] = -1; w.gx[i] = c; w.gy[i] = r; w.grid[idx(c, r)] = i;
}
function removeMarked(w, mark) {
  let j = 0;
  for (let i = 0; i < w.n; i++) {
    if (mark[i]) { w.grid[idx(w.gx[i], w.gy[i])] = -1; continue; }
    if (i !== j) {
      for (const k of ['gx', 'gy', 'x', 'y', 'c', 'vel', 'bud', 'fdir', 'tmv', 'stamp', 'rest', 'pid', 'lock', 'prog', 'load', 'age', 'sleep', 'rvx', 'rvy', 'rigid', 'tag']) w[k][j] = w[k][i];
      w.grid[idx(w.gx[j], w.gy[j])] = j;
    }
    j++;
  }
  w.n = j;
}

// --- pieces ----------------------------------------------------------------------
export function spawnPiece(w, cells, x, col) {
  x = clampPieceX(cells, x);
  w.lastPid = (w.lastPid % 65000) + 1; w.merged = false;
  const base = spawnBaseY(w, cells), drops = [];
  pieceLayout(cells).forEach(([dx, dy], k) => {
    drops.push({ x: cx2x(x2c(x + dx)), y: r2y(y2r(base + dy)), c: Array.isArray(col) ? col[k] : col });
    const cc = x2c(x + dx), rr = y2r(base + dy), colour = Array.isArray(col) ? col[k] : col;
    for (let q = 0; q < DROP_N; q++) { const i = addCell(w, cc + DISC[q][0], rr + DISC[q][1], colour, 1); if (i >= 0) w.rigid[i] = 1; }
  });
  w.rigidGroups.push({ pid: w.lastPid, vel: 1, drops, dy: 0 });
  return x;
}
export function makePiece(cells, a, b = a, axis = 'y') {
  const { w: pw, h: ph } = shapeSize(cells);
  const cols = cells.map(([x, y]) => (axis === 'y' ? (ph > 1 ? y < ph / 2 : x < pw / 2) : (pw > 1 ? x < pw / 2 : y < ph / 2)) ? a : b);
  return { cells, cols };
}
export function paletteOf(w) { if (w.rules.palette) return w.rules.palette; return [1, 2, 3, 4, 5].slice(0, w.rules.colorsAt(w.placed)); }
export function surfaceColors(w) {
  const top = new Map();
  for (let c = 0; c < COLS; c += 2) for (let r = JAR_ROW; r < ROWS; r++) { const i = w.grid[idx(c, r)]; if (i >= 0) { if (w.c[i] !== MUD) top.set(w.c[i], (top.get(w.c[i]) || 0) + 1); break; } }
  return [...top.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
}
function pickShape(w) {
  const big = w.rules.bigAt(w.placed), wt = sh => sh.w * (sh.big ? big : 1);
  let r = w.rand() * SHAPES.reduce((a, sh) => a + wt(sh), 0);
  for (const sh of SHAPES) if ((r -= wt(sh)) < 0) return sh.c;
  return SHAPES[0].c;
}
const RESCUE_SHAPES = [[[0, 0]], [[0, 0], [1, 0]], [[0, 0], [0, 1]]];
export const MUD_SHAPES = [[[0, 0], [1, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0], [2, 0]], [[0, 0], [1, 0], [0, 1]]];
export function mudPiece(w) { const cells = MUD_SHAPES[(w.rand() * MUD_SHAPES.length) | 0]; return { cells, cols: cells.map(() => MUD), mud: true }; }
export function randomPiece(w) {
  const pal = paletteOf(w), surf = surfaceColors(w).filter(c => pal.includes(c));
  if (w.n && fillLevel(w) > PHYS.rescueFill) {
    const cells = RESCUE_SHAPES[(w.rand() * RESCUE_SHAPES.length) | 0];
    const c = surf.length ? surf[(w.rand() * Math.min(2, surf.length)) | 0] : pal[(w.rand() * pal.length) | 0];
    return makePiece(cells, c, c);
  }
  const mix = w.rules.mixAt ? w.rules.mixAt(w.placed) : 0;
  const pick = () => (surf.length && w.rand() < .45) ? surf[(w.rand() * Math.min(2, surf.length)) | 0] : pal[(w.rand() * pal.length) | 0];
  const cells = pickShape(w), a = pick();
  let b = a;
  if (cells.length > 1 && pal.length > 1 && w.rand() < mix) { do b = pal[(w.rand() * pal.length) | 0]; while (b === a); }
  return makePiece(cells, a, b, w.rand() < .5 ? 'y' : 'x');
}
export function refillTray(w) { for (let k = 0; k < 3; k++) w.tray[k] = randomPiece(w); }

export function drop(w, slot, x) {
  const p = w.tray[slot]; if (!p || w.overflow) return null;
  if (w.rules.moves && w.placed >= w.rules.moves) return null;
  for (let i = slot; i > 0; i--) w.tray[i] = w.tray[i - 1];
  w.tray[0] = null;
  const px = spawnPiece(w, p.cells, x, p.cols);
  // combo streak: the previous drop either scored a line (kept/raised the combo) or used up grace
  if (w.placed > 0 && !w.dropScored) { w.comboMiss++; if (w.comboMiss > COMBO_GRACE) { w.combo = 0; w.comboMiss = 0; } }
  w.dropScored = false;
  w.placed++; w.chain = 0; w.quiet = 0;
  const me = w.rules.mudEvery(w.placed);
  let mudNow = false;
  if (me) { w.sinceMud++; if (w.sinceMud >= me) { w.sinceMud = 0; mudNow = true; } }
  w.tray[0] = mudNow ? mudPiece(w) : randomPiece(w);
  return { x: px, cells: p.cells, cols: p.cols };
}
export const nextMudIn = w => { const me = w.rules.mudEvery(w.placed); return me ? me - w.sinceMud : 0; };
export const movesLeft = w => w.rules.moves ? Math.max(0, w.rules.moves - w.placed) : Infinity;
export function startTilt(w, dir) {
  if (w.tilt || w.rules.noTilt || (!TILT_UNLIMITED && w.charges <= 0)) return false;
  if (!TILT_UNLIMITED) w.charges--;
  w.tilts++; w.tilt = { dir, t: TILT_STEPS, T: TILT_STEPS }; w.chain = 0; w.quiet = 0;
  w.tmv.fill(0, 0, w.n);
  return true;
}
export function gravity() { return [0, 1]; }

// --- the cellular step -------------------------------------------------------------
// cohesion: a sideways/diagonal move may not end inside another colour (no other-colour neighbour
// without a same-colour one) — colours stay in clean layers instead of dithering into each other
function cohesive(w, i, c, r, dir = 0) {
  const col = w.c[i]; let same = 0, other = 0;
  if (dir) { // don't wedge into a gap whose far side is another colour
    const cc = c + dir; if (cc >= 0 && cc < COLS) { const j = w.grid[r * COLS + cc]; if (j >= 0 && w.c[j] !== col) return false; }
  }
  for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const cc = c + dc, rr = r + dr; if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS) continue;
    const j = w.grid[rr * COLS + cc]; if (j < 0 || j === i) continue;
    if (w.c[j] === col) same++; else other++;
  }
  return same > 0 || other === 0;
}
// a freshly dropped set falls as one round body until any of its cells is about to touch something
function rigidFall(w) {
  if (!w.rigidGroups.length) return 0;
  const byPid = new Map(w.rigidGroups.map(g => [g.pid, []]));
  for (let i = 0; i < w.n; i++) if (w.rigid[i]) { const a = byPid.get(w.pid[i]); if (a) a.push(i); else w.rigid[i] = 0; }
  let movedCells = 0;
  for (const g of w.rigidGroups) {
    const cells = byPid.get(g.pid);
    if (!cells.length) { g.done = true; continue; }
    g.vel = Math.min(PHYS.vMax, g.vel + PHYS.gAcc);
    let steps = Math.max(1, Math.floor(g.vel)), fell = 0;
    while (steps-- > 0) {
      let ok = true;
      for (const i of cells) { const c = w.gx[i], r = w.gy[i] + 1; if (r >= ROWS || w.solid[r * COLS + c]) { ok = false; break; } const j = w.grid[r * COLS + c]; if (j >= 0 && !(w.rigid[j] && w.pid[j] === g.pid)) { ok = false; break; } }
      if (!ok) break;
      cells.sort((a, b) => w.gy[b] - w.gy[a]);
      for (const i of cells) moveCell(w, i, w.gx[i], w.gy[i] + 1);
      fell++; g.dy += CS;
    }
    if (fell) movedCells += cells.length;
    else { // touched down: it becomes liquid, keeping its speed for the splash
      for (const i of cells) { w.rigid[i] = 0; w.vel[i] = 0; w.bud[i] = w.c[i] === MUD ? PHYS.mudBudget : PHYS.budget; } // settle softly, no spike
      g.done = true;
    }
  }
  w.rigidGroups = w.rigidGroups.filter(g => !g.done);
  return movedCells;
}
// sideways moves must keep touching its own colour (8-neighbourhood, not counting where it came from):
// no lone cells running off into thin films or crumbs
function staysTogether(w, i, c, r) {
  const col = w.c[i], oc = w.gx[i], or = w.gy[i];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dc && !dr) continue;
    const cc = c + dc, rr = r + dr; if (cc < 0 || cc >= COLS || rr < 0 || rr >= ROWS || (cc === oc && rr === or)) continue;
    const j = w.grid[rr * COLS + cc]; if (j >= 0 && j !== i && w.c[j] === col) return true;
  }
  return false;
}
function caStep(w) {
  const P = PHYS, stamp = w.steps + 1, par = w.steps & 1;
  const rig = rigidFall(w) || 0;
  const tiltDir = w.tilt ? w.tilt.dir : 0;
  let moved = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    for (let k = 0; k < COLS; k++) {
      const c = par ? k : COLS - 1 - k;
      const i = w.grid[r * COLS + c];
      if (i < 0 || w.stamp[i] === stamp || w.lock[i] || w.rigid[i]) continue;
      w.stamp[i] = stamp;
      // 1. fall
      if (free(w, c, r + 1)) {
        w.vel[i] = Math.min(P.vMax, w.vel[i] + P.gAcc);
        let rr = r, n = Math.max(1, Math.floor(w.vel[i]));
        while (n-- > 0 && free(w, c, rr + 1)) rr++;
        moveCell(w, i, c, rr);
        // only a real fall (speed built up over several rows) refills the flow budget — tumbling down a slope doesn't
        if (w.vel[i] > .8) w.bud[i] = Math.max(w.bud[i], w.c[i] === MUD ? P.mudBudget : w.cascade > 0 ? P.cascadeBudget : P.budget);
        moved++; w.rest[i] = 0;
        continue;
      }
      // landing: squeeze the liquid underneath (pressing makes it spread)
      if (w.vel[i] > .5) {
        for (let d = 1; d <= P.squeezeDepth; d++) {
          const j = w.grid[idx(c, Math.min(ROWS - 1, r + d))]; if (j < 0 || r + d >= ROWS) break;
          if (w.c[j] !== MUD) w.bud[j] = Math.min(255, w.bud[j] + P.squeeze);
        }
      }
      w.vel[i] = 0;
      // 5. tilt: slide toward the leaning side
      if (tiltDir && w.tmv[i] < P.tiltCells && free(w, c + tiltDir, r) && cohesive(w, i, c + tiltDir, r, tiltDir)) { moveCell(w, i, c + tiltDir, r); w.tmv[i]++; moved++; w.rest[i] = 0; continue; }
      // 2. slide down a slope
      // slipping down a slope costs budget too (a set jelly blob keeps its dome; fresh/pressed liquid flows)
      const d1 = tiltDir || w.fdir[i];
      const cliff = dd => free(w, c + dd, r + 1) && free(w, c + dd, r + 2);
      const slip = tiltDir || w.bud[i] > 0 || P.diagFree || cliff(d1) || cliff(-d1);
      if (slip && free(w, c + d1, r + 1) && free(w, c + d1, r) && cohesive(w, i, c + d1, r + 1, d1)) { moveCell(w, i, c + d1, r + 1); if (!tiltDir && w.bud[i]) w.bud[i]--; moved++; w.rest[i] = 0; continue; }
      if (slip && !tiltDir && free(w, c - d1, r + 1) && free(w, c - d1, r) && cohesive(w, i, c - d1, r + 1, -d1)) { w.fdir[i] = -d1; moveCell(w, i, c - d1, r + 1); if (w.bud[i]) w.bud[i]--; moved++; w.rest[i] = 0; continue; }
      // 3. spread sideways while budget lasts
      if (w.bud[i] > 0) {
        const fd = w.fdir[i];
        if (free(w, c + fd, r) && cohesive(w, i, c + fd, r, fd) && staysTogether(w, i, c + fd, r)) { moveCell(w, i, c + fd, r); w.bud[i]--; moved++; w.rest[i] = 0; continue; }
        if (free(w, c - fd, r) && cohesive(w, i, c - fd, r, -fd) && staysTogether(w, i, c - fd, r)) { w.fdir[i] = -fd; moveCell(w, i, c - fd, r); w.bud[i]--; moved++; w.rest[i] = 0; continue; }
      }
      if (w.rest[i] < 60000) w.rest[i]++;
    }
  }
  // stray cells enclosed by another colour bubble up through it (immiscible: no speckles inside layers)
  for (let i = 0; i < w.n; i++) {
    if (w.lock[i] || w.rest[i] < 2) continue;
    const c = w.gx[i], r = w.gy[i], col = w.c[i];
    if (r <= 0) continue;
    let same = 0, other = 0;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const cc = c + dc, rr = r + dr; if (cc < 0 || cc >= COLS || rr >= ROWS) { other++; continue; }
      const j = w.grid[rr * COLS + cc]; if (j < 0) continue; if (w.c[j] === col) same++; else other++;
    }
    if (same || other < 3) continue;
    const a = w.grid[(r - 1) * COLS + c];
    if (a >= 0 && w.c[a] !== col && !w.lock[a]) { // swap with the cell above
      w.gy[a] = r; w.grid[r * COLS + c] = a; w.gy[i] = r - 1; w.grid[(r - 1) * COLS + c] = i;
      w.rest[i] = 0; w.rest[a] = 0; moved++;
    }
  }
  // render positions glide toward their cells (the grid stays exact; motion looks fluid)
  // render positions follow their cells on a soft spring: continuous motion and a little wobble on landing
  const K = P.springK, D = P.springD;
  for (let i = 0; i < w.n; i++) {
    if (w.rigid[i]) { w.x[i] = cx2x(w.gx[i]); w.y[i] = r2y(w.gy[i]); w.rvx[i] = 0; w.rvy[i] = 0; continue; }
    const tx = cx2x(w.gx[i]), ty = r2y(w.gy[i]);
    w.rvx[i] = w.rvx[i] * (1 - D) + (tx - w.x[i]) * K; w.rvy[i] = w.rvy[i] * (1 - D) + (ty - w.y[i]) * K * 1.6;
    // render-only glide cap: liquid visibly flows across instead of teleporting cell to cell
    if (w.rvx[i] > P.glide) w.rvx[i] = P.glide; else if (w.rvx[i] < -P.glide) w.rvx[i] = -P.glide;
    w.x[i] += w.rvx[i]; w.y[i] += w.rvy[i];
    if (Math.abs(tx - w.x[i]) > 4) w.x[i] = tx - Math.sign(tx - w.x[i]) * 4;
    if (Math.abs(ty - w.y[i]) > 2.5) w.y[i] = ty - Math.sign(ty - w.y[i]) * 2.5; // never lag far behind a fast fall
  }
  moved += rig; w.moved = moved; w.meanSpeed = w.n ? moved / w.n * .05 : 0; w.maxSpeed = moved ? .1 : 0;
}

// --- regions, lines, locks -----------------------------------------------------------
function regions(w) {
  const { n } = w, comp = w._comp || (w._comp = new Int32Array(MAXP)), stack = w._stk || (w._stk = new Int32Array(MAXP));
  comp.fill(-1, 0, n);
  const out = [];
  for (let s = 0; s < n; s++) {
    if (comp[s] >= 0 || w.c[s] === MUD || w.gy[s] < JAR_ROW) continue;
    const col = w.c[s], id = out.length, R = { id, color: col, cells: [], mn: COLS, mx: -1, top: ROWS, sx: 0, sy: 0, lock: 0, pids: new Set() };
    let sp = 0; stack[sp++] = s; comp[s] = id;
    while (sp) {
      const i = stack[--sp], c = w.gx[i], r = w.gy[i];
      R.cells.push(i); if (c < R.mn) R.mn = c; if (c > R.mx) R.mx = c; if (r < R.top) R.top = r; R.sx += w.x[i]; R.sy += w.y[i];
      if (w.lock[i]) R.lock = w.lock[i]; R.pids.add(w.pid[i]);
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const cc = c + dc, rr = r + dr; if (cc < 0 || cc >= COLS || rr < JAR_ROW || rr >= ROWS) continue;
        const j = w.grid[rr * COLS + cc]; if (j >= 0 && comp[j] < 0 && w.c[j] === col) { comp[j] = id; stack[sp++] = j; }
      }
    }
    out.push(R);
  }
  return out;
}
function checkLines(w) {
  let regs = regions(w);
  const ev = [];
  // crumbs (tiny separated bits) that came to rest evaporate — no specks or stray dots
  const crumbs = regs.filter(R => R.cells.length < 9 && !R.lock && R.cells.every(i => w.rest[i] > 20 && !w.rigid[i]));
  if (crumbs.length) {
    const mark = w._mark || (w._mark = new Uint8Array(MAXP)); mark.fill(0, 0, w.n);
    const pts = [];
    for (const R of crumbs) for (const i of R.cells) { mark[i] = 1; pts.push(w.x[i], w.y[i], w.c[i]); }
    removeMarked(w, mark);
    ev.push({ type: 'fizz', pts: new Float32Array(pts) });
    regs = regions(w);
  }
  for (const R of regs) { const span = (R.mx - R.mn + 1) / COLS; for (const i of R.cells) w.prog[i] = w.lock[i] ? 1 : span; }
  w.bodies = regs.filter(R => R.cells.length >= DROP_N * .6).map(R => ({ color: R.color, drops: Math.round(R.cells.length / DROP_N), cx: R.sx / R.cells.length, cy: R.sy / R.cells.length,
    top: r2y(R.top), x0: cx2x(R.mn), x1: cx2x(R.mx), span: (R.mx - R.mn + 1) / COLS }));
  // merge feedback: the newest set joined an older body of its colour
  if (!w.merged && w.lastPid) for (const R of regs) if (R.pids.has(w.lastPid) && R.pids.size > 1 && R.cells.length >= DROP_N) {
    w.merged = true;
    let sx = 0, top = 1e9, k = 0; for (const i of R.cells) if (w.pid[i] === w.lastPid) { sx += w.x[i]; k++; top = Math.min(top, w.y[i]); }
    ev.push({ type: 'merge', color: R.color, x: sx / k, y: top, drops: Math.round(R.cells.length / DROP_N), span: (R.mx - R.mn + 1) / COLS, points: 20 * Math.round(R.cells.length / DROP_N) });
    w.score += 20 * Math.round(R.cells.length / DROP_N);
    break;
  }
  if (w.noPop) return { ev, due: [] };
  const due = new Set(w.locks.filter(l => l.t <= 0).map(l => l.slot)), popRegs = [];
  for (const R of regs) {
    if (R.lock) { if (due.has(R.lock)) popRegs.push(R); continue; }
    if (R.mn === 0 && R.mx === COLS - 1) {
      const slot = (w.lockSeq = (w.lockSeq || 0) % 250 + 1);
      let jx = 0, jy = 0, jk = 0;
      for (const i of R.cells) { w.lock[i] = slot; if (w.pid[i] === w.lastPid) { jx += w.x[i]; jy += w.y[i]; jk++; } }
      w.locks.push({ slot, t: LOCK_STEPS, color: R.color });
      ev.push({ type: 'lock', slot, color: R.color, y: R.sy / R.cells.length, x: jk ? jx / jk : W / 2, jy: jk ? jy / jk : R.sy / R.cells.length, steps: LOCK_STEPS, drops: Math.round(R.cells.length / DROP_N) });
    }
  }
  w.locks = w.locks.filter(l => !due.has(l.slot));
  return { ev, due: popRegs };
}
function pop(w, regs) {
  const mark = w._mark || (w._mark = new Uint8Array(MAXP)); mark.fill(0, 0, w.n);
  const out = { type: 'pop', groups: [], mud: 0, pearls: [], chain: 0, points: 0, gained: false };
  let total = 0, mine = false;
  const popped = new Uint8Array(NCELL);
  for (const R of regs) {
    let minY = 1e9, maxY = -1e9;
    const pts = new Float32Array(R.cells.length * 2);
    R.cells.forEach((i, k) => { mark[i] = 1; popped[idx(w.gx[i], w.gy[i])] = 1; pts[k * 2] = w.x[i]; pts[k * 2 + 1] = w.y[i]; minY = Math.min(minY, w.y[i]); maxY = Math.max(maxY, w.y[i]); if (w.pid[i] === w.lastPid) mine = true; });
    out.groups.push({ color: R.color, n: R.cells.length, cx: R.sx / R.cells.length, cy: R.sy / R.cells.length, minY, maxY, pts });
    w.popsBy[R.color]++; total += R.cells.length;
  }
  // mud within 2 cells of the popped line washes away; pearls within 2 cells are collected
  const near = (c, r, d) => { for (let dr = -d; dr <= d; dr++) for (let dc = -d; dc <= d; dc++) { const cc = c + dc, rr = r + dr; if (cc >= 0 && cc < COLS && rr >= 0 && rr < ROWS && popped[idx(cc, rr)]) return true; } return false; };
  const mudPts = [];
  for (let i = 0; i < w.n; i++) if (w.c[i] === MUD && !mark[i] && near(w.gx[i], w.gy[i], 2)) { mark[i] = 1; out.mud++; mudPts.push(w.x[i], w.y[i]); }
  out.mudPts = new Float32Array(mudPts);
  for (const p of w.pearls) if (p.alive && near(x2c(p.x), y2r(p.y), Math.ceil(p.r / CS) + 2)) {
    p.alive = false; out.pearls.push(p); w.pearlsGot++;
    for (let k = 0; k < NCELL; k++) if (w.pearlAt[k] === p.id) { w.solid[k] = 0; w.pearlAt[k] = -1; }
  }
  w.mudCleared += out.mud;
  w.chain++; w.bestChain = Math.max(w.bestChain, w.chain); out.chain = w.chain;
  if (!w.dropScored) { w.dropScored = true; w.combo++; w.comboMiss = 0; w.bestCombo = Math.max(w.bestCombo, w.combo); }
  out.combo = w.combo;
  if (w.rules.timeLimit && w.combo >= 2 && w.chain === 1) { out.timeBonus = (w.combo - 1) * 1; w.timeBonus += out.timeBonus * TPS; }
  out.passive = w.chain === 1 && !mine && !(w.tiltPop > 0);
  if (out.passive) w.passivePops++;
  let pts = 0; for (const g of out.groups) { const d = g.n / DROP_N; pts += Math.round(d * d * 12); }
  out.points = (pts * 10 + out.mud * 4 + out.pearls.length * 500) * w.chain * Math.max(1, w.combo);
  w.score += out.points; w.pops += regs.length; w.poppedP += total;
  if (w.rules.earn && !TILT_UNLIMITED) {
    w.meter += total + out.mud;
    while (w.meter >= TILT_METER && w.charges < TILT_MAX) { w.meter -= TILT_METER; w.charges++; out.gained = true; }
    if (w.charges >= TILT_MAX) w.meter = Math.min(w.meter, TILT_METER);
  }
  removeMarked(w, mark);
  // everything above starts falling again with a big fresh budget for a moment → it pours into the gap,
  // spreads wide and often completes the next line (chains)
  for (let i = 0; i < w.n; i++) w.rest[i] = 0;
  w.cascade = PHYS.cascadeTicks;
  return out;
}

export function tick(w) {
  const ev = [];
  caStep(w); w.steps++;
  if (w.cascade > 0) w.cascade--;
  if (w.tilt && --w.tilt.t <= 0) { w.tilt = null; w.tiltPop = 120; }
  if (w.tilt) w.tiltPop = 120; else if (w.tiltPop > 0) w.tiltPop--;
  for (const l of w.locks) l.t--;
  if (w.steps % 3 === 0) {
    const { ev: e2, due } = checkLines(w);
    ev.push(...e2);
    if (due.length) ev.push(pop(w, due));
  }
  w.quiet = w.moved === 0 ? w.quiet + 1 : 0;
  // overflow: settled liquid above the danger line
  const dRow = y2r(DANGER);
  let high = 0;
  for (let i = 0; i < w.n; i++) if (w.gy[i] < dRow && w.gy[i] >= JAR_ROW && w.rest[i] > 30) high++;
  w.high = high;
  w.overT = high > 6 ? w.overT + 1 : Math.max(0, w.overT - 2);
  if (w.overT > TPS * 1.6) w.overflow = true;
  if (w.rules.timeLimit && w.steps >= w.rules.timeLimit + w.timeBonus) w.timeUp = true;
  return ev;
}
export const settled = w => w.quiet >= 10 && !w.tilt && !w.locks.length && !w.rigidGroups.length;

export function fillLevel(w) {
  let top = ROWS;
  for (let i = 0; i < w.n; i++) if (w.gy[i] >= JAR_ROW && w.rest[i] > 5 && w.gy[i] < top) top = w.gy[i];
  return (ROWS - top) / ((H - DANGER) / CS);
}

// --- goals ------------------------------------------------------------------------------
export function goalProgress(w, g) {
  switch (g.type) {
    case 'pops': return [w.pops, g.n];
    case 'color': return [w.popsBy[g.color], g.n];
    case 'mud': return [w.mudStart ? Math.min(100, Math.round(w.mudCleared / w.mudStart * 100)) : 100, g.pct];
    case 'pearls': return [w.pearlsGot, g.n];
    case 'score': return [w.score, g.n];
    case 'survive': return [w.placed, g.n];
  }
  return [0, 1];
}
export const goalsMet = w => w.rules.goals.length > 0 && w.rules.goals.every(g => { const [a, b] = goalProgress(w, g); return a >= b; });

// --- presets ---------------------------------------------------------------------------
function segDist(s, x, y) {
  const ex = s.bx - s.ax, ey = s.by - s.ay, l2 = ex * ex + ey * ey;
  let t = l2 ? ((x - s.ax) * ex + (y - s.ay) * ey) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(x - (s.ax + ex * t), y - (s.ay + ey * t));
}
export function fillBox(w, x0, y0, x1, y1, c) { // pre-placed liquid keeps the designed shape (no flow budget)
  for (let r = y2r(y0); r <= y2r(y1 - .01); r++) for (let cc = x2c(x0); cc <= x2c(x1 - .01); cc++) { const i = addCell(w, cc, r, c, 0); if (i >= 0) w.bud[i] = 0; }
}
export function blob(w, cx, cy, n, c) { const c0 = x2c(cx), r0 = y2r(cy); for (let q = 0; q < n; q++) addCell(w, c0 + DISC[q][0], r0 + DISC[q][1], c, 1); }
export function loadPreset(w, pre = {}) {
  for (const s of pre.stones || []) {
    const st = { ax: s[0], ay: H - s[1], bx: s[2], by: H - s[3], r: s[4], kind: s[5] ?? 0 };
    w.stones.push(st);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (segDist(st, cx2x(c), r2y(r)) < st.r) w.solid[idx(c, r)] = SOLID_STONE;
  }
  (pre.pearls || []).forEach((p, k) => {
    const pe = { id: k, x: p[0], y: H - p[1], r: 0.9, alive: true }; w.pearls.push(pe);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (Math.hypot(cx2x(c) - pe.x, r2y(r) - pe.y) < pe.r) { w.solid[idx(c, r)] = SOLID_PEARL; w.pearlAt[idx(c, r)] = k; }
  });
  for (const f of pre.fills || []) fillBox(w, f[0], H - f[3], f[2], H - f[1], f[4]);
  w.noPop = true;
  for (let k = 0; k < (pre.settle ?? 200); k++) { caStep(w); w.steps++; }
  w.noPop = false; w.steps = 0; w.quiet = 0;
  w.mudStart = 0; for (let i = 0; i < w.n; i++) if (w.c[i] === MUD) w.mudStart++;
  checkLines(w);
}
export function seededWorld(seed, rules) { const w = createWorld(seed, rules || endlessRules()); refillTray(w); return w; }

// --- snapshots & look-ahead ------------------------------------------------------------
const ARR = ['gx', 'gy', 'x', 'y', 'c', 'vel', 'bud', 'fdir', 'tmv', 'stamp', 'rest', 'pid', 'lock', 'prog', 'load', 'age', 'sleep', 'rvx', 'rvy', 'rigid', 'tag'];
export function snapshotWorld(w) {
  const n = w.n, snap = { engine: ENGINE, n, seed: w.seed, grid: w.grid.slice(), solid: w.solid.slice(), pearlAt: w.pearlAt.slice() };
  for (const k of ARR) snap[k] = w[k].slice(0, n);
  for (const k of ['cascade', 'combo', 'comboMiss', 'bestCombo', 'dropScored', 'timeBonus', 'timeUp', 'rs', 'steps', 'lastPid', 'chain', 'lockSeq', 'quiet', 'moved', 'overT', 'tiltPop', 'meanSpeed', 'noPop', 'placed', 'sinceMud', 'score', 'pops', 'charges', 'mudStart', 'mudCleared', 'pearlsGot', 'passivePops'])
    snap[k] = w[k];
  snap.rigidGroups = w.rigidGroups.map(g => ({ ...g }));
  snap.tilt = w.tilt && { ...w.tilt }; snap.stones = w.stones.map(s => ({ ...s })); snap.pearls = w.pearls.map(p => ({ ...p }));
  snap.locks = w.locks.map(l => ({ ...l })); snap.tray = w.tray.map(t => t && { cells: t.cells, cols: t.cols.slice(), mud: t.mud });
  return snap;
}
export function restoreWorld(snap, rules = endlessRules()) {
  const v = createWorld(snap.seed, rules);
  v.grid.set(snap.grid); v.solid.set(snap.solid); v.pearlAt.set(snap.pearlAt);
  for (const k of ARR) v[k].set(snap[k]);
  for (const k of ['n', 'cascade', 'combo', 'comboMiss', 'bestCombo', 'dropScored', 'timeBonus', 'timeUp', 'rs', 'steps', 'lastPid', 'chain', 'lockSeq', 'quiet', 'moved', 'overT', 'tiltPop', 'meanSpeed', 'noPop', 'placed', 'sinceMud', 'score', 'pops', 'charges', 'mudStart', 'mudCleared', 'pearlsGot', 'passivePops', 'stones', 'pearls', 'locks', 'tray'])
    v[k] = snap[k];
  v.rigidGroups = (snap.rigidGroups || []).map(g => ({ ...g }));
  v.tilt = snap.tilt && { ...snap.tilt }; v.merged = true; v.rand = worldRand(v);
  return v;
}
export function cloneWorld(w) { const v = restoreWorld(snapshotWorld(w), w.rules); v.charges = 9; return v; }
// first line only; the ghost is the settled shape (chains stay a surprise)
export function predict(w, act, maxSteps = 400) {
  const v = cloneWorld(w);
  v.rules = { ...w.rules, mudEvery: () => 0 }; v.pending = [];
  if (act.type === 'drop') { if (!drop(v, act.slot, act.x)) return null; }
  else { v.charges = 9; if (!startTilt(v, act.dir)) return null; }
  const pid = v.lastPid;
  v.noPop = true;
  let k = 0;
  for (; k < maxSteps; k++) { tick(v); if (k > 20 && v.quiet > 6 && !v.tilt) break; }
  const pts = [];
  for (let i = 0; i < v.n; i++) if (act.type === 'drop' ? v.pid[i] === pid : v.c[i] !== MUD) pts.push(cx2x(v.gx[i]), r2y(v.gy[i]), v.c[i]);
  v.noPop = false;
  const { ev } = checkLines(v);
  const lk = ev.find(e => e.type === 'lock');
  return { line: lk ? { color: lk.color, y: lk.y } : null, pts, bodies: v.bodies, steps: k };
}
