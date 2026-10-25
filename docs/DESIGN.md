# ⚠️ 历史设计记录（0.1 版，2026-10-19）

> 本文档是初版设计快照，部分内容已被 v0.2 重启计划修订：
> - 自研 DeepSeek 适配器 → 已删除（复用官方 dsh-llm-deepseek）
> - 15 个工具 → 现为 23 个（以自动生成的 [TOOLS.md](./TOOLS.md) 为准）
> - runTask 单次调用 → 已升级为工具循环
> - 快照/调度/预算实现已大改（见 [ROADMAP-v0.3.md](./ROADMAP-v0.3.md) 已完成表）
>
> 与现实冲突处以代码为准；本文档价值在数据模型与 Routine DSL 的原始设计思路。

---

# DSH Bot — 技术设计文档

> **一个运行在 DeepSeek Harness 里的常驻 AI 队友（Always-On AI Teammate）**
> 对标 Grok Bot，深度适配国产模型（DeepSeek 优先）

| 项 | 值 |
|---|---|
| 文档版本 | v1.0 |
| 日期 | 2026-10-19 |
| 目标平台 | DSH Desktop `0.2.1-rc.2`+ / DSH CLI |
| 目标模型 | DeepSeek `deepseek-flash`、`deepseek-v4-pro`（并兼容 Qwen / Kimi / GLM / 豆包） |
| 插件包名 | `dsh-bot`（预留 `@dsh-bot/*` scope） |
| 状态 | 设计定稿，待评审 |

---

## 目录

1. [产品定义与定位](#1-产品定义与定位)
2. [竞品分析结论与差异化](#2-竞品分析结论与差异化)
3. [总体架构](#3-总体架构)
4. [核心数据模型](#4-核心数据模型)
5. [记忆子系统](#5-记忆子系统)
6. [Routine（流程教学）子系统](#6-routine流程教学子系统)
7. [DeepSeek 深度适配层](#7-deepseek-深度适配层)
8. [工具清单与契约](#8-工具清单与契约)
9. [安全与权限模型](#9-安全与权限模型)
10. [成本控制与可观测性](#10-成本控制与可观测性)
11. [调度与常驻](#11-调度与常驻)
12. [插件工程结构与打包](#12-插件工程结构与打包)
13. [开发里程碑](#13-开发里程碑)
14. [测试策略](#14-测试策略)
15. [风险登记册](#15-风险登记册)
16. [附录 A：完整代码骨架](#附录-a完整代码骨架)
17. [附录 B：参考资料](#附录-b参考资料)

---

## 1. 产品定义与定位

### 1.1 一句话定义

> **让你在 DSH 里创建几个有名字、有记忆、有固定流程的 AI 同事，它们用自己的工作区干活，记住做过什么，并且每天按点上班。**

### 1.2 它不是什么

明确划界，避免范围失控：

| 不做 | 原因 |
|---|---|
| ❌ 不做「共享云电脑」 | Grok Bot 最大的争议点（无安全隔离、HN 350 分讨论集中在信任与 prompt injection）。我们做**本地优先 + 显式隔离** |
| ❌ 不做 Computer Use（v1.0） | 投入产出比最低，DSH 的 Playwright skill 已覆盖大部分场景。列入 v2.0 |
| ❌ 不做云端托管 | 用户数据不出本机，这正是国产化的合规优势 |
| ❌ 不做通用聊天前端 | DSH 已有 Web UI，我们只提供能力 |

### 1.3 四项核心能力（对标 Grok Bot 四大设计）

| Grok Bot 的设计 | 我们的实现 | 说明 |
|---|---|---|
| 持久云电脑 | **持久工作区**（本地目录 + 独立 shell 会话） | 本地优先，每 Bot 独立目录隔离 |
| 上下文累积 | **分层记忆**（工作记忆 / 情景记忆 / 语义记忆） | 见 §5，比 Grok Bot 的"压缩上下文"更结构化 |
| 演示教学 Routines | **声明式 Routine DSL** + 自然语言生成（录制器列 v2.0） | 见 §6，YAML 可版本控制、可 diff |
| 混合 API + Computer Use | **内置工具 + MCP 优先，Computer Use 后置** | v1.0 不碰 Computer Use，见 §1.2 |

### 1.4 目标用户与典型场景

**核心用户**：中国境内开发者、技术团队、独立开发者（DeepSeek 生态）。

**场景 A — 日报机器人**
> "每天早上 9 点，读我 Git 昨天的提交和 Jira 变更，写一份中文日报发到群里。"

**场景 B — 代码巡检哨兵**
> "每 6 小时扫一遍仓库，找出 TODO/FIXME 集中区域和新增的 `console.log`，超过阈值就提醒我。"

**场景 C — 竞品情报跟踪**
> "每天抓一下 X、Y、Z 三个竞品的更新日志，有变化就总结给我。"

**场景 D — 数据整理助手**
> "每周一把 downloads 目录下的发票 PDF 提取成 Excel 表格。"

---

## 2. 竞品分析结论与差异化

### 2.1 品类地图

```
三大形态（按"谁保证机器一直开着"切分）
├── A. 托管云电脑   → Grok Bot / Manus / Devin / ChatGPT Work / Lindy
├── B. 自托管框架   → OpenClaw / Hermes Agent
└── C. 自有硬件工作台 → Continuum / Claude Code / Cursor
        ▲
        └── 我们在这里，但比 C 多了"常驻 + 记忆 + 教学"
```

### 2.2 关键竞品参数（2026-08 核实）

| 产品 | Agent 运行位置 | 关机后继续 | 模型可选 | 登录态归属 | 价格 |
|---|---|---|---|---|---|
| **Grok Bot** | xAI 云 VM（每账号共享一台） | ✅ | ❌ 自动路由 | 共享云，所有 Bot 可读 | 捆绑订阅，最低 Cursor Teams Standard $40/席 |
| **Manus** | 厂商云 | ✅ | 厂商托管 | 厂商云 | 按 credit |
| **Devin** | 厂商云 workspace | ✅ | 厂商托管 | 厂商云 | 托管定价 |
| **ChatGPT Work** | OpenAI 云，每任务沙箱 | ✅ | 仅 OpenAI | OpenAI 云，按会话隔离 | 按席 |
| **Lindy** | 厂商云 | ✅ | 厂商托管 | 按集成隔离 | $29.99+/席 + credits |
| **OpenClaw** | 自己托管（VPS） | ✅ | ✅ | 你的服务器 | MIT 免费 + VPS + API + 运维 |
| **Hermes Agent** | 你的桌面 | ❌ | ✅ | 你的机器 | 厂商套餐 |
| **Continuum** | 自有 Mac/Linux/Win | ❌ | ✅ 全厂商 | 你的机器 | App 免费 |

### 2.3 Grok Bot 的已知缺陷 → 我们的差异化

这是本文档最重要的部分。**每一项都是可以赢得用户的真实缺口**：

| Grok Bot 缺陷 | 证据来源 | 我们的对策 |
|---|---|---|
| **运行记录只保留最近 20 条** | Daily Dose of DS（xAI 未确认） | **全量保留 + 可检索审计日志** |
| **无审计追踪** | eesel 评测 | 每次工具调用落 JSONL，可导出 |
| **无 dry-run** | eesel："A test run performs real work. If you rehearse an email send, you sent an email." | **`dry_run` 默认 `true`**，显式关闭才真执行 |
| **无消费上限** | Continuum："no product-specific spend cap" | **每 Bot 独立预算，超限即停**（见 §10） |
| **不能选模型** | 官方文档 | **每 Bot 可指定 provider/model**，甚至每步可换 |
| **无安全隔离** | 官方："without getting separate security boundaries" | **每 Bot 独立工作区 + 独立凭据命名空间** |
| **必须绑 Cursor 账号** | 官方 | 无厂商锁定，纯 API Key |
| **中文场景弱** | 通用观察 | **中文优先的 Prompt / 记忆压缩策略** |

### 2.4 市场规模判断

- DSH 生态已有 **15,070 个** 已收录插件（dsh-plugin.org 实测），分发渠道现成
- 国产模型（DeepSeek）价格是国际同类 1/5 ~ 1/10，Bot 常驻的经济性大幅提升
- 「常驻 + 记忆 + 教学」这个组合在国内**尚无成熟开源产品**

---

## 3. 总体架构

### 3.1 分层图

```
┌──────────────────────────────────────────────────────────────┐
│  L4  UI 层（DSH Web UI / Desktop）                             │
│  · Bot 列表卡片  · 运行历史时间线  · 预算仪表  · Routine 编辑器 │
├──────────────────────────────────────────────────────────────┤
│  L3  编排层  ⬅️ 本项目核心自研                                  │
│  ┌────────────┬────────────┬────────────┬──────────────────┐  │
│  │ 记忆引擎    │ Routine引擎 │ 调度器      │ 预算守卫          │  │
│  │ Memory     │ Runner     │ Scheduler  │ BudgetGuard      │  │
│  └────────────┴────────────┴────────────┴──────────────────┘  │
├──────────────────────────────────────────────────────────────┤
│  L2  适配层  ⬅️ 本项目自研（国产模型适配）                       │
│  ┌──────────────────┬──────────────────────────────────────┐ │
│  │ DeepSeekAdapter   │ 国产模型路由（Qwen/Kimi/GLM/豆包）     │ │
│  │ · reasoning 回传   │ · 统一 OpenAI 兼容                     │ │
│  │ · 缓存前缀优化     │ · 能力探测 + 降级                      │ │
│  │ · 峰谷调度         │                                       │ │
│  └──────────────────┴──────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────┤
│  L1  DSH 底座  ✅ 直接复用，不重造                              │
│  · Cordis 插件框架     · ctx.tools / ctx.llm / ctx.shell      │
│  · defineTool DSL      · SessionPersistence (JSONL)           │
│  · dsh-ops (shell/file/background)                            │
│  · dsh-free-search     · Playwright skill                     │
│  · dsh-cost-meter（已有插件，可对接）                            │
└──────────────────────────────────────────────────────────────┘
```

### 3.2 与 DSH 的三角色能力模型对齐

DSH 官方推荐 **Service Definition / Service Provider / Consumer** 三角色拆分。我们遵循这一模式：

```
┌────────────────────┐
│  dsh-bot (定义)     │  BotService 抽象类 + 全部类型
│  Service Definition│  Bot / Memory / Routine / RunRecord
└─────────┬──────────┘
          │
    ┌─────┴──────────────┬──────────────────┐
    ▼                    ▼                  ▼
┌─────────────┐  ┌──────────────┐  ┌──────────────┐
│ bot-local   │  │ bot-deepseek │  │ tool-bot-*   │
│ 本地存储/调度 │  │ 模型适配      │  │ 对模型暴露工具 │
│ (Provider)  │  │ (Provider)   │  │ (Consumer)   │
└─────────────┘  └──────────────┘  └──────────────┘
```

**但遵循官方告诫：「不要预防性拆分」**。v1.0 MVP 阶段**全部放在一个包里**，只在 Provider 需要独立替换时（比如接入非 DeepSeek 模型）才拆。见 §12。

### 3.3 运行时数据流（一次 Bot 执行）

```
用户/定时器触发 bot_run(botId, routineId)
        │
        ▼
  ┌──────────────┐
  │ BudgetGuard  │── 超预算 ──▶ 拒绝，返回 BudgetExceeded
  └──────┬───────┘
         ▼
  ┌──────────────┐
  │ Memory.load  │ 加载 identity + 相关记忆 + 上次运行摘要
  └──────┬───────┘
         ▼ 构造 system prompt（稳定前缀，利于 KV Cache）
  ┌──────────────┐
  │ RoutineRunner│ 逐步执行 steps[]
  └──────┬───────┘
         │ 每步：
         │  1. 若是 tool ∈ DSH 工具 → ctx.tools.call()
         │  2. 若是 llm step → ctx.llm（DeepSeekAdapter）
         │  3. dry_run && 破坏性工具 → 拦截，返回预览
         ▼
  ┌──────────────┐
  │ Memory.write │ 追加本轮到 memory.jsonl
  │ RunRecorder  │ 写 runs/<id>.json（全量，不过期）
  └──────┬───────┘
         ▼
    返回 RunResult
```

---

## 4. 核心数据模型

### 4.1 存储布局

遵循 DSH 惯例，全部放在 `$DSH_HOME`（实测为 `C:\Users\<user>\.dsh`）下：

```
~/.dsh/bot/
├── index.json                    # Bot 索引（快速列表用）
├── bots/
│   └── <bot-id>/
│       ├── identity.json         # 身份
│       ├── memory.jsonl          # 情景记忆（追加写）
│       ├── semantic.json         # 语义记忆（蒸馏后，滚动更新）
│       ├── routines/
│       │   └── <routine-id>.yaml # 流程定义
│       ├── workspace/            # ⭐ 该 Bot 的独立工作目录
│       └── .credentials/         # 凭据命名空间（v2.0）
└── runs/
    └── <yyyy>/<mm>/<run-id>.json # ⭐ 全量运行记录，永不过期
```

**设计要点**：
- `memory.jsonl` 追加写 → 崩溃可恢复，只需读最后一行校验
- `workspace/` 物理隔离 → Bot A 的工具调用无法触及 Bot B 的文件（除非显式授权）
- `runs/` 按年月分目录 → 单目录文件数可控，便于 `grep`

### 4.2 类型定义

```ts
// ---------- Bot 身份 ----------
export interface BotIdentity {
  id: string;                    // 稳定 ID，如 "bot_7f3a2c"
  name: string;                  // 人类可读名，如 "日报小助手"
  role: string;                  // 一句话职责
  avatar?: string;               // 可选，emoji 或图片路径
  createdAt: string;             // ISO 8601
  // 模型绑定（Grok Bot 没有的能力）
  model: {
    provider: string;            // 'deepseek' | 'qwen' | 'kimi' ...
    model: string;               // 'deepseek-flash' | 'deepseek-v4-pro'
    reasoningEffort: 'low' | 'high' | 'max';
    thinking: boolean;           // 是否开启思考模式
  };
  // 预算（Grok Bot 没有的能力）
  budget: {
    dailyCny: number;            // 每日人民币上限
    monthlyCny: number;
    onExceed: 'stop' | 'downgrade'; // 超限：停机 或 降级到 flash
  };
  // 工作区
  workspace: string;             // 绝对路径
  // 能力开关
  capabilities: {
    allowShell: boolean;         // 默认 false
    allowNetwork: boolean;       // 默认 true
    allowWriteOutsideWorkspace: boolean; // 默认 false
    allowedTools?: string[];     // 白名单，undefined = 全部
  };
  // 系统提示（稳定前缀，利于 KV Cache）
  systemPromptExtra?: string;
}

// ---------- 记忆条目 ----------
export interface MemoryEntry {
  ts: string;                    // ISO 8601
  runId: string;
  kind: 'observation' | 'decision' | 'outcome' | 'fact' | 'preference';
  summary: string;               // ≤ 200 字，模型生成
  detail?: string;               // 原始细节（可选，按需加载）
  tags: string[];                // 用于检索
  importance: number;            // 1-5，用于淘汰
}

// ---------- 运行记录 ----------
export interface RunRecord {
  id: string;
  botId: string;
  routineId?: string;
  trigger: 'manual' | 'schedule' | 'event';
  startedAt: string;
  endedAt: string;
  dryRun: boolean;
  status: 'success' | 'failed' | 'partial' | 'aborted' | 'budget_exceeded';
  steps: StepRecord[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheHitTokens: number;
    costCny: number;
  };
  error?: { code: string; message: string };
}

export interface StepRecord {
  index: number;
  kind: 'tool' | 'llm' | 'assert';
  name: string;
  args?: unknown;
  result?: unknown;
  blocked?: { reason: string };  // dry_run 拦截时
  durationMs: number;
}
```

---

## 5. 记忆子系统

这是与 Grok Bot 差异最大的部分之一。Grok Bot 只是"上下文不清空"，我们做**结构化分层记忆**。

### 5.1 三层记忆模型

| 层 | 存储 | 生命周期 | 容量 | 用途 |
|---|---|---|---|---|
| **工作记忆** Working | LLM 上下文窗口 | 单次运行 | ≤ 1M tokens | 当前任务 |
| **情景记忆** Episodic | `memory.jsonl` | 永久 | 无上限（滚动蒸馏） | "上周二我做了什么" |
| **语义记忆** Semantic | `semantic.json` | 滚动更新 | ≤ 20 KB | "这个 Bot 知道的稳定事实" |

### 5.2 记忆写入流程（每次运行结束）

```
RunRecord 完成
     │
     ▼
┌────────────────────────┐
│ 1. 生成情景摘要          │  调用 deepseek-flash（便宜）
│    prompt: "用200字总结这次运行的关键事实、决策、结果" │
└──────────┬─────────────┘
           ▼
┌────────────────────────┐
│ 2. 追加到 memory.jsonl  │
└──────────┬─────────────┘
           ▼
┌────────────────────────┐
│ 3. 检查是否需要蒸馏      │  每 50 条 或 每周一次
│    → 合并旧的到 semantic │
└──────────┬─────────────┘
           ▼
┌────────────────────────┐
│ 4. 淘汰低价值条目        │  importance <= 2 且超过 90 天
└────────────────────────┘
```

### 5.3 记忆检索（每次运行开始）

**不用向量数据库**（MVP 阶段）。理由：
- 单个 Bot 的记忆量级通常在几百到几千条，**全文检索 + 时间衰减**足够
- 引入 embedding 会带来额外依赖、额外成本、额外延迟
- 留作 v2.0 的优化项

MVP 检索算法：

```ts
function recall(botId: string, query: string, limit = 20): MemoryEntry[] {
  const all = readJsonl(`bots/${botId}/memory.jsonl`);
  return all
    .map(e => ({ e, score: scoreMemory(e, query) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.e);
}

function scoreMemory(e: MemoryEntry, query: string): number {
  const now = Date.now();
  const ageDays = (now - Date.parse(e.ts)) / 86400_000;
  const recency  = Math.exp(-ageDays / 30);          // 30 天半衰期
  const keyword  = keywordOverlap(e.summary + e.tags.join(' '), query);
  const weight   = e.importance / 5;
  return recency * 0.4 + keyword * 0.4 + weight * 0.2;
}
```

### 5.4 ⭐ 关键优化：稳定前缀 → 命中 DeepSeek KV Cache

DeepSeek 的上下文硬盘缓存**只有完整匹配缓存前缀单元才命中**，且缓存命中价是未命中的 **1/50**（flash: 0.02 vs 1 元/百万 tokens）。

**这对 system prompt 的构造方式有硬性要求**：

```
❌ 错误做法（每次变，永远不命中）：
   system = "你是${bot.name}，现在是${new Date()}，上次运行结果是${lastResult}..."

✅ 正确做法（稳定前缀 + 可变后缀）：
   [前缀 · 永不变]  = 身份 + 角色 + 工具说明 + 输出格式约定
   [中段 · 少见变]  = semantic.json 内容
   [后缀 · 每次变]  = 本次任务 + 最近 N 条记忆 + 时间戳
```

**实施约束**：任何动态内容（时间戳、当前任务）**必须放在末尾**。这一条要写进代码规范并有单测守卫。

---

## 6. Routine（流程教学）子系统

### 6.1 设计取舍

Grok Bot 用「演示教学」（带它走一遍，录制下来）。我们 v1.0 **先做声明式 YAML**，理由：

| 方案 | 优点 | 缺点 | 决策 |
|---|---|---|---|
| 演示录制 | 零门槛 | 实现极复杂（需要屏幕/浏览器事件捕获 + 语义抽象）；录制出来的东西脆 | v2.0 |
| **声明式 YAML** | 可版本控制、可 code review、可 diff、可测试 | 需要学习 | ✅ **v1.0** |
| 自然语言 → 生成 YAML | 兼顾零门槛与可读性 | 依赖模型能力 | ✅ **v1.0 附带** |

**关键洞察**：让你的 Bot 自己生成 Routine（"帮我做一个每天检查 TODO 的流程" → 模型写出 YAML → 存盘），比录屏录制更实用，而且实现成本低得多。

### 6.2 Routine Schema

```yaml
# routines/daily-report.yaml
apiVersion: dsh-bot/v1
kind: Routine
metadata:
  id: daily-report
  name: 每日工作日报
  description: 汇总昨天 Git 提交与 Jira 变更，生成中文日报
  version: 3

spec:
  # 触发方式（可多种并存）
  triggers:
    - type: cron
      expression: "0 9 * * 1-5"     # 工作日 9:00
      timezone: Asia/Shanghai
    - type: manual

  # 全局参数，可在步骤中插值 {{.param}}
  params:
    repoPath: "D:/work/myproject"
    jiraProject: "PROJ"

  # 执行步骤
  steps:
    - id: fetch-commits
      name: 拉取昨日提交
      type: tool
      tool: ops_bash                 # 复用 dsh-ops
      args:
        command: |
          cd "{{.param.repoPath}}"
          git log --since="yesterday 00:00" --until="today 00:00" \
                  --pretty=format:"%h|%an|%s" --no-merges
      assert:
        - expr: "result.exitCode === 0"
          message: "git log 失败"

    - id: fetch-jira
      name: 拉取 Jira 变更
      type: tool
      tool: web_fetch
      args:
        url: "https://jira.example.com/rest/api/2/search?jql=project={{.param.jiraProject}}"
      optional: true                 # 失败不中断

    - id: summarize
      name: 生成日报
      type: llm
      model:
        provider: deepseek
        model: deepseek-flash
        reasoningEffort: low
      prompt: |
        # 角色
        你是周报助手。基于以下数据写一份中文日报，Markdown 格式。

        # 提交记录
        {{.steps.fetch-commits.result.stdout}}

        # Jira 变更
        {{.steps.fetch-jira.result.body}}

        # 要求
        1. 按模块分类，不要逐条罗列
        2. 突出风险与阻塞项
        3. 控制在 400 字内
      output: report                  # 存入上下文变量

    - id: deliver
      name: 发送到群
      type: tool
      tool: webhook_post
      args:
        url: "{{.env.DAILY_REPORT_WEBHOOK}}"
        body:
          text: "{{.steps.summarize.output}}"
      sideEffect: external           # ⭐ 标记破坏性，dry_run 会拦截

  # 失败处理
  onError:
    retry:
      maxAttempts: 2
      backoffMs: 5000
    notify:
      tool: webhook_post
      args:
        url: "{{.env.ALERT_WEBHOOK}}"
        body: { text: "日报流程失败: {{.error.message}}" }
```

### 6.3 步骤类型

| type | 说明 | 字段 |
|---|---|---|
| `tool` | 调用任意 DSH 已注册工具 | `tool`, `args`, `assert`, `optional` |
| `llm` | 直接调模型，不放工具 | `prompt`, `model`, `output`, `jsonSchema?` |
| `script` | 内联 JS（沙箱执行） | `code`, `output` |
| `parallel` | 并行执行子步骤 | `steps[]`, `onError: 'fail-fast'\|'continue'` |
| `loop` | 对数组遍历 | `over`, `as`, `steps[]`, `maxIterations` |

### 6.4 ⭐ dry_run 语义（核心差异化）

```ts
// 工具副作用分级
type SideEffect = 'none' | 'local' | 'external';

// dry_run 时的行为
function intercept(tool: ToolDef, args: unknown, flags: RunFlags): StepResult | null {
  if (!flags.dryRun) return null;                    // 非 dry-run，直接放行
  if (tool.sideEffect === 'none') return null;       // 只读工具，放行
  if (tool.sideEffect === 'local') {
    // 本地写操作：写到临时目录，返回"将会写入 X"
    return { blocked: { reason: `[dry-run] 将在 ${args.path} 写入 ${bytes} 字节` } };
  }
  // 外部副作用（发邮件、调 webhook）：直接拦截
  return { blocked: { reason: `[dry-run] 将调用 ${tool.name}，参数：${JSON.stringify(args)}` } };
}
```

**默认 `dryRun = true`**。用户必须显式 `bot_run(id, routineId, { dryRun: false })` 才会真执行。

### 6.5 自然语言 → Routine 生成

新增工具 `routine_draft(botId, intent)`：
1. 把 intent + Bot 身份 + 可用工具清单（含 schema）喂给 `deepseek-v4-pro`
2. 要求输出严格符合 Routine JSON Schema（用 DeepSeek 的 JSON Output）
3. **不直接保存**，返回 YAML 文本让用户预览
4. 用户确认后调 `routine_save`

---

## 7. DeepSeek 深度适配层

这是本文档的重点，也是"深度适配国产模型"的落脚点。

### 7.1 DeepSeek API 现状（2026-10 核实）

| 项 | `deepseek-flash` | `deepseek-v4-pro` |
|---|---|---|
| 模型版本 | DeepSeek-V4.1-Flash-1017 | DeepSeek-V4-Pro-0813 |
| 上下文长度 | **1M** | **1M** |
| 最大输出 | **384K** | 384K |
| 思考模式 | 支持，**默认开启** | 支持 |
| Tool Calls | ✅ | ✅ |
| JSON Output | ✅ | ✅ |
| 图像理解 | ✅ | ❌ |
| FIM 补全 | 仅非思考模式 | 仅非思考模式 |
| 并发限制 | 2500 | 500 |

**价格**（元/百万 tokens，空闲时段为高峰的 50%）：

| | flash 缓存命中 | flash 未命中 | pro 缓存命中 | pro 未命中 |
|---|---|---|---|---|
| 输入 空闲 | 0.02 | 1.0 | 0.15 | 4.5 |
| 输入 高峰 | 0.04 | 2.0 | 0.30 | 9.0 |
| 输出 空闲 | 4.0 | | 13.5 | |
| 输出 高峰 | 8.0 | | 27.0 | |

> **高峰时段**：北京时间周一至周五 9:00–12:00、14:00–18:00（不含法定节假日）。

**关键推论**：
- 缓存命中 vs 未命中 = **50 倍价差** → §5.4 的稳定前缀设计是**必须的**，不是优化
- 峰谷价差 2 倍 → 定时任务应**尽量排到空闲时段**（见 §11.3）
- flash 便宜到可以高频调用 → 记忆蒸馏、Routine 生成都用 flash

### 7.2 ⚠️ 头号工程陷阱：`reasoning_content` 必须回传

**DeepSeek 官方明确**：

> 携带了 `tools` 参数的请求，在后续所有请求中，必须完整回传 `reasoning_content` 给 API——**即使该轮模型未实际进行工具调用**。若未正确回传，API 会返回 **400 报错**。

这是所有 Agent 框架接 DeepSeek 时最容易踩的坑。DSH 的 `StreamChunk` 协议里没有专门的 reasoning 字段，**必须在适配器内部做状态管理**。

**方案**：

```ts
class DeepSeekAdapter extends LlmAdapter {
  // 用 WeakMap 按 messages 数组身份保存 reasoning 缓存
  private reasoningByMessage = new WeakMap<object, string>();

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const hasTools = (options.tools?.length ?? 0) > 0;

    const messages = options.messages.map(m => {
      const base = toOpenAIMessage(m);
      if (hasTools && m.role === 'assistant') {
        // ⭐ 关键：带 tools 时必须回传 reasoning_content
        const rc = this.reasoningByMessage.get(m as any);
        if (rc) (base as any).reasoning_content = rc;
      }
      return base;
    });

    // ... 发起流式请求 ...

    // 解析 SSE 时，把 reasoning_content 增量存起来
    // 结束时：
    if (hasTools && reasoningBuffer) {
      this.reasoningByMessage.set(currentAssistantMessage, reasoningBuffer);
    }
  }
}
```

**配套要求**：DSH 的 agent-loop 需要把 assistant 消息对象原样传回（而不是重建），否则 WeakMap 会失效。这是**架构约束**，需要在集成测试中验证。

**Fallback**：如果集成方无法保证消息对象身份，降级方案是在适配器实例内维护一个 `Map<contentHash, reasoning>`，代价是内容重复时可能串味，需加 `runId` 作为命名空间。

#### 7.2.1 补充：不只是"带 tools"那么简单

API 文档原文的完整条件是：

> 携带了 `tools` 参数的请求，在后续所有请求中，必须完整回传 `reasoning_content` 给 API——**即使该轮模型未实际进行工具调用**。

三个必须理解的点：

1. **是整个 Request 带 `tools` 参数，不是这一轮发生了 tool call**
   —— 只要请求体里有 `tools` 数组，历史所有 assistant 消息都得带 `reasoning_content`。
   Bot 场景下我们**始终**带 tools（因为 Bot 总要能调工具），所以这条**永远生效**。

2. **流式场景下要累积拼接**
   `delta.reasoning_content` 是按增量下发的，必须拼成完整字符串才能回传。

3. **不带 `tools` 时传了也会被忽略**
   —— 所以可以不传，省 token。

#### 7.2.2 流式 usage 的正确读取方式

API 文档有个容易踩错的细节：

> 如果设置 `stream_options.include_usage = true`，流式返回的**所有块**都会包含 `usage` 字段，其中除最后一个块外，该字段的值均为 `null`。
> 无论是否设置，`data: [DONE]` 之前的最后一个块都会给出整个请求的 token 统计信息。
> **不会单独下发一个只含 usage 的块**：统计信息附加在最后一个内容块上，该块 `choices` 数组只含一个元素，其中不含新增内容且 `finish_reason` 非 null。

**对策**：
- 不需要 `include_usage: true` 也能拿到 usage（最后一块带）
- 判断 usage 时要 `if (json.usage)`，因为前面的块是 `null`，不能只判断字段存在
- 缓存命中数据在 `usage.prompt_cache_hit_tokens` / `usage.prompt_cache_miss_tokens`
- 思维链消耗在 `usage.completion_tokens_details.reasoning_tokens` ⭐ 这个字段可以用来统计"思考成本"

### 7.3 思考模式参数映射

DeepSeek 的 effort 映射表（**注意：不是 1:1**）：

| 传入 | 实际生效 |
|---|---|
| `minimal` | low |
| `low` | low |
| `medium` | high |
| `high` | high |
| `xhigh` | high |
| `max` | max |
| `ultra` | max |

**我们的策略**：
- Bot 的 `reasoningEffort` 只暴露 `low | high | max` 三档（避免用户困惑于映射）
- 记忆蒸馏、摘要生成 → `low`
- 常规任务 → `high`（默认）
- 复杂规划、Routine 生成 → `max`

**注意**：思考模式下 `temperature` / `presence_penalty` / `frequency_penalty` **不生效**（不报错但被忽略）。不要在这些参数上做文章。

**`top_p` 行为差异**：
- `deepseek-flash` 思考模式：有效 0.95–1.0，**低于 0.95 会被按 0.95 处理**
- `deepseek-v4-pro` 思考模式 + 带 tools：**固定 0.95**，传了也没用

**已废弃参数**（传入不报错但完全无效）：
- `frequency_penalty` — **已不再支持**
- `presence_penalty` — **已不再支持**
- 思考模式下的 `temperature`

> 这意味着 Bot 无法通过采样参数控制输出的多样性。如果需要确定性输出，只能靠 Prompt 约束 + JSON Schema。

### 7.3.1 ⚠️ 第二个 400 陷阱：思考模式下 `tool_choice` 受限

API 文档明确：

> 思考模式下**不支持** `required` 和指定具体 tool 的用法，API 会返回 **400 错误**。请先关闭思考模式。

**影响**：Bot 的 Routine 若想「强制先调用某个工具」（比如"必须先查日期再回答"），在思考模式下**做不到**。

**对策**：`ProviderCapability` 增加字段 `supportsToolChoiceConstraint: boolean`。当 Bot 处于思考模式时：
- 若 Routine 声明了 `toolChoice: required` → **自动降级为 `auto`** 并记录警告
- 或在 Prompt 中显式说明"你必须先调用 X 工具"

### 7.3.2 `max_tokens` 默认值陷阱

API 文档：

| 模式 | 默认 `max_tokens` |
|---|---|
| 非思考模式 | **8K** |
| 思考模式（effort = low/high） | **64K** |
| 思考模式（effort = max） | **128K** |
| 上限 | 384K |

**影响**：Routine 的 `llm` 步骤若要生成较长内容（如完整日报），**必须显式设置 `max_tokens`**，否则思考模式下可能只给 64K，非思考模式只有 8K，容易触发 `finish_reason: "length"` 而内容被截断。

**对策**：`LlmStep` schema 增加可选 `maxTokens` 字段，默认按步骤类型给合理值（摘要类 4K、报告类 16K）。

### 7.4 上下文缓存优化策略

DeepSeek 缓存规则要点：
1. **请求结束位置**（用户输入结束、模型输出结束）会生成缓存前缀单元
2. **公共前缀检测**：多次请求的公共前缀会被单独落盘
3. 缓存是「尽力而为」，不保证 100% 命中

**我们的 Prompt 构造规范**（强制）：

```
┌─────────────────────────────────────┐
│ [块 1] 身份 + 角色 + 工具说明          │  ← 永不变，最长
│ [块 2] 输出格式约定 + 行为准则         │  ← 永不变
├─────────────────────────────────────┤  ← 缓存前缀单元边界
│ [块 3] semantic.json（语义记忆）      │  ← 低频变化（周级）
├─────────────────────────────────────┤  ← 缓存前缀单元边界
│ [块 4] 最近 N 条情景记忆              │  ← 每轮变化
│ [块 5] 本次任务                       │  ← 每轮变化
│ [块 6] 时间戳                        │  ← 每轮变化，必须放最后
└─────────────────────────────────────┘
```

**代码规范**：
```ts
// ✅ 正确
const systemPrompt = [
  STABLE_PREAMBLE(identity),    // 纯静态
  STABLE_GUIDELINES,            // 纯静态
  semanticMemoryBlock,          // 低频
  episodicBlock,                // 每轮
  `当前时间: ${now}`,           // 永远最后
].filter(Boolean).join('\n\n---\n\n');
```

**单测守卫**：
```ts
test('system prompt 前缀在两次调用间必须完全一致', () => {
  const p1 = buildSystemPrompt(BOT_FIXTURE, MEMORY_A, TASK_1);
  const p2 = buildSystemPrompt(BOT_FIXTURE, MEMORY_A, TASK_2);
  const commonPrefixLen = longestCommonPrefix(p1, p2).length;
  // 稳定块 + semantic 至少占全量的 60%
  expect(commonPrefixLen / p1.length).toBeGreaterThan(0.6);
});
```

### 7.5 峰谷调度策略

```ts
// 高峰时段判断（北京时间）
function isPeakHour(d: Date = new Date()): boolean {
  const bj = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Shanghai' }));
  const day = bj.getDay();                       // 0=周日
  if (day === 0 || day === 6) return false;      // 周末不算高峰
  const h = bj.getHours(), m = bj.getMinutes();
  const t = h * 60 + m;
  return (t >= 9 * 60 && t < 12 * 60) || (t >= 14 * 60 && t < 18 * 60);
}

// 非紧急定时任务自动挪到空闲时段
function adjustSchedule(cronReal: string, rushHour: boolean, costSensitive: boolean) {
  if (!costSensitive) return cronReal;
  // 用户配置 "0 10 * * *"，若 10 点属高峰，自动挪到 12:10
  ...
}
```

**注意**：法定节假日也是空闲时段。完整实现需要引入节假日日历（可用 `domain_search holidays` 的数据源），v1.0 先支持周末 + 时段，节假日留 v1.1。

### 7.6 成本预估示例

**场景：日报 Bot，每工作日跑 1 次，每次约 30K 输入 / 2K 输出**

假设缓存命中率 70%（稳定前缀设计到位的情形）：

| 项 | flash 空闲 | flash 高峰 |
|---|---|---|
| 输入命中 21K | 21K × 0.02/1M = ¥0.00042 | ¥0.00084 |
| 输入未命中 9K | 9K × 1.0/1M = ¥0.009 | ¥0.018 |
| 输出 2K | 2K × 4.0/1M = ¥0.008 | ¥0.016 |
| **单次** | **≈ ¥0.017** | **≈ ¥0.035** |
| **月度（22 工作日）** | **≈ ¥0.37** | **≈ ¥0.77** |

对比：Grok Bot 最低 $40/月/席 ≈ **¥285/月**。

> 即使每天跑 100 次，flash 也只有约 **¥37–77/月**。国产模型的价格是这类产品能成立的根本原因。

### 7.7 国产模型适配矩阵：哪些能力可以统一实现、哪些必须按厂商单独实现

这是"适配国产模型（尤其是 DeepSeek）"这句话真正的技术含义。市场上所谓"国产模型适配"多数只是"把 OpenAI 兼容格式接上"，但**Agent 场景下的差异远不止接口格式**。下面按能力逐个拆解：

| 能力 | DeepSeek | Qwen（通义） | Kimi（月之暗面） | GLM（智谱） | 豆包（火山） | 统一实现策略 |
|---|---|---|---|---|---|---|
| **OpenAI 兼容协议** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ 全部走同一 HTTP 客户端 |
| **Anthropic 兼容协议** | ✅ `/anthropic` | ❌ | ✅ | ❌ | ❌ | 备选通道，不做主线 |
| **思考模式开关** | `thinking:{type}` + `reasoning_effort` | `enable_thinking` | 模型名即开关 | `thinking:{type}` | `thinking` 字段 | ⚠️ **必须按厂商分支** |
| **推理内容回传** | ⚠️ 带 tools 必传 `reasoning_content` | 一般不需回传 | 一般不需回传 | 可回传 | 可回传 | ⚠️ **DeepSeek 特有约束，必须单独处理** |
| **`tool_choice` 约束** | ⚠️ 思考模式下不支持 `required` | 支持 | 支持 | 支持 | 支持 | ⚠️ DeepSeek 独有限制 |
| **`max_tokens` 默认值** | ⚠️ 8K/64K/128K 分模式 | 按厂商 | 按厂商 | 按厂商 | 按厂商 | ⚠️ 必须显式设置 |
| **思考链字段名** | `reasoning_content` | `reasoning_content` | `reasoning_content` | `reasoning_content` / `reasoning` | `reasoning_content` | ✅ 字段名多数一致，但仍需归一化 |
| **前缀缓存** | ✅ 自动、50 倍价差 | ✅ 自动，有单独计价 | ✅ 自动 | ✅ 自动 | ✅ 自动 | ✅ 统一"稳定前缀"策略，全厂商受益 |
| **温度是否生效** | ❌ 思考模式下忽略 | 部分生效 | 部分生效 | 部分生效 | 部分生效 | ⚠️ 能力探测，不可假设 |
| **tool 调用稳定性** | 高 | 高 | 中高 | 高 | 高 | ✅ 统一校验层：JSON 修复 + 重试 |
| **并行 tool 调用** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ 统一 |
| **超长上下文** | 1M | 128K–1M（按型号） | 256K | 200K | 256K | ⚠️ 按模型动态配置窗口预算 |
| **并发/限流** | 2500 / 500 | 按套餐 | 按套餐 | 按套餐 | 按 TPM/RPM | ⚠️ 统一令牌桶 + 按厂商配额配置 |
| **峰谷定价** | ✅ 有 | ❌ | ❌ | ❌ | ❌ | ⚠️ DeepSeek 独有，调度器需感知 |
| **JSON Output** | ✅ 严格模式 | ✅ | ✅ | ✅ | ✅ | ✅ 统一，按厂商开关名适配 |

**结论 —— 适配层必须分成三层：**

1. **统一层（可直接复用）**：HTTP 客户端、SSE 解析、工具调用循环、错误码归一化、重试退避、token 计费。这些与厂商无关。
2. **能力描述层（数据驱动）**：用一份 `ProviderCapability` 描述表声明每个厂商的差异，而不是 `if (vendor === 'deepseek')` 满地撒。见 §7.9。
3. **适配器层（必须单独实现）**：DeepSeek 的 `reasoning_content` 回传逻辑、思考参数映射、峰谷时段判断。这些**无法统一**。

### 7.8 上下文长度归一化：一个必须统一处理的维度

各家上下文窗口从 128K 到 1M 不等。Bot 的记忆注入量必须**按实际可用窗口动态计算**，不能写死：

```ts
interface ContextBudget {
  maxContextTokens: number;   // 由 resolveModel() 返回
  reservedForOutput: number;  // 模型最大输出，DeepSeek 是 384K
  reservedForTools: number;   // 工具 schema 的 token 开销
}

function planMemoryBudget(budget: ContextBudget): {
  semanticLimit: number;
  episodicLimit: number;
  taskLimit: number;
} {
  const usable = budget.maxContextTokens - budget.reservedForOutput - budget.reservedForTools;
  return {
    semanticLimit: Math.floor(usable * 0.10),   // 语义记忆 10%
    episodicLimit: Math.floor(usable * 0.30),   // 情景记忆 30%
    taskLimit:     Math.floor(usable * 0.60),   // 任务本身 60%
  };
}
```

**DeepSeek 1M 上下文的意义**：单 Bot 可以一次性塞进几百条记忆而不需要 RAG。这直接**降低了对向量数据库的依赖**——是国产模型的一个真实工程红利，应当写进产品卖点。

但注意：`deepseek-flash` 的 384K 输出上限是**输出**，不影响输入窗口；而 `deepseek-v4-pro` 并发只有 500，批量 Bot 场景需要注意并发排队。

### 7.9 ProviderCapability 描述表（数据驱动适配）

```ts
export interface ProviderCapability {
  id: string;
  displayName: string;
  baseUrl: string;
  protocol: 'openai' | 'anthropic';
  models: Array<{
    id: string;
    contextTokens: number;
    maxOutputTokens: number;
    vision: boolean;
    thinking: boolean;
  }>;
  // ⚠️ 厂商特异的思考参数映射
  thinkingParams: (effort: 'low'|'high'|'max', enabled: boolean) => Record<string, unknown>;
  // ⚠️ 是否需要回传 reasoning_content
  requiresReasoningPlayback: boolean;
  // ⚠️ 思考模式下是否支持 tool_choice: required
  supportsToolChoiceConstraint: boolean;
  // ⚠️ 各模式的 max_tokens 默认值
  defaultMaxTokens: (thinking: boolean, effort: 'low'|'high'|'max') => number;
  // ⚠️ 思考模式下哪些采样参数失效
  ignoredSamplingParams: string[];
  // ⚠️ 定价（用于预算计算）
  pricing: (peak: boolean) => {
    inHit: number; inMiss: number; out: number; currency: 'CNY';
  };
  // ⚠️ 是否有峰谷定价
  hasPeakPricing: boolean;
}
```

DeepSeek 的实现：

```ts
export const DEEPSEEK: ProviderCapability = {
  id: 'deepseek',
  displayName: 'DeepSeek',
  baseUrl: 'https://api.deepseek.com',
  protocol: 'openai',
  models: [
    { id: 'deepseek-flash',   contextTokens: 1_000_000, maxOutputTokens: 384_000, vision: true,  thinking: true },
    { id: 'deepseek-v4-pro',  contextTokens: 1_000_000, maxOutputTokens: 384_000, vision: false, thinking: true },
  ],
  thinkingParams: (effort, enabled) => ({
    thinking: { type: enabled ? 'enabled' : 'disabled' },
    ...(enabled ? { reasoning_effort: effort } : {}),
  }),
  requiresReasoningPlayback: true,      // ⭐ 关键差异
  supportsToolChoiceConstraint: false,  // ⭐ 思考模式下不支持 required
  defaultMaxTokens: (thinking, effort) => {
    if (!thinking) return 8_192;
    return effort === 'max' ? 128_000 : 64_000;
  },
  ignoredSamplingParams: ['temperature', 'presence_penalty', 'frequency_penalty'],
  pricing: (peak) => peak
    ? { inHit: 0.04, inMiss: 2.0, out: 8.0, currency: 'CNY' }
    : { inHit: 0.02, inMiss: 1.0, out: 4.0, currency: 'CNY' },
  hasPeakPricing: true,
};
```

> 注：上表 pricing 是 flash 的档位。pro 的价格档不同，实现时应按 model 分开。

这样新增一家国产厂商**只是新增一份数据**，不需要改核心逻辑。

---

## 8. 工具清单与契约

### 8.1 对外暴露给模型的工具

命令前缀统一用 `bot_`，避免与 DSH 内置工具冲突（官方提到过工具名冲突问题）。

| 工具名 | 参数 | 返回 | 说明 |
|---|---|---|---|
| `bot_create` | `name, role, model?, budget?` | `BotIdentity` | 创建 Bot |
| `bot_list` | `—` | `BotSummary[]` | 列出所有 Bot |
| `bot_show` | `botId` | `BotIdentity + stats` | 详情 |
| `bot_update` | `botId, patch` | `BotIdentity` | 修改配置 |
| `bot_delete` | `botId, confirm` | `void` | 删除（需二次确认） |
| `bot_recall` | `botId, query, limit?` | `MemoryEntry[]` | 检索记忆 |
| `bot_run` | `botId, routineId?, task?, dryRun?` | `RunRecord` | ⭐ 立即执行 |
| `bot_runs` | `botId, since?, limit?` | `RunRecord[]` | 运行历史 |
| `routine_list` | `botId` | `RoutineMeta[]` | 列出流程 |
| `routine_show` | `botId, routineId` | `Routine (yaml)` | 查看 |
| `routine_draft` | `botId, intent` | `string (yaml)` | ⭐ 自然语言生成草稿 |
| `routine_save` | `botId, yaml` | `RoutineMeta` | 保存（先校验 schema） |
| `routine_delete` | `botId, routineId` | `void` | 删除 |
| `routine_run` | `botId, routineId, dryRun?` | `RunRecord` | 执行流程 |
| `bot_schedule` | `botId, routineId, cron` | `void` | 设定时 |

**共 15 个工具**。MVP 阶段先做前 8 个（`bot_create` ~ `bot_run` / `bot_runs`）。

### 8.2 一个完整工具的写法（对齐 DSH `defineTool` DSL）

```ts
import { defineTool } from '@deepseek-ai/dsh-tools';

export const botCreateTool = defineTool({
  name: 'bot_create',
  description:
    '创建一个常驻 AI 队友（Bot）。Bot 拥有独立工作区、长期记忆和可调度的流程。' +
    '创建后可用 bot_run 立即执行一次任务。',
  parameters: {
    name:     { type: 'string',  required: true,  description: 'Bot 的名字，如"日报小助手"' },
    role:     { type: 'string',  required: true,  description: '一句话职责' },
    model: {
      type: 'object',
      required: false,
      description: '模型配置，不填则用 deepseek-flash',
      properties: {
        provider:        { type: 'string', description: 'deepseek | qwen | kimi | glm | doubao' },
        model:           { type: 'string' },
        reasoningEffort: { type: 'string', enum: ['low', 'high', 'max'] },
      },
    },
    budget: {
      type: 'object',
      required: false,
      properties: {
        dailyCny:   { type: 'number', description: '每日预算上限（人民币）' },
        monthlyCny: { type: 'number' },
        onExceed:   { type: 'string', enum: ['stop', 'downgrade'] },
      },
    },
  },
  output: {
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        name: { type: 'string' },
        workspace: { type: 'string' },
      },
    },
    render: (_args, value) => [
      {
        type: 'text',
        text: `已创建 Bot「${value.name}」(id: ${value.id})\n工作区: ${value.workspace}`,
      },
    ],
  },
  async execute(args, ctx) {
    return ctx.botService.create(args);
  },
});
```

> 注意：`execute` 的第二个参数 `ctx` 需要按 DSH 实际签名调整，附录 A 中给出对应写法。

---

## 9. 安全与权限模型

### 9.1 威胁模型

| 威胁 | 场景 | 对策 |
|---|---|---|
| **Prompt Injection** | 抓取网页内容被注入指令 | 外部内容包在 `<untrusted>` 标签里；关键操作需二次确认 |
| **路径穿越** | Bot 写到工作区外 | 所有 fs 操作强制 `path.resolve` + `startsWith(workspace)` 校验 |
| **凭据泄露** | Bot 调用 shell 打印环境变量 | shell 环境变量白名单；`DEEPSEEK_API_KEY` 等不注入子进程 |
| **行为扩散** | Bot A 读到 Bot B 的数据 | 物理目录隔离 + 权限只在自身 workspace |
| **成本攻击** | 循环调用烧钱 | 预算熔断（§10）+ 最大迭代次数 |

### 9.2 权限声明（`dsh-plugin.json`）

参考 `dsh-ops` 的写法：

```json
{
  "manifestVersion": "0.15",
  "id": "dsh-bot.core",
  "name": "dsh-bot",
  "version": "0.1.0",
  "facets": {
    "host": { "entry": "lib/index.js", "apiVersion": "v1alpha1" }
  },
  "requires": {
    "contracts": [
      { "apiVersion": "tools.dsh/v1alpha1", "kind": "Tool" },
      { "apiVersion": "llm.dsh/v1alpha1",  "kind": "LlmAdapter" }
    ]
  },
  "permissions": [
    {
      "name": "dsh-bot.fs.read",
      "scope": "dsh-home",
      "reason": "读取 ~/.dsh/bot 下的 Bot 配置、记忆与运行记录"
    },
    {
      "name": "dsh-bot.fs.write",
      "scope": "dsh-home",
      "reason": "写入记忆、运行记录与 Routine 定义"
    },
    {
      "name": "dsh-bot.workspace.write",
      "scope": "filesystem-write",
      "reason": "Bot 在各自独立工作区内读写文件"
    },
    {
      "name": "dsh-bot.process.spawn",
      "scope": "subprocess",
      "reason": "调度器与 Routine 中的 shell 步骤需要启动子进程"
    },
    {
      "name": "dsh-bot.network",
      "scope": "network",
      "reason": "调用 DeepSeek 等模型 API 与 Routine 中的网络步骤"
    }
  ]
}
```

### 9.3 破坏性操作确认机制

```ts
// sideEffect 分级
const TOOL_SIDE_EFFECTS: Record<string, 'none' | 'local' | 'external'> = {
  read: 'none', glob: 'none', grep: 'none', web_fetch: 'none',
  write: 'local', edit: 'local', 'ops_bash': 'local',
  webhook_post: 'external', send_email: 'external',
};
```

- `none`：dry_run 下照常执行
- `local`：dry_run 下写到临时区并返回预览
- `external`：dry_run 下一律拦截

---

## 10. 成本控制与可观测性

### 10.1 预算守卫

```ts
class BudgetGuard {
  async check(botId: string, estimateCny: number): Promise<void> {
    const today = await this.spent(botId, 'today');
    const month = await this.spent(botId, 'month');
    const bot = await this.load(botId);

    if (today + estimateCny > bot.budget.dailyCny) {
      if (bot.budget.onExceed === 'downgrade') {
        // 降级到 flash + low effort
        throw new DowngradeSignal();
      }
      throw new BotError('BUDGET_EXCEEDED', `今日预算已用 ${today.toFixed(4)} / ${bot.budget.dailyCny} 元`);
    }
    if (month + estimateCny > bot.budget.monthlyCny) {
      throw new BotError('BUDGET_EXCEEDED', '月度预算已超限');
    }
  }
}
```

### 10.2 计费精确计算（基于 DeepSeek usage 字段）

DeepSeek 返回的 `usage` 含：
- `prompt_tokens`
- `completion_tokens`
- `prompt_cache_hit_tokens` ⭐
- `prompt_cache_miss_tokens` ⭐

```ts
function computeCostCny(
  usage: { hit: number; miss: number; out: number },
  model: 'flash' | 'pro',
  peak: boolean,
): number {
  const p = model === 'flash'
    ? (peak ? { hit: 0.04, miss: 2.0, out: 8.0 } : { hit: 0.02, miss: 1.0, out: 4.0 })
    : (peak ? { hit: 0.30, miss: 9.0, out: 27.0 } : { hit: 0.15, miss: 4.5, out: 13.5 });
  return (usage.hit * p.hit + usage.miss * p.miss + usage.out * p.out) / 1_000_000;
}
```

### 10.3 可观测性指标

每个 `RunRecord` 记录：

| 指标 | 用途 |
|---|---|
| `usage.inputTokens` / `outputTokens` | 成本核算 |
| `usage.cacheHitTokens` / 命中率 | **验证 §5.4 的缓存优化是否生效** |
| 每步 `durationMs` | 性能瓶颈定位 |
| `steps[].blocked` | dry-run 拦截记录 |
| `status` | 成功率统计 |

**关键看板**：缓存命中率。如果低于 50%，说明 Prompt 构造破坏了前缀稳定性，是**必须修复的缺陷**，不是"优化空间"。

---

## 11. 调度与常驻

### 11.1 调度实现

使用 Cordis 的 `ctx.effect` 保证卸载时自动清理：

```ts
export function apply(ctx: Context, config: Config) {
  const scheduler = new Scheduler(ctx);
  ctx.effect(() => {
    const timer = setInterval(() => void scheduler.tick(), 30_000);
    return () => clearInterval(timer);   // 插件卸载时自动停止
  });
}
```

### 11.2 为什么要避开 `setTimeout` 长定时

Node 的 `setTimeout` 上限 `2^31-1` ms ≈ 24.8 天。cron 表达式可能指向更远的未来。**统一用 30 秒 tick + 每分钟比对 cron**。

### 11.3 错峰执行

结合 §7.5：

```ts
interface SchedulePolicy {
  costSensitive: boolean;       // 是否错峰
  allowedHours?: [number, number]; // 允许执行的时间窗
}
```

若 `costSensitive` 且当前是高峰时段 → 排队到空闲时段开始（12:00 或 18:00 或次日 9:00 前）。

### 11.4 DSH Desktop 的休眠问题

**这是必须提前告诉用户的限制**：DSH Desktop 是桌面应用，**机器休眠时调度器不工作**。

对策：
1. UI 上显示"上次心跳时间"，超过阈值显示警告
2. 文档明确说明："本 Bot 不是云端服务，需要机器保持运行"
3. v2.0 可选：支持导出为 systemd service / Windows 计划任务（脱离 Desktop 独立跑）

---

## 12. 插件工程结构与打包

### 12.1 目录结构（MVP 单包）

遵循官方"不要预防性拆分"：

```
dsh-bot/
├── package.json
├── dsh-plugin.json
├── cordis.patch.yml
├── tsdown.config.ts
├── icon.png
├── README.md
├── README.zh.md
├── src/
│   ├── index.ts                 # apply() 入口
│   ├── service.ts               # BotService（定义 + 实现，MVP 同包）
│   ├── types.ts                 # 全部类型
│   ├── tools/
│   │   ├── index.ts             # 注册所有工具
│   │   ├── bot.ts               # bot_* 工具
│   │   └── routine.ts           # routine_* 工具
│   ├── memory/
│   │   ├── store.ts             # JSONL 读写
│   │   ├── recall.ts            # 检索算法
│   │   └── distill.ts           # 蒸馏
│   ├── routine/
│   │   ├── schema.ts            # Zod schema
│   │   ├── runner.ts            # 执行引擎
│   │   └── template.ts          # {{}} 插值
│   ├── llm/
│   │   ├── deepseek.ts          # ⭐ DeepSeekAdapter
│   │   ├── capabilities.ts      # ⭐ ProviderCapability 表
│   │   └── cost.ts              # 计费
│   ├── scheduler/
│   │   ├── cron.ts
│   │   └── peak.ts              # 峰谷判断
│   └── guard/
│       ├── budget.ts
│       └── sandbox.ts           # 路径校验
└── test/
    ├── unit/
    └── integration/
```

### 12.2 package.json

```json
{
  "name": "dsh-bot",
  "version": "0.1.0",
  "description": "常驻 AI 队友：有名字、有记忆、可教学流程的 Bot，深度适配 DeepSeek 等国产模型",
  "type": "module",
  "main": "lib/index.js",
  "icon": "./icon.png",
  "files": ["lib", "cordis.patch.yml", "dsh-plugin.json", "icon.png", "README.md"],
  "engines": { "dsh": ">=0.2.0 <0.3.0" },
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "keywords": ["dsh", "dsh-plugin", "deepseek-harness", "bot", "agent", "deepseek", "qwen", "kimi"],
  "peerDependencies": {
    "@deepseek-ai/cordis": "*",
    "@deepseek-ai/dsh-tools": "*",
    "@deepseek-ai/dsh-llm": "*"
  },
  "devDependencies": {
    "@deepseek-ai/cordis": "*",
    "@deepseek-ai/dsh-tools": "*",
    "@deepseek-ai/dsh-llm": "*",
    "tsdown": "^0.15.0",
    "vitest": "^3.0.0"
  },
  "scripts": {
    "build": "tsdown",
    "prepare": "tsdown",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "license": "MIT"
}
```

> ⚠️ `prepare` 脚本是必须的——从 GitHub 安装时 pnpm 会跑它。见 §12.4。

### 12.3 cordis.patch.yml

```yaml
# dsh-bot — 常驻 AI 队友
- insert:
    - id: dsh-bot-core
      name: dsh-bot
      config:
        homeDir: '~/.dsh/bot'
        defaultProvider: deepseek
        defaultModel: deepseek-flash
        defaultReasoningEffort: high
        defaultDryRun: true          # ⭐ 默认安全
        schedulerTickMs: 30000
        costSensitiveScheduling: true
    - id: dsh-bot-llm
      name: dsh-bot/llm
      config:
        providers: [deepseek, qwen, kimi, glm, doubao]
```

### 12.4 ⚠️ Git 安装的两个坑（必须处理）

**坑 1：pnpm ≥10 默认拒绝运行 git 依赖的 `prepare` 脚本**

用户 `dsh plugin add github:you/dsh-bot` 会失败。修复方式（在 profile 的 `pnpm-workspace.yaml`）：

```yaml
allowBuilds:
  dsh-bot: true
```

**坑 2：`prepare` 必须自包含**

不能假设旁边有 monorepo。`tsdown.config.ts` 要能单独转译 `src/`，不做项目引用、不做类型检查：

```ts
// tsdown.config.ts
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts', 'src/llm.ts'],
  format: ['esm'],
  platform: 'node',
  dts: false,          // git 安装时不生成类型声明
  clean: true,
  external: [/^@deepseek-ai\//],
});
```

**规避方案（推荐）**：直接发 npm，`lib/` 在发布时就构建好，用户零授权。

### 12.5 本地开发流程

```bash
# 1. 建独立 profile，不碰日常环境
dsh --profile botdev --from-default-profile desktop

# 2. 链接本地 checkout
dsh plugin --profile botdev add link:D:/path/to/dsh-bot

# 3. 验证层加载
dsh --profile botdev --dump-config
#    应看到 "# == dsh-bot" 层

# 4. 启动
dsh --profile botdev web
```

或用 overlay 快速迭代：

```bash
pnpm dsh web --patch ./dev.patch.yml
```

`dev.patch.yml`：
```yaml
- insert:
    - id: dsh-bot-core
      name: 'D:/path/to/dsh-bot/src/index.ts'
```

---

## 13. 开发里程碑

### M0 — 骨架跑通（2 天）

- [ ] 项目脚手架 + tsdown 构建
- [ ] `apply(ctx)` 最小插件，注册 `bot_hello`
- [ ] `dsh --profile botdev --dump-config` 验证层加载
- [ ] Web UI 里让模型调用到 `bot_hello`

**验收**：对话框中输入"调用 bot_hello"，模型返回结果。

### M1 — Bot 身份与记忆（5 天）

- [ ] `bot_create` / `bot_list` / `bot_show` / `bot_recall`
- [ ] `~/.dsh/bot/bots/<id>/` 目录创建
- [ ] `memory.jsonl` 读写 + `recall` 评分算法
- [ ] 单测：记忆检索排序正确

**验收**：创建 Bot → 跑一次 → 重启 DSH → `bot_recall` 能召回上次内容。

### M2 — ⭐ DeepSeek 适配器（6 天）

> 这是整个项目的技术制高点，优先级高于 Routine

- [ ] `DeepSeekAdapter extends LlmAdapter`
- [ ] **`reasoning_content` 回传状态管理**（§7.2）
- [ ] **`tool_choice: required` 在思考模式下降级**（§7.3.1）
- [ ] **`max_tokens` 分模式默认值**（§7.3.2）
- [ ] 思考模式参数映射（`low/high/max`）
- [ ] `ProviderCapability` 描述表 + DeepSeek 实现
- [ ] 成本计算（按 `prompt_cache_hit_tokens`）
- [ ] **集成测试：带 tools 的多轮对话不 400**

**验收**：
1. 用 `deepseek-flash` 带 tools 跑 3 轮工具调用，**不报 400**
2. 思考模式下传 `tool_choice: required` **不报 400**（自动降级）
3. 缓存命中率 > 50%（验证前缀稳定性）
4. 单次运行成本计算误差 < 5%
5. 长文本 `llm` 步骤不出现 `finish_reason: length`

### M3 — Routine 引擎（8 天）

- [ ] Zod schema + YAML 解析
- [ ] `{{}}` 插值（params / steps / env）
- [ ] `tool` / `llm` / `parallel` / `loop` 步骤类型
- [ ] `assert` 断言
- [ ] `sideEffect` 分级 + `dryRun` 拦截
- [ ] `routine_save` / `routine_run` / `routine_list`

**验收**：写一个 3 步流程（bash → llm → webhook），dry_run 下 webhook 被拦截且返回预览。

### M4 — 调度与预算（5 天）

- [ ] cron 解析（30s tick）
- [ ] 峰谷时段判断 + 自动错峰
- [ ] `BudgetGuard` 熔断
- [ ] `runs/` 全量记录 + 查询

**验收**：设定 `*/2 * * * *`，2 分钟自动跑一次；超预算后停跑并告警。

### M5 — 打包与发布（3 天）

- [ ] `dsh-plugin.json` manifest
- [ ] `prepare` 脚本验证（从 GitHub 装一次）
- [ ] 发 npm
- [ ] README（中英文）+ 提交 dsh-plugin.org

**验收**：全新机器上 `dsh plugin add dsh-bot` → 启动 → 创建 Bot 成功。

### 总计：约 29 个工作日

### 13.1 砍掉什么可以更快

如果只有 10 天：

| 砍掉 | 影响 |
|---|---|
| M4 调度 | 只能手动触发，但核心价值（记忆+流程）还在 |
| `loop` / `parallel` 步骤 | 只能顺序执行 |
| 峰谷调度 | 成本会高一点，但能用 |
| UI 卡片 | 用工具返回的文本也能用 |

**保留**：M1（身份记忆）+ M2（DeepSeek 适配）+ M3 的 `tool`/`llm` + dry_run。这是不可砍的最小内核。

---

## 14. 测试策略

### 14.1 单元测试

| 模块 | 关键用例 |
|---|---|
| `memory/recall` | 时间衰减、关键词匹配、importance 加权 |
| `routine/template` | `{{}}` 插值、嵌套路径、缺省值、**注入防护** |
| `guard/sandbox` | **路径穿越必须被拒绝**（`../`、绝对路径、符号链接） |
| `llm/cost` | 峰谷价、命中/未命中分别计价 |
| `scheduler/peak` | 边界时刻（8:59 / 9:00 / 12:00 / 12:01）、周末、跨时区 |

### 14.2 集成测试（关键）

```ts
// test/integration/deepseek-reasoning.test.ts
test('带 tools 的三轮对话必须回传 reasoning_content', async () => {
  const adapter = new DeepSeekAdapter(TEST_KEY);
  const messages = [{ role: 'user', content: '杭州天气怎么样？先查日期' }];

  // 第 1 轮：模型调用工具
  const r1 = await collect(adapter.stream({ messages, tools: [getDateTool], model: 'deepseek-flash' }));
  messages.push(r1.assistantMessage);

  // 第 2 轮：必须不 400
  const r2 = await collect(adapter.stream({ messages, tools: [getDateTool], model: 'deepseek-flash' }));
  expect(r2.finishReason).toBeDefined();
});

test('未发生 tool call 的轮次也必须回传 reasoning_content', async () => {
  // ⚠️ 易错点：只要请求带 tools，即使本轮没调工具，历史 assistant 消息也必须有 reasoning_content
  const adapter = new DeepSeekAdapter(TEST_KEY);
  const messages = [{ role: 'user', content: '你好' }];
  const r1 = await collect(adapter.stream({ messages, tools: [noopTool], model: 'deepseek-flash' }));
  messages.push(r1.assistantMessage);   // 这一轮可能没有 tool call
  messages.push({ role: 'user', content: '再来一句' });

  const r2 = await collect(adapter.stream({ messages, tools: [noopTool], model: 'deepseek-flash' }));
  expect(r2.finishReason).toBeDefined();   // 不 400
});

test('思考模式下 tool_choice: required 必须降级而非 400', async () => {
  const adapter = new DeepSeekAdapter(TEST_KEY);
  const results = await collect(adapter.stream({
    messages: [{ role: 'user', content: '查天气' }],
    tools: [weatherTool],
    toolChoice: 'required',       // ⚠️ 思考模式下 API 会 400
    model: 'deepseek-flash',
  } as any));
  expect(results.warnings).toContain('thinking 模式不支持 tool_choice 约束');
});
```

```ts
// test/integration/max-tokens.test.ts
test('llm 步骤不显式设 maxTokens 时不应被静默截断', async () => {
  // 非思考默认 8K、思考默认 64K —— 长报告必须显式设置
  const out = await runLlmStep({ prompt: '写一份 3000 字的报告', maxTokens: 16_000 });
  expect(out.finishReason).not.toBe('length');
});
```

```ts
// test/integration/cache-prefix.test.ts
test('两次不同任务的 system prompt 公共前缀占比 > 60%', () => {
  const p1 = buildSystemPrompt(bot, memory, '任务A');
  const p2 = buildSystemPrompt(bot, memory, '任务B');
  const ratio = commonPrefixLength(p1, p2) / Math.min(p1.length, p2.length);
  expect(ratio).toBeGreaterThan(0.6);
});
```

### 14.3 端到端测试

用 Playwright（工具已具备）跑：创建 Bot → 写 Routine → dry_run → 真跑 → 查历史。

### 14.4 评测集（针对国产模型）

建立一个**中文场景评测集**，衡量 Bot 在 DeepSeek 上的实际表现：

| 维度 | 用例数 | 指标 |
|---|---|---|
| 工具选择准确率 | 30 | 选对工具的比例 |
| 参数构造正确率 | 30 | 参数符合 schema 的比例 |
| 中文摘要质量 | 20 | 人工评分 1-5 |
| 记忆检索相关性 | 20 | recall@5 |
| Routine 生成可用率 | 20 | 生成的 YAML 能跑通的比例 |

> 这是"深度适配"的证据来源。没有评测集，就无法证明适配有效。

---

## 15. 风险登记册

| # | 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|---|
| R1 | `reasoning_content` 回传架构无法在 DSH agent-loop 中实现 | 中 | **高** | M2 首日做技术验证；准备 `contentHash` 降级方案 |
| R1b | 思考模式下 `tool_choice: required` 触发 400 | **高** | 中 | 适配器内自动降级为 `auto` + 告警（已在 §7.3.1 设计） |
| R1c | `max_tokens` 默认值导致长输出被截断 | 中 | 中 | Routine schema 支持显式 `maxTokens`；默认值按步骤类型给足 |
| R2 | DSH API 在 `0.2.x` 期间变动 | 中 | 中 | 锁定 `engines.dsh` 范围；抽象 DSH 交互层 |
| R3 | 桌面休眠导致调度失效 | **高** | 中 | UI 显示心跳 + 文档明示 + v2 提供系统服务导出 |
| R4 | 缓存前缀被破坏导致成本飙升 50 倍 | 中 | **高** | 单测守卫 + 运行时命中率告警 |
| R5 | Routine YAML 插值被注入 | 低 | 高 | 严格转义 + 白名单函数 + 沙箱 |
| R6 | DeepSeek 价格调整 | 中 | 中 | 价格表数据驱动，可热更新 |
| R7 | 工具名与社区插件冲突 | 中 | 低 | 统一 `bot_` 前缀 + 命名前查市场 |
| R8 | 多 Bot 并发触发 429 | 低 | 中 | 令牌桶限流（flash 2500/pro 500 并发） |

---

## 附录 A：完整代码骨架

### A.1 插件入口 `src/index.ts`

```ts
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { BotService } from './service.js';
import { registerBotTools } from './tools/bot.js';
import { registerRoutineTools } from './tools/routine.js';

export interface Config {
  homeDir: string;
  defaultProvider: string;
  defaultModel: string;
  defaultReasoningEffort: 'low' | 'high' | 'max';
  defaultDryRun: boolean;
  schedulerTickMs: number;
  costSensitiveScheduling: boolean;
}

export const Config: Schema<Config> = Schema.object({
  homeDir: Schema.string().default('~/.dsh/bot'),
  defaultProvider: Schema.string().default('deepseek'),
  defaultModel: Schema.string().default('deepseek-flash'),
  defaultReasoningEffort: Schema.string().default('high'),
  defaultDryRun: Schema.boolean().default(true),
  schedulerTickMs: Schema.number().default(30000),
  costSensitiveScheduling: Schema.boolean().default(true),
});

export const name = 'dsh-bot';
export const inject = ['tools'];

export function apply(ctx: Context, config: Config) {
  const service = new BotService(ctx, config);
  ctx.set('bot', service);

  registerBotTools(ctx, service);
  registerRoutineTools(ctx, service);

  // 调度器：ctx.effect 保证卸载时自动清理
  ctx.effect(() => {
    const timer = setInterval(() => void service.schedulerTick(), config.schedulerTickMs);
    return () => clearInterval(timer);
  });

  ctx.logger?.info?.('[dsh-bot] loaded, home =', config.homeDir);
}
```

### A.2 DeepSeek 适配器核心 `src/llm/deepseek.ts`

```ts
import {
  LlmAdapter, LlmError, attributionHeaders,
  type GenerateOptions, type StreamChunk,
} from '@deepseek-ai/dsh-llm';
import { DEEPSEEK } from './capabilities.js';

export class DeepSeekAdapter extends LlmAdapter {
  /** ⭐ 按 assistant 消息对象身份缓存 reasoning_content */
  private reasoningByMessage = new WeakMap<object, string>();

  constructor(
    private readonly apiKey: string,
    private readonly baseUrl = DEEPSEEK.baseUrl,
  ) { super(); }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const hasTools = (options.tools?.length ?? 0) > 0;

    const thinking = (options as any).thinking !== false;
    const effort = ((options as any).reasoningEffort ?? 'high') as 'low'|'high'|'max';

    const body: Record<string, unknown> = {
      model: options.model,
      messages: this.toOpenAIMessages(options.messages, hasTools),
      stream: true,
      // ⚠️ max_tokens 必须显式设置：默认 8K(非思考) / 64K(思考) / 128K(max)
      max_tokens: (options as any).maxTokens ?? DEEPSEEK.defaultMaxTokens(thinking, effort),
      ...DEEPSEEK.thinkingParams(effort, thinking),
    };
    if (hasTools) body.tools = options.tools!.map(toOpenAITool);

    // ⚠️ 思考模式 + tool_choice: required → 会 400，必须降级
    const rawToolChoice = (options as any).toolChoice;
    if (hasTools && rawToolChoice) {
      const isConstraint = rawToolChoice === 'required' || typeof rawToolChoice === 'object';
      if (thinking && isConstraint) {
        // 降级为 auto 并告警
        body.tool_choice = 'auto';
        this.onWarn?.('thinking 模式不支持 tool_choice 约束，已降级为 auto');
      } else {
        body.tool_choice = rawToolChoice;
      }
    }

    const res = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.apiKey}`,
        ...attributionHeaders(),
      },
      body: JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new LlmError(
        `DeepSeek API ${res.status}: ${text.slice(0, 500)}`,
        `DEEPSEEK_HTTP_${res.status}`,
      );
    }

    // ---- 解析 SSE ----
    let blockIndex = 0;
    let textBuf = '';
    let reasoningBuf = '';                    // ⭐ 累积思维链，带 tools 时必须回传
    const toolBufs = new Map<number, { id: string; name: string; args: string }>();
    let usage: any = null;
    let sawText = false;
    let finishReason: string | null = null;

    for await (const line of readSseLines(res.body!)) {
      // ⚠️ 必须跳过 SSE 保活注释 `: keep-alive`
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') break;

      const json = safeJson(payload);
      if (!json) continue;

      // ⚠️ usage 只在最后一个块有值，前面的块是 null，必须判空
      if (json.usage) usage = json.usage;

      const choice = json.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};

      if (choice.finish_reason) finishReason = choice.finish_reason;

      // ⭐ 思维链：不发给前端，但必须缓存以便回传
      if (delta.reasoning_content) {
        reasoningBuf += delta.reasoning_content;
      }

      if (delta.content) {
        if (!sawText) {
          sawText = true;
          yield { type: 'block-start', index: blockIndex, blockType: 'text' };
        }
        textBuf += delta.content;
        yield { type: 'text-delta', index: blockIndex, text: delta.content };
      }

      if (delta.tool_calls) {
        if (sawText) {
          yield { type: 'block-end', index: blockIndex, block: { type: 'text', text: textBuf } };
          blockIndex++; sawText = false; textBuf = '';
        }
        for (const tc of delta.tool_calls) {
          const cur = toolBufs.get(tc.index) ?? { id: '', name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          toolBufs.set(tc.index, cur);
        }
      }
    }

    if (sawText) {
      yield { type: 'block-end', index: blockIndex, block: { type: 'text', text: textBuf } };
      blockIndex++;
    }
    for (const [, tc] of toolBufs) {
      yield { type: 'block-start', index: blockIndex, blockType: 'tool-call' };
      yield {
        type: 'tool-call-delta', index: blockIndex,
        id: tc.id as any, name: tc.name, argumentsDelta: tc.args,
      };
      yield {
        type: 'block-end', index: blockIndex,
        block: { type: 'tool-call', id: tc.id as any, name: tc.name, arguments: tc.args },
      };
      blockIndex++;
    }

    if (usage) {
      yield {
        type: 'usage',
        usage: {
          inputTokens: usage.prompt_tokens ?? 0,
          outputTokens: usage.completion_tokens ?? 0,
          // ⭐ 扩展字段，供成本计算与缓存命中率监控
          ...({
            cacheHitTokens: usage.prompt_cache_hit_tokens ?? 0,
            cacheMissTokens: usage.prompt_cache_miss_tokens ?? 0,
            reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
          } as any),
        },
      };
    }

    // ⭐ 把本轮 reasoning 绑到本轮 assistant 消息上
    if (hasTools && reasoningBuf) {
      const lastAssistant = [...(options.messages ?? [])].reverse()
        .find(m => (m as any).role === 'assistant');
      if (lastAssistant) this.reasoningByMessage.set(lastAssistant as any, reasoningBuf);
      else this.pendingReasoning = reasoningBuf;   // 供 agent-loop 回填
    }

    // 依据 finish_reason 决定 finish 类型
    const reason =
      finishReason === 'tool_calls' || toolBufs.size ? { kind: 'tool-calls' as const }
      : finishReason === 'length' ? { kind: 'length' as const }
      : { kind: 'stop' as const };
    yield { type: 'finish', reason };
  }

  private toOpenAIMessages(messages: any[], hasTools: boolean) {
    return (messages ?? []).map((m: any) => {
      const out: any = { role: m.role, content: m.content };
      if (hasTools && m.role === 'assistant') {
        // ⭐ 这是 DeepSeek 的硬性要求，缺失会 400
        const rc = this.reasoningByMessage.get(m);
        if (rc) out.reasoning_content = rc;
      }
      if (m.toolCalls?.length) {
        out.tool_calls = m.toolCalls.map((tc: any) => ({
          id: tc.id, type: 'function',
          function: { name: tc.name, arguments: tc.arguments },
        }));
      }
      if (m.role === 'tool') out.tool_call_id = m.toolCallId;
      return out;
    });
  }
}

async function* readSseLines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      yield buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
    }
  }
  if (buf.trim()) yield buf;
}

const safeJson = (s: string) => { try { return JSON.parse(s); } catch { return null; } };
const toOpenAITool = (t: any) => ({ type: 'function', function: t });
```

> ⚠️ 这段是**骨架**，`ctx.tools` / `GenerateOptions` 的精确字段名以 `@deepseek-ai/dsh-llm` 导出的 TS 类型为准。M2 首日第一件事是读类型定义并对齐。

### A.3 Routine Runner 核心 `src/routine/runner.ts`

```ts
export class RoutineRunner {
  constructor(private ctx: Context, private service: BotService) {}

  async run(botId: string, routine: Routine, flags: RunFlags): Promise<RunRecord> {
    const started = new Date().toISOString();
    const rec: RunRecord = {
      id: newRunId(), botId, routineId: routine.metadata.id,
      trigger: flags.trigger, startedAt: started, endedAt: '',
      dryRun: flags.dryRun, status: 'success', steps: [],
      usage: { inputTokens: 0, outputTokens: 0, cacheHitTokens: 0, costCny: 0 },
    };

    const vars: Record<string, any> = { param: routine.spec.params ?? {}, steps: {}, env: process.env };

    try {
      for (const [i, step] of routine.spec.steps.entries()) {
        const t0 = Date.now();
        const sr: StepRecord = { index: i, kind: step.type as any, name: step.id, durationMs: 0 };
        rec.steps.push(sr);

        try {
          switch (step.type) {
            case 'tool': {
              const args = interpolate(step.args, vars);
              const tool = await this.ctx.tools.lookup(step.tool);
              const effect = TOOL_SIDE_EFFECTS[tool.name] ?? 'external';

              // ⭐ dry_run 拦截
              if (flags.dryRun && effect !== 'none') {
                sr.blocked = { reason: `[dry-run] 将调用 ${tool.name}(${JSON.stringify(args)})` };
                vars.steps[step.id] = { result: { dryRunBlocked: true } };
                break;
              }
              const result = await this.ctx.tools.call(tool.name, args);
              sr.args = args; sr.result = result;
              vars.steps[step.id] = { result };

              // 断言
              for (const a of (step as any).assert ?? []) {
                if (!evalExpr(a.expr, { result })) {
                  throw new BotError('ASSERT_FAILED', `${step.id}: ${a.message}`);
                }
              }
              break;
            }
            case 'llm': {
              const prompt = interpolate(step.prompt, vars);
              const out = await this.service.llmComplete(botId, prompt, (step as any).model, flags);
              vars.steps[step.id] = { output: out.text };
              rec.usage.inputTokens  += out.usage.inputTokens;
              rec.usage.outputTokens += out.usage.outputTokens;
              rec.usage.cacheHitTokens += out.usage.cacheHitTokens;
              rec.usage.costCny      += out.costCny;
              break;
            }
            default:
              throw new BotError('UNSUPPORTED_STEP', `未知步骤类型: ${step.type}`);
          }
        } catch (e: any) {
          sr.durationMs = Date.now() - t0;
          if ((step as any).optional) { continue; }         // optional 容错
          throw e;
        }
        sr.durationMs = Date.now() - t0;
      }
    } catch (e: any) {
      rec.status = e?.code === 'BUDGET_EXCEEDED' ? 'budget_exceeded' : 'failed';
      rec.error = { code: e?.code ?? 'UNKNOWN', message: String(e?.message ?? e) };
    }

    rec.endedAt = new Date().toISOString();
    await this.service.recordRun(rec);
    await this.service.writeMemory(botId, rec);   // 蒸馏 + 追加
    return rec;
  }
}
```

### A.4 Routine Schema（Zod）

```ts
import { z } from 'zod';

const Assert = z.object({ expr: z.string(), message: z.string() });

const ToolStep = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  type: z.literal('tool'),
  tool: z.string().min(1),
  args: z.record(z.any()).default({}),
  assert: z.array(Assert).optional(),
  optional: z.boolean().default(false),
  sideEffect: z.enum(['none', 'local', 'external']).optional(),
});

const LlmStep = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  type: z.literal('llm'),
  prompt: z.string().min(1),
  model: z.object({
    provider: z.string(),
    model: z.string(),
    reasoningEffort: z.enum(['low', 'high', 'max']).optional(),
    thinking: z.boolean().optional(),
  }).optional(),
  // ⚠️ 必须可配置：DeepSeek 非思考默认仅 8K，思考默认 64K
  maxTokens: z.number().int().positive().max(384_000).optional(),
  output: z.string().optional(),
  jsonSchema: z.record(z.any()).optional(),
});

export const RoutineSchema = z.object({
  apiVersion: z.literal('dsh-bot/v1'),
  kind: z.literal('Routine'),
  metadata: z.object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string(),
    description: z.string().optional(),
    version: z.number().int().positive().default(1),
  }),
  spec: z.object({
    triggers: z.array(z.discriminatedUnion('type', [
      z.object({ type: z.literal('manual') }),
      z.object({ type: z.literal('cron'), expression: z.string(), timezone: z.string().default('Asia/Shanghai') }),
    ])).default([{ type: 'manual' }]),
    params: z.record(z.any()).default({}),
    steps: z.array(z.discriminatedUnion('type', [ToolStep, LlmStep])).min(1),
    onError: z.object({
      retry: z.object({ maxAttempts: z.number().int().min(1).max(5), backoffMs: z.number() }).optional(),
      notify: z.any().optional(),
    }).optional(),
  }),
});
```

---

## 附录 B：参考资料

### DeepSeek 官方
- [模型 & 价格](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) — 1M 上下文、384K 输出、峰谷价、缓存命中价
- [思考模式](https://api-docs.deepseek.com/zh-cn/guides/thinking_mode) — ⭐ `reasoning_content` 回传硬性要求
- [上下文硬盘缓存](https://api-docs.deepseek.com/zh-cn/guides/kv_cache) — 缓存前缀单元规则
- [限速与隔离](https://api-docs.deepseek.com/zh-cn/quick_start/rate_limit) — 并发 2500/500、`user_id` 隔离
- [首次调用 API](https://api-docs.deepseek.com/zh-cn/) — base_url、模型名

### DSH 官方
- [第一个插件](https://deepseek-harness.github.io/deepseek-harness/develop/basic/) — `apply(ctx)` 模型
- [开发一个 Tool](https://deepseek-harness.github.io/deepseek-harness/develop/basic/tool) — `defineTool` DSL
- [打包与安装插件](https://deepseek-harness.github.io/deepseek-harness/develop/basic/publish) — bundle / profile / 层顺序 / git 安装坑
- [LLM 适配器](https://deepseek-harness.github.io/deepseek-harness/develop/practice/llm-adapter) — ⭐ `LlmAdapter` / `StreamChunk` 协议
- [能力的三种角色设计](https://deepseek-harness.github.io/deepseek-harness/develop/practice/) — Service Definition/Provider/Consumer
- [插件市场](https://dsh-plugin.org/tutorials/develop) — 15,070 个插件、命名规范、工具名冲突

### 竞品
- [Grok Bot 官方文档](https://docs.x.ai/grok-bot/overview)
- [Grok Bot alternatives（Continuum）](https://continuumcode.ai/guides/grok-bot-alternatives/) — ⭐ 缺陷分析的主要来源
- [Cursor 下载页](https://cursor.com/cn/download/bot)
- [Grok Bot 评价（eesel）](https://www.eesel.ai/blog/grok-bot-review) — 无 dry-run、无审计

---

*文档结束。下一步：M0 脚手架实现。*

