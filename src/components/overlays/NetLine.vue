<script setup lang="ts">
import { net, ui } from '../../store';
</script>

<template>
  <template v-if="ui.netStatus === 'open'"><span class="net-dot on"></span>联机服务器已连接</template>
  <template v-else-if="ui.netStatus === 'connecting'"><span class="net-dot wait"></span>正在连接联机服务器…</template>
  <template v-else><span class="net-dot off"></span>无法连接联机服务器 <button class="link" id="net-retry" @click="net.connect()">重试</button></template>
</template>
