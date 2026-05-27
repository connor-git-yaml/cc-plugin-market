/**
 * F170c T-RED-2 — driver E2E 占位文件（SC-002 + SC-004）
 *
 * 本文件包含 SC-002（impact 主动调用率 ≥ 50%）和 SC-004（chained call rate ≥ 33%）
 * 的占位测试。这些测试需要 host shell + Claude Max OAuth + SiliconFlow API key，
 * 在 sandboxed env 中无法跑通，因此默认 .skip。
 *
 * 在 host shell 中跑 T-VERIFY-6 / T-VERIFY-7 时手动去掉 .skip。
 */

import { describe, it } from 'vitest';

describe.skip('F170c SC-002 — driver 主动调用 impact ≥ 50%（host shell only）', () => {
  it('N=10 runs (5 task × 2 repeat) 中 ≥ 5 个 run 满足 Active Call 4 条规则', () => {
    // T-VERIFY-6 实施
    // 1. 准备 5 个不显式包含 "impact" / "mcp__plugin_spectra_spectra__impact" 的 task prompt
    // 2. 每个 task × 2 repeat = 10 runs，spawn `claude --print --model claude-sonnet-4-6` + spectra MCP
    // 3. 解析 stream-json 输出
    // 4. 统计满足 Active Call 4 条规则的 run 数量
    // 5. 断言 ≥ 5/10（50% primary pass gate）
    throw new Error('host shell only — see T-VERIFY-6');
  });
});

describe.skip('F170c SC-004 — chained call rate ≥ 33%（host shell only）', () => {
  it('N=3 SWE-Bench-Lite cohort C task 中 ≥ 1 个 task 出现合规 chain', () => {
    // T-VERIFY-7 实施
    // 1. 复用 F167 cohort C setup
    // 2. N=3 task，spawn driver + spectra MCP
    // 3. 解析 stream-json 中 MCP call sequence
    // 4. 按 Chained Call 4 条规则（顺序 + 不同工具 + 同源 task + active call）统计 chain
    // 5. 断言 ≥ 1/3 task 出现合规 chain（chain rate ≥ 33%）
    throw new Error('host shell only — see T-VERIFY-7');
  });
});
