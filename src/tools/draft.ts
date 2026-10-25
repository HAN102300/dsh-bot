/**
 * routine_draft — 自然语言 → Routine 草稿
 *
 * 这是替代 Grok Bot「演示录制」的低成本方案：
 *   用户描述意图 → 模型生成 YAML → 校验 → 返回预览
 *
 * 关键设计：
 *   1. 只用 JSON Output 让模型产出结构，避免解析自由文本
 *   2. 用现成的 validateRoutine() 校验，畸形产物会被拒绝
 *   3. 不落盘，必须用户确认后调 routine_save
 */

import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';

import { BotService } from '../service.js';
import { BotError } from '../types.js';
import { validateRoutine } from '../routine/schema.js';
import { stringifyYaml } from './yaml.js';
import type { LlmInvoker } from '../routine/runner.js';
import { formatCostCny } from '../llm/bridge.js';

/** 给模型看的 Routine 结构说明 */
const ROUTINE_SPEC = `
# Routine 的 JSON 结构

{
  "apiVersion": "dsh-bot/v1",
  "kind": "Routine",
  "metadata": {
    "id": "小写字母数字连字符，如 daily-report",
    "name": "人类可读的名字",
    "description": "一句话说明",
    "version": 1
  },
  "spec": {
    "triggers": [
      { "type": "manual" }
      // 或 { "type": "cron", "expression": "分 时 日 月 周", "timezone": "Asia/Shanghai" }
    ],
    "params": { "任意键值": "可在步骤中用 {{.param.键}} 引用" },
    "steps": [
      // 三类步骤，任选
      {
        "id": "步骤id（英文，唯一）",
        "name": "步骤名",
        "type": "tool",
        "tool": "工具名，如 bash / read / write / web_fetch",
        "args": { "任意参数，支持 {{}} 插值" },
        "assert": [{ "expr": "result.exitCode === 0", "message": "失败提示" }],
        "optional": false
      },
      {
        "id": "步骤id",
        "type": "llm",
        "prompt": "提示词，支持 {{.steps.某步骤.output}} 引用前序输出",
        "maxTokens": 4000,
        "optional": false
      },
      {
        "id": "步骤id",
        "type": "script",
        "code": "return 表达式;",
        "optional": false
      }
    ],
    "onError": {
      "retry": { "maxAttempts": 2, "backoffMs": 3000 }
    }
  }
}

# 插值语法
- {{.param.key}}                   流程参数
- {{.steps.<步骤id>.result}}       工具步骤的返回值
- {{.steps.<步骤id>.output}}       llm 步骤的文本输出
- {{.env.DSH_BOT_XXX}}        环境变量（仅 DSH_BOT_* 前缀可见，防泄漏）

# 注意事项
- 步骤 id 必须唯一，只能用英文小写、数字、连字符
- cron 必须是 5 段：分 时 日 月 周
- 有外部副作用的操作（发消息、调 webhook、写远端）应单独成一步，便于 dry-run 拦截
- 不要编造不存在的工具名
`;

export interface RegisterDraftToolOptions {
  service: BotService;
  llm: LlmInvoker;
  /** 用于生成草稿的模型（建议用更强的模型） */
  draftProvider?: () => string;
  draftModel?: () => string;
}

export function registerDraftTool(
  ctx: Context,
  opts: RegisterDraftToolOptions,
): void {
  const { service, llm } = opts;

  ctx.tools.register(
    defineTool({
      name: 'routine_draft',
      description:
        '用自然语言描述一个流程，自动生成 Routine 草稿（YAML）。' +
        '这是对 Grok Bot「演示录制」的低成本替代：你说要做什么，它写出可版本控制的流程定义。' +
        '⚠️ 只生成草稿不保存，确认后再调 routine_save。',
      parameters: {
        botId: { type: 'string', required: true, description: 'Bot ID' },
        intent: {
          type: 'string',
          required: true,
          description:
            '自然语言描述，如「每天早上9点检查仓库里的 TODO，超过10个就提醒我」',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value: any) => [{ type: 'text', text: String(value) }],
      },
      async execute(args): Promise<string> {
        const botId = String(args.botId);
        const bot = await service.get(botId);
        const intent = String(args.intent).trim();

        if (!intent) {
          throw new BotError('INVALID_ARGS', 'intent 不能为空');
        }

        // 取当前可用工具，避免模型编造
        const availableTools = listToolNames(ctx);

        const system = [
          '你是一个流程设计助手。把用户的自然语言需求转换成 Routine 的 JSON 定义。',
          '',
          ROUTINE_SPEC,
          '',
          '# 当前可用的工具',
          availableTools.length ? availableTools.join(', ') : '（无法获取工具列表）',
          '',
          '# 输出要求',
          '只输出一个 JSON 对象，不要任何解释、不要 markdown 代码块。',
        ].join('\n');

        const prompt = [
          `Bot 名称：${bot.name}`,
          `Bot 职责：${bot.role}`,
          '',
          `用户需求：${intent}`,
        ].join('\n');

        const provider = opts.draftProvider?.() ?? bot.model.provider;
        const model = opts.draftModel?.() ?? bot.model.model;

        let out;
        try {
          out = await llm({
            provider,
            model,
            reasoningEffort: 'max',
            system,
            prompt,
            maxTokens: 8000,
          });
        } catch (e: any) {
          throw new BotError(
            'INTERNAL',
            `生成草稿失败（模型调用出错）：${e?.message ?? e}`,
          );
        }

        // 从输出中抠出 JSON（模型可能仍包了代码块）
        const jsonText = extractJson(out.text);
        if (!jsonText) {
          return [
            '模型没有返回可解析的 JSON。原始输出：',
            '',
            out.text.slice(0, 1500),
            '',
            '建议：换个说法再试，或直接手写 YAML 用 routine_save 保存。',
          ].join('\n');
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(jsonText);
        } catch (e: any) {
          return [
            `模型返回的 JSON 无法解析：${e?.message ?? e}`,
            '',
            jsonText.slice(0, 1500),
          ].join('\n');
        }

        // 用真实 schema 校验
        let routine;
        try {
          routine = validateRoutine(parsed);
        } catch (e: any) {
          return [
            `生成的流程未通过校验：${e?.message ?? e}`,
            '',
            '模型原始输出（供你手动修改）：',
            '',
            '```json',
            jsonText.slice(0, 2000),
            '```',
          ].join('\n');
        }

        const yaml = stringifyYaml(routine);

        // 标注副作用，提前告知 dry-run 会拦哪些
        const sideEffectSteps = routine.spec.steps.filter(
          (s) => s.type === 'tool' || s.type === 'script',
        );

        const lines = [
          `草稿已生成（尚未保存）：「${routine.metadata.name}」`,
          `${routine.spec.steps.length} 步 · 花费 ${formatCostCny(out.usage)}`,
          '',
          '```yaml',
          yaml,
          '```',
        ];

        if (sideEffectSteps.length > 0) {
          lines.push(
            '',
            `⚠️ 其中 ${sideEffectSteps.length} 个步骤有副作用，首次执行会被 dry-run 拦截。`,
          );
        }

        lines.push(
          '',
          `确认无误后调 routine_save(botId="${botId}", yaml=<上面的内容>) 保存。`,
        );

        return lines.join('\n');
      },
    }),
  );
}

/** 从模型输出中抠出 JSON 对象 */
function extractJson(text: string): string | undefined {
  const t = text.trim();

  // 去掉 ```json ... ``` 包裹
  const fenced = t.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  const candidate = fenced ? fenced[1].trim() : t;

  const start = candidate.indexOf('{');
  if (start < 0) return undefined;

  // 括号配平找结尾
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < candidate.length; i++) {
    const c = candidate[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return undefined;
}

/** 从 ctx 读取当前可用的工具名 */
export function listToolNames(ctx: any): string[] {
  try {
    if (typeof ctx?.tools?.schemas === 'function') {
      const list = ctx.tools.schemas();
      if (Array.isArray(list)) {
        return list
          .map((s: any) => (typeof s === 'string' ? s : s?.name))
          .filter((x: any): x is string => typeof x === 'string');
      }
    }
  } catch {
    // 忽略
  }
  return [];
}

/**
 * 探测当前环境实际可用的 provider。
 *
 * 背景：不同 DSH 环境的 provider 名不同（如 workbuddy / deepseek-official），
 * 硬编码默认值会找不到适配器。
 */
export function detectProvider(ctx: any): string | undefined {
  try {
    if (typeof ctx?.llm?.listProviders === 'function') {
      const list = ctx.llm.listProviders();
      if (Array.isArray(list) && list.length > 0) {
        const names = list
          .map((p: any) => (typeof p === 'string' ? p : p?.id ?? p?.name ?? p?.route))
          .filter((x: any): x is string => typeof x === 'string');
        if (names.length > 0) return names[0];
      }
    }
  } catch {
    // 忽略
  }
  return undefined;
}
