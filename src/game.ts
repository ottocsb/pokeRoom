import { Card, makeDeck, RNG, shuffle, cardKey } from './cards';
import { compareScore, evaluate, HandResult } from './evaluator';
import { decideAI } from './ai';

export type Street = 'idle' | 'preflop' | 'flop' | 'turn' | 'river' | 'showdown';
export type Phase = 'betting' | 'handover' | 'gameover' | 'victory' | 'idle';

export interface Style {
  tight: number; // 0..1
  aggr: number; // 0..1
  label: string;
}

export interface RoomConfig {
  max: 6 | 9; // table type
  players: number; // seated players incl. you (2..max)
  sb: number;
  bb: number;
  startChips: number;
}

export const DEFAULT_ROOM: RoomConfig = { max: 6, players: 6, sb: 10, bb: 20, startChips: 1000 };

export interface Player {
  id: number;
  name: string;
  avatar: string;
  isHuman: boolean;
  style: Style;
  chips: number;
  hole: Card[];
  bet: number; // this street
  total: number; // this hand
  folded: boolean;
  allIn: boolean;
  out: boolean;
  acted: boolean;
  /** true when facing an incomplete (short all-in) raise after having acted: may only call or fold */
  locked: boolean;
  lastLabel: string;
  lastAmount: number; // 0 = no amount shown
  result: HandResult | null;
  won: number;
  revealed: boolean;
  /** online: hole cards (indices) the player chose to show after the hand */
  shown?: number[];
  /** online: seat has nobody in it (always `out`) */
  empty?: boolean;
  /** online: account name of the seated user; undefined for bots */
  user?: string;
  /** online: sat down mid-hand, joins at the next hand */
  waiting?: boolean;
  /** online: stood up mid-hand, removed after the hand */
  leaving?: boolean;
  /** online: connection lost */
  offline?: boolean;
}

export function newPlayer(id: number, name: string, avatar: string, isHuman: boolean, style: Style, chips: number): Player {
  return {
    id,
    name,
    avatar,
    isHuman,
    style,
    chips,
    hole: [],
    bet: 0,
    total: 0,
    folded: false,
    allIn: false,
    out: false,
    acted: false,
    locked: false,
    lastLabel: '',
    lastAmount: 0,
    result: null,
    won: 0,
    revealed: false,
  };
}

export function emptySeat(id: number): Player {
  return { ...newPlayer(id, '', '', false, { tight: 0.5, aggr: 0.5, label: '' }, 0), out: true, folded: true, empty: true };
}

export type ActionType = 'fold' | 'check' | 'call' | 'raise' | 'allin';
export interface Action {
  type: ActionType;
  to?: number; // raise-to amount
}

export interface PotResult {
  amount: number;
  winners: number[];
  desc: string;
  refund: boolean;
}

export interface HandSummary {
  kind: 'fold' | 'win' | 'split';
  names: string;
  desc: string;
  amount: number;
}

export type GameEvent =
  | { type: 'deal' }
  | { type: 'board'; count: number }
  | { type: 'action'; player: number; action: ActionType; amount: number }
  | { type: 'win'; pots: PotResult[]; human: boolean }
  | { type: 'turn'; player: number };

export const PROFILES: Array<Pick<Player, 'name' | 'avatar'> & { style: Style }> = [
  { name: '你', avatar: '你', style: { tight: 0.5, aggr: 0.5, label: '' } },
  { name: '阿杰', avatar: '杰', style: { tight: 0.75, aggr: 0.7, label: '紧凶' } },
  { name: '小雪', avatar: '雪', style: { tight: 0.3, aggr: 0.35, label: '松弱' } },
  { name: '老K', avatar: 'K', style: { tight: 0.35, aggr: 0.85, label: '松凶' } },
  { name: '莎莎', avatar: '莎', style: { tight: 0.8, aggr: 0.3, label: '紧弱' } },
  { name: '大熊', avatar: '熊', style: { tight: 0.45, aggr: 0.6, label: '均衡' } },
  { name: '阿梅', avatar: '梅', style: { tight: 0.7, aggr: 0.55, label: '紧凶' } },
  { name: '教授', avatar: '教', style: { tight: 0.85, aggr: 0.4, label: '紧弱' } },
  { name: '小飞', avatar: '飞', style: { tight: 0.2, aggr: 0.9, label: '松凶' } },
];

export class Game {
  room: RoomConfig = { ...DEFAULT_ROOM };
  players: Player[] = [];
  board: Card[] = [];
  deck: Card[] = [];
  street: Street = 'idle';
  phase: Phase = 'idle';
  dealer = -1;
  currentBet = 0;
  minRaise = 20;
  turn = -1;
  handNo = 0;
  summary: HandSummary | null = null;
  pots: PotResult[] = [];
  rng = new RNG();
  aiDelay = 750;
  /** single-player mode: seat 0 is "you", game over when you bust. Online tables set this to false. */
  solo = true;

  onUpdate: () => void = () => {};
  onEvent: (e: GameEvent) => void = () => {};

  private timers: ReturnType<typeof setTimeout>[] = [];

  get sb() {
    return this.room.sb;
  }
  get bb() {
    return this.room.bb;
  }

  private seatPlayers() {
    const n = Math.max(2, Math.min(this.room.max, this.room.players));
    this.players = PROFILES.slice(0, n).map((p, id) =>
      newPlayer(id, p.name, p.avatar, id === 0, p.style, this.room.startChips),
    );
  }

  // ---------- helpers ----------
  get human() {
    return this.players[0];
  }
  inHand(p: Player) {
    return !p.out && !p.folded;
  }
  canAct(p: Player) {
    return !p.out && !p.folded && !p.allIn;
  }
  /** Whether player may (re-)raise right now: not locked by an incomplete raise and has chips beyond a call. */
  canRaise(p: Player) {
    return this.canAct(p) && !p.locked && p.bet + p.chips > this.currentBet;
  }
  potTotal() {
    return this.players.reduce((s, p) => s + p.total, 0);
  }
  toCall(p: Player) {
    return Math.max(0, Math.min(this.currentBet - p.bet, p.chips));
  }
  /** Minimum legal raise-to: current bet + size of the last full raise (at least 1 BB). */
  minRaiseTo() {
    return this.currentBet + this.minRaise;
  }
  isHumanTurn() {
    return this.phase === 'betting' && this.turn === 0 && this.canAct(this.human);
  }
  private nextIndex(from: number, pred: (p: Player) => boolean): number {
    const n = this.players.length;
    for (let k = 1; k <= n; k++) {
      const i = (((from + k) % n) + n) % n;
      if (pred(this.players[i])) return i;
    }
    return -1;
  }
  private schedule(fn: () => void, ms: number) {
    const id = setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== id);
      fn();
    }, ms);
    this.timers.push(id);
  }
  clearTimers() {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }

  // ---------- flow ----------
  /** Seat a room without dealing (used behind the lobby). */
  setup(room: RoomConfig) {
    this.clearTimers();
    this.room = { ...room };
    this.seatPlayers();
    this.handNo = 0;
    this.board = [];
    this.pots = [];
    this.summary = null;
    this.street = 'idle';
    this.phase = 'idle';
    this.turn = -1;
    this.dealer = -1;
    this.onUpdate();
  }

  newGame(seed?: number, room?: RoomConfig) {
    this.clearTimers();
    if (room) this.room = { ...room };
    if (seed !== undefined) this.rng.setSeed(seed);
    this.seatPlayers();
    this.handNo = 0;
    this.dealer = this.rng.int(this.players.length) - 1;
    this.startHand();
  }

  startHand() {
    this.clearTimers();
    if (this.solo && this.human.out) {
      this.phase = 'gameover';
      this.onUpdate();
      return;
    }
    if (this.players.filter((p) => !p.out).length < 2) {
      this.phase = this.solo ? 'victory' : 'idle';
      this.onUpdate();
      return;
    }
    this.handNo++;
    this.board = [];
    this.pots = [];
    this.summary = null;
    for (const p of this.players) {
      p.hole = [];
      p.bet = 0;
      p.total = 0;
      p.folded = p.out;
      p.allIn = false;
      p.acted = false;
      p.locked = false;
      p.lastLabel = '';
      p.lastAmount = 0;
      p.result = null;
      p.won = 0;
      p.revealed = false;
      p.shown = [];
    }
    const alive = (p: Player) => !p.out;
    this.dealer = this.nextIndex(this.dealer < 0 ? this.players.length - 1 : this.dealer, alive);
    const headsUp = this.players.filter(alive).length === 2;
    const sbPos = headsUp ? this.dealer : this.nextIndex(this.dealer, alive);
    const bbPos = this.nextIndex(sbPos, alive);

    this.deck = shuffle(makeDeck(), this.rng);
    this.street = 'preflop';
    this.phase = 'betting';
    this.currentBet = 0;
    this.minRaise = this.bb;
    this.post(this.players[sbPos], this.sb, '小盲');
    this.post(this.players[bbPos], this.bb, '大盲');
    this.currentBet = this.bb;

    for (let round = 0; round < 2; round++) {
      let i = sbPos;
      for (let k = 0; k < this.players.length; k++) {
        const p = this.players[i];
        if (!p.out) p.hole.push(this.deck.pop()!);
        i = (i + 1) % this.players.length;
      }
    }
    this.turn = this.nextIndex(bbPos, (p) => this.canAct(p));
    this.onEvent({ type: 'deal' });
    this.onUpdate();
    this.schedule(() => this.proceed(), 600);
  }

  private post(p: Player, amount: number, label: string) {
    const a = Math.min(amount, p.chips);
    p.chips -= a;
    p.bet += a;
    p.total += a;
    if (p.chips === 0) p.allIn = true;
    p.lastLabel = label;
    p.lastAmount = 0;
  }

  private roundComplete(): boolean {
    const actors = this.players.filter((p) => this.canAct(p));
    if (actors.length === 0) return true;
    if (actors.length === 1 && actors[0].bet >= this.currentBet) {
      const others = this.players.filter((p) => this.inHand(p) && p !== actors[0]);
      if (others.every((o) => o.allIn)) return true;
    }
    return actors.every((p) => p.acted && p.bet === this.currentBet);
  }

  private proceed() {
    if (this.phase !== 'betting') return;
    const live = this.players.filter((p) => this.inHand(p));
    if (live.length === 1) return this.winByFold(live[0]);
    if (this.roundComplete()) return this.endStreet();

    if (this.turn < 0 || !this.canAct(this.players[this.turn])) {
      this.turn = this.nextIndex(this.turn, (p) => this.canAct(p));
    }
    const p = this.players[this.turn];
    this.onEvent({ type: 'turn', player: p.id });
    this.onUpdate();
    if (p.isHuman) return; // wait for input
    const delay = this.human.folded || this.human.out ? this.aiDelay * 0.6 : this.aiDelay;
    this.schedule(() => {
      const a = decideAI(this, p);
      this.apply(p, a);
    }, delay + this.rng.int(300));
  }

  humanAct(a: Action) {
    if (!this.isHumanTurn()) return false;
    this.apply(this.human, a);
    return true;
  }

  /** Act for any seat (online tables). Returns false when it is not that seat's turn. */
  act(id: number, a: Action) {
    const p = this.players[id];
    if (!p || this.phase !== 'betting' || this.turn !== id || !this.canAct(p)) return false;
    this.apply(p, a);
    return true;
  }

  private apply(p: Player, a: Action) {
    if (this.phase !== 'betting' || this.players[this.turn] !== p) return;
    const toCall = this.currentBet - p.bet;
    const prevBet = this.currentBet;
    let type = a.type;
    // a player locked by an incomplete raise may only call / fold
    if ((type === 'raise' || type === 'allin') && !this.canRaise(p)) type = 'call';
    if (type === 'check' && toCall > 0) type = 'call';
    if (type === 'call' && toCall <= 0) type = 'check';
    let paid = 0;

    const putTo = (to: number) => {
      const add = Math.max(0, Math.min(to - p.bet, p.chips));
      p.chips -= add;
      p.bet += add;
      p.total += add;
      paid = add;
      if (p.chips === 0) p.allIn = true;
    };

    if (type === 'raise' || type === 'allin') {
      const maxTo = p.bet + p.chips;
      // raise-to is clamped to [min raise, all-in]; only an all-in may be smaller than a min-raise
      const to = type === 'allin' ? maxTo : Math.min(Math.max(a.to ?? 0, this.minRaiseTo()), maxTo);
      const inc = to - this.currentBet;
      const full = inc >= this.minRaise;
      if (full) {
        this.minRaise = inc;
        // a full raise re-opens the action for everyone
        for (const o of this.players) if (o !== p) {
          o.acted = false;
          o.locked = false;
        }
      } else {
        // incomplete (short all-in) raise: players who already acted must call/fold, cannot re-raise
        for (const o of this.players) if (o !== p && o.acted) o.locked = true;
      }
      this.currentBet = to;
      putTo(to);
      if (p.allIn) type = 'allin';
    } else if (type === 'call') {
      putTo(this.currentBet);
      if (p.allIn) type = 'allin';
    } else if (type === 'fold') {
      p.folded = true;
    }

    p.acted = true;
    p.locked = false;
    const labels: Record<ActionType, [string, number]> = {
      fold: ['弃牌', 0],
      check: ['过牌', 0],
      call: ['跟注', paid],
      raise: [prevBet === 0 ? '下注' : '加注到', p.bet],
      allin: ['全下', p.bet],
    };
    [p.lastLabel, p.lastAmount] = labels[type];
    this.onEvent({ type: 'action', player: p.id, action: type, amount: paid });
    // round over (one player left / everyone acted): nobody may act until proceed() moves on
    const over = this.players.filter((q) => this.inHand(q)).length <= 1 || this.roundComplete();
    this.turn = over ? -1 : this.nextIndex(this.turn, (q) => this.canAct(q));
    this.onUpdate();
    this.schedule(() => this.proceed(), 250);
  }

  private endStreet() {
    for (const p of this.players) {
      p.bet = 0;
      p.acted = false;
      p.locked = false;
      if (!p.folded && !p.allIn) {
        p.lastLabel = '';
        p.lastAmount = 0;
      }
    }
    this.currentBet = 0;
    this.minRaise = this.bb;
    if (this.street === 'river') return this.showdown();

    if (this.street === 'preflop') {
      this.board.push(this.deck.pop()!, this.deck.pop()!, this.deck.pop()!);
      this.street = 'flop';
    } else if (this.street === 'flop') {
      this.board.push(this.deck.pop()!);
      this.street = 'turn';
    } else {
      this.board.push(this.deck.pop()!);
      this.street = 'river';
    }
    this.onEvent({ type: 'board', count: this.board.length });

    const actors = this.players.filter((p) => this.canAct(p));
    if (actors.length <= 1) {
      for (const p of this.players) if (this.inHand(p)) p.revealed = true;
      this.turn = -1;
      this.onUpdate();
      this.schedule(() => this.endStreet(), 1100);
      return;
    }
    this.turn = this.nextIndex(this.dealer, (p) => this.canAct(p));
    this.onUpdate();
    this.schedule(() => this.proceed(), 650);
  }

  private winByFold(w: Player) {
    const amount = this.potTotal();
    const profit = amount - w.total;
    w.chips += amount;
    w.won = profit;
    for (const p of this.players) p.bet = 0;
    this.pots = [{ amount: profit, winners: [w.id], desc: '其余玩家弃牌', refund: false }];
    this.summary = { kind: 'fold', names: w.name, desc: '其余玩家弃牌', amount: profit };
    this.finishHand();
  }

  private showdown() {
    this.street = 'showdown';
    const live = this.players.filter((p) => this.inHand(p));
    for (const p of live) {
      p.result = evaluate([...p.hole, ...this.board]);
      p.revealed = true;
    }
    const levels = [...new Set(this.players.filter((p) => p.total > 0).map((p) => p.total))].sort((a, b) => a - b);
    let prev = 0;
    const pots: { amount: number; eligible: Player[] }[] = [];
    for (const lvl of levels) {
      let amount = 0;
      for (const p of this.players) amount += Math.max(0, Math.min(p.total, lvl) - prev);
      const eligible = live.filter((p) => p.total >= lvl);
      if (amount > 0) {
        if (eligible.length === 0 && pots.length) pots[pots.length - 1].amount += amount;
        else if (eligible.length) {
          const last = pots[pots.length - 1];
          if (last && last.eligible.length === eligible.length && last.eligible.every((e) => eligible.includes(e)))
            last.amount += amount;
          else pots.push({ amount, eligible });
        }
      }
      prev = lvl;
    }

    this.pots = [];
    const n = this.players.length;
    for (const pot of pots) {
      let best: Player[] = [];
      for (const p of pot.eligible) {
        if (!best.length) best = [p];
        else {
          const c = compareScore(p.result!.score, best[0].result!.score);
          if (c > 0) best = [p];
          else if (c === 0) best.push(p);
        }
      }
      const share = Math.floor(pot.amount / best.length);
      let rem = pot.amount - share * best.length;
      const ordered = [...best].sort((a, b) => ((a.id - this.dealer + n) % n) - ((b.id - this.dealer + n) % n));
      for (const w of ordered) {
        const amt = share + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
        w.chips += amt;
        w.won += amt;
      }
      const refund = pot.eligible.length === 1;
      this.pots.push({ amount: pot.amount, winners: best.map((b) => b.id), desc: refund ? '退回未跟注筹码' : best[0].result!.desc, refund });
    }
    const main = this.pots.find((p) => !p.refund) ?? this.pots[0];
    if (main) {
      this.summary = {
        kind: main.winners.length > 1 ? 'split' : 'win',
        names: main.winners.map((i) => this.players[i].name).join('、'),
        desc: main.desc,
        amount: main.amount,
      };
    }
    this.finishHand();
  }

  private finishHand() {
    this.phase = 'handover';
    this.turn = -1;
    for (const p of this.players) {
      p.bet = 0;
      if (!p.out && p.chips === 0) p.out = true;
    }
    this.onEvent({ type: 'win', pots: this.pots, human: this.pots.some((p) => p.winners.includes(0) && !p.refund) });
    this.onUpdate();
  }

  nextHand() {
    if (this.phase !== 'handover') return;
    this.startHand();
  }

  snapshot() {
    return {
      room: this.room,
      handNo: this.handNo,
      phase: this.phase,
      street: this.street,
      turn: this.turn,
      dealer: this.dealer,
      currentBet: this.currentBet,
      minRaiseTo: this.minRaiseTo(),
      pot: this.potTotal(),
      board: this.board.map(cardKey),
      summary: this.summary,
      players: this.players.map((p) => ({
        name: p.name,
        chips: p.chips,
        bet: p.bet,
        folded: p.folded,
        allIn: p.allIn,
        out: p.out,
        locked: p.locked,
        hole: p.isHuman || p.revealed ? p.hole.map(cardKey) : p.hole.length,
        last: p.lastLabel + (p.lastAmount ? ' ' + p.lastAmount : ''),
        result: p.result?.desc,
      })),
      humanHand: evaluate([...this.human.hole, ...this.board]).desc,
    };
  }
}
