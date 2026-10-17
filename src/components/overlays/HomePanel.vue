<script setup lang="ts">
import { computed, ref } from 'vue';
import { normCode } from '../../protocol';
import { sfx } from '../../sound';
import { enterRoom, logout, openRecords, openSoloSetup, toast, ui } from '../../store';
import NetLine from './NetLine.vue';

const code = ref('');
const online = computed(() => ui.netStatus === 'open');
const initial = computed(() => [...(ui.user ?? '?')][0].toUpperCase());

function goCreate() {
  sfx.click();
  ui.screen = 'create';
}
function join() {
  const c = normCode(code.value);
  if (c.length < 4) return toast('请输入完整的邀请码');
  enterRoom(c);
}
</script>

<template>
  <div class="ov-panel lobby rooms home">
    <div class="rooms-head">
      <h2>德州扑克</h2>
      <div class="who">
        <span class="who-av">{{ initial }}</span><b>{{ ui.user ?? '' }}</b><button class="link" id="go-records" :disabled="!online" @click="openRecords()">历史战绩</button><button class="link" id="logout" @click="logout()">退出登录</button>
      </div>
    </div>
    <div class="home-grid">
      <button class="home-card primary" id="go-create" :disabled="!online" @click="goCreate">
        <span class="hc-ico">＋</span>
        <b>创建房间</b>
        <small>自定大小盲与 6 / 9 人桌，生成邀请码发给好友</small>
      </button>
      <form class="home-card code" id="code-form" @submit.prevent="join">
        <span class="hc-ico">✉</span>
        <b>加入房间</b>
        <small>输入好友房间的邀请码</small>
        <div class="code-join">
          <input id="code-input" v-model="code" maxlength="8" placeholder="邀请码" autocomplete="off" autocapitalize="characters" spellcheck="false" /><button
            class="act next"
            type="submit"
            :disabled="!online"
          >
            进入
          </button>
        </div>
      </form>
      <button class="home-card" id="go-solo" @click="openSoloSetup()">
        <span class="hc-ico">♟</span>
        <b>单机练习</b>
        <small>和电脑对手打，不占用联机房间</small>
      </button>
    </div>
    <p v-if="!online" class="auth-net"><NetLine /></p>
  </div>
</template>
