# 问题修复报告 — Feature 148: panoramic spec.md 行数膨胀

## 问题描述

Spectra 自测发现 `self-dogfood` 的 `panoramic` 模块 `spec.md` 长达 **12,468 行**（合理区间 300-700）。F143/F147 baseline 已 surface 这是产品 bug：spec 几乎不可读，违反 panoramic blueprint 设计中"叙述+合同"的简洁性原则。

外部观测（来自 `tests/baseline/self-dogfood/spectra/full.json` 的 `quality.specStructure.outliers`）：

| 模块 | spec.md 行数 | Section 3+4 行数 | AST dump 占比 |
|------|-------------|------------------|---------------|
| panoramic | 12468 | 11714 | **93%** |
| batch | 1945 | 1396 | 71% |
| core | 1839 | 1426 | 77% |
| debt-scanner | 1494 | 1020 | 68% |

LLM judge 给 6/7 分，扣分原因均指向 "AST 堆砌、抽象失败"。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | `panoramic.spec.md` 为何 12468 行？ | 「3. 接口定义」7337 行 + 「4. 数据结构」4377 行（合计 11714 行）远超合理体量 |
| Why 2 | 这两个章节为何如此长？ | 各自包含一个「完整 AST 精确提取」子章节，按文件维度无差别 dump 所有 class/interface/method/property |
| Why 3 | 为何要 dump 完整 AST？ | FR-001/FR-003/FR-004 设计意图：在 LLM 叙述后追加 AST 精确表格作为 ground truth，提升 LLM-as-context 价值 |
| Why 4 | 为何缺少规模上限？ | 实现时只考虑了"叙述+精确表"叠加产生的可读性提升，未对超大模块（122 文件 / 数百导出）做 token/行数预算控制 |
| Why 5 | 为何未被现有机制捕获？ | 单元测试均使用 1-2 文件 / <5 exports 的小规模 skeleton，无法 surface 大模块的输出爆炸；`quality.specStructure.outliers` 是 F143 引入的新 metric，揭露问题后未触发回归阻断 [ROOT CAUSE REACHED at Why 5] |

**Root Cause**: `single-spec-orchestrator.ts` 的 `generateAstInterfaceDefinition` 与 `generateAstDataStructures` 渲染器对超大模块缺少规模上限保护，把 AST dump 无差别全量展开，导致 spec.md 失去抽象层次。

**Root Cause Chain**: spec.md 12468 行 → Section 3+4 占 93% → 「完整 AST 精确提取」子章节按文件无差别 dump → 缺少规模上限 → 单测覆盖范围未覆盖大模块场景。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| [src/core/single-spec-orchestrator.ts:735](src/core/single-spec-orchestrator.ts:735) | `generateAstInterfaceDefinition` | 全量按文件展开 + 类成员子表格 | 引入规模上限：详细展开 Top-K 文件 + 折叠剩余 |
| [src/core/single-spec-orchestrator.ts:792](src/core/single-spec-orchestrator.ts:792) | `generateAstDataStructures` | 全量按 export 展开 + 字段/方法子表格 | 引入规模上限：详细展开 Top-K 数据结构 + 折叠剩余 |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `src/batch/batch-readme-generator.ts` | README 渲染 | 仅渲染聚合指标，不全量 dump AST | **安全** |
| `src/panoramic/generators/architecture-overview-generator.ts` | 架构概览 | 已通过 LLM 摘要压缩，无逐文件 dump | **安全** |

### 同步更新清单

- 调用方：`src/core/single-spec-orchestrator.ts` 内部唯一调用，无外部消费者
- 测试：`tests/unit/single-spec-orchestrator.test.ts` 现有 3+4 个用例均使用小规模 skeleton（不触发上限）；需新增大规模上限触发用例
- 文档：`specs/products/spectra/current-spec.md` 中如提及"完整 AST 精确提取"语义需更新；`specs/144-e2e-fixture-test-infra/` 的 baseline fixture 需重生
- 类型定义：无变化（仅函数实现内部调整）

## 修复策略

### 方案 A（推荐）— 内置规模上限 + 智能折叠

在两个 AST 渲染器内引入"规模预算"，超过阈值时切换到"详细 + 折叠"模式：

**「完整接口参考」（Section 3 子章节）**
- 默认展开所有文件
- 当 `skeletons.length > FILE_DETAIL_LIMIT (= 12)` 时：
  - 按"导出数量倒序"详细展开 Top 12 文件
  - 剩余文件汇总为「### 其他 N 个文件（共 M 导出）」一行块，列出文件名 + 导出数量
- 类成员子表格阈值：单类成员 > MEMBER_DETAIL_LIMIT (= 30) 时仅显示前 30 + 「另 N 个成员省略」

**「完整字段定义」（Section 4 子章节）**
- 默认展开所有数据结构（class/interface/type/enum）
- 当 `dataExports.length > DATA_DETAIL_LIMIT (= 20)` 时：
  - 详细展开 Top 20（按"成员数倒序"，无成员的 type/enum 排后）
  - 剩余条目折叠为「#### 其他数据结构（共 N 个）」+ 单行列表（名称 / 类型 / 文件）
- 单类成员同样应用 MEMBER_DETAIL_LIMIT (= 30)

**预期产出**：
- panoramic: 12468 → 约 1100-1300 行（≤ 1500 ✅）
- batch: 1945 → 约 800-1000 行
- core: 1839 → 约 800-1000 行
- debt-scanner: 1494 → 约 800-1000 行
- 小模块（如 utils, hooks）：与现有完全一致（< 阈值不触发折叠）

**优点**：
- 最小化合同变化，对现有调用方零影响
- 小模块行为不变（向后兼容）
- 单测可针对"超过阈值后折叠"新增独立用例
- 阈值通过 module-level constant 暴露，可配置

**缺点**：
- 大模块的精确 AST 仍可在 spec.md 之外的 `_meta/skeletons.json` 找到（已存在），但需在折叠提示中加引用

### 方案 B（备选）— 移除「完整 AST dump」子章节

直接砍掉两个子章节，仅保留 LLM 叙述 + 高层概念表。

- **优点**：彻底解决，spec 真正是"叙述+合同"
- **缺点**：违反 FR-001/FR-003/FR-004 设计意图；丢失 AST as ground truth 价值；用户依赖 LLM-as-context 时需要这些表格
- **结论**：rejected — 范围超出 fix 模式（涉及 spec 设计变更）

### 方案 C（备选）— AST dump 拆到独立辅助文件

`spec.md` 仅保留 LLM 叙述；AST 全量 dump 输出到 `panoramic.api-reference.md`。

- **优点**：保留全部信息 + spec 可读性
- **缺点**：需要改 batch 输出 contract、index 引用、cross-link、collector 解析；超出 fix 模式范畴
- **结论**：rejected — 应作为后续 feature

**采用方案 A**。

## Spec 影响

- **代码层面**：仅修改 `src/core/single-spec-orchestrator.ts` 两个 AST 渲染函数 + 单测
- **产品级 spec**：`specs/products/spectra/current-spec.md` 如提及"完整 AST dump 行为"需补"超过阈值时折叠"语义；如未提及则无需更新
- **baseline fixture**：`tests/baseline/self-dogfood/spectra/full.json` 需重生（spec 行数变化）— 留给 baseline:collect 验证阶段
- **panoramic blueprint 文档**：本次未涉及

## 决策摘要

- 采用方案 A：在 `single-spec-orchestrator.ts` 引入 `FILE_DETAIL_LIMIT`、`DATA_DETAIL_LIMIT`、`MEMBER_DETAIL_LIMIT` 三个常量，触发"详细 + 折叠"双段渲染
- 修复范围：1 个核心文件 + 1 个测试文件（新增大模块用例），影响仅限 spec 渲染输出
- 验证：单元测试全绿 + `npm run lint` + `npm run build` + 验证 panoramic spec 行数 ≤ 1500
