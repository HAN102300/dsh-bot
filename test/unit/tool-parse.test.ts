/**
 * 工具块解析测试（B14）
 *
 * 真实事故（2026-11-06 首跑）：模型把 4 个调用写进同一个 ```tool 块，
 * 旧解析器要求「整块是一个 JSON」，JSON.parse 失败后 4 个调用被整体丢弃，
 * 运行却记为 success —— 看起来成功，实际什么都没做。
 *
 * 现在要求：
 *   1. 单 JSON 块照旧可用；
 *   2. 一个块里多行 JSON（JSON Lines）也要全部识别；
 *   3. 数组形态也识别；
 *   4. 看着像工具调用但解析失败时，必须报 unparsed，让 runTask 记失败。
 */

import { describe, it, expect } from 'vitest';

import { parseToolCallMarkers } from '../../src/routine/runner.js';

const fence = (body: string) => '\u0060\u0060\u0060tool\n' + body + '\n\u0060\u0060\u0060';

describe('parseToolCallMarkers', () => {
  it('单对象块：识别 1 个调用并从正文剥离', () => {
    const r = parseToolCallMarkers('我来抓取。\n\n' + fence('{"tool":"http_get","args":{"url":"https://a"}}'));
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0]).toEqual({ name: 'http_get', args: { url: 'https://a' } });
    expect(r.cleaned).toBe('我来抓取。');
    expect(r.unparsed).toBe(0);
  });

  it('多行 JSON（JSON Lines）：一个块里的多个调用全部识别', () => {
    const body = [
      '{"tool":"http_get","args":{"url":"https://a"}}',
      '{"tool":"http_get","args":{"url":"https://b"}}',
      '{"tool":"http_get","args":{"url":"https://c"}}',
      '{"tool":"http_get","args":{"url":"https://d"}}',
    ].join('\n');
    const r = parseToolCallMarkers(fence(body));
    expect(r.calls.map((c) => (c.args as any).url)).toEqual(['https://a', 'https://b', 'https://c', 'https://d']);
    expect(r.unparsed).toBe(0);
  });

  it('数组形态：一次给多个调用', () => {
    const r = parseToolCallMarkers(fence('[{"tool":"a","args":{}},{"name":"b","input":{"x":1}}]'));
    expect(r.calls.map((c) => c.name)).toEqual(['a', 'b']);
    expect(r.unparsed).toBe(0);
  });

  it('普通代码块（非工具 JSON）原样保留', () => {
    const r = parseToolCallMarkers('示例：\n\n' + '\u0060\u0060\u0060json\n{"foo":"bar"}\n\u0060\u0060\u0060');
    expect(r.calls).toHaveLength(0);
    expect(r.unparsed).toBe(0);
    expect(r.cleaned).toContain('"foo"');
  });

  it('看着像工具调用但 JSON 非法：报 unparsed，块保留', () => {
    const r = parseToolCallMarkers(fence('{"tool":"http_get", "args": {'));
    expect(r.calls).toHaveLength(0);
    expect(r.unparsed).toBe(1);
    expect(r.cleaned).toContain('http_get');
  });

  it('尾逗号容错：逐行解析时允许行尾逗号', () => {
    const r = parseToolCallMarkers(
      fence('{"tool":"a","args":{}},\n{"tool":"b","args":{}},'),
    );
    expect(r.calls.map((c) => c.name)).toEqual(['a', 'b']);
  });
});
