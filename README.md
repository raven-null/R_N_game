# 像素跑酷 · 多人对战

一个 320×180 的 Canvas 像素跑酷小游戏。纯静态文件，零依赖、零构建，可以直接扔到 Netlify。
支持**实时多人同赛道竞速**：进同一个房间，一起倒计时起跑，赛道完全一致，比谁跑得远。

```
index.html      首页
game.html       游戏页（单机 + 多人一体）
config.js       线上联机配置（Supabase）
netlify.toml    Netlify 发布配置
src/rng.js      种子随机 / 房间码
src/track.js    确定性赛道生成
src/game.js     物理 + 碰撞 + 像素渲染
src/net.js      实时传输层（本地 BroadcastChannel / Supabase Realtime）
src/race.js     房间逻辑：成员、进度、开局、掉线清理
tools/serve.mjs 本地预览服务器
tools/sim.mjs   无浏览器仿真测试（赛道/物理/联机逻辑）
tools/lint.mjs  接线自检（模块、import、DOM id）
tools/net-check.mjs  真连一次 Supabase，验证实时链路
tools/race-check.mjs 端到端跑一遍多人流程（进房/开赛/同步/出局/排名）
```

---

## 一、本地先跑起来

ES module 不能用 `file://` 直接打开，要起一个静态服务：

```bash
node tools/serve.mjs 5173
```

然后打开 `http://localhost:5173`。

**不开 Supabase 也能测多人**：默认走 BroadcastChannel，同一浏览器多开几个窗口（或标签页），
用同一个房间码加入，就能看到彼此实时赛跑。适合验证逻辑。

改完代码跑一遍自检（不用开浏览器）：

```bash
node tools/sim.mjs        # 赛道确定性、可通过性、物理、联机同步
node tools/lint.mjs       # 模块能不能加载、import 路径、DOM id 对不对
node tools/net-check.mjs  # 真连 Supabase，验证实时链路通不通（需要先填 config.js）
```

---

## 二、部署到 Netlify

三步：

1. 把这个目录推到 GitHub（或直接用 Netlify 的拖拽上传）。
2. Netlify → Add new site → Import an existing project → 选仓库。
3. 构建配置留空：
   - **Build command**：留空
   - **Publish directory**：`.`（仓库根目录）

`netlify.toml` 里已经写好了，Netlify 会自动识别。之后每次 push 自动发布。

> 纯静态、没有函数、没有构建，免费额度完全够用。

---

## 三、开启真正的线上多人（跨设备）

静态托管没法维持 WebSocket，所以实时通道交给 **Supabase Realtime**（免费额度足够）。
本项目手写了它的 WebSocket 客户端，**不引入任何 CDN 依赖**。

### 1. 建项目

去 [supabase.com](https://supabase.com) 建一个免费项目。

### 2. 复制两个值

Project Settings → **API Keys**（新版在 `Publishable and secret API keys` 标签页）：

- `Project URL`，形如 `https://abcdefgh.supabase.co`
- `Publishable key`，形如 `sb_publishable_xxxxxxxx`
  （老项目里的 `anon` JWT key 也可以，两者权限完全一样）

填进 `config.js`：

```js
export const SUPABASE_URL = 'https://abcdefgh.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_xxxxxxxx';
```

### 3. 不需要建表，也不需要写 RLS 策略

本项目只用 **public 频道的广播**，不碰 Postgres、不建表、不写策略，建完项目填上 key 就能用。
这一点是实测确认过的（`node tools/net-check.mjs` 会在没配任何策略的项目上直接跑通）。

> 例外：如果你以后想改用**私有频道**（`private: true`），才需要在 SQL Editor 给
> `realtime.messages` 加 RLS 策略，并在 `src/net.js` 里把 join 的 `private` 改成 `true`。

### 4. 重新部署

改完 `config.js` 推一次，或者在 Netlify 面板点 Deploys → Trigger deploy。
页面底部会显示 `Supabase Realtime · 线上联机`，就说明通了。

本地想先确认能不能连，直接跑：

```bash
node tools/net-check.mjs
```

### 关于 key 的安全性

`publishable` key（以及它的前身 `anon` key）本来就是设计给浏览器公开使用的，
放在前端不会泄露任何东西。**绝对不要**把 `sb_secret_...` 或 `service_role` key 填进前端。

### 手写客户端踩过的坑（改代码前请看）

`src/net.js` 是照着 `@supabase/realtime-js` 的 serializer 逐字节对齐的，三个都不能少：

1. URL 必须带 `vsn=2.0.0`；
2. 普通事件是 **JSON 数组帧** `[join_ref, ref, topic, event, payload]`；
3. 广播是 **二进制帧**，且头部必须带上 joinRef 和一个递增 ref（7 字节头 + 各字段 UTF-8 字节）。

少任何一条的表现都一样：**能连上、能 join 成功，但消息全部静默丢失，且不报任何错**。
另外频道默认是 private，匿名访问必须显式传 `private: false`，否则同样收不到。

---

## 四、怎么玩多人

1. 打开页面 → 点「多人对战」→ 输昵称 → 点「建新房间」，拿到 4 位房间码。
2. 把链接 `https://你的站点.netlify.app/game.html?room=K7Q2` 发给朋友，打开就自动进房。
3. 房内任何人点「开始比赛」都会触发全场倒计时，3-2-1 后同时起跑。
4. 下面的排行榜实时刷新每个人的进度，撞到尖刺就出局，最后比分数。

房间最多 8 人。6 秒没有动静的玩家会被自动清出房间。

---

## 五、为什么赛道是公平的

跑酷类的多人对战最容易翻车的地方是「每台机器随机出不一样的障碍物」。这里的处理：

- 房间种子由发起方生成，随 `start` 消息广播给所有人；
- `src/track.js` 用 `mulberry32(seed)` 预生成整条障碍物序列，以**世界坐标**记录；
- 相机位置就是「已行进距离」，速度只是距离的纯函数 `speed = 110 + dist × 0.042`；
- 物理跑**固定 1/120 秒步长**，和帧率无关。

结论：同一条 seed ⇒ 任意进度处遇到的障碍物完全相同，60Hz 和 144Hz 的机器也一样公平。
分数 = 距离 / 10，本质上就是「跑了多远」，天然可比。

---

## 六、想改点什么

| 想改 | 去哪改 |
| --- | --- |
| 速度、难度曲线 | `src/track.js` 里的 `BASE_SPEED` / `MAX_SPEED` / `SPEED_GAIN` |
| 障碍物间距和高度 | `src/track.js` 里的 `HEIGHTS` / `GAP_MIN` / `GAP_RANGE` |
| 重力、弹跳力 | `src/game.js` 里的 `GRAVITY` / `JUMP_V` |
| 配色 | `src/game.js` 顶部的 `C` 对象 |
| 房间人数上限 | `src/race.js` 里的 `MAX_PLAYERS` |
| 进度同步频率 | `src/race.js` 里的 `POS_INTERVAL`（默认 120ms） |
| 加"跑到 X 分就赢" | `src/game.js` 已支持 `target`；把 `game.html` 里 `race.startMatch({ target: 0 })` 的 0 改成 300 即可 |
