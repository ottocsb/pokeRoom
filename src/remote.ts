// Client side of online play: WebSocket connection + a read-only table model that mirrors Game's API for rendering.
import type { Card } from './cards';
import type { Action, Game, Player, RoomConfig } from './game';
import { WS_PATH, type ClientMsg, type RoomInfo, type ServerMsg, type TableState } from './protocol';

/** The subset of Game the renderer needs; both the local Game and RemoteTable provide it. */
export type TableLike = Pick<
  Game,
  | 'room'
  | 'players'
  | 'board'
  | 'street'
  | 'phase'
  | 'dealer'
  | 'currentBet'
  | 'minRaise'
  | 'turn'
  | 'handNo'
  | 'summary'
  | 'pots'
  | 'sb'
  | 'bb'
  | 'inHand'
  | 'canAct'
  | 'canRaise'
  | 'potTotal'
  | 'toCall'
  | 'minRaiseTo'
  | 'humanAct'
  | 'nextHand'
> & { readonly human: Player | undefined; isHumanTurn(): boolean };

export type NetStatus = 'idle' | 'connecting' | 'open' | 'closed';

const TOKEN_KEY = 'holdem-token';
export const savedToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
export const saveToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
};

function serverUrl() {
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env?.VITE_POKER_SERVER;
  if (env) return env;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${WS_PATH}`;
}

export class Net {
  status: NetStatus = 'idle';
  private ws: WebSocket | null = null;
  private retry = 0;
  private retryTimer = 0;
  /** keep reconnecting while true (set once logged in) */
  persistent = false;
  onMessage: (m: ServerMsg) => void = () => {};
  onStatus: (s: NetStatus) => void = () => {};
  onOpen: () => void = () => {};

  connect() {
    if (this.ws && (this.status === 'open' || this.status === 'connecting')) return;
    clearTimeout(this.retryTimer);
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(serverUrl());
    } catch {
      this.setStatus('closed');
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.setStatus('open');
      this.onOpen();
    };
    ws.onmessage = (ev) => {
      try {
        this.onMessage(JSON.parse(String(ev.data)));
      } catch (e) {
        console.error(e);
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.setStatus('closed');
      if (this.persistent) {
        const ms = Math.min(8000, 600 * 2 ** this.retry++);
        this.retryTimer = window.setTimeout(() => this.connect(), ms);
      }
    };
  }
  disconnect() {
    this.persistent = false;
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.setStatus('idle');
  }
  send(m: ClientMsg) {
    if (this.ws && this.status === 'open') {
      this.ws.send(JSON.stringify(m));
      return true;
    }
    return false;
  }
  private setStatus(s: NetStatus) {
    this.status = s;
    this.onStatus(s);
  }
}

const NO_STYLE = { tight: 0.5, aggr: 0.5, label: '' };

/** Read-only mirror of a server table, seen from one user's seat. Player ids are seat numbers. */
export class RemoteTable implements TableLike {
  state: TableState | null = null;
  room: RoomConfig = { max: 6, players: 6, sb: 10, bb: 20, startChips: 1000 };
  players: Player[] = [];
  mySeat = -1;
  turnDeadline = 0;
  turnTotal = 0;
  constructor(private net: Net) {}

  apply(s: TableState) {
    this.state = s;
    this.mySeat = s.mySeat;
    this.room = { max: s.room.max, players: s.room.max, sb: s.room.sb, bb: s.room.bb, startChips: s.room.buyIn };
    this.turnDeadline = s.turnLeft > 0 ? Date.now() + s.turnLeft : 0;
    this.turnTotal = s.turnTotal;
    this.players = s.seats.map((v, id): Player => {
      if (!v)
        return {
          id,
          name: '',
          avatar: '',
          isHuman: false,
          style: NO_STYLE,
          chips: 0,
          hole: [],
          bet: 0,
          total: 0,
          folded: true,
          allIn: false,
          out: true,
          acted: false,
          locked: false,
          lastLabel: '',
          lastAmount: 0,
          result: null,
          won: 0,
          revealed: false,
          empty: true,
        };
      return {
        ...v,
        isHuman: id === s.mySeat, // renderer: "isHuman" = the local viewer
        style: { tight: 0.5, aggr: 0.5, label: v.leaving ? '离座中' : v.offline ? '离线' : v.bot ? `电脑·${v.styleLabel}` : '' },
        hole: v.hole as Card[], // hidden cards arrive as null and render face-down
      };
    });
  }

  get board() {
    return this.state?.board ?? [];
  }
  get street() {
    return this.state?.street ?? 'idle';
  }
  get phase() {
    return this.state?.phase ?? 'idle';
  }
  get dealer() {
    return this.state?.dealer ?? -1;
  }
  get currentBet() {
    return this.state?.currentBet ?? 0;
  }
  get minRaise() {
    return this.state?.minRaise ?? this.bb;
  }
  get turn() {
    return this.state?.turn ?? -1;
  }
  get handNo() {
    return this.state?.handNo ?? 0;
  }
  get summary() {
    return this.state?.summary ?? null;
  }
  get pots() {
    return this.state?.pots ?? [];
  }
  get sb() {
    return this.room.sb;
  }
  get bb() {
    return this.room.bb;
  }
  get human(): Player | undefined {
    return this.mySeat >= 0 ? this.players[this.mySeat] : undefined;
  }
  inHand(p: Player) {
    return !p.out && !p.folded;
  }
  canAct(p: Player) {
    return !p.out && !p.folded && !p.allIn;
  }
  canRaise(p: Player) {
    return this.canAct(p) && !p.locked && p.bet + p.chips > this.currentBet;
  }
  potTotal() {
    return this.players.reduce((s, p) => s + p.total, 0);
  }
  toCall(p: Player) {
    return Math.max(0, Math.min(this.currentBet - p.bet, p.chips));
  }
  minRaiseTo() {
    return this.currentBet + this.minRaise;
  }
  isHumanTurn() {
    const h = this.human;
    return !!h && this.phase === 'betting' && this.turn === this.mySeat && this.canAct(h);
  }
  humanAct(a: Action) {
    if (!this.isHumanTurn()) return false;
    return this.net.send({ t: 'act', type: a.type, to: a.to });
  }
  nextHand() {
    /* the server deals the next hand automatically */
  }
}

export type { RoomInfo };
