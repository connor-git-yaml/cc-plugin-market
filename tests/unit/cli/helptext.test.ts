/**
 * F183 修复 4：CLI 帮助文本校正断言（T-04）
 *
 * 校正 code-only 描述，移除误导文案（「无 LLM」「< 30s」「最快」「纯 AST」）。
 * 用静态源码断言验证文案不含误导字符串（Codex W-1：纯定性，不写具体耗时数字）。
 *
 * F195 起：graph-only 描述行已落地（SC-003c），下方断言由「不得新增」翻转为
 * 「必须含 graph-only / 纯 AST / 零 LLM」。
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

  it('cli/index.ts 的 --mode 帮助文本含 graph-only / 纯 AST / 零 LLM（F195 SC-003c）', () => {
    const src = readFileSync(join(root, 'src/cli/index.ts'), 'utf8');
    expect(src).toContain('graph-only');
    expect(src).toContain('纯 AST');
    expect(src).toContain('零 LLM');
  });

  it('synopsis 行包含全部 4 个 mode 值（定点断言，F186 T6）', () => {
    const src = readFileSync(join(root, 'src/cli/index.ts'), 'utf8');
    // 定位 synopsis 行：含 `spectra batch` 且含 `--mode` 的行
    const synopsisLine = src
      .split('\n')
      .find((line) => line.includes('spectra batch') && line.includes('--mode'));
    expect(synopsisLine, '应存在 `spectra batch ... --mode ...` synopsis 行').toBeDefined();
    // synopsis 行必须列全 4 个 mode 值，与详细行对齐，防止再次漂移
    expect(synopsisLine).toContain('full');
    expect(synopsisLine).toContain('reading');
    expect(synopsisLine).toContain('code-only');
    expect(synopsisLine).toContain('graph-only');
  });
});
