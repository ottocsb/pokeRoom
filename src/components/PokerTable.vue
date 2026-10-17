<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { cardKey, type Card } from '../cards';
import { sfx } from '../sound';
import { EMOTES } from '../protocol';
import { actionText, clockFrac, game, hl, money, moneyU, net, remote, RINGS, seatMap, sendEmote, summaryText, toggleEmotePick, ui } from '../store';
import PlayingCard from './PlayingCard.vue';

// ---------- table size (was layout()) ----------
const wrap = ref<HTMLElement>();
const W = ref(0);
const H = ref(0);
let ro: ResizeObserver | undefined;
onMounted(() => {
  ro = new ResizeObserver(() => {
    W.value = wrap.value!.clientWidth;
    H.value = wrap.value!.clientHeight;
  });
  ro.observe(wrap.value!);
  document.addEventListener('click', closePick);
});
onBeforeUnmount(() => {
  ro?.disconnect();
  document.removeEventListener('click', closePick);
});

const portrait = computed(() => W.value / Math.max(1, H.value) < 1.15);
const nine = computed(() => game.value.room.max === 9);
const tableStyle = computed(() => {
  let tw: number, th: number;
  if (portrait.value) {
    const aw = W.value - (nine.value ? 64 : 56);
    const ah = H.value - 76;
    tw = Math.min(aw, ah * 0.7);
    th = tw / 0.7;
  } else {
    const aw = W.value - 160;
    const ah = H.value - 88;
    tw = Math.min(aw, ah * 2.05);
    th = tw / 2.05;
  }
  tw = Math.max(200, tw);
  th = Math.max(150, th);
  const bc = portrait.value ? Math.min(74, tw * 0.145) : Math.min(88, tw * 0.074);
  let fs = portrait.value ? Math.max(9.5, Math.min(13, tw * 0.034)) : Math.max(10, Math.min(14, tw * 0.016));
  if (nine.value) fs *= portrait.value ? 0.86 : 0.9;
  return { width: `${Math.round(tw)}px`, height: `${Math.round(th)}px`, '--bc': `${bc.toFixed(1)}px`, '--sfs': `${fs.toFixed(2)}px` };
});

// ---------- seats ----------
const view = computed(() => {
  const g = game.value;
  const pos = RINGS[g.room.max];
  const h = hl.value;
  const showdown = g.phase === 'handover' && g.street === 'showdown';
  const { slotOf, empty } = seatMap(g);
  const canSit = ui.mode === 'online' && remote.mySeat < 0 && !!remote.state;
  const empties = empty.map(({ slot, seat }) => ({ seat, x: pos[slot][0], y: pos[slot][1] }));
  const seats = [];
  const bets = [];
  for (const p of g.players) {
    const slot = slotOf.get(p.id);
    if (slot === undefined || p.empty) continue;
    const [x, y] = pos[slot];
    const showing = !!p.shown?.length && g.phase === 'handover';
    const cls = [
      p.isHuman ? 'human' : '',
      p.folded && !p.out ? 'folded' : '',
      p.out ? 'out' : '',
      p.offline || p.leaving ? 'away' : '',
      g.turn === p.id && g.phase === 'betting' ? 'active' : '',
      p.won > 0 && g.phase === 'handover' ? 'winner' : '',
      x < 25 ? 'side-left' : x > 75 ? 'side-right' : '',
      y < 35 ? 'top' : '',
      y > 70 && !p.isHuman ? 'bottom' : '',
      showing ? 'showing' : '',
    ];
    const show = p.revealed && !p.folded;
    const cards =
      !p.isHuman && p.hole.length
        ? p.hole.map((c: Card | null, k) =>
            show || (c && showing && p.shown!.includes(k))
              ? { card: c, k: `s${p.id}f${k}`, cls: h.owner === p.id && c && h.keys.has(cardKey(c)) ? 'core' : '', delay: 0 }
              : { card: null, k: `s${p.id}b${k}`, cls: '', delay: (k * 5 + p.id) * 50 },
          )
        : [];
    seats.push({
      id: p.id,
      x,
      y,
      cls,
      cards,
      avatar: p.avatar,
      name: p.name,
      dealer: g.dealer === p.id,
      style: p.isHuman ? '' : p.style.label,
      chips: p.waiting ? '下一手加入' : p.out ? '出局' : money(p.chips),
      clock: ui.mode === 'online' && g.turn === p.id && g.phase === 'betting' && !!remote.turnDeadline,
      bubble: showing ? '秀牌' : p.lastLabel && !showdown ? actionText(p) : '',
      tag: showdown && p.result && !p.folded ? p.result.desc : '',
      tagWin: p.won > 0,
      won: p.won > 0 && g.phase === 'handover' ? `+${money(p.won)}` : '',
    });
    if (p.bet > 0) {
      const side = Math.abs(x - 50) > 40 && y > 35 && y < 70;
      const t = side ? (portrait.value ? 0.26 : 0.3) : portrait.value ? 0.4 : 0.42;
      bets.push({ id: p.id, x: x + (50 - x) * t, y: y + (50 - y) * t, amount: moneyU(p.bet) });
    }
  }
  return { canSit, empties, seats, bets };
});

const board = computed(() => {
  const g = game.value;
  const h = hl.value;
  const out = [];
  for (let k = 0; k < 5; k++) {
    const c = g.board[k];
    if (!c) {
      out.push(null);
      continue;
    }
    const core = h.keys.has(cardKey(c));
    const dim = h.cat >= 1 && !core;
    out.push({ card: c, k: `b${k}`, cls: `${core ? 'core' : ''} ${dim ? 'dim' : ''}`, delay: (k < 3 ? k : 0) * 110 });
  }
  return out;
});

const pot = computed(() => {
  const g = game.value;
  return g.phase === 'handover' ? g.pots.reduce((s, p) => s + p.amount, 0) : g.potTotal();
});
const msg = computed(() => (game.value.phase === 'handover' ? summaryText() : ''));
const clock = computed(() => clockFrac());
const clockSecs = computed(() => Math.ceil(Math.max(0, remote.turnDeadline - ui.now) / 1000));
const handNo = computed(() => game.value.handNo);

// ---------- emotes ----------
function closePick(e: MouseEvent) {
  if (ui.emotePick >= 0 && !(e.target as Element).closest?.('.emote-pick, .avatar')) ui.emotePick = -1;
}
/** emotes in flight: from the sender's seat to the target's (same spot when sent to yourself) */
const emotes = computed(() => {
  const at = new Map(view.value.seats.map((s) => [s.id, s]));
  return ui.emotes.flatMap((e) => {
    const to = at.get(e.to);
    if (!to) return [];
    const from = at.get(e.from) ?? to;
    return [{ id: e.id, emoji: e.emoji, style: { '--fx': `${from.x}%`, '--fy': `${from.y}%`, '--tx': `${to.x}%`, '--ty': `${to.y}%` } }];
  });
});

function toggleFlow() {
  if (ui.mode !== 'online') return;
  sfx.click();
  ui.flowOpen = !ui.flowOpen;
}

function sit(seat: number) {
  if (ui.mode !== 'online') return;
  sfx.click();
  net.send({ t: 'sit', seat });
}
</script>

<template>
  <div class="table-wrap" id="table-wrap" ref="wrap">
    <div class="table" id="table" :class="{ portrait, nine }" :style="tableStyle">
      <div class="rail"></div>
      <div class="felt"><div class="emblem"></div></div>
      <div class="pot" id="pot" :class="{ clickable: ui.mode === 'online' }" title="查看本手行动路线" @click="toggleFlow">
        <template v-if="pot > 0"><span>底池</span><b>{{ money(pot) }}</b></template>
      </div>
      <div class="board" id="board">
        <template v-for="(b, k) in board" :key="b ? `${handNo}-${b.k}` : `slot${k}`">
          <PlayingCard v-if="b" :card="b.card" :k="b.k" :cls="b.cls" :delay="b.delay" />
          <div v-else class="card slot"></div>
        </template>
      </div>
      <div class="msg" id="msg" :class="{ show: !!msg }">{{ msg }}</div>
      <div id="seats">
        <template v-for="e in view.empties" :key="`e${e.seat}`">
          <button
            v-if="view.canSit"
            class="seat-empty sit"
            :style="{ left: `${e.x}%`, top: `${e.y}%` }"
            :title="`坐到 ${e.seat + 1} 号座`"
            @click="sit(e.seat)"
          >
            <span>入座</span>
          </button>
          <div v-else class="seat-empty" :style="{ left: `${e.x}%`, top: `${e.y}%` }"><span>空座</span></div>
        </template>
        <div
          v-for="s in view.seats"
          :key="`p${s.id}`"
          class="seat"
          :class="[s.cls, { picking: ui.emotePick === s.id }]"
          :style="{ left: `${s.x}%`, top: `${s.y}%` }"
        >
          <div v-if="s.cards.length" class="seat-cards">
            <PlayingCard v-for="c in s.cards" :key="`${handNo}-${c.k}`" :card="c.card" :k="c.k" :cls="c.cls" :delay="c.delay" />
          </div>
          <div class="plate">
            <div class="avatar" title="发送表情" @click="toggleEmotePick(s.id)">{{ s.avatar }}<span v-if="s.dealer" class="dealer" title="庄家">D</span></div>
            <div class="info">
              <div class="name"><span class="nm">{{ s.name }}</span><span v-if="s.style" class="style-tag">{{ s.style }}</span></div>
              <div class="chips">{{ s.chips }}</div>
            </div>
            <i v-if="s.clock" class="clock" :class="{ low: clock < 0.3 }" :style="{ transform: `scaleX(${clock.toFixed(3)})` }"></i>
            <b v-if="s.clock" class="clock-num" :class="{ low: clock < 0.3 }">{{ clockSecs }}</b>
          </div>
          <div v-if="s.bubble" class="bubble">{{ s.bubble }}</div>
          <div v-if="s.tag" class="hand-tag" :class="{ win: s.tagWin }">{{ s.tag }}</div>
          <div v-if="s.won" class="won">{{ s.won }}</div>
          <div v-if="ui.says[s.id]" :key="ui.says[s.id].id" class="chat-say">{{ ui.says[s.id].text }}</div>
          <div v-if="ui.emotePick === s.id" class="emote-pick">
            <button v-for="em in EMOTES" :key="em" @click="sendEmote(s.id, em)">{{ em }}</button>
          </div>
        </div>
        <div v-for="b in view.bets" :key="`bet${b.id}`" class="bet" :style="{ left: `${b.x}%`, top: `${b.y}%` }">
          <i class="chip"></i>{{ b.amount }}
        </div>
        <div v-for="e in emotes" :key="`em${e.id}`" class="emote" :style="e.style">{{ e.emoji }}</div>
      </div>
    </div>
  </div>
</template>
