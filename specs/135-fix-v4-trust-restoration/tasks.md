---
feature: 135-fix-v4-trust-restoration
type: tasks
status: ready
version: v1
created: 2026-04-27
---

# 任务清单 — Feature 135：Spectra v4.0.1 信任修复

> 执行顺序：Bug 3 → Bug 1 → Bug 2 → Bug 4 → 测试与验收
> 每个任务粒度：一个文件的一类修改，可独立完成和验证

---

## Bug 3：`generatedBy` 版本字符串回归（优先，最独立）

- [x] T01: `src/generator/frontmatter.ts` — 新增 `getSpectraVersionString()` 辅助函数
  - 用 `createRequire(import.meta.url)` 读取 `../../package.json`（或 `fs.readFileSync` + `JSON.parse`）
  - 返回 `` `spectra v${version}` ``；版本读取失败时 fallback 到 `'spectra (unknown version)'` 并打印 warn
  - 将 L60 的 `generatedBy: 'spectra v3.0'` 替换为 `generatedBy: getSpectraVersionString()`
  - 验收：函数返回值包含 `package.json` 中的实际版本号（如 `spectra v4.0.1`）

- [x] T02: `src/generator/index-generator.ts` — 替换硬编码版本字符串
  - 从 `../generator/frontmatter.js` 导入 `getSpectraVersionString`（或从共享位置导入）
  - 将 L139 的 `generatedBy: 'spectra v3.0'` 替换为 `generatedBy: getSpectraVersionString()`
  - 验收：`generateIndex()` 输出的 frontmatter `generatedBy` 与 package.json version 一致

- [x] T03: `src/spec-store/spec-store.ts` — 替换硬编码版本字符串
  - 导入 `getSpectraVersionString`
  - 将 L80 的 `generatedBy: 'spectra v3.0'` 替换为 `generatedBy: getSpectraVersionString()`
  - 验收：`SpecStore` 构造的 frontmatter `generatedBy` 与 package.json version 一致

- [x] T04: `scripts/check-plugin-sync.sh` — 新增 hardcoded version string 检查规则
  - 在脚本末尾新增检查：`grep -rn "spectra v[0-9]" src/ --include="*.ts"` 发现任何匹配则 exit 1，并打印 "FAIL: hardcoded version string found in src/"
  - 验收：改完 T01-T03 后，`bash scripts/check-plugin-sync.sh` 不报告版本字符串错误；若手动还原某处 T01 的修改，脚本应报告 FAIL

---

## Bug 1：ADR Pipeline Hallucination — 默认禁用

- [x] T05: `src/cli/utils/parse-args.ts`（或 args 解析所在文件）— 新增 `enableAdr` CLI flag 解析
  - 在 `CLICommand` 类型定义中新增 `enableAdr?: boolean`
  - 在参数解析逻辑中，识别 `--enable-adr` flag 并赋值 `command.enableAdr = true`
  - 验收：`spectra batch --enable-adr --help` 无报错；parse 后 `command.enableAdr === true`

- [x] T06: `src/cli/index.ts` — 在帮助文字中新增 `--enable-adr` 说明
  - 在 `--hyperedges` 行之后插入：
    ```
    --enable-adr   显式启用 ADR pipeline（v4.0.1 临时禁用，将在 v4.1 evidence-binding 重构后恢复；默认 false）（仅 batch）
    ```
  - 验收：`spectra --help` 输出含 `--enable-adr` 行

- [x] T07: `src/panoramic/batch-project-docs.ts` — `BatchProjectDocsOptions` 新增 `enableAdr` 字段 + ADR guard
  - 在 `BatchProjectDocsOptions`（或 `generateBatchProjectDocs` 入参类型）中新增 `enableAdr?: boolean`
  - 在 L338 的 `generateBatchAdrDocs(...)` 调用外包裹 `if (options.enableAdr) { ... } else { logger.warn('ADR pipeline 已临时禁用...') }`
  - else 分支将 `adr-pipeline` 跳过信息写入 `generatedDocs`（`writtenFiles: [], warnings: ['ADR pipeline 临时禁用（v4.0.1）...']`）
  - 验收：不传 `enableAdr` 时 `generateBatchAdrDocs` 未被执行；传 `enableAdr: true` 时正常执行

- [x] T08: `src/cli/commands/batch.ts` — 传递 `enableAdr` 给 `runBatch` + 末尾 hint 打印
  - 在 `runBatch(...)` 调用中新增 `enableAdr: command.enableAdr ?? false`
  - 在 batch 结果打印块末尾，当 `!command.enableAdr` 时打印：
    ```
    ⚠ ADR pipeline 在 v4.0.1 临时禁用。可用 --enable-adr 显式开启（预计 v4.1 重构后恢复默认）
    ```
  - 验收：默认运行后控制台出现上述 hint；`--enable-adr` 时不出现 hint

> 注意：若 `runBatch` 的 `BatchOptions` 类型定义中不含 `enableAdr`，需同步更新该类型（`src/batch/batch-orchestrator.ts` 顶部或相关 types 文件）。在 T07 中一并处理类型传递链。

---

## Bug 2：`--hyperedges` Flag 静默无效 — 补全 WARNING

- [x] T09: `src/batch/batch-orchestrator.ts` — `!semanticIntegrationAllowed` 分支升级为 WARNING
  - 将 L994-1000 的 `logger.info(...)` 改为 `logger.warn(...)`
  - 同时在 `process.stderr` 打印可见 WARNING（`console.warn` 或 `process.stderr.write`），确保用户在 TTY 下可见
  - 验收：`mode=reading` 或 budget 降级时，stderr 出现 WARN 级别日志

- [x] T10: `src/batch/batch-orchestrator.ts` — `hyperedgesOptIn === true` 但 `designDocAbsPaths.length === 0` 时补 WARNING
  - 在 L1011（`if (designDocAbsPaths.length > 0 && codeNodes.length > 0)` 判断）的 else 分支中，检查：若 `hyperedgesOptIn === true`，则打印 WARNING：
    ```
    [WARNING] --hyperedges 已启用但前置条件未满足：designDocAbsPaths 为空。
    请先不带 --hyperedges 完整运行一次 batch（mode=full），生成项目文档后再启用。
    ```
  - 验收：新项目（无 project docs）`--hyperedges` 运行后 stderr 出现上述 WARNING

- [x] T11: `src/batch/batch-orchestrator.ts` — batch summary 末尾新增 `hyperedge 状态` 行
  - 在 batch 主流程末尾 console.log 汇总块，新增 hyperedge 状态输出逻辑：
    - 若 `hyperedgesOptIn === false`：不打印（静默，用户未请求）
    - 若 `hyperedgesOptIn === true` 且 `designDocAbsPaths.length === 0`：打印 `hyperedges: 0（WARNING: 前置条件未满足，详见上方日志）`
    - 若 `hyperedgesOptIn === true` 且正常运行：打印 `hyperedges: N 条`
  - 注意：当前 hyperedge 数量结果可能需要从集成块提升为局部变量，以便在汇总块访问
  - 验收：按三种情况分别运行，控制台输出符合预期

---

## Bug 4：Reading Mode 文档误导 — 纯字符串修正

- [x] T12: `src/cli/index.ts` — 更新 `--mode` help 文字
  - 将 L97 的 `--mode` 行从：
    ```
    --mode  批处理运行模式: full（默认，完整文档）| reading（轻量，跳过产品文档层）| code-only（纯 AST，跳过所有 LLM 推断）（仅 batch）
    ```
    更新为（含时间预估）：
    ```
    --mode  批处理运行模式: full（默认，完整文档，LLM 全量）| reading（省约 38% 时间，模块级 LLM 仍运行，跳过架构叙事/ADR/产品文档层）| code-only（纯 AST，< 30s，无 LLM，最快）（仅 batch）
    ```
  - 验收：`spectra --help` 输出中 `--mode` 行含三档时间/特征说明

- [x] T13: `src/cli/commands/batch.ts` — `mode=reading` 时打印 TTY hint
  - 在 `runBatch` 调用之前（确认 mode 解析完成后），当 `mode === 'reading'` 且 `process.stdout.isTTY` 时打印：
    ```
    提示：reading 模式省约 38% 时间，但模块级 LLM 仍运行（非快速模式）。
    如需最快分析（< 30s），请使用 --mode code-only
    ```
  - 验收：`spectra batch . --mode reading` 在 TTY 终端出现上述提示；`--mode code-only` 和 `--mode full` 不出现该提示；非 TTY（如管道）不出现

- [x] T14: `CHANGELOG.md` — 新增 v4.0.1 节
  - 在文件顶部（最新版本之前）插入 v4.0.1 节，包含：
    - **修复**：ADR pipeline 临时禁用（默认 false，用 `--enable-adr` 显式开启）
    - **修复**：`--hyperedges` 前置条件不满足时补全 WARNING 输出，消除静默失败
    - **修复**：`generatedBy` 字段从 `spectra v3.0` 改为动态读取 package.json version
    - **修复**：`--mode reading` help 文字补充时间预估和与 `code-only` 的明确区分
  - 验收：CHANGELOG.md 顶部出现 v4.0.1 节，4 条修复均列出

---

## 测试与验收

- [x] T15: `tests/unit/generator/frontmatter.test.ts` — 新增 `generatedBy` 版本字段断言
  - 测试用例：`generateFrontmatter(...)` 输出的 `generatedBy` 等于 `` `spectra v${require('../../package.json').version}` ``
  - 验收：`npx vitest run tests/unit/generator/frontmatter.test.ts` 通过

- [x] T16: `tests/unit/feature135-adr-guard-hyperedges-warning.test.ts` — 新增 ADR guard + hyperedges WARNING 断言（静态源码分析）
  - 测试用例 1：CLICommand / BatchOptions / GenerateBatchProjectDocsOptions 均包含 enableAdr 字段
  - 测试用例 2：generateBatchProjectDocs 中存在 if(options.enableAdr) 守卫
  - 测试用例 3：!semanticIntegrationAllowed 分支使用 logger.warn
  - 测试用例 4：designDocAbsPaths 为空时补充 WARNING 和操作建议
  - 验收：`npx vitest run tests/unit/feature135-adr-guard-hyperedges-warning.test.ts` 通过

- [x] T17: 全量验证 — 构建 + 测试 + 发布检查
  - 执行 `npm run build`，确认类型检查零错误（重点：新增字段的类型传递链完整）
  - 执行 `npx vitest run`，确认零新增失败（2 个既有集成测试失败为 pre-existing，与本次修复无关）
  - 执行 `grep -rn 'spectra v[0-9]' src/ --include="*.ts"` 确认 0 命中
  - 验收：构建零错误；新增测试全部通过；无 hardcoded version string
