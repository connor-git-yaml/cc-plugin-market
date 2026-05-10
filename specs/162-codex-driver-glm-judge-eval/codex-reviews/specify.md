# Codex 对抗审查 — Phase: specify

> Feature: 162 — Codex Driver / GLM Judge 评测架构 swap
> Reviewed at: 2026-05-10
> Subagent: codex:codex-rescue
> Final status: ✅ critical 清零，可推进 GATE_DESIGN

## 审查轮次概要

| 轮次 | Critical | Warning | Info | 阻断 commit |
|------|---------|---------|------|------------|
| iter-1 | 4 | 7 | 2 | 是 |
| iter-2 | 1（C-5 新发现 + C-1/C-3 残留共 2） | 3（W-8/9/10 新增） | 0 | 是 |
| iter-3 | 0 | 4（W-11/12/13/14 新增） | 0 | 否 |
| iter-3 fix | 0 | 0 | 0 | 否 |

## iter-1 finding 处置（4C+7W+2I）

### Critical

| 编号 | 主题 | 处置 | 修复 commit anchor |
|-----|------|------|-------------------|
| C-1 | self-judge 禁忌不全堵 | 修：新增 FR-027 hard-fail 入口检查 | spec.md:152-168（FR-027 完整版） |
| C-2 | GLM 回退条件 + 2-judge tie-break | 修：FR-025 改任一阈值 + fail-closed | spec.md:148, 74, 202 |
| C-3 | --max-runs-per-day quota state | 修：FR-032 quota state store schema | spec.md:170-194 |
| C-4 | §10.5 不存在 | 修：FR-037 新建章节 + schema | spec.md:206-222 |

### Warning

| 编号 | 主题 | 处置 |
|-----|------|------|
| W-1 | retry 决策矩阵 | 修：FR-014 transient/quota/截断/schema-invalid 各自处理 |
| W-2 | Phase 0 cache 修复升 MUST | 修：FR-006 plugin update + Smoke D 记录加载源 |
| W-3 | SC-005 review artifact 合同 | 修：FR-038 + SC-005 artifact path + 合同 |
| W-4 | ≥3549 测试硬编码 | 修：US-1 验收 4 + SC-001 改"零失败 + 不增 skip/todo" |
| W-5 | Phase 顺序矛盾 | 修：概述 + 依赖关系图统一 0 → (A∥B) → C |
| W-6 | MCP trace canonical schema | 修：EC-006 定 perf.mcpToolCalls[] |
| W-7 | §10 实验设计同步更新 | 修：FR-040 §10.1 + Feature 158 detail |

### Info

| 编号 | 主题 | 处置 |
|-----|------|------|
| I-1 | FR-039 commit message 备注 | 接受：commit message 时 add note |
| I-2 | 5-fixture calibration 抽样规则 | 修：FR-022 固定 calibration-fixture-list.json + 分层抽样 |

## iter-2 残留 + 新发现处置

### Critical

| 编号 | 主题 | 处置 |
|-----|------|------|
| C-1 残留 | FR-027 测试 case 不真实 + GLM alias 必测 | 修：FR-027 加 5 组测试 case + normalize 规则 5 条（前缀/vendor/case-fold/alias） |
| C-3+C-5 | atomic rename 不是真锁 | 修：FR-032 改 O_EXCL lock-file + 退避重试 + 孤儿 lock 清理 |

### Warning

| 编号 | 主题 | 处置 |
|-----|------|------|
| W-8 | normalize GLM alias/case-fold 必测 | 同 C-1 残留修复，FR-027 normalize 规则 + 5 组测试 |
| W-9 | inheritance_status "inherited" 语义不清 | 修：FR-037 改 2 状态枚举 available/unavailable + mcp_called 配套字段 |
| W-10 | 跨日续跑 partial vs finalized 不区分 | 修：FR-032 + EC-008 引入 finalized_at 字段 + partial run 不自动重跑 |

## iter-3 新发现处置

### Warning

| 编号 | 主题 | 处置 |
|-----|------|------|
| W-11 | FR-032 lock 退避耗尽行为未定义 | 修：30s 后 exit code 73（EX_CANTCREAT）+ 诊断信息 + 用户提示 |
| W-12 | §10.5 表格 schema 未列 mcp_called | 修：表头加 `mcp_called (bool)` 第 4 列 |
| W-13 | --accept-partial / --restart-partial flag 未定义 | 修：FR-032 CLI flag 段落补两个 flag 语义 |
| W-14 | 复杂度表的 quota store 描述与 FR-032 冲突 | 修：复杂度表"依赖新引入数"行同步 O_EXCL lock-file 说明 |

## 最终结论

- **critical 清零**（iter-3 fix 后 0 critical）
- **warning 清零**（iter-3 fix 后 0 warning）
- **info 已全部接受或修复**
- 主线程裁决：**可推进 GATE_DESIGN**
- 设计阶段未发现需 plan 阶段重新论证的根本性 architecture 问题
- 风格偏好建议（如"建议 Pearson 用 X 库"）未发现

## 关键设计决策记录

通过 codex 对抗审查倒逼出的几个关键决策（plan 阶段须遵守）：

1. **0 新依赖目标**：quota lock 用 O_EXCL（POSIX 内置），不引入 proper-lockfile
2. **fail-closed 原则**：GLM judge 2-judge 分歧时取 fail；self-judge 任一组合都 hard-fail
3. **canonical schema 统一**：perf.mcpToolCalls[] 替换历史的 mcpToolCallTrace / mcpToolCallCount 二元混用
4. **partial run 不自动重跑**：必须用户显式选择 `--accept-partial` 或 `--restart-partial`
5. **inheritance_status 2 状态而非 3**：available/unavailable 二元，配 mcp_called 派生字段
