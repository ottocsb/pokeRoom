<script setup lang="ts">
import { computed, reactive } from 'vue';
import { type Card, isRed, rankLabel, SUIT_SYMBOL } from '../../cards';
import { sfx } from '../../sound';
import type { HandLog } from '../../protocol';
import HandFlow from '../HandFlow.vue';
import { money, ui } from '../../store';

const data = computed(() => ui.history);

const signed = (n: number) => (n > 0 ? `+${money(n)}` : n < 0 ? `-${money(-n)}` : '0');
const netCls = (n: number) => (n > 0 ? 'up' : n < 0 ? 'down' : '');
const cardText = (c: Card) => rankLabel(c.r) + SUIT_SYMBOL[c.s];
const timeText = (t: number) => new Date(t).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });

/** hands whose action flow is expanded */
const open = reactive(new Set<number>());
function toggle(n: number) {
  if (open.has(n)) open.delete(n);
  else open.add(n);
}

const nameOf = (h: HandLog) => (seat: number) => h.players.find((p) => p.seat === seat)?.name ?? `${seat + 1}号`;
/** payouts at the end of a hand */
function results(h: HandLog) {
  const out = [];
  for (const p of h.players) {
    if (p.uncalled) out.push(`${p.name} 收回未跟注的 ${money(p.uncalled)}`);
    if (p.collected) out.push(`${p.name} 赢得底池 ${money(p.collected)}${p.shown && p.desc ? `（${p.desc}）` : ''}`);
  }
  return out;
}

function close() {
  sfx.click();
  ui.historyOpen = false;
}
</script>

<template>
  <div class="ov-panel history" role="dialog" aria-label="本局战绩">
    <h2>本局战绩</h2>
    <p v-if="!data">加载中…</p>
    <p v-else-if="!data.hands.length">还没有打完的牌局</p>
    <template v-else>
      <table class="hist-standings">
        <thead>
          <tr><th>玩家</th><th>手数</th><th>输赢</th></tr>
        </thead>
        <tbody>
          <tr v-for="s in data.standings" :key="s.name" :class="{ me: s.name === ui.user }">
            <td>{{ s.name }}</td>
            <td>{{ s.hands }}</td>
            <td :class="netCls(s.net)">{{ signed(s.net) }}</td>
          </tr>
        </tbody>
      </table>
      <div class="hist-list">
        <div v-for="h in data.hands" :key="h.handNo" class="hist-hand">
          <div class="hist-head" :class="{ open: open.has(h.handNo) }" title="点击查看下注过程" @click="toggle(h.handNo)">
            <b>{{ open.has(h.handNo) ? '▾' : '▸' }} 第 {{ h.handNo }} 手</b>
            <span class="hist-board">
              <i v-for="(c, k) in h.board" :key="k" class="hcard" :class="{ red: isRed(c) }">{{ cardText(c) }}</i>
              <i v-if="!h.board.length" class="dim">未发公共牌</i>
              <!-- run more than once: the cards each extra run dealt differently -->
              <template v-for="(b, r) in h.extraBoards ?? []" :key="`run${r}`">
                <i class="dim">/</i>
                <template v-for="(c, k) in b" :key="k">
                  <i v-if="cardText(c) !== (h.board[k] && cardText(h.board[k]))" class="hcard" :class="{ red: isRed(c) }">{{ cardText(c) }}</i>
                </template>
              </template>
            </span>
            <small>{{ timeText(h.time) }}</small>
          </div>
          <div v-for="p in h.players" :key="p.seat" class="hist-row" :class="{ me: p.user === ui.user, folded: p.folded }">
            <span class="nm">{{ p.name }}</span>
            <span class="hist-hole">
              <template v-if="p.hole.length">
                <i v-for="(c, k) in p.hole" :key="k" class="hcard" :class="{ red: isRed(c) }">{{ cardText(c) }}</i>
              </template>
              <i v-else class="dim">??</i>
            </span>
            <span class="desc">{{ p.folded ? '弃牌' : p.desc }}</span>
            <span class="net" :class="netCls(p.net)">{{ signed(p.net) }}</span>
          </div>
          <div v-if="open.has(h.handNo) && h.actions" class="hist-flow">
            <HandFlow :actions="h.actions" :board="h.board" :name-of="nameOf(h)" />
            <div class="hist-street">
              <div class="st">结算</div>
              <div v-for="(r, k) in results(h)" :key="k" class="hist-act">{{ r }}</div>
            </div>
          </div>
        </div>
      </div>
    </template>
    <div class="lobby-actions">
      <button class="act ghost" @click="close">关闭</button>
    </div>
  </div>
</template>
