/**
 * 接续提议（Succession）
 *
 * 解决「一个一次性目标完成后，Bot 是不是就空了」。
 *
 * 设计要点：
 *
 * 1. **Bot 只能提议，不能开张。**
 *    候选状态是 `proposed`，接受权在人。这与「终局需人确认」是同一条原则：
 *    Bot 可以主动想，但不能替你决定下一步要干什么。
 *
 * 2. **提议必须有信息量。**
 *    基于「上一个目标的收尾 + 目标史 + 记忆事实」来生成，
 *    而不是套模板说"要不要继续？"。
 *
 * 3. **模型不可用时要能降级。**
 *    提议是锦上添花，绝不能因为 LLM 挂了就让"目标达成"这个动作失败。
 *    降级路径给出基于规则的三条候选。
 */

import type { BotService } from '../service.js';
import type { GoalArchive, GoalState } from '../types.js';
import { createProposal } from './state.js';

/** 一次提议生成的结果 */
export interface SuccessionResult {
  /** 候选目标（已落盘，状态 proposed） */
  proposals: GoalState[];
  /** 来源：llm 表示模型生成，rule 表示降级规则 */
  source: 'llm' | 'rule';
}

/** LLM 调用器（与 runner 的签名一致） */
export type ProposalLlm = (input: {
  provider: string;
  model: string;
  reasoningEffort: 'low' | 'high' | 'max';
  system?: string;
  prompt: string;
  maxTokens?: number;
}) => Promise<{ text: string }>;

export interface SuccessionDeps {
  service: BotService;
  llm?: ProposalLlm;
  newId(prefix: string): string;
  nowIso(): string;
}

/**
 * 为刚归档的目标生成接续候选。
 *
 * 最多生成 3 条。按「standing 优先」排序——因为大多数一次性任务
 * 真正想要的结果是"以后一直保持这样"，而不是"再找件新事做"。
 */
export async function proposeSuccessors(
  deps: SuccessionDeps,
  botId: string,
  archived: GoalArchive,
): Promise<SuccessionResult> {
  const bot = await deps.service.get(botId);

  let candidates: Array<{ description: string; type: 'one-shot' | 'standing' }> = [];
  let source: 'llm' | 'rule' = 'rule';

  if (deps.llm) {
    try {
      const recentRuns = await deps.service.listRuns(botId, 5);
      const memories = await deps.service.recall(botId, archived.description, 6);
      const history = await deps.service.listGoalArchives(botId);

      const out = await deps.llm({
        provider: bot.model.provider,
        model: bot.model.model,
        reasoningEffort: 'low', // 提议是轻任务，用最低推理强度省钱
        system:
          `你是「${bot.name}」，职责是${bot.role}。` +
          `你刚完成一个目标，现在要提议接下来可以做什么。` +
          `只输出 JSON，不要任何解释。`,
        prompt: buildProposalPrompt(archived, recentRuns, memories, history),
        maxTokens: 600,
      });

      candidates = parseCandidates(out.text);
      if (candidates.length > 0) source = 'llm';
    } catch {
      // 模型挂了不影响接续流程，走规则降级
    }
  }

  if (candidates.length === 0) {
    candidates = ruleBasedCandidates(archived, bot.role);
    source = 'rule';
  }

  // 落盘
  const now = deps.nowIso();
  const proposals: GoalState[] = [];
  for (const c of candidates.slice(0, 3)) {
    const goal = createProposal(
      deps.newId('goal'),
      { description: c.description, type: c.type },
      archived.id,
      now,
    );
    await deps.service.saveProposal(botId, goal);
    proposals.push(goal);
  }

  return { proposals, source };
}

// ============================================================
// 提示词
// ============================================================

function buildProposalPrompt(
  archived: GoalArchive,
  runs: Array<{ startedAt: string; status: string; routineId?: string }>,
  memories: Array<{ summary: string }>,
  history: GoalArchive[],
): string {
  const lines = [
    `# 刚完成的目标`,
    archived.description,
    `收尾：${archived.outcome || '（无）'}`,
    `历时 ${archived.totalRuns} 次运行，花费 ¥${archived.totalCostCny.toFixed(4)}`,
    ``,
  ];

  if (history.length > 0) {
    lines.push(`# 此前的目标（共 ${history.length} 个）`);
    for (const h of history.slice(0, 5)) {
      lines.push(`- ${h.description} → ${h.status}`);
    }
    lines.push(``);
  }

  if (runs.length > 0) {
    lines.push(`# 最近运行`);
    for (const r of runs.slice(0, 5)) {
      lines.push(`- ${r.startedAt.slice(0, 10)} ${r.status}${r.routineId ? ` (${r.routineId})` : ''}`);
    }
    lines.push(``);
  }

  if (memories.length > 0) {
    lines.push(`# 你记得的事`);
    for (const m of memories) lines.push(`- ${m.summary}`);
    lines.push(``);
  }

  lines.push(
    `# 任务`,
    `提议 2-3 个接下来可以做的事。要求：`,
    `1. 第一条优先考虑「把这次的效果变成长期状态」——即 standing 类型，`,
    `   例如"整理一次"完成后提议"从此保持整洁"。这类提议对人价值最高。`,
    `2. 其余可以是相关的一次性延伸任务。`,
    `3. 不要提议与已完成目标重复的事。`,
    `4. 每条描述不超过 30 字，具体可执行，不要空话。`,
    ``,
    `# 输出格式（只输出这个 JSON，不要 markdown 代码块）`,
    `{"candidates":[{"description":"...","type":"standing"},{"description":"...","type":"one-shot"}]}`,
  );

  return lines.join('\n');
}

function parseCandidates(text: string): Array<{ description: string; type: 'one-shot' | 'standing' }> {
  // 容忍 ```json 包裹与前后废话
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return [];

  let raw: any;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }

  const list = Array.isArray(raw?.candidates) ? raw.candidates : [];
  const out: Array<{ description: string; type: 'one-shot' | 'standing' }> = [];
  for (const c of list) {
    const description = typeof c?.description === 'string' ? c.description.trim() : '';
    if (!description) continue;
    out.push({
      description: description.slice(0, 60),
      type: c?.type === 'standing' ? 'standing' : 'one-shot',
    });
  }
  return out;
}

// ============================================================
// 降级：规则生成
// ============================================================

/**
 * 模型不可用时的兜底提议。
 *
 * 不假装聪明——给出的是基于目标描述的直接变换：
 * 「整理下载文件夹」→「让下载文件夹保持整洁」。
 * 宁可朴素但可用，也不要编造一个看不懂的候选。
 */
function ruleBasedCandidates(
  archived: GoalArchive,
  role: string,
): Array<{ description: string; type: 'one-shot' | 'standing' }> {
  const desc = archived.description;
  const out: Array<{ description: string; type: 'one-shot' | 'standing' }> = [];

  // ① 从一次性升格为常驻守护
  const standing = toStanding(desc);
  if (standing) {
    out.push({ description: standing, type: 'standing' });
  }

  // ② 同一职责下的另一个延伸
  out.push({
    description: `继续按惯例维护${shortSubject(desc, role)}，有新情况再报告`,
    type: 'standing',
  });

  return out;
}

/** 「整理下载文件夹」→「让下载文件夹长期保持整洁」 */
function toStanding(desc: string): string | undefined {
  const s = desc.trim();
  if (!s) return undefined;

  // 已经是常驻语义的，不再提议
  if (/保持|持续|长期|一直|每日|每天|定期/.test(s)) return undefined;

  // 动词 + 宾语 → 让宾语保持…
  const m = s.match(/^(整理|清理|归档|归类|汇总|检查|扫描|优化|同步)(.+)$/);
  if (m) {
    const verb = m[1];
    const obj = m[2];
    const keep: Record<string, string> = {
      整理: '保持整洁',
      清理: '保持干净',
      归档: '保持有序',
      归类: '保持有序',
      汇总: '定期汇报',
      检查: '保持健康',
      扫描: '持续监控',
      优化: '保持最优',
      同步: '保持同步',
    };
    return `让${obj}${keep[verb] ?? '保持良好状态'}`;
  }

  return `长期守护「${s.slice(0, 20)}」这件事`;
}

/** 从描述里提取一个主语，用于第二条候选 */
function shortSubject(desc: string, role: string): string {
  const m = desc.match(/^(?:整理|清理|归档|归类|汇总|检查|扫描|优化|同步)(.{1,12})$/);
  return m ? m[1] : role.slice(0, 12);
}
