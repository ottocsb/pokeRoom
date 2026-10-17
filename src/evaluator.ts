import { Card, rankLabel, Suit } from './cards';

export const CATEGORY_NAMES = [
  '高牌',
  '一对',
  '两对',
  '三条',
  '顺子',
  '同花',
  '葫芦',
  '四条',
  '同花顺',
  '皇家同花顺',
];

export const CATEGORY_HINTS = [
  '无任何组合，比最大单张',
  '两张同点数',
  '两组对子',
  '三张同点数',
  '五张连续点数',
  '五张同花色',
  '三条 + 一对',
  '四张同点数',
  '同花色的顺子',
  '10-J-Q-K-A 同花',
];

export interface HandResult {
  cat: number;
  name: string;
  desc: string;
  score: number[];
  best: Card[]; // best (up to) five cards
  core: Card[]; // cards that actually form the made hand (for highlighting)
}

const L = rankLabel;

/** Returns highest top rank of a 5-card straight in a set of ranks, or 0. */
function straightTop(ranks: Set<number>): number {
  for (let top = 14; top >= 5; top--) {
    let ok = true;
    for (let k = 0; k < 5; k++) {
      const r = top - k;
      const rr = r === 1 ? 14 : r;
      if (!ranks.has(rr)) {
        ok = false;
        break;
      }
    }
    if (ok) return top;
  }
  return 0;
}

function pickStraight(cards: Card[], top: number): Card[] {
  const out: Card[] = [];
  for (let k = 0; k < 5; k++) {
    const r = top - k === 1 ? 14 : top - k;
    out.push(cards.find((c) => c.r === r)!);
  }
  return out;
}

/** Evaluate any 1..7 cards; picks the best 5-card (or fewer) hand. */
export function evaluate(cards: Card[]): HandResult {
  const sorted = [...cards].sort((a, b) => b.r - a.r);
  const bySuit = new Map<Suit, Card[]>();
  const byRank = new Map<number, Card[]>();
  for (const c of sorted) {
    if (!bySuit.has(c.s)) bySuit.set(c.s, []);
    bySuit.get(c.s)!.push(c);
    if (!byRank.has(c.r)) byRank.set(c.r, []);
    byRank.get(c.r)!.push(c);
  }

  // straight flush
  let flushCards: Card[] | null = null;
  for (const list of bySuit.values()) if (list.length >= 5) flushCards = list;
  if (flushCards) {
    const top = straightTop(new Set(flushCards.map((c) => c.r)));
    if (top) {
      const best = pickStraight(flushCards, top);
      const royal = top === 14;
      return {
        cat: royal ? 9 : 8,
        name: royal ? '皇家同花顺' : '同花顺',
        desc: royal ? '皇家同花顺' : `同花顺（${L(top)} 高）`,
        score: [royal ? 9 : 8, top],
        best,
        core: best,
      };
    }
  }

  const groups = [...byRank.entries()]
    .map(([r, cs]) => ({ r, cs }))
    .sort((a, b) => b.cs.length - a.cs.length || b.r - a.r);

  const kickers = (exclude: Card[], n: number) =>
    sorted.filter((c) => !exclude.includes(c)).slice(0, Math.max(0, n));

  const g0 = groups[0];
  const g1 = groups[1];

  if (g0 && g0.cs.length === 4) {
    const k = kickers(g0.cs, 1);
    return {
      cat: 7,
      name: '四条',
      desc: `四条 ${L(g0.r)}`,
      score: [7, g0.r, ...k.map((c) => c.r)],
      best: [...g0.cs, ...k],
      core: g0.cs,
    };
  }

  if (g0 && g0.cs.length === 3) {
    const pair = groups.slice(1).find((g) => g.cs.length >= 2);
    if (pair) {
      const best = [...g0.cs, ...pair.cs.slice(0, 2)];
      return {
        cat: 6,
        name: '葫芦',
        desc: `葫芦（${L(g0.r)} 带 ${L(pair.r)}）`,
        score: [6, g0.r, pair.r],
        best,
        core: best,
      };
    }
  }

  if (flushCards) {
    const best = flushCards.slice(0, 5);
    return {
      cat: 5,
      name: '同花',
      desc: `同花（${L(best[0].r)} 高）`,
      score: [5, ...best.map((c) => c.r)],
      best,
      core: best,
    };
  }

  const top = straightTop(new Set(sorted.map((c) => c.r)));
  if (top) {
    const best = pickStraight(sorted, top);
    return {
      cat: 4,
      name: '顺子',
      desc: `顺子（${L(top)} 高）`,
      score: [4, top],
      best,
      core: best,
    };
  }

  if (g0 && g0.cs.length === 3) {
    const k = kickers(g0.cs, 2);
    return {
      cat: 3,
      name: '三条',
      desc: `三条 ${L(g0.r)}`,
      score: [3, g0.r, ...k.map((c) => c.r)],
      best: [...g0.cs, ...k],
      core: g0.cs,
    };
  }

  if (g0 && g0.cs.length === 2 && g1 && g1.cs.length === 2) {
    const core = [...g0.cs, ...g1.cs];
    const k = kickers(core, 1);
    return {
      cat: 2,
      name: '两对',
      desc: `两对（${L(g0.r)} 和 ${L(g1.r)}）`,
      score: [2, g0.r, g1.r, ...k.map((c) => c.r)],
      best: [...core, ...k],
      core,
    };
  }

  if (g0 && g0.cs.length === 2) {
    const k = kickers(g0.cs, 3);
    return {
      cat: 1,
      name: '一对',
      desc: `一对 ${L(g0.r)}`,
      score: [1, g0.r, ...k.map((c) => c.r)],
      best: [...g0.cs, ...k],
      core: g0.cs,
    };
  }

  const best = sorted.slice(0, 5);
  return {
    cat: 0,
    name: '高牌',
    desc: best.length ? `高牌 ${L(best[0].r)}` : '—',
    score: [0, ...best.map((c) => c.r)],
    best,
    core: best.slice(0, 1),
  };
}

export function compareScore(a: number[], b: number[]): number {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** Describe draws (flush / straight) that involve at least one hole card. */
export function describeDraws(hole: Card[], board: Card[]): string[] {
  if (board.length < 3 || board.length > 4) return [];
  const all = [...hole, ...board];
  const made = evaluate(all);
  const out: string[] = [];
  if (made.cat < 5) {
    const counts = new Map<Suit, number>();
    for (const c of all) counts.set(c.s, (counts.get(c.s) ?? 0) + 1);
    for (const [s, n] of counts) {
      if (n === 4 && hole.some((c) => c.s === s)) out.push('同花听牌');
    }
  }
  if (made.cat < 4) {
    const ranks = new Set(all.map((c) => c.r));
    const boardRanks = new Set(board.map((c) => c.r));
    let outsRanks = 0;
    for (let r = 2; r <= 14; r++) {
      if (ranks.has(r)) continue;
      const withNew = new Set(ranks);
      withNew.add(r);
      const t = straightTop(withNew);
      if (!t) continue;
      const bWith = new Set(boardRanks);
      bWith.add(r);
      if (straightTop(bWith) === t) continue; // board-only straight
      outsRanks++;
    }
    if (outsRanks >= 2) out.push('两头顺听牌');
    else if (outsRanks === 1) out.push('卡顺听牌');
  }
  return out;
}

/** Short label for two hole cards before the flop. */
export function describeHole(hole: Card[]): string {
  if (hole.length < 2) return '';
  const [a, b] = [...hole].sort((x, y) => y.r - x.r);
  if (a.r === b.r) return `口袋对子 ${L(a.r)}`;
  const suited = a.s === b.s ? '同花' : '杂色';
  return `${L(a.r)}${L(b.r)} ${suited}`;
}
