/**
 * BotService 核心闭环测试
 *
 * 验证：创建 → 写记忆 → 检索 → 列表 → 预算 → 删除
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { BotService, scoreMemory, recallMemories, isInside } from '../../src/service.js';
import { createGoal, createProposal } from '../../src/goal/state.js';
import type { BotPluginConfig, MemoryEntry, RunRecord } from '../../src/types.js';
import { DEFAULT_CONFIG } from '../../src/index.js';

let tmpRoot: string;
let service: BotService;

function makeConfig(homeDir: string): BotPluginConfig {
  return { ...DEFAULT_CONFIG, homeDir };
}

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-bot-test-'));
  service = new BotService({}, makeConfig(tmpRoot));
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

describe('BotService 创建与查询', () => {
  it('创建 Bot 后应生成完整的目录结构', async () => {
    const bot = await service.create({
      name: '日报小助手',
      role: '每天汇总 Git 提交',
    });

    expect(bot.id).toMatch(/^bot_[0-9a-f]{8}$/);
    expect(bot.name).toBe('日报小助手');
    expect(bot.model.provider).toBe('deepseek');
    expect(bot.model.model).toBe('deepseek-flash');
    expect(bot.budget.dailyCny).toBe(5);

    // 目录结构
    expect(fs.existsSync(service.identityPath(bot.id))).toBe(true);
    expect(fs.existsSync(service.workspacePath(bot.id))).toBe(true);
    expect(fs.existsSync(service.routinesDir(bot.id))).toBe(true);
    expect(fs.existsSync(service.semanticPath(bot.id))).toBe(true);
  });

  it('名称或职责为空应抛出 INVALID_ARGS', async () => {
    await expect(service.create({ name: '  ', role: 'x' })).rejects.toThrow(
      /名称不能为空/,
    );
    await expect(service.create({ name: 'x', role: '' })).rejects.toThrow(
      /职责不能为空/,
    );
  });

  it('查询不存在的 Bot 应抛出 BOT_NOT_FOUND', async () => {
    await expect(service.get('bot_deadbeef')).rejects.toThrow(/找不到 Bot/);
  });

  it('list 应按创建时间倒序返回', async () => {
    const a = await service.create({ name: 'A', role: 'r' });
    const b = await service.create({ name: 'B', role: 'r' });

    const list = await service.list();
    expect(list).toHaveLength(2);
    // b 后创建，应排前面
    expect(list[0].id).toBe(b.id);
    expect(list[1].id).toBe(a.id);
  });
});

describe('记忆系统', () => {
  it('写入记忆后应能召回', async () => {
    const bot = await service.create({ name: 'T', role: 'r' });

    await service.appendMemory(bot.id, {
      kind: 'observation',
      summary: '昨天发现了 3 个 TODO',
      tags: ['todo', '代码'],
      importance: 4,
    });
    await service.appendMemory(bot.id, {
      kind: 'outcome',
      summary: '生成了日报并发到群里',
      tags: ['日报'],
      importance: 3,
    });

    const all = await service.listMemories(bot.id);
    expect(all).toHaveLength(2);
    expect(all[0].summary).toContain('TODO');
    expect(all[0].ts).toBeTruthy();
  });

  it('召回应按相关度排序', async () => {
    const bot = await service.create({ name: 'T', role: 'r' });

    await service.appendMemory(bot.id, {
      kind: 'observation',
      summary: '数据库备份失败了',
      tags: ['数据库'],
      importance: 5,
    });
    await service.appendMemory(bot.id, {
      kind: 'observation',
      summary: '今天天气不错',
      tags: ['天气'],
      importance: 2,
    });

    const hits = await service.recall(bot.id, '数据库 备份');
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].summary).toContain('数据库');
  });

  it('JSONL 中损坏的行应被跳过而不影响其它数据', async () => {
    const bot = await service.create({ name: 'T', role: 'r' });
    const file = service.memoryPath(bot.id);

    await fsp.appendFile(
      file,
      '{"ts":"2026-01-01T00:00:00.000Z","runId":"","kind":"fact","summary":"好行","tags":[],"importance":3}\n' +
        'THIS IS NOT JSON\n' +
        '{"ts":"2026-01-02T00:00:00.000Z","runId":"","kind":"fact","summary":"另一好行","tags":[],"importance":3}\n',
      'utf8',
    );

    const all = await service.listMemories(bot.id);
    expect(all).toHaveLength(2);
    expect(all.map((m) => m.summary)).toEqual(['好行', '另一好行']);
  });

  it('语义记忆应可读写', async () => {
    const bot = await service.create({ name: 'T', role: 'r' });
    const semantic = await service.getSemantic(bot.id);
    expect(semantic.facts).toEqual([]);
    expect(semantic.preferences).toEqual([]);
    // 目标不在语义记忆里——它是独立的一等公民
    expect(semantic).not.toHaveProperty('goals');

    await service.setSemantic(bot.id, {
      updatedAt: '',
      facts: ['用户偏好中文'],
      preferences: ['简洁'],
    });

    const after = await service.getSemantic(bot.id);
    expect(after.facts).toContain('用户偏好中文');
    expect(after.preferences).toContain('简洁');
  });

  it('旧格式的语义记忆（带 goals）读取时不报错并丢弃该字段', async () => {
    const bot = await service.create({ name: 'T', role: 'r' });
    // 模拟早期版本写入的数据
    fs.writeFileSync(
      path.join(service.botDir(bot.id), 'semantic.json'),
      JSON.stringify({
        updatedAt: '2026-01-01T00:00:00.000Z',
        facts: ['旧事实'],
        preferences: [],
        goals: [{ id: 'g1', description: '旧目标' }],
      }),
      'utf8',
    );

    const after = await service.getSemantic(bot.id);
    expect(after.facts).toEqual(['旧事实']);
    expect(after).not.toHaveProperty('goals');
  });

  it('addFact 会去重', async () => {
    const bot = await service.create({ name: 'T', role: 'r' });
    await service.addFact(bot.id, '同一件事');
    await service.addFact(bot.id, '同一件事');
    const after = await service.getSemantic(bot.id);
    expect(after.facts.filter((f) => f === '同一件事')).toHaveLength(1);
  });
});

// ============================================================
// 目标存储（「守得住」）
// ============================================================

describe('目标', () => {
  it('新建 Bot 时没有目标', async () => {
    const bot = await service.create({ name: 'T', role: 'r' });
    expect(await service.getGoal(bot.id)).toBeUndefined();
  });

  it('目标可保存与读取', async () => {
    const bot = await service.create({ name: 'T', role: 'r' });
    const goal = createGoal('g1', { description: '整理文件' }, new Date().toISOString());
    await service.saveGoal(bot.id, goal);

    const after = await service.getGoal(bot.id);
    expect(after?.description).toBe('整理文件');
    expect(after?.status).toBe('active');
  });

  it('clearGoal 后目标消失', async () => {
    const bot = await service.create({ name: 'T', role: 'r' });
    await service.saveGoal(
      bot.id,
      createGoal('g1', { description: 'x' }, new Date().toISOString()),
    );
    await service.clearGoal(bot.id);
    expect(await service.getGoal(bot.id)).toBeUndefined();
  });

  it('归档后进入目标史，且不设上限', async () => {
    const bot = await service.create({ name: 'T', role: 'r' });
    for (let i = 0; i < 25; i++) {
      const g = createGoal(`g${i}`, { description: `目标${i}` }, new Date().toISOString());
      await service.archiveGoal(bot.id, g, {
        totalRuns: 1,
        totalCostCny: 0.001,
        outcome: '完成',
        snapshotIds: [],
      });
    }
    const archives = await service.listGoalArchives(bot.id);
    // 对照 Grok Bot 的 20 条上限，我们是全量
    expect(archives).toHaveLength(25);
  });

  it('接续候选可增删', async () => {
    const bot = await service.create({ name: 'T', role: 'r' });
    const p = createProposal('p1', { description: '接着做' }, 'g_old', new Date().toISOString());
    await service.saveProposal(bot.id, p);
    expect(await service.listProposals(bot.id)).toHaveLength(1);

    await service.removeProposal(bot.id, 'p1');
    expect(await service.listProposals(bot.id)).toHaveLength(0);
  });

  it('clearProposals 清空全部候选', async () => {
    const bot = await service.create({ name: 'T', role: 'r' });
    for (let i = 0; i < 3; i++) {
      await service.saveProposal(
        bot.id,
        createProposal(`p${i}`, { description: `候选${i}` }, 'g', new Date().toISOString()),
      );
    }
    await service.clearProposals(bot.id);
    expect(await service.listProposals(bot.id)).toHaveLength(0);
  });

  it('list() 摘要里带目标信息（列表行要用）', async () => {
    const bot = await service.create({ name: 'T', role: 'r' });
    await service.saveGoal(
      bot.id,
      createGoal('g1', { description: '整理文件' }, new Date().toISOString()),
    );

    const list = await service.list();
    const mine = list.find((b) => b.id === bot.id);
    expect(mine?.goalDescription).toBe('整理文件');
    expect(mine?.goalStatus).toBe('active');
    expect(mine?.pendingConfirmCount).toBe(0);
  });

  it('待确认的目标会让待确认计数为 1', async () => {
    const bot = await service.create({ name: 'T', role: 'r' });
    const g = createGoal('g1', { description: 'x' }, new Date().toISOString());
    await service.saveGoal(bot.id, { ...g, status: 'pending_confirmation' });

    const mine = (await service.list()).find((b) => b.id === bot.id);
    expect(mine?.pendingConfirmCount).toBe(1);
  });
});

describe('记忆评分算法', () => {
  const now = Date.parse('2026-10-19T12:00:00Z');

  function entry(daysAgo: number, importance: number, summary: string): MemoryEntry {
    return {
      ts: new Date(now - daysAgo * 86_400_000).toISOString(),
      runId: '',
      kind: 'observation',
      summary,
      tags: [],
      importance,
    };
  }

  it('越新的记忆分数越高（同重要度、同内容）', () => {
    const fresh = entry(1, 3, '相同内容');
    const old = entry(60, 3, '相同内容');
    expect(scoreMemory(fresh, '相同内容', now)).toBeGreaterThan(
      scoreMemory(old, '相同内容', now),
    );
  });

  it('重要度高的记忆分数更高', () => {
    const high = entry(1, 5, '相同内容');
    const low = entry(1, 1, '相同内容');
    expect(scoreMemory(high, '相同内容', now)).toBeGreaterThan(
      scoreMemory(low, '相同内容', now),
    );
  });

  it('关键词命中应提高分数', () => {
    const hit = entry(1, 3, '数据库备份失败');
    const miss = entry(1, 3, '今天天气很好');
    expect(scoreMemory(hit, '数据库', now)).toBeGreaterThan(
      scoreMemory(miss, '数据库', now),
    );
  });

  it('recallMemories 应限制返回条数', () => {
    const entries = Array.from({ length: 50 }, (_, i) => entry(i, 3, `内容 ${i}`));
    expect(recallMemories(entries, '内容', 10)).toHaveLength(10);
  });

  it('中文关键词应能被正确匹配', () => {
    const e = entry(1, 3, '用户安装了微信开发者工具');
    expect(scoreMemory(e, '微信', now)).toBeGreaterThan(0.2);
  });
});

describe('路径穿越防护', () => {
  it('isInside 应正确判断包含关系', () => {
    expect(isInside('/a/b', '/a/b/c')).toBe(true);
    expect(isInside('/a/b', '/a/b')).toBe(true);
    expect(isInside('/a/b', '/a/c')).toBe(false);
    expect(isInside('/a/b', '/a/bc')).toBe(false); // 前缀相同但不是子目录
    expect(isInside('/a/b', '/a/b/../c')).toBe(false);
  });
});

describe('运行记录', () => {
  function makeRun(botId: string, costCny: number, startedAt = new Date().toISOString()): RunRecord {
    return {
      id: `run_${Math.random().toString(16).slice(2, 10)}`,
      botId,
      trigger: 'manual',
      startedAt,
      endedAt: startedAt,
      dryRun: true,
      status: 'success',
      steps: [],
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheHitTokens: 0,
        cacheMissTokens: 100,
        reasoningTokens: 0,
        costCny,
      },
    };
  }

  it('保存后应能按 Bot 列出', async () => {
    const bot = await service.create({ name: 'T', role: 'r' });
    const run = makeRun(bot.id, 0.01);
    await service.saveRun(run);

    const runs = await service.listRuns(bot.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe(run.id);
  });

  it('今日花费应只统计今天的运行', async () => {
    const bot = await service.create({ name: 'T', role: 'r' });

    await service.saveRun(makeRun(bot.id, 0.5)); // 今天
    await service.saveRun(
      makeRun(bot.id, 100, '2020-01-01T00:00:00.000Z'), // 很久以前
    );

    const today = await service.spentToday(bot.id);
    expect(today).toBeCloseTo(0.5, 6);
  });

  it('runCount 应统计全部运行', async () => {
    const bot = await service.create({ name: 'T', role: 'r' });
    await service.saveRun(makeRun(bot.id, 0.1));
    await service.saveRun(makeRun(bot.id, 0.1));
    expect(await service.runCount(bot.id)).toBe(2);
  });
});

describe('预算守卫', () => {
  it('未超预算时通过', async () => {
    const bot = await service.create({
      name: 'T',
      role: 'r',
      budget: { dailyCny: 10, monthlyCny: 100 },
    });
    await expect(service.checkBudget(bot.id, 1)).resolves.toBeUndefined();
  });

  it('超日预算应抛出 BUDGET_EXCEEDED', async () => {
    const bot = await service.create({
      name: 'T',
      role: 'r',
      budget: { dailyCny: 1, monthlyCny: 100 },
    });

    await service.saveRun({
      id: 'run_x',
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
        costCny: 0.9,
      },
    });

    await expect(service.checkBudget(bot.id, 0.5)).rejects.toThrow(
      /今日预算已用/,
    );
  });

  it('超月预算应抛出 BUDGET_EXCEEDED', async () => {
    const bot = await service.create({
      name: 'T',
      role: 'r',
      budget: { dailyCny: 1000, monthlyCny: 1 },
    });

    await service.saveRun({
      id: 'run_y',
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
        costCny: 0.9,
      },
    });

    await expect(service.checkBudget(bot.id, 0.5)).rejects.toThrow(
      /本月预算已用/,
    );
  });
});

describe('删除', () => {
  it('删除后应查不到', async () => {
    const bot = await service.create({ name: 'T', role: 'r' });
    await service.remove(bot.id);
    await expect(service.get(bot.id)).rejects.toThrow(/找不到 Bot/);
    expect(fs.existsSync(service.botDir(bot.id))).toBe(false);
  });
});

// ============================================================
// bot_adopt（对话介入落地）
// ============================================================

describe('bot_adopt 复合接手', () => {
  it('一次完成：建 Bot + 带节奏的目标 + 立即演习', async () => {
    const { registerAdoptTool } = await import('../../src/tools/adopt.js');
    const { RoutineRunner } = await import('../../src/routine/runner.js');

    const registered: any[] = [];
    const dryRuns: string[] = [];
    const runner = new RoutineRunner({
      service,
      llm: async () => ({ text: '演习输出', usage: { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0, reasoningTokens: 0, costCny: 0, costKind: 'free' as const } }),
      tools: { has: () => true, call: async () => ({}) },
      newId: (p) => `${p}_a`,
      nowIso: () => new Date().toISOString(),
    });
    // 包一层 runner：记录演习任务走的是 dry-run
    const spyRunner = {
      runTask: async (botId: string, task: string, flags: any) => {
        dryRuns.push(`${flags.dryRun}:${task.slice(0, 8)}`);
        return runner.runTask(botId, task, flags);
      },
    } as any;

    registerAdoptTool(
      { tools: { register: (t: any) => registered.push(t) } } as any,
      { service, runner: spyRunner, newId: (p: string) => `${p}_g`, nowIso: () => new Date().toISOString() },
    );

    expect(registered).toHaveLength(1);
    expect(registered[0].name).toBe('bot_adopt');

    const out = await registered[0].execute({
      name: '服务监测员',
      role: '每 4 小时检查服务状态并汇报',
      goal: '每过4小时报告一次 example.com 的运行状态',
    });

    // Bot 已建、目标已带节奏
    const bots = await service.list();
    expect(bots).toHaveLength(1);
    const goal = await service.getGoal(bots[0].id);
    expect(goal?.cadence).toBe('0 */4 * * *');
    expect(goal?.type).toBe('standing'); // 识别出节奏 → 常驻守护
    // 立即演习了一次，且是 dry-run
    expect(dryRuns).toEqual(['true:每过4小时报告一']); // slice(0,8)
    // 输出如实汇报节奏与预算
    expect(out).toContain('已接手');
    expect(out).toContain('0 */4 * * *');
  });

  it('宿主零工具时大声警告（真机教训：空转 Bot）', async () => {
    const { registerAdoptTool } = await import('../../src/tools/adopt.js');
    const registered: any[] = [];
    const runner = { runTask: async () => ({ status: 'success', steps: [], usage: {} }) } as any;
    registerAdoptTool(
      { tools: { register: (t: any) => registered.push(t) } } as any,
      {
        service, runner,
        newId: (p: string) => `${p}_g`,
        nowIso: () => new Date().toISOString(),
        hostToolCount: () => 0,
      },
    );
    const out = await registered[0].execute({
      name: '监测员', role: '盯服务', goal: '每过4小时报告一次状态',
    });
    expect(out).toContain('没有暴露任何可调用的工具');
    expect(out).toContain('读不到真实数据');
  });

  it('识别不出节奏时大声说出来，不假装会自动跑', async () => {
    const { registerAdoptTool } = await import('../../src/tools/adopt.js');
    const registered: any[] = [];
    const runner = { runTask: async () => ({ status: 'success', steps: [], usage: {} }) } as any;
    registerAdoptTool(
      { tools: { register: (t: any) => registered.push(t) } } as any,
      { service, runner, newId: (p: string) => `${p}_g`, nowIso: () => new Date().toISOString() },
    );
    const out = await registered[0].execute({
      name: '整理员',
      role: '整理下载文件夹',
      goal: '整理一次下载文件夹',
    });
    expect(out).toContain('不会自己跑');
    const bots = await service.list();
    const goal = await service.getGoal(bots[0].id);
    expect(goal?.cadence).toBeUndefined();
    expect(goal?.type).toBe('one-shot');
  });
});

