# Spec 合规审查报告

> 注：本报告由 spec-review 子代理产出（子代理返回内容由主编排器原样落盘）。

**Feature 182 — 增量缓存正确性修复**
**日期**: 2026-06-13
**审查基准**: fix-report.md（诊断 + 3 轮 Codex 审查）+ plan.md v2 + v2.1 + tasks.md v2

---

## 逐条修复面状态

| 修复面 | 描述 | 状态 | 证据/说明 |
|--------|------|------|----------|
| F1 — skeletonHash 公式 | 新建 `src/core/skeleton-hash.ts`，导出 `combineSkeletonHashes`（code-unit 排序纯函数）+ `computeModuleSkeletonHash`（wrapper） | 已实现 | 文件存在；line 33-62 实现 code-unit 比较器（`<`/`>` charCode，无 localeCompare）；双层导出确认；单文件特例（直返 hash[0]）在 line 51-53 |
| F2 — files 注入参数 | `GenerateSpecOptions.files?` 可选字段；batch 调用注入 `group.files`；写侧复用已有 skeletons 调 `combineSkeletonHashes` 不二次 analyzeFiles | 已实现 | single-spec-orchestrator.ts line 94/103/236-239 含可选 `files` 字段与注入逻辑；line 703-710 写侧调 `combineSkeletonHashes`（不调 wrapper）；batch-orchestrator.ts line 969 注入 `group.files` |
| F3a — languageSplit 标记 | `ModuleGroup.languageSplit?: boolean`；多语言拆分分支设 true | 已实现 | module-grouper.ts line 33（类型）/ line 148（赋值 true） |
| F3b — buildSpecCacheKey | regen-plan.ts 新增纯 helper，languageSplit 组返回 `${sourceTarget}::${language}` | 已实现 | regen-plan.ts line 125-140 确认 |
| F3c — key 三处应用 + sourceTargetKey 持久化 | delta-regenerator 改用 `buildSpecCacheKey`；batch-orchestrator `moduleCacheKey`；装饰点持久化 | 已实现 | delta-regenerator.ts line 251/268；batch-orchestrator.ts line 795/970/973（languageSplit 时传 `sourceTargetKey: moduleCacheKey`）；storedSpecByTarget Map 键 = `stored.sourceTargetKey ?? stored.sourceTarget`（line 520）|
| F3d — doc-graph-builder 解析 | `StoredModuleSpecSummary.sourceTargetKey?` 字段 + `scanStoredModuleSpecs` 解析 | 已实现 | doc-graph-builder.ts line 47-50（类型）/ line 183/456-458/571（解析）|
| F4 — checkpoint replace 语义 | `upsertCompletedModule` / `recordFailedModule` 同步 helper；completed/failed 互斥去重 | 已实现 | batch-orchestrator.ts line 272-282（双 helper，completed/failed 互相剔除）；line 950/1008/1068/1084/1137（全部调用点替换）|
| F5 — forceRegenerate 时序修复 | `let` 声明；OR 注入点在 checkpoint 加载后；info 日志 | 已实现 | batch-orchestrator.ts line 548-549（`let` 声明）；line 699-711（isResume 块，位于 line 678 `isResume = state !== null` 之后）；line 710 info 日志 |
| 测试清理 — computeHashFor 删除 | delta-regenerator-mode.test.ts 删除私有复刻，改 import `src/core/skeleton-hash.js` | 已实现 | 文件顶部 line 25 import 确认；Grep 确认零 `computeHashFor` 定义；8 个使用点均改为 `computeModuleSkeletonHash` |
| E2E-A — 混合大小写第二轮零重生成 | 用户故事命名；仅 mock LLM；从落盘 frontmatter 读 hash 对账；第二轮 LLM 调用 = 0 | 已实现 | batch-incremental-cache.test.ts line 96-135；`vi.mock llm-client.js`（line 26-29）保留真实导出只替换 `callLLM`；`readFrontmatterField` 从落盘读取（line 61-71）|
| E2E-B — 混语言第二轮零重生成 | 首轮产出 2 份 spec；files 注入生效；第二轮 LLM = 0 | 已实现 | batch-incremental-cache.test.ts line 137-195；断言 tsContent 不含 worker.py，pyContent 不含 service.ts；sourceTargetKey/纯路径断言（line 174-177）|
| E2E-C — 目录级真实碰撞（v2.1 补充）| src/utils/ ts 组 2 文件 + py 组 1 文件；sourceTarget 同为 src/utils；两 spec 共存；第二轮零 LLM | 已实现 | batch-incremental-cache.test.ts line 197-265；`sourceTarget=src/utils`（无后缀）/ `sourceTargetKey=src/utils::ts-js` 等断言（line 234-237）|
| v2.1 修复1 — outputFileName 碰撞 | languageSplit 组传 `${moduleName}.spec.md`；非拆分组命名不变 | 已实现 | batch-orchestrator.ts line 969；single-spec-orchestrator.ts line 766-768（使用 options.outputFileName，否则 basename 降级）|
| v2.1 修复2 — sourceTargetKey 首写入盘 | `GenerateSpecOptions.sourceTargetKey`；generateFrontmatter 首写即含该字段；删除 post-mutation 块 | 已实现 | single-spec-orchestrator.ts line 107-110 / line 720-723；batch-orchestrator.ts 确认 post-mutation 已删除 |

---

## 回归护栏合规检查

| 检查项 | 状态 | 证据 |
|--------|------|------|
| E2E 不 mock generateSpec | 合规 | 仅 `vi.mock llm-client.js`，无 `vi.mock single-spec-orchestrator` / `generateSpec` |
| 只 mock LLM 边界 | 合规 | line 26-29：`...actual, callLLM: llmMocks.callLLM`，保留真实导出 |
| 期望值读真实落盘 frontmatter | 合规 | `readFrontmatterField(specPath, 'skeletonHash')` 从落盘文件提取 |
| 用户故事命名 | 合规 | 三个 it() 描述均以"用户故事:"开头（line 96/137/197）|
| computeHashFor 私有复刻已删除 | 合规 | Grep 确认零定义，改 import 共享函数 |

## 不变量检查

| 不变量 | 状态 | 证据 |
|--------|------|------|
| frontmatter sourceTarget 纯路径（无 `::` 后缀泄漏）| 合规 | E2E-B line 176-177 断言无后缀；cross-reference-index.ts:207 / spec-store.ts:127 消费点未修改 |
| resolveSourceTarget 签名未变 | 合规 | regen-plan.ts 仅新增 `buildSpecCacheKey` |
| panoramic / spec-store 核心匹配逻辑未被改动 | 合规 | cross-reference-index.ts / component-view-builder.ts / spec-store.ts 均不在 diff 范围 |
| doc-graph-builder 只新增 sourceTargetKey 解析 | 合规 | 仅 line 47-50/183/456-458/571 追加可选字段 |

## 越界检查（计划外改动）

| 检查项 | 状态 | 说明 |
|--------|------|------|
| sourceTargetToPath helper（v1 遗留）| 合规 | 全仓 grep 确认不存在，v2 明确废弃不做 |
| 非 fix 范围重构 | 合规 | 未发现计划外修改；batch-orchestrator 仅外科手术式改动 |
| v1 遗留描述矛盾 | 合规 | fix-report.md 问题 2 已有"⚠️ Phase 2 设计修订"注记，无歧义 |

## 制品一致性检查

| 制品对 | 状态 |
|--------|------|
| fix-report.md ↔ plan.md v2 | 一致 |
| plan.md v2 ↔ tasks.md v2 | 一致 |
| plan.md v2.1 ↔ tasks.md（三项补充）| 一致 |
| release-note.md ↔ plan.md 草案 | 一致 |

## 总体合规率

**14/14 修复点全部落实（100%）**

## 问题分级汇总

- **CRITICAL**: 0 个
- **WARNING**: 0 个
- **INFO**: 0 个（场景 C 为 v2.1 规范内，不计入）

## 总判定

**PASS** — 所有 5 个修复面（含 v2.1 三项追加修复）均有完整实现与证据；E2E 铁律全部合规；frontmatter sourceTarget 纯路径不变量成立；制品间无矛盾表述。
