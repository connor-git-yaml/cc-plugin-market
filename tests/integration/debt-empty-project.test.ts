/**
 * F3 集成测试：全空项目（双重降级）
 *
 * 仅 `hello.ts` 无注释 + 无任何 .md；预期 technical-debt.md 输出
 * "项目当前未识别出技术债"。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateDebtIntelligence } from '../../src/panoramic/pipelines/debt-intelligence-pipeline.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { TsJsLanguageAdapter } from '../../src/adapters/ts-js-adapter.js';
import { resetBlameCache } from '../../src/utils/git-blame.js';

describe('F3 集成：全空项目', () => {
  beforeEach(() => {
    resetBlameCache();
    LanguageAdapterRegistry.resetInstance();
    const r = LanguageAdapterRegistry.getInstance();
    r.register(new TsJsLanguageAdapter());
  });

  it('无任何 debt 时输出双重降级文案', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-empty-'));
    fs.writeFileSync(path.join(root, 'hello.ts'), 'export const x = 1;\n', 'utf-8');
    const specsDir = path.join(root, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });

    const res = await generateDebtIntelligence({
      projectRoot: root,
      specsDir,
      registry: LanguageAdapterRegistry.getInstance(),
    });
    expect(res.generated).toBe(true);
    expect(res.entriesCount).toBe(0);
    expect(res.openQuestionsCount).toBe(0);
    const md = fs.readFileSync(path.join(specsDir, 'project', 'technical-debt.md'), 'utf-8');
    expect(md).toContain('项目当前未识别出技术债');
  });
});
