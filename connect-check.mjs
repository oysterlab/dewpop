// Does "the game says connected" match "the screen shows an unbroken band"?  node connect-check.mjs [games]
// Rebuilds the renderer's field on the CPU (same splat kernel, dominant-minus-runner-up height, same threshold)
// and flood-fills each colour's visible band from the left wall to the right wall.
import * as EP from './dist/engine.js';
import * as EG from './dist/engine-grid.js';
const E = process.env.ENGINE === 'particle' ? EP : EG;
import { choose } from './sim.mjs';
const R = 1.0, T = 0.95, CELL = 0.2, GW = Math.round(E.W / CELL), GH = Math.round(E.H / CELL);
const NC = 8, field = new Float32Array(GW * GH * NC);
function render(w) {
  field.fill(0);
  for (let i = 0; i < w.n; i++) {
    const c = w.c[i]; if (w.y[i] < 0) continue;
    const x0 = Math.max(0, Math.floor((w.x[i] - R) / CELL)), x1 = Math.min(GW - 1, Math.ceil((w.x[i] + R) / CELL));
    const y0 = Math.max(0, Math.floor((w.y[i] - R) / CELL)), y1 = Math.min(GH - 1, Math.ceil((w.y[i] + R) / CELL));
    for (let gy = y0; gy <= y1; gy++) for (let gx = x0; gx <= x1; gx++) {
      const dx = (gx + .5) * CELL - w.x[i], dy = (gy + .5) * CELL - w.y[i], d2 = (dx * dx + dy * dy) / (R * R);
      if (d2 < 1) { const k = 1 - d2; field[(gy * GW + gx) * NC + c] += k * k * k; }
    }
  }
}
function visibleBand(col) {
  const ok = new Uint8Array(GW * GH);
  for (let k = 0; k < GW * GH; k++) {
    let m1 = 0, m2 = 0, ci = 0;
    for (let c = 1; c < NC; c++) { const v = field[k * NC + c]; if (v > m1) { m2 = m1; m1 = v; ci = c; } else if (v > m2) m2 = v; }
    ok[k] = ci === col && m1 - .75 * m2 >= T ? 1 : 0;
  }
  const seen = new Uint8Array(GW * GH), st = [];
  const edge = Math.ceil((E.WALL + E.SPAN_EDGE) / CELL);
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < edge; gx++) { const k = gy * GW + gx; if (ok[k]) { seen[k] = 1; st.push(k); } }
  while (st.length) {
    const k = st.pop(), gx = k % GW, gy = (k / GW) | 0;
    if (gx >= GW - edge) return true;
    for (const [ax, ay] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = gx + ax, ny = gy + ay; if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
      const q = ny * GW + nx; if (ok[q] && !seen[q]) { seen[q] = 1; st.push(q); }
    }
  }
  return false;
}
// what the engine would accept right now (contact + wall-to-wall + solid band; persistence aside)
function judged(w) {
  const { n, x, y, c, nb, nbN } = w, NB = nb.length / E.MAXP, par = new Int32Array(n);
  for (let i = 0; i < n; i++) par[i] = i;
  const find = i => { while (par[i] !== i) { par[i] = par[par[i]]; i = par[i]; } return i; };
  for (let i = 0; i < n; i++) for (let q = 0; q < nbN[i]; q++) { const j = nb[i * NB + q]; if (j < n && c[j] === c[i] && c[i] !== E.MUD) { const dx = x[j] - x[i], dy = y[j] - y[i]; if (dx * dx + dy * dy < .99 * .99) { const a = find(i), b = find(j); if (a !== b) par[a] = b; } } }
  const lo = E.WALL + E.SPAN_EDGE, hi = E.W - E.WALL - E.SPAN_EDGE, info = new Map();
  for (let i = 0; i < n; i++) { if (c[i] === E.MUD || y[i] < 0) continue; const r = find(i); let b = info.get(r); if (!b) info.set(r, b = { c: c[i], mn: 1e9, mx: -1e9, cols: new Uint16Array(E.W + 1) }); b.mn = Math.min(b.mn, x[i]); b.mx = Math.max(b.mx, x[i]); b.cols[Math.min(E.W, x[i] | 0)]++; }
  const out = new Set();
  for (const b of info.values()) {
    if (b.mn > lo || b.mx < hi) continue;
    let solid = true; for (let cx = Math.floor(lo); cx <= Math.floor(hi); cx++) if (b.cols[cx] < E.PHYS.neckMin) solid = false;
    if (solid) out.add(b.c);
  }
  return out;
}
const games = +process.argv[2] || 6;
if (process.argv[3]) E.tune(JSON.parse(process.argv[3]));
let both = 0, onlyScreen = 0, onlyGame = 0, samples = 0;
for (let s = 1; s <= games; s++) {
  const w = E.createWorld(s); E.refillTray(w); const r = E.rng(s * 13);
  w.noPop = true; // look at raw states, including near misses
  for (let m = 0; m < 30 && !w.overflow; m++) {
    const slots = [0, 1, 2].filter(k => w.tray[k]); const ch = r() < .5 ? choose(w, slots, r) : { k: slots[0], x: r() * E.W };
    E.drop(w, ch.k, ch.x);
    for (let t = 0; t < 240; t++) {
      E.tick(w);
      if (t % 20 === 19) {
        render(w); const j = judged(w); samples++;
        for (let col = 1; col <= 5; col++) { const v = visibleBand(col), g = j.has(col); if (v && g) both++; else if (v) onlyScreen++; else if (g) onlyGame++; }
      }
    }
    // keep the tank from filling: clear judged lines like the game would
    w.noPop = false; for (let t = 0; t < 3; t++) E.tick(w); w.noPop = true;
  }
}
const pos = both + onlyScreen + onlyGame;
console.log(JSON.stringify({ samples, connectedBoth: both, visibleButNotJudged: onlyScreen, judgedButNotVisible: onlyGame,
  agreementOnConnections: pos ? +(both / pos * 100).toFixed(1) + '%' : 'n/a' }));
