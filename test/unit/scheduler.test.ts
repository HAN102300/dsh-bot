/**
 * 调度器测试
 *
 * 覆盖：
 *   1. cron 解析（各类语法、边界、错误）
 *   2. cron 匹配（时区、Vixie OR 语义）
 *   3. 下次执行时间计算
 *   4. 峰谷错峰
 *   5. 调度器 tick（去重、触发）
 *   6. 心跳与休眠检测
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { BotService } from '../../src/service.js';
import { DEFAULT_CONFIG } from '../../src/index.js';
import {
  parseCron,
  matchesCron,
  matchesCronAt,
  nextRunAt,
  isValidCron,
  describeCron,
  toZonedDate,
  fromZonedWall,
} from '../../src/scheduler/cron.js';
import { shiftOutOfPeak, adjustForCost, describeTimeSlot } from '../../src/scheduler/peak.js';
import { Scheduler } from '../../src/scheduler/scheduler.js';
import { createGoal } from '../../src/goal/state.js';
import { validateRoutine, type Routine } from '../../src/routine/schema.js';

let tmpRoot: string;

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-bot-sched-'));
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

// ============================================================
// cron 解析
// ============================================================

describe('cron 解析', () => {
  it('应解析通配符', () => {
    const c = parseCron('* * * * *');
    expect(c.minute).toHaveLength(60);
    expect(c.hour).toHaveLength(24);
    expect(c.domRestricted).toBe(false);
    expect(c.dowRestricted).toBe(false);
  });

  it('应解析精确值', () => {
    const c = parseCron('30 9 * * *');
    expect(c.minute).toEqual([30]);
    expect(c.hour).toEqual([9]);
  });

  it('应解析步长', () => {
    const c = parseCron('*/15 * * * *');
    expect(c.minute).toEqual([0, 15, 30, 45]);
  });

  it('应解析范围', () => {
    const c = parseCron('0 9 * * 1-5');
    expect(c.dayOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(c.dowRestricted).toBe(true);
  });

  it('应解析范围带步长', () => {
    const c = parseCron('0 0-12/3 * * *');
    expect(c.hour).toEqual([0, 3, 6, 9, 12]);
  });

  it('应解析枚举', () => {
    const c = parseCron('0 9,12,18 * * *');
    expect(c.hour).toEqual([9, 12, 18]);
  });

  it('应把周日 7 归一化为 0', () => {
    const c = parseCron('0 9 * * 7');
    expect(c.dayOfWeek).toEqual([0]);
  });

  it('段数不对应报错', () => {
    expect(() => parseCron('* * *')).toThrow(/5 段/);
    expect(() => parseCron('* * * * * *')).toThrow(/5 段/);
  });

  it('超范围应报错', () => {
    expect(() => parseCron('60 * * * *')).toThrow(/超出范围/);
    expect(() => parseCron('* 24 * * *')).toThrow(/超出范围/);
    expect(() => parseCron('* * 32 * *')).toThrow(/超出范围/);
  });

  it('非法步长应报错', () => {
    expect(() => parseCron('*/0 * * * *')).toThrow(/正整数/);
    expect(() => parseCron('*/-1 * * * *')).toThrow();
  });

  it('isValidCron 应正确判断', () => {
    expect(isValidCron('0 9 * * *')).toBe(true);
    expect(isValidCron('0 9 * *')).toBe(false);
    expect(isValidCron('abc def ghi jkl mno')).toBe(false);
  });

  it('describeCron 应生成可读描述', () => {
    expect(describeCron(parseCron('* * * * *'))).toBe('每分钟');
    const d = describeCron(parseCron('0 9 * * 1-5'));
    expect(d).toContain('9');
    expect(d).toContain('周一');
  });
});

// ============================================================
// cron 匹配
// ============================================================

describe('cron 匹配', () => {
  it('应匹配精确时刻', () => {
    const c = parseCron('30 9 * * *');
    // 直接构造本地时间
    const d = new Date(2026, 9, 20, 9, 30); // 2026-10-20 09:30 本地
    expect(matchesCron(c, d)).toBe(true);

    const d2 = new Date(2026, 9, 20, 9, 31);
    expect(matchesCron(c, d2)).toBe(false);
  });

  it('day-of-month 与 day-of-week 双受限时应为 OR', () => {
    const c = parseCron('0 0 1 * 1'); // 每月1号 或 每周一
    // 2026-10-01 是周四
    const firstOfMonth = new Date(2026, 9, 1, 0, 0);
    expect(matchesCron(c, firstOfMonth)).toBe(true);

    // 找一个周一
    const monday = new Date(2026, 9, 5, 0, 0); // 2026-10-05 周一
    expect(monday.getDay()).toBe(1);
    expect(matchesCron(c, monday)).toBe(true);
  });

  it('只有 day-of-week 受限时应为 AND', () => {
    const c = parseCron('0 0 * * 1'); // 每个周一
    const monday = new Date(2026, 9, 5, 0, 0);
    expect(matchesCron(c, monday)).toBe(true);

    const tuesday = new Date(2026, 9, 6, 0, 0);
    expect(matchesCron(c, tuesday)).toBe(false);
  });

  it('应按时区匹配', () => {
    // 北京时间 2026-10-20 09:00 = UTC 2026-10-20 01:00
    const utcDate = new Date('2026-10-20T01:00:00Z');
    const c = parseCron('0 9 * * *');

    expect(matchesCronAt(c, utcDate, 'Asia/Shanghai')).toBe(true);
    expect(matchesCronAt(c, utcDate, 'UTC')).toBe(false);
  });

  it('toZonedDate 应正确转换', () => {
    const utc = new Date('2026-10-20T01:00:00Z');
    const bj = toZonedDate(utc, 'Asia/Shanghai');
    expect(bj.getHours()).toBe(9);
    expect(bj.getMinutes()).toBe(0);
  });
});

// ============================================================
// 下次执行时间
// ============================================================

describe('nextRunAt', () => {
  it('应算出下一个匹配时刻', () => {
    const c = parseCron('0 9 * * *');
    const from = new Date('2026-10-20T00:00:00Z'); // 北京 08:00
    const next = nextRunAt(c, from, 'Asia/Shanghai');
    expect(next).toBeDefined();
    // 应该是北京 09:00 = UTC 01:00
    expect(next!.toISOString()).toBe('2026-10-20T01:00:00.000Z');
  });

  it('若今天已过则应算到明天', () => {
    const c = parseCron('0 9 * * *');
    const from = new Date('2026-10-20T02:00:00Z'); // 北京 10:00（已过 9 点）
    const next = nextRunAt(c, from, 'Asia/Shanghai');
    expect(next!.toISOString()).toBe('2026-10-21T01:00:00.000Z');
  });

  it('每周一 9 点应算到下周一', () => {
    const c = parseCron('0 9 * * 1');
    // 2026-10-20 是周二
    const from = new Date('2026-10-20T00:00:00Z');
    const next = nextRunAt(c, from, 'Asia/Shanghai');
    // 下周一 2026-10-26 09:00 北京 = UTC 01:00
    expect(next!.toISOString()).toBe('2026-10-26T01:00:00.000Z');
  });

  it('不可能的时间应返回 undefined', () => {
    const c = parseCron('0 0 30 2 *'); // 2月30日不存在
    const from = new Date('2026-01-01T00:00:00Z');
    const next = nextRunAt(c, from, 'Asia/Shanghai', 400);
    expect(next).toBeUndefined();
  });

  it('每分钟表达式应返回下一分钟', () => {
    const c = parseCron('* * * * *');
    const from = new Date('2026-10-20T00:00:00Z');
    const next = nextRunAt(c, from, 'Asia/Shanghai');
    expect(next!.getTime() - from.getTime()).toBe(60_000);
  });
});

// ============================================================
// 峰谷错峰
// ============================================================

describe('峰谷错峰', () => {
  it('高峰时刻应推迟到午休', () => {
    // 北京 2026-10-20（周二）10:30 = UTC 02:30
    const peak = new Date('2026-10-20T02:30:00Z');
    expect(describeTimeSlot(peak)).toContain('高峰');

    const shifted = shiftOutOfPeak(peak);
    const bj = toZonedDate(shifted, 'Asia/Shanghai');
    expect(bj.getHours()).toBe(12);
    expect(bj.getMinutes()).toBe(0);
  });

  it('下午高峰应推迟到 18:00', () => {
    // 北京 15:00 = UTC 07:00
    const peak = new Date('2026-10-20T07:00:00Z');
    const shifted = shiftOutOfPeak(peak);
    const bj = toZonedDate(shifted, 'Asia/Shanghai');
    expect(bj.getHours()).toBe(18);
  });

  it('空闲时刻不应变动', () => {
    // 北京 20:00 = UTC 12:00
    const idle = new Date('2026-10-20T12:00:00Z');
    const shifted = shiftOutOfPeak(idle);
    expect(shifted.getTime()).toBe(idle.getTime());
  });

  it('周末不应错峰', () => {
    // 2026-10-24 周六 北京 10:00 = UTC 02:00
    const weekend = new Date('2026-10-24T02:00:00Z');
    expect(describeTimeSlot(weekend)).toContain('空闲');
    expect(shiftOutOfPeak(weekend).getTime()).toBe(weekend.getTime());
  });

  it('adjustForCost 关闭时应原样返回', () => {
    const peak = new Date('2026-10-20T02:30:00Z');
    expect(adjustForCost(peak, false).getTime()).toBe(peak.getTime());
    expect(adjustForCost(peak, true).getTime()).not.toBe(peak.getTime());
  });
});

// ============================================================
// 触发器级错峰开关
// ============================================================

describe('触发器级 costSensitive', () => {
  it('costSensitive: false 的触发器不应被错峰', async () => {
    const service = new BotService({}, {
      ...DEFAULT_CONFIG,
      homeDir: tmpRoot,
      costSensitiveScheduling: true,
    });
    const bot = await service.create({ name: 'T', role: 'r' });

    const routine: Routine = validateRoutine({
      apiVersion: 'dsh-bot/v1',
      kind: 'Routine',
      metadata: { id: 'strict', name: '严格', version: 1 },
      spec: {
        triggers: [
          {
            type: 'cron',
            expression: '0 9 * * 1-5',
            timezone: 'Asia/Shanghai',
            costSensitive: false, // ⭐ 不允许错峰
          },
        ],
        params: {},
        steps: [{ id: 'a', type: 'llm', prompt: 'hi' }],
      },
    });
    await service.saveRoutine(bot.id, routine);

    const list = await service.scheduler().upcoming();
    expect(list).toHaveLength(1);
    expect(list[0].nextRunShiftsTo).toBeUndefined(); // 不推迟
  });

  it('costSensitive: true 的触发器应被错峰', async () => {
    const service = new BotService({}, {
      ...DEFAULT_CONFIG,
      homeDir: tmpRoot,
      costSensitiveScheduling: false, // 全局关闭
    });
    const bot = await service.create({ name: 'T', role: 'r' });

    const routine: Routine = validateRoutine({
      apiVersion: 'dsh-bot/v1',
      kind: 'Routine',
      metadata: { id: 'lax', name: '宽松', version: 1 },
      spec: {
        triggers: [
          {
            type: 'cron',
            expression: '0 9 * * 1-5',
            timezone: 'Asia/Shanghai',
            costSensitive: true, // ⭐ 触发器级开启
          },
        ],
        params: {},
        steps: [{ id: 'a', type: 'llm', prompt: 'hi' }],
      },
    });
    await service.saveRoutine(bot.id, routine);

    const list = await service.scheduler().upcoming();
    expect(list).toHaveLength(1);
    // 9:00 是高峰，应显示推迟到 12:00
    expect(list[0].nextRunShiftsTo).toBeDefined();
  });

  it('未设置时跟随全局配置', async () => {
    const service = new BotService({}, {
      ...DEFAULT_CONFIG,
      homeDir: tmpRoot,
      costSensitiveScheduling: false,
    });
    const bot = await service.create({ name: 'T', role: 'r' });

    const routine: Routine = validateRoutine({
      apiVersion: 'dsh-bot/v1',
      kind: 'Routine',
      metadata: { id: 'inherit', name: '继承', version: 1 },
      spec: {
        triggers: [{ type: 'cron', expression: '0 9 * * 1-5', timezone: 'Asia/Shanghai' }],
        params: {},
        steps: [{ id: 'a', type: 'llm', prompt: 'hi' }],
      },
    });
    await service.saveRoutine(bot.id, routine);

    const list = await service.scheduler().upcoming();
    expect(list[0].nextRunShiftsTo).toBeUndefined(); // 全局关，不推迟
  });

  it('costSensitive 应能持久化并读回', async () => {
    const service = new BotService({}, { ...DEFAULT_CONFIG, homeDir: tmpRoot });
    const bot = await service.create({ name: 'T', role: 'r' });

    const routine: Routine = validateRoutine({
      apiVersion: 'dsh-bot/v1',
      kind: 'Routine',
      metadata: { id: 'persist-cs', name: '持久化', version: 1 },
      spec: {
        triggers: [
          { type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai', costSensitive: false },
        ],
        params: {},
        steps: [{ id: 'a', type: 'llm', prompt: 'hi' }],
      },
    });
    await service.saveRoutine(bot.id, routine);

    const got = await service.getRoutine(bot.id, 'persist-cs');
    expect(got.spec.triggers[0].costSensitive).toBe(false);
  });
});

// ============================================================
// 调度器
// ============================================================

describe('Scheduler', () => {
  let service: BotService;
  let botId: string;

  async function setupRoutine(botId: string, id: string, cron: string) {
    const routine: Routine = validateRoutine({
      apiVersion: 'dsh-bot/v1',
      kind: 'Routine',
      metadata: { id, name: `流程${id}`, version: 1 },
      spec: {
        triggers: [{ type: 'cron', expression: cron, timezone: 'Asia/Shanghai' }],
        params: {},
        steps: [{ id: 'a', type: 'llm', prompt: 'hi' }],
      },
    });
    await service.saveRoutine(botId, routine);
  }

  beforeEach(async () => {
    // ⚠️ 必须关掉错峰调度。
    //    DEFAULT_CONFIG.costSensitiveScheduling 是 true，
    //    如果测试跑在北京高峰时段（工作日 9-12 / 14-18），
    //    触发会被挪到空闲时段，"应该触发"的用例就会全挂。
    //    测试结果绝不能依赖运行时刻——这里显式钉死。
    service = new BotService({}, {
      ...DEFAULT_CONFIG,
      homeDir: tmpRoot,
      costSensitiveScheduling: false,
    });
    const bot = await service.create({ name: '定时机', role: '按时干活' });
    botId = bot.id;
  });

  it('cron 到期时应触发', async () => {
    await setupRoutine(botId, 'every-min', '* * * * *');

    const fires = await service.schedulerTick();

    expect(fires.length).toBeGreaterThan(0);
    expect(fires[0].routineId).toBe('every-min');
  });

  it('同一分钟不应重复触发', async () => {
    await setupRoutine(botId, 'once', '* * * * *');

    const first = await service.schedulerTick();
    const second = await service.schedulerTick();

    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBe(0); // 去重生效
  });

  it('未到期的任务不应触发', async () => {
    // 只在 3:00 触发；当前是 20:00
    await setupRoutine(botId, 'early', '0 3 * * *');
    const fires = await service.schedulerTick();
    expect(fires).toHaveLength(0);
  });

  it('应通过 onFire 回调执行任务', async () => {
    await setupRoutine(botId, 'cb', '* * * * *');

    const fired: string[] = [];
    await service.schedulerTick(async (f) => {
      // goal 触发的 fire 没有 routineId；这里注册的都是 routine
      fired.push(f.routineId!);
    });

    expect(fired).toContain('cb');
  });

  it('onFire 抛错不应中断其它任务', async () => {
    await setupRoutine(botId, 'a', '* * * * *');
    await setupRoutine(botId, 'b', '* * * * *');

    const fired: string[] = [];
    await service.schedulerTick(async (f) => {
      if (f.routineId) fired.push(f.routineId);
      if (f.routineId === 'a') throw new Error('故意失败');
    });

    expect(fired).toContain('b'); // b 仍然执行了
  });

  it('manual 触发的流程不应被调度', async () => {
    const routine: Routine = validateRoutine({
      apiVersion: 'dsh-bot/v1',
      kind: 'Routine',
      metadata: { id: 'manual-only', name: '手动', version: 1 },
      spec: {
        triggers: [{ type: 'manual' }],
        params: {},
        steps: [{ id: 'a', type: 'llm', prompt: 'hi' }],
      },
    });
    await service.saveRoutine(botId, routine);

    const fires = await service.schedulerTick();
    expect(fires).toHaveLength(0);
  });

  it('upcoming 应列出下次执行时间', async () => {
    await setupRoutine(botId, 'daily', '0 9 * * *');
    const list = await service.scheduler().upcoming();

    expect(list.length).toBeGreaterThan(0);
    expect(list[0].routineId).toBe('daily');
    expect(list[0].nextRunAt).toBeDefined();
  });

  it('非法 cron 的流程应被跳过而不崩溃', async () => {
    // 直接写一个非法的 yaml（绕过校验）
    const dir = path.join(tmpRoot, 'bots', botId, 'routines');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, 'bad.yaml'),
      `apiVersion: dsh-bot/v1
kind: Routine
metadata:
  id: bad
  name: 坏的
spec:
  triggers:
    - type: cron
      expression: "not a cron"
  steps:
    - id: a
      type: llm
      prompt: hi
`,
      'utf8',
    );

    // 不应崩溃
    const fires = await service.schedulerTick();
    expect(Array.isArray(fires)).toBe(true);
  });
});

// ============================================================
// 心跳
// ============================================================

describe('心跳与休眠检测', () => {
  it('首次心跳不应报休眠', async () => {
    const sched = new Scheduler(
      { homeDir: tmpRoot } as any,
      tmpRoot,
      { tickMs: 30_000 },
    );
    const r = await sched.beat(new Date());
    expect(r.wokeFromSleep).toBe(false);
  });

  it('正常间隔不应报休眠', async () => {
    const sched = new Scheduler({ homeDir: tmpRoot } as any, tmpRoot, {
      tickMs: 30_000,
      missedBeatThreshold: 4,
    });
    const t0 = new Date('2026-10-20T12:00:00Z');
    await sched.beat(t0);

    const t1 = new Date(t0.getTime() + 30_000);
    const r = await sched.beat(t1);
    expect(r.wokeFromSleep).toBe(false);
  });

  it('长时间无心跳应报休眠', async () => {
    const sched = new Scheduler({ homeDir: tmpRoot } as any, tmpRoot, {
      tickMs: 30_000,
      missedBeatThreshold: 4,
    });
    const t0 = new Date('2026-10-20T12:00:00Z');
    await sched.beat(t0);

    // 隔了 1 小时
    const t1 = new Date(t0.getTime() + 3600_000);
    const r = await sched.beat(t1);
    expect(r.wokeFromSleep).toBe(true);
    expect(r.gapMs).toBeGreaterThan(3600_000 - 1000);
  });

  it('heartbeatStatus 应报告是否过期', async () => {
    const sched = new Scheduler({ homeDir: tmpRoot } as any, tmpRoot, {
      tickMs: 30_000,
      missedBeatThreshold: 4,
    });
    await sched.beat(new Date('2026-10-20T12:00:00Z'));

    const fresh = await sched.heartbeatStatus(new Date('2026-10-20T12:00:20Z'));
    expect(fresh.isStale).toBe(false);

    const stale = await sched.heartbeatStatus(new Date('2026-10-20T13:00:00Z'));
    expect(stale.isStale).toBe(true);
  });

  it('状态应持久化到磁盘', async () => {
    const sched1 = new Scheduler({ homeDir: tmpRoot } as any, tmpRoot);
    await sched1.beat(new Date('2026-10-20T12:00:00Z'));

    // 新建实例应能读到
    const sched2 = new Scheduler({ homeDir: tmpRoot } as any, tmpRoot);
    const status = await sched2.heartbeatStatus(new Date('2026-10-20T12:00:10Z'));
    expect(status.lastBeatAt).toBe('2026-10-20T12:00:00.000Z');
  });
});

// ============================================================
// 错峰推迟必须真的执行（P0-1 回归）
//
// 修复前：高峰命中 → 只记 lastFired 就 continue，没有任何东西
// 记住「推迟到 12:00 要执行」；12:00 的 tick 不匹配 9 点的 cron，
// 任务被永久吞掉。upcoming() 还显示「已错峰」——假承诺。
// ============================================================

describe('错峰推迟的任务必须真的执行', () => {
  // 北京 2026-10-20（周二）9:00 = UTC 01:00 —— 工作日高峰
  const PEAK_9 = new Date('2026-10-20T01:00:00Z');
  // 北京 12:00 = UTC 04:00 —— 错峰推迟到的空闲时刻
  const IDLE_12 = new Date('2026-10-20T04:00:00Z');
  // 北京 13:00 = UTC 05:00 —— 睡过头后的迟到时刻
  const LATE_13 = new Date('2026-10-20T05:00:00Z');

  let service: BotService;
  let botId: string;

  async function setupShiftedRoutine(id = 'shift-me') {
    const routine: Routine = validateRoutine({
      apiVersion: 'dsh-bot/v1',
      kind: 'Routine',
      metadata: { id, name: '错峰流程', version: 1 },
      spec: {
        triggers: [
          { type: 'cron', expression: '0 9 * * 1-5', timezone: 'Asia/Shanghai' },
        ],
        params: {},
        steps: [{ id: 'a', type: 'llm', prompt: 'hi' }],
      },
    });
    await service.saveRoutine(botId, routine);
  }

  beforeEach(async () => {
    service = new BotService({}, {
      ...DEFAULT_CONFIG,
      homeDir: tmpRoot,
      costSensitiveScheduling: true, // ⭐ 本组测试专测错峰路径
    });
    const bot = await service.create({ name: '错峰机', role: '省钱' });
    botId = bot.id;
  });

  it('高峰命中：本轮不触发，但应入队（而非吞掉）', async () => {
    await setupShiftedRoutine();
    const sched = service.scheduler();

    const fires = await sched.tick(PEAK_9);
    expect(fires).toHaveLength(0);

    const state = await sched.loadState();
    expect(state.pending).toHaveLength(1);
    expect(state.pending[0].actualAt).toBe(IDLE_12.toISOString());
  });

  it('到推迟时刻：必须触发，shifted=true 且时刻正确', async () => {
    await setupShiftedRoutine();
    const sched = service.scheduler();
    await sched.tick(PEAK_9);

    const fires = await sched.tick(IDLE_12);
    expect(fires).toHaveLength(1);
    expect(fires[0].routineId).toBe('shift-me');
    expect(fires[0].shifted).toBe(true);
    expect(fires[0].plannedAt).toBe(PEAK_9.toISOString());
    expect(fires[0].actualAt).toBe(IDLE_12.toISOString());
  });

  it('执行后队列清空，同分钟不重复', async () => {
    await setupShiftedRoutine();
    const sched = service.scheduler();
    await sched.tick(PEAK_9);

    await sched.tick(IDLE_12);
    const again = await sched.tick(IDLE_12);
    expect(again).toHaveLength(0);

    const state = await sched.loadState();
    expect(state.pending).toHaveLength(0);
  });

  it('迟到（机器睡过 12:00）也应执行，不许静默丢弃', async () => {
    await setupShiftedRoutine();
    const sched = service.scheduler();
    await sched.tick(PEAK_9);

    const fires = await sched.tick(LATE_13);
    expect(fires).toHaveLength(1);
    expect(fires[0].shifted).toBe(true);
  });

  it('重启后队列仍在（pending 持久化）', async () => {
    await setupShiftedRoutine();
    await service.scheduler().tick(PEAK_9);

    // 模拟重启：全新 Scheduler 实例（无内存缓存）
    const sched2 = new Scheduler(service, tmpRoot);
    const state = await sched2.loadState();
    expect(state.pending).toHaveLength(1);

    const fires = await sched2.tick(IDLE_12);
    expect(fires).toHaveLength(1);
  });

  it('排期后流程被删除：队列条目作废，不触发', async () => {
    await setupShiftedRoutine('doomed');
    const sched = service.scheduler();
    await sched.tick(PEAK_9);

    await service.removeRoutine(botId, 'doomed');

    const fires = await sched.tick(IDLE_12);
    expect(fires).toHaveLength(0);
    const state = await sched.loadState();
    expect(state.pending).toHaveLength(0);
  });

  it('目标节奏的错峰推迟同样必须执行；目标停用后作废', async () => {
    const goal = createGoal(
      'goal_shift',
      { description: '每4小时报告', cadence: '0 9 * * 1-5' },
      PEAK_9.toISOString(),
    );
    await service.saveGoal(botId, goal);

    const sched = service.scheduler();
    expect(await sched.tick(PEAK_9)).toHaveLength(0);

    // 目标停用（如进入待确认）→ 队列条目作废
    const fresh = await service.getGoal(botId);
    await service.saveGoal(botId, { ...fresh!, status: 'pending_confirmation' });
    expect(await sched.tick(IDLE_12)).toHaveLength(0);
    expect((await sched.loadState()).pending).toHaveLength(0);

    // 恢复 active 后，下一个高峰重新入队并执行
    const active = await service.getGoal(botId);
    await service.saveGoal(botId, { ...active!, status: 'active' });
    await sched.tick(new Date('2026-10-21T01:00:00Z')); // 周三 9:00
    const fires = await sched.tick(new Date('2026-10-21T04:00:00Z')); // 12:00
    expect(fires).toHaveLength(1);
    expect(fires[0].source).toBe('goal');
    expect(fires[0].shifted).toBe(true);
  });
});

// ============================================================
// 时区无关性（P1-4 回归）
//
// 修复前：nextRunAt 用宿主本地 setHours 构造候选再按目标时区复核，
// 宿主时区 ≠ cron 时区时永远返回 undefined（开发机在 +8 从没暴露）。
// 现在构造走目标时区（fromZonedWall），与宿主时区无关。
// ============================================================

describe('时区无关性', () => {
  it('fromZonedWall 应与 toZonedDate 互逆（含 DST 时区）', () => {
    const zones = ['Asia/Shanghai', 'America/New_York', 'Europe/London', 'UTC'];
    // 注意不包含「不存在的时间」（如美国夏令时切换日 2026-03-08 02:30，
    // 当天 2:00→3:00 直接跳过）：这类墙钟没有对应时刻，fromZonedWall
    // 会前移到最近的有效时刻（与 cron 引擎对 spring-forward 的行为一致）。
    const cases: Array<[number, number, number, number, number]> = [
      [2026, 10, 20, 9, 0],
      [2026, 3, 8, 1, 30],  // 美国夏令时切换日（切换前的 1:30 存在）
      [2026, 11, 1, 0, 5],  // 冬令时切换附近
      [2026, 6, 15, 23, 59],
    ];
    for (const tz of zones) {
      for (const [y, mo, d, h, mi] of cases) {
        const instant = fromZonedWall(tz, y, mo, d, h, mi);
        const wall = toZonedDate(instant, tz);
        expect([wall.getFullYear(), wall.getMonth() + 1, wall.getDate(), wall.getHours(), wall.getMinutes()])
          .toEqual([y, mo, d, h, mi]);
      }
    }
  });

  it('nextRunAt 的结果在目标时区墙钟上应精确命中（不依赖宿主时区）', () => {
    // 工作日 9:00（Asia/Shanghai），从周日晚间算
    const c = parseCron('0 9 * * 1-5');
    const next = nextRunAt(c, new Date('2026-10-18T20:00:00Z'), 'Asia/Shanghai');
    expect(next).toBeDefined();
    const wall = toZonedDate(next!, 'Asia/Shanghai');
    expect(wall.getHours()).toBe(9);
    expect(wall.getMinutes()).toBe(0);
    expect([1, 2, 3, 4, 5]).toContain(wall.getDay()); // 周一到周五
    // 2026-10-18 是周日 → 下一个是周一 10-19
    expect(wall.getDate()).toBe(19);
  });

  it('纽约时区的 cron 在纽约墙钟上命中（宿主可为任意时区）', () => {
    const c = parseCron('30 14 * * *');
    const next = nextRunAt(c, new Date('2026-10-20T00:00:00Z'), 'America/New_York');
    expect(next).toBeDefined();
    const wall = toZonedDate(next!, 'America/New_York');
    expect(wall.getHours()).toBe(14);
    expect(wall.getMinutes()).toBe(30);
  });
});
