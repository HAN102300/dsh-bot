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

