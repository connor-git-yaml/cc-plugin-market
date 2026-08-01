# Tasks: 判定器快照漂移信号（Judge Snapshot Drift Signal）

**Input**: `specs/236-judge-snapshot-drift-signal/{spec.md, plan.md, data-model.md, contracts/*}`
**范围声明**：本文件是 Phase 2（Tasks）产出，是给后续 `implement` 阶段的执行清单。**本次交付到 tasks.md 为止即停，不包含任何实际写代码/写测试动作**——下方所有任务当前均为 `[ ]`（未执行），implement 阶段按序逐条勾选。

**本轮修订说明**：对齐 codex 对抗审查后已修订的 plan.md/data-model.md/contracts（C1 守卫解析器 fail-closed、C2 I/O 判别式联合改名、C3 indeterminate 拆分 resolution/comparison 两变体、W1 active 边界、W2 `missingBoth`、W3 TDD 红的定义、W4 CLI 确定性测试）。相较上一版，函数改名 3 处、新增测试文件 2 个（parser fixture 测试、CLI spawnSync 测试）、拆分骨架任务以修正 TDD 顺序问题。

## 组织原则

- 严格遵循 plan.md §"实现顺序建议"的自然依赖顺序：纯函数层 core → I/O 层 io → CLI 编排层 doctor → `package.json` → FR-002b 守卫测试（真实闭包 + fixture 解析器双重验证）→ smoke/CLI 确定性测试。
- 每一层遵循**骨架先行的 TDD**：先建最小导出骨架（占位常量/返回固定占位值的函数，保证测试文件可被 `node --test` 正常加载）→ 写该层测试（预期红，且红必须来自具体断言的 actual/expected 不匹配，**不接受** `ERR_MODULE_NOT_FOUND`/`SyntaxError` 这类"模块加载崩溃"当作红）→ 写该层实现（使其转绿）。core / io / CLI 三层均按此三段式拆分任务。
- 本 feature 风险等级 **LOW-MEDIUM**（plan.md Impact Assessment 已修订口径：影响文件数/跨包影响/数据迁移/契约变更均落 LOW 区间，但 `resolveActiveSnapshot` 优先级链路与 FR-002b 守卫解析器两个模块复杂度较高，需穷举式单测覆盖，不得仅靠端到端 smoke 兜底）。无 User Story 拆分必要性（单一 P1 场景即 MVP 全部内容，P2 场景"不干扰现有流程"的约束型验证已融入下方任务验收判据）。
- 无跨文件写冲突、且分属不同文件的任务标 `[P]`（可并行执行）；同文件先后依赖、或后者读取前者产物的任务保持串行。

---

## Phase 1：纯函数层（`lib/judge-snapshot-core.mjs`）

### T001 [P] 建立 core 层骨架

- **目标文件**：`plugins/spec-driver/scripts/lib/judge-snapshot-core.mjs`（新增）
- **动作**：创建文件并导出：
  - `JUDGE_FILE_SET`：`Object.freeze([...6 个相对路径])`，与 data-model.md §1 逐字一致（这是数据字面量，无需等待"实现"阶段，可与骨架一起直接落地，不构成 TDD 红的来源）
  - `resolveActiveSnapshot(sources)`：占位实现，返回固定 dummy 值（如 `{ snapshotPath: null, resolutionSource: 'indeterminate', reason: 'not-implemented-placeholder' }`），**不抛出**未捕获异常
  - `compareFile(repoDigest, snapshotDigest)`：占位实现，返回固定 dummy 值（如 `{ status: 'not-implemented-placeholder' }`）
  - `aggregateStatus(files)`：占位实现，返回固定 dummy 字符串
- **完成判据**：`node --test plugins/spec-driver/tests/judge-snapshot-core.test.mjs`（T002 产出后）能够成功 `import` 本文件，不出现 `ERR_MODULE_NOT_FOUND`/`SyntaxError`。

### T002 [P] 编写 core 层单测（依赖 T001 骨架，先红——断言失败而非导入崩溃）

- **目标文件**：`plugins/spec-driver/tests/judge-snapshot-core.test.mjs`（新增）
- **动作**：使用 `node:test` 编写针对 `lib/judge-snapshot-core.mjs` 的单测，覆盖以下用例（均为纯函数输入/输出断言，不触碰真实文件系统）：
  1. **`compareFile(repoDigest, snapshotDigest)` 穷举 data-model.md §5 全部 3×3=9 个组合**（含 W2 修订的 `missingBoth`）：
     - `error` × `error` → `{ status:'indeterminate', side:'both', errorCode: repoDigest.errorCode }`
     - `error` × 非 `error` → `{ status:'indeterminate', side:'repo', errorCode: repoDigest.errorCode }`
     - 非 `error` × `error` → `{ status:'indeterminate', side:'snapshot', errorCode: snapshotDigest.errorCode }`
     - `missing` × `missing` → `{ status:'missingBoth' }`（**不是** `missingInRepo`——W2 修订核心断言）
     - `missing` × `ok` → `{ status:'missingInRepo' }`
     - `ok` × `missing` → `{ status:'missingInSnapshot' }`
     - `ok` × `ok`，sha256 相等 → `{ status:'match' }`
     - `ok` × `ok`，sha256 不等 → `{ status:'mismatch' }`
  2. **`aggregateStatus(files)` 三分支**（含 `missingBoth` 参与 drift 判定）：
     - 任一 `FileComparisonEntry.status === 'indeterminate'` → `'indeterminate'`
     - 无 indeterminate 但存在任一非 `'match'`（`mismatch`/`missingInRepo`/`missingInSnapshot`/`missingBoth`）→ `'drift'`
     - 全部 `'match'` → `'in-sync'`
  3. **`resolveActiveSnapshot(sources)` FR-007 四步优先级 + W1 边界穷举**（构造 `SnapshotResolutionSources` fixture，不读真实环境变量/文件）：
     - `claudePluginRoot: { kind:'ok', path, canonicalPath }` 命中 → `{ snapshotPath: path, resolutionSource: 'claude-plugin-root' }`（用"若检查了后续来源会得出不同结果"的对照 fixture 证明短路生效）
     - `claudePluginRoot: { kind:'error', errorCode }` → 立即 `{ snapshotPath:null, resolutionSource:'indeterminate', reason:'source-error', detail:{ source:'claude-plugin-root', errorCode } }`（**不再看后续来源**，即使 `specDriverPath`/`installedMetadata` 均可解析成功也不采用——短路证明）
     - **invalid-env 边界**：`claudePluginRoot: { kind:'invalid', reason:'name-mismatch' }`（对应 `CLAUDE_PLUGIN_ROOT` 指向非 spec-driver 目录）→ 视为确定性负判定，继续第 2 步（不短路、不报错）
     - `claudePluginRoot: { kind:'unavailable' }`，`specDriverPath: { kind:'ok', ... }` 命中 → `resolutionSource: 'spec-driver-path-file'`
     - **deleted-pointer 边界**：`specDriverPath: { kind:'invalid', reason:'dir-absent' }`（对应 `.specify/.spec-driver-path` 内容指向的目录已被删除/悬空）→ 确定性负判定，继续第 3 步
     - 前两者均 `unavailable`，`installedMetadata: { kind:'ok', candidates:[单条 valid.kind==='ok'] }` → `resolutionSource: 'installed-plugins-metadata'`
     - **one-valid-one-invalid 边界**：`installedMetadata.candidates` 含 2 条，1 条 `valid.kind==='ok'`、1 条 `valid.kind==='invalid'`（如 `name-mismatch`）→ 过滤后剩 1 条，**不算歧义**，直接采用该条（对应 contracts 场景 4c）
     - **duplicate-same-path 边界**：`installedMetadata.candidates` 含 2 条，`path` 不同但 `canonicalPath` 相同（symlink 指向同一 real path）→ 视为单一候选，**不算歧义**（对应 contracts 场景 4b）
     - **候选含 error 边界**：`installedMetadata.candidates` 中任一条 `valid.kind==='error'` → 整体 `{ ..., reason:'source-error', detail:{ source:'installed-plugins-metadata', errorCode: 该候选.valid.errorCode } }`，**该候选不参与"剩余候选计数"逻辑**（即使另一条是合法 `ok` 候选，也不能因为"还剩 1 条看似正常"而跳过这个 error）
     - **scope 优先级边界**：`installedMetadata.candidates` 含 2 条均 `valid.kind==='ok'`、不同 `canonicalPath`，1 条 `scope:'project'`、1 条 `scope:'user'` → 只保留 `project` scope 候选，视为单一候选，**不算歧义**；再构造一个全 `user`/`null` scope 的对照 fixture，证明此时不引入进一步优先级判断、按原候选数正常判定
     - 前两者均 `unavailable`，`installedMetadata.candidates` 恰 2 条均 `valid.kind==='ok'`（不同 `canonicalPath`，均非 `project` scope 或均为 `project` scope）→ `{ snapshotPath: null, resolutionSource: 'indeterminate', reason: 'installed-plugins-metadata-ambiguous' }`
     - 三路来源均 `unavailable`/`invalid`/`absent`-且过滤后为空 → `{ snapshotPath: null, resolutionSource: 'indeterminate', reason: 'no-active-snapshot-resolvable' }`
  4. **`JUDGE_FILE_SET` 基本断言**：长度为 6、内容与 data-model.md 罗列的 6 个相对路径完全一致（顺序不作为契约，用 `Set` 比较）、`Object.freeze` 生效（尝试 push/赋值应抛出或静默失败，断言数组内容不变）。
- **完成判据**：`node --test plugins/spec-driver/tests/judge-snapshot-core.test.mjs` 此时因 T001 骨架返回固定占位值、与上述断言不符而**失败（红）**——失败原因必须是具体某条 `assert.deepStrictEqual`/`assert.equal` 的 actual/expected 不一致（node:test 输出可读的差异明细），**不得**是模块无法解析/语法错误导致整个测试文件无法运行。

### T003 实现 core 层（依赖 T001 + T002，使 T002 转绿）

- **目标文件**：`plugins/spec-driver/scripts/lib/judge-snapshot-core.mjs`（修改骨架为正式实现）
- **动作**：将 T001 的占位实现替换为正式逻辑：
  - `resolveActiveSnapshot(sources)`：按 FR-007 四步优先级 + data-model.md §3.6/§4 全部边界规则求值（canonicalize 去重、先过滤 invalid/error 再判歧义、候选含 error 整体转 source-error、scope 优先级、短路语义）
  - `compareFile(repoDigest, snapshotDigest)`：按 data-model.md §5 九组合判定表实现（含 `missingBoth`）
  - `aggregateStatus(files)`：按 T002 的三分支规则实现
  - 零 I/O、零对 `lib/judge-snapshot-io.mjs` 的依赖（保持纯函数、单向依赖，与 plan.md 架构图一致）
- **完成判据**：`node --test plugins/spec-driver/tests/judge-snapshot-core.test.mjs` 全部用例通过（绿）。

---

## Phase 2：I/O 层（`lib/judge-snapshot-io.mjs`）

### T004 [P] 建立 io 层骨架（可与 T001 并行，不同文件互不依赖）

- **目标文件**：`plugins/spec-driver/scripts/lib/judge-snapshot-io.mjs`（新增）
- **动作**：创建文件并导出占位实现（均返回固定 dummy 判别式值，不抛出未捕获异常）：
  - `computeSha256(absPath)` → 占位返回 `{ status: 'not-implemented-placeholder', sha256: null }`
  - `validatePluginRoot(dir)` → 占位返回 `{ kind: 'not-implemented-placeholder' }`（**函数名沿用本轮修订**：由旧版 `isValidPluginRoot` 改名而来）
  - `readSpecDriverPathFile(projectRoot)` → 占位返回 `{ kind: 'not-implemented-placeholder' }`
  - `readInstalledPluginsMetadata(claudeHome)` → 占位返回 `{ kind: 'not-implemented-placeholder' }`（**改名**：由旧版 `readInstalledPluginsEntries` 改而来）
  - `scanInstalledSnapshotPresence(claudeHome)` → 占位返回 `'not-implemented-placeholder'`（**改名**：由旧版 `hasAnyInstalledSnapshot` 改而来）
- **完成判据**：`node --test plugins/spec-driver/tests/judge-snapshot-io.test.mjs`（T005 产出后）能够成功 `import` 本文件。

### T005 [P] 编写 io 层单测（依赖 T004 骨架，先红——断言失败而非导入崩溃；可与 T002 并行，不同文件）

- **目标文件**：`plugins/spec-driver/tests/judge-snapshot-io.test.mjs`（新增）
- **动作**：使用 `node:test` + `node:fs`/`os.tmpdir()` 构造临时目录 fixture（`fs.mkdtempSync`，测试结束后清理），针对 `lib/judge-snapshot-io.mjs` 编写单测，覆盖每个函数的判别式联合分支：
  1. **`computeSha256(absPath)`**：
     - 文件存在且可读 → `{ status: 'ok', sha256: <64位十六进制字符串> }`，对同一内容两次计算结果相等（确定性）
     - 文件不存在 → `{ status: 'missing', sha256: null }`（不抛出）
     - 文件存在但无读权限（`fs.chmodSync(path, 0o000)`，非 root 环境验证；CI/root 环境下该子用例条件跳过并注明原因）→ `{ status: 'error', sha256: null, errorCode: 'EACCES' }`（不抛出）
  2. **`validatePluginRoot(dir)` 按 data-model.md §3.1 六步判别顺序穷举**：
     - `dir` 不存在 → `{ kind:'invalid', reason:'dir-absent' }`
     - `dir` 存在但 `.claude-plugin/plugin.json` 不存在 → `{ kind:'invalid', reason:'manifest-missing' }`
     - `dir`/`plugin.json` 读取遇非 `ENOENT` I/O 错误（如 `EACCES`）→ `{ kind:'error', errorCode: 'EACCES' }`（**不是** `invalid`——性质不同：确定性负判定 vs 不确定性错误）
     - `plugin.json` 存在但 `JSON.parse` 失败 → `{ kind:'error', errorCode:'manifest-json-parse-error' }`
     - `plugin.json` 解析成功但 `name !== 'spec-driver'` → `{ kind:'invalid', reason:'name-mismatch' }`
     - 以上全部通过 → `{ kind:'ok' }`
  3. **`readSpecDriverPathFile(projectRoot)`**：
     - `.specify/.spec-driver-path` 不存在 → `{ kind:'unavailable' }`
     - 文件存在但内容为空/空白 → `{ kind:'unavailable' }`
     - 文件读取本身失败（如 `EACCES`）→ `{ kind:'error', errorCode:'EACCES' }`
     - 文件存在且内容为有效路径，指向路径 `validatePluginRoot` 判定 `ok` → `{ kind:'ok', path, canonicalPath }`
     - 文件存在且内容为有效路径，但指向路径 `validatePluginRoot` 判定 `invalid`/`error` → 对应映射为 `SourceProbe` 的 `invalid`/`error` 分支
  4. **`readInstalledPluginsMetadata(claudeHome)`**：
     - `installed_plugins.json` 不存在 → `{ kind: 'absent' }`
     - 文件读取本身失败（如 `EACCES`）→ `{ kind: 'error', errorCode: 'EACCES' }`
     - 文件存在但 JSON 损坏（截断的 `{` 等）→ `{ kind: 'invalid', reason: 'json-parse-error' }`（**不是** `absent`——"存在但读不懂"与"确实没有"性质不同，这是 C2 修订核心断言）
     - 文件存在且合法但无 `spec-driver@cc-plugin-market` 条目 → `{ kind: 'ok', candidates: [] }`
     - 文件存在且含该条目（1 条或多条）→ `{ kind: 'ok', candidates: [...] }`，每条 `PluginRootCandidate` 含 `path`/`canonicalPath`（`fs.realpathSync` 解析，失败退化为 `path.resolve`）/`scope`（缺失时为 `null`）/`valid`（对 `path` 调 `validatePluginRoot` 的结果）
  5. **`scanInstalledSnapshotPresence(claudeHome)`**：
     - `claudeHome` 下无任何插件 cache 目录结构 → `'absent'`
     - 存在至少一个匹配 `<market>/spec-driver/<version>/.claude-plugin/plugin.json` 的目录（不要求 `validatePluginRoot` 通过，只判定"存在"这一更弱事实）→ `'present'`
     - 扫描过程本身遇 I/O 错误（如无法读取 cache 根目录）→ `'error'`（**不得**与"目录结构不存在"混为一谈）
- **完成判据**：`node --test plugins/spec-driver/tests/judge-snapshot-io.test.mjs` 此时因 T004 骨架返回固定占位值而失败（红），失败原因必须是具体断言不一致，不得是导入失败。

### T006 实现 io 层（依赖 T004 + T005，使其转绿；可与 T003 并行 `[P]`，两文件互不依赖）

- **目标文件**：`plugins/spec-driver/scripts/lib/judge-snapshot-io.mjs`（修改骨架为正式实现）
- **动作**：将占位实现替换为正式逻辑，导出 `computeSha256`、`validatePluginRoot`、`readSpecDriverPathFile`、`readInstalledPluginsMetadata`、`scanInstalledSnapshotPresence`，均为非抛出式（内部 `try/catch` 吞掉 I/O 异常并转换为约定的判别式联合返回值），仅用 `node:fs`/`node:path`/`node:crypto`。
- **完成判据**：`node --test plugins/spec-driver/tests/judge-snapshot-io.test.mjs` 全部用例通过（绿）。

---

## Phase 3：CLI 编排层（`judge-snapshot-doctor.mjs`）

### T007 [P] 建立 CLI 层骨架（依赖 T001 + T004 骨架已存在，可与 T002/T003/T005/T006 并行）

- **目标文件**：`plugins/spec-driver/scripts/judge-snapshot-doctor.mjs`（新增）
- **动作**：创建文件，`import` 两层符号（此时仅需骨架级导出存在，不要求逻辑已实现），导出占位实现：
  - `parseArgs(argv)` → 占位返回固定 dummy 值
  - `checkJudgeSnapshotDrift({ projectRoot, env, claudeHome })` → 占位返回固定 dummy `DriftCheckResult` 形状对象
  - `formatReport(result)` → 占位返回固定字符串
  - `main(argv)` → 占位实现，`process.exitCode = 0`
  - `isDirectExecution()` 兜底：照抄 `plugins/spec-driver/scripts/fix-compliance-judge.mjs` 底部的直接执行判定模式
- **完成判据**：T008/T009 测试文件能够成功 `import` 本文件的导出符号。

### T008 编写 CLI 编排层单测（依赖 T007 骨架，先红——断言失败而非导入崩溃）

- **目标文件**：`plugins/spec-driver/tests/judge-snapshot-doctor.test.mjs`（新增，替代旧版 `-smoke.test.mjs` 命名——本文件不再是"容忍双态的冒烟测试"，而是确定性 fixture 断言为主）
- **动作**：本文件承担 `checkJudgeSnapshotDrift` 编排逻辑的全部确定性测试职责，分两部分：

  **Part A — fixture 化确定性场景**（用 `os.tmpdir()` 构造临时 `projectRoot`/`claudeHome` 目录树，通过显式注入 `{ projectRoot, env, claudeHome }` 参数调用 `checkJudgeSnapshotDrift`，不依赖真实本机环境），逐条覆盖 contracts/judge-snapshot-drift-result.md「测试断言基准」表的全部 12 行：

  | # | 场景 | 断言 |
  |---|------|------|
  | 1 | `projectRoot` 下无 `fix-compliance-judge.mjs` | `status:'not-applicable'`, `reason:'repo-reference-missing'`, `files:[]` |
  | 2 | 有仓库侧参照，`claudeHome` 下无任何合法快照目录（`scanInstalledSnapshotPresence` → `'absent'`） | `status:'not-applicable'`, `reason:'no-installed-snapshot'` |
  | 3 | `CLAUDE_PLUGIN_ROOT` 指向的目录 manifest 读取遇 `EACCES` | `status:'indeterminate'`, `indeterminateKind:'resolution'`, `reason:'source-error'`, `detail:{source:'claude-plugin-root',errorCode:'EACCES'}`, `files:[]`（**不因**存在其他可用快照而降级为 `not-applicable`） |
  | 4 | `installed_plugins.json` 含 2 条不同 `canonicalPath`、均 `valid.kind==='ok'` 的候选 | `status:'indeterminate'`, `indeterminateKind:'resolution'`, `reason:'installed-plugins-metadata-ambiguous'` |
  | 4b | 同上但 2 条候选 `canonicalPath` 相同（symlink） | **不是** `indeterminate`——视为单一候选正常解析进入比对 |
  | 4c | 同上但 1 条 `invalid`（如 name-mismatch）、1 条 `ok` | **不是** `indeterminate`——过滤后剩 1 条，`resolutionSource:'installed-plugins-metadata'` |
  | 5 | 三路来源均无候选，`claudeHome` 下存在 ≥1 合法快照目录（`scanInstalledSnapshotPresence` → `'present'`） | `status:'indeterminate'`, `indeterminateKind:'resolution'`, `reason:'no-active-snapshot-resolvable'` |
  | 6 | 同上但扫描 `claudeHome` cache 目录本身遇 `EACCES`（`scanInstalledSnapshotPresence` → `'error'`） | `status:'indeterminate'`, `indeterminateKind:'resolution'`, `reason:'installed-snapshot-scan-error'` |
  | 7 | 唯一候选解析成功 + 6 文件全部两侧相同 | `status:'in-sync'`, `files.length===6` 全 `match` |
  | 8 | 唯一候选解析成功 + 1 文件不同、其余相同（部分 match 部分 drift） | `status:'drift'`, 5 条 `match` + 1 条 `mismatch` |
  | 9 | 唯一候选解析成功 + 快照侧缺失某文件 | `status:'drift'`, 该项 `status:'missingInSnapshot'` |
  | 10 | 唯一候选解析成功 + 某文件两侧均缺失（`missingBoth`） | `status:'drift'`, 该项 `status:'missingBoth'` |
  | 11 | 唯一候选解析成功 + 仓库侧某文件读取遇 `EACCES`、其余相同 | `status:'indeterminate'`, `indeterminateKind:'comparison'`, `reason:'partial-file-read-failure'`, `snapshotPath`/`resolutionSource` **保留非空**，`files` 保留全部 6 条明细（该项 `status:'indeterminate', side:'repo', errorCode:'EACCES'`，其余 5 条完整 `match`） |
  | 12 | 唯一候选解析成功 + 1 文件 `mismatch` 与 1 文件 `EACCES` 混合出现 | 同 11，且 `files` 中**同时**保留该 `mismatch` 条目与该 `indeterminate` 条目（不被互相吞掉），其余 4 条 `match` |

  **Part B — 真实环境宽松 sanity check**（不注入 fixture，直接调用 `checkJudgeSnapshotDrift({ projectRoot: 仓库真实根目录 })`）：
  - 唯一断言：`result.status` ∈ 合法枚举值，`indeterminate` 态下 `indeterminateKind` 存在且合法，结构合法
  - **明确声明**：本部分**不作为** FR-009/FR-011 的覆盖证据（那由 T009 spawnSync 测试提供），仅作为"函数在真实仓库上不抛异常"的附加 sanity check，不因具体是哪一态而失败
- **完成判据**：`node --test plugins/spec-driver/tests/judge-snapshot-doctor.test.mjs` 此时因 T007 骨架返回固定占位值而全数失败（红），失败原因必须是具体断言不一致。

### T009 [P] 编写 CLI 进程级确定性测试（依赖 T007 骨架，先红；可与 T008 并行，不同文件）

- **目标文件**：`plugins/spec-driver/tests/judge-snapshot-doctor-cli.test.mjs`（新增）
- **动作**：使用 `node:child_process` 的 `spawnSync` 真实启动 `judge-snapshot-doctor.mjs` 子进程（不经 `import`，走真实 CLI 边界），配合 `os.tmpdir()` 构造的临时 `projectRoot`/快照目录 fixture，通过 `env` 注入 `CLAUDE_PLUGIN_ROOT` 指向 fixture 快照目录，覆盖：
  1. **drift 场景退出码**：fixture 构造出 `drift` 结果（如 1 文件内容不同），`spawnSync` 断言 `status === 0`（FR-009：drift 不是失败）
  2. **非法参数退出码**：传入未知参数（如 `--unknown-flag`）或 `--project-root` 缺值，断言 `status === 1`，且错误提示写入 `stderr`（不是 `stdout`）
  3. **stdout/stderr 分流**：正常场景下报告文本应完整出现在 `stdout`，`stderr` 应为空
  4. **不含修复建议文案（FR-011）**：对 `drift`/`in-sync`/`not-applicable`/`indeterminate` 各构造至少一个 fixture 场景，断言 `stdout` 中**不包含**"建议"/"请重新安装"/"请运行"/"sync"等修复指令类措辞（具体禁用词表与 contracts 输出文本示例比对，允许后续实现按此增补）
  5. **`npm run judge:doctor` 挂载**：`spawnSync('npm', ['run', 'judge:doctor', '--', '--project-root', <fixture>], ...)` 可执行且退出码符合上述规则（验证 `package.json` 挂载正确，T011 完成后此子用例才可能通过，实现阶段需注意执行顺序）
- **完成判据**：`node --test plugins/spec-driver/tests/judge-snapshot-doctor-cli.test.mjs` 此时因 T007 骨架的占位 `main`/`checkJudgeSnapshotDrift` 无法产出预期退出码/输出而失败（红），失败原因必须是具体断言不一致（如退出码不匹配、stdout 内容不含预期文本），不得是子进程启动本身失败（子进程可正常 spawn 并返回，只是行为不对）。

### T010 实现 CLI 编排层（依赖 T003 + T006 + T007 + T008 + T009 均已就绪，使 T008/T009 转绿）

- **目标文件**：`plugins/spec-driver/scripts/judge-snapshot-doctor.mjs`（修改骨架为正式实现）
- **动作**：
  - `parseArgs(argv)`：解析 `--project-root <path>`；未知参数或缺值时返回错误标记（供 `main` 以退出码 1 结束，参照 contracts/judge-snapshot-doctor-cli.md 参数表）
  - `checkJudgeSnapshotDrift({ projectRoot, env = process.env, claudeHome = path.join(os.homedir(), '.claude') })`：按 data-model.md §6 / contracts 判定优先级实现：
    1. `projectRoot` 下无 `plugins/spec-driver/scripts/fix-compliance-judge.mjs` → `not-applicable`/`repo-reference-missing`
    2. 组装 `SnapshotResolutionSources`（读 `env.CLAUDE_PLUGIN_ROOT` + `validatePluginRoot`、`readSpecDriverPathFile(projectRoot)`、`readInstalledPluginsMetadata(claudeHome)`），调用 `resolveActiveSnapshot`
    3. `resolutionSource==='indeterminate'` 且 `reason` ∈ `{source-error, installed-plugins-metadata-ambiguous}` → 直接 `indeterminate`/`resolutionKind:'resolution'`，**不查** `scanInstalledSnapshotPresence`
    4. `reason==='no-active-snapshot-resolvable'` → 查 `scanInstalledSnapshotPresence(claudeHome)`：`absent`→`not-applicable`/`no-installed-snapshot`；`present`→`indeterminate`/`resolution`/`no-active-snapshot-resolvable`；`error`→`indeterminate`/`resolution`/`installed-snapshot-scan-error`
    5. 解析成功 → 对 `JUDGE_FILE_SET` 逐文件 `computeSha256`（仓库侧/快照侧）→ `compareFile` → `aggregateStatus` → `indeterminate`（`comparison`，保留全部 `files`）/`drift`/`in-sync`
  - `formatReport(result)`：按 contracts/judge-snapshot-doctor-cli.md 的输出文本示例格式化，**依据 `indeterminateKind` 分支呈现**（`resolution` 不打印文件明细；`comparison` 必须打印文件明细含 `side`/`errorCode`）；`in-sync`/`drift` 含文件明细与汇总计数；`not-applicable` 仅含 `reason`
  - `main(argv)`：`parseArgs` 失败 → `process.exitCode = 1` 且不打印报告（错误提示写 `stderr`）；成功 → 调用 `checkJudgeSnapshotDrift` + `formatReport` + 打印到 `stdout` + **恒 `process.exitCode = 0`**（`drift`/`indeterminate`/`not-applicable` 均不视为失败，FR-009）
  - `isDirectExecution()` 兜底：仅在直接执行时调用 `main(process.argv.slice(2))`
- **完成判据**：
  - `node --test plugins/spec-driver/tests/judge-snapshot-doctor.test.mjs` 全部用例通过（绿）
  - `node --test plugins/spec-driver/tests/judge-snapshot-doctor-cli.test.mjs` 除"`npm run judge:doctor` 挂载"子用例外全部通过（该子用例待 T011 完成后才能转绿，属预期顺序）

---

## Phase 4：`package.json` 脚本挂载

### T011 新增 `judge:doctor` 脚本（依赖 T010；单文件改动，不可与其他任务并行）

- **目标文件**：`package.json`
- **动作**：在 `scripts` 字段新增一行：
  ```json
  "judge:doctor": "node plugins/spec-driver/scripts/judge-snapshot-doctor.mjs"
  ```
  仅新增该行，不改动其余既有脚本条目的顺序或内容。
- **完成判据**：
  - `npm run judge:doctor` 可在仓库根成功执行，退出码 0，输出四态之一的合法报告
  - `node --test plugins/spec-driver/tests/judge-snapshot-doctor-cli.test.mjs` 中"`npm run judge:doctor` 挂载"子用例转绿

---

## Phase 5：FR-002b 守卫测试（真实闭包 + fixture 解析器双重验证）

### T012 [P] 建立 parser 骨架 + fixture 落地（依赖 T001 已存在 `JUDGE_FILE_SET`，与 T007~T011 互不冲突可并行）

- **目标文件**：
  - `plugins/spec-driver/tests/lib/import-closure-parser.mjs`（新增，测试专用基础设施，**不**从 `scripts/lib/` 生产目录导出）
  - `plugins/spec-driver/tests/fixtures/judge-file-set-guard/`（新增目录，5 个语法样例源文件）
- **动作**：
  - 在 `import-closure-parser.mjs` 中创建占位导出 `extractModuleReferences(sourceText)`（返回固定 dummy `{ ok: true, refs: [] }`）与 `resolveStaticImportClosure(entryAbsPath)`（返回固定 dummy `{ ok: true, files: [] }`），保证 T013/T014 测试文件可正常 `import`
  - 落地 5 个 fixture 源文件（对应 data-model.md §7.5）：
    1. 跨行 import：`import { a, b, c } from\n  '../lib/foo.mjs';`
    2. specifier 行内含注释：`import x from '../lib/foo.mjs'; // 提到 import '../fake.mjs' 的注释`
    3. re-export：`export { a, b } from '../lib/foo.mjs';` 与 `export * from '../lib/bar.mjs';`
    4. side-effect import：`import '../lib/side-effect.mjs';`
    5. 注释掉的伪 import：整行处于 `//` 或 `/* */` 内的 `import '../not-a-real-dependency.mjs';`
- **完成判据**：T013/T014 测试文件能够成功 `import` 骨架导出符号与 fixture 文件路径。

### T013 [P] 编写 FR-002b 解析器 fixture 单测（依赖 T012 骨架，先红；与 T014 互不依赖可并行）

- **目标文件**：`plugins/spec-driver/tests/judge-file-set-guard-parser.test.mjs`（新增）
- **动作**：对 `extractModuleReferences` 纯函数独立喂入 T012 落地的 5 类 fixture，逐条断言解析结果与预期一致（参照 data-model.md §7.5）：
  1. 跨行 import → `refs` 含 `'../lib/foo.mjs'`
  2. specifier 行内含注释 → `refs` 只含 `'../lib/foo.mjs'`，**不**含注释内提及的 `'../fake.mjs'`
  3. re-export（`export {...} from` 与 `export * from`）→ 均计入 `refs`
  4. side-effect import → 计入 `refs`
  5. 注释掉的伪 import → `refs` 与 `unsupported` 均**不**包含该行任何内容
  6. **dynamic import 一律 fail-closed**：额外构造 `import(pathVar)`/`` import(`${x}`) ``/字面量 `import('./x.mjs')`/注释间隔 `import/**/(…)` 等片段 → 断言返回 `{ ok:false, unsupported: [{ kind:'dynamic-import', ... }] }`

  > **注（implement 阶段架构转向）**：本条原文的"**非字面量** dynamic import fail-closed / 字面量 dynamic import 计边"承诺已**撤销**。守卫改用 Node vm 官方解析后，不再区分字面量/非字面量——凡检测到 dynamic import 调用（含注释间隔形态）一律 fail-closed，`kind` 统一为 `'dynamic-import'`。最终以 `data-model.md §7` + `contracts/judge-snapshot-drift-result.md` 为准。
- **完成判据**：`node --test plugins/spec-driver/tests/judge-file-set-guard-parser.test.mjs` 此时因 T012 骨架返回固定占位值而失败（红），失败原因必须是具体断言不一致（如 `refs` 内容不符预期），不得是导入失败。

### T014 编写 FR-002b 真实闭包守卫测试（依赖 T001 已存在 `JUDGE_FILE_SET` + T012 骨架，先红；可与 T013 并行编写）

- **目标文件**：`plugins/spec-driver/tests/judge-file-set-guard.test.mjs`（新增）
- **动作**：调用 `resolveStaticImportClosure('plugins/spec-driver/scripts/fix-compliance-judge.mjs')`（真实仓库入口），断言：
  1. 返回 `{ ok: true, files }`（`ok:false` 时测试本身即判定失败，附带打印 `unsupported` 明细供人工定位——**不确定本身即视为守卫失败**，不允许静默放行）
  2. `files`（转换为相对 `plugins/spec-driver/` 的路径集合）与 `JUDGE_FILE_SET` **完全相等**（`Set` 比较，不依赖顺序）
  3. 长度恰为 6，作为"数组未遗漏也未多余"双向校验
- **完成判据**：
  - `node --test plugins/spec-driver/tests/judge-file-set-guard.test.mjs` 此时因 T012 骨架返回固定 dummy 空集合、与 `JUDGE_FILE_SET` 不相等而失败（红）
  - implement 阶段（T015）完成后，**反证验证（人工在本地临时修改后立即撤销，不提交）**：临时在 `JUDGE_FILE_SET` 中删去一项或新增一个不存在的路径，重跑该测试文件确认失败；随后撤销临时改动确认恢复通过——证明守卫测试对"数组与真实闭包不同步"敏感，而非恒真断言

### T015 实现 `extractModuleReferences` + `resolveStaticImportClosure`（依赖 T012 + T013 + T014，使两测试文件转绿）

- **目标文件**：`plugins/spec-driver/tests/lib/import-closure-parser.mjs`（修改骨架为正式实现）
- **动作**：按 data-model.md §7.3/§7.4 实现：
  - `extractModuleReferences(sourceText)`：词法屏蔽（行注释/块注释/字符串字面量/模板字面量遮蔽为等长空白，保留行号）→ 正则提取 `import...from`/`export...from`/side-effect `import`/字面量 `import(...)` 四类已知安全形态 → 非字面量 dynamic import 或其他无法归类的可疑片段 → `{ ok:false, unsupported }`（fail-closed，禁止引入 parser 类新依赖，呼应 Constitution X）
  - `resolveStaticImportClosure(entryAbsPath)`：从入口出发 BFS 遍历相对 import（`./`/`../` 开头，忽略裸包名/`node:*`），任一文件 `extractModuleReferences` 返回 `ok:false` → 整体立即 `{ ok:false, unsupported }`；全部访问完成 → `{ ok:true, files }`
- **完成判据**：`node --test plugins/spec-driver/tests/judge-file-set-guard-parser.test.mjs` 与 `node --test plugins/spec-driver/tests/judge-file-set-guard.test.mjs` 均全部通过（绿）；随后执行 T014 完成判据中的反证验证步骤并确认符合预期。

---

## 收尾：全套验证（依赖 T001~T015 全部完成）

### T016 全量验证

- **动作**：依次执行并确认零失败：
  1. `npm run test:plugins`（覆盖本 feature 新增的 6 个测试文件：`judge-snapshot-core.test.mjs`/`judge-snapshot-io.test.mjs`/`judge-snapshot-doctor.test.mjs`/`judge-snapshot-doctor-cli.test.mjs`/`judge-file-set-guard.test.mjs`/`judge-file-set-guard-parser.test.mjs`，及既有 `fix-compliance-*` 系列测试无回归）
  2. `npx vitest run`（确认新增文件未影响仓库既有 vitest 套件，尤其 `repo-maintenance` 系列与 F208/F216/F224/F225/F227/F228 相关既有测试零回归）
  3. `npm run build`（确认无 TypeScript 类型检查错误——本 feature 全为 `.mjs`，此步骤主要验证未意外破坏其他 TS 源文件）
  4. `npm run repo:check`（确认 `judge:doctor` 未被误挂载进任何既有检查族，且未触发同步/契约漂移警告；FR-009 要求本次不接入 `repo:check`，此步骤同时是对该约束的反向验证）
- **完成判据**：以上 4 条命令均以退出码 0 结束，且输出中不含新增的失败/error 条目；`npx vitest run` 与 `npm run test:plugins` 失败计数均为 0。
- **边界确认（对应 spec User Story 2 / SC-004 / SC-005）**：确认 `repo:check` 整体 `status` 与 Stop hook 现有 exit code 语义（0 放行 / 2 阻断）在本次改动前后逐字节不变——因本 feature 未修改 `stop-fix-compliance-check.sh`、未修改 `repo-maintenance-core.mjs`，此项应为自动满足，仅需在验证记录里显式确认「未触碰」而非默认假设。

---

## 依赖关系图

```text
T001 (core 骨架)  ──┬──▶ T002 (core 单测·红) ──▶ T003 (core 实现·绿) ──┐
                    │                                                 │
T004 (io 骨架)   ───┼──▶ T005 (io 单测·红)   ──▶ T006 (io 实现·绿)   ──┤
                    │                                                 │
T001+T004 ──────────┴──▶ T007 (CLI 骨架) ──┬──▶ T008 (CLI 单测·红)   ──┤
                                            └──▶ T009 (CLI spawnSync·红)┤
                                                                        │
T003+T006+T007+T008+T009 ──────────────────────────────────────────▶ T010 (CLI 实现·绿)
                                                                        │
T010 ───────────────────────────────────────────────────────────────▶ T011 (package.json)
                                                                        │
T001 ──▶ T012 (parser 骨架+fixture) ──┬──▶ T013 (parser 单测·红) ──┐   │
                                       └──▶ T014 (真实闭包测试·红) ──┼──▶ T015 (parser 实现·绿)
                                                                     │
T011 + T015 ───────────────────────────────────────────────────────▶ T016 (全量验证)
```

- **可并行组 1**：T001 与 T004（不同文件骨架，互不依赖）
- **可并行组 2**：T002 与 T005（不同文件测试，各依赖自身骨架）；T007 骨架亦可在 T001+T004 骨架完成后立即开始，与 T002/T003/T005/T006 并行编写
- **可并行组 3**：T003 与 T006（不同文件实现，core/io 层零耦合，plan.md 架构图已明确单向：`doctor.mjs → {io.mjs, core.mjs}`）
- **可并行组 4**：T008 与 T009（不同文件测试，均依赖 T007 骨架，互不依赖）
- **可并行组 5**：T012 完成后，T013 与 T014 可并行编写（互不依赖，分别验证解析器纯函数本身与真实闭包结果）
- T010 是唯一的强汇合点：必须等 T003 + T006 + T007（骨架）+ T008 + T009（均已写出红测试）后才能开始实现，因为 CLI 层直接组装两层的导出符号且需对齐两测试文件的全部断言
- T016 是唯一的终止汇合点：必须等 T011（脚本挂载）+ T015（parser 实现）全部完成

---

## FR 覆盖映射表

| FR | 描述摘要 | 覆盖任务 |
|----|---------|---------|
| FR-001 | 四态返回结果（`in-sync`/`drift`/`not-applicable`/`indeterminate`，含 `indeterminateKind` 两变体） | T003（`aggregateStatus`）+ T010（`checkJudgeSnapshotDrift` 顶层优先级）+ T008（Part A 全 12 场景穷举） |
| FR-002 | `JUDGE_FILE_SET` 精确覆盖 6 个文件 | T001（骨架落地常量）+ T002（长度与内容断言）+ T003（实现固化） |
| FR-002b | 守卫测试：真实 import 闭包 == `JUDGE_FILE_SET`；解析器本身 fail-closed 且经独立 fixture 验证 | T012（骨架+fixture）+ T013（解析器 fixture 单测，含非字面量 dynamic import fail-closed）+ T014（真实闭包测试）+ T015（实现） |
| FR-003 | 两侧现算 sha256、字节级比对、不持久化 | T005（`computeSha256` 确定性）+ T006（实现）+ T002/T003（`compareFile`） |
| FR-004 | 零新增 npm 运行时依赖，仅 `node:crypto`/`node:fs` 等内置模块 | T003 + T006 + T010（实现时人工核对 import 来源）+ T016（`npm run build`/`repo:check` 间接验证无新依赖引入 `package.json`） |
| FR-005 | 核心判定以显式 `projectRoot` 为合同，非仓库参照 → `not-applicable` | T010（实现）+ T008（Part A 场景 1） |
| FR-006 | 无任何已安装快照 → `not-applicable` | T010（实现）+ T008（Part A 场景 2） |
| FR-007 | active-version 四步解析优先级 + W1 全部边界（canonicalize 去重/scope 优先级/候选含 error 整体转 source-error/先过滤再判歧义），禁止"取最高版本号"兜底 | T002（`resolveActiveSnapshot` 全量穷举）+ T003（实现）+ T008（Part A 场景 3、4、4b、4c、5、6） |
| FR-008 | 读取失败（EACCES）/元数据损坏 → 该项降级 `indeterminate`，不阻断，且保留已确认明细（`comparison-indeterminate` 变体） | T005（判别式联合三态：`absent`/`invalid`/`error`）+ T006（实现）+ T008（Part A 场景 3、11、12） |
| FR-009 | 独立只读 doctor 命令；`drift` 时仍退出码 0；不挂载 `repo:check` | T010（`main` 恒 0 退出逻辑）+ T011（脚本挂载）+ T009（spawnSync 真实进程退出码断言）+ T016（`repo:check` 反向验证未挂载） |
| FR-010 | 不修改 `stop-fix-compliance-check.sh` 现有 exit code 语义 | T016（边界确认，逐字节不变核实） |
| FR-011 | 输出只描述状态，不含修复建议 | T010（`formatReport` 按 `indeterminateKind` 分支实现）+ T009（spawnSync 断言 stdout 不含修复措辞）+ T008（Part A/B 输出结构断言不含 remediation 字段） |
| FR-012（SHOULD） | `drift` 结果标注 `missingInSnapshot`/`missingInRepo`/`missingBoth` 三态区分 | T002（`compareFile` 九组合含 `missingBoth`）+ T008（Part A 场景 8、9、10 区分 mismatch/missingInSnapshot/missingBoth） |
| FR-013（YAGNI-移除） | Stop hook 内嵌漂移提示 | 不适用，非本次范围，无对应任务 |

**FR 覆盖率**：13 条 FR 中，11 条 MUST + 1 条 SHOULD 均有对应任务；FR-013 已在 spec 中明确标注 `[YAGNI-移除]`，不构成覆盖缺口。

---

## 推荐实施策略

**单线程串行执行（推荐，风险最低）**：本 feature 复杂度 LOW-MEDIUM、组件数少、无 User Story 需要拆分交付，不建议拆分并行小组。按 T001→T002→T003→(T004→T005→T006 与前者部分并行)→T007→T008/T009→T010→T011→T012→T013/T014→T015→T016 的自然依赖顺序单线程推进即可，全程约 16 个提交粒度的独立可验证步骤（骨架任务通常与紧随其后的测试任务合并为同一提交，避免"仅骨架无测试"的中间态被误提交）。

**若需并行（人力充足场景）**：T001 与 T004 可分派给两人同时写骨架；T002 与 T005 可同时写测试；T003 与 T006 可同时写实现；T008 与 T009 可同时写 CLI 测试（均依赖 T007 骨架）；T013 与 T014 可同时写 FR-002b 测试（均依赖 T012 骨架）；T010 必须等前置全部汇合后由一人完成（唯一强依赖点）。

**MVP 边界**：本 feature 本身即为 MVP 最小范围（无法再拆分 User Story），T001~T016 全部完成才构成可交付的完整增量；不存在"先做一半再迭代"的中间可用态（doctor 命令必须四态齐全才有诊断价值，缺任一态会让开发者误判"无漂移"或"命令坏了"）。
