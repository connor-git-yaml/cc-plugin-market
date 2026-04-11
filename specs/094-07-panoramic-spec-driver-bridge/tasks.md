# F-094-07 任务分解

**Plan**: [plan.md](./plan.md) | **Spec**: [spec.md](./spec.md)

---

## Task 1: 新建共享 query helper

**文件**: `src/panoramic/query.ts` (NEW)
**FR**: FR-005, FR-002, FR-006, FR-007, FR-008

- [x] 定义 `PanoramicOperation` 类型和 `PanoramicQueryOptions`/`PanoramicQueryResult` 接口
- [x] 实现 `queryPanoramic()` 函数：buildProjectContext → 按 operation 路由到对应 Generator
- [x] cross-package: 检查 monorepo → CrossPackageAnalyzer.extract() + generate()
- [x] architecture-ir: ArchitectureIRGenerator.extract() + generate() → 返回 `output.ir`
- [x] overview: ArchitectureOverviewGenerator.extract() + generate()
- [x] 统一 catch 错误处理
- [x] 导出 `queryPanoramic` 和相关类型

**验证**: `npm run build` 编译通过

---

## Task 2: 新建 CLI handler

**文件**: `src/cli/commands/panoramic.ts` (NEW)
**FR**: FR-001, FR-003, FR-015

- [x] 实现 `runPanoramicCommand(command: CLICommand)` 函数
- [x] --help 输出帮助文本（列出三个子操作）
- [x] 从 command 读取 panoramicOperation 和 projectRoot
- [x] 调用 queryPanoramic，处理 ok/error 分支
- [x] --json 输出 JSON，否则输出 Markdown 格式

**验证**: `npm run build` 编译通过

---

## Task 3: 修改 CLI 参数解析

**文件**: `src/cli/utils/parse-args.ts` (MODIFY)
**FR**: FR-001, FR-012

- [x] CLICommand.subcommand 联合类型追加 `'panoramic'`
- [x] CLICommand 接口追加 `panoramicOperation?`, `jsonOutput?`, `projectRoot?`
- [x] parseArgs 新增 panoramic 解析分支（含 --help、子操作校验、--json、--project-root）
- [x] extractPositionalArgs 跳过列表追加 `'--project-root'`

**验证**: `npm run build` 编译通过

---

## Task 4: 修改 CLI 入口和帮助文本

**文件**: `src/cli/index.ts` (MODIFY)
**FR**: FR-010

- [x] import runPanoramicCommand
- [x] HELP_TEXT 追加 panoramic 用法和选项说明
- [x] switch case 追加 `'panoramic'`

**验证**: `node dist/cli/index.js --help | grep panoramic`

---

## Task 5: 追加 MCP panoramic-query tool

**文件**: `src/mcp/server.ts` (APPEND)
**FR**: FR-004, FR-011

- [x] import queryPanoramic
- [x] server.tool 注册 panoramic-query（operation enum + projectRoot string 必需）
- [x] 调用 queryPanoramic，返回 JSON text content
- [x] 错误时返回包含 error 字段的正常 JSON（非 isError）

**验证**: `npm run build` 编译通过

---

## Task 6: 新建输出格式合同

**文件**: `contracts/panoramic-bridge.md` (NEW)
**FR**: FR-009, FR-013

- [x] 文档头含 schemaVersion: "1.0.0"
- [x] cross-package 节：Markdown 表格描述所有必需字段
- [x] architecture-ir 节：含 metadata 标注为可选
- [x] overview 节：model 子结构描述
- [x] 错误响应格式节

**验证**: `test -f contracts/panoramic-bridge.md`
