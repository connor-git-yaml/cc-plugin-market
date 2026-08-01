> **[无调研基础]**：spec.md 已标注本 feature 走 story 模式，无 research-synthesis.md。以下技术决策基于 spec 已锁定的关键结论、对本仓库既有代码（`fix-compliance-judge.mjs` 消费链、`installed_plugins.json`、`.specify/.spec-driver-path`）的实测核实，以及仓库既有 CLI 分层惯例（`fix-compliance-judge.mjs` / `fix-compliance-io.mjs` / `fix-compliance-core.mjs` 三层）整理而成。

# Research: 判定器快照漂移信号（Judge Snapshot Drift Signal）

## D1 — 判据机制：字节级 sha256（spec 已锁定，记录理由）

- **Decision**: 使用 `node:crypto` 对仓库侧与快照侧对应文件现算 sha256，逐文件比对，不持久化"预期指纹"。
- **Rationale**: spec 背景陈述已实测核实仓库 checkout 与已安装快照逐字节相同（无 BOM/CRLF/构建期转换差异）；版本号比对已被证伪（8 个修复均未升版）。字节级判据是唯一在零依赖前提下可靠区分"已修复"与"未修复"内容的手段。
- **Alternatives considered**:
  - 语义级（normalized-AST hash）：复杂度显著更高（需要 AST 解析器），且当前判据前提（无格式转换）已使字节级判据充分，语义级留给"格式化差异也不算漂移"这一未来目标（spec 已知约束段落显式排除本次范围）。
  - 版本号/mtime 比对：已被本 feature 存在的理由本身证伪，不再考虑。

## D2 — 组件切分：CLI + 2 个 lib 模块，仿照 fix-compliance 三层分层

- **Decision**: 新增 3 个源文件：
  1. `plugins/spec-driver/scripts/judge-snapshot-doctor.mjs`（CLI 编排层，仿 `fix-compliance-judge.mjs`）
  2. `plugins/spec-driver/scripts/lib/judge-snapshot-io.mjs`（I/O 边界层，仿 `fix-compliance-io.mjs`：sha256 读取、manifest 校验、`installed_plugins.json`/`.spec-driver-path` 读取、"是否存在任意已安装快照"扫描）
  3. `plugins/spec-driver/scripts/lib/judge-snapshot-core.mjs`（纯函数层，仿 `fix-compliance-core.mjs`：`JUDGE_FILE_SET` 常量、`resolveActiveSnapshot` 决策、`compareFile`/`aggregateStatus` 判定）
- **Rationale**: 本仓库 fix-compliance 判定器链路已建立"CLI 编排 / io 纯 I/O / core 纯函数"三层分层惯例，且被 F208/F218 反复验证可测试、可维护。沿用同一惯例降低认知负担，且满足 plan 任务要求的"比对核心纯函数化"（core 层的 `resolveActiveSnapshot`/`compareFile`/`aggregateStatus` 均为纯函数，输入是预取好的候选/摘要数据而非直接读 fs，可用固定 fixture 单测四态与四步优先级，无需 mock `fs`）。
- **Alternatives considered**:
  - 单文件承载全部逻辑：更快写完，但混合 I/O 与决策会让"FR-007 四步优先级"和"四态聚合"这类核心判据逻辑难以在不接触真实文件系统的情况下做穷举单测，且与仓库既有分层惯例不一致，违反"零基思维：新模块先问职责边界"的项目约定。
  - 拆成 4+ 文件（如把 `JUDGE_FILE_SET` 单独成文件）：spec 复杂度评估已估算"预计新增 3 个组件"，额外拆分无实际收益，属于过度分层，YAGNI 收窄为 3 个文件。

## D3 — FR-007 解析实现模式：候选预取 + 纯函数优先级决策

- **Decision**: `resolveActiveSnapshot(sources)` 是纯函数，接受**已经由 io 层预取并校验过**的候选对象：
  ```js
  {
    claudePluginRoot: {path, valid} | null,       // 来自 process.env.CLAUDE_PLUGIN_ROOT
    specDriverPath: {path, valid} | null,          // 来自 .specify/.spec-driver-path 内容
    installedMetadata: {path, valid}[] | null,     // 来自 installed_plugins.json；null=文件不可读/JSON 损坏
  }
  ```
  CLI 层负责调用 io 层完成三路读取与 `isValidPluginRoot()` 校验，再把候选对象交给 core 层做纯优先级判定。
- **Rationale**: 实测核实 `~/.claude/plugins/installed_plugins.json` 结构为 `{version, plugins: {"<name>@<market>": [{scope, installPath, version, ...}]}}`（`spec-driver@cc-plugin-market` 当前恰好是长度为 1 的数组）；`.specify/.spec-driver-path` 是单行绝对路径文本（当前内容 `/Users/connorlu/.claude/plugins/cache/cc-plugin-market/spec-driver/4.3.0`，由 `postinstall.sh` 从 `CLAUDE_PLUGIN_ROOT` 写入）。三路来源天然需要不同的读取方式（env / 单行文件 / JSON 数组），但优先级判定逻辑（"取第一个 valid 的来源，否则宣告 indeterminate"）与读取方式无关，分离后可用固定候选对象穷举四步优先级 + 歧义场景，无需为每个组合都搭建真实临时文件。
- **补充说明（doctor 命令实际运行环境）**：doctor 由开发者 `npm run judge:doctor` 主动触发，该进程通常**不带** `CLAUDE_PLUGIN_ROOT`（该变量只在 Claude Code 加载 hook 时注入子进程，不会出现在开发者手敲的 shell 里），故实测中该命令多数会命中第 2/3 步（`.specify/.spec-driver-path` 或 `installed_plugins.json`）。四步链仍需完整实现，覆盖 Claude Code hook 场景下未来可能的复用。
- **Alternatives considered**: 在 core 层直接读 `fs`／`process.env`（即不做候选预取）：更省一次数据搬运，但会让 FR-007 四步优先级的单测退化为集成测试（必须搭建临时目录树 + 临时 HOME），且 io/纯函数边界模糊，放弃。

## D4 — FR-006（not-applicable）与 FR-007 第 4 步（indeterminate）的区分依据

- **Decision**: 当 `resolveActiveSnapshot` 判定四步均未能确定 active 快照时，doctor **不直接返回 indeterminate**，而是先用 io 层的 `hasAnyInstalledSnapshot(claudeHome)`（扫描 `~/.claude/plugins/cache/**/spec-driver/*/`，只判定"是否存在任意合法 manifest 的快照目录"，不判定 active）二次判定：
  - 若本机确实**不存在任何**合法 spec-driver 快照目录 → `not-applicable`（FR-006：无快照可比对，非失败非漂移）。
  - 若本机存在**至少一个**合法快照目录、但四步解析仍无法唯一确定其中哪个是 active → `indeterminate`（FR-007 第 4 步：存在歧义/元数据损坏）。
- **Rationale**: spec 的 Edge Cases 段落明确把这两种场景分列为不同状态（"本机不存在任何该插件已安装快照目录 → not-applicable"、"本机同时存在多个已安装快照目录…无法唯一确定 → indeterminate"），FR-007 原文"若以上均无法唯一确定…系统 MUST 返回 indeterminate"若不加区分会把"全新 CI 环境无任何安装"也误判为 indeterminate，与 FR-006 冲突。二次判定用同一个 `isValidPluginRoot()` 校验器扫描 cache 目录，零额外依赖。
- **Alternatives considered**: 把"不存在任何快照"也归入 indeterminate（合并两态）：更简单，但直接违反 spec 对 Edge Cases 的显式四态划分，判定失败。

## D5 — 单文件读取失败（FR-008）对整体四态的影响：升级为整体 indeterminate

- **Decision**: `compareFile(repoDigest, snapshotDigest)` 中任一侧 `status === 'error'`（如 EACCES）时该文件判定为 `'indeterminate'`；`aggregateStatus()` 只要发现任一文件为 `'indeterminate'`，整体状态即为 `'indeterminate'`（优先级高于 `'drift'`）。
- **Rationale**: spec 的 Key Entities 只定义了**一个顶层状态字段**（四态之一），没有"整体 in-sync 但某文件 indeterminate"的复合表达空间；若把读取失败的文件当作"忽略此文件继续判其余"，可能在其余文件恰好一致时误报整体 `in-sync`，掩盖了"至少有一项检测事实上没做完"这一情况，与 FR-008"该项检测降级为 indeterminate"的精神相悖（宁可显式说明白无法完成比较，不悄悄吞掉一个未知项）。`files[]` 明细中仍会逐文件保留 `'indeterminate'` 标记，供开发者定位是哪个文件读取失败。
- **Alternatives considered**: 忽略读取失败的文件、仅用可读文件计算整体状态：会制造"看起来 in-sync 实则有文件没比对成功"的假阳性风险，放弃。

## D6 — 输出格式：仅人类可读文本，不加 `--json`

- **Decision**: `judge-snapshot-doctor.mjs` 的 CLI 输出固定为人类可读文本（章节化：projectRoot / snapshotPath / resolutionSource / 逐文件状态表 / 四态汇总），不提供 `--json` 参数。
- **Rationale**: spec 暴露点选型已锁定"独立 doctor CLI，开发者主动调用查看"，当前唯一消费者是人眼；`checkJudgeSnapshotDrift()` 核心函数本身已返回完整结构化对象（`{status, snapshotPath, resolutionSource, files}`），未来若要接入 `repo:check` 或其他机器消费者，只需在 CLI 层追加一个 `--json` 分支做 `JSON.stringify(result)`，零改动核心逻辑——现在不预建这个分支，避免"就一个消费者也要分两种输出格式"的过早泛化（Constitution III YAGNI）。
- **Alternatives considered**: 现在就加 `--json`：为假设性的"未来 repo:check 集成"预留接口，但 spec 已明确本次不做该集成（FR-009 排除），不接受"以后可能用到"的理由。

## D7 — FR-002b 守卫测试实现：轻量正则递归解析，不引入 JS parser 依赖

> **注（implement 阶段架构转向）**：本 D7 记录的"轻量 `from` 正则 + BFS"方案已在 implement 阶段被 codex 多轮对抗审查推翻——朴素正则/手写 tokenizer 均无法穷尽 ESM 词法边角。守卫最终改为 **Node vm 官方解析**：`vm.SourceTextModule` 的静态 import specifier（`moduleRequests` / Node 20 回退 `dependencySpecifiers`）为 ground truth，dynamic import 一律 fail-closed（不再"计边"）。最终以 `data-model.md §7` + `contracts/judge-snapshot-drift-result.md` 为准，本节仅存决策脉络。

- **Decision**: 守卫测试（`plugins/spec-driver/tests/judge-file-set-guard.test.mjs`）用正则 `/from\s+['"](\.\.?\/[^'"]+\.mjs)['"]/g` 扫描每个文件全文内容，抽取形如 `from './x.mjs'` / `from '../x.mjs'` 的相对导入路径，从入口 `fix-compliance-judge.mjs` 出发做 BFS（`visited` 集合去重防环），得到的文件集合与 `JUDGE_FILE_SET`（剥离 `scripts/` 前缀后）做集合相等断言。
- **Rationale**: 实测对 6 个文件逐一 grep 确认，当前所有跨文件依赖均为形如 `import {...} from './xxx.mjs';` 的静态字面量相对导入（含多行 `import {\n ...\n} from './x.mjs';` 形式，正则按整文件内容扫描而非逐行匹配"以 import 开头"，能覆盖多行场景）；不存在动态 `import()`、路径拼接导入或从 node_modules 导入的情况。FR-002b 已明确"本次不采用运行期动态推导闭包"，轻量正则完全满足"递归解析当前入口静态 import 闭包"的要求，且不新增任何依赖（FR-004 精神延伸到测试代码，避免为一个测试引入 acorn/@babel/parser 之类的解析器依赖）。
- **已知局限（接受）**: 若某文件的注释或字符串字面量恰好包含 `from './xxx.mjs'` 形态的文本，会被正则误当作导入（假阳性，导致守卫测试可能纳入不存在依赖关系的文件，从而与 `JUDGE_FILE_SET` 不一致而失败——即测试更容易偏保守拉响警报，不会漏报真实新增依赖）。当前 6 个文件的实测内容不存在此类误报（已用 grep 逐一核实）。若未来出现此类误报，应优先检查是否为真实新增依赖被遗漏，而非直接放宽正则。
- **Alternatives considered**: 引入 `acorn`/`@babel/parser` 做真实 AST 级导入抽取：更严谨，但违反 spec-driver 插件"零运行时依赖"（Constitution X）——即便只用于测试，也会让 `npm run test:plugins` 依赖一个新 devDependency，超出本 feature LOW-MEDIUM 复杂度定位，放弃。

## D8 — npm script 命名：`judge:doctor`

- **Decision**: `package.json` 新增 `"judge:doctor": "node plugins/spec-driver/scripts/judge-snapshot-doctor.mjs"`。
- **Rationale**: 沿用仓库既有"域:动作"命名惯例（`drift:link`、`release:sync`、`baseline:collect`、`hooks:check`），`judge` 域清晰指代"判定器"这一主题，避免与既有 `hooks:*`／`drift:*` 域混淆（本 feature 与 spec drift 检测是完全不同的机制，不应共用 `drift:` 前缀）。
- **Alternatives considered**: `fix:compliance:doctor`（更贴近判定器所属子系统名）：更长且暗示与 `enforcement` 门禁挂钩，容易被误解为会影响 Stop hook 行为；`judge:doctor` 更中性、更短。

## Technical Context 摘要（供 plan.md 引用）

| 维度 | 结论 |
|------|------|
| Language/Version | Node.js ≥ 20.x（`.mjs` ESM），无 TypeScript 编译步骤（spec-driver 插件脚本惯例） |
| Primary Dependencies | 仅 `node:crypto`、`node:fs`、`node:path`、`node:os`、`node:url`（零新增 npm 依赖，FR-004） |
| Storage | N/A（无持久化状态，两侧现算现比对，不落盘"预期指纹"） |
| Testing | `node:test`（`npm run test:plugins`），与 `fix-compliance-*` 系列测试同一运行方式 |
| Target Platform | 开发者本机（Claude Code 或 Codex 运行时均可，CLI 本身不依赖 Harness 特有能力） |
| Project Type | Single（脚本 + 测试，无前后端拆分） |
| Performance Goals | 6 个文件 × 2 侧 sha256，属毫秒级操作，无性能目标可言 |
| Constraints | 零运行时依赖；不得修改 Stop hook exit code 语义；不得挂载 `repo:check` |
| Scale/Scope | 固定 6 文件集合，非通用框架 |
