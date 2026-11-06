/**
 * 诊断聚合（v0.3.5 刀 2）
 *
 * 三个事实文件一直在写，但从来没有入口读：
 *   .plugin-loaded.json —— 宿主侧到底起没起来
 *   .client-status.json —— 面板是没加载，还是加载后抛错
 *   .plugin-crash.json  —— 上次启动是不是崩过
 *
 * 这里把它们 + 模型可用性聚合成一份「四层结论」，供：
 *   · GET /_dsh-bot/doctor（面板「诊断」块）
 *   · bot_doctor 工具（模型自查）
 *
 * 约束：只读、不读敏感内容、任何一项失败都不阻断其他项。
 */

import fs from 'node:fs';
import path from 'node:path';

export type DoctorLevel = 'ok' | 'warn' | 'error';

export interface DoctorCheck {
  id: 'host' | 'client' | 'crash' | 'model';
  level: DoctorLevel;
  title: string;
  detail: string;
  hint?: string;
}

export interface DoctorReport {
  ok: true;
  checkedAt: string;
  version: string;
  checks: DoctorCheck[];
  /** 纯文本版：可直接复制贴 issue */
  text: string;
}

export interface DoctorInput {
  homeDir: string;
  /** 当前插件构建版本（package.json.version） */
  version: string;
  /** 期望的工具数；注册缺失时用来对比 */
  expectedTools: number;
  /** 模型可用性探测（由插件入口注入） */
  modelProbe?: () => Promise<{ level: DoctorLevel; detail: string; hint?: string }>;
}

const LEVEL_LABEL: Record<DoctorLevel, string> = { ok: '正常', warn: '注意', error: '故障' };

function readJson(file: string): any | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function safeString(v: unknown, max = 200): string {
  const s = typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v);
  return s.length > max ? s.slice(0, max) + '…' : s;
}

export async function buildDoctorReport(input: DoctorInput): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const loadedPath = path.join(input.homeDir, '.plugin-loaded.json');
  const statusPath = path.join(input.homeDir, '.client-status.json');
  const crashPath = path.join(input.homeDir, '.plugin-crash.json');

  // ---------- 1. 宿主注册 ----------
  try {
    const j = readJson(loadedPath);
    if (!j) {
      checks.push({
        id: 'host',
        level: 'error',
        title: '宿主注册',
        detail: '没有找到 .plugin-loaded.json：宿主侧没有加载过这个插件。',
        hint: '重启 DSH；仍无效则确认插件在「插件」页已启用，并检查 ~/.dsh/bot 目录是否可写。',
      });
    } else {
      const count = Number(j.registeredCount ?? 0);
      const regErrors: unknown[] = Array.isArray(j.registerErrors) ? j.registerErrors : [];
      const llmReady = j.llmReady !== false;
      const hasWeb = j.hasWebServer !== false;
      let level: DoctorLevel = 'ok';
      const problems: string[] = [];
      if (regErrors.length > 0) {
        level = 'error';
        problems.push(`${regErrors.length} 个注册错误`);
      }
      if (!llmReady) {
        level = 'error';
        problems.push('模型服务未就绪（llmReady=false）');
      }
      if (!hasWeb) {
        level = 'error';
        problems.push('webServer 不可用，面板 API 无法注册');
      }
      if (count !== input.expectedTools && level === 'ok') {
        level = 'warn';
        problems.push(`工具数 ${count}/${input.expectedTools}`);
      }
      checks.push({
        id: 'host',
        level,
        title: '宿主注册',
        detail:
          `${count}/${input.expectedTools} 个工具 · llmReady=${llmReady} · 路由 ${j.apiRoutes ?? '?'} · 加载于 ${safeString(j.loadedAt, 40) || '未知'}` +
          (problems.length ? ` · ${problems.join('；')}` : ''),
        hint:
          level === 'ok'
            ? undefined
            : regErrors.length > 0
              ? `先看 registerErrors：${safeString(JSON.stringify(regErrors[0]))}`
              : !llmReady
                ? '检查 DSH 的模型渠道配置；模型服务不可用时「执行」会返回空结果。'
                : `工具数不符：确认插件版本与宿主版本匹配（当前 ${input.version}）。`,
      });
    }
  } catch (e: any) {
    checks.push({ id: 'host', level: 'warn', title: '宿主注册', detail: `读取失败：${safeString(e?.message)}` });
  }

  // ---------- 2. Client 加载 ----------
  try {
    const j = readJson(statusPath);
    const history: any[] = Array.isArray(j?.history) ? j.history : [];
    const last = history[history.length - 1];
    if (!last) {
      checks.push({
        id: 'client',
        level: 'warn',
        title: '客户端面板',
        detail: '浏览器端从未上报过加载状态。',
        hint: '刷新页面；若面板仍然不见，重装插件（可能是 client bundle 未随版本更新）。',
      });
    } else {
      const status = safeString(last.status, 60) || 'unknown';
      const version = typeof last.version === 'string' ? last.version : null;
      const stale = version !== null && input.version !== 'unknown' && version !== input.version;
      const bad = /error|fail/i.test(status);
      const level: DoctorLevel = bad || stale ? 'warn' : 'ok';
      checks.push({
        id: 'client',
        level,
        title: '客户端面板',
        detail: `最近上报：${status} · 版本 ${version ?? '未上报'} · ${safeString(last.at, 40) || '未知时间'}`,
        hint: stale
          ? `面板跑的构建是 ${version}，当前是 ${input.version}：重装插件并刷新页面。`
          : bad
            ? '面板加载过程报过错，看 detail 字段；必要时强制刷新页面。'
            : undefined,
      });
    }
  } catch (e: any) {
    checks.push({ id: 'client', level: 'warn', title: '客户端面板', detail: `读取失败：${safeString(e?.message)}` });
  }

  // ---------- 3. 崩溃记录 ----------
  try {
    const j = readJson(crashPath);
    if (!j) {
      checks.push({ id: 'crash', level: 'ok', title: '启动崩溃', detail: '没有崩溃记录。' });
    } else {
      checks.push({
        id: 'crash',
        level: 'error',
        title: '启动崩溃',
        detail: `上次启动抛过错：${safeString(j.at ?? j.time, 40) || '未知时间'} · ${safeString(j.message ?? j.error)}`,
        hint: '把这条贴到 issue；重启用崩溃对话框的「禁用第三方插件」进入，再按诊断建议重装。',
      });
    }
  } catch (e: any) {
    checks.push({ id: 'crash', level: 'warn', title: '启动崩溃', detail: `读取失败：${safeString(e?.message)}` });
  }

  // ---------- 4. 模型 ----------
  try {
    if (input.modelProbe) {
      const r = await input.modelProbe();
      checks.push({ id: 'model', level: r.level, title: '模型', detail: r.detail, hint: r.hint });
    } else {
      checks.push({ id: 'model', level: 'ok', title: '模型', detail: '未探测（宿主未提供探测入口）。' });
    }
  } catch (e: any) {
    checks.push({ id: 'model', level: 'warn', title: '模型', detail: `探测失败：${safeString(e?.message)}` });
  }

  const firstBad = checks.find((c) => c.level !== 'ok');
  const lines = [
    `dsh-bot 诊断 · 版本 ${input.version} · ${new Date().toISOString()}`,
    ...checks.map(
      (c) => `[${LEVEL_LABEL[c.level]}] ${c.title}：${c.detail}` + (c.hint ? `\n        下一步：${c.hint}` : ''),
    ),
    firstBad
      ? `\n结论：先处理「${firstBad.title}」——${firstBad.hint ?? '见上'}`
      : '\n结论：四层都正常。',
  ].join('\n');

  return { ok: true, checkedAt: new Date().toISOString(), version: input.version, checks, text: lines };
}
