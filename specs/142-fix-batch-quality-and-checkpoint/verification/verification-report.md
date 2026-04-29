# 验证报告 — Feature 142：v4.0.2 Batch 质量 + 跨模式断点修复

**生成时间**: 2026-04-27  
**验证模式**: fix（v4.0.2 hotfix）  
**验证阶段**: 最终验证 + DoD 对齐

---

## Layer 1: Spec-Code 对齐（任务完成状态）

spec.md 不存在，以 tasks.md 为准进行 FR 覆盖率统计。

| 任务 | 描述 | checkbox | 文件存在性 |
|------|------|----------|----------|
| T01 | SpecFrontmatter 新增 generatedByMode 字段 | ✅ | ✅ |
| T02 | frontmatter.ts 写入 generatedByMode | ✅ | ✅ |
| T03 | delta-regenerator mode 检查 + StoredModuleSpecSummary 同步 | ✅ | ✅ |
| T04 | batch-orchestrator 传入 effectiveMode | ✅ | ✅ |
| T05 | Bug 3 集成测试（delta-regenerator-mode.test.ts） | ✅ | ✅ |
| T06 | FailedModule 新增 reason 字段 | ✅ | ✅ |
| T07 | batch-orchestrator retry loop token 预算短路 | ✅ | ✅ |
| T08 | retry loop 单元测试（batch-orchestrator-retry.test.ts） | ✅ | ✅ |
| T09 | graph-query 新增 tokenize 纯函数 | ✅ | ✅ |
| T10 | graph-query.query() 接入 tokenize | ✅ | ✅ |
| T11 | graph-query tokenize 单元测试（graph-query-tokenize.test.ts） | ✅ | ✅ |

**覆盖率: 100%（11/11 任务已完成）**

---

## Layer 1.5: 验证铁律合规

- **状态**: COMPLIANT
- 前置报告（spec-review / quality-review）注明补丁修复后 build 零错误、2281 tests passed
- 本次验证独立重新执行了全量 build 和测试，结果可信
- 缺失验证类型: 无
- 检测到的推测性表述: 无

---

## Layer 1.75: 深度检查

### a. 调用链完整性

**Bug 3（mode-changed cache miss）调用链**：

```
batch-orchestrator.ts
  → DeltaRegenerator.plan({ effectiveMode })      [T04 已传入]
    → detectDirectChanges(snapshots, storedSpecs, effectiveMode)  [T03 参数透传]
      → stored.generatedByMode !== effectiveMode → 'mode-changed'  [T03 逻辑]
  → generateSpec → frontmatter.ts → generatedByMode 写入        [T02 已实现]
```

调用链完整，无断点。effectiveMode 从 orchestrator 经 DeltaRegenerator 到 frontmatter 全链路贯穿。

**Bug 1（retry budget）调用链**：

```
batch-orchestrator.ts while(retryCount < maxRetries && !moduleSuccess)
  catch(error) → retryCount++
    → cumulativeInputTokens += ESTIMATED_FAILED_CALL_INPUT (15000)
    → if (cumulativeInputTokens > RETRY_TOKEN_BUDGET(40000)) → break + reason='retry-budget-exceeded'
  → writeSummaryLog(..., failedModules)  → 失败详情节含 reason 列
```

调用链完整。当 generateSpec 无法返回真实 token 数据时，`ESTIMATED_FAILED_CALL_INPUT` 作为安全兜底累计。

**Bug 4（PascalCase tokenize）调用链**：

```
graph-query.ts query()
  → tokenize(question)  [T10 已替换原 split 逻辑]
    → PascalCase regex split → lowercase → filter(>1) → dedupe
  → terms 含 'queue' → scoreNodes 命中 'priority-queue'
```

调用链完整，`tokenize` 已 export 供测试直接调用。

### b. 数据持久化验证

本次修复不涉及新的数据库写入路径，batch-summary 文件通过 `fs.writeFileSync` 写入，无异步竞态风险。

### c. 配置贯穿验证

`RETRY_TOKEN_BUDGET` 支持通过环境变量 `SPECTRA_RETRY_TOKEN_BUDGET` 覆盖，从 env → 顶层常量 → catch 块检查，贯穿完整。

---

## Layer 1.8: 残余扫描

### TODO/FIXME 扫描

| 文件 | 行 | 内容 | 是否新引入 |
|------|-----|------|-----------|
| `src/batch/batch-orchestrator.ts` | L90 | `TODO v4.1：改为从自定义 Error 子类提取精确的 partialTokenUsage` | 否（预存在） |

**结论**: RESIDUAL_CLEAN — 无本次新引入的 TODO/FIXME。

### console.log/debug 扫描

`src/batch/batch-orchestrator.ts` 中存在多处 `console.log`（L433/435/454/455/509/564），经 `git diff master` 确认均为预存在代码，本次修复未新增 debug 输出。

`src/panoramic/graph/graph-query.ts`、`src/batch/delta-regenerator.ts` 无 console.log/debug。

---

## Layer 1.9: 文档一致性

本次为 hotfix 级修复（3 个 bug），无新模块增删或公共接口重命名。fix-report.md 作为变更说明文档与实现一致。

**注意**: 运行时上下文提到 `verification/spec-review-report.md` 和 `verification/quality-review-report.md`，但这两个文件不存在于磁盘（verification/ 目录为空）。这两份报告仅作为编排器上下文摘要传递，未持久化。不影响本次最终验证结论，但属于流程产物缺失——标记 **DOC_DRIFT(INFO)**（非阻断）。

---

## Layer 2: 原生工具链验证

**注**: macOS 环境 `timeout` 和 `gtimeout` 均不可用（coreutils 未安装），超时保护已跳过。

### 构建

```
> spectra-cli@4.0.1 prebuild
> tsx scripts/inline-d3.ts
[inline-d3] d3-force 3.0.0 内容无变化，跳过写入

> spectra-cli@4.0.1 build
> tsc
```

**退出码: 0 — PASS**

### 测试

```
Test Files  232 passed | 1 skipped (233)
     Tests  2281 passed | 1 skipped (2282)
  Duration  14.20s
```

**退出码: 0 — PASS（2281/2281 通过，1 skipped 为预期）**

### Release Check

```
> spectra-cli@4.0.1 release:check
Release contract valid (contracts/release-contract.yaml)
```

**退出码: 0 — PASS**

### Repo Check

```
> spectra-cli@4.0.1 repo:check
[repo-check] status=pass
```

全部 41 项检查通过（agent-docs、marketplace、spec-driver-wrappers、spectra-skills、runtime-boundaries、release-contract、orchestration-overrides）。

**退出码: 0 — PASS**

---

## DoD 对齐核查

### Bug 1 DoD：retry token 预算短路

| 核查项 | 结论 |
|--------|------|
| `tests/integration/batch-retry-budget-behavior.test.ts` 存在 | ✅ |
| 使用 `runBatch`（真实端到端调用） | ✅（vi.mock generateSpec，end-to-end runBatch） |
| LLM 持续失败 → reason=retry-budget-exceeded | ✅（2/2 集成测试通过） |
| retryCount < maxRetries（预算触发而非重试次数上限） | ✅（test 断言 retryCount < 5） |
| batch-summary markdown 包含 reason 字段 | ✅（writeSummaryLog 输出"失败详情"节含 reason 列） |

**Bug 1 DoD: PASS**

**注**: fix-report DoD 原文要求 batch-summary 含 reason 字段，实际通过 `writeSummaryLog` 的"失败详情"表格实现，字段名 `m.reason` 直接输出到 markdown，符合原意。

### Bug 3 DoD：reading→full 跨模式 cache miss

| 核查项 | 结论 |
|--------|------|
| `tests/unit/delta-regenerator-mode.test.ts` 存在 | ✅ |
| reading→full cache miss（reason: mode-changed） | ✅（8 个测试全部通过） |
| full→reading cache miss | ✅（场景已覆盖） |
| 同 mode 复用（hash 未变 → []） | ✅（2 个同模式场景通过） |
| 旧 spec（无 generatedByMode）安全降级 → mode-changed | ✅（2 个旧 spec 场景通过） |
| 同 mode hash 变化 → skeleton-changed（原有行为不退化） | ✅ |

**Bug 3 DoD: PASS（覆盖 tasks.md T05 所列 4 个场景，测试文件实际有 8 个 it 覆盖更多边界）**

### Bug 4 DoD：PascalCase 查询识别

| 核查项 | 结论 |
|--------|------|
| `tests/unit/graph-query-tokenize.test.ts` 存在 | ✅ |
| PascalCase（PQueue）拆分 | ✅（tokenize('PQueue') 含 'queue'，不含 'p'） |
| kebab-case（priority-queue）拆分 | ✅（priority + queue） |
| snake_case 拆分 | ✅（snake + case + name） |
| 中文/普通词不受影响 | ✅（hello world → ['hello','world'] 不变） |
| query('PQueue') 命中 priority-queue 节点 | ✅（集成测试通过） |
| 边界：空字符串 | ✅（tokenize('') → []，query('') → 空结果） |

**Bug 4 DoD: PASS（16 个 tokenize 单元测试全通过）**

### Bug 2 DoD

已在 fix-report 中确认为误报，不纳入验收。**跳过**。

---

## 总体摘要

| 检查项 | 结果 |
|--------|------|
| npm run build | ✅ PASS（零类型错误） |
| npx vitest run | ✅ PASS（2281/2281，零失败） |
| npm run release:check | ✅ PASS |
| npm run repo:check | ✅ PASS（41/41） |
| Bug 1 DoD | ✅ PASS |
| Bug 3 DoD | ✅ PASS |
| Bug 4 DoD | ✅ PASS |
| 残余扫描 | ✅ CLEAN（无新增 TODO/debug） |
| 文档一致性 | INFO（prior report 未持久化，非阻断） |

**整体状态: READY FOR MERGE**

---

## 合入建议

**建议直接合入 master。**

所有验收标准通过：构建零错误、测试零失败、release/repo 检查全 pass、3 个 bug 的 DoD 均已验证。无残留 TODO、无 debug 输出新增、无文档漂移阻断项。

唯一 INFO 级别问题：前两阶段的 spec-review-report.md / quality-review-report.md 未落盘，这是流程产物问题而非代码质量问题，不影响合入决策。
