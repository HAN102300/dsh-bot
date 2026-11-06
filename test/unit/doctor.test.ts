/**
 * 诊断聚合测试（v0.3.5 刀 2）
 *
 * 四层：宿主注册 / 客户端面板 / 启动崩溃 / 模型。
 * 约定：缺文件不算「坏」，但要说「未记录」；崩溃记录才算 error。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, afterEach } from 'vitest';

import { buildDoctorReport } from '../../src/doctor.js';

const dirs: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-bot-doctor-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

const write = (dir: string, name: string, value: unknown) =>
  fs.writeFileSync(path.join(dir, name), JSON.stringify(value));

const base = { version: '0.3.5', expectedTools: 25 };

describe('buildDoctorReport', () => {
  it('全空目录：宿主 error、客户端 warn、崩溃 ok', async () => {
    const r = await buildDoctorReport({
      ...base,
      homeDir: tmp(),
      modelProbe: async () => ({ level: 'ok', detail: 'provider 可用' }),
    });
    const by = Object.fromEntries(r.checks.map((c) => [c.id, c]));
    expect(by.host.level).toBe('error');
    expect(by.client.level).toBe('warn');
    expect(by.crash.level).toBe('ok');
    expect(by.model.level).toBe('ok');
    expect(r.text).toContain('结论');
  });

  it('四层正常：全部 ok', async () => {
    const d = tmp();
    write(d, '.plugin-loaded.json', {
      loadedAt: '2026-11-06T04:00:00.000Z',
      registeredCount: 25,
      registerErrors: [],
      llmReady: true,
      hasWebServer: true,
      apiRoutes: 26,
    });
    write(d, '.client-status.json', {
      history: [{ status: 'ok', version: '0.3.5', at: '2026-11-06T04:00:00.000Z' }],
    });
    const r = await buildDoctorReport({ ...base, homeDir: d });
    expect(r.checks.every((c) => c.level === 'ok')).toBe(true);
  });

  it('client 版本不一致 → warn 且提示重装', async () => {
    const d = tmp();
    write(d, '.plugin-loaded.json', { registeredCount: 25, registerErrors: [], llmReady: true });
    write(d, '.client-status.json', {
      history: [{ status: 'ok', version: '0.3.4', at: '2026-11-06T04:00:00.000Z' }],
    });
    const r = await buildDoctorReport({ ...base, homeDir: d });
    const client = r.checks.find((c) => c.id === 'client')!;
    expect(client.level).toBe('warn');
    expect(client.hint).toContain('重装');
  });

  it('崩溃文件存在 → error 且进入结论', async () => {
    const d = tmp();
    write(d, '.plugin-crash.json', { at: '2026-11-06T04:00:00.000Z', message: 'boom' });
    const r = await buildDoctorReport({ ...base, homeDir: d });
    const crash = r.checks.find((c) => c.id === 'crash')!;
    expect(crash.level).toBe('error');
    expect(crash.detail).toContain('boom');
  });

  it('工具数不符 → warn，而不是 error', async () => {
    const d = tmp();
    write(d, '.plugin-loaded.json', { registeredCount: 24, registerErrors: [], llmReady: true });
    const r = await buildDoctorReport({ ...base, homeDir: d });
    expect(r.checks.find((c) => c.id === 'host')!.level).toBe('warn');
  });
});
