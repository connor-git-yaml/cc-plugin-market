/**
 * Feature 135 Bug 1 + Bug 2：ADR guard + hyperedges WARNING 结构断言
 *
 * 通过静态源码分析验证：
 * - Bug 1：generateBatchProjectDocs 的 enableAdr guard 已接入
 * - Bug 2：!semanticIntegrationAllowed 分支已升级为 logger.warn
 * - Bug 2：designDocAbsPaths 为空时的 WARNING 消息已接入
 *
 * 运行时行为（generateBatchAdrDocs 未被调用 / logger.warn 被调用）需要
 * 真实 LLM 调用，标注 [E2E_DEFERRED]，通过 verify 阶段手动验证。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const BATCH_PROJECT_DOCS_PATH = resolve(
  import.meta.dirname,
  '../../src/panoramic/batch-project-docs.ts',
);

const BATCH_ORCHESTRATOR_PATH = resolve(
  import.meta.dirname,
  '../../src/batch/batch-orchestrator.ts',
);

const PARSE_ARGS_PATH = resolve(
  import.meta.dirname,
  '../../src/cli/utils/parse-args.ts',
);

const BATCH_COMMAND_PATH = resolve(
  import.meta.dirname,
  '../../src/cli/commands/batch.ts',
);

// ====================================================================
// Bug 1：ADR pipeline 默认禁用 guard（Feature 135）
// ====================================================================

describe('Feature 135 Bug 1：ADR pipeline guard 结构验证', () => {
  const batchProjectDocsSource = readFileSync(BATCH_PROJECT_DOCS_PATH, 'utf-8');
  const batchOrchestratorSource = readFileSync(BATCH_ORCHESTRATOR_PATH, 'utf-8');
  const parseArgsSource = readFileSync(PARSE_ARGS_PATH, 'utf-8');
  const batchCommandSource = readFileSync(BATCH_COMMAND_PATH, 'utf-8');

  it('GenerateBatchProjectDocsOptions 中存在 enableAdr 字段声明', () => {
    expect(batchProjectDocsSource).toContain('enableAdr');
  });

  it('generateBatchProjectDocs 中存在 options.enableAdr 的 guard 判断', () => {
    // 验证 if (options.enableAdr) 守卫存在
    expect(batchProjectDocsSource).toMatch(/if\s*\(\s*options\.enableAdr\s*\)/);
  });

  it('generateBatchAdrDocs 调用处被 enableAdr guard 包裹（不再裸调用）', () => {
    // 确认不存在裸调用（即 try { const adrDocs = generateBatchAdrDocs(...) 没有在 if 之前）
    // 通过验证 if(options.enableAdr) 在 generateBatchAdrDocs 之前出现来间接验证
    const enableAdrPos = batchProjectDocsSource.indexOf('if (options.enableAdr)');
    const adrDocsPos = batchProjectDocsSource.indexOf('generateBatchAdrDocs(');
    expect(enableAdrPos).toBeGreaterThan(-1);
    expect(adrDocsPos).toBeGreaterThan(-1);
    // guard 在 generateBatchAdrDocs 调用之前
    expect(enableAdrPos).toBeLessThan(adrDocsPos);
  });

  it('ADR 跳过分支存在 else 路径（打印 warn 并写入 disabled 信息）', () => {
    // 验证 } else { 出现在 ADR guard 后面（warn 路径）
    expect(batchProjectDocsSource).toContain('ADR pipeline 已临时禁用');
  });

  it('CLICommand 类型中存在 enableAdr 字段声明', () => {
    expect(parseArgsSource).toContain('enableAdr');
  });

  it('parse-args 中解析 --enable-adr flag', () => {
    expect(parseArgsSource).toContain('--enable-adr');
  });

  it('BatchOptions 中存在 enableAdr 字段', () => {
    expect(batchOrchestratorSource).toContain('enableAdr');
  });

  it('batch.ts 中传递 enableAdr 给 runBatch', () => {
    expect(batchCommandSource).toContain('enableAdr');
  });

  it('batch.ts 末尾打印 ADR 禁用 hint（当 !command.enableAdr 时）', () => {
    expect(batchCommandSource).toContain('ADR pipeline 在 v4.0.1 临时禁用');
  });
});

// ====================================================================
// Bug 2：hyperedges WARNING 可观测性（Feature 135）
// ====================================================================

describe('Feature 135 Bug 2：hyperedges WARNING 可观测性结构验证', () => {
  const source = readFileSync(BATCH_ORCHESTRATOR_PATH, 'utf-8');

  it('!semanticIntegrationAllowed 分支使用 logger.warn（不再是 logger.info）', () => {
    // 确保在 semanticIntegrationAllowed 相关代码区域出现 logger.warn
    expect(source).toMatch(/semanticIntegrationAllowed[\s\S]{0,300}logger\.warn/);
  });

  it('hyperedgesOptInEarly 或用户 opt-in 时向 stderr 打印 WARNING', () => {
    // 验证 process.stderr.write 存在于 hyperedge 相关区域
    expect(source).toContain('process.stderr.write');
  });

  it('designDocAbsPaths 为空且用户 opt-in 时打印前置条件未满足 WARNING', () => {
    expect(source).toContain('前置条件未满足');
  });

  it('designDocAbsPaths 为空时打印操作建议', () => {
    expect(source).toContain('请先不带 --hyperedges 完整运行一次 batch');
  });

  it('hyperedge 数量状态输出（T11）存在', () => {
    // 验证 hyperedgeCount 变量和 batch summary 状态输出
    expect(source).toContain('hyperedgeCount');
  });

  it('hyperedge WARNING 原因记录变量存在', () => {
    expect(source).toContain('hyperedgeWarningReason');
  });
});
