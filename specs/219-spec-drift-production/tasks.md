# 任务分解：Spec Drift 首次生产发布（M9 轨道 C）

**Feature**: `219-spec-drift-production`
**输入**：[spec.md](./spec.md)（需求唯一事实源，16 FR / 8 SC / 11 态状态矩阵）、[plan.md](./plan.md)（技术方案，已收口 Codex 7 CRITICAL + 6 WARNING）
**组织方式**：严格按 plan §16 的 **C1 → C2 → C3** 三阶段推进，每阶段独立可验证；C1/C2 对应 US1+US2+US3，C3 对应 US4。
**TDD 铁律**：每个功能模块任务 MUST 拆成"先写失败测试（红）→ 再实现使其通过（绿）"的配对，测试任务在前、实现任务紧随其后并显式依赖测试任务。跨模块的治理/回归类测试（导入边界、11 态矩阵、repo:check 回归）作为独立任务列出，其"红"态天然来自"被测源文件尚未就绪"，实现任务完成后转绿——这不违反 TDD 精神，只是红绿判据是"文件/字段是否存在"而非"函数逻辑是否正确"。

---

## 护栏（贯穿全部任务，回归红线）

| 约束 | 具体要求 |
|------|---------|
| 零 LLM | drift link/check/unlink 全程不 import 任何 LLM provider（`@anthropic-ai/sdk`/`openai`/`@google/generative-ai` 等），见 T019 |
| 图 schema 不变，无逃生口 | 不改 `src/knowledge-graph/**` 输出格式；per-symbol 指纹只存在于 `.specify/spec-drift.lock.json`，MUST NOT 挂载到 knowledge-graph 节点 |
| 只读复用 | 不修改 `src/core/ast-analyzer.ts`、`src/core/skeleton-hash.ts`、`src/knowledge-graph/**`；仅通过动态 `import()` dist 编译产物只读引用 |
| 与 F220 disjoint | 不碰 `src/batch/**` |
| 写入面限 SC-008 allowlist | `scripts/spec-drift-*.mjs`、`scripts/lib/spec-drift-*.mjs`、`scripts/lib/repo-maintenance-core.mjs`、`scripts/repo-check.mjs`、`package.json`、`.specify/spec-drift.lock.json`（及测试 fixture）、`tests/**`、`specs/219-*/**` |
| 提交方式 | 显式路径提交（`git add scripts/spec-drift-cli.mjs scripts/lib/spec-drift-*.mjs ...`），禁 `git add -A`；排除自动再生的 `specs/src.spec.md` |
| 图质量门零回归 | F217 六指标（duplicate/orphan/contains/dangling/ignored/freshness）逐项 check id 断言全绿，见 T026 |
| repo:check 零回归 | 既有 12 检查族 id/结果不变，`spec-drift` 作为第 13 族追加，见 T026 |
| Codex 对抗审查 | 每完成一个 phase（本文件对应 tasks 阶段）commit 前，先跑 `codex:codex-rescue` 子代理做对抗性审查，处置 critical/warning 后再继续（项目级约定，不在此文件重复列为独立 task，但每阶段收尾任务隐含此步骤） |

---

## Phase 1: Setup（项目初始化，无 User Story 归属）

- [x] T001 [P] 建立 fixture 目录骨架：创建 `tests/fixtures/spec-drift/` 及子目录占位（`.gitkeep`），子目录含 `fresh-comment-only/`、`fresh-jsdoc-only/`、`fresh-format-only/`、`fresh-syntactic-noise/`、`stale-identifier/`、`stale-literal/`、`stale-control-flow/`、`stale-unary-prefix/`、`stale-unary-postfix/`、`stale-decl-kind/`、`stale-overload-second/`、`sibling-symbol-unaffected/`、`fingerprint-version-mismatch/`、`lock-corrupt-*/`、`member-rejected/`、`reexport-unsupported/`、`unsupported-language/`、`parser-degrade/`、`graph-unavailable/`、**`stale-using-vs-var/`**、**`stale-await-using/`**、**`lang-mts-cts/`**（后三项为 Codex round-2 新增：N-1 CRITICAL 漏报面 + N-3 扩展名漏列面）
  **验收标准**：目录结构存在，`git status` 可见新增空目录占位文件；不含任何逻辑代码
  **对应 FR/SC**：无（测试基础设施）

- [x] T002 [P] 准备 C1 端到端公共 fixture：在 `tests/fixtures/spec-drift/e2e/` 下放置一个真实可编译的 TS 源文件（含至少一个 top-level 具名导出函数）与一份对应的引用清单 `manifest.json`（`{ id, ref, docPath, line }[]`，`ref` 为 `<relPath>::<symbolName>` 形式）
  **验收标准**：`node -e "require('ts-morph')"` 能正常解析该源文件；manifest JSON 校验通过（无语法错误）
  **对应 FR/SC**：FR-001、SC-006

---

## Phase 2: Foundational（阻塞性前置依赖，C1/C2/C3 共享）

- [x] T003 [TEST][P] 编写 `scripts/lib/spec-drift-dist-loader.mjs` 单测 `tests/unit/spec-drift-dist-loader.test.ts`：覆盖 (a) 目标 dist 文件不存在 → 返回 `{ ok:false, reason:'dist-missing' }`；(b) 目标文件存在但 import 时抛语法错误 → 返回 `{ ok:false, reason:'dist-load-failed' }`（用临时写入非法语法的假 dist 文件模拟）；(c) 传递依赖加载失败 → 同上 `dist-load-failed`；(d) 正常加载 → 返回 `{ ok:true, mod }`
  **依赖**：T001
  **验收标准**：测试文件存在且执行失败（模块 `spec-drift-dist-loader.mjs` 尚不存在），红态确认
  **对应 FR/SC**：FR-011（W-1 全部失败模式覆盖）

- [x] T004 实现 `scripts/lib/spec-drift-dist-loader.mjs`：`loadDistModule(projectRoot, relDistPath)`，`existsSync` 检查 + `try/catch` 包裹 `await import(pathToFileURL(distPath).href)`，捕获全部失败模式（语法错误/传递依赖失败/初始化抛错）统一归为 `dist-load-failed`
  **依赖**：T003
  **验收标准**：T003 全部用例转绿；`npx vitest run tests/unit/spec-drift-dist-loader.test.ts` 零失败
  **对应 FR/SC**：FR-011

- [x] T005 [TEST][P] 编写 `scripts/lib/spec-drift-lock-io.mjs` 单测 `tests/unit/spec-drift-lock-io.test.ts`：覆盖 (a) lock 文件不存在 → `drift link` 首次运行自动创建（`{schemaVersion, anchors:[]}`）；(b) `anchors` 空数组视为非损坏；(c) 原子写（临时文件+rename，写入后无残留 `*.tmp-*`）；(d) 检测到残留 `*.tmp-*` → 报错拒绝继续；(e) 非法 JSON → `lock-corrupt`；(f) 顶层缺 `schemaVersion` 或 `anchors` 非数组 → `lock-corrupt`；(g) `schemaVersion` 与当前工具 `LOCK_SCHEMA_VERSION` 不兼容 → `lock-corrupt`；(h) `anchors` 任一条目缺 FR-003 十项必需字段（`id/ref/docPath/line/symbolId/fingerprint/fingerprintVersion/normalizationProfile/resolvedFrom/matchKind`）中任一 → `lock-corrupt`；(i) 条目字段类型不符 → `lock-corrupt`；(j) 条目含被禁字段（`status`/`stale`/`fresh`）→ `lock-corrupt`
  **依赖**：T001
  **验收标准**：测试文件存在且执行失败（`readLock`/`writeLockAtomic` 尚未实现），红态确认
  **对应 FR/SC**：FR-003、FR-015

- [x] T006 实现 `scripts/lib/spec-drift-lock-io.mjs`：导出 `readLock(lockPath)`（返回 `{corrupt, reason?, anchors}` 或正常结构）、`writeLockAtomic(lockPath, data)`（临时文件+rename）、`LOCK_SCHEMA_VERSION` 常量、必需字段全集校验（十项）+ 被禁字段检测 + 残留 `*.tmp-*` glob 检测
  **依赖**：T005
  **验收标准**：T005 全部用例转绿；`npx vitest run tests/unit/spec-drift-lock-io.test.ts` 零失败
  **对应 FR/SC**：FR-003、FR-015

---

## Phase 3 — C1 阶段：`drift link` / `drift check` / `drift unlink` 生产 CLI（US1 + US2，Priority P1）

**目标**：把 F189 prototype 的建锚/刷新/删锚/检测能力迁移为生产 CLI + lock 持久化，指纹算法在此阶段仍是"过渡态"（迁移 prototype 的源切片+空白归一化，`normalizationProfile: "source-slice-whitespace-v1"`），canonical AST 语义留待 C3。

**独立测试**：对含真实引用条目的清单文件跑 `drift link`，验证 lock 新增记录（含 `symbolId`+`fingerprint`+`fingerprintVersion`+`matchKind`，无 `status` 字段）；`--refresh` 验证指纹按当前代码重算；`drift unlink <id>` 验证精确删除。`drift check` 验证精确匹配（不重新 fuzzy）、orphaned、sibling 不误伤、graph-unavailable 降级、混合优先级 exitCode。

### Resolve（建锚解析）

- [x] T007 [P] 准备 resolve 单测所需 fixture：在 `tests/fixtures/spec-drift/resolve/` 下放置覆盖 exact/partial-name/levenshtein 命中、ambiguous（同文件多候选）、unresolved（裸 symbol 名/文件不存在）、member（`Class.method` 形式引用）、非 TS/JS 语言（`.py` 文件）各态的源文件 + manifest 条目
  **依赖**：T001
  **验收标准**：每类 fixture 至少一组 before/after 或独立源文件，人工核对与 spec Edge Cases 逐项对应
  **对应 FR/SC**：FR-001、FR-009(a)(d)

- [x] T008 [TEST] 编写 `scripts/lib/spec-drift-resolve.mjs` 单测 `tests/unit/spec-drift-resolve.test.ts`（基于 T007 fixture）：exact/partial-name/levenshtein 命中各自 `matchKind` 正确；ambiguous 返回 top-3 候选、不自动绑定；unresolved（裸 symbol 名与文件不存在两种子情形）；`Class.method` member 引用 MUST 被拒绝，返回 `fingerprint-unavailable` + reason "member 粒度锚点本期不支持，请锚定 top-level symbol"；非 TS/JS 语言引用 → `unsupported-language`，MUST NOT 有 fallback 指纹路径；`drift link --refresh` 重新解析出 ambiguous/unresolved 时 MUST 保留刷新前最后一次已知良好的 `symbolId`/`fingerprint`（US1 Acceptance Scenario 5, W1）
  **依赖**：T007
  **验收标准**：测试执行失败（`spec-drift-resolve.mjs` 未实现），红态确认
  **对应 FR/SC**：FR-001、FR-002、FR-009(a)(d)、US1-AS5

- [x] T009 实现 `scripts/lib/spec-drift-resolve.mjs`：`parseManifest(path)`（JSON/YAML 解析）、`resolveReference(entry, projectRoot)`——按 plan §6.4 流程（`parseCanonicalSymbolId` 解析 file-qualified ref → 按 filePart 分组去重调用一次 `analyzeFiles` → `buildMinimalGraph()`（迁移自 F189 prototype `resolve.ts::buildGraphFromFiles`）构造仅含目标文件的最小 GraphJSON → 传入动态 import 的 `canonicalizeSymbolId`/`resolveSymbolFuzzy` 完成解析）；member（含 `.` 的 symbolId）显式拒绝；非 TS/JS 扩展名显式标 `unsupported-language`，不做 fallback；`--refresh` 分支保留刷新前基线（W1）
  **依赖**：T008、T004（依赖 dist-loader）
  **验收标准**：T008 全部用例转绿；`npx vitest run tests/unit/spec-drift-resolve.test.ts` 零失败
  **对应 FR/SC**：FR-001、FR-002、FR-009(a)(d)、US1-AS5

### Fingerprint（C1 过渡态，迁移 prototype）

- [x] T010 [TEST] 编写 `scripts/lib/spec-drift-fingerprint.mjs` 单测 `tests/unit/spec-drift-fingerprint.test.ts`（C1 过渡态范围）：验证同一 symbol 未改动时指纹稳定不变；任意字节级改动（含格式化）产生不同指纹（此阶段**不要求** CL-3 的"注释/JSDoc/格式化 → fresh"语义，该语义是 C3 验收目标，T030 会重写并扩展本测试）；`NORMALIZATION_PROFILE` 常量值为 `"source-slice-whitespace-v1"`
  **依赖**：T001
  **验收标准**：测试执行失败（模块未实现），红态确认
  **对应 FR/SC**：FR-003、FR-009(b)（版本字段声明）

- [x] T011 实现 `scripts/lib/spec-drift-fingerprint.mjs`（过渡版）：迁移 F189 prototype `fingerprint.ts` 的"symbol 源切片 + 逐行空白归一化"逻辑，导出 `computeCanonicalFingerprint`（此阶段内部实现为过渡算法）、`FINGERPRINT_VERSION='1'`、`NORMALIZATION_PROFILE='source-slice-whitespace-v1'`
  **依赖**：T010
  **验收标准**：T010 全部用例转绿
  **对应 FR/SC**：FR-003、FR-009(b)

### Check（精确匹配 + 状态矩阵）

- [x] T012 [P] 准备 check 单测 fixture：`tests/fixtures/spec-drift/sibling-symbol-unaffected/`（同文件两 symbol，改动 A 不影响锚定 B）、`tests/fixtures/spec-drift/graph-unavailable/`（构造场景：临时移除/改名 `dist/core/ast-analyzer.js` 路径引用，及写入语法错误的假 dist 模块两种子场景）、`tests/fixtures/spec-drift/reexport-unsupported/`（`export { foo } from './other'` 形态）、`tests/fixtures/spec-drift/parser-degrade/`（如 `export const foo = ;` 语法错误但 ts-morph 错误恢复不抛异常）、`tests/fixtures/spec-drift/lock-corrupt-*/`（若 T005 尚未覆盖的边界补齐）
  **依赖**：T001
  **验收标准**：每个 fixture 目录含最小可复现场景文件，注释说明触发的目标状态
  **对应 FR/SC**：FR-004、FR-009(a)、FR-011、FR-012、SC-002、SC-003

- [x] T013 [TEST] 编写 `scripts/lib/spec-drift-check.mjs` 单测 `tests/unit/spec-drift-check.test.ts`（基于 T012 fixture）：精确匹配（构造"同名新 symbol"场景，验证不被误洗成 fresh，MUST NOT 重新 fuzzy 解析）；orphaned（文件整体删除 / symbol 改名消失两种子场景）；同文件他 symbol 变动不误伤本锚（SC-002）；`graph-unavailable`（report 级，`degraded:true`，两种子场景：dist-missing 与 dist-load-failed）；`parser-degrade` 按 §9.1 步骤 4 新判据（语法 diagnostic 非空 或 parser 回退 tree-sitter）构造，**MUST NOT** 依赖 `analyzeFiles` 抛异常；`locateExportedNodes` 三类失败（`node-locate-failed`/`node-locate-ambiguous`/`reexport-unsupported`）各自映射 `fingerprint-unavailable`；**混合优先级专项**：`graph-unavailable` + `stale` 共存时整体 exitCode MUST 为 2（而非 1）
  **依赖**：T012、T009（resolve 提供的 symbolId 供 check 消费）、T011（过渡态 fingerprint）
  **验收标准**：测试执行失败（`spec-drift-check.mjs` 未实现），红态确认
  **对应 FR/SC**：FR-004、FR-005、FR-009(a)、FR-011、FR-012、SC-002、SC-003

- [x] T014 实现 `scripts/lib/spec-drift-check.mjs`：按 plan §9.1 流程——语言判定（规范化扩展名，MUST NOT 用 `startLine===undefined` 判据）→ 文件存在性 → `analyzeFiles` 异常分流（`ENOENT`→orphaned，其他→parser-degrade）→ 显式 parser-health 判定（tree-sitter fallback 或语法 diagnostic 非空→parser-degrade）→ 逐锚 `locateExportedNodes` 三元组匹配（exportName+startLine+sourceFile）→ 指纹比对（fresh/stale）；导出 `checkOneAnchor`、`computeReportExitCode`（严格按混合优先级 5 层求值，不按数组出现顺序）
  **依赖**：T013
  **验收标准**：T013 全部用例转绿；`npx vitest run tests/unit/spec-drift-check.test.ts` 零失败
  **对应 FR/SC**：FR-004、FR-005、FR-009(a)、FR-011、FR-012

### CLI 骨架

- [x] T015 [TEST] 编写 `scripts/spec-drift-cli.mjs` 单测 `tests/unit/spec-drift-cli.test.ts`：参数解析（`link`/`check`/`unlink` 子命令 dispatch、`--help` 打印用法后 exit 0、`--format json` 输出遵循 §状态矩阵字段的 `DriftReport`/操作摘要结构、`--lock`/`--project-root` 覆盖默认路径）；三命令退出码分别遵循 plan §10.2 退出码表（0/1/2/3 各态映射，`link`/`unlink` 不使用数值 1）
  **依赖**：T001
  **验收标准**：测试执行失败（`spec-drift-cli.mjs` 未实现），红态确认
  **对应 FR/SC**：FR-014

- [x] T016 实现 `scripts/spec-drift-cli.mjs`：薄壳，解析子命令与参数后调用 `spec-drift-core.mjs` 的 `linkReferences`/`checkAnchors`/`unlinkAnchor`，格式化输出（人类可读 + `--format json`），按状态矩阵映射进程 `exitCode`；导出 `main()` 供 e2e 测试以"公开入口"方式调用
  **依赖**：T015、T009、T014、T006
  **验收标准**：T015 全部用例转绿
  **对应 FR/SC**：FR-014

- [x] T017 在 `package.json` 新增 3 条 script：`"drift:link": "node scripts/spec-drift-cli.mjs link"`、`"drift:check": "node scripts/spec-drift-cli.mjs check"`、`"drift:unlink": "node scripts/spec-drift-cli.mjs unlink"`
  **依赖**：T016
  **验收标准**：`npm run drift:check -- --help` 可执行且输出用法说明，退出码 0
  **对应 FR/SC**：FR-014

### C1 阶段验证

- [x] T018 [TEST] 编写 C1 端到端测试 `tests/integration/spec-drift-cli-e2e.test.ts`：**MUST 经 `npm run drift:*` 执行**（`spawnSync('npm', ['run','drift:check','--','--format','json'], {cwd: tmpRepo})`），而非仅 spawn 脚本路径。跑通步骤：(1) 准备临时目录+manifest+T002 fixture 源文件；(2) `drift link --manifest ...` → lock 新增记录、退出码 0；(3) 同 `id` 未加 `--refresh` 重复 `link` → 拒绝且退出码非 0（FR-002）；(4) `drift link --refresh` → 指纹按当前代码重算；(5) `drift check` → fresh（此阶段为过渡态语义，仅验证"未改动→fresh"）、退出码 0；(6) 修改源文件标识符 → `drift check` → stale、退出码 1；(7) `drift unlink <id>` → 记录移除、退出码 0；(8) `--help` 与 `--format json` 分别验证
  **依赖**：T017、T014、T009
  **验收标准**：全部步骤断言通过，`npx vitest run tests/integration/spec-drift-cli-e2e.test.ts` 零失败
  **对应 FR/SC**：FR-002、FR-014、SC-006

- [x] T019 [TEST][P] 编写零 LLM 导入边界测试 `tests/unit/spec-drift-no-llm-import.test.ts`：**两层**——L1 直接导入：静态读取全部 `scripts/spec-drift-*.mjs`/`scripts/lib/spec-drift-*.mjs` 源码，正则断言不含 `@anthropic-ai/sdk`/`openai`/`@google/generative-ai` 等 provider 包字面量；L2 传递闭包：从四个动态 import 入口（`dist/core/ast-analyzer.js`、`dist/adapters/index.js`、`dist/knowledge-graph/query-helpers.js`、`dist/knowledge-graph/relativize.js`）递归静态解析 `import`/`export from` 语句构建可达模块集，断言集合中无 provider 包引用；测试注释显式标注"L2 是静态可达性分析，不覆盖运行时 eval/字符串拼接构造的动态 import"（诚实边界）
  **依赖**：T016（源文件需已全部存在才能完整扫描）
  **验收标准**：`npx vitest run tests/unit/spec-drift-no-llm-import.test.ts` 零失败
  **对应 FR/SC**：FR-013、SC-007(a)

- [x] T020 C1 阶段收尾验证（非新增代码，验证性任务）：跑 `npx vitest run`（全部 C1 相关测试文件）确认零失败；跑 `git diff --stat $(git merge-base master HEAD) HEAD -- src/knowledge-graph src/core/skeleton-hash.ts src/core/ast-analyzer.ts src/panoramic src/batch` 确认为空（SC-008）；人工核对 US1/US2 全部 Acceptance Scenario 中"除 C3 canonical AST 语义外"的条目均已验证（US2-AS1 的完整 fresh/stale 语义留待 C3 收尾时补验）；触发 Codex 对抗审查（`codex:codex-rescue`）后再 commit（显式路径，禁 `git add -A`）
  **依赖**：T018、T019、T009、T014
  **验收标准**：三项检查全部通过并记录于 commit message
  **对应 FR/SC**：FR-010、SC-007(a)、SC-008

---

## Phase 4 — C2 阶段：`repo:check` 集成（US3，Priority P1）

**目标**：drift 检测作为第 13 检查族接入 `validateRepository`，`await` 全链路不静默丢失异步结果；默认 warn、`--strict` 提升为 error、`lock-corrupt` 恒 fail。

**独立测试**：构造含 stale 锚的仓库状态跑 `npm run repo:check`，验证 `checks` 数组含 `spec-drift` 记录（证明未被漏 `await` 静默跳过）、整体 `status` 为 `warn`；同场景加 `--strict` 后 `status` 变 `fail`；lock 损坏场景不论是否 `--strict` 都 `fail`。

- [ ] T021 [P] 准备 repo:check 回归基线 fixture：(a) 记录当前 `npx vitest run tests/integration/repo-maintenance-sync-check.test.ts`（或等价既有测试）中 12 检查族的 `id` 集合与 `result` 快照，作为 T026 的回归对比基线；(b) 构造一个临时仓库 fixture（含 1 条 stale 锚的 lock 文件 + 对应源文件）供 T022/T026/T027 复用
  **依赖**：T014（check 逻辑）、T006（lock-io）
  **验收标准**：基线快照文件存在，人工核对与当前 `repo:check` 实际输出一致
  **对应 FR/SC**：SC-007(c)

- [ ] T022 [TEST] 编写 `validateSpecDrift` 三段式契约单测 `tests/unit/spec-drift-core-validate.test.ts`：`strict` 参数透传正确（`false`→warn，`true`→error）；`fresh` 不受 `strict` 影响（全 fresh 时 `--strict` 仍 `pass`，FR-007）；`lock-corrupt` 恒 `fail` 不受 `strict` 影响；**防静默 no-op 测试（FR-008 核心）**：构造含 1 条 stale 锚的 lock fixture，调用真实 `await validateRepository(projectRoot)`，断言 `checks.some(c => c.id.startsWith('spec-drift'))` 且该记录的 `warnings`/`errors` 内容非空数组（而非仅断言整体 `status`）——测试注释须说明"若未来有人误删 `await`，`aggregateValidation` 拿到未展开的 Promise 对象，`result.warnings ?? []` 会因 Promise 无 `warnings` 属性退化为空数组，本测试应真实失败"
  **依赖**：T021、T006
  **验收标准**：测试执行失败（`validateSpecDrift` 未实现），红态确认
  **对应 FR/SC**：FR-006、FR-007、FR-008

- [ ] T023 实现 `scripts/lib/spec-drift-core.mjs::validateSpecDrift({projectRoot, strict})`：三段式契约（照抄 F217 第 12 族模式）——(1) lock-corrupt 分支恒 `fail`；(2) 空锚分支 `pass`；(3) **先处理 report 级状态（`graph-unavailable`）再处理 anchor 级**（C-5 收口，不得遍历 anchors 导致 report 级状态被静默吞掉，也不得伪造进每条 anchor）；(4) anchor 级严重度按 `strict` 计算，子 `checkResult` 随 `strict` 变化（W-3，不恒为 `warn`）
  **依赖**：T022、T014
  **验收标准**：T022 全部用例转绿；`npx vitest run tests/unit/spec-drift-core-validate.test.ts` 零失败
  **对应 FR/SC**：FR-006、FR-007、FR-008

- [ ] T024 改动 `scripts/lib/repo-maintenance-core.mjs`：新增 `import { validateSpecDrift } from './spec-drift-core.mjs'`；`validateRepository` 签名新增可选第二参数 `options={}`（默认值保证向后兼容，不传时行为与改动前完全一致）；在既有 12 族之后追加 `aggregateValidation('spec-drift', await validateSpecDrift({projectRoot: resolvedRoot, strict}), warnings, errors, checks)`（**严格 `await`**，不留旁路）
  **依赖**：T023
  **验收标准**：`validateRepository(projectRoot)`（不传 options）行为与改动前完全一致（既有测试零回归）；传入 `{strict:true}` 时行为符合 T022 断言
  **对应 FR/SC**：FR-006

- [ ] T025 改动 `scripts/repo-check.mjs`：手动解析 `--strict`（`process.argv.slice(2).includes('--strict')`，不改共享 `parseCommonProjectArgs`，因其位于 `plugins/spec-driver/`，不在 SC-008 allowlist），透传给 `await validateRepository(args.projectRoot, {strict})`
  **依赖**：T024
  **验收标准**：`npm run repo:check -- --strict` 可执行，`--strict` 标志确实影响输出
  **对应 FR/SC**：FR-006

- [ ] T026 [TEST] 编写 `repo:check` 集成回归测试 `tests/integration/spec-drift-repo-check-regression.test.ts`：跑真实 `validateRepository`，断言 (a) F217 六个 check id（duplicate/orphan/contains/dangling/ignored/freshness）**逐项** `result` 为 `pass`（不接受"整体 exit 0"作为代理证据）；(b) 既有 12 族 check id 集合与 result 与 T021 基线快照**逐项一致**；(c) 第 13 族（`id` 含 `spec-drift`）确实出现在 `checks` 中且不影响前 12 族
  **依赖**：T021、T025
  **验收标准**：三项断言全部通过；此测试红态来自"改动前尚无第 13 族"，T025 完成后转绿
  **对应 FR/SC**：SC-007(b)(c)

- [ ] T027 [TEST] 编写 US3 全部 5 条 Acceptance Scenario 端到端验证 `tests/integration/spec-drift-repo-check-modes.test.ts`：(1) 存在非 fresh 锚、lock 完好 → 默认模式整体 `status=warn`，`checks` 含 `spec-drift` 记录且 warnings 含具体锚信息；(2) 同场景 `--strict` → `status=fail`；(3) lock 损坏 → 默认与 `--strict` 均 `status=fail`；(4) 无锚或全 fresh → `spec-drift` 检查族贡献 `pass`，不产生噪声；(5) 遗漏 `await` 回归防线（复用 T022 的防静默断言逻辑，此处从 `repo:check` CLI 层面再验证一次）
  **依赖**：T025、T023
  **验收标准**：`npx vitest run tests/integration/spec-drift-repo-check-modes.test.ts` 零失败
  **对应 FR/SC**：FR-006、FR-007、FR-008、SC-004

- [ ] T028 C2 阶段收尾验证：跑 `npx vitest run`（全部 C1+C2 测试）确认零失败；跑 `npm run repo:check` 与 `npm run repo:check -- --strict` 人工核对输出符合预期；确认 SC-008 allowlist 内 `git diff --stat` 只涉及 `scripts/lib/repo-maintenance-core.mjs`、`scripts/repo-check.mjs`、`scripts/lib/spec-drift-*.mjs` 等既定文件；触发 Codex 对抗审查后再 commit
  **依赖**：T026、T027
  **验收标准**：全部检查通过并记录于 commit message
  **对应 FR/SC**：SC-004、SC-007(c)、SC-008

---

## Phase 5 — C3 阶段：normalized symbol AST fingerprint（US4，Priority P2）

**目标**：把 C1 过渡态指纹（源切片+空白归一化）升级为 parser-specific canonical AST fingerprint——归一化 TypeScript/JavaScript AST 结构与 token，剥离全部注释/JSDoc/格式差异。

**独立测试**：构造 (a) 仅改注释/JSDoc/格式化 fixture → 验证 `fresh`；(b) 改标识符/字面值/运算符/控制结构 fixture → 验证 `stale`；(c) member 引用 → `drift link` 显式拒绝；(d) 非首发语言引用 → `unsupported-language`。

- [ ] T029 [P] 准备 C3 canonical AST fixture 全集（在 T001 已建骨架基础上补充内容）：`fresh-comment-only/`（before/after 仅行内/块注释差异）、`fresh-jsdoc-only/`（仅前导 JSDoc 差异）、`fresh-format-only/`（仅缩进/换行/空格差异）、`fresh-syntactic-noise/`（**四组子场景**：`a+b`→`(a+b)` 加括号、`"x"`→`'x'` 引号风格、`1000`→`1_000` 数字分隔符、**`1000n`→`1_000n` BigInt 分隔符**（N-2：BigIntLiteral 此前未归一），均 MUST fresh）、**`stale-using-vs-var/`**（`var x=a()` vs `using x=a()`）、**`stale-await-using/`**（`using x=a()` vs `await using x=a()`）（N-1 CRITICAL：实测 `using` flags=4 会落到 `var` 分支产生**完全相同序列**、`await using` flags=65542 含 Const bit 被误标 `const`；资源释放语义变化不得判 fresh）、**`lang-mts-cts/`**（`.mts`/`.cts` 各一，MUST 判为受支持——N-3 实测 adapter 支持八种扩展）、`stale-identifier/`/`stale-literal/`/`stale-control-flow/`（三类 AST 结构变化）、`stale-unary-prefix/`（`return +a` vs `return -a`）、`stale-unary-postfix/`（`return ++a` vs `return --a`、`a++` vs `a--`）、`stale-decl-kind/`（`export const foo=1` vs `export let foo=1`）、`stale-overload-second/`（同名函数重载，仅改**第二个** overload 签名或实现体）、`fingerprint-version-mismatch/`（手工构造 `fingerprintVersion` 为旧值的 lock 条目 + 未变化的源文件）
  **依赖**：T001
  **验收标准**：每组 fixture 均为可独立编译的 TS/JS 文件对，人工核对每组改动范围与命名意图精确匹配（尤其 `stale-unary-*`/`stale-decl-kind`/`stale-overload-second` 四组——C-2 实测这四组在过渡算法下序列完全相同，是防回归核心资产）
  **对应 FR/SC**：FR-009(c)、SC-001、SC-002

- [ ] T030 [TEST] 重写/扩展 `scripts/lib/spec-drift-fingerprint.mjs` 单测 `tests/unit/spec-drift-fingerprint.test.ts`（替换 T010 的过渡态断言范围）为 canonical AST 语义全集：**fresh 组**——`fresh-comment-only`/`fresh-jsdoc-only`/`fresh-format-only`/`fresh-syntactic-noise`（三组）均 MUST 产生相同指纹；JSDoc 断言方式 MUST 为"canonical token 序列中不含任何 `JSDoc` 前缀 token"，**MUST NOT** 断言"至少命中一次 JSDoc 跳过分支"（该分支实测为死代码，永不命中，断言方式错误会导致必然失败）；**stale 组**——`stale-identifier`/`stale-literal`/`stale-control-flow` 产生不同指纹；**C-2 + N-1 强制回归组**（核心资产，逐组独立断言两变体哈希**不相等**，不得合并简化）——`stale-unary-prefix`（`+a` vs `-a`）、`stale-unary-postfix`（`++a` vs `--a`、`a++` vs `a--`）、`stale-decl-kind`（`const` vs `let`）、**`stale-using-vs-var`（`var` vs `using`）**、**`stale-await-using`（`using` vs `await using`）**五组 MUST 产生不同指纹；实现侧 `declarationKeyword()` 的判定顺序 MUST 为 AwaitUsing→Using→Const→Let→var 且 AwaitUsing 用**全等**比较（`NodeFlags.AwaitUsing===6===Using|Const` 位重叠，真值判断会让普通 `const`(2&6=2) 误判）；**overload 聚合**——`stale-overload-second` 改第二个 overload 签名或实现体 MUST 产生不同指纹（防"只取 `declarations[0]`"漏报）；`normalizationProfile`/`fingerprintVersion` 任一与当前工具常量不一致 → 上层 MUST 标 `fingerprint-unavailable`，不做部分兼容比较
  **依赖**：T029、T011（替换其过渡态实现）
  **验收标准**：测试改写后针对当前（过渡态）实现执行失败（红态确认，因过渡算法逐字节比较，对 fresh 组会误判 stale）
  **对应 FR/SC**：FR-009(b)(c)、SC-001、SC-005

- [ ] T031 实现 `scripts/lib/spec-drift-fingerprint.mjs` canonical AST 升级：自建 `ts-morph.Project`（`createSharedProject()`，`skipFileDependencyResolution:true`/`skipAddingFilesFromTsConfig:true`/`allowJs:true`）；`canonicalizeNode(rootNode)`（`forEachDescendant` 遍历，剔除 `SYNTACTIC_NOISE_KINDS`——如 `ParenthesizedExpression`——但继续遍历其子节点；`TEXT_BEARING_KINDS` 节点走 `normalizedLiteralText()` 归一字面值书写差异；其余节点只记 `getKindName()`）；`extraSemanticTokens(node)`（补记 `forEachChild` 不枚举的一元运算符 `operator` 属性与 `VariableDeclarationList` 的 `NodeFlags` const/let/var，修复 C-2 四组漏报）；`canonicalizeDeclarationSet(nodes)`（按 `startLine` 升序聚合全部重载声明后拼接哈希，修复 overload 漏报）；`hashCanonicalSequence()`（SHA-256）；升级 `NORMALIZATION_PROFILE` 为 `'ts-morph-canonical-v1'`
  **依赖**：T030
  **验收标准**：T030 全部用例转绿；`npx vitest run tests/unit/spec-drift-fingerprint.test.ts` 零失败
  **对应 FR/SC**：FR-009(b)(c)、SC-001、SC-005

- [ ] T032 改动 `scripts/lib/spec-drift-check.mjs`：新增 `locateExportedNodes(sourceFile, exportName, expStartLine)`（exportName+startLine+sourceFile 三元组精确匹配定位 Node；本地声明为空 → `node-locate-failed`；全部声明来自其他文件（re-export）→ `reexport-unsupported`；本地声明存在但无一项 `startLine` 与 `analyzeFiles` 结果对齐 → `node-locate-ambiguous`；三者均映射 `fingerprint-unavailable`，**禁止**任何 `?? declarations[0]` 式静默兜底）；切换调用 T031 的 `canonicalizeDeclarationSet` + `hashCanonicalSequence` 替换过渡态哈希比对；C1 阶段产出的旧 `normalizationProfile='source-slice-whitespace-v1'` 锚在本次切换后统一转 `fingerprint-unavailable`（提示需 `drift link --refresh`），不与新算法混合比较
  **依赖**：T031、T014
  **验收标准**：既有 T013 check 测试仍全绿（无回归）；新增 `locateExportedNodes` 三态各自映射正确
  **对应 FR/SC**：FR-009(b)(d)、SC-002

- [ ] T033 [TEST] 编写 11 态状态矩阵 table-driven 测试 `tests/unit/spec-drift-state-matrix.test.ts`：对 `fresh`/`stale`/`orphaned`/`ambiguous`/`unresolved`/`fingerprint-unavailable`/`graph-unavailable`/`graph-stale`/`lock-corrupt`/`unsupported-language`/`parser-degrade` 共 11 个状态**逐一**断言状态矩阵全部列——`machineCode` 字面值精确匹配（如 `DRIFT_STALE`）、作用域（anchor/report）、单态 `exitCode`、`degraded` 标记、`repo:check` 默认映射（warn/error/pass）、`--strict` 映射、`next-step` 文案非空且非通用兜底文本；含 `graph-unavailable` 独立 fixture（区别于其他状态）与 `graph-stale`（此状态无自然触发路径，用合成 `AnchorCheckResult[]` 手工构造 `status:'graph-stale'` 验证类型定义/汇总逻辑/`--format json` 序列化正确性）
  **依赖**：T032、T012（复用 graph-unavailable fixture）
  **验收标准**：`npx vitest run tests/unit/spec-drift-state-matrix.test.ts` 零失败，11 态全部列均有断言（无遗漏行）
  **对应 FR/SC**：SC-003

- [ ] T034 [TEST] 编写 C3 语义端到端测试 `tests/integration/spec-drift-canonical-ast-e2e.test.ts`（补充 T018 e2e 中标注为"C3 待补验"的部分）：基于真实 TS 文件与 T029 fixture，验证 (a) 改注释/改 JSDoc/纯格式化三类改动 `drift check` 一律判定 `fresh`（SC-001 收窄语义）；(b) 改标识符/字面值/运算符/控制结构判定 `stale`；(c) 同文件另一未锚定 symbol 变化、被锚 symbol 不变时保持 `fresh`，且 member 粒度锚点因显式拒绝不存在"回退 Class span 误伤"路径（SC-002）；(d) 模拟 `fingerprintVersion` 升级场景（T029 的 `fingerprint-version-mismatch` fixture）——旧锚不被批量误报 `stale`，而是标 `fingerprint-unavailable` 并提示需要 `--refresh`（SC-005）
  **依赖**：T033、T018
  **验收标准**：`npx vitest run tests/integration/spec-drift-canonical-ast-e2e.test.ts` 零失败
  **对应 FR/SC**：SC-001、SC-002、SC-005

- [ ] T035 生成 `specs/219-spec-drift-production/quickstart.md`：内容涵盖 manifest 编写示例（`{id,ref,docPath,line}[]`，`ref` 须为 file-qualified 形式）、三命令用法（`drift:link`/`drift:check`/`drift:unlink` 及 `--strict`/`--format json`/`--help`）、`graph-stale` 状态"当前版本不会在正常使用中产生此状态"的预留说明、dist 陈旧的已知边界提示（"改动 `src/` 后须先 `npm run build` 再跑 drift"）
  **依赖**：T034
  **验收标准**：文档存在，中文正文+英文技术术语，不含具体客户/公司名
  **对应 FR/SC**：无直接 FR，支撑 SC-006 的可用性

- [ ] T036 C3 阶段暨全 Feature 最终验证（**W-5 收口：以下两项为可执行 gate，非散文引用**）：
  **(a) SC-007(d) 全量门禁**——`npx vitest run` + `npm run build` + `npm run repo:check` 三者零失败。
  ⚠️ **已知噪声排除口径**：`tests/integration/graph-quality-adversarial.test.ts` 在全量满载下存在 `runCLI` 子进程被饿死导致 stdout 空、`JSON.parse` 抛 `SyntaxError` 的**负载型 flaky**（已于 implement 前基线复现，隔离复跑 19/19 绿证伪）。**若且仅若**隔离复跑通过方可判定非回归，**不得直接忽略**；任何其他失败一律按真实回归处理。
  **(b) SC-008 写入面 allowlist 校验**——跑 `git diff --stat $(git merge-base master HEAD) HEAD -- src/ plugins/` 确认为空（证明未越界改生产源码）；再列出本分支实际改动路径集合，确认 ⊆ allowlist（`scripts/spec-drift-*`、`scripts/lib/spec-drift-*`、`scripts/lib/repo-maintenance-core.mjs`、`scripts/repo-check.mjs`、`package.json`、`.specify/spec-drift.lock.json`、`tests/**`、`specs/219-*/**`）。
  ⚠️ **MUST NOT 用工作树 `git diff`**（提交后恒为空 = 假通过），MUST 用 merge-base 口径。
  **(c)** 触发 Codex 对抗审查（`codex:codex-rescue`），处置 critical/warning 后再 commit（显式路径提交，禁 `git add -A`，排除 `specs/src.spec.md`）
  **依赖**：T035、T033、T028、T020
  **验收标准**：`npx vitest run` + `npm run build` + `npm run repo:check` 全部零失败（SC-007d）
  **对应 FR/SC**：SC-007(d)、SC-008

---

## Final Phase: Polish & Cross-Cutting Concerns

- [ ] T037 [P] 复核 `tests/integration/repo-maintenance-sync-check.test.ts`（既有测试，若其对 `checks` 数组做穷举式断言）：仅**新增**第 13 族存在性断言，**不修改**既有 12 族断言内容（对齐 SC-007c 零回归要求）
  **依赖**：T028
  **验收标准**：既有断言逐字节不变，仅追加新断言；测试零失败
  **对应 FR/SC**：SC-007(c)

- [ ] T038 [P] 清理与一致性复核：确认 `scripts/lib/spec-drift-*.mjs` 六模块间依赖方向单向无环（`spec-drift-fingerprint.mjs`/`spec-drift-dist-loader.mjs` 不 import 上层模块；`spec-drift-check.mjs`/`spec-drift-resolve.mjs` 不互相 import；`spec-drift-core.mjs` 是唯一横向协调点，对齐 plan §6.2 mermaid 图）；确认无死代码残留（如已删除的旧过渡态判据）
  **依赖**：T036
  **验收标准**：人工/静态工具核对依赖图与 plan §6.2 一致，无循环 import
  **对应 FR/SC**：架构护栏（非直接 FR/SC）

- [ ] T039 最终提交前复核：逐条核对 spec.md 全部 16 条 FR 与 8 条 SC 均有至少一个已完成任务覆盖（见下方"FR/SC 覆盖映射表"）；确认 commit 使用显式路径（`git add scripts/spec-drift-cli.mjs scripts/lib/spec-drift-*.mjs scripts/lib/repo-maintenance-core.mjs scripts/repo-check.mjs package.json .specify/spec-drift.lock.json tests/... specs/219-spec-drift-production/...`），不使用 `git add -A`，且不误提交 `specs/src.spec.md`
  **依赖**：T037、T038
  **验收标准**：`git status` 显示无遗漏/无误提交项
  **对应 FR/SC**：全部 FR/SC 收口

---

## FR 覆盖映射表（100% 覆盖校验）

| FR | 描述摘要 | 覆盖任务 |
|----|---------|---------|
| FR-001 | 引用清单独立文件形态、file-qualified ref 合同 | T007、T008、T009 |
| FR-002 | `drift link` 新增/刷新/删除/重复拒绝/原子批处理 | T006、T008、T009、T016、T018 |
| FR-003 | lock schema（顶层 schemaVersion + anchors 十字段，无 status） | T005、T006 |
| FR-004 | `drift check` 仅精确匹配、即时重新解析、不重 fuzzy | T012、T013、T014 |
| FR-005 | `drift check` 结构化报告 + 混合优先级 exitCode | T013、T014 |
| FR-006 | `repo:check` `--strict` 全链路 `await` 透传 | T022、T023、T024、T025 |
| FR-007 | `--strict` 严重度提升单一规则 | T022、T023、T027 |
| FR-008 | 防静默 no-op 测试 | T022、T027 |
| FR-009(a) | 首发语言 TS/JS，非首发 `unsupported-language` | T007、T008、T009、T012、T013、T014 |
| FR-009(b) | `fingerprintVersion`/`normalizationProfile` 版本声明与不匹配处理 | T010、T011、T030、T031、T034 |
| FR-009(c) | canonical token 规则（保留/剥离项） | T029、T030、T031 |
| FR-009(d) | member 粒度硬拒绝 | T007、T008、T009、T029、T034 |
| FR-009(e) | SC-001 收窄断言 | T030、T034 |
| FR-010 | 只读复用，零 diff 生产文件 | T020、T036 |
| FR-011 | 分析环境不可用降级（graph-unavailable/lock-corrupt） | T003、T004、T012、T013、T014 |
| FR-012 | `unsupported-language`/`parser-degrade` 独立 machineCode/文案 | T012、T013、T033 |
| FR-013 | 零 LLM + 图 schema 不变 | T019、护栏章节 |
| FR-014 | CLI 发布合同（`--help`/`--format json`/npm script/e2e 经公开入口） | T015、T016、T017、T018 |
| FR-015 | lock 生命周期边界（不存在/空/损坏/并发写） | T005、T006 |
| FR-016 | 文档侧锚失效非目标（显式不实现） | 无对应实现任务（非目标声明，仅在护栏/spec 中记录，T039 复核时确认未误做） |

## SC 覆盖映射表

| SC | 描述摘要 | 覆盖任务 |
|----|---------|---------|
| SC-001 | 注释/JSDoc/格式化→fresh，指定 AST 结构变化→stale | T030、T034 |
| SC-002 | sibling 不误伤 + member 拒绝无回退路径 | T012、T013、T029、T034 |
| SC-003 | 11 态独立 machineCode/文案 + 混合优先级 exitCode | T033 |
| SC-004 | `repo:check` 默认 warn / `--strict` fail / lock-corrupt 恒 fail | T027 |
| SC-005 | `fingerprintVersion` 升级不误报批量 stale | T030、T034 |
| SC-006 | CLI 端到端经公开 npm 入口跑通闭环 | T018 |
| SC-007(a) | 零 LLM 导入边界 | T019 |
| SC-007(b) | F217 六指标逐项 pass | T026 |
| SC-007(c) | 既有 12 族零回归 + 第 13 族追加 | T021、T026、T037 |
| SC-007(d) | vitest+build+repo:check 全零失败 | T036 |
| SC-008 | 写入面基于 merge-base 的 allowlist 校验 | T020、T028、T036 |

---

## 依赖关系与并行说明

### Phase 依赖关系
```
Phase 1 (Setup: T001-T002)
  → Phase 2 (Foundational: T003-T006)
    → Phase 3 (C1: T007-T020)
      → Phase 4 (C2: T021-T028)
        → Phase 5 (C3: T029-T036)
          → Final Phase (Polish: T037-T039)
```
C1 → C2 → C3 是**硬顺序依赖**（spec/plan 明确要求），不可并行跨阶段推进——C2 依赖 C1 产出的 `checkAnchors`/`validateSpecDrift` 入参形态，C3 依赖 C1/C2 已打通的 CLI/repo:check 骨架去替换指纹算法。

### 关键依赖链摘要
1. **dist-loader → resolve/check**：T004 是 T009、T014 的前置（两者都需 `loadDistModule` 加载生产逻辑）。
2. **lock-io → 一切持久化操作**：T006 是 T009（link 写入）、T014（check 读取）、T016（CLI 落地）的前置。
3. **resolve+fingerprint(过渡态)+check → CLI**：T009、T011、T014 必须先于 T016（CLI 门面调用三者）。
4. **CLI+script 注册 → e2e**：T016、T017 必须先于 T018（e2e 经 `npm run drift:*` 执行，依赖 script 已注册）。
5. **C1 check 骨架 → C2 接线**：T014 必须先于 T023（`validateSpecDrift` 内部调用 `checkAnchors`）。
6. **C3 fingerprint 替换 → check 切换 → 状态矩阵/e2e 补验**：T031 → T032 → T033 → T034 是严格串行链（后者依赖前者产出的真实指纹语义）。

### Story 内部并行机会
- Phase 3（C1）内：T007（resolve fixture）与 T012（check fixture）可并行准备（[P] 标记）；T010（fingerprint 过渡态测试）与 T008（resolve 测试）互不依赖文件，可并行编写。
- Phase 5（C3）内：T029（fixture 准备）可与 Phase 4 收尾任务并行开始（提前备料，不阻塞 C2 收尾）。
- 跨阶段的治理类任务（T019 零 LLM 边界、T033 状态矩阵、T037 既有测试复核）标注 [P] 的前提是其依赖的源文件集合已确定，可与同阶段其他非依赖任务并行。

### 推荐实现策略
**Incremental（增量交付）**：严格按 C1 → C2 → C3 推进，每阶段收尾（T020/T028/T036）触发一次 Codex 对抗审查 + 全量验证后再进入下一阶段——这是 milestone 文档与 plan §16 的既定路线，也是本 Feature 复杂度（尤其 C3 canonical AST 序列化）要求的独立验证点结构，不建议压缩为并行团队模式（C1/C2/C3 之间存在真实的产物依赖，非人为强加的顺序）。C1 完成即可交付"生产可用的建锚/检测 CLI"这一最小闭环价值（US1+US2），建议以此作为 MVP 范围。
