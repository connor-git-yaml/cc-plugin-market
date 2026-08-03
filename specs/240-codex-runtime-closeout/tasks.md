---
feature: 240-codex-runtime-closeout
title: Codex Runtime Closeout 任务分解（M9 轨道 A3 + A4）
status: draft
revision: rev2
created: 2026-08-03
revised: 2026-08-03
plan_basis: specs/240-codex-runtime-closeout/plan.md（rev2）
spec_basis: specs/240-codex-runtime-closeout/spec.md
grounding_basis: specs/240-codex-runtime-closeout/_grounding.md（§8/§9 最高权威）
---

# Feature 240 任务分解

> **阅读顺序约定**：本任务分解严格对齐 `plan.md`（rev2）的 Phase 划分与**交付轮次**划分。
>
> **决策四（用户拍板）**：**R1 轮先完整交付 A4 并通过全量门禁；R2 轮在同一分支随后交付 A3**。二者仍属同一 feature，但**交付时点与验收状态分离**（plan §10.1）。
>
> **A3 批次（FR-001/002/003/004/005/011 → SC-001~SC-008）与 A4 批次（FR-006/007/008/009/010/012/013 → SC-009~SC-015）各自独立验收，禁止用一侧完成度代替另一侧**（用户硬约束，spec §1.1）。
>
> **任务编号纪律（rev2）**：**保留原编号，不重排**。被决策三 / W1 废止的任务**保留编号并显式标注「已废止」+ 理由**，不删号、不复用号。新增任务从 **T064** 起顺延。
>
> **前置实测硬约束**：Phase 0 的实测项 **MUST** 先于任何依赖其结论的断言编写任务完成；违反此顺序视为分解缺陷。**M5 已随决策三废止**（T005）。
>
> 🔴 **全量门禁命令统一为 `npm test`**（实读 `package.json:23`：`"test": "vitest run && npm run test:plugins"`）。**禁止**用 `npx vitest run` 代替 —— 它会完整漏掉 `plugins/spec-driver/tests/**/*.test.mjs`，而本 feature 要改的判定链恰好只被这批 `.mjs` 测试覆盖（plan §11 W3）。

---

## 1. 任务总览

### 交付轮次 R1 —— A4 先行

#### Phase 0-A4 — A4 侧前置实测与基线（阻塞下游）

| 任务号 | 标题 | 轮次/批次 | 并行 | 依赖 | 对应 FR/SC |
|---|---|---|---|---|---|
| T003 | M3：hook 信任状态探测手段一手实测（M3-a/b/c） | R1 / A4 | [P] | 无 | FR-009 / SC-013 |
| T004 | M4：Codex active plugin 标记 5 类排查点一手实测 | R1 / A4 | [P] | 无 | FR-008(5) / SC-012 |
| T006 | M6：`codex doctor` 对非法/不存在/相对路径 `CODEX_HOME` 的行为一手实测 | R1 / A4 | [P] | 无 | FR-006 / SC-009 |
| **T064** | **【rev2 新增·W3】现场记录测试基线**：分别跑一次 `npx vitest run <护栏1的5文件>` 与 `npm run test:plugins`，把 **files / tests 数字原样记入 `verification-report.md`**，作为「只增不减」的对照基线 | R1 / 共通 | [P] | 无 | plan §11 护栏 1 / 1b |

#### Phase A — A4-1：`resolveCodexHome` 与消费点迁移

| 任务号 | 标题 | 轮次/批次 | 并行 | 依赖 | 对应 FR/SC |
|---|---|---|---|---|---|
| T007 | 测试先行：`tests/unit/codex-home.test.ts`（SC-009 九项边界矩阵 + fail-loud 断言） | R1 / A4 | [P] | T006 | FR-006 / SC-009 |
| T008 | 实现：`src/core/codex-home.ts`（`resolveCodexHome` + `resolveCodexHomeFromProcess`） | R1 / A4 | [S] | T007 | FR-006 / SC-009 |
| T009 | 测试先行：`tests/unit/codex-home-shell.test.ts`（shell 侧九项 + `bash -n` + 对拍） | R1 / A4 | [P] | T006 | FR-006 / SC-009 |
| T010 | 实现：`plugins/spec-driver/scripts/lib/codex-home.sh`（`resolve_codex_home` 对拍实现） | R1 / A4 | [S] | T008, T009 | FR-006 / SC-009 |
| T011 | 测试先行：`tests/unit/codex-home-scope-boundary.test.ts`（SC-011 四个 MUST NOT 改路径负向） | R1 / A4 | [P] | 无 | FR-007(1) / SC-011 |
| T012 | 实现：A4② 消费点迁移（`skill-installer.ts`/`auth-detector.ts`/`postinstall.ts`/`preuninstall.ts`/`codex-skills.sh` global 分支） | R1 / A4 | [S] | T008, T010, T011 | FR-007(1) / SC-011 |
| T013 | 测试迁移（加不改）：四个现有测试文件，git diff 复核原断言未删改 | R1 / A4 | [S] | T012 | FR-007(3) / SC-010 |
| T014 | `extract-wrapper-body.mjs:82` 文案改动 + `npm run repo:sync` 重生 wrapper sha + `repo:check` 复核 | R1 / A4 | [S] | T012 | FR-007(2) / SC-018 |
| T015 | SC-021 否定项证明：worktree cache 全局 `~/.codex` 拼接点扫描并记录 `verification-report.md` | R1 / A4 | [P] | 无 | FR-007(4) / SC-021 |

#### Phase D — A4-2：四方一致性诊断 CLI + FR-010 文档落点

| 任务号 | 标题 | 轮次/批次 | 并行 | 依赖 | 对应 FR/SC |
|---|---|---|---|---|---|
| T044 | 测试先行：`tests/unit/codex-runtime-doctor.test.ts`（SC-012 四真值表 + 退出码 4 行 + 产品分组矩阵 + `marketplace.metadata.version` 排除 + 版本归一化 + `probedSources.length===5`） | R1 / A4 | [P] | T004 | FR-008 / SC-012 |
| T045 | 实现：`lib/codex-runtime-doctor-core.mjs`（四方比较矩阵 / `aggregateOverallStatus` / `normalizeVersion` / `PLUGIN_BUILD_PROBES` 5 探针） | R1 / A4 | [S] | T044 | FR-008 / SC-012 |
| T046 | 🔁 **rev2 重写（C5）** 测试先行：`tests/unit/codex-runtime-doctor-redaction.test.ts`（**9 注入点 × 4 输出通道 × 4 编码** + typed schema 静态断言 + 「禁止保存原始输出」守卫） | R1 / A4 | [P] | 无 | FR-012 / SC-014 |
| T047 | 🔁 **rev2 重写（C5）** 实现：**值级 typed schema 脱敏**（`DETAILS_SCHEMA` 键→类型映射 + 7 种受约束类型 + `sanitizeDetails` + `createCheck` 唯一出口 + `buildSummary`/`buildRemediation` 模板构造器 + 顶层错误只输出 `errorClass`） | R1 / A4 | [S] | T046 | FR-012 / SC-014 |
| T048 | 🔁 **rev2 微调（W2）** 实现：hook-trust check（三情形固定状态值 + `hooks.json` 不存在→`not-applicable`；`--dangerously-bypass-hook-trust` **五处零命中**门禁） | R1 / A4 | [S] | T003, T045, T047 | FR-009 / SC-012 |
| T049 | 实现：`codex-runtime-doctor.mjs` CLI 编排层（`--project-root`/`--format`/`--strict`，退出码真值表） | R1 / A4 | [S] | T045, T047, T048 | FR-008(4) / SC-012 |
| T050 | 测试先行 + 实现：`check-codex-inventory.mjs`（`codex mcp list` + plugin inventory，两种失败可区分退出码 3/4） | R1 / A4 | [S] | T004 | FR-013 / SC-022 |
| T051 | 测试先行 + 实现：SC-015 `--strict` 漂移可机械捕获（构造漂移 fixture） | R1 / A4 | [S] | T049 | FR-008(3)(4) / SC-015 |
| **T065** | **【rev2 新增·W2】FR-010 文档落点与断言**：README Codex 安装块 `Notes:` 追加两条 bullet + `codex-skills.sh:248` 后追加 hook 信任提示 + 新增 `tests/unit/codex-hook-trust-docs.test.ts` 三条断言 + 实测 `repo:check` 复核 | R1 / A4 | [S] | T012, T048 | FR-010 / plan §8.9 |

#### R1 交付门禁

| 任务号 | 标题 | 轮次/批次 | 并行 | 依赖 | 对应 FR/SC |
|---|---|---|---|---|---|
| **T066** | **【rev2 新增·决策四】R1 轮全量门禁与交付报告**：`npm test && npm run build && npm run repo:check && npm run release:check` 四条零失败；交付报告标注「A4 已交付、**A3 尚未交付**」，禁止声称 feature 完成 / 轨道 A 收口 | R1 / A4 | [S] | T013, T014, T015, T049, T050, T051, T065 | SC-009~SC-015 / SC-023（R1 轮） |

---

### 交付轮次 R2 —— A3 随后追上

#### Phase 0-A3 — A3 侧前置实测（经 capture-only 采证）

| 任务号 | 标题 | 轮次/批次 | 并行 | 依赖 | 对应 FR/SC |
|---|---|---|---|---|---|
| T001 | 🔁 **rev2 调整（W4）** M1：`exit 2` 真实阻断一手实测 —— **MUST 经 `run-e2e.sh --path block --capture-only` 执行**，产出可复用的 per-path 证据 | R2 / A3 | [P] | T052（harness 骨架）、T067（证据 schema） | FR-003 / SC-004 |
| T002 | 🔁 **rev2 调整（W4）** M2：failure-degrade 观察矩阵 6 行一手实测 —— 同样经 `--capture-only` 执行并落证据 | R2 / A3 | [P] | T052, T067 | FR-003 / SC-005 |
| ~~T005~~ | ❌ **已废止（决策三）** M5：会话/轮次标识可得性一手实测 | — | — | — | — |

#### Phase B — A3-1：生成器 / 两层门禁 / 合并写入器 / stop hook 三层链

| 任务号 | 标题 | 轮次/批次 | 并行 | 依赖 | 对应 FR/SC |
|---|---|---|---|---|---|
| T016 | 🔁 **rev2 重写（C4）** 测试先行：`tests/unit/codex-hooks-event-gate.test.ts`（**产品层只约束 owned 条目**；第三方 `PermissionRequest` 条目保留用例；未知事件名 → `warning` 非 `fail`；三处校验对象各自用例） | R2 / A3 | [P] | 无 | FR-002 / SC-002 |
| T017 | 🔁 **rev2 重写（C4）** 实现：`lib/codex-hooks-schema.mjs`（schema 层 10 事件合法性 + **产品层作用域限定为 `isOwnedEntry` 条目**，失败 code 可区分） | R2 / A3 | [S] | T016 | FR-002 / SC-002 |
| T018 | 测试先行：生成器行为用例（Worktree 系列过滤 + 绝对路径展开 + `${CLAUDE_PLUGIN_ROOT}` 不残留） | R2 / A3 | [P] | 无 | FR-001 / FR-005 / SC-001 |
| T019 | 实现：`lib/codex-hooks-generator.mjs`（从 canonical `hooks.json` 派生，不新建并列文件） | R2 / A3 | [S] | T017, T018 | FR-001 / FR-005 / SC-001 |
| T020 | 测试先行：`tests/unit/codex-hooks-installer.test.ts`（SC-008 七语义 (a)~(g) + `isOwnedEntry` 三条负向） | R2 / A3 | [P] | 无 | FR-011 / SC-008 |
| T021 | 实现：`lib/codex-hooks-installer.mjs`（合并写入 + `isOwnedEntry` + 本地 `writeJsonAtomic`） | R2 / A3 | [S] | T020 | FR-011 / SC-008 |
| T022 | 测试先行：`tests/unit/hook-installer-semantics-parity.test.ts`（七语义合同表，双 installer 对跑） | R2 / A3 | [P] | 无 | FR-011 / SC-008 |
| T023 | 实现：parity 薄适配器（暴露 `install/remove/readTarget` 供两侧共用测试消费） | R2 / A3 | [S] | T021, T022 | FR-011 / SC-008 |
| T024 | 🔁 **rev2 调整（C4）** 实现：`validate-codex-hooks.mjs` CLI（`--target` + `--format json`；对**已合并第三方数据**的最终文件只按 owned 作用域判定，并断言第三方条目逐字节保留） | R2 / A3 | [S] | T017, T019 | FR-002 / SC-001 / SC-002 |
| T025 | 实现：`install-codex-hooks.mjs` CLI + `codex-skills.sh --global` 末尾挂接（安装成功时打印 FR-010 提示） | R2 / A3 | [S] | T021, T012, T065 | FR-011 / FR-010 / SC-008 |
| ~~T026~~ | ❌ **已废止（W1）** 测试先行：`pre-tool-use-guard.sh`/`post-tool-use-format.sh` 的 `tool_name` 结构性早退用例 | — | — | — | — |
| ~~T027~~ | ❌ **已废止（W1）** 实现：两脚本结构性早退 | — | — | — | — |
| T028 | 🔁 **rev2 强化（W3/护栏 1c）** 实现：`stop-fix-compliance-check.sh` 三级 `PLUGIN_ROOT`→`CLAUDE_PLUGIN_ROOT`→`BASH_SOURCE` fallback 扩展；🔴 **该脚本全仓零测试覆盖，本任务 MUST 同批新增 shell 用例**（三种环境变量组合各一条断言） | R2 / A3 | [S] | 无 | FR-005 / SC-001 |
| T029 | 🔁 **rev2 追加一题（C4）** **FR-011 独立对抗审查**（`codex:codex-rescue`，**8 道**对抗题面，见 plan §6.7） | R2 / A3 | [S] | T021, T023, T024, T025 单测全绿 | FR-011 |

**T026 / T027 废止理由（W1）**：rev1 用「Codex 的 `tool_input.command` 里若含 `"file_path"` 字样会被无 jq 降级的 grep 误抓」作为修改这两个 **Claude 共用脚本**的理由。该前提**已被编排器实跑证伪** —— `tool_input.command` 是 JSON 字符串，命令内的引号被序列化为 `\"`，grep 模式 `"file_path"` 无法命中（构造含 `{"file_path": "src/x.ts"}` 的命令喂入脚本 → 退出码 0）。前提不成立 ⇒ 改动**无收益且平白扩大 Claude 侧回归面**（两脚本全仓零测试覆盖，改了没有任何回归防线）。故从本 feature 整体移除。**继续遵守 `_grounding.md` §9.4：禁止在本轮修 `.file_path` → `.tool_input.file_path`**（见 §5 明令禁止项 1）。

#### Phase C — A3-2：FR-004 transcript 方言识别与 loud 诊断

| 任务号 | 标题 | 轮次/批次 | 并行 | 依赖 | 对应 FR/SC |
|---|---|---|---|---|---|
| T030 | 🔁 **rev2 重写（决策三）** 测试先行：扩展 `plugins/spec-driver/tests/fix-compliance-core.test.mjs` —— `detectTranscriptDialect` 四结果矩阵（`claude`/`codex-rollout`/`unknown`/`empty`）+ 🔴 **「禁止用非 fix 反推方言」负向用例**（正常 Claude 非 fix transcript MUST 判 `claude`） | R2 / A3 | [P] | 无（**不再依赖 M5**） | FR-004 / SC-007 |
| T031 | 🔁 **rev2 重写（决策三）** 实现：`lib/fix-compliance-core.mjs` 新增 `detectTranscriptDialect` + `CLAUDE_TRANSCRIPT_ROLES` / `CODEX_ROLLOUT_ROLES` 常量（≈25 行纯函数，零 I/O、零新增 import） | R2 / A3 | [S] | T030 | FR-004 / SC-007 |
| T032 | 🔁 **rev2 重写（实读更正）** 门禁**复核**（非变更）：跑 `judge-file-set-guard.test.mjs` + `judge-snapshot-core.test.mjs`，确认 `JUDGE_FILE_SET` **保持 6 项不变**（实读 `judge-snapshot-core.mjs:16-23` 已含 `scripts/lib/fix-compliance-core.mjs`）。**若变为 7 项即说明实现违反「不新建模块 / 不新增 import」约束，须回查而非改清单** | R2 / A3 | [S] | T031 | plan §3.3 / SC-017 |
| T033 | 🔁 **rev2 重写（决策三）** 测试先行：扩展 `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` —— **I1/I2/I3 三条不变量**（退出码恒 0 / Claude fixture 落盘逐字节等价于钉死基线 / Claude 非 fix 会话零落盘） | R2 / A3 | [P] | 无 | FR-004(5) / SC-007 |
| ~~T034~~ | ❌ **已废止（决策三）** 静态守卫用例：`crossCheckTranscript` 返回值无否决权 —— rev2 已无 `crossCheckTranscript` | — | — | — | — |
| T035 | 🔁 **rev2 重写（决策三）** 实现：`fix-compliance-judge.mjs` 的 `evaluate()` `!isFix` 分支接线（≤ 8 行；本文件净增 ≤ 10 行）；🔴 **函数签名逐字不变、`runHook` L406-409 逐字不变、`releaseDegraded` 逐字不变** | R2 / A3 | [S] | T031, T033 | FR-004(2) / SC-007 |
| T036 | 🔁 **rev2 收窄** 测试先行：扩展 `plugins/spec-driver/tests/fix-compliance-io.test.mjs` —— `readHookPayload` 放宽 `transcript_path`（两种 payload 形态；`session_id` 仍必需；类型非法仍判 `payload-invalid`） | R2 / A3 | [P] | 无 | FR-004(4) |
| T037 | 🔁 **rev2 收窄** 实现：`lib/fix-compliance-io.mjs:43-45` 放宽 `transcript_path` 必需性 + 新诊断码 `transcript-path-absent`（与 `transcript-unavailable`/`payload-invalid` 三者语义可区分） | R2 / A3 | [S] | T036, T035 | FR-004(4) |
| ~~T038~~ | ❌ **已废止（决策三）** 测试先行：`record-workflow-run.mjs` 新 flag 逐字节向后兼容 | — | — | — | — |
| ~~T039~~ | ❌ **已废止（决策三）** 实现：`record-workflow-run.mjs` 新增 `--session-id`/`--turn-id` | — | — | — | — |
| ~~T040~~ | ❌ **已废止（决策三）** 合同修订：`record-workflow-run-fields.md` 追记两条修订说明 | — | — | — | — |
| ~~T041~~ | ❌ **已废止（决策三）** 守卫测试：全仓 `complianceVerdict` 写入点恒为 1 | — | — | — | — |
| ~~T042~~ | ❌ **已废止（决策三）** 条件任务：5 处 SKILL.md 追加 `--session-id` | — | — | — | — |
| T043 | 🔁 **rev2 重写题面（决策三）** **FR-004 独立对抗审查**（`codex:codex-rescue`，**6 道**新题面，见 plan §5.4，与 FR-011 审查分开委派） | R2 / A3 | [S] | T031, T035, T037 单测全绿 + SC-007 全矩阵 + I1~I5 通过 | FR-004 |

**T038~T042 / T034 / T005 废止理由（决策三）**：rev1 的 FR-004 方案是「把 `.specify/runs/*.jsonl` 的 `workflow-run-summary` 拿来当主信号，夺回 Codex 下的合规判定能力」。该方案已被**编排器实测 + Codex 审查双重证伪**：(a) 编排器写的正常 `workflow-run-summary` **没有任何合规判定字段**（可用字段仅 `workflowId/runId/result/startedAt/finishedAt/durationMs/rerun/rerunPhase/completedPhases/phaseDurations/gatePauses/verificationFailures/artifacts/warnings`），排除带 `complianceVerdict` 的记录后剩下的**无合规信息可读**；(b) `.specify/runs/` 是判定进程自身可读写删的普通文件，**不构成可信安全边界**，Codex 已构造出可主动触发的绕过（破坏该文件 → 主信号失效 → Codex transcript 必然不可判定 → exit 0）。故整个「换主信号源」链路（含关联键写入、SKILL.md 改动、合同修订、写入方守卫、M5 实测与 α/β 分支）全部作废。

#### Phase E — 共通收口：E2E 与全量复验

| 任务号 | 标题 | 轮次/批次 | 并行 | 依赖 | 对应 FR/SC |
|---|---|---|---|---|---|
| **T067** | **【rev2 新增·W4】per-path 证据 schema 与 `sourceHash` 实现**：`evidence/<path>-<runId>.json` 原子写（tmp+rename，从不覆盖）；字段 `path/mode/success/payloadHash/sourceHash/runId/codexVersion/timestamp/skipReason`；`sourceHash` = 对被测源码集合的有序 sha256；提供 `--capture-only` 模式（无断言采集） | R2 / 共通 | [S] | 无 | plan §9.6 / SC-003~006 |
| T052 | 🔁 **rev2 调整（W4）** E2E harness 骨架搭建：`run-e2e.sh`（`--path allow\|block\|failure-degrade\|stop [--live] [--capture-only]`）+ `lib/setup-codex-home.sh` + `lib/probe-hook.sh` + `lib/blocker-hook.sh` + `lib/degrade-hooks/` + `evidence/` + `recorded/` | R2 / 共通 | [S] | T019, T025, T067 | plan §9.1 / SC-003~006 |
| T053 | 🔁 **rev2 调整（W4）** SC-003 allow 路径 live E2E（`--path allow --live`，真实 turn） | R2 / 共通 | [S] | T052 | FR-003 / SC-003 |
| T054 | 🔁 **rev2 调整（W4）** SC-004 block 路径 live E2E（消费 T001 实测结论编写断言） | R2 / 共通 | [S] | T052, T001 | FR-003 / SC-004 |
| T055 | 🔁 **rev2 调整（W4）** SC-005 failure-degrade live E2E（消费 T002 回填的观察矩阵） | R2 / 共通 | [S] | T052, T002 | FR-003 / SC-005 |
| T056 | 🔁 **rev2 调整（W4）** SC-006 stop 路径 live E2E（与 allow 同 turn 捕获；反向 grep 验证无 `tool_name` 断言） | R2 / 共通 | [S] | T052, T053 | FR-003 / SC-006 |
| T057 | 🔁 **rev2 调整（W1）** SC-016 双运行时 provenance meta 测试（两侧断言集合互不为子集；新增 transcript 方言维度） | R2 / 共通 | [S] | T053, T031 | plan §9.5 / SC-016 |
| T058 | 🔁 **rev2 调整** SC-017/018/019/020 回归护栏批量验证（F239 第 14/15 族、F238 wrapper/字面量门禁、评测链未触碰、`.codex` 硬编码点归类复核） | R2 / 共通 | [S] | T014, T032, T035 | plan §11 护栏 4/5/7/8 |
| T059 | SC-022 inventory 机械确认实跑一次并记录输出 | R2 / 共通 | [S] | T050 | FR-013 / SC-022 |
| T060 | 🔁 **rev2 重写（W3 + 决策四）** SC-023 全量验证：**`npm test && npm run build && npm run repo:check && npm run release:check`** 四条零失败；🔴 **同时重跑 T066 的 R1 全部门禁**，确认 A3 改动未打回 A4 | R2 / 共通 | [S] | T057, T058, T059 | SC-023 |
| T061 | 🔁 **rev2 调整** 交付报告撰写：A3/A4 分侧达标结论 + **FR-004 范围声明原样复述**（可观测性改进、非安全强度改进）+ 两项人工验证挂账清单 + 工具使用反馈 | R2 / 共通 | [S] | T060 | spec §1.1 / plan §5 |

### MANUAL-PENDING（不阻塞交付，须挂账）

| 任务号 | 标题 | 轮次/批次 | 依赖 | 对应 SC |
|---|---|---|---|---|
| T062 | `[MANUAL-PENDING]` SC-013 hook 信任状态迁移人工验证（`untrusted→trusted`/`modified`/remediation 有效性三段） | R1 / A4 | T048（代码就绪） | SC-013 |
| T063 | `[MANUAL-PENDING]` SC-024 F239 T039 Codex 桌面客户端 managed worktree 文件同步人工验证 | 共通 | 无（独立于本 feature 代码） | SC-024 |

---

## 2. 各 Phase 任务详情

### Phase 0-A4：A4 侧前置实测与基线（R1）

**T003 — M3：hook 信任状态探测手段一手实测**
- 目标：按 plan §8.5 优先级顺序实测 M3-a（app-server RPC `hooks/list`）→ M3-b（完成一次真实信任授予后 diff `CODEX_HOME` 全目录定位信任记录落点）→ M3-c（`$CODEX_HOME/.codex-global-state.json` 字段集）。
- 验收方式：确定实际可用的探测手段优先级，写入 plan §8.5 表「前置实测」列。
- 注意事项：**本任务未完成前，禁止在 T048 中写死具体探测路径**；全部不可行则 `status: indeterminate`。M3-a 可能消耗 1 次真实 turn（已计入 plan §9.2 配额账）。

**T004 — M4：Codex active plugin 标记 5 类排查点一手实测**
- 目标：逐一执行 plan §4 消解 #3 列出的 5 类排查点，记录每项 `outcome ∈ found|absent|error|not-executable`。
- 验收方式：`PLUGIN_BUILD_PROBES` 常量的 5 项 id 与实测结果一一对应，写入 T044/T045。
- 注意事项：**本任务未完成前，禁止在 T044 编写 `probedSources` 断言**；全部非 `found` 才允许落 `indeterminate`。**rev2（C5）**：探测结果结构中**禁止携带自由文本**，错误细节归约为 `errorClass` 枚举。

**T006 — M6：`codex doctor` 对非法 `CODEX_HOME` 行为一手实测**
- 目标：分别测试 `CODEX_HOME` 为「不存在的路径」与「相对路径」时官方 `codex doctor` 的实际行为（是否 normalize、是否报错）。
- 验收方式：结论写入 T007 测试用例注释与 `verification-report.md`（**不修改 spec 正文**，spec 为只读制品）。
- 注意事项：**本任务未完成前，禁止在 T007 中声称「与 doctor 对齐」**。

**T064 — 【rev2 新增·W3】现场记录测试基线**
- 目标：在**任何代码改动之前**分别执行并原样记录输出摘要：
  1. `npx vitest run tests/unit/hook-installer.test.ts tests/unit/git-hook-installer.test.ts tests/unit/worktree-lifecycle-hook.test.ts tests/unit/auth-detector.test.ts tests/unit/skill-installer.test.ts`（编排器先前实跑基线：**5 files / 69 tests**，本轮须复核该数字仍成立）
  2. `npm run test:plugins`（覆盖 `plugins/spec-driver/tests/**/*.test.mjs`，含本 feature 要改的 `fix-compliance-judge-cli.test.mjs` / `fix-compliance-io.test.mjs` / `fix-compliance-core.test.mjs` / `record-workflow-run.test.mjs` / `judge-file-set-guard.test.mjs` / `judge-snapshot-core.test.mjs` —— 六个文件均已实读确认存在）
- 验收方式：两组 files / tests 数字写入 `verification-report.md`，作为「只增不减」对照基线。
- 注意事项：🔴 **禁止**沿用任何未实测数字；🔴 **禁止**只跑 `npx vitest run` 就当作全量基线。

---

### Phase A：A4-1 `resolveCodexHome` 与消费点迁移（R1）

**T007 — 测试先行：`tests/unit/codex-home.test.ts`**
- 目标：覆盖 SC-009 九项边界矩阵（unset/空串/绝对路径/相对路径/尾部斜杠/含空格/symlink/不存在路径/无权限目录）；`deps` 必填 fail-loud；静态 grep 断言函数体内无 `process.env`/`os.homedir()`。
- 验收方式：先红（无实现）。
- 注意事项：相对路径与不存在路径两行需引用 T006 结论，标注是否为「我方自定义语义」。

**T008 — 实现：`src/core/codex-home.ts`**
- 目标：`resolveCodexHome(deps: {env, homedir})` 纯函数 + `resolveCodexHomeFromProcess()` 全仓唯一环境读取点。
- 验收方式：T007 转绿。
- 注意事项：`deps` 非法时 `throw new TypeError`；不得给 `deps` 加默认值。

**T009 — 测试先行：`tests/unit/codex-home-shell.test.ts`**
- 目标：shell 侧同九项边界 + `bash -n` 语法检查 + 含空格路径实跑用例。
- 验收方式：先红。

**T010 — 实现：`plugins/spec-driver/scripts/lib/codex-home.sh`**
- 目标：`resolve_codex_home`（两参数必传）+ `resolve_codex_home_from_env`；**新增 Node/shell 逐字节对拍测试**（九项输入两侧输出相等）。
- 验收方式：T009 转绿 + 对拍测试通过。
- 注意事项：所有路径引用加双引号；拼接用 `"${base%/}/skills"`。

**T011 — 测试先行：`tests/unit/codex-home-scope-boundary.test.ts`**
- 目标：SC-011 负向回归——设置自定义 `CODEX_HOME` 时，`skill-installer.ts:171`（project 分支）、`validate-orchestrator-models.mjs:84`、`sync-delegation-contract.mjs:60`、`codex-skills.sh:66`（project 模式）四处解析结果与未设置时逐字节相同。
- 验收方式：本测试是**防止未来引入回归**的钉死断言，Phase A 未触碰这些点时先绿属正常。

**T012 — 实现：A4② 消费点迁移**
- 目标：按 plan §7.3「MUST 改」清单逐项落地——`auth-detector.ts:126`、`skill-installer.ts:167-169`（**仅 `mode==='global' && platform==='codex'`**）+ `260-276` 展示路径、`postinstall.ts:28,70`、`preuninstall.ts:61` 展示文案、`codex-skills.sh:23,57` global 分支走 helper。
- 验收方式：T011 保持绿；新增用例覆盖 MUST 改清单的自定义 `CODEX_HOME` 场景；`codex-skills.sh:233` sidecar 自动跟随须显式断言。
- 注意事项：🔴 `skill-installer.ts:171` project 分支**逐字不变**；`codex-skills.sh:66` project 分支**逐字不变**。

**T013 — 测试迁移（加不改）**
- 目标：`skill-installer.test.ts:239`/`auth-detector.test.ts:175`/`spec-driver-codex-skills.test.ts:358,395`/`feature-213-codex-plugin-install.e2e.test.ts:73` 各**保留**原默认行为断言，**新增**自定义 `CODEX_HOME` 用例。
- 验收方式：`git diff master...HEAD -- <四文件> | grep '^-'` 人工逐条确认删除行不含默认行为断言，结果记入 `verification-report.md`（SC-010 硬性要求）。
- 注意事项：**禁止**机械改写掉原有断言（会失去「helper 是否破坏默认路径」的检测能力）。

**T014 — `extract-wrapper-body.mjs:82` 文案改动 + repo:sync**
- 目标：改文案为「`~/.codex/spec-driver-capability.md`（默认路径，实际以 `CODEX_HOME` 为准）」；按 plan §7.5 四步顺序执行。
- 验收方式：`npm run repo:check` 零失败（`spec-driver-wrappers` 与 `model-literal-gate` 均 `ok`）。
- 注意事项：只改 `~/.codex/...`（全局）文案，不改仓库内 `.codex/spec-driver-capability.md`（项目级路径）；源改动与再生产物**同一 commit**。

**T015 — SC-021 否定项证明**
- 目标：`rg -n "\.codex" scripts/sync-worktree-local-state.sh plugins/spec-driver/hooks/worktree-lifecycle.sh scripts/lib/worktree-local-state-core.mjs`，命中数须为 0。
- 验收方式：扫描命令与命中数原样写入 `verification-report.md`。
- 注意事项：若命中数非 0，**不得就地修改**（超出本 feature 范围），须记录为 follow-up 挂账。

---

### Phase D：A4-2 诊断 CLI 与 FR-010（R1）

**T044 — 测试先行：`tests/unit/codex-runtime-doctor.test.ts`**
- 目标：SC-012 全部断言——四真值表 4 行、退出码真值表 4 行（含 `--strict` 下 `fail→1`）、按产品分组比较矩阵、`marketplace.metadata.version` 排除断言、版本归一化断言、`probedSources.length===5` 且 id 集合恰等于 `PLUGIN_BUILD_PROBES`。
- 验收方式：先红。

**T045 — 实现：`lib/codex-runtime-doctor-core.mjs`**
- 目标：四方 × 两产品比较矩阵、`aggregateOverallStatus` 纯函数（逐行求值真值表）、`normalizeVersion`、`PLUGIN_BUILD_PROBES` 5 探针常量（消费 T004 结论）。
- 验收方式：T044 转绿；对全部状态组合的 property-style 测试（不变量：任一 check 非 ok/not-applicable 时 `overallStatus` MUST NOT 为 ok）。

**T046 — 【rev2 重写·C5】测试先行：`tests/unit/codex-runtime-doctor-redaction.test.ts`**
- 目标（SC-014，参数化）：
  - **9 个注入点**：`config.toml` / `auth.json` / 环境变量 / **子进程 stdout** / **子进程 stderr** / **RPC 错误对象** / **文件读取失败错误对象（含含 canary 的 path）** / `release-contract.yaml` 畸形字段 / `hooks.json` 第三方 `command` 字符串；
  - **4 个输出通道**：JSON 输出 / 文本输出 / **错误分支输出** / **`indeterminate` 分支输出**；
  - **4 种编码**：明文 / base64 / URL-encoded / `\u` JSON 转义；
  - 静态断言：`DETAILS_SCHEMA` 常量存在且被 `createCheck` 强制应用；实现中**不存在**内容特征黑名单；
  - **「禁止保存原始输出」守卫**：源码文本断言 `err.message` / `err.stack` / `.stdout` / `.stderr` 从未出现在 `createCheck(` 实参、`summary` 赋值、`JSON.stringify` 参数位置。
- 验收方式：先红。
- 注意事项：🔴 rev1 只覆盖 3 个注入点且只做键名 allowlist，**已被 Codex 判为不足**；本任务不得回退为键名维度。

**T047 — 【rev2 重写·C5】实现：值级 typed schema 脱敏**
- 目标：
  - 7 种受约束类型：`enum` / `semver` / `constrainedVersionLine`（字符白名单 + 长度上限，不匹配即 `null`）/ `boundedInt` / `scopedRelPath`（相对已知根、禁 `..`，无法相对化 → `'outside-known-roots'`）/ `boolean` / `probeList`（无自由文本）；
  - `DETAILS_SCHEMA` 键→类型映射（plan §8.7(2)）；`sanitizeDetails` 对不合类型的值**丢弃**而非降级为原样；
  - `createCheck()` 为唯一 check 构造出口；`buildSummary(code, typedParams)` / `buildRemediation(code)` 为 `summary` / `remediation` 的唯一产出路径；
  - 🔴 顶层 catch **只输出 `errorClass` 枚举 + 固定模板文案**，禁止输出 `err.message` / `err.stack` 任何片段；
  - 🔴 子进程 stdout/stderr、RPC error、fs error 对象**MUST NOT** 被整体保存进任何进入报告的变量。
- 验收方式：T046 转绿。
- 注意事项：**明确不复用** `src/core/secret-redactor.ts`（内容启发式黑名单），理由写入模块头注释。

**T048 — 【rev2 微调·W2】实现：hook-trust check**
- 目标：三情形固定状态值（`untrusted`/`modified`/探测失败）+ **`$CODEX_HOME/hooks.json` 不存在 → `not-applicable`**（与 A3 解耦，plan §10.3）；`remediation` 在人工验证完成前使用不声称具体步骤的措辞、`command` 恒为 `null`。
- 验收方式：单测覆盖四情形返回值结构；`--dangerously-bypass-hook-trust` 在 `src/`/`plugins/`/`scripts/`/`README.md`/`docs/` **五处零命中**门禁测试（rev2 由三目录扩为五处）。
- 注意事项：消费 T003 结论确定探测手段优先级；**MUST NOT** 在探测失败时静默假设已信任。

**T049 — 实现：`codex-runtime-doctor.mjs` CLI 编排层**
- 目标：`--project-root`/`--format json|text`（默认 text）/`--strict`；退出码真值表（ok/warning/fail 未 strict 均 0，fail+strict 为 1，CLI 异常为 2）。
- 验收方式：`node plugins/spec-driver/scripts/codex-runtime-doctor.mjs --format json` 退出码 0，JSON schema 校验通过。
- 注意事项：npm script 命名 `codex:doctor`；**不接入 `repo:check`**。

**T050 — 测试先行 + 实现：`check-codex-inventory.mjs`**
- 目标：`codex mcp list` + plugin inventory（形态以 T004 实测确认为准）；条目缺失→退出码 3 + `entry-missing`；未启用→退出码 4 + `entry-disabled`；若 F213/F239 已有等价脚本直接复用。
- 验收方式：单测覆盖两种失败可区分；本地实跑一次记录输出（供 T059 消费）。

**T051 — 测试先行 + 实现：SC-015 `--strict` 漂移捕获**
- 目标：构造真实版本漂移 fixture（如注入的假 `exec` 返回不同版本），断言 `--strict` 下退出码 1 且 `overallStatus==="fail"`；仅 `indeterminate` 时退出码 0 且 `"warning"`。
- 验收方式：漂移 fixture 环境下 `node .../codex-runtime-doctor.mjs --strict --format json` 退出码 1。

**T065 — 【rev2 新增·W2】FR-010 文档落点与断言**
- 目标（plan §8.9）：
  1. **主事实源**：`README.md` 的 `📦 Install for Codex (CLI + skills)` 折叠块 `Notes:` 列表（实读确认位于 L282-320，`Notes:` 在 L316-318）追加两条英文 bullet —— ① hooks 安装位置由 `CODEX_HOME` 决定（默认 `~/.codex`）；② Codex 首次使用需 **grant hook trust**，未授予前 hook 不会执行，`npm run codex:doctor` 会把 `hook-trust` 报为 `untrusted`。
  2. **第二事实源**：`codex-skills.sh` 安装成功输出（实读确认 L248）之后追加一行 hook 信任提示（`install-codex-hooks.mjs` 侧的同一行在 T025 落地）。
  3. **断言**：新增 `tests/unit/codex-hook-trust-docs.test.ts` —— (a) README 上述区间内同时含 `CODEX_HOME` 与 `hook trust`；(b) 集成测试断言 `codex-skills.sh install --global`（隔离 `CODEX_HOME`）stdout 含该提示；(c) `--dangerously-bypass-hook-trust` 五处零命中（与 T048 共用同一门禁用例）。
  4. **生成链实测**：改完后跑 `npm run repo:check` 确认仍全绿（README 非生成文件、`codex-skills.sh` 不参与 wrapper 派生 —— 若意外变红说明存在未知生成链，**须先查清再继续，禁止直接 `repo:sync` 掩盖**）。
- 验收方式：新测试全绿 + `repo:check` 零失败。

**T066 — 【rev2 新增·决策四】R1 轮全量门禁与交付报告**
- 目标：A4 侧完整交付前的最终门禁：
  ```bash
  npm test && npm run build && npm run repo:check && npm run release:check
  ```
  四条退出码均为 0（🔴 **不得**用 `npx vitest run` 替代 `npm test`）；并复核 T064 记录的两组基线「只增不减」。
- 验收方式：四条命令输出摘要写入 `verification-report.md`。
- 注意事项：🔴 R1 交付报告**必须**标注「A4 已交付；**A3 尚未交付**」，**禁止**声称「本 feature 完成」「M9 轨道 A 收口」「轨道 A 已关闭」。

---

### Phase 0-A3：A3 侧前置实测（R2）

**T001 — M1：`exit 2` 真实阻断一手实测**
- 目标：在隔离 `CODEX_HOME` 下用 `blocker-hook.sh`（`exit 2` + stderr）触发一次真实 `codex exec` turn，确认命令是否真的未执行（探针文件未创建）。
- 🔁 **rev2 执行方式（W4）**：**MUST 经 `bash tests/e2e/codex-hooks/run-e2e.sh --path block --capture-only` 执行**（无断言采集模式），产出 `evidence/block-<runId>.json`。该证据在 `sourceHash` 未变时**可被 T054 直接复用**，避免重复消耗配额。
- 验收方式：实测结论写入 plan §9.4 表第 2 行「Codex 侧观察项」列，替换「待实测」；证据文件路径记入 `verification-report.md`。
- 注意事项：**本任务未完成前，禁止编写 T054 的断言内容**；消耗 1 次真实订阅配额。

**T002 — M2：failure-degrade 观察矩阵 6 行一手实测**
- 目标：分别构造 `exit 1` / `exit 2`（无 stderr）/ 超时 / stdout 非法 JSON / 被信号杀死 5 种触发形态（第 2 行与 T001 合并），填满 plan §9.4 表全部 6 行。
- 🔁 **rev2 执行方式（W4）**：同样经 `run-e2e.sh --path failure-degrade --capture-only` 执行并落 per-path 证据（每形态一份），供 T055 按 `sourceHash` 复用。
- 验收方式：观察矩阵无「待实测」残留，同步复制进 T052 的 `run-e2e.sh` 头注释（消解 clarify #6 的「文档产出」要求）。
- 注意事项：**本任务未完成前，禁止编写 T055 除否定式判据外的任何断言**；消耗约 5 次真实配额。

---

### Phase B：A3-1 生成器 / 门禁 / 合并写入器 / stop hook（R2）

**T016 — 【rev2 重写·C4】测试先行：`tests/unit/codex-hooks-event-gate.test.ts`**
- 目标：
  - **schema 层**：我方 owned 条目所在事件名非法（`pre_tool_use` / `PreToolUSE` / `NotAnEvent`）→ `fail`（code `owned-event-illegal`）；**第三方条目**所在事件名不在 Codex 10 事件全集内 → `warning`（code `unknown-event-name`），**不判 fail**；
  - **产品层**：**仅对 `isOwnedEntry` 条目**所覆盖的事件集合断言恰等于 `{SessionStart, PreToolUse, PostToolUse, Stop}`；越界 / 缺项各有可区分失败 code；
  - 🔴 **C4 回归钉子**：预置含合法第三方 `PermissionRequest` 条目 + 含未知事件名条目的 `hooks.json` → 校验退出码 0、第三方条目逐字节保留、owned 集合仍恰 4 项；
  - 三处校验对象（canonical 派生输入 / 生成器输出 / 安装后最终文件）各有独立用例，且第 3 处**只按 owned 作用域判定**。
- 验收方式：先红。
- 注意事项：🔴 rev1 的「安装后文件事件集合恰等于 4 项」与 FR-011 非破坏性合并**自相矛盾**，本任务不得回退为文件全集判据。

**T017 — 【rev2 重写·C4】实现：`lib/codex-hooks-schema.mjs`**
- 目标：`CODEX_EVENT_SCHEMA_SET`（10 项）+ `CODEX_EVENT_PRODUCT_SET`（4 项）常量 + 两层校验纯函数，**作用域按 T016 定义**（schema 层看全文件但对第三方未知名只 warning；产品层只看 owned 条目）。
- 验收方式：T016 转绿。

**T018 — 测试先行：生成器用例**
- 目标：断言 Worktree 系列事件被过滤、`${CLAUDE_PLUGIN_ROOT}` 展开为构建期绝对路径（不残留 `${` 字符）、matcher 按需改写。
- 验收方式：先红。

**T019 — 实现：`lib/codex-hooks-generator.mjs`**
- 目标：从 canonical `plugins/spec-driver/hooks/hooks.json` 派生 Codex 侧声明（**不新建 `hooks.codex.json` 并列文件**）。
- 验收方式：T018 转绿。

**T020 — 测试先行：`tests/unit/codex-hooks-installer.test.ts`**
- 目标：SC-008 (a)~(g) 七条语义 + `isOwnedEntry` 三条负向用例（`/opt/other/postinstall.sh`、`spec-driver-notes/postinstall.sh`、`/x/spec-driver/other.sh`）。
- 验收方式：先红。

**T021 — 实现：`lib/codex-hooks-installer.mjs`**
- 目标：`installCodexHooks`/`removeCodexHooks`/`isOwnedEntry` + 本地 `writeJsonAtomic`（tmp 文件 + `renameSync`）。
- 验收方式：T020 转绿。
- 注意事项：幂等语义取「原地更新」而非「跳过」（与 Claude 侧有意分歧，需在 parity 测试中登记为已声明差异）。

**T022 — 测试先行：`tests/unit/hook-installer-semantics-parity.test.ts`**
- 目标：把 FR-011 七条语义写成参数化合同表，通过薄适配器对 `hook-installer.ts` 与 `codex-hooks-installer.mjs` 各跑一遍。
- 验收方式：先红（适配器未实现）。

**T023 — 实现：parity 薄适配器**
- 目标：暴露 `install/remove/readTarget` 三个函数引用，供 T022 消费。
- 验收方式：T022 转绿；已声明差异（幂等语义）在测试中显式标注不告警。

**T024 — 【rev2 调整·C4】实现：`validate-codex-hooks.mjs` CLI**
- 目标：`--target <path> --format json`；SC-001 断言按作用域重写 —— **owned 条目**的 events 集合恰等于 4 项、command 为存在的绝对路径、无 `${`、含归属脚本名；**第三方条目**不参与产品层判定且必须逐字节保留（安装前后深相等比较）。
- 验收方式：`node .../validate-codex-hooks.mjs --target "$CODEX_HOME/hooks.json" --format json` 退出码 0（含第三方条目的 fixture 下同样为 0）。

**T025 — 实现：`install-codex-hooks.mjs` CLI + `codex-skills.sh` 挂接**
- 目标：`codex-skills.sh install --global` 末尾调用安装；`remove --global` 调用卸载；project 模式不安装 hooks；**安装成功时打印 FR-010 hook 信任提示**（与 T065 文案一致）。
- 验收方式：集成测试 `tests/integration/codex-hooks-install-flow.test.ts`（安装→校验→卸载全链路，隔离临时目录，**含第三方条目保留断言**）。
- 注意事项：`codex-skills.sh` 是 R1/R2 唯一交叉写入点，**T012 必须先于本任务落地**（决策四天然保证）；失败不阻断安装，唯一例外是非法 JSON 必须报错。

**T028 — 【rev2 强化】实现：`stop-fix-compliance-check.sh` 三级 fallback**
- 目标：`PLUGIN_ROOT` → `CLAUDE_PLUGIN_ROOT` → `BASH_SOURCE` 推导，扩展现有 L11-15 两级链为三级。
- 验收方式：🔴 **该脚本全仓零测试覆盖**，本任务 MUST 同批新增 shell 用例：三种环境变量组合（仅 `PLUGIN_ROOT` / 仅 `CLAUDE_PLUGIN_ROOT` / 两者皆无）各一条断言，确认解析出的脚本路径正确且脚本仍恒 exit 0。
- 注意事项：无回归防线的脚本改动等于裸奔，测试与实现必须同一批次。

**T029 — 【rev2 追加一题·C4】FR-011 独立对抗审查**
- 目标：委派 `codex:codex-rescue`，**8 道**对抗题面（plan §6.7：第三方条目丢失 / 误伤 / 逃逸 / 非法 JSON 路径写操作 / 符号链接只读目录 / 并发 rename / 备份覆盖 / **产品层门禁是否仍可能因第三方数据判 fail 从而逼用户删数据**）。
- 验收方式：8 题全部结论明确（已证伪/已修复/已论证不可达），无遗留 CRITICAL；②③两题须给出具体构造尝试结果。
- 注意事项：**独立委派，不与 T043 打包**（F238 教训）。

---

### Phase C：A3-2 FR-004 方言识别与 loud 诊断（R2）

> 🔴 **范围声明（每个任务实现时必须遵守，交付报告须原样复述）**：本 Phase 是**可观测性**改进，**不是**安全强度改进；**不提供**独立第二事实源、**不提高**合规判定强度、**不改变**任何放行/阻断语义（恒 exit 0 方向）。任何文档 / 注释 / 输出文案中的 over-claim 均视为缺陷。

**T030 — 【rev2 重写】测试先行：扩展 `plugins/spec-driver/tests/fix-compliance-core.test.mjs`**
- 目标：`detectTranscriptDialect(entries)` 四结果矩阵：
  | 输入 | 期望 |
  |---|---|
  | 无非 `parseError` 条目 | `'empty'` |
  | 含任一 `role ∈ {user, assistant, system, summary}` | `'claude'`（**即使完全没有 fix 锚点**） |
  | 全部 `role ∈ {session_meta, event_msg, response_item}` | `'codex-rollout'` |
  | 既无 Claude role 也无 Codex role | `'unknown'` |
  | Claude + Codex role 混合 | `'claude'`（规则 2 优先，保守归属） |
- 🔴 **必测负向用例**：一段**正常的 Claude 非 fix transcript**（无 fix skill 锚点）MUST 判 `'claude'` —— 这是「禁止用非 fix 反推方言」的机械钉子，防止破坏「健康路径零落盘」不变量。
- 验收方式：先红。
- 注意事项：**不再依赖 M5**（已废止）；断言只消费 `entry.role`，不新增任何解析逻辑。

**T031 — 【rev2 重写】实现：`lib/fix-compliance-core.mjs` 新增 `detectTranscriptDialect`**
- 目标：≈25 行纯函数 + `CLAUDE_TRANSCRIPT_ROLES` / `CODEX_ROLLOUT_ROLES` 两个 `Object.freeze` 常量；判定规则按 plan §5.3(1) 顺序求值。
- 验收方式：T030 转绿。
- 注意事项：🔴 **零 I/O、零新增 import、禁止 dynamic import**（否则触发 T032 的门禁复核失败）；单遍 O(n)。

**T032 — 【rev2 重写】门禁复核：`JUDGE_FILE_SET` 保持 6 项**
- 目标：跑 `node --test plugins/spec-driver/tests/judge-file-set-guard.test.mjs plugins/spec-driver/tests/judge-snapshot-core.test.mjs`，确认 `JUDGE_FILE_SET` **仍为 6 项**。
- 依据：实读 `lib/judge-snapshot-core.mjs:16-23` 确认清单已含 `scripts/lib/fix-compliance-core.mjs`，rev2 的实现全部落在既有 6 文件内且不新增 import ⇒ 清单**无需变更**，`judge:doctor` 也**不会**产生 rev1 所述的预期 drift。
- 验收方式：两个测试退出码 0 且清单长度断言仍为 6。
- 注意事项：🔴 **若清单被迫变为 7 项，说明实现违反了「不新建模块」约束 —— 应回查实现，而不是顺手改清单**。确有必要新增时，MUST 同批更新 `judge-snapshot-core.test.mjs` 长度断言，并在交付报告中说明旧安装快照会报 drift（预期行为）。

**T033 — 【rev2 重写】测试先行：扩展 `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`**
- 目标：三条不变量（plan §5.3(5)）：
  - **I1 退出码恒等**：Codex rollout / unknown / empty / Claude 四类 fixture 下 CLI 退出码恒为 0；
  - **I2 Claude 零回归**：既有 Claude fixture 全集的 verdict / 退出码 / 落盘事件数与**钉死基线常量**逐字节相等（基线以 fixture 常量形式写死，不做 `git stash` 前后对拍——CI 不可复现）；
  - **I3 健康路径零落盘**：正常 Claude 非 fix 会话跑完后审计事件文件**未被创建 / 未增长**。
- 另加 **I4 静态守卫**：`detectTranscriptDialect` 函数体内 `fs.` / `require` / `import(` 零命中。
- 验收方式：先红。

**T035 — 【rev2 重写】实现：`fix-compliance-judge.mjs` 的 `!isFix` 分支接线**
- 目标：在 `evaluate()` L118-125 的 `!isFix` 分支内新增 ≤ 8 行：调用 `detectTranscriptDialect(entries)`，`dialect ∈ {codex-rollout, unknown}` 时返回 `transcriptDiagnostics: ['transcript-format-unrecognized', 'dialect:<name>']`，否则返回 `[]`（逐字不变）。
- 验收方式：T030 / T033 全绿。
- 注意事项：🔴 **`evaluate` / `runHook` / `readHookPayload` 的函数签名逐字不变**；🔴 **`runHook` L406-409 分支逐字不变**（既有 `tryAppendFailOpenEvent` 出口自动承接新诊断）；🔴 **`releaseDegraded` 逐字不变**；本文件净增 ≤ 10 行。

**T036 — 【rev2 收窄】测试先行：扩展 `plugins/spec-driver/tests/fix-compliance-io.test.mjs`**
- 目标：`readHookPayload` 放宽后三类输入可区分：(a) `transcript_path` 缺失 / `null` + `session_id` 有值 → `ok: true`；(b) `transcript_path` 类型非法（非字符串非 null）→ `payload-invalid`；(c) `session_id` 缺失 → 仍 `payload-invalid`。
- 验收方式：先红。

**T037 — 【rev2 收窄】实现：`lib/fix-compliance-io.mjs:43-45` 放宽**
- 目标：`transcript_path` 由「必需非空字符串」改为「可为 `null` / 缺失」；`session_id` 仍必需非空；下游产出可区分的 `transcript-path-absent` 诊断码（与 `transcript-unavailable` / `payload-invalid` 三者语义不混）。
- 验收方式：T036 转绿；Claude 侧回归确认「永远提供 transcript_path」时行为逐字不变。
- 注意事项：三种诊断码的退出码**均为 0**，本改动只提升诊断精度，不改变任何行为。

**T043 — 【rev2 重写题面】FR-004 独立对抗审查**
- 目标：委派 `codex:codex-rescue`，**6 道**新题面（plan §5.4）：
  1. 能否构造 Claude transcript 被误判为 `codex-rollout`/`unknown`（破坏 I3、污染审计流）？
  2. 能否构造 Codex rollout 让识别落回 `'claude'`（改造被架空）？
  3. 是否存在任一路径使退出码不再恒为 0（破坏 I1）？
  4. 能否用可控 transcript 让每次 Stop 都写诊断，构成审计文件膨胀 / 磁盘 DoS？
  5. `transcript_path` 放宽后是否有原被 `payload-invalid` 挡住的输入进入新路径并异常？
  6. 是否在任何文档 / 注释 / 文案中 over-claim「判定强度提高」或「获得独立事实源」？
- 验收方式：6 题全部结论明确，无遗留 CRITICAL；处置后重跑 SC-007 全矩阵 + I1~I5 不变量测试。
- 注意事项：**独立委派，不与 T029 打包**。

---

### Phase E：共通收口（R2）

**T067 — 【rev2 新增·W4】per-path 证据 schema 与 `sourceHash` 实现**
- 目标：
  - 证据文件 `tests/e2e/codex-hooks/evidence/<path>-<runId>.json`，**原子写**（tmp + rename），文件名含 `runId` ⇒ **从不覆盖既有证据**；
  - 字段：`path` / `mode`（`live`\|`capture-only`\|`replay`\|`skipped`）/ `success`（capture-only 恒 `null`）/ `payloadHash` / **`sourceHash`** / `runId` / `codexVersion` / `timestamp` / `skipReason`；
  - `sourceHash` = 对被测源码集合（`plugins/spec-driver/hooks/*.sh` + `hooks.json` + `lib/codex-hooks-*.mjs` + `install-codex-hooks.mjs` + `fix-compliance-{judge,core,io}`）内容的有序 sha256；
  - `run-e2e.sh` 新增 `--capture-only` 模式（跑真实 turn 但**不做任何断言**，只采集并落证据）。
- 验收方式：单测 / shell 用例断言：同一 path 连跑两次产生两份互不覆盖的证据；源码任一字节变更导致 `sourceHash` 变化。

**T052 — 【rev2 调整】E2E harness 骨架搭建**
- 目标：按 plan §9.1 结构搭建 `run-e2e.sh`（`--path allow|block|failure-degrade|stop [--live] [--capture-only]`）+ `lib/setup-codex-home.sh`（隔离 `CODEX_HOME`，经 `install-codex-hooks.mjs` 真实安装）+ `lib/probe-hook.sh` / `lib/blocker-hook.sh` / `lib/degrade-hooks/`（6 种形态）+ `evidence/` + `recorded/*.json` fixture。
- 验收方式：`bash tests/e2e/codex-hooks/run-e2e.sh --path allow`（replay 模式）在 CI 可跑。
- 注意事项：全程 `trap 'rm -rf "$CODEX_HOME"' EXIT`；replay 边界须写进脚本头注释；同步复制 T002 的观察矩阵表进头注释（消解 clarify #6）。

**T053 — SC-003 allow 路径 live E2E**
- 目标：`codex exec "创建文件 probe.txt"`，捕获 `PreToolUse`/`PostToolUse` 真实 payload。
- 验收方式（🔁 rev2 三重判据）：存在 `evidence/allow-*.json` 且 `mode==='live'` **且** `success===true` **且** `sourceHash` 等于当前工作树计算值；断言字段集合齐全（`tool_name==="Bash"`、`tool_input.command` 非空、`cwd`/`session_id`/`turn_id`/`model`/`transcript_path` 均存在、`PostToolUse` 含 `tool_response`）。
- 验收命令（写死完整形式）：`CODEX_E2E_LIVE=1 CODEX_HOME="$(mktemp -d)" bash tests/e2e/codex-hooks/run-e2e.sh --path allow --live`

**T054 — SC-004 block 路径 live E2E**
- 目标：消费 T001 实测结论编写断言。
- 验收方式：同 T053 三重判据（`evidence/block-*.json`）；断言探针文件未创建（或 T001 实测的真实观察结果）。**若 T001 的 `sourceHash` 与当前一致则可直接复用其证据，无需重跑**。
- 注意事项：**若实测证明阻断语义与预期不符，须如实记录并调整断言，禁止包装成通过**。

**T055 — SC-005 failure-degrade live E2E**
- 目标：6 种触发形态（第 2 行与 block 合并，约 5 次真实 turn）。
- 验收方式：同 T053 三重判据（每形态一份证据）；否定式判据（有界超时内退出、无产品级崩溃）+ T002 回填的具体观察断言。**T002 证据在 `sourceHash` 一致时可直接复用**。

**T056 — SC-006 stop 路径 live E2E**
- 目标：与 allow 同一 turn 顺带捕获 Stop payload。
- 验收方式：同 T053 三重判据（`evidence/stop-*.json`）；断言 `hook_event_name==="Stop"` 等字段；`grep -n 'tool_name' tests/e2e/codex-hooks/*stop*` 反向验证零命中。

**T057 — 【rev2 调整】SC-016 双运行时 provenance meta 测试**
- 目标：从两侧测试文件抽取断言字段名集合，断言 `!isSubset(A,B) && !isSubset(B,A)`；rev2 新增 **transcript 方言维度**（Claude 侧 `role ∈ {user, assistant}` vs Codex 侧 `role ∈ {session_meta, event_msg, response_item}`）。
- 验收方式：`npx vitest run tests/unit/hook-installer.test.ts` + allow 路径 live 证据 + 既有 Claude hook 回归用例全绿。
- 注意事项：依赖改为 T053 + T031（原 T027 已废止）。

**T058 — 回归护栏批量验证（SC-017/018/019/020）**
- 目标：按 plan §11 表逐条执行护栏 4/5/7/8；F239 第 14/15 族全绿、F238 wrapper/字面量门禁全绿、评测链 diff 为空、`.codex` 硬编码点全部归类无遗漏。
- 验收方式：见「SC 验收映射表」对应命令；归类结果写入 `verification-report.md`。

**T059 — SC-022 inventory 机械确认实跑**
- 目标：实际执行 `codex mcp list` 与 plugin inventory 一次，记录输出。
- 验收方式：输出含 Spectra MCP server 已启用条目；`check-codex-inventory.mjs` 退出码 0。
- 注意事项：**不得**以「F213/F239 历史上做过」为由跳过实跑。

**T060 — 【rev2 重写】SC-023 全量验证 + R1 门禁重跑**
- 目标：
  ```bash
  npm test && npm run build && npm run repo:check && npm run release:check
  ```
  四条零失败；**并重跑 T066 的 R1 全部门禁**，确认 A3 改动未打回 A4（尤其是 `codex-skills.sh` 这个交叉写入点）。
- 验收方式：四条命令退出码均为 0；T064 记录的两组基线「只增不减」复核通过。
- 注意事项：🔴 **禁止**用 `npx vitest run` 替代 `npm test`（会漏掉 `plugins/spec-driver/tests/**/*.test.mjs`，而本轮改的判定链恰只被这批测试覆盖）。

**T061 — 交付报告撰写**
- 目标：分侧标注 A3/A4 达标结论；**原样复述 FR-004 的范围声明**（可观测性改进、非安全强度改进、不提供独立第二事实源、不提高判定强度）；T062/T063 人工验证挂账清单（含可执行步骤）；工具使用反馈（Spectra / Spec Driver dogfooding）。
- 验收方式：报告内容与各任务实测/测试结论逐条对应，无 over-claim（不得使用「杜绝/彻底解决/完全避免」类措辞）。

---

## 3. MANUAL-PENDING 人工验证任务清单

### T062 — `[MANUAL-PENDING]` SC-013 hook 信任状态迁移人工验证（R1 挂账）

**用户可直接执行的步骤（照搬 plan §15.3）：**

```bash
# 1. 隔离 CODEX_HOME 并复制凭据
export CODEX_HOME=$(mktemp -d)
cp ~/.codex/auth.json "$CODEX_HOME/auth.json"

# 2. 安装 hooks（R2 落地后才有 hooks 安装；R1 阶段可先只验 skills + doctor）
bash plugins/spec-driver/scripts/codex-skills.sh install --global
# 确认 $CODEX_HOME/hooks.json 已生成

# 3. 首次诊断，记录 untrusted
node plugins/spec-driver/scripts/codex-runtime-doctor.mjs --format json

# 4. 打开 Codex TUI，按提示完成 hook 信任授予
# ⚠️ 逐字记录实际操作步骤——只有这些步骤才允许写入 remediation

# 5. 重跑诊断，确认变为 trusted
node plugins/spec-driver/scripts/codex-runtime-doctor.mjs --format json

# 6. 不带 --dangerously-bypass-hook-trust 触发一次真实事件
codex exec "创建一个文件 probe.txt"
# 确认探针文件确实被 hook 记录（hook 真正执行）

# 7. 修改任一 hook 脚本一个字节，重跑诊断
# 确认状态变为 modified

# 8. 清理
rm -rf "$CODEX_HOME"
```

结果逐条写入 `specs/240-codex-runtime-closeout/verification-report.md`；第 4 步实测有效的步骤回填进 `lib/codex-runtime-doctor-core.mjs` 的 `remediation` 模板表（需一次后续小改动 + `npm run repo:check` 复核）。

### T063 — `[MANUAL-PENDING]` F239 T039 Codex 桌面客户端 managed worktree 文件同步验证

1. 用**真实 Codex 桌面客户端**创建一个 managed worktree；
2. 验证 `.worktreeinclude` 的 copy-if-absent 语义；
3. 验证 `AGENTS.override.md` 的同层取代语义；
4. 结果写入 `specs/239-worktree-local-state/` 相关文档，并更新 `specs/239-worktree-local-state/tasks.md:261` 的 T039 状态为 `[x]`；
5. 🔴 **禁止**以本 feature（240）的 hooks 实测为由标记 T039 完成——二者是不同能力域。

**里程碑口径**：T062/T063 完成前，任何文档 / commit message 只能声称「M9 轨道 A 实现已收口，剩余两项人工验证挂账中」，不得声称「轨道 A 已关闭」。**R1 交付时口径更严**：只能声称「A4 已交付、A3 未交付」。

---

## 4. SC-001 ~ SC-024 验收映射表（rev2 更新）

| SC | 分组 | 轮次 | 对应任务号 | 验收命令 |
|---|---|---|---|---|
| SC-001 | A3 | R2 | T017, T019, T024, T028 | `node plugins/spec-driver/scripts/validate-codex-hooks.mjs --target "$CODEX_HOME/hooks.json" --format json`（含第三方条目 fixture 亦须为 0） |
| SC-002 | A3 | R2 | T016, T017, T024 | `npx vitest run tests/unit/codex-hooks-event-gate.test.ts` |
| SC-003 | A3 | R2 | T052, T053, T067 | `CODEX_E2E_LIVE=1 CODEX_HOME="$(mktemp -d)" bash tests/e2e/codex-hooks/run-e2e.sh --path allow --live` → 证据三重判据 |
| SC-004 | A3 | R2 | T001, T052, T054, T067 | 同上，`--path block --live` → 证据三重判据 |
| SC-005 | A3 | R2 | T002, T052, T055, T067 | 同上，`--path failure-degrade --live` → 证据三重判据 |
| SC-006 | A3 | R2 | T052, T053, T056, T067 | 同上，`--path stop --live` → 证据三重判据 |
| SC-007 | A3 | R2 | T030, T031, T033, T035, T036, T037 | `node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs plugins/spec-driver/tests/fix-compliance-io.test.mjs`（🔴 **不在 vitest 下**） |
| SC-008 | A3 | R2 | T020, T021, T022, T023 | `npx vitest run tests/unit/codex-hooks-installer.test.ts tests/unit/hook-installer-semantics-parity.test.ts` |
| SC-009 | A4 | R1 | T006, T007, T008, T009, T010 | `npx vitest run tests/unit/codex-home.test.ts tests/unit/codex-home-shell.test.ts` |
| SC-010 | A4 | R1 | T012, T013 | `npx vitest run tests/unit/skill-installer.test.ts tests/unit/auth-detector.test.ts tests/integration/spec-driver-codex-skills.test.ts` + git diff 人工复核 |
| SC-011 | A4 | R1 | T011, T012 | `npx vitest run tests/unit/codex-home-scope-boundary.test.ts` + `npm run repo:check` |
| SC-012 | A4 | R1 | T004, T044, T045, T048, T049 | `node plugins/spec-driver/scripts/codex-runtime-doctor.mjs --format json` + `npx vitest run tests/unit/codex-runtime-doctor.test.ts` |
| SC-013 | A4 [MANUAL] | R1 挂账 | T003, T048, **T062** | 人工执行（见 §3） |
| SC-014 | A4 | R1 | T046, T047 | `npx vitest run tests/unit/codex-runtime-doctor-redaction.test.ts`（9×4×4 组合） |
| SC-015 | A4 | R1 | T049, T051 | `node plugins/spec-driver/scripts/codex-runtime-doctor.mjs --strict --format json`（漂移 fixture）→ 退出码 1 |
| SC-016 | 共通 | R2 | T031, T057 | `npx vitest run tests/unit/hook-installer.test.ts` + allow 路径 live 证据（原 T026/T027 已废止） |
| SC-017 | 共通 | R2 | T032, T058 | `npx vitest run tests/unit/spec-drift-check.test.ts tests/unit/spec-drift-cli.test.ts tests/unit/spec-drift-state-matrix.test.ts tests/integration/spec-drift-repo-check-regression.test.ts tests/integration/spec-drift-repo-check-modes.test.ts tests/unit/sync-worktree-local-state.test.ts` + `npm run repo:check` |
| SC-018 | 共通 | R1（T014）+ R2 复核 | T014, T058 | `npx vitest run tests/unit/spec-driver/wrapper-sha256.test.ts tests/integration/spec-driver-wrapper-source-truth.test.ts` + `npm run repo:check`（原 T042 已废止） |
| SC-019 | 共通 | R2 | T058 | `git diff --name-only master...HEAD -- 'scripts/eval-*' 'scripts/pilot-*' 'scripts/baseline-*'`（期望空） |
| SC-020 | 共通 | R1 + R2 | T012, T014, T058 | `rg -n "\.codex" --glob '!node_modules' --glob '!specs/**' --glob '!tests/**' src plugins scripts` + 人工归类（原 T027 已废止） |
| SC-021 | A4 | R1 | T015 | `rg -n "\.codex" scripts/sync-worktree-local-state.sh plugins/spec-driver/hooks/worktree-lifecycle.sh scripts/lib/worktree-local-state-core.mjs`（期望 0 命中） |
| SC-022 | 共通 | R1（实现）+ R2（实跑） | T050, T059 | `codex mcp list` + plugin inventory 命令 |
| SC-023 | 共通 | **R1（T066）+ R2（T060）各一次** | T060, T066 | 🔴 `npm test && npm run build && npm run repo:check && npm run release:check` |
| SC-024 | 共通 [MANUAL] | 挂账 | **T063** | 人工执行（见 §3） |
| FR-010 | A4 | R1 | **T065**, T048, T025 | `npx vitest run tests/unit/codex-hook-trust-docs.test.ts` + `npm run repo:check`（SC 编号以 spec 修订后为准，本轮以 plan §8.9 三条断言为验收判据） |

**A4 达标条件（R1）**：SC-009~SC-015 全通过 + FR-010 三条断言全绿（SC-013 为 `[MANUAL]`，挂账不阻塞，但达标判定须如实标注「代码就绪，人工验证挂账」）+ T066 四条门禁零失败。
**A3 达标条件（R2）**：SC-001~SC-008 全通过。
**整体达标条件**：A3 达标 且 A4 达标 且 SC-016~SC-023 全通过（含 T060 对 R1 门禁的重跑）；SC-024 同 SC-013 挂账处置。

---

## 5. 明令禁止项汇总（rev2 更新）

1. 🔁 **rev2 强化** **禁止**修 `pre-tool-use-guard.sh` / `post-tool-use-format.sh` 的**任何内容** —— 既禁止 `.file_path` → `.tool_input.file_path`（`_grounding.md` §9.4：会让沉默多时的门禁突然生效，属高影响面变更，已独立挂账为 follow-up），**也禁止 rev1 计划过的 `tool_name` 结构性早退**（W1：其前提已被实跑证伪，改动无收益且扩大 Claude 回归面；两脚本全仓零测试覆盖，改了没有任何回归防线）。
2. **禁止**在任何 hook 脚本或判定器代码中解析 `tool_input.command` 的 shell 命令字符串来提取/推断目标文件路径（F231 已实测证伪：结构白名单等于手写半个 bash 解析器）。
3. **禁止**安装流程（`install-codex-hooks.mjs`/`codex-skills.sh`）自动写入任何绕过 hook 信任的配置项，**禁止**调用 `--dangerously-bypass-hook-trust` 作为产品安装路径的一部分（该 flag **仅允许**出现在 `tests/e2e/codex-hooks/` 内部；T048/T065 的门禁测试断言该字符串在 `src/`/`plugins/`/`scripts/`/`README.md`/`docs/` **五处零命中**）。
4. **禁止**改动 `_grounding.md` §9.2 列出的「MUST NOT 改动」清单中的仓库内 `.codex` 路径点：`skill-installer.ts:171`（project 分支）、`validate-orchestrator-models.mjs:84`、`sync-delegation-contract.mjs:60`、`codex-skills.sh:66`（project 模式）——误改会同时打断 `repo:check` 与 F238 wrapper body-sha256 门禁。
5. **禁止**新建 `hooks.codex.json` 等并列声明文件（`tech-research.md` §6.1 建议已被否决）——双份声明必然漂移，Codex 侧声明 MUST 从 canonical `hooks.json` 派生。
6. 🔁 **rev2 更正** **禁止**在 FR-004 改造中新建模块、新增相对 import 或使用 dynamic import —— 实现 MUST 落在既有 `fix-compliance-core.mjs` / `fix-compliance-judge.mjs` / `fix-compliance-io.mjs` 内，使 `JUDGE_FILE_SET` 保持 6 项（T032）。
7. 🔁 **rev2 新增（决策三）** **禁止**把 `.specify/runs/*.jsonl` 的任何事件作为合规判定输入，**禁止**扩展 `record-workflow-run.mjs` 的事件 schema，**禁止**改动 5 处 SKILL.md 的 `record-workflow-run` 调用文本或 `record-workflow-run-fields.md` 合同 —— 该路线已被编排器实测 + Codex 审查双重证伪（正常事件无合规字段；`.specify/runs/` 非可信安全边界）。
8. 🔁 **rev2 新增（决策三）** **禁止**在任何产物中把 FR-004 的改造描述为「提高了合规判定强度」「获得了独立事实源」「修复了 Codex 下的合规漏判」—— 它只是**可观测性**改进（plan §5 范围声明），over-claim 视为缺陷（T043 题面 ⑥ 专查此项）。
9. 🔁 **rev2 新增（C4）** **禁止**把「安装后 `$CODEX_HOME/hooks.json` 的事件集合恰等于 4 项」作为对**文件全集**的判据 —— 产品层只约束我方 owned 条目；**禁止**任何会导致「必须删除第三方条目才能通过门禁」的设计。
10. 🔁 **rev2 强化（C5）** **禁止**四方诊断输出黑名单式内容过滤（F228 教训）；**禁止**复用 `src/core/secret-redactor.ts`；**禁止**把子进程 stdout/stderr、RPC error、fs error 对象整体保存进任何进入报告的变量；**禁止**输出 `err.message` / `err.stack` 的任何片段。
11. **禁止**在 M1/M2/M3/M4/M6 实测完成前，在对应下游测试文件中写入依赖其结论的断言。
12. 🔁 **rev2 强化（决策四）** **禁止**在 R1 交付时声称「本 feature 完成」「M9 轨道 A 收口」；**禁止**声称「轨道 A 已关闭」，直到 T062/T063 均完成。
13. **禁止**在本 feature 内推进插件版本 SemVer bump 的正式发布，**禁止**改动 `contracts/release-contract.yaml` 的任何 version 字段。
14. **禁止**碰 `scripts/eval-*.mjs`/`scripts/pilot-*.sh`/`scripts/baseline-*` 中的 `~/.codex` 引用（SC-019 断言为空 diff）。
15. 🔁 **rev2 新增（W3）** **禁止**把 `npx vitest run` 当作全量门禁 —— 全量入口是 `npm test`（= `vitest run && npm run test:plugins`）。
16. 🔁 **rev2 新增（W4）** **禁止**以单一 `.last-run.json` 或跨提交的旧 live 记录作为 SC-003~006 的达标证据 —— 必须是 per-path 原子证据且 `mode==='live' && success===true && sourceHash` 匹配当前工作树。

---

## 6. 建议实施顺序与并行度说明（rev2 按决策四重排）

### 6.1 轮次级顺序（硬约束）

```
R1（A4 先行）
  Phase 0-A4：T003 / T004 / T006 / T064   （全部 [P]）
        │
        ├─→ Phase A：T007 / T009 / T011 / T015 [P] → T008 → T010 → T012 → T013 / T014 [P]
        │
        └─→ Phase D：T044 / T046 [P] → T045 / T047 → T048 → T049 → T050 / T051 [P] → T065
                            │
                     T066（R1 全量门禁 + A4 交付报告）
                            │
R2（A3 随后，同一分支）      ▼
  T067 → T052（harness 骨架）
        ├─→ Phase 0-A3：T001 / T002（--capture-only 采证）
        ├─→ Phase B：T016 / T018 / T020 / T022 [P] → T017 / T019 / T021 / T023 → T024 / T025 / T028 → T029
        └─→ Phase C：T030 / T033 / T036 [P] → T031 → T032 / T035 → T037 → T043
                            │
                     Phase E：T053~T056 → T057 / T058 / T059 [P] → T060（含 R1 门禁重跑）→ T061
                            │
                     T062 / T063（人工验证，挂账不阻塞）
```

### 6.2 唯一交叉写入点的串行约定

`codex-skills.sh` 是 R1（T012 改 L23/L56-57、T065 在 L248 后加提示）与 R2（T025 在 `install_all`/`remove_all` 末尾追加调用）唯一重叠文件。**决策四已天然保证 R1 先于 R2**，无需额外约定；但 R2 修改前须确认工作树包含 R1 的改动（rebase 后重跑 T066 门禁）。

### 6.3 批次内并行度估算

- **Phase 0-A4**：4 项完全并行（T003/T004/T006 实测对象互不相干；T064 是只读跑测）。
- **Phase A**：T007/T009/T011/T015 四条测试先行可并行；T008/T010/T012/T013/T014 按内部依赖串行。
- **Phase D**：T044/T046 可并行；T048 依赖 T003；T050/T051 可在 T049 之后并行；T065 依赖 T012（`codex-skills.sh` 已迁移）与 T048（门禁用例共用）。
- **Phase 0-A3**：T001/T002 可并行发起，但**受真实 turn 配额约束，建议分批跑**（plan §9.2：最优 8 / 最坏 15 / 计划口径 ≈30，每 6 turn 查一次配额）。
- **Phase B**：T016/T018/T020/T022 四条测试先行可并行；实现任务各自依赖自己的测试任务。
- **Phase C**：T030/T033/T036 测试先行可并行（**均不再依赖任何实测**）；T031 是收敛点，T035 依赖 T031+T033。
- **Phase E**：T053~T056 四条 live 路径受配额约束，**建议分批跑**并优先复用 T001/T002 的 capture 证据；T057~T059 可并行后由 T060/T061 收口。

### 6.4 关于 rev1 §6.4「MVP 切分建议」

rev1 建议「若资源受限，第一批优先交付 A4」。**rev2 中这已不是建议而是硬性交付顺序**（决策四），理由与 rev1 一致且更强：A4 的 `resolveCodexHome` 是 A3 生产路径的前置基础设施，且 A4 侧无需消耗任何真实 turn 配额即可完整验收，先交付 A4 可以在不占用配额窗口的前提下先锁定一半价值。
