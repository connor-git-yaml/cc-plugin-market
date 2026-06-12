# 验证报告 — Feature 182 增量缓存正确性修复

> 生成时间: 2026-06-13
> 验证模式: fix（工具链验证闭环）
> 注: 验证期间 specs/src.spec.md 被 vitest run 触发再生成，已在验证后执行 `git checkout -- specs/src.spec.md` 还原。

---

## Layer 2: 原生工具链验证

### 命令执行结果

| 命令 | 退出码 | 结果 | 备注 |
|------|--------|------|------|
| `npx vitest run` | 0 | PASS | 4250 passed, 16 skipped, 20 todo；353 test files passed, 4 skipped |
| `npm run build` | 0 | PASS | TypeScript 零类型错误；prebuild inline-d3 无变化跳过 |
| `npm run repo:check` | 0 | PASS | 50/50 check 项全 pass，零报警 |

超时保护：`timeout` / `gtimeout` 命令在当前环境均不可用（macOS 未安装 coreutils），已在无超时保护下执行；三条命令均在 60 秒内完成（vitest run 约 38 秒）。

---

## Layer 1: Spec-Code 对齐验证

所有任务均标记 [x]（tasks.md 全 14 个 checkbox 已完成）。spec-review-report.md 已报告 14/14（100%）通过。以下为本次独立核证。

### 修复面覆盖率

| 修复面 | 任务 | 状态 |
|--------|------|------|
| F1 — 共享 hash 函数 | T001, T002 | 已实现 |
| F2 — files 注入参数 | T003 | 已实现 |
| F3a — languageSplit 标记 | T004 | 已实现 |
| F3b — buildSpecCacheKey | T005 | 已实现 |
| F3c — key 三处应用 + sourceTargetKey 持久化 | T006 | 已实现 |
| F3d — doc-graph-builder 解析 | T007 | 已实现 |
| F4 — checkpoint replace 语义 | T008 | 已实现 |
| F5 — forceRegenerate 时序修复 | T009 | 已实现 |
| 测试清理 — computeHashFor 删除 | T010 | 已实现 |
| E2E-A — 混合大小写第二轮零重生成 | T011 | 已实现 |
| E2E-B — 混语言第二轮零重生成 | T012 | 已实现 |
| E2E-C — 目录级真实碰撞（v2.1 补充）| —— | 已实现 |
| v2.1 — outputFileName 碰撞修复 | —— | 已实现 |
| v2.1 — sourceTargetKey 首写入盘 | —— | 已实现 |
| 回归护栏 | T013 | PASS（本次亲自执行）|
| release-note | T014 | 存在 |

**FR 覆盖率: 14/14（100%）**

---

## Layer 1.5: 验证铁律合规

**状态: EVIDENCE_MISSING**（前序 implement 子代理未直接提供命令执行记录；spec-review 与 quality-review 报告中均无 `npx vitest run` 的退出码或输出摘要）。

本次验证代理**亲自执行**了三条命令并记录真实退出码与计数（见 Layer 2 表），补充了缺失的证据。

---

## Layer 1.75: 深度验证 — 验收条目逐条核证

### 验收条目 A：混合大小写第二轮零重生成

- **断言行号**: `tests/integration/batch-incremental-cache.test.ts:130` — `expect(llmMocks.callLLM).toHaveBeenCalledTimes(0)`
- **前置**: 第一轮 skeletonHash 从真实落盘 frontmatter 读取（`:119` `readFrontmatterField(specPath, 'skeletonHash')`，不自算，对账写侧落盘）
- **证据强度**: 强——E2E 测试真实执行写侧链路（未 mock generateSpec），第二轮调用次数 0 由自动化测试断言；vitest run 中本测试通过（4250 passed 含场景 A）
- **判定**: PASS

### 验收条目 B：混语言 .py+.ts 首轮 2 份 spec + 第二轮零重生成

- **断言行号**:
  - 首轮 2 份 spec + files 注入生效: `:163-167`（断言 tsContent 不含 worker.py，pyContent 不含 service.ts）
  - sourceTarget 纯路径（无后缀泄漏）: `:176-177`
  - sourceTargetKey 带语言后缀: `:174-175`
  - 第二轮 LLM 调用 = 0: `:188` `expect(llmMocks.callLLM).toHaveBeenCalledTimes(0)`
- **证据强度**: 强——真实 E2E，vitest run 通过
- **判定**: PASS

### 验收条目 C：目录级碰撞（E2E-C，v2.1 补充）

- **断言行号**: `:234-237`（sourceTarget 同 `src/utils` 无后缀 + sourceTargetKey 带 `::ts-js` / `::python` 后缀）；`:258` 第二轮 LLM = 0
- **证据强度**: 强——vitest run 通过
- **判定**: PASS

### 验收条目：checkpoint 无重复条目（upsert helper）

- **代码证据**: `batch-orchestrator.ts:272-282` — `upsertCompletedModule` 先对 completedModules + failedModules 各执行 `filter(m => m.path !== entry.path)` 再 push；`recordFailedModule` 对称实现
- **调用点**: `:950`（根模块成功）`:1008`（非根成功）以及 failed catch 路径
- **单元测试直接断言 completedModules 唯一性**: **无**——现有测试覆盖 upsert 路径的调用次数但无专门断言"同名 module 最多出现一次"；spec-review 报告中也未声称有此断言
- **证据强度**: 中等——实现逻辑正确（filter-then-push），但无专项唯一性断言；E2E 场景 A/B/C 隐式覆盖（第二轮零重生成依赖 checkpoint 进度一致），未专门断言 completedModules 元素唯一性
- **判定**: PASS（实现正确，证据强度如实标注为中等）

### 验收条目：中断 full + 增量 resume 有信号

- **代码证据（OR 注入点）**: `batch-orchestrator.ts:707-710` — `if (state.forceRegenerate && !forceFullRegeneration) { forceFullRegeneration = true; shouldUseIncrementalPlan = false; logger.info('[resume] 检测到中断的 full run，剩余模块继续全量'); }`
- **时序正确性**: `let` 声明在 `:548-549`；OR 注入点在 `:699-710`（`const isResume = state !== null` 在 `:678`，checkpoint 加载在 `:660-670` 块之后）——时序安全，state 已加载
- **自动化测试覆盖**: **无专项 E2E**——无"full 中断 → 增量 resume → 断言 forceFullRegeneration = true + info 日志"的端到端测试
- **证据强度**: 中等——代码实现正确（fix-report 根因 4 修法 B 完整落地）；info 日志 (`[resume] 检测到中断的 full run`) 可在运行时观测；但无自动化 E2E 断言
- **判定**: PASS（已知无自动化测试；实现符合 plan 规范，证据强度如实标注）

### 验收条目：graph.json byte-stable gate（F179/F180）零回归

- **对应测试**: `tests/e2e/feature-175-batch-incremental.e2e.test.ts` 场景 10「full 与无改动增量产物 byte-stable：模块 spec 字节相同 + graph.json deepEqual（SC-003）」
- **vitest run 结果**: 通过（该 E2E 文件 10 tests 全部通过，含场景 10）
- **证据强度**: 强——真实 E2E 通过
- **判定**: PASS（零回归）

---

## Layer 1.8: 残留扫描

| 扫描项 | 结果 |
|--------|------|
| `computeHashFor` 私有复刻（旧假绿根因）| 零残留（delta-regenerator-mode.test.ts 已改 import） |
| `src/batch/skeleton-hash.ts`（v1 位置） | 不存在（仅 `src/core/skeleton-hash.ts`，v2 位置正确）|
| `sourceTargetToPath`（v1 废弃 helper）| 零残留（全仓不存在）|
| `localeCompare` 在 skeleton hash 路径 | 已消除（仅剩 regen-plan.ts 的既有 dirPath sort，与 hash 无关）|

---

## Layer 1.9: 文档一致性

- `specs/182-incremental-cache-correctness/release-note.md` 存在，内容与 plan.md v2 末尾草案一致
- fix-report.md 问题 2 已有"Phase 2 设计修订"注记说明 v1→v2 反转，无歧义

---

## Layer 1.5 补充: 推测性表述扫描

spec-review-report.md 中使用「已实现」+代码行号证据，质量符合要求，未检测到「should pass」「looks correct」等推测性表述。quality-review-report.md 同样使用具体行号引用。前序 implement 阶段未提供命令输出记录（已由本次验证代理直接执行补证）。

---

## 遗留风险清单

| 项目 | 来源 | 严重程度 | 处置 |
|------|------|---------|------|
| checkpoint 唯一性无专项断言 | 验收核证发现 | 低——实现正确，隐式 E2E 覆盖 | 后续可补 unit test 显式断言 `completedModules.filter(m => m.path === x).length <= 1` |
| 中断 full + resume 无专项 E2E | 验收核证发现 | 低——info 日志可观测，代码路径正确 | 留为后续 E2E 补充候选 |
| scanPyFiles 不解析 .gitignore | fix-report 已知不修项 (a) | 低——F175 起既已如此，单独修复登记 | 独立 fix 候选，不阻断本次 |
| delta propagation fallback (resolveSpecForSource 纯路径键) | fix-report 已知不修项 (b) | 极低——正常 batch 不可达 | 留观察 |
| root 根目录同名异语言文件 per-file spec 碰撞 | fix-report.md 残留边界 | 极低——极窄边缘，随 scanPyFiles 独立 fix 评估 | 独立 fix 候选 |
| E2E 场景 B/C sourceTargetKey 字面值绑定 | quality-review WARNING 2 | 低——language ID 规则变更时测试脆断 | 建议后续用 sourceTarget + `::ts-js` 拼接对账减少绑定 |
| batch-orchestrator.ts 体量 2417 行持续增长 | quality-review WARNING 1 | 低——非阻断，趋势记录 | 下次触碰该文件时评估拆分 helper 模块 |

---

## 总体判定

**PASS — READY FOR REVIEW**

- vitest run: 4250 passed / 0 failed（退出码 0）
- npm run build: 零类型错误（退出码 0）
- npm run repo:check: 50/50 全 pass（退出码 0）
- FR 覆盖率: 14/14（100%）
- CRITICAL: 0；WARNING: 2（非阻断，已知可维护性建议）
- specs/src.spec.md 验证后已还原
