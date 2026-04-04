# Tech Research: 063 产品实体目录与 Catalog 生成

## 决策摘要

### 1. 不引入新 YAML 依赖

**结论**: 使用最小定制解析与序列化，不新增运行时依赖。  
**原因**:

- 063 只需要读取当前仓库已经稳定使用的 `product-mapping.yaml` 结构
- 输出的 `entity.yaml` / `catalog-index.yaml` 也由我们自己控制格式
- 本轮目标是最小 Catalog，不值得为此引入新的 YAML 运行时依赖

### 2. Catalog helper 放在 `plugins/spec-driver/scripts/`

**结论**: helper 作为 plugin 脚本存在，而不是新的 `src/` 运行时模块。  
**原因**:

- 063 属于 `spec-driver-sync` 的后置制品生成，而不是 Reverse Spec 主 CLI 功能
- plugin 脚本可以被 `sync` skill 直接调用，也更贴合 Git-native、零服务的设计
- integration test 可以直接以脚本为边界验证输出

### 3. workflowRefs 先做静态映射

**结论**: 063 只维护稳定 workflow 引用列表，不提前做完整 registry schema。  
**原因**:

- 064 才是 Workflow Registry 与 Golden Paths 的正式交付
- 063 只需要保证实体目录具备可连接后续治理层的最小字段集
