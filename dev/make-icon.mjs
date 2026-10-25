/**
 * 生成 dsh-bot 插件图标（DeepSeek 鲸鱼 × Bot 融合版）
 *
 * 设计：
 *   · 深蓝渐变圆角方块（呼应 DeepSeek 品牌）
 *   · 白色 DeepSeek 鲸鱼剪影作为主体
 *   · 鲸鱼背部伸出 Bot 天线（点睛：既是鲸鱼也是机器人）
 *   · 鲸鱼头部有发光眼睛与微笑
 *   · 4x 超采样抗锯齿
 *
 * 同时输出 icon.svg（矢量，供仓库/GitHub 使用）
 */

import zlib from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';
import { parsePath, rasterize, composite } from './lib/svg-path.mjs';

const OUT_DIR = process.argv[2] || '.';
const SIZE = 256;
const SS = 4;
const W = SIZE * SS;
const H = SIZE * SS;

// DeepSeek 官方鲸鱼路径（来自 DSH 自带 favicon.svg）
const WHALE_D =
  'M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z';

// ============================================================
// 调色
// ============================================================

const BG_TOP = [0x4d, 0x6b, 0xfe];
const BG_BOTTOM = [0x1e, 0x33, 0xa8];
const WHITE = [255, 255, 255];
const DEEP = [0x14, 0x22, 0x6e]; // 眼睛/微笑：深蓝，在白色鲸鱼上清晰

// ============================================================
// 辅助绘制
// ============================================================

const canvas = new Uint8ClampedArray(W * H * 4);

function roundedRectSDF(px, py, x, y, w, hh, r) {
  const cx = x + w / 2;
  const cy = y + hh / 2;
  const dx = Math.abs(px - cx) - (w / 2 - r);
  const dy = Math.abs(py - cy) - (hh / 2 - r);
  const ax = Math.max(dx, 0);
  const ay = Math.max(dy, 0);
  return Math.sqrt(ax * ax + ay * ay) + Math.min(Math.max(dx, dy), 0) - r;
}

function coverage(d, aa = SS) {
  return Math.max(0, Math.min(1, 0.5 - d / aa));
}

function fillSDF(fn, color) {
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = coverage(fn(x + 0.5, y + 0.5));
      if (a <= 0) continue;
      const i = (y * W + x) * 4;
      const sa = a;
      const da = canvas[i + 3] / 255;
      const outA = sa + da * (1 - sa);
      if (outA === 0) continue;
      canvas[i] = (color[0] * sa + canvas[i] * da * (1 - sa)) / outA;
      canvas[i + 1] = (color[1] * sa + canvas[i + 1] * da * (1 - sa)) / outA;
      canvas[i + 2] = (color[2] * sa + canvas[i + 2] * da * (1 - sa)) / outA;
      canvas[i + 3] = outA * 255;
    }
  }
}

// ============================================================
// 1. 背景：圆角方块 + 对角渐变
// ============================================================

const PAD = 10 * SS;
const RADIUS = 58 * SS;
const bx = PAD;
const by = PAD;
const bw = W - PAD * 2;
const bh = H - PAD * 2;

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const d = roundedRectSDF(x + 0.5, y + 0.5, bx, by, bw, bh, RADIUS);
    const a = coverage(d);
    if (a <= 0) continue;
    const t = Math.max(0, Math.min(1, (x / W) * 0.3 + (y / H) * 0.7));
    const i = (y * W + x) * 4;
    canvas[i] = BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t;
    canvas[i + 1] = BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t;
    canvas[i + 2] = BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t;
    canvas[i + 3] = a * 255;
  }
}

// 顶部柔光
for (let y = 0; y < H * 0.45; y++) {
  for (let x = 0; x < W; x++) {
    const d = roundedRectSDF(x + 0.5, y + 0.5, bx, by, bw, bh, RADIUS);
    if (d > 0) continue;
    const t = 1 - y / (H * 0.45);
    const i = (y * W + x) * 4;
    const a = t * t * 0.09;
    canvas[i] = canvas[i] * (1 - a) + 255 * a;
    canvas[i + 1] = canvas[i + 1] * (1 - a) + 255 * a;
    canvas[i + 2] = canvas[i + 2] * (1 - a) + 255 * a;
  }
}

// ============================================================
// 2. 鲸鱼（白色剪影）
// ============================================================

// 50x50 viewBox → 画布。
// 略微下移，给顶部天线留空间。
const WHALE_W = 168 * SS;
const scale = WHALE_W / 50;
const whaleX = (W - WHALE_W) / 2 - 4 * SS;
const whaleY = 74 * SS;

const whaleAlpha = rasterize(
  parsePath(WHALE_D),
  W,
  H,
  (x, y) => ({ x: x * scale + whaleX, y: y * scale + whaleY }),
);
composite(canvas, whaleAlpha, W, H, WHITE);

// ============================================================
// 3. 天线（从鲸鱼背部伸出）
// ============================================================

// 鲸鱼背部最高点在 viewBox 约 (24, 12)；用同一变换映射到画布
const BACK_X = whaleX + 24 * scale;
const BACK_Y = whaleY + 13 * scale;
const ANT_TOP = BACK_Y - 30 * SS;

// 杆：从背部上沿一直延伸到顶端（下端嵌入鲸鱼内部，保证连接）
fillSDF((px, py) => {
  const y1 = Math.min(py, ANT_TOP);
  const y2 = Math.max(py, ANT_TOP);
  if (y2 < ANT_TOP || y1 > BACK_Y) return Math.hypot(px - BACK_X, py - ANT_TOP) - 3.2 * SS;
  const cy = Math.max(ANT_TOP, Math.min(BACK_Y, py));
  return Math.hypot(px - BACK_X, py - cy) - 3.2 * SS;
}, WHITE);
// 天线顶端圆点
fillSDF((px, py) => Math.hypot(px - BACK_X, py - ANT_TOP) - 8.5 * SS, WHITE);

// ============================================================
// 4. 眼睛与微笑（深蓝，镂在鲸鱼上）
// ============================================================

// 鲸鱼头部在左侧；头部中心 approx viewBox (20, 26)
const HEAD_CX = whaleX + 19 * scale;
const HEAD_CY = whaleY + 26 * scale;

const EYE_R = 5.6 * SS;
fillSDF(
  (px, py) => Math.min(
    Math.hypot(px - (HEAD_CX - 9 * SS), py - (HEAD_CY - 1 * SS)) - EYE_R,
    Math.hypot(px - (HEAD_CX + 9 * SS), py - (HEAD_CY - 1 * SS)) - EYE_R,
  ),
  DEEP,
);

// 微笑：二次贝塞尔（Y 轴向下的坐标系里，控制点更靠下 → 笑）
const M_X1 = HEAD_CX - 13 * SS;
const M_X2 = HEAD_CX + 13 * SS;
const M_Y_END = HEAD_CY + 8 * SS; // 两端（较高）
const M_Y_CTRL = HEAD_CY + 20 * SS; // 控制点（较低）

function quadSDF(px, py, x1, y1, cx2, cy2, x2, y2) {
  let best = Infinity;
  const N = 40;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const mt = 1 - t;
    const qx = mt * mt * x1 + 2 * mt * t * cx2 + t * t * x2;
    const qy = mt * mt * y1 + 2 * mt * t * cy2 + t * t * y2;
    const d = Math.hypot(px - qx, py - qy);
    if (d < best) best = d;
  }
  return best;
}

fillSDF(
  (px, py) => quadSDF(px, py, M_X1, M_Y_END, HEAD_CX, M_Y_CTRL, M_X2, M_Y_END) - 2.6 * SS,
  DEEP,
);

// ============================================================
// 5. 降采样 + 输出
// ============================================================

const out = Buffer.alloc(SIZE * SIZE * 4);
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    let a = 0;
    for (let sy = 0; sy < SS; sy++) {
      for (let sx = 0; sx < SS; sx++) {
        const i = ((y * SS + sy) * W + (x * SS + sx)) * 4;
        const aa = canvas[i + 3] / 255;
        r += canvas[i] * aa;
        g += canvas[i + 1] * aa;
        b += canvas[i + 2] * aa;
        a += aa;
      }
    }
    const n = SS * SS;
    const oi = (y * SIZE + x) * 4;
    if (a > 0) {
      out[oi] = r / a;
      out[oi + 1] = g / a;
      out[oi + 2] = b / a;
    }
    out[oi + 3] = (a / n) * 255;
  }
}

function crc32(buf) {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (const bb of buf) crc = table[(crc ^ bb) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
}

const raw = Buffer.alloc((SIZE * 4 + 1) * SIZE);
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0;
  out.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8;
ihdr[9] = 6;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'icon.png'), png);
console.log(`✔ icon.png  ${SIZE}x${SIZE}  ${png.length} bytes`);

// ---------- SVG 版 ----------
// 用同一套几何关系换算成 viewBox 0 0 256 256 的 SVG 坐标
const toSvg = (v) => (v / SS).toFixed(2);

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" width="256" height="256" role="img" aria-label="dsh-bot">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.3" y2="1">
      <stop offset="0" stop-color="#4D6BFE"/>
      <stop offset="1" stop-color="#1E33A8"/>
    </linearGradient>
  </defs>
  <rect x="${toSvg(bx)}" y="${toSvg(by)}" width="${toSvg(bw)}" height="${toSvg(bh)}" rx="${toSvg(RADIUS)}" fill="url(#bg)"/>
  <!-- DeepSeek 鲸鱼：用原始路径 + transform，保证真矢量、无锯齿 -->
  <g transform="translate(${toSvg(whaleX)} ${toSvg(whaleY)}) scale(${(scale / SS).toFixed(6)})">
    <path d="${WHALE_D}" fill="#fff" fill-rule="nonzero"/>
  </g>
  <g stroke="#fff" fill="none" stroke-linecap="round" stroke-width="3.4">
    <path d="M${toSvg(BACK_X)} ${toSvg(BACK_Y)}V${toSvg(ANT_TOP)}"/>
  </g>
  <circle cx="${toSvg(BACK_X)}" cy="${toSvg(ANT_TOP)}" r="8.5" fill="#fff"/>
  <circle cx="${toSvg(HEAD_CX - 9 * SS)}" cy="${toSvg(HEAD_CY - 1 * SS)}" r="${toSvg(EYE_R)}" fill="#14226E"/>
  <circle cx="${toSvg(HEAD_CX + 9 * SS)}" cy="${toSvg(HEAD_CY - 1 * SS)}" r="${toSvg(EYE_R)}" fill="#14226E"/>
  <path d="M${toSvg(M_X1)} ${toSvg(M_Y_END)}Q${toSvg(HEAD_CX)} ${toSvg(M_Y_CTRL)} ${toSvg(M_X2)} ${toSvg(M_Y_END)}"
        fill="none" stroke="#14226E" stroke-width="2.6" stroke-linecap="round"/>
</svg>
`;

fs.writeFileSync(path.join(OUT_DIR, 'icon.svg'), svg);
console.log(`✔ icon.svg  ${svg.length} bytes`);
