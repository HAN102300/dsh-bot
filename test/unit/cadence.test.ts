/**
 * 执行节奏测试
 *
 * 这组测试守的是一条被真实用户踩到的线：
 *
 *   他在目标里写「每过 4 小时给我报告」，
 *   然后发现 Bot 从来不会自己跑。
 *
 * 根因是：调度器只扫 routine，目标里那句话完全是装饰。
 * 现在目标自带 cadence，这里验证它真的能被识别、真的会被调度。
 */

import { describe, it, expect } from 'vitest';

import { parseCadence, createGoal } from '../../src/goal/state.js';

const NOW = '2026-10-21T12:00:00.000Z';

// ============================================================
// 自然语言 → cron
// ============================================================

describe('parseCadence：把口语翻成 cron', () => {
  it('「每 4 小时」→ 0 */4 * * *', () => {
    expect(parseCadence('每 4 小时')).toBe('0 */4 * * *');
  });

  it('「每过4小时」也能识别（用户原话就是这样）', () => {
    expect(parseCadence('每过4小时')).toBe('0 */4 * * *');
  });

  it('「每隔 6 小时」→ 0 */6 * * *', () => {
    expect(parseCadence('每隔 6 小时')).toBe('0 */6 * * *');
  });

  it('「每小时」→ 0 * * * *', () => {
    expect(parseCadence('每小时检查一次')).toBe('0 * * * *');
  });

  it('「每 30 分钟」→ */30 * * * *', () => {
    expect(parseCadence('每 30 分钟')).toBe('*/30 * * * *');
  });

  it('「每天早上 9 点」→ 0 9 * * *', () => {
    expect(parseCadence('每天早上 9 点给我日报')).toBe('0 9 * * *');
  });

  it('「每天下午 3 点」→ 0 15 * * *（下午要加 12）', () => {
    expect(parseCadence('每天下午 3 点')).toBe('0 15 * * *');
  });

  it('「每天 9 点 30 分」→ 30 9 * * *', () => {
    expect(parseCadence('每天 9 点 30 分')).toBe('30 9 * * *');
  });

  it('「每周一 9 点」→ 0 9 * * 1', () => {
    expect(parseCadence('每周一 9 点')).toBe('0 9 * * 1');
  });

  it('「每周日」→ 0 9 * * 0（默认 9 点）', () => {
    expect(parseCadence('每周日')).toBe('0 9 * * 0');
  });

  it('识别不了就返回 undefined，不猜', () => {
    expect(parseCadence('整理下载文件夹')).toBeUndefined();
    expect(parseCadence('')).toBeUndefined();
    expect(parseCadence('帮我看看服务器')).toBeUndefined();
  });

  it('拒绝越界的小时数', () => {
    expect(parseCadence('每 99 小时')).toBeUndefined();
    expect(parseCadence('每 0 小时')).toBeUndefined();
  });

  it('一行里有节奏词也能识别', () => {
    expect(
      parseCadence('从现在开始，将服务监测运行情况、各项参数报告，每过 4 小时给我'),
    ).toBe('0 */4 * * *');
  });
});

// ============================================================
// 目标带节奏
// ============================================================

describe('createGoal 支持 cadence', () => {
  it('传了 cadence 就落进目标', () => {
    const g = createGoal(
      'g1',
      { description: '监控服务', cadence: '0 */4 * * *' },
      NOW,
    );
    expect(g.cadence).toBe('0 */4 * * *');
  });

  it('没传 cadence 就是 undefined（手动目标）', () => {
    const g = createGoal('g1', { description: '整理文件' }, NOW);
    expect(g.cadence).toBeUndefined();
  });

  it('standing + cadence 是「持续自动跑」的完整形态', () => {
    const g = createGoal(
      'g1',
      { description: '守护服务', type: 'standing', cadence: '0 */4 * * *' },
      NOW,
    );
    expect(g.type).toBe('standing');
    expect(g.cadence).toBe('0 */4 * * *');
    expect(g.cycleCount).toBe(0);
    expect(g.status).toBe('active');
  });
});
