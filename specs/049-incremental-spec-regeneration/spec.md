# Feature Specification: 增量差量 Spec 重生成

**Feature Branch**: `049-incremental-spec-regeneration`
**Created**: 2026-03-20
**Status**: Implemented
**Input**: User description: "推进 049，基于 skeleton hash + doc graph 做增量重生成"

---

## User Scenarios & Testing

### User Story 1 - 仅重生成直接受影响的 Spec (Priority: P1)

作为维护者，我希望在修改源码后运行 `reverse-spec batch --incremental` 时，只重生成真正受影响的 spec，而不是整仓全量重跑。

**Independent Test**: 先完整生成一组 module spec，再只修改其中一个独立模块的源码，执行增量 batch，验证仅该模块 spec 被重写，其他 module spec 内容与 mtime 保持不变。

### User Story 2 - 依赖方级联重生成 (Priority: P1)

作为维护者，我希望当被依赖模块发生结构变更时，其依赖方 spec 也会被自动纳入重生成范围，这样依赖关系、交叉引用和索引不会滞后。

**Independent Test**: 构造 `api -> auth` 的依赖链，只修改 `auth` 源码，执行增量 batch，验证 `auth.spec.md` 与 `api.spec.md` 被重生成，而无关模块不变。

### User Story 3 - 输出差量分析报告 (Priority: P2)

作为维护者，我希望增量 batch 能告诉我“为什么这些 spec 被重生成、哪些保持不变”，这样我可以快速判断影响范围是否合理。

**Independent Test**: 对包含直接变更、依赖传播和未受影响模块的 fixture 运行增量 batch，验证 `_delta-report.md` / `_delta-report.json` 中正确列出直接命中、传播命中和 unchanged 三类结果。

---

## Edge Cases

- 首次运行或输出目录下不存在可复用的 module spec 时，增量模式必须自动回退到全量生成
- `--force` 与 `--incremental` 同时出现时，`--force` 优先，系统按全量重生成处理
- `root` 散文件模块需要按文件级 sourceTarget 判断是否重生成，不能因为同属 `root` 就整体重写全部散文件 spec
- 旧 spec 缺少 `skeletonHash`、`sourceTarget` 或 frontmatter 损坏时，系统必须采用保守策略重生成对应目标
- 增量模式允许重写 `_index.spec.md`、`_doc-graph.json`、`_coverage-report.*`、`_delta-report.*` 等汇总产物，但未受影响的 module spec 不得被重写

---

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 新增 `DeltaRegenerator`，基于当前源码、既有 module spec frontmatter 和依赖图计算增量重生成计划。
- **FR-002**: 系统 MUST 使用已有 spec 的 `skeletonHash` 与当前源码骨架哈希做直接变更检测。
- **FR-003**: 系统 MUST 使用 dependency graph 的反向传播分析级联影响范围，使被依赖模块变更时依赖方 spec 也被纳入重生成。
- **FR-004**: 系统 MUST 使用 doc graph / source-to-spec 事实将受影响源码映射回 spec owner，而不是仅依赖输出文件名猜测。
- **FR-005**: 系统 MUST 支持 `reverse-spec batch --incremental` 入口，并将增量模式透传到 `runBatch()`。
- **FR-006**: 当增量计划判断某个 sourceTarget 未受影响时，batch MUST 复用其已有 spec，不得重写该 module spec 文件。
- **FR-007**: 当增量计划判断某个 sourceTarget 受影响时，batch MUST 即使在 `force=false` 下也重生成该 spec。
- **FR-008**: batch MUST 在增量模式下继续生成完整的 `_index.spec.md`、`_doc-graph.json`、`_coverage-report.md`、`_coverage-report.json`，且这些汇总结果同时包含“本次重生成”和“沿用旧 spec”的模块。
- **FR-009**: 系统 MUST 输出 `_delta-report.md` 与 `_delta-report.json`，至少包含 `mode`、`directChanges`、`propagatedChanges`、`unchangedTargets` 三类信息。
- **FR-010**: `BatchResult` MUST 暴露 delta report 路径，CLI MUST 在 batch 完成后打印该路径。
- **FR-011**: 对 root 散文件模块，系统 MUST 以文件级 sourceTarget 做增量判断，避免同一 root 组内的无关 spec 被误重写。
- **FR-012**: 当无法可靠判断影响范围时，系统 MUST 采用保守策略扩大重生成范围，且在 delta report 中记录 fallback reason。
- **FR-013**: 未开启 `--incremental` 时，现有 batch 语义 MUST 保持不变。

### Success Criteria

- **SC-001**: 修改一个独立模块后运行增量 batch，仅该模块的 `*.spec.md` 被重写，其他无关 module spec 的内容和 mtime 完全不变。
- **SC-002**: 修改一个被依赖模块后运行增量 batch，其依赖方 spec 会被一起重生成，无关模块仍保持不变。
- **SC-003**: 当项目不存在旧 spec 或旧 spec 元数据缺失时，增量 batch 自动回退全量生成且不报错。
- **SC-004**: 输出目录中生成 `_delta-report.md` 与 `_delta-report.json`，并能解释直接命中、传播命中和 unchanged 的目标列表。
