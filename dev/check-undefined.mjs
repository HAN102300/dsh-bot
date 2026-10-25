/**
 * 静态自检：捕获「未定义标识符」类错误
 *
 * 为什么需要这个脚本：
 *
 * 已经发生过两次同类事故，两次都构建通过、测试通过、页面正常，
 * 只在运行时被 try/catch 静默吞掉，表现为"功能悄悄失效"：
 *
 *   1. index.ts 用了 nowIso 但没定义
 *      → registerGoalTools 抛 ReferenceError
 *      → 后续 14 个工具全部没注册（只剩 8 个）
 *
 *   2. index.ts 用了 os.homedir() 但没 import os
 *      → profile 扫描抛 ReferenceError
 *      → 模型探测静默降级到 listProviders()[0]（任意值）
 *
 * 这类错误的共同点：**不会让构建失败**。
 * tsdown 只做转译不做类型检查，而 tsc 因为缺 @types/node 报错太多，
 * 一直是过滤着看的——于是真正的问题被噪音掩盖。
 *
 * ⚠️ 关于误报
 *
 * 这个脚本第一版产生了 23 处误报（把 `deps.newId()` 当成未定义、
 * 把 `import os from 'node:os'` 当成没导入）。
 * 误报比漏报更危险：它会训练人忽略输出，等于让检查失效。
 * 所以每条检查都必须先通过"零误报"的自我验证。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(__dirname, '..', 'src');

let errors = 0;
let checked = 0;

function fail(msg) {
  errors++;
  console.log(`  ❌ ${msg}`);
}

function collect(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...collect(p));
    else if (ent.name.endsWith('.ts') && !ent.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/**
 * 去掉注释，但保留行结构（用等长空白替换），
 * 这样行号仍然可以对得上原文。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

// ============================================================
// ① node: 内置模块
// ============================================================

/**
 * 每个命名空间：对应哪些 import 写法算"已导入"
 *
 * 注意必须允许 `from`：
 *   import os from 'node:os'            ← 之前漏了这种，导致全部误报
 *   import * as os from 'node:os'
 *   import { join } from 'node:path'
 */
const NODE_NS = [
  {
    ns: 'os',
    modules: ['node:os'],
    members: ['homedir', 'tmpdir', 'platform', 'cpus', 'EOL', 'type', 'arch', 'hostname', 'release', 'totalmem', 'userInfo'],
  },
  {
    ns: 'path',
    modules: ['node:path'],
    members: ['join', 'resolve', 'dirname', 'basename', 'extname', 'sep', 'relative', 'isAbsolute', 'normalize', 'parse', 'format', 'toNamespacedPath'],
  },
  {
    ns: 'crypto',
    modules: ['node:crypto'],
    members: ['randomBytes', 'randomUUID', 'createHash', 'createHmac', 'timingSafeEqual', 'randomInt'],
  },
  {
    ns: 'fs',
    modules: ['node:fs'],
    members: ['readFileSync', 'writeFileSync', 'existsSync', 'mkdirSync', 'readdirSync', 'statSync', 'unlinkSync', 'rmSync', 'copyFileSync', 'renameSync', 'appendFileSync', 'createReadStream', 'createWriteStream', 'realpathSync', 'lstatSync', 'symlinkSync', 'accessSync', 'chmodSync'],
  },
  {
    ns: 'fsp',
    // fsp 是 `import fsp from 'node:fs/promises'` 的约定俗成写法
    modules: ['node:fs/promises'],
    members: ['readFile', 'writeFile', 'mkdir', 'readdir', 'stat', 'unlink', 'rm', 'copyFile', 'rename', 'appendFile', 'lstat', 'chmod', 'symlink', 'access', 'realpath'],
  },
];

/** 这个文件是否导入了某个模块（任何 import 形式，含动态 import） */
function importsModule(src, modules) {
  const specs = [];
  // 静态 import ... from 'x'
  for (const m of src.matchAll(/import\s+[^;]*?from\s*['"]([^'"]+)['"]/g)) specs.push(m[1]);
  // 副作用 import 'x'
  for (const m of src.matchAll(/import\s*['"]([^'"]+)['"]/g)) specs.push(m[1]);
  // ⭐ 动态 import('x')
  for (const m of src.matchAll(/import\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.push(m[1]);
  return specs.some((s) => modules.includes(s));
}

// ============================================================
// ② 高危裸标识符
// ============================================================

/**
 * 只检查这几个"曾经出过事"的名字。
 *
 * 判断一个名字是否已被声明，认可以下写法：
 *   function name(...)            函数声明
 *   const/let/var name =          变量
 *   import { name }  / import name
 *   interface X { name(...) }     接口方法（由依赖注入提供）
 *   { name } 解构参数             依赖注入
 *   name?: (...) =>              类型属性
 */
const HIGH_RISK = ['nowIso', 'newId'];

function isDeclared(src, name) {
  const s = stripComments(src);

  // 函数声明
  if (new RegExp(`function\\s+${name}\\s*\\(`).test(s)) return true;
  // 变量声明
  if (new RegExp(`(?:const|let|var)\\s+${name}\\s*[=:]`).test(s)) return true;
  // import
  if (new RegExp(`import[^;]*\\b${name}\\b`).test(s)) return true;
  // 接口/类型里的方法签名（这些由调用方注入，不是本文件的自由变量）
  if (new RegExp(`(?:interface|type)\\s+\\w+[^]*?\\b${name}\\s*[?]?\\s*\\(`).test(s)) return true;
  // 类型属性： name?: (...) => ...
  if (new RegExp(`\\b${name}\\s*\\??\\s*:\\s*\\(`).test(s)) return true;

  return false;
}

/** 这个文件是否把该名字当自由变量用（而非属性访问） */
function usesAsFreeCall(src, name) {
  // 排除 obj.name( 或 obj?.name(
  const re = new RegExp(`(?<![.\\w'"\`])${name}\\s*\\(`, 'g');
  for (const m of stripComments(src).matchAll(re)) {
    const before = src.slice(Math.max(0, m.index - 1), m.index);
    if (before === '.' ) continue;
    return true;
  }
  return false;
}

// ============================================================
// 执行
// ============================================================

const files = collect(srcDir);
console.log('=== 静态自检：未导入的模块 / 未定义标识符 ===\n');

console.log('① node: 内置模块的使用是否都有对应 import');
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(srcDir, file);
  const code = stripComments(src);

  for (const { ns, modules, members } of NODE_NS) {
    const re = new RegExp(`(?<![.\\w'"\`])${ns}\\.(${members.join('|')})\\s*\\(`, 'g');
    const hits = [...code.matchAll(re)];
    if (hits.length === 0) continue;

    checked++;
    if (!importsModule(src, modules)) {
      const line = code.slice(0, hits[0].index).split('\n').length;
      fail(`${rel}:${line} 使用了 ${ns}.${hits[0][1]}() 但没有 import '${modules[0]}'`);
    }
  }
}
if (errors === 0) console.log(`  ✅ 全部 ${checked} 处模块使用都有对应 import`);

console.log('\n② 高危裸标识符是否已声明');
{
  const before = errors;
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(srcDir, file);

    for (const name of HIGH_RISK) {
      if (!usesAsFreeCall(src, name)) continue;
      checked++;
      if (!isDeclared(src, name)) {
        fail(`${rel}: 调用 ${name}() 但未声明 / 未导入（运行时会被 try-catch 吞掉）`);
      }
    }
  }
  if (errors === before) console.log('  ✅ 所有高危调用都有声明来源');
}

console.log('\n③ index.ts 的关键导出是否齐全');
{
  const f = path.join(srcDir, 'index.ts');
  const src = fs.readFileSync(f, 'utf8');

  const injectMatch = src.match(/export const inject\s*=\s*\[([^\]]*)\]/);
  if (!injectMatch) {
    fail('index.ts: 找不到 export const inject');
  } else {
    const items = injectMatch[1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean);
    for (const need of ['tools', 'webServer', 'llm']) {
      checked++;
      if (items.includes(need)) console.log(`  ✅ inject 包含 ${need}`);
      else fail(`inject 缺少 ${need}（会导致对应能力静默不可用）`);
    }
  }
}

console.log('\n④ 客户端：不许使用 Electron 不支持的原生弹窗');
{
  const f = path.join(srcDir, 'client', 'bundle.js');
  if (fs.existsSync(f)) {
    const src = stripComments(fs.readFileSync(f, 'utf8'));
    const bad = [];
    if (/\bwindow\.prompt\s*\(/.test(src)) bad.push('window.prompt()');
    if (/\bwindow\.confirm\s*\(/.test(src)) bad.push('window.confirm()');
    checked++;
    if (bad.length) fail(`client/bundle.js 使用了 ${bad.join(', ')}（Electron 渲染进程不支持）`);
    else console.log('  ✅ 未使用 window.prompt / window.confirm');
  }
}

console.log(`\n${'─'.repeat(52)}`);
console.log(errors === 0 ? `  ✅ 静态自检通过（${checked} 项检查）` : `  ❌ 发现 ${errors} 处问题`);
console.log(`${'─'.repeat(52)}\n`);
process.exitCode = errors === 0 ? 0 : 1;
