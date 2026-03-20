# Research Summary: 架构概览与系统上下文视图

## 决策摘要

### 决策 1

- **Decision**: 045 采用 Composite Generator 方案，组合 043/040/041 的结构化输出
- **Rationale**: 满足蓝图“共享抽取、不同渲染”，且避免重复解析
- **Alternatives considered**:
  - 重新解析原始部署和 workspace 文件
  - 依赖渲染后文档或离线 JSON 作为输入

### 决策 2

- **Decision**: 新增 `ArchitectureOverviewModel` 作为 045/050 共享中间模型
- **Rationale**: 050 需要复用 045 的结构化视图和证据链，而不是重新建模
- **Alternatives considered**:
  - 只输出 Markdown
  - 将模板字段混入输出模型

### 决策 3

- **Decision**: 以版块级 availability + warning 支持降级
- **Rationale**: 对缺少 Compose 或非 monorepo 项目仍保持可用
- **Alternatives considered**:
  - 任一输入缺失即失败

## 结论

045 的实现应当聚焦于结构化组合、视图建模和文档渲染，不应再产生新的底层事实抽取逻辑。共享运行时模型由 043 提供，共享架构视图模型由 045 提供，050 在此基础上增强。
