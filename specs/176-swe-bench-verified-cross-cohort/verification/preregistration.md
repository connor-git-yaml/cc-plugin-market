---
feature: 176
artifact: preregistration
frozen: true
taskSetHash: 6c5ed1c0709eb94350588e1bc692acf09e79034f00ee8078ab8040e119741668
seed: 176
count: 10
gitCommit: 112d099100a3fc6dbf8c52e1c6e491d2ae3defd6
oracleSpecHash: f4044f212eedb16adb72c9d8342e748511b6665b74361d21739e571c5f73166a
fixtureContentHash: 19d8d42187d98235c4fa5369b898ac7308eb21e6ddc3b0788f0787cef53a71e0
promptSha256: a06fd18a7671f49ec300608949c20bb89cff646099ea9385bf714ae00eedcff0
schemaVersion: 1.0
frozenAtIso: 2026-07-19T05:25:22.557Z
taskIds:
  - SWE-V001-sympy-the-evaluate-false-parameter
  - SWE-V002-sympy-rational-calc-value-error
  - SWE-V003-sympy-polyelement-as-expr-not
  - SWE-V004-sympy-check-homomorphism-is-broken
  - SWE-V005-sympy-collect-factor-and-dimension
  - SWE-V006-pytest-consider-mro-when-obtaining
  - SWE-V007-sympy-si-collect-factor-and
  - SWE-V008-sympy-contains-as-set-returns
  - SWE-V009-sympy-physics-hep-kahane-simplify
  - SWE-V010-pytest-unittest-testcase-teardown-exe
---

# F176 预注册（防 falsification 规避 — spec FR-A-002b）

> ⚠️ **冻结时机**：host 跑完 Verified import（T-A2）+ oracle 可执行性 smoke（≥阈值）**之后**、跑首个全量 run **之前**，把本文件冻结：
> 1. 把实际选中的 10 个 task id 填入 frontmatter `taskIds`；
> 2. `node -e "import('./scripts/lib/preregistration-check.mjs').then(m=>console.log(m.computeTaskSetHash([...])))"` 算 `taskSetHash` 填入；
> 3. `frozen: true`；填 `seed` / `filterRule` / `gitCommit`（冻结时 HEAD）。
>
> 冻结后 batch 启动会用 `checkPreregistration` 校验"实际要跑的 task 集 hash == 此处 taskSetHash"，不符 hard-fail。

## 不变量
- 全量 MUST 跑满冻结的全部 task × 5 cohort × N=3。
- **禁止**跑后剔除/替换 task 影响 lift；唯一允许剔除是 `ORACLE-UNAVAILABLE`（如实计数，见报告）。
- 每 (task,cohort,repeat) 因 infra error 最多重跑 1 次，记录原因。
- 任何对本预注册的偏离 → 报告 falsification 附录如实记录。

## 选择依据（host 填）
<!-- TODO host: 为何选这 10 个 task（可解性 / 依赖轻 / repo 分布），oracle smoke 通过率 -->
