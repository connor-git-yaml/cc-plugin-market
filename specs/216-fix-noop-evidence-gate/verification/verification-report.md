# F216 最终独立验证报告（verify phase）

## 执行环境

- **HEAD commit**: `736da8f2e284b18ebdcfd30137d18ab4e472a13f`（2026-07-21 02:24:05 +0800）
- **分支**: `claude/f216-noop-evidence-gate-85136d`
- **验证时间**: 2026-07-20T18:32Z（UTC）
- **工作树状态**: 非全干净——存在未提交微修（测试断言收紧 + fixture README 注记回填），本次验证基于**工作树现状**（含这些微修）实跑，未依赖任何前置子代理声明。
  - `plugins/spec-driver/tests/fix-compliance-core.test.mjs`（双键同现断言由 `assert.ok(includes)` 收紧为 `assert.deepEqual(排序后精确比对)`，杜绝杂键混入）
  - `plugins/spec-driver/tests/fixtures/fix-compliance/README.md`（补写"能力边界补注状态"落地说明）
  - `specs/216-fix-noop-evidence-gate/trace.md`（追加时间线条目）
  - `specs/src.spec.md`（无关的自动再生 docgen 产物，源于本地构建环境的既有 drift，与本 feature 改动无因果关系，不阻断）

---

## 命令逐条真实输出摘要

| # | 命令 | Exit Code | 结果摘要 |
|---|------|-----------|----------|
| 1 | `node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs` | **0** | tests 131, pass 131, fail 0, cancelled 0, skipped 0 |
| 2 | `node --test plugins/spec-driver/tests/fix-compliance-io.test.mjs` | **0** | tests 42, pass 42, fail 0, cancelled 0, skipped 0 |
| 3 | `node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` | **0** | tests 49, pass 49, fail 0, cancelled 0, skipped 0 |
| 4 | `npm run test:plugins` | **0** | tests 552, suites 117, pass 552, fail 0, skipped 0 |
| 5 | `npx vitest run`（全量） | **0** | Test Files 444 passed \| 4 skipped (448)；Tests 5240 passed \| 18 skipped \| 21 todo (5279)；耗时 34.94s；**本次运行未命中已知 flaky（watch-command / community-analysis perf / cli-e2e --version）**，全绿一次通过 |
| 6 | `npm run build` | **0** | `tsc` 零错误；`postbuild-stamp` 正常盖章（commit=736da8f2 dirty） |
| 7 | `npm run repo:check` | **0** | 全部规则项逐条 `pass`（wrapper 双写、release-contract、orchestration-overrides、preference-rules、delegation-contract、orchestrator-model、namespace-consistency 等） |
| 8 | `npx vitest run tests/unit/spec-driver/wrapper-sha256.test.ts` | **0** | Test Files 1 passed；Tests 9 passed（sha256 漂移检测、缺 sha 检测、正常场景三态全过） |

**说明（命令 5 内部日志噪声排查）**：`grep -n "failed\|✗"` 在全量日志中命中的 `[1/1] mod ... failed` 与 `✗ 错误:` 字样，均来自 `tests/unit/batch/batch-orchestrator-incremental.test.ts` 等测试**用例内部构造的模拟失败场景**（测试断言这些内部"failed"字样被正确处理），不代表 vitest 测试用例本身失败；vitest 官方汇总行 `Test Files 444 passed | 4 skipped` / `Tests 5240 passed | 18 skipped | 21 todo` 才是权威计数，其中 0 个 failed。

---

## SC 逐条核验

| SC | 结论 | 证据 |
|----|------|------|
| **SC-001**（合成回归：无证据 no-op 拦下 + 有证据 no-op 放行）| **PASS** | `fix-compliance-judge-cli.test.mjs::F216 T017` 用例 `'F216 T017 noop-unverified-citation → block exit 2 + 要求产出 repro 的 next-step（SC-001）'`（断言 exit 2 + missing 含 next-step 文案）与 `'F216 T017 compliant-noop-with-repro → 合规放行 exit 0（SC-002）'`（放行分支，二者互为对照）均通过；另有 `legacy-noop-without-repro`（FR-011 旧版兼容）、`noop-non-bash-tool-execution`（EC-007）、`noop-no-repro-claims`（EC-003）三条边界 fixture 全部实测通过 |
| **SC-002**（正向路径零摩擦）| **PASS** | `compliant-full.jsonl`（真修复路径，用例名 `'证据门零介入、继续绿（FR-007）'`）+ `compliant-noop.jsonl` 升级版（`'升级后 compliant-noop.jsonl → 合规放行 exit 0（回归护栏不误伤）'`）均放行 exit 0；`fix-compliance-core.test.mjs` 131 项含 `classifyClosureForm` 互斥锚点、C1/C3/C4/C5/W1/C2 系列全绿，无假阳性阻断证据 |
| **SC-003a**（确定性序列闭环：阻断→补证据→放行）| **PASS** | `fix-compliance-judge-cli.test.mjs::F216 T018` describe 块 `'SC-003a：阻断→补证据→放行序列闭环'`，用例 `'无证据 no-op 阻断 exit 2 → 补齐复现证据 → 放行 exit 0 + F211 清零'` 实测通过（61.28ms），验证了 F211 补救清零联动 |
| **SC-003b**（手工 headless 模型 smoke，非门禁）| **PARTIAL（不阻断）** | 代码侧已就绪：`plugins/spec-driver/scripts/dev/spike-fix-compliance-e2e.mjs` 已含 `--scenario noop-unverified` 分支（tasks.md T024 可选子项要求项）；但**本次未实际手工跑通**——环境侧 Claude CLI OAuth 已过期（`project_eval_claude_oauth_expiry_blocks_drivers` 已知问题），无法验证真实 headless 模型下 Stop hook 线路与退出码转发。spec.md 明确此项"非门禁、手工、不计入 CI"，tasks.md T024 验收判据也允许"若未执行需在交付说明中显式注明未跑原因"——本报告即为该注明。**不阻断**发布，待环境（`claude /login`）恢复后补跑一次记录 |
| **SC-004**（F208 判定合同不回归：三档/降级/清零/切换矩阵）| **PASS** | `fix-compliance-judge-cli.test.mjs::F216 T019` describe 块 `'SC-004 档位切换矩阵 + W7 精确窗口'`，四条用例全过：`'W2 block→warn→block：同一 session 计数轨迹精确（warn 不 bump、切回续阻断至降级）'`、`'W2 block→off→block：off 零接触不改计数，切回续阻断（同一 session 精确 count）'`、`'warn 下合规清零旧计数'`、`'W7 精确窗口：预装 count=2 + 仅缺新 repro 证据 → 首次降级放行 + 审计 missing 仅新键 → 补证据清零'`；另 `npm run test:plugins` 中"向后兼容：未传 complianceVerdict 时事件不含该键"等既有 F208 回归套件（7 项）与新增"complianceVerdict 字段"套件（4 项）同批全绿，未见回归 |
| **SC-005**（wrapper 同步链：SKILL.md 改动 → 双写重生 + sha 匹配）| **PASS** | `npx vitest run tests/unit/spec-driver/wrapper-sha256.test.ts` 9/9 全过（含"改 source 一行 → fail（sha 不匹配）"、"删 wrapper 的 Source SHA256 行 → fail"两条负向断言，证明检测器有牙齿）；`npm run repo:check` 中 `spec-driver-wrappers:*`、`spectra-skills:canonical-source-skills`、`compatibility-mirrors` 等条目均 `pass` |
| **SC-006**（全量门禁零失败）| **PASS** | 命令 4-7（`test:plugins` / `vitest run` 全量 / `build` / `repo:check`）本次实跑 exit code 均为 0，零失败 |

---

## 制品完整性核验

`specs/216-fix-noop-evidence-gate/` 下逐项存在性 + 非空核验：

| 制品 | 存在 | 非空（行数） |
|------|------|-------------|
| `spec.md` | ✅ | 203 行 |
| `plan.md` | ✅ | 345 行 |
| `tasks.md` | ✅ | 415 行 |
| `clarifications.md` | ✅ | 87 行 |
| `checklists/requirements.md` | ✅ | 163 行 |
| `research/tech-research.md` | ✅ | 191 行 |
| `verification/spec-review.md` | ✅ | 28 行，结论 **READY-FOR-GATE**（19 FR SATISFIED / 10 EC / 0 CRITICAL / 0 WARNING / 2 INFO） |
| `verification/quality-review.md` | ✅ | 24 行，总体评级 **GOOD**（1 项结构债——`fix-compliance-core.mjs` 819 行越自设 600 阈值，已开 follow-up 任务卡；231 用例实跑全绿） |
| `trace.md` | ✅ | 含完整 phase 时间线，含本轮 spec-review/quality-review/micro-fix 记录 |

制品链条完整，无缺失、无空文件。

---

## 已知未闭合项

1. **SC-003b 手工 headless smoke 未跑**：原因为 Claude CLI OAuth 过期（环境侧问题，非代码缺陷）。代码侧（`spike-fix-compliance-e2e.mjs` 的 `noop-unverified` scenario）已就绪，`spec.md` / `tasks.md` 均明确此项非门禁、可延后补跑。**不阻断**本次交付。
2. **`fix-compliance-core.mjs` 结构债**：819 行越 plan 自设 600 行拆分阈值，quality-review.md 已记录为"收口即立项 follow-up：抽 execution-record 子模块"，非本次功能缺陷，不阻断。
3. **`specs/src.spec.md` 无关 diff**：本地构建环境自动再生的 docgen 产物（`lastUpdated`/`skeletonHash`/统计数字漂移），与本 feature 改动无因果关系，非本次交付范围产物，建议提交时按仓库既有约定排除或单独处理（不影响本次 SC/FR 验证结论）。

---

## 总结论

### ✅ READY-FOR-GATE

理由：
1. 命令 1-8 全部真实实跑，退出码均为 **0**，零失败（node --test 三套件 222/222 pass；test:plugins 552/552 pass；vitest 全量 5240 pass / 0 fail；build 零错误；repo:check 全项 pass；wrapper-sha256 9/9 pass）。
2. SC-001/SC-002/SC-003a/SC-004/SC-005/SC-006 六条硬性 Success Criteria 均有具体测试用例名与断言逐条对应，实测 PASS。
3. SC-003b（手工非门禁项）因环境（Claude CLI OAuth 过期）未跑，代码就绪、按 spec 既定"非门禁"语义处理，不阻断。
4. Layer 1 制品链条完整（spec/plan/tasks/clarifications/checklists/research/verification 全部存在且非空），spec-review（READY-FOR-GATE，19/19 FR）与 quality-review（GOOD，1 项非阻断结构债）交叉印证一致。
5. 未发现与本 feature 相关的回归、假阳性、假阴性或制品缺失。

**唯一遗留待办**：环境恢复（`claude /login`）后手工补跑 SC-003b 一次，记录退出码与成本；`fix-compliance-core.mjs` 拆分作为 follow-up 立项，均不阻断本次交付。
