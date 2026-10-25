/**
 * Workspace 快照与回滚
 *
 * 「收得回」的落地：
 *   1. 每轮运行前对 workspace 打快照
 *   2. 出问题时可以回滚到任意一次快照
 *   3. 快照自动清理，避免无限增长
 *
 * 实现选择：文件复制（而非 git / 硬链接）
 *   - 正确性优先：不要求 workspace 是 git 仓库
 *   - 零依赖：不引入外部命令
 *   - Windows 友好：硬链接跨卷有限制
 *
 * （曾经的头注释在这里宣称「内容寻址 / 增量」——实现从来是全量复制。
 *   注释不许许诺代码没有的东西。）
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

import { BotError } from '../types.js';
import { isInside } from '../service.js';

/** 快照元数据 */
export interface SnapshotMeta {
  /** 快照 ID */
  id: string;
  /** 创建时间 */
  createdAt: string;
  /** 关联的运行 ID */
  runId?: string;
  /** 文件数量 */
  fileCount: number;
  /** 总字节数 */
  totalBytes: number;
  /** 相对 workspace 的路径列表（用于回滚差异展示） */
  entries: string[];
  /** 备注（如「回滚前自动快照」） */
  note?: string;
}

/** 快照配置 */
export interface SnapshotOptions {
  /** 保留最近多少个快照 */
  keepRecent: number;
  /** 单个文件大小上限（字节），超过则跳过（如巨型二进制） */
  maxFileBytes: number;
  /** 跳过的目录名 */
  skipDirs: string[];
}

export const DEFAULT_SNAPSHOT_OPTIONS: SnapshotOptions = {
  keepRecent: 10,
  maxFileBytes: 10 * 1024 * 1024, // 10 MB
  skipDirs: ['node_modules', '.git', 'dist', 'build', '.cache', '__pycache__', '.venv', 'target'],
};

/**
 * 快照管理器。
 *
 * 目录布局：
 *   <botDir>/snapshots/
 *     ├── <snapId>/
 *     │   ├── meta.json
 *     │   └── files/          # 快照的 workspace 副本
 */
export class SnapshotManager {
  constructor(
    private readonly botDir: string,
    private readonly options: SnapshotOptions = DEFAULT_SNAPSHOT_OPTIONS,
  ) {}

  private get root(): string {
    return path.join(this.botDir, 'snapshots');
  }

  private snapDir(snapId: string): string {
    return path.join(this.root, snapId);
  }

  private filesDir(snapId: string): string {
    return path.join(this.snapDir(snapId), 'files');
  }

  private metaPath(snapId: string): string {
    return path.join(this.snapDir(snapId), 'meta.json');
  }

  /** 生成快照 ID：时间戳 + 随机，保证可按名称排序 */
  private newSnapshotId(): string {
    const ts = new Date().toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    return `snap_${ts}_${crypto.randomBytes(3).toString('hex')}`;
  }

  /**
   * 为 workspace 创建快照。
   *
   * @param workspace 要快照的目录（绝对路径）
   * @param runId 关联的运行 ID（可选）
   * @param opts.note 元数据备注（如「回滚前自动快照」）
   * @param opts.preserve 清理时绝不删除的快照 ID（目标归档快照等）
   */
  async create(
    workspace: string,
    runId?: string,
    opts?: { note?: string; preserve?: Set<string> },
  ): Promise<SnapshotMeta> {
    const ws = path.resolve(workspace);
    if (!fs.existsSync(ws)) {
      // workspace 不存在时建一个空快照，便于后续回滚到"空"状态
      await fsp.mkdir(ws, { recursive: true });
    }

    const snapId = this.newSnapshotId();
    const destFiles = this.filesDir(snapId);
    await fsp.mkdir(destFiles, { recursive: true });

    const entries: string[] = [];
    let totalBytes = 0;

    const walk = async (rel: string): Promise<void> => {
      const abs = path.join(ws, rel);
      let items: fs.Dirent[];
      try {
        items = await fsp.readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }

      for (const item of items) {
        const childRel = rel ? path.join(rel, item.name) : item.name;

        if (item.isDirectory()) {
          if (this.options.skipDirs.includes(item.name)) continue;
          await walk(childRel);
          continue;
        }
        if (item.isSymbolicLink()) {
          // 符号链接跳过，避免循环与越界
          continue;
        }
        if (!item.isFile()) continue;

        const srcAbs = path.join(ws, childRel);
        let stat: fs.Stats;
        try {
          stat = await fsp.stat(srcAbs);
        } catch {
          continue;
        }
        if (stat.size > this.options.maxFileBytes) {
          continue; // 超大文件跳过，记录在 meta 中会缺失
        }

        const dstAbs = path.join(destFiles, childRel);
        await fsp.mkdir(path.dirname(dstAbs), { recursive: true });
        try {
          await fsp.copyFile(srcAbs, dstAbs);
        } catch {
          continue; // 被占用/无权限的文件跳过
        }

        entries.push(childRel.split(path.sep).join('/'));
        totalBytes += stat.size;
      }
    };

    await walk('');

    const meta: SnapshotMeta = {
      id: snapId,
      createdAt: new Date().toISOString(),
      runId,
      fileCount: entries.length,
      totalBytes,
      entries: entries.sort(),
      note: opts?.note,
    };

    // meta 原子写：tmp + rename。直写一旦中途崩溃，这个快照会在
    // list() 里被静默跳过——存在却不可见，比不存在更糟。
    const metaFile = this.metaPath(snapId);
    const tmp = `${metaFile}.${process.pid}.${Date.now()}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(meta, null, 2), 'utf8');
    await fsp.rename(tmp, metaFile);

    await this.prune(opts?.preserve);
    return meta;
  }

  /** 列出所有快照（按时间倒序） */
  async list(): Promise<SnapshotMeta[]> {
    let dirs: string[];
    try {
      dirs = await fsp.readdir(this.root);
    } catch (e: any) {
      if (e?.code === 'ENOENT') return [];
      throw e;
    }

    const out: SnapshotMeta[] = [];
    for (const d of dirs) {
      if (!d.startsWith('snap_')) continue;
      try {
        const raw = await fsp.readFile(this.metaPath(d), 'utf8');
        out.push(JSON.parse(raw));
      } catch {
        // 损坏的快照目录跳过
      }
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return out;
  }

  /** 读取单个快照元数据 */
  async get(snapId: string): Promise<SnapshotMeta> {
    try {
      const raw = await fsp.readFile(this.metaPath(snapId), 'utf8');
      return JSON.parse(raw);
    } catch {
      throw new BotError('BOT_NOT_FOUND', `找不到快照：${snapId}`);
    }
  }

  /**
   * 回滚 workspace 到指定快照。
   *
   * 语义：
   *   - 快照中存在的文件 → 恢复内容
   *   - 快照中不存在、但当前存在的文件 → 删除
   *   - 快照中不存在的目录保持不变（避免误删用户的新目录）
   *
   * ⭐ 事务化（P1-2）：覆盖之前先给「当前状态」自动打快照——
   *   回滚选错也能再滚回来。撤销本身必须可撤销，否则「收得回」
   *   这个承诺在自己身上就不成立。
   *
   * @param preserve 清理时绝不删除的快照 ID（含归档引用）
   * @returns 变更摘要（含逐文件失败清单）
   */
  async restore(
    snapId: string,
    workspace: string,
    preserve?: Set<string>,
  ): Promise<{
    restored: string[];
    removed: string[];
    /** 恢复/删除失败的文件及原因（如被占用）——部分成功也要如实报告 */
    errors: string[];
    /** 回滚前自动快照的 ID（撤销撤销用） */
    preSnapshotId: string;
  }> {
    const meta = await this.get(snapId);
    const ws = path.resolve(workspace);
    const srcFiles = this.filesDir(snapId);

    if (!fs.existsSync(srcFiles)) {
      throw new BotError('BOT_NOT_FOUND', `快照 ${snapId} 的文件目录缺失`);
    }

    // 覆盖前先保住当前状态；清理时把「回滚目标」一并豁免，
    // 防止极小 keepRecent 时目标快照被这次新建挤掉
    const guard = new Set([snapId, ...(preserve ?? [])]);
    const pre = await this.create(ws, undefined, {
      note: '回滚前自动快照',
      preserve: guard,
    });

    const restored: string[] = [];
    const removed: string[] = [];
    const errors: string[] = [];

    // 1. 恢复快照中的文件（单文件失败记录后继续，不许停在半恢复态）
    const wanted = new Set(meta.entries);
    for (const rel of meta.entries) {
      const src = path.join(srcFiles, rel);
      const dst = path.join(ws, rel);

      // 安全校验：目标必须在 workspace 内
      if (!isInside(ws, dst)) {
        throw new BotError(
          'SANDBOX_VIOLATION',
          `快照路径越界：${rel}`,
        );
      }

      try {
        await fsp.mkdir(path.dirname(dst), { recursive: true });
        await fsp.copyFile(src, dst);
        restored.push(rel);
      } catch (e: any) {
        errors.push(`恢复失败 ${rel}：${e?.code ?? ''} ${e?.message ?? e}`.trim());
      }
    }

    // 2. 删除快照中不存在、当前 workspace 中存在的文件
    const current: string[] = [];
    const walkCurrent = async (rel: string): Promise<void> => {
      const abs = path.join(ws, rel);
      let items: fs.Dirent[];
      try {
        items = await fsp.readdir(abs, { withFileTypes: true });
      } catch {
        return;
      }
      for (const item of items) {
        const childRel = rel ? path.join(rel, item.name) : item.name;
        if (item.isDirectory()) {
          if (this.options.skipDirs.includes(item.name)) continue;
          await walkCurrent(childRel);
        } else if (item.isFile()) {
          current.push(childRel.split(path.sep).join('/'));
        }
      }
    };
    await walkCurrent('');

    for (const rel of current) {
      if (wanted.has(rel)) continue;
      const dst = path.join(ws, rel);
      if (!isInside(ws, dst)) continue;
      try {
        await fsp.unlink(dst);
        removed.push(rel);
      } catch (e: any) {
        errors.push(`删除失败 ${rel}：${e?.code ?? ''} ${e?.message ?? e}`.trim());
      }
    }

    return { restored, removed, errors, preSnapshotId: pre.id };
  }

  /** 删除指定快照 */
  async remove(snapId: string): Promise<void> {
    await fsp.rm(this.snapDir(snapId), { recursive: true, force: true });
  }

  /** 超出保留数量时清理最旧的快照。preserve 中的 ID 永不清理（归档引用等）。 */
  async prune(preserve?: Set<string>): Promise<string[]> {
    const all = await this.list();
    const excess = all
      .slice(this.options.keepRecent)
      .filter((s) => !preserve?.has(s.id));
    const removed: string[] = [];
    for (const s of excess) {
      await this.remove(s.id);
      removed.push(s.id);
    }
    return removed;
  }

  /** 总占用空间（字节） */
  async totalSize(): Promise<number> {
    const all = await this.list();
    return all.reduce((sum, s) => sum + s.totalBytes, 0);
  }
}

// ============================================================
// 差异展示
// ============================================================

/** 计算两个快照之间的文件差异 */
export function diffSnapshots(
  from: SnapshotMeta,
  to: SnapshotMeta,
): { added: string[]; removed: string[]; common: string[] } {
  const a = new Set(from.entries);
  const b = new Set(to.entries);
  return {
    added: [...b].filter((x) => !a.has(x)),
    removed: [...a].filter((x) => !b.has(x)),
    common: [...b].filter((x) => a.has(x)),
  };
}

/** 人类可读的字节数 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
