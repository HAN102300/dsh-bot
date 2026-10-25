/**
 * 成本感知调度（错峰）
 *
 * DeepSeek 的价格随时间变化：
 *   高峰时段（北京时间工作日 9-12 / 14-18）= 空闲时段的 2 倍
 *
 * 对于不紧急的定时任务，自动挪到空闲时段，成本直接减半。
 *
 * 实现要点：所有时间运算都基于"北京时间的墙上时间"，
 * 避免在 UTC 与本地时区之间反复换算导致偏移叠加。
 */

import { isPeakHour } from '../llm/bridge.js';
import { toZonedDate } from './cron.js';

/** 空闲时段的起点（北京时间小时） */
const IDLE_STARTS = [0, 12, 18];

/**
 * 如果给定时刻处于高峰，返回下一个空闲时段的起点；否则原样返回。
 *
 * 例（北京时间）：
 *   10:30（高峰）→ 12:00（午休开始）
 *   15:20（高峰）→ 18:00
 *   08:00（空闲）→ 08:00
 *   19:00（空闲）→ 19:00
 */
export function shiftOutOfPeak(date: Date): Date {
  if (!isPeakHour(date)) return date;

  // 取北京时间的墙上时间字段
  const bj = toZonedDate(date, 'Asia/Shanghai');
  const hour = bj.getHours();
  const minute = bj.getMinutes();
  const second = bj.getSeconds();

  // 找下一个空闲起点
  const targetHour = IDLE_STARTS.find((h) => h > hour);
  if (targetHour === undefined) {
    // 理论上不会发生（高峰只在 9-12 / 14-18），保守返回原值
    return date;
  }

  // 计算需要向前推进的毫秒数
  const deltaMinutes = (targetHour - hour) * 60 - minute;
  const deltaMs = deltaMinutes * 60_000 - second * 1000;

  return new Date(date.getTime() + deltaMs);
}

/**
 * 判断某个计划执行时刻是否应该因错峰而推迟。
 *
 * @param planned 原计划时刻
 * @param costSensitive 是否启用错峰
 * @returns 实际执行时刻
 */
export function adjustForCost(planned: Date, costSensitive: boolean): Date {
  if (!costSensitive) return planned;
  return shiftOutOfPeak(planned);
}

/** 人类可读的时段说明 */
export function describeTimeSlot(date: Date): string {
  const peak = isPeakHour(date);
  return peak ? '高峰（价格 2x）' : '空闲（价格 1x）';
}
