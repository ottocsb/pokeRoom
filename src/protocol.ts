// Shared client <-> server message shapes for online play.
import type { Card } from './cards';
import type { HandResult } from './evaluator';
import type { ActionType, GameEvent, HandSummary, Phase, PotResult, Street } from './game';

export const WS_PATH = '/poker-ws';
export const TURN_MS = 25000;
/** time to agree on running an all-in board more than once (unanswered = once) */
export const RUN_VOTE_MS = 10000;

export interface RoomInfo {
  id: string;
  name: string;
  max: 6 | 9;
  sb: number;
  bb: number;
  buyIn: number;
  seated: number;
  humans: number;
  watchers: number;
  playing: boolean;
  /** seat numbers that are taken */
  occupied: number[];
  /** private room created by a player; joined via invite code, not listed in the lobby */
  private?: boolean;
  owner?: string;
  /** bomb pots on: BB each player puts in (0 / missing = off) */
  bomb?: number;
}

/** Settings a player picks when opening a private room */
export interface CreateRoomCfg {
  max: 6 | 9;
  sb: number;
  bb: number;
  buyIn: number;
  /** bomb pot: BB each player puts in, 0 = off */
  bomb: number;
}
export const CREATE_BLINDS: Array<[number, number]> = [
  [1, 2],
  [5, 10],
  [10, 20],
  [25, 50],
  [50, 100],
  [100, 200],
];
/** buy-in depth options, in big blinds (buyIn = bb × depth) */
export const CREATE_DEPTHS = [50, 100, 200];
/** bomb pot options, in BB per player (0 = off) */
export const CREATE_BOMBS = [0, 1, 2, 3, 5];
/** once allowed (from the 2nd orbit, then every other orbit after one), the chance each hand is a bomb pot */
export const BOMB_CHANCE = 0.2;
/** Clamp any (possibly stale) create settings to a valid combination. */
export function sanitizeCreate(raw: Partial<CreateRoomCfg> | null | undefined): CreateRoomCfg {
  const c = raw ?? {};
  const max = c.max === 9 ? 9 : 6;
  const [sb, bb] = CREATE_BLINDS.find(([s, b]) => s === c.sb && b === c.bb) ?? CREATE_BLINDS[2];
  const depth = CREATE_DEPTHS.find((d) => d * bb === Number(c.buyIn)) ?? 100;
  const bomb = CREATE_BOMBS.find((b) => b === Number(c.bomb)) ?? 0;
  return { max, sb, bb, buyIn: bb * depth, bomb };
}
/** Invite codes: 6 chars, no look-alikes (0/O, 1/I/L) */
export const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
/** Table emotes: click a seat's avatar to send one (to yourself or to another player) */
export const EMOTES = ['👍', '👏', '😄', '😂', '😭', '😡', '🤔', '😱', '🌹', '🍺', '💣', '🥚'];
/** max length of one chat message */
export const CHAT_MAX = 60;
export const normCode = (s: string) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

export interface SeatView {
  id: number;
  name: string;
  avatar: string;
  user?: string;
  bot: boolean;
  styleLabel: string;
  chips: number;
  /** null = face-down card the viewer may not see */
  hole: (Card | null)[];
  bet: number;
  total: number;
  folded: boolean;
  allIn: boolean;
  out: boolean;
  acted: boolean;
  locked: boolean;
  lastLabel: string;
  lastAmount: number;
  result: HandResult | null;
  won: number;
  revealed: boolean;
  /** hole cards (indices) shown voluntarily after the hand */
  shown: number[];
  waiting: boolean;
  leaving: boolean;
  offline: boolean;
}

export interface TableState {
  room: Omit<RoomInfo, 'seated' | 'humans' | 'watchers' | 'playing' | 'occupied'>;
  handNo: number;
  phase: Phase;
  street: Street;
  turn: number;
  dealer: number;
  currentBet: number;
  minRaise: number;
  board: Card[];
  pots: PotResult[];
  summary: HandSummary | null;
  seats: (SeatView | null)[];
  mySeat: number;
  /** ms left on the current player's action clock (0 = none) */
  turnLeft: number;
  turnTotal: number;
  watchers: string[];
  /** betting actions of the current (or just finished) hand */
  actions: HandAction[];
  /** pending buy-in requests: the owner sees all, others only their own */
  requests: Array<{ user: string; seat: number }>;
  /** owner closed the table; it settles when the current hand ends */
  closing: boolean;
  /** users in the voice channel */
  voice: string[];
  /** bomb pot: chips each player put in this hand (0 = normal hand) */
  bomb: number;
  /** the 2nd / 3rd board when the all-in was run more than once */
  extraBoards: Card[][];
  /** all-in players choosing how many times to deal the rest (the smallest pick wins) */
  runVote: { seats: number[]; voted: number[]; mine: number; left: number } | null;
}
/** One player's line in the final settlement */
export interface SettleRow {
  name: string;
  user?: string;
  buyIn: number;
  chips: number;
  net: number;
}
/** One closed table as kept in a player's record */
export interface SessionRec {
  /** invite code */
  room: string;
  name: string;
  owner?: string;
  sb: number;
  bb: number;
  start: number;
  end: number;
  rows: SettleRow[];
}

/** One betting action. `amount` = chips put in by this action, `to` = the player's total bet on this street after it. */
export interface HandAction {
  street: 'preflop' | 'flop' | 'turn' | 'river';
  seat: number;
  act: 'sb' | 'bb' | 'ante' | 'fold' | 'check' | 'call' | 'bet' | 'raise';
  amount: number;
  to: number;
  allIn: boolean;
}
/** One finished hand, as stored in the db. Holds what a GGPoker-style hand history needs. */
export interface HandLog {
  handNo: number;
  time: number;
  /** invite code */
  room: string;
  max: 6 | 9;
  sb: number;
  bb: number;
  /** dealer seat */
  button: number;
  board: Card[];
  /** the 2nd / 3rd board when run more than once */
  extraBoards?: Card[][];
  summary: HandSummary | null;
  /** in order, blinds first */
  actions: HandAction[];
  players: Array<{
    seat: number;
    name: string;
    user?: string;
    /** chips at the start of the hand (before blinds) */
    stack: number;
    /** empty when the viewer may not see these cards */
    hole: Card[];
    shown: boolean;
    folded: boolean;
    desc: string;
    /** chips won/lost this hand */
    net: number;
    /** chips won from the pot (excluding the uncalled bet) */
    collected: number;
    /** own bet nobody called, given back */
    uncalled: number;
  }>;
}
export interface Standing {
  name: string;
  net: number;
  hands: number;
}

export type ClientMsg =
  | { t: 'login'; user: string; pass: string }
  | { t: 'register'; user: string; pass: string }
  | { t: 'auth'; token: string }
  | { t: 'logout' }
  | { t: 'join'; room: string }
  | { t: 'create'; cfg: CreateRoomCfg }
  | { t: 'leave' }
  | { t: 'sit'; seat: number }
  | { t: 'stand' }
  | { t: 'addBot' }
  | { t: 'removeBots' }
  | { t: 'history' }
  | { t: 'approve'; user: string; ok: boolean }
  | { t: 'closeTable' }
  | { t: 'sessions' }
  | { t: 'emote'; to: number; emoji: string }
  | { t: 'show'; cards: number[] }
  | { t: 'chat'; text: string }
  | { t: 'runs'; n: number }
  | { t: 'voice'; on: boolean }
  /** WebRTC signaling for voice chat, relayed to `to` */
  | { t: 'rtc'; to: string; data: unknown }
  | { t: 'act'; type: ActionType; to?: number };

export type ServerMsg =
  /** `turn`: voice relay server with a temporary account (missing = not configured) */
  | { t: 'authed'; user: string; token: string; turn?: { urls: string[]; username: string; credential: string } }
  | { t: 'authFail'; msg: string }
  | { t: 'rooms'; rooms: RoomInfo[] }
  | { t: 'state'; state: TableState }
  | { t: 'left' }
  | { t: 'joinFail'; msg: string }
  | { t: 'ev'; e: GameEvent }
  | { t: 'history'; hands: HandLog[]; standings: Standing[] }
  | { t: 'closed'; name: string; rows: SettleRow[] }
  | { t: 'sessions'; list: SessionRec[] }
  | { t: 'emote'; from: number; to: number; emoji: string }
  /** `seat` = -1 when a spectator speaks */
  | { t: 'chat'; user: string; seat: number; text: string }
  /** you joined voice: these users were already in it, call each of them */
  | { t: 'voicePeers'; users: string[] }
  | { t: 'rtc'; from: string; data: unknown }
  | { t: 'notice'; msg: string }
  | { t: 'error'; msg: string }
  | { t: 'kicked'; msg: string };
