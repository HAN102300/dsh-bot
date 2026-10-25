/**
 * 调度器端到端演示
 *
 * 走一遍完整场景：
 *   1. 创建 Bot + 带 cron 的 Routine
 *   2. 查看排期（含错峰提示）
 *   3. 模拟 tick 到点 → 自动执行
 *   4. 去重验证
 *   5. 心跳与休眠检测
 *
 * 运行： node dev/demo-schedule.mjs
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;

const {
  BotService,
  RoutineRunner,
  validateRoutine,
  parseCron,
  describeCron,
  nextRunAt,
  adjustForCost,
  describeTimeSlot,
  toZonedDate,
  DEFAULT_CONFIG,
} = await import(entry);

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-bot-sch-'));
const service = new BotService({}, {
  ...DEFAULT_CONFIG,
  homeDir: tmp,
  costSensitiveScheduling: true,
});

function section(t) {
  console.log(`\n${'='.repeat(60)}\n${t}\n${'='.repeat(60)}`);
}
function ok(label, cond, extra = '') {
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}
function fmtBj(d) {
  if (!d) return '(无)';
  return d.toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false,
  });
}

// ============================================================

section('1. 创建 Bot 与带定时的流程');

const bot = await service.create({
  name: '日报小助手',
  role: '每个工作日早上生成日报',
  budget: { dailyCny: 2, monthlyCny: 30 },
});
console.log(`Bot: ${bot.name} (${bot.id})`);

const routine = validateRoutine({
  apiVersion: 'dsh-bot/v1',
  kind: 'Routine',
  metadata: { id: 'daily-report', name: '每日工作日报', version: 1 },
  spec: {
    triggers: [
      {
        type: 'cron',
        expression: '0 9 * * 1-5',
        timezone: 'Asia/Shanghai',
        // ⭐ 日报必须准时：不允许被错峰推迟
        costSensitive: false,
      },
      { type: 'manual' },
    ],
    params: {},
    steps: [
      { id: 'collect', type: 'tool', tool: 'bash', args: { command: 'git log --since=yesterday' } },
      { id: 'summarize', type: 'llm', prompt: '基于 {{.steps.collect.result}} 写日报' },
    ],
  },
});
await service.saveRoutine(bot.id, routine);

// 再建一个"备份类"任务：允许错峰
const backup = validateRoutine({
  apiVersion: 'dsh-bot/v1',
  kind: 'Routine',
  metadata: { id: 'nightly-backup', name: '数据备份', version: 1 },
  spec: {
    triggers: [
      {
        type: 'cron',
        expression: '0 10 * * *', // 10 点，但可能错峰
        timezone: 'Asia/Shanghai',
        costSensitive: true, // ⭐ 备份不急，省钱优先
      },
    ],
    params: {},
    steps: [{ id: 'zip', type: 'tool', tool: 'bash', args: { command: 'tar czf backup.tgz data/' } }],
  },
});
await service.saveRoutine(bot.id, backup);

const cron = parseCron('0 9 * * 1-5');
console.log(`流程 1：${routine.metadata.name}  (costSensitive: false)`);
console.log(`定时：0 9 * * 1-5  (${describeCron(cron)})`);
console.log(`流程 2：${backup.metadata.name}  (costSensitive: true)`);
console.log(`定时：0 10 * * *`);

// ============================================================

section('2. 排期与错峰提示');

const upcoming = await service.scheduler().upcoming();
console.log(`共 ${upcoming.length} 个定时任务：\n`);
for (const u of upcoming) {
  console.log(`· ${u.botName} / ${u.routineName}`);
  console.log(`  ${u.expression} · ${u.timeZone}`);
  const next = new Date(u.nextRunAt);
  console.log(`  下次执行：${fmtBj(next)}  [${describeTimeSlot(next)}]`);
  if (u.nextRunShiftsTo) {
    const shifted = new Date(u.nextRunShiftsTo);
    const mins = Math.round((shifted.getTime() - next.getTime()) / 60000);
    console.log(`  错峰推迟 ${mins} 分钟后：${fmtBj(shifted)}  [${describeTimeSlot(shifted)}]`);
  }
}
ok('排期已生成', upcoming.length > 0);

// ============================================================

section('3. 峰谷错峰实测');

console.log('对比不同时刻的调度行为：\n');
const samples = [
  ['2026-10-20T02:30:00Z', '周二 北京 10:30'],
  ['2026-10-20T07:20:00Z', '周二 北京 15:20'],
  ['2026-10-20T12:00:00Z', '周二 北京 20:00'],
  ['2026-10-24T02:00:00Z', '周六 北京 10:00'],
];
for (const [iso, label] of samples) {
  const t = new Date(iso);
  const shifted = adjustForCost(t, true);
  const moved = shifted.getTime() !== t.getTime();
  const mins = moved ? Math.round((shifted.getTime() - t.getTime()) / 60000) : 0;
  console.log(
    `  ${label.padEnd(18)} ${describeTimeSlot(t).padEnd(14)}` +
    (moved ? ` → 推迟 ${mins} 分钟到 ${fmtBj(shifted)}` : ' → 不推迟'),
  );
}

// ============================================================

section('4. ⭐ 模拟 tick 到点触发');

const runner = new RoutineRunner({
  service,
  llm: async () => ({
    text: '日报内容：完成 3 项任务',
    usage: {
      inputTokens: 500, outputTokens: 100, cacheHitTokens: 400,
      cacheMissTokens: 100, reasoningTokens: 0, costCny: 0.0005,
    },
  }),
  tools: {
    has: () => true,
    call: async () => ({ exitCode: 0, stdout: 'abc123 修复登录' }),
  },
  newId: (p) => `${p}_${Math.random().toString(16).slice(2, 10)}`,
  nowIso: () => new Date().toISOString(),
  snapshotEnabled: true,
});

// 为了演示，用 "* * * * *" 的临时流程（每分钟都匹配）
const everyMin = validateRoutine({
  apiVersion: 'dsh-bot/v1',
  kind: 'Routine',
  metadata: { id: 'demo-every-min', name: '演示用：每分钟', version: 1 },
  spec: {
    triggers: [{ type: 'cron', expression: '* * * * *', timezone: 'Asia/Shanghai' }],
    params: {},
    steps: [{ id: 'a', type: 'llm', prompt: '演示' }],
  },
});
await service.saveRoutine(bot.id, everyMin);

const fired = [];
await service.schedulerTick(async (fire) => {
  const r = await service.getRoutine(fire.botId, fire.routineId);
  const rec = await runner.runRoutine(fire.botId, r, {
    dryRun: false,
    trigger: 'schedule',
  });
  fired.push({ fire, rec });
});

console.log(`本次 tick 触发 ${fired.length} 个任务：`);
for (const { fire, rec } of fired) {
  console.log(`  · ${fire.routineId}  运行 ${rec.id}  状态=${rec.status}`);
  console.log(`    计划 ${fire.plannedAt} → 实际 ${fire.actualAt}`);
}
ok('定时任务已触发并执行', fired.length > 0);

// ============================================================

section('5. 去重验证（同一分钟不重复触发）');

const second = [];
await service.schedulerTick(async (fire) => {
  second.push(fire);
});
console.log(`第二次 tick 触发 ${second.length} 个任务`);
ok('同一分钟不会重复触发', second.length === 0);

// ============================================================

section('6. 心跳与休眠检测');

const beat1 = await service.scheduler().beat(new Date());
console.log(`正常心跳：wokeFromSleep=${beat1.wokeFromSleep}`);

// 模拟休眠 1 小时后醒来
const snoozed = new Date(Date.now() + 3600_000);
const beat2 = await service.scheduler().beat(snoozed);
console.log(`休眠后心跳：wokeFromSleep=${beat2.wokeFromSleep}  gap=${Math.round(beat2.gapMs / 1000)}s`);
ok('检测到休眠', beat2.wokeFromSleep === true);

const status = await service.scheduler().heartbeatStatus();
console.log(`心跳状态：isStale=${status.isStale}  missedBeats=${status.missedBeats}`);

// ============================================================

section('7. 执行历史');

const runs = await service.listRuns(bot.id);
console.log(`共 ${runs.length} 条运行记录：`);
for (const r of runs) {
  console.log(`  ${r.id}  ${r.status.padEnd(8)} trigger=${r.trigger.padEnd(8)} ¥${r.usage.costCny.toFixed(6)}`);
}
const scheduledRuns = runs.filter((r) => r.trigger === 'schedule');
ok('有定时触发的记录', scheduledRuns.length > 0, `${scheduledRuns.length} 条`);

// ============================================================

section('8. 清理');
await fsp.rm(tmp, { recursive: true, force: true });
console.log('临时目录已清理');

console.log(`\n${process.exitCode === 1 ? '❌ 存在失败项' : '✅ 调度器验证通过'}\n`);
