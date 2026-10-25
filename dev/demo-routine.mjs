/**
 * 端到端演示：完整走一遍「创建 → 写流程 → dry-run → 真执行 → 查历史」
 *
 * 用假的 LLM 与工具，演示引擎行为而不消耗 API 额度。
 *
 * 运行： node dev/demo-routine.mjs
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
  parseYaml,
  validateRoutine,
  DEFAULT_CONFIG,
} = await import(entry);

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-bot-demo-'));
const service = new BotService({}, { ...DEFAULT_CONFIG, homeDir: tmp });

// ---- 假的 LLM 与工具 ----
let toolCallLog = [];
const fakeLlm = async (input) => ({
  text: `[模拟模型] 针对「${input.prompt.slice(0, 30)}」的回答`,
  usage: {
    inputTokens: 1000,
    outputTokens: 200,
    cacheHitTokens: 800,
    cacheMissTokens: 200,
    reasoningTokens: 50,
    costCny: 0.0009,
  },
});
const fakeTools = {
  has: () => true,
  call: async (name, args) => {
    toolCallLog.push({ name, args });
    if (name === 'bash') return { exitCode: 0, stdout: 'abc123 修复登录\ndef456 补充文档' };
    if (name === 'webhook_post') return { status: 200 };
    return { ok: true };
  },
};

const runner = new RoutineRunner({
  service,
  llm: fakeLlm,
  tools: fakeTools,
  newId: (p) => `${p}_${Math.random().toString(16).slice(2, 10)}`,
  nowIso: () => new Date().toISOString(),
});

function section(t) {
  console.log(`\n${'='.repeat(56)}\n${t}\n${'='.repeat(56)}`);
}

// ============================================================

section('1. 创建 Bot');

const bot = await service.create({
  name: '日报小助手',
  role: '每天汇总 Git 提交，生成中文日报并发送',
  budget: { dailyCny: 2, monthlyCny: 30 },
});
console.log(`Bot: ${bot.name} (${bot.id})`);
console.log(`模型: ${bot.model.provider}/${bot.model.model}  effort=${bot.model.reasoningEffort}`);
console.log(`预算: ¥${bot.budget.dailyCny}/天`);
console.log(`工作区: ${bot.workspace}`);

// ============================================================

section('2. 保存一个 Routine（YAML）');

const routineYaml = `
apiVersion: dsh-bot/v1
kind: Routine
metadata:
  id: daily-report
  name: 每日工作日报
  description: 汇总昨日提交，生成中文日报并发送
  version: 1
spec:
  triggers:
    - type: cron
      expression: "0 9 * * 1-5"
      timezone: Asia/Shanghai
  params:
    repoPath: D:/work/myproject
  steps:
    - id: fetch-commits
      name: 拉取昨日提交
      type: tool
      tool: bash
      args:
        command: git log --since=yesterday --pretty=format:"%h|%s"
    - id: summarize
      name: 生成日报
      type: llm
      prompt: |
        基于以下提交记录写一份中文日报：
        {{.steps.fetch-commits.result.stdout}}
        要求：按模块分类，突出风险，控制在 400 字内。
    - id: deliver
      name: 发送到群
      type: tool
      tool: webhook_post
      args:
        url: https://example.com/hook
        body:
          text: "{{.steps.summarize.output}}"
`;

const parsed = validateRoutine(parseYaml(routineYaml));
await service.saveRoutine(bot.id, parsed);

console.log(`已保存流程「${parsed.metadata.name}」(${parsed.metadata.id})`);
console.log(`步骤数: ${parsed.spec.steps.length}`);
console.log(`触发: ${parsed.spec.triggers.map((t) => `cron ${t.expression}`).join(', ')}`);

// ============================================================

section('3. ⭐ 第一次运行：dry-run（默认）');

toolCallLog = [];
const dryRun = await runner.runRoutine(bot.id, parsed, {
  dryRun: true,
  trigger: 'manual',
});

console.log(`状态: ${dryRun.status}   dry-run: ${dryRun.dryRun}`);
console.log(`实际调用工具次数: ${toolCallLog.length}`);
console.log('\n步骤明细:');
for (const s of dryRun.steps) {
  const flag = s.blocked ? ' [拦截]' : '';
  console.log(`  ${s.index + 1}. ${s.kind}:${s.name}${flag}`);
  if (s.blocked) console.log(`     → ${s.blocked.reason}`);
}
console.log(`\n花费: ¥${dryRun.usage.costCny.toFixed(6)}`);

if (toolCallLog.length !== 0) {
  console.error('\n❌ 错误：dry-run 下不应调用任何有副作用的工具！');
  process.exitCode = 1;
} else {
  console.log('\n✅ 所有外部副作用已被拦截，未产生真实影响。');
}

// ============================================================

section('4. 确认后第二次运行：dryRun=false');

toolCallLog = [];
const realRun = await runner.runRoutine(bot.id, parsed, {
  dryRun: false,
  trigger: 'manual',
});

console.log(`状态: ${realRun.status}   dry-run: ${realRun.dryRun}`);
console.log(`实际调用工具: ${toolCallLog.length} 次`);
for (const t of toolCallLog) {
  console.log(`  · ${t.name}(${JSON.stringify(t.args).slice(0, 60)}...)`);
}

console.log('\n步骤结果:');
for (const s of realRun.steps) {
  const out =
    s.kind === 'llm'
      ? String(s.result?.output ?? '').slice(0, 50)
      : JSON.stringify(s.result ?? {}).slice(0, 50);
  console.log(`  ${s.index + 1}. ${s.kind}:${s.name} → ${out}`);
}

// ============================================================

section('5. 运行历史（全量保留）');

const runs = await service.listRuns(bot.id);
console.log(`共 ${runs.length} 条记录（Grok Bot 只保留最近 20 条）`);
for (const r of runs) {
  console.log(
    `  ${r.id}  ${r.status.padEnd(8)} dryRun=${String(r.dryRun).padEnd(5)} ¥${r.usage.costCny.toFixed(6)}`,
  );
}

// ============================================================

section('6. 记忆已自动累积');

const memories = await service.listMemories(bot.id);
console.log(`共 ${memories.length} 条记忆:`);
for (const m of memories) {
  console.log(`  [${m.kind}] ${m.summary}`);
}

const recalled = await service.recall(bot.id, '日报');
console.log(`\n检索「日报」→ ${recalled.length} 条命中`);

// ============================================================

section('7. 预算守卫');

console.log(`今日已花费: ¥${(await service.spentToday(bot.id)).toFixed(6)}`);
console.log(`日预算上限: ¥${bot.budget.dailyCny}`);

// 造一笔大额消费
await service.saveRun({
  id: 'run_fake_big',
  botId: bot.id,
  trigger: 'manual',
  startedAt: new Date().toISOString(),
  endedAt: new Date().toISOString(),
  dryRun: false,
  status: 'success',
  steps: [],
  usage: {
    inputTokens: 0, outputTokens: 0, cacheHitTokens: 0,
    cacheMissTokens: 0, reasoningTokens: 0, costCny: 5,
  },
});

try {
  await service.checkBudget(bot.id, 0.5);
  console.log('⚠️ 预算守卫未生效');
  process.exitCode = 1;
} catch (e) {
  console.log(`✅ 预算熔断生效: ${e.message}`);
}

// ============================================================

section('8. 清理');
await fsp.rm(tmp, { recursive: true, force: true });
console.log('临时目录已清理');

console.log(
  `\n${process.exitCode === 1 ? '❌ 存在失败项' : '✅ 全流程演示完成'}\n`,
);
