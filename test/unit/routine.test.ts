/**
 * Routine 引擎测试
 *
 * 重点验证：
 *   1. schema 校验
 *   2. {{}} 插值
 *   3. 断言求值
 *   4. ⭐ dry-run 拦截（核心差异化）
 *   5. 执行流程与错误处理
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { BotService } from '../../src/service.js';
import { DEFAULT_CONFIG } from '../../src/index.js';
import {
  validateRoutine,
  interpolate,
  evalAssert,
  type Routine,
} from '../../src/routine/schema.js';
import { RoutineRunner, buildSystemPrompt } from '../../src/routine/runner.js';
import { computeCostCny, isPeakHour } from '../../src/llm/bridge.js';
import { parseYaml, stringifyYaml } from '../../src/tools/yaml.js';
import type { RunUsage } from '../../src/types.js';

let tmpRoot: string;
let service: BotService;
let botId: string;

const zeroUsage = (): RunUsage => ({
  inputTokens: 100,
  outputTokens: 50,
  cacheHitTokens: 60,
  cacheMissTokens: 40,
  reasoningTokens: 10,
  costCny: 0.001,
});

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-bot-routine-'));
  service = new BotService({}, { ...DEFAULT_CONFIG, homeDir: tmpRoot });
  const bot = await service.create({ name: '测试机', role: '跑流程' });
  botId = bot.id;
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

// ============================================================
// schema
// ============================================================

describe('Routine schema 校验', () => {
  const base = {
    apiVersion: 'dsh-bot/v1',
    kind: 'Routine',
    metadata: { id: 'daily', name: '每日检查' },
    spec: {
      steps: [{ id: 's1', type: 'tool', tool: 'read', args: { path: '/x' } }],
    },
  };

  it('合法 Routine 应通过并补齐默认值', () => {
    const r = validateRoutine(base);
    expect(r.metadata.version).toBe(1);
    expect(r.spec.triggers).toEqual([{ type: 'manual' }]);
    expect(r.spec.params).toEqual({});
  });

  it('apiVersion 错误应拒绝', () => {
    expect(() => validateRoutine({ ...base, apiVersion: 'v2' })).toThrow(/apiVersion/);
  });

  it('kind 错误应拒绝', () => {
    expect(() => validateRoutine({ ...base, kind: 'Other' })).toThrow(/kind/);
  });

  it('metadata.id 必须是小写字母数字连字符', () => {
    expect(() =>
      validateRoutine({ ...base, metadata: { id: 'Daily_Check', name: 'x' } }),
    ).toThrow(/metadata\.id/);
  });

  it('steps 为空应拒绝', () => {
    expect(() =>
      validateRoutine({ ...base, spec: { steps: [] } }),
    ).toThrow(/至少需要 1 步/);
  });

  it('步骤 id 重复应拒绝', () => {
    expect(() =>
      validateRoutine({
        ...base,
        spec: {
          steps: [
            { id: 'a', type: 'tool', tool: 'read' },
            { id: 'a', type: 'tool', tool: 'read' },
          ],
        },
      }),
    ).toThrow(/id 重复/);
  });

  it('未知步骤类型应拒绝', () => {
    expect(() =>
      validateRoutine({
        ...base,
        spec: { steps: [{ id: 'a', type: 'unknown' }] },
      }),
    ).toThrow(/type 必须是/);
  });

  it('cron 表达式必须是 5 段', () => {
    expect(() =>
      validateRoutine({
        ...base,
        spec: { ...base.spec, triggers: [{ type: 'cron', expression: '* * *' }] },
      }),
    ).toThrow(/cron/);

    const ok = validateRoutine({
      ...base,
      spec: { ...base.spec, triggers: [{ type: 'cron', expression: '0 9 * * 1-5' }] },
    });
    expect(ok.spec.triggers[0]).toMatchObject({
      type: 'cron',
      timezone: 'Asia/Shanghai',
    });
  });

  it('llm 步骤 prompt 不能为空', () => {
    expect(() =>
      validateRoutine({
        ...base,
        spec: { steps: [{ id: 'a', type: 'llm', prompt: '' }] },
      }),
    ).toThrow(/prompt/);
  });
});

// ============================================================
// 插值
// ============================================================

describe('{{}} 插值', () => {
  const vars = {
    param: { repo: 'myproject', count: 3 },
    steps: { s1: { result: { stdout: 'hello' }, output: 'world' } },
    env: { HOME: '/home/me' },
  };

  it('应解析 param', () => {
    expect(interpolate('cd {{.param.repo}}', vars)).toBe('cd myproject');
  });

  it('应解析嵌套的 steps', () => {
    expect(interpolate('{{.steps.s1.result.stdout}}', vars)).toBe('hello');
  });

  it('应解析 env', () => {
    expect(interpolate('{{.env.HOME}}', vars)).toBe('/home/me');
  });

  it('整串占位符应保留原始类型', () => {
    expect(interpolate('{{.param.count}}', vars)).toBe(3);
    expect(interpolate('{{.steps.s1.result}}', vars)).toEqual({ stdout: 'hello' });
  });

  it('缺失的路径应渲染为空串', () => {
    expect(interpolate('x{{.param.nope}}y', vars)).toBe('xy');
  });

  it('应递归处理对象与数组', () => {
    const tpl = { a: '{{.param.repo}}', b: ['{{.param.count}}'] };
    expect(interpolate(tpl, vars)).toEqual({ a: 'myproject', b: [3] });
  });

  it('单花括号不应被处理', () => {
    expect(interpolate('{not a var}', vars)).toBe('{not a var}');
  });
});

// ============================================================
// 断言
// ============================================================

describe('断言求值', () => {
  it('应支持 === 比较', () => {
    expect(evalAssert('result.exitCode === 0', { result: { exitCode: 0 } })).toBe(true);
    expect(evalAssert('result.exitCode === 0', { result: { exitCode: 1 } })).toBe(false);
  });

  it('应支持 !== 比较', () => {
    expect(evalAssert('result.status !== "failed"', { result: { status: 'ok' } })).toBe(true);
  });

  it('应支持数值比较', () => {
    expect(evalAssert('result.count > 5', { result: { count: 10 } })).toBe(true);
    expect(evalAssert('result.count < 5', { result: { count: 10 } })).toBe(false);
  });

  it('应支持真值判断', () => {
    expect(evalAssert('result.ok', { result: { ok: true } })).toBe(true);
    expect(evalAssert('result.ok', { result: { ok: false } })).toBe(false);
  });

  it('应支持否定', () => {
    expect(evalAssert('!result.error', { result: { error: undefined } })).toBe(true);
  });

  it('数组非空应视为真', () => {
    expect(evalAssert('result.items', { result: { items: [1] } })).toBe(true);
    expect(evalAssert('result.items', { result: { items: [] } })).toBe(false);
  });
});

// ============================================================
// ⭐ dry-run 拦截（核心差异化）
// ============================================================

describe('dry-run 拦截', () => {
  function makeRunner(overrides: {
    tools?: { has: (n: string) => boolean; call: (n: string, a: unknown) => Promise<unknown> };
    llm?: (i: any) => Promise<any>;
  } = {}) {
    let toolCallCount = 0;
    return {
      runner: new RoutineRunner({
        service,
        llm:
          overrides.llm ??
          (async () => ({ text: 'LLM 输出', usage: zeroUsage() })),
        tools:
          overrides.tools ??
          {
            has: () => true,
            call: async () => {
              toolCallCount++;
              return { ok: true };
            },
          },
        newId: (p) => `${p}_test`,
        nowIso: () => new Date().toISOString(),
      }),
      getToolCalls: () => toolCallCount,
    };
  }

  const routineWithExternal: Routine = {
    apiVersion: 'dsh-bot/v1',
    kind: 'Routine',
    metadata: { id: 'r1', name: 'R', version: 1 },
    spec: {
      triggers: [{ type: 'manual' }],
      params: {},
      steps: [
        {
          id: 'webhook',
          type: 'tool',
          tool: 'webhook_post',
          args: { url: 'https://example.com/hook' },
        },
      ],
    },
  };

  it('外部副作用工具在 dry-run 下必须被拦截', async () => {
    const { runner, getToolCalls } = makeRunner();
    const rec = await runner.runRoutine(botId, routineWithExternal, {
      dryRun: true,
      trigger: 'manual',
    });

    expect(rec.steps[0].blocked).toBeDefined();
    expect(rec.steps[0].blocked!.reason).toContain('dry-run');
    expect(rec.steps[0].blocked!.reason).toContain('webhook_post');
    expect(getToolCalls()).toBe(0); // ⭐ 工具绝不能被调用
    expect(rec.status).toBe('partial');
  });

  it('非 dry-run 时应真正调用工具', async () => {
    const { runner, getToolCalls } = makeRunner();
    const rec = await runner.runRoutine(botId, routineWithExternal, {
      dryRun: false,
      trigger: 'manual',
    });

    expect(rec.steps[0].blocked).toBeUndefined();
    expect(getToolCalls()).toBe(1);
    expect(rec.status).toBe('success');
  });

  it('只读工具在 dry-run 下应放行', async () => {
    const { runner, getToolCalls } = makeRunner();
    const routine: Routine = {
      ...routineWithExternal,
      spec: {
        ...routineWithExternal.spec,
        steps: [{ id: 'r', type: 'tool', tool: 'read', args: { path: '/x' } }],
      },
    };
    const rec = await runner.runRoutine(botId, routine, {
      dryRun: true,
      trigger: 'manual',
    });

    expect(rec.steps[0].blocked).toBeUndefined();
    expect(getToolCalls()).toBe(1); // 只读放行
    expect(rec.status).toBe('success');
  });

  it('本地写工具在 dry-run 下应被拦截', async () => {
    const { runner, getToolCalls } = makeRunner();
    const routine: Routine = {
      ...routineWithExternal,
      spec: {
        ...routineWithExternal.spec,
        steps: [{ id: 'w', type: 'tool', tool: 'write', args: { path: '/x', content: 'a' } }],
      },
    };
    const rec = await runner.runRoutine(botId, routine, {
      dryRun: true,
      trigger: 'manual',
    });

    expect(rec.steps[0].blocked).toBeDefined();
    expect(getToolCalls()).toBe(0);
  });

  it('script 步骤在 dry-run 下应被拦截', async () => {
    const { runner } = makeRunner();
    const routine: Routine = {
      ...routineWithExternal,
      spec: {
        ...routineWithExternal.spec,
        steps: [{ id: 'sc', type: 'script', code: 'return 1' }],
      },
    };
    const rec = await runner.runRoutine(botId, routine, {
      dryRun: true,
      trigger: 'manual',
    });
    expect(rec.steps[0].blocked).toBeDefined();
  });
});

// ============================================================
// 执行
// ============================================================

describe('Routine 执行', () => {
  function runner(opts: { llm?: (i: any) => Promise<any>; tools?: any } = {}) {
    return new RoutineRunner({
      service,
      llm: opts.llm ?? (async () => ({ text: 'ok', usage: zeroUsage() })),
      tools: opts.tools ?? { has: () => true, call: async () => ({ ok: true }) },
      newId: (p) => `${p}_x`,
      nowIso: () => new Date().toISOString(),
    });
  }

  it('多步应顺序执行并累积 usage', async () => {
    const r = runner();
    const routine: Routine = {
      apiVersion: 'dsh-bot/v1',
      kind: 'Routine',
      metadata: { id: 'multi', name: '多步', version: 1 },
      spec: {
        triggers: [{ type: 'manual' }],
        params: {},
        steps: [
          { id: 'a', type: 'tool', tool: 'read', args: {} },
          { id: 'b', type: 'llm', prompt: '总结一下' },
          { id: 'c', type: 'llm', prompt: '再总结' },
        ],
      },
    };

    const rec = await r.runRoutine(botId, routine, {
      dryRun: false,
      trigger: 'manual',
    });

    expect(rec.steps).toHaveLength(3);
    expect(rec.status).toBe('success');
    // 两次 llm 调用各 0.001
    expect(rec.usage.costCny).toBeCloseTo(0.002, 9);
    expect(rec.usage.inputTokens).toBe(200);
  });

  it('llm 输出应能传给后续步骤', async () => {
    let captured = '';
    const r = runner({
      llm: async (i: any) => {
        if (i.prompt.includes('第一')) return { text: '上一步的结果', usage: zeroUsage() };
        captured = i.prompt;
        return { text: 'done', usage: zeroUsage() };
      },
    });

    const routine: Routine = {
      apiVersion: 'dsh-bot/v1',
      kind: 'Routine',
      metadata: { id: 'chain', name: '链式', version: 1 },
      spec: {
        triggers: [{ type: 'manual' }],
        params: {},
        steps: [
          { id: 'first', type: 'llm', prompt: '第一' },
          { id: 'second', type: 'llm', prompt: '基于 {{.steps.first.output}} 继续' },
        ],
      },
    };

    await r.runRoutine(botId, routine, { dryRun: false, trigger: 'manual' });
    expect(captured).toContain('上一步的结果');
  });

  it('断言失败应中断执行', async () => {
    const r = runner({
      tools: { has: () => true, call: async () => ({ exitCode: 1 }) },
    });
    const routine: Routine = {
      apiVersion: 'dsh-bot/v1',
      kind: 'Routine',
      metadata: { id: 'assert', name: '断言', version: 1 },
      spec: {
        triggers: [{ type: 'manual' }],
        params: {},
        steps: [
          {
            id: 'check',
            type: 'tool',
            tool: 'bash',
            args: {},
            assert: [{ expr: 'result.exitCode === 0', message: '命令必须成功' }],
          },
          { id: 'after', type: 'llm', prompt: '不应执行' },
        ],
      },
    };

    const rec = await r.runRoutine(botId, routine, {
      dryRun: false,
      trigger: 'manual',
    });

    expect(rec.status).toBe('failed');
    expect(rec.error?.code).toBe('ASSERT_FAILED');
    expect(rec.steps).toHaveLength(1); // 第二步未执行
  });

  it('optional 步骤失败不应中断', async () => {
    let callCount = 0;
    const r = runner({
      tools: {
        has: () => true,
        call: async () => {
          callCount++;
          throw new Error('故意失败');
        },
      },
    });

    const routine: Routine = {
      apiVersion: 'dsh-bot/v1',
      kind: 'Routine',
      metadata: { id: 'opt', name: '可选', version: 1 },
      spec: {
        triggers: [{ type: 'manual' }],
        params: {},
        steps: [
          { id: 'may-fail', type: 'tool', tool: 'read', args: {}, optional: true },
          { id: 'must-run', type: 'llm', prompt: '继续' },
        ],
      },
    };

    const rec = await r.runRoutine(botId, routine, {
      dryRun: false,
      trigger: 'manual',
    });

    expect(rec.steps).toHaveLength(2);
    expect(rec.steps[1].error).toBeUndefined();
    expect(rec.status).toBe('success');
  });

  it('工具不存在应报错', async () => {
    const r = runner({ tools: { has: () => false, call: async () => ({}) } });
    const routine: Routine = {
      apiVersion: 'dsh-bot/v1',
      kind: 'Routine',
      metadata: { id: 'missing', name: '缺工具', version: 1 },
      spec: {
        triggers: [{ type: 'manual' }],
        params: {},
        steps: [{ id: 'x', type: 'tool', tool: 'nonexistent' }],
      },
    };
    const rec = await r.runRoutine(botId, routine, {
      dryRun: false,
      trigger: 'manual',
    });
    expect(rec.status).toBe('failed');
    expect(rec.error?.message).toContain('工具不存在');
  });

  it('运行记录应落盘', async () => {
    const r = runner();
    const routine: Routine = {
      apiVersion: 'dsh-bot/v1',
      kind: 'Routine',
      metadata: { id: 'persist', name: '落盘', version: 1 },
      spec: {
        triggers: [{ type: 'manual' }],
        params: {},
        steps: [{ id: 'a', type: 'llm', prompt: 'hi' }],
      },
    };
    const rec = await r.runRoutine(botId, routine, {
      dryRun: false,
      trigger: 'manual',
    });

    const saved = await service.listRuns(botId);
    expect(saved.some((x) => x.id === rec.id)).toBe(true);
  });
});

// ============================================================
// 自由任务
// ============================================================

describe('runTask', () => {
  it('应调用 LLM 并记录', async () => {
    const r = new RoutineRunner({
      service,
      llm: async () => ({ text: '任务完成', usage: zeroUsage() }),
      tools: { has: () => true, call: async () => ({}) },
      newId: (p) => `${p}_task`,
      nowIso: () => new Date().toISOString(),
    });

    const rec = await r.runTask(botId, '帮我检查一下代码', {
      dryRun: true,
      trigger: 'manual',
    });

    expect(rec.status).toBe('success');
    expect(rec.steps[0].result).toEqual({ output: '任务完成' });
  });

  it('LLM 失败应记录错误', async () => {
    const r = new RoutineRunner({
      service,
      llm: async () => {
        throw new Error('模型挂了');
      },
      tools: { has: () => true, call: async () => ({}) },
      newId: (p) => `${p}_err`,
      nowIso: () => new Date().toISOString(),
    });

    const rec = await r.runTask(botId, 'x', { dryRun: true, trigger: 'manual' });
    expect(rec.status).toBe('failed');
    expect(rec.error?.message).toContain('模型挂了');
  });
});

// ============================================================
// 系统提示（缓存前缀稳定性）
// ============================================================

describe('系统提示稳定性（KV Cache 前缀）', () => {
  const bot = { name: '日报助手', role: '每天汇总提交' };

  it('相同身份应生成完全一致的前缀', () => {
    const p1 = buildSystemPrompt(bot);
    const p2 = buildSystemPrompt(bot);
    expect(p1).toBe(p2);
  });

  it('提示中不应包含时间戳等动态内容', () => {
    const p = buildSystemPrompt(bot);
    // 若有年份/ISO 时间，会破坏缓存前缀
    expect(p).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('systemPromptExtra 应被包含', () => {
    const p = buildSystemPrompt({ ...bot, systemPromptExtra: '输出用 Markdown' });
    expect(p).toContain('输出用 Markdown');
  });
});

// ============================================================
// 成本与峰谷
// ============================================================

describe('成本计算', () => {
  const usage = { cacheHitTokens: 1_000_000, cacheMissTokens: 1_000_000, outputTokens: 1_000_000 };

  it('flash 空闲时段应正确计价', () => {
    // 2026-10-19 是周一；UTC 20:00 = 北京 04:00（空闲）
    const idle = new Date('2026-10-19T20:00:00Z');
    const cost = computeCostCny('deepseek-flash', usage, idle);
    // 0.02 + 1.0 + 4.0 = 5.02
    expect(cost).toBeCloseTo(5.02, 6);
  });

  it('flash 高峰时段应翻倍', () => {
    // 北京 10:00 = UTC 02:00
    const peak = new Date('2026-10-19T02:00:00Z');
    const cost = computeCostCny('deepseek-flash', usage, peak);
    // 0.04 + 2.0 + 8.0 = 10.04
    expect(cost).toBeCloseTo(10.04, 6);
  });

  it('isPeakHour 应识别工作日高峰', () => {
    expect(isPeakHour(new Date('2026-10-19T02:00:00Z'))).toBe(true);  // 周一 10:00 北京
    expect(isPeakHour(new Date('2026-10-19T04:00:00Z'))).toBe(false); // 周一 12:00 北京（午休边界）
    expect(isPeakHour(new Date('2026-10-19T20:00:00Z'))).toBe(false); // 周二 04:00 北京
  });

  it('周末不应算高峰', () => {
    // 2026-10-24 是周六
    expect(isPeakHour(new Date('2026-10-24T02:00:00Z'))).toBe(false);
  });
});

// ============================================================
// Routine 持久化
// ============================================================

describe('Routine 存储', () => {
  const routine: Routine = {
    apiVersion: 'dsh-bot/v1',
    kind: 'Routine',
    metadata: { id: 'saved', name: '已保存', version: 2 },
    spec: {
      triggers: [{ type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' }],
      params: { repo: 'x' },
      steps: [{ id: 'a', type: 'llm', prompt: 'hi' }],
    },
  };

  it('保存后应能读回且内容一致', async () => {
    await service.saveRoutine(botId, routine);
    const got = await service.getRoutine(botId, 'saved');
    expect(got.metadata.id).toBe('saved');
    expect(got.metadata.version).toBe(2);
    expect(got.spec.steps).toHaveLength(1);
    expect(got.spec.triggers[0]).toMatchObject({ type: 'cron', expression: '0 9 * * *' });
  });

  it('listRoutines 应返回摘要', async () => {
    await service.saveRoutine(botId, routine);
    const metas = await service.listRoutines(botId);
    expect(metas).toHaveLength(1);
    expect(metas[0].stepCount).toBe(1);
  });

  it('读不存在的流程应报 ROUTINE_NOT_FOUND', async () => {
    await expect(service.getRoutine(botId, 'nope')).rejects.toThrow(/找不到流程/);
  });

  it('删除后应查不到', async () => {
    await service.saveRoutine(botId, routine);
    await service.removeRoutine(botId, 'saved');
    await expect(service.getRoutine(botId, 'saved')).rejects.toThrow(/找不到流程/);
  });
});

// ============================================================
// YAML 往返
// ============================================================

describe('YAML 解析与序列化', () => {
  it('应解析嵌套对象与数组', () => {
    const yaml = `
apiVersion: dsh-bot/v1
kind: Routine
metadata:
  id: test
  name: 测试
spec:
  steps:
    - id: a
      type: llm
      prompt: hi
    - id: b
      type: tool
      tool: read
`;
    const v: any = parseYaml(yaml);
    expect(v.apiVersion).toBe('dsh-bot/v1');
    expect(v.metadata.id).toBe('test');
    expect(v.spec.steps).toHaveLength(2);
    expect(v.spec.steps[0].prompt).toBe('hi');
    expect(v.spec.steps[1].tool).toBe('read');
  });

  it('应解析块标量', () => {
    const yaml = `
prompt: |
  第一行
  第二行
`;
    const v: any = parseYaml(yaml);
    expect(v.prompt).toContain('第一行');
    expect(v.prompt).toContain('第二行');
  });

  it('应解析布尔与数字', () => {
    const v: any = parseYaml(`
enabled: true
count: 42
ratio: 0.5
empty: null
`);
    expect(v.enabled).toBe(true);
    expect(v.count).toBe(42);
    expect(v.ratio).toBe(0.5);
    expect(v.empty).toBeNull();
  });

  it('引号内的值应保留', () => {
    const v: any = parseYaml(`
a: "hello: world"
b: 'single'
`);
    expect(v.a).toBe('hello: world');
    expect(v.b).toBe('single');
  });

  it('往返应保持结构', () => {
    const obj = {
      apiVersion: 'dsh-bot/v1',
      metadata: { id: 'x', name: '名称' },
      spec: { steps: [{ id: 'a', type: 'tool', tool: 'read' }] },
    };
    const yaml = stringifyYaml(obj);
    const back = parseYaml(yaml);
    expect(back).toMatchObject(obj);
  });
});

// ============================================================
// 预算熔断收口（P0-2 回归）
//
// 修复前：checkBudget 只在两个工具入口调用，调度器路径和面板
// HTTP /run 直接调 runner——可以无限花钱；且检查只在运行前，
// 运行中失控照样花完。
// 修复后：runner 是唯一预算门，开始校验存量、每步增量熔断。
// ============================================================

describe('预算熔断收口', () => {
  function costlyRunner(costCny: number) {
    return new RoutineRunner({
      service,
      llm: async () => ({
        text: 'LLM 输出',
        usage: { ...zeroUsage(), costCny, costKind: 'exact' as const },
      }),
      tools: { has: () => true, call: async () => ({ ok: true }) },
      newId: (p) => `${p}_test`,
      nowIso: () => new Date().toISOString(),
    });
  }

  async function setup3StepRoutine() {
    const routine = validateRoutine({
      apiVersion: 'dsh-bot/v1',
      kind: 'Routine',
      metadata: { id: 'costly', name: '花钱流程', version: 1 },
      spec: {
        triggers: [],
        params: {},
        steps: [
          { id: 's1', type: 'llm', prompt: 'a' },
          { id: 's2', type: 'llm', prompt: 'b' },
          { id: 's3', type: 'llm', prompt: 'c' },
        ],
      },
    });
    return service.getRoutine == null ? routine : (await service.saveRoutine(botId, routine), routine);
  }

  it('直接调 runner（调度器/面板路径）：运行中越线立即熔断，余下步骤不执行', async () => {
    // 预算 0.015；每步 0.01 → 第二步后累计 0.02 越线
    const tight = await service.create({
      name: '紧预算',
      role: 'r',
      budget: { dailyCny: 0.015, monthlyCny: 100 },
    });
    const routine = await setup3StepRoutine();
    const runner = costlyRunner(0.01);

    const record = await runner.runRoutine(tight.id, routine, { dryRun: true, trigger: 'schedule' });

    expect(record.status).toBe('budget_exceeded');
    expect(record.steps).toHaveLength(2); // 第三步没有跑
    expect(record.error?.code).toBe('BUDGET_EXCEEDED');
  });

  it('存量越线：第二次运行开始即拒绝，一个步骤都不跑', async () => {
    const tight = await service.create({
      name: '紧预算2',
      role: 'r',
      budget: { dailyCny: 0.015, monthlyCny: 100 },
    });
    const routine = await setup3StepRoutine();
    const runner = costlyRunner(0.01);

    await runner.runRoutine(tight.id, routine, { dryRun: true, trigger: 'schedule' });
    const second = await runner.runRoutine(tight.id, routine, { dryRun: true, trigger: 'schedule' });

    expect(second.status).toBe('budget_exceeded');
    expect(second.steps).toHaveLength(0);
  });

  it('runTask（面板执行/目标节奏触发）同样过预算门', async () => {
    const tight = await service.create({
      name: '紧预算3',
      role: 'r',
      budget: { dailyCny: 0.005, monthlyCny: 100 },
    });
    const runner = costlyRunner(0.01);

    const first = await runner.runTask(tight.id, '干活', { dryRun: true, trigger: 'manual' });
    expect(first.status).toBe('budget_exceeded'); // 单次调用 0.01 > 0.005，事后如实标记
    expect(first.error?.code).toBe('BUDGET_EXCEEDED');

    const second = await runner.runTask(tight.id, '再干活', { dryRun: true, trigger: 'goal' });
    expect(second.status).toBe('budget_exceeded'); // 存量越线，开始即拒绝
    expect(second.steps).toHaveLength(0);
  });
});

// ============================================================
// per-bot 运行互斥（P1-3 回归）
//
// 修复前：调度器 tick 与面板「执行」可并发触发同一 Bot——
// 并发快照捕获对方写了一半的状态、并发写 workspace。
// ============================================================

describe('per-bot 运行互斥', () => {
  it('同一 Bot 并发运行应拒绝第二个（RUN_IN_PROGRESS）', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const runner = new RoutineRunner({
      service,
      llm: async () => {
        await gate; // 挂住第一次运行，制造并发窗口
        return { text: 'ok', usage: zeroUsage() };
      },
      tools: { has: () => true, call: async () => ({}) },
      newId: (p) => `${p}_x`,
      nowIso: () => new Date().toISOString(),
    });

    const first = runner.runTask(botId, '第一次', { dryRun: true, trigger: 'manual' });
    // 给第一个运行一点时间真正进入 llm 调用
    await new Promise((r) => setTimeout(r, 20));

    await expect(
      runner.runTask(botId, '第二次', { dryRun: true, trigger: 'manual' }),
    ).rejects.toMatchObject({ code: 'RUN_IN_PROGRESS' });

    release();
    const rec = await first;
    expect(rec.status).toBe('success');
  });

  it('运行结束后锁释放，可以再次运行；不同 Bot 互不影响', async () => {
    const runner = new RoutineRunner({
      service,
      llm: async () => ({ text: 'ok', usage: zeroUsage() }),
      tools: { has: () => true, call: async () => ({}) },
      newId: (p) => `${p}_x`,
      nowIso: () => new Date().toISOString(),
    });
    const other = await service.create({ name: '另一个', role: 'r' });

    await runner.runTask(botId, '第一次', { dryRun: true, trigger: 'manual' });
    // 锁已释放，同 Bot 再次运行 OK
    const again = await runner.runTask(botId, '再次', { dryRun: true, trigger: 'manual' });
    expect(again.status).toBe('success');
    // 不同 Bot 不受影响
    const otherRec = await runner.runTask(other.id, '别人家', { dryRun: true, trigger: 'manual' });
    expect(otherRec.status).toBe('success');
  });
});

// ============================================================
// 工具循环（P0-3 回归）— Bot 第一次真正能「做」
//
// 修复前：runTask 是单次文本调用，无任何工具执行能力——
// 模型只能产出虚构的工作汇报，目标状态机建立在幻觉上。
// ============================================================

// ============================================================
// runTask 工具循环（文本协议）
//
// 真机教训（0.2.0）：原生 tools 选项被适配器静默丢弃，模型自述
// 「没有可用工具」，Bot 空 转。修复后：工具目录进系统提示，
// 模型用 ```tool 块发起调用——不赌适配器能力；原生 toolUses 仍兼容。
// ============================================================

const toolBlock = (name: string, args: unknown) =>
  '```tool\n' + JSON.stringify({ tool: name, args }) + '\n```';

describe('runTask 工具循环（文本协议）', () => {
  function agenticRunner(script: Array<() => any>, listShape?: 'objects' | 'strings') {
    let i = 0;
    const inputs: any[] = [];
    const toolCalls: Array<{ name: string; args: any }> = [];
    const baseList = [
      { name: 'web_fetch', description: '抓取网页' },
      { name: 'read', description: '读文件' },
      { name: 'write', description: '写文件' },
      { name: 'bash', description: '执行命令' },
      { name: 'send_email', description: '发邮件' },
    ];
    return {
      inputs,
      toolCalls,
      runner: new RoutineRunner({
        service,
        llm: async (input: any) => {
          inputs.push(input);
          const step = script[Math.min(i, script.length - 1)];
          i++;
          return step();
        },
        tools: {
          has: (n: string) => baseList.some((t) => t.name === n),
          call: async (n: string, a: any) => {
            toolCalls.push({ name: n, args: a });
            return { ok: true, tool: n, echoed: a };
          },
          list: () =>
            listShape === 'strings' ? baseList.map((t) => t.name) : baseList,
        },
        newId: (p) => `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        nowIso: () => new Date().toISOString(),
      }),
    };
  }

  const withUsage = (o: Partial<any>) => ({
    text: '', usage: zeroUsage(), ...o,
  });

  it('模型发 ```tool 块 → 真实分发 → 结果回喂 → 总结（调用块从输出剥除）', async () => {
    const h = agenticRunner([
      () => withUsage({ text: `我先查一下。\n${toolBlock('read', { path: 'a.txt' })}` }),
      () => withUsage({ text: 'a.txt 内容是 hello，任务完成。' }),
    ]);
    const rec = await h.runner.runTask(botId, '看看 a.txt', { dryRun: false, trigger: 'manual' });

    expect(rec.status).toBe('success');
    const toolSteps = rec.steps.filter((s) => s.kind === 'tool');
    expect(toolSteps).toHaveLength(1);
    expect(toolSteps[0].name).toBe('read');
    expect(toolSteps[0].result).toMatchObject({ ok: true, tool: 'read' });
    expect(h.toolCalls).toEqual([{ name: 'read', args: { path: 'a.txt' } }]);
    // 第二轮收到工具结果（文本协议回喂，合并为单条 user 消息）
    const fb = h.inputs[1].messages[h.inputs[1].messages.length - 1];
    expect(fb.role).toBe('user');
    expect(JSON.stringify(fb)).toContain('工具调用的执行结果');
    expect(JSON.stringify(fb)).toContain('[read]');
    // 最终输出：调用块被剥除，只留总结
    expect((rec.steps[0].result as any).output).toBe('a.txt 内容是 hello，任务完成。');
  });

  it('宿主工具清单是字符串数组也能用（真机形状归一化）', async () => {
    const h = agenticRunner(
      [
        () => withUsage({ text: toolBlock('web_fetch', { url: 'https://x' }) }),
        () => withUsage({ text: '抓到了，完成。' }),
      ],
      'strings',
    );
    const rec = await h.runner.runTask(botId, '抓网页', { dryRun: false, trigger: 'manual' });
    expect(rec.status).toBe('success');
    expect(h.toolCalls).toEqual([{ name: 'web_fetch', args: { url: 'https://x' } }]);
    // 系统提示里列出了工具名
    expect(h.inputs[0].system).toContain('web_fetch');
  });

  it('dry-run：写工具被拦截（不真实调用），[dry-run] 结果回喂', async () => {
    const h = agenticRunner([
      () => withUsage({ text: toolBlock('write', { path: 'x', content: 'y' }) }),
      () => withUsage({ text: '演习：write 会被拦截。' }),
    ]);
    const rec = await h.runner.runTask(botId, '写入 x', { dryRun: true, trigger: 'manual' });

    expect(rec.status).toBe('partial');
    expect(h.toolCalls).toHaveLength(0);
    const toolStep = rec.steps.find((s) => s.kind === 'tool')!;
    expect(toolStep.blocked?.reason).toContain('[dry-run]');
    expect(JSON.stringify(h.inputs[1].messages)).toContain('[dry-run]');
  });

  it('策略门：外部副作用默认拒绝；显式白名单后放行', async () => {
    const h = agenticRunner([
      () => withUsage({ text: toolBlock('send_email', { to: 'x' }) }),
      () => withUsage({ text: '未授权。' }),
    ]);
    await h.runner.runTask(botId, '发邮件', { dryRun: false, trigger: 'manual' });
    const toolStep = (await service.listRuns(botId, 1))[0].steps.find((s) => s.kind === 'tool')!;
    expect(toolStep.blocked?.reason).toContain('[policy]');

    await service.update(botId, {
      capabilities: { allowedTools: ['send_email'] } as any,
    });
    const h2 = agenticRunner([
      () => withUsage({ text: toolBlock('send_email', { to: 'x' }) }),
      () => withUsage({ text: '已发送。' }),
    ]);
    const rec2 = await h2.runner.runTask(botId, '发邮件', { dryRun: false, trigger: 'manual' });
    expect(h2.toolCalls).toHaveLength(1);
    expect(rec2.status).toBe('success');
  });

  it('策略门：bot 自管理工具运行中不可用（递归防护）', async () => {
    const h = agenticRunner([
      () => withUsage({ text: toolBlock('bot_create', { name: '克隆' }) }),
      () => withUsage({ text: '无法创建。' }),
    ]);
    await h.runner.runTask(botId, '再建一个', { dryRun: false, trigger: 'manual' });
    const toolStep = (await service.listRuns(botId, 1))[0].steps.find((s) => s.kind === 'tool')!;
    expect(toolStep.blocked?.reason).toContain('递归');
  });

  it('轮数耗尽：TOOL_LOOP_LIMIT；审计含全部轮次', async () => {
    const h = agenticRunner([
      () => withUsage({ text: toolBlock('read', {}) }),
    ]);
    const rec = await h.runner.runTask(botId, '一直读', { dryRun: true, trigger: 'manual' });

    expect(rec.status).toBe('failed');
    expect(rec.error?.code).toBe('TOOL_LOOP_LIMIT');
    expect(rec.steps.filter((s) => s.kind === 'tool')).toHaveLength(8); // 上限轮内执行，超限轮不再执行（省钱）
  });

  it('系统提示包含工具目录与协议标记；不再传原生 tools 选项', async () => {
    const h = agenticRunner([() => withUsage({ text: 'done' })]);
    await h.runner.runTask(botId, '干活', { dryRun: true, trigger: 'manual' });
    expect(h.inputs[0].system).toContain('# 可用工具');
    expect(h.inputs[0].system).toContain('```tool');
    expect(h.inputs[0].system).toContain('[dry-run]');
    expect(h.inputs[0].tools).toBeUndefined(); // 不赌适配器原生协议
    expect(h.inputs[0].messages).toBeUndefined(); // 首轮单提示
  });

  it('原生 toolUses（适配器真支持时）仍然兼容', async () => {
    const h = agenticRunner([
      () => withUsage({ toolUses: [{ id: 'tu1', name: 'read', input: { path: 'a' } }] }),
      () => withUsage({ text: '原生协议完成。' }),
    ]);
    const rec = await h.runner.runTask(botId, '读', { dryRun: false, trigger: 'manual' });
    expect(rec.status).toBe('success');
    expect(h.toolCalls).toEqual([{ name: 'read', args: { path: 'a' } }]);
    // 原生协议用 tool_result 块回喂
    const fb = JSON.stringify(h.inputs[1].messages);
    expect(fb).toContain('tool_result');
  });

  it('运行审计记录 toolSchemas 数量（真机诊断字段）', async () => {
    const h = agenticRunner([() => withUsage({ text: '纯文本任务' })]);
    await h.runner.runTask(botId, '分析', { dryRun: true, trigger: 'manual' });
    const args = (await service.listRuns(botId, 1))[0].steps[0].args as any;
    expect(args.toolSchemas).toBeGreaterThan(0);
    expect(args.toolRounds).toBe(0);
  });
});
