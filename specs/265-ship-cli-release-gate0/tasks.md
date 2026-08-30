# Tasks: F265 — Gate 0：发布与度量硬前置

**Input**: `plan.md`（架构决策 A–F + §F 批次划分 + §测试策略）、`spec.md`（25 FR / 4 User Story）、`research/probe-findings.md`（P1–P7）、`research/code-context.md`
**Branch**: `claude/spectra-cli-4-5-0-release-959ec9`

**约定**：`- [ ] TXXX [P?] [USN?] 描述 + 文件路径`。`[P]` = 可与同批次内其它 `[P]` 任务并行（不同文件、无依赖）。Setup/Foundational/Polish 阶段不标 `[USN]`。测试任务与实现任务严格分离，不合并。

---

## Phase 1: Setup

无需独立 Setup 阶段——本卡不新增顶层目录、不新增依赖、不需要脚手架初始化（plan.md §Constraints：零新增运行时依赖）。直接进入 Batch 1。

---

## Phase 2: Foundational

无阻塞性前置依赖——4 个批次彼此在文件、测试、CI 插入点上互不阻塞（plan.md Summary 末句）。直接按批次展开。

---

## Batch 1（User Story 1，P1）— G0-1 版本对齐

**目标**：`contracts/release-contract.yaml` 版本号与仓库实际代码状态对齐，CHANGELOG 补齐至 `[4.5.0]`，`release:check`/`release:publish:dry` 通过，具备执行 `npm publish` 的条件。

**独立测试**：不涉及 Batch 2/3/4 任何改动，单独改 `contracts/release-contract.yaml` + 跑 `npm run release:sync` + 补 CHANGELOG，`npm run release:check` 与 `npm run release:publish:dry` 即可独立验证通过（spec.md Independent Test）。

**对应 FR**：FR-001 ~ FR-008

- [x] T001 [US1] 修改 `contracts/release-contract.yaml`：`products.spectra.version` 由 `4.4.0` 改为 `4.5.0`，`products.spec-driver.version` 由 `4.4.2` 改为 `4.4.3`（两条版本线独立递增，不要求同号）
  验证：`git diff contracts/release-contract.yaml` 人工核对仅改这两处版本字段
  依赖：无

- [x] T002 [US1] 执行 `npm run release:sync`，使 `package.json`、`package-lock.json`、`plugins/spectra/.claude-plugin/plugin.json`、`plugins/spectra/.codex-plugin/plugin.json`、`plugins/spec-driver/.claude-plugin/plugin.json`、`plugins/spec-driver/.codex-plugin/plugin.json`、`plugins/*/README.md`、`README.md`、`specs/products/product-mapping.yaml`、`specs/products/*/current-spec.md`、`.claude-plugin/marketplace.json` 全部由脚本生成同步（禁止手改这些派生文件——FR-001）
  验证：`git diff --stat` 确认改动文件清单与上述列表一致，且逐一核对新版本号正确写入
  依赖：T001

- [x] T003 [US1] 补写 `CHANGELOG.md`：新增 `[4.2.0]`（区间 `v4.1.1..27ce6fbe`，132 commit，按 F2xx 卡聚合，非逐 commit）条目，摘要素材取自 `contracts/release-contract.yaml` 的 `productMappingDescription` 字段（已入库一手摘要，据此改写不算"事后重构"、不需标 `[推断]`——FR-005）
  验证：`grep -A5 '## \[4.2.0\]' CHANGELOG.md` 确认条目存在且措辞未超出一手摘要与 commit message 字面信息（超出部分须标 `[推断]`）
  依赖：T002

- [x] T004 [P] [US1] 补写 `CHANGELOG.md`：新增 `[4.3.0]`（区间 `27ce6fbe..fbb0b88a`，140 commit）条目
  验证：`grep -A5 '## \[4.3.0\]' CHANGELOG.md`
  依赖：T002（与 T003 可并行，同文件不同段落，若担心编辑冲突可顺序执行）

- [x] T005 [US1] 补写 `CHANGELOG.md`：新增 `[4.4.0]`（区间 `fbb0b88a..0d292e3b`，163 commit；须注明实际发布 `gitHead` 为 `0ae3eb70`，与 bump commit `0d292e3b` 相差 9 个 commit——research/probe-findings.md P5）条目
  验证：`grep -A5 '## \[4.4.0\]' CHANGELOG.md`
  依赖：T003, T004

- [x] T006 [US1] 补写 `CHANGELOG.md`：新增 `[4.5.0]`（区间 `0ae3eb70..HEAD`，71 commit，其中动 `src/` 的 18 个；本次 F265 改动本身也计入此区间）条目，覆盖本卡 Batch 1-4 全部变更摘要
  验证：`grep -A5 '## \[4.5.0\]' CHANGELOG.md`；确认本条目在 implement 阶段收尾时（所有 Batch 完成后）回填完整
  依赖：T005（内容上应在其余 3 个批次实现完成后最终定稿，但骨架可先占位）

- [x] T007 [US1] 处置 `CHANGELOG.md` 现存 `[Unreleased]` 段（行 47-290，F140 内容）：按 FR-004 `[AUTO-RESOLVED]` 方案，改标题去掉 "Unreleased" 字样、归入 `[4.1.1]`（已考证该段内容实际随 4.1.1 一并发布——research/probe-findings.md P7，`b3b15fb7` 是 `v4.1.1` tag 祖先且早 15 小时，此为 git 可证事实、不标 `[推断]`）
  验证：`grep -c '\[Unreleased\]' CHANGELOG.md` 应为 0；`git log -1 --format='%ci' v4.1.1` 与 `git log -1 --format='%ci' b3b15fb7` 复核时间顺序
  依赖：T002（与 T003-T006 无顺序依赖，可并行，但同文件建议顺序编辑避免冲突）

- [x] T008 [US1] 跑 `npm run release:check`，确认 exitCode=0、无 fail 级 check（FR-006）
  验证：`npm run release:check` 命令本身即验证
  依赖：T002, T003, T004, T005, T006, T007

- [x] T009 [US1] 跑 `npm run release:publish:dry`，确认 exitCode=0 且未触发真实 `npm publish` 网络请求（FR-007）
  验证：`npm run release:publish:dry` 命令本身即验证；人工确认命令输出不含"published"等真实发布字样
  依赖：T008

- [x] T010 [US1] 产出"给用户的发布命令清单"文档片段（写入 `specs/265-ship-cli-release-gate0/RELEASE-COMMANDS.md` 或追加到本 feature 目录下的交付说明；**不是**执行 `npm publish` 本身——FR-008 明确 MUST 由用户在 host shell 手动执行）：列出 `npm publish`（spectra-cli 包）及必要的前置检查命令（`npm whoami`、`npm run release:publish:dry` 复核）
  验证：文档存在且明确标注"以下命令由用户在 host shell 手动执行，本卡自动化流程不代为触发"
  依赖：T009

---

## Batch 2（User Story 2，P1）— G0-2 CI 治理链 + 发布断层预警

**目标**：CI 每次 push/PR 自动跑 `repo:check`/`release:check`；`release:check` 新增领先量 warning 判据，覆盖三种"事实源不可达"情形，非阻断。

**独立测试**：单独改 `.github/workflows/ci.yml` 与新增 `publish-gap-check.mjs`，用 `SPECTRA_PUBLISHED_REF` 覆盖入口注入不同 `gitHead` 构造"领先 N≥5"与"领先 N<5"两种场景，观察 warning 出现与否及 exitCode（spec.md Independent Test）。

**对应 FR**：FR-009 ~ FR-013

- [x] T011 [US2] 新增 `scripts/lib/publish-gap-check.mjs`：导出 `checkPublishGap({ publishedRefOverride, execFileSyncImpl })`（依赖注入 `execFileSync` 便于离线测试）。内部逻辑：
  1. 若 `process.env.SPECTRA_PUBLISHED_REF`（或传入的 `publishedRefOverride`）存在，优先使用该值作为已发布 ref（`PublishedRefResolution.source='env-override'`）；否则 `execFileSync('npm', ['view', 'spectra-cli', '--json'], { timeout: 5000, encoding: 'utf8' })` 取 `gitHead` 字段（`source='npm-view'`）
  2. `npm view` 超时/失败 → `{ status: 'indeterminate', reason: 'network' }`（FR-011a）；返回结果无 `gitHead` 字段 → `reason: 'missing-git-head'`（FR-011b）
  3. 拿到 ref 后用 `execFileSync('git', ['cat-file', '-e', ref])` 校验该 commit 在本地仓存在；不存在 → `reason: 'unreachable-commit'`（FR-011c）
  4. 存在则 `execFileSync('git', ['rev-list', '--count', `${ref}..HEAD`, '--', 'src/'])` 得到 N；N≥5 → 产出 `ReleaseGapWarning`（`sourceStatus:'ok'`, `publishedCommitStatus:'resolved'`）；N<5 → 不产出
  5. 返回值类型 **不含 `errors` 字段**（只有 `checks`/`warnings`），这是结构性保证（架构决策 A）
  全部子进程调用用 `execFileSync`（非 `execSync`），不经 shell 解释（避免命令注入面，对齐 `spectra-version-gate.mjs` 既有纪律）
  验证：本任务本身不含独立验证命令，验证在 T014（测试任务）中完成
  依赖：无（可与 T012 并行准备，但 T012 依赖 T011 存在才能接线）

- [x] T012 [US2] 修改 `scripts/validate-release-contracts.mjs`：把 `checkPublishGap()` 的 `checks`/`warnings` 作为第三个合并源，扁平合并进 `payload`（复用既有 `validateCodexPluginConsistency` 的合并范式，第 12-26 行同构写法）；确认 `payload.status` 计算式 `payload.errors.length > 0 ? 'fail' : payload.status` 中 `payload.errors` 的构造表达式从未引用 `checkPublishGap()` 的返回值
  验证：`grep -n "checkPublishGap" scripts/validate-release-contracts.mjs` 确认调用点存在；人工过一遍 `payload.errors` 赋值链路确认无新增来源
  依赖：T011

- [x] T013 [P] [US2] 修改 `.github/workflows/ci.yml`：
  1. `Checkout` 步骤新增 `with: { fetch-depth: 0 }`
  2. 在既有 `Build Knowledge Graph`（`batch --mode graph-only`）步骤**之后**、`Test` 步骤**之前**，新增两步：`Repo Check`（`npm run repo:check`）→ `Release Check`（`npm run release:check`），均不加 `if: always()`
  验证：`grep -n "fetch-depth\|repo:check\|release:check" .github/workflows/ci.yml` 确认三处改动均落地且顺序正确（Build Knowledge Graph < Repo Check < Release Check < Test）
  依赖：无（与 T011/T012 不同文件，可并行）

- [x] T014 [US2] 新增测试 `tests/unit/publish-gap-check.test.ts`：**变异测试矩阵行 1**——注入 `SPECTRA_PUBLISHED_REF=<HEAD 前 N≥5 个 src commit 的祖先>`（用 `execFileSyncImpl` 依赖注入 mock，避免依赖真实网络/仓库状态），断言 `payload.warnings` 出现领先量文案、`payload.status !== 'fail'`、`exitCode === 0`
  验证：`npx vitest run tests/unit/publish-gap-check.test.ts -t "N>=5"`
  依赖：T011

- [x] T015 [US2] 扩展 `tests/unit/publish-gap-check.test.ts`：**变异测试矩阵行 2**——`SPECTRA_PUBLISHED_REF=<HEAD 前 N<5 个 src commit 的祖先>`，断言 `payload.warnings` 不含领先量文案
  验证：`npx vitest run tests/unit/publish-gap-check.test.ts -t "N<5"`
  依赖：T011（与 T014 同文件，顺序追加）

- [x] T016 [US2] 扩展 `tests/unit/publish-gap-check.test.ts`：**变异测试矩阵行 3**——两个子场景：(a) 注入一个本地仓库不存在的 40 位十六进制串作为 `SPECTRA_PUBLISHED_REF`（模拟 FR-011c）；(b) 不设覆盖入口 + mock `execFileSyncImpl` 对 `npm view` 调用抛超时错误（模拟 FR-011a）。断言两种场景均输出 `sourceStatus: 'indeterminate'` 提示、`exitCode === 0`，且不误判为"无领先"
  验证：`npx vitest run tests/unit/publish-gap-check.test.ts -t "indeterminate"`
  依赖：T011

- [x] T017 [US2] 扩展 `tests/unit/publish-gap-check.test.ts`：**变异测试矩阵行 4**——直接对 `checkPublishGap()` 返回值做类型/键检查，断言 `Object.keys(checkPublishGap(...)).includes('errors') === false`（锁定架构决策 A 的结构性不变量，防止未来合并时手滑把输出接进 `errors`）
  验证：`npx vitest run tests/unit/publish-gap-check.test.ts -t "no errors key"`
  依赖：T011

- [x] T018 [US2] 集成验证：跑 `npm run release:check`（无注入，走真实/降级路径）与 `SPECTRA_PUBLISHED_REF=<test-ref> npm run release:check`（走注入路径），确认端到端合并生效、CLI 层输出正常
  验证：命令本身；确认 T012 的合并逻辑与 T011 的判据函数在真实 CLI 调用链路下行为一致
  依赖：T012, T014, T015, T016, T017

---

## Batch 3（User Story 3，P2）— G0-3 doctor commit 比对 + MCP 版本自省

**目标**：doctor 四方一致性检查新增基于 commit 的比对维度（`match`/`mismatch`/`absent`/`unreadable`），MCP server 对外暴露 `{version, commit, dirty}` 自省信息，两者均遵守脱敏纪律（commit 原串任何时刻 MUST NOT 出现在报告正文/日志/返回体）。

**独立测试**：单独改 `codex-runtime-doctor-core.mjs` 与 `src/mcp/server.ts` 即可验证——构造 commit 相同/不同/缺失三种场景跑 doctor；单独起 MCP server 用官方 SDK 客户端解析自省信息（spec.md Independent Test）。

**对应 FR**：FR-014 ~ FR-019

**⚠️ 强制内部顺序**：本批次内**先落 MCP 自省（T019-T022），再落 doctor 侧对它的消费（T023-T026）**——`mcp-server` 类目的 doctor 探测函数依赖 MCP server 已暴露的自省通道，顺序颠倒会导致 doctor 侧探测函数无实际信号源可读（plan.md 架构决策 D + §F 批次表"同批次内部子依赖"）。

### 3a. MCP 自省先行（T019-T022）

- [x] T019 [US3] 修改 `src/mcp/server.ts`：A 路——`createMcpServer()` 内 `new McpServer({ name: 'spectra', version: pkg.version, description: resolveVersionString(buildMetaPath, pkg.version) }, ...)`，`serverInfo.description` 承载一行可读 build 串；`import { resolveVersionString } from '../cli/version-meta.js'`（复用既有函数，零新增解析代码）；`buildMetaPath` 用与既有 `pkgPath = resolve(__dirname, '..', '..', 'package.json')` 同一套相对路径算法解析 `dist/.spectra-build-meta.json`
  验证：`npm run build && node dist/cli/index.js mcp-server &` 后人工用 MCP inspector 或后续 T027 测试验证
  依赖：无

- [x] T020 [US3] 修改 `src/mcp/server.ts`：B 路——新增零参数工具 `server_build_info`，内联注册在既有 5 个内联工具（`prepare`/`generate`/`batch`/`diff`/`panoramic-query`）之后、三个 `registerXTools()` 分组调用之前；返回 `{ content: [{ type: 'text', text: JSON.stringify({ version, commit, dirty }) }] }`，`commit`/`dirty` 在 meta 缺失时为 `null`（非省略键）
  验证：`npm run build`（TS 编译零错误）；人工确认工具总数从 17 变为 18
  依赖：T019（同文件，共享 buildMetaPath 解析逻辑）

- [x] T021 [US3] 扩展 `tests/integration/mcp-server-stdio.test.ts`：**变异测试矩阵行 8（第一部分）**——`client.initialize` 完成后读 `client.getServerVersion()`，断言 `description` 字段非 `undefined` 且内容匹配 `spectra vX.Y.Z...` 形态
  验证：`npx vitest run tests/integration/mcp-server-stdio.test.ts -t "description"`
  依赖：T019

- [x] T022 [US3] 扩展 `tests/integration/mcp-server-stdio.test.ts`：**变异测试矩阵行 8（第二部分）**——`client.listTools()` 断言工具总数=18（17 既有 + 1 新增）、既有 17 个工具名逐一存在、代表性工具（如 `impact`/`context`）`inputSchema` 序列化后与改动前完全一致（防回归）；`client.callTool({ name: 'server_build_info', arguments: {} })` 断言返回 JSON 的 `version` 与 `package.json` 一致、`commit`/`dirty` 类型为 `string|null`/`boolean|null`
  验证：`npx vitest run tests/integration/mcp-server-stdio.test.ts -t "server_build_info"`
  依赖：T020

### 3b. doctor 侧消费（T023-T026，依赖 3a 完成）

- [x] T023 [US3] 修改 `plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs`（纯函数层）：新增 `ENUM_DOMAINS.commitComparison = Object.freeze(['match', 'mismatch', 'absent', 'unreadable'])`；新增导出纯函数 `compareCommits(a, b)`（任一为 `null` → `absent`；格式不像十六进制或长度<7 → `unreadable`；否则各取前 7 位小写比较 → `match`/`mismatch`）；`DETAILS_SCHEMA['repo-version']`/`['global-cli']`/`['plugin-build']`/`['mcp-server']` 各新增 `commitComparison: 'enum'` 键；`SUMMARY_TEMPLATES` 新增 4 个模板（按类目区分，参数只含 `product`，不含 commit 值本身）
  验证：`npx vitest run tests/unit/codex-runtime-doctor.test.ts`（既有测试不回归）
  依赖：T019, T020（doctor 侧对枚举/schema 的定义本身不依赖 MCP，但为保持"先 MCP 后 doctor"顺序统一编排，排在 3a 之后）

- [x] T024 [US3] 修改 `plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs`：
  1. 新增 `readLocalGitHead(projectRoot)`：`execFileSync('git', ['-C', projectRoot, 'rev-parse', 'HEAD'])`，非 git 工作区或失败返回 `null`（供 `repo-version` 方使用，见架构决策 C）
  2. 扩展 `global-cli` 探测函数：在同一函数作用域内新增局部辅助（不导出、不复用 core 层 `constrainVersionLine`/`parseVersionLine`）用 `/\(([0-9a-f]{7,40})\)$/` 从 `spectra --version` stdout 提取 commit 子串
  3. 扩展 `mcp-server` 探测函数：调用 T020 落地的 `server_build_info` 工具（或等价自省通道）读取 `{commit}`
  **⚠️ 显式核对**：本任务改动该文件的上述函数，**不 touch** 第 273 行的 `.find` 首匹配逻辑（P0-D 认领范围外）
  验证：`grep -n "readLocalGitHead\|server_build_info" plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs`；`git diff plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs -- :!$(git diff --stat | head -1)` 人工核对第 273 行未变
  依赖：T021, T022（消费 MCP 侧已验证可用的自省通道）

- [x] T025 [US3] 新增测试用例于 `tests/unit/codex-runtime-doctor.test.ts`：**变异测试矩阵行 5**——构造两个不同的 7 位十六进制字符串喂给 `compareCommits`，断言返回 `'mismatch'`；另加 `absent`（任一为 `null`）与 `unreadable`（格式不符）两个分支的单测
  验证：`npx vitest run tests/unit/codex-runtime-doctor.test.ts -t "compareCommits"`
  依赖：T023

- [x] T026 [US3] 扩展 `tests/unit/codex-runtime-doctor-redaction.test.ts`：
  1. **变异测试矩阵行 6**——构造一个含 40 位十六进制字符串的伪造 commit（形态与凭据同构），跑一遍四类目 commit 比对，断言 `JSON.stringify(report)` 全文不含该子串（FR-015/FR-016）
  2. **变异测试矩阵行 7**——正常路径跑 `plugin-build` 类目，断言 `commitComparison === 'absent'` 恒定，不因任何输入变化（架构决策 C 的"锁定测试"要求）
  验证：`npx vitest run tests/unit/codex-runtime-doctor-redaction.test.ts`
  依赖：T024

- [x] T027 [US3] 人工验证：`npm run build && npm run codex:doctor`，人工过一遍真实报告文本，确认新字段渲染正常、无原串泄露、`plugin-build` 恒 `absent`
  验证：命令本身 + 人工目视
  依赖：T025, T026

---

## Batch 4（User Story 4，P2）— G0-4 度量基线工具（可与 Batch 1/2/3 并行）

**目标**：交付 adoption census 脚本（造尺子，不产出数字）与图质量复测冻结口径文档（主复用 `graph-accuracy.mjs`），不承诺回收任何实际数字。

**独立测试**：单独运行 census 脚本与 `graph-accuracy.mjs`，检查输出结构符合口径文档定义的 schema，不依赖 G0-1/G0-2/G0-3 是否完成（spec.md Independent Test）。

**对应 FR**：FR-020 ~ FR-025

- [x] T028 [P] [US4] 新增 `scripts/adoption-census.mjs`：零依赖（`node:fs`/`node:path`/`node:os`/`node:readline`）扫描 `~/.claude/projects/**/*.jsonl` 与 `~/.codex/sessions/**/*.jsonl`（逐行流式读取，非全量 load）；工具名识别正则 `/^mcp__(?:plugin_spectra_spectra|spectra)__(.+)$/`（两种前缀都要认）；未命中的 `mcp__*` 调用归入独立 `unknown` 桶；输出 `AdoptionCensusOutput`（`{generatedAt, sourceDirs, sourceStatus, tools, zeroCallTools}`）到 stdout（不写文件）；两目录均不存在/为空 → `sourceStatus: 'not-found'`/`'empty'`，exit 0，明确提示文案，不抛未捕获异常
  **⚠️ `~/.codex/sessions` 的 JSONL schema 未逐行实测确认**（`[待验证，[推断]]`——research/probe-findings.md P4-b 未覆盖此点，plan.md §E 明确标注）：实现时须先对着一个真实 `~/.codex/sessions/*.jsonl` 样本核实字段路径，对每一行做防御性解析（字段缺失/结构不符 → 跳过该行，不崩溃、不误计），不得照抄 Claude 侧 schema 假设 Codex 一致
  验证：见 T030（测试任务）
  依赖：无

- [x] T029 [P] [US4] 新增文档 `docs/design/f265-graph-quality-rerun-plan.md`：以 `scripts/graph-accuracy.mjs` 的 `--source`/`--graph`/`--baseline-repo`/`--baseline-commit`/`--baseline-scope` 为主复用清单；外部语料选定 `~/.spectra-baselines/gorm`（Go，F150/F151 已建立），`--baseline-commit` 具体 SHA 须在本任务执行时现读现填（`git -C ~/.spectra-baselines/gorm rev-parse HEAD`），不臆造；`specs/241-graph-keepalive-kb-grounding/pilot/` 下 `measurement-design.md`/`ledger.jsonl`/校验器列为次级/交叉参照（不重写、不平行建框架）；原样引用 `graph-accuracy.mjs` 自述的两条 Limitations（`label-only` 匹配不验证 caller 上下文、不区分 method 与 function），明确声明 `callRecall` 不等价于经上下文校验的 caller recall；M-1（grounding 命中率手工记账）与 M-3（review 发现率人工判真伪）各开一节，直接引用并链接 F241 `pilot/measurement-design.md` 对应章节的记账规则原文（"记账必须在调用当下写"/"判读者非盲"/"N=1 禁止外推"三条不可回退声明），附一份复用 `pilot/mcp-call-log.md` 列结构的记账表格骨架；标题/目录结构明确区分"协议，非可执行脚本"
  验证：人工核对文档五要素齐全（主复用清单、外部语料+具体 commit SHA、局限如实转述、M-1/M-3 协议节、"数字由发布后一周回收"声明）
  依赖：无（可与 T028 并行）

- [x] T030 [US4] 新增测试 `tests/unit/adoption-census.test.ts`：**变异测试矩阵行 9**——临时指向一个空目录作为数据源根，断言 `sourceStatus: 'empty'`、exit 0、不抛异常
  验证：`npx vitest run tests/unit/adoption-census.test.ts -t "empty"`
  依赖：T028

- [x] T031 [US4] 扩展 `tests/unit/adoption-census.test.ts`：**变异测试矩阵行 10**——构造一条 `mcp__unknown_tool_x__foo` 的伪造调用记录，断言归入 `unknown` 桶，不丢弃、不崩溃
  验证：`npx vitest run tests/unit/adoption-census.test.ts -t "unknown"`
  依赖：T028

- [x] T032 [US4] 集成验证：`node scripts/adoption-census.mjs`（本机跑一遍，人工核对输出 schema 符合 `AdoptionCensusOutput` 定义，不要求特定调用次数——FR-025 明确本卡不产出数字结论）
  验证：命令本身 + 人工核对 JSON schema
  依赖：T028, T030, T031

---

## Final Phase: Polish & Cross-Cutting Concerns

**依赖**：全部 4 个批次任务完成后执行。

- [x] T033 回填 `CHANGELOG.md` `[4.5.0]` 条目最终内容（T006 占位后，此处补全 Batch 2/3/4 的完整变更摘要，按 F265 卡整体聚合，不逐 commit）
  验证：`grep -A20 '## \[4.5.0\]' CHANGELOG.md` 人工核对覆盖 G0-1~G0-4 四个子目标
  依赖：T010, T018, T027, T032

- [x] T034 全量验证：依次执行 `npx vitest run`（全量单测/集成测试零失败）、`npm run build`（TS 编译零错误）、`npm run repo:check`、`npm run release:check`、`npm run release:publish:dry`
  验证：五条命令逐一 exitCode=0
  依赖：T033

- [x] T035 人工验证：`npm run codex:doctor` 复跑一遍，确认 Batch 3 改动在全量语境下无异常抛错、无原串泄露（与 T027 的差异在于此时 Batch 1/2/4 均已落地，环境更接近最终交付态）
  验证：命令本身 + 人工目视
  依赖：T034

- [ ] T036 撰写 dogfooding 反馈节：本次实现过程中使用 Spectra MCP（`detect_changes`/`impact`/`context`/`view_file` 等）与 Spec Driver 流程的实际体验，如实记录问题（MCP 连接/工具缺失/调用报错、返回信息是否够用、流程是否顺畅、结果是否准确）；若有实质反馈按条目格式 append 到 `docs/design/dogfooding-feedback-ledger.md`（状态：待处理）；若无实质反馈显式写"无"
  验证：交付报告末尾含此节，且非"无"时对应 ledger 已 append
  依赖：T034（在功能实现完成后回顾整个过程）

---

## FR 覆盖映射表

| FR | 任务 ID |
|---|---|
| FR-001 | T001, T002 |
| FR-002 | T001 |
| FR-003 | T003, T004, T005, T006 |
| FR-004 | T007 |
| FR-005 | T003 |
| FR-006 | T008 |
| FR-007 | T009 |
| FR-008 | T010 |
| FR-009 | T013 |
| FR-010 | T011, T014, T015 |
| FR-011 | T011, T016 |
| FR-012 | T011 |
| FR-013 | T011, T014, T015, T016 |
| FR-014 | T023 |
| FR-015 | T023, T026 |
| FR-016 | T026 |
| FR-017 | T019, T020 |
| FR-018 | T019, T020, T021, T022 |
| FR-019 | T024 |
| FR-020 | T028 |
| FR-021 | T028 |
| FR-022 | T028（不写文件的架构性保证） |
| FR-023 | T029 |
| FR-024 | T029 |
| FR-025 | T029, T032 |

**覆盖率**：25/25 FR = 100%。

---

## 依赖与并行说明

### Phase 依赖关系

```
Setup（无） → Foundational（无） → Batch 1 / Batch 2 / Batch 3 / Batch 4（四批互不阻塞，可并行）→ Final Phase
```

### 批次间依赖

- **Batch 1、Batch 2、Batch 3、Batch 4 彼此无强依赖**，可四线并行交付（plan.md §F："彼此在文件、测试、CI 插入点上互不阻塞"）。
- 唯一的跨批次关联是**信号而非阻塞**：Batch 3 落地 `src/mcp/server.ts`/`src/cli/version-meta.ts` 改动后，会推高 Batch 2 判据计算出的真实（非注入）N 值——这是预期且正确的行为，不影响 Batch 2 测试断言（全部走 `SPECTRA_PUBLISHED_REF` 注入的确定性场景）。
- Final Phase 依赖全部 4 个批次完成。

### 批次内部依赖（强制顺序）

- **Batch 3 内部硬顺序**：T019→T020（MCP 自省 A 路→B 路，同文件）→ T021→T022（MCP 侧测试）→ T023（doctor core 枚举/schema）→ T024（doctor io 消费 MCP 自省通道，**依赖 T021/T022 已验证 MCP 侧可用**）→ T025/T026（doctor 侧测试）→ T027（人工验证）。这条顺序是本卡唯一的强制内部依赖链，不可颠倒（plan.md 架构决策 D + §F 批次表）。
- **Batch 1 内部**：T001→T002（sync 需要先改 yaml）→ T003~T007（CHANGELOG 各版本段，可并行编辑但同文件建议顺序）→ T008→T009（校验需先补齐）→ T010。
- **Batch 2 内部**：T011（判据模块）是 T012/T014/T015/T016/T017 的前置；T013（CI workflow）与 T011 无关可并行；T018 汇总验证依赖前述全部完成。
- **Batch 4 内部**：T028/T029 可并行（不同文件）；T030/T031 依赖 T028；T032 依赖 T028+T030+T031。

### Story 内部并行机会

- Batch 1：T004 可与 T003 并行准备（不同版本段）。
- Batch 2：T013（CI workflow）与 T011（判据模块）可并行，因为分属不同文件且互不依赖。
- Batch 4：T028（census 脚本）与 T029（口径文档）可完全并行，分属不同交付物、不同文件、无共享状态。

### 推荐实现策略

**Parallel Team**（四批次并行）是本卡的推荐策略，理由：

1. plan.md 明确设计四批次"file-level 独立、无跨批次运行时耦合"，且每批次可独立回滚（`git revert <batch-commit>`）。
2. 若资源受限需要排序，建议顺序为 **Batch 1（P1，发布断层根因）→ Batch 2（P1，防止复发的护栏）→ Batch 3（P2，doctor+MCP 自省）→ Batch 4（P2，度量基线工具，可随时插空）**，与 spec.md 的 User Story 优先级（P1/P1/P2/P2）一致。
3. MVP 范围可收窄为 **Batch 1 单独交付**（US1）：即便 Batch 2/3/4 未完成，Batch 1 完成后即可具备 `npm publish` 的条件，是本卡价值密度最高的单一批次（spec.md 背景："不发布，M9 的可信活图链改进对任何用户都不存在"）。
