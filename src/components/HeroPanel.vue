<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { cardKey, rankLabel, SUIT_SYMBOL } from '../cards';
import { describeDraws, describeHole, evaluate } from '../evaluator';
import { sfx } from '../sound';
import { can, doAct, game, heroCat, hl, money, onSlider, raiseBounds, remote, setPreAct, setRaise, showCards, statusText, ui, voteRuns } from '../store';
import PlayingCard from './PlayingCard.vue';

const handNo = computed(() => game.value.handNo);

const hole = computed(() => {
  const g = game.value;
  const h = g.human;
  if (!h || !h.hole.length) return [];
  return h.hole.map((c, k) => ({
    card: c,
    k: `h${k}`,
    cls: `${hl.value.owner === h.id && hl.value.keys.has(cardKey(c)) ? 'core' : ''} ${h.shown?.includes(k) ? 'shown' : ''}`,
    delay: k * 300,
  }));
});
const holeFolded = computed(() => {
  const h = game.value.human;
  return !!h && h.folded && !h.out;
});

const badge = computed(() => {
  const g = game.value;
  const h = g.human;
  const stack = h ? (ui.unit === 'bb' ? `${h.chips.toLocaleString('en-US')} 分` : `${+(h.chips / g.bb).toFixed(1)} BB`) : '';
  if (!h || !h.hole.length) {
    const sub = !h && ui.mode === 'online' ? '旁观中' : h?.waiting ? '下一手开始加入' : '';
    return { stack, name: '—', sub, cat: -1 };
  }
  const r = evaluate([...h.hole, ...g.board]);
  const subs: string[] = [];
  if (h.folded) subs.push('已弃牌');
  if (g.board.length === 0) subs.push(describeHole(h.hole));
  else subs.push(...describeDraws(h.hole, g.board));
  if (g.board.length && r.cat > 0 && r.core.every((c) => g.board.includes(c))) subs.push('全部来自公共牌');
  return { stack, name: r.desc, sub: subs.join(' · '), cat: r.cat };
});

// level-up flash when the hand category improves within a hand
const badgeEl = ref<HTMLElement>();
let lastCat = -1;
let lastCatHand = -1;
watch([heroCat, handNo], ([cat, hand]) => {
  if (cat < 0) return;
  if (lastCatHand !== hand) {
    lastCatHand = hand;
    lastCat = cat;
  } else if (cat > lastCat) {
    lastCat = cat;
    const el = badgeEl.value!;
    el.classList.remove('level-up');
    void el.offsetWidth;
    el.classList.add('level-up');
    sfx.levelUp();
  }
});

// ---------- buttons ----------
const toCall = computed(() => {
  const g = game.value;
  return g.human ? g.toCall(g.human) : 0;
});
const allinAmount = computed(() => (game.value.human ? money(game.value.human.chips) : ''));
const raiseLabel = computed(() => {
  const g = game.value;
  const h = g.human;
  if (ui.raiseOpen) return { label: g.currentBet === 0 ? '下注' : '加注到', value: money(ui.raiseValue) };
  return {
    label: g.currentBet === 0 ? '下注' : '加注',
    value: h && can.value.my ? `≥ ${money(Math.min(g.minRaiseTo(), h.bet + h.chips))}` : '',
  };
});
const handover = computed(() => game.value.phase === 'handover');
const online = computed(() => ui.mode === 'online');
/** not your turn yet but still in the hand: you may pick fold / check-fold in advance */
const preOpts = computed(() => {
  const g = game.value;
  const h = g.human;
  return g.phase === 'betting' && !!h && g.canAct(h) && !can.value.my;
});
function pre(kind: 'fold' | 'checkfold') {
  sfx.click();
  setPreAct(ui.preAct === kind ? null : kind);
}
/** online all-in: pick how many times to deal the rest of the board */
const runOpts = computed(() => {
  const h = game.value.human;
  const rv = online.value ? remote.state?.runVote : null;
  return rv && h && rv.seats.includes(h.id) ? { mine: rv.mine } : null;
});
/** online, after a hand: your cards weren't shown down, so you may show them */
const showOpts = computed(() => {
  const g = game.value;
  const h = g.human;
  if (!online.value || g.phase !== 'handover' || !h || !h.hole.length || h.revealed) return null;
  const shown = h.shown ?? [];
  return {
    cards: h.hole.map((c, k) => ({ k, label: `${rankLabel(c.r)}${SUIT_SYMBOL[c.s]}`, done: shown.includes(k) })),
    all: shown.length >= h.hole.length,
  };
});

// ---------- raise panel ----------
const range = computed(() => {
  if (!ui.raiseOpen || !game.value.human) return { minTo: 0, maxTo: 100, step: 10 };
  return { ...raiseBounds(), step: game.value.sb };
});
// typed amount, in the current unit; follows the slider/presets unless you are typing in it
const amtEl = ref<HTMLInputElement>();
const amt = ref('');
const bbMode = computed(() => ui.unit === 'bb');
const shownAmt = () => String(bbMode.value ? +(ui.raiseValue / game.value.bb).toFixed(1) : ui.raiseValue);
watch([() => ui.raiseValue, bbMode], () => {
  if (document.activeElement !== amtEl.value) amt.value = shownAmt();
});
function onAmt() {
  const v = parseFloat(amt.value);
  if (Number.isFinite(v)) ui.raiseValue = Math.round(bbMode.value ? v * game.value.bb : v);
}
function onAmtDone() {
  setRaise(ui.raiseValue);
  amt.value = shownAmt();
}
const isAllin = computed(() => ui.raiseOpen && ui.raiseValue >= range.value.maxTo);
const raiseInfo = computed(() => `最小加注到 ${money(range.value.minTo)} · 底池 ${money(game.value.potTotal())}`);

function preset(kind: 'min' | 'half' | 'pot' | 'max') {
  sfx.click();
  const g = game.value;
  const { minTo, maxTo } = raiseBounds();
  const pot = g.potTotal() + g.toCall(g.human!);
  const r = (v: number) => Math.round(v / g.sb) * g.sb;
  setRaise({ min: minTo, half: g.currentBet + r(pot / 2), pot: g.currentBet + r(pot), max: maxTo }[kind]);
}
function nextHand() {
  sfx.click();
  game.value.nextHand();
}
</script>

<template>
  <section class="hero" id="hero">
    <div class="hero-hand">
      <div class="hole" id="hole" :class="{ folded: holeFolded }">
        <template v-if="hole.length">
          <PlayingCard v-for="c in hole" :key="`${handNo}-${c.k}`" :card="c.card" :k="c.k" :cls="c.cls" :delay="c.delay" />
        </template>
        <template v-else><div class="card slot"></div><div class="card slot"></div></template>
      </div>
      <div class="badge" id="badge" ref="badgeEl" :data-cat="badge.cat">
        <div class="badge-head">
          <span class="badge-label">当前牌型</span><span class="badge-stack" id="badge-stack" title="你的筹码（另一种单位）">{{ badge.stack }}</span>
        </div>
        <strong class="badge-name" id="badge-name">{{ badge.name }}</strong>
        <span class="badge-sub" id="badge-sub">{{ badge.sub }}</span>
        <div class="badge-meter" id="badge-meter">
          <i v-for="i in 10" :key="i" :class="{ on: i - 1 <= badge.cat, cur: i - 1 === badge.cat }"></i>
        </div>
      </div>
    </div>
    <div class="controls">
      <div class="raise-panel" id="raise-panel" :hidden="!ui.raiseOpen">
        <div class="raise-presets">
          <button @click="preset('min')">最小</button>
          <button @click="preset('half')">½ 池</button>
          <button @click="preset('pot')">底池</button>
          <button @click="preset('max')">全下</button>
        </div>
        <div class="raise-info" id="raise-info">{{ ui.raiseOpen ? raiseInfo : '' }}</div>
        <div class="raise-row">
          <input
            type="range"
            id="raise-range"
            :min="range.minTo"
            :max="range.maxTo"
            :step="range.step"
            :value="ui.raiseValue"
            @input="onSlider(Number(($event.target as HTMLInputElement).value))"
          />
          <label class="raise-amt" title="直接输入加注到的金额，回车确认">
            <input
              ref="amtEl"
              v-model="amt"
              type="number"
              inputmode="decimal"
              :step="bbMode ? 0.5 : game.sb"
              @input="onAmt"
              @change="onAmtDone"
              @keydown.enter.prevent="doAct('raise')"
            /><span>{{ bbMode ? 'BB' : '分' }}</span>
          </label>
          <span v-if="isAllin" class="raise-allin">全下</span>
        </div>
      </div>
      <div v-if="runOpts" class="actions run-bar">
        <button v-for="n in 3" :key="n" class="act" :class="n === 1 ? 'ghost' : 'raise'" :disabled="!!runOpts.mine" @click="voteRuns(n)">
          <span>{{ runOpts.mine === n ? '✓ ' : '' }}发 {{ n }} 次</span>
        </button>
      </div>
      <div v-else-if="showOpts" class="actions show-bar">
        <button v-for="c in showOpts.cards" :key="c.k" class="act ghost" :disabled="c.done" @click="showCards([c.k])">
          <span>{{ c.done ? '已秀' : '秀单张' }}</span><span>{{ c.label }}</span>
        </button>
        <button class="act raise" :disabled="showOpts.all" @click="showCards([0, 1])"><span>全秀</span></button>
      </div>
      <div v-else-if="preOpts" class="actions pre-bar">
        <button class="act ghost" :class="{ on: ui.preAct === 'fold' }" @click="pre('fold')">
          <span>{{ ui.preAct === 'fold' ? '✓ ' : '' }}提前弃牌</span>
        </button>
        <button class="act ghost" :class="{ on: ui.preAct === 'checkfold' }" @click="pre('checkfold')">
          <span>{{ ui.preAct === 'checkfold' ? '✓ ' : '' }}过牌/弃牌</span><span>能过则过，否则弃牌</span>
        </button>
      </div>
      <div v-else class="actions" id="actions" :class="{ handover: handover && !online }">
        <button class="act fold" id="act-fold" :disabled="!can.my" @click="doAct('fold')"><span>弃牌</span><kbd>F</kbd></button>
        <button class="act call" id="act-call" :disabled="!can.my" @click="doAct('call')">
          <template v-if="toCall > 0"><span>跟注</span><span>{{ money(toCall) }}</span></template>
          <span v-else>过牌</span>
          <kbd>C</kbd>
        </button>
        <button class="act raise" id="act-raise" :disabled="!can.raise" @click="doAct('raise')">
          <span>{{ raiseLabel.label }}</span><span v-if="raiseLabel.value">{{ raiseLabel.value }}</span><kbd>R</kbd>
        </button>
        <button class="act allin" id="act-allin" :disabled="!can.allin" @click="doAct('allin')">
          <span>全下</span><span v-if="allinAmount">{{ allinAmount }}</span><kbd>A</kbd>
        </button>
        <button class="act next" id="act-next" :hidden="!handover || online" @click="nextHand"><span>下一手 ▶</span><kbd>空格</kbd></button>
      </div>
      <div class="status" id="status" :class="{ mine: can.my }">{{ statusText }}</div>
    </div>
  </section>
</template>
