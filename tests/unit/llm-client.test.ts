/**
 * llm-client 单元测试
 * 验证 parseLLMResponse、buildSystemPrompt（不调用真实 API）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Feature 238 Slice 4 — mock 认证探测入口与子进程 spawn，用于 callLLM() codex 分支
// modelFlagMode 决策矩阵的端到端回归测试（FR-304/305/306，SC-007）。
// 与 codex-proxy.test.ts / llm-client-token-extraction.test.ts 已用手法一致。
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
vi.mock('../../src/auth/auth-detector.js', () => ({ detectAuth: vi.fn() }));

import { spawn } from 'node:child_process';
import { detectAuth } from '../../src/auth/auth-detector.js';
import type { AuthDetectionResult } from '../../src/auth/auth-detector.js';
import {
  callLLM,
  parseLLMResponse,
  buildSystemPrompt,
  getTimeoutForModel,
  getTimeoutForSpecGeneration,
} from '../../src/core/llm-client.js';
import { getCanonicalSonnetModelId } from '../../src/core/model-selection.js';
import type { AssembledContext } from '../../src/core/context-assembler.js';

const mockedSpawn = vi.mocked(spawn);
const mockedDetectAuth = vi.mocked(detectAuth);

const CODEX_AUTH_RESULT: AuthDetectionResult = {
  methods: [],
  preferred: { type: 'cli-proxy', provider: 'codex', available: true, details: '' },
  diagnostics: [],
};

const TEST_CONTEXT: AssembledContext = {
  prompt: 'irrelevant in mock',
  tokenCount: 50,
  truncated: false,
} as AssembledContext;

function createMockChild() {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();

  const stdinChunks: string[] = [];
  child.stdin = new Writable({
    write(chunk: Buffer, _encoding: string, callback: () => void) {
      stdinChunks.push(chunk.toString());
      callback();
    },
  });
  child._stdinChunks = stdinChunks;
  child.kill = vi.fn();

  return child;
}

/** 模拟一次成功的 Codex CLI exec 输出（agent_message + turn.completed + result） */
function emitSuccessfulCodexRun(mockChild: ReturnType<typeof createMockChild>): void {
  mockChild.stdout.emit('data', Buffer.from('{"type":"item.completed","item":{"type":"agent_message","text":"ok"}}\n'));
  mockChild.stdout.emit('data', Buffer.from('{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}\n'));
  mockChild.stdout.emit('data', Buffer.from('{"type":"result","is_error":false}\n'));
  mockChild.emit('close', 0);
}

describe('llm-client', () => {
  describe('parseLLMResponse', () => {
    it('应解析完整的 9 章节响应', () => {
      const raw = `## 1. 意图
此模块用于处理用户认证

## 2. 业务逻辑
验证用户凭证并生成 JWT token

## 3. 接口定义
导出 login() 和 logout() 函数

## 4. 数据结构
User 类型包含 id、name、email 字段

## 5. 约束条件
JWT 过期时间默认 24 小时

## 6. 边界条件
密码为空时抛出 ValidationError

## 7. 技术债务
缺少密码强度验证

## 8. 测试覆盖
覆盖了登录成功和失败场景

## 9. 依赖关系
依赖 jsonwebtoken 和 bcrypt`;

      const result = parseLLMResponse(raw);

      expect(result.sections.intent).toContain('用户认证');
      expect(result.sections.interfaceDefinition).toContain('login');
      expect(result.sections.businessLogic).toContain('JWT');
      expect(result.sections.dataStructures).toContain('User');
      expect(result.sections.constraints).toContain('24 小时');
      expect(result.sections.edgeCases).toContain('ValidationError');
      expect(result.sections.technicalDebt).toContain('密码强度');
      expect(result.sections.testCoverage).toContain('登录');
      expect(result.sections.dependencies).toContain('jsonwebtoken');
      expect(result.parseWarnings).toHaveLength(0);
    });

    it('缺失章节应记录警告并设为空字符串（不注入占位符）', () => {
      const raw = `## 1. 意图
此模块用于测试

## 2. 业务逻辑
无导出`;

      const result = parseLLMResponse(raw);

      // 应有 7 个缺失章节的警告
      expect(result.parseWarnings.length).toBeGreaterThan(0);
      // 正常 LLM 流程不注入占位符，缺失章节为空字符串（FR-002/FR-003）
      expect(result.sections.interfaceDefinition).toBe('');
    });

    it('应提取不确定性标记', () => {
      const raw = `## 1. 意图
此模块 [推断: 基于函数命名] 用于数据转换

## 2. 业务逻辑
[不明确: 缺少类型信息] 可能进行了类型转换

## 3. 接口定义
接口定义

## 4. 数据结构
数据结构

## 5. 约束条件
约束

## 6. 边界条件
[SYNTAX ERROR: 解析失败] 部分代码

## 7. 技术债务
债务

## 8. 测试覆盖
覆盖

## 9. 依赖关系
依赖`;

      const result = parseLLMResponse(raw);

      expect(result.uncertaintyMarkers).toHaveLength(3);

      const types = result.uncertaintyMarkers.map((m) => m.type);
      expect(types).toContain('推断');
      expect(types).toContain('不明确');
      expect(types).toContain('SYNTAX ERROR');

      const inferMarker = result.uncertaintyMarkers.find((m) => m.type === '推断');
      expect(inferMarker?.rationale).toContain('基于函数命名');
    });

    it('空响应应返回全部警告，章节为空字符串（不注入占位符）', () => {
      const result = parseLLMResponse('');

      // 所有 9 个章节都应该有警告
      expect(result.parseWarnings.length).toBe(9);
      // 正常 LLM 流程不注入占位符，缺失章节为空字符串（FR-002/FR-003）
      expect(result.sections.intent).toBe('');
    });

    it('应处理非标准标题格式', () => {
      const raw = `# 意图
模块目的

### 2. 业务逻辑
导出信息`;

      const result = parseLLMResponse(raw);

      expect(result.sections.intent).toContain('模块目的');
      expect(result.sections.businessLogic).toContain('导出信息');
    });
  });

  describe('buildSystemPrompt', () => {
    it('spec-generation 模式应包含关键指令', () => {
      const prompt = buildSystemPrompt('spec-generation');

      expect(prompt).toContain('9 个章节');
      expect(prompt).toContain('绝不捏造');
      expect(prompt).toContain('[推断');
      expect(prompt).toContain('中文');
    });

    it('semantic-diff 模式应包含变更分析指令', () => {
      const prompt = buildSystemPrompt('semantic-diff');

      expect(prompt).toContain('行为');
      expect(prompt).toContain('漂移');
      expect(prompt).toContain('HIGH');
      expect(prompt).toContain('MEDIUM');
      expect(prompt).toContain('LOW');
    });

    it('两种模式应返回不同内容', () => {
      const specPrompt = buildSystemPrompt('spec-generation');
      const diffPrompt = buildSystemPrompt('semantic-diff');

      expect(specPrompt).not.toBe(diffPrompt);
    });

    it('无 terminology 时应默认使用 TypeScript 术语', () => {
      const prompt = buildSystemPrompt('spec-generation');

      expect(prompt).toContain('typescript');
      expect(prompt).toContain('ES Modules');
    });

    it('传入 Python terminology 时应使用 Python 术语', () => {
      const pythonTerms = {
        codeBlockLanguage: 'python',
        exportConcept: '公开函数/类（__all__ 中列出的符号）',
        importConcept: 'import / from...import 导入',
        typeSystemDescription: '动态类型 + 可选类型注解（PEP 484）',
        interfaceConcept: 'Protocol (PEP 544) / ABC 抽象基类',
        moduleSystem: 'Python 包和模块系统',
      };
      const prompt = buildSystemPrompt('spec-generation', pythonTerms);

      expect(prompt).toContain('python');
      expect(prompt).toContain('公开函数/类');
      expect(prompt).toContain('Python 包和模块系统');
      expect(prompt).toContain('Protocol (PEP 544)');
      // 不应包含 TypeScript 默认术语
      expect(prompt).not.toContain('ES Modules / CommonJS');
    });

    it('传入 Go terminology 时应使用 Go 术语', () => {
      const goTerms = {
        codeBlockLanguage: 'go',
        exportConcept: '导出标识符（首字母大写的函数/类型/常量）',
        importConcept: 'import 导入',
        typeSystemDescription: '静态类型系统 + 结构化类型（structural typing）',
        interfaceConcept: 'interface 接口（隐式实现）',
        moduleSystem: 'Go Modules',
      };
      const prompt = buildSystemPrompt('spec-generation', goTerms);

      expect(prompt).toContain('go');
      expect(prompt).toContain('导出标识符（首字母大写');
      expect(prompt).toContain('Go Modules');
    });

    it('terminology 应影响语言上下文章节', () => {
      const terms = {
        codeBlockLanguage: 'rust',
        exportConcept: 'pub 标记的函数/结构体/枚举/trait',
        importConcept: 'use 导入',
        typeSystemDescription: '所有权系统 + 生命周期 + 泛型',
        interfaceConcept: 'trait',
        moduleSystem: 'Cargo crates 和 mod 模块',
      };
      const prompt = buildSystemPrompt('spec-generation', terms);

      expect(prompt).toContain('目标代码语言：**rust**');
      expect(prompt).toContain('所有权系统');
      expect(prompt).toContain('trait');
      expect(prompt).toContain('Cargo crates');
    });
  });

  describe('getTimeoutForModel', () => {
    it('Codex 模型应使用 5 分钟超时窗口', () => {
      expect(getTimeoutForModel('gpt-5.3-codex')).toBe(300_000);
      expect(getTimeoutForModel('gpt-5.3-codex-thinking-high')).toBe(300_000);
      expect(getTimeoutForModel('gpt-5.4')).toBe(300_000);
    });

    it('Sonnet 模型应为大规格生成预留 10 分钟超时窗口', () => {
      expect(getTimeoutForModel('claude-3-7-sonnet')).toBe(600_000);
      expect(getTimeoutForModel('sonnet-4')).toBe(600_000);
    });

    it('未知模型仍回退到保守默认值', () => {
      expect(getTimeoutForModel('custom-model')).toBe(180_000);
    });
  });

  describe('getTimeoutForSpecGeneration', () => {
    it('小上下文保持模型默认超时', () => {
      expect(getTimeoutForSpecGeneration('gpt-5.4', 39_999)).toBe(300_000);
      expect(getTimeoutForSpecGeneration('custom-model', 10_000)).toBe(180_000);
    });

    it('大上下文按 token 体积扩展超时窗口', () => {
      expect(getTimeoutForSpecGeneration('gpt-5.4', 55_000)).toBe(420_000);
      expect(getTimeoutForSpecGeneration('gpt-5.4', 83_207)).toBe(660_000);
      expect(getTimeoutForSpecGeneration('gpt-5.4', 94_266)).toBe(780_000);
    });

    it('扩展超时窗口最多封顶到 15 分钟', () => {
      expect(getTimeoutForSpecGeneration('gpt-5.4', 200_000)).toBe(900_000);
    });

    // Feature 238 Slice 4 — FR-305(b)/307：delegate 场景走显式前缀分支，非字符串误判
    it('T4.9 delegated: 前缀恒返回保守档 300000（非关键字巧合匹配）', () => {
      expect(getTimeoutForModel('delegated:gpt-5.4')).toBe(300_000);
      expect(getTimeoutForModel('delegated:whatever-unknown-string')).toBe(300_000);
    });
  });

  // Feature 238 Slice 4 — callLLM() codex 分支 modelFlagMode 决策矩阵端到端回归
  // （FR-304/305/306，SC-007）
  describe('callLLM codex 分支 modelFlagMode 决策（Feature 238 Slice 4）', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('T4.7 调用方显式传入 model 时无条件走 required 分支，result.model 不带 delegated: 前缀（FR-306 互斥回归锁定）', async () => {
      mockedDetectAuth.mockReturnValue(CODEX_AUTH_RESULT);
      const mockChild = createMockChild();
      mockedSpawn.mockReturnValue(mockChild);

      const promise = callLLM(TEST_CONTEXT, { model: getCanonicalSonnetModelId('codex') });
      emitSuccessfulCodexRun(mockChild);
      const result = await promise;

      const spawnCall = mockedSpawn.mock.calls[0]!;
      const args = spawnCall[1] as string[];
      expect(args).toContain('--model');
      expect(result.model).not.toMatch(/^delegated:/);
    });

    it('T4.12b 生产链 E2E：无配置 + 未传 model → 全链路 delegate（SC-007）', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'llm-client-delegate-'));
      const originalCwd = process.cwd();
      const originalEnv = process.env;
      process.env = { ...originalEnv };
      delete process.env['REVERSE_SPEC_MODEL'];
      delete process.env['CODEX_THREAD_ID'];
      delete process.env['CODEX_SHELL'];
      delete process.env['CODEX_INTERNAL_ORIGINATOR_OVERRIDE'];

      try {
        process.chdir(tempDir);
        mockedDetectAuth.mockReturnValue(CODEX_AUTH_RESULT);
        const mockChild = createMockChild();
        mockedSpawn.mockReturnValue(mockChild);

        const promise = callLLM(TEST_CONTEXT);
        emitSuccessfulCodexRun(mockChild);
        const result = await promise;

        const spawnCall = mockedSpawn.mock.calls[0]!;
        const args = spawnCall[1] as string[];
        expect(args).not.toContain('--model');
        expect(result.model).toMatch(/^delegated:/);
      } finally {
        process.chdir(originalCwd);
        process.env = originalEnv;
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    // Codex implement 审查修复轮 C1 — 攻击用例：REVERSE_SPEC_MODEL 本身携带
    // `delegated:` 前缀伪装字面量。旧实现只认 `cfg.model.startsWith('delegated:')`
    // 判定 delegate，这个字符串信号完全由外部输入（env/config/调用方参数）控制，
    // 可被伪装绕过——env 显式设置本应恒 required（决策矩阵第 1 行），但若 proxy
    // 侧只看字符串前缀，`delegated:pin` 会被误判为 delegate 场景静默省略 --model，
    // 导致本应生效的显式 pin 被吞掉。修复后必须仍在 spawn args 中原样体现。
    it('C1 攻击用例：REVERSE_SPEC_MODEL="delegated:pin" 伪装 → env required 判定不被绕过，spawn args 含 --model delegated:pin', async () => {
      const originalEnv = process.env;
      process.env = { ...originalEnv, REVERSE_SPEC_MODEL: 'delegated:pin' };

      try {
        mockedDetectAuth.mockReturnValue(CODEX_AUTH_RESULT);
        const mockChild = createMockChild();
        mockedSpawn.mockReturnValue(mockChild);

        const promise = callLLM(TEST_CONTEXT);
        emitSuccessfulCodexRun(mockChild);
        const result = await promise;

        const spawnCall = mockedSpawn.mock.calls[0]!;
        const args = spawnCall[1] as string[];
        expect(args).toContain('--model');
        expect(args[args.indexOf('--model') + 1]).toBe('delegated:pin');
        expect(result.model).toBe('delegated:pin');
      } finally {
        process.env = originalEnv;
      }
    });
  });
});
