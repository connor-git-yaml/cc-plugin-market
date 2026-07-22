/**
 * Spec Drift —— dist 编译产物动态加载器（plan §7.2 / FR-011）。
 *
 * drift 全链路只读复用生产逻辑（analyzeFiles / canonicalizeSymbolId 等），
 * 而 `scripts/*.mjs` 无 TS 编译步骤，因此统一经 `dist/**` 动态 import。
 *
 * 降级契约：MUST 捕获**全部**加载失败模式（文件缺失 / 语法错误 / 传递依赖失败 /
 * 模块顶层初始化抛错），返回结构化失败对象而非让异常冒泡——否则 CLI 会以栈回溯
 * 崩溃，违反 FR-012「稳定状态码 + next step」。
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @param {string} projectRoot 项目根绝对路径
 * @param {string} relDistPath 形如 `dist/core/ast-analyzer.js` 的相对路径
 * @returns {Promise<{ok:true, mod:any} | {ok:false, reason:'dist-missing'|'dist-load-failed', detail:string}>}
 */
export async function loadDistModule(projectRoot, relDistPath) {
  const distPath = path.join(projectRoot, relDistPath);
  if (!fs.existsSync(distPath)) {
    return { ok: false, reason: 'dist-missing', detail: relDistPath };
  }
  try {
    const mod = await import(pathToFileURL(distPath).href);
    return { ok: true, mod };
  } catch (err) {
    // 语法错误 / 传递依赖缺失 / 顶层初始化抛错统一归为 dist-load-failed
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: 'dist-load-failed', detail: `${relDistPath}: ${message}` };
  }
}
