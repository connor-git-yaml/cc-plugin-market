/**
 * Feature 162 Phase A T021 — assertNoSelfJudge hard-fail 单元测试（FR-027）
 *
 * 5 组 case 严格按 plan §2.2.3 表格：
 *   (a) driver=codex:gpt-5.5 + jury 含 codex:gpt-5.5             → throw, 错误信息含 gpt-5.5
 *   (b) driver=siliconflow:Pro/zai-org/GLM-5.1 + jury 含同 raw   → throw, normalized=glm-5.1
 *   (c) driver=codex:gpt-5.5 + jury=Codex:GPT-5.5 (大小写 + alias) → throw, normalized=gpt-5.5
 *   (d) jury 内部重复 [opus, opus, opus]                          → console.warn, 不 throw
 *   (e) driver=codex:gpt-5.5 + jury=[opus, glm-5.1, kimi-k2.6]    → 静默通过
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  assertNoSelfJudge,
  SelfJudgeError,
} from '../../scripts/lib/llm-backend-dispatcher.mjs';

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => { /* swallow */ });
});

afterEach(() => {
  warnSpy.mockRestore();
});

describe('assertNoSelfJudge — 5 case (FR-027)', () => {
  // (a) raw 命中 — 同 backend prefix 同 model
  it('(a) driver=codex:gpt-5.5 + jury 含 codex:gpt-5.5 → throw, 信息含 gpt-5.5', () => {
    const driver = 'codex:gpt-5.5';
    const judges = [
      'claude-cli:claude-opus-4-7',
      'codex:gpt-5.5',
      'siliconflow:Pro/moonshotai/Kimi-K2.6',
    ];
    expect(() => assertNoSelfJudge({ driver, judges })).toThrow(SelfJudgeError);
    try {
      assertNoSelfJudge({ driver, judges });
    } catch (e) {
      expect(e).toBeInstanceOf(SelfJudgeError);
      const err = e as SelfJudgeError;
      expect(err.normalized).toBe('gpt-5.5');
      expect(err.driverRaw).toBe('codex:gpt-5.5');
      expect(err.judgeRaw).toBe('codex:gpt-5.5');
      expect(err.message).toContain('gpt-5.5');
    }
  });

  // (b) vendor org prefix 剥除后命中
  it('(b) driver=siliconflow:Pro/zai-org/GLM-5.1 + jury 含同 raw → throw, normalized=glm-5.1', () => {
    const driver = 'siliconflow:Pro/zai-org/GLM-5.1';
    const judges = [
      'siliconflow:Pro/zai-org/GLM-5.1',
      'claude-cli:claude-opus-4-7',
    ];
    expect(() => assertNoSelfJudge({ driver, judges })).toThrow(SelfJudgeError);
    try {
      assertNoSelfJudge({ driver, judges });
    } catch (e) {
      const err = e as SelfJudgeError;
      expect(err.normalized).toBe('glm-5.1');
    }
  });

  // (c) 大小写 + alias 双重剥除（验证 normalize 顺序：先 case-fold 再剥 prefix）
  it('(c) driver=codex:gpt-5.5 + jury=Codex:GPT-5.5 (大小写 + alias) → throw, normalized=gpt-5.5', () => {
    const driver = 'codex:gpt-5.5';
    const judges = [
      'Codex:GPT-5.5',
      'claude-cli:claude-opus-4-7',
    ];
    expect(() => assertNoSelfJudge({ driver, judges })).toThrow(SelfJudgeError);
    try {
      assertNoSelfJudge({ driver, judges });
    } catch (e) {
      const err = e as SelfJudgeError;
      expect(err.normalized).toBe('gpt-5.5');
      expect(err.judgeRaw).toBe('Codex:GPT-5.5'); // 保留原始大小写在错误信息
    }
  });

  // (d) jury 内部重复 → console.warn 不 throw
  it('(d) jury 内部重复 [opus, glm-5.1, opus] → console.warn 不 throw', () => {
    const driver = 'codex:gpt-5.5';
    const judges = [
      'claude-cli:claude-opus-4-7',
      'siliconflow:Pro/zai-org/GLM-5.1',
      'claude-cli:claude-opus-4-7', // 重复 opus
    ];
    expect(() => assertNoSelfJudge({ driver, judges })).not.toThrow();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warnMsg = warnSpy.mock.calls[0][0] as string;
    expect(warnMsg).toContain('jury 内部重复');
    expect(warnMsg).toContain('claude-opus-4-7');
  });

  // (e) 完全无冲突 → 静默通过（无 warn 无 throw）
  it('(e) driver=codex:gpt-5.5 + jury=[opus, glm-5.1, kimi-k2.6] → 静默通过', () => {
    const driver = 'codex:gpt-5.5';
    const judges = [
      'claude-cli:claude-opus-4-7',
      'siliconflow:Pro/zai-org/GLM-5.1',
      'siliconflow:Pro/moonshotai/Kimi-K2.6',
    ];
    expect(() => assertNoSelfJudge({ driver, judges })).not.toThrow();
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
