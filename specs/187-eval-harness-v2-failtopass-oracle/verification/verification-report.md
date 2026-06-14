# Verification Report — F187 评测设施 v2（FAIL_TO_PASS oracle）

日期：2026-06-14 | 分支：claude/nostalgic-curie-ab8ca4 | 验证方式：真实执行（无纸面声称）

## 全量门禁（SC-016）
| 检查 | 结果 |
|------|------|
| `npx vitest run`（全量） | ✅ 4453 passed / 0 failed（21 skipped 含 gated smoke，20 todo）|
| `npm run build`（tsc） | ✅ 零类型错误 |
| `npm run repo:check` | ✅ 全部 pass |

## Success Criteria 逐条
| SC | 验证方式 | 结果 |
|----|---------|------|
| SC-001 真实 oracle 执行返回结构化结果 | [smoke] SWE-L003 真跑 run_evaluation 42s | ✅ goldPatch→pass，OracleResult 完整不截断 |
| SC-002 三分类决策表全覆盖 | [mock] feature-187-classify-oracle（28）| ✅ 14 行 + fallback 全覆盖 |
| SC-003 error 不计入 fail 分母 | [mock] classify + ranking 测试 | ✅ classifyRunForRanking error→null；batch :289 已改 |
| SC-004 分阶段归因（Q1）| [mock] classify + oracle-pipeline | ✅ test_exec timeout→fail/candidate；image→error/infra |
| SC-005 patch.diff/日志 cleanup 前落盘 | [mock]+[smoke] persistRunArtifacts | ✅ 原子写 + cleanup 后 worktree 删除 |
| SC-006 jury 优先读持久化 patch.diff | [mock] extractDiff 测试 | ✅ persistedPatchPath 优先，缺失回退 diffStat |
| SC-007 漏接 promptBuilder→throw | [mock] cohort-registry | ✅ resolveCohort/getPromptBuilder throw 含 id |
| SC-008 cohort registry 单一来源 | [assert]+[mock] | ✅ COHORT_IDS/COHORT_TO_TOOL 从 registry 派生 |
| SC-009 oracleSpecHash 检测换判分 | [mock] freeze-block | ✅ 改任一语义模块 sha→hash 变；缺/不符拦截 |
| SC-010 本 feature 不跑烧钱评测 | [assert] | ✅ smoke RUN_SWEBENCH_SMOKE gate 默认 skip；仅 SWE-L003 单实例自测 |
| SC-011 model_patch=候选 patch 非 goldPatch | [smoke]+[mock] | ✅ details.candidatePatchSha 记录；正控外不等 goldPatch |
| SC-012 写盘失败→不 cleanup 保留现场 | [mock] persistRunArtifacts | ✅ 返回 false → runner 不 rmSync |
| SC-013 竞品 cohort golden 逐字一致 | [mock] cohort-registry golden | ✅ promptBuilder==buildDriverPrompt（4 cohort×2 模式）|
| SC-014 执行 test 集==fixture | [smoke] | ✅ details.executedMatchesFixture=true；failToPassExecuted 非空 |
| SC-015 可执行回归护栏 | [assert] | ✅ ① importer 零改动 ② 无必选 API key 前提 ③ 产物 gitignore ④ 竞品脚本未改 |
| SC-016 全量门禁 | [assert] | ✅ 见上 |

## 用户裁决落实
- **Q1 分阶段判定**：classify-oracle 决策表 test_exec 前/后区分 infra/candidate（exit139 例外）→ ✅ SC-002/004
- **Q2 冻结 oracle 语义**：oracleSpecHash 覆盖 classify-oracle + phase-markers + swebench-oracle + dataset-build + fetch helper → ✅ SC-009

## Codex 对抗审查（三轮全处置）
- spec 阶段 4 CRITICAL → 全修（candidate patch 合同 / 分阶段归因 / 穷尽决策表 / 语义冻结）
- plan 阶段 6 CRITICAL → 全修（spawnSync 收敛 / ranking 修 :289 / oracleSpecHash 覆盖打点 / evidence-based / Phase0 gate / 测试盲区）
- 实现阶段 3 CRITICAL + 8 WARNING → 全处置（见 codex-review-impl.md）

## 回归护栏（🔴）
- ✅ 不改竞品方法论：SC-013 golden + SC-015④ allowlist
- ✅ importer 零改动：SC-015① git diff --exit-code
- ✅ 产物不入库：SC-015③ git check-ignore（run_artifacts/ + .swebench-venv/）
- ✅ 凭据订阅优先：SC-015② 无 ANTHROPIC/OPENAI API key 前提

## 已知边界 / 留待 F188
- preregistration.md 重新冻结（写入 oracleSpecHash）是 F188 跑批前的 eval 动作；本 feature 提供 freezeBlock 能力 + swebench 模式缺 oracleSpecHash 即 hard-fail（强制重冻结）
- 全量 133 实例跑批属 F188（本 feature 仅 SWE-L003 自测通路）
