// 像素跑酷引擎：物理 + 碰撞 + 渲染。只管自己这一份画面，不关心网络。

import {
  PLAYER_X, PLAYER_W, PLAYER_H, GROUND,
  createTrack, speedAt, scoreAt,
} from './track.js';

const W = 320;
const H = 180;

const GRAVITY = 1500;
const JUMP_V = -455;
const STEP = 1 / 120;          // 固定物理步长 -> 帧率无关
const MAX_FRAME_DT = 0.1;      // 切标签页回来防跳帧

const C = {
  skyTop: '#070b18',
  skyMid: '#0e1730',
  skyBot: '#1a2748',
  star: '#cfe3ff',
  moon: '#f6ecc8',
  moonDim: '#cbbd8c',
  hillFar: '#101a33',
  hillNear: '#16223f',
  ground: '#1b2743',
  groundTop: '#3d5c94',
  groundDot: '#283a5e',
  player: '#ffb86b',
  playerDim: '#e07a3c',
  eye: '#fff8ec',
  spike: '#4ade80',
  spikeDim: '#22a35c',
  text: '#dbe7ff',
  textDim: '#5f7295',
};

const FONT = {
  0: ['111', '101', '101', '101', '111'],
  1: ['010', '110', '010', '010', '111'],
  2: ['111', '001', '111', '100', '111'],
  3: ['111', '001', '111', '001', '111'],
  4: ['101', '101', '111', '001', '001'],
  5: ['111', '100', '111', '001', '111'],
  6: ['111', '100', '111', '101', '111'],
  7: ['111', '001', '001', '010', '010'],
  8: ['111', '101', '111', '101', '111'],
  9: ['111', '101', '111', '001', '111'],
};

export const READY = 'ready';
export const COUNTDOWN = 'countdown';
export const RUNNING = 'running';
export const DEAD = 'dead';
export const FINISHED = 'finished';

export function createGame(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.imageSmoothingEnabled = false;

  let state = READY;
  let track = createTrack('boot');
  let dist = 0;
  let score = 0;
  let speed = 0;
  let targetScore = 0;      // >0 表示跑够这么多分就算通关
  let groundOff = 0;
  let acc = 0;
  let lastT = 0;
  let deadAt = 0;
  let deathPulse = 0;
  let countdownUntil = 0;
  let lanes = null;   // 多人分跑道数据；null 或只有自己时用普通单机画面

  const player = { y: GROUND - PLAYER_H, vy: 0, onGround: true, tick: 0 };

  const listeners = { score: null, death: null, finish: null, countdown: null };

  // ---------- 背景装饰（纯视觉，不参与判定） ----------
  const stars = [];
  for (let i = 0; i < 46; i++) {
    stars.push({
      x: (Math.random() * W) | 0,
      y: ((Math.random() * 96) | 0) + 3,
      a: Math.random() * 0.55 + 0.2,
      tw: Math.random() * 6.283,
    });
  }
  const clouds = [];
  for (let i = 0; i < 4; i++) {
    clouds.push({
      x: Math.random() * W,
      y: 22 + Math.random() * 46,
      s: 0.1 + Math.random() * 0.12,
      w: 14 + ((Math.random() * 14) | 0),
    });
  }

  // ---------- 绘制小工具 ----------
  function rect(x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x | 0, y | 0, Math.max(1, w | 0), Math.max(1, h | 0));
  }

  let skyGrad = null;
  function sky() {
    if (!skyGrad) {
      skyGrad = ctx.createLinearGradient(0, 0, 0, GROUND);
      skyGrad.addColorStop(0, C.skyTop);
      skyGrad.addColorStop(0.55, C.skyMid);
      skyGrad.addColorStop(1, C.skyBot);
    }
    return skyGrad;
  }

  function drawDigits(str, x, y, color) {
    let cx = x;
    for (const ch of str) {
      const g = FONT[ch];
      if (g) {
        ctx.fillStyle = color;
        for (let r = 0; r < 5; r++) {
          for (let c = 0; c < 3; c++) {
            if (g[r][c] === '1') ctx.fillRect(cx + c, y + r, 1, 1);
          }
        }
      }
      cx += 4;
    }
  }

  // ---------- 场景 ----------
  function drawSky(t) {
    ctx.fillStyle = sky();
    ctx.fillRect(0, 0, W, GROUND);

    for (const s of stars) {
      ctx.globalAlpha = s.a * (0.62 + 0.38 * Math.sin(t * 0.0018 + s.tw));
      rect(s.x, s.y, 1, 1, C.star);
    }
    ctx.globalAlpha = 1;

    // 像素月亮
    const mx = 262, my = 28;
    rect(mx + 2, my, 8, 2, C.moon);
    rect(mx, my + 2, 12, 8, C.moon);
    rect(mx + 2, my + 10, 8, 2, C.moon);
    rect(mx + 8, my + 2, 4, 8, C.moonDim);
  }

  function drawHills() {
    const far = (dist * 0.1) % 64;
    for (let i = -1; i < W / 64 + 2; i++) {
      const bx = i * 64 - far;
      const h = 26 + (((i * 37) % 5) + 5) % 5 * 3;
      rect(bx, GROUND - h, 64, h, C.hillFar);
    }
    const near = (dist * 0.18) % 48;
    for (let i = -1; i < W / 48 + 2; i++) {
      const bx = i * 48 - near;
      const h = 14 + (((i * 53) % 4) + 4) % 4 * 3;
      rect(bx, GROUND - h, 48, h, C.hillNear);
    }
  }

  function drawClouds() {
    for (const c of clouds) {
      const x = c.x | 0, y = c.y | 0;
      rect(x, y, c.w, 4, 'rgba(190,215,255,.16)');
      rect(x + 4, y - 3, Math.max(2, c.w - 8), 3, 'rgba(190,215,255,.16)');
    }
  }

  function drawGround() {
    rect(0, GROUND, W, H - GROUND, C.ground);
    rect(0, GROUND, W, 2, C.groundTop);
    const off = groundOff % 16;
    for (let x = -off; x < W; x += 16) {
      rect(x, GROUND + 6, 7, 2, C.groundDot);
      rect(x + 8, GROUND + 13, 4, 2, C.groundDot);
    }
  }

  // 可复用的角色绘制：多人分跑道时要用不同颜色/位置画一堆角色
  function drawRunner(sx, sy, main, dim, onGround, tickVal, airborne) {
    sx = sx | 0; sy = sy | 0;
    rect(sx + 3, sy, 6, 2, main);
    rect(sx + 2, sy + 2, 8, 4, main);
    rect(sx + 2, sy + 6, 8, 4, dim);

    // 眼睛（朝向跑动方向）
    rect(sx + 4, sy + 3, 2, 2, C.eye);
    rect(sx + 8, sy + 3, 2, 2, C.eye);

    // 腿
    if (!onGround) {
      rect(sx + 3, sy + 10, 3, 4, dim);
      rect(sx + 7, sy + 10, 3, 3, dim);
    } else if ((tickVal | 0) % 2) {
      rect(sx + 2, sy + 10, 3, 4, dim);
      rect(sx + 7, sy + 10, 3, 4, dim);
    } else {
      rect(sx + 3, sy + 10, 3, 3, dim);
      rect(sx + 6, sy + 10, 3, 4, dim);
    }

    if (airborne) {
      rect(sx + 1, sy + 13, 2, 1, 'rgba(255,255,255,.18)');
    }
  }

  function drawPlayer() {
    drawRunner(
      PLAYER_X, player.y, C.player, C.playerDim,
      player.onGround, player.tick,
      !player.onGround && player.vy > 0
    );
  }

  // 障碍物绘制：按给定进度采样，groundY/scale 用于分跑道时压缩高度
  function drawSpikes(distValue, groundY, scale) {
    for (const o of track.obstacles) {
      const sx = o.worldX - distValue;
      if (sx > W + 20 || sx + o.w < -20) continue;
      const oh = Math.max(2, Math.round(o.h * scale));
      for (let r = 0; r < oh; r++) {
        const ratio = (r + 1) / oh;
        const half = Math.max(1, Math.round((ratio * o.w) / 2));
        rect(sx + (o.w / 2 - half), groundY - oh + r, half * 2, 1,
          r % 4 === 0 ? C.spikeDim : C.spike);
      }
    }
  }

  function drawObstacles() {
    drawSpikes(dist, GROUND, 1);
  }

  // ---------- 逻辑 ----------
  function emit(name, payload) {
    const fn = listeners[name];
    if (fn) fn(payload);
  }

  function resetWorld(seed) {
    track = createTrack(seed);
    dist = 0;
    speed = speedAt(0);
    score = 0;
    groundOff = 0;
    acc = 0;
    deathPulse = 0;
    player.y = GROUND - PLAYER_H;
    player.vy = 0;
    player.onGround = true;
    player.tick = 0;
  }

  function die() {
    if (state !== RUNNING) return;
    state = DEAD;
    deadAt = performance.now();
    deathPulse = 1;
    emit('death', { score, dist });
  }

  function step(dt) {
    if (state !== RUNNING) return;

    speed = speedAt(dist);
    dist += speed * dt;
    groundOff += speed * dt;
    track.ensure(dist);

    const next = scoreAt(dist);
    if (next !== score) {
      score = next;
      emit('score', score);
      if (targetScore > 0 && score >= targetScore) {
        state = FINISHED;
        emit('finish', { score, dist });
        return;
      }
    }

    // 重力
    player.vy += GRAVITY * dt;
    player.y += player.vy * dt;
    if (player.y + PLAYER_H >= GROUND) {
      player.y = GROUND - PLAYER_H;
      player.vy = 0;
      player.onGround = true;
    }
    player.tick += dt * (player.onGround ? 9 : 4);

    // 碰撞（内缩 2px，避免像素边缘误判）
    const px = PLAYER_X + 2;
    const pw = PLAYER_W - 4;
    const py = player.y + 2;
    const ph = PLAYER_H - 4;
    for (const o of track.obstacles) {
      const sx = o.worldX - dist;
      const oy = GROUND - o.h;
      if (px < sx + o.w - 2 && px + pw > sx + 2 && py < oy + o.h && py + ph > oy + 2) {
        die();
        return;
      }
    }
  }

  function update(dt) {
    for (const c of clouds) {
      c.x -= (6 + speed * 0.05) * dt;
      if (c.x < -c.w - 6) {
        c.x = W + 8;
        c.y = 22 + Math.random() * 46;
      }
    }
    acc += dt;
    let guard = 0;
    while (acc >= STEP && guard++ < 12) {
      step(STEP);
      acc -= STEP;
    }
    if (state !== RUNNING) {
      player.tick += dt * 4;
      if (deathPulse > 0) deathPulse = Math.max(0, deathPulse - dt * 2.2);
    }
  }

  // ---------- 对外 ----------
  // 把 #rrggbb 压暗，用于给其他玩家配一个"腿色"
  function darken(hex, f = 0.7) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return hex || '#6ea8ff';
    const v = parseInt(m[1], 16);
    const r = Math.round(((v >> 16) & 255) * f);
    const g = Math.round(((v >> 8) & 255) * f);
    const b = Math.round((v & 255) * f);
    return `rgb(${r},${g},${b})`;
  }

  function renderSolo(t) {
    drawSky(t);
    drawClouds();
    drawHills();
    drawObstacles();
    drawPlayer();
    drawGround();
    drawDigits(String(score).padStart(3, '0'), 7, 7, C.text);
  }

  // 多人：纵向切成若干条跑道，每人一条，各自独立滚动，能看到所有人在跳
  function renderLanes(t) {
    const n = lanes.length;
    const laneH = H / n;

    // 障碍物要按最靠前的玩家生成，否则领先者的前方是空的
    let maxDist = dist;
    for (const l of lanes) {
      if (typeof l.dist === 'number' && l.dist > maxDist) maxDist = l.dist;
    }
    track.ensure(maxDist);

    const baseY = GROUND - PLAYER_H;

    for (let i = 0; i < n; i++) {
      const lane = lanes[i];
      const top = Math.round(i * laneH);
      const laneBottom = Math.round((i + 1) * laneH);
      const groundY = laneBottom - 7;
      // 跑道变窄时把跳跃高度按比例压缩，保证角色不会画出界
      const scale = Math.min(1, Math.max(0.25, (laneH - 22) / 72));

      rect(0, top, W, laneH, i % 2 === 0 ? '#0a1024' : '#0e152c');

      // 地面
      rect(0, groundY, W, Math.max(1, laneBottom - groundY), C.ground);
      rect(0, groundY, W, 1, C.groundTop);

      // 障碍物（按该玩家自己的进度采样同一条确定性赛道）
      drawSpikes(typeof lane.dist === 'number' ? lane.dist : 0, groundY, scale);

      // 角色
      const laneY = typeof lane.y === 'number' ? lane.y : baseY;
      const lift = Math.max(0, baseY - laneY) * scale;
      const runnerY = groundY - PLAYER_H - lift;
      const airborne = lift > 0.6;

      const mainColor = lane.isMe ? C.player : (lane.color || '#6ea8ff');
      const dimColor = lane.isMe ? C.playerDim : darken(lane.color);

      // 出局的人画成半透明灰，但仍留在跑道上
      ctx.globalAlpha = lane.alive === false ? 0.26 : 1;
      drawRunner(
        PLAYER_X, runnerY,
        lane.alive === false ? '#8b9bb8' : mainColor,
        lane.alive === false ? '#5f6f8c' : dimColor,
        !airborne, (t * 0.009) | 0, airborne
      );
      ctx.globalAlpha = 1;

      // 自己的跑道加个框，一眼认出来
      if (lane.isMe) {
        ctx.strokeStyle = 'rgba(255,184,107,.55)';
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, top + 0.5, W - 1, laneH - 1);
      }

      // 分数贴在跑道右上角
      drawDigits(
        String(lane.score | 0).padStart(3, '0'),
        W - 20, top + 4,
        lane.isMe ? C.text : '#7d8db0'
      );
    }

    drawDigits(String(score).padStart(3, '0'), 7, 7, C.text);
  }

  const api = {
    get state() { return state; },
    get score() { return score; },
    get dist() { return dist; },
    get speed() { return speed; },
    get player() { return player; },
    get targetScore() { return targetScore; },
    on(name, fn) { listeners[name] = fn; return api; },

    // 单机开局
    start(seed) {
      targetScore = 0;
      resetWorld(seed);
      state = RUNNING;
      lastT = 0;
    },

    // 多人：目标分数 + 倒计时后自动开跑
    startRace({ seed, target = 0, countdownMs = 3000 }) {
      targetScore = target;
      resetWorld(seed);
      state = COUNTDOWN;
      countdownUntil = performance.now() + countdownMs;
      emit('countdown', Math.ceil(countdownMs / 1000));
      lastT = 0;
    },

    // 网络校正：别人先到终点/自己已死时强制结束
    kill() { die(); },
    // 传入多人跑道数据（含自己）。传 null 或单元素时回到普通单机画面。
    setLanes(v) {
      lanes = (Array.isArray(v) && v.length > 1) ? v : null;
    },
    setIdle(seed) {
      resetWorld(seed || 'idle');
      targetScore = 0;
      state = READY;
    },

    jump() {
      if (state === COUNTDOWN) return;
      if (state !== RUNNING) return;
      if (player.onGround) {
        player.vy = JUMP_V;
        player.onGround = false;
      }
    },

    frame(now) {
      if (!lastT) lastT = now;
      let dt = (now - lastT) / 1000;
      lastT = now;
      if (dt > MAX_FRAME_DT) dt = MAX_FRAME_DT;
      if (dt < 0) dt = 0;

      if (state === COUNTDOWN) {
        if (now >= countdownUntil) {
          state = RUNNING;
          emit('countdown', 0);
        }
      }

      update(dt);
      api.render(now);
    },

    render(t) {
      if (lanes && lanes.length > 1) {
        renderLanes(t);
      } else {
        renderSolo(t);
      }

      const left = Math.max(0, countdownUntil - performance.now());
      if (state === COUNTDOWN) {
        const s = String(Math.ceil(left / 1000));
        drawDigits(s, W / 2 - (s.length * 4) / 2, 62, '#ffe9a8');
      }

      if (deathPulse > 0) {
        ctx.globalAlpha = deathPulse * 0.35;
        ctx.fillStyle = '#ff4d6d';
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }
    },
  };

  api.setIdle();
  return api;
}

export { W as VIEW_W, H as VIEW_H };
