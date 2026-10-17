<script setup lang="ts">
import { computed } from 'vue';
import { BOMB_CHANCE, CREATE_BLINDS, CREATE_BOMBS, CREATE_DEPTHS } from '../../protocol';
import { sfx } from '../../sound';
import { createRoom, RINGS, ui } from '../../store';

const d = ui.createDraft;
const depth = computed(() => d.buyIn / d.bb);

function setMax(max: 6 | 9) {
  d.max = max;
  sfx.click();
}
function setBlind(i: number) {
  const keep = depth.value;
  [d.sb, d.bb] = CREATE_BLINDS[i];
  d.buyIn = d.bb * keep; // keep the same depth in BB
  sfx.click();
}
function setDepth(n: number) {
  d.buyIn = d.bb * n;
  sfx.click();
}
function setBomb(n: number) {
  d.bomb = n;
  sfx.click();
}
function back() {
  sfx.click();
  ui.screen = ui.user ? 'rooms' : 'login';
}
</script>

<template>
  <div class="ov-panel lobby">
    <h2>创建房间</h2>
    <div class="lobby-grid">
      <div class="lobby-form">
        <label>房型</label>
        <div class="segs">
          <button v-for="m in [6, 9] as const" :key="m" class="seg" :class="{ sel: d.max === m }" @click="setMax(m)">{{ m }} 人桌</button>
        </div>
        <label>盲注级别（小盲 / 大盲）</label>
        <div class="segs">
          <button v-for="([s, b], i) in CREATE_BLINDS" :key="i" class="seg" :class="{ sel: b === d.bb }" @click="setBlind(i)">{{ s }}/{{ b }}</button>
        </div>
        <label>买入</label>
        <div class="segs">
          <button v-for="n in CREATE_DEPTHS" :key="n" class="seg" :class="{ sel: n === depth }" @click="setDepth(n)">
            {{ (n * d.bb).toLocaleString('en-US') }}<small> · {{ n }}BB</small>
          </button>
        </div>
        <label>暴击底池（每人投入）</label>
        <div class="segs">
          <button v-for="n in CREATE_BOMBS" :key="n" class="seg" :class="{ sel: n === d.bomb }" @click="setBomb(n)">{{ n ? `${n}BB` : '关闭' }}</button>
        </div>
        <p v-if="d.bomb" class="lobby-note">
          第一轮之后每手有 {{ BOMB_CHANCE * 100 }}% 概率触发：不收盲注，每人投入 <b>{{ d.bomb * d.bb }}</b>（不足则全下），直接发翻牌。触发后本轮剩余和下一整轮不再触发。
        </p>
        <p class="lobby-note">
          小盲 <b>{{ d.sb }}</b> · 大盲 <b>{{ d.bb }}</b> · 每人带入 <b>{{ d.buyIn.toLocaleString('en-US') }}</b>，其他玩家入座需你同意。房间只能通过邀请链接或邀请码进入；无人 30 分钟后自动解散。
        </p>
      </div>
      <div class="lobby-preview">
        <div class="pv-table">
          <div class="pv-felt"></div>
          <i v-for="([x, y], s) in RINGS[d.max]" :key="s" class="pv-seat" :class="{ on: s === 0, me: s === 0 }" :style="{ left: `${x}%`, top: `${y}%` }"></i>
        </div>
        <small>{{ d.max }} 个座位</small>
      </div>
    </div>
    <div class="lobby-actions">
      <button class="act ghost" id="create-back" @click="back">返回</button>
      <button class="act next" id="create-go" :disabled="ui.netStatus !== 'open'" @click="createRoom()">创建并进入</button>
    </div>
  </div>
</template>
