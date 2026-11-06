/**
 * bot_doctor —— 只读自检工具（v0.3.5 刀 2）
 *
 * 模型在运行中自查「我这层到底起没起来」时用；与面板「诊断」块同一份数据。
 * 只读、无副作用（副作用表登记均为 none），不读记忆正文与运行输出全文。
 */

import type { Context } from '@deepseek-ai/cordis';
import { defineTool } from '@deepseek-ai/dsh-tools';

import type { DoctorReport } from '../doctor.js';

export function registerDoctorTool(
  ctx: Context,
  deps: { report: () => Promise<DoctorReport> },
): void {
  ctx.tools.register(
    defineTool({
      name: 'bot_doctor',
      description:
        '只读自检：查看「宿主注册 / 客户端面板 / 启动崩溃 / 模型可用性」四层状态，返回可直接贴到 issue 的诊断文本。' +
        '不修改任何文件、不调用模型。',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute() {
        const report = await deps.report();
        return report.text;
      },
    }),
  );
}
