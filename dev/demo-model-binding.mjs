/**
 * 模型绑定端到端验证
 *
 * 复现用户的故障：
 *   Bot 绑的是 deepseek / deepseek-flash，
 *   但环境里真正能用的是 our-free-model / deepseek-v4.1-flash-free。
 *   于是执行 → 拿不到模型 → 空输出 → failed。
 *
 * 验证三件事：
 *   1. 能自动探测出「当前会话正在用的模型」
 *   2. 新建 Bot 默认就用这个模型（不再硬编码 deepseek）
 *   3. 可以手动改绑
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;

const { BotService, detectSessionModel, DEFAULT_CONFIG } = await import(entry);

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${detail ? `\n     ${detail}` : ''}`);
  }
}

async function main() {
  console.log('\n① 探测当前会话的模型');

  const detected = detectSessionModel({});
  ok('探测成功', Boolean(detected), '返回 undefined');
  ok(
    'provider 不是写死的 deepseek',
    detected?.provider !== 'deepseek',
    `实际：${detected?.provider}`,
  );
  console.log(`     探测结果：${detected?.provider} / ${detected?.model}`);

  // ---------------------------------------------------------
  console.log('\n② 新建 Bot 默认继承这个模型');
  // ---------------------------------------------------------
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-bot-model-'));
  const config = {
    ...DEFAULT_CONFIG,
    homeDir: root,
    // 模拟插件加载时把探测结果写回配置
    defaultProvider: detected?.provider ?? DEFAULT_CONFIG.defaultProvider,
    defaultModel: detected?.model ?? DEFAULT_CONFIG.defaultModel,
  };

  const service = new BotService({}, config);
  const bot = await service.create({ name: 'AI运维', role: '全天候运维' });

  ok(
    'Bot 的 provider 来自探测',
    bot.model.provider === detected?.provider,
    `实际：${bot.model.provider}`,
  );
  ok(
    'Bot 的 model 来自探测',
    bot.model.model === detected?.model,
    `实际：${bot.model.model}`,
  );
  console.log(`     Bot 绑定：${bot.model.provider} / ${bot.model.model}`);

  // ---------------------------------------------------------
  console.log('\n③ 可以改绑模型');
  // ---------------------------------------------------------
  const updated = await service.update(bot.id, {
    model: { ...bot.model, provider: 'other-provider', model: 'other-model' },
  });
  ok('provider 已更新', updated.model.provider === 'other-provider');
  ok('model 已更新', updated.model.model === 'other-model');

  const reread = await service.get(bot.id);
  ok('改动已持久化', reread.model.provider === 'other-provider');

  // ---------------------------------------------------------
  console.log('\n④ 硬编码默认值是错的（这是这次故障的根因）');
  // ---------------------------------------------------------
  ok(
    '插件原始默认值确实与真实环境不符',
    DEFAULT_CONFIG.defaultProvider === 'deepseek' &&
      detected?.provider !== 'deepseek',
    `默认=${DEFAULT_CONFIG.defaultProvider}，实际=${detected?.provider}`,
  );
  console.log(
    '     ↑ 这正是为什么必须探测，而不是相信写死的值',
  );

  await fs.rm(root, { recursive: true, force: true });

  console.log(`\n${'─'.repeat(46)}`);
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  console.log(`${'─'.repeat(46)}\n`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('\n💥 验证脚本自身出错：', e);
  process.exitCode = 1;
});
