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
npm run server    # esbuild 打包 server/standalone.ts → dist-server/ 并直接运行（会一直占着终端），单端口同时托管 dist/ 和 WebSocket（PORT 默认 8787）
```

`npm run server` 托管的是 `dist/`，改了前端要先 `npm run build`。改了服务端要重启它；在后台跑时，停掉外层 shell 不一定能结束 `node dist-server/index.mjs` 子进程，8787 会被占住（EADDRINUSE），需要手动结束这个进程。

没有测试框架和 lint。验证方式：构建 + 浏览器实测。页面暴露了测试桥 `window.__OHMYGAME_PLAYTEST__`（`snapshot()` / `reset()` / `setSeed(n)`，定义在 `src/store.ts` 末尾），可以用它读取游戏状态。联机流程可以用 Node 脚本（`ws` 包，连 `ws://localhost:8787/poker-ws`）扮演其他玩家：发 `register` → `join` → `sit` 等 `ClientMsg`，打印收到的消息。服务端重启后所有房间都会消失。

## 架构

德州扑克，支持单机（对电脑）和联机（WebSocket 房间）两种模式。前端是 Vue 3（`<script setup>`），没有路由和状态库。

**共享的游戏引擎**：`src/game.ts`（`Game` 类）是规则引擎，前后端共用。单机模式在浏览器里直接运行它；联机模式由服务端 `server/poker-server.ts` 的 `Table` 持有一个 `Game` 实例作为权威状态。`evaluator.ts`（牌型计算）、`ai.ts`（电脑决策）、`cards.ts` 也是前后端共用的。`src/protocol.ts` 定义客户端和服务端之间的消息类型（`ClientMsg` / `ServerMsg` / `TableState`）。

**前端如何对接两种模式**：`src/remote.ts` 里的 `TableLike` 是渲染层所需的接口。`Game`（本地）和 `RemoteTable`（服务端状态的只读镜像，`apply(TableState)` 写入）都实现了它。`src/store.ts` 中的 `game` 是一个 `shallowRef<TableLike>`，按模式指向 `local` 或 `remote`。

**响应式的关键点**：`Game` 和 `RemoteTable` 是普通可变对象，**不是**响应式的。它们状态变化后必须调用 `refresh()`（即 `triggerRef(game)`）通知视图更新：本地通过 `local.onUpdate` 调用，联机在收到 `state` 消息后调用。因此：
- 读取引擎状态的 computed 或模板必须经过 `game.value`，才能建立依赖。
- computed 不要直接返回引擎内部的对象（例如 `Player`）。这些对象是原地修改的，引用不变，下游就不会更新。要在 computed 里把需要的字段取出来。
- 直接读 `remote.xxx` 或 `local.xxx` 时，先访问一下 `game.value` 来建立依赖，例如 `computed(() => (game.value, local.phase))`。

UI 状态（当前界面 screen、模式、登录态、加注面板等）都放在 `store.ts` 的 `ui = reactive({...})` 里。动作函数（`startRoom`、`enterRoom`、`doAct`……）和联网消息处理（`net.onMessage`）也在 `store.ts`。`App.vue` 的 `overlay` computed 按优先级决定显示哪个 overlay 面板（`components/overlays/`）：结算 `settle` 优先级最高，其次是房主的带入审批 `buyin`（强制弹窗，点遮罩或按 Esc 都关不掉，弹出期间屏蔽快捷键），然后才是邀请、战绩等可以关掉的面板。

**发牌动画**：`PlayingCard.vue` 在组件创建时调用一次 `fresh(key)`，决定是否加上 `fresh` 类。牌的 `:key` 带有 `handNo`，这样每一手都会重新创建牌元素，动画才会重播。

**样式**：`src/style.css` 是全局样式，沿用的是改为 Vue 之前的 DOM 结构和 class/id，修改模板时要保持这些类名一致。主题通过 `<html data-theme>` 切换（`themes.ts`）。App 挂载在 `#root` 上，根元素是 `#app`。

**服务端**：`server/poker-server.ts` 负责账号（scrypt 哈希，存在 SQLite 的 `server-data/poker.db`）、邀请码私人房间、入座/旁观、行动计时（`TURN_MS`）以及断线处理。它在两种场景下运行：开发/预览时由 `server/vite-plugin.ts` 挂载，部署时由 `server/standalone.ts` 挂载，WebSocket 路径都是 `WS_PATH`。客户端可以用 `VITE_POKER_SERVER` 指定其他服务器地址。

服务端的几个要点：
- 每个 `Table` 的 `view(user)` 按观看者生成 `TableState`：别人的底牌、带入申请列表（只有房主能看到全部）等都在这里过滤。
- 带入账本 `ledger`（按玩家记录累计带入和离桌时保留的筹码）、带入申请 `requests`、关桌标志 `closing` 只存在内存里。牌桌结算时（关桌、无人自动解散、服务关闭）`Table.record()` 会把每人的带入/结余/输赢写进 SQLite 的 `sessions` + `session_users` 表，主页「历史战绩」读的就是这里（只给总览，不开放每手明细）。清空座位一律走 `clearSeat(i)`，这样筹码才会记回账本，不要直接赋值 `emptySeat(i)`。
- 房主（`cfg.owner`）入座自动带入，其他人入座会生成申请，要房主审批；有未处理的申请时 `nextHand()` 不发牌。关桌时如果正在下注，等这手打完再 `settle()`，向房间内所有人发 `closed`，然后通过 `hub.dissolve` 移除房间。
- 每手牌结束后，牌谱（`HandLog`）存进 SQLite 的 `hands` 表，key 是 `Table.logKey`（邀请码 + 创建时间，因为邀请码会被复用）。

新增一种联机消息要同时改三处：`protocol.ts` 的 `ClientMsg`/`ServerMsg`、服务端 `handle()`、前端 `store.ts` 的 `net.onMessage`。

`canvas/` 是设计画布工作区（有自己的 `AGENTS.md`），和代码运行无关。
