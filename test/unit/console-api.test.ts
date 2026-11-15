/**
 * v0.3.8 管理中心 API 测试
 *
 * 覆盖：预算编辑（/bot/update）与例行流程三端点。
 * 这些能力在 0.3.8 之前只有工具入口，没有 UI 路由。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

import { BotService } from '../../src/service.js';
import { makeBotApiRoutes } from '../../src/api/routes.js';
import { DEFAULT_CONFIG } from '../../src/index.js';

let tmpRoot: string;
let service: BotService;
let routes: any[];

function makeConfig(homeDir: string) {
  return { ...DEFAULT_CONFIG, homeDir };
}

function makeRes() {
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: null as any,
    setHeader(k: string, v: string) {
      this.headers[k] = v;
    },
    end(raw: string) {
      this.body = raw ? JSON.parse(raw) : null;
    },
  };
  return res;
}

function makeReq(method: string, url: string, body?: unknown) {
  const req: any = body === undefined
    ? { method, url, headers: { host: 'localhost:3210' } }
    : Readable.from([Buffer.from(JSON.stringify(body))]);
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost:3210', 'content-type': 'application/json' };
  return req;
}

async function call(method: string, url: string, body?: unknown) {
  const route = routes.find((r) => r.path === url.split('?')[0]);
  if (!route) throw new Error('route not found: ' + url);
  const res = makeRes();
  await route.handler(makeReq(method, url, body), res);
  return { status: res.statusCode, body: res.body };
}

const ROUTINE_YAML = [
  'apiVersion: dsh-bot/v1',
  'kind: Routine',
  'metadata:',
  '  id: weekly-clean',
  '  name: 每周整理',
  '  version: 1',
  'spec:',
  '  triggers:',
  '    - type: manual',
  '  params: {}',
  '  steps:',
  '    - type: llm',
  '      id: step1',
  '      prompt: 说一句你好',
].join('\n');

beforeEach(async () => {
  tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-bot-console-'));
  service = new BotService({}, makeConfig(tmpRoot));
  routes = makeBotApiRoutes(service as any, {
    run: async () => ({}) as any,
    getSettings: async () => null,
    getGlobalSettings: async () => null,
    saveSettings: async () => ({}),
  } as any) as any;
});

afterEach(async () => {
  await fsp.rm(tmpRoot, { recursive: true, force: true });
});

describe('预算编辑（/bot/update）', () => {
  it('应保存每日 / 每月上限与超限策略', async () => {
    const bot = await service.create({ name: '预算测试', role: '测试预算' });
    const { status, body } = await call('POST', '/_dsh-bot/bot/update', {
      botId: bot.id,
      budget: { dailyCny: 2, monthlyCny: 20, onExceed: 'downgrade' },
    });
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    const next = await service.get(bot.id);
    expect(next.budget.dailyCny).toBe(2);
    expect(next.budget.monthlyCny).toBe(20);
    expect(next.budget.onExceed).toBe('downgrade');
  });

  it('每日预算非法时应 400', async () => {
    const bot = await service.create({ name: '预算测试', role: '测试预算' });
    for (const dailyCny of [0, -1, 1001]) {
      const { status, body } = await call('POST', '/_dsh-bot/bot/update', {
        botId: bot.id,
        budget: { dailyCny, monthlyCny: 100 },
      });
      expect(status).toBe(400);
      expect(body.code).toBe('INVALID_ARGS');
    }
  });

  it('每月上限小于每日上限时应 400', async () => {
    const bot = await service.create({ name: '预算测试', role: '测试预算' });
    const { status } = await call('POST', '/_dsh-bot/bot/update', {
      botId: bot.id,
      budget: { dailyCny: 10, monthlyCny: 5 },
    });
    expect(status).toBe(400);
  });
});

describe('例行流程（/routines）', () => {
  it('保存 → 列表 → 读取 YAML → 删除', async () => {
    const bot = await service.create({ name: '流程测试', role: '测试流程' });

    const saved = await call('POST', '/_dsh-bot/routines/save', {
      botId: bot.id,
      yaml: ROUTINE_YAML,
    });
    expect(saved.status).toBe(200);

    const list = await call('GET', '/_dsh-bot/routines?botId=' + bot.id);
    expect(list.status).toBe(200);
    expect(list.body.value.routines).toHaveLength(1);
    expect(list.body.value.routines[0].name).toBe('每周整理');

    const one = await call(
      'GET',
      '/_dsh-bot/routines?botId=' + bot.id + '&routineId=weekly-clean',
    );
    expect(one.status).toBe(200);
    expect(one.body.value.yaml).toContain('weekly-clean');

    const removed = await call('POST', '/_dsh-bot/routines/remove', {
      botId: bot.id,
      routineId: 'weekly-clean',
    });
    expect(removed.status).toBe(200);
    const after = await call('GET', '/_dsh-bot/routines?botId=' + bot.id);
    expect(after.body.value.routines).toHaveLength(0);
  });

  it('非法 YAML 应 400，且不落盘', async () => {
    const bot = await service.create({ name: '流程测试', role: '测试流程' });
    const { status } = await call('POST', '/_dsh-bot/routines/save', {
      botId: bot.id,
      yaml: 'not: [valid',
    });
    expect(status).toBe(400);
    expect(fs.existsSync(service.routinesDir(bot.id))).toBe(true);
    const list = await call('GET', '/_dsh-bot/routines?botId=' + bot.id);
    expect(list.body.value.routines).toHaveLength(0);
  });

  it('未知 botId 应 404', async () => {
    const { status } = await call('GET', '/_dsh-bot/routines?botId=bot_nope');
    expect(status).toBe(404);
  });
});
