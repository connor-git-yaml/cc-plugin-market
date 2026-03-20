# Feature Specification: 故障排查 / 原理说明文档

**Feature Branch**: `048-troubleshooting-explanation-docs`
**Created**: 2026-03-20
**Status**: Implemented
**Input**: User description: "推进 048，实现故障排查 / explanation 文档"

---

## User Scenarios & Testing

### User Story 1 - 故障排查条目 (Priority: P1)

作为维护者，我希望自动生成“故障现象-可能原因-处理办法”条目，这样我在排查启动失败、依赖异常或配置错误时可以快速定位到相关代码和配置位置。

**Independent Test**: 对包含显式 `throw new Error(...)`、`logger.error(...)`、环境变量校验和恢复路径的 fixture 运行 generator，验证输出中生成至少 5 条条目，且每条都包含 symptom / causes / recovery steps / related locations。

### User Story 2 - 配置约束抽取 (Priority: P1)

作为维护者，我希望 generator 能把环境变量或关键配置约束纳入排障文档，这样我能直接看到“哪些配置缺失或非法会触发故障”。

**Independent Test**: 对包含 `process.env.X` / `os.getenv("X")` 校验和 `.env.example` 的 fixture 运行 generator，验证输出中包含对应配置键、错误症状和配置文件/源码位置。

### User Story 3 - 原理说明段落 (Priority: P2)

作为维护者，我希望在排障条目之外，还能看到 explanation 风格的补充说明，解释系统为何采用 fail-fast、重试或 fallback 等机制，但这些说明必须来自现有证据而不是编造。

**Independent Test**: 对包含 fail-fast 配置校验和 retry/fallback 路径的 fixture 运行 generator，验证 explanation 段落出现，并引用对应 evidence。

---

## Edge Cases

- 重复的错误消息或重复引用的环境变量必须合并，不能把同一问题拆成多条重复条目
- recovery / fallback 只可作为已有条目的处理步骤或 explanation 证据，不能单独编造不存在的故障
- 没有显式错误消息时，可退化为“相关功能不可用 / 启动失败”这类保守症状，但必须附带具体代码位置
- explanation 段落必须来自已有条目证据，不允许超出源码和配置中可观察到的事实
- 当项目中故障信号不足时，文档仍应生成，但需要写入 warning 说明“条目不足 5 条”

---

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 新增 `TroubleshootingGenerator`，实现 `DocumentGenerator<TroubleshootingInput, TroubleshootingOutput>` 接口。
- **FR-002**: 系统 MUST 扫描源码中的显式错误模式，至少覆盖 `throw new Error(...)`、`console.error(...)`、`logger.error(...)`。
- **FR-003**: 系统 MUST 抽取配置约束，至少覆盖 `process.env.*`、`process.env['KEY']`、`getenv("KEY")`、`os.getenv("KEY")` 这类显式配置引用。
- **FR-004**: 系统 MUST 生成结构化 troubleshooting 条目，每条至少包含 `symptom`、`possibleCauses[]`、`recoverySteps[]`、`relatedLocations[]`。
- **FR-005**: 系统 MUST 为条目记录源码或配置位置，路径使用相对项目根格式，并至少包含行号。
- **FR-006**: 系统 MUST 合并重复条目，避免同一配置键或同一错误消息在输出中重复出现。
- **FR-007**: 系统 SHOULD 识别 retry / reconnect / fallback / recover 等恢复路径，并将其纳入处理步骤或 explanation 证据。
- **FR-008**: explanation 段落 MUST 仅基于已有错误、配置约束和恢复路径证据生成，不得凭空编造 FAQ 式回答。
- **FR-009**: 系统 MUST 提供 `troubleshooting.hbs` 模板，输出 Markdown 文档。
- **FR-010**: 系统 MUST 在 `GeneratorRegistry` 和 `src/panoramic/index.ts` 中注册并导出 048 能力。
- **FR-011**: 当提取出的 troubleshooting 条目少于 5 条时，系统 MUST 在输出中写入 warning，而不是静默失败。

### Success Criteria

- **SC-001**: 对混合 fixture 运行 generator，输出至少 5 条 troubleshooting 条目，且每条都包含 symptom / causes / recovery steps / related locations。
- **SC-002**: 至少 2 条条目由配置约束驱动，能正确展示配置键和相关代码 / 配置位置。
- **SC-003**: 当代码中存在 retry 或 fallback 证据时，文档会生成 explanation 风格的背景说明，并引用相应 evidence。
- **SC-004**: `GeneratorRegistry.filterByContext()` 能发现 048 generator，并在无故障/配置信号的项目上返回不适用。
