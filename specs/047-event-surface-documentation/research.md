# Research Summary: 事件面文档

## 结论

047 适合沿用现有 panoramic generator 抽象，以“静态候选抽取 + 聚合渲染”为主，不引入真实 AsyncAPI 推导或运行时采样。

## 关键决策

- 核心范围限定为事件 inventory，不把状态机推断纳入主交付
- 优先使用 TS/JS AST 检测，辅以轻量文本回退
- 只接受显式字符串 channel，避免误把任意动态调用纳入主文档
- payload 结构只做保守摘要，不做完整 schema 生成
