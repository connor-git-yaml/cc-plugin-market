# Tech Research: 064 Workflow Registry 与 Golden Paths

## 决策摘要

### 1. 不引入数据库或服务端 Catalog

**结论**: workflow registry 保持 Git-native，定义为 YAML、输出为 Markdown/JSON。  
**原因**:

- 064 只是把六个 skill 的入口变成 machine-readable 定义
- 本轮不需要 UI、审批系统或远程策略引擎
- Git review 已足够满足“可见、可审计、可回滚”

### 2. `.specify/workflows` 只做 metadata-only override

**结论**: 项目级覆盖不能修改 `entryCommand`、`keyGates`、`artifacts`。  
**原因**:

- 这些字段属于 skill 核心语义
- 如果允许项目级覆盖核心语义，workflow registry 会和实际 skill 行为脱节

### 3. `workflow-index` 放在 `specs/products/spec-driver/`

**结论**: index 与 `current-spec.md`、`entity.yaml` 同目录。  
**原因**:

- 它属于 `spec-driver` 产品事实层的一部分
- `spec-driver-doc` 后续读取时无需跨目录猜测
