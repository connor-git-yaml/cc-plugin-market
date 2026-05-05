# Feature Specification: graph-accuracy.mjs 4 语言扩展 + HikariCP / GORM Baseline 入库

**Feature Branch**: `150-graph-accuracy-extension`
**Created**: 2026-05-04
**Status**: Draft
**Input**: User description: "Feature 150 — graph-accuracy.mjs 扩展 + HikariCP/GORM baseline 入库（Spectra MCP-First Evolution 系列 Pre-dependencies 强制 gate）"

## 上下文

本 Feature 是 Spectra MCP-First Evolution 系列（Feature 151 / 152 / 153 / 154 + 151a/b/c/d 共 8 个 Feature）的 **Pre-dependencies 强制 gate**。详细背景见 [`docs/design/spectra-mcp-evolution.md`](../../docs/design/spectra-mcp-evolution.md) §3 Feature 150 与 §6 Pre-dependencies。

**为什么必须先做**：Feature 151+ 要在 4 语言（Python / TypeScript / Go / Java）实现 `LanguageAdapter.callSites` 抽取，并以 precision ≥ 70% / recall ≥ 30% 验收。**Oracle（truth set）必须先于 implementation 存在**，否则验收没有依据。当前 `scripts/graph-accuracy.mjs` 仅支持 Python AST truth set（`scripts/lib/python-call-extractor.py`，micrograd / nanoGPT 用），缺 TS / Go / Java extractor + 缺 HikariCP / GORM baseline 入库。

**强制 gate 含义**：本 Feature 不完成 → 不允许启动 Feature 151a（knowledge-graph 框架 + python callSites）。否则会出现 "implementation 先于 oracle、验收 = 跑通即过" 的反模式。

**范围边界**：本 Feature 只动 `scripts/` + `tests/` + `~/.spectra-baselines/`，**不修改 `src/`**（Spectra 自身 4 语言 callSites 抽取属 Feature 151a + 152/153/154 范围）。

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Java AST Extractor + HikariCP Baseline 入库（Priority: P1）

Spectra 团队成员要为 Feature 151d（Java callSites 实现，估时 8-10 天，是 4 语言中最复杂）准备 oracle。需要一个能从 Java 源码静态抽取 method invocation / object creation 的 AST extractor，并把 HikariCP `src/main`（~3-5k LOC，JDBC connection pool，无 Spring/Guava 依赖）作为 baseline truth set 入库。这样 151d 实现完后跑 `graph-accuracy.mjs --language java`，能直接得到 precision / recall 数字，决定该语言验收是否通过。

**Why this priority**: P1 解锁的是 4 个 sub-feature 中估时最长、复杂度最高的 151d。Java method overloading + static dispatch + interface default method + lambda + JMX 反射调用决定了它是 critical risk path；其它 3 个语言相对成熟。HikariCP baseline 必须 Week 0 完成入库，否则 151d 无 oracle。Python 已有 extractor 作为 anchor（micrograd / nanoGPT），不在 P1 范围。

**Codex CRITICAL #1 修订（gate 不能被 P1/P2/P3 弱化）**：本 Feature 是 Pre-dependencies 强制 gate，**P1/P2/P3 全部完成才能 unblock Feature 151a 启动**。即使 P1 (Java) 单独交付完，P2 (Go) / P3 (TS) 不完成，151b/c/d 也不能启动。"Independent Test" 仅指本 feature 内单 story 可单独 verify，**不**意味着 sub-feature 可绕过 gate。

**Independent Test**: 单独交付 P1 后可独立验证本 story（不代表能解锁 151d）— 跑 `node scripts/graph-accuracy.mjs --language java --source ~/.spectra-baselines/HikariCP/src/main --graph <fixture-graph.json>`，输出 JSON 含 precision / recall / hits / misses；同时 `tests/baseline/HikariCP/truth-set.json` 含 ≥ 100 条 truth call。**Spot-check sample 5-10%**（约 5-10 条，符合 design doc §truth verification 表的 500-5k LOC scope 要求，Codex CRITICAL #2 修订）。

**Acceptance Scenarios**:

1. **Given** HikariCP repo 已 clone 至 `~/.spectra-baselines/HikariCP/`，**When** 跑 `node scripts/graph-accuracy.mjs --language java --source ~/.spectra-baselines/HikariCP/src/main --write-fixture tests/baseline/HikariCP/truth-set.json`，**Then** fixture 文件生成，含 ≥ 100 条 truth calls（caller / callee / file / line / kind 字段齐全），无运行时崩溃
2. **Given** Java extractor 单测 suite，**When** 跑 `npx vitest run tests/unit/lib/java-call-extractor.test.ts --coverage`，**Then** branch + line coverage ≥ 95%，至少 5 个 case（basic call / method call / cross-class call / unresolved fallback / overloading edge case）全 pass
3. **Given** HikariCP truth set 已生成，**When** 从 truth calls 中随机抽 5-10% sample（约 5-10 条，按 design doc §truth verification 500-5k LOC scope 要求），人工对照源码 verify，**Then** 100% callee / caller / file / line 准确（label 名 + 行号 + 文件路径）
4. **Given** HikariCP 中存在反射调用（如 JMX MBean lookup），**When** extractor 处理这些调用点，**Then** extractor 不崩溃、跳过该调用并在 warnings 数组记录 `unresolved-reflection`，truth set 仍然成功输出
5. **Given** 现有 `node scripts/graph-accuracy.mjs --language python --source ~/.spectra-baselines/micrograd ...`（Python anchor 流程），**When** 在 P1 完成后再次执行，**Then** 输出 JSON schema 与之前完全一致，coverage 数字误差 ≤ 1%（向后兼容）

---

### User Story 2 - Go AST Extractor + GORM Baseline 入库（Priority: P2）

Spectra 团队成员要为 Feature 151c（Go callSites 实现，估时 5-7 天）准备 oracle。需要一个能从 Go 源码静态抽取 call_expression / selector_expression 的 AST extractor，并把 GORM 的 core package（避开 50k LOC 全包）作为 baseline truth set 入库。GORM 的 generic types + reflection-heavy 风格使其 Go AST 复杂度高于一般项目，是合适的难度上限锚点。

**Why this priority**: P2 解锁 Feature 151c。GORM 复杂度高于小项目但低于 Java，是 Go 语言的合理 challenge。完成 P2 后 151c 就能启动。

**Independent Test**: 跑 `node scripts/graph-accuracy.mjs --language go --source ~/.spectra-baselines/gorm/<core-package> --write-fixture tests/baseline/gorm/truth-set.json`，fixture 含 ≥ 200 条 truth calls；1% 随机 sample 人工 spot-check 全部 verify。P2 完成不依赖 P3。

**Acceptance Scenarios**:

1. **Given** GORM repo 已 clone 至 `~/.spectra-baselines/gorm/`，scope 选定 core package，**When** 跑 `node scripts/graph-accuracy.mjs --language go --source <scope> --write-fixture tests/baseline/gorm/truth-set.json`，**Then** fixture 生成，含 ≥ 200 条 truth calls，schema 与 Java/Python 一致
2. **Given** Go extractor 单测 suite，**When** 跑 `npx vitest run tests/unit/lib/go-call-extractor.test.ts --coverage`，**Then** coverage ≥ 95%，5 个 case（basic call / method call via selector / cross-package call / generic type fallback / dynamic dispatch unresolved）全 pass
3. **Given** GORM 中含 generic type 与 interface dispatch，**When** extractor 遇到无法静态解析的调用，**Then** 标记 `kind: 'unresolved'` 并继续处理，warnings 数组记录原因，不影响其它 calls 的抽取

---

### User Story 3 - TypeScript AST Extractor 扩展（Priority: P3）

Spectra 团队成员要为 Feature 151b（TS callSites 实现，估时 2-3 天）准备 oracle。hono 与 self-dogfood 已是现有 TS baseline，但缺 truth call set。需要一个 TS / TSX AST extractor 能从 hono 与 self-dogfood 抽取静态 call sites，使 graph-accuracy.mjs 能跑 `--language ts`。

**Why this priority**: P3 解锁 Feature 151b。TS 复杂度最低（已有成熟 tree-sitter-typescript grammar），4 个语言中工作量最小，所以排 P3。同时 hono / self-dogfood 已 clone，仅需写 extractor + 跑 truth set，不涉及新 baseline 入库。

**Independent Test**: 跑 `node scripts/graph-accuracy.mjs --language ts --source ~/.spectra-baselines/hono --write-fixture tests/baseline/hono/truth-set.json`（self-dogfood 同理），fixture 生成无错；TS extractor 单测 ≥ 95% 覆盖。P3 完成不依赖 P1/P2。

**Acceptance Scenarios**:

1. **Given** hono 与 self-dogfood 已在 `~/.spectra-baselines/`（已存在 baseline workspace），**When** 跑 `--language ts --source <root>`，**Then** truth set 文件生成，含 caller / callee / file / line / kind，覆盖 method call / function call / arrow function call / class instantiation 4 类
2. **Given** TS extractor 单测 suite，**When** 跑 `npx vitest run tests/unit/lib/ts-call-extractor.test.ts --coverage`，**Then** coverage ≥ 95%，5 个 case（basic / method / arrow / generic / decorator metadata）全 pass

---

### Edge Cases

- **语法错误源文件**：TS / Go / Java extractor 遇 tree-sitter parse 失败的文件 → **skip 该文件 + warnings 数组记录 file path + parse error**，不崩溃，不影响其它文件抽取
- **反射 / 动态 dispatch**：HikariCP JMX MBean、GORM `interface{}` 反射、TS `eval` / 动态 import → AST extractor 仅抽静态可见调用，标 `kind: 'unresolved'` 或在 warnings 中归类，不尝试解析
- **泛型 / 模板**：Java generics、Go generics、TS generic type → AST 看到的 callee 标签按 erased name 记录（如 `List<T>.add` 记为 `add`），label-only 匹配下与 Spectra graph 输出对齐
- **重载 / overloading**：Java method overloading 同名不同签名 → label-only 匹配下视为相同 callee 名，acceptable（Feature 151+ 同样按 label-only 验收）
- **跨语言 baseline workspace 已存在**：`~/.spectra-baselines/HikariCP/` 已存在 → 跳过 `git clone`，**不执行 `git pull`**（避免引入未预期变更，导致 truth set 漂移）；用户需要更新时手动 pin 一个新 commit hash
- **空 source root**：`--source` 指向空目录或无目标语言文件 → 输出空 truth set + warnings，exit code 0（不视为错误，让上层流程继续）
- **现有 Python micrograd 流程**：本 Feature 后跑 micrograd Python truth set → JSON schema、字段名、coverage 数值稳定（向后兼容硬约束）
- **clone 网络 timeout**（Codex WARNING #4 修订）：HikariCP / GORM 首次 clone 网络故障 → 脚本 retry 1 次，仍失败则 exit 1 + stderr 写明 `repo / commit / network error`，不留中间态（清理半 clone 的目录）
- **extractor 版本 drift**（Codex WARNING #4 修订）：fixture 元数据头 `extractorVersion` 字段记录 extractor 当前版本，graph-accuracy 跑 reproducibility 模式时若 fixture extractorVersion ≠ 当前版本 → warnings 数组提示 "extractor drift, regenerate truth set" 但不强制失败
- **GORM 子包路径误传**（Codex WARNING #4 修订）：用户跑 `--source ~/.spectra-baselines/gorm/schema` 等子包路径 → extractor 不阻止（按用户指定 source 处理），但 fixture 元数据头标 `scope: 'user-specified'` 提醒非 FR-016 标准 scope

## Requirements *(mandatory)*

### Functional Requirements

#### FR-1：扩展 graph-accuracy.mjs 主流程 4 语言支持

- **FR-001**: `scripts/graph-accuracy.mjs` MUST 接受 `--language python|ts|go|java` flag，4 选 1，缺省值保留 `python`（向后兼容现有 Python 调用方）
- **FR-002**: 主流程 MUST 在传入 `--language ts|go|java` 时分派到对应 extractor（FR-2 系列），output JSON schema 与 Python 流程一致（precision / recall / hits / misses / falsePositives 字段名 + 嵌套结构 byte-level identical when language flag is omitted）
- **FR-003**: 主流程 MUST 支持现有 `--write-fixture <path>` 参数把 truth set 持久化到指定路径（用于 baseline 入库）
- **FR-004**: 主流程 MUST 在任何 extractor 抛 unrecoverable 错误时返回 non-zero exit code 并把 stderr 写明 language + file + reason，便于 CI 调试

#### FR-2：4 语言 AST Extractor

- **FR-005a**: System MUST 保留现有 `scripts/lib/python-call-extractor.py`（Python anchor，本 Feature 不修改其逻辑，仅作为输出 schema 标准对齐参考；Codex WARNING #1 修订）
- **FR-005**: System MUST 提供 `scripts/lib/ts-call-extractor.{mjs,ts}`，输入 source root，输出 truth calls 数组：`{caller, callee, file, line, kind: 'method'|'function'|'arrow'|'constructor'|'unresolved'}`
- **FR-006**: System MUST 提供 `scripts/lib/go-call-extractor.{mjs,ts}`，同上 schema，`kind: 'method'|'function'|'static'|'unresolved'`
- **FR-007**: System MUST 提供 `scripts/lib/java-call-extractor.{mjs,ts}`，同上 schema，`kind: 'method'|'static'|'constructor'|'super'|'unresolved'`
- **FR-008**: 每个 extractor MUST 复用 tree-sitter（已 verified：`grammars/tree-sitter-{python,javascript,typescript,go,java}.wasm` 5 个 grammar wasm 全在仓库 + `web-tree-sitter` 在 `package.json` runtime deps），不引入新 native parser dependency
- **FR-009**: 每个 extractor MUST 在遇到无法静态解析的调用（反射、动态 dispatch、泛型擦除）时标 `kind: 'unresolved'` 并继续，**不抛错、不丢失其它 calls**
- **FR-010**: 每个 extractor MUST 输出 warnings 数组：`{file, line?, code: 'parse-error'|'unresolved-reflection'|'unresolved-dynamic'|...}`，用于排查与 spot-check

#### FR-3：HikariCP Baseline 入库

- **FR-011**: System MUST 提供脚本或文档化命令，clone `brettwooldridge/HikariCP` 到 `~/.spectra-baselines/HikariCP/`，pin 一个具体 commit hash（写入 fixture 元数据）
- **FR-012**: HikariCP truth set scope MUST 是 `src/main`（不含 `src/test/` 与 benchmarks）
- **FR-013**: System MUST 把 HikariCP truth set 持久化到 `tests/baseline/HikariCP/truth-set.json`，文件含 ≥ 100 条 truth calls，符合 FR-005~FR-007 schema
- **FR-014**: HikariCP fixture MUST 含元数据头：`{baseline: {repo, commit, scope, generatedAt, extractorVersion}}`，供后续 reproducibility 检查

#### FR-4：GORM Baseline 入库

- **FR-015**: System MUST 提供脚本或文档化命令，clone `go-gorm/gorm` 到 `~/.spectra-baselines/gorm/`，pin 一个具体 commit hash
- **FR-016**: GORM truth set scope **MUST 选 `gorm.io/gorm` 顶层包**（即 `~/.spectra-baselines/gorm/*.go` 顶层 .go 文件，**不含**子包如 `schema/`、`migrator/`、`logger/`、`callbacks/`、`clause/`、`utils/`，~10k LOC core，Codex WARNING #3 修订：scope 在 spec 阶段定死避免 SC 不稳定），含 ≥ 200 条 truth calls
- **FR-017**: System MUST 把 GORM truth set 持久化到 `tests/baseline/gorm/truth-set.json`，元数据头同 FR-014

#### FR-5：单测覆盖

- **FR-018**: 每个新 extractor MUST 有单测，文件位于 `tests/unit/lib/{ts,go,java}-call-extractor.test.ts`
- **FR-019**: 单测 MUST 跑 `npx vitest run --coverage` 报告 branch + line coverage ≥ 95%。**Per-extractor 阈值（Codex WARNING #2 修订）**：vitest config 必须配置 per-file thresholds，确保 ts/go/java 各 extractor 文件单独 ≥ 95%（不允许全局聚合稀释——例如某 extractor 80% + 其它 100% 平均仍达标）
- **FR-020**: 每个 extractor 单测 MUST 至少含 5 个 case：basic call、method call、cross-module/cross-package call、unresolved fallback、edge case（语法错或反射）
- **FR-021**: 现有 `python-call-extractor.py` 与对应 micrograd / nanoGPT 测试 MUST 不被破坏（向后兼容硬约束）

### Key Entities

- **Truth Set**：单语言下从 baseline 源码静态抽取的 call sites 集合，schema `{language, baseline: {repo, commit, scope, generatedAt, extractorVersion}, truthCalls: Array<{caller, callee, file, line, kind}>, warnings: Array<{file, line?, code, message?}>}`，作为 oracle 供 graph-accuracy.mjs 与 Spectra 输出 graph 比对
- **Call Site**：truth set 中单条调用记录，含 caller（调用者全限定名或文件位置）、callee（被调函数名）、file（绝对或相对路径）、line（行号）、kind（method/function/constructor/static/unresolved 等）
- **Baseline Workspace**：持久化在 `~/.spectra-baselines/<project>/` 的源码 git clone，跨 worktree 共享，pin 至具体 commit hash 以保 reproducibility
- **Coverage Report**：graph-accuracy.mjs 输出的 metric 集合 `{precision, recall, hits, misses, falsePositives, coverageMethod}`，按 callee 名 label-only 匹配
- **Extractor**：单语言的 AST-based truth set 抽取器（python/ts/go/java），共享统一输入接口（source root）+ 输出 schema（truth calls + warnings）

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: **3 个新增 extractor**（ts/go/java，`scripts/lib/*-call-extractor.mjs`）单测 per-file branch + line coverage 双指标 ≥ 95%（任一文件单独低于 95% → 验收不通过；Codex CRITICAL #2 修订：澄清 SC-001 仅覆盖新 .mjs extractor，Python `python-call-extractor.py` 不在 vitest 范围，由 SC-005 + FR-021 向后兼容硬约束保证不退化）
- **SC-002**: HikariCP `src/main` 成功生成 `tests/baseline/HikariCP/truth-set.json`，含 ≥ 100 条 truth calls，AST extractor **spot-check 5-10% 随机 sample**（约 5-10 条，按 design doc §truth verification 500-5k LOC scope 要求；Codex CRITICAL #2 修订）人工 verify caller / callee / file / line 全部准确
- **SC-003**: GORM core package（FR-016 定义的顶层 .go 文件，~10k LOC，Codex WARNING #3 修订）成功生成 `tests/baseline/gorm/truth-set.json`，含 ≥ 200 条 truth calls，AST extractor **spot-check 1% 随机 sample**（约 2-3 条，按 design doc §5k-50k LOC scope 要求）人工 verify 全部准确
- **SC-004**: `node scripts/graph-accuracy.mjs --language ts|go|java --source <root> --graph <graph.json>` 命令可跑通，输出 JSON 含 precision / recall / hits / misses / falsePositives 字段，与 Python 流程 schema 完全一致（key 顺序、嵌套层级、字段名）
- **SC-005**: 现有 Python micrograd / nanoGPT graph-accuracy 流程不被破坏 — 跑 `--language python` 输出 coverage 数字与本 Feature 实施前差值 ≤ 1%（向后兼容硬约束）

## Out of Scope

以下明确不在本 Feature 范围内，避免 scope creep：

1. **不实现 Spectra 自身的 4 语言 callSites 抽取**：`src/adapters/{ts-js,python,go,java}-adapter.ts` 的 `buildDependencyGraph` 增强属 Feature 151a + 152/153/154 范围。本 Feature 只产 oracle，不产 implementation
2. **不修改 `src/`**：所有改动限于 `scripts/`、`tests/`、`~/.spectra-baselines/`
3. **不计算 4 语言间的 cross-language metric**：每语言独立 precision / recall，不做 multi-language aggregation
4. **不引入新运行时 dependency**：tree-sitter / tree-sitter-{typescript,go,java,python} 已是 spectra runtime 依赖，复用即可；禁止引入 ts-morph / @typescript-eslint/parser 等新 parser
5. **不实现 caller-context-aware 匹配**：维持 label-only 匹配（与现有 Python 流程一致），caller-aware 升级属未来 follow-up Feature
6. **不验证 reflection / dynamic dispatch resolution 的正确性**：HikariCP JMX、GORM interface{}、TS dynamic import 均标 unresolved，本 Feature 不评判这些 unresolved 是否"应该"被解析
7. **不做 500+k LOC 大项目 baseline**：Continue / Khoj / LangChain 等不入本 Feature；按 evolution doc §7 "follow-up Feature 按需加" 处理
8. **不引入 cross-tool diff 模式**：`baseline-diff --cross-tool` 等扩展属 Feature 154 或后续

## 关键约束

- **正文中文**，技术术语英文（AST、tree-sitter、callSite、truth set、precision/recall 等）
- **不预测实现细节**：具体 tree-sitter query 模式、extractor 内部数据结构、CLI 参数解析方式由 plan.md 决定
- **向后兼容硬约束**：现有 Python 流程（micrograd / nanoGPT）输出 byte-stable，coverage 数字漂移 ≤ 1%
- **commit hash pin**：HikariCP / GORM baseline 必须 pin 具体 commit，防止上游变更导致 truth set drift
- **强制 gate**：本 Feature 全部 P1+P2+P3 完成 → Feature 151+ 全部 sub-features unblock。**P1 / P2 / P3 单独完成不解锁对应 sub-feature**（Codex CRITICAL #1 修订）。时间预算（Codex INFO #1 统一口径）：extractor 实现 + 单测 ~2.5 周 + clone + baseline 入库 ~3 天 = **~3 周**（design doc §排期 Week 0-1.5 是 baseline truth verification 启动到 framework gate 的关键节点，~3 周对齐 design doc §6 估算）
- **遵循 [Project Constitution](../../.specify/memory/constitution.md)**：所有改动符合代码质量、零基思维、简洁之道原则

## 引用

- 设计文档：[`docs/design/spectra-mcp-evolution.md`](../../docs/design/spectra-mcp-evolution.md) §3 Feature 150 与 §6 Pre-dependencies、§7 Baseline 选型
- 现有 Python anchor：[`scripts/lib/python-call-extractor.py`](../../scripts/lib/python-call-extractor.py)
- 现有 graph-accuracy 主流程：[`scripts/graph-accuracy.mjs`](../../scripts/graph-accuracy.mjs)
- 现有 baseline 测试约定：见 `CLAUDE.local.md` "Baseline 测试（Feature 143）"小节
