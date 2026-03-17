---
feature: 025-multilang-adapter-layer
title: 技术决策研究
created: 2026-03-17
source: research/tech-research.md, clarify-results.md
---

# 技术决策研究: 语言适配器抽象层

## 1. 架构方案选型

### 1.1 候选方案

| 方案 | 核心思路 | 实现复杂度 | 扩展成本 |
|------|---------|:---------:|:-------:|
| A. 策略模式 + Registry | 静态注册，Map 查找 | 低（~200 行） | 低（1 行注册） |
| B. 插件式架构 | 动态发现 + 延迟加载 | 高（~600 行） | 中（独立 npm 包） |

### 1.2 决策：采用方案 A

**理由**：

1. **团队规模匹配**：reverse-spec 当前为单团队维护，无社区插件需求
2. **Blueprint 范围有限**：仅规划 4 种新语言（Python、Go、Java + 混合），均为内部实现
3. **演化路径开放**：方案 A 不排斥后续演化为方案 B，Registry 可添加动态加载能力
4. **复杂度最小化**：符合 Constitution VII 纯 Node.js 生态原则
5. **类型安全**：编译时即可检查接口实现完整性

### 1.3 风险缓解

方案 A 的主要劣势是"所有适配器启动时加载"。缓解措施：

- 当前仅有 `TsJsLanguageAdapter` 一个实例，启动开销可忽略
- 后续新增适配器（Python、Go、Java）的初始化逻辑轻量（无需初始化解析器实例）
- tree-sitter grammar WASM 文件在 Feature 027 中按需加载，不在 Registry 注册时加载

---

## 2. 单例 vs 依赖注入

### 2.1 决策：单例模式 + 可选依赖注入后门

**单例模式**：
- 与现有 `sharedProject` 单例风格一致
- `LanguageAdapterRegistry.getInstance()` 全局访问
- `resetInstance()` 支持测试隔离

**依赖注入后门**：
- 编排器方法（如 `analyzeFile`）保留接受 `registry?: LanguageAdapterRegistry` 参数的可能性
- 默认使用 `LanguageAdapterRegistry.getInstance()`，测试时可传入 mock registry
- 本 Feature 暂不实现参数注入（避免改动公共 API 签名），留给后续需要时添加

### 2.2 测试隔离策略

```typescript
// 每个测试用例的 setup/teardown
beforeEach(() => {
  LanguageAdapterRegistry.resetInstance();
});

afterEach(() => {
  LanguageAdapterRegistry.resetInstance();
});
```

---

## 3. 扩展名匹配策略

### 3.1 大小写处理

**决策**：`getAdapter()` 统一将扩展名转为小写后匹配。

**理由**：
- Windows 文件系统大小写不敏感，`.TS` 和 `.ts` 是同一文件
- macOS 默认大小写不敏感（HFS+ / APFS）
- `path.extname()` 保留原始大小写，需要手动归一化
- 注册时扩展名也统一转为小写存储

### 3.2 复合扩展名

**决策**：仅使用 `path.extname()` 的默认行为（取最后一段）。

**理由**：
- `path.extname('file.test.ts')` → `.ts`（正确识别为 TypeScript）
- `path.extname('types.d.ts')` → `.ts`（正确识别为 TypeScript）
- 无需特殊处理，现有行为在所有目标语言中均正确

### 3.3 无扩展名文件

**决策**：`getAdapter()` 对无扩展名或空扩展名文件返回 `null`。

**实现**：`path.extname('')` 返回 `''`，Map 中不会注册空字符串 key，自然返回 `undefined` → `null`。

---

## 4. CodeSkeleton 模型变更策略

### 4.1 决策：静态正则 + 已知限制

基于 clarify-results.md Q2，选择**选项 B**。

**理由**：
- Zod schema 作为数据模型层应保持确定性，不依赖运行时状态
- 将 `filePath` 验证绑定到 Registry 会引入循环依赖风险
- 新增语言时需同步更新正则，但这是一次性操作（仅在新增适配器时）
- 在文档中明确标注为"已知限制"

### 4.2 向后兼容性验证

| 场景 | 旧值 | 新 schema 结果 |
|------|------|:-------------:|
| `language: 'typescript'` | 现有 | PASS |
| `language: 'javascript'` | 现有 | PASS |
| `filePath: 'src/foo.ts'` | 现有 | PASS |
| `kind: 'function'` | 现有 | PASS |
| `kind: 'struct'` | 新增 | PASS（新值） |
| `language: 'python'` | 新增 | PASS（新值） |
| `kind: 'unknown_value'` | 非法 | FAIL（ZodError） |

---

## 5. 消费端改造范围决策

### 5.1 决策：最小改造（Q1 选项 C）

基于 clarify-results.md Q1，选择**选项 C**。

**改造范围**：

| 组件 | 改造方式 | TS/JS 输出变化 |
|------|---------|:-------------:|
| `context-assembler.ts` | 代码块标记从硬编码改为 `skeleton.language` | 无变化（`'typescript'` → `'typescript'`） |
| `secret-redactor.ts` | `isTestFile()` 从 Registry 获取 TestPatterns | 无变化（正则结果相同） |
| `semantic-diff.ts` | 代码块标记动态化 | 无变化 |
| `noise-filter.ts` | **不改造**（推迟到 Feature 026） | 无变化 |
| `llm-client.ts` | **不改造**（推迟到 Feature 026） | 无变化 |

**不改造 `llm-client.ts` 的理由**：
- prompt 术语参数化涉及大量文本替换和 LLM 输出质量验证
- 应作为独立 Feature（026-multilang-prompt-parameterize）实施
- 本 Feature 仅建立契约（`LanguageTerminology` 类型），不消费

---

## 6. 跳过提示输出规格

### 6.1 决策

基于 clarify-results.md Q3：

| 属性 | 决策 |
|------|------|
| 输出通道 | stderr（不影响管道） |
| 日志级别 | `warn` |
| 格式 | 按扩展名聚合：`跳过 3 个 .py 文件, 2 个 .go 文件（不支持的语言）` |
| 静默模式 | 尊重未来的 `--quiet` 选项（当前不实现，但预留接口） |

### 6.2 实现位置

在 `file-scanner.ts` 的 `walkDir()` 或 `scanFiles()` 中收集不支持扩展名的统计信息，在 `scanFiles()` 返回前输出 warn 日志。

---

## 7. TsJsLanguageAdapter 封装策略

### 7.1 委托 vs 复制

**决策**：委托（delegation），不复制代码。

**理由**：
- 委托保留了现有代码的所有行为细节（包括 ts-morph Project 单例、错误处理、降级逻辑）
- 避免代码重复和同步维护问题
- 后续 Feature 如需重构内部实现，修改点仍集中在原文件

### 7.2 循环依赖防护

`TsJsLanguageAdapter` 位于 `src/adapters/ts-js-adapter.ts`，需要 import：
- `src/core/ast-analyzer.ts`（analyzeFile）
- `src/core/tree-sitter-fallback.ts`（analyzeFallback）
- `src/graph/dependency-graph.ts`（buildGraph）

反向：编排器通过 Registry 获取适配器，不直接 import `ts-js-adapter.ts`。

```
src/adapters/ts-js-adapter.ts → src/core/ast-analyzer.ts（单向）
src/core/single-spec-orchestrator.ts → src/adapters/ (via Registry, 间接)
```

无循环依赖风险。

---

## 8. 启动初始化时机

### 8.1 决策

在 CLI `main()` 和 MCP `createMcpServer()` 的**最早时机**调用 `bootstrapAdapters()`。

### 8.2 bootstrapAdapters() 设计

```typescript
export function bootstrapAdapters(): void {
  const registry = LanguageAdapterRegistry.getInstance();

  // 防止重复注册（幂等性）
  if (registry.getAllAdapters().length > 0) return;

  registry.register(new TsJsLanguageAdapter());
}
```

**幂等性保证**：如果已有适配器注册（例如测试中手动注册），不重复注册。

---

## 9. 技术限制与已知约束

| 限制 | 影响 | 缓解 |
|------|------|------|
| `filePath` Zod 正则为静态硬编码 | 新增语言需同步更新正则 | 文档明确标注，SC-003 排除此文件 |
| `llm-client.ts` prompt 术语未参数化 | 非 TS/JS 语言的 LLM prompt 使用不准确术语 | Feature 026 解决 |
| `noise-filter.ts` import 正则仅匹配 JS/TS | 非 TS/JS 文件的噪声过滤不完整 | Feature 026 解决 |
| `tree-sitter`/`tree-sitter-typescript` 死代码 | package.json 中存在未使用的原生依赖 | Feature 027 清理 |
