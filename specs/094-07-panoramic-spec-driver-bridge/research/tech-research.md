# F-094-07 技术调研报告

**模式**: codebase-scan（独立模式，无产品调研）
**日期**: 2026-04-11

---

## 一、代码库扫描关键发现

### 1.1 CrossPackageOutput 完整字段

来源：`src/panoramic/generators/cross-package-analyzer.ts`

```typescript
interface CrossPackageOutput {
  title: string;
  generatedAt: string;
  projectName: string;
  workspaceType: 'npm' | 'pnpm' | 'uv';
  mermaidDiagram: string;
  levels: TopologyLevel[];
  topologicalOrder: string[];
  hasCycles: boolean;
  cycleGroups: CycleGroup[];
  stats: DependencyStats;
}

interface TopologyLevel { level: number; packages: string[]; }
interface CycleGroup { packages: string[]; cyclePath: string; }
interface DependencyStats {
  totalPackages: number; totalEdges: number;
  rootPackages: string[]; leafPackages: string[];
}
```

**isApplicable 约束**：仅 `context.workspaceType === 'monorepo'` 时返回 true。

### 1.2 ArchitectureIR 完整字段

来源：`src/panoramic/models/architecture-ir-model.ts`

```typescript
interface ArchitectureIR {
  projectName: string;
  generatedAt: string;
  sourceTags: ArchitectureIRSourceTag[];
  warnings: string[];
  elements: ArchitectureIRElement[];
  relationships: ArchitectureIRRelationship[];
  views: ArchitectureIRView[];
  stats: ArchitectureIRStats;
  metadata: Record<string, unknown>;
}
```

IR builder 由 `buildArchitectureIR(options)` 生成，内部级联调用多个 Generator。

### 1.3 ArchitectureOverviewOutput 关键字段

来源：`src/panoramic/generators/architecture-overview-generator.ts`

```typescript
interface ArchitectureOverviewOutput {
  title: string;
  generatedAt: string;
  model: ArchitectureOverviewModel;
  warnings: string[];
  systemContext?: ArchitectureViewSection;
  deploymentView?: ArchitectureViewSection;
  layeredView?: ArchitectureViewSection;
}
```

---

## 二、现有 CLI 命令注册模式

来源：`src/cli/index.ts`、`src/cli/utils/parse-args.ts`

- `CLICommand.subcommand` 是硬编码联合类型：`'generate' | 'batch' | 'diff' | 'init' | 'prepare' | 'auth-status' | 'mcp-server'`
- `index.ts` 用 `switch(command.subcommand)` 路由到 `src/cli/commands/` 下的 handler
- 新增子命令改动点：parse-args.ts（类型 + 解析）、index.ts（switch + help）、新 command 模块

---

## 三、现有 MCP tool 注册模式

来源：`src/mcp/server.ts`

```typescript
server.tool('tool-name', '描述', { param: z.string() }, async ({ param }) => {
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
});
```

4 个现有工具（prepare / generate / batch / diff）均遵循此模式。新增 `panoramic-query` 只需追加一次 `server.tool()` 调用。

---

## 四、refactor-plan agent 当前实现

来源：`plugins/spec-driver/agents/refactor-plan.md`

当前用 grep 搜索 import/require 做跨包引用检测，手动构建依赖图做拓扑排序。对比：

| 能力 | refactor-plan (grep) | CrossPackageAnalyzer |
|------|---------------------|----------------------|
| 循环依赖识别 | 无 | Tarjan SCC |
| 拓扑排序 | 手动 | 自动 TopologyLevel[] |
| 输出格式 | 自由 Markdown | 结构化 JSON |

---

## 五、架构方案选型

### 方案 A：Thin Facade 模式（推荐）

新增 `src/cli/commands/panoramic.ts` + MCP tool，直接调用 panoramic Generator。业务逻辑提取为共享 helper。

- 优点：最小侵入（~200-300 行新代码），与现有模式 100% 一致，CLI/MCP 共享逻辑
- 缺点：CLICommand 类型需扩展

### 方案 B：独立 Sub-Process 模式

新增独立 bin 入口，CLI 端通过 child_process 调用。

- 优点：CLICommand 零改动
- 缺点：进程间通信复杂，测试困难

### 方案 C：GeneratorRegistry 查询模式

通过 registry 按 id 动态查询 Generator。

- 优点：解耦具体类名
- 缺点：返回 unknown 需 type cast，当前只 3 个操作，过度设计

**推荐方案 A**：与现有架构一致，最小侵入，维护成本最低。

---

## 六、技术风险清单

| 风险 | 概率 | 影响 | 缓解策略 |
|------|------|------|----------|
| CrossPackageAnalyzer 单包项目返回空 | 高 | 中 | CLI 提前检测，友好 error message |
| CLICommand 类型扩展污染 | 中 | 低 | panoramic 专属字段设为 optional |
| JSON Schema contract 漂移 | 低 | 高 | 定义 contract 文件，加 schemaVersion |
| IR Generator 依赖链深，多 warning | 中 | 低 | 利用 warnings 字段透明传递 |
| bootstrapAdapters 遗漏 | 低 | 中 | 确保通过 CLI 主入口路由 |

---

## 七、输出格式 Contract 设计

| CLI 操作 | 核心类型 | 关键字段 |
|---------|---------|---------|
| cross-package | CrossPackageOutput | hasCycles, cycleGroups, levels, topologicalOrder, stats |
| architecture-ir | ArchitectureIR | elements, relationships, views, stats, sourceTags |
| overview | ArchitectureOverviewModel | sections, stats, moduleSummaries |

建议在 `contracts/` 目录新增 `panoramic-bridge.md`，记录 JSON Schema 及版本号。

---

## 八、推荐实现顺序

1. `src/panoramic/query.ts` — 封装 3 个操作的业务逻辑（CLI/MCP 共享）
2. `src/cli/utils/parse-args.ts` — 扩展 subcommand + panoramic 解析
3. `src/cli/commands/panoramic.ts` — 调用 query.ts
4. `src/cli/index.ts` — switch case + help text
5. `src/mcp/server.ts` — 追加 panoramic-query tool
6. `contracts/panoramic-bridge.md` — JSON Schema contract
7. 测试 + 集成测试
