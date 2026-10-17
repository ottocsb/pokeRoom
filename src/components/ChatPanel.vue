<script setup lang="ts">
import { nextTick, onMounted, ref, watch } from 'vue';
import { CHAT_MAX, EMOTES } from '../protocol';
import { sendChat, toggleChat, ui } from '../store';

const text = ref('');
const list = ref<HTMLElement>();

function send() {
  sendChat(text.value);
  text.value = '';
}
// keep the newest message in view
const toBottom = () => nextTick(() => list.value && (list.value.scrollTop = list.value.scrollHeight));
watch(() => [ui.chat.length, ui.chatOpen], toBottom);
onMounted(toBottom);
</script>

<template>
  <!-- desktop: always there, faded until hovered / focused, lights up briefly on a new message.
       phones: hidden behind the 💬 button -->
  <div class="chat" :class="{ open: ui.chatOpen, fresh: ui.chatFresh }">
  <button class="chat-fab" title="牌桌聊天" @click="toggleChat">
    💬<i v-if="ui.chatUnread" class="unread">{{ ui.chatUnread > 99 ? '99+' : ui.chatUnread }}</i>
  </button>
  <aside class="chat-panel" aria-label="牌桌聊天" @mouseleave="toBottom">
    <h3>牌桌聊天<button class="x" title="关闭" @click="toggleChat">✕</button></h3>
    <div class="chat-list" ref="list">
      <p v-if="!ui.chat.length" class="dim">还没有消息，打个招呼吧</p>
      <p v-for="m in ui.chat" :key="m.id" class="chat-line" :class="{ me: m.user === ui.user }">
        <b>{{ m.user }}<small v-if="m.seat < 0">（旁观）</small></b>{{ m.text }}
      </p>
    </div>
    <div class="chat-emojis">
      <button v-for="em in EMOTES" :key="em" @click="sendChat(em)">{{ em }}</button>
    </div>
    <form class="chat-input" @submit.prevent="send">
      <input v-model="text" type="text" :maxlength="CHAT_MAX" placeholder="说点什么…" />
      <button type="submit" :disabled="!text.trim()">发送</button>
    </form>
  </aside>
  </div>
</template>
