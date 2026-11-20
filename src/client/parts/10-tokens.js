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

