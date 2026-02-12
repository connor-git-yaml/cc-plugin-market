/**
 * Golden Master 测试
 * 验证生成的 spec 与预期输出的结构相似度 ≥ 90%（SC-004）
 *
 * 评分体系（加权）：
 * 1. 9 个章节存在性（9 分）
 * 2. 接口定义中导出符号的 Jaccard 相似系数（权重 40%）
 * 3. Frontmatter 字段完整性（权重 10%）
 * 4. Mermaid 图表存在性（权重 10%）
 * 5. 各章节非空内容覆盖率（权重 30%）
 * 6. 文件清单完整性（权重 10%）
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { analyzeFile } from '../../src/core/ast-analyzer.js';
import { renderSpec, initRenderer } from '../../src/generator/spec-renderer.js';
import type { CodeSkeleton } from '../../src/models/code-skeleton.js';
import type { ModuleSpec } from '../../src/models/module-spec.js';
import { generateClassDiagram } from '../../src/generator/mermaid-class-diagram.js';

const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');
const SAMPLE_FILE = path.join(FIXTURES_DIR, 'sample-module.ts');

// 预期输出定义
interface ExpectedSpec {
  expectedExports: string[];
  expectedSections: string[];
  expectedFrontmatterFields: string[];
  expectedImports: string[];
  expectedKinds: Record<string, string>;
}

let skeleton: CodeSkeleton;
let expectedSpec: ExpectedSpec;
let renderedMarkdown: string;
let moduleSpec: ModuleSpec;

beforeAll(async () => {
  // 加载预期输出
  const expectedPath = path.join(FIXTURES_DIR, 'expected-spec.json');
  expectedSpec = JSON.parse(fs.readFileSync(expectedPath, 'utf-8'));

  // AST 分析固件文件
  skeleton = await analyzeFile(SAMPLE_FILE);

  // 构建 ModuleSpec（不依赖 LLM，用 AST 数据填充）
  moduleSpec = buildModuleSpecFromSkeleton(skeleton);

  // 渲染 Markdown
  initRenderer();
  renderedMarkdown = renderSpec(moduleSpec);
});

describe('Golden Master 测试', () => {
  it('AST 提取的导出符号与预期的 Jaccard 相似系数 ≥ 0.9', () => {
    const extractedNames = new Set(skeleton.exports.map((e) => e.name));
    const expectedNames = new Set(expectedSpec.expectedExports);

    const intersection = new Set([...extractedNames].filter((n) => expectedNames.has(n)));
    const union = new Set([...extractedNames, ...expectedNames]);

    const jaccard = intersection.size / union.size;
    expect(jaccard).toBeGreaterThanOrEqual(0.9);
  });

  it('导出符号类型匹配率 ≥ 0.8', () => {
    let matches = 0;
    let total = 0;

    for (const exp of skeleton.exports) {
      if (expectedSpec.expectedKinds[exp.name]) {
        total++;
        if (exp.kind === expectedSpec.expectedKinds[exp.name]) {
          matches++;
        }
      }
    }

    const ratio = total > 0 ? matches / total : 0;
    expect(ratio).toBeGreaterThanOrEqual(0.8);
  });

  it('渲染输出包含全部 9 个章节', () => {
    for (const section of expectedSpec.expectedSections) {
      expect(renderedMarkdown).toContain(section);
    }
  });

  it('渲染输出包含 YAML frontmatter', () => {
    expect(renderedMarkdown).toMatch(/^---\n/);
    expect(renderedMarkdown).toMatch(/\n---\n/);

    for (const field of expectedSpec.expectedFrontmatterFields) {
      expect(renderedMarkdown).toContain(`${field}:`);
    }
  });

  it('渲染输出包含 Mermaid 图表', () => {
    expect(renderedMarkdown).toContain('```mermaid');
    expect(renderedMarkdown).toContain('classDiagram');
  });

  it('各章节非空内容覆盖率 ≥ 0.9', () => {
    const sections = expectedSpec.expectedSections;
    let nonEmptySections = 0;

    for (const section of sections) {
      // 查找章节标题后的内容
      // 模板格式为 `## N. 章节名`，如 `## 1. 意图`
      const re = new RegExp(`#+\\s+(?:\\d+\\.\\s+)?${section}\\s*\\n([\\s\\S]*?)(?=\\n#|$)`);
      const match = re.exec(renderedMarkdown);
      if (match?.[1]?.trim()) {
        nonEmptySections++;
      }
    }

    const coverage = nonEmptySections / sections.length;
    expect(coverage).toBeGreaterThanOrEqual(0.9);
  });

  it('import 依赖检测完整性', () => {
    const extractedImports = skeleton.imports.map((i) => i.moduleSpecifier);

    for (const expected of expectedSpec.expectedImports) {
      const found = extractedImports.some((imp) => imp.includes(expected));
      expect(found).toBe(true);
    }
  });

  it('基线骨架嵌入在 HTML 注释中', () => {
    expect(renderedMarkdown).toContain('<!-- baseline-skeleton:');
    // 验证可反序列化
    const match = /<!-- baseline-skeleton: (.+?) -->/.exec(renderedMarkdown);
    expect(match).toBeTruthy();
    const parsed = JSON.parse(match![1]!);
    expect(parsed.filePath).toBeDefined();
    expect(parsed.exports).toBeDefined();
  });

  it('综合加权总分 ≥ 0.9', () => {
    const scores = calculateWeightedScore(skeleton, renderedMarkdown, expectedSpec);
    expect(scores.total).toBeGreaterThanOrEqual(0.9);
  });
});

// ============================================================
// 辅助函数
// ============================================================

/**
 * 从骨架构建 ModuleSpec（不依赖 LLM）
 */
function buildModuleSpecFromSkeleton(skel: CodeSkeleton): ModuleSpec {
  // 构建接口定义章节
  const interfaceDef = skel.exports.map((e) => {
    const header = `### \`${e.signature}\`\n`;
    const doc = e.jsDoc ? `${e.jsDoc}\n` : '';
    return header + doc;
  }).join('\n');

  // 构建数据结构章节
  const dataStructures = skel.exports
    .filter((e) => ['interface', 'type', 'enum'].includes(e.kind))
    .map((e) => `- **${e.name}** (${e.kind}): \`${e.signature}\``)
    .join('\n') || '（无独立数据结构）';

  // 构建依赖关系章节
  const deps = skel.imports
    .map((i) => `- \`${i.moduleSpecifier}\``)
    .join('\n') || '（无外部依赖）';

  // Mermaid 类图
  const mermaidSource = generateClassDiagram(skel);

  // 构建数据对象（需匹配 Handlebars 模板的字段名）
  const data: any = {
    frontmatter: {
      type: 'module-spec',
      version: 'v1',
      generatedBy: 'reverse-spec-v2-golden-master',
      sourceTarget: skel.filePath,
      relatedFiles: [skel.filePath],
      lastUpdated: new Date().toISOString(),
      confidence: 'high',
      skeletonHash: skel.hash,
    },
    sections: {
      intent: '用户认证服务模块，提供注册、登录、令牌验证和权限检查功能。',
      interfaceDefinition: interfaceDef,
      businessLogic: '1. 注册时检查邮箱唯一性\n2. 登录时检查账户锁定状态\n3. 密码使用 SHA-256 哈希\n4. 登录失败次数超过阈值锁定账户',
      dataStructures,
      constraints: '- 令牌有效期默认 3600 秒\n- 最大登录尝试 5 次\n- 锁定时间 30 分钟',
      edgeCases: '- 邮箱已注册时抛出异常\n- 账户锁定期间拒绝登录\n- 锁定过期后自动解除',
      technicalDebt: '- 使用内存 Map 存储，不适用于生产环境\n- 缺少刷新令牌验证逻辑',
      testCoverage: '- 需要单元测试覆盖注册、登录、令牌验证和权限检查\n- 需要边界条件测试',
      dependencies: deps,
    },
    // 模板中使用 mermaidDiagrams 字段名
    mermaidDiagrams: mermaidSource
      ? [{ type: 'classDiagram', source: mermaidSource, title: '类关系图' }]
      : [],
    diagrams: mermaidSource
      ? [{ type: 'classDiagram', source: mermaidSource, title: '类关系图' }]
      : [],
    // 模板中的 fileInventory 需要 loc 和 purpose 字段
    fileInventory: [{ path: skel.filePath, loc: skel.loc, purpose: '用户认证服务主文件' }],
    baselineSkeleton: skel,
  };
  return data as ModuleSpec;
}

/**
 * 计算综合加权分数
 */
function calculateWeightedScore(
  skel: CodeSkeleton,
  markdown: string,
  expected: ExpectedSpec,
): { total: number; details: Record<string, number> } {
  const details: Record<string, number> = {};

  // 1. 导出符号 Jaccard（40%）
  const extractedNames = new Set(skel.exports.map((e) => e.name));
  const expectedNames = new Set(expected.expectedExports);
  const intersection = new Set([...extractedNames].filter((n) => expectedNames.has(n)));
  const union = new Set([...extractedNames, ...expectedNames]);
  details.exportJaccard = union.size > 0 ? intersection.size / union.size : 0;

  // 2. Frontmatter 完整性（10%）
  let frontmatterHits = 0;
  for (const field of expected.expectedFrontmatterFields) {
    if (markdown.includes(`${field}:`)) frontmatterHits++;
  }
  details.frontmatter = frontmatterHits / expected.expectedFrontmatterFields.length;

  // 3. Mermaid 存在性（10%）
  details.mermaid = markdown.includes('```mermaid') ? 1 : 0;

  // 4. 章节非空覆盖率（30%）
  let nonEmpty = 0;
  for (const section of expected.expectedSections) {
    const re = new RegExp(`#+\\s+(?:\\d+\\.\\s+)?${section}\\s*\\n([\\s\\S]*?)(?=\\n#|$)`);
    const match = re.exec(markdown);
    if (match?.[1]?.trim()) nonEmpty++;
  }
  details.sectionCoverage = nonEmpty / expected.expectedSections.length;

  // 5. 文件清单（10%）
  details.fileInventory = markdown.includes(path.basename(SAMPLE_FILE)) ? 1 : 0;

  // 加权总分
  details.total =
    details.exportJaccard * 0.4 +
    details.frontmatter * 0.1 +
    details.mermaid * 0.1 +
    details.sectionCoverage * 0.3 +
    details.fileInventory * 0.1;

  return { total: details.total, details };
}
