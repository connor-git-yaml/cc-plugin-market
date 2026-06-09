---
feature: 176
phase: Implement（cohort-无关第二批：importer/preregistration/aggregate/forbidden-claims）— Codex 审查
date: 2026-06-09
reviewers: Codex (codex-rescue) + Claude (main-thread, 实测验证)
---

# F176 Implement 第二批对抗审查 — 处置记录

> Codex：2 CRITICAL + 4 WARNING + 1 INFO。全处置 + 实测（37 F176 单测 + py_compile 全绿）。

| 档位 | finding | 处置 + 验证 |
|------|---------|------------|
| 🔴 C-1 | passRate 的 bootstrap CI 实际算的是 **median** CI（复用 bootstrap-ci.mjs 每次取 median，0/1 样本 median 恒 0/1，CI 无意义）| 新增 `bootstrapProportionCi`（每次重采样取 **mean**=比例），cohortStats 改用之。**实测**：0/1 样本 CI 现在 bracket passRate（0<low≤0.5≤high<1）|
| 🔴 C-2 | preregistration 可"改 ids + 重算 hash"绕过（只读同文件 hash）| 加 (1) 内部一致性：`hash(frontmatter.taskIds)==taskSetHash`（ids 与 hash 必须自洽）；(2) 可选外部锚 `expectedHash`；(3) 文档化 git-commit 为真正 anti-tamper（prereg 入库+报告记 commit）。**实测**：改 ids 不改 hash → fail |
| 🟡 W-1 | importer Lite 默认非 byte-for-byte（notes 从 `…via T-020` 改了）| Lite 默认恢复**精确原字面值** `imported from princeton-nlp/SWE-bench_Lite via T-020`，仅非默认 dataset 才参数化 |
| 🟡 W-2 | degradation note 硬编码 Lite 语义（"~2023-06"/"升级到 Verified"，Verified 跑会写错）| `write_degradation_note` 加 `dataset_id` 分支：Lite/Verified 各自正确文案 |
| 🟡 W-3 | forbidden-claims 同**行**限定语豁免全行（长行塞一个 internal-cohort-only 全过）| 改按**句**切分（中英标点边界），逐句判限定语 |
| 🟡 W-4 | frontmatter 正则 parser 脆（CRLF/多行 list/quoted hash/`truex` 误匹配）| 改严格逐行解析：CRLF 归一、词边界 frozen、quoted hash、inline+多行 list |
| ℹ️ INFO | passRate 未读 jury 符合 KD-2 → 补负向测试防回归 | 加测试：oracle fail+juryPassed=true → passRate 仍只数 oracle |

## 验证
- 37/37 F176 单测绿（新增 proportion CI ×2 + jury-不污染-passRate ×1）
- importer py_compile OK；Lite 默认 4 个值 + notes 字面值 byte 保留
- 全量 vitest：见 commit（仅 panoramic flaky）

## 累计 review（供报告 FR-C-007）
- implement 两批 codex review 共 5 CRITICAL 全修（版本门禁绕过 / spike 进程失败 / spike 非 sub-agent / median-vs-mean CI / prereg 绕过）。
- 重叠高置信 + 独有补盲贯穿全程；尤其"统计口径错误（median CI）"是 Claude 自审未抓、Codex 独有的关键正确性 bug。
