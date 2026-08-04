# 问题修复报告

## 问题描述

F249（249-fix-generic-collector-ext-case）对抗审查实跑复现并登记的预存 freshness 漏报（其 fix-report"残留登记"节第一条）：

采集侧 `src/utils/file-scanner.ts::createGitignoreFilter`（L199-201）只读 `<projectRoot>/.gitignore`，不处理嵌套 `.gitignore` / `.git/info/exclude` / 全局 excludesFile；而 freshness dirty 判定侧 `src/panoramic/graph/source-commit.ts::getDirtySourceFiles` 走 `git status --porcelain=v1 -z --untracked-files=all`（遵守 git 全部忽略规则）。后果：被嵌套 `.gitignore` 覆盖的源码文件会**被采集入图，但其改动永判 fresh**——图未反映最新改动的隐性漏报。TSJS/PY/generic 三路 collector 共用同一 `createGitignoreFilter`，同病。

**本会话实跑复现（2026-08-04，`repro-nested-gitignore.mts`，REPRO: CONFIRMED）**：临时 git 仓库 `root/.gitignore` 空、`root/sub/.gitignore` 含 `*.go`、`sub/foo.go` 为真实源码（untracked+ignored）：

- A1 `collectGenericLanguageCodeSkeletons(root)` 采集到 `sub/foo.go`（采集清单 `['main.go','sub/foo.go']`）
- A2 `git check-ignore sub/foo.go` → ignored（git 视角确实被忽略）
- A3 修改 `sub/foo.go` 后 `evaluateFreshness` → `{"state":"fresh"}`，无 dirtyFiles（**漏报核心**）
- A4 对照组：修改 tracked 的 `main.go` → `{"state":"dirty","dirtyFiles":["main.go"]}`（判定链本身正常）

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 嵌套 `.gitignore` 覆盖的文件改动后图为何仍判 fresh？ | `getDirtySourceFiles` 以 `git status --porcelain` 为 oracle，git 不列出 ignored+untracked 文件的改动 → dirtyFiles 恒不含它；但该文件在图里，图内容已过期 |
| Why 2 | 该文件为何会在图里？ | 采集侧 `createGitignoreFilter` 只解析根 `.gitignore` 一个文件，嵌套规则（以及 `.git/info/exclude`、全局 excludesFile）对采集面不可见 → 文件被 walk 采集 |
| Why 3 | 采集侧为何只读根文件？ | F194 引入 gitignore 过滤时用手写 `parseGitignore`（单文件 glob→regex 近似解析器），按"根 `.gitignore` ≈ 项目忽略意图"的简化假设实现，未建模 git 的多级规则栈与 tracked 豁免 |
| Why 4 | 该假设为何不成立？ | F217 起 freshness dirty 判定直接把 git 本体当 oracle——从那时起两侧消费的是两个不同的"忽略规则宇宙"；只要项目存在嵌套 `.gitignore`（本仓库 `tests/fixtures/graph-quality-{java,go}/.gitignore` 即实例），两个宇宙必然分叉 |
| Why 5 | 为何未被现有机制捕获？ | 两侧单测各测自己的宇宙（file-scanner 测根规则解析、source-commit 测 porcelain 解析），无"同一文件在采集面与 dirty 面必须同向"的跨侧一致性测试；F249 指纹只结构化覆盖扩展名维度（extensionSurface），gitignore 解释维度仅有 `gitignore-interpretation` bump 责任条目的文字声明，无行为探针 |

**Root Cause**: 采集侧 gitignore oracle 是手写的"根文件近似"，而 freshness dirty oracle 是 git 本体；两侧对"哪些文件属于图的观测面"没有共享事实源，嵌套 `.gitignore`（及 info/exclude、全局 excludesFile、tracked 豁免）全部落在近似实现的盲区。

**Root Cause Chain**: 改动永判 fresh → status 不列 ignored 文件而文件在图里 → 采集侧只读根 .gitignore → F194 手写单文件近似解析器 → F217 把 git 本体接成 dirty oracle 后两侧规则宇宙分叉 → 无跨侧一致性测试兜底

`[ROOT CAUSE REACHED at Why 4]`（Why 5 为捕获盲区补充）

## 影响范围扫描

### 同源问题（需同步修复——全部经共享 oracle 升级一次性闭合）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| src/utils/file-scanner.ts | L199-201 | `createGitignoreFilter` 只读根 `.gitignore` | 本体改造（方案 A） |
| src/utils/file-scanner.ts | scanFiles→walkDir | spec 扫描器经同一 filter（8 处调用方：single-spec-orchestrator / project-context / data-model-generator / incremental / module-derivation / drift-orchestrator / mcp server / cli）| 无逻辑改动；scanFiles 内部把 walk 基准传给 oracle（防 git 模式基准错位回归，见方案 A 第 4 点） |
| src/batch/stages/source-discovery.ts | L266 / L423 | TSJS / PY 采集 walk 消费共享 filter | 无代码改动，随 oracle 升级生效 |
| src/adapters/python-adapter.ts | L143 | python symbol scan walk 消费共享 filter | 无代码改动，随 oracle 升级生效 |
| src/panoramic/graph/quality/ignore-oracle.ts | L154 | generic collector（Java/Go）+ legacy-ignored-check + graph-quality CLI 经 `createIgnoreOracle` 消费 | 无逻辑改动；头部注释"读 .gitignore 文件"措辞更新 |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| src/watcher/file-watcher.ts | L83-92 | **第五处独立手写**根 `.gitignore` 解析（喂 chokidar 过滤，`spectra watch` 链路）| 本次不修：不参与采集↔dirty 错配（修后 ignored 文件不入图，watch 不监听它们方向正确）；"双实现收敛 + watch 链路 git 保真"登记为候选 follow-up |

### 安全（同词不同物，无需动作）

- `src/panoramic/graph/collector-extname.ts`：`'.gitignore'` 仅为扩展名提取文档示例字面量
- `src/cli/version-meta.ts`：注释"gitignored 文件"与忽略规则无关
- `src/panoramic/graph/quality/quality-engine.ts` / `legacy-ignored-check.ts` / `src/cli/commands/graph-quality.ts`：均为 oracle 消费方的注释/文案，随 oracle 升级语义自动正确

### 同步更新清单

- **collector-fingerprint.ts**：`BEHAVIOR_VERSION` 1→2——本次改动逐字命中 `gitignore-interpretation` bump 责任条目（"是否读取 .gitignore、…、多级 .gitignore 的叠加顺序变化"）；bump 后全部既有图产物下次 freshness 判定自动 stale → 重建后两侧一致
- **护栏 pinned 资产**：`npm run fixtures:regen:collector-fingerprint` 再生（护栏 fixture 在非 git 临时目录重建 → 走回退路径 → 结构不变；指纹已变 → `shouldRejectRegen` 二元判据放行并重写两份资产的指纹）
- 测试：`tests/unit/file-scanner.test.ts` 新增嵌套 `.gitignore` / tracked 豁免 / 非 git 回退用例；新增采集面↔dirty 面一致性回归测试（固化本报告 A1-A4 复现链）
- 注释矫正：file-scanner 头部契约（"基准契约"段）、ignore-oracle 头部措辞、python-adapter / source-discovery 的 F194 注释中与"只读根"相关表述

## 修复策略

### 方案 A（推荐）：git 事实源忽略清单预计算

`createGitignoreFilter(projectRoot, walkBase = projectRoot)`：

1. **git 模式**：经 `git -C <walkBase> ls-files --others --ignored --exclude-standard --directory -z` 一次性预取"忽略中的 untracked 文件 + 整目录"清单（本会话 B2 实证输出形态：文件逐条、纯 ignored 目录折叠为 `dir/`），构建 {精确文件集合 + 目录前缀表}；返回的过滤函数变成纯查找——walk 逐路径调用零额外进程开销，每次构造一个 git 进程（~10-40ms/次，batch 全程 5-6 次构造，可忽略）
2. **语义收益**：嵌套 `.gitignore`、`.git/info/exclude`、全局 excludesFile、negation、"父目录被排除不可再包含"、**tracked 豁免**（B1 实证：`git add -f` 的文件不再被判 ignored，与 `git status` 会报告其改动严格同向）全部与 git 同源。采集面收敛为 **tracked ∪ (untracked ∧ ¬ignored)** = dirty 判定面（status 输出面）的超集一致形态，错配消除
3. **非 git / git 失败回退**：保留现 `parseGitignore` 根解析（今天的字节级行为）。维度收窄的 fail-open：根规则 + 硬编码忽略目录仍生效，仅嵌套保真度降级到现状；非 git 上下文 freshness 本就 `unknown-provenance` 短路（`resolveSourceCommit` null），**不存在错配面**。检测到 `<projectRoot>/.git` 存在但 git 命令失败时 `console.warn` 一次（避免 git 仓库内静默降级）
4. **scanFiles 基准错位防回归**：scanFiles 现状 `scanRoot ≠ projectRoot` 时 filter 基准错位（file-scanner L191-194 已注记的 F194 怪癖）。若 git 模式仍以 projectRoot 为基准，scanRoot 相对路径查前缀表会系统性 MISS → gitignore 过滤静默失效（比现状更差）。故 scanFiles 内部改传 `(projectRoot, resolvedDir)`：git 模式下 `-C resolvedDir` 使输出基准与 walk 基准对齐（git 规则解析不依赖 cwd，怪癖在 git 模式下自然痊愈）；回退模式保持今天行为不变（不修也不放大）
5. **指纹联动**：`BEHAVIOR_VERSION` 1→2（见同步更新清单）

### 方案 B（备选，否决）：手写解析器扩展为嵌套合并

逐目录向下发现 `.gitignore` 并按 git 优先级合并。否决理由：等于重写 git exclude 机器（现 `globToRegex` 近似已与 git 存在分叉，扩展只会放大分叉面）；拿不到 tracked 豁免（不读 index）→ 采集面与 status 仍不同向；`.git/info/exclude` / 全局 excludesFile 仍缺席；维护成本长期高于方案 A。

### 已考虑并否决的变体

- **逐路径 `git check-ignore`**：walk 每路径一个进程，性能不可接受；`--stdin` 批量则要求先收集全部候选再过滤，需重构 4 处 walk 的剪枝结构，改动面大于预计算清单且无语义增益
- **放宽 dirty 判定面**（让 dirty 侧把 ignored 文件也算 dirty）：方向违反任务约束（"采集面收紧到与 git status 一致，而非放宽判定面"），且会让日常构建产物改动持续误报 dirty

## 已知边界（有意不修，登记）

- **失败态降级方向不对称**（Phase 4b 质量审查 INFO 采纳登记）：dirty 判定侧 git 子进程失败时**保守判 dirty**（`getDirtySourceFiles` 的 `readFailed: true`），而采集侧忽略清单预取失败时**降级为弱过滤**（回落根 `.gitignore` 近似，可能欠忽略）——同一失败包络（如大仓库 ENOBUFS）下两侧观测面可能重新出现窄口分叉。降级本身有 `console.warn` 出声（git 仓库内），且欠忽略方向 = 多采集 + dirty 侧保守 = 不产生新的"永判 fresh"漏报面，故接受为已知边界不本卡处理
- **嵌套 git 仓库**（非 submodule 的 repo-in-repo）：外层 git 对内层仓库不递归（status/ls-files 均只见目录本身），内层文件"被 walk 采集但外层 status 永不报告"——与本卡同形态、**不同轴**（repo 边界维度 vs 忽略规则维度）的预存缺口，本次不扩，登记候选后续 fix
- **`git status` 以仓库根为路径基准**：projectRoot 为仓库子目录时 dirtyFiles 路径与图 key 基准不同（且 status 覆盖整个仓库改动面）——预存行为，只影响 dirtyFiles 文案不影响四态 verdict，不属本卡
- **F249 残留 ④（fixture 用例空洞）联动注记 → 已发生并处置**：本卡交付窗口内 F253（253-fix-gitignored-fixture-stubs）恰好落地了 ④ 修复——`git add -f` 强制入库 `generated/` stub 样本。与本预注记完全一致，tracked 豁免使这些样本在 in-repo 扫描下被采集，F253 的 6 条断言（①×2/④×2/默认/⑥ 计数与方向）与本修复相撞。处置（rebase 合并适配，见下节）：in-repo 用例翻转为"tracked 豁免收录"canary（配 `git ls-files --error-unmatch` tracked 前置守卫防语义再倒挂）；F253 ④ 的**原始意图**（untracked+ignored 不入图 + 存在性守卫非空洞）迁移到新增的临时 git 仓库 staging 用例（fixture 复制 + git init 不 commit，原始精确计数 5/4 在真实语义下恢复）

## Rebase 合并适配（F250-F254 基座前移，2026-08-04）

交付窗口内 origin/master 前移 7 个 commit（F250 `.pyi` 采集面 / F251 dist 竞写 / F252 surface 收敛批次 / F253 fixture stub 入库 / F254 图消费白名单 / F240-R2 ×2）：

- **撞号重编**：原编 252 被 master 的 252-fix-surface-convergence-batch 占用 → 全量重编为 **F255**（specs 目录、分支、代码注释、测试命名、制品引用一并替换，零残留核验）
- **rebase 零文本冲突**，但 pinned 资产不信任文本合并，走权威路径复核：`fixtures:regen:collector-fingerprint` 判"双轨重建内容、指纹与 fixtureInputHash 均一致，无需更新"（合并资产 = 脚本在新基座会产出的逐字节结果）；charter e2e 快照 9 处 behaviorVersion 实测全绿
- **master 上 `BEHAVIOR_VERSION` 仍为 1**（F252-surface-convergence 只做类型收紧未 bump）→ 本卡 1→2 在新基座依然成立
- **F253 相撞与处置**：见上方"已知边界"联动注记条目；适配后 `generic-language-skeleton-collector.test.ts` 12/12 绿（10 适配 + 2 新增）
- **rebase 后重验**：全量 vitest 522 files / 7110 tests 零失败；build 零错误；repo:check exit 0；graph-only 重建（7501 节点）后 freshness 转 pass——重建前 warning 精确报出 `collector-fingerprint` stale 原因，是 F249+F255 链路"bump 后既有图自动作废"的端到端自证

## Spec 影响

- F249 fingerprint 合同（specs/249-graph-collector-fingerprint）：**无需改** —— `BEHAVIOR_VERSION` bump 是其内建演进通道，`gitignore-interpretation` 责任条目本就为此类变更预留
- `specs/products/spectra/current-spec.md`：verify 阶段核查是否存在"只读根 .gitignore"表述，有则同步（预期无：该行为从未写入产品级 spec）
- 需要更新的 spec：无需新建（fix 模式，本报告 + plan/tasks 即制品）
