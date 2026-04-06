---
feature: "092-config-ux-and-cross-feature-guard"
type: data-model
created: 2026-04-06
status: Draft
---

# Feature 092: 数据模型

## 1. specDriverConfigSchema -- 完整 Zod Schema 定义

以下为 `plugins/spec-driver/scripts/lib/config-schema.mjs` 中将实现的完整 Schema。覆盖现有 `spec-driver.config.yaml` 的所有字段，以及新增的 `verification.timeout` 字段。

### 1.1 Schema 定义（伪代码，对应 Zod API）

```javascript
import { z } from 'zod';

// ────────────────────────────────────────
// 子 Schema
// ────────────────────────────────────────

const modelNameSchema = z.enum(['opus', 'sonnet', 'haiku'])
  .or(z.string().min(1));  // 允许原生模型名（如 gpt-5.4）

const agentOverrideSchema = z.object({
  model: modelNameSchema.optional(),
}).strict();

const agentsSchema = z.record(
  z.string(),              // agent id: product-research, tech-research, specify, ...
  agentOverrideSchema,
).optional();

const aliasMapSchema = z.record(z.string(), z.string());

const modelCompatSchema = z.object({
  runtime: z.enum(['auto', 'claude', 'codex']).default('auto'),
  aliases: z.object({
    codex: aliasMapSchema.optional(),
    claude: aliasMapSchema.optional(),
  }).optional(),
  defaults: z.object({
    codex: z.string().optional(),
    claude: z.string().optional(),
  }).optional(),
}).optional();

const codexSchema = z.object({
  service_tier: z.enum(['fast', 'standard', 'flex']).default('fast'),
}).optional();

const codexThinkingSchema = z.object({
  default_level: z.enum(['low', 'medium', 'high', 'xhigh']).default('xhigh'),
  level_map: z.record(z.string(), z.enum(['low', 'medium', 'high', 'xhigh'])).optional(),
}).optional();

const researchSchema = z.object({
  default_mode: z.enum([
    'auto', 'full', 'tech-only', 'product-only',
    'codebase-scan', 'skip', 'custom',
  ]).default('auto'),
  custom_steps: z.array(z.string()).default([]),
}).optional();

const verificationSchema = z.object({
  commands: z.record(z.string(), z.record(z.string(), z.string())).default({}),
  monorepo: z.object({
    enabled: z.boolean().default(true),
  }).optional(),
  timeout: z.number().int().positive()
    .default(300)
    .optional(),
    // 新增字段：验证命令超时（秒），默认 300
}).optional();

const gatePauseSchema = z.object({
  pause: z.enum(['always', 'auto', 'on_failure']),
});

const gatesSchema = z.record(z.string(), gatePauseSchema).optional();

const qualityGatesSchema = z.object({
  auto_continue_on_warning: z.boolean().default(true),
  pause_on_critical: z.boolean().default(true),
}).optional();

const retrySchema = z.object({
  max_attempts: z.number().int().min(0).max(10).default(2),
}).optional();

const progressSchema = z.object({
  show_stage_progress: z.boolean().default(true),
  show_stage_summary: z.boolean().default(true),
}).optional();

// ────────────────────────────────────────
// 顶层 Schema
// ────────────────────────────────────────

export const specDriverConfigSchema = z.object({
  preset: z.enum(['balanced', 'quality-first', 'cost-efficient'])
    .default('balanced'),
  agents: agentsSchema,
  model_compat: modelCompatSchema,
  codex: codexSchema,
  codex_thinking: codexThinkingSchema,
  research: researchSchema,
  verification: verificationSchema,
  quality_gates: qualityGatesSchema,
  gate_policy: z.enum(['strict', 'balanced', 'autonomous'])
    .default('balanced'),
  gates: gatesSchema,
  retry: retrySchema,
  progress: progressSchema,
}).strict();
// .strict() 确保未知字段被检测并报告
```

### 1.2 字段清单

| 字段路径 | 类型 | 默认值 | 必填 | 说明 |
|---------|------|--------|------|------|
| `preset` | enum | `'balanced'` | 否 | 模型预设 |
| `agents` | Record | `{}` | 否 | 子代理模型覆盖 |
| `agents.{id}.model` | string/enum | - | 否 | Agent 级模型名 |
| `model_compat` | object | - | 否 | 运行时兼容配置 |
| `model_compat.runtime` | enum | `'auto'` | 否 | 运行时标识 |
| `model_compat.aliases.codex` | Record | - | 否 | Claude→Codex 映射 |
| `model_compat.aliases.claude` | Record | - | 否 | Codex→Claude 映射 |
| `model_compat.defaults.codex` | string | - | 否 | Codex 默认模型 |
| `model_compat.defaults.claude` | string | - | 否 | Claude 默认模型 |
| `codex` | object | - | 否 | Codex 运行时配置 |
| `codex.service_tier` | enum | `'fast'` | 否 | 服务层级 |
| `codex_thinking` | object | - | 否 | Codex 思考等级 |
| `codex_thinking.default_level` | enum | `'xhigh'` | 否 | 默认思考等级 |
| `codex_thinking.level_map` | Record | - | 否 | 语义模型→思考等级 |
| `research` | object | - | 否 | 调研阶段配置 |
| `research.default_mode` | enum | `'auto'` | 否 | 默认调研模式 |
| `research.custom_steps` | string[] | `[]` | 否 | 自定义调研步骤 |
| `verification` | object | - | 否 | 验证阶段配置 |
| `verification.commands` | Record | `{}` | 否 | 自定义验证命令 |
| `verification.monorepo.enabled` | boolean | `true` | 否 | Monorepo 检测 |
| **`verification.timeout`** | **int (positive)** | **`300`** | **否** | **验证命令超时（秒）[新增]** |
| `quality_gates` | object | - | 否 | 质量门配置 |
| `quality_gates.auto_continue_on_warning` | boolean | `true` | 否 | WARNING 时自动继续 |
| `quality_gates.pause_on_critical` | boolean | `true` | 否 | CRITICAL 时暂停 |
| `gate_policy` | enum | `'balanced'` | 否 | 门禁策略 |
| `gates` | Record | - | 否 | 门禁级配置（高级） |
| `gates.{GATE_ID}.pause` | enum | - | 否 | 单门禁暂停策略 |
| `retry` | object | - | 否 | 重试策略 |
| `retry.max_attempts` | int | `2` | 否 | 最大重试次数 |
| `progress` | object | - | 否 | 进度输出 |
| `progress.show_stage_progress` | boolean | `true` | 否 | 显示阶段进度 |
| `progress.show_stage_summary` | boolean | `true` | 否 | 显示阶段摘要 |

---

## 2. effective config 输出格式定义

### 2.1 EffectiveConfigEntry 数据结构

```typescript
interface EffectiveConfigEntry {
  /** 配置项的点分路径，如 "preset"、"verification.timeout" */
  key: string;

  /** 最终生效值 */
  value: string | number | boolean;

  /** 来源层级标识 */
  source: EffectiveConfigSource;
}

type EffectiveConfigSource =
  | 'config.yaml'           // 用户在 config.yaml 中显式设置
  | 'config.yaml agents'    // config.yaml 中 agents.{id} 覆盖
  | '--preset 命令行参数'     // 命令行 --preset 覆盖
  | 'preset 默认值'          // preset 对应的默认值表
  | '内置默认';              // 编排器内置的最终兜底值
```

### 2.2 输出格式（ASCII 表格）

```
[Effective Config]
┌─────────────────────────┬──────────────────┬────────────────────┐
│ 配置项                   │ 生效值            │ 来源               │
├─────────────────────────┼──────────────────┼────────────────────┤
│ preset                   │ quality-first    │ config.yaml        │
│ gate_policy              │ balanced         │ config.yaml        │
│ research.default_mode    │ auto             │ config.yaml        │
│ verification.timeout     │ 300              │ 内置默认           │
│ retry.max_attempts       │ 2                │ 内置默认           │
│ agents.specify.model     │ opus             │ config.yaml agents │
│ agents.implement.model   │ opus             │ config.yaml agents │
│ ...                      │ ...              │ ...                │
└─────────────────────────┴──────────────────┴────────────────────┘
```

### 2.3 BUILTIN_DEFAULTS 常量

```javascript
export const BUILTIN_DEFAULTS = {
  preset: 'balanced',
  gate_policy: 'balanced',
  'research.default_mode': 'auto',
  'research.custom_steps': [],
  'verification.timeout': 300,
  'verification.monorepo.enabled': true,
  'quality_gates.auto_continue_on_warning': true,
  'quality_gates.pause_on_critical': true,
  'retry.max_attempts': 2,
  'progress.show_stage_progress': true,
  'progress.show_stage_summary': true,
  'model_compat.runtime': 'auto',
  'codex.service_tier': 'fast',
  'codex_thinking.default_level': 'xhigh',
};
```

### 2.4 PRESET_DEFAULTS 常量

```javascript
export const PRESET_DEFAULTS = {
  'balanced': {
    'agents.product-research.model': 'opus',
    'agents.tech-research.model': 'opus',
    'agents.specify.model': 'opus',
    'agents.plan.model': 'opus',
    'agents.analyze.model': 'opus',
    'agents.clarify.model': 'sonnet',
    'agents.checklist.model': 'sonnet',
    'agents.tasks.model': 'sonnet',
    'agents.implement.model': 'sonnet',
    'agents.verify.model': 'sonnet',
  },
  'quality-first': {
    'agents.product-research.model': 'opus',
    'agents.tech-research.model': 'opus',
    'agents.specify.model': 'opus',
    'agents.plan.model': 'opus',
    'agents.analyze.model': 'opus',
    'agents.clarify.model': 'opus',
    'agents.checklist.model': 'opus',
    'agents.tasks.model': 'opus',
    'agents.implement.model': 'opus',
    'agents.verify.model': 'opus',
  },
  'cost-efficient': {
    'agents.product-research.model': 'sonnet',
    'agents.tech-research.model': 'sonnet',
    'agents.specify.model': 'sonnet',
    'agents.plan.model': 'sonnet',
    'agents.analyze.model': 'sonnet',
    'agents.clarify.model': 'sonnet',
    'agents.checklist.model': 'sonnet',
    'agents.tasks.model': 'sonnet',
    'agents.implement.model': 'sonnet',
    'agents.verify.model': 'sonnet',
  },
};
```

---

## 3. OVERLAP_WARNING 数据结构

### 3.1 概念模型

```typescript
interface OverlapWarning {
  /** 发出警告的当前 Feature 编号 */
  currentFeature: string;

  /** 冲突对象列表 */
  overlaps: OverlapEntry[];
}

interface OverlapEntry {
  /** 冲突的近期 Feature 编号 */
  featureId: string;

  /** 重叠的文件路径列表 */
  files: string[];

  /** 严重性分级 */
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
}
```

### 3.2 严重性分级规则

| 条件 | 级别 | 说明 |
|------|------|------|
| 3+ 文件重叠 | HIGH | 高冲突风险，建议协调实现顺序 |
| 1-2 文件重叠 | MEDIUM | 中等风险，实现时关注冲突文件 |
| 仅测试文件重叠 | LOW | 低风险，测试文件通常可并行改动 |

### 3.3 排除文件列表

```javascript
export const COMMON_CONFIG_FILES = new Set([
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.build.json',
  '.eslintrc.json',
  '.prettierrc',
  'spec-driver.config.yaml',
  '.gitignore',
  'AGENTS.md',
  'CLAUDE.md',
]);
```

### 3.4 输出格式（analyze Agent Pass G）

```
Pass G: 跨 Feature 文件冲突检测

OVERLAP_WARNING — 检测到 {N} 个 Feature 存在文件重叠

| Feature | 重叠文件 | 严重性 |
|---------|---------|--------|
| 090-xxx | src/foo.ts, plugins/bar/baz.mjs | HIGH |
| 089-yyy | scripts/lib/util.mjs | MEDIUM |

建议: 与 Feature 090 协调实现顺序，优先合并变更量小的一方。
```

若无重叠：

```
Pass G: CLEAN — 当前 Feature 与近 5 个活跃 Feature 无文件重叠
```

---

## 4. SKILL.md frontmatter 目标状态表

以下为 8 个 SKILL.md 的 frontmatter 目标状态。`allowed-tools` 的值依据每个 Skill 的实际工具使用情况确定；`model` 和 `effort` 依据各 Skill 的职责复杂度确定。

| SKILL.md | name | description | disable-model-invocation | allowed-tools | model | effort |
|----------|------|-------------|-------------------------|---------------|-------|--------|
| spec-driver-feature | spec-driver-feature | "执行 Spec-Driven Development 完整研发流程..." | true | [Read, Write, Edit, Bash, Glob, Grep, Task] | opus | high |
| spec-driver-story | spec-driver-story | "快速需求实现 — 跳过调研..." | true | [Read, Write, Edit, Bash, Glob, Grep, Task] | opus | high |
| spec-driver-implement | spec-driver-implement | "成熟 Spec 实施 — 聚焦计划审查..." | true | [Read, Write, Edit, Bash, Glob, Grep, Task] | opus | high |
| spec-driver-fix | spec-driver-fix | "快速问题修复 — 4 阶段完成..." | true | [Read, Write, Edit, Bash, Glob, Grep, Task] | sonnet | medium |
| spec-driver-resume | spec-driver-resume | "恢复中断的 Spec-driver 研发流程..." | true | [Read, Write, Edit, Bash, Glob, Grep, Task] | sonnet | medium |
| spec-driver-sync | spec-driver-sync | "聚合功能规范为产品级活文档与 doc 上游事实源..." | false | [Read, Write, Glob, Bash] | sonnet | medium |
| spec-driver-doc | spec-driver-doc | "生成 README 等开源标准文档..." | false | [Read, Write, Glob, Bash] | sonnet | medium |
| spec-driver-constitution | spec-driver-constitution | "创建或更新项目宪法..." | false | [Read, Write, Edit, Glob, Bash] | sonnet | low |

### frontmatter 赋值依据

**allowed-tools**：

- 编排器 Skill（feature/story/implement/fix/resume）需要 Task tool 委派子代理，且需要读写编辑文件和执行 Bash 命令
- sync Skill 需要 Read/Write/Glob 读写 spec 文件和映射文件，Bash 用于 mkdir
- doc Skill 需要 Read/Write/Glob 读写文档，Bash 用于检测项目结构
- constitution Skill 需要 Read/Write/Edit 维护宪法文件，Glob 搜索模板

**model**：

- 编排器 Skill（feature/story/implement）为高复杂度编排任务，使用 opus
- fix/resume 为中等复杂度恢复/修复任务，使用 sonnet
- sync/doc/constitution 为文档聚合或元数据维护任务，使用 sonnet

**effort**：

- feature/story/implement 涉及完整/部分研发流程编排，effort = high
- fix/resume/sync/doc 为目标明确的单阶段任务，effort = medium
- constitution 为简单元数据维护，effort = low

---

## 5. 诊断信息格式

### 5.1 Schema 校验诊断

```typescript
interface ConfigDiagnostic {
  level: 'error' | 'warning';
  code: string;
  message: string;
  path?: string;      // Zod 错误路径，如 "verification.timeout"
  suggestion?: string; // 修复建议
}
```

### 5.2 诊断代码表

| code | level | 触发条件 | message 模板 |
|------|-------|---------|-------------|
| `config.yaml-syntax-error` | error | YAML 解析失败 | "YAML 语法错误: {parser_error}" |
| `config.empty-file` | error | 文件为空（0 字节） | "配置文件为空，请参考模板填写" |
| `config.unknown-field` | error | Zod strict 检测到未知字段 | "未知字段 `{field}`，你是否想写 `{suggestion}`?" |
| `config.invalid-type` | error | 字段类型不匹配 | "`{path}` 期望 {expected}，实际为 {actual}" |
| `config.invalid-enum` | error | enum 值非法 | "`{path}` 值 `{value}` 不合法，合法值: {options}" |
| `config.invalid-positive-int` | error | 正整数字段为非正数 | "`{path}` 必须为正整数，当前值: {value}" |
| `config.timeout-too-large` | warning | timeout > 3600 | "`verification.timeout` 值 {value} 偏大（超过 1 小时），确认是否有意为之" |

### 5.3 createCheck 输出格式

```javascript
// 校验通过
createCheck('config-schema', '配置文件 Schema 校验', 'pass', {
  configPath: 'spec-driver.config.yaml',
  fieldCount: 12,
});

// 校验失败
createCheck('config-schema', '配置文件 Schema 校验', 'fail', {
  configPath: 'spec-driver.config.yaml',
  errorCount: 2,
  diagnostics: [
    { code: 'config.unknown-field', message: '未知字段 `pereset`，你是否想写 `preset`?' },
    { code: 'config.invalid-positive-int', message: '`verification.timeout` 必须为正整数，当前值: -1' },
  ],
});

// 校验 WARNING（有警告但可继续）
createCheck('config-schema', '配置文件 Schema 校验', 'warn', {
  configPath: 'spec-driver.config.yaml',
  warningCount: 1,
  diagnostics: [
    { code: 'config.timeout-too-large', message: '`verification.timeout` 值 86400 偏大（超过 1 小时）' },
  ],
});
```

---

## 6. 未知字段相似度匹配

为实现"你是否想写 `preset`?"的修复建议功能，`config-schema.mjs` 导出一个简单的编辑距离匹配函数：

```javascript
/**
 * 对未知字段名在已知字段列表中找最近匹配
 * @param {string} unknown - 用户输入的未知字段名
 * @param {string[]} knownFields - Schema 定义的合法字段名列表
 * @returns {string|null} - 最近匹配或 null
 */
export function suggestField(unknown, knownFields) {
  // 使用 Levenshtein 距离，阈值 <= 3
  // 返回距离最小的字段名，或 null
}
```

该函数约 20 行，不引入外部依赖（手写简单 Levenshtein）。
