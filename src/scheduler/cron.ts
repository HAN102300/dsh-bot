/**
 * cron 表达式解析
 *
 * 支持标准 5 段：分 时 日 月 周
 *   ┌─ 分钟 (0-59)
 *   │ ┌─ 小时 (0-23)
 *   │ │ ┌─ 日 (1-31)
 *   │ │ │ ┌─ 月 (1-12)
 *   │ │ │ │ ┌─ 周 (0-7，0 和 7 都表示周日)
 *   * * * * *
 *
 * 语法：
 *   *        任意值
 *   * / n    每 n 个单位（无空格）
 *   a-b      范围
 *   a-b/n    范围内每 n 个
 *   a,b,c    枚举
 *   5        精确值
 *
 * 日与周的关系遵循 Vixie cron 传统：
 *   两者都受限时，只要**其中一个**匹配即触发（OR 语义）
 *   否则 AND 语义
 */

export interface CronFields {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
  /** 原始表达式 */
  expression: string;
  /** day-of-month 是否受限（非 *） */
  domRestricted: boolean;
  /** day-of-week 是否受限（非 *） */
  dowRestricted: boolean;
}

const RANGES: Record<string, [number, number]> = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 7],
};

/** 解析单段 */
function parseField(
  raw: string,
  name: string,
  min: number,
  max: number,
): { values: number[]; restricted: boolean } {
  const field = raw.trim();
  if (field === '') {
    throw new Error(`cron 字段 ${name} 不能为空`);
  }

  const restricted = field !== '*' && field !== '*/1';
  const out = new Set<number>();

  for (const part of field.split(',')) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    // 步长：*/n 或 a-b/n
    const stepMatch = trimmed.match(/^(.+)\/(\d+)$/);
    let base = trimmed;
    let step = 1;

    if (stepMatch) {
      base = stepMatch[1].trim();
      step = Number(stepMatch[2]);
      if (!Number.isInteger(step) || step <= 0) {
        throw new Error(`cron 步长必须是正整数：${trimmed}`);
      }
    }

    let from: number;
    let to: number;

    if (base === '*') {
      from = min;
      to = max;
    } else if (base.includes('-')) {
      const [a, b] = base.split('-').map((s) => Number(s.trim()));
      if (!Number.isInteger(a) || !Number.isInteger(b)) {
        throw new Error(`cron 范围格式错误：${trimmed}`);
      }
      from = a;
      to = b;
    } else {
      const v = Number(base);
      if (!Number.isInteger(v)) {
        throw new Error(`cron 值不是整数：${trimmed}`);
      }
      from = v;
      to = stepMatch ? max : v;
    }

    if (from < min || to > max || from > to) {
      throw new Error(
        `cron 字段 ${name} 超出范围 [${min}, ${max}]：${trimmed}`,
      );
    }

    for (let v = from; v <= to; v += step) {
      // dayOfWeek 的 7 归一化为 0（周日）
      out.add(name === 'dayOfWeek' && v === 7 ? 0 : v);
    }
  }

  if (out.size === 0) {
    throw new Error(`cron 字段 ${name} 没有有效值`);
  }

  return { values: [...out].sort((a, b) => a - b), restricted };
}

/** 解析 cron 表达式 */
export function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(
      `cron 必须是 5 段（分 时 日 月 周），收到 ${parts.length} 段：${expression}`,
    );
  }

  const [minRaw, hourRaw, domRaw, monthRaw, dowRaw] = parts;

  const minute = parseField(minRaw, 'minute', RANGES.minute[0], RANGES.minute[1]);
  const hour = parseField(hourRaw, 'hour', RANGES.hour[0], RANGES.hour[1]);
  const dom = parseField(
    domRaw,
    'dayOfMonth',
    RANGES.dayOfMonth[0],
    RANGES.dayOfMonth[1],
  );
  const month = parseField(monthRaw, 'month', RANGES.month[0], RANGES.month[1]);
  const dow = parseField(
    dowRaw,
    'dayOfWeek',
    RANGES.dayOfWeek[0],
    RANGES.dayOfWeek[1],
  );

  return {
    minute: minute.values,
    hour: hour.values,
    dayOfMonth: dom.values,
    month: month.values,
    dayOfWeek: dow.values,
    expression: expression.trim(),
    domRestricted: dom.restricted,
    dowRestricted: dow.restricted,
  };
}

/**
 * 判断某个时刻是否匹配 cron。
 *
 * @param cron 已解析的 cron
 * @param date 待判断的时刻（会按其本地时间字段比较，调用方负责时区转换）
 */
export function matchesCron(cron: CronFields, date: Date): boolean {
  if (!cron.minute.includes(date.getMinutes())) return false;
  if (!cron.hour.includes(date.getHours())) return false;
  if (!cron.month.includes(date.getMonth() + 1)) return false;

  const domOk = cron.dayOfMonth.includes(date.getDate());
  const dowOk = cron.dayOfWeek.includes(date.getDay());

  // Vixie cron 语义：两者都受限时用 OR，否则用 AND
  if (cron.domRestricted && cron.dowRestricted) {
    return domOk || dowOk;
  }
  return domOk && dowOk;
}

/**
 * 按指定时区取得"本地字段"的 Date 代理。
 *
 * ⚠️ 关键：必须用 Date.UTC 构造，让返回的 Date 在**本地时区**下的
 * 墙上时间恰好等于目标时区的墙上时间。这样 getHours() 等返回的是
 * 目标时区的值。
 *
 * 注意：不能用 new Date(string) —— 那会按本地时区重新解释，
 * 造成偏移叠加（本机 +8 时区会多出 8 小时）。
 */
export function toZonedDate(date: Date, timeZone: string): Date {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(date);

    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    let hour = get('hour');
    if (hour === 24) hour = 0; // 某些实现在午夜返回 24

    // 目标时区的墙上时间（以 UTC 字段承载）
    const wallAsUtc = Date.UTC(
      get('year'),
      get('month') - 1,
      get('day'),
      hour,
      get('minute'),
      get('second'),
    );

    // 抵消本地时区偏移：让 getHours() 等返回目标时区的墙上时间。
    // localOffsetMs > 0 表示本地在东半球（如 +8）。
    const localOffsetMs = -new Date(wallAsUtc).getTimezoneOffset() * 60_000;
    return new Date(wallAsUtc - localOffsetMs);
  } catch {
    // 时区无效时降级为本地时间
    return date;
  }
}

/** 判断某时刻是否匹配 cron（带时区） */
export function matchesCronAt(
  cron: CronFields,
  date: Date,
  timeZone = 'Asia/Shanghai',
): boolean {
  return matchesCron(cron, toZonedDate(date, timeZone));
}

/**
 * toZonedDate 的逆运算：给定目标时区的墙上时间字段，构造真实的 UTC 时刻。
 *
 * 为什么必须有它（P1-4 教训）：nextRunAt 之前用宿主本地的
 * `setHours(h, m)` 构造候选时刻，再用目标时区复核——宿主时区 ≠
 * cron 时区时复核永假，「下次执行时间」永远算不出来（开发机在 +8
 * 所以从没暴露）。构造候选必须走目标时区，宿主时区不允许参与。
 *
 * 用两次迭代消化 DST 偏移；固定偏移时区（如 +8）一次收敛。
 */
export function fromZonedWall(
  timeZone: string,
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): Date {
  const want = Date.UTC(year, month - 1, day, hour, minute, 0);
  let ts = want; // 先假设零偏移
  for (let i = 0; i < 3; i++) {
    const wall = toZonedDate(new Date(ts), timeZone);
    const packed = Date.UTC(
      wall.getFullYear(),
      wall.getMonth(),
      wall.getDate(),
      wall.getHours(),
      wall.getMinutes(),
      wall.getSeconds(),
    );
    if (packed === want) break;
    ts = want - (packed - ts);
  }
  return new Date(ts);
}

/**
 * 计算下一次触发时刻。
 *
 * 从 from 之后开始扫描，最多找 maxDays 天。
 *
 * 性能优化：
 *   - 先按"天"跳，只在天匹配时才逐分钟扫描
 *   - 避免每分钟都做一次时区转换（这是瓶颈）
 */
export function nextRunAt(
  cron: CronFields,
  from: Date,
  timeZone = 'Asia/Shanghai',
  maxDays = 400,
): Date | undefined {
  // 从下一分钟开始（秒数归零）
  const start = new Date(from.getTime());
  start.setSeconds(0, 0);
  start.setMinutes(start.getMinutes() + 1);

  // ⭐ 日历推进以「目标时区的日历日」为单位（用 UTC 字段承载纯日历运算）。
  //    之前以宿主本地日推进 + 宿主 setHours 构造候选，宿主时区 ≠ cron
  //    时区时永远找不到触发时刻。
  const z0 = toZonedDate(start, timeZone);
  let calDay = Date.UTC(z0.getFullYear(), z0.getMonth(), z0.getDate());

  const hours = [...cron.hour].sort((a, b) => a - b);
  const minutes = [...cron.minute].sort((a, b) => a - b);

  for (let day = 0; day <= maxDays; day++) {
    const cur = new Date(calDay);
    const y = cur.getUTCFullYear();
    const mo = cur.getUTCMonth() + 1;
    const d = cur.getUTCDate();

    // 日期级粗筛：月、日、周（周几用目标时区正午锚定，避开 DST 午夜漂移）
    if (cron.month.includes(mo)) {
      const domOk = cron.dayOfMonth.includes(d);
      const dow = weekdayOfZonedDay(timeZone, y, mo, d);
      const dowOk = cron.dayOfWeek.includes(dow);
      const dayMatches =
        cron.domRestricted && cron.dowRestricted
          ? domOk || dowOk
          : domOk && dowOk;

      if (dayMatches) {
        // 这一天可能匹配：在目标时区墙钟上构造候选（不再用宿主 setHours）
        for (const h of hours) {
          for (const m of minutes) {
            const candidate = fromZonedWall(timeZone, y, mo, d, h, m);
            if (
              candidate.getTime() >= start.getTime() &&
              matchesCronAt(cron, candidate, timeZone)
            ) {
              return candidate;
            }
          }
        }
      }
    }

    calDay += 86_400_000; // UTC 日历日推进，无 DST 歧义
  }

  return undefined;
}

/** 目标时区某个日历日是周几（0=周日），正午锚定 */
function weekdayOfZonedDay(
  timeZone: string,
  y: number,
  mo: number,
  d: number,
): number {
  const noon = fromZonedWall(timeZone, y, mo, d, 12, 0);
  return toZonedDate(noon, timeZone).getDay();
}

/** 校验 cron 是否合法（不抛异常版本） */
export function isValidCron(expression: string): boolean {
  try {
    parseCron(expression);
    return true;
  } catch {
    return false;
  }
}

/** 人类可读的描述 */
export function describeCron(cron: CronFields): string {
  const fmtList = (v: number[], unit: string) =>
    v.length === 1 ? `${v[0]}${unit}` : `${v.join(',')}${unit}`;

  if (cron.expression === '* * * * *') return '每分钟';

  const parts: string[] = [];
  parts.push(`分 ${fmtList(cron.minute, '')}`);
  parts.push(`时 ${fmtList(cron.hour, '')}`);

  if (cron.domRestricted) parts.push(`日 ${cron.dayOfMonth.join(',')}`);
  if (cron.month.includes(1) && cron.month.length < 12) {
    parts.push(`月 ${cron.month.join(',')}`);
  }
  if (cron.dowRestricted) {
    const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
    parts.push(cron.dayOfWeek.map((d) => names[d] ?? String(d)).join(','));
  }

  return parts.join(' ');
}
