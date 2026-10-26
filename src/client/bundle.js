/**
 * dsh-bot 面板 — 浏览器端
 *
 * ⚠️ 反复崩溃换来的约束（每条都有实际报错佐证）：
 *   1. id 必须是 package.json 的包名（dsh-bot）—— 否则 duplicate factory
 *   2. 产物必须是 lib/client.js —— 否则 import failed
 *   3. 用到 ctx.slots 必须在 inject 声明 'slots' —— 否则 entry did not activate
 *   4. apply 与组件都要 try/catch —— 否则拖垮整个 web boot
 *
 * 🎨 样式规范全部来自 DSH 自己的 CSS（不是猜的）：
 *    · 按钮: height 28px / padding 0 10px / radius-sm
 *    · 主按钮文字色必须用 --dsw-alias-label-primary-foreground
 *      （之前写死 #fff，在浅色主题下会白底白字，看不出按钮）
 *    · 卡片: bg-layer-2 + border-l1 + radius-lg
 *    · 过渡: .15s ease
 */

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
      body: JSON.stringify({ status, detail: detail ?? null, at: new Date().toISOString() }),
    }).catch(() => {});
  } catch {
    /* ignore */
  }
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
  id: 'dsh-bot',
  factory: (require) => {
    const inject = ['slots'];

    // ⭐ 在这里给模块级的 React / h 赋值。
    //    图标组件在模块顶层定义，它们闭包引用这两个变量；
    //    必须在 apply 之前就绪，否则渲染时会抛 "h is not a function"。
    React = require('react');
    h = React.createElement;

    function apply(ctx) {
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

        function RunsSection({ busy }) {
          const [data, setData] = React.useState(null);
          const [err, setErr] = React.useState('');
          const [openRun, setOpenRun] = React.useState(null);
          const [mode, setMode] = React.useState(() => {
            try {
              const v = localStorage.getItem(RUNS_MODE_KEY);
              return v === 'compact' || v === 'paged' ? v : 'paged';
            } catch {
              return 'paged';
            }
          });
          const [page, setPage] = React.useState(0);
          const switchMode = (m) => {
            setMode(m);
            setPage(0);
            try { localStorage.setItem(RUNS_MODE_KEY, m); } catch {}
          };

          const load = React.useCallback(async () => {
            try {
              const o = await fetch('/_dsh-bot/overview', { headers: { accept: 'application/json' } });
              const oj = await o.json();
              if (!oj?.ok) throw new Error(oj?.message || '读取失败');
              const bots = oj.value?.bots ?? [];
              if (!bots.length) {
                setData({ bots: [], runs: [], botMap: {} });
                return;
              }
              // 汇总所有 Bot 的最近运行（每 Bot 最多 15 条）
              const results = await Promise.all(
                bots.map(async (b) => {
                  try {
                    const r = await fetch(
                      `/_dsh-bot/runs/list?botId=${encodeURIComponent(b.id)}&limit=15`,
                      { headers: { accept: 'application/json' } },
                    );
                    const rj = await r.json();
                    if (!rj?.ok) return [];
                    return (rj.value?.runs ?? []).map((run) => ({ ...run, botName: b.name, botId: b.id }));
                  } catch {
                    return [];
                  }
                }),
              );
              const all = results.flat().sort((a, b) => Date.parse(b.startedAt) - Date.parse(a.startedAt));
              setData({ bots, runs: all.slice(0, 30) });
              setErr('');
            } catch (e) {
              setErr(String(e?.message ?? e));
            }
          }, []);

          React.useEffect(() => {
            void load();
          }, [load]);

          const fmtTime = (iso) => {
            if (!iso) return '—';
            const d = new Date(iso);
            return d.toLocaleString('zh-CN', { hour12: false });
          };
          const statusBadge = (run) => {
            const map = {
              success: { tone: 'ok', label: run.dryRun ? '演习' : '成功' },
              partial: { tone: 'warn', label: '部分成功' },
              failed: { tone: 'err', label: '失败' },
              budget_exceeded: { tone: 'err', label: '预算熔断' },
            };
            const m = map[run.status] ?? { tone: 'neutral', label: run.status };
            return h(Badge, { tone: m.tone }, m.label);
          };

          if (err) {
            return h('div', { style: { fontSize: 11, color: ERR, padding: '4px 0' } }, `读取失败：${err}`);
          }
          if (!data) {
            return h('div', { style: { fontSize: 11, color: LABEL_3, padding: '4px 0' } }, '正在读取…');
          }
          if (!data.runs.length) {
            return h('div', { style: { fontSize: 11, color: LABEL_3, padding: '4px 0' } }, '还没有运行记录');
          }

          // ---- 形态切换（segmented 两档） ----
          const modeBtn = (m, label) =>
            h(
              'button',
              {
                key: m,
                type: 'button',
                onClick: () => switchMode(m),
                style: {
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 11,
                  padding: '3px 10px',
                  borderRadius: R_SM,
                  background: mode === m ? BRAND : 'transparent',
                  color: mode === m ? LABEL_FG : LABEL_3,
                },
              },
              label,
            );

          // ---- 分页计算（paged 形态用） ----
          const totalPages = Math.max(1, Math.ceil(data.runs.length / RUNS_PAGE_SIZE));
          const safePage = Math.min(page, totalPages - 1);
          const visible =
            mode === 'paged'
              ? data.runs.slice(safePage * RUNS_PAGE_SIZE, safePage * RUNS_PAGE_SIZE + RUNS_PAGE_SIZE)
              : data.runs;

          const runRow = (run) =>
            h(
              'div',
              {
                key: run.id,
                onClick: () => setOpenRun(run),
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '7px 8px',
                  borderRadius: R_SM,
                  cursor: 'pointer',
                  borderBottom: `1px solid ${BORDER_L1}`,
                },
              },
              statusBadge(run),
              h(
                'div',
                { style: { flex: 1, minWidth: 0 } },
                h(
                  'div',
                  { style: { fontSize: 12, color: LABEL_1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } },
                  `${run.botName} · ${run.outputPreview || '(无文本输出)'}`,
                ),
                h(
                  'div',
                  { style: { fontSize: 10, color: LABEL_3, marginTop: 1 } },
                  `${fmtTime(run.startedAt)} · ${run.trigger}${run.modelFallback ? ' · 模型已兜底' : ''}`,
                ),
              ),
              h(
                'div',
                { style: { textAlign: 'right', flexShrink: 0 } },
                h('div', { style: { fontSize: 12, color: LABEL_1 } }, fmtCost(run.usage)),
                h(
                  'div',
                  { style: { fontSize: 10, color: run.usage?.costKind === 'free' ? OK : run.usage?.costKind === 'unknown' ? WARN : LABEL_3 } },
                  run.usage?.costKind === 'free' ? '免费渠道' : run.usage?.costKind === 'unknown' ? '无价目' : '付费',
                ),
              ),
            );

          return h(
            'div',
            null,
            // ---- 工具条：形态切换 + 计数 ----
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 } },
              h(
                'div',
                {
                  style: {
                    display: 'inline-flex',
                    gap: 2,
                    padding: 2,
                    borderRadius: R_SM,
                    background: BG_L3,
                  },
                },
                modeBtn('paged', '分页'),
                modeBtn('compact', '滚动'),
              ),
              h('div', { style: { flex: 1 } }),
              h('div', { style: { fontSize: 10, color: LABEL_3 } }, `共 ${data.runs.length} 条`),
            ),
            // ---- 列表主体 ----
            h(
              'div',
              mode === 'compact'
                ? { style: { maxHeight: RUNS_COMPACT_HEIGHT, overflowY: 'auto', overflowX: 'hidden' } }
                : null,
              visible.map(runRow),
            ),
            // ---- 分页器（paged 形态） ----
            mode === 'paged' && totalPages > 1
              ? h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 6 } },
                  h(
                    'button',
                    {
                      type: 'button',
                      disabled: safePage === 0,
                      onClick: () => setPage(safePage - 1),
                      style: {
                        border: 'none', background: 'transparent', cursor: safePage === 0 ? 'default' : 'pointer',
                        color: safePage === 0 ? LABEL_3 : LABEL_1, fontSize: 12, padding: '2px 8px', opacity: safePage === 0 ? 0.4 : 1,
                      },
                    },
                    '‹',
                  ),
                  ...Array.from({ length: totalPages }, (_, i) =>
                    h(
                      'button',
                      {
                        key: i,
                        type: 'button',
                        onClick: () => setPage(i),
                        style: {
                          width: 22, height: 22, borderRadius: R_SM, fontSize: 11,
                          border: 'none', cursor: 'pointer',
                          background: i === safePage ? BRAND : 'transparent',
                          color: i === safePage ? LABEL_FG : LABEL_2,
                        },
                      },
                      String(i + 1),
                    ),
                  ),
                  h(
                    'button',
                    {
                      type: 'button',
                      disabled: safePage >= totalPages - 1,
                      onClick: () => setPage(safePage + 1),
                      style: {
                        border: 'none', background: 'transparent', cursor: safePage >= totalPages - 1 ? 'default' : 'pointer',
                        color: safePage >= totalPages - 1 ? LABEL_3 : LABEL_1, fontSize: 12, padding: '2px 8px', opacity: safePage >= totalPages - 1 ? 0.4 : 1,
                      },
                    },
                    '›',
                  ),
                )
              : null,
            openRun ? h(RunDetailModal, { run: openRun, onClose: () => setOpenRun(null) }) : null,
          );
        }

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
                h('div', { style: { fontSize: 14, fontWeight: 600, color: LABEL_1, flex: 1 } }, `运行详情 · ${run.botName}`),
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
                  ['步骤数', String(run.stepCount ?? 0)],
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
                const out = run.outputPreview || '';
                const chars = out.length;
                // 文件产物识别：输出中引用的本地文件路径（Windows 盘符 / ~/.dsh 常见落点）
                const pathMatches = [
                  ...new Set(
                    (out.match(/([A-Za-z]:\\[^\s"]+\.[a-z0-9]{2,4})|(~\/\.dsh\/[^\s"]+\.[a-z0-9]{2,4})/gi) || []),
                  ).filter((p) => /\.(md|txt|json|ya?ml|log|csv|html?|tgz|zip|png|jpe?g)$/i.test(p)),
                ];
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
            ),
          );
        }

        /** 设置视图 */
        function SettingsView({ busy, onClose, onLoad, onSave, onClearRuns, hideClose }) {
          const [s, setS] = React.useState(null);
          const [err, setErr] = React.useState('');

          React.useEffect(() => {
            let alive = true;
            (async () => {
              try {
                const r = await onLoad();
                if (alive) setS(r);
              } catch (e) {
                if (alive) setErr(String(e?.message ?? e));
              }
            })();
            return () => {
              alive = false;
            };
          }, [onLoad]);

          if (err) {
            return h(
              'div',
              { style: { padding: 12, fontSize: 12, color: ERR } },
              `读取设置失败：${err}`,
            );
          }
          if (!s) {
            return h(
              'div',
              { style: { padding: 12, fontSize: 12, color: LABEL_3 } },
              '正在读取设置…',
            );
          }

          const patch = (k, v) => {
            const next = { ...s, [k]: v };
            setS(next);
            void onSave(next);
          };

          const group = (title, children) =>
            h(
              'div',
              { style: { marginBottom: 14 } },
              h(
                'div',
                {
                  style: {
                    fontSize: 11,
                    fontWeight: 600,
                    color: LABEL_2,
                    marginBottom: 4,
                    paddingBottom: 4,
                    borderBottom: `1px solid ${BORDER_L1}`,
                  },
                },
                title,
              ),
              ...children,
            );

          return h(
            'div',
            { style: { padding: '4px 0' } },

            // ⭐ 诚实原则：这里的每一项都在下面真正被消费。
            //    · 通知三项 → client 全局轮询器（apply 内 notify poller）
            //    · 模型 / 预算 → 每个 Bot 的「配置与危险操作」层
            //    · 峰谷调度 / 快照策略 → 插件配置（cordis.patch.yml）
            h(
              'div',
              {
                style: {
                  fontSize: 11,
                  color: LABEL_3,
                  lineHeight: 1.8,
                  padding: '8px 10px',
                  borderRadius: R_SM,
                  background: BG_L3,
                  marginBottom: 14,
                },
              },
              '模型与预算在每个 Bot 的',
              h('br'),
              '「配置与危险操作」层里；峰谷调度与快照策略在插件配置（cordis.patch.yml）。',
            ),

            group('通知', [
              h(ToggleRow, {
                label: '运行完成后系统通知',
                hint: '轮询检测新完成的运行；首次需在系统弹窗里授权通知权限',
                value: s.notifySystem !== false,
                onChange: (v) => patch('notifySystem', v),
              }),
              h(ToggleRow, {
                label: '仅异常时打扰',
                hint: '开启后只有失败/部分成功/需要拍板才响；关闭则每次运行都通知',
                value: s.notifyOnlyOnDecision !== false,
                onChange: (v) => patch('notifyOnlyOnDecision', v),
              }),
              h(
                'div',
                { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' } },
                h(
                  'div',
                  { style: { flex: 1, minWidth: 0 } },
                  h('div', { style: { fontSize: 12, color: LABEL_1 } }, '免打扰时段'),
                  h(
                    'div',
                    { style: { fontSize: 10, color: LABEL_3, marginTop: 2 } },
                    s.quietHours ? `${s.quietHours.start} – ${s.quietHours.end}（跨午夜支持）` : '未启用',
                  ),
                ),
                s.quietHours
                  ? h(
                      'button',
                      {
                        type: 'button',
                        onClick: () => patch('quietHours', null),
                        style: {
                          border: 'none', background: 'transparent', cursor: 'pointer',
                          color: LABEL_2, fontSize: 11, textDecoration: 'underline',
                        },
                      },
                      '关闭',
                    )
                  : h(
                      'button',
                      {
                        type: 'button',
                        onClick: () => patch('quietHours', { start: '22:00', end: '08:00' }),
                        style: {
                          border: 'none', background: 'transparent', cursor: 'pointer',
                          color: BRAND, fontSize: 11, textDecoration: 'underline',
                        },
                      },
                      '启用 22:00–08:00',
                    ),
              ),
            ]),

            group('最近运行', [
              h(RunsSection, { busy }),
            ]),

            group('数据', [
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '6px 0',
                  },
                },
                h(
                  'div',
                  { style: { flex: 1, minWidth: 0 } },
                  h(
                    'div',
                    { style: { fontSize: 12, color: LABEL_1 } },
                    '运行记录',
                  ),
                  h(
                    'div',
                    { style: { fontSize: 10, color: LABEL_3, marginTop: 2 } },
                    '清空后不可恢复，但目标和记忆保留',
                  ),
                ),
                h(ConfirmBtn, {
                  label: '清空记录',
                  confirmLabel: '确认清空？不可恢复',
                  kind: 'danger',
                  disabled: busy,
                  onConfirm: () => onClearRuns(),
                }),
              ),
            ]),

            hideClose
              ? null
              : h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      justifyContent: 'flex-end',
                      marginTop: 4,
                    },
                  },
                  h(Btn, { onClick: onClose }, '关闭设置'),
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

        /** 判断 Bot 当前最需要注意的状态 */
        function botSituation(bot, detail) {
          const goal = detail?.goal;
          const runs = detail?.runs ?? [];
          const last = runs[0];

          if (detail?.proposals?.length) return 'proposal';
          if (goal?.status === 'pending_confirmation') return 'pending';
          if (goal?.status === 'blocked') return 'blocked';
          if (last?.status === 'failed') return 'failed';
          if (last?.status === 'budget_exceeded') return 'budget';
          if (!goal) return 'no-goal';
          if (goal.status === 'achieved' || goal.status === 'abandoned') return 'done';
          return 'normal';
        }

        /** 一行式状态摘要 —— A 方案的"摘要层" */
        function renderSituation(bot, detail, act, busy) {
          const sit = botSituation(bot, detail);
          const goal = detail?.goal;
          const last = detail?.runs?.[0];

          // 统一样式的小卡片
          const box = (children, tone) =>
            h(
              'div',
              {
                style: {
                  margin: '0 0 8px',
                  padding: '8px 10px',
                  borderRadius: R_SM,
                  background: BG_L2,
                  border: `1px solid ${tone ?? BORDER_L1}`,
                  fontSize: 12,
                  lineHeight: 1.6,
                  color: LABEL_2,
                },
              },
              children,
            );

          switch (sit) {
            case 'no-goal':
              return box(
                h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 8,
                    },
                  },
                  h('span', null, '他还没有目标，不知道该守什么'),
                  h(
                    Btn,
                    {
                      onClick: () =>
                        act.onOpenForm?.({
                          kind: 'goal',
                          botId: bot.id,
                          botName: bot.name,
                        }),
                      disabled: busy,
                    },
                    '设目标',
                  ),
                ),
              );

            case 'pending':
              return box(
                h(
                  'div',
                  null,
                  h(
                    'div',
                    { style: { color: WARN, fontWeight: 600, marginBottom: 4 } },
                    '他自己判断做完了，等你拍板',
                  ),
                  h('div', { style: { color: LABEL_2, marginBottom: 8 } }, goal.description),
                  h(
                    'div',
                    { style: { display: 'flex', gap: 6 } },
                    h(ConfirmBtn, {
                      label: '确认达成',
                      confirmLabel: '确认归档？',
                      kind: 'primary',
                      disabled: busy,
                      onConfirm: () => act('goalConfirm', bot),
                    }),
                    h(
                      Btn,
                      {
                        kind: 'danger',
                        disabled: busy,
                        onClick: () =>
                          act.onOpenForm?.({
                            kind: 'reject',
                            botId: bot.id,
                            botName: bot.name,
                          }),
                      },
                      '驳回',
                    ),
                  ),
                ),
                WARN,
              );

            case 'blocked':
              return box(
                h(
                  'div',
                  null,
                  h(
                    'div',
                    {
                      style: { color: ERR, fontWeight: 600, marginBottom: 4 },
                    },
                    '卡住了，需要你处理',
                  ),
                  h(
                    'div',
                    { style: { color: LABEL_2, marginBottom: 8 } },
                    goal.progress || '（没有更多细节）',
                  ),
                  // ⭐ 关键：光说"需要你处理"是不够的，必须给出**能点的动作**。
                  //    之前这里只有一行红字，用户只能看着——
                  //    这是个设计漏洞，不是文案问题。
                  h(
                    'div',
                    { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
                    h(
                      Btn,
                      {
                        kind: 'primary',
                        disabled: busy,
                        onClick: () =>
                          act.onOpenForm?.({
                            kind: 'unblock',
                            botId: bot.id,
                            botName: bot.name,
                          }),
                      },
                      '已处理好，继续',
                    ),
                    h(
                      Btn,
                      {
                        disabled: busy,
                        onClick: () =>
                          act.onOpenForm?.({
                            kind: 'giveup',
                            botId: bot.id,
                            botName: bot.name,
                          }),
                      },
                      '这事做不了，放弃',
                    ),
                  ),
                  h(
                    'div',
                    {
                      style: {
                        fontSize: 10,
                        color: LABEL_3,
                        marginTop: 6,
                      },
                    },
                    '比如：去把 /admin 的鉴权重配一下，再点「继续」。',
                  ),
                ),
                ERR,
              );

            case 'failed':
              return box(
                h(
                  'div',
                  null,
                  h(
                    'div',
                    {
                      style: { color: ERR, fontWeight: 600, marginBottom: 4 },
                    },
                    '上次执行失败了',
                  ),
                  h(
                    'div',
                    { style: { color: LABEL_2, whiteSpace: 'pre-wrap' } },
                    last?.error?.message ?? '没有记录到原因',
                  ),
                ),
                ERR,
              );

            case 'budget':
              return box(
                h(
                  'div',
                  { style: { color: ERR, fontWeight: 600 } },
                  `预算用完了：${last?.error?.message ?? '超出每日上限'}`,
                ),
                ERR,
              );

            case 'proposal':
              return box(
                h(
                  'div',
                  null,
                  h(
                    'div',
                    { style: { color: BRAND, fontWeight: 600, marginBottom: 4 } },
                    `他建议了 ${detail.proposals.length} 个下一步`,
                  ),
                  h(
                    'div',
                    { style: { color: LABEL_3, marginBottom: 8 } },
                    '他不会自己开张，要不要做得你定',
                  ),
                  ...detail.proposals.map((p, i) =>
                    h(
                      'div',
                      {
                        key: p.id,
                        style: {
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          paddingTop: i === 0 ? 0 : 6,
                          marginTop: i === 0 ? 0 : 6,
                          borderTop: i === 0 ? 'none' : `1px solid ${BORDER_L1}`,
                        },
                      },
                      h(
                        'span',
                        { style: { flex: 1, color: LABEL_1 } },
                        p.description,
                      ),
                      h(
                        Btn,
                        {
                          disabled: busy,
                          onClick: () => act('goalAccept', { ...bot, goalId: p.id }),
                        },
                        '接受',
                      ),
                    ),
                  ),
                ),
                BRAND,
              );

            case 'done':
              return box(
                h(
                  'div',
                  { style: { color: OK, fontWeight: 600 } },
                  `目标已${goal.status === 'achieved' ? '达成' : '放弃'}`,
                ),
                OK,
              );

            // normal
            default: {
              const bits = [];
              if (goal) bits.push(`在守「${goal.description}」`);
              if (goal?.cadence) {
                bits.push(
                  goal.lastFiredAt
                    ? `上次自动跑 ${fmtAgo(goal.lastFiredAt)}`
                    : '还没自动跑过',
                );
              } else {
                bits.push('没设自动节奏');
              }
              if (last) bits.push(`上次 ${statusText(last.status)} ${fmtAgo(last.startedAt)}`);
              return box(h('div', { style: { color: LABEL_3 } }, bits.join(' · ')));
            }
          }
        }



        /** 小标题 */
        function SectionTitle({ children, hint }) {
          return h(
            'div',
            {
              style: {
                display: 'flex',
                alignItems: 'baseline',
                gap: 6,
                marginBottom: 6,
              },
            },
            h(
              'span',
              { style: { fontSize: 11, fontWeight: 600, color: LABEL_2 } },
              children,
            ),
            hint
              ? h('span', { style: { fontSize: 10, color: LABEL_3 } }, hint)
              : null,
          );
        }

        /** ① 目标卡：进度、下一步、待确认按钮 */
        function renderGoalCard(bot, detail, act, busy) {
          const goal = detail.goal;
          // 没有目标 → 给一个明确的行动入口
          if (!goal) {
            return h(
              'div',
              { style: { marginBottom: 10 } },
              h(SectionTitle, null, '目标'),
              h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    fontSize: 12,
                    color: LABEL_2,
                  },
                },
                h('span', null, '他还没有目标，不知道该守什么'),
                h(
                  Btn,
                  {
                    onClick: () =>
                      act.onOpenForm
                        ? act.onOpenForm({ kind: 'goal', botId: bot.id, botName: bot.name })
                        : null,
                    disabled: busy,
                  },
                  '设目标',
                ),
              ),
            );
          }

          const isPending = goal.status === 'pending_confirmation';
          const isBlocked = goal.status === 'blocked';
          const isStanding = goal.type === 'standing';

          return h(
            'div',
            {
              style: {
                marginBottom: 10,
                padding: '8px 10px',
                borderRadius: R_SM,
                background: BG_L2,
                border: `1px solid ${
                  isPending || isBlocked ? goalStatusColor(goal.status) : BORDER_L1
                }`,
              },
            },
            h(
              'div',
              {
                style: {
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  marginBottom: 4,
                },
              },
              h(
                'span',
                { style: { fontSize: 12, fontWeight: 600, color: LABEL_1 } },
                goal.description,
              ),
              h(
                'span',
                {
                  style: {
                    fontSize: 10,
                    color: goalStatusColor(goal.status),
                    flexShrink: 0,
                  },
                },
                goalStatusText(goal.status),
              ),
              h(
                'span',
                { style: { fontSize: 10, color: LABEL_3, flexShrink: 0 } },
                goalTypeText(goal.type),
              ),
              isStanding
                ? h(
                    'span',
                    { style: { fontSize: 10, color: LABEL_3, flexShrink: 0 } },
                    `第 ${goal.cycleCount ?? 0} 轮`,
                  )
                : null,
            ),
            h(
              'div',
              { style: { fontSize: 11, color: LABEL_2, lineHeight: 1.6 } },
              goal.progress,
            ),
            goal.nextStep
              ? h(
                  'div',
                  { style: { fontSize: 11, color: LABEL_3, marginTop: 3 } },
                  `下一步：${goal.nextStep}`,
                )
              : null,

            // ⭐ 执行节奏 —— 这是"它会不会自己跑"的答案，
            //    必须直接显示出来，不能藏在日志里。
            h(
              'div',
              {
                style: {
                  fontSize: 10,
                  marginTop: 5,
                  color: goal.cadence ? LABEL_3 : WARN,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                },
              },
              goal.cadence
                ? `自动执行节奏：${goal.cadence}` +
                  (goal.lastFiredAt
                    ? ` · 上次自动跑 ${fmtAgo(goal.lastFiredAt)}`
                    : ' · 还没自动跑过')
                : '⚠️ 没有设置执行节奏 —— 它不会自己跑，只有你点「执行」才动',
            ),

            // 待确认：这是「Bot 不能自己宣布胜利」的可见形态
            isPending
              ? h(
                  'div',
                  {
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      marginTop: 8,
                      paddingTop: 8,
                      borderTop: `1px solid ${BORDER_L1}`,
                    },
                  },
                  h(
                    'span',
                    { style: { fontSize: 11, color: WARN, flex: 1 } },
                    '他自己判断做完了，等你拍板',
                  ),
                  h(
                    ConfirmBtn,
                    {
                      label: '确认达成',
                      confirmLabel: '确认归档？',
                      kind: 'primary',
                      onConfirm: () => act('goalConfirm', bot),
                      disabled: busy,
                    },
                  ),
                  h(
                    Btn,
                    {
                      kind: 'danger',
                      onClick: () =>
                        act.onOpenForm
                          ? act.onOpenForm({ kind: 'reject', botId: bot.id, botName: bot.name })
                          : null,
                      disabled: busy,
                    },
                    '驳回',
                  ),
                )
              : null,

            // 卡住了
            isBlocked
              ? h(
                  'div',
                  {
                    style: {
                      fontSize: 11,
                      color: ERR,
                      marginTop: 8,
                      paddingTop: 8,
                      borderTop: `1px solid ${BORDER_L1}`,
                    },
                  },
                  '卡住了，需要你介入处理。处理好后在对话框说「解除阻塞」即可。',
                )
              : null,
          );
        }

        /** ② 接续建议：目标完成后的下一步候选 */
        function renderProposals(proposals, bot, act, busy) {
          return h(
            'div',
            { style: { marginBottom: 10 } },
            h(SectionTitle, { hint: '他不会自己开张' }, '建议接下来'),
            h(
              'div',
              {
                style: {
                  padding: '8px 10px',
                  borderRadius: R_SM,
                  background: BG_L2,
                  border: `1px solid ${BORDER_L1}`,
                },
              },
              ...proposals.map((p, i) =>
                h(
                  'div',
                  {
                    key: p.id,
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      paddingTop: i === 0 ? 0 : 6,
                      marginTop: i === 0 ? 0 : 6,
                      borderTop: i === 0 ? 'none' : `1px solid ${BORDER_L1}`,
                    },
                  },
                  h(
                    'span',
                    { style: { fontSize: 11, color: LABEL_1, flex: 1 } },
                    p.description,
                  ),
                  h(
                    'span',
                    { style: { fontSize: 10, color: LABEL_3, flexShrink: 0 } },
                    goalTypeText(p.type),
                  ),
                  h(
                    Btn,
                    {
                      onClick: () =>
                        act('goalAccept', { ...bot, goalId: p.id }),
                      disabled: busy,
                    },
                    '接受',
                  ),
                ),
              ),
              h(
                'div',
                { style: { marginTop: 8, textAlign: 'right' } },
                h(
                  Btn,
                  { onClick: () => act('goalDismiss', bot), disabled: busy },
                  '都不用',
                ),
              ),
            ),
          );
        }

        /** ③ 最近运行 */
        function renderRuns(runs) {
          return h(
            'div',
            { style: { marginBottom: 10 } },
            h(SectionTitle, { hint: '全量记录，不设上限' }, '最近运行'),
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
              ...runs.slice(0, 3).map((r) => {
                const blocked = (r.steps || []).filter((s) => s.blocked).length;
                const effect = r.goalEffect;
                return h(
                  'div',
                  {
                    key: r.id,
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11,
                      lineHeight: '18px',
                    },
                  },
                  h('span', {
                    style: {
                      width: 5,
                      height: 5,
                      borderRadius: 999,
                      background: statusColor(r.status),
                      flexShrink: 0,
                    },
                  }),
                  h(
                    'span',
                    { style: { color: LABEL_3, flexShrink: 0 } },
                    r.startedAt.slice(5, 16).replace('T', ' '),
                  ),
                  h(
                    'span',
                    { style: { color: statusColor(r.status), flexShrink: 0 } },
                    statusText(r.status),
                  ),
                  r.dryRun
                    ? h(
                        'span',
                        { style: { color: LABEL_3, flexShrink: 0 } },
                        '演习',
                      )
                    : null,
                  blocked
                    ? h(
                        'span',
                        { style: { color: WARN, flexShrink: 0 } },
                        `${blocked} 步拦截`,
                      )
                    : null,
                  effect === 'pending'
                    ? h('span', { style: { color: WARN, flexShrink: 0 } }, '待确认')
                    : null,
                  effect === 'cycle'
                    ? h('span', { style: { color: BRAND, flexShrink: 0 } }, '轮次+1')
                    : null,
                  h(
                    'span',
                    { style: { color: LABEL_3, marginLeft: 'auto', flexShrink: 0 } },
                    fmtCost(r.usage),
                  ),
                );
              }),
            ),
          );
        }

        /** ④ 他记得：记忆事实 */
        function renderMemory(semantic) {
          const items = [...(semantic.preferences || []), ...(semantic.facts || [])].slice(0, 4);
          if (!items.length) return null;
          return h(
            'div',
            { style: { marginBottom: 10 } },
            h(SectionTitle, { hint: '会被带进每一轮' }, '他记得'),
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 2 } },
              ...items.map((f, i) =>
                h(
                  'div',
                  {
                    key: i,
                    style: {
                      fontSize: 11,
                      color: LABEL_2,
                      lineHeight: 1.6,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    },
                  },
                  `· ${f}`,
                ),
              ),
            ),
          );
        }

        /** ⑤ 例行流程 */
        function renderRoutines(routines) {
          return h(
            'div',
            { style: { marginBottom: 10 } },
            h(SectionTitle, { hint: '目标完成也不中断' }, '例行流程'),
            h(
              'div',
              { style: { display: 'flex', flexDirection: 'column', gap: 3 } },
              ...routines.slice(0, 3).map((r) =>
                h(
                  'div',
                  {
                    key: r.id,
                    style: {
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11,
                    },
                  },
                  h('span', { style: { color: LABEL_1 } }, r.name || r.id),
                  r.trigger
                    ? h(
                        'span',
                        { style: { color: LABEL_3, marginLeft: 'auto' } },
                        r.trigger,
                      )
                    : null,
                ),
              ),
            ),
          );
        }

        // ---------- 主面板 ----------
        function BotDock() {
          try {
            const [open, setOpen] = React.useState(false);
            const [data, setData] = React.useState(null);
            const [err, setErr] = React.useState('');
            const [busy, setBusy] = React.useState(false);
            const [notice, setNotice] = React.useState('');
            const [detailId, setDetailId] = React.useState(null);
            const [detail, setDetail] = React.useState(null);
            const [headHover, setHeadHover] = React.useState(false);
            const [expanded, setExpanded] = React.useState(false);
            /** 内嵌表单：{ kind, botId, ... } —— 取代 window.prompt */
            const [form, setForm] = React.useState(null);
            /** 哪个 Bot 的「更多」是展开的（A 方案：第三层折叠） */
            const [moreOpen, setMoreOpen] = React.useState(null);
            /** 哪个 Bot 的「配置与危险操作」展开（与「他知道什么」分属两层） */
            const [dangerOpen, setDangerOpen] = React.useState(null);
            /** 当前视图：bots 列表 / settings 设置页 */
            const [view, setView] = React.useState('bots');

            const refresh = React.useCallback(async () => {
              setBusy(true);
              try {
                const r = await fetch('/_dsh-bot/overview', {
                  headers: { accept: 'application/json' },
                });
                const j = await r.json();
                if (j?.ok) {
                  setData(j.value);
                  // ⚠️ 这里曾经 setErr('')，导致刚显示的错误被刷新清空。
                  //    用户看到红框"闪了一下就没了"——比不显示还糟。
                  //    错误只能由用户主动操作（关掉 / 再次操作）清除，
                  //    不能被一个后台刷新顺手抹掉。
                } else {
                  setErr(j?.message || '读取失败');
                }
              } catch (e) {
                setErr(String(e?.message || e));
              } finally {
                setBusy(false);
              }
            }, []);

            React.useEffect(() => {
              if (open && !data) void refresh();
            }, [open, data, refresh]);

            // 展开某个 Bot 的详情时，拉一次完整数据
            // （目标 / 运行史 / 记忆 / 例行流程 / 快照都在这个接口里）
            const loadDetail = React.useCallback(async (botId) => {
              if (!botId) {
                setDetail(null);
                return;
              }
              try {
                const r = await fetch(
                  `/_dsh-bot/bot?botId=${encodeURIComponent(botId)}`,
                  { headers: { accept: 'application/json' } },
                );
                const j = await r.json();
                if (j?.ok) setDetail(j.value);
                else setErr(j?.message || '读取详情失败');
              } catch (e) {
                setErr(String(e?.message || e));
              }
            }, []);

            React.useEffect(() => {
              void loadDetail(detailId);
            }, [detailId, loadDetail]);

            // ⭐ 运行中实时刷新：长任务（工具循环）进行时每 3s 拉一次详情，
            //    结束即停。轮询而不是 WebSocket——够用，不引入新依赖。
            React.useEffect(() => {
              if (!busy || !detailId) return;
              const t = setInterval(() => {
                void loadDetail(detailId);
              }, 3000);
              return () => clearInterval(t);
            }, [busy, detailId, loadDetail]);

            const act = React.useCallback(
              async (kind, bot, extra) => {
                setBusy(true);
                setErr('');
                setNotice('');
                try {
                  const post = async (path, body) => {
                    const r = await fetch('/_dsh-bot' + path, {
                      method: 'POST',
                      headers: { 'content-type': 'application/json' },
                      body: JSON.stringify(body),
                    });
                    return r.json();
                  };

                  let j;
                  if (kind === 'dry') {
                    j = await post('/dry-run', { botId: bot.id });
                    if (j?.ok) {
                      const st = j.value?.status;
                      const bl = (j.value.steps || []).filter((s) => s.blocked).length;
                      const errMsg = j.value?.error?.message;

                      if (st === 'failed') {
                        setErr(`演习失败：${errMsg ?? '未知原因'}`);
                      } else {
                        setNotice(
                          `空跑完成：${bl} 步会被拦截，未产生真实影响`,
                        );
                      }
                    }
                  } else if (kind === 'run') {
                    // ⚠️ 不用 window.confirm：Electron 里 confirm() 是空实现，
                    //    永远返回 false，按钮会变成"点了没反应"。
                    //    真实执行的二次确认由按钮的 armed 态承担（见下方 UI）。
                    j = await post('/run', { botId: bot.id, confirm: true });
                    if (j?.ok) {
                      // ⚠️ 这里曾经把失败也当成成功提示显示（绿底 + "执行完成"）。
                      //    API 返回 ok:true 只代表"请求执行完了"，
                      //    运行本身可能是 failed —— 必须分开处理。
                      const st = j.value?.status;
                      const errMsg = j.value?.error?.message;

                      if (st === 'failed' || st === 'budget_exceeded') {
                        setErr(
                          `执行失败（${st}）` + (errMsg ? `：${errMsg}` : ''),
                        );
                      } else if (st === 'partial') {
                        const bl = (j.value.steps || []).filter(
                          (s) => s.blocked,
                        ).length;
                        setNotice(
                          `执行部分完成${bl ? `，${bl} 步被跳过` : ''}`,
                        );
                      } else {
                        setNotice(`执行完成`);
                      }
                    } else if (j?.code === 'PRECHECK_FAILED') {
                      // 执行前检查没过：直接把原因显示出来，
                      // 不要让用户看到含糊的"执行失败"
                      setErr(j.message);
                    }
                  } else if (kind === 'snapshot') {
                    j = await post('/snapshot', { botId: bot.id });
                    if (j?.ok) setNotice(`已创建快照（${j.value.fileCount} 个文件）`);
                  } else if (kind === 'rollback') {
                    j = await post('/rollback', { botId: bot.id, confirm: true });
                    if (j?.ok) {
                      setNotice(
                        `已回滚：恢复 ${j.value.restored.length} 个，删除 ${j.value.removed.length} 个`,
                      );
                    }
                  } else if (kind === 'goalConfirm') {
                    j = await post('/goal/confirm', {
                      botId: bot.id,
                      confirm: true,
                      note: extra?.note,
                    });
                    if (j?.ok) setNotice('已确认达成并归档，下面看看建议的下一步');
                  } else if (kind === 'goalReject') {
                    j = await post('/goal/reject', {
                      botId: bot.id,
                      note: extra?.note ?? '还没做完',
                    });
                    if (j?.ok) setNotice('已驳回，目标回到进行中');
                  } else if (kind === 'goalUnblock') {
                    j = await post('/goal/unblock', {
                      botId: bot.id,
                      note: extra?.note,
                    });
                    if (j?.ok) setNotice('已解除阻塞，目标回到进行中');
                  } else if (kind === 'goalGiveup') {
                    j = await post('/goal/giveup', {
                      botId: bot.id,
                      note: extra?.note,
                    });
                    if (j?.ok) setNotice('已放弃并归档');
                  } else if (kind === 'goalAccept') {
                    j = await post('/goal/accept', { botId: bot.id, goalId: bot.goalId });
                    if (j?.ok) setNotice('已接受，Bot 开始守护新目标');
                  } else if (kind === 'goalDismiss') {
                    j = await post('/goal/dismiss', { botId: bot.id });
                    if (j?.ok) setNotice('已忽略建议');
                  } else if (kind === 'goalSet') {
                    // extra = { description, goalType }
                    j = await post('/goal/set', {
                      botId: bot.id,
                      description: extra.description,
                      goalType: extra.goalType,
                    });
                    if (j?.ok) setNotice('目标已设定');
                  } else if (kind === 'botCreate') {
                    j = await post('/bot/create', {
                      name: extra.name,
                      role: extra.role,
                      goal: extra.goal,
                      goalType: extra.goalType,
                      // ⚠️ 之前漏了这一行，导致「新建时填的节奏」被静默丢弃，
                      //    用户以为设好了，其实 goal.json 里根本没有 cadence。
                      cadence: extra.cadence,
                    });
                    if (j?.ok) setNotice(`已创建「${extra.name}」`);
                  } else if (kind === 'botModel') {
                    j = await post('/bot/model', {
                      botId: bot.id,
                      provider: extra.provider,
                      model: extra.model,
                    });
                    if (j?.ok) setNotice('模型已更新');
                  } else if (kind === 'clearRuns') {
                    j = await post('/runs/clear', {
                      botId: bot.id,
                      confirm: true,
                    });
                    if (j?.ok) {
                      setNotice(`已清空 ${j.value.removed} 条运行记录`);
                    }
                  } else if (kind === 'botDelete') {
                    j = await post('/bot/delete', { botId: bot.id, confirm: true });
                    if (j?.ok) {
                      setNotice(`已删除「${bot.name}」`);
                      setDetailId(null);
                      setDetail(null);
                    }
                  }
                  if (j && !j.ok) setErr(j.message || '操作失败');
                  await refresh();
                  // 目标操作会改变详情区内容，一并刷新
                  if (detailId) await loadDetail(detailId);
                } catch (e) {
                  setErr(String(e?.message || e));
                } finally {
                  setBusy(false);
                }
              },
              [refresh, loadDetail, detailId],
            );

            // 把「打开表单」挂到 act 上，让分区渲染函数能调用
            act.onOpenForm = (f) => setForm(f);
            act.onOpenModel = (f) => setForm({ kind: 'model', ...f });

            const bots = data?.bots ?? [];
            const stats = data?.stats;

            // 卡片样式：贴近官方的 dock 卡片
            //   · radius-md（官方用 md，不是 lg）
            //   · 左侧内边距大、右侧小（给图标按钮留位）
            const card = {
              fontFamily: FONT,
              border: `1px solid ${BORDER_L1}`,
              borderRadius: R_MD,
              background: BG_L2,
              overflow: 'hidden',
            };

            // ========== 收起态 ==========
            if (!open) {
              return h(
                'div',
                { className: `${NS}-dock` },
                h(
                  'div',
                  {
                    className: `${NS}-dock-inner`,
                    style: {
                      ...card,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '7px 12px',
                      cursor: 'pointer',
                      transition: 'background .15s ease',
                      background: headHover ? HOVER_BG : BG_L2,
                    },
                    onClick: () => setOpen(true),
                    onMouseEnter: () => setHeadHover(true),
                    onMouseLeave: () => setHeadHover(false),
                  },
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                    h(IconBot, { size: 16, color: BRAND }),
                    h(
                      'span',
                      { style: { fontSize: 13, fontWeight: 500, color: LABEL_1 } },
                      'Bot',
                    ),
                    stats ? h(Badge, { tone: 'brand' }, `${stats.botCount} 个`) : null,
                  ),
                  h(
                    'div',
                    { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                    stats
                      ? h(
                          'span',
                          { style: { fontSize: 12, color: LABEL_3 } },
                          `今日 ${fmtCny(stats.todayCostCny)}`,
                        )
                      : null,
                    h(IconChevron, { size: 13 }),
                  ),
                ),
              );
            }

            // ========== 展开态 ==========
            //
            // 布局：头部固定 → 主体滚动
            //
            // ⚠️ 之前所有内容平铺在一层，详情区一展开就把面板撑得很高，
            //    超出可视区域后既看不到下面、也没法滚（因为根本没有滚动容器）。
            //    现在用 flex 列布局 + 中部 overflow-y:auto 解决。
            return h(
              'div',
              { className: `${NS}-dock` },
              h(
                'div',
                {
                  className: `${NS}-dock-inner ${NS}-fade ${NS}-expanded`,
                  style: card,
                },
                // ---------- 头部（固定） ----------
                h(
                'div',
                {
                  style: {
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    borderBottom: `1px solid ${BORDER_L1}`,
                  },
                },
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 8 } },
                  h(IconBot, { size: 16, color: BRAND }),
                  h(
                    'span',
                    { style: { fontSize: 13, fontWeight: 600, color: LABEL_1 } },
                    'Bot 面板',
                  ),
                  stats ? h(Badge, { tone: 'brand' }, `${stats.botCount} 个`) : null,
                  // ⭐ 需要你拍板的数量（否则"他在等你"这件事永远看不见）
                  (() => {
                    const need = bots.filter(
                      (x) => x.pendingConfirmCount || x.blocked,
                    ).length;
                    return need > 0
                      ? h(Badge, { tone: 'warn' }, `${need} 项等你`)
                      : null;
                  })(),
                  // ⭐ 对话介入的回声：最近 48h 新接手的 Bot，提示用户回来看
                  (() => {
                    const cnt = data?.recentAdoptions?.length ?? 0;
                    return cnt > 0
                      ? h(Badge, { tone: 'ok' }, `新接手 ${cnt}`)
                      : null;
                  })(),
                ),
                h(
                  'div',
                  { style: { display: 'flex', alignItems: 'center', gap: 6 } },
                  stats
                    ? h(
                        'span',
                        { style: { fontSize: 12, color: LABEL_3, marginRight: 2 } },
                        `今日 ${fmtCny(stats.todayCostCny)}`,
                      )
                    : null,
                  h(
                    'button',
                    {
                      className: `${NS}-row-btn`,
                      onClick: () => setForm({ kind: 'createBot' }),
                      title: '新建 Bot',
                      type: 'button',
                    },
                    '＋',
                  ),
                  h(
                    'button',
                    {
                      className: `${NS}-row-btn`,
                      onClick: refresh,
                      disabled: busy,
                      title: '刷新',
                      type: 'button',
                      style: { opacity: busy ? 0.5 : 1 },
                    },
                    h(IconRefresh, { size: 13, spinning: busy }),
                  ),
                  h(
                    'button',
                    {
                      className: `${NS}-row-btn`,
                      onClick: () => setOpen(false),
                      title: '收起',
                      type: 'button',
                    },
                    h(IconCollapse, { size: 13 }),
                  ),
                ),
              ),

              // ---------- 主体（可滚动） ----------
              h(
                'div',
                { className: `${NS}-scroll` },

                // ===== 设置视图 =====
                // 设置页是"另一个房间"，打开时盖住 Bot 列表，
                // 不再往下堆内容（否则又变成"挤成一坨"）。
                view === 'settings'
                  ? h(SettingsView, {
                      busy,
                      onClose: () => setView('bots'),
                      onLoad: async () => {
                        const r = await fetch('/_dsh-bot/settings', {
                          headers: { accept: 'application/json' },
                        });
                        const j = await r.json();
                        if (!j?.ok) throw new Error(j?.message || '读取失败');
                        return j.value.effective;
                      },
                      onSave: async (next) => {
                        try {
                          await fetch('/_dsh-bot/settings', {
                            method: 'POST',
                            headers: { 'content-type': 'application/json' },
                            body: JSON.stringify({ settings: next }),
                          });
                        } catch {
                          /* 保存失败下次再试 */
                        }
                      },
                      onClearRuns: () => {
                        const target = detailId
                          ? bots.find((x) => x.id === detailId)
                          : bots[0];
                        if (!target) return;
                        void act('clearRuns', target);
                      },
                    })
                  : null,

                // ===== Bot 列表视图 =====
                // 内嵌表单（取代 prompt）—— 必须放在详情区之上，
                // 因为它是"当前正在进行的操作"，优先级高于展示信息
                form
                  ? h(FormPanel, {
                      form,
                      busy,
                      onClose: () => setForm(null),
                      onSubmit: (kind, extra) => {
                        const target = bots.find((x) => x.id === form.botId) || {
                          id: form.botId,
                          name: form.botName,
                        };
                        setForm(null);
                        void act(kind, target, extra);
                      },
                    })
                  : null,

              // 错误提示
              //
              // 三个改进（都来自真实反馈）：
              //   1. 不再被 refresh 清空（之前会"闪一下就没了"）
              //   2. 加关闭按钮 —— 何时消失由用户决定
              //   3. 更显眼：有色背景 + 图标，不再只是一条细边框
              err
                ? h(
                    'div',
                    {
                      style: {
                        margin: '8px 12px',
                        padding: '8px 10px',
                        borderRadius: R_SM,
                        background: 'var(--dsw-alias-bg-layer-3)',
                        border: `1px solid ${ERR}`,
                        color: ERR,
                        fontSize: 12,
                        lineHeight: 1.6,
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                      },
                    },
                    h(
                      'span',
                      {
                        style: {
                          flexShrink: 0,
                          fontWeight: 700,
                          lineHeight: '18px',
                        },
                      },
                      '!',
                    ),
                    h(
                      'span',
                      { style: { flex: 1, whiteSpace: 'pre-wrap' } },
                      err,
                    ),
                    h(
                      'button',
                      {
                        className: `${NS}-row-btn`,
                        onClick: () => setErr(''),
                        title: '关闭',
                        type: 'button',
                        style: { flexShrink: 0 },
                      },
                      '×',
                    ),
                  )
                : null,
              notice
                ? h(
                    'div',
                    {
                      style: {
                        margin: '8px 12px',
                        padding: '6px 10px',
                        borderRadius: R_SM,
                        background: OK_TER,
                        color: OK,
                        fontSize: 12,
                      },
                    },
                    notice,
                  )
                : null,

              // 空状态
              data && bots.length === 0
                ? h(
                    'div',
                    {
                      style: {
                        padding: '20px 14px',
                        textAlign: 'center',
                      },
                    },
                    h(
                      'div',
                      { style: { fontSize: 13, color: LABEL_1, marginBottom: 4 } },
                      '还没有 Bot',
                    ),
                    h(
                      'div',
                      { style: { fontSize: 11, color: LABEL_3, marginBottom: 12 } },
                      'Bot 是一个常驻的 AI 同事：有自己的目标、记忆和工作区',
                    ),
                    h(
                      Btn,
                      {
                        kind: 'primary',
                        onClick: () => setForm({ kind: 'createBot' }),
                      },
                      '新建 Bot',
                    ),
                    h(
                      'div',
                      {
                        style: {
                          marginTop: 16,
                          paddingTop: 12,
                          borderTop: `1px solid ${BORDER_L1}`,
                          fontSize: 11,
                          color: LABEL_3,
                          textAlign: 'left',
                        },
                      },
                      h('div', { style: { marginBottom: 6, color: LABEL_2 } },
                        '也可以直接在对话框里说：',
                      ),
                      h(
                        'div',
                        {
                          style: {
                            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                            lineHeight: 1.9,
                            color: LABEL_2,
                          },
                        },
                        '「创建一个 Bot，叫文件管家，把下载文件夹整理干净」',
                        h('br'),
                        '「创建一个 Bot，叫日报员，每天 9 点汇总 Git 提交」',
                        h('br'),
                        '「创建一个 Bot，叫巡检员，长期盯着构建是否变红」',
                      ),
                    ),
                  )
                : null,

              // 列表
              bots.map((b) => {
                const isOpen = detailId === b.id;
                const budgetMax = b.budgetDaily ?? 5;
                return h(
                  'div',
                  { key: b.id, style: { borderTop: `1px solid ${BORDER_L1}` } },
                  h(
                    'div',
                    {
                      style: {
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 12px',
                      },
                    },
                    // 信息
                    h(
                      'div',
                      { style: { flex: 1, minWidth: 0 } },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', gap: 7 } },
                        h(
                          'span',
                          { style: { fontSize: 13, fontWeight: 500, color: LABEL_1 } },
                          b.name,
                        ),
                        b.lastRunStatus
                          ? h(
                              'span',
                              {
                                style: {
                                  fontSize: 10,
                                  color: statusColor(b.lastRunStatus),
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 3,
                                },
                              },
                              h('span', {
                                style: {
                                  width: 5,
                                  height: 5,
                                  borderRadius: 999,
                                  background: statusColor(b.lastRunStatus),
                                },
                              }),
                              statusText(b.lastRunStatus),
                            )
                          : null,
                      ),
                      h(
                        'div',
                        {
                          style: {
                            fontSize: 12,
                            color: LABEL_2,
                            marginTop: 3,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          },
                        },
                        b.role,
                      ),
                      // ⭐ 「他在守什么」——一行说清，这是 Dots 那一半的可见性
                      b.goalDescription
                        ? h(
                            'div',
                            {
                              style: {
                                display: 'flex',
                                alignItems: 'center',
                                gap: 5,
                                fontSize: 11,
                                marginTop: 4,
                                overflow: 'hidden',
                                whiteSpace: 'nowrap',
                              },
                            },
                            h('span', { style: { color: LABEL_3, flexShrink: 0 } }, '他在守'),
                            h(
                              'span',
                              {
                                style: {
                                  color: LABEL_1,
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                },
                              },
                              b.goalDescription,
                            ),
                            h(
                              'span',
                              {
                                style: {
                                  color: goalStatusColor(b.goalStatus),
                                  flexShrink: 0,
                                },
                              },
                              `· ${goalStatusText(b.goalStatus)}`,
                            ),
                            b.goalType === 'standing'
                              ? h(
                                  'span',
                                  { style: { color: LABEL_3, flexShrink: 0 } },
                                  '· 常驻',
                                )
                              : null,
                          )
                        : h(
                            'div',
                            { style: { fontSize: 11, color: LABEL_3, marginTop: 4 } },
                            '还没有目标 — 点「设目标」让他知道该守什么',
                          ),
                      h(
                        'div',
                        { style: { fontSize: 11, color: LABEL_3, marginTop: 4 } },
                        `${b.runCount} 次运行 · 上次 ${fmtAgo(b.lastRunAt)}` +
                          (b.memoryCount ? ` · 记得 ${b.memoryCount} 条` : ''),
                      ),
                    ),
                    // 动作
                    //
                    // 关于「演习」按钮的取舍：
                    //   用户反馈"不明所以，作用不大"。
                    //   原因是：它把"要不要先试"这个决策推给了用户，
                    //   而用户并不知道试一次能看出什么。
                    //
                    //   更好的做法不是删掉它，而是**让它只在有意义时出现**：
                    //   · 从没跑过 → 建议先演习
                    //   · 已跑成功过 → 收起，避免干扰
                    //   同时把文案从"演习"改成"先跑一遍看看"，
                    //   让人一眼知道它做什么。
                    h(
                      'div',
                      { style: { display: 'flex', gap: 6, flexShrink: 0 } },
                      // 仅在"还没成功跑过"时显示，降低干扰
                      !b.lastRunStatus || b.lastRunStatus === 'failed'
                        ? h(
                            Btn,
                            {
                              onClick: () => act('dry', b),
                              disabled: busy,
                              title: '先空跑一遍：会调用模型（有少量花费），但工具不会真实执行',
                              icon: h(IconDryRun, { size: 13 }),
                            },
                            '先看看',
                          )
                        : null,
                      h(
                        Btn,
                        {
                          kind: 'primary',
                          onClick: () => act('run', b),
                          disabled: busy,
                          title: '真实执行（执行前自动打快照）',
                          icon: h(IconRun, { size: 13 }),
                        },
                        '执行',
                      ),
                      h(
                        'button',
                        {
                          className: `${NS}-row-btn`,
                          onClick: () => setDetailId(isOpen ? null : b.id),
                          title: isOpen ? '收起详情' : '查看详情',
                          type: 'button',
                        },
                        '详情',
                        h(IconChevron, { size: 12, open: isOpen }),
                      ),
                    ),
                  ),

                  // 详情
                  //
                  // A 方案（三层折叠）+ D 方案（状态驱动）
                  //
                  // 第一层：状态摘要 —— 只显示"现在需要你知道的"
                  // 第二层：目标一行（正常时）
                  // 第三层：「更多」折叠 —— 记忆/例行/模型/预算/快照
                  //
                  // 结果：常态高度 ~3 行，不再挤成一坨。
                  isOpen
                    ? h(
                        'div',
                        {
                          className: `${NS}-fade`,
                          style: {
                            padding: '10px 12px 12px',
                            borderTop: `1px solid ${BORDER_L1}`,
                            background: BG_L3,
                          },
                        },

                        // 没展开详情数据时给个占位，避免闪空
                        !detail || detail.bot?.id !== b.id
                          ? h(
                              'div',
                              {
                                style: {
                                  fontSize: 11,
                                  color: LABEL_3,
                                  padding: '4px 0',
                                },
                              },
                              '正在读取…',
                            )
                          : h(
                              'div',
                              null,
                              // ---------- 第一层：状态摘要 ----------
                              renderSituation(b, detail, act, busy),

                              // ---------- 第二层：目标一行 ----------
                              detail.goal
                                ? h(
                                    'div',
                                    {
                                      style: {
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: 6,
                                        fontSize: 11,
                                        color: LABEL_3,
                                        marginBottom: 8,
                                        minWidth: 0,
                                      },
                                    },
                                    h(
                                      'span',
                                      { style: { flexShrink: 0 } },
                                      '目标',
                                    ),
                                    h(
                                      'span',
                                      {
                                        style: {
                                          color: LABEL_1,
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          whiteSpace: 'nowrap',
                                        },
                                      },
                                      detail.goal.description,
                                    ),
                                    h(
                                      'span',
                                      {
                                        style: {
                                          color: goalStatusColor(detail.goal.status),
                                          flexShrink: 0,
                                        },
                                      },
                                      goalStatusText(detail.goal.status),
                                    ),
                                    detail.goal.cadence
                                      ? h(
                                          'span',
                                          { style: { flexShrink: 0 } },
                                          `· ${detail.goal.cadence}`,
                                        )
                                      : null,
                                  )
                                : null,

                              // ---------- 第三层：最近运行（常驻，不再藏进「更多」） ----------
                              //
                              // 用户明确要求：运行记录不该藏在折叠里。
                              // 但也不能全量平铺（那就是"挤成一坨"）。
                              // 折中：**只显示最近 2 条**，完整列表和管理进设置页。
                              detail.runs?.length
                                ? h(
                                    'div',
                                    { style: { marginBottom: 6 } },
                                    h(
                                      'div',
                                      {
                                        style: {
                                          display: 'flex',
                                          alignItems: 'baseline',
                                          gap: 6,
                                          marginBottom: 4,
                                        },
                                      },
                                      h(
                                        'span',
                                        {
                                          style: {
                                            fontSize: 11,
                                            fontWeight: 600,
                                            color: LABEL_2,
                                          },
                                        },
                                        '最近运行',
                                      ),
                                      h(
                                        'span',
                                        { style: { fontSize: 10, color: LABEL_3 } },
                                        `共 ${detail.runs.length} 条 · 管理在设置里`,
                                      ),
                                    ),
                                    ...detail.runs.slice(0, 2).map((r) =>
                                      h(
                                        'div',
                                        {
                                          key: r.id,
                                          style: {
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 6,
                                            fontSize: 11,
                                            lineHeight: '18px',
                                          },
                                        },
                                        h('span', {
                                          style: {
                                            width: 5,
                                            height: 5,
                                            borderRadius: 999,
                                            background: statusColor(r.status),
                                            flexShrink: 0,
                                          },
                                        }),
                                        h(
                                          'span',
                                          { style: { color: LABEL_3, flexShrink: 0 } },
                                          r.startedAt.slice(5, 16).replace('T', ' '),
                                        ),
                                        h(
                                          'span',
                                          {
                                            style: {
                                              color: statusColor(r.status),
                                              flexShrink: 0,
                                            },
                                          },
                                          statusText(r.status),
                                        ),
                                        r.dryRun
                                          ? h(
                                              'span',
                                              { style: { color: LABEL_3 } },
                                              '演习',
                                            )
                                          : null,
                                        h(
                                          'span',
                                          {
                                            style: {
                                              color: LABEL_3,
                                              marginLeft: 'auto',
                                              flexShrink: 0,
                                            },
                                          },
                                          fmtCost(r.usage),
                                        ),
                                      ),
                                    ),
                                  )
                                : null,

                              // ---------- 第四层 L2：他知道什么（默认折叠） ----------
                              h(
                                'button',
                                {
                                  className: `${NS}-row-btn`,
                                  onClick: () =>
                                    setMoreOpen((v) => (v === b.id ? null : b.id)),
                                  type: 'button',
                                  style: {
                                    fontSize: 11,
                                    color: LABEL_3,
                                    marginBottom: 6,
                                  },
                                },
                                moreOpen === b.id
                                  ? '收起「他知道什么」'
                                  : '他知道什么 ▾（记忆 / 例行流程）',
                              ),

                              moreOpen === b.id
                                ? h(
                                    'div',
                                    null,
                                    detail.semantic?.facts?.length
                                      ? renderMemory(detail.semantic)
                                      : null,
                                    detail.routines?.length
                                      ? renderRoutines(detail.routines)
                                      : null,
                                    !(detail.semantic?.facts?.length) && !(detail.routines?.length)
                                      ? h(
                                          'div',
                                          {
                                            style: {
                                              fontSize: 10, color: LABEL_3, lineHeight: 1.8,
                                              padding: '6px 8px', borderRadius: R_SM, background: BG_L3,
                                              marginBottom: 6,
                                            },
                                          },
                                          '还没有长期记忆。从下一次定时运行起，每轮报告的首行结论会自动蒸馏到这里（上限 50 条，去重）。',
                                        )
                                      : null,
                                  )
                                : null,

                              // ---------- 第五层 L3：配置与危险操作（默认折叠，红色隔离） ----------
                              h(
                                'button',
                                {
                                  className: `${NS}-row-btn`,
                                  onClick: () =>
                                    setDangerOpen((v) => (v === b.id ? null : b.id)),
                                  type: 'button',
                                  style: {
                                    fontSize: 11,
                                    color: ERR,
                                    marginBottom: 6,
                                  },
                                },
                                dangerOpen === b.id
                                  ? '收起「配置与危险操作」'
                                  : '配置与危险操作 ▾（模型 / 预算 / 快照 / 回滚 / 删除）',
                              ),

                              dangerOpen === b.id
                                ? h(
                                    'div',
                                    {
                                      style: {
                                        border: `1px solid ${ERR}`,
                                        borderRadius: R_SM,
                                        padding: '8px 10px',
                                        marginBottom: 6,
                                      },
                                    },
                                    // 模型
                                    h(
                                      'div',
                                      { style: { marginBottom: 10 } },
                                      h(
                                        SectionTitle,
                                        { hint: '用哪个模型干活' },
                                        '模型',
                                      ),
                                      h(
                                        'div',
                                        {
                                          style: {
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 8,
                                            fontSize: 11,
                                          },
                                        },
                                        h(
                                          'span',
                                          {
                                            style: {
                                              color: LABEL_1,
                                              fontFamily:
                                                'ui-monospace, SFMono-Regular, Menlo, monospace',
                                              overflow: 'hidden',
                                              textOverflow: 'ellipsis',
                                              whiteSpace: 'nowrap',
                                            },
                                          },
                                          `${detail.bot.model?.provider ?? '?'} / ${
                                            detail.bot.model?.model ?? '?'
                                          }`,
                                        ),
                                        h(
                                          Btn,
                                          {
                                            onClick: () =>
                                              act.onOpenModel?.({
                                                botId: b.id,
                                                botName: b.name,
                                                provider: detail.bot.model?.provider,
                                                model: detail.bot.model?.model,
                                              }),
                                            disabled: busy,
                                          },
                                          '改',
                                        ),
                                      ),
                                    ),
                                    // 预算
                                    h(
                                      'div',
                                      { style: { marginBottom: 10 } },
                                      h(
                                        'div',
                                        {
                                          style: {
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            fontSize: 11,
                                            color: LABEL_2,
                                          },
                                        },
                                        h('span', null, '今日花费'),
                                        h(
                                          'span',
                                          { style: { color: LABEL_1 } },
                                          `${fmtCny(b.todayCostCny)} / ¥${budgetMax.toFixed(2)}`,
                                        ),
                                      ),
                                      h(Meter, {
                                        value: b.todayCostCny,
                                        max: budgetMax,
                                      }),
                                    ),
                                    // 可撤回 + 危险操作
                                    h(
                                      'div',
                                      {
                                        style: {
                                          display: 'flex',
                                          gap: 6,
                                          flexWrap: 'wrap',
                                        },
                                      },
                                      h(
                                        Btn,
                                        {
                                          onClick: () => act('snapshot', b),
                                          disabled: busy,
                                          icon: h(IconSnapshot, { size: 13 }),
                                        },
                                        '打快照',
                                      ),
                                      h(ConfirmBtn, {
                                        label: '回滚',
                                        confirmLabel: '确认回滚？',
                                        kind: 'danger',
                                        icon: h(IconRollback, { size: 13 }),
                                        disabled: busy,
                                        onConfirm: () => act('rollback', b),
                                      }),
                                      h(ConfirmBtn, {
                                        label: '删除',
                                        confirmLabel: '确认删除？不可恢复',
                                        kind: 'danger',
                                        disabled: busy,
                                        onConfirm: () => act('botDelete', b),
                                      }),
                                    ),
                                  )
                                : null,
                            ),
                      )
                    : null,
                );
              }),
            ),

            // 关闭滚动容器
            ),
            );
          } catch (e) {
            report('render-error', String(e?.message ?? e));
            return null;
          }
        }

        /**
         * DSH 官方设置页里的「Bot」分区。
         *
         * 与面板内的设置视图共用同一个 SettingsView，只是外壳不同：
         *   · 官方设置页：由 shell 提供页签与标题，我们只渲染内容
         *   · 面板内：自带「关闭设置」按钮
         *
         * 这样用户既能从系统设置进，也能从 Bot 面板进——两条路一份实现。
         */
        function BotSettingsSection() {
          try {
            const save = React.useCallback(async (next) => {
              try {
                await fetch('/_dsh-bot/settings', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ settings: next }),
                });
              } catch {
                /* 保存失败下次再试 */
              }
            }, []);

            const load = React.useCallback(async () => {
              const r = await fetch('/_dsh-bot/settings', {
                headers: { accept: 'application/json' },
              });
              const j = await r.json();
              if (!j?.ok) throw new Error(j?.message || '读取失败');
              return j.value.effective;
            }, []);

            const clearRuns = React.useCallback(async () => {
              try {
                const r = await fetch('/_dsh-bot/overview', {
                  headers: { accept: 'application/json' },
                });
                const j = await r.json();
                const first = j?.value?.bots?.[0];
                if (!first) return;
                await fetch('/_dsh-bot/runs/clear', {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({ botId: first.id, confirm: true }),
                });
              } catch {
                /* 忽略 */
              }
            }, []);

            return h(
              'div',
              {
                style: {
                  padding: '4px 0 16px',
                  fontFamily: FONT,
                  color: LABEL_1,
                  maxWidth: 620,
                },
              },
              h(
                'div',
                { style: { fontSize: 13, fontWeight: 600, marginBottom: 10 } },
                'Bot',
              ),
              h(SettingsView, {
                busy: false,
                onClose: () => {},
                onLoad: load,
                onSave: save,
                onClearRuns: clearRuns,
                hideClose: true,
              }),
            );
          } catch (e) {
            report('settings-section-render-error', String(e?.message ?? e));
            return null;
          }
        }

        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            { name: 'conversation.input.dock', id: 'dsh-bot', order: 20 },
            BotDock,
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
            const title =
              run.status === 'success'
                ? `✅ ${botName}：运行完成`
                : run.status === 'partial'
                  ? `🟡 ${botName}：部分成功`
                  : run.status === 'budget_exceeded'
                    ? `🛑 ${botName}：预算熔断`
                    : `❌ ${botName}：运行失败`;
            const cost = run.usage
              ? run.usage.costKind === 'free'
                ? '免费'
                : Number.isFinite(run.usage.costCny)
                  ? `¥${run.usage.costCny.toFixed(4)}`
                  : '费用未知'
              : '—';
            const body = `${new Date(run.startedAt).toLocaleTimeString('zh-CN')} · ${cost}` +
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
          const notifyTick = async () => {
            if (notifying) return;
            notifying = true;
            try {
              const sRes = await fetch('/_dsh-bot/settings', { headers: { accept: 'application/json' } });
              const sJson = await sRes.json();
              const settings = sJson?.ok ? sJson.value?.effective : null;
              if (!settings?.notifySystem) return;
              if (inQuietHours(settings.quietHours)) return;

              const oRes = await fetch('/_dsh-bot/overview', { headers: { accept: 'application/json' } });
              const oJson = await oRes.json();
              if (!oJson?.ok) return;
              const bots = oJson.value?.bots ?? [];
              if (!bots.length) return;

              const lastSeen = readLastSeen();
              let newest = lastSeen;
              // 每个新完成运行都要看；为控制请求量只拉每 Bot 最近 5 条
              for (const b of bots) {
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
                  if (settings.notifyOnlyOnDecision !== true && !attention) {
                    // 全部提醒模式：成功也响
                    fireNotification(b.name, run);
                  } else if (attention) {
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

