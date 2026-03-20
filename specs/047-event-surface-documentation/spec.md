# Feature Specification: 事件面文档

**Feature Branch**: `047-event-surface-documentation`
**Created**: 2026-03-20
**Status**: Implemented
**Input**: User description: "推进 047，实现事件面文档"

---

## User Scenarios & Testing

### User Story 1 - 事件通道 inventory (Priority: P1)

作为维护者，我希望从代码中直接看到有哪些事件 channel / topic / queue、它们的发布者和订阅者分别是谁，这样我能快速理解系统内的异步交互面。

**Independent Test**: 对包含 `emit/on` 与 `publish/subscribe` 模式的 fixture 运行 EventSurfaceGenerator，验证输出列出 channels、publishers、subscribers。

### User Story 2 - 消息结构摘要 (Priority: P1)

作为维护者，我希望事件文档还能给出消息 payload 的结构摘要，即便只是对象字段层级的近似结果，也能帮助我判断事件契约是否稳定。

**Independent Test**: 对发布端包含对象字面量 payload 的 fixture 运行生成器，验证输出中包含字段名列表或 payload 摘要。

### User Story 3 - 可选低置信状态附录 (Priority: P2)

作为维护者，我希望当事件命名呈现明显状态迁移特征时，文档能附一个低置信 Mermaid 附录，但这部分不应影响主文档可用性。

**Independent Test**: 对包含 `ticket.opened` / `ticket.closed` 这类事件命名的 fixture 运行生成器，验证附录图统一标注 `[推断]` 和置信度。

---

## Edge Cases

- `emit/on` 方法可能出现在非事件语义代码中，核心抽取需限制为“显式 channel 字符串 + 明确调用模式”
- 同一 channel 可能在多个文件重复发布或订阅，输出必须去重并保留多来源
- payload 不是对象字面量时，应回退为表达式摘要，不能臆造字段结构
- 仅存在 publisher 或仅存在 subscriber 的 channel 也应保留在 inventory 中
- 状态机推断失败时只需省略附录，不影响主文档生成

---

## Requirements

### Functional Requirements

- **FR-001**: 系统 MUST 新增 `EventSurfaceGenerator`，实现 `DocumentGenerator<EventSurfaceInput, EventSurfaceOutput>` 接口。
- **FR-002**: 生成器 MUST 检测至少两类模式：`emit/on/once/addListener` 与 `publish/subscribe/consume/send`。
- **FR-003**: 系统 MUST 仅在首个参数可解析为显式 channel/topic/queue 字符串时纳入主 inventory。
- **FR-004**: 输出 MUST 包含每个 channel 的 `channelName`、`kind`、`publishers[]`、`subscribers[]`。
- **FR-005**: 输出 MUST 为每个 channel 提供消息结构摘要；对象字面量 payload 至少提取一层字段名。
- **FR-006**: 系统 MUST 记录每条事件证据的来源文件，且路径使用相对项目根的格式。
- **FR-007**: 生成器 MUST 支持 TypeScript / JavaScript AST 抽取，并为无法 AST 解析的场景提供轻量文本回退。
- **FR-008**: 如检测到明显状态命名模式，系统 MAY 输出低置信状态附录，但附录必须标注 `[推断]` 与置信度。
- **FR-009**: 系统 MUST 提供 Markdown 渲染模板 `event-surface.hbs`。
- **FR-010**: 系统 MUST 在 `GeneratorRegistry` 和 `src/panoramic/index.ts` 中注册并导出 047 能力。

### Success Criteria

- **SC-001**: 对包含 EventEmitter 和自定义 bus 模式的 fixture，输出能正确列出 channel、publishers、subscribers。
- **SC-002**: 至少一个对象字面量 payload 会被提取出字段摘要并展示到文档中。
- **SC-003**: `GeneratorRegistry.filterByContext()` 能发现 047 generator，并在无事件模式的项目上返回不适用。
- **SC-004**: 当状态命名模式存在时，附录 Mermaid 图统一标注 `[推断]` 和置信度；不存在时主文档仍正常生成。
