# API 契约更新：核心流水线

**Feature**: 005-batch-quality-fixes
**更新对象**: `specs/001-reverse-spec-v2/contracts/core-pipeline.md`
**涉及文件**: `src/core/single-spec-orchestrator.ts`

---

## 修改：single-spec-orchestrator

**文件**：`src/core/single-spec-orchestrator.ts`

### `generateSpec(targetPath: string, options?: GenerateSpecOptions): Promise<GenerateSpecResult>`

**返回类型更新**：

```typescript
interface GenerateSpecResult {
  specPath: string;
  skeleton: CodeSkeleton;
  tokenUsage: number;
  confidence: 'high' | 'medium' | 'low';
  warnings: string[];
  moduleSpec: ModuleSpec;   // 新增：完整的 ModuleSpec 对象
}
```

| 字段 | 变更 | 说明 |
|------|------|------|
| `moduleSpec` | **新增** | 完整的 ModuleSpec 数据（含 frontmatter、sections、diagrams 等），供 batch 的 `generateIndex()` 使用 |

**流水线步骤更新**（步骤 8 扩展）：

原步骤 8：渲染 Spec → Handlebars 渲染

更新后的步骤 8：

1. 生成 Mermaid 类图（不变）
2. **新增**：调用 `generateDependencyDiagram(mergedSkeleton, skeletons)` 生成依赖关系图
3. 生成 frontmatter（不变）
4. **修改**：`fileInventory` 中的路径使用 `path.relative(baseDir, filePath)` 生成相对路径
5. **修改**：`mermaidDiagrams` 数组包含类图和依赖图（如有）
6. 构建 `ModuleSpec` 并渲染输出
7. **新增**：在返回的 `GenerateSpecResult` 中包含 `moduleSpec` 字段

**`fileInventory` 路径变更**：

| 之前 | 之后 |
|------|------|
| 绝对路径（`/Users/.../src/auth/login.ts`） | 相对路径（`src/auth/login.ts`，基于 `projectRoot`） |

**新增依赖**：

- `import { generateDependencyDiagram } from '../generator/mermaid-dependency-graph.js'`
