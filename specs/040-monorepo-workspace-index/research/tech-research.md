# Feature 040 技术调研报告

**调研模式**: tech-only
**日期**: 2026-03-19

---

## 1. 现有 Workspace 检测（035 已交付）

`src/panoramic/project-context.ts:91-130` — detectWorkspaceType() 支持 4 种条件：
- pnpm-workspace.yaml 存在
- lerna.json 存在
- package.json workspaces 字段
- pyproject.toml [tool.uv.workspace] 段

ProjectContext 已包含：workspaceType('single'|'monorepo')、packageManager、detectedLanguages

## 2. OctoAgent Monorepo 结构

```
OctoAgent/
├── pyproject.toml          # [tool.uv.workspace] members=[packages/*, apps/*]
├── packages/
│   ├── core/pyproject.toml    # name="octoagent-core"
│   ├── memory/pyproject.toml  # name="octoagent-memory"
│   ├── policy/pyproject.toml
│   ├── protocol/pyproject.toml
│   ├── provider/pyproject.toml
│   ├── skills/pyproject.toml
│   └── tooling/pyproject.toml
└── apps/
    └── gateway/pyproject.toml # name="octoagent-gateway"
```

子包元信息来源：各 pyproject.toml 的 [project] 表（name/description/dependencies）

## 3. Workspace Members 解析策略

| 包管理器 | 来源文件 | Members 格式 | 子包元信息 |
|---------|---------|-------------|-----------|
| npm/yarn | package.json | `workspaces: ["packages/*"]` (glob) | 子 package.json |
| pnpm | pnpm-workspace.yaml | `packages: ["packages/*"]` (glob) | 子 package.json |
| uv | pyproject.toml | `members = ["packages/core", ...]` (精确) | 子 pyproject.toml |

## 4. 设计决策

1. **实现为 DocumentGenerator**：`WorkspaceIndexGenerator implements DocumentGenerator<WorkspaceInput, WorkspaceOutput>`
2. **数据类型放在 panoramic 内部**：不新建 src/models/workspace.ts，遵循 panoramic 模块自治
3. **纯正则解析 pyproject.toml**：复用现有模式（project-context.ts），不引入 TOML 库
4. **npm/pnpm glob 展开**：用 fs.readdirSync 匹配 `packages/*` 模式
5. **Mermaid 依赖图**：生成包级 graph TD 拓扑图
6. **模板**: `templates/workspace-index.hbs`
7. **注册到 GeneratorRegistry**: bootstrapGenerators() 中添加

## 5. 关键接口

```typescript
interface WorkspacePackageInfo {
  name: string;           // 包名
  path: string;           // 相对路径
  description: string;    // 包描述
  language: string;       // 主要语言
  dependencies: string[]; // 内部依赖（workspace 内引用）
}

interface WorkspaceInput {
  projectName: string;
  workspaceType: string;      // npm/pnpm/uv
  packages: WorkspacePackageInfo[];
}

interface WorkspaceOutput {
  title: string;
  projectName: string;
  generatedAt: string;
  packages: WorkspacePackageInfo[];
  dependencyDiagram: string;  // Mermaid graph TD
  totalPackages: number;
}
```
