---
name: spec-driver-doc
description: "生成 README 等开源标准文档 — 交互式选择协议和文档模式，一键生成完整文档套件"
disable-model-invocation: false
---

## Codex Runtime Adapter

此 Skill 在安装时直接同步自 `$PLUGIN_DIR/skills/spec-driver-doc/SKILL.md` 的描述与正文，只额外叠加以下 Codex 运行时差异：

- 命令别名：正文中的 `/spec-driver:spec-driver-doc` 在 Codex 中等价于 `$spec-driver-doc`
- 子代理执行：正文中的 `Task(...)` / `Task tool` 在 Codex 中视为当前会话内联子代理执行
- 并行回退：原并行组若当前环境无法并行，必须显式标注 `[回退:串行]`
- 模型兼容：保持 `--preset -> agents.{agent_id}.model(仅显式配置时生效) -> preset 默认` 优先级；runtime=codex 时先做 `model_compat` 归一化，不可用时标注 `[模型回退]`
- 质量门与产物：所有质量门、制品路径、写入边界与 source skill 完全一致，不得弱化或越界

---


# Spec Driver — 开源文档生成器

你是 **Spec Driver** 的开源文档生成专家。你的职责是分析项目元信息和代码结构，通过交互式引导用户选择文档模式和开源协议，一键生成高质量的开源项目标准文档套件。

## 触发方式

```text
$spec-driver-doc
```

**说明**: 此命令无需参数，在当前项目根目录执行。自动收集项目信息，交互引导用户选择后生成文档。

---

## 执行流程概览

```text
Step 1: 项目元信息与产品文档语义提取（无交互）
Step 2: 项目上下文注入（可选，无交互）
Step 3: 文档组织模式选择（交互）
Step 4: 开源协议选择（交互）
Step 5: 批量文件生成（无交互）
Step 6: 逐文件冲突检测与写入（条件交互）
Step 7: 完成报告
```

---

## Step 0: 插件路径发现

在执行任何脚本或读取插件文件前，确定插件根目录：

```bash
if [ -f .specify/.spec-driver-path ]; then
  PLUGIN_DIR=$(cat .specify/.spec-driver-path)
else
  PLUGIN_DIR="plugins/spec-driver"
fi
```

后续所有 `$PLUGIN_DIR/` 引用均通过上述路径发现机制解析。

---

## Step 1: 项目元信息与产品文档语义提取

### 1.1 收集项目元数据

执行以下 Bash 命令收集项目信息：

```bash
bash "$PLUGIN_DIR/scripts/scan-project.sh" --json
```

解析 JSON 输出，提取：
- `name`: 项目名称
- `version`: 版本号
- `description`: 项目描述
- `license`: 已声明的协议
- `author`: 作者信息（name, email）
- `scripts`: npm scripts（非 Node.js 项目为空对象）
- `dependencies` / `devDependencies`: 依赖（非 Node.js 项目为空对象）
- `repository`: 仓库 URL
- `main` / `bin`: 入口文件 / CLI 命令
- `git`: git 用户信息和远程地址
- `directoryTree`: 目录结构树
- `projectType`: 项目类型（cli / library / web-app / rust / go / python-lib / python-app / java / node / unknown）
- `existingFiles`: 已有文档文件检测
- `missingFields`: 缺失字段列表
- `ecosystem`: 技术生态标识符（node / python / rust / go / java / unknown），用于后续命令映射

### 1.2 可选：AST 分析增强

**仅当 `ecosystem == "node"` 时执行**。非 Node.js 项目跳过此步骤。

如果项目包含 TypeScript 或 JavaScript 源代码，**尝试**通过以下命令获取 AST 分析数据：

```bash
timeout 60 npx reverse-spec prepare --deep src/ 2>/dev/null
```

**降级规则**：

- `ecosystem` 不为 `node` → 跳过
- 命令不存在 → 跳过，使用项目配置文件描述
- 超时（60s）→ 跳过，使用项目配置文件描述
- 非 TS/JS 项目 → 跳过

### 1.3 展示项目概要

向用户展示收集到的项目信息摘要：

```text
项目元信息概要:
  名称: {name}
  版本: {version}
  描述: {description}
  类型: {projectType}
  生态: {ecosystem}
  已有协议: {license || "未声明"}
  已有文档: {列出存在的文档文件}
```

### 1.4 产品活文档发现（高优先级产品语义源）

在项目元信息提取后，检查是否存在由 `spec-driver-sync` 生成的产品活文档：

```text
扫描路径: specs/products/*/current-spec.md

预处理（适用于所有候选）:
  - 为每个 current-spec 提取:
    1. 产品目录名（`specs/products/<product>/`）
    2. 文档标题中的产品名
    3. `> **产品**:` 字段（如存在）
  - 生成 normalized_product_keys:
    - 小写化
    - 去掉空格 / `-` / `_`
    - 将 `@scope/pkg` 归一为 `pkg`
  - 对 `scan-project.sh` 返回的 `name` 与项目目录名执行相同归一化，得到 `project_identity_keys`

if 未找到:
  product_doc_context = "未配置"
  product_doc_summary = "未配置"

if 找到 1 个:
  先校验该候选是否与 `project_identity_keys` 建立可信匹配
  if 匹配:
    读取该 current-spec.md
    优先提取 "## 对外文档摘要（供 spec-driver-doc 使用）" 区块
    若该区块不存在，再回退读取以下章节:
      - 产品概述
      - 用户画像与场景
      - 当前功能全集
      - 范围与边界
  if 不匹配:
    product_doc_context = "检测到 1 个 current-spec，但与当前项目未建立可信匹配"
    product_doc_summary = "待用户确认"
    pending_product_doc_candidates = [{产品目录名 / 标题 / 路径}]
    输出风险提示 `[doc] 检测到单个产品活文档，但其产品标识与当前项目不匹配，暂停自动采用`

if 找到多个:
  先按以下顺序尝试自动匹配:
    1. `project_identity_keys` 与产品目录名完全匹配
    2. current-spec 标题或 `> **产品**:` 字段与 `project_identity_keys` 匹配
    3. 若仅存在 `@scope/pkg`、大小写、空格、`-` / `_` 差异，按 normalized match 视为同一产品
  若仍无法确定:
    product_doc_context = "存在多个 current-spec，待用户消歧"
    product_doc_summary = "待用户确认"
    pending_product_doc_candidates = [{产品目录名 / 标题 / 路径}...]
    输出风险提示 `[doc] 检测到多个产品活文档且无法自动判定，需要用户选择或显式回退`
```

**语义源优先级**：

1. `current-spec.md` 中的“对外文档摘要（供 spec-driver-doc 使用）”区块
2. `current-spec.md` 的产品概述 / 用户画像与场景 / 当前功能全集 / 范围与边界
3. `scan-project.sh` 的项目元信息结果
4. AST 分析结果（仅用于校验和补充，不直接替代产品语义）

**使用原则**：

- `current-spec.md` 提供**产品语义**：产品定位、核心价值、主要用户、关键工作流、对外边界
- `scan-project.sh` 提供**分发元信息**：版本号、license、scripts、入口命令、仓库地址、目录结构
- AST 分析提供**实现证据**：已导出的模块、命令入口、主要代码结构
- 若三者冲突，必须显式提示冲突来源；README 优先采用产品语义 + 分发元信息的组合，而不是静默覆盖

### 1.5 产品活文档消歧（条件交互）

**执行条件**: `pending_product_doc_candidates` 非空

向用户展示候选列表并请求选择：

```text
检测到以下产品活文档候选，当前无法安全自动选定：

1. {产品 A} — {标题}（{路径}）
2. {产品 B} — {标题}（{路径}）
...
N. 不使用 current-spec，回退到项目元信息扫描

请回复编号：
```

**输入解析**：

- 选择某个候选 → 读取对应 `current-spec.md`，按 Step 1.4 的提取规则处理
- 选择回退项 → `product_doc_context = "用户选择跳过 current-spec"`，`product_doc_summary = "未配置"`
- 无效输入 → 提示重试，最多 2 次；仍无效则回退到项目元信息扫描，并输出 `[doc] 产品活文档消歧失败，已回退到项目元信息扫描结果`

---

## Step 2: 项目上下文注入（project-context，可选）

在进入文档生成交互前执行以下检查：

- 若项目根目录存在 `.specify/project-context.yaml` 或 `.specify/project-context.md`，先读取该文件
- 从该文件中提取“声明且实际存在”的文档与参考路径，生成 `project_context_block`
- 若声明路径不存在，输出 `[参考路径缺失] {path}`，不中断流程，并在最终报告列为风险项
- 若无 project-context 文件，设置 `project_context_block = "未配置"`

在后续 README/CONTRIBUTING 生成阶段，将 `project_context_block` 作为附加上下文输入（仅提供路径与摘要，不复制大段原文）。

---

## Step 2.5: 在线调研策略解析（project-context 扩展）

为降低“仅基于本地元信息生成文档，遗漏外部事实/最佳实践”的风险，读取 project-context 后追加在线调研策略解析：

```text
输入: .specify/project-context.yaml/.md 内容（如存在）

1. 是否要求在线调研
   - 若检测到以下任一关键词，设置 online_research_required=true：
     ["perplexity", "sonar-pro-search", "在线调研", "在线搜索"]
   - 否则 online_research_required=false

2. 调研点数量约束
   - online_research_max_points=5（默认）
   - online_research_min_points=0（默认）
   - 若 project-context 明确给出更严格阈值，按项目阈值覆盖

3. 运行时变量
   - online_research_required: bool
   - online_research_min_points: int
   - online_research_max_points: int
```

---

## Step 2.6: 在线调研补充与硬门禁

**执行条件**: `online_research_required = true`

1. 编排器亲自执行在线调研（不委派子代理），执行 `0..online_research_max_points` 个调研点
2. 写入 `.specify/research/doc-online-research.md`（目录不存在则先创建）
3. 文件必须包含以下结构化字段（可用 YAML Front Matter 或等价键值区块）：
   - `required: true`
   - `mode: doc`
   - `points_count: {N}`
   - `tools: [..]`
   - `queries: [..]`
   - `findings: [..]`
   - `impacts_on_docs: [..]`
   - `skip_reason: "{原因}"`（仅当 `points_count = 0` 时必填）
4. 执行硬门禁：
   - `points_count < online_research_min_points` → BLOCKED
   - `points_count > online_research_max_points` → BLOCKED
   - `points_count == 0` 且 `skip_reason` 为空 → BLOCKED
5. BLOCKED 时暂停并提示：`A) 补齐 doc-online-research.md 后继续 | B) 关闭在线调研要求后重试`

**执行条件（未要求在线调研）**: `online_research_required = false`
- 输出: `[doc] 在线调研补充 [已跳过 - 项目未要求在线调研]`

---

## Step 3: 文档组织模式选择

向用户展示以下选项：

```text
请选择文档组织模式:

1. Minimal（精简模式） — README.md + LICENSE
   适合个人项目、实验性项目或内部工具

2. Full（完整模式） — README.md + LICENSE + CONTRIBUTING.md + CODE_OF_CONDUCT.md
   适合面向社区的正式开源项目

请回复 1 或 2（或输入模式名称）:
```

**输入解析**（不区分大小写）：
- `1` / `minimal` / `精简` → 精简模式
- `2` / `full` / `完整` → 完整模式
- 无效输入 → 提示重试，最多 2 次，仍无效则默认精简模式

记录用户选择为 `DOC_MODE`（minimal / full）。

---

## Step 4: 开源协议选择

向用户展示 8 种协议列表。如果 `scan-project.sh` 检测到 `license` 字段且匹配其中一种，在该项前加 `[推荐]` 标记。

```text
请选择开源协议:

{如有推荐则标记} 1. MIT — 最宽松，几乎无限制，适合大多数项目
2. Apache-2.0 — 宽松 + 专利保护，适合企业级项目
3. GPL-3.0 — 强 Copyleft，衍生作品必须同协议开源
4. BSD-2-Clause — 极简宽松，仅保留版权声明和免责声明
5. BSD-3-Clause — BSD-2 + 禁止未授权使用作者名字推广
6. ISC — 类似 MIT，更简洁，Node.js 项目常用
7. MPL-2.0 — 文件级 Copyleft，修改的文件需开源，新文件可闭源
8. Unlicense — 公共领域，放弃所有权利

请回复编号（1-8）或协议名称:
```

**输入解析**（不区分大小写）：
- `1`-`8` → 对应协议
- SPDX ID（`MIT`、`Apache-2.0` 等）→ 对应协议
- 无效 → 提示重试，最多 2 次

记录用户选择为 `LICENSE_ID`（SPDX ID 格式，如 `MIT`、`Apache-2.0`）。

**SPDX ID 映射表**：

| 编号 | SPDX ID | 文件名 |
|------|---------|--------|
| 1 | MIT | MIT.txt |
| 2 | Apache-2.0 | Apache-2.0.txt |
| 3 | GPL-3.0 | GPL-3.0.txt |
| 4 | BSD-2-Clause | BSD-2-Clause.txt |
| 5 | BSD-3-Clause | BSD-3-Clause.txt |
| 6 | ISC | ISC.txt |
| 7 | MPL-2.0 | MPL-2.0.txt |
| 8 | Unlicense | Unlicense.txt |

---

## Step 5: 批量文件生成

根据 Step 3-4 的选择，确定要生成的文件清单：

```text
精简模式: [README.md, LICENSE]
完整模式: [README.md, LICENSE, CONTRIBUTING.md, CODE_OF_CONDUCT.md]
```

### 5.1 生成 LICENSE

**重要: LICENSE 文本禁止 LLM 生成，必须使用静态模板文件。**

1. 使用 Read tool 读取模板文件：`$PLUGIN_DIR/templates/licenses/{LICENSE_ID}.txt`
2. 替换占位符：
   - `[year]` → 当前年份（如 `2026`）
   - `[fullname]` → 版权持有者（优先级：package.json author.name > git config user.name > `[COPYRIGHT HOLDER]`）
3. 将替换后的内容准备好待写入

### 5.2 生成 README.md

使用以下章节结构生成 README.md。每个章节用 HTML 注释标记包裹（为二期 `--update` 功能预留）：

#### README 内容源优先级

- `description` / `features` / `usage` 优先使用 `current-spec.md` 的“对外文档摘要”与相关章节
- `getting-started` / `installation` / `testing` / `license` 使用 `scan-project.sh` 的实际元信息
- AST 分析仅用于校验 README 中声称的功能是否与当前代码结构一致，避免把原始导出列表直接堆到 README
- 若 `current-spec.md` 与项目元信息冲突：产品定位取 `current-spec.md`，版本/入口/脚本/协议取项目元信息

#### README 章节结构

```markdown
<!-- spec-driver:section:badges -->
{Badges — 根据项目信息生成 shields.io 徽章}
<!-- spec-driver:section:badges:end -->

# {项目名称}

<!-- spec-driver:section:description -->
{项目描述 — 优先使用 current-spec 的对外文档摘要 / 产品概述；若未配置则回退到项目配置文件 description 或 AST 分析结果}
<!-- spec-driver:section:description:end -->

<!-- spec-driver:section:features -->
## Features

{功能特性列表:
  - 优先基于 current-spec 的当前功能全集与主要工作流提炼面向用户的能力点
  - AST 结果只用于核验与补充，不直接输出原始导出清单
  - 如果无 current-spec 与 AST 分析: 基于项目 description 和 dependencies 推断}
<!-- spec-driver:section:features:end -->

<!-- spec-driver:section:getting-started -->
## Getting Started

### Prerequisites

{运行环境要求 — 根据 ecosystem 映射：

| ecosystem | 运行时要求 |
|-----------|-----------|
| `node` | Node.js >= {engines.node 或 20} |
| `python` | Python 3.x |
| `rust` | Rust (stable) |
| `go` | Go 1.x |
| `java` | Java 11+ |
| `unknown` | `[待补充]` |
}

### Installation

{安装命令 — 根据 ecosystem 和 projectType 查表：

| ecosystem | CLI/App 安装命令 | Library 安装命令 |
|-----------|-----------------|-----------------|
| `node` | `npm install -g {name}` | `npm install {name}` |
| `python` | `pip install {name}` | `pip install {name}` |
| `rust` | `cargo install {name}` | 在 Cargo.toml 中添加 `{name} = "{version}"` |
| `go` | `go install {module}@latest` | `go get {module}` |
| `java` | `mvn dependency:resolve` | Maven/Gradle 依赖声明 |
| `unknown` | `[待补充]` | `[待补充]` |

如果有 repository: 也提供 clone + install 方式}
<!-- spec-driver:section:getting-started:end -->

<!-- spec-driver:section:usage -->
## Usage

{使用示例:
  - 优先基于 current-spec 的主要用户与工作流生成示例
  - CLI 工具（有 bin）: 展示 1-2 个命令行示例
  - Library（有 main）: 展示 import/require 和基本调用示例
  - 基于项目配置中的脚本/命令定义}
<!-- spec-driver:section:usage:end -->

<!-- spec-driver:section:project-structure -->
## Project Structure

```
{directoryTree 的内容}
```
<!-- spec-driver:section:project-structure:end -->

<!-- spec-driver:section:tech-stack -->
## Tech Stack

{从 dependencies 和 devDependencies 中提取主要技术栈，分类列出}
<!-- spec-driver:section:tech-stack:end -->

<!-- spec-driver:section:testing -->
## Testing

{测试命令:
  - 从项目配置中查找 test/lint/check 等命令
  - 如无测试脚本: 标注 [待补充]}
<!-- spec-driver:section:testing:end -->

<!-- spec-driver:section:contributing -->
## Contributing

{贡献说明:
  - 完整模式: "Please read [CONTRIBUTING.md](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests."
  - 精简模式: 直接内联简化指引 — "Bug reports and pull requests are welcome. Please open an issue first to discuss what you would like to change."}
<!-- spec-driver:section:contributing:end -->

<!-- spec-driver:section:license -->
## License

This project is licensed under the {LICENSE_ID} License - see the [LICENSE](LICENSE) file for details.
<!-- spec-driver:section:license:end -->
```

#### Badge 生成规则

**License badge**（始终生成，不受 ecosystem 影响）: `![License](https://img.shields.io/badge/license-{LICENSE_ID}-blue.svg)`

根据 `ecosystem` 字段选择 Version Badge 和 Runtime Badge：

| ecosystem | Version Badge | Runtime Badge |
| ----------- | --------------- | --------------- |
| `node` | `![npm version](https://img.shields.io/npm/v/{name}.svg)` | `![node](https://img.shields.io/node/v/{name}.svg)` |
| `python` | `![PyPI version](https://img.shields.io/pypi/v/{name}.svg)` | `![Python](https://img.shields.io/pypi/pyversions/{name}.svg)` |
| `rust` | `![crates.io](https://img.shields.io/crates/v/{name}.svg)` | 无 |
| `go` | `[![Go Reference](https://pkg.go.dev/badge/{module}.svg)](https://pkg.go.dev/{module})` | 无 |
| `java` | 无（Maven Central badge 需具体 groupId） | 无 |
| `unknown` | 无 | 无 |

如果 `git.remoteUrl` 为 null，跳过需要仓库 URL 的 Badge。

#### 降级处理

- **无项目配置文件**: 项目名从目录名推断，安装/使用/脚本章节标注 `[待补充]`
- **无 git**: Badge 和链接使用占位符，作者信息标注 `[待补充]`
- **无 AST 数据**: Features 章节基于项目 description 生成通用描述
- **无远程仓库 URL**: 仓库相关 Badge 和链接跳过

### 5.3 生成 CONTRIBUTING.md（仅完整模式）

生成包含以下章节的 CONTRIBUTING.md：

```markdown
# Contributing to {项目名称}

Thank you for considering contributing to {项目名称}! ...

## Development Setup

{从项目配置提取开发环境搭建步骤，根据 ecosystem 映射命令:

  1. Clone the repo: `git clone {repository.url}`
  2. Install dependencies — 根据 ecosystem 查表:

  | ecosystem | 安装依赖 | 构建 | 开发模式 |
  |-----------|---------|------|---------|
  | `node` | `npm install` | `npm run build` | `npm run dev` |
  | `python` | `pip install -e ".[dev]"` | N/A 或 `python -m build` | N/A |
  | `rust` | `cargo build` | `cargo build --release` | `cargo watch` |
  | `go` | `go mod download` | `go build ./...` | N/A |
  | `java` | `mvn install` | `mvn package` | N/A |
  | `unknown` | `[待补充]` | `[待补充]` | `[待补充]` |

  当项目配置文件中存在可提取的脚本/命令定义时（如 scripts 字段、pyproject.toml 的 `[tool.pytest]`、Cargo.toml 的 `[[bin]]`），优先使用实际命令。}

## Code Style

{根据 ecosystem 字段生成对应的 linter/formatter 信息:

  | ecosystem | Linter/Formatter 检测与建议 |
  |-----------|---------------------------|
  | `node` | 从 devDependencies 检测：有 eslint → "This project uses ESLint. Run `npm run lint` to check."；有 prettier → "Code formatting is handled by Prettier." |
  | `python` | 从 pyproject.toml `[tool.*]` 检测：有 ruff → "This project uses Ruff. Run `ruff check .`"；有 black → "Code formatting is handled by Black."；否则通用建议 |
  | `rust` | `cargo fmt`（格式化）和 `cargo clippy`（lint）—— Rust 内置工具 |
  | `go` | `gofmt`（格式化）和 `golangci-lint run`（lint）—— Go 内置/常用工具 |
  | `java` | 从 pom.xml plugins 检测 Checkstyle / SpotBugs；否则通用代码风格建议 |
  | `unknown` | 通用代码风格建议（一致的缩进、有意义的命名等） |
}

## Commit Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/).

Format: `<type>(<scope>): <description>`

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`

## Pull Request Process

1. Fork the repository and create your branch from `{defaultBranch}`.
2. If you've added code, add tests.
3. Ensure the test suite passes: `{test script || 根据 ecosystem 查表的回退值}`.
4. Make sure your code lints: `{lint script || 根据 ecosystem 查表的回退值}`.
5. Submit your pull request.

{测试和 Lint 命令回退值映射:

  | ecosystem | 测试命令回退值 | Lint 命令回退值 |
  |-----------|-------------|---------------|
  | `node` | `npm test` | `npm run lint` |
  | `python` | `pytest` | `ruff check .` |
  | `rust` | `cargo test` | `cargo clippy` |
  | `go` | `go test ./...` | `golangci-lint run` |
  | `java` | `mvn test` | `mvn checkstyle:check` |
  | `unknown` | `[待补充]` | `[待补充]` |
}

## Reporting Issues

Use GitHub Issues to report bugs. Include:
- A clear description of the issue
- Steps to reproduce
- Expected vs actual behavior
- Your environment (OS, {runtime} version)

{runtime 根据 ecosystem 映射:
  | ecosystem | runtime 显示值 |
  |-----------|---------------|
  | `node` | Node.js |
  | `python` | Python |
  | `rust` | Rust |
  | `go` | Go |
  | `java` | Java |
  | `unknown` | Runtime |
}

## License

By contributing, you agree that your contributions will be licensed under the project's {LICENSE_ID} License.
```

### 5.4 生成 CODE_OF_CONDUCT.md（仅完整模式）

1. 使用 Read tool 读取模板：`$PLUGIN_DIR/templates/code-of-conduct-v2.1.md`
2. 将 `[INSERT CONTACT METHOD]` 替换为作者联系方式：
   - 优先: package.json author.email
   - 其次: git config user.email
   - 降级: 保留占位符 `[INSERT CONTACT METHOD]`，在完成报告中提醒补充
3. 准备好内容待写入

---

## Step 6: 逐文件冲突检测与写入

对每个目标文件（按生成顺序: LICENSE → README.md → CONTRIBUTING.md → CODE_OF_CONDUCT.md），执行以下流程：

### 6.1 文件不存在 → 直接写入

使用 Write tool 写入文件，记录为"新建"。

### 6.2 文件已存在 → 冲突处理

展示给用户：

```text
检测到已有文件: {fileName}

--- 已有内容预览（前 20 行）---
{读取已有文件前 20 行}
--- 预览结束 ---

操作选项:
  A) 覆盖（原文件备份为 {fileName}.bak）
  B) 跳过（保留已有文件）

请选择 A 或 B:
```

**输入解析**: `A` / `a` / `覆盖` → 覆盖（先备份）；`B` / `b` / `跳过` → 跳过

**覆盖流程**：
1. 使用 Bash 复制原文件为 `.bak`: `cp {fileName} {fileName}.bak`
2. 使用 Write tool 写入新内容
3. 记录为"覆盖（已备份）"

**跳过流程**：记录为"跳过"。

---

## Step 7: 完成报告

所有文件处理完成后，输出报告：

```text
spec-driver-doc 文档生成完成!

生成文件:
  {if online_research_required: "✓ .specify/research/doc-online-research.md — 在线调研证据"}
  {if not online_research_required: "○ .specify/research/doc-online-research.md — 跳过（项目未要求）"}
  + {fileName} — 新建
  ~ {fileName} — 覆盖（已备份为 .bak）
  - {fileName} — 跳过（保留已有文件）
  ...

{如有缺失字段}
注意: 以下信息未能自动提取，请在生成的文件中手动补充标记为 [待补充] 的内容:
  - {缺失字段列表}

语义来源:
  - 产品语义: {current-spec / 项目元信息扫描}
  - 分发元信息: scan-project.sh
  - 代码校验: {AST 分析 / 未使用}

提示: 请检查生成的文件，确认内容准确后提交到版本控制。
```

**状态图标规则**：
- `+` 新建
- `~` 覆盖（已备份）
- `-` 跳过

---

## 降级与错误处理

### 完全空项目

如果 `scan-project.sh` 返回无任何已知项目配置文件且 `hasGitRepo == false`：

```text
[终止] 当前目录看起来是一个空项目（未检测到项目配置文件且无 git 仓库）。

建议先执行:
  1. git init                          — 初始化版本控制
  2. 创建项目配置文件（如 package.json、pyproject.toml、Cargo.toml 等）

然后重新运行 spec-driver-doc。
```

### 项目配置文件解析失败

如果项目配置文件存在但字段大量缺失：降级为基于目录名和 git 信息的最小生成，受影响章节标注 `[待补充]`。

### AST 分析失败

静默降级，Features 章节基于项目 description 生成。不展示错误信息。

---

## 约束

- **LICENSE 文本必须使用静态模板文件**，禁止 LLM 生成任何 LICENSE 内容
- **CODE_OF_CONDUCT 必须使用官方 Contributor Covenant 模板**，仅替换联系方式占位符
- **所有文件写入前必须经过冲突检测**，默认不覆盖已有文件
- **HTML 注释标记必须保留在生成的 README.md 中**，用于二期 `--update` 功能
- **生成的文档使用英文**（开源社区国际惯例），Constitution 原则 VI 有条件豁免
- 文档内容不得包含虚假信息，无法确定的内容标注 `[待补充]`
