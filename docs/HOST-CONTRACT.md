# HOST-CONTRACT — 宿主契约与真机教训

> 从 `ROADMAP-v0.3.md` §七 拆出：这份是**宿主怎么工作**的知识，不是计划。
> 与 [LESSONS.md](./LESSONS.md) 的分工：LESSONS 是「我们该守的工程原则」，本文件是「宿主实际长什么样」。
>
> 适用宿主：`@deepseek-ai/dsh-desktop-runtime` **0.2.1-rc.x 与 0.2.2-rc.x（rc.1 / rc.2 均已核对）**。rc.2 相对 rc.1 无破坏性变更：hostProtocolVersion 仍为 4、client slots 未变、本插件 29 个设计令牌全部仍有定义。**每个宿主版本升级后，按 RELEASES.md 的 A1 回归一次。**

## 背景

用户需求「每过 4 小时报告一次服务状态」（Uptime Kuma）。从「Bot 无工具」到「端到端出报告」共修四层，每层都过了单测但只有真机能暴露下一层。

**核心教训：模拟环境测不出宿主契约。330 个单测全绿时，下面这些问题全部存在。**

## 七条契约

### 1. 工具挂载：插件作用域的门面不给可调用对象

宿主给插件的 `sandboxTools` 只暴露 `register/schemas/get`，**故意不提供可调用对象**（防绕过 `ToolRuntime` 策略管线，源码注释明说）。

→ Bot 可用的工具 = **插件自注册进全局注册表**的工具。这也是当初新增通用只读工具 `http_get` 的原因（防 SSRF、超时、20k 截断、`pick` 路径提取，并登记副作用表 `http_get: 'none'`）。

→ 宿主 schema 校验要求对象参数显式写 `additionalProperties: true/false`，裸写会被拒。

### 2. 调用签名：0.2.1 单对象、0.2.2 批量（会变！）

```ts
// 0.2.1-rc.x：单次执行
execute({ name, arguments, signal })                  // ✅
execute(name, args, opts)                             // ❌ 位置参数

// 0.2.2-rc.x 起：整批执行
execute({
  calls: [{ type: 'tool-call', id, name, arguments }], // arguments 是 JSON 字符串
  signal,
})                                                    // → { results: [{ callId, result }] }
```

三条必须记住的点：

- `arguments` 在批量形态里是**字符串**（模型原样的 JSON），不是对象；传对象会在入参校验处被拒。
- 返回是 `ToolBatchResult`，真实结果在 `results[0].result`；`value` / `content` 在这一层之下。
- `signal` 依旧必填（`createExecution` 无条件读 `exec.signal.aborted`）。

→ 桥接层 `call()` 采用「批量优先、单次回退」：先试 `execute({ calls, signal })`，仅当抛出入参校验类错误时回退 `execute({ name, arguments, signal })`。**业务错误必须原样抛出，不能被回退掩盖。**
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

### 7.5 Client 座位：侧边栏入口与主面板（0.2.2-rc.x）

- 侧边栏入口：`ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name:'sidebar.panellist', id, order, label }, IconComponent))`；
  图标组件只画字形，点行由侧边栏触发 `ctx.layout.selectPanel(id)`。
- 主面板：`ctx.slots.inject('main', () => ctx.slots.register({ name:'main', key:id }, PageComponent))`，
  `key` 必须与侧边栏的 `id` 一致；页面自己负责取数与滚动（外层不给滚动容器）。
- 两者都用 disposer 控制启停，切换不需要重启。

### 8. 执行器外置与条件工具（0.2.2 起）

0.2.2 把 native / PTC 呈现拆成独立执行器插件（`dsh-tool-executor-native` / `-ptc`），一个部署只挂一个；同时 `register(definition, { when })` 支持按模型步骤求值，`resolve({ agent, modelSelection, signal })` 产出该步的 `ResolvedToolSet`。

→ 插件侧不改 `defineTool` 的用法就不受影响；但**不要假设工具在每一步都可见**——提示词与调用要能容忍「本步没被准入」。

### 9. engines 与预发布版本

宿主判定兼容性用 `semver.satisfies(runtime, range, { includePrerelease: true })`（`dsh-app-boot` 的 `evaluatePluginCompatibility`）。普通 semver **不会**把 `0.2.2-rc.1` 算进 `>=0.2.1-rc.1 <0.3.0-0`。

→ `engines.dsh` 写 `>=0.2.0-0 <0.3.0-0`，一次覆盖 0.2.x 的 alpha/rc，同时仍挡住 0.3；只写 `>=0.2.x-rc.1` 会在 npm/pnpm 的严格 engine 校验下失效。

## 使用方式

- 新增 provider / 升级宿主 / 改插件清单 → 先读本文件对应条目，再跑 A1 + A2。
- **工具执行签名一变（0.2.1 → 0.2.2 就是一次），bridge 的双路径必须先回归**，再谈其他功能。
- 发现新的宿主契约差异 → 追加到此文件，并在 LESSONS.md 记一条工程原则。
