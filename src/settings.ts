/**
 * 设置存储
 *
 * DSH 没有通用的 settings slot（官方 ui-goal / ui-schedule 都挂在对话区），
 * 所以设置页做成面板内的独立视图，配置存本地文件。
 *
 * 两层：
 *   全局：~/.dsh/bot/settings.json
 *   单 Bot：bots/<id>/settings.json（覆盖全局）
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

/** 全部可配置项 */
export interface BotSettings {
  // ---------- 通知 ----------
  /** 系统桌面通知 */
  notifySystem: boolean;
  /** 仅在需要人拍板时通知（否则任何失败都通知） */
  notifyOnlyOnDecision: boolean;
  /** 免打扰时段（HH:mm），null 表示不启用 */
  quietHours: { start: string; end: string } | null;

  // ---------- 模型 ----------
  /** 新建 Bot 时跟随当前会话的模型 */
  followSessionModel: boolean;
  /** 推理强度 */
  reasoningEffort: 'low' | 'high' | 'max';

  // ---------- 预算 ----------
  dailyCny: number;
  monthlyCny: number;
  onExceed: 'stop' | 'downgrade';

  // ---------- 目标 ----------
  /** 目标达成后自动提议下一步 */
  autoPropose: boolean;
  /** 新建目标时的默认执行节奏（cron），空表示不自动跑 */
  defaultCadence: string;

  // ---------- 高级 ----------
  /** 峰谷调度（错峰省钱） */
  costSensitiveScheduling: boolean;
  /** 快照保留数量 */
  snapshotKeepRecent: number;
  /** 真实执行前自动打快照 */
  snapshotEnabled: boolean;
}

export const DEFAULT_SETTINGS: BotSettings = {
  notifySystem: true,
  notifyOnlyOnDecision: true,
  quietHours: null,
  followSessionModel: true,
  reasoningEffort: 'high',
  dailyCny: 5,
  monthlyCny: 100,
  onExceed: 'stop',
  autoPropose: true,
  defaultCadence: '',
  costSensitiveScheduling: true,
  snapshotKeepRecent: 10,
  snapshotEnabled: true,
};

function readJsonSync<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

/** 校验 HH:mm 且小时/分钟都在合法范围（拒绝 25:00 这类） */
function isValidClock(s: string): boolean {
  if (!/^\d{1,2}:\d{2}$/.test(s)) return false;
  const [h, m] = s.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

/** 合并：默认值 ← 全局 ← 单 Bot */
export function mergeSettings(
  global?: Partial<BotSettings>,
  perBot?: Partial<BotSettings>,
): BotSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...(global ?? {}),
    ...(perBot ?? {}),
  };
}

/** 校验并清洗设置（拒绝非法值，不静默接受） */
export function sanitizeSettings(raw: any): Partial<BotSettings> {
  const out: Partial<BotSettings> = {};
  if (!raw || typeof raw !== 'object') return out;

  const bool = (k: keyof BotSettings, v: any) => {
    if (typeof v === 'boolean') (out as any)[k] = v;
  };
  bool('notifySystem', raw.notifySystem);
  bool('notifyOnlyOnDecision', raw.notifyOnlyOnDecision);
  bool('followSessionModel', raw.followSessionModel);
  bool('autoPropose', raw.autoPropose);
  bool('costSensitiveScheduling', raw.costSensitiveScheduling);
  bool('snapshotEnabled', raw.snapshotEnabled);

  if (['low', 'high', 'max'].includes(raw.reasoningEffort)) {
    out.reasoningEffort = raw.reasoningEffort;
  }

  if (Number.isFinite(raw.dailyCny) && raw.dailyCny >= 0) {
    out.dailyCny = Number(raw.dailyCny);
  }
  if (Number.isFinite(raw.monthlyCny) && raw.monthlyCny >= 0) {
    out.monthlyCny = Number(raw.monthlyCny);
  }
  if (['stop', 'downgrade'].includes(raw.onExceed)) {
    out.onExceed = raw.onExceed;
  }

  if (Number.isFinite(raw.snapshotKeepRecent) && raw.snapshotKeepRecent >= 0) {
    out.snapshotKeepRecent = Math.floor(Number(raw.snapshotKeepRecent));
  }

  if (typeof raw.defaultCadence === 'string') {
    out.defaultCadence = raw.defaultCadence.trim();
  }

  if (raw.quietHours === null) {
    out.quietHours = null;
  } else if (
    raw.quietHours &&
    typeof raw.quietHours.start === 'string' &&
    typeof raw.quietHours.end === 'string' &&
    isValidClock(raw.quietHours.start) &&
    isValidClock(raw.quietHours.end)
  ) {
    out.quietHours = {
      start: raw.quietHours.start,
      end: raw.quietHours.end,
    };
  }

  return out;
}

/** 设置存储 */
export class SettingsStore {
  constructor(private readonly homeDir: string) {}

  private globalPath(): string {
    return path.join(this.homeDir, 'settings.json');
  }

  private botPath(botId: string): string {
    return path.join(this.homeDir, 'bots', botId, 'settings.json');
  }

  async getGlobal(): Promise<Partial<BotSettings>> {
    return readJsonSync<Partial<BotSettings>>(this.globalPath()) ?? {};
  }

  async setGlobal(patch: Partial<BotSettings>): Promise<BotSettings> {
    const current = await this.getGlobal();
    const merged = { ...current, ...sanitizeSettings(patch) };
    await writeJsonAtomic(this.globalPath(), merged);
    return mergeSettings(merged);
  }

  async getForBot(botId: string): Promise<Partial<BotSettings>> {
    return readJsonSync<Partial<BotSettings>>(this.botPath(botId)) ?? {};
  }

  async setForBot(
    botId: string,
    patch: Partial<BotSettings>,
  ): Promise<BotSettings> {
    const current = await this.getForBot(botId);
    const merged = { ...current, ...sanitizeSettings(patch) };
    await writeJsonAtomic(this.botPath(botId), merged);
    return this.resolve(botId);
  }

  /** 全局 + 单 Bot 合并后的有效设置 */
  async resolve(botId?: string): Promise<BotSettings> {
    const global = await this.getGlobal();
    const perBot = botId ? await this.getForBot(botId) : undefined;
    return mergeSettings(global, perBot);
  }
}

/**
 * 当前时间是否落在免打扰时段内。
 *
 * 处理跨午夜的情况（22:00–08:00）：
 * start > end 时，判断 [start,24) ∪ [0,end)。
 */
export function inQuietHours(
  quiet: { start: string; end: string } | null,
  now: Date = new Date(),
): boolean {
  if (!quiet) return false;

  const toMin = (s: string) => {
    const [h, m] = s.split(':').map(Number);
    return h * 60 + m;
  };

  // 用北京时间判断（与调度器一致）
  const bj = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const cur = bj.getHours() * 60 + bj.getMinutes();
  const start = toMin(quiet.start);
  const end = toMin(quiet.end);

  if (start === end) return false;
  if (start < end) return cur >= start && cur < end;
  // 跨午夜
  return cur >= start || cur < end;
}
