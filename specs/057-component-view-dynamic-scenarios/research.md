# Research Summary: 组件视图与动态链路文档

## 决策摘要

### 决策 1

- **Decision**: 057 采用 batch 项目级“下钻流水线”实现，而不是新增一个重新扫源码的普通 project generator
- **Rationale**: 057 强依赖 056 与 053，最自然的输入就是 `ArchitectureIR` + 已生成 module specs / baseline skeleton
- **Alternatives considered**:
  - 新增独立 generator，直接从 `ProjectContext` 重新分析源码
  - 引入重型静态 call graph / tracing 子系统

### 决策 2

- **Decision**: `ArchitectureIR` 负责组件边界与关系，module specs / baseline skeleton 负责组件粒度与职责证据
- **Rationale**: 这样能复用 056 的统一结构事实，同时满足蓝图对关键类/关键方法级下钻的要求
- **Alternatives considered**:
  - 只依赖 IR 做 component view
  - 只依赖 module spec / narrative 做组件聚合

### 决策 3

- **Decision**: dynamic scenarios 采用确定性规则构建步骤、参与者、hand-off 与 evidence，LLM 不参与 canonical steps 决策
- **Rationale**: 057 的验收强调“链路清楚”，不是“语言像说明文”；事实步骤必须可复核
- **Alternatives considered**:
  - 让 LLM 直接生成主链路
  - 等待完整静态调用图成熟后再做 057

### 决策 4

- **Decision**: 057 输出模型预留 `evidence` / `confidence`，但不提前实现 059 的 provenance gate
- **Rationale**: 059 强依赖 057，需要稳定字段；但 057 本身只负责文档下钻，不负责质量门
- **Alternatives considered**:
  - 完全不保留 provenance 结构
  - 在 057 里提前实现冲突检测和质量评分

## 结论

057 的实现应严格定位为“基于 056 IR 的组件与动态链路下钻层”。结构事实继续复用 056 和 053 已有结果，输出新的 `component-view` 与 `dynamic-scenarios` 文档及结构化模型，为后续 059 provenance 与质量门保留证据字段，但不提前实现其治理逻辑。
