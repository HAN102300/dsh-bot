/**
 * 目标节奏端到端验证
 *
 * 复现用户遇到的场景：
 *   他写「每过 4 小时给我报告」，然后发现 Bot 从来不自己跑。
 *
 * 这里验证三件事：
 *   1. 那句话能被识别成 cron
 *   2. 到点时调度器真的会 fire 一个 source='goal' 的触发
 *   3. 不带 cadence 的目标永远不会被调度（手动模式）
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = pathToFileURL(path.join(__dirname, '..', 'lib', 'index.js')).href;

const { BotService, createGoal, parseCadence, DEFAULT_CONFIG } = await import(entry);

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

const USER_GOAL =
  '从现在开始，将我本地的紫枫免费小说+Cloudflare tunnel+kuma服务监测的运行情况、各项参数报告，每过4小时给我';

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'dsh-bot-cadence-'));
  const service = new BotService({}, {
    ...DEFAULT_CONFIG,
    homeDir: root,
    costSensitiveScheduling: false, // 关掉错峰，测试才稳定
  });

  const bot = await service.create({ name: 'AI项目管家', role: '维护在线项目' });
  console.log(`\n🤖 ${bot.name} (${bot.id})\n`);

  // ---------------------------------------------------------
  console.log('① 用户原话能被识别成 execution cadence');
  // ---------------------------------------------------------
  const cadence = parseCadence(USER_GOAL);
  ok('识别出「每过4小时」', cadence === '0 */4 * * *', `实际：${cadence}`);

  // ---------------------------------------------------------
  console.log('\n② 目标落盘后带着 cadence');
  // ---------------------------------------------------------
  const goal = createGoal(
    'goal_test',
    { description: USER_GOAL, type: 'standing', cadence },
    new Date().toISOString(),
  );
  await service.saveGoal(bot.id, goal);

  const readBack = await service.getGoal(bot.id);
  ok('cadence 已落盘', readBack?.cadence === '0 */4 * * *', `实际：${readBack?.cadence}`);
  ok('是常驻守护型', readBack?.type === 'standing');

  // ---------------------------------------------------------
  console.log('\n③ 到点时调度器会 fire（这是"自己跑"的关键）');
  // ---------------------------------------------------------
  // 找一个正好命中 0 */4 * * * 的时刻：每 4 小时的整点
  const hit = new Date();
  hit.setHours(8, 0, 0, 0); // 08:00 命中
  const fired = await service.scheduler().tick(hit);

  const goalFire = fired.filter((f) => f.source === 'goal');
  ok('产生了 goal 触发', goalFire.length > 0, `实际：${fired.length} 个触发`);
  ok('触发来源标记为 goal', goalFire[0]?.source === 'goal');
  ok('触发带上了 goalId', goalFire[0]?.goalId === 'goal_test');

  // ---------------------------------------------------------
  console.log('\n④ 同一分钟不重复触发');
  // ---------------------------------------------------------
  const again = await service.scheduler().tick(hit);
  ok(
    '第二次 tick 不再触发',
    again.filter((f) => f.source === 'goal').length === 0,
    `实际：${again.length}`,
  );

  // ---------------------------------------------------------
  console.log('\n⑤ 非命中时刻不触发');
  // ---------------------------------------------------------
  const miss = new Date(hit);
  miss.setHours(9, 0, 0, 0); // 09:00 不命中 */4
  const noFire = await service.scheduler().tick(miss);
  ok('09:00 不触发', noFire.filter((f) => f.source === 'goal').length === 0);

  // ---------------------------------------------------------
  console.log('\n⑥ 没有 cadence 的目标永远不会自动跑');
  // ---------------------------------------------------------
  const bot2 = await service.create({ name: '手动党', role: '只在被叫时干活' });
  await service.saveGoal(
    bot2.id,
    createGoal('goal_manual', { description: '整理下载文件夹' }, new Date().toISOString()),
  );

  const manualFire = (
    await service.scheduler().tick(hit)
  ).filter((f) => f.botId === bot2.id);
  ok('手动目标不产生任何触发', manualFire.length === 0, `实际：${manualFire.length}`);

  const g2 = await service.getGoal(bot2.id);
  ok('它确实没有 cadence', g2?.cadence === undefined);

  // ---------------------------------------------------------
  console.log('\n⑦ 非 active 状态的目标不被调度');
  // ---------------------------------------------------------
  await service.saveGoal(bot.id, { ...readBack, status: 'pending_confirmation' });
  const hit2 = new Date(hit);
  hit2.setHours(12, 0, 0, 0); // 另一个命中时刻
  const pendingFire = (
    await service.scheduler().tick(hit2)
  ).filter((f) => f.botId === bot.id && f.source === 'goal');
  ok('待确认的目标不再自动跑', pendingFire.length === 0, `实际：${pendingFire.length}`);

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
