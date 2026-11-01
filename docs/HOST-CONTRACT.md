# HOST-CONTRACT — 宿主契约与真机教训

> 从 `ROADMAP-v0.3.md` §七 拆出：这份是**宿主怎么工作**的知识，不是计划。
> 与 [LESSONS.md](./LESSONS.md) 的分工：LESSONS 是「我们该守的工程原则」，本文件是「宿主实际长什么样」。
>
> 适用宿主：`@deepseek-ai/dsh-desktop-runtime` 0.2.1-rc.x。**每个宿主版本升级后，按 RELEASES.md 的 A1 回归一次。**

## 背景

用户需求「每过 4 小时报告一次服务状态」（Uptime Kuma）。从「Bot 无工具」到「端到端出报告」共修四层，每层都过了单测但只有真机能暴露下一层。

**核心教训：模拟环境测不出宿主契约。330 个单测全绿时，下面这些问题全部存在。**

## 七条契约

### 1. 工具挂载：插件作用域的门面不给可调用对象

宿主给插件的 `sandboxTools` 只暴露 `register/schemas/get`，**故意不提供可调用对象**（防绕过 `ToolRuntime` 策略管线，源码注释明说）。

→ Bot 可用的工具 = **插件自注册进全局注册表**的工具。这也是当初新增通用只读工具 `http_get` 的原因（防 SSRF、超时、20k 截断、`pick` 路径提取，并登记副作用表 `http_get: 'none'`）。

→ 宿主 schema 校验要求对象参数显式写 `additionalProperties: true/false`，裸写会被拒。

### 2. 调用签名：`ToolRuntime.execute(exec)` 是单对象

```ts
execute({ name, arguments, signal })   // ✅
execute(name, args, opts)              // ❌ 位置参数
```

按位置调会把 `exec` 变成字符串，在 `snapshotJsonValue` 处抛 "tool execution arguments must be losslessly JSON-serializable"——**报错极具误导性**，看着像参数不干净，其实是整个 exec 对象没构造对。

→ 桥接层 `call()` 现在先试门面风格 `tools.call(name, args)`，再退 `tools.execute({name, arguments, signal})`。

### 3. `signal` 必填

`createExecution` 无条件读 `exec.signal.aborted`，不传直接 `TypeError: reading 'aborted'`。没有 signal 时必须给 `new AbortController().signal`。

### 4. 多轮回喂：三段式历史会让 thinking 模型返回空

文本协议第二轮若按 `[user 任务][assistant 调用文本][user 结果]` 回喂，deepseek-account（thinking 模型）**稳定返回空完成（无 usage）**。

→ 已改为**合并单条 user 消息**（任务 + 工具结果一起回喂）：信息无损（assistant 的 tool 块本是可再生提示）且省 token。

→ **每个新 provider 接入必须跑完整两轮验证**，只测第一轮会漏。

### 5. 模型绑定会被宿主重启重置

重启后 Bot 模型可能被重置为 profile 默认（如 zcode），而 Bot 桥未必有该 provider 适配器 → 必败一轮（"no adapter registered for provider"）。

→ `resolveRunnableModel` 运行时兜底：运行前校验 provider 可用性，不可用则切到插件默认并在运行记录写明兜底原因；**不写回 identity**（用户显式绑定优先于自动猜测）。

### 6. 模型行为治理靠提示词 + 数据压缩

大响应截断会让模型自作主张去抓 badge SVG 补数据（8 轮循环烧完上限）。

→ 双管齐下：`pick` 把 49KB 压到 527 字符（治本）+ systemPromptExtra 写死「恰好 2 次调用、禁止抓 badge」（治标）。

→ **给长输出接口配 `pick` 比调大截断阈值正确。**

### 7. 包名即身份

改 `package.json` 的 `name` 会打断 client graph 对账 → 面板整体消失（10-25 事故，详见 LESSONS #20）。

→ 改包名必须同步：`cordis.patch.yml` 的 `name`（模块 import 用）、client graph 的注册标识、市场条目。0.3.3 的挂载缺陷就是这条没同步导致的。

## 使用方式

- 新增 provider / 升级宿主 / 改插件清单 → 先读本文件对应条目，再跑 A1 + A2。
- 发现新的宿主契约差异 → 追加到此文件，并在 LESSONS.md 记一条工程原则。
