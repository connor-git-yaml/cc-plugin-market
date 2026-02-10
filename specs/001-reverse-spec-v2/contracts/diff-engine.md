# API 契约：差异引擎

**模块**：`src/diff/`
**覆盖**：FR-018、FR-019、FR-020、FR-021、FR-022

---

## structural-diff

**文件**：`src/diff/structural-diff.ts`

### `compareSkeletons(oldSkeleton: CodeSkeleton, newSkeleton: CodeSkeleton): DriftItem[]`

比较两个 CodeSkeleton 并识别导出符号中的结构差异。

**参数**：
- `oldSkeleton` — 规格生成时的骨架（或从规格重建的骨架）
- `newSkeleton` — 当前源代码的骨架

**返回**：`DriftItem[]`，其中 `detectedBy: 'structural'`

**检测规则**：
| 变更类型 | 严重级别 | 分类 |
|--------|----------|----------|
| 导出被移除 | HIGH | Interface |
| 签名被修改 | MEDIUM | Interface |
| 新增导出 | LOW | Interface |
| 类型参数变更 | MEDIUM | Interface |
| 返回类型变更 | MEDIUM | Interface |
| 新增参数（可选） | LOW | Interface |
| 新增参数（必选） | MEDIUM | Interface |

**保证**：
- 签名级别变更检测率 95% 以上（SC-006）
- 对相同骨架零误报
- `oldValue` 和 `newValue` 填充精确签名

---

## semantic-diff

**文件**：`src/diff/semantic-diff.ts`

### `evaluateBehaviorChange(oldCode: string, newCode: string, specDescription: string): Promise<DriftItem | null>`

委托 LLM 评估函数体变更是否违反规格中声明的意图。

**参数**：
- `oldCode` — 之前的函数体（或摘要）
- `newCode` — 当前的函数体
- `specDescription` — 描述预期行为的相关规格章节

**返回**：若检测到漂移则返回 `DriftItem`（`detectedBy: 'semantic'`），否则返回 `null`

**约束**：
- 仅在结构差异检测到签名不变但函数体变更时调用（FR-020）
- LLM 响应通过 Zod 验证是否符合 DriftItem 模式
- 语义差异的分类始终为 `'Behavior'`

---

## noise-filter

**文件**：`src/diff/noise-filter.ts`

### `filterNoise(items: DriftItem[], oldContent: string, newContent: string): FilterResult`

从漂移结果中移除非实质性变更。

**返回**：
```typescript
interface FilterResult {
  substantive: DriftItem[];   // 需要报告的有意义变更
  filtered: number;           // 被移除的噪声项计数
  filterReasons: Map<string, string>;  // itemId → 过滤原因
}
```

**噪声分类**（始终过滤 — FR-021）：
- 仅空白字符变更
- 注释的增删改
- import 重排序（相同 import，不同顺序）
- 尾逗号的增删
- 分号的插入/移除（ASI 等价）

**保证**：
- 零误报：不会将实质性变更错误过滤（SC-007）
- 过滤计数在 DriftReport 中报告以确保透明度

---

## drift-orchestrator

**文件**：`src/diff/drift-orchestrator.ts`

### `detectDrift(specPath: string, sourcePath: string, options?: DriftOptions): Promise<DriftReport>`

规格漂移检测的端到端编排。这是 `/reverse-spec-diff` 调用的入口点。

**参数**：

- `specPath` — 现有规格文件路径（如 `specs/auth.spec.md`）
- `sourcePath` — 当前源目录路径（如 `src/auth/`）
- `options.skipSemantic` — 跳过 LLM 语义评估，仅进行结构差异检测（默认：`false`）

**返回**：`DriftReport`（参见 [data-model.md](../data-model.md#6-driftreport)）

**流水线步骤**：

1. 从规格文件加载基线 `CodeSkeleton`（`loadBaselineSkeleton`）
2. 对当前源代码进行 AST 分析 → 新 `CodeSkeleton`（`ast-analyzer`）
3. 结构差异：比较新旧骨架（`compareSkeletons`）
4. 噪声过滤：移除空白/注释/import 变更（`filterNoise`）
5. 语义差异：对仅函数体变更的情况委托 LLM 评估（`evaluateBehaviorChange`）
6. 组装带严重级别分类的 `DriftReport`
7. 通过 Handlebars 渲染漂移报告（`templates/drift-report.hbs`）
8. 写入 `drift-logs/{module}-drift-{date}.md`

**约束**：

- Constitution IV：仅写入 `drift-logs/`；规格文件不会被修改
- FR-022：规格更新需要用户显式确认（由 skill 脚本处理，不在此函数范围内）

---

### `loadBaselineSkeleton(specPath: string): CodeSkeleton`

从现有规格文件中提取序列化的基线 `CodeSkeleton`。

**行为**：

- 读取规格中的 HTML 注释块 `<!-- baseline-skeleton: ... -->`
- 反序列化 JSON → 通过 CodeSkeleton Zod 模式验证
- 如果未找到基线（不含嵌入骨架的旧版规格），则降级为从规格的接口定义章节重建部分骨架（尽力而为，标记为 `[不明确]`）

**返回**：`CodeSkeleton`，其中 `parserUsed` 指示来源（`'baseline'` 或 `'reconstructed'`）
