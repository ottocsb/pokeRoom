# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 约定

- 始终用中文回复
- 不要过度设计，代码简洁易懂、简单实用
- 最小化修改，尽量不动其他模块

## 命令

需要 **Node ≥ 22.5**：服务端用了 `node:sqlite`，Node 20 下连 `vite.config.ts` 都加载不了（本机可用 `nvm use 24.14.0`）。包管理用 bun（`bun.lock`）。

```bash
npm run dev       # Vite 开发服务器，联机 WebSocket 服务通过 Vite 插件一起启动
npm run build     # vue-tsc --noEmit 类型检查 + vite build → dist/
npm run server    # esbuild 打包 server/standalone.ts → dist-server/，单端口同时托管 dist/ 和 WebSocket（PORT 默认 8787）
```

没有测试框架和 lint。验证方式：构建 + 浏览器实测。页面暴露了测试桥 `window.__OHMYGAME_PLAYTEST__`（`snapshot()` / `reset()` / `setSeed(n)`，定义在 `src/store.ts` 末尾），可以用它读取游戏状态。

## 架构

德州扑克，支持单机（对电脑）和联机（WebSocket 房间）两种模式。前端是 Vue 3（`<script setup>`），没有路由和状态库。

**共享的游戏引擎**：`src/game.ts`（`Game` 类）是规则引擎，前后端共用。单机模式在浏览器里直接运行它；联机模式由服务端 `server/poker-server.ts` 的 `Table` 持有一个 `Game` 实例作为权威状态。`evaluator.ts`（牌型计算）、`ai.ts`（电脑决策）、`cards.ts` 也是前后端共用的。`src/protocol.ts` 定义客户端和服务端之间的消息类型（`ClientMsg` / `ServerMsg` / `TableState`）。

**前端如何对接两种模式**：`src/remote.ts` 里的 `TableLike` 是渲染层所需的接口。`Game`（本地）和 `RemoteTable`（服务端状态的只读镜像，`apply(TableState)` 写入）都实现了它。`src/store.ts` 中的 `game` 是一个 `shallowRef<TableLike>`，按模式指向 `local` 或 `remote`。

**响应式的关键点**：`Game` 和 `RemoteTable` 是普通可变对象，**不是**响应式的。它们状态变化后必须调用 `refresh()`（即 `triggerRef(game)`）通知视图更新：本地通过 `local.onUpdate` 调用，联机在收到 `state` 消息后调用。因此：
- 读取引擎状态的 computed 或模板必须经过 `game.value`，才能建立依赖。
- computed 不要直接返回引擎内部的对象（例如 `Player`）。这些对象是原地修改的，引用不变，下游就不会更新。要在 computed 里把需要的字段取出来。
- 直接读 `remote.xxx` 或 `local.xxx` 时，先访问一下 `game.value` 来建立依赖，例如 `computed(() => (game.value, local.phase))`。

UI 状态（当前界面 screen、模式、登录态、加注面板等）都放在 `store.ts` 的 `ui = reactive({...})` 里。动作函数（`startRoom`、`enterRoom`、`doAct`……）和联网消息处理（`net.onMessage`）也在 `store.ts`。`App.vue` 根据 `ui.screen` 等状态决定显示哪个 overlay 面板（`components/overlays/`）。

**发牌动画**：`PlayingCard.vue` 在组件创建时调用一次 `fresh(key)`，决定是否加上 `fresh` 类。牌的 `:key` 带有 `handNo`，这样每一手都会重新创建牌元素，动画才会重播。

**样式**：`src/style.css` 是全局样式，沿用的是改为 Vue 之前的 DOM 结构和 class/id，修改模板时要保持这些类名一致。主题通过 `<html data-theme>` 切换（`themes.ts`）。App 挂载在 `#root` 上，根元素是 `#app`。

**服务端**：`server/poker-server.ts` 负责账号（scrypt 哈希，存在 SQLite 的 `server-data/poker.db`）、邀请码私人房间、入座/旁观、行动计时（`TURN_MS`）以及断线处理。它在两种场景下运行：开发/预览时由 `server/vite-plugin.ts` 挂载，部署时由 `server/standalone.ts` 挂载，WebSocket 路径都是 `WS_PATH`。客户端可以用 `VITE_POKER_SERVER` 指定其他服务器地址。

`canvas/` 是设计画布工作区（有自己的 `AGENTS.md`），和代码运行无关。
