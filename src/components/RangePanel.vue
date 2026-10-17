<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { game, ui } from '../store';
import { handName, positionList, RANKS, seatPositions } from '../ranges';

/** position tab picked by hand ('' = follow your own seat) */
const pick = ref('');
watch(
  () => game.value.handNo,
  () => (pick.value = ''),
);

const view = computed(() => {
  const g = game.value;
  const posOf = seatPositions(g.players, g.dealer);
  const list = positionList(posOf.size || g.room.max);
  const h = g.human;
  const mine = h ? posOf.get(h.id) ?? '' : '';
  const name = pick.value || mine || list[0].name;
  const cur = list.find((p) => p.name === name) ?? list[0];
  const hand = h && h.hole.length === 2 && h.hole[0] && h.hole[1] ? handName(h.hole) : '';
  const rows = [...RANKS].map((a, i) =>
    [...RANKS].map((b, j) => {
      const nm = i === j ? a + b : i < j ? a + b + 's' : b + a + 'o';
      return { nm, act: cur.chart.raise.has(nm) ? 'raise' : cur.chart.call.has(nm) ? 'call' : '', me: nm === hand };
    }),
  );
  const pct = (s: Set<string>) => {
    let combos = 0;
    for (const nm of s) if (!(s === cur.chart.call && cur.chart.raise.has(nm))) combos += nm.length === 2 ? 6 : nm[2] === 's' ? 4 : 12;
    return Math.round((combos / 1326) * 100);
  };
  return { list, mine, cur, rows, raisePct: pct(cur.chart.raise), callPct: pct(cur.chart.call) };
});
</script>

<template>
  <aside class="range-pop" aria-label="翻前范围表">
    <h3>翻前范围 · {{ view.cur.name }}<button class="x" title="关闭" @click="ui.rangeOpen = false">✕</button></h3>
    <div class="range-tabs">
      <button v-for="p in view.list" :key="p.name" :class="{ sel: p.name === view.cur.name, mine: p.name === view.mine }" @click="pick = p.name">
        {{ p.name }}
      </button>
    </div>
    <div class="range-grid">
      <template v-for="(row, i) in view.rows" :key="i">
        <span v-for="c in row" :key="c.nm" :class="[c.act, { me: c.me }]">{{ c.nm }}</span>
      </template>
    </div>
    <p class="range-note">
      <i class="raise"></i>加注 {{ view.raisePct }}%<template v-if="view.callPct"> <i class="call"></i>跟注 {{ view.callPct }}%</template>
    </p>
    <p class="range-note dim">{{ view.cur.chart.note }}；100BB 现金桌近似参考</p>
  </aside>
</template>
