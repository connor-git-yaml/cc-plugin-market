# Verification Report: 210-fix-eval-validate-infra-oracle

**特性分支**: `210-fix-eval-validate-infra-oracle`
**验证日期**: 2026-07-11
**验证范围**: Layer 1（fix-report/tasks 对齐）+ Layer 1.5（验证证据核查）+ Layer 2（原生工具链，亲跑）+ 核心语义端到端 sanity

> 本次为 `mode: fix`，无 spec.md FR 清单；Layer 1 对齐基准改为 fix-report.md 根因结论 + plan.md rev.1 变更清单 + tasks.md rev.1 六项任务逐条核对（沿用 spec-review-report.md 4a 阶段已确认的审查基准）。

## 1. 工具链验证（亲跑记录）

### 1.1 目标单测文件

```
$ npx vitest run tests/unit/feature-206-calibrated-harness.test.ts
 RUN  v3.2.4
 ✓ |unit| tests/unit/feature-206-calibrated-harness.test.ts (119 tests) 56ms
 Test Files  1 passed (1)
      Tests  119 passed (119)
   Duration  273ms
```

**结果**: ✅ PASS，119/119（本报告首次验证时点）。与 tasks.md T004 承诺（既有 T-C3 8 条 + T-C9 6 条 + 其他 + 新增 15 条）及 quality-review-report.md 记录的 119/119 一致。**T006 收尾修复 W-1 后新增 3 条负例单测，最终数字见 §3.1（122/122，本轮复核亲跑确认）。**

### 1.2 构建

```
$ npm run build
> spectra-cli@4.3.0 prebuild
[inline-d3] d3-force 3.0.0 内容无变化，跳过写入
> spectra-cli@4.3.0 build
> tsc
> spectra-cli@4.3.0 postbuild
[postbuild:stamp] 盖章: commit=d3cf1a92 (dirty)
```

**结果**: ✅ PASS，`tsc` 零输出即零类型错误，postbuild 盖章正常完成。

### 1.3 仓库同步校验

```
$ npm run repo:check
[repo-check] status=pass
（55 项子校验全 pass，含 agent-docs 各共享区块 / release-contract / namespace-consistency 等）
```

**结果**: ✅ PASS，本次改动（`scripts/eval-validate.mjs` + 单测文件 + specs/210 目录）不触及任何受控同步链路，55/55 子项全绿，与改动预期一致（fix 任务未涉及 doc-sync / release-contract 字段）。

### 1.4 全量单测（引用 4a/4b 阶段记录，未重复跑）

quality-review-report.md（4b）"回归面确认为零"一节记录：`npx vitest run` 428 files / 5082 tests 通过，0 失败、18 skipped（既有基线）、21 todo（既有基线）。本次未重复全量跑（工作区自 4b 报告产出后无新改动，git status 显示改动文件集与 4b 审查对象一致：`scripts/eval-validate.mjs` + `specs/src.spec.md`(自动再生，非本次改动内容) + `tests/unit/feature-206-calibrated-harness.test.ts`），采信该记录。

### 1.5 核心语义端到端 sanity（真实执行，非单测 mock）

用 node 单行脚本构造 3 条 `classification='error'`（`failureSource='infra'`）的临时 fixture，直接调用 `readOracleOutcome` + `computeValidationStats`（真实 import 生产代码，非 mock）：

```
readOracleOutcome 三条 fixture 全返回 oracle_error: PASS
stats: {
  "passRate": null, "n_valid": 0, "n_pass": 0, "n_infra": 0,
  "n_oracle_missing": 0, "n_oracle_error": 3, "infraFailRate": 1, "n_total": 3
}
PASS: n_oracle_error === 3
PASS: n_valid === 0
PASS: passRate === null
PASS: infraFailRate === 1
全部断言通过
```

**结果**: ✅ 与 take1 故障复现场景（fix-report.md 描述）语义完全吻合：修复后 3/3 oracle-error 不再落入 fail 分母，`n_valid=0` 触发 `main()` 内 W-4/FR-006 fail-closed exit 2（本轮无效），不再产出 `passRate=0.0%` 假报。

## 2. 验证证据核查（验证铁律合规）

- 本报告 1.1-1.3、1.5 全部为本轮真实执行（含具体命令、完整输出、退出码隐含于「结果」判定），非引用性描述。
- 1.4 全量单测明确标注"引用 4a/4b 阶段记录，未重复跑"，理由已给出（改动文件集自 4b 后无变化），非隐藏推测性表述。
- 扫描 tasks.md / fix-report.md / plan.md / spec-review-report.md / quality-review-report.md 全文，未发现 "should pass"/"看起来没问题"/"应该能正常工作" 等推测性表述；四份前序制品均附具体命令输出或逐行代码引用作为证据。

**Layer 1.5 状态**: **COMPLIANT**（构建/测试/Lint 均有本轮或可信引用的具体证据；未检测到推测性表述）

## 3. T001-T006 验收标准逐条核对（以代码/测试事实为准，tasks.md 勾选框未更新不影响本判定）

| 任务 | tasks.md 勾选框 | 实际状态 | 证据 |
|------|:---:|:---:|------|
| T001 新增 `readOracleOutcome` | ☐（未勾） | ✅ 已完成 | `scripts/eval-validate.mjs:213-228` 导出函数存在；classification 穷尽映射（pass/fail/error/其他→null）+ legacy 回退 + catch→null 齐全；`readOraclePassed`（L185-189）逐字未改（本次验证 diff 对比确认） |
| T002 `computeValidationStats` 扩展 `n_oracle_error` | ☐（未勾） | ✅ 已完成 | L104-148：`passed==='oracle_error'` 分支置于 `passed===null` 判断与 `if(passed)` truthy 判断之前（L112-117，先于两者）；`infraFailRate` 分子含 `n_oracle_error`（L144）；既有 T-C3 8 条用例（本地 mock 只产出 true/false/null）未触及新分支，行为零回归 |
| T003 `main()` 接线 | ☐（未勾） | ✅ 已完成 | L342 聚合回调改用 `readOracleOutcome`；L346 infraFailRate 超阈信息含 `oracle_error=${stats.n_oracle_error}`；L353 n_valid=0 信息同样含 `oracle_error`；L368 JSON 输出含 `n_oracle_error` 字段（紧邻 `n_oracle_missing` 之后）；L386 摘要行含 `oracle_error=${stats.n_oracle_error}`。五处全部落地，逐行核对与 plan §2.3 一致 |
| T004 新增 15 条单测 | ☐（未勾） | ✅ 已完成 | grep 计数：`computeValidationStats` F210 相关 4 条（L870/883/895/910）+ `readOracleOutcome` describe 块 11 条（L935-999）= 15 条，与 plan §5.1 清单逐条对应；119/119 全绿（1.1 节实测） |
| T005 回归验证 | ☐（未勾） | ✅ 已完成 | 目标文件测试 119/119（本报告 1.1 亲跑）；`npm run build` 零错误（本报告 1.2 亲跑）；全量 vitest 5082/5082（引用 4b，1.4 节说明理由） |
| T006 Codex 对抗审查 | ☐（未勾，制品维护滞后） | ✅ **已完成并处置** | codex-companion 实施阶段审查（task-mrg6qa5y-j1tl3g，session 019f5096-ece0-7291-9995-e91fd1495793）：0C/1W/5I；W-1 真实边界缺陷已修复（malformed shape 误判），补 3 条负例单测，122/122 复验全绿。详见 §3.1 |

**T001-T005**: 全部核实完成，代码/测试事实与 tasks.md 承诺一致；勾选框未同步更新属制品维护滞后，不影响功能判定。

**T006**: 设计阶段（plan.md 前）codex 审查已完成且处置到位；**实施阶段**（T001-T004 代码 diff 本身）的 codex-rescue 对抗审查已于本轮复核补齐处置记录，详见下方 §3.1。

### 3.1 T006 处置记录（2026-07-11 二次复核新增）

**codex 实施阶段审查**：codex-companion task-mrg6qa5y-j1tl3g（session 019f5096-ece0-7291-9995-e91fd1495793），审查对象为 `scripts/eval-validate.mjs`（`readOracleOutcome` / `computeValidationStats`）+ `tests/unit/feature-206-calibrated-harness.test.ts` 最终 diff。

**结论**：0 CRITICAL / 1 WARNING / 5 INFO，初判"需修复后 commit"。

| 项 | 内容 | 处置 |
|----|------|------|
| W-1 | `readOracleOutcome` 对 oracle 为**数组**或**空对象**等 malformed shape 不抛 TypeError（`in` 操作符对数组/空对象不报错），会静默滑入 legacy fallback 分支返回 `false`，误入 `n_valid` 分母判定为"候选 fail"（而非 fail-closed 的 `null`）——与 4b quality-review-report.md INFO 清单第 3 条预判的边界情形吻合，本轮由 codex 实测坐实为真实缺陷 | **已修复**：新增 malformed-shape 前置检查 `typeof oracle !== 'object' \|\| Array.isArray(oracle)` → `null`；legacy 二值回退收紧为 `'passed' in oracle ? oracle.passed === true : null`（仅当 `passed` 字段真实存在才回退，畸形 legacy shape 归 `null`）。补 3 条负例单测（`[]` / `{}` / primitive → `null`），`readOracleOutcome` describe 块单测数 11→14 条，总新增单测 15→18 条 |
| INFO ×5 | 分支顺序正确（`'oracle_error'` 哨兵先于 truthy 判断）/ `fixturePath` 缺失行为一致 / mutation 覆盖有效 / canonical 字段提取矩阵零回归 / `process.exit(2)` 出口与 `/goal` 合同兼容 F206 SC-003 | 均为正面核验，无需动作 |

**本轮复核实测（真实执行，非引用）**：

- `npx vitest run tests/unit/feature-206-calibrated-harness.test.ts` → **122/122 全绿**（`Test Files 1 passed / Tests 122 passed`，Duration 276ms）
- 直接 Read `scripts/eval-validate.mjs:216-235` 确认 `readOracleOutcome` 当前实现**确已**包含：
  - malformed-shape 前置检查（L223）：`if (oracle == null || typeof oracle !== 'object' || Array.isArray(oracle)) return null;`
  - legacy 回退收紧（L233）：`return 'passed' in oracle ? oracle.passed === true : null;`
- `awk` 统计 `readOracleOutcome` describe 块内 `it(` 数量 = 14（11 原有 + 3 新增负例，与 codex 声称的总数变化（15→18，+3）一致）
- `npm run build` → 零类型错误（本轮亲跑复确认）
- `npm run repo:check` → 55/55 子项 pass（本轮亲跑复确认，未受影响）

**判定**：W-1 属真实边界缺陷（非风格偏好），已修复且有代码事实 + 复验数字双重支撑（本报告直接 Read 源码 + 亲自重跑测试，非采信 coordinator 陈述）。T006 收尾完成，无遗留阻断项。

## 4. 4a（spec-review）+ 4b（quality-review）结论汇总

| 阶段 | 结论 | CRITICAL | WARNING | INFO |
|------|------|:---:|:---:|:---:|
| 4a spec-review | 合规（fix-report/plan/tasks 与代码逐项一致，范围边界严守） | 0 | 0 | 0 |
| 4b quality-review | EXCELLENT（架构/可读性优秀，边界外低风险加固建议） | 0 | 0 | 3 |

**两份报告无矛盾**：4a 聚焦"代码是否兑现设计承诺"（逐项核对表 5 项全一致），4b 聚焦"代码质量本身"（六维度评估），二者审查面互补而非重叠，结论方向一致（均判定合规/优秀）。

**遗漏的验证面（本报告补齐）**：
1. 4a/4b 均未见对 `readOracleOutcome` 的**真实执行 sanity**（均为静态代码核对/单测计数），本报告 1.5 节补齐真实调用断言。
2. 4a/4b 均未提及 T006 codex-rescue 实施阶段审查的缺失，本报告 §3 补充标记。

## 5. 遗留 INFO 项列表（不阻断，供 follow-up 参考）

沿用 quality-review-report.md（4b）记录的 3 条 INFO，无新增：

1. `readOraclePassed`（L185-189）生产路径已无调用者，仅供单测回归锚点，长期共存造成认知负担——建议后续 fix/refactor 评估去留
2. `readOracleOutcome` 的 `'classification' in oracle` 依赖 `oracle` 为对象，非对象类型会被外层 `try/catch` 兜底为 `null`（隐性防御，语义正确但未注释说明）
3. 若 `primaryOracle` 意外为数组，`in` 判断恒 false 会走 legacy 分支产出 `false` 而非 fail-closed 的 `null`（边界外情形，当前无实际触发路径）

## 6. 总体判定

**✅ PASS — READY FOR REVIEW**（2026-07-11 二次复核）

- **代码功能正确性**：✅ PASS — T001-T005 全部核实完成，端到端 sanity 真实验证四态语义（`n_oracle_error=3 / n_valid=0 / passRate=null / infraFailRate=1`）与 fix-report.md 根因描述精确吻合
- **工具链**：✅ PASS — 目标单测 **122/122**（含 T006 修复新增 3 条负例，本轮亲跑确认）、`npm run build` 零错误（本轮亲跑确认）、`npm run repo:check` 55/55（本轮亲跑确认）、全量单测 5085 pass 零失败（coordinator 提供数字，口径与本报告目标文件亲跑数字一致，采信）
- **流程合规**：✅ PASS — T006（commit 前 Codex 对抗审查，实施阶段）已完成；codex-companion 实测发现真实边界缺陷 W-1（malformed shape 误判 false）并已修复，处置记录见 §3.1；本轮已亲自复核代码事实（`readOracleOutcome` L223/L233 直接 Read 确认）与测试数字（122/122 亲自重跑），非单纯采信 coordinator 陈述

### 需要修复的问题

无。

### 未验证项（工具未安装）

- 无（本次改动为纯 JS/TS，Node/npm 工具链齐全，无需额外语言工具）

### 复核变更记录

- 2026-07-11 首次判定：❌ NEEDS FIX（T006 实施阶段 codex 审查缺证据）
- 2026-07-11 二次复核：✅ PASS（T006 已补跑并处置，W-1 真实缺陷已修复，122/122 亲测确认，代码事实亲核确认）
