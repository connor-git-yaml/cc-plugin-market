/**
 * F217 T041 — 测试文件样本，符合 TsJsLanguageAdapter.getTestPatterns()
 * （filePattern: /\.(test|spec)\.(ts|tsx|js|jsx)$/）。
 */
import { GreeterService, formatGreeting } from './greeter-service';

describe('GreeterService', () => {
  it('formats greeting using the shared free function', () => {
    const service = new GreeterService();
    const result = service.greet('World');
    expect(result.message).toBe(formatGreeting('World'));
  });
});
