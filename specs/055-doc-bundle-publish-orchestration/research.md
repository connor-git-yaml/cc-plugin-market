# Research Summary: 文档 Bundle 与发布编排

## 决策摘要

### 决策 1

- **Decision**: 055 采用 batch 后置 `DocsBundleOrchestrator`，而不是新增事实抽取器或独立 generator
- **Rationale**: 055 的职责是交付编排，最自然的挂接点是 053 文档套件写出完成后的 `runBatch()` 末尾
- **Alternatives considered**:
  - 把 bundle 逻辑塞进各个 panoramic generator
  - 新增独立命令重新扫描 specs/

### 决策 2

- **Decision**: 根级输出 `docs-bundle.yaml`，每个 profile 目录独立输出 `mkdocs.yml` + `docs/`
- **Rationale**: 同时满足“统一发布元数据”和“MkDocs / TechDocs 可消费骨架”两类需求
- **Alternatives considered**:
  - 仅输出 `mkdocs.yml`
  - 仅输出单一 manifest，不生成 profile 目录

### 决策 3

- **Decision**: profile 导航顺序由显式阅读路径定义驱动，不从目录或文件名自动推导
- **Rationale**: 蓝图明确要求 bundle 导航体现阅读路径，自动排序无法稳定表达“先读整体、后读细节”
- **Alternatives considered**:
  - 按文件名排序
  - 按写出时间排序

### 决策 4

- **Decision**: bundle 仅消费当前 batch 输出目录中的 module specs、`_index.spec.md` 和 053 项目级文档
- **Rationale**: 避免重复抽取事实，保持 055 作为交付层、056 作为 IR 层的边界
- **Alternatives considered**:
  - 重新运行 panoramic generators
  - 重新扫描源码推导 bundle 内容

## 结论

055 应聚焦“如何交付文档”，而不是“如何重新生成文档”。最小可行解是：在 batch 末尾基于已有输出生成 `docs-bundle.yaml`、profile 目录、landing page 和 `mkdocs.yml`，并用清晰的 profile 定义保证四种 bundle 的阅读路径和文档集合确实不同。
