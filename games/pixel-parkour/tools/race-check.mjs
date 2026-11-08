// 端到端验证「多人对战」完整流程：连真实 Supabase，模拟两个玩家从进房到开赛到出局。
// 用法：node tools/race-check.mjs
// 需要 config.js 已填好 Supabase 配置。

import { createNet } from '../src/net.js';
import { createRace } from '../src/race.js';
import { makeId, makeRoomCode } from '../src/rng.js';

const ROOM = 'pixelrun-' + makeRoomCode(4);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('  ', ...a);

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  ✓ ' + name); }
  else { failures++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}

function makePlayer(name) {
  const me = { id: makeId(), name, color: null };
  const events = [];
  let race = null;

  const net = createNet({
    topic: ROOM,
    peerId: me.id,
    onMessage: (m) => race?.handle(m),
    onStatus: () => {},
  });

  race = createRace({
    net,
    me,
    onPeers: () => {},
    onEvent: (type, data) => events.push({ type, data }),
  });

  return { me, net, race, events };
}

console.log('\n房间: ' + ROOM + '\n');

const A = makePlayer('小明');
const B = makePlayer('小红');

console.log('两人进房…');
A.race.join();
B.race.join();

await sleep(2500);

check('A 看到 2 个玩家', A.race.playerCount === 2, `实际 ${A.race.playerCount}`);
check('B 看到 2 个玩家', B.race.playerCount === 2, `实际 ${B.race.playerCount}`);

const aSeesB = A.race.peers.some((p) => p.name === '小红');
const bSeesA = B.race.peers.some((p) => p.name === '小明');
check('A 的名单里有小红', aSeesB);
check('B 的名单里有小明', bSeesA);

console.log('\nA 发起比赛…');
A.race.startMatch({ target: 0 });
await sleep(1800);

const bStart = B.events.find((e) => e.type === 'start');
const aStart = A.events.find((e) => e.type === 'start');
check('B 收到开局广播', Boolean(bStart));
check('A 本地也开局了', Boolean(aStart));
check('两端赛道种子一致',
  Boolean(aStart && bStart && aStart.data.seed === bStart.data.seed),
  aStart && bStart ? `A=${aStart.data.seed} B=${bStart.data.seed}` : '有一端没收到');

console.log('\nA 跑起来（分数 50）…');
A.race.updateLocal({ dist: 500, score: 50, alive: true });
await sleep(600);

const bViewOfA = B.race.peers.find((p) => p.name === '小明');
check('B 看到 A 的实时分数', bViewOfA && bViewOfA.score === 50, bViewOfA ? `实际 ${bViewOfA.score}` : '没找到 A');

console.log('\nA 撞死出局…');
A.race.sendDead({ dist: 500, score: 50 });
await sleep(600);

const bViewOfADead = B.race.peers.find((p) => p.name === '小明');
check('B 看到 A 已出局', bViewOfADead && bViewOfADead.alive === false);

console.log('\nB 继续跑到 120 分…');
B.race.updateLocal({ dist: 1200, score: 120, alive: true });
await sleep(600);

const aViewOfB = A.race.peers.find((p) => p.name === '小红');
check('A 看到 B 的分数', aViewOfB && aViewOfB.score === 120, aViewOfB ? `实际 ${aViewOfB.score}` : '没找到 B');

const ranking = A.race.peers.map((p) => `${p.rank}.${p.name}(${p.score})`).join(' ');
log('A 端榜面: ' + ranking);
check('排名按分数排序正确', A.race.peers[0].name === '小红');

A.race.leave();
B.race.leave();

console.log('');
if (failures === 0) {
  console.log('✓ 多人对战全流程通过，可以开玩了。');
  process.exit(0);
} else {
  console.log(`✗ ${failures} 项失败`);
  process.exit(1);
}
