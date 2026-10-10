// level clear rates with the headless bots: node balance-levels.mjs [from] [to] [runs]
import * as EP from './dist/engine.js';
import * as EG from './dist/engine-grid.js';
const E = process.env.ENGINE === 'particle' ? EP : EG;
import { LEVELS, levelRules } from './dist/levels.js';
import { play } from './sim.mjs';
const [from = 1, to = LEVELS.length, runs = 6] = process.argv.slice(2).map(Number);
for (let k = from - 1; k < to; k++) {
  const def = LEVELS[k]; if (def.tutorial) continue;
  const res = { level: k + 1, name: def.name, hard: def.hard || 0, moves: def.moves };
  for (const smart of [true, false]) {
    let win = 0; const used = [];
    for (let r = 0; r < runs; r++) {
      const cap = def.moves || 60; // unlimited levels: play on until the goals are met or the tank overflows
      const o = play(1000 + r * 31 + k, { smart, cap, rules: levelRules(def), preset: def.preset });
      if (E.goalsMet(o.w)) win++; used.push(o.placed);
    }
    res[smart ? 'smart' : 'random'] = Math.round(win / runs * 100);
    if (smart) res.used = used.join(',');
  }
  console.log(JSON.stringify(res));
}
