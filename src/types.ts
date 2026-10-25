/**
 * dsh-bot 核心类型定义
 *
 * 设计原则：所有对外暴露的类型都在这里，便于后续拆分为
 * Service Definition / Provider / Consumer 三角色包。
 */

// ============================================================
// Bot 身份
// ============================================================

/** 推理强度档位（已归一化，屏蔽各厂商差异） */
export type ReasoningEffort = 'low' | 'high' | 'max';

/** 预算超限策略 */
export type OnExceed = 'stop' | 'downgrade';

/** 模型绑定 */
export interface BotModel {
  /** 提供方路由，如 'deepseek' */
  provider: string;
  /** 模型 id，如 'deepseek-flash' */
  model: string;
  /** 推理强度 */
  reasoningEffort: ReasoningEffort;
  /** 是否开启思考模式 */
  thinking: boolean;
}

/** 预算配置 */
export interface BotBudget {
  /** 每日上限（人民币） */
  dailyCny: number;
  /** 每月上限（人民币） */
  monthlyCny: number;
  /** 超限行为 */
  onExceed: OnExceed;
}

/** 能力开关 */
export interface BotCapabilities {
  /** 是否允许 shell 执行 */
  allowShell: boolean;
  /** 是否允许网络访问 */
  allowNetwork: boolean;
  /** 是否允许写工作区之外的文件 */
  allowWriteOutsideWorkspace: boolean;
  /** 工具白名单；undefined 表示全部允许 */
  allowedTools?: string[];
}

/** Bot 身份定义 */
export interface BotIdentity {
  /** 稳定 ID，如 'bot_7f3a2c' */
  id: string;
  /** 人类可读名 */
  name: string;
  /** 一句话职责 */
  role: string;
  /** 头像（emoji 或路径） */
  avatar?: string;
  /** 创建时间 ISO 8601 */
  createdAt: string;
  /** 模型绑定 */
  model: BotModel;
  /** 预算 */
  budget: BotBudget;
  /** 工作区绝对路径 */
  workspace: string;
  /** 能力开关 */
  capabilities: BotCapabilities;
  /** 额外系统提示（稳定前缀的一部分） */
  systemPromptExtra?: string;
}

/** 列表用的摘要 */
export interface BotSummary {
  id: string;
  name: string;
  role: string;
  createdAt: string;
  /** 运行次数 */
  runCount: number;
  /** 今日已花费（人民币） */
  todayCostCny: number;
  /** 最近一次运行时间 */
  lastRunAt?: string;
  /** 最近一次运行状态 */
  lastRunStatus?: RunStatus;

  // ---------- 「守得住」在列表行的呈现 ----------
  /** 当前目标描述（列表行「他在守：…」） */
  goalDescription?: string;
  /** 当前目标状态 */
  goalStatus?: GoalStatus;
  /** 当前目标类型 */
  goalType?: GoalType;
  /** 当前目标进度摘要 */
  goalProgress?: string;
  /** 待确认的候选数（角标用） */
  pendingConfirmCount: number;
  /** 接续候选数（角标用） */
  proposedCount: number;
  /** 是否处于 blocked（角标用） */
  blocked: boolean;
  /** 记忆条数（列表行「记得 N 条」） */
  memoryCount: number;
}

// ============================================================
// 记忆
// ============================================================

/** 记忆条目类型 */
export type MemoryKind =
  | 'observation' // 观察到的事实
  | 'decision'    // 做过的决策
  | 'outcome'     // 产生的结果
  | 'fact'        // 稳定事实
  | 'preference'; // 用户偏好

/** 一条情景记忆 */
export interface MemoryEntry {
  /** ISO 8601 时间戳 */
  ts: string;
  /** 关联的运行 ID */
  runId: string;
  /** 类型 */
  kind: MemoryKind;
  /** 摘要，≤ 200 字 */
  summary: string;
  /** 原始细节（可选，按需加载） */
  detail?: string;
  /** 检索标签 */
  tags: string[];
  /** 重要度 1-5 */
  importance: number;
}

/**
 * 语义记忆（蒸馏后的稳定事实）。
 *
 * ⚠️ 目标不在这里。目标是独立的一等公民，有自己的文件和状态机。
 * 早期版本曾把 goals 塞进语义记忆数组里，结果成了没人写的死字段——
 * 「一个目标就该有一个明确的家」。
 */
export interface SemanticMemory {
  /** 最后更新时间 */
  updatedAt: string;
  /** 事实列表 */
  facts: string[];
  /** 用户偏好列表 */
  preferences: string[];
}

// ============================================================
// 目标（「守得住」）
// ============================================================

/**
 * 目标的两种时间形态。
 *
 * - `one-shot`：有明确终点。达成后归档，可触发接续提议。
 * - `standing`：没有终点，是一种稳态。**永远 active**，
 *   只会「这一轮完成」（cycleCount++），永不 achieved。
 *
 * 这个区分解决了「持续任务怎么继续」：多数看似需要不断接续的需求，
 * 其实应该建成 standing，问题在源头就消失了。
 */
export type GoalType = 'one-shot' | 'standing';

/**
 * 目标状态机。
 *
 * ```
 *   (无) ──set──▶ active ──Bot 判完成──▶ pending_confirmation ──人确认──▶ achieved ──▶ archived
 *                   │  ▲                        │
 *                   │  └────── 人驳回 ───────────┘
 *                   ├── Bot 判卡住 ──▶ blocked ──人 unblock──▶ active
 *                   └── 人放弃 ──▶ abandoned ──▶ archived
 *
 *   archived ──▶ proposed ──人接受──▶ active
 * ```
 *
 * ⚠️ 核心约束：Bot 只能写到 `pending_confirmation` / `blocked`，
 * **永远不能**直接写 `achieved` / `abandoned` / `active`。
 * 终局判定与开新目标只能由人产生——这是对
 * 「记忆越长、错误延续越久」的正面回答。
 */
export type GoalStatus =
  | 'proposed' // 接续候选，等人接受
  | 'active' // 进行中
  | 'pending_confirmation' // Bot 认为完成，等人拍板
  | 'achieved' // 已达成（人确认）
  | 'blocked' // 卡住，需人介入
  | 'abandoned'; // 已放弃（人）

/** 目标状态（Dots 的「守得住」所需） */
export interface GoalState {
  /** 目标 ID */
  id: string;
  /** 时间形态 */
  type: GoalType;
  /** 目标描述 */
  description: string;
  /** 状态 */
  status: GoalStatus;
  /** 进度说明（Bot 自动累积） */
  progress: string;
  /** 最后更新时间 */
  updatedAt: string;
  /** 创建时间（归档统计需要） */
  createdAt: string;
  /** 下一步建议 */
  nextStep?: string;
  /** 是否需要人介入 */
  needsHuman: boolean;
  /** 支撑「已完成」判定的依据 */
  evidence?: string[];
  /** standing 专属：已完成的轮次 */
  cycleCount?: number;
  /** 接续候选：来自哪个已归档目标 */
  origin?: string;

  /**
   * ⭐ 执行节奏（cron 表达式）。
   *
   * 这是「持续任务」真正能持续的关键：没有它，目标只是一句愿望，
   * 调度器永远不会自己跑起来——用户看到的就是"点了执行，什么也没发生"。
   *
   * 例：表达式 `0 <每N小时> * * *` 中 N=4 表示每 4 小时。
   *     设定后调度器按此节奏自动触发 Bot 推进目标。
   */
  cadence?: string;
  /** 节奏的时区，默认 Asia/Shanghai */
  cadenceTimezone?: string;
  /** 上次被调度触发的时间（去重用） */
  lastFiredAt?: string;
}

/** 归档后的目标（永久保留，不设上限） */
export interface GoalArchive extends GoalState {
  /** 归档时间 */
  archivedAt: string;
  /** 目标结束时间（达成/放弃的时刻） */
  endedAt: string;
  /** 该目标期间总运行次数 */
  totalRuns: number;
  /** 该目标期间总花费（人民币） */
  totalCostCny: number;
  /** 收尾说明 */
  outcome: string;
  /** 相关快照 ID */
  snapshotIds: string[];
}

// ============================================================
// 运行
// ============================================================

/** 运行状态 */
export type RunStatus =
  | 'success'
  | 'failed'
  | 'partial'
  | 'aborted'
  | 'budget_exceeded';

/** 触发来源 */
export type RunTrigger = 'manual' | 'schedule' | 'event' | 'goal';

/** 步骤类型 */
export type StepKind = 'tool' | 'llm' | 'assert' | 'script' | 'parallel' | 'loop';

/** 单步记录 */
export interface StepRecord {
  index: number;
  kind: StepKind;
  name: string;
  args?: unknown;
  result?: unknown;
  /** dry-run 拦截时的记录 */
  blocked?: { reason: string };
  durationMs: number;
  error?: { code: string; message: string };
}

/** token 与成本统计 */
export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  reasoningTokens: number;
  /**
   * 人民币成本。
   *
   * ⚠️ `undefined` 与 `0` 含义不同：
   *   - `0`         真的没花钱（免费模型）
   *   - `undefined` 算不出来（没有价格数据）
   *
   * UI 必须区分这两者，否则会把「不知道」显示成「免费」。
   */
  costCny?: number;
  /** 计价依据，决定 UI 怎么显示 */
  costKind?: 'exact' | 'free' | 'unknown';
  /** 给用户看的计价说明 */
  costNote?: string;
}

/** 一次完整运行记录 */
export interface RunRecord {
  id: string;
  botId: string;
  routineId?: string;
  goalId?: string;
  trigger: RunTrigger;
  startedAt: string;
  endedAt: string;
  /** 是否为 dry-run */
  dryRun: boolean;
  status: RunStatus;
  steps: StepRecord[];
  usage: RunUsage;
  error?: { code: string; message: string };
  /** 本轮结束时的目标状态评估（"守得住"） */
  goalAssessment?: {
    achieved: boolean;
    hasNewSituation: boolean;
    needsHuman: boolean;
    note?: string;
    nextStep?: string;
  };
  /**
   * 本轮评估对目标产生的实际效果（由 runner 在评估后填入）。
   * - `progress`  只更新了进展
   * - `pending`   置为待确认
   * - `blocked`   置为阻塞
   * - `cycle`     standing 目标轮次 +1
   * - `none`      未评估或未改动
   */
  goalEffect?: 'progress' | 'pending' | 'blocked' | 'cycle' | 'none';
  /** 工作区快照 id（执行前，用于"撤销本次执行"） */
  snapshotId?: string;
  /** 工作区快照 id（执行成功后，用于"回到本次结果"） */
  snapshotIdAfter?: string;
}

// ============================================================
// 工具副作用的等级（dry-run 拦截依据）
// ============================================================

/**
 * - none:     只读，dry-run 下照常执行
 * - local:    本地写操作，dry-run 下写临时区并返回预览
 * - external: 外部副作用（发邮件、调 webhook），dry-run 下一律拦截
 */
export type SideEffect = 'none' | 'local' | 'external';

/** 工具副作用映射表 */
export const TOOL_SIDE_EFFECTS: Record<string, SideEffect> = {
  // 只读
  read: 'none',
  glob: 'none',
  grep: 'none',
  web_fetch: 'none',
  web_search: 'none',
  http_get: 'none',
  bot_list: 'none',
  bot_show: 'none',
  bot_recall: 'none',
  bot_runs: 'none',
  routine_list: 'none',
  routine_show: 'none',
  // 本地写
  write: 'local',
  edit: 'local',
  bash: 'local',
  pwsh: 'local',
  bot_create: 'local',
  bot_update: 'local',
  routine_save: 'local',
  // 外部副作用
  webhook_post: 'external',
  send_email: 'external',
};

/** 查询工具的副作用等级（未登记的一律按 external 处理，保守优先） */
export function sideEffectOf(toolName: string): SideEffect {
  return TOOL_SIDE_EFFECTS[toolName] ?? 'external';
}

/** 是否需要在 dry-run 下拦截 */
export function shouldBlockInDryRun(toolName: string): boolean {
  return sideEffectOf(toolName) !== 'none';
}

// ============================================================
// 错误
// ============================================================

/** 稳定错误码 */
export type BotErrorCode =
  | 'BOT_NOT_FOUND'
  | 'BOT_EXISTS'
  | 'INVALID_ARGS'
  | 'BUDGET_EXCEEDED'
  | 'SANDBOX_VIOLATION'
  | 'ROUTINE_NOT_FOUND'
  | 'INVALID_ROUTINE'
  | 'ASSERT_FAILED'
  | 'UNSUPPORTED_STEP'
  | 'DRY_RUN_BLOCKED'
  | 'GOAL_NOT_FOUND'
  | 'GOAL_ALREADY_EXISTS'
  | 'GOAL_INVALID_TRANSITION'
  | 'GOAL_FORBIDDEN_WRITE'
  | 'RUN_IN_PROGRESS'
  | 'UNKNOWN_TOOL'
  | 'TOOL_LOOP_LIMIT'
  | 'INTERNAL';

/** Bot 领域错误 */
export class BotError extends Error {
  constructor(
    public readonly code: BotErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'BotError';
  }
}

// ============================================================
// 配置
// ============================================================

/** 插件配置（与 cordis.patch.yml 中的 config 对应） */
export interface BotPluginConfig {
  /** 数据根目录 */
  homeDir: string;
  /** 默认提供方 */
  defaultProvider: string;
  /** 默认模型 */
  defaultModel: string;
  /** 默认推理强度 */
  defaultReasoningEffort: ReasoningEffort;
  /** ⭐ 默认 dry-run（安全优先） */
  defaultDryRun: boolean;
  /** 调度器 tick 间隔（毫秒） */
  schedulerTickMs: number;
  /** ⭐ 是否错峰调度（避开 DeepSeek 高峰时段） */
  costSensitiveScheduling: boolean;
  /** 默认每日预算（人民币） */
  defaultDailyCny: number;
  /** 默认每月预算（人民币） */
  defaultMonthlyCny: number;
  /** 每个 Bot 保留多少个 workspace 快照（默认 10） */
  snapshotKeepRecent?: number;
  /** 是否在真实执行前自动打快照（默认 true） */
  snapshotEnabled?: boolean;
}
