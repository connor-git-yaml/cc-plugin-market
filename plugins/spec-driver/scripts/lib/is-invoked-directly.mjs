/**
 * F246 — 共享入口守卫：判定当前模块是否被「直接执行」（而非被 import）。
 *
 * 为什么需要这个 helper（根因，勿改回手写比对）：
 * 旧写法把 `process.argv[1]` 与 `import.meta.url` 直接比对（`path.resolve` 归一或手拼
 * `file://` 字符串）。两侧的规范化程度并不对称——Node 默认 `--preserve-symlinks-main=false`
 * 会把主入口的符号链接解析为 realpath，因此 `import.meta.url` 已是 canonical 路径，而
 * `process.argv[1]` 保留调用方给出的原始路径。`path.resolve` 只做词法归一（`.`、`..`、
 * 分隔符），不做文件系统 canonical 化，所以只要调用路径里任一段是符号链接（macOS 的
 * `/tmp → /private/tmp`、软链的插件安装目录、软链 worktree），两侧恒不相等 → 守卫恒 false
 * → `main()` 永不执行 → 脚本 exit 0 且零副作用（静默假成功，只看退出码的验证一律全绿）。
 *
 * 修法：两侧各自 `fs.realpathSync` 对齐到同一 canonical 形态再比较。
 * realpath 失败（路径不存在 / 不可读，如测试注入的 mock 路径）时回退 `path.resolve`——
 * 守卫本身绝不能因为解析不了而抛错中断调用方脚本。
 *
 * `moduleUrl` 由调用方恒传 `import.meta.url`（不在本函数内部读取），便于测试注入任意 URL。
 *
 * 不变量（20+ 处调用方承重）：被 import 时必须返回 false。该语义天然成立——被 import 场景下
 * `process.argv[1]` 是上游进程（test runner / 上游脚本）的入口路径，与被 import 的模块是两个
 * 不同文件，canonical 化后仍不相等。本 helper 只修正「同一文件在不同规范化程度下比较」的
 * 正确性，不改变「两个不同文件比较」的结果。
 *
 * 该不变量的一个边界（必须显式拦截，见下方 search/hash 判断）：**同一物理文件**也可能同时以
 * 主入口和 import 副本两种身份存在于同一进程——ESM 按完整 URL（含 `?search` / `#hash`）区分
 * 模块实例，`node --import 'file:///abs/x.mjs?copy' /abs/x.mjs` 会把 x.mjs 求值两次。而
 * `fileURLToPath` 会丢弃 search/hash，两个实例 canonical 化后同值 → 副本也判 true → `main()`
 * 执行两次。这个反向误判比原 bug（静默不执行）更危险，故在路径比较前先按 URL 形态短路。
 *
 * 合同外场景 `--preserve-symlinks-main`：本仓库不使用该 flag。开启后主入口 URL 保留调用方给出
 * 的 symlink 路径而非 realpath，此时「经 symlink 主入口执行」与「import 同一物理文件」在
 * canonical 层面不可区分，helper 无法只凭 URL + argv[1] 判定身份。F241 已 ship 的同语义实现
 * 与仓库既有 6 处 realpath 站点同此边界——本 helper 不解决也不恶化。
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/**
 * @param {string} moduleUrl - 调用方模块的 `import.meta.url`
 * @returns {boolean} 当前模块是否被直接执行
 */
export function isInvokedDirectly(moduleUrl) {
  const invokedPath = process.argv[1];
  if (invokedPath === undefined) return false;

  // 主入口模块的 URL 恒无 search/hash（argv[1] 是文件系统路径，Node 由 pathToFileURL 生成主入口
  // URL 时不带这两段）。带 search/hash 的模块实例必是 import 副本（ESM 按完整 URL 区分实例），
  // 若不在此拦截，fileURLToPath 会丢弃 query/hash 使其与主入口路径同值 → 反向误判为 true →
  // main() 重复执行（比原 bug 的静默不执行更危险）。
  const parsedUrl = new URL(moduleUrl);
  if (parsedUrl.search !== '' || parsedUrl.hash !== '') return false;

  const modulePath = fileURLToPath(moduleUrl);

  let canonicalInvoked;
  try {
    canonicalInvoked = fs.realpathSync(invokedPath);
  } catch {
    canonicalInvoked = path.resolve(invokedPath);
  }

  let canonicalModule;
  try {
    canonicalModule = fs.realpathSync(modulePath);
  } catch {
    canonicalModule = path.resolve(modulePath);
  }

  return canonicalInvoked === canonicalModule;
}
