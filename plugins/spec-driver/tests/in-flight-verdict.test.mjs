/**
 * in-flight-verdict.test.mjs
 * F270 P3 — background_tasks 在途三态判定（T301）
 *
 * Tests FIRST：先于 in-flight-verdict.mjs 存在，import 失败即红。
 * 三态（C-2 / FR-014/015）：
 *   in-flight     ← background_tasks 存在且非空数组
 *   no-in-flight  ← background_tasks 存在且为空数组
 *   undetermined  ← background_tasks 键缺席（toolUseContext 为空时与 session_crons 同生共死）
 * 承重判据只用结构性事实（键是否存在、数组是否非空）；type/description 只进人类可读诊断。
 *
 * 运行: node --test plugins/spec-driver/tests/in-flight-verdict.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { classifyInFlightFromPayload, IN_FLIGHT_STATES } from '../scripts/lib/in-flight-verdict.mjs';

describe('F270 P3 · classifyInFlightFromPayload 三态', () => {
  it('非空 background_tasks → in-flight', () => {
    const v = classifyInFlightFromPayload({
      session_id: 's',
      background_tasks: [{ id: 'a1', type: 'subagent', status: 'running', description: '跑测试', agent_type: 'Explore' }],
      session_crons: [],
    });
    assert.equal(v.state, IN_FLIGHT_STATES.IN_FLIGHT);
    assert.equal(v.count, 1);
  });

  it('空数组 background_tasks → no-in-flight', () => {
    const v = classifyInFlightFromPayload({ session_id: 's', background_tasks: [], session_crons: [] });
    assert.equal(v.state, IN_FLIGHT_STATES.NO_IN_FLIGHT);
    assert.equal(v.count, 0);
  });

  it('🔴 键整体缺席 → undetermined（不得坍缩为 no-in-flight）', () => {
    const v = classifyInFlightFromPayload({ session_id: 's' });
    assert.equal(v.state, IN_FLIGHT_STATES.UNDETERMINED);
    assert.notEqual(v.state, IN_FLIGHT_STATES.NO_IN_FLIGHT, '缺席≠空，坍缩即恢复误 block');
  });

  it('undetermined 有独立诊断码', () => {
    const v = classifyInFlightFromPayload({ session_id: 's' });
    assert.ok(typeof v.diagnostic === 'string' && v.diagnostic.length > 0);
    const empty = classifyInFlightFromPayload({ session_id: 's', background_tasks: [] });
    assert.notEqual(v.diagnostic, empty.diagnostic, 'undetermined 与 no-in-flight 诊断码不同');
  });

  it('type 为未知/含空格值（"MCP task"）不影响判定结论（C-8/T-1）', () => {
    const v = classifyInFlightFromPayload({
      session_id: 's',
      background_tasks: [{ id: 'a1', type: 'MCP task', status: 'running', description: 'x' }],
    });
    assert.equal(v.state, IN_FLIGHT_STATES.IN_FLIGHT);
    // 人类可读诊断可含 type，但判定结论只看数组非空
    assert.equal(v.count, 1);
  });

  it('非数组 background_tasks（harness 改型 null/{}/字符串）→ undetermined（非承重值一律保守）', () => {
    for (const bad of [null, {}, 'weird', 42, true]) {
      const v = classifyInFlightFromPayload({ session_id: 's', background_tasks: bad });
      assert.equal(v.state, IN_FLIGHT_STATES.UNDETERMINED, `bad=${JSON.stringify(bad)} 须归 undetermined`);
    }
  });

  it('payload 非对象 → undetermined（不抛）', () => {
    for (const bad of [null, undefined, 'x', 42]) {
      const v = classifyInFlightFromPayload(bad);
      assert.equal(v.state, IN_FLIGHT_STATES.UNDETERMINED);
    }
  });

  it('人类可读描述引用 type/description 但容忍缺失', () => {
    const v = classifyInFlightFromPayload({
      session_id: 's',
      background_tasks: [{ id: 'a1', status: 'running' }],
    });
    assert.equal(v.state, IN_FLIGHT_STATES.IN_FLIGHT);
    assert.equal(typeof v.humanReadable, 'string');
  });
});
