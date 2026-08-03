# 修复规划：fixture 忽略样本入库 + 前置存在性守卫

**关联报告**: [fix-report.md](./fix-report.md)（方案 A，5-Why 根因追溯已确认）
**模式**: fix（精简规划，不含完整架构设计）

## 摘要

修复 `generic-language-skeleton-collector.test.ts` 三条 ④ 号负向断言（Java build 内置忽略、Java `.gitignore` 忽略、Go 内置忽略+`.gitignore` 联合）在 fresh clone/CI 下因忽略样本文件从未入库而空洞通过的问题。方案：创建 3 个样本文件并用 `git add -f` 强制入库（不改任何 `.gitignore` 规则），并在三条 ④ 用例各加一行 `fs.existsSync` 前置存在性守卫，使未来样本再次丢失时用例显式转红而非静默空洞。

不涉及任何生产代码变更（`collectGenericLanguageCodeSkeletons`、`createIgnoreOracle` 等排除逻辑本体零改动），纯测试基础设施修复。

## 变更清单

### 新增文件（3 个样本，均需 `git add -f` 强制入库）

| 路径 | 动作 | 内容要点 |
|------|------|----------|
| `tests/fixtures/graph-quality-java/generated/StubOnly.java` | 新增 | `package generated;` + `public class StubOnly` 含一个方法（提供可提取 export symbol）；顶部注释说明其角色是 fixture 内 `.gitignore:1 generated/` 命中样本，并注记 F253 入库背景 |
| `tests/fixtures/graph-quality-go/generated/stub.go` | 新增 | `package generated` + 顶层函数 `func Noop() string`（提供可提取 export symbol）；顶部注释同上，风格对齐已入库的 `vendor/Generated.go`（`package vendor` + `func Noop() {}`） |
| `tests/fixtures/graph-quality-java/build/Generated.java` | 新增（影响面扫描新发现，任务未登记，随本次一并修复） | `package build;` + `public class Generated` 含一个方法；顶部注释说明其排除依赖 `JavaLanguageAdapter.defaultIgnoreDirs` 的目录级剪枝（`walkFiles` L79），与仓库根 `.gitignore:7 build/` 规则无关（ignore oracle 的 `gitignoreCheck` 只读 fixture 自身 `.gitignore`，不读根 `.gitignore`） |

三文件均：① 参照同 fixture 现有文件的风格（Java 沿用 `src/main/java/com/acme/*.java` 的顶部 JSDoc 风格注释 + 简单声明；Go 沿用 `vendor/Generated.go` 的单行注释 + package + 空函数风格）；② 含至少一个可被 tree-sitter 提取为 export symbol 的顶层声明，确保"若排除逻辑失效，该文件必然被采集且改变 skeleton map 的 size 与 keys"，使 ④/① 断言具备真实反证能力。

### 修改文件

| 路径 | 动作 | 内容要点 |
|------|------|----------|
| `src/batch/generic-language-skeleton-collector.test.ts` | 修改 | ① 顶部追加 `import * as fs from 'node:fs';`；② L59-65（Java build 用例）、L67-73（Java `.gitignore` 用例）、L84-91（Go 联合用例）各在跑 collector 之前插入 `expect(fs.existsSync(<样本绝对路径>)).toBe(true)` 前置守卫（Go 用例对 `vendor/Generated.go` 与 `generated/stub.go` 各加一行，因为该用例同时验证两类排除路径）；③ 用 `path.join(JAVA_FIXTURE_ROOT, ...)` / `path.join(GO_FIXTURE_ROOT, ...)` 构造路径，与文件顶部已有的 `JAVA_FIXTURE_ROOT`/`GO_FIXTURE_ROOT` 常量保持一致 |

**不改动的文件（显式确认）**：
- `tests/fixtures/graph-quality-java/.gitignore`（`generated/` 规则保留）
- `tests/fixtures/graph-quality-go/.gitignore`（`generated/` 规则保留）
- 仓库根 `.gitignore`（`build/` 规则保留）
- `src/batch/generic-language-skeleton-collector.ts`（排除逻辑本体不动）
- `src/panoramic/graph/quality/ignore-oracle.ts`（排除逻辑本体不动）
- ① 号数量断言（L40-47 Java=5、L75-82 Go=4）——样本入库后自动从"目录里本来就只有 5/4 个文件"升级为"7/6 个文件中正确排除 2/2 个"的完整锚定，代码本身无需改动

## 回归风险评估

### 风险等级：LOW

- 影响文件数：3 个新增 fixture 样本 + 1 个测试文件修改 = 4 个文件，均在 `tests/` 范围内
- 无跨包影响：不涉及 `plugins/`、`src/` 生产代码、`scripts/`
- 无数据迁移、无 API/契约变更
- 生产代码零改动：`collectGenericLanguageCodeSkeletons`、`createIgnoreOracle` 均未修改（已用 spectra `impact` 工具核实 `collectGenericLanguageCodeSkeletons` 的上游调用链为 `runBatch`/`buildAstGraphOnly`/`runBatchCommand`，riskTier=low；本次改动完全不触碰该函数本体，调用链零受影响）

### 为何 `.gitignore` 不动而排除逻辑仍生效（核心论证）

`createIgnoreOracle`（`src/panoramic/graph/quality/ignore-oracle.ts:154`）内部的 `gitignoreCheck = createGitignoreFilter(projectRoot)` 是**纯 pattern 匹配**（`src/utils/file-scanner.ts:199-201`：读取 `<projectRoot>/.gitignore` 文件内容后转正则匹配相对路径字符串），与该路径在 git 索引中是否被 `.gitignore` 挡在 `git add` 之外（即"是否 tracked"）完全无关——即便 `generated/StubOnly.java` 已被 `git add -f` 强制入库，`createGitignoreFilter` 逐行读取 `.gitignore` 文本、逐条转 glob-to-regex 后仍会命中 `generated/` 规则，`gitignoreCheck('generated/StubOnly.java')` 照常返回 `true`。这正是 F249/F250 记忆中反复验证过的模式："`git check-ignore` 对已 tracked 文件仍返回命中"的行为在这里体现为"pattern matcher 不查 tracked 状态，只查字符串是否匹配 pattern"。

同理，`build/Generated.java` 的排除路径与仓库根 `.gitignore:7 build/` 规则完全无关：`createGitignoreFilter` 只读 `resolvedProjectRoot`（即 `JAVA_FIXTURE_ROOT`）下的 `.gitignore`，不会向上遍历到仓库根 `.gitignore`。该文件的真实排除机制是 `walkFiles`（`generic-language-skeleton-collector.ts:77-79`）在目录级剪枝阶段：`JavaLanguageAdapter.defaultIgnoreDirs` 含 `'build'`（`java-adapter.ts:32`，Gradle 惯例），`collectDefaultIgnoreDirs` 把它并入 `adapterIgnoreDirs`，`walkFiles` 遇到名为 `build` 的目录时在进入 `isIgnored` 判定前就直接 `continue` 跳过（L79 早于 L80 的 `isIgnored` 调用）——即便仓库根 `.gitignore:7` 整条删掉，`build/Generated.java` 依旧会被这条目录级剪枝拦下，与 `.gitignore` 是否存在该规则无关。这正是 fix-report 里"④ build 内置忽略"与"④ `.gitignore` 命中"是两条独立防线的依据，也是变异 B 要单独构造的原因。

### lang-matrix 集成测试零影响论证

`grep -r "graph-quality-java\|graph-quality-go" tests/integration/` 已在 fix-report 影响面扫描阶段确认：`tests/integration/graph-quality-lang-matrix.test.ts` 消费的是 `tests/fixtures/graph-quality-java-graph/graph.json`、`tests/fixtures/graph-quality-go-graph/graph.json` 等**带 `-graph` 后缀的独立 pinned JSON 产物目录**，不实跑 `graph-quality-java/`、`graph-quality-go/` 源码 fixture 本体，也不调用 `collectGenericLanguageCodeSkeletons`。本次新增的 3 个样本文件与源码 fixture 目录的唯一消费者是 `generic-language-skeleton-collector.test.ts`（fix-report 已用全仓 grep 确认），故 lang-matrix 测试的 pinned JSON 不会因样本入库而需要重新生成或产生 diff。

### 其余风险点

- **样本内容对①号断言的影响**：①号断言（Java=5、Go=4）本身不变，因为样本入库前后"排除后剩余文件数"不变（排除逻辑一直生效，只是此前因样本磁盘不存在而无法验证"从 7 个正确排除到 5 个"这条完整路径）；样本入库后 size 断言从"弱形态"（目录天然只有 5 个文件）升级为"强形态"（7 个文件中正确排除 2 个），断言数值本身不需要改动
- **Go 用例双断言合一**：L84-91 用例同时覆盖 `vendor/Generated.go`（已入库、内置忽略）与 `generated/stub.go`（本次新入库、`.gitignore` 命中）两类样本，前置守卫需对两个路径分别 `existsSync`，避免只守卫新样本而遗漏对已有 `vendor` 样本的隐性依赖复核

## 验证方案

### 1. 正向全量测试（改动后必须零失败）

```bash
npx vitest run
npm run build
npm run repo:check
```

重点关注：
- `src/batch/generic-language-skeleton-collector.test.ts` 全部用例（含 ①②③④⑤⑥）通过
- ①号 Java/Go 数量断言（5/4）继续通过，且此时是"强形态"验证（7/6 个文件正确排除 2/2 个）
- ④号三条用例的前置 `existsSync` 守卫全部通过（证明本次入库确实生效）

### 2. git 层面验证（确认样本已 tracked，而非仅磁盘存在）

```bash
git ls-files tests/fixtures/graph-quality-java/generated/StubOnly.java
git ls-files tests/fixtures/graph-quality-go/generated/stub.go
git ls-files tests/fixtures/graph-quality-java/build/Generated.java
```

三条命令均应输出对应路径（非空）。补充核实忽略规则未被绕过（证明是 `-f` 强制入库而非误改了 `.gitignore`）。注意：裸 `git check-ignore` 对已 tracked 文件返回空是 git 官方行为（tracked 文件不受 exclude 规则约束），验证 pattern 命中必须加 `--no-index`（implement 阶段实测修正）：

```bash
git check-ignore -v --no-index tests/fixtures/graph-quality-java/generated/StubOnly.java
git check-ignore -v --no-index tests/fixtures/graph-quality-go/generated/stub.go
```

均应输出对应 `.gitignore` 文件与 `generated/` 规则的命中信息。runtime 排除逻辑不依赖 git：`createGitignoreFilter` 是自有 pattern matcher，与 tracked 状态无关。

### 3. 变异验证（证明锚定力，任务硬性要求；验证后必须还原）

**变异 A**（验证 `.gitignore` 驱动的排除路径真实生效）：

1. 临时注释 `src/panoramic/graph/quality/ignore-oracle.ts:157` 的 `if (gitignoreCheck(relativePath)) return true;`
2. 跑 `npx vitest run src/batch/generic-language-skeleton-collector.test.ts`
3. 期望转红清单：
   - ④ Java `.gitignore` 命中样本用例（`generated/StubOnly.java`）—— 应失败（样本进入 map）
   - ④ Go 联合用例的 `generated` 断言部分 —— 应失败（`stub.go` 进入 map）
   - ① Java 数量断言（期望 5，实际变 6）—— 应失败
   - ① Go 数量断言（期望 4，实际变 5）—— 应失败
   - ④ Java build 内置忽略用例 —— **应仍然通过**（其排除依赖目录级剪枝，不依赖 `gitignoreCheck`，不转红是正确行为，用于反证两条防线相互独立）
4. `git checkout -- src/panoramic/graph/quality/ignore-oracle.ts` 还原

**变异 B**（验证内置忽略目录驱动的排除路径真实生效，补充证明 build 样本锚定力）：

1. 临时同时废掉：
   - `src/batch/generic-language-skeleton-collector.ts:79` 的 `if (adapterIgnoreDirs.has(entry.name)) continue;`
   - `src/panoramic/graph/quality/ignore-oracle.ts:158-160` 的目录段 `ignoreDirs.has(seg)` 检查（改为恒 `false` 或删除该 `return` 分支）
2. 跑 `npx vitest run src/batch/generic-language-skeleton-collector.test.ts`
3. 期望转红清单：
   - ④ Java build 内置忽略用例（`build/Generated.java`）—— 应失败（样本进入 map）
   - ① Java 数量断言（期望 5，实际变 6）—— 应失败
4. `git checkout -- src/batch/generic-language-skeleton-collector.ts src/panoramic/graph/quality/ignore-oracle.ts` 还原

**还原后复验**：两轮变异验证结束并 `git checkout` 还原后，重跑 `npx vitest run` 全量确认恢复零失败（避免变异操作遗留未还原的临时改动污染最终提交）。

### 验证顺序

1. 先做 git 层面验证（确认样本已 tracked）
2. 再做正向全量测试
3. 最后做两轮变异验证（验证完立即还原，不进入最终 commit diff）
4. 变异还原后重跑一次全量测试收尾

## Impact Assessment

- **影响文件数**：4（3 新增 fixture + 1 测试文件）
- **跨包影响**：无（全部在 `tests/` 范围内，不跨 `plugins/`/`src/`/`scripts/` 边界）
- **数据迁移**：无
- **API/契约变更**：无
- **风险等级**：LOW

## Codebase Reality Check

| 目标文件 | LOC（改动前） | 方法/导出数 | 已知 debt |
|---------|---------------|------------|-----------|
| `src/batch/generic-language-skeleton-collector.test.ts` | 150 行 | 10 个 `it(...)` 用例 | 无 TODO/FIXME；三处 ④ 用例缺存在性前置守卫（本次修复对象），无其他技术债 |
| `tests/fixtures/graph-quality-java/generated/StubOnly.java` | 0（新增） | — | 不存在，本次创建 |
| `tests/fixtures/graph-quality-go/generated/stub.go` | 0（新增） | — | 不存在，本次创建 |
| `tests/fixtures/graph-quality-java/build/Generated.java` | 0（新增） | — | 不存在，本次创建 |

文件规模小（测试文件 150 行、新增文件均 <15 行），均不满足"前置清理规则"触发条件，无需额外 `[CLEANUP]` 任务。
