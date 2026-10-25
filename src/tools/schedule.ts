/**
 * 调度相关工具
 *
 *   bot_schedule   为 Routine 设定/修改定时
 *   bot_schedules  查看所有排期与下次执行时间
 *   bot_heartbeat  查看调度器心跳（桌面休眠检测）
 */

import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';

import { BotService } from '../service.js';
import { BotError } from '../types.js';
import { parseCron, isValidCron, describeCron, nextRunAt } from '../scheduler/cron.js';
import { adjustForCost, describeTimeSlot } from '../scheduler/peak.js';

/** 把 Date 格式化为北京时间字符串 */
function fmtBj(d: Date): string {
  return d
    .toLocaleString('zh-CN', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
    })
    .replace(/\//g, '-');
}

export function registerScheduleTools(ctx: Context, service: BotService): void {
  // ============================================================
  // bot_schedule
  // ============================================================
  ctx.tools.register(
    defineTool({
      name: 'bot_schedule',
      description:
        '为某个流程设定 cron 定时。支持标准 5 段表达式（分 时 日 月 周）。' +
        '⚠️ 注意：DSH Desktop 是桌面应用，机器休眠/关机时不会执行。',
      parameters: {
        botId: { type: 'string', required: true, description: 'Bot ID' },
        routineId: { type: 'string', required: true, description: 'Routine ID' },
        cron: {
          type: 'string',
          required: true,
          description: '5 段 cron，如 "0 9 * * 1-5"（工作日 9:00）',
        },
        timezone: {
          type: 'string',
          description: '时区，默认 Asia/Shanghai',
        },
        costSensitive: {
          type: 'boolean',
          description:
            '是否允许错峰推迟。true=命中高峰时自动延后省钱；false=严格按时间执行。' +
            '日报类建议 false，备份类建议 true。默认跟随插件配置。',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args): Promise<string> {
        const botId = String(args.botId);
        const routineId = String(args.routineId);
        const expression = String(args.cron).trim();
        const tz = args.timezone ? String(args.timezone) : 'Asia/Shanghai';

        if (!isValidCron(expression)) {
          throw new BotError(
            'INVALID_ARGS',
            `cron 表达式非法："${expression}"。格式为 5 段：分 时 日 月 周，如 "0 9 * * 1-5"`,
          );
        }

        // 取流程，替换/追加 cron 触发器
        const routine = await service.getRoutine(botId, routineId);
        const manual = routine.spec.triggers.filter((t) => t.type === 'manual');
        const next: typeof routine = {
          ...routine,
          metadata: { ...routine.metadata, version: routine.metadata.version + 1 },
          spec: {
            ...routine.spec,
            triggers: [
              {
                type: 'cron',
                expression,
                timezone: tz,
                ...(typeof args.costSensitive === 'boolean'
                  ? { costSensitive: args.costSensitive }
                  : {}),
              },
              ...manual,
            ],
          },
        };

        await service.saveRoutine(botId, next);

        const cron = parseCron(expression);
        const now = new Date();
        const nextAt = nextRunAt(cron, now, tz);

        const allowShift =
          typeof args.costSensitive === 'boolean'
            ? args.costSensitive
            : service.configForScheduler();
        const adjusted =
          nextAt && allowShift ? adjustForCost(nextAt, true) : undefined;

        const lines = [
          `✅ 已为「${routine.metadata.name}」设定定时`,
          `表达式：${expression}  (${describeCron(cron)})`,
          `时区：${tz}`,
          `错峰：${allowShift ? '允许（高峰时自动延后省钱）' : '不允许（严格按时执行）'}`,
        ];

        if (nextAt) {
          lines.push(`下次执行：${fmtBj(nextAt)}`);
          if (
            adjusted &&
            adjusted.getTime() !== nextAt.getTime()
          ) {
            const shiftMin = Math.round(
              (adjusted.getTime() - nextAt.getTime()) / 60_000,
            );
            lines.push(
              `⚠️ 该时刻属于${describeTimeSlot(nextAt)}，已错峰推迟 ${shiftMin} 分钟`,
              `   实际执行：${fmtBj(adjusted)}`,
            );
          } else {
            lines.push(`时段：${describeTimeSlot(nextAt)}`);
          }
        } else {
          lines.push('⚠️ 在可预见的未来没有匹配时刻，请检查表达式');
        }

        lines.push(
          '',
          '⚠️ 提醒：DSH Desktop 是桌面应用，机器休眠或关闭时调度器不会工作。',
        );

        return lines.join('\n');
      },
    }),
  );

  // ============================================================
  // bot_schedules
  // ============================================================
  ctx.tools.register(
    defineTool({
      name: 'bot_schedules',
      description: '查看所有流程的定时排期与下次执行时间。',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(): Promise<string> {
        const upcoming = await service.scheduler().upcoming();

        if (upcoming.length === 0) {
          return '还没有任何定时任务。用 bot_schedule 为流程设定时。';
        }

        const lines = [`共 ${upcoming.length} 个定时任务：`, ''];
        for (const u of upcoming) {
          lines.push(`· ${u.botName} / ${u.routineName}`);
          lines.push(
            `  ${u.expression}  (${describeCron(parseCron(u.expression))}) · ${u.timeZone}`,
          );
          if (u.nextRunAt) {
            lines.push(`  下次：${fmtBj(new Date(u.nextRunAt))}`);
            if (u.nextRunShiftsTo) {
              lines.push(`  错峰后：${fmtBj(new Date(u.nextRunShiftsTo))}`);
            }
          }
        }
        return lines.join('\n');
      },
    }),
  );

  // ============================================================
  // bot_heartbeat
  // ============================================================
  ctx.tools.register(
    defineTool({
      name: 'bot_heartbeat',
      description:
        '查看调度器心跳状态。用于判断桌面应用是否长时间休眠导致定时任务未执行。',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(): Promise<string> {
        const status = await service.scheduler().heartbeatStatus();

        if (!status.lastBeatAt) {
          return '调度器尚未启动过（还没有心跳记录）。';
        }

        const ago = status.staleMs;
        const agoStr =
          ago < 60_000
            ? `${Math.round(ago / 1000)} 秒前`
            : ago < 3600_000
              ? `${Math.round(ago / 60_000)} 分钟前`
              : `${Math.round(ago / 3600_000)} 小时前`;

        const lines = [
          `上次心跳：${fmtBj(new Date(status.lastBeatAt))}（${agoStr}）`,
        ];

        if (status.isStale) {
          lines.push(
            '',
            '⚠️ 心跳已过期，可能的原因：',
            '  · 桌面应用处于休眠或已关闭',
            '  · 在此期间到期的定时任务不会自动补跑',
            '',
            '建议：需要长期稳定执行的 Bot，v2.0 可导出为系统服务。',
          );
        } else {
          lines.push('✅ 调度器正常运行中');
        }

        if (status.missedBeats > 0) {
          lines.push('', `累计检测到 ${status.missedBeats} 次休眠。`);
        }

        return lines.join('\n');
      },
    }),
  );
}
