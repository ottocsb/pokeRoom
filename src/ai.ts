import { Card, makeDeck, cardKey, RNG } from './cards';
import { compareScore, evaluate } from './evaluator';
import type { Action, Game, Player } from './game';

/** Monte Carlo equity of `hole` vs `opponents` random hands. */
export function equity(hole: Card[], board: Card[], opponents: number, iters: number, rng: RNG): number {
  if (opponents <= 0) return 1;
  const known = new Set([...hole, ...board].map(cardKey));
  const rest = makeDeck().filter((c) => !known.has(cardKey(c)));
  let score = 0;
  const need = opponents * 2 + (5 - board.length);
  for (let it = 0; it < iters; it++) {
    // partial shuffle
    for (let i = 0; i < need; i++) {
      const j = i + rng.int(rest.length - i);
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    let k = 0;
    const fullBoard = board.slice();
    while (fullBoard.length < 5) fullBoard.push(rest[k++]);
    const mine = evaluate([...hole, ...fullBoard]).score;
    let best = true;
    let ties = 0;
    for (let o = 0; o < opponents; o++) {
      const s = evaluate([rest[k++], rest[k++], ...fullBoard]).score;
      const c = compareScore(mine, s);
      if (c < 0) {
        best = false;
        break;
      }
      if (c === 0) ties++;
    }
    if (best) score += 1 / (ties + 1);
  }
  return score / iters;
}

export function decideAI(g: Game, p: Player): Action {
  const rng = g.rng;
  const BB = g.bb;
  const roundTo = (v: number) => Math.round(v / g.sb) * g.sb;
  const toCall = g.currentBet - p.bet;
  const opps = g.players.filter((q) => q !== p && g.inHand(q)).length;
  const eq = equity(p.hole, g.board, opps, 260, rng);
  const pot = g.potTotal();
  const potOdds = toCall > 0 ? toCall / (pot + toCall) : 0;
  const fair = 1 / (opps + 1);
  const strength = eq / fair; // >1: better than an average hand here
  const { tight, aggr } = p.style;
  const r = rng.next();
  const maxTo = p.bet + p.chips;
  const minTo = g.minRaiseTo();

  const raise = (frac: number): Action => {
    const target = roundTo(g.currentBet + Math.max(BB, (pot + toCall) * frac));
    const to = Math.max(minTo, target);
    if (to >= maxTo * 0.85) return { type: 'allin' };
    return { type: 'raise', to };
  };
  const passive = (): Action => (toCall > 0 ? { type: 'call' } : { type: 'check' });
  const canRaise = g.canRaise(p);

  // How much of the stack is at risk compared to strength
  const commitment = toCall / Math.max(1, p.chips + p.bet);

  // Monster
  if (eq > 0.8 || strength > 2.6 + tight * 0.4) {
    if (canRaise && r < 0.55 + aggr * 0.4) return raise(0.6 + aggr * 0.6);
    return passive();
  }
  // Strong
  if (g.street === 'preflop' && canRaise && strength > 1.35 + tight * 0.4 && r < 0.25 + aggr * 0.5 && commitment < 0.2)
    return raise(0.5 + aggr * 0.4);
  if (strength > 1.5 + tight * 0.5) {
    if (canRaise && r < aggr * 0.55 && commitment < 0.4) return raise(0.45 + aggr * 0.3);
    if (toCall === 0) return { type: 'check' };
    if (eq > potOdds * 0.9 || commitment < 0.15) return { type: 'call' };
    return { type: 'fold' };
  }
  // Marginal / weak
  if (toCall === 0) {
    if (canRaise && r < aggr * 0.12) return raise(0.4); // stab / bluff
    return { type: 'check' };
  }
  const looseness = (1 - tight) * 0.12;
  if (eq + looseness > potOdds + 0.04 && commitment < 0.3 + (1 - tight) * 0.2) return { type: 'call' };
  if (canRaise && r < aggr * 0.05 && commitment < 0.1) return raise(0.7); // bluff raise
  // cheap calls preflop
  if (g.street === 'preflop' && toCall <= BB && r < 0.45 - tight * 0.35) return { type: 'call' };
  return { type: 'fold' };
}
