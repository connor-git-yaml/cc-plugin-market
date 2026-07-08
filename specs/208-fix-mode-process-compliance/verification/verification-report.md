# F208 验证报告 — fix 模式流程依从性结构化保障

**日期**: 2026-07-09 | **执行**: 主编排器（T014/T026/T027/T029-T034）+ implement 子代理（批 1/批 2 单测证据）
**版本**: spec-driver 4.2.2 → 4.3.0（minor，release-contract 已 sync）

## 1. 单元/集成测试（SC-005 + Tests FIRST 证据）

| 套件 | 结果 | 说明 |
|------|------|------|
| `node --test "plugins/spec-driver/tests/**/*.test.mjs"` | **439 pass / 0 fail** | 批 1 新增 62（core 39 + io 21 + adoption 2）；批 2 新增至 435；主编排器复核处置再 +4（FR-013 loud ×2 + FR-015 off 短路 ×2） |
| `npx vitest run`（仓库全量） | **5067 passed / 0 failed**（428 files，4 skipped/18 skipped tests/21 todo） | npm ci 修复 `@sqlite.org/sqlite-wasm` 缺包后全绿；本 feature 改动零回归 |
| Tests FIRST | T005/T008/T011 均先红（实现缺失 import 失败 / ERR_MODULE_NOT_FOUND）后绿 | 批 1/批 2 执行摘要留证 |

## 2. 手工验证记录（T014 + T027，脚本 scratchpad/manual-verify-208.sh，16/16 PASS）

沙箱隔离（mktemp），关键断言与实测输出：

| 场景 | 期望 | 实测 |
|------|------|------|
| `--mode report`（collapsed） | exit 0 + verdict JSON + 零落盘 | ✅ `{"fixSession":true,"compliant":false,"missing":["feature-dir","fix-report.md"],...}` |
| 场景 A：transcript 缺失 | exit 0（FR-013 fail-open） | ✅ 且落盘 `compliant:null` + `transcript-unavailable` 诊断事件（loud 半边） |
| 场景 B：collapsed 阻断 | exit 2 + `[FIX-COMPLIANCE]` 前缀 + 双路径指引 | ✅ |
| compliant 修复收口 | exit 0 静默 | ✅（首轮 FAIL 系沙箱制品正文 ≤20 字符被 FR-012a 判占位空壳——**判定器按合同工作**，换真实长度制品后 PASS） |
| 同 sid ×4 有界化 | 1/2 次 exit 2；第 3 次 exit 0 + `[GATE-DEGRADED]`；第 4 次幂等 | ✅ `workflow-run-summary` 终态恰 1 条（`complianceVerdict.degraded:true`），第 4 次未重复（degradedRecorded 幂等）；verdict 审计事件 6 条 |
| warn 档 | exit 0 + `[FIX-COMPLIANCE][WARN]` + 同口径落盘 | ✅ |
| off 档 | exit 0 + 零输出 + 零新增落盘 | ✅（另有单测证明 off 短路先于 transcript 读取：off + 目录型 transcript_path 零事件） |
| 双 Stop hook 并存（Edge Case） | 既有 `[提醒]` 行为不变 + 前缀可区分 | ✅ `stop-task-check.sh` 输出 `[提醒] 未完成任务: 000-demo(1)` exit 0；新 hook 经薄壳 exit 2 + `[FIX-COMPLIANCE]` |
| 非 fix 会话经薄壳 | 零接触（US5） | ✅ exit 0 零输出零落盘 |

## 3. Headless E2E spike 记录（T029，真实凭据 haiku，插件副本 + --plugin-dir）

- **compliant 对照**（非 fix 会话）：exit 0，stderr 无 `[FIX-COMPLIANCE]`，零接触，9.4s。
- **collapsed 场景**：255s 多轮闭环后 exit 0——haiku 首答"已修复"被 Stop hook 阻断，收到 `[FIX-COMPLIANCE]` 反馈后**按双路径指引选择路径 B 真实补救**：创建 `specs/001-fix-compliance-check/` + 写入含 `## 判定依据` 章节的 fix-report.md + 委派 verify 子代理交叉核实 → 判定器验实后合规放行。最终消息逐条复述反馈文本结构 = reason 驱动补救行为的因果证据。**阻断-反馈-补救-放行完整闭环在与评测同构环境实锤**（harness-verification 实锤 3 的真实模型版）。
- spike 脚本幂等挂载修复：T026 之后源码 hooks.json 已自带条目，重复追加会双挂双计数（主编排器修复，含判重）。

## 4. 性能基准（T030，C-003 / SC-003）

`--mode report` 全链（含 node 进程启动），N=20：

| 样本 | 尺寸 | p50 | p95 | max |
|------|------|-----|-----|-----|
| 真实合规 fix 会话 transcript（F206 V009 r1） | 0.24MB | 24.7ms | **26.3ms** | 28.9ms |
| 同目录最大非 fix 会话（最坏样本） | 7.61MB | 41.8ms | **42.4ms** | 42.6ms |

p95 < 100ms 目标达成（余量 2.4-3.8×）；`MAX_TRANSCRIPT_BYTES=20MB` 维持（实测 fix 会话 ≤0.31MB）。

## 5. 静态安全审查（T031，C-001/C-002/C-003/FR-011）

- **C-003**：judge/core/io 三文件及 import 链零 `Task(`/LLM/网络/child_process 命中；import 链 = node 内置 + simple-yaml + record-workflow-run + core/io（全零依赖）。
- **C-001**：`git diff` 证实 `scripts/eval-*.mjs`、仓库根 `scripts/lib/**`、`tests/baseline/**` 零触碰。
- **C-002**：手写源码改动全部落 `plugins/spec-driver/**` + `specs/208-*/` + `contracts/release-contract.yaml`（版本合同 canonical source，T033 授权动作）；`.codex/skills/**`、`specs/products/**/_generated/**`、README 受控行等均为 `repo:sync`/`release:sync` 管道派生（tasks C-3 处置口径），未手改。
- **FR-011**：core 判据零任务 ID/任务描述文本读取（委派 description 的角色分类属 FR-012b 机制，非任务文本判据）。

## 6. 合同一致性

- `npm run repo:check` → exit 0（含 delegation-contract / wrapper body-sha256 / release-contract 全链）
- `npm run release:check` → exit 0（4.3.0 已同步 plugin.json / README / postinstall / marketplace / product-mapping）
- `npm run build` → exit 0

## 7. SC 对照

| SC | 结论 | 证据 |
|----|------|------|
| SC-001 坍塌不再静默通过 | ✅（机制层） | collapsed fixture/沙箱/E2E spike 全部被拦截或降级标注；评测批量口径待慢验（goal-prompt-r3 协议） |
| SC-002 硬性层：无降级标注静默通过 = 0 | ✅（机制层） | 439 单测 + 16 手工断言零静默通过路径；统计层（≤5%）待慢验批量 |
| SC-003 p95<100ms + 零 LLM/委派 | ✅ | §4 基准 + §5 静态审查 |
| SC-004 诚实 no-op 一次合规收口 | ✅ | compliant-noop fixture 单测 + E2E spike 路径 B 实录 |
| SC-005 vitest 全量零失败 | ✅ | §1 |

## 8. 残余风险（已明示接受）

- 委派内容与结论的深层相关性校验属 FR-009 可选范畴（contracts/no-op-report-template.md 记录）。
- 主动 sabotage 状态存储（chmod + tmpdir 占位）可诱导降级放行，但降级带 `[GATE-DEGRADED]` + `state-storage-unavailable` loud 标注且 sabotage 动作本身留在 transcript 可审计；F206 威胁模型为"遗弃/偷懒"非主动破坏。
- exit 2 阻断 + stderr 回注语义依赖当前 Claude Code CLI 行为（harness-verification 外推边界），E2E spike 脚本留作升级回归护栏。
