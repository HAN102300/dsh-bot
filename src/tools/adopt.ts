/**
 * bot_adopt — 把持久型需求交给 Bot 接手（聊天介入的落地）
 *
 * 「建议 + 确认」协议的执行侧：主对话模型识别到持久型需求
 * （每 4 小时报告 / 持续盯着 / 定期整理…），先向用户复述
 * 【目标 + 类型 + 节奏 + 预算】，得到确认后调用本工具一次完成：
 *
 *   ① 创建 Bot（模型跟随当前会话）
 *   ② 设定带执行节奏的目标（自然语言节奏 → cron）
 *   ③ 立即演习一次（dry-run）——用户当场看到「接手后会做什么」
 *
 * 为什么是复合工具：让模型连调 bot_create → bot_goal → bot_run
 * 会有中间态（建了 Bot 没目标、目标没节奏），任何一步漏掉都
 * 退化成「看起来接手了，其实不会动」。
 */

import { defineTool } from '@deepseek-ai/dsh-tools';

import type { Context } from '@deepseek-ai/cordis';
import { BotService } from '../service.js';
import { BotError } from '../types.js';
import { createGoal, parseCadence } from '../goal/state.js';
import type { RoutineRunner } from '../routine/runner.js';

export interface AdoptToolDeps {
  service: BotService;
  runner: RoutineRunner;
  newId(prefix: string): string;
  nowIso(): string;
  /** 当前环境暴露给 Bot 的工具数（0 = Bot 只能分析汇报，读不到真实数据） */
  hostToolCount?: () => number;
}

export function registerAdoptTool(ctx: Context, deps: AdoptToolDeps): void {
  ctx.tools.register(
    defineTool({
      name: 'bot_adopt',
      description:
        '把一个持久型需求交给常驻 Bot 接手。⚠️ 只在用户明确确认后调用' +
        '（先复述目标/节奏/预算征求同意）。一次完成：创建 Bot + 设定带节奏的目标 + ' +
        '立即演习（dry-run，不产生真实副作用）。适合「每过N小时…/每天…/持续盯着…」类需求；' +
        '一次性问题（看代码、改 bug、查资料）不要用本工具。',
      parameters: {
        name: {
          type: 'string',
          required: true,
          description: 'Bot 的名字，如「服务监测员」',
        },
        role: {
          type: 'string',
          required: true,
          description: '一句话职责，如「每 4 小时检查服务状态并汇报」',
        },
        goal: {
          type: 'string',
          required: true,
          description: '目标描述，保留用户的自然语言节奏（如「每过4小时报告一次 XX 运行状态」），节奏会自动识别',
        },
        goalType: {
          type: 'string',
          description: 'one-shot（一次性）或 standing（常驻守护）。不填则自动判断：识别出节奏 → standing',
        },
        cadence: {
          type: 'string',
          description: '执行节奏（5 段 cron）。不填时自动从 goal 识别；两者都没有则该目标不会自动执行',
        },
        budget: {
          type: 'object',
          description: '预算（人民币），不填用默认',
          additionalProperties: false,
          properties: {
            dailyCny: { type: 'number', description: '每日上限' },
            monthlyCny: { type: 'number', description: '每月上限' },
          },
        },
        dryRunFirst: {
          type: 'boolean',
          description: '接手后是否立即演习一次（默认 true，强烈建议保持）',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args): Promise<string> {
        const name = String(args.name ?? '').trim();
        const role = String(args.role ?? '').trim();
        const goalDesc = String(args.goal ?? '').trim();
        if (!name || !role || !goalDesc) {
          throw new BotError('INVALID_ARGS', 'name / role / goal 都是必填');
        }

        const cadence = args.cadence ? String(args.cadence) : parseCadence(goalDesc);
        const goalType =
          args.goalType === 'one-shot' || args.goalType === 'standing'
            ? args.goalType
            : cadence
              ? 'standing'
              : 'one-shot';

        // ① 创建 Bot（模型跟随会话默认，预算可覆盖）
        const budget = args.budget as Record<string, unknown> | undefined;
        const bot = await deps.service.create({
          name,
          role,
          budget: budget
            ? {
                dailyCny: budget.dailyCny as number | undefined,
                monthlyCny: budget.monthlyCny as number | undefined,
              }
            : undefined,
        });

        // ② 目标带节奏（没节奏要大声说出来，不能假装它会自己跑）
        const goal = createGoal(
          deps.newId('goal'),
          { description: goalDesc, type: goalType as 'one-shot' | 'standing', cadence },
          deps.nowIso(),
        );
        await deps.service.saveGoal(bot.id, goal);

        // ③ 立即演习一次：用户当场看到「接手后会做什么」
        const lines = [
          `✅ Bot「${bot.name}」(${bot.id}) 已接手这个需求`,
          `目标：${goalDesc}（${goalType === 'standing' ? '常驻守护' : '一次性'}）`,
          cadence
            ? `执行节奏：${cadence} —— 到点会自己跑`
            : `⚠️ 没有识别出执行节奏 —— 它不会自己跑，只有你触发才动。` +
              `可在目标描述里写明「每 N 小时 / 每天 N 点」，或用 bot_goal 重新设定。`,
          `预算：日 ¥${bot.budget.dailyCny} / 月 ¥${bot.budget.monthlyCny}`,
        ];

        // ⭐ 真机教训：环境没暴露工具时必须大声说出来，
        //    否则建出一个「每 4 小时烧钱说读不到数据」的空转 Bot
        const hostTools = deps.hostToolCount?.() ?? -1;
        if (hostTools === 0) {
          lines.push(
            '⚠️ 当前环境没有暴露任何可调用的工具——这个 Bot 只能生成分析文本，',
            '   读不到真实数据。请确认宿主的工具服务可用后再真实执行。',
          );
        }

        if (args.dryRunFirst !== false) {
          lines.push('', '—— 接手演习（dry-run，无真实副作用）——');
          try {
            const rec = await deps.runner.runTask(bot.id, goalDesc, {
              dryRun: true,
              trigger: 'goal',
            });
            const blocked = rec.steps.filter((s) => s.blocked).length;
            lines.push(`演习结果：${rec.status}${blocked ? `，${blocked} 步会被拦截` : ''}`);
            if (rec.error) lines.push(`说明：${rec.error.message}`);
          } catch (e: any) {
            // 演习失败不撤销接手——Bot 与目标已就位，如实报告即可
            lines.push(`演习未完成：${e?.message ?? e}（不影响已建好的 Bot 与目标）`);
          }
        }

        lines.push(
          '',
          '下一步：说「演习没问题，真实执行吧」让它真跑一轮；',
          '面板（输入框上方 Bot 面板）里也可以查看与控制它。',
        );

        await deps.service.appendMemory(bot.id, {
          kind: 'decision',
          summary: `经对话确认接手需求：「${goalDesc}」${cadence ? `，节奏 ${cadence}` : '（无节奏）'}`,
          tags: ['adopt', 'goal'],
          importance: 5,
        });

        return lines.join('\n');
      },
    }),
  );
}
