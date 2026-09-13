# F290 · 批次 3 残余收口（安全面）——检测侧 doctor 闭包 / 锁竞态确定性用例 / enum 反向守卫 / Tier 2 可观测性 / resume fix 恢复

> 模式：spec-driver fix（门禁 / 判定器类：异构对抗常设档位 ×2 角 + verify；Codex 审查暂停，异构档位缺席）。
> 来源：M10 §12.4「批次 3 收官追加」M11 债务中**安全、可加性**的五项；**不含** per-target 阻断预算与 `stop_hook_active` 第三佐证腿（两者为状态模型 / 裁决类改动，拆 F291 单独走全套）。
> 基线：origin/master `5f34cf13`。目标：用户随后发版（4.5.0 → 4.6.0）时把这批残余一并带出。

## 1. 问题（改动前事实）

| # | 缺陷 | 证据 |
|---|---|---|
| 1 | doctor 快照只比对判定器 import 闭包 `JUDGE_FILE_SET`（11）；SubagentStop 检测侧 CLI `fix-compliance-sidechain-marker.mjs` 不被判定器 import、不在集内 ⟹ 插件 cache 里 CLI 陈旧时 (c) 源静默失效、doctor 零信号（F236 同型） | F289 spec 审查 W-6 |
| 2 | F288 锁接管身份竞态（B-W1 修复：rename→核对 lockId→不符 rename 回）为微秒级窗口，M1-c 变异「裸 unlink 接管」在 26 例全绿——回归覆盖缺席 | F288 verify W1/W2 |
| 3 | 诊断码只有正向守卫（六表 ⊆ enum，T0-U2）与 judge 表内产出点守卫（T0-U3）；enum → 产出点的**反向**守卫未交付，`nonblock-storage-unavailable` / `parse-timeout` 两个零产出码只靠 schema description 文字登记 | F287/F288 移交 |
| 4 | Tier 2 被绑定用户只看到缺项、看不到「为何按 fix 判」；F224 宽松早退（fail-open）事件不带 `tier`，审计流无法区分 Tier 1/2 | F289 impl 误伤面 W-2 / delta 绕过面 |
| 5 | `spec-driver-resume` 恢复点表只认 feature 链（spec/plan/tasks/verification-report），fix 目录（fix-report + plan + verification）落「无制品→从头」或「已完成」两极；F289 (a) resume 源因此在真实语料 0 命中 | F289 spec 审查 W-1 |

## 2. 功能需求

- **FR-001 检测侧闭包进 doctor**：新增 `SIDECHAIN_FILE_SET`（sidechain CLI 的 BFS 闭包，8 项）与 `DOCTOR_FILE_SET = JUDGE_FILE_SET ∪ SIDECHAIN_FILE_SET`（去重、JUDGE 顺序在前、入口不变，12 项）；doctor 比对集改为 `DOCTOR_FILE_SET`；`JUDGE_FILE_SET` 本身**不变**（FR-002b 判定器闭包相等守卫不动）；新增 `sidechain-file-set-guard` 闭包相等守卫。两侧 shell 薄壳均不在比对集（既有口径）。
- **FR-002 锁竞态确定性用例**：io 增 test-only 环境钩子 `SPEC_DRIVER_FIX_COMPLIANCE_LOCK_TRACE_DELAY_MS`（仅在「读到 holder 判陈旧」与「rename 接管」之间注入延迟，**上限 1000ms 且每次 `acquireStateLock` 仅生效一次**；生产不设 ⟹ 零行为）；card-b 增 T1-C6（A 延迟 150ms / B 接管后持锁 300ms ⟹ 终态 2；裸 unlink 变异 ⟹ 1）与 T-S2（原子创建只经 staging+linkSync 的源码钉）。
- **FR-003 enum→产出点反向守卫**：card-a 增 T0-U6——schema enum 每码须在 `scripts/**/*.mjs` 有产出点，识别三种产出形态（`表.键` / 表动态下标 / 绑定该码的具名常量被引用），零产出码须在显式 allowlist（`nonblock-storage-unavailable`、`parse-timeout`）内，allowlist 陈旧亦判红。
- **FR-004 Tier 2 可观测性**：`tryAppendFailOpenEvent` 增 `tier` 字段（transcript 级 fail-open 早退传 `result.tier`）；`evaluate` 透传 `tier2CandidatePath`；`routeBlockEnforcement` 在 Tier 2 下生成绑定原因首段（源标签 + 目录 + 续做合同说明）经 `counts.tier2Notice` 进 `dispatchRoute` 三个阻断 arm（block / nonblock / uncorroborated 与既有 UNCORROBORATED_NOTICE 叠加）。不新增诊断码、不改可见码集合（T0-U5 不动）。
- **FR-005 resume fix 恢复**：恢复点表增 fix 目录分支（verification-report 已完成 / plan+代码 → Phase 4 / plan → Phase 3 / fix-report 含 Root Cause → Phase 2 / 无 Root Cause → Phase 1 / 无制品 → Phase 1），并注明恢复到 Phase 4 时 verify 仍须经 Task 委派（Tier 2 (a) 源的续做证据）。Codex 包装技能随 `repo:sync` 再生（body sha）。

## 3. 验收（SC）

- SC-001 doctor：`DOCTOR_FILE_SET.length === 12`、`[0]` 仍为判定器入口、含 sidechain CLI；judge-file-set-guard 与 sidechain-file-set-guard 双守卫均 pass；judge-snapshot 三套件零翻转（长度钉改引 `DOCTOR_FILE_SET`）。
- SC-002 T1-C6 确定性复现：正确代码终态 2；`identityOk` 核对撤销（裸 unlink）⟹ 终态 1（verify 变异实测）。
- SC-003 T0-U6：当前 enum 全部有产出点或在 allowlist；从 allowlist 删除任一码 ⟹ 红；给 allowlist 码加一个产出点 ⟹ 红（陈旧检测）。
- SC-004 Tier 2 阻断 stderr 含「识别为 fix 续做」+ 源标签 + 目录；fail-open 早退事件 `tier:2`；judge-cli / card-a / card-b / tier2 零翻转。
- SC-005 resume SKILL 与 Codex 包装 body sha 一致（`validate-wrapper-sources` pass）；`repo:check` 不新增失败。
- SC-006 异构对抗 ×2 角 + verify 子代理，CRITICAL 清零。

## 4. 明确不做

per-target 阻断预算（F288 状态键改动）；`stop_hook_active` 第三佐证腿（曾判死，需重裁决）——两者拆 F291；shell 薄壳进 doctor 比对（两侧口径一致保持不比）。

## 5. 风险（K）

- K-1 trace 钩子是生产代码里的 test-only 分支：以「未设环境变量 ⟹ 零行为」+ **上限 1000ms + 每次调用仅一次**钉住（对抗复审 W-1：`.claude/settings.json` 的 `env` 可持久化该变量，叠加 60 次重试原可放大到 300s 越过宿主 hook 超时、而「超时按放行处理」等价绕过），T-S2 三项断言钉住上限常量、夹取与闭锁。
- K-2 DOCTOR_FILE_SET 扩集会让**已安装旧快照**（无 sidechain CLI）在 doctor 里显示 `added-since`：这是预期（F289 起新增文件），与 F246/F270 加文件时同一形态。
- K-3 T0-U6 的三种产出形态是对**现状**的枚举，新增第四种形态（如经数组 map 产出）会误报零产出——误报方向是「多要人看一眼」（fail-loud），可接受。
- K-4（对抗复审误伤面 W-2 补登，**与 K-3 方向相反**）T0-U6 的**假阴性**面：形态①原按裸子串计数、不分代码与注释（已修：计数前剥注释）；形态②`表[` 原为表级证据、对多 key 表无 key 级区分力（已修：`IN_FLIGHT_DIAGNOSTICS` 改 key 级断言）。**残余**：`FOREIGN_DIALECT_DIAGNOSTICS` 运行时键控，key 级静态证据不可得，保留表级。**精确化（verify INFO-2）**：该表当前**只有 1 个 key**，故删其唯一产出点现在仍会正确报红（已实测）；该残余要到**新增第二个 key** 时才真正激活（届时删其中一个 key 的产出点不会报红）。另 verify C-新1/C-新2 已把形态①②③ 的两处假阴性（行尾注释、纯声明性引用）收口。
