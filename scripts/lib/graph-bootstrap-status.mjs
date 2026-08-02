// scripts/lib/graph-bootstrap-status.mjs —— D8 薄转发壳，唯一职责：转发 import 与 CLI 调用
// canonical 实现见 plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs，禁止在此复制任何业务逻辑
export * from '../../plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs';
import { main, isInvokedDirectly } from '../../plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs';

// 只 `export *` 是不够的：被 import 的 canonical 模块里 `import.meta.url` 是它自己的 URL，
// 与 `process.argv[1]`（本薄壳路径）不等，其自调用守卫恒为 false —— `node <本文件> write-status`
// 会静默变成 no-op（exit 0 但什么都没做）。因此守卫必须在本文件里以**本文件的** URL 重算一次。
//
// 判定逻辑本身复用 canonical 导出的 `isInvokedDirectly`，不在此重写：两处各写一份 `path.resolve`
// 比对的历史结果是同一个符号链接 bug 在两边并存（T027a）。
if (isInvokedDirectly(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`graph-bootstrap-status 内部错误：${String(error)}\n`);
      process.exitCode = 1;
    });
}
