# Codex 对抗审查 — Phase: C (代码部分 T043-T047)

> Feature: 162
> Reviewed at: 2026-05-11
> Subagent: codex:codex-rescue
> Final status: ✅ 3 轮 review 收敛到 0 critical / 0 warning（仅代码部分；LLM 跑批 T039/T050/T052/T053-T058 deferred-to-api-key-available）

## 审查范围与限制

**本审查仅覆盖 Phase C 代码部分（T043-T047）**：
- T043 quota state store + O_EXCL lock
- T044 quota 跨进程 fork vitest（含 12 case）
- T045 eval-mcp-augmented 集成 quota + nested catch 兜底
- T046 subAgentMeta 双轨采集 + 字段级 fallback + inheritance_status 三状态
- T047 canonical schema `perf.mcpToolCalls[]` 迁移 + legacy 兼容读

**不在本审查范围**（LLM 跑批 + 报告填入）：
- T039 calibration 实测（需 SILICONFLOW_API_KEY，本 session 不可用）
- T050 pilot 27 runs（需 SILICONFLOW + ChatGPT Pro 配额）
- T052 全量 450 runs（需多 calendar week 日历 + ~$15）
- T053-T058 §10.x 报告填入（依赖 T050+T052 实测数据）

## 审查轮次概要

| 轮次 | Critical | Warning | 阻断 commit |
|------|---------:|--------:|------------|
| iter-1 | 3 | 3 | 是 |
| iter-2 | 1（新发现：classifyRuns EPERM 误判 dead）| 0（W-1/W-2/W-3 全清）| 是 |
| iter-3 | 0 | 0 | 否 |

## iter-1 finding 处置（3C+3W）

| 编号 | 主题 | 修复位置 |
|-----|------|---------|
| C-1 | partial 扫描目录层级错（只扫一层，run 写在 group/task 双层）| `eval-quota-store.mjs::classifyRuns` 加 `recursive` option + DFS withFileTypes；`eval-mcp-augmented.mjs:1147` 调用传 `recursive: true` |
| C-2 | subAgentMeta env 注入未真接入 spawn LLM | `eval-mcp-augmented.mjs:566/1023/1025` spawn env 合并 `envExtras`；finalize 读 `result.spawnEnv` 而非 `process.env`；`parseSubAgentSelfReport` 接 `subAgentStdout` |
| C-3 | 孤儿 lock 误清 EPERM | `eval-quota-store.mjs:115/128` 仅 ESRCH 清理；EPERM 视为 alive 保守，写日志不清理 |
| W-1 | canonical 字段落错层级（runResult 顶层而不是 perf 子对象）| `eval-mcp-augmented.mjs:844/848` `mcpToolCalls / mcpToolCallCount / mcpResponseBytes` 嵌入 `perf` 子对象；`subAgentMeta` 也写在 `perf.subAgentMeta` |
| W-2 | CLI 互斥校验在 dry-run 跳过 | `validateAcceptRestartPartial` 提到 `if (!args.dryRun)` 块外，dry-run 也校验 |
| W-3 | 6 confidence 状态测试缺 self-report | `tests/unit/sub-agent-meta.test.ts:180/195` 加 case 验证 env 存在 + self-report 完整 + version 不一致 → confidence='self-report' |

## iter-2 新发现处置

| 编号 | 主题 | 修复位置 |
|-----|------|---------|
| iter-2-new critical | `classifyRuns` writerAlive 路径把 EPERM 当 dead，与 C-3 修复矛盾，可能让 restart 误删活跃 lock | `eval-quota-store.mjs:464` 同步加 EPERM → 视为 active；JSON parse 失败仍视为 dead；其他错误（包含 ESRCH）视为 dead；新增 PC-T4b vitest case 显式覆盖 classifyRuns EPERM → partialRunning 路径 |

## 最终结论

- **critical 清零** + **warning 清零**
- 主线程裁决：**Phase C 代码部分 ready for commit；可推进到 master push 决策**

## 关键架构决策（LLM 跑批 phase 须遵守）

通过 3 轮对抗审查倒逼出的实施决策：

1. **Quota lock 短锁**：reserveQuota 持锁 < 10ms，LLM spawn 在锁外（plan §2.3.3 严格执行）
2. **Partial run 4 分类**：`finalized / partialRunning / partialStale / failedFinalized`，递归扫描 group/task 双层
3. **EPERM 保守视为 active**：classifyRuns + checkAndCleanOrphanLock 两层都对齐，避免 restart 误删跨用户活跃 lock
4. **Nested try-catch 兜底**：driver/jury/oracle 任一失败 → catch 兜底写 `finalized + status:'failed' + error.phase`，再 rethrow originalError（不被 fallback 写盘失败掩盖）
5. **subAgentMeta 双轨采集**：env 注入 + sub-agent stdout self-report；mergeSubAgentMeta 字段级 fallback；6 confidence 状态全 vitest 覆盖
6. **canonical schema `perf.mcpToolCalls[]`**：双写 canonical + legacy（mcpToolCallCount + mcpResponseBytes 派生），eval-task-runner SCHEMA_VERSION 1.2→1.3，verify-feature-158-classic 兼容读旧字段名
7. **CLI 互斥**：`--accept-partial` / `--restart-partial` exit 64 (EX_USAGE)，dry-run 也无条件校验

## Vitest 累计

- v1（iter-1 落地）：32 case（quota 12 + sub-agent-meta 20）
- v2（iter-2 修复）：35 case（+ PC-T2d EPERM checkAndCleanOrphanLock + PC-T3b 双层 recursive + sub-agent-meta self-report）
- v3（iter-3 修复）：36 case（+ PC-T4b classifyRuns EPERM）

全部 36 case 现 pass，0 新依赖（仅 Node 内建 fs / os / path / child_process / Intl.DateTimeFormat）。

## DEFERRED 到 LLM 跑批 phase

- T039 calibration 实测：ops 准备 SILICONFLOW_API_KEY，跑 `node scripts/calibrate-glm-judge.mjs` 触发
- T050 pilot 27 runs：3 fixture × 3 cohort × 3 repeat，需 SILICONFLOW + ChatGPT Pro 配额
- T052 全量 450 runs：~16h wall clock + ~$15 + 1-2 周 calendar week 分批
- T053-T058 §10.x 报告填入：依赖 T050 + T052 实测数据
