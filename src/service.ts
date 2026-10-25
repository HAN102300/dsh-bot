/**
 * BotService — 核心服务
 *
 * MVP 阶段把 Service Definition 与本地 Provider 放在同一个包里
 * （遵循 DSH 官方「不要预防性拆分」的建议）。
 * 当需要独立的远端 Provider 时再拆包。
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';

import {
  BotError,
  type BotIdentity,
  type BotModel,
  type BotPluginConfig,
  type BotSummary,
  type BotBudget,
  type GoalArchive,
  type GoalState,
  type MemoryEntry,
  type MemoryKind,
  type RunRecord,
  type SemanticMemory,
} from './types.js';
import {
  validateRoutine,
  toMeta,
  type Routine,
  type RoutineMeta,
} from './routine/schema.js';
import {
  SnapshotManager,
  DEFAULT_SNAPSHOT_OPTIONS,
  type SnapshotMeta,
} from './routine/snapshot.js';
import {
  Scheduler,
  type ScheduledFire,
} from './scheduler/scheduler.js';
import { parseYaml, stringifyYaml } from './tools/yaml.js';

// ============================================================
// 路径工具
// ============================================================

/** 展开 ~ 为家目录 */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}

/** 生成稳定 ID */
export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

/** ISO 时间戳 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 校验 target 是否在 base 之内（路径穿越防护）。
 * 两边都先 resolve 成绝对路径再比较。
 */
export function isInside(base: string, target: string): boolean {
  const b = path.resolve(base);
  const t = path.resolve(target);
  if (t === b) return true;
  // 加上分隔符，避免 /foo-bar 被 /foo 误判为包含
  const withSep = b.endsWith(path.sep) ? b : b + path.sep;
  return t.startsWith(withSep);
}

/** 断言路径在工作区内 */
export function assertInsideWorkspace(workspace: string, target: string): void {
  if (!isInside(workspace, target)) {
    throw new BotError(
      'SANDBOX_VIOLATION',
      `路径越界：${target} 不在工作区 ${workspace} 内`,
    );
  }
}

// ============================================================
// JSONL 读写
// ============================================================

/** 追加一行 JSON 到 JSONL 文件 */
export async function appendJsonl(file: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  await fsp.appendFile(file, JSON.stringify(value) + '\n', 'utf8');
}

/** 读取整个 JSONL 文件，跳过损坏行 */
export async function readJsonl<T>(file: string): Promise<T[]> {
  let raw: string;
  try {
    raw = await fsp.readFile(file, 'utf8');
  } catch (e: any) {
    if (e?.code === 'ENOENT') return [];
    throw e;
  }
  const out: T[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      out.push(JSON.parse(trimmed) as T);
    } catch {
      // 跳过损坏行——崩溃恢复时保留其余数据
    }
  }
  return out;
}

/** 读目录，不存在返回空数组 */
async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await fsp.readdir(dir);
  } catch (e: any) {
    if (e?.code === 'ENOENT') return [];
    return [];
  }
}

/** 原子写 JSON（先写临时文件再 rename） */
export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, JSON.stringify(value, null, 2), 'utf8');
  await fsp.rename(tmp, file);
}

/** 同步读取 JSON，不存在返回 undefined */
export function readJsonSync<T>(file: string): T | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/**
 * 读一个目录下所有 .json 文件，跳过损坏文件。
 *
 * 目标史和目标候选都用这个读——损坏的单个文件不该让整个列表消失。
 */
export async function readJsonDir<T>(
  dir: string,
  sort?: (a: T, b: T) => number,
): Promise<T[]> {
  let files: string[];
  try {
    files = await fsp.readdir(dir);
  } catch (e: any) {
    if (e?.code === 'ENOENT') return [];
    throw e;
  }

  const out: T[] = [];
  for (const f of files) {
    if (!f.endsWith('.json')) continue;
    const v = readJsonSync<T>(path.join(dir, f));
    if (v) out.push(v);
  }
  if (sort) out.sort(sort);
  return out;
}

// ============================================================
// 记忆检索
// ============================================================

/** 计算两个字符串的关键词重叠度（0-1） */
export function keywordOverlap(haystack: string, needle: string): number {
  const norm = (s: string) => s.toLowerCase();
  const h = norm(haystack);
  // 中文需要按字切分，英文按空白切分
  const tokens = norm(needle)
    .split(/[\s,，。、;；:：!！?？]+/)
    .filter((t) => t.length > 0);
  if (tokens.length === 0) return 0;
  let hit = 0;
  for (const t of tokens) {
    if (h.includes(t)) hit++;
  }
  return hit / tokens.length;
}

/** 记忆评分：时间衰减 + 关键词 + 重要度 */
export function scoreMemory(e: MemoryEntry, query: string, nowMs = Date.now()): number {
  const ageDays = Math.max(0, (nowMs - Date.parse(e.ts)) / 86_400_000);
  const recency = Math.exp(-ageDays / 30); // 30 天半衰期
  const keyword = keywordOverlap(`${e.summary} ${e.tags.join(' ')}`, query);
  const weight = (e.importance ?? 3) / 5;
  return recency * 0.4 + keyword * 0.4 + weight * 0.2;
}

/** 检索记忆 */
export function recallMemories(
  entries: MemoryEntry[],
  query: string,
  limit = 20,
): MemoryEntry[] {
  return entries
    .map((e) => ({ e, score: scoreMemory(e, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.e);
}

// ============================================================
// BotService
// ============================================================

export class BotService {
  private readonly home: string;

  constructor(
    private readonly ctx: any,
    private readonly config: BotPluginConfig,
  ) {
    this.home = expandHome(config.homeDir);
  }

  // ---------- 路径 ----------

  get homeDir(): string {
    return this.home;
  }

  botDir(botId: string): string {
    return path.join(this.home, 'bots', botId);
  }

  identityPath(botId: string): string {
    return path.join(this.botDir(botId), 'identity.json');
  }

  memoryPath(botId: string): string {
    return path.join(this.botDir(botId), 'memory.jsonl');
  }

  semanticPath(botId: string): string {
    return path.join(this.botDir(botId), 'semantic.json');
  }

  workspacePath(botId: string): string {
    return path.join(this.botDir(botId), 'workspace');
  }

  routinesDir(botId: string): string {
    return path.join(this.botDir(botId), 'routines');
  }

  /** 当前目标（单对象，无目标时文件不存在） */
  goalPath(botId: string): string {
    return path.join(this.botDir(botId), 'goal.json');
  }

  /** 目标史目录（归档永久保留） */
  goalsArchiveDir(botId: string): string {
    return path.join(this.botDir(botId), 'goals', 'archive');
  }

  /** 接续候选目录 */
  goalsProposedDir(botId: string): string {
    return path.join(this.botDir(botId), 'goals', 'proposed');
  }

  runsDir(): string {
    return path.join(this.home, 'runs');
  }

  /** 运行记录按年月分目录，避免单目录文件过多 */
  runPath(runId: string, startedAt: string): string {
    const d = new Date(startedAt);
    const yyyy = String(d.getUTCFullYear());
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    return path.join(this.runsDir(), yyyy, mm, `${runId}.json`);
  }

  // ---------- 创建 / 查询 ----------

  async create(input: {
    name: string;
    role: string;
    avatar?: string;
    model?: Partial<BotModel>;
    budget?: Partial<BotBudget>;
    systemPromptExtra?: string;
  }): Promise<BotIdentity> {
    if (!input.name?.trim()) {
      throw new BotError('INVALID_ARGS', 'Bot 名称不能为空');
    }
    if (!input.role?.trim()) {
      throw new BotError('INVALID_ARGS', 'Bot 职责不能为空');
    }

    const id = newId('bot');
    const workspace = this.workspacePath(id);

    const identity: BotIdentity = {
      id,
      name: input.name.trim(),
      role: input.role.trim(),
      avatar: input.avatar,
      createdAt: nowIso(),
      model: {
        provider: input.model?.provider ?? this.config.defaultProvider,
        model: input.model?.model ?? this.config.defaultModel,
        reasoningEffort:
          input.model?.reasoningEffort ?? this.config.defaultReasoningEffort,
        thinking: input.model?.thinking ?? true,
      },
      budget: {
        dailyCny: input.budget?.dailyCny ?? this.config.defaultDailyCny,
        monthlyCny: input.budget?.monthlyCny ?? this.config.defaultMonthlyCny,
        onExceed: input.budget?.onExceed ?? 'stop',
      },
      workspace,
      capabilities: {
        allowShell: false,
        allowNetwork: true,
        allowWriteOutsideWorkspace: false,
      },
      systemPromptExtra: input.systemPromptExtra,
    };

    // 建目录
    await fsp.mkdir(workspace, { recursive: true });
    await fsp.mkdir(this.routinesDir(id), { recursive: true });
    await writeJsonAtomic(this.identityPath(id), identity);

    // 初始化空的语义记忆（注意：目标不在语义记忆里，它是独立的一等公民）
    const semantic: SemanticMemory = {
      updatedAt: nowIso(),
      facts: [],
      preferences: [],
    };
    await writeJsonAtomic(this.semanticPath(id), semantic);

    return identity;
  }

  async get(botId: string): Promise<BotIdentity> {
    const identity = readJsonSync<BotIdentity>(this.identityPath(botId));
    if (!identity) {
      throw new BotError('BOT_NOT_FOUND', `找不到 Bot: ${botId}`);
    }
    return identity;
  }

  async has(botId: string): Promise<boolean> {
    return fs.existsSync(this.identityPath(botId));
  }

  async list(): Promise<BotSummary[]> {
    const botsRoot = path.join(this.home, 'bots');
    let dirs: string[];
    try {
      dirs = await fsp.readdir(botsRoot);
    } catch (e: any) {
      if (e?.code === 'ENOENT') return [];
      throw e;
    }

    const out: BotSummary[] = [];
    for (const d of dirs) {
      const identity = readJsonSync<BotIdentity>(this.identityPath(d));
      if (!identity) continue;

      const runs = await this.listRuns(d, 1);
      const todayCost = await this.spentToday(d);
      const goal = await this.getGoal(d);
      const memoryCount = (await this.listMemories(d)).length;

      out.push({
        id: identity.id,
        name: identity.name,
        role: identity.role,
        createdAt: identity.createdAt,
        runCount: await this.runCount(d),
        todayCostCny: todayCost,
        lastRunAt: runs[0]?.startedAt,
        lastRunStatus: runs[0]?.status,

        goalDescription: goal?.description,
        goalStatus: goal?.status,
        goalType: goal?.type,
        goalProgress: goal?.progress,
        pendingConfirmCount: goal?.status === 'pending_confirmation' ? 1 : 0,
        proposedCount: (await this.listProposals(d)).length,
        blocked: goal?.status === 'blocked',
        memoryCount,
      });
    }
    // 按创建时间倒序
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
  }

  async update(botId: string, patch: Partial<BotIdentity>): Promise<BotIdentity> {
    const current = await this.get(botId);
    // id / workspace / createdAt 不允许修改
    const next: BotIdentity = {
      ...current,
      ...patch,
      id: current.id,
      workspace: current.workspace,
      createdAt: current.createdAt,
    };
    await writeJsonAtomic(this.identityPath(botId), next);
    return next;
  }

  async remove(botId: string): Promise<void> {
    await this.get(botId); // 确认存在
    await fsp.rm(this.botDir(botId), { recursive: true, force: true });
  }

  // ---------- 记忆 ----------

  async listMemories(botId: string): Promise<MemoryEntry[]> {
    return readJsonl<MemoryEntry>(this.memoryPath(botId));
  }

  async appendMemory(
    botId: string,
    entry: Omit<MemoryEntry, 'ts' | 'runId'> & { runId?: string },
  ): Promise<MemoryEntry> {
    await this.get(botId);
    const full: MemoryEntry = {
      ts: nowIso(),
      runId: entry.runId ?? '',
      kind: entry.kind,
      summary: entry.summary,
      detail: entry.detail,
      tags: entry.tags ?? [],
      importance: entry.importance ?? 3,
    };
    await appendJsonl(this.memoryPath(botId), full);
    return full;
  }

  async recall(
    botId: string,
    query: string,
    limit = 20,
  ): Promise<MemoryEntry[]> {
    await this.get(botId);
    const all = await this.listMemories(botId);
    return recallMemories(all, query, limit);
  }

  async getSemantic(botId: string): Promise<SemanticMemory> {
    const s = readJsonSync<SemanticMemory>(this.semanticPath(botId));
    // 兼容旧数据：早期版本把 goals 塞在语义记忆里
    const { facts, preferences, updatedAt } = (s ?? {}) as any;
    return {
      updatedAt: updatedAt ?? nowIso(),
      facts: Array.isArray(facts) ? facts : [],
      preferences: Array.isArray(preferences) ? preferences : [],
    };
  }

  async setSemantic(botId: string, semantic: SemanticMemory): Promise<void> {
    await writeJsonAtomic(this.semanticPath(botId), {
      ...semantic,
      updatedAt: nowIso(),
    });
  }

  /**
   * 追加一条蒸馏事实（去重、保留最近 50 条）。
   *
   * 事实是供给系统提示用的，必须有上限——否则提示会无限膨胀，
   * 既烧钱又稀释注意力。
   */
  async addFact(botId: string, fact: string): Promise<void> {
    const f = fact.trim();
    if (!f) return;
    const semantic = await this.getSemantic(botId);
    const exists = semantic.facts.some((x) => x === f);
    if (exists) return;
    semantic.facts = [...semantic.facts, f].slice(-50);
    await this.setSemantic(botId, semantic);
  }

  // ---------- 目标（「守得住」） ----------

  /** 读当前目标；没有则返回 undefined */
  async getGoal(botId: string): Promise<GoalState | undefined> {
    await this.get(botId);
    return readJsonSync<GoalState>(this.goalPath(botId)) ?? undefined;
  }

  /** 写当前目标 */
  async saveGoal(botId: string, goal: GoalState): Promise<void> {
    await this.get(botId);
    await writeJsonAtomic(this.goalPath(botId), goal);
  }

  /** 清掉当前目标（归档后调用） */
  async clearGoal(botId: string): Promise<void> {
    await this.get(botId);
    try {
      await fsp.unlink(this.goalPath(botId));
    } catch (e: any) {
      if (e?.code !== 'ENOENT') throw e;
    }
  }

  /** 归档一个已结束的目标（永久保留，不设上限） */
  async archiveGoal(
    botId: string,
    goal: GoalState,
    summary: { totalRuns: number; totalCostCny: number; outcome: string; snapshotIds: string[] },
  ): Promise<GoalArchive> {
    await this.get(botId);
    const now = nowIso();
    const archive: GoalArchive = {
      ...goal,
      archivedAt: now,
      endedAt: goal.updatedAt,
      totalRuns: summary.totalRuns,
      totalCostCny: summary.totalCostCny,
      outcome: summary.outcome,
      snapshotIds: summary.snapshotIds,
    };

    const dir = this.goalsArchiveDir(botId);
    await fsp.mkdir(dir, { recursive: true });
    await writeJsonAtomic(path.join(dir, `${goal.id}.json`), archive);
    return archive;
  }

  /** 读目标史（按归档时间倒序，全量） */
  async listGoalArchives(botId: string): Promise<GoalArchive[]> {
    await this.get(botId);
    return readJsonDir<GoalArchive>(this.goalsArchiveDir(botId), (a, b) =>
      b.archivedAt.localeCompare(a.archivedAt),
    );
  }

  /** 写一个接续候选 */
  async saveProposal(botId: string, goal: GoalState): Promise<void> {
    await this.get(botId);
    const dir = this.goalsProposedDir(botId);
    await fsp.mkdir(dir, { recursive: true });
    await writeJsonAtomic(path.join(dir, `${goal.id}.json`), goal);
  }

  /** 列接续候选 */
  async listProposals(botId: string): Promise<GoalState[]> {
    await this.get(botId);
    return readJsonDir<GoalState>(this.goalsProposedDir(botId), (a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
  }

  /** 删掉一个候选（接受或忽略后） */
  async removeProposal(botId: string, goalId: string): Promise<void> {
    await this.get(botId);
    try {
      await fsp.unlink(path.join(this.goalsProposedDir(botId), `${goalId}.json`));
    } catch (e: any) {
      if (e?.code !== 'ENOENT') throw e;
    }
  }

  /** 清空所有候选 */
  async clearProposals(botId: string): Promise<void> {
    const all = await this.listProposals(botId);
    for (const p of all) await this.removeProposal(botId, p.id);
  }

  // ---------- 运行记录 ----------

  async saveRun(record: RunRecord): Promise<void> {
    await writeJsonAtomic(this.runPath(record.id, record.startedAt), record);
  }

  async getRun(botId: string, runId: string): Promise<RunRecord> {
    // 运行记录按月分目录，需要遍历查找
    const runs = await this.listRuns(botId, Number.MAX_SAFE_INTEGER);
    const found = runs.find((r) => r.id === runId);
    if (!found) throw new BotError('BOT_NOT_FOUND', `找不到运行记录: ${runId}`);
    return found;
  }

  async listRuns(botId: string, limit = 50): Promise<RunRecord[]> {
    const root = this.runsDir();
    const out: RunRecord[] = [];

    let years: string[];
    try {
      years = await fsp.readdir(root);
    } catch (e: any) {
      if (e?.code === 'ENOENT') return [];
      throw e;
    }

    for (const y of years) {
      let months: string[];
      try {
        months = await fsp.readdir(path.join(root, y));
      } catch {
        continue;
      }
      for (const m of months) {
        let files: string[];
        try {
          files = await fsp.readdir(path.join(root, y, m));
        } catch {
          continue;
        }
        for (const f of files) {
          if (!f.endsWith('.json')) continue;
          const r = readJsonSync<RunRecord>(path.join(root, y, m, f));
          if (r?.botId === botId) out.push(r);
        }
      }
    }

    out.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    return out.slice(0, limit);
  }

  async runCount(botId: string): Promise<number> {
    const runs = await this.listRuns(botId, Number.MAX_SAFE_INTEGER);
    return runs.length;
  }

  /**
   * 清空某个 Bot 的全部运行记录。
   *
   * ⚠️ 这是不可恢复操作，调用方必须显式确认。
   *    只删该 Bot 的，不碰其它 Bot 的记录。
   */
  async clearRuns(botId: string): Promise<number> {
    await this.get(botId);
    const root = this.runsDir();
    let removed = 0;

    let years: string[];
    try {
      years = await fsp.readdir(root);
    } catch (e: any) {
      if (e?.code === 'ENOENT') return 0;
      throw e;
    }

    for (const y of years) {
      let months: string[];
      try {
        months = await fsp.readdir(path.join(root, y));
      } catch {
        continue;
      }
      for (const m of months) {
        let files: string[];
        try {
          files = await fsp.readdir(path.join(root, y, m));
        } catch {
          continue;
        }
        for (const f of files) {
          if (!f.endsWith('.json')) continue;
          const full = path.join(root, y, m, f);
          const r = readJsonSync<RunRecord>(full);
          if (r?.botId !== botId) continue;
          try {
            await fsp.unlink(full);
            removed++;
          } catch {
            /* 单个文件删不掉不影响其它 */
          }
        }
      }
    }

    return removed;
  }

  /** 删除单条运行记录 */
  async deleteRun(botId: string, runId: string): Promise<boolean> {
    await this.get(botId);
    const root = this.runsDir();

    for (const y of await safeReaddir(root)) {
      for (const m of await safeReaddir(path.join(root, y))) {
        const dir = path.join(root, y, m);
        for (const f of await safeReaddir(dir)) {
          if (f !== `${runId}.json`) continue;
          const full = path.join(dir, f);
          const r = readJsonSync<RunRecord>(full);
          if (r?.botId !== botId) continue;
          await fsp.unlink(full);
          return true;
        }
      }
    }
    return false;
  }

  /** 今日累计花费（人民币）—— 供预算守卫用，未知成本按 0 计 */
  async spentToday(botId: string): Promise<number> {
    return (await this.spendBreakdown(botId, 'day')).cny;
  }

  /** 本月累计花费（人民币）—— 供预算守卫用 */
  async spentThisMonth(botId: string): Promise<number> {
    return (await this.spendBreakdown(botId, 'month')).cny;
  }

  /**
   * 花费明细（区分「已知金额」与「算不出来的部分」）。
   *
   * ⚠️ 为什么需要这个：
   *   早期 `reduce(... ?? 0)` 把"算不出来"混进了"0"，
   *   UI 显示 ¥0.0000 —— 用户以为免费，其实是没价格数据。
   *   这里把两部分分开统计，UI 才能诚实显示。
   */
  async spendBreakdown(
    botId: string,
    range: 'day' | 'month',
  ): Promise<{
    cny: number;
    /** 有多少次运行的成本是算不出来的 */
    unknownRuns: number;
    /** 有多少次是明确免费 */
    freeRuns: number;
    /** 总运行次数 */
    runs: number;
    /** token 合计 */
    tokens: { input: number; output: number; cacheHit: number; cacheMiss: number };
  }> {
    const key = range === 'day' ? 10 : 7; // 日期字符串截取长度
    const prefix = new Date().toISOString().slice(0, range === 'day' ? 10 : 7);
    const runs = await this.listRuns(botId, Number.MAX_SAFE_INTEGER);
    const inRange = runs.filter((r) => r.startedAt.slice(0, key) === prefix);

    let cny = 0;
    let unknownRuns = 0;
    let freeRuns = 0;
    const tokens = { input: 0, output: 0, cacheHit: 0, cacheMiss: 0 };

    for (const r of inRange) {
      const u = r.usage;
      tokens.input += u?.inputTokens ?? 0;
      tokens.output += u?.outputTokens ?? 0;
      tokens.cacheHit += u?.cacheHitTokens ?? 0;
      tokens.cacheMiss += u?.cacheMissTokens ?? 0;

      // null 是历史数据里 NaN 落盘的痕迹（JSON.stringify(NaN) === null），
      // 与 undefined 一样按「算不出来」处理——不能让它混进 0 元。
      const cost = u?.costCny;
      const costUnknown =
        cost === undefined || cost === null || Number.isNaN(cost);
      if (u?.costKind === 'unknown' || (costUnknown && u?.costKind !== 'free')) {
        unknownRuns++;
      } else if (u?.costKind === 'free') {
        freeRuns++;
      } else {
        cny += cost as number;
      }
    }

    return { cny, unknownRuns, freeRuns, runs: inRange.length, tokens };
  }

  // ---------- 预算守卫 ----------

  async checkBudget(botId: string, estimateCny = 0): Promise<void> {
    const bot = await this.get(botId);
    const today = await this.spentToday(botId);
    const month = await this.spentThisMonth(botId);

    if (today + estimateCny > bot.budget.dailyCny) {
      throw new BotError(
        'BUDGET_EXCEEDED',
        `今日预算已用 ¥${today.toFixed(4)} / ${bot.budget.dailyCny}，本次预计 ¥${estimateCny.toFixed(4)}`,
      );
    }
    if (month + estimateCny > bot.budget.monthlyCny) {
      throw new BotError(
        'BUDGET_EXCEEDED',
        `本月预算已用 ¥${month.toFixed(4)} / ${bot.budget.monthlyCny}`,
      );
    }
  }

  // ---------- 调度 ----------

  private schedulerInstance?: Scheduler;

  /** 是否启用错峰调度 */
  configForScheduler(): boolean {
    return this.config.costSensitiveScheduling;
  }

  /** 取调度器实例 */
  scheduler(): Scheduler {
    if (!this.schedulerInstance) {
      this.schedulerInstance = new Scheduler(this, this.home, {
        costSensitive: this.config.costSensitiveScheduling,
        tickMs: this.config.schedulerTickMs,
        timeZone: 'Asia/Shanghai',
      });
    }
    return this.schedulerInstance;
  }

  /**
   * 一次调度扫描。
   *
   * 注意：这里只做扫描与触发判定，实际执行由插件的 onFire 回调完成，
   * 以免 Service 依赖 Runner（避免循环依赖）。
   */
  async schedulerTick(
    onFire?: (fire: ScheduledFire) => Promise<void>,
  ): Promise<ScheduledFire[]> {
    const scheduler = this.scheduler();

    // 心跳
    const beat = await scheduler.beat();
    if (beat.wokeFromSleep && beat.gapMs > 0) {
      (this.ctx as any)?.logger?.warn?.(
        `[dsh-bot] 检测到休眠：距上次心跳 ${Math.round(beat.gapMs / 1000)} 秒`,
      );
    }

    // 错过的任务补跑
    const fires = await scheduler.tick();

    if (onFire) {
      for (const fire of fires) {
        try {
          await onFire(fire);
        } catch (e: any) {
          (this.ctx as any)?.logger?.error?.(
            `[dsh-bot] 调度执行失败 ${fire.botId}/${fire.routineId}: ${e?.message ?? e}`,
          );
        }
      }
    }

    return fires;
  }

  // ---------- Routine 存储 ----------

  routinePath(botId: string, routineId: string): string {
    return path.join(this.routinesDir(botId), `${routineId}.yaml`);
  }

  async saveRoutine(botId: string, routine: Routine): Promise<void> {
    await this.get(botId);
    const file = this.routinePath(botId, routine.metadata.id);
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.writeFile(file, stringifyYaml(routine), 'utf8');
  }

  async getRoutine(botId: string, routineId: string): Promise<Routine> {
    await this.get(botId);
    const file = this.routinePath(botId, routineId);
    let raw: string;
    try {
      raw = await fsp.readFile(file, 'utf8');
    } catch (e: any) {
      if (e?.code === 'ENOENT') {
        throw new BotError(
          'ROUTINE_NOT_FOUND',
          `找不到流程：${routineId}（Bot ${botId}）`,
        );
      }
      throw e;
    }
    const parsed = parseYaml(raw);
    return validateRoutine(parsed);
  }

  async listRoutines(botId: string): Promise<RoutineMeta[]> {
    await this.get(botId);
    const dir = this.routinesDir(botId);
    let files: string[];
    try {
      files = await fsp.readdir(dir);
    } catch (e: any) {
      if (e?.code === 'ENOENT') return [];
      throw e;
    }

    const out: RoutineMeta[] = [];
    for (const f of files) {
      if (!f.endsWith('.yaml') && !f.endsWith('.yml')) continue;
      try {
        const raw = await fsp.readFile(path.join(dir, f), 'utf8');
        out.push(toMeta(validateRoutine(parseYaml(raw))));
      } catch {
        // 损坏的流程文件跳过，不影响其它
      }
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
    return out;
  }

  async removeRoutine(botId: string, routineId: string): Promise<void> {
    await this.get(botId);
    const file = this.routinePath(botId, routineId);
    try {
      await fsp.unlink(file);
    } catch (e: any) {
      if (e?.code === 'ENOENT') {
        throw new BotError('ROUTINE_NOT_FOUND', `找不到流程：${routineId}`);
      }
      throw e;
    }
  }

  // ---------- 快照与回滚（「收得回」） ----------

  private snapshots = new Map<string, SnapshotManager>();

  /** 取某个 Bot 的快照管理器 */
  snapshotsOf(botId: string): SnapshotManager {
    const cached = this.snapshots.get(botId);
    if (cached) return cached;
    const mgr = new SnapshotManager(this.botDir(botId), {
      ...DEFAULT_SNAPSHOT_OPTIONS,
      keepRecent:
        this.config.snapshotKeepRecent ?? DEFAULT_SNAPSHOT_OPTIONS.keepRecent,
    });
    this.snapshots.set(botId, mgr);
    return mgr;
  }

  /** 为 Bot 的 workspace 打快照 */
  async createSnapshot(workspace: string, runId?: string): Promise<SnapshotMeta> {
    const botId = path.basename(path.dirname(path.resolve(workspace)));
    await this.get(botId);
    return this.snapshotsOf(botId).create(workspace, runId);
  }

  /** 列出快照 */
  async listSnapshots(botId: string): Promise<SnapshotMeta[]> {
    await this.get(botId);
    return this.snapshotsOf(botId).list();
  }

  /**
   * 回滚到指定快照。
   * 不指定 snapId 时回滚到最近一个快照。
   *
   * 事务化：覆盖前自动给当前状态打快照（restore 内部完成），
   * 归档目标引用的快照在清理时豁免。
   */
  async rollback(
    botId: string,
    snapId?: string,
  ): Promise<{
    snapshotId: string;
    restored: string[];
    removed: string[];
    errors: string[];
    preSnapshotId: string;
  }> {
    const bot = await this.get(botId);
    const mgr = this.snapshotsOf(botId);

    let target = snapId;
    if (!target) {
      const all = await mgr.list();
      if (all.length === 0) {
        throw new BotError(
          'BOT_NOT_FOUND',
          '这个 Bot 还没有任何快照，无法回滚',
        );
      }
      target = all[0].id;
    }

    // 归档里引用的快照永不清理——否则回滚时报「找不到快照」
    const preserve = await this.archivedSnapshotIds(botId);
    const result = await mgr.restore(target, bot.workspace, preserve);
    return { snapshotId: target, ...result };
  }

  /** 归档目标引用的快照 ID 集合（滚动清理的豁免名单） */
  private async archivedSnapshotIds(botId: string): Promise<Set<string>> {
    const out = new Set<string>();
    try {
      const archives = await this.listGoalArchives(botId);
      for (const a of archives) {
        for (const id of a.snapshotIds ?? []) out.add(id);
      }
    } catch {
      /* 归档读失败不阻断回滚 */
    }
    return out;
  }

  /** 删除指定快照 */
  async removeSnapshot(botId: string, snapId: string): Promise<void> {
    await this.get(botId);
    await this.snapshotsOf(botId).remove(snapId);
  }

  /** 快照总占用 */
  async snapshotUsage(
    botId: string,
  ): Promise<{ count: number; bytes: number }> {
    await this.get(botId);
    const mgr = this.snapshotsOf(botId);
    const all = await mgr.list();
    return {
      count: all.length,
      bytes: all.reduce((s, x) => s + x.totalBytes, 0),
    };
  }
}
