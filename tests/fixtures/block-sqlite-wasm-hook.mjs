/**
 * Node ESM resolve hook — 把 @sqlite.org/sqlite-wasm 的解析强制失败，
 * 模拟"缺包"环境，无需实际 uninstall 该包。经 register() 安装后在 hooks 线程生效。
 */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@sqlite.org/sqlite-wasm' || specifier.startsWith('@sqlite.org/sqlite-wasm/')) {
    // sentinel 前缀让测试能区分"hook 拦截"与"自然缺包"（Codex Q4 / quality-review 加固）
    const err = new Error(`F201_HOOK_BLOCKED: Cannot find package '@sqlite.org/sqlite-wasm'`);
    err.code = 'ERR_MODULE_NOT_FOUND';
    throw err;
  }
  return nextResolve(specifier, context);
}
