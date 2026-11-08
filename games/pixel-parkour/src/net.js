// 实时传输层：两套实现，同一个接口。
//
//   1. local    —— BroadcastChannel，同一浏览器的多个窗口/标签页互连，零配置、零后端。
//   2. supabase —— Supabase Realtime 的裸 WebSocket，手写客户端，不引入任何 CDN 依赖。
//
// Supabase 那套是严格照着 @supabase/realtime-js 的 serializer 对齐的：
//   - URL 必须带 vsn=2.0.0
//   - 普通事件（join / heartbeat / reply）是 JSON 数组帧：[join_ref, ref, topic, event, payload]
//   - 广播（broadcast）走二进制帧，带 7 字节头（见 encodeBroadcast）
//   - 频道默认 private，匿名客户端必须显式传 private: false
// 这几点少一个都表现为"能连上、能 join，但消息静默丢失"，所以别随手改。

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

const HEARTBEAT_MS = 28000;
const RECONNECT_MAX_MS = 15000;

export const NET_LOCAL = 'local';
export const NET_SUPABASE = 'supabase';

export function supabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

// ---------- 二进制广播编码 ----------
// 头部布局（7 字节）：
//   [0] kind = 3 (userBroadcastPush)
//   [1] joinRef 字节长度   [2] ref 字节长度
//   [3] topic 字节长度     [4] userEvent 字节长度
//   [5] metadata 字节长度  [6] encodingType（1 = payload 是 JSON 文本）
// 随后依次是 joinRef / ref / topic / userEvent / metadata / payload 的 UTF-8 字节。
const KIND_USER_BROADCAST_PUSH = 3;
const KIND_USER_BROADCAST = 4;
const ENCODING_JSON = 1;
const BROADCAST_HEADER = 7;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encodeBroadcast(topic, event, payload, joinRef, ref) {
  const joinRefB = encoder.encode(joinRef ?? '');
  const refB = encoder.encode(ref ?? '');
  const topicB = encoder.encode(topic);
  const eventB = encoder.encode(event);
  const metaB = encoder.encode('');
  const payloadB = encoder.encode(JSON.stringify(payload));

  const out = new Uint8Array(
    BROADCAST_HEADER + joinRefB.length + refB.length +
    topicB.length + eventB.length + payloadB.length
  );
  out[0] = KIND_USER_BROADCAST_PUSH;
  out[1] = joinRefB.length;
  out[2] = refB.length;
  out[3] = topicB.length;
  out[4] = eventB.length;
  out[5] = metaB.length;
  out[6] = ENCODING_JSON;

  let o = BROADCAST_HEADER;
  out.set(joinRefB, o); o += joinRefB.length;
  out.set(refB, o); o += refB.length;
  out.set(topicB, o); o += topicB.length;
  out.set(eventB, o); o += eventB.length;
  out.set(payloadB, o);

  return out.buffer;
}

// 把收到的帧统一成 { topic, event, payload }，文本数组帧和二进制广播帧都认。
function decodeFrame(data) {
  if (typeof data === 'string') {
    let arr;
    try { arr = JSON.parse(data); } catch { return null; }
    if (!Array.isArray(arr)) return null;
    const [, , topic, event, payload] = arr;
    return { topic, event, payload };
  }

  const buf = data instanceof ArrayBuffer ? data
    : (data && data.buffer instanceof ArrayBuffer ? data.buffer : null);
  if (!buf) return null;

  const view = new DataView(buf);
  if (view.getUint8(0) !== KIND_USER_BROADCAST) return null;

  const topicSize = view.getUint8(1);
  const eventSize = view.getUint8(2);
  const metaSize = view.getUint8(3);
  const encoding = view.getUint8(4);

  let o = 5;
  const topic = decoder.decode(buf.slice(o, o + topicSize)); o += topicSize;
  const userEvent = decoder.decode(buf.slice(o, o + eventSize)); o += eventSize;
  o += metaSize;   // metadata 我们没用到
  const payloadBuf = buf.slice(o);

  let parsed;
  try {
    parsed = encoding === ENCODING_JSON ? JSON.parse(decoder.decode(payloadBuf)) : payloadBuf;
  } catch { return null; }

  return {
    topic,
    event: 'broadcast',
    payload: { type: 'broadcast', event: userEvent, payload: parsed },
  };
}

// ---------- 本地传输：BroadcastChannel ----------
function createLocalLink(topic, onData, onStatus) {
  const ch = new BroadcastChannel(topic);
  ch.onmessage = (e) => onData(e.data);
  onStatus('online');
  return {
    send(obj) { ch.postMessage(obj); },
    close() { ch.close(); },
  };
}

// ---------- Supabase 传输 ----------
function realtimeWsUrl(url, key) {
  const wsBase = url.replace(/^http/, 'ws').replace(/\/+$/, '');
  return `${wsBase}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=2.0.0`;
}

function createSupabaseLink({ url, key, topic, onData, onStatus }) {
  const channelTopic = `realtime:${topic}`;
  let ws = null;
  let ref = 0;
  let joinRef = null;
  let heartbeat = null;
  let reconnectTimer = null;
  let attempt = 0;
  let closedByUser = false;
  let joined = false;

  const nextRef = () => String(++ref);

  // v2 帧：JSON 数组
  function pushFrame(frameJoinRef, frameRef, frameTopic, event, payload) {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify([frameJoinRef, frameRef, frameTopic, event, payload]));
    }
  }

  function connect() {
    if (closedByUser) return;
    onStatus(attempt === 0 ? 'connecting' : 'reconnecting');

    ws = new WebSocket(realtimeWsUrl(url, key));
    // 浏览器默认给 Blob，必须改成 ArrayBuffer 才能解析二进制广播帧
    ws.binaryType = 'arraybuffer';

    ws.onopen = () => {
      joined = false;
      attempt = 0;
      joinRef = nextRef();
      pushFrame(joinRef, joinRef, channelTopic, 'phx_join', {
        config: {
          broadcast: { ack: false, self: false },
          // 我们用自定义的 hello 广播做成员发现，不需要服务端 presence 跟踪
          presence: { key: '', enabled: false },
          postgres_changes: [],
          // 关键：频道默认是 private，匿名客户端收不到任何东西
          private: false,
        },
      });

      heartbeat = setInterval(() => {
        pushFrame(null, nextRef(), 'phoenix', 'heartbeat', {});
      }, HEARTBEAT_MS);
    };

    ws.onmessage = (e) => {
      const frame = decodeFrame(e.data);
      if (!frame) return;

      if (frame.event === 'phx_reply') {
        if (frame.topic === channelTopic && frame.payload?.status === 'ok' && !joined) {
          joined = true;
          onStatus('online');
        } else if (frame.payload?.status === 'error') {
          onStatus('error');
        }
        return;
      }

      if (frame.event === 'system' || frame.event === 'presence_state' || frame.event === 'presence_diff') return;
      if (!joined) return;

      // 普通 broadcast 帧就是 { type, event, payload }
      if (frame.event === 'broadcast' && frame.payload?.payload !== undefined) {
        onData(frame.payload.payload);
      }
    };

    ws.onerror = () => { /* onclose 会接手 */ };

    ws.onclose = () => {
      clearInterval(heartbeat);
      heartbeat = null;
      joined = false;
      if (closedByUser) return;
      onStatus('reconnecting');
      attempt += 1;
      reconnectTimer = setTimeout(connect, Math.min(RECONNECT_MAX_MS, 800 * 2 ** Math.min(attempt, 4)));
    };
  }

  connect();

  return {
    send(obj) {
      if (!joined) return;
      // 广播必须走二进制帧，且带上 joinRef / 一个递增 ref，
      // 否则服务端无法把广播关联到已加入的频道，会静默丢弃。
      ws.send(encodeBroadcast(channelTopic, 'msg', obj, joinRef, nextRef()));
    },
    close() {
      closedByUser = true;
      clearTimeout(reconnectTimer);
      clearInterval(heartbeat);
      if (joined) pushFrame(joinRef, nextRef(), channelTopic, 'phx_leave', {});
      try { ws?.close(); } catch { /* ignore */ }
    },
  };
}

// ---------- 统一入口 ----------
export function createNet({ topic, peerId, onMessage, onStatus }) {
  const useCloud = supabaseConfigured();
  const link = useCloud
    ? createSupabaseLink({
        url: SUPABASE_URL,
        key: SUPABASE_ANON_KEY,
        topic,
        onData: onMessage,
        onStatus,
      })
    : createLocalLink(topic, onMessage, onStatus);

  return {
    mode: useCloud ? NET_SUPABASE : NET_LOCAL,
    send(payload) {
      link.send({ v: 1, ts: Date.now(), ...payload });
    },
    close() {
      link.close();
    },
  };
}

export { encodeBroadcast, decodeFrame };
