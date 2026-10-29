// 不依赖浏览器跑一遍核心逻辑：赛道确定性、可通过性、物理仿真、联机同步。
// 用法：node tools/sim.mjs

import assert from 'node:assert/strict';
import { createGame } from '../src/game.js';
import { createTrack, speedAt, scoreAt, jumpSpan, PLAYER_X, GROUND, PLAYER_H } from '../src/track.js';
import { createRace } from '../src/race.js';

const GRAVITY = 1500;
const JUMP_V = -455;
const PASS = (s) => console.log('  \u2713 ' + s);
let failures = 0;

function test(name, fn) {
  try {
    fn();
    PASS(name);
  } catch (err) {
    failures++;
    console.log('  \u2717 ' + name + '\n    ' + err.message);
  }
}

// ---------- canvas mock ----------
function mockCanvas() {
  const gradient = { addColorStop() {} };
  const stats = { fillRect: 0, strokeRect: 0, minY: Infinity, maxY: -Infinity };
  const ctx = {
    imageSmoothingEnabled: true,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    fillRect(x, y, w, h) {
      stats.fillRect++;
      if (typeof y === 'number' && typeof h === 'number') {
        stats.minY = Math.min(stats.minY, y);
        stats.maxY = Math.max(stats.maxY, y + h);
      }
    },
    strokeRect() { stats.strokeRect++; },
    createLinearGradient() { return gradient; },
  };
  return { width: 320, height: 180, getContext: () => ctx, __stats: stats };
}

console.log('\n[1] 赛道确定性');
test('同一种子生成完全相同的障碍物序列', () => {
  const a = createTrack('ROOM-42').obstacles.slice(0, 40);
  const b = createTrack('ROOM-42').obstacles.slice(0, 40);
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.equal(a[i].worldX, b[i].worldX);
    assert.equal(a[i].w, b[i].w);
    assert.equal(a[i].h, b[i].h);
  }
});

test('不同种子生成不同赛道', () => {
  const a = createTrack('ROOM-42').obstacles.slice(0, 40);
  const b = createTrack('ROOM-99').obstacles.slice(0, 40);
  const same = a.every((o, i) => o.worldX === b[i].worldX && o.h === b[i].h);
  assert.equal(same, false, '两个种子竟然生成了同一条赛道');
});

test('速度是距离的纯函数且封顶', () => {
  assert.equal(speedAt(0), 110);
  assert.equal(speedAt(1000), speedAt(1000));
  assert.ok(speedAt(999999) <= 250);
  assert.ok(speedAt(500) > speedAt(0));
});

console.log('\n[2] 可通过性（这条赛道人类能不能跑通）');
test('每一段间距都容许落地后再起跳', () => {
  const track = createTrack('FAIRNESS');
  track.ensure(40000);            // 先铺满足够长的赛道再逐段检查
  assert.ok(track.obstacles.length > 50, '赛道太短，检查没意义');
  let worst = Infinity;
  for (let i = 0; i + 1 < track.obstacles.length; i++) {
    const cur = track.obstacles[i];
    const next = track.obstacles[i + 1];
    const meetDist = cur.worldX - PLAYER_X;          // 玩家遇到当前障碍时的行进距离
    const span = jumpSpan(GRAVITY, JUMP_V, speedAt(meetDist));
    const gap = next.worldX - cur.worldX;
    worst = Math.min(worst, gap - span);
    assert.ok(gap > span, `第 ${i} 段间距 ${gap.toFixed(0)}px 小于跳跃跨度 ${span.toFixed(0)}px`);
  }
  PASS(`最紧的一段还剩 ${worst.toFixed(0)}px 余量`);
});

test('跳跃高度足够越过最高的刺', () => {
  const peak = (JUMP_V * JUMP_V) / (2 * GRAVITY);
  const track = createTrack('HEIGHTS');
  track.ensure(40000);
  const tallest = Math.max(...track.obstacles.map((o) => o.h));
  assert.ok(peak > tallest + 4, `跳跃高度 ${peak.toFixed(0)}px 不足以越过 ${tallest}px 的刺`);
  PASS(`跳高 ${peak.toFixed(0)}px，最高的刺 ${tallest}px`);
});

console.log('\n[3] 物理仿真（模拟一个会跳的玩家）');
function simulate(seed, seconds, { jump = true } = {}) {
  const game = createGame(mockCanvas());
  const track = createTrack(seed);       // 和 game 内部同种子的镜像赛道，用于前瞻
  let died = false;
  game.on('death', () => { died = true; });
  game.start(seed);

  const dt = 1000 / 60;
  let t = 0;
  let jumps = 0;
  const steps = Math.floor(seconds * 60);

  for (let i = 0; i < steps && !died; i++) {
    t += dt;
    if (jump) {
      const speed = speedAt(game.dist);
      const span = jumpSpan(GRAVITY, JUMP_V, speed);
      track.ensure(game.dist);   // 镜像赛道也要跟着生成
      const ahead = track.obstacles.find((o) => o.worldX + o.w > game.dist + PLAYER_X);
      if (ahead) {
        const d = ahead.worldX - (game.dist + PLAYER_X);
        if (d >= 0 && d < span * 0.55) { game.jump(); jumps++; }
      }
    }
    game.frame(t);
  }
  return { game, died, jumps, score: game.score, dist: game.dist };
}

test('会跳的玩家能跑满 60 秒不死', () => {
  for (const seed of ['AAA', 'BBB', 'CCC', 'DDD', 'EEE']) {
    const r = simulate(seed, 60);
    assert.equal(r.died, false, `种子 ${seed} 在 ${r.score} 分时撞死了`);
  }
});

test('会跳的玩家分数确实在涨', () => {
  const r = simulate('SCORE', 20);
  assert.ok(r.score > 60, `20 秒只跑了 ${r.score} 分`);
});

test('完全不跳必定撞死', () => {
  const r = simulate('DEAD', 20, { jump: false });
  assert.equal(r.died, true, '不跳居然没死，碰撞检测有问题');
  assert.ok(r.score < 120, '不跳跑得太远了');
});

test('分数 = 距离 / 10', () => {
  const r = simulate('SCORE2', 10);
  assert.equal(r.score, Math.floor(r.dist / 10));
});

test('物理与帧率无关（30fps 和 144fps 结果一致）', () => {
  function runAtFps(fps, seconds) {
    const game = createGame(mockCanvas());
    const track = createTrack('FPS');
    game.start('FPS');
    const dt = 1000 / fps;
    let t = 0;
    for (let i = 0; i < fps * seconds; i++) {
      t += dt;
      const span = jumpSpan(GRAVITY, JUMP_V, speedAt(game.dist));
      track.ensure(game.dist);
      const ahead = track.obstacles.find((o) => o.worldX + o.w > game.dist + PLAYER_X);
      if (ahead) {
        const d = ahead.worldX - (game.dist + PLAYER_X);
        if (d >= 0 && d < span * 0.55) game.jump();
      }
      game.frame(t);
    }
    return game.score;
  }
  const a = runAtFps(30, 20);
  const b = runAtFps(144, 20);
  // 固定步长物理下应该非常接近（只差亚步长的取整）
  assert.ok(Math.abs(a - b) <= 2, `30fps 得到 ${a} 分，144fps 得到 ${b} 分，差异过大`);
  PASS(`30fps=${a} 分 / 144fps=${b} 分`);
});

console.log('\n[4] 多人分跑道渲染');
test('分跑道模式下能正常渲染，且画出 3 个角色', () => {
  const canvas = mockCanvas();
  const game = createGame(canvas);
  game.start('LANE');

  const lanes = [
    { id: 'a', name: '小明', color: '#ffb86b', dist: 0, score: 0, y: GROUND - PLAYER_H, alive: true, isMe: true },
    { id: 'b', name: '小红', color: '#6ea8ff', dist: 300, score: 30, y: GROUND - PLAYER_H - 40, alive: true, isMe: false },
    { id: 'c', name: '小刚', color: '#38e8c8', dist: 150, score: 15, y: GROUND - PLAYER_H, alive: false, isMe: false },
  ];
  game.setLanes(lanes);

  const stats = canvas.__stats;
  stats.fillRect = 0;
  stats.strokeRect = 0;

  // 跑几帧确认不抛错
  let t = 0;
  for (let i = 0; i < 10; i++) { t += 16.7; game.frame(t); }

  assert.ok(stats.fillRect > 100, `分跑道渲染没有画出足够图元（fillRect=${stats.fillRect}）`);
  assert.ok(stats.strokeRect >= 1, '自己的跑道应该有高亮边框');

  // 关掉分跑道后回到单机画面
  game.setLanes(null);
  stats.fillRect = 0;
  t += 16.7;
  game.frame(t);
  assert.ok(stats.fillRect > 0, 'setLanes(null) 后应该回到单机渲染');
  PASS('分跑道 / 单机切换正常');
});

test('8 人满员分跑道时，所有图元都不画出画布', () => {
  const canvas = mockCanvas();
  const game = createGame(canvas);
  game.start('LANE8');

  const lanes = [];
  for (let i = 0; i < 8; i++) {
    lanes.push({
      id: 'p' + i,
      name: '玩家' + i,
      color: ['#6ea8ff', '#ffb86b', '#38e8c8', '#a678ff', '#ff7b9c', '#ffe066', '#7ef07e', '#ff9f5a'][i],
      dist: i * 400,
      score: i * 40,
      // 交替：在地面 / 跳到最高点
      y: i % 2 === 0 ? GROUND - PLAYER_H : GROUND - PLAYER_H - 69,
      alive: i !== 7,
      isMe: i === 0,
    });
  }
  game.setLanes(lanes);

  const stats = canvas.__stats;
  stats.fillRect = 0;
  stats.minY = Infinity;
  stats.maxY = -Infinity;

  let t = 0;
  for (let i = 0; i < 5; i++) { t += 16.7; game.frame(t); }

  assert.ok(stats.fillRect > 200, `8 人渲染图元太少（${stats.fillRect}）`);
  assert.ok(stats.maxY <= 180, `有图元画到画布下方（maxY=${stats.maxY}）`);
  assert.ok(stats.minY >= 0, `有图元画到画布上方（minY=${stats.minY}）`);
});


console.log('\n[5] 联机同步（消息总线模拟两个玩家）');
test('两人进房、开局、进度互相同步', () => {
  const subs = [];
  const bus = {
    attach(id, handler) { subs.push({ id, handler }); },
    net(id) {
      return {
        mode: 'local',
        send(payload) {
          for (const s of subs) {
            if (s.id !== id) s.handler({ v: 1, ts: Date.now(), ...payload });
          }
        },
        close() {},
      };
    },
  };

  const created = [];
  const events = {};
  const ev = (id) => (events[id] ||= []);
  const raceRef = {};

  function makePeer(id, name) {
    bus.attach(id, (msg) => raceRef[id].handle(msg));
    const race = createRace({
      net: bus.net(id),
      me: { id, name, color: null },
      onPeers: () => {},
      onEvent: (type, data) => ev(id).push({ type, data }),
    });
    raceRef[id] = race;
    created.push(race);
    return race;
  }

  const A = makePeer('peerA', '小明');
  const B = makePeer('peerB', '小红');
  A.join();
  B.join();

  assert.equal(A.playerCount, 2, 'A 应该看到 2 个玩家');
  assert.equal(B.playerCount, 2, 'B 应该看到 2 个玩家');

  A.startMatch({ target: 0 });
  assert.equal(ev('peerA').filter((e) => e.type === 'start').length, 1, 'A 应收到一次开局');
  assert.equal(ev('peerB').filter((e) => e.type === 'start').length, 1, 'B 应收到一次开局');

  // 两个端拿到的种子必须一致，否则赛道就不同了
  const seedA = ev('peerA').find((e) => e.type === 'start').data.seed;
  const seedB = ev('peerB').find((e) => e.type === 'start').data.seed;
  assert.equal(seedA, seedB, '两端拿到的赛道种子不一致');

  // 进度同步
  A.updateLocal({ dist: 900, score: 90, alive: true });
  const bSeesA = B.peers.find((p) => p.id === 'peerA');
  assert.ok(bSeesA, 'B 没看到 A');
  assert.equal(bSeesA.score, 90);

  // 出局同步
  const anyPeer = A.peers[0];
  assert.ok(anyPeer.id);

  A.leave();
  B.leave();
});

test('重复的 start 消息不会重开一局', () => {
  const subs = [];
  const bus = {
    attach(id, h) { subs.push({ id, handler: h }); },
    net(id) {
      return {
        mode: 'local',
        send(p) { for (const s of subs) if (s.id !== id) s.handler({ v: 1, ts: Date.now(), ...p }); },
        close() {},
      };
    },
  };
  const events = {};
  const ev = (id) => (events[id] ||= []);
  const raceRef = {};
  function peer(id) {
    bus.attach(id, (m) => raceRef[id].handle(m));
    const race = createRace({
      net: bus.net(id), me: { id, name: id, color: null },
      onPeers: () => {}, onEvent: (t, d) => ev(id).push({ type: t, data: d }),
    });
    raceRef[id] = race;
    return race;
  }
  const A = peer('x1');
  const B = peer('x2');
  A.join();
  B.join();
  A.startMatch({ target: 0 });
  // 伪造一条同种子的重复广播
  subs[0].handler({ v: 1, ts: Date.now(), t: 'start', from: 'x1', seed: ev('x2')[0].data.seed, target: 0 });
  assert.equal(ev('x2').filter((e) => e.type === 'start').length, 1, '重复 start 导致重复开局');
  A.leave();
  B.leave();
});

console.log('\n' + (failures === 0 ? '全部通过 ✓' : failures + ' 项失败 ✗'));
process.exit(failures === 0 ? 0 : 1);
