/**
 * 时区换算一致性（v0.3.5 刀 4 / B8）
 *
 * 旧实现用 toLocaleString 反解析，新实现用 scheduler/cron.ts 的 toZonedDate。
 * 这里锁住「同一时刻、两种算法、同一墙上时间」，防止替换悄悄改变高峰/免打扰判定。
 */

import { describe, it, expect } from 'vitest';

import { toZonedDate } from '../../src/scheduler/cron.js';

const ZONES = ['Asia/Shanghai', 'UTC', 'America/New_York', 'Europe/London', 'Australia/Sydney'];
const INSTANTS = [
  '2026-11-06T04:00:00.000Z',
  '2026-11-06T16:30:00.000Z',
  '2026-01-01T00:00:00.000Z',
  '2026-03-29T02:30:00.000Z',
  '2026-06-15T12:00:00.000Z',
];

// 旧算法（被替换掉的实现）：反解析本地化字符串
const legacy = (d: Date, tz: string) =>
  new Date(d.toLocaleString('en-US', { timeZone: tz }));

describe('toZonedDate 与旧反解析算法等价', () => {
  for (const tz of ZONES) {
    for (const iso of INSTANTS) {
      it(`${tz} @ ${iso}`, () => {
        const d = new Date(iso);
        const a = toZonedDate(d, tz);
        const b = legacy(d, tz);
        expect(a.getFullYear()).toBe(b.getFullYear());
        expect(a.getMonth()).toBe(b.getMonth());
        expect(a.getDate()).toBe(b.getDate());
        expect(a.getHours()).toBe(b.getHours());
        expect(a.getMinutes()).toBe(b.getMinutes());
        expect(a.getDay()).toBe(b.getDay());
      });
    }
  }
});
