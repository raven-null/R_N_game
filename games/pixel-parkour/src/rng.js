// 确定性伪随机：同一种子 -> 同一串数字，用于让多人跑在同一条赛道上。

// FNV-1a：把房间码之类的字符串压成 32 位种子。
export function hashSeed(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// mulberry32：小而够用的 PRNG，返回 [0,1)。
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 生成给玩家看的房间码：去掉容易看错的 0/O/1/I。
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeRoomCode(len = 4) {
  const bytes = new Uint8Array(len);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < len; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

// 随机种子串（单机局用，或房主给整局定种子用）。
export function makeSeedString() {
  return `${Date.now().toString(36)}-${makeRoomCode(6)}`;
}

// 稳定 id：同一个浏览器窗口同一份即可，用于区分不同玩家。
export function makeId() {
  const bytes = new Uint8Array(8);
  if (globalThis.crypto?.getRandomValues) {
    globalThis.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
