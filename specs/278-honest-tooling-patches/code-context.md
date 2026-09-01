# F278 代码上下文摘要（story 模式，由编排器扫描生成 · 非调研制品）

> 本文件替代 feature 模式的 research-synthesis.md，仅供 specify/plan/tasks/implement 子代理引用。

## 0. 工程约定（硬约束）

- worktree：`/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/funny-driscoll-fc77bb`
- 分支 `feature/278-honest-tooling-patches`，基线 `e01611b2`（= 当前 origin/master）
- 禁 `git stash` / 禁 `git checkout <其他分支>`；`git add` 只用显式路径；`specs/src.spec.md` 排除
- 与 F276（判定器 scripts）/F277（agents/SKILL 散文）并行，须保持写入路径 disjoint

## 1. 四项改动的现状代码事实（已实读，非推断）

### 项① impact/context symbol-not-found hint（来源：ledger F274 条目，行 104-108）

- `src/mcp/agent-context-tools.ts:216-230` —— `impact` handler：`canonicalizeSymbolId` 返回
  `not-found` → 走 `resolveSymbolFuzzy`；`autoResolved` 时用候选继续（push `fuzzy-resolved`），
  否则 `buildErrorResponse('symbol-not-found', 'target 在 graph 中未找到: <id>',
  '请检查 symbol id 格式或参考 fuzzyMatches 候选', { fuzzyMatches: top3 })`。
- `src/mcp/agent-context-tools.ts:365-379` —— `context` handler：同形态，hint 文案为
  `'请检查 id 格式或参考 fuzzyMatches 候选'`。
- `src/mcp/file-nav-tools.ts:150-165` —— `view_file` 的 `resolveSymbolRange`：hint 为
  `'请检查 id，参考 fuzzyMatches 候选，或先调 context 确认 symbol，或改用 startLine/endLine'`。
- 另有两处非该分支的 `symbol-not-found`：`agent-context-tools.ts:385`（`findNode` 返回 null 的
  防御性分支）、`file-nav-tools.ts:103`（`nodeToRange` 内 v8-ignore 防御分支）——**不在本卡范围**。
- 判"文件是否在图中"的可用素材：`graphData` 的 module 节点 id 即文件相对路径
  （见 pinned 样本 `{"id":"src/go/main.go","kind":"module"}`）；`moduleFileFromId(id)` 取
  symbol id 的 file part（`src/panoramic/graph/graph-builder.ts:769` 的口径：第一个 `::` 之前）。
  `findNode(graphData, <file>)` 可判 module 节点是否存在。
- 相关既有 hint（graph-not-built 恢复流，M10 §5 P1-E 记的"三处不一致"）：
  - `src/mcp/file-nav-tools.ts:140`：`请先运行 spectra batch --mode graph-only 快速建图（纯 AST · 零 LLM · 无需认证 · <2min）；需要完整 spec 关系图再跑 spectra batch`
  - `src/mcp/agent-context-tools.ts:130` / `:150`（两处，需实读核对文案）
  - `src/mcp/graph-tools.ts:182`
  - `src/mcp/server.ts:61`（server instructions 里的恢复流串）

### 项② compareGraphOnlyStructure metadata 盲区（来源：ledger F271 条目，行 78-79）

- 定义在 `scripts/regen-collector-fingerprint-fixtures.ts:166`（**注意：比较器住在 scripts/，
  不在 src/**；护栏测试从再生脚本 import，禁止另写镜像实现——见测试文件头注释）。
- 当前只比两个维度：节点 id **multiset** + 边 `source|relation|target` **multiset**。
  `kind`/`metadata`/`confidence` 全不比。
- 消费方：`scripts/regen-collector-fingerprint-fixtures.ts:558`（再生脚本 a-track 判据）、
  `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts`（多处）、
  `tests/integration/graph-quality-pinned-staleness.test.ts`。
- pinned 资产 `tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json`
  实测：22 节点 / 14 边，节点 metadata key 集合共 5 种形态：
  - 7× `{callSitesCount, sourcePath, sourceTag, unifiedKind}`
  - 6× `{exportKind, lineRange, sourcePath, sourceTag, unifiedKind}`
  - 1× `{memberKind, sourcePath, sourceTag, unifiedKind}`
  - 4× `{callSitesCount, confidence, sourceFile, sourcePath, sourceTag, unifiedKind}`
  - 4× `{confidence, exportKind, lineRange, signature, sourceFile, sourcePath, sourceTag, symbolKind, unifiedKind}`
  → key 集合**逐节点不同**，因此"全图 key 并集"档位对"某个节点丢了 lineRange"零检测力；
    比较维度应按 **node id 维度**（重复 id 时按 key-set multiset）比较，而非全图并集。
- pinned 资产已含 `lineRange`（F271 经 `--init` 冷启动再生），故新档位对**当前**基线应判一致
  （必须实跑证实，不得纸面断言）。
- `BEHAVIOR_VERSION` 纪律：`src/panoramic/graph/collector-fingerprint.ts`，当前值 3。
  **本项只改比较器（护栏侧），不改采集器行为、不改 fixture 输入样本** → 按 F249/F252 口径
  不应 bump；若实跑发现比较器新档位让 pinned 判不一致，必须先查清是"真漂移"还是"资产陈旧"，
  不得为了让它绿而 bump 或 `--init` 重生。
- 既有扰动注入测试组在 `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts:307+`
  （删边 / 改 id / 重复节点 / 乱序判一致 / 重复边），新档位的红先行用例应并列加在该组。

### 项③ `--init` 冷启动再生无留痕（来源：ledger F271 条目，行 78-79 第②点）

- `scripts/regen-collector-fingerprint-fixtures.ts:451-520`：`--init` 由 `parseRegenArgs` 解析；
  `:500-519` 是 C-002 守卫（两份 pinned 资产只要有任一份在就拒绝 `--init`）；
  `:520` 打印 `[regen] --init：两份 pinned 资产均缺席，冷启动首次生成（跳过前置一致性校验与拒绝判据）`。
- 落盘在 `:604` 附近的 `swapPinnedAssets([...])`，两份资产分别是
  `{fixtureInputHash, graph}` 与 `{fixtureInputHash, fingerprint, moduleGraph}`。
- fixture README（`tests/fixtures/collector-fingerprint-guardrail/README.md`）已有人工补记的
  "再生记录 · 2026-08-31（F271 lineRange 新字段）"一节——**这正是本项要自动化的东西**
  （ledger 原文：本卡为手工补记）。
- 相关既有测试：`tests/integration/collector-fingerprint-regen-script.test.ts`。
- 形态由 plan 定（README 追加 vs 独立 sidecar 文件）。约束提示：README 是人写散文且被
  `git` 跟踪、护栏 fixture 目录有"禁止手工编辑 expected-*.json"纪律；sidecar 若入库需考虑
  它自身是否进 `fixtureInputHash`（**必须核实**：`computeFixtureInputHash` 的扫描面是否
  包含 fixture 根目录下的新文件——若包含，写 sidecar 会造成自指循环，这是本项的头号陷阱）。

### 项④ judge:doctor 增量漂移视图（来源：ledger F270 条目，行 125-126）

- `plugins/spec-driver/scripts/judge-snapshot-doctor.mjs`（265 行，CLI 编排层）：
  `parseArgs` 当前**只**支持 `--project-root <path>`，未知参数 → exit 1；
  `checkJudgeSnapshotDrift({projectRoot, env, claudeHome})` 逐文件 `computeSha256(repo)` vs
  `computeSha256(snapshot)` → `compareFile` → `aggregateStatus`；
  `formatReport` 分四态（not-applicable / indeterminate(resolution) / indeterminate(comparison)
  / drift|in-sync）；`main` 恒 `process.exitCode = 0`（FR-009 诊断非门禁）。
- `plugins/spec-driver/scripts/lib/judge-snapshot-core.mjs`（**⚠️ F276 撞文件风险区，本卡禁止修改**）
  导出 `JUDGE_FILE_SET`（10 个文件）、`resolveActiveSnapshot`、`compareFile`、`aggregateStatus`。
  `compareFile(repoDigest, snapshotDigest)` 接受两个 DigestResult
  （`{status:'ok',sha256}` / `{status:'missing',sha256:null}` / `{status:'error',errorCode}`），
  返回 `match|mismatch|missingInRepo|missingInSnapshot|missingBoth|indeterminate`。
  → **`--since` 完全可在 doctor CLI 层实现**：把"repo 侧某 git ref 的文件内容 sha256"
    做成同形状 DigestResult 喂给已导出的 `compareFile`，无需改 core。
- `plugins/spec-driver/scripts/lib/judge-snapshot-io.mjs:24` 的 `computeSha256(absPath)` 只吃路径，
  digest 是 `crypto.createHash('sha256').update(buf).digest('hex')`；ENOENT→missing，其余→error。
  → git ref 侧需要"从 buffer 算同格式 sha256"，且 `git show` 失败要能区分
    "该 ref 下文件不存在"（→ missing）与"ref 本身无效/不是 git 仓库"（→ 应 fail-loud 报错，
    **不得**静默当成 missing，否则会把"基线不可读"谎报成"基线里本来就没有 → 本次新引入"）。
- 测试落点：`plugins/spec-driver/tests/judge-snapshot-doctor-cli.test.mjs`（node:test，
  由 `npm run test:plugins` = `node scripts/run-plugin-tests.mjs` 跑）。
- 零运行时依赖（宪法 X）：只能用 node 内置模块（`node:child_process` / `node:crypto`）。
- 向后兼容（宪法 XIII）：不带 `--since` 时输出必须与现在**逐字节一致**。

## 2. 验证命令（编排器与 verify 共用）

```
npx vitest run              # 全量单测
npm run test:plugins        # 插件侧 node:test
npm run build               # tsc 类型检查 + 构建
npm run repo:check          # 仓库级同步校验
npm run release:check       # 发布合同校验
```

## 3. 已知环境事实（避免误判）

- 本 worktree 的 `.spectra/graph.json` 已 stale（sourceCommit 25992316 vs HEAD e01611b2），
  MCP `impact` 返回空集且 honesty.freshness=stale——这不是缺陷，是待重建。
- 预存 flaky 清单见 memory：watch-command / batch-orchestrator-incremental /
  community-analysis perf / cli-e2e --version。满载跑批时这几个红先隔离重跑再判。
- 插件 cache（`/Users/connorlu/.claude/plugins/cache/.../spec-driver/4.4.0`）缺 zod，
  `orchestrator-cli.mjs` 会打 `orchestration.zod-unavailable` 警告——已知，非本卡问题。

## 4. 编排器在 specify 后补充实读核实的两处技术不确定性（结论已定，plan 直接用）

### (a) `computeFixtureInputHash` 的扫描面 —— **不存在自指循环**

`scripts/regen-collector-fingerprint-fixtures.ts:477` 实读：
```ts
const srcRoot = path.join(fixtureRoot, 'src');
...
const currentInputHash = computeFixtureInputHash(srcRoot);
```
`collectFilesRecursively(srcRoot)`（`:70-85`）只递归 **`<fixtureRoot>/src`**，
不含 fixture 根目录下的任何文件。

**旁证（实证而非推断）**：`expected-graph-only-graph.json`、`expected-module-graph.json`、
`README.md` 三个文件已长期存在于 fixture 根目录，且 pinned a-track 图是 22 节点、全部在
`src/` 下——根目录文件既不进 `fixtureInputHash`，也不进 `buildAstGraphOnly` 产物。

→ **结论**：审计记录落在 **fixture 根目录**（与 README.md 同级）安全，无自指循环、不改
`fixtureInputHash`、不改 a/b 两轨产物。**MUST NOT** 落在 `<fixtureRoot>/src/` 下（那会直接
改变 `fixtureInputHash` 并污染两轨图）。

### (b) `--since` 是否必须动 `judge-snapshot-core.mjs` —— **不必须，US3 不 BLOCKED**

`compareFile(repoDigest, snapshotDigest)` 已由 core 具名导出，入参是两个纯数据 DigestResult
（`{status:'ok',sha256}` / `{status:'missing',sha256:null}` / `{status:'error',errorCode}`），
无任何 I/O。doctor CLI 层自行构造"git ref 侧 DigestResult"即可复用它。

→ **结论**：FR-013 的"只改 doctor CLI 层"可满足，SC-006 的 BLOCKED 条件不触发。
（若 implement 阶段发现反例，必须立刻停下回报，不得擅自改 core。）

## 5. 编排器实跑取证（plan/implement 直接用，禁止再纸面假设）

### (c) `git show` 的失败语义 —— **exit code 与 stderr 都不足以区分三态**（D4 头号陷阱）

本机（macOS / git 中文 locale）实跑结果：

| 场景 | 命令 | exit | stderr |
|---|---|---|---|
| (b) ref 有效、路径不在该 ref 中 | `git show HEAD:<不存在的文件>` | **128** | `致命错误：路径 '...' 不在 'HEAD' 中` |
| (a) ref 无效 | `git show NOSUCHREF:<file>` | **128** | `致命错误：无效的对象名 'NOSUCHREF'。` |
| (a2) 当前目录不是 git 仓库 | `cd /tmp && git show HEAD:foo` | **128** | `致命错误：不是 Git 仓库（或者任何父目录）：.git` |
| 路径是目录 | `git show HEAD:<dir>` | **0** | —（输出 tree 列表） |
| 正常 | `git show HEAD:plugins/spec-driver/scripts/judge-snapshot-doctor.mjs` | 0 | — |

**结论（硬约束）**：
1. 三种失败**共用 exit 128**，`exit !== 0 ⇒ missing` 是 fail-open，**MUST NOT** 这么写。
2. stderr 文案**随 locale 变化**（本机是中文），任何 stderr 子串匹配都是不可移植的
   fail-open 面（英文 locale 上匹配不中 → 静默降级成 missing → "基线不可读"被谎报成
   "基线里本来就没有 ⇒ 本次新引入"）。**MUST NOT** 解析 stderr 文本。
3. **正确做法：把 ref 有效性与文件存在性拆成两次独立、语义明确的探测**，例如
   - 仓库有效性：`git rev-parse --git-dir`（非 0 ⇒ (a2) fail-loud）
   - ref 有效性：`git rev-parse --verify --quiet <ref>^{commit}`（非 0 ⇒ (a) fail-loud）
   - 文件存在性（**仅在上面两步都通过后**）：`git cat-file -e <ref>:<path>`
     （0 ⇒ 存在，非 0 ⇒ 合法 missing）；建议再用 `git cat-file -t` 确认类型是 `blob`，
     防止目录路径被当成文件（上表最后一行显示目录会 exit 0）
   - 读内容：`git show <ref>:<path>` 或 `git cat-file blob <ref>:<path>`
   具体命令组合由 plan 定，但**"ref/仓库有效性"与"文件存在性"必须是两次分开的判定**这一点不可让步。
4. digest 同源性：`git` 取到的内容 **MUST** 以 Buffer 送入 `crypto.createHash('sha256')`
   （`execFileSync` 不带 `encoding`），与 io 层 `computeSha256(path)` 的 `fs.readFileSync(abs)` 同源。
   实测同源性已验证：`git show HEAD:plugins/spec-driver/scripts/judge-snapshot-doctor.mjs | shasum -a 256`
   与 `shasum -a 256 <该文件>` 均为 `aca56492b82d02dd…`。

### (d) `judge:doctor` 改动前基线快照（SC-004 的 before）已由编排器采集

- 路径：`<scratchpad>/judge-doctor-before.txt`
  （`/private/tmp/claude-501/-Users-connorlu-…-funny-driscoll-fc77bb/b34792a6-1d1b-4ebd-85bc-fcd528095b1a/scratchpad/judge-doctor-before.txt`）
- 采集命令：`node plugins/spec-driver/scripts/judge-snapshot-doctor.mjs`（无参数，cwd = worktree 根）
- exit = 0；内容 sha256 = `8b622782c81da9c5a4a175563a339c5f819c058e292778dedaeb90b6ee47068f`
- 当前实际状态：`status: drift`，`4 mismatch / 2 match / 4 missingInSnapshot`
  （snapshotPath = 插件 cache 4.4.0；4 个 missingInSnapshot 正是 F270 新增的账本模块 +
  `is-invoked-directly.mjs`）—— 这正是 ledger 里"分不清本次引入 vs 开工前就有"的真实现场。
- **SC-004 验证法**：改完后再跑同一条命令、同一 cwd、同一台机，`diff` 或比对 sha256 必须完全相同。
  ⚠️ 输出含本机绝对路径，基线**不可**跨机/跨 cwd 复用。
