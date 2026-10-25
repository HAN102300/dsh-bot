/**
 * 调度器
 *
 * 职责：
 *   1. 每个 tick 扫描所有 Bot 的所有 Routine
 *   2. 判断是否有 cron 到期的
 *   3. 处理错峰（非紧急任务挪到空闲时段）
 *   4. 防止重复触发（同一分钟只跑一次）
 *   5. 心跳检测（桌面休眠告警）
 *
 * ⚠️ 重要限制：DSH Desktop 是桌面应用，机器休眠时调度器不工作。
 *    这不是 bug，是架构事实。方案：
 *      - UI 显示心跳，超阈值告警
 *      - 文档明示
 *      - v2.0 支持导出为系统服务
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import type { BotService } from '../service.js';
import type { RoutineMeta } from '../routine/schema.js';
import { parseCron, matchesCronAt, nextRunAt, type CronFields } from './cron.js';
import { adjustForCost } from './peak.js';

/** 调度状态（持久化，避免重启后重复触发） */
export interface ScheduleState {
  /** 上次 tick 时间 */
  lastTickAt?: string;
  /** 每个 routine 上次触发时刻：key = `${botId}/${routineId}` */
  lastFired: Record<string, string>;
  /**
   * 错峰推迟的待执行队列。
   *
   * ⚠️ 为什么必须有它（P0-1 教训）：被推迟的任务，其执行时刻
   * 不再匹配 cron（9 点的 cron 被挪到 12 点，12 点 tick 时
   * matchesCronAt 为 false）——没有这个队列，任务会被永久吞掉，
   * 而界面还显示"已错峰"。承诺的执行必须有真实的执行路径。
   */
  pending: PendingFire[];
  /** 心跳记录 */
  heartbeat: {
    lastBeatAt: string;
    /** 连续检测到的休眠次数 */
    missedBeats: number;
  };
}

/** 一条被错峰推迟、等待到点执行的任务 */
export interface PendingFire {
  /** 关联的 lastFired key（排期时已写入，防止重复排期） */
  key: string;
  botId: string;
  routineId?: string;
  goalId?: string;
  source: 'routine' | 'goal';
  plannedAt: string;
  actualAt: string;
  shiftMinutes: number;
}

/** 一次调度触发的记录 */
export interface ScheduledFire {
  botId: string;
  /** 例行流程 ID（goal 触发时为空） */
  routineId?: string;
  /** 目标 ID（routine 触发时为空） */
  goalId?: string;
  /** 触发来源，便于调用方分流 */
  source: 'routine' | 'goal';
  plannedAt: string;
  actualAt: string;
  /** 是否因错峰而推迟 */
  shifted: boolean;
  shiftMinutes: number;
}

export interface SchedulerOptions {
  /** 是否错峰 */
  costSensitive: boolean;
  /** 时区 */
  timeZone: string;
  /** tick 间隔（毫秒），用于心跳阈值计算 */
  tickMs: number;
  /** 连续错过多少次 tick 算休眠 */
  missedBeatThreshold: number;
}

export const DEFAULT_SCHEDULER_OPTIONS: SchedulerOptions = {
  costSensitive: true,
  timeZone: 'Asia/Shanghai',
  tickMs: 30_000,
  missedBeatThreshold: 4, // 4 * 30s = 2 分钟没心跳算休眠
};

const KEY_SEP = '/';

function schedKey(botId: string, routineId: string): string {
  return `${botId}${KEY_SEP}${routineId}`;
}

export class Scheduler {
  private statePath: string;
  private stateCache?: ScheduleState;
  private opts: SchedulerOptions;

  constructor(
    private readonly service: BotService,
    private readonly homeDir: string,
    options: Partial<SchedulerOptions> = {},
  ) {
    this.opts = { ...DEFAULT_SCHEDULER_OPTIONS, ...options };
    this.statePath = path.join(homeDir, 'scheduler-state.json');
  }

  // ---------- 状态持久化 ----------

  async loadState(): Promise<ScheduleState> {
    if (this.stateCache) return this.stateCache;
    try {
      const raw = await fsp.readFile(this.statePath, 'utf8');
      this.stateCache = JSON.parse(raw);
    } catch {
      this.stateCache = {
        lastFired: {},
        pending: [],
        heartbeat: { lastBeatAt: '', missedBeats: 0 },
      };
    }
    // 旧版本状态文件没有 pending 字段
    if (!this.stateCache!.pending) this.stateCache!.pending = [];
    return this.stateCache!;
  }

  async saveState(state: ScheduleState): Promise<void> {
    this.stateCache = state;
    await fsp.mkdir(path.dirname(this.statePath), { recursive: true });
    const tmp = `${this.statePath}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
    await fsp.rename(tmp, this.statePath);
  }

  // ---------- 心跳 ----------

  /**
   * 记录心跳，返回是否检测到休眠。
   *
   * 判据：两次 tick 之间的间隔远超 tickMs，说明进程被挂起了。
   */
  async beat(now: Date = new Date()): Promise<{ wokeFromSleep: boolean; gapMs: number }> {
    const state = await this.loadState();
    const last = state.heartbeat.lastBeatAt
      ? Date.parse(state.heartbeat.lastBeatAt)
      : undefined;

    let gapMs = 0;
    let wokeFromSleep = false;

    if (last !== undefined) {
      gapMs = now.getTime() - last;
      // 间隔超过阈值的 3 倍，认为休眠过
      wokeFromSleep = gapMs > this.opts.tickMs * this.opts.missedBeatThreshold * 3;
    }

    state.heartbeat = {
      lastBeatAt: now.toISOString(),
      missedBeats: wokeFromSleep
        ? state.heartbeat.missedBeats + 1
        : 0,
    };
    await this.saveState(state);

    return { wokeFromSleep, gapMs };
  }

  /** 读心跳状态 */
  async heartbeatStatus(now: Date = new Date()): Promise<{
    lastBeatAt?: string;
    staleMs: number;
    isStale: boolean;
    missedBeats: number;
  }> {
    const state = await this.loadState();
    const last = state.heartbeat.lastBeatAt;
    if (!last) {
      return { staleMs: 0, isStale: false, missedBeats: 0 };
    }
    const staleMs = now.getTime() - Date.parse(last);
    return {
      lastBeatAt: last,
      staleMs,
      isStale: staleMs > this.opts.tickMs * this.opts.missedBeatThreshold,
      missedBeats: state.heartbeat.missedBeats,
    };
  }

  // ---------- 核心 tick ----------

  /**
   * 执行一次调度扫描。
   *
   * @returns 本次触发的任务列表
   */
  async tick(now: Date = new Date()): Promise<ScheduledFire[]> {
    const state = await this.loadState();
    const fires: ScheduledFire[] = [];
    /** 需要移出 pending 的 key（已执行或已失效） */
    const consumedKeys = new Set<string>();

    const botIds = await this.listBotIds();

    for (const botId of botIds) {
      let metas: RoutineMeta[];
      try {
        metas = await this.service.listRoutines(botId);
      } catch {
        metas = [];
      }

      // ------------------------------------------------------
      // ① 先执行错峰队列里到期的任务（含本 Bot 的）。
      //
      // 这些任务在高峰时刻被推迟到这里；它们的执行时刻不再匹配
      // cron，必须由队列驱动，否则会被永久吞掉。
      // 迟到也执行（机器睡过了），静默丢弃比迟到更糟。
      // ------------------------------------------------------
      for (const p of state.pending) {
        if (p.botId !== botId) continue;
        if (Date.parse(p.actualAt) > now.getTime()) continue;

        consumedKeys.add(p.key);

        if (p.source === 'routine') {
          // 流程已被删除：这笔排期作废（不是错误，用户删了它）
          if (!metas.some((m) => m.id === p.routineId)) continue;
          fires.push(this.pendingToFire(p, true));
        } else {
          // 目标还必须是同一个、且仍 active（可能已被确认/驳回/换届）
          let goal;
          try {
            goal = await this.service.getGoal(botId);
          } catch {
            goal = undefined;
          }
          if (!goal || goal.id !== p.goalId || goal.status !== 'active') {
            continue;
          }
          fires.push(this.pendingToFire(p, true));
          try {
            await this.service.saveGoal(botId, {
              ...goal,
              lastFiredAt: p.actualAt,
            });
          } catch {
            /* 记不上不影响触发 */
          }
        }
      }

      // ------------------------------------------------------
      // ② 常规 cron 扫描（routine 触发器）
      // ------------------------------------------------------
      for (const meta of metas) {
        const cronTriggers = meta.triggers.filter(
          (t) => t.type === 'cron' && t.expression,
        );
        if (cronTriggers.length === 0) continue;

        for (const trigger of cronTriggers) {
          let cron: CronFields;
          try {
            cron = parseCron(trigger.expression!);
          } catch {
            continue; // 非法 cron 跳过
          }

          const tz = trigger.timezone ?? this.opts.timeZone;
          const key = `${schedKey(botId, meta.id)}:${trigger.expression}`;
          const lastFiredIso = state.lastFired[key];

          // 找到"应该触发"的时刻：从现在往前一分钟
          const dueAt = new Date(now.getTime());
          dueAt.setSeconds(0, 0);

          if (!matchesCronAt(cron, dueAt, tz)) continue;

          // 去重：同一分钟只触发一次
          if (lastFiredIso) {
            const lastMs = Date.parse(lastFiredIso);
            if (lastMs >= dueAt.getTime()) continue;
          }

          // 错峰：仅在允许时推迟
          // 优先级：触发器级 costSensitive > 全局配置
          const originalAt = dueAt;
          let actualAt = dueAt;
          let shifted = false;

          const allowShift =
            trigger.costSensitive !== undefined
              ? trigger.costSensitive
              : this.opts.costSensitive;

          if (allowShift) {
            actualAt = adjustForCost(dueAt, true);
            shifted = actualAt.getTime() !== dueAt.getTime();
          }

          // 若被推迟且还没到执行时刻：入队等待，到点必须执行
          if (shifted && actualAt.getTime() > now.getTime()) {
            // 记录已排期，避免下次 tick 重复判断
            state.lastFired[key] = dueAt.toISOString();
            state.pending.push({
              key,
              botId,
              routineId: meta.id,
              source: 'routine',
              plannedAt: originalAt.toISOString(),
              actualAt: actualAt.toISOString(),
              shiftMinutes: shifted
                ? Math.round((actualAt.getTime() - originalAt.getTime()) / 60_000)
                : 0,
            });
            continue;
          }

          state.lastFired[key] = dueAt.toISOString();
          fires.push({
            botId,
            routineId: meta.id,
            source: 'routine',
            plannedAt: originalAt.toISOString(),
            actualAt: actualAt.toISOString(),
            shifted,
            shiftMinutes: shifted
              ? Math.round((actualAt.getTime() - originalAt.getTime()) / 60_000)
              : 0,
          });
        }
      }

      // ------------------------------------------------------
      // ⭐ 带节奏的目标
      //
      // 这是「持续任务」真正能自动跑起来的地方。
      // 之前调度器只扫 routine，所以用户在目标里写的
      // 「每过 4 小时给我报告」永远不会被执行——
      // 目标只是一句愿望。这里补上。
      // ------------------------------------------------------
      let goal;
      try {
        goal = await this.service.getGoal(botId);
      } catch {
        goal = undefined;
      }

      if (goal?.cadence && goal.status === 'active') {
        let cron: CronFields | undefined;
        try {
          cron = parseCron(goal.cadence);
        } catch {
          cron = undefined; // 非法 cron 跳过，不影响其它 Bot
        }

        if (cron) {
          const tz = goal.cadenceTimezone ?? this.opts.timeZone;
          const key = `${schedKey(botId, `goal:${goal.id}`)}:${goal.cadence}`;

          const dueAt = new Date(now.getTime());
          dueAt.setSeconds(0, 0);

          const already =
            state.lastFired[key] ??
            (goal.lastFiredAt ? goal.lastFiredAt : undefined);
          const lastMs = already ? Date.parse(already) : 0;

          if (matchesCronAt(cron, dueAt, tz) && !(lastMs >= dueAt.getTime())) {
            // 目标节奏默认允许错峰（省钱），但 daily 类可由用户关掉，
            // 这里先统一按全局配置走
            const originalAt = dueAt;
            let actualAt = dueAt;
            let shifted = false;
            if (this.opts.costSensitive) {
              actualAt = adjustForCost(dueAt, true);
              shifted = actualAt.getTime() !== dueAt.getTime();
            }

            if (shifted && actualAt.getTime() > now.getTime()) {
              // 入队等待到点执行（见 PendingFire 注释）
              state.lastFired[key] = dueAt.toISOString();
              state.pending.push({
                key,
                botId,
                goalId: goal.id,
                source: 'goal',
                plannedAt: originalAt.toISOString(),
                actualAt: actualAt.toISOString(),
                shiftMinutes: Math.round(
                  (actualAt.getTime() - originalAt.getTime()) / 60_000,
                ),
              });
            } else {
              state.lastFired[key] = dueAt.toISOString();
              // 记回目标，供面板显示"上次自动执行"
              try {
                const fresh = await this.service.getGoal(botId);
                if (fresh && fresh.id === goal.id) {
                  await this.service.saveGoal(botId, {
                    ...fresh,
                    lastFiredAt: dueAt.toISOString(),
                  });
                }
              } catch {
                /* 记不上不影响触发 */
              }

              fires.push({
                botId,
                goalId: goal.id,
                source: 'goal',
                plannedAt: originalAt.toISOString(),
                actualAt: actualAt.toISOString(),
                shifted,
                shiftMinutes: shifted
                  ? Math.round((actualAt.getTime() - originalAt.getTime()) / 60_000)
                  : 0,
              });
            }
          }
        }
      }
    }

    // 清掉本轮已处理（执行或作废）的 pending 条目，一次性落盘
    if (consumedKeys.size > 0) {
      state.pending = state.pending.filter((p) => !consumedKeys.has(p.key));
    }
    state.lastTickAt = now.toISOString();
    await this.saveState(state);

    return fires;
  }

  /** 把 pending 条目转成触发记录（从队列里出来的必然是错峰过的） */
  private pendingToFire(p: PendingFire, shifted: boolean): ScheduledFire {
    return {
      botId: p.botId,
      routineId: p.routineId,
      goalId: p.goalId,
      source: p.source,
      plannedAt: p.plannedAt,
      actualAt: p.actualAt,
      shifted,
      shiftMinutes: p.shiftMinutes,
    };
  }

  private async listBotIds(): Promise<string[]> {
    const botsRoot = path.join(this.service.homeDir, 'bots');
    try {
      const dirs = await fsp.readdir(botsRoot);
      return dirs.filter((d) => d.startsWith('bot_'));
    } catch {
      return [];
    }
  }

  // ---------- 查询 ----------

  /** 列出所有已排期的任务及其下次执行时间 */
  async upcoming(
    now: Date = new Date(),
    limit = 20,
  ): Promise<
    Array<{
      botId: string;
      botName: string;
      routineId: string;
      routineName: string;
      expression: string;
      timeZone: string;
      nextRunAt?: string;
      nextRunShiftsTo?: string;
    }>
  > {
    const out: any[] = [];
    const botIds = await this.listBotIds();

    for (const botId of botIds) {
      let bot;
      try {
        bot = await this.service.get(botId);
      } catch {
        continue;
      }

      let metas;
      try {
        metas = await this.service.listRoutines(botId);
      } catch {
        continue;
      }

      for (const meta of metas) {
        for (const trigger of meta.triggers) {
          if (trigger.type !== 'cron' || !trigger.expression) continue;
          let cron: CronFields;
          try {
            cron = parseCron(trigger.expression);
          } catch {
            continue;
          }
          const tz = trigger.timezone ?? this.opts.timeZone;
          const next = nextRunAt(cron, now, tz);

          const allowShift =
            trigger.costSensitive !== undefined
              ? trigger.costSensitive
              : this.opts.costSensitive;
          const shifted =
            next && allowShift ? adjustForCost(next, true) : undefined;

          out.push({
            botId,
            botName: bot.name,
            routineId: meta.id,
            routineName: meta.name,
            expression: trigger.expression,
            timeZone: tz,
            nextRunAt: next?.toISOString(),
            nextRunShiftsTo:
              shifted && shifted.getTime() !== next?.getTime()
                ? shifted.toISOString()
                : undefined,
          });
        }
      }
    }

    out.sort((a, b) => (a.nextRunAt ?? '').localeCompare(b.nextRunAt ?? ''));
    return out.slice(0, limit);
  }

  /** 清空调度状态（用于测试或重置） */
  async reset(): Promise<void> {
    this.stateCache = undefined;
    await fsp.rm(this.statePath, { force: true });
  }
}
