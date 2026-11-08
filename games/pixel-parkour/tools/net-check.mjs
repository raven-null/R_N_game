// 端到端验证 src/net.js：真的建两个连接，互发消息。
// 用法：node tools/net-check.mjs
// 需要 config.js 里已经填好 Supabase 配置。

import { createNet, supabaseConfigured } from '../src/net.js';

if (!supabaseConfigured()) {
  console.error('config.js 里还没有填 Supabase 配置');
  process.exit(2);
}

const TOPIC = 'pixelrun-NETCHECK';
const log = (...a) => console.log('  ', ...a);

function makePeer(id, sink) {
  return new Promise((resolve) => {
    const net = createNet({
      topic: TOPIC,
      peerId: id,
      onMessage: (msg) => {
        sink.push(msg);
        log(`${id} 收到:`, JSON.stringify(msg));
        resolve(net);
      },
      onStatus: (s) => {
        log(`${id} 状态: ${s}`);
        if (s === 'online') resolve(net);
        if (s === 'error') console.log(`  ${id} 出错`);
      },
    });
  });
}

const gotA = [];
const gotB = [];

console.log('\n建立连接…');
const netA = await makePeer('玩家A', gotA);
await new Promise((r) => setTimeout(r, 500));
const netB = await makePeer('玩家B', gotB);

// 等两个都真正 online
await new Promise((r) => setTimeout(r, 1200));

log('模式:', netA.mode);
log('玩家A 发送 hello…');
netA.send({ t: 'hello', from: 'A', name: '小明' });

// 等 B 收到
const deadline = Date.now() + 8000;
while (gotB.length === 0 && Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 200));
}

// 反方向也测一次
log('玩家B 回复…');
netB.send({ t: 'hello', from: 'B', name: '小红' });
const deadline2 = Date.now() + 8000;
while (gotA.length === 0 && Date.now() < deadline2) {
  await new Promise((r) => setTimeout(r, 200));
}

netA.close();
netB.close();

console.log('');
if (gotB.length > 0 && gotA.length > 0) {
  console.log('✓ 双向收发都通了，src/net.js 可以用于线上多人。');
  process.exit(0);
} else {
  console.log(`✗ 失败：A→B 收到 ${gotB.length} 条，B→A 收到 ${gotA.length} 条`);
  process.exit(1);
}
