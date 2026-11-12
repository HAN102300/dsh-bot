/**
 * 改执行周期时，目标描述里的节奏措辞要同步（v0.3.7）
 *
 * 真机现象：把周期从 12 小时改成 24 小时后，cron 变了（0 0 * * *），
 * 但目标描述仍写着「每过 12 小时查询一次」——面板上两句话互相矛盾。
 * 这里锁住「只替换节奏片段、不动其余文案」的行为。
 */

import { describe, it, expect } from 'vitest';

import { syncCadenceInDescription } from '../../src/api/routes.js';

describe('syncCadenceInDescription', () => {
  it('每 N 小时 → 每小时短语', () => {
    expect(syncCadenceInDescription('每过 12 小时查询一次服务状态', '0 */6 * * *')).toBe(
      '每 6 小时查询一次服务状态',
    );
  });

  it('小时 → 每天 HH:mm（补空格）', () => {
    expect(syncCadenceInDescription('每过 12 小时查询一次服务状态', '0 9 * * *')).toBe(
      '每天 09:00 查询一次服务状态',
    );
  });

  it('每天 → 每周（多选星期）', () => {
    expect(syncCadenceInDescription('每天 09:00 汇报昨日数据', '0 9 * * 1,3')).toBe(
      '每周一、周三 09:00 汇报昨日数据',
    );
  });

  it('描述里没有节奏片段时不硬塞', () => {
    expect(syncCadenceInDescription('整理下载目录并归档', '0 0 * * *')).toBe('整理下载目录并归档');
  });

  it('自定义 cron 不解析，保持原文', () => {
    expect(syncCadenceInDescription('每过 12 小时查询一次', '0 9 * * 1-5')).toBe('每过 12 小时查询一次');
  });

  it('24 小时按「每天 00:00」表达', () => {
    expect(syncCadenceInDescription('每过 12 小时抓取数据', '0 0 * * *')).toBe('每天 00:00 抓取数据');
  });
});
