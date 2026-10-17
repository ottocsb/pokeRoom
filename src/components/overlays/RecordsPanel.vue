<script setup lang="ts">
import { computed, reactive } from 'vue';
import { sfx } from '../../sound';
import type { SessionRec } from '../../protocol';
import { ui } from '../../store';

const list = computed(() => ui.records);
const myNet = (s: SessionRec) => s.rows.find((r) => r.user === ui.user)?.net ?? 0;
const total = computed(() => (list.value ?? []).reduce((n, s) => n + myNet(s), 0));

const fmt = (n: number) => n.toLocaleString('en-US');
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : n < 0 ? `-${fmt(-n)}` : '0');
const netCls = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const timeText = (t: number) =>
  new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

/** tables whose standings are expanded */
const open = reactive(new Set<number>());
function toggle(k: number) {
  if (open.has(k)) open.delete(k);
  else open.add(k);
}

function back() {
  sfx.click();
  ui.records = null;
  ui.screen = ui.user ? 'rooms' : 'login';
}
</script>

<template>
  <div class="ov-panel history records" role="dialog" aria-label="历史战绩">
    <h2>历史战绩</h2>
    <p v-if="!list">加载中…</p>
    <p v-else-if="!list.length">还没有结束的牌桌</p>
    <template v-else>
      <p>
        共 {{ list.length }} 桌 · 累计输赢 <b :class="netCls(total)">{{ signed(total) }}</b>
      </p>
      <div class="hist-list">
        <div v-for="(s, k) in list" :key="k" class="hist-hand">
          <div class="hist-head" :class="{ open: open.has(k) }" title="点击查看本桌所有玩家输赢" @click="toggle(k)">
            <b>{{ open.has(k) ? '▾' : '▸' }} {{ s.name }}</b>
            <small>{{ s.sb }}/{{ s.bb }} · {{ timeText(s.end) }}</small>
            <b :class="netCls(myNet(s))">{{ signed(myNet(s)) }}</b>
          </div>
          <table v-if="open.has(k)" class="hist-standings">
            <thead>
              <tr><th>玩家</th><th>带入</th><th>结余</th><th>输赢</th></tr>
            </thead>
            <tbody>
              <tr v-for="r in s.rows" :key="r.user ?? `bot:${r.name}`" :class="{ me: r.user === ui.user }">
                <td>{{ r.user ? r.name : `${r.name}（电脑）` }}</td>
                <td>{{ fmt(r.buyIn) }}</td>
                <td>{{ fmt(r.chips) }}</td>
                <td :class="netCls(r.net)">{{ signed(r.net) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>
    <div class="lobby-actions">
      <button class="act ghost" id="records-back" @click="back">返回</button>
    </div>
  </div>
</template>
