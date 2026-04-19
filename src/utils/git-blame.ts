/**
 * Git blame 轻量 wrapper
 *
 * 用于 debt-scanner 为每条 TODO/FIXME 条目解析 author 与 age。
 * 任何失败（非 git 仓库、文件未追踪、git 不存在等）都返回
 * `{ author: 'uncommitted', commitDate: null, ageDays: 0 }`，绝不抛出异常。
 *
 * 性能：按 filePath 缓存一次 `git blame --porcelain <file>` 的完整解析结果，
 * 多次 getLineBlame 调用只做内存 map 查找。
 */
import { spawn } from 'node:child_process';
import * as path from 'node:path';

export interface BlameInfo {
  /** commit 作者；uncommitted 或任何错误场景为 "uncommitted" */
  author: string;
  /** commit UTC 时间；uncommitted 或错误场景为 null */
  commitDate: Date | null;
  /** commit 距今天数；uncommitted 或错误场景为 0 */
  ageDays: number;
}

const UNCOMMITTED: Readonly<BlameInfo> = Object.freeze({
  author: 'uncommitted',
  commitDate: null,
  ageDays: 0,
});

/** 单文件的行号 → BlameInfo 映射 */
type FileBlameMap = Map<number, BlameInfo>;

/** 全局缓存：绝对路径 → 该文件所有行的 blame */
const fileCache = new Map<string, FileBlameMap>();

/**
 * 重置所有缓存（仅给测试使用）
 */
export function resetBlameCache(): void {
  fileCache.clear();
}

/**
 * 查询指定文件 指定行的 blame。
 * 任何失败都返回 uncommitted 占位。
 *
 * @param filePath 绝对路径推荐；相对路径会按 process.cwd() 解析
 * @param line 1-indexed 行号
 */
export async function getLineBlame(filePath: string, line: number): Promise<BlameInfo> {
  const absPath = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(process.cwd(), filePath);

  let cached = fileCache.get(absPath);
  if (!cached) {
    cached = await loadFileBlame(absPath);
    fileCache.set(absPath, cached);
  }
  return cached.get(line) ?? { ...UNCOMMITTED };
}

/**
 * 执行 git blame --porcelain 并把结果解析为 line → BlameInfo。
 * 任何错误返回空 Map（调用方会回退到 uncommitted）。
 */
async function loadFileBlame(absFilePath: string): Promise<FileBlameMap> {
  const dir = path.dirname(absFilePath);
  const out: FileBlameMap = new Map();

  let raw: string;
  try {
    raw = await runGit(['blame', '--porcelain', absFilePath], dir);
  } catch {
    // 非 git 仓库、git 未安装、文件未 committed 等
    return out;
  }

  parsePorcelain(raw, out);
  return out;
}

/**
 * 解析 git blame --porcelain 输出。
 * Porcelain 格式每个 chunk：
 *   <sha> <origLine> <finalLine> [numLines]
 *   header key value 行（author / author-time / author-tz / summary / previous / filename）
 *   \t<source line>
 */
export function parsePorcelain(raw: string, out: FileBlameMap): void {
  const lines = raw.split('\n');
  // headers-by-sha 缓存；porcelain 对同一 sha 的后续 chunk 只给 header 子集
  const headersBySha = new Map<string, { author: string; authorTime: number | null }>();

  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    // chunk 开头行形如 "<sha> <orig> <final> [count]"
    const headerMatch = /^([0-9a-f]{7,40}) (\d+) (\d+)(?: (\d+))?$/.exec(line);
    if (!headerMatch) {
      i++;
      continue;
    }
    const sha = headerMatch[1]!;
    const finalLine = parseInt(headerMatch[3]!, 10);
    const count = headerMatch[4] ? parseInt(headerMatch[4], 10) : 1;

    let author = headersBySha.get(sha)?.author ?? '';
    let authorTime = headersBySha.get(sha)?.authorTime ?? null;

    // 读取 header 行，直到遇到 \t<source> 行
    i++;
    while (i < lines.length && !lines[i]!.startsWith('\t')) {
      const h = lines[i]!;
      if (h.startsWith('author ')) author = h.slice('author '.length).trim();
      else if (h.startsWith('author-time ')) {
        const ts = parseInt(h.slice('author-time '.length).trim(), 10);
        if (Number.isFinite(ts)) authorTime = ts;
      }
      i++;
    }
    // 跳过 \t<source>
    if (i < lines.length && lines[i]!.startsWith('\t')) {
      i++;
    }

    headersBySha.set(sha, { author, authorTime });

    // 生成 BlameInfo
    // 对 uncommitted（所有 0 的 sha，git 通常是 40 个 0）
    const isUncommitted = /^0+$/.test(sha);
    const info: BlameInfo = isUncommitted
      ? { ...UNCOMMITTED }
      : buildBlameInfo(author, authorTime);

    for (let n = 0; n < count; n++) {
      out.set(finalLine + n, info);
    }
  }
}

function buildBlameInfo(author: string, authorTime: number | null): BlameInfo {
  const commitDate = authorTime != null ? new Date(authorTime * 1000) : null;
  const ageDays = commitDate
    ? Math.max(0, Math.floor((Date.now() - commitDate.getTime()) / 86_400_000))
    : 0;
  return {
    author: author || 'uncommitted',
    commitDate,
    ageDays,
  };
}

/**
 * 启动 git 子进程，返回 stdout。非零退出或错误抛出异常。
 * 调用方应 try/catch 并回退到 uncommitted。
 */
function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (err) => reject(err));
    child.on('close', (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`git exited with ${code}: ${stderr.trim()}`));
    });
  });
}
