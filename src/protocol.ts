// Shared client <-> server message shapes for online play.
import type { Card } from './cards';
import type { HandResult } from './evaluator';
import type { ActionType, GameEvent, HandSummary, Phase, PotResult, Street } from './game';

export const WS_PATH = '/poker-ws';
export const TURN_MS = 25000;

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
}

/** Settings a player picks when opening a private room */
export interface CreateRoomCfg {
  max: 6 | 9;
  sb: number;
  bb: number;
  buyIn: number;
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
/** Clamp any (possibly stale) create settings to a valid combination. */
export function sanitizeCreate(raw: Partial<CreateRoomCfg> | null | undefined): CreateRoomCfg {
  const c = raw ?? {};
  const max = c.max === 9 ? 9 : 6;
  const [sb, bb] = CREATE_BLINDS.find(([s, b]) => s === c.sb && b === c.bb) ?? CREATE_BLINDS[2];
  const depth = CREATE_DEPTHS.find((d) => d * bb === Number(c.buyIn)) ?? 100;
  return { max, sb, bb, buyIn: bb * depth };
}
/** Invite codes: 6 chars, no look-alikes (0/O, 1/I/L) */
export const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
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
  | { t: 'act'; type: ActionType; to?: number };

export type ServerMsg =
  | { t: 'authed'; user: string; token: string }
  | { t: 'authFail'; msg: string }
  | { t: 'rooms'; rooms: RoomInfo[] }
  | { t: 'state'; state: TableState }
  | { t: 'left' }
  | { t: 'joinFail'; msg: string }
  | { t: 'ev'; e: GameEvent }
  | { t: 'notice'; msg: string }
  | { t: 'error'; msg: string }
  | { t: 'kicked'; msg: string };
