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

