/**
 * cordis Context 的宿主服务扩充。
 *
 * DSH 宿主在 cordis 之上注入了 tools / webServer / llm 等服务，
 * 但上游 @deepseek-ai/cordis 的 Context 接口不知道它们。
 * src/tools/*.ts 里以 `ctx.tools.register(...)` 访问，
 * 没有这段扩充就是 21 处 TS2339。
 *
 * 只声明我们实际用到的表面；方法签名保持宽松（宿主真身由运行时决定）。
 */

declare module '@deepseek-ai/cordis' {
  interface ToolsService {
    register(tool: unknown): unknown;
    schemas?(): unknown[];
    get?(name: string): unknown;
    call?(name: string, args: unknown, ctx?: unknown): Promise<unknown> | unknown;
    restrict?(...args: unknown[]): unknown;
    guard?(...args: unknown[]): unknown;
  }

  interface Context {
    tools: ToolsService;
    /** cordis 生命周期副作用注册（清理函数模式） */
    effect(cleanup: () => void): void;
    effect<T extends void | (() => void)>(setup: () => T): T;
  }
}
