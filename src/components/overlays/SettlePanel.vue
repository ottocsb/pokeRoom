<script setup lang="ts">
import { computed } from 'vue';
import { sfx } from '../../sound';
import { ui } from '../../store';

const data = computed(() => ui.settle!);
const mine = computed(() => data.value.rows.find((r) => r.user === ui.user));

const fmt = (n: number) => n.toLocaleString('en-US');
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `-${fmt(-n)}` : '0');
const netCls = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : '');

function close() {
  sfx.click();
  ui.settle = null;
}
</script>

<template>
  <div class="ov-panel history settle" role="dialog" aria-label="牌桌结算">
    <h2>牌桌已关闭 · 结算</h2>
    <p>{{ data.name }}</p>
    <div v-if="mine" class="settle-mine">
      <small>你的输赢</small><b :class="netCls(mine.net)">{{ signed(mine.net) }}</b>
      <small>带入 {{ fmt(mine.buyIn) }} · 结余 {{ fmt(mine.chips) }}</small>
    </div>
    <p v-if="!data.rows.length">本桌没有玩家带入</p>
    <table v-else class="hist-standings">
      <thead>
        <tr><th>玩家</th><th>带入</th><th>结余</th><th>输赢</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in data.rows" :key="r.user ?? `bot:${r.name}`" :class="{ me: r.user === ui.user }">
          <td>{{ r.user ? r.name : `${r.name}（电脑）` }}</td>
          <td>{{ fmt(r.buyIn) }}</td>
          <td>{{ fmt(r.chips) }}</td>
          <td :class="netCls(r.net)">{{ signed(r.net) }}</td>
        </tr>
      </tbody>
    </table>
    <div class="lobby-actions">
      <button class="act next" @click="close">返回主页</button>
    </div>
  </div>
</template>
