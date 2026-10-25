/**
 * 模型列表探测测试
 *
 * 这组测试记录了一次真实的误判：
 *
 *   前两版实现都在猜「方法名对不对」——试 listModels / models / getModels，
 *   结果永远是 undefined，于是面板上只有 provider 下拉、没有 model 下拉。
 *
 *   读了 dsh-llm 源码才发现：**listModels 是 async 函数**。
 *   Array.isArray(Promise) 恒为 false —— 所以无论试多少方法名都没用。
 *
 *   真正的错误是「没有 await」。
 *
 * 所以这里的核心用例全部走 async，并且明确验证 Promise 也能被正确处理。
 */

import { describe, it, expect } from 'vitest';

import { listAvailableModels } from '../../src/index.js';

// ============================================================
// 核心：async 处理
// ============================================================

describe('listAvailableModels 正确处理异步', () => {
  it('⭐ listModels 返回 Promise（真实情况）能被 await 出来', async () => {
    const ctx = {
      llm: {
        listProviders: () => [{ id: 'trae' }, { id: 'deepseek-official' }],
        listModels: async (p: string) =>
          p === 'trae'
            ? [
                { provider: 'trae', id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash' },
                { provider: 'trae', id: 'deepseek-v4.1-pro', name: 'DeepSeek V4.1 Pro' },
              ]
            : [],
      },
    };

    const r = await listAvailableModels(ctx);
    const trae = r.find((x) => x.provider === 'trae');
    expect(trae?.models).toEqual(['deepseek-v4.1-flash', 'deepseek-v4.1-pro']);
  });

  it('async 与 sync 混用都能处理', async () => {
    const ctx = {
      llm: {
        listProviders: () => [{ id: 'a' }, { id: 'b' }],
        listModels: (p: string) =>
          p === 'a' ? Promise.resolve(['async-model']) : ['sync-model'],
      },
    };
    const r = await listAvailableModels(ctx);
    expect(r.find((x) => x.provider === 'a')?.models).toEqual(['async-model']);
    expect(r.find((x) => x.provider === 'b')?.models).toEqual(['sync-model']);
  });

  it('listModels 返回空数组时，继续试下一个候选方法', async () => {
    const ctx = {
      llm: {
        listProviders: () => [{ id: 'trae' }],
        listModels: async () => [],
        models: async () => ['from-models-method'],
      },
    };
    const r = await listAvailableModels(ctx);
    expect(r[0].models).toContain('from-models-method');
  });

  it('listModels 抛错时继续下一个兜底', async () => {
    const ctx = {
      llm: {
        listProviders: () => [{ id: 'trae' }],
        listModels: async () => {
          throw new Error('not supported');
        },
        getModels: async () => ['from-getModels'],
      },
    };
    const r = await listAvailableModels(ctx);
    expect(r[0].models).toContain('from-getModels');
  });
});

// ============================================================
// 其他兜底层
// ============================================================

describe('listAvailableModels 兜底层', () => {
  it('provider 对象自带 models 字段', async () => {
    const ctx = {
      llm: {
        listProviders: () => [{ id: 'trae', models: [{ id: 'own-model' }] }],
        listModels: async () => [],
      },
    };
    const r = await listAvailableModels(ctx);
    expect(r[0].models).toContain('own-model');
  });

  it('拿不到列表时，不抛错且 models 一定是数组', async () => {
    // ⚠️ 这里不写死"一定有兜底模型"——兜底只在 provider 恰好等于
    //    当前会话模型时才生效，而会话模型会随用户配置变化。
    //    钉死具体值会让测试在用户切模型时莫名失败（这正是它刚才失败的原因）。
    const ctx = {
      llm: {
        listProviders: () => [{ id: 'definitely-not-the-session-provider' }],
        listModels: async () => [],
      },
    };
    const r = await listAvailableModels(ctx);
    expect(r[0].provider).toBe('definitely-not-the-session-provider');
    expect(Array.isArray(r[0].models)).toBe(true);
  });

  it('模型对象带 name 而非 id 时也能取到', async () => {
    const ctx = {
      llm: {
        listProviders: () => [{ id: 'trae' }],
        listModels: async () => [{ name: 'readable-name' }],
      },
    };
    const r = await listAvailableModels(ctx);
    expect(r[0].models).toEqual(['readable-name']);
  });
});

// ============================================================
// 健壮性
// ============================================================

describe('listAvailableModels 健壮性', () => {
  it('没有 llm 服务时返回空数组', async () => {
    expect(await listAvailableModels({})).toEqual([]);
    expect(await listAvailableModels({ llm: null })).toEqual([]);
  });

  it('listProviders 抛错时返回空数组', async () => {
    const ctx = {
      llm: {
        listProviders: () => {
          throw new Error('boom');
        },
      },
    };
    expect(await listAvailableModels(ctx)).toEqual([]);
  });

  it('listProviders 返回非数组时不崩', async () => {
    expect(await listAvailableModels({ llm: { listProviders: () => null } })).toEqual([]);
    expect(await listAvailableModels({ llm: { listProviders: () => ({}) } })).toEqual([]);
  });

  it('过滤掉没有 id 的脏 provider', async () => {
    const ctx = {
      llm: {
        listProviders: () => [{ name: 123 }, { id: 'good' }],
        listModels: async () => ['m'],
      },
    };
    const r = await listAvailableModels(ctx);
    expect(r.map((x) => x.provider)).toEqual(['good']);
  });

  it('provider 以字符串给出也能处理', async () => {
    const ctx = {
      llm: {
        listProviders: () => ['trae', 'deepseek-official'],
        listModels: async (p: string) => (p === 'trae' ? ['m1'] : []),
      },
    };
    const r = await listAvailableModels(ctx);
    expect(r.map((x) => x.provider)).toEqual(['trae', 'deepseek-official']);
  });
});
