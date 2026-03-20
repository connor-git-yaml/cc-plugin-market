import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ModuleSpec } from '../../src/models/module-spec.js';
import { renderSpec } from '../../src/generator/spec-renderer.js';
import {
  buildArchitectureNarrative,
  renderArchitectureNarrative,
} from '../../src/panoramic/architecture-narrative.js';
import type { ProjectContext } from '../../src/panoramic/interfaces.js';

describe('architecture-narrative', () => {
  let projectRoot: string;
  let outputDir: string;

  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-narrative-'));
    outputDir = path.join(projectRoot, 'specs');
    fs.mkdirSync(outputDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  it('从 module spec 与 baseline skeleton 提炼关键模块、类与方法', () => {
    const clientSpec = createModuleSpec({
      sourceTarget: 'src/client',
      relatedFiles: ['src/client/query.ts'],
      intent: '负责 SDK 对外会话入口与查询编排。',
      businessLogic: '封装连接建立、请求发送、消息接收与会话控制。',
      dependencies: '依赖 transport 与 session 子系统。',
      exports: [
        {
          name: 'ClaudeSDKClient',
          kind: 'class',
          signature: 'class ClaudeSDKClient',
          jsDoc: '长连接客户端。',
          isDefault: false,
          startLine: 1,
          endLine: 120,
          members: [
            {
              name: 'connect',
              kind: 'method',
              signature: 'connect(): Promise<void>',
              isStatic: false,
            },
            {
              name: 'query',
              kind: 'method',
              signature: 'query(prompt: string): Promise<ResultMessage>',
              isStatic: false,
            },
          ],
        },
        {
          name: 'query',
          kind: 'function',
          signature: 'query(prompt: string): Promise<ResultMessage>',
          jsDoc: '单次查询入口。',
          isDefault: false,
          startLine: 122,
          endLine: 150,
        },
      ],
    });

    const sessionSpec = createModuleSpec({
      sourceTarget: 'src/session',
      relatedFiles: ['src/session/store.ts'],
      intent: '负责离线 session 元数据读取与追加式 mutation。',
      businessLogic: '封装 transcript 扫描、读取和 rename/tag 附加写入。',
      dependencies: '依赖本地文件系统与 JSONL transcript。',
      exports: [
        {
          name: 'SessionStore',
          kind: 'class',
          signature: 'class SessionStore',
          jsDoc: '离线会话存储。',
          isDefault: false,
          startLine: 1,
          endLine: 80,
          members: [
            {
              name: 'listSessions',
              kind: 'method',
              signature: 'listSessions(): SessionSummary[]',
              isStatic: false,
            },
          ],
        },
      ],
    });

    fs.writeFileSync(path.join(outputDir, 'client.spec.md'), renderSpec(clientSpec), 'utf-8');
    fs.writeFileSync(path.join(outputDir, 'session.spec.md'), renderSpec(sessionSpec), 'utf-8');

    const projectContext: ProjectContext = {
      projectRoot,
      configFiles: new Map([['package.json', path.join(projectRoot, 'package.json')]]),
      packageManager: 'npm',
      workspaceType: 'single',
      detectedLanguages: ['python'],
      existingSpecs: [
        path.join(outputDir, 'client.spec.md'),
        path.join(outputDir, 'session.spec.md'),
      ],
    };

    const output = buildArchitectureNarrative({
      projectRoot,
      outputDir,
      projectContext,
      generatedDocs: [
        {
          generatorId: 'api-surface',
          writtenFiles: [path.join(outputDir, 'api-surface.md')],
          warnings: [],
        },
      ],
    });
    const markdown = renderArchitectureNarrative(output);

    expect(output.keyModules.map((item) => item.sourceTarget)).toContain('src/client');
    expect(output.keySymbols.some((item) => item.name === 'ClaudeSDKClient')).toBe(true);
    expect(output.keyMethods.some((item) => item.name === 'connect')).toBe(true);
    expect(markdown).toContain('## 1. 先说结论');
    expect(markdown).toContain('## 5. 关键方法 / 函数');
    expect(markdown).toContain('ClaudeSDKClient');
    expect(markdown).toContain('connect');
  });
});

function createModuleSpec(input: {
  sourceTarget: string;
  relatedFiles: string[];
  intent: string;
  businessLogic: string;
  dependencies: string;
  exports: Array<{
    name: string;
    kind: 'class' | 'function';
    signature: string;
    jsDoc?: string;
    isDefault: boolean;
    startLine: number;
    endLine: number;
    members?: Array<{
      name: string;
      kind: 'method';
      signature: string;
      isStatic: boolean;
    }>;
  }>;
}): ModuleSpec {
  return {
    frontmatter: {
      type: 'module-spec',
      version: 'v1',
      generatedBy: 'reverse-spec v2.1.0',
      sourceTarget: input.sourceTarget,
      relatedFiles: input.relatedFiles,
      lastUpdated: '2026-03-20T00:00:00.000Z',
      confidence: 'high',
      skeletonHash: 'a'.repeat(64),
    },
    sections: {
      intent: input.intent,
      interfaceDefinition: `${input.sourceTarget} interface`,
      businessLogic: input.businessLogic,
      dataStructures: `${input.sourceTarget} data structures`,
      constraints: `${input.sourceTarget} constraints`,
      edgeCases: `${input.sourceTarget} edge cases`,
      technicalDebt: `${input.sourceTarget} debt`,
      testCoverage: `${input.sourceTarget} tests`,
      dependencies: input.dependencies,
    },
    fileInventory: input.relatedFiles.map((filePath) => ({
      path: filePath,
      loc: 42,
      purpose: `${path.basename(filePath)} role`,
    })),
    baselineSkeleton: {
      filePath: input.relatedFiles[0]!,
      language: 'python',
      loc: 42,
      exports: input.exports,
      imports: [],
      hash: 'a'.repeat(64),
      analyzedAt: '2026-03-20T00:00:00.000Z',
      parserUsed: 'tree-sitter',
    },
    outputPath: path.join('specs', `${path.posix.basename(input.sourceTarget)}.spec.md`),
  };
}
