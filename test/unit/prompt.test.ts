/**
 * 系统提示测试
 *
 * 这些测试守的是一条曾经被打破的线：
 * 记忆每轮都在写，但系统提示从来没读过它。
 * 结果是 Bot 定时跑的时候「不记得上一次做过什么」，
 * 形态退化成一个定时任务执行器。
 *
 * 所以这里除了验证内容注入，还要验证 **顺序**：
 * 稳定段必须在易变段之前，否则 DeepSeek 的 KV Cache 前缀命不中，
 * 成本会差 50 倍。
 */

import { describe, it, expect } from 'vitest';

import { buildSystemPrompt } from '../../src/routine/runner.js';
import type { GoalState } from '../../src/types.js';

const BOT = {
  name: '文件管家',
  role: '整理下载文件夹',
};

function goal(patch?: Partial<GoalState>): GoalState {
  return {
    id: 'goal_1',
    type: 'one-shot',
    description: '整理下载文件夹',
    status: 'active',
    progress: '已归档 12 个文件',
    createdAt: '2026-10-19T00:00:00.000Z',
    updatedAt: '2026-10-19T00:00:00.000Z',
    needsHuman: false,
    ...patch,
  };
}

// ============================================================
// 基础行为
// ============================================================

describe('基础段落', () => {
  it('包含身份与职责', () => {
    const p = buildSystemPrompt(BOT);
    expect(p).toContain('文件管家');
    expect(p).toContain('整理下载文件夹');
  });

  it('无需上下文也能生成（向后兼容）', () => {
    expect(() => buildSystemPrompt(BOT)).not.toThrow();
    expect(() => buildSystemPrompt(BOT, {})).not.toThrow();
  });

  it('附加说明会并入稳定段', () => {
    const p = buildSystemPrompt({ ...BOT, systemPromptExtra: '不要说废话' });
    expect(p).toContain('不要说废话');
  });
});

// ============================================================
// KV Cache 顺序：这是成本红线
// ============================================================

describe('稳定段必须在易变段之前', () => {
  it('职责在工作准则之前', () => {
    const p = buildSystemPrompt(BOT);
    expect(p.indexOf('你的职责')).toBeLessThan(p.indexOf('工作准则'));
  });

  it('职责在目标之前', () => {
    const p = buildSystemPrompt(BOT, { goal: goal() });
    expect(p.indexOf('你的职责')).toBeLessThan(p.indexOf('你正在守的目标'));
  });

  it('职责在记忆之前', () => {
    const p = buildSystemPrompt(BOT, { facts: ['用户喜欢整洁'] });
    expect(p.indexOf('你的职责')).toBeLessThan(p.indexOf('你记得的事'));
  });

  it('目标在最近运行之前', () => {
    const p = buildSystemPrompt(BOT, {
      goal: goal(),
      recentRuns: [
        { startedAt: '2026-10-20T09:00:00.000Z', status: 'success', dryRun: false },
      ],
    });
    expect(p.indexOf('你正在守的目标')).toBeLessThan(p.indexOf('最近几次运行'));
  });

  it('两次调用的稳定前缀完全一致（可被缓存）', () => {
    const a = buildSystemPrompt(BOT, { goal: goal({ progress: '进展A' }) });
    const b = buildSystemPrompt(BOT, { goal: goal({ progress: '进展B' }) });
    // 稳定段 = 到"你正在守的目标"之前
    const cut = (s: string) => s.slice(0, s.indexOf('你正在守的目标'));
    expect(cut(a)).toBe(cut(b));
  });
});

// ============================================================
// 目标注入
// ============================================================

describe('目标注入', () => {
  it('目标描述、进展、下一步都出现', () => {
    const p = buildSystemPrompt(BOT, {
      goal: goal({ nextStep: '清理 .tmp' }),
    });
    expect(p).toContain('整理下载文件夹');
    expect(p).toContain('已归档 12 个文件');
    expect(p).toContain('清理 .tmp');
  });

  it('standing 目标显示轮次', () => {
    const p = buildSystemPrompt(BOT, {
      goal: goal({ type: 'standing', cycleCount: 7 }),
    });
    expect(p).toContain('已守护 7 轮');
    expect(p).toContain('没有终点');
  });

  it('pending_confirmation 明确告知不要重复执行', () => {
    const p = buildSystemPrompt(BOT, {
      goal: goal({ status: 'pending_confirmation' }),
    });
    expect(p).toContain('等待人确认');
    expect(p).toContain('不要重复执行');
  });

  it('blocked 明确告知不要重试同样做法', () => {
    const p = buildSystemPrompt(BOT, { goal: goal({ status: 'blocked' }) });
    expect(p).toContain('卡住了');
    expect(p).toContain('先别重复尝试');
  });

  it('没有目标时不出现目标段', () => {
    const p = buildSystemPrompt(BOT, {});
    expect(p).not.toContain('你正在守的目标');
  });
});

// ============================================================
// 记忆注入（这次修的核心）
// ============================================================

describe('记忆注入', () => {
  it('事实被注入', () => {
    const p = buildSystemPrompt(BOT, {
      facts: ['用户偏好把图片放 images/', '曾误删文件已回滚'],
    });
    expect(p).toContain('用户偏好把图片放 images/');
    expect(p).toContain('曾误删文件已回滚');
  });

  it('最多注入 8 条（避免提示膨胀）', () => {
    const facts = Array.from({ length: 20 }, (_, i) => `事实${i}`);
    const p = buildSystemPrompt(BOT, { facts });
    expect(p).toContain('事实0');
    expect(p).toContain('事实7');
    expect(p).not.toContain('事实8');
  });

  it('最近运行被注入，并带时间', () => {
    const p = buildSystemPrompt(BOT, {
      recentRuns: [
        { startedAt: '2026-10-20T09:30:00.000Z', status: 'success', dryRun: false },
      ],
    });
    expect(p).toContain('2026-10-20 09:30');
    expect(p).toContain('success');
  });

  it('最近运行最多 3 条', () => {
    const recentRuns = Array.from({ length: 6 }, (_, i) => ({
      startedAt: `2026-10-2${i}T09:00:00.000Z`,
      status: 'success',
      dryRun: false,
    }));
    const p = buildSystemPrompt(BOT, { recentRuns });
    expect(p).toContain('2026-10-20');
    expect(p).not.toContain('2026-10-23');
  });

  it('dry-run 运行会标注演习', () => {
    const p = buildSystemPrompt(BOT, {
      recentRuns: [
        { startedAt: '2026-10-20T09:00:00.000Z', status: 'success', dryRun: true },
      ],
    });
    expect(p).toContain('演习');
  });

  it('被拦截的步骤数会显示', () => {
    const p = buildSystemPrompt(BOT, {
      recentRuns: [
        {
          startedAt: '2026-10-20T09:00:00.000Z',
          status: 'partial',
          dryRun: false,
          steps: [{ blocked: {} }, { blocked: {} }, {}],
        },
      ],
    });
    expect(p).toContain('2 步被拦截');
  });

  it('有历史时提示不要重复劳动', () => {
    const p = buildSystemPrompt(BOT, {
      recentRuns: [
        { startedAt: '2026-10-20T09:00:00.000Z', status: 'success', dryRun: false },
      ],
    });
    expect(p).toContain('不要重复已经做过的事');
  });
});

// ============================================================
// 自评协议
// ============================================================

describe('自评协议', () => {
  it('有活目标时要求输出评估块', () => {
    const p = buildSystemPrompt(BOT, { goal: goal() });
    expect(p).toContain('<<<goal>>>');
    expect(p).toContain('<<<!/goal>>>');
    expect(p).toContain('achieved');
  });

  it('没有目标时不要求评估（省钱）', () => {
    const p = buildSystemPrompt(BOT, {});
    expect(p).not.toContain('<<<goal>>>');
  });

  it('目标待确认时不重复要求评估', () => {
    const p = buildSystemPrompt(BOT, {
      goal: goal({ status: 'pending_confirmation' }),
    });
    expect(p).not.toContain('<<<goal>>>');
  });

  it('明确告知不能自己宣布达成', () => {
    const p = buildSystemPrompt(BOT, { goal: goal() });
    expect(p).toContain('不能');
    expect(p).toContain('由人来拍板');
  });

  it('告知 standing 目标永远填 false', () => {
    const p = buildSystemPrompt(BOT, {
      goal: goal({ type: 'standing', cycleCount: 0 }),
    });
    expect(p).toContain('常驻守护型目标永远填 false');
  });
});

// ============================================================
// 健壮性
// ============================================================

describe('健壮性', () => {
  it('空数组不产生空段落', () => {
    const p = buildSystemPrompt(BOT, { facts: [], recentRuns: [] });
    expect(p).not.toContain('你记得的事');
    expect(p).not.toContain('最近几次运行');
  });

  it('空 note 不破坏结构', () => {
    const p = buildSystemPrompt(BOT, { goal: goal({ progress: '' }) });
    expect(p).toContain('当前进展：');
  });

  it('超长事实不会让函数崩', () => {
    const p = buildSystemPrompt(BOT, { facts: ['x'.repeat(10000)] });
    expect(typeof p).toBe('string');
  });
});
