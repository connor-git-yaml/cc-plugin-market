---
feature: F3 Debt Intelligence — 技术债引擎
mode: story
phase: specify
branch: 130-debt-intelligence
dependencies:
  - F1 (budget-gate / cost-summary) — 已完成
  - F2 (SpecStore / sourceKind) — 已完成
out_of_scope:
  - 图节点集成（graph.json）留给 F4
  - 自动生成 GitHub issue
  - AI 修复建议
  - 跨 batch 趋势深度分析
---

# F3 Debt Intelligence — 技术债引擎

## 1. 背景与动机

Graphify Full 对比测试证明了一个 Spectra 当前缺失的能力：把代码里的技术债（TODO/FIXME）和设计文档里的"未决问题"（open question / tradeoff）作为一等公民呈现。Graphify 能从 `notes.md` 提取 3~4 个 Open Questions 并连接到相关代码函数。Spectra 的 `quality-report.md` 目前只有泛泛的 "10 条 general warnings"，没有系统提取技术债。

F3 的目标：让 Spectra 产出一个独立的、可操作的技术债视图，让团队能定期审计"我们积累了多少债、哪些最老、哪些最严重"。

## 2. User Stories

### Story 1 (P1)：代码注释债务扫描

**As** 一个 Spectra 用户
**I want** 在 batch 输出的 `specs/project/technical-debt.md` 里看到项目里所有 `TODO / FIXME / HACK / XXX / NOTE` 注释的系统清单
**So that** 我可以量化代码债规模，按年龄 / 严重性排序优先处理。

**Acceptance Criteria:**
- AC-1.1 扫描覆盖所有已注册 LanguageAdapter 支持的语言（TypeScript、Python、Go、Java，未来可扩展）
- AC-1.2 基于 AST 识别，不会把字符串字面量里的 `"TODO"` 误识别为债务
- AC-1.3 每条债务条目包含：kind（TODO/FIXME/HACK/XXX/NOTE）、注释文本、文件相对路径、起始行号、所属函数或类、git blame 的 author、年龄（天数）
- AC-1.4 在未追踪 git 或文件未 committed 时，author = `"uncommitted"`、age = 0，不中断流程
- AC-1.5 未识别到任何债务条目时，文档明确输出"项目当前未识别出代码注释债务"，不伪造

### Story 2 (P1)：Design-doc Open Questions 提取

**As** 一个 Spectra 用户
**I want** 在 `technical-debt.md` 里看到从项目 design-doc 里提取出的 open questions
**So that** 团队的"设计债"也能被统一审计，而不是埋在 notes.md 里被遗忘。

**Acceptance Criteria:**
- AC-2.1 扫描目标项目根目录及一级子目录下文件名匹配 `README.md / architecture.md / notes.md / design.md` 的 design-doc（大小写不敏感）
- AC-2.2 识别两类 open question：
  - 显式标记：出现 `TBD / 待定 / open question / open questions / tradeoff / trade-off` 之一
  - 疑问句：段落以问号结尾的陈述（由 LLM 辅助判断是否属于实际开放问题，避免纯规则误判）
- AC-2.3 每条 open question 包含：原文片段（不超过 400 字符）、文档相对路径、标题路径（如 `## Open Questions > Q1`）、LLM 推断的涉及主题（1-3 个短词）
- AC-2.4 LLM 调用必须走 F1 的 budget-gate 基础设施；dry-run 模式下不发起 LLM 调用，使用"规则命中 + 未分类主题"退化
- AC-2.5 LLM 调用的 tokenUsage 必须记录到当前 pipeline 的 cost 汇总中
- AC-2.6 项目没有 design-doc 或 design-doc 无疑问句 → 明确输出"未识别出开放问题"，不伪造
- AC-2.7 AC-2.6 触发 LLM budget 耗尽（fallback）时应自动降级为"规则命中 only"，不中断 pipeline

### Story 3 (P2)：技术债独立文档

**As** 一个 Spectra 用户
**I want** 一份独立的、结构清晰的 `specs/project/technical-debt.md`
**So that** 我可以把它当作 review checklist 使用。

**Acceptance Criteria:**
- AC-3.1 文档写入目标项目的 batch 输出目录 `<specsDir>/project/technical-debt.md`
- AC-3.2 文档结构：
  1. **概要**：总数 / 按 kind 分布 / 按年龄分布（< 30天 / 30-90天 / 90-180天 / > 180天）/ 最老的 5 条
  2. **代码注释债务明细表**：按 severity×age 双重排序（FIXME/HACK > TODO > NOTE/XXX；同级按 age 降序）
  3. **Design-doc 开放问题明细**：按文档路径分组
  4. **引用清单**：文件 → 行号 → 规范化描述
- AC-3.3 文档 frontmatter 含：`tokenUsage`、`durationMs`、`llmModel`、`fallbackReason`（Wave 1 已有的通用字段）
- AC-3.4 同 batch 输出目录下的 `specs/README.md`（若存在）"质量审计" 节新增一行链接：`- [技术债清单](project/technical-debt.md)`；若 `specs/README.md` 不存在则跳过，不报错

### Story 4 (P2)：quality-report 技术债评分

**As** 一个 Spectra 用户
**I want** 在现有 `quality-report.md` 里看到一个"技术债"评分节
**So that** 我可以在单一报告里看到项目整体健康度。

**Acceptance Criteria:**
- AC-4.1 `quality-report.md` 在 `## Required Docs` 节之后追加 `## 技术债` 节
- AC-4.2 指标：总条目数、按 kind 分布、代码债务密度（条/kLOC，LOC 取所有 AST 扫描过的源文件行数之和）、最老条目年龄（天）
- AC-4.3 `technical-debt.md` 未生成时，quality-report.md 不追加该节（而不是显示空节）
- AC-4.4 跨 batch 对比（本次新增/已清理）标记为可选，若实现难度超过 2 小时则 defer 到后续 feature

## 3. 诚实降级边界

| 场景 | 行为 |
|------|------|
| 项目无 TODO/FIXME 注释 + 无 design-doc | `technical-debt.md` 输出"未识别出技术债" 并写明扫描范围 |
| 项目有代码但 LanguageAdapter 不支持该语言 | 扫描时跳过该文件，在 diagnostics 中记录"N 个文件因语言未支持被跳过" |
| design-doc 存在但无疑问句 + 无显式标记 | 输出"未识别出开放问题"，AC-2.6 |
| LLM budget 耗尽 | 降级为规则命中 only，frontmatter `fallbackReason=budget-exhausted` |
| git blame 失败（非 git 项目） | 所有条目 author=`"uncommitted"` age=0，不中断 |

## 4. 读写边界（快照）

| 路径 | 权限 |
|------|------|
| `src/debt-scanner/**` 新建 | ✅ |
| `src/panoramic/pipelines/debt-*.ts` 新建 | ✅ |
| `src/utils/git-blame.ts` 新建（轻量 wrapper） | ✅ |
| `src/adapters/*-adapter.ts` 扩展 `extractComments()` | ✅（新增方法，不改既有方法） |
| `src/batch/batch-orchestrator.ts` | ⚠️ 小改（调用 debt pipeline） |
| `src/panoramic/pipelines/docs-quality-evaluator.ts` | ⚠️ 小改（追加技术债节） |
| `src/spec-store/**` | 👁️ 只读 |
| `src/batch/budget-gate.ts`、`cost-summary.ts` | 👁️ 只读通过 API 调用 |
| `specs/_meta/graph.json` | ❌ 不碰（F4 领地） |
| `plugins/spec-driver/**` | ❌ 不碰 |

## 5. 非功能要求

- **NFR-1 性能**：对 ~10k LOC、~50 个源文件的项目，整个 debt 扫描（含 LLM 调用）完成在 30s 内；AST 扫描单独 < 5s
- **NFR-2 确定性**：同一份代码的两次扫描，代码债务条目顺序必须一致（按 file → line 稳定排序）
- **NFR-3 零额外运行时依赖**：只使用现有依赖（TypeScript、tree-sitter、child_process）
- **NFR-4 可观测性**：每个 pipeline 写入 diagnostics（处理文件数、跳过文件数、LLM 调用次数、tokenUsage）

## 6. 验收用例

### 用例 1 — graphify 示例项目（正向）
- 目标：`_reference/graphify/worked/example/raw/`
- 预期：
  - `<specsDir>/project/technical-debt.md` 生成
  - 至少 3 条 design-doc open questions（notes.md 已确认含 4 条）
  - 代码注释债务数可能为 0（graphify 示例本身很干净），文档写明"未识别出代码注释债务"
  - `<specsDir>/project/quality-report.md` 含 "## 技术债" 节

### 用例 2 — 纯代码无 design-doc 项目（降级）
- 目标：临时 fixture（仅若干 `.ts` 文件，不含任何 `.md`）
- 预期：
  - `technical-debt.md` 生成，代码债务节有条目（或显式说明为 0），design-doc 节输出"未识别出开放问题"
  - pipeline 不报错

### 用例 3 — 全空项目（双重降级）
- 目标：临时 fixture（空目录或仅无注释的代码）
- 预期：`technical-debt.md` 输出"项目当前未识别出技术债"

## 7. 澄清与歧义记录

- **Q1 已澄清**：`specs/project/technical-debt.md` 的路径是目标项目 batch 输出的路径，不是 `cc-plugin-market` 仓库本身的 `specs/`。
- **Q2 已澄清**：`NOTE` 注释在某些代码库里是中性注释，不全是债务。本 feature 把它归类到最低严重性 `informational`，在概要中单独列出，不混入 TODO 排序。
- **Q3 已澄清**：AC-4.4 的跨 batch 差值对比若实现难度超过 2 小时 defer 到后续 feature，本 feature 不阻塞。
