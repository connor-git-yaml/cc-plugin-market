# F286 plan

## 取舍

1. **词法而非 AST**：FR-012 明确本检查只拦无意遗漏；AST 级「调用 vs 引用」区分要接 TS program、跨 .mjs/.ts 两套解析器，成本落在 M11 引擎化。词法版一个脚本零依赖，先把义务与模板落地。
2. **`--base` 必填**：默认 `HEAD` 会让「未提交改动」之外的所有新增符号消失（空集静默通过），这是 F277 FR-010 的契约字段要求；宁可 exit 2。
3. **spec-review 给受限 Write 而不是改措辞成「返回正文」**：账本给了两条路，选 Write——报告落盘由子代理自己完成，编排器只核对文件存在，少一次手工转录（转录是 F279 报告流失的直接原因）。
4. **证据包预跑注入而不是 Bash 白名单**：F279 实证前者可行且成本低；只读 git 白名单仍覆盖不了 `node --test`。
5. **RED 级取证按任务 append**：攒到最后一次性写等于押注不断连（F279 63 次调用后断连）；替代证明 SOP 作为兜底写进 verify.md Layer 1.86。

## 改动清单

- 新：`plugins/spec-driver/scripts/export-reachability.mjs`、`tests/export-reachability.test.mjs`、`tests/f286-handoff-contracts.test.mjs`
- 改：`agents/verify.md`、`agents/verify.artifact.yaml`、`templates/verification-report-template.md`、`agents/spec-review.md`、`agents/spec-review.artifact.yaml`、`agents/implement.md`、`skills/spec-driver-{feature,story,implement,fix}/SKILL.md`（+ `skills-codex/`、`.codex/skills/` 再生副本）

## 回归护栏

- 守护测试 16 条钉住措辞（防下次 SKILL 重排把前置段删掉）；
- `repo:check` 的 wrapper SHA 校验钉住三副本同步。
