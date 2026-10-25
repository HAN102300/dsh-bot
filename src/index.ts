/**
 * dsh-bot 插件入口
 *
 * 遵循 Cordis 插件模型：导出 apply(ctx, config)。
 * 所有通过 ctx 注册的东西在插件卸载时自动清理。
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Context } from '@deepseek-ai/cordis';

import { BotService, expandHome } from './service.js';
import { SettingsStore } from './settings.js';
import { registerBotTools } from './tools/bot.js';
import { registerGoalTools } from './tools/goal.js';
import { registerRunTools } from './tools/routine.js';
import { registerRollbackTools } from './tools/rollback.js';
import { registerDraftTool, detectProvider } from './tools/draft.js';
import { registerScheduleTools } from './tools/schedule.js';
import { registerAdoptTool } from './tools/adopt.js';
import { registerHttpTools } from './tools/http.js';
import { RoutineRunner, type LlmInvoker } from './routine/runner.js';
import { createLlmInvoker, createToolInvoker, lastToolProbeMethod } from './llm/bridge.js';
import { makeBotApiRoutes } from './api/routes.js';
import type { BotPluginConfig, ReasoningEffort } from './types.js';

export const name = 'dsh-bot';

/**
 * 依赖声明。
 *
 * `tools`  — 必需，没有它就注册不了任何工具
 * `webServer` — 必需，Bot 面板的 HTTP API 靠它
 * `llm`    — 必需，Bot 的核心就是调用模型
 *
 * ⚠️ 关于 `llm` 的历史教训
 *
 * 早期这里故意不放 `llm`，理由是"某些环境没有模型服务，
 * 那样整个插件都无法加载"。于是改用 `ctx.inject(['llm'], cb)` 延迟获取。
 *
 * 实测结果：那个回调**从来没有执行过**——
 *
 *     "hasLlm": false
 *     "llmAccessError": "cannot get property \"llm\" without inject"
 *     "llmReady": false
 *
 * 后果是模型一次都没被调用，但运行被标记为 success（空输出）。
 * 一个设计上"更安全"的降级，变成了最难发现的故障。
 *
 * 现在的取舍：**宁可插件加载失败（看得见），
 * 也不要静默地拿不到模型（看不见）**。
 * 而且 DSH 环境下 llm 服务本来就是 Core 级依赖，不存在"没有"的情况。
 */
export const inject = ['tools', 'webServer', 'llm'];

/** 默认配置 */
export const DEFAULT_CONFIG: BotPluginConfig = {
  homeDir: '~/.dsh/bot',
  defaultProvider: 'deepseek',
  defaultModel: 'deepseek-flash',
  defaultReasoningEffort: 'high',
  defaultDryRun: true,
  schedulerTickMs: 30_000,
  costSensitiveScheduling: true,
  defaultDailyCny: 5,
  defaultMonthlyCny: 100,
  snapshotKeepRecent: 10,
  snapshotEnabled: true,
};

/** 规范化配置：补齐缺省值并校验范围 */
export function normalizeConfig(raw?: Partial<BotPluginConfig>): BotPluginConfig {
  const cfg: BotPluginConfig = { ...DEFAULT_CONFIG, ...(raw ?? {}) };

  const eff = cfg.defaultReasoningEffort;
  if (!['low', 'high', 'max'].includes(eff)) {
    cfg.defaultReasoningEffort = 'high' as ReasoningEffort;
  }

  if (!Number.isFinite(cfg.schedulerTickMs) || cfg.schedulerTickMs < 1000) {
    cfg.schedulerTickMs = DEFAULT_CONFIG.schedulerTickMs;
  }

  // keepRecent 下界：负数会让 prune 的 slice(-n) 返回全量，
  // 把包括最新在内的所有快照删光——破坏性配置错误必须在入口拦住
  const keep = cfg.snapshotKeepRecent ?? 0;
  if (!Number.isFinite(keep) || keep < 1) {
    cfg.snapshotKeepRecent = DEFAULT_CONFIG.snapshotKeepRecent;
  }

  if (!Number.isFinite(cfg.defaultDailyCny) || cfg.defaultDailyCny <= 0) {
    cfg.defaultDailyCny = DEFAULT_CONFIG.defaultDailyCny;
  }
  if (!Number.isFinite(cfg.defaultMonthlyCny) || cfg.defaultMonthlyCny <= 0) {
    cfg.defaultMonthlyCny = DEFAULT_CONFIG.defaultMonthlyCny;
  }

  if (!cfg.homeDir?.trim()) {
    cfg.homeDir = DEFAULT_CONFIG.homeDir;
  }

  return cfg;
}

/** 生成稳定 ID */
function newId(prefix: string): string {
  return `${prefix}_${crypto.randomBytes(4).toString('hex')}`;
}

/**
 * 从 DSH profile 里读出「当前会话正在用的模型」。
 *
 * 为什么要读配置文件而不是问 ctx.llm：
 *   `llm` 服务只暴露 listProviders()（有哪些 provider），
 *   并不暴露"这个会话现在选的是哪个模型"。而
 *   `agent-default-model` 的配置恰好写在 profile 的
 *   cordis.patch.yml 里：
 *
 *     - id: agent-default-model
 *       config:
 *         provider: our-free-model
 *         model: deepseek-v4.1-flash-free
 *
 * 读到它，新建的 Bot 就能默认跟用户当前会话保持一致——
 * 否则会出现「用户在用 our-free-model，Bot 却去调 deepseek」
 * 这种必然失败的错配。
 *
 * 找不到就返回 undefined，调用方回退到插件配置。
 */
/**
 * 探测「当前会话正在用什么模型」，并记录过程。
 *
 * trace 用于诊断：返回值不对时能立刻看出是哪一步出的问题。
 * 上一版就是因为没有它，出现 detectedProvider 有值但 detectedModel 空，
 * 却完全查不出原因。
 */
export function detectSessionModelTraced(ctx: any): {
  provider?: string;
  model?: string;
  trace: string[];
  /** 结果从哪来：profile / listProviders[0]（降级）/ none */
  source: string;
  /** 是否为猜测（非真实会话模型） */
  degraded: boolean;
} {
  const trace: string[] = [];

  // ① 优先读 profile 的 patch 文件
  try {
    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
    const profilesDir = path.join(home, 'profiles');
    trace.push('profilesDir=' + profilesDir);

    let names: string[] = [];
    try {
      names = fs.readdirSync(profilesDir);
      trace.push('profiles=[' + names.join(',') + ']');
    } catch (e: any) {
      names = [];
      trace.push('readdir failed: ' + (e?.message ?? e));
    }

    for (const name of names) {
      const file = path.join(profilesDir, name, 'cordis.patch.yml');
      let raw: string;
      try {
        raw = fs.readFileSync(file, 'utf8');
      } catch {
        trace.push(name + ': no cordis.patch.yml');
        continue;
      }

      const idx = raw.indexOf('agent-default-model');
      if (idx < 0) {
        trace.push(name + ': no agent-default-model');
        continue;
      }

      // 截到下一个顶层 \`- id:\` 为止，避免读到别的段
      const rest = raw.slice(idx);
      const nextEntry = rest.search(/\n-\s+id:/);
      const block = nextEntry > 0 ? rest.slice(0, nextEntry) : rest;

      const p = block.match(/^\s*provider:\s*["']?([\w./@-]+)["']?\s*$/m);
      const m = block.match(/^\s*model:\s*["']?([\w./@:-]+)["']?\s*$/m);

      trace.push(
        name + ': provider=' + (p?.[1] ?? '\u2205') + ' model=' + (m?.[1] ?? '\u2205'),
      );

      // 关键修正：以前要求 provider 和 model 同时匹配才返回。
      // 若 model 行格式有差异（多空格/引号/行尾注释），整个结果会被丢弃，
      // 静默退到 listProviders()——于是 provider 变成环境里的任意值、
      // model 变空，Bot 用这个组合去调用必然失败。
      // 现在只要拿到 provider 就返回，model 缺失单独报告。
      if (p?.[1]) {
        return {
          provider: p[1],
          model: m?.[1],
          trace: trace.concat(['hit=' + name]),
          source: 'profile/agent-default-model',
          degraded: false,
        };
      }
    }
  } catch (e: any) {
    trace.push('profile scan error: ' + (e?.message ?? e));
  }

  // ② 退而求其次：用 llm.listProviders() 的第一个
  //
  //    ⚠️ 这是**降级**路径，不是正常路径。
  //    listProviders()[0] 是任意的（可能是 deepseek-official），
  //    跟用户会话正在用的模型毫无关系，拿它当默认值等于瞎猜。
  //    所以这里明确标记 degraded，让诊断能看出「这次是猜的」。
  try {
    const llmSvc = ctx?.llm;
    if (typeof llmSvc?.listProviders === 'function') {
      const list = llmSvc.listProviders();
      trace.push('listProviders=' + JSON.stringify(list));
      const detected = detectProvider(ctx);
      if (detected) {
        trace.push('⚠️ 降级：用 listProviders()[0]=' + detected + '（无 model，不是会话模型）');
        return {
          provider: detected,
          model: undefined,
          trace,
          source: 'listProviders[0]（降级猜测）',
          degraded: true,
        };
      }
    } else {
      trace.push('ctx.llm.listProviders 不可用');
    }
  } catch (e: any) {
    trace.push('listProviders error: ' + (e?.message ?? e));
  }

  trace.push('探测失败，返回 undefined');
  return {
    provider: undefined,
    model: undefined,
    trace,
    source: 'none',
    degraded: true,
  };
}

/**
 * 枚举环境里可用的 provider 及其模型。
 *
 * ⚠️ 这段代码前两版都是错的，值得记下来：
 *
 *   v1: 只调用 llm.listModels()
 *       → 拿到 undefined → 面板上只有 provider 下拉
 *
 *   v2: 试了 listModels / models / getModels 三种方法名
 *       → 还是 undefined → 只有 trae 有个兜底模型
 *
 *   v3（现在）: 读了 dsh-llm 源码才发现——
 *       **listModels 是 async 函数，返回 Promise**
 *       Array.isArray(Promise) 永远是 false，
 *       所以前面所有版本都拿不到列表。
 *
 *   「换方法名」这个方向从一开始就是错的，
 *   真正的问题是**没有 await**。
 *
 * 现在正确做法：await 每一个候选方法，再判断结果。
 */
export async function listAvailableModels(ctx: any): Promise<
  Array<{ provider: string; models: string[] }>
> {
  try {
    const llmSvc = ctx?.llm;
    if (!llmSvc) return [];

    const list =
      typeof llmSvc.listProviders === 'function' ? llmSvc.listProviders() : [];
    if (!Array.isArray(list)) return [];

    const session = (() => {
      try {
        const r = detectSessionModelTraced(ctx);
        return r.degraded ? { provider: undefined, model: undefined } : r;
      } catch {
        return { provider: undefined, model: undefined };
      }
    })();

    const out: Array<{ provider: string; models: string[] }> = [];

    for (const p of list) {
      const provider =
        typeof p === 'string' ? p : p?.id ?? p?.name ?? p?.route ?? p?.provider;
      if (typeof provider !== 'string') continue;

      let models: string[] = [];

      // ① 依次尝试候选方法，并 await —— 这是关键
      for (const name of ['listModels', 'models', 'getModels'] as const) {
        const fn = (llmSvc as any)[name];
        if (typeof fn !== 'function') continue;
        try {
          const v = await fn.call(llmSvc, provider);
          if (Array.isArray(v) && v.length > 0) {
            models = v
              .map((m: any) =>
                typeof m === 'string' ? m : m?.id ?? m?.name ?? m?.model,
              )
              .filter((x: any): x is string => typeof x === 'string');
            if (models.length > 0) break;
          }
        } catch {
          /* 这个方法对这个 provider 不可用，继续试下一个 */
        }
      }

      // ② provider 对象自身携带
      if (models.length === 0 && typeof p === 'object' && p) {
        const own = (p as any).models ?? (p as any).modelIds;
        if (Array.isArray(own)) {
          models = own
            .map((m: any) => (typeof m === 'string' ? m : m?.id ?? m?.name))
            .filter((x: any): x is string => typeof x === 'string');
        }
      }

      // ③ 兜底：至少把当前会话的模型放进去
      if (models.length === 0 && session.provider === provider && session.model) {
        models = [session.model];
      }

      out.push({ provider, models });
    }

    return out;
  } catch {
    return [];
  }
}

export function detectSessionModel(
  ctx: any,
): { provider: string; model: string } | undefined {
  const r = detectSessionModelTraced(ctx);
  // 降级猜测不对外当作"会话模型"——它只是候选
  if (!r.provider || r.degraded) return undefined;
  return { provider: r.provider, model: r.model ?? '' };
}

/** 当前时间（ISO 8601） */
function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 构造面板「执行」按钮的任务描述。
 *
 * 这个函数决定了用户点一下「执行」到底让 Bot 去做什么。
 *
 * 之前是写死的「从面板触发的一次执行」——模型看了这句话
 * 只能泛泛地回答，跑完什么也没做，用户看到的就是"假的成功"。
 *
 * 现在按优先级构造真实任务：
 *   1. 调用方显式给了 task（面板输入框）→ 用它
 *   2. 有活目标 → 让 Bot 推进这个目标（这是「守得住」的核心）
 *   3. 没有目标但有职责 → 按职责做一轮
 */
function buildPanelTask(
  bot: { name: string; role: string },
  goal: { description: string; status: string; progress?: string; nextStep?: string; type?: string } | undefined,
  routines: Array<{ name: string }>,
  explicitTask?: string,
): string {
  if (explicitTask && String(explicitTask).trim()) {
    return String(explicitTask).trim();
  }

  // ⭐ 有活目标：这一轮的意义就是推进目标
  if (goal && (goal.status === 'active' || goal.status === 'blocked')) {
    const lines = [
      `请推进你正在守的目标：${goal.description}`,
      ``,
      `当前进展：${goal.progress || '尚未开始'}`,
    ];
    if (goal.nextStep) lines.push(`你上次计划的下一步：${goal.nextStep}`);
    if (goal.status === 'blocked') {
      lines.push(
        ``,
        `⚠️ 这个目标目前标记为「卡住」。请先诊断原因：`,
        `把你能确认的现状说清楚，如果确实需要人处理，就在评估里标 needsHuman=true。`,
      );
    }
    if (goal.type === 'standing') {
      lines.push(
        ``,
        `这是「常驻守护」型目标，没有终点。本轮请做一次实际检查，`,
        `报告当前状态，并更新进展。不要宣称目标已达成。`,
      );
    }
    lines.push(
      ``,
      `要求：真的去查、去看、去做，不要只描述你打算做什么。`,
      `完成后按格式输出自评。`,
    );
    return lines.join('\n');
  }

  // 没有目标：按职责做一轮
  const lines = [
    `你的职责是：${bot.role}`,
    ``,
    `请按这个职责做一次实际的检查或工作，然后报告你做了什么、发现了什么。`,
  ];
  if (routines.length) {
    lines.push(`你已配置的流程：${routines.map((r) => r.name).join('、')}`);
  }
  lines.push(``, `如果你还没有被设定明确目标，在报告最后提示用户可以设一个目标。`);
  return lines.join('\n');
}

/**
 * 解析实际可用的 provider。
 *
 * 优先级：
 *   1. 用户在配置里显式指定的 defaultProvider
 *   2. 环境变量 DSH_BOT_PROVIDER
 *   3. 从 ctx.llm.listProviders() 自动探测
 *   4. 兜底 'deepseek'
 *
 * 背景：不同 DSH 环境的 provider 名不同（workbuddy / deepseek-official 等），
 * 硬编码会找不到适配器。
 */
function cfgProvider(ctx: any, config: BotPluginConfig): string {
  if (config.defaultProvider && config.defaultProvider !== 'deepseek') {
    return config.defaultProvider;
  }
  const envProvider = process.env.DSH_BOT_PROVIDER;
  if (envProvider) return envProvider;
  const detected = detectProvider(ctx);
  if (detected) return detected;
  return config.defaultProvider || 'deepseek';
}

export function apply(ctx: Context, rawConfig?: Partial<BotPluginConfig>): void {
  // ⭐ 最外层安全网：任何异常都不能让宿主崩溃。
  // 插件失败应当只影响插件自己，绝不能让 DSH 起不来。
  try {
    applyInner(ctx, rawConfig);
  } catch (e: any) {
    try {
      const home = expandHome(
        rawConfig?.homeDir ?? DEFAULT_CONFIG.homeDir,
      );
      fs.mkdirSync(home, { recursive: true });
      fs.writeFileSync(
        path.join(home, '.plugin-crash.json'),
        JSON.stringify(
          {
            crashedAt: new Date().toISOString(),
            pid: process.pid,
            message: String(e?.message ?? e),
            stack: String(e?.stack ?? '').slice(0, 4000),
          },
          null,
          2,
        ),
        'utf8',
      );
    } catch {
      /* 连崩溃记录都写不了，只能放弃 */
    }
    (ctx as any)?.logger?.error?.(
      `[dsh-bot] 初始化失败（已隔离，不影响宿主）：${e?.message ?? e}`,
    );
  }
}

function applyInner(ctx: Context, rawConfig?: Partial<BotPluginConfig>): void {
  const config = normalizeConfig(rawConfig);
  const service = new BotService(ctx, config);
  const settingsStore = new SettingsStore(service.homeDir);

  // ---------- 诊断：确认 ctx 上的服务是否就绪 ----------
  const diag: Record<string, unknown> = {
    loadedAt: new Date().toISOString(),
    pid: process.pid,
    nodeVersion: process.version,
    homeDir: service.homeDir,
    config,
  };
  try {
    diag.hasTools = Boolean((ctx as any).tools);
    diag.toolsRegisterType = typeof (ctx as any).tools?.register;
    diag.hasEffect = typeof ctx.effect;
    diag.hasSet = typeof (ctx as any).set;
    diag.hasInject = typeof (ctx as any).inject;
    // llm 现在已在 inject 里声明，这里应该能拿到
    try {
      diag.hasLlm = Boolean((ctx as any).llm);
    } catch (e: any) {
      diag.hasLlm = false;
      diag.llmAccessError = String(e?.message ?? e).slice(0, 120);
    }
    diag.ctxKeys = Object.keys(ctx as any).filter(
      (k) => !k.startsWith('_') && k !== 'root' && k !== 'scope',
    );
  } catch (e: any) {
    diag.ctxProbeError = String(e?.message ?? e);
  }

  const writeMarker = () => {
    try {
      fs.mkdirSync(service.homeDir, { recursive: true });
      fs.writeFileSync(
        path.join(service.homeDir, '.plugin-loaded.json'),
        JSON.stringify(diag, null, 2),
        'utf8',
      );
    } catch {
      // 标记失败不影响主流程
    }
  };

  // 对外暴露服务（可选能力，失败不影响主流程）
  try {
    const setFn = (ctx as any).set;
    if (typeof setFn === 'function') {
      setFn.call(ctx, 'bot', service);
      diag.serviceExposed = true;
    } else {
      diag.serviceExposed = false;
      diag.setSkipped = 'ctx.set 不是函数';
    }
  } catch (e: any) {
    diag.serviceExposed = false;
    diag.setError = String(e?.message ?? e);
  }

  // 组装执行器
  // ---------- 模型服务 ----------
  // llm 现在在 inject 里声明，框架保证它就绪。
  // 不再用 ctx.inject() 延迟获取——那个回调在实测中从未执行过，
  // 导致 llmImpl 永远停在 fallback，运行变成"空输出的成功"。
  let llmReady = false;
  const llmFallback: LlmInvoker = async () => {
    throw new Error(
      '当前环境没有可用的模型服务（ctx.llm）。' +
        'bot_run 的自由任务与 routine_draft 需要它；纯流程执行（routine_run）不受影响。',
    );
  };
  let llmImpl: LlmInvoker = llmFallback;

  try {
    const llmSvc = (ctx as any).llm;
    if (llmSvc) {
      llmImpl = createLlmInvoker(ctx);
      llmReady = true;
      diag.llmReady = true;
    } else {
      diag.llmNotReadyHint = 'ctx.llm 为空，运行会返回 EMPTY_OUTPUT。';
    }
  } catch (e: any) {
    diag.llmInjectError = String(e?.message ?? e);
  }

  // ⭐ 关键：让新建的 Bot 默认跟「用户当前会话用的模型」一致。
  //
  //    背景：desktop profile 的 agent-default-model 是
  //    our-free-model / deepseek-v4.1-flash-free，
  //    而插件硬编码默认值 deepseek / deepseek-flash 在该环境不存在，
  //    于是每次执行都拿不到模型 → EMPTY_OUTPUT。
  try {
    const r = detectSessionModelTraced(ctx);
    diag.detectTrace = r.trace;
    diag.detectedSource = r.source;
    diag.detectedDegraded = r.degraded;

    if (r.provider && !r.degraded) {
      // 真实会话模型：完整采纳
      config.defaultProvider = r.provider;
      if (r.model) config.defaultModel = r.model;
      diag.detectedProvider = r.provider;
      diag.detectedModel = r.model ?? '（只有 provider，没探到 model）';
    } else if (r.provider && r.degraded) {
      // 降级猜测：只记录，不覆盖。
      // 拿 listProviders()[0] 当默认值等于瞎猜，可能指向一个
      // 用户没在用的 provider，反而制造新的错配。
      diag.detectedProvider = r.provider;
      diag.detectedModel = '（降级猜测，未采用）';
      diag.detectedSource = r.source + '（未采用）';
    } else {
      diag.detectedSource = 'none（保留插件默认值）';
    }
  } catch (e: any) {
    diag.detectError = String(e?.message ?? e);
  }

  /** 代理调用：始终走最新的 llmImpl */
  const llmDispatch: LlmInvoker = (input) => llmImpl(input);

  const toolInvoker = createToolInvoker(ctx);

  // ⭐ 宿主工具清单诊断（真机教训）：模型曾自述「没有可用工具」，
  //    必须落盘宿主到底暴露了什么、以什么形状、用哪个方法探到的。
  try {
    const hostList = toolInvoker.list();
    diag.hostTools = {
      count: hostList.length,
      probeMethod: lastToolProbeMethod() ?? 'none',
      sample: hostList.slice(0, 12).map((t: any) => t.name),
    };
  } catch (e: any) {
    diag.hostToolsError = String(e?.message ?? e);
  }

  const runner = new RoutineRunner({
    service,
    llm: llmDispatch,
    tools: toolInvoker,
    newId,
    nowIso: () => new Date().toISOString(),
    snapshotEnabled: config.snapshotEnabled !== false,
    // 运行时模型兜底：Bot 绑定的 provider 在当前环境没有适配器时
    // （典型：宿主重启把模型重置为 profile 默认如 zcode），切换到
    // 环境真实可用的 provider/model，避免一轮必败的调用。
    resolveRunnableModel: async (bot) => {
      const known = await listAvailableModels(ctx);
      const hit = known.find((p) => p.provider === bot.model.provider);
      if (hit && (hit.models.length === 0 || hit.models.includes(bot.model.model))) {
        return {
          provider: bot.model.provider,
          model: bot.model.model,
          reasoningEffort: bot.model.reasoningEffort,
          fallbackUsed: false,
        };
      }
      const candidate = config.defaultProvider;
      const candHit = known.find((p) => p.provider === candidate);
      const fallbackModel =
        candHit && candHit.models.length > 0 && !candHit.models.includes(config.defaultModel)
          ? candHit.models[0]
          : config.defaultModel;
      return {
        provider: candidate,
        model: fallbackModel,
        reasoningEffort: bot.model.reasoningEffort,
        fallbackUsed: true,
        note: '重启或环境变更后模型绑定可能失效；如需固定模型，请在 Bot 面板重新绑定。',
      };
    },
  });

  const llmInvoker = llmDispatch;

  // ---------- 注册工具（带诊断） ----------
  const regErrors: string[] = [];
  let regCount = 0;

  // 包一层，统计实际注册数量
  const origTools = (ctx as any).tools;
  const counted = {
    ...origTools,
    register: (t: any) => {
      const r = origTools.register(t);
      regCount++;
      return r;
    },
    schemas: origTools?.schemas?.bind(origTools),
    get: origTools?.get?.bind(origTools),
    call: origTools?.call?.bind(origTools),
    restrict: origTools?.restrict?.bind(origTools),
    guard: origTools?.guard?.bind(origTools),
  };

  const fakeCtx = new Proxy(ctx as any, {
    get(target, prop) {
      if (prop === 'tools') return counted;
      return Reflect.get(target, prop);
    },
  });

  try {
    registerBotTools(fakeCtx, service);
    registerGoalTools(fakeCtx, {
      service,
      newId,
      nowIso,
      llm: llmInvoker,
    });
    registerRunTools(fakeCtx, {
      service,
      runner,
      defaultDryRun: config.defaultDryRun,
    });
    registerRollbackTools(fakeCtx, service);
    registerScheduleTools(fakeCtx, service);
    // 通用只读 HTTP GET 工具：所有 Bot 都能联网抓数据（副作用 none，默认放行）
    registerHttpTools(fakeCtx);
    registerDraftTool(fakeCtx, {
      service,
      llm: llmInvoker,
      draftProvider: () => cfgProvider(ctx, config),
      draftModel: () => process.env.DSH_BOT_DRAFT_MODEL || 'deepseek-v4-pro',
    });
    registerAdoptTool(fakeCtx, {
      service,
      runner,
      newId,
      nowIso,
      hostToolCount: () => toolInvoker.list().length,
    });
  } catch (e: any) {
    regErrors.push(String(e?.message ?? e));
  }

  diag.registeredCount = regCount;
  diag.registerErrors = regErrors;
  // ⭐ 关键诊断：模型服务是否真的就绪。
  //    没有它，「执行」会静默返回一个 token=0 的"成功"——
  //    看起来跑通了，其实模型一次都没被调用。
  diag.llmReady = llmReady;
  if (!llmReady) {
    diag.llmNotReadyHint =
      'ctx.inject([llm]) 的回调没有执行：当前环境缺少可用的模型服务。' +
      '「执行」会因为拿不到模型而返回空结果。';
  }
  try {
    const names = origTools?.schemas?.() ?? [];
    diag.visibleToolNames = Array.isArray(names)
      ? names
          .map((s: any) => (typeof s === 'string' ? s : s?.name))
          .filter((n: any) => typeof n === 'string' && (n.startsWith('bot_') || n.startsWith('routine_')))
      : [];
  } catch (e: any) {
    diag.schemasError = String(e?.message ?? e);
  }

  // ---------- 调度器 ----------
  let effectStarted = false;
  try {
    ctx.effect(() => {
      effectStarted = true;
      const timer = setInterval(() => {
        void (async () => {
          try {
            await service.schedulerTick(async (fire) => {
              // ⭐ 按触发来源分流：routine 跑流程，goal 推进目标
              if (fire.source === 'goal') {
                (ctx as any).logger?.info?.(
                  `[dsh-bot] 目标节奏触发 ${fire.botId}/${fire.goalId}`,
                );
                const bot = await service.get(fire.botId);
                const goal = await service.getGoal(fire.botId);
                if (!goal || goal.status !== 'active') return;

                const routines = await service.listRoutines(fire.botId);
                await runner.runTask(
                  fire.botId,
                  buildPanelTask(bot, goal, routines),
                  { dryRun: false, trigger: 'goal' },
                );
                return;
              }

              if (!fire.routineId) return;
              const routine = await service.getRoutine(fire.botId, fire.routineId);
              (ctx as any).logger?.info?.(
                `[dsh-bot] 定时触发 ${fire.botId}/${fire.routineId}`,
              );
              await runner.runRoutine(fire.botId, routine, {
                dryRun: false,
                trigger: 'schedule',
              });
            });
          } catch (e: any) {
            (ctx as any).logger?.error?.(
              `[dsh-bot] 调度 tick 失败: ${e?.message ?? e}`,
            );
          }
        })();
      }, config.schedulerTickMs);
      return () => clearInterval(timer);
    });
  } catch (e: any) {
    diag.effectError = String(e?.message ?? e);
  }
  diag.effectStarted = effectStarted;

  // ---------- Bot 面板 HTTP API ----------
  // client UI 跑在浏览器里读不到本地文件，通过 HTTP 桥接访问。
  let apiRoutes = 0;
  try {
    const routes = makeBotApiRoutes(service, {
      run: async (botId, opts) => {
        if (opts.routineId) {
          const routine = await service.getRoutine(botId, opts.routineId);
          return runner.runRoutine(botId, routine, {
            dryRun: opts.dryRun,
            trigger: 'manual',
          });
        }

        // ⚠️ 之前这里写死了一句「从面板触发的一次执行」——
        //    模型收到这句无意义的话，跑完也不知道该干什么，
        //    用户点「执行」看到的全是没有内容的成功。
        //
        //    现在改为：根据 Bot 的职责和目标，构造一个真实的任务描述。
        const bot = await service.get(botId);
        const goal = await service.getGoal(botId);
        const routines = await service.listRoutines(botId);

        const task = buildPanelTask(bot, goal, routines, opts.task);
        return runner.runTask(botId, task, {
          dryRun: opts.dryRun,
          trigger: 'manual',
        });
      },
      rollback: (botId, snapshotId) => service.rollback(botId, snapshotId),
      snapshot: async (botId) => {
        const bot = await service.get(botId);
        return service.createSnapshot(bot.workspace);
      },
      // 让面板能显示「当前会话用的模型」并支持改绑
      getSessionModel: () => {
        try {
          return detectSessionModel(ctx);
        } catch {
          return undefined;
        }
      },
      getAvailableModels: () => listAvailableModels(ctx),
      getSettings: (botId?: string) => settingsStore.resolve(botId),
      getGlobalSettings: () => settingsStore.getGlobal(),
      saveSettings: async (botId: string | undefined, patch: any) => {
        if (botId) return settingsStore.setForBot(botId, patch);
        return settingsStore.setGlobal(patch);
      },    });

    // ⚠️ 关键：不能用 ctx.inject() —— 服务不存在时回调永不执行且无报错。
    // 直接检查 ctx.webServer 是否可访问（它已在 inject 声明里，框架保证就绪）。
    let webServer: any;
    try {
      webServer = (ctx as any).webServer;
      diag.hasWebServer = Boolean(webServer);
    } catch (e: any) {
      diag.hasWebServer = false;
      diag.webServerError = String(e?.message ?? e);
    }

    if (webServer && typeof webServer.register === 'function') {
      for (const route of routes) {
        try {
          const d = webServer.register(route);
          apiRoutes++;
          // 记录 disposer，由下面的 effect 统一清理
          if (typeof d === 'function') {
            (ctx as any).effect?.(() => d, `dsh-bot: route ${route.path}`);
          }
        } catch (e: any) {
          diag.apiRegisterError = String(e?.message ?? e);
        }
      }
    } else {
      diag.apiSetupError = 'ctx.webServer 不可用，跳过 HTTP 路由注册';
    }
  } catch (e: any) {
    diag.apiSetupError = String(e?.message ?? e);
  }
  diag.apiRoutes = apiRoutes;

  writeMarker();

  (ctx as any).logger?.info?.(
    `[dsh-bot] 已加载：注册 ${regCount} 个工具，数据目录 ${service.homeDir}`,
  );
}

export {
  BotService,
  expandHome,
  isInside,
  assertInsideWorkspace,
  recallMemories,
  scoreMemory,
  appendJsonl,
  readJsonl,
  writeJsonAtomic,
} from './service.js';
export {
  validateRoutine,
  toMeta,
  interpolate,
  evalAssert,
} from './routine/schema.js';
export { RoutineRunner, buildSystemPrompt } from './routine/runner.js';
export {
  computeCostCny,
  computeCost,
  isFreeModel,
  isPeakHour,
  createLlmInvoker,
  createToolInvoker,
  describeLlmError,
} from './llm/bridge.js';
export { parseYaml, stringifyYaml } from './tools/yaml.js';
export {
  SnapshotManager,
  DEFAULT_SNAPSHOT_OPTIONS,
  diffSnapshots,
  formatBytes,
} from './routine/snapshot.js';
export { detectProvider, listToolNames } from './tools/draft.js';
export {
  parseCron,
  matchesCron,
  matchesCronAt,
  nextRunAt,
  isValidCron,
  describeCron,
  toZonedDate,
} from './scheduler/cron.js';
export { shiftOutOfPeak, adjustForCost, describeTimeSlot } from './scheduler/peak.js';
export {
  // 「守得住」：目标状态机。导出是为了让 dev/ 脚本能跑端到端验证，
  // 也让未来的远端 Provider 复用同一套权限规则。
  canTransition,
  assertTransition,
  createGoal,
  createProposal,
  parseCadence,
  transitionGoal,
  updateProgress,
  bumpCycle,
  applyAssessment,
  parseAssessment,
  isTerminal,
  isLive,
  needsAttention,
  goalStatusLabel,
  goalTypeLabel,
  ASSESSMENT_OPEN,
  ASSESSMENT_CLOSE,
  type GoalActor,
} from './goal/state.js';
export { proposeSuccessors, type SuccessionResult } from './goal/succession.js';
export {
  Scheduler,
  DEFAULT_SCHEDULER_OPTIONS,
  type ScheduleState,
  type ScheduledFire,
} from './scheduler/scheduler.js';
export {
  SettingsStore,
  DEFAULT_SETTINGS,
  mergeSettings,
  sanitizeSettings,
  inQuietHours,
  type BotSettings,
} from './settings.js';
export type { SnapshotMeta, SnapshotOptions } from './routine/snapshot.js';
export * from './types.js';
