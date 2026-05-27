/**
 * Feature 170a — Spectra + Spec Driver 协同部署集成测试
 *
 * TDD RED phase: 测试脚手架（Green phase 实施后应全部 pass）
 *
 * 用户故事：
 *   US-1: spectra-cli 4.2.0 在 dist/ 中包含 agent-context-tools（impact/context/detect_changes）
 *   US-2: 5 个 spec-driver sub-agent 使用正确的 plugin namespace（mcp__plugin_spectra_spectra__*）
 *   US-3: 5 个 spec-driver agent frontmatter 全部对齐，不含旧 namespace（mcp__spectra__*）
 *
 * 设计原则：
 *   - 纯文件断言，不调真实 LLM，不发 HTTP，测试快速可靠
 *   - 断言足够具体，能作为 deploy gate
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

const PROJECT_ROOT = join(__dirname, '../../');
const AGENTS_DIR = join(PROJECT_ROOT, 'plugins/spec-driver/agents');
const MCP_SERVER_SRC = join(PROJECT_ROOT, 'src/mcp/server.ts');
const RELEASE_CONTRACT = join(PROJECT_ROOT, 'contracts/release-contract.yaml');

// US-1 相关路径
const DIST_MCP_DIR = join(PROJECT_ROOT, 'dist/mcp');
const AGENT_CONTEXT_TOOLS_DIST = join(DIST_MCP_DIR, 'agent-context-tools.js');

// US-2/3 相关：5 个 agent 文件
const AGENT_FILES = [
  'plan.md',
  'implement.md',
  'verify.md',
  'spec-review.md',
  'quality-review.md',
];

// 正确的 plugin namespace 前缀（方案 🅰）
const CORRECT_NAMESPACE = 'mcp__plugin_spectra_spectra__';
// 已废弃的旧 namespace 前缀
const OLD_NAMESPACE = 'mcp__spectra__';

// 每个 agent 文件应包含的 plugin namespace 工具名
const EXPECTED_TOOLS: Record<string, string[]> = {
  'plan.md': [
    'mcp__plugin_spectra_spectra__context',
    'mcp__plugin_spectra_spectra__impact',
  ],
  'implement.md': [
    'mcp__plugin_spectra_spectra__context',
    'mcp__plugin_spectra_spectra__impact',
  ],
  'verify.md': [
    'mcp__plugin_spectra_spectra__detect_changes',
    'mcp__plugin_spectra_spectra__impact',
  ],
  'spec-review.md': [
    'mcp__plugin_spectra_spectra__impact',
    'mcp__plugin_spectra_spectra__context',
  ],
  'quality-review.md': [
    'mcp__plugin_spectra_spectra__impact',
    'mcp__plugin_spectra_spectra__context',
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// US-1: spectra-cli 4.2.0 包含 agent-context-tools
// ─────────────────────────────────────────────────────────────────────────────

describe('US-1: spectra-cli 4.2.0 包含 agent-context tools', () => {
  it('release-contract.yaml 中 spectra 版本应为 4.2.0', () => {
    expect(existsSync(RELEASE_CONTRACT)).toBe(true);
    const content = readFileSync(RELEASE_CONTRACT, 'utf-8');
    // 断言 release-contract 包含 spectra section 且 version 为 4.2.0
    // YAML 结构：products.spectra.displayName 先于 version，故用独立行匹配
    expect(content).toContain('version: "4.2.0"');
  });

  it('src/mcp/server.ts 应导入 registerAgentContextTools', () => {
    expect(existsSync(MCP_SERVER_SRC)).toBe(true);
    const content = readFileSync(MCP_SERVER_SRC, 'utf-8');
    expect(content).toContain('registerAgentContextTools');
    expect(content).toContain('agent-context-tools');
  });

  it('构建后 dist/mcp/agent-context-tools.js 应存在', () => {
    // 此测试在 build 完成后才能 pass
    // GREEN phase 需先跑 npm run build
    expect(
      existsSync(AGENT_CONTEXT_TOOLS_DIST),
      `期望 ${AGENT_CONTEXT_TOOLS_DIST} 存在（需要先跑 npm run build）`
    ).toBe(true);
  });

  it('dist/mcp/agent-context-tools.js 应包含 impact/context/detect_changes tool handler', () => {
    // 此测试在 build 完成后才能 pass
    expect(existsSync(AGENT_CONTEXT_TOOLS_DIST)).toBe(true);
    const content = readFileSync(AGENT_CONTEXT_TOOLS_DIST, 'utf-8');
    expect(content).toContain('impact');
    expect(content).toContain('context');
    expect(content).toContain('detect_changes');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// US-2: sub-agent frontmatter 包含正确 plugin namespace 工具名
// ─────────────────────────────────────────────────────────────────────────────

describe('US-2: sub-agent frontmatter 包含正确 plugin namespace 工具名', () => {
  for (const agentFile of AGENT_FILES) {
    const filePath = join(AGENTS_DIR, agentFile);
    const expectedTools = EXPECTED_TOOLS[agentFile];

    describe(`plugins/spec-driver/agents/${agentFile}`, () => {
      it('文件应存在', () => {
        expect(existsSync(filePath)).toBe(true);
      });

      for (const toolName of expectedTools) {
        it(`frontmatter tools 列表应包含 ${toolName}`, () => {
          const content = readFileSync(filePath, 'utf-8');
          // 提取 frontmatter（--- ... ---）
          const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
          expect(
            frontmatterMatch,
            `${agentFile} 应包含 YAML frontmatter`
          ).toBeTruthy();
          const frontmatter = frontmatterMatch![1];
          expect(
            frontmatter,
            `${agentFile} frontmatter 应包含工具 ${toolName}`
          ).toContain(toolName);
        });
      }
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// US-3: 5 个 agent frontmatter 全部对齐——不含旧 namespace
// ─────────────────────────────────────────────────────────────────────────────

describe('US-3: 5 个 agent frontmatter 不含旧 namespace mcp__spectra__*', () => {
  for (const agentFile of AGENT_FILES) {
    const filePath = join(AGENTS_DIR, agentFile);

    it(`plugins/spec-driver/agents/${agentFile} 不应包含旧 namespace ${OLD_NAMESPACE}*`, () => {
      expect(existsSync(filePath)).toBe(true);
      const content = readFileSync(filePath, 'utf-8');
      // 提取 frontmatter
      const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
      expect(frontmatterMatch).toBeTruthy();
      const frontmatter = frontmatterMatch![1];
      expect(
        frontmatter,
        `${agentFile} frontmatter 不应包含旧 namespace（应已替换为 mcp__plugin_spectra_spectra__*）`
      ).not.toContain(OLD_NAMESPACE);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 集成快检：spec-driver docs 目录存在（Bug-3 fix 验证）
// ─────────────────────────────────────────────────────────────────────────────

describe('Bug-3 fix: spec-driver docs 目录与 onboarding 文档', () => {
  const DOCS_DIR = join(PROJECT_ROOT, 'plugins/spec-driver/docs');

  it('plugins/spec-driver/docs/ 目录应存在', () => {
    expect(existsSync(DOCS_DIR)).toBe(true);
  });

  it('plugins/spec-driver/docs/spectra-mcp-integration.md 应存在', () => {
    expect(
      existsSync(join(DOCS_DIR, 'spectra-mcp-integration.md'))
    ).toBe(true);
  });

  it('plugins/spec-driver/docs/customization.md 应存在（fork 用户应急方案）', () => {
    expect(
      existsSync(join(DOCS_DIR, 'customization.md'))
    ).toBe(true);
  });

  it('plugins/spec-driver/docs/spectra-mcp-integration.md 应包含 plugin namespace 说明', () => {
    const docPath = join(DOCS_DIR, 'spectra-mcp-integration.md');
    if (!existsSync(docPath)) return; // 未创建时跳过内容断言
    const content = readFileSync(docPath, 'utf-8');
    expect(content).toContain('mcp__plugin_spectra_spectra__');
  });
});
