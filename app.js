import * as EP from './engine.js';
import * as EG from './engine-grid.js';
// which physics engine: the grid ("cells inside, liquid outside", default) or the original particle one
const ENGINE_NAME = (() => { try { return JSON.parse(localStorage.getItem('dewpop-opts') || '{}').particle ? 'particle' : 'grid'; } catch { return 'grid'; } })();
const E = ENGINE_NAME === 'particle' ? EP : EG;
import { createLiquidRenderer } from './liquid-gl.js';
import { LEVELS, WORLDS, levelRules, GOAL_TEXT } from './levels.js';
const { W, H } = E;
const VIEW_TOP = ENGINE_NAME === 'grid' ? -13.5 : -9, VIEW_H = H - VIEW_TOP;   // the canvas also shows the open air above the tank
const SPLAT_R = ENGINE_NAME === 'grid' ? 1.3 : 1.0; // splat radius (units); the grid engine draws rounder, softer blobs

const $ = id => document.getElementById(id);
const boardWrap = $('boardWrap'), decoCv = $('deco'), deco = decoCv.getContext('2d');
let boardCv = $('board');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// experiment switches so each design change can be judged on its own (title → 실험 옵션)
const OPTS = {
  sort: { label: '평소 무게 정렬', hint: '켜면 가만히 있어도 무거운 색이 가라앉아 줄이 저절로 생겨요', def: false },
  gel: { label: '굳는 젤리', hint: '놓은 지 몇 초 지나면 굳어서 옆으로 흐르지 않아요 (무광으로 보임)', def: true },
  nudge: { label: '부드러운 기울이기', hint: '살짝 기울여 물을 그쪽으로 조금 흘려요. 끄면 출렁이며 무게대로 정렬하는 이전 방식', def: true },
  dropPreview: { label: '놓기 미리보기', hint: '조준하면 방울이 자리 잡을 모양(고스트)과, 이번 수로 생길 줄을 미리 보여줘요. 연쇄는 비밀', def: true },
  preview: { label: '기울이기 미리보기', hint: '기울이기 버튼을 누르고 있으면 물이 어디로 흐를지 보여요. 떼면 실행', def: true },
};
OPTS.particle = { label: '이전 입자 엔진 사용', hint: '끄면 새 칸 기반 액체(예측 가능한 흐름). 바꾸면 페이지를 다시 불러와요', def: false, reload: true };
OPTS.record = { label: '플레이 기록 (분석용)', hint: '조작과 결과를 이 컴퓨터의 logs 폴더에 저장해요. 화면 위에 ● REC 표시', def: true };
const opts = Object.fromEntries(Object.entries(OPTS).map(([k, o]) => [k, o.def]));
const liquid = createLiquidRenderer(boardCv, { W, viewTop: VIEW_TOP, viewH: VIEW_H, hexes: [null, ...E.COLORS.slice(1).map(c => c.hex), '#ffffff'] });
if (liquid && ENGINE_NAME === 'grid') liquid.setLook({ T: 1.6, D: 6.5, N: 1.1, B: 2.4, K: 1.05 }); // rounder, softer surface for the cell engine
if (!liquid) { const c = boardCv.cloneNode(); boardCv.replaceWith(c); boardCv = c; } // a canvas that tried webgl can't give 2d
const bctx = liquid ? null : boardCv.getContext('2d');
const fxCv = $('fx'), fx = fxCv.getContext('2d');
const store0 = 0;
const store = {
  get(k, d) { try { const v = localStorage.getItem('dewpop-' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('dewpop-' + k, JSON.stringify(v)); } catch {} },
};

Object.assign(opts, store.get('opts', {}));
function applyOpts() {
  E.tune({ stratBase: opts.sort ? 2.5 : 0, gel: opts.gel ? 1 : 0 });
  E.tune(opts.nudge ? { tiltMode: 'nudge' } : { tiltMode: 'slosh', sloshSide: .6, sloshWaves: .5, stratify: 6, sloshSteps: 170 });
  document.documentElement.style.setProperty('--slosh', (opts.nudge ? E.PHYS.nudgeSteps : E.PHYS.sloshSteps) / E.TPS + 's');
  document.body.classList.toggle('nudge', !!opts.nudge);
}
applyOpts();
// --- assets -----------------------------------------------------------------
const img = src => { const i = new Image(); i.src = src; return i; };
const pebbles = [0, 1, 2, 3].map(k => img(`assets/pebble${k}.png`));
const pearlImg = img('assets/pearl.png');
const bgImg = img('assets/bg.jpg');
bgImg.onload = () => { liquid?.setBackground(bgImg); layout(); };

// --- audio --------------------------------------------------------------------
let actx = null, sound = store.get('sound', true), noiseBuf = null;
function audio() {
  if (!sound) return null;
  try {
    actx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    if (!noiseBuf) { noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    return actx;
  } catch { return null; }
}
function tone(freq, dur, { type = 'sine', vol = .12, at = 0, slide = 0 } = {}) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + at, o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .008); g.gain.exponentialRampToValueAtTime(.0008, t + dur);
  o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + .05);
}
function hiss(dur, { vol = .12, from = 2500, to = 900, q = 1.2, at = 0 } = {}) {
  const a = audio(); if (!a) return;
  const t = a.currentTime + at, s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
  s.buffer = noiseBuf; f.type = 'bandpass'; f.Q.value = q; f.frequency.setValueAtTime(from, t); f.frequency.exponentialRampToValueAtTime(to, t + dur);
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + .02); g.gain.exponentialRampToValueAtTime(.0008, t + dur);
  s.connect(f).connect(g).connect(a.destination); s.start(t); s.stop(t + dur + .05);
}
// a wax "crack": a very short bright noise click (many of them = crunch)
const crack = (at = 0, vol = .09) => hiss(.03 + Math.random() * .02, { vol, from: 4200 + Math.random() * 2500, to: 2500, q: .9, at });
// a water "plip": a fast upward sine sweep
const plip = (f = 500, at = 0, vol = .14) => tone(f, .09, { vol, at, slide: 2.6 });
const sfx = {
  pick() { plip(700, 0, .06); },
  drop(size) { plip(420 - size * 70, 0, .12); },
  merge(span) { plip(600 + span * 500, 0, .1); plip(900 + span * 700, .06, .08); },
  land(size) { tone(110 - size * 15, .2, { vol: .16, slide: .6 }); hiss(.3, { vol: .06, from: 1800, to: 500 }); },
  bad() { tone(160, .14, { type: 'square', vol: .04, slide: .7 }); },
  // the line joins: bright chime at the join, a rising sweep while it charges, ticks as it hits the walls
  lock(chain, dur) {
    const b = 523 * Math.pow(2, Math.min(chain, 6) * 2 / 12);
    [0, 4, 7].forEach((n, k) => tone(b * Math.pow(2, n / 12), .5, { type: 'triangle', vol: .09, at: k * .03 }));
    tone(b / 2, dur, { type: 'sine', vol: .06, slide: 2.2 });
    hiss(dur, { vol: .05, from: 600, to: 5000, q: 1.5 });
    [.22, .24].forEach(t => tone(1500, .05, { type: 'square', vol: .03, at: t }));
    for (let k = 0; k < 9; k++) crack(Math.random() * dur * .9, .05 + Math.random() * .04); // the wax skin starts to crack
  },
  pop(chain) {
    const base = 520 * Math.pow(2, Math.min(chain - 1, 6) * 2 / 12);
    for (let k = 0; k < 16; k++) crack(Math.pow(Math.random(), 1.8) * .18, .1 + Math.random() * .08); // 바삭: the shell shatters
    for (let k = 0; k < 10; k++) plip(base * (1 + Math.random() * 1.2), k * .03 + Math.random() * .02, .1);
    hiss(.8, { vol: .14, from: 6000, to: 1200, q: .6 });
    tone(95, .45, { vol: .22, slide: .5 });
    [0, 4, 7, 12].forEach((n, k) => tone(base * 2 * Math.pow(2, n / 12), .35, { type: 'triangle', vol: .06, at: .05 + k * .05 }));
  },
  tilt() { hiss(1.1, { vol: .13, from: 400, to: 2200, q: .7 }); tone(80, .6, { vol: .1, slide: 1.4 }); },
  gain() { [0, 4, 7, 12].forEach((n, k) => tone(660 * Math.pow(2, n / 12), .2, { type: 'triangle', vol: .07, at: k * .06 })); },
  mud() { tone(70, .4, { type: 'sawtooth', vol: .05, slide: .7 }); hiss(.4, { vol: .07, from: 600, to: 200, q: 2 }); },
  pearl() { [0, 7, 12, 19].forEach((n, k) => tone(880 * Math.pow(2, n / 12), .3, { type: 'triangle', vol: .07, at: k * .05 })); },
  win() { [0, 4, 7, 12, 16].forEach((n, k) => tone(523 * Math.pow(2, n / 12), .4, { type: 'triangle', vol: .09, at: k * .09 })); },
  over() { [7, 4, 0, -5].forEach((n, k) => tone(330 * Math.pow(2, n / 12), .35, { type: 'triangle', vol: .09, at: k * .14 })); },
};
// --- haptics ------------------------------------------------------------------------
// Android: real vibration patterns. iOS Safari has no vibrate API — toggling a native switch
// (<input type=checkbox switch>, iOS 17.4+) plays the system tick, so each pulse becomes a tick there.
const hapticEl = (() => { try {
  const l = document.createElement('label'), i = document.createElement('input');
  i.type = 'checkbox'; i.setAttribute('switch', ''); l.appendChild(i);
  l.style.cssText = 'position:fixed;left:-200px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
  document.body.appendChild(l); return l;
} catch { return null; } })();
const canVibrate = typeof navigator.vibrate === 'function';
let hapticOn = store.get('haptic', true), lastBuzz = 0;
function buzz(p) {
  if (!hapticOn || REPLAY) return;
  const pat = Array.isArray(p) ? p : [p];
  if (canVibrate) { try { navigator.vibrate(pat); } catch {} return; }
  if (!hapticEl) return;
  let t = 0;
  for (let k = 0; k < pat.length; k += 2) { setTimeout(() => hapticEl.click(), t); t += pat[k] + (pat[k + 1] || 0); }
}
const HAPTIC = {
  grab: 6, detent: 3, drop: 10,
  land: size => size === 2 ? [22] : size === 1 ? [16] : [10],
  merge: [8],
  lock: [6, 30, 6, 45, 8, 35, 10, 40, 14], // crackle while the wax splits
  pop: (chain, combo) => {
    if (chain >= 2) return [8, 14, 8, 14, 30, 30, 30, 30, 70];
    const c = Math.min(combo || 1, 6), pat = [8, 14, 8, 14, 10, 20]; // crunch first
    for (let k = 0; k < c; k++) pat.push(26 + k * 6, Math.max(18, 40 - k * 5));
    if (c >= 3) pat.push(70); // 팡팡 — final thump
    return pat;
  },
  tilt: [10, 60, 20, 60, 10],
  tick: 8, bonus: [10, 30, 10], timeUp: [60, 80, 120], over: [100, 60, 100],
};

// --- layout -------------------------------------------------------------------
let unit = 14, dpr = 1, boardRect = { left: 0, top: 0, width: 0, height: 0 };
function layout() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const vw = Math.min(innerWidth, 480) - 20 - 12, vh = innerHeight;
  const r = document.documentElement.style;
  // measure the space the stage really gets (HUD, tilt row and tray differ per phone) with the board collapsed
  r.setProperty('--board-h', '0px'); r.setProperty('--board-w', vw + 'px');
  const stageH = document.querySelector('.stage').clientHeight - 22;
  unit = Math.max(6, Math.min(vw / W, (stageH > 50 ? stageH : vh - 330) / VIEW_H));
  r.setProperty('--board-w', unit * W + 'px'); r.setProperty('--board-h', unit * VIEW_H + 'px');
  r.setProperty('--tank-top', (-VIEW_TOP) * unit + 'px');
  r.setProperty('--danger-y', E.DANGER * unit + 'px');
  fxCv.width = innerWidth * dpr; fxCv.height = innerHeight * dpr;
  const bw = Math.round(unit * W * dpr), bh = Math.round(unit * VIEW_H * dpr);
  if (liquid) liquid.resize(bw, bh); else { boardCv.width = bw; boardCv.height = bh; }
  decoCv.width = bw; decoCv.height = bh;
  const prev = boardWrap.style.transform; boardWrap.style.transform = 'none';
  boardRect = boardWrap.getBoundingClientRect(); boardWrap.style.transform = prev;
  r.setProperty('--board-top', boardRect.top + 14 + 'px');
  // map canvas uv -> background-image uv (CSS cover) so the liquid refracts the real scene
  if (liquid && bgImg.naturalWidth) {
    const iw = bgImg.naturalWidth, ih = bgImg.naturalHeight, s = Math.max(innerWidth / iw, innerHeight / ih);
    const ox = (innerWidth - iw * s) / 2, oy = (innerHeight - ih * s) / 2;
    liquid.setBgMap([boardRect.width / (iw * s), boardRect.height / (ih * s), (boardRect.left - ox) / (iw * s), 1 - (boardRect.top + boardRect.height - oy) / (ih * s)]);
  }
  renderTray();
}
addEventListener('resize', () => layout());
const toScreen = (x, y) => [boardRect.left + x * unit, boardRect.top + (y - VIEW_TOP) * unit];

// --- session recorder (for play analysis + exact replays) -----------------------------
// The engine is deterministic, so recording the seed + every input at its physics step lets us
// replay a session exactly (and render it to video) later.
const REPLAY = new URLSearchParams(location.search).get('replay');
let rec = null, recDirty = 0;
const nowMs = () => Math.round(performance.now());
// play logs only go to the local dev server (server.mjs); the public build (GitHub Pages) never records
const LOG_SERVER = /^(localhost|127\.0\.0\.1|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname);
function recStart(kind, level, seed) {
  if (!opts.record || REPLAY || !LOG_SERVER) { rec = null; return; }
  rec = { id: `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, ver: 2, engine: ENGINE_NAME, startedAt: new Date().toISOString(), t0: nowMs(),
    kind, level, seed, opts: { ...opts }, phys: { ...E.PHYS }, viewport: [innerWidth, innerHeight, devicePixelRatio], ua: navigator.userAgent,
    actions: [], events: [], end: null };
  recDirty = 0; document.body.classList.add('recording');
}
function recAct(a) { if (!rec || !world) return; rec.actions.push({ step: world.steps, t: nowMs() - rec.t0, ...a }); if (++recDirty >= 6) recSave(); }
function recEvt(e) { if (!rec || !world) return; rec.events.push({ step: world.steps, t: nowMs() - rec.t0, ...e }); }
function recSave(final = false) {
  if (!rec) return; recDirty = 0;
  const body = JSON.stringify(rec);
  try { if (final && navigator.sendBeacon) navigator.sendBeacon('/api/log', new Blob([body], { type: 'application/json' })); else fetch('/api/log', { method: 'POST', body, headers: { 'content-type': 'application/json' }, keepalive: body.length < 60000 }).catch(() => {}); } catch {}
}
function recEnd(type, extra = {}) {
  if (!rec || rec.end) return;
  rec.end = { type, step: world.steps, t: nowMs() - rec.t0, score: world.score, placed: world.placed, pops: world.pops, bestChain: world.bestChain, passivePops: world.passivePops, ...extra };
  recSave(true); document.body.classList.remove('recording');
}
addEventListener('visibilitychange', () => { if (document.hidden) recSave(true); });
let lastAimLogged = null, lastAimStep = -9;

// --- game state ------------------------------------------------------------
let world = null, mode = 'title', best = store.get('best', 0), tutorial = false;
let shownScore = 0, endTimer = 0, tutStep = 0, demoT = 0;
let game = { kind: 'endless', level: 0 };
const progress = Object.assign({ unlocked: 0, stars: {} }, store.get('progress', {}));
const saveProgress = () => store.set('progress', progress);

function startGame(kind = 'endless', level = 0, seedOverride) {
  if (rec && !rec.end && world && mode === 'play') recEnd('restart');
  game = { kind, level };
  const seed = seedOverride ?? ((Date.now() ^ (level * 7919)) >>> 0);
  if (kind === 'level') {
    const def = LEVELS[level];
    world = E.createWorld(seed, levelRules(def));
    E.loadPreset(world, def.preset || {});
    E.refillTray(world);
    if (def.tray) world.tray = def.tray.map(p => ({ ...p }));
    tutorial = !!def.tutorial;
  } else if (kind === 'blitz' && E.blitzRules) { world = E.seededWorld(seed, E.blitzRules()); tutorial = false; }
  else { world = E.seededWorld(seed); tutorial = false; }
  shownScore = 0; tutStep = 0; spray.length = 0; sparks.length = 0; shards.length = 0; locks.length = 0; waves.length = 0; lastCharges = -1; sel = kind === "level" && LEVELS[level].tutorial ? 0 : 2; aim = null;
  clearTimeout(endTimer); endTimer = 0;
  ['over', 'title', 'map'].forEach(id => $(id).classList.add('hidden'));
  mode = 'play'; boardWrap.className = 'board-wrap';
  document.body.classList.toggle('level-mode', kind === 'level');
  document.body.classList.toggle('blitz-mode', kind === 'blitz');
  $('score').textContent = '0';
  renderHud(); renderGoals(); layout(); renderTray(true);
  recStart(kind, level, seed);
  if (kind === 'level') {
    const def = LEVELS[level];
    toast(`레벨 ${level + 1} · ${def.name}`, 1600);
    if (def.tip) setTimeout(() => { if (mode === 'play' && game.level === level) toast(def.tip, tutorial ? 0 : 3800); if (tutorial) showCoach(); }, 1700);
  }
}
const newGame = () => startGame(game.kind, game.level);

// --- tray ---------------------------------------------------------------------
const trayEl = $('tray');
for (let k = 0; k < 3; k++) {
  const s = document.createElement('div'); s.className = 'slot'; s.dataset.k = k;
  s.append(document.createElement('canvas')); trayEl.append(s);
  s.addEventListener('pointerdown', e => grab(e, k));
}
const hexRgb = h => [1, 3, 5].map(k => parseInt(h.slice(k, k + 2), 16));
const shade = (hex, f) => { const [r, g, b] = hexRgb(hex); const m = v => Math.max(0, Math.min(255, Math.round(f > 1 ? v + (255 - v) * (f - 1) : v * f))); return `rgb(${m(r)},${m(g)},${m(b)})`; };
// glossy droplet for the tray (same lighting model as the shader, painted in 2D)
function drawDrop(ctx, cx, cy, r, hex) {
  ctx.save();
  ctx.beginPath(); ctx.ellipse(cx, cy + r * .06, r, r * .9, 0, 0, Math.PI * 2);
  let g = ctx.createRadialGradient(cx - r * .3, cy - r * .35, r * .1, cx, cy, r * 1.05);
  g.addColorStop(0, shade(hex, 1.25)); g.addColorStop(.55, hex); g.addColorStop(1, shade(hex, .55));
  ctx.fillStyle = g; ctx.shadowColor = 'rgba(0,40,40,.35)'; ctx.shadowBlur = r * .35; ctx.shadowOffsetY = r * .18; ctx.fill();
  ctx.shadowColor = 'transparent';
  g = ctx.createRadialGradient(cx + r * .25, cy + r * .45, 0, cx + r * .25, cy + r * .45, r * .7);
  g.addColorStop(0, shade(hex, 1.45)); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fill();
  ctx.beginPath(); ctx.ellipse(cx - r * .38, cy - r * .38, r * .26, r * .14, -.6, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill();
  ctx.beginPath(); ctx.arc(cx - r * .05, cy - r * .58, r * .06, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function renderTray(enter = false, shiftFrom = -1) {
  if (!world) return;
  [...trayEl.children].forEach((slot, k) => {
    const piece = world.tray[k], cv = slot.firstChild;
    const r = slot.getBoundingClientRect(); if (!r.width) return;
    cv.width = r.width * dpr; cv.height = r.height * dpr;
    const c = cv.getContext('2d'); c.clearRect(0, 0, cv.width, cv.height);
    slot.classList.toggle('empty', !piece);
    slot.classList.toggle('sel', k === sel && !!piece);
    slot.classList.toggle('locked', !!piece && E.movesLeft(world) === 0);
    if (enter) { slot.classList.remove('enter'); void slot.offsetWidth; slot.classList.add('enter'); }
    if (shiftFrom >= 0 && k <= shiftFrom) { // conveyor: slots up to the used one slide in from the left
      slot.classList.remove('slide', 'slide-new'); void slot.offsetWidth; slot.classList.add(k === 0 ? 'slide-new' : 'slide');
    }
    if (!piece) return;
    const { w: pw, h: ph } = E.shapeSize(piece.cells);
    const cs = Math.min(cv.width / (Math.max(pw, 3) + .4), cv.height / (Math.max(ph, 2) + .5), 30 * dpr);
    const ox = (cv.width - pw * cs) / 2, oy = (cv.height - ph * cs) / 2;
    piece.cells.forEach(([x, y], j) => drawDrop(c, ox + (x + .5) * cs, oy + (y + .5) * cs, cs * .47, E.COLORS[piece.cols[j]].hex));
  });
}

// --- aiming & dropping ----------------------------------------------------------
// Grab a droplet from the tray, slide it along the top of the tank, release to drop.
let sel = -1, aim = null, held = null;
const discCache = new Map();
const disc = n => { let d = discCache.get(n); if (!d) discCache.set(n, d = E.discOffsets(n)); return d; };
function canAct() { return mode === 'play' && !world.overflow && E.movesLeft(world) > 0; }
function grab(e, k) {
  if (!canAct() || !world.tray[k]) return;
  e.preventDefault(); audio(); hideCoach();
  if (sel !== k) { sfx.pick(); recAct({ type: 'select', slot: k }); selAt = nowMs(); aimMoves = 0; }
  sel = k; held = { id: e.pointerId, y0: e.clientY, moved: false };
  aim ??= W / 2;
  renderTray(); buzz(HAPTIC.grab);
}
function aimFrom(e) {
  const p = world.tray[sel]; if (!p) return;
  aim = E.clampPieceX(p.cells, (e.clientX - boardRect.left) / unit);
  const det = Math.round(aim / 1.5); if (lastDetent != null && det !== lastDetent) buzz(HAPTIC.detent); lastDetent = det;
  if (lastAimLogged == null || Math.abs(aim - lastAimLogged) > .25) { aimMoves++; if (world.steps - lastAimStep >= 3) { recAct({ type: 'aim', x: +aim.toFixed(3) }); lastAimStep = world.steps; } lastAimLogged = aim; }
}
let selAt = 0, aimMoves = 0, lastDetent = null, landSize = 0, prevRigid = 0;
boardWrap.addEventListener('pointerdown', e => {
  if (!canAct() || sel < 0 || !world.tray[sel]) return;
  e.preventDefault(); held = { id: e.pointerId, y0: e.clientY, moved: true, board: true }; aimFrom(e);
});
addEventListener('pointermove', e => {
  if (!held || e.pointerId !== held.id || sel < 0) return;
  if (Math.abs(e.clientY - held.y0) > 12 || held.board) held.moved = true;
  if (held.moved) aimFrom(e);
}, { passive: true });
addEventListener('pointerup', e => {
  if (!held || e.pointerId !== held.id) return;
  const h = held; held = null;
  const trayTop = trayEl.getBoundingClientRect().top;
  if (h.moved && e.clientY < trayTop - 6) release();
});
addEventListener('pointercancel', () => { held = null; });
function release() {
  if (!canAct() || sel < 0 || !world.tray[sel]) return;
  const piece = world.tray[sel], k = sel, ax = aim ?? W / 2;
  const ghost = !!(dropPred?.pts && dropPred.key === aimKey);
  recAct({ type: 'drop', slot: k, x: ax, cells: piece.cells, cols: piece.cols, aimMs: nowMs() - selAt, aimMoves,
    ghostShown: ghost, predLine: ghost && dropPred.line ? dropPred.line.color : 0, tankFill: +E.fillLevel(world).toFixed(2) });
  const d = E.drop(world, k, ax);
  if (!d) { sfx.bad(); return; }
  const size = piece.cells.length > 3 ? 2 : piece.cells.length > 1 ? 1 : 0;
  sfx.drop(size); buzz(HAPTIC.drop); landSize = size; lastDetent = null;
  sel = 2; selAt = nowMs(); aimMoves = 0; // default: the oldest set (right end of the conveyor)
  if (world.tray[0]?.mud) { sfx.mud(); if (!store.get('mudTip2', false)) { store.set('mudTip2', true); setTimeout(() => toast('진흙 세트가 들어왔어요! 원하는 곳에 묻으세요. 바로 옆 줄이 터지면 씻겨 나가요', 4200), 300); } }
  renderTray(false, k);
  renderHud(); renderGoals();
  if (tutorial && tutStep === 0) toast('');
  if (game.kind === 'level' && LEVELS[game.level].charges && world.placed === 1 && !world.tilts && LEVELS[game.level].tip?.includes('기울')) pulseTilt(true);
}
addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') tilt(-1);
  if (e.key === 'ArrowRight') tilt(1);
  if (mode === 'play' && ['1', '2', '3'].includes(e.key)) { const k = +e.key - 1; if (world.tray[k]) { sel = k; aim ??= W / 2; renderTray(); } }
  if (mode === 'play' && (e.key === 'a' || e.key === 'd') && sel >= 0 && world.tray[sel]) { aim = E.clampPieceX(world.tray[sel].cells, (aim ?? W / 2) + (e.key === 'a' ? -1 : 1)); }
  if (mode === 'play' && (e.key === ' ' || e.key === 's')) { e.preventDefault(); release(); }
  if ((e.key === 'Enter' || e.key === ' ') && mode === 'title') { e.preventDefault(); $('playBtn').click(); }
});

// --- tilt -----------------------------------------------------------------------
function tilt(dir, held = 0) {
  if (mode !== 'play') return;
  const pv = preview;
  if (!E.startTilt(world, dir)) return;
  recAct({ type: 'tilt', dir, heldMs: held, previewArrows: pv?.arrows.length ?? -1, previewLine: pv?.line ? pv.line.color : 0 });
  sfx.tilt(); buzz(HAPTIC.tilt); pulseTilt(false);
  boardWrap.classList.remove('tilt-l', 'tilt-r'); boardWrap.classList.add(dir < 0 ? 'tilt-l' : 'tilt-r');
  renderHud();
}
let preview = null, pressed = null;
// --- look-ahead worker (keeps previews off the main thread) ------------------------------
let worker = null;
try { worker = new Worker('predict-worker.js', { type: 'module' }); } catch { worker = null; }
const lanes = {}; // per kind: one request in flight, newest waiting request replaces older ones
let reqSeq = 0;
function ask(kind, act, onDone) {
  if (!worker) return;
  const L = lanes[kind] ||= { busy: false, next: null };
  const job = { id: ++reqSeq, kind, act, onDone, snap: E.snapshotWorld(world) };
  if (L.busy) { L.next = job; return; }
  send(L, job);
}
function send(L, job) { L.busy = true; L.cur = job; worker.postMessage({ id: job.id, engine: ENGINE_NAME, phys: { ...E.PHYS }, snap: job.snap, act: job.act }); }
if (worker) worker.onmessage = e => {
  for (const L of Object.values(lanes)) if (L.cur && L.cur.id === e.data.id) {
    const job = L.cur; L.busy = false; L.cur = null;
    job.onDone(e.data);
    if (L.next) { const n = L.next; L.next = null; send(L, n); }
  }
};
const calmNow = () => world.meanSpeed < .012 && !world.tilt && !world.locks.length;

// drop preview: when the aim rests on a calm tank, simulate this drop (first line only)
let dropPred = null, aimKey = '', aimSince = 0, hints = null, hintKey = '';
function updateDropPred(now) {
  const p = mode === 'play' && sel >= 0 && aim != null && canAct() ? world.tray[sel] : null;
  if (!p || !opts.dropPreview) { dropPred = null; aimKey = ''; hints = null; hintKey = ''; return; }
  const calm = calmNow();
  // rim hints: where on the rim would this set complete a line? (computed once per set per calm tank)
  const hk = `${sel}|${p.cols.join('')}|${p.cells.length}|${world.placed}|${world.pops}`;
  if (!calm) { hints = null; hintKey = ''; }
  else if (hk !== hintKey) {
    hintKey = hk; hints = { key: hk, hits: null };
    const lo = E.clampPieceX(p.cells, 0), hi = E.clampPieceX(p.cells, W), xs = [];
    for (let k = 0; k <= 10; k++) xs.push(+(lo + (hi - lo) * k / 10).toFixed(2));
    ask('hints', { type: 'hints', slot: sel, xs }, r => { if (hints && hints.key === hk) hints.hits = r.hits; });
  }
  const qx = Math.round(E.clampPieceX(p.cells, aim) * 2) / 2;
  const key = `${sel}|${qx}|${world.placed}|${world.pops}`;
  if (key !== aimKey) { aimKey = key; aimSince = now; if (dropPred && dropPred.key !== key) dropPred = null; return; }
  // only predict on a calm tank: while liquid is still moving (e.g. right after a drop) hide the guide
  if (!calm) { dropPred = null; aimSince = now; return; }
  if ((dropPred && dropPred.key === key) || now - aimSince < 60 || dropPred?.waiting === key) return;
  if (!worker) { const res = E.predict(world, { type: 'drop', slot: sel, x: qx }, 200); dropPred = res && { key, line: res.line, pts: res.pts }; return; }
  dropPred = { waiting: key };
  ask('drop', { type: 'drop', slot: sel, x: qx }, r => { if (aimKey === key) dropPred = { key, line: r.line, pts: r.pts }; });
}
const ghostCv = document.createElement('canvas'), ghost = ghostCv.getContext('2d');
function drawPredLine(c, line, now) {
  const hex = E.COLORS[line.color].hex, pulse = .6 + .4 * Math.sin(now / 110);
  c.save(); c.lineCap = 'round';
  c.globalAlpha = .9 * pulse; c.strokeStyle = '#fff'; c.lineWidth = .5; c.setLineDash([.7, .45]);
  c.beginPath(); c.moveTo(E.WALL, line.y); c.lineTo(W - E.WALL, line.y); c.stroke();
  c.strokeStyle = hex; c.lineWidth = .28; c.stroke(); c.setLineDash([]);
  c.globalAlpha = 1; c.font = '700 1.1px Fredoka, sans-serif'; c.textAlign = 'right'; c.textBaseline = 'bottom';
  c.lineWidth = .25; c.strokeStyle = 'rgba(0,40,40,.8)'; c.strokeText('POP', W - .8, line.y - .5); c.fillStyle = '#fff'; c.fillText('POP', W - .8, line.y - .5);
  c.restore();
}
// tilt preview: computed by the worker (arrows + first line + ghost of the result)
function computePreview(dir) {
  if (!opts.preview || mode !== 'play' || (!E.TILT_UNLIMITED && !world.charges) || world.tilt || world.rules.noTilt) return null;
  const pv = { dir, arrows: [], line: null, pts: null, pending: true, t0: performance.now() };
  const before = (world.bodies || []).filter(b => b.drops >= 1).map(b => ({ color: b.color, cx: b.cx, cy: b.cy }));
  if (worker) ask('tilt', { type: 'tilt', dir, before }, r => { if (preview === pv) Object.assign(pv, { arrows: r.arrows, line: r.line, pts: r.pts, pending: false }); });
  else {
    const r = E.predict(world, { type: 'shake', dir }, E.PHYS.nudgeSteps + 120);
    Object.assign(pv, { line: r?.line, pts: r?.pts, pending: false });
  }
  return pv;
}
const TAP_SHOW = 450; // a quick tap still shows the preview this long before the tank tilts
for (const [id, dir] of [['tiltL', -1], ['tiltR', 1]]) {
  const b = $(id);
  // desktop: hovering the button already previews
  b.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse' && !pressed && !b.disabled && (!preview || preview.dir !== dir)) preview = computePreview(dir); });
  b.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !pressed && !preview?.firing) preview = null; });
  b.addEventListener('pointerdown', e => {
    if (b.disabled) return; try { b.setPointerCapture(e.pointerId); } catch {}
    pressed = { id: e.pointerId, dir, t: nowMs() };
    if (!preview || preview.dir !== dir) preview = computePreview(dir);
  });
  b.addEventListener('pointerup', e => {
    if (!pressed || pressed.id !== e.pointerId) return;
    const r = b.getBoundingClientRect(), inside = e.clientX >= r.left - 8 && e.clientX <= r.right + 8 && e.clientY >= r.top - 30 && e.clientY <= r.bottom + 8;
    const heldMs = nowMs() - pressed.t, pv = preview;
    pressed = null;
    if (!inside) { recAct({ type: 'tiltCancel', dir, heldMs, previewArrows: pv?.arrows.length ?? -1, previewLine: pv?.line ? pv.line.color : 0 }); preview = null; return; }
    const shownFor = pv ? performance.now() - pv.t0 : 0;
    if (pv && shownFor < TAP_SHOW) { pv.firing = true; setTimeout(() => { if (preview === pv) { tilt(dir, heldMs); preview = null; } }, TAP_SHOW - shownFor); }
    else { tilt(dir, heldMs); preview = null; }
  });
  b.addEventListener('pointercancel', () => { pressed = null; preview = null; });
}
const pulseTilt = on => ['tiltL', 'tiltR'].forEach(id => $(id).classList.toggle('pulse', on));

// --- HUD ---------------------------------------------------------------------------
const pipsEl = $('pips');
for (let k = 0; k < E.TILT_MAX; k++) { const p = document.createElement('i'); p.className = 'pip'; pipsEl.append(p); }
let lastCharges = -1;
let lastTickSec = 0;
function updateTimer() {
  const t = $('timer');
  if (!world || !world.rules.timeLimit || !E.timeLeft) { t.classList.add('hidden'); return; }
  const left = E.timeLeft(world), sec = Math.ceil(left);
  t.classList.remove('hidden'); t.classList.toggle('low', left <= 10);
  if (sec <= 5 && sec > 0 && sec !== lastTickSec) buzz(HAPTIC.tick); lastTickSec = sec;
  t.textContent = `⏱ ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
function renderHud() {
  if (!world) return;
  [...pipsEl.children].forEach((p, k) => p.classList.toggle('on', k < world.charges));
  if (lastCharges >= 0 && world.charges > lastCharges) { const p = pipsEl.children[world.charges - 1]; p.classList.remove('gain'); void p.offsetWidth; p.classList.add('gain'); }
  lastCharges = world.charges;
  $('meter').style.width = (world.charges >= E.TILT_MAX ? 100 : world.meter / E.TILT_METER * 100) + '%';
  const can = mode === 'play' && (E.TILT_UNLIMITED || world.charges > 0) && !world.tilt && !world.rules.noTilt;
  document.querySelector('.tilt-row').classList.toggle('unlimited', !!E.TILT_UNLIMITED);
  $('tiltL').disabled = $('tiltR').disabled = !can;
  const lvl = game.kind === 'level';
  $('best').textContent = lvl ? `Lv ${game.level + 1}` : Math.max(game.kind === 'blitz' ? bestBlitz : best, world.score).toLocaleString();
  $('crown').textContent = lvl ? '★' : '♛';
  if (lvl) {
    const m = E.movesLeft(world);
    $('score').textContent = m === Infinity ? world.placed : m;
    $('scoreLabel').textContent = m === Infinity ? '떨어뜨린 방울' : '남은 방울';
    $('score').classList.toggle('low', m !== Infinity && m <= 3);
  } else $('scoreLabel').textContent = 'SCORE';
  updateTimer();
  const left = E.nextMudIn(world), b = $('mudIn');
  b.classList.toggle('hidden', !left);
  b.textContent = left === 1 ? '다음에 진흙 세트!' : `진흙 세트까지 ${left}`;
  b.classList.toggle('soon', left === 1);
  const pal = E.DENSITY ? E.paletteOf(world).slice().sort((a, b) => E.DENSITY[b] - E.DENSITY[a]) : [];
  const wl = $('weights'), key = pal.join();
  if (wl.dataset.k !== key) { wl.dataset.k = key; wl.innerHTML = !pal.length ? '' : '무거움 ' + pal.map(c => `<i style="background:${E.COLORS[c].hex}"></i>`).join('') + ' 가벼움'; }
  document.querySelector('.tilt-row').classList.toggle('locked', !!world.rules.noTilt || (!E.TILT_UNLIMITED && lvl && !world.rules.charges && !world.rules.earn));
}
const ICON = {
  on: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>',
  off: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="m17 9 5 6m0-6-5 6"/></svg>',
  home: '<svg viewBox="0 0 24 24"><path d="M4 11 12 4l8 7M6 9.5V20h12V9.5"/></svg>',
};
function renderGoals() {
  const el = $('goals'); el.innerHTML = '';
  if (game.kind !== 'level' || !world) return;
  for (const g of world.rules.goals) {
    const [a, b] = E.goalProgress(world, g), done = a >= b;
    const chip = document.createElement('div'); chip.className = 'goal' + (done ? ' done' : '');
    const dot = document.createElement('i'); dot.className = 'gdot ' + g.type;
    if (g.type === 'color') dot.style.background = `radial-gradient(circle at 35% 35%, #fff8 0 12%, transparent 13%), ${E.COLORS[g.color].hex}`;
    chip.append(dot);
    const t = document.createElement('span'); t.textContent = GOAL_TEXT[g.type](g, E.COLORS); chip.append(t);
    const n = document.createElement('b');
    n.textContent = done ? '✓' : g.type === 'score' ? Math.min(a, b).toLocaleString() : g.type === 'mud' ? `${a}%` : `${Math.min(a, b)}/${b}`;
    chip.append(n); el.append(chip);
  }
}
function renderSound() { $('soundBtn').innerHTML = sound ? ICON.on : ICON.off; $('soundBtn').setAttribute('aria-label', sound ? '소리 끄기' : '소리 켜기'); }
$('soundBtn').onclick = () => { sound = !sound; store.set('sound', sound); renderSound(); if (sound) sfx.pick(); };
$('homeBtn').innerHTML = ICON.home;
$('homeBtn').onclick = () => { if (mode === 'play') { recEnd('quit'); if (game.kind !== 'level') saveBest(); game.kind === 'level' ? showMap() : showTitle(); } };

let toastTimer = 0;
function toast(msg, ms = 2600) {
  const t = $('toast'); clearTimeout(toastTimer);
  if (!msg) { t.classList.remove('show'); return; }
  t.textContent = msg; t.classList.add('show');
  if (ms) toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
function popup(text, x, y, cls = '') {
  const el = document.createElement('div'); el.className = 'pop ' + cls; el.textContent = text;
  el.style.left = x + 'px'; el.style.top = y + 'px';
  $('popups').append(el); setTimeout(() => el.remove(), 1300);
}

// --- coach hand (tutorial) ---------------------------------------------------
let coachEl = null, coachAnim = null;
function showCoach() {
  if (!tutorial || mode !== 'play' || !world.tray[0]) return;
  hideCoach();
  coachEl = document.createElement('div'); coachEl.className = 'coach'; document.body.append(coachEl);
  const s = trayEl.children[0].getBoundingClientRect();
  const from = [s.left + s.width / 2 - 14, s.top + s.height / 2 - 6];
  const [tx, ty] = toScreen(12, -3);
  const to = [tx - 14, ty];
  coachAnim = coachEl.animate([
    { transform: `translate(${from[0]}px,${from[1]}px) scale(1)`, opacity: 0 },
    { transform: `translate(${from[0]}px,${from[1]}px) scale(.9)`, opacity: 1, offset: .15 },
    { transform: `translate(${to[0]}px,${to[1]}px) scale(.9)`, opacity: 1, offset: .7 },
    { transform: `translate(${to[0]}px,${to[1]}px) scale(1)`, opacity: 0 },
  ], { duration: 1900, iterations: Infinity, easing: 'ease-in-out' });
}
function hideCoach() { coachAnim?.cancel(); coachEl?.remove(); coachEl = null; }

// --- spray (visual-only droplets, rendered by the liquid shader) ------------------
const spray = [], sparks = [], locks = [], waves = [], shards = [];
// hype words (Gen-Z slang, kept clean)
const pickOne = a => a[(Math.random() * a.length) | 0];
const HYPE = {
  merge: ['W', 'NICE', 'VALID', 'BET'],
  lock: ['SHEESH!', 'LET IT COOK!', 'NO CAP!'],
  chain: n => n >= 4 ? `UNREAL ×${n}` : n === 3 ? `GOATED ×3` : `DOUBLE W ×2`,
};
let flash = [0, 0, 0, 0];
function splash(pts, color, cx, cy, strength = 1) {
  if (reduced) return;
  const step = Math.max(1, Math.round(pts.length / 2 / 170));
  for (let k = 0; k < pts.length / 2; k += step) {
    const x = pts[k * 2], y = pts[k * 2 + 1];
    let dx = x - cx, dy = y - cy; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    const sp = (6 + Math.random() * 14) * strength;
    spray.push({ x, y, vx: dx * sp + (Math.random() - .5) * 6, vy: dy * sp * .6 - 10 - Math.random() * 12, c: color, r: .35 + Math.random() * .4, life: .55 + Math.random() * .5 });
  }
}
function sparkAt(x, y, color, n) {
  if (reduced) return;
  for (let k = 0; k < n; k++) { const a = Math.random() * 6.283, sp = 2 + Math.random() * 6; sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 2, life: 1, decay: .015 + Math.random() * .015, size: unit * (.4 + Math.random() * .6), color: Math.random() < .4 ? '#fff' : color }); }
}
function stepSpray(dt) {
  for (let k = spray.length - 1; k >= 0; k--) {
    const s = spray[k];
    s.vy += 60 * dt; s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
    if (s.x < .3 || s.x > W - .3) s.vx *= -.5, s.x = Math.max(.3, Math.min(W - .3, s.x));
    if (s.life <= 0 || s.y > H) spray.splice(k, 1);
  }
  flash[3] = Math.max(0, flash[3] - dt * 3.5); flash[2] += dt * .5;
}

// --- simulation events ------------------------------------------------------
function onEvents(events) {
  for (const ev of events) {
    if (rec) {
      if (ev.type === 'pop') recEvt({ type: 'pop', chain: ev.chain, colors: ev.groups.map(g => g.color), drops: ev.groups.map(g => Math.round(g.n / E.DROP_N)), points: ev.points, passive: ev.passive, mud: ev.mud, pearls: ev.pearls.length });
      else if (ev.type === 'lock') recEvt({ type: 'lock', color: ev.color, y: +ev.y.toFixed(2), x: +ev.x.toFixed(2) });
      else if (ev.type === 'merge') recEvt({ type: 'merge', color: ev.color, drops: ev.drops });
      else if (ev.type === 'mud') recEvt({ type: 'mud', x: +ev.x.toFixed(2) });
    }
    if (ev.type === 'lock') {
      // show the join: a light runs from the joining point to both walls, the body charges up
      const dur = ev.steps / E.TPS;
      // a jagged crack along the line (fixed per lock) plus a few short branches
      const crk = [], br = [];
      for (let x = E.WALL, y = 0; x <= W - E.WALL + .01; x += .25 + Math.random() * .7) { y = Math.max(-.5, Math.min(.5, y + (Math.random() - .5) * .55)); crk.push([x, y]); }
      for (let k = 0; k < 9; k++) br.push({ x: E.WALL + Math.random() * (W - 2 * E.WALL), a: (Math.random() < .5 ? -1 : 1) * (.5 + Math.random() * .9), l: .5 + Math.random() * 1.3 });
      locks.push({ ...ev, t0: performance.now(), dur: dur * 1000, crk, br });
      const [sx, sy] = [ev.x * unit, (ev.y - VIEW_TOP) * unit];
      popup(pickOne(HYPE.lock), sx, Math.max(30, sy - unit * 2.2), 'link');
      sfx.lock(world.chain, dur); buzz(HAPTIC.lock);
      flash = [ev.x / W, 1 - (ev.jy - VIEW_TOP) / VIEW_H, .03, .7];
      boardWrap.classList.remove('charge'); void boardWrap.offsetWidth; if (!reduced) boardWrap.classList.add('charge');
    } else if (ev.type === 'pop') {
      let cy = 0, cx = 0;
      for (const g of ev.groups) {
        splash(g.pts, g.color, g.cx, g.cy, 1.5 + Math.min(1.2, ev.chain * .3));
        cx += g.cx; cy += g.cy;
        // sparkles all along the line on the page overlay
        if (!reduced) for (let k = 0; k < 14; k++) { const i = (Math.random() * g.n) | 0; const [x, y] = toScreen(g.pts[i * 2], g.pts[i * 2 + 1]); sparkAt(x, y, E.COLORS[g.color].hex, 3); }
        waves.push({ y: g.cy, color: E.COLORS[g.color].hex, t0: performance.now() });
        if (!reduced) for (let k = 0; k < 22; k++) { // broken wax shell flies off
          const i = (Math.random() * g.n) | 0, [x, y] = toScreen(g.pts[i * 2], g.pts[i * 2 + 1]), a = -Math.PI / 2 + (Math.random() - .5) * 2.6, sp = 3 + Math.random() * 7;
          shards.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, rot: Math.random() * 6.28, vr: (Math.random() - .5) * .5, size: unit * (.35 + Math.random() * .55), color: E.COLORS[g.color].hex, life: 1, k: Math.random() });
        }
      }
      cx /= ev.groups.length; cy /= ev.groups.length;
      if (ev.mudPts.length) splash(ev.mudPts, E.MUD, cx, cy, .7);
      flash = [cx / W, 1 - (cy - VIEW_TOP) / VIEW_H, .05, .9];
      const [sx, sy] = [cx * unit, (cy - VIEW_TOP) * unit];
      popup('+' + ev.points.toLocaleString(), sx, Math.max(30, sy - unit * 2), 'big');
      boardWrap.classList.remove('charge');
      if (ev.chain >= 2) setTimeout(() => popup(HYPE.chain(ev.chain), boardRect.width / 2, Math.max(70, sy - unit * 6), 'chain'), 120);
      else if (ev.combo >= 2) {
        const c = ev.combo, word = c >= 6 ? 'UNREAL' : c >= 5 ? 'GOATED' : c >= 4 ? 'SHEESH' : c >= 3 ? 'LET IT COOK' : 'COMBO';
        setTimeout(() => popup(`${word} ×${c}`, boardRect.width / 2, Math.max(80, sy - unit * 6), c >= 3 ? `combo c${Math.min(5, c)}` : 'chain'), 100);
        if (c >= 3 && !reduced) { boardWrap.classList.remove('bigshake'); void boardWrap.offsetWidth; boardWrap.classList.add('bigshake'); sparkAt(innerWidth / 2, boardRect.top + sy, '#ffd76a', 20 + c * 8); }
      }
      if (ev.timeBonus) setTimeout(() => buzz(HAPTIC.bonus), 300);
      if (ev.timeBonus) setTimeout(() => popup(`+${ev.timeBonus}초`, boardRect.width - 40, 40, 'bonus'), 300);
      sfx.pop(Math.max(ev.chain, ev.combo || 1)); buzz(HAPTIC.pop(ev.chain, ev.combo));
      boardWrap.classList.remove('shake'); void boardWrap.offsetWidth; if (!reduced) boardWrap.classList.add('shake');
      if (ev.gained) setTimeout(() => { sfx.gain(); toast('기울이기 충전 +1', 1400); }, 450);
      if (ev.mud) setTimeout(() => popup('CLEAN!', sx, Math.min(boardRect.height - 30, sy + unit * 3)), 180);
      for (const p of ev.pearls) setTimeout(() => { sfx.pearl(); const [x, y] = toScreen(p.x, p.y); sparkAt(x, y, '#ffd6f5', 40); popup('+1 PEARL', x - boardRect.left, y - boardRect.top - unit * 2, 'pearl'); }, 150);
      if (tutorial && tutStep === 0) { tutStep = 1; toast(''); }
      renderHud(); renderGoals();
    } else if (ev.type === 'merge') {
      // instant feedback for every successful drop: the set joined its colour
      const [sx, sy] = [ev.x * unit, (ev.y - VIEW_TOP) * unit];
      popup(pickOne(HYPE.merge), sx, Math.max(30, sy - unit * 1.5), 'merge');
      sfx.merge(ev.span); buzz(HAPTIC.merge);
    } else if (ev.type === 'fizz') {
      if (!reduced) for (let k = 0; k < ev.pts.length; k += 3) spray.push({ x: ev.pts[k], y: ev.pts[k + 1], vx: (Math.random() - .5) * 2, vy: -3 - Math.random() * 3, c: ev.pts[k + 2], r: .4, life: .35 });
    } else if (ev.type === 'mud') {
      sfx.mud(); buzz(20);
      if (!store.get('mudTip', false)) { store.set('mudTip', true); setTimeout(() => toast('진흙 방울! 옆에서 터뜨리면 씻겨 나가요', 3800), 200); }
      renderHud();
    }
  }
}

function checkEnd() {
  if (mode !== 'play' || endTimer) return;
  if (world.overflow) { buzz(HAPTIC.over); endTimer = setTimeout(() => gameOver('overflow'), 300); return; }
  if (world.timeUp) { buzz(HAPTIC.timeUp); endTimer = setTimeout(() => gameOver('time'), 900); return; }
  if (game.kind !== 'level') return;
  if (E.goalsMet(world)) { endTimer = setTimeout(levelWin, 1500); return; }
  if (E.movesLeft(world) === 0 && E.settled(world) && !spray.length) endTimer = setTimeout(() => { endTimer = 0; if (E.goalsMet(world)) levelWin(); else gameOver('moves'); }, 900);
}

let bestBlitz = store.get('bestBlitz', 0);
function saveBest() {
  if (!world) return;
  if (game.kind === 'blitz') { if (world.score > bestBlitz) { bestBlitz = world.score; store.set('bestBlitz', bestBlitz); } return; }
  if (world.score > best) { best = world.score; store.set('best', best); }
}
const REASON = { overflow: '물이 넘쳤어요!', moves: '방울을 다 썼어요', time: '시간 종료!' };
function starsFor(w) {
  const m = w.rules.moves;
  if (!m) return w.charges > 0 || !w.rules.charges ? 3 : 2;
  const f = (m - w.placed) / m; return f >= .3 ? 3 : f >= .1 ? 2 : 1;
}
function fillStats() {
  $('finalScore').textContent = world.score.toLocaleString();
  $('stChain').textContent = world.bestChain; $('stPops').textContent = world.pops; $('stPlaced').textContent = world.placed;
}
function levelWin() {
  endTimer = 0; if (mode !== 'play') return;
  recEnd('win', { stars: starsFor(world) });
  mode = 'over'; hideCoach(); pulseTilt(false); toast('');
  const k = game.level, st = starsFor(world);
  progress.stars[k] = Math.max(progress.stars[k] || 0, st);
  progress.unlocked = Math.max(progress.unlocked, Math.min(LEVELS.length - 1, k + 1)); saveProgress();
  const last = k === LEVELS.length - 1;
  $('overTitle').textContent = last ? '모든 레벨 클리어!' : '레벨 클리어!';
  $('stars').innerHTML = [1, 2, 3].map(n => `<i class="star${n <= st ? ' on' : ''}" style="animation-delay:${n * .18}s">★</i>`).join('');
  fillStats(); $('newBest').classList.add('hidden');
  $('againBtn').textContent = last ? '무한 모드' : '다음 레벨'; $('againBtn').dataset.act = last ? 'endless' : 'next';
  $('mapBtn').classList.remove('hidden');
  $('over').classList.remove('hidden'); renderHud();
  sfx.win(); sparkAt(innerWidth / 2, innerHeight * .35, '#ffd76a', 80);
}
function gameOver(reason) {
  endTimer = 0; if (mode !== 'play') return;
  recEnd(reason === 'overflow' ? 'overflow' : reason === 'time' ? 'timeUp' : 'outOfMoves');
  mode = 'over'; hideCoach(); pulseTilt(false); toast('');
  $('overTitle').textContent = REASON[reason];
  $('stars').innerHTML = '';
  const prevBest = game.kind === 'blitz' ? bestBlitz : best;
  const isNew = (game.kind === 'endless' || game.kind === 'blitz') && world.score > prevBest && world.score > 0;
  if (game.kind !== 'level') saveBest();
  fillStats(); $('newBest').classList.toggle('hidden', !isNew);
  $('againBtn').textContent = '다시 하기'; $('againBtn').dataset.act = 'retry';
  $('mapBtn').classList.toggle('hidden', game.kind !== 'level');
  sfx.over(); $('over').classList.remove('hidden'); renderHud();
}
function showTitle() {
  mode = 'title'; hideCoach(); toast(''); clearTimeout(endTimer); endTimer = 0;
  $('titleBest').textContent = best.toLocaleString(); $('blitzBest').textContent = bestBlitz.toLocaleString();
  $('playLabel').textContent = `어드벤처 · Lv ${progress.unlocked + 1}`;
  ['over', 'map'].forEach(id => $(id).classList.add('hidden')); $('title').classList.remove('hidden');
  demoWorld();
}
function showMap() {
  mode = 'title'; hideCoach(); toast(''); clearTimeout(endTimer); endTimer = 0;
  const grid = $('levelGrid'); grid.innerHTML = '';
  WORLDS.forEach((name, wi) => {
    const h = document.createElement('h3'); h.textContent = `${wi + 1}. ${name}`; grid.append(h);
    const row = document.createElement('div'); row.className = 'lv-row'; grid.append(row);
    LEVELS.slice(wi * 10, wi * 10 + 10).forEach((def, j) => {
      const k = wi * 10 + j, locked = k > progress.unlocked, st = progress.stars[k] || 0;
      const b = document.createElement('button'); b.className = 'lv' + (locked ? ' locked' : '') + (k === progress.unlocked ? ' current' : '') + (def.hard ? ' hard' + def.hard : '');
      b.innerHTML = `<b>${k + 1}</b><span class="lv-stars">${'★'.repeat(st)}${'☆'.repeat(3 - st)}</span>${def.hard ? `<em>${def.hard > 1 ? '초고난도' : '고난도'}</em>` : ''}`;
      b.disabled = locked; b.setAttribute('aria-label', `레벨 ${k + 1} ${def.name}${locked ? ' 잠김' : ''}`);
      b.onclick = () => { audio(); startGame('level', k); };
      row.append(b);
    });
  });
  ['over', 'title'].forEach(id => $(id).classList.add('hidden')); $('map').classList.remove('hidden');
  if (!world || world.kind !== 'demo') demoWorld();
}
function renderOpts() {
  const el = $('optList'); el.innerHTML = '';
  for (const [k, o] of Object.entries(OPTS)) {
    if (ENGINE_NAME === 'grid' && ['sort', 'gel', 'nudge'].includes(k)) continue;
    const row = document.createElement('label'); row.className = 'opt';
    row.innerHTML = `<input type="checkbox" ${opts[k] ? 'checked' : ''}><span><b>${o.label}</b><small>${o.hint}</small></span>`;
    row.querySelector('input').onchange = e => { opts[k] = e.target.checked; store.set('opts', opts); if (o.reload) location.reload(); else applyOpts(); };
    el.append(row);
  }
}
$('playBtn').onclick = () => { audio(); progress.unlocked === 0 && !progress.stars[0] ? startGame('level', 0) : showMap(); };
$('endlessBtn').onclick = () => { audio(); startGame('endless'); };

// --- add to home screen (PWA) -----------------------------------------------------------
// Android/desktop Chrome: the browser's own install prompt. iOS Safari has no prompt, so we show
// the two taps it takes (Share → 홈 화면에 추가). Hidden once the game already runs as an app.
const standalone = ['fullscreen', 'standalone', 'minimal-ui'].some(m => matchMedia(`(display-mode: ${m})`).matches) || navigator.standalone === true;
if (standalone) document.body.classList.add('app');
// Android: a home-screen shortcut (no https → not a real install) still opens in a browser tab, so go
// full screen on the first tap. iPhone Safari has no fullscreen API; there the installed app is already full screen.
let triedFs = false;
addEventListener('pointerdown', () => {
  if (triedFs || standalone || isIOS || !/Android/.test(navigator.userAgent)) return;
  triedFs = true; document.documentElement.requestFullscreen?.({ navigationUI: 'hide' }).catch(() => {});
}, { capture: true });
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let installEvt = null;
if ('serviceWorker' in navigator && isSecureContext && !REPLAY) navigator.serviceWorker.register('sw.js').catch(() => {});
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (!standalone) $('installBtn')?.classList.remove('hidden'); });
addEventListener('appinstalled', () => { installEvt = null; $('installBtn')?.classList.add('hidden'); toast('홈 화면에 추가됐어요!', 1800); });
if (!standalone && (isIOS || /Android/.test(navigator.userAgent))) $('installBtn').classList.remove('hidden');
if (standalone) $('installBtn').classList.add('hidden');
const SHARE_ICO = '<svg viewBox="0 0 24 24"><path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1"/></svg>';
$('installBtn').onclick = async () => {
  if (installEvt) { installEvt.prompt(); const r = await installEvt.userChoice.catch(() => null); if (r?.outcome === 'accepted') $('installBtn').classList.add('hidden'); installEvt = null; return; }
  $('installSteps').innerHTML = isIOS
    ? `<li>Safari 아래(또는 위)의 <b>공유</b> 버튼 ${SHARE_ICO} 을 눌러요</li><li>목록에서 <b>홈 화면에 추가</b>를 눌러요</li><li>오른쪽 위 <b>추가</b>를 누르면 끝!</li>`
    : `<li>브라우저 오른쪽 위 <b>⋮ 메뉴</b>를 눌러요</li><li><b>홈 화면에 추가</b> 또는 <b>앱 설치</b>를 눌러요</li><li><b>추가</b>를 누르면 끝!</li>`;
  $('installHelp').classList.remove('hidden');
};
$('installClose').onclick = () => $('installHelp').classList.add('hidden');
$('blitzBtn').onclick = () => { audio(); startGame('blitz'); };
$('mapBack').onclick = () => showTitle();
$('mapBtn').onclick = () => showMap();
$('againBtn').onclick = () => {
  audio(); const act = $('againBtn').dataset.act;
  if (act === 'next') startGame('level', game.level + 1);
  else if (act === 'endless') startGame('endless');
  else newGame();
};
// a calm tank that keeps dripping behind the title screen
function demoWorld() {
  world = E.createWorld(7, { ...E.endlessRules(), mudEvery: () => 0 });
  world.kind = 'demo';
  E.loadPreset(world, { fills: [[0, 0, 8, 2, 4], [8, 0, 16, 2.5, 1], [16, 0, 24, 2, 3]], settle: 80 });
  E.refillTray(world); demoT = 0; spray.length = 0;
}

// --- render ----------------------------------------------------------------------------
let buf = new Float32Array(E.MAXP * 4 + 4000);
// round droplets drawn as stacked soft splats; a 2×2 cluster gets its middle filled (no donut hole)
let dropBubbles = [];
function dropsSplat(drops, put) {
  const R = E.dropR(E.DROP_N) * 1.9, Cl = E.CELL;
  const dr = E.dropR(E.DROP_N);
  for (const [x, y] of drops) dropBubbles.push([x - dr * .5, y - dr * .55, dr * .42, -1]);
  drops.forEach(([x, y, c], j) => { // a few bubbles per drop, placed differently in each one
    let h = (j * 7 + c * 13 + 5) % 17;
    const nb = 1 + h % 3;
    for (let k = 0; k < nb; k++) { h = (h * 11 + 7) % 23; const a = h * .9, d = .3 + (h % 5) * .16; dropBubbles.push([x + Math.cos(a) * d, y + Math.sin(a) * d + .15, .1 + (h % 4) * .05]); }
  });
  for (const [x, y, c] of drops) for (let k = 0; k < 3; k++) put(x, y, c, R);
  for (const [x, y, c] of drops) {
    const has = (dx, dy) => drops.some(d => Math.abs(d[0] - x - dx) < .2 && Math.abs(d[1] - y - dy) < .2);
    if (has(Cl, 0) && has(0, Cl) && has(Cl, Cl)) put(x + Cl / 2, y + Cl / 2, c, R * .7);
  }
}
function renderBoard(time) {
  const w = world;
  dropBubbles = []; wobT = time;
  let n = 0;
  const put = (x, y, c, r) => { buf[n++] = x; buf[n++] = y; buf[n++] = c; buf[n++] = r; };
  const P = E.PHYS, gs = P.gelEnd - P.gelStart;
  const sm = w.grid ? smoothCells(w) : null;
  if (w.rigidGroups) for (const g of w.rigidGroups) dropsSplat(g.drops.map(d => [d.x, d.y + g.dy, d.c]), put);
  for (let i = 0; i < w.n; i++) {
    if (w.rigid && w.rigid[i]) continue;
    const g = P.gel && w.c[i] !== E.MUD ? Math.max(0, Math.min(1, (w.age[i] - P.gelStart) / gs)) : 0;
    const pr = w.grid ? 0 : Math.max(w.prog[i], (1 - w.load[i]) * .75); // particle engine only: squeezed/ready glow
    put(sm ? sm[i * 2] : w.x[i], sm ? sm[i * 2 + 1] : w.y[i], w.c[i] + (w.c[i] === E.MUD ? 0 : pr * .45), SPLAT_R + 100 * Math.round(g * 8));
  }
  for (const s of spray) put(s.x, s.y, s.c, s.r * Math.min(1, s.life * 2.2));
  // the held droplet hangs above the tank
  const p = mode === 'play' && sel >= 0 ? w.tray[sel] : null;
  const rimBusy = w.rigidGroups && w.rigidGroups.some(g => { for (let i = 0; i < w.n; i++) if (w.rigid[i] && w.pid[i] === g.pid && w.y[i] < 3) return true; return false; });
  if (p && aim != null && canAct() && !rimBusy) {
    const N = E.DROP_N, d = disc(N), r = E.dropR(N), bob = Math.sin(time * 3) * .15;
    const ax = E.clampPieceX(p.cells, aim), base = E.spawnBaseY(w, p.cells, ax);
    if (w.grid) { // grid engine: each droplet as one smooth round drop (stacked splats → clean silhouette)
      dropsSplat(E.pieceLayout(p.cells).map(([dx, dy], j) => [ax + dx, base + dy + bob * .5, p.cols[j]]), put);
    } else E.pieceLayout(p.cells).forEach(([dx, dy], j) => { for (let k = 0; k < N; k++) put(ax + dx + d[k * 2] * .92, base + dy + bob * .5 + d[k * 2 + 1] * .92, p.cols[j], SPLAT_R * .8); });
  }
  const count = n / 4;
  // preview ghost (rendered as smooth liquid by the same pipeline)
  let gcount = 0;
  const gsrc = preview?.pts && mode === 'play' ? preview.pts : dropPred?.pts && mode === 'play' && sel >= 0 ? dropPred.pts : null;
  if (liquid && gsrc) {
    const g = gsrc;
    for (let k = 0; k < g.length; k += 3) put(g[k], g[k + 1], g[k + 2], SPLAT_R);
    gcount = g.length / 3;
  }
  if (liquid) liquid.draw(buf, count, time, flash, gcount);
  else draw2D(count);
  drawDeco(time, p);
  boardWrap.classList.toggle('danger', w.overT > 20);
}
// grid engine: pull each drawn cell toward the average of its occupied neighbours (7×7) — any colour,
// so free surfaces round off but colour boundaries stay pressed together (no bevel between colours).
// Stair-step corners get shaved off, so blobs read as smooth rounded jelly instead of pixel terraces.
let smBuf = null, wobT = 0, waveLast = 0;
// render-only surface waves (1D wave equation per column): landings and pops kick them, they ripple
// outward and fade over a second or two; a faint swell keeps the surface alive at rest
const waveH = new Float32Array(64), waveV = new Float32Array(64), waveTop = new Float32Array(64);
function stepWaves(w, time) {
  const C = E.COLS;
  waveTop.fill(1e9);
  for (let i = 0; i < w.n; i++) if (!w.rigid[i] && w.gy[i] < waveTop[w.gx[i]]) waveTop[w.gx[i]] = w.gy[i];
  // excitation: cells near the top that are moving (a landing set, liquid sliding off, a pop refilling)
  for (let i = 0; i < w.n; i++) { if (w.rigid[i]) continue; const c = w.gx[i]; if (w.gy[i] - waveTop[c] < 4) waveV[c] += (w.rvy[i] * .1 + Math.abs(w.rvx[i]) * .05); }
  let steps = Math.min(4, Math.max(1, Math.round((time - waveLast) * 60))); if (!waveLast || time - waveLast > 1) steps = 1; waveLast = time;
  while (steps--) {
    for (let c = 0; c < C; c++) {
      if (waveTop[c] > 1e8) { waveV[c] *= .8; waveH[c] *= .8; continue; }
      const hl = waveTop[c - 1] < 1e8 && c > 0 ? waveH[c - 1] : waveH[c], hr = waveTop[c + 1] < 1e8 && c < C - 1 ? waveH[c + 1] : waveH[c];
      waveV[c] += (hl + hr - 2 * waveH[c]) * .22 - waveH[c] * .012 + Math.sin(time * .9 + c * .28) * .0025;
      waveV[c] *= .985;
    }
    for (let c = 0; c < C; c++) waveH[c] = Math.max(-.7, Math.min(.7, waveH[c] + waveV[c]));
  }
}
function smoothCells(w) {
  const n = w.n, C = E.COLS, R = E.ROWS;
  stepWaves(w, wobT);
  if (!smBuf || smBuf.length < n * 2) smBuf = new Float32Array(E.MAXP * 2);
  for (let i = 0; i < n; i++) {
    const c = w.gx[i], r = w.gy[i];
    let sx = 0, sy = 0, k = 0;
    for (let dr = -3; dr <= 3; dr++) { const rr = r + dr; if (rr < 0 || rr >= R) continue;
      for (let dc = -3; dc <= 3; dc++) { const cc = c + dc; if (cc < 0 || cc >= C) continue;
        const j = w.grid[rr * C + cc]; if (j >= 0) { sx += w.x[j]; sy += w.y[j]; k++; } } }
    let x = k ? w.x[i] * .35 + sx / k * .65 : w.x[i], y = k ? w.y[i] * .35 + sy / k * .65 : w.y[i];
    // surface waves: strongest at the top, fading with depth; the slope pushes liquid sideways (slosh)
    if (!w.rigid[i] && waveTop[c] < 1e8) {
      const f = Math.exp(-(r - waveTop[c]) * .22), hl = waveH[Math.max(0, c - 1)], hr = waveH[Math.min(C - 1, c + 1)];
      y += waveH[c] * f; x += (hl - hr) * .9 * f;
    }
    x += Math.sin(wobT * 1.1 + y * .8) * .04; y += Math.sin(wobT * .9 + x * .7) * .035;
    smBuf[i * 2] = x; smBuf[i * 2 + 1] = y;
  }
  return smBuf;
}
function draw2D(count) {
  bctx.setTransform(1, 0, 0, 1, 0, 0); bctx.clearRect(0, 0, boardCv.width, boardCv.height);
  const s = unit * dpr;
  for (let k = 0; k < count; k++) {
    const x = buf[k * 4], y = buf[k * 4 + 1], c = buf[k * 4 + 2] | 0, rw = buf[k * 4 + 3], r = rw - 100 * Math.floor(rw / 100);
    bctx.fillStyle = c >= 7 ? '#fff' : E.COLORS[c].hex;
    bctx.beginPath(); bctx.arc(x * s, (y - VIEW_TOP) * s, r * s * .85, 0, 6.283); bctx.fill();
  }
}
function drawDeco(time, held) {
  const c = deco, s = unit * dpr;
  c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, decoCv.width, decoCv.height);
  c.setTransform(s, 0, 0, s, 0, -VIEW_TOP * s);
  const now = performance.now();
  // joined line: light runs from the join point to both walls, then the walls flash
  for (let k = locks.length - 1; k >= 0; k--) {
    const L = locks[k], live = world.locks.find(l => l.slot === L.slot);
    if (!live || mode === 'title') { locks.splice(k, 1); continue; }
    const u = Math.min(1, 1 - live.t / L.steps);
    const run = Math.min(1, u / .4), e = 1 - Math.pow(1 - run, 3);
    const x0 = L.x - (L.x - E.WALL) * e, x1 = L.x + (W - E.WALL - L.x) * e, hex = E.COLORS[L.color].hex;
    // the wax skin cracks from the join point out to both walls, then the walls flash
    const pulse = .6 + .4 * Math.sin(u * 30);
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
    const pts = L.crk.filter(([x]) => x >= x0 - .3 && x <= x1 + .3);
    const path = () => { c.beginPath(); pts.forEach(([x, dy], j) => j ? c.lineTo(x, L.y + dy) : c.moveTo(x, L.y + dy)); };
    c.globalAlpha = .35 + .15 * pulse; c.strokeStyle = hex; c.lineWidth = .45; c.shadowColor = hex; c.shadowBlur = .8; path(); c.stroke();
    c.shadowBlur = 0; c.globalAlpha = .9; c.strokeStyle = 'rgba(40,30,40,.55)'; c.lineWidth = .2; path(); c.stroke();
    c.globalAlpha = 1; c.strokeStyle = '#fff'; c.lineWidth = .11; c.translate(-.06, -.07); path(); c.stroke(); c.translate(.06, .07);
    // branches appear once the crack has passed them
    c.strokeStyle = '#fff'; c.lineWidth = .09; c.globalAlpha = .85;
    for (const b of L.br) if (b.x >= x0 && b.x <= x1) { const l = b.l * Math.min(1, u * 2.2); c.beginPath(); c.moveTo(b.x, L.y); c.lineTo(b.x + Math.cos(b.a) * l * .5, L.y + Math.sin(b.a) * l); c.stroke(); }
    // ring at the joining point
    const rr = .5 + u * 4; c.globalAlpha = Math.max(0, .9 - u); c.lineWidth = .25; c.strokeStyle = '#fff';
    c.beginPath(); c.arc(L.x, L.jy, rr, 0, 6.283); c.stroke();
    // wall hits
    if (run >= 1) {
      c.globalCompositeOperation = 'lighter';
      const h = Math.max(0, 1 - (u - .4) / .5);
      for (const wx of [0, W - .6]) { const g = c.createLinearGradient(wx, 0, wx + .6, 0); g.addColorStop(0, '#fff'); g.addColorStop(1, hex);
        c.globalAlpha = h; c.fillStyle = g; c.fillRect(wx, L.y - 2.5, .6, 5); }
    }
    c.restore();
  }
  // shake preview: coloured arrows from each body to where the shake will carry it
  if (preview && mode === 'play') {
    const pulse = .85 + .15 * Math.sin((now - preview.t0) / 120);
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round';
    for (const a of preview.arrows) {
      const ang = Math.atan2(a.y1 - a.y0, a.x1 - a.x0), hl = .9;
      const path = () => { c.beginPath(); c.moveTo(a.x0, a.y0); c.lineTo(a.x1, a.y1); c.moveTo(a.x1, a.y1); c.lineTo(a.x1 - Math.cos(ang - .5) * hl, a.y1 - Math.sin(ang - .5) * hl); c.moveTo(a.x1, a.y1); c.lineTo(a.x1 - Math.cos(ang + .5) * hl, a.y1 - Math.sin(ang + .5) * hl); };
      c.globalAlpha = pulse; c.strokeStyle = 'rgba(0,30,30,.6)'; c.lineWidth = .95; path(); c.stroke();
      c.strokeStyle = '#fff'; c.lineWidth = .7; path(); c.stroke();
      c.strokeStyle = E.COLORS[a.color].hex; c.lineWidth = .42; path(); c.stroke();
    }
    c.restore();
  }
  // rim hints: little glowing drops on the rim where this set would complete a line
  if (hints?.hits?.length && mode === 'play' && sel >= 0 && canAct()) {
    const pulse = .75 + .25 * Math.sin(now / 160);
    c.save();
    for (const [hx, col] of hints.hits) {
      c.globalAlpha = pulse; c.fillStyle = '#fff'; c.beginPath(); c.arc(hx, -.25, .55, 0, 6.283); c.fill();
      c.fillStyle = E.COLORS[col].hex; c.beginPath(); c.arc(hx, -.25, .38, 0, 6.283); c.fill();
    }
    c.restore();
  }
  // drop preview: ghost of where the liquid will settle + the line it would complete
  if (dropPred?.line && mode === 'play' && sel >= 0) drawPredLine(c, dropPred.line, now);
  if (dropPred?.pts && mode === 'play' && sel >= 0 && !liquid) {
    if (ghostCv.width !== decoCv.width || ghostCv.height !== decoCv.height) { ghostCv.width = decoCv.width; ghostCv.height = decoCv.height; }
    ghost.setTransform(1, 0, 0, 1, 0, 0); ghost.clearRect(0, 0, ghostCv.width, ghostCv.height);
    ghost.setTransform(s, 0, 0, s, 0, -VIEW_TOP * s);
    const pts = dropPred.pts;
    ghost.fillStyle = '#fff';
    for (let k = 0; k < pts.length; k += 3) { ghost.beginPath(); ghost.arc(pts[k], pts[k + 1], .8, 0, 6.283); ghost.fill(); }
    for (let k = 0; k < pts.length; k += 3) { ghost.fillStyle = E.COLORS[pts[k + 2]].hex; ghost.beginPath(); ghost.arc(pts[k], pts[k + 1], .6, 0, 6.283); ghost.fill(); }
    c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = .55 + .1 * Math.sin(now / 200); c.drawImage(ghostCv, 0, 0); c.restore();
  }
  if (preview?.line && mode === 'play') drawPredLine(c, preview.line, now);
  if (preview && !preview.pending && mode === 'play' && !preview.arrows.length && !preview.line) {
    c.save(); c.font = '600 1.15px Jua, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.lineWidth = .3; c.strokeStyle = 'rgba(0,40,40,.75)'; c.strokeText('이쪽으로는 거의 안 움직여요', W / 2, 3); c.fillStyle = '#fff'; c.fillText('이쪽으로는 거의 안 움직여요', W / 2, 3); c.restore();
  }
  // pop shock waves: a bright band spreading up and down from the popped line
  for (let k = waves.length - 1; k >= 0; k--) {
    const v = waves[k], u = (now - v.t0) / 450; if (u > 1) { waves.splice(k, 1); continue; }
    const h = 1 + u * 9; c.save(); c.globalCompositeOperation = 'lighter';
    const g = c.createLinearGradient(0, v.y - h, 0, v.y + h);
    g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(.5, `rgba(255,255,255,${.55 * (1 - u)})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g; c.fillRect(0, v.y - h, W, h * 2); c.restore();
  }
  for (const st of world.stones) {
    const im = pebbles[st.kind] || pebbles[0]; if (!im.complete || !im.naturalWidth) continue;
    const L = Math.hypot(st.bx - st.ax, st.by - st.ay), ang = Math.atan2(st.by - st.ay, st.bx - st.ax);
    c.save(); c.translate((st.ax + st.bx) / 2, (st.ay + st.by) / 2); c.rotate(ang);
    const wdt = L + st.r * 2.25, hgt = st.r * 2.25;
    c.drawImage(im, -wdt / 2, -hgt / 2 - st.r * .05, wdt, hgt); c.restore();
  }
  // little bubbles suspended deep inside the jelly (reference style: a slightly lighter translucent bead
  // with a tiny glint upper-left and a soft shade lower-right — no outlines). They ride with the liquid.
  // what floats inside the slime (왁뿌볼 style): little pearly beads and twinkling glitter flakes
  const bubble = (bx, by, r, seed = 0) => {
    if (seed < 0) { // wet highlight on a drop: a soft white tilted oval
      c.save(); c.translate(bx, by); c.rotate(-.6); c.scale(1, .55);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, r); g.addColorStop(0, 'rgba(255,255,255,.85)'); g.addColorStop(.6, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(0, 0, r, 0, 6.283); c.fill(); c.restore(); return;
    }
    const kind = seed % 3;
    if (kind === 0) { // pearly bead
      const g = c.createRadialGradient(bx - r * .35, by - r * .4, r * .05, bx, by, r);
      g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(.55, 'rgba(255,246,252,.7)'); g.addColorStop(1, 'rgba(255,255,255,.25)');
      c.fillStyle = g; c.beginPath(); c.arc(bx, by, r * .8, 0, 6.283); c.fill();
      return;
    }
    // glitter flake: a tiny four-point star that twinkles as it turns
    const tw = .5 + .5 * Math.sin(time * 3.2 + seed * 1.7), L = r * (.9 + tw * .9), w = L * .22;
    c.save(); c.translate(bx, by); c.rotate(seed * .7 + time * .3);
    c.globalAlpha = .35 + .65 * tw; c.fillStyle = kind === 1 ? '#fff' : '#fff3c4';
    c.beginPath(); c.moveTo(0, -L); c.lineTo(w, -w); c.lineTo(L, 0); c.lineTo(w, w); c.lineTo(0, L); c.lineTo(-w, w); c.lineTo(-L, 0); c.lineTo(-w, -w); c.closePath(); c.fill();
    c.restore();
  };
  dropBubbles.forEach(([bx, by, r, sd], k) => bubble(bx, by, r, sd ?? k));
  if (world.tag && world.grid) {
    const C = E.COLS, sm2 = smBuf;
    for (let i = 0; i < world.n; i++) {
      const t = world.tag[i]; if (t > 4 || world.c[i] === E.MUD || world.y[i] < 0 || world.rigid[i]) continue;
      // only inside a body (every neighbouring cell is the same colour)
      const gc = world.gx[i], gr = world.gy[i], col = world.c[i]; let inside = true;
      for (let dr = -1; dr <= 1 && inside; dr++) for (let dc = -1; dc <= 1; dc++) { const cc = gc + dc, rr = gr + dr; if (cc < 0 || cc >= C || rr >= E.ROWS) { inside = false; break; } const j = world.grid[rr * C + cc]; if (j < 0 || world.c[j] !== col) { inside = false; break; } }
      if (!inside) continue;
      bubble((sm2 ? sm2[i * 2] : world.x[i]) + Math.sin(time * .6 + i) * .18, (sm2 ? sm2[i * 2 + 1] : world.y[i]) + Math.cos(time * .5 + i * 1.7) * .14, .16 + (t % 3) * .07, t);
    }
  }
  if (pearlImg.complete && pearlImg.naturalWidth) for (const p of world.pearls) if (p.alive) {
    const k = 1 + Math.sin(time * 2.4 + p.x) * .05, r = p.r * 1.25 * k;
    c.drawImage(pearlImg, p.x - r, p.y - r, r * 2, r * 2);
  }
}
function drawFx() {
  fx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fx.clearRect(0, 0, innerWidth, innerHeight);
  for (let k = sparks.length - 1; k >= 0; k--) {
    const p = sparks[k];
    p.x += p.vx; p.y += p.vy; p.vy += .12; p.vx *= .98; p.life -= p.decay;
    if (p.life <= 0) { sparks.splice(k, 1); continue; }
    fx.globalAlpha = Math.min(1, p.life * 1.5); fx.fillStyle = p.color;
    fx.beginPath(); fx.arc(p.x, p.y, p.size * (.25 + .35 * p.life), 0, 6.283); fx.fill(); // soft round droplets, not star glitter
  }
  // wax shards: thin milky flakes tinted by their slime, tumbling as they fall
  for (let k = shards.length - 1; k >= 0; k--) {
    const p = shards[k];
    p.x += p.vx; p.y += p.vy; p.vy += .35; p.vx *= .985; p.rot += p.vr; p.life -= .014;
    if (p.life <= 0 || p.y > innerHeight + 40) { shards.splice(k, 1); continue; }
    const z = p.size, flip = Math.cos(p.rot * 1.7);
    fx.save(); fx.translate(p.x, p.y); fx.rotate(p.rot); fx.scale(1, .35 + .65 * Math.abs(flip));
    fx.globalAlpha = Math.min(1, p.life * 1.6) * .95;
    fx.beginPath(); fx.moveTo(-z, -z * .3); fx.lineTo(z * (.2 + p.k * .6), -z * .7); fx.lineTo(z, z * .4); fx.lineTo(-z * .3, z * .6); fx.closePath();
    fx.fillStyle = p.color; fx.fill();
    fx.globalAlpha *= .6; fx.fillStyle = '#fff'; fx.fill();          // milky wax over the colour
    fx.globalAlpha = Math.min(1, p.life * 1.6); fx.strokeStyle = 'rgba(255,255,255,.9)'; fx.lineWidth = 1; fx.stroke();
    fx.restore();
  }
  fx.globalAlpha = 1;
}

let acc = 0, last = performance.now(), prevTilt = null;
const MAX_STEPS = 3; // per frame; on slow devices the sim runs in slow motion instead of stuttering
function frame(now) {
  const dt = Math.min(100, now - last) * (window.__slowmo || 1); last = now; // __slowmo: debug slow motion for frame capture
  if (world) {
    if (mode === 'title' && world.kind === 'demo') {
      demoT += dt;
      if (demoT > 1300 && world.n < 1400) { demoT = 0; const k = [0, 1, 2].find(i => world.tray[i]); E.drop(world, k, 3 + Math.random() * (W - 6)); }
      if (world.n >= 1400) demoWorld();
    }
    acc += dt;
    const stepMs = 1000 / E.TPS; let n = 0;
    while (acc >= stepMs && n < MAX_STEPS) { if (replay) replayApply(); onEvents(mode === 'play' ? E.tick(world) : (E.tick(world), [])); acc -= stepMs; n++; }
    if (n === MAX_STEPS) acc = Math.min(acc, stepMs);
    const nRigid = world.rigidGroups ? world.rigidGroups.length : 0;
    if (mode === 'play' && nRigid < prevRigid) { sfx.land(landSize); buzz(HAPTIC.land(landSize)); }
    prevRigid = nRigid;
    if (prevTilt && !world.tilt) { boardWrap.classList.remove('tilt-l', 'tilt-r'); renderHud(); }
    prevTilt = world.tilt;
    stepSpray(dt / 1000);
    if (mode === 'play') updateDropPred(now);
    renderBoard(now / 1000);
    if (mode === 'play' && world.rules.timeLimit) updateTimer();
    if (game.kind !== 'level' && mode === 'play' && shownScore !== world.score) {
      const diff = world.score - shownScore; shownScore += Math.max(1, Math.ceil(diff * .18));
      if (shownScore > world.score) shownScore = world.score;
      const s = $('score'); s.textContent = shownScore.toLocaleString();
      if (diff > 40) { s.classList.add('bump'); clearTimeout(s._t); s._t = setTimeout(() => s.classList.remove('bump'), 140); }
    }
    checkEnd();
  }
  drawFx();
  requestAnimationFrame(frame);
}

// --- replay (?replay=<id>): same seed + options, inputs re-applied at their exact physics steps
let replay = null;
function replayApply() {
  if (mode !== 'play') return;
  const acts = replay.actions;
  while (replay.i < acts.length && acts[replay.i].step <= world.steps) {
    const a = acts[replay.i++];
    if (a.type === 'select') { sel = a.slot; const nd = acts.slice(replay.i).find(b => b.type === 'drop'); aim ??= nd ? nd.x : W / 2; renderTray(); }
    else if (a.type === 'aim') aim = a.x;
    else if (a.type === 'drop') { sel = a.slot; aim = a.x; release(); }
    else if (a.type === 'tilt') { preview = null; tilt(a.dir, a.heldMs); }
  }
  if (replay.i >= acts.length && !replay.done) { replay.done = true; window.__replayDone = true; }
}
async function startReplay(id) {
  const s = await (await fetch('/api/log/' + id)).json();
  const want = s.engine || 'particle';
  if (want !== ENGINE_NAME) { store.set('opts', { ...opts, ...s.opts, particle: want === 'particle', record: false }); location.reload(); return; }
  Object.assign(opts, s.opts); applyOpts(); E.tune(s.phys);
  replay = { actions: s.actions, i: 0, session: s };
  startGame(s.kind, s.level, s.seed);
  document.body.classList.add('replaying');
  window.__replay = replay;
}

// --- boot ------------------------------------------------------------------------------
renderSound();
demoWorld();
layout(); renderHud();
showTitle();
requestAnimationFrame(frame);
if (REPLAY) startReplay(REPLAY);
// debug hook for automated tests
window.__dewpop = { E, LEVELS, get world() { return world; }, get mode() { return mode; }, get game() { return game; }, startGame, tilt,
  dropAt(k, x) { sel = k; aim = x; release(); }, aimAt(k, x) { sel = k; aim = x; renderTray(); }, get preview() { return preview; }, computePreview: d => computePreview(d), layout: () => ({ boardRect, unit }), gl: !!liquid };
