/**
 * Feature 140 T42 — ADR MapReduce dispatch 单测
 *
 * 覆盖 spec FR-003 / FR-004 / FR-005：
 * - Map 调用使用 sonnet
 * - Reduce 优先 opus，失败降级 sonnet（reduceFallbackTriggered=true）
 * - Map 输出每 candidate ≥1 evidenceRefs（schema 强制）
 * - Reduce 合并跨 cluster candidates（mergedFromClusters 字段）
 * - evidence 校验 gate：verified < 2 的 ADR 被丢弃
 * - 全部 candidate 都被丢弃 → fail-closed (no-verified-evidence)
 * - empty / Map 全失败 → fail-closed (map-below-threshold)
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
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-mapreduce-'));
});

function makeModule(sourceTarget: string, intent: string, business: string): StoredModuleSpecRecord {
  return {
    sourceTarget,
    relatedFiles: [`${sourceTarget}/index.ts`],
    confidence: 'high',
    intentSummary: intent,
    businessSummary: business,
    dependencySummary: '依赖 logger',
  };
}

function fakeAnthropic(): RunAdrMapReduceOptions['anthropicClient'] {
  return { messages: { create: mockMessagesCreate } } as unknown as RunAdrMapReduceOptions['anthropicClient'];
}

function makeLLMResponse(parsed: unknown, inputTokens = 1000, outputTokens = 500) {
  return {
    content: [{ type: 'text', text: JSON.stringify(parsed) }],
    usage: { input_tokens: inputTokens, output_tokens: outputTokens },
  };
}

function writeFile(relPath: string, content: string): void {
  const abs = path.join(tmpDir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
}

describe('runAdrMapReduce — Feature 140 FR-003/FR-004/FR-005', () => {
  it('case 1: Map 调用 sonnet + Reduce 优先 opus + frontmatter generatedByModel 字段', async () => {
    // 准备真实文件供 evidence 校验
    writeFile('src/auth.ts', 'class AuthService {\n  login() {\n    return true;\n  }\n}');
    writeFile('src/db.ts', 'class Database {\n  query() {}\n}');

    const modules = [
      makeModule('src/auth', 'AuthService 提供认证', 'AuthService 与 Database 协作'),
      makeModule('src/auth/db', 'Database ORM 抽象', 'Database 提供查询接口'),
    ];

    let callCount = 0;
    mockMessagesCreate.mockImplementation(async (args: { model: string }) => {
      callCount++;
      if (callCount === 1) {
        // Map call
        expect(args.model).toContain('sonnet');
        return makeLLMResponse({
          candidates: [
            {
              candidateId: 'auth-design',
              title: 'AuthService 与 Database 协作完成认证',
              summary: 'AuthService 通过 Database 持久化会话状态',
              decision: 'AuthService 调用 Database.query() 完成会话查询',
              context: '认证流需要持久化会话状态以支持横向扩展和多实例部署的需求',
              consequences: '解耦认证逻辑与底层存储实现，便于独立升级测试和后续替换',
              evidenceRefs: [
                { source: 'src/auth.ts', location: 'L1-5', snippet: 'class AuthService {\n  login() {\n    return true;\n  }\n}' },
                { source: 'src/db.ts', location: 'L1-3', snippet: 'class Database {\n  query() {}\n}' },
              ],
              sourceClusterId: 'cluster-auth',
              confidence: 0.85,
            },
          ],
        });
      } else if (callCount === 2) {
        // Reduce call - opus
        expect(args.model).toContain('opus');
        return makeLLMResponse({
          finalCandidates: [
            {
              candidateId: 'auth-design',
              title: 'AuthService 与 Database 协作完成认证',
              summary: 'AuthService 通过 Database 持久化会话状态',
              decision: 'AuthService 调用 Database.query() 完成会话查询',
              context: '认证流需要持久化会话状态以支持横向扩展和多实例部署的需求',
              consequences: '解耦认证逻辑与底层存储实现，便于独立升级测试和后续替换',
              evidenceRefs: [
                { source: 'src/auth.ts', location: 'L1-5', snippet: 'class AuthService {\n  login() {\n    return true;\n  }\n}' },
                { source: 'src/db.ts', location: 'L1-3', snippet: 'class Database {\n  query() {}\n}' },
              ],
              sourceClusterId: 'merged',
              confidence: 0.85,
              mergedFromClusters: ['cluster-auth'],
            },
          ],
        });
      }
      throw new Error(`unexpected callCount=${callCount}`);
    });

    const result = await runAdrMapReduce({
      anthropicClient: fakeAnthropic(),
      modules,
      projectRoot: tmpDir,
    });

    expect(result.failClosed).toBe(false);
    expect(result.finalCandidates.length).toBe(1);
    expect(result.generatedByModel.map).toContain('sonnet');
    expect(result.generatedByModel.reduce).toContain('opus');
    expect(result.reduceFallbackTriggered).toBe(false);
    // 每条 ADR 都应通过 evidence 校验（≥2 verified）
    const verifiedCount = result.finalCandidates[0]!.verifiedEvidenceRefs.filter((r) => r.verified).length;
    expect(verifiedCount).toBeGreaterThanOrEqual(2);
  });

  it('case 2: Reduce opus 失败 → 降级到 sonnet + reduceFallbackTriggered=true', async () => {
    writeFile('src/foo.ts', 'class Foo {\n  bar() {}\n}');
    writeFile('src/baz.ts', 'class Baz {\n  qux() {}\n}');
    const modules = [
      makeModule('src/foo', 'Foo 是核心', 'Foo 与 Baz 协作'),
      makeModule('src/foo/baz', 'Baz 辅助', 'Baz 处理'),
    ];

    let callCount = 0;
    mockMessagesCreate.mockImplementation(async (args: { model: string }) => {
      callCount++;
      if (callCount === 1) {
        // Map (sonnet) — 成功
        return makeLLMResponse({
          candidates: [{
            candidateId: 'foo-design',
            title: 'Foo 与 Baz 协作',
            summary: 'Foo 调用 Baz 完成数据处理流程的核心环节',
            decision: 'Foo 委托 Baz 处理具体的数据转换和持久化任务',
            context: '需要分离职责让每个类只负责一个抽象层级以降低耦合',
            consequences: '提升可测试性、保持单一职责清晰边界、降低跨层耦合度',
            evidenceRefs: [
              { source: 'src/foo.ts', location: 'L1-3', snippet: 'class Foo {\n  bar() {}\n}' },
              { source: 'src/baz.ts', location: 'L1-3', snippet: 'class Baz {\n  qux() {}\n}' },
            ],
            sourceClusterId: 'c1',
            confidence: 0.8,
          }],
        });
      } else if (callCount === 2) {
        // Reduce opus — 失败（quota exhausted / rate limit / etc）
        if (args.model.includes('opus')) {
          throw new Error('opus quota exceeded');
        }
        // Reduce sonnet (fallback) — 成功
        return makeLLMResponse({
          finalCandidates: [{
            candidateId: 'foo-design',
            title: 'Foo 与 Baz 协作',
            summary: 'Foo 调用 Baz 完成数据处理流程的核心环节',
            decision: 'Foo 委托 Baz 处理具体的数据转换和持久化任务',
            context: '需要分离职责让每个类只负责一个抽象层级以降低耦合',
            consequences: '提升可测试性、保持单一职责清晰边界、降低跨层耦合度',
            evidenceRefs: [
              { source: 'src/foo.ts', location: 'L1-3', snippet: 'class Foo {\n  bar() {}\n}' },
              { source: 'src/baz.ts', location: 'L1-3', snippet: 'class Baz {\n  qux() {}\n}' },
            ],
            sourceClusterId: 'merged',
            confidence: 0.8,
            mergedFromClusters: ['c1'],
          }],
        });
      } else if (callCount === 3) {
        // Reduce sonnet fallback
        return makeLLMResponse({
          finalCandidates: [{
            candidateId: 'foo-design',
            title: 'Foo 与 Baz 协作',
            summary: 'Foo 调用 Baz 完成数据处理流程的核心环节',
            decision: 'Foo 委托 Baz 处理具体的数据转换和持久化任务',
            context: '需要分离职责让每个类只负责一个抽象层级以降低耦合',
            consequences: '提升可测试性、保持单一职责清晰边界、降低跨层耦合度',
            evidenceRefs: [
              { source: 'src/foo.ts', location: 'L1-3', snippet: 'class Foo {\n  bar() {}\n}' },
              { source: 'src/baz.ts', location: 'L1-3', snippet: 'class Baz {\n  qux() {}\n}' },
            ],
            sourceClusterId: 'merged',
            confidence: 0.8,
            mergedFromClusters: ['c1'],
          }],
        });
      }
      throw new Error('unexpected');
    });

    const result = await runAdrMapReduce({
      anthropicClient: fakeAnthropic(),
      modules,
      projectRoot: tmpDir,
    });

    expect(result.reduceFallbackTriggered).toBe(true);
    expect(result.generatedByModel.reduce).toContain('sonnet');
    expect(result.failClosed).toBe(false);
  });

  it('case 3: evidence 校验 gate — verified < 2 的 candidate 被丢弃', async () => {
    // 不写文件 → 所有 evidenceRefs 都 verified=false (file-not-found)
    const modules = [makeModule('src/x', 'X 是核心', 'X 处理')];

    let callCount = 0;
    mockMessagesCreate.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return makeLLMResponse({
          candidates: [{
            candidateId: 'x',
            title: 'X 设计决策',
            summary: 'X 模块提供 X 处理能力用于下游编排和业务流程',
            decision: 'X 模块实现 X 接口完成业务处理的核心功能与监控',
            context: '需要 X 处理能力来支持下游业务流程的编排和重试',
            consequences: '获得 X 处理能力，可用于上层编排逻辑及监控告警',
            evidenceRefs: [
              { source: 'src/fake1.ts', location: 'L1-5', snippet: 'fake1' },
              { source: 'src/fake2.ts', location: 'L1-5', snippet: 'fake2' },
            ],
            sourceClusterId: 'c1',
            confidence: 0.8,
          }],
        });
      } else if (callCount === 2) {
        return makeLLMResponse({
          finalCandidates: [{
            candidateId: 'x',
            title: 'X 设计决策',
            summary: 'X 模块提供 X 处理能力用于下游编排和业务流程',
            decision: 'X 模块实现 X 接口完成业务处理的核心功能与监控',
            context: '需要 X 处理能力来支持下游业务流程的编排和重试',
            consequences: '获得 X 处理能力，可用于上层编排逻辑及监控告警',
            evidenceRefs: [
              { source: 'src/fake1.ts', location: 'L1-5', snippet: 'fake1' },
              { source: 'src/fake2.ts', location: 'L1-5', snippet: 'fake2' },
            ],
            sourceClusterId: 'merged',
            confidence: 0.8,
            mergedFromClusters: ['c1'],
          }],
        });
      }
      throw new Error('unexpected');
    });

    const result = await runAdrMapReduce({
      anthropicClient: fakeAnthropic(),
      modules,
      projectRoot: tmpDir,
    });

    // 全部 candidate 的 evidence 都 file-not-found，被丢弃 → fail-closed
    expect(result.failClosed).toBe(true);
    expect(result.failClosedReason).toBe('no-verified-evidence');
    expect(result.finalCandidates.length).toBe(0);
  });

  it('case 4: Map 全失败 → fail-closed (map-below-threshold)', async () => {
    const modules = [
      makeModule('src/a', 'A', 'A'),
      makeModule('src/b', 'B', 'B'),
      makeModule('src/c', 'C', 'C'),
    ];
    mockMessagesCreate.mockRejectedValue(new Error('mock LLM unavailable'));

    const result = await runAdrMapReduce({
      anthropicClient: fakeAnthropic(),
      modules,
      projectRoot: tmpDir,
    });

    expect(result.failClosed).toBe(true);
    expect(result.failClosedReason).toBe('map-below-threshold');
    expect(result.finalCandidates).toEqual([]);
  });

  it('case 5: empty modules → fail-closed (clustering-failed via 0 cluster)', async () => {
    const result = await runAdrMapReduce({
      anthropicClient: fakeAnthropic(),
      modules: [],
      projectRoot: tmpDir,
    });
    // 空 modules → cluster orchestrator 单 cluster of [] → Map 调用空 cluster → 取决于 LLM
    // 这里 mock 没设响应，会抛错 → fail-closed
    expect(result.failClosed).toBe(true);
  });

  it('case 6: totalTokens 累计 Map + Reduce', async () => {
    writeFile('src/foo.ts', 'class Foo {}\n');
    writeFile('src/bar.ts', 'class Bar {}\n');
    const modules = [
      makeModule('src/foo', 'Foo', 'Foo 与 Bar'),
      makeModule('src/foo/bar', 'Bar', 'Bar 辅助'),
    ];
    let callCount = 0;
    mockMessagesCreate.mockImplementation(async () => {
      callCount++;
      const input = 1000 * callCount;
      const output = 500 * callCount;
      const data = callCount === 1
        ? {
            candidates: [{
              candidateId: 'foo',
              title: 'Foo Bar 设计',
              summary: 'Foo 与 Bar 协作完成 X 流程的核心数据处理与持久化',
              decision: 'Foo 调用 Bar 完成关键的数据转换、校验和持久化任务',
              context: '需要分离职责让每个类专注一个抽象层级以降低复杂度',
              consequences: '提升可测试性、保持单一职责、降低耦合度并方便重构',
              evidenceRefs: [
                { source: 'src/foo.ts', location: 'L1', snippet: 'class Foo {}' },
                { source: 'src/bar.ts', location: 'L1', snippet: 'class Bar {}' },
              ],
              sourceClusterId: 'c1',
              confidence: 0.8,
            }],
          }
        : {
            finalCandidates: [{
              candidateId: 'foo',
              title: 'Foo Bar 设计',
              summary: 'Foo 与 Bar 协作完成 X 流程的核心数据处理与持久化',
              decision: 'Foo 调用 Bar 完成关键的数据转换、校验和持久化任务',
              context: '需要分离职责让每个类专注一个抽象层级以降低复杂度',
              consequences: '提升可测试性、保持单一职责、降低耦合度并方便重构',
              evidenceRefs: [
                { source: 'src/foo.ts', location: 'L1', snippet: 'class Foo {}' },
                { source: 'src/bar.ts', location: 'L1', snippet: 'class Bar {}' },
              ],
              sourceClusterId: 'merged',
              confidence: 0.8,
              mergedFromClusters: ['c1'],
            }],
          };
      return makeLLMResponse(data, input, output);
    });

    const result = await runAdrMapReduce({
      anthropicClient: fakeAnthropic(),
      modules,
      projectRoot: tmpDir,
    });

    // Map (1000+500) + Reduce (2000+1000) = 3000 input + 1500 output
    expect(result.totalTokens.input).toBe(3000);
    expect(result.totalTokens.output).toBe(1500);
  });
});
