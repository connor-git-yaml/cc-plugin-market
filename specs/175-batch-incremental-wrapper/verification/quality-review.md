# F175 代码质量审查报告

**审查范围**: `git diff d198404~1 HEAD -- src/ scripts/` 全部生产改动（5 commits）  
**审查时间**: 2026-06-07  
**审查文件**:
- `src/batch/regen-plan.ts`（新增，110 LOC）
- `src/batch/batch-orchestrator.ts`（+92 LOC，2251→2343）
- `src/batch/delta-regenerator.ts`（+28 LOC）
- `src/panoramic/graph/graph-builder.ts`（+127 LOC，493→620）
- `src/panoramic/graph/index.ts`（+2 LOC）
- `src/panoramic/builders/doc-graph-builder.ts`（+12 LOC）
- `src/cli/utils/parse-args.ts`（+10 LOC）
- `src/cli/commands/batch.ts`（+15 LOC）
- `src/mcp/server.ts`（+20 LOC）
- `scripts/baseline-collect.mjs`（+4 LOC）

---

## 六维度评估

| 维度 | 评级 | 关键发现 |
|------|------|---------|
| 架构合理性 | GOOD | resolveRegenPlan/resolveSourceTarget 提取清晰；三入口接入方式一致；normalizeGraphForWrite 调用位置正确（追加 semantic edges 之后）；batch-orchestrator.ts 超长函数是历史债，plan 明确豁免 |
| 设计模式合理性 | GOOD | resolveRegenPlan 单职责纯函数设计良好；force/full 合并为语义唯一真值符合设计；幂等双重解析（CLI/MCP + runBatch 兜底）虽有冗余但安全无副作用 |
| 安全性 | GOOD | isInManagedOutputDir 用 path.relative 防目录穿越（非 startsWith），符合 OWASP 路径穿越防护；三重 ownership 校验（generatedByMode + 目录归属 + .spec.md 后缀）；liveSourceFiles 前缀匹配正确用 `sourceTarget/` 带尾斜杠防误匹配 |
| 性能 | GOOD | hasLiveSource O(n) 线性扫描在孤儿删除场景可接受；stableStringify 深拷贝对超大 docGraph 有轻微开销但属一次性调用 |
| 可读性 | GOOD | 关键流程注释详尽（FR/EC/OQ 追踪到位）；主路径逻辑清晰；排序 key 用 `\x1f` 分隔符（非可见字符但有注释） |
| 可维护性 | NEEDS_IMPROVEMENT | 两处 normalizeProjectPath 定义（regen-plan.ts 和 batch-orchestrator.ts 各一份）；rmSync 无 try/catch 包裹；deltaRegenerator 对象被实例化两次（line 504 + line 1172）；stripVolatileFields/stableStringify 已 export 但未从 graph/index.ts 重导出 |

---

## 问题清单

| 严重程度 | 维度 | 位置 | 描述 | 修复建议 |
|---------|------|------|------|---------|
| WARNING | 可维护性 | `src/batch/batch-orchestrator.ts:1128` | `fs.rmSync(absPath, { force: true })` 位于 try/catch 块外（外层 try 从 line 1148 开始）。若因权限或 OS 错误抛出，整个 runBatch 会以无上下文的原始错误失败，且已执行的部分孤儿删除不可回滚（非原子性），storedSpecsForStore 的内存视图与磁盘实际状态不一致 | 将孤儿删除循环包进 try/catch，捕获 rmSync 错误后 logger.warn 并跳过（保守策略：宁可不删，不崩溃整个 batch） |
| WARNING | 可维护性 | `src/batch/batch-orchestrator.ts:504` 与 `src/batch/batch-orchestrator.ts:1172` | `new DeltaRegenerator()` 被实例化两次：第一次在 incremental 决策时（line 504），第二次在写 delta-report.md 时（line 1172）。第一个实例的生命周期到 deltaReport 计算完毕即结束，第二个仅为调用无状态的 render 方法而创建 | 如果 DeltaRegenerator.render 是无状态的，将其提取为独立纯函数或静态方法。若需保留实例，在 incremental 分支里把第一个实例提升到外层 closure，供 render 复用 |
| WARNING | 可维护性 | `src/batch/regen-plan.ts:85` 与 `src/batch/batch-orchestrator.ts:434` | `normalizeProjectPath` 有两份实现——一份在 regen-plan.ts 的私有函数，一份在 batch-orchestrator.ts 的内联 closure（`const normalizeProjectPath = ...`）。两者逻辑完全相同（`split(path.sep).join('/')`），但独立维护，将来若需统一变更（如 Windows 路径行为调整）需改两处 | 将 normalizeProjectPath 从 regen-plan.ts 作为具名函数导出，在 batch-orchestrator.ts 中引入并替换 line 434 的 closure |
| INFO | 可维护性 | `src/panoramic/graph/graph-builder.ts:581,604` 与 `src/panoramic/graph/index.ts` | `stripVolatileFields` 和 `stableStringify` 已在 graph-builder.ts 标注为 `export`，但未在 graph/index.ts 中重导出。测试文件（graph-builder-normalize.test.ts:15）在注释中明确说明这是已知决策（"未从 index 导出，直接从 graph-builder 导入"）。若将来外部消费方需要调用这两个函数，需同步更新 index.ts | 若确认这两个函数只供测试和 graph-builder 内部使用，可将它们的 export 改为不导出（保留内部 helper 语义）；或者保留 export 并在 index.ts 显式重导出，明确它们是公共 API |
| INFO | 可维护性 | `src/cli/commands/batch.ts:62-81` | `resolveRegenPlan` 在 CLI 入口（batch.ts:63）和 runBatch 内部（batch-orchestrator.ts:413）都被调用，形成幂等双重解析。第二次调用是为了兜底"直接 API 调用者"场景，逻辑上正确但轻微冗余。注释对此有解释（"幂等"）| 可接受现状；若需简化，可在 runBatch 开头检测是否已解析（检查 options.full !== undefined 或 options.incremental !== undefined）来跳过兜底，但代价是增加判断复杂度，非必要 |
| INFO | 可读性 | `src/panoramic/graph/graph-builder.ts:555` | links 排序的 key 拼接使用 `\x1f`（ASCII Unit Separator）作为分隔符，防止 source/target/relation 字段值中的 `\|` 干扰排序。这是正确的技术决策，但 `\x1f` 是不可见字符，在 code review 时不直观 | 在该行添加一行注释说明选用 `\x1f`（ASCII 31 / Unit Separator）的原因：避免与字段内容中的常见分隔符冲突 |

---

## 累积劣化检测

| 文件 | 改动前 LOC | 改动后 LOC | 变化 | 状态 |
|------|-----------|-----------|------|------|
| `src/batch/batch-orchestrator.ts` | 2251 | 2343 | +92 | 历史债（plan 明确豁免：runBatch 超长函数拆分风险高，此 Feature 清理范围仅限 resolveRegenPlan/normalizeGraphForWrite 提取） |
| `src/panoramic/graph/graph-builder.ts` | 493 | 620 | +127 | OK（620 < 800 CRITICAL 阈值）|
| `src/batch/regen-plan.ts` | 0 | 110 | +110（新增）| OK（新文件，精简）|

---

## 跨模块一致性

- import 路径：各模块均使用 `.js` 扩展名（Node ESM 规范），一致。
- `normalizeProjectPath` 的两份独立实现逻辑相同，暂无一致性风险，但长期维护需关注（见 WARNING 条目）。
- `resolveSourceTarget` 已在 delta-regenerator.ts 和 batch-orchestrator.ts 共享，口径统一（FR-019 达标）。
- `isBatchGenerated` 导出自 doc-graph-builder.ts，在 batch-orchestrator.ts 正确引入使用，无孤儿导出。

---

## 安全性深查

**孤儿删除路径穿越防护**（`isInManagedOutputDir`）：

```typescript
function isInManagedOutputDir(absPath: string, modulesDir: string): boolean {
  const rel = path.relative(modulesDir, path.resolve(absPath));
  return !rel.startsWith('..') && !path.isAbsolute(rel) && absPath.endsWith('.spec.md');
}
```

- `path.resolve(absPath)` 将 `specs/modules/../../etc/passwd` 类路径解析为绝对路径（如 `/etc/passwd`）。
- `path.relative(modulesDir, '/etc/passwd')` 结果为 `../../etc/passwd`，`startsWith('..')` 为 true → 拒绝。
- `.spec.md` 后缀校验进一步限制删除目标类型。
- 三重 ownership 条件（generatedByMode / 目录归属 / 后缀）缺一不删。
- **评定**：路径穿越防护充分，符合 OWASP 要求。

**hasLiveSource 前缀匹配**：

```typescript
const prefix = `${sourceTarget}/`;  // 带尾斜杠，防止 "src/foo" 误匹配 "src/foobar.ts"
for (const f of liveSourceFiles) {
  if (f === sourceTarget || f.startsWith(prefix)) return true;
}
```

- `f === sourceTarget` 处理单文件 sourceTarget 场景。
- `f.startsWith(prefix)` 带尾斜杠，`"src/foobar.ts".startsWith("src/foo/")` = false，防误匹配。
- **评定**：逻辑正确。

---

## 总体质量评级

**GOOD**

评级依据：
- 零 CRITICAL 问题
- 3 个 WARNING（均为可维护性，无安全/功能风险）
- 3 个 INFO（命名/导出组织建议）
- 核心逻辑（resolveRegenPlan 优先级链、checkpoint 清空时机、孤儿删除三重条件、normalizeGraphForWrite 调用位置）正确实现了 plan 设计意图
- 8 轮 Codex 对抗审查已修复 3 个 CRITICAL，当前代码状态良好

---

## 问题分级汇总

- **CRITICAL**: 0 个
- **WARNING**: 3 个（全部为可维护性问题，无功能/安全阻塞）
- **INFO**: 3 个

**是否有阻塞项**: 否。所有 WARNING 均为维护性改进建议，不影响当前功能正确性和安全性。可在后续 Feature 中作为技术债清理。
