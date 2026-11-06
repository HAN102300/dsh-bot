/**
 * 错误码 → HTTP status 映射（v0.3.5 刀 4）
 *
 * 响应体不变，只改 status；这里锁死映射表，防止以后逐处自由发挥。
 */

import { describe, it, expect } from 'vitest';

import { statusForCode } from '../../src/api/routes.js';

const TABLE: Array<[string, number]> = [
  ['INVALID_ARGS', 400],
  ['INVALID_ROUTINE', 400],
  ['UNSUPPORTED_STEP', 400],
  ['ASSERT_FAILED', 400],
  ['GOAL_INVALID_TRANSITION', 400],
  ['GOAL_FORBIDDEN_WRITE', 400],
  ['UNKNOWN_TOOL', 400],
  ['PRECHECK_FAILED', 400],
  ['CONFIRM_REQUIRED', 400],
  ['BOT_NOT_FOUND', 404],
  ['GOAL_NOT_FOUND', 404],
  ['ROUTINE_NOT_FOUND', 404],
  ['BOT_EXISTS', 409],
  ['GOAL_ALREADY_EXISTS', 409],
  ['RUN_IN_PROGRESS', 409],
  ['DRY_RUN_BLOCKED', 409],
  ['BUDGET_EXCEEDED', 409],
  ['SANDBOX_VIOLATION', 403],
  ['TOOL_LOOP_LIMIT', 500],
  ['INTERNAL', 500],
  ['NOT_A_REAL_CODE', 500],
];

describe('statusForCode', () => {
  for (const [code, status] of TABLE) {
    it(`${code} → ${status}`, () => {
      expect(statusForCode(code)).toBe(status);
    });
  }
});
