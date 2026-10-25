/**
 * RoutineRunner — 执行引擎
 *
 * 这是「收得回」落地的核心：所有副作用在分发前经过 dry-run 判定。
 */

import {
  BotError,
  shouldBlockInDryRun,
  sideEffectOf,
  type GoalState,
  type RunRecord,
  type RunTrigger,
  type StepRecord,
  type RunUsage,
  type BotIdentity,
  type ReasoningEffort,
} from '../types.js';
import type { BotService } from '../service.js';
import type { LlmCallInput, LlmCallOutput, NormalizedTool } from '../llm/bridge.js';
import { normalizeToolEntry } from '../llm/bridge.js';
import {
  interpolate,
  evalAssert,
  type Routine,
  type RoutineStep,
} from './schema.js';
import {
  applyAssessment,
  goalStatusLabel,
  goalTypeLabel,
  parseAssessment,
  ASSESSMENT_OPEN,
  ASSESSMENT_CLOSE,
} from '../goal/state.js';

/** 执行选项 */
export interface RunFlags {
  dryRun: boolean;
  trigger: RunTrigger;
}

/** LLM 调用器接口（由插件注入，便于测试替换） */
export interface LlmInvoker {
  (input: LlmCallInput): Promise<LlmCallOutput>;
}

/** 工具调用器接口 */
export interface ToolInvoker {
  /** 工具是否存在 */
  has(name: string): boolean;
  /** 调用工具 */
  call(name: string, args: unknown, signal?: AbortSignal): Promise<unknown>;
  /** 宿主工具清单；元素形状不保证（字符串/对象都可能），消费端归一化 */
  list?(): unknown[];
}

export interface RunnerDeps {
  service: BotService;
  llm: LlmInvoker;
  tools: ToolInvoker;
  /** 用于生成 ID 与时间戳 */
  newId(prefix: string): string;
  nowIso(): string;
  /** 是否在运行前打快照（默认 true） */
  snapshotEnabled?: boolean;
  /**
   * 运行时模型兜底：Bot 绑定的 provider 在当前环境不可用时的替代项。
   *
   * 背景：宿主重启可能把 Bot 模型重置为 profile 默认（如 zcode），
   * 而 Bot 桥未必有对应适配器，运行必然失败。提供此回调时，
   * 运行前校验 provider 可用性，不可用则兜底并记录告警（不写回 identity，
   * 下次仍以 identity 为准）。
   */
  resolveRunnableModel?: (bot: BotIdentity) => Promise<{
    provider: string;
    model: string;
    reasoningEffort: ReasoningEffort;
    fallbackUsed: boolean;
    note?: string;
  }>;
}

/** 工具循环的轮数上限：防模型无限循环调用 */
const MAX_TOOL_ROUNDS = 8;

/**
 * 从模型文本里解析工具调用标记。
 *
 * 为什么是文本协议（0.2.0 真机教训）：原生 tools 选项被当前适配器
 * 静默丢弃（模型自述「没有可用工具」）。文本协议不赌适配器能力——
 * 工具目录进系统提示，模型用 ```tool 块发起调用，任何模型都可用。
 * 原生 toolUses 仍然兼容（见 runTaskLocked：native 优先）。
 *
 * 识别规则：任何围栏代码块，内容是 JSON 且含字符串字段 tool/name
 * （工具名不允许空白）。解析成功的块从总结文本中剥除。
 */
export function parseToolCallMarkers(
  text: string,
): { calls: Array<{ name: string; args: unknown }>; cleaned: string } {
  const calls: Array<{ name: string; args: unknown }> = [];
  const cleaned = text
    .replace(/```[\w-]*[ \t]*\r?\n([\s\S]*?)```/g, (full, body: string) => {
      let obj: unknown;
      try {
        obj = JSON.parse(body.trim());
      } catch {
        return full; // 不是 JSON，留给用户看
      }
      if (!obj || typeof obj !== 'object') return full;
      const o = obj as Record<string, unknown>;
      const rawName =
        typeof o.tool === 'string' ? o.tool : typeof o.name === 'string' ? o.name : undefined;
      if (!rawName || /\s/.test(rawName)) return full;
      calls.push({
        name: rawName,
        args: (o.args ?? o.input ?? o.arguments ?? {}) as unknown,
      });
      return '';
    })
    .trim();
  return { calls, cleaned };
}

/** 把工具目录渲染进系统提示（每行截断，防 prompt 失控） */
function renderToolDirectory(tools: NormalizedTool[]): string {
  return tools
    .map((t) => {
      let params = '';
      if (t.parameters !== undefined) {
        try {
          params = JSON.stringify(t.parameters);
        } catch {
          params = '';
        }
      }
      if (params.length > 400) params = params.slice(0, 400) + '…';
      const desc = (t.description ?? '').split('\n')[0];
      const line = `- ${t.name}${desc ? `：${desc}` : ''}${params ? `（参数：${params}）` : ''}`;
      return line.length > 600 ? line.slice(0, 600) + '…' : line;
    })
    .join('\n');
}

/** 白名单模式匹配：`read` 精确，`web_*` 前缀通配 */
function matchToolPattern(pattern: string, name: string): boolean {
  if (pattern.endsWith('*')) return name.startsWith(pattern.slice(0, -1));
  return pattern === name;
}

/**
 * 工具策略拒绝原因；undefined = 允许。
 *
 * 三道默认门（未显式授权时）：
 *   1. allowedTools 已配置 → 名单外一律拒绝
 *   2. bot_ 与 routine_ 前缀的自管理工具 → 拒绝（运行中管理 Bot = 无界递归与自我提权）
 *   3. 外部副作用工具（sideEffectOf === 'external'）→ 拒绝（渐进放权）
 */
export function toolPolicyDenyReason(
  bot: { capabilities?: { allowedTools?: string[] } } | undefined,
  name: string,
): string | undefined {
  const allowed = bot?.capabilities?.allowedTools;
  const explicitlyAllowed =
    allowed?.some((pat) => matchToolPattern(pat, name)) ?? false;

  if (allowed !== undefined && !explicitlyAllowed) {
    return '不在该 Bot 的工具白名单（allowedTools）里';
  }
  if (!explicitlyAllowed && (name.startsWith('bot_') || name.startsWith('routine_'))) {
    return 'Bot 运行中不可调用 bot_*/routine_* 自管理工具（递归防护）';
  }
  if (!explicitlyAllowed && sideEffectOf(name) === 'external') {
    return '外部副作用工具默认不授权（可在 Bot 的 allowedTools 里显式放开）';
  }
  return undefined;
}

/** 暴露给 Routine 的环境变量白名单：仅 DSH_BOT_* 前缀 */
function safeEnv(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k.startsWith('DSH_BOT_') && typeof v === 'string') out[k] = v;
  }
  return out;
}

function emptyUsage(): RunUsage {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheHitTokens: 0,
    cacheMissTokens: 0,
    reasoningTokens: 0,
    costCny: 0,
  };
}

function addUsage(a: RunUsage, b: RunUsage): RunUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheHitTokens: a.cacheHitTokens + b.cacheHitTokens,
    cacheMissTokens: a.cacheMissTokens + b.cacheMissTokens,
    reasoningTokens: a.reasoningTokens + b.reasoningTokens,
    ...mergeCost(a, b),
  };
}

/**
 * 成本合并。规则（与「0 ≠ 未知」的展示原则一致）：
 * - 任何一侧是 unknown，或金额缺失/NaN → 合计 unknown（金额 undefined）
 *   （undefined + undefined 曾把这里算成 NaN，落盘再读回变 null，
 *    预算统计就把「算不出来」当成了「免费」）
 * - 两侧都 free → free
 * - 其余（exact、或无 kind 的历史数据）→ 数值相加，kind 标 exact
 */
function mergeCost(
  a: RunUsage,
  b: RunUsage,
): Pick<RunUsage, 'costCny' | 'costKind' | 'costNote'> {
  if (a.costKind === 'unknown' || b.costKind === 'unknown') {
    return {
      costCny: undefined,
      costKind: 'unknown',
      costNote: a.costNote ?? b.costNote ?? '部分调用无价格数据',
    };
  }
  if (a.costKind === 'free' && b.costKind === 'free') {
    return { costCny: 0, costKind: 'free' };
  }
  const av = a.costKind === 'free' ? 0 : a.costCny;
  const bv = b.costKind === 'free' ? 0 : b.costCny;
  if (
    av === undefined ||
    bv === undefined ||
    Number.isNaN(av) ||
    Number.isNaN(bv)
  ) {
    return {
      costCny: undefined,
      costKind: 'unknown',
      costNote: '部分调用无价格数据',
    };
  }
  return { costCny: av + bv, costKind: 'exact' };
}

export class RoutineRunner {
  constructor(private readonly deps: RunnerDeps) {}

  /**
   * ⭐ 预算收口：RoutineRunner 是所有执行路径（工具调用 / 调度器 / 面板 HTTP）
   * 共同经过的唯一入口，预算门必须设在这里。
   *
   * 之前只有两个工具入口做 checkBudget——定时触发和面板「执行」
   * 可以无限花钱；且检查发生在运行前，运行中失控照样花完。
   * 现在：运行开始校验存量，每个步骤后按「本运行累计」增量熔断。
   */
  private async budgetBaseline(botId: string): Promise<{ day: number; month: number }> {
    const [day, month] = await Promise.all([
      this.deps.service.spentToday(botId),
      this.deps.service.spentThisMonth(botId),
    ]);
    return { day, month };
  }

  /** 存量 + 本运行累计是否越线；越线返回错误对象，否则 null */
  private overBudget(
    bot: { budget: { dailyCny: number; monthlyCny: number } },
    baseline: { day: number; month: number },
    runCostCny: number | undefined,
  ): { code: string; message: string } | null {
    // 本轮成本算不出来（无价格数据）时无法增量判断——
    // 宁可放行也不误杀（存量门在运行开始已把过关）。
    if (runCostCny === undefined) return null;
    if (baseline.day + runCostCny > bot.budget.dailyCny) {
      return {
        code: 'BUDGET_EXCEEDED',
        message:
          `今日预算 ¥${bot.budget.dailyCny}：已花 ¥${baseline.day.toFixed(4)} + ` +
          `本轮 ¥${runCostCny.toFixed(4)} 越线，已熔断。`,
      };
    }
    if (baseline.month + runCostCny > bot.budget.monthlyCny) {
      return {
        code: 'BUDGET_EXCEEDED',
        message:
          `本月预算 ¥${bot.budget.monthlyCny}：已花 ¥${baseline.month.toFixed(4)} + ` +
          `本轮 ¥${runCostCny.toFixed(4)} 越线，已熔断。`,
      };
    }
    return null;
  }

  /**
   * 组装系统提示的动态上下文。
   *
   * 这是「记得住」真正生效的地方：目标、事实、最近运行都从这里
   * 进入系统提示。任何一个读失败都不该让运行失败——降级为省略。
   */
  private async buildPromptContext(botId: string): Promise<PromptContext> {
    const ctx: PromptContext = {};

    try {
      ctx.goal = await this.deps.service.getGoal(botId);
    } catch {
      /* 无目标 */
    }

    try {
      const semantic = await this.deps.service.getSemantic(botId);
      // 偏好优先（它是长期稳定的），其次事实
      ctx.facts = [...semantic.preferences, ...semantic.facts].slice(0, 8);
    } catch {
      /* 无记忆 */
    }

    try {
      const runs = await this.deps.service.listRuns(botId, 3);
      // 当前这轮还没存，所以这里的"最近"就是上一轮及更早
      ctx.recentRuns = runs.map((r) => ({
        startedAt: r.startedAt,
        status: r.status,
        dryRun: r.dryRun,
        steps: r.steps,
      }));
    } catch {
      /* 无历史 */
    }

    return ctx;
  }

  /**
   * 把本轮的评估作用到目标上，并把效果写进记录。
   *
   * 所有「Bot 能不能改目标」的判定都收口在 `applyAssessment` 里，
   * 这里只负责读取、调用、落盘。
   */
  private async settleGoal(
    botId: string,
    record: RunRecord,
    output: string,
  ): Promise<string> {
    const goal = await this.deps.service.getGoal(botId);

    const parsed = parseAssessment(output);
    if (!parsed.assessment) {
      record.goalEffect = 'none';
      return parsed.text;
    }

    record.goalAssessment = parsed.assessment;
    record.goalId = goal?.id;

    const applied = applyAssessment(goal, parsed.assessment, {
      dryRun: record.dryRun,
      nowIso: this.deps.nowIso(),
    });

    if (!applied) {
      record.goalEffect = 'none';
      return parsed.text;
    }

    await this.deps.service.saveGoal(botId, applied.goal);
    record.goalEffect = applied.effect;

    // 把重要状态变化记进长期记忆，让人事后能追溯
    if (applied.effect === 'pending' || applied.effect === 'blocked') {
      try {
        await this.deps.service.appendMemory(botId, {
          kind: 'observation',
          summary:
            applied.effect === 'pending'
              ? `目标「${applied.goal.description}」自评已完成，等待确认`
              : `目标「${applied.goal.description}」卡住了：${parsed.assessment.note ?? ''}`,
          tags: ['goal', applied.effect],
          importance: 5,
          runId: record.id,
        });
      } catch {
        /* 记忆失败不影响主线 */
      }
    }

    return parsed.text;
  }

  // ---------- per-bot 运行互斥 ----------
  // 同一 Bot 同时只能有一个运行：调度器 tick 与面板「执行」并发时，
  // 两个 run 会并发 createSnapshot（捕获到对方写了一半的状态）、
  // 并发写 workspace、并发写 run 记录（P1-3）。
  private readonly runningBots = new Set<string>();

  private async withBotLock<T>(botId: string, fn: () => Promise<T>): Promise<T> {
    if (this.runningBots.has(botId)) {
      throw new BotError(
        'RUN_IN_PROGRESS',
        '这个 Bot 已有运行在进行中，等它结束再触发（并发运行会互相踩工作区）。',
      );
    }
    this.runningBots.add(botId);
    try {
      return await fn();
    } finally {
      this.runningBots.delete(botId);
    }
  }

  /** 执行一个 Routine */
  async runRoutine(
    botId: string,
    routine: Routine,
    flags: RunFlags,
    signal?: AbortSignal,
  ): Promise<RunRecord> {
    return this.withBotLock(botId, () =>
      this.runRoutineLocked(botId, routine, flags, signal),
    );
  }

  private async runRoutineLocked(
    botId: string,
    routine: Routine,
    flags: RunFlags,
    signal?: AbortSignal,
  ): Promise<RunRecord> {
    const bot = await this.deps.service.get(botId);
    const promptCtx = await this.buildPromptContext(botId);

    const record: RunRecord = {
      id: this.deps.newId('run'),
      botId,
      routineId: routine.metadata.id,
      trigger: flags.trigger,
      startedAt: this.deps.nowIso(),
      endedAt: '',
      dryRun: flags.dryRun,
      status: 'success',
      steps: [],
      usage: emptyUsage(),
    };

    // 预算门（运行开始）：存量已越线就直接拒绝，一步都不跑
    const baseline = await this.budgetBaseline(botId);
    const pre = this.overBudget(bot, baseline, 0);
    if (pre) {
      record.status = 'budget_exceeded';
      record.error = pre;
      record.endedAt = this.deps.nowIso();
      await this.deps.service.saveRun(record);
      return record;
    }

    const vars: Record<string, any> = {
      param: routine.spec.params ?? {},
      steps: {},
      // ⭐ 环境变量白名单：只暴露 DSH_BOT_* 前缀。
      //    之前整包 process.env 进插值上下文——API key 可以经
      //    {{.env.XXX}} 拼进发给模型服务商的 prompt（P2-3）。
      env: safeEnv(),
    };

    const maxAttempts = routine.spec.onError?.retry?.maxAttempts ?? 1;
    const backoffMs = routine.spec.onError?.retry?.backoffMs ?? 0;

    // ⭐ 「收得回」：真实执行前打快照，dry-run 不需要
    if (!flags.dryRun && this.deps.snapshotEnabled !== false) {
      try {
        const meta = await this.deps.service.createSnapshot(bot.workspace, record.id);
        record.snapshotId = meta.id;
      } catch {
        // 快照失败不应阻断执行，但要在记录中体现缺失
      }
    }

    for (let i = 0; i < routine.spec.steps.length; i++) {
      const step = routine.spec.steps[i];
      const t0 = Date.now();
      const stepRecord: StepRecord = {
        index: i,
        kind: step.type,
        name: step.name ?? step.id,
        durationMs: 0,
      };
      record.steps.push(stepRecord);

      let attempt = 0;
      let lastError: unknown;

      while (attempt < maxAttempts) {
        attempt++;
        try {
          await this.execStep(step, botId, bot, flags, vars, record, stepRecord, promptCtx, signal);
          lastError = undefined;
          break;
        } catch (e) {
          lastError = e;
          if (attempt < maxAttempts) {
            if (backoffMs > 0) await sleep(backoffMs);
            continue;
          }
        }
      }

      stepRecord.durationMs = Date.now() - t0;

      // 预算门（运行中）：本运行累计越过余额 → 立即熔断，余下步骤不执行
      const over = this.overBudget(bot, baseline, record.usage.costCny);
      if (over) {
        record.status = 'budget_exceeded';
        record.error = over;
        break;
      }

      if (lastError) {
        stepRecord.error = {
          code: (lastError as any)?.code ?? 'INTERNAL',
          message: String((lastError as any)?.message ?? lastError),
        };

        if (step.optional) {
          // optional 步骤失败不中断
          continue;
        }

        record.status =
          (lastError as any)?.code === 'BUDGET_EXCEEDED' ? 'budget_exceeded' : 'failed';
        record.error = stepRecord.error;
        break;
      }
    }

    // 若中途 break 且未标记，检查是否所有步骤都成功
    if (!record.error && record.status === 'success') {
      const anyBlocked = record.steps.some((s) => s.blocked);
      if (anyBlocked) record.status = 'partial';
    }

    // ⭐ 「守得住」：把最后一个 LLM 步骤的输出当作本轮的自我评估
    //    注意顺序：先结算目标，再存 run（这样 run 里带着 goalEffect）
    const lastLlm = [...record.steps].reverse().find((s) => s.kind === 'llm' && s.result);
    const lastOutput = (lastLlm?.result as any)?.output;
    if (typeof lastOutput === 'string' && lastOutput) {
      try {
        const cleaned = await this.settleGoal(botId, record, lastOutput);
        // 剥掉评估块后再展示
        if (cleaned !== lastOutput && lastLlm) {
          (lastLlm.result as any).output = cleaned;
        }
      } catch {
        // 目标结算失败不该让整轮运行失败
        record.goalEffect = 'none';
      }
    }

    // ⭐ 执行成功后补拍一个"结果快照"，让用户可以回到这个成功状态
    //    （执行前的快照用于"撤销本次执行"，执行后的快照用于"回到本次结果"）
    if (!flags.dryRun && this.deps.snapshotEnabled !== false && record.status === 'success') {
      try {
        const meta = await this.deps.service.createSnapshot(bot.workspace, record.id);
        record.snapshotIdAfter = meta.id;
      } catch {
        // 补拍失败不影响运行结果
      }
    }

    record.endedAt = this.deps.nowIso();
    await this.deps.service.saveRun(record);

    // ⭐ 记忆写入下沉到 runner，保证任何入口（工具调用或程序化调用）都生效
    await this.recordMemory(
      botId,
      record,
      `执行流程「${routine.metadata.name}」`,
      routine.metadata.id,
    );

    return record;
  }

  /** 执行单步 */
  private async execStep(
    step: RoutineStep,
    botId: string,
    bot: any,
    flags: RunFlags,
    vars: Record<string, any>,
    record: RunRecord,
    stepRecord: StepRecord,
    promptCtx: PromptContext,
    signal?: AbortSignal,
  ): Promise<void> {
    switch (step.type) {
      case 'tool': {
        const args = interpolate(step.args ?? {}, vars);
        stepRecord.args = args;

        // ⭐ dry-run 拦截
        if (flags.dryRun && shouldBlockInDryRun(step.tool)) {
          const effect = sideEffectOf(step.tool);
          stepRecord.blocked = {
            reason:
              effect === 'external'
                ? `[dry-run] 将调用外部工具 ${step.tool}，参数：${shortJson(args)}`
                : `[dry-run] 将本地执行 ${step.tool}，参数：${shortJson(args)}`,
          };
          vars.steps[step.id] = { result: { dryRunBlocked: true } };
          return;
        }

        if (!this.deps.tools.has(step.tool)) {
          throw new BotError('UNKNOWN_TOOL' as any, `工具不存在：${step.tool}`);
        }

        const result = await this.deps.tools.call(step.tool, args, signal);
        stepRecord.result = result;
        vars.steps[step.id] = { result };

        this.runAsserts(step.assert, { result }, step.id);
        return;
      }

      case 'llm': {
        const prompt = String(interpolate(step.prompt, vars));

        const provider = step.model?.provider ?? bot.model.provider;
        const model = step.model?.model ?? bot.model.model;
        const reasoningEffort =
          step.model?.reasoningEffort ?? bot.model.reasoningEffort;

        const out = await this.deps.llm({
          provider,
          model,
          reasoningEffort,
          system: buildSystemPrompt(bot, promptCtx),
          prompt,
          maxTokens: step.maxTokens,
          signal,
        });

        record.usage = addUsage(record.usage, out.usage);
        vars.steps[step.id] = { output: out.text };
        stepRecord.result = { output: out.text };
        stepRecord.args = { prompt };

        this.runAsserts(step.assert, { output: out.text, result: { output: out.text } }, step.id);
        return;
      }

      case 'script': {
        const code = String(interpolate(step.code, vars));
        stepRecord.args = { code };

        if (flags.dryRun) {
          stepRecord.blocked = {
            reason: `[dry-run] 将执行脚本：${code.slice(0, 200)}`,
          };
          vars.steps[step.id] = { output: undefined };
          return;
        }

        const value = await runScript(code, vars);
        vars.steps[step.id] = { output: value };
        stepRecord.result = { output: value };

        this.runAsserts(step.assert, { output: value }, step.id);
        return;
      }

      default:
        throw new BotError(
          'UNSUPPORTED_STEP',
          `未知步骤类型：${(step as any).type}`,
        );
    }
  }

  private runAsserts(
    asserts: { expr: string; message: string }[] | undefined,
    scope: Record<string, any>,
    stepId: string,
  ): void {
    if (!asserts?.length) return;
    for (const a of asserts) {
      let ok = false;
      try {
        ok = evalAssert(a.expr, scope);
      } catch {
        ok = false;
      }
      if (!ok) {
        throw new BotError(
          'ASSERT_FAILED',
          `步骤 ${stepId} 断言失败：${a.message}（表达式 ${a.expr}）`,
        );
      }
    }
  }

  /** 自由任务：不套 Routine，直接一轮 LLM 执行 */
  async runTask(
    botId: string,
    task: string,
    flags: RunFlags,
    signal?: AbortSignal,
  ): Promise<RunRecord> {
    return this.withBotLock(botId, () =>
      this.runTaskLocked(botId, task, flags, signal),
    );
  }

  private async runTaskLocked(
    botId: string,
    task: string,
    flags: RunFlags,
    signal?: AbortSignal,
  ): Promise<RunRecord> {
    const bot = await this.deps.service.get(botId);

    const record: RunRecord = {
      id: this.deps.newId('run'),
      botId,
      trigger: flags.trigger,
      startedAt: this.deps.nowIso(),
      endedAt: '',
      dryRun: flags.dryRun,
      status: 'success',
      steps: [],
      usage: emptyUsage(),
    };

    // 预算门（运行开始）：与 runRoutine 同一道门——
    // 面板「执行」、目标节奏触发走的都是这里
    const baseline = await this.budgetBaseline(botId);
    const pre = this.overBudget(bot, baseline, 0);
    if (pre) {
      record.status = 'budget_exceeded';
      record.error = pre;
      record.endedAt = this.deps.nowIso();
      await this.deps.service.saveRun(record);
      return record;
    }

    const t0 = Date.now();
    const stepRecord: StepRecord = {
      index: 0,
      kind: 'llm',
      name: 'task',
      durationMs: 0,
    };
    record.steps.push(stepRecord);

    // ⭐ 真实任务执行前打快照
    if (!flags.dryRun && this.deps.snapshotEnabled !== false) {
      try {
        const meta = await this.deps.service.createSnapshot(bot.workspace, record.id);
        record.snapshotId = meta.id;
      } catch {
        // 快照失败不阻断
      }
    }

    // ⭐ 工具循环（v0.2 核心升级）：Bot 不再「只能说不能做」。
    //    之前 runTask 是单次文本调用，模型只能产出虚构的工作汇报，
    //    而系统提示还要求它「真的去做」——目标状态机建立在幻觉上。
    //    现在：模型发起工具调用 → 策略门 → dry-run 分级拦截 →
    //    真实分发（复用 Routine 工具步骤的同一套语义）→ 结果回喂 →
    //    直至模型给出总结（或轮数耗尽）。
    //
    //    协议选择（0.2.0 真机教训）：**文本协议为主**——工具目录进
    //    系统提示，模型用 ```tool 块发起调用。原生 tools 选项曾被当前
    //    适配器静默丢弃（模型自述「没有可用工具」），不再赌它；
    //    适配器真返回了原生 toolUses 也照常执行（native 优先）。
    const toolSchemas = this.selectToolSchemas(bot);
    const system = buildSystemPrompt(bot, await this.buildPromptContext(botId), {
      toolDirectory: toolSchemas.length ? renderToolDirectory(toolSchemas) : undefined,
    });

    let convo: any[] | undefined;
    let finalText = '';
    let rounds = 0;
    let endedByLimit = false;

    try {
      // 运行时模型兜底：绑定的 provider 在当前环境不可用时切换到可运行项
      let effectiveModel = {
        provider: bot.model.provider,
        model: bot.model.model,
        reasoningEffort: bot.model.reasoningEffort,
      };
      if (this.deps.resolveRunnableModel) {
        try {
          const resolved = await this.deps.resolveRunnableModel(bot);
          effectiveModel = {
            provider: resolved.provider,
            model: resolved.model,
            reasoningEffort: resolved.reasoningEffort,
          };
          if (resolved.fallbackUsed) {
            stepRecord.args = {
              modelFallback: `Bot 绑定的 ${bot.model.provider}/${bot.model.model} 当前不可运行，已兜底为 ${resolved.provider}/${resolved.model}。${resolved.note ?? ''}`,
            };
          }
        } catch {
          /* 探测失败不阻断，按原绑定执行 */
        }
      }
      for (rounds = 0; rounds <= MAX_TOOL_ROUNDS; rounds++) {
        const out = await this.deps.llm({
          provider: effectiveModel.provider,
          model: effectiveModel.model,
          reasoningEffort: effectiveModel.reasoningEffort,
          system,
          prompt: task,
          messages: convo,
          signal,
        });
        record.usage = addUsage(record.usage, out.usage);

        // 运行中预算熔断（多轮累计，越过立即停）
        const over = this.overBudget(bot, baseline, record.usage.costCny);
        if (over) {
          record.status = 'budget_exceeded';
          record.error = over;
          break;
        }

        const rawText = out.text ?? '';
        const native = out.toolUses ?? [];
        let uses: Array<{ id?: string; name: string; input: unknown }>;
        let cleanedText: string;

        if (native.length > 0) {
          // 原生工具协议（适配器真支持时）
          uses = native.map((u) => ({ id: u.id, name: u.name, input: u.input }));
          cleanedText = rawText;
        } else {
          // 文本协议
          const parsed = parseToolCallMarkers(rawText);
          uses = parsed.calls.map((c) => ({ name: c.name, input: c.args }));
          cleanedText = parsed.cleaned;
        }

        if (uses.length === 0) {
          finalText = cleanedText;
          break;
        }

        if (rounds === MAX_TOOL_ROUNDS) {
          endedByLimit = true;
          break;
        }

        // 执行每个工具调用：审计一条 StepRecord，并把结果回喂给模型
        const assistantBlocks: any[] = [];
        const resultBlocks: any[] = [];

        for (const u of uses) {
          const id = u.id ?? this.deps.newId('tu');
          if (native.length > 0) {
            assistantBlocks.push({
              type: 'tool_use',
              id,
              name: u.name,
              input: u.input ?? {},
            });
          }

          const sr: StepRecord = {
            index: record.steps.length,
            kind: 'tool',
            name: u.name,
            args: u.input,
            durationMs: 0,
          };
          const tTool = Date.now();
          const verdict = await this.dispatchToolUse(bot, u.name, u.input, flags, signal);
          sr.durationMs = Date.now() - tTool;
          if (verdict.blocked) sr.blocked = { reason: verdict.blocked };
          else if (verdict.error) sr.error = verdict.error;
          else sr.result = verdict.result;
          record.steps.push(sr);

          if (native.length > 0) {
            resultBlocks.push({
              type: 'tool_result',
              tool_use_id: id,
              content: verdict.contentForModel,
            });
          } else {
            resultBlocks.push({
              type: 'text',
              text: `[${u.name}] ${verdict.contentForModel}`,
            });
          }
        }

        if (native.length > 0) {
          if (rawText.trim()) {
            assistantBlocks.unshift({ type: 'text', text: rawText });
          }
          convo = [
            ...(convo ?? [{ role: 'user', content: [{ type: 'text', text: task }] }]),
            { role: 'assistant', content: assistantBlocks },
            { role: 'user', content: resultBlocks },
          ];
        } else {
          // 文本协议：结果以普通文本回喂。
          //
          // ⚠️ 真机教训（0.2.x）：曾按 [user task][assistant 原文][user 结果]
          // 三段式回喂，deepseek-account 适配器在第二轮稳定返回空完成
          // （无 usage，疑似 thinking 模型对无 reasoning_content 的 assistant
          // 历史处理异常）。改为把首轮任务与工具结果合并成单条 user 消息——
          // 文本协议下 assistant 的 tool 块本来就是可再生的提示文本，
          // 丢弃它不损失信息，模型在单消息里看到任务+结果即可写总结。
          const priorUserText =
            convo === undefined
              ? task
              : (() => {
                  // 多轮文本协议：把已有 user/assistant 文本摊平
                  const parts: string[] = [];
                  for (const m of convo ?? []) {
                    const blocks = Array.isArray(m.content) ? m.content : [];
                    for (const b of blocks) {
                      if (b?.type === 'text' && typeof b.text === 'string') parts.push(b.text);
                    }
                  }
                  return parts.join('\n\n');
                })();
          convo = [
            {
              role: 'user',
              content: [
                {
                  type: 'text',
                  text:
                    `${priorUserText}\n\n` +
                    `（系统）以下是上一轮你发起的工具调用的执行结果，请据此继续；` +
                    `如已拿到足够信息，直接输出面向用户的总结：\n\n` +
                    resultBlocks.map((b: any) => b.text).join('\n\n'),
                },
              ],
            },
          ];
        }
      }

      // ⚠️ 空结果/轮数耗尽都不能算成功——成功必须意味着真的做了事
      if (endedByLimit) {
        record.status = 'failed';
        record.error = {
          code: 'TOOL_LOOP_LIMIT',
          message:
            `连续 ${MAX_TOOL_ROUNDS} 轮工具调用仍未给出总结，已中止。` +
            '可能是工具结果无法满足目标，或模型陷入循环调用。',
        };
      } else if (record.status === 'success' && !finalText.trim()) {
        record.status = 'failed';
        record.error = {
          code: 'EMPTY_OUTPUT',
          message:
            '模型返回了空内容。常见原因：模型服务未就绪' +
            '（看 ~/.dsh/bot/.plugin-loaded.json 的 llmReady 字段）、' +
            'provider/model 配置不匹配，或本次调用被静默中断。',
        };
      }

      stepRecord.result = { output: finalText };
      stepRecord.args = {
        prompt: task,
        toolRounds: rounds,
        toolSchemas: toolSchemas.length,
      };
      if (record.error) stepRecord.error = record.error;
    } catch (e: any) {
      record.status =
        e?.code === 'BUDGET_EXCEEDED' ? 'budget_exceeded' : 'failed';
      record.error = { code: e?.code ?? 'INTERNAL', message: String(e?.message ?? e) };
      stepRecord.error = record.error;
    }

    stepRecord.durationMs = Date.now() - t0;

    // 与 runRoutine 同一语义：有步骤被拦截的运行标 partial，不是 success
    if (!record.error && record.status === 'success') {
      const anyBlocked = record.steps.some((s) => s.blocked);
      if (anyBlocked) record.status = 'partial';
    }

    // ⭐ 「守得住」：评估本轮并作用到目标
    const taskOutput = (stepRecord.result as any)?.output;
    if (typeof taskOutput === 'string' && taskOutput) {
      try {
        const cleaned = await this.settleGoal(botId, record, taskOutput);
        if (cleaned !== taskOutput) (stepRecord.result as any).output = cleaned;
      } catch {
        record.goalEffect = 'none';
      }
    }

    // ⭐ 成功后补拍结果快照
    if (!flags.dryRun && this.deps.snapshotEnabled !== false && record.status === 'success') {
      try {
        const meta = await this.deps.service.createSnapshot(bot.workspace, record.id);
        record.snapshotIdAfter = meta.id;
      } catch {
        // 忽略
      }
    }

    record.endedAt = this.deps.nowIso();
    await this.deps.service.saveRun(record);

    await this.recordMemory(botId, record, `执行任务「${task.slice(0, 60)}」`, 'task');

    return record;
  }

  /**
   * 按策略挑选 Bot 可用的工具 schema（宿主已注册 ∩ 白名单 − 危险项）。
   *
   * 白名单语义（渐进放权）：
   *   - allowedTools 未配置：只读/本地写工具可用；外部副作用与
   *     bot_ 与 routine_ 前缀的自管理工具默认不放开
   *   - allowedTools 配置后：只允许列出的（支持 prefix* 通配），
   *     显式列出的外部/自管理工具视为用户知情授权
   */
  private selectToolSchemas(bot: {
    capabilities?: { allowedTools?: string[] } ;
  }): NormalizedTool[] {
    try {
      const all = this.deps.tools.list?.() ?? [];
      // 归一化在消费端再做一遍：list() 的实现可能是宿主给的，
      // 形状不归我们管（真机教训：字符串数组 vs 对象数组）
      const normalized = all
        .map(normalizeToolEntry)
        .filter((t): t is NormalizedTool => t !== null);
      return normalized
        .filter((t) => !toolPolicyDenyReason(bot, t.name))
        .slice(0, 40);
    } catch {
      return [];
    }
  }

  /**
   * 单次工具调用的完整判决：策略门 → dry-run 分级拦截 → 真实分发。
   * 与 Routine 工具步骤（execStep）同一套拦截语义。
   * 无论结果如何都返回 contentForModel——让模型看到 [policy]/[dry-run]/[error]
   * 前缀并据此调整行为，而不是把拦截伪装成成功。
   */
  private async dispatchToolUse(
    bot: { capabilities?: { allowedTools?: string[] } },
    name: string,
    args: unknown,
    flags: RunFlags,
    signal?: AbortSignal,
  ): Promise<{
    blocked?: string;
    error?: { code: string; message: string };
    result?: unknown;
    contentForModel: string;
  }> {
    const deny = toolPolicyDenyReason(bot, name);
    if (deny) {
      const reason = `[policy] 工具 ${name} 未获授权：${deny}`;
      return { blocked: reason, contentForModel: reason };
    }

    if (flags.dryRun && shouldBlockInDryRun(name)) {
      const effect = sideEffectOf(name);
      const reason =
        effect === 'external'
          ? `[dry-run] 将调用外部工具 ${name}，参数：${shortJson(args)}`
          : `[dry-run] 将本地执行 ${name}，参数：${shortJson(args)}`;
      return { blocked: reason, contentForModel: reason };
    }

    if (!this.deps.tools.has(name)) {
      const msg = `工具不存在：${name}`;
      return {
        error: { code: 'UNKNOWN_TOOL', message: msg },
        contentForModel: `[error] ${msg}`,
      };
    }

    try {
      const result = await this.deps.tools.call(name, args, signal);
      let forModel: string;
      try {
        forModel = JSON.stringify(result) ?? 'null';
      } catch {
        forModel = String(result);
      }
      if (forModel.length > 8000) forModel = `${forModel.slice(0, 8000)}…(截断)`;
      return { result, contentForModel: forModel };
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      return {
        error: { code: e?.code ?? 'INTERNAL', message: msg },
        contentForModel: `[error] ${name}: ${msg}`,
      };
    }
  }

  /** 把本轮运行写入长期记忆 */
  private async recordMemory(
    botId: string,
    record: RunRecord,
    label: string,
    tag: string,
  ): Promise<void> {
    try {
      const blocked = record.steps.filter((s) => s.blocked).length;
      const summary =
        `${label}：${record.status}` +
        (record.dryRun ? '（dry-run）' : '') +
        (blocked ? `，${blocked} 步被拦截` : '');

      await this.deps.service.appendMemory(botId, {
        kind: 'outcome',
        summary,
        tags: ['run', tag],
        importance: record.status === 'success' ? 3 : 4,
        runId: record.id,
      });
    } catch {
      // 记忆写入失败不应让整个运行失败
    }
  }
}

// ============================================================
// 辅助
// ============================================================

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function shortJson(v: unknown, max = 300): string {
  let s: string;
  try {
    s = JSON.stringify(v);
  } catch {
    s = String(v);
  }
  return s.length > max ? s.slice(0, max) + '…' : s;
}

/**
 * 构造系统提示。
 *
 * ⚠️ 两条硬约束：
 *
 * 1. **KV Cache 友好**：稳定内容（身份/职责/准则）放最前面，
 *    易变内容（目标进展/最近运行）放最后。这样前缀才能命中缓存
 *    ——命中价是未命中的 1/50。
 *
 * 2. **记忆必须被读到**：早期版本这里的入参只有 name/role，
 *    结果记忆每轮都写、却从来没人读，Bot 定时跑的时候
 *    「不记得上一次做过什么」。现在把目标、事实、最近运行都注入。
 */
export function buildSystemPrompt(
  bot: {
    name: string;
    role: string;
    systemPromptExtra?: string;
  },
  ctx?: PromptContext,
  opts?: { toolDirectory?: string },
): string {
  // ========== 稳定段（KV Cache 前缀） ==========
  const stable = [
    `你是「${bot.name}」，一个常驻的 AI 队友。`,
    ``,
    `# 你的职责`,
    bot.role,
    ``,
    `# 工作准则`,
    `1. 先确认目标，再动手。不确定就问，不要猜。`,
    `2. 需要执行有副作用的操作时，说明你将要做什么。`,
    `3. 输出用中文，简洁直接。`,
    `4. 完成后简要总结：做了什么、结果如何、下一步建议。`,
  ];

  // ⭐ 有工具可用时的行为协议。
  //    文本协议（0.2.0 真机教训）：不依赖适配器的原生 function calling
  //    ——它可能被静默丢弃。工具目录直接写进提示，模型用 ```tool 块发起调用。
  if (opts?.toolDirectory) {
    stable.push(
      ``,
      `# 可用工具`,
      opts.toolDirectory,
      ``,
      `# 工具调用协议（必须遵守）`,
      `需要调用工具时，在回复中输出一个 tool 代码块：`,
      `\`\`\`tool`,
      `{"tool": "工具名", "args": { ... 参数 ... }}`,
      `\`\`\``,
      `规则：`,
      `- 每轮可以输出多个 tool 块；系统会执行并把结果回喂给你。`,
      `- 需要事实（文件内容、网页、运行状态）时必须先调用工具核实，不要凭记忆编造。`,
      `- 拿到足够信息后，直接输出面向用户的总结，不要再包含 tool 块。`,
      `- 工具结果以 [policy]（未授权）、[dry-run]（演习拦截）、[error]（失败）开头时，如实向用户说明，不要假装成功。`,
    );
  }

  if (bot.systemPromptExtra) {
    stable.push(``, `# 附加说明`, bot.systemPromptExtra);
  }

  // ========== 易变段 ==========
  const volatile: string[] = [];

  if (ctx?.goal) {
    const g = ctx.goal;
    volatile.push(``, `# 你正在守的目标`);
    volatile.push(
      `${g.description}（${goalTypeLabel(g.type)} · ${goalStatusLabel(g.status)}）`,
    );
    volatile.push(`当前进展：${g.progress}`);
    if (g.nextStep) volatile.push(`下一步：${g.nextStep}`);
    if (g.type === 'standing') {
      volatile.push(`已守护 ${g.cycleCount ?? 0} 轮（这是常驻目标，没有终点）`);
    }
    if (g.status === 'blocked') {
      volatile.push(`⚠️ 这个目标目前卡住了，需要人来处理。先别重复尝试同样的做法。`);
    }
    if (g.status === 'pending_confirmation') {
      volatile.push(`⚠️ 你已判定完成，正在等待人确认。不要重复执行。`);
    }
  }

  if (ctx?.facts?.length) {
    volatile.push(``, `# 你记得的事`);
    for (const f of ctx.facts.slice(0, 8)) volatile.push(`- ${f}`);
  }

  if (ctx?.recentRuns?.length) {
    volatile.push(``, `# 最近几次运行`);
    for (const r of ctx.recentRuns.slice(0, 3)) {
      const when = r.startedAt.slice(0, 16).replace('T', ' ');
      const blocked = r.steps?.filter((s) => s.blocked).length ?? 0;
      volatile.push(
        `- ${when} ${r.status}${r.dryRun ? '（演习）' : ''}` +
          `${blocked ? `，${blocked} 步被拦截` : ''}`,
      );
    }
    volatile.push(``, `以上是你自己记得的历史。不要重复已经做过的事，除非情况有变。`);
  }

  // 目标评估的协议——只在有活目标时才要求，避免无谓消耗
  if (ctx?.goal && (ctx.goal.status === 'active' || ctx.goal.status === 'blocked')) {
    volatile.push(
      ``,
      `# 本轮结束时的自评（必须输出）`,
      ASSESSMENT_OPEN,
      `{"achieved": false, "hasNewSituation": false, "needsHuman": false, "note": "一句话进展", "nextStep": "下一步"}`,
      ASSESSMENT_CLOSE,
      `说明：`,
      `- achieved：只有目标**真的完全达成**才填 true。${''}`,
      `  常驻守护型目标永远填 false（它没有终点）。`,
      `- needsHuman：卡住了、需要人做决定、或发现异常时才填 true。`,
      `- note：这轮实际做了什么，一句话，会写进目标的进展记录。`,
      `- 你**不能**自己宣布目标达成，只能标记为待确认，由人来拍板。`,
    );
  }

  return [...stable, ...volatile].join('\n');
}

/** 系统提示的动态上下文 */
export interface PromptContext {
  goal?: GoalState;
  facts?: string[];
  recentRuns?: Array<{
    startedAt: string;
    status: string;
    dryRun: boolean;
    steps?: Array<{ blocked?: unknown }>;
  }>;
}

/**
 * 在受限沙箱中执行用户脚本。
 *
 * 用 new Function 但只暴露白名单变量，且不提供 require/import/process。
 * 这不是安全边界——真正的隔离依赖 DSH 的 sandbox；
 * 这里只是防止误用，不防御恶意代码。
 */
async function runScript(
  code: string,
  vars: Record<string, any>,
): Promise<unknown> {
  const sandbox: Record<string, any> = {
    param: vars.param,
    steps: vars.steps,
    env: vars.env,
    // 常用内置对象
    JSON,
    Math,
    Date,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Promise,
    console,
    // 常用纯函数，便于数据变换
    parseInt,
    parseFloat,
    isNaN,
    encodeURIComponent,
    decodeURIComponent,
  };

  const names = Object.keys(sandbox);
  const values = names.map((n) => sandbox[n]);

  // 支持 "return xxx" 的表达式风格
  const body = /\breturn\b/.test(code) ? code : `return (${code});`;

  try {
    // ⭐ 用 AsyncFunction 包裹，允许脚本内使用 await
    const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
    const fn = new AsyncFunction(...names, `"use strict";\n${body}`);
    const result = await fn(...values);
    return result;
  } catch (e: any) {
    const msg = String(e?.message ?? e);
    // 针对常见误用给出可操作提示
    if (/await is only valid/.test(msg)) {
      throw new BotError(
        'INTERNAL',
        `script 步骤执行失败：顶层 await 不受支持。请改用 tool 步骤执行 shell 命令。`,
      );
    }
    if (/import|require is not defined|Cannot find module/i.test(msg)) {
      throw new BotError(
        'INTERNAL',
        `script 步骤不提供 import/require，只能做纯数据变换。` +
          `需要读写文件请改用 tool 步骤（如 bash / read / write）。原始错误：${msg}`,
      );
    }
    throw new BotError('INTERNAL', `script 步骤执行失败：${msg}`);
  }
}
