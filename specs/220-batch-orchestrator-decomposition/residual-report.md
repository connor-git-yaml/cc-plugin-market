# F220 残留扫描报告（Phase 4）

**扫描时间点**: Tier-A（333551b）+ Tier-B seam（B5/B6/B7）完成后
**扫描性质**: 本次重构是"有边界拆分"而非重命名 —— 14 个导出符号逐字保留、无旧名死亡，
因此残留扫描的对象不是"旧名称残留"，而是 (a) 导出契约双向差集、(b) facade 残留职责的
边界诚实披露、(c) 搬迁符号在 facade 的定义残留。

---

## 1. 导出契约双向差集（F218 空差集范式）

| 检查 | 结果 |
|------|------|
| runtime 导出集合（`import * as` Object.keys） | 11 value 符号，与冻结清单**双向差集空**（G3 用例 1，编译器级） |
| 声明面（`getExportedDeclarations`） | 14 符号（11 value + 3 interface），种类正确、无别名伪装（G3 用例 2） |
| dist 声明产物 | `dist/batch/batch-orchestrator.d.ts` 精确含原 11 value + 3 type（Codex Tier-A 审查 Info-5 独立核实） |
| 旧定义残留 | facade 中搬迁符号的**定义**零残留（`grep` 定义模式零命中；仅 import/re-export/调用点） |

## 2. 五段落位与规模

| 模块 | 行数 | 职责 | 独立单测 |
|------|------|------|---------|
| facade `batch-orchestrator.ts` | 1749（原 2580，-32%） | runBatch 编排 + 公共类型 + re-export 契约 | 全量既有测试面（41 消费者） |
| ① `stages/source-discovery.ts` | 582 | skeleton 采集/walkers/design-doc 路径 + B6 `discoverSourceLanguages` | 既有 49 用例（tsjs/python-resolve、gitignore、design-doc-paths、ignore-oracle、181-consolidation）+ G2 语言矩阵 |
| ② `stages/graph-assembly.ts` | 321 | 图合并/跨语言/语言组图/`buildAstGraphOnly` + B5 `selectPrimaryModuleGraph` | 既有 graph-only 测试群 + G1 冻结基线 + G2 |
| ③ `stages/generation-scheduling.ts` | 37 | `normalizeConcurrency` | `concurrency-normalization` 既有直测 |
| ④ `stages/checkpoint-state.ts` | 48 | completed/failed 状态机 + 受管目录判定 | **新增 9 用例**（互斥去重/迁移/sibling） + G2 场景8 resume 链 |
| ⑤ `stages/artifact-reporting.ts` | 88 | B7 `writeBatchReportingArtifacts`（summary+README 写盘） | G2 reporting 全文快照（C2 加固） |

## 3. facade 残留职责边界（显式披露，M9"不以文件变短为成功"）

runBatch（293–1749，~1456 行）保留以下**编排内聚**职责，属有意残留而非遗漏：

| 残留块 | 行标 | 不拆理由 |
|--------|------|---------|
| dry-run 预估返回（步骤 2 后） | ~420-471 | 读 processingOrder/moduleGroups/toProjectPath 等 6 个编排局部量，早退语义与 BatchResult 构造强耦合；budget gate 同（下） |
| budget gate 循环 | ~473-508 | Feature 127 gate 决策直接改写 genOptions 注入变量（budgetSkipEnrichmentAll 等），无清晰单向出口 |
| checkpoint 加载/resume 判定（步骤 3） | 510-565 | F182 修复面 5 的 full-resume 时序回写（forceFullRegeneration/shouldUseIncrementalPlan 双变量）与 regenPlan 交织；状态机 **helper** 已拆至 ④，装配时序留编排层 |
| processOneModule 闭包 + p-limit 调度（步骤 4） | 566-998 | 读写 ~20 个共享闭包量（successful/failed/costRecords/cumulativeInputTokens/reporter/limitRef…）；调度错误兜底块维护 totalModules 不变量（Feature 146 FR-006..011）。提取需传大 context 对象 —— 真实漂移风险 > 解耦收益 |
| 索引/panoramic/docs-bundle/debt 聚合（步骤 5-6） | 1000-1702 | 各块条件依赖 effectiveMode/budget 降级/projectDocsResult 等运行中间态；是"编排"本体 |

> ③ generation-scheduling 只承载 `normalizeConcurrency`：p-limit 调度块经读码评估（见上），
> 按计划 B7 条款"提不动则显式记录"处置。这是边界诚实，不是未完成。

## 4. batch-project-docs.ts（#2 枢纽）处置

**Defer**（impact-report §7 三条理由：scope 纪律 / 风险隔离 / 无阻塞）→ M9/M10 独立 Feature 候选。

## 5. 结论

- 旧名称残留：**0**（无重命名语义）
- 导出契约差集：**空**（双向，编译器级断言持续护航）
- 未预期残留：**0**；全部残留块均有显式边界理由（§3）
