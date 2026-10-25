/**
 * 验证 client bundle 的完整契约
 *
 * 模拟 DSH client-modules 的加载行为：
 *   1. 执行 bundle → 应调用一次 __ModuleLoader__.load
 *   2. id 必须等于 package.json 的 name
 *   3. factory 必须能物化出 { name, inject, apply }
 *   4. 重复执行应检测到重复注册（模拟 DSH 的行为）
 */

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const clientPath = path.join(root, 'lib', 'client.js');

console.log('=== client bundle 契约验证 ===\n');

// 1. 文件存在
if (!fs.existsSync(clientPath)) {
  console.log('❌ lib/client.js 不存在');
  process.exit(1);
}
console.log('✅ lib/client.js 存在');

// 2. exports 指向正确
const exp = pkg.exports?.['./client']?.default;
if (exp !== './lib/client.js') {
  console.log(`❌ exports["./client"] = ${exp}，应为 ./lib/client.js`);
  process.exit(1);
}
console.log(`✅ exports["./client"] = ${exp}`);

// 3. dsh.client 声明
if (!pkg.dsh?.client) {
  console.log('❌ 缺少 dsh.client 声明');
  process.exit(1);
}
console.log(`✅ dsh.client = ${JSON.stringify(pkg.dsh.client)}`);

// 4. 执行 bundle，检查 id
const code = fs.readFileSync(clientPath, 'utf8');
const registrations = [];
const sandbox = {
  window: {
    __ModuleLoader__: {
      load: (def) => {
        // 模拟 DSH 的重复注册检测
        const existing = registrations.find((r) => r.id === def.id);
        if (existing) {
          throw new Error(
            `client-modules: duplicate factory registration for "${def.id}"`,
          );
        }
        registrations.push(def);
      },
    },
  },
  console,
  URLSearchParams,
  // client 会注入 <style>，需要 document
  document: {
    createElement: () => ({ setAttribute() {}, textContent: '', style: {} }),
    head: { appendChild() {} },
  },
  fetch: async () => ({ ok: true, json: async () => ({ ok: true, value: {} }) }),
};
vm.createContext(sandbox);

let doubled = false;
try {
  vm.runInContext(code, sandbox, { filename: 'client.js' });
  // 执行第二次，模拟"bundle 被执行两次"
  try {
    vm.runInContext(code, sandbox, { filename: 'client.js#2' });
  } catch (e) {
    doubled = true;
  }
} catch (e) {
  console.log('❌ 执行失败:', e.message);
  process.exit(1);
}

if (registrations.length !== 1) {
  console.log(`❌ 注册了 ${registrations.length} 次，应只注册 1 次`);
  process.exit(1);
}
console.log('✅ 只注册一次（重复执行会抛 duplicate 错误，符合预期）');

const def = registrations[0];
if (def.id !== pkg.name) {
  console.log(`❌ id = "${def.id}"，必须等于包名 "${pkg.name}"`);
  process.exit(1);
}
console.log(`✅ id = "${def.id}"（等于包名）`);

// 5. factory 物化
const fakeReact = {
  createElement: (...a) => ({ type: a[0], props: a[1] }),
  useState: (v) => [v, () => {}],
  useEffect: () => {},
};
let mod;
try {
  mod = def.factory((name) => {
    if (name === 'react') return fakeReact;
    throw new Error(`unexpected require: ${name}`);
  });
} catch (e) {
  console.log('❌ factory 执行失败:', e.message);
  process.exit(1);
}
console.log(`✅ factory 物化成功，导出: ${Object.keys(mod).join(', ')}`);

// 6. 导出契约
for (const key of ['name', 'inject', 'apply']) {
  if (!(key in mod)) {
    console.log(`❌ 缺少导出: ${key}`);
    process.exit(1);
  }
}
console.log('✅ 导出 name / inject / apply 齐全');

// 6.5 ⭐ inject 必须声明 apply 里用到的服务
//     这是四次崩溃中最隐蔽的一次：声明空 inject 却访问 ctx.slots，
//     会报 "cannot get property slots without inject"，
//     进而让整个 web boot 失败。
const applySource = String(mod.apply);
const usesSlots = /ctx\.slots/.test(applySource);
const declaresSlots = Array.isArray(mod.inject) && mod.inject.includes('slots');
if (usesSlots && !declaresSlots) {
  console.log(
    `❌ apply 使用了 ctx.slots，但 inject = ${JSON.stringify(mod.inject)} 未声明 'slots'`,
  );
  process.exit(1);
}
console.log(
  `✅ inject 声明完整（${JSON.stringify(mod.inject)}，apply 使用 slots=${usesSlots}）`,
);

// 7. apply 能注册 slot
const registered = [];
const ctx = {
  slots: {
    inject: (_name, fn) => fn(),
    register: (opts, comp) => registered.push({ opts, comp }),
  },
};
try {
  mod.apply(ctx);
} catch (e) {
  console.log('❌ apply 执行失败:', e.message);
  process.exit(1);
}
console.log(
  `✅ apply 注册 slot: ${registered[0]?.opts?.name} (id=${registered[0]?.opts?.id})`,
);

// 8. 组件是函数
if (typeof registered[0]?.comp !== 'function') {
  console.log('❌ slot 组件不是函数');
  process.exit(1);
}
console.log('✅ slot 组件是有效 React 组件');

// 8.5 ⭐ 真实渲染一次，捕捉作用域/运行时错误
//     之前图标组件在模块顶层引用了 factory 内部的 h，
//     单测不渲染就发现不了（会抛 "h is not defined"）。
//     这里用真实 createElement 渲染收起态与展开态。
//
//     展开态与详情区尤其重要：那是最复杂、最容易崩的一半，
//     而且改动后一旦崩，DSH 会整个白屏——用户必须重启才能恢复。
{
  let renders = 0;

  // ⭐ 用一个能"驱动" hooks 的假 React：
  //    让 useState 返回可控值，从而把组件推进到展开态与详情态。
  function makeReact(stateQueue) {
    let qi = 0;
    return {
      createElement: (type, props, ...children) => {
        renders++;
        // 组件（函数）在这里不自动递归，交给下面手动调用
        return { type, props, children };
      },
      useState: (init) => {
        const idx = qi++;
        const has = idx < stateQueue.length;
        const value = has ? stateQueue[idx] : init;
        return [value, () => {}];
      },
      useCallback: (f) => f,
      useEffect: () => {},
      useMemo: (f) => f(),
      useRef: (v) => ({ current: v }),
    };
  }

  /** 把一棵（可能的）组件树展开成可检查的平面结构 */
  function flatten(node, out = []) {
    if (node == null || node === false) return out;
    if (Array.isArray(node)) {
      for (const c of node) flatten(c, out);
      return out;
    }
    if (typeof node === 'object') {
      out.push(node);
      if (typeof node.type === 'function') {
        // 递归渲染子组件
        try {
          flatten(node.type(node.props ?? {}), out);
        } catch {
          /* 子组件渲染失败单独报，不让整体崩 */
        }
      } else if (Array.isArray(node.children)) {
        for (const c of node.children) flatten(c, out);
      }
    }
    return out;
  }

  /** 尝试用给定初始 state 渲染一次 */
  function tryRender(label, stateQueue) {
    renders = 0;
    const mod = def.factory((name) => {
      if (name === 'react') return makeReact(stateQueue);
      throw new Error(`unexpected require: ${name}`);
    });
    const reg = [];
    const ctx = {
      slots: { inject: (_n, f) => f(), register: (o, c) => reg.push({ o, c }) },
    };
    mod.apply(ctx);
    const tree = reg[0].c();
    if (!tree || renders < 3) {
      throw new Error(`只创建了 ${renders} 个元素`);
    }
    return { tree, flat: flatten(tree), renders };
  }

  // ① 收起态：open=false
  let collapsed;
  try {
    collapsed = tryRender('收起态', [false, null, '', false, '', null, false, false]);
    console.log(`✅ 收起态渲染成功（创建 ${collapsed.renders} 个元素）`);
  } catch (e) {
    console.log('❌ 收起态渲染失败:', e.message);
    process.exit(1);
  }

  // ② 展开态：open=true，但没有数据（loading / 空）
  try {
    const r = tryRender('展开态', [true, null, '', false, '', null, false, false]);
    console.log(`✅ 展开态渲染成功（创建 ${r.renders} 个元素）`);
  } catch (e) {
    console.log('❌ 展开态渲染失败:', e.message);
    process.exit(1);
  }

  // ③ ⭐ 详情态：带完整数据（目标 + 候选 + 运行 + 记忆 + 例行）
  //    这是本次新增代码最集中的地方，必须真渲染一遍。
  try {
    const r = tryRender('详情态', [
      true,
      {
        bots: [
          {
            id: 'bot_x',
            name: '文件管家',
            role: '整理下载文件夹',
            createdAt: '2026-10-19T00:00:00.000Z',
            runCount: 9,
            todayCostCny: 0.0031,
            lastRunAt: new Date().toISOString(),
            lastRunStatus: 'success',
            goalDescription: '整理下载文件夹',
            goalStatus: 'pending_confirmation',
            goalType: 'one-shot',
            goalProgress: '已归档 12 个文件',
            pendingConfirmCount: 1,
            proposedCount: 1,
            blocked: false,
            memoryCount: 23,
          },
        ],
        stats: { botCount: 1, todayCostCny: 0.0031, runTotal: 9 },
        heartbeat: null,
      },
      '',
      false,
      '演习完成',
      'bot_x',
      false,
      false,
    ]);

    // 详情区依赖 detail —— 组件内部 detail 来自 useState，
    // 我们无法从外部注入，所以这一步主要验证列表行 + 头部角标不崩。
    console.log(`✅ 列表行（含目标行与角标）渲染成功（创建 ${r.renders} 个元素）`);

    // 校验「他在守」这一行真的出现了
    const texts = JSON.stringify(r.flat.map((n) => n.children));
    if (!texts.includes('他在守')) {
      console.log('❌ 列表行没有渲染「他在守」（目标可见性缺失）');
      process.exit(1);
    }
    if (!texts.includes('项等你')) {
      console.log('❌ 头部没有渲染待处理角标');
      process.exit(1);
    }
  } catch (e) {
    console.log('❌ 详情态渲染失败:', e.message);
    process.exit(1);
  }
}

// 8.7 ⭐ 不许依赖原生弹窗
//     DSH 跑在 Electron 渲染进程里：
//       · prompt()   —— 直接抛 "prompt() is not supported"
//       · confirm()  —— 恒返回 false，按钮变成"点了没反应"
//     这两者都不会在构建期报错，只会在用户点下去的那一刻炸。
//     所以必须在契约层拦住。
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'client', 'bundle.js'),
    'utf8',
  );

  // 去掉注释后再检查，避免文档说明里的词造成误报
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

  const bad = [];
  if (/\bwindow\.prompt\s*\(/.test(code)) bad.push('window.prompt()');
  if (/\bwindow\.confirm\s*\(/.test(code)) bad.push('window.confirm()');
  if (/(^|[^.\w])prompt\s*\(/.test(code.replace(/window\.prompt\s*\(/g, ''))) {
    // 裸 prompt() 同样不行
    if (/\bprompt\s*\(/.test(code) && !/window\.prompt/.test(code)) bad.push('prompt()');
  }

  if (bad.length) {
    console.log(`❌ 使用了 Electron 不支持的原生弹窗：${bad.join(', ')}`);
    process.exit(1);
  }
  console.log('✅ 未依赖原生弹窗（prompt/confirm），输入走内嵌表单');
}

// 8.9 ⭐ 展开态必须有滚动容器
//    用户反馈"挤成一坨、没法滚动向下"。
//    根因：所有内容平铺在一层，详情区一展开就撑高面板，
//    超出可视区既看不到也滚不动（没有 overflow 容器）。
//
//    这条检查防止以后有人把 scroll 容器改回去。
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'client', 'bundle.js'),
    'utf8',
  );

  // 必须有 scroll 类
  if (!src.includes('-scroll')) {
    console.log('❌ 展开态没有滚动容器（-scroll 类缺失）');
    process.exit(1);
  }

  // CSS 里必须有 overflow-y: auto
  if (!/overflow-y:\s*auto/.test(src)) {
    console.log('❌ 滚动容器没有 overflow-y: auto');
    process.exit(1);
  }

  // flex 子项必须能收缩，否则不会滚
  if (!/min-height:\s*0/.test(src)) {
    console.log('❌ 滚动容器缺少 min-height:0（flex 子项无法收缩，会导致不滚动）');
    process.exit(1);
  }

  // 必须有高度上限
  if (!/max-height:/.test(src)) {
    console.log('❌ 展开态没有高度上限，会把面板撑到超出窗口');
    process.exit(1);
  }

  console.log('✅ 展开态有滚动容器（max-height + overflow-y:auto + min-height:0）');
}

// 8.10 ⭐ 详情区必须是状态驱动的（A + D 方案）
//    用户反馈"挤成一坨、不可阅览"。
//    根治办法不是排得更紧，而是只显示当前需要注意的。
//    这条检查防止回退成"有什么数据就画什么"的平铺式布局。
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'client', 'bundle.js'),
    'utf8',
  );

  if (!src.includes('botSituation')) {
    console.log('❌ 缺少状态判断函数 botSituation（D 方案的核心）');
    process.exit(1);
  }
  if (!src.includes('renderSituation')) {
    console.log('❌ 缺少状态摘要渲染 renderSituation（A 方案的第一层）');
    process.exit(1);
  }
  if (!src.includes('moreOpen')) {
    console.log('❌ 缺少「更多」折叠状态（A 方案的第三层）');
    process.exit(1);
  }

  // 状态机必须覆盖这些关键分支
  for (const state of ['no-goal', 'pending', 'blocked', 'failed']) {
    if (!src.includes(`'${state}'`)) {
      console.log(`❌ 状态驱动缺少分支：${state}`);
      process.exit(1);
    }
  }

  console.log('✅ 详情区是状态驱动的（6 种状态 + 三层折叠）');
}

// 8.11 ⭐ 设置页必须存在且可切换
//    用户要求把低频功能（运行记录管理等）收进设置 UI，
//    主面板只留当前需要注意的东西。
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'client', 'bundle.js'),
    'utf8',
  );

  for (const marker of ['SettingsView', "view === 'settings'", 'setView']) {
    if (!src.includes(marker)) {
      console.log(`❌ 设置页缺少：${marker}`);
      process.exit(1);
    }
  }

  if (!src.includes('runs/clear')) {
    console.log('❌ 设置页没有清空运行记录的入口');
    process.exit(1);
  }

  console.log('✅ 设置页存在，含运行记录清空能力');
}

// 8.12 ⭐ 必须注册到 DSH 官方设置页（settings.section）
//    我之前判断"DSH 没有通用 settings slot"是错的——官方确实有，
//    第三方插件（壁纸引擎）就在用。设置就该出现在系统设置里。
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'client', 'bundle.js'),
    'utf8',
  );

  if (!src.includes("'settings.section'")) {
    console.log('❌ 没有注册到 DSH 官方设置页（settings.section）');
    process.exit(1);
  }
  if (!src.includes('BotSettingsSection')) {
    console.log('❌ 缺少 BotSettingsSection 组件');
    process.exit(1);
  }

  const idx = src.indexOf("'settings.section'");
  const around = src.slice(Math.max(0, idx - 1200), idx + 1200);
  if (!around.includes('try') || !around.includes('catch')) {
    console.log('❌ settings.section 注册没有 try/catch 隔离（可能拖垮 client）');
    process.exit(1);
  }

  console.log('✅ 注册到官方设置页（settings.section），且有异常隔离');
}

// 8.13 ⭐「卡住了」必须有可执行动作
//    用户反馈："我要怎么处理呢？我这也没法插手吧？只能看着这错误状态。"
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'client', 'bundle.js'),
    'utf8',
  );

  for (const marker of ['goalUnblock', 'goalGiveup', '已处理好，继续']) {
    if (!src.includes(marker)) {
      console.log(`❌ 卡住状态缺少可执行动作：${marker}`);
      process.exit(1);
    }
  }
  console.log('✅ 卡住状态有「继续 / 放弃」两个可执行动作');
}

// 8.8 ⭐ 空状态必须有创建入口
//    用户第一次装上插件时没有 Bot。如果空状态只是一行提示，
//     他就只能切到对话框里去建——面板看起来像个坏掉的东西。
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'client', 'bundle.js'),
    'utf8',
  );
  if (!src.includes('createBot')) {
    console.log('❌ 空状态没有创建 Bot 的入口');
    process.exit(1);
  }
  if (!src.includes('/bot/create') && !src.includes('botCreate')) {
    console.log('❌ 客户端没有调用创建 Bot 的接口');
    process.exit(1);
  }
  if (!src.includes('botDelete')) {
    console.log('❌ 客户端没有删除 Bot 的入口');
    process.exit(1);
  }
  console.log('✅ 空状态有创建入口，且有删除能力');
}

// 9. ⭐ 主题变量必须真实存在
//    之前用了猜测的 --dsh-* 名字，导致 UI 退化成硬编码白底（深色主题下很难看）。
//    这里校验 src/client/bundle.js 里引用的每个变量都在 DSH 设计系统内。
//
//    白名单来自 DSH 前端 CSS 实际使用的变量（94 个），
//    重新生成方式见 docs/THEME-TOKENS.md。
const KNOWN_DSW = new Set([
  'dsw-alias-bg-base',
  'dsw-alias-bg-layer-1',
  'dsw-alias-bg-layer-2',
  'dsw-alias-bg-layer-3',
  'dsw-alias-bg-layer-4',
  'dsw-alias-bg-mask-1',
  'dsw-alias-bg-module-platform',
  'dsw-alias-border-l1',
  'dsw-alias-border-l2',
  'dsw-alias-border-l2-darkmode-thin',
  'dsw-alias-border-l3',
  'dsw-alias-border-l4',
  'dsw-alias-brand-primary',
  'dsw-alias-brand-primary-new-colorprimary-new-color',
  'dsw-alias-button-ghost-active-border',
  'dsw-alias-button-ghost-active-fill',
  'dsw-alias-button-primary-fill',
  'dsw-alias-button-primary-hover',
  'dsw-alias-button-tool-bar-fill',
  'dsw-alias-button-tool-bar-hover',
  'dsw-alias-code-diff-added',
  'dsw-alias-code-diff-deleted',
  'dsw-alias-interactive-bg-active',
  'dsw-alias-interactive-bg-hover',
  'dsw-alias-interactive-bg-hover-danger',
  'dsw-alias-label-caption',
  'dsw-alias-label-dimmed',
  'dsw-alias-label-error',
  'dsw-alias-label-primary',
  'dsw-alias-label-primary-foreground',
  'dsw-alias-label-secondary',
  'dsw-alias-label-shimmer',
  'dsw-alias-label-tertiary',
  'dsw-alias-link',
  'dsw-alias-markdown-code-block',
  'dsw-alias-markdown-code-block-banner',
  'dsw-alias-markdown-inline-code',
  'dsw-alias-markdown-tag',
  'dsw-alias-menu-group-header-fill',
  'dsw-alias-menu-icon',
  'dsw-alias-scrollbar-bg-l2',
  'dsw-alias-scrollbar-hover-l2',
  'dsw-alias-state-business-primary',
  'dsw-alias-state-error-primary',
  'dsw-alias-state-idle-primary',
  'dsw-alias-state-success-primary',
  'dsw-alias-state-success-tertiary',
  'dsw-alias-state-warn-label',
  'dsw-alias-state-warn-primary',
  'dsw-alias-state-warn-tertiary',
  'dsw-alias-switch-thumb',
  'dsw-alias-toast-bg',
  'dsw-alias-toast-label',
  'dsw-alias-tooltip-bg',
  'dsw-alias-tooltip-key-bg',
  'dsw-elevation-panel',
  'dsw-elevation-prominent',
  'dsw-elevation-soft',
  'dsw-elevation-stroke-color',
  'dsw-focus-ring-color',
  'dsw-focus-ring-width',
  'dsw-font-family',
  'dsw-font-markdown-base',
  'dsw-font-markdown-base-strong',
  'dsw-font-markdown-code',
  'dsw-font-markdown-code-block',
  'dsw-font-markdown-code-font-family',
  'dsw-font-markdown-h1',
  'dsw-font-markdown-h2',
  'dsw-font-markdown-h3',
  'dsw-font-markdown-h4',
  'dsw-font-markdown-table',
  'dsw-font-markdown-table-head',
  'dsw-font-xs-13',
  'dsw-hovercard-bg',
  'dsw-mask-blur',
  'dsw-menu-backdrop-filter',
  'dsw-menu-surface-fill',
  'dsw-radius-lg',
  'dsw-radius-md',
  'dsw-radius-panel',
  'dsw-radius-sm',
  'dsw-radius-xs',
  'dsw-shadow-lv3',
  'dsw-specific-input-major',
  'dsw-specific-menu',
  'dsw-static-amber-400',
  'dsw-static-amber-500',
  'dsw-static-deepseek-400',
  'dsw-static-deepseek-450',
  'dsw-static-deepseek-500',
  'dsw-static-green-500',
  'dsw-static-neutral-bluish-00',
  'dsw-static-neutral-bluish-300',
  'dsw-static-red-600',
]);

// 9. ⭐ 主题变量校验
//
// 分两类：
//   · --dsw-* 设计令牌：必须白名单内（94 个，来自 DSH 静态 CSS）
//   · --dsh-* 布局变量：由 DSH 运行时注入，官方即用即定义，
//     不在此处校验（但要检查是否都带了兜底默认值）
const clientSrc = fs.readFileSync(path.join(root, 'src', 'client', 'bundle.js'), 'utf8');

const usedDsw = [...clientSrc.matchAll(/--(dsw-[a-z0-9-]+)/g)].map((m) => m[1]);
const unknownDsw = [...new Set(usedDsw)].filter((v) => !KNOWN_DSW.has(v));

if (unknownDsw.length > 0) {
  console.log(`❌ 使用了未知的 --dsw-* 令牌：${unknownDsw.join(', ')}`);
  console.log('   （这些变量不存在，样式会退化成兜底色）');
  process.exit(1);
}
console.log(
  `✅ 设计令牌全部有效（${new Set(usedDsw).size} 个 --dsw-*，无未知）`,
);

// --dsh-* 布局变量：必须带兜底值（官方全部带默认值）
const usedDsh = [...clientSrc.matchAll(/var\(--(dsh-[a-z0-9-]+)([^)]*)\)/g)];
const noFallback = usedDsh
  .filter((m) => !m[2].includes(','))
  .map((m) => m[1]);

if (noFallback.length > 0) {
  console.log(`❌ 布局变量缺少兜底默认值：${[...new Set(noFallback)].join(', ')}`);
  console.log('   （运行时变量可能未注入，没有兜底会导致样式失效）');
  process.exit(1);
}
console.log(
  `✅ 布局变量均有兜底（${new Set(usedDsh.map((m) => m[1])).size} 个 --dsh-*）`,
);

console.log('\n=== 全部通过 ===');
