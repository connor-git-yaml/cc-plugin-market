# 技术调研报告: 组件视图与动态链路文档

**特性分支**: `057-component-view-dynamic-scenarios`  
**调研日期**: 2026-03-21  
**调研模式**: 离线 / 独立模式  
**产品调研基础**: 无（本次为 `tech-only`，未执行产品调研）

## 1. 调研目标

**核心问题**:
- 如何在不重复发明底层事实抽取器的前提下，基于 056 `ArchitectureIR` 下钻到 component 级结构
- 如何为关键链路生成“可讲述的 dynamic scenario”，而不是退化成符号名列表
- 如何复用现有 batch 产物与源码静态结果，兼顾 `claude-agent-sdk-python` 这类单包 Python 项目与当前仓库的混合工程

**需求范围（来自蓝图与当前主线能力）**:
- 057 强依赖 056 和 053，定位是“架构深描层”，不是新的 runtime/workspace/parser 基建
- 必须产出 `component-view.md/.json/.mmd` 与 `dynamic-scenarios.md/.json`
- 对 `claude-agent-sdk-python` 至少能识别 `Query`、`ClaudeSDKClient`、`InternalClient`、`SubprocessCLITransport`
- 至少有 1 条 dynamic scenario 需要清楚描述 `query()` 到 CLI transport 再到消息解析的链路

## 2. 架构方案对比

### 方案对比表

| 维度 | 方案 A: 基于 `ArchitectureIR` + 已生成 module specs 的 batch 下钻流水线 | 方案 B: 新增独立 project generator，重新扫源码生成 component / dynamic | 方案 C: 引入重型 call graph / tracing 子系统 |
|------|--------------------------------------------------------------------|---------------------------------------------------------------|----------------------------------------------|
| 概述 | 在 batch 项目级文档阶段，读取 056 `ArchitectureIR`、已生成 module specs、baseline skeleton、可选 event/runtime 结果，构建 component / scenario 文档 | 用 `ProjectContext` 直接重新分析源码、imports、symbols，再单独产出 057 文档 | 实现更完整的静态调用图或运行时 tracing，再投影成文档 |
| 与蓝图契合度 | 高；严格符合“基于 IR 下钻” | 中；结果可做，但会模糊 056 的统一事实边界 | 低；超出 057 范围 |
| 重复建模风险 | 低；直接复用 056、053 已有产物 | 高；会重新做一套组件与链路事实 | 很高；会新增另一层 canonical facts |
| 维护成本 | 中；需要解析 module spec frontmatter / baseline skeleton | 中高；要把源码分析再接回 batch | 高；需要长期维护图算法与多语言差异 |
| 对单包 Python 适配 | 好；module specs 和 baseline skeleton 已包含 Python 导出符号 | 中；要在 generator 内重做单包 Python 适配 | 中；理论可行但工程成本过高 |
| 可测试性 | 高；可直接用现有 batch fixture 和 stored spec fixture 验证 | 中；需要构造更多 ProjectContext/源码 fixture | 低；测试面过大 |
| 扩展到 059 provenance | 高；天生可保留 source refs/evidence | 中；需要再设计来源映射层 | 中；但会把 059 复杂度前移 |

### 推荐方案

**推荐**: 方案 A — 基于 `ArchitectureIR` + 已生成 module specs 的 batch 下钻流水线

**理由**:
1. 056 已经解决“统一结构事实”；057 应只负责“把结构事实讲细”，不应该再成为新的事实主入口。
2. 053 的 batch 主链路已经写出 module specs，里面包含 baseline skeleton 与导出符号，足够作为 component drill-down 的低成本证据源。
3. `architecture-narrative` 现有代码已经证明 stored module specs 能稳定提取 key symbols / key methods；057 可以在此基础上提升到组件关系与动态步骤，而不必另写一套扫描管线。

## 3. 依赖与复用评估

### 可直接复用的现有能力

| 能力 | 当前入口 | 057 中的角色 |
|------|----------|--------------|
| `ArchitectureIR` | `src/panoramic/architecture-ir-generator.ts` | 组件边界、system/deployment/component 视图的主结构输入 |
| stored module specs + baseline skeleton | `src/panoramic/architecture-narrative.ts` | 关键类/函数/成员级证据与职责说明 |
| `CodeSkeleton` | `src/models/code-skeleton.ts` | 导出符号、成员、imports、语言信息 |
| `event-surface` | `src/panoramic/event-surface-generator.ts` | 事件流 / 发布订阅场景的弱信号增强 |
| `runtime-topology` | `src/panoramic/runtime-topology-generator.ts` | 运行时宿主、transport/service 边界增强 |
| batch 项目级编排 | `src/panoramic/batch-project-docs.ts` | 057 最自然的接入点 |

### 不建议新增的依赖

- 不建议为 057 新增外部 call-graph / tracing npm 包
- 不建议要求用户启动运行时、pytest tracing、coverage profiler 等额外前提
- 不建议把 LLM 作为 dynamic scenario 步骤事实的来源

### 兼容性结论

- 057 可以完全维持 Node.js + 现有 panoramic / batch 基础设施
- 057 不需要单独引入 Claude-only 或 Codex-only 工作流
- 057 对单包 Python 项目同样成立，因为下钻依据来自已生成的 module spec / skeleton，而不是 TS 专属图工具

## 4. 设计模式建议

### 推荐模式

1. **Shared Output Model**
   - 新增 `ComponentViewModel` 与 `DynamicScenarioModel`
   - 模型只承载结构化组件、关系、步骤、evidence、confidence
   - Markdown / Mermaid 模板放在渲染层，不污染共享模型

2. **Evidence Aggregator**
   - 汇总 `architecture-ir`、module spec、baseline skeleton、event/runtime 文档的来源
   - 每个 component / scenario step 都保留 `sourceType + path/ref + note`
   - 为 059 的 provenance 预留稳定字段，但不提前实现 059 的质量门

3. **Role-based Ranking**
   - 使用名称信号、IR 关系密度、module role、成员方法信号对候选组件打分
   - 优先保留 `Query / Client / Transport / Session / Parser / Store / Runtime / Protocol` 等高信号组件
   - 对 `Test*`、`test_*`、fixture-only 符号做降权

4. **Scenario Builder**
   - 从高信号入口点（如 `query`、`connect`、`stream`、`publish`、`parse`）出发
   - 结合 imports、成员调用命名、IR 关系、事件面与测试证据生成 ordered steps
   - 输出“入口 -> hand-off -> 处理 -> 输出/副作用”的链路，而不是只列符号

5. **Progressive Degradation**
   - 缺少 event/runtime 信号时仍可输出 request/control 场景
   - 缺少强调用证据时保守输出 `partial` / `low confidence`
   - 057 的失败不能拖垮整个 batch

## 5. 关键设计选择

### 5.1 组件视图输入边界

推荐输入顺序：

1. `ArchitectureIR` component / system / deployment views
2. stored module specs 中的 baseline skeleton、intent/business/dependency summaries
3. `architecture-narrative` 已整理出的 key modules / key symbols / key methods
4. `event-surface` / `runtime-topology` 作为弱增强

结论：
- 结构边界来自 056
- 组件粒度来自 module spec / skeleton
- 场景增强来自 event/runtime

### 5.2 动态链路构建方式

推荐使用“确定性启发式 + 证据引用”：

- 入口识别：优先 `query`、`connect`、`request`、`stream`、`publish`、`parse`
- hand-off 识别：依据 imports、成员名、组件关系、runtime transport 名称、event channel occurrence
- 步骤描述：模板化生成，允许后续 explanation 层润色，但步骤顺序与参与者由确定性规则决定

不推荐：
- 直接让 LLM 根据仓库摘要写 scenario
- 要求完整静态调用图再开始输出

### 5.3 接入位置

推荐放在 `batch-project-docs.ts` 的项目级编排层，而不是 `GeneratorRegistry` 的普通 generator：

- 057 需要读取已写出的 module specs 与 architecture narrative 辅助信息
- 当前 `DocumentGenerator.extract(context)` 不直接持有 batch `outputDir`
- 若强行做 registry generator，会把 stored spec 解析或源码重复扫描塞回 generator，边界更差

建议顺序：

1. 运行现有 applicable panoramic generators，得到 `architecture-ir`、`event-surface` 等结构化结果
2. 生成 `architecture-narrative`
3. 基于上述结果与 stored module specs 生成 `component-view` 与 `dynamic-scenarios`
4. 保持 ADR pipeline 在其后，未来可选择性消费 057 结果

## 6. 技术风险清单

| # | 风险描述 | 概率 | 影响 | 缓解策略 |
|---|---------|------|------|---------|
| 1 | 组件候选仍被目录层级或测试类噪音主导 | 中 | 高 | 增加 role-based ranking 与 test symbol 降权规则 |
| 2 | 动态场景只有方法名单，没有可读 hand-off | 中 | 高 | 强制 step 模型包含 actor、action、target、evidence、confidence |
| 3 | 单包 Python 项目调用关系信息不足 | 高 | 中 | 优先从 module spec summaries、imports、命名模式、runtime/event 信号保守拼接 |
| 4 | 057 侵入 batch 主链路后导致现有文档回归 | 低 | 高 | 保持独立 builder + renderer，失败时只输出 warning，不影响其他项目文档 |
| 5 | 与 059 provenance 的边界混淆 | 中 | 中 | 只预留 evidence 字段，不提前实现冲突检测、paragraph-level provenance 或 quality report |

## 7. 需求-技术对齐度

| 需求 | 技术方案覆盖 | 说明 |
|------|-------------|------|
| 输出 component view | ✅ 完全覆盖 | `ComponentViewModel` + Markdown/JSON/Mermaid 渲染 |
| 输出 dynamic scenarios | ✅ 完全覆盖 | `DynamicScenarioModel` + Markdown/JSON 渲染 |
| 识别 Query / Transport / Session / Parser 等关键组件 | ✅ 完全覆盖 | 通过 IR + module spec + role ranking 完成 |
| 描述 query 到 transport 到 parsing 主链路 | ✅ 完全覆盖 | 通过 deterministic scenario builder 完成 |
| 不新增事实抽取器 | ✅ 完全覆盖 | 主结构来自 056，细节来自已生成 module specs / skeleton |
| 为 059 预留 provenance | ✅ 完全覆盖 | 只在模型中预留 evidence/confidence，不做 059 逻辑 |

## 8. 结论与建议

### 总结

057 最稳妥的实现方式，是把它设计成 batch 项目级文档层上的“下钻流水线”：以 056 `ArchitectureIR` 作为结构主轴，以 053 已产出的 module specs / baseline skeleton 作为组件粒度证据，再结合 event/runtime 弱信号构建 component view 与 dynamic scenarios。这样既满足蓝图“基于 IR 下钻”的要求，也不会重复引入新的 canonical facts。

### 对后续规划的建议

- 057 实现时优先先把共享结构化模型与 deterministic builder 立住，再补模板与 batch 集成
- 059 到来时直接消费 057 输出中的 `evidence` / `confidence`
- 不要在 057 阶段提前做 ADR 归纳、质量评分或 LLM provenance 规则
