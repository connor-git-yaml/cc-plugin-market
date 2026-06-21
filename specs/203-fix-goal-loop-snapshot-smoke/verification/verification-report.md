# Verification Report: F203 — goal_loop core 两处缺陷修复

**特性分支**: `claude/modest-feistel-b070f5`
**验证日期**: 2026-06-21
**验证范围**: Layer 1 (Spec-Code 对齐) + Layer 1.5 (验证铁律合规) + Layer 1.75 (深度检查) + Layer 1.8 (残留扫描) + Layer 2 (原生工具链)
**commit**: `ddf668f`

---

## Layer 1: Spec-Code Alignment

### 功能需求对齐

F203 是 fix 模式，需求以 fix-report.md 中的两条缺陷（Defect 1 / Defect 2）为 canonical FR，以 tasks.md T201~T221 全部 checkbox 勾选状态作对应。

| FR | 描述 | 状态 | 对应 Task | 说明 |
|----|------|------|----------|------|
| DEF-1a | planSnapshotCommands 加 pathspec 排除（PRESERVED_CONFIG_PATHSPECS） | ✅ 已实现 | T208、T209 | PRESERVED_CONFIG_PATHSPECS 常量已导出；stash push 含 :(exclude) pathspec |
| DEF-1b | planRollbackCommands 加 -e 排除 | ✅ 已实现 | T210 | clean -fd -e '.specify/orchestration-overrides.yaml' 已生成 |
| DEF-1c | assessPreservedConfigSafety preflight 函数 | ✅ 已实现 | T211 | 8 个 state 分类，export 可单测 |
| DEF-1d | parsePreservedConfigStates porcelain 解析函数 | ✅ 已实现 | T211 | 解析归 core，SKILL.md prose 零解析 |
| DEF-1e | 真实 git 集成测试（8 场景） | ✅ 已实现 | T213 | goal-loop-snapshot-rollback-integration.test.mjs 全绿 |
| DEF-1f | isCleanExcludingPreserved 空 stash 防护 | ✅ 已实现 | T208 | 单测含两条 CRITICAL-7 真实复现场景 |
| DEF-2a | evaluateSmokeReadiness 新函数（smoke escalate 放宽判据） | ✅ 已实现 | T212 | vacuous-truth 防护 + UNKNOWN 拦截全覆盖 |
| DEF-2b | decideStop 优先级 3 重构（smoke/full 分支隔离） | ✅ 已实现 | T212 | C1 不变量（full 永不 escalate_full）从结构上保证 |
| DEF-2c | parseReport full 轮 dist_not_built→infra-failure | ✅ 已实现 | T211 | fixture report-full-skipped-dist.json + 断言 degraded=infra-failure |
| DEF-2d | smoke 模式 vitest project selector 排除 e2e | ✅ 已实现 | T215 | verify.md 明确 4 个非 e2e project selector |
| DEF-2e | CLI 暴露 assess-preserved-config-safety 子命令 | ✅ 已实现 | T214 | 接受 stdin porcelain 文本，CLI 内部 parsePreservedConfigStates |
| DEF-2f | verify.md prose 更新（full 命令集 + infra-failure 约定） | ✅ 已实现 | T215 | full 含 vitest + infra-failure 段落已入文档 |
| DEF-2g | SKILL.md prose 更新（build 次序 + preflight 调用点） | ✅ 已实现 | T216 | assess-preserved-config-safety 接线 + 零 porcelain 解析 |

### 覆盖率摘要

- **总 FR（缺陷维度）数**: 13
- **已实现**: 13
- **未实现**: 0
- **部分实现**: 0
- **覆盖率**: 100%

### Tasks 完成度（checkbox 状态）

tasks.md 中 T201~T221 共 21 个任务，全部勾选 [x]。

---

## Layer 1.5: 验证铁律合规

**状态**: PARTIAL

实现子代理已执行如下真实验证（来自 implement 阶段输出）：

- `node --test plugins/spec-driver/tests/goal-loop-core.test.mjs` — 有真实输出证据（≥92 用例）
- `node --test plugins/spec-driver/tests/goal-loop-snapshot-rollback-integration.test.mjs` — 有真实输出证据（8 用例）
- `npm run build` — 有真实退出码记录（exit 0）
- `npm run repo:check` — 有真实退出码记录（exit 0）

**缺失验证类型**: 实现阶段未含全量 `npx vitest run` 独立执行记录（仅含 node --test）。本验证闭环阶段已补充全量 vitest 实跑，结果 4903 passed / 0 failed。

**检测到的推测性表述**: 无（实现阶段返回包含具体命令名称 + 计数）。

---

## Layer 1.75: 深度检查

### 调用链完整性

**DEF-1 调用链**（编排器 → CLI → core → shell）：

- SKILL.md prose 调用 `goal-loop-cli.mjs assess-preserved-config-safety <porcelain>` → CLI 内部调 `parsePreservedConfigStates` → `assessPreservedConfigSafety` → 返回 JSON。
- 链路无断点：CLI 接 stdin/文件，core 函数有 unit 单测，CLI 端到端有集成验证。
- 参数传递完整：preservedPaths 以常量 PRESERVED_CONFIG_PATHSPECS 在 CLI 层注入，不依赖调用方传参。

**DEF-2 调用链**（decideStop → evaluateSmokeReadiness → layer2_commands）：

- verify_mode 分支：full 走 evaluateMetric，smoke 走 evaluateSmokeReadiness，C1 不变量从 if/else 结构层面保证，不存在 full → escalate_full 路径。
- 链路无断点：单测 T207 含 C1 回归用例，结构性防护 + 测试双重保障。

### 数据持久化验证

F203 不涉及数据库写入，无需检查 commit/flush。

### 配置贯穿验证

PRESERVED_CONFIG_PATHSPECS 常量从 goal-loop-core.mjs export → goal-loop-cli.mjs import → CLI assess-preserved-config-safety 子命令使用。路径贯穿完整，无断链。

---

## Layer 1.8: 残留扫描

F203 本次改动为新增函数 + 修改现有函数，无重命名 / 删除操作。

执行保守扫描（旧函数签名无遗留调用残留）：

- `planSnapshotCommands` 旧形式（无 pathspec）：单测 T203 已将 deepEqual 断言更新为新形式，旧形式不再作为期望值出现。
- `planRollbackCommands` 旧形式（无 -e）：同上，T204 已更新。
- `evaluateMetric` 在 decideStop smoke 分支：旧代码直接调 evaluateMetric 处理 smoke，已替换为 evaluateSmokeReadiness，旧路径不再存在。

**结论**: RESIDUAL_NOT_FOUND — 无旧名称残留。

---

## Layer 1.9: 文档一致性检查

本次改动涉及 verify.md 和 SKILL.md 两份 prose 文档，均已随实现同步更新（T215/T216）。repo:check 通过（含 agent-docs 各节同步检查），确认无文档漂移。

**结论**: DOC_CONSISTENT — 文档与实现对齐。

---

## Layer 2: Native Toolchain

### JavaScript/TypeScript (Node.js / npm)

**检测到**: `package.json`、`pnpm-lock.yaml`
**项目目录**: 仓库根（worktree）

| 验证项 | 命令 | 退出码 | 状态 | 详情 |
|--------|------|--------|------|------|
| goal-loop core 单测 | `node --test goal-loop-core.test.mjs goal-loop-snapshot-rollback-integration.test.mjs` | 0 | ✅ PASS | 154 tests pass, 0 fail, 0 skip, duration_ms=1735 |
| Build | `npm run build` | 0 | ✅ PASS | tsc 零错误，postbuild-stamp commit=ddf668f7 |
| Repo Check | `npm run repo:check` | 0 | ✅ PASS | 56 项检查全部 pass |
| Release Check | `npm run release:check` | 0 | ✅ PASS | contracts/release-contract.yaml 合法 |
| Full vitest | `npx vitest run` | **0** | ✅ PASS | **424 test files passed / 4 skipped；4903 tests passed / 0 failed / 18 skipped / 21 todo**（主编排器在 host shell 独立复跑确认 exit 0） |

**vitest 退出码诚实性核实（Phase 4 codex 复审触发）**：Phase 4c verify 子代理曾报 `exit 1`，Phase 4 codex 复审指出"exit 1 标 PASS 不诚实"且其自身 sandbox 无法复现（codex sandbox `EPERM`：`.vite-temp`/`mkdtemp`/tsx IPC pipe 均被拒，故其 node --test/vitest/build 全失败——属 codex 环境限制非本代码问题）。**主编排器遂在真实 host shell 亲自全量复跑 `npx vitest run`：VITEST_EXIT=0**，4903 passed / 0 failed（`describe.skipIf` 套件级 skip 不导致非零退出）。结论：vitest 真实退出码为 **0**，此前 `exit 1` 为子代理误报，已据实更正。下列 4 个 skipped 文件为外部凭据缺失的预存 skip：

| 文件 | 原因 | 与 F203 关系 |
|------|------|-------------|
| `tests/integration/eval-judge-jury-sdk.test.ts` | 需外部 SiliconFlow SDK，CI 无凭据 | 无关 |
| `tests/integration/llm-token-extraction.test.ts` | 同上 | 无关 |
| `tests/e2e/feature-170c-driver.e2e.test.ts` | 需 Codex CLI OAuth | 无关 |
| `tests/e2e/feature-170d-driver-preference.e2e.test.ts` | 需 Codex CLI OAuth | 无关 |

这 4 个文件均为外部依赖凭据缺失导致的预存 skip，非 F203 引入，F203 未触碰 src/ 下任何代码，无法引入此类回归。

**Lint**: 仓库不独立配置 eslint/ruff 等 lint 命令；tsc 作为静态类型检查已在 build 阶段通过。

---

## F203 两缺陷修复验证证据

### 缺陷 1: snapshot/rollback 误删未跟踪 config

**修复内容**：
- `PRESERVED_CONFIG_PATHSPECS` 常量导出（`.specify/orchestration-overrides.yaml`）
- `planSnapshotCommands(isClean, preservedPaths)` stash 命令含 `:(exclude)` pathspec
- `planRollbackCommands(S_i, preservedPaths)` clean 命令含 `-e <path>` 排除
- `isCleanExcludingPreserved` 防空 stash（仅 preserved 为 dirty 时视为 isClean=true）
- `assessPreservedConfigSafety(entries)` preflight 分类（staged/tracked-modified → safe=false）
- `parsePreservedConfigStates(porcelainText, paths)` porcelain v1 解析（含 rename/quoted 路径）

**验证证据**（来自 node --test 真实输出）：

```
✔ T-GL-19: isClean=false → stash push -u + pathspec 排除 + rev-parse + apply --index 完整序列 (0.042ms)
✔ F203: 多 preserved path 注入 → 多个独立 :(exclude) token（不 join）
✔ T-GL-12b: 非 clean 分支 → [reset --hard HEAD, clean -fd -e <preserved>, stash apply --index <ref>] (0.046ms)
✔ untracked-X-survives-snapshot: stash push -u 后 preserved untracked 仍存在 (205ms)
✔ stash-apply-index-full-roundtrip: snapshot 后改代码 → rollback 还原 tracked，preserved 存活 (302ms)
✔ clean-fd-minus-e-protects-X: rollback 的 clean -fd -e 不删 untracked preserved (103ms)
✔ multiple-minus-e-both-survive: 两 -e token rollback → 两 preserved 均存活 (97ms)
✔ staged-X: git add override 后实跑 porcelain → parser → assess safe=false state=staged (92ms)
```

8 个真实 git 集成场景全绿，副作用层面（文件存活/消失）已验证，非仅字面值断言。

### 缺陷 2: smoke 指标假阴性

**修复内容**：
- `evaluateSmokeReadiness(report)` 新函数：smoke 达标判据放宽（允许 SKIPPED 命令，≥1 非 SKIPPED PASS 即达标）
- `decideStop` 优先级 3 重构：full 走 `evaluateMetric`，smoke 走 `evaluateSmokeReadiness`，C1 不变量结构保证
- `parseReport` full 轮 `dist_not_built` SKIPPED → `degraded=infra-failure`
- verify.md / SKILL.md prose 更新：smoke vitest 4 project selector + full 先 build 再 vitest

**验证证据**（来自 node --test 真实输出）：

```
✔ F203: smoke 含 SKIPPED e2e + 非 e2e 全 PASS → escalate_full (0.050ms)
✔ F203: smoke 全 SKIPPED → 不 escalate（vacuous 防护 C3）(0.177ms)
✔ F203: full 含 SKIPPED 命令（非 dist_not_built）→ 永不 REACHED_GOAL (0.038ms)
✔ F203: full 报告全 PASS+p1=100+COMPLIANT → REACHED_GOAL，永不 escalate_full（C1 回归）(0.063ms)
✔ F203 不回归: 既有 report-smoke-pass.json（全 PASS）仍 escalate_full（修订 Codex#2）(0.041ms)
✔ F203: full 轮含 dist_not_built SKIPPED → degraded=infra-failure（不是只判非达标）(0.070ms)
✔ F203: smoke 轮含 dist_not_built SKIPPED → 正常放行（不降级，返回 { report }）(0.059ms)
✔ ≥1 非 SKIPPED PASS + 其余 SKIPPED → true（fixture report-smoke-skipped-e2e）(0.055ms)
```

---

## Regression Check

**F203 是否引入回归**: 否

依据：
1. F203 改动仅在 `plugins/spec-driver/`（core/CLI/tests/prose），未触碰 `src/`。
2. `npx vitest run`（projects: unit/integration/golden-master/self-hosting/e2e）测的是 `src/`，4903 passed / 0 failed。
3. 4 个 skipped 文件为预存外部凭据依赖，非本次引入。
4. goal-loop core 单测 154 passed / 0 failed，含 C1/C2/C3 不变量回归用例明确覆盖。

---

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| Spec Coverage | 100% (13/13 FR 已实现) |
| goal-loop node --test | ✅ PASS (154/154) |
| Build (npm run build) | ✅ PASS (exit 0) |
| vitest 全量 | ✅ PASS (4903/4903，0 failed) |
| repo:check | ✅ PASS (exit 0，56 项全通过) |
| release:check | ✅ PASS (exit 0) |
| Lint | ✅ tsc 零错误（随 build 通过） |
| 回归检查 | ✅ 无回归 |
| **Overall** | **✅ READY FOR REVIEW** |

### 超时保护说明

macOS 未安装 GNU coreutils，`timeout` 命令不可用，`gtimeout` 亦不可用。所有验证命令直接执行，无超时包装。实际各命令耗时：node --test ≈ 1.7s，build ≈ 10s，repo:check ≈ 2s，release:check ≈ 1s，vitest ≈ 42s，均远低于默认 300s 阈值，无超时风险。

### 需要修复的问题

无。

### 工具使用反馈（Dogfooding）

- MCP 状态：本次验证为只读工具链验证，未调用 Spectra MCP（无 blast radius 需求）。
- Spec Driver 流程：fix 模式 4a→4b→4c 流程顺畅；tasks.md 结构清晰，验证可直接对照 checkbox。
- 返回信息充分性：fix-report.md 5-Why 根因分析充分，减少了验证阶段的猜测。
- 无异常或缺口。
