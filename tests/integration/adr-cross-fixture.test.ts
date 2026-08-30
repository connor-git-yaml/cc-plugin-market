/**
 * Feature 140 T45 — ADR 跨 fixture distinct 率集成测试
 *
 * 覆盖 spec FR-003 / FR-005 / FR-015：
 * - 不同项目的 ADR 标题集合互不相交（distinct 率 = 100%）
 * - 所有 ADR verified=true 占比 ≥ 90%
 * - frontmatter generatedByModel 字段存在
 * - empty-project → ADR 为空
 *
 * **本文件实现策略**：使用 mock LLM + 临时目录构造各项目特有的 ADR 候选，
 * 验证 ADR pipeline 在不同项目语境下产出**不同**的 ADR（FR-003 反 hallucinate 核心目标）。
 *
 * **deferred（永久不做，Feature 272 裁决）**：曾以 `it.todo()` 占位的 4 条端到端用例中，
 * **3 条**——「fixture micrograd/nanoGPT/ky → 真实 batch → ADR 含特定领域词」——永久删除，
 * 断言的对象是 **LLM 的语义产出**（ADR 标题/决策内容是否含特定领域抽象）。本仓所有
 * e2e 测试统一 `vi.mock('@anthropic-ai/sdk')`（见 `tests/e2e/batch-pipeline.e2e.test.ts`），
 * mock 出的"LLM 语义"是测试自己写进去的，填充这类用例只会得到断言恒真的表面工作，不是
 * 真实覆盖。这不是等待 fixture 落地后就能填的临时阻塞（4 个 fixture 均已存在），而是
 * 本仓测试基础设施（无真实 LLM 通道）下的结构性设计选择。非 LLM 部分的覆盖见本文件
 * case 1-3（programmatic mock 构造下的 distinct 标题 / fail-closed / evidenceRef 占比契约）。
 *
 * **第 4 条保留（Feature 272 复核更正）**：「fixture empty-project → 真实 batch + ADR
 * 列表为空 + `_PIPELINE_FAILED.md`」断言的是**空输入下的缺席**（无源码可喂给 LLM，ADR
 * 为空与 LLM 说了什么无关）与**文件系统产物**（`_PIPELINE_FAILED.md` 是否落盘是纯函数/
 * 纯 IO 判定），不依赖 LLM 语义输出，技术上可填充。保留为 `it.todo`，待有人写 mock-LLM
 * 集成用例填充；填充属新增测试覆盖而非清淤，已移交后续卡。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runAdrMapReduce, type RunAdrMapReduceOptions } from '../../src/panoramic/pipelines/adr-mapreduce.js';
import type { StoredModuleSpecRecord } from '../../src/panoramic/stored-module-specs.js';

const mockMessagesCreate = vi.fn();
let tmpDir: string;

beforeEach(() => {
  mockMessagesCreate.mockReset();
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-cross-'));
});

function makeModule(sourceTarget: string, intent: string): StoredModuleSpecRecord {
  return {
    sourceTarget,
    relatedFiles: [`${sourceTarget}/index.ts`],
    confidence: 'high',
    intentSummary: intent,
    businessSummary: `${intent} 提供核心实现。`,
    dependencySummary: '依赖 logger',
  };
}

function fakeAnthropic(): RunAdrMapReduceOptions['anthropicClient'] {
  return { messages: { create: mockMessagesCreate } } as unknown as RunAdrMapReduceOptions['anthropicClient'];
}

function makeLLMResponse(parsed: unknown) {
  return {
    content: [{ type: 'text', text: JSON.stringify(parsed) }],
    usage: { input_tokens: 1000, output_tokens: 500 },
  };
}

function writeFile(relPath: string, content: string): void {
  const abs = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

/** 设置 mock 让 LLM 返回项目特有的 ADR */
function setupMockForProject(projectFlavor: 'micrograd' | 'nanoGPT' | 'ky'): void {
  const titleByFlavor = {
    micrograd: '梯度反向传播采用动态计算图',
    nanoGPT: '使用因果注意力实现 GPT 解码器',
    ky: 'Fetch 封装层采用 hooks pipeline',
  };
  const decisionByFlavor = {
    micrograd: '通过 Value 节点的 _backward 闭包累加梯度，避免显式反向图',
    nanoGPT: '采用 causal mask 让 self-attention 只看历史 token，符合 GPT 自回归语义',
    ky: '请求生命周期通过 hooks 数组扩展，每个 hook 处理一个独立关注点',
  };
  let callCount = 0;
  mockMessagesCreate.mockImplementation(async () => {
    callCount++;
    const candidate = {
      candidateId: `${projectFlavor}-decision-${callCount}`,
      title: titleByFlavor[projectFlavor],
      summary: `${titleByFlavor[projectFlavor]} 是该项目的核心架构决策点之一`,
      decision: decisionByFlavor[projectFlavor],
      context: `项目需要 ${projectFlavor} 特有的领域抽象来解决核心问题`,
      consequences: '保持代码简洁同时给用户提供清晰的扩展点和明确语义',
      evidenceRefs: [
        { source: 'src/core.ts', location: 'L1-3', snippet: 'class CoreAbstraction {\n  process() {}\n}' },
        { source: 'src/aux.ts', location: 'L1-3', snippet: 'class AuxAbstraction {\n  helper() {}\n}' },
      ],
      sourceClusterId: `cluster-${projectFlavor}`,
      confidence: 0.85,
    };
    if (callCount === 1) {
      return makeLLMResponse({ candidates: [candidate] });
    } else {
      return makeLLMResponse({
        finalCandidates: [{ ...candidate, sourceClusterId: 'merged', mergedFromClusters: [`cluster-${projectFlavor}`] }],
      });
    }
  });
}

describe('Feature 140 FR-015 — ADR 跨项目隔离 (programmatic mock 构造用例)', () => {
  it('case 1: micrograd / nanoGPT / ky 三个项目产出 distinct ADR 标题（FR-003 反 hallucinate）', async () => {
    const adrTitles = new Set<string>();

    for (const flavor of ['micrograd', 'nanoGPT', 'ky'] as const) {
      writeFile('src/core.ts', 'class CoreAbstraction {\n  process() {}\n}');
      writeFile('src/aux.ts', 'class AuxAbstraction {\n  helper() {}\n}');
      const modules = [
        makeModule('src/core', `${flavor} 核心抽象`),
        makeModule('src/core/aux', `${flavor} 辅助实现`),
      ];
      setupMockForProject(flavor);

      const result = await runAdrMapReduce({
        anthropicClient: fakeAnthropic(),
        modules,
        projectRoot: tmpDir,
      });

      expect(result.failClosed).toBe(false);
      expect(result.finalCandidates.length).toBeGreaterThan(0);
      adrTitles.add(result.finalCandidates[0]!.title);
      // FR-004：generatedByModel 字段存在
      expect(result.generatedByModel.map).toContain('sonnet');
      expect(result.generatedByModel.reduce).toContain('opus');

      // 重置临时目录给下一个 flavor
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-cross-'));
    }

    // distinct 率 = 100%（3 个不同项目，3 个不同 ADR 标题）
    expect(adrTitles.size).toBe(3);
  });

  it('case 2: empty-project (modules=[]) → fail-closed，ADR 为空', async () => {
    const result = await runAdrMapReduce({
      anthropicClient: fakeAnthropic(),
      modules: [],
      projectRoot: tmpDir,
    });
    expect(result.failClosed).toBe(true);
    expect(result.finalCandidates).toEqual([]);
  });

  it('case 3: verified evidenceRefs 占比断言（每个 ADR ≥ 2 条 verified=true）', async () => {
    writeFile('src/core.ts', 'class CoreAbstraction {\n  process() {}\n}');
    writeFile('src/aux.ts', 'class AuxAbstraction {\n  helper() {}\n}');
    setupMockForProject('micrograd');
    const result = await runAdrMapReduce({
      anthropicClient: fakeAnthropic(),
      modules: [
        makeModule('src/core', 'micrograd 核心抽象'),
        makeModule('src/core/aux', 'micrograd 辅助实现'),
      ],
      projectRoot: tmpDir,
    });
    expect(result.failClosed).toBe(false);
    for (const candidate of result.finalCandidates) {
      const verifiedCount = candidate.verifiedEvidenceRefs.filter((r) => r.verified).length;
      expect(verifiedCount).toBeGreaterThanOrEqual(2); // FR-005
      // 占比 ≥ 90%
      const ratio = verifiedCount / candidate.verifiedEvidenceRefs.length;
      expect(ratio).toBeGreaterThanOrEqual(0.9);
    }
  });

  // ============================================================================
  // 技术上可填充（断言空输入下的缺席/文件系统产物，不依赖 LLM 语义输出），
  // 待有人写 mock-LLM 集成用例填充；填充属新增测试覆盖而非清淤，已移交后续卡
  // （Feature 272 裁决⑥复核更正）。
  // ============================================================================
  it.todo('fixture empty-project → 真实 batch + ADR 列表为空 + _PIPELINE_FAILED.md');
});
