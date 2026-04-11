# Implementation Plan: F-094-07 Panoramic → Spec-Driver CLI 桥接

**Branch**: `feature/089-skill-orchestration-split` | **Date**: 2026-04-11 | **Spec**: [spec.md](./spec.md)

## 概述

将现有 `CrossPackageAnalyzer`、`ArchitectureIRGenerator`、`ArchitectureOverviewGenerator` 以 Thin Facade 模式暴露为 CLI 子命令 `panoramic` 和 MCP tool `panoramic-query`。核心决策：新建共享 helper `src/panoramic/query.ts` 封装全部业务逻辑，CLI handler 和 MCP tool 均通过该 helper 完成调用。

## 技术上下文

- **Language**: TypeScript 5.x / Node.js 20.x+
- **新依赖**: 0（复用现有 `zod`、`@modelcontextprotocol/sdk`）
- **风险等级**: LOW（6 文件变更，追加式修改，无跨包影响）

## 实施步骤

### Step 1：新建 `src/panoramic/query.ts`（共享 query helper）

封装三种操作业务逻辑，是 CLI/MCP 唯一调用点（FR-005）。

```typescript
export type PanoramicOperation = 'cross-package' | 'architecture-ir' | 'overview';
export interface PanoramicQueryOptions { projectRoot: string; operation: PanoramicOperation; }
export type PanoramicQueryResult =
  | { ok: true; data: unknown }
  | { ok: false; error: string };
export async function queryPanoramic(options: PanoramicQueryOptions): Promise<PanoramicQueryResult>
```

实现：
1. `buildProjectContext(projectRoot)` 构建 ProjectContext
2. `cross-package`: 检查 monorepo → CrossPackageAnalyzer.extract() + generate() → CrossPackageOutput
3. `architecture-ir`: ArchitectureIRGenerator.extract() + generate() → 返回 `output.ir`（ArchitectureIR，非整个 ArchitectureIROutput）
4. `overview`: ArchitectureOverviewGenerator.extract() + generate() → ArchitectureOverviewOutput
5. 统一 catch 返回 `{ ok: false, error }`

### Step 2：新建 `src/cli/commands/panoramic.ts`（CLI handler）

```typescript
export async function runPanoramicCommand(command: CLICommand): Promise<void>
```

- `command.help` → 输出帮助文本
- `command.panoramicOperation` + `command.projectRoot ?? process.cwd()` → queryPanoramic()
- `result.ok === false` → console.error + exitCode = 1
- `command.jsonOutput` → JSON.stringify | 否则 Markdown 格式

### Step 3：修改 `src/cli/utils/parse-args.ts`

- **改动 A**: CLICommand.subcommand 联合类型追加 `'panoramic'`
- **改动 B**: CLICommand 接口追加 optional 字段：`panoramicOperation?`, `jsonOutput?`, `projectRoot?`
- **改动 C**: parseArgs 中 `if (sub === 'panoramic')` 分支（含 --help、子操作解析、--json、--project-root）
- **改动 D**: extractPositionalArgs 跳过列表追加 `'--project-root'`

### Step 4：修改 `src/cli/index.ts`

- import runPanoramicCommand
- HELP_TEXT 追加 panoramic 条目和选项说明
- switch case 追加 `'panoramic'`

### Step 5：追加到 `src/mcp/server.ts`

在 `return server;` 前插入：

```typescript
server.tool('panoramic-query', '运行 panoramic 架构分析', {
  operation: z.enum(['cross-package', 'architecture-ir', 'overview']).describe('分析操作类型'),
  projectRoot: z.string().describe('项目根目录绝对路径（必需）'),
}, async ({ operation, projectRoot }) => {
  const result = await queryPanoramic({ operation, projectRoot });
  if (!result.ok) {
    return { content: [{ type: 'text' as const, text: JSON.stringify({ error: result.error }) }] };
  }
  return { content: [{ type: 'text' as const, text: JSON.stringify(result.data) }] };
});
```

### Step 6：新建 `contracts/panoramic-bridge.md`

Markdown 表格格式，含 schemaVersion: "1.0.0"。三个操作节：
- cross-package: hasCycles, cycleGroups, topologicalOrder, levels, stats, mermaidDiagram...
- architecture-ir: elements, relationships, views, stats, sourceTags, warnings, metadata(可选)
- overview: model(sections, stats, moduleSummaries), warnings

## 关键文件清单

| 文件路径 | 操作 | 说明 |
|---------|------|------|
| `src/panoramic/query.ts` | NEW | 共享 query helper |
| `src/cli/commands/panoramic.ts` | NEW | CLI handler |
| `src/cli/utils/parse-args.ts` | MODIFY | CLICommand 扩展 + panoramic 解析 |
| `src/cli/index.ts` | MODIFY | switch + help text |
| `src/mcp/server.ts` | APPEND | panoramic-query tool |
| `contracts/panoramic-bridge.md` | NEW | JSON 输出合同 |

## 验证命令

```bash
npm run build
node dist/cli/index.js --help | grep panoramic
node dist/cli/index.js panoramic cross-package --json | jq .hasCycles
node dist/cli/index.js panoramic architecture-ir --json | jq '.elements | length'
node dist/cli/index.js panoramic overview --json | jq '.model.stats'
```

## 风险及缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| parse-args.ts 合法性检查遗漏 panoramic | 高 | 中 | panoramic 分支提前 return，确认不被其他守卫拦截 |
| architecture-ir 误返回整个 Output 而非 .ir | 中 | 中 | 明确注明返回 output.ir |
| contract 字段漂移 | 低 | 高 | schemaVersion 标注，变更时更新版本 |
