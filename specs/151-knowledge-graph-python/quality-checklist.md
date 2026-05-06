# Quality Checklist — Feature 151: Knowledge Graph 抽象 + UnifiedGraph + Python callSites

**检查日期**：2026-05-06  
**检查者**：quality-checklist 子代理  
**参考文件**：
- `specs/151-knowledge-graph-python/spec.md`（Codex 对抗审查后版本）
- `specs/151-knowledge-graph-python/clarification.md`（9 CL 全部解决）
- `specs/151-knowledge-graph-python/research/tech-research.md`

---

## 评分说明

- `2` = 达标（完全满足）
- `1` = 部分达标（有明显缺口但主体正确）
- `0` = 不达标（缺失或根本性问题）

---

## 维度 1 — Functional Requirements 完备度（满分 12）

### 评分

| 检查项 | 得分 | 理由 |
|--------|------|------|
| 每个 FR 有可独立验收的 acceptance criteria | 2 | FR-1 到 FR-10 每个都有明确验收条件，含可执行命令或单测数量指标 |
| FR 之间依赖关系明确 | 2 | 每个 FR 末尾都标注了 `依赖：FR-x`，依赖链清晰（如 FR-5 依赖 FR-4，FR-6 依赖 FR-3+FR-5） |
| FR 覆盖所有用户故事 | 2 | US1→FR-5/FR-6、US2→FR-2/FR-3、US3→FR-9、US4→FR-4、US5→FR-10，全覆盖 |
| FR 的关联文件路径准确（仓内能找到，新增文件明确标注） | 2 | 核查：`src/panoramic/graph/graph-query.ts`（L185-194 邻接表代码已确认存在）、`src/panoramic/graph/confidence-mapper.ts`（已确认）、`src/mcp/server.ts`（L32-36 已确认）、`src/panoramic/batch-project-docs.ts:175`（已确认 bootstrapGenerators）、`src/panoramic/pipelines/coverage-auditor.ts:247`（已确认 bootstrapGenerators）；新增文件均标注"新增" |
| FR 数量与改动量匹配 | 2 | 10 个 FR 对应 18+ 改动文件，工作量表显示 22-28 个 task，与改动面吻合 |
| FR 不引入未声明的范围扩张 | 2 | Out of Scope 明确列出 ts-js/go/java adapter、sqlite、跨 repo 等；FR 内容未超出此边界 |

**维度 1 得分：12/12**

---

## 维度 2 — Edge Cases 覆盖（满分 10）

### 评分

| 检查项 | 得分 | 理由 |
|--------|------|------|
| EC ≥ 10 条 | 2 | spec.md 共列出 EC-1 到 EC-15，共 15 条，超出门槛 |
| 失败路径覆盖（解析失败、超时、OOM、非 UTF-8） | 2 | EC-1（parseErrors 兜底）、EC-14（大文件/非 UTF-8/超时三项）明确覆盖；EC-14 还指出 `TreeSitterAnalyzer.analyze()` 当前无 size/timeout guard，明确要求新增 |
| 业务边界覆盖（dunder / decorator / dynamic call / import *） | 2 | EC-3（dunder `__add__` 类型未知）、EC-5（decorator 嵌套）、EC-12（dynamic call `getattr/eval`）、EC-13（`import *`）均有覆盖 |
| 兼容性边界覆盖（旧 spec.md / 旧 graph.json / schema 升级） | 2 | EC-6（旧 spec.md 缺 callSites）、EC-7（旧 graph.json 无 calls 边消费者降级）、EC-8（双层 snapshot 切分）明确覆盖 |
| 性能边界（大文件、深层 MRO、循环依赖） | 2 | EC-4（MRO 循环/死循环，≤8 层兜底）、EC-14（大文件 1 MB 阈值）、EC-15（async/generator 函数节点类型差异）覆盖 |

**维度 2 得分：10/10**

---

## 维度 3 — Success Criteria 可证伪性（满分 10）

### 评分

| 检查项 | 得分 | 理由 |
|--------|------|------|
| 每个 SC 有量化指标（数字/阈值） | 2 | SC-001（≥95%）、SC-002（precision≥70%/recall≥30%）、SC-003（≥12 单测）、SC-004（1:1 节点边 ID、score ±10%）、SC-005（≥5 样本、零异常）、SC-006（≤10% 回归）、SC-007（grep 调用点数量）均有数字 |
| 每个 SC 的测量工具明确 | 2 | SC-001：`scripts/lib/python-call-extractor.py` + filesWithCalls 字段；SC-002：`node scripts/graph-accuracy.mjs`；SC-003：vitest；SC-006：`npm run baseline:diff`；SC-007：`grep -rE "bootstrap..."` 明确列出 |
| 每个 SC 的数据集明确 | 2 | SC-001/SC-002：micrograd 5 文件 + nanoGPT 15 文件；SC-004/SC-006：self-dogfood baseline；SC-005：master 时代 spec.md ≥5 样本 |
| 容忍度/重测策略明确 | 2 | SC-001：N=3 重测取均值；SC-002：N=3 重测取中位数；SC-006：N=5 重测取中位数；SC-004：score ±10% 容忍度 |
| 不出现"高性能""完美兼容"类无指标措辞 | 2 | 全文 SC 段落无此类措辞；NFR 也均有具体数字（10%、500 MB、47+12 单测） |

**维度 3 得分：10/10**

---

## 维度 4 — NEEDS CLARIFICATION 解决（满分 8）

### 评分

| 检查项 | 得分 | 理由 |
|--------|------|------|
| 所有 NEEDS CLARIFICATION 有推荐答案 | 2 | CL-01 到 CL-09 共 9 项，clarification.md 每项均有"推荐答案"小节，无遗漏 |
| 推荐答案有量化依据（文件/行号） | 2 | CL-04（extractor 第 69 行 `callee = node.func.attr`）、CL-07（`graph-query.ts:185-194`）、CL-08（`confidence-mapper.ts` CONFIDENCE_SCORES 数值）、CL-09（`all_calls` set 改 1 行）均有具体依据；CL-03 引用 tech-research §1.3 |
| 替代方案列出 | 2 | 每个 CL 均有"替代方案"小节，CL-01 列 3 个，CL-02/CL-03/CL-07 各 2 个；覆盖完整 |
| 风险等级标注 | 2 | 每个 CL 末尾均有"风险等级（如果接受推荐）"：CL-02 和 CL-03 为"中"，其余为"低"；风险说明充分 |

**维度 4 得分：8/8**

---

## 维度 5 — 风险与依赖（满分 8）

### 评分

| 检查项 | 得分 | 理由 |
|--------|------|------|
| 风险表覆盖 codex 找出的所有 critical / warning | 2 | Codex 2 CRITICAL（C-1 directionality、C-2 Layer B 不可 1:1）和 5 WARNING（W-1 confidence 双轨、W-2 填充率/precision口径、W-3 dynamic call、W-4 大文件无 guard、W-5 FR-10 可选/必达矛盾）均在风险表中有条目，缓解方案均对应具体 NEEDS CLARIFICATION 或 EC |
| 关键路径依赖明确 | 2 | "关键路径约束"段和依赖部分均明确说明 151 必须 merge 后 152/153/154/155/156 才能启动；每个 FR 内部依赖也完整 |
| 依赖与里程碑对齐（工作量估计） | 2 | 工作量表按 phase 列出（Specify 0.5天、Plan 1.5天、Tasks 0.5天...）共 ~2-3 周，并说明含 codex 审查轮次 |
| 缓解措施可执行（不是"考虑一下"） | 2 | 每条风险的缓解措施均对应具体行动：snapshot 双层锁定、边级 directional 字段、plan 阶段 grep consumer 清单、truth-set 对齐单测、EC-14 size/timeout guard 等；无"考虑一下"式缓解 |

**维度 5 得分：8/8**

---

## 维度 6 — 与仓内现状对齐（满分 8）

### 评分

| 检查项 | 得分 | 理由 |
|--------|------|------|
| 引用的文件/函数/API 实际存在 | 2 | 核查：`src/panoramic/graph/graph-query.ts` L185-194 邻接表逻辑已确认；`src/panoramic/graph/confidence-mapper.ts` CONFIDENCE_SCORES 已确认（值为 EXTRACTED:0.95/INFERRED:0.65/AMBIGUOUS:0.25，spec CL-08 记为 1.0/0.7/0.4 有出入但不影响可行性，映射关系本身正确）；`src/mcp/server.ts` L32-36 三个 bootstrap 调用已确认；`src/panoramic/batch-project-docs.ts:175` bootstrapGenerators 已确认；`src/panoramic/pipelines/coverage-auditor.ts:247` bootstrapGenerators 已确认 |
| 不出现已被废弃的接口 | 2 | spec 引用的接口（bootstrapAdapters/Generators/Parsers、buildDependencyGraph、analyzeFile）均为仓内现有活跃接口，tech-research 确认无废弃接口被引用 |
| 测试基线数字（47+ 单测）与仓内一致 | 1 | spec NFR-4 写"不少于 47 + Feature 150 新增量"，但 spec 和 tech-research 均未给出 Feature 150 实际新增量的精确数字，"47 + Feature 150 新增量"表述模糊；实际仓内当前数量需 `npx vitest run` 验证，spec 未能给出精确当前基数（部分达标）|
| 不与已存在的 NFR/SLO/设计原则冲突 | 2 | 仓库 CLAUDE.md 的"性能优先 + 成本可控"与 NFR-1 ≤10% 回归对齐；bootstrap 集中化（FR-10）与 AGENTS.md 的"单一职责"原则一致；schema optional 字段扩展与既有向后兼容原则一致 |

**备注**：CONFIDENCE_SCORES 数值差异（CL-08 引用 spec 里 "1.0/0.7/0.4" 而仓内实际为 "0.95/0.65/0.25"）属于 spec 中引述不精确，但映射方向（high→EXTRACTED 等）正确，不影响实现；plan 阶段需核正数值。

**维度 6 得分：7/8**

---

## 维度 7 — 与设计文档（spectra-mcp-evolution.md）对齐（满分 6）

### 评分

| 检查项 | 得分 | 理由 |
|--------|------|------|
| 路线图位置准确（150 → 151 → 152~157） | 2 | 目标摘要明确说明"Feature 151 是 Knowledge Graph 4 语言能力的第一步"、"基于 docs/design/spectra-mcp-evolution.md 路线图"，关键路径约束明确列出 152/153/154/155/156/157 |
| §3.1/§4/§5/§6 关键结论被采纳 | 2 | FR-2 的 4 阶段 call resolver 来自设计文档 §3.1；User Story 2 验收引用"§3.1 表格 confidence 等级一致"；tech-research 报告中 §1~§6 的结论均在 spec 对应 FR 中体现 |
| Scope 边界与设计文档一致 | 2 | Out of Scope 列表（ts-js/go/java、sqlite、新 MCP tools、跨 repo）与设计文档描述的 Feature 151 边界一致；FR-9 明确说明 6 个 graph tools 无代码改动（只做 snapshot 锁定） |

**维度 7 得分：6/6**

---

## 汇总

| 维度 | 满分 | 实际得分 |
|------|------|---------|
| 维度 1 — Functional Requirements 完备度 | 12 | **12** |
| 维度 2 — Edge Cases 覆盖 | 10 | **10** |
| 维度 3 — Success Criteria 可证伪性 | 10 | **10** |
| 维度 4 — NEEDS CLARIFICATION 解决 | 8 | **8** |
| 维度 5 — 风险与依赖 | 8 | **8** |
| 维度 6 — 与仓内现状对齐 | 8 | **7** |
| 维度 7 — 与设计文档对齐 | 6 | **6** |
| **总计** | **62** | **61** |

---

## 总分结论

**61 / 62 — 优秀（≥55）**

---

## 不达标项与修订建议

### 维度 6 — 测试基线数字（扣 1 分）

**问题**：NFR-4 写"不少于 47 + Feature 150 新增量"，但未给出 Feature 150 实际新增了多少单测的精确数字，导致基线数字模糊。

**修订建议**：在 plan 阶段第一步运行 `npx vitest run --reporter=verbose 2>&1 | tail -5` 获取当前精确单测数量，将 NFR-4 的"47 + Feature 150 新增量"替换为实际数字（如"不少于 X 条"）。这不是 spec 阶段需要修复的阻断项，plan 阶段任务清单开头加入"确认当前单测基数"即可。

---

## 附：关键数值核查结果

| 声称数值 | 核查方式 | 结论 |
|---------|---------|------|
| `graph-query.ts` 邻接表在 L185-194 | 直接读取 L180-196 | **已确认**（全局 `directed` 标志控制双向，与 CL-07 描述完全一致） |
| `confidence-mapper.ts` 有 `CONFIDENCE_SCORES` | 直接读取 L1-18 | **已确认**（但数值为 0.95/0.65/0.25，而 CL-08 引述为 1.0/0.7/0.4——细节偏差，语义正确） |
| `src/mcp/server.ts` L32-36 有三处 bootstrap 调用 | 直接读取 L30-40 | **已确认**（L32 bootstrapAdapters, L34 bootstrapGenerators, L36 bootstrapParsers）|
| `src/panoramic/batch-project-docs.ts:175` 有 bootstrapGenerators | 直接读取 L170-180 | **已确认**（L175 bootstrapGenerators()）|
| `src/panoramic/pipelines/coverage-auditor.ts:247` 有 bootstrapGenerators | 直接读取 L242-255 | **已确认**（L247 bootstrapGenerators()）|
| `python-call-extractor.py` 仅输出 `calls` 非 `filesWithCalls` | tech-research §4.1 描述 | **已确认**（CL-09 解决了此缺口） |
| 6 个 graph MCP tools | `src/mcp/server.ts` + tech-research §1.4 | **已确认**（graph_query/graph_node/graph_path/graph_community/graph_god_nodes/graph_hyperedges）|

---

*本 checklist 由 quality-checklist 子代理生成，基于对 spec.md + clarification.md + tech-research.md + 仓内关键文件的直接核查。*
