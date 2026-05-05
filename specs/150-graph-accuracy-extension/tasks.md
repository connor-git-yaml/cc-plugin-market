---
description: "Task list for Feature 150 — graph-accuracy.mjs 4 语言扩展 + HikariCP / GORM Baseline 入库"
---

# Tasks: graph-accuracy.mjs 4 语言扩展 + HikariCP / GORM Baseline 入库

**Input**: Design documents from `/specs/150-graph-accuracy-extension/`
**Prerequisites**: [`spec.md`](./spec.md)（必读）、[`plan.md`](./plan.md)（必读）

**Tests**: 本 Feature 测试为**强制**（FR-018~FR-020 + SC-001 per-file ≥ 95%），不是可选项。

**Organization**: 按 user story 分组（P1 / P2 / P3），每个 story 独立可测。**强制 gate 不被弱化**：P1+P2+P3 全部完成才 unblock Feature 151+ 启动。

## Format: `[ID] [P?] [Story] Description`

- **[P]**：可并行（不同文件 + 无依赖）
- **[Story]**：US1 = User Story 1（Java + HikariCP，P1）；US2 = User Story 2（Go + GORM，P2）；US3 = User Story 3（TS extractor，P3）；FOUND = Foundational；SETUP = Setup；POLISH = Polish & Quality Gate
- 每条 task 含目标 + 修改文件路径 + Acceptance criteria + 依赖前序 task

## Path Conventions

仓库根 `scripts/` + `tests/` + `vitest.config.ts`（plan.md File Manifest 段已固化全部路径）。

---

## Phase 1: Setup（Shared Infrastructure）

**Purpose**: 准备 vitest per-file coverage 配置 + clone helper 脚本，所有后续 phase 的前置基础设施。

### T-001 [SETUP] vitest config 加 per-file coverage thresholds

**目标**：为 4 个 extractor 文件配置 per-file ≥ 95% 覆盖阈值，避免全局聚合稀释（某 extractor 80% + 其它 100% 平均仍达标）。

**修改文件**：
- `vitest.config.ts`：`test.coverage.thresholds` 段新增 per-file overrides；`test.coverage.include` 段新增 `scripts/lib/{ts,go,java}-call-extractor.mjs`

**Acceptance criteria**：
- vitest config 改动通过 `npm run build` 无 TS error
- 跑空的 4 个 extractor 文件（仅 export stub）+ 空单测 → vitest --coverage 报告显示 4 个 extractor 文件单独 threshold 是 95%（不是全局 80%）
- 现有 src 单测的 coverage thresholds 80% 不被破坏（向后兼容硬约束）

**对应 spec 项**：FR-019 / SC-001

**依赖**：无（Setup phase 第一个 task）

---

### T-002 [P] [SETUP] 写 baseline projects clone helper 脚本

**目标**：单脚本 clone HikariCP + GORM 至 `~/.spectra-baselines/`，pin commit + retry 1 次。

**新增文件**：
- `scripts/baselines/clone-baseline-projects.sh`

**Acceptance criteria**：
- 脚本可执行（`chmod +x` 权限），且 zsh / bash 双兼容
- 已存在目标目录 → 跳过 clone（**不执行 `git pull`**，spec.md Edge Case "已存在不 pull"）
- clone 失败 → retry 1 次（spec.md Edge Case "clone 网络 timeout"）；仍失败 → exit 1 + stderr 写明 `repo / commit / network error` + 清理半 clone 目录
- 接受可选环境变量 `SPECTRA_BASELINE_HOME` 覆盖默认 `~/.spectra-baselines/`（与 CLAUDE.local.md 现有约定一致）
- 脚本顶部注释说明：用法、pin 的 commit hash 在哪里、跨 worktree 共享语义

**对应 spec 项**：FR-011 / FR-015 + Edge Case "clone 网络 timeout"

**依赖**：无（与 T-001 并行 [P]）

---

**Phase 1 Checkpoint**: vitest config + clone helper 就绪。后续任何 task 跑 vitest 都能识别 per-file 95% 阈值。

---

## Phase 2: Foundational（Blocking Prerequisites）

**Purpose**: 共享基础设施——graph-accuracy.mjs 主流程 dispatch + extractor-helpers——所有 user story 的前置。

**⚠️ CRITICAL**：本 phase 完成前任何 user story 实现均不能开始。

### T-003 [FOUND] graph-accuracy.mjs 加 --language flag dispatch + 兼容性单测

**目标**：主流程加 `--language python|ts|go|java` flag，缺省值 `python`（FR-001 向后兼容）；分派到对应 extractor；保留现有 Python anchor path 不动；同时新增兼容性单测，验证 Python 流程 byte-stable。

**修改文件**：
- `scripts/graph-accuracy.mjs`：加 `--language` 解析 + dispatch logic（python case 完全不动，新增 ts/go/java case dispatch 至对应 extractor module；unknown language → throw + non-zero exit + stderr 写明）
- `tests/unit/lib/graph-accuracy-dispatch.test.ts`（新增）：4 个 case 验证 dispatch 正确性 + 1 case 验证 unknown language 报错

**Acceptance criteria**：
- `node scripts/graph-accuracy.mjs --language python --source <existing micrograd path> --graph <fixture-graph.json>` 输出与本 Feature 实施前 byte-level identical（FR-002 / FR-021 / SC-005）
- `node scripts/graph-accuracy.mjs --language unknown ...` → exit code non-zero + stderr 含 "Unsupported language" 字样（FR-004）
- `--language ts|go|java` flag 在 extractor 文件未实现时（Phase 3~5 之前）应得到清晰 error message（不是 silent fail）——可用 `try/catch import().then()` 捕获 module not found 后 exit + stderr
- dispatch 单测 ≥ 5 case 全 pass

**对应 spec 项**：FR-001 / FR-002 / FR-003 / FR-004 / FR-005a / FR-021 / SC-005

**依赖**：T-001（per-file thresholds 已就绪）

---

### T-004 [P] [FOUND] 抽出 extractor 共享 helpers

**目标**：抽出 4 个 extractor 共享的 boilerplate（tree-sitter loader / walkSourceFiles / warnings 追加 / metadata 头构造）至单个 helper module，避免 Phase 3~5 三处重复。

**新增文件**：
- `scripts/lib/extractor-helpers.mjs`，导出：
  - `loadTreeSitterParser(language: 'ts' | 'go' | 'java')`：动态加载 wasm grammar，返回初始化好的 Parser
  - `walkSourceFiles(root, extensions, ignorePaths)`：递归遍历，跳过 `node_modules` / `.git` / `vendor` / `target` / `build` / `dist` / `out`
  - `appendWarning(warnings, code, file, line?, message?)`
  - `buildBaselineMetadata({repo, commit, scope, extractorVersion})`

**Acceptance criteria**：
- helper module 在 Node.js 20.x 跑通（pure ESM，无 TS transpile）
- `loadTreeSitterParser('java')` 能成功 init `web-tree-sitter` + load `grammars/tree-sitter-java.wasm`，return Parser 实例
- `walkSourceFiles` 递归正确（人工 mock fs 单测 ≥ 3 case：basic recursion / ignore paths / non-existent root）
- helpers 单测可与 extractor 单测合并写在 `tests/unit/lib/extractor-helpers.test.ts`（可选，最低限度由 extractor 单测间接覆盖）

**对应 spec 项**：plan.md Architecture / Implementation Strategy "Phase 2 抽出共享 helpers"；服务于 FR-005~FR-010

**依赖**：T-001（与 T-003 可并行 [P]）

---

**Phase 2 Checkpoint**: 主流程 dispatch + 共享 helpers 就绪。User story implementation 可开始。

---

## Phase 3: User Story 1 - Java + HikariCP Baseline 入库（Priority: P1）🎯 MVP

**Goal**：交付 Java AST extractor + HikariCP `src/main` truth set fixture，作为 critical risk path 锚点（4 语言中最复杂）。

**Independent Test**（spec.md US1）：跑 `node scripts/graph-accuracy.mjs --language java --source ~/.spectra-baselines/HikariCP/src/main --graph <fixture-graph.json>`，输出含 precision / recall / hits / misses；同时 `tests/baseline/HikariCP/truth-set.json` 含 ≥ 100 truth calls；spot-check 5-10% 人工 verify 全准确。

**强制 gate 不被弱化**：P1 单独完成 **不**解锁 Feature 151d，必须 P1+P2+P3 全部完成才 unblock 151+。

### T-005 [US1] clone HikariCP @ pinned commit

**目标**：跑 clone helper（T-002）clone HikariCP 至 `~/.spectra-baselines/HikariCP/`，pin 一个 stable upstream commit hash。

**修改文件**：
- 不修改任何文件，仅运行 `bash scripts/baselines/clone-baseline-projects.sh`（或在 helper 脚本内 hardcode commit hash 后跑）
- 实现阶段决定具体 commit hash（选 HikariCP stable release tag commit），写入 helper 脚本顶部 + 后续 fixture metadata

**Acceptance criteria**：
- `~/.spectra-baselines/HikariCP/src/main` 存在 .java 源文件（数量符合 HikariCP 实际规模 ~30+ files）
- `cd ~/.spectra-baselines/HikariCP && git rev-parse HEAD` 输出与 helper 脚本 pin 的 commit 一致
- 已存在目录则脚本跳过且不报错（idempotent）

**对应 spec 项**：FR-011 / FR-012

**依赖**：T-002

---

### T-006 [US1] 写 java-call-extractor.mjs

**目标**：实现 Java AST extractor，覆盖 method_invocation / object_creation / overloading / static dispatch / interface default / lambda / unresolved-reflection。

**新增文件**：
- `scripts/lib/java-call-extractor.mjs`：导出 `extractTruthSet(sourceRoot, options)` 接口（plan.md Architecture 共享接口契约）

**Acceptance criteria**：
- 接口签名严格符合 plan.md Architecture 定义（同 ts/go extractor 一致）
- 处理 `method_invocation` / `object_creation_expression` / `super_method_invocation` / `class_instance_creation_expression` 4 类 tree-sitter node
- kind 字段：`method` / `static` / `constructor` / `super` / `unresolved` 全部按 spec.md FR-007 出现
- 反射调用（`Class.forName(...)` / JMX MBean lookup）→ 标 `unresolved-reflection` warning + 跳过该调用 + 不影响其它 calls 抽取（Acceptance Scenario 4）
- 语法错文件（tree-sitter parse 失败）→ skip + warnings 追加 `parse-error` + 不崩溃（Edge Case "语法错误源文件"）
- 复用 `extractor-helpers.mjs` 的 4 个 helper（不重复实现）
- 单文件 < 400 行（超出 → 拆 helper module）

**对应 spec 项**：FR-007 / FR-008 / FR-009 / FR-010 + Edge Cases

**依赖**：T-003、T-004、T-005（必须有 helper + dispatch + clone）

---

### T-007 [US1] 写 java-call-extractor 单测（**先于 T-006 实现**，TDD red 阶段，Codex WARN #3 修订）

**目标**：5+ case 单测，per-file ≥ 95% 覆盖。

**新增文件**：
- `tests/unit/lib/java-call-extractor.test.ts`

**Acceptance criteria**：
- 至少 5 case：basic call / method call / cross-class call / unresolved fallback（反射或语法错）/ overloading edge case（同名不同签名 label-only 视为同 callee）
- `npx vitest run tests/unit/lib/java-call-extractor.test.ts --coverage` → branch + line coverage 单文件 ≥ 95%（per-file threshold T-001 已配）
- 所有 case 用 inline source string + temp dir 跑（避免依赖 baseline workspace），保持 fast + isolated
- 验证 `kind` 字段 + warnings 数组 + truthCalls schema 完整

**对应 spec 项**：FR-018 / FR-019 / FR-020 / SC-001

**依赖**：T-003、T-004、T-005 完成后启动；**先于 T-006 实现**（TDD red 阶段）

---

### T-008 [US1] 跑 HikariCP truth set 生成 + spot-check 5-10% 人工 verify

**目标**：跑 java extractor 生成 `tests/baseline/HikariCP/truth-set.json`，验 ≥ 100 truth calls + 5-10% sample 人工 verify caller / callee / file / line 全准确。

**新增文件**（生成产物）：
- `tests/baseline/HikariCP/truth-set.json`

**Acceptance criteria**：
- 跑 `node scripts/graph-accuracy.mjs --language java --source ~/.spectra-baselines/HikariCP/src/main --write-fixture tests/baseline/HikariCP/truth-set.json` 无运行时崩溃
- fixture 存在 + 含 ≥ 100 条 truth calls（caller / callee / file / line / kind 字段齐全）
- fixture 含 metadata 头：`{baseline: {repo: 'brettwooldridge/HikariCP', commit: '<pinned>', scope: 'src/main', generatedAt, extractorVersion}}`（FR-014）
- 从 truth calls 中**随机抽 5-10% sample**（约 5-10 条），人工对照 HikariCP `src/main` 源码 verify caller / callee / file / line 4 字段 → **100% sample 准确**（spec.md SC-002 / Acceptance Scenario 3）
- spot-check 结果写入 commit message 或临时 verify 笔记（人工 verify 不入仓，但需在 PR 描述中陈述）

**对应 spec 项**：FR-013 / FR-014 / SC-002 + Acceptance Scenarios 1, 3, 4

**依赖**：T-006、T-007（extractor + 单测齐备）

---

**Phase 3 Checkpoint**: User Story 1（Java + HikariCP P1）独立可测——可单独 verify。但 Feature 151d 仍未 unblock（强制 gate 不被弱化）。

---

## Phase 4: User Story 2 - Go + GORM Baseline 入库（Priority: P2）

**Goal**：交付 Go AST extractor + GORM 顶层包 truth set fixture。

**Independent Test**（spec.md US2）：跑 `node scripts/graph-accuracy.mjs --language go --source ~/.spectra-baselines/gorm/<scope> --write-fixture tests/baseline/gorm/truth-set.json`，fixture 含 ≥ 200 truth calls + 1% sample 人工 verify。

### T-009 [US2] clone GORM @ pinned commit + 选定 scope

**目标**：clone GORM 至 `~/.spectra-baselines/gorm/`（helper 脚本已 pin commit），明确 scope = `gorm.io/gorm` 顶层包（即 `~/.spectra-baselines/gorm/*.go` 顶层 .go 文件，不含子包）。

**修改文件**：
- 不修改文件，运行 helper 脚本 + 人工确认 scope 路径
- 实现阶段在 helper 脚本顶部注释说明 GORM scope 选择（FR-016 spec 阶段定死）

**Acceptance criteria**：
- `~/.spectra-baselines/gorm/` 存在 + `cd ~/.spectra-baselines/gorm && ls *.go | wc -l` ≥ 一定数量（按 GORM 实际顶层 .go 文件数量）
- 子包路径（`schema/` / `migrator/` / `logger/` / `callbacks/` / `clause/` / `utils/`）**不在 scope 内**（FR-016 / Codex WARNING #3）
- pinned commit 与 helper 脚本一致

**对应 spec 项**：FR-015 / FR-016

**依赖**：T-002

---

### T-010 [US2] 写 go-call-extractor.mjs

**目标**：实现 Go AST extractor，覆盖 call_expression / selector_expression / generic / interface dispatch / unresolved。

**新增文件**：
- `scripts/lib/go-call-extractor.mjs`：导出 `extractTruthSet(sourceRoot, options)` 接口

**Acceptance criteria**：
- 接口签名严格符合 plan.md Architecture 共享接口契约
- 处理 `call_expression`（callee = identifier / `selector_expression`）
- kind 字段：`method` / `function` / `static` / `unresolved`（按 spec.md FR-006）
- 泛型 / interface 动态 dispatch / `reflect.ValueOf` → 标 `unresolved-dynamic` + warnings + 不影响其它 calls（Acceptance Scenario 3）
- 语法错文件 → `parse-error` + skip
- 复用 `extractor-helpers.mjs`
- 单文件 < 400 行

**对应 spec 项**：FR-006 / FR-008 / FR-009 / FR-010 + Edge Cases

**依赖**：T-003、T-004、T-009

---

### T-011 [US2] 写 go-call-extractor 单测（**先于 T-010 实现**，TDD red 阶段）

**目标**：5+ case，per-file ≥ 95%。

**新增文件**：
- `tests/unit/lib/go-call-extractor.test.ts`

**Acceptance criteria**：
- 至少 5 case：basic call / method call via selector / cross-package call / generic type fallback / dynamic dispatch unresolved
- per-file ≥ 95% coverage
- inline source string + temp dir，fast + isolated

**对应 spec 项**：FR-018 / FR-019 / FR-020 / SC-001

**依赖**：T-010（可并行 [P]）

---

### T-012 [US2] 跑 GORM truth set 生成 + spot-check 1% 人工 verify

**目标**：跑 go extractor 生成 `tests/baseline/gorm/truth-set.json`，验 ≥ 200 truth calls + 1% sample（约 2-3 条）人工 verify。

**新增文件**（生成产物）：
- `tests/baseline/gorm/truth-set.json`

**Acceptance criteria**：
- 无运行时崩溃
- fixture ≥ 200 truth calls
- metadata 头含 `{baseline: {repo: 'go-gorm/gorm', commit: '<pinned>', scope: 'gorm.io/gorm 顶层包（不含子包）', generatedAt, extractorVersion}}`（FR-014 / FR-017）
- 1% 随机 sample 人工 verify caller / callee / file / line → 100% 准确（SC-003）

**对应 spec 项**：FR-016 / FR-017 / SC-003 + Acceptance Scenarios 1, 3

**依赖**：T-010、T-011

---

**Phase 4 Checkpoint**: User Story 2（Go + GORM P2）独立可测。但 Feature 151c 仍未 unblock（强制 gate）。

---

## Phase 5: User Story 3 - TypeScript AST Extractor（Priority: P3）

**Goal**：交付 TS / TSX AST extractor，能跑 hono / self-dogfood truth set 生成。

**Independent Test**（spec.md US3）：跑 `node scripts/graph-accuracy.mjs --language ts --source ~/.spectra-baselines/hono --write-fixture tests/baseline/hono/truth-set.json`，fixture 生成无错；TS extractor 单测 ≥ 95% 覆盖。

### T-013 [US3] 写 ts-call-extractor.mjs

**目标**：实现 TS / TSX AST extractor，覆盖 call_expression / arrow_function / class_method / decorator / new_expression。

**新增文件**：
- `scripts/lib/ts-call-extractor.mjs`：导出 `extractTruthSet(sourceRoot, options)` 接口

**Acceptance criteria**：
- 接口签名严格符合 plan.md Architecture 共享接口契约
- 处理 `call_expression` / `new_expression` / arrow function 内 callee / decorator metadata
- kind 字段：`method` / `function` / `arrow` / `constructor` / `unresolved`（按 spec.md FR-005）
- `eval(...)` / 动态 `import(...)` / `Function` 构造器 → `unresolved-dynamic`
- 处理 `.ts` 与 `.tsx` 双扩展名（tree-sitter-typescript wasm 同时支持，但需在 walkSourceFiles 时把两个扩展都纳入）
- 语法错文件 → `parse-error` + skip
- 复用 `extractor-helpers.mjs`
- 单文件 < 400 行

**对应 spec 项**：FR-005 / FR-008 / FR-009 / FR-010 + Edge Cases

**依赖**：T-003、T-004

---

### T-014 [US3] 写 ts-call-extractor 单测（**先于 T-013 实现**，TDD red 阶段）

**目标**：5+ case，per-file ≥ 95%。

**新增文件**：
- `tests/unit/lib/ts-call-extractor.test.ts`

**Acceptance criteria**：
- 至少 5 case：basic call / method call / arrow function call / generic（callee label erased）/ decorator metadata 或 dynamic import unresolved fallback
- per-file ≥ 95%
- inline source string + temp dir
- 含 `.ts` 与 `.tsx` 双 extension 各一 case

**对应 spec 项**：FR-018 / FR-019 / FR-020 / SC-001

**依赖**：T-013（可并行 [P]）

---

### T-015 [US3] 跑 hono / self-dogfood truth set 生成

**目标**：跑 ts extractor 生成 `tests/baseline/hono/truth-set.json` 与 `tests/baseline/self-dogfood/truth-set.json`，每个 fixture schema 与 java/go 一致。

**新增文件**（生成产物）：
- `tests/baseline/hono/truth-set.json`
- `tests/baseline/self-dogfood/truth-set.json`

**Acceptance criteria**：
- 跑 `node scripts/graph-accuracy.mjs --language ts --source <hono path> --write-fixture <fixture>` 无崩溃，hono / self-dogfood 双 baseline workspace 均 OK
- fixture schema 与 Java/Go fixture key / 嵌套层级 byte-stable（plan.md Architecture 共享接口契约）
- 元数据头含 `{baseline: {repo, commit?, scope, generatedAt, extractorVersion}}`（commit 字段对 self-dogfood 取 spectra 仓库 HEAD；hono 取 baseline workspace HEAD）
- 覆盖 method call / function call / arrow function call / class instantiation 4 类（spec.md US3 Acceptance Scenario 1）

**对应 spec 项**：FR-005 / SC-004 + Acceptance Scenarios 1

**依赖**：T-013、T-014

---

**Phase 5 Checkpoint**: User Story 3（TS extractor P3）独立可测。**P1+P2+P3 三个 user story 现在全部完成 → Feature 151+ 启动 gate 已具备打开条件，但需 Phase 6 quality gate 通过后才正式 unblock**。

---

## Phase 6: Polish & Quality Gate

**Purpose**: 全量 vitest --coverage 验 SC-001 + repo:check / release:check + Codex 对抗审查 + rebase master 准备交付。本 phase 完成后才正式 unblock Feature 151+。

### T-016 [POLISH] 全量 vitest --coverage（4 extractor 全 ≥ 95% per-file）

**目标**：全量跑 `npx vitest run --coverage`，确认 4 个 extractor（python anchor + ts + go + java）单测全 pass + per-file ≥ 95%。

**修改文件**：无（仅运行）

**Acceptance criteria**：
- `npx vitest run --coverage` 零失败
- coverage 报告显示 `scripts/lib/{ts,go,java}-call-extractor.mjs` 单文件 branch + line 覆盖均 ≥ 95%
- python-call-extractor.py 现有覆盖不被破坏（FR-021 向后兼容硬约束）
- 现有 src 单测 + integration 单测全 pass
- 任一 extractor 单文件 < 95% → 必须修复直至 ≥ 95% 才 proceed

**对应 spec 项**：SC-001 / FR-019

**依赖**：T-007、T-011、T-014（所有 extractor 单测齐备）

---

### T-017 [POLISH] npm build + repo:check + release:check

**目标**：跑仓库级合同检查，确认本 Feature 不破坏任何既有合同。

**修改文件**：无（仅运行）

**Acceptance criteria**：
- `npm run build` 零 TS error
- `npm run repo:check` 零失败（CLAUDE.md "仓库级同步约定"）
- `npm run release:check` 零失败（CLAUDE.md "发布合同约定"）——本 Feature 不动 release 字段，应 trivially pass

**对应 spec 项**：plan.md Constitution Check / 仓库级合同

**依赖**：T-016

---

### T-018 [POLISH] Codex 对抗审查（implement 阶段后）

**目标**：本仓库 CLAUDE.local.md 强制 hard gate——commit 前必须由 Codex 对本次改动相关代码执行对抗性审查（adversarial review）。

**执行**：
- 启动 `codex:codex-rescue` 子代理，prompt 含明确对抗指令："对 Feature 150 graph-accuracy.mjs 4 语言扩展 + HikariCP/GORM baseline 入库改动进行对抗性审查（adversarial review）。从'找漏洞'视角出发，假设改动有问题，尝试证伪。"
- 改动信息：传 git diff + 文件清单（plan.md File Manifest）+ 关键 acceptance criteria（spec.md SC-001~SC-005）

**Acceptance criteria**：
- Codex review 输出 critical / warning / info 三档结论
- 对每条 critical 与 warning 做合理性判断：
  - 真实 bug / 设计缺陷 / 边界遗漏 → 提交前修复
  - 风格偏好 / 过度抽象建议 → 记录原因可写在 commit message 备注
- 修复完成后，**重新跑 T-016 + T-017** 确认零失败，再 proceed 到 T-019
- review 笔记 + 处置结论保留在 PR 描述或临时 verify 文件中（不入仓）

**对应 spec 项**：CLAUDE.local.md "提交前 Codex 对抗审查"（hard gate）

**依赖**：T-016、T-017

---

### T-019 [POLISH] rebase master + 准备 deliverable report

**目标**：按 CLAUDE.md "分支同步与交付约定" rebase 最新 master，准备 deliverable report。

**修改文件**：无（仅 git ops）

**Acceptance criteria**：
- `git fetch origin master:master` → `git rebase master` → 解决冲突（如有）
- rebase 后重跑 T-016 + T-017 + T-018 全 pass（rebase 改写历史可能引入新冲突或 regression）
- deliverable report 含：
  - 4 个 extractor 文件路径 + per-file coverage 数字
  - 2 个 baseline fixture（HikariCP / GORM）路径 + truth calls 数量
  - hono / self-dogfood truth set 路径
  - 现有 micrograd / nanoGPT Python 流程 byte-stable 证明（diff 输出）
  - Codex review 结论 summary
  - **Feature 151+ unblock 声明**：P1+P2+P3 全部完成 + quality gate 通过 → 151+ 全部 sub-features unblock
- 不在本 task 范围：push origin master（破坏性操作需用户单独授权，CLAUDE.md "交付到 master"）

**对应 spec 项**：CLAUDE.md "分支同步与交付约定" / spec.md "强制 gate 含义"

**依赖**：T-018

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: 无依赖，立即开始
- **Phase 2 (Foundational)**: 依赖 Phase 1，BLOCKS 所有 user story
- **Phase 3 (US1 P1)**: 依赖 Phase 2 完成
- **Phase 4 (US2 P2)**: 依赖 Phase 2 完成（与 Phase 3 可并行）
- **Phase 5 (US3 P3)**: 依赖 Phase 2 完成（与 Phase 3、4 可并行）
- **Phase 6 (Polish)**: 依赖 Phase 3 + Phase 4 + Phase 5 全部完成（**强制 gate**：P1+P2+P3 任一未完成不允许进入 Phase 6 quality gate）

### Task Dependencies（关键路径）

```text
T-001 ─┐
       ├── T-003 ─┬─ T-006 ─┬── T-007 ─┐
T-002 ─┤         │         │         ├── T-008 ─┐
       ├── T-004 ─┤         │         │         │
       │         │         │         │         │
       │         ├─ T-010 ─┬── T-011 ─┐         │
T-005 ─┘         │         │         ├── T-012 ─┤
T-009 ───────────┘         │         │         │
                            │         │         │
                            ├─ T-013 ─┬── T-014 ─┐
                            │         │         ├── T-015 ─┤
                            │         │         │         │
                                                          │
                                                          ├──────► T-016 → T-017 → T-018 → T-019
                                                          │
P1 + P2 + P3 全部完成（强制 gate）─────────────────────────┘
```

### Within Each User Story

**TDD 严格顺序（Codex WARNING #3 修订：移除测试任务 [P] 标记，确保 test-first gate）**：

- 写单测先行（T-007 / T-011 / T-014）→ 单测 fail → 写实现（T-006 / T-010 / T-013）→ 单测 pass
- 测试任务 **不**带 [P] 标记，与对应实现任务 sequential（不允许跟实现并行）
- baseline 生成（T-008 / T-012 / T-015）必须在 extractor + 单测齐备后跑

### Parallel Opportunities（修订）

- **Phase 1**：T-001 + T-002 全部 [P]（不同文件，互不依赖）
- **Phase 2**：T-003 与 T-004 [P]（不同文件）
- **Phase 3-5 跨 story 并行**：3 个 user story 在 Phase 2 完成后 **可完全并行推进**（不同语言、不同文件、无 cross-story 依赖）
- **同 story 内 sequential**：T-007 → T-006（test-first），同样 T-011 → T-010、T-014 → T-013
- **Phase 6**：严格顺序（T-016 → T-017 → T-018 → T-019）

### 跨 Phase Codex 审查（CLAUDE.local.md 2026-05-05 新约定，Codex WARNING #4 修订）

按 CLAUDE.local.md "Spec-Driver Workflow 阶段性 Codex 对抗审查" 约定，每个 phase 完成后必须跑 Codex 审查再进下一阶段：

- **Phase 1 完成后**：Codex review T-001/T-002 配置改动（vitest config + clone helper），critical 修复后才进 Phase 2
- **Phase 2 完成后**：Codex review T-003/T-004 dispatch + helpers，critical 修复后才进 Phase 3-5
- **Phase 3 完成后（每个 user story 单独）**：Codex review 实现 + 单测 + truth set，critical 修复后才进下一个 phase
- **Phase 4 / Phase 5 完成后**：同 Phase 3 处理
- **Phase 6 完成后**：T-018 是最终 Codex 审查（覆盖整个 implement → verify 链路），critical 修复后才 T-019 deliverable report

跨 phase 审查不计入 19 个 task，是 process-level gate。每次 review 通过 Agent tool 调用 `codex:codex-rescue`（参见 CLAUDE.local.md 调用约定）。

---

## Implementation Strategy

### MVP First（User Story 1 优先）

1. 完成 Phase 1 + Phase 2
2. 完成 Phase 3（US1 P1：Java + HikariCP）→ critical risk 早暴露
3. **STOP and VALIDATE**：跑 HikariCP truth set spot-check 5-10%
4. 然后并行推进 Phase 4 + Phase 5
5. Phase 6 quality gate 全部通过 → unblock Feature 151+

### Incremental Delivery（如需中间交付）

1. Phase 1 + 2 → Foundation ready
2. Phase 3（US1）→ Java extractor + HikariCP fixture 单独 deploy/verify（**仍未 unblock 151d**，强制 gate）
3. Phase 4（US2）→ Go extractor + GORM fixture（仍未 unblock）
4. Phase 5（US3）→ TS extractor + hono/self-dogfood fixture
5. Phase 6 → 全部 pass → **正式 unblock Feature 151+**

### Parallel Team Strategy

如有多 dev：
1. Team 完成 Phase 1 + Phase 2
2. Phase 2 完成后：
   - Dev A：Phase 3（Java + HikariCP）
   - Dev B：Phase 4（Go + GORM）
   - Dev C：Phase 5（TS + hono/self-dogfood）
3. 三 phase 收口后 Dev D / Tech Lead 推 Phase 6 quality gate

---

## Notes

- **[P] 标记**：不同文件 + 无依赖，可并行
- **[Story] 标记**：US1 / US2 / US3 / FOUND / SETUP / POLISH，便于追溯
- 每个 user story 独立可完成 + 独立可测，但**强制 gate 不被弱化**——P1 单独完成 ≠ unblock 151d
- TDD 严格：先单测 fail → 实现 → pass
- commit 频率：每个 task 完成或一组逻辑相关 task 完成后 commit；提前完成的 task 不 batch commit 至 Phase 末尾（便于 Codex review 粒度）
- Codex 对抗审查（T-018）是 hard gate（CLAUDE.local.md 约定），不允许 bypass
- 不引入新 dep（spec.md "Out of Scope" #4）；不修改 src/（spec.md "Out of Scope" #2）
- 现有 Python 流程 byte-stable 是硬约束（FR-021 / SC-005），任何分派 logic 改动必须验证

---

## 关键引用

- Spec：[`spec.md`](./spec.md)
- Plan：[`plan.md`](./plan.md)
- 设计文档：[`docs/design/spectra-mcp-evolution.md`](../../docs/design/spectra-mcp-evolution.md)
- Constitution：[`.specify/memory/constitution.md`](../../.specify/memory/constitution.md)
- 仓库级约定：`CLAUDE.md`（分支同步、release contract、repo maintenance）+ `CLAUDE.local.md`（baseline 测试、Codex 审查）
