// 测 Supabase Realtime 的实际广播延迟：同一台机器上两个连接互发，时钟一致，
// 所以「发出时间戳 → 收到」的差值是准确的单向延迟。
// 用法：node tools/latency.mjs <url> <key> [次数]

import { encodeBroadcast, decodeFrame } from '../src/net.js';

const url = process.argv[2];
const key = process.argv[3];
const rounds = Number(process.argv[4] || 8);

if (!url || !key) {
  console.error('用法: node tools/latency.mjs <url> <key> [次数]');
  process.exit(2);
}

const TOPIC = 'realtime:pixelrun-LAT';
const wsUrl = url.replace(/^http/, 'ws').replace(/\/+$/, '') +
  `/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=2.0.0`;

function connect(onData) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    let ref = 0;
    let joinRef = '1';
    const t0 = Date.now();

    const send = (obj) => ws.send(encodeBroadcast(TOPIC, 'msg', obj, joinRef, String(++ref)));

    ws.onopen = () => {
      joinRef = String(++ref);
      ws.send(JSON.stringify([joinRef, joinRef, TOPIC, 'phx_join', {
        config: {
          broadcast: { ack: false, self: false },
          presence: { key: '', enabled: false },
          postgres_changes: [],
          private: false,
        },
      }]));
    };

    ws.onmessage = (e) => {
      const f = decodeFrame(e.data);
      if (!f) return;
      if (f.event === 'phx_reply' && f.payload?.status === 'ok') {
        resolve({ ws, send, connectMs: Date.now() - t0 });
        return;
      }
      if (f.event === 'broadcast' && f.payload?.payload) onData(f.payload.payload);
    };

    ws.onerror = () => reject(new Error('连接失败'));
    setTimeout(() => reject(new Error('连接超时')), 15000);
  });
}

const samples = [];

const b = await connect((msg) => {
  if (typeof msg.ping === 'number') samples.push(Date.now() - msg.ping);
});
const a = await connect(() => {});

// 让两个 join 都稳定
await new Promise((r) => setTimeout(r, 800));

for (let i = 0; i < rounds; i++) {
  a.send({ ping: Date.now(), i });
  await new Promise((r) => setTimeout(r, 220));
}

// 等最后几条到达
await new Promise((r) => setTimeout(r, 600));

a.ws.close();
b.ws.close();

if (samples.length === 0) {
  console.log('没收到任何回环消息，测不出延迟');
  process.exit(1);
}

const sorted = [...samples].sort((x, y) => x - y);
const avg = samples.reduce((s, x) => s + x, 0) / samples.length;
const med = sorted[Math.floor(sorted.length / 2)];

console.log(`${url}`);
console.log(`  join 耗时 ${b.connectMs}ms · 样本 ${samples.length} 条`);
console.log(`  单向延迟 中位数 ${med}ms / 平均 ${avg.toFixed(0)}ms / 最慢 ${sorted[sorted.length - 1]}ms`);
process.exit(0);
