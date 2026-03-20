# Technical Research: 故障排查 / 原理说明文档

## 现有基座

### 1. panoramic generator 契约可直接复用

- `src/panoramic/interfaces.ts` 已定义 `isApplicable -> extract -> generate -> render`
- `GeneratorRegistry` 与桶文件导出模式已稳定
- Handlebars 模板加载、Markdown 渲染和 registry 集成都有现成样例

### 2. 配置与上下文能力已经存在

- `src/panoramic/project-context.ts` 可提供 `projectRoot`、`configFiles` 和已识别语言
- `ConfigReferenceGenerator` 和 `EnvConfigParser` 已证明 `.env` / 配置文件扫描路径可行

### 3. 048 最稳的实现方式是“静态证据聚合”

优先证据：
- 显式 `throw new Error(...)`
- `logger.error(...)` / `console.error(...)`
- `process.env.*` / `getenv(...)`
- retry / reconnect / fallback / recover 关键字

避免项：
- 不做运行时采样
- 不做真实 FAQ 生成
- 不把 explanation 建立在 LLM 幻觉上

## 设计结论

### Decision 1: 以配置约束和错误模式生成主条目

条目来源分两类：
- `config-constraint`: 显式环境变量 / 配置校验
- `error-pattern`: 显式错误消息 / error log

理由：
- 证据最稳定
- 易于生成相关位置
- 足够支撑“症状-原因-处理步骤”最小闭环

### Decision 2: recovery / fallback 只作为证据增强

检测 `retry` / `reconnect` / `fallback` / `recover` 等关键字，用于：
- 追加 recovery steps
- 生成 explanation 背景说明

不单独输出 recovery-only 条目。

理由：
- 可以减少“凭空推断故障”的风险
- 与蓝图“替代 FAQ、强调 grounded explanation”一致

### Decision 3: 先用静态规则实现，不把 LLM 作为硬依赖

048 在蓝图中属于语义增强方向，但当前最重要的是：
- Claude / Codex 双端可运行
- AST-only / rule-only 可稳定退化
- 产物可测试

因此首版以规则实现为主，后续如需要再叠加 LLM explanation 增强。
