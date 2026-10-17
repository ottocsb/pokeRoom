// Authoritative multiplayer poker server: accounts, rooms, seats and live tables over WebSocket.
// Runs inside the Vite dev/preview server (see vite.config.ts) or standalone (server/standalone.ts).
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { emptySeat, Game, newPlayer, PROFILES, type ActionType, type GameEvent, type Player } from '../src/game';
import {
  CODE_CHARS,
  normCode,
  sanitizeCreate,
  TURN_MS,
  type ClientMsg,
  type RoomInfo,
  type SeatView,
  type ServerMsg,
  type TableState,
} from '../src/protocol';

// ---------------------------------------------------------------- rooms
interface RoomCfg {
  id: string;
  name: string;
  max: 6 | 9;
  sb: number;
  bb: number;
  buyIn: number;
  private?: boolean;
  owner?: string;
}
// No public rooms: every table is created by a player and reached by its invite code.
const OFFLINE_KICK_MS = 60_000;
const NEXT_HAND_MS = 5000;
/** private rooms with nobody inside are dissolved after this long */
const EMPTY_ROOM_MS = 30 * 60_000;
const MAX_PRIVATE_ROOMS = 500;

// ---------------------------------------------------------------- accounts
interface UserRec {
  name: string;
  salt: string;
  hash: string;
  created: number;
}
/** SQLite-backed account store (server-data/poker.db). Imports a legacy users.json once if present. */
class Store {
  private db: DatabaseSync;
  constructor(dir: string) {
    fs.mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, 'poker.db'));
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS users (
        key     TEXT PRIMARY KEY,
        name    TEXT NOT NULL,
        salt    TEXT NOT NULL,
        hash    TEXT NOT NULL,
        created INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tokens (
        token    TEXT PRIMARY KEY,
        user_key TEXT NOT NULL REFERENCES users(key) ON DELETE CASCADE
      );
    `);
    this.migrateJson(path.join(dir, 'users.json'));
  }
  private migrateJson(file: string) {
    if (!fs.existsSync(file)) return;
    try {
      const old = JSON.parse(fs.readFileSync(file, 'utf8')) as {
        users?: Record<string, UserRec>;
        tokens?: Record<string, string>;
      };
      const addUser = this.db.prepare(
        'INSERT OR IGNORE INTO users (key, name, salt, hash, created) VALUES (?, ?, ?, ?, ?)',
      );
      const addToken = this.db.prepare('INSERT OR IGNORE INTO tokens (token, user_key) VALUES (?, ?)');
      this.db.exec('BEGIN');
      for (const [key, u] of Object.entries(old.users ?? {})) addUser.run(key, u.name, u.salt, u.hash, u.created);
      for (const [token, key] of Object.entries(old.tokens ?? {})) addToken.run(token, key);
      this.db.exec('COMMIT');
      fs.renameSync(file, file + '.migrated');
      console.log('[poker] migrated users.json into SQLite');
    } catch (e) {
      if (this.db.isTransaction) this.db.exec('ROLLBACK');
      console.warn('[poker] could not migrate users.json', e);
    }
  }
  private getUser(key: string): UserRec | null {
    const row = this.db.prepare('SELECT name, salt, hash, created FROM users WHERE key = ?').get(key);
    return (row as UserRec | undefined) ?? null;
  }
  private hash(pass: string, salt: string) {
    return scryptSync(pass, salt, 32).toString('hex');
  }
  register(name: string, pass: string): UserRec | string {
    name = name.trim();
    if (!/^[\p{L}\p{N}_-]{2,12}$/u.test(name)) return '用户名需 2–12 位（中英文、数字、_ -）';
    if (pass.length < 4 || pass.length > 64) return '密码需 4–64 位';
    const key = name.toLowerCase();
    if (this.getUser(key)) return '该用户名已被注册';
    const salt = randomBytes(16).toString('hex');
    const rec = { name, salt, hash: this.hash(pass, salt), created: Date.now() };
    this.db
      .prepare('INSERT INTO users (key, name, salt, hash, created) VALUES (?, ?, ?, ?, ?)')
      .run(key, rec.name, rec.salt, rec.hash, rec.created);
    return rec;
  }
  login(name: string, pass: string): UserRec | string {
    const rec = this.getUser(name.trim().toLowerCase());
    if (!rec) return '用户不存在，请先注册';
    const a = Buffer.from(this.hash(pass, rec.salt), 'hex');
    const b = Buffer.from(rec.hash, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) return '密码错误';
    return rec;
  }
  issueToken(rec: UserRec) {
    const token = randomBytes(24).toString('hex');
    this.db.prepare('INSERT INTO tokens (token, user_key) VALUES (?, ?)').run(token, rec.name.toLowerCase());
    return token;
  }
  byToken(token: string): UserRec | null {
    const row = this.db
      .prepare('SELECT u.name, u.salt, u.hash, u.created FROM tokens t JOIN users u ON u.key = t.user_key WHERE t.token = ?')
      .get(token);
    return (row as UserRec | undefined) ?? null;
  }
  revoke(token: string) {
    this.db.prepare('DELETE FROM tokens WHERE token = ?').run(token);
  }
}

// ---------------------------------------------------------------- tables
interface Client {
  ws: WebSocket;
  user: string | null;
  token: string | null;
  room: Table | null;
  alive: boolean;
}

interface Hub {
  clientOf(user: string): Client | undefined;
  send(c: Client | undefined, m: ServerMsg): void;
  roomsChanged(): void;
}

class Table {
  game = new Game();
  members = new Set<string>();
  private offlineSince = new Map<string, number>();
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private turnDeadline = 0;
  private turnTotal = 0;
  private nextTimer: ReturnType<typeof setTimeout> | null = null;
  private pending = false;
  /** when the room last became empty (0 = someone is here) */
  emptySince = 0;

  constructor(
    public cfg: RoomCfg,
    private hub: Hub,
  ) {
    const g = this.game;
    g.solo = false;
    g.aiDelay = 900;
    g.room = { max: cfg.max, players: cfg.max, sb: cfg.sb, bb: cfg.bb, startChips: cfg.buyIn };
    g.players = Array.from({ length: cfg.max }, (_, i) => emptySeat(i));
    g.onUpdate = () => this.changed();
    g.onEvent = (e) => this.onEvent(e);
  }

  private get seated() {
    return this.game.players.filter((p) => !p.empty);
  }
  seatOf(user: string) {
    return this.game.players.findIndex((p) => !p.empty && p.user === user);
  }
  info(): RoomInfo {
    return {
      ...this.cfg,
      seated: this.seated.length,
      humans: this.seated.filter((p) => p.user).length,
      watchers: this.members.size,
      playing: this.game.phase === 'betting' || this.game.phase === 'handover',
      occupied: this.seated.map((p) => p.id),
    };
  }

  // ----- membership / seats
  join(user: string) {
    this.members.add(user);
    this.emptySince = 0;
    this.offlineSince.delete(user);
    this.setOffline(user, false);
    this.changed();
  }
  leave(user: string) {
    this.stand(user);
    this.members.delete(user);
    this.offlineSince.delete(user);
    if (!this.members.size) this.emptySince = Date.now();
    this.changed();
  }
  sit(user: string, seat: number): string | null {
    const g = this.game;
    if (this.seatOf(user) >= 0) return '你已经在座位上了';
    const cur = g.players[seat];
    if (!cur || !cur.empty) return '这个座位已经有人了';
    const p = newPlayer(seat, user, avatarOf(user), true, { tight: 0.5, aggr: 0.5, label: '' }, this.cfg.buyIn);
    p.user = user;
    this.placeNew(p);
    return null;
  }
  addBot(): string | null {
    const g = this.game;
    const seat = g.players.findIndex((p) => p.empty);
    if (seat < 0) return '座位已满';
    const used = new Set(this.seated.map((p) => p.name));
    const prof = PROFILES.slice(1).find((p) => !used.has(p.name)) ?? PROFILES[1 + (seat % (PROFILES.length - 1))];
    this.placeNew(newPlayer(seat, prof.name, prof.avatar, false, prof.style, this.cfg.buyIn));
    return null;
  }
  private placeNew(p: Player) {
    if (this.game.phase === 'betting') {
      // joined mid-hand: sit out until the next deal
      p.out = true;
      p.folded = true;
      p.waiting = true;
    }
    this.game.players[p.id] = p;
    this.changed();
    this.maybeStart();
  }
  stand(user: string) {
    const i = this.seatOf(user);
    if (i >= 0) this.vacate(i);
  }
  removeBots() {
    this.game.players.forEach((p) => {
      if (!p.empty && !p.user) this.vacate(p.id);
    });
  }
  private vacate(i: number) {
    const g = this.game;
    const p = g.players[i];
    if (p.empty) return;
    const inPlay = g.phase === 'betting' && (p.total > 0 || g.inHand(p));
    if (inPlay) {
      // chips already in the pot stay on the table until the hand ends
      p.leaving = true;
      if (g.turn === i) this.armTurn(i);
    } else {
      g.players[i] = emptySeat(i);
      this.tidy();
    }
    this.changed();
  }
  /** Bots never play alone. */
  private tidy() {
    const g = this.game;
    if (g.phase === 'betting') return;
    if (!this.seated.some((p) => p.user)) g.players.forEach((p, i) => !p.empty && (g.players[i] = emptySeat(i)));
    if (this.seated.length < 2 && g.phase !== 'handover') this.toIdle();
  }
  setOffline(user: string, off: boolean) {
    const i = this.seatOf(user);
    if (off) this.offlineSince.set(user, Date.now());
    else this.offlineSince.delete(user);
    if (i < 0) return;
    const p = this.game.players[i];
    p.offline = off;
    if (off && this.game.turn === i && this.game.phase === 'betting') this.armTurn(i);
    this.changed();
  }

  // ----- hand flow
  private maybeStart() {
    const g = this.game;
    if (g.phase === 'betting' || g.phase === 'handover' || this.nextTimer) return;
    if (this.seated.length >= 2 && this.seated.some((p) => p.user)) this.nextTimer = setTimeout(() => this.nextHand(), 1500);
  }
  private nextHand() {
    this.nextTimer = null;
    const g = this.game;
    const now = Date.now();
    g.players.forEach((p, i) => {
      if (p.empty) return;
      const offFor = p.user && this.offlineSince.has(p.user) ? now - this.offlineSince.get(p.user)! : 0;
      if (p.leaving || offFor > OFFLINE_KICK_MS) {
        g.players[i] = emptySeat(i);
      } else if (p.user && p.chips <= 0) {
        g.players[i] = emptySeat(i);
        this.hub.send(this.hub.clientOf(p.user), { t: 'notice', msg: '筹码输光了，已自动起身。可重新入座再次买入。' });
      } else if (!p.user && p.chips <= 0) {
        p.chips = this.cfg.buyIn; // bots rebuy
        p.out = false;
      }
      const q = g.players[i];
      if (q.waiting) {
        q.waiting = false;
        q.out = false;
      }
    });
    this.tidy();
    if (this.seated.length >= 2) g.startHand();
    else this.toIdle();
  }
  private toIdle() {
    const g = this.game;
    g.clearTimers();
    this.clearTurn();
    g.phase = 'idle';
    g.street = 'idle';
    g.turn = -1;
    g.board = [];
    g.pots = [];
    g.summary = null;
    g.currentBet = 0;
    for (const p of g.players) {
      if (p.empty) continue;
      Object.assign(p, { hole: [], bet: 0, total: 0, folded: false, allIn: false, out: false, waiting: false, acted: false });
      Object.assign(p, { locked: false, lastLabel: '', lastAmount: 0, result: null, won: 0, revealed: false });
    }
    this.changed();
  }

  private onEvent(e: GameEvent) {
    for (const u of this.members) this.hub.send(this.hub.clientOf(u), { t: 'ev', e });
    if (e.type === 'turn') {
      const p = this.game.players[e.player];
      if (p.isHuman) this.armTurn(e.player);
    } else if (e.type === 'action') this.clearTurn();
    else if (e.type === 'win') {
      this.clearTurn();
      if (this.nextTimer) clearTimeout(this.nextTimer);
      this.nextTimer = setTimeout(() => this.nextHand(), NEXT_HAND_MS);
    }
  }
  private clearTurn() {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
    this.turnDeadline = 0;
  }
  private armTurn(i: number) {
    this.clearTurn();
    const p = this.game.players[i];
    const ms = p.leaving || p.offline ? 1200 : TURN_MS;
    this.turnTotal = ms;
    this.turnDeadline = Date.now() + ms;
    this.turnTimer = setTimeout(() => this.autoAct(i), ms);
  }
  private autoAct(i: number) {
    const g = this.game;
    const p = g.players[i];
    this.turnTimer = null;
    if (g.turn !== i || g.phase !== 'betting') return;
    g.act(i, !p.leaving && g.toCall(p) === 0 ? { type: 'check' } : { type: 'fold' });
  }
  act(user: string, type: ActionType, to?: number) {
    const i = this.seatOf(user);
    if (i < 0) return;
    this.game.act(i, { type, to });
  }

  // ----- sync
  changed() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      for (const u of this.members) {
        const c = this.hub.clientOf(u);
        if (c) this.hub.send(c, { t: 'state', state: this.view(u) });
      }
      this.hub.roomsChanged();
    });
  }
  view(user: string): TableState {
    const g = this.game;
    const seat = (p: Player): SeatView | null =>
      p.empty
        ? null
        : {
            id: p.id,
            name: p.name,
            avatar: p.avatar,
            user: p.user,
            bot: !p.user,
            styleLabel: p.style.label,
            chips: p.chips,
            hole: p.user === user || p.revealed ? p.hole : p.hole.map(() => null),
            bet: p.bet,
            total: p.total,
            folded: p.folded,
            allIn: p.allIn,
            out: p.out,
            acted: p.acted,
            locked: p.locked,
            lastLabel: p.lastLabel,
            lastAmount: p.lastAmount,
            result: p.result,
            won: p.won,
            revealed: p.revealed,
            waiting: !!p.waiting,
            leaving: !!p.leaving,
            offline: !!p.offline,
          };
    return {
      room: {
        id: this.cfg.id,
        name: this.cfg.name,
        max: this.cfg.max,
        sb: this.cfg.sb,
        bb: this.cfg.bb,
        buyIn: this.cfg.buyIn,
        private: !!this.cfg.private,
        owner: this.cfg.owner,
      },
      handNo: g.handNo,
      phase: g.phase,
      street: g.street,
      turn: g.turn,
      dealer: g.dealer,
      currentBet: g.currentBet,
      minRaise: g.minRaise,
      board: g.board,
      pots: g.pots,
      summary: g.summary,
      seats: g.players.map(seat),
      mySeat: this.seatOf(user),
      turnLeft: this.turnTimer ? Math.max(0, this.turnDeadline - Date.now()) : 0,
      turnTotal: this.turnTotal,
      watchers: [...this.members].filter((u) => this.seatOf(u) < 0),
    };
  }
  close() {
    this.game.clearTimers();
    this.clearTurn();
    if (this.nextTimer) clearTimeout(this.nextTimer);
  }
}

function avatarOf(name: string) {
  return [...name][0]?.toUpperCase() ?? '?';
}

// ---------------------------------------------------------------- server
const ACTIONS = new Set<ActionType>(['fold', 'check', 'call', 'raise', 'allin']);

export function createPokerServer(opts: { dataDir: string }) {
  const store = new Store(opts.dataDir);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  const clients = new Map<string, Client>();
  let roomsPending = false;

  const hub: Hub = {
    clientOf: (u) => clients.get(u),
    send(c, m) {
      if (c && c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(m));
    },
    roomsChanged() {
      if (roomsPending) return;
      roomsPending = true;
      setTimeout(() => {
        roomsPending = false;
        const m: ServerMsg = { t: 'rooms', rooms: lobby() };
        for (const c of clients.values()) hub.send(c, m);
      }, 50);
    },
  };
  const tables: Table[] = [];
  /** there is no public room list any more */
  const lobby = (): RoomInfo[] => [];
  const tableById = (id: string) => {
    const code = normCode(id);
    return tables.find((t) => t.cfg.id === code);
  };
  function newCode() {
    for (;;) {
      const b = randomBytes(6);
      const code = [...b].map((x) => CODE_CHARS[x % CODE_CHARS.length]).join('');
      if (!tables.some((t) => t.cfg.id === code)) return code;
    }
  }
  function createRoom(owner: string, raw: unknown): Table | string {
    const { max, sb, bb, buyIn } = sanitizeCreate(raw as Record<string, never>);
    if (tables.length >= MAX_PRIVATE_ROOMS) return '服务器房间已满，请稍后再试';
    const t = new Table({ id: newCode(), name: `${owner} 的房间`, max, sb, bb, buyIn, private: true, owner }, hub);
    tables.push(t);
    return t;
  }
  /** dissolve private rooms nobody has been in for a while */
  function sweep() {
    const now = Date.now();
    for (let i = tables.length - 1; i >= 0; i--) {
      const t = tables[i];
      if (t.cfg.private && !t.members.size && t.emptySince && now - t.emptySince > EMPTY_ROOM_MS) {
        t.close();
        tables.splice(i, 1);
      }
    }
  }

  function authed(c: Client, rec: UserRec, token: string) {
    const prev = clients.get(rec.name);
    if (prev && prev !== c) {
      hub.send(prev, { t: 'kicked', msg: '该账号已在其他地方登录' });
      prev.user = null;
      prev.room = null;
      prev.ws.close();
    }
    c.user = rec.name;
    c.token = token;
    clients.set(rec.name, c);
    hub.send(c, { t: 'authed', user: rec.name, token });
    hub.send(c, { t: 'rooms', rooms: lobby() });
    // reconnect: restore the room the user was in
    const t = tables.find((t) => t.members.has(rec.name));
    if (t) {
      c.room = t;
      t.join(rec.name);
    }
  }

  function handle(c: Client, raw: RawData) {
    let m: ClientMsg;
    try {
      m = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'login' || m.t === 'register') {
      const user = String(m.user ?? '');
      const pass = String(m.pass ?? '');
      const r = m.t === 'login' ? store.login(user, pass) : store.register(user, pass);
      if (typeof r === 'string') return hub.send(c, { t: 'authFail', msg: r });
      return authed(c, r, store.issueToken(r));
    }
    if (m.t === 'auth') {
      const rec = store.byToken(String(m.token ?? ''));
      if (!rec) return hub.send(c, { t: 'authFail', msg: '登录已过期，请重新登录' });
      return authed(c, rec, String(m.token));
    }
    const user = c.user;
    if (!user) return hub.send(c, { t: 'error', msg: '请先登录' });
    switch (m.t) {
      case 'logout':
        c.room?.leave(user);
        c.room = null;
        if (c.token) store.revoke(c.token);
        clients.delete(user);
        c.user = null;
        c.token = null;
        return;
      case 'join': {
        const t = tableById(String(m.room ?? ''));
        if (!t) return hub.send(c, { t: 'joinFail', msg: '房间不存在或已解散，请确认邀请码' });
        if (c.room && c.room !== t) c.room.leave(user);
        c.room = t;
        t.join(user);
        return;
      }
      case 'create': {
        const t = createRoom(user, m.cfg);
        if (typeof t === 'string') return hub.send(c, { t: 'joinFail', msg: t });
        if (c.room) c.room.leave(user);
        c.room = t;
        t.join(user);
        return;
      }
      case 'leave':
        c.room?.leave(user);
        c.room = null;
        hub.send(c, { t: 'left' });
        hub.send(c, { t: 'rooms', rooms: lobby() });
        return;
    }
    const t = c.room;
    if (!t) return hub.send(c, { t: 'error', msg: '你不在房间里' });
    let err: string | null = null;
    if (m.t === 'sit') err = t.sit(user, Number(m.seat) | 0);
    else if (m.t === 'stand') t.stand(user);
    else if (m.t === 'addBot') err = t.addBot();
    else if (m.t === 'removeBots') t.removeBots();
    else if (m.t === 'act' && ACTIONS.has(m.type)) t.act(user, m.type, Number.isFinite(m.to) ? Math.floor(m.to!) : undefined);
    if (err) hub.send(c, { t: 'error', msg: err });
  }

  wss.on('connection', (ws) => {
    const c: Client = { ws, user: null, token: null, room: null, alive: true };
    ws.on('pong', () => (c.alive = true));
    ws.on('message', (d) => handle(c, d));
    ws.on('close', () => {
      const u = c.user;
      if (!u || clients.get(u) !== c) return;
      clients.delete(u);
      const t = c.room;
      if (t) {
        if (t.seatOf(u) >= 0) t.setOffline(u, true);
        else t.leave(u);
      }
      hub.roomsChanged();
    });
  });
  const beat = setInterval(() => {
    sweep();
    for (const ws of wss.clients) {
      const c = [...clients.values()].find((x) => x.ws === ws);
      if (c && !c.alive) {
        ws.terminate();
        continue;
      }
      if (c) c.alive = false;
      ws.ping();
    }
  }, 30_000);

  return {
    handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    },
    close() {
      clearInterval(beat);
      tables.forEach((t) => t.close());
      for (const ws of wss.clients) ws.terminate();
      wss.close();
    },
  };
}
