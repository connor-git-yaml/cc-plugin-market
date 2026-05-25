# Tasks: F169 — Cohort C lift 复现验证

**Feature**: 169
**Spec**: [spec.md](./spec.md)
**Plan**: [plan.md](./plan.md)

---

## Task 列表

### Phase 4a: scripts 实现（在 worktree 写入；脚本本身设计为在主仓 root 执行）

- **T-001** 在 worktree 创建 `scripts/f169-c-lift-rerun.sh`（可执行 +x）
  - 实现 plan §2 跑批循环（6 fixture × 2 cohort × N=3）
  - 实现三道 stop-loss（全局累计 cost + wall + fixture-level 早停）
  - 实现每 6 runs 配额信息日志（仅输出，不交互）
  - 写 `$LOG_DIR/manifest.json` + `$LOG_DIR/final-summary.json`
  - 启动前置检查：dist/cli/index.js + 6 fixture 存在 + cwd 合理
  - 依赖：spec.md FR-001 ~ FR-006
  - 验收：bash -n 通过 + dry-run mock 调用模式可手测

- **T-002** 在 worktree 创建 `scripts/verify-feature-169.mjs`
  - 按 verify-feature-15x.mjs pattern：argv 解析 + JSON 输出 + exit code
  - 读 manifest + 扫描 runs-dir + 解析每个 run-N.json
  - 实现 SC-001 数据完整性检查（finalize success + mcpToolCallCount > 0 for cohort C）
  - 实现 SC-002 lift verdict 计算（strong/weak/negative/ambiguous）
  - 实现 partial 数据下的 verdict 规则（≥4 fixture 算满足，<4 算 SKIP）
  - 依赖：T-001（需要知道 manifest 格式）
  - 验收：node scripts/verify-feature-169.mjs --help 输出正确；mock JSON 单元逻辑可测

- **T-003** 在 worktree 创建 `package.json` script 入口（可选 — 沿用现有 verify-feature-15x 不一定在 package.json）
  - 跳过：现有 verify-feature-15x 系列均直接 `node scripts/verify-feature-XYZ.mjs`，不在 package.json 加 script 入口

- **T-003.5 Codex Review #2 + #3 — plan/tasks（已完成）**
  - 5 CRITICAL + WARNINGs 已修在 plan.md / tasks.md（详见后文 commit log）
  - 验收：Codex critical 清零

- **T-004** worktree commit phase 4a 制品
  - `git add scripts/f169-c-lift-rerun.sh scripts/verify-feature-169.mjs specs/169-*`
  - commit message: `feat(169): Phase 4a — wrapper + verify scripts`
  - 不 push（push 等 Phase 5 完成）

- **T-004.5 同步 scripts 到主仓 root**（worktree commit ≠ 主仓 working tree；显式 sync 步骤）
  - 主仓 root 执行：
    ```bash
    cd /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/
    git show claude/blissful-tu-a743cd:scripts/f169-c-lift-rerun.sh > scripts/f169-c-lift-rerun.sh
    git show claude/blissful-tu-a743cd:scripts/verify-feature-169.mjs > scripts/verify-feature-169.mjs
    chmod +x scripts/f169-c-lift-rerun.sh
    ```
  - 注：主仓 working tree 临时 dirty (uncommitted)；T-016 完成后由主仓 working tree cleanup（rm 或 stash）
  - 验收：`ls -la scripts/f169-*` 在主仓 root 见 2 个文件 + +x bit

### Phase 4b: 跑 36 runs（cwd=主仓 root，**手动执行 + 编排器监控**）

- **T-005** 切换到主仓 root + 跑 startup checks（plan §6）
  - cwd: `/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/`
  - 跑：git fetch、ls dist、source .env.local、vitest baseline、fixture 存在性、claude auth
  - 若任一 fail → 修复后再继续；不强行跑批

- **T-006** 跑 `bash scripts/f169-c-lift-rerun.sh`（主仓 root）
  - 预期 wall ~3.6h
  - 编排器后台监控（每 ~30 min 检查 log 进度，不阻塞主线程）
  - stop-loss 触发不交互（按 brief 决策"自动落 partial + 继续 verify"）

- **T-007** 跑 `node scripts/verify-feature-169.mjs --manifest /tmp/spectra-f169/manifest.json`（主仓 root）
  - 收 JSON report
  - 提取 SC-001 / SC-002 verdict / aggregate 数据用于 Phase 4c
  - 在主仓 root 把 verify report 拷贝到 worktree：
    ```bash
    cp /tmp/f169-verify-report.json /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/blissful-tu-a743cd/specs/169-c-lift-rerun-9-fixtures/verification/verify-report.json
    cp /tmp/spectra-f169/manifest.json /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/blissful-tu-a743cd/specs/169-c-lift-rerun-9-fixtures/verification/manifest.json
    cp /tmp/spectra-f169/final-summary.json /Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/blissful-tu-a743cd/specs/169-c-lift-rerun-9-fixtures/verification/final-summary.json
    ```
  - 这 3 个 JSON 文件作为 provenance commit 进 worktree（T-011 时一并 git add）

- **T-007.5 partial 数据分支判定**（明确流转规则）
  - 读 verify report 的 `sc_002.verdict` 字段
  - **若 verdict == "strong" / "weak" / "negative"** → 继续 T-008/T-009/T-010 正常路径
  - **若 verdict == "ambiguous" 且 完成 fixture ≥ 4** → 继续 T-008/T-009/T-010，§10.5.1.10 写 "verdict ambiguous, lift 未达 directional 阈值"
  - **若 verdict == "SKIP" 或 完成 fixture < 4** → 仍跑 T-008（§10.5.1.10 写 "F169 partial 数据 (n=X/36 due to stop-loss <ID>)，数据不足以判定 lift"），但 **跳过 T-009/T-010**（§10.4 / §1 不修订，避免基于不足数据 over-claim）

### Phase 4c: 报告章节更新（在 worktree 写入）

- **T-008** 写 `specs/147-competitor-evaluation-platform/competitive-evaluation-report.md` §10.5.1.10
  - 插入点：§10.5.1.9 末尾 "Follow-up Features 建议" 列表之后、`---` 之前（约 line 1298）
  - 内容按 plan §4.2 模板填入实测数据
  - 显式标注合并口径（避免双重计数）
  - 含 stop-loss 触发记录（如有）

- **T-009** 更新 §10.4 战略结论（最小 diff，按 plan §4.3）
  - 仅追加 "F169 数据补强后修订" 一段
  - 不删原文

- **T-010** 更新 §1 Executive Summary（按 plan §4.4）
  - 新增 §1.1.1 子节（scope-bounded SWE-Bench-Lite 结论）
  - **不删除** §1.1 Sprint 3 grounding=0 旧叙事
  - 明确写两者实验对象不同

- **T-010.5 Codex Review #4 — implement 改动**（plan §5 约定 commit 前必跑）
  - codex:codex-rescue 审查 §10.5.1.10 / §10.4 / §1 修订是否 over-claim + 数据合并算式是否双重计数 + scripts 是否引入回归
  - critical 必修；warning 酌情
  - 验收：critical 清零

- **T-011** worktree commit phase 4c 制品
  - `git add specs/169-*/verification/*.json specs/147-*/competitive-evaluation-report.md`
  - commit message: `docs(169): Phase 4c — §10.5.1.10 + §10.4 + §1 修订 + verify report provenance`

### Phase 5: verify 闭环

- **T-012** 跑 `npx vitest run`（主仓 root）→ 期望 3708 passing（SC-004）
- **T-013** 跑 `npm run build`（主仓 root）→ 期望零错误（SC-004）
- **T-014** 跑 `npm run repo:check` + `npm run release:check`（主仓 root）→ 期望全 pass（SC-004）
- **T-015** 写 verification-report.md（worktree 内 specs/169-*/verification/）
  - 含 SC-001 ~ SC-005 逐条 status
  - 含 Codex review 5 phase 汇总
  - 含真实 cost/wall/quota 实测 vs 预算
  - 含 §1 修订 diff (before/after)

- **T-015.5 Codex Review #5 — verify report**（最终）
  - codex:codex-rescue 审查 verification-report.md 是否 SC-001~005 全真达成（不是纸面声称）
  - critical 必修
  - 验收：critical 清零

- **T-016** worktree commit verify 制品 + 等用户授权 push
  - commit message: `docs(169): Phase 5 verify — verification-report`
  - 列 deliverable report（CLAUDE.local.md 7 字段约定）等用户 "确认 push"
  - 主仓 root scripts cleanup 备注：主仓 root 在 T-004.5 之后有 `scripts/f169-c-lift-rerun.sh` + `scripts/verify-feature-169.mjs` 作为 uncommitted working tree 文件。push + ff-merge 到 master 后，这两个文件内容与新 master HEAD 一致，git status 自动 clean，无需手动 cleanup
  - 保留 `tests/baseline/swe-bench-lite/runs/` 输出在主仓 local（按 CLAUDE.local.md 跑批结果不入库）

---

## 依赖关系

```text
T-001 ──┐
T-002 ──┼─→ T-004 (commit phase 4a) ──→ T-005 ──→ T-006 ──→ T-007 ──→ T-008 ──→ T-009 ──→ T-010 ──→ T-011 ──→ T-012 ──→ T-013 ──→ T-014 ──→ T-015 ──→ T-016
        │
        └─ Codex Review #2/#3 (plan/tasks) 在 T-004 之前完成
                                                                        │
                                                                Codex Review #4 (implement) 在 T-011 之前完成
                                                                                                                                                                          │
                                                                                                                                                       Codex Review #5 (verify) 在 T-016 之前完成
```

---

## 验收

- **SC-001 (FR-001/FR-004/FR-010)**: T-007 verify report `sc_001.pass == true` (含 partial 豁免)
- **SC-002 (FR-007)**: T-007 verify report `sc_002.verdict ∈ {strong, weak, negative}` (不为 ambiguous，或 ambiguous 但 partial < 4 fixture)
- **SC-003 (FR-007/FR-008/FR-009)**: T-008/T-009/T-010 完成且 §10.5.1.10 + §10.4 + §1 修订人工 + Codex 复核通过
- **SC-004 (FR-014)**: T-012/T-013/T-014 全 pass
- **SC-005**: 5 Codex review critical 清零
