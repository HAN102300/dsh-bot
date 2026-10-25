/**
 * 设置与成本计算测试
 *
 * 覆盖 ROADMAP 第二刀的 C1/C2/C3/C6：
 *   价格区分峰谷、多 provider、免费模型标注、算不出来要诚实
 *
 * 以及第三刀的设置存储与免打扰时段。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  computeCost,
  isFreeModel,
  isPeakHour,
} from '../../src/llm/bridge.js';
import {
  SettingsStore,
  mergeSettings,
  sanitizeSettings,
  inQuietHours,
  DEFAULT_SETTINGS,
  type BotSettings,
} from '../../src/settings.js';

// ============================================================
// 成本：区分"免费"与"不知道"
// ============================================================

describe('computeCost 诚实计价', () => {
  const usage = { cacheHitTokens: 0, cacheMissTokens: 1000, outputTokens: 500 };

  it('⭐ 未知模型返回 unknown，不编一个数字', () => {
    const r = computeCost('some-provider', 'mystery-model', usage);
    expect(r.kind).toBe('unknown');
    expect(r.cny).toBeUndefined();
    expect(r.note).toContain('无法计算');
  });

  it('免费模型返回 0 且标记 free（不是 unknown）', () => {
    const r = computeCost('our-free-model', 'deepseek-v4.1-flash-free', usage);
    expect(r.kind).toBe('free');
    expect(r.cny).toBe(0);
  });

  it('已知模型返回精确金额', () => {
    const r = computeCost('deepseek', 'deepseek-flash', usage);
    expect(r.kind).toBe('exact');
    expect(r.cny).toBeGreaterThan(0);
  });

  it('⭐ 免费与未知必须可区分（这是本次重构的核心）', () => {
    const free = computeCost('our-free-model', 'x-free', usage);
    const unknown = computeCost('nope', 'nothing', usage);

    expect(free.cny).toBe(0);
    expect(unknown.cny).toBeUndefined();
    expect(free.kind).not.toBe(unknown.kind);
  });

  it('只有 model 名（无 provider）也能查表', () => {
    const r = computeCost('', 'deepseek-flash', usage);
    expect(r.kind).toBe('exact');
  });
});

describe('isFreeModel', () => {
  it('识别常见的免费命名', () => {
    expect(isFreeModel('our-free-model', 'deepseek-v4.1-flash-free')).toBe(true);
    expect(isFreeModel('x', 'gpt-free-7b')).toBe(true);
    expect(isFreeModel('deepseek-web', 'anything')).toBe(true);
  });

  it('付费模型不误判', () => {
    expect(isFreeModel('deepseek', 'deepseek-flash')).toBe(false);
    expect(isFreeModel('trae', 'deepseek-v4.1-flash')).toBe(false);
  });
});

describe('isPeakHour 峰谷判断', () => {
  it('工作日 10:00（北京）是高峰', () => {
    // 2026-10-21 是周三
    const d = new Date('2026-10-21T02:00:00Z'); // 北京 10:00
    expect(isPeakHour(d)).toBe(true);
  });

  it('工作日 13:00（北京）不是高峰', () => {
    const d = new Date('2026-10-21T05:00:00Z'); // 北京 13:00
    expect(isPeakHour(d)).toBe(false);
  });

  it('工作日 15:00（北京）是高峰', () => {
    const d = new Date('2026-10-21T07:00:00Z'); // 北京 15:00
    expect(isPeakHour(d)).toBe(true);
  });

  it('周末任何时间都不是高峰', () => {
    const d = new Date('2026-10-24T02:00:00Z'); // 周六，北京 10:00
    expect(isPeakHour(d)).toBe(false);
  });
});

// ============================================================
// 设置
// ============================================================

describe('设置合并与校验', () => {
  it('默认设置完整', () => {
    const s = mergeSettings();
    expect(s.notifySystem).toBe(true);
    expect(s.dailyCny).toBe(5);
    expect(s.followSessionModel).toBe(true);
  });

  it('单 Bot 覆盖全局', () => {
    const s = mergeSettings({ dailyCny: 10 }, { dailyCny: 2 });
    expect(s.dailyCny).toBe(2);
  });

  it('非法值被丢弃，不静默接受', () => {
    const clean = sanitizeSettings({
      dailyCny: -5, // 负数非法
      reasoningEffort: 'ultra', // 非法枚举
      notifySystem: 'yes', // 非布尔
      snapshotKeepRecent: 3.7,
    });
    expect(clean.dailyCny).toBeUndefined();
    expect(clean.reasoningEffort).toBeUndefined();
    expect(clean.notifySystem).toBeUndefined();
    expect(clean.snapshotKeepRecent).toBe(3); // 取整
  });

  it('合法值通过', () => {
    const clean = sanitizeSettings({
      dailyCny: 8,
      reasoningEffort: 'max',
      notifySystem: false,
    });
    expect(clean.dailyCny).toBe(8);
    expect(clean.reasoningEffort).toBe('max');
    expect(clean.notifySystem).toBe(false);
  });

  it('免打扰时段格式校验', () => {
    expect(sanitizeSettings({ quietHours: { start: '22:00', end: '08:00' } }).quietHours)
      .toEqual({ start: '22:00', end: '08:00' });
    expect(sanitizeSettings({ quietHours: { start: '25:00', end: '08:00' } }).quietHours)
      .toBeUndefined();
    expect(sanitizeSettings({ quietHours: null }).quietHours).toBeNull();
  });
});

describe('inQuietHours 免打扰', () => {
  it('跨午夜时段 22:00-08:00 内', () => {
    // 北京 23:00
    const d = new Date('2026-10-21T15:00:00Z');
    expect(inQuietHours({ start: '22:00', end: '08:00' }, d)).toBe(true);
  });

  it('跨午夜时段外（北京 12:00）', () => {
    const d = new Date('2026-10-21T04:00:00Z');
    expect(inQuietHours({ start: '22:00', end: '08:00' }, d)).toBe(false);
  });

  it('同日内时段 09:00-18:00', () => {
    const noon = new Date('2026-10-21T04:00:00Z'); // 北京 12:00
    expect(inQuietHours({ start: '09:00', end: '18:00' }, noon)).toBe(true);

    const night = new Date('2026-10-21T15:00:00Z'); // 北京 23:00
    expect(inQuietHours({ start: '09:00', end: '18:00' }, night)).toBe(false);
  });

  it('null 时段永远不在免打扰中', () => {
    expect(inQuietHours(null)).toBe(false);
  });

  it('起止相同视为不启用', () => {
    expect(inQuietHours({ start: '10:00', end: '10:00' })).toBe(false);
  });
});

describe('SettingsStore 持久化', () => {
  let tmp: string;
  let store: SettingsStore;

  beforeEach(async () => {
    tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-bot-settings-'));
    store = new SettingsStore(tmp);
  });

  afterEach(async () => {
    await fsp.rm(tmp, { recursive: true, force: true });
  });

  it('默认读到空（未配置过）', async () => {
    expect(await store.getGlobal()).toEqual({});
  });

  it('写入后能读出', async () => {
    await store.setGlobal({ dailyCny: 8 });
    const g = await store.getGlobal();
    expect(g.dailyCny).toBe(8);
  });

  it('多次写入是合并而非覆盖', async () => {
    await store.setGlobal({ dailyCny: 8 });
    await store.setGlobal({ notifySystem: false });
    const resolved = await store.resolve();
    expect(resolved.dailyCny).toBe(8);
    expect(resolved.notifySystem).toBe(false);
  });

  it('单 Bot 覆盖全局', async () => {
    await store.setGlobal({ dailyCny: 8 });
    await store.setForBot('bot_x', { dailyCny: 2 });
    const s = await store.resolve('bot_x');
    expect(s.dailyCny).toBe(2);
  });

  it('单 Bot 不设置时继承全局', async () => {
    await store.setGlobal({ dailyCny: 8 });
    const s = await store.resolve('bot_y');
    expect(s.dailyCny).toBe(8);
  });

  it('非法值写入时被清洗掉', async () => {
    await store.setGlobal({ dailyCny: -1 } as Partial<BotSettings>);
    const s = await store.resolve();
    expect(s.dailyCny).toBe(DEFAULT_SETTINGS.dailyCny);
  });
});
