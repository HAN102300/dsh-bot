/**
 * 工具调用器的跨宿主签名测试
 *
 * 背景（HOST-CONTRACT 契约 2）：
 *   DSH 0.2.1 的 ctx.tools.execute 吃单对象 { name, arguments, signal }；
 *   DSH 0.2.2 起改吃批量 { calls: [{ type:'tool-call', id, name, arguments(JSON 字符串) }], signal }，
 *   返回也从单结果变成 { results: [{ callId, result }] }。
 *
 * 桥接层的策略是「批量优先、单次回退」。这组测试锁住三件事：
 *   1. 批量宿主上，calls 形态正确、arguments 是字符串、结果能解开；
 *   2. 旧宿主上，批量失败后能回退到单对象签名；
 *   3. 真正的业务错误不被回退掩盖（抛的是批量那次的原错误）。
 */

import { describe, it, expect } from 'vitest';

import { createToolInvoker } from '../../src/index.js';

const signal = new AbortController().signal;

describe('createToolInvoker 跨宿主签名', () => {
  it('0.2.2 批量宿主：构造 calls 并解开 results', async () => {
    const seen: any[] = [];
    const ctx = {
      tools: {
        execute: async (input: any) => {
          seen.push(input);
          return {
            results: [{ callId: 'c1', result: { content: [], value: { ok: true, echoed: input.calls[0].name } } }],
            additionalContexts: [],
            concluded: false,
          };
        },
      },
    };
    const invoker = createToolInvoker(ctx as any);
    const out = await invoker.call('http_get', { url: 'https://example.com' }, signal);

    expect(out).toEqual({ ok: true, echoed: 'http_get' });
    expect(seen).toHaveLength(1);
    expect(seen[0].calls).toHaveLength(1);
    expect(seen[0].calls[0]).toMatchObject({ type: 'tool-call', name: 'http_get' });
    // arguments 必须是 JSON 字符串，不是对象
    expect(typeof seen[0].calls[0].arguments).toBe('string');
    expect(JSON.parse(seen[0].calls[0].arguments)).toEqual({ url: 'https://example.com' });
    expect(seen[0].signal).toBe(signal);
  });

  it('0.2.1 旧宿主：批量形态被拒后回退单对象签名', async () => {
    const seen: any[] = [];
    const ctx = {
      tools: {
        execute: async (input: any) => {
          seen.push(input);
          if (Array.isArray(input.calls)) throw new TypeError('calls is not supported');
          return { content: [], value: { ok: 'legacy' } };
        },
      },
    };
    const invoker = createToolInvoker(ctx as any);
    const out = await invoker.call('bot_list', {}, signal);

    expect(out).toEqual({ ok: 'legacy' });
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({ name: 'bot_list' });
    expect(seen[1].arguments).toEqual({});
  });

  it('业务错误不被回退掩盖（抛批量那次的原错误）', async () => {
    const ctx = {
      tools: {
        execute: async (input: any) => {
          if (Array.isArray(input.calls)) throw new Error('BOOM: upstream 500');
          throw new Error('legacy signature rejected');
        },
      },
    };
    const invoker = createToolInvoker(ctx as any);
    await expect(invoker.call('http_get', {}, signal)).rejects.toThrow('BOOM: upstream 500');
  });

  it('结果外壳已解包时也能取到 value', async () => {
    const ctx = {
      tools: { execute: async () => ({ results: [{ callId: 'c', result: { value: 42 } }] }) },
    };
    const invoker = createToolInvoker(ctx as any);
    await expect(invoker.call('bot_heartbeat', {}, signal)).resolves.toBe(42);
  });
});
