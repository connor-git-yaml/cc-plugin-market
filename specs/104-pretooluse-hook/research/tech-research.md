# 技术调研报告 — Feature 104: PreToolUse Hook

## 1. CLI 命令注册模式

**参数解析**：手工实现（`src/cli/utils/parse-args.ts`），无第三方库。

**注册三步走**：
1. `CLICommand` interface 添加字段（`installGit?: boolean`, `installRemove?: boolean`）
2. `parseArgs()` 添加 `if (sub === 'install')` 分支
3. `src/cli/index.ts` switch 添加 `case 'install'`

**约定**：布尔 flag 用 `argv.includes('--flag')`，带值选项用 `indexOf` + 偏移。

## 2. 安装器模式

**现有模式**（`src/installer/skill-installer.ts`）：
- `mkdirSync({ recursive: true })` + `writeFileSync()` 非原子
- 幂等性：`existsSync()` 检测，区分 `installed`/`updated`
- 错误收集不中断循环

**原子写入工具**：`src/utils/atomic-write.ts` 的 `writeAtomicJson()`（先写 `.tmp` 再 `renameSync`）。

**Feature 104 需要**：
- settings.json：JSON 深度合并 + 原子写入（推荐用 `writeAtomicJson`）
- git hook：shell 文件追加 + `chmod +x`

## 3. Graph 数据结构

```typescript
interface GraphJSON {
  graph: { nodeCount: number; edgeCount: number; schemaVersion: '1.0'; ... };
  nodes: GraphNode[];  // { id, kind, label, metadata }
  links: GraphEdge[];  // { source, target, relation, confidence }
}
```

读取入口：`GraphQueryEngine.loadFromFile(graphPath)`。

## 4. God Node 数据

```typescript
interface GodNode { id: string; label: string; degree: number; primaryRelation: string; communityId: number; }
```

获取需要 graphology 图实例，或解析 `_meta/GRAPH_REPORT.md` 已渲染内容。

## 5. 现有 settings.json 结构

```json
{ "enabledPlugins": { "reverse-spec@cc-plugin-market": true, "spec-driver@cc-plugin-market": true } }
```

需注入 `hooks` 字段，深度合并保留已有内容。

## 6. 测试约定

- 框架：Vitest（`vitest run`）
- 文件系统测试：`mkdtempSync` + `beforeEach/afterEach` 清理
- E2E：`execFileSync('node', [CLI_PATH, ...args], { cwd: tempDir })`
- 无 mock 模块，直接构造数据结构

## 7. 关键依赖

| 模块 | 路径 | 用途 |
|------|------|------|
| `writeAtomicJson` | `src/utils/atomic-write.ts` | settings.json 安全写入 |
| `GraphJSON` | `src/panoramic/graph/graph-types.ts` | 类型约束 |
| `parseArgs` | `src/cli/utils/parse-args.ts` | 命令注册 |
| `printError` | `src/cli/utils/error-handler.ts` | 错误输出 |

## 8. Graphify 参考要点

- **极简设计**：单一类而非分层抽象（参考 GraphQueryEngine 模式）
- **纯 JS 实现**：不引入额外运行时依赖
- **Silent Skip**：graceful degradation（graph.json 不存在时静默跳过）
- **Last-Write-Wins**：幂等写入策略

## 9. 风险项

1. **settings.json 并发写入**：用 `writeAtomicJson` + 同步读-合并-写缓解
2. **git hook 覆盖冲突**：追加模式 + 标记段落
3. **图谱路径不一致**：`graph` 写入 `specs/_meta/`，`query` 读取 `_meta/`，需统一
4. **PreToolUse hook 语法**：需确认 Claude Code hooks 的精确 JSON schema
5. **install vs init 语义**：`init` = skill 安装，`install` = hook 安装，需 help 文本明确区分
