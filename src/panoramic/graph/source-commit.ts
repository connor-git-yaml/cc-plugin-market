/**
 * F217 FR-009/010：sourceCommit 写盘注入 + freshness 四态判定。
 *
 * 唯一含 `child_process` 调用的模块——git 交互全部走只读命令
 * （`git rev-parse HEAD` / `git status --porcelain=v1 -z --untracked-files=all`）。
 */
import { execFileSync } from 'node:child_process';
import { JavaLanguageAdapter } from '../../adapters/java-adapter.js';
import { GoLanguageAdapter } from '../../adapters/go-adapter.js';
import type { GraphFreshnessVerdict } from './quality/quality-types.js';

/** git 只读命令输出上限（FIX-3：防大仓库输出超默认 1MB 被截断触发 ENOBUFS）。 */
const MAX_GIT_OUTPUT_BYTES = 64 * 1024 * 1024;

/**
 * 在 projectRoot 执行 `git rev-parse HEAD`；非 git 仓库 / 命令失败均返回 null，不抛异常（FR-009）。
 *
 * detached HEAD 场景下 `git rev-parse HEAD` 本身就能正常解析出具体 commit SHA，无需特判。
 */
export function resolveSourceCommit(projectRoot: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
    });
    const sha = out.trim();
    return sha.length > 0 ? sha : null;
  } catch {
    return null;
  }
}

/** TSJS collector 实际扫描的扩展名（镜像 batch-orchestrator.ts::walkTsJsFiles 的 endsWith 判定面）。 */
const TSJS_COLLECTOR_EXTENSIONS: ReadonlySet<string> = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
]);

/** PY collector 实际扫描的扩展名（镜像 batch-orchestrator.ts::walkPyFiles，仅计入 .py，.pyi 不参与 dirty 判定）。 */
const PY_COLLECTOR_EXTENSIONS: ReadonlySet<string> = new Set(['.py']);

/**
 * FIX-4（Codex WARNING）：dirty 判定的源码扩展名集合，精确镜像图生产者实际扫描面——
 * TSJS collector 扫描面 ∪ {'.py'}（PY collector）∪ JavaLanguageAdapter().extensions
 * ∪ GoLanguageAdapter().extensions（generic-language-skeleton-collector 采集器）。
 *
 * 此前实现依赖 LanguageAdapterRegistry.getSupportedExtensions() 做并集广播，且用
 * toLowerCase() 归一化做大小写不敏感匹配——但各 collector 的 walk 函数（
 * walkTsJsFiles/walkPyFiles/generic-language-skeleton-collector::walkFiles）均用
 * `name.endsWith('.ts')` 精确匹配，区分大小写。生产者不收 `.TS` 文件，freshness
 * 也不该把它算作触发 dirty 判定的源码文件，否则会把生产者根本不会重新分析的改动
 * 误判为"图未反映最新改动"。
 *
 * 直接实例化 Java/Go adapter（而非经 LanguageAdapterRegistry），理由与 batch/
 * generic-language-skeleton-collector.ts 默认参数一致：避免依赖 bootstrapRuntime()
 * 的隐藏前置，registry 为空时也能正确工作。
 *
 * 导出供一致性测试用真实 adapter 实例对比防漂移（source-commit.test.ts）。
 */
export function getDirtySourceExtensions(): ReadonlySet<string> {
  return new Set<string>([
    ...TSJS_COLLECTOR_EXTENSIONS,
    ...PY_COLLECTOR_EXTENSIONS,
    ...new JavaLanguageAdapter().extensions,
    ...new GoLanguageAdapter().extensions,
  ]);
}

/** 大小写严格匹配（不做归一化）：与生产者 `name.endsWith(ext)` 精确匹配语义对齐（FIX-4）。 */
function extname(filePath: string): string {
  const idx = filePath.lastIndexOf('.');
  if (idx < 0) return '';
  return filePath.slice(idx);
}

/**
 * 解析 `git status --porcelain=v1 -z --untracked-files=all` 的 NUL 分隔输出。
 *
 * 每条记录格式为 `XY PATH`；rename/copy 记录（X 或 Y 为 'R'/'C'）额外携带一个
 * NUL 分隔的 ORIG_PATH 字段（无 `->` 分隔符，与非 -z 格式不同）。
 * 返回涉及到的全部路径（rename 场景含新旧两条）。
 */
function parsePorcelainZPaths(raw: string): string[] {
  const parts = raw.split('\x00');
  // split 会在末尾产生一个空字符串（末尾 NUL 终止符），过滤掉
  const records = parts.filter((p) => p.length > 0);
  const paths: string[] = [];
  let i = 0;
  while (i < records.length) {
    const record = records[i];
    if (record === undefined) break;
    const statusCode = record.slice(0, 2);
    const pathPart = record.slice(3);
    paths.push(pathPart);
    const isRenameOrCopy =
      statusCode[0] === 'R' || statusCode[0] === 'C' || statusCode[1] === 'R' || statusCode[1] === 'C';
    if (isRenameOrCopy) {
      i += 1;
      const origPath = records[i];
      if (origPath !== undefined) paths.push(origPath);
    }
    i += 1;
  }
  return paths;
}

/** getDirtySourceFiles 的结果：区分"读取成功但可能为空"与"读取本身失败"（FIX-3）。 */
interface DirtySourceFilesResult {
  paths: string[];
  /** true=`git status --porcelain` 命令执行失败（如 ENOBUFS），而非"工作树确实干净"。 */
  readFailed: boolean;
}

/**
 * 获取工作树中触发 dirty 判定的源码文件路径清单（过滤面按源码扩展名，决策 3）。
 *
 * FIX-3（Codex WARNING）：命令失败（如大仓库输出超限触发 ENOBUFS）此前直接返回空数组，
 * 会被上层误判为"工作树干净"（fresh）——但读取失败与"确实无未提交源码改动"是两回事，
 * 保守起见判为 dirty 并显式标注 readFailed，供调用方向人提示"按 dirty 保守处理"。
 * 此调用不会在 currentHead 解析失败时触发（evaluateFreshness 已提前短路）。
 */
function getDirtySourceFiles(projectRoot: string): DirtySourceFilesResult {
  let raw: string;
  try {
    raw = execFileSync(
      'git',
      ['status', '--porcelain=v1', '-z', '--untracked-files=all'],
      { cwd: projectRoot, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: MAX_GIT_OUTPUT_BYTES },
    );
  } catch {
    return { paths: [], readFailed: true };
  }
  if (!raw) return { paths: [], readFailed: false };

  const extensions = getDirtySourceExtensions();
  const allPaths = parsePorcelainZPaths(raw);
  const dirtyPaths = allPaths.filter((p) => extensions.has(extname(p)));
  return { paths: [...new Set(dirtyPaths)].sort(), readFailed: false };
}

/**
 * 与当前 HEAD 比对 + 工作树 dirty 判定，产出 FR-010 四态之一。
 *
 * - recordedSourceCommit 为 null/undefined → unknown-provenance（旧图产物 / 非 AST 重建路径）
 * - currentHead 无法解析（非 git 仓库 / rev-parse 失败）→ unknown-provenance
 *   （绝不据此比较出 stale）
 * - recordedSourceCommit !== currentHead → stale
 * - 一致但工作树存在未提交源码改动 → dirty
 * - 一致且工作树干净 → fresh
 */
export function evaluateFreshness(
  recordedSourceCommit: string | null | undefined,
  projectRoot: string,
): GraphFreshnessVerdict {
  const currentHead = resolveSourceCommit(projectRoot);

  if (recordedSourceCommit === null || recordedSourceCommit === undefined) {
    return {
      state: 'unknown-provenance',
      recordedSourceCommit,
      currentHead,
    };
  }

  if (currentHead === null) {
    return {
      state: 'unknown-provenance',
      recordedSourceCommit,
      currentHead: null,
    };
  }

  if (recordedSourceCommit !== currentHead) {
    return {
      state: 'stale',
      recordedSourceCommit,
      currentHead,
    };
  }

  const dirtyResult = getDirtySourceFiles(projectRoot);
  if (dirtyResult.readFailed) {
    return {
      state: 'dirty',
      recordedSourceCommit,
      currentHead,
      porcelainReadFailed: true,
    };
  }
  if (dirtyResult.paths.length > 0) {
    return {
      state: 'dirty',
      recordedSourceCommit,
      currentHead,
      dirtyFiles: dirtyResult.paths,
    };
  }

  return {
    state: 'fresh',
    recordedSourceCommit,
    currentHead,
  };
}
