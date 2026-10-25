/**
 * routine_draft 测试
 *
 * 用假模型，验证：
 *   1. 能从 JSON 生成合法 Routine
 *   2. 能剥离 markdown 代码块
 *   3. 畸形输出被拒绝且不崩溃
 *   4. 副作用步骤会被标注
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { BotService } from '../../src/service.js';
import { DEFAULT_CONFIG } from '../../src/index.js';
import { validateRoutine } from '../../src/routine/schema.js';
import { parseYaml } from '../../src/tools/yaml.js';

let tmpRoot: string;
let service: BotService;
let botId: string;

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-bot-draft-'));
  service = new BotService({}, { ...DEFAULT_CONFIG, homeDir: tmpRoot });
  const bot = await service.create({ name: '草稿机', role: '生成流程' });
  botId = bot.id;
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

/** 构造一个假的 ctx.tools，用于触发 registerDraftTool */
function makeCtx() {
  const tools: any[] = [];
  return {
    tools: {
      register: (t: any) => tools.push(t),
      schemas: () => ['bash', 'read', 'write', 'web_fetch', 'webhook_post'],
    },
    getRegistered: () => tools,
  };
}

const VALID_ROUTINE_JSON = {
  apiVersion: 'dsh-bot/v1',
  kind: 'Routine',
  metadata: {
    id: 'check-todos',
    name: '每日 TODO 检查',
    description: '每天检查仓库里的 TODO',
    version: 1,
  },
  spec: {
    triggers: [{ type: 'cron', expression: '0 9 * * 1-5', timezone: 'Asia/Shanghai' }],
    params: { repoPath: 'D:/work/project' },
    steps: [
      {
        id: 'grep-todos',
        type: 'tool',
        tool: 'bash',
        args: { command: 'grep -r TODO {{.param.repoPath}}' },
      },
      {
        id: 'summarize',
        type: 'llm',
        prompt: '统计以下 TODO：{{.steps.grep-todos.result}}',
      },
    ],
  },
};

describe('routine_draft', () => {
  it('应从 JSON 生成合法 Routine 草稿', async () => {
    const { registerDraftTool } = await import('../../src/tools/draft.js');

    const ctx = makeCtx();
    let capturedPrompt = '';

    registerDraftTool(ctx as any, {
      service,
      llm: async (input) => {
        capturedPrompt = input.prompt;
        return {
          text: JSON.stringify(VALID_ROUTINE_JSON),
          usage: {
            inputTokens: 500, outputTokens: 300, cacheHitTokens: 400,
            cacheMissTokens: 100, reasoningTokens: 50, costCny: 0.002,
          },
        };
      },
    });

    const tool = ctx.getRegistered().find((t: any) => t.name === 'routine_draft');
    expect(tool).toBeDefined();

    const result = await tool.execute({
      botId,
      intent: '每天早上9点检查仓库里的 TODO',
    });

    expect(result).toContain('草稿已生成');
    expect(result).toContain('每日 TODO 检查');
    expect(result).toContain('apiVersion: dsh-bot/v1');
    expect(result).toContain('routine_save');
    expect(capturedPrompt).toContain('每天早上9点检查仓库里的 TODO');
  });

  it('应能剥离 markdown 代码块', async () => {
    const { registerDraftTool } = await import('../../src/tools/draft.js');
    const ctx = makeCtx();

    registerDraftTool(ctx as any, {
      service,
      llm: async () => ({
        text: '```json\n' + JSON.stringify(VALID_ROUTINE_JSON, null, 2) + '\n```',
        usage: {
          inputTokens: 0, outputTokens: 0, cacheHitTokens: 0,
          cacheMissTokens: 0, reasoningTokens: 0, costCny: 0,
        },
      }),
    });

    const tool = ctx.getRegistered()[0];
    const result = await tool.execute({ botId, intent: '检查 TODO' });

    expect(result).toContain('草稿已生成');
    expect(result).not.toContain('```json\n{');
  });

  it('应标注副作用步骤', async () => {
    const { registerDraftTool } = await import('../../src/tools/draft.js');
    const ctx = makeCtx();

    registerDraftTool(ctx as any, {
      service,
      llm: async () => ({
        text: JSON.stringify(VALID_ROUTINE_JSON),
        usage: {
          inputTokens: 0, outputTokens: 0, cacheHitTokens: 0,
          cacheMissTokens: 0, reasoningTokens: 0, costCny: 0,
        },
      }),
    });

    const tool = ctx.getRegistered()[0];
    const result = await tool.execute({ botId, intent: 'x' });
    expect(result).toContain('有副作用');
    expect(result).toContain('dry-run');
  });

  it('模型返回非 JSON 时应优雅降级', async () => {
    const { registerDraftTool } = await import('../../src/tools/draft.js');
    const ctx = makeCtx();

    registerDraftTool(ctx as any, {
      service,
      llm: async () => ({
        text: '抱歉，我无法理解这个需求。',
        usage: {
          inputTokens: 0, outputTokens: 0, cacheHitTokens: 0,
          cacheMissTokens: 0, reasoningTokens: 0, costCny: 0,
        },
      }),
    });

    const tool = ctx.getRegistered()[0];
    const result = await tool.execute({ botId, intent: 'x' });

    expect(result).toContain('没有返回可解析的 JSON');
    expect(result).toContain('抱歉');
  });

  it('模型返回非法 Routine 时应显示校验错误', async () => {
    const { registerDraftTool } = await import('../../src/tools/draft.js');
    const ctx = makeCtx();

    const bad = {
      apiVersion: 'dsh-bot/v1',
      kind: 'Routine',
      metadata: { id: 'Invalid_ID', name: '' }, // id 非法、name 空
      spec: { steps: [] },
    };

    registerDraftTool(ctx as any, {
      service,
      llm: async () => ({
        text: JSON.stringify(bad),
        usage: {
          inputTokens: 0, outputTokens: 0, cacheHitTokens: 0,
          cacheMissTokens: 0, reasoningTokens: 0, costCny: 0,
        },
      }),
    });

    const tool = ctx.getRegistered()[0];
    const result = await tool.execute({ botId, intent: 'x' });

    expect(result).toContain('未通过校验');
  });

  it('模型调用失败时应报错', async () => {
    const { registerDraftTool } = await import('../../src/tools/draft.js');
    const ctx = makeCtx();

    registerDraftTool(ctx as any, {
      service,
      llm: async () => {
        throw new Error('API 超时');
      },
    });

    const tool = ctx.getRegistered()[0];
    await expect(tool.execute({ botId, intent: 'x' })).rejects.toThrow(/生成草稿失败/);
  });

  it('intent 为空应报错', async () => {
    const { registerDraftTool } = await import('../../src/tools/draft.js');
    const ctx = makeCtx();

    registerDraftTool(ctx as any, {
      service,
      llm: async () => ({
        text: JSON.stringify(VALID_ROUTINE_JSON),
        usage: {
          inputTokens: 0, outputTokens: 0, cacheHitTokens: 0,
          cacheMissTokens: 0, reasoningTokens: 0, costCny: 0,
        },
      }),
    });

    const tool = ctx.getRegistered()[0];
    await expect(tool.execute({ botId, intent: '   ' })).rejects.toThrow(/不能为空/);
  });

  it('生成的草稿应能通过 validateRoutine 并保存', async () => {
    // 直接验证 VALID_ROUTINE_JSON 本身合法
    const routine = validateRoutine(VALID_ROUTINE_JSON);
    await service.saveRoutine(botId, routine);

    const got = await service.getRoutine(botId, 'check-todos');
    expect(got.metadata.name).toBe('每日 TODO 检查');
    expect(got.spec.steps).toHaveLength(2);
    expect(got.spec.triggers[0]).toMatchObject({ type: 'cron' });
  });
});

describe('detectProvider', () => {
  it('应从 listProviders 提取 provider 名', async () => {
    const { detectProvider } = await import('../../src/tools/draft.js');
    const ctx = {
      llm: {
        listProviders: () => [
          { id: 'workbuddy' },
          { id: 'deepseek-official' },
        ],
      },
    };
    expect(detectProvider(ctx)).toBe('workbuddy');
  });

  it('provider 是字符串数组时应直接返回首个', async () => {
    const { detectProvider } = await import('../../src/tools/draft.js');
    const ctx = { llm: { listProviders: () => ['workbuddy'] } };
    expect(detectProvider(ctx)).toBe('workbuddy');
  });

  it('无法探测时应返回 undefined', async () => {
    const { detectProvider } = await import('../../src/tools/draft.js');
    expect(detectProvider({})).toBeUndefined();
    expect(detectProvider({ llm: {} })).toBeUndefined();
  });
});
