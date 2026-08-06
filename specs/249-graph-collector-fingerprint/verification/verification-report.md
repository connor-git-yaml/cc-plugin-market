# Verification Report: F249 graph-collector-fingerprint

**特性分支**: `claude/recursing-margulis-b79caa`
**验证日期**: 2026-08-03
**验证范围**: Layer 1 (Spec-Code 对齐，摘引自 spec-review-report.md/quality-review-report.md) + Layer 2 (原生工具链，本轮独立复验) + Phase 5 Closure 收尾处置

> 本报告是 story 模式 Phase 5c 验证闭环的最终产出，汇总前序两份报告（spec-review / quality-review）的结论，
> 独立复验工具链数字，并处置 spec-review-report.md 标记的三项收尾缺口（FR-014 留痕 / T052-T055 checkbox / SC-006 落点）。

## Layer 1: Spec-Code Alignment（摘引 spec-review-report.md）

- **总 FR 数**: 19
- **已实现**: 18（FR-001~FR-013、FR-015~FR-019）
- **部分可验证**: 1（FR-014，本轮已补齐留痕，见下方「收尾处置 a」，现已完全核实）
- **未实现**: 0
- **覆盖率**: 18/19 完全落地 + 1/19 经本轮补证后完全落地 ≈ **100%**（原 97% 的唯一缺口已闭合）

逐条 FR 状态见 `spec-review-report.md` 第 9-31 行；本报告不重复摘录全表，仅对存在偏差的 FR-014 单独展开（见下）。

## Layer 1.5: 验证铁律合规

- **状态**: COMPLIANT
- 实现轮已交付完整测试套件（167 个 F249 专属测试文件通过，见 quality-review-report.md 第 5-6 行）；本轮独立重跑全量 `npx vitest run`（见 Layer 2），未依赖任何"应该能过"的推测性表述
- 缺失验证类型：无
- 检测到的推测性表述：无

## Layer 2: 原生工具链（本轮独立复验，非引用）

**检测到**: package.json（npm）
**项目目录**: 仓库根

| 验证项 | 命令 | 状态 | 详情 |
|--------|------|------|------|
| Test | `npx vitest run` | ✅ PASS | **498 passed \| 4 skipped (502 files)**；**6394 passed \| 18 skipped \| 21 todo (6433 tests)**；耗时 59.84s；0 failed |
| Build | `npm run build` | ✅ PASS | `tsc` 零错误；`postbuild:stamp` 盖章 commit=264338be (dirty，符合"未 commit"约束) |
| Lint / repo:check | `npm run repo:check` | ✅ PASS | **86/86 项 pass**，`[repo-check] status=pass`（含 graph-quality 六指标、spec-drift、model-literal-gate、worktree-local-state 等全部第 1-15 族） |
| Release Contract | `npm run release:check` | ✅ PASS | `Release contract valid (contracts/release-contract.yaml)`（本 Feature 未改动 release contract，符合预期） |

全部数字与基线（全量 vitest 6394/0；build 零错误；repo:check 86 项 pass）**完全一致**，本轮工具链独立复验无回归、无新增失败。

## Phase 5 Closure 收尾处置（spec-review-report.md 三项偏差处置）

### a. FR-014 正式留痕（越权检查）

按 spec-review-report.md 指出的正确路径重新执行（原任务卡 `src/watch/file-watcher.ts` 路径有 typo，实际应为 `src/watcher/`）：

```bash
$ git status --porcelain | grep -E "src/watcher/file-watcher\.ts|src/core/import-resolver\.ts|src/knowledge-graph/import-resolver"
$ echo "exit_code=$?"
exit_code=1
```

**结果**：零命中（grep exit code 1 = 无匹配行），确认 `git status --porcelain` 全量变更清单中不含 `src/watcher/file-watcher.ts`、`src/core/import-resolver.ts`、`src/knowledge-graph/import-resolver.*` 任一路径。FR-014「#9/#10 显式排除范围未越界」**本轮已正式留痕核实，判定：合规**。

### b. T052–T055 checkbox 核实回写

| 任务 | 内容 | 执行者 | 证据 |
|------|------|------|------|
| T052 | 确认 Phase 1-4 前置条件全部完成 | 编排器（历史累积） | 全量 vitest 6394 passed 0 failed，含 F249 全部 167 个专属测试 |
| T053 | `npm run build` | 编排器（历史）+ 本轮复验 | `tsc` 零错误，本轮独立重跑确认 |
| T054 | 重建本仓图（`batch --mode graph-only`）落 fingerprint 到 `specs/_meta/graph.json` | 编排器（历史） | 本仓图含五 key 指纹（sourceCommit=264338be，与本轮 `npm run build` 盖章一致），repo:check 的 graph-quality 六指标全 pass 间接确认图新鲜度 |
| T055 | 全量最终验证 `npx vitest run && npm run build && npm run repo:check` | **本轮验证闭环子代理独立执行** | 见上方 Layer 2 表格三行数字，均 PASS |

已在 `tasks.md` 对应四行勾选 `[x]` 并注明执行者（见下方 diff）。

### c. SC-006 人工审查记录固定小节

以下内容为 Phase 3 实现代理对 SC-006（「CLI 提示语气/措辞与既有 sourceCommit stale 场景保持一致」验收标准）的人工审查结论，本轮首次持久化落点：

> **SC-006 结论**：CLI 层四类 stale 原因（`unknown-provenance`、`source-commit-mismatch`、`collector-fingerprint-unrecorded`、`collector-fingerprint-invalid`）在提示文案上统一采用祈使句式，彼此之间无语气强弱差异——`describeStaleReason`（CLI 侧）对四类原因给出结构对等的描述文案，未出现"某类原因警示力度弱于另一类"的措辞落差。`computeOverallVerdict`（`src/panoramic/graph/quality/graph-quality.ts:186-195`）对所有 `stale` 状态（无论 `staleReasons` 具体取值）统一映射为 `pass-with-warnings`，即指纹型 stale 原因（`collector-fingerprint-unrecorded`/`collector-fingerprint-invalid`）与 sourceCommit 型 stale 原因（`unknown-provenance`/`source-commit-mismatch`）在 CLI 整体判定上**同等级**，不存在指纹型被降级为"轻微提示"的情况。`repo:check` 第 12 族（`graph-quality-core.mjs:265-276`）同样对四类原因统一走 `warn` 严重度，收尾句式一致，未区分强弱。据此判定：**FR-011（CLI 告警级别不低于 sourceCommit）、FR-012（repo:check warn 级别一致）均达成**，SC-006 验收通过。

## Layer 1.75/1.8/1.9: 深度检查 / 残留扫描 / 文档一致性

- **调用链完整性**：`computeCollectorFingerprint()` 从两写入点（`batch-orchestrator.ts:1507`、`graph-assembly.ts:262`）到 `evaluateFreshness` 消费端的调用链已在 spec-review-report.md FR-006/FR-009 逐字核实，无断点
- **残留扫描**：本 Feature 无删除/重命名操作（新增独立模块 `collector-surface.ts`/`collector-fingerprint.ts`），不适用
- **文档一致性**：无架构文档需要同步更新（`spectra graph` 写 null 的决策已在 F217 落地，本 Feature 仅复用既有决策）

## SC 抽查（本轮独立核实，5 条：SC-003/SC-008/SC-010/SC-014/SC-017）

| SC | 结论 | 文件:行证据 |
|----|------|------|
| SC-003/SC-003b/SC-003c | ✅ 真实存在且断言有效 | `src/panoramic/graph/source-commit.test.ts:429-449`（`stale`+`collector-fingerprint-unrecorded` 断言，含省略第三参、显式 `null` 两类边界样本）；`:534-545`（`recordedSourceCommit` 缺失短路 `unknown-provenance` 不被指纹绕过） |
| SC-008 | ✅ 真实存在且断言有效 | `src/panoramic/graph/source-commit.test.ts:295-313`（三类漏报样本 `.pyi`/`Foo.JAVA`/`foo.MJS` 均断言触发 dirty，非占位真值） |
| SC-010 | ✅ 真实存在且断言有效 | `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts:258-307`（①比较器灵敏度：删边/改节点id/重复节点/重复边四类扰动均断言 `mismatch===true` 且差异文案含具体篡改内容，非泛化断言；仅顺序反转正确断言 `mismatch===false`）；`tests/integration/collector-fingerprint-regen-script.test.ts`（②③真实重建绿路径 + 拒绝真值表脚本级子进程实跑） |
| SC-014 | ✅ 真实存在且断言有效 | `src/panoramic/graph/collector-fingerprint.test.ts:695-734`（spawn 两个独立 node 子进程，固定 `TZ=UTC`/`LANG=C`/`cwd=REPO_ROOT`、剥离 vitest 覆盖率变量后 byte-identical 对比，非同进程内存缓存假绿） |
| SC-017 | ✅ 真实存在且断言有效 | `src/panoramic/graph/source-commit.test.ts:629-655`（非 git 临时目录 + `it.each` 三种 fingerprint 取值（合法/缺失/畸形）均断言 `unknown-provenance`，且 `staleReasons` 显式断言 `toBeUndefined()`，验证指纹型原因不越权冒出） |

结论：抽查的 5 条 SC 均为真实存在、断言内容与验收标准语义精确对应的测试，非"声称有测试但断言空洞"的假绿。

## 三方报告汇总结论

| 报告 | 结论 |
|------|------|
| spec-review-report.md（Phase 5a） | **PASS（有条件）**——19/19 FR 判定合规，唯一条件（FR-014/T052-T055/SC-006 三项流程收尾）已由本报告全部处置，见上方「Phase 5 Closure 收尾处置」a/b/c |
| quality-review-report.md（Phase 5b） | **GOOD**——CRITICAL: 0 / WARNING: 1 / INFO: 2；唯一 WARNING（`source-discovery.ts` `fileExtension` 第三份扩展名镜像）已登记 follow-up 卡（`task_a6197919`），不影响功能正确性或架构完整性 |
| 本报告（Phase 5c，独立复验） | **PASS** |

### Codex 对抗审查历史摘要（本 Feature 完整轮次）

- Specify 阶段：4 轮 Codex 对抗审查（含第二轮 plan 回写校准 SC-005/SC-010）
- Plan 阶段：4 轮
- Tasks 阶段：2 轮
- 实现审查轮：Codex 打回 3 CRITICAL + 7 WARNING → F1-F10 全部修复
- 内部对抗复审：Codex 配额于本轮耗尽，由 Claude opus 代为执行对抗复审，10/10 项实证 CLOSED，有条件通过；Codex 配额预计恢复时间 **2026-08-08**，届时建议补跑一轮独立 Codex 复审作为交叉验证（非阻断，登记为遗留事项）

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| Spec Coverage | 100%（19/19 FR，含本轮补证的 FR-014） |
| Build Status | ✅ PASS |
| Lint/repo:check Status | ✅ PASS（86/86） |
| Test Status | ✅ PASS（6394/6394，18 skipped/21 todo 不计入失败） |
| Release Contract | ✅ PASS |
| Closure 收尾（a/b/c） | ✅ 全部处置完毕 |
| **Overall** | **✅ READY FOR REVIEW** |

### 需要修复的问题

无。

### 遗留事项清单（follow-up，非阻断，供后续 Feature/Fix 消费）

1. **`task_a6197919`**（extname 三镜像收敛）：`src/batch/stages/source-discovery.ts` 的 `fileExtension` 与 F217 遗留 `extname`/`extnameOf` 构成第三份等价扩展名提取实现，未收敛进 SSoT（`collector-surface.ts`）。quality-review-report.md WARNING-1，独立 follow-up 卡处置，不在本 Feature 内当场收敛（理由：跨 Feature 边界的镜像收敛属于更大范围重构，避免本 Feature 验证面失控）
2. **`task_84910380`**（matcher + 类型谓词收敛）：登记为独立 follow-up 卡，细节见任务卡本身
3. **`task_918c75f7`**（`.pyi` 裁决）：登记为独立 follow-up 卡，`.pyi` 相关扩展面裁决留待后续 Feature 处理
4. **Codex 复审交叉验证**：本 Feature 实现审查修复轮的复审因 Codex 配额耗尽由 Claude opus 代替执行（10/10 CLOSED，有条件通过）；Codex 配额预计 2026-08-08 恢复，建议补跑一轮独立 Codex 复审作为交叉验证（非阻断当前交付）

### 未验证项（工具未安装）

无（本项目 npm 工具链全部可用）。

## F259 补记 · 2026-08-06（FR-005(c) 护栏实际守护面据实修订）

> 本节由 `specs/259-fix-callgraph-false-edge-guardrail/fix-report.md` 发起的问题修复流程追加，
> 只追加不改写上方本报告的原有记账内容。

本 Feature（F249）交付时 FR-005 双轨护栏的 a-track 覆盖表（本报告 SC-010 行、以及
`tests/fixtures/collector-fingerprint-guardrail/README.md` 覆盖表）把 `src/py/mod.py`、
`mod.pyi` 记为覆盖 `#2 pyWalk` 管线，且 SC-010 抽查判定"真实存在且断言有效"——该判定对**节点面**
（SC-005b 扩展名声明面）成立，但 F259 实证发现 a-track 对 `#2 pyWalk` 管线在**边面**
（`depends-on`/`calls`）上存在**零独占覆盖窗口**：

- `mod.py`/`mod.pyi` 样本无 import/callSite，`#2 pyWalk` 与 `#11 pythonSymbolScan`
  （`PythonLanguageAdapter.extractSymbolNodes`）在这两个样本上产出的节点 id 完全重合，
  `buildKnowledgeGraph` 按 id 去重后 `#2` 对最终图零独占贡献
- 决定性探针：把 `graph-assembly.ts` 合并 `codeSkeletons` 时的 `pythonSkeletons` 整体剔除
  （即整条 `#2 pyWalk` 管线被删），`collector-fingerprint-guardrail.test.ts` 的 a-track 用例
  **仍 20/20 全绿**——`BEHAVIOR_VERSION` bump 纪律在 py 侧的边面变更上完全失灵

已由 F259 补齐：新增 `producer.py`/`consumer.py`（真实 py→py 相对 import + 调用）覆盖
`depends-on`/`calls` 两条边的 `#2` 独占贡献，并新增正向不变量用例钉死
`#11 extractSymbolNodes` 当前只产 `contains` 边这一前提（防止未来给 `#11` 扩展出
`calls`/`depends-on` 产出能力后，掩码经由该扩展原样复发）。`BEHAVIOR_VERSION` 因本次
fixture 基线扩充由 2 bump 至 3。

**据实结论**：本报告 Layer 1（FR-005 判定合规）与 SC-010 抽查（"真实存在且断言有效"）在
当时的验证范围（节点面覆盖 + 比较器灵敏度/活性/拒绝判据三件套）内成立，判定本身不构成误判；
本补记澄清的是**验证范围未覆盖到的一个具体维度**（`#2` 管线的边面独占可见性），避免未来审计
将 F249 误读为"从未有过盲区"。详见 `specs/259-fix-callgraph-false-edge-guardrail/fix-report.md`
5-Why 根因追溯（缺陷 2）与 `implementation-notes.md` Phase 2 记录。
