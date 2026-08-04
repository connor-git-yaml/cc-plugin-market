---
feature: 255-fix-nested-gitignore-oracle
mode: fix
based_on: fix-report.md（方案 A）
status: planned
---

# 修复规划：采集侧 gitignore oracle 与 freshness dirty oracle 统一

## 摘要

`src/utils/file-scanner.ts::createGitignoreFilter` 只解析根 `.gitignore`，而 `getDirtySourceFiles` 以 `git status` 为准（遵守嵌套 `.gitignore`/`.git/info/exclude`/全局 excludesFile/tracked 豁免全部规则），两侧"哪些文件属于观测面"不同源，被嵌套规则覆盖的文件会被采集入图但改动永判 fresh。方案 A：`createGitignoreFilter` 增加可选 `walkBase` 参数，git 仓库内改为预取 `git ls-files --others --ignored --exclude-standard --directory -z` 构建的精确忽略清单（过滤函数退化为纯查找），非 git / git 失败回退今天的根 `.gitignore` 逐字节行为；`scanFiles` 内部同步改传 `(projectRoot, resolvedDir)` 修正既有的 scanRoot≠projectRoot 基准错位怪癖；`collector-fingerprint.ts::BEHAVIOR_VERSION` 1→2 使既有图产物在下次 freshness 判定时自动 stale。

本规划不含实现代码，只定义变更范围、验收判据与验证顺序；实现细节留给 implement 阶段依据 fix-report「修复策略」一节展开。

## 变更清单

| # | 文件 | 改什么 | 为什么 | 风险 |
|---|------|--------|--------|------|
| 1 | `src/utils/file-scanner.ts` | `createGitignoreFilter(projectRoot, walkBase = projectRoot)` 导出签名新增可选第二参；内部新增 git 模式分支（`git -C <walkBase> ls-files --others --ignored --exclude-standard --directory -z` 预取忽略清单，构建精确文件集合 + 目录前缀表，返回纯查找函数）+ 非 git/失败回退（沿用现 `parseGitignore` 根解析）；`<projectRoot>/.git` 存在但命令失败时 `console.warn` 一次 | 单一事实源升级为与 `git status` 同源的忽略语义，消除采集面/dirty 面分叉 | 中：新增子进程调用路径，需确保同步执行（不打乱现有同步 API 契约）、错误处理覆盖 ENOENT（无 git 二进制）/非仓库/命令超时等分支 |
| 2 | `src/utils/file-scanner.ts` | `scanFiles` 内部把当前对 `parseGitignore(gitignorePath)` 的直接调用改为经由 `createGitignoreFilter(projectRoot, resolvedDir)`（两参数） | 修正 L191-194 已注记的既有怪癖：`scanRoot ≠ projectRoot` 时若仍以 `projectRoot` 为 git 基准会导致前缀表系统性 MISS（比现状更差）；显式传 `resolvedDir` 让 git 输出基准与 walk 基准对齐 | 中：这是**唯一**改变既有调用方行为的落点（其余 4 处消费点单参调用不变）；需重点验证 `tests/self-hosting/self-host.test.ts`（`scanFiles(PROJECT_SRC)` 不传 `projectRoot`，`projectRoot` 缺省 = `resolvedDir` = `src/`，本次修复后首次在此调用路径上真正生效根 `.gitignore` 语义——过去该调用因基准错位从未读取过根 `.gitignore`） |
| 3 | `src/panoramic/graph/collector-fingerprint.ts` | `BEHAVIOR_VERSION` 由 `1` 改为 `2` | 命中 `gitignore-interpretation` bump 责任条目（"是否读取 .gitignore、…、多级 .gitignore 的叠加顺序变化"），使既有图产物的 freshness 判定在下次评估时自动归 stale | 低：常量改动，`BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES` 清单本身不变；下游测试均以符号引用 `BEHAVIOR_VERSION` 断言（已核实 `collector-fingerprint.test.ts`/`source-commit.test.ts` 无硬编码字面量 `1`），无需同步改测试断言本身 |
| 4 | `tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json`、`expected-module-graph.json` | 经 `npm run fixtures:regen:collector-fingerprint` 再生（非手工编辑） | 两份 pinned 资产记录的 `behaviorVersion:1` 与代码新值 `2` 不一致会使 `collector-fingerprint-guardrail.test.ts` 的显式断言（"pinned 记录的 behaviorVersion 等于当前 BEHAVIOR_VERSION"）直接失败；护栏 fixture 本身 stage 在 `os.tmpdir()` 非 git 临时目录（`stageFixture`/`stageFixtureRoot` 均 `fs.cpSync` 到 `os.tmpdir()`，不带 `.git`），双轨重建走**回退路径**，结构与今天逐字节相同，只有指纹分量变化 | 低：`shouldRejectRegen({contentMismatch:false, fingerprintUnchanged:false})` 恒为 `false`（放行），再生纯粹是把新指纹写回，图内容 multiset 比较不受影响；已核实无需 `--init`（两份资产已存在） |
| 5 | 注释矫正（无行为变化）：`src/utils/file-scanner.ts` 头部"基准契约"段、`src/panoramic/graph/quality/ignore-oracle.ts` 头部"读 .gitignore 文件"措辞、`src/adapters/python-adapter.ts` L142/`src/batch/stages/source-discovery.ts` L265 附近 F194 注释中"只读根"相关表述 | 措辞与新实现对齐 | 文档准确性 | 无 |

**无需代码改动、随 oracle 升级自动生效的消费点**（签名不变，fix-report 影响范围扫描已列全）：
- `src/batch/stages/source-discovery.ts` L266/L423（TSJS/PY 采集 walk）
- `src/adapters/python-adapter.ts` L143（`scanPyFiles`）
- `src/panoramic/graph/quality/ignore-oracle.ts` L154（`createIgnoreOracle`，供 legacy-ignored-check + generic collector + graph-quality CLI 消费）

**本次不修（fix-report 已登记，不在本轮变更清单内）**：`src/watcher/file-watcher.ts` L83-92 第五处独立手写解析（watch 链路方向本就正确，不参与本卡的采集↔dirty 错配）。

## 回归风险评估

### 1. 非 git 回退路径的字节级不变性（高优先级验证项）

`createGitignoreFilter` 在检测到非 git 上下文（或 git 命令失败且 `<projectRoot>/.git` 不存在）时，MUST 完全复用今天的 `parseGitignore` 根解析逻辑（含 `globToRegex` 的近似 glob 语义），逐字节不变。

已核实以下测试套件全部通过 `fs.mkdtempSync(os.tmpdir())` 构造临时目录（非 git），本次修复不应改变其任何断言：
- `tests/unit/file-scanner.test.ts`（含 F194 `createGitignoreFilter` 冒烟测试、否定模式、`ignored/*` 目录模式等既有用例）
- `tests/adapters/python-adapter.test.ts` 的 `describe('scanPyFiles 遵循 .gitignore (F194)')`（T-GITIGNORE-01~04）
- `tests/unit/batch-orchestrator-gitignore.test.ts`
- `src/panoramic/graph/quality/ignore-oracle.test.ts`（全部用例基于 `tmpDir`）
- `scripts/regen-collector-fingerprint-fixtures.ts::rebuildTracks` 与 `tests/integration/collector-fingerprint-regen-script.test.ts::stageFixtureRoot` 的两处 staging（均落 `os.tmpdir()`，无 `.git`）

**验收判据**：以上文件在实现完成后 `npx vitest run` 一次不改动断言即全绿；如需改动任一断言，说明回退路径未做到逐字节不变，属于设计违反，需回头修正实现而非改测试。

### 2. git 模式对既有"真实仓库内"调用点的行为影响

本仓库自身是 git 仓库，以下调用点会真实走新的 git 模式分支，需逐一确认与今天等价或方向正确：

- **`tests/self-hosting/self-host.test.ts`**（最高风险点）：`scanFiles(PROJECT_SRC)` 不传 `options.projectRoot`，过去因 L2（scanFiles 基准修正）之前的怪癖从未真正应用根 `.gitignore`；修复后首次生效。已核实根 `.gitignore`（node_modules/dist/build/coverage/*.log/.env*/.DS_Store/.vscode/.idea/*.swp/*.tsbuildinfo/drift-logs/ 等）无一模式命中 `src/` 下任何路径段，且 `src/` 内全部文件当前均为 tracked（无遗留未提交的被忽略文件）——预期该测试断言（含 `files.length >= 10`、指定文件名存在）不变。verification 阶段仍需实跑复核，防止本地开发过程中 `src/` 下出现新的 untracked+ignored 文件造成假失败。
- **`src/batch/generic-language-skeleton-collector.test.ts`**（Java/Go fixture，均在仓库内 git 跟踪路径下）：`tests/fixtures/graph-quality-{java,go}/` 各自含一份 `.gitignore`（`build/`、`vendor/`、`generated/` 等模式）。已核实这两个 fixture 目录当前磁盘上**不存在**任何匹配这些模式的文件（`build/Generated.java`、`generated/StubOnly.java`、`vendor/Generated.go`、`generated/stub.go` 均不存在——测试用例④对这些"样本"的排除断言在修复前后均为**空排除**的等价断言，是 F249 残留登记的预存 fixture 空洞，不属本次修复引入或需处理的问题，仅如实记录不做处理）。git 模式与回退模式在此表现一致（均无实际忽略命中）。
- **`tests/integration/*`/`tests/unit/batch-orchestrator*.test.ts` 等其余以 `tests/fixtures/**` 为 `projectRoot` 的调用点**：已逐一确认这些 fixture 目录本身均无自带 `.gitignore`（`Glob tests/fixtures/**/.gitignore` 仅命中上述 java/go 两处），且目录内容全部 tracked，git 模式下不会产生任何新增忽略判定，与回退模式等价。

**验收判据**：上述测试文件在实现完成后无需修改任何既有断言即可全绿；`self-host.test.ts` 单独复核一次（`npx vitest run tests/self-hosting/self-host.test.ts`）确认无假失败。

### 3. 性能预算

git 模式每次构造过滤器触发一次 `git ls-files` 子进程（~10-40ms，取自 fix-report B2 实测量级）。全量 batch 流程内 `createGitignoreFilter`/`createIgnoreOracle` 构造次数为个位数（TSJS 采集 1 次 + PY 采集 1 次 + generic Java/Go 各 1 次 + scanFiles 类调用若干次，fix-report 估算全程 5-6 次），累计开销 <200ms，相对于 batch 分钟级总耗时可忽略。**验收判据**：不新增性能回归测试，但 implement 完成后如涉及 baseline 相关代码路径变化需按 CLAUDE.local.md 既有 baseline 流程判断是否需重跑（本次改动范围判断：不触达 batch/panoramic/LLM 流水线核心，不强制要求）。

### 4. TypeScript 契约兼容性

`createGitignoreFilter` 新增参数为**可选**（`walkBase = projectRoot` 默认值），4 处既有单参调用点（`source-discovery.ts` ×2、`python-adapter.ts`、`ignore-oracle.ts`）签名保持不变，无需修改调用代码，`npm run build` 不应因此产生新的类型错误。

## 测试规划

新增测试位置遵循既有分层：单元测试与 `file-scanner.ts` 同名文件 `tests/unit/file-scanner.test.ts`；跨侧一致性回归属于集成场景，放 `tests/integration/`。

### `tests/unit/file-scanner.test.ts` 新增用例组

| 用例 | 目的 | 前置条件 |
|------|------|----------|
| 嵌套 `.gitignore`：子目录 `.gitignore` 声明的忽略模式生效 | 复现 fix-report A1-A2（`sub/.gitignore` 含 `*.go`，`sub/foo.go` 应被判 ignored） | 临时目录初始化为真实 git 仓库（`git init` + 必要 `user.email`/`user.name` 配置或 `-c` 内联）、根 `.gitignore` 为空，子目录含独立 `.gitignore` |
| tracked 豁免：`git add -f` 强制入库的文件即使匹配忽略模式仍不判 ignored | 复现 fix-report B1（tracked 豁免与 `git status` 会报告其改动同向） | 同上真实 git 仓库，对匹配 `.gitignore` 模式的文件执行 `git add -f` 后校验 `createGitignoreFilter` 返回 `false` |
| 非 git 回退等价：无 `.git` 目录时行为与 `parseGitignore` 根解析逐字节一致 | 固化"维度收窄的 fail-open"设计判据，防止未来把 git 模式误接到非 git 路径 | 复用既有 `tmpDir`（非 git），对比 git 分支引入前后同一组断言（可复用现有嵌套忽略/否定模式用例的输入，验证在无 `.git` 时仍走根解析且结果与修复前一致） |
| `walkBase` 参数生效：git 模式下 `walkBase` 与 `projectRoot` 不同（子目录场景）时忽略清单按 `walkBase` 为基准解析，无 MISS | 覆盖 `scanFiles` 内部 `(projectRoot, resolvedDir)` 传参场景，防止方案 A 第 4 点描述的错位回归 | 真实 git 仓库，`projectRoot` 为仓库根、`walkBase` 为子目录，验证相对子目录的路径判定正确 |
| git 命令失败但 `<projectRoot>/.git` 存在 → `console.warn` 触发一次且回退到根解析 | 覆盖 fix-report「非 git / git 失败回退」第 3 点的诊断分支 | 构造 `.git` 存在但 git 命令必然失败的场景（如 mock/spy 子进程调用抛错），断言 `console.warn` 被调用且返回值等价根解析结果 |

### `tests/integration/` 新增跨侧一致性回归测试（新文件，建议命名 `tests/integration/gitignore-collector-freshness-consistency.test.ts`）

固化 fix-report A1-A4 复现链为回归断言，防止未来任一侧单独改动重新引入分叉：

| 用例 | 断言 |
|------|------|
| 嵌套 `.gitignore` 覆盖的文件不应出现在采集结果中 | 真实 git 仓库 + 嵌套 `.gitignore`，`collectGenericLanguageCodeSkeletons`/`scanFiles` 等采集入口返回结果不含该文件（对照 fix-report A1，方向反转：过去入图现在应被排除） |
| 采集面与 `getDirtySourceFiles` 观测面同向 | 对同一真实 git 仓库场景，分别调用采集侧过滤逻辑与 `getDirtySourceFiles`，断言两者对同一文件集合的"是否计入观测面"判定一致（不要求逐字段实现细节相同，只要求"文件是否在图的可观测集合中"这一维度同向） |
| tracked 对照组 dirty 判定不受影响 | 修改 tracked 的 `main.go`（fix-report A4 对照组）后仍正确判 dirty，防止本次改动误伤既有正常路径 |

**验收判据**：上述新增用例须使用真实 `git init` 构造的临时仓库（不能用 mock 模拟 git 输出，避免测试与实现耦合出同一份错误假设），全部新增用例首次运行前**必须先在未修复状态下手动验证会失败/命中修复前行为**（即新用例本身要能复现问题），修复后转绿。

## 验证方案

严格按以下顺序执行，任一步骤失败即停止：

1. **实现完成后先跑受影响单元测试**（不含护栏）：`npx vitest run tests/unit/file-scanner.test.ts tests/adapters/python-adapter.test.ts tests/unit/batch-orchestrator-gitignore.test.ts src/panoramic/graph/quality/ignore-oracle.test.ts src/batch/generic-language-skeleton-collector.test.ts tests/self-hosting/self-host.test.ts` —— 确认非 git 回退路径与仓库内既有 fixture 调用点零回归
2. **新增测试独立验证**：新增的 `tests/unit/file-scanner.test.ts` 用例组与新建的跨侧一致性集成测试单独跑一次，确认覆盖 fix-report A1-A4 复现链
3. **`npm run build`**：确认 `createGitignoreFilter` 签名扩展、`scanFiles` 内部改动、`BEHAVIOR_VERSION` 常量改动零类型错误
4. **护栏 pinned 资产再生**（顺序关键：必须在代码改动 + build 完成后才能跑，且必须在全量 vitest 之前完成，否则 `collector-fingerprint-guardrail.test.ts` 的 `behaviorVersion` 显式断言会先红）：`npm run fixtures:regen:collector-fingerprint`，确认输出为"放行"分支（`fingerprintUnchanged=false`）且两份 pinned 资产被更新，非 `--init`（两份资产已存在，无需冷启动）
5. **全量 `npx vitest run`**：确认零失败，重点复核 `collector-fingerprint-guardrail.test.ts`/`collector-fingerprint-regen-script.test.ts`/`collector-fingerprint.test.ts`/`source-commit.test.ts` 全绿
6. **`npm run repo:check`**：零失败
7. **提交前 Codex 对抗审查**（依 CLAUDE.local.md 约定）：聚焦 git 子进程调用的错误处理边界（无 git 二进制、非仓库、命令超时、`walkBase` 与 `projectRoot` 不一致时的路径基准正确性）

## Spec 影响（重申 fix-report 结论）

无需新建/修改任何 spec 制品：F249 fingerprint 合同的 `BEHAVIOR_VERSION` 演进通道本就为此类变更预留；产品级 spec 未记载"只读根 .gitignore"的行为承诺。
