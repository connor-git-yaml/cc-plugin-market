---
feature: 176
phase: Implement（Phase F — verify 脚本 + 报告骨架）— Codex 对抗审查记录
date: 2026-06-10
reviewers: Codex (codex-rescue) + Claude (main-thread)
scope: scripts/verify-feature-176.mjs + specs/147/PUBLISH-REPORT-M7.md + PUBLISH-REPORT.md §11
---

# F176 Phase F 对抗审查 — 处置记录

> Codex：2 CRITICAL + 3 WARNING + 1 INFO（INFO=三大锚点口径确认无误）。全处置。

| 档位 | finding | 处置 |
|------|---------|------|
| 🔴 C-1 | SC-002 可被不完整 fixture 集骗过（缺 fixture 静默 continue；c2 缺失当 avg=0）| 按 taskIds×3 断言 c2/c3 期望 run 数，缺额直接 FAIL + 输出 missing counts；FAIL 原因区分"预注册未冻结 vs fixture 不完整" |
| 🔴 C-2 | SC-001 smoke 只查 frontmatter status=PASS，伪造文件即过；synthetic 拒收只盖 spike | batch smoke-result frontmatter 增加机器可读字段（source=host(batch)/runCount/brokenCount/c3McpCallCount）；verify 交叉核对全部字段（status+source+runs=5+broken=0+c3Mcp>0）；防伪第二防线=唯一写入方+git 历史+人工 review（如实声明，不做重型防伪）|
| 🟡 W-1 | lift/c3_vs_c4 仅存在性检查；aggregate 未绑预注册，旧/手写 aggregate 有纸面通过空间 | batch aggregate 增加 taskSetHash + expectedRunCount + source 字段；verify 比对 aggregate.taskSetHash===prereg hash + run 数完整 + host 来源；数值解读显式降格为"需报告人工审查" |
| 🟡 W-2 | MCP 指标单位不一致（脚本 /run vs 报告 TODO /task），host 回填可能写错口径 | 统一为 **per run（分母=task×repeat 每次任务执行）**；报告 §4.4 TODO 注明勿改分母 |
| 🟡 W-3 | "2026 评测仍以此为旗舰数字"时间性断言偏硬 | 软化为"截至 2026-06 调研，其公开材料以此为旗舰数字" |
| ℹ️ INFO | -98.7%=code-execution-with-MCP / RepoGraph +32.8% 相对 / Serena=LSP vs Spectra=纯AST 三大锚点无口径错误 | 确认；host 回填只动 TODO 区，锚点段不动（报告内已注）|

## 验证
- verify 真实模式 8/13 PASS：sandbox 可验项全过（spike provenance / 门禁正负向 / 9 项锚点 / 禁用词 0 违规 / 四维度 dogfooding / 未入库）；5 个 FAIL 全部=host 执行依赖项（smoke/mcp/lift/prereg冻结/c3c4）——诚实待 host 状态
- SC-007 扫描器在本报告骨架上抓到 1 处真实违规（Augment 句裸 SOTA）并已修——扫描纪律对自产内容同样生效
