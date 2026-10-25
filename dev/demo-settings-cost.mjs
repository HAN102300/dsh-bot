/**
 * 设置与成本端到端验证
 *
 * 覆盖 ROADMAP 第二刀（成本诚实化）+ 第三刀（设置页）。
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;

const { computeCost, isFreeModel, BotService, SettingsStore, DEFAULT_CONFIG, inQuietHours } =
  await import(entry);

let pass = 0;
let fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? `\n     ${detail}` : ''}`); }
}

const usage = { cacheHitTokens: 0, cacheMissTokens: 1000, outputTokens: 500 };

async function main() {
  console.log('\n① 成本：免费 vs 未知必须可区分');
  const free = computeCost('our-free-model', 'deepseek-v4.1-flash-free', usage);
  const unknown = computeCost('mystery', 'nothing', usage);
  const exact = computeCost('deepseek', 'deepseek-flash', usage);

  ok('免费模型 → kind=free, cny=0', free.kind === 'free' && free.cny === 0);
  ok('未知模型 → kind=unknown, cny=undefined',
    unknown.kind === 'unknown' && unknown.cny === undefined,
    `实际 kind=${unknown.kind} cny=${unknown.cny}`);
  ok('已知模型 → kind=exact', exact.kind === 'exact');
  ok('免费与未知不是同一个东西', free.kind !== unknown.kind);
  console.log(`     免费: ${free.note}`);
  console.log(`     未知: ${unknown.note}`);

  console.log('\n② 免费模型识别');
  ok('our-free-model 被识别为免费', isFreeModel('our-free-model', 'x-free'));
  ok('deepseek-web 被识别为免费', isFreeModel('deepseek-web', 'anything'));
  ok('付费模型不误判', !isFreeModel('trae', 'deepseek-v4.1-flash'));

  console.log('\n③ 设置存储');
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-bot-e2e2-'));
  const store = new SettingsStore(tmp);

  const def = await store.resolve();
  ok('默认值可用', def.dailyCny === 5 && def.notifySystem === true);

  await store.setGlobal({ dailyCny: 12 });
  ok('全局设置已保存', (await store.resolve()).dailyCny === 12);

  await store.setForBot('bot_x', { dailyCny: 3 });
  ok('单 Bot 覆盖全局', (await store.resolve('bot_x')).dailyCny === 3);
  ok('其它 Bot 仍用全局', (await store.resolve('bot_y')).dailyCny === 12);

  console.log('\n④ 免打扰时段');
  const night = new Date('2026-10-21T15:00:00Z'); // 北京 23:00
  ok('23:00 在 22:00-08:00 内', inQuietHours({ start: '22:00', end: '08:00' }, night));
  const noon = new Date('2026-10-21T04:00:00Z'); // 北京 12:00
  ok('12:00 不在 22:00-08:00 内', !inQuietHours({ start: '22:00', end: '08:00' }, noon));

  console.log('\n⑤ 运行记录清空');
  const service = new BotService({}, { ...DEFAULT_CONFIG, homeDir: tmp });
  const bot = await service.create({ name: '清理测试', role: '测试' });

  // 造 3 条运行记录
  for (let i = 0; i < 3; i++) {
    await service.saveRun({
      id: `run_test${i}`,
      botId: bot.id,
      trigger: 'manual',
      startedAt: new Date().toISOString(),
      endedAt: new Date().toISOString(),
      dryRun: false,
      status: 'success',
      steps: [],
      usage: { inputTokens: 10, outputTokens: 5, cacheHitTokens: 0, cacheMissTokens: 10, reasoningTokens: 0, costCny: 0.001 },
    });
  }
  ok('运行记录已写入 3 条', (await service.runCount(bot.id)) === 3);

  const removed = await service.clearRuns(bot.id);
  ok('清空返回删除数量', removed === 3, `实际 ${removed}`);
  ok('清空后为 0', (await service.runCount(bot.id)) === 0);

  console.log('\n⑥ 成本明细区分未知');
  const b2 = await service.create({ name: '成本测试', role: '测试' });
  await service.saveRun({
    id: 'run_unknown',
    botId: b2.id,
    trigger: 'manual',
    startedAt: new Date().toISOString(),
    endedAt: new Date().toISOString(),
    dryRun: false,
    status: 'success',
    steps: [],
    usage: { inputTokens: 100, outputTokens: 50, cacheHitTokens: 0, cacheMissTokens: 100, reasoningTokens: 0, costKind: 'unknown' },
  });
  const spend = await service.spendBreakdown(b2.id, 'day');
  ok('未知成本的运行被单独计数', spend.unknownRuns === 1, `实际 ${spend.unknownRuns}`);
  ok('金额不含那一条', spend.cny === 0);

  await fs.rm(tmp, { recursive: true, force: true });

  console.log(`\n${'─'.repeat(46)}`);
  console.log(`  通过 ${pass} 项，失败 ${fail} 项`);
  console.log(`${'─'.repeat(46)}\n`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error('\n💥 验证脚本出错：', e);
  process.exitCode = 1;
});
