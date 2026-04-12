---
type: checklist
feature: 101-graph-persistence
date: 2026-04-12
score: 8/10
---

# 质量检查清单：graph-persistence

## 评分摘要

总分: **8/10**

整体质量较高，功能需求覆盖完整，接口定义与数据模型清晰，技术调研发现均已反映在 spec 中。主要扣分点集中在两处：置信度映射规则的边界情况与 tech-research 存在分歧（`DocGraphReference` vs `DocGraphSpecNode`），以及 CLI `--output-dir` 参数的数据读取来源在独立调用场景下未作说明。

---

## 详细检查

### 1. 完整性 (2.5/3)

- [x] **FR-101-01 置信度标签系统** — 覆盖三级置信度定义、字段修改范围（`ArchitectureIRRelationship`）、`confidence-mapper.ts` 新建及映射规则；与 prompt.md 要求一致
- [x] **FR-101-02 统一图构建器** — 覆盖三个数据源的映射规则、节点去重策略、容错要求、函数签名；与 prompt.md 要求一致
- [x] **FR-101-03 graph.json 持久化** — 覆盖原子写入、batch 注入点、cache manifest 集成；与 prompt.md 的 atomicWrite 复用要求一致
- [x] **FR-101-04 CLI 命令** — 覆盖 `spectra graph [--directed] [--output-dir]` 接口、注册步骤、HELP_TEXT 格式、handler 实现模式
- [ ] **CLI 独立模式的数据加载来源未明确** — spec FR-101-04 描述了 `runGraphCommand` 的函数骨架，但"读取当前项目的 architecture-ir、doc-graph、cross-reference-index"的具体加载路径（从哪个文件/API 读取）仅以注释占位（`// 加载数据源、调用 buildKnowledgeGraph、writeAtomicJson`），实现者无法直接参照 — 建议补充：指定从磁盘哪个路径加载、或调用哪个 batch 子函数；若依赖内存传递则明确说明独立调用时的 fallback 策略

### 2. 可测试性 (2/2)

- [x] **AC-101-01 向后兼容** — 具体：旧 JSON 数据（无 confidence 字段）反序列化不报错，`undefined` 值；可通过 `JSON.parse` + TypeScript 类型赋值单测自动验证
- [x] **AC-101-02 置信度映射正确性** — 具体列出 5 个 input/output 对（high→EXTRACTED, medium→INFERRED, low→AMBIGUOUS, evidenceCount≥3→EXTRACTED, evidenceCount=0→AMBIGUOUS）；可直接生成参数化单测
- [x] **AC-101-03 图构建输出格式** — 具体：列出字段检查条件 + Python `networkx` 验证命令；可自动化（Node.js 单测 + Python smoke test）
- [x] **AC-101-04 节点去重** — 具体：同 filePath 只保留一条记录，metadata 合并后包含所有非空字段；可通过构造重复节点场景单测验证
- [x] **AC-101-05 原子写入** — 具体：文件存在且为合法 JSON；进程中断不留损坏文件（.tmp 机制）；可通过 `fs.existsSync` + `JSON.parse` 及进程 kill 模拟测试
- [x] **AC-101-06–09** — batch 集成、容错降级、CLI 命令、性能指标均可自动化验证，指标数值明确（<10s、<5MB、<3s）

### 3. 一致性 (1.5/2)

- [x] **数据模型与 tech-research 一致** — `GraphJSON` 的 node-link 格式（`directed`, `multigraph`, `graph`, `nodes`, `links`）与 tech-research §1–3 的类型分析一致；`buildKnowledgeGraph` 函数签名与调研发现的注入点（L574）一致
- [x] **atomicWrite 复用方式一致** — spec 中 `writeAtomicJson(graphJsonPath, graphJson)` 无 await 的调用方式，与 tech-research §5 描述的同步特性及 `manifest-manager.ts` 调用模式完全一致
- [ ] **置信度映射对象存在分歧** — tech-research §2 明确指出 `DocGraphReference` 已有 confidence（高/中/低字符串），prompt.md 第1节也写的是"现有 `DocGraphReference` 中已有 confidence，需映射到新的三级标签"；而 spec FR-101-01 中 `confidence-mapper.ts` 的映射函数 `mapDocConfidence` 处理的是 `DocGraphSpecNode.confidence`，而非 `DocGraphReference.confidence`。两者都存在 confidence 字段，但 spec 中对 `DocGraphReference` 的 confidence 映射未单独声明，可能导致边映射规则不完整 — 建议：在 `confidence-mapper.ts` 规范中增加 `mapDocRefConfidence(docRefConfidence)` 函数，或明确说明 `DocGraphSpecNode.confidence` 与 `DocGraphReference.confidence` 共用同一映射函数

### 4. 约束覆盖 (2/2)

- [x] **NetworkX 兼容** — NFR-101-02 明确声明必须可通过 `networkx.json_graph.node_link_graph()` 无错加载，AC-101-03 包含具体 Python 验证命令；`GraphJSON` 数据模型严格遵循 node-link 格式
- [x] **向后兼容** — NFR-101-02 明确声明 `confidence`/`confidenceScore` 为可选字段；约束 §1 中重申旧数据无此字段时 `undefined`；AC-101-01 提供验收标准
- [x] **纯 Node.js（无外部图库）** — NFR-101-02 及约束 §1 均明确禁止引入 graphology 等第三方图库；性能优化采用标准 `Map<string, GraphNode>` 结构
- [x] **容错降级** — NFR-101-03 覆盖三种容错场景：单一数据源不可用、DocGraph 无 Zod Schema（方案 B）、writeAtomicJson 异常向上传播；`skippedSources` 字段设计支持可观测性
- [x] **TypeScript strict 模式** — 约束 §2 明确

### 5. 风险识别 (0.5/1)

- [x] **DocGraph 无 Zod Schema 风险** — spec 在约束 §4 和 NFR-101-03 中明确识别并选定方案 B（基础字段检查），方案 A 作为 Future Work；与 tech-research §7.3 发现一致
- [x] **批次注入点行号偏移风险** — spec FR-101-03 注入点说明中有"具体位置根据实际代码行号确认"的提示，说明已意识到行号可能变化；但未给出行号偏移时的备用定位策略
- [ ] **未标注下游依赖锁定风险** — spec 依赖章节列出了 102/105/107 依赖本 Feature 的 `GraphJSON` 格式和 `GraphNode`/`GraphEdge` 类型，但未标注"格式变更需通知下游"的向后兼容承诺或版本锁定机制；prompt.md 也未提及，但鉴于本 Feature 是 Phase 2 门控节点，建议补充 — 建议：在约束章节增加一条"`GraphJSON` 格式在 Feature 102/105/107 发布前为锁定合同，字段重命名需所有依赖方同步更新"
- [ ] **`ArchitectureIR` 无 Zod Schema 风险** — tech-research §7.4 明确提出此风险，但 spec 仅在约束 §4 中处理了 DocGraph 场景，对 ArchitectureIR 的验证策略未作任何说明（spec 数据模型章节假设 ArchitectureIR 数据可直接映射）— 建议：在约束章节补充"ArchitectureIR 无 Zod Schema，读取时采用与 DocGraph 相同的方案 B 处理"

---

## 建议修改

以下建议按优先级排序：

### P1（影响实现完整性）

1. **补充 `DocGraphReference.confidence` 的映射规则**（§一致性 第2项）
   - 在 `confidence-mapper.ts` 接口定义中增加 `mapDocRefConfidence` 函数，处理 `DocGraphReference.confidence`（'same-module' | 'cross-module' 类型边的 confidence 字段），或明确注释该字段与 `DocGraphSpecNode.confidence` 共用映射规则的依据

2. **明确 CLI 独立调用时的数据加载策略**（§完整性 第5项）
   - 在 FR-101-04 中补充：独立运行 `spectra graph` 时，三个数据源的加载方式（例如：从磁盘扫描已有 architecture-ir 输出文件、调用 `scanStoredModuleSpecs` 获取 DocGraph 等），或明确声明独立调用仅支持有数据源已在内存/磁盘可用的场景

### P2（影响可维护性与风险可见性）

3. **补充 ArchitectureIR 无 Zod Schema 的验证策略**（§风险 第4项）
   - 在约束章节增加一行：ArchitectureIR 读取时采用方案 B（同 DocGraph），不建立 Zod Schema

4. **补充下游格式锁定声明**（§风险 第3项）
   - 在约束章节或依赖章节增加说明：`GraphJSON` 结构在 Feature 102/105/107 发布前为稳定合同，字段变更需下游同步

### P3（锦上添花）

5. **AC-101-02 补充 `evidenceCount = 1` 的映射预期**
   - 当前验收标准只覆盖了 `evidenceCount >= 3`（EXTRACTED）和 `evidenceCount === 0`（AMBIGUOUS），但 `mapCrossRefConfidence` 中 `evidenceCount >= 1` 返回 `'INFERRED'`；建议在 AC-101-02 补充 `CrossReferenceLink.evidenceCount === 1` 的预期输出（INFERRED）使规则覆盖完整

6. **`GraphEdge.confidence` 字段设为必选的合理性注释**
   - 与 `ArchitectureIRRelationship.confidence` 可选不同，`GraphEdge.confidence` 在数据模型中定义为必填字段（无 `?`）；spec 未对这一非对称设计作说明，建议增加注释，避免实现者误以为是笔误
