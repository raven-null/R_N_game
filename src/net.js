// 实时传输层：两套实现，同一个接口。
//
//   1. local    —— BroadcastChannel，同一浏览器的多个窗口/标签页互连，零配置、零后端。
//                  用来快速验证多人逻辑，也保证没配 Supabase 时项目不至于废掉。
//   2. supabase —— Supabase Realtime 的裸 WebSocket（Phoenix 协议），手写客户端，
//                  不引入任何 CDN 依赖。跨设备、跨网络的真·线上对战走这条。
//
// 上层只看 onMessage / onStatus，不关心用的是哪条路。

import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';

const HEARTBEAT_MS = 28000;

export const NET_LOCAL = 'local';
export const NET_SUPABASE = 'supabase';

export function supabaseConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
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

// ---------- Supabase 传输：裸 WebSocket + Phoenix 协议 ----------
function realtimeWsUrl(url, key) {
  const wsBase = url.replace(/^http/, 'ws').replace(/\/+$/, '');
  return `${wsBase}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`;
}

function createSupabaseLink({ url, key, topic, peerId, onData, onStatus }) {
  const channelTopic = `realtime:${topic}`;
  let ws = null;
  let ref = 0;
  let heartbeat = null;
  let reconnectTimer = null;
  let attempt = 0;
  let closedByUser = false;
  let joined = false;

  const nextRef = () => String(++ref);

  function sendRaw(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }

  function join() {
    sendRaw({
      topic: channelTopic,
      event: 'phx_join',
      payload: {
        config: {
          broadcast: { self: false, ack: false },
          presence: { key: peerId },
        },
      },
      ref: nextRef(),
    });
  }

  function connect() {
    if (closedByUser) return;
    onStatus(attempt === 0 ? 'connecting' : 'reconnecting');
    ws = new WebSocket(realtimeWsUrl(url, key));

    ws.onopen = () => {
      joined = false;
      attempt = 0;
      join();
      heartbeat = setInterval(() => {
        sendRaw({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: nextRef() });
      }, HEARTBEAT_MS);
    };

    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      if (msg.event === 'phx_reply') {
        if (msg.topic === channelTopic) {
          const status = msg.payload?.status;
          if (status === 'ok') {
            joined = true;
            onStatus('online');
          } else if (status === 'error') {
            onStatus('error');
          }
        }
        return;
      }

      // 其余的（排除系统事件）都是房间里的广播
      if (!joined) return;
      if (msg.event === 'system' || msg.event === 'presence_state' ||
          msg.event === 'presence_diff' || msg.event === 'phx_close' ||
          msg.event === 'phx_error') return;

      onData(msg.payload);
    };

    ws.onerror = () => { /* onclose 会接手 */ };

    ws.onclose = () => {
      clearInterval(heartbeat);
      heartbeat = null;
      joined = false;
      if (closedByUser) return;
      onStatus('reconnecting');
      attempt += 1;
      const delay = Math.min(15000, 800 * 2 ** Math.min(attempt, 4));
      reconnectTimer = setTimeout(connect, delay);
    };
  }

  connect();

  return {
    send(obj) {
      if (!joined) return;
      sendRaw({
        topic: channelTopic,
        event: 'broadcast',
        payload: { type: 'broadcast', event: 'msg', payload: obj },
        ref: nextRef(),
      });
    },
    close() {
      closedByUser = true;
      clearTimeout(reconnectTimer);
      clearInterval(heartbeat);
      if (joined) {
        sendRaw({ topic: channelTopic, event: 'phx_leave', payload: {}, ref: nextRef() });
      }
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
        peerId,
        onData: onMessage,
        onStatus,
      })
    : createLocalLink(topic, onMessage, onStatus);

  return {
    mode: useCloud ? NET_SUPABASE : NET_LOCAL,
    // 消息体里统一带上发送者信息，接收端不必依赖 presence
    send(payload) {
      link.send({ v: 1, ts: Date.now(), ...payload });
    },
    close() {
      link.close();
    },
  };
}
