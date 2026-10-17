<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { CATEGORY_HINTS, CATEGORY_NAMES } from './evaluator';
import { sfx } from './sound';
import { THEMES } from './themes';
import {
  can,
  closeTable,
  doAct,
  game,
  heroCat,
  leaveRoom,
  local,
  net,
  openHistory,
  openRaise,
  pickTheme,
  remote,
  soloRoom,
  startRoom,
  toggleSound,
  toggleUnit,
  ui,
} from './store';
import PokerTable from './components/PokerTable.vue';
import HeroPanel from './components/HeroPanel.vue';
import HandFlow from './components/HandFlow.vue';
import ChatPanel from './components/ChatPanel.vue';
import LoginPanel from './components/overlays/LoginPanel.vue';
import HomePanel from './components/overlays/HomePanel.vue';
import CreatePanel from './components/overlays/CreatePanel.vue';
import SharePanel from './components/overlays/SharePanel.vue';
import HistoryPanel from './components/overlays/HistoryPanel.vue';
import SoloSetupPanel from './components/overlays/SoloSetupPanel.vue';
import GameOverPanel from './components/overlays/GameOverPanel.vue';
import SettlePanel from './components/overlays/SettlePanel.vue';
import BuyInPanel from './components/overlays/BuyInPanel.vue';
import RecordsPanel from './components/overlays/RecordsPanel.vue';

const online = computed(() => ui.mode === 'online');
const inRoom = computed(() => (game.value, online.value && !!remote.state));

const meta = computed(() => {
  const g = game.value;
  const st = online.value ? remote.state : null;
  const roomName = st ? `${st.room.name}${st.room.private ? ` (${st.room.id})` : ''} · ` : '';
  const watchers = st?.watchers.length ? ` · 旁观 ${st.watchers.length}` : '';
  const bomb = st?.room.bomb ? ` · 暴击 ${st.room.bomb}BB` : '';
  return `${roomName}${g.room.max === 9 ? '9人桌' : '6人桌'} · 盲注 ${g.sb}/${g.bb}${bomb}${g.handNo ? ` · 第 ${g.handNo} 手` : ''}${watchers}`;
});
/** action line of the current hand, opened by clicking the pot */
const flow = computed(() => {
  const g = game.value;
  if (!ui.flowOpen || !online.value || !remote.state) return null;
  return { handNo: g.handNo, actions: remote.state.actions, board: g.board, nameOf: (seat: number) => g.players[seat]?.name || `${seat + 1}号` };
});
const seated = computed(() => inRoom.value && remote.mySeat >= 0);
const isOwner = computed(() => inRoom.value && remote.state!.room.owner === ui.user);
/** buy-in requests the owner has to answer */
const requests = computed(() => (game.value, isOwner.value ? remote.state!.requests : []));
const hasEmpty = computed(() => game.value.players.some((p) => p.empty));
const hasBots = computed(() => game.value.players.some((p) => !p.empty && p.style.label.startsWith('电脑') && !p.leaving));
const appClass = computed(() => {
  const h = game.value.human;
  return { 'my-turn': can.value.my, spectate: !h && online.value };
});
const banner = computed(() => {
  game.value;
  if (inRoom.value && remote.state!.closing && ui.netStatus === 'open') return '房主已关闭牌桌，本手结束后结算';
  if (!online.value || ui.netStatus === 'open') return '';
  return ui.netStatus === 'connecting' ? '连接中断，正在重连…' : '连接已断开，稍后自动重连…';
});

/** which overlay panel is showing ('' = none) */
const overlay = computed(() => {
  game.value; // re-check engine phases on every update
  if (ui.settle) return 'settle';
  if (ui.screen === 'login') return 'login';
  if (ui.screen === 'rooms') return 'rooms';
  if (ui.screen === 'solo-setup') return 'solo-setup';
  if (ui.screen === 'create') return 'create';
  if (ui.screen === 'records') return 'records';
  // owner must answer buy-in requests before doing anything else (cannot be dismissed)
  if (ui.screen === 'table' && requests.value.length) return 'buyin';
  if (ui.screen === 'table' && ui.shareOpen && online.value && remote.state) return 'share';
  if (ui.screen === 'table' && ui.historyOpen && online.value && remote.state) return 'history';
  if (!online.value && (local.phase === 'gameover' || local.phase === 'victory')) return 'over';
  return '';
});
function onOverlayClick(e: MouseEvent) {
  if (e.target !== e.currentTarget) return;
  if (overlay.value === 'share') ui.shareOpen = false;
  if (overlay.value === 'history') ui.historyOpen = false;
}

// ---------- top bar ----------
function send(t: 'stand' | 'addBot' | 'removeBots') {
  sfx.click();
  net.send({ t });
}
function onRoomBtn() {
  sfx.click();
  if (online.value) leaveRoom();
  else {
    ui.draft = { ...soloRoom() };
    ui.screen = 'solo-setup';
    openRaise(false);
  }
}
function onNew() {
  if (online.value) return;
  sfx.click();
  startRoom({ ...soloRoom() });
}
function onShare() {
  sfx.click();
  ui.shareOpen = true;
}
function onHistory() {
  sfx.click();
  openHistory();
}
function onLadder() {
  sfx.click();
  ui.ladderOpen = !ui.ladderOpen;
}
function onTheme() {
  sfx.click();
  menuOpen.value = false;
  ui.themeOpen = !ui.themeOpen;
}

// ---------- global input ----------
const themePop = ref<HTMLElement>();
/** phones: the top bar collapses into a ☰ menu */
const menuOpen = ref(false);
function onDocClick(e: MouseEvent) {
  if (ui.themeOpen && !themePop.value?.contains(e.target as Node)) ui.themeOpen = false;
  if (menuOpen.value && !(e.target as Element).closest?.('.topbar')) menuOpen.value = false;
}
function onKey(e: KeyboardEvent) {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    ui.themeOpen = false;
    openRaise(false);
    ui.ladderOpen = false;
    ui.shareOpen = false;
    ui.historyOpen = false;
    ui.flowOpen = false;
    ui.emotePick = -1;
    ui.chatOpen = false;
    menuOpen.value = false;
    // leave the chat box so the game hotkeys work again
    if (document.activeElement instanceof HTMLInputElement && document.activeElement.type === 'text') document.activeElement.blur();
    return;
  }
  // typing in a text box (chat, raise amount) must not trigger the game hotkeys
  if (e.target instanceof HTMLInputElement && (e.target.type === 'text' || e.target.type === 'number')) return;
  if (overlay.value === 'buyin') return;
  if (ui.screen !== 'table') {
    if (ui.screen === 'solo-setup' && k === 'enter') startRoom({ ...ui.draft });
    return;
  }
  const g = game.value;
  if (!online.value && g.phase === 'handover' && (k === ' ' || k === 'enter')) {
    e.preventDefault();
    g.nextHand();
    return;
  }
  if (!g.isHumanTurn()) return;
  if (k === 'f') doAct('fold');
  else if (k === 'c' || k === 'k') doAct('call');
  else if (k === 'r') doAct('raise');
  else if (k === 'a') doAct('allin');
  else if (k === 'enter' && ui.raiseOpen) doAct('raise');
}
onMounted(() => {
  document.addEventListener('click', onDocClick);
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick);
  window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div id="app" :class="appClass">
    <header class="topbar" :class="{ 'menu-open': menuOpen }">
      <div class="brand">
        <span class="logo">♠</span>
        <span class="title">德州扑克</span>
        <span class="meta" id="meta">{{ meta }}</span>
      </div>
      <button class="tbtn menu-btn" title="菜单" @click="menuOpen = !menuOpen">
        <span class="ico">{{ menuOpen ? '✕' : '☰' }}</span>
      </button>
      <nav class="top-actions" @click="menuOpen = false">
        <div class="menu-meta">{{ meta }}</div>
        <button class="tbtn invite" id="btn-share" title="邀请好友：复制带邀请码的房间链接" :hidden="!inRoom" @click="onShare">
          <span class="ico">✉</span><span class="lbl">邀请</span>
        </button>
        <button class="tbtn" id="btn-history" title="查看本房间每手牌和玩家输赢" :hidden="!inRoom" @click="onHistory">
          <span class="ico">☰</span><span class="lbl">战绩</span>
        </button>
        <button class="tbtn" id="btn-stand" title="起身离座（旁观）" :hidden="!seated" @click="send('stand')">
          <span class="ico">⇣</span><span class="lbl">起身</span>
        </button>
        <button class="tbtn" id="btn-bot" title="在空座添加一名电脑玩家" :hidden="!inRoom || !hasEmpty" @click="send('addBot')">
          <span class="ico">+</span><span class="lbl">电脑</span>
        </button>
        <button class="tbtn" id="btn-unbot" title="本手结束后移除所有电脑玩家" :hidden="!inRoom || !hasBots" @click="send('removeBots')">
          <span class="ico">−</span><span class="lbl">电脑</span>
        </button>
        <button class="tbtn" id="btn-close" title="关闭牌桌并结算所有玩家输赢" :hidden="!isOwner" @click="closeTable">
          <span class="ico">⏻</span><span class="lbl">关桌</span>
        </button>
        <button class="tbtn" id="btn-room" :title="online ? '离开房间，回到主页' : '单机牌桌设置（可返回主页）'" @click="onRoomBtn">
          <span class="ico">⌂</span><span class="lbl">{{ online ? '离开' : '牌桌' }}</span>
        </button>
        <button
          class="tbtn unit"
          id="btn-unit"
          :title="ui.unit === 'bb' ? '当前以大盲(BB)显示，点击切换为分数' : '当前以分数显示，点击切换为大盲(BB)'"
          @click="toggleUnit"
        >
          <span class="ico">⇄</span><span class="lbl-fixed" id="unit-lbl">{{ ui.unit === 'bb' ? 'BB' : '分' }}</span>
        </button>
        <button class="tbtn" id="btn-ladder" :class="{ on: ui.ladderOpen }" title="牌型表" @click="onLadder">
          <span class="ico">▤</span><span class="lbl">牌型</span>
        </button>
        <button class="tbtn" id="btn-theme" :class="{ on: ui.themeOpen }" title="更换牌桌主题" @click.stop="onTheme">
          <span class="ico">◐</span><span class="lbl">主题</span>
        </button>
        <button class="tbtn" id="btn-sound" :class="{ off: ui.muted }" title="音效" @click="toggleSound">
          <span class="ico" id="sound-ico">{{ ui.muted ? '✕' : '♪' }}</span><span class="lbl-m">{{ ui.muted ? '音效已关' : '音效' }}</span>
        </button>
        <button class="tbtn" id="btn-new" title="重新开始" :hidden="online" @click="onNew"><span class="ico">↻</span><span class="lbl">重开</span></button>
      </nav>
    </header>

    <main class="stage">
      <aside class="ladder" id="ladder" :class="{ open: ui.ladderOpen }" aria-label="牌型表">
        <h3>牌型大小</h3>
        <ol>
          <li v-for="i in [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]" :key="i" :class="{ cur: i === heroCat }">
            <span class="lv">{{ i + 1 }}</span><span class="nm">{{ CATEGORY_NAMES[i] }}</span><span class="ht">{{ CATEGORY_HINTS[i] }}</span
            ><span v-if="i === heroCat" class="you">你</span>
          </li>
        </ol>
      </aside>
      <aside v-if="flow" class="flow-pop" aria-label="本手行动路线">
        <h3>第 {{ flow.handNo }} 手 · 行动路线<button class="x" title="关闭" @click="ui.flowOpen = false">✕</button></h3>
        <HandFlow v-if="flow.actions.length" :actions="flow.actions" :board="flow.board" :name-of="flow.nameOf" />
        <p v-else class="dim">本手还没有开始</p>
      </aside>
      <PokerTable />
      <ChatPanel v-if="inRoom" />
    </main>

    <HeroPanel />

    <div class="popover" id="theme-pop" ref="themePop" :hidden="!ui.themeOpen">
      <h3>牌桌主题</h3>
      <div class="theme-grid">
        <button
          v-for="t in THEMES"
          :key="t.id"
          class="theme-opt"
          :class="{ sel: t.id === ui.theme }"
          :data-theme="t.id"
          @click.stop="pickTheme(t.id)"
        >
          <div class="mini">
            <div class="mini-rail">
              <div class="mini-felt felt"><span class="mini-card"></span><span class="mini-card"></span><span class="mini-card back"></span></div>
            </div>
          </div>
          <b>{{ t.name }}</b><small>{{ t.tagline }}</small>
        </button>
      </div>
    </div>
    <div class="net-banner" id="net-banner" :hidden="!banner">{{ banner }}</div>
    <div v-if="ui.toast" :key="ui.toastId" class="toast show" id="toast" role="status">{{ ui.toast }}</div>
    <div class="overlay" id="overlay" :hidden="!overlay" @click="onOverlayClick">
      <LoginPanel v-if="overlay === 'login'" />
      <HomePanel v-else-if="overlay === 'rooms'" />
      <SoloSetupPanel v-else-if="overlay === 'solo-setup'" />
      <CreatePanel v-else-if="overlay === 'create'" />
      <SharePanel v-else-if="overlay === 'share'" />
      <HistoryPanel v-else-if="overlay === 'history'" />
      <GameOverPanel v-else-if="overlay === 'over'" />
      <SettlePanel v-else-if="overlay === 'settle'" />
      <BuyInPanel v-else-if="overlay === 'buyin'" />
      <RecordsPanel v-else-if="overlay === 'records'" />
    </div>
  </div>
</template>
