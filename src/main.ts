import './style.css';
import { Card, cardKey, isRed, rankLabel, SUIT_SYMBOL } from './cards';
import { CATEGORY_HINTS, CATEGORY_NAMES, describeDraws, describeHole, evaluate, HandResult } from './evaluator';
import { DEFAULT_ROOM, Game, GameEvent, Player, RoomConfig } from './game';
import { applyTheme, loadTheme, THEMES } from './themes';
import { isMuted, setMuted, sfx } from './sound';
import { Net, RemoteTable, savedToken, saveToken, TableLike } from './remote';
import { CREATE_BLINDS, CREATE_DEPTHS, normCode, sanitizeCreate, type CreateRoomCfg, type RoomInfo, type ServerMsg } from './protocol';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Single-player engine (vs AI) */
const local = new Game();
/** Online: connection + mirror of the server table */
const net = new Net();
const remote = new RemoteTable(net);
/** What the renderer draws: `local` in practice mode, `remote` inside an online room */
let game: TableLike = local;
let mode: 'solo' | 'online' = 'solo';
type Screen = 'login' | 'rooms' | 'solo-setup' | 'create' | 'table';
let screen: Screen = 'login';
let user: string | null = null;
let rooms: RoomInfo[] = [];
let authErr = '';
let authBusy = false;
let autoLogin = !!savedToken();
let authTab: 'login' | 'register' = 'login';
let leavingRoom = false;
/** invite code from a shared link (?room=CODE); consumed once we're logged in */
let inviteCode: string | null = (() => {
  const q = new URLSearchParams(location.search);
  const h = new URLSearchParams(location.hash.replace(/^#/, ''));
  const c = q.get('room') ?? q.get('invite') ?? h.get('room') ?? h.get('invite');
  return c ? c.trim().slice(0, 16) || null : null;
})();
if (inviteCode && !autoLogin) authTab = 'register';
/** drop ?room= from the address bar so a reload doesn't re-join */
function clearInvite() {
  inviteCode = null;
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
let shareOpen = false;
let createDraft: CreateRoomCfg = sanitizeCreate(loadJSON('holdem-create', {} as CreateRoomCfg));
/** seat id of the local viewer (-1 = spectating) */
const meId = () => (mode === 'online' ? remote.mySeat : 0);
let theme = loadTheme();
applyTheme(theme);

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
function saveJSON(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* ignore */
  }
}
let room: RoomConfig = loadJSON('holdem-room', DEFAULT_ROOM);
let unit: 'chips' | 'bb' = (() => {
  try {
    return localStorage.getItem('holdem-unit') === 'bb' ? 'bb' : 'chips';
  } catch {
    return 'chips';
  }
})();
local.room = { ...room };

// ---------- money formatting ----------
function money(n: number, bb = game.bb): string {
  if (unit === 'bb') {
    const v = n / bb;
    const s = Number.isInteger(v) ? String(v) : v.toFixed(1);
    return `${s} BB`;
  }
  return n.toLocaleString('en-US');
}

// ---------- seat layout ----------
type Pos = [number, number];
const RINGS: Record<6 | 9, Pos[]> = { 6: ring(6), 9: ring(9) };
function ring(n: number): Pos[] {
  // slot 0 = bottom centre (you); slots go clockwise (towards your left first)
  const out: Pos[] = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    out.push([50 - 49 * Math.sin(th), 50 + 49 * Math.cos(th)]);
  }
  return out;
}

/** Spread the seated players evenly over the room's seats so a partly-filled table never looks lopsided. */
function seatMap(): { slotOf: Map<number, number>; empty: Array<{ slot: number; seat: number }> } {
  const max = game.room.max;
  if (mode === 'online') {
    // real seat numbers, rotated so that your own seat sits at the bottom
    const base = Math.max(0, remote.mySeat);
    const slotOf = new Map<number, number>();
    const empty: Array<{ slot: number; seat: number }> = [];
    for (let seat = 0; seat < max; seat++) {
      const slot = (seat - base + max) % max;
      const p = game.players[seat];
      if (p && !p.empty) slotOf.set(seat, slot);
      else empty.push({ slot, seat });
    }
    return { slotOf, empty };
  }
  const seated = game.players.filter((p) => !p.out || (game.phase === 'handover' && p.hole.length > 0));
  const list = seated.length ? seated : game.players;
  const slotOf = new Map<number, number>();
  const n = list.length;
  list.forEach((p, k) => slotOf.set(p.id, Math.round((k * max) / Math.max(1, n)) % max));
  const used = new Set(slotOf.values());
  const empty: Array<{ slot: number; seat: number }> = [];
  for (let s = 0; s < max; s++) if (!used.has(s)) empty.push({ slot: s, seat: s });
  return { slotOf, empty };
}

let portrait = false;

function layout() {
  const wrap = $('table-wrap');
  const table = $('table');
  const W = wrap.clientWidth;
  const H = wrap.clientHeight;
  portrait = W / Math.max(1, H) < 1.15;
  const nine = game.room.max === 9;
  let tw: number, th: number;
  if (portrait) {
    const aw = W - (nine ? 64 : 56);
    const ah = H - 76;
    tw = Math.min(aw, ah * 0.7);
    th = tw / 0.7;
  } else {
    const aw = W - 160;
    const ah = H - 88;
    tw = Math.min(aw, ah * 2.05);
    th = tw / 2.05;
  }
  tw = Math.max(200, tw);
  th = Math.max(150, th);
  table.style.width = `${Math.round(tw)}px`;
  table.style.height = `${Math.round(th)}px`;
  table.classList.toggle('portrait', portrait);
  table.classList.toggle('nine', nine);
  const bc = portrait ? Math.min(74, tw * 0.145) : Math.min(88, tw * 0.074);
  table.style.setProperty('--bc', `${bc.toFixed(1)}px`);
  let fs = portrait ? Math.max(9.5, Math.min(13, tw * 0.034)) : Math.max(10, Math.min(14, tw * 0.016));
  if (nine) fs *= portrait ? 0.86 : 0.9;
  table.style.setProperty('--sfs', `${fs.toFixed(2)}px`);
  render();
}

// ---------- card html ----------
const seen = new Set<string>();
let seenHand = -1;
function fresh(key: string) {
  if (seenHand !== game.handNo) {
    seen.clear();
    seenHand = game.handNo;
  }
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

function cardHTML(c: Card | null, key: string, cls = '', delay = 0): string {
  const f = fresh(key) ? ' fresh' : '';
  const style = `style="--d:${delay}ms"`;
  if (!c) return `<div class="card back${f} ${cls}" ${style}></div>`;
  const color = isRed(c) ? 'red' : 'black';
  const s = SUIT_SYMBOL[c.s];
  return `<div class="card face ${color}${f} ${cls}" ${style} data-card="${cardKey(c)}"><span class="corner"><b>${rankLabel(
    c.r,
  )}</b><i>${s}</i></span><span class="pip">${s}</span></div>`;
}

// ---------- highlight logic ----------
interface HL {
  keys: Set<string>;
  owner: number;
  cat: number;
}
function highlightSet(): HL {
  if (game.phase === 'handover' && game.street === 'showdown') {
    const main = game.pots.find((p) => !p.refund) ?? game.pots[0];
    const w = main ? game.players[main.winners[0]] : null;
    if (w?.result) return { keys: new Set(w.result.core.map(cardKey)), owner: w.id, cat: w.result.cat };
  }
  const h = game.human;
  if (h && h.hole.length && !h.folded) {
    const r = evaluate([...h.hole, ...game.board]);
    if (r.cat > 0 || game.board.length) return { keys: new Set(r.core.map(cardKey)), owner: h.id, cat: r.cat };
  }
  return { keys: new Set(), owner: -1, cat: -1 };
}

// ---------- render ----------
let lastCat = -1;
let lastCatHand = -1;

function actionText(p: Player) {
  return p.lastAmount ? `${p.lastLabel} ${money(p.lastAmount)}` : p.lastLabel;
}

function summaryText() {
  const s = game.summary;
  if (!s) return '';
  if (s.kind === 'fold') return `${s.names} 赢得 ${money(s.amount)}（其余玩家弃牌）`;
  return `${s.names} 以 ${s.desc} ${s.kind === 'split' ? '平分' : '赢得'} ${money(s.amount)}`;
}

function render() {
  const pos = RINGS[game.room.max];
  const hl = highlightSet();
  const showdown = game.phase === 'handover' && game.street === 'showdown';
  const { slotOf, empty } = seatMap();

  const html: string[] = [];
  const canSit = mode === 'online' && remote.mySeat < 0 && !!remote.state;
  for (const { slot, seat } of empty) {
    const [x, y] = pos[slot];
    html.push(
      canSit
        ? `<button class="seat-empty sit" data-sit="${seat}" style="left:${x}%;top:${y}%" title="坐到 ${seat + 1} 号座"><span>入座</span></button>`
        : `<div class="seat-empty" style="left:${x}%;top:${y}%"><span>空座</span></div>`,
    );
  }
  game.players.forEach((p) => {
    const slot = slotOf.get(p.id);
    if (slot === undefined || p.empty) return;
    const [x, y] = pos[slot];
    const cls = [
      'seat',
      p.isHuman ? 'human' : '',
      p.folded && !p.out ? 'folded' : '',
      p.out ? 'out' : '',
      p.offline || p.leaving ? 'away' : '',
      game.turn === p.id && game.phase === 'betting' ? 'active' : '',
      p.won > 0 && game.phase === 'handover' ? 'winner' : '',
      x < 25 ? 'side-left' : x > 75 ? 'side-right' : '',
      y < 35 ? 'top' : '',
      y > 70 && !p.isHuman ? 'bottom' : '',
    ].join(' ');
    let cards = '';
    if (!p.isHuman && p.hole.length) {
      const show = p.revealed && !p.folded;
      cards = `<div class="seat-cards">${p.hole
        .map((c, k) =>
          show
            ? cardHTML(c, `s${p.id}f${k}`, hl.owner === p.id && hl.keys.has(cardKey(c)) ? 'core' : '', 0)
            : cardHTML(null, `s${p.id}b${k}`, '', (k * 5 + p.id) * 50),
        )
        .join('')}</div>`;
    }
    const tag =
      showdown && p.result && !p.folded ? `<div class="hand-tag ${p.won > 0 ? 'win' : ''}">${p.result.desc}</div>` : '';
    const bubble = p.lastLabel && !showdown ? `<div class="bubble">${actionText(p)}</div>` : '';
    const wonTag = p.won > 0 && game.phase === 'handover' ? `<div class="won">+${money(p.won)}</div>` : '';
    const dealer = game.dealer === p.id ? '<span class="dealer" title="庄家">D</span>' : '';
    const style = p.isHuman || !p.style.label ? '' : `<span class="style-tag">${esc(p.style.label)}</span>`;
    let clock = '';
    if (mode === 'online' && game.turn === p.id && game.phase === 'betting' && remote.turnDeadline) {
      clock = `<i class="clock" style="transform:scaleX(${clockFrac().toFixed(3)})"></i>`;
    }
    html.push(`<div class="${cls}" style="left:${x}%;top:${y}%">
      ${cards}
      <div class="plate">
        <div class="avatar">${esc(p.avatar)}${dealer}</div>
        <div class="info"><div class="name"><span class="nm">${esc(p.name)}</span>${style}</div><div class="chips">${
          p.waiting ? '下一手加入' : p.out ? '出局' : money(p.chips)
        }</div></div>${clock}
      </div>
      ${bubble}${tag}${wonTag}
    </div>`);
    if (p.bet > 0) {
      const side = Math.abs(x - 50) > 40 && y > 35 && y < 70;
      const t = side ? (portrait ? 0.26 : 0.3) : portrait ? 0.4 : 0.42;
      const bx = x + (50 - x) * t;
      const by = y + (50 - y) * t;
      html.push(`<div class="bet" style="left:${bx}%;top:${by}%"><i class="chip"></i>${money(p.bet)}</div>`);
    }
  });
  $('seats').innerHTML = html.join('');

  // board
  const slots: string[] = [];
  for (let k = 0; k < 5; k++) {
    const c = game.board[k];
    if (c) {
      const core = hl.keys.has(cardKey(c));
      const dim = hl.cat >= 1 && !core;
      slots.push(cardHTML(c, `b${k}`, `${core ? 'core' : ''} ${dim ? 'dim' : ''}`, (k < 3 ? k : 0) * 110));
    } else slots.push('<div class="card slot"></div>');
  }
  $('board').innerHTML = slots.join('');

  const total = game.phase === 'handover' ? game.pots.reduce((s, p) => s + p.amount, 0) : game.potTotal();
  $('pot').innerHTML = total > 0 ? `<span>底池</span><b>${money(total)}</b>` : '';
  const msgEl = $('msg');
  const msg = game.phase === 'handover' ? summaryText() : '';
  msgEl.textContent = msg;
  msgEl.classList.toggle('show', !!msg);
  const roomName =
    mode === 'online' && remote.state
      ? `${remote.state.room.name}${remote.state.room.private ? ` (${remote.state.room.id})` : ''} · `
      : '';
  const watchers = mode === 'online' && remote.state?.watchers.length ? ` · 旁观 ${remote.state.watchers.length}` : '';
  $('meta').textContent = `${roomName}${game.room.max === 9 ? '9人桌' : '6人桌'} · 盲注 ${game.sb}/${game.bb}${
    game.handNo ? ` · 第 ${game.handNo} 手` : ''
  }${watchers}`;
  renderTopbar();
  $('unit-lbl').textContent = unit === 'bb' ? 'BB' : '分';
  $('btn-unit').title = unit === 'bb' ? '当前以大盲(BB)显示，点击切换为分数' : '当前以分数显示，点击切换为大盲(BB)';

  renderHero(hl);
  renderControls();
  renderLadder();
  renderOverlay();
}

function renderHero(hl: HL) {
  const h = game.human;
  const holeEl = $('hole');
  holeEl.innerHTML =
    h && h.hole.length
      ? h.hole
          .map((c, k) => cardHTML(c, `h${k}`, `${hl.owner === h.id && hl.keys.has(cardKey(c)) ? 'core' : ''}`, k * 300))
          .join('')
      : `<div class="card slot"></div><div class="card slot"></div>`;
  holeEl.classList.toggle('folded', !!h && h.folded && !h.out);

  const badge = $('badge');
  const nameEl = $('badge-name');
  const subEl = $('badge-sub');
  const stackEl = $('badge-stack');
  if (h) stackEl.textContent = unit === 'bb' ? `${h.chips.toLocaleString('en-US')} 分` : `${+(h.chips / game.bb).toFixed(1)} BB`;
  if (!h) stackEl.textContent = '';
  if (!h || !h.hole.length) {
    nameEl.textContent = '—';
    subEl.textContent = !h && mode === 'online' ? '旁观中' : h?.waiting ? '下一手开始加入' : '';
    badge.dataset.cat = '-1';
    renderMeter(-1);
    return;
  }
  const r: HandResult = evaluate([...h.hole, ...game.board]);
  nameEl.textContent = r.desc;
  const subs: string[] = [];
  if (h.folded) subs.push('已弃牌');
  if (game.board.length === 0) subs.push(describeHole(h.hole));
  else subs.push(...describeDraws(h.hole, game.board));
  if (game.board.length && r.cat > 0 && r.core.every((c) => game.board.includes(c))) subs.push('全部来自公共牌');
  subEl.textContent = subs.join(' · ');
  badge.dataset.cat = String(r.cat);
  renderMeter(r.cat);

  if (lastCatHand !== game.handNo) {
    lastCatHand = game.handNo;
    lastCat = r.cat;
  } else if (r.cat > lastCat) {
    lastCat = r.cat;
    badge.classList.remove('level-up');
    void badge.offsetWidth;
    badge.classList.add('level-up');
    sfx.levelUp();
  }
}

function renderMeter(cat: number) {
  let s = '';
  for (let i = 0; i < 10; i++) s += `<i class="${i <= cat ? 'on' : ''} ${i === cat ? 'cur' : ''}"></i>`;
  $('badge-meter').innerHTML = s;
}

let ladderOpen = false;
function renderLadder() {
  const h = game.human;
  const cat = h && h.hole.length ? evaluate([...h.hole, ...game.board]).cat : -1;
  let s = '<h3>牌型大小</h3><ol>';
  for (let i = 9; i >= 0; i--) {
    s += `<li class="${i === cat ? 'cur' : ''}"><span class="lv">${i + 1}</span><span class="nm">${CATEGORY_NAMES[i]}</span><span class="ht">${CATEGORY_HINTS[i]}</span>${
      i === cat ? '<span class="you">你</span>' : ''
    }</li>`;
  }
  s += '</ol>';
  const el = $('ladder');
  el.innerHTML = s;
  el.classList.toggle('open', ladderOpen);
  $('btn-ladder').classList.toggle('on', ladderOpen);
}

// ---------- controls ----------
const rangeEl = $<HTMLInputElement>('raise-range');
const raiseOut = $('raise-out');
const raisePanel = $('raise-panel');
let raiseOpen = false;
let raiseValue = 0;
function raiseBounds() {
  const h = game.human!;
  const maxTo = h.bet + h.chips;
  const minTo = Math.min(game.minRaiseTo(), maxTo);
  return { minTo, maxTo };
}
function setRaise(v: number) {
  const { minTo, maxTo } = raiseBounds();
  raiseValue = Math.max(minTo, Math.min(maxTo, v));
  rangeEl.value = String(raiseValue);
  updateRaiseLabel();
}
function onSlider() {
  const { maxTo } = raiseBounds();
  const v = Number(rangeEl.value);
  // the slider snaps to blind steps and may not land exactly on the all-in amount
  raiseValue = v > maxTo - game.sb ? maxTo : v;
  updateRaiseLabel();
}
function updateRaiseLabel() {
  const v = raiseValue;
  const { minTo, maxTo } = raiseBounds();
  raiseOut.textContent = v >= maxTo ? `全下 ${money(maxTo)}` : money(v);
  $('raise-info').textContent = `最小加注到 ${money(minTo)} · 底池 ${money(game.potTotal())}`;
  $('act-raise').innerHTML = `<span>${game.currentBet === 0 ? '下注' : '加注到'}</span><span>${money(v)}</span><kbd>R</kbd>`;
}
function openRaise(open: boolean) {
  raiseOpen = open;
  raisePanel.hidden = !open;
  if (open) {
    const { minTo, maxTo } = raiseBounds();
    rangeEl.min = String(minTo);
    rangeEl.max = String(maxTo);
    rangeEl.step = String(game.sb);
    setRaise(minTo);
  }
  renderControls();
}

function btn(label: string, value = '', key = '') {
  return `<span>${label}</span>${value ? `<span>${value}</span>` : ''}${key ? `<kbd>${key}</kbd>` : ''}`;
}

/** remaining share of the current online action clock (0..1) */
function clockFrac() {
  if (!remote.turnDeadline) return 0;
  return Math.max(0, Math.min(1, (remote.turnDeadline - Date.now()) / Math.max(1, remote.turnTotal)));
}
function clockText() {
  if (mode !== 'online' || !remote.turnDeadline) return '';
  return ` · ${Math.ceil(Math.max(0, remote.turnDeadline - Date.now()) / 1000)} 秒`;
}

function renderControls() {
  const h = game.human;
  const my = game.isHumanTurn();
  const handover = game.phase === 'handover';
  const fold = $<HTMLButtonElement>('act-fold');
  const call = $<HTMLButtonElement>('act-call');
  const raise = $<HTMLButtonElement>('act-raise');
  const allin = $<HTMLButtonElement>('act-allin');
  const next = $<HTMLButtonElement>('act-next');
  const online = mode === 'online';
  // online tables deal the next hand by themselves
  $('actions').classList.toggle('handover', handover && !online);
  next.hidden = !handover || online;
  const st = $('status');
  if (!h) {
    for (const b of [fold, call, raise, allin]) b.disabled = true;
    const buyIn = remote.state?.room.buyIn ?? 0;
    st.textContent = online ? `旁观中 · 点击牌桌上的「入座」坐下（买入 ${money(buyIn)}）` : '';
    st.classList.remove('mine');
    document.getElementById('app')!.classList.remove('my-turn');
    document.getElementById('app')!.classList.toggle('spectate', online);
    return;
  }

  document.getElementById('app')!.classList.remove('spectate');
  const toCall = game.toCall(h);
  fold.innerHTML = btn('弃牌', '', 'F');
  call.innerHTML = toCall > 0 ? btn('跟注', money(toCall), 'C') : btn('过牌', '', 'C');
  const canRaise = my && game.canRaise(h) && h.bet + h.chips > game.minRaiseTo();
  fold.disabled = !my;
  call.disabled = !my;
  raise.disabled = !canRaise;
  // when locked by a short all-in, going all-in would be a re-raise: only allowed if it is merely a call
  allin.disabled = !my || h.chips === 0 || (!game.canRaise(h) && h.chips > toCall);
  allin.innerHTML = btn('全下', money(h.chips), 'A');
  if (!my && raiseOpen) {
    raiseOpen = false;
    raisePanel.hidden = true;
  }
  if (raiseOpen) updateRaiseLabel();
  else raise.innerHTML = btn(game.currentBet === 0 ? '下注' : '加注', my ? `≥ ${money(Math.min(game.minRaiseTo(), h.bet + h.chips))}` : '', 'R');

  let text = '';
  const humansOnline = online ? game.players.filter((p) => !p.empty).length : 0;
  if (online && game.phase === 'idle')
    text = humansOnline < 2 ? '等待其他玩家入座…（可点顶栏「+电脑」补位）' : '即将开始发牌…';
  else if (online && h.waiting) text = '已入座，下一手开始加入';
  else if (game.phase === 'betting') {
    if (my && h.locked) text = '对手不足额全下：你只能跟注或弃牌';
    else if (my) text = '轮到你了' + clockText();
    else if (h.folded) text = '你已弃牌，观看本手…';
    else if (h.allIn) text = '你已全下';
    else if (game.turn >= 0) text = `等待 ${game.players[game.turn].name} 行动…`;
    else text = '发牌中…';
  } else if (handover)
    text = game.pots.some((p) => p.winners.includes(h.id) && !p.refund) ? '你赢了这一手！' : online ? '下一手即将开始…' : '';
  st.textContent = text;
  st.classList.toggle('mine', my);
  document.getElementById('app')!.classList.toggle('my-turn', my);
}

// ---------- overlays: login / room list / practice setup / game over ----------
let draft: RoomConfig = { ...room };
const BLINDS: Array<[number, number]> = [
  [5, 10],
  [10, 20],
  [25, 50],
  [50, 100],
];
const STACKS = [1000, 2000, 5000];

function lobbyPreview(): string {
  const pos = RINGS[draft.max];
  const n = Math.min(draft.players, draft.max);
  const used = new Set<number>();
  for (let k = 0; k < n; k++) used.add(Math.round((k * draft.max) / n) % draft.max);
  return pos
    .map(([x, y], s) => `<i class="pv-seat ${used.has(s) ? 'on' : ''} ${s === 0 ? 'me' : ''}" style="left:${x}%;top:${y}%"></i>`)
    .join('');
}

let ovKey = '';
/** Rebuild the overlay only when its content key changes, keeping typed input values. */
function setOverlay(key: string, html: string | null, bind?: (ov: HTMLElement) => void) {
  const ov = $('overlay');
  if (html === null) {
    ov.hidden = true;
    ovKey = '';
    return;
  }
  ov.hidden = false;
  if (key === ovKey) return;
  ovKey = key;
  ov.onclick = null;
  const kept = new Map<string, string>();
  ov.querySelectorAll<HTMLInputElement>('input[id]').forEach((i) => kept.set(i.id, i.value));
  const focused = document.activeElement?.id;
  ov.innerHTML = html;
  kept.forEach((v, id) => {
    const el = document.getElementById(id) as HTMLInputElement | null;
    if (el) el.value = v;
  });
  if (focused) (document.getElementById(focused) as HTMLElement | null)?.focus();
  bind?.(ov);
}

function netLine(): string {
  const s = net.status;
  if (s === 'open') return '<span class="net-dot on"></span>联机服务器已连接';
  if (s === 'connecting') return '<span class="net-dot wait"></span>正在连接联机服务器…';
  return '<span class="net-dot off"></span>无法连接联机服务器 <button class="link" id="net-retry">重试</button>';
}

function renderLogin() {
  if (autoLogin && (net.status === 'connecting' || net.status === 'open')) {
    return setOverlay('login:auto', `<div class="ov-panel auth"><div class="ov-suit">♠</div><h2>正在登录…</h2><p>${netLine()}</p></div>`);
  }
  const reg = authTab === 'register';
  const key = `login:${authTab}:${authErr}:${authBusy}:${net.status}:${inviteCode}`;
  const invite = inviteCode
    ? `<div class="invite-banner"><span>你受邀加入房间</span><b>${esc(normCode(inviteCode) || inviteCode)}</b><small>${
        reg ? '设置账号密码，注册后直接入座' : '登录后直接进入房间'
      }</small></div>`
    : '';
  setOverlay(
    key,
    `<div class="ov-panel auth">
      <div class="ov-suit">♠</div>
      <h2>德州扑克 · 登录</h2>
      ${invite}
      <div class="segs auth-tabs"><button class="seg ${reg ? '' : 'sel'}" data-tab="login">登录</button><button class="seg ${
        reg ? 'sel' : ''
      }" data-tab="register">注册账号</button></div>
      <form class="auth-form" id="auth-form" autocomplete="on">
        <label><span>账号</span><input id="auth-user" name="username" autocomplete="username" maxlength="12" placeholder="2–12 位中英文或数字" required /></label>
        <label><span>密码</span><input id="auth-pass" name="password" type="password" autocomplete="${
          reg ? 'new-password' : 'current-password'
        }" maxlength="64" placeholder="至少 4 位" required /></label>
        ${reg ? '<label><span>确认密码</span><input id="auth-pass2" type="password" autocomplete="new-password" maxlength="64" required /></label>' : ''}
        <p class="auth-err" role="alert">${esc(authErr)}</p>
        <button class="act next" type="submit" ${authBusy ? 'disabled' : ''}>${authBusy ? '请稍候…' : reg ? (inviteCode ? '注册并进入房间' : '注册并登录') : inviteCode ? '登录并进入房间' : '登录'}</button>
      </form>
      <p class="auth-net">${netLine()}</p>
      <div class="auth-alt"><button class="act ghost" id="go-solo">单机练习（对战电脑，无需登录）</button></div>
    </div>`,
    (ov) => {
      ov.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach(
        (b) =>
          (b.onclick = () => {
            authTab = b.dataset.tab as 'login' | 'register';
            authErr = '';
            sfx.click();
            renderOverlay();
          }),
      );
      $('auth-form').onsubmit = (e) => {
        e.preventDefault();
        submitAuth();
      };
      $('go-solo').onclick = () => openSoloSetup();
      document.getElementById('net-retry')?.addEventListener('click', () => net.connect());
      if (!document.activeElement || document.activeElement === document.body) $('auth-user').focus();
    },
  );
}

let pendingAuth: { t: 'login' | 'register'; user: string; pass: string } | null = null;
function submitAuth() {
  const u = $<HTMLInputElement>('auth-user').value.trim();
  const p = $<HTMLInputElement>('auth-pass').value;
  const p2 = document.getElementById('auth-pass2') as HTMLInputElement | null;
  if (!u || !p) authErr = '请输入账号和密码';
  else if (p2 && p2.value !== p) authErr = '两次输入的密码不一致';
  else {
    authErr = '';
    authBusy = true;
    pendingAuth = { t: authTab, user: u, pass: p };
    if (!net.send(pendingAuth)) net.connect(); // sent on open
    else pendingAuth = null;
  }
  sfx.click();
  renderOverlay();
}

function renderRooms() {
  const key = `home:${user}:${net.status}`;
  const online = net.status === 'open';
  setOverlay(
    key,
    `<div class="ov-panel lobby rooms home">
      <div class="rooms-head">
        <h2>德州扑克</h2>
        <div class="who"><span class="who-av">${esc([...(user ?? '?')][0].toUpperCase())}</span><b>${esc(user ?? '')}</b><button class="link" id="logout">退出登录</button></div>
      </div>
      <div class="home-grid">
        <button class="home-card primary" id="go-create" ${online ? '' : 'disabled'}>
          <span class="hc-ico">＋</span>
          <b>创建房间</b>
          <small>自定大小盲与 6 / 9 人桌，生成邀请码发给好友</small>
        </button>
        <form class="home-card code" id="code-form">
          <span class="hc-ico">✉</span>
          <b>加入房间</b>
          <small>输入好友房间的邀请码</small>
          <div class="code-join"><input id="code-input" maxlength="8" placeholder="邀请码" autocomplete="off" autocapitalize="characters" spellcheck="false" /><button class="act next" type="submit" ${
            online ? '' : 'disabled'
          }>进入</button></div>
        </form>
        <button class="home-card" id="go-solo">
          <span class="hc-ico">♟</span>
          <b>单机练习</b>
          <small>和电脑对手打，不占用联机房间</small>
        </button>
      </div>
      ${online ? '' : `<p class="auth-net">${netLine()}</p>`}
    </div>`,
    () => {
      $('logout').onclick = () => logout();
      $('go-solo').onclick = () => openSoloSetup();
      $('go-create').onclick = () => {
        sfx.click();
        screen = 'create';
        renderOverlay();
      };
      $('code-form').onsubmit = (e) => {
        e.preventDefault();
        const c = normCode($<HTMLInputElement>('code-input').value);
        if (c.length < 4) return toast('请输入完整的邀请码');
        enterRoom(c);
      };
      document.getElementById('net-retry')?.addEventListener('click', () => net.connect());
    },
  );
}

function renderCreate() {
  const d = createDraft;
  const depth = d.buyIn / d.bb;
  const seg = (items: string[], active: (i: number) => boolean, attr: string) =>
    items.map((t, i) => `<button class="seg ${active(i) ? 'sel' : ''}" data-${attr}="${i}">${t}</button>`).join('');
  const dots = RINGS[d.max].map(([x, y], s) => `<i class="pv-seat ${s === 0 ? 'on me' : ''}" style="left:${x}%;top:${y}%"></i>`).join('');
  setOverlay(
    `create:${JSON.stringify(d)}:${net.status}`,
    `<div class="ov-panel lobby">
      <h2>创建房间</h2>
      <div class="lobby-grid">
        <div class="lobby-form">
          <label>房型</label><div class="segs">${seg(['6 人桌', '9 人桌'], (i) => (i === 0 ? 6 : 9) === d.max, 'cmax')}</div>
          <label>盲注级别（小盲 / 大盲）</label><div class="segs">${seg(CREATE_BLINDS.map(([s, b]) => `${s}/${b}`), (i) => CREATE_BLINDS[i][1] === d.bb, 'cblind')}</div>
          <label>买入</label><div class="segs">${seg(
            CREATE_DEPTHS.map((n) => `${(n * d.bb).toLocaleString('en-US')}<small> · ${n}BB</small>`),
            (i) => CREATE_DEPTHS[i] === depth,
            'cstack',
          )}</div>
          <p class="lobby-note">小盲 <b>${d.sb}</b> · 大盲 <b>${d.bb}</b> · 每人买入 <b>${d.buyIn.toLocaleString('en-US')}</b>。房间只能通过邀请链接或邀请码进入；无人 30 分钟后自动解散。</p>
        </div>
        <div class="lobby-preview"><div class="pv-table"><div class="pv-felt"></div>${dots}</div><small>${d.max} 个座位</small></div>
      </div>
      <div class="lobby-actions">
        <button class="act ghost" id="create-back">返回</button>
        <button class="act next" id="create-go" ${net.status === 'open' ? '' : 'disabled'}>创建并进入</button>
      </div>
    </div>`,
    (ov) => {
      const bindSeg = (attr: string, f: (i: number) => void) =>
        ov.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach(
          (b) =>
            (b.onclick = () => {
              f(Number(b.getAttribute(`data-${attr}`)));
              sfx.click();
              renderOverlay();
            }),
        );
      bindSeg('cmax', (i) => (d.max = i === 0 ? 6 : 9));
      bindSeg('cblind', (i) => {
        const depth = d.buyIn / d.bb;
        [d.sb, d.bb] = CREATE_BLINDS[i];
        d.buyIn = d.bb * depth; // keep the same depth in BB
      });
      bindSeg('cstack', (i) => (d.buyIn = d.bb * CREATE_DEPTHS[i]));
      $('create-back').onclick = () => {
        sfx.click();
        screen = user ? 'rooms' : 'login';
        renderOverlay();
      };
      $('create-go').onclick = () => {
        saveJSON('holdem-create', d);
        prepRemote({ max: d.max, players: d.max, sb: d.sb, bb: d.bb, startChips: d.buyIn });
        shareOpen = true; // pop the invite panel as soon as the room exists
        net.send({ t: 'create', cfg: { ...d } });
        screen = 'table';
        layout();
      };
    },
  );
}

function inviteLink(code: string) {
  return `${location.origin}${location.pathname}?room=${encodeURIComponent(code)}`;
}
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const i = document.getElementById('share-link') as HTMLInputElement | null;
    if (!i) return false;
    i.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}
function renderShare() {
  const r = remote.state!.room;
  const link = inviteLink(r.id);
  const canShare = typeof navigator.share === 'function';
  setOverlay(
    `share:${r.id}`,
    `<div class="ov-panel share" role="dialog" aria-label="邀请好友">
      <div class="ov-suit">✉</div>
      <h2>邀请好友入座</h2>
      <p>好友打开链接，注册 / 登录后就会直接进入「${esc(r.name)}」</p>
      <div class="share-code"><small>邀请码</small><b>${esc(r.id)}</b></div>
      <input id="share-link" class="share-link" readonly value="${esc(link)}" />
      <div class="lobby-actions">
        <button class="act ghost" id="share-close">关闭</button>
        ${canShare ? '<button class="act ghost" id="share-sys">发送给…</button>' : ''}
        <button class="act next" id="share-copy">复制邀请链接</button>
      </div>
    </div>`,
    (ov) => {
      const close = () => {
        shareOpen = false;
        renderOverlay();
      };
      $('share-close').onclick = () => {
        sfx.click();
        close();
      };
      $('share-link').onfocus = (e) => (e.target as HTMLInputElement).select();
      $('share-copy').onclick = async () => {
        sfx.click();
        const ok = await copyText(`来和我打德州扑克！房间「${r.name}」邀请码 ${r.id}：${link}`);
        toast(ok ? '邀请链接已复制，发给好友即可' : '复制失败，请长按链接手动复制');
        if (ok) $('share-copy').textContent = '✓ 已复制';
      };
      document.getElementById('share-sys')?.addEventListener('click', () => {
        sfx.click();
        navigator.share({ title: '德州扑克邀请', text: `来和我打德州扑克！房间「${r.name}」邀请码 ${r.id}`, url: link }).catch(() => {});
      });
      ov.onclick = (e) => {
        if (e.target === ov) close();
      };
    },
  );
}

function renderSoloSetup() {
  const seg = (items: string[], active: (i: number) => boolean, attr: string) =>
    items.map((t, i) => `<button class="seg ${active(i) ? 'sel' : ''}" data-${attr}="${i}">${t}</button>`).join('');
  const counts: number[] = [];
  for (let c = 2; c <= draft.max; c++) counts.push(c);
  const running = mode === 'solo' && local.phase !== 'idle' && local.handNo > 0;
  setOverlay(
    `solo:${JSON.stringify(draft)}:${running}:${user}`,
    `<div class="ov-panel lobby">
      <h2>单机练习 · 选择牌桌</h2>
      <div class="lobby-grid">
        <div class="lobby-form">
          <label>房型</label><div class="segs">${seg(['6 人桌 (6max)', '9 人桌 (9max)'], (i) => (i === 0 ? 6 : 9) === draft.max, 'max')}</div>
          <label>入座人数</label><div class="segs counts">${seg(counts.map(String), (i) => counts[i] === Math.min(draft.players, draft.max), 'count')}</div>
          <label>盲注</label><div class="segs">${seg(BLINDS.map(([s, b]) => `${s}/${b}`), (i) => BLINDS[i][1] === draft.bb, 'blind')}</div>
          <label>起始筹码</label><div class="segs">${seg(STACKS.map((c) => `${c.toLocaleString('en-US')}`), (i) => STACKS[i] === draft.startChips, 'stack')}</div>
          <p class="lobby-note">起始 ${draft.startChips.toLocaleString('en-US')} 分 = <b>${+(draft.startChips / draft.bb).toFixed(1)} BB</b>。未坐满时玩家均匀排开。</p>
        </div>
        <div class="lobby-preview"><div class="pv-table"><div class="pv-felt"></div>${lobbyPreview()}</div><small>${Math.min(draft.players, draft.max)}/${draft.max} 人</small></div>
      </div>
      <div class="lobby-actions">
        <button class="act ghost" id="lobby-online">${user ? '返回主页' : '登录联机'}</button>
        ${running ? '<button class="act ghost" id="lobby-cancel">返回牌桌</button>' : ''}
        <button class="act next" id="lobby-start">${running ? '换房间重新开始' : '开始游戏'}</button>
      </div>
    </div>`,
    (ov) => {
      const bindSeg = (attr: string, f: (i: number) => void) =>
        ov.querySelectorAll<HTMLButtonElement>(`[data-${attr}]`).forEach(
          (b) =>
            (b.onclick = () => {
              f(Number(b.getAttribute(`data-${attr}`)));
              sfx.click();
              renderOverlay();
            }),
        );
      bindSeg('max', (i) => {
        draft.max = i === 0 ? 6 : 9;
        if (draft.max === 9 && draft.players === 6) draft.players = 9;
        draft.players = Math.min(draft.players, draft.max);
      });
      bindSeg('count', (i) => (draft.players = counts[i]));
      bindSeg('blind', (i) => ([draft.sb, draft.bb] = BLINDS[i]));
      bindSeg('stack', (i) => (draft.startChips = STACKS[i]));
      $('lobby-start').onclick = () => {
        sfx.click();
        startRoom({ ...draft });
      };
      $('lobby-online').onclick = () => {
        sfx.click();
        showOnline();
      };
      const cancel = document.getElementById('lobby-cancel');
      if (cancel)
        cancel.onclick = () => {
          sfx.click();
          screen = 'table';
          render();
        };
    },
  );
}

function renderOverlay() {
  if (screen === 'login') return renderLogin();
  if (screen === 'rooms') return renderRooms();
  if (screen === 'solo-setup') return renderSoloSetup();
  if (screen === 'create') return renderCreate();
  if (screen === 'table' && shareOpen && mode === 'online' && remote.state) return renderShare();
  if (mode === 'solo' && (local.phase === 'gameover' || local.phase === 'victory')) {
    const win = local.phase === 'victory';
    return setOverlay(
      `over:${local.phase}:${local.handNo}`,
      `<div class="ov-panel">
      <div class="ov-suit">${win ? '♛' : '♠'}</div>
      <h2>${win ? '你赢下了整张牌桌！' : '筹码输光了'}</h2>
      <p>${win ? `历经 ${local.handNo} 手，所有对手都已出局。` : `坚持了 ${local.handNo} 手。再来一局？`}</p>
      <div class="lobby-actions"><button class="act ghost" id="ov-room">换房间</button><button class="act next" id="ov-restart">重新开始</button></div>
    </div>`,
      () => {
        $('ov-restart').onclick = () => {
          sfx.click();
          local.newGame(undefined, room);
        };
        $('ov-room').onclick = () => openSoloSetup();
      },
    );
  }
  setOverlay('', null);
}

// ---------- screen / mode switching ----------
function useLocal() {
  if (mode === 'solo') return;
  mode = 'solo';
  game = local;
  remote.state = null;
  remote.players = [];
  remote.mySeat = -1;
  local.setup(room);
}
function useRemote() {
  if (mode === 'online') return;
  local.clearTimers();
  mode = 'online';
  game = remote;
  openRaise(false);
}

function openSoloSetup() {
  sfx.click();
  if (mode === 'online') leaveRoom(false);
  draft = { ...room };
  screen = 'solo-setup';
  openRaise(false);
  layout();
}

/** Go to the online lobby (login first if needed). */
function showOnline() {
  if (mode === 'solo' && local.handNo > 0) local.setup(room); // abandon the practice game
  screen = user ? 'rooms' : 'login';
  if (net.status !== 'open') net.connect();
  layout();
}

function startRoom(cfg: RoomConfig) {
  room = cfg;
  saveJSON('holdem-room', room);
  useLocal();
  screen = 'table';
  local.newGame(undefined, room);
  layout();
}

function enterRoom(id: string) {
  const r = rooms.find((x) => x.id === id);
  prepRemote(r ? { max: r.max, players: r.max, sb: r.sb, bb: r.bb, startChips: r.buyIn } : undefined);
  net.send({ t: 'join', room: id });
  screen = 'table';
  layout();
}
function prepRemote(cfg?: RoomConfig) {
  sfx.click();
  leavingRoom = false;
  useRemote();
  remote.state = null;
  remote.players = [];
  remote.mySeat = -1;
  if (cfg) remote.room = cfg;
}

function leaveRoom(toRooms = true) {
  if (mode !== 'online') return;
  leavingRoom = true;
  shareOpen = false;
  net.send({ t: 'leave' });
  useLocal();
  if (toRooms) screen = user ? 'rooms' : 'login';
  layout();
}

function logout() {
  sfx.click();
  if (mode === 'online') leaveRoom(false);
  net.send({ t: 'logout' });
  net.persistent = false;
  saveToken(null);
  user = null;
  autoLogin = false;
  screen = 'login';
  layout();
}

// ---------- toast / connection banner ----------
let toastTimer = 0;
function toast(msg: string) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 3200);
}
function renderBanner() {
  const b = $('net-banner');
  const show = mode === 'online' && net.status !== 'open';
  b.hidden = !show;
  if (show) b.textContent = net.status === 'connecting' ? '连接中断，正在重连…' : '连接已断开，稍后自动重连…';
}

function renderTopbar() {
  const online = mode === 'online';
  const inRoom = online && !!remote.state;
  const roomBtn = $('btn-room');
  roomBtn.querySelector('.lbl')!.textContent = online ? '离开' : '牌桌';
  roomBtn.title = online ? '离开房间，回到主页' : '单机牌桌设置（可返回主页）';
  $('btn-new').hidden = online;
  $('btn-share').hidden = !inRoom;
  $('btn-stand').hidden = !inRoom || remote.mySeat < 0;
  $('btn-bot').hidden = !inRoom || !game.players.some((p) => p.empty);
  $('btn-unbot').hidden = !inRoom || !game.players.some((p) => !p.empty && p.style.label.startsWith('电脑') && !p.leaving);
  renderBanner();
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
  if (s === 'closed' && !user) {
    autoLogin = false;
    if (authBusy) {
      authBusy = false;
      authErr = '无法连接联机服务器';
    }
    pendingAuth = null;
  }
  renderOverlay();
  renderBanner();
};
net.onMessage = (m: ServerMsg) => {
  switch (m.t) {
    case 'authed':
      user = m.user;
      authBusy = false;
      authErr = '';
      autoLogin = false;
      saveToken(m.token);
      net.persistent = true;
      if (screen === 'login') screen = 'rooms';
      if (inviteCode) {
        // opened through an invite link: go straight into that room
        const code = inviteCode;
        clearInvite();
        enterRoom(code);
        break;
      }
      // reconnected inside a room: make sure the server has us there (it may have restarted)
      if (mode === 'online' && remote.state && !leavingRoom) net.send({ t: 'join', room: remote.state.room.id });
      render();
      break;
    case 'authFail':
      authBusy = false;
      authErr = autoLogin ? '' : m.msg;
      if (autoLogin) saveToken(null);
      autoLogin = false;
      user = null;
      net.persistent = false;
      if (mode === 'online') useLocal();
      if (screen !== 'solo-setup' && screen !== 'table') screen = 'login';
      layout();
      break;
    case 'kicked':
      user = null;
      authErr = m.msg;
      net.disconnect();
      if (mode === 'online') useLocal();
      screen = 'login';
      layout();
      break;
    case 'rooms':
      rooms = m.rooms;
      if (screen === 'rooms') renderOverlay();
      break;
    case 'state': {
      if (leavingRoom) break;
      // also covers reloading the page while seated: the server restores your room
      const wasMax = game.room.max;
      if (mode !== 'online') {
        if (screen === 'solo-setup' || (screen === 'table' && local.handNo > 0)) {
          net.send({ t: 'leave' });
          break;
        }
        useRemote();
      }
      screen = 'table';
      const before = remote.mySeat;
      remote.apply(m.state);
      if (before !== remote.mySeat) seen.clear();
      if (wasMax !== game.room.max || before !== remote.mySeat || (ovKey && !ovKey.startsWith('share:'))) layout();
      else render();
      break;
    }
    case 'left':
      leavingRoom = false;
      break;
    case 'joinFail':
      shareOpen = false;
      toast(m.msg);
      if (mode === 'online') useLocal();
      screen = user ? 'rooms' : 'login';
      layout();
      break;
    case 'ev':
      if (mode === 'online') onGameEvent(m.e);
      break;
    case 'notice':
    case 'error':
      toast(m.msg);
      break;
  }
};

// ---------- theme popover ----------
function renderThemePop() {
  const pop = $('theme-pop');
  pop.innerHTML =
    '<h3>牌桌主题</h3><div class="theme-grid">' +
    THEMES.map(
      (t) => `<button class="theme-opt ${t.id === theme ? 'sel' : ''}" data-theme="${t.id}" data-pick="${t.id}">
        <div class="mini"><div class="mini-rail"><div class="mini-felt felt"><span class="mini-card"></span><span class="mini-card"></span><span class="mini-card back"></span></div></div></div>
        <b>${t.name}</b><small>${t.tagline}</small></button>`,
    ).join('') +
    '</div>';
  pop.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      theme = b.dataset.pick!;
      applyTheme(theme);
      sfx.click();
      renderThemePop();
    };
  });
}
function toggleThemePop(force?: boolean) {
  const pop = $('theme-pop');
  const open = force ?? pop.hidden;
  pop.hidden = !open;
  $('btn-theme').classList.toggle('on', open);
  if (open) renderThemePop();
}

// ---------- input ----------
function doAct(kind: 'fold' | 'call' | 'raise' | 'allin') {
  if (!game.isHumanTurn() || screen !== 'table') return;
  if (kind === 'raise') {
    if ($<HTMLButtonElement>('act-raise').disabled) return;
    if (!raiseOpen) {
      sfx.click();
      openRaise(true);
      return;
    }
    const v = raiseValue;
    openRaise(false);
    const { maxTo } = raiseBounds();
    game.humanAct(v >= maxTo ? { type: 'allin' } : { type: 'raise', to: v });
    return;
  }
  openRaise(false);
  if (kind === 'fold') game.humanAct({ type: 'fold' });
  else if (kind === 'call') game.humanAct({ type: 'call' });
  else if (!$<HTMLButtonElement>('act-allin').disabled) game.humanAct({ type: 'allin' });
}

$('act-fold').onclick = () => doAct('fold');
$('act-call').onclick = () => doAct('call');
$('act-raise').onclick = () => doAct('raise');
$('act-allin').onclick = () => doAct('allin');
$('act-next').onclick = () => {
  sfx.click();
  game.nextHand();
};
rangeEl.oninput = onSlider;
raisePanel.querySelectorAll<HTMLButtonElement>('[data-preset]').forEach((b) => {
  b.onclick = () => {
    sfx.click();
    const { minTo, maxTo } = raiseBounds();
    const pot = game.potTotal() + game.toCall(game.human!);
    const r = (v: number) => Math.round(v / game.sb) * game.sb;
    const v = {
      min: minTo,
      half: game.currentBet + r(pot / 2),
      pot: game.currentBet + r(pot),
      max: maxTo,
    }[b.dataset.preset as 'min' | 'half' | 'pot' | 'max'];
    setRaise(v);
  };
});

$('btn-theme').onclick = (e) => {
  e.stopPropagation();
  sfx.click();
  toggleThemePop();
};
$('btn-ladder').onclick = () => {
  sfx.click();
  ladderOpen = !ladderOpen;
  renderLadder();
};
$('btn-unit').onclick = () => {
  unit = unit === 'bb' ? 'chips' : 'bb';
  try {
    localStorage.setItem('holdem-unit', unit);
  } catch {
    /* ignore */
  }
  sfx.click();
  render();
};
$('btn-room').onclick = () => {
  sfx.click();
  if (mode === 'online') leaveRoom();
  else {
    draft = { ...room };
    screen = 'solo-setup';
    openRaise(false);
    renderOverlay();
  }
};
$('btn-sound').onclick = () => {
  setMuted(!isMuted());
  updateSoundIcon();
  sfx.click();
};
function updateSoundIcon() {
  $('sound-ico').textContent = isMuted() ? '✕' : '♪';
  $('btn-sound').classList.toggle('off', isMuted());
}
updateSoundIcon();
document.addEventListener('click', (e) => {
  const pop = $('theme-pop');
  if (!pop.hidden && !pop.contains(e.target as Node)) toggleThemePop(false);
});

window.addEventListener('keydown', (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    toggleThemePop(false);
    openRaise(false);
    ladderOpen = false;
    renderLadder();
    if (shareOpen) {
      shareOpen = false;
      renderOverlay();
    }
    return;
  }
  if (screen !== 'table') {
    if (screen === 'solo-setup' && k === 'enter') startRoom({ ...draft });
    return;
  }
  if (mode === 'solo' && game.phase === 'handover' && (k === ' ' || k === 'enter')) {
    e.preventDefault();
    game.nextHand();
    return;
  }
  if (!game.isHumanTurn()) return;
  if (k === 'f') doAct('fold');
  else if (k === 'c' || k === 'k') doAct('call');
  else if (k === 'r') doAct('raise');
  else if (k === 'a') doAct('allin');
  else if (k === 'enter' && raiseOpen) doAct('raise');
});

// ---------- game hooks ----------
function onGameEvent(e: GameEvent) {
  const me = meId();
  if (e.type === 'deal') sfx.card(3);
  else if (e.type === 'board') sfx.card(e.count === 3 ? 3 : 1);
  else if (e.type === 'action') {
    if (e.action === 'fold') sfx.fold();
    else if (e.action === 'check') sfx.check();
    else sfx.chip();
  } else if (e.type === 'turn' && me >= 0 && e.player === me) sfx.turn();
  else if (e.type === 'win') {
    const h = game.human;
    if (!h) return;
    if (e.pots.some((p) => p.winners.includes(me) && !p.refund)) sfx.win();
    else if (!h.folded && h.hole.length) sfx.lose();
  }
}
local.onUpdate = () => {
  if (mode === 'solo') render();
};
local.onEvent = (e) => {
  if (mode === 'solo') onGameEvent(e);
};

new ResizeObserver(() => layout()).observe($('table-wrap'));

// tick the online action clock
setInterval(() => {
  if (mode !== 'online' || !remote.turnDeadline) return;
  const f = clockFrac();
  document.querySelectorAll<HTMLElement>('.clock').forEach((c) => {
    c.style.transform = `scaleX(${f.toFixed(3)})`;
    c.classList.toggle('low', f < 0.3);
  });
  if (game.isHumanTurn() && !raiseOpen) $('status').textContent = (game.human?.locked ? '对手不足额全下：你只能跟注或弃牌' : '轮到你了') + clockText();
}, 250);

// test bridge (optional; gameplay never depends on it)
(globalThis as unknown as { __OHMYGAME_PLAYTEST__: unknown }).__OHMYGAME_PLAYTEST__ = {
  snapshot: () => ({
    ...(mode === 'solo' ? local.snapshot() : { room: remote.state?.room, phase: game.phase, street: game.street, turn: game.turn, handNo: game.handNo, pot: game.potTotal(), board: game.board.map(cardKey), mySeat: remote.mySeat, players: game.players.map((p) => (p.empty ? null : { name: p.name, chips: p.chips, bet: p.bet, folded: p.folded, out: p.out, waiting: p.waiting, last: p.lastLabel })) }),
    mode,
    screen,
    user,
    net: net.status,
    rooms: rooms.map((r) => `${r.id}:${r.seated}/${r.max}`),
    theme,
    unit,
    ui: { themePopOpen: !$('theme-pop').hidden, ladderOpen, raiseOpen },
  }),
  reset: () => {
    if (mode === 'solo') startRoom({ ...room });
  },
  setSeed: (s: number) => {
    if (mode !== 'solo') return;
    screen = 'table';
    local.newGame(s, room);
    layout();
  },
};

// ---------- boot ----------
$('btn-new').onclick = () => {
  if (mode !== 'solo') return;
  sfx.click();
  startRoom({ ...room });
};
$('btn-share').onclick = () => {
  sfx.click();
  shareOpen = true;
  renderOverlay();
};
$('btn-stand').onclick = () => {
  sfx.click();
  net.send({ t: 'stand' });
};
$('btn-bot').onclick = () => {
  sfx.click();
  net.send({ t: 'addBot' });
};
$('btn-unbot').onclick = () => {
  sfx.click();
  net.send({ t: 'removeBots' });
};
$('seats').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-sit]');
  if (!b || mode !== 'online') return;
  sfx.click();
  net.send({ t: 'sit', seat: Number(b.dataset.sit) });
});

// an empty table sits behind the login / lobby screens
local.setup(room);
net.connect();
layout();
