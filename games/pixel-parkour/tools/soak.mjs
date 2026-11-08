// 长连接稳定性测试：保持连接若干分钟，观察会不会自己断开、重连了几次。
// 用法：node tools/soak.mjs [分钟数]

import { createNet } from '../src/net.js';
import { makeId, makeRoomCode } from '../src/rng.js';

const minutes = Number(process.argv[2] || 3);
const ROOM = 'pixelrun-' + makeRoomCode(4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const stats = { reconnects: 0, sent: 0, received: 0, lastStatus: '在' };

function makePeer(name) {
  const me = { id: makeId(), name, color: null };
  const net = createNet({
    topic: ROOM,
    peerId: me.id,
    onMessage: () => { stats.received++; },
    onStatus: (s) => {
      stats.lastStatus = s;
      if (s === 'reconnecting') stats.reconnects++;
    },
  });
  return { net, me };
}

const A = makePeer('A');
const B = makePeer('B');

console.log(`房间 ${ROOM} · 保持 ${minutes} 分钟，每 10 秒互发一次\n`);

// 模拟页面：持续保活
let tick = 0;
const beat = setInterval(() => {
  tick++;
  A.net.send({ t: 'pos', from: A.me.id, n: tick });
  B.net.send({ t: 'pos', from: B.me.id, n: tick });
  stats.sent += 2;
}, 1500);

const total = minutes * 60 * 1000;
const start = Date.now();
let lastReport = 0;

while (Date.now() - start < total) {
  await sleep(1000);
  const elapsed = Math.round((Date.now() - start) / 1000);
  if (elapsed - lastReport >= 20) {
    lastReport = elapsed;
    console.log(`  ${String(elapsed).padStart(3)}s  状态=${stats.lastStatus}  发出=${stats.sent}  收到=${stats.received}  重连=${stats.reconnects}`);
  }
}

clearInterval(beat);
A.net.close();
B.net.close();

console.log(`\n结果：${minutes} 分钟内重连 ${stats.reconnects} 次，收到 ${stats.received}/${stats.sent} 条消息`);
process.exit(stats.reconnects === 0 && stats.received > 0 ? 0 : 1);
