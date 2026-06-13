# Codex 对抗审查 — spec.md（design phase）

日期：2026-06-13 | 审查方：codex:codex-rescue | 结论：4 CRITICAL + 4 WARNING + 1 INFO

主线裁决（不把判断交给子代理）：**全部认定为真实缺陷或高价值加固**，spec 需修订后再过 GATE_DESIGN。其中 2 项是需用户拍板的设计取舍（C2 反向污染策略、C4 防篡改威胁模型），其余直接修。

| 编号 | Codex 结论 | 主线裁决 | 处置 |
|------|-----------|---------|------|
| C1 | 候选 patch 来源未定义，可能误用 goldPatch 判分 | 接受（真实漏洞） | 新增 runner 输入合同 `candidatePatch`→`model_patch`；goldPatch 仅作正控；新增验收断言 predictions JSONL 的 patch 来自候选而非 goldPatch |
| C2 | timeout/OOM/Killed 无条件归 error → 真实 fail 被洗成环境故障 | 接受（**评分公正核心**，需用户拍板） | 引入 `failureSource: infra\|candidate\|fixture`，phase-aware 分类。见 Q1 |
| C3 | 三分类状态机未穷尽（exit 1 无日志 / pytest 2/3/4 / 137 / 143 / null / report 缺失） | 接受 | 改穷尽式决策表 + 优先级 + fallback；pass 也要求 completed=true；SC-002 改表驱动覆盖全部信号 |
| C4 | freezeBlock 只检测漂移不防篡改；oracleSpecHash 不覆盖 classifyOracle 代码/harness 版本/镜像 digest | 部分接受（需用户定威胁模型） | 见 Q2；并修正 clarify 的"仅 config"自动选择 |
| W1 | 本地 fixture hash 与官方 harness 实际数据源（HF dataset）可能脱节 | 接受 | spec 立"执行的 test 集必须等于冻结 swebenchMeta"不变量；plan 定机制（本地 dataset 喂给 harness 或冻结 HF revision+digest）；新增验收：report 里执行的 test-ids == fixture.swebenchMeta |
| W2 | 回归护栏多为声明、不可执行 | 接受（checklist 同诉求） | 护栏转可执行 SC：`git diff --exit-code swe-bench-fixture-import.py`、受控文件 allowlist、`rg` 禁必选 API key、`git check-ignore` 验产物路径、golden aggregate 测试锁竞品统计口径 |
| W3 | cleanup 竞态验收不足 | 接受 | 新增测试：注入 fs write error → 断言 cleanup 未调用 + worktree 保留；patch.diff 与 cleanup 前 git diff 字节级一致；temp file + atomic rename |
| W4 | 最小 fixture 范围自相矛盾（10 个 vs 仅 SWE-L003） | 接受 | 拆为"1 真实 smoke fixture(SWE-L003) + 全量 mock 分类矩阵 + 可选 10-fixture manifest 检查"；SC-002 列全每个 mock 信号 |
| I1 | 关键词/命名不一致（SHOULD+[必须]、FR-006 可选 vs MUST、FreezeBLock 拼写） | 接受 | 统一 RFC 关键词与中文强制等级；FR-006 保持 in-scope(P3) 但 body/header 一致；统一 FreezeBlock |

## 待用户拍板（GATE_DESIGN）
- **Q1 反向污染策略**：候选 patch 导致 test hang/OOM/crash 该算 fail 还是 error
- **Q2 防篡改威胁模型**：freeze 强度（仅 config vs 冻结 oracle 语义代码）
