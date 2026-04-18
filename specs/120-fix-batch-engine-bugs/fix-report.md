# Fix Report: Batch 引擎 5 个问题修复（Issue #120）

## 概述

本次修复针对 Batch 引擎中诊断出的 5 个问题，覆盖高危（H）和中低优先级（M/L）缺陷，分布于 `src/batch/batch-orchestrator.ts`、`src/batch/module-grouper.ts`、`src/models/module-spec.ts` 三个文件。

---

## H2（HIGH）— Promise.race([]) 死锁

**文件**：`src/batch/batch-orchestrator.ts`

**根因**：并发调度器的 `while (activeCount >= concurrency)` 循环中，当所有 task 恰好在进入循环前全部完成时，`pending` 数组可能为空，此时 `await Promise.race([])` 永远不 resolve，程序死锁。

**修复**：在 `await Promise.race(pending)` 前添加守卫：
```ts
if (pending.length === 0) break;
```

**验证**：新增 T046（H2 并发不死锁）测试，1578 个测试全部通过。

---

## H3（HIGH）— 小模块优化硬编码模型 ID

**文件**：`src/batch/batch-orchestrator.ts`

**根因**：`modelOverride: isSmallModule ? 'claude-sonnet-4-5-20250929' : undefined` 硬编码了特定版本号。在 Codex CLI 环境下，该 ID 不被识别，导致直接失败；同时绕过了 `src/core/model-selection.ts` 集中配置的运行时适配逻辑。

**修复**：
1. 导入 `resolveReverseSpecModel` from `../core/model-selection.js`
2. 在 `runBatch` 入口处预解析 Sonnet 模型 ID：`const sonnetModelId = resolveReverseSpecModel({ cwd: resolvedRoot, agentId: 'specify-sonnet' }).model`
3. 将 `'claude-sonnet-4-5-20250929'` 替换为 `sonnetModelId`

运行时会自动根据当前 runtime（claude/codex）解析出正确的模型 ID，Codex 环境下映射为对应的 OpenAI 模型。

---

## H4（HIGH）— 文件级模块增量键错位

**文件**：`src/batch/batch-orchestrator.ts`

**根因**：Python flat-package 文件级降级后，`moduleSourceTarget` 仍取 `group.dirPath`（目录级路径），而 `targetPath`（传给 `generateSpec` 的实际路径）已切换为文件路径。导致：
- `regenerateTargets.has(moduleSourceTarget)` 增量判断错位
- `storedSpecByTarget.get(moduleSourceTarget)?.version` 查询旧版本错位

**修复**：将 `hasDirPathConflict` 判断提升到 `processOneModule` 函数顶部（原来在 else 分支内），并根据是否冲突动态计算 `moduleSourceTarget`：
```ts
const hasDirPathConflict = !isRoot && group.files.length === 1 && conflictingDirPaths.has(group.dirPath);
const moduleSourceTarget = hasDirPathConflict
  ? normalizeProjectPath(group.files[0]!)
  : normalizeProjectPath(group.dirPath);
```

这确保了 `moduleSourceTarget`、`targetPath`、`storedSpecByTarget` 查询键三者完全一致。

---

## M1（MEDIUM）— module-grouper stem 冲突

**文件**：`src/batch/module-grouper.ts`

**根因**：扁平包文件级降级时，`name = path.basename(file).replace(/\.[^.]+$/, '')` 只取 stem，同名文件（如 `__init__.py` 和 `__init__.pyi`）产生 name 冲突，后者覆盖前者，模块组丢失。

**修复**：降级前预统计每个 stem 的出现次数。stem 有冲突时，改用包含扩展名的完整相对路径（路径分隔符替换为 `__`，点号替换为 `_`）作为 name，确保全局唯一。无冲突时仍使用 stem，保持向后兼容：
```ts
const name = (stemCount.get(stem) ?? 0) > 1
  ? file.replace(/[/\\]/g, '__').replace(/\./g, '_')
  : stem;
```

**示例**：`graphify/__init__.py` → `graphify____init___py`，`graphify/__init__.pyi` → `graphify____init___pyi`，`graphify/pipeline.py` → `pipeline`（无冲突，保持原 stem）。

**新增测试**：
- T046：同名文件降级后 name 不冲突
- T047：无冲突文件仍使用 stem 命名

---

## L1（LOW）— `state.currentModule` 僵尸字段

**文件**：`src/models/module-spec.ts`、`src/batch/batch-orchestrator.ts`、测试文件

**根因**：并发改造后 `state.currentModule` 不再被赋值（顺序处理时有意义，并发时无法维护单个"当前模块"的语义），但 `BatchStateSchema` 接口中仍保留该字段，产生误导。

**修复**：
1. 从 `BatchStateSchema` 中删除 `currentModule: z.string().nullable().optional()` 字段
2. 从 `batch-orchestrator.ts` 状态初始化中删除 `currentModule: null` 赋值
3. 从 `tests/unit/batch-orchestrator.test.ts` 和 `tests/integration/multilang-batch.test.ts` 中删除相应字段

**向后兼容性**：Zod `parse` 默认 strip 多余字段，含 `currentModule` 的旧检查点文件仍能被正确加载（T072 测试已验证此行为）。

---

## 验证结果

| 验证步骤 | 命令 | 结果 |
|---------|------|------|
| TypeScript 构建 | `npm run build` | 退出码 0，零错误 |
| 全量单元测试 | `npx vitest run` | 160 文件，1578 测试，0 失败 |

## 变更文件列表

| 文件 | 变更类型 |
|-----|---------|
| `src/batch/batch-orchestrator.ts` | 修复 H2、H3、H4、L1 |
| `src/batch/module-grouper.ts` | 修复 M1 |
| `src/models/module-spec.ts` | 删除 L1 僵尸字段 |
| `tests/unit/batch-orchestrator.test.ts` | 新增 H2 测试，清理 L1 僵尸字段引用 |
| `tests/unit/module-grouper.test.ts` | 新增 M1 测试（T046、T047） |
| `tests/integration/multilang-batch.test.ts` | 清理 L1 僵尸字段引用 |
