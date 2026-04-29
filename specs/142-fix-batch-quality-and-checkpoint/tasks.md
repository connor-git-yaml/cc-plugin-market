# 任务列表：v4.0.2 Batch 质量 + 跨模式断点修复

**特性**: 142-fix-batch-quality-and-checkpoint | **计划**: plan.md | **总任务数**: 11

---

## Bug 3：跨模式断点复用（优先修）

### T01：SpecFrontmatter 类型新增 generatedByMode 字段

- [x] T01: 在 `SpecFrontmatterSchema` 和 `SpecFrontmatter` 类型新增 `generatedByMode` optional 字段

**影响文件**
- `src/models/module-spec.ts`：`SpecFrontmatterSchema`（L55-82）

**变更说明**
在 `SpecFrontmatterSchema` 的 `sourceKind` 字段（当前 L79）之前插入：
```typescript
/** 生成本 spec 时的批处理模式（Bug 142 修复）；旧 spec 缺失此字段时视为 cache miss */
generatedByMode: z.enum(['full', 'reading', 'code-only']).optional(),
```
`SpecFrontmatter` type 通过 `z.infer` 自动继承，无需额外改动。

**关键约束**：字段必须 `optional()`，不得设为必填，否则破坏现有 spec 的 Zod 解析路径。

**FR 关联**: Bug 3 根因（Why 4）— SpecFrontmatter 无 generatedByMode 字段

**验收**
- `npm run build` 零类型错误
- `SpecFrontmatter` 类型的 `generatedByMode` 字段可选，值为 `'full' | 'reading' | 'code-only' | undefined`

**预估**: 15 分钟

---

### T02：frontmatter.ts 写入 generatedByMode 字段

- [x] T02: 在 `FrontmatterInput` 接口和 `generateFrontmatter` 函数中增加 `generatedByMode` 写入逻辑

**影响文件**
- `src/generator/frontmatter.ts`：`FrontmatterInput` 接口（L31-60）+ `generateFrontmatter` 函数（L80-124）

**变更说明**
1. `FrontmatterInput` 接口末尾（`derivedFrom` 字段之后）新增：
   ```typescript
   /** 生成本 spec 时的批处理模式（Bug 142）；单文件 generate 不传，batch 流程传入 effectiveMode */
   generatedByMode?: 'full' | 'reading' | 'code-only';
   ```
2. `generateFrontmatter` 函数中，在 `sourceKind` 写入块（`if (data.sourceKind !== undefined)`）之前新增：
   ```typescript
   if (data.generatedByMode !== undefined) {
     frontmatter.generatedByMode = data.generatedByMode;
   }
   ```

**FR 关联**: Bug 3 修复策略步骤 2

**验收**
- `generateFrontmatter({ ..., generatedByMode: 'full' })` 返回含 `generatedByMode: 'full'` 的 frontmatter
- `generateFrontmatter({ ... })` （不传 generatedByMode）返回无该字段的 frontmatter（向后兼容）
- `npm run build` 零类型错误

**预估**: 15 分钟

---

### T03：delta-regenerator 加 mode 检查 + StoredModuleSpecSummary 同步

- [x] T03: 在 `detectDirectChanges()` 加 mode 不匹配判定；同步 `StoredModuleSpecSummary`、`extractStoredModuleSpecSummary`、`DeltaChangeReason`

**影响文件**
- `src/batch/delta-regenerator.ts`：`DeltaChangeReason` 类型（L19-23）、`detectDirectChanges` 函数签名 + 函数体（L264-311）
- `src/panoramic/builders/doc-graph-builder.ts`：`StoredModuleSpecSummary` 接口（L32-43）、`extractStoredModuleSpecSummary` 函数（L384-L530 附近）、`scanStoredModuleSpecs` 函数（L121-167）

**变更说明**

1. **`DeltaChangeReason` 新增值**（`delta-regenerator.ts:L19-23`）：
   ```typescript
   export type DeltaChangeReason =
     | 'missing-spec'
     | 'metadata-missing'
     | 'skeleton-changed'
     | 'dependency-propagation'
     | 'mode-changed';   // Bug 142 新增
   ```

2. **`detectDirectChanges` 函数签名新增参数**：
   ```typescript
   function detectDirectChanges(
     snapshots: CurrentTargetSnapshot[],
     storedSpecs: StoredModuleSpecSummary[],
     effectiveMode: 'full' | 'reading' | 'code-only',   // Bug 142 新增
   ): DeltaTargetState[]
   ```

3. **`detectDirectChanges` 函数体**，在 `stored.skeletonHash !== snapshot.currentHash` 检查（当前约 L297）之后，unchanged 返回（`return []`）之前，新增 mode 检查：
   ```typescript
   // Bug 142：旧 spec（无 generatedByMode）或 mode 不匹配 → cache miss（安全兜底）
   if (!stored.generatedByMode || stored.generatedByMode !== effectiveMode) {
     return [{
       sourceTarget: snapshot.sourceTarget,
       sourceFiles: snapshot.sourceFiles,
       currentHash: snapshot.currentHash,
       previousHash: stored.skeletonHash,
       reason: 'mode-changed' as const,
       impactedBy: [],
     }];
   }
   ```
   **注意**：此条件使用 `!stored.generatedByMode || ...`，确保旧 spec（字段缺失）一律触发 cache miss。

4. **`DeltaRegenerator.plan()` 调用处**（约 L117）将 `effectiveMode` 传入 `detectDirectChanges`：
   ```typescript
   // DeltaRegeneratorOptions 新增 effectiveMode 字段
   const directChanges = detectDirectChanges(snapshots, options.storedSpecs, options.effectiveMode);
   ```
   同步更新 `DeltaRegeneratorOptions` 接口新增 `effectiveMode: 'full' | 'reading' | 'code-only'`。

5. **`StoredModuleSpecSummary` 接口**（`doc-graph-builder.ts:L32-43`）新增字段：
   ```typescript
   /** 生成本 spec 时的批处理模式；旧 spec 缺失时为 undefined */
   generatedByMode?: 'full' | 'reading' | 'code-only';
   ```

6. **`extractStoredModuleSpecSummary` 函数**（`doc-graph-builder.ts:L384`）新增 `generatedByMode` 解析分支（仿照现有 `sourceKind` 解析逻辑），并在返回值 object 中包含该字段。

7. **`scanStoredModuleSpecs` 函数**（`doc-graph-builder.ts:L121`）在构造 `StoredModuleSpecSummary` document 时新增：
   ```typescript
   generatedByMode: metadata.generatedByMode,
   ```

**关键约束**：`!stored.generatedByMode || stored.generatedByMode !== effectiveMode` 逻辑不可改为 `stored.generatedByMode && stored.generatedByMode !== effectiveMode`，后者会让旧 spec 跳过检查（不安全）。

**FR 关联**: Bug 3 修复策略步骤 3 + 4；plan.md 风险点 2 + 3

**验收**
- reading mode 生成的 spec（generatedByMode: 'reading'），接 full mode → `detectDirectChanges` 返回 `reason: 'mode-changed'`
- full mode 生成的 spec，接 full mode + hash 未变 → 返回 unchanged（`[]`）
- 旧 spec（无 generatedByMode）+ 任意 mode → 返回 `reason: 'mode-changed'`
- `npm run build` 零类型错误

**预估**: 45 分钟

---

### T04：batch-orchestrator 传入 effectiveMode 到 DeltaRegenerator

- [x] T04: 在 `batch-orchestrator.ts` 的 `DeltaRegenerator.plan()` 调用处传入 `effectiveMode`，并在 `generateSpec` 调用处传入 `generatedByMode`

**影响文件**
- `src/batch/batch-orchestrator.ts`：`DeltaRegenerator.plan()` 调用处 + `genOptions` 构造（约 L670-706）

**变更说明**
1. 找到 `DeltaRegenerator.plan(options)` 调用处（约 L500-550 范围），在 options 对象中新增 `effectiveMode` 字段：
   ```typescript
   const deltaReport = await deltaGen.plan({
     projectRoot: resolvedRoot,
     dependencyGraph: mergedGraph,
     moduleGroups: groups,
     storedSpecs,
     effectiveMode,   // Bug 142 新增
   });
   ```
2. 在 `genOptions` 构造处（L670-706），`generateSpec` 的 `FrontmatterInput` 路径中传入 `generatedByMode`。检查 `generateSpec` 是否接受 `generatedByMode` 参数（在 `GenerateSpecOptions` 中新增 optional 字段），或通过其他机制传递。若 `generateSpec` 不透传 frontmatter 参数，则在 spec 写入后通过 patch 注入（但更推荐通过 `GenerateSpecOptions` 传递）。

**FR 关联**: Bug 3 修复策略步骤 2 的调用方连接

**验收**
- `DeltaRegenerator.plan()` 调用处编译通过
- batch 运行时生成的 spec 文件 frontmatter 中含 `generatedByMode: <当前 effectiveMode>`
- `npm run build` 零类型错误

**预估**: 30 分钟

---

### T05：Bug 3 集成测试

- [x] T05: 新增集成测试覆盖跨模式 cache miss 场景

**影响文件**
- `tests/unit/delta-regenerator-mode.test.ts`（新增）

**测试场景**
1. **跨模式 cache miss**：`storedSpecs` 含 `generatedByMode: 'reading'`，`effectiveMode = 'full'` → `detectDirectChanges` 返回含 `reason: 'mode-changed'` 的条目（不返回空数组）
2. **同模式 hash 未变**：`storedSpecs` 含 `generatedByMode: 'full'`，`effectiveMode = 'full'`，hash 一致 → 返回 `[]`（正常 unchanged）
3. **旧 spec 安全降级**：`storedSpecs` 无 `generatedByMode` 字段，`effectiveMode = 'full'` → 返回 `reason: 'mode-changed'`（不跳过）
4. **同模式 hash 变化**：`generatedByMode: 'full'`，hash 不一致 → 返回 `reason: 'skeleton-changed'`（原有行为不退化）

**FR 关联**: fix-report.md Bug 3 同步更新清单

**验收**
- `npx vitest run tests/unit/delta-regenerator-mode.test.ts` 4 个场景全部通过
- 全量 `npx vitest run` 零失败

**预估**: 30 分钟

---

## Bug 1：单模块重试无 token 预算上限（次修）

### T06：FailedModule 类型新增 reason 字段

- [x] T06: 在 `FailedModule` Zod schema 和类型中新增 `reason?: string` optional 字段

**影响文件**
- `src/models/module-spec.ts`：`FailedModuleSchema`（L232-239）

**变更说明**
```typescript
export const FailedModuleSchema = z.object({
  path: z.string().min(1),
  error: z.string().min(1),
  failedAt: z.string().datetime(),
  retryCount: z.number().int().nonnegative(),
  degradedToAstOnly: z.boolean(),
  /** 失败原因标识（Bug 142）；'retry-budget-exceeded' 表示累计 token 超限 */
  reason: z.string().optional(),
});
```

**关键约束**：必须 optional，不得修改已有字段，向后兼容现存 batch-state checkpoint 文件。

**FR 关联**: Bug 1 修复策略同步更新清单

**验收**
- `FailedModule` 类型含 `reason?: string`
- `npm run build` 零类型错误

**预估**: 10 分钟

---

### T07：batch-orchestrator retry loop 加累计 token 预算短路

- [x] T07: 在 retry loop 入口前初始化累计 token 追踪变量，每次 LLM 调用后检查预算，超限时 break 并设置失败原因

**影响文件**
- `src/batch/batch-orchestrator.ts`：L654-837 重试 loop

**变更说明**

1. 文件顶部（imports 之后，或第一个 `const` 声明处）新增常量：
   ```typescript
   /** 单模块重试累计 input token 预算上限（Bug 142）；超出后提前终止重试 */
   const RETRY_TOKEN_BUDGET = 40_000;
   ```

2. `while` 循环（L661）之前新增局部变量：
   ```typescript
   let cumulativeInputTokens = 0;
   let moduleTokenBudgetExceeded = false;
   ```

3. 在非 root 模块的 `generateSpec` 调用拿到 `result` 之后（约 L762 附近）、`collectedModuleSpecs.push(result.moduleSpec)` 之前，新增预算检查：
   ```typescript
   // Bug 142：累计 input token 超限时提前终止重试
   if (result.costMetadata?.tokenUsage.input) {
     cumulativeInputTokens += result.costMetadata.tokenUsage.input;
     if (cumulativeInputTokens > RETRY_TOKEN_BUDGET) {
       moduleTokenBudgetExceeded = true;
       // 将模块标记为失败并终止重试
       const failedModule: FailedModule = {
         path: moduleName,
         error: `累计 input token ${cumulativeInputTokens} 超出预算 ${RETRY_TOKEN_BUDGET}，提前终止重试`,
         failedAt: new Date().toISOString(),
         retryCount,
         degradedToAstOnly: false,
         reason: 'retry-budget-exceeded',
       };
       failed.push(failedModule);
       checkedState.failedModules.push(failedModule);
       reporter.complete(moduleName, 'failed');
       break;
     }
   }
   ```
   **注意**：此预算检查针对的是 LLM 成功返回但后续验证失败导致重试的场景。若 `generateSpec` 在 LLM 成功时直接返回（`moduleSuccess = true`），则预算检查触发路径为：LLM 成功 → spec 验证失败 → catch → retryCount++ → 再次进入 while。应在 catch 块处理时检查 `cumulativeInputTokens`。

   **替代方案（推荐）**：预算检查放在 catch 块（L822-836），在 `retryCount++` 之后检查：
   ```typescript
   } catch (error: any) {
     retryCount++;
     // Bug 142：累计 token 超限时提前终止（不等待 retryCount >= maxRetries）
     if (cumulativeInputTokens > RETRY_TOKEN_BUDGET) {
       const failedModule: FailedModule = {
         path: moduleName,
         error: error.message ?? String(error),
         failedAt: new Date().toISOString(),
         retryCount,
         degradedToAstOnly: false,
         reason: 'retry-budget-exceeded',
       };
       failed.push(failedModule);
       checkedState.failedModules.push(failedModule);
       reporter.complete(moduleName, 'failed');
       moduleSuccess = true; // 跳出 while
     } else if (retryCount >= maxRetries) {
       // 原有逻辑
       ...
     }
   }
   ```
   实现时选其一，保持逻辑清晰。同时确保 root 模块的生成路径（L707-748）也有 token 累计逻辑（可复用同一 `cumulativeInputTokens` 变量）。

**FR 关联**: Bug 1 根因 + 修复策略方案 A

**验收**
- 无 `generatedByMode` 相关行为回归
- `npm run build` 零类型错误
- T08 单元测试通过

**预估**: 40 分钟

---

### T08：batch-orchestrator retry loop 单元测试

- [x] T08: 新增单元测试覆盖 token 预算短路场景

**影响文件**
- `tests/unit/batch-orchestrator-retry.test.ts`（新增）

**测试场景**
1. **预算触发短路**：mock LLM 持续失败，每次消耗 22k input token；第 2 次重试后 `cumulativeInputTokens = 44k > 40k` → break，`failedModule.reason === 'retry-budget-exceeded'`，`retryCount < maxRetries`（无需等到 3 次）
2. **正常重试上限**：mock LLM 每次消耗 5k token，3 次后 `retryCount >= maxRetries` → 正常失败路径，`reason` 字段为 `undefined`（原有行为不退化）
3. **预算不干扰成功路径**：mock LLM 第 1 次失败（22k token）、第 2 次成功 → 模块标记 success，无 budget 截断

**FR 关联**: Bug 1 同步更新清单

**验收**
- `npx vitest run tests/unit/batch-orchestrator-retry.test.ts` 3 个场景全部通过
- 全量 `npx vitest run` 零失败

**预估**: 35 分钟

---

## Bug 4：query 不识别 PascalCase 代码符号（末修）

### T09：graph-query 新增 tokenize 纯函数

- [x] T09: 在 `graph-query.ts` 新增 `tokenize()` 纯函数，实现 PascalCase 拆分 + 去重 + 过滤

**影响文件**
- `src/panoramic/graph/graph-query.ts`：`scoreNodes` 私有方法之前（约 L210 处）

**变更说明**
在 `GraphQueryEngine` 类定义之前（文件顶层，约 L115 附近），插入：
```typescript
/**
 * 将查询字符串拆分为小写词项集合。
 * 支持 PascalCase（PQueue → p + queue + pqueue）和
 * 连续大写（XMLParser → xml + parser + xmlparser）拆分。
 * 过滤长度 ≤ 1 的词项，去重后返回。
 */
function tokenize(q: string): string[] {
  const normalized = q
    .replace(/([a-z])([A-Z])/g, '$1 $2')           // "PQueue" → "P Queue"
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');    // "XMLParser" → "XML Parser"
  return Array.from(new Set(
    normalized.toLowerCase().split(/[\s\-_.]+/).filter((t) => t.length > 1),
  ));
}
```

**关键约束**：`tokenize` 为 module-level 纯函数（无状态），便于独立单元测试；不引入任何新依赖。

**FR 关联**: Bug 4 修复策略方案 A

**验收**
- `npm run build` 零类型错误
- T11 单元测试中 `tokenize('PQueue')` 包含 `'queue'` 和 `'p'`

**预估**: 15 分钟

---

### T10：graph-query.query() 接入 tokenize

- [x] T10: 在 `query()` 方法中将原始 terms 提取逻辑替换为 `tokenize()` 调用

**影响文件**
- `src/panoramic/graph/graph-query.ts`：`query()` 方法内（L330-334）

**变更说明**
将 L330-334 的：
```typescript
const terms = question
  .toLowerCase()
  .split(/[\s\-_./\\]+/)
  .filter((t) => t.length > 0);
```
替换为：
```typescript
const terms = tokenize(question);
```
空词项检查（`terms.length === 0`）保持不变，`tokenize()` 返回空数组时行为一致。

**FR 关联**: Bug 4 根因（Why 5）修复

**验收**
- `query('How does PQueue handle concurrency?')` 的 terms 含 `'queue'`，能命中 `'priority-queue'` 节点
- `query('')` 仍返回空结果（边界不退化）
- `npm run build` 零类型错误

**预估**: 10 分钟

---

### T11：graph-query tokenize 单元测试

- [x] T11: 新增单元测试覆盖 `tokenize()` 函数和 `query()` 的 PascalCase 场景

**影响文件**
- `tests/unit/graph-query-tokenize.test.ts`（新增）

**测试场景**
1. **PascalCase 拆分**：`tokenize('PQueue')` 包含 `'p'` 和 `'queue'`（不含 `'pqueue'`——PascalCase 拼合词通常不作为整体保留，以长度 > 1 为准）
2. **连续大写拆分**：`tokenize('XMLParser')` 包含 `'xml'` 和 `'parser'`
3. **普通词不变**：`tokenize('hello world')` 返回 `['hello', 'world']`
4. **query 集成**：构造含 `{ id: 'test', label: 'priority-queue', ... }` 节点的 `GraphQueryEngine`，`query('PQueue')` 返回该节点（通过 `'queue'` 子词命中）
5. **边界**：`tokenize('')` 返回 `[]`；`query('')` 返回空结果

**FR 关联**: Bug 4 同步更新清单

**验收**
- `npx vitest run tests/unit/graph-query-tokenize.test.ts` 5 个场景全部通过
- 全量 `npx vitest run` 零失败

**预估**: 25 分钟

---

## 执行顺序

```
T01 → T02 → T03 → T04 → T05    # Bug 3（串行，有内部依赖）
                  ↓
               T06 → T07 → T08  # Bug 1（T06 无外部依赖，T07 依赖 T06 的类型）
                  ↓
               T09 → T10 → T11  # Bug 4（T10 依赖 T09）
```

**并行可能性**：T06/T09 可与 T05 并行（无依赖）；Bug 4 全程独立，可在 Bug 3 完成后立即启动。

## 完成标准

全部 11 个任务完成后，运行：

```bash
npm run build && npx vitest run
```

期望：编译零错误，测试零失败。
