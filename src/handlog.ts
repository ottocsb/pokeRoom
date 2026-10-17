// Formatting helpers for recorded betting actions (hand history + live action line).
import type { Card } from './cards';
import type { HandAction } from './protocol';
import { money } from './store';

const STREETS: Array<[HandAction['street'], string, number, number]> = [
  ['preflop', '翻牌前', 0, 0],
  ['flop', '翻牌', 0, 3],
  ['turn', '转牌', 3, 4],
  ['river', '河牌', 4, 5],
];

export function actText(a: HandAction) {
  const t = {
    sb: `小盲 ${money(a.amount)}`,
    bb: `大盲 ${money(a.amount)}`,
    fold: '弃牌',
    check: '过牌',
    call: `跟注 ${money(a.amount)}`,
    bet: `下注 ${money(a.to)}`,
    raise: `加注到 ${money(a.to)}`,
  }[a.act];
  return a.allIn ? `${t}（全下）` : t;
}

/** Actions grouped by street, each street with the board cards dealt on it. */
export function streetsOf(actions: HandAction[], board: Card[], nameOf: (seat: number) => string) {
  return STREETS.map(([key, label, from, to]) => ({
    label,
    cards: board.slice(from, to),
    acts: actions.filter((a) => a.street === key).map((a) => ({ who: nameOf(a.seat), text: actText(a), fold: a.act === 'fold' })),
  })).filter((s, i) => i === 0 || s.cards.length);
}
