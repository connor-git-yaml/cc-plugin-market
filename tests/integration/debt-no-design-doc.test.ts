/**
 * F3 集成测试：只有代码 TODO，无 design-doc
 *
 * 预期：代码债务节有条目，design-doc 节输出 "未识别出开放问题"。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { generateDebtIntelligence } from '../../src/panoramic/pipelines/debt-intelligence-pipeline.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { TsJsLanguageAdapter } from '../../src/adapters/ts-js-adapter.js';
import { resetBlameCache } from '../../src/utils/git-blame.js';

describe('F3 集成：无 design-doc 项目', () => {
  beforeEach(() => {
    resetBlameCache();
    LanguageAdapterRegistry.resetInstance();
    const r = LanguageAdapterRegistry.getInstance();
    r.register(new TsJsLanguageAdapter());
  });

  it('代码有 TODO 但无 design-doc 时开放问题节明确为空', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'debt-no-md-'));
    fs.writeFileSync(
      path.join(root, 'foo.ts'),
      ['// TODO: implement', '// FIXME: critical bug', 'export const x = 1;'].join('\n'),
      'utf-8',
    );
    const specsDir = path.join(root, 'specs');
    fs.mkdirSync(specsDir, { recursive: true });

    const res = await generateDebtIntelligence({
      projectRoot: root,
      specsDir,
      registry: LanguageAdapterRegistry.getInstance(),
    });
    expect(res.generated).toBe(true);
    expect(res.entriesCount).toBe(2);
    expect(res.openQuestionsCount).toBe(0);

    const md = fs.readFileSync(path.join(specsDir, 'project', 'technical-debt.md'), 'utf-8');
    expect(md).toContain('TODO');
    expect(md).toContain('FIXME');
    expect(md).toContain('未识别出开放问题');
  });
});
