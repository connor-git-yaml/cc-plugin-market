/**
 * Feature 156 — `spectra index` 子命令 handler。
 *
 * 三种运行模式（W3 阶段全部实装）：
 *   spectra index               → 全量索引：扫描全部源文件 → buildUnifiedGraph →
 *                                  写入 .spectra/unified-graph.json（FR-11 / AC-9）
 *   spectra index --incremental → 一次性增量更新（FR-30 + buildIncremental 路径）
 *   spectra index --watch       → 持续监听模式（FR-12 + FileWatcher + buildIncremental 批量路径）
 *   spectra index --caller-depth N → 默认 1，clarify Q3 决议（接口预留 N）
 *
 * 进度输出（FR-14 SHOULD）：每个阶段输出一行机器可读 JSON（`scan` / `build` /
 * `save` / `done` / `diff` / `caller-expand` / `watch` / `fallback`），方便上游脚本用 `jq` 提取关键字段。
 *
 * --watch 与 --incremental 互斥（FR-30）：两个 flag 同时传入 → 错误 + exit 1。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { CLICommand } from '../utils/parse-args.js';
import { scanFiles } from '../../utils/file-scanner.js';
import { LanguageAdapterRegistry } from '../../adapters/language-adapter-registry.js';
import { analyzeFile } from '../../core/ast-analyzer.js';
import { buildUnifiedGraph } from '../../knowledge-graph/index.js';
import {
  buildSnapshotWrapper,
  computeAllFileHashes,
  saveSnapshot,
  snapshotPath,
} from '../../knowledge-graph/persistence.js';
import { buildIncremental } from '../../knowledge-graph/incremental.js';
import { FileWatcher, type FileChangeEvent } from '../../watcher/file-watcher.js';
import type { CodeSkeleton } from '../../models/code-skeleton.js';

const INDEX_HELP = `spectra index — 构建并持久化 UnifiedGraph snapshot

用法:
  spectra index                       全量索引（扫描所有源文件 + 写 .spectra/unified-graph.json）
  spectra index --incremental         一次性增量更新（基于 git diff + caller expansion）
  spectra index --watch               持续监听模式（chokidar + 批量 incremental，进程不退出）
  spectra index --caller-depth <N>    增量 caller 扩展深度（默认 1，接口预留 N）
  spectra index --git-range <ref>     post-commit hook 上下文的 git ref 范围（默认 'HEAD'，
                                       仅 --incremental 时生效；仅允许预设格式如 'ORIG_HEAD HEAD'）
  spectra index --project-root <dir>  指定项目根目录（默认 cwd）

说明:
  --watch 与 --incremental 互斥；同时传入将导致 exit 1。
  --watch 模式监听 .gitignore 之外的源码文件（chokidar v4 + .gitignore 过滤）。
  --incremental 在无 snapshot / shallow clone 等场景自动降级为全量索引（仍 exit 0）。

输出:
  {project-root}/.spectra/unified-graph.json    (pretty JSON，含 SnapshotWrapperSchema)

退出码:
  0  成功（含 --watch 用户 Ctrl+C / --incremental 降级 full）
  1  --watch 与 --incremental 互斥参数冲突，或 --project-root 不存在
  2  索引失败（文件读写 / AST 解析错误）`;

interface ProgressLine {
  phase:
    | 'scan'
    | 'build'
    | 'save'
    | 'done'
    | 'skip'
    | 'diff'
    | 'caller-expand'
    | 'watch'
    | 'fallback'
    | 'watch-ready';
  [key: string]: unknown;
}

/** 输出一行机器可读 JSON 进度（FR-14） */
function emit(line: ProgressLine): void {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

/**
 * 执行 spectra index 子命令。
 *
 * @param command 已解析的 CLICommand
 */
export async function runIndexCommand(command: CLICommand): Promise<void> {
  if (command.help) {
    console.log(INDEX_HELP);
    return;
  }

  // FR-30：--watch 与 --incremental 互斥
  if (command.indexWatch && command.indexIncremental) {
    console.error('[index] --watch 与 --incremental 互斥，不能同时传入');
    process.exitCode = 1;
    return;
  }

  // 默认值 = 1（FR-7 / clarify Q3）
  const callerDepth = command.indexCallerDepth ?? 1;
  const projectRoot = path.resolve(command.projectRoot ?? process.cwd());
  if (!fs.existsSync(projectRoot)) {
    console.error(`[index] 项目目录不存在: ${projectRoot}`);
    process.exitCode = 2;
    return;
  }

  // ── --watch 模式（持续监听）──
  if (command.indexWatch) {
    await runWatchMode(projectRoot, callerDepth);
    return;
  }

  // ── --incremental 模式（一次性增量）──
  if (command.indexIncremental) {
    await runIncrementalOnce(projectRoot, callerDepth, command.indexGitRange);
    return;
  }

  // ── 默认：全量索引 ──
  await runFullIndex(projectRoot);
}

// ───────────────────────────────────────────────────────────
// 全量索引（保持 W2 行为不变）
// ───────────────────────────────────────────────────────────

async function runFullIndex(projectRoot: string): Promise<void> {
  const t0 = Date.now();
  try {
    const registry = LanguageAdapterRegistry.getInstance();
    const supportedExts = registry.getSupportedExtensions();
    const scanResult = scanFiles(projectRoot, {
      projectRoot,
      extensions: supportedExts,
    });
    const absFiles = scanResult.files.map((rel) =>
      path.isAbsolute(rel) ? rel : path.join(projectRoot, rel),
    );
    emit({ phase: 'scan', files: absFiles.length });

    if (absFiles.length === 0) {
      emit({ phase: 'skip', reason: 'no-source-files' });
    }

    const tBuild0 = Date.now();
    const codeSkeletons = new Map<string, CodeSkeleton>();
    for (const absFile of absFiles) {
      try {
        const sk = await analyzeFile(absFile, { projectRoot });
        if (sk) codeSkeletons.set(absFile, sk);
      } catch (err) {
        console.error(
          `[index] analyzeFile 失败 (${absFile}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const graph = buildUnifiedGraph({ projectRoot, codeSkeletons });
    emit({
      phase: 'build',
      duration_ms: Date.now() - tBuild0,
      nodes: graph.nodes.length,
      edges: graph.edges.length,
    });

    const fileHashes = await computeAllFileHashes(projectRoot, absFiles);

    const tSave0 = Date.now();
    const snapshot = buildSnapshotWrapper(graph, fileHashes);
    await saveSnapshot(snapshot, projectRoot);
    const targetPath = snapshotPath(projectRoot);
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(targetPath).size;
    } catch {
      /* 文件应该存在，仅统计用 */
    }
    emit({
      phase: 'save',
      path: path.relative(projectRoot, targetPath),
      size_bytes: sizeBytes,
      duration_ms: Date.now() - tSave0,
    });

    emit({
      phase: 'done',
      mode: 'full',
      total_ms: Date.now() - t0,
      changedFiles: -1,
    });
  } catch (err) {
    console.error(
      `[index] 索引失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 2;
  }
}

// ───────────────────────────────────────────────────────────
// --incremental 一次性增量
// ───────────────────────────────────────────────────────────

async function runIncrementalOnce(
  projectRoot: string,
  callerDepth: number,
  gitRange?: string,
): Promise<void> {
  const t0 = Date.now();
  try {
    const tBuild0 = Date.now();
    const result = await buildIncremental({ projectRoot, callerDepth, gitRange });

    if (result.fallbackToFull) {
      // 输出 fallback 信号，但保持 exit 0（git hook 兼容）
      emit({ phase: 'fallback', reason: result.fallbackReason ?? 'unknown' });
    } else {
      // W3 WARN-3：'diff' 输出原始 git diff 数；'caller-expand' 输出"扩展数"（差值）
      emit({ phase: 'diff', changedFiles: result.origChangedFilesCount });
      emit({
        phase: 'caller-expand',
        expanded: Math.max(0, result.changedFiles.length - result.origChangedFilesCount),
      });
    }

    emit({
      phase: 'build',
      duration_ms: Date.now() - tBuild0,
      nodes: result.snapshot.graph.nodes.length,
      edges: result.snapshot.graph.edges.length,
    });

    const targetPath = snapshotPath(projectRoot);
    let sizeBytes = 0;
    try {
      sizeBytes = fs.statSync(targetPath).size;
    } catch {
      /* 空 diff 短路时未触发写盘也算正常 */
    }
    emit({
      phase: 'save',
      path: path.relative(projectRoot, targetPath),
      size_bytes: sizeBytes,
    });

    // spec AC-4：第二次无变更时输出 skippedReason: 'no-diff' 让消费方区分"真无变更"vs "fallback"
    const isNoDiff = !result.fallbackToFull && result.changedFiles.length === 0;
    emit({
      phase: 'done',
      mode: 'incremental',
      total_ms: Date.now() - t0,
      changedFiles: result.changedFiles.length,
      fallbackToFull: result.fallbackToFull,
      ...(isNoDiff ? { skippedReason: 'no-diff' } : {}),
    });
  } catch (err) {
    console.error(
      `[index] 增量索引失败: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exitCode = 2;
  }
}

// ───────────────────────────────────────────────────────────
// --watch 持续监听
// ───────────────────────────────────────────────────────────

async function runWatchMode(projectRoot: string, callerDepth: number): Promise<void> {
  // 启动前先确保有一份 baseline snapshot：若不存在则跑一次全量
  const baselinePath = snapshotPath(projectRoot);
  if (!fs.existsSync(baselinePath)) {
    emit({ phase: 'watch', event: 'baseline-missing-running-full' });
    await runFullIndex(projectRoot);
  }

  // FileWatcher 内部处理 debounce + .gitignore 过滤；W3 用 200ms（clarify Q-D1 决议）
  const watcher = new FileWatcher(
    {
      projectRoot,
      debounceMs: 200,
      verbose: false,
    },
    async (events: FileChangeEvent[]) => {
      // WARN-1 关闭：events 是批量数组，需聚合 path 并过滤 category === 'code'
      const changedPaths = new Set(
        events.filter((e) => e.category === 'code').map((e) => e.path),
      );
      if (changedPaths.size === 0) return;

      const tInc0 = Date.now();
      try {
        const result = await buildIncremental({
          projectRoot,
          callerDepth,
          changedFilesOverride: Array.from(changedPaths),
        });
        if (result.fallbackToFull) {
          emit({
            phase: 'fallback',
            reason: result.fallbackReason ?? 'unknown',
            context: 'watch',
          });
        }
        emit({
          phase: 'watch',
          changedFiles: changedPaths.size,
          expandedFiles: result.changedFiles.length,
          duration_ms: Date.now() - tInc0,
        });
      } catch (err) {
        console.error(
          `[index] watch incremental 失败: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    },
  );

  await watcher.start();
  emit({ phase: 'watch-ready', projectRoot });

  // SIGINT / SIGTERM 优雅退出
  await new Promise<void>((resolve) => {
    const shutdown = async (signal: string): Promise<void> => {
      emit({ phase: 'watch', event: 'shutdown', signal });
      try {
        await watcher.stop();
      } catch {
        /* 忽略关闭错误 */
      }
      resolve();
    };
    process.once('SIGINT', () => void shutdown('SIGINT'));
    process.once('SIGTERM', () => void shutdown('SIGTERM'));
  });

  // exit code = 0（用户主动 Ctrl+C 视为正常退出）
}
