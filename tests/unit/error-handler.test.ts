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
  checkApiKey,
  checkAuth,
  handleError,
  EXIT_CODES,
} from '../../src/cli/utils/error-handler.js';

describe('error-handler', () => {
  const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['ANTHROPIC_API_KEY'];
  });

  it('validateTargetPath: 路径不存在返回 false', () => {
    const result = validateTargetPath('/definitely/not/exist');
    expect(result).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('checkApiKey: 未设置环境变量返回 false', () => {
    const result = checkApiKey();
    expect(result).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('checkApiKey: 已设置环境变量返回 true', () => {
    process.env['ANTHROPIC_API_KEY'] = 'sk-test';
    expect(checkApiKey()).toBe(true);
  });

  it('checkAuth: 有可用认证方式返回 true', () => {
    mocks.detectAuth.mockReturnValue({
      preferred: { type: 'api-key' },
      methods: [],
    });
    expect(checkAuth()).toBe(true);
  });

  it('checkAuth: 无可用认证方式返回 false', () => {
    mocks.detectAuth.mockReturnValue({
      preferred: null,
      methods: [],
    });
    expect(checkAuth()).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
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

