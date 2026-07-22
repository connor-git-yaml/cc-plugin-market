/**
 * batch 子命令
 * 对当前项目执行批量 Spec 生成
 */

import { resolve } from 'node:path';
import { runBatch, buildAstGraphOnly } from '../../batch/batch-orchestrator.js';
import { resolveRegenPlan } from '../../batch/regen-plan.js';
import { resolveAuthGate, handleError, printError, EXIT_CODES } from '../utils/error-handler.js';
import { loadProjectConfig, mergeConfig } from '../../config/project-config.js';
import { readBatchConcurrency } from '../../config/spec-driver-config.js';
import type { CLICommand } from '../utils/parse-args.js';

/**
 * Feature 146：解析 batch 并发数。
 * 优先级：CLI flag --concurrency=N > spec-driver.config.yaml batch.concurrency > 默认值 3
 * 边界规范化（<=0、非整数）由 runBatch 内部统一处理，此处只决定来源。
 */
function resolveBatchConcurrency(
  cliConcurrency: number | undefined,
  projectRoot: string,
): number {
  if (typeof cliConcurrency === 'number') {
    return cliConcurrency;
  }
  const fromConfig = readBatchConcurrency(projectRoot);
  if (typeof fromConfig === 'number') {
    return fromConfig;
  }
  return 3;
}

/**
 * 执行 batch 子命令
 */
export async function runBatchCommand(command: CLICommand, version: string): Promise<void> {
  console.log(`spectra v${version} — 批量生成`);

  try {
    // 解析目标路径：优先使用 CLI 传入的 target，其次使用 cwd
    const projectRoot = resolve(command.target ?? process.cwd());

    // 加载项目级配置并与 CLI 参数合并
    const fileConfig = loadProjectConfig(projectRoot);
    const merged = mergeConfig(
      {
        force: command.force,
        incremental: command.incremental,
        languages: command.languages,
        outputDir: command.outputDir,
      },
      fileConfig,
      command._explicitFlags ?? new Set(),
    );

    // F195：graph-only 零 LLM 建图——在认证门控之前拦截并 dispatch 到姊妹管线。
    // why 不做认证门控：graph-only 纯 AST、不调任何 LLM，行为对齐 prepare（FR-005）。
    // why 放在 projectRoot + config merge 之后：buildAstGraphOnly 需要 projectRoot 与 outputDir。
    if (command.batchMode === 'graph-only') {
      if (command.languages?.length) {
        console.warn('⚠ graph-only 不支持 --languages 过滤，将构建全仓 AST 图');
      }
      if (command.requireLlm) {
        console.warn('⚠ graph-only 不调用 LLM，--require-llm 对本次运行无效');
      }
      const graphResult = await buildAstGraphOnly(projectRoot, {
        outputDir: merged.outputDir,
      });
      console.log('  模式: graph-only（纯 AST · 零 LLM）');
      console.log(
        `  节点: ${graphResult.nodeCount} | 边: ${graphResult.edgeCount} ` +
          `(calls ${graphResult.callEdgeCount}, depends-on ${graphResult.dependsOnEdgeCount}) ` +
          `| Python 符号: ${graphResult.pythonSymbolCount} | 耗时: ${(graphResult.durationMs / 1000).toFixed(1)}s`,
      );
      console.log(`✓ 知识图谱: ${graphResult.graphPath}`);
      process.exitCode = EXIT_CODES.SUCCESS;
      return;
    }

    // 非 graph-only 路径：spec-gen 需要认证；零认证时默认降级为 AST-only，
    // 仅 --require-llm 才阻断（Feature 222）。
    // why 排除 dry-run：runBatch 在 AST 聚合后即产出预估报告返回，与 graph-only 同属零 LLM
    // 路径，既不会真的降级（提示会失实），也不该被 --require-llm 无意义阻断。
    if (command.dryRun) {
      // 对齐 graph-only：零 LLM 路径下 --require-llm 无从校验，静默 exit 0 会被误读成
      // "认证已通过"，故必须显式声明该 flag 不适用（dry-run 不能当严格运行的预检）。
      if (command.requireLlm) {
        console.warn('⚠ --dry-run 不调用 LLM，--require-llm 对本次运行无效（认证未被校验）');
      }
    } else if (!resolveAuthGate(command.requireLlm ?? false)) {
      process.exitCode = EXIT_CODES.API_ERROR;
      return;
    }

    // F175 FR-002：合并后统一解析 regen 计划（唯一默认值来源，消除三处漂移）。
    // --full（regen 轴逃生口）仅来自 CLI，不参与 config 合并；--force 为等义别名（已合并）。
    const regenPlan = resolveRegenPlan({
      incremental: merged.incremental,
      full: command.full,
      force: merged.force,
    });

    // Feature 135 Bug 4：reading 模式 TTY hint
    // 避免用户误以为 reading 模式是"快速模式"——模块级 LLM 仍会运行
    if (command.batchMode === 'reading' && process.stdout.isTTY) {
      console.log(
        '提示：reading 模式省约 38% 时间，但模块级 LLM 仍运行（非快速模式）。\n' +
        '如需进一步跳过 enrichment 层，可使用 --mode code-only（注：仍逐模块调 spec-gen LLM，非零成本）',
      );
    }

    const result = await runBatch(projectRoot, {
      // F175：传入已解析的 RegenPlan 真值（runBatch 内对直接调用方仍会兜底解析，幂等）。
      incremental: regenPlan.incremental,
      full: regenPlan.full,
      languages: merged.languages,
      outputDir: merged.outputDir,
      concurrency: resolveBatchConcurrency(command.concurrency, projectRoot),
      // Feature 107：多模态提取标志（不纳入配置文件合并，仅从 CLI 传入）
      includeDocs: command.includeDocs,
      includeImages: command.includeImages,
      // Feature 127：dry-run + 预算守护
      dryRun: command.dryRun,
      budget: command.batchBudget,
      onOverBudget: command.onOverBudget,
      // F5：批处理运行模式
      mode: command.batchMode,
      // F5 Story 3：graph.html 生成 flag
      generateHtml: command.generateHtml,
      // Feature 133（adversarial-review post-fix）：hyperedge LLM 提取（默认 false）
      hyperedgesEnabled: command.hyperedgesEnabled,
      // Feature 135 Bug 1：ADR pipeline 默认禁用，需用 --enable-adr 显式开启
      enableAdr: command.enableAdr ?? false,
    });
    console.log(`  模块总数: ${result.totalModules} | 成功: ${result.successful.length} | 降级: ${result.degraded.length} | 失败: ${result.failed.length} | 跳过: ${result.skipped.length}`);

    // Feature 222：降级不只是汇总行里的一个数字，质量降档要第一时间可见
    if (result.degraded.length > 0) {
      const pct = ((result.degraded.length / Math.max(result.totalModules, 1)) * 100).toFixed(0);
      console.warn(
        `⚠ ${result.degraded.length}/${result.totalModules} 个模块（${pct}%）因 LLM 未成功产出` +
          '（未配置认证，或调用失败 / 重试耗尽）降级为 AST-only。' +
          '如需完整 LLM 增强，请排查认证与网络后使用 --force 重新生成。',
      );
    }

    if (result.indexGenerated) {
      console.log(`✓ specs/_index.spec.md 已生成`);
    }
    if (result.docGraphPath) {
      console.log(`✓ 文档图谱: ${result.docGraphPath}`);
    }
    if (result.graphHtmlPath) {
      console.log(`✓ 图谱可视化: ${result.graphHtmlPath}`);
    }
    if (result.coverageReportPath) {
      console.log(`✓ 覆盖率审计: ${result.coverageReportPath}`);
    }
    if (result.deltaReportPath) {
      console.log(`✓ 差量报告: ${result.deltaReportPath}`);
    }
    if (result.projectDocs && result.projectDocs.length > 0) {
      const preview = result.projectDocs.slice(0, 6).join(', ');
      const suffix = result.projectDocs.length > 6 ? ` ... 共 ${result.projectDocs.length} 个` : '';
      console.log(`✓ 项目级文档: ${preview}${suffix}`);
    }
    if (result.docsBundleManifestPath) {
      console.log(`✓ 文档 Bundle: ${result.docsBundleManifestPath}`);
    }
    if (result.docsBundleProfiles && result.docsBundleProfiles.length > 0) {
      const preview = result.docsBundleProfiles
        .map((profile) => `${profile.id}(${profile.documentCount})`)
        .join(', ');
      console.log(`✓ Bundle Profiles: ${preview}`);
    }
    if (result.summaryLogPath) {
      console.log(`✓ 日志: ${result.summaryLogPath}`);
    }
    // Feature 127：dry-run / 预算决策输出
    if (result.dryRunReportPath) {
      console.log(`✓ Dry-run 预估报告: ${result.dryRunReportPath}`);
    }
    if (result.budgetDecision) {
      console.log(`✓ 预算决策: ${result.budgetDecision.policy}（${result.budgetDecision.message}）`);
    }

    // Feature 135 Bug 1：ADR pipeline 临时禁用时打印 hint（仅 TTY，与 reading mode hint 保持一致风格）
    if (!command.enableAdr && process.stdout.isTTY) {
      console.log('⚠ ADR pipeline 在 v4.0.1 临时禁用。可用 --enable-adr 显式开启（预计 v4.1 重构后恢复默认）');
    }

    // Feature 222：入口门控只能拦"整机零认证"，运行期 LLM 失败同样会降级，
    // 因此 --require-llm 必须在汇总后再校验一次真实产物质量。
    // 提示无条件打印（用户始终需要知道降级发生了），退出码则交给下面的优先级链裁决。
    //
    // 已知边界（本次不修）：本校验只覆盖"本次真的生成了"的模块。增量 cache 命中的模块
    // 记为 skipped 而非 degraded，且 delta-regenerator 仅比对 skeletonHash、不检查已有
    // spec 是否为 AST-only 产物——因此「首次严格运行写下降级产物并 exit 2 → 第二次同命令
    // 走增量 cache → exit 0」的路径依然存在。彻底修复需把 LLM 状态持久化进 cache 元数据
    // 并让严格模式拒绝复用未证明为 LLM-enhanced 的缓存，改动面超出本次范围。
    // 需要严格语义的 CI 请配合 --full / --force 使用。
    const requireLlmViolated = Boolean(command.requireLlm) && result.degraded.length > 0;
    if (requireLlmViolated) {
      printError(
        `--require-llm 已指定，但有 ${result.degraded.length} 个模块降级为 AST-only（LLM 未成功产出）。\n` +
          '  注意：降级产物已写入磁盘（校验发生在写盘之后），' +
          '若它们覆盖了此前更高质量的 Spec，请从 git 恢复旧版本。',
      );
    }

    // Feature 127（Codex review 修复）：预算 cancel 必须返回非零 exit 让 CI 能识别。
    // 优先级：failed > require-llm-degraded > budget-cancel > success。
    // why require-llm 排在 failed 之后：模块根本没生成出来（failed）比"生成了但质量降档"
    // （degraded）更根本，同时命中时 CI 应先看到 TARGET_ERROR，避免更严重的失败被
    // API_ERROR 掩盖成"只是没认证"。
    if (result.failed.length > 0) {
      process.exitCode = EXIT_CODES.TARGET_ERROR;
    } else if (requireLlmViolated) {
      process.exitCode = EXIT_CODES.API_ERROR;
    } else if (result.budgetDecision?.policy === 'cancel') {
      process.exitCode = EXIT_CODES.BUDGET_EXCEEDED;
    } else {
      process.exitCode = EXIT_CODES.SUCCESS;
    }
  } catch (err) {
    process.exitCode = handleError(err);
  }
}
