/**
 * bot_goal —— 目标的唯一入口
 *
 * 用一个工具 + action 分派，而不是拆成 9 个工具。
 * 理由：9 个工具会让模型的选择成本变高、也更容易挑错；
 * 一个工具 + 枚举 action 更省 token，也让「Bot 和人共用一扇门」
 * 这件事在接口层面就成立。
 *
 * ⚠️ 写入权限的差异在 `actor` 参数上体现：
 *   - 人调用时 actor='human'（默认），可以做终局判定
 *   - Bot 自己调用时 actor='bot'，只能写进展/待确认/阻塞
 * 实际上这个参数由调用链决定，不由模型自由填——见 `execute` 里的说明。
 */

import { defineTool } from '@deepseek-ai/dsh-tools';

import type { BotService } from '../service.js';
import {
  BotError,
  type GoalState,
  type GoalStatus,
} from '../types.js';
import {
  applyAssessment,
  createGoal,
  goalStatusLabel,
  goalTypeLabel,
  isTerminal,
  parseCadence,
  transitionGoal,
  updateProgress,
} from '../goal/state.js';
import { proposeSuccessors, type ProposalLlm } from '../goal/succession.js';

export interface GoalToolDeps {
  service: BotService;
  newId(prefix: string): string;
  nowIso(): string;
  /** 生成接续候选用；不可用时自动降级为规则 */
  llm?: ProposalLlm;
}

/** action 全集 */
const ACTIONS = [
  'show',
  'set',
  'progress',
  'block',
  'unblock',
  'confirm',
  'reject',
  'abandon',
  'accept',
  'dismiss',
  'history',
] as const;

type Action = (typeof ACTIONS)[number];

/** 人的动作（允许终局判定） */
const HUMAN_ACTIONS = new Set<Action>([
  'set',
  'unblock',
  'confirm',
  'reject',
  'abandon',
  'accept',
  'dismiss',
]);

/** Bot 的动作（只能推进，不能终局） */
const BOT_ACTIONS = new Set<Action>(['progress', 'block']);

export function registerGoalTools(ctx: any, deps: GoalToolDeps): void {
  const { service } = deps;

  ctx.tools.register(
    defineTool({
      name: 'bot_goal',
      description:
        '管理 Bot 的目标（「守得住」的核心）。' +
        'action 取值：show 查看 / set 设定新目标 / progress 更新进展 / ' +
        'block 标记卡住 / unblock 解除阻塞 / confirm 确认达成 / reject 驳回 / ' +
        'abandon 放弃 / accept 接受接续候选 / dismiss 忽略候选 / history 查看目标史。' +
        '⚠️ 只有人能执行 confirm/reject/abandon/set/accept；' +
        'Bot 自己只能 progress/block。目标达成立即归档并自动生成接续候选。',
      parameters: {
        action: {
          type: 'string',
          required: true,
          description: ACTIONS.join(' | '),
        },
        botId: { type: 'string', required: true, description: 'Bot ID' },
        description: {
          type: 'string',
          description: 'set/accept 时使用：目标描述。含节奏的自然语言（如「每过4小时报告一次」）会被自动识别为执行节奏',
        },
        goalType: {
          type: 'string',
          description: '目标类型：one-shot（一次性，默认）或 standing（常驻守护，永不完成）',
        },
        cadence: {
          type: 'string',
          description: '执行节奏（5 段 cron）。不填时自动从 description 识别；识别不到则该目标不会自动执行',
        },
        progress: {
          type: 'string',
          description: 'progress 时使用：本轮进展说明',
        },
        nextStep: { type: 'string', description: '下一步建议' },
        evidence: {
          type: 'string',
          description: '支撑完成判定的依据，多条用换行分隔',
        },
        goalId: {
          type: 'string',
          description: 'accept/dismiss 时使用：候选目标 ID',
        },
        note: {
          type: 'string',
          description: 'confirm/abandon 时的收尾说明，或 reject 时的驳回意见',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args: any, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args: any): Promise<string> {
        const action = String(args.action ?? '') as Action;
        const botId = String(args.botId ?? '');

        if (!ACTIONS.includes(action)) {
          throw new BotError(
            'INVALID_ARGS',
            `未知 action：${action}。可选：${ACTIONS.join(' / ')}`,
          );
        }

        // ⚠️ 这里假定调用方是「人」。Bot 自己在运行时走的是
        //    runner 里的 applyAssessment 路径，不经过这个工具——
        //    所以 Bot 无法通过调用 bot_goal 来给自己发通过证书。
        //    这是一个结构性保证，不是靠参数校验。
        const actor = 'human' as const;

        switch (action) {
          case 'show':
            return await showGoal(service, botId);

          case 'set':
            return await setGoal(deps, botId, args);

          case 'progress':
            return await setProgress(deps, botId, args);

          case 'block':
            return await blockGoal(deps, botId, args);

          case 'unblock':
            return await unblockGoal(deps, botId, actor);

          case 'confirm':
            return await confirmGoal(deps, botId, args);

          case 'reject':
            return await rejectGoal(deps, botId, args);

          case 'abandon':
            return await abandonGoal(deps, botId, args);

          case 'accept':
            return await acceptProposal(deps, botId, args);

          case 'dismiss':
            return await dismissProposal(deps, botId, args);

          case 'history':
            return await showHistory(service, botId);

          default:
            throw new BotError('INVALID_ARGS', `未实现的 action：${action}`);
        }
      },
    }),
  );
}

// ============================================================
// 各 action 的实现
// ============================================================

async function showGoal(service: BotService, botId: string): Promise<string> {
  const goal = await service.getGoal(botId);
  const proposals = await service.listProposals(botId);

  if (!goal && proposals.length === 0) {
    return (
      '这个 Bot 还没有目标。\n' +
      '用 bot_goal(action=set, description="...", goalType="one-shot|standing") 设定。'
    );
  }

  const parts: string[] = [];

  if (goal) {
    parts.push(renderGoal(goal));
  }

  if (proposals.length) {
    parts.push('', `# 接续候选（${proposals.length} 个，等你说要不要做）`);
    for (const p of proposals) {
      parts.push(`· [${p.id}] ${p.description}（${goalTypeLabel(p.type)}）`);
    }
    parts.push('用 bot_goal(action=accept, goalId="...") 接受，或 dismiss 忽略。');
  }

  return parts.join('\n');
}

async function setGoal(deps: GoalToolDeps, botId: string, args: any): Promise<string> {
  const description = String(args.description ?? '').trim();
  if (!description) {
    throw new BotError('INVALID_ARGS', '设定目标时必须提供 description');
  }

  const existing = await deps.service.getGoal(botId);
  if (existing && !isTerminal(existing.status) && existing.status !== 'proposed') {
    throw new BotError(
      'GOAL_ALREADY_EXISTS',
      `这个 Bot 已经在守「${existing.description}」（${goalStatusLabel(existing.status)}）。\n` +
        `先处理掉它：confirm 确认达成 / reject 驳回 / abandon 放弃。`,
    );
  }

  const type = args.goalType === 'standing' ? 'standing' : 'one-shot';
  // ⭐ 与面板 API 路由同一套逻辑：显式 cadence 优先，否则从描述识别。
  //    「每过 4 小时给我报告」这句话本身就含节奏——之前工具路径
  //    完全忽略它，对话里设的目标永远不会自动跑（两个入口行为分裂）。
  const cadence = args.cadence ? String(args.cadence) : parseCadence(description);
  const goal = createGoal(
    deps.newId('goal'),
    {
      description,
      type,
      cadence,
      progress: String(args.progress ?? '') || undefined,
      nextStep: args.nextStep ? String(args.nextStep) : undefined,
    },
    deps.nowIso(),
  );

  await deps.service.saveGoal(botId, goal);
  return `已设定目标：\n\n${renderGoal(goal)}`;
}

async function setProgress(deps: GoalToolDeps, botId: string, args: any): Promise<string> {
  const goal = await requireGoal(deps.service, botId);
  const evidence = args.evidence
    ? String(args.evidence).split('\n').map((s) => s.trim()).filter(Boolean)
    : undefined;

  const next = updateProgress(
    goal,
    {
      progress: args.progress ? String(args.progress) : undefined,
      nextStep: args.nextStep ? String(args.nextStep) : undefined,
      evidence,
    },
    deps.nowIso(),
  );

  await deps.service.saveGoal(botId, next);
  return `已更新进展：\n\n${renderGoal(next)}`;
}

async function blockGoal(deps: GoalToolDeps, botId: string, args: any): Promise<string> {
  const goal = await requireGoal(deps.service, botId);
  const next = transitionGoal(goal, 'blocked', 'bot', deps.nowIso(), {
    progress: args.progress ? String(args.progress) : goal.progress,
  });
  await deps.service.saveGoal(botId, next);
  return `已标记为卡住：\n\n${renderGoal(next)}\n\n处理好后用 unblock 恢复。`;
}

async function unblockGoal(
  deps: GoalToolDeps,
  botId: string,
  actor: 'human',
): Promise<string> {
  const goal = await requireGoal(deps.service, botId);
  if (goal.status !== 'blocked') {
    throw new BotError(
      'GOAL_INVALID_TRANSITION',
      `当前目标状态是 ${goalStatusLabel(goal.status)}，不是卡住，无需解除。`,
    );
  }
  const next = transitionGoal(goal, 'active', actor, deps.nowIso(), {
    progress: goal.progress,
  });
  await deps.service.saveGoal(botId, next);
  return `已解除阻塞，继续守护：\n\n${renderGoal(next)}`;
}

async function confirmGoal(deps: GoalToolDeps, botId: string, args: any): Promise<string> {
  const goal = await requireGoal(deps.service, botId);

  if (goal.status !== 'pending_confirmation') {
    throw new BotError(
      'GOAL_INVALID_TRANSITION',
      `当前状态是 ${goalStatusLabel(goal.status)}，只有「待你确认」的目标才能确认达成。`,
    );
  }

  const done = transitionGoal(goal, 'achieved', 'human', deps.nowIso(), {
    progress: args.progress ? String(args.progress) : goal.progress,
  });

  const outcome = String(args.note ?? '').trim() || done.progress;
  const result = await archiveAndPropose(deps, botId, done, outcome);

  return result;
}

async function rejectGoal(deps: GoalToolDeps, botId: string, args: any): Promise<string> {
  const goal = await requireGoal(deps.service, botId);
  if (goal.status !== 'pending_confirmation') {
    throw new BotError(
      'GOAL_INVALID_TRANSITION',
      `当前状态是 ${goalStatusLabel(goal.status)}，只有「待你确认」的目标才能驳回。`,
    );
  }

  const note = String(args.note ?? '').trim();
  const next = transitionGoal(goal, 'active', 'human', deps.nowIso(), {
    progress: note ? `被驳回：${note}` : '被驳回，继续做',
    nextStep: args.nextStep ? String(args.nextStep) : undefined,
  });

  await deps.service.saveGoal(botId, next);
  return `已驳回，目标回到进行中：\n\n${renderGoal(next)}`;
}

async function abandonGoal(deps: GoalToolDeps, botId: string, args: any): Promise<string> {
  const goal = await requireGoal(deps.service, botId);
  const done = transitionGoal(goal, 'abandoned', 'human', deps.nowIso(), {
    progress: String(args.note ?? '') || '已放弃',
  });

  const outcome = String(args.note ?? '').trim() || '放弃';
  // 放弃不生成接续候选——人已经明确表示不想继续这个方向
  const archive = await doArchive(deps, botId, done, outcome);
  return (
    `已放弃目标并归档：\n\n${archive.description}\n` +
    `累计 ${archive.totalRuns} 次运行 · ¥${archive.totalCostCny.toFixed(4)}`
  );
}

async function acceptProposal(deps: GoalToolDeps, botId: string, args: any): Promise<string> {
  const goalId = String(args.goalId ?? '').trim();
  const proposals = await deps.service.listProposals(botId);

  if (proposals.length === 0) {
    throw new BotError('GOAL_NOT_FOUND', '没有待接受的接续候选。');
  }

  const picked = goalId
    ? proposals.find((p) => p.id === goalId)
    : proposals[0];

  if (!picked) {
    throw new BotError(
      'GOAL_NOT_FOUND',
      `找不到候选 ${goalId}。现有：${proposals.map((p) => p.id).join(', ')}`,
    );
  }

  const next = transitionGoal(picked, 'active', 'human', deps.nowIso(), {
    progress: '刚接受，尚未开始',
    description: args.description ? String(args.description) : picked.description,
  });

  await deps.service.saveGoal(botId, next);
  // 接受一个候选后，其余候选作废——避免面板上堆着过期提议
  await deps.service.clearProposals(botId);

  return `已接受候选，开始守护：\n\n${renderGoal(next)}`;
}

async function dismissProposal(deps: GoalToolDeps, botId: string, args: any): Promise<string> {
  const proposals = await deps.service.listProposals(botId);
  if (proposals.length === 0) {
    return '没有待处理的候选。';
  }

  const goalId = String(args.goalId ?? '').trim();
  if (goalId) {
    await deps.service.removeProposal(botId, goalId);
    return `已忽略候选 ${goalId}。`;
  }

  await deps.service.clearProposals(botId);
  return `已忽略全部 ${proposals.length} 个候选。`;
}

async function showHistory(service: BotService, botId: string): Promise<string> {
  const archives = await service.listGoalArchives(botId);
  if (archives.length === 0) {
    return '还没有已完成的目标。';
  }

  const lines = [`# 目标史（共 ${archives.length} 个，全部保留）`, ''];
  for (const a of archives) {
    const mark = a.status === 'achieved' ? '✅' : '⨯';
    lines.push(
      `${mark} ${a.description}`,
      `   ${goalTypeLabel(a.type)} · ${a.status === 'achieved' ? '已达成' : '已放弃'}` +
        ` · ${a.totalRuns} 次运行 · ¥${a.totalCostCny.toFixed(4)}`,
      `   ${a.createdAt.slice(0, 10)} → ${a.endedAt.slice(0, 10)}`,
    );
    if (a.outcome) lines.push(`   收尾：${a.outcome}`);
  }
  return lines.join('\n');
}

// ============================================================
// 归档与接续（confirm / abandon 共用）
// ============================================================

async function archiveAndPropose(
  deps: GoalToolDeps,
  botId: string,
  goal: GoalState,
  outcome: string,
): Promise<string> {
  const archive = await doArchive(deps, botId, goal, outcome);

  const lines = [
    `已确认达成并归档：`,
    ``,
    `${archive.description}`,
    `历时 ${archive.totalRuns} 次运行 · ¥${archive.totalCostCny.toFixed(4)}`,
    `收尾：${archive.outcome}`,
  ];

  // ⭐ 生成接续候选：Bot 只会"提议"，开张权仍在人手上
  try {
    const { proposals, source } = await proposeSuccessors(
      {
        service: deps.service,
        llm: deps.llm,
        newId: deps.newId,
        nowIso: deps.nowIso,
      },
      botId,
      archive,
    );

    if (proposals.length > 0) {
      lines.push('', `# 建议接下来（${source === 'rule' ? '规则生成' : '模型生成'}）`);
      for (const p of proposals) {
        lines.push(`· [${p.id}] ${p.description}（${goalTypeLabel(p.type)}）`);
      }
      lines.push(
        '',
        '这些只是提议，Bot 不会自己开张。',
        '用 bot_goal(action=accept) 接受，或 dismiss 忽略。',
      );
    }
  } catch {
    lines.push('', '（接续提议生成失败，不影响归档结果）');
  }

  return lines.join('\n');
}

async function doArchive(
  deps: GoalToolDeps,
  botId: string,
  goal: GoalState,
  outcome: string,
) {
  // 统计这个目标期间的花费与运行数
  const runs = await deps.service.listRuns(botId, Number.MAX_SAFE_INTEGER);
  const related = runs.filter((r) => !goal.createdAt || r.startedAt >= goal.createdAt);
  const totalCostCny = related.reduce((s, r) => s + (r.usage?.costCny ?? 0), 0);
  const snapshotIds = related
    .flatMap((r) => [r.snapshotId, r.snapshotIdAfter])
    .filter((x): x is string => Boolean(x));

  const archive = await deps.service.archiveGoal(botId, goal, {
    totalRuns: related.length,
    totalCostCny,
    outcome,
    snapshotIds,
  });

  await deps.service.clearGoal(botId);
  return archive;
}

// ============================================================
// 渲染
// ============================================================

function renderGoal(g: GoalState): string {
  const lines = [
    `# 目标`,
    `${g.description}`,
    `类型：${goalTypeLabel(g.type)} · 状态：${goalStatusLabel(g.status)}`,
    `进展：${g.progress}`,
  ];
  if (g.nextStep) lines.push(`下一步：${g.nextStep}`);
  if (g.type === 'standing') lines.push(`已守护 ${g.cycleCount ?? 0} 轮`);
  if (g.evidence?.length) {
    lines.push(`依据：`);
    for (const e of g.evidence) lines.push(`  · ${e}`);
  }
  if (g.status === 'pending_confirmation') {
    lines.push('', '⚠️ 这个目标在等你确认。confirm 通过 / reject 驳回。');
  }
  if (g.status === 'blocked') {
    lines.push('', '⚠️ 这个目标卡住了，需要人介入。处理好后 unblock。');
  }
  return lines.join('\n');
}

async function requireGoal(service: BotService, botId: string): Promise<GoalState> {
  const goal = await service.getGoal(botId);
  if (!goal) {
    throw new BotError(
      'GOAL_NOT_FOUND',
      '这个 Bot 还没有目标。先用 bot_goal(action=set) 设定一个。',
    );
  }
  return goal;
}

export { renderGoal };
