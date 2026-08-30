# 契约：pinned graph 陈旧检查输出（FR-004 / 决策 2）

**载体**：`tests/integration/graph-quality-pinned-staleness.test.ts`
**契约类型**：vitest 测试内部数据结构（非对外 CLI/API 契约），供该测试文件断言使用，格式在此固定以便审查

## 语言→数据源声明（单一事实源）

```ts
interface FixtureSourceDeclaration {
  language: string;
  classification: 'in-repo' | 'external-clone';
  pinnedDir: string;      // pinned graph.json 所在目录，相对仓库根
  sourceDir?: string;     // classification === 'in-repo' 时必填
}

const FIXTURE_SOURCE_DECLARATIONS: FixtureSourceDeclaration[] = [
  { language: 'TS/JS', classification: 'in-repo', pinnedDir: 'tests/fixtures/graph-quality-ts-graph', sourceDir: 'tests/fixtures/graph-quality-ts' },
  { language: 'Java', classification: 'in-repo', pinnedDir: 'tests/fixtures/graph-quality-java-graph', sourceDir: 'tests/fixtures/graph-quality-java' },
  { language: 'Go', classification: 'in-repo', pinnedDir: 'tests/fixtures/graph-quality-go-graph', sourceDir: 'tests/fixtures/graph-quality-go' },
  { language: 'Python', classification: 'external-clone', pinnedDir: 'tests/fixtures/micrograd-baseline-graph' },
];
```

**不变量 1（分类完整性，异构对抗审查 F272 缺陷 4 修复）**：磁盘枚举得到的每一份 pinned graph 资产
（`tests/fixtures/<name>/graph.json`，排除文件名不叫 `graph.json` 的其它资产家族如
`collector-fingerprint-guardrail/`）MUST 都能在 `FIXTURE_SOURCE_DECLARATIONS` 中找到 `pinnedDir`
匹配的条目。新增语言 fixture 却忘了在此声明，会在这条断言上当场失败——这是真正的机制（早期版本
的"分类完整性"断言只比较同一文件里两个相邻字面量彼此自洽，从不对照磁盘状态，是自指恒真式）。

**不变量 2**：`FIXTURE_SOURCE_DECLARATIONS.filter(d => d.classification === 'external-clone').map(d => d.language)` 恒等于 `['Python']`。

`describe.each` 的语言矩阵数据源**从声明表派生**（`FIXTURE_SOURCE_DECLARATIONS.filter(d => d.classification === 'in-repo')`），不再另写一份硬编码列表。

## 每语言核验结果结构

```ts
interface PinnedStalenessResult {
  language: string;                       // 'TS/JS' | 'Java' | 'Go' | 'Python'
  classification: 'in-repo' | 'external-clone';
  status: 'verified' | 'stale' | 'unverifiable:external-source';
  pinnedPath: string;                     // 该语言 pinned graph.json 的仓内路径
  differences: string[];                  // status==='stale' 时非空，全字段深比较的文案（见下）
  unverifiableReason?: string;            // status==='unverifiable:external-source' 时必填，含具体缺失路径
}
```

## 比较逻辑（异构对抗审查 F272 缺陷 1 修复；MUST NOT 再退回窄比较）

**早期版本的缺陷**：复用 `scripts/regen-collector-fingerprint-fixtures.ts` 导出的
`compareGraphOnlyStructure`，该比较器只看节点 `id` multiset 与边 `source|relation|target`
multiset。只改属性字段（`kind`/`label`/`metadata`/`confidence`/`confidenceScore`）、`graph.*`
元数据字段（`nodeCount`/`edgeCount`/`fingerprint.*`）而不动 id/边三元组，守卫完全看不见——
而 `graph.fingerprint`（F249 采集面指纹形状）恰恰是"pinned 是否代表当前 builder 行为"最核心
的信号，被结构性跳过。

**现行比较**：全字段深比较（数组按下标递归、对象按键并集排序后逐一递归、叶子值 `!==` 判定），
**唯一排除路径 `graph.builder`**：

- 排除理由（F261 D1「builder 戳只可见不判定」）：`graph.builder`（`commit`/`dirty`/
  `sourceDirty`/`distSha256`）跟踪的是宿主仓库与本地 dist 的构建状态，每次 commit 或本地重建
  dist 都会变化，这与"这份 pinned 是否仍代表当前 builder **采集行为**"无关，是可见但不参与
  判定的观测字段。
- `graph.generatedAt` **不需要**排除：graph-only 模式下该字段被产物侧归一化为
  `1970-01-01T00:00:00.000Z`（恒定值），不会引入浮动差异。
- 节点/边数组按下标直接比较是安全的：已实测同一 fixture 连续两次 `graph-only` 重建，节点/边
  数组顺序稳定、JSON 归一化后逐字节一致，不需要为此额外做 multiset 归一化。

差异文案含完整字段路径（如 `graph.fingerprint.behaviorVersion: 值不一致（重建 3 vs pinned
999）`、`nodes[3].kind: 值不一致（重建 "class" vs pinned "TOTALLY-WRONG-KIND"）`），便于直接
定位是哪个字段/哪条边/哪个节点漂移了。

## 断言契约

1. **对每个 `classification === 'in-repo'` 的语言**：MUST `status === 'verified'` 且 `differences.length === 0`。任意一项失败即整个测试失败，不允许条件跳过。
2. **对 `classification === 'external-clone'` 的语言（当前仅 Python）**：
   - 若外部 clone 路径（`~/.spectra-baselines/<project>`，或 `SPECTRA_BASELINE_HOME` 覆盖）不存在 → `status === 'unverifiable:external-source'` 且 `unverifiableReason` 非空并包含具体探测路径。测试对该语言的这部分**不判定为失败**（这是诚实的"无法验证"结论，不是错误），但**必须**用 `console.warn` 把 `unverifiableReason` 打到 CI 日志里可见（F272 异构对抗审查缺陷 5 修复：早期版本只断言不打印，CI 上这份 Python fixture 从未被真的验证过却没有任何输出提示"这一份没验"）。
   - 若 clone 存在 → 执行真实重建 + diff，`status` 为 `verified`（零差异）或 `stale`（非空 `differences`，此时测试 MUST 失败并打印差异）。
   - 断言探测路径时 MUST 与被测函数同源计算期望值（`process.env.SPECTRA_BASELINE_HOME ?? path.join(os.homedir(), '.spectra-baselines')`），MUST NOT 硬编码 `os.homedir()`——被测函数支持 `SPECTRA_BASELINE_HOME` 覆盖是文档化行为（F272 异构对抗审查缺陷 6 修复：硬编码会让用文档支持的方式配置环境反而产生假红）。
3. **分类完整性断言**：见上方"不变量 1/2"。

## 重建命令（与各 fixture README SOP 一致）

```bash
node dist/cli/index.js batch <tmp-copy-of-fixture-source> --mode graph-only --output-dir <tmp-out>
```

`dist/` 已由 `tests/global-setup.ts` 保证构建完成，测试内部只做 `assertDistBuilt()` 存在性断言，不重复触发 build。

## 变异验证记录点（verify 阶段）

**属性污染变异**（F272 异构对抗审查缺陷 1 复测，覆盖"不动 id/边三元组但改属性字段"的攻击面）：
临时对 `tests/fixtures/graph-quality-java-graph/graph.json` 施加以下变异（不改节点 id / 边
三元组）：`nodes[0].kind`/`nodes[0].label`/`nodes[0].metadata.callSitesCount`、
`links[0].confidence`/`links[0].confidenceScore`、`graph.nodeCount`/`graph.edgeCount`、
`graph.fingerprint.behaviorVersion`、`graph.fingerprint.extensionSurface.tsjsSkeletonWalk.extensions`，
重跑本测试，确认：
- `status === 'stale'`
- `differences` 包含每一处被改字段的完整路径（如 `graph.fingerprint.behaviorVersion: 值不一致（重建 3 vs pinned 999）`）

确认后恢复为处置后的正式版本。

**历史记录**（边计数变异，F272 ④ 初版验证）：临时将 `tests/fixtures/graph-quality-ts-graph/graph.json` 替换为处置前的 11 边版本，重跑本测试，确认 `status === 'stale'` 且 `differences` 包含至少 3 条边计数不一致的条目。确认后恢复为处置后的正式 14 边版本。
