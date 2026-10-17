# pokeRoom · 德州扑克

浏览器里玩的德州扑克，可以单机对战电脑，也可以创建房间和好友联机。前端用 Vue 3 + Vite，联机服务基于 WebSocket。

## 功能

- **单机练习**：不用登录，和不同风格的电脑对手打。可选 6 人桌或 9 人桌，入座人数、盲注和起始筹码都能设置。
- **联机房间**：注册账号后创建私人房间，设置大小盲、桌型和买入，然后把邀请链接或邀请码发给好友。房间里可以入座或旁观，空座可以用电脑补位。每次行动有倒计时，断线后会自动重连。
- **辅助信息**：实时显示当前牌型和听牌提示，有牌型大小表，摊牌时高亮成牌。筹码可以切换为分数或 BB 显示。
- **四套牌桌主题**：经典绿呢、午夜霓虹、皇家酒红、东方墨韵。另外带音效。

### 快捷键

| 按键 | 操作 |
|---|---|
| `F` | 弃牌 |
| `C` / `K` | 跟注 / 过牌 |
| `R` | 第一次按打开加注面板，再按一次确认 |
| `A` | 全下 |
| `空格` / `Enter` | 下一手（单机） |
| `Esc` | 关闭弹窗、面板 |

## 运行

需要 **Node.js ≥ 22.5**，因为服务端用到了内置的 `node:sqlite`。

```bash
bun install        # 或 npm install

npm run dev        # 开发模式，联机服务一起启动
npm run build      # 类型检查并打包到 dist/
npm run server     # 部署用：打包服务端，用一个端口同时提供页面和联机服务
```

`npm run server` 默认端口是 `8787`，可以通过环境变量 `PORT` 修改。账号数据保存在 `server-data/poker.db`。

如果联机服务单独部署在别的地址，构建前端时用 `VITE_POKER_SERVER` 指定 WebSocket 地址，例如 `VITE_POKER_SERVER=wss://example.com/poker-ws`。

### Docker

先复制示例配置，再把 `.env` 里的 `TURN_IP`（服务器公网 IP）和 `TURN_SECRET`（随机字符串）改掉。这是语音中继（TURN），玩家之间直连不通时用它转发语音：

```bash
cp .env.example .env
```

服务器防火墙 / 云安全组要放行 `3478`（UDP + TCP）和 `49160-49200`（UDP）。语音需要 HTTPS 访问页面（浏览器只在 HTTPS 或 localhost 下允许用麦克风）。

```bash
docker compose up -d --build     # 构建镜像并后台启动，访问 http://localhost:8787
PORT=9000 docker compose up -d   # 改用宿主机 9000 端口
docker compose logs -f           # 查看日志
docker compose down              # 停止（数据保留在 poker-data 卷里）
```

数据库存放在名为 `poker-data` 的 Docker 卷中（容器内路径 `/app/server-data`），重建镜像不会丢失。也可以不用 compose：`docker build -t pokeroom .`，再 `docker run -d -p 8787:8787 -v poker-data:/app/server-data pokeroom`。

## 目录结构

```
src/
  game.ts          游戏规则引擎（前后端共用）
  evaluator.ts     牌型计算
  ai.ts            电脑玩家决策
  protocol.ts      客户端和服务端之间的消息格式
  remote.ts        WebSocket 连接，以及联机牌桌在前端的镜像
  store.ts         前端全局状态和操作
  App.vue          页面主体
  components/      牌桌、手牌区、各类弹层
  style.css        全局样式与主题
server/
  poker-server.ts  联机服务：账号、房间、牌桌
  vite-plugin.ts   开发时把联机服务挂到 Vite 上
  standalone.ts    独立部署入口
```
