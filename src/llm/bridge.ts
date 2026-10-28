/**
 * LLM 桥接层
 *
 * 把 DSH 的 ctx.llm.stream() 分片协议封装成简单的「一问一答」接口。
 * 复用官方适配器，因此自动获得 reasoning 回放等能力。
 */

import type { RunUsage } from '../types.js';

/** 一次调用的输入 */
export interface LlmCallInput {
  provider: string;
  model: string;
  reasoningEffort: 'low' | 'high' | 'max';
  system?: string;
  prompt: string;
  maxTokens?: number;
  signal?: AbortSignal;
  /**
   * 可用工具的 schema 列表。传入即启用工具协议——
   * 模型可以在回复里发起 tool_use（见 LlmCallOutput.toolUses）。
   */
  tools?: unknown[];
  /**
   * 多轮消息（含 assistant 的 tool_use 块与 user 的 tool_result 块）。
   * 传入时忽略 prompt；不传则单轮 prompt 调用。
   */
  messages?: any[];
}

/** 模型发起的一次工具调用 */
export interface ToolUseBlock {
  id?: string;
  name: string;
  input: unknown;
}

/** 一次调用的输出 */
export interface LlmCallOutput {
  text: string;
  reasoning?: string;
  usage: RunUsage;
  /** 模型本轮请求的工具调用；缺省视为无（便于测试 fake 与旧调用方） */
  toolUses?: ToolUseBlock[];
  /** 结束原因（如 'end_turn' / 'tool_use'），拿不到则 undefined */
  stopReason?: string;
}

/**
 * 定位成本（元/百万 token）。
 *
 * 数据来源：DeepSeek 官方定价（2026）。
 * 峰谷规则：工作日北京时间 9:00–12:00 / 14:00–18:00 为高峰，
 *          高峰价是空闲价的 2 倍。
 * 缓存：命中价是未命中价的 1/50。
 */
interface Pricing {
  inHit: number;
  inMiss: number;
  out: number;
}

/**
 * 价格表。
 *
 * key 格式：`<provider>/<model>:<peak|idle>`
 *
 * ⚠️ 为什么要带 provider：
 *   同一个模型名在不同服务商下价格可能不同（甚至免费）。
 *   只按 model 查表会让「our-free-model 的 flash」和
 *   「官方 flash」混为一谈。
 */
const PRICING: Record<string, Pricing> = {
  // ---------- DeepSeek 官方 ----------
  'deepseek/deepseek-flash:idle': { inHit: 0.02, inMiss: 1.0, out: 4.0 },
  'deepseek/deepseek-flash:peak': { inHit: 0.04, inMiss: 2.0, out: 8.0 },
  'deepseek/deepseek-v4-pro:idle': { inHit: 0.15, inMiss: 4.5, out: 13.5 },
  'deepseek/deepseek-v4-pro:peak': { inHit: 0.3, inMiss: 9.0, out: 27.0 },

  // 只给 model 名的写法（兼容旧的 Bot 配置）
  'deepseek-flash:idle': { inHit: 0.02, inMiss: 1.0, out: 4.0 },
  'deepseek-flash:peak': { inHit: 0.04, inMiss: 2.0, out: 8.0 },
  'deepseek-v4-pro:idle': { inHit: 0.15, inMiss: 4.5, out: 13.5 },
  'deepseek-v4-pro:peak': { inHit: 0.3, inMiss: 9.0, out: 27.0 },
};

/**
 * 明确标示为免费的服务商 / 模型特征。
 *
 * 这些必须单独标出，否则会显示成 `¥0.0000`——
 * 用户分不清"免费"和"算不出来"。
 */
const FREE_PATTERNS: RegExp[] = [
  // 名字里带 free 的任何组合
  /free/i,
  // provider 形如 deepseek-web（免费网页版）
  /-web(\/|$)/i,
  /^web(-|$)/i,
  // 以 -free 结尾的 model
  /-free$/i,
];

/**
 * 判断当前是否 DeepSeek 高峰时段。
 *
 * 规则：北京时间工作日 9:00–12:00 / 14:00–18:00。
 * 高峰价是空闲价的 2 倍，所以这个判断直接影响账单。
 */
export function isPeakHour(now: Date = new Date()): boolean {
  const bj = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const day = bj.getDay();
  if (day === 0 || day === 6) return false;
  const minutes = bj.getHours() * 60 + bj.getMinutes();
  return (
    (minutes >= 9 * 60 && minutes < 12 * 60) ||
    (minutes >= 14 * 60 && minutes < 18 * 60)
  );
}

/** 某个 provider/model 是否明显是免费的 */
export function isFreeModel(provider: string, model: string): boolean {
  const s = `${provider}/${model}`;
  return FREE_PATTERNS.some((re) => re.test(s));
}

/**
 * 成本计算结果。
 *
 * ⚠️ 这是一个对象而不是一个数字，因为「不知道」必须能和「0」区分开。
 *    早期版本返回裸 number，未知模型时静默估算，
 *    UI 显示 ¥0.0000 —— 用户以为免费，其实根本没算。
 */
export interface CostResult {
  /** 人民币金额；unknown 时为 undefined */
  cny?: number;
  /** 计价依据 */
  kind: 'exact' | 'free' | 'unknown';
  /** 给用户看的说明 */
  note: string;
}

/** 计算一次调用的成本（结构化结果） */
export function computeCost(
  provider: string,
  model: string,
  usage: { cacheHitTokens: number; cacheMissTokens: number; outputTokens: number },
  now: Date = new Date(),
): CostResult {
  // ① 免费模型
  if (isFreeModel(provider, model)) {
    return { cny: 0, kind: 'free', note: '免费模型' };
  }

  // ② 查表（先带 provider，再退化到只按 model）
  const phase = isPeakHour(now) ? 'peak' : 'idle';
  const p =
    PRICING[`${provider}/${model}:${phase}`] ??
    PRICING[`${model}:${phase}`];

  if (!p) {
    // ③ 查不到就诚实说不知道，不要估一个假装是真的数字
    return {
      kind: 'unknown',
      note: `没有 ${provider}/${model} 的价格数据，无法计算费用`,
    };
  }

  const cny =
    (usage.cacheHitTokens * p.inHit +
      usage.cacheMissTokens * p.inMiss +
      usage.outputTokens * p.out) /
    1_000_000;

  return {
    cny,
    kind: 'exact',
    note: phase === 'peak' ? '高峰时段计价' : '空闲时段计价',
  };
}

/** 兼容旧调用：只返回数字（未知时返回 0，但请优先用 computeCost） */
export function computeCostCny(
  model: string,
  usage: { cacheHitTokens: number; cacheMissTokens: number; outputTokens: number },
  now: Date = new Date(),
): number {
  return computeCost('', model, usage, now).cny ?? 0;
}

/**
 * 把运行记录里的成本格式化成给人看的字符串。
 *
 * 「0」和「算不出来」必须长得不一样（免费/未知/精确三态），
 * 展示层一律用这个函数，禁止直接 costCny.toFixed() ——
 * 未知成本时那是 undefined，toFixed 会直接抛错。
 */
export function formatCostCny(
  usage: Pick<RunUsage, 'costCny' | 'costKind' | 'costNote'> | undefined,
): string {
  const cost = usage?.costCny;
  if (usage?.costKind === 'free') return '免费';
  if (
    cost === undefined ||
    cost === null ||
    Number.isNaN(cost) ||
    usage?.costKind === 'unknown'
  ) {
    return `未知${usage?.costNote ? `（${usage.costNote}）` : '（无价格数据）'}`;
  }
  return `¥${cost.toFixed(6)}`;
}

/**
 * 把任意错误对象转成可读的一句话。
 *
 * 模型适配器抛出的错误常常是 `{ code, status, message }` 的形状，
 * 直接 String(e) 会得到 "[object Object]"——用户看了等于没看。
 */
export function describeLlmError(e: any): string {
  if (!e) return '未知错误';
  if (typeof e === 'string') return e;

  const parts: string[] = [];
  if (e.code) parts.push(`code=${e.code}`);
  if (e.status) parts.push(`status=${e.status}`);
  if (e.name && e.name !== 'Error') parts.push(e.name);

  const msg =
    e.message ?? e.error?.message ?? e.detail ?? e.reason ?? e.msg ?? '';
  if (msg) parts.push(String(msg).slice(0, 300));

  if (parts.length === 0) {
    try {
      return JSON.stringify(e).slice(0, 300);
    } catch {
      return String(e);
    }
  }
  return parts.join(' · ');
}

/**
 * 基于 ctx.llm 的实现。
 *
 * DSH 的分片协议：
 *   block-start → text-delta/reasoning-delta → block-end → usage → finish
 *
 * ⚠️ 这段代码曾经把"模型返回空内容"变成一条模糊的错误：
 *    它只处理 text-delta / reasoning-delta / usage / finish，
 *    其余 chunk 一律 `default: break` 丢掉。
 *    如果流里带 error chunk（鉴权失败、额度耗尽、适配器没装），
 *    就会被静默吞掉，最后表现为"模型返回了空内容"——
 *    用户完全不知道真实原因。
 *
 *    现在：任何非预期 chunk 都记录下来，出错时一并抛出。
 */
export function createLlmInvoker(ctx: any) {
  return async function invoke(input: LlmCallInput): Promise<LlmCallOutput> {
    const llm = ctx?.llm;
    if (!llm?.stream) {
      throw new Error(
        '当前 DSH 运行环境不提供 ctx.llm 服务，无法调用模型。' +
          '请确认已启用 @deepseek-ai/dsh-llm 与对应适配器。',
      );
    }

    const messages: any[] = [];
    if (input.system) {
      messages.push({ role: 'system', content: [{ type: 'text', text: input.system }] });
    }
    if (input.messages?.length) {
      messages.push(...input.messages);
    } else {
      messages.push({ role: 'user', content: [{ type: 'text', text: input.prompt }] });
    }

    let text = '';
    /** R3b 流空闲计时器（try 外声明，catch 也要清） */
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    /** 流式工具调用累积器：key=chunk.index */
    const streamingToolCalls = new Map<number, { id?: string; name?: string; args: string }>();
    let reasoning = '';
    let usage: any = undefined;
    const toolUses: ToolUseBlock[] = [];
    let stopReason: string | undefined;
    /** 流里出现的非预期 chunk / 错误，用于诊断 */
    const oddChunks: string[] = [];
    let streamError: any = undefined;

    const options: any = {
      provider: input.provider,
      model: input.model,
      messages,
      reasoningEffort: input.reasoningEffort,
    };
    if (input.maxTokens !== undefined) {
      options.maxTokens = input.maxTokens;
    } else {
      // ⭐ R3a（v0.3.1）：思考型模型在默认 maxTokens 下会把预算耗在思考上，
      //    正文为空 → EMPTY_OUTPUT。未显式指定时按 provider 给足余量。
      //    数值取「够思考 + 够完整报告」的经验值；小模型无碍（上限不是必达）。
      const THINKING_DEFAULTS = [
        { re: /deepseek-(?:v4|reasoner)|deepseek-flash/i, max: 16_384 },
        { re: /glm|zcode/i, max: 16_384 },
        { re: /kimi|moonshot/i, max: 16_384 },
        { re: /qwen|qwen3/i, max: 16_384 },
        { re: /o[1-9]|gpt-5|gpt-4\.|openai\//i, max: 16_384 },
        { re: /claude|opus|sonnet|haiku/i, max: 16_384 },
        { re: /free|openrouter/i, max: 8_192 },
      ];
      const hit = THINKING_DEFAULTS.find((t) => t.re.test(`${input.provider}/${input.model}`));
      if (hit) options.maxTokens = hit.max;
    }
    if (input.signal) options.signal = input.signal;
    if (input.tools?.length) options.tools = input.tools;

    try {
      // ⭐ R3b（v0.3.1）：流「空闲」超时——流建立了但 90 秒无任何新 chunk 的
      //    挂死场景（网络半开、适配器内部卡住）。注意是空闲超时而非总时长：
      //    思考型模型合法长跑（16k tokens 数分钟）只要持续出 chunk 就不误杀。
      //    实现：90s 计时器 + 每收到 chunk 重置；超时抛错交给 R1 重试兜底。
      const IDLE_MS = 90_000;
      const idleController = new AbortController();
      const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => idleController.abort(new Error('stream idle > 90s')), IDLE_MS);
      };
      resetIdle();
      const combined = options.signal
        ? AbortSignal.any([options.signal, idleController.signal])
        : idleController.signal;
      options.signal = combined;
      for await (const chunk of llm.stream(options)) {
        resetIdle();
        switch (chunk?.type) {
          case 'text-delta':
            text += chunk.text ?? '';
            break;
          case 'reasoning-delta':
            reasoning += chunk.text ?? '';
            break;
          case 'usage':
            usage = chunk.usage;
            break;
          case 'finish':
            stopReason = chunk.stopReason ?? chunk.finishReason ?? chunk.reason;
            break;
          case 'tool-call-delta': {
            // ⭐ 流式工具调用增量（2026-10-28）：our-free-model/openrouter 等适配器
            //    以增量块发原生 tool call，且可能不回传含完整块的 block-end。
            //    之前把这类 chunk 丢进 oddChunks → 模型的回答被静默吞掉 → 空内容。
            //    现按 dsh-llm 累积协议（index 分片、id/name/argumentsDelta 增量）
            //    自行组装完整 tool-use。
            const idx = Number(chunk.index ?? 0);
            let partial = streamingToolCalls.get(idx);
            if (!partial) {
              partial = { id: undefined, name: undefined, args: '' };
              streamingToolCalls.set(idx, partial);
            }
            if (typeof chunk.id === 'string') partial.id = chunk.id;
            if (typeof chunk.name === 'string') partial.name = chunk.name;
            if (typeof chunk.argumentsDelta === 'string') partial.args += chunk.argumentsDelta;
            break;
          }
          case 'block-end': {
            // 兜底：若增量缺失，从完整块补齐
            const block = chunk.block;
            if (block?.type === 'text' && !text) text = block.text ?? '';
            if (block?.type === 'reasoning' && !reasoning) reasoning = block.text ?? '';
            // ⭐ 工具协议：模型发起的工具调用以完整块到达
            //    （块类型名做宽容兼容：tool_use / toolUse / tool_call / tool-call）
            const tu = asToolUse(block);
            if (tu) toolUses.push(tu);
            break;
          }
          case 'error':
          case 'adapter-failure':
          case 'aborted': {
            // ⭐ 这些是真实的失败信号，必须保留下来
            streamError = chunk;
            break;
          }
          case 'block-start':
          case 'block-delta':
            break;
          default: {
            // 未知类型：记下来，别静默丢（未登记的增量变体可能落在这里）
            if (chunk?.type) oddChunks.push(String(chunk.type));
            break;
          }
        }
      }
      if (idleTimer) clearTimeout(idleTimer);
    } catch (e: any) {
      if (idleTimer) clearTimeout(idleTimer);
      // 流式调用抛错（鉴权 / 网络 / 适配器）——保留原始信息
      const detail = describeLlmError(e);
      throw new Error(`模型调用失败（${input.provider}/${input.model}）：${detail}`);
    }

    // ⭐ 流式组装的 tool-use 兜底合并：若适配器只发了增量块、没有 block-end
    //    完整块（或块类型名不在 asToolUse 认识的列表里），这里按累积结果补齐。
    //    合并去重：block-end 路径已收集的同名调用不重复收。
    if (streamingToolCalls.size > 0) {
      for (const [, partial] of [...streamingToolCalls.entries()].sort((a, b) => a[0] - b[0])) {
        if (!partial.name) continue; // 没有 name 的分片无法成调用
        const args = sanitizeToolArgs(partial.args ? safeJsonParse(partial.args) : {});
        const dupe = toolUses.some((t) => t.name === partial.name && JSON.stringify(t.input) === JSON.stringify(args));
        if (!dupe) {
          toolUses.push({ id: partial.id, name: partial.name, input: args });
        }
      }
    }

    // 有错误 chunk：优先报它，而不是让上层看到"空输出"
    if (streamError && !text && toolUses.length === 0) {
      const detail = describeLlmError(streamError.error ?? streamError);
      throw new Error(`模型返回错误（${input.provider}/${input.model}）：${detail}`);
    }

    // 空输出：把诊断信息一起带上。
    // 注意：模型选择只调用工具、不说话时 text 为空是**合法**的
    //（toolUses 非空），不算空输出。
    if (!text.trim() && toolUses.length === 0) {
      const hints: string[] = [];
      if (reasoning) {
        hints.push(
          `模型只输出了 ${reasoning.length} 字思考内容，没有正文。` +
            `可能是 maxTokens 太小，或模型在该 prompt 下只思考不回答。`,
        );
      }
      if (usage) {
        hints.push(
          `token 统计：in=${usage.inputTokens ?? 0} out=${usage.outputTokens ?? 0}`,
        );
      } else {
        hints.push('没有收到任何 usage 统计——流可能在中途断掉。');
      }
      if (oddChunks.length) {
        hints.push(`收到未处理的 chunk 类型：${[...new Set(oddChunks)].join(', ')}`);
      }
      hints.push(`provider=${input.provider} model=${input.model}`);
      throw new Error(`模型返回了空内容。${hints.join(' ')}`);
    }

    const inputTokens = Number(usage?.inputTokens ?? 0);
    const outputTokens = Number(usage?.outputTokens ?? 0);
    const cacheHitTokens = Number(
      usage?.cacheHitTokens ?? usage?.prompt_cache_hit_tokens ?? 0,
    );
    const cacheMissTokens = Number(
      usage?.cacheMissTokens ??
        usage?.prompt_cache_miss_tokens ??
        Math.max(0, inputTokens - cacheHitTokens),
    );
    const reasoningTokens = Number(
      usage?.reasoningTokens ??
        usage?.completion_tokens_details?.reasoning_tokens ??
        0,
    );

    // ⭐ 结构化成本：区分「真的 0」（免费）和「算不出来」（unknown）
    const cost = computeCost(input.provider, input.model, {
      cacheHitTokens,
      cacheMissTokens,
      outputTokens,
    });

    return {
      text,
      reasoning: reasoning || undefined,
      usage: {
        inputTokens,
        outputTokens,
        cacheHitTokens,
        cacheMissTokens,
        reasoningTokens,
        costCny: cost.cny,
        costKind: cost.kind,
        costNote: cost.note,
      },
      toolUses,
      stopReason,
    };
  };
}

/**
 * 把流里的块宽容地识别成工具调用。
 * DSH 各适配器对块类型命名不统一（tool_use / toolUse / tool_call），
 * 输入参数同理（input / arguments）。识别不了返回 undefined。
 */
function asToolUse(block: any): ToolUseBlock | undefined {
  if (!block || typeof block !== 'object') return undefined;
  const type = String(block.type ?? '');
  if (!['tool_use', 'toolUse', 'tool_call', 'function_call'].includes(type)) {
    return undefined;
  }
  const name = block.name ?? block.function?.name;
  if (typeof name !== 'string' || !name) return undefined;
  return {
    id: typeof block.id === 'string' ? block.id : undefined,
    name,
    input: sanitizeToolArgs(block.input ?? block.arguments ?? block.function?.arguments ?? {}),
  };
}

/**
 * 把工具参数净化为 plain JSON 对象。
 *
 * 为什么需要：宿主 ToolRuntime 在分发前用 snapshotJsonValue 做
 * 「无损 JSON」校验，要求参数对象是 plain object（原型必须是
 * Object.prototype）。部分适配器构造的 tool_use.input 带自定义原型
 * 或 getter，会被判为不可序列化，调用直接失败——
 * 报错是 "tool execution arguments must be losslessly JSON-serializable"。
 *
 * JSON round-trip 一次即可重建为宿主接受的普通对象；
 * 参数本来就是模型产出的 JSON，round-trip 无损。
 */
function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function sanitizeToolArgs(input: unknown): Record<string, unknown> {
  try {
    return JSON.parse(JSON.stringify(input ?? {})) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** 归一化后的工具条目 */
export interface NormalizedTool {
  name: string;
  description?: string;
  parameters?: unknown;
}

/** createToolInvoker.list() 实际探测成功的方法名（诊断用） */
let lastProbeUsed: string | undefined;
export function lastToolProbeMethod(): string | undefined {
  return lastProbeUsed;
}

/**
 * 宿主工具条目归一化。
 *
 * 已知形状（真机 + 源码考察）：
 *   - 'web_fetch'                          —— 纯工具名字符串
 *   - { name, description?, parameters? }  —— 标准 schema
 *   - { meta: { name, ... }, ... }         —— cordis 包裹形态
 *   - { tool: { name, ... } }              —— 嵌套形态
 * 形状对不上的条目返回 null（调用方过滤），绝不抛错。
 */
export function normalizeToolEntry(entry: unknown): NormalizedTool | null {
  if (typeof entry === 'string') {
    return entry.trim() ? { name: entry.trim() } : null;
  }
  if (entry && typeof entry === 'object') {
    const e = entry as any;
    const name = e.name ?? e.meta?.name ?? e.tool?.name;
    if (typeof name !== 'string' || !name.trim()) return null;
    return {
      name: name.trim(),
      description:
        (typeof e.description === 'string' && e.description) ||
        (typeof e.meta?.description === 'string' && e.meta.description) ||
        (typeof e.tool?.description === 'string' && e.tool.description) ||
        undefined,
      parameters:
        e.parameters ?? e.input_schema ?? e.schema ?? e.meta?.parameters ?? e.tool?.parameters,
    };
  }
  return null;
}

/**
 * 基于 ctx.tools 的工具调用器。
 */
export function createToolInvoker(ctx: any) {
  return {
    has(name: string): boolean {
      try {
        // ctx.tools.get(name) 在 DSH 中按作用域解析
        if (typeof ctx?.tools?.get === 'function') {
          return Boolean(ctx.tools.get(name));
        }
        // 退化：检查 schemas
        if (typeof ctx?.tools?.schemas === 'function') {
          const list = ctx.tools.schemas();
          return Array.isArray(list) && list.some((s: any) => (s.name ?? s) === name);
        }
        return false;
      } catch {
        return false;
      }
    },
    /**
     * 列出宿主工具（已归一化为 {name, description?, parameters?}）。
     *
     * ⚠️ 真机教训（0.2.0）：这里曾只调 schemas() 并假设元素是 {name,...}
     * 对象——真机上模型报「没有可用工具」，因为宿主返回的形状对不上，
     * 全被过滤器丢掉。现在：多个方法名都试一遍 + 元素归一化，
     * 字符串（纯工具名）也算有效条目。
     */
    list(): NormalizedTool[] {
      for (const method of ['schemas', 'list', 'all', 'entries']) {
        try {
          const fn = ctx?.tools?.[method];
          if (typeof fn !== 'function') continue;
          const raw = fn.call(ctx.tools);
          if (!Array.isArray(raw)) continue;
          const normalized = raw
            .map(normalizeToolEntry)
            .filter((t): t is NormalizedTool => t !== null);
          if (normalized.length > 0 || raw.length === 0) {
            // 空数组也算「这个方法有效但宿主没注册」——记录它，别再试下一个
            lastProbeUsed = method;
            return normalized;
          }
        } catch {
          /* 换下一个方法 */
        }
      }
      return [];
    },
    async call(name: string, args: unknown, signal?: AbortSignal): Promise<unknown> {
      const tools = ctx?.tools;
      // 形态 A：门面风格 call(name, args, opts)
      if (typeof tools?.call === 'function') {
        const res = await tools.call(name, args, signal ? { signal } : undefined);
        return unwrapToolResult(res);
      }
      // 形态 B：ToolRuntime.execute(exec) —— 单对象签名 { name, arguments }。
      // ⚠️ 真机教训：曾按位置参数 (name, args, opts) 调用 execute，
      // 导致 exec="http_get"、exec.arguments=undefined，
      // 在 snapshotJsonValue 处抛 "tool execution arguments must be
      // losslessly JSON-serializable"。宿主 ToolRuntime.execute 的
      // 真实签名是单对象（见 dsh-tools lib：async execute(exec)）。
      if (typeof tools?.execute === 'function') {
        // ⚠️ ToolRuntime.createExecution 无条件读取 exec.signal.aborted，
        // signal 缺省会抛 "Cannot read properties of undefined (reading 'aborted')"。
        // 调用方没有 signal 时必须给一个默认的（永不中止）signal。
        const exec: Record<string, unknown> = {
          name,
          arguments: args ?? {},
          signal: signal ?? new AbortController().signal,
        };
        const res = await tools.execute(exec);
        return unwrapToolResult(res);
      }
      throw new Error(`当前 DSH 运行环境不支持程序化调用工具：${name}`);
    },
  };
}

/** 工具返回可能是 { content, value } 形态，尽量取 value */
function unwrapToolResult(res: any): unknown {
  if (res && typeof res === 'object') {
    if ('value' in res && res.value !== undefined) return res.value;
    if ('content' in res) return res.content;
  }
  return res;
}






