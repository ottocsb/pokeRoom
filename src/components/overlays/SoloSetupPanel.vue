<script setup lang="ts">
import { computed } from 'vue';
import { sfx } from '../../sound';
import { game, local, RINGS, showOnline, startRoom, ui } from '../../store';

const BLINDS: Array<[number, number]> = [
  [5, 10],
  [10, 20],
  [25, 50],
  [50, 100],
];
const STACKS = [1000, 2000, 5000];

const d = computed(() => ui.draft);
const counts = computed(() => {
  const out: number[] = [];
  for (let c = 2; c <= d.value.max; c++) out.push(c);
  return out;
});
const seated = computed(() => Math.min(d.value.players, d.value.max));
const running = computed(() => (game.value, ui.mode === 'solo' && local.phase !== 'idle' && local.handNo > 0));
const used = computed(() => {
  const s = new Set<number>();
  for (let k = 0; k < seated.value; k++) s.add(Math.round((k * d.value.max) / seated.value) % d.value.max);
  return s;
});

function setMax(max: 6 | 9) {
  const v = d.value;
  v.max = max;
  if (v.max === 9 && v.players === 6) v.players = 9;
  v.players = Math.min(v.players, v.max);
  sfx.click();
}
function pick(f: () => void) {
  f();
  sfx.click();
}
function start() {
  sfx.click();
  startRoom({ ...ui.draft });
}
function online() {
  sfx.click();
  showOnline();
}
function cancel() {
  sfx.click();
  ui.screen = 'table';
}
</script>

<template>
  <div class="ov-panel lobby">
    <h2>单机练习 · 选择牌桌</h2>
    <div class="lobby-grid">
      <div class="lobby-form">
        <label>房型</label>
        <div class="segs">
          <button v-for="m in [6, 9] as const" :key="m" class="seg" :class="{ sel: d.max === m }" @click="setMax(m)">{{ m }} 人桌 ({{ m }}max)</button>
        </div>
        <label>入座人数</label>
        <div class="segs counts">
          <button v-for="c in counts" :key="c" class="seg" :class="{ sel: c === seated }" @click="pick(() => (d.players = c))">{{ c }}</button>
        </div>
        <label>盲注</label>
        <div class="segs">
          <button v-for="([s, b], i) in BLINDS" :key="i" class="seg" :class="{ sel: b === d.bb }" @click="pick(() => ([d.sb, d.bb] = BLINDS[i]))">
            {{ s }}/{{ b }}
          </button>
        </div>
        <label>起始筹码</label>
        <div class="segs">
          <button v-for="c in STACKS" :key="c" class="seg" :class="{ sel: c === d.startChips }" @click="pick(() => (d.startChips = c))">
            {{ c.toLocaleString('en-US') }}
          </button>
        </div>
        <p class="lobby-note">
          起始 {{ d.startChips.toLocaleString('en-US') }} 分 = <b>{{ +(d.startChips / d.bb).toFixed(1) }} BB</b>。未坐满时玩家均匀排开。
        </p>
      </div>
      <div class="lobby-preview">
        <div class="pv-table">
          <div class="pv-felt"></div>
          <i
            v-for="([x, y], s) in RINGS[d.max]"
            :key="s"
            class="pv-seat"
            :class="{ on: used.has(s), me: s === 0 }"
            :style="{ left: `${x}%`, top: `${y}%` }"
          ></i>
        </div>
        <small>{{ seated }}/{{ d.max }} 人</small>
      </div>
    </div>
    <div class="lobby-actions">
      <button class="act ghost" id="lobby-online" @click="online">{{ ui.user ? '返回主页' : '登录联机' }}</button>
      <button v-if="running" class="act ghost" id="lobby-cancel" @click="cancel">返回牌桌</button>
      <button class="act next" id="lobby-start" @click="start">{{ running ? '换房间重新开始' : '开始游戏' }}</button>
    </div>
  </div>
</template>
