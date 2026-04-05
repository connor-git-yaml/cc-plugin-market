# Feature Specification: 产品生成产物边界清理

**Feature Branch**: `071-product-artifact-boundary-cleanup`  
**Created**: 2026-04-05  
**Status**: Implemented  
**Input**: 将 `070` 蓝图的第一步落地，先解决 `specs/products` 的历史目录债务，并把目录规范写入 `AGENTS.md`

## User Scenarios & Testing

### User Story 1 - 产品事实源与生成产物分层 (Priority: P1)

作为仓库维护者，我希望 `specs/products/<product>/current-spec.md` 继续作为人工维护的产品事实正文，而 `entity / workflow-index / scorecard-report / quality-report / adoption-report` 这类机器生成产物统一迁到 `_generated/`，这样目录一眼就能分清“源”与“派生”。

**Independent Test**: 运行 entity/workflow/quality/scorecard/adoption helper，验证所有输出都写入 `specs/products/<product>/_generated/` 或 `specs/products/_generated/`。

### User Story 2 - 生成链路共享同一套路径合同 (Priority: P1)

作为脚本维护者，我希望 entity、workflow、quality、scorecard、adoption 五条生成链路都复用同一个路径 helper，而不是在每个脚本里手写路径，这样后续目录演进只需要改一处。

**Independent Test**: 运行集成测试，确认五条脚本链路都按新路径写出，并且兼容读取旧路径作为回退。

### User Story 3 - 团队约定能在仓库入口直接看到 (Priority: P2)

作为协作者，我希望在 `AGENTS.md` 里直接看到简洁的目录结构规范，知道哪些目录是源码、哪些目录是运行态、哪些目录是产品事实源、哪些目录只能放生成产物。

**Independent Test**: 检查 `AGENTS.md`，确认新增精简的“目录结构约定”章节，且不引入冗长重复说明。

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 将产品级机器生成产物统一写入 `specs/products/<product>/_generated/`
- **FR-002**: 系统 MUST 将跨产品索引统一写入 `specs/products/_generated/`
- **FR-003**: `specs/products/<product>/current-spec.md` MUST 继续保留为产品级人工事实正文
- **FR-004**: entity/workflow/quality/scorecard/adoption 生成脚本 MUST 复用共享路径 helper
- **FR-005**: 生成脚本 MAY 兼容读取旧路径作为回退，但新写入 MUST 只使用新路径
- **FR-006**: `spec-driver-sync` 的 skill / workflow / agent 文档 MUST 更新到新目录合同
- **FR-007**: 与新目录合同相关的集成测试 MUST 同步更新
- **FR-008**: `AGENTS.md` MUST 增加精简的目录结构约定，不得显著膨胀

## Success Criteria

- `specs/products/` 根目录不再混放 `catalog-index`、`scorecard-index`、`quality-report-index`
- `specs/products/reverse-spec/_generated/` 与 `specs/products/spec-driver/_generated/` 已包含对应产物
- 五条 helper 的集成测试通过
- `npm run lint` 与 `npm run build` 通过

