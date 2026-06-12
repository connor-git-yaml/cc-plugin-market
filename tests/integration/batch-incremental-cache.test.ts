/**
 * Feature 182 — 增量缓存正确性 E2E 回归护栏
 *
 * 结构铁律（上一轮假绿根因修复）：
 * - 禁止 mock single-spec-orchestrator / generateSpec —— 必须让真实写侧
 *   prepareContext → combineSkeletonHashes → frontmatter → 写盘 链路执行，
 *   再由读侧 delta 判定对账，才能测出 hash 公式分叉。
 * - 仅在 LLM 边界 mock（callLLM）：保留 llm-client 其余真实导出，只替换网络调用。
 * - 期望 hash 一律从真实落盘 frontmatter 读取对账，不复刻实现公式合成 fixture。
 *
 * 场景 A：含 PascalCase 组件文件的目录增量第二轮零重生成（混合大小写）
 *   —— Widget.ts(W=87) 与 apple.ts(a=97) 在 code-unit 序与 localeCompare 序相反，
 *      旧读写公式分叉必然 cache miss；修复后第二轮 LLM 调用 = 0。
 * 场景 B：同目录 Python + TypeScript 混语言增量第二轮各语言组各零重生成
 *   —— language-split 两组共享同一 dirPath，旧 sourceTarget 碰撞 + 目录重扫双倍分析；
 *      修复后首轮产出 2 份 spec 且各组只分析本语言文件，第二轮 LLM 调用 = 0。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// 仅 mock LLM 边界：保留 llm-client 真实导出（parseLLMResponse / 错误类型等），只替换 callLLM。
const llmMocks = vi.hoisted(() => ({ callLLM: vi.fn() }));

vi.mock('../../src/core/llm-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/core/llm-client.js')>();
  return { ...actual, callLLM: llmMocks.callLLM };
});

import { bootstrapAdapters } from '../../src/adapters/index.js';
import { LanguageAdapterRegistry } from '../../src/adapters/language-adapter-registry.js';
import { runBatch } from '../../src/batch/batch-orchestrator.js';

/** 9 段式占位响应：保证 parseLLMResponse 提取到非空章节（不依赖真实 LLM 质量）。 */
function buildLLMContent(): string {
  return [
    '## 1. 意图\n本模块提供测试用途的纯函数集合。',
    '## 2. 业务逻辑\n对输入做最小化处理后返回。',
    '## 3. 接口定义\n导出若干工具函数。',
    '## 4. 数据结构\n无复杂数据结构。',
    '## 5. 约束条件\n输入须为字符串。',
    '## 6. 边界条件\n空输入返回空串。',
    '## 7. 技术债务\n无。',
    '## 8. 测试覆盖\n由集成测试覆盖。',
    '## 9. 依赖关系\n无外部依赖。',
  ].join('\n\n');
}

function makeLLMResponse() {
  return {
    content: buildLLMContent(),
    model: 'mock-model',
    inputTokens: 100,
    outputTokens: 200,
    duration: 1,
  };
}

/** 从落盘 spec 的 frontmatter 读取字段值（如 skeletonHash / sourceTargetKey）。 */
function readFrontmatterField(specPath: string, field: string): string | undefined {
  const content = fs.readFileSync(specPath, 'utf-8');
  const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/m.exec(content);
  if (!fmMatch?.[1]) return undefined;
  for (const line of fmMatch[1].split(/\r?\n/)) {
    if (line.startsWith(`${field}:`)) {
      return line.slice(`${field}:`.length).trim();
    }
  }
  return undefined;
}

describe('Feature 182 — 增量缓存正确性 E2E（真实写侧产物对账）', () => {
  let projectRoot: string;

  beforeEach(() => {
    LanguageAdapterRegistry.resetInstance();
    bootstrapAdapters();
    llmMocks.callLLM.mockReset();
    llmMocks.callLLM.mockImplementation(async () => makeLLMResponse());

    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-incremental-cache-'));
    fs.writeFileSync(
      path.join(projectRoot, 'tsconfig.json'),
      JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext' } }, null, 2),
      'utf-8',
    );
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    LanguageAdapterRegistry.resetInstance();
    vi.clearAllMocks();
  });

  it('用户故事: 含混合大小写文件名的目录增量第二轮零重生成', async () => {
    // Widget.ts(W=87) < apple.ts(a=97) in code-unit；localeCompare 下 apple < Widget —— 两序相反。
    const componentsDir = path.join(projectRoot, 'src', 'components');
    fs.mkdirSync(componentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(componentsDir, 'Widget.ts'),
      'export function renderWidget(label: string): string {\n  return `<${label}>`;\n}\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(componentsDir, 'apple.ts'),
      'export function makeApple(size: number): number {\n  return size * 2;\n}\n',
      'utf-8',
    );

    // 第一轮：全量 force，真实写侧产出 spec
    const firstRun = await runBatch(projectRoot, { force: true, maxRetries: 1 });
    expect(firstRun.failed).toHaveLength(0);

    const specPath = path.join(projectRoot, 'specs', 'modules', 'components.spec.md');
    expect(fs.existsSync(specPath)).toBe(true);

    // 从真实落盘 frontmatter 读取 skeletonHash（对账写侧产物，不自算）
    const writtenHash = readFrontmatterField(specPath, 'skeletonHash');
    expect(writtenHash).toMatch(/^[0-9a-f]{64}$/);

    const specContentBefore = fs.readFileSync(specPath, 'utf-8');

    // 第二轮：内容不改，增量重跑，统计 LLM 调用
    llmMocks.callLLM.mockClear();
    const secondRun = await runBatch(projectRoot, { incremental: true, maxRetries: 1 });

    expect(secondRun.failed).toHaveLength(0);
    // 零重生成：第二轮无任何 LLM 调用，components 走 skip
    expect(llmMocks.callLLM).toHaveBeenCalledTimes(0);
    expect(secondRun.skipped).toContain('components');

    // spec 文件内容不变
    expect(fs.readFileSync(specPath, 'utf-8')).toBe(specContentBefore);
  });

  it('用户故事: 同目录 Python + TypeScript 混语言增量第二轮零重生成', async () => {
    // 同目录单文件双语言：language-split 两组（languageSplit=true），各组单文件 + dirPath 冲突
    // → resolveSourceTarget 降级为文件路径，cache key 带语言后缀承载唯一性。
    const utilsDir = path.join(projectRoot, 'src', 'utils');
    fs.mkdirSync(utilsDir, { recursive: true });
    fs.writeFileSync(
      path.join(utilsDir, 'service.ts'),
      'export function tsHelper(x: string): string {\n  return x.trim();\n}\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(utilsDir, 'worker.py'),
      'def py_helper(value):\n    return value.strip()\n',
      'utf-8',
    );

    // 第一轮：全量 force
    const firstRun = await runBatch(projectRoot, { force: true, maxRetries: 1 });
    expect(firstRun.failed).toHaveLength(0);
    expect(firstRun.successful).toContain('utils--ts-js');
    expect(firstRun.successful).toContain('utils--python');

    // language-split 产出 2 份独立 spec（Feature 182 修复 1：按 moduleName 命名，非 basename）
    const tsSpecPath = path.join(projectRoot, 'specs', 'modules', 'utils--ts-js.spec.md');
    const pySpecPath = path.join(projectRoot, 'specs', 'modules', 'utils--python.spec.md');
    expect(fs.existsSync(tsSpecPath)).toBe(true);
    expect(fs.existsSync(pySpecPath)).toBe(true);

    // files 注入生效：各组只分析本语言文件（relatedFiles 互不含对方语言文件）
    const tsContent = fs.readFileSync(tsSpecPath, 'utf-8');
    const pyContent = fs.readFileSync(pySpecPath, 'utf-8');
    expect(tsContent).toContain('service.ts');
    expect(tsContent).not.toContain('worker.py');
    expect(pyContent).toContain('worker.py');
    expect(pyContent).not.toContain('service.ts');

    // sourceTargetKey 持久化（带语言后缀）；sourceTarget 自身保持纯路径（无 `::language`）
    expect(readFrontmatterField(tsSpecPath, 'sourceTargetKey')).toBe('src/utils/service.ts::ts-js');
    expect(readFrontmatterField(pySpecPath, 'sourceTargetKey')).toBe('src/utils/worker.py::python');
    expect(readFrontmatterField(tsSpecPath, 'sourceTarget')).toBe('src/utils/service.ts');
    expect(readFrontmatterField(pySpecPath, 'sourceTarget')).toBe('src/utils/worker.py');

    const tsBefore = fs.readFileSync(tsSpecPath, 'utf-8');
    const pyBefore = fs.readFileSync(pySpecPath, 'utf-8');

    // 第二轮：内容不改，增量重跑
    llmMocks.callLLM.mockClear();
    const secondRun = await runBatch(projectRoot, { incremental: true, maxRetries: 1 });

    expect(secondRun.failed).toHaveLength(0);
    // 两组均 skip：第二轮零 LLM 调用
    expect(llmMocks.callLLM).toHaveBeenCalledTimes(0);
    expect(secondRun.skipped).toContain('utils--ts-js');
    expect(secondRun.skipped).toContain('utils--python');

    // spec 文件内容不变
    expect(fs.readFileSync(tsSpecPath, 'utf-8')).toBe(tsBefore);
    expect(fs.readFileSync(pySpecPath, 'utf-8')).toBe(pyBefore);
  });

  it('用户故事: 同目录多文件混语言（目录级分组）增量第二轮零重生成', async () => {
    // 真正的 dirPath 碰撞 case（区别于场景 B 的单文件降级）：
    //   src/utils/ 下 ts 组 2 文件（service.ts + extra.ts）→ files.length>1 → 不降级 → sourceTarget=src/utils（目录级）
    //   py 组 1 文件（worker.py）但 dirPath 单文件计数=1（非 conflictingDirPaths）→ 同样 sourceTarget=src/utils（目录级）
    // 两组共享纯路径 src/utils，仅靠 buildSpecCacheKey 的 `::language` 后缀去碰撞。
    const utilsDir = path.join(projectRoot, 'src', 'utils');
    fs.mkdirSync(utilsDir, { recursive: true });
    fs.writeFileSync(
      path.join(utilsDir, 'service.ts'),
      'export function tsHelper(x: string): string {\n  return x.trim();\n}\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(utilsDir, 'extra.ts'),
      'export function tsExtra(n: number): number {\n  return n + 1;\n}\n',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(utilsDir, 'worker.py'),
      'def py_helper(value):\n    return value.strip()\n',
      'utf-8',
    );

    // 第一轮：全量 force
    const firstRun = await runBatch(projectRoot, { force: true, maxRetries: 1 });
    expect(firstRun.failed).toHaveLength(0);
    expect(firstRun.successful).toContain('utils--ts-js');
    expect(firstRun.successful).toContain('utils--python');

    // 修复 1：按 moduleName 命名 → 两份独立 spec 共存（若仍按 basename(dir) 命名则互相覆盖）
    const tsSpecPath = path.join(projectRoot, 'specs', 'modules', 'utils--ts-js.spec.md');
    const pySpecPath = path.join(projectRoot, 'specs', 'modules', 'utils--python.spec.md');
    expect(fs.existsSync(tsSpecPath)).toBe(true);
    expect(fs.existsSync(pySpecPath)).toBe(true);

    // frontmatter sourceTarget 均为纯目录路径 src/utils（无 `::language`）；
    // sourceTargetKey 各带语言后缀承载唯一性（目录级碰撞由 cache key 消歧）。
    expect(readFrontmatterField(tsSpecPath, 'sourceTarget')).toBe('src/utils');
    expect(readFrontmatterField(pySpecPath, 'sourceTarget')).toBe('src/utils');
    expect(readFrontmatterField(tsSpecPath, 'sourceTargetKey')).toBe('src/utils::ts-js');
    expect(readFrontmatterField(pySpecPath, 'sourceTargetKey')).toBe('src/utils::python');

    // files 注入生效：ts 组 relatedFiles 含 service.ts + extra.ts，不含 worker.py
    const tsContent = fs.readFileSync(tsSpecPath, 'utf-8');
    const pyContent = fs.readFileSync(pySpecPath, 'utf-8');
    expect(tsContent).toContain('service.ts');
    expect(tsContent).toContain('extra.ts');
    expect(tsContent).not.toContain('worker.py');
    expect(pyContent).toContain('worker.py');
    expect(pyContent).not.toContain('service.ts');
    expect(pyContent).not.toContain('extra.ts');

    const tsBefore = fs.readFileSync(tsSpecPath, 'utf-8');
    const pyBefore = fs.readFileSync(pySpecPath, 'utf-8');

    // 第二轮：内容不改，增量重跑
    llmMocks.callLLM.mockClear();
    const secondRun = await runBatch(projectRoot, { incremental: true, maxRetries: 1 });

    expect(secondRun.failed).toHaveLength(0);
    // 两组均 skip：第二轮零 LLM 调用（目录级碰撞下 cache key 不互相覆盖，增量正确命中）
    expect(llmMocks.callLLM).toHaveBeenCalledTimes(0);
    expect(secondRun.skipped).toContain('utils--ts-js');
    expect(secondRun.skipped).toContain('utils--python');

    // 两 spec 内容逐字节不变
    expect(fs.readFileSync(tsSpecPath, 'utf-8')).toBe(tsBefore);
    expect(fs.readFileSync(pySpecPath, 'utf-8')).toBe(pyBefore);
  });
});
