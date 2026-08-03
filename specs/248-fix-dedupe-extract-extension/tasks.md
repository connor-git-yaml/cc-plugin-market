
# 任务清单：收敛重复的"取扩展名"私有实现

**Branch**: `248-fix-dedupe-extract-extension` | **Mode**: fix
**Input**: `specs/248-fix-dedupe-extract-extension/plan.md`（变更清单与测试用例清单）

## 依赖顺序

T001 → T002 → (T003, T004 可并行) → T005

T001（新模块）与 T002（共置测试）先行完成并锚定行为；T003/T004 是两处调用方替换，互不依赖、文件互不重叠，可并行；T005 是最终全量验证收尾，必须在前四项全部完成后执行。

## 任务列表

- [x] T001 新建零依赖叶子模块 `src/panoramic/graph/collector-extname.ts`，导出纯函数 `extractExtension(name: string): string`（`lastIndexOf('.') + slice` 语义，严格大小写、不做 dotfile/basename 特判），含 doc 注释说明与 `path.extname` 的语义差异及"怪值不命中白名单即安全兜底"合同
  验证：`npx tsc --noEmit src/panoramic/graph/collector-extname.ts` 或直接推进到 T002 由 vitest 间接验证语法正确性

- [x] T002 新建共置测试 `src/panoramic/graph/collector-extname.test.ts`，覆盖 plan.md 用例清单全部 10 条断言（普通扩展名、保留大小写、dotfile 整串命中、目录段含点、多个点取最后一个、尾点、无点、空字符串、真实相对路径、白名单大小写不命中）
  验证：`npx vitest run src/panoramic/graph/collector-extname.test.ts` 全绿（10 条用例通过）
  依赖：T001

- [x] T003 修改 `src/panoramic/graph/source-commit.ts`：删除私有函数 `extname`（含其上单行注释），顶部新增 `import { extractExtension } from './collector-extname.js';`，L138 调用点由 `extensions.has(extname(p))` 替换为 `extensions.has(extractExtension(p))`
  验证：`npx vitest run src/panoramic/graph/source-commit.test.ts` 全绿（测试数量与断言内容较改动前不变）
  依赖：T001

- [x] T004 修改 `src/panoramic/graph/quality/ignore-oracle.ts`：删除私有函数 `extnameOf`，顶部新增 `import { extractExtension } from '../collector-extname.js';`，L125 调用点由 `const ext = extnameOf(relativePath);` 替换为 `const ext = extractExtension(relativePath);`
  验证：`npx vitest run src/panoramic/graph/quality/ignore-oracle.test.ts` 全绿（测试数量与断言内容较改动前不变）
  依赖：T001

- [x] T005 全量验证收尾：确认新模块、新测试、两处替换共同生效，无编译错误、无仓库同步告警
  验证（按序执行，任一步失败即停止修复重跑）：
  1. `npx vitest run` —— 全量单测零失败
  2. `npm run build` —— TypeScript 编译零错误
  3. `npm run repo:check` —— 仓库级同步与一致性检查零告警
  依赖：T002, T003, T004

## 不做清单（继承 plan.md 范围边界）

- 不统一扩展名集合（`TSJS_COLLECTOR_EXTENSIONS` / `TSJS_EXTENSIONS` / `walkTsJsFiles` 的 `endsWith` 判定链）
- 不触碰 `java-mapper.ts` / `call-resolver.ts` 的 `lastIndexOf('.')`（FQN/类名点分割，语义不同）
- 不改动任何 `path.extname` 使用面（27 个文件，语义不等价）
- 不修改 `source-discovery.ts::walkTsJsFiles` 的 `endsWith` 六连判定
- 不更新任何 spec 文档
