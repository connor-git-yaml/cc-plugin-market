/**
 * Feature 140 T18 — `--html` / `--no-html` CLI flag 解析测试
 *
 * spec FR-011：graph.html 始终生成（默认 true）；`--no-html` 显式 opt-out 路径
 * 修复 Codex review W1（CLI 缺失 opt-out flag）。
 */
import { describe, it, expect } from 'vitest';
import { parseArgs } from '../../src/cli/utils/parse-args.js';

describe('parseArgs --html / --no-html (Feature 140 T18)', () => {
  it('不传任何 flag 时 generateHtml = undefined（→ batch-orchestrator 用 ?? true 默认生成）', () => {
    const result = parseArgs(['batch']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.generateHtml).toBeUndefined();
    }
  });

  it('--html 显式 opt-in → generateHtml = true', () => {
    const result = parseArgs(['batch', '--html']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.generateHtml).toBe(true);
    }
  });

  it('--no-html 显式 opt-out → generateHtml = false', () => {
    const result = parseArgs(['batch', '--no-html']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.generateHtml).toBe(false);
    }
  });

  it('同时传 --html 和 --no-html 时，--no-html 优先（显式 opt-out 优先于 opt-in）', () => {
    // 这是 CLI 边界场景，确定行为优于隐式：选择"opt-out 胜出"语义，
    // 与 git --no-* 系列约定一致（显式 disable 优先级最高）。
    const result = parseArgs(['batch', '--html', '--no-html']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.generateHtml).toBe(false);
    }
  });

  it('反序传入：--no-html 在 --html 之前 → --no-html 仍优先（与顺序无关）', () => {
    // 修复 Codex 二轮 review W2：补充反序测试锁定"禁用优先而非最后 flag 胜出"合同。
    // 解析逻辑用 argv.includes()，与 flag 出现顺序无关，反序结果应一致。
    const result = parseArgs(['batch', '--no-html', '--html']);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.command.generateHtml).toBe(false);
    }
  });

  it('--no-html 在 batch 之外的子命令也能解析（通用 flag）', () => {
    // 当前只有 batch 接受该 flag，但解析器不应崩溃；
    // 即便没生效也不应导致 parseArgs 整体 ok=false。
    const result = parseArgs(['generate', 'src/foo.ts', '--no-html']);
    expect(result.ok).toBe(true);
  });
});
