/**
 * Feature 240 / FR-007：Codex 家目录相关路径的**可访问性探测**。
 *
 * 🔴 为何独立成模块而非并入 `codex-home.ts`（Codex 对抗审查 W2）：
 * `codex-home.ts` 的核心契约是「纯函数、零 I/O」——它与 shell 侧 `lib/codex-home.sh`
 * 逐条对拍，任何 I/O 都会破坏该属性。而 W2 要求的「区分 ENOENT / EACCES 并 fail-loud」
 * 本质是 I/O 探测，属于**消费点**责任。故解析与探测分层：解析纯、探测独立。
 *
 * 🔴 本模块存在的理由（W2 实测缺陷）：消费点原先一律用 `existsSync()` 表达「可访问」，
 * 而 `existsSync` 对 `EACCES` 与 `ENOENT` 返回**同一个 false**，于是：
 *   - 不可访问的 Codex 凭据目录被报成「未登录」而非权限错误；
 *   - 显式设了尚不存在的 `CODEX_HOME` 时，全局 postinstall 静默只注册 Claude；
 *   - 不可访问的安装目录被当成「没安装」，输出「无需清理」。
 * 三者都是把**故障**静默压成**正常态**。本模块提供可区分错误类型的探测原语，
 * 消费点据此分别给出明确诊断。
 */

import { statSync } from 'node:fs';

/** 路径探测结果（可区分错误类型，禁止再退化为布尔） */
export type CodexPathProbe =
  /** 存在且是目录 */
  | { kind: 'directory' }
  /** 存在但不是目录（普通文件 / symlink 指向文件等） */
  | { kind: 'file' }
  /** 确认不存在（ENOENT / ENOTDIR：路径中某段不存在或不是目录） */
  | { kind: 'missing'; code: string }
  /** 存在与否**无法判定**：权限不足（EACCES / EPERM） */
  | { kind: 'denied'; code: string; message: string }
  /** 其他 I/O 故障（ELOOP / ENAMETOOLONG / EIO 等），同样不得当作"不存在" */
  | { kind: 'error'; code: string; message: string };

function errorCode(err: unknown): string {
  const code = (err as NodeJS.ErrnoException | undefined)?.code;
  return typeof code === 'string' ? code : 'UNKNOWN';
}

/**
 * 探测路径状态，**区分**「不存在」与「不可访问」。
 *
 * 用 `statSync` 而非 `existsSync`：后者内部吞掉全部 errno 只回布尔，
 * 正是 W2 三处缺陷的共同根因。
 *
 * 语义说明：`ENOENT` / `ENOTDIR` 归为 `missing`（前者路径不存在，后者路径中间段不是目录
 * ——两者都确定性地表示"该路径不存在"）；`EACCES` / `EPERM` 归为 `denied`
 * （**存在与否未知**，绝不可当作不存在）；其余 errno 归为 `error`，同样不得静默降级。
 */
export function probeCodexPath(target: string): CodexPathProbe {
  try {
    return statSync(target).isDirectory() ? { kind: 'directory' } : { kind: 'file' };
  } catch (err) {
    const code = errorCode(err);
    const message = err instanceof Error ? err.message : String(err);
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return { kind: 'missing', code };
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { kind: 'denied', code, message };
    }
    return { kind: 'error', code, message };
  }
}

/**
 * `CODEX_HOME` 是否为**用户显式声明**（已设置且非空串）。
 *
 * 为何要区分：显式设置意味着用户明确指定了 Codex 家目录，此时「目录尚不存在」
 * 属正常情形（安装动作本就会 `mkdir -p`），**不得**据此跳过 Codex 相关处理；
 * 而未设置时走的是默认路径 `~/.codex`，其不存在通常就意味着"本机没在用 Codex"，
 * 保持既有宽松行为。二者语义不同，处置也必须不同。
 *
 * 与 `resolveCodexHome` 的空串语义保持一致（空串等同未设置）。
 */
export function isCodexHomeExplicit(env: NodeJS.ProcessEnv = process.env): boolean {
  const configured = env['CODEX_HOME'];
  return typeof configured === 'string' && configured !== '';
}

/**
 * 把探测结果格式化为面向用户的中文诊断短语；`directory` / `file` 返回 null（无需诊断）。
 * 统一在此格式化，避免各消费点各写一份措辞导致 ENOENT / EACCES 描述漂移。
 */
export function describeCodexPathProblem(target: string, probe: CodexPathProbe): string | null {
  switch (probe.kind) {
    case 'directory':
    case 'file':
      return null;
    case 'missing':
      return `路径不存在: ${target}（${probe.code}）`;
    case 'denied':
      return `路径不可访问，权限不足: ${target}（${probe.code}）—— 这不等于"不存在"，请检查目录权限`;
    case 'error':
      return `路径探测失败: ${target}（${probe.code}: ${probe.message}）`;
  }
}
