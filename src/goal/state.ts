/**
 * 目标状态机
 *
 * 这是「守得住」的核心，也是本插件与 Grok Bot / Dots 最重要的分野：
 *
 *   Bot 会自己往前推，但**不能自己宣布胜利**。
 *
 * 现实里没人会信任一个"自己做完了、自己签字验收"的同事。
 * 同理，一个 Agent 如果把「目标已达成」写进自己的长期状态，
 * 那么后面每一轮都会带着这个可能错误的前提往下跑——
 * 这正是「记忆越长、错误延续越久」的发生机制。
 *
 * 所以这里把写入权按行为主体切开：
 *
 *   ┌──────────────────────┬───────┬───────┐
 *   │ 目标状态迁移           │ Bot   │ 人     │
 *   ├──────────────────────┼───────┼───────┤
 *   │ 写进展 progress        │  ✅   │  ✅   │
 *   │ active → pending      │  ✅   │  ✅   │
 *   │ active → blocked      │  ✅   │  ✅   │
 *   │ blocked → active      │  ❌   │  ✅   │
 *   │ pending → active(驳回) │  ❌   │  ✅   │
 *   │ pending → achieved    │  ❌   │  ✅   │
 *   │ proposed → active     │  ❌   │  ✅   │
 *   │ 任何 → abandoned      │  ❌   │  ✅   │
 *   │ 新建目标               │  ❌   │  ✅   │
 *   └──────────────────────┴───────┴───────┘
 *
 * `standing` 类型的目标额外有一条铁律：**永远不能被置为 achieved**。
 * 它没有终点，只有「这一轮完成了」（cycleCount++）。
 */

import {
  BotError,
  type GoalState,
  type GoalStatus,
  type GoalType,
  type RunRecord,
} from '../types.js';

// ============================================================
// 行为主体与合法迁移
// ============================================================

/** 谁在发起这次变更 */
export type GoalActor = 'bot' | 'human';

/**
 * 合法的状态迁移表。
 *
 * 用 `from → to` 的集合表达，而不是散落在各处的 if 判断，
 * 这样「Bot 不能宣布胜利」这条规则只需要在一个地方表达和维护。
 */
const LEGAL_TRANSITIONS: Record<GoalActor, Array<[GoalStatus | '(none)', GoalStatus]>> = {
  bot: [
    ['active', 'pending_confirmation'],
    ['active', 'blocked'],
    ['pending_confirmation', 'blocked'],
    // 注意：这里没有 → achieved，没有 → abandoned，没有 proposed → active
  ],
  human: [
    ['(none)', 'active'],
    ['proposed', 'active'],
    ['active', 'pending_confirmation'],
    ['active', 'blocked'],
    ['active', 'achieved'],
    ['active', 'abandoned'],
    ['pending_confirmation', 'active'], // 驳回
    ['pending_confirmation', 'achieved'],
    ['pending_confirmation', 'abandoned'],
    ['blocked', 'active'],
    ['blocked', 'abandoned'],
  ],
};

/** 这个主体能不能做这次迁移 */
export function canTransition(
  from: GoalStatus | '(none)',
  to: GoalStatus,
  actor: GoalActor,
): boolean {
  return LEGAL_TRANSITIONS[actor].some(([f, t]) => f === from && t === to);
}

/** 断言迁移合法，否则抛错并给出可操作提示 */
export function assertTransition(
  from: GoalStatus | '(none)',
  to: GoalStatus,
  actor: GoalActor,
): void {
  if (canTransition(from, to, actor)) return;

  if (actor === 'bot') {
    // 这是最需要解释清楚的一条：Bot 试图自己宣布胜利
    if (to === 'achieved' || to === 'abandoned') {
      throw new BotError(
        'GOAL_FORBIDDEN_WRITE',
        `Bot 不能自己把目标置为 ${to}。` +
          `请改用 status=pending_confirmation 或 needsHuman=true，由人来拍板。`,
      );
    }
    throw new BotError(
      'GOAL_INVALID_TRANSITION',
      `Bot 不能执行 ${from} → ${to}。Bot 可做的迁移只有：` +
        `active→pending_confirmation、active→blocked、pending_confirmation→blocked。`,
    );
  }

  throw new BotError(
    'GOAL_INVALID_TRANSITION',
    `目标不能从 ${from} 变为 ${to}`,
  );
}

// ============================================================
// 状态查询
// ============================================================

/** 是否处于终局状态（不再参与日常调度决策） */
export function isTerminal(status: GoalStatus): boolean {
  return status === 'achieved' || status === 'abandoned';
}

/** 是否是"活的"目标（需要出现在面板主区、参与评估） */
export function isLive(status: GoalStatus): boolean {
  return status === 'active' || status === 'pending_confirmation' || status === 'blocked';
}

/** 是否需要在面板上向人求助 */
export function needsAttention(goal: GoalState | undefined): boolean {
  if (!goal) return false;
  return goal.status === 'pending_confirmation' || goal.status === 'blocked';
}

/** 状态的中文标签 */
export function goalStatusLabel(status: GoalStatus): string {
  const map: Record<GoalStatus, string> = {
    proposed: '待接受',
    active: '进行中',
    pending_confirmation: '待你确认',
    achieved: '已达成',
    blocked: '卡住了',
    abandoned: '已放弃',
  };
  return map[status];
}

/** 类型的中文标签 */
export function goalTypeLabel(type: GoalType): string {
  return type === 'standing' ? '常驻守护' : '一次性';
}

// ============================================================
// 创建
// ============================================================

/** 新建目标时的输入 */
export interface CreateGoalInput {
  description: string;
  type?: GoalType;
  progress?: string;
  nextStep?: string;
  /** ⭐ 执行节奏（cron）。没有它，目标不会自动跑。 */
  cadence?: string;
}

/** 创建一个 active 目标（只能由人触发） */
export function createGoal(id: string, input: CreateGoalInput, nowIso: string): GoalState {
  const description = input.description?.trim();
  if (!description) {
    throw new BotError('INVALID_ARGS', '目标描述不能为空');
  }

  return {
    id,
    type: input.type ?? 'one-shot',
    description,
    status: 'active',
    progress: input.progress ?? '尚未开始',
    createdAt: nowIso,
    updatedAt: nowIso,
    nextStep: input.nextStep,
    needsHuman: false,
    ...(input.cadence ? { cadence: input.cadence } : {}),
    ...(input.type === 'standing' ? { cycleCount: 0 } : {}),
  };
}

/**
 * 把中文口语的执行节奏翻译成 cron。
 *
 * 用户不会写 cron。他只会说「每过 4 小时」「每天早上 9 点」。
 * 这个函数负责把那句话变成调度器认识的东西——
 * 否则「持续任务」就永远只是目标描述里的一句空话。
 *
 * 返回 undefined 表示没识别出节奏（此时目标仍是手动的）。
 */
export function parseCadence(text: string): string | undefined {
  const s = text.trim();

  // 每 N 小时 / 每隔 N 小时 / 每过 N 小时
  // 「过」是口语里最常见的说法（用户原话就是「每过 4 小时」）
  const hourly = s.match(/每(?:隔|过)?\s*(\d{1,2})\s*个?\s*小时/);
  if (hourly) {
    const n = Number(hourly[1]);
    if (n >= 1 && n <= 23) return `0 */${n} * * *`;
  }

  if (/每小时/.test(s)) return '0 * * * *';

  // 每 N 分钟
  const minutely = s.match(/每(?:隔|过)?\s*(\d{1,2})\s*分钟/);
  if (minutely) {
    const n = Number(minutely[1]);
    if (n >= 1 && n <= 59) return `*/${n} * * * *`;
  }

  // 每天早上/上午/下午/晚上 H 点
  const daily = s.match(
    /每天\s*(?:早上|上午|中午|下午|晚上)?\s*(\d{1,2})\s*[点时](?:\s*(\d{1,2})\s*分)?/,
  );
  if (daily) {
    let h = Number(daily[1]);
    const m = Number(daily[2] ?? 0);
    const isPm = /下午|晚上/.test(s);
    if (isPm && h < 12) h += 12;
    if (h >= 0 && h <= 23) return `${m} ${h} * * *`;
  }

  // 每周一/周几 H 点
  const weekly = s.match(/每(?:周|星期)([一二三四五六日天])\s*(?:(\d{1,2})\s*[点时])?/);
  if (weekly) {
    const map: Record<string, number> = {
      日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6,
    };
    const dow = map[weekly[1]];
    const h = Number(weekly[2] ?? 9);
    if (dow !== undefined && h >= 0 && h <= 23) return `0 ${h} * * ${dow}`;
  }

  return undefined;
}

/** 创建一个接续候选（proposed，等人接受） */
export function createProposal(
  id: string,
  input: CreateGoalInput,
  originGoalId: string,
  nowIso: string,
): GoalState {
  const goal = createGoal(id, input, nowIso);
  return {
    ...goal,
    status: 'proposed',
    progress: '等你决定要不要接着做',
    origin: originGoalId,
    ...(input.type === 'standing' ? { cycleCount: 0 } : {}),
  };
}

// ============================================================
// 迁移
// ============================================================

/**
 * 把目标迁移到新状态，返回新对象（不修改入参）。
 *
 * @param actor 谁发起的。Bot 的非法写入会被拒。
 */
export function transitionGoal(
  goal: GoalState,
  to: GoalStatus,
  actor: GoalActor,
  nowIso: string,
  patch?: Partial<
    Pick<GoalState, 'description' | 'progress' | 'nextStep' | 'evidence' | 'needsHuman'>
  >,
): GoalState {
  assertTransition(goal.status, to, actor);

  // ⭐ standing 目标永不达成——它没有终点
  if (to === 'achieved' && goal.type === 'standing') {
    throw new BotError(
      'GOAL_INVALID_TRANSITION',
      `「${goal.description}」是常驻守护型目标，没有终点，不能置为 achieved。` +
        `它只会累积轮次（cycleCount）。`,
    );
  }

  const next: GoalState = {
    ...goal,
    ...patch,
    status: to,
    updatedAt: nowIso,
  };

  // achieved / abandoned 一律不再需要人介入
  if (to === 'achieved' || to === 'abandoned') {
    next.needsHuman = false;
  }
  // blocked 一定需要人介入
  if (to === 'blocked') {
    next.needsHuman = true;
  }
  // pending_confirmation 本质也是在等人——数据上要说实话，
  // 否则「有哪些目标需要我处理」这个问题得靠 if 链去拼，容易漏
  if (to === 'pending_confirmation') {
    next.needsHuman = true;
  }

  return next;
}

/** 只更新进展，不碰状态（Bot 最高频的动作） */
export function updateProgress(
  goal: GoalState,
  patch: {
    progress?: string;
    nextStep?: string;
    evidence?: string[];
    needsHuman?: boolean;
  },
  nowIso: string,
): GoalState {
  const next: GoalState = {
    ...goal,
    updatedAt: nowIso,
  };
  if (patch.progress !== undefined) next.progress = truncate(patch.progress, 500);
  if (patch.nextStep !== undefined) next.nextStep = truncate(patch.nextStep, 200);
  if (patch.evidence !== undefined) next.evidence = patch.evidence.slice(0, 10);
  if (patch.needsHuman !== undefined) next.needsHuman = patch.needsHuman;
  return next;
}

/** standing 目标完成一轮 */
export function bumpCycle(goal: GoalState, nowIso: string): GoalState {
  if (goal.type !== 'standing') return goal;
  return {
    ...goal,
    cycleCount: (goal.cycleCount ?? 0) + 1,
    updatedAt: nowIso,
  };
}

/**
 * 把一轮运行的评估结果作用到目标上。
 *
 * 这是 runner 每轮结束时调用的唯一入口，所有「Bot 能不能改目标」的判定
 * 都收口在这里，避免逻辑散落到 runner 的两条执行路径里。
 *
 * 返回 `null` 表示不需要改动（例如 dry-run、无目标、评估为空）。
 */
export function applyAssessment(
  goal: GoalState | undefined,
  assessment: RunRecord['goalAssessment'],
  opts: { dryRun: boolean; nowIso: string },
): { goal: GoalState; effect: RunRecord['goalEffect'] } | null {
  // dry-run 只记录评估，不动目标——演习不能改变真实状态
  if (opts.dryRun) return null;
  if (!goal) return null;
  if (!assessment) return null;
  if (!isLive(goal.status)) return null;

  const now = opts.nowIso;
  const progressPatch = {
    progress: assessment.note,
    nextStep: assessment.nextStep,
    evidence: goal.evidence,
  };

  // ① 人需要介入：优先于"完成"判定
  //    因为"我卡住了"比"我做完了"更需要被看见
  if (assessment.needsHuman && goal.status !== 'blocked') {
    return {
      goal: transitionGoal(goal, 'blocked', 'bot', now, {
        ...progressPatch,
        progress: assessment.note ?? goal.progress,
      }),
      effect: 'blocked',
    };
  }

  // ② 完成判定
  if (assessment.achieved) {
    if (goal.type === 'standing') {
      // 常驻守护没有终点：这一轮完成 = 轮次 +1，状态不变
      const cycled = bumpCycle(goal, now);
      return {
        goal: updateProgress(cycled, progressPatch, now),
        effect: 'cycle',
      };
    }
    // 一次性目标：只能置为"待确认"，不能自己宣布达成
    return {
      goal: transitionGoal(goal, 'pending_confirmation', 'bot', now, {
        ...progressPatch,
        progress: assessment.note ?? '自评已完成，等待你确认',
        evidence: assessment.note ? [assessment.note] : goal.evidence,
      }),
      effect: 'pending',
    };
  }

  // ③ 只是有进展
  if (assessment.note || assessment.nextStep) {
    return {
      goal: updateProgress(goal, progressPatch, now),
      effect: 'progress',
    };
  }

  return null;
}

// ============================================================
// 评估解析
// ============================================================

/** 评估块的分隔标记 */
export const ASSESSMENT_OPEN = '<<<goal>>>';
export const ASSESSMENT_CLOSE = '<<<!/goal>>>';

/**
 * 从 LLM 输出中解析目标评估块，并把评估块从正文里剥掉。
 *
 * 约定模型在回答末尾输出：
 * ```
 * <<<goal>>>
 * { "achieved": false, "hasNewSituation": true, "needsHuman": false,
 *   "note": "已归档 12 个文件", "nextStep": "清理 .tmp" }
 * <<<!/goal>>>
 * ```
 *
 * 解析失败不抛错——模型漏写是常态，不能因此让整轮运行失败。
 */
export function parseAssessment(text: string): {
  text: string;
  assessment?: RunRecord['goalAssessment'];
} {
  const start = text.indexOf(ASSESSMENT_OPEN);
  if (start < 0) return { text };

  const end = text.indexOf(ASSESSMENT_CLOSE, start);
  const bodyEnd = end < 0 ? text.length : end;
  const json = text.slice(start + ASSESSMENT_OPEN.length, bodyEnd).trim();

  // 正文里剥掉评估块，避免原样显示给用户
  const cleaned = (
    text.slice(0, start) + (end < 0 ? '' : text.slice(end + ASSESSMENT_CLOSE.length))
  ).trim();

  let raw: any;
  try {
    // 容忍 ```json 包裹
    const stripped = json.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    raw = JSON.parse(stripped);
  } catch {
    return { text: cleaned };
  }

  if (!raw || typeof raw !== 'object') return { text: cleaned };

  return {
    text: cleaned,
    assessment: {
      achieved: raw.achieved === true,
      hasNewSituation: raw.hasNewSituation === true,
      needsHuman: raw.needsHuman === true,
      note: typeof raw.note === 'string' ? truncate(raw.note, 500) : undefined,
      nextStep: typeof raw.nextStep === 'string' ? truncate(raw.nextStep, 200) : undefined,
    },
  };
}

// ============================================================
// 辅助
// ============================================================

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '…' : s;
}
