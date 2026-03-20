import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProjectContext } from '../../src/panoramic/interfaces.js';
import type { ArchitectureNarrativeOutput } from '../../src/panoramic/architecture-narrative.js';
import type { PatternHintsOutput } from '../../src/panoramic/pattern-hints-model.js';
import { generateBatchAdrDocs } from '../../src/panoramic/adr-decision-pipeline.js';


describe('generateBatchAdrDocs', () => {
  afterEach(() => {
    for (const dir of tempDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    tempDirs.length = 0;
  });

  it('基于 current-spec 与 registry / fallback 信号生成 ADR 草稿', () => {
    const projectRoot = createTempProject();
    const outputDir = path.join(projectRoot, 'specs');

    fs.mkdirSync(path.join(projectRoot, 'src', 'panoramic'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'src', 'core'), { recursive: true });
    fs.mkdirSync(path.join(projectRoot, 'specs', 'products', 'reverse-spec'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'panoramic', 'generator-registry.ts'),
      'export class GeneratorRegistry {}',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'core', 'fallback.ts'),
      'export const mode = "AST-only fallback";',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'specs', 'products', 'reverse-spec', 'current-spec.md'),
      [
        '# Reverse-Spec',
        'current-spec 作为产品规范活文档与事实源。',
        '系统通过 GeneratorRegistry / ParserRegistry 管理扩展能力。',
        '当 LLM 不可用时保留 AST-only 与 low confidence 静默降级。',
      ].join('\n'),
      'utf-8',
    );

    const narrative = buildNarrative('reverse-spec', [
      buildModule('src/panoramic/generator-registry.ts', '注册中心负责 generator / parser 的发现与管理'),
      buildModule('src/core/fallback.ts', 'fallback 模块负责 AST-only 与低置信度降级'),
      buildModule('src/batch/batch-orchestrator.ts', 'batch 组织主链路与项目级文档编排'),
    ]);

    const result = generateBatchAdrDocs({
      projectRoot,
      outputDir,
      projectContext: buildProjectContext(projectRoot),
      generatedDocs: [],
      architectureNarrative: narrative,
    });

    expect(result.drafts.length).toBeGreaterThanOrEqual(2);
    expect(result.drafts.some((draft) => draft.title.includes('Registry'))).toBe(true);
    expect(result.drafts.some((draft) => draft.title.includes('current-spec') || draft.title.includes('事实源'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'docs', 'adr', 'index.md'))).toBe(true);
  });

  it('基于 CLI transport / JSON protocol 信号生成运行时 ADR 草稿', () => {
    const projectRoot = createTempProject();
    const outputDir = path.join(projectRoot, 'specs');

    fs.mkdirSync(path.join(projectRoot, 'src', '_internal', 'transport'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'src', '_internal', 'transport', 'subprocess_cli.py'),
      'class SubprocessCLITransport: pass',
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'src', '_internal', 'message_parser.py'),
      'def parse_stream_json(message): pass',
      'utf-8',
    );

    const narrative = buildNarrative('claude-agent-sdk-python', [
      buildModule('src/claude_agent_sdk/_internal/query.py', 'Query 负责 control_request / control_response 与运行时编排'),
      buildModule('src/claude_agent_sdk/_internal/transport/subprocess_cli.py', 'transport 通过 subprocess CLI 与 stdin/stdout JSON 流通信'),
      buildModule('src/claude_agent_sdk/_internal/message_parser.py', 'message parser 负责解析 stream-json 消息'),
    ]);

    const patternHints = buildPatternHints('claude-agent-sdk-python');
    const result = generateBatchAdrDocs({
      projectRoot,
      outputDir,
      projectContext: buildProjectContext(projectRoot),
      generatedDocs: [],
      architectureNarrative: narrative,
      patternHints,
    });

    expect(result.drafts.some((draft) => draft.title.includes('CLI'))).toBe(true);
    expect(result.drafts.some((draft) => draft.title.includes('JSON'))).toBe(true);
    expect(fs.existsSync(path.join(outputDir, 'docs', 'adr', 'index.json'))).toBe(true);
  });
});

function createTempProject(): string {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-decision-pipeline-'));
  tempDirs.push(projectRoot);
  return projectRoot;
}

function buildProjectContext(projectRoot: string): ProjectContext {
  return {
    projectRoot,
    configFiles: new Map(),
    packageManager: 'unknown',
    workspaceType: 'single',
    detectedLanguages: ['ts-js'],
    existingSpecs: [],
  };
}

function buildNarrative(
  projectName: string,
  keyModules: ArchitectureNarrativeOutput['keyModules'],
): ArchitectureNarrativeOutput {
  return {
    title: `技术架构说明: ${projectName}`,
    generatedAt: '2026-03-20',
    projectName,
    executiveSummary: ['系统围绕若干核心模块组织运行时链路。'],
    repositoryMap: [],
    keyModules,
    keySymbols: [],
    keyMethods: [],
    observations: [],
    supportingDocs: [],
  };
}

function buildModule(sourceTarget: string, summary: string): ArchitectureNarrativeOutput['keyModules'][number] {
  return {
    sourceTarget,
    displayName: path.basename(sourceTarget),
    role: 'core',
    relatedFiles: [sourceTarget],
    confidence: 'high',
    intentSummary: summary,
    businessSummary: summary,
    dependencySummary: summary,
    keySymbols: [],
    keyMethods: [],
    inferred: false,
  };
}

function buildPatternHints(projectName: string): PatternHintsOutput {
  return {
    title: `模式提示: ${projectName}`,
    generatedAt: '2026-03-20',
    architectureOverview: {
      title: `架构概览: ${projectName}`,
      generatedAt: '2026-03-20',
      model: {
        projectName,
        sections: [],
        moduleSummaries: [],
        deploymentUnits: [],
        stats: {
          sectionCount: 0,
          nodeCount: 0,
          edgeCount: 0,
          warningCount: 0,
        },
      },
      warnings: [],
    },
    model: {
      projectName,
      matchedPatterns: [{
        patternId: 'protocol-streaming',
        patternName: '流式控制协议',
        summary: '系统通过 JSON stream 与 runtime 通信',
        confidence: 0.81,
        matchLevel: 'high',
        explanation: 'evidence 包括 subprocess transport 与 message parser',
        evidence: [],
        matchedSignals: ['stream-json', 'stdin/stdout'],
        missingSignals: [],
        competingAlternatives: [],
        inferred: false,
      }],
      noHighConfidenceMatch: false,
      alternatives: [],
      warnings: [],
      stats: {
        totalPatternsEvaluated: 1,
        matchedPatterns: 1,
        highConfidencePatterns: 1,
        warningCount: 0,
      },
    },
    warnings: [],
  };
}

const tempDirs: string[] = [];
