/**
 * routine_* 与 bot_run 工具
 */

import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';

import { BotService } from '../service.js';
import { BotError, type RunRecord } from '../types.js';
import {
  validateRoutine,
  toMeta,
  type Routine,
} from '../routine/schema.js';
import type { RoutineRunner, RunFlags } from '../routine/runner.js';
import { formatCostCny } from '../llm/bridge.js';
import { parseYaml, stringifyYaml } from './yaml.js';

/** 把运行记录渲染成可读文本 */
export function renderRun(r: RunRecord): string {
  const head = [
    `运行 ${r.id}  ${r.status}${r.dryRun ? '  [DRY-RUN]' : ''}`,
    `开始：${r.startedAt}`,
    `结束：${r.endedAt}`,
    `花费：${formatCostCny(r.usage)}（输入 ${r.usage.inputTokens} / 输出 ${r.usage.outputTokens} / 缓存命中 ${r.usage.cacheHitTokens}）`,
  ];
  if (r.error) head.push(`错误：${r.error.code} — ${r.error.message}`);

  const lines: string[] = [head.join('\n')];

  if (r.steps.length) {
    lines.push('步骤：');
    for (const s of r.steps) {
      const flags: string[] = [];
      if (s.blocked) flags.push('[拦截]');
      if (s.error) flags.push(`[失败: ${s.error.code}]`);
      lines.push(
        `  ${s.index + 1}. ${s.kind}:${s.name} (${s.durationMs}ms) ${flags.join(' ')}`.trimEnd(),
      );
      if (s.blocked) lines.push(`     ${s.blocked.reason}`);
      if (s.error) lines.push(`     ${s.error.message}`);
    }
  }

  // ⭐ 汇报协议：Bot 像同事一样说清「需要你做什么」
  if (r.goalEffect === 'pending') {
    lines.push(
      '',
      '⭐ Bot 自评目标已完成，停在「待你确认」——它不能自己宣布胜利。',
      '确认请说「目标确认达成」（bot_goal confirm），不满意就说驳回意见（bot_goal reject）。',
    );
  } else if (r.goalEffect === 'blocked') {
    lines.push('', '⚠️ Bot 报告目标卡住了，需要你拿主意（看目标详情：bot_goal show）。');
  }

  const blockedCount = r.steps.filter((s) => s.blocked).length;
  if (blockedCount > 0) {
    lines.push(
      ``,
      `⚠️ 本次运行有 ${blockedCount} 个步骤被 dry-run 拦截，未产生真实副作用。`,
      `如需真实执行，请显式传 dryRun: false。`,
    );
  }

  return lines.join('\n');
}

export interface RegisterRunToolsOptions {
  service: BotService;
  runner: RoutineRunner;
  /** 默认是否 dry-run */
  defaultDryRun: boolean;
}

export function registerRunTools(
  ctx: Context,
  opts: RegisterRunToolsOptions,
): void {
  const { service, runner, defaultDryRun } = opts;

  // ============================================================
  // bot_run
  // ============================================================
  ctx.tools.register(
    defineTool({
      name: 'bot_run',
      description:
        '让某个 Bot 执行一次任务。可以给一次性任务描述（task），也可以跑一个已保存的流程（routineId）。' +
        '⭐ 默认 dry-run：只演示不真执行，外部副作用会被拦截并返回预览。确认无误后传 dryRun:false 才真实执行。',
      parameters: {
        botId: { type: 'string', required: true, description: 'Bot ID' },
        task: {
          type: 'string',
          description: '一次性任务描述，与 routineId 二选一',
        },
        routineId: {
          type: 'string',
          description: '要执行的 Routine ID，与 task 二选一',
        },
        dryRun: {
          type: 'boolean',
          description: `是否演习，默认 ${defaultDryRun}`,
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args): Promise<string> {
        const botId = String(args.botId);
        const dryRun =
          args.dryRun === undefined ? defaultDryRun : args.dryRun === true;

        await service.get(botId); // 确认存在
        // 预算检查已收口进 RoutineRunner（所有路径共用的唯一门）

        const flags: RunFlags = { dryRun, trigger: 'manual' };

        if (args.routineId !== undefined) {
          const routine = await service.getRoutine(botId, String(args.routineId));
          const record = await runner.runRoutine(botId, routine, flags);
          return renderRun(record);
        }

        const task = args.task === undefined ? undefined : String(args.task).trim();
        if (!task) {
          throw new BotError(
            'INVALID_ARGS',
            '必须提供 task 或 routineId 之一',
          );
        }

        const record = await runner.runTask(botId, task, flags);
        return renderRun(record);
      },
    }),
  );

  // ============================================================
  // routine_save
  // ============================================================
  ctx.tools.register(
    defineTool({
      name: 'routine_save',
      description:
        '保存一个流程（Routine）。流程用 YAML 声明，包含若干步骤，可设定定时触发。保存前会校验 schema。',
      parameters: {
        botId: { type: 'string', required: true, description: 'Bot ID' },
        yaml: {
          type: 'string',
          required: true,
          description: 'Routine 的 YAML 内容',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args): Promise<string> {
        const botId = String(args.botId);
        await service.get(botId);

        let parsed: unknown;
        try {
          parsed = parseYaml(String(args.yaml));
        } catch (e: any) {
          throw new BotError('INVALID_ROUTINE', `YAML 解析失败：${e?.message ?? e}`);
        }

        const routine = validateRoutine(parsed);
        await service.saveRoutine(botId, routine);

        const triggerDesc = routine.spec.triggers
          .map((t) => {
            if (t.type !== 'cron') return '手动';
            const shift =
              t.costSensitive === false
                ? '·准时'
                : t.costSensitive === true
                  ? '·可错峰'
                  : '';
            return `cron ${t.expression} (${t.timezone})${shift}`;
          })
          .join(' / ');

        return `已保存流程「${routine.metadata.name}」(${routine.metadata.id})，共 ${routine.spec.steps.length} 步，触发方式：${triggerDesc}。`;
      },
    }),
  );

  // ============================================================
  // routine_run
  // ============================================================
  ctx.tools.register(
    defineTool({
      name: 'routine_run',
      description:
        '执行一个已保存的流程。默认 dry-run，只演示不真执行。',
      parameters: {
        botId: { type: 'string', required: true },
        routineId: { type: 'string', required: true },
        dryRun: {
          type: 'boolean',
          description: `是否演习，默认 ${defaultDryRun}`,
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args): Promise<string> {
        const botId = String(args.botId);
        const dryRun =
          args.dryRun === undefined ? defaultDryRun : args.dryRun === true;

        // 预算检查已收口进 RoutineRunner
        const routine = await service.getRoutine(botId, String(args.routineId));
        const record = await runner.runRoutine(botId, routine, {
          dryRun,
          trigger: 'manual',
        });

        return renderRun(record);
      },
    }),
  );

  // ============================================================
  // routine_list
  // ============================================================
  ctx.tools.register(
    defineTool({
      name: 'routine_list',
      description: '列出某个 Bot 的所有流程。',
      parameters: {
        botId: { type: 'string', required: true },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args): Promise<string> {
        const botId = String(args.botId);
        const metas = await service.listRoutines(botId);
        if (metas.length === 0) {
          return '这个 Bot 还没有任何流程。用 routine_save 创建一个。';
        }
        return metas
          .map((m, i) => {
            const trig = m.triggers
              .map((t) => (t.type === 'cron' ? `cron ${t.expression}` : '手动'))
              .join(' / ');
            return `${i + 1}. ${m.name} (${m.id})\n   ${m.stepCount} 步 · ${trig} · v${m.version}`;
          })
          .join('\n\n');
      },
    }),
  );

  // ============================================================
  // routine_show
  // ============================================================
  ctx.tools.register(
    defineTool({
      name: 'routine_show',
      description: '查看某个流程的完整 YAML 定义。',
      parameters: {
        botId: { type: 'string', required: true },
        routineId: { type: 'string', required: true },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args): Promise<string> {
        const routine = await service.getRoutine(
          String(args.botId),
          String(args.routineId),
        );
        return stringifyYaml(routine);
      },
    }),
  );

  // ============================================================
  // routine_delete
  // ============================================================
  ctx.tools.register(
    defineTool({
      name: 'routine_delete',
      description: '删除一个流程。',
      parameters: {
        botId: { type: 'string', required: true },
        routineId: { type: 'string', required: true },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args): Promise<string> {
        const botId = String(args.botId);
        const id = String(args.routineId);
        const routine = await service.getRoutine(botId, id);
        await service.removeRoutine(botId, id);
        return `已删除流程「${routine.metadata.name}」(${id})。`;
      },
    }),
  );
}
