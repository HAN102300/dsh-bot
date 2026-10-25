/**
 * 目标状态机测试
 *
 * 这里最重要的不是覆盖率，而是把三条"不许"钉死：
 *   1. Bot 不能把目标置为 achieved
 *   2. Bot 不能把目标置为 abandoned
 *   3. standing 目标永远不能 achieved（即使是人也不行）
 *
 * 这三条一旦被悄悄改坏，整个「守得住」的信任模型就塌了。
 */

import { describe, it, expect } from 'vitest';

import {
  canTransition,
  assertTransition,
  createGoal,
  createProposal,
  transitionGoal,
  updateProgress,
  bumpCycle,
  applyAssessment,
  parseAssessment,
  isTerminal,
  isLive,
  needsAttention,
  goalStatusLabel,
  goalTypeLabel,
  ASSESSMENT_OPEN,
  ASSESSMENT_CLOSE,
} from '../../src/goal/state.js';
import type { GoalState } from '../../src/types.js';

const NOW = '2026-10-21T12:00:00.000Z';

function makeGoal(patch?: Partial<GoalState>): GoalState {
  return {
    ...createGoal('goal_test', { description: '整理下载文件夹' }, NOW),
    ...patch,
  };
}

function makeStanding(patch?: Partial<GoalState>): GoalState {
  return {
    ...createGoal(
      'goal_test',
      { description: '让下载文件夹保持整洁', type: 'standing' },
      NOW,
    ),
    ...patch,
  };
}

// ============================================================
// 权限边界：这套代码存在的理由
// ============================================================

describe('Bot 不能自己宣布胜利', () => {
  it('Bot 把 active 改为 achieved 会被拒绝', () => {
    const goal = makeGoal();
    expect(() => transitionGoal(goal, 'achieved', 'bot', NOW)).toThrow(
      /Bot 不能自己把目标置为 achieved/,
    );
  });

  it('Bot 把 pending_confirmation 改为 achieved 会被拒绝', () => {
    // 即使 Bot 已经自评完成，它也不能自己签字通过
    const goal = makeGoal({ status: 'pending_confirmation' });
    expect(() => transitionGoal(goal, 'achieved', 'bot', NOW)).toThrow(
      /Bot 不能自己把目标置为 achieved/,
    );
  });

  it('Bot 不能放弃目标', () => {
    const goal = makeGoal();
    expect(() => transitionGoal(goal, 'abandoned', 'bot', NOW)).toThrow(
      /Bot 不能自己把目标置为 abandoned/,
    );
  });

  it('Bot 不能开张新目标（proposed → active）', () => {
    const goal = createProposal('goal_p', { description: '接着做' }, 'goal_old', NOW);
    expect(() => transitionGoal(goal, 'active', 'bot', NOW)).toThrow();
  });

  it('Bot 不能解除阻塞', () => {
    const goal = makeGoal({ status: 'blocked' });
    expect(() => transitionGoal(goal, 'active', 'bot', NOW)).toThrow();
  });

  it('Bot 可以做的三件事都允许', () => {
    expect(canTransition('active', 'pending_confirmation', 'bot')).toBe(true);
    expect(canTransition('active', 'blocked', 'bot')).toBe(true);
    expect(canTransition('pending_confirmation', 'blocked', 'bot')).toBe(true);
  });

  it('Bot 的合法迁移集合恰好是 3 条', () => {
    const all = [
      ['active', 'pending_confirmation'],
      ['active', 'blocked'],
      ['pending_confirmation', 'blocked'],
      ['active', 'achieved'],
      ['active', 'abandoned'],
      ['blocked', 'active'],
      ['proposed', 'active'],
    ] as const;
    const allowed = all.filter(([f, t]) => canTransition(f, t, 'bot'));
    expect(allowed).toHaveLength(3);
  });
});

describe('人可以做的终局判定', () => {
  it('人可以确认达成', () => {
    const goal = makeGoal({ status: 'pending_confirmation' });
    const next = transitionGoal(goal, 'achieved', 'human', NOW);
    expect(next.status).toBe('achieved');
    expect(next.needsHuman).toBe(false);
  });

  it('人可以驳回，目标回到 active', () => {
    const goal = makeGoal({ status: 'pending_confirmation' });
    const next = transitionGoal(goal, 'active', 'human', NOW, {
      progress: '被驳回：还没做完',
    });
    expect(next.status).toBe('active');
  });

  it('人可以放弃', () => {
    const next = transitionGoal(makeGoal(), 'abandoned', 'human', NOW);
    expect(next.status).toBe('abandoned');
  });

  it('人可以接受接续候选', () => {
    const p = createProposal('goal_p', { description: '保持干净' }, 'goal_old', NOW);
    const next = transitionGoal(p, 'active', 'human', NOW);
    expect(next.status).toBe('active');
  });

  it('人不能走不存在的迁移（active → proposed）', () => {
    expect(canTransition('active', 'proposed', 'human')).toBe(false);
  });
});

// ============================================================
// standing 目标的铁律
// ============================================================

describe('常驻守护型目标永不完成', () => {
  it('即使是人也不能把它置为 achieved', () => {
    const goal = makeStanding();
    expect(() => transitionGoal(goal, 'achieved', 'human', NOW)).toThrow(
      /常驻守护型目标，没有终点/,
    );
  });

  it('每完成一轮只增加轮次，状态不变', () => {
    const goal = makeStanding();
    const next = bumpCycle(goal, NOW);
    expect(next.cycleCount).toBe(1);
    expect(next.status).toBe('active');
  });

  it('轮次可以累积', () => {
    let goal = makeStanding();
    for (let i = 0; i < 5; i++) goal = bumpCycle(goal, NOW);
    expect(goal.cycleCount).toBe(5);
    expect(goal.status).toBe('active');
  });

  it('one-shot 目标 bumpCycle 不发生任何变化', () => {
    const goal = makeGoal();
    expect(bumpCycle(goal, NOW)).toBe(goal);
  });
});

// ============================================================
// 评估落库
// ============================================================

describe('applyAssessment', () => {
  it('dry-run 下不改目标', () => {
    const goal = makeGoal();
    const r = applyAssessment(
      goal,
      { achieved: true, hasNewSituation: false, needsHuman: false },
      { dryRun: true, nowIso: NOW },
    );
    expect(r).toBeNull();
  });

  it('无目标时返回 null', () => {
    const r = applyAssessment(
      undefined,
      { achieved: true, hasNewSituation: false, needsHuman: false },
      { dryRun: false, nowIso: NOW },
    );
    expect(r).toBeNull();
  });

  it('one-shot 判定完成 → 只能到 pending_confirmation', () => {
    const goal = makeGoal();
    const r = applyAssessment(
      goal,
      { achieved: true, hasNewSituation: false, needsHuman: false, note: '归档了 12 个' },
      { dryRun: false, nowIso: NOW },
    );
    expect(r?.goal.status).toBe('pending_confirmation');
    expect(r?.effect).toBe('pending');
    // 关键：不是 achieved
    expect(r?.goal.status).not.toBe('achieved');
  });

  it('standing 判定完成 → 只加轮次，仍是 active', () => {
    const goal = makeStanding();
    const r = applyAssessment(
      goal,
      { achieved: true, hasNewSituation: false, needsHuman: false, note: '第 1 轮完成' },
      { dryRun: false, nowIso: NOW },
    );
    expect(r?.goal.status).toBe('active');
    expect(r?.goal.cycleCount).toBe(1);
    expect(r?.effect).toBe('cycle');
  });

  it('needsHuman 优先于 achieved（卡住比做完更需要被看见）', () => {
    const goal = makeGoal();
    const r = applyAssessment(
      goal,
      { achieved: true, hasNewSituation: true, needsHuman: true, note: '权限不足' },
      { dryRun: false, nowIso: NOW },
    );
    expect(r?.goal.status).toBe('blocked');
    expect(r?.effect).toBe('blocked');
  });

  it('只是有进展 → 只更新 progress', () => {
    const goal = makeGoal();
    const r = applyAssessment(
      goal,
      {
        achieved: false,
        hasNewSituation: true,
        needsHuman: false,
        note: '归档了 5 个文件',
        nextStep: '继续清理',
      },
      { dryRun: false, nowIso: NOW },
    );
    expect(r?.effect).toBe('progress');
    expect(r?.goal.progress).toBe('归档了 5 个文件');
    expect(r?.goal.nextStep).toBe('继续清理');
    expect(r?.goal.status).toBe('active');
  });

  it('已归档目标不再被评估影响', () => {
    const goal = makeGoal({ status: 'achieved' });
    const r = applyAssessment(
      goal,
      { achieved: false, hasNewSituation: true, needsHuman: false, note: 'x' },
      { dryRun: false, nowIso: NOW },
    );
    expect(r).toBeNull();
  });

  it('无实质内容时返回 null，不产生空更新', () => {
    const goal = makeGoal();
    const r = applyAssessment(
      goal,
      { achieved: false, hasNewSituation: false, needsHuman: false },
      { dryRun: false, nowIso: NOW },
    );
    expect(r).toBeNull();
  });
});

// ============================================================
// 评估解析
// ============================================================

describe('parseAssessment', () => {
  const wrap = (json: string) =>
    `做完了这些事。\n\n${ASSESSMENT_OPEN}\n${json}\n${ASSESSMENT_CLOSE}`;

  it('解析出评估并把评估块从正文剥掉', () => {
    const r = parseAssessment(
      wrap('{"achieved":true,"hasNewSituation":false,"needsHuman":false,"note":"完成"}'),
    );
    expect(r.assessment?.achieved).toBe(true);
    expect(r.text).toBe('做完了这些事。');
    expect(r.text).not.toContain(ASSESSMENT_OPEN);
  });

  it('容忍 ```json 包裹', () => {
    const r = parseAssessment(
      `正文\n${ASSESSMENT_OPEN}\n\`\`\`json\n{"achieved":false,"note":"x"}\n\`\`\`\n${ASSESSMENT_CLOSE}`,
    );
    expect(r.assessment?.achieved).toBe(false);
    expect(r.assessment?.note).toBe('x');
  });

  it('没有评估块时原文返回', () => {
    const r = parseAssessment('普通回答，没有评估');
    expect(r.assessment).toBeUndefined();
    expect(r.text).toBe('普通回答，没有评估');
  });

  it('JSON 坏了不抛错，只返回清理后的正文', () => {
    const r = parseAssessment(`${ASSESSMENT_OPEN}\n{不是合法json}\n${ASSESSMENT_CLOSE}`);
    expect(r.assessment).toBeUndefined();
    expect(r.text).toBe('');
  });

  it('缺字段时缺省为 false', () => {
    const r = parseAssessment(wrap('{}'));
    expect(r.assessment).toEqual({
      achieved: false,
      hasNewSituation: false,
      needsHuman: false,
      note: undefined,
      nextStep: undefined,
    });
  });

  it('只认 true，不把字符串 "true" 当成真', () => {
    const r = parseAssessment(wrap('{"achieved":"true"}'));
    expect(r.assessment?.achieved).toBe(false);
  });

  it('未闭合的评估块也能解析（模型漏写收尾）', () => {
    const r = parseAssessment(`正文\n${ASSESSMENT_OPEN}\n{"achieved":true}`);
    expect(r.assessment?.achieved).toBe(true);
  });

  it('note 过长会被截断', () => {
    const r = parseAssessment(wrap(JSON.stringify({ note: 'x'.repeat(1000) })));
    expect(r.assessment?.note?.length).toBeLessThanOrEqual(501); // 500 + 省略号
  });
});

// ============================================================
// 其他辅助
// ============================================================

describe('状态查询辅助', () => {
  it('isTerminal 只认 achieved / abandoned', () => {
    expect(isTerminal('achieved')).toBe(true);
    expect(isTerminal('abandoned')).toBe(true);
    expect(isTerminal('active')).toBe(false);
    expect(isTerminal('pending_confirmation')).toBe(false);
  });

  it('isLive 覆盖三种活目标', () => {
    expect(isLive('active')).toBe(true);
    expect(isLive('pending_confirmation')).toBe(true);
    expect(isLive('blocked')).toBe(true);
    expect(isLive('proposed')).toBe(false);
    expect(isLive('achieved')).toBe(false);
  });

  it('needsAttention 只在待确认与阻塞时为真', () => {
    expect(needsAttention(makeGoal({ status: 'pending_confirmation' }))).toBe(true);
    expect(needsAttention(makeGoal({ status: 'blocked' }))).toBe(true);
    expect(needsAttention(makeGoal({ status: 'active' }))).toBe(false);
    expect(needsAttention(undefined)).toBe(false);
  });

  it('标签中文正确', () => {
    expect(goalStatusLabel('pending_confirmation')).toBe('待你确认');
    expect(goalStatusLabel('active')).toBe('进行中');
    expect(goalTypeLabel('standing')).toBe('常驻守护');
    expect(goalTypeLabel('one-shot')).toBe('一次性');
  });
});

describe('createGoal', () => {
  it('空描述被拒', () => {
    expect(() => createGoal('g', { description: '   ' }, NOW)).toThrow(/不能为空/);
  });

  it('默认是 one-shot', () => {
    const g = createGoal('g', { description: '做事' }, NOW);
    expect(g.type).toBe('one-shot');
    expect(g.status).toBe('active');
    expect(g.cycleCount).toBeUndefined();
  });

  it('standing 初始化 cycleCount 为 0', () => {
    const g = createGoal('g', { description: '守着', type: 'standing' }, NOW);
    expect(g.cycleCount).toBe(0);
  });

  it('描述会被 trim', () => {
    const g = createGoal('g', { description: '  整理文件  ' }, NOW);
    expect(g.description).toBe('整理文件');
  });
});

describe('createProposal', () => {
  it('状态是 proposed 并记住来源', () => {
    const p = createProposal('g', { description: '接着做' }, 'goal_old', NOW);
    expect(p.status).toBe('proposed');
    expect(p.origin).toBe('goal_old');
  });

  it('候选也有明确进度文案（不会显示成空白）', () => {
    const p = createProposal('g', { description: '接着做' }, 'goal_old', NOW);
    expect(p.progress).toBeTruthy();
  });
});

describe('updateProgress', () => {
  it('只改传入的字段', () => {
    const g = makeGoal({ progress: '旧进展', nextStep: '旧的下一步' });
    const next = updateProgress(g, { progress: '新进展' }, NOW);
    expect(next.progress).toBe('新进展');
    expect(next.nextStep).toBe('旧的下一步');
    expect(next.status).toBe(g.status);
  });

  it('超长进展会截断', () => {
    const g = makeGoal();
    const next = updateProgress(g, { progress: 'x'.repeat(1000) }, NOW);
    expect(next.progress.length).toBeLessThanOrEqual(501);
  });

  it('evidence 最多保留 10 条', () => {
    const g = makeGoal();
    const next = updateProgress(
      g,
      { evidence: Array.from({ length: 20 }, (_, i) => `证据${i}`) },
      NOW,
    );
    expect(next.evidence).toHaveLength(10);
  });

  it('不修改入参', () => {
    const g = makeGoal({ progress: '旧' });
    updateProgress(g, { progress: '新' }, NOW);
    expect(g.progress).toBe('旧');
  });
});

describe('assertTransition 的错误信息可操作', () => {
  it('Bot 试图达成时提示改用 pending_confirmation', () => {
    expect(() => assertTransition('active', 'achieved', 'bot')).toThrow(
      /pending_confirmation/,
    );
  });

  it('人的非法迁移给出 from/to', () => {
    expect(() => assertTransition('proposed', 'achieved', 'human')).toThrow(
      /proposed.*achieved/,
    );
  });
});
