/**
 * Spec Drift —— 引用路径的 containment 校验（叶子模块，MUST NOT import 任何上层 drift 模块）。
 *
 * `ref` 的 filePart 来自用户可写的引用清单 / lock，属于**不可信输入**。
 * 直接 `path.resolve(projectRoot, filePart)` 会让 `../sibling/x.ts::Sym` 逃出 projectRoot，
 * 读到被检项目之外的文件并被判 fresh —— 锚点因此可以指向仓库外的任意路径。
 */
import path from 'node:path';

/** Windows 盘符前缀（`C:` / `c:/`）与 UNC 前缀（`\\server\share`）*/
const DRIVE_LETTER = /^[A-Za-z]:/;
const UNC_PREFIX = /^[\\/]{2}/;

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
  const rel = path.relative(projectRoot, absPath);
  // rel 为空串表示指向 projectRoot 自身（不是文件）；以 `..` 开头或本身是绝对路径表示逃逸。
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, reason: `引用路径逃逸出 project-root，拒绝解析："${filePart}"` };
  }
  return { ok: true, absPath };
}
