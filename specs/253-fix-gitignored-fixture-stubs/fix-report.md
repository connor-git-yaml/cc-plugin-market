# 问题修复报告

## 问题描述

F249 fix-report"残留登记"节登记的预存测试空洞：`tests/fixtures/graph-quality-java/.gitignore` 与 `tests/fixtures/graph-quality-go/.gitignore` 均含 `generated/` 规则，导致 F217 开发期创建的 `generated/StubOnly.java` 与 `generated/stub.go` 忽略样本从未被 commit。fresh clone / CI 下两目录不存在，`src/batch/generic-language-skeleton-collector.test.ts` 的两条 ④ 号 `.gitignore` 用例（断言样本"不在 skeleton map 里"）对不存在的文件空洞通过，失去真实锚定力。与 F226"gitignore 的 dist/ 吞测试 fixture"同类根因。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | ④ 用例为何空洞通过？ | 断言形态是负向断言 `expect(keys.some(样本匹配)).toBe(false)`；样本文件在磁盘上不存在时 `keys` 天然不含它，断言 vacuously true，与 collector 的 ignore 逻辑是否正确完全无关 |
| Why 2 | 样本文件为何不存在？ | `generated/StubOnly.java`、`generated/stub.go`、`build/Generated.java`（影响面扫描新发现，见下）从未进入 git 历史；fresh clone / 新 worktree / CI 下三文件均缺失 |
| Why 3 | 样本为何从未入库？ | F217（0f72d4a）设计用真实 `.gitignore` 规则驱动 collector 的排除路径：fixture 内 `.gitignore:1` 的 `generated/` 吞掉两个 generated 样本；仓库根 `.gitignore:7` 的 `build/` 吞掉 `build/Generated.java`。样本在开发机磁盘创建后被这些规则挡在 `git add` 之外，commit 只带上了 `.gitignore` 与常规源文件 |
| Why 4 | "磁盘文件会随 commit 入库"的假设为何不成立？ | 这些样本的测试角色就是"被 ignore 规则命中"——**"被 ignore"既是测试素材又是入库屏障**，双角色互斥但未被识别（与 F226 同根因模式：ignore 规则吞测试 fixture）。`git status` 不显示被忽略文件，开发机上测试真实绿（文件在），无人察觉样本没进 commit |
| Why 5 | 现有机制为何未捕获？ | ④ 用例缺"样本存在于磁盘"的前置守卫断言，输入缺失时静默退化为空洞绿：开发机绿（真锚定）与 CI 绿（空洞）不可区分，零信号。CI 恰好一直跑在样本缺失状态下 |

**Root Cause**: fixture 忽略样本身兼"测试素材（被 ignore 规则命中）"与"入库屏障（被同一规则挡在 git 外）"双角色，三个样本文件从未入库；叠加 ④ 号负向断言缺"样本存在"前置守卫，文件缺失时用例空洞通过零信号。

**Root Cause Chain**: ④ 用例空洞通过 → 样本文件磁盘不存在 → 从未被 commit（ignore 规则挡 add）→ "被 ignore"双角色互斥未被识别 → 负向断言无存在性前置守卫，缺失零信号。

**[ROOT CAUSE REACHED at Why 5]**

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| tests/fixtures/graph-quality-java/generated/StubOnly.java | 整文件缺失 | fixture 内 `.gitignore:1 generated/` 吞样本（任务登记 ①） | 创建 + `git add -f` 入库 |
| tests/fixtures/graph-quality-go/generated/stub.go | 整文件缺失 | fixture 内 `.gitignore:1 generated/` 吞样本（任务登记 ②） | 创建 + `git add -f` 入库 |
| tests/fixtures/graph-quality-java/build/Generated.java | 整文件缺失 | **仓库根** `.gitignore:7 build/` 吞样本（影响面扫描新发现，任务未登记；F226 完全同款——根级规则吞 fixture 子目录） | 创建 + `git add -f` 入库 |
| src/batch/generic-language-skeleton-collector.test.ts | L59-65 / L67-73 / L84-91 | 三条 ④ 负向断言无样本存在性前置守卫 | 各加 `fs.existsSync` 前置断言，闭合 Why 5 盲区 |

对应空洞用例共 **3 条**（任务登记 2 条 + 新发现 1 条）：
- ④ Java `.gitignore` 命中样本用例（L67-73）——完全空洞
- ④ Go 内置忽略 + `.gitignore` 联合用例（L84-91）——`generated` 断言空洞（`vendor` 断言有真实锚定：`vendor/Generated.go` 已入库健在）
- ④ Java 内置忽略目录用例（L59-65）——完全空洞（新发现）

① 号两条精确数量断言（Java=5 / Go=4）的"排除忽略样本"语义在样本缺失时同样不完整：当前 5/4 是"目录里本来就只有 5/4 个文件"，而非"7/6 个文件中正确排除了 2/2 个"。样本入库后 ① 号自动恢复完整锚定（若排除逻辑失效，size 变 7/6 即红），无需改代码。

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| tests/fixtures/ 全目录 `.gitignore` 扫描 | 仅 graph-quality-java / graph-quality-go 两个 `.gitignore` | find 全量扫描 | 安全——无其他 fixture 级 ignore 规则 |
| tests/fixtures/graph-quality-go/vendor/Generated.go | 已入库 | 内置忽略样本（vendor 不被任何 ignore 规则命中） | 安全——无需动作 |
| tests/integration/graph-quality-lang-matrix.test.ts | 消费 `graph-quality-java-graph/graph.json` 等 pinned JSON | 带 `-graph` 后缀的独立目录，不实跑源码 fixture | 安全——样本入库对其零影响（grep 确认源码 fixture 目录唯一消费者是 generic-language-skeleton-collector.test.ts） |

### 同步更新清单

- 调用方: 无（fixture 目录唯一消费者即本测试文件）
- 测试: `generic-language-skeleton-collector.test.ts` 三条 ④ 用例加存在性前置守卫
- 文档: 无
- `.gitignore`: **保持全部不变**（fixture 内 `generated/` 与仓库根 `build/` 规则都是测试素材本体；collector 的 `createGitignoreFilter` 是自有纯 pattern 匹配、不看 tracked 状态，排除路径照常生效。注意 git 层面：裸 `git check-ignore` 对已 tracked 文件返回空是官方行为——tracked 文件不受 exclude 规则约束；入库后验证 pattern 命中须加 `--no-index`，implement 阶段实测修正）

## 修复策略

### 方案 A（推荐）：样本入库 + 存在性前置守卫

1. 创建三个样本文件（内容参照同 fixture 其余文件风格的最简合法 Java/Go 片段，包含可提取的 export symbol 以确保"若未被排除必然改变 map"）
2. `git add -f` 强制入库（越过 ignore 规则，规则本身不动）
3. 三条 ④ 用例各加一行 `expect(fs.existsSync(样本绝对路径)).toBe(true)` 前置守卫——未来样本再丢失时用例显式红而非空洞绿，根治 Why 5

优点：保持 F217"真实 fixture + 真实 .gitignore 驱动真实 collector"设计意图；① 号数量断言同步恢复完整锚定；改动面最小（3 个新样本 + 1 个测试文件）；前置守卫使缺陷不可再隐身。

### 方案 B（备选）：mkdtemp 测试内临时构造

两条 ④ 用例改为 mkdtemp + 写 `.gitignore` + 写样本。缺点：偏离 F217 真实 fixture 设计意图；① 号数量断言的"排除样本"语义仍不完整（还得连带改 ①）；build/Generated.java 的内置忽略路径也要另行构造；改动面反而更大。不采纳。

### 变异验证设计（锚定力证明，任务硬要求）

- **变异 A**（任务指定）：注释 `src/panoramic/graph/quality/ignore-oracle.ts:157` 的 `if (gitignoreCheck(relativePath)) return true;` → 两个 generated 样本进 map → 期望 ④ Java gitignore 用例、④ Go 用例、① Java（6≠5）、① Go（5≠4）转红；④ build 用例应仍绿（其排除依赖 adapterIgnoreDirs/目录段集合双防线，不依赖 gitignore——不转红是正确行为）
- **变异 B**（补充，证明 build 样本锚定力）：同时废掉 walk 的 adapterIgnoreDirs 剪枝（generic-language-skeleton-collector.ts:79）与 oracle 目录段检查（ignore-oracle.ts:158-160）→ build 样本进 map → 期望 ④ build 用例、① Java 转红
- 两轮变异后全部还原，全量 vitest 回绿

## Spec 影响

- 需要更新的 spec: 无需更新（纯测试基础设施修复，产品行为零变化；F217 spec 的六指标门禁语义不受影响）

## 对抗审查处置记录（commit 前）

Codex 审查（task-msdfx8mc-jqllu8）启动后遇 ChatGPT 周配额耗尽（恢复时间 2026-08-08，与 F249 记忆预测一致），按 F249 先例降级为内部对抗复审（opus 子代理，只读实证），结论 0 CRITICAL / 2 WARNING / 4 INFO：

| 级别 | 发现 | 处置 |
|------|------|------|
| WARNING-1 | `build/Generated.java` 用 `git add -f` 与根 `.gitignore:85-89` 的 F219 时代 `!` 反否定先例分歧 | 维持 `-f`：两个 `generated/` 样本因 git"无法 re-include 被排除父目录内的文件"限制反否定不可行（fixture 内 `.gitignore` 是测试素材本体不可改写），统一反否定路线不存在；三样本统一 `-f` + 文件内注释自洽，且不扩大改动面到仓库级热点配置。理由同步记入 commit message |
| WARNING-2 | 本 Feature 的 specs 制品目录 untracked，按显式路径 commit 会漏掉、测试注释"见 fix-report.md"悬空 | commit 时显式 `git add specs/253-fix-gitignored-fixture-stubs/` |
| INFO | 全仓自建图下两个 `generated/` 样本会进图（根级 oracle 读不到 fixture 内 `.gitignore`；`build/`、`vendor/` 样本被 defaultIgnoreDirs 挡住不进）——A/B 实跑 +5 节点（+0.08%），与既有 610 个 tests/fixtures 图节点常态同性质，六指标逐项一致、`ignoredPath=0`（生产者与判定器同源 oracle） | 无需动作，登记备查 |
| INFO | existsSync 守卫失败信息为泛化的 `expected false to be true` | 不改：用例名 + 行号足以定位 |
| INFO | ① 号数量断言未加存在性守卫，样本再失时退回半空洞（5 仍是 5） | 登记残留：④ 号守卫已 fail-loud 足以捕获样本丢失，① 加固属可选，不在本次引入 churn |
| INFO | ④ Go 用例 `k.includes('vendor')`/`k.includes('generated')` 作用于绝对路径，checkout 路径含该子串时假红（fail-loud 非空洞，预存形态） | 登记残留，非本次引入 |

独立锚定力复核（scratchpad 副本中和两条排除防线后实跑 collector 采到 7 文件、含两样本）再证 ④ 号断言具备真实反证能力；`npm pack --dry-run` 证实样本不进发布产物；`.worktreeinclude` 仅含 `.env.local` 不影响守卫；F249 collector 指纹输入面是 `src/collector-surface.ts` SSoT 常量，样本入库不触发指纹变更。
