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
