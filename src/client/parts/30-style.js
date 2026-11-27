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

/* ============================================================
   记忆（v0.3.11）：限高滚动 + 时间栏对齐 + 全量弹窗
   —— 旧实现无高度上限，21 条就撑到 1100px，把下面的卡片挤走。
   ============================================================ */
.${NS}-c-memwrap { position: relative; }
.${NS}-c-memwrap::after {
  content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 30px;
  pointer-events: none; opacity: 1; transition: opacity .2s;
  background: linear-gradient(180deg, transparent, var(--c-card));
}
.${NS}-c-memwrap.at-bottom::after { opacity: 0; }

.${NS}-c-memscroll {
  max-height: 258px; overflow-y: auto; overscroll-behavior: contain;
  padding-right: 4px;
}
.${NS}-c-memscroll::-webkit-scrollbar { width: 8px; }
.${NS}-c-memscroll::-webkit-scrollbar-track { background: transparent; }
.${NS}-c-memscroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.14); border-radius: 8px; }
.${NS}-c-memscroll::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,.24); }

/* 一行：92px 时间 | 6px 圆点 | 正文 */
.${NS}-c-mem {
  display: grid; grid-template-columns: 92px 6px minmax(0, 1fr);
  gap: 10px; align-items: start;
  padding: 9px 0; border-top: 0.5px solid var(--c-stroke);
}
.${NS}-c-mem:first-child { border-top: 0; }

/* 时间栏：等宽数字，日期/时刻分段着色 → 纵向严格对齐 */
.${NS}-c-mem-time {
  font-size: 11px; line-height: 20px; white-space: nowrap;
  font-variant-numeric: tabular-nums; color: var(--c-l3);
}
.${NS}-c-mem-time .d { color: var(--c-l2); }
.${NS}-c-mem-time .t { color: var(--c-l3); }
.${NS}-c-mem-time .none { color: var(--c-l4); }

.${NS}-c-mem-dot {
  width: 6px; height: 6px; border-radius: 999px;
  background: var(--c-brand); margin-top: 7px;
}
.${NS}-c-mem-dot.pref { background: var(--c-warn); }

.${NS}-c-mem-main { min-width: 0; }
.${NS}-c-mem-text {
  margin: 0; font-size: 13px; line-height: 20px; color: var(--c-l2);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden; cursor: pointer;
}
.${NS}-c-mem-text.open { -webkit-line-clamp: unset; }
.${NS}-c-mem-text b { color: var(--c-l1); font-weight: 500; }
.${NS}-c-mem-text mark {
  background: rgba(224,116,92,.28); color: var(--c-l1);
  border-radius: 3px; padding: 0 2px;
}
.${NS}-c-kd {
  display: inline-flex; align-items: center; height: 18px; padding: 0 7px;
  border-radius: 999px; background: var(--c-layer3); color: var(--c-l2);
  font-size: 11px; font-weight: 500; white-space: nowrap;
  margin-right: 6px; vertical-align: 1px;
}
.${NS}-c-kd.pref { color: var(--c-warn); background: rgba(224,178,92,.12); }

.${NS}-c-mem-more {
  font-size: 11px; color: var(--c-brand-text);
  cursor: pointer; margin-top: 1px; display: inline-block;
}

/* 卡片底栏：显示 N/M + 查看全部 */
.${NS}-c-memfoot {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 16px; border-top: 0.5px solid var(--c-stroke);
  font-size: 12px; color: var(--c-l3);
}
.${NS}-c-memfoot .grow { flex: 1; }

/* ---------- 记忆全量弹窗 ---------- */
.${NS}-c-mm-back {
  position: fixed; inset: 0; z-index: 10000;
  background: rgba(0,0,0,.6);
  display: flex; align-items: center; justify-content: center;
  padding: 24px; font-family: ${FONT};
}
.${NS}-c-mm {
  width: 100%; max-width: 620px; max-height: min(78vh, 720px);
  display: flex; flex-direction: column; overflow: hidden;
  border: 0.5px solid var(--c-stroke, var(--dsw-alias-border-l2));
  border-radius: var(--c-r-lg);
  background: var(--c-layer3, var(--dsw-alias-bg-layer-3, #242429));
  box-shadow: 0 24px 64px rgba(0,0,0,.55);
}
.${NS}-c-mm-head {
  flex: none; display: flex; align-items: center; gap: 10px;
  padding: 14px 18px; border-bottom: 0.5px solid var(--c-stroke);
}
.${NS}-c-mm-head .t { font-size: 15px; font-weight: 600; color: var(--c-l1); }
.${NS}-c-mm-head .c { font-size: 12px; color: var(--c-l3); }
.${NS}-c-mm-x {
  margin-left: auto; width: 26px; height: 26px; border-radius: var(--c-r-md);
  border: none; background: transparent; color: var(--c-l3);
  cursor: pointer; display: grid; place-items: center;
  font-size: 15px; line-height: 1; font-family: inherit;
}
.${NS}-c-mm-x:hover { background: var(--c-hover); color: var(--c-l1); }

.${NS}-c-mm-tools {
  flex: none; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  padding: 12px 18px; border-bottom: 0.5px solid var(--c-stroke);
}
.${NS}-c-mm-search {
  flex: 1; min-width: 180px; height: 30px; border-radius: var(--c-r-md);
  border: 0.5px solid var(--c-stroke); background: var(--c-card);
  color: var(--c-l1); font-size: 12px; padding: 0 10px; outline: none;
  font-family: inherit;
}
.${NS}-c-mm-search::placeholder { color: var(--c-l4); }
.${NS}-c-mm-search:focus { border-color: var(--c-l3); }
.${NS}-c-mm-chip {
  height: 26px; padding: 0 11px; border-radius: 999px;
  border: 0.5px solid var(--c-stroke); background: transparent;
  color: var(--c-l2); font-size: 11px; font-weight: 500;
  display: inline-flex; align-items: center; gap: 5px;
  cursor: pointer; font-family: inherit;
}
.${NS}-c-mm-chip:hover { background: var(--c-hover); }
.${NS}-c-mm-chip.on { background: var(--c-layer3); color: var(--c-l1); }
.${NS}-c-mm-chip .n { color: var(--c-l3); font-variant-numeric: tabular-nums; }
.${NS}-c-mm-chip.on .n { color: var(--c-l2); }

.${NS}-c-mm-list {
  flex: 1 1 auto; min-height: 0; overflow-y: auto;
  padding: 4px 18px 12px;
}
.${NS}-c-mm-list::-webkit-scrollbar { width: 8px; }
.${NS}-c-mm-list::-webkit-scrollbar-thumb { background: rgba(255,255,255,.14); border-radius: 8px; }

.${NS}-c-mm-empty { padding: 28px 8px; text-align: center; font-size: 12px; color: var(--c-l3); }

.${NS}-c-mm-foot {
  flex: none; display: flex; align-items: center; gap: 8px;
  padding: 10px 18px; border-top: 0.5px solid var(--c-stroke);
  font-size: 11px; color: var(--c-l3);
}
.${NS}-c-mm-foot .grow { flex: 1; }
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

