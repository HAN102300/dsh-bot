/**
 * 端到端冒烟测试
 *
 * 不依赖 DSH 运行时，直接用真实文件系统验证完整闭环：
 *   创建 Bot → 写记忆 → 检索 → 保存运行 → 预算 → 重启后仍可读
 *
 * 运行： node dev/smoke.mjs
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distEntry = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;

const { BotService, DEFAULT_CONFIG, assertInsideWorkspace } = await import(distEntry);

function ok(label, cond, extra = '') {
  const mark = cond ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${label}${extra ? ' — ' + extra : ''}`);
  if (!cond) process.exitCode = 1;
}

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-bot-smoke-'));
const config = {
  ...DEFAULT_CONFIG,
  homeDir: tmp,
};

console.log('\n=== 1. 创建 Bot ===');
let service = new BotService({}, config);

const bot = await service.create({
  name: '日报小助手',
  role: '每天汇总 Git 提交并生成中文日报',
  budget: { dailyCny: 2, monthlyCny: 30 },
});
ok('Bot 已创建', !!bot.id, bot.id);
ok('工作区已建', fs.existsSync(service.workspacePath(bot.id)));
ok('默认走 DeepSeek', bot.model.provider === 'deepseek' && bot.model.model === 'deepseek-flash');
ok('预算已设置', bot.budget.dailyCny === 2);

console.log('\n=== 2. 写入记忆 ===');
await service.appendMemory(bot.id, {
  kind: 'observation',
  summary: '发现 main 分支有 3 个未处理的 TODO',
  tags: ['todo', '代码'],
  importance: 4,
});
await service.appendMemory(bot.id, {
  kind: 'outcome',
  summary: '已生成 10 月 18 日日报并发送',
  tags: ['日报'],
  importance: 3,
});
await service.appendMemory(bot.id, {
  kind: 'preference',
  summary: '用户偏好简洁的中文日报，控制在 400 字内',
  tags: ['偏好', '格式'],
  importance: 5,
});

const mems = await service.listMemories(bot.id);
ok('记忆已持久化', mems.length === 3, `${mems.length} 条`);

console.log('\n=== 3. 记忆检索 ===');
const hits = await service.recall(bot.id, 'TODO 代码');
ok('检索有结果', hits.length > 0);
ok('首位是相关记忆', hits[0]?.summary.includes('TODO'), hits[0]?.summary);

const prefHits = await service.recall(bot.id, '偏好 格式');
ok('能检索到偏好', prefHits.some((m) => m.kind === 'preference'));

console.log('\n=== 4. 目标状态（守得住） ===');
await service.setSemantic(bot.id, {
  updatedAt: new Date().toISOString(),
  facts: ['仓库位于 D:/work/myproject'],
  preferences: ['中文'],
  goals: [
    {
      id: 'g_daily',
      description: '每个工作日 9:00 产出中文日报',
      status: 'active',
      progress: '已连续 3 个工作日成功',
      updatedAt: new Date().toISOString(),
      nextStep: '明日 9:00 继续',
      needsHuman: false,
    },
  ],
});

const semantic = await service.getSemantic(bot.id);
ok('目标已保存', semantic.goals.length === 1);
ok('目标状态正确', semantic.goals[0].status === 'active');

console.log('\n=== 5. 运行记录（收得回的基础） ===');
const runId = 'run_test0001';
await service.saveRun({
  id: runId,
  botId: bot.id,
  trigger: 'manual',
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  dryRun: true,
  status: 'success',
  steps: [
    {
      index: 0,
      kind: 'tool',
      name: 'bash',
      args: { command: 'git log --since=yesterday' },
      result: { exitCode: 0, stdout: 'abc123 修复登录' },
      durationMs: 120,
    },
    {
      index: 1,
      kind: 'tool',
      name: 'webhook_post',
      args: { url: 'https://example.com/hook' },
      blocked: { reason: '[dry-run] 将调用 webhook_post' },
      durationMs: 0,
    },
  ],
  usage: {
    inputTokens: 3000,
    outputTokens: 400,
    cacheHitTokens: 2100,
    cacheMissTokens: 900,
    reasoningTokens: 150,
    costCny: 0.0032,
  },
});

const runs = await service.listRuns(bot.id);
ok('运行已记录', runs.length === 1);
ok('dry-run 标记正确', runs[0].dryRun === true);
ok('外部副作用被拦截', runs[0].steps[1].blocked !== undefined);
ok(
  '缓存命中已记录',
  runs[0].usage.cacheHitTokens === 2100,
  `命中率 ${((2100 / 3000) * 100).toFixed(0)}%`,
);

console.log('\n=== 6. 预算守卫 ===');
const todayCost = await service.spentToday(bot.id);
ok('今日花费已统计', Math.abs(todayCost - 0.0032) < 1e-9, `¥${todayCost.toFixed(4)}`);

await service.checkBudget(bot.id, 1);
ok('未超预算时放行', true);

// 造一笔大额消费触发熔断
await service.saveRun({
  id: 'run_big',
  botId: bot.id,
  trigger: 'manual',
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  dryRun: false,
  status: 'success',
  steps: [],
  usage: {
    inputTokens: 0,
    outputTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    reasoningTokens: 0,
    costCny: 5,
  },
});

let budgetBlocked = false;
try {
  await service.checkBudget(bot.id, 1);
} catch (e) {
  budgetBlocked = e.code === 'BUDGET_EXCEEDED';
}
ok('超预算被熔断', budgetBlocked);

console.log('\n=== 7. 重启后数据仍在（持久化） ===');
const service2 = new BotService({}, config);
const reloaded = await service2.get(bot.id);
ok('Bot 可重新加载', reloaded.id === bot.id);
ok('记忆仍在', (await service2.listMemories(bot.id)).length === 3);
ok('语义记忆仍在', (await service2.getSemantic(bot.id)).goals.length === 1);
ok('运行记录仍在', (await service2.listRuns(bot.id)).length === 2);

console.log('\n=== 8. 列表与统计 ===');
const list = await service2.list();
ok('列表返回 1 个 Bot', list.length === 1);
ok('运行次数正确', list[0].runCount === 2, `${list[0].runCount} 次`);
ok('最近状态可读', list[0].lastRunStatus === 'success');

console.log('\n=== 9. 路径穿越防护 ===');
let sandboxBlocked = false;
try {
  assertInsideWorkspace(service.workspacePath(bot.id), 'C:/Windows/System32/config');
} catch (e) {
  sandboxBlocked = e.code === 'SANDBOX_VIOLATION';
}
ok('越界写入被拒绝', sandboxBlocked);

console.log('\n=== 10. 清理 ===');
await service2.remove(bot.id);
ok('Bot 已删除', !fs.existsSync(service2.botDir(bot.id)));
await fsp.rm(tmp, { recursive: true, force: true });

console.log(
  `\n${process.exitCode === 1 ? '❌ 存在失败项' : '✅ 全部通过'} — 冒烟测试结束\n`,
);
