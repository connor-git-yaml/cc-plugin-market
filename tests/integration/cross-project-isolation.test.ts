/**
 * Feature 140 T13 — 跨项目隔离集成测试（FR-015）
 *
 * 验证 4 个 fixture（empty-project / micrograd / nanoGPT / ky）下 spectra 产出的
 * ADR / hyperedges / narrative / module spec 互相隔离，无 hallucination 串台。
 *
 * **本文件实现策略**：4 个 fixture 均已落地（T10-T12），本测试用**契约层断言**覆盖：
 *  1. 4 个 fixture 目录存在且 fixture-meta.json 合规
 *  2. 各 fixture 的 expected.adrTitleContains / domainWords 互不相交（spec FR-015 核心
 *     反 hallucinate 不变量）
 *  3. fixture 文件结构符合 fixture-meta.json 声明
 *
 * **deferred（永久不做，Feature 272 裁决）**：曾以 `it.todo()` 占位的 5 条端到端用例中，
 * **4 条**——3 条「fixture micrograd/nanoGPT/ky → spectra batch 真实跑 → ADR 标题含
 * xxx」+ 1 条「FR-005 evidenceRef verified 占比 ≥ 90%（4 fixture 端到端）」——永久删除，
 * 断言的对象都是 **LLM 的语义产出**（ADR 标题/内容是否含特定领域词，或依赖真实 LLM
 * 调用产出的 evidenceRef 验证结果）。本仓所有 e2e 测试统一 `vi.mock('@anthropic-ai/sdk')`
 * （见 `tests/e2e/batch-pipeline.e2e.test.ts`），mock 出的"LLM 语义"是测试自己写进去的，
 * 填充这类用例只会得到断言恒真的表面工作，不是真实覆盖。这不是等待某个前置条件
 * 落地后就能填的临时阻塞，而是本仓测试基础设施（无真实 LLM 通道）下的结构性
 * 设计选择。非 LLM 部分的覆盖见本文件 case 1-6（fixture 结构 + 反 hallucinate
 * 词集合不相交契约）。
 *
 * **第 5 条保留（Feature 272 复核更正）**：「fixture empty-project → spectra batch
 * 真实跑 → 0 ADR + graph.html banner」断言的是**空输入下的缺席**（无源码可喂给 LLM，
 * ADR 数量为 0 与 LLM 说了什么无关）与 **graph.html banner 注入**（纯函数/文件系统
 * 产物判定），不依赖 LLM 语义输出，技术上可填充。保留为 `it.todo`，待有人写
 * mock-LLM 集成用例填充；填充属新增测试覆盖而非清淤，已移交后续卡。
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
  // 技术上可填充（断言空输入下的缺席/文件系统产物，不依赖 LLM 语义输出），
  // 待有人写 mock-LLM 集成用例填充；填充属新增测试覆盖而非清淤，已移交后续卡
  // （Feature 272 裁决⑥复核更正）。
  // ============================================================================
  it.todo('fixture empty-project → spectra batch 真实跑 → 0 ADR + graph.html banner');
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
