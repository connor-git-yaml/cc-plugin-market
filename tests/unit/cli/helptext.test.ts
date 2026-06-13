/**
 * F183 修复 4：CLI 帮助文本校正断言（T-04）
 *
 * 校正 code-only 描述，移除误导文案（「无 LLM」「< 30s」「最快」「纯 AST」）。
 * 用静态源码断言验证文案不含误导字符串（Codex W-1：纯定性，不写具体耗时数字）。
 * 红线：不新增 graph-only 描述行（归 F195）。
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = join(__dirname, '..', '..', '..');

describe('CLI 帮助文本不含误导文案（T-04）', () => {
  it('cli/index.ts 的 mode 帮助文本不含「无 LLM」', () => {
    const src = readFileSync(join(root, 'src/cli/index.ts'), 'utf8');
    expect(src).not.toContain('无 LLM');
  });

  it('cli/index.ts 的 mode 帮助文本不含「< 30s」', () => {
    const src = readFileSync(join(root, 'src/cli/index.ts'), 'utf8');
    expect(src).not.toContain('< 30s');
  });

  it('batch.ts TTY hint 不含「< 30s」', () => {
    const src = readFileSync(join(root, 'src/cli/commands/batch.ts'), 'utf8');
    expect(src).not.toContain('< 30s');
  });

  it('cli/index.ts 不新增 graph-only 描述行（归 F195）', () => {
    const src = readFileSync(join(root, 'src/cli/index.ts'), 'utf8');
    expect(src).not.toContain('graph-only');
  });
});
