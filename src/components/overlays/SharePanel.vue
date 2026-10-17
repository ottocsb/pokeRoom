<script setup lang="ts">
import { computed, ref } from 'vue';
import { sfx } from '../../sound';
import { game, remote, toast, ui } from '../../store';

const r = computed(() => (game.value, remote.state!.room));
const link = computed(() => `${location.origin}${location.pathname}?room=${encodeURIComponent(r.value.id)}`);
const canShare = typeof navigator.share === 'function';
const copied = ref(false);
const linkInput = ref<HTMLInputElement>();

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const i = linkInput.value;
    if (!i) return false;
    i.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}
function close() {
  sfx.click();
  ui.shareOpen = false;
}
async function copy() {
  sfx.click();
  const ok = await copyText(`来和我打德州扑克！房间「${r.value.name}」邀请码 ${r.value.id}：${link.value}`);
  toast(ok ? '邀请链接已复制，发给好友即可' : '复制失败，请长按链接手动复制');
  if (ok) copied.value = true;
}
function sysShare() {
  sfx.click();
  navigator.share({ title: '德州扑克邀请', text: `来和我打德州扑克！房间「${r.value.name}」邀请码 ${r.value.id}`, url: link.value }).catch(() => {});
}
</script>

<template>
  <div class="ov-panel share" role="dialog" aria-label="邀请好友">
    <div class="ov-suit">✉</div>
    <h2>邀请好友入座</h2>
    <p>好友打开链接，注册 / 登录后就会直接进入「{{ r.name }}」</p>
    <div class="share-code"><small>邀请码</small><b>{{ r.id }}</b></div>
    <input id="share-link" ref="linkInput" class="share-link" readonly :value="link" @focus="($event.target as HTMLInputElement).select()" />
    <div class="lobby-actions">
      <button class="act ghost" id="share-close" @click="close">关闭</button>
      <button v-if="canShare" class="act ghost" id="share-sys" @click="sysShare">发送给…</button>
      <button class="act next" id="share-copy" @click="copy">{{ copied ? '✓ 已复制' : '复制邀请链接' }}</button>
    </div>
  </div>
</template>
