/**
 * Routine 定义与校验
 *
 * Routine 是「可教学的流程」：一组可复用的步骤声明。
 * 用声明式 YAML 而非录屏，好处是可版本控制、可 diff、可测试。
 */

import { BotError } from '../types.js';

// ============================================================
// 类型
// ============================================================

export type StepType = 'tool' | 'llm' | 'script';

export type TriggerType = 'manual' | 'cron';

export interface RoutineTrigger {
  type: TriggerType;
  /** cron 表达式（type=cron 时必填） */
  expression?: string;
  /** 时区，默认 Asia/Shanghai */
  timezone?: string;
  /**
   * ⭐ 是否允许错峰推迟。
   *
   * - true（默认）：命中高峰时段时自动推迟到空闲时段，省一半成本
   * - false：严格按 cron 时间执行
   *
   * 例：日报类通常设为 false（用户就要 9 点看到）；
   *     备份类可设 true（几点跑都行，省钱优先）。
   */
  costSensitive?: boolean;
}

export interface AssertSpec {
  /** JS 表达式，可用变量：result */
  expr: string;
  message: string;
}

/** 工具步骤 */
export interface ToolStep {
  type: 'tool';
  id: string;
  name?: string;
  /** DSH 工具名 */
  tool: string;
  /** 参数，支持 {{}} 插值 */
  args?: Record<string, unknown>;
  /** 断言 */
  assert?: AssertSpec[];
  /** 失败是否中断；true 时失败也继续 */
  optional?: boolean;
}

/** LLM 步骤 */
export interface LlmStep {
  type: 'llm';
  id: string;
  name?: string;
  /** 提示词，支持 {{}} 插值 */
  prompt: string;
  /** 输出写入哪个变量名，默认用 id */
  output?: string;
  /** 覆盖 Bot 的模型配置 */
  model?: {
    provider?: string;
    model?: string;
    reasoningEffort?: 'low' | 'high' | 'max';
  };
  /** 最大输出 token */
  maxTokens?: number;
  assert?: AssertSpec[];
  optional?: boolean;
}

/** 脚本步骤（受限 JS 求值） */
export interface ScriptStep {
  type: 'script';
  id: string;
  name?: string;
  /** JS 表达式或语句块 */
  code: string;
  output?: string;
  assert?: AssertSpec[];
  optional?: boolean;
}

export type RoutineStep = ToolStep | LlmStep | ScriptStep;

export interface RoutineSpec {
  triggers: RoutineTrigger[];
  params: Record<string, unknown>;
  steps: RoutineStep[];
  onError?: {
    retry?: { maxAttempts: number; backoffMs: number };
  };
}

export interface Routine {
  apiVersion: 'dsh-bot/v1';
  kind: 'Routine';
  metadata: {
    id: string;
    name: string;
    description?: string;
    version: number;
  };
  spec: RoutineSpec;
}

/** 列表用的摘要 */
export interface RoutineMeta {
  id: string;
  name: string;
  description?: string;
  version: number;
  stepCount: number;
  triggers: RoutineTrigger[];
}

// ============================================================
// 校验
// ============================================================

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const CRON_RE = /^(\S+\s+){4}\S+$/;

function fail(msg: string): never {
  throw new BotError('INVALID_ROUTINE', msg);
}

/** 校验并规范化 Routine */
export function validateRoutine(input: unknown): Routine {
  if (!input || typeof input !== 'object') {
    fail('Routine 必须是对象');
  }
  const r = input as Record<string, any>;

  if (r.apiVersion !== 'dsh-bot/v1') {
    fail(`apiVersion 必须是 "dsh-bot/v1"，收到 ${JSON.stringify(r.apiVersion)}`);
  }
  if (r.kind !== 'Routine') {
    fail(`kind 必须是 "Routine"，收到 ${JSON.stringify(r.kind)}`);
  }

  // metadata
  const meta = r.metadata;
  if (!meta || typeof meta !== 'object') fail('缺少 metadata');
  if (typeof meta.id !== 'string' || !ID_RE.test(meta.id)) {
    fail(`metadata.id 必须匹配 ${ID_RE}，收到 ${JSON.stringify(meta.id)}`);
  }
  if (typeof meta.name !== 'string' || !meta.name.trim()) {
    fail('metadata.name 不能为空');
  }
  const version =
    meta.version === undefined ? 1 : Number(meta.version);
  if (!Number.isInteger(version) || version < 1) {
    fail('metadata.version 必须是正整数');
  }

  // spec
  const spec = r.spec;
  if (!spec || typeof spec !== 'object') fail('缺少 spec');

  const triggers: RoutineTrigger[] = Array.isArray(spec.triggers)
    ? spec.triggers.map((t: any, i: number) => {
        if (t?.type === 'manual') return { type: 'manual' as const };
        if (t?.type === 'cron') {
          if (typeof t.expression !== 'string' || !CRON_RE.test(t.expression.trim())) {
            fail(`spec.triggers[${i}].expression 不是合法 5 段 cron`);
          }
          return {
            type: 'cron' as const,
            expression: t.expression.trim(),
            timezone: typeof t.timezone === 'string' ? t.timezone : 'Asia/Shanghai',
            // 未显式设置时留给调度器按全局配置决定
            ...(typeof t.costSensitive === 'boolean'
              ? { costSensitive: t.costSensitive }
              : {}),
          };
        }
        return fail(`spec.triggers[${i}].type 必须是 manual 或 cron`);
      })
    : [{ type: 'manual' as const }];

  const params =
    spec.params && typeof spec.params === 'object' ? spec.params : {};

  const rawSteps = spec.steps;
  if (!Array.isArray(rawSteps) || rawSteps.length === 0) {
    fail('spec.steps 至少需要 1 步');
  }

  const seenIds = new Set<string>();
  const steps: RoutineStep[] = rawSteps.map((s: any, i: number) => {
    if (!s || typeof s !== 'object') fail(`spec.steps[${i}] 必须是对象`);
    if (typeof s.id !== 'string' || !s.id.trim()) {
      fail(`spec.steps[${i}].id 不能为空`);
    }
    if (seenIds.has(s.id)) {
      fail(`spec.steps 中 id 重复：${s.id}`);
    }
    seenIds.add(s.id);

    const common = {
      id: s.id,
      name: s.name,
      assert: validateAsserts(s.assert, i),
      optional: s.optional === true,
    };

    switch (s.type) {
      case 'tool':
        if (typeof s.tool !== 'string' || !s.tool.trim()) {
          fail(`spec.steps[${i}].tool 不能为空`);
        }
        return {
          ...common,
          type: 'tool' as const,
          tool: s.tool,
          args: s.args && typeof s.args === 'object' ? s.args : {},
        };
      case 'llm':
        if (typeof s.prompt !== 'string' || !s.prompt.trim()) {
          fail(`spec.steps[${i}].prompt 不能为空`);
        }
        return {
          ...common,
          type: 'llm' as const,
          prompt: s.prompt,
          output: s.output,
          model: s.model && typeof s.model === 'object' ? s.model : undefined,
          maxTokens:
            s.maxTokens === undefined ? undefined : Number(s.maxTokens),
        };
      case 'script':
        if (typeof s.code !== 'string' || !s.code.trim()) {
          fail(`spec.steps[${i}].code 不能为空`);
        }
        return {
          ...common,
          type: 'script' as const,
          code: s.code,
          output: s.output,
        };
      default:
        return fail(
          `spec.steps[${i}].type 必须是 tool / llm / script，收到 ${JSON.stringify(s.type)}`,
        );
    }
  });

  const onError =
    spec.onError && typeof spec.onError === 'object'
      ? {
          retry:
            spec.onError.retry &&
            typeof spec.onError.retry === 'object' &&
            Number(spec.onError.retry.maxAttempts) > 0
              ? {
                  maxAttempts: Math.min(
                    5,
                    Math.max(1, Number(spec.onError.retry.maxAttempts)),
                  ),
                  backoffMs: Math.max(
                    0,
                    Number(spec.onError.retry.backoffMs) || 0,
                  ),
                }
              : undefined,
        }
      : undefined;

  return {
    apiVersion: 'dsh-bot/v1',
    kind: 'Routine',
    metadata: {
      id: meta.id,
      name: meta.name,
      description: meta.description,
      version,
    },
    spec: { triggers, params, steps, onError },
  };
}

function validateAsserts(raw: any, stepIndex: number): AssertSpec[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) {
    fail(`spec.steps[${stepIndex}].assert 必须是数组`);
  }
  return raw.map((a: any, j: number) => {
    if (typeof a?.expr !== 'string' || !a.expr.trim()) {
      fail(`spec.steps[${stepIndex}].assert[${j}].expr 不能为空`);
    }
    return {
      expr: a.expr,
      message: typeof a.message === 'string' ? a.message : a.expr,
    };
  });
}

/** 生成摘要 */
export function toMeta(r: Routine): RoutineMeta {
  return {
    id: r.metadata.id,
    name: r.metadata.name,
    description: r.metadata.description,
    version: r.metadata.version,
    stepCount: r.spec.steps.length,
    triggers: r.spec.triggers,
  };
}

// ============================================================
// 插值
// ============================================================

/**
 * 极简的 {{}} 插值。
 *
 * 支持：
 *   {{.param.xxx}}    Routine 参数
 *   {{.steps.<id>.output}}   LLM 步骤输出
 *   {{.steps.<id>.result}}   工具步骤结果
 *   {{.env.DSH_BOT_XXX}}  环境变量（仅 DSH_BOT_* 前缀可见）
 *
 * 刻意不支持任意 JS 求值，避免注入。
 */
export function interpolate(template: unknown, vars: Record<string, any>): any {
  if (typeof template === 'string') {
    // 整串就是一个占位符时，保留原始类型（可能返回对象）
    const whole = template.match(/^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/);
    if (whole) {
      return resolvePath(whole[1], vars);
    }
    return template.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_m, expr) => {
      const v = resolvePath(String(expr), vars);
      return v === undefined || v === null ? '' : String(v);
    });
  }
  if (Array.isArray(template)) {
    return template.map((t) => interpolate(t, vars));
  }
  if (template && typeof template === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(template)) {
      out[k] = interpolate(v, vars);
    }
    return out;
  }
  return template;
}

function resolvePath(expr: string, vars: Record<string, any>): any {
  const path = expr.trim().replace(/^\./, '');
  const parts = path.split('.');
  let cur: any = vars;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[p];
  }
  return cur;
}

// ============================================================
// 断言求值
// ============================================================

/**
 * 受限的断言求值。
 *
 * 只支持极简语法，不做任意代码执行：
 *   result.exitCode === 0
 *   result.length > 0
 *   result.ok
 *   !result.error
 *
 * 复杂逻辑请用 script 步骤。
 */
export function evalAssert(expr: string, scope: Record<string, any>): boolean {
  const trimmed = expr.trim();

  // 否定
  if (trimmed.startsWith('!')) {
    return !evalAssert(trimmed.slice(1), scope);
  }

  // 比较运算
  const cmp = trimmed.match(
    /^([a-zA-Z_$][\w.$[\]]*)\s*(===|!==|==|!=|>=|<=|>|<)\s*(.+)$/,
  );
  if (cmp) {
    const [, lhsPath, op, rhsRaw] = cmp;
    const lhs = resolveExprValue(lhsPath, scope);
    const rhs = parseLiteral(rhsRaw);
    switch (op) {
      case '===':
      case '==':
        return lhs === rhs;
      case '!==':
      case '!=':
        return lhs !== rhs;
      case '>=':
        return Number(lhs) >= Number(rhs);
      case '<=':
        return Number(lhs) <= Number(rhs);
      case '>':
        return Number(lhs) > Number(rhs);
      case '<':
        return Number(lhs) < Number(rhs);
    }
  }

  // 真值判断
  const v = resolveExprValue(trimmed, scope);
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'string') return v.length > 0;
  return Boolean(v);
}

function resolveExprValue(path: string, scope: Record<string, any>): any {
  const parts = path.split('.');
  let cur: any = scope;
  for (const p of parts) {
    if (cur === null || cur === undefined) return undefined;
    // 支持 a[0] 形式
    const idx = p.match(/^(\w+)\[(\d+)\]$/);
    if (idx) {
      cur = cur[idx[1]]?.[Number(idx[2])];
    } else {
      cur = cur[p];
    }
  }
  return cur;
}

function parseLiteral(raw: string): any {
  const s = raw.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (s === 'null') return null;
  if (s === 'undefined') return undefined;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  const quoted = s.match(/^(['"])(.*)\1$/);
  if (quoted) return quoted[2];
  return s;
}
