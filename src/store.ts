// Shared app state + actions (moved from the old DOM-based main.ts). Components read from here.
import { computed, reactive, shallowRef, triggerRef, watch } from 'vue';
import { cardKey } from './cards';
import { evaluate } from './evaluator';
import { DEFAULT_ROOM, Game, GameEvent, Player, RoomConfig } from './game';
import { applyTheme, loadTheme } from './themes';
import { isMuted, setMuted, sfx } from './sound';
import { Net, RemoteTable, savedToken, saveToken, TableLike } from './remote';
import { Voice } from './voice';
import { sanitizeCreate, type CreateRoomCfg, type HandLog, type RoomInfo, type ServerMsg, type SessionRec, type SettleRow, type Standing } from './protocol';

// ---------- persisted prefs ----------
function loadJSON<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v) return { ...fallback, ...JSON.parse(v) };
  } catch {
    /* ignore */
  }
  return fallback;
}
export function saveJSON(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}

/** Single-player engine (vs AI) */
export const local = new Game();
/** Online: connection + mirror of the server table */
export const net = new Net();
export const remote = new RemoteTable(net);
export const voice = new Voice((m) => net.send(m));
voice.onState = (user, ok) => toast(ok ? `已和 ${user} 接通语音` : `和 ${user} 的语音连接失败：网络无法直连`);
/** What the view draws: `local` in practice mode, `remote` inside an online room.
 *  The engines are plain objects; call refresh() after they change so Vue re-renders. */
export const game = shallowRef<TableLike>(local);
export const refresh = () => triggerRef(game);

export type Screen = 'login' | 'rooms' | 'solo-setup' | 'create' | 'table' | 'records';

/** invite code from a shared link (?room=CODE); consumed once we're logged in */
const initialInvite = (() => {
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const c = q.get('room') ?? q.get('invite') ?? h.get('room') ?? h.get('invite');
  return c ? c.trim().slice(0, 16) || null : null;
})();

let room: RoomConfig = loadJSON('holdem-room', DEFAULT_ROOM);
local.room = { ...room };

export const ui = reactive({
  mode: 'solo' as 'solo' | 'online',
  screen: 'login' as Screen,
  user: null as string | null,
  rooms: [] as RoomInfo[],
  authErr: '',
  authBusy: false,
  autoLogin: !!savedToken(),
  authTab: (initialInvite && !savedToken() ? 'register' : 'login') as 'login' | 'register',
  inviteCode: initialInvite,
  shareOpen: false,
  historyOpen: false,
  /** action line of the current hand (opened from the pot) */
  flowOpen: false,
  history: null as { hands: HandLog[]; standings: Standing[] } | null,
  /** settlement shown after the owner closed the table */
  settle: null as { name: string; rows: SettleRow[] } | null,
  /** past tables the user played at (null = loading) */
  records: null as SessionRec[] | null,
  netStatus: net.status,
  theme: loadTheme(),
  unit: (() => {
    try {
      return localStorage.getItem('holdem-unit') === 'bb' ? 'bb' : 'chips';
    } catch {
      return 'chips';
    }
  })() as 'chips' | 'bb',
  muted: isMuted(),
  ladderOpen: false,
  /** preflop range chart */
  rangeOpen: false,
  themeOpen: false,
  raiseOpen: false,
  raiseValue: 0,
  /** action picked before your turn, done as soon as it comes */
  preAct: null as null | 'fold' | 'checkfold',
  toast: '',
  toastId: 0,
  /** seat whose emote picker is open (-1 = none) */
  emotePick: -1,
  /** emotes being shown on the table */
  emotes: [] as Array<{ id: number; from: number; to: number; emoji: string }>,
  /** online table chat */
  chat: [] as Array<{ id: number; user: string; seat: number; text: string }>,
  /** a message just came in: the (normally faded) chat panel lights up for a moment */
  chatFresh: false,
  /** phones: the chat sits behind a button; open state + messages missed meanwhile */
  chatOpen: false,
  chatUnread: 0,
  /** in the voice channel / own mic muted */
  voiceOn: false,
  voiceMuted: false,
  voiceBusy: false,
  /** latest chat line per seat, shown as a bubble for a few seconds */
  says: {} as Record<number, { id: number; text: string }>,
  /** ticks while an online action clock is running */
  now: Date.now(),
  createDraft: sanitizeCreate(loadJSON('holdem-create', {} as CreateRoomCfg)),
  draft: { ...room } as RoomConfig,
});
applyTheme(ui.theme);

let leavingRoom = false;
let pendingAuth: { t: 'login' | 'register'; user: string; pass: string } | null = null;

/** drop ?room= from the address bar so a reload doesn't re-join */
function clearInvite() {
  ui.inviteCode = null;
  try {
    const u = new URL(location.href);
    u.searchParams.delete('room');
    u.searchParams.delete('invite');
    u.hash = '';
    history.replaceState(null, '', u.pathname + u.search);
  } catch {
    /* ignore */
  }
}

/** seat id of the local viewer (-1 = spectating) */
const meId = () => (ui.mode === 'online' ? remote.mySeat : 0);

// ---------- money formatting ----------
export function money(n: number, bb = game.value.bb): string {
  if (ui.unit === 'bb') {
    const v = n / bb;
    const s = Number.isInteger(v) ? String(v) : v.toFixed(1);
    return `${s} BB`;
  }
  return n.toLocaleString('en-US');
}
/** money() with its unit, for amounts shown in front of a player (bets, action bubbles) */
export function moneyU(n: number) {
  return ui.unit === 'bb' ? money(n) : `${money(n)} 分`;
}

// ---------- seat layout ----------
export type Pos = [number, number];
function ring(n: number): Pos[] {
  // slot 0 = bottom centre (you); slots go clockwise (towards your left first)
  const out: Pos[] = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    out.push([50 - 49 * Math.sin(th), 50 + 49 * Math.cos(th)]);
  }
  return out;
}
export const RINGS: Record<6 | 9, Pos[]> = { 6: ring(6), 9: ring(9) };

/** Spread the seated players evenly over the room's seats so a partly-filled table never looks lopsided. */
export function seatMap(g: TableLike): { slotOf: Map<number, number>; empty: Array<{ slot: number; seat: number }> } {
  const max = g.room.max;
  if (ui.mode === 'online') {
    // real seat numbers, rotated so that your own seat sits at the bottom
    const base = Math.max(0, remote.mySeat);
    const slotOf = new Map<number, number>();
    const empty: Array<{ slot: number; seat: number }> = [];
    for (let seat = 0; seat < max; seat++) {
      const slot = (seat - base + max) % max;
      const p = g.players[seat];
      if (p && !p.empty) slotOf.set(seat, slot);
      else empty.push({ slot, seat });
    }
    return { slotOf, empty };
  }
  const seated = g.players.filter((p) => !p.out || (g.phase === 'handover' && p.hole.length > 0));
  const list = seated.length ? seated : g.players;
  const slotOf = new Map<number, number>();
  const n = list.length;
  list.forEach((p, k) => slotOf.set(p.id, Math.round((k * max) / Math.max(1, n)) % max));
  const used = new Set(slotOf.values());
  const empty: Array<{ slot: number; seat: number }> = [];
  for (let s = 0; s < max; s++) if (!used.has(s)) empty.push({ slot: s, seat: s });
  return { slotOf, empty };
}

// ---------- card deal animation ----------
const seen = new Set<string>();
let seenHand = -1;
/** true the first time a card key shows up in the current hand (plays the deal animation) */
export function fresh(key: string) {
  const hand = game.value.handNo;
  if (seenHand !== hand) {
    seen.clear();
    seenHand = hand;
  }
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

// ---------- highlight logic ----------
export interface HL {
  keys: Set<string>;
  owner: number;
  cat: number;
}
export const hl = computed<HL>(() => {
  const g = game.value;
  if (g.phase === 'handover' && g.street === 'showdown') {
    const main = g.pots.find((p) => !p.refund) ?? g.pots[0];
    const w = main ? g.players[main.winners[0]] : null;
    if (w?.result) return { keys: new Set(w.result.core.map(cardKey)), owner: w.id, cat: w.result.cat };
  }
  const h = g.human;
  if (h && h.hole.length && !h.folded) {
    const r = evaluate([...h.hole, ...g.board]);
    if (r.cat > 0 || g.board.length) return { keys: new Set(r.core.map(cardKey)), owner: h.id, cat: r.cat };
  }
  return { keys: new Set(), owner: -1, cat: -1 };
});

/** hand category of the local player (-1 = no cards) */
export const heroCat = computed(() => {
  const g = game.value;
  const h = g.human;
  return h && h.hole.length ? evaluate([...h.hole, ...g.board]).cat : -1;
});

export function actionText(p: Player) {
  return p.lastAmount ? `${p.lastLabel} ${moneyU(p.lastAmount)}` : p.lastLabel;
}

export function summaryText() {
  const s = game.value.summary;
  if (!s) return '';
  if (s.kind === 'fold') return `${s.names} 赢得 ${money(s.amount)}（其余玩家弃牌）`;
  if (/^发\d次$/.test(s.desc)) return `${s.desc}：${s.names} 共${s.kind === 'split' ? '分' : '赢'} ${money(s.amount)}`;
  return `${s.names} 以 ${s.desc} ${s.kind === 'split' ? '平分' : '赢得'} ${money(s.amount)}`;
}

// ---------- controls ----------
export function raiseBounds() {
  const g = game.value;
  const h = g.human!;
  const maxTo = h.bet + h.chips;
  const minTo = Math.min(g.minRaiseTo(), maxTo);
  return { minTo, maxTo };
}
export function setRaise(v: number) {
  const { minTo, maxTo } = raiseBounds();
  ui.raiseValue = Math.max(minTo, Math.min(maxTo, v));
}
export function onSlider(v: number) {
  const { maxTo } = raiseBounds();
  // the slider snaps to blind steps and may not land exactly on the all-in amount
  ui.raiseValue = v > maxTo - game.value.sb ? maxTo : v;
}
export function openRaise(open: boolean) {
  ui.raiseOpen = open;
  if (open) setRaise(raiseBounds().minTo);
}

/** remaining share of the current online action clock (0..1) */
export function clockFrac() {
  if (!remote.turnDeadline) return 0;
  return Math.max(0, Math.min(1, (remote.turnDeadline - ui.now) / Math.max(1, remote.turnTotal)));
}
function clockText() {
  if (ui.mode !== 'online' || !remote.turnDeadline) return '';
  return ` · ${Math.ceil(Math.max(0, remote.turnDeadline - ui.now) / 1000)} 秒`;
}

/** enabled state of the action buttons */
export const can = computed(() => {
  const g = game.value;
  const h = g.human;
  const my = g.isHumanTurn();
  if (!h) return { my: false, raise: false, allin: false };
  const toCall = g.toCall(h);
  return {
    my,
    raise: my && g.canRaise(h) && h.bet + h.chips > g.minRaiseTo(),
    // when locked by a short all-in, going all-in would be a re-raise: only allowed if it is merely a call
    allin: my && h.chips > 0 && (g.canRaise(h) || h.chips <= toCall),
  };
});
watch(
  () => can.value.my,
  (my) => {
    if (!my) ui.raiseOpen = false;
    else if (ui.preAct) {
      const g = game.value;
      const kind = ui.preAct;
      ui.preAct = null;
      if (preRound !== roundKey()) return; // picked in an earlier betting round
      doAct(kind === 'checkfold' && g.toCall(g.human!) === 0 ? 'call' : 'fold');
    }
  },
);
// a pre-action only covers the current betting round
const roundKey = () => `${game.value.handNo}-${game.value.street}`;
let preRound = '';
export function setPreAct(kind: 'fold' | 'checkfold' | null) {
  ui.preAct = kind;
  preRound = roundKey();
}
watch(roundKey, () => (ui.preAct = null));

export const statusText = computed(() => {
  const g = game.value;
  const h = g.human;
  const online = ui.mode === 'online';
  if (!h) {
    if (!online) return '';
    if (remote.state?.requests.some((r) => r.user === ui.user)) return '已申请带入，等待房主同意…';
    return `旁观中 · 点击牌桌上的「入座」申请带入（${money(remote.state?.room.buyIn ?? 0)}）`;
  }
  const my = can.value.my;
  const humansOnline = online ? g.players.filter((p) => !p.empty).length : 0;
  if (online && g.phase === 'idle') return humansOnline < 2 ? '等待其他玩家入座…（可点顶栏「+电脑」补位）' : '即将开始发牌…';
  if (online && h.waiting) return '已入座，下一手开始加入';
  const rv = online ? remote.state?.runVote : null;
  if (rv) {
    const secs = Math.ceil(Math.max(0, remote.runDeadline - ui.now) / 1000);
    if (rv.seats.includes(h.id) && !rv.mine) return `全下！选择剩下的牌发几次（按各方最少的选择，${secs} 秒内不选按 1 次）`;
    return `等待全下玩家协商发牌次数… ${secs} 秒`;
  }
  if (g.phase === 'betting') {
    if (my && h.locked) return '对手不足额全下：你只能跟注或弃牌' + clockText();
    if (my) return '轮到你了' + clockText();
    if (h.folded) return '你已弃牌，观看本手…';
    if (h.allIn) return '你已全下';
    if (ui.preAct) return `已预选「${ui.preAct === 'fold' ? '弃牌' : '过牌/弃牌'}」，轮到你时自动执行`;
    if (g.turn >= 0) return `等待 ${g.players[g.turn].name} 行动…`;
    return '发牌中…';
  }
  if (g.phase === 'handover')
    return g.pots.some((p) => p.winners.includes(h.id) && !p.refund) ? '你赢了这一手！' : online ? '下一手即将开始…' : '';
  return '';
});

export function doAct(kind: 'fold' | 'call' | 'raise' | 'allin') {
  const g = game.value;
  if (!g.isHumanTurn() || ui.screen !== 'table') return;
  if (kind === 'raise') {
    if (!can.value.raise) return;
    if (!ui.raiseOpen) {
      sfx.click();
      openRaise(true);
      return;
    }
    setRaise(ui.raiseValue); // a typed amount may be out of range
    const v = ui.raiseValue;
    openRaise(false);
    const { maxTo } = raiseBounds();
    g.humanAct(v >= maxTo ? { type: 'allin' } : { type: 'raise', to: v });
    return;
  }
  openRaise(false);
  if (kind === 'fold') g.humanAct({ type: 'fold' });
  else if (kind === 'call') g.humanAct({ type: 'call' });
  else if (can.value.allin) g.humanAct({ type: 'allin' });
}

// ---------- toast ----------
let toastTimer = 0;
export function toast(msg: string) {
  ui.toast = msg;
  ui.toastId++; // re-creates the element so the animation replays
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (ui.toast = ''), 3200);
}

// ---------- table emotes ----------
let emoteId = 0;
function showEmote(from: number, to: number, emoji: string) {
  const id = ++emoteId;
  ui.emotes.push({ id, from, to, emoji });
  setTimeout(() => (ui.emotes = ui.emotes.filter((e) => e.id !== id)), 2200);
}
/** click on a seat's avatar: open/close the emote picker (needs a seat of your own) */
export function toggleEmotePick(seat: number) {
  if (meId() < 0) return toast('入座后才能互动');
  ui.emotePick = ui.emotePick === seat ? -1 : seat;
}
export function sendEmote(to: number, emoji: string) {
  ui.emotePick = -1;
  if (ui.mode === 'online') net.send({ t: 'emote', to, emoji });
  else showEmote(meId(), to, emoji);
}

/** online, after a hand: show some of your hole cards to the table */
/** all-in run-out: how many times to deal the rest of the board */
export function voteRuns(n: number) {
  sfx.click();
  net.send({ t: 'runs', n });
}
export function showCards(cards: number[]) {
  sfx.click();
  net.send({ t: 'show', cards });
}

// ---------- table chat ----------
let chatId = 0;
let freshTimer = 0;
function onChat(user: string, seat: number, text: string) {
  const id = ++chatId;
  ui.chat.push({ id, user, seat, text });
  if (ui.chat.length > 100) ui.chat.shift();
  ui.chatFresh = true;
  if (!ui.chatOpen) ui.chatUnread++;
  clearTimeout(freshTimer);
  freshTimer = window.setTimeout(() => (ui.chatFresh = false), 3000);
  if (seat < 0) return;
  ui.says[seat] = { id, text };
  setTimeout(() => {
    if (ui.says[seat]?.id === id) delete ui.says[seat];
  }, 4000);
}
export function toggleChat() {
  sfx.click();
  ui.chatOpen = !ui.chatOpen;
  ui.chatUnread = 0;
}
export function sendChat(text: string) {
  if (text.trim()) net.send({ t: 'chat', text: text.trim() });
}

// ---------- voice chat ----------
export async function toggleVoice() {
  sfx.click();
  if (voice.on) return stopVoice();
  if (ui.voiceBusy) return;
  ui.voiceBusy = true;
  try {
    await voice.join();
    // left the room while the permission prompt was up
    if (ui.mode !== 'online') return voice.leave(false);
    net.send({ t: 'voice', on: true });
    ui.voiceOn = true;
    ui.voiceMuted = false;
    toast('已加入语音');
  } catch (e) {
    const name = (e as Error).name;
    toast(name === 'NotAllowedError' ? '没有麦克风权限，请在浏览器设置中允许' : name === 'NotFoundError' ? '没有找到麦克风' : (e as Error).message || '无法打开麦克风');
  } finally {
    ui.voiceBusy = false;
  }
}
export function toggleVoiceMute() {
  sfx.click();
  voice.setMuted(!voice.muted);
  ui.voiceMuted = voice.muted;
}
/** leave the voice channel (`tell` = false when the server already dropped us) */
function stopVoice(tell = true) {
  voice.leave(tell);
  ui.voiceOn = false;
  ui.voiceMuted = false;
}

// ---------- prefs toggles ----------
export function toggleUnit() {
  ui.unit = ui.unit === 'bb' ? 'chips' : 'bb';
  try {
    localStorage.setItem('holdem-unit', ui.unit);
  } catch {
    /* ignore */
  }
  sfx.click();
}
export function toggleSound() {
  setMuted(!isMuted());
  ui.muted = isMuted();
  sfx.click();
}
export function pickTheme(id: string) {
  ui.theme = id;
  applyTheme(id);
  sfx.click();
}

// ---------- auth ----------
export function submitAuth(u: string, p: string, p2: string | null) {
  if (!u || !p) ui.authErr = '请输入账号和密码';
  else if (p2 !== null && p2 !== p) ui.authErr = '两次输入的密码不一致';
  else {
    ui.authErr = '';
    ui.authBusy = true;
    pendingAuth = { t: ui.authTab, user: u, pass: p };
    if (!net.send(pendingAuth)) net.connect(); // sent on open
    else pendingAuth = null;
  }
  sfx.click();
}

// ---------- screen / mode switching ----------
function useLocal() {
  if (ui.mode === 'solo') return;
  ui.mode = 'solo';
  game.value = local;
  stopVoice(false);
  ui.chat = [];
  ui.chatFresh = false;
  ui.chatOpen = false;
  ui.chatUnread = 0;
  ui.says = {};
  remote.state = null;
  remote.players = [];
  remote.mySeat = -1;
  local.setup(room);
}
function useRemote() {
  if (ui.mode === 'online') return;
  local.clearTimers();
  ui.mode = 'online';
  game.value = remote;
  openRaise(false);
}

export function openSoloSetup() {
  sfx.click();
  if (ui.mode === 'online') leaveRoom(false);
  ui.draft = { ...room };
  ui.screen = 'solo-setup';
  openRaise(false);
}

/** Go to the online lobby (login first if needed). */
export function showOnline() {
  if (ui.mode === 'solo' && local.handNo > 0) local.setup(room); // abandon the practice game
  ui.screen = ui.user ? 'rooms' : 'login';
  if (net.status !== 'open') net.connect();
}

export function startRoom(cfg: RoomConfig) {
  room = cfg;
  saveJSON('holdem-room', room);
  useLocal();
  ui.screen = 'table';
  ui.preAct = null;
  local.newGame(undefined, room);
}
export function restartSolo() {
  ui.preAct = null;
  local.newGame(undefined, room);
}
export function soloRoom() {
  return room;
}

export function enterRoom(id: string) {
  const r = ui.rooms.find((x) => x.id === id);
  prepRemote(r ? { max: r.max, players: r.max, sb: r.sb, bb: r.bb, startChips: r.buyIn } : undefined);
  net.send({ t: 'join', room: id });
  ui.screen = 'table';
}
function prepRemote(cfg?: RoomConfig) {
  sfx.click();
  leavingRoom = false;
  useRemote();
  remote.state = null;
  remote.players = [];
  remote.mySeat = -1;
  if (cfg) remote.room = cfg;
  refresh();
}
export function createRoom() {
  const d = ui.createDraft;
  saveJSON('holdem-create', d);
  prepRemote({ max: d.max, players: d.max, sb: d.sb, bb: d.bb, startChips: d.buyIn });
  ui.shareOpen = true; // pop the invite panel as soon as the room exists
  net.send({ t: 'create', cfg: { ...d } });
  ui.screen = 'table';
}

export function leaveRoom(toRooms = true) {
  if (ui.mode !== 'online') return;
  leavingRoom = true;
  ui.shareOpen = false;
  ui.historyOpen = false;
  ui.history = null;
  ui.flowOpen = false;
  net.send({ t: 'leave' });
  useLocal();
  if (toRooms) ui.screen = ui.user ? 'rooms' : 'login';
}

export function openHistory() {
  ui.historyOpen = true;
  net.send({ t: 'history' });
}

export function openRecords() {
  sfx.click();
  ui.records = null;
  ui.screen = 'records';
  net.send({ t: 'sessions' });
}

export function answerBuyIn(user: string, ok: boolean) {
  sfx.click();
  net.send({ t: 'approve', user, ok });
}
export function closeTable() {
  sfx.click();
  const playing = game.value.phase === 'betting';
  if (confirm(playing ? '确定关闭牌桌？当前这手打完后结算。' : '确定关闭牌桌并结算？')) net.send({ t: 'closeTable' });
}

export function logout() {
  sfx.click();
  if (ui.mode === 'online') leaveRoom(false);
  net.send({ t: 'logout' });
  net.persistent = false;
  saveToken(null);
  ui.user = null;
  ui.autoLogin = false;
  ui.screen = 'login';
}

// ---------- network messages ----------
net.onOpen = () => {
  if (pendingAuth) {
    net.send(pendingAuth);
    pendingAuth = null;
    return;
  }
  const t = savedToken();
  if (t) net.send({ t: 'auth', token: t });
};
net.onStatus = (s) => {
  ui.netStatus = s;
  // the server drops a disconnected user from the voice channel
  if (s !== 'open') stopVoice(false);
  if (s === 'closed' && !ui.user) {
    ui.autoLogin = false;
    if (ui.authBusy) {
      ui.authBusy = false;
      ui.authErr = '无法连接联机服务器';
    }
    pendingAuth = null;
  }
};
net.onMessage = (m: ServerMsg) => {
  switch (m.t) {
    case 'authed':
      ui.user = m.user;
      voice.turn = m.turn;
      ui.authBusy = false;
      ui.authErr = '';
      ui.autoLogin = false;
      saveToken(m.token);
      net.persistent = true;
      if (ui.screen === 'login') ui.screen = 'rooms';
      if (ui.inviteCode) {
        // opened through an invite link: go straight into that room
        const code = ui.inviteCode;
        clearInvite();
        enterRoom(code);
        break;
      }
      // reconnected inside a room: make sure the server has us there (it may have restarted)
      if (ui.mode === 'online' && remote.state && !leavingRoom) net.send({ t: 'join', room: remote.state.room.id });
      break;
    case 'authFail':
      ui.authBusy = false;
      ui.authErr = ui.autoLogin ? '' : m.msg;
      if (ui.autoLogin) saveToken(null);
      ui.autoLogin = false;
      ui.user = null;
      net.persistent = false;
      if (ui.mode === 'online') useLocal();
      if (ui.screen !== 'solo-setup' && ui.screen !== 'table') ui.screen = 'login';
      break;
    case 'kicked':
      ui.user = null;
      ui.authErr = m.msg;
      net.disconnect();
      if (ui.mode === 'online') useLocal();
      ui.screen = 'login';
      break;
    case 'rooms':
      ui.rooms = m.rooms;
      break;
    case 'state': {
      if (leavingRoom) break;
      // also covers reloading the page while seated: the server restores your room
      if (ui.mode !== 'online') {
        if (ui.screen === 'solo-setup' || (ui.screen === 'table' && local.handNo > 0)) {
          net.send({ t: 'leave' });
          break;
        }
        useRemote();
      }
      ui.screen = 'table';
      const before = remote.mySeat;
      remote.apply(m.state);
      voice.sync(m.state.voice);
      if (before !== remote.mySeat) seen.clear();
      refresh();
      break;
    }
    case 'left':
      leavingRoom = false;
      break;
    case 'joinFail':
      ui.shareOpen = false;
      toast(m.msg);
      if (ui.mode === 'online') useLocal();
      ui.screen = ui.user ? 'rooms' : 'login';
      break;
    case 'ev':
      if (ui.mode === 'online') onGameEvent(m.e);
      // keep an open history panel up to date
      if (m.e.type === 'win' && ui.historyOpen) net.send({ t: 'history' });
      break;
    case 'history':
      ui.history = { hands: m.hands, standings: m.standings };
      break;
    case 'sessions':
      ui.records = m.list;
      break;
    case 'closed':
      // the server already dissolved the room: leave without sending 'leave'
      ui.settle = { name: m.name, rows: m.rows };
      ui.shareOpen = false;
      ui.historyOpen = false;
      ui.history = null;
      ui.flowOpen = false;
      if (ui.mode === 'online') useLocal();
      ui.screen = ui.user ? 'rooms' : 'login';
      break;
    case 'emote':
      if (ui.mode === 'online') showEmote(m.from, m.to, m.emoji);
      break;
    case 'chat':
      if (ui.mode === 'online') onChat(m.user, m.seat, m.text);
      break;
    case 'voicePeers':
      voice.callAll(m.users).catch(() => {});
      break;
    case 'rtc':
      voice.onSignal(m.from, m.data as never).catch(() => {});
      break;
    case 'notice':
    case 'error':
      toast(m.msg);
      break;
  }
};

// ---------- game hooks ----------
function onGameEvent(e: GameEvent) {
  const me = meId();
  if (e.type === 'deal') sfx.card(3);
  else if (e.type === 'board') sfx.card(e.count === 3 ? 3 : 1);
  else if (e.type === 'action') {
    if (e.action === 'fold') sfx.fold();
    else if (e.action === 'check') sfx.check();
    else if (e.action === 'allin') sfx.allin();
    else sfx.chip();
  } else if (e.type === 'turn' && me >= 0 && e.player === me) sfx.turn();
  else if (e.type === 'win') {
    const h = game.value.human;
    if (!h) return;
    if (e.pots.some((p) => p.winners.includes(me) && !p.refund)) sfx.win();
    else if (!h.folded && h.hole.length) sfx.lose();
  }
}
local.onUpdate = () => {
  if (ui.mode === 'solo') refresh();
};
local.onEvent = (e) => {
  if (ui.mode === 'solo') onGameEvent(e);
};

// tick the online action clock
setInterval(() => {
  if (ui.mode === 'online' && (remote.turnDeadline || remote.runDeadline)) ui.now = Date.now();
}, 250);

// test bridge (optional; gameplay never depends on it)
(globalThis as unknown as { __OHMYGAME_PLAYTEST__: unknown }).__OHMYGAME_PLAYTEST__ = {
  snapshot: () => {
    const g = game.value;
    return {
      ...(ui.mode === 'solo' ? local.snapshot() : { room: remote.state?.room, phase: g.phase, street: g.street, turn: g.turn, handNo: g.handNo, pot: g.potTotal(), board: g.board.map(cardKey), mySeat: remote.mySeat, players: g.players.map((p) => (p.empty ? null : { name: p.name, chips: p.chips, bet: p.bet, folded: p.folded, out: p.out, waiting: p.waiting, last: p.lastLabel })) }),
      mode: ui.mode,
      screen: ui.screen,
      user: ui.user,
      net: net.status,
      rooms: ui.rooms.map((r) => `${r.id}:${r.seated}/${r.max}`),
      theme: ui.theme,
      unit: ui.unit,
      ui: { themePopOpen: ui.themeOpen, ladderOpen: ui.ladderOpen, raiseOpen: ui.raiseOpen },
    };
  },
  reset: () => {
    if (ui.mode === 'solo') startRoom({ ...room });
  },
  setSeed: (s: number) => {
    if (ui.mode !== 'solo') return;
    ui.screen = 'table';
    local.newGame(s, room);
  },
};

// an empty table sits behind the login / lobby screens
local.setup(room);
net.connect();
