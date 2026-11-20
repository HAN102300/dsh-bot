/*
 * ⚠️ 本文件由 dev/concat-parts.mjs 自动拼接生成 —— 不要直接编辑！
 * 分片清单（按文件名字典序拼接，改完分片运行: node dev/concat-parts.mjs）:
 * - src/client/parts/00-head.js
 * - src/client/parts/10-tokens.js
 * - src/client/parts/20-icons.js
 * - src/client/parts/30-style.js
 * - src/client/parts/40-report.js
 * - src/client/parts/50-entry.js
 * - src/client/parts/60-forms.js
 * - src/client/parts/70-runmodal.js
 * - src/client/parts/80-sidebar-icon.js
 * - src/client/parts/85-dockbar.js
 * - src/client/parts/90-console.js
 * - src/client/parts/95-register.js
 */

/**
 * dsh-bot 面板 — 浏览器端
 *
 * ⚠️ 反复崩溃换来的约束（每条都有实际报错佐证）：
 *   1. 整个文件必须包在 IIFE 里 —— client.js 是经典脚本，顶层 const 会进入全局词法作用域；
 *      宿主重复加载时（同一 rev 重试、新旧 rev 并存、热挂载）第二次会抛
 *      "Identifier 'BG_BASE' has already been declared"，整个 web boot 降级失败。
 *   2. id 必须是 package.json 的包名（@zifeng1023/dsh-bot）—— 否则宿主动态解析不到模块。
 *   3. 产物必须是 lib/client.js —— 否则 import failed
 *   4. 用到 ctx.slots 必须在 inject 声明 'slots' —— 否则 entry did not activate
 *   5. apply 与组件都要 try/catch —— 否则拖垮整个 web boot
 *
 * 🎨 样式规范全部来自 DSH 自己的 CSS（不是猜的）：
 *    · 按钮: height 28px / padding 0 10px / radius-sm
 *    · 主按钮文字色必须用 --dsw-alias-label-primary-foreground
 *      （之前写死 #fff，在浅色主题下会白底白字，看不出按钮）
 *    · 卡片: bg-layer-2 + border-l1 + radius-lg
 *    · 过渡: .15s ease
 */
(function () {
  'use strict';

  // 构建时由 tsdown 替换为 package.json.version（见 tsdown.config.ts）
  const BOT_BUILD = '__BOT_BUILD__';

// ============================================================
// 设计令牌
// ============================================================

const BG_BASE = 'var(--dsw-alias-bg-base)';
const BG_L1 = 'var(--dsw-alias-bg-layer-1)';
const BG_L2 = 'var(--dsw-alias-bg-layer-2)';
const BG_L3 = 'var(--dsw-alias-bg-layer-3)';

const BORDER_L1 = 'var(--dsw-alias-border-l1)';
const BORDER_L2 = 'var(--dsw-alias-border-l2)';

const LABEL_1 = 'var(--dsw-alias-label-primary)';
const LABEL_2 = 'var(--dsw-alias-label-secondary)';
const LABEL_3 = 'var(--dsw-alias-label-tertiary)';
const LABEL_FG = 'var(--dsw-alias-label-primary-foreground)';

const BRAND = 'var(--dsw-alias-brand-primary)';
const BTN_PRIMARY = 'var(--dsw-alias-button-primary-fill)';
const BTN_PRIMARY_HOVER = 'var(--dsw-alias-button-primary-hover)';
const BTN_TOOLBAR_HOVER = 'var(--dsw-alias-button-tool-bar-hover)';
const HOVER_BG = 'var(--dsw-alias-interactive-bg-hover)';
const ACTIVE_BG = 'var(--dsw-alias-interactive-bg-active)';
const HOVER_DANGER = 'var(--dsw-alias-interactive-bg-hover-danger)';

const OK = 'var(--dsw-alias-state-success-primary)';
const WARN = 'var(--dsw-alias-state-warn-primary)';
const ERR = 'var(--dsw-alias-state-error-primary)';
const OK_TER = 'var(--dsw-alias-state-success-tertiary)';
const WARN_TER = 'var(--dsw-alias-state-warn-tertiary)';

const R_XS = 'var(--dsw-radius-xs)';
const R_SM = 'var(--dsw-radius-sm)';
const R_MD = 'var(--dsw-radius-md)';
const R_LG = 'var(--dsw-radius-lg)';

const FONT = 'var(--dsw-font-family)';
const SHADOW = 'var(--dsw-shadow-lv3)';
const FOCUS = 'var(--dsw-focus-ring-color)';

// ============================================================
// 执行节奏预设
//
// 用选择器而不是自由文本：自然语言识别总有猜不中的时候，
// 而"猜不中"的表现是静默失效——用户以为设好了，
// 其实 Bot 永远不会自己跑。
// ============================================================

const CADENCE_PRESETS = [
  { label: '每 30 分钟', value: '*/30 * * * *' },
  { label: '每小时', value: '0 * * * *' },
  { label: '每 4 小时', value: '0 */4 * * *' },
  { label: '每 6 小时', value: '0 */6 * * *' },
  { label: '每 12 小时', value: '0 */12 * * *' },
  { label: '每天早上 9 点', value: '0 9 * * *' },
  { label: '每天晚上 20 点', value: '0 20 * * *' },
  { label: '自定义时间', value: 'custom' },
];

/** 把 HH:MM 转成 cron */
function timeToCron(hhmm) {
  const m = String(hhmm).match(/^(\d{1,2})\s*[:：]\s*(\d{1,2})$/);
  if (!m) return undefined;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return undefined;
  return `${min} ${h} * * *`;
}

// ============================================================
// React 句柄
//
// 图标组件在模块顶层就定义，需要 h();
// 但 react 只能在 factory 里 require。
// 所以这里先占位，factory 执行时再赋值。
// ============================================================

let React = null;
let h = null;

// ============================================================
// 图标（内联 SVG，不用 emoji）
// ============================================================

/**
 * 品牌图标：DeepSeek 鲸鱼 + Bot 天线
 *
 * 与 icon.svg 同源：鲸鱼轮廓取自 DeepSeek 官方 favicon，
 * 加上天线 / 眼睛 / 微笑，成为「鲸鱼机器人」。
 * currentColor 让它跟随主题文字色。
 */
const WHALE_PATH =
  'M48.8354 10.0479C48.3232 9.79199 48.1025 10.2798 47.8032 10.5278C47.7007 10.6079 47.6143 10.7119 47.5273 10.8076C46.7793 11.624 45.9048 12.1597 44.7622 12.0957C43.0923 12 41.666 12.5356 40.4058 13.8398C40.1377 12.2319 39.2476 11.272 37.8926 10.6558C37.1836 10.3359 36.4668 10.0156 35.9702 9.31982C35.6235 8.82373 35.5293 8.27197 35.356 7.72754C35.2456 7.3999 35.1353 7.06396 34.7651 7.00781C34.3633 6.94385 34.2056 7.2876 34.0479 7.57568C33.418 8.75195 33.1733 10.0479 33.1973 11.3599C33.2524 14.312 34.4736 16.6641 36.8999 18.3359C37.1758 18.5278 37.2466 18.7197 37.1597 19C36.9946 19.5757 36.7974 20.1357 36.624 20.7119C36.5137 21.0801 36.3486 21.1597 35.9624 21C34.6309 20.4321 33.481 19.5918 32.4644 18.5757C30.7393 16.8721 29.1792 14.9917 27.2334 13.52C26.7764 13.1758 26.3193 12.856 25.8467 12.5518C23.8618 10.584 26.1069 8.96777 26.627 8.77588C27.1704 8.57568 26.8159 7.8877 25.0591 7.896C23.3022 7.90381 21.6953 8.50391 19.647 9.30371C19.3477 9.42383 19.0322 9.51172 18.7095 9.58398C16.8501 9.22363 14.9199 9.14355 12.9033 9.37598C9.10596 9.80762 6.07275 11.6396 3.84326 14.7681C1.16455 18.5278 0.53418 22.7998 1.30664 27.2559C2.11768 31.9521 4.46582 35.8398 8.07373 38.8799C11.8159 42.0322 16.1255 43.5762 21.041 43.2803C24.0269 43.104 27.3516 42.6963 31.1016 39.4561C32.0469 39.936 33.0396 40.1279 34.686 40.272C35.9546 40.3921 37.1758 40.208 38.1211 40.0078C39.6021 39.688 39.4995 38.2881 38.9639 38.0322C34.623 35.9678 35.5762 36.8081 34.71 36.1279C36.9155 33.4639 40.2402 30.6958 41.54 21.728C41.6426 21.0161 41.5557 20.5679 41.54 19.9917C41.5322 19.6396 41.6108 19.5039 42.0049 19.4639C43.0923 19.3359 44.1479 19.0317 45.1167 18.4878C47.9292 16.9199 49.064 14.3438 49.3315 11.2559C49.3711 10.7837 49.3237 10.2959 48.8354 10.0479ZM24.3262 37.8398C20.1196 34.4639 18.0791 33.3521 17.2358 33.3999C16.4482 33.4482 16.5898 34.3682 16.7632 34.9678C16.9443 35.5601 17.1812 35.9683 17.5117 36.4878C17.7402 36.832 17.8979 37.3442 17.2832 37.728C15.9282 38.584 13.5728 37.4399 13.4624 37.3838C10.7207 35.7358 8.42822 33.5601 6.81348 30.584C5.25342 27.7197 4.34766 24.6479 4.19775 21.3677C4.1582 20.5757 4.38672 20.2959 5.15869 20.1519C6.17529 19.96 7.22314 19.9199 8.23926 20.0718C12.5327 20.7119 16.1885 22.6719 19.2529 25.7759C21.002 27.5439 22.3252 29.6558 23.6885 31.7202C25.1377 33.9121 26.6978 36 28.6831 37.7119C29.3843 38.312 29.9434 38.7681 30.479 39.104C28.8643 39.2881 26.1699 39.3281 24.3262 37.8398ZM26.3433 24.6001C26.3433 24.248 26.6191 23.9678 26.9658 23.9678C27.0444 23.9678 27.1152 23.9839 27.1782 24.0078C27.2651 24.04 27.3438 24.0879 27.4067 24.1602C27.5171 24.272 27.5801 24.4321 27.5801 24.6001C27.5801 24.9521 27.3042 25.2319 26.9575 25.2319C26.6108 25.2319 26.3433 24.9521 26.3433 24.6001ZM32.6064 27.8799C32.2046 28.0479 31.8027 28.1919 31.4165 28.208C30.8179 28.2397 30.1641 27.9922 29.8096 27.688C29.2583 27.2158 28.8643 26.9521 28.6987 26.1279C28.6279 25.7759 28.6675 25.2319 28.7305 24.9199C28.8721 24.248 28.7144 23.8159 28.2495 23.4238C27.8716 23.104 27.3911 23.0161 26.8633 23.0161C26.666 23.0161 26.4849 22.9277 26.3511 22.856C26.1304 22.7441 25.9492 22.4639 26.1226 22.1201C26.1777 22.0078 26.4458 21.7358 26.5088 21.688C27.2256 21.272 28.0527 21.4077 28.8169 21.7197C29.5259 22.0161 30.0615 22.5601 30.834 23.3281C31.6216 24.2559 31.7632 24.5117 32.2124 25.208C32.5669 25.752 32.8901 26.312 33.1104 26.9521C33.2446 27.3521 33.0713 27.6802 32.6064 27.8799Z';

function IconBot({ size = 16, color }) {
  const c = color || 'currentColor';
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 50 56',
      fill: 'none',
      style: { display: 'block', flexShrink: 0 },
      'aria-hidden': 'true',
    },
    // 天线（从鲸鱼背部伸出）
    h('path', {
      d: 'M24 12V4',
      stroke: c,
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      fill: 'none',
    }),
    h('circle', { cx: 24, cy: 3.4, r: 2.6, fill: c }),
    // 鲸鱼主体
    h('path', {
      d: WHALE_PATH,
      fill: c,
      fillRule: 'nonzero',
      transform: 'translate(0 4)',
    }),
  );
}

/** 播放/演习：三角形 + 虚线方框 */
function IconDryRun({ size = 14 }) {
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      style: { display: 'block' },
      'aria-hidden': 'true',
    },
    h('rect', {
      x: 2.2,
      y: 3.2,
      width: 19.6,
      height: 17.6,
      rx: 3,
      stroke: 'currentColor',
      strokeWidth: 1.6,
      strokeDasharray: '3 2.5',
    }),
    h('path', {
      d: 'M10 8.6l5.4 3.4L10 15.4z',
      fill: 'currentColor',
    }),
  );
}

/** 执行：实心闪电 */
function IconRun({ size = 14 }) {
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      style: { display: 'block' },
      'aria-hidden': 'true',
    },
    h('path', {
      d: 'M13.2 2L4.8 13.2h5.4l-1.4 8.8L19.2 10h-5.4z',
      fill: 'currentColor',
    }),
  );
}

/** 详情/展开：chevron */
function IconChevron({ size = 14, open }) {
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      style: {
        display: 'block',
        transition: 'transform .18s ease',
        transform: open ? 'rotate(90deg)' : 'none',
      },
      'aria-hidden': 'true',
    },
    h('path', {
      d: 'M9 5l7 7-7 7',
      stroke: 'currentColor',
      strokeWidth: 2,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      fill: 'none',
    }),
  );
}

/** 快照：相机 */
function IconSnapshot({ size = 14 }) {
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      style: { display: 'block' },
      'aria-hidden': 'true',
    },
    h('path', {
      d: 'M4 7.5h3l1.4-2h7.2L17 7.5h3a1.5 1.5 0 011.5 1.5v8a1.5 1.5 0 01-1.5 1.5H4A1.5 1.5 0 012.5 17V9A1.5 1.5 0 014 7.5z',
      stroke: 'currentColor',
      strokeWidth: 1.6,
      strokeLinejoin: 'round',
    }),
    h('circle', {
      cx: 12,
      cy: 12.8,
      r: 3.2,
      stroke: 'currentColor',
      strokeWidth: 1.6,
    }),
  );
}

/** 回滚：逆时针箭头 */
function IconRollback({ size = 14 }) {
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      style: { display: 'block' },
      'aria-hidden': 'true',
    },
    h('path', {
      d: 'M4.5 12a7.5 7.5 0 1 1 2.2 5.3',
      stroke: 'currentColor',
      strokeWidth: 1.7,
      strokeLinecap: 'round',
      fill: 'none',
    }),
    h('path', {
      d: 'M3.6 7.2l1 5 5-1',
      stroke: 'currentColor',
      strokeWidth: 1.7,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      fill: 'none',
    }),
  );
}

/** 刷新 */
function IconRefresh({ size = 14, spinning }) {
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      style: {
        display: 'block',
        transition: 'transform .2s ease',
        animation: spinning ? 'dshbot-spin 1s linear infinite' : 'none',
      },
      'aria-hidden': 'true',
    },
    h('path', {
      d: 'M20 12a8 8 0 1 1-2.3-5.6',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      fill: 'none',
    }),
    h('path', {
      d: 'M20.4 3.6v4.8h-4.8',
      stroke: 'currentColor',
      strokeWidth: 1.8,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      fill: 'none',
    }),
  );
}

/** 收起 */
function IconCollapse({ size = 14 }) {
  return h(
    'svg',
    {
      width: size,
      height: size,
      viewBox: '0 0 24 24',
      fill: 'none',
      style: { display: 'block' },
      'aria-hidden': 'true',
    },
    h('path', {
      d: 'M6 14l6-6 6 6',
      stroke: 'currentColor',
      strokeWidth: 1.9,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      fill: 'none',
    }),
  );
}

// ============================================================
// 样式注入（一次性）
// ============================================================

const NS = 'dsh-bot';
let styleInjected = false;

function injectStyle() {
  if (styleInjected) return;
  styleInjected = true;
  // ⚠️ 先移除本插件此前注入的样式标签。
  //    热重载 / 升级后页面里可能同时存在多份：新版只覆盖它写到的属性，
  //    旧版独有的属性（例如旧 toast 的 bottom:140px）会继续生效并叠加出新形状。
  try {
    for (const old of Array.from(document.querySelectorAll('style[data-plugin="' + NS + '"]'))) {
      old.remove();
    }
  } catch {
    /* 清理失败不影响注入 */
  }
  const el = document.createElement('style');
  el.setAttribute('data-plugin', NS);
  el.textContent = `
@keyframes dshbot-spin { to { transform: rotate(360deg); } }
.${NS}-fade { animation: dshbot-fade .18s ease; }
@keyframes dshbot-fade { from { opacity: 0; transform: translateY(-3px); } to { opacity: 1; transform: none; } }

/* ⭐ 外层宽度约束 —— 与官方 input.dock 插件一致。
   没有这段，面板会撑满整行，比输入框宽很多，极其不协调。
   变量由 DSH 运行时注入，默认值兜底。 */
.${NS}-dock {
  box-sizing: border-box;
  width: calc(
    100%
    - var(--dsh-composer-side-clearance, 0px)
    - var(--dsh-composer-side-clearance, 0px)
    - var(--dsh-composer-dock-inset, 0px) * 4
  );
  margin: 0 auto 8px;
}
.${NS}-dock-inner {
  box-sizing: border-box;
  width: 100%;
  max-width: calc(
    var(--dsh-composer-card-max-width, 748px)
    - var(--dsh-composer-dock-inset, 0px) * 4
  );
  margin: 0 auto;
}

/* ⭐ 展开态的高度约束 + 滚动
   没有这段，详情区会把面板一路撑高，超出可视区域后
   下面的内容（模型、花费、按钮）根本够不着。

   结构：头部固定 → 中部滚动 → 底部固定
   这是唯一能同时满足"内容很多"和"不溢出窗口"的布局。 */
.${NS}-dock-inner.${NS}-expanded {
  display: flex;
  flex-direction: column;
  /* 上限：窗口高度的一半多一点，保证下方的对话框仍然可见 */
  max-height: min(520px, calc(100vh - 220px));
  overflow: hidden;
}

/* 可滚动主体 */
.${NS}-scroll {
  flex: 1 1 auto;
  min-height: 0;            /* ⭐ flex 子项能收缩的前提，缺了它就不滚 */
  overflow-y: auto;
  overscroll-behavior: contain;   /* 滚到底不带动外层页面 */
}

/* 细滚动条，跟随主题 */
.${NS}-scroll::-webkit-scrollbar { width: 8px; }
.${NS}-scroll::-webkit-scrollbar-track { background: transparent; }
.${NS}-scroll::-webkit-scrollbar-thumb {
  background: var(--dsw-alias-border-l2);
  border-radius: 999px;
  border: 2px solid transparent;
  background-clip: content-box;
}
.${NS}-scroll::-webkit-scrollbar-thumb:hover {
  background: var(--dsw-alias-label-tertiary);
  background-clip: content-box;
}
.${NS}-btn {
  font-family: ${FONT};
  font-size: 12px;
  line-height: 18px;
  height: 28px;
  padding: 0 10px;
  border-radius: ${R_SM};
  border: 1px solid transparent;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease, color .15s ease, opacity .15s ease;
  box-sizing: border-box;
  white-space: nowrap;
}
.${NS}-btn:disabled { opacity: .45; cursor: not-allowed; }
.${NS}-btn:focus-visible {
  outline: 2px solid ${FOCUS};
  outline-offset: 1px;
}
.${NS}-btn-primary {
  background: ${BTN_PRIMARY};
  color: ${LABEL_FG};
}
.${NS}-btn-primary:hover:not(:disabled) { background: ${BTN_PRIMARY_HOVER}; }
.${NS}-btn-ghost {
  background: transparent;
  border-color: ${BORDER_L2};
  color: ${LABEL_1};
}
.${NS}-btn-ghost:hover:not(:disabled) { background: ${BTN_TOOLBAR_HOVER}; }
.${NS}-btn-danger {
  background: transparent;
  border-color: transparent;
  color: ${ERR};
}
.${NS}-btn-danger:hover:not(:disabled) { background: ${HOVER_DANGER}; }
.${NS}-row-btn {
  background: transparent;
  border: none;
  color: ${LABEL_2};
  padding: 4px 7px;
  border-radius: ${R_XS};
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: ${FONT};
  font-size: 12px;
  transition: background .15s ease, color .15s ease;
}
.${NS}-row-btn:hover { background: ${HOVER_BG}; color: ${LABEL_1}; }
.${NS}-row-btn:focus-visible { outline: 2px solid ${FOCUS}; outline-offset: 1px; }

/* ============================================================
   v0.3.8 控制台（主页面 / 详情页）
   —— 全部颜色走宿主 settings-card 令牌；字号下限 11px。
   ============================================================ */
.${NS}-c,
.${NS}-c-vars {
  --c-card: var(--dsw-alias-settings-card-fill, var(--dsw-alias-bg-layer-1));
  --c-stroke: var(--dsw-alias-settings-card-stroke, var(--dsw-alias-border-l1));
  --c-l1: var(--dsw-alias-label-primary);
  --c-l2: var(--dsw-alias-label-secondary);
  --c-l3: var(--dsw-alias-label-tertiary);
  --c-l4: var(--dsw-alias-label-dimmed, var(--dsw-alias-label-tertiary));
  --c-brand: var(--dsw-alias-brand-primary);
  --c-brand-text: var(--dsw-alias-brand-text, var(--dsw-alias-brand-primary));
  --c-ok: var(--dsw-alias-state-success-primary);
  --c-warn: var(--dsw-alias-state-warn-primary);
  --c-err: var(--dsw-alias-state-error-primary);
  --c-l2b: var(--dsw-alias-border-l2);
  --c-l3b: var(--dsw-alias-border-l3, var(--dsw-alias-border-l2));
  --c-hover: var(--dsw-alias-interactive-bg-hover);
  --c-layer3: var(--dsw-alias-bg-layer-3);
  --c-r-lg: var(--dsw-radius-lg, 12px);
  --c-r-md: var(--dsw-radius-md, 8px);
  --c-r-sm: var(--dsw-radius-sm, 6px);
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  color: var(--c-l1);
  font-family: var(--dsw-font-family);
  font-size: 13px;
  line-height: 20px;
}
.${NS}-c *, .${NS}-c *::before, .${NS}-c *::after { box-sizing: border-box; }
.${NS}-c .num { font-variant-numeric: tabular-nums; }

/* 页面滚动容器 */
.${NS}-c-page {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: calc(28px + var(--dsh-frame-top-clearance, 0px)) clamp(16px, 2vw, 24px) 40px;
}
.${NS}-c-content { width: 100%; max-width: 1120px; margin: 0 auto; }

/* 滚动条 */
.${NS}-c-page::-webkit-scrollbar,
.${NS}-c-pane::-webkit-scrollbar,
.${NS}-c-rail-rows::-webkit-scrollbar,
.${NS}-c-scroll::-webkit-scrollbar { width: 10px; }
.${NS}-c-page::-webkit-scrollbar-thumb,
.${NS}-c-pane::-webkit-scrollbar-thumb,
.${NS}-c-rail-rows::-webkit-scrollbar-thumb,
.${NS}-c-scroll::-webkit-scrollbar-thumb {
  background: var(--c-l2b);
  border-radius: 999px;
  border: 3px solid transparent;
  background-clip: content-box;
}
.${NS}-c-page::-webkit-scrollbar-thumb:hover,
.${NS}-c-pane::-webkit-scrollbar-thumb:hover,
.${NS}-c-rail-rows::-webkit-scrollbar-thumb:hover { background-color: var(--c-l3); background-clip: content-box; }

/* 页头 */
.${NS}-c-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.${NS}-c-head-left { display: flex; align-items: center; gap: 12px; min-width: 0; }
.${NS}-c-mark {
  width: 36px; height: 36px; border-radius: 10px; flex: none;
  display: grid; place-items: center;
  color: var(--c-brand);
  background: color-mix(in srgb, var(--c-brand) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--c-brand) 28%, transparent);
}
.${NS}-c-title { margin: 0; font-size: 20px; line-height: 1.4; font-weight: 600; color: var(--c-l1); }
.${NS}-c-sub { margin: 1px 0 0; font-size: 13px; line-height: 20px; color: var(--c-l3); }
.${NS}-c-head-actions { display: flex; align-items: center; gap: 8px; padding-top: 2px; flex: none; }

/* 按钮 */
.${NS}-c-btn {
  height: 32px; padding: 0 12px; border-radius: var(--c-r-md);
  border: 1px solid var(--c-l2b); background: transparent; color: var(--c-l1);
  font-family: inherit; font-size: 13px; line-height: 20px; font-weight: 500;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  cursor: pointer; white-space: nowrap;
}
.${NS}-c-btn:hover:not(:disabled) { background: var(--c-hover); }
.${NS}-c-btn:disabled { opacity: .45; cursor: not-allowed; }
.${NS}-c-btn:focus-visible { outline: 2px solid var(--dsw-focus-ring-color); outline-offset: 1px; }
.${NS}-c-btn.primary { background: var(--dsw-alias-button-primary-fill, var(--c-brand)); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, #1b1210); }
.${NS}-c-btn.primary:hover:not(:disabled) { background: var(--dsw-alias-button-primary-hover, var(--c-brand)); filter: brightness(1.05); }
.${NS}-c-btn.ghost { border-color: transparent; color: var(--c-l2); }
.${NS}-c-btn.ghost:hover:not(:disabled) { color: var(--c-l1); }
.${NS}-c-btn.sm { height: 26px; padding: 0 9px; font-size: 12px; line-height: 18px; border-radius: var(--c-r-sm); }
.${NS}-c-btn.icon { width: 28px; padding: 0; }
.${NS}-c-btn.danger { color: var(--c-err); border-color: color-mix(in srgb, var(--c-err) 38%, transparent); }
.${NS}-c-btn.danger:hover:not(:disabled) { background: color-mix(in srgb, var(--c-err) 10%, transparent); }

/* Tabs */
.${NS}-c-tabs { display: flex; align-items: center; gap: 24px; margin-top: 14px; border-bottom: 1px solid var(--c-stroke); }
.${NS}-c-tab {
  position: relative; padding: 0 0 10px; font-size: 13px; line-height: 20px;
  font-weight: 500; color: var(--c-l3); cursor: pointer; background: none; border: 0;
  font-family: inherit;
}
.${NS}-c-tab:hover { color: var(--c-l2); }
.${NS}-c-tab.on { color: var(--c-l1); }
.${NS}-c-tab.on::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: -1px;
  height: 2px; border-radius: 2px; background: var(--c-brand);
}
.${NS}-c-tabs .grow { flex: 1; }
.${NS}-c-tabs .meta { font-size: 12px; line-height: 18px; color: var(--c-l3); }

/* 数字条 */
.${NS}-c-stats {
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr));
  margin-top: 16px; border: 1px solid var(--c-stroke); background: var(--c-card);
  border-radius: var(--c-r-lg); overflow: hidden;
}
.${NS}-c-stat { padding: 14px 16px; border-left: 1px solid var(--c-stroke); min-width: 0; }
.${NS}-c-stat:first-child { border-left: 0; }
.${NS}-c-stat .k { font-size: 11px; line-height: 16px; font-weight: 500; color: var(--c-l3); }
.${NS}-c-stat .v {
  margin-top: 2px; font-size: 28px; line-height: 34px; font-weight: 600;
  letter-spacing: -0.02em; display: flex; align-items: baseline; gap: 4px; color: var(--c-l1);
}
.${NS}-c-stat .v small { font-size: 12px; line-height: 18px; font-weight: 400; color: var(--c-l3); letter-spacing: 0; }
.${NS}-c-stat .h { margin-top: 2px; font-size: 12px; line-height: 18px; color: var(--c-l3); }
.${NS}-c-stat .h b { color: var(--c-ok); font-weight: 500; }

/* 卡片 */
.${NS}-c-card {
  border: 1px solid var(--c-stroke); background: var(--c-card);
  border-radius: var(--c-r-lg); min-width: 0;
}
.${NS}-c-card + .${NS}-c-card { margin-top: 12px; }
.${NS}-c-card-head { display: flex; align-items: center; gap: 8px; padding: 14px 16px 0; }
.${NS}-c-card-title { font-size: 15px; line-height: 22px; font-weight: 600; color: var(--c-l1); }
.${NS}-c-card-count { font-size: 12px; line-height: 18px; color: var(--c-l3); }
.${NS}-c-card-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
.${NS}-c-card-body { padding: 10px 16px 16px; }
.${NS}-c-card-body.tight { padding: 8px 16px 12px; }

/* 主工作区 */
.${NS}-c-ws { display: grid; grid-template-columns: 296px minmax(0, 1fr); gap: 16px; margin-top: 16px; align-items: start; }

/* 左列表 */
.${NS}-c-rail { display: flex; flex-direction: column; min-height: 0; }
.${NS}-c-rail-head { display: flex; align-items: center; gap: 8px; padding: 12px 12px 8px; }
.${NS}-c-rail-head .t { font-size: 15px; line-height: 22px; font-weight: 600; }
.${NS}-c-rail-head .n { font-size: 12px; color: var(--c-l3); }
.${NS}-c-rail-head .r { margin-left: auto; }
.${NS}-c-rail-rows { padding: 0 8px 8px; }
.${NS}-c-rail-foot { display: flex; align-items: center; justify-content: space-between; padding: 10px 12px; border-top: 1px solid var(--c-stroke); }
.${NS}-c-rail-foot .lnk { font-size: 12px; }

.${NS}-c-row {
  position: relative; padding: 10px; border-radius: var(--c-r-md);
  display: flex; flex-direction: column; gap: 4px; cursor: pointer;
  background: transparent; border: 0; width: 100%; text-align: left; color: inherit;
  font-family: inherit;
}
.${NS}-c-row + .${NS}-c-row { margin-top: 2px; }
.${NS}-c-row:hover { background: var(--c-hover); }
.${NS}-c-row.on { background: var(--dsw-alias-bg-layer-2); }
.${NS}-c-row.on::before {
  content: ""; position: absolute; left: 0; top: 10px; bottom: 10px;
  width: 2px; border-radius: 2px; background: var(--c-brand);
}
.${NS}-c-row .l1 { display: flex; align-items: center; gap: 6px; min-width: 0; }
.${NS}-c-row .nm { font-size: 14px; line-height: 22px; font-weight: 500; color: var(--c-l1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${NS}-c-row .bdg { margin-left: auto; flex: none; }
.${NS}-c-row .rl { font-size: 13px; line-height: 20px; color: var(--c-l2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${NS}-c-row .gl { font-size: 12px; line-height: 18px; color: var(--c-l3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${NS}-c-row .gl b { color: var(--c-l2); font-weight: 400; }
.${NS}-c-row .mt { font-size: 12px; line-height: 18px; color: var(--c-l4); }
.${NS}-c-dot { width: 6px; height: 6px; border-radius: 999px; flex: none; }
.${NS}-c-dot.ok { background: var(--c-ok); }
.${NS}-c-dot.warn { background: var(--c-warn); }
.${NS}-c-dot.err { background: var(--c-err); }
.${NS}-c-dot.idle { background: var(--c-l4); }

/* 徽标 / 药丸 */
.${NS}-c-pill {
  display: inline-flex; align-items: center; gap: 4px;
  height: 20px; padding: 0 8px; border-radius: 999px;
  background: var(--c-layer3); color: var(--c-l2);
  font-size: 11px; line-height: 20px; font-weight: 500; white-space: nowrap;
}
.${NS}-c-pill.ok { background: color-mix(in srgb, var(--c-ok) 12%, transparent); color: var(--c-ok); }
.${NS}-c-pill.warn { background: color-mix(in srgb, var(--c-warn) 12%, transparent); color: var(--c-warn); }
.${NS}-c-pill.brand { background: color-mix(in srgb, var(--c-brand) 12%, transparent); color: var(--c-brand-text); }
.${NS}-c-pill.muted { background: var(--c-layer3); color: var(--c-l3); }
.${NS}-c-link { color: var(--c-brand-text); font-size: 13px; line-height: 20px; text-decoration: none; cursor: pointer; background: none; border: 0; font-family: inherit; padding: 0; }
.${NS}-c-link:hover { text-decoration: underline; }
.${NS}-c-link.sm { font-size: 12px; line-height: 18px; }

/* 详情头 */
.${NS}-c-dhead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 2px 2px 12px; }
.${NS}-c-dname { display: flex; align-items: center; gap: 8px; font-size: 18px; line-height: 24px; font-weight: 600; color: var(--c-l1); }
.${NS}-c-drole { margin-top: 3px; font-size: 13px; line-height: 20px; color: var(--c-l2); }
.${NS}-c-dactions { display: flex; align-items: center; gap: 8px; flex: none; }

/* 状态摘要 */
.${NS}-c-sit {
  display: flex; align-items: center; gap: 10px; padding: 12px 14px;
  border-radius: var(--c-r-md);
  border: 1px solid color-mix(in srgb, var(--c-ok) 24%, transparent);
  background: color-mix(in srgb, var(--c-ok) 7%, transparent);
}
.${NS}-c-sit.warn { border-color: color-mix(in srgb, var(--c-warn) 26%, transparent); background: color-mix(in srgb, var(--c-warn) 7%, transparent); }
.${NS}-c-sit.err { border-color: color-mix(in srgb, var(--c-err) 26%, transparent); background: color-mix(in srgb, var(--c-err) 7%, transparent); }
.${NS}-c-sit.brand { border-color: color-mix(in srgb, var(--c-brand) 26%, transparent); background: color-mix(in srgb, var(--c-brand) 7%, transparent); }
.${NS}-c-sit .tx { flex: 1; min-width: 0; }
.${NS}-c-sit .tx b { font-size: 14px; line-height: 22px; font-weight: 500; color: var(--c-l1); }
.${NS}-c-sit .tx span { display: block; margin-top: 1px; font-size: 12px; line-height: 18px; color: var(--c-l3); }

/* 目标 */
.${NS}-c-goal { font-size: 14px; line-height: 22px; color: var(--c-l1); }
.${NS}-c-meter { height: 6px; border-radius: 999px; background: var(--c-layer3); overflow: hidden; margin-top: 12px; }
.${NS}-c-meter i { display: block; height: 100%; border-radius: 999px; background: var(--c-brand); min-width: 3px; }
.${NS}-c-meter-meta { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; font-size: 12px; line-height: 18px; color: var(--c-l3); }
.${NS}-c-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
.${NS}-c-chip {
  display: inline-flex; align-items: center; gap: 4px;
  font-size: 11px; line-height: 18px; padding: 1px 8px; border-radius: 6px;
  background: var(--c-layer3); color: var(--c-l3);
}
.${NS}-c-chip b { font-weight: 500; color: var(--c-l2); }

/* 运行行 */
.${NS}-c-run {
  display: grid; grid-template-columns: 6px 40px minmax(0, 1fr) auto auto 12px;
  align-items: center; gap: 10px; padding: 9px 0;
  border-top: 1px solid var(--c-stroke);
  font-size: 12px; line-height: 18px; color: var(--c-l2);
}
.${NS}-c-run:first-of-type { border-top: 0; }
.${NS}-c-run .st { color: var(--c-l1); font-weight: 500; }
.${NS}-c-run .st.err { color: var(--c-err); }
.${NS}-c-run .wh { color: var(--c-l3); }
.${NS}-c-run .cs { color: var(--c-l2); }
.${NS}-c-run .id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--c-l4); }
.${NS}-c-run .cv { color: var(--c-l4); display: flex; }

/* 记忆 */
.${NS}-c-mem { display: flex; gap: 8px; padding: 10px 0; border-top: 1px solid var(--c-stroke); }
.${NS}-c-mem:first-of-type { border-top: 0; }
.${NS}-c-mem .kd { flex: none; margin-top: 1px; }
.${NS}-c-mem p { margin: 0; font-size: 13px; line-height: 20px; color: var(--c-l1); }
.${NS}-c-mem time { display: block; margin-top: 2px; font-size: 12px; line-height: 18px; color: var(--c-l3); }

/* 卡片底部说明块（通知卡的「只覆盖通知项」提示） */
.${NS}-c-hint-block {
  margin-top: 10px; padding-top: 10px;
  border-top: 0.5px solid var(--c-stroke);
  font-size: 11px; line-height: 16px; color: var(--c-l3);
}

/* 空态 */
.${NS}-c-empty { padding: 12px 14px; border-radius: var(--c-r-md); border: 1px dashed var(--c-l2b); background: color-mix(in srgb, var(--c-l1) 2%, transparent); }
.${NS}-c-empty p { margin: 0 0 10px; font-size: 13px; line-height: 20px; color: var(--c-l3); }

/* 键值 / 表单 */
.${NS}-c-kv {
  display: grid; grid-template-columns: 116px minmax(0, 1fr); gap: 12px;
  align-items: center; padding: 9px 0; border-top: 1px solid var(--c-stroke);
  font-size: 13px; line-height: 20px;
}
.${NS}-c-kv:first-of-type { border-top: 0; }
.${NS}-c-kv .k { font-size: 12px; color: var(--c-l3); }
.${NS}-c-kv .v { color: var(--c-l1); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${NS}-c-kv .v.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; color: var(--c-l2); }
.${NS}-c-form { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 14px; }
.${NS}-c-field { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
.${NS}-c-field.wide { grid-column: 1 / -1; }
.${NS}-c-field > label { font-size: 12px; line-height: 18px; color: var(--c-l3); }
.${NS}-c-input {
  height: 32px; padding: 0 10px; border-radius: var(--c-r-md);
  border: 1px solid var(--c-l2b); background: var(--dsw-alias-bg-layer-1);
  color: var(--c-l1); font-size: 13px; line-height: 30px; font-family: inherit;
  width: 100%; min-width: 0;
}
.${NS}-c-input:focus { outline: 2px solid var(--dsw-focus-ring-color); outline-offset: 0; border-color: transparent; }
textarea.${NS}-c-input { height: auto; padding: 8px 10px; line-height: 20px; resize: vertical; }
select.${NS}-c-input { appearance: auto; }
.${NS}-c-seg { display: inline-flex; border: 1px solid var(--c-l2b); border-radius: var(--c-r-md); overflow: hidden; width: max-content; max-width: 100%; }
.${NS}-c-seg button {
  height: 30px; padding: 0 12px; border: 0; border-left: 1px solid var(--c-l2b);
  background: transparent; color: var(--c-l3); font-size: 12px; font-family: inherit; cursor: pointer;
}
.${NS}-c-seg button:first-child { border-left: 0; }
.${NS}-c-seg button.on { background: var(--c-layer3); color: var(--c-l1); font-weight: 500; }
.${NS}-c-form-foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.${NS}-c-danger { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 12px; border-top: 1px solid var(--c-stroke); }
.${NS}-c-danger .lb { margin-right: auto; font-size: 11px; font-weight: 500; color: var(--c-l4); }

/* 详情页：双栏独立滚动 */
.${NS}-c-page.split { overflow: hidden; display: flex; flex-direction: column; padding-bottom: 0; }
.${NS}-c-page.split .${NS}-c-content { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
.${NS}-c-split {
  flex: 1 1 auto; min-height: 0; display: grid;
  grid-template-columns: 296px minmax(0, 1fr); gap: 16px; margin-top: 16px;
}
.${NS}-c-rail.fill { height: 100%; }
.${NS}-c-rail-rows.fill { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
.${NS}-c-pane { height: 100%; min-width: 0; overflow-y: auto; padding: 0 2px 24px 0; }
.${NS}-c-pane-head {
  position: sticky; top: 0; z-index: 3; margin: 0 0 12px; padding: 2px 0 10px;
  background: color-mix(in srgb, var(--dsw-alias-bg-base) 82%, transparent);
  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);
}
.${NS}-c-pane-head .row { display: flex; align-items: center; gap: 8px; }
.${NS}-c-back {
  height: 26px; padding: 0 9px; border-radius: var(--c-r-sm);
  border: 1px solid var(--c-l2b); background: transparent; color: var(--c-l2);
  font-size: 12px; font-family: inherit; display: inline-flex; align-items: center; gap: 4px;
  cursor: pointer; flex: none;
}
.${NS}-c-back:hover { background: var(--c-hover); color: var(--c-l1); }


/* 开关 / 设置行 */
.${NS}-c-switch {
  width: 38px; height: 22px; border-radius: 999px; border: 0; padding: 0;
  background: var(--c-layer3, var(--dsw-alias-bg-layer-3, rgba(255,255,255,.14))); position: relative; cursor: pointer; flex: none;
  transition: background .15s ease;
}
.${NS}-c-switch .knob {
  position: absolute; top: 3px; left: 3px; width: 16px; height: 16px;
  border-radius: 999px; background: var(--dsw-alias-switch-thumb, #ffffff);
  transition: left .15s ease;
}
.${NS}-c-switch.on { background: var(--c-brand, var(--dsw-alias-brand-primary, #e0745c)); }
.${NS}-c-switch.on .knob { left: 19px; }
.${NS}-c-switch:disabled { opacity: .45; cursor: not-allowed; }

.${NS}-c-setting { display: flex; align-items: center; gap: 16px; padding: 10px 0; border-top: 1px solid var(--c-stroke); }
.${NS}-c-setting:first-child { border-top: 0; }
.${NS}-c-setting-label { font-size: 13px; line-height: 20px; color: var(--c-l1); }
.${NS}-c-setting-hint { margin-top: 2px; font-size: 12px; line-height: 18px; color: var(--c-l3); }

/* 提示条 / toast */
.${NS}-c-alert {
  display: flex; align-items: flex-start; gap: 8px;
  padding: 10px 12px; border-radius: var(--c-r-md);
  font-size: 13px; line-height: 20px; border: 1px solid var(--c-stroke);
}
.${NS}-c-alert.err {
  color: var(--c-err);
  border-color: color-mix(in srgb, var(--c-err) 30%, transparent);
  background: color-mix(in srgb, var(--c-err) 8%, transparent);
}
.${NS}-c-alert.ok {
  color: var(--c-ok);
  border-color: color-mix(in srgb, var(--c-ok) 28%, transparent);
  background: color-mix(in srgb, var(--c-ok) 8%, transparent);
}
.${NS}-c-alert-x {
  background: none; border: 0; color: inherit; font-size: 16px; line-height: 1;
  cursor: pointer; padding: 0 2px; flex: none; opacity: .8; font-family: inherit;
}
.${NS}-c-alert-x:hover { opacity: 1; }
.${NS}-c-toast {
  position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
  z-index: 10001; min-width: 320px; max-width: min(680px, 90vw);
  box-shadow: var(--dsw-shadow-lv3, none); border-radius: var(--c-r-md);
}
.${NS}-c-toast .${NS}-c-alert { background: var(--dsw-alias-bg-layer-2); backdrop-filter: blur(10px); }

/* 弹窗 */
.${NS}-c-modal {
  position: fixed; inset: 0; z-index: 9999; padding: 20px;
  background: rgba(0, 0, 0, .45);
  display: flex; align-items: center; justify-content: center;
}
.${NS}-c-modal-card {
  width: min(640px, 94vw); max-height: 85vh; overflow: auto;
  background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--c-stroke); border-radius: var(--c-r-lg);
  box-shadow: var(--dsw-shadow-lv3, none); padding: 16px;
  color: var(--c-l1); font-family: var(--dsw-font-family);
}
.${NS}-c-modal-card * { font-family: inherit; }

/* 响应式：窄屏退化为单列 */
@media (max-width: 980px) {
  .${NS}-c-ws, .${NS}-c-split { grid-template-columns: minmax(0, 1fr); }
  .${NS}-c-split .${NS}-c-rail { display: none; }
  .${NS}-c-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .${NS}-c-stat:nth-child(3) { border-left: 0; }
  .${NS}-c-stat:nth-child(n+3) { border-top: 1px solid var(--c-stroke); }
}

  /* ---------- v0.3.9 dock 快捷条 ---------- */
  /* 结构：.dockbar（定位/边框/宽度上限）
           └ .dockbar-row（flex 一行，overflow:hidden —— 内容再多也绝不撑破）
           └ 弹层（row 的兄弟节点，可溢出到边框之外） */
  .${NS}-dockbar {
    position: relative; display: flex; align-items: center;
    box-sizing: border-box;
    width: 100%;
    max-width: calc(var(--dsh-composer-card-max-width, 748px) - var(--dsh-composer-dock-inset, 0px) * 4);
    margin: 4px auto 8px;
    min-height: 44px; padding: 0 8px;
    border: 1px solid var(--c-stroke, var(--dsw-alias-border-l2, rgba(255,255,255,.10)));
    border-radius: 12px;
    background: var(--c-card, var(--dsw-alias-settings-card-fill, rgba(255,255,255,.06)));
    font-family: ${FONT};
  }
  .${NS}-dockbar-wrap { display: block; }
  .${NS}-dockbar-row {
    display: flex; align-items: center; gap: 6px;
    flex: 1 1 auto; min-width: 0; overflow: hidden;
    height: 100%;
  }
  /* 主区：身份/状态/花费/模型 —— 空间不够时由它让步 */
  .${NS}-dockbar-main {
    display: flex; align-items: center; gap: 6px;
    flex: 1 1 auto; min-width: 0; overflow: hidden;
  }
  /* 操作区：执行 / 管理中心 / 收起 —— 永远完整可见，先饿死主区也不压它 */
  .${NS}-dockbar-actions {
    display: flex; align-items: center; gap: 6px;
    flex: 0 0 auto;
  }
  .${NS}-dockbar.${NS}-dockbar-collapsed {
    min-height: 36px; padding: 0 6px; border-radius: 999px;
  }

  /* 统一的可收缩语义：ghost 元素可缩，按钮不可缩 */
  .${NS}-db-chip, .${NS}-db-model, .${NS}-db-cost { flex: 0 1 auto; min-width: 0; overflow: hidden; }
  .${NS}-db-stat, .${NS}-db-btn { flex: 0 0 auto; }
  .${NS}-db-chip .nm, .${NS}-db-model .txt, .${NS}-db-cost .txt {
    display: block;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;
  }

  .${NS}-db-chip, .${NS}-db-model, .${NS}-db-btn {
    display: inline-flex; align-items: center; gap: 6px;
    border: none; background: transparent; color: var(--c-l1, var(--dsw-alias-label-primary, #ededf0));
    font-family: inherit; cursor: pointer; white-space: nowrap;
  }
  .${NS}-db-chip { min-width: 0; max-width: 210px; height: 30px; padding: 0 8px; border-radius: 8px; font-size: 12px; font-weight: 500; }
  .${NS}-db-chip:hover { background: var(--c-hover, var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.06))); }
  .${NS}-db-chip .mark { width: 16px; height: 16px; border-radius: 5px; background: rgba(224,116,92,.16); border: 0.5px solid rgba(224,116,92,.3); display: grid; place-items: center; color: var(--c-brand, var(--dsw-alias-brand-primary, #e0745c)); flex: none; }
  .${NS}-db-chip .chev { color: var(--c-l3, var(--dsw-alias-label-tertiary, #76777e)); flex: none; display: inline-flex; }
  .${NS}-db-iconbtn { flex: none; padding: 0 6px; color: var(--c-l3, var(--dsw-alias-label-tertiary, #76777e)); }
  .${NS}-db-iconbtn:hover { color: var(--c-l1, #ededf0); }

  .${NS}-db-stat {
    display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px;
    border-radius: 999px; border: 0.5px solid var(--c-stroke, var(--dsw-alias-border-l1, rgba(255,255,255,.06)));
    font-size: 11px; font-weight: 500; background: transparent; cursor: pointer; white-space: nowrap;
    font-family: inherit;
  }
  .${NS}-db-stat .dot { width: 7px; height: 7px; border-radius: 999px; background: var(--c-l3, #76777e); flex: none; }
  .${NS}-db-stat .stat-text { overflow: hidden; text-overflow: ellipsis; }
  .${NS}-db-stat-dotonly { padding: 0 7px; }
  .${NS}-db-stat.ok { color: var(--c-ok, var(--dsw-alias-state-success-primary, #6cc08b)); border-color: rgba(108,192,139,.25); }
  .${NS}-db-stat.ok .dot { background: var(--c-ok, #6cc08b); }
  .${NS}-db-stat.err { color: var(--c-err, var(--dsw-alias-state-error-primary, #e06c75)); border-color: rgba(224,108,117,.3); }
  .${NS}-db-stat.err .dot { background: var(--c-err, #e06c75); }
  .${NS}-db-stat.run { color: var(--c-brand-text, var(--dsw-alias-brand-text, #ec8d78)); border-color: rgba(224,116,92,.35); }
  .${NS}-db-stat.run .dot { background: var(--c-brand, #e0745c); animation: ${NS}-db-spin 1s linear infinite; }
  @keyframes ${NS}-db-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }

  .${NS}-db-cost { flex: 0 0 auto; font-size: 11px; color: var(--c-l2, var(--dsw-alias-label-secondary, #a8a9af)); padding: 0 4px; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .${NS}-db-cost .lim { color: var(--c-l3, var(--dsw-alias-label-tertiary, #76777e)); }
  .${NS}-db-cost b { color: var(--c-l1, var(--dsw-alias-label-primary, #ededf0)); font-weight: 500; }
  .${NS}-db-space { flex: 1 1 0; min-width: 2px; }

  .${NS}-db-btn { height: 30px; padding: 0 12px; border-radius: 8px; font-size: 12px; font-weight: 500; border: 1px solid var(--c-stroke, var(--dsw-alias-border-l2, rgba(255,255,255,.10))); }
  .${NS}-db-btn:hover { background: var(--c-hover, var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.06))); }
  .${NS}-db-btn.primary { background: var(--c-brand, var(--dsw-alias-brand-primary, #e0745c)); border-color: transparent; color: var(--dsw-alias-label-primary-foreground, #1b1210); }
  .${NS}-db-btn.primary:hover { filter: brightness(1.06); }
  .${NS}-db-btn.primary:disabled { opacity: .55; cursor: default; filter: none; }

  .${NS}-db-model { min-width: 96px; max-width: 220px; height: 24px; padding: 0 9px; border-radius: 999px; border: 0.5px solid var(--c-stroke, var(--dsw-alias-border-l1, rgba(255,255,255,.06))); font-size: 11px; font-weight: 500; color: var(--c-l2, var(--dsw-alias-label-secondary, #a8a9af)); }
  .${NS}-db-model:hover { color: var(--c-l1, #ededf0); background: var(--c-hover, rgba(255,255,255,.06)); }
  .${NS}-db-model svg { flex: none; opacity: .7; }
  .${NS}-db-model .sep { color: var(--c-l3, var(--dsw-alias-label-tertiary, #76777e)); }

  /* 弹层：head 固定 / list 滚动 / foot 固定 —— 永不顶出屏幕 */
  .${NS}-db-pop {
    position: absolute; bottom: calc(100% + 8px); z-index: 10020;
    width: 280px;
    max-height: min(360px, calc(100vh - 180px));
    display: flex; flex-direction: column;
    padding: 6px;
    border: 1px solid var(--c-stroke, var(--dsw-alias-border-l2, rgba(255,255,255,.10)));
    border-radius: 12px;
    background: var(--c-layer3, var(--dsw-alias-bg-layer-3, #242429));
    box-shadow: 0 12px 32px rgba(0,0,0,.45);
    color: var(--c-l1, var(--dsw-alias-label-primary, #ededf0));
    font-family: ${FONT};
    overflow: hidden;
  }
  .${NS}-db-pop.right { right: 0; }
  .${NS}-db-pop .head { flex: none; font-size: 11px; font-weight: 500; color: var(--c-l3, #76777e); padding: 6px 8px 6px; letter-spacing: .02em; }
  .${NS}-db-pop .list { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  .${NS}-db-pop .list::-webkit-scrollbar { width: 8px; }
  .${NS}-db-pop .list::-webkit-scrollbar-thumb { background: rgba(255,255,255,.16); border-radius: 8px; }
  .${NS}-db-pop .foot { flex: none; border-top: 1px solid var(--c-stroke, var(--dsw-alias-border-l1, rgba(255,255,255,.06))); margin-top: 4px; padding-top: 4px; display: flex; }
  .${NS}-db-pop .item {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 7px 8px; border: none; background: transparent; border-radius: 8px;
    cursor: pointer; text-align: left; color: inherit; font-family: inherit;
  }
  .${NS}-db-pop .item:hover { background: var(--c-hover, rgba(255,255,255,.06)); }
  .${NS}-db-pop .item.active { background: var(--c-hover, rgba(255,255,255,.08)); }
  .${NS}-db-pop .item .nm { font-size: 12px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1 1 auto; }
  .${NS}-db-pop .item .meta { flex: none; display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--c-l3, #76777e); white-space: nowrap; }
  .${NS}-db-pop .item .chev { flex: none; color: var(--c-l3, #76777e); display: inline-flex; }
  .${NS}-db-pop .item.back { color: var(--c-l3, #76777e); font-size: 11px; }
  .${NS}-db-pop .item .dot { width: 6px; height: 6px; border-radius: 999px; background: var(--c-l3, #76777e); flex: none; }
  .${NS}-db-pop .item .dot.g { background: var(--c-ok, #6cc08b); }
  .${NS}-db-pop .item .dot.r { background: var(--c-err, #e06c75); }
  .${NS}-db-pop .desc { font-size: 12px; line-height: 18px; color: var(--c-l2, var(--dsw-alias-label-secondary, #a8a9af)); padding: 8px; }
  .${NS}-db-pop .desc b { color: var(--c-l1, #ededf0); font-weight: 500; }
  .${NS}-db-pop .acts { flex: none; display: flex; gap: 8px; justify-content: flex-end; padding: 4px 6px 6px; }
  .${NS}-db-pop .foot .mi { flex: 1; display: flex; align-items: center; justify-content: center; gap: 6px; height: 30px; border: none; background: transparent; border-radius: 8px; font-size: 12px; color: var(--c-l2, var(--dsw-alias-label-secondary, #a8a9af)); cursor: pointer; font-family: inherit; }
  .${NS}-db-pop .foot .mi:hover { background: var(--c-hover, rgba(255,255,255,.06)); color: var(--c-l1, #ededf0); }
  .${NS}-db-pop .foot .mi + .mi { border-left: 1px solid var(--c-stroke, var(--dsw-alias-border-l1, rgba(255,255,255,.06))); }

  .${NS}-db-toast {
    /* 屏幕中央（用户：不要挡住 Bot 快捷条）；pointer-events:none 保证不截获点击 */
    position: fixed; top: 50%; left: 50%; bottom: auto; right: auto;
    transform: translate(-50%, -50%);
    height: auto; max-height: 60vh; overflow: hidden;
    margin: 0; box-sizing: border-box;
    padding: 8px 14px; border-radius: 10px; z-index: 10030;
    background: var(--c-layer3, var(--dsw-alias-bg-layer-3, #242429));
    border: 1px solid var(--c-stroke, rgba(255,255,255,.10));
    color: var(--c-l1, var(--dsw-alias-label-primary, #ededf0));
    font-size: 12px; box-shadow: 0 8px 24px rgba(0,0,0,.4);
    font-family: ${FONT};
    pointer-events: none;
    max-width: min(520px, 80vw);
    text-align: center; line-height: 18px;
  }
`;
  document.head.appendChild(el);
}

// ============================================================
// 状态上报
// ============================================================

function report(status, detail) {
  try {
    fetch('/_dsh-bot/client-status', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status, detail: detail ?? null, version: BOT_BUILD, at: new Date().toISOString() }),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

  /** 把用户可读的节奏转成 cron（只支持本面板提供的三种模式） */
  function buildCadence(mode, hours, time, days, custom) {
    if (mode === 'none') return '';
    if (mode === 'custom') return custom || '';
    const [hhRaw, mmRaw] = String(time || '09:00').split(':');
    const hh = Math.min(23, Math.max(0, Number(hhRaw) || 0));
    const mm = Math.min(59, Math.max(0, Number(mmRaw) || 0));
    if (mode === 'hours') {
      const n = Math.min(24, Math.max(1, Number(hours) || 12));
      if (n >= 24) return `0 0 * * *`;
      return `0 */${n} * * *`;
    }
    if (mode === 'daily') return `${mm} ${hh} * * *`;
    if (mode === 'weekly') {
      const list = (days && days.length ? days : [1]).join(',');
      return `${mm} ${hh} * * ${list}`;
    }
    return '';
  }

  /** 反向解析：把已有 cron 还原成可编辑的 UI 状态 */
  function parseCadence(cron) {
    const raw = String(cron || '').trim();
    if (!raw) return { mode: 'none', hours: 12, time: '09:00', days: [1], custom: '' };
    const parts = raw.split(/\s+/);
    if (parts.length !== 5) return { mode: 'custom', hours: 12, time: '09:00', days: [1], custom: raw };
    const [mi, ho, dom, mon, dow] = parts;
    const num = (s) => /^\d+$/.test(s);
    if (mi === '0' && /^\*\/\d+$/.test(ho) && dom === '*' && mon === '*' && dow === '*') {
      return { mode: 'hours', hours: Number(ho.slice(2)), time: '09:00', days: [1], custom: '' };
    }
    if (num(mi) && num(ho) && dom === '*' && mon === '*' && dow === '*') {
      return { mode: 'daily', hours: 12, time: `${ho.padStart(2, '0')}:${mi.padStart(2, '0')}`, days: [1], custom: '' };
    }
    if (num(mi) && num(ho) && dom === '*' && mon === '*' && /^[0-6](,[0-6])*$/.test(dow)) {
      return { mode: 'weekly', hours: 12, time: `${ho.padStart(2, '0')}:${mi.padStart(2, '0')}`, days: dow.split(',').map(Number), custom: '' };
    }
    return { mode: 'custom', hours: 12, time: '09:00', days: [1], custom: raw };
  }

  /** 人话描述当前节奏 */
  function describeCadence(mode, hours, time, days, custom) {
    if (mode === 'none') return '不自动执行（只手动触发）';
    if (mode === 'custom') return `自定义 cron：${custom || '（空）'}`;
    if (mode === 'hours') {
      const n = Math.min(24, Math.max(1, Number(hours) || 12));
      return n >= 24
        ? '每天 00:00 执行一次'
        : `每 ${n} 小时执行一次（每天 ${Math.floor(24 / n)} 次，整点）`;
    }
    if (mode === 'daily') return `每天 ${time || '09:00'} 执行一次`;
    if (mode === 'weekly') {
      const names = ['日', '一', '二', '三', '四', '五', '六'];
      const list = (days && days.length ? days : [1]).map((d) => `周${names[d]}`).join('、');
      return `每 ${list} 的 ${time || '09:00'} 执行`;
    }
    return '';
  }

report('bundle-executing', 'v2 design-system');

// ============================================================
// 插件
// ============================================================

// ============================================================
// 加载哨兵：文件一旦被宿主执行就立即上报（factory 之前）。
// 用于区分「文件没被加载」vs「加载后抛错」两种故障。
// ============================================================
try {
  fetch('/_dsh-bot/client-status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'sentinel', detail: 'bundle file evaluated', at: new Date().toISOString() }),
  }).catch(function () {});
} catch (e) {}
window.__ModuleLoader__.load({
  id: '@zifeng1023/dsh-bot',
  factory: (require) => {
    // 刀1 v0.3.9：需要 layout.selectPanel 打开管理中心；layout 由宿主 ui-layout 提供，
    // 旧宿主没有时 ctx.layout 为 undefined（所有调用点都有 try/catch 降级）。
    const inject = ['slots', 'layout'];

    // ⭐ 在这里给模块级的 React / h 赋值。
    //    图标组件在模块顶层定义，它们闭包引用这两个变量；
    //    必须在 apply 之前就绪，否则渲染时会抛 "h is not a function"。
    React = require('react');
    h = React.createElement;
    /** react-dom 可能不存在（旧宿主）；拿不到就回退为原地渲染 */
    let ReactDOM = null;
    try {
      ReactDOM = require('react-dom');
    } catch {
      ReactDOM = null;
    }
    /** 渲染到 document.body：绕开聊天输入区里「有 transform 的祖先」对 fixed 的影响 */
    function portal(node) {
      try {
        if (ReactDOM?.createPortal && typeof document !== 'undefined' && document.body) {
          return ReactDOM.createPortal(node, document.body);
        }
      } catch {
        /* 回退 */
      }
      return node;
    }

    function apply(ctx) {
      /** 侧边栏入口的运行时开关（设置页与首次引导共用；必须在 apply 作用域内） */
      const sidebarController = { apply: (_enabled) => {} };
      try {
        injectStyle();

        // ---------- 格式化 ----------
        const fmtCny = (n) =>
          Number.isFinite(n) ? (n < 0.01 ? `¥${n.toFixed(4)}` : `¥${n.toFixed(2)}`) : '¥0';

        // ⭐ 成本三态展示：免费 / 未知 / 精确金额。
        //    「¥0」有两种含义（真免费 vs 算不出来），长得必须不一样。
        const fmtCost = (usage) => {
          if (!usage) return '—';
          if (usage.costKind === 'free') return '免费';
          const c = usage.costCny;
          if (c === undefined || c === null || Number.isNaN(c) || usage.costKind === 'unknown') {
            return usage.costNote ? `未知（${usage.costNote}）` : '未知';
          }
          return fmtCny(c);
        };

        const fmtAgo = (iso) => {
          if (!iso) return '从未';
          const ms = Date.now() - Date.parse(iso);
          if (!Number.isFinite(ms)) return '—';
          if (ms < 60_000) return '刚刚';
          if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} 分钟前`;
          if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)} 小时前`;
          return `${Math.floor(ms / 86_400_000)} 天前`;
        };

        const statusColor = (s) =>
          s === 'success' ? OK : s === 'failed' ? ERR : s === 'partial' ? WARN : LABEL_3;

        const statusText = (s) =>
          s === 'success'
            ? '成功'
            : s === 'failed'
              ? '失败'
              : s === 'partial'
                ? '部分'
                : s === 'budget_exceeded'
                  ? '超预算'
                  : s || '—';

        // ---------- 目标（「守得住」） ----------
        const goalStatusText = (s) =>
          ({
            proposed: '待接受',
            active: '进行中',
            pending_confirmation: '待你确认',
            achieved: '已达成',
            blocked: '卡住了',
            abandoned: '已放弃',
          })[s] || s || '';

        const goalStatusColor = (s) =>
          s === 'active'
            ? BRAND
            : s === 'pending_confirmation'
              ? WARN
              : s === 'blocked'
                ? ERR
                : s === 'achieved'
                  ? OK
                  : LABEL_3;

        const goalTypeText = (t) => (t === 'standing' ? '常驻守护' : '一次性');

        // ---------- 通用按钮 ----------
        function Btn({ children, onClick, kind = 'ghost', disabled, title, icon }) {
          return h(
            'button',
            {
              className: `${NS}-btn ${NS}-btn-${kind}`,
              onClick,
              disabled,
              title,
              type: 'button',
            },
            icon || null,
            children,
          );
        }

        // ============================================================
        // 内嵌表单
        //
        // ⚠️ 为什么不用 window.prompt / window.confirm：
        //    DSH 跑在 Electron 的渲染进程里，prompt() 被直接禁用
        //    （报 "prompt() is not supported"），confirm() 恒返回 false。
        //    用它们的结果是按钮"点了没反应"或直接红框报错。
        //    所以所有输入都走真正的 DOM 表单。
        // ============================================================

        /** 下拉框样式（与 Input 一致，避免观感割裂） */
        const SELECT_STYLE = {
          flex: 1,
          boxSizing: 'border-box',
          fontFamily: FONT,
          fontSize: 12,
          color: LABEL_1,
          background: BG_L1,
          border: `1px solid ${BORDER_L2}`,
          borderRadius: R_SM,
          padding: '5px 8px',
          outline: 'none',
          cursor: 'pointer',
        };

        function Input({ value, onChange, placeholder, multiline, onEnter, autoFocus }) {
          const base = {
            width: '100%',
            boxSizing: 'border-box',
            fontFamily: FONT,
            fontSize: 12,
            lineHeight: 1.6,
            color: LABEL_1,
            background: BG_L1,
            border: `1px solid ${BORDER_L2}`,
            borderRadius: R_SM,
            padding: '5px 8px',
            outline: 'none',
            resize: 'none',
          };          if (multiline) {
            return h('textarea', {
              style: { ...base, minHeight: 48 },
              value,
              placeholder,
              autoFocus,
              onChange: (e) => onChange(e.target.value),
            });
          }
          return h('input', {
            style: base,
            type: 'text',
            value,
            placeholder,
            autoFocus,
            onChange: (e) => onChange(e.target.value),
            onKeyDown: (e) => {
              if (e.key === 'Enter' && onEnter) onEnter();
            },
          });
        }

        /**
         * 表单容器。
         *
         * 支持三种形态：
         *   · goal      —— 设目标（描述 + 类型）
         *   · reject    —— 驳回意见
         *   · createBot —— 建 Bot（名字 + 职责 + 可选目标）
         */
        function FormPanel({ form, onClose, onSubmit, busy }) {
          const [name, setName] = React.useState('');
          const [role, setRole] = React.useState('');
          const [goal, setGoal] = React.useState('');
          const [note, setNote] = React.useState('');
          const [desc, setDesc] = React.useState('');
          const [type, setType] = React.useState('one-shot');
          // ⭐ 执行节奏：这一栏决定「持续任务」会不会真的自动跑
          const [cadence, setCadence] = React.useState('');
          const [customTime, setCustomTime] = React.useState('09:00');
          // 模型编辑用
          const [provider, setProvider] = React.useState(form.provider ?? '');
          const [modelName, setModelName] = React.useState(form.model ?? '');
          // 真实可用的 provider / model 列表（来自 /_dsh-bot/models）
          const [providerList, setProviderList] = React.useState([]);
          const [modelsLoading, setModelsLoading] = React.useState(true);

          React.useEffect(() => {
            if (form.kind !== 'model') return;
            let alive = true;
            setModelsLoading(true);
            (async () => {
              try {
                const r = await fetch('/_dsh-bot/models', {
                  headers: { accept: 'application/json' },
                });
                const j = await r.json();
                if (alive && j?.ok) setProviderList(j.value?.available ?? []);
              } catch {
                /* 拿不到就退化成手填 */
              } finally {
                if (alive) setModelsLoading(false);
              }
            })();
            return () => {
              alive = false;
            };
          }, [form.kind]);

          const availableProviders = providerList.map((x) => x?.provider).filter(Boolean);
          const modelsForProvider =
            providerList.find((x) => x?.provider === provider)?.models ?? [];

          /** 把选择器状态收敛成最终的 cron */
          const resolvedCadence = () => {
            if (!cadence) return undefined;
            if (cadence === 'custom') return timeToCron(customTime);
            return cadence;
          };

          const submit = () => {
            if (form.kind === 'goal') {
              if (!desc.trim()) return;
              onSubmit('goalSet', {
                description: desc.trim(),
                goalType: type,
                cadence: resolvedCadence(),
              });
            } else if (form.kind === 'unblock') {
              onSubmit('goalUnblock', { note: note.trim() });
            } else if (form.kind === 'giveup') {
              onSubmit('goalGiveup', { note: note.trim() });
            } else if (form.kind === 'reject') {
              onSubmit('goalReject', { note: note.trim() || '还没做完' });
            } else if (form.kind === 'model') {
              if (!provider.trim() || !modelName.trim()) return;
              onSubmit('botModel', {
                provider: provider.trim(),
                model: modelName.trim(),
              });
            } else if (form.kind === 'createBot') {
              if (!name.trim() || !role.trim()) return;
              onSubmit('botCreate', {
                name: name.trim(),
                role: role.trim(),
                goal: goal.trim() || undefined,
                goalType: type,
                cadence: resolvedCadence(),
              });
            }
          };

          const title =
            form.kind === 'goal'
              ? `给「${form.botName}」设目标`
              : form.kind === 'unblock'
                ? '你是怎么解决的？（可选，会记进目标进展）'
                : form.kind === 'giveup'
                  ? '为什么放弃？（会记进目标史）'
                  : form.kind === 'reject'
                    ? '驳回这个目标的理由'
                    : form.kind === 'model'
                      ? `改「${form.botName}」用的模型`
                      : '新建一个 Bot';

          return h(
            'div',
            {
              style: {
                margin: '8px 12px',
                padding: '10px',
                borderRadius: R_SM,
                background: BG_L2,
                border: `1px solid ${BORDER_L2}`,
              },
            },
            h(
              'div',
              {
                style: {
                  fontSize: 11,
                  fontWeight: 600,
                  color: LABEL_1,
                  marginBottom: 8,
                },
              },
              title,
            ),

            form.kind === 'createBot'
              ? h(
                  'div',
                  { style: { display: 'flex', gap: 6, marginBottom: 6 } },
                  h('div', { style: { flex: 1 } },
                    h(Input, {
                      value: name,
                      onChange: setName,
                      placeholder: '名字，如「文件管家」',
                      autoFocus: true,
                    }),
                  ),
                  h('div', { style: { flex: 2 } },
                    h(Input, {
                      value: role,
                      onChange: setRole,
                      placeholder: '职责，如「整理下载文件夹」',
                    }),
                  ),
                )
              : null,

            form.kind === 'createBot' || form.kind === 'goal'
              ? h(Input, {
                  value: form.kind === 'goal' ? desc : goal,
                  onChange: form.kind === 'goal' ? setDesc : setGoal,
                  placeholder:
                    form.kind === 'goal'
                      ? '目标，如「整理下载文件夹」'
                      : '目标（可留空，稍后再设）',
                  onEnter: submit,
                  autoFocus: form.kind === 'goal',
                })
              : null,

            form.kind === 'reject' ||
            form.kind === 'unblock' ||
            form.kind === 'giveup'
              ? h(Input, {
                  value: note,
                  onChange: setNote,
                  placeholder:
                    form.kind === 'reject'
                      ? '哪里还没做好？（Bot 会看到这条）'
                      : form.kind === 'unblock'
                        ? '如：已重配 /admin 鉴权'
                        : '如：这个站点已经不维护了',
                  onEnter: submit,
                  autoFocus: true,
                })
              : null,

            // 模型编辑：provider + model
            //
            // 优先用下拉（从 /models 拿真实可用的 provider），
            // 拿不到才退化成手填。手输 provider 名极易打错，
            // 而打错的后果是执行时拿不到模型（EMPTY_OUTPUT）。
            form.kind === 'model'
              ? h(
                  'div',
                  null,
                  h(
                    'div',
                    { style: { display: 'flex', gap: 6, alignItems: 'center' } },
                    availableProviders && availableProviders.length > 0
                      ? h(
                          'select',
                          {
                            style: SELECT_STYLE,
                            value: provider,
                            onChange: (e) => setProvider(e.target.value),
                          },
                          h('option', { value: '' }, '选择 provider…'),
                          ...availableProviders.map((p) =>
                            h('option', { key: p, value: p }, p),
                          ),
                        )
                      : h(
                          'div',
                          { style: { flex: 1 } },
                          h(Input, {
                            value: provider,
                            onChange: setProvider,
                            placeholder: 'provider，如 trae',
                            autoFocus: true,
                          }),
                        ),

                    modelsForProvider && modelsForProvider.length > 0
                      ? h(
                          'select',
                          {
                            style: { ...SELECT_STYLE, flex: 1.3 },
                            value: modelName,
                            onChange: (e) => setModelName(e.target.value),
                          },
                          h('option', { value: '' }, '选择模型…'),
                          ...modelsForProvider.map((mo) =>
                            h('option', { key: mo, value: mo }, mo),
                          ),
                        )
                      : h(
                          'div',
                          { style: { flex: 1.3 } },
                          h(Input, {
                            value: modelName,
                            onChange: setModelName,
                            placeholder: 'model，如 deepseek-v4.1-flash',
                            onEnter: submit,
                          }),
                        ),
                  ),
                  h(
                    'div',
                    { style: { fontSize: 10, color: LABEL_3, marginTop: 5 } },
                    modelsLoading
                      ? '正在读取这个环境可用的模型…'
                      : availableProviders.length === 0
                        ? '读取不到模型列表，请手填。'
                        : modelsForProvider.length === 0
                          ? `provider「${provider || '未选'}」没有报告可用模型，请手填 model。`
                          : '下拉里是这个环境真实可用的选项。',
                  ),
                  // ⭐ 渠道适配提示（v0.3.1）：本插件的工具循环协议对 DeepSeek
                  //    系适配器打磨最充分；其他渠道可能存在空内容/流中断等
                  //    兼容性问题（详见 docs 渠道能力表，v0.5.0 起系统性支持）。
                  h(
                    'div',
                    {
                      style: {
                        fontSize: 10, color: WARN, marginTop: 5, lineHeight: 1.7,
                        padding: '5px 8px', borderRadius: R_SM, background: BG_L3,
                      },
                    },
                    '💡 建议：优先选 deepseek-official / deepseek-account 渠道——',
                    h('br'),
                    '本插件对 DeepSeek 系模型适配与验证最充分，其他渠道（如 our-free-model / zcode 等）可能出现空回复或流中断，正在逐步优化中（每版公告会注明）。',
                  ),
                )
              : null,

            // 类型选择 + 执行节奏
            form.kind === 'goal' || form.kind === 'createBot'
              ? h(
                  'div',
                  { style: { marginTop: 8 } },
                  h(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        fontSize: 11,
                        color: LABEL_2,
                      },
                    },
                    h('span', { style: { color: LABEL_3 } }, '类型'),
                    ...[
                      ['one-shot', '一次性（做完就归档）'],
                      ['standing', '常驻守护（一直守着）'],
                    ].map(([v, label]) =>
                      h(
                        'label',
                        {
                          key: v,
                          style: {
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            cursor: 'pointer',
                            color: type === v ? LABEL_1 : LABEL_2,
                          },
                        },
                        h('input', {
                          type: 'radio',
                          checked: type === v,
                          onChange: () => setType(v),
                          style: { margin: 0, cursor: 'pointer' },
                        }),
                        label,
                      ),
                    ),
                  ),

                  // ⭐ 执行节奏：改成选择器。
                  //
                  // 之前是自由文本「每 4 小时」，靠 parseCadence 猜。
                  // 猜不中就静默变成"没有节奏"——用户以为设好了，
                  // 面板却一直警告它会自己停。这种"猜"不该由用户承担。
                  // 现在直接给常用选项 + 精确时间，所见即所得。
                  h(
                    'div',
                    { style: { marginTop: 8 } },
                    h(
                      'div',
                      { style: { fontSize: 11, color: LABEL_3, marginBottom: 5 } },
                      '多久自动跑一次',
                    ),
                    h(
                      'div',
                      { style: { display: 'flex', gap: 5, flexWrap: 'wrap' } },
                      ...CADENCE_PRESETS.map((p) =>
                        h(
                          'button',
                          {
                            key: p.value,
                            type: 'button',
                            onClick: () => setCadence(p.value),
                            style: {
                              fontFamily: FONT,
                              fontSize: 11,
                              lineHeight: '18px',
                              padding: '3px 9px',
                              borderRadius: R_SM,
                              cursor: 'pointer',
                              background:
                                cadence === p.value ? BRAND : BG_L1,
                              color:
                                cadence === p.value ? LABEL_FG : LABEL_2,
                              border: `1px solid ${
                                cadence === p.value ? BRAND : BORDER_L2
                              }`,
                              transition: 'all .12s ease',
                            },
                          },
                          p.label,
                        ),
                      ),
                    ),
                    // 自定义时间（时:分）
                    cadence === 'custom'
                      ? h(
                          'div',
                          {
                            style: {
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              marginTop: 6,
                              fontSize: 11,
                              color: LABEL_2,
                            },
                          },
                          h('span', { style: { color: LABEL_3 } }, '每天'),
                          h(Input, {
                            value: customTime,
                            onChange: setCustomTime,
                            placeholder: 'HH:MM',
                          }),
                          h('span', { style: { color: LABEL_3 } }, '执行'),
                        )
                      : null,
                    h(
                      'div',
                      {
                        style: {
                          fontSize: 10,
                          marginTop: 5,
                          color: cadence ? LABEL_3 : WARN,
                        },
                      },
                      cadence
                        ? 'Bot 会按这个节奏自己醒来干活，不用你守着'
                        : '⚠️ 不选的话它不会自己跑 —— 只有你点「执行」才动一次',
                    ),
                  ),
                )
              : null,

            h(
              'div',
              {
                style: {
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: 6,
                  marginTop: 10,
                },
              },
              h(Btn, { onClick: onClose, disabled: busy }, '取消'),
              h(
                Btn,
                { kind: 'primary', onClick: submit, disabled: busy },
                form.kind === 'reject' ? '驳回' : '确定',
              ),
            ),
          );
        }

        /**
         * 需要二次确认的动作按钮。
         *
         * 取代 window.confirm：第一次点击进入 armed 态（按钮变红、文案变确认），
         * 3 秒内再点一次才真正执行。
         */
        function ConfirmBtn({ label, confirmLabel, icon, kind, onConfirm, disabled }) {
          const [armed, setArmed] = React.useState(false);

          React.useEffect(() => {
            if (!armed) return;
            const t = setTimeout(() => setArmed(false), 3000);
            return () => clearTimeout(t);
          }, [armed]);

          return h(
            Btn,
            {
              kind: armed ? 'danger' : kind,
              disabled,
              icon: armed ? null : icon,
              onClick: () => {
                if (armed) {
                  setArmed(false);
                  onConfirm();
                } else {
                  setArmed(true);
                }
              },
            },
            armed ? confirmLabel : label,
          );
        }

        // ---------- 预算条 ----------
        function Meter({ value, max }) {
          const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
          const color = pct > 80 ? ERR : pct > 50 ? WARN : OK;
          return h(
            'div',
            {
              style: {
                height: 4,
                width: '100%',
                borderRadius: 999,
                background: BG_L3,
                overflow: 'hidden',
                marginTop: 6,
              },
            },
            h('div', {
              style: {
                height: '100%',
                width: `${pct}%`,
                background: color,
                borderRadius: 999,
                transition: 'width .35s cubic-bezier(.4,0,.2,1)',
              },
            }),
          );
        }

        // ---------- 状态徽标 ----------
        function Badge({ children, tone = 'neutral' }) {
          const map = {
            ok: { bg: OK_TER, fg: OK },
            warn: { bg: WARN_TER, fg: WARN },
            err: { bg: 'transparent', fg: ERR },
            neutral: { bg: BG_L3, fg: LABEL_2 },
            brand: { bg: BG_L3, fg: BRAND },
          };
          const t = map[tone] || map.neutral;
          return h(
            'span',
            {
              style: {
                fontSize: 11,
                lineHeight: '16px',
                padding: '1px 7px',
                borderRadius: 999,
                background: t.bg,
                color: t.fg,
                fontFamily: FONT,
                whiteSpace: 'nowrap',
              },
            },
            children,
          );
        }

        // ============================================================
        // 设置页
        //
        // DSH 没有通用的 settings slot（官方插件都挂在对话区），
        // 所以做成面板内的一个独立视图，从头部齿轮进入。
        //
        // 分组遵循「改这个是为了什么」而不是「技术上属于哪类」：
        //   通知（什么时候打扰我）/ 模型（用啥干活）/ 预算（能花多少）
        //   目标（怎么推进）/ 高级（省钱与安全）/ 数据（清记录）
        // ============================================================

        /** 一行开关 */
        function ToggleRow({ label, hint, value, onChange }) {
          return h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 0',
              },
            },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: 12, color: LABEL_1 } }, label),
              hint
                ? h(
                    'div',
                    { style: { fontSize: 10, color: LABEL_3, marginTop: 2 } },
                    hint,
                  )
                : null,
            ),
            h(
              'button',
              {
                type: 'button',
                onClick: () => onChange(!value),
                style: {
                  width: 36,
                  height: 20,
                  borderRadius: 999,
                  border: 'none',
                  cursor: 'pointer',
                  background: value ? BRAND : BORDER_L2,
                  position: 'relative',
                  flexShrink: 0,
                  transition: 'background .15s ease',
                },
                'aria-pressed': value,
              },
              h('span', {
                style: {
                  position: 'absolute',
                  top: 2,
                  left: value ? 18 : 2,
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  background: LABEL_FG,
                  transition: 'left .15s ease',
                },
              }),
            ),
          );
        }

        /** 一行数字/文本输入 */
        function FieldRow({ label, hint, value, onChange, placeholder, width }) {
          return h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '6px 0',
              },
            },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { style: { fontSize: 12, color: LABEL_1 } }, label),
              hint
                ? h(
                    'div',
                    { style: { fontSize: 10, color: LABEL_3, marginTop: 2 } },
                    hint,
                  )
                : null,
            ),
            h(
              'div',
              { style: { width: width ?? 120, flexShrink: 0 } },
              h(Input, { value, onChange, placeholder }),
            ),
          );
        }

        /**
         * 最近运行列表（设置页「最近运行」组）。
         *
         * 花费透明是硬要求：每一轮必须能回答「谁在跑、花了多少、
         * 钱花在哪」。三态展示沿用 fmtCost 的契约：
         *   exact=付费（显示金额）/ free=免费 / unknown=无价目数据。
         *
         * 两种形态（用户可切换，偏好存 localStorage）：
         *   compact = 固定高度内部滚动（约 6 条记录的高度）
         *   paged   = 分页器（每页 5 条，页面干净）
         */
        const RUNS_MODE_KEY = 'dsh-bot:runsMode';
        const RUNS_PAGE_SIZE = 5;
        // compact 形态固定高度：行高约 44px，6 行 + 边距
        const RUNS_COMPACT_HEIGHT = 6 * 44 + 8;



        /** 单轮运行详情弹窗 */
        function RunDetailModal({ run, onClose }) {
          const u = run.usage ?? {};
          const tokenRows = [
            ['输入', u.inputTokens],
            ['输出', u.outputTokens],
            ['缓存命中', u.cacheHitTokens],
            ['缓存未命中', u.cacheMissTokens],
            ['思考', u.reasoningTokens],
          ];
          const totalTokens = tokenRows.reduce((s, [, v]) => s + (Number(v) || 0), 0);
          const costLabel = fmtCost(u);
          const costTone =
            u.costKind === 'free' ? OK : u.costKind === 'unknown' ? WARN : LABEL_1;
          const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('zh-CN', { hour12: false }) : '—');
          // ⭐ 0.3.8 修正：不同入口的 run 数据形态不同
          //   · /runs/list 的 run 有 outputPreview / botName
          //   · /bot 的 run 是原始记录，两者都没有
          //   统一在这里派生，弹窗不再依赖调用方补字段。
          const stepList = Array.isArray(run.steps) ? run.steps : [];
          const stepCount = stepList.length;
          const llmOutput = (() => {
            if (run.outputPreview) return run.outputPreview;
            for (let i = stepList.length - 1; i >= 0; i--) {
              const s = stepList[i];
              if (s?.kind === 'llm' && s?.result?.output) return String(s.result.output);
            }
            return '';
          })();
          const assessment = run.goalAssessment;
          const title = '运行详情 · ' + (run.botName ?? '本轮');
          return h(
            'div',
            {
              onClick: onClose,
              style: {
                position: 'fixed', inset: 0, zIndex: 10000,
                background: 'rgba(0,0,0,.45)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: FONT,
              },
            },
            h(
              'div',
              {
                onClick: (e) => e.stopPropagation(),
                style: {
                  width: 520, maxHeight: '80vh', overflow: 'auto',
                  background: BG_L3, borderRadius: R_LG, boxShadow: SHADOW,
                  padding: 16,
                },
              },
              // ---- 头部 ----
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 } },
                h('div', { style: { fontSize: 14, fontWeight: 600, color: LABEL_1, flex: 1 } }, title),
                h(Badge, { tone: run.dryRun ? 'brand' : 'neutral' }, run.dryRun ? '演习' : '真实执行'),
                h(
                  'button',
                  { onClick: onClose, type: 'button', style: { border: 'none', background: 'transparent', cursor: 'pointer', color: LABEL_2, fontSize: 14 } },
                  '✕',
                ),
              ),
              // ---- 概要 ----
              h(
                'div',
                { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 } },
                ...[
                  ['状态', run.status],
                  ['触发方式', run.trigger],
                  ['开始', fmtTime(run.startedAt)],
                  ['结束', fmtTime(run.endedAt)],
                  ['步骤数', String(stepCount)],
                  ['运行 ID', run.id],
                ].map(([k, v]) =>
                  h(
                    'div',
                    { key: k, style: { padding: '6px 8px', background: BG_L2 || BG_L3, borderRadius: R_SM } },
                    h('div', { style: { fontSize: 10, color: LABEL_3 } }, k),
                    h('div', { style: { fontSize: 12, color: LABEL_1, wordBreak: 'break-all' } }, v),
                  ),
                ),
              ),
              // ---- 费用（透明化核心块） ----
              h(
                'div',
                { style: { padding: 10, borderRadius: R_MD, border: `1px solid ${BORDER_L1}`, marginBottom: 12 } },
                h('div', { style: { fontSize: 11, fontWeight: 600, color: LABEL_2, marginBottom: 6 } }, '费用与渠道'),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 } },
                  h('div', { style: { fontSize: 20, fontWeight: 600, color: costTone } }, costLabel),
                  h(
                    'span',
                    { style: { fontSize: 11, color: u.costKind === 'free' ? OK : u.costKind === 'unknown' ? WARN : LABEL_3 } },
                    u.costKind === 'free'
                      ? '免费渠道（订阅内/免费模型，未产生 API 计费）'
                      : u.costKind === 'unknown'
                        ? '渠道无价目数据，无法计费'
                        : '付费渠道（按 token 计价）',
                  ),
                ),
                u.costNote ? h('div', { style: { fontSize: 10, color: LABEL_3, marginBottom: 4 } }, u.costNote) : null,
                h(
                  'div',
                  { style: { display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 } },
                  ...tokenRows.map(([k, v]) =>
                    h(
                      'div',
                      { key: k, style: { textAlign: 'center', padding: '4px 2px', background: BG_L3, borderRadius: R_XS } },
                      h('div', { style: { fontSize: 10, color: LABEL_3 } }, k),
                      h('div', { style: { fontSize: 12, color: LABEL_1 } }, String(Number(v) || 0)),
                    ),
                  ),
                ),
                h('div', { style: { fontSize: 10, color: LABEL_3, marginTop: 6 } }, `合计 ${totalTokens} tokens（含缓存与思考）`),
              ),
              // ---- 模型兜底说明 ----
              run.modelFallback
                ? h(
                    'div',
                    { style: { fontSize: 11, color: WARN, padding: '6px 8px', borderRadius: R_SM, background: BG_L3, marginBottom: 12 } },
                    `⚠ ${run.modelFallback}`,
                  )
                : null,
              // ---- 错误 ----
              run.error
                ? h(
                    'div',
                    { style: { fontSize: 11, color: ERR, padding: '6px 8px', borderRadius: R_SM, background: BG_L3, marginBottom: 12 } },
                    `${run.error.code}: ${run.error.message}`,
                  )
                : null,
              // ---- 工具调用 ----
              run.toolSteps?.length
                ? h(
                    'div',
                    { style: { marginBottom: 12 } },
                    h('div', { style: { fontSize: 11, fontWeight: 600, color: LABEL_2, marginBottom: 4 } }, `工具调用（${run.toolSteps.length} 次）`),
                    ...run.toolSteps.map((t, i) =>
                      h(
                        'div',
                        { key: i, style: { display: 'flex', gap: 8, fontSize: 11, padding: '3px 0', color: LABEL_1 } },
                        h('span', { style: { color: LABEL_3, width: 60, flexShrink: 0 } }, `${t.durationMs ?? 0}ms`),
                        h('span', { style: { fontFamily: 'monospace' } }, t.name),
                        t.blocked ? h(Badge, { tone: 'warn' }, '拦截') : null,
                        t.error ? h('span', { style: { color: ERR, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, t.error.message ?? '') : null,
                      ),
                    ),
                  )
                : null,
              // ---- 运行输出（全文可滚动；markdown 以等宽渲染；文件产物给路径提示） ----
              (() => {
                const out = llmOutput;
                const chars = out.length;
                // 文件产物识别：输出中引用的本地文件路径（Windows 盘符 / ~/.dsh 常见落点）
                const FILE_EXT_RE = new RegExp("\\.(md|txt|json|ya?ml|log|csv|html?|tgz|zip|png|jpe?g)$", "i");
                const FILE_PATH_RE = new RegExp("([A-Za-z]:\\\\[^\\s\"]+\\.[a-z0-9]{2,4})|(~\\/\\.dsh\\/[^\\s\"]+\\.[a-z0-9]{2,4})", "gi");
                const pathMatches = [];
                for (const p of out.match(FILE_PATH_RE) || []) {
                  if (FILE_EXT_RE.test(p) && !pathMatches.includes(p)) pathMatches.push(p);
                }
                const truncated = out.includes('[已截断') || chars >= 50_000;
                return h(
                  'div',
                  null,
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 } },
                    h('div', { style: { fontSize: 11, fontWeight: 600, color: LABEL_2 } }, '运行输出'),
                    h(
                      'div',
                      { style: { fontSize: 10, color: LABEL_3, flex: 1 } },
                      chars ? `${chars.toLocaleString()} 字${truncated ? '（超长已截断，完整全文见 runs 归档 JSON）' : ''}` : '',
                    ),
                    chars
                      ? h(
                          'button',
                          {
                            type: 'button',
                            onClick: () => {
                              try { navigator.clipboard.writeText(out); } catch {}
                            },
                            style: {
                              border: 'none', background: 'transparent', cursor: 'pointer',
                              fontSize: 10, color: BRAND, textDecoration: 'underline',
                            },
                          },
                          '复制全文',
                        )
                      : null,
                  ),
                  // 文件产物提示：报告落盘/导出的路径让用户找得到
                  pathMatches.length
                    ? h(
                        'div',
                        {
                          style: {
                            fontSize: 10, color: BRAND, padding: '5px 8px', marginBottom: 4,
                            borderRadius: R_SM, background: BG_L3, lineHeight: 1.7,
                          },
                        },
                        '📎 本轮提到的文件产物：',
                        ...pathMatches.slice(0, 5).map((p, i) =>
                          h(
                            'div',
                            { key: i, style: { fontFamily: 'ui-monospace, monospace', wordBreak: 'break-all' } },
                            p,
                          ),
                        ),
                      )
                    : null,
                  h(
                    'div',
                    {
                      style: {
                        fontSize: 11, color: LABEL_1, padding: 8, borderRadius: R_SM,
                        background: BG_L3, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                        maxHeight: 260, overflow: 'auto', lineHeight: 1.6,
                      },
                    },
                    out || '（无文本输出——若本轮产出为文件，见上方路径提示或运行归档）',
                  ),
                );
              })(),
              // ---- 目标评估（0.3.8：这轮对目标产生了什么影响） ----
              assessment
                ? h(
                    'div',
                    { style: { padding: 10, borderRadius: R_MD, border: `1px solid ${BORDER_L1}`, marginTop: 12 } },
                    h('div', { style: { fontSize: 11, fontWeight: 600, color: LABEL_2, marginBottom: 6 } }, '目标评估'),
                    h(
                      'div',
                      { style: { fontSize: 12, lineHeight: 1.7, color: LABEL_1, whiteSpace: 'pre-wrap' } },
                      assessment.note || '（本轮没有留下评估说明）',
                    ),
                    assessment.nextStep
                      ? h(
                          'div',
                          { style: { fontSize: 11, lineHeight: 1.7, color: LABEL_3, marginTop: 6 } },
                          '下一步：' + assessment.nextStep,
                        )
                      : null,
                    assessment.needsHuman
                      ? h('div', { style: { fontSize: 11, color: WARN, marginTop: 6 } }, '⭐ 这轮认为需要你介入')
                      : null,
                  )
                : null,
            ),
          );
        }




        //
        // 核心洞察：用户说"挤成一坨，不可阅览"，本质不是排版问题，
        // 而是**该显示的和不该显示的都在显示**。
        //
        // 所以这里换个思路：不再"有什么数据画什么"，
        // 而是先判断 Bot 现在处于什么状态，只画那个状态需要的东西。
        //
        //   ┌─────────────┬──────────────────────────────┐
        //   │ Bot 状态     │ 需要显示                      │
        //   ├─────────────┼──────────────────────────────┤
        //   │ 没有目标     │ 一行提示 + [设目标]           │
        //   │ 待你确认     │ 目标 + 确认/驳回（大按钮）     │
        //   │ 卡住了       │ 目标 + 原因 + 怎么处理         │
        //   │ 上次失败     │ 目标 + 失败原因 + [看看]       │
        //   │ 正常         │ 目标 + 一行最近结果            │
        //   │ 空闲         │ 目标 + "一切都好"             │
        //   └─────────────┴──────────────────────────────┘
        //
        // 其余内容（记忆、例行、模型、预算、快照）收进「更多」。
        // ============================================================
// ============================================================
// v0.3.9 刀1：旧 dock 完整面板已删除（能力归属 0.3.8 控制台，见 PLAN-v0.3.9）。
// 本分片只保留侧边栏图标；新的快捷条在 85-dockbar.js。
// ============================================================

        /** 侧边栏图标（只画字形，颜色跟随 currentColor） */
        function BotSidebarIcon({ size = 16 }) {
          return h(
            'svg',
            { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': 'true' },
            h('rect', { x: 4, y: 6.5, width: 16, height: 12, rx: 3, stroke: 'currentColor', strokeWidth: 1.6 }),
            h('circle', { cx: 9, cy: 12.5, r: 1.4, fill: 'currentColor' }),
            h('circle', { cx: 15, cy: 12.5, r: 1.4, fill: 'currentColor' }),
            h('path', { d: 'M12 6.5V4', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round' }),
          );
        }

        // ============================================================
        // v0.3.9 dock 快捷条（刀1）
        //
        // 旧 BotDock 完整面板已删除（能力归属 0.3.8 控制台，见 PLAN-v0.3.9.md）。
        // 现在对话输入框上方只有一条快捷条：
        //   [Bot 切换] [状态] [今日花费·当前Bot] —— [模型快切] [执行] [管理中心] [收起]
        // 决策（2026-11-20）：
        //   · 会话未关联 Bot → chip 显示「未关联」，点开菜单选择即关联（记 localStorage）
        //   · 花费只显示当前 Bot，全队合计在控制台
        //   · 收起 = 一行胶囊（Bot 名 + 状态点 + 模型 pill + 展开）
        //   · 模型快切 pill 两击换模型；完整编辑在详情页配置卡
        // ============================================================

        const DOCK_COLLAPSE_KEY = NS + ':dockCollapsed';
        const DOCK_BOT_KEY = NS + ':dockBotId';

        /** localStorage 安全读写 */
        const dockLs = {
          get(k) { try { return localStorage.getItem(k); } catch { return null; } },
          set(k, v) { try { localStorage.setItem(k, v); } catch {} },
        };

        /** 状态点样式（成功/失败/部分/运行中/从未） */
        function dockStatOf(bot, running, runningDry = true) {
          if (running) return { cls: NS + '-db-stat run', label: runningDry ? '演习中' : '真跑中' };
          if (!bot) return { cls: NS + '-db-stat idle', label: '未关联' };
          const s = bot.lastRunStatus;
          if (!s) return { cls: NS + '-db-stat idle', label: '从未运行' };
          if (s === 'success') return { cls: NS + '-db-stat ok', label: '成功 · ' + fmtAgo(bot.lastRunAt) };
          if (s === 'failed') return { cls: NS + '-db-stat err', label: '失败 · ' + fmtAgo(bot.lastRunAt) };
          if (s === 'partial') return { cls: NS + '-db-stat err', label: '部分 · ' + fmtAgo(bot.lastRunAt) };
          return { cls: NS + '-db-stat', label: statusText(s) + ' · ' + fmtAgo(bot.lastRunAt) };
        }

        /** 机器人形小图标（复用侧边栏字形） */
        /** SVG 雪佛龙（下拉 / 上收），不再用字符 ▾ ⌃（不同字体下渲染丑陋） */
        function ChevDown({ size = 10 }) {
          return h('svg', { width: size, height: size, viewBox: '0 0 12 12', fill: 'none', 'aria-hidden': 'true' },
            h('path', { d: 'M2.5 4.5L6 8l3.5-3.5', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }));
        }
        function ChevUp({ size = 10 }) {
          return h('svg', { width: size, height: size, viewBox: '0 0 12 12', fill: 'none', 'aria-hidden': 'true' },
            h('path', { d: 'M2.5 7.5L6 4l3.5 3.5', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' }));
        }

        function DockBotMark() {
          return h('span', { className: 'mark' }, h(BotSidebarIcon, { size: 10 }));
        }

        /** toast：短暂提示后消失（旧宿主没有 selectPanel 时的降级引导） */
        function DockToast({ text }) {
          if (!text) return null; // 空 toast 不渲染（否则输入框上方会多出一个无意义的小方块）
          return portal(h('div', { className: NS + '-db-toast' }, text));
        }

        /**
         * 打开管理中心。优先 ctx.layout.selectPanel('dsh-bot')（rc.5）；
         * 失败（旧宿主 / 未注册）→ toast 引导走侧边栏图标。
         */
        function openConsole(ctx) {
          try {
            if (ctx?.layout && typeof ctx.layout.selectPanel === 'function') {
              ctx.layout.selectPanel('dsh-bot');
              return true;
            }
          } catch (e) {
            report('select-panel-error', String(e?.message ?? e));
          }
          return false;
        }

        /**
         * DockBar —— 快捷条本体。
         * 数据源：/overview（Bot 列表 + 状态 + 今日花费，10s 轮询 + 可见性感知）。
         */
        /**
         * 模型快切菜单：provider 列表 → 模型列表，两击完成切换。
         */
        /**
         * 模型快切菜单：provider 列表 → 模型列表，两击完成切换。
         * 布局：head（固定）/ list（滚动）/ foot（固定）—— provider 有 14 个时也不会顶出屏幕。
         */
        function ModelMenu({ shown, models, pickProvider, setPickProvider, setModel, openConsoleSafe }) {
          const modelsFor = (pickProvider
            ? ((models ?? []).find((x) => x && x.provider === pickProvider)?.models ?? [])
            : []);
          const providerList = (models ?? []).filter((x) => x && typeof x.provider === 'string');
          return h('div', { className: NS + '-db-pop right' },
            h('div', { className: 'head' },
              !pickProvider
                ? '切换到哪个 provider？（' + providerList.length + '）'
                : pickProvider + ' · ' + modelsFor.length + ' 个模型',
            ),
            h('div', { className: 'list' },
              !pickProvider
                ? providerList.map((x) =>
                    h('button',
                      {
                        key: x.provider,
                        className: 'item' + (x.provider === shown.model?.provider ? ' active' : ''),
                        onClick: () => setPickProvider(x.provider),
                      },
                      h('span', { className: 'nm' }, x.provider),
                      h('span', { className: 'meta' }, ((x.models ?? []).length) + ' 个'),
                      h('span', { className: 'chev' }, h(ChevDown, { size: 9 })),
                    ),
                  )
                : [
                    ...modelsFor.map((m) =>
                      h('button',
                        {
                          key: m,
                          className: 'item' + (m === shown.model?.model && pickProvider === shown.model?.provider ? ' active' : ''),
                          onClick: () => void setModel(pickProvider, m),
                        },
                        h('span', { className: 'nm' }, m),
                        m === shown.model?.model && pickProvider === shown.model?.provider
                          ? h('span', { className: 'meta' }, '当前')
                          : null,
                      ),
                    ),
                    modelsFor.length === 0
                      ? h('div', { className: 'desc' }, '这个 provider 没有返回模型列表，可在详情页手动填写。')
                      : null,
                    h('button', { className: 'item back', onClick: () => setPickProvider(null) },
                      h('span', { className: 'nm' }, '← 返回 provider'),
                    ),
                  ],
            ),
            h('div', { className: 'foot' },
              h('button', { className: 'mi', onClick: openConsoleSafe }, '完整编辑在详情页 →'),
            ),
          );
        }

        function DockBar({ ctx, onOpenConsole }) {
          const [bots, setBots] = React.useState(null); // null = 加载中
          const [menuOpen, setMenuOpen] = React.useState(false);
          const [runPop, setRunPop] = React.useState(false);
          const [modelPop, setModelPop] = React.useState(false);
          const [models, setModels] = React.useState(null);
          const [busy, setBusy] = React.useState(false);
          const [runningBot, setRunningBot] = React.useState(null); // 正在演习/真跑的 botId
          const [toast, setToast] = React.useState('');
          const [collapsed, setCollapsed] = React.useState(() => dockLs.get(DOCK_COLLAPSE_KEY) === '1');
          const [assocId, setAssocId] = React.useState(() => dockLs.get(DOCK_BOT_KEY) || '');
          const rootRef = React.useRef(null);

          // 点击空白处关闭弹层
          React.useEffect(() => {
            if (!menuOpen && !runPop && !modelPop) return undefined;
            const close = (e) => {
              if (rootRef.current && !rootRef.current.contains(e.target)) {
                setMenuOpen(false); setRunPop(false); setModelPop(false);
              }
            };
            document.addEventListener('mousedown', close);
            return () => document.removeEventListener('mousedown', close);
          }, [menuOpen, runPop, modelPop]);

          // 轮询 overview（10s）；页面隐藏时不拉
          React.useEffect(() => {
            let stop = false;
            let timer = null;
            const tick = async () => {
              if (stop || document.hidden) return;
              try {
                const r = await fetch('/_dsh-bot/overview', { headers: { accept: 'application/json' } });
                const j = await r.json();
                if (!stop && j?.ok) setBots(Array.isArray(j.value?.bots) ? j.value.bots : []);
              } catch { /* 下轮再试 */ }
            };
            void tick();
            timer = setInterval(tick, 10_000);
            return () => { stop = true; if (timer) clearInterval(timer); };
          }, []);

          // 执行后的运行状态跟踪：30s 内每 2s 查最近一轮
          React.useEffect(() => {
            if (!runningBot) return undefined;
            const t0 = Date.now();
            const timer = setInterval(async () => {
              try {
                const r = await fetch('/_dsh-bot/runs/list?botId=' + encodeURIComponent(runningBot) + '&limit=1', { headers: { accept: 'application/json' } });
                const j = await r.json();
                const run = j?.value?.runs?.[0];
                const started = run && Date.parse(run.startedAt || '') > t0 - 2000;
                const done = run && run.status && run.status !== 'running' && started && Date.parse(run.endedAt || '') > t0;
                if (done) {
                  setRunningBot(null);
                  setToast((run.status === 'success' ? '演习完成' : statusText(run.status)) + ' · 详情见运行记录');
                  setTimeout(() => setToast(''), 4000);
                } else if (Date.now() - t0 > 120_000) {
                  setRunningBot(null);
                  setToast('仍在运行，可去运行记录查看进度');
                  setTimeout(() => setToast(''), 4000);
                }
              } catch { /* 下轮再试 */ }
            }, 2000);
            return () => clearInterval(timer);
          }, [runningBot]);

          // ⚠️ 防御：overview 异常时 bots 里可能出现 null/非对象条目，任何一次 map 抛错都会让整条快捷条崩掉
          const list = (Array.isArray(bots) ? bots : []).filter((b) => b && typeof b === 'object');
          const assoc = list.find((b) => b.id === assocId) || null;
          const shown = assoc || list[0] || null;

          /** 关联 Bot（或切换） */
          const pickBot = (b) => {
            setAssocId(b.id);
            dockLs.set(DOCK_BOT_KEY, b.id);
            setMenuOpen(false);
          };

          /** 执行（dryRun 默认 true） */
          const doRun = async (dryRun) => {
            if (!shown || busy) return;
            setBusy(true);
            setRunPop(false);
            try {
              const r = await fetch('/_dsh-bot/run', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                // confirm: true —— 用户已在上一步的确认浮层里显式点过（演习同样需要，
                // 这是 /run 路由的既有安全设计：任何执行都必须带显式确认）
                body: JSON.stringify({ botId: shown.id, dryRun, confirm: true }),
              });
              const j = await r.json();
              if (j?.ok) {
                setRunningDry(dryRun);
                setRunningBot(shown.id);
                setToast(dryRun ? '演习已启动' : '真实执行已启动');
              } else {
                setToast('启动失败：' + (j?.message || '未知错误'));
              }
            } catch (e) {
              setToast('启动失败：' + String(e?.message ?? e));
            } finally {
              setBusy(false);
              setTimeout(() => setToast(''), 4000);
            }
          };

          /** 拉模型列表（首次展开模型菜单） */
          const ensureModels = async () => {
            if (models) return;
            try {
              const r = await fetch('/_dsh-bot/models', { headers: { accept: 'application/json' } });
              const j = await r.json();
              if (j?.ok) setModels(j.value?.available ?? []);
            } catch { setModels([]); }
          };

          /** 两击换模型：选 provider → 选 model → POST /bot/model */
          const [pickProvider, setPickProvider] = React.useState(null);
          /** 当前这一轮是演习还是真跑（状态条文案要区分，否则用户以为演习在跑） */
          const [runningDry, setRunningDry] = React.useState(true);
          const setModel = async (provider, model) => {
            if (!shown) return;
            setModelPop(false); setPickProvider(null);
            try {
              const r = await fetch('/_dsh-bot/bot/model', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ botId: shown.id, provider, model }),
              });
              const j = await r.json();
              setToast(j?.ok ? '模型已切到 ' + provider + ' / ' + model : '切换失败：' + (j?.message || '?'));
              // 刷新列表（overview 里的 model 字段）
              try {
                const r2 = await fetch('/_dsh-bot/overview', { headers: { accept: 'application/json' } });
                const j2 = await r2.json();
                if (j2?.ok) setBots(Array.isArray(j2.value?.bots) ? j2.value.bots : []);
              } catch {}
            } catch (e) {
              setToast('切换失败：' + String(e?.message ?? e));
            }
            setTimeout(() => setToast(''), 4000);
          };

          const toggleCollapse = () => {
            setCollapsed((prev) => {
              dockLs.set(DOCK_COLLAPSE_KEY, prev ? '0' : '1');
              return !prev;
            });
          };

          const openConsoleSafe = () => {
            if (!onOpenConsole()) setToast('请在左侧边栏点 dsh-bot 图标打开管理中心');
            setTimeout(() => setToast(''), 4000);
          };

          // ============================================================
          const stat = dockStatOf(shown, !!runningBot, runningDry);
          const running = runningBot != null;

          // 渲染：收起态与展开态共用同一套弹层，只有行内容不同。
          // 每个控件各司其职（不再"全部跳管理中心"）：
          //   Bot chip  → Bot 切换菜单
          //   状态 chip → 管理中心（看最近运行）
          //   模型 pill → 模型快切菜单
          //   箭头      → 收起 / 展开
          // ============================================================
          const toastEl = toast ? portal(h('div', { className: NS + '-db-toast' }, toast)) : null;

          const botMenuEl = menuOpen
            ? h('div', { className: NS + '-db-pop', style: { left: 0 } },
                h('div', { className: 'head' }, '全部 Bot（' + list.length + '）'),
                h('div', { className: 'list' },
                  ...list.map((b) => {
                    const st = b.lastRunStatus === 'success' ? 'g' : b.lastRunStatus === 'failed' ? 'r' : '';
                    return h('button', {
                      key: b.id,
                      className: 'item' + (shown?.id === b.id ? ' active' : ''),
                      onClick: () => pickBot(b),
                    },
                      h('span', { className: 'nm' }, b.name),
                      h('span', { className: 'meta' },
                        h('span', null, fmtCny(b.todayCostCny)),
                        h('span', { className: 'dot ' + st }),
                      ),
                    );
                  }),
                  list.length === 0 ? h('div', { className: 'desc' }, '还没有 Bot') : null,
                ),
                h('div', { className: 'foot' },
                  h('button', { className: 'mi', onClick: openConsoleSafe }, '＋ 新建 Bot'),
                  h('button', { className: 'mi', onClick: openConsoleSafe }, '管理中心'),
                ),
              )
            : null;

          const modelMenuEl = modelPop && shown
            ? h(ModelMenu, { shown, models, pickProvider, setPickProvider, setModel, openConsoleSafe })
            : null;

          const runConfirmEl = runPop && shown && !collapsed
            ? h('div', { className: NS + '-db-pop right' },
                h('div', { className: 'head' }, '演习「' + shown.name + '」的当前目标？'),
                h('div', { className: 'desc' },
                  '演习完整走一遍流程，', h('b', null, '不写任何文件、不花钱'), '；输出满意后可在运行详情里放行。真跑会实际执行。',
                ),
                h('div', { className: 'acts' },
                  h('button', { className: NS + '-db-btn', disabled: busy, onClick: () => void doRun(false) }, '真跑一次'),
                  h('button', { className: NS + '-db-btn primary', disabled: busy, onClick: () => void doRun(true) }, '演习一次'),
                ),
              )
            : null;

          /** 花费（收起态展示；展开态腾出空间给模型与操作） */
          const costEl = shown
            ? h('span', { className: NS + '-db-cost' },
                h('span', { className: 'txt' },
                  h('b', null, fmtCny(shown.todayCostCny)),
                  running ? '' : h('span', { className: 'lim' }, ' / ' + fmtCny(shown.budget?.dailyCny)),
                ),
              )
            : null;

          /** 模型 pill（两态共用，点击开模型菜单） */
          const modelEl = shown
            ? h('button', {
                className: NS + '-db-model',
                onClick: () => { setModelPop(!modelPop); setMenuOpen(false); setRunPop(false); void ensureModels(); },
                title: '当前模型：' + (shown.model?.provider || '?') + ' / ' + (shown.model?.model || '?'),
              },
                h('span', { className: 'txt' }, shown.model?.provider || '?', h('span', { className: 'sep' }, ' / '), shown.model?.model || '?'),
                h(ChevDown, { size: 9 }),
              )
            : null;

          /** Bot chip（两态共用，点击开 Bot 菜单） */
          const botChipEl = h('button', {
            className: NS + '-db-chip',
            onClick: () => { setMenuOpen(!menuOpen); setRunPop(false); setModelPop(false); },
            title: shown ? '当前 Bot：' + shown.name + '（点击切换）' : '未关联 Bot（点击选择）',
          },
            shown ? h(DockBotMark, null) : null,
            h('span', { className: 'nm' }, shown ? shown.name : '未关联'),
            h('span', { className: 'chev' }, h(ChevDown, null)),
          );

          // ---------- 收起态：一行胶囊 ----------
          // 左：身份 + 状态点 / 右：今日花费 + 模型 + 展开
          if (collapsed) {
            return h('div', { className: NS + '-dockbar-wrap' },
              toastEl,
              h('div', {
                className: NS + '-dock ' + NS + '-dockbar ' + NS + '-dockbar-collapsed',
                ref: rootRef,
              },
                h('div', { className: NS + '-dockbar-row' },
                  h('div', { className: NS + '-dockbar-main' },
                    botChipEl,
                    h('button', { className: stat.cls + ' ' + NS + '-db-stat-dotonly', title: '最近一轮：' + stat.label + ' · 点击查看运行记录', onClick: openConsoleSafe },
                      h('span', { className: 'dot' }),
                    ),
                  ),
                  h('div', { className: NS + '-dockbar-actions' },
                    costEl,
                    modelEl,
                    h('button', { className: NS + '-db-chip ' + NS + '-db-iconbtn', onClick: toggleCollapse, title: '展开快捷条' },
                      h(ChevUp, null),
                    ),
                  ),
                ),
                botMenuEl,
                modelMenuEl,
              ),
            );
          }

          // ---------- 展开态 ----------
          return h('div', { className: NS + '-dockbar-wrap' },
            toastEl,
            h('div', { className: NS + '-dock ' + NS + '-dockbar', ref: rootRef },
              h('div', { className: NS + '-dockbar-row' },
                h('div', { className: NS + '-dockbar-main' },
                  botChipEl,
                  h('button', { className: stat.cls, onClick: openConsoleSafe, title: '最近一轮：' + stat.label + ' · 点击查看运行记录' },
                    h('span', { className: 'dot' }),
                    h('span', { className: 'stat-text' }, stat.label),
                  ),
                  h('span', { className: NS + '-db-space' }),
                  modelEl,
                ),
                h('div', { className: NS + '-dockbar-actions' },
                  h('button', { className: NS + '-db-btn primary', disabled: busy || running || !shown, onClick: () => { setRunPop(!runPop); setMenuOpen(false); setModelPop(false); } },
                    running ? (runningDry ? '◐ 演习中' : '◐ 真跑中') : '⚡ 执行',
                  ),
                  h('button', { className: NS + '-db-btn', onClick: openConsoleSafe, title: '打开管理中心' }, '管理中心 →'),
                  h('button', { className: NS + '-db-chip ' + NS + '-db-iconbtn', onClick: toggleCollapse, title: '收起为一行胶囊' }, h(ChevUp, null)),
                ),
              ),
              botMenuEl,
              runConfirmEl,
              modelMenuEl,
            ),
          );
        }

        // ============================================================
        // v0.3.8 控制台
        //
        // 设计稿：docs/mock/v038-main.html / v038-detail.html
        // 约定：
        //   · 主视图 = 概览（状态 / 目标 / 运行 / 记忆）
        //   · 详情页 = 独立视图，左列表固定 + 右详情独立滚动
        //   · 所有颜色走宿主设计令牌；正文 13px，最小 11px
        // ============================================================

        const CONSOLE_TABS = [
          ['bots', 'Bot'],
          ['runs', '运行记录'],
          ['settings', '设置'],
          ['doctor', '诊断'],
        ];

        const cpost = async (path, body) => {
          try {
            const r = await fetch('/_dsh-bot' + path, {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(body ?? {}),
            });
            return await r.json();
          } catch (e) {
            return { ok: false, message: String(e?.message || e) };
          }
        };

        const cget = async (path) => {
          const r = await fetch('/_dsh-bot' + path, {
            headers: { accept: 'application/json' },
          });
          return r.json();
        };

        /** 人话版 cron（复用 0.3.7 的纯函数） */
        const cCadenceText = (cron) => {
          if (!cron) return '不自动执行';
          const p = parseCadence(cron);
          return describeCadence(p.mode, p.hours, p.time, p.days, p.custom);
        };

        /** 金额：<1 元保留 4 位（¥0.0136），否则 2 位 */
        const cMoney = (n) =>
          Number.isFinite(n) ? (n < 1 ? '¥' + n.toFixed(4) : '¥' + n.toFixed(2)) : '¥0';

        /** 紧凑时间：今天 00:00 / 11-13 00:00 */
        const cWhen = (iso) => {
          if (!iso) return '—';
          const d = new Date(iso);
          if (!Number.isFinite(d.getTime())) return '—';
          const now = new Date();
          const hh = String(d.getHours()).padStart(2, '0');
          const mm = String(d.getMinutes()).padStart(2, '0');
          const sameDay =
            d.getFullYear() === now.getFullYear() &&
            d.getMonth() === now.getMonth() &&
            d.getDate() === now.getDate();
          if (sameDay) return '今天 ' + hh + ':' + mm;
          return String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0') + ' ' + hh + ':' + mm;
        };

        const cTriggerText = (t) =>
          t === 'goal' ? '目标轮' : t === 'schedule' ? '定时' : t === 'manual' ? '手动' : t || '—';

        /** Bot 列表行的状态点 / 徽标 */
        const cBotBadge = (b) => {
          if (b?.blocked) return { dot: 'err', tone: 'err', text: '卡住了' };
          if (b?.pendingConfirmCount > 0) return { dot: 'warn', tone: 'warn', text: '待确认' };
          if (b?.lastRunStatus === 'failed' || b?.lastRunStatus === 'budget_exceeded')
            return { dot: 'err', tone: 'err', text: statusText(b.lastRunStatus) };
          if (b?.lastRunStatus === 'success') return { dot: 'ok', tone: 'ok', text: '正常' };
          if (b?.lastRunStatus === 'partial') return { dot: 'warn', tone: 'warn', text: '部分完成' };
          return { dot: 'idle', tone: 'muted', text: '空闲' };
        };

        /**
         * 统一的 Bot 动作层（HTTP）。
         *
         * 和旧 dock 里的 act() 分开：这里只负责「动作 → 结果」，
         * 不持有 UI 状态，便于两个入口共用同一套语义。
         */
        async function runBotAction(kind, bot, extra) {
          let j;
          if (kind === 'dry') {
            j = await cpost('/dry-run', { botId: bot.id });
            if (j?.ok) {
              const st = j.value?.status;
              const blocked = (j.value?.steps || []).filter((s) => s.blocked).length;
              if (st === 'failed') {
                return { error: '演习失败：' + (j.value?.error?.message ?? '未知原因') };
              }
              return { notice: '先看看完成：' + blocked + ' 步会被拦截，未产生真实影响' };
            }
          } else if (kind === 'run') {
            j = await cpost('/run', { botId: bot.id, confirm: true });
            if (j?.ok) {
              const st = j.value?.status;
              const errMsg = j.value?.error?.message;
              if (st === 'failed' || st === 'budget_exceeded') {
                return { error: '执行失败（' + st + '）' + (errMsg ? '：' + errMsg : '') };
              }
              if (st === 'partial') {
                const blocked = (j.value?.steps || []).filter((s) => s.blocked).length;
                return { notice: '执行部分完成' + (blocked ? '，' + blocked + ' 步被跳过' : '') };
              }
              return { notice: '执行完成', value: j.value };
            }
            if (j?.code === 'PRECHECK_FAILED') return { error: j.message };
          } else if (kind === 'snapshot') {
            j = await cpost('/snapshot', { botId: bot.id });
            if (j?.ok) return { notice: '已创建快照（' + j.value.fileCount + ' 个文件）' };
          } else if (kind === 'rollback') {
            j = await cpost('/rollback', { botId: bot.id, confirm: true, snapshotId: extra?.snapshotId });
            if (j?.ok) {
              return {
                notice: '已回滚：恢复 ' + j.value.restored.length + ' 个，删除 ' + j.value.removed.length + ' 个',
              };
            }
          } else if (kind === 'goalConfirm') {
            j = await cpost('/goal/confirm', { botId: bot.id, confirm: true, note: extra?.note });
            if (j?.ok) return { notice: '已确认达成并归档，下面看看建议的下一步' };
          } else if (kind === 'goalReject') {
            j = await cpost('/goal/reject', { botId: bot.id, note: extra?.note ?? '还没做完' });
            if (j?.ok) return { notice: '已驳回，目标回到进行中' };
          } else if (kind === 'goalUnblock') {
            j = await cpost('/goal/unblock', { botId: bot.id, note: extra?.note });
            if (j?.ok) return { notice: '已解除阻塞，目标回到进行中' };
          } else if (kind === 'goalGiveup') {
            j = await cpost('/goal/giveup', { botId: bot.id, note: extra?.note });
            if (j?.ok) return { notice: '已放弃并归档' };
          } else if (kind === 'goalAccept') {
            j = await cpost('/goal/accept', { botId: bot.id, goalId: extra?.goalId ?? bot.goalId });
            if (j?.ok) return { notice: '已接受，Bot 开始守护新目标' };
          } else if (kind === 'goalDismiss') {
            j = await cpost('/goal/dismiss', { botId: bot.id });
            if (j?.ok) return { notice: '已忽略建议' };
          } else if (kind === 'goalSet') {
            j = await cpost('/goal/set', {
              botId: bot.id,
              description: extra?.description,
              goalType: extra?.goalType,
              cadence: extra?.cadence,
            });
            if (j?.ok) return { notice: '目标已设定' };
          } else if (kind === 'botCreate') {
            j = await cpost('/bot/create', {
              name: extra?.name,
              role: extra?.role,
              goal: extra?.goal,
              goalType: extra?.goalType,
              cadence: extra?.cadence,
            });
            if (j?.ok) return { notice: '已创建「' + extra?.name + '」', value: j.value };
          } else if (kind === 'botModel') {
            j = await cpost('/bot/model', {
              botId: bot.id,
              provider: extra?.provider,
              model: extra?.model,
              reasoningEffort: extra?.reasoningEffort,
            });
            if (j?.ok) return { notice: '模型已更新' };
          } else if (kind === 'clearRuns') {
            j = await cpost('/runs/clear', { botId: bot.id, confirm: true });
            if (j?.ok) return { notice: '已清空 ' + j.value.removed + ' 条运行记录' };
          } else if (kind === 'botDelete') {
            j = await cpost('/bot/delete', { botId: bot.id, confirm: true });
            if (j?.ok) return { notice: '已删除「' + bot.name + '」', deleted: true };
          } else if (kind === 'botUpdate') {
            j = await cpost('/bot/update', { botId: bot.id, ...extra });
            if (j?.ok) return { notice: '已保存', value: j.value };
          }
          if (j && !j.ok) return { error: j.message || '操作失败' };
          return {};
        }

        // ---------- 基础组件 ----------
        function CBtn({ children, kind, size, icon, onClick, disabled, title, style }) {
          const cls = [NS + '-c-btn', kind || '', size || ''].filter(Boolean).join(' ');
          return h(
            'button',
            { type: 'button', className: cls, onClick, disabled, title, style },
            icon || null,
            children || null,
          );
        }

        function CCard({ children, className, style }) {
          return h(
            'div',
            { className: NS + '-c-card' + (className ? ' ' + className : ''), style },
            children,
          );
        }

        function CCardHead({ title, count, right, children }) {
          return h(
            'div',
            { className: NS + '-c-card-head' },
            h('span', { className: NS + '-c-card-title' }, title),
            count != null ? h('span', { className: NS + '-c-card-count num' }, count) : null,
            children || null,
            right ? h('span', { className: NS + '-c-card-right' }, right) : null,
          );
        }

        function CPill({ tone, children }) {
          return h('span', { className: NS + '-c-pill ' + (tone || '') }, children);
        }

        function CLink({ children, onClick, style }) {
          return h('button', { type: 'button', className: NS + '-c-link', onClick, style }, children);
        }

        function CTabs({ tab, onTab, meta }) {
          return h(
            'div',
            { className: NS + '-c-tabs' },
            ...CONSOLE_TABS.map(([id, label]) =>
              h(
                'button',
                {
                  key: id,
                  type: 'button',
                  className: NS + '-c-tab' + (tab === id ? ' on' : ''),
                  onClick: () => onTab(id),
                },
                label,
              ),
            ),
            h('span', { className: 'grow' }),
            meta ? h('span', { className: 'meta num' }, meta) : null,
          );
        }

        function CStat({ k, v, unit, hint }) {
          return h(
            'div',
            { className: NS + '-c-stat' },
            h('div', { className: 'k' }, k),
            h('div', { className: 'v num' }, v, unit ? h('small', null, unit) : null),
            hint ? h('div', { className: 'h' }, hint) : null,
          );
        }

        // ---------- 列表 ----------
        function BotRow({ bot, selected, onClick }) {
          const bg = cBotBadge(bot);
          return h(
            'button',
            {
              type: 'button',
              className: NS + '-c-row' + (selected ? ' on' : ''),
              onClick,
            },
            h(
              'div',
              { className: 'l1' },
              h('span', { className: NS + '-c-dot ' + bg.dot }),
              h('span', { className: 'nm' }, bot.name),
              h('span', { className: 'bdg' }, h(CPill, { tone: bg.tone }, bg.text)),
            ),
            h('div', { className: 'rl' }, bot.role),
            bot.goalDescription
              ? h('div', { className: 'gl' }, '守：', h('b', null, bot.goalDescription))
              : h('div', { className: 'gl' }, '还没有目标 — 点「设目标」让他知道该守什么'),
            h(
              'div',
              { className: 'mt num' },
              bot.runCount + ' 次运行 · 上次 ' + fmtAgo(bot.lastRunAt) +
                (bot.todayCostCny ? ' · ' + cMoney(bot.todayCostCny) : ''),
            ),
          );
        }

        function BotRail({ bots, selectedId, onSelect, onCreate, fill }) {
          return h(
            'aside',
            { className: NS + '-c-card ' + NS + '-c-rail' + (fill ? ' fill' : '') },
            h(
              'div',
              { className: NS + '-c-rail-head' },
              h('span', { className: 't' }, 'Bot'),
              h('span', { className: 'n num' }, String(bots.length)),
              h(
                'span',
                { className: 'r' },
                h(CBtn, {
                  kind: 'ghost',
                  size: 'icon',
                  icon: h(
                    'svg',
                    { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
                    h('path', {
                      d: 'M12 5v14M5 12h14',
                      stroke: 'currentColor',
                      strokeWidth: 1.7,
                      strokeLinecap: 'round',
                    }),
                  ),
                  onClick: onCreate,
                  title: '新建 Bot',
                }),
              ),
            ),
            h(
              'div',
              { className: NS + '-c-rail-rows' + (fill ? ' fill' : '') },
              bots.length === 0
                ? h(
                    'div',
                    { className: NS + '-c-empty', style: { margin: '4px 4px 8px' } },
                    h('p', null, '还没有 Bot。创建一个，他会带着目标、记忆和工作区常驻。'),
                    h(CBtn, { size: 'sm', onClick: onCreate }, '新建 Bot'),
                  )
                : bots.map((b) =>
                    h(BotRow, {
                      key: b.id,
                      bot: b,
                      selected: b.id === selectedId,
                      onClick: () => onSelect(b.id),
                    }),
                  ),
            ),
            h(
              'div',
              { className: NS + '-c-rail-foot' },
              h(CLink, { onClick: onCreate }, '＋ 新建 Bot'),
              h(
                'span',
                { className: NS + '-c-card-count' },
                bots.reduce((n, b) => n + (b.pendingConfirmCount || 0) + (b.blocked ? 1 : 0), 0) + ' 个待处理',
              ),
            ),
          );
        }

        // ---------- 状态摘要 ----------
        function BotSituation({ bot, detail, act, busy, onForm }) {
          if (!detail) {
            return h(
              'div',
              { className: NS + '-c-sit', style: { marginBottom: 12 } },
              h('span', { className: NS + '-c-dot idle', style: { width: 8, height: 8 } }),
              h('div', { className: 'tx' }, h('b', null, '正在读取这个 Bot…')),
            );
          }
          const goal = detail?.goal;
          const runs = detail?.runs ?? [];
          const last = runs[0];
          const proposals = detail?.proposals ?? [];

          const box = (tone, title, sub, actions) =>
            h(
              'div',
              { className: NS + '-c-sit ' + (tone || ''), style: { marginBottom: 12 } },
              h('span', {
                className:
                  NS + '-c-dot ' +
                  (tone === 'err' ? 'err' : tone === 'warn' || tone === 'brand' ? 'warn' : 'ok'),
                style: { width: 8, height: 8 },
              }),
              h(
                'div',
                { className: 'tx' },
                h('b', null, title),
                sub ? h('span', null, sub) : null,
              ),
              actions
                ? h('div', { style: { display: 'flex', gap: 6, flexShrink: 0 } }, ...actions)
                : null,
            );

          if (proposals.length > 0) {
            return box(
              'brand',
              '他建议了 ' + proposals.length + ' 个下一步',
              proposals[0]?.description ?? '接受后他会开始守护新目标',
              [
                h(CBtn, {
                  key: 'a',
                  size: 'sm',
                  kind: 'primary',
                  disabled: busy,
                  onClick: () => act('goalAccept', bot, { goalId: proposals[0]?.id }),
                }, '接受'),
                h(CBtn, {
                  key: 'd',
                  size: 'sm',
                  disabled: busy,
                  onClick: () => act('goalDismiss', bot),
                }, '忽略'),
              ],
            );
          }
          if (goal?.status === 'pending_confirmation') {
            return box(
              'warn',
              '上一轮认为目标达成了，等你确认',
              goal.progress || goal.description,
              [
                h(CBtn, {
                  key: 'c',
                  size: 'sm',
                  kind: 'primary',
                  disabled: busy,
                  onClick: () => act('goalConfirm', bot),
                }, '确认达成'),
                h(CBtn, {
                  key: 'r',
                  size: 'sm',
                  disabled: busy,
                  onClick: () => act('goalReject', bot),
                }, '驳回'),
              ],
            );
          }
          if (goal?.status === 'blocked') {
            return box(
              'err',
              '他卡住了',
              goal.progress || '处理完外部条件后，点「已处理好」继续',
              [
                h(CBtn, {
                  key: 'u',
                  size: 'sm',
                  kind: 'primary',
                  disabled: busy,
                  onClick: () => act('goalUnblock', bot),
                }, '已处理好'),
                h(CBtn, {
                  key: 'g',
                  size: 'sm',
                  disabled: busy,
                  onClick: () => onForm({ kind: 'giveup', botId: bot.id, botName: bot.name }),
                }, '放弃'),
              ],
            );
          }
          if (last?.status === 'failed' || last?.status === 'budget_exceeded') {
            return box(
              'err',
              last.status === 'budget_exceeded' ? '预算用完了' : '上次执行失败了',
              last.error?.message ?? '没有记录到原因',
              [
                h(CBtn, {
                  key: 'd',
                  size: 'sm',
                  disabled: busy,
                  onClick: () => act('dry', bot),
                }, '先看看'),
                h(CBtn, {
                  key: 'r',
                  size: 'sm',
                  kind: 'primary',
                  disabled: busy,
                  onClick: () => act('run', bot),
                }, '重跑'),
              ],
            );
          }
          if (!goal) {
            return box(
              'warn',
              '他还没有目标，不知道该守什么',
              '可以手动执行，但不会被自动推进',
              [
                h(CBtn, {
                  key: 's',
                  size: 'sm',
                  kind: 'primary',
                  disabled: busy,
                  onClick: () => onForm({ kind: 'goal', botId: bot.id, botName: bot.name }),
                }, '设目标'),
              ],
            );
          }
          if (goal.status === 'achieved' || goal.status === 'abandoned') {
            return box(
              'ok',
              goal.status === 'achieved' ? '目标已达成' : '目标已放弃',
              goal.progress || '可以在下面「目标」里设一个新的',
              null,
            );
          }
          return box(
            'ok',
            last ? '一切都好：上一轮' + statusText(last.status) + '，用了 ' + fmtCost(last.usage) : '还没有运行过',
            last
              ? '上次 ' + cWhen(last.startedAt) + ' · 周期 ' + cCadenceText(goal.cadence)
              : '点「执行」跑一次，或者等自动周期',
            null,
          );
        }

        // ---------- 目标卡 ----------
        function BotGoalCard({ detail, busy, onForm, bot }) {
          if (!detail) {
            return h(
              CCard,
              null,
              h(CCardHead, { title: '目标' }),
              h(
                'div',
                { className: NS + '-c-card-body' },
                h('div', { className: NS + '-c-empty' }, h('p', null, '正在读取…')),
              ),
            );
          }
          const goal = detail?.goal;
          if (!goal) {
            return h(
              CCard,
              null,
              h(CCardHead, { title: '目标' }),
              h(
                'div',
                { className: NS + '-c-card-body' },
                h(
                  'div',
                  { className: NS + '-c-empty' },
                  h('p', null, '还没有目标。目标是 Bot 的「守则」：写清要盯什么、多久看一次。'),
                  h(CBtn, {
                    size: 'sm',
                    kind: 'primary',
                    disabled: busy,
                    onClick: () => onForm({ kind: 'goal', botId: bot.id, botName: bot.name }),
                  }, '设目标'),
                ),
              ),
            );
          }
          const tone =
            goal.status === 'pending_confirmation' ? 'warn' :
            goal.status === 'blocked' ? 'err' :
            goal.status === 'achieved' ? 'ok' :
            goal.status === 'abandoned' ? 'muted' : 'brand';
          return h(
            CCard,
            null,
            h(CCardHead, {
              title: '目标',
              right: h(CLink, {
                onClick: () => onForm({ kind: 'goal', botId: bot.id, botName: bot.name }),
              }, '调整'),
            }),
            h(
              'div',
              { className: NS + '-c-card-body' },
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 } },
                h(CPill, { tone }, goalStatusText(goal.status)),
                goal.type === 'standing' ? h(CPill, { tone: 'muted' }, '常驻') : null,
              ),
              h('div', { className: NS + '-c-goal' }, goal.description),
              goal.progress
                ? h('div', { style: { marginTop: 8, fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)' } }, goal.progress)
                : null,
              h(
                'div',
                { className: NS + '-c-chips' },
                h('span', { className: NS + '-c-chip' }, '执行周期 ', h('b', null, cCadenceText(goal.cadence))),
                goal.lastFiredAt ? h('span', { className: NS + '-c-chip' }, '上次自动 ', h('b', null, fmtAgo(goal.lastFiredAt))) : null,
              ),
            ),
          );
        }

        // ---------- 运行卡 ----------
        function BotRunsCard({ runs, preview, onAll, onOpen, botName }) {
          const [page, setPage] = React.useState(0);
          const pageSize = 5;
          const total = runs.length;
          const pages = Math.max(1, Math.ceil(total / pageSize));
          const safePage = Math.min(page, pages - 1);
          const view = preview
            ? runs.slice(0, 4)
            : runs.slice(safePage * pageSize, safePage * pageSize + pageSize);
          return h(
            CCard,
            null,
            h(CCardHead, {
              title: '最近运行',
              count: '共 ' + total + ' 条',
              right: preview
                ? h(CLink, { onClick: onAll }, '全部 →')
                : h(CBtn, { size: 'sm', onClick: onAll }, '全部'),
            }),
            h(
              'div',
              { className: NS + '-c-card-body tight' },
              total === 0
                ? h(
                    'div',
                    { className: NS + '-c-empty' },
                    h('p', null, '还没有运行记录。点右上角「执行」跑一次。'),
                  )
                : [
                    ...view.map((r) =>
                      h(
                        'div',
                        {
                          key: r.id,
                          className: NS + '-c-run',
                          style: { cursor: onOpen ? 'pointer' : 'default' },
                          onClick: onOpen ? () => onOpen(botName ? { ...r, botName } : r) : undefined,
                        },
                        h('span', {
                          className:
                            NS + '-c-dot ' +
                            (r.status === 'success' ? 'ok' : r.status === 'failed' ? 'err' : 'warn'),
                        }),
                        h('span', { className: 'st' + (r.status === 'success' ? '' : ' err') }, statusText(r.status)),
                        h('span', { className: 'wh num' }, cWhen(r.startedAt) + ' · ' + cTriggerText(r.trigger)),
                        h('span', { className: 'cs num' }, fmtCost(r.usage)),
                        h('span', { className: 'id' }, '#' + String(r.id).slice(0, 12)),
                        h('span', { className: 'cv' }, h(IconChevron, { size: 12 })),
                      ),
                    ),
                    !preview && total > pageSize
                      ? h(
                          'div',
                          {
                            key: 'pager',
                            style: {
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              marginTop: 8,
                              paddingTop: 10,
                              borderTop: '1px solid var(--dsw-alias-border-l1)',
                            },
                          },
                          h('span', { className: NS + '-c-card-count num' }, '第 ' + (safePage + 1) + ' / ' + pages + ' 页'),
                          h(
                            'div',
                            { style: { display: 'flex', gap: 6 } },
                            h(CBtn, { size: 'sm', disabled: safePage === 0, onClick: () => setPage(safePage - 1) }, '上一页'),
                            h(CBtn, { size: 'sm', disabled: safePage >= pages - 1, onClick: () => setPage(safePage + 1) }, '下一页'),
                          ),
                        )
                      : null,
                  ],
            ),
          );
        }

        // ---------- 记忆卡 ----------
        function BotMemoryCard({ semantic, limit, onAll }) {
          const facts = semantic?.facts ?? [];
          const prefs = semantic?.preferences ?? [];
          const rows = [
            ...facts.map((f) => ({ kind: '事实', text: f })),
            ...prefs.map((p) => ({ kind: '偏好', text: p })),
          ];
          const view = limit ? rows.slice(0, limit) : rows;
          return h(
            CCard,
            null,
            h(CCardHead, {
              title: '记忆',
              count: rows.length ? '共 ' + rows.length + ' 条' : '空',
              right: onAll && rows.length > view.length ? h(CLink, { onClick: onAll }, '全部 →') : null,
            }),
            h(
              'div',
              { className: NS + '-c-card-body tight' },
              view.length === 0
                ? h(
                    'div',
                    { className: NS + '-c-empty' },
                    h('p', null, '还没有沉淀下来的事实。跑几轮后，他会记住稳定的结论。'),
                  )
                : view.map((m, i) =>
                    h(
                      'div',
                      { key: i, className: NS + '-c-mem' },
                      h('span', { className: NS + '-c-pill kd' }, m.kind),
                      h('div', { style: { minWidth: 0 } }, h('p', null, m.text)),
                    ),
                  ),
            ),
          );
        }

        // ---------- 概览 ----------
        function BotOverview({ bot, detail, act, busy, onDetail, onForm, onOpenRun }) {
          const badge = cBotBadge(bot);
          return h(
            'div',
            null,
            h(
              'div',
              { className: NS + '-c-dhead' },
              h(
                'div',
                null,
                h(
                  'div',
                  { className: NS + '-c-dname' },
                  bot.name,
                  h(CPill, { tone: badge.tone }, badge.text),
                ),
                h('div', { className: NS + '-c-drole' }, bot.role),
              ),
              h(
                'div',
                { className: NS + '-c-dactions' },
                h(
                  CBtn,
                  {
                    kind: 'primary',
                    icon: h(IconRun, { size: 13 }),
                    disabled: busy,
                    onClick: () => act('run', bot),
                  },
                  '执行',
                ),
                h(CBtn, { onClick: onDetail }, '查看详情'),
              ),
            ),
            h(BotSituation, { bot, detail, act, busy, onForm }),
            h(BotGoalCard, { bot, detail, busy, onForm }),
            h(BotRunsCard, { runs: detail?.runs ?? [], preview: true, onAll: onDetail, onOpen: onOpenRun, botName: bot.name }),
            h(BotMemoryCard, { semantic: detail?.semantic, limit: 2 }),
          );
        }

        // ---------- 通知卡（v0.3.9 刀 2：单 Bot 覆盖，清空即恢复跟随全局） ----------
        function BotNotifyCard({ bot, busy, onChanged }) {
          const [state, setState] = React.useState(null); // { effective, global, overrides }
          const [err, setErr] = React.useState('');
          const [saving, setSaving] = React.useState(false);
          const botId = bot.id;

          const load = React.useCallback(async () => {
            try {
              const j = await cget('/settings?botId=' + encodeURIComponent(botId));
              if (!j?.ok) throw new Error(j?.message || '读取失败');
              setState(j.value ?? null);
              setErr('');
            } catch (e) {
              setErr(String(e?.message ?? e));
            }
          }, [botId]);

          React.useEffect(() => { void load(); }, [load]);

          /** 保存覆盖项；clear 里的键会从单 Bot 文件删除 → 恢复跟随全局 */
          const save = async (patch, clear) => {
            setSaving(true);
            try {
              const j = await cpost('/settings', { botId, settings: patch ?? {}, clear: clear ?? [] });
              if (!j?.ok) throw new Error(j?.message || '保存失败');
              await load();
              onChanged?.();
            } catch (e) {
              setErr(String(e?.message ?? e));
            } finally {
              setSaving(false);
            }
          };

          if (err && !state) {
            return h(CCard, null,
              h(CCardHead, { title: '通知' }),
              h('div', { className: NS + '-c-card-body' }, h('div', { className: NS + '-c-err' }, err)));
          }
          if (!state) {
            return h(CCard, null,
              h(CCardHead, { title: '通知' }),
              h('div', { className: NS + '-c-card-body' }, h('div', { className: NS + '-c-empty' }, h('p', null, '正在读取通知设置…'))));
          }

          const eff = state.effective ?? {};
          const glob = state.global ?? {};
          const overrides = state.overrides ?? [];
          const has = (k) => overrides.indexOf(k) >= 0;
          const disabled = busy || saving;

          /** 一行：左侧标签 + 「跟随全局 / 已覆盖」，右侧开关或时段 + 恢复按钮 */
          const row = (key, label, hint, globalText, control) =>
            h(CRow, {
              label,
              hint: has(key) ? '已覆盖全局 · ' + hint : '跟随全局：' + globalText,
            }, h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
              control,
              has(key)
                ? h(CLink, { onClick: () => void save({}, [key]) }, '恢复跟随')
                : null,
            ));

          const quiet = eff.quietHours;

          return h(CCard, null,
            h(CCardHead, {
              title: '通知',
              right: h('span', { className: NS + '-c-card-count' }, '仅对这个 Bot 生效'),
            }),
            h('div', { className: NS + '-c-card-body' },
              row('notifySystem', '运行完成后系统通知', '关掉后这个 Bot 不再弹桌面通知',
                glob.notifySystem === false ? '关' : '开',
                h(CSwitch, {
                  value: eff.notifySystem !== false,
                  disabled,
                  onChange: (v) => void save({ notifySystem: v }, []),
                })),

              row('notifyOnlyOnDecision', '仅异常时打扰', '自动轮次只在失败/部分成功时提醒',
                glob.notifyOnlyOnDecision !== false ? '开' : '关',
                h(CSwitch, {
                  value: eff.notifyOnlyOnDecision !== false,
                  disabled,
                  onChange: (v) => void save({ notifyOnlyOnDecision: v }, []),
                })),

              h(CRow, {
                label: '免打扰时段',
                hint: has('quietHours')
                  ? '已覆盖全局 · ' + (quiet ? quiet.start + ' – ' + quiet.end : '不启用')
                  : '跟随全局：' + (glob.quietHours ? glob.quietHours.start + ' – ' + glob.quietHours.end : '不启用'),
              }, h('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                quiet
                  ? h('div', { style: { display: 'flex', gap: 6 } },
                      h('input', {
                        type: 'time', className: NS + '-c-input', style: { width: 136 },
                        value: quiet.start, disabled,
                        onChange: (e) => void save({ quietHours: { start: e.target.value || '22:00', end: quiet.end } }, []),
                      }),
                      h('input', {
                        type: 'time', className: NS + '-c-input', style: { width: 136 },
                        value: quiet.end, disabled,
                        onChange: (e) => void save({ quietHours: { start: quiet.start, end: e.target.value || '08:00' } }, []),
                      }),
                    )
                  : null,
                h(CSwitch, {
                  value: !!quiet,
                  disabled,
                  onChange: (v) => void save({ quietHours: v ? { start: '22:00', end: '08:00' } : null }, []),
                }),
                has('quietHours') ? h(CLink, { onClick: () => void save({}, ['quietHours']) }, '恢复跟随') : null,
              )),

              err ? h('div', { className: NS + '-c-err', style: { marginTop: 8 } }, err) : null,
              h('div', { className: NS + '-c-hint-block' },
                '只有通知相关项可按 Bot 覆盖；其余设置（预算 / 模型 / 快照）始终针对单个 Bot。'),
            ),
          );
        }


        // ---------- 配置卡（可编辑） ----------
        function BotConfigCard({ bot, detail, busy, onSave }) {
          const [editing, setEditing] = React.useState(false);
          const [name, setName] = React.useState('');
          const [role, setRole] = React.useState('');
          const [note, setNote] = React.useState('');
          const [mode, setMode] = React.useState('none');
          const [hours, setHours] = React.useState(12);
          const [time, setTime] = React.useState('09:00');
          const [days, setDays] = React.useState([1]);
          const [custom, setCustom] = React.useState('');
          const [provider, setProvider] = React.useState('');
          const [modelName, setModelName] = React.useState('');
          const [daily, setDaily] = React.useState('5');
          const [monthly, setMonthly] = React.useState('100');
          const [onExceed, setOnExceed] = React.useState('stop');
          const [providers, setProviders] = React.useState([]);
          const [err, setErr] = React.useState('');

          const openEdit = () => {
            setName(bot.name ?? '');
            setRole(bot.role ?? '');
            setNote(bot.systemPromptExtra ?? '');
            const p = parseCadence(detail?.goal?.cadence);
            setMode(p.mode);
            setHours(p.hours);
            setTime(p.time);
            setDays(p.days);
            setCustom(p.custom);
            setProvider(bot.model?.provider ?? '');
            setModelName(bot.model?.model ?? '');
            setDaily(String(bot.budget?.dailyCny ?? 5));
            setMonthly(String(bot.budget?.monthlyCny ?? 100));
            setOnExceed(bot.budget?.onExceed ?? 'stop');
            setErr('');
            setEditing(true);
            void (async () => {
              try {
                const j = await cget('/models');
                if (j?.ok) setProviders(j.value?.available ?? []);
              } catch {
                /* 拿不到就手填 */
              }
            })();
          };

          const save = async () => {
            if (!name.trim() || !role.trim()) {
              setErr('名称和职责不能为空');
              return;
            }
            const d = Number(daily);
            const m = Number(monthly);
            if (!Number.isFinite(d) || d <= 0 || d > 1000) {
              setErr('每日预算需要是 0–1000 之间的数字');
              return;
            }
            if (!Number.isFinite(m) || m < d) {
              setErr('每月预算不能小于每日预算');
              return;
            }
            const cadence = buildCadence(mode, hours, time, days, custom);
            const res = await onSave({
              name: name.trim(),
              role: role.trim(),
              systemPromptExtra: note,
              cadence,
              budget: { dailyCny: d, monthlyCny: m, onExceed },
              // v0.3.9 刀 3：模型并入同一 POST，避免「名字改了模型没改」的半失败
              model: { provider, model: modelName },
            });
            if (res?.error) {
              setErr(res.error);
              return;
            }
            setEditing(false);
          };

          if (!editing) {
            const b = detail?.budget;
            const pct = b?.dailyLimit ? Math.min(100, (b.today / b.dailyLimit) * 100) : 0;
            return h(
              CCard,
              null,
              h(CCardHead, {
                title: '配置',
                right: h(CBtn, { size: 'sm', onClick: openEdit, disabled: busy }, '编辑'),
              }),
              h(
                'div',
                { className: NS + '-c-card-body' },
                h(
                  'div',
                  { className: NS + '-c-kv' },
                  h('span', { className: 'k' }, '名称'),
                  h('span', { className: 'v' }, bot.name),
                ),
                h(
                  'div',
                  { className: NS + '-c-kv' },
                  h('span', { className: 'k' }, '模型'),
                  h('span', { className: 'v' }, (bot.model?.provider ?? '—') + ' / ' + (bot.model?.model ?? '—')),
                ),
                h(
                  'div',
                  { className: NS + '-c-kv' },
                  h('span', { className: 'k' }, '执行周期'),
                  h('span', { className: 'v' }, cCadenceText(detail?.goal?.cadence)),
                ),
                h(
                  'div',
                  { className: NS + '-c-kv' },
                  h('span', { className: 'k' }, '预算'),
                  h(
                    'span',
                    { className: 'v' },
                    '每日 ' + fmtCny(bot.budget?.dailyCny) + ' · 每月 ' + fmtCny(bot.budget?.monthlyCny) +
                      ' · ' + (bot.budget?.onExceed === 'stop' ? '超限停止' : '超限降级'),
                  ),
                ),
                h(
                  'div',
                  { className: NS + '-c-kv' },
                  h('span', { className: 'k' }, '今日已用'),
                  h(
                    'span',
                    { className: 'v num' },
                    cMoney(b?.today ?? 0) + ' / ' + cMoney(b?.dailyLimit ?? 0) + '（' + pct.toFixed(1) + '%）',
                  ),
                ),
                h(
                  'div',
                  { className: NS + '-c-kv' },
                  h('span', { className: 'k' }, '工作区'),
                  h('span', { className: 'v mono', title: bot.workspace }, bot.workspace),
                ),
              ),
            );
          }

          const modelsFor = providers.find((x) => x?.provider === provider)?.models ?? [];
          return h(
            CCard,
            null,
            h(CCardHead, {
              title: '配置',
              right: h(CPill, { tone: 'brand' }, '编辑中'),
            }),
            h(
              'div',
              { className: NS + '-c-card-body' },
              h(
                'div',
                { className: NS + '-c-form' },
                h(
                  'div',
                  { className: NS + '-c-field' },
                  h('label', null, '名称'),
                  h('input', {
                    className: NS + '-c-input',
                    value: name,
                    onChange: (e) => setName(e.target.value),
                    placeholder: 'Bot 名称',
                  }),
                ),
                h(
                  'div',
                  { className: NS + '-c-field' },
                  h('label', null, '模型'),
                  h(
                    'div',
                    { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
                    h(
                      'select',
                      {
                        className: NS + '-c-input',
                        value: provider,
                        onChange: (e) => {
                          setProvider(e.target.value);
                          const first = providers.find((x) => x?.provider === e.target.value)?.models?.[0];
                          if (first) setModelName(first);
                        },
                      },
                      h('option', { value: provider }, provider || '选择 provider'),
                      ...providers.filter((x) => x?.provider !== provider).map((x) =>
                        h('option', { key: x.provider, value: x.provider }, x.provider),
                      ),
                    ),
                    h(
                      'select',
                      {
                        className: NS + '-c-input',
                        value: modelName,
                        onChange: (e) => setModelName(e.target.value),
                      },
                      h('option', { value: modelName }, modelName || '选择模型'),
                      ...modelsFor.filter((m) => m !== modelName).map((m) =>
                        h('option', { key: m, value: m }, m),
                      ),
                    ),
                  ),
                ),
                h(
                  'div',
                  { className: NS + '-c-field wide' },
                  h('label', null, '职责'),
                  h('textarea', {
                    className: NS + '-c-input',
                    rows: 2,
                    value: role,
                    onChange: (e) => setRole(e.target.value),
                    placeholder: '一句话，决定他该怎么干活',
                  }),
                ),
                h(
                  'div',
                  { className: NS + '-c-field wide' },
                  h('label', null, '附加说明（会写进系统提示）'),
                  h('textarea', {
                    className: NS + '-c-input',
                    rows: 3,
                    value: note,
                    onChange: (e) => setNote(e.target.value),
                    placeholder: '可选。稳定的事实、数据源、禁做事项。',
                  }),
                ),
                h(
                  'div',
                  { className: NS + '-c-field wide' },
                  h('label', null, '执行周期'),
                  h(
                    'div',
                    { className: NS + '-c-seg' },
                    ...[
                      ['hours', '每 N 小时'],
                      ['daily', '每天'],
                      ['weekly', '每周'],
                      ['none', '不自动跑'],
                    ].map(([m, label]) =>
                      h(
                        'button',
                        {
                          key: m,
                          type: 'button',
                          className: mode === m ? 'on' : '',
                          onClick: () => setMode(m),
                        },
                        label,
                      ),
                    ),
                  ),
                  mode === 'hours'
                    ? h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 } },
                        h(CBtn, { size: 'sm', onClick: () => setHours(Math.max(1, hours - 1)) }, '−'),
                        h('span', { className: NS + '-c-card-count num', style: { minWidth: 64, textAlign: 'center' } }, '每 ' + hours + ' 小时'),
                        h(CBtn, { size: 'sm', onClick: () => setHours(Math.min(24, hours + 1)) }, '＋'),
                        h('span', { className: NS + '-c-card-count' }, '整点触发'),
                      )
                    : null,
                  mode === 'daily' || mode === 'weekly'
                    ? h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6, flexWrap: 'wrap' } },
                        h('input', {
                          type: 'time',
                          className: NS + '-c-input',
                          style: { width: 110 },
                          value: time,
                          onChange: (e) => setTime(e.target.value || '09:00'),
                        }),
                        mode === 'weekly'
                          ? h(
                              'div',
                              { style: { display: 'flex', gap: 4 } },
                              ...[
                                [1, '一'], [2, '二'], [3, '三'], [4, '四'], [5, '五'], [6, '六'], [0, '日'],
                              ].map(([d, label]) =>
                                h(
                                  'button',
                                  {
                                    key: d,
                                    type: 'button',
                                    className: NS + '-c-btn sm' + (days.includes(d) ? ' primary' : ' ghost'),
                                    onClick: () =>
                                      setDays((prev) =>
                                        prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
                                      ),
                                  },
                                  '周' + label,
                                ),
                              ),
                            )
                          : null,
                      )
                    : null,
                  h('span', { className: NS + '-c-card-count', style: { marginTop: 6 } }, '按宿主机时区触发'),
                ),
                h(
                  'div',
                  { className: NS + '-c-field' },
                  h('label', null, '每日预算上限（¥）'),
                  h('input', {
                    className: NS + '-c-input',
                    type: 'number',
                    min: 0.01,
                    max: 1000,
                    step: 0.5,
                    value: daily,
                    onChange: (e) => setDaily(e.target.value),
                  }),
                ),
                h(
                  'div',
                  { className: NS + '-c-field' },
                  h('label', null, '每月预算上限（¥）'),
                  h('input', {
                    className: NS + '-c-input',
                    type: 'number',
                    min: 0.01,
                    step: 1,
                    value: monthly,
                    onChange: (e) => setMonthly(e.target.value),
                  }),
                ),
                h(
                  'div',
                  { className: NS + '-c-field' },
                  h('label', null, '超限行为'),
                  h(
                    'select',
                    {
                      className: NS + '-c-input',
                      value: onExceed,
                      onChange: (e) => setOnExceed(e.target.value),
                    },
                    h('option', { value: 'stop' }, '停止运行'),
                    h('option', { value: 'downgrade' }, '降级到更便宜的模型'),
                  ),
                ),
              ),
              err ? h('div', { style: { marginTop: 10, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, err) : null,
              h(
                'div',
                { className: NS + '-c-form-foot' },
                h(CBtn, { kind: 'ghost', onClick: () => setEditing(false), disabled: busy }, '取消'),
                h(CBtn, { kind: 'primary', onClick: save, disabled: busy }, busy ? '保存中…' : '保存'),
              ),
            ),
          );
        }

        // ---------- 例行流程（只读，0.3.8 降级） ----------
        // YAML 是开发者词汇；创建走对话（routine_save 工具），面板只读 + 删除。
        function BotRoutinesCard({ bot, routines, busy, onChanged }) {
          const [confirmId, setConfirmId] = React.useState('');
          const [err, setErr] = React.useState('');
          const list = routines ?? [];
          if (list.length === 0) return null;

          const remove = async (r) => {
            if (confirmId !== r.id) {
              setConfirmId(r.id);
              return;
            }
            setConfirmId('');
            try {
              const j = await cpost('/routines/remove', { botId: bot.id, routineId: r.id });
              if (!j?.ok) throw new Error(j?.message || '删除失败');
              onChanged?.();
            } catch (e) {
              setErr(String(e?.message ?? e));
            }
          };

          const triggerText = (t) => {
            const tr = t?.triggers?.[0];
            if (!tr) return '手动触发';
            if (tr.type === 'cron') return '定时 · ' + cCadenceText(tr.expression);
            return '手动触发';
          };

          return h(
            CCard,
            null,
            h(CCardHead, {
              title: '例行流程',
              count: String(list.length),
            }),
            h(
              'div',
              { className: NS + '-c-card-body tight' },
              h(
                'div',
                { className: NS + '-c-empty', style: { marginBottom: 8 } },
                h('p', null, '例行流程是「每次都一模一样的固定步骤」（区别于目标的随机应变）。想加一个：直接在对话里对他说，例如「每周一早上整理下载目录，建成流程」。'),
              ),
              list.map((r) =>
                h(
                  'div',
                  { key: r.id, className: NS + '-c-mem', style: { alignItems: 'center' } },
                  h(
                    'div',
                    { style: { flex: 1, minWidth: 0 } },
                    h('p', null, r.name),
                    h('time', null, (r.description ? r.description + ' · ' : '') + triggerText(r) + ' · ' + r.stepCount + ' 步'),
                  ),
                  h(CBtn, {
                    size: 'sm',
                    kind: 'danger',
                    onClick: () => remove(r),
                    disabled: busy,
                  }, confirmId === r.id ? '确认删除？' : '删除'),
                ),
              ),
              err ? h('div', { style: { marginTop: 8, fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, err) : null,
            ),
          );
        }

        // ---------- 快照与危险区 ----------
        // ⭐ 0.3.8：按「文件证据」显示。抓取类 Bot 的快照全是 0 个文件，
        //   整卡展示只会让人困惑（截图反馈）；只要出现过非空快照（含
        //   用户后来改了任务、开始写文件），卡片自动恢复完整形态。
        function BotSnapshotsCard({ bot, detail, busy, act }) {
          const [confirmRollback, setConfirmRollback] = React.useState('');
          const [confirmDelete, setConfirmDelete] = React.useState(false);
          const snaps = detail?.snapshots ?? [];
          const usage = detail?.snapshotUsage;
          const fileSnapCount = snaps.filter((s) => (s.fileCount ?? 0) > 0).length;
          const everTouchedFiles = fileSnapCount > 0;
          if (!everTouchedFiles) {
            return h(
              CCard,
              null,
              h(CCardHead, { title: '快照与回滚', right: h(CPill, { tone: 'muted' }, '未启用') }),
              h(
                'div',
                { className: NS + '-c-card-body' },
                h('div', { className: NS + '-c-empty' }, h('p', null, '这个 Bot 到目前没有写过任何文件，快照与回滚用不上。等它开始产出或修改文件后，这里会自动出现回滚能力。')),
                h(
                  'div',
                  { className: NS + '-c-danger' },
                  h('span', { className: 'lb' }, '危险操作 · 不可恢复'),
                  h(
                    CBtn,
                    {
                      size: 'sm',
                      kind: 'danger',
                      disabled: busy,
                      onClick: () => {
                        if (!confirmDelete) {
                          setConfirmDelete(true);
                          return;
                        }
                        setConfirmDelete(false);
                        act('botDelete', bot);
                      },
                    },
                    confirmDelete ? '确认删除？不可恢复' : '删除这个 Bot',
                  ),
                ),
              ),
            );
          }
          return h(
            CCard,
            null,
            h(CCardHead, {
              title: '快照与回滚',
              count: usage ? usage.count + ' 个快照 · ' + Math.round((usage.bytes || 0) / 1024) + ' KB' : String(snaps.length) + ' 个快照',
              right: h(CBtn, { size: 'sm', disabled: busy, onClick: () => act('snapshot', bot) }, '打快照'),
            }),
            h(
              'div',
              { className: NS + '-c-card-body tight' },
              snaps.length === 0
                ? h('div', { className: NS + '-c-empty' }, h('p', null, '还没有快照。真实执行前会自动打一个；也可以现在手动打一个。'))
                : snaps.filter((s) => (s.fileCount ?? 0) > 0).slice(0, 8).map((s) =>
                    h(
                      'div',
                      { key: s.id, className: NS + '-c-run', style: { gridTemplateColumns: '6px minmax(0,1fr) auto auto' } },
                      h('span', { className: NS + '-c-dot ok' }),
                      h(
                        'span',
                        { style: { color: 'var(--dsw-alias-label-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                        (s.note || (s.runId ? '运行前自动快照' : '手动快照')) + ' · ' + cWhen(s.createdAt),
                      ),
                      h('span', { className: 'id' }, s.fileCount + ' 个文件 · ' + Math.round((s.totalBytes || 0) / 1024) + ' KB'),
                      h(
                        CBtn,
                        {
                          size: 'sm',
                          kind: confirmRollback === s.id ? 'danger' : undefined,
                          disabled: busy,
                          onClick: () => {
                            if (confirmRollback !== s.id) {
                              setConfirmRollback(s.id);
                              return;
                            }
                            setConfirmRollback('');
                            act('rollback', bot, { snapshotId: s.id });
                          },
                        },
                        confirmRollback === s.id ? '确认回滚？' : '回滚',
                      ),
                    ),
                  ),
              h(
                'div',
                { className: NS + '-c-danger' },
                h('span', { className: 'lb' }, '危险操作 · 不可恢复'),
                h(
                  CBtn,
                  {
                    size: 'sm',
                    kind: 'danger',
                    disabled: busy,
                    onClick: () => {
                      if (!confirmDelete) {
                        setConfirmDelete(true);
                        return;
                      }
                      setConfirmDelete(false);
                      act('botDelete', bot);
                    },
                  },
                  confirmDelete ? '确认删除？不可恢复' : '删除这个 Bot',
                ),
              ),
            ),
          );
        }

        // ---------- 详情页 ----------
        function BotDetailPane({ bot, detail, act, busy, onBack, onForm, onSaveConfig, onChanged, onAllRuns, onOpenRun }) {
          const badge = cBotBadge(bot);
          // 列表摘要不含模型 / 预算 / 工作区；配置卡必须吃完整 identity
          const full = detail?.bot ?? bot;
          return h(
            'section',
            { className: NS + '-c-pane' },
            h(
              'header',
              { className: NS + '-c-pane-head' },
              h(
                'div',
                { className: 'row' },
                h('button', { type: 'button', className: NS + '-c-back', onClick: onBack }, '← 概览'),
                h('span', { className: NS + '-c-dname' }, bot.name),
                h(CPill, { tone: badge.tone }, badge.text),
                h(
                  'div',
                  { className: NS + '-c-dactions', style: { marginLeft: 'auto' } },
                  h(
                    CBtn,
                    {
                      kind: 'primary',
                      disabled: busy,
                      icon: h(IconRun, { size: 13 }),
                      onClick: () => act('run', bot),
                    },
                    '执行',
                  ),
                ),
              ),
              h('div', { className: NS + '-c-drole' }, bot.role),
            ),
            h(BotSituation, { bot, detail, act, busy, onForm }),
            h(BotGoalCard, { bot, detail, busy, onForm }),
            h(BotRunsCard, { runs: detail?.runs ?? [], preview: false, onAll: onAllRuns, onOpen: onOpenRun, botName: bot.name }),
            h(BotMemoryCard, { semantic: detail?.semantic }),
            h(BotRoutinesCard, { bot, routines: detail?.routines ?? [], busy, onChanged }),
            h(BotConfigCard, { bot: full, detail, busy, onSave: onSaveConfig }),
            h(BotNotifyCard, { bot: full, busy, onChanged }),
            h(BotSnapshotsCard, { bot: full, detail, busy, act }),
          );
        }

        // ---------- 运行记录 tab ----------
        function ConsoleRuns({ bots, busy, onOpenRun }) {
          const [runs, setRuns] = React.useState(null);
          const [health, setHealth] = React.useState(null);
          const [filter, setFilter] = React.useState('all');
          const [page, setPage] = React.useState(0);
          const [err, setErr] = React.useState('');
          const pageSize = 10;

          const load = React.useCallback(async () => {
            try {
              // v0.3.9 刀 3：一次聚合请求取代「每 Bot 一个 /runs/list」的 N+1
              const j = await cget('/runs/aggregate?limit=20');
              if (!j?.ok) throw new Error(j?.message || '读取失败');
              const list = (j.value?.runs ?? []).slice();
              list.sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
              setRuns(list);
              setHealth(j.value?.health ?? null);
              setErr('');
            } catch (e) {
              setErr(String(e?.message ?? e));
            }
          }, [bots]);

          React.useEffect(() => {
            void load();
          }, [load]);

          const list = (runs ?? []).filter((r) => filter === 'all' || r.botId === filter);
          const pages = Math.max(1, Math.ceil(list.length / pageSize));
          const safe = Math.min(page, pages - 1);
          const view = list.slice(safe * pageSize, safe * pageSize + pageSize);

          return h(
            CCard,
            null,
            h(CCardHead, {
              title: '运行记录',
              count: runs ? '共 ' + list.length + ' 条' : '读取中…',
              right: h(
                'div',
                { style: { display: 'flex', gap: 8, alignItems: 'center' } },
                health
                  ? h('span', { className: NS + '-c-card-count num', title: '近 N 轮成功率' },
                      '成功率 ' + Math.round((health.successRate ?? 0) * 100) + '% · ' + (health.sample ?? 0) + ' 轮')
                  : null,
                h(
                  'select',
                  {
                    className: NS + '-c-input',
                    style: { width: 180 },
                    value: filter,
                    onChange: (e) => {
                      setFilter(e.target.value);
                      setPage(0);
                    },
                  },
                  h('option', { value: 'all' }, '全部 Bot'),
                  ...bots.map((b) => h('option', { key: b.id, value: b.id }, b.name)),
                ),
                h(CBtn, { size: 'sm', onClick: () => void load(), disabled: busy }, '刷新'),
              ),
            }),
            h(
              'div',
              { className: NS + '-c-card-body tight' },
              err ? h('div', { style: { fontSize: 12, color: 'var(--dsw-alias-state-error-primary)' } }, err) : null,
              !runs
                ? h('div', { className: NS + '-c-empty' }, h('p', null, '正在读取运行记录…'))
                : list.length === 0
                  ? h('div', { className: NS + '-c-empty' }, h('p', null, '还没有运行记录。'))
                  : view.map((r) =>
                      h(
                        'div',
                        {
                          key: r.id,
                          className: NS + '-c-run',
                          style: { cursor: 'pointer', gridTemplateColumns: '6px 40px minmax(0,1fr) auto auto auto 12px' },
                          onClick: () => onOpenRun(r),
                        },
                        h('span', {
                          className:
                            NS + '-c-dot ' +
                            (r.status === 'success' ? 'ok' : r.status === 'failed' ? 'err' : 'warn'),
                        }),
                        h('span', { className: 'st' + (r.status === 'success' ? '' : ' err') }, statusText(r.status)),
                        h('span', { className: 'wh num' }, cWhen(r.startedAt) + ' · ' + cTriggerText(r.trigger)),
                        h('span', { style: { color: 'var(--dsw-alias-label-secondary)' } }, r.botName),
                        h('span', { className: 'cs num' }, fmtCost(r.usage)),
                        h('span', { className: 'id' }, '#' + String(r.id).slice(0, 8)),
                        h('span', { className: 'cv' }, h(IconChevron, { size: 12 })),
                      ),
                    ),
              runs && list.length > pageSize
                ? h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, paddingTop: 10, borderTop: '1px solid var(--dsw-alias-border-l1)' } },
                    h('span', { className: NS + '-c-card-count num' }, '第 ' + (safe + 1) + ' / ' + pages + ' 页'),
                    h(
                      'div',
                      { style: { display: 'flex', gap: 6 } },
                      h(CBtn, { size: 'sm', disabled: safe === 0, onClick: () => setPage(safe - 1) }, '上一页'),
                      h(CBtn, { size: 'sm', disabled: safe >= pages - 1, onClick: () => setPage(safe + 1) }, '下一页'),
                    ),
                  )
                : null,
            ),
          );
        }

        // ---------- 开关 / 设置 ----------
        function CSwitch({ value, onChange, disabled }) {
          return h(
            'button',
            {
              type: 'button',
              role: 'switch',
              'aria-checked': value ? 'true' : 'false',
              className: NS + '-c-switch' + (value ? ' on' : ''),
              onClick: () => onChange(!value),
              disabled,
            },
            h('span', { className: 'knob' }),
          );
        }

        function CRow({ label, hint, children }) {
          return h(
            'div',
            { className: NS + '-c-setting' },
            h(
              'div',
              { style: { flex: 1, minWidth: 0 } },
              h('div', { className: NS + '-c-setting-label' }, label),
              hint ? h('div', { className: NS + '-c-setting-hint' }, hint) : null,
            ),
            children,
          );
        }

        function ConsoleSettings({ bots, busy }) {
          const [s, setS] = React.useState(null);
          const [err, setErr] = React.useState('');
          const [notice, setNotice] = React.useState('');
          const [confirmClear, setConfirmClear] = React.useState(false);

          React.useEffect(() => {
            void (async () => {
              try {
                const j = await cget('/settings');
                if (!j?.ok) throw new Error(j?.message || '读取失败');
                setS(j.value?.effective ?? null);
              } catch (e) {
                setErr(String(e?.message ?? e));
              }
            })();
          }, []);

          const patch = async (key, value) => {
            const next = { ...(s ?? {}), [key]: value };
            setS(next);
            const j = await cpost('/settings', { settings: { [key]: value } });
            if (!j?.ok) setErr(j?.message || '保存失败');
          };

          const clearAll = async () => {
            if (!confirmClear) {
              setConfirmClear(true);
              return;
            }
            setConfirmClear(false);
            let removed = 0;
            for (const b of bots) {
              const j = await cpost('/runs/clear', { botId: b.id, confirm: true });
              if (j?.ok) removed += j.value?.removed ?? 0;
            }
            setNotice('已清空 ' + removed + ' 条运行记录');
          };

          if (err) {
            return h(CCard, null, h(CCardHead, { title: '设置' }), h('div', { className: NS + '-c-card-body' }, h('div', { style: { color: 'var(--dsw-alias-state-error-primary)', fontSize: 13 } }, err)));
          }
          if (!s) {
            return h(CCard, null, h(CCardHead, { title: '设置' }), h('div', { className: NS + '-c-card-body' }, h('div', { className: NS + '-c-empty' }, h('p', null, '正在读取设置…'))));
          }

          return h(
            'div',
            null,
            h(
              CCard,
              null,
              h(CCardHead, { title: '通知' }),
              h(
                'div',
                { className: NS + '-c-card-body' },
                h(CRow, {
                  label: '运行完成后系统通知',
                  hint: '轮询新完成的运行；首次需要在系统弹窗里授权通知权限',
                }, h(CSwitch, {
                  value: s.notifySystem !== false,
                  onChange: (v) => patch('notifySystem', v),
                  disabled: busy,
                })),
                h(CRow, {
                  label: '仅异常时打扰',
                  hint: '自动轮次只在失败 / 部分成功时提醒；手动点「执行」始终通知',
                }, h(CSwitch, {
                  value: s.notifyOnlyOnDecision !== false,
                  onChange: (v) => patch('notifyOnlyOnDecision', v),
                  disabled: busy,
                })),
                h(
                  CRow,
                  {
                    label: '免打扰时段',
                    hint: s.quietHours ? s.quietHours.start + ' – ' + s.quietHours.end + '（支持跨午夜）' : '未启用',
                  },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                    s.quietHours
                      ? h(
                          'div',
                          { style: { display: 'flex', gap: 6 } },
                          h('input', {
                            type: 'time',
                            className: NS + '-c-input',
                            style: { width: 150 },
                            value: s.quietHours.start,
                            onChange: (e) => patch('quietHours', { ...s.quietHours, start: e.target.value || '22:00' }),
                          }),
                          h('input', {
                            type: 'time',
                            className: NS + '-c-input',
                            style: { width: 150 },
                            value: s.quietHours.end,
                            onChange: (e) => patch('quietHours', { ...s.quietHours, end: e.target.value || '08:00' }),
                          }),
                        )
                      : null,
                    h(CSwitch, {
                      value: !!s.quietHours,
                      onChange: (v) => patch('quietHours', v ? { start: '22:00', end: '08:00' } : null),
                      disabled: busy,
                    }),
                  ),
                ),
              ),
            ),
            h(
              CCard,
              null,
              h(CCardHead, { title: '界面' }),
              h(
                'div',
                { className: NS + '-c-card-body' },
                h(CRow, {
                  label: '侧边栏图标入口',
                  hint: '在左侧边栏显示 Bot 图标；关闭后仍可从「设置 → 插件 → Bot」进入',
                }, h(CSwitch, {
                  value: s.sidebarEntry !== false,
                  onChange: (v) => {
                    patch('sidebarEntry', v);
                    try {
                      sidebarController.apply(v);
                    } catch {
                      /* 注册失败不影响保存 */
                    }
                  },
                  disabled: busy,
                })),
              ),
            ),
            h(
              CCard,
              null,
              h(CCardHead, { title: '数据' }),
              h(
                'div',
                { className: NS + '-c-card-body' },
                h(CRow, {
                  label: '运行记录',
                  hint: '清空所有 Bot 的运行记录；目标与记忆保留',
                }, h(CBtn, {
                  size: 'sm',
                  kind: 'danger',
                  onClick: clearAll,
                  disabled: busy || !bots.length,
                }, confirmClear ? '确认清空？不可恢复' : '清空记录')),
                notice ? h('div', { style: { marginTop: 8, fontSize: 12, color: 'var(--dsw-alias-state-success-primary)' } }, notice) : null,
              ),
            ),
          );
        }

        // ---------- 诊断 tab ----------
        function ConsoleDoctor() {
          const [report, setReport] = React.useState(null);
          const [err, setErr] = React.useState('');
          const [busy, setBusy] = React.useState(false);
          const [copied, setCopied] = React.useState('');

          const load = React.useCallback(async () => {
            setBusy(true);
            try {
              const j = await cget('/doctor');
              if (!j?.ok) throw new Error(j?.message || '读取失败');
              setReport(j.value);
              setErr('');
            } catch (e) {
              setErr(String(e?.message ?? e));
            } finally {
              setBusy(false);
            }
          }, []);

          React.useEffect(() => {
            void load();
          }, [load]);

          const tone = (level) =>
            level === 'error'
              ? 'var(--dsw-alias-state-error-primary)'
              : level === 'warn'
                ? 'var(--dsw-alias-state-warn-primary)'
                : 'var(--dsw-alias-state-success-primary)';

          return h(
            CCard,
            null,
            h(CCardHead, {
              title: '诊断',
              count: report ? 'v' + report.version : null,
              right: h(
                'div',
                { style: { display: 'flex', gap: 8 } },
                h(CBtn, { size: 'sm', onClick: () => void load(), disabled: busy }, busy ? '读取中…' : '刷新'),
                h(CBtn, {
                  size: 'sm',
                  onClick: async () => {
                    try {
                      await navigator.clipboard.writeText(report?.text ?? '');
                      setCopied('已复制');
                      setTimeout(() => setCopied(''), 1500);
                    } catch {
                      setCopied('复制失败');
                    }
                  },
                }, copied || '复制诊断'),
              ),
            }),
            h(
              'div',
              { className: NS + '-c-card-body' },
              err
                ? h('div', { style: { fontSize: 13, color: 'var(--dsw-alias-state-error-primary)' } }, '诊断不可用：' + err)
                : !report
                  ? h('div', { className: NS + '-c-empty' }, h('p', null, '正在读取诊断…'))
                  : (report.checks ?? []).map((c) =>
                      h(
                        'div',
                        { key: c.id, className: NS + '-c-kv', style: { alignItems: 'flex-start', gridTemplateColumns: '10px minmax(0,1fr)' } },
                        h('span', {
                          style: {
                            width: 8,
                            height: 8,
                            borderRadius: 999,
                            background: tone(c.level),
                            marginTop: 6,
                          },
                        }),
                        h(
                          'div',
                          { style: { minWidth: 0 } },
                          h('div', { style: { fontSize: 14, lineHeight: '22px', fontWeight: 500 } }, c.title),
                          h('div', { style: { fontSize: 13, lineHeight: '20px', color: 'var(--dsw-alias-label-secondary)', wordBreak: 'break-word' } }, c.detail),
                          c.hint ? h('div', { style: { fontSize: 12, lineHeight: '18px', color: 'var(--dsw-alias-brand-text)', marginTop: 2 } }, '下一步：' + c.hint) : null,
                        ),
                      ),
                    ),
            ),
          );
        }

        // ---------- 控制台外壳 ----------
        function BotConsole() {
          const [tab, setTab] = React.useState('bots');
          const [detailView, setDetailView] = React.useState(false);
          const [data, setData] = React.useState(null);
          const [sel, setSel] = React.useState(null);
          const [detail, setDetail] = React.useState(null);
          const [busy, setBusy] = React.useState(false);
          const [notice, setNotice] = React.useState('');
          const [err, setErr] = React.useState('');
          const [form, setForm] = React.useState(null);
          const [openRun, setOpenRun] = React.useState(null);

          const bots = data?.bots ?? [];
          const selected = bots.find((b) => b.id === sel) || bots[0] || null;

          const refresh = React.useCallback(async () => {
            try {
              const j = await cget('/overview');
              if (!j?.ok) throw new Error(j?.message || '读取失败');
              setData(j.value);
              const list = j.value?.bots ?? [];
              setSel((prev) =>
                prev && list.some((b) => b.id === prev) ? prev : list[0]?.id ?? null,
              );
            } catch (e) {
              setErr(String(e?.message ?? e));
            }
          }, []);

          const loadDetail = React.useCallback(async (botId) => {
            if (!botId) {
              setDetail(null);
              return;
            }
            try {
              const j = await cget('/bot?botId=' + encodeURIComponent(botId));
              if (!j?.ok) throw new Error(j?.message || '读取详情失败');
              setDetail(j.value);
            } catch (e) {
              setErr(String(e?.message ?? e));
            }
          }, []);

          React.useEffect(() => {
            void refresh();
          }, [refresh]);

          React.useEffect(() => {
            void loadDetail(selected?.id);
          }, [selected?.id, loadDetail]);

          React.useEffect(() => {
            if (!busy || !selected?.id) return;
            const t = setInterval(() => {
              void loadDetail(selected.id);
            }, 3000);
            return () => clearInterval(t);
          }, [busy, selected?.id, loadDetail]);

          const act = React.useCallback(
            async (kind, bot, extra) => {
              if (!bot?.id && kind !== 'botCreate') return;
              setBusy(true);
              setErr('');
              setNotice('');
              try {
                const res = await runBotAction(kind, bot, extra);
                if (res.error) setErr(res.error);
                if (res.notice) setNotice(res.notice);
                if (res.deleted) {
                  setSel(null);
                  setDetail(null);
                  setDetailView(false);
                }
                await refresh();
                if (kind === 'botCreate' && res.value?.id) setSel(res.value.id);
                if (!res.deleted && sel) await loadDetail(sel);
              } catch (e) {
                setErr(String(e?.message ?? e));
              } finally {
                setBusy(false);
              }
            },
            [refresh, loadDetail, sel],
          );

          const saveConfig = React.useCallback(
            async (payload) => {
              if (!selected?.id) return { error: '没有选中的 Bot' };
              setBusy(true);
              setErr('');
              try {
                // v0.3.9 刀 3：资料 / 模型 / 预算 / 节奏 一次提交（服务端按段校验）
                const j = await cpost('/bot/update', { botId: selected.id, ...payload });
                if (!j?.ok) return { error: j?.message || '保存失败' };
                setNotice('已保存');
                await refresh();
                await loadDetail(selected.id);
                return {};
              } catch (e) {
                return { error: String(e?.message ?? e) };
              } finally {
                setBusy(false);
              }
            },
            [selected, refresh, loadDetail],
          );

          const today = data?.stats?.todayCostCny ?? 0;
          const pending = bots.reduce(
            (n, b) => n + (b.pendingConfirmCount || 0) + (b.blocked ? 1 : 0),
            0,
          );
          const hb = data?.heartbeat;
          const hbMin = hb?.lastBeatAt ? Math.max(0, Math.floor((hb.staleMs || 0) / 60_000)) : null;

          const alert =
            err || notice
              ? h(
                  'div',
                  { className: NS + '-c-alert ' + (err ? 'err' : 'ok') },
                  h('span', { style: { flex: 1, minWidth: 0, whiteSpace: 'pre-wrap' } }, err || notice),
                  h(
                    'button',
                    {
                      type: 'button',
                      className: NS + '-c-alert-x',
                      onClick: () => (err ? setErr('') : setNotice('')),
                      title: '关闭',
                    },
                    '×',
                  ),
                )
              : null;

          const stats = h(
            'section',
            { className: NS + '-c-stats' },
            h(CStat, { k: '今日花费', v: cMoney(today), hint: bots.length + ' 个 Bot 合计' }),
            h(CStat, { k: 'Bot 总数', v: String(bots.length), unit: '个', hint: pending ? pending + ' 个在等你' : '暂无待处理' }),
            h(CStat, { k: '待你处理', v: String(pending), unit: '项', hint: pending ? '确认 / 阻塞 / 接续' : '一切都在自动推进' }),
            h(CStat, {
              k: '调度心跳',
              v: hbMin == null ? '—' : String(hbMin),
              unit: hbMin == null ? '' : '分钟前',
              hint: hb?.isStale ? '可能已休眠' : '后台每 30 秒检查一次',
            }),
          );

          const botsView = selected
            ? h(
                'div',
                { className: NS + '-c-ws' },
                h(BotRail, {
                  bots,
                  selectedId: selected.id,
                  onSelect: (id) => {
                    setSel(id);
                    setDetailView(false);
                  },
                  onCreate: () => setForm({ kind: 'createBot' }),
                }),
                h('section', null, h(BotOverview, {
                  bot: selected,
                  detail: detail && detail.bot?.id === selected.id ? detail : null,
                  act,
                  busy,
                  onDetail: () => setDetailView(true),
                  onForm: setForm,
                  onOpenRun: setOpenRun,
                })),
              )
            : h(
                CCard,
                null,
                h(CCardHead, { title: '开始' }),
                h(
                  'div',
                  { className: NS + '-c-card-body' },
                  h(
                    'div',
                    { className: NS + '-c-empty' },
                    h('p', null, '还没有 Bot。Bot 是一个常驻的 AI 同事：有自己的目标、记忆和工作区；执行前会打快照，随时能回滚。'),
                    h(CBtn, { kind: 'primary', onClick: () => setForm({ kind: 'createBot' }) }, '新建 Bot'),
                  ),
                ),
              );

          const detailPane = selected
            ? h(
                'div',
                { className: NS + '-c-split' },
                h(BotRail, {
                  bots,
                  selectedId: selected.id,
                  onSelect: (id) => {
                    setSel(id);
                    setDetail(null);
                  },
                  onCreate: () => setForm({ kind: 'createBot' }),
                  fill: true,
                }),
                h(BotDetailPane, {
                  bot: selected,
                  detail: detail && detail.bot?.id === selected.id ? detail : null,
                  act,
                  busy,
                  onBack: () => setDetailView(false),
                  onForm: setForm,
                  onSaveConfig: saveConfig,
                  onChanged: () => void loadDetail(selected.id),
                  onAllRuns: () => {
                    setDetailView(false);
                    setTab('runs');
                  },
                  onOpenRun: setOpenRun,
                }),
              )
            : null;

          const other =
            tab === 'runs'
              ? h(ConsoleRuns, { bots, busy, onOpenRun: setOpenRun })
              : tab === 'settings'
                ? h(ConsoleSettings, { bots, busy })
                : tab === 'doctor'
                  ? h(ConsoleDoctor)
                  : null;

          return h(
            'div',
            { className: NS + '-c' },
            h(
              'div',
              { className: NS + '-c-page' + (detailView ? ' split' : '') },
              h(
                'div',
                { className: NS + '-c-content' },
                h(
                  'header',
                  { className: NS + '-c-head' },
                  h(
                    'div',
                    { className: NS + '-c-head-left' },
                    h('div', { className: NS + '-c-mark' }, h(IconBot, { size: 18 })),
                    h(
                      'div',
                      null,
                      h('h1', { className: NS + '-c-title' }, 'dsh-bot'),
                      h('p', { className: NS + '-c-sub' }, '常驻 AI 队友 · 记得住、守得住、收得回'),
                    ),
                  ),
                  h(
                    'div',
                    { className: NS + '-c-head-actions' },
                    h(
                      CBtn,
                      {
                        kind: 'ghost',
                        icon: h(IconRefresh, { size: 14, spinning: busy }),
                        onClick: () => void refresh(),
                        disabled: busy,
                      },
                      '刷新',
                    ),
                    h(
                      CBtn,
                      {
                        kind: 'primary',
                        icon: h(
                          'svg',
                          { width: 14, height: 14, viewBox: '0 0 24 24', fill: 'none' },
                          h('path', {
                            d: 'M12 5v14M5 12h14',
                            stroke: 'currentColor',
                            strokeWidth: 1.8,
                            strokeLinecap: 'round',
                          }),
                        ),
                        onClick: () => setForm({ kind: 'createBot' }),
                      },
                      '新建 Bot',
                    ),
                  ),
                ),
                h(CTabs, {
                  tab,
                  onTab: (id) => {
                    setTab(id);
                    setDetailView(false);
                  },
                  meta: '共 ' + bots.length + ' 个 Bot · 今日 ' + cMoney(today),
                }),
                !detailView && alert ? h('div', { style: { marginTop: 12 } }, alert) : null,
                !detailView && tab === 'bots' ? stats : null,
                tab === 'bots'
                  ? detailView
                    ? detailPane
                    : botsView
                  : h('div', { style: { marginTop: 16 } }, other),
              ),
            ),
            detailView && alert
              ? h('div', { className: NS + '-c-toast ' + (err ? 'err' : 'ok') }, alert)
              : null,
            form
              ? h(
                  'div',
                  {
                    className: NS + '-c-modal',
                    onMouseDown: (e) => {
                      if (e.target === e.currentTarget) setForm(null);
                    },
                  },
                  h(
                    'div',
                    { className: NS + '-c-modal-card' },
                    h(FormPanel, {
                      form,
                      busy,
                      onClose: () => setForm(null),
                      onSubmit: (kind, extra) => {
                        const target =
                          bots.find((x) => x.id === form.botId) ||
                          { id: form.botId, name: form.botName, model: {} };
                        setForm(null);
                        void act(kind, target, extra);
                      },
                    }),
                  ),
                )
              : null,
            openRun
              ? h(RunDetailModal, { run: openRun, onClose: () => setOpenRun(null) })
              : null,
          );
        }
        /** 主面板页：点侧边栏图标后，右侧显示的内容（设置 + 诊断） */
        function BotPanelPage() {
          try {
            return h(BotConsole, null);
          } catch (e) {
            report('main-panel-render-error', String(e?.message ?? e));
            return null;
          }
        }

        /** 首次运行询问：是否在侧边栏显示入口（只问一次） */
        function SidebarEntryPrompt() {
          const [show, setShow] = React.useState(() => {
            try {
              return !localStorage.getItem('dsh-bot:sidebarPrompted');
            } catch {
              return false;
            }
          });
          if (!show) return null;
          const choose = (enabled) => {
            try {
              localStorage.setItem('dsh-bot:sidebarPrompted', '1');
            } catch {
              /* 忽略 */
            }
            setShow(false);
            try {
              sidebarController.apply(enabled);
            } catch {
              /* 注册失败不影响保存 */
            }
            try {
              void fetch('/_dsh-bot/settings', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ settings: { sidebarEntry: enabled } }),
              }).catch(() => {});
            } catch {
              /* 忽略 */
            }
          };
          return h(
            'div',
            {
              style: {
                position: 'fixed',
                inset: 0,
                zIndex: 9999,
                background: 'rgba(0, 0, 0, 0.45)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: FONT,
              },
            },
            h(
              'div',
              {
                style: {
                  width: 380,
                  background: BG_L2,
                  border: `1px solid ${BORDER_L1}`,
                  borderRadius: R_LG,
                  padding: '16px 18px',
                  color: LABEL_1,
                  boxShadow: 'var(--dsw-shadow-lv3)',
                },
              },
              h('div', { style: { fontSize: 13, fontWeight: 600, marginBottom: 6 } }, '在侧边栏显示 Bot 入口？'),
              h(
                'div',
                { style: { fontSize: 11, color: LABEL_3, lineHeight: 1.7, marginBottom: 12 } },
                '开启后左侧边栏会出现 dsh-bot 图标，点一下就在右侧打开 Bot 设置页。之后可在「设置 → Bot → 界面」里随时关闭。',
              ),
              h(
                'div',
                { style: { display: 'flex', gap: 8, justifyContent: 'flex-end' } },
                h(Btn, { onClick: () => choose(false) }, '先不显示'),
                h(Btn, { kind: 'primary', onClick: () => choose(true) }, '显示（推荐）'),
              ),
            ),
          );
        }

        function BotSettingsSection() {
          try {


            // 0.3.8：官方设置页的 Bot 分区与主页面共用同一套组件，
            //   消除两套 UI 的行为漂移（旧版「清空记录」只清第一个 Bot，新版清全部）。
            return h(
              'div',
              { className: NS + '-c-vars', style: { padding: '4px 0 16px', fontFamily: FONT, color: LABEL_1, maxWidth: 900 } },
              h(ConsoleSettings, { bots: [], busy: false }),
              h('div', { style: { height: 12 } }),
              h(ConsoleDoctor, null),
            );
          } catch (e) {
            report('settings-section-render-error', String(e?.message ?? e));
            return null;
          }
        }

        // v0.3.9 刀1：快捷条取代旧完整面板；「管理中心」走 ctx.layout.selectPanel
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            { name: 'conversation.input.dock', id: 'dsh-bot', order: 20 },
            () => h(DockBar, { ctx, onOpenConsole: () => openConsole(ctx) }),
          ),
        );

        // ⭐ 注册到 DSH 官方设置页（settings.section）
        //
        // 之前我判断「DSH 没有通用 settings slot」，那是错的——
        // 官方确实有 `settings.section`，第三方插件（如壁纸引擎）就在用：
        //
        //   ctx.slots.inject("settings.section", () =>
        //     ctx.slots.register(
        //       { name: "settings.section", id: "wallpaper-engine",
        //         order: 500, label: () => "壁纸引擎" },
        //       () => React.createElement(Section),
        //     ))
        //
        // 契约：只收 id / order / label（图标由官方 shell 按 id 硬编码兜底齿轮）。
        //
        // ⚠️ 这一段必须**完全隔离**：
        //   · 老版本宿主没有这个座位 → inject 回调不执行，正常
        //   · 新宿主有但契约不同 → 抛错也不能影响下面的 report
        //   · 组件本身渲染失败 → 已在 BotSettingsSection 内部 try/catch
        // 所以用独立的 try/catch 包住，且不改变任何后续控制流。
        try {
          if (ctx?.slots?.inject) {
            ctx.slots.inject('settings.section', () =>
              ctx.slots.register(
                {
                  name: 'settings.section',
                  id: 'dsh-bot',
                  order: 600,
                  label: () => 'Bot',
                },
                BotSettingsSection,
              ),
            );
            report('ok', 'settings.section registered');
          } else {
            report('settings-section-skip', 'ctx.slots.inject 不可用');
          }
        } catch (e) {
          // 注册失败只影响"设置页里没有 Bot 分区"，
          // 但绝不能让它把 client 的激活状态搞坏
          report('settings-section-error', String(e?.message ?? e));
        }

        // ---------- 主面板 + 侧边栏入口（v0.3.7） ----------
        // 侧边栏入口可开关：注册/注销都走 slots 的 disposer，切换立即生效。
        let sidebarDisposer = null;
        const applySidebarEntry = (enabled) => {
          try {
            if (enabled && !sidebarDisposer && ctx?.slots?.inject) {
              sidebarDisposer = ctx.slots.inject('sidebar.panellist', () =>
                ctx.slots.register(
                  {
                    name: 'sidebar.panellist',
                    id: 'dsh-bot',
                    order: 40,
                    label: () => 'dsh-bot',
                  },
                  BotSidebarIcon,
                ),
              );
              report('ok', 'sidebar.panellist registered');
            } else if (!enabled && sidebarDisposer) {
              sidebarDisposer();
              sidebarDisposer = null;
              report('ok', 'sidebar.panellist removed');
            }
          } catch (e) {
            report('sidebar-entry-error', String(e?.message ?? e));
          }
        };
        sidebarController.apply = applySidebarEntry;

        // 主面板：点侧边栏图标后右侧渲染的页面
        try {
          if (ctx?.slots?.inject) {
            ctx.slots.inject('main', () =>
              ctx.slots.register({ name: 'main', key: 'dsh-bot' }, BotPanelPage),
            );
            report('ok', 'main panel registered');
          }
        } catch (e) {
          report('main-panel-error', String(e?.message ?? e));
        }

        // 先按默认显示，再按已保存的设置纠正
        applySidebarEntry(true);
        (async () => {
          try {
            const r = await fetch('/_dsh-bot/settings', { headers: { accept: 'application/json' } });
            const j = await r.json();
            const v = j?.value?.effective;
            if (v && v.sidebarEntry === false) applySidebarEntry(false);
          } catch {
            /* 读不到就用默认 */
          }
        })();

        // ---------- 运行完成通知（全局轮询器） ----------
        //
        // 为什么是轮询而不是推送：宿主没有给插件暴露「向会话投递消息」
        // 或系统通知的 API（app.asar 里 Notification 只用于更新提醒，
        // ctx 上没有 notification 服务）。client bundle 活在 GUI 页面里、
        // 面板收起也照常运行，轮询是最稳的通道。
        //
        // 规则（与 settings 对齐）：
        //   · notifySystem=false → 完全静默
        //   · notifyOnlyOnDecision=true → 只在失败/部分成功/需要人拍板时响
        //   · quietHours 免打扰时段内不响
        //   · lastSeenRun 存 localStorage：只对「新完成的运行」响一次
        try {
          const NOTIFY_POLL_MS = 60_000;
          const lastSeenKey = 'dsh-bot:lastSeenRunAt';
          const readLastSeen = () => {
            try {
              return Number(localStorage.getItem(lastSeenKey)) || 0;
            } catch {
              return 0;
            }
          };
          const inQuietHours = (q, now = new Date()) => {
            if (!q || !q.start || !q.end) return false;
            const toMin = (s) => {
              const [h, m] = String(s).split(':').map(Number);
              return (h || 0) * 60 + (m || 0);
            };
            const cur = now.getHours() * 60 + now.getMinutes();
            const start = toMin(q.start);
            const end = toMin(q.end);
            if (start === end) return false;
            if (start < end) return cur >= start && cur < end;
            return cur >= start || cur < end; // 跨午夜
          };

          const fireNotification = (botName, run) => {
            const retried = Array.isArray(run.steps)
              ? run.steps.some((s) => s.name === 'retry')
              : false;
            const title =
              run.status === 'success'
                ? `✅ ${botName}：运行完成${retried ? '（已自动重试）' : ''}`
                : run.status === 'partial'
                  ? `🟡 ${botName}：部分成功`
                  : run.status === 'budget_exceeded'
                    ? `🛑 ${botName}：预算熔断`
                    : `❌ ${botName}：运行失败${retried ? '（重试后仍失败）' : '（下轮定时将自动重试）'}`;
            const cost = run.usage
              ? run.usage.costKind === 'free'
                ? '免费'
                : Number.isFinite(run.usage.costCny)
                  ? `¥${run.usage.costCny.toFixed(4)}`
                  : '费用未知'
              : '—';
            // runId 前 8 位：用户报问题时可对齐具体轮次（v0.3.1 R2）
            const body = `${new Date(run.startedAt).toLocaleTimeString('zh-CN')} · ${cost} · #${String(run.id).slice(0, 8)}` +
              (run.error?.message ? ` · ${String(run.error.message).slice(0, 80)}` : '') +
              (run.outputPreview ? `\n${run.outputPreview.slice(0, 100)}` : '');
            try {
              if (typeof Notification === 'undefined') return;
              if (Notification.permission === 'granted') {
                const n = new Notification(title, { body, tag: run.id, silent: false });
                n.onclick = () => {
                  try { window.focus(); } catch {}
                };
              }
            } catch {
              /* 通知失败不影响主流程 */
            }
          };

          let notifying = false;

          /** 取某个 Bot 的生效设置；失败时回退全局。 */
          const policyOf = async (botId) => {
            try {
              const r = await fetch(
                `/_dsh-bot/settings?botId=${encodeURIComponent(botId)}`,
                { headers: { accept: 'application/json' } },
              );
              const j = await r.json();
              if (j?.ok && j.value?.effective) return j.value.effective;
            } catch {
              /* 回退全局 */
            }
            return null;
          };

          const notifyTick = async () => {
            if (notifying) return;
            notifying = true;
            try {
              const sRes = await fetch('/_dsh-bot/settings', { headers: { accept: 'application/json' } });
              const sJson = await sRes.json();
              const globalSettings = sJson?.ok ? sJson.value?.effective : null;

              const oRes = await fetch('/_dsh-bot/overview', { headers: { accept: 'application/json' } });
              const oJson = await oRes.json();
              if (!oJson?.ok) return;
              const bots = oJson.value?.bots ?? [];
              if (!bots.length) return;

              const lastSeen = readLastSeen();
              let newest = lastSeen;
              // 每个新完成运行都要看；为控制请求量只拉每 Bot 最近 5 条
              for (const b of bots) {
                // ⭐ 单 Bot 设置要覆盖全局：0.3.5 及之前这里只看全局 settings，
                //    导致「某个 Bot 关闭仅异常打扰」永远不生效（0.3.6 修复）。
                const settings = (await policyOf(b.id)) ?? globalSettings;
                if (!settings?.notifySystem) continue;
                if (inQuietHours(settings.quietHours)) continue;
                const rRes = await fetch(`/_dsh-bot/runs/list?botId=${encodeURIComponent(b.id)}&limit=5`, {
                  headers: { accept: 'application/json' },
                });
                const rJson = await rRes.json();
                if (!rJson?.ok) continue;
                for (const run of rJson.value?.runs ?? []) {
                  const ended = Date.parse(run.endedAt || run.startedAt);
                  if (!Number.isFinite(ended) || ended <= lastSeen) continue;
                  if (ended > newest) newest = ended;
                  const attention =
                    run.status !== 'success' ||
                    (run.goalAssessment?.needsHuman === true);
                  // v0.3.1 体验修正：手动触发（用户点了「执行」在等结果）→ 成功也响；
                  // 只有自动轮（goal/schedule）才按「仅异常时打扰」静默成功。
                  const manualRun = run.trigger === 'manual';
                  if (settings.notifyOnlyOnDecision !== true || attention || manualRun) {
                    fireNotification(b.name, run);
                  }
                }
              }
              if (newest > lastSeen) {
                try { localStorage.setItem(lastSeenKey, String(newest)); } catch {}
              }
            } catch {
              /* 网络失败下轮再试 */
            } finally {
              notifying = false;
            }
          };
          // 首次运行先校准 lastSeen（避免升级后把历史全响一遍），再挂定时
          setTimeout(() => {
            if (readLastSeen() === 0) {
              // 第一次：只记水位不响
              void (async () => {
                try {
                  const oRes = await fetch('/_dsh-bot/overview', { headers: { accept: 'application/json' } });
                  const oJson = await oRes.json();
                  let newest = Date.now();
                  for (const b of oJson?.value?.bots ?? []) {
                    const rRes = await fetch(`/_dsh-bot/runs/list?botId=${encodeURIComponent(b.id)}&limit=1`, {
                      headers: { accept: 'application/json' },
                    });
                    const rJson = await rRes.json();
                    const ended = Date.parse(rJson?.value?.runs?.[0]?.endedAt || '');
                    if (Number.isFinite(ended) && ended > newest) newest = ended;
                  }
                  try { localStorage.setItem(lastSeenKey, String(newest)); } catch {}
                } catch {}
              })();
            }
            void notifyTick();
            setInterval(() => void notifyTick(), NOTIFY_POLL_MS);
          }, 15_000);
          report('ok', 'notify poller armed');
          // 通知能力自证：没有它，「收不到通知」只能靠猜
          try {
            if (typeof Notification === 'undefined') {
              report('notify-unavailable', 'Notification API 不存在');
            } else {
              report('notify-capability', `permission=${Notification.permission}`);
              if (Notification.permission === 'default') {
                try { void Notification.requestPermission?.(); } catch {}
              }
            }
          } catch {
            /* 能力探测失败不影响轮询 */
          }
        } catch (e) {
          report('notify-poller-error', String(e?.message ?? e));
        }

        report('ok', 'v2 activated, slot=conversation.input.dock');
      } catch (e) {
        report('error', (e?.stack ?? String(e)).slice(0, 900));
      }
    }

    return { name: 'dsh-bot-client', inject, apply };
  },
});

})();





