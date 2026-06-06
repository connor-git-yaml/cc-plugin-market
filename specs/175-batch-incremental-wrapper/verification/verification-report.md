# Verification Report: F175 Batch Incremental Wrapper

**特性分支**: `claude/hardcore-mendeleev-ad8c9a`
**验证日期**: 2026-06-07
**验证范围**: Layer 1 (Spec-Code 对齐) + Layer 1.5 (验证铁律) + Layer 1.8 (残留扫描) + Layer 2 (原生工具链)
**验证子代理**: verify（claude-sonnet-4-6）
**引用报告**:
- `specs/175-batch-incremental-wrapper/verification/spec-review.md`（spec-review 子代理，19/19 FR / 7 SC / 9 EC 真实满足）
- `specs/175-batch-incremental-wrapper/verification/quality-review.md`（quality-review，0 CRITICAL / 3 WARNING，总体 GOOD；W-1 rmSync try/catch 已在工作树修复未提交）

---

## Layer 1: Spec-Code Alignment

### 功能需求对齐

> spec-review 子代理已对全部 19 FR / 7 SC / 9 EC 执行逐条代码追踪，结论：19/19 全部真实满足，0 未实现，0 部分实现。下表为 checkbox + 文件存在性精简核查，以 spec-review 结论为权威参考。

| FR | 描述摘要 | Task | checkbox | 文件存在性 / 状态 |
|----|---------|------|----------|-----------------|
| FR-001 | 默认增量路径，三入口一致 | T013 | ✅ | `src/batch/regen-plan.ts` 存在，`resolveRegenPlan` 默认 `incremental:true` |
| FR-002 | 三入口默认值归一化，消除漂移 | T013-T016 | ✅ | `parse-args.ts` / `server.ts` / `batch-orchestrator.ts` 三处均接入 `resolveRegenPlan` |
| FR-003 | 显式全量逃生口 `--full` | T017-T018 | ✅ | `src/cli/utils/parse-args.ts` + `src/mcp/server.ts` 新增 `full` 参数 |
| FR-004 | regen 轴与 BatchMode 参数解析正交 | T017, T034 | ✅ | `--full` 与 `--mode` 独立，help 文案区分 |
| FR-005 | 增量路径未受影响模块 mtime 不变 | T008-场景1,2（含 mtime 断言）| ✅ | E2E 场景1/2 包含 mtime 快照断言（W-1 修订）|
| FR-006 | graph.json 全部时间戳归一化（含 inputHash 嵌套）| T022-T023 | ✅ | `stripVolatileFields` + `stableStringify` 在 `graph-builder.ts` 中实现 |
| FR-007 | 写盘边界 nodes/links 确定性排序（追加 semantic edges 之后）| T022, T024 | ✅ | `normalizeGraphForWrite` 在 `batch-orchestrator.ts` 中 `writeKnowledgeGraph` 前调用 |
| FR-008 | 无改动时模块级 generateSpec = 0 | T008-场景2 | ✅ | E2E 场景2 通过，`deltaReport.directChanges` 空 |
| FR-009 | 新 E2E 测试覆盖增量核心路径 | T008 | ✅ | `tests/e2e/feature-175-batch-incremental.e2e.test.ts` 存在，10 场景全通过 |
| FR-010 | 不引入现有测试回归 | T006/T012/T030/T037 | ✅ | vitest 326 test files passed，0 failed |
| FR-011 | force 优先级高于 incremental | T009, T013 | ✅ | `resolveRegenPlan` 规则优先链：force → full → incremental → 默认 |
| FR-012 | 首次运行无历史 spec 退化全量 | T008-场景9 | ✅ | 场景9：`deltaReport.mode=full`，`fallbackReason=no-existing-specs` |
| FR-013 | generatedByMode 缺失或 mode 切换时 cache miss | T008-场景4 | ✅ | 场景4 mode 切换（full→reading）验证全量重生成 |
| FR-014 | baseline-collect.mjs 显式全量 flag | T029 | ✅ | `scripts/baseline-collect.mjs` `runBatchAndCapture` 追加 `--full` |
| FR-015 | task D Out of Scope，不实现 | — | ✅ | 明确标注 Out of Scope，无实现 |
| FR-016 | full/force 不被残留 checkpoint 绕过 | T019-T020, 场景3,6 | ✅ | `regenPlan.full=true` 时 `completedPaths.clear()`，场景6 验证 |
| FR-017 | 孤儿 spec 删除 + ownership 边界 | T025-T026, 场景5 | ✅ | `isBatchGenerated`（`generatedByMode != null`）+ `isInManagedOutputDir` 双重校验；场景5 验证手写 spec 不被误删 |
| FR-018 | BFS 依赖传播独立断言（预期 target 集合，非同义反复）| T008-场景1,8 | ✅ | 场景1 验证 A→B 依赖链；场景8 验证 diamond + cycle 终止 |
| FR-019 | DeltaRegenerator 与 runBatch target 口径一致 | T002/T027/T028, 场景7 | ✅ | `resolveSourceTarget` 共享函数，场景7 验证自洽 |

### 覆盖率摘要

- **总 FR 数**: 19
- **已实现**: 19（含 FR-015 Out of Scope 标注）
- **未实现**: 0
- **部分实现**: 0
- **覆盖率**: 100%（19/19）

**SC 覆盖**（7 条）：SC-001 ~ SC-007 全部通过（spec-review 详细追踪确认）

**EC 覆盖**（9 条）：EC-001 ~ EC-009 全部满足（spec-review 详细追踪确认）

---

## Layer 1.5: 验证铁律合规

### 证据来源

本 Feature 的验证证据来自以下实际执行（5 commits 贯穿四个 Phase，8 轮 Codex 对抗审查）：

**构建证据**：
- `npm run build`（TypeScript tsc 零错误）— Phase 0 / Phase 2 / Phase 3 各执行，在 T007 / T031 / T038 checkpoint 留有实跑记录
- 本次验证执行：退出码 0，零编译错误

**测试证据**：
- `npx vitest run`（全量，326 test files，3898 tests passed）— T006 / T012 / T030 / T037 checkpoint 各执行
- 本次验证执行：退出码 0，3898 passed / 11 skipped / 20 todo，0 failed

**工具链证据**：
- `npm run repo:check` — T039 执行，本次验证执行：退出码 0，47 项全 pass
- `npm run release:check` — 本次验证执行：退出码 0，release contract valid

### 推测性表述扫描

检测到以下类型的陈述：无（commit messages 包含具体命令输出引用；tasks.md checkpoint 均有明确验证指令；质量审查报告基于实际代码逐行核查，非推测性描述）。

### 合规状态

**COMPLIANT** — 所有验证类型均有具体命令执行记录（构建 / 测试 / repo 检查 / release 检查），无推测性表述。

---

## Layer 1.75: 深度检查

### 调用链完整性

三入口默认翻转调用链追踪：

- **CLI 链路**：`src/cli/commands/batch.ts:63` → `resolveRegenPlan({incremental, full, force})` → `runBatch({...regenPlan})` → `batch-orchestrator.ts:413`（兜底再调 `resolveRegenPlan`，幂等）→ `DeltaRegenerator`
- **MCP 链路**：`src/mcp/server.ts`（batch tool handler）→ `resolveRegenPlan({incremental, full, force})` → `runBatch` → 同上
- **直接 API 调用**：`runBatch(options)` → `batch-orchestrator.ts:413` 兜底 `resolveRegenPlan` → 确保无入口遗漏

**检查结论**：三条链路完整，`resolveRegenPlan` 在每条链路至少调用一次，无参数丢失断点。

### 数据持久化验证

孤儿删除（`fs.rmSync`）位于 `batch-orchestrator.ts` 孤儿处理循环内，在 runBatch 主流程完成、spec 产物写盘后执行。`writeKnowledgeGraph` 是同步写盘（非流式），`normalizeGraphForWrite` 在其调用前 in-place 修改 graphJson。

**注**：quality-review 的 W-1（`rmSync` 无 try/catch）已在工作树修复（`src/batch/batch-orchestrator.ts` 工作树有未提交改动），将在下一次提交时入库。

### 配置贯穿验证

`incremental` 默认值贯穿路径：`regen-plan.ts:resolveRegenPlan(undefined) → {incremental:true}` → 传入 `runBatch options` → `batch-orchestrator.ts:413` 读取 `options.incremental` → `DeltaRegenerator` 实例化 → `deltaReport.mode='incremental'`。全链路一致，无中途短路。

---

## Layer 1.8: 残留扫描

### 扫描范围

本次改动涉及：（1）默认值语义翻转（`incremental=false` → `true`）；（2）新增 `generatedByMode` 作为孤儿 ownership 判定字段；（3）提取纯函数 `resolveRegenPlan` / `resolveSourceTarget` / `normalizeGraphForWrite`；（4）删除三处独立硬编码默认值。

### 扫描结果

| 扫描项 | 命令 | 结果 |
|--------|------|------|
| `incremental = false` 硬编码残留 | `grep -rn "incremental = false" src/` | 仅在 `batch-orchestrator.ts:412` 发现注释行（"删除原 `incremental = false` 硬编码"），非代码残留 |
| `generatedBy` 误用（非 `generatedByMode`）in 孤儿判定 | `grep -rn "isBatchGenerated" src/` | `isBatchGenerated` 在 `doc-graph-builder.ts:54` 定义，检查 `summary.generatedByMode != null`，未使用 `generatedBy` |
| 旧语义 `generatedBy` 在 ownership 路径残留 | `grep -rn "generatedBy[^M]" src/` | 仅在正常 spec frontmatter 写入路径（`frontmatter.ts`、`spec-store.ts`、`index-generator.ts`）中出现，与孤儿删除路径完全隔离 |

**结论**：CLEAN — 无残留引用，旧默认值注释已明确标注为历史说明，孤儿判定路径正确使用 `generatedByMode`。

### DOC_DRIFT 检查

本次改动未涉及公共 API 重命名或模块删除（新增 `regen-plan.ts` 纯函数模块，原有模块接口向后兼容扩展）。无文档漂移风险。

---

## Layer 2: Native Toolchain

**检测到语言/构建系统**: TypeScript（Node.js）  
**特征文件**: `package.json`（`spectra-cli@4.2.0`）  
**超时保护**: macOS 未安装 `timeout` / `gtimeout`（coreutils 未安装），跳过超时保护，以 Bash tool 内置 120-300s 超时执行。

### TypeScript（npm）

| 验证项 | 命令 | 状态 | 详情 |
|--------|------|------|------|
| Build | `npm run build` | ✅ PASS | `tsc` 零错误；`inline-d3` 内容无变化跳过写入；退出码 0 |
| Lint | `npm run lint`（ESLint/Prettier 未在 package.json scripts 注册）| ⏭️ 无独立 lint 脚本 | TypeScript 类型检查已作为 build 步骤执行，覆盖类型安全；无独立 ESLint/Prettier 命令 |
| Test（vitest） | `npx vitest run` | ✅ PASS | 326 test files，3898 passed / 11 skipped / 20 todo，0 failed；F175 E2E 10 场景全通过 |
| repo:check | `npm run repo:check` | ✅ PASS | 47 项全部 pass，退出码 0 |
| release:check | `npm run release:check` | ✅ PASS | release contract valid，退出码 0 |

### 测试结果详情

**新增 F175 测试文件**（全部通过）：

| 测试文件 | 测试数 | 状态 |
|---------|--------|------|
| `tests/e2e/feature-175-batch-incremental.e2e.test.ts` | 10 | ✅ 全通过（24123ms）|
| `tests/unit/batch/regen-plan.test.ts`（含 T004/T009 扩展）| 含于单测套件 | ✅ |
| `tests/unit/batch/batch-orchestrator-incremental.test.ts` | 含于单测套件 | ✅ |
| `tests/unit/graph/graph-builder-normalize.test.ts`（含 T005/T011 扩展）| 含于单测套件 | ✅ |

**存量 E2E 无回归**：`tests/e2e/batch-pipeline.e2e.test.ts`、`tests/e2e/batch-concurrency.e2e.test.ts`（4 tests，32133ms）全部通过。

### Self-Dogfood 污染说明

运行完成后 `git status` 显示 `specs/src.spec.md` 被修改——这是 E2E 场景10（byte-stable 测试对本仓库运行 batch）产生的已知 self-dogfood 污染，属于预期行为，不计入回归，不应 commit。

---

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| Spec Coverage | 100%（19/19 FR，含 FR-015 Out of Scope）|
| SC Coverage | 100%（7/7 SC 满足）|
| EC Coverage | 100%（9/9 EC 满足）|
| Build | ✅ PASS（`npm run build`，TypeScript tsc 零错误）|
| Lint | ⏭️ 无独立 lint 脚本（类型检查已含于 build）|
| Test | ✅ PASS（3898/3898 passed，0 failed，326 文件）|
| repo:check | ✅ PASS（47 项全通过）|
| release:check | ✅ PASS（release contract valid）|
| 验证铁律 | COMPLIANT（实跑证据完整，无推测性表述）|
| 残留扫描 | CLEAN（无旧概念残留引用）|
| **Overall** | **✅ READY FOR REVIEW** |

### Quality Review 汇总（来自 quality-review.md）

- **CRITICAL**: 0 个
- **WARNING**: 3 个（全部为可维护性，无功能/安全阻塞）
  - W-1（已修复）：`rmSync` 无 try/catch，工作树已修复，待提交
  - W-2：`DeltaRegenerator` 实例化两次，建议后续 Feature 清理
  - W-3：`normalizeProjectPath` 两份独立实现，建议后续合并
- **INFO**: 3 个（导出组织、分隔符注释等，非阻塞）

### 后续建议

1. 提交工作树中 W-1 修复（`src/batch/batch-orchestrator.ts` 的 `rmSync` try/catch 包裹）
2. W-2（`DeltaRegenerator` 双实例）和 W-3（`normalizeProjectPath` 重复）作为技术债，记录在后续 Feature backlog
3. 不要 commit `specs/src.spec.md`（self-dogfood 测试污染）
