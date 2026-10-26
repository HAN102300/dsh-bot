/**
 * Bot 面板的 HTTP 桥接层
 *
 * Client UI 跑在浏览器里，读不到本地文件。
 * 这里用 webServer 注册一组 HTTP 端点，把 BotService 的能力暴露出去。
 *
 * 设计原则：
 *   - 只读接口直接返回 JSON
 *   - 变更接口一律 POST，且必须带 confirm
 *   - 路径带前缀 /api/dsh-bot，避免与其它插件冲突
 */

import type { BotService } from '../service.js';
import { BotError, type GoalState } from '../types.js';
import { createGoal, parseCadence, transitionGoal } from '../goal/state.js';
import { formatBytes } from '../routine/snapshot.js';

/**
 * ⚠️ 路径选择说明
 *
 * 不能用 `/api/...` 前缀：DSH 的 api-gateway 在 /api 上注册了带鉴权的桥接路由，
 * 会优先匹配到它并返回 401。
 *
 * 这里用独立的 `/_dsh-bot/...` 前缀，避开所有既有前缀，由 webServer 直接路由。
 */
export const API_PREFIX = '/_dsh-bot';

/** 简易 JSON 响应 */
function writeJson(res: any, status: number, value: unknown): void {
  const body = JSON.stringify(value, null, 2);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(body);
}

/** 读取请求体 JSON */
async function readJsonBody(req: any): Promise<unknown | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > 1_000_000) {
        resolve(undefined);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        resolve(undefined);
      }
    });
    req.on('error', () => resolve(undefined));
  });
}

/** 统一错误转换 */
/** Host/Origin 必须是 localhost（任意端口），否则 403 */
export function isLocalRequest(req: any): boolean {
  const localHost = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i;
  const host = String(req?.headers?.host ?? '');
  const origin = String(req?.headers?.origin ?? '');
  if (origin) {
    try {
      const u = new URL(origin);
      if (!localHost.test(u.host)) return false;
    } catch {
      return false;
    }
  }
  return localHost.test(host);
}

function toErrorPayload(e: unknown): { ok: false; code: string; message: string } {
  if (e instanceof BotError) {
    return { ok: false, code: e.code, message: e.message };
  }
  const msg = e instanceof Error ? e.message : String(e);
  return { ok: false, code: 'INTERNAL', message: msg };
}

export interface BotApiRoute {
  kind: 'exact';
  path: string;
  handler: (req: any, res: any) => Promise<void>;
}

/**
 * 构造全部路由。
 *
 * @param service BotService 实例
 * @param runAction 执行动作的注入点（由插件入口提供，避免 API 层依赖 Runner）
 */
export function makeBotApiRoutes(
  service: BotService,
  runAction: {
    run: (
      botId: string,
      opts: { routineId?: string; dryRun: boolean; task?: string },
    ) => Promise<any>;
    rollback: (botId: string, snapshotId?: string) => Promise<any>;
    snapshot: (botId: string) => Promise<any>;
    /** 当前会话正在用的模型（新建 Bot 的默认值） */
    getSessionModel?: () => { provider: string; model: string } | undefined;
    /** 环境里可用的 provider 列表（可能异步——dsh-llm 的 listModels 返回 Promise） */
    getAvailableModels?: () =>
      | Array<{ provider: string; models?: string[] }>
      | Promise<Array<{ provider: string; models?: string[] }>>;
    /** 读设置（botId 省略时为全局） */
    getSettings?: (botId?: string) => Promise<any>;
    /** 读全局设置 */
    getGlobalSettings?: () => Promise<any>;
    /** 保存设置 */
    saveSettings?: (botId: string | undefined, patch: any) => Promise<any>;
  },
): BotApiRoute[] {
  const routes: BotApiRoute[] = [
    // ----------------------------------------------------------
    // 总览：Bot 列表 + 全局统计
    // ----------------------------------------------------------
    {
      kind: 'exact',
      path: `${API_PREFIX}/overview`,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        try {
          const bots = await service.list();

          // 汇总今日花费与运行数
          let todayTotal = 0;
          let runTotal = 0;
          for (const b of bots) {
            todayTotal += b.todayCostCny;
            runTotal += b.runCount;
          }

          // 心跳
          let heartbeat: any = null;
          try {
            heartbeat = await service.scheduler().heartbeatStatus();
          } catch {
            /* 调度器未就绪 */
          }

          // 最近 48h 新接手的 Bot（对话介入后让面板角标提醒用户回来看）
          const adoptCutoff = Date.now() - 48 * 3600_000;
          const recentAdoptions = bots
            .filter((b: any) => Date.parse(b.createdAt ?? '') > adoptCutoff)
            .map((b: any) => ({ id: b.id, name: b.name, createdAt: b.createdAt }));

          writeJson(res, 200, {
            ok: true,
            value: {
              bots,
              stats: {
                botCount: bots.length,
                todayCostCny: todayTotal,
                runTotal,
              },
              recentAdoptions,
              heartbeat,
            },
          });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },

    // ----------------------------------------------------------
    // 单个 Bot 详情
    // ----------------------------------------------------------
    {
      kind: 'exact',
      path: `${API_PREFIX}/bot`,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        try {
          const url = new URL(req.url ?? '/', 'http://x');
          const botId = url.searchParams.get('botId');
          if (!botId) {
            writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '缺少 botId' });
            return;
          }

          const bot = await service.get(botId);
          const semantic = await service.getSemantic(botId);
          const runs = await service.listRuns(botId, 10);
          const routines = await service.listRoutines(botId);
          const snaps = await service.listSnapshots(botId);
          const usage = await service.snapshotUsage(botId);
          const today = await service.spentToday(botId);
          const month = await service.spentThisMonth(botId);
          const goal = await service.getGoal(botId);
          const proposals = await service.listProposals(botId);
          const archives = await service.listGoalArchives(botId);
          const spend = await service.spendBreakdown(botId, 'day');

          writeJson(res, 200, {
            ok: true,
            value: {
              bot,
              semantic,
              runs,
              routines,
              goal,
              proposals,
              archives,
              spend,
              snapshots: snaps.slice(0, 20),
              snapshotUsage: usage,
              budget: {
                today,
                month,
                dailyLimit: bot.budget.dailyCny,
                monthlyLimit: bot.budget.monthlyCny,
              },
            },
          });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },

    // ----------------------------------------------------------
    // 演习
    // ----------------------------------------------------------
    {
      kind: 'exact',
      path: `${API_PREFIX}/dry-run`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        const body = (await readJsonBody(req)) as any;
        if (!body?.botId) {
          writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '缺少 botId' });
          return;
        }
        try {
          const record = await runAction.run(body.botId, {
            routineId: body.routineId,
            dryRun: true,
          });
          writeJson(res, 200, { ok: true, value: record });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },

    // ----------------------------------------------------------
    // 真实执行（必须 confirm）
    // ----------------------------------------------------------
    {
      kind: 'exact',
      path: `${API_PREFIX}/run`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        const body = (await readJsonBody(req)) as any;
        if (!body?.botId) {
          writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '缺少 botId' });
          return;
        }
        if (body.confirm !== true) {
          writeJson(res, 400, {
            ok: false,
            code: 'CONFIRM_REQUIRED',
            message: '真实执行必须显式传 confirm: true',
          });
          return;
        }

        // ⭐ 执行前自检
        //
        //    问题：模型不可用 / 预算不够 / 没有目标时，
        //    用户点「执行」会跑一轮然后拿到 EMPTY_OUTPUT，
        //    既浪费时间又看不出原因。
        //    这里把三类前置条件都查一遍，一次性说清。
        try {
          const problems: string[] = [];

          const bot = await service.get(String(body.botId));
          const known = (await runAction.getAvailableModels?.()) ?? [];
          if (known.length > 0) {
            const hit = known.find((p) => p.provider === bot.model.provider);
            if (!hit) {
              problems.push(
                `模型 provider「${bot.model.provider}」在当前环境不存在` +
                  `（可用：${known.map((p) => p.provider).join(', ')}）`,
              );
            } else if (
              hit.models &&
              hit.models.length > 0 &&
              !hit.models.includes(bot.model.model)
            ) {
              problems.push(
                `provider「${bot.model.provider}」下没有模型「${bot.model.model}」` +
                  `（可用：${hit.models.join(', ')}）`,
              );
            }
          }

          if (problems.length > 0) {
            writeJson(res, 200, {
              ok: false,
              code: 'PRECHECK_FAILED',
              message: '执行前检查未通过：\n· ' + problems.join('\n· '),
            });
            return;
          }
        } catch (e) {
          // 自检本身失败不阻断执行（例如拿不到 provider 列表）
        }

        try {
          const record = await runAction.run(body.botId, {
            routineId: body.routineId,
            dryRun: false,
            task: body.task,
          });
          writeJson(res, 200, { ok: true, value: record });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },

    // ----------------------------------------------------------
    // 回滚
    // ----------------------------------------------------------
    {
      kind: 'exact',
      path: `${API_PREFIX}/rollback`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        const body = (await readJsonBody(req)) as any;
        if (!body?.botId) {
          writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '缺少 botId' });
          return;
        }
        if (body.confirm !== true) {
          writeJson(res, 400, {
            ok: false,
            code: 'CONFIRM_REQUIRED',
            message: '回滚会覆盖工作区文件，必须显式传 confirm: true',
          });
          return;
        }
        try {
          const result = await runAction.rollback(body.botId, body.snapshotId);
          writeJson(res, 200, { ok: true, value: result });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },

    // ----------------------------------------------------------
    // 手动快照
    // ----------------------------------------------------------
    {
      kind: 'exact',
      path: `${API_PREFIX}/snapshot`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        const body = (await readJsonBody(req)) as any;
        if (!body?.botId) {
          writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '缺少 botId' });
          return;
        }
        try {
          const result = await runAction.snapshot(body.botId);
          writeJson(res, 200, { ok: true, value: result });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },

    // ----------------------------------------------------------
    // 目标：接受 / 忽略接续候选
    // ----------------------------------------------------------
    {
      kind: 'exact',
      path: `${API_PREFIX}/goal/accept`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        const body = (await readJsonBody(req)) as any;
        if (!body?.botId) {
          writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '缺少 botId' });
          return;
        }
        try {
          const result = await actOnGoal(service, body.botId, 'accept', body);
          writeJson(res, 200, { ok: true, value: result });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/goal/dismiss`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        const body = (await readJsonBody(req)) as any;
        if (!body?.botId) {
          writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '缺少 botId' });
          return;
        }
        try {
          const result = await actOnGoal(service, body.botId, 'dismiss', body);
          writeJson(res, 200, { ok: true, value: result });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },

    // ----------------------------------------------------------
    // 目标：确认达成 / 驳回（必须 confirm）
    // ----------------------------------------------------------
    {
      kind: 'exact',
      path: `${API_PREFIX}/goal/confirm`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        const body = (await readJsonBody(req)) as any;
        if (!body?.botId) {
          writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '缺少 botId' });
          return;
        }
        if (body.confirm !== true) {
          writeJson(res, 400, {
            ok: false,
            code: 'CONFIRM_REQUIRED',
            message: '确认达成会归档目标，必须显式传 confirm: true',
          });
          return;
        }
        try {
          const result = await actOnGoal(service, body.botId, 'confirm', body);
          writeJson(res, 200, { ok: true, value: result });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/goal/reject`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        const body = (await readJsonBody(req)) as any;
        if (!body?.botId) {
          writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '缺少 botId' });
          return;
        }
        try {
          const result = await actOnGoal(service, body.botId, 'reject', body);
          writeJson(res, 200, { ok: true, value: result });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },

    // ----------------------------------------------------------
    // 目标：设定 / 放弃
    // ----------------------------------------------------------
    {
      kind: 'exact',
      path: `${API_PREFIX}/goal/set`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        const body = (await readJsonBody(req)) as any;
        if (!body?.botId) {
          writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '缺少 botId' });
          return;
        }
        try {
          const result = await actOnGoal(service, body.botId, 'set', body);
          writeJson(res, 200, { ok: true, value: result });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/goal/abandon`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        const body = (await readJsonBody(req)) as any;
        if (!body?.botId) {
          writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '缺少 botId' });
          return;
        }
        if (body.confirm !== true) {
          writeJson(res, 400, {
            ok: false,
            code: 'CONFIRM_REQUIRED',
            message: '放弃目标会归档，必须显式传 confirm: true',
          });
          return;
        }
        try {
          const result = await actOnGoal(service, body.botId, 'abandon', body);
          writeJson(res, 200, { ok: true, value: result });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },

    // ----------------------------------------------------------
    // 目标史（全量，不设上限）
    // ----------------------------------------------------------
    {
      kind: 'exact',
      path: `${API_PREFIX}/goals`,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        try {
          const url = new URL(req.url ?? '/', 'http://x');
          const botId = url.searchParams.get('botId');
          if (!botId) {
            writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '缺少 botId' });
            return;
          }
          writeJson(res, 200, {
            ok: true,
            value: { archives: await service.listGoalArchives(botId) },
          });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },

    // ----------------------------------------------------------
    // Bot：创建 / 删除
    //
    // 面板不能只做"展示"——用户不可能每次都切到对话框里建 Bot。
    // ----------------------------------------------------------
    {
      kind: 'exact',
      path: `${API_PREFIX}/bot/create`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        const body = (await readJsonBody(req)) as any;
        if (!body?.name || !body?.role) {
          writeJson(res, 400, {
            ok: false,
            code: 'INVALID_ARGS',
            message: '需要 name 与 role',
          });
          return;
        }
        try {
          const bot = await service.create({
            name: String(body.name),
            role: String(body.role),
          });

          // 允许建 Bot 时顺手设目标——这才是"一步到位"的体验
          if (body.goal) {
            const goal = createGoal(
              `goal_${Math.random().toString(16).slice(2, 10)}`,
              {
                description: String(body.goal),
                type: body.goalType === 'standing' ? 'standing' : 'one-shot',
                cadence: body.cadence ? String(body.cadence) : undefined,
              },
              new Date().toISOString(),
            );
            await service.saveGoal(bot.id, goal);
          }

          writeJson(res, 200, { ok: true, value: bot });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/bot/delete`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        const body = (await readJsonBody(req)) as any;
        if (!body?.botId) {
          writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '缺少 botId' });
          return;
        }
        if (body.confirm !== true) {
          writeJson(res, 400, {
            ok: false,
            code: 'CONFIRM_REQUIRED',
            message: '删除 Bot 会连同工作区、记忆、目标、快照一起删除，必须显式传 confirm: true',
          });
          return;
        }
        try {
          await service.remove(String(body.botId));
          writeJson(res, 200, { ok: true, value: { deleted: true } });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },

    // ----------------------------------------------------------
    // 可用模型 / 修改 Bot 的模型绑定
    // ----------------------------------------------------------
    {
      kind: 'exact',
      path: `${API_PREFIX}/models`,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        try {
          writeJson(res, 200, {
            ok: true,
            value: {
              // 建 Bot 时会用的默认值（跟随当前会话）
              current: runAction.getSessionModel?.() ?? null,
              // 可用列表（拿不到就为空，前端退化成手填）
              available: (await runAction.getAvailableModels?.()) ?? [],
            },
          });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/bot/model`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        const body = (await readJsonBody(req)) as any;
        if (!body?.botId || !body?.provider || !body?.model) {
          writeJson(res, 400, {
            ok: false,
            code: 'INVALID_ARGS',
            message: '需要 botId / provider / model',
          });
          return;
        }
        try {
          const bot = await service.get(String(body.botId));
          const provider = String(body.provider);
          const model = String(body.model);

          // ⭐ 前置校验：这个 provider 真的存在吗？
          //
          //    如果不校验，用户填错一个名字，要到「执行」时才失败，
          //    而且是 EMPTY_OUTPUT 这种看不出原因的错误。
          //    失败必须在用户改配置的那一刻就暴露。
          const known = (await runAction.getAvailableModels?.()) ?? [];
          if (known.length > 0) {
            const hit = known.find((p) => p.provider === provider);
            if (!hit) {
              throw new BotError(
                'INVALID_ARGS',
                `当前环境没有 provider「${provider}」。可用的是：` +
                  known.map((p) => p.provider).join(', ') +
                  `。填错会导致执行时拿不到模型。`,
              );
            }
            if (hit.models && hit.models.length > 0 && !hit.models.includes(model)) {
              throw new BotError(
                'INVALID_ARGS',
                `provider「${provider}」下没有模型「${model}」。` +
                  `可用：${hit.models.join(', ')}`,
              );
            }
          }

          const next = await service.update(String(body.botId), {
            model: {
              ...bot.model,
              provider,
              model,
              reasoningEffort: body.reasoningEffort ?? bot.model.reasoningEffort,
            },
          });
          writeJson(res, 200, { ok: true, value: next });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },

    // ----------------------------------------------------------
    // 设置（全局 / 单 Bot）
    // ----------------------------------------------------------
    {
      kind: 'exact',
      path: `${API_PREFIX}/settings`,
      handler: async (req, res) => {
        try {
          if (req.method === 'GET') {
            const url = new URL(req.url ?? '/', 'http://x');
            const botId = url.searchParams.get('botId') ?? undefined;
            const [effective, global] = await Promise.all([
              runAction.getSettings?.(botId),
              runAction.getGlobalSettings?.(),
            ]);
            writeJson(res, 200, {
              ok: true,
              value: {
                effective: effective ?? null,
                global: global ?? null,
              },
            });
            return;
          }
          if (req.method !== 'POST') {
            writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
            return;
          }
          const body = (await readJsonBody(req)) as any;
          const target = body?.botId ? String(body.botId) : undefined;
          const result = await runAction.saveSettings?.(
            target,
            body?.settings ?? {},
          );
          writeJson(res, 200, { ok: true, value: result ?? null });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },

    // 最近运行列表（设置页「最近运行」用）
    //
    // 为什么不直接用 GET /bot：那个接口带 semantic/routines/snapshots 等
    // 重负载，设置页只想要一份轻量的最近运行清单 + 每轮的模型与花费。
    // 免费与否由 usage.costKind 区分（exact=付费 / free=免费 / unknown=无价目）。
    {
      kind: 'exact',
      path: `${API_PREFIX}/runs/list`,
      handler: async (req, res) => {
        if (req.method !== 'GET') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        try {
          const url = new URL(req.url ?? '/', 'http://x');
          const botId = url.searchParams.get('botId');
          const limit = Math.min(Math.max(Number(url.searchParams.get('limit')) || 30, 1), 100);
          if (!botId) {
            writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '缺少 botId' });
            return;
          }
          const bot = await service.get(botId);
          const runs = await service.listRuns(botId, limit);
          // 每轮补上当轮使用的模型（runs 记录本身不存，取 identity 当前值 +
          // 运行记录的 modelFallback 提示，足以回答"这次是谁在跑"）
          writeJson(res, 200, {
            ok: true,
            value: {
              bot: { id: bot.id, name: bot.name, model: bot.model },
              runs: runs.map((r: any) => ({
                id: r.id,
                trigger: r.trigger,
                startedAt: r.startedAt,
                endedAt: r.endedAt,
                dryRun: r.dryRun,
                status: r.status,
                error: r.error,
                usage: r.usage,
                modelFallback: r.steps?.[0]?.args?.modelFallback,
                outputPreview:
                  typeof r.steps?.[0]?.result?.output === 'string'
                    ? r.steps[0].result.output.slice(0, 50_000)
                    : undefined,
                stepCount: r.steps?.length ?? 0,
                toolSteps: (r.steps ?? [])
                  .filter((s: any) => s.kind === 'tool')
                  .map((s: any) => ({ name: s.name, durationMs: s.durationMs, blocked: !!s.blocked, error: s.error })),
              })),
            },
          });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },

    // ----------------------------------------------------------
    // 运行记录管理（设置页用：删除 / 清空）
    // ----------------------------------------------------------
    {
      kind: 'exact',
      path: `${API_PREFIX}/runs/clear`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        const body = (await readJsonBody(req)) as any;
        if (!body?.botId) {
          writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '缺少 botId' });
          return;
        }
        if (body.confirm !== true) {
          writeJson(res, 400, {
            ok: false,
            code: 'CONFIRM_REQUIRED',
            message: '清空运行记录不可恢复，必须显式传 confirm: true',
          });
          return;
        }
        try {
          const removed = await service.clearRuns(String(body.botId));
          writeJson(res, 200, { ok: true, value: { removed } });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },
    {
      kind: 'exact',
      path: `${API_PREFIX}/runs/delete`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        const body = (await readJsonBody(req)) as any;
        if (!body?.botId || !body?.runId) {
          writeJson(res, 400, {
            ok: false,
            code: 'INVALID_ARGS',
            message: '需要 botId 与 runId',
          });
          return;
        }
        try {
          const okDel = await service.deleteRun(String(body.botId), String(body.runId));
          writeJson(res, 200, { ok: true, value: { deleted: okDel } });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },

    // ----------------------------------------------------------
    // 目标：解除阻塞
    //
    // 「卡住了」必须能处理，否则用户只能看着一个红框。
    // ----------------------------------------------------------
    {
      kind: 'exact',
      path: `${API_PREFIX}/goal/unblock`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        const body = (await readJsonBody(req)) as any;
        if (!body?.botId) {
          writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '缺少 botId' });
          return;
        }
        try {
          const goal = await service.getGoal(String(body.botId));
          if (!goal) throw new BotError('GOAL_NOT_FOUND', '没有目标');
          if (goal.status !== 'blocked') {
            throw new BotError(
              'GOAL_INVALID_TRANSITION',
              `当前状态是 ${goal.status}，不是卡住，无需解除`,
            );
          }
          const note = String(body.note ?? '').trim();
          const next = transitionGoal(goal, 'active', 'human', new Date().toISOString(), {
            progress: note ? `已解除阻塞：${note}` : '已解除阻塞，继续执行',
            needsHuman: false,
          });
          await service.saveGoal(String(body.botId), next);
          writeJson(res, 200, { ok: true, value: next });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },

    // ----------------------------------------------------------
    // 目标：放弃（卡住时也可以直接放弃并归档）
    // ----------------------------------------------------------
    {
      kind: 'exact',
      path: `${API_PREFIX}/goal/giveup`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        const body = (await readJsonBody(req)) as any;
        if (!body?.botId) {
          writeJson(res, 400, { ok: false, code: 'INVALID_ARGS', message: '缺少 botId' });
          return;
        }
        try {
          const goal = await service.getGoal(String(body.botId));
          if (!goal) throw new BotError('GOAL_NOT_FOUND', '没有目标');

          const note = String(body.note ?? '').trim() || '人判断无法继续，放弃';
          const done = transitionGoal(goal, 'abandoned', 'human', new Date().toISOString(), {
            progress: note,
          });
          const archive = await archiveGoalFor(service, String(body.botId), done, note);
          writeJson(res, 200, { ok: true, value: { goal: done, archive } });
        } catch (e) {
          writeJson(res, 200, toErrorPayload(e));
        }
      },
    },

    // ----------------------------------------------------------
    // 健康检查（client 用来判断 host 端是否就绪）
    // ----------------------------------------------------------
    {
      kind: 'exact',
      path: `${API_PREFIX}/health`,
      handler: async (_req, res) => {
        let botCount = 0;
        try {
          botCount = (await service.list()).length;
        } catch {
          /* ignore */
        }
        writeJson(res, 200, {
          ok: true,
          value: {
            ready: true,
            homeDir: service.homeDir,
            botCount,
            at: new Date().toISOString(),
          },
        });
      },
    },

    // ----------------------------------------------------------
    // 客户端状态上报
    //
    // 浏览器端激活成功/失败都会 POST 到这里，host 写入文件。
    // 这样诊断不需要依赖用户手动看控制台。
    // ----------------------------------------------------------
    {
      kind: 'exact',
      path: `${API_PREFIX}/client-status`,
      handler: async (req, res) => {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, code: 'METHOD_NOT_ALLOWED' });
          return;
        }
        const body = (await readJsonBody(req)) as any;
        try {
          writeJson(res, 200, { ok: true, value: { received: true } });
        } catch {
          /* ignore */
        }
        // 落盘（失败也不影响响应）
        try {
          const fs = await import('node:fs');
          const path = await import('node:path');
          const file = path.join(service.homeDir, '.client-status.json');
          fs.mkdirSync(service.homeDir, { recursive: true });
          const prev = (() => {
            try {
              return JSON.parse(fs.readFileSync(file, 'utf8'));
            } catch {
              return { history: [] };
            }
          })();
          const history = Array.isArray(prev.history) ? prev.history : [];
          history.push({
            version: body?.version ?? null,
            status: body?.status ?? 'unknown',
            detail: body?.detail ?? null,
            at: body?.at ?? new Date().toISOString(),
            receivedAt: new Date().toISOString(),
          });
          fs.writeFileSync(
            file,
            JSON.stringify(
              {
                last: history[history.length - 1],
                history: history.slice(-20),
              },
              null,
              2,
            ),
            'utf8',
          );
        } catch {
          /* ignore */
        }
      },
    },
  ];

  // ⭐ 本地来源守卫：面板 API 无鉴权（刻意绕开了带鉴权的 /api 网关），
  //    必须挡住跨站请求（CSRF）与 DNS rebinding——本机恶意网页可以
  //    对 localhost 发起 POST 触发真实执行/删 Bot/回滚。
  return routes.map((r) => ({
    ...r,
    handler: async (req: any, res: any) => {
      if (!isLocalRequest(req)) {
        writeJson(res, 403, {
          ok: false,
          code: 'FORBIDDEN_ORIGIN',
          message: '面板 API 只接受本机（localhost）请求',
        });
        return;
      }
      await r.handler(req, res);
    },
  }));
}

/** 供 http 处理器复用的格式化辅助 */
export { formatBytes };

// ============================================================
// 目标动作桥接
// ============================================================

/**
 * 面板按钮 → 目标状态机。
 *
 * 为什么不直接复用 `bot_goal` 工具的 execute：
 * 工具的 execute 拿不到 service 之外的东西（如 newId），
 * 而这里需要写归档、生成候选。所以把动作收敛到一个小函数，
 * 让「状态机 + 归档」这套逻辑在两处都走同一份 `goal/state.ts`，
 * 而不是各写一遍。
 */
async function actOnGoal(
  service: BotService,
  botId: string,
  action: 'set' | 'accept' | 'dismiss' | 'confirm' | 'reject' | 'abandon',
  body: any,
): Promise<unknown> {
  const nowIso = () => new Date().toISOString();
  const newId = (p: string) => `${p}_${Math.random().toString(16).slice(2, 10)}`;

  switch (action) {
    case 'set': {
      const existing = await service.getGoal(botId);
      if (existing && existing.status !== 'achieved' && existing.status !== 'abandoned') {
        throw new BotError(
          'GOAL_ALREADY_EXISTS',
          `已经在守「${existing.description}」，先处理掉它再设新目标。`,
        );
      }
      const desc = String(body.description ?? '');
      // ⭐ 关键：从描述里识别执行节奏。
      //    「每过 4 小时给我报告」这句话本来就含有节奏，
      //    之前完全被忽略，导致目标永远不会自动跑。
      const cadence = body.cadence
        ? String(body.cadence)
        : parseCadence(desc);

      const goal = createGoal(
        newId('goal'),
        {
          description: desc,
          type: body.goalType === 'standing' ? 'standing' : 'one-shot',
          cadence,
        },
        nowIso(),
      );
      await service.saveGoal(botId, goal);
      return goal;
    }

    case 'accept': {
      const proposals = await service.listProposals(botId);
      const picked = body.goalId
        ? proposals.find((p) => p.id === body.goalId)
        : proposals[0];
      if (!picked) {
        throw new BotError('GOAL_NOT_FOUND', '没有可接受的候选');
      }
      const next = transitionGoal(picked, 'active', 'human', nowIso(), {
        progress: '刚接受，尚未开始',
      });
      await service.saveGoal(botId, next);
      await service.clearProposals(botId);
      return next;
    }

    case 'dismiss': {
      if (body.goalId) {
        await service.removeProposal(botId, String(body.goalId));
      } else {
        await service.clearProposals(botId);
      }
      return { dismissed: true };
    }

    case 'confirm': {
      const goal = await service.getGoal(botId);
      if (!goal) throw new BotError('GOAL_NOT_FOUND', '没有目标');
      const done = transitionGoal(goal, 'achieved', 'human', nowIso(), {
        progress: body.note ? String(body.note) : goal.progress,
      });
      const archive = await archiveGoalFor(service, botId, done, String(body.note ?? done.progress));
      return { goal: done, archive };
    }

    case 'reject': {
      const goal = await service.getGoal(botId);
      if (!goal) throw new BotError('GOAL_NOT_FOUND', '没有目标');
      const note = String(body.note ?? '').trim();
      const next = transitionGoal(goal, 'active', 'human', nowIso(), {
        progress: note ? `被驳回：${note}` : '被驳回，继续做',
      });
      await service.saveGoal(botId, next);
      return next;
    }

    case 'abandon': {
      const goal = await service.getGoal(botId);
      if (!goal) throw new BotError('GOAL_NOT_FOUND', '没有目标');
      const done = transitionGoal(goal, 'abandoned', 'human', nowIso(), {
        progress: body.note ? String(body.note) : '已放弃',
      });
      const archive = await archiveGoalFor(
        service,
        botId,
        done,
        String(body.note ?? '放弃'),
      );
      return { goal: done, archive };
    }
  }
}

/** 归档：统计该目标期间的花费与运行数 */
async function archiveGoalFor(
  service: BotService,
  botId: string,
  goal: GoalState,
  outcome: string,
): Promise<unknown> {
  const runs = await service.listRuns(botId, Number.MAX_SAFE_INTEGER);
  const related = runs.filter((r) => !goal.createdAt || r.startedAt >= goal.createdAt);

  const archive = await service.archiveGoal(botId, goal, {
    totalRuns: related.length,
    totalCostCny: related.reduce((s, r) => s + (r.usage?.costCny ?? 0), 0),
    outcome,
    snapshotIds: related
      .flatMap((r) => [r.snapshotId, r.snapshotIdAfter])
      .filter((x): x is string => Boolean(x)),
  });

  await service.clearGoal(botId);
  return archive;
}

