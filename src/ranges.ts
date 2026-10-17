// Preflop reference ranges (approx. GTO, 100BB cash, 2.5x open) and table positions.
import type { Card } from './cards';
import type { Player } from './game';

export const RANKS = 'AKQJT98765432';

/** RFI charts by seats before the button (0 = BTN, 1 = CO ... 6 = 9-max UTG) */
const RFI = [
  '22+,A2s+,K2s+,Q4s+,J6s+,T6s+,96s+,85s+,75s+,64s+,54s,A4o+,K9o+,Q9o+,J9o+,T9o',
  '22+,A2s+,K6s+,Q8s+,J8s+,T8s+,97s+,87s,76s,65s,54s,A8o+,KTo+,QTo+,JTo',
  '22+,A2s+,K8s+,Q9s+,J9s+,T8s+,98s,87s,76s,65s,ATo+,KJo+,QJo',
  '33+,A2s+,K9s+,Q9s+,J9s+,T9s,98s,87s,76s,AJo+,KQo',
  '44+,A3s+,K9s+,QTs+,JTs,T9s,98s,AJo+,KQo',
  '55+,A7s+,A5s-A4s,KTs+,QTs+,JTs,T9s,AJo+,KQo',
  '66+,A8s+,A5s,KTs+,QTs+,JTs,AJo+,KQo',
];
/** SB when folded to: raise or complete (limp) */
const SB_RAISE = '77+,A8s+,A5s-A3s,KTs+,QTs+,JTs,ATo+,KJo+,K5s-K2s,Q6s-Q5s,J6s,T6s';
const SB_CALL = '22+,A2s+,K2s+,Q2s+,J2s+,T4s+,95s+,84s+,74s+,63s+,53s+,43s,A2o+,K5o+,Q8o+,J8o+,T8o+,97o+,87o,76o,65o';
/** BB facing a BTN open */
const BB_RAISE = 'TT+,AJs+,KQs,A5s-A2s,K8s-K6s,Q9s,J9s,T8s,97s,86s,65s,AJo+,KQo';
const BB_CALL = '22+,A2s+,K2s+,Q2s+,J2s+,T4s+,95s+,84s+,73s+,63s+,52s+,42s+,32s,A2o+,K4o+,Q7o+,J7o+,T7o+,97o+,86o+,76o,65o,54o';

export interface Chart {
  raise: Set<string>;
  call: Set<string>;
  note: string;
}

/** "22+,A2s+,A5s-A3s,KQo" -> {'22','33',...,'A2s',...} */
function parse(s: string): Set<string> {
  const out = new Set<string>();
  const r = (c: string) => RANKS.indexOf(c);
  for (const tok of s.split(',')) {
    if (!tok) continue;
    const [a, b] = tok.split('-');
    const hi = r(a[0]);
    const lo = r(a[1]);
    const sfx = a[2] && a[2] !== '+' ? a[2] : '';
    if (hi === lo) {
      // pairs: 77+ = 77..AA
      const end = a.endsWith('+') ? 0 : lo;
      for (let i = lo; i >= end; i--) out.add(RANKS[i] + RANKS[i]);
      continue;
    }
    // A2s+ = A2s..AKs, A5s-A3s = A5s..A3s
    const from = b ? r(b[1]) : lo;
    const to = b ? lo : a.endsWith('+') ? hi + 1 : lo;
    for (let i = from; i >= to; i--) out.add(RANKS[hi] + RANKS[i] + sfx);
  }
  return out;
}

const cache = new Map<string, Chart>();
function chart(raise: string, call: string, note: string): Chart {
  const key = raise + '|' + call;
  if (!cache.has(key)) cache.set(key, { raise: parse(raise), call: parse(call), note });
  return cache.get(key)!;
}

export interface Position {
  name: string;
  chart: Chart;
}

/** position names from the SB round to the BTN, for n players dealt in (n >= 3) */
const MIDDLE: Record<number, string[]> = {
  3: [],
  4: ['CO'],
  5: ['HJ', 'CO'],
  6: ['UTG', 'HJ', 'CO'],
  7: ['UTG', 'LJ', 'HJ', 'CO'],
  8: ['UTG', 'UTG+1', 'LJ', 'HJ', 'CO'],
  9: ['UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO'],
};

/** all positions at an n-handed table, in acting order (UTG ... BTN, SB, BB) */
export function positionList(n: number): Position[] {
  const rfi = (d: number, name: string) => ({ name, chart: chart(RFI[Math.min(d, 6)], '', '前面全部弃牌时的开池范围') });
  const sb = { name: 'SB', chart: chart(SB_RAISE, SB_CALL, '前面全部弃牌时，加注或补盲平跟') };
  const bb = { name: 'BB', chart: chart(BB_RAISE, BB_CALL, '面对 BTN 开池 2.5BB 的防守范围') };
  if (n <= 2) return [rfi(0, 'BTN'), bb];
  const mid = MIDDLE[Math.min(n, 9)];
  return [...mid.map((m, k) => rfi(mid.length - k, m)), rfi(0, 'BTN'), sb, bb];
}

/** seat id -> position name for the hand in play (empty when no hand has been dealt) */
export function seatPositions(players: Player[], dealer: number): Map<number, string> {
  const res = new Map<number, string>();
  const n = players.length;
  if (dealer < 0 || !players[dealer]?.hole.length) return res;
  // seats dealt in, starting left of the button and ending on it
  const seats: number[] = [];
  for (let k = 1; k <= n; k++) {
    const i = (dealer + k) % n;
    if (!players[i].empty && players[i].hole.length) seats.push(i);
  }
  if (seats.length < 2) return res;
  if (seats.length === 2) {
    // heads-up: the button posts the small blind
    res.set(dealer, 'BTN');
    res.set(seats[0], 'BB');
    return res;
  }
  const names = ['SB', 'BB', ...MIDDLE[Math.min(seats.length, 9)], 'BTN'];
  seats.forEach((s, k) => res.set(s, names[k]));
  return res;
}

/** grid cell name of two hole cards, e.g. 'AKs', 'T9o', '77' */
export function handName(hole: Card[]): string {
  const [a, b] = hole[0].r >= hole[1].r ? hole : [hole[1], hole[0]];
  const ra = RANKS[14 - a.r];
  const rb = RANKS[14 - b.r];
  return a.r === b.r ? ra + rb : ra + rb + (a.s === b.s ? 's' : 'o');
}
