// 复现"过一会就都断了"：两个玩家进房后什么都不做，观察会不会互相消失。
// 用法：node tools/idle-check.mjs

import { createNet } from '../src/net.js';
import { createRace } from '../src/race.js';
import { makeId, makeRoomCode } from '../src/rng.js';

const ROOM = 'pixelrun-' + makeRoomCode(4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makePlayer(name) {
  const me = { id: makeId(), name, color: null };
  let race = null;
  const net = createNet({
    topic: ROOM,
    peerId: me.id,
    onMessage: (m) => race?.handle(m),
    onStatus: () => {},
  });
  race = createRace({ net, me, onPeers: () => {}, onEvent: () => {} });
  return { me, net, race };
}

console.log('\n房间: ' + ROOM + '（进房后什么都不做，只看还在不在）\n');
const A = makePlayer('小明');
const B = makePlayer('小红');
A.race.join();
B.race.join();

// 模拟真实页面：主循环每帧都会调用 updateLocal 保活
const beat = setInterval(() => {
  A.race.updateLocal({ dist: 0, score: 0, alive: true });
  B.race.updateLocal({ dist: 0, score: 0, alive: true });
}, 50);

let prev = 0;
for (const t of [2, 5, 8, 12, 18, 25]) {
  await sleep((t - prev) * 1000);
  prev = t;
  const a = A.race.playerCount;
  const b = B.race.playerCount;
  const flag = (a < 2 || b < 2) ? '   <-- 有人消失了' : '';
  console.log(`  t=${String(t).padStart(2)}s   A 看到 ${a} 人 · B 看到 ${b} 人${flag}`);
}

clearInterval(beat);
A.race.leave();
B.race.leave();
process.exit(0);
