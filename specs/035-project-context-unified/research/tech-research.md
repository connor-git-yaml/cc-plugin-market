# Feature 035 技术调研报告

**调研模式**: tech-only
**日期**: 2026-03-19

---

## 1. 现有 ProjectContext 占位版本

**文件**: `src/panoramic/interfaces.ts:57-67`

```typescript
export const ProjectContextSchema = z.object({
  projectRoot: z.string().min(1),
  configFiles: z.map(z.string(), z.string()),
});
export type ProjectContext = z.infer<typeof ProjectContextSchema>;
```

仅 `projectRoot` + `configFiles`，需扩展为蓝图 6.3 节完整版本。

---

## 2. 蓝图目标属性

| 属性 | 类型 | 来源 | 现状 |
|------|------|------|------|
| projectRoot | string | 参数 | ✅ 已有 |
| configFiles | Map<string, string> | 文件扫描 | ✅ 占位 |
| packageManager | enum | lock 文件检测 | ❌ 新增 |
| workspaceType | 'single' \| 'monorepo' | workspace 配置分析 | ❌ 新增 |
| detectedLanguages | string[] | scanFiles + Registry | ❌ 新增（可复用） |
| existingSpecs | string[] | specs/ 目录扫描 | ❌ 新增 |

---

## 3. 现有代码中的项目元信息获取

### 语言检测（可复用）

**文件**: `src/utils/file-scanner.ts:253-269`
- `scanFiles()` 返回 `languageStats: Map<adapterId, LanguageFileStat>`
- 通过 `LanguageAdapterRegistry.getAdapter(fileName)` 按扩展名匹配

**文件**: `src/batch/batch-orchestrator.ts:192-197`
```typescript
const scanResult = scanFiles(resolvedRoot, { projectRoot: resolvedRoot });
const languageStats = scanResult.languageStats;
const detectedLanguages = languageStats ? Array.from(languageStats.keys()) : [];
```

### Workspace 检测（分散）

- `batch-orchestrator.ts:205-246` — 多语言 workspace 处理，无统一 workspace 检测函数
- 需新建 `detectWorkspaceType()` 函数，检测：
  - `package.json` → `workspaces` 字段
  - `pnpm-workspace.yaml` → 存在即 monorepo
  - `pyproject.toml` → `[tool.uv.workspace]` 段
  - `lerna.json` → 存在即 monorepo

### 包管理器检测（不存在）

需新建 `detectPackageManager()` 函数，按 lock 文件优先级：
- `package-lock.json` → npm
- `yarn.lock` → yarn
- `pnpm-lock.yaml` → pnpm
- `uv.lock` → uv
- `go.sum` / `go.mod` → go
- `pom.xml` → maven
- `build.gradle` / `build.gradle.kts` → gradle
- `Pipfile.lock` → pipenv

### configFiles 扫描（需实现）

需扫描已知配置文件：package.json, tsconfig.json, pyproject.toml, docker-compose.yml, Dockerfile, .eslintrc, .prettierrc 等。

### existingSpecs 扫描（需实现）

扫描 `specs/` 和项目目录下 `*.spec.md` 文件。

---

## 4. OctoAgent 验证特征

```
OctoAgent/
├── packages/ (7 子包: core, memory, policy, protocol, provider, skills, tooling)
├── apps/ (1 应用: gateway)
├── pyproject.toml ([tool.uv.workspace] members=[...])
├── octoagent.yaml
├── uv.lock
└── (无 package.json — 纯 Python monorepo)
```

**预期 ProjectContext 输出**:
- projectRoot: "/Users/.../OctoAgent"
- packageManager: "uv"
- workspaceType: "monorepo"
- detectedLanguages: ["python", "typescript"] (取决于实际文件)
- configFiles: Map { "pyproject.toml" → "..." , "octoagent.yaml" → "..." , ... }
- existingSpecs: [] (无已有 spec)

---

## 5. 设计决策建议

1. **扩展而非替换**: 使用 `ProjectContextSchema.extend({...})` 保持向后兼容
2. **构建函数**: `buildProjectContext(projectRoot)` → `Promise<ProjectContext>`
3. **文件放置**: `src/panoramic/project-context.ts`（新文件）
4. **最小外部依赖**: 仅用 `fs.existsSync()` + `fs.readFileSync()` 检测，不引入新依赖
5. **复用 scanFiles**: 语言检测复用 `file-scanner.ts` 的 `scanFiles()`
6. **正交性**: 不修改现有 batch-orchestrator，仅新增 `project-context.ts`
