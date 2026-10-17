<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { normCode } from '../../protocol';
import { sfx } from '../../sound';
import { openSoloSetup, submitAuth, ui } from '../../store';
import NetLine from './NetLine.vue';

const user = ref('');
const pass = ref('');
const pass2 = ref('');
const userInput = ref<HTMLInputElement>();

const auto = computed(() => ui.autoLogin && (ui.netStatus === 'connecting' || ui.netStatus === 'open'));
const reg = computed(() => ui.authTab === 'register');
const submitText = computed(() => {
  if (ui.authBusy) return '请稍候…';
  if (reg.value) return ui.inviteCode ? '注册并进入房间' : '注册并登录';
  return ui.inviteCode ? '登录并进入房间' : '登录';
});

function setTab(t: 'login' | 'register') {
  ui.authTab = t;
  ui.authErr = '';
  sfx.click();
}
function submit() {
  submitAuth(user.value.trim(), pass.value, reg.value ? pass2.value : null);
}
onMounted(() => {
  if (!document.activeElement || document.activeElement === document.body) userInput.value?.focus();
});
</script>

<template>
  <div v-if="auto" class="ov-panel auth">
    <div class="ov-suit">♠</div>
    <h2>正在登录…</h2>
    <p><NetLine /></p>
  </div>
  <div v-else class="ov-panel auth">
    <div class="ov-suit">♠</div>
    <h2>德州扑克 · 登录</h2>
    <div v-if="ui.inviteCode" class="invite-banner">
      <span>你受邀加入房间</span><b>{{ normCode(ui.inviteCode) || ui.inviteCode }}</b>
      <small>{{ reg ? '设置账号密码，注册后直接入座' : '登录后直接进入房间' }}</small>
    </div>
    <div class="segs auth-tabs">
      <button class="seg" :class="{ sel: !reg }" @click="setTab('login')">登录</button>
      <button class="seg" :class="{ sel: reg }" @click="setTab('register')">注册账号</button>
    </div>
    <form class="auth-form" id="auth-form" autocomplete="on" @submit.prevent="submit">
      <label
        ><span>账号</span
        ><input
          id="auth-user"
          ref="userInput"
          v-model="user"
          name="username"
          autocomplete="username"
          maxlength="12"
          placeholder="2–12 位中英文或数字"
          required
      /></label>
      <label
        ><span>密码</span
        ><input
          id="auth-pass"
          v-model="pass"
          name="password"
          type="password"
          :autocomplete="reg ? 'new-password' : 'current-password'"
          maxlength="64"
          placeholder="至少 4 位"
          required
      /></label>
      <label v-if="reg"
        ><span>确认密码</span><input id="auth-pass2" v-model="pass2" type="password" autocomplete="new-password" maxlength="64" required
      /></label>
      <p class="auth-err" role="alert">{{ ui.authErr }}</p>
      <button class="act next" type="submit" :disabled="ui.authBusy">{{ submitText }}</button>
    </form>
    <p class="auth-net"><NetLine /></p>
    <div class="auth-alt"><button class="act ghost" id="go-solo" @click="openSoloSetup()">单机练习（对战电脑，无需登录）</button></div>
  </div>
</template>
