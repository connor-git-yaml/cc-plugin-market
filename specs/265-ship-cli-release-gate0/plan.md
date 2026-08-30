# Implementation Plan: F265 — Gate 0：发布与度量硬前置

**Branch**: `claude/spectra-cli-4-5-0-release-959ec9` | **Date**: 2026-08-30 | **Spec**: `specs/265-ship-cli-release-gate0/spec.md`
**Input**: `spec.md`（25 FR / 4 User Story）+ `research/code-context.md` + `research/probe-findings.md`（P1–P7 实测证据）+ SSoT `docs/design/milestone-M10-ship-honest-graph-evidence-gate.md` §3
**Mode**: story（无独立调研阶段，本 plan 直接基于既有制品与本次代码考古产出）

## Summary

本卡把 4 个互相独立、但共享"发布断层曾经隐身"这一根因的子目标（G0-1 版本对齐 / G0-2 CI 治理链 / G0-3 doctor+MCP 自省 / G0-4 度量基线工具）落成可验收的技术方案。核心技术路线：

- **G0-1**：纯配置 + 文档改动，走既有 `contracts/release-contract.yaml` → `npm run release:sync` 传导链，不新增代码。
- **G0-2**：在 `release:check` 的薄壳层（`scripts/validate-release-contracts.mjs`）新增第三个"合并源"——一个全新的、与 `validateReleaseContract` 完全解耦的 `scripts/lib/publish-gap-check.mjs`，专责"HEAD 领先已发布版本 N 个 src commit"的 warning 判定；CI 侧把 checkout 改为 `fetch-depth: 0` 并插入 `repo:check` + `release:check` 两步。
- **G0-3**：doctor 侧新增一个纯函数 `compareCommits`（`match|mismatch|absent|unreadable`），三处只读事实源（本地 `git rev-parse HEAD` / `spectra --version` 输出内嵌 commit / MCP 自省新增字段），比对结果落到既有 4 个版本类目（`repo-version`/`global-cli`/`plugin-build`/`mcp-server`）的 `details` 里，原始 commit 字符串的生命周期严格限制在各自的读取函数体内，绝不跨函数边界；MCP 侧采用 FR-018 裁定的 **C（A+B 组合）**：`serverInfo.description` 承载一行可读串 + 新增零参数工具 `server_build_info` 返回结构化 `{version, commit, dirty}`。
- **G0-4**：新增零依赖 `scripts/adoption-census.mjs`（扫 transcript 聚合调用次数）+ 一份冻结口径文档（钉外部语料，主复用 `scripts/graph-accuracy.mjs`），两者都只是"造尺子"，不产出数字。

四个子目标除"MCP 自省先于 doctor 消费它"这一同批次内部子依赖外，彼此在文件、测试、CI 插入点上互不阻塞，可分四个批次并行/顺序交付，每批次可独立回滚。

## Technical Context

**Language/Version**: TypeScript 5.x（`src/mcp/server.ts` 等）+ Node.js ESM `.mjs`（`scripts/`、`plugins/spec-driver/scripts/`），运行时 Node.js ≥20.x
**Primary Dependencies**: `@modelcontextprotocol/sdk` ^1.26.0（已有）、Node 内置 `node:child_process`/`node:fs`/`node:readline`（新增用法，零新增 npm 依赖）
**Storage**: 无新增持久化存储；`contracts/release-contract.yaml` 为既有配置事实源，不新增字段
**Testing**: vitest（`tests/unit/`、`tests/integration/`）+ `scripts/run-plugin-tests.mjs`（`.mjs` 插件测试面）
**Target Platform**: `ubuntu-latest`（CI）+ 本地 macOS/Linux 开发环境；不承诺 Windows
**Project Type**: Single project（本仓库既有单体结构，无需新增顶层目录）
**Performance Goals**: `release:check` 新增的 `npm view` 调用 MUST 在 5s 超时内失败降级；census 脚本对本机 ~1000 个 jsonl（近 30 天量级）应在数秒内完成（Node 内置 `readline` 逐行流式读取，非全量 load）
**Constraints**: 零新增运行时依赖（宪法 VIII/X）；新增 warning 判据 MUST NOT 改变 `release:check`/`repo:check` 的 exitCode 语义；doctor 新增字段 MUST NOT 破坏既有脱敏测试；MCP 新增能力 MUST 是对既有 17 工具 schema 的纯增量
**Scale/Scope**: 4 个既有模块的增量扩展（`release-contract` 治理链、doctor、MCP server、CI workflow）+ 3 个全新文件（`publish-gap-check.mjs`、`adoption-census.mjs`、图质量冻结口径文档）

## Constitution Check

*GATE：Phase 0 研究前必须通过；Phase 1 设计后复检。*

| 原则 | 适用性 | 评估 | 说明 |
|---|---|---|---|
| I 双语文档规范 | 适用 | PASS | 本 plan 及后续 tasks/CHANGELOG 均中文散文 + 英文标识符 |
| II Spec-Driven Development | 适用 | PASS | 本卡走 story 模式全流程（spec→plan→tasks→implement→verify） |
| III 如无必要勿增实体（YAGNI） | 适用 | PASS | census 脚本零可插拔抽象（FR-021）；图质量文档主复用 `graph-accuracy.mjs` 不建平行框架（FR-023）；MCP 自省不新建"自省工具组"模块，单工具直接内联注册；doctor commit 比对复用既有 4 类目，不新建第 5 个"commit-consistency"顶层类目 |
| IV 诚实标注不确定性 | 适用 | PASS | Assumption 3/5 在本 plan §架构决策 B/E 中给出结论并标注推导依据；Codex JSONL transcript 的精确 schema 在 §E 明确标注 `[待验证]`（留待 tasks/implement 阶段实测确认，不假装已知） |
| V AST 精确性优先 | 不适用 | N/A | 本卡不改动结构化数据提取链路 |
| VI 混合分析流水线 | 不适用 | N/A | 同上 |
| VII 只读安全性 | 适用 | PASS | census 脚本对 `~/.claude/projects`/`~/.codex/sessions` 只读扫描，不写回、不落库原始 transcript（FR-022） |
| VIII 纯 Node.js 生态 | 适用 | PASS | 零新增依赖，全部用 Node 内置模块 |
| IX Prompt 编排 + Harness 强制 | 不适用 | N/A | 本卡不改 spec-driver 编排 Prompt |
| X 零运行时依赖（spec-driver） | 适用 | PASS | doctor 侧改动仍是零依赖 `.mjs` |
| XI 质量门控不可绕过 | 适用 | PASS | 本卡是在**加固**质量门控（CI 接入治理链），不涉及绕过 |
| XII 验证铁律 | 适用 | PASS | 见"测试策略"一节，含变异测试 |
| XIII 向后兼容 | 适用（硬约束） | PASS | doctor 新增字段为 `DETAILS_SCHEMA` 增量键；MCP 新增能力为增量注册，既有 17 工具 schema 逐字不变（测试断言） |
| XIV 可观测性与架构守护 | 适用 | PASS | 新模块 `publish-gap-check.mjs`/`adoption-census.mjs` 各自单一职责，不引入循环依赖；不改动任何既有函数签名 |

无 VIOLATION，无需 Complexity Tracking 豁免条目。

---

## 架构决策

### A. G0-2 判据的落点与形态

**决策：新增独立模块 `scripts/lib/publish-gap-check.mjs`，只被 `scripts/validate-release-contracts.mjs`（release:check 薄壳）调用，`scripts/lib/release-contract-core.mjs` 的 `validateReleaseContract` 保持零改动。**

理由（三点，均基于代码实证）：

1. **职责边界**：`validateReleaseContract` 目前是纯本地文件比对（`readFileSync`/`readJson`，零网络、零子进程），被两个调用方共享——`scripts/validate-release-contracts.mjs`（release:check）与 `scripts/lib/repo-maintenance-core.mjs`（repo:check，第 304 行 `validateReleaseContract(resolvedRoot)`）。若把 `npm view`（网络）+ `git rev-list`（子进程）塞进这个函数内部，`repo:check` 会被动继承一次网络调用——即便 `repo-maintenance-core.mjs` 从不读取 `.warnings` 字段、结果被静默丢弃，`repo:check` 仍会多背上 5s 超时预算与一次真实网络请求，而 FR-009/FR-010 从未要求 `repo:check` 具备这个能力。保持 `validateReleaseContract` 纯本地、快、零网络，是对它两个调用方共同的隐性契约，不能因为其中一个新需求就悄悄改变。
2. **既有先例可复用**：`validate-release-contracts.mjs` 已经在做"薄壳合并第二个校验源"——`validateCodexPluginConsistency` 的 `checks`/`errors`/`warnings` 就是在薄壳层被扁平合并进 `payload`（第 12-26 行），且注释已明写"`validateReleaseContract` 自身当前不产出 warnings，缺失时以空数组起底"。`publish-gap-check.mjs` 是第三个同构合并源，不是新架构，是对已确立范式的复用。
3. **可测性**：网络/子进程调用必须做依赖注入才能离线跑变异测试（卡面硬约束）；把它隔离在独立模块里，才能像 `tests/unit/codex-plugin-consistency-core.test.ts` 那样用纯函数单测验证，不用真起网络。

**硬约束的结构性保证**（不是"注意不要"，是代码结构上不可能）：`publish-gap-check.mjs` 导出的 `checkPublishGap()` 返回值类型 **不包含 `errors` 字段**（只有 `checks`/`warnings`）。`validate-release-contracts.mjs` 里 `payload.status` 的计算式是：

```js
payload.status = payload.errors.length > 0 ? 'fail' : payload.status;
```

`payload.errors` 只由 `validateReleaseContract` 自身与 `validateCodexPluginConsistency` 的 `errors` 构成；`publish-gap-check.mjs` 的输出从未进入这个数组的构造表达式——这是类型层面的不可达，不是运行时判断。测试层面另加一条断言：`Object.keys(checkPublishGap(...)).includes('errors') === false`，把这条不变量锁进用例，防止未来有人在合并时手滑把它的输出接进 `errors`。

**进程边界**：`release:check` 是同步 CJS/ESM `.mjs` 脚本，`checkPublishGap` 内部用 `child_process.execFileSync`（而非 `execSync`）——理由与仓内既有 `spectra-version-gate.mjs` 的 `spawnSync(...)` 用法一致：`execFileSync`/`spawnSync` 不经过 shell 解释，避免命令注入面（`npm view` 的包名是硬编码字面量 `spectra-cli`，但保持这个纪律对未来改动更安全）。`npm view spectra-cli --json` 与 `git rev-list --count <ref>..HEAD -- src/`、`git cat-file -e <ref>` 均以 `execFileSync(cmd, args, { timeout: 5000, encoding: 'utf8' })` 形式调用；`npm view` 单独设 5s 超时（FR-012 要求），git 本地调用不设网络超时（本机操作，理论上不会挂起，若挂起属于更底层的仓库损坏问题，超出本卡范围）。

**`SPECTRA_PUBLISHED_REF` 的语义边界**：定位为**测试注入入口，非用户可支持的生产配置**。

- 代码里只在函数入参默认值处读取 `process.env.SPECTRA_PUBLISHED_REF`，不写入任何面向用户的文档（README/CHANGELOG），只在 `publish-gap-check.mjs` 顶部注释里说明"测试专用覆盖入口"。
- CI workflow 中 **不设置** 这个变量，确保 CI 走真实 `npm view` 路径（或其失败降级路径），这样 CI 才是对"离线场景 fail-loud"设计的真实回归覆盖，而非被覆盖入口悄悄绕过。
- 误用收口：即便有用户在本地手滑设置了这个变量，其值仍会经过与 `npm view` 返回结果同样的下游校验（`git cat-file -e <ref>` 存在性检查）——设置一个不存在于本地仓库的 commit-ish，判据会诚实输出 `sourceStatus: 'indeterminate'`（FR-011(c) 路径），不会伪造出一个"看似成功"的比对结果，误用的代价被架构性地限制在"看不到有用信息"而非"看到错误信息"。

### B. G0-2 的 CI 接入位置

**决策**：在 `.github/workflows/ci.yml` 中：

1. `Checkout` 步骤新增 `with: { fetch-depth: 0 }`（当前隐式 `fetch-depth: 1`）。
2. 在既有 `Build Knowledge Graph`（`node dist/cli/index.js batch --mode graph-only`）步骤**之后**、`Test` 步骤**之前**，新增两步：`Repo Check`（`npm run repo:check`）→ `Release Check`（`npm run release:check`）。两步均**不加** `if: always()`（默认 fail-fast：若 lint/build/建图任一步已失败，这两步应被跳过，因为在一个已知损坏的构建上跑治理检查没有意义；这与 `Test Plugins (mjs gate)` 步骤加 `if: always()` 的既有理由——防止 vitest flaky 短路掉 162 个 mjs 测试——是两类不同问题，不应该套用同一处理）。

**理由**：

- **顺序**：`repo:check` 内部的 `graph-quality:*` 判据依赖 `specs/_meta/graph.json`（该路径被 `.gitignore`），干净 checkout 不存在此文件；必须排在图建成之后（本仓实测 P6：`npm run repo:check` 在本地已含图的 worktree 里 exit 0 仅 1 条 warning，证明该依赖关系真实存在，顺序颠倒会在 CI 干净 checkout 上必红）。`release:check` 本身不依赖 `dist/`（`validateReleaseContract` 只读 yaml/json/md，`publish-gap-check.mjs` 只读 git/npm），理论上可以更早跑，但放在 `repo:check` 之后统一治理链语义上更清晰（"先建图 → 两个治理门一起过"），且不会引入额外风险。
- **`fetch-depth: 0`**：这是本卡对 Assumption 3 的关键补充发现——**默认 `actions/checkout@v4` 是浅克隆（depth 1）**，而 FR-011(c) 的"`gitHead` 对应 commit 在本地仓不存在（浅克隆场景）"在**默认 CI 配置下会是每次 CI 运行都必然触发的常态**，不是边缘情形。已发布版本对应的 `gitHead`（如 `0ae3eb70`）是几十到上百个 commit 之前的历史提交，浅克隆看不到它，`git cat-file -e` 必然失败——若不改成全量拉取，`release:check` 在 CI 上会**永远**只输出 indeterminate，SC-002 承诺的"能在 CI 日志中看到非阻断 warning"就无法兑现，整个 G0-2 的核心价值在 CI 场景下形同虚设。这不是"可选优化"，是让 FR-010 的真实分支在 CI 上可达的必要条件。代价是 checkout 变慢（本仓仓库体积中等，一次性全量 clone，对单条 CI job 的影响在可接受范围，且只影响 `Checkout` 一步，不影响后续步骤）。
- **不加 `if: always()`**：`release:check` 判据的"网络不可达"分支本身已经在函数内部被设计为**不产出非零 exitCode**（见架构决策 A 的结构性保证）——也就是说，"CI 上 npm registry 出网失败会不会把整条 CI 弄红"这个 Assumption 3 的待验证项，答案是**不会**，且这个"不会"是通过判据自身的降级路径架构性保证的，不需要在 CI workflow 层面额外加 `if: always()` 兜底。加了反而会掩盖"这一步在 lint/build 阶段就该失败"的真实问题。

### C. G0-3 doctor 的 commit 比对与脱敏不变量的共存

**"四方"的代码事实（读 `codex-runtime-doctor-core.mjs` 逐行确认，不采用 spec.md Acceptance Scenario 的字面措辞）**：

文件头注释自称"Feature 240 / A4-2 — **四方**一致性诊断"，`CHECK_CATEGORIES` 实际有 5 个（`repo-version`/`global-cli`/`plugin-build`/`mcp-server`/`hook-trust`）；`hook-trust` 是一个**正交**的类目（判定 Codex hook 信任状态，与版本/commit 比对无关），真正构成"四方版本比对"的是前 4 个类目。spec.md 用词"本地 dist / 已安装插件 / Codex 快照 / 参考基线"是产品语言表述，与这 4 个类目**不是逐字对应**——本 plan 按代码事实重新定锚：

| 类目 | 数据源 | 是否天然携带 commit |
|---|---|---|
| `repo-version` | `contracts/release-contract.yaml` 的 `products.*.version` | **否**——schema 里从未有 commit 字段（G0-2 已明确裁定不新增持久化字段，FR-012） |
| `global-cli` | `spectra --version` 子进程 stdout 首行 | **是**——`src/cli/version-meta.ts` 的 `resolveVersionString()` 在 build-meta 存在时已把 commit(7) 编码进这一行（`spectra v4.4.0 (0ae3eb7)`），只是 `parseVersionLine`（core 层）当前把它约简成 `commitSuffixPresent` 布尔后丢弃原值 |
| `plugin-build` | Codex 已安装插件快照的 `.codex-plugin/plugin.json` 的 `version` 字段 | **否**——该 manifest schema 从未有 commit 字段；快照目录名虽是内容哈希，但 `probeCodexPluginManifest` 函数自己的注释明令"快照目录名是快照哈希，**绝不能**当版本用"（F236 教训），本卡不推翻这条裁决 |
| `mcp-server` | 当前 `probeMethod: 'none-available'`, `knownGap: true` | **本卡落地后才有**——正是本卡另一半交付物（MCP 自省）打通的信号源 |

**据此的比对范围限定（回答"要不要限定，要"）**：commit 比对新增维度只在 `repo-version`（作为基准，读取运行时 `git rev-parse HEAD`——见下）、`global-cli`、`mcp-server` 三个类目上产出有意义的 `match`/`mismatch`/`unreadable` 结果；`plugin-build` 的 `commitComparison` 字段恒为 `absent`，这是**如实反映事实**而非未完成事项，需要一条锁定测试防止未来被"顺手"接上快照目录哈希这类不可靠代理。

**`repo-version` 的 commit 来源**：现有 4 个类目里，`repo-version` 是唯一没有对应"运行中二进制"、只对应"声明"的一方，若不给它一个 commit 值，就无法构成"三方互相比对"的基准。方案：`repo-version` 的 commit 值取**运行 doctor 那一刻的本地 `git rev-parse HEAD`**（`codex-runtime-doctor-io.mjs` 新增 `readLocalGitHead(projectRoot)`，仅当 `projectRoot` 是 git 工作区时可读，否则 `absent`）。这不违反 G0-2"拒绝新增持久化 commit 字段"的裁决——那条裁决针对的是"把 npm 已发布版本的 gitHead 写死进 yaml"（一个需要人工维护、会过期的持久化字段）；这里是每次运行时的**活读取**，不持久化、不写回任何文件，语义上是"当前 checkout 站在哪个 commit 上"，与"release-contract 声明的是哪个 commit"并非同一件事，但对"自用 MCP 是不是跑的这次改动"这个真实诉求（SSoT §0）而言，"当前 checkout 的 HEAD"正是最贴切的比较基准。

**数据流（原串生命周期）**：

1. **`repo-version` 方**：`readLocalGitHead(projectRoot)`（io 层新函数）内部 `execFileSync('git', ['-C', projectRoot, 'rev-parse', 'HEAD'])`，返回值在该函数返回前已经是最终字符串或 `null`；调用方立刻把它喂给 `compareCommits(localHead, otherPartyCommit)`，`localHead` 变量的作用域到此为止，不再被传递、不进 `details`、不进日志。
2. **`global-cli` 方**：io 层现有的全局 CLI 探测函数已经拿到 `spectra --version` 的原始 stdout；新增一步在**同一函数作用域内**用 `/\(([0-9a-f]{7,40})\)$/` 从这一行提取 commit 子串（这是一个**局部、不导出**的辅助，与 core 层公开的 `constrainVersionLine`/`parseVersionLine` 无关，不复用、不共享，避免核心的"整行语法约束"逻辑被悄悄绕过或复杂化），提取到的字符串立刻传入 `compareCommits`，函数返回后原字符串同样不再向外传递。
3. **`mcp-server` 方**：新增探测函数调用 D 节裁定的自省通道（优先走结构化工具 B，读到 `{commit}`），同样局部读取、局部比较、局部丢弃。
4. **`compareCommits(a: string|null, b: string|null): 'match'|'mismatch'|'absent'|'unreadable'`**——放进 **core** 层（`codex-runtime-doctor-core.mjs`），因为它是零 I/O 纯函数，符合 core 文件既有职责边界（"纯函数层：零 I/O、零依赖"，文件头注释原话）。函数体：任一入参为 `null` → `absent`；两个都非空但长度不足 7 位或格式不像十六进制 → `unreadable`；否则各自取前 7 位小写比较 → `match`/`mismatch`。**返回值本身只可能是这 4 个字面量之一，天然满足脱敏**——这是"结构性边界优先于内容黑名单"这条既有设计哲学（文件头 F228 教训注释）在新增功能上的直接延续。

**schema/消息表新增键**：

- `ENUM_DOMAINS` 新增 `commitComparison: Object.freeze(['match', 'mismatch', 'absent', 'unreadable'])`。
- `DETAILS_SCHEMA['repo-version']` / `['global-cli']` / `['plugin-build']` / `['mcp-server']` 各自新增 `commitComparison: 'enum'` 键。
- `SUMMARY_TEMPLATES` 新增 4 个模板（`*-commit-match`/`*-commit-mismatch`/`*-commit-absent`/`*-commit-unreadable`，`*` 按类目区分，参数只含 `product`，**不含 commit 值本身**——`buildSummary` 的模板参数校验（`validateTemplateParam`）天然不认识"commit 字符串"这个类型，任何试图把原串塞进模板参数的写法都会在 `buildSummary` 内部抛错，这是第二层结构性防线）。

**四方比对的收敛**：`tests/unit/codex-runtime-doctor-redaction.test.ts` 新增用例：构造一个含 40 位十六进制字符串的伪造 commit（形态上与凭据同构，复用既有测试的红队思路）跑一遍四类目 commit 比对，断言报告 JSON 序列化后的**全文**（`JSON.stringify(report)`）不包含该子串——这是对"任何时刻 MUST NOT 进入报告正文、日志或返回体"最直接的回归锁定，同时验证 `plugin-build` 恒 `absent` 的不变量。

### D. G0-3 MCP 自省的实现落点

**决策**：FR-018 裁定的 **C（A+B 组合）**，两路均落在 `src/mcp/server.ts`，最大化复用 `src/cli/version-meta.ts` 已有的 `resolveVersionString()`。

**A 路（`serverInfo.description`）**：

- 落点：`createMcpServer()` 内 `new McpServer({ name: 'spectra', version: pkg.version }, { instructions: TOOL_GUIDE })` 的**第一个参数**（`serverInfo` 对象；P1 实测已确认 `description` 是 `ImplementationSchema` 的官方字段，落在这里而非第二个 `ServerOptions` 参数）。
- build meta 解析策略：`__dirname`（`dirname(fileURLToPath(import.meta.url))`）在编译后是 `dist/mcp`，在 tsx 直跑源码时是 `src/mcp`——两种情况下 `resolve(__dirname, '..', '..', 'dist', '.spectra-build-meta.json')` **都**正确指向仓库根下的 `dist/.spectra-build-meta.json`（这与文件里已有的 `pkgPath = resolve(__dirname, '..', '..', 'package.json')` 是同一套相对路径算法，已经过验证可在两种启动模式下工作，直接复用同一模式，不新增路径解析逻辑）。
- 复用而非重写：直接 `import { resolveVersionString } from '../cli/version-meta.js'`，`description: resolveVersionString(buildMetaPath, pkg.version)`。该函数已经实现"有 commit（≥7 位）→ 拼接；无/读失败/解析失败 → 优雅降级为纯版本号"的全部逻辑，且已有既存单测�covering 该函数本身——**零新增解析代码**，只是多一个调用点。缺 meta 时返回值退化为 `spectra v4.4.0`（无害字符串），不会导致 server 起不来（`resolveVersionString` 内部 `try/catch` 已兜底）。

**B 路（新增自省工具）**：

- 工具名：`server_build_info`（不与既有分析类工具的命名风格——`detect_changes`/`graph_query`——混淆语义；这是一个关于"服务器自身"而非"被分析代码库"的工具，命名上刻意区分）。
- 参数：零参数（`{}`，Zod raw shape 空对象，与 MCP SDK 现有工具的参数声明风格一致）。
- 返回：`{ content: [{ type: 'text', text: JSON.stringify({ version, commit, dirty }) }] }`；`commit`/`dirty` 在 meta 缺失时为 `null`（而非省略键，保持 `McpSelfIntrospection` 结构稳定，消费方无需做"键是否存在"判断，只需判断值是否为 `null`）。
- 注册落点：内联注册在 `createMcpServer()` 内，紧跟既有 5 个内联工具（`prepare`/`generate`/`batch`/`diff`/`panoramic-query`）之后、三个 `registerXTools()` 分组调用之前——不新建 `registerIntrospectionTools()` 模块。理由：单个工具不构成"一组"，仿照既有文件里对单体工具的处理方式（直接内联），新建一个只服务一个工具的注册函数是对宪法 III 的违反（过早抽象）。
- 是否算作宪法 XIII 的"既有 17 个工具 schema 不得变"违规：不算——这是第 18 个**新增**工具，17 个既有工具的名字/参数/返回结构逐一保持不变（测试断言，见下）。

**测试策略（两路统一）**：复用仓内**唯一**已有的 MCP 协议层测试范式——`tests/integration/mcp-server-stdio.test.ts` 用 `@modelcontextprotocol/sdk` 的 `Client` + `StdioClientTransport` **spawn 子进程**（`dist/cli/index.js mcp-server`），走真实 stdio JSON-RPC。**不引入 `InMemoryTransport`**：这个仓库里从未出现过 `InMemoryTransport` 的用法，为同一个测试目的引入第二套测试基础设施只会增加维护面，且 stdio 子进程方式更贴近生产环境（Claude/Codex 客户端也是通过 stdio 拉起这个 server），是更真实的回归证据。扩展该测试文件：

1. `client.initialize` 完成后，读 `client.getServerVersion()`（SDK 暴露的 `serverInfo`），断言其 `description` 字段能被正确解析（不是 `undefined`），且内容匹配 `spectra vX.Y.Z...` 形态——这是"经官方 SDK 客户端解析后仍可见"的直接证据，对齐 FR-018 的测试要求。
2. `client.listTools()` 断言：工具总数 = 18（17 既有 + 1 新增）；对既有 17 个工具名逐一断言仍存在，且其中若干代表性工具（如 `impact`/`context`）的 `inputSchema` 序列化后与改动前完全一致（防回归）。
3. `client.callTool({ name: 'server_build_info', arguments: {} })`，解析返回的 JSON 文本，断言 `version` 字段与 `package.json` 一致、`commit`/`dirty` 字段类型为 `string|null`/`boolean|null`。

### E. G0-4 两个交付物的边界

**adoption census 脚本**：`scripts/adoption-census.mjs`，零依赖（`node:fs`/`node:path`/`node:os`/`node:readline`）。

- **工具名识别**：正则 `/^mcp__(?:plugin_spectra_spectra|spectra)__(.+)$/`，两种命名前缀**都要认**——`mcp__plugin_spectra_spectra__*` 是当前 Claude Code plugin 环境下的规范命名（F170a 修复后的形态，本仓 sub-agent frontmatter 现状），`mcp__spectra__*` 是历史/Codex 侧或非插件化直连场景下可能出现的形态；两者匹配后取捕获组作为规范化的工具短名参与聚合。未命中任一前缀的 `mcp__*` 调用归入独立 `unknown` 桶（FR-020 要求，不丢弃）。
- **数据源与格式**：`~/.claude/projects/**/*.jsonl`（已实测本机存在，近 30 天 1118 个文件）逐行 JSON 解析，从消息体的 tool_use 块取 `name` 字段；`~/.codex/sessions/**/*.jsonl` 同理但其**精确 JSONL 内部 schema 本卡未逐行实测确认**——`[待验证，[推断]]`：本卡不假设已知 Codex transcript 的每个字段名，实现时对每一行做防御性解析（字段缺失/结构不符 → 跳过该行，不崩溃、不误计），并在 tasks/implement 阶段对着一个真实 `~/.codex/sessions/*.jsonl` 样本核实字段路径后再定稿解析逻辑，而不是照抄 Claude 侧的 schema 假设 Codex 一致。
- **输出**：仅打印到 stdout（`JSON.stringify(result, null, pretty ? 2 : 0)`），**不写文件**——这本身就是"原始 dump 不入库"的架构性保证（脚本没有写文件的代码路径，不存在"忘了 gitignore"的风险面）；调用者若要留存结果，自行重定向到一个不受版本控制的位置。
- **边界处理**：两个目录均不存在/为空 → `sourceStatus: 'not-found'`/`'empty'`，正常退出（exit 0）+ 明确提示文案，不抛未捕获异常（对应 Edge Case 与 FR-020 Acceptance Scenario 2）。

**图质量复测冻结口径文档**：新增 `docs/design/f265-graph-quality-rerun-plan.md`（与 SSoT 文档同目录，遵循既有 `docs/design/` 归档惯例）。

- **主复用目标**：`scripts/graph-accuracy.mjs`（632 行，已支持 `--baseline-repo`/`--baseline-commit`/`--baseline-scope`，四语言 truth-set 抽取）。
- **外部语料选定**：复用 F150/F151 已经建立的基线项目基础设施——`~/.spectra-baselines/gorm`（Go，`CLAUDE.local.md` 记录的已选定 baseline 之一，且 `graph-accuracy.mjs` 已有专门为 GORM 顶层包调优的 `--ignore-dirs` 用法先例，见脚本注释 "Codex Round 1 CRITICAL fix: 支持透传 ignoreDirs 给 Go extractor (FR-016 GORM 顶层包)"）。文档 MUST 钉死 `--baseline-commit`（具体 SHA 在 implement 阶段执行 `git -C ~/.spectra-baselines/gorm rev-parse HEAD` 现读现填，本 plan 阶段不臆造一个具体值）。**这回答了 spec Assumption 5 的 `[待验证]`**：外部语料来源确定为复用既有 GORM baseline clone，不新增语料、不新增 clone 脚本（YAGNI）。
- **次级/交叉参照**：`specs/241-graph-keepalive-kb-grounding/pilot/` 下的 `measurement-design.md`（口径原文）、`ledger.jsonl` + `ledger-verify.mjs`/`ledger-schema-check.mjs`（校验器），仅作历史口径对齐引用，不重写、不平行建框架。
- **局限如实转述**：文档 MUST 原样引用 `graph-accuracy.mjs` 自述的两条 Limitations（"label-only 匹配，不验证 caller 上下文"、"不区分 method 与 function"），并明确声明 `callRecall` 不等价于"经上下文校验的 caller recall"。
- **不可脚本化部分的交付形态**：M-1（grounding 命中率手工记账）与 M-3（review 发现率人工判真伪）**只交付协议文档 + 记账模板**——具体做法是在同一份冻结口径文档里各开一节，**直接引用并链接** F241 `pilot/measurement-design.md` 里对应章节的记账规则（"记账必须在调用当下写"、"判读者非盲"、"N=1 禁止外推"三条不可回退声明原样转载），并附一份可复制的记账表格骨架（复用 `pilot/mcp-call-log.md` 的列结构，不是重新设计一套新格式）。文档标题、目录结构、措辞层面 MUST 明确区分"这两节是协议，不是可执行脚本"，避免任何读者把它们误当自动化。

### F. 批次划分（供 tasks 阶段拆解）

| 批次 | 子目标 | 改动文件 | 验证命令 | 独立回滚边界 | 与其它批次的依赖 |
|---|---|---|---|---|---|
| **1** | G0-1 版本对齐 | `contracts/release-contract.yaml`；经 `npm run release:sync` 生成：`package.json`、`package-lock.json`、`plugins/spectra/.claude-plugin/plugin.json`、`plugins/spectra/.codex-plugin/plugin.json`、`plugins/spec-driver/.claude-plugin/plugin.json`、`plugins/spec-driver/.codex-plugin/plugin.json`、`plugins/*/README.md`、`README.md`、`specs/products/product-mapping.yaml`、`specs/products/*/current-spec.md`、`.claude-plugin/marketplace.json`；`CHANGELOG.md` | `npm run release:sync && npm run release:check && npm run release:publish:dry` | 是——纯配置/文档改动，`git revert` 该批次 commit 即可，不涉及任何逻辑代码 | 无前置依赖；**不触碰 `src/`**，因此不会改变 G0-2 判据用真实 HEAD 计算出的 src-commit 数 N |
| **2** | G0-2 CI + 判据 | 新增 `scripts/lib/publish-gap-check.mjs`；修改 `scripts/validate-release-contracts.mjs`（合并第三个校验源）；新增 `tests/unit/publish-gap-check.test.ts`；修改 `.github/workflows/ci.yml`（`fetch-depth: 0` + 两个新步骤） | `npx vitest run tests/unit/publish-gap-check.test.ts && npm run release:check && SPECTRA_PUBLISHED_REF=<test-ref> npm run release:check` | 是——`publish-gap-check.mjs` 是纯新增文件、`validate-release-contracts.mjs` 的改动是纯追加合并逻辑（不改既有分支），CI workflow 改动是纯追加两步；删除新文件 + revert 两处编辑即可完全回滚，`release-contract-core.mjs` 全程未被触碰 | 无强依赖；测试用 `SPECTRA_PUBLISHED_REF` 注入，与 Batch 1 是否已落地无关 |
| **3** | G0-3 doctor + MCP 自省 | `plugins/spec-driver/scripts/lib/codex-runtime-doctor-core.mjs`（新增 `commitComparison` 枚举域/schema 键/`compareCommits`/summary 模板）；`plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs`（新增 `readLocalGitHead`，扩展 global-cli/mcp-server 探测函数）；`src/mcp/server.ts`（`description` 字段 + `server_build_info` 工具）；`tests/unit/codex-runtime-doctor-redaction.test.ts`、`tests/unit/codex-runtime-doctor.test.ts`（扩展）；`tests/integration/mcp-server-stdio.test.ts`（扩展） | `npx vitest run tests/unit/codex-runtime-doctor*.test.ts tests/integration/mcp-server-stdio.test.ts`；`npm run build && npm run codex:doctor`（人工过一遍报告文本，确认无原串泄露） | 是——doctor 侧是既有 4 类目 `DETAILS_SCHEMA` 的增量键（未配置/未触发时行为与改动前一致）；MCP 侧是纯增量注册；两处均可单独 revert，互不牵连 | **同批次内部子依赖**：mcp-server 探测函数依赖 MCP 自省先落地（同一批次，需按"先 MCP 自省、后 doctor 消费"的顺序在 tasks 里排列）；不依赖 Batch 1/2 |
| **4** | G0-4 度量基线工具 | 新增 `scripts/adoption-census.mjs`；新增 `tests/unit/adoption-census.test.ts`；新增 `docs/design/f265-graph-quality-rerun-plan.md` | `npx vitest run tests/unit/adoption-census.test.ts`；`node scripts/adoption-census.mjs`（本机跑一遍，人工核对输出 schema） | 是——三个全新文件，删除即回滚，不触碰任何既有模块 | 无依赖，可与其它三批并行 |

**Batch 3 会小幅推高 Batch 2 判据的真实（非注入）N 值**——`src/mcp/server.ts`/`src/cli/version-meta.ts` 的改动落在 `src/` 下，落地后 `git rev-list --count <gitHead>..HEAD -- src/` 会比 18 更大。这是**预期且正确**的行为（正是 G0-2 要捕捉的信号），不是缺陷；因为 Batch 2 的测试全部走 `SPECTRA_PUBLISHED_REF` 注入的确定性场景，这个真实值的变化不影响任何测试断言。

---

## Project Structure

```text
specs/265-ship-cli-release-gate0/
├── plan.md              # 本文件
├── spec.md              # 已存在
└── research/            # 已存在（code-context.md / probe-findings.md）

（本卡 story 模式无独立 research.md/data-model.md/contracts/ 产出，
 关键契约已在本文件"Key Entities"引用 spec.md 原文定义，未新增）

# 改动落点（无新增顶层目录）
scripts/
├── lib/
│   └── publish-gap-check.mjs          # 新增（Batch 2）
├── adoption-census.mjs                # 新增（Batch 4）
└── validate-release-contracts.mjs     # 修改（Batch 2）

plugins/spec-driver/scripts/lib/
├── codex-runtime-doctor-core.mjs      # 修改（Batch 3）
└── codex-runtime-doctor-io.mjs        # 修改（Batch 3）

src/
├── mcp/server.ts                      # 修改（Batch 3）
└── cli/version-meta.ts                # 被复用，预期零改动（仅新增 import 消费方）

docs/design/
└── f265-graph-quality-rerun-plan.md   # 新增（Batch 4）

.github/workflows/ci.yml               # 修改（Batch 2）
contracts/release-contract.yaml        # 修改（Batch 1）
CHANGELOG.md                           # 修改（Batch 1）

tests/unit/
├── publish-gap-check.test.ts          # 新增（Batch 2）
├── codex-runtime-doctor-redaction.test.ts  # 扩展（Batch 3）
├── codex-runtime-doctor.test.ts       # 扩展（Batch 3）
└── adoption-census.test.ts            # 新增（Batch 4）

tests/integration/
└── mcp-server-stdio.test.ts           # 扩展（Batch 3）
```

**Structure Decision**：单体项目结构不变。所有改动都落在既有目录层级内的既有模块或其直接同级新文件，不新增任何顶层目录，不引入平行包/子项目。

---

## 测试策略

### 变异测试（卡面硬约束：新增判据必须能证明"会红"）

| 判据 | 变异构造 | 断言 |
|---|---|---|
| G0-2 领先量 warning | `SPECTRA_PUBLISHED_REF=<HEAD 前 N≥5 个 src commit 的祖先>` | `payload.warnings` 出现领先量文案；`payload.status !== 'fail'`；`exitCode === 0` |
| G0-2 领先量不误报 | `SPECTRA_PUBLISHED_REF=<HEAD 前 N<5 个 src commit 的祖先>` | `payload.warnings` 不含领先量文案 |
| G0-2 事实源不可达 | 注入一个本地仓库不存在的 40 位十六进制串作为 `SPECTRA_PUBLISHED_REF`（模拟 FR-011(c)）；另起一条不设覆盖入口 + mock `execNpmView` 抛超时错误（模拟 FR-011(a)） | 两种场景均输出 `sourceStatus: 'indeterminate'` 提示，`exitCode === 0`，且不误判为"无领先" |
| G0-2 warning 结构性不可能变红 | 直接对 `checkPublishGap()` 返回值做类型/键检查 | 断言返回对象不含 `errors` 键 |
| G0-3 commit mismatch | 构造两个不同的 7 位十六进制字符串喂给 `compareCommits` | 返回 `'mismatch'` |
| G0-3 commit 脱敏 | 构造一个 40 位十六进制"伪凭据"作为 commit 值跑完整报告生成 | `JSON.stringify(report)` 全文不含该子串 |
| G0-3 plugin-build 恒 absent | 正常路径跑 `plugin-build` 类目 | `commitComparison === 'absent'`，不因任何输入变化 |
| G0-3 MCP 自省客户端可见性 | stdio 子进程 + 官方 `Client` 解析 `initialize` 结果与新工具返回体 | `description` 非空且格式匹配；`server_build_info` 返回体字段齐全 |
| G0-4 census 空目录 | 临时指向一个空目录作为数据源根 | `sourceStatus: 'empty'`，exit 0，不抛异常 |
| G0-4 census 未知工具名 | 构造一条 `mcp__unknown_tool_x__foo` 的伪造调用记录 | 归入 `unknown` 桶，不丢弃、不崩溃 |

### 常规测试

- `npx vitest run`（全量单测/集成测试，含上述新增/扩展用例）
- `npm run test:plugins`（`.mjs` 插件测试面，覆盖 `publish-gap-check.mjs` 若放在 plugins 目录——本卡该文件在 `scripts/lib/` 而非 `plugins/`，走 `vitest` 而非 `run-plugin-tests.mjs`，与既有 `release-contract-core.mjs`/`codex-plugin-consistency-core.mjs` 的测试归属一致）
- `npm run build`（TS 编译零错误，覆盖 `src/mcp/server.ts` 改动）
- `npm run repo:check` / `npm run release:check` / `npm run release:publish:dry`（本卡验收范围的终点）
- `npm run codex:doctor`（人工过一遍真实报告文本，确认新字段渲染正常、无异常抛错）

---

## 风险与回滚

| 风险 | 影响 | 缓解 |
|---|---|---|
| CI `fetch-depth: 0` 使 checkout 变慢 | CI 单次运行时间增加 | 一次性成本，仓库体量中等；若后续证明代价过大，可退化为 `fetch-depth: <足够覆盖已发布 gitHead 的深度>`，但需要动态维护深度值，本卡先取最简单可靠的 `0` |
| `npm view` 网络调用引入外部依赖 | 理论上可能因 npm registry 抖动产生噪声 warning（indeterminate） | 已通过架构（FR-011/013）确保该分支绝不导致 exitCode 非零或 status=fail，只影响 warning 文案的详细程度 |
| doctor commit 比对新增字段被误用为"额外的强判定" | 若下游脚本/文档误把 `absent`（plugin-build）当成异常 | 消息模板明确措辞"该方无 commit 信息"而非"未知错误"；redaction 测试锁定 `absent` 恒定行为 |
| MCP 新增工具/字段被现有客户端缓存忽略 | 用户短期内看不到自省信息（MCP 客户端未重连） | doctor 的 `mcp-server-known-gap` remediation 已有 `reload-mcp-client` 提示模板可复用 |
| Codex transcript JSONL schema 与假设不符 | census 脚本对 Codex 侧调用漏统计或误统计 | 实现阶段对真实样本核实后再定稿；防御性解析（逐行 try/catch，不符合结构即跳过而非崩溃）把"schema 猜错"的代价限制在"漏统计"而非"程序崩溃" |
| 回滚 | 四个批次均设计为file-level 独立、无跨批次运行时耦合，任一批次可通过 `git revert <batch-commit>` 单独撤销而不影响其余三批次已落地的能力 |

---

## 与现有架构的融合点

- **不新建"发布治理"平行模块**：`publish-gap-check.mjs` 复用 `validate-release-contracts.mjs` 已确立的"薄壳合并多个校验源"范式（与 `codex-plugin-consistency-core.mjs` 同构），而非另起一套发布检查框架。
- **不新建 doctor 第五个版本类目**：commit 比对是对既有 4 个类目（`repo-version`/`global-cli`/`plugin-build`/`mcp-server`）的**字段级增量**，复用 `createCheck`/`sanitizeDetails`/`buildSummary` 既有构造漏斗，不引入并行的"commit 报告"结构。
- **不新建 MCP 工具分组模块**：`server_build_info` 直接内联注册，延续文件里对"单体工具"的既有处理方式（5 个内联工具 + 3 个分组 `registerXTools()`），不因为一个工具就新建一层抽象。
- **不新建版本字符串解析逻辑**：MCP 自省 A 路直接复用 `src/cli/version-meta.ts` 的 `resolveVersionString()`，与 CLI `--version` 共享同一份组装规则，避免 CLI 与 MCP 两条路径各自演化出不一致的版本串格式。
- **不新建 MCP 协议测试基础设施**：延续 `tests/integration/mcp-server-stdio.test.ts` 已确立的 `Client` + `StdioClientTransport` 子进程模式，不引入 `InMemoryTransport` 这一本仓库从未使用过的第二套测试范式。
- **不新建图质量指标框架**：G0-4 的图质量交付物是 `scripts/graph-accuracy.mjs` 的一层薄口径包装（钉语料/commit/scope），F241 pilot 资产降级为交叉参照，符合 FR-023 "MUST NOT 建立平行指标框架"。
- **不新建 adoption 数据采集通道**：`writeTelemetry` 现有机制（`SPECTRA_MCP_TELEMETRY_PATH` 门控）保持不变、不启用；census 脚本走完全独立的"事后扫描已有 transcript"路径，两条数据源互不干扰、互不依赖。

---

## Complexity Tracking

无 Constitution Check 违规，本节为空。

---

## 本卡边界重申（改动落点层面的二次确认）

- `plugins/spec-driver/scripts/lib/codex-runtime-doctor-io.mjs:273` 的 `.find` 首匹配缺陷（P0-D 认领）：Batch 3 会修改这个文件的其它函数，但**不touch** 这一行；tasks 阶段的 diff review 需要显式核对这一点。
- MCP 返回体的 `freshness`/coverage-boundary 四分/`nextStepHint` 改写（P0-C 认领）：`server_build_info` 的返回体是全新工具，只包含 `{version, commit, dirty}` 三个字段，不叠加、不模拟任何既有工具的响应包络（`withTelemetry`/`buildErrorResponse` 里那套 freshness 相关字段），避免顺手把 P0-C 的范畴外扩。
- Codex hooks 双注册（P0-B 认领）：本卡完全不涉及 `hooks.json`/`config.toml` 分发路径，`codex-runtime-doctor-io.mjs` 里 `hook-trust` 类目的探测函数本卡零改动。
- fix-compliance 门禁证据源换代（P0-A 认领）：本卡不涉及任何 Stop hook / fix-compliance 判定逻辑。
- `plugins/spectra/.mcp.json` 从 PATH 全局二进制改为可钉版本的启动方式：本卡评估结论——不改（FR-019 已标注为 SHOULD 级，仅在 doctor 报告里"报出"哪个二进制在跑），维持 Out of Scope。
