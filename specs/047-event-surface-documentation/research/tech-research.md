# Technical Research: 事件面文档

## 现有基座

### 1. panoramic generator 契约已稳定

- `src/panoramic/interfaces.ts` 定义 `isApplicable -> extract -> generate -> render`
- `GeneratorRegistry` 已有多类 generator 接入样例
- 模板加载与渲染约定已稳定，可直接复用 `loadTemplate()`

### 2. 现有代码中已存在事件相关样本

仓库内至少已有：
- `tests/integration/pipeline.test.ts` 使用 `EventEmitter`
- `tests/unit/cli-proxy.test.ts` / `tests/unit/codex-proxy.test.ts` 也有 `EventEmitter` 引用

这意味着 047 的最小实现可以先覆盖 Node / TS 生态里的显式事件模式。

## 设计结论

### Decision 1: 主抽取范围限定为显式字符串 channel

例如：
- `emitter.emit('user.created', payload)`
- `bus.publish('billing.invoiced', payload)`
- `queue.consume('jobs.sync', handler)`

不将 `emit(eventNameVar, payload)` 这类动态 channel 纳入主 inventory。

理由：
- 能显著降低误报
- 与蓝图的“inventory 优先、保守推断”方向一致

### Decision 2: TS/JS 用 AST，其他语言只做轻量文本模式

TS/JS：
- 用 `ts-morph` 遍历 `CallExpression`
- 提取方法名、channel 字符串、payload 表达式、handler 名称

其他语言：
- 仅做正则级别的 `.publish("...") / .subscribe("...") / .consume("...")` 候选识别

理由：
- 当前仓库已对 TS AST 能力成熟
- 047 的核心目标是 inventory，不要求多语言深度语义等价

### Decision 3: payload 结构只摘要，不生成严格 schema

抽取规则：
- 对象字面量 -> 字段名列表
- 标识符 / 调用表达式 -> 表达式摘要
- 无 payload -> 标记为空

理由：
- 047 不应与 038 数据模型文档重叠
- 保守摘要更稳定，也更适合 inventory 文档

### Decision 4: 状态附录只做低置信启发式

仅当 channel 命名满足明显状态模式时才生成附录，例如：
- `ticket.opened`
- `ticket.closed`
- `order.approved`
- `order.rejected`

附录统一标注 `[推断] confidence=low`，并与主 inventory 分离。
