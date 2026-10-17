<script setup lang="ts">
import { computed } from 'vue';
import { sfx } from '../../sound';
import { game, local, openSoloSetup, restartSolo } from '../../store';

const win = computed(() => (game.value, local.phase === 'victory'));
const hands = computed(() => (game.value, local.handNo));

function restart() {
  sfx.click();
  restartSolo();
}
</script>

<template>
  <div class="ov-panel">
    <div class="ov-suit">{{ win ? '♛' : '♠' }}</div>
    <h2>{{ win ? '你赢下了整张牌桌！' : '筹码输光了' }}</h2>
    <p>{{ win ? `历经 ${hands} 手，所有对手都已出局。` : `坚持了 ${hands} 手。再来一局？` }}</p>
    <div class="lobby-actions">
      <button class="act ghost" id="ov-room" @click="openSoloSetup()">换房间</button>
      <button class="act next" id="ov-restart" @click="restart">重新开始</button>
    </div>
  </div>
</template>
