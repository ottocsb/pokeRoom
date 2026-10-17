<script setup lang="ts">
import { computed } from 'vue';
import { answerBuyIn, game, remote } from '../../store';

/** first pending request; the panel stays until the owner answers every one */
const req = computed(() => (game.value, remote.state?.requests[0]));
const left = computed(() => (game.value, (remote.state?.requests.length ?? 1) - 1));
const buyIn = computed(() => (game.value, (remote.state?.room.buyIn ?? 0).toLocaleString('en-US')));
</script>

<template>
  <div v-if="req" class="ov-panel" role="alertdialog" aria-label="带入申请">
    <div class="ov-suit">♦</div>
    <h2>带入申请</h2>
    <p>
      <b>{{ req.user }}</b> 申请入座 {{ req.seat + 1 }} 号位，带入 <b>{{ buyIn }}</b>
    </p>
    <p v-if="left > 0" class="lobby-note">还有 {{ left }} 个申请待处理</p>
    <div class="lobby-actions">
      <button class="act ghost" id="buyin-no" @click="answerBuyIn(req.user, false)">拒绝</button>
      <button class="act next" id="buyin-yes" @click="answerBuyIn(req.user, true)">同意</button>
    </div>
  </div>
</template>
