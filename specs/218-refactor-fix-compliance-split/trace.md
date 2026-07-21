# 执行轨迹 — F218 fix-compliance-core 拆分（refactor 模式）

## 基线与分支
- 分支 `refactor/218-fix-compliance-split`，基于 F216 tip `26cebe5`（F216 未合 master，master 已前进到 F217；本重构必须叠在 F216 之上，交付顺序上被 F216 gate 住）
- 重构前基线：fix-compliance 三测试 222/222 绿；core 819 行

## Phase 1 影响分析（refactor-plan agent · opus）
- 产出 impact-report.md：4 直接 + 1 间接引用文件；风险 medium
- 关键发现：core.test.mjs 经 CORE_MODULE_URL 动态 import 全部迁移符号 + computeFenceMask → core 全量 re-export 是唯一兼容路径；core⇄新模块存在潜在 ESM 双向环

## GATE_TASKS 裁决（主线程收口）
- 推翻 agent 的"computeFenceMask 留 core（接受受控环）"建议，采**变体 C**：computeFenceMask + NOOP_JUDGMENT_HEADING_REGEX + toSingleMatchProbe 一并迁入新模块 → 依赖 core → execution-record 单向无环；未采纳更纯的双新模块方案（超任务"仅 1 新模块"边界）
- toSingleMatchProbe 仅新模块导出，core 不 re-export（新符号零兼容约束）

## Phase 2 分批规划（同 agent 续跑）
- refactor-plan.md：2 批串行（B1 搬移+re-export；B2 探针 helper），符号级清单 + 中间验证命令 + 回滚路径 + 4 条迁移不变量

## Phase 3 逐批实现
- ⚠️ 实现 agent（opus）连续两次死于 API "Connection closed mid-response"（第 1 次零写入；第 2 次半改：新模块 306 行已建、core 删至 773 行但 recon/sentinel 块未删、re-export 未加，处于重复声明碎裂态）
- 处置：主线程按 refactor-plan.md 接管收尾（python 按行号精确删 423–653 + 指针注释 + 尾部 re-export 块；Batch 2 六处探针改写用 Edit 逐点完成）
- Batch 1 中间验证：222/222 绿 + 无环 grep 0 + 导出面差集双向 `[]`
- Batch 2 中间验证：测试 0 失败 + `flags.replace('g'` 仅剩 helper 定义 1 处 + core 560 行

## Phase 4 残留扫描（编排器亲自执行）
- 7 项全过，见 residual-report.md；核心证据：fn.toString() 对比旧 819 版——6/7 函数逐字等价，parseNoopReconLines 仅差授权改写的探针 1 行

## Phase 5 最终验证
- 主线程：node --test glob 552/552、test:plugins 552/552、repo:check PASS、npm build PASS、vitest 5239 过 / 1 失败＝已知预存 flaky（community-analysis 45s perf 超时，隔离复跑 4/4 绿 5.8s，与本改动无交集）
- 已知坑位记录：node v24 下 `node --test <目录>` 会 20ms 假失败，必须用 `*.test.mjs` glob
- 独立 verify agent + codex 对抗审查并行进行（结果见 verification/ 与最终交付报告）
