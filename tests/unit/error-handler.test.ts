/**
 * error-handler 单元测试
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  detectAuth: vi.fn(),
}));

vi.mock('../../src/auth/auth-detector.js', () => ({
  detectAuth: mocks.detectAuth,
}));

import {
  validateTargetPath,
  resolveAuthGate,
  handleError,
  EXIT_CODES,
} from '../../src/cli/utils/error-handler.js';

describe('error-handler', () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('validateTargetPath: 路径不存在返回 false', () => {
    const result = validateTargetPath('/definitely/not/exist');
    expect(result).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  // Feature 222：零认证默认降级放行，--require-llm 才阻断。
  // resolveAuthGate 是唯一门控入口（checkAuth 已删除），认证探测的 true/false 两条分支
  // 由下面这组用例覆盖。
  it('resolveAuthGate: 有认证时放行且无任何提示副作用', () => {
    mocks.detectAuth.mockReturnValue({
      preferred: { type: 'api-key' },
      methods: [],
    });
    expect(resolveAuthGate(false)).toBe(true);
    expect(resolveAuthGate(true)).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('resolveAuthGate: 无认证 + requireLlm=false 时放行并提示降级', () => {
    mocks.detectAuth.mockReturnValue({ preferred: null, methods: [] });
    expect(resolveAuthGate(false)).toBe(true);
    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('AST-only');
    expect(warned).toContain('--require-llm');
  });

  // 回归防线：降级是成功路径，不得吐 `✗ 错误` 到 stderr（否则 CI 日志会误判失败）
  it('resolveAuthGate: 无认证 + requireLlm=false 时不得打印任何致命错误', () => {
    mocks.detectAuth.mockReturnValue({ preferred: null, methods: [] });
    expect(resolveAuthGate(false)).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('resolveAuthGate: 无认证 + requireLlm=true 时阻断且不打降级提示', () => {
    mocks.detectAuth.mockReturnValue({ preferred: null, methods: [] });
    expect(resolveAuthGate(true)).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // 降级形态因命令而异（如 diff 并不产出 AST-only spec），提示必须能按命令定制
  it('resolveAuthGate: 传入自定义降级描述时提示采用该描述而非默认 AST-only 文案', () => {
    mocks.detectAuth.mockReturnValue({ preferred: null, methods: [] });
    expect(resolveAuthGate(false, '本次将跳过 LLM 语义评估，仅进行结构漂移检测')).toBe(true);
    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('跳过 LLM 语义评估');
    expect(warned).not.toContain('AST-only');
    expect(warned).toContain('--require-llm');
  });

  it('handleError: API 错误返回 API_ERROR', () => {
    const code = handleError(new Error('API authentication failed'));
    expect(code).toBe(EXIT_CODES.API_ERROR);
  });

  it('handleError: ENOENT 错误返回 TARGET_ERROR', () => {
    const err = Object.assign(new Error('not found'), { code: 'ENOENT' });
    const code = handleError(err);
    expect(code).toBe(EXIT_CODES.TARGET_ERROR);
  });

  it('handleError: 非 Error 对象返回 API_ERROR', () => {
    const code = handleError('unknown');
    expect(code).toBe(EXIT_CODES.API_ERROR);
  });
});

