# Research: 修复 Spec 输出中的绝对路径问题

**Feature**: 008-fix-spec-absolute-paths
**Date**: 2026-02-14

## Decision 1: 路径转换位置

**Decision**: 在 `single-spec-orchestrator.ts` 的 `generateSpec()` 中转换，不在 `generateFrontmatter()` 或调用方（CLI/batch）中转换。

**Rationale**:
- `generateSpec()` 是所有路径写入 frontmatter 的唯一汇聚点
- 已有 `relatedFiles` 和 `fileInventory` 的相对路径转换逻辑在此处
- 在此处转换可统一 generate 和 batch 两种模式，无需分别修改两个调用方
- `generateFrontmatter()` 是纯透传函数，不应承担路径归一化责任（单一职责）

**Alternatives considered**:
1. 在 CLI 入口（`generate.ts`、`batch-orchestrator.ts`）传入相对路径 → 需要修改多处调用方，且 `generateSpec` 内部对 `targetPath` 有 `path.resolve()` 操作，传入相对路径可能引发副作用
2. 在 `generateFrontmatter()` 中接收额外 `projectRoot` 参数做转换 → 违反单一职责，增加接口复杂度
3. 在 Handlebars 模板中用 helper 转换 → 模板层不应处理路径逻辑

## Decision 2: 基准路径（baseDir）选择

**Decision**: 使用 `options.projectRoot`（优先）或 `process.cwd()` 作为基准路径，与 `fileInventory` 保持一致。

**Rationale**:
- `projectRoot` 由调用方明确传入（`generate.ts:40` 传 `process.cwd()`，`batch-orchestrator.ts:146` 传 `resolvedRoot`），语义明确
- `fileInventory` 已使用此逻辑（行 327），统一基准避免路径不一致
- 当用户从子目录运行命令时，`process.cwd()` 指向子目录，`projectRoot` 则正确指向项目根——后者更可靠

**Alternatives considered**:
1. 始终使用 `process.cwd()` → 当前 `relatedFiles` 的做法，但与 `fileInventory` 不一致，且从子目录运行时结果不正确
2. 使用 git root 自动检测 → 增加不必要的复杂度，且项目可能不使用 git

## Decision 3: 附带统一 `relatedFiles` 基准路径

**Decision**: 将 `relatedFiles` 的基准从 `process.cwd()` 统一为 `baseDir`。

**Rationale**:
- 当前 `relatedFiles` 使用 `path.relative(process.cwd(), f)` 而 `fileInventory` 使用 `path.relative(baseDir, s.filePath)`
- 两者本应使用相同基准——统一为 `baseDir` 可消除潜在的路径不一致
- 在绝大多数场景下 `process.cwd()` 等于 `projectRoot`，此修改不会改变行为，但增强了正确性

**Alternatives considered**:
1. 不修改 `relatedFiles` → 可行但留下已知的不一致性，违反 FR-004 的"确保不退化"要求
