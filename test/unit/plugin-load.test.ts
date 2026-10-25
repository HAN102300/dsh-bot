/**
 * 插件加载完整性测试
 *
 * 由来：INCIDENT-2026-10-21 故障一——一个未定义变量（nowIso）在注册阶段
 * 抛错，被外层 try/catch 吞掉，14 个工具静默消失。页面照常渲染，
 * 「看起来一切正常」。
 *
 * 从此「插件加载后工具齐不齐、路由齐不齐」是一条断言，不是一次祈祷。
 * 新增/删除工具时，把下面的清单同步改掉（这个测试会提醒你）。
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apply } from '../../src/index.js';

/** 全部 24 个工具，按注册模块分组（与 src/tools/*.ts 一一对应） */
const EXPECTED_TOOLS = [
  // tools/bot.ts
  'bot_create', 'bot_list', 'bot_show', 'bot_update', 'bot_delete',
  'bot_recall', 'bot_memory_add', 'bot_runs',
  // tools/goal.ts
  'bot_goal',
  // tools/adopt.ts（对话介入的复合工具）
  'bot_adopt',
  // tools/routine.ts
  'bot_run',
  'routine_list', 'routine_show', 'routine_draft', 'routine_save',
  'routine_delete', 'routine_run',
  // tools/rollback.ts
  'bot_snapshots', 'bot_rollback', 'bot_snapshot',
  // tools/schedule.ts
  'bot_schedule', 'bot_schedules', 'bot_heartbeat',
  // tools/http.ts（通用只读联网抓取）
  'http_get',
] as const;

interface FakeHost {
  ctx: Record<string, unknown>;
  toolNames: string[];
  routePaths: string[];
}

function makeFakeHost(): FakeHost {
  const toolNames: string[] = [];
  const routePaths: string[] = [];
  return {
    toolNames,
    routePaths,
    ctx: {
      tools: {
        register(t: { name: string }) {
          toolNames.push(t.name);
          return () => {};
        },
        schemas: () => toolNames,
        get: (name: string) => toolNames.includes(name),
      },
      webServer: {
        register(route: { path: string }) {
          routePaths.push(route.path);
          return () => {};
        },
      },
      set: () => {},
      // 不执行 setup：调度器 interval 不启动，测试进程干净退出
      effect: () => () => {},
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    },
  };
}

describe('插件加载完整性', () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bot-load-'));

  it('apply 后应注册全部 22 个工具，一个不多一个不少', () => {
    const host = makeFakeHost();
    expect(() => apply(host.ctx as never, { homeDir })).not.toThrow();

    expect(host.toolNames.sort()).toEqual([...EXPECTED_TOOLS].sort());
  });

  it('应注册 HTTP 路由（面板依赖的 /_dsh-bot/* 端点）', () => {
    const host = makeFakeHost();
    apply(host.ctx as never, { homeDir });

    expect(host.routePaths.length).toBe(25);
    expect(host.routePaths.every((p) => p.startsWith('/_dsh-bot'))).toBe(true);
    // 核心端点抽查：面板的每个关键操作都有后端
    for (const must of [
      '/_dsh-bot/overview',
      '/_dsh-bot/run',
      '/_dsh-bot/dry-run',
      '/_dsh-bot/rollback',
      '/_dsh-bot/goal/set',
      '/_dsh-bot/runs/list',
    ]) {
      expect(host.routePaths).toContain(must);
    }
  });

  it('注册不应产生静默错误（诊断文件里 registerErrors 必须为空）', () => {
    const host = makeFakeHost();
    apply(host.ctx as never, { homeDir });

    const diagPath = path.join(homeDir, '.plugin-loaded.json');
    expect(fs.existsSync(diagPath)).toBe(true);
    const diag = JSON.parse(fs.readFileSync(diagPath, 'utf8'));
    expect(diag.registerErrors ?? []).toEqual([]);
    expect(diag.registeredCount).toBe(EXPECTED_TOOLS.length);
  });

  it('工具重名注册应立刻被发现（防未来回归）', () => {
    const host = makeFakeHost();
    apply(host.ctx as never, { homeDir });

    const dupes = host.toolNames.filter(
      (n, i, all) => all.indexOf(n) !== i,
    );
    expect(dupes).toEqual([]);
  });
});

// ============================================================
// 面板 API 本地来源守卫（P1-1）
// 面板 API 无鉴权，若不校验来源，本机恶意网页可跨站触发
// 真实执行 / 删 Bot / 回滚工作区。
// ============================================================

describe('面板 API 本地来源守卫', () => {
  it('localhost 来源应放行（任意端口）', async () => {
    const { isLocalRequest } = await import('../../src/api/routes.js');
    expect(isLocalRequest({ headers: { host: 'localhost:3210' } })).toBe(true);
    expect(isLocalRequest({ headers: { host: '127.0.0.1:8080' } })).toBe(true);
    expect(isLocalRequest({ headers: { host: '[::1]:9999' } })).toBe(true);
    expect(
      isLocalRequest({
        headers: { host: 'localhost:3210', origin: 'http://localhost:3210' },
      }),
    ).toBe(true);
  });

  it('外部 Origin / 外部 Host 应拒绝', async () => {
    const { isLocalRequest } = await import('../../src/api/routes.js');
    // 恶意网页跨站：Host 是本机，但 Origin 是外部
    expect(
      isLocalRequest({
        headers: { host: 'localhost:3210', origin: 'http://evil.example.com' },
      }),
    ).toBe(false);
    // DNS rebinding：Host 被重绑成外部域名
    expect(isLocalRequest({ headers: { host: 'evil.example.com' } })).toBe(false);
    expect(isLocalRequest({ headers: {} })).toBe(false);
  });
});
