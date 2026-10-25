# 工具清单

> 本文档由 `node dev/gen-tools-doc.mjs` 从代码注册表自动生成（共 **24** 个工具）。
> 手工编辑会被覆盖；新增/删除工具请改代码后重新生成。


## 对话介入

| 工具 | 说明 |
|---|---|
| `bot_adopt` | 把一个持久型需求交给常驻 Bot 接手 |

## Bot 管理

| 工具 | 说明 |
|---|---|
| `bot_create` | 创建一个常驻 AI 队友（Bot） |
| `bot_list` | 列出所有已创建的 Bot，含运行次数、今日花费与最近状态 |
| `bot_show` | 查看某个 Bot 的详细信息，含目标状态与最近一次运行 |
| `bot_update` | 修改某个 Bot 的配置（名称、职责、模型、预算） |
| `bot_delete` | 删除某个 Bot 及其全部记忆和运行记录 |

## 目标（守得住）

| 工具 | 说明 |
|---|---|
| `bot_goal` | 管理 Bot 的目标（「守得住」的核心） |

## 记忆（记得住）

| 工具 | 说明 |
|---|---|
| `bot_recall` | 检索某个 Bot 的长期记忆 |
| `bot_memory_add` | 手动向 Bot 的记忆中写入一条记录 |

## 执行（收得回）

| 工具 | 说明 |
|---|---|
| `bot_run` | 让某个 Bot 执行一次任务 |
| `bot_runs` | 查看某个 Bot 的运行历史 |

## 流程（Routine）

| 工具 | 说明 |
|---|---|
| `routine_draft` | 用自然语言描述一个流程，自动生成 Routine 草稿（YAML） |
| `routine_save` | 保存一个流程（Routine） |
| `routine_run` | 执行一个已保存的流程 |
| `routine_list` | 列出某个 Bot 的所有流程 |
| `routine_show` | 查看某个流程的完整 YAML 定义 |
| `routine_delete` | 删除一个流程 |

## 回滚（收得回）

| 工具 | 说明 |
|---|---|
| `bot_snapshots` | 查看某个 Bot 的 workspace 快照列表 |
| `bot_rollback` | ⭐ 把 Bot 的 workspace 回滚到某个快照 |
| `bot_snapshot` | 手动为 Bot 的 workspace 打一个快照 |

## 调度

| 工具 | 说明 |
|---|---|
| `bot_schedule` | 为某个流程设定 cron 定时 |
| `bot_schedules` | 查看所有流程的定时排期与下次执行时间 |
| `bot_heartbeat` | 查看调度器心跳状态 |

## 通用能力

| 工具 | 说明 |
|---|---|
| `http_get` | 发起只读 HTTP GET 请求并返回响应正文 |
