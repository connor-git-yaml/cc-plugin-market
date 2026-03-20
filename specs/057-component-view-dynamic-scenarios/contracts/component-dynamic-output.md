# Contract: Component View & Dynamic Scenario Outputs

## 1. 输入边界

057 的 builder 层允许组合以下输入：

- **必需**: `ArchitectureIR`（来自 056）
- **必需**: stored module specs / baseline skeleton（来自 053 batch 生成结果）
- **可选增强**:
  - `ArchitectureNarrativeOutput`
  - `RuntimeTopologyOutput`
  - `EventSurfaceOutput`

约束：

- 057 不得直接重新解析整个项目源码来替代上述输入
- 若缺少 `ArchitectureIR` 或 stored module specs，057 可以选择不写出文档，但必须返回 warning，而不是抛出致命错误阻断 batch

## 2. 输出边界

### 2.1 Component View

```ts
interface ComponentViewOutput {
  title: string;
  generatedAt: string;
  model: ComponentViewModel;
  warnings: string[];
  mermaidDiagram?: string;
}
```

batch 写盘结果必须支持：

- `component-view.md`
- `component-view.json`
- `component-view.mmd`（若存在可用 Mermaid）

### 2.2 Dynamic Scenarios

```ts
interface DynamicScenariosOutput {
  title: string;
  generatedAt: string;
  model: DynamicScenarioModel;
  warnings: string[];
}
```

batch 写盘结果必须支持：

- `dynamic-scenarios.md`
- `dynamic-scenarios.json`

## 3. 必备文档版块

### `component-view.md`

渲染结果必须尽量覆盖以下版块：

1. 文档摘要 / warnings
2. 关键组件清单
3. 组件分组或子系统归属
4. 关键关系说明
5. Mermaid component view

### `dynamic-scenarios.md`

渲染结果必须尽量覆盖以下版块：

1. 文档摘要 / warnings
2. 至少 1 条关键场景概览
3. 每条场景的 ordered steps
4. 参与者、触发入口、结果说明
5. evidence / confidence 摘要

## 4. 降级行为

- 若 `ArchitectureIR` 可用但 component 信息较弱：仍应输出有限组件和 warning
- 若 runtime / event 信号缺失：dynamic scenarios 仍可基于 module specs / imports / IR 关系保守输出主要 request flow
- 若证据不足以支撑高置信度场景：必须降低 confidence 或标记 `inferred`
- 057 任一 builder 失败时，不得阻断 `architecture-narrative`、ADR pipeline 或其他项目级文档输出

## 5. 一致性要求

- 关键组件边界必须可追溯回 `ArchitectureIR` 或 stored module specs，不得凭模板硬编码
- dynamic scenario 的 canonical steps 必须由确定性证据构建，不得由 LLM 直接决定
- 057 输出必须显式保留 `evidence` / `confidence`，供 059 直接复用
