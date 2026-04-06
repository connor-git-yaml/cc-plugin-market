---
feature: "092-config-ux-and-cross-feature-guard"
type: tech-research
date: 2026-04-06
research_mode: tech-only
---

# 技术调研报告

## 1. 技术调研核心问题

本 Feature 涉及 6 项改进，调研需回答以下核心问题：

1. **配置 Schema 校验**：如何在不引入新 YAML 解析库的前提下，对 `spec-driver.config.yaml` 执行结构校验？项目已有 Zod 和手写 YAML 解析器，二者如何协同？
2. **effective config 展示**：如何在编排器初始化时输出合并后的最终生效配置，并标注每项值的来源层级？业界有哪些参考模式？
3. **跨 Feature 冲突检测**：如何以最小成本在 analyze Agent 中增加跨 Feature 文件重叠检测？检测粒度和误报率如何控制？
4. **验证命令超时保护**：在纯 Prompt 编排体系中，"超时"语义如何传递给 verify Agent 和 Bash 执行？
5. **sync 文档矛盾检测**：sync.md 当前无矛盾检测能力，087 遗留的术语一致性检查如何以最小侵入方式补全？
6. **Skill frontmatter 增强**：8 个 SKILL.md 需补齐 `allowed-tools` / `model` / `effort`，如何确保与 090 并行开发时不产生冲突？

---

## 2. 架构方案选型

### 2.1 配置 Schema 校验方案

#### 现状分析

- **`simple-yaml.mjs`**（255 行）：手写轻量解析器，支持 mapping、sequence、标量、注释剥离。导出 `parseYamlDocument()` 和 `stringifyYaml()`。无任何 Schema 校验能力。
- **`check_config()`**（`init-project.sh` L202-210）：当前仅检查 `$CONFIG_FILE` 或 `$ALT_CONFIG_FILE` 是否存在，不读取内容、不做结构校验。
- **项目已有 Zod**（`package.json` → `"zod": "^3.24.1"`）：`project-profile-schema.mjs` 已用 Zod 定义 `resolvedProjectProfileSchema`，`project-profile-resolver.mjs` 已有成熟的 `safeParse → diagnostics → fallback` 模式。

#### 方案对比

| 方案 | 描述 | 优势 | 劣势 | 推荐度 |
|------|------|------|------|--------|
| **A. Zod Schema + simple-yaml** | 用 `parseYamlDocument()` 解析 YAML，再用 Zod Schema 校验结构 | 复用两个已有组件；Zod 错误信息可读性好；与 `project-profile-resolver.mjs` 的模式完全一致 | 无 | **推荐** |
| B. 手写结构校验 | 在 `init-project.sh` 内用 Bash 逐字段 grep | 零新增依赖 | 脆弱、难维护、无法报告精确错误位置；无 nested object 校验能力 | 不推荐 |
| C. 引入 ajv + JSON Schema | 将 YAML 转 JSON 后用 ajv 校验 | 业界标准 | 新增 npm 依赖（违反 YAGNI），JSON Schema 比 Zod 冗长，项目已有 Zod | 不推荐 |

**推荐方案**：方案 A — 新增 `scripts/lib/config-schema.mjs`，定义 `specDriverConfigSchema`（Zod），导出 `validateConfig(parsedYaml)` 函数。`init-project.sh` 在 `check_config()` 通过后调用 `node "$PLUGIN_DIR/scripts/validate-config.mjs" --project-root .` 执行 Schema 校验。

**实现模式参考**（来自项目自身）：
```
project-profile-resolver.mjs L612-618:
const parsedProfile = resolvedProjectProfileSchema.safeParse(normalized);
if (!parsedProfile.success) {
  diagnostics.push(createDiagnostic('warning', 'project-context.schema-fallback', ...));
}
```

该模式完美适用：解析 → safeParse → 诊断信息 → 安全回退。

### 2.2 effective config 展示方案

#### 业界参考

| 工具 | 机制 | 启示 |
|------|------|------|
| Git `git config --show-origin` | 每行值旁标注来源文件路径（system/global/local） | **来源标注**是关键体验 |
| ESLint `--print-config` | 输出合并后的完整 JSON 配置 | 合并后全景输出；但无来源标注 |
| Webpack `--stats` | 输出构建统计和配置片段 | 太重，不适合轻量场景 |
| cosmiconfig | 搜索并合并多层配置源 | 多层搜索路径的优先级模型 |

#### 当前配置优先级链

```
1. --preset 命令行参数       （最高优先级）
2. agents.{agent_id}.model   （config.yaml 逐 Agent 覆盖）
3. preset 默认值表            （config.yaml preset 字段）
4. 编排器内置默认值           （最低优先级）
```

#### 推荐方案

在编排器初始化阶段（Phase 3 配置加载后）输出 effective config 表格，格式：

```
[Effective Config]
┌─────────────────────────┬─────────────┬────────────────────┐
│ 配置项                   │ 生效值       │ 来源               │
├─────────────────────────┼─────────────┼────────────────────┤
│ preset                   │ quality-first│ config.yaml        │
│ agents.specify.model     │ opus         │ config.yaml agents │
│ gate_policy              │ balanced     │ config.yaml        │
│ verification.timeout     │ 300          │ 内置默认           │
│ research.default_mode    │ auto         │ config.yaml        │
└─────────────────────────┴─────────────┴────────────────────┘
```

**实现方式**：纯 Prompt 逻辑，在编排器 SKILL.md 的 Phase 3 末尾追加指示。不需要新增脚本。编排器读取配置后，按字段逐项标注来源层级，输出为文本表格。

**成本评估**：极低——仅在编排器 SKILL.md 中追加约 30 行 Prompt 指令。由于 092 约定只改 frontmatter 不改 body（090 负责 body），此项需在 SKILL.md 的编排指令区域追加，需与 090 协调。

**替代方案**：若不想改 SKILL.md body，可将 effective config 展示逻辑放入 `validate-config.mjs` 脚本中，`init-project.sh` 调用后输出。这样完全绕开 SKILL.md body 的修改约束。

### 2.3 跨 Feature 冲突检测方案

#### 业界参考

| 工具/实践 | 机制 | 适用性 |
|-----------|------|--------|
| GitHub Merge Queue | 按合并顺序运行 CI，发现冲突时排队 | 面向 Git 合并冲突，非 Spec 级 |
| Graphite Stack Detection | 检测分支依赖链中的文件重叠 | 思路可借鉴：文件路径集合交集 |
| Trunk-based Conflict Prediction | 预测性冲突检测（文件热力图） | 过于复杂 |
| **Monorepo affected-files 分析** | 从 tasks/PR 提取变更文件集，做交集 | **最适合本场景** |

#### 推荐方案

在 analyze.md（一致性分析子代理）中新增 **Pass G: 跨 Feature 文件冲突检测**：

```text
Pass G: 跨 Feature 冲突检测
1. 从当前 Feature 的 tasks.md 提取所有 [P] 标记的文件路径引用
2. 扫描 specs/ 下最近 5 个 Feature 目录（按编号倒序）的 tasks.md
3. 提取每个 Feature 的文件路径集合
4. 做交集：当前 Feature ∩ 每个近期 Feature
5. 交集非空 → 输出 OVERLAP_WARNING（包含重叠文件列表和对应 Feature 编号）
6. 严重性：
   - 3+ 文件重叠 → HIGH
   - 1-2 文件重叠 → MEDIUM
   - 仅测试文件重叠 → LOW
```

**成本评估**：低——analyze.md 已有 6 个 Pass（A-F），追加 Pass G 约增加 30 行 Prompt。所有操作在 Agent 的 Read/Glob 权限内完成，无需新增脚本。

**误报控制**：
- 排除通用配置文件（`package.json`、`tsconfig.json`、`spec-driver.config.yaml`）
- 仅检测 `src/`、`plugins/`、`scripts/` 下的文件
- 已合并到 master 的 Feature 不参与比较（通过 tasks.md 中的 checkbox 状态判断）

---

## 3. 依赖库评估

| 库 | 当前状态 | 092 中角色 | 需新增？ |
|----|---------|-----------|---------|
| **Zod** (`^3.24.1`) | 已安装，`project-profile-schema.mjs` 使用中 | 配置 Schema 定义和校验 | 否（复用） |
| **simple-yaml.mjs** | 项目自有（255 行手写） | YAML 解析输入 | 否（复用） |
| **node:fs / node:path** | Node.js 内置 | 文件读写和路径操作 | 否 |
| **node:child_process** | Node.js 内置 | init-project.sh 调用 Node 脚本 | 否 |

**结论**：092 不需要引入任何新的外部依赖。全部实现基于 Zod + simple-yaml.mjs + Node.js 内置模块。

---

## 4. 设计模式调研

### 4.1 配置校验模式：Parse-Validate-Diagnose-Fallback

项目已有成熟模式（`project-profile-resolver.mjs`）：

```
parseYamlDocument(content)     → 原始对象
normalizeYamlInput(raw, ...)   → 结构化归一化
schema.safeParse(normalized)   → Zod 校验
  成功 → 使用校验后数据
  失败 → diagnostics[] + 安全回退值
```

092 的 config 校验完全复用此模式，仅需定义新的 Zod Schema（`specDriverConfigSchema`）。

### 4.2 检查结果模式：createCheck()

项目已有标准化检查结果模式（`repo-maintenance-core.mjs` L17-19 和 `runtime-boundary-core.mjs` L5-7）：

```javascript
function createCheck(id, title, status, evidence = {}) {
  return { id, title, status, evidence };
}
```

`status` 值域：`'pass' | 'warn' | 'fail'`

092 的 config 校验脚本应采用相同模式，输出可被 `repo:check` 链路消费的标准化检查结果。

### 4.3 Agent Prompt 扩展模式：追加 Pass

analyze.md 已有 6 个 Pass（A-F），每个 Pass 是一段独立的检测逻辑块。追加 Pass G 遵循相同结构：

```markdown
7. **检测 Pass G: 跨 Feature 文件冲突检测**
   - 扫描近 5 个 Feature 的 tasks.md
   - 提取文件路径引用集合
   - 交集检测 → OVERLAP_WARNING
```

### 4.4 frontmatter 声明模式

Claude Code SKILL.md frontmatter 支持的标准字段（基于现有代码库中 agents/*.md 的 frontmatter 实践）：

```yaml
---
name: spec-driver-feature           # 必填
description: "..."                   # 必填
disable-model-invocation: true       # 已有
allowed-tools: [Read, Write, ...]    # 需补齐
model: opus | sonnet | haiku         # 需补齐
effort: low | medium | high          # 需补齐
---
```

注：agents/*.md（如 analyze.md、sync.md、verify.md）已有 `model`、`tools`、`effort` 的 frontmatter 声明，可作为参考。SKILL.md 的 `allowed-tools` 对应 Agent 的 `tools`。

---

## 5. 各改进项最小实现评估

| # | 改进项 | 可用现有工具 | 需新增代码 | 成本/收益评估 | 建议 |
|---|--------|------------|-----------|-------------|------|
| 1 | **配置 Schema 校验前移** | `simple-yaml.mjs`（解析）+ Zod（校验）+ `init-project.sh`（触发点）| 新增 `config-schema.mjs`（~60 行 Schema 定义）+ `validate-config.mjs`（~40 行 CLI 入口）+ `init-project.sh` 追加 ~15 行调用逻辑 | 收益高（配置错误提前发现）；成本低（~115 行新增，全部复用已有模式） | **必须** |
| 2 | **effective config 展示** | 编排器 Prompt 逻辑 或 `validate-config.mjs` 脚本 | 若走脚本方案：在 `validate-config.mjs` 中追加 `--show-effective` 模式（~50 行）；若走 Prompt 方案：SKILL.md 追加 ~30 行 | 收益高（6 层配置优先级透明化）；成本低 | **必须** |
| 3 | **跨 Feature 冲突检测** | analyze.md Agent（已有 Read/Glob 权限） | analyze.md 追加 Pass G（~30 行 Prompt）| 收益中（多 Feature 串行开发时有价值）；成本极低（纯 Prompt 扩展） | **必须** |
| 4 | **验证命令超时保护** | `spec-driver.config.yaml`（配置载体）+ verify.md Agent（消费方） | config-schema 追加 `verification.timeout` 字段定义；verify.md 追加 ~10 行超时指令；SKILL.md 编排器在构建 verify 上下文时传递 timeout 值 | 收益中（防止验证命令挂起）；成本低 | **必须** |
| 5 | **sync 文档矛盾检测** | sync.md Agent（已有 Read/Write/Glob 权限） | sync.md "文档健康度检查"部分（L296-304）已有陈旧检测和术语一致性的框架，需扩充为显式矛盾检测 Pass（~40 行 Prompt 扩展） | 收益中（补全 087 遗留）；成本低（在已有框架上扩展） | **必须** |
| 6 | **Skill frontmatter 增强** | 直接编辑 8 个 SKILL.md | 仅修改 frontmatter 区域（不改 body），每个文件 ~3 行追加 | 收益中（运行时可读取声明做工具白名单和模型选择）；成本极低（~24 行总改动） | **必须** |

### 成本汇总

- **新增 MJS 文件**：2 个（`config-schema.mjs` + `validate-config.mjs`），约 150 行
- **修改 Shell 脚本**：1 个（`init-project.sh`），约 15 行
- **修改 Agent Prompt**：2 个（`analyze.md` + `sync.md`），约 70 行
- **修改 SKILL.md**：8 个（仅 frontmatter），约 24 行
- **修改配置文件**：0 个（`spec-driver.config.yaml` 无需改动，timeout 字段为可选新增）
- **新增依赖**：0 个

**总估计**：~260 行新增/修改代码，零新依赖。

---

## 6. 技术风险清单

| ID | 风险 | 影响 | 缓解措施 |
|----|------|------|---------|
| R1 | `simple-yaml.mjs` 解析能力有限（无多行字符串、锚点/引用支持） | 若用户写出复杂 YAML 语法，解析器可能失败 | config 文件结构简单（flat mapping + nested mapping），当前解析器完全够用；Schema 校验在解析成功后执行，解析失败时输出友好错误而非 Schema 错误 |
| R2 | 跨 Feature 冲突检测依赖 tasks.md 中文件路径引用的格式一致性 | 若 tasks.md 中文件路径格式不统一，检测准确度下降 | 使用宽松正则匹配（支持 `src/xxx.ts`、`plugins/xxx/yyy.mjs` 等常见模式），对无法解析的路径跳过而非报错 |
| R3 | 092 与 090 并行开发时 SKILL.md 冲突 | 090 改 body、092 改 frontmatter，Git 合并时可能产生 header 区域的文本冲突 | 约定 092 仅改 frontmatter（`---` 区域内），090 仅改 body（`---` 区域外）。Frontmatter 改动集中在文件头 5-8 行，与 body 改动物理距离远，Git 三向合并可自动解决 |
| R4 | effective config 展示若放在 SKILL.md body 中，违反"092 不改 body"约定 | 与 090 产生合并冲突 | 采用脚本方案：将 effective config 展示放入 `validate-config.mjs --show-effective`，`init-project.sh` 调用。完全绕开 SKILL.md body |
| R5 | 验证超时在 Prompt 编排中无法强制执行 | LLM 无法真正控制 Bash 进程的超时行为 | verify Agent 的 Prompt 指令中追加"执行验证命令时，附加 `timeout {N}s` 前缀"的明确指示。Bash 的 `timeout` 命令是 coreutils 标准工具，跨平台可用 |
| R6 | sync.md 矛盾检测扩展可能与 091（sync 确定性化）产生冲突 | 091 会大幅瘦身 sync.md，092 在其上追加检测逻辑 | M-088 蓝图已建议 091 在 092 之后执行。092 的矛盾检测追加在"文档健康度检查"部分（sync.md L292-304），091 主要瘦身的是合并算法核心（L38-190），改动位置不同 |

---

## 7. 推荐方案总结

### 总体架构策略

所有 6 项改进均可在现有技术栈内实现，不引入新依赖。核心思路：

1. **配置校验**：复用 `simple-yaml.mjs` + Zod 的 Parse-Validate-Diagnose 模式（参照 `project-profile-resolver.mjs`），新增 `config-schema.mjs` 和 `validate-config.mjs`
2. **effective config**：通过 `validate-config.mjs --show-effective` 脚本输出（避免改 SKILL.md body）
3. **跨 Feature 冲突检测**：在 analyze.md 追加 Pass G（纯 Prompt 扩展）
4. **验证超时**：config Schema 新增 `verification.timeout` 字段 + verify Agent Prompt 追加 `timeout` 命令前缀指示
5. **sync 矛盾检测**：在 sync.md "文档健康度检查"部分扩充矛盾检测 Pass
6. **Skill frontmatter**：8 个 SKILL.md 仅改 frontmatter 区域

### 关键设计决策

| 决策 | 选择 | 理由 |
|------|------|------|
| Schema 校验技术 | Zod（非 ajv/JSON Schema） | 项目已有 Zod；TypeScript 友好；错误信息可读性好 |
| 校验触发点 | init-project.sh → Node 脚本 | 复用已有触发链路；Node 脚本可被 `repo:check` 链路消费 |
| effective config 实现位置 | 独立脚本（非 SKILL.md body） | 避免与 090 的 SKILL.md body 改动冲突 |
| 跨 Feature 检测实现位置 | analyze.md Prompt（非脚本） | Agent 已有 Read/Glob 权限，纯 Prompt 扩展最轻量 |
| 超时实现机制 | Bash `timeout` 命令（非 Node.js 进程管理） | 标准 coreutils 工具，verify Agent 已在 Bash 中执行命令 |
| frontmatter 字段规范 | 参照 agents/*.md 已有的 `model` / `tools` / `effort` | 保持项目内一致性 |

### YAGNI 评估

所有 6 项均为"必须"——它们直接解决 M-083 review 中识别的 P1 遗留问题和 088 蓝图中的明确验收标准。没有任何一项是假设性的未来需求。

### 与并行 Feature 的协调建议

| 092 改动 | 090 改动 | 冲突风险 | 协调方案 |
|----------|----------|---------|---------|
| SKILL.md frontmatter | SKILL.md body | 低 | 物理位置分离（头 5-8 行 vs 第 10 行以后） |
| config.yaml Schema（`verification.timeout`） | config.yaml Schema（`gates.GATE_IMPLEMENT_MID`） | 无 | 不同字段，合并无冲突 |
| sync.md 健康度检查扩展 | 091 sync.md 合并算法瘦身 | 低 | 按蓝图建议：092 先合并，091 后续在其基础上瘦身 |
| analyze.md Pass G | 无 | 无 | 独占改动 |
