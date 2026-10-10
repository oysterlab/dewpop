// Adventure levels. Sawtooth difficulty (teach each new element over 2–3 boards,
// hard at x5/x9, super-hard at x10, easy breather right after).
// Tank is 24 wide × 36 tall; preset y is measured UP from the floor.
//   fills:  [x0, y0, x1, y1, colour]      (colour 6 = mud)
//   stones: [ax, ay, bx, by, radius, sprite]  capsule; sprite 0 round · 1 wide · 2 tall · 3 egg
//   pearls: [x, y]
const R = 1, Y = 2, Gn = 3, B = 4, P = 5, M = 6;
export const WORLDS = ['이슬 정원', '이끼 계곡'];

export const LEVELS = [
  // ── World 1: 이슬 정원 ────────────────────────────────────────────
  { name: '첫 방울', tutorial: true, goals: [{ type: 'pops', n: 1 }], moves: 0, palette: [R, B], charges: 0,
    preset: { fills: [[0, 0, 8.5, 1.5, R], [15.5, 0, 24, 1.5, R]] }, tray: [{ cells: [[0, 0], [1, 0], [0, 1], [1, 1]], cols: [R, R, R, R] }, { cells: [[0, 0], [1, 0]], cols: [B, B] }, { cells: [[0, 0], [1, 0], [2, 0]], cols: [R, R, R] }],
    tip: '코랄 방울을 가운데 빈 곳에 놓아 양쪽 벽까지 이어 보세요' },
  { name: '다리 놓기', goals: [{ type: 'pops', n: 2 }], moves: 10, palette: [R, B], charges: 0, mix: .1,
    preset: { fills: [[0, 0, 8, 1.6, R], [8, 0, 16, 1.6, B], [16, 0, 24, 1.6, R], [0, 1.6, 7, 3, B], [17, 1.6, 24, 3, B]] },
    tip: '같은 색이 왼쪽 벽부터 오른쪽 벽까지 이어지면 팡!' },
  { name: '레몬 모으기', goals: [{ type: 'color', color: Y, n: 2 }], moves: 16, palette: [R, Y, Gn], charges: 0, mix: .1,
    preset: { fills: [[0, 0, 10, 1.6, Y], [10, 0, 24, 1.6, Gn], [14, 1.6, 24, 3, Y], [0, 1.6, 8, 3, R]] }, tip: '코랄이 가장 무겁고 포도가 가장 가벼워요. 무거운 색은 아래로 모여요' },
  { name: '눌러 펴기', goals: [{ type: 'pops', n: 2 }], moves: 8, palette: [Gn, B, P], charges: 0, mix: .1,
    preset: { fills: [[2.5, 0, 21.5, 1.4, Gn], [3, 1.4, 21, 2.8, B]] }, tip: '물은 위에서 누르면 옆으로 퍼져요. 위에 방울을 얹어 보세요' },
  { name: '기울여 봐', goals: [{ type: 'pops', n: 2 }], moves: 8, palette: [R, Gn, B], charges: 2, mix: .1,
    preset: { fills: [[0, 0, 15, 1.6, R], [15, 0, 24, 1.6, B], [9, 1.6, 24, 3, Gn]] }, tip: '◀ ▶ 를 누르면 수조가 살짝 기울어 물이 그쪽으로 흘러요. 버튼을 누르고 있으면 미리 보여요' },
  { name: '진흙 씻기', goals: [{ type: 'mud', pct: 50 }], moves: 12, palette: [R, Y, B], charges: 1, mix: .15,
    preset: { fills: [[0, 0, 24, 1.6, M], [0, 1.6, 10, 2.8, Y], [14, 1.6, 24, 2.8, Y]] }, tip: '진흙 바로 위의 색을 터뜨리면 진흙이 씻겨 나가요' },
  { name: '돌 사이로', goals: [{ type: 'pops', n: 2 }], moves: 12, palette: [R, Y, Gn], charges: 1, mix: .15,
    preset: { stones: [[6, 7, 6, 7, 1.8, 0], [18, 7, 18, 7, 1.8, 0]], fills: [[0, 0, 9, 1.6, Gn], [15, 0, 24, 1.6, Gn], [9, 0, 15, 1.6, R]] }, tip: '물은 돌을 타고 흘러내려요' },
  { name: '진주 찾기', goals: [{ type: 'pearls', n: 2 }], moves: 9, palette: [R, Gn, B], charges: 1, mix: .15,
    preset: { pearls: [[5, 3.6], [19, 3.6]], fills: [[0, 0, 9, 1.8, B], [15, 0, 24, 1.8, B], [9, 0, 15, 1.8, R]] },
    tip: '진주 바로 아래 색을 터뜨리면 진주를 얻어요' },
  { name: '연쇄의 맛', goals: [{ type: 'score', n: 40000 }], moves: 16, colors: 3, charges: 1, hard: 1, mix: .2,
    preset: { fills: [[0, 0, 7, 1.4, Gn], [17, 0, 24, 1.4, Gn], [7, 0, 17, 1.4, B], [0, 1.4, 6, 2.8, B], [18, 1.4, 24, 2.8, B], [6, 1.4, 18, 2.8, R]] }, tip: '아래 줄이 터지면 위가 내려와 또 이어질 수 있어요' },
  { name: '정원의 보물', goals: [{ type: 'pearls', n: 2 }, { type: 'mud', pct: 80 }], moves: 8, colors: 3, charges: 1, hard: 2, mudEvery: 6, mix: .2,
    preset: { fills: [[0, 0, 24, 1.5, M], [0, 1.5, 8, 2.8, R], [16, 1.5, 24, 2.8, R]], stones: [[12, 9, 12, 9, 1.8, 0]], pearls: [[7, 3.4], [12, 3.2]] },
    tip: '몇 수마다 진흙 방울이 떨어져요!' },

  // ── World 2: 이끼 계곡 ────────────────────────────────────────────
  { name: '계곡 입구', goals: [{ type: 'pops', n: 2 }], moves: 16, palette: [Y, Gn, P], charges: 2, mix: .1,
    preset: { fills: [[0, 0, 9, 1.8, Gn], [15, 0, 24, 1.8, Gn], [9, 0, 15, 1.8, P]] } },
  { name: '버티기', goals: [{ type: 'survive', n: 30 }], moves: 0, colors: 3, charges: 1, earn: true, mudEvery: 6, mix: .2,
    preset: { fills: [[0, 0, 24, 1.2, M]] }, tip: '30번 놓는 동안 넘치지 않게 버티세요' },
  { name: '깔때기', goals: [{ type: 'color', color: B, n: 1 }, { type: 'mud', pct: 30 }], moves: 14, palette: [R, Y, B], charges: 1, mix: .15,
    preset: { stones: [[0, 13, 7, 9, 1.2, 1], [24, 13, 17, 9, 1.2, 1]], fills: [[0, 0, 24, 1.5, M], [0, 1.5, 9, 2.8, B], [15, 1.5, 24, 2.8, B]] } },
  { name: '손으로만', goals: [{ type: 'pops', n: 2 }], moves: 12, colors: 3, noTilt: true, charges: 0, mix: .15,
    preset: { fills: [[0, 0, 8, 1.6, R], [8, 0, 16, 1.6, Y], [16, 0, 24, 1.6, R]] }, tip: '이번엔 기울이기 금지!' },
  { name: '큰 물줄기', goals: [{ type: 'score', n: 62000 }], moves: 20, colors: 3, charges: 1, hard: 1, big: 2, mix: .2,
    preset: { fills: [[0, 0, 8, 1.6, B], [8, 0, 16, 1.6, Y], [16, 0, 24, 1.6, B]] }, tip: '큰 세트로 넓게 한 번에!' },
  { name: '바위 위 진주', goals: [{ type: 'pearls', n: 2 }], moves: 14, colors: 3, charges: 1, mix: .2,
    preset: { stones: [[4, 6, 4, 6, 1.6, 2], [20, 6, 20, 6, 1.6, 2]], pearls: [[4, 8.6], [20, 8.6]], fills: [[0, 0, 24, 1.2, M]] } },
  { name: '미로', goals: [{ type: 'pops', n: 2 }], moves: 14, palette: [R, Gn, P], charges: 1, mix: .15,
    preset: { stones: [[2, 14, 9, 14, 1.1, 1], [15, 14, 22, 14, 1.1, 1], [7, 8.5, 17, 8.5, 1.1, 1]], fills: [[0, 0, 10, 1.6, P], [14, 0, 24, 1.6, P], [10, 0, 14, 1.6, Gn]] } },
  { name: '거센 물살', goals: [{ type: 'survive', n: 42 }], moves: 0, colors: 4, charges: 1, earn: true, mudEvery: 5, hard: 1, mix: .3,
    preset: { fills: [[0, 0, 24, 1.2, M]] } },
  { name: '세 번의 팡', goals: [{ type: 'pops', n: 3 }], moves: 22, colors: 3, charges: 1, mix: .2,
    preset: { fills: [[0, 0, 6, 1.6, P], [6, 0, 12, 1.6, Gn], [12, 0, 18, 1.6, Y], [18, 0, 24, 1.6, P]] } },
  { name: '계곡의 심장', goals: [{ type: 'pearls', n: 3 }, { type: 'survive', n: 34 }], moves: 0, colors: 4, charges: 1, hard: 2, mudEvery: 5, earn: true, mix: .3,
    preset: { stones: [[12, 8, 12, 8, 1.8, 0]], fills: [[0, 0, 24, 1.5, M]], pearls: [[6, 2.6], [18, 2.6], [12, 10.6]] } },
];

export function levelRules(def) {
  const colors = def.palette ? def.palette.length : def.colors || 4;
  return {
    kind: 'level', charges: def.charges ?? 1, earn: !!def.earn, moves: def.moves || 0, goals: def.goals,
    noTilt: !!def.noTilt, palette: def.palette || null,
    colorsAt: () => colors, bigAt: () => def.big ?? 1, mixAt: () => def.mix ?? .35, mudEvery: () => def.mudEvery || 0,
  };
}

export const GOAL_TEXT = {
  pops: g => `${g.n}줄 팡`,
  color: (g, COLORS) => `${COLORS[g.color].name} ${g.n}줄 팡`,
  mud: g => `진흙 ${g.pct}% 씻기`,
  pearls: g => `진주 ${g.n}개`,
  score: g => `${g.n.toLocaleString()}점`,
  survive: g => `${g.n}번 버티기`,
};
