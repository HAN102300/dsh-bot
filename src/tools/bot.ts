/**
 * bot_* 系列工具
 *
 * 命名统一使用 bot_ 前缀，避免与 DSH 内置工具及其它社区插件冲突。
 */

import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';

import { BotService } from '../service.js';
import {
  BotError,
  type BotIdentity,
  type MemoryEntry,
  type RunRecord,
} from '../types.js';
import { goalStatusLabel, goalTypeLabel } from '../goal/state.js';
import { renderRun } from './routine.js';

/** 把 BotIdentity 渲染成模型可读的文本 */
function renderBot(b: BotIdentity): string {
  return [
    `Bot「${b.name}」(${b.id})`,
    `职责：${b.role}`,
    `模型：${b.model.provider}/${b.model.model}（effort=${b.model.reasoningEffort}）`,
    `预算：¥${b.budget.dailyCny}/天，¥${b.budget.monthlyCny}/月`,
    `工作区：${b.workspace}`,
    `创建于：${b.createdAt}`,
  ].join('\n');
}

/** 把记忆渲染成可读文本 */
function renderMemories(entries: MemoryEntry[]): string {
  if (entries.length === 0) return '（没有找到相关记忆）';
  return entries
    .map((e, i) => {
      const date = e.ts.slice(0, 10);
      return `${i + 1}. [${date}][${e.kind}][重要度${e.importance}] ${e.summary}`;
    })
    .join('\n');
}

// ============================================================
// 注册
// ============================================================

export function registerBotTools(ctx: Context, service: BotService): void {
  // ---------- bot_create ----------
  ctx.tools.register(
    defineTool({
      name: 'bot_create',
      description:
        '创建一个常驻 AI 队友（Bot）。Bot 拥有独立工作区、长期记忆和预算上限。' +
        '创建后可用 bot_run 立即执行一次任务。默认 dry-run，不会产生真实副作用。',
      parameters: {
        name: {
          type: 'string',
          required: true,
          description: 'Bot 的名字，如「日报小助手」',
        },
        role: {
          type: 'string',
          required: true,
          description: '一句话职责，如「每天汇总 Git 提交并生成中文日报」',
        },
        model: {
          type: 'object',
          description: '模型配置，不填则用插件默认值（DeepSeek）',
          additionalProperties: false,
          properties: {
            provider: { type: 'string', description: 'deepseek | qwen | kimi | glm | doubao' },
            model: { type: 'string', description: 'deepseek-flash | deepseek-v4-pro 等' },
            reasoningEffort: {
              type: 'string',
              description: '推理强度：low / high / max',
            },
          },
        },
        budget: {
          type: 'object',
          description: '预算配置（人民币）',
          additionalProperties: false,
          properties: {
            dailyCny: { type: 'number', description: '每日上限，如 5' },
            monthlyCny: { type: 'number', description: '每月上限，如 100' },
            onExceed: { type: 'string', description: '超限行为：stop | downgrade' },
          },
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            workspace: { type: 'string' },
          },
        },
        render: (_args, value: any) => [
          {
            type: 'text',
            text: `已创建 Bot「${value.name}」(${value.id})\n工作区：${value.workspace}`,
          },
        ],
      },
      async execute(args): Promise<any> {
        const model = args.model as Record<string, unknown> | undefined;
        const budget = args.budget as Record<string, unknown> | undefined;

        if (model?.reasoningEffort !== undefined) {
          const eff = String(model.reasoningEffort);
          if (!['low', 'high', 'max'].includes(eff)) {
            throw new BotError(
              'INVALID_ARGS',
              `reasoningEffort 必须是 low / high / max，收到 ${eff}`,
            );
          }
        }

        const bot = await service.create({
          name: String(args.name),
          role: String(args.role),
          model: model
            ? {
                provider: model.provider as string | undefined,
                model: model.model as string | undefined,
                reasoningEffort: model.reasoningEffort as any,
              }
            : undefined,
          budget: budget
            ? {
                dailyCny: budget.dailyCny as number | undefined,
                monthlyCny: budget.monthlyCny as number | undefined,
                onExceed: budget.onExceed as any,
              }
            : undefined,
        });

        return { id: bot.id, name: bot.name, workspace: bot.workspace };
      },
    }),
  );

  // ---------- bot_list ----------
  ctx.tools.register(
    defineTool({
      name: 'bot_list',
      description: '列出所有已创建的 Bot，含运行次数、今日花费与最近状态。',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(): Promise<string> {
        const bots = await service.list();
        if (bots.length === 0) {
          return '还没有任何 Bot。用 bot_create 创建一个。';
        }
        return bots
          .map((b, i) => {
            const last = b.lastRunAt
              ? `最近运行 ${b.lastRunAt.slice(0, 16).replace('T', ' ')} (${b.lastRunStatus})`
              : '从未运行';
            return [
              `${i + 1}. ${b.name} (${b.id})`,
              `   ${b.role}`,
              `   运行 ${b.runCount} 次 · 今日 ¥${b.todayCostCny.toFixed(4)} · ${last}`,
            ].join('\n');
          })
          .join('\n\n');
      },
    }),
  );

  // ---------- bot_show ----------
  ctx.tools.register(
    defineTool({
      name: 'bot_show',
      description: '查看某个 Bot 的详细信息，含目标状态与最近一次运行。',
      parameters: {
        botId: { type: 'string', required: true, description: 'Bot ID' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args): Promise<string> {
        const bot = await service.get(String(args.botId));
        const semantic = await service.getSemantic(bot.id);
        const goal = await service.getGoal(bot.id);
        const proposals = await service.listProposals(bot.id);
        const runs = await service.listRuns(bot.id, 1);

        const parts = [renderBot(bot)];

        // 「守得住」：目标是一等公民，单独呈现
        if (goal) {
          parts.push(
            '\n# 当前目标',
            `${goal.description}`,
            `类型：${goalTypeLabel(goal.type)} · 状态：${goalStatusLabel(goal.status)}`,
            `进展：${goal.progress}`,
          );
          if (goal.nextStep) parts.push(`下一步：${goal.nextStep}`);
          if (goal.type === 'standing') {
            parts.push(`已守护 ${goal.cycleCount ?? 0} 轮`);
          }
          if (goal.status === 'pending_confirmation') {
            parts.push('⚠️ 正在等人确认是否达成（Bot 不能自己宣布完成）');
          }
          if (goal.status === 'blocked') {
            parts.push('⚠️ 卡住了，需要人介入');
          }
        } else {
          parts.push('\n# 当前目标', '（还没有目标）');
        }

        if (proposals.length) {
          parts.push(`\n# 接续候选 ${proposals.length} 个`);
          for (const p of proposals) parts.push(`· ${p.description}`);
        }

        if (semantic.facts.length) {
          parts.push('\n# 已知事实');
          parts.push(...semantic.facts.slice(0, 10).map((f) => `- ${f}`));
        }

        if (runs[0]) {
          parts.push('\n# 最近一次运行');
          parts.push(renderRun(runs[0]));
        }

        return parts.join('\n');
      },
    }),
  );

  // ---------- bot_recall ----------
  ctx.tools.register(
    defineTool({
      name: 'bot_recall',
      description:
        '检索某个 Bot 的长期记忆。用时间衰减 + 关键词 + 重要度综合排序。' +
        '用于回答"上次做到哪了"、"之前遇到过什么"这类问题。',
      parameters: {
        botId: { type: 'string', required: true, description: 'Bot ID' },
        query: { type: 'string', required: true, description: '检索关键词或问题' },
        limit: { type: 'number', description: '返回条数，默认 10' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args): Promise<string> {
        const limit = Number(args.limit ?? 10);
        const entries = await service.recall(
          String(args.botId),
          String(args.query),
          Number.isFinite(limit) && limit > 0 ? limit : 10,
        );
        return renderMemories(entries);
      },
    }),
  );

  // ---------- bot_runs ----------
  ctx.tools.register(
    defineTool({
      name: 'bot_runs',
      description:
        '查看某个 Bot 的运行历史。与 Grok Bot 不同，本插件全量保留，不设 20 条上限。',
      parameters: {
        botId: { type: 'string', required: true, description: 'Bot ID' },
        limit: { type: 'number', description: '返回条数，默认 10' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args): Promise<string> {
        const limit = Number(args.limit ?? 10);
        const runs = await service.listRuns(
          String(args.botId),
          Number.isFinite(limit) && limit > 0 ? limit : 10,
        );
        if (runs.length === 0) return '还没有运行记录。';
        return runs.map(renderRun).join('\n\n---\n\n');
      },
    }),
  );

  // ---------- bot_update ----------
  ctx.tools.register(
    defineTool({
      name: 'bot_update',
      description: '修改某个 Bot 的配置（名称、职责、模型、预算）。无法修改 id 与工作区。',
      parameters: {
        botId: { type: 'string', required: true, description: 'Bot ID' },
        name: { type: 'string' },
        role: { type: 'string' },
        systemPromptExtra: {
          type: 'string',
          description: '追加到系统提示的额外说明',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args): Promise<string> {
        const bot = await service.update(String(args.botId), {
          ...(args.name !== undefined ? { name: String(args.name) } : {}),
          ...(args.role !== undefined ? { role: String(args.role) } : {}),
          ...(args.systemPromptExtra !== undefined
            ? { systemPromptExtra: String(args.systemPromptExtra) }
            : {}),
        });
        return renderBot(bot);
      },
    }),
  );

  // ---------- bot_delete ----------
  ctx.tools.register(
    defineTool({
      name: 'bot_delete',
      description:
        '删除某个 Bot 及其全部记忆和运行记录。危险操作，必须显式传 confirm=true。',
      parameters: {
        botId: { type: 'string', required: true, description: 'Bot ID' },
        confirm: {
          type: 'boolean',
          required: true,
          description: '必须为 true 才会真正删除',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args): Promise<string> {
        if (args.confirm !== true) {
          throw new BotError(
            'INVALID_ARGS',
            '删除是危险操作，请显式传 confirm=true 确认',
          );
        }
        const bot = await service.get(String(args.botId));
        await service.remove(bot.id);
        return `已删除 Bot「${bot.name}」(${bot.id})，含其记忆与运行记录。`;
      },
    }),
  );

  // ---------- bot_memory_add ----------
  ctx.tools.register(
    defineTool({
      name: 'bot_memory_add',
      description:
        '手动向 Bot 的记忆中写入一条记录。通常由 Bot 自己运行结束后调用，也可人工补充。',
      parameters: {
        botId: { type: 'string', required: true, description: 'Bot ID' },
        summary: {
          type: 'string',
          required: true,
          description: '摘要，≤200 字',
        },
        kind: {
          type: 'string',
          description: 'observation | decision | outcome | fact | preference',
        },
        tags: {
          type: 'array',
          description: '检索标签',
        },
        importance: {
          type: 'number',
          description: '重要度 1-5，默认 3',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args): Promise<string> {
        const kind = (args.kind as string | undefined) ?? 'observation';
        const valid = ['observation', 'decision', 'outcome', 'fact', 'preference'];
        if (!valid.includes(kind)) {
          throw new BotError('INVALID_ARGS', `kind 必须是 ${valid.join(' | ')} 之一`);
        }
        const imp = Number(args.importance ?? 3);
        const entry = await service.appendMemory(String(args.botId), {
          kind: kind as any,
          summary: String(args.summary),
          tags: Array.isArray(args.tags) ? (args.tags as string[]) : [],
          importance: Number.isFinite(imp) ? Math.min(5, Math.max(1, imp)) : 3,
        });
        return `已写入记忆（${entry.kind}，重要度 ${entry.importance}）：${entry.summary}`;
      },
    }),
  );
}
