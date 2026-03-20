# Research Summary: 故障排查 / 原理说明文档

## 结论

048 适合沿用现有 panoramic generator 抽象，以静态证据拼接为主，不引入 LLM 必选依赖。

## 关键决策

- 核心交付是 grounded troubleshooting entries，不恢复 FAQ 模式
- 以源码中的显式错误模式和配置约束作为主证据
- recovery / fallback 只用于补充处理步骤和 explanation，不单独编造故障
- explanation 段落必须由已抽取的 evidence 反推，不允许无依据总结
