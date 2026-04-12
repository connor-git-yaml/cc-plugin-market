# Feature 106 需求澄清报告

## 已自动解决

- Q1: FR-005 降级策略轮询间隔未记录 → [AUTO-RESOLVED: 5 秒轮询间隔，来自 prompt 原始需求明确约束]
- Q2: FR-007 并发 lock 策略模糊（"锁机制或等待策略"） → [AUTO-RESOLVED: lock file 策略（`_meta/.spectra.lock`），等待超时 10 秒；in-memory mutex 无法跨进程，lock file 是标准跨进程互斥方案，tech-research 亦有建议]
- Q3: FR-012 `--update` 与 `--incremental` 整合方案未编码 → [AUTO-RESOLVED: 双层增量可组合方案，`--update`=文件级过滤，`--incremental`=spec 级过滤，组合时先文件级再 spec 级；直接采用 prompt 明确设计]
- Q4: FR-013 `_meta/needs_update` 存储位置不一致（spec 写"manifest 字段"，prompt 写独立文件） → [AUTO-RESOLVED: 独立的 `_meta/needs_update.json` 文件，使用 prompt 的明确 schema `{ "staleFiles": [...], "markedAt": "..." }`；独立文件原子写入更简单，不污染 ManifestEntry schema]
- Q5: FR-020 chokidar 版本未约束 → [AUTO-RESOLVED: chokidar v4.x，tech-research 确认与项目 TypeScript ESM 配置一致]

## 待澄清（如有）

无。所有歧义点均已从 prompt.md 和 tech-research.md 中找到明确答案。

## spec.md 更新

已更新以下内容：
- FR-005：补充降级轮询间隔（5 秒）
- FR-007：明确 lock file 策略，指定 lock 文件路径 `_meta/.spectra.lock` 和等待超时（10 秒）
- FR-012：从"可选/避免语义重叠"升级为"必须"，编码双层增量可组合方案的完整语义
- FR-013：明确 `_meta/needs_update.json` 为独立文件（非 manifest 字段），补充 schema 格式
- FR-020：补充 chokidar v4.x 版本约束
- StaleMarker 实体描述：同步更新为独立文件存储
- UpdateBatchOptions 实体描述：补充与 incremental 组合的语义
- 复杂度评估 GATE_DESIGN 建议：更新为已解决状态，聚焦 lock file stale lock 清理逻辑
- 新增 `## Clarifications / Session 2026-04-12` 章节记录所有自动决策
