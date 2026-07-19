# 实施计划 — 212 M8 收官评测 closeout

**Base**: master `4d1fb05` | **Worktree**: `.claude/worktrees/m8-closeout-212` | **Branch**: `212-eval-rerun-m8-closeout`

## 编排（cheap-first，spend 门控 — D-2）

```
Phase T0 (代码)   ── calibrate oracle_error 对齐 + 单测 + Codex 审查      [$0, 无凭据]  ← freeze 前必做
        │
        ▼ (freeze oracle 语义)
Phase P2 (评测)   ── 133 份 M7 答卷离线重判·复核                          [≈$0, 无 OAuth]
        │
        ▼
Phase PREP (勘验) ── 全池 33-run + A/B 60-run 批 prep + dry-run           [$0, 不真跑]
        │           · disable 全局 spectra plugin 校验
        │           · oracleSpecHash 冻结比对
        │           · manifest / cohort / enforcement=block 配置勘定
        ▼
🚦 GO/NO-GO 门控  ── 交用户：OAuth `claude /login` + 配额窗口 + 批计划确认
        │
        ▼ (用户 go 后，另起执行会话)
Phase RUN (付费)  ── 全池 33-run(headline) + A/B 60-run  [烧配额+SiliconFlow$，每6run查配额]
        │
        ▼
Phase REPORT      ── 四方终表更新 + 133 结论 + A/B 双指标 + PUBLISH-REPORT-M8 + dogfooding
```

## Phase T0 — calibrate oracle_error 对齐（本 feature 唯一生产代码改动）

**改动文件**：`scripts/eval-calibrate.mjs` + `tests/unit/feature-206-calibrated-harness.test.ts`

**镜像参照**：`scripts/eval-validate.mjs` `readOracleOutcome`(:216-235) + `computeValidationStats`(:104-148)。

**实施步骤**：
1. calibrate 新增 `oracleOutcomeFromFixture(fix)`（tri-state 纯函数）+ `readOracleOutcome(fixturePath)`（文件包装，catch→null），classification 穷尽映射与 F210 逐字一致：`'pass'→true / 'fail'→false / 'error'→'oracle_error' / 其他已知外值→null`；仅无 `classification` 字段的 legacy `{passed}` shape 才二值回退（`'passed' in oracle ? passed===true : null`）；malformed(非对象/数组/null)→null。
2. `resolvePass`(:347) 从 `Boolean(readOraclePassed(...))` 改为 `(r) => (r.fixturePath && fs.existsSync(r.fixturePath)) ? readOracleOutcome(r.fixturePath) : false`（缺 fixture → false=fail，保留现有保守口径；null/missing → false 保守，与 188 §5 记的有意口径一致；仅 `'oracle_error'` 新剔）。
3. `aggregateRunResults`(:438) 增 `oracleErrorCount`：循环内 `const p = resolvePass(r); if (p === 'oracle_error') { oracleErrorCount++; continue; }`（**顺序先于** `push(p ? 1 : 0)`）；`excludedRate = (infra + error + oracleError) / len`；返回体加 `oracleErrorCount`（additive）。
4. 调用点(:348-360)解构补 `oracleErrorCount`，entry 加 `oracleErrorRate`，console.log 加 `oracleError=`（观测性，镜像 validate log）。
5. 单测：T-C7 `aggregateRunResults` describe 内新增 oracle_error 用例（哨兵剔分母 / 顺序防误判 pass / excludedRate 计入）+ 新 `readOracleOutcome`(calibrate) describe（classification 五态 + legacy 回退 + malformed）。

**保守边界（不做，避免 scope creep 超 T0）**：不改 calibrate 的 `null`(oracle_missing)→fail 保守口径（188 §5 记为有意）；`oraclePassedFromFixture`（validate 仍 import）保留不动；F206 fail-closed 阈值逻辑（excludedRate≥0.5 abort）自动受益于 oracleError 计入，不额外改。

**验证**：`npx vitest run tests/unit/feature-206-calibrated-harness.test.ts` 全绿；跑全 `npm run test`（或至少 tests/unit）确认零回归。

## Phase P2 — 133 离线重判·复核

复用 188 P1 驱动（`runSwebenchInstance`，dataset=verified，fixture 源 F176 worktree 产物 `19d8d42` 字节同源 or `~/.spec-driver-bench-patches/m7-f176/`）。freeze 工具写 oracleSpecHash，与 F176/F197 冻结值比对。error/oracle_error 剔分母。产出 vs 188 P1 的一致性复核（含 T0 后 oracle_error 口径变化影响评估）。取证先存档（`git worktree` 隔离 / 独立 runId），禁覆盖 188 现场。

## Phase PREP — 批勘验（不真跑）

- 校验全局 spectra plugin 状态 + disable 方案。
- `checkPreregistration` 三 hash（oracleSpecHash / fixtureContentHash / taskSetHash）比对，确认无意外漂移。
- cohort-batch manifest 勘定：cohorts=[c1,c3]、`swebenchOracle:true`、`swebenchTimeoutMs:300000`、F208 enforcement=block 配置项定位。
- dry-run 确认 run 计划数（33 headline / 60 A/B）。
- 汇总 go/no-go 清单（OAuth 状态 / 配额窗口估算 9-12hr / SiliconFlow<$20 / 阻塞项）。

## 风险与护栏（F206 战役血泪）

- Codex 复审必显式禁 resume + 校验 session ID（否则返陈货）。
- 慢验窗口内禁改 `plugins/**`（eval 活读 worktree plugin，中途改=两 take 测不同版本）。
- runId 跨批复用覆盖取证 → 重要取证先存档。
- oracle 语义 T0 后 freeze，跑批零改动。
- push 前列 report 等用户确认；`src.spec.md` 排除出 commit；禁 `git add -A`。
