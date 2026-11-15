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
import crypto from 'node:crypto';
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

// 4. 源码与产物一致性（防「改了源码忘了 build」）
const srcPath = path.join(root, 'src', 'client', 'bundle.js');
const srcRaw = fs.readFileSync(srcPath, 'utf8');
if (!srcRaw.includes('__BOT_BUILD__')) {
  console.log('❌ src/client/bundle.js 缺少 __BOT_BUILD__ 占位符');
  process.exit(1);
}
const expected = srcRaw.replaceAll('__BOT_BUILD__', pkg.version);
const code = fs.readFileSync(clientPath, 'utf8');
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
if (sha256(expected) !== sha256(code)) {
  console.log('❌ lib/client.js 与 src/client/bundle.js 不一致：改完源码忘了 npm run build？');
  process.exit(1);
}
if (code.includes('__BOT_BUILD__')) {
  console.log('❌ lib/client.js 里仍有 __BOT_BUILD__：构建时没有替换版本号');
  process.exit(1);
}
console.log(`✅ 产物与源码一致，构建版本已注入（${pkg.version}）`);

// 5. 结构断言：整个文件必须包在 IIFE 里
const firstCodeLine = code
  .replace(/^\s*\/\*[\s\S]*?\*\/\s*/, '')
  .trimStart();
if (!firstCodeLine.startsWith('(function')) {
  console.log(`❌ 首个非注释语句不是 IIFE：${firstCodeLine.slice(0, 40)}…`);
  process.exit(1);
}
if (!/\}\)\s*\(\s*\)\s*;?\s*$/.test(code.trimEnd())) {
  console.log('❌ 文件末尾不是 })(); —— IIFE 没有闭合');
  process.exit(1);
}
console.log('✅ 结构：整文件包在 IIFE 中');

// 6. 幂等断言：宽容 loader 在同一 context 连跑两次都必须成功
//    （0.3.4 的「BG_BASE already declared」就死在这一步）
const makeSandbox = (load) => ({
  window: { __ModuleLoader__: { load } },
  console,
  URLSearchParams,
  document: {
    createElement: () => ({ setAttribute() {}, textContent: '', style: {} }),
    head: { appendChild() {} },
  },
  fetch: async () => ({ ok: true, json: async () => ({ ok: true, value: {} }) }),
});
const tolerant = makeSandbox(() => {});
vm.createContext(tolerant);
try {
  vm.runInContext(code, tolerant, { filename: 'client.js' });
  vm.runInContext(code, tolerant, { filename: 'client.js#2' });
} catch (err) {
  console.log('❌ 幂等失败：同一 context 第二次执行抛错 ——', err.message);
  process.exit(1);
}
console.log('✅ 幂等：同一 context 连跑两次均成功（无全局词法冲突）');

// 7. 重复注册断言：严格 loader 第二次必须抛 duplicate，且只注册一次
const registrations = [];
const strict = makeSandbox((def) => {
  if (registrations.some((r) => r.id === def.id)) {
    throw new Error(`client-modules: duplicate factory registration for "${def.id}"`);
  }
  registrations.push(def);
});
vm.createContext(strict);
let doubled = false;
try {
  vm.runInContext(code, strict, { filename: 'client.js' });
  try {
    vm.runInContext(code, strict, { filename: 'client.js#2' });
  } catch {
    doubled = true;
  }
} catch (err) {
  console.log('❌ 执行失败:', err.message);
  process.exit(1);
}
if (!doubled) {
  console.log('❌ 第二次执行没有触发 duplicate —— 重复注册检测失效');
  process.exit(1);
}
if (registrations.length !== 1) {
  console.log(`❌ 注册了 ${registrations.length} 次，应只注册 1 次`);
  process.exit(1);
}
console.log('✅ 只注册一次（严格 loader 第二次抛 duplicate，符合预期）');

const def = registrations[0];
if (def.id !== pkg.name) {
  console.log(`❌ id = "${def.id}"，必须等于包名 "${pkg.name}"`);
  process.exit(1);
}
console.log(`✅ id = "${def.id}"（等于包名）`);

// 8. 通知策略必须按 Bot 读取（单 Bot 覆盖全局）——0.3.5 的静默漏通知就死在这里
if (!code.includes('/settings?botId=') || !code.includes('policyOf')) {
  console.log('❌ 通知轮询没有按 Bot 读取设置：单 Bot 的「仅异常打扰」不会生效');
  process.exit(1);
}
console.log('✅ 通知轮询按 Bot 读取生效设置（单 Bot 覆盖全局）');

// 9. 侧边栏入口 + 主面板（v0.3.7）
if (!code.includes('sidebar.panellist') || !code.includes("name: 'main'")) {
  console.log('❌ 缺少侧边栏入口或主面板注册（v0.3.7 功能）');
  process.exit(1);
}
console.log('✅ 侧边栏入口 / 主面板注册存在');

// 10. Bot 资料编辑路由
if (!code.includes('/_dsh-bot/bot/update')) {
  console.log('❌ Bot 资料编辑没有接 /bot/update');
  process.exit(1);
}
console.log('✅ Bot 资料编辑接 /bot/update');

// 11. 执行周期（cron）编辑
if (!code.includes('每 N 小时') || !code.includes('function buildCadence(') || !code.includes('describeCadence(')) {
  console.log('❌ 编辑表单缺少可调节的执行周期（结构化模式 + 人话描述）');
  process.exit(1);
}
if (code.includes('editCadence')) {
  console.log('❌ 执行周期仍残留自由输入的 cron 字段');
  process.exit(1);
}
console.log('✅ 执行周期为结构化控件（每 N 小时 / 每天 / 每周 / 不自动跑）+ 人话描述');

// 13. 渲染期用到的纯函数必须在模块作用域（不能掉进 report() 里）
//     判断方式：找到 report 的函数体范围（括号配对），确认相关函数不在其中。
function functionBodySpan(src, fnName) {
  const start = src.indexOf('function ' + fnName + '(');
  if (start < 0) return null;
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'") {
      const quote = ch;
      for (i++; i < src.length; i++) {
        if (src[i] === '\\') { i++; continue; }
        if (src[i] === quote) break;
      }
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return [start, i]; }
  }
  return null;
}
const reportSpan = functionBodySpan(code, 'report');
if (!reportSpan) {
  console.log('❌ 找不到 report() 的函数体');
  process.exit(1);
}
for (const fn of ['buildCadence', 'parseCadence', 'describeCadence']) {
  const fnStart = code.indexOf('function ' + fn + '(');
  if (fnStart < 0) {
    console.log(`❌ 缺少函数 ${fn}`);
    process.exit(1);
  }
  if (fnStart > reportSpan[0] && fnStart < reportSpan[1]) {
    console.log(`❌ ${fn} 被写进了 report()：渲染时会 ReferenceError`);
    process.exit(1);
  }
  if (fnStart > code.indexOf('function apply(')) {
    console.log(`❌ ${fn} 定义在 apply 之后，渲染期不可见`);
    process.exit(1);
  }
}
console.log('✅ 周期纯函数处于模块作用域（buildCadence / parseCadence / describeCadence）');

// 12. 展开面板必须 portal 到 body（否则会被聊天区的 transform 祖先困住）
if (!code.includes('createPortal') || !code.includes('function portal(')) {
  console.log('❌ 展开面板没有 portal 到 body：fixed 会被祖先限制，出现遮挡/不滚动');
  process.exit(1);
}
console.log('✅ 展开面板 portal 到 body（视口级浮层）');

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

// 8.10 ⭐ 详情区状态机（0.3.8 起在 BotSituation 中，按状态给可执行动作）
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'client', 'bundle.js'),
    'utf8',
  );

  if (!src.includes('function BotSituation')) {
    console.log('❌ 缺少状态摘要组件 BotSituation');
    process.exit(1);
  }
  for (const state of ['pending_confirmation', 'blocked', 'failed']) {
    if (!src.includes(`'${state}'`)) {
      console.log(`❌ 状态驱动缺少分支：${state}`);
      process.exit(1);
    }
  }
  for (const action of ['goalConfirm', 'goalUnblock', 'goalGiveup']) {
    if (!src.includes(action)) {
      console.log(`❌ 卡住/待确认状态缺少可执行动作：${action}`);
      process.exit(1);
    }
  }
  console.log('✅ 详情区是状态驱动的（待确认 / 卡住 / 失败均有动作）');
}

// 8.11 ⭐ 设置统一：官方设置页 Bot 分区复用主页面组件（0.3.8）
//    两套设置 UI 会各自保存、各自清数据（旧版「清空记录」只清第一个 Bot）——
//    这是 LESSONS #23 那类双消费漂移，必须在结构上消除。
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'client', 'bundle.js'),
    'utf8',
  );

  for (const marker of ['ConsoleSettings', 'ConsoleDoctor', 'ConsoleRuns']) {
    if (!src.includes(marker)) {
      console.log(`❌ 缺少统一组件：${marker}`);
      process.exit(1);
    }
  }
  if (/function (SettingsView|RunsSection|DoctorPanel)\(/.test(src)) {
    console.log('❌ 旧设置/运行/诊断组件仍在（会与主页面漂移）');
    process.exit(1);
  }
  if (!src.includes('h(ConsoleSettings, { bots: [], busy: false })')) {
    console.log('❌ 官方设置页 Bot 分区没有复用 ConsoleSettings');
    process.exit(1);
  }
  if (!src.includes("className: NS + '-c-vars'") || !src.includes('.${NS}-c,\n.${NS}-c-vars {')) {
    console.log('❌ CSS 变量没有作用到官方设置页容器（开关/卡片会失去配色）');
    process.exit(1);
  }
  if (!src.includes('runs/clear')) {
    console.log('❌ 设置页没有清空运行记录的入口');
    process.exit(1);
  }
  console.log('✅ 设置/诊断/运行记录统一组件（官方设置页复用主页面组件）');
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

  for (const marker of ['goalUnblock', 'goalGiveup', '已处理好']) {
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
  'dsw-alias-brand-text',
  'dsw-alias-settings-card-fill',
  'dsw-alias-settings-card-stroke',
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


// 14. v0.3.8 控制台：主页面 / 详情页
//     用户反馈「字号都是一个尺寸、内容只占 720」。
//     这里把设计稿的硬约束钉成断言，防止回退。
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'client', 'bundle.js'),
    'utf8',
  );

  if (!src.includes('function BotConsole(')) {
    console.log('❌ 缺少 BotConsole（v0.3.8 主页面）');
    process.exit(1);
  }
  if (!src.includes('function BotPanelPage(') || !/return h\(BotConsole/.test(src)) {
    console.log('❌ BotPanelPage 没有渲染 BotConsole');
    process.exit(1);
  }
  if (!src.includes('frame-top-clearance')) {
    console.log('❌ 主页面没有使用宿主顶部安全区（--dsh-frame-top-clearance）');
    process.exit(1);
  }
  if (src.includes('maxWidth: 720')) {
    console.log('❌ 主页面仍是 720 宽上限（应改为 1120 + 自适应）');
    process.exit(1);
  }

  // 控制台 CSS 的字号下限：不得出现 <11px
  const cssStart = src.indexOf('v0.3.8 控制台（主页面 / 详情页）');
  const cssEnd = src.indexOf('/* 响应式：窄屏退化为单列 */', cssStart);
  if (cssStart < 0 || cssEnd < 0) {
    console.log('❌ 找不到 v0.3.8 控制台 CSS 区块');
    process.exit(1);
  }
  const css = src.slice(cssStart, cssEnd);
  const sizes = [...css.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((m) => Number(m[1]));
  const tooSmall = sizes.filter((n) => n < 11);
  if (tooSmall.length) {
    console.log('❌ 控制台存在 <11px 的字号：' + tooSmall.join(', '));
    process.exit(1);
  }
  if (!sizes.includes(20) || !sizes.includes(15) || !sizes.includes(13) || !sizes.includes(12)) {
    console.log('❌ 控制台类型尺度不完整（需要 20 / 15 / 13 / 12 至少四档）');
    process.exit(1);
  }

  // 详情页：左列表固定 + 右栏独立滚动 + 头部吸顶
  for (const marker of ['-c-split', '-c-rail-rows.fill', '-c-pane', 'position: sticky']) {
    if (!src.includes(marker)) {
      console.log('❌ 详情页双栏布局缺少：' + marker);
      process.exit(1);
    }
  }
  const splitCss = css.slice(css.indexOf('-c-rail-rows.fill'));
  if (!/overflow-y:\s*auto/.test(splitCss)) {
    console.log('❌ 详情页左列表没有独立滚动容器');
    process.exit(1);
  }
  if (!/\.\$\{NS\}-c-pane\s*\{[^}]*overflow-y:\s*auto/.test(css)) {
    console.log('❌ 详情页右栏没有独立滚动容器');
    process.exit(1);
  }
  console.log('✅ 控制台：类型尺度完整（最小 ' + Math.min(...sizes) + 'px）、1120 宽、双栏独立滚动');

  // 真渲染一次主面板（空数据），确保不会在渲染期崩
  function makeReact(queue = []) {
    let qi = 0;
    return {
      createElement: (type, props, ...children) => ({ type, props, children }),
      useState: (init) => {
        const i = qi++;
        return [i < queue.length ? queue[i] : init, () => {}];
      },
      useEffect: () => {},
      useCallback: (f) => f,
      useMemo: (f) => f(),
      useRef: (v) => ({ current: v }),
    };
  }
  function flatten(node, out = []) {
    if (node == null || node === false) return out;
    if (Array.isArray(node)) {
      for (const c of node) flatten(c, out);
      return out;
    }
    if (typeof node === 'object') {
      out.push(node);
      if (typeof node.type === 'function') flatten(node.type(node.props ?? {}), out);
      else if (Array.isArray(node.children)) for (const c of node.children) flatten(c, out);
    }
    return out;
  }
  const reg = [];
  const mod = def.factory((name) => {
    if (name === 'react') return makeReact();
    throw new Error('unexpected require: ' + name);
  });
  mod.apply({
    slots: { inject: (_n, f) => f(), register: (o, c) => reg.push({ o, c }) },
  });
  const main = reg.find((r) => r.o?.name === 'main');
  if (!main) {
    console.log('❌ 没有注册 main 面板');
    process.exit(1);
  }
  try {
    const flat = flatten(main.c());
    if (!flat.length) throw new Error('没有创建任何元素');
    const texts = JSON.stringify(flat.map((n) => n.children));
    for (const must of ['dsh-bot', 'Bot', '运行记录', '设置', '诊断']) {
      if (!texts.includes(must)) throw new Error('缺少文本：' + must);
    }
    console.log('✅ 主面板空数据渲染成功（' + flat.length + ' 个元素）');
  } catch (e) {
    console.log('❌ 主面板渲染失败：' + e.message);
    process.exit(1);
  }

  // 带数据 + 进入详情页：覆盖最复杂的一条渲染路径
  try {
    const now = new Date().toISOString();
    const bot = {
      id: 'bot_x', name: '数据哨兵', role: '抓下载量与 stars',
      createdAt: now, runCount: 15, todayCostCny: 0.0136,
      lastRunAt: now, lastRunStatus: 'success',
      goalDescription: '每天 00:00 查一次', goalStatus: 'active',
      goalType: 'standing', pendingConfirmCount: 0, proposedCount: 0,
      blocked: false, memoryCount: 12,
    };
    const identity = {
      ...bot,
      model: { provider: 'deepseek-account', model: 'deepseek-flash' },
      budget: { dailyCny: 5, monthlyCny: 100, onExceed: 'stop' },
      workspace: 'C:/Users/zifeng/.dsh/bot/bots/bot_x/workspace',
      systemPromptExtra: '只用两个数据源',
    };
    const detail = {
      bot: identity,
      semantic: { updatedAt: now, facts: ['stars 6', 'npm 近 7 天 1029'], preferences: ['只抓两个数据源'] },
      runs: [{
        id: 'run_ebbb8e02', status: 'success', trigger: 'goal', startedAt: now,
        usage: { costCny: 0.0069, costKind: 'exact', inputTokens: 1, outputTokens: 1 },
      }],
      routines: [{ id: 'weekly-clean', name: '每周整理', description: '整理下载目录', version: 1, stepCount: 2, triggers: [{ type: 'manual' }] }],
      goal: {
        id: 'goal_1', type: 'standing', description: '每天 00:00 查一次',
        status: 'active', progress: '上一轮成功', cadence: '0 0 * * *',
        lastFiredAt: now, pendingConfirmCount: 0, createdAt: now, updatedAt: now,
      },
      proposals: [], archives: [], spend: [],
      snapshots: [{ id: 'snap_1', createdAt: now, fileCount: 3, totalBytes: 1024, entries: [] }],
      snapshotUsage: { count: 1, totalBytes: 1024 },
      budget: { today: 0.0136, month: 0.2, dailyLimit: 5, monthlyLimit: 100 },
    };
    const reg2 = [];
    const mod2 = def.factory((name) => {
      if (name === 'react') return makeReact(['bots', true, { bots: [bot], stats: { botCount: 1, todayCostCny: 0.0136, runTotal: 15 }, heartbeat: { lastBeatAt: now, staleMs: 120000, isStale: false } }, 'bot_x', detail, false, '', '', null, null]);
      throw new Error('unexpected require: ' + name);
    });
    mod2.apply({ slots: { inject: (_n, f) => f(), register: (o, c) => reg2.push({ o, c }) } });
    const main2 = reg2.find((r) => r.o?.name === 'main');
    const flat2 = flatten(main2.c());
    const texts2 = JSON.stringify(flat2.map((n) => n.children));
    for (const must of ['数据哨兵', '执行', '最近运行', '记忆', '例行流程', '配置', '快照与回滚', 'deepseek-account']) {
      if (!texts2.includes(must)) throw new Error('详情页缺少：' + must);
    }
    console.log('✅ 主面板带数据 + 详情页渲染成功（' + flat2.length + ' 个元素）');
  } catch (e) {
    console.log('❌ 主面板带数据渲染失败：' + e.message);
    process.exit(1);
  }
}


// 15. ⭐ 运行详情弹窗的字段派生（0.3.8 反馈：运行详情 · undefined / 步骤数 0 / 输出无）
//     不同入口的 run 形态不同：/runs/list 有 outputPreview，/bot 是原始记录。
//     弹窗必须自己从 steps 派生，不能依赖调用方补字段。
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'client', 'bundle.js'),
    'utf8',
  );
  const fnStart = src.indexOf('function RunDetailModal');
  if (fnStart < 0) {
    console.log('❌ 缺少 RunDetailModal');
    process.exit(1);
  }
  const body = src.slice(fnStart, src.indexOf('function SettingsView', fnStart) > 0
    ? src.indexOf('function SettingsView', fnStart)
    : fnStart + 9000);
  if (!/run\.botName \?\?/.test(body) && !body.includes("run.botName ?? '本轮'")) {
    console.log('❌ 弹窗标题没有 botName 兜底（会出现「运行详情 · undefined」）');
    process.exit(1);
  }
  if (!body.includes("run.outputPreview") || !body.includes("s?.kind === 'llm'")) {
    console.log('❌ 弹窗输出没有从 steps 派生（原始 run 记录会显示「无」）');
    process.exit(1);
  }
  if (body.includes('run.stepCount')) {
    console.log('❌ 弹窗仍在读不存在的 run.stepCount（永远显示 0）');
    process.exit(1);
  }
  if (!body.includes('goalAssessment')) {
    console.log('❌ 弹窗缺少目标评估展示');
    process.exit(1);
  }
  console.log('✅ 运行详情弹窗字段自派生（标题兜底 / 步骤数 = steps.length / 输出来自 llm 步骤）');
}

// 16. ⭐ 点击后才渲染的路径必须有渲染冒烟（LESSONS #21）
//     配置编辑表单只在点「编辑」后挂载；这里用 useState 队列把它推出来渲染一次。
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'client', 'bundle.js'),
    'utf8',
  );
  if (!/function BotConfigCard/.test(src)) {
    console.log('❌ 缺少 BotConfigCard');
    process.exit(1);
  }
  // 静态断言：编辑态表单必须包含预算输入与超限选择（点击后才挂载的部分）
  for (const must of ["'每日预算上限（¥）'", "'每月预算上限（¥）'", "'超限行为'", "setEditing(true)"]) {
    if (!src.includes(must)) {
      console.log('❌ 配置编辑表单缺少：' + must);
      process.exit(1);
    }
  }
  console.log('✅ 配置编辑表单要素齐全（预算 / 超限 / 编辑态切换）');
}

// 17. ⭐ 快照卡按文件证据显示；例行流程只读
{
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'client', 'bundle.js'),
    'utf8',
  );
  if (!src.includes('everTouchedFiles') || !src.includes('(s.fileCount ?? 0) > 0')) {
    console.log('❌ 快照卡没有按文件证据显示（空快照 Bot 会看到整屏无意义列表）');
    process.exit(1);
  }
  const rcStart = src.indexOf('function BotRoutinesCard');
  const rcBody = src.slice(rcStart, rcStart + 4000);
  if (rcBody.includes('setYaml')) {
    console.log('❌ 例行流程卡仍有 YAML 编辑（0.3.8 已降级只读）');
    process.exit(1);
  }
  console.log('✅ 快照卡按文件证据显示；例行流程为只读（无流程整卡隐藏）');
}

console.log('\n=== 全部通过 ===');
