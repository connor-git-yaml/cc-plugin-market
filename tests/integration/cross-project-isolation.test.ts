/**
 * Feature 140 T13 — 跨项目隔离集成测试（FR-015）
 *
 * 验证 4 个 fixture（empty-project / micrograd / nanoGPT / ky）下 spectra 产出的
 * ADR / hyperedges / narrative / module spec 互相隔离，无 hallucination 串台。
 *
 * **本 step 实现策略**：fixture 已落地（T10-T12），但本测试不直接驱动完整 batch
 * pipeline（需要真实 LLM 调用 + 复杂 mock 链）。改为**契约层断言**：
 *  1. 4 个 fixture 目录存在且 fixture-meta.json 合规
 *  2. 各 fixture 的 expected.adrTitleContains / domainWords 互不相交（spec FR-015 核心
 *     反 hallucinate 不变量）
 *  3. fixture 文件结构符合 fixture-meta.json 声明
 *
 * **fixture-based 端到端 batch**（实际跑 spectra batch + LLM mock）留 it.todo()，
 * 在 Step 2 / Step 4 真实接通 anthropicClient 之后由 user 手动驱动 T51。
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const FIXTURE_ROOT = path.resolve(__dirname, '..', 'fixtures');
const FIXTURES = ['empty-project', 'micrograd', 'nanoGPT', 'ky'] as const;

interface FixtureMeta {
  name: string;
  language: string;
  modules: number;
  expected: {
    graphHtmlBanner?: boolean;
    hyperedgesCount?: string | number;
    adrCount?: number;
    adrTitleContains?: string[];
    domainWords?: string[];
  };
}

function loadFixtureMeta(name: string): FixtureMeta {
  const metaPath = path.join(FIXTURE_ROOT, name, 'fixture-meta.json');
  const content = fs.readFileSync(metaPath, 'utf-8');
  return JSON.parse(content) as FixtureMeta;
}

describe('Feature 140 FR-015 — 4 fixture 跨项目隔离契约', () => {
  it('case 1: 4 个 fixture 目录都存在且含 fixture-meta.json', () => {
    for (const name of FIXTURES) {
      const dir = path.join(FIXTURE_ROOT, name);
      const metaPath = path.join(dir, 'fixture-meta.json');
      expect(fs.existsSync(dir), `fixture dir missing: ${name}`).toBe(true);
      expect(fs.existsSync(metaPath), `fixture-meta missing: ${name}`).toBe(true);
    }
  });

  it('case 2: 每个 fixture 都含 README.md（最小合法项目）', () => {
    for (const name of FIXTURES) {
      const readmePath = path.join(FIXTURE_ROOT, name, 'README.md');
      expect(fs.existsSync(readmePath), `README missing: ${name}`).toBe(true);
      const content = fs.readFileSync(readmePath, 'utf-8');
      expect(content.length).toBeGreaterThan(20);
    }
  });

  it('case 3: 各 fixture 的 ADR 标题预期词互不相交（FR-015 反 hallucinate 不变量）', () => {
    const titleSets: Record<string, Set<string>> = {};
    for (const name of FIXTURES) {
      const meta = loadFixtureMeta(name);
      titleSets[name] = new Set(meta.expected.adrTitleContains ?? []);
    }
    // empty-project 期望 ADR=0，没有 adrTitleContains，跳过
    const fixtures = ['micrograd', 'nanoGPT', 'ky'] as const;
    for (let i = 0; i < fixtures.length; i++) {
      for (let j = i + 1; j < fixtures.length; j++) {
        const a = titleSets[fixtures[i]!]!;
        const b = titleSets[fixtures[j]!]!;
        const intersection = [...a].filter((w) => b.has(w));
        expect(
          intersection.length,
          `${fixtures[i]} 与 ${fixtures[j]} 的 ADR 标题词集合应互不相交，发现重叠: ${intersection.join(', ')}`,
        ).toBe(0);
      }
    }
  });

  it('case 4: 各 fixture 的 domainWords 互不相交（项目特有抽象名）', () => {
    const wordSets: Record<string, Set<string>> = {};
    for (const name of FIXTURES) {
      const meta = loadFixtureMeta(name);
      wordSets[name] = new Set(meta.expected.domainWords ?? []);
    }
    // 比较有 domainWords 的 fixture（empty-project 没有）
    const named = ['micrograd', 'nanoGPT', 'ky'] as const;
    for (let i = 0; i < named.length; i++) {
      for (let j = i + 1; j < named.length; j++) {
        const a = wordSets[named[i]!]!;
        const b = wordSets[named[j]!]!;
        const overlap = [...a].filter((w) => b.has(w));
        expect(
          overlap.length,
          `${named[i]} 与 ${named[j]} 的 domainWords 应互不相交，发现重叠: ${overlap.join(', ')}`,
        ).toBe(0);
      }
    }
  });

  it('case 5: fixture-meta 声明的 modules 数与实际源文件数大致对齐（≥1 个 source 文件）', () => {
    // micrograd: __init__.py / engine.py / nn.py = 3 个 .py + README + meta
    // nanoGPT: __init__.py / model.py / train.py / bench.py = 4 个 .py + README + meta
    // ky: src/types.ts / src/retrier.ts / src/core.ts / src/index.ts = 4 个 .ts + README + meta
    // empty-project: 仅 README + meta
    const expectedSourceFiles: Record<string, { ext: string; min: number }> = {
      'micrograd': { ext: '.py', min: 3 },
      'nanoGPT': { ext: '.py', min: 4 },
      'ky': { ext: '.ts', min: 4 },
      'empty-project': { ext: '.md', min: 1 },
    };
    for (const name of FIXTURES) {
      const expected = expectedSourceFiles[name]!;
      const sourceCount = countFilesByExt(path.join(FIXTURE_ROOT, name), expected.ext);
      expect(sourceCount, `${name} 应有 ≥${expected.min} 个 ${expected.ext} 源文件`).toBeGreaterThanOrEqual(expected.min);
    }
  });

  it('case 6: empty-project fixture 期望 graphHtmlBanner=true / adrCount=0 / hyperedgesCount=0', () => {
    const meta = loadFixtureMeta('empty-project');
    expect(meta.expected.graphHtmlBanner).toBe(true);
    expect(meta.expected.hyperedgesCount).toBe(0);
    expect(meta.expected.adrCount).toBe(0);
  });

  // ============================================================================
  // 端到端 batch case 留待 user 手动验证 T51（3 fresh 项目）+ Step 8 release 时启用
  // ============================================================================
  it.todo('fixture micrograd → spectra batch 真实跑 → ADR 标题含 "Value/Neuron/MLP"');
  it.todo('fixture nanoGPT → spectra batch 真实跑 → ADR 含 causal attention 决策');
  it.todo('fixture ky → spectra batch 真实跑 → ADR 含 hooks pipeline 决策');
  it.todo('fixture empty-project → spectra batch 真实跑 → 0 ADR + graph.html banner');
  it.todo('FR-005 evidenceRef verified=true 占比 ≥ 90%（4 fixture 端到端）');
});

function countFilesByExt(dir: string, ext: string): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      count += countFilesByExt(path.join(dir, entry.name), ext);
    } else if (entry.isFile() && entry.name.endsWith(ext)) {
      count++;
    }
  }
  return count;
}
