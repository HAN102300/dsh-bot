/**
 * issue #1 回归：适配器失败块 + reasoningEffort 兼容
 *
 * 背景（2026-11-22 用户报告，github.com/HAN102300/dsh-bot/issues/1）：
 *   1. 插件无条件下发 reasoningEffort，宿主对「模型条目未声明 reasoning」直接抛
 *      UNSUPPORTED_REASONING_EFFORT；
 *   2. 该失败以「finish 块 + reason.kind=error」到达（不是 type:'error'），
 *      插件只存 stopReason → 被吞成「模型返回了空内容」，真实原因彻底不可见。
 */
import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import * as bridge from '../../src/llm/bridge.js';

/** 假宿主：按 DSH dsh-llm 的 adapterFailureChunk 形状发块 */
function hostWith(handler: (options: any) => AsyncGenerator<any, void, unknown>) {
  return { llm: { stream: handler } };
}

describe('issue #1：reasoningEffort 与失败块', () => {
  it('模型未声明 reasoning 时：自动去掉 effort 重试并成功', async () => {
    let calls = 0;
    const ctx = hostWith(async function* (options: any) {
      calls++;
      if (options.reasoningEffort !== undefined) {
        yield {
          type: 'finish',
          reason: {
            kind: 'error',
            failure: {
              code: 'UNSUPPORTED_REASONING_EFFORT',
              message: `model "${options.model}" does not support reasoning effort "${options.reasoningEffort}"`,
            },
          },
        };
        return;
      }
      yield { type: 'text-delta', text: '你好。' };
      yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 3 } };
      yield { type: 'finish', reason: { kind: 'stop' } };
    });

    const out = await bridge.createLlmInvoker(ctx)({
      provider: 'p', model: 'm', reasoningEffort: 'high', prompt: 'hi',
    });

    expect(calls).toBe(2);              // 第一次带 effort 失败 → 第二次不带
    expect(out.text).toBe('你好。');
    expect(out.notes?.join(' ')).toContain('已自动关闭 reasoningEffort=high');
  });

  it('模型支持 reasoning 时：effort 原样下发，不触发重试', async () => {
    const seen: any[] = [];
    const ctx = hostWith(async function* (options: any) {
      seen.push(options.reasoningEffort);
      yield { type: 'text-delta', text: 'ok' };
      yield { type: 'finish', reason: { kind: 'stop' } };
    });
    const out = await bridge.createLlmInvoker(ctx)({
      provider: 'p', model: 'm', reasoningEffort: 'max', prompt: 'hi',
    });
    expect(seen).toEqual(['max']);
    expect(out.notes).toBeUndefined();
  });

  it('未指定 effort 时不把该字段塞给宿主', async () => {
    let received = 'unset';
    const ctx = hostWith(async function* (options: any) {
      received = 'reasoningEffort' in options ? options.reasoningEffort : 'absent';
      yield { type: 'text-delta', text: 'ok' };
      yield { type: 'finish', reason: { kind: 'stop' } };
    });
    await bridge.createLlmInvoker(ctx)({ provider: 'p', model: 'm', prompt: 'hi' });
    expect(received).toBe('absent');
  });

  it('真实适配器错误必须原样暴露，而不是「空内容」', async () => {
    const ctx = hostWith(async function* () {
      yield {
        type: 'finish',
        reason: { kind: 'error', failure: { code: 'AUTH_ERROR', message: 'invalid api key' } },
      };
    });
    await expect(
      bridge.createLlmInvoker(ctx)({ provider: 'p', model: 'm', reasoningEffort: 'high', prompt: 'hi' }),
    ).rejects.toThrow(/AUTH_ERROR|invalid api key/);

    await expect(
      bridge.createLlmInvoker(ctx)({ provider: 'p', model: 'm', prompt: 'hi' }),
    ).rejects.not.toThrow(/空内容/);
  });

  it('aborted 块同样按失败处理（不再落进空内容分支）', async () => {
    const ctx = hostWith(async function* () {
      yield { type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', message: 'aborted' } } };
    });
    await expect(
      bridge.createLlmInvoker(ctx)({ provider: 'p', model: 'm', prompt: 'hi' }),
    ).rejects.toThrow(/ABORTED|aborted/);
  });
});
