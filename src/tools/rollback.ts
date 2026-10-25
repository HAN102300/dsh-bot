/**
 * 回滚相关工具
 *
 * 「收得回」的对外接口：
 *   bot_snapshots  查看快照
 *   bot_rollback   回滚到某个快照
 *   bot_snapshot   手动打一个快照（在执行高风险操作前）
 */

import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';

import { BotService } from '../service.js';
import { formatBytes } from '../routine/snapshot.js';

export function registerRollbackTools(ctx: Context, service: BotService): void {
  // ============================================================
  // bot_snapshots
  // ============================================================
  ctx.tools.register(
    defineTool({
      name: 'bot_snapshots',
      description:
        '查看某个 Bot 的 workspace 快照列表。每次真实执行（dryRun:false）前会自动打快照，' +
        '出问题时可以用 bot_rollback 恢复到任意一次。',
      parameters: {
        botId: { type: 'string', required: true, description: 'Bot ID' },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args): Promise<string> {
        const botId = String(args.botId);
        const snaps = await service.listSnapshots(botId);
        const usage = await service.snapshotUsage(botId);

        if (snaps.length === 0) {
          return '这个 Bot 还没有任何快照。真实执行（dryRun:false）时会自动创建。';
        }

        // 读取运行记录，把快照与运行状态关联起来
        const runs = await service.listRuns(botId, 500);
        const runMap = new Map(runs.map((r) => [r.id, r]));

        const lines = [
          `共 ${snaps.length} 个快照，占用 ${formatBytes(usage.bytes)}：`,
          '',
        ];
        for (const s of snaps) {
          const t = s.createdAt.replace('T', ' ').slice(0, 19);
          const run = s.runId ? runMap.get(s.runId) : undefined;

          // 区分"执行前"与"执行后"的快照
          let kind = '(手动)';
          if (run) {
            if (run.snapshotIdAfter === s.id) kind = '✅ 执行后的状态';
            else if (run.snapshotId === s.id) kind = '⏪ 执行前的状态';
            else kind = `(运行 ${run.id})`;
          }

          lines.push(`· ${s.id}  ${kind}`);
          lines.push(
            `  ${t} · ${s.fileCount} 个文件 · ${formatBytes(s.totalBytes)}`,
          );
          if (run) {
            lines.push(
              `  来源：${run.routineId ?? 'task'} — ${run.status}${run.dryRun ? ' (dry-run)' : ''}`,
            );
          }
        }
        lines.push(
          '',
          '回滚提示：',
          '  · 选「执行前的状态」= 撤销那次执行',
          '  · 选「执行后的状态」= 回到那次成功的结果',
          '  · 不传 snapshotId 则默认回到最近一次快照',
        );
        return lines.join('\n');
      },
    }),
  );

  // ============================================================
  // bot_rollback
  // ============================================================
  ctx.tools.register(
    defineTool({
      name: 'bot_rollback',
      description:
        '⭐ 把 Bot 的 workspace 回滚到某个快照。这是与其他 AI 同事产品最大的差异：' +
        'Grok Bot 与 Dots 停止任务都不会撤销已完成的操作，本插件可以。' +
        '语义：快照中有的文件恢复原内容，快照中没有的、当前多出来的文件会被删除。',
      parameters: {
        botId: { type: 'string', required: true, description: 'Bot ID' },
        snapshotId: {
          type: 'string',
          description: '目标快照 ID，不传则回滚到最近一次',
        },
        confirm: {
          type: 'boolean',
          required: true,
          description: '必须为 true。回滚会覆盖当前 workspace 的文件',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args): Promise<string> {
        if (args.confirm !== true) {
          return '回滚会覆盖当前工作区文件，属危险操作。请显式传 confirm: true 确认。';
        }

        const botId = String(args.botId);
        const snapId =
          args.snapshotId === undefined ? undefined : String(args.snapshotId);

        const result = await service.rollback(botId, snapId);

        await service.appendMemory(botId, {
          kind: 'decision',
          summary:
            `回滚 workspace 到快照 ${result.snapshotId}：` +
            `恢复 ${result.restored.length} 个文件，删除 ${result.removed.length} 个文件`,
          tags: ['rollback', 'snapshot'],
          importance: 4,
        });

        const lines = [
          `✅ 已回滚到快照 ${result.snapshotId}`,
          `回滚前状态已保存为快照 ${result.preSnapshotId}（后悔可再滚回来）`,
          `恢复文件：${result.restored.length} 个`,
        ];
        if (result.restored.length > 0 && result.restored.length <= 20) {
          lines.push(...result.restored.map((f) => `  · ${f}`));
        }
        lines.push(`删除文件：${result.removed.length} 个`);
        if (result.removed.length > 0 && result.removed.length <= 20) {
          lines.push(...result.removed.map((f) => `  · ${f}`));
        }
        if (result.removed.length > 20 || result.restored.length > 20) {
          lines.push('（文件较多，仅显示计数）');
        }
        if (result.errors.length > 0) {
          lines.push(`⚠️ ${result.errors.length} 个文件操作失败（如被占用）：`);
          lines.push(...result.errors.slice(0, 10).map((e) => `  · ${e}`));
        }
        return lines.join('\n');
      },
    }),
  );

  // ============================================================
  // bot_snapshot
  // ============================================================
  ctx.tools.register(
    defineTool({
      name: 'bot_snapshot',
      description:
        '手动为 Bot 的 workspace 打一个快照。建议在执行高风险操作（批量改文件、跑清理脚本）之前先打一个。',
      parameters: {
        botId: { type: 'string', required: true, description: 'Bot ID' },
        label: {
          type: 'string',
          description: '快照备注（可选，便于识别）',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args): Promise<string> {
        const botId = String(args.botId);
        const bot = await service.get(botId);
        const meta = await service.createSnapshot(bot.workspace);

        if (args.label) {
          await service.appendMemory(botId, {
            kind: 'observation',
            summary: `手动快照 ${meta.id}：${String(args.label)}`,
            tags: ['snapshot', 'manual'],
            importance: 2,
          });
        }

        return (
          `已创建快照 ${meta.id}\n` +
          `${meta.fileCount} 个文件，${formatBytes(meta.totalBytes)}`
        );
      },
    }),
  );
}
