// 赛道：给定种子，生成一条完全确定的障碍物序列（世界坐标）。
//
// 设计要点（这决定了多人比赛是否公平）：
//   1. 障碍物只由种子决定，与帧率、时间、玩家进度无关；
//   2. 速度只是「已行进距离」的纯函数，所以同一距离处永远是同一个速度；
//   3. 因此不同设备、不同帧率的玩家，在同一条赛道上遇到的是同一批障碍物。
//      —— 分数 = 距离 / 10，实质就是跑了多远，天然可比。

import { mulberry32, hashSeed } from './rng.js';

export const PLAYER_X = 44;
export const PLAYER_W = 12;
export const PLAYER_H = 14;
export const GROUND = 150;

export const BASE_SPEED = 110;   // px/s
export const MAX_SPEED = 250;
export const SPEED_GAIN = 0.042; // 每行进 1px 增加的速度

// 第一个障碍物出现在远处，留出起跑空间。
const FIRST_OBSTACLE_X = 620;
const GAP_MIN = 200;
const GAP_RANGE = 110;
const AHEAD = 760;   // 预生成到玩家前方多远的障碍物（必须 > FIRST_OBSTACLE_X）

const HEIGHTS = [
  { h: [14, 18], w: [9, 12] },   // 矮刺：随便跳
  { h: [20, 26], w: [9, 14] },   // 中刺：要跳够
  { h: [28, 34], w: [8, 11] },   // 高刺：跳得高才过
  { h: [12, 16], w: [16, 20] },  // 宽刺：跳得远才过
];

export function speedAt(dist) {
  return Math.min(MAX_SPEED, BASE_SPEED + dist * SPEED_GAIN);
}

export function scoreAt(dist) {
  return Math.floor(dist / 10);
}

// 一次跳跃的滞空距离，用来校验赛道可通过性。
export function jumpSpan(gravity, jumpV, speed) {
  return ((2 * Math.abs(jumpV)) / gravity) * speed;
}

export function createTrack(seed) {
  const rand = mulberry32(hashSeed(seed));
  const obstacles = [];
  let nextX = FIRST_OBSTACLE_X;

  const r = (min, max) => min + rand() * (max - min);

  function pushOne() {
    const kind = HEIGHTS[Math.floor(rand() * HEIGHTS.length)];
    const [hMin, hMax] = kind.h;
    const [wMin, wMax] = kind.w;
    const h = Math.round(r(hMin, hMax));
    const w = Math.round(r(wMin, wMax));
    obstacles.push({ worldX: Math.round(nextX), w, h });
    nextX += r(GAP_MIN, GAP_MIN + GAP_RANGE);
  }

  // 把障碍物补到 dist + AHEAD 之外。
  function ensure(dist) {
    const limit = dist + AHEAD;
    let guard = 0;
    while (nextX < limit && guard++ < 200) pushOne();
  }

  ensure(0);

  return {
    seed,
    obstacles,
    ensure,
    // 屏幕坐标（世界坐标 - 相机位置）
    screenX(o, dist) {
      return o.worldX - dist;
    },
  };
}
