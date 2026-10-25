/**
 * 宿主 @deepseek-ai/dsh-tools 的最小类型声明。
 *
 * vendor 包（file:./vendor/dsh-tools）的 package.json 把 types 指向
 * lib/types/index.d.ts，但该文件在包里并不存在（lib/types/ 下只有 .js），
 * 于是所有导入点都落到 TS7016。这里按 src/tools/*.ts 的实际用法声明
 * 我们用到的表面（defineTool），其余保持 unknown/any —— 比 noImplicityAny
 * 的盲区好，又不假装比真实包更了解它。
 */

declare module '@deepseek-ai/dsh-tools' {
  /** 工具输出渲染片段：对话里展示给用户的最小单元 */
  export interface ToolRenderPart {
    type: string;
    text?: string;
    [key: string]: unknown;
  }

  export interface ToolDefinition<A = any, R = any> {
    name: string;
    description?: string;
    parameters?: unknown;
    output?: {
      schema?: unknown;
      render?: (args: A, value: R) => ToolRenderPart[];
    };
    execute: (args: A, ctx?: unknown) => Promise<R> | R;
  }

  /** 返回宿主可直接 ctx.tools.register() 的工具对象 */
  export function defineTool<A = any, R = any>(tool: ToolDefinition<A, R>): unknown;
}
