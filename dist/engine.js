// DEWPOP engine — pure logic, no DOM. 2D particle liquid (double-density relaxation,
// Clavet et al. 2005) with per-colour cohesion so different colours stay immiscible
// and bead up like droplets. A same-colour body that touches both side walls pops.
//
// Units: interaction radius = 1. Tank interior x∈[0,W], y∈[0,H] (y grows downward),
// with a spawn zone above it (y down to TOP). One step = 1/TPS s.

export const W = 24, H = 30, TOP = -9;
export const TPS = 120;
export const SPACING = 0.5;          // rest particle spacing
export const DANGER = 4.5;            // resting liquid above this line overflows
export const WALL = 0.25;            // particle radius against walls
export const MAXP = 7000;
export const MUD = 6;
export const TILT_STEPS = 150, TILT_MAX = 3, TILT_METER = 700;
export const DROP_N = 40;            // particles in one round droplet (one cell of a piece)
export const CELL = 3.5;             // spacing between droplets inside a piece
export const LOCK_STEPS = 72;         // a connected line glows this long before it pops (so you see it join)
export const SPAN_EDGE = 0.45;        // how close to a side wall counts as touching it
// Our own droplet-set shapes (cells of a piece; each cell is one round droplet).
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

export const COLORS = [null,
  { name: '코랄', hex: '#FF5A6E' },
  { name: '레몬', hex: '#FFC83D' },
  { name: '민트', hex: '#2FD39A' },
  { name: '하늘', hex: '#3FA9FF' },
  { name: '포도', hex: '#A66BFF' },
  { name: '진흙', hex: '#6B5A48' },
];

export const PHYS = {
  grav: 0.0045, k: 0.05, kNear: 0.16, sigma: 0.2, beta: 0.3, repel: 0.1,
  maxV: 0.22, damp: 0.9985, rest: 0.6, restV: 0.004, cohMode: 1, nbRef: 12, iters: 2, inNb: 14, inDamp: 1, restIn: 0.012, cohV: 0.28, xsph: 0.06, sleepV: 0.012, wallAdh: 0.02, load0: 8, loadFree: 8, sloshAmp: 0.85, sloshWaves: 0.5, sloshCoh: 0.15, stratify: 6, stratBase: 0, sloshSteps: 170, sloshSide: 0.6, gel: 1, gelStart: 360, gelEnd: 720, gelYield: 0.05, neckMin: 2, holdChecks: 5, hover: 0, rescueFill: 0.8, meltR: 2.5, tiltMode: 'nudge', nudgeAmp: 0.36, nudgeSteps: 240, wakeV: 0.03, sleepAfter: 45,
};
export function tune(p) { Object.assign(PHYS, p); }
let REST2 = 0, RESTIN2 = 0;

// rest density of a hex lattice at SPACING
export const RHO0 = (() => {
  let r = 0;
  for (let a = -4; a <= 4; a++) for (let b = -4; b <= 4; b++) {
    if (!a && !b) continue;
    const x = (a + b * .5) * SPACING, y = b * SPACING * Math.sqrt(3) / 2, d = Math.hypot(x, y);
    if (d < 1) { const q = 1 - d; r += q * q; }
  }
  return r;
})();

// --- rng -----------------------------------------------------------------------
function worldRand(w) {
  return () => { let s = w.rs; s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; w.rs = s; return s / 4294967296; };
}
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// --- spatial grid --------------------------------------------------------------
const TJ = new Int32Array(64), TX = new Float32Array(64), TY = new Float32Array(64), TS = new Float32Array(64);
const GX = W + 2, GY = H - TOP + 3, NCELL = GX * GY, NB = 48;
const cellOf = (x, y) => {
  let cx = (x + 1) | 0, cy = (y - TOP + 1) | 0;
  if (cx < 0) cx = 0; else if (cx >= GX) cx = GX - 1;
  if (cy < 0) cy = 0; else if (cy >= GY) cy = GY - 1;
  return cy * GX + cx;
};

// --- world ---------------------------------------------------------------------
export function createWorld(seed = 1, rules = endlessRules()) {
  const w = {
    seed, rs: (seed >>> 0) || 1, rules,
    n: 0,
    x: new Float32Array(MAXP), y: new Float32Array(MAXP),
    vx: new Float32Array(MAXP), vy: new Float32Array(MAXP),
    ox: new Float32Array(MAXP), oy: new Float32Array(MAXP),
    c: new Uint8Array(MAXP), mark: new Uint8Array(MAXP), prog: new Float32Array(MAXP), sleep: new Uint8Array(MAXP), load: new Float32Array(MAXP).fill(1), pid: new Uint16Array(MAXP), lastPid: 0, merged: true, lock: new Uint8Array(MAXP), locks: [], age: new Uint16Array(MAXP), passivePops: 0, spanSeen: new Map(),
    // neighbour lists rebuilt every step
    cellStart: new Int32Array(NCELL + 1), cellIdx: new Int32Array(MAXP), pc: new Int32Array(MAXP),
    nb: new Int32Array(MAXP * NB), nbN: new Uint8Array(MAXP),
    stones: [], pearls: [],
    tray: [null, null, null], placed: 0, score: 0, chain: 0, bestChain: 0, pops: 0,
    popsBy: [0, 0, 0, 0, 0, 0, 0], poppedP: 0, mudStart: 0, mudCleared: 0, pearlsGot: 0,
    charges: rules.charges ?? 1, meter: 0, tilt: null, tilts: 0,
    steps: 0, quiet: 0, maxSpeed: 0, overT: 0, overflow: false, noPop: false,
    pending: [], events: [], sinceMud: 0,
  };
  w.rand = worldRand(w);
  return w;
}

// Endless ramp (tuned with sim.mjs): colours ↑, mud drops more often, bigger sets.
export const ENDLESS = { c3: 15, c4: 50, c5: 100, mud: [[25, 7], [60, 5], [100, 4]], big: [[0, .8], [30, 1], [70, 1.3]], mix: [[0, .15], [20, .3], [50, .45], [90, .55]] };
const stepAt = (tbl, p) => { let v = 0; for (const [from, val] of tbl) if (p >= from) v = val; return v; };
export function endlessRules() {
  return {
    kind: 'endless', charges: 1, earn: true, moves: 0, goals: [],
    colorsAt: p => p < (ENDLESS.c3 ?? 0) ? 2 : p < ENDLESS.c4 ? 3 : p < ENDLESS.c5 ? 4 : 5,
    bigAt: p => stepAt(ENDLESS.big, p),
    mixAt: p => stepAt(ENDLESS.mix, p),
    mudEvery: p => stepAt(ENDLESS.mud, p),
    palette: null,
  };
}

// --- particles -----------------------------------------------------------------
function addParticle(w, x, y, c, vx = 0, vy = 0) {
  if (w.n >= w.x.length) return -1;
  const i = w.n++;
  w.x[i] = x; w.y[i] = y; w.vx[i] = vx; w.vy[i] = vy; w.c[i] = c; w.mark[i] = 0; w.prog[i] = 0; if (w.sleep) w.sleep[i] = 0; if (w.pid) w.pid[i] = w.lastPid; if (w.lock) w.lock[i] = 0; if (w.age) w.age[i] = 0;
  return i;
}
// round disc of n particles (Vogel sunflower spiral, same density as the rest lattice)
const GOLD = Math.PI * (3 - Math.sqrt(5));
export function blob(w, cx, cy, n, c, vx = 0, vy = 0) {
  const R = Math.sqrt(n * SPACING * SPACING * .866 / Math.PI);
  for (let k = 0; k < n; k++) {
    const r = R * Math.sqrt((k + .5) / n), a = k * GOLD;
    addParticle(w, cx + Math.cos(a) * r, cy + Math.sin(a) * r, c, vx, vy);
  }
  return R;
}
// offsets of a packed disc of n particles (for previews)
export function discOffsets(n) {
  const F = () => new Float32Array(n), tmp = { n: 0, x: F(), y: F(), vx: F(), vy: F(), c: new Uint8Array(n), mark: new Uint8Array(n), prog: F(), mudStart: 0 };
  blob(tmp, 0, 0, n, 1);
  const out = new Float32Array(n * 2);
  for (let k = 0; k < n; k++) { out[k * 2] = tmp.x[k]; out[k * 2 + 1] = tmp.y[k]; }
  return out;
}
export const dropRadius = n => Math.sqrt(n * SPACING * SPACING * .866 / Math.PI);
// fill an axis-aligned box (tank coords) with packed particles
export function fillBox(w, x0, y0, x1, y1, c) {
  const dy = SPACING * .866;
  let row = 0;
  for (let y = y1 - WALL; y > y0; y -= dy, row++)
    for (let x = x0 + WALL + (row & 1) * SPACING * .5; x < x1 - WALL * .5; x += SPACING)
      if (!insideStone(w, x, y, .3)) addParticle(w, x, y, c);
}
function insideStone(w, x, y, pad) {
  for (const s of w.stones) { const d = segDist(s, x, y); if (d.d < s.r + pad) return true; }
  for (const p of w.pearls) if (p.alive && Math.hypot(x - p.x, y - p.y) < p.r + pad) return true;
  return false;
}
function segDist(s, x, y) {
  const ex = s.bx - s.ax, ey = s.by - s.ay, l2 = ex * ex + ey * ey;
  let t = l2 ? ((x - s.ax) * ex + (y - s.ay) * ey) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const px = s.ax + ex * t, py = s.ay + ey * t, dx = x - px, dy = y - py;
  return { d: Math.hypot(dx, dy), dx, dy };
}

function compact(w) {
  let j = 0;
  for (let i = 0; i < w.n; i++) {
    if (w.mark[i]) continue;
    if (i !== j) {
      w.x[j] = w.x[i]; w.y[j] = w.y[i]; w.vx[j] = w.vx[i]; w.vy[j] = w.vy[i];
      w.ox[j] = w.ox[i]; w.oy[j] = w.oy[i]; w.c[j] = w.c[i]; w.prog[j] = w.prog[i]; w.sleep[j] = w.sleep[i]; w.pid[j] = w.pid[i]; w.lock[j] = w.lock[i]; w.age[j] = w.age[i];
    }
    w.mark[j] = 0; j++;
  }
  w.n = j;
}

// --- neighbour search ----------------------------------------------------------
function buildGrid(w) {
  const { n, x, y, cellStart, cellIdx, pc } = w;
  cellStart.fill(0);
  for (let i = 0; i < n; i++) { const c = cellOf(x[i], y[i]); pc[i] = c; cellStart[c + 1]++; }
  for (let c = 0; c < NCELL; c++) cellStart[c + 1] += cellStart[c];
  const fill = w._fill || (w._fill = new Int32Array(NCELL));
  fill.set(cellStart.subarray(0, NCELL));
  for (let i = 0; i < n; i++) cellIdx[fill[pc[i]]++] = i;
  // hydrostatic load: how much liquid sits above each particle (3-column average, in particles)
  const above = w._above || (w._above = new Float32Array(NCELL));
  for (let cx = 0; cx < GX; cx++) {
    let acc = 0;
    for (let cy = 0; cy < GY; cy++) { const c = cy * GX + cx; above[c] = acc; acc += cellStart[c + 1] - cellStart[c]; }
  }
  const load = w.load, L0 = PHYS.load0;
  for (let i = 0; i < n; i++) {
    const c = pc[i], cx = c % GX;
    let a = above[c] * 2, k = 2;
    if (cx > 0) { a += above[c - 1]; k++; } if (cx < GX - 1) { a += above[c + 1]; k++; }
    a = a / k - PHYS.loadFree; // a body's own thickness is free; only what's piled on top squeezes it
    // cohesion scale: 1 with nothing on top, falling as the weight above grows
    load[i] = L0 > 0 && a > 0 ? 1 / (1 + (a / L0) * (a / L0)) : 1;
  }
  const { nb, nbN } = w;
  nbN.fill(0, 0, n);
  // half-shell: each cell against itself and 4 forward neighbours, store both directions
  for (let cy = 0; cy < GY; cy++) for (let cx = 0; cx < GX; cx++) {
    const c0 = cy * GX + cx, s0 = cellStart[c0], e0 = cellStart[c0 + 1];
    if (s0 === e0) continue;
    for (let o = 0; o < 5; o++) {
      const ox = cx + HSX[o], oy = cy + HSY[o];
      if (ox < 0 || ox >= GX || oy >= GY) continue;
      const c1 = oy * GX + ox, s1 = cellStart[c1], e1 = cellStart[c1 + 1];
      if (s1 === e1) continue;
      for (let a = s0; a < e0; a++) {
        const i = cellIdx[a], xi = x[i], yi = y[i];
        for (let b = o === 0 ? a + 1 : s1; b < e1; b++) {
          const j = cellIdx[b], dx = x[j] - xi, dy = y[j] - yi;
          if (dx * dx + dy * dy < 1) {
            if (nbN[i] < NB) nb[i * NB + nbN[i]++] = j;
            if (nbN[j] < NB) nb[j * NB + nbN[j]++] = i;
          }
        }
      }
    }
  }
}
// reorder particle storage by cell so neighbours sit close in memory
function reorder(w) {
  const { n, cellIdx } = w;
  const tmp = w._tmp || (w._tmp = new Float32Array(MAXP)), tc = w._tc || (w._tc = new Uint8Array(MAXP));
  for (const k of ['x', 'y', 'vx', 'vy', 'ox', 'oy']) { const a = w[k]; for (let q = 0; q < n; q++) tmp[q] = a[cellIdx[q]]; a.set(tmp.subarray(0, n)); }
  for (let q = 0; q < n; q++) tc[q] = w.c[cellIdx[q]]; w.c.set(tc.subarray(0, n));
  for (let q = 0; q < n; q++) tc[q] = w.sleep[cellIdx[q]]; w.sleep.set(tc.subarray(0, n));
  for (let q = 0; q < n; q++) tc[q] = w.lock[cellIdx[q]]; w.lock.set(tc.subarray(0, n));
  const tp = w._tp || (w._tp = new Uint16Array(MAXP)); for (let q = 0; q < n; q++) tp[q] = w.pid[cellIdx[q]]; w.pid.set(tp.subarray(0, n));
  for (let q = 0; q < n; q++) tp[q] = w.age[cellIdx[q]]; w.age.set(tp.subarray(0, n));
  for (let q = 0; q < n; q++) tmp[q] = w.prog[cellIdx[q]]; w.prog.set(tmp.subarray(0, n));
  buildGrid(w); // indices changed: neighbour lists must follow
}
const HSX = [0, 1, -1, 0, 1], HSY = [0, 0, 1, 1, 1];

// --- simulation step ---------------------------------------------------------
// SLOSH: the tank rocks one way, swings back past centre and settles — the liquid turns runny
// meanwhile (cohesion drops), so bodies smear thin and wide and near-lines reach the walls.
export function gravity(w) {
  const g = PHYS.grav;
  if (!w.tilt) return [0, g];
  const ph = 1 - w.tilt.t / w.tilt.T;
  let a;
  if (PHYS.tiltMode === 'nudge') {
    // gentle lean: ease over, hold, ease back — the liquid just slides a little that way
    const e = ph < .25 ? ph / .25 : ph > .75 ? (1 - ph) / .25 : 1;
    a = w.tilt.dir * PHYS.nudgeAmp * (e * e * (3 - 2 * e));
  } else a = w.tilt.dir * PHYS.sloshAmp * Math.sin(ph * Math.PI * 2 * PHYS.sloshWaves) * (1 - ph * .55);
  return [Math.sin(a) * g, Math.cos(a) * g];
}
export const sloshCoh = w => w.tilt && PHYS.tiltMode !== 'nudge' ? PHYS.sloshCoh : 1;
// relative weight per colour (coral heaviest … grape lightest, mud heaviest of all)
export const DENSITY = [1, 1.2, 1.1, 1, .9, .8, 1.35];

export function step(w) {
  REST2 = PHYS.restV * PHYS.restV; RESTIN2 = PHYS.restIn * PHYS.restIn;
  const { x, y, vx, vy, ox, oy, c, nb, nbN } = w;
  const n = w.n, P = PHYS;
  const [gx, gy] = gravity(w);
  // 1. gravity + viscosity (from last step's neighbour lists)
  // gravity + wall wetting: liquid near a side wall clings to it (so bodies can reach both walls)
  const adh = P.wallAdh, AR = 1.4;
  // while sloshing, each colour's own weight shows: heavy colours sink through light ones (stratify)
  const shake = w.tilt && P.tiltMode !== 'nudge';
  const strat = (shake ? P.stratify : P.stratBase) * P.grav, side = shake ? w.tilt.dir * P.sloshSide : 0;
  for (let i = 0; i < n; i++) {
    const dd = strat ? strat * (DENSITY[c[i]] - 1) : 0;
    // heavy colours sink and slide toward the side the tank leans to; light ones drift the other way
    vx[i] += gx + dd * side; vy[i] += gy + dd;
    if (y[i] > 0) { const dl = x[i] - WALL, dr = W - WALL - x[i]; if (dl < AR) vx[i] -= adh * (1 - dl / AR); else if (dr < AR) vx[i] += adh * (1 - dr / AR); }
  }
  const cohV = P.cohV * sloshCoh(w), xs = P.xsph;
  if (w._hasNb) {
    for (let i = 0; i < n; i++) {
      const base = i * NB, m = nbN[i];
      for (let k = 0; k < m; k++) {
        const j = nb[base + k]; if (j <= i || j >= n) continue;
        let dx = x[j] - x[i], dy = y[j] - y[i]; const r = Math.sqrt(dx * dx + dy * dy);
        if (r >= 1 || r < 1e-5) continue;
        dx /= r; dy /= r;
        if (c[i] === c[j] && cohV) { // surface tension: same colours attract
          let f;
          if (P.cohMode === 1) f = cohV * (r - SPACING) * (1 - r) * 2 * Math.min(w.load[i], w.load[j]); // spring, weakened under load
          else if (P.cohMode === 2) f = cohV * (1 - r) * r * Math.max(0, 2 - (nbN[i] + nbN[j]) / P.nbRef); // surface only
          else f = cohV * (1 - r) * r;
          if (c[i] === MUD) f *= 1.3;
          vx[i] += f * dx; vy[i] += f * dy; vx[j] -= f * dx; vy[j] -= f * dy;
        }
        if (xs) { // XSPH-style smoothing damps jitter inside a body
          const wgt = xs * (1 - r), ddx = (vx[j] - vx[i]) * wgt, ddy = (vy[j] - vy[i]) * wgt;
          vx[i] += ddx; vy[i] += ddy; vx[j] -= ddx; vy[j] -= ddy;
        }
        const u = (vx[i] - vx[j]) * dx + (vy[i] - vy[j]) * dy;
        if (u <= 0) continue;
        const mud = c[i] === MUD || c[j] === MUD ? 3 : 1;
        const I = (1 - r) * (P.sigma * mud * u + P.beta * u * u) * .5;
        vx[i] -= I * dx; vy[i] -= I * dy; vx[j] += I * dx; vy[j] += I * dy;
      }
    }
  }
  // 2. predict positions
  const mv = P.maxV;
  for (let i = 0; i < n; i++) {
    let ux = vx[i], uy = vy[i]; const s = ux * ux + uy * uy;
    if (s > mv * mv) { const f = mv / Math.sqrt(s); ux *= f; uy *= f; }
    ox[i] = x[i]; oy[i] = y[i]; x[i] += ux; y[i] += uy;
  }
  // 3. double density relaxation
  buildGrid(w); w._hasNb = true;
  const k = P.k, kN = P.kNear, rho0 = RHO0, rep = P.repel;
  for (let it = 0; it < P.iters; it++) {
    // alternate sweep direction so the Gauss-Seidel order doesn't bias the solve
    const rev = (it + w.steps) & 1;
    for (let ii = 0; ii < n; ii++) {
      const i = rev ? n - 1 - ii : ii;
      const base = i * NB, m = nbN[i], xi = x[i], yi = y[i], ci = c[i];
      let rho = 0, rhoN = 0, cnt = 0;
      for (let q = 0; q < m; q++) {
        const j = nb[base + q], dx = x[j] - xi, dy = y[j] - yi, r2 = dx * dx + dy * dy;
        if (r2 >= 1 || r2 < 1e-10) continue;
        const r = Math.sqrt(r2), s = 1 - r, s2 = s * s; rho += s2; rhoN += s2 * s;
        TJ[cnt] = j; TX[cnt] = dx / r; TY[cnt] = dy / r; TS[cnt] = s; cnt++;
      }
      const Pr = k * (rho - rho0), Pn = kN * rhoN, Pp = (Pr > 0 ? Pr : 0) + (w.tilt && P.tiltMode !== 'nudge' ? rep * .3 : rep);
      let ax = 0, ay = 0;
      for (let q = 0; q < cnt; q++) {
        const j = TJ[q], s = TS[q];
        const D = ((c[j] === ci ? Pr : Pp) * s + Pn * s * s) * .5;
        const dx = TX[q] * D, dy = TY[q] * D;
        x[j] += dx; y[j] += dy; ax -= dx; ay -= dy;
      }
      x[i] = xi + ax; y[i] = yi + ay;
    }
  }
  // 4. collisions
  const lo = WALL, hi = W - WALL, bot = H - WALL;
  for (let i = 0; i < n; i++) {
    if (x[i] < lo) x[i] = lo + (lo - x[i]) * .1; else if (x[i] > hi) x[i] = hi - (x[i] - hi) * .1;
    if (y[i] > bot) { y[i] = bot; x[i] = ox[i] + (x[i] - ox[i]) * .7; }
    if (y[i] < TOP) y[i] = TOP;
  }
  for (const s of w.stones) collideCapsule(w, s, s.r + WALL);
  for (const p of w.pearls) if (p.alive) collideCapsule(w, { ax: p.x, ay: p.y, bx: p.x, by: p.y }, p.r + WALL);
  // 5. velocities
  let ms = 0, sum = 0;
  const damp = P.damp;
  for (let i = 0; i < n; i++) {
    let ux = (x[i] - ox[i]) * damp, uy = (y[i] - oy[i]) * damp;
    if (c[i] === MUD) { ux *= .995; uy *= .998; }
    // interior particles (fully surrounded) damp pressure waves; surfaces keep their wobble
    const inner = nbN[i] >= P.inNb;
    if (inner) { ux *= P.inDamp; uy *= P.inDamp; }
    // static friction: nearly-still liquid comes to rest instead of shimmering
    const sp = ux * ux + uy * uy;
    if (inner && sp < RESTIN2) { ux *= P.rest; uy *= P.rest; }
    else if (sp < REST2) { const f = sp < REST2 * .25 ? P.rest : .5 + P.rest * .5; ux *= f; uy *= f; }
    // gel: liquid that has rested a few seconds sets — it can still sag and fall, but no longer
    // creeps sideways into gaps unless pushed hard (so placements leave lasting shapes)
    if (P.gel && !w.tilt) {
      const a = w.age[i];
      if (a > P.gelStart) {
        const g = P.gel * Math.min(1, (a - P.gelStart) / (P.gelEnd - P.gelStart));
        if (Math.abs(ux) < P.gelYield * g) { x[i] = ox[i]; ux = 0; }
      }
    }
    if (w.age[i] < 65000) w.age[i]++;
    vx[i] = ux; vy[i] = uy;
    const s = ux * ux + uy * uy; if (s > ms) ms = s; sum += s;
  }
  // sleeping: particles that stayed still for a while are pinned exactly in place
  // (no residual shimmer) until something fast comes near, a tilt starts or a pop happens
  const sl = w.sleep, SV = P.sleepV * P.sleepV, WV = P.wakeV * P.wakeV;
  ms = 0; sum = 0;
  for (let i = 0; i < n; i++) {
    const sp = vx[i] * vx[i] + vy[i] * vy[i];
    let lim = SV * w.load[i] * w.load[i];
    if (sp > SV && sp < WV) { // surrounded by sleepers: settle with them
      const base = i * NB, m = nbN[i]; let z = 0;
      for (let q = 0; q < m; q++) if (sl[nb[base + q]] > P.sleepAfter) z++;
      if (m && z >= m * .7) lim = WV;
    }
    if (sp > lim) { sl[i] = 0; }
    else if (sl[i] < 255) sl[i]++;
    if (sl[i] > P.sleepAfter) {
      let wake = false;
      const base = i * NB, m = nbN[i];
      for (let q = 0; q < m && !wake; q++) { const j = nb[base + q]; if (vx[j] * vx[j] + vy[j] * vy[j] > WV && sl[j] <= P.sleepAfter) wake = true; }
      if (wake) sl[i] = 0;
      else { x[i] = ox[i]; y[i] = oy[i]; vx[i] = 0; vy[i] = 0; continue; }
    }
    const s2 = vx[i] * vx[i] + vy[i] * vy[i]; if (s2 > ms) ms = s2; sum += s2;
  }
  w.maxSpeed = Math.sqrt(ms); w.meanSpeed = n ? Math.sqrt(sum / n) : 0;
}

function collideCapsule(w, s, R) {
  const { x, y, n } = w;
  const minx = Math.min(s.ax, s.bx) - R, maxx = Math.max(s.ax, s.bx) + R;
  const miny = Math.min(s.ay, s.by) - R, maxy = Math.max(s.ay, s.by) + R;
  for (let i = 0; i < n; i++) {
    const xi = x[i], yi = y[i];
    if (xi < minx || xi > maxx || yi < miny || yi > maxy) continue;
    const d = segDist(s, xi, yi);
    if (d.d < R) {
      if (d.d < 1e-6) { y[i] = yi - R; continue; }
      const f = R / d.d;
      x[i] = xi - d.dx + d.dx * f; y[i] = yi - d.dy + d.dy * f;
      // a bit of friction on the stone surface
      x[i] = w.ox[i] + (x[i] - w.ox[i]) * .92;
    }
  }
}

// --- clusters / popping ---------------------------------------------------------
const CL = 0.99; // contact distance for connectivity (matches where the rendered surfaces visibly join)
function findSpans(w) {
  const { n, x, y, c, nb, nbN } = w;
  const par = w._par || (w._par = new Int32Array(MAXP));
  for (let i = 0; i < n; i++) par[i] = i;
  const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  for (let i = 0; i < n; i++) {
    const ci = c[i]; if (ci === MUD) continue;
    const base = i * NB, m = nbN[i];
    for (let q = 0; q < m; q++) {
      const j = nb[base + q]; if (j <= i || c[j] !== ci) continue;
      const dx = x[j] - x[i], dy = y[j] - y[i];
      if (dx * dx + dy * dy < CL * CL) { const a = find(i), b = find(j); if (a !== b) par[a] = b; }
    }
  }
  const cnt = w._cnt || (w._cnt = new Int32Array(MAXP)); cnt.fill(0, 0, n);
  for (let i = 0; i < n; i++) if (c[i] !== MUD && y[i] > 0) cnt[find(i)]++;
  // horizontal extent of every body: a body that reaches both side walls pops
  const mnx = w._mnx || (w._mnx = new Float32Array(MAXP)), mxx = w._mxx || (w._mxx = new Float32Array(MAXP));
  for (let i = 0; i < n; i++) { mnx[i] = 1e9; mxx[i] = -1e9; }
  for (let i = 0; i < n; i++) { if (c[i] === MUD || y[i] < 0) continue; const r = find(i); if (x[i] < mnx[r]) mnx[r] = x[i]; if (x[i] > mxx[r]) mxx[r] = x[i]; }
  const lo = WALL + SPAN_EDGE, hi = W - WALL - SPAN_EDGE, full = hi - lo;
  const spanOf = r => mxx[r] < mnx[r] ? 0 : Math.max(0, Math.min(1, (Math.min(mxx[r], hi) - Math.max(mnx[r], lo)) / full));
  // per-particle progress toward popping (drives the shimmer on nearly-spanning bodies)
  for (let i = 0; i < n; i++) w.prog[i] = c[i] === MUD ? 0 : w.lock[i] ? 1 : spanOf(find(i));
  // bodies for the on-screen span gauges
  const bodies = new Map();
  for (let i = 0; i < n; i++) {
    if (c[i] === MUD || y[i] < 0) continue;
    const r = find(i); if (cnt[r] < DROP_N * .6) continue;
    let b = bodies.get(r); if (!b) bodies.set(r, b = { r, color: c[i], n: cnt[r], sx: 0, sy: 0, k: 0, top: 1e9, tx: 0 });
    b.sx += x[i]; b.sy += y[i]; b.k++; if (y[i] < b.top) { b.top = y[i]; b.tx = x[i]; }
  }
  // tiny splash fragments that came to rest evaporate (keeps the tank clean)
  w._tiny = null;
  if (w.quiet > 30 || w.steps % 30 === 0) {
    let tiny = null;
    for (let i = 0; i < n; i++) if (c[i] !== MUD && y[i] > 0 && cnt[find(i)] < DROP_N * .34 && Math.abs(w.vy[i]) < .01) (tiny ??= []).push(i);
    w._tiny = tiny;
  }
  w.bodies = [...bodies.values()].map(b => ({ color: b.color, drops: Math.round(b.n / DROP_N), cx: b.sx / b.k, cy: b.sy / b.k, top: b.top, tx: b.tx,
    x0: Math.max(lo, mnx[b.r]), x1: Math.min(hi, mxx[b.r]), span: spanOf(b.r) }));
  // the newest piece just joined an older body of its colour → a small "merge" reward
  if (!w.merged && w.lastPid) {
    const hasNew = w._hn || (w._hn = new Uint8Array(MAXP)), hasOld = w._ho || (w._ho = new Uint8Array(MAXP));
    hasNew.fill(0, 0, n); hasOld.fill(0, 0, n);
    for (let i = 0; i < n; i++) { if (c[i] === MUD || y[i] < 0) continue; const r = find(i); if (w.pid[i] === w.lastPid) hasNew[r] = 1; else hasOld[r] = 1; }
    for (let i = 0; i < n; i++) if (par[i] === i && hasNew[i] && hasOld[i] && cnt[i] >= DROP_N) {
      w.merged = true;
      let sx = 0, top = 1e9, k = 0; for (let j = 0; j < n; j++) if (w.pid[j] === w.lastPid && find(j) === i) { sx += x[j]; k++; if (y[j] < top) top = y[j]; }
      w._mergeEv = { type: 'merge', color: c[i], x: sx / k, y: top, drops: Math.round(cnt[i] / DROP_N), span: spanOf(i) };
      break;
    }
  }
  // a body that reaches both walls first LOCKS (glows, the join is shown), then pops when its timer ends.
  // Anything of its colour that joins it meanwhile pops with it.
  const slotOf = w._slot || (w._slot = new Uint8Array(MAXP)); slotOf.fill(0, 0, n);
  for (let i = 0; i < n; i++) if (w.lock[i] && c[i] !== MUD) slotOf[find(i)] = w.lock[i];
  const due = new Set(w.locks.filter(l => l.t <= 0).map(l => l.slot));
  const rs = new Set();
  for (let i = 0; i < n; i++) {
    if (par[i] !== i || c[i] === MUD) continue;
    const sl = slotOf[i];
    if (sl) { if (due.has(sl)) rs.add(i); continue; }
    if (cnt[i] >= DROP_N * .5 && mnx[i] <= lo && mxx[i] >= hi && solidLine(w, i, find, lo, hi) && held(w, c[i])) {
      // start a lock: where did it join? (newest piece in it, else its middle)
      const slot = (w.lockSeq = (w.lockSeq || 0) % 250 + 1);
      let jx = 0, jy = 0, jk = 0, sy = 0, k2 = 0;
      for (let j = 0; j < n; j++) if (c[j] !== MUD && find(j) === i) { w.lock[j] = slot; sy += y[j]; k2++; if (w.pid[j] === w.lastPid) { jx += x[j]; jy += y[j]; jk++; } }
      const ev = { type: 'lock', slot, color: c[i], y: sy / k2, x: jk ? jx / jk : (mnx[i] + mxx[i]) / 2, jy: jk ? jy / jk : sy / k2, steps: LOCK_STEPS, drops: Math.round(cnt[i] / DROP_N) };
      w.locks.push({ slot, t: LOCK_STEPS, color: c[i] });
      (w._lockEv ||= []).push(ev);
    }
  }
  w.locks = w.locks.filter(l => !due.has(l.slot));
  // persistence bookkeeping: colours whose wall-to-wall candidate vanished start over
  for (const col of [...w.spanSeen.keys()]) if (!w._seenNow?.has(col)) w.spanSeen.delete(col);
  w._seenNow = null;
  if (!rs.size) return null;
  const groups = new Map();
  for (let i = 0; i < n; i++) { if (c[i] === MUD) continue; const r = find(i); if (rs.has(r)) { let g = groups.get(r); if (!g) groups.set(r, g = []); g.push(i); } }
  return [...groups.values()];
}

// the line must be a real band: every 1-unit column between the walls holds ≥ neckMin of its particles
// (matches what the renderer draws as an unbroken band; hair-thin necks don't count)
function solidLine(w, root, find, lo, hi) {
  const cols = w._cols || (w._cols = new Uint16Array(W + 2)); cols.fill(0);
  const { n, x, y, c } = w;
  for (let j = 0; j < n; j++) if (c[j] !== MUD && y[j] > 0 && find(j) === root) cols[Math.min(W, Math.max(0, x[j] | 0))]++;
  for (let cx = Math.floor(lo); cx <= Math.min(W - 1, Math.floor(hi)); cx++) if (cols[cx] < PHYS.neckMin) return false;
  return true;
}
// …and stay connected for a moment (a splash grazing a wall doesn't count)
function held(w, col) {
  (w._seenNow ||= new Set()).add(col);
  const k = (w.spanSeen.get(col) || 0) + 1; w.spanSeen.set(col, k);
  return k >= PHYS.holdChecks;
}

function pop(w, groups) {
  const { x, y, c, mark } = w;
  const out = { type: 'pop', groups: [], mud: 0, pearls: [], chain: 0, points: 0, gained: false };
  let total = 0;
  for (const g of groups) {
    let sx = 0, sy = 0, minY = 1e9, maxY = -1e9;
    const pts = new Float32Array(g.length * 2);
    g.forEach((i, k) => { mark[i] = 1; sx += x[i]; sy += y[i]; pts[k * 2] = x[i]; pts[k * 2 + 1] = y[i]; if (y[i] < minY) minY = y[i]; if (y[i] > maxY) maxY = y[i]; });
    const col = c[g[0]];
    out.groups.push({ color: col, n: g.length, cx: sx / g.length, cy: sy / g.length, minY, maxY, pts });
    w.popsBy[col]++; total += g.length;
  }
  // mud and pearls touching a popping body wash away with it
  buildMarkGrid(w);
  const mudPts = [];
  for (let i = 0; i < w.n; i++) if (c[i] === MUD && !mark[i] && nearMarked(w, x[i], y[i], 1.15)) { mark[i] = 2; out.mud++; mudPts.push(x[i], y[i]); }
  // second ring so a mud layer erodes visibly
  if (out.mud) for (let i = 0; i < w.n; i++) if (c[i] === MUD && !mark[i] && nearMarkedMud(w, x[i], y[i], .75)) { mark[i] = 3; out.mud++; mudPts.push(x[i], y[i]); }
  out.mudPts = new Float32Array(mudPts);
  for (const p of w.pearls) if (p.alive && nearMarked(w, p.x, p.y, p.r + 0.9)) { p.alive = false; out.pearls.push(p); w.pearlsGot++; }
  w.mudCleared += out.mud;
  w.chain++; w.bestChain = Math.max(w.bestChain, w.chain);
  out.chain = w.chain;
  // "passive" = not a chain and the latest piece isn't part of it (the line formed by itself)
  let mine = false; for (const g of groups) { for (const i of g) if (w.pid[i] === w.lastPid) { mine = true; break; } if (mine) break; }
  out.passive = w.chain === 1 && !mine && !w.tiltPop;
  if (out.passive) w.passivePops++;
  // bigger pops pay more than linearly: waiting to add a big set onto a ready body is worth it
  let pts = 0; for (const g of out.groups) { const d = g.n / DROP_N; pts += Math.round(d * d * 12); }
  out.points = (pts * 10 + out.mud * 4 + out.pearls.length * 500) * w.chain;
  w.score += out.points; w.pops += groups.length; w.poppedP += total;
  if (w.rules.earn) {
    w.meter += total + out.mud;
    while (w.meter >= TILT_METER && w.charges < TILT_MAX) { w.meter -= TILT_METER; w.charges++; out.gained = true; }
    if (w.charges >= TILT_MAX) w.meter = Math.min(w.meter, TILT_METER);
  }
  // melt: liquid above the popped line (and right around it) turns fresh again so it slumps, refills
  // the gap and may meet its colour → chain reactions that untangle a "marbled" tank
  let gx0 = 1e9, gx1 = -1e9, gyMax = -1e9;
  for (const g of out.groups) { gyMax = Math.max(gyMax, g.maxY); for (let k = 0; k < g.pts.length; k += 2) { gx0 = Math.min(gx0, g.pts[k]); gx1 = Math.max(gx1, g.pts[k]); } }
  for (let i = 0; i < w.n; i++) if (!mark[i] && (y[i] < gyMax + .5 || nearMarked(w, x[i], y[i], PHYS.meltR))) w.age[i] = 0;
  out.melted = true;
  compact(w); buildGrid(w); w.sleep.fill(0);
  return out;
}
function buildMarkGrid(w) {
  const m = w._mg || (w._mg = new Map()); m.clear();
  for (let i = 0; i < w.n; i++) if (w.mark[i]) { const k = ((w.x[i] | 0) + 1) * 1000 + ((w.y[i] - TOP) | 0); let a = m.get(k); if (!a) m.set(k, a = []); a.push(i); }
}
function nearMarked(w, px, py, r) {
  const m = w._mg, cx = (px | 0) + 1, cy = (py - TOP) | 0, R = Math.ceil(r);
  for (let a = -R; a <= R; a++) for (let b = -R; b <= R; b++) {
    const list = m.get((cx + a) * 1000 + cy + b); if (!list) continue;
    for (const j of list) if (w.mark[j] === 1 && (w.x[j] - px) ** 2 + (w.y[j] - py) ** 2 < r * r) return true;
  }
  return false;
}
function nearMarkedMud(w, px, py, r) {
  // second ring: neighbours of first-ring mud
  for (let j = 0; j < w.n; j++) if (w.mark[j] === 2 && (w.x[j] - px) ** 2 + (w.y[j] - py) ** 2 < r * r) return true;
  return false;
}

// --- per-frame tick -----------------------------------------------------------------
export function tick(w) {
  const ev = [];
  // pending drops (mud) come in after a short delay
  for (let k = w.pending.length - 1; k >= 0; k--) {
    const p = w.pending[k];
    if (--p.delay <= 0) { w.pending.splice(k, 1); spawnDrop(w, p.x, p.n, p.c); ev.push({ type: 'mud', x: p.x }); }
  }
  if (w.steps % 40 === 0 && w.n) { buildGrid(w); reorder(w); }
  step(w); w.steps++;
  if (w.tilt && --w.tilt.t <= 0) { w.tilt = null; w.tiltPop = 120; }
  if (w.tilt) w.tiltPop = 120; else if (w.tiltPop > 0) w.tiltPop--;
  for (const l of w.locks) l.t--;
  if (!w.noPop && (w.steps % 3 === 0)) {
    const g = findSpans(w);
    if (w._mergeEv) { const m = w._mergeEv; w._mergeEv = null; m.points = 20 * m.drops; w.score += m.points; ev.push(m); }
    if (w._lockEv) { ev.push(...w._lockEv); w._lockEv = null; }
    if (g) ev.push(pop(w, g));
    else if (w._tiny) {
      const pts = new Float32Array(w._tiny.length * 3);
      w._tiny.forEach((i, k) => { w.mark[i] = 1; pts[k * 3] = w.x[i]; pts[k * 3 + 1] = w.y[i]; pts[k * 3 + 2] = w.c[i]; });
      compact(w); buildGrid(w); w._tiny = null;
      ev.push({ type: 'fizz', pts });
    }
  }
  w.quiet = w.meanSpeed < 0.012 ? w.quiet + 1 : 0;
  // overflow: liquid sitting above the danger line
  let high = 0;
  for (let i = 0; i < w.n; i++) if (w.y[i] < DANGER && w.y[i] > 0 && Math.abs(w.vy[i]) < 0.02) high++;
  w.high = high;
  w.overT = high > 12 ? w.overT + 1 : Math.max(0, w.overT - 2);
  if (w.overT > TPS * 1.6) w.overflow = true;
  return ev;
}

export const settled = w => w.quiet >= 20 && !w.pending.length && !w.tilt && !w.locks.length;

// --- player actions -------------------------------------------------------------------
export const dropR = n => Math.sqrt(n * SPACING * SPACING * .866 / Math.PI);
// centres of a piece's droplets relative to the piece centre-x and its lowest row (y up = negative)
export function pieceLayout(cells) {
  const { w: pw, h: ph } = shapeSize(cells);
  return cells.map(([cx, cy]) => [(cx - (pw - 1) / 2) * CELL, -(ph - 1 - cy) * CELL]);
}
export function clampPieceX(cells, x) {
  const half = (shapeSize(cells).w - 1) / 2 * CELL + dropR(DROP_N) + .3;
  return Math.max(half + WALL, Math.min(W - half - WALL, x));
}
export function spawnDrop(w, x, n, c) {
  const r = dropR(n) + 0.4;
  x = Math.max(r + WALL, Math.min(W - r - WALL, x));
  blob(w, x, -r - 0.3, n, c, 0, 0.12);
  w._hasNb = false;
  return x;
}
// c: one colour for every droplet, or an array with a colour per cell
// where a piece's lowest row starts: hovering just above the liquid under it (not the tank top),
// so it lands softly where you aimed instead of splashing from high up
export function spawnBaseY(w, cells, x) {
  x = clampPieceX(cells, x);
  const r = dropR(DROP_N), half = (shapeSize(cells).w - 1) / 2 * CELL + r;
  let top = H;
  for (let i = 0; i < w.n; i++) if (w.y[i] > 0 && Math.abs(w.x[i] - x) < half && w.y[i] < top) top = w.y[i];
  for (const st of w.stones) { const sx0 = Math.min(st.ax, st.bx) - st.r, sx1 = Math.max(st.ax, st.bx) + st.r; if (sx1 > x - half && sx0 < x + half) top = Math.min(top, Math.min(st.ay, st.by) - st.r); }
  return PHYS.hover > 0 ? Math.max(-r - .4, top - r - PHYS.hover) : -r - .4; // hover 0 = drop from above the jar
}
export function spawnPiece(w, cells, x, c) {
  x = clampPieceX(cells, x);
  const base = spawnBaseY(w, cells, x);
  w.lastPid = (w.lastPid % 65000) + 1; w.merged = false;
  pieceLayout(cells).forEach(([dx, dy], k) => blob(w, x + dx, base + dy, DROP_N, Array.isArray(c) ? c[k] : c, 0, .05));
  w._hasNb = false;
  return x;
}
export const clampDropX = (n, x) => { const r = dropR(n) + 0.4; return Math.max(r + WALL, Math.min(W - r - WALL, x)); };

export function drop(w, slot, x) {
  const p = w.tray[slot]; if (!p || w.overflow) return null;
  if (w.rules.moves && w.placed >= w.rules.moves) return null;
  // conveyor: the used slot closes up, older pieces slide right, a new one enters on the left
  for (let i = slot; i > 0; i--) w.tray[i] = w.tray[i - 1];
  w.tray[0] = null;
  const px = spawnPiece(w, p.cells, x, p.cols);
  w.placed++; w.chain = 0; w.quiet = 0;
  // mud no longer rains in at random: every few drops a mud set joins the conveyor and YOU decide where it goes
  const me = w.rules.mudEvery(w.placed);
  let mudNow = false;
  if (me) { w.sinceMud++; if (w.sinceMud >= me) { w.sinceMud = 0; mudNow = true; } }
  w.tray[0] = mudNow ? mudPiece(w) : randomPiece(w);
  return { x: px, cells: p.cells, cols: p.cols };
}
export const nextMudIn = w => { const me = w.rules.mudEvery(w.placed); return me ? me - w.sinceMud : 0; };
export const movesLeft = w => w.rules.moves ? Math.max(0, w.rules.moves - w.placed) : Infinity;

export function startTilt(w, dir) {
  if (w.tilt || w.charges <= 0 || w.rules.noTilt) return false;
  w.charges--; w.tilts++; const T = PHYS.tiltMode === 'nudge' ? PHYS.nudgeSteps : PHYS.sloshSteps;
  w.tilt = { dir, t: T, T }; w.chain = 0; w.quiet = 0; w.sleep.fill(0);
  return true;
}

// --- tray ------------------------------------------------------------------------------------
export function paletteOf(w) {
  if (w.rules.palette) return w.rules.palette;
  const k = w.rules.colorsAt(w.placed); return [1, 2, 3, 4, 5].slice(0, k);
}
// colours sitting near the liquid surface — biasing toward them keeps merges reachable
export function surfaceColors(w) {
  const top = new Map();
  const colTop = new Float32Array(W).fill(1e9), colC = new Uint8Array(W);
  for (let i = 0; i < w.n; i++) {
    if (w.y[i] < 0 || w.c[i] === MUD) continue;
    const b = Math.min(W - 1, w.x[i] | 0);
    if (w.y[i] < colTop[b]) { colTop[b] = w.y[i]; colC[b] = w.c[i]; }
  }
  for (let b = 0; b < W; b++) if (colC[b]) top.set(colC[b], (top.get(colC[b]) || 0) + 1);
  return [...top.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);
}
function pickShape(w) {
  const big = w.rules.bigAt(w.placed), wt = sh => sh.w * (sh.big ? big : 1);
  let r = w.rand() * SHAPES.reduce((a, sh) => a + wt(sh), 0);
  for (const sh of SHAPES) if ((r -= wt(sh)) < 0) return sh.c;
  return SHAPES[0].c;
}
// A piece is a droplet set: cells + a colour per cell. Two-colour sets force a choice —
// one colour lands where you want it, the other has to go somewhere (Hexa Sort / Puyo tension).
export function makePiece(cells, a, b = a, axis = 'y') {
  const { w: pw, h: ph } = shapeSize(cells);
  const cols = cells.map(([x, y]) => (axis === 'y' ? (ph > 1 ? y < ph / 2 : x < pw / 2) : (pw > 1 ? x < pw / 2 : y < ph / 2)) ? a : b);
  return { cells, cols };
}
export const pieceColors = p => [...new Set(p.cols)];
const RESCUE_SHAPES = [[[0, 0]], [[0, 0], [1, 0]], [[0, 0], [0, 1]]];
export function randomPiece(w) {
  const pal = paletteOf(w), surf = surfaceColors(w).filter(c => pal.includes(c));
  if (w.n && fillLevel(w) > PHYS.rescueFill) { // comeback chance: small, single-colour, matching what's on top
    const cells = RESCUE_SHAPES[(w.rand() * RESCUE_SHAPES.length) | 0];
    const c = surf.length ? surf[(w.rand() * Math.min(2, surf.length)) | 0] : pal[(w.rand() * pal.length) | 0];
    return makePiece(cells, c, c);
  }
  const mix = w.rules.mixAt ? w.rules.mixAt(w.placed) : 0;
  const pick = () => (surf.length && w.rand() < .45) ? surf[(w.rand() * Math.min(2, surf.length)) | 0] : pal[(w.rand() * pal.length) | 0];
  const cells = pickShape(w);
  const a = pick();
  let b = a;
  if (cells.length > 1 && pal.length > 1 && w.rand() < mix) { do b = pal[(w.rand() * pal.length) | 0]; while (b === a); }
  return makePiece(cells, a, b, w.rand() < .5 ? 'y' : 'x');
}
export const MUD_SHAPES = [[[0, 0], [1, 0]], [[0, 0], [0, 1]], [[0, 0], [1, 0], [2, 0]], [[0, 0], [1, 0], [0, 1]]];
export function mudPiece(w) { const cells = MUD_SHAPES[(w.rand() * MUD_SHAPES.length) | 0]; return { cells, cols: cells.map(() => MUD), mud: true }; }
export function refillTray(w) { for (let k = 0; k < 3; k++) w.tray[k] = randomPiece(w); }

export function fillLevel(w) { // 0..1 of how high the liquid reaches
  let top = H;
  const cnt = new Uint16Array(H);
  for (let i = 0; i < w.n; i++) { const r = w.y[i] | 0; if (r >= 0 && r < H) cnt[r]++; }
  for (let r = 0; r < H; r++) if (cnt[r] > 6) { top = r; break; }
  return (H - top) / (H - DANGER);
}

// --- goals --------------------------------------------------------------------------------------
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

// --- setup ------------------------------------------------------------------------------------
// preset: { fills:[[x0,y0,x1,y1,c]], stones:[[ax,ay,bx,by,r]], pearls:[[x,y]] }, y measured up from the floor
export function loadPreset(w, pre = {}) {
  for (const s of pre.stones || []) w.stones.push({ ax: s[0], ay: H - s[1], bx: s[2], by: H - s[3], r: s[4], kind: s[5] ?? 0 });
  for (const p of pre.pearls || []) w.pearls.push({ x: p[0], y: H - p[1], r: 0.9, alive: true });
  for (const f of pre.fills || []) fillBox(w, f[0], H - f[3], f[2], H - f[1], f[4]);
  w.mudStart = 0; for (let i = 0; i < w.n; i++) if (w.c[i] === MUD) w.mudStart++;
  // let it settle without popping
  w.noPop = true;
  for (let k = 0; k < (pre.settle ?? 260); k++) step(w);
  w.noPop = false; w.quiet = 0;
}

// deep copy for look-ahead previews (same deterministic simulation)
const SNAP_ARR = ['x', 'y', 'vx', 'vy', 'ox', 'oy', 'c', 'prog', 'sleep', 'load', 'pid', 'lock', 'age'];
// plain, structured-clone-able copy of everything the simulation needs (for a Web Worker)
export function snapshotWorld(w) {
  const n = w.n, NBk = w.nb.length / MAXP, snap = { n, seed: w.seed };
  for (const k of SNAP_ARR) snap[k] = w[k].slice(0, n);
  snap.nb = w.nb.slice(0, n * NBk); snap.nbN = w.nbN.slice(0, n);
  snap.cellStart = w.cellStart.slice(); snap.cellIdx = w.cellIdx.slice(0, n); snap.pc = w.pc.slice(0, n);
  Object.assign(snap, { steps: w.steps, lastPid: w.lastPid, chain: w.chain, lockSeq: w.lockSeq, _hasNb: w._hasNb, quiet: w.quiet, overT: w.overT,
    tiltPop: w.tiltPop, meanSpeed: w.meanSpeed, maxSpeed: w.maxSpeed, rs: w.rs, noPop: w.noPop, placed: w.placed, sinceMud: w.sinceMud,
    score: w.score, pops: w.pops, charges: w.charges,
    tilt: w.tilt && { ...w.tilt }, stones: w.stones.map(s => ({ ...s })), pearls: w.pearls.map(p => ({ ...p })), locks: w.locks.map(l => ({ ...l })),
    spanSeen: [...w.spanSeen], tray: w.tray.map(t => t && { cells: t.cells, cols: t.cols.slice(), mud: t.mud }), pending: w.pending.map(p => ({ ...p })) });
  return snap;
}
export function restoreWorld(snap, rules = endlessRules()) {
  const v = createWorld(snap.seed, rules), n = snap.n;
  for (const k of SNAP_ARR) v[k].set(snap[k]);
  v.nb.set(snap.nb); v.nbN.set(snap.nbN); v.cellStart.set(snap.cellStart); v.cellIdx.set(snap.cellIdx); v.pc.set(snap.pc);
  for (const k of ['n', 'steps', 'lastPid', 'chain', 'lockSeq', '_hasNb', 'quiet', 'overT', 'tiltPop', 'meanSpeed', 'maxSpeed', 'rs', 'noPop', 'placed', 'sinceMud', 'score', 'pops', 'charges', 'stones', 'pearls', 'locks', 'tray', 'pending'])
    v[k] = snap[k];
  v.tilt = snap.tilt && { ...snap.tilt }; v.spanSeen = new Map(snap.spanSeen); v.merged = true; v.rand = worldRand(v);
  return v;
}
// deep copy for look-ahead previews (same deterministic simulation)
export function cloneWorld(w) {
  const v = restoreWorld(snapshotWorld(w), w.rules);
  v.charges = 9;
  return v;
}

// Look-ahead used by the previews. Returns where the new liquid settles and the FIRST line it would
// complete (later chain reactions are deliberately not reported — those stay a surprise).
export function predict(w, act, maxSteps = 260) {
  const v = cloneWorld(w);
  v.rules = { ...w.rules, mudEvery: () => 0 }; v.pending = [];
  if (act.type === 'drop') { if (!drop(v, act.slot, act.x)) return null; }
  else { v.charges = 9; if (!startTilt(v, act.dir)) return null; }
  const pid = v.lastPid;
  // let it settle without popping (the ghost shows the resting shape, not a mid-fall splash) …
  v.noPop = true;
  let k = 0;
  for (; k < maxSteps; k++) { tick(v); if (k > 60 && v.meanSpeed < .01 && !v.tilt) break; }
  const pts = [];
  for (let i = 0; i < v.n; i++) if (act.type === 'drop' ? v.pid[i] === pid : v.c[i] !== MUD) pts.push(v.x[i], v.y[i], v.c[i]);
  // … then see whether that resting state is a wall-to-wall line
  v.noPop = false; v.spanSeen.clear();
  let line = null;
  for (let j = 0; j < 3 * (PHYS.holdChecks + 2) && !line; j++) for (const e of tick(v)) if (e.type === 'lock' && !line) line = { color: e.color, y: e.y };
  return { line, pts, bodies: v.bodies, steps: k };
}

export function seededWorld(seed, rules) {
  const w = createWorld(seed, rules || endlessRules());
  refillTray(w);
  return w;
}
