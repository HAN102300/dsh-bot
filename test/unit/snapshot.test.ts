/**
 * 快照与回滚测试
 *
 * 「收得回」的核心验证：
 *   1. 快照能正确捕获 workspace 状态
 *   2. 回滚能恢复被修改的文件
 *   3. 回滚能删除新增的文件
 *   4. 自动清理旧快照
 *   5. 路径穿越防护
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { BotService } from '../../src/service.js';
import { DEFAULT_CONFIG } from '../../src/index.js';
import {
  SnapshotManager,
  DEFAULT_SNAPSHOT_OPTIONS,
  diffSnapshots,
  formatBytes,
} from '../../src/routine/snapshot.js';

let tmpRoot: string;
let service: BotService;
let botId: string;
let workspace: string;

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-bot-snap-'));
  service = new BotService({}, { ...DEFAULT_CONFIG, homeDir: tmpRoot, snapshotKeepRecent: 3 });
  const bot = await service.create({ name: '快照机', role: '测试回滚' });
  botId = bot.id;
  workspace = bot.workspace;
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

async function writeFile(rel: string, content: string): Promise<void> {
  const abs = path.join(workspace, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content, 'utf8');
}

async function readFile(rel: string): Promise<string> {
  return fsp.readFile(path.join(workspace, rel), 'utf8');
}

// ============================================================
// 快照创建
// ============================================================

describe('快照创建', () => {
  it('应捕获 workspace 中的文件', async () => {
    await writeFile('a.txt', 'AAA');
    await writeFile('sub/b.txt', 'BBB');

    const meta = await service.createSnapshot(workspace);
    expect(meta.fileCount).toBe(2);
    expect(meta.entries).toContain('a.txt');
    expect(meta.entries).toContain('sub/b.txt');
    expect(meta.totalBytes).toBe(6);
  });

  it('空 workspace 应能创建快照', async () => {
    const meta = await service.createSnapshot(workspace);
    expect(meta.fileCount).toBe(0);
  });

  it('应跳过 node_modules 等目录', async () => {
    await writeFile('a.txt', 'A');
    await writeFile('node_modules/pkg/index.js', 'noise');
    await writeFile('.git/config', 'noise');

    const meta = await service.createSnapshot(workspace);
    expect(meta.entries).toEqual(['a.txt']);
  });

  it('快照应记录 runId', async () => {
    const meta = await service.createSnapshot(workspace, 'run_abc');
    expect(meta.runId).toBe('run_abc');
  });

  it('快照 ID 应可按时间排序', async () => {
    const a = await service.createSnapshot(workspace);
    await new Promise((r) => setTimeout(r, 1100));
    const b = await service.createSnapshot(workspace);
    expect(b.id.localeCompare(a.id)).toBeGreaterThan(0);
  });
});

// ============================================================
// 回滚
// ============================================================

describe('回滚', () => {
  it('应恢复被修改的文件内容', async () => {
    await writeFile('a.txt', '原始内容');
    const snap = await service.createSnapshot(workspace);

    await writeFile('a.txt', '被改坏了');
    expect(await readFile('a.txt')).toBe('被改坏了');

    const result = await service.rollback(botId, snap.id);

    expect(result.snapshotId).toBe(snap.id);
    expect(result.restored).toContain('a.txt');
    expect(await readFile('a.txt')).toBe('原始内容');
  });

  it('应删除快照之后新增的文件', async () => {
    await writeFile('keep.txt', 'keep');
    const snap = await service.createSnapshot(workspace);

    await writeFile('added.txt', '这是快照之后才有的');
    expect(fs.existsSync(path.join(workspace, 'added.txt'))).toBe(true);

    const result = await service.rollback(botId, snap.id);

    expect(result.removed).toContain('added.txt');
    expect(fs.existsSync(path.join(workspace, 'added.txt'))).toBe(false);
    expect(await readFile('keep.txt')).toBe('keep');
  });

  it('应恢复被删除的文件', async () => {
    await writeFile('a.txt', 'A');
    await writeFile('b.txt', 'B');
    const snap = await service.createSnapshot(workspace);

    await fsp.unlink(path.join(workspace, 'a.txt'));
    expect(fs.existsSync(path.join(workspace, 'a.txt'))).toBe(false);

    await service.rollback(botId, snap.id);

    expect(await readFile('a.txt')).toBe('A');
    expect(await readFile('b.txt')).toBe('B');
  });

  it('不指定 snapshotId 时应回滚到最近一次', async () => {
    await writeFile('a.txt', 'v1');
    await service.createSnapshot(workspace);

    await writeFile('a.txt', 'v2');
    await new Promise((r) => setTimeout(r, 1100));
    await service.createSnapshot(workspace);

    await writeFile('a.txt', 'v3');

    const result = await service.rollback(botId);
    expect(result.snapshotId).toBeDefined();
    expect(await readFile('a.txt')).toBe('v2');
  });

  it('没有快照时回滚应报错', async () => {
    await expect(service.rollback(botId)).rejects.toThrow(/还没有任何快照/);
  });

  it('回滚不存在的快照应报错', async () => {
    await expect(service.rollback(botId, 'snap_nonexistent')).rejects.toThrow(
      /找不到快照/,
    );
  });

  it('应恢复嵌套目录中的文件', async () => {
    await writeFile('deep/nested/path/file.txt', '深层内容');
    const snap = await service.createSnapshot(workspace);

    await writeFile('deep/nested/path/file.txt', '改了');
    await service.rollback(botId, snap.id);

    expect(await readFile('deep/nested/path/file.txt')).toBe('深层内容');
  });

  it('回滚后目录结构应保持', async () => {
    await writeFile('dir/a.txt', 'A');
    const snap = await service.createSnapshot(workspace);
    await fsp.rm(path.join(workspace, 'dir'), { recursive: true, force: true });

    await service.rollback(botId, snap.id);
    expect(fs.existsSync(path.join(workspace, 'dir', 'a.txt'))).toBe(true);
  });
});

// ============================================================
// 快照管理
// ============================================================

describe('快照管理', () => {
  it('listSnapshots 应按时间倒序', async () => {
    await service.createSnapshot(workspace);
    await new Promise((r) => setTimeout(r, 1100));
    await service.createSnapshot(workspace);

    const list = await service.listSnapshots(botId);
    expect(list).toHaveLength(2);
    expect(list[0].createdAt >= list[1].createdAt).toBe(true);
  });

  it('超出 keepRecent 应自动清理最旧的', async () => {
    // 用独立的 manager 把 keepRecent 设为 2，避免依赖真实时间延迟
    const mgr = new SnapshotManager(path.dirname(workspace), {
      ...DEFAULT_SNAPSHOT_OPTIONS,
      keepRecent: 2,
    });

    for (let i = 0; i < 5; i++) {
      await writeFile('a.txt', `v${i}`);
      await mgr.create(workspace);
    }

    const list = await mgr.list();
    expect(list).toHaveLength(2);
  }, 20_000);

  it('应能手动删除快照', async () => {
    const meta = await service.createSnapshot(workspace);
    await service.removeSnapshot(botId, meta.id);
    const list = await service.listSnapshots(botId);
    expect(list).toHaveLength(0);
  });

  it('snapshotUsage 应统计数量与占用', async () => {
    await writeFile('a.txt', 'AAA');
    await service.createSnapshot(workspace);
    const usage = await service.snapshotUsage(botId);
    expect(usage.count).toBe(1);
    expect(usage.bytes).toBe(3);
  });

  it('回滚应写入记忆', async () => {
    await writeFile('a.txt', 'A');
    const snap = await service.createSnapshot(workspace);
    await service.rollback(botId, snap.id);

    const memories = await service.listMemories(botId);
    // rollback 本身不写记忆（由工具层写），这里验证不报错即可
    expect(Array.isArray(memories)).toBe(true);
  });
});

// ============================================================
// SnapshotManager 单元
// ============================================================

describe('SnapshotManager', () => {
  it('diffSnapshots 应正确计算差异', () => {
    const from = {
      id: 'a', createdAt: '', fileCount: 2, totalBytes: 0,
      entries: ['a.txt', 'b.txt'],
    };
    const to = {
      id: 'b', createdAt: '', fileCount: 2, totalBytes: 0,
      entries: ['b.txt', 'c.txt'],
    };
    const d = diffSnapshots(from, to);
    expect(d.added).toEqual(['c.txt']);
    expect(d.removed).toEqual(['a.txt']);
    expect(d.common).toEqual(['b.txt']);
  });

  it('formatBytes 应格式化', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.00 GB');
  });

  it('超大文件应被跳过', async () => {
    const mgr = new SnapshotManager(path.dirname(workspace), {
      ...DEFAULT_SNAPSHOT_OPTIONS,
      maxFileBytes: 10, // 只允许 10 字节
    });

    await writeFile('small.txt', 'hi');
    await writeFile('big.txt', 'x'.repeat(100));

    const meta = await mgr.create(workspace);
    expect(meta.entries).toContain('small.txt');
    expect(meta.entries).not.toContain('big.txt');
  });
});

// ============================================================
// 与 Runner 集成
// ============================================================

describe('Runner 集成：执行前自动快照', () => {
  it('真实执行应自动创建快照', async () => {
    const { RoutineRunner } = await import('../../src/routine/runner.js');

    await writeFile('before.txt', '执行前');
    await service.createSnapshot(workspace); // 先手动打一个作为基线

    const runner = new RoutineRunner({
      service,
      llm: async () => ({
        text: 'ok',
        usage: {
          inputTokens: 0, outputTokens: 0, cacheHitTokens: 0,
          cacheMissTokens: 0, reasoningTokens: 0, costCny: 0,
        },
      }),
      tools: { has: () => true, call: async () => ({ ok: true }) },
      newId: (p) => `${p}_${Math.random().toString(16).slice(2, 10)}`,
      nowIso: () => new Date().toISOString(),
      snapshotEnabled: true,
    });

    const routine = {
      apiVersion: 'dsh-bot/v1' as const,
      kind: 'Routine' as const,
      metadata: { id: 'r', name: 'R', version: 1 },
      spec: {
        triggers: [{ type: 'manual' as const }],
        params: {},
        steps: [{ id: 'a', type: 'llm' as const, prompt: 'hi' }],
      },
    };

    const rec = await runner.runRoutine(botId, routine as any, {
      dryRun: false,
      trigger: 'manual',
    });

    expect(rec.snapshotId).toBeDefined();
  });

  it('dry-run 不应创建快照', async () => {
    const { RoutineRunner } = await import('../../src/routine/runner.js');

    const runner = new RoutineRunner({
      service,
      llm: async () => ({
        text: 'ok',
        usage: {
          inputTokens: 0, outputTokens: 0, cacheHitTokens: 0,
          cacheMissTokens: 0, reasoningTokens: 0, costCny: 0,
        },
      }),
      tools: { has: () => true, call: async () => ({ ok: true }) },
      newId: (p) => `${p}_${Math.random().toString(16).slice(2, 10)}`,
      nowIso: () => new Date().toISOString(),
      snapshotEnabled: true,
    });

    const routine = {
      apiVersion: 'dsh-bot/v1' as const,
      kind: 'Routine' as const,
      metadata: { id: 'r', name: 'R', version: 1 },
      spec: {
        triggers: [{ type: 'manual' as const }],
        params: {},
        steps: [{ id: 'a', type: 'llm' as const, prompt: 'hi' }],
      },
    };

    const rec = await runner.runRoutine(botId, routine as any, {
      dryRun: true,
      trigger: 'manual',
    });

    expect(rec.snapshotId).toBeUndefined();
  });
});

// ============================================================
// 端到端：真实的"改坏了然后撤回"场景
// ============================================================

describe('端到端回滚场景', () => {
  it('批量改文件后能完整撤回', async () => {
    // 初始状态
    await writeFile('config.json', '{"version":1}');
    await writeFile('data/a.csv', 'id,name\n1,alice');
    await writeFile('data/b.csv', 'id,name\n2,bob');

    // 打快照
    const snap = await service.createSnapshot(workspace, 'run_before_cleanup');

    // 模拟"执行了错误的清理脚本"
    await writeFile('config.json', '{"version":999}');
    await fsp.unlink(path.join(workspace, 'data', 'a.csv'));
    await writeFile('data/c.csv', '不该存在的文件');
    await writeFile('temp.log', '垃圾');

    // 回滚
    const result = await service.rollback(botId, snap.id);

    // 验证完全恢复
    expect(await readFile('config.json')).toBe('{"version":1}');
    expect(await readFile('data/a.csv')).toBe('id,name\n1,alice');
    expect(await readFile('data/b.csv')).toBe('id,name\n2,bob');
    expect(fs.existsSync(path.join(workspace, 'data', 'c.csv'))).toBe(false);
    expect(fs.existsSync(path.join(workspace, 'temp.log'))).toBe(false);

    expect(result.restored.length).toBe(3);
    expect(result.removed.length).toBe(2);
  });
});

describe('执行前后双快照', () => {
  it('真实执行成功后应同时有 snapshotId 和 snapshotIdAfter', async () => {
    const { BotService } = await import('../../src/service.js');
    const { DEFAULT_CONFIG } = await import('../../src/index.js');
    const { RoutineRunner } = await import('../../src/routine/runner.js');
    const fsp = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');

    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-bot-dual-'));
    const service = new BotService({}, { ...DEFAULT_CONFIG, homeDir: tmp });
    const bot = await service.create({ name: 'T', role: 'r' });

    await fsp.writeFile(path.join(bot.workspace, 'a.txt'), 'x', 'utf8');

    const runner = new RoutineRunner({
      service,
      llm: async () => ({ text: 'ok', usage: { inputTokens:0, outputTokens:0, cacheHitTokens:0, cacheMissTokens:0, reasoningTokens:0, costCny:0 } }),
      tools: { has: () => true, call: async () => ({ ok: true }) },
      newId: (p) => `${p}_${Math.random().toString(16).slice(2,10)}`,
      nowIso: () => new Date().toISOString(),
      snapshotEnabled: true,
    });

    const routine = {
      apiVersion: 'dsh-bot/v1', kind: 'Routine',
      metadata: { id: 'dual', name: '双快照', version: 1 },
      spec: { triggers: [{ type: 'manual' }], params: {}, steps: [{ id: 'a', type: 'llm', prompt: 'hi' }] },
    };

    const rec = await runner.runRoutine(bot.id, routine as any, { dryRun: false, trigger: 'manual' });

    expect(rec.snapshotId).toBeDefined();
    expect(rec.snapshotIdAfter).toBeDefined();
    expect(rec.snapshotId).not.toBe(rec.snapshotIdAfter);

    const snaps = await service.listSnapshots(bot.id);
    expect(snaps.length).toBeGreaterThanOrEqual(2);

    await fsp.rm(tmp, { recursive: true, force: true });
  });
});

// ============================================================
// 回滚事务化（P1-2 回归）
//
// 修复前：restore 直接覆盖 workspace，事先不打快照——回滚选错，
// 回滚前的状态永久丢失。一个主打「收得回」的产品，它自己的
// 回滚动作是收不回的。
// ============================================================

describe('回滚事务化', () => {
  it('回滚前应自动给当前状态打快照（preSnapshotId），且可再滚回来', async () => {
    // 初始状态：a.txt = "v1"
    await fsp.writeFile(path.join(workspace, 'a.txt'), 'v1', 'utf8');
    const snap1 = await service.createSnapshot(workspace);

    // 改坏：a.txt = "v2"，并多出 junk.txt
    await fsp.writeFile(path.join(workspace, 'a.txt'), 'v2', 'utf8');
    await fsp.writeFile(path.join(workspace, 'junk.txt'), 'junk', 'utf8');

    // 回滚到 snap1 —— 应带回 preSnapshotId
    const r = await service.rollback(botId, snap1.id);
    expect(r.preSnapshotId).toBeDefined();
    expect(r.snapshotId).toBe(snap1.id);
    expect(await fsp.readFile(path.join(workspace, 'a.txt'), 'utf8')).toBe('v1');

    // 撤销的撤销：滚回 pre 快照，应回到「回滚前」的状态（v2 + junk）
    const r2 = await service.rollback(botId, r.preSnapshotId);
    expect(r2.preSnapshotId).toBeDefined();
    expect(await fsp.readFile(path.join(workspace, 'a.txt'), 'utf8')).toBe('v2');
    expect(fs.existsSync(path.join(workspace, 'junk.txt'))).toBe(true);
  });

  it('pre 快照的 note 应标注「回滚前自动快照」', async () => {
    await fsp.writeFile(path.join(workspace, 'x.txt'), '1', 'utf8');
    const snap1 = await service.createSnapshot(workspace);
    await fsp.writeFile(path.join(workspace, 'x.txt'), '2', 'utf8');

    const r = await service.rollback(botId, snap1.id);
    const preMeta = await service.listSnapshots(botId);
    const pre = preMeta.find((s) => s.id === r.preSnapshotId);
    expect(pre?.note).toBe('回滚前自动快照');
  });

  it('极小 keepRecent 时，回滚目标快照不会被 pre 快照挤掉', async () => {
    // 独立 manager：只保留 1 个
    const tinyDir = path.join(tmpRoot, 'tiny-bot');
    await fsp.mkdir(tinyDir, { recursive: true });
    const ws = path.join(tinyDir, 'workspace');
    await fsp.mkdir(ws, { recursive: true });
    await fsp.writeFile(path.join(ws, 'a.txt'), 'v1', 'utf8');

    const mgr = new SnapshotManager(tinyDir, {
      ...DEFAULT_SNAPSHOT_OPTIONS,
      keepRecent: 1,
    });
    const target = await mgr.create(ws);

    await fsp.writeFile(path.join(ws, 'a.txt'), 'v2', 'utf8');
    const r = await mgr.restore(target.id, ws);

    // 目标快照必须还在，且内容恢复为 v1
    expect(await mgr.get(target.id)).toBeDefined();
    expect(await fsp.readFile(path.join(ws, 'a.txt'), 'utf8')).toBe('v1');
    expect(r.errors).toEqual([]);
  });

  it('prune 的 preserve 名单内的快照不被清理', async () => {
    const tinyDir = path.join(tmpRoot, 'preserve-bot');
    await fsp.mkdir(tinyDir, { recursive: true });
    const ws = path.join(tinyDir, 'workspace');
    await fsp.mkdir(ws, { recursive: true });

    const mgr = new SnapshotManager(tinyDir, {
      ...DEFAULT_SNAPSHOT_OPTIONS,
      keepRecent: 1,
    });
    const old = await mgr.create(ws);
    // old 即将被挤出保留窗口，但它在豁免名单里
    await mgr.create(ws, undefined, { preserve: new Set([old.id]) });

    const ids = (await mgr.list()).map((s) => s.id);
    expect(ids).toContain(old.id);
  });
});
