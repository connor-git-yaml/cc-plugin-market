# Phase 0 Research: Reverse-Spec Skill System v2.0

**Date**: 2026-02-10 | **Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

## Research Topics

| # | Topic | Status | Decision |
|---|-------|--------|----------|
| R1 | ts-morph 大规模 AST 提取最佳实践 | Resolved | 单 Project 实例 + skipFileDependencyResolution + noLib + file.forget() |
| R2 | dependency-cruiser 程序化 API | Resolved | cruise() 函数 + JSON 输出 + 邻接表 + Tarjan SCC |
| R3 | Handlebars vs EJS 模板引擎 | Resolved | Handlebars（Markdown 兼容性 + 非开发者可维护性 + partial 继承） |
| R4 | 敏感信息检测与脱敏模式 | Resolved | 自建轻量扫描器（正则 + 熵检测 + 语义占位符脱敏） |
| R5 | Token 计数与上下文预算管理 | Resolved | 两阶段计数（快速字符估算 → 精确 tokenizer）+ 哈希缓存 |

---

## R1: ts-morph 大规模 AST 提取

### Decision

使用**单个 Project 实例** + 性能优化配置，目标 500 文件 AST 预处理 ≤ 10 秒。

### Rationale

- **单 Project 实例 vs 逐文件实例**：3-5x 速度提升（TypeScript Program 初始化开销只需一次）
- **skipFileDependencyResolution**: 不跟踪 import 解析，50-70% 加速
- **noLib: true**: 不加载 TypeScript lib.d.ts，30-40% 加速
- **file.forget()**: 处理完立即释放内存，防止内存增长

### Key Configuration

```typescript
const project = new Project({
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,  // 关键：不解析 import
  compilerOptions: {
    noLib: true,          // 关键：不加载 lib.d.ts
    skipLibCheck: true,
    noResolve: true,      // 不解析模块导入
    allowJs: true,
    types: []             // 不加载 @types
  }
});
```

### Skeleton 提取策略

采用 **从 AST 重建 Skeleton**（而非源码变异），更可靠：
- 保留 import 声明
- 提取 exported interfaces、type aliases、classes（含方法签名）、functions（含参数和返回类型）
- 保留 JSDoc 注释
- 保留 type parameters、extends/implements 子句
- 方法体替换为 `;` 或 `{}`

### 容错降级触发条件

1. `.js` 文件语法错误（ts-morph 比实际 JS 更严格）
2. 实验性语法（decorators 等）
3. 文件 > 1MB（性能问题）
4. JSX 非标准 pragma
5. 连续 3+ 次 ts-morph 失败（状态损坏）

→ 降级到 tree-sitter-typescript 容错解析

### 内存管理策略

| 文件数 | 策略 |
|--------|------|
| < 100 | 一次性全部处理（最快） |
| 100–500 | 单 Project + file.forget() 逐文件释放 |
| 500–2000 | 批处理（50-100 文件/批） |
| > 2000 | Worker Threads + 批处理 |

### Alternatives Considered

- **逐文件 Project 实例**：Rejected — 15-25s for 500 files，超出 10s 目标
- **Worker Threads 并行**：Deferred — 当前规模（≤500）不需要，预留扩展接口
- **SWC parser**：Rejected — 非 npm 纯生态（Rust native），违反 Constitution Principle V

---

## R2: dependency-cruiser 程序化 API

### Decision

使用 `cruise()` 函数以 JSON 输出格式获取依赖图，自建邻接表 + Tarjan 算法检测 SCC。

### Rationale

- dependency-cruiser 的 `cruise()` 是官方程序化 API，返回结构化 JSON
- `tsPreCompilationDeps: true` 比完整类型解析快 2-3x
- JSON 输出包含完整依赖类型信息，便于过滤内部模块
- 自建图算法（Tarjan）比引入 graphlib 更轻量

### API Usage

```typescript
import { cruise } from 'dependency-cruiser';

const result = cruise(['src'], {
  outputType: 'json',
  doNotFollow: {
    dependencyTypes: ['npm', 'npm-dev', 'npm-optional', 'core']
  },
  includeOnly: '^src/',
  tsPreCompilationDeps: true,
  tsConfig: { fileName: './tsconfig.json' },
  exclude: { path: '\\.(spec|test)\\.(js|ts)$' }
});
```

### Output Structure

- `modules[].source` — 文件路径（相对项目根）
- `modules[].dependencies[]` — 依赖数组
  - `dependencies[].resolved` — 解析后的目标文件路径
  - `dependencies[].dependencyTypes` — 类型数组（`'local'` = 内部模块）
  - `dependencies[].circular` / `dependencies[].cycle` — 循环依赖信息

### Graph Construction

从 cruise JSON 构建邻接表：
1. 第一遍：创建所有节点 (module.source → node)
2. 第二遍：构建正向边（source → dependency）和反向边（dependency ← source）
3. 只保留 `dependencyTypes.includes('local')` 的内部依赖

### 性能特征

- **200 模块冷启动**: 2-5 秒
- **缓存后**: 快 30-50%
- **I/O 受限**: 性能主要受文件系统读取和 TS 解析限制

### Alternatives Considered

- **graphlib (@dagrejs/graphlib)**: Rejected — 增加外部依赖，自建 Tarjan 更轻量
- **madge**: Rejected — 功能更受限，不如 dependency-cruiser 灵活
- **ts-morph 内建 import 解析**: Rejected — 不生成完整依赖图，需要额外工作

---

## R3: 模板引擎选择 — Handlebars vs EJS

### Decision

选择 **Handlebars** (`handlebars ^4.7.8`)。

### Rationale

| 维度 | Handlebars | EJS | 判定 |
|------|-----------|-----|------|
| Markdown 兼容性 | `{{}}` 与 MD/YAML/Mermaid 无冲突 | `<% %>` 无冲突但与 HTML 混淆 | Handlebars ✓ |
| 非开发者可维护性 | `{{#if}}` / `{{#each}}` 直观 | JS 语法（箭头函数、分号）门槛高 | **Handlebars ✓✓** |
| Partial 继承 | 自动继承父上下文，Block Partial 支持 | 需显式传递数据 | Handlebars ✓ |
| 复杂逻辑 | 需自定义 Helper（集中管理） | 内联 JS（分散在模板中） | 各有优势 |
| 性能（200 文件） | ~150-300ms（预编译后） | ~100-200ms | EJS 略快但均可忽略 |
| 渲染占总管线时间 | < 5% | < 5% | **无差异** |

**关键优势**：
1. **模板可维护性**：9 段式 Spec 结构需要非开发者也能编辑模板格式
2. **关注点分离**：业务逻辑在 Helper 中，展示在模板中，互不耦合
3. **一致性保障**：Helper 驱动的逻辑确保 200+ Spec 遵循同一格式

### Template Architecture

```
templates/
├── module-spec.hbs           # 主 9 段式模板
├── index-spec.hbs            # 架构索引模板
├── drift-report.hbs          # 漂移报告模板
└── partials/
    ├── yaml-frontmatter.hbs
    ├── mermaid-diagram.hbs
    └── code-signature.hbs
```

### Custom Helpers

需实现的核心 Helper：
- `formatSignature` — TypeScript 签名 Markdown 转义
- `mermaidClass` — 从 exports 生成 Mermaid 类图
- `specLink` — 文件路径转 Spec 链接
- `hasContent` — 智能判空（string/array/object）
- `compare` — 比较操作符（>, <, ===）

### Alternatives Considered

- **EJS**: Rejected — 非开发者可维护性差，模板中散落 JS 代码
- **Mustache**: Rejected — 无 Helper 系统，逻辑表达力不足
- **Nunjucks**: Rejected — API 更重，社区活跃度不如 Handlebars

---

## R4: 敏感信息检测与脱敏

### Decision

**自建轻量级扫描器**（正则匹配 + Shannon 熵检测 + 语义占位符脱敏）。

### Rationale

- 现有 npm 包要么过重（gitleaks → Go, truffleHog → Python）要么维护不足（detect-secrets-js）
- 自建方案提供：完全性能控制、无膨胀依赖、定制化误报过滤、与代码库无缝集成
- 运行时扫描目标：典型源文件（< 100KB）< 10ms

### Pattern Categories (High Confidence)

| 类别 | 模式示例 | 置信度 |
|------|---------|--------|
| AWS Keys | `AKIA[0-9A-Z]{16}` | High |
| GCP API Keys | `AIza[0-9A-Za-z-_]{35}` | High |
| JWT Tokens | `eyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_.+/=]+` | High |
| Private Keys | `-----BEGIN (RSA\|EC\|PGP) PRIVATE KEY-----` | High |
| 数据库连接串 | `(postgres\|mysql\|mongodb)://[^:]+:[^@]+@` | Medium |
| Generic API Keys | `(api[_-]?key\|secret\|token).*=.*['\"][A-Za-z0-9]{20,}` | Medium |

### Redaction Strategy

采用**语义占位符**方案 — 最适合 LLM 上下文理解：

```typescript
// Before
const AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE";
// After
const AWS_ACCESS_KEY_ID = "[REDACTED_AWS_ACCESS_KEY_ID]";
```

**优势**：
- 保留变量名（LLM 理解意图）
- 保持代码结构（语法有效）
- 语义明确（LLM 知道缺失内容类型）

### False Positive Management

三层过滤：
1. **上下文感知**：检测是否在测试文件、示例代码、变量引用中
2. **熵分析**：Shannon 熵 < 3.5 判定为假阳性（太可预测）
3. **占位符检测**：匹配 `your-key-here`、`example`、`test` 等常见占位符

### 置信度策略

| 置信度 | 动作 | 说明 |
|--------|------|------|
| High | 强制脱敏 + 通知 | 阻止传输 |
| Medium | 脱敏 + 警告 | 允许但标记 |
| Low | 仅标记 | 不脱敏 |

### Alternatives Considered

- **@secretlint/secretlint-rule-preset-recommend**: Considered — 模块化规则系统，但增加 ~500KB 依赖
- **gitleaks patterns 引用**: Adopted — 作为正则模式参考来源（不引入包本身）
- **GitHub Secret Scanning patterns**: Adopted — 作为模式验证参考

---

## R5: Token 计数与上下文预算管理

### Decision

**两阶段计数**策略 + 哈希缓存 + 优先级截断。

### Rationale

- 快速估算用于初筛 500 文件（< 10ms），精确计数仅用于最终选定内容
- 缓存可将重复计数开销降低 80-90%
- 优先级截断保证核心信息（Skeleton）不丢失

### Token Estimation Tiers

| 方法 | 速度 | 精度 | 用途 |
|------|------|------|------|
| 字符估算 (len / 3.8) | ~0.01ms | ±15% | 批量初筛 |
| 词基估算 (words × 1.5) | ~0.1ms | ±10% | 中间验证 |
| 精确 tokenizer | ~1-5ms | ±0% | 最终组装 |

### CJK 处理

- 中文字符：~2.5 chars/token（每个汉字约消耗 1-2 token）
- 英文代码：~3.8 chars/token
- 混合内容需 hybrid 估算：

```typescript
const hasCJK = /[\u4e00-\u9fa5\u3040-\u309f\u30a0-\u30ff]/.test(text);
const charsPerToken = hasCJK ? 2.5 : 3.8;
return Math.ceil(text.length / charsPerToken);
```

### 截断优先级（从先截到后截）

1. **Code Snippets** — 最先截断，最丰富，可采样
2. **Dependency Data** — 其次，可压缩为仅直接依赖
3. **CodeSkeleton** — 最后截断（必要部分），是 LLM 理解模块结构的基础

### Budget Allocation (100k Token)

| 组件 | 预算占比 | 上限 |
|------|---------|------|
| 系统提示 + 模板指令 | 5% | 5k |
| CodeSkeleton | 30% | 30k |
| 依赖 Spec 摘要 | 25% | 25k |
| 核心代码片段 | 35% | 35k |
| 安全缓冲 | 5% | 5k |

### 性能预期

- **500 文件快速估算**: ~5-10ms
- **500 文件精确计数**: ~500-2500ms
- **500 文件缓存命中 90%**: ~50-250ms

### Token 优化技巧

- 移除多余空行（保留最多 1 行）
- 标准化缩进（tab → 2 spaces）
- 移除行尾空白
- 注释在非必要时可移除（节省 10-30%）

### Alternatives Considered

- **@anthropic-ai/tokenizer**: Primary choice — 官方包（如可用）
- **tiktoken (cl100k_base)**: Fallback — 与 Claude 精度 ±5-10%
- **纯字符估算**: Rejected as sole method — ±15% 精度不足以控制预算
- **API 实时计数 (usage 字段)**: Adopted — 用于校准本地估算模型

---

## Open Questions (None)

所有 NEEDS CLARIFICATION 已在 Clarify 阶段和本 Research 阶段解决。无遗留问题。
