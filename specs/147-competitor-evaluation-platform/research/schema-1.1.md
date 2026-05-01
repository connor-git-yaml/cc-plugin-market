# Baseline Fixture Schema 1.1（Phase 0 T0.3 设计文档）

> spec §2.1.D 的完整 standalone 版本 — 含 1.0 → 1.1 字段 diff、anonymize 协议、向后兼容规则。

---

## 1. 升级动机

| 1.0（F143）| 1.1（F147）|
|-----------|-----------|
| perf-only baseline | + 质量维度 + 多 tool 支持 + 任务执行维度 + 竞品冷冻元数据 |
| 单 tool（spectra）| 多 tool（spectra / graphify / aider-repomap / cody / superpowers / gstack / spec-driver / control）|
| 单 mode（full / reading / code-only）| 同 + 任务执行模式 |

**Minor bump 而非 major**：所有 1.0 字段不变 + 新增字段；老 fixture lazy upgrade（首次跑 eval-competitor 时强制重生为 1.1）。

---

## 2. 完整字段清单（1.1）

```jsonc
{
  "schemaVersion": "1.1",
  "meta": {
    // ===== 1.0 字段（不变）=====
    "tool": "spectra",                              // 1.0 已有，1.1 enum 扩展
    "spectraVersion": "4.1.1",
    "collectorVersion": "0.3.0",                    // 1.1 collector 升 minor
    "targetProject": "karpathy/micrograd",
    "targetCommit": "c911406...",
    "targetFileCountsByType": { "ts": 0, "tsx": 0, "py": 5, "md": 1, "other": 7 },
    "targetLocEstimate": 248,
    "spectraModuleCount": 4,
    "mode": "full",
    "model": "claude-sonnet-4-6",
    "runTimestampUtc": "2026-04-30T10:00:00Z",
    "runHostOs": "darwin",
    "command": "/usr/bin/time",
    "args": [...],
    "envAllowlist": {...},
    "outputDir": "...",
    "stdoutLogPath": "...",
    "stderrLogPath": "...",

    // ===== 1.1 新增字段 =====
    "pinnedAt": "2026-04-30T10:00:00Z",             // 竞品 fixture pin 时间戳；自己跑等于 runTimestampUtc
    "upstreamVersion": "v1.15",                     // 竞品的 git tag / commit；自己跑等于 spectraVersion
    "staleAfterDate": "2026-10-30",                 // 默认 pinnedAt + 6 月；超期 eval:refresh-self warning（不自动重跑竞品）
    "frozenFixture": true,                           // 竞品冷冻 fixture 标记 true；自己跑标 false
    "partialRun": {                                  // Sprint 3 Phase C.2: 标记 batch 部分失败但有效产物已写盘的场景
      "reason": "...",                               // 失败原因 + 为何仍有效（如 spectra 误判 spurious 模块路径但 majority 模块成功）
      "failedModules": ["fs", "root"],
      "successModules": 10
    }
  },

  // ===== 1.0 字段（不变）=====
  "dryRun": { "estimatedTokens": ..., "actualTokens": ..., "biasRatio": ... },
  "perf": {
    "totalWallMs": ...,
    "llmCallCount": ...,
    "llmCallDurationsMs": { "p50": ..., "p95": ..., "min": ..., "max": ..., "samplesCount": ... },
    "tokensInput": ..., "tokensOutput": ..., "tokensCacheRead": null,
    "estimatedCostUsd": ...,
    "memoryPeakKb": ...
  },
  "output": {
    "graphNodeCount": ..., "graphEdgeCount": ..., "graphHyperedgeCount": ...,
    "graphSizeBytes": ...,
    "specModuleCount": ..., "specSuccessCount": ..., "specSkippedCount": ..., "specFailedCount": ...
  },
  "phases": { ... },                                // 1.0 字段，schemaVersion 1.1 仍 placeholder

  // ===== 1.1 新增 quality 段（替代 1.0 的 null）=====
  "quality": {
    "specStructure": {                              // 静态分析（不调 LLM）
      "modulesWithIntent": 17,                      // grep "## Intent" 出现的 spec.md 数
      "modulesWithInputsOutputs": 15,
      "averageSpecLines": 245,
      "shorterThan100Lines": 2,                     // 极短 outlier
      "longerThan1000Lines": 1,                     // 极长 outlier
      "outlierFiles": ["models.spec.md"]
    },
    "graphSanity": {                                // 静态分析
      "isolatedNodes": 0,                           // 没边的孤立节点
      "selfLoops": 0,
      "edgesWithMissingTarget": 0,                  // 边指向不存在节点（数据 bug）
      "averageDegree": 7.7,
      "maxDegree": 32,
      "edgesWithoutType": 0                         // 边缺 type 字段
    },
    "crossLinks": {                                 // 静态分析（解析 spec markdown）
      "totalLinks": 234,
      "brokenLinks": 0,                             // [text](path) 但 path 不存在
      "externalLinks": 12                           // 引用仓库外 URL
    },
    "codingContextGrounding": {                     // 仅 spectra 维度评估；最新一次 grounding run 数据（向后兼容）
      "taskId": "micrograd-add-tanh",
      "taskScore": 8.2,                             // opus judge 1-10（双盲）
      "controlScore": 5.4,                          // 裸 prompt 无 context
      "groundingDelta": 2.8,
      "judgeRationale": "...",                      // reverse-map 后填回
      "interRaterDelta": 0.3,                       // 同 fixture 跑 2 次 judge 差异
      "executionMode": "non-interactive",            // sonnet 直接跑 vs user-assisted
      "sourceRunTimestampUtc": "2026-05-01T..."      // Sprint 3 Phase C: byTask 混版本检测
    },
    "codingContextGroundingByTask": {                // Sprint 3 Phase C.1 新增：多任务累积 map
      "micrograd-add-tanh": { /* 同 codingContextGrounding 字段结构 */ },
      "micrograd-fix-bug": { /* ... */ },
      "micrograd-extract-const": { /* ... */ }
    },
    "graphAccuracy": null                            // Sprint 3 Phase B.1 落地：Python 项目算 call edge precision/recall，TS 项目 N/A。字段名实现：scripts/graph-accuracy.mjs 写入 quality.graphAccuracy
  },

  // ===== 1.1 新增 taskExecution 段（仅 task-execution 类 fixture，路径 tests/baseline/tasks/<task>/<tool>/）=====
  "taskExecution": {
    "taskId": "T1-micrograd-relu",
    "tool": "spec-driver",                           // spec-driver | superpowers | gstack | control
    "executionMode": "non-interactive",             // non-interactive | user-assisted
    "wallMs": 723000,
    "tokensTotal": 145000,
    "costUsd": 0.65,
    "userInterventions": 0,                          // user-assisted 时 > 0
    "commits": 3,
    "primaryOracle": {                               // 主 oracle（机械验证）
      "kind": "unit-test",                           // unit-test | ast-diff | regression-curve | stop-condition
      "passed": true,
      "details": "pytest tests/test_value.py: 12 passed, 0 failed"
    },
    "testsPassed": 12,
    "testsFailed": 0,
    "testsBroken": 0,                                // 改动破坏的现有测试
    "rubricJudgeScore": 8.5,                         // opus rubric 1-10（双盲）
    "rubricJudgeRationale": "...",
    "interRaterDelta": 0.5,
    "commitHistoryQualityScore": 7.0                 // commit message / 拆分质量（opus judge）
  }
}
```

---

## 3. 字段语义详细说明

### 3.1 meta.tool enum 扩展

| 值 | 类型 | Phase | 说明 |
|----|-----|------|------|
| `spectra` | spectra 类 | 1 | F143 已支持，自己每版本重跑 |
| `graphify` | spectra 类 | 1 | 冷冻一次 |
| `aider-repomap` | spectra 类 | 1 | 冷冻一次 |
| `cody` | spectra 类 | optional | 不实跑（Sourcegraph 账号） |
| `superpowers` | spec-driver 类 | 4 | task-execution fixture |
| `gstack` | spec-driver 类 | 4 | 同 |
| `spec-driver` | spec-driver 类 | 4 | 自己每版本重跑 |
| `control` | spec-driver 类 | 4 | 裸 Claude Code 对照组 |

**校验规则**（`scripts/lib/baseline-common.mjs` 实现）：
- spectra 类 fixture 路径 `tests/baseline/<project>/<tool>/<mode>.json`，无 `taskExecution` 段
- spec-driver 类 fixture 路径 `tests/baseline/tasks/<task-id>/<tool>/full.json`，必有 `taskExecution` 段
- 路径与 `meta.tool` 不一致 → 校验 hard fail

### 3.2 frozenFixture 标记

- 竞品 fixture（graphify / aider-repomap / superpowers / gstack）：`frozenFixture: true`
- 自己 fixture（spectra / spec-driver / control）：`frozenFixture: false`
- `eval:refresh-self` 命令 **只重跑** `frozenFixture: false` 的 fixture；frozen 的不动
- 超 staleAfterDate 时仍读 frozen，但报告中加 ⚠️ "fixture stale" 标注

### 3.3 quality 段的 null 兼容

- 静态分析字段（specStructure / graphSanity / crossLinks）：所有 tool 都填，不会为 null
- `codingContextGrounding`：只 spectra 类 tool 填；spec-driver 类 fixture 此字段为 null（不评 grounding）
- `graphAccuracy`（Sprint 3 Phase B.1 实装）：只 graph 类输出工具（spectra / graphify）才填；aider-repomap markdown 输出此字段含 `_skipped` 说明。schema 见 [`scripts/graph-accuracy.mjs`](../../../scripts/graph-accuracy.mjs)

### 3.4 taskExecution.primaryOracle.kind

| kind | 验证逻辑 | 适用任务 |
|------|---------|---------|
| `unit-test` | spawn `pytest` / `vitest` 命令，退出码 0 = passed | T1 / T3 |
| `ast-diff` | 解析 git diff，检查特定 marker 出现/消失 | T4 |
| `regression-curve` | 数值曲线对比 golden（如 loss 收敛轨迹）| T2 |
| `stop-condition` | 检查 agent 是否 surface 拒绝（exit code / commit count）| T6 |

---

## 4. Anonymize 协议（双盲 judge，spec C4）

### 4.1 strip 规则（输入 judge 前）

```
原 fixture 字段                         anonymized 字段
─────────────────────────────────────  ──────────────────────────────────
meta.tool: "spec-driver"            →  meta.tool: "<TOOL_A>"
meta.outputDir: ".../spec-driver/"  →  meta.outputDir: ".../<DIR_A>/"
meta.stdoutLogPath / stderrLogPath  →  paths normalized: .../<DIR_A>/stdout.log
taskExecution.tool: "superpowers"   →  taskExecution.tool: "<TOOL_B>"
commit author: "Claude Opus 4.7"    →  commit author: "<AUTHOR>"
file: "specs/NNN-feature-name/"     →  file: "<DOC_K>/spec.md"
trailer: "Co-Authored-By: ..."      →  （删除整行）
```

### 4.2 reverse-map 实施

`anonymizeFixture(fixture)` 返回 `{ anonymizedFixture, reverseMap }`：
- `reverseMap` 是 `{ "<TOOL_A>": "spec-driver", "<DIR_A>": "spec-driver", ... }`
- judge 跑完输出 `judgeRationale`（含 anonymized 名）
- 用 `reverseMap` 字符串替换恢复真实名
- 写回 fixture 的 `quality.codingContextGrounding.judgeRationale` 或 `taskExecution.rubricJudgeRationale`

### 4.3 inter-rater 协议

每个 fixture × judge 跑 2 次：
- run 1: random seed A → score_A
- run 2: random seed B → score_B
- `interRaterDelta = abs(score_A - score_B)`
- 如 delta > 1：surface 给用户人工裁决（commit log 标 "需人工审"）
- 否则：取平均填入最终 score

---

## 5. 1.0 → 1.1 迁移策略

### 5.1 老 fixture 处理

F143 已 ship 的 fixture（`tests/baseline/{micrograd,nanoGPT,self-dogfood}/spectra/full.json`，schema 1.0）：

- **本 Feature Phase 1 第一个 commit** 负责重生这 3 个 fixture 为 schema 1.1
- 重生命令：`npm run baseline:collect -- --targets self-dogfood,karpathy/micrograd,karpathy/nanoGPT --mode full --schema 1.1`
- collector 检测到 schema 1.0 fixture 存在时自动升级（不需手动删除）
- cost ≈ $13（与 F143 重跑一致）

### 5.2 baseline-diff.mjs 兼容

- 默认 `--major-only` flag（1.x 跨比 perf/output 段，quality 段 ignore）
- F143 已有的 `--ignore-quality` flag 保留作 alias
- 跨 major（1.x vs 2.x）仍 hard fail（schema break）

### 5.3 collector 版本号

- F143 collector v0.2.0 → F147 collector **v0.3.0**（minor bump）
- 对应 schema 1.0 → 1.1 minor bump

---

## 6. 不在 schema 1.1 范围（留给 1.2 / 2.0）

| 字段 | 待处理 Feature |
|------|---------------|
| `phases.*` 真实分项耗时 | F140（panoramic phase marker 标准化）|
| `perf.tokensCacheRead` | batch-orchestrator 加输出 |
| `meta.targetSourceLocOnly`（拆 LOC 不算 .md）| schema 1.2 |
| `quality.semantic*`（spec 语义准确性 LLM judge）| 后续 Feature |
| `taskExecution.commitHistoryGraph`（commit DAG 结构化）| schema 2.0 |

---

*Schema 1.1 设计由主线程（Opus 4.7）基于 spec §2.1.D + Codex W6/W7/W8 修正 + Perplexity research 跨工具语义对照生成。2026-04-30。*
