---
feature: 176
artifact: preregistration
frozen: false
taskSetHash: TBD_AFTER_IMPORT
seed: 176
count: 0
gitCommit: TBD
# host import 后填：把实际 10 个 task id 列入 taskIds，并用 freezeBlock() 算 taskSetHash，frozen 改 true
taskIds: []
filterRule:
  dataset: princeton-nlp/SWE-bench_Verified
  repos: TBD
  minDate: TBD
  maxPatchFiles: 3
  limit: 10
  minFixtures: 8
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
