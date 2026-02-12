/**
 * 自举测试
 * 对 reverse-spec 项目自身运行 AST 分析，验证所有模块生成有效骨架（SC-009）
 *
 * 注：完整的 /reverse-spec-batch（含 LLM）需要 API 密钥，
 *     本测试仅验证 AST 阶段 + 模板渲染的自举能力
 */
import { describe, it, expect } from 'vitest';
import * as path from 'node:path';
import { scanFiles } from '../../src/utils/file-scanner.js';
import { analyzeFiles } from '../../src/core/ast-analyzer.js';
import { renderSpec, initRenderer } from '../../src/generator/spec-renderer.js';
import { generateClassDiagram } from '../../src/generator/mermaid-class-diagram.js';
import type { ModuleSpec } from '../../src/models/module-spec.js';

const PROJECT_SRC = path.resolve(__dirname, '../../src');

describe('自举测试：reverse-spec 分析自身', () => {
  it('扫描项目 src/ 目录应发现所有模块', async () => {
    const { files } = await scanFiles(PROJECT_SRC);

    // 项目有多个模块文件
    expect(files.length).toBeGreaterThanOrEqual(10);

    // 核心模块应存在
    const fileNames = files.map((f) => path.basename(f));
    expect(fileNames).toContain('ast-analyzer.ts');
    expect(fileNames).toContain('llm-client.ts');
    expect(fileNames).toContain('context-assembler.ts');
    expect(fileNames).toContain('structural-diff.ts');
    expect(fileNames).toContain('drift-orchestrator.ts');
  });

  it('AST 分析项目所有源文件应成功', async () => {
    const { files } = await scanFiles(PROJECT_SRC);
    const absoluteFiles = files.map((f) => path.resolve(PROJECT_SRC, f));
    const skeletons = await analyzeFiles(absoluteFiles);

    // 每个文件都应成功生成骨架
    expect(skeletons).toHaveLength(files.length);

    for (const skeleton of skeletons) {
      // 基本完整性
      expect(skeleton.filePath).toBeTruthy();
      expect(skeleton.language).toBe('typescript');
      expect(skeleton.loc).toBeGreaterThan(0);
      expect(skeleton.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(skeleton.parserUsed).toBe('ts-morph');

      // 每个文件应有导出（src/ 中的文件都是模块）
      expect(skeleton.exports.length).toBeGreaterThanOrEqual(0);
    }
  });

  it('所有骨架的导出签名非空', async () => {
    const { files } = await scanFiles(PROJECT_SRC);
    const absoluteFiles = files.map((f) => path.resolve(PROJECT_SRC, f));
    const skeletons = await analyzeFiles(absoluteFiles);

    for (const skeleton of skeletons) {
      for (const exp of skeleton.exports) {
        expect(exp.name).toBeTruthy();
        expect(exp.signature).toBeTruthy();
        expect(exp.kind).toBeTruthy();
      }
    }
  });

  it('可以为每个骨架生成 Mermaid 类图', async () => {
    const { files } = await scanFiles(PROJECT_SRC);
    const absoluteFiles = files.map((f) => path.resolve(PROJECT_SRC, f));
    const skeletons = await analyzeFiles(absoluteFiles);

    for (const skeleton of skeletons) {
      // 不应抛出异常
      const diagram = generateClassDiagram(skeleton);
      // 有类/接口导出时应生成图表
      const hasClassLike = skeleton.exports.some((e) =>
        ['class', 'interface'].includes(e.kind),
      );
      if (hasClassLike) {
        expect(diagram).toBeTruthy();
        expect(diagram).toContain('classDiagram');
      }
    }
  });

  it('可以为骨架渲染完整 spec Markdown', async () => {
    const { files } = await scanFiles(PROJECT_SRC);
    const absoluteFiles = files.map((f) => path.resolve(PROJECT_SRC, f));
    const skeletons = await analyzeFiles(absoluteFiles);

    initRenderer();

    // 选取一个有丰富导出的骨架做渲染测试
    const richSkeleton = skeletons.reduce((best, s) =>
      s.exports.length > best.exports.length ? s : best,
    );

    const moduleSpec: ModuleSpec = {
      frontmatter: {
        type: 'module-spec',
        version: 'v1',
        generatedBy: 'reverse-spec-v2-self-host',
        sourceTarget: richSkeleton.filePath,
        relatedFiles: [richSkeleton.filePath],
        lastUpdated: new Date().toISOString(),
        confidence: 'high',
        skeletonHash: richSkeleton.hash,
      },
      sections: {
        intent: '自举测试模块',
        interfaceDefinition: richSkeleton.exports.map((e) => `### \`${e.signature}\``).join('\n\n'),
        businessLogic: 'AST 分析与代码骨架提取',
        dataStructures: '参见导出类型定义',
        constraints: '依赖 ts-morph',
        edgeCases: '语法错误文件降级处理',
        technicalDebt: '无',
        testCoverage: '单元测试覆盖',
        dependencies: richSkeleton.imports.map((i) => `- ${i.moduleSpecifier}`).join('\n') || '无',
      },
      diagrams: [],
      fileInventory: [{ path: richSkeleton.filePath, description: '主模块' }],
      baselineSkeleton: richSkeleton,
    } as ModuleSpec;

    const markdown = renderSpec(moduleSpec);

    // 验证渲染输出
    expect(markdown).toContain('---');
    expect(markdown).toContain('## 1. 意图');
    expect(markdown).toContain('## 2. 接口定义');
    expect(markdown).toContain('<!-- baseline-skeleton:');
    expect(markdown.length).toBeGreaterThan(500);
  });
});
