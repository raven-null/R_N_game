// 房间逻辑：成员表、进度同步、开局广播、掉线清理。
//
// 刻意不搞 host 选举：等待厅里谁点「开始」都能发起，收到 start 就各自本地倒计时起跑。
// 这样避免了"房主掉线全场卡死"，代价只是各端起跑时刻有网络延迟级(几十~几百毫秒)的偏差，
// 而赛道本身由统一的 seed 决定，所以比赛依然公平。

import { makeSeedString, makeId } from './rng.js';
import { GROUND, PLAYER_H } from './track.js';

const POS_INTERVAL_RACE = 90;    // 比赛中的进度广播（也决定对手动作的流畅度）
const POS_INTERVAL_IDLE = 1500;  // 等待厅/已出局时的保活心跳（必须有，否则会被判掉线）
const HELLO_INTERVAL = 5000;     // 定期重新打招呼，用于误判掉线后的自愈
const PEER_TIMEOUT = 12000;      // 多久没动静算掉线（留够网络抖动的余量）
const MAX_PLAYERS = 8;

export const PHASE_IDLE = 'idle';
export const PHASE_LOBBY = 'lobby';
export const PHASE_RACING = 'racing';

const COLORS = ['#6ea8ff', '#ffb86b', '#38e8c8', '#a678ff', '#ff7b9c', '#ffe066', '#7ef07e', '#ff9f5a'];

export function createRace({ net, me, onPeers, onEvent }) {
  const peers = new Map();
  let phase = PHASE_IDLE;
  let lastPosSent = 0;
  let lastSeed = null;
  let lastTarget = 0;
  let sweepTimer = null;
  let greetTimer = null;
  let keepaliveTimer = null;

  function snapshot() {
    const list = [...peers.values()].sort((a, b) => (b.dist - a.dist) || a.joinedAt - b.joinedAt);
    return list.map((p, i) => ({ ...p, rank: i + 1 }));
  }

  function publish() {
    if (onPeers) onPeers(snapshot(), phase);
  }

  function touch(id, patch) {
    const p = peers.get(id);
    if (!p) return null;
    p.lastSeen = Date.now();
    if (patch) Object.assign(p, patch);
    return p;
  }

  function addPeer(id, name, color) {
    if (peers.has(id)) return peers.get(id);
    if (peers.size >= MAX_PLAYERS) return null;
    const used = new Set([...peers.values()].map((p) => p.color));
    const pick = color || COLORS.find((c) => !used.has(c)) || COLORS[peers.size % COLORS.length];
    const p = {
      id,
      name: name || '玩家',
      color: pick,
      dist: 0,
      score: 0,
      alive: true,
      status: 'waiting',
      joinedAt: Date.now(),
      lastSeen: Date.now(),
      isMe: id === me.id,
    };
    peers.set(id, p);
    return p;
  }

  function handle(raw) {
    if (!raw || raw.v !== 1) return;
    const from = raw.from;
    if (!from || from === me.id) return;

    switch (raw.t) {
      case 'hello': {
        const isNew = !peers.has(from);
        const p = addPeer(from, raw.name, raw.color);
        // 只在真正发现新成员时回礼，否则两端会无限互相应答
        if (p && isNew) {
          net.send({ t: 'hello', from: me.id, name: me.name, color: me.color });
          publish();
        }
        break;
      }
      case 'pos': {
        const p = touch(from, {
          dist: raw.dist | 0,
          score: raw.score | 0,
          alive: raw.alive !== false,
          // 跳跃高度也一起同步，别人才能在分跑道里看到对手的角色在跳
          y: typeof raw.y === 'number' ? raw.y : undefined,
          status: raw.alive === false ? 'dead' : 'running',
        });
        if (p) publish();
        break;
      }
      case 'start': {
        touch(from, {});
        if (lastSeed === raw.seed) break;   // 同一个开局只认一次
        lastSeed = raw.seed;
        lastTarget = raw.target | 0;
        phase = PHASE_RACING;
        for (const p of peers.values()) {
          if (!p.isMe) Object.assign(p, { dist: 0, score: 0, alive: true, status: 'running' });
        }
        Object.assign(peers.get(me.id) ?? {}, { dist: 0, score: 0, alive: true, status: 'running' });
        publish();
        if (onEvent) onEvent('start', { seed: raw.seed, target: lastTarget });
        break;
      }
      case 'dead': {
        const p = touch(from, { alive: false, status: 'dead', score: raw.score | 0, dist: raw.dist | 0 });
        if (p) publish();
        break;
      }
      case 'finish': {
        const p = touch(from, { status: 'finished', score: raw.score | 0, dist: raw.dist | 0 });
        if (p) publish();
        break;
      }
      case 'bye': {
        if (peers.delete(from)) publish();
        break;
      }
      default:
        break;
    }
  }

  function sweep() {
    const now = Date.now();
    let changed = false;
    for (const [id, p] of peers) {
      if (p.isMe) continue;
      if (now - p.lastSeen > PEER_TIMEOUT) {
        peers.delete(id);
        changed = true;
      }
    }
    if (changed) publish();
  }

  const api = {
    get phase() { return phase; },
    get peers() { return snapshot(); },
    get me() { return peers.get(me.id); },
    get playerCount() { return peers.size; },

    join() {
      addPeer(me.id, me.name, me.color);
      peers.get(me.id).joinedAt = Date.now();
      phase = PHASE_LOBBY;
      publish();
      net.send({ t: 'hello', from: me.id, name: me.name, color: me.color });
      sweepTimer = setInterval(sweep, 2000);

      // 反复打招呼，防止自己是后进来的一方错过别人的 hello
      let greet = 0;
      greetTimer = setInterval(() => {
        net.send({ t: 'hello', from: me.id, name: me.name, color: me.color });
        if (++greet >= 3) { clearInterval(greetTimer); greetTimer = null; }
      }, 700);

      // 长期保活：万一因为网络抖动被对方误判掉线，靠定期 hello 自动恢复到名单里
      keepaliveTimer = setInterval(() => {
        if (peers.size === 0) return;
        net.send({ t: 'hello', from: me.id, name: me.name, color: me.color });
      }, HELLO_INTERVAL);
    },

    handle,

    startMatch({ target = 0 } = {}) {
      const seed = makeSeedString();
      lastSeed = seed;
      lastTarget = target;
      phase = PHASE_RACING;
      for (const p of peers.values()) {
        Object.assign(p, { dist: 0, score: 0, alive: true, status: 'running' });
      }
      publish();
      net.send({ t: 'start', from: me.id, seed, target });
      if (onEvent) onEvent('start', { seed, target, self: true });
    },

    // 每帧调用，内部节流。
    // 注意：等待厅里也必须持续发包，否则双方都收不到对方的消息，
    // 超时后会被一起清出房间 —— 这就是"进房后过一会全断了"的原因。
    updateLocal({ dist, score, alive, y }) {
      const me0 = peers.get(me.id);
      if (me0) {
        me0.dist = dist | 0;
        me0.score = score | 0;
        me0.alive = alive !== false;
        if (typeof y === 'number') me0.y = y;
        me0.lastSeen = Date.now();
      }
      if (phase === PHASE_IDLE) return;

      const now = Date.now();
      const interval = phase === PHASE_RACING ? POS_INTERVAL_RACE : POS_INTERVAL_IDLE;
      if (now - lastPosSent >= interval) {
        lastPosSent = now;
        net.send({
          t: 'pos',
          from: me.id,
          dist: dist | 0,
          score: score | 0,
          alive: alive !== false,
          y: Math.round(typeof y === 'number' ? y : GROUND - PLAYER_H),
        });
        // 只有比赛中的进度变化才值得重绘，等待厅心跳不刷新界面
        if (phase === PHASE_RACING) publish();
      }
    },

    sendDead({ dist, score }) {
      net.send({ t: 'dead', from: me.id, dist, score });
      const p = peers.get(me.id);
      if (p) { p.alive = false; p.status = 'dead'; p.score = score; p.dist = dist; publish(); }
    },

    sendFinish({ dist, score }) {
      net.send({ t: 'finish', from: me.id, dist, score });
      const p = peers.get(me.id);
      if (p) { p.status = 'finished'; p.score = score; p.dist = dist; publish(); }
    },

    resetLocal() {
      phase = PHASE_LOBBY;
      lastSeed = null;
      for (const p of peers.values()) {
        Object.assign(p, { dist: 0, score: 0, alive: true, status: 'waiting' });
      }
      publish();
    },

    leave() {
      clearInterval(sweepTimer);
      if (greetTimer) { clearInterval(greetTimer); greetTimer = null; }
      if (keepaliveTimer) { clearInterval(keepaliveTimer); keepaliveTimer = null; }
      net.send({ t: 'bye', from: me.id });
      peers.clear();
      phase = PHASE_IDLE;
      net.close();
    },
  };

  return api;
}

export { makeId };
