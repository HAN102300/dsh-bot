/**
 * 从代码注册表生成工具清单文档（docs/TOOLS.md）
 *
 * 由来：README 曾写 18 个工具、API.md 写 15、manifest 写 21、
 * 实际注册 22——四个互相矛盾的数字。文档不许手抄代码，
 * 手抄必过期；过期即错，对一个卖「可信」的产品更糟。
 *
 * 用法：npm run build && node dev/gen-tools-doc.mjs
 * （跑在构建产物 lib/index.js 上，与真实加载路径一致）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;
const { apply } = await import(entry);

const registered = [];
const host = {
  tools: {
    register(t) {
      registered.push(t);
      return () => {};
    },
    schemas: () => registered,
    get: (name) => registered.some((t) => t.name === name),
  },
  webServer: { register: () => () => {} },
  set: () => {},
  effect: () => () => {},
  logger: { info() {}, warn() {}, error() {} },
};

const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bot-tooldoc-'));
apply(host, { homeDir });

if (registered.length === 0) {
  console.error('❌ 没有注册到任何工具——生成器自身失败，拒绝输出空文档');
  process.exit(1);
}

const groups = [
  ['bot_adopt', '对话介入'],
  ['bot_create', 'Bot 管理'],
  ['bot_list', 'Bot 管理'],
  ['bot_show', 'Bot 管理'],
  ['bot_update', 'Bot 管理'],
  ['bot_delete', 'Bot 管理'],
  ['bot_goal', '目标（守得住）'],
  ['bot_recall', '记忆（记得住）'],
  ['bot_memory_add', '记忆（记得住）'],
  ['bot_run', '执行（收得回）'],
  ['bot_runs', '执行（收得回）'],
  ['routine_draft', '流程（Routine）'],
  ['routine_save', '流程（Routine）'],
  ['routine_run', '流程（Routine）'],
  ['routine_list', '流程（Routine）'],
  ['routine_show', '流程（Routine）'],
  ['routine_delete', '流程（Routine）'],
  ['bot_snapshots', '回滚（收得回）'],
  ['bot_rollback', '回滚（收得回）'],
  ['bot_snapshot', '回滚（收得回）'],
  ['bot_schedule', '调度'],
  ['bot_schedules', '调度'],
  ['bot_heartbeat', '调度'],
  ['http_get', '通用能力'],
];

const known = new Map(groups);
const unknown = registered.filter((t) => !known.has(t.name));
const missing = groups.filter(([name]) => !registered.some((t) => t.name === name));

if (missing.length) {
  console.error(`❌ 分组表里有、代码里没有：${missing.map(([n]) => n).join(', ')}`);
  process.exit(1);
}

const lines = [
  '# 工具清单',
  '',
  `> 本文档由 \`node dev/gen-tools-doc.mjs\` 从代码注册表自动生成（共 **${registered.length}** 个工具）。`,
  '> 手工编辑会被覆盖；新增/删除工具请改代码后重新生成。',
  '',
];

let lastGroup = '';
for (const [name, group] of groups) {
  const t = registered.find((x) => x.name === name);
  if (!t) continue;
  if (group !== lastGroup) {
    lines.push('', `## ${group}`, '', '| 工具 | 说明 |', '|---|---|');
    lastGroup = group;
  }
  const desc = String(t.description ?? '').split('。')[0].replace(/\|/g, '\\|');
  lines.push(`| \`${name}\` | ${desc} |`);
}
if (unknown.length) {
  lines.push('', '## 未分组', '', '| 工具 | 说明 |', '|---|---|');
  for (const t of unknown) {
    lines.push(`| \`${t.name}\` | ${String(t.description ?? '').split('。')[0]} |`);
  }
}

const out = path.join(__dirname, '..', 'docs', 'TOOLS.md');
fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');
fs.rmSync(homeDir, { recursive: true, force: true });
console.log(`✅ docs/TOOLS.md 已生成：${registered.length} 个工具` +
  (unknown.length ? `（含 ${unknown.length} 个未分组，请补分组表）` : ''));
