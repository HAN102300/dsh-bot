/**
 * 回滚能力端到端演示
 *
 * 走一遍真实场景：
 *   1. Bot 有初始工作区文件
 *   2. 真实执行（自动打快照）
 *   3. "执行出错"——文件被改乱
 *   4. 用 bot_rollback 完整撤回
 *
 * 运行： node dev/demo-rollback.mjs
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;

const { BotService, RoutineRunner, formatBytes, DEFAULT_CONFIG } = await import(entry);

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-bot-rb-'));
const service = new BotService({}, { ...DEFAULT_CONFIG, homeDir: tmp });

function section(t) {
  console.log(`\n${'='.repeat(58)}\n${t}\n${'='.repeat(58)}`);
}

function ok(label, cond, extra = '') {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

// ============================================================

section('1. 创建 Bot 并放入初始文件');

const bot = await service.create({
  name: '文件整理助手',
  role: '整理工作区，清理临时文件',
});
const ws = bot.workspace;

async function write(rel, content) {
  const abs = path.join(ws, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content, 'utf8');
}
async function read(rel) {
  return fsp.readFile(path.join(ws, rel), 'utf8');
}

await write('config.json', '{"version":1,"env":"prod"}');
await write('data/users.csv', 'id,name\n1,alice\n2,bob');
await write('data/orders.csv', 'id,amount\n1,100');
await write('notes.md', '# 项目笔记\n重要内容');

const initialFiles = ['config.json', 'data/users.csv', 'data/orders.csv', 'notes.md'];
console.log(`Bot: ${bot.name} (${bot.id})`);
console.log(`工作区: ${ws}`);
console.log(`初始文件: ${initialFiles.length} 个`);
for (const f of initialFiles) console.log(`  · ${f}`);

// ============================================================

section('2. 真实执行 → 自动打快照');

const runner = new RoutineRunner({
  service,
  llm: async () => ({
    text: '整理完成',
    usage: {
      inputTokens: 100, outputTokens: 20, cacheHitTokens: 80,
      cacheMissTokens: 20, reasoningTokens: 0, costCny: 0.0001,
    },
  }),
  tools: { has: () => true, call: async () => ({ ok: true }) },
  newId: (p) => `${p}_${Math.random().toString(16).slice(2, 10)}`,
  nowIso: () => new Date().toISOString(),
  snapshotEnabled: true,
});

const rec = await runner.runTask(bot.id, '整理一下工作区', {
  dryRun: false,
  trigger: 'manual',
});

console.log(`运行 ${rec.id}  状态=${rec.status}`);
ok('已自动创建快照', !!rec.snapshotId, rec.snapshotId);

const snaps = await service.listSnapshots(bot.id);
console.log(`当前快照数: ${snaps.length}`);
console.log(`快照捕获文件: ${snaps[0].fileCount} 个，${formatBytes(snaps[0].totalBytes)}`);

// ============================================================

section('3. 模拟"执行出错"——文件被改乱');

console.log('模拟一次错误的清理脚本：');
await write('config.json', '{"version":999,"env":"broken"}');       // 改坏
await write('notes.md', '# 空');                                    // 内容丢失
await fsp.unlink(path.join(ws, 'data', 'orders.csv'));              // 误删
await write('data/users.csv', 'CORRUPTED');                         // 损坏
await write('temp_cleanup.log', '垃圾日志');                         // 多余文件
await write('data/backup.csv', '不该有的备份');                      // 多余文件
console.log('  · config.json 被改坏');
console.log('  · notes.md 内容丢失');
console.log('  · data/orders.csv 被误删');
console.log('  · data/users.csv 被损坏');
console.log('  · 新增 2 个不该有的文件');

console.log('\n当前状态：');
console.log(`  config.json      = ${await read('config.json')}`);
console.log(`  notes.md         = ${JSON.stringify(await read('notes.md'))}`);
console.log(`  data/orders.csv  = ${fs.existsSync(path.join(ws, 'data/orders.csv')) ? '存在' : '❌ 已丢失'}`);
console.log(`  data/users.csv   = ${await read('data/users.csv')}`);

// ============================================================

section('4. ⭐ 回滚到快照');

const result = await service.rollback(bot.id, rec.snapshotId);

console.log(`已回滚到快照 ${result.snapshotId}`);
console.log(`恢复文件 ${result.restored.length} 个:`);
for (const f of result.restored) console.log(`  · ${f}`);
console.log(`删除文件 ${result.removed.length} 个:`);
for (const f of result.removed) console.log(`  · ${f}`);

// ============================================================

section('5. 验证完整性');

console.log('逐项核对：');
ok(
  'config.json 已恢复',
  (await read('config.json')) === '{"version":1,"env":"prod"}',
  await read('config.json'),
);
ok(
  'notes.md 已恢复',
  (await read('notes.md')).includes('重要内容'),
);
ok(
  'data/orders.csv 已恢复',
  fs.existsSync(path.join(ws, 'data/orders.csv')),
  await read('data/orders.csv'),
);
ok(
  'data/users.csv 已恢复',
  (await read('data/users.csv')).includes('alice'),
);
ok(
  '多余的 temp_cleanup.log 已删除',
  !fs.existsSync(path.join(ws, 'temp_cleanup.log')),
);
ok(
  '多余的 data/backup.csv 已删除',
  !fs.existsSync(path.join(ws, 'data', 'backup.csv')),
);

// 最终文件列表
section('6. 最终工作区状态');
async function listFiles(rel = '') {
  const abs = path.join(ws, rel);
  const items = await fsp.readdir(abs, { withFileTypes: true });
  const out = [];
  for (const it of items) {
    const childRel = rel ? `${rel}/${it.name}` : it.name;
    if (it.isDirectory()) out.push(...(await listFiles(childRel)));
    else out.push(childRel);
  }
  return out;
}
const finalFiles = (await listFiles()).sort();
console.log(`共 ${finalFiles.length} 个文件：`);
for (const f of finalFiles) {
  const size = fs.statSync(path.join(ws, f)).size;
  console.log(`  · ${f}  (${formatBytes(size)})`);
}

const expected = [...initialFiles].sort();
ok(
  '文件列表与初始状态完全一致',
  JSON.stringify(finalFiles) === JSON.stringify(expected),
  `${finalFiles.length} vs ${expected.length}`,
);

// ============================================================

section('7. 对比：其他产品做不到什么');

console.log(`
  Grok Bot    : 停止任务不会撤销已完成的操作
  Dots        : 官方明确"停止任务不会撤销已经完成的操作"
  dsh-bot     : ✅ 回滚到任意快照，本次恢复了 ${result.restored.length} 个文件、
                删除了 ${result.removed.length} 个多余文件
`);

// ============================================================

section('8. 清理');
await fsp.rm(tmp, { recursive: true, force: true });
console.log('临时目录已清理');

console.log(
  `\n${process.exitCode === 1 ? '❌ 存在失败项' : '✅ 回滚能力验证通过'}\n`,
);
