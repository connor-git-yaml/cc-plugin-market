/**
 * Spec Drift —— 引用路径的 containment 校验（叶子模块，MUST NOT import 任何上层 drift 模块）。
 *
 * `ref` 的 filePart 来自用户可写的引用清单 / lock，属于**不可信输入**。
 * 直接 `path.resolve(projectRoot, filePart)` 会让 `../sibling/x.ts::Sym` 逃出 projectRoot，
 * 读到被检项目之外的文件并被判 fresh —— 锚点因此可以指向仓库外的任意路径。
 */
import fs from 'node:fs';
import path from 'node:path';

/** Windows 盘符前缀（`C:` / `c:/`）与 UNC 前缀（`\\server\share`）*/
const DRIVE_LETTER = /^[A-Za-z]:/;
const UNC_PREFIX = /^[\\/]{2}/;

/** rel 是否表示"在 base 之内"（空串=base 自身，`..` 开头 / 绝对=逃逸）*/
function isContainedRel(rel) {
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * symlink 逃逸校验（W-7）。
 *
 * 词法 `path.resolve` 只看字符串：`node_modules/x/y.ts` 词法上在 projectRoot 内，
 * 但当 `node_modules` 本身是指向仓库外的软链时（本仓 worktree 即如此），
 * 实际读到的是工作树之外的文件并被判 fresh。因此对**已存在**的目标额外比较 realpath。
 *
 * 目标不存在时保持词法判定：realpath 对不存在路径必抛 ENOENT，
 * 在此处拒绝会把"文件已删除"（orphaned）错误地降级成 containment 失败。
 */
function realpathContained(projectRoot, absPath) {
  let realTarget;
  try {
    realTarget = fs.realpathSync(absPath);
  } catch (err) {
    // ENOENT = 目标不存在，交给下游的存在性判定；其他错误（EACCES/ELOOP）不可证明安全，拒绝。
    if (err?.code === 'ENOENT') return { ok: true };
    return { ok: false, reason: `无法解析引用路径的真实位置（${err?.code ?? 'unknown'}）` };
  }
  let realRoot;
  try {
    realRoot = fs.realpathSync(projectRoot);
  } catch {
    // project-root 自身不可解析时退回词法根，避免因环境异常整体不可用。
    realRoot = projectRoot;
  }
  if (!isContainedRel(path.relative(realRoot, realTarget))) {
    return { ok: false, reason: `引用路径经 symlink 逃逸出 project-root（真实位置：${realTarget}）` };
  }
  return { ok: true };
}

/**
 * 把引用里的相对路径解析为 projectRoot 内的绝对路径。
 *
 * @param {string} projectRoot 被检项目根（调用方须先 path.resolve）
 * @param {string} filePart 引用中的文件部分
 * @returns {{ok:true, absPath:string} | {ok:false, reason:string}}
 */
export function resolveWithinProject(projectRoot, filePart) {
  if (typeof filePart !== 'string' || filePart.trim() === '') {
    return { ok: false, reason: '引用的文件部分为空' };
  }
  if (path.isAbsolute(filePart) || DRIVE_LETTER.test(filePart) || UNC_PREFIX.test(filePart)) {
    return { ok: false, reason: `引用路径必须是项目内相对路径，拒绝绝对路径 / 盘符 / UNC："${filePart}"` };
  }

  const absPath = path.resolve(projectRoot, filePart);
  // rel 为空串表示指向 projectRoot 自身（不是文件）；以 `..` 开头或本身是绝对路径表示逃逸。
  if (!isContainedRel(path.relative(projectRoot, absPath))) {
    return { ok: false, reason: `引用路径逃逸出 project-root，拒绝解析："${filePart}"` };
  }
  const real = realpathContained(projectRoot, absPath);
  if (!real.ok) return { ok: false, reason: `${real.reason}："${filePart}"` };
  return { ok: true, absPath };
}
