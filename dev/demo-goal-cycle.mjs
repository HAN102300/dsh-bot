/**
 * 目标闭环端到端验证
 *
 * 用真实的 BotService + RoutineRunner，跑一遍完整的生命周期：
 *
 *   建目标 → 跑一轮 → 看到进展 → Bot 判定完成 → 停在"待确认"
 *          → 人确认 → 归档 → 生成接续候选 → 接受 → 无缝续上
 *
 * 这个脚本的重点不是覆盖率，而是**证明闭环真的通了**：
 * 特别是"Bot 判定完成后停在待确认、不会自己变成 achieved"，
 * 以及"目标归档后 routine 仍在"。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

// dev/ 下的脚本统一跑在构建产物上，不依赖 tsx。
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;

const {
  BotService,
  RoutineRunner,
  createGoal,
  proposeSuccessors,
  parseYaml,
  validateRoutine,
} = await import(entry);

let pass = 0;
let fail = 0;

function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? `\n     ${detail}` : ''}`);
  }
}

/** 造一个假的 LLM：按脚本返回，并记录收到的系统提示 */
function makeFakeLlm(script) {
  const calls = [];
  let i = 0;
  return {
    calls,
    fn: async (input) => {
      calls.push(input);
      const step = script[Math.min(i, script.length - 1)];
      i++;
      return {
        text: typeof step === 'function' ? step(input) : step,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheHitTokens: 0,
          cacheMissTokens: 100,
          reasoningTokens: 0,
          costCny: 0.0012,
        },
      };
    },
  };
}

const ROUTINE_YAML = `
apiVersion: dsh-bot/v1
kind: Routine
metadata:
  id: tidy-downloads
  name: 整理下载文件夹
spec:
  triggers:
    - type: cron
      expression: "0 9 * * *"
  steps:
    - id: think
      type: llm
      name: 判断该怎么整理
      prompt: 看看下载文件夹里有什么
`;

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-bot-e2e-'));
  const config = {
    homeDir: root,
    defaultProvider: 'deepseek',
    defaultModel: 'deepseek-flash',
    defaultReasoningEffort: 'low',
    defaultDryRun: true,
    schedulerTickMs: 30000,
    costSensitiveScheduling: false,
    defaultDailyCny: 5,
    defaultMonthlyCny: 100,
  };

  const service = new BotService({}, config);
  const bot = await service.create({
    name: '文件管家',
    role: '整理下载文件夹',
  });

  console.log(`\n🤖 Bot 已建：${bot.name} (${bot.id})\n`);

  // ---------------------------------------------------------
  console.log('① 设定目标');
  // ---------------------------------------------------------
  const goal = createGoal(
    'goal_demo',
    { description: '整理下载文件夹', type: 'one-shot' },
    new Date().toISOString(),
  );
  await service.saveGoal(bot.id, goal);

  const readBack = await service.getGoal(bot.id);
  ok('目标已落盘', readBack?.description === '整理下载文件夹');
  ok('初始状态是 active', readBack?.status === 'active');

  // ---------------------------------------------------------
  console.log('\n② 跑第一轮（Bot 说还没做完）');
  // ---------------------------------------------------------
  const llm1 = makeFakeLlm([
    '我看了一下，有 12 个文件需要归档。\n\n' +
      '<<<goal>>>\n' +
      '{"achieved": false, "hasNewSituation": true, "needsHuman": false, ' +
      '"note": "已归档 5 个文件，还剩 7 个", "nextStep": "继续归档剩余文件"}\n' +
      '<<<!/goal>>>',
  ]);

  const runner = new RoutineRunner({
    service,
    llm: llm1.fn,
    tools: { has: () => true, call: async () => ({ ok: true }) },
    newId: (p) => `${p}_${Math.random().toString(16).slice(2, 10)}`,
    nowIso: () => new Date().toISOString(),
    snapshotEnabled: false,
  });

  const routine = validateRoutine(parseYaml(ROUTINE_YAML));
  // 存下来——routine 独立于目标存在，这是"目标换了它还在"的前提
  await service.saveRoutine(bot.id, routine);

  const run1 = await runner.runRoutine(bot.id, routine, {
    dryRun: false,
    trigger: 'manual',
  });

  ok('第一轮运行成功', run1.status === 'success', `实际：${run1.status}`);
  ok('目标评估已记录', Boolean(run1.goalAssessment));
  ok('效果是 progress', run1.goalEffect === 'progress', `实际：${run1.goalEffect}`);
  ok('评估块已从输出里剥掉', !String(run1.steps[0].result.output).includes('<<<goal>>>'));

  const afterRun1 = await service.getGoal(bot.id);
  ok('进展已写进目标', String(afterRun1?.progress).includes('已归档 5 个文件'), `实际：${afterRun1?.progress}`);
  ok('下一步已记录', Boolean(afterRun1?.nextStep));
  ok('状态仍是 active', afterRun1?.status === 'active');

  // ---------------------------------------------------------
  console.log('\n③ 跑第二轮 —— 验证"记得住"');
  // ---------------------------------------------------------
  const llm2 = makeFakeLlm([
    '继续归档。\n\n<<<goal>>>\n{"achieved": false, "note": "又归档了 4 个"}\n<<<!/goal>>>',
  ]);
  const runner2 = new RoutineRunner({
    service,
    llm: llm2.fn,
    tools: { has: () => true, call: async () => ({ ok: true }) },
    newId: (p) => `${p}_${Math.random().toString(16).slice(2, 10)}`,
    nowIso: () => new Date().toISOString(),
    snapshotEnabled: false,
  });

  await runner2.runRoutine(bot.id, routine, { dryRun: false, trigger: 'schedule' });

  const sysPrompt = llm2.calls[0]?.system ?? '';
  ok('第二轮的系统提示带着目标', sysPrompt.includes('整理下载文件夹'));
  ok(
    '第二轮的系统提示带着上一轮的进展（记忆闭环）',
    sysPrompt.includes('已归档 5 个文件'),
    `提示里没有找到上一轮进展`,
  );
  ok('第二轮的系统提示带着上一轮运行记录', sysPrompt.includes('最近几次运行'));

  // ---------------------------------------------------------
  console.log('\n④ Bot 判定完成 —— 必须停在"待确认"');
  // ---------------------------------------------------------
  const llm3 = makeFakeLlm([
    '全部整理完毕。\n\n<<<goal>>>\n' +
      '{"achieved": true, "needsHuman": false, "note": "归档 12 个，清理 2 个临时文件"}\n' +
      '<<<!/goal>>>',
  ]);
  const runner3 = new RoutineRunner({
    service,
    llm: llm3.fn,
    tools: { has: () => true, call: async () => ({ ok: true }) },
    newId: (p) => `${p}_${Math.random().toString(16).slice(2, 10)}`,
    nowIso: () => new Date().toISOString(),
    snapshotEnabled: false,
  });

  const run3 = await runner3.runRoutine(bot.id, routine, {
    dryRun: false,
    trigger: 'manual',
  });

  const afterRun3 = await service.getGoal(bot.id);
  ok('效果是 pending', run3.goalEffect === 'pending', `实际：${run3.goalEffect}`);
  ok(
    '⭐ 状态是 pending_confirmation，不是 achieved',
    afterRun3?.status === 'pending_confirmation',
    `实际：${afterRun3?.status}`,
  );
  ok('needsHuman 被置为真', afterRun3?.needsHuman === true);

  // ---------------------------------------------------------
  console.log('\n⑤ 人确认达成 → 归档 → 生成接续候选');
  // ---------------------------------------------------------
  const summary = (await service.list()).find((b) => b.id === bot.id);
  ok('列表摘要显示待确认', summary?.pendingConfirmCount === 1);

  const achieved = { ...afterRun3, status: 'achieved', needsHuman: false };
  const archive = await service.archiveGoal(bot.id, achieved, {
    totalRuns: 3,
    totalCostCny: 0.0036,
    outcome: '归档 12 个文件，清理 2 个临时文件',
    snapshotIds: [],
  });
  await service.clearGoal(bot.id);

  ok('目标已归档', archive.description === '整理下载文件夹');
  ok('归档记录了运行次数', archive.totalRuns === 3);
  ok('当前目标已清空', (await service.getGoal(bot.id)) === undefined);

  const archives = await service.listGoalArchives(bot.id);
  ok('目标史里有 1 条', archives.length === 1);

  const { proposals, source } = await proposeSuccessors(
    {
      service,
      // 故意不传 llm，验证降级路径
      newId: (p) => `${p}_${Math.random().toString(16).slice(2, 10)}`,
      nowIso: () => new Date().toISOString(),
    },
    bot.id,
    archive,
  );

  ok('生成了接续候选', proposals.length > 0, `实际：${proposals.length} 个`);
  ok('降级路径可用（无模型也不失败）', source === 'rule');
  ok(
    '第一条候选是把一次性升格为常驻',
    proposals[0]?.type === 'standing',
    `实际：${proposals[0]?.type} / ${proposals[0]?.description}`,
  );
  ok('候选状态是 proposed（不会自动生效）', proposals[0]?.status === 'proposed');
  ok('候选记住了来源', proposals[0]?.origin === archive.id);

  // ---------------------------------------------------------
  console.log('\n⑥ 接受候选 → 无缝续上');
  // ---------------------------------------------------------
  const picked = proposals[0];
  const resumed = { ...picked, status: 'active', progress: '刚接受，尚未开始' };
  await service.saveGoal(bot.id, resumed);
  await service.clearProposals(bot.id);

  const current = await service.getGoal(bot.id);
  ok('新目标已生效', current?.status === 'active');
  ok('新目标是 standing', current?.type === 'standing');
  ok('候选已清空', (await service.listProposals(bot.id)).length === 0);

  // ---------------------------------------------------------
  console.log('\n⑦ routine 从未中断（目标换了它还在）');
  // ---------------------------------------------------------
  const routines = await service.listRoutines(bot.id);
  ok('routine 仍在', routines.length === 1, `实际：${routines.length}`);
  ok('routine 名称正确', routines[0]?.name === '整理下载文件夹');

  // ---------------------------------------------------------
  console.log('\n⑧ standing 目标：完成一轮只加轮次，永不 achieved');
  // ---------------------------------------------------------
  const llm4 = makeFakeLlm([
    '这一轮守住了。\n\n<<<goal>>>\n{"achieved": true, "note": "本轮检查完毕，一切正常"}\n<<<!/goal>>>',
  ]);
  const runner4 = new RoutineRunner({
    service,
    llm: llm4.fn,
    tools: { has: () => true, call: async () => ({ ok: true }) },
    newId: (p) => `${p}_${Math.random().toString(16).slice(2, 10)}`,
    nowIso: () => new Date().toISOString(),
    snapshotEnabled: false,
  });

  const routine2 = validateRoutine(
    parseYaml(ROUTINE_YAML.replace('tidy-downloads', 'keep-clean')),
  );
  const run4 = await runner4.runRoutine(bot.id, routine2, {
    dryRun: false,
    trigger: 'schedule',
  });

  const afterRun4 = await service.getGoal(bot.id);
  ok('效果是 cycle', run4.goalEffect === 'cycle', `实际：${run4.goalEffect}`);
  ok('轮次 +1', afterRun4?.cycleCount === 1, `实际：${afterRun4?.cycleCount}`);
  ok('⭐ 状态仍是 active，永不 achieved', afterRun4?.status === 'active');

  // ---------------------------------------------------------
  console.log('\n⑨ dry-run 不能改变目标状态');
  // ---------------------------------------------------------
  const beforeDry = await service.getGoal(bot.id);
  const llm5 = makeFakeLlm([
    '演习。\n\n<<<goal>>>\n{"achieved": true, "note": "假装做完了"}\n<<<!/goal>>>',
  ]);
  const runner5 = new RoutineRunner({
    service,
    llm: llm5.fn,
    tools: { has: () => true, call: async () => ({ ok: true }) },
    newId: (p) => `${p}_${Math.random().toString(16).slice(2, 10)}`,
    nowIso: () => new Date().toISOString(),
    snapshotEnabled: false,
  });

  const run5 = await runner5.runRoutine(bot.id, routine2, {
    dryRun: true,
    trigger: 'manual',
  });

  const afterDry = await service.getGoal(bot.id);
  ok('演习不产生目标效果', run5.goalEffect === 'none', `实际：${run5.goalEffect}`);
  ok('轮次没变', afterDry?.cycleCount === beforeDry?.cycleCount);
  ok('状态没变', afterDry?.status === beforeDry?.status);

  // ---------------------------------------------------------
  await fs.rm(root, { recursive: true, force: true });

  console.log(`\n${'─'.repeat(46)}`);
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  console.log(`${'─'.repeat(46)}\n`);

  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('\n💥 验证脚本自身出错：', e);
  process.exitCode = 1;
});
