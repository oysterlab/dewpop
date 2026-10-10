// Play-session analysis: node analyze.mjs [id ...]  (default: all logs)  → prints per-session + aggregate metrics, writes logs/analysis.json
import fs from 'node:fs';
const TPS = 120;
let files = process.argv.slice(2).map(id => `logs/${id}.json`);
if (!files.length) files = fs.readdirSync('logs').filter(f => /^s.*\.json$/.test(f)).map(f => 'logs/' + f);
const sessions = files.map(f => JSON.parse(fs.readFileSync(f))).filter(s => s.actions.length).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; };
const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '-';
const out = [];
for (const s of sessions) {
  const drops = s.actions.filter(a => a.type === 'drop'), tilts = s.actions.filter(a => a.type === 'tilt'), cancels = s.actions.filter(a => a.type === 'tiltCancel');
  const pops = s.events.filter(e => e.type === 'pop'), merges = s.events.filter(e => e.type === 'merge');
  const end = s.end || { type: 'unfinished', t: s.actions.at(-1)?.t ?? 0 };
  // per drop: did a line follow within ~4 s (attributed to that drop)?
  const dropInfo = drops.map((d, i) => {
    const next = drops[i + 1]?.step ?? Infinity;
    const p = pops.filter(e => e.step > d.step && e.step < Math.min(next, d.step + 4 * TPS));
    return { ...d, popped: p.length > 0, chain: Math.max(0, ...p.map(e => e.chain)) };
  });
  const gaps = drops.slice(1).map((d, i) => (d.t - drops[i].t) / 1000);
  // droughts: longest run of drops without any line
  let run = 0, drought = 0; for (const d of dropInfo) { run = d.popped ? 0 : run + 1; drought = Math.max(drought, run); }
  const predicted = dropInfo.filter(d => d.predLine);
  const r = {
    id: s.id, mode: s.kind === 'level' ? `Lv${s.level + 1}` : 'endless', when: s.startedAt.slice(0, 16), end: end.type,
    minutes: +(end.t / 60000).toFixed(1), drops: drops.length, lines: pops.length, linesPerDrop: +(pops.length / Math.max(1, drops.length)).toFixed(2),
    bestChain: Math.max(0, ...pops.map(e => e.chain)), passiveLines: pct(pops.filter(e => e.passive).length, pops.length),
    firstLineAtDrop: dropInfo.findIndex(d => d.popped) + 1 || null, longestDrought: drought,
    secPerDrop: med(gaps), slowDrops: gaps.filter(g => g > 8).length,
    aimSecMedian: med(drops.map(d => d.aimMs / 1000)), aimMovesMedian: med(drops.map(d => d.aimMoves)),
    ghostSeenAtRelease: pct(drops.filter(d => d.ghostShown).length, drops.length),
    predictedLineDrops: predicted.length, predictedThenPopped: pct(predicted.filter(d => d.popped).length, predicted.length),
    poppedWithoutPrediction: dropInfo.filter(d => d.popped && !d.predLine).length,
    merges: merges.length, mergesPerDrop: +(merges.length / Math.max(1, drops.length)).toFixed(2),
    tilts: tilts.length, tiltCancels: cancels.length, tiltHoldMsMedian: med([...tilts, ...cancels].map(t => t.heldMs)),
    tiltsWithPredictedLine: tilts.filter(t => t.previewLine).length, tiltNoMovePreview: tilts.filter(t => t.previewArrows === 0).length,
    fillAtLastDrop: drops.at(-1)?.tankFill ?? null, score: end.score ?? null,
    xSpread: (() => { const h = new Array(6).fill(0); for (const d of drops) h[Math.min(5, Math.floor(d.x / 4))]++; return h.join('/'); })(),
  };
  out.push(r);
}
for (const r of out) console.log(JSON.stringify(r));
if (out.length > 1) {
  const sum = k => out.reduce((a, r) => a + (r[k] || 0), 0);
  console.log('\nTOTAL', JSON.stringify({ sessions: out.length, minutes: +sum('minutes').toFixed(1), drops: sum('drops'), lines: sum('lines'),
    linesPerDrop: +(sum('lines') / Math.max(1, sum('drops'))).toFixed(2), tilts: sum('tilts'), tiltCancels: sum('tiltCancels'),
    ends: out.reduce((m, r) => (m[r.end] = (m[r.end] || 0) + 1, m), {}) }));
}
fs.mkdirSync('recordings', { recursive: true }); fs.writeFileSync('recordings/analysis.json', JSON.stringify(out, null, 1));
