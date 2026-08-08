# 修复规划 — F261 图产物 builder build stamp + implement 每 Phase 落 notes

> 模式：fix（问题修复，非新功能）。基线：`fix-report.md` 推荐**方案 A**。
> 本文只做"怎么改"的最终裁定，不重复 5-Why 诊断。

---

## 0. 一句话结论

在唯一写盘出口 `writeKnowledgeGraph` 注入 `graph.graph.builder`（5 字段、零时间戳、可为 null 的
build stamp），消费面**只在 `graph-quality` 的人读文本报告加一行 advisory**（`--json` / schema /
exit code / freshness 四态一律不动）；同时给 `agents/implement.md` 的"进度追踪"章节补 Phase 级
notes 落盘约定。

---

## 1. Codebase Reality Check

| 目标文件 | LOC | 关键接口 | 已知 debt | 本次新增 | CLEANUP? |
|---|---|---|---|---|---|
| `src/panoramic/graph/graph-builder.ts` | 778 | `buildKnowledgeGraph` / `writeKnowledgeGraph` / `normalizeGraphForWrite` / `scanGraphPortabilityViolations` / `enrichNodeDegrees` | 0 个 TODO/FIXME/HACK | ~6 行（import + 一次赋值 + 注释） | 否（>500 但新增 ≪ 50） |
| `src/panoramic/graph/graph-types.ts` | 251 | `GraphJSON['graph']` 元数据 9 字段 | 无 | ~14 行（可选字段 + 文档注释） | 否 |
| `src/panoramic/graph/collector-fingerprint.ts` | 407 | `CollectorFingerprint` / `parseCollectorFingerprint` / `fingerprintsEqual` | 无 | **0**（只作字段设计参照，不改） | 否 |
| `src/cli/commands/graph-quality.ts` | 615 | `buildReport` / `buildNextSteps` / `formatReportText` / `validateGraphJsonShape` | 无 | ~30 行（一个纯函数 + 一行渲染） | 否 |
| `plugins/spec-driver/agents/implement.md` | 179 | 8 段执行流程 + 约束/失败处理 | 无 | ~18 行（§5 扩写） | 否 |
| `src/panoramic/graph/builder-stamp.ts` | **新建** | `resolveBuilderStamp` / `getBuilderStamp` / `parseGraphBuilderStamp` | — | ~110 行 | — |

**结论：无前置 cleanup task。** 三条触发规则（LOC>500 且新增>50 / >3 个相关 TODO / >30 行重复逻辑）
均未命中。

---

## 2. Impact Assessment

| 维度 | 评估 |
|---|---|
| 直接修改文件 | 5 个（含 1 个新建）+ 5 个测试文件 + 1 个 agent 文档 |
| 间接受影响 | 4 条写盘链路（`graph-assembly.ts` / `batch-orchestrator.ts` / `cli/commands/graph.ts` / `cli/commands/community.ts`）**均无需改代码**，仅行为上多写一个字段 |
| 跨包影响 | 1 处（`src/` + `plugins/spec-driver/`），两者互不耦合，可分阶段独立验证 |
| 数据迁移 | **无**。`builder` 是纯可选新增字段；旧图 `undefined` 与新图 `null` 语义等价（未盖章），无任何消费方按其分支判定 |
| API / 契约变更 | **无破坏性变更**。`GraphJSON['graph']` 加可选字段；`graph-quality-report.schema.json` **不动**；`writeKnowledgeGraph` 签名不变 |
| 风险等级 | **LOW**（影响文件 < 10、跨包影响 = 1、无迁移、无公共契约破坏） |

> ⚠️ **第 38 行「4 条写盘链路均无需改代码」与第 40 行「无任何消费方按其分支判定」均已被实施期
> 发现证伪**（原文保留）。第 40 行的部分：`describeBuilderStamp` 现在按"键缺失 / 显式 null /
> 不可解析"分出 `unrecorded` / `unstamped` / `unrecognized` 三态，`graph-semantic-diff.mjs` 的
> `describeBuilderRecord` 同样分支——消费方确实在按其分支走（但都只影响**人读措辞**，不进任何
> 判定：exit code / `overallVerdict` / freshness 四态 / `--json` schema 全未动，故"无数据迁移"
> 与"无破坏性变更"两条结论本身仍成立）。第 38 行的部分：对抗复审 C-2 实证：
> 任何"从对象形态反推谁该盖章"的判据都能被某种形态绕过（`spectra community` 会把上线前的存量图
> 洗成"当前 dist 建的图"）。终态是**调用方显式传参** `WriteKnowledgeGraphOptions.builderProvenance`，
> 四条链路各加一行声明；`writeKnowledgeGraph` 签名仍向后兼容（选项可省略，默认 fail-safe 不盖章），
> 故第 41 行「无破坏性变更」不受影响。第四轮裁决 D6 进一步规定：`preserve-recorded` 遇**读不懂**
> 的原值时原样保留，不再 collapse 成 `null`（旧版本无权抹掉更新版本写入的内容）。

风险等级 LOW ⇒ 不强制分阶段。但因两个缺陷技术上完全正交，实施时仍按 **P1（图 stamp）/ P2
（implement.md）** 两段推进，各自可独立验证、独立回滚。

**残余风险（如实登记）**

| ID | 风险 | 处置 |
|---|---|---|
| R-1 | `builder` 只"可见"不"判定"，人可以照样忽略它 | 有意为之（fix-report 决策 2）。是否升门禁待有误判数据后另议 |
| R-2 | 非 git / clean checkout / 源码直跑三种形态都产出 `builder: null`，三者在图里不可区分 | 接受。区分它们需要引入"为什么没盖章"的诊断字段，价值低于新增判别面的代价 |
| R-3 | `graph-quality` 文本 advisory 是**文本面**，无机读断言以外的守护 | 接受。机读需求由 `graph.graph.builder` 结构化字段本身满足，不依赖该文本 |

---

## 3. 决策 1：`graph.graph.builder` 的确切类型

新增文件 `src/panoramic/graph/builder-stamp.ts`：

```ts
/** 图产物 `graph.graph.builder` 的结构：写出这份文件的**编译产物身份**。 */
export interface GraphBuilderStamp {
  /** 固定值 1：格式演进的判别锚点（对齐 CollectorFingerprint.formatVersion 惯例）。 */
  formatVersion: 1;
  /** 盖章 build 的源 commit（`stampBuild` 写入的 40 位 SHA，原样透传，不截断）。 */
  commit: string;
  /** 盖章时刻整个工作树是否脏（build-meta.dirty 原样透传）。 */
  dirty: boolean;
  /** 盖章时刻 build 输入（src / tsconfig / package）是否脏（build-meta.sourceDirty）。 */
  sourceDirty: boolean;
  /** dist 树全部 .js 的内容指纹（build-meta.distSha256，64 位十六进制，原样透传）。 */
  distSha256: string;
}
```

`src/panoramic/graph/graph-types.ts` 的 `GraphJSON['graph']` 追加：

```ts
  /**
   * F261 新增：写出本文件的 **builder（dist 编译产物）身份**，回答"这张图由哪一版编译产物执行写出"。
   * 与 sourceCommit（基于哪版源码）、fingerprint（哪版采集面）互补，共同构成三维 provenance。
   *
   * - `GraphBuilderStamp`：定位到 `.spectra-build-meta.json` 且解析合法
   * - `null`：本次写盘无法定位/解析 build-meta（源码 tsx/vitest 直跑、clean checkout 未 build、
   *   meta 畸形）——诚实降级为"非盖章 build"
   * - `undefined`：字段缺失（本机制上线前生成的旧图），与 `null` 同等按"未盖章"处理，非异常
   *
   * 不 bump schemaVersion（延续 F217 决策 5 / F249 惯例：纯可选新增字段，向后兼容）。
   */
  builder?: GraphBuilderStamp | null;
```

**逐项理由**

| 取舍 | 裁定 | 理由 |
|---|---|---|
| 含 `builtAtIso` / `note` | **MUST NOT** | `builtAtIso` 是墙钟时间戳，直接摧毁 byte-stable（决策 4）；`note` 是给人看的固定散文，进图只是噪声 |
| 含 `distFileCount` | 不含 | `distSha256` 已绑定 dist 全部内容，文件数是它的弱化投影，零增量信息 |
| 含 build-meta 文件路径 | **MUST NOT** | 绝对路径会让图不可跨机复用（F193 portable 约束）。注意 `scanGraphPortabilityViolations` **不扫** `graph.graph`，这条不变量靠字段设计 + 测试保证，不靠守卫 |
| `formatVersion` | 含，固定 1 | 对齐 F249 `CollectorFingerprint` 既有惯例：给未来格式演进一个明确的判别锚点，避免"加字段忘了留版本位" |
| 嵌套形态 | 单层扁平对象 | 5 个字段全部同源于同一份 build-meta，无子结构可分组；扁平化让 `Object.keys` 精确断言最直接 |
| `commit` 截断到 7 位 | **不截断** | `--version` 截断是给人看的展示层裁剪；图产物是事实源，展示层裁剪应发生在渲染时（决策 5）而非落盘时 |
| 可选性 | `builder?: GraphBuilderStamp \| null` | 三态（缺失 / null / 有值）语义与既有 `sourceCommit`、`fingerprint` 逐字对齐，消费方心智零新增 |

**结构校验**：同文件导出 `parseGraphBuilderStamp(value: unknown): GraphBuilderStamp | null`，
生产侧（解析 build-meta JSON）与消费侧（`graph-quality` 读外部 graph.json 的该字段）共用。

校验口径**刻意弱于** F249 的 `parseCollectorFingerprint`：只做"必需 5 键存在 + 类型正确 +
`formatVersion === 1`"，**不做**严格 key 集合、**不用** `readDataProperty` 那套 accessor/TOCTOU 防御。
理由必须写进文件头注释：F249 之所以要严格 key 集合，是因为指纹参与 `fingerprintsEqual` **相等性
判定**——未登记的新字段会让"实际已变"的两份指纹判等、进而把过期图判 fresh（静默放行）。
`builder` **不参与任何判定**（决策 5：advisory-only，不进 freshness、不改 verdict、不改 exit code），
那条静默放行通道结构性不存在，因此严格校验带来的"演进时必须同步 bump formatVersion"成本没有对应收益。
若未来 `builder` 被升为门禁判据，**必须同步把校验收紧到严格 key 集合**——这条交接注记写进文件头。

---

## 4. 决策 2：build meta 定位算法

```ts
/** 从模块自身位置向上回溯的最大层数。 */
const MAX_ASCENT = 2;

/** 纯函数：从 startDir 起有界向上找 `.spectra-build-meta.json`，找不到/畸形返回 null。 */
export function resolveBuilderStamp(startDir: string): GraphBuilderStamp | null;

/** 生产入口：以 dirname(fileURLToPath(import.meta.url)) 为起点，进程内 memoize（含 null）。 */
export function getBuilderStamp(): GraphBuilderStamp | null;
```

**精确规则**

1. 起点 `startDir` = 运行中模块自身所在目录（`path.dirname(fileURLToPath(import.meta.url))`）。
2. 依次检查 `startDir`、`startDir/..`、`startDir/../..`（共 `MAX_ASCENT + 1 = 3` 个目录），
   逐个 `existsSync(path.join(dir, '.spectra-build-meta.json'))`。
3. **只查祖先目录本身，绝不查 `<祖先>/dist`**（也不查任何其他子目录）。
4. 第一个命中即 `readFileSync` + `JSON.parse` + `parseGraphBuilderStamp`；解析失败或字段畸形
   → 返回 `null`，**不继续向上找**（命中即定论：找到了自己的 meta 却读不懂，是异常而非"没盖章"，
   继续上溯只会捞到别人的 meta）。
5. 全程 `try/catch` 兜底，任何 I/O 异常 → `null`，**MUST NOT** 抛出中断写盘。

**`MAX_ASCENT = 2` 的裁定**：编译后模块位于 `dist/panoramic/graph/`，到 `dist/` 恰好 2 级
（`graph → panoramic → dist`）。取**最小可行值**而非"留点余量"——每多一级，就把"tsx 直跑 src 时
误命中仓库 dist"的窗口开大一级。模块若迁移，由深度不变量测试（§9 T-R1e）立刻变红并强制同步该常量。

**三种运行形态的结果**

| 形态 | 模块实际位置 | 上溯路径 | 结果 |
|---|---|---|---|
| (a) 编译后 `dist/panoramic/graph/*.js` | `<root>/dist/panoramic/graph` | `graph` → `panoramic` → **`dist`** ✅ | 返回真实 stamp。**这是生产建图路径**，也是本次修复的目标场景 |
| (b) vitest / tsx 直跑 `src/panoramic/graph/*.ts` | `<root>/src/panoramic/graph` | `graph` → `panoramic` → `src`（三者均无 meta） | 返回 `null`。关键点：`<root>/dist/.spectra-build-meta.json` **确实存在**，但规则 3 禁止探查 `<祖先>/dist`，且 `<root>` 本身在 `MAX_ASCENT=2` 之外 ⇒ **结构性不可能误命中**。这条正是最容易写错、必须有反例测试的一条 |
| (c) npm 全局安装的 dist | `<prefix>/lib/node_modules/<pkg>/dist/panoramic/graph` | 同 (a)，相对结构一致 ✅ | 返回该安装包 build 时的 stamp（`npm publish` 时 `dist/.spectra-build-meta.json` 随包发布，见 F186 `files` 配置） |

**memoize 语义**：`getBuilderStamp()` 首次调用后把结果（含 `null`）缓存到进程结束。
理由见决策 4 第 6 条。纯函数 `resolveBuilderStamp(startDir)` 不缓存，测试全部打这一层
——不需要任何 `__resetCacheForTest` 之类的测试专用后门。

> ⚠️ **本段（含上方代码块第 135 行的 `进程内 memoize` 注释）已被实施期复审 F5 推翻**（原文保留）。
> 落地实现是**模块加载期常量**（`builder-stamp.ts` 的 `const LOAD_TIME_STAMP = resolveBuilderStamp(...)`），
> 不是"首次调用时惰性抓取"。理由：惰性抓取会**给旧代码建的图盖上新 build 的章**——`spectra batch`
> 跑数分钟期间若另一个终端跑了 `npm run build`，本进程执行的仍是旧 dist 的代码，却会记下新 meta，
> 把本机制要抓的东西反向掩盖成"看起来很新"。加载期抓取把该窗口从分钟级收窄到毫秒级
> （残余窗口非零，已在 `builder-stamp.ts` 如实登记）。"测试全部打纯函数层、不留测试后门"这条**仍然成立**。

---

## 5. 决策 3：注入点

**位置**：`src/panoramic/graph/graph-builder.ts` 的 `writeKnowledgeGraph` 内部，
**① portable 守卫扫描之后、② `normalizeGraphForWrite` 之前**。执行顺序变为：

```
① scanGraphPortabilityViolations  →  ①.5 注入 graph.graph.builder  →  ② normalizeGraphForWrite  →  ③ writeAtomicJson
```

**为何选"归一化之前"**（两处皆可、必须选一个并说明）：

- 两处在**当前**实现下结果完全等价——`normalizeGraphForWrite` 对 `graph.graph` 只在
  `stripTimestamps` 时改写 `generatedAt`，不剥除未知字段、不排序 meta 键（已实读确认，
  `graph-builder.ts:689-720`）。
- 选"之前"是为了确立一条更强的纪律：**所有落盘前的字段变更都发生在归一化之前，归一化永远是最后
  一道确定性收口**。若未来 `normalizeGraphForWrite` 增加 meta 字段级处理（排序 / 剥除），`builder`
  会自动被纳入其确定性处理面，而不需要有人记得"哦还有个字段在归一化后面写的"。

**对既有执行顺序合同 I-1 备注的影响：无。** I-1 说的是"若归一化未来增加绝对路径 → 相对路径转换，
则 portable 守卫必须移到归一化**之后**"。本次注入插在守卫与归一化**之间**，两者的相对次序未变，
I-1 的前提与结论都不受触动。附加不变量：`builder` **MUST NOT** 携带任何文件系统路径（决策 1），
因此即便未来守卫被移到归一化之后，也不会因 `builder` 产生新的误报或漏报。

**为何不逐调用方接线**：`builder` 回答的是"**这份文件由哪一版编译产物写出**"，是**写盘动作自身**
的属性，与"调用方走的是哪条分析链路"完全无关。四条链路（`graph-assembly` / `batch-orchestrator` /
`cli/commands/graph` / `cli/commands/community`）执行写盘时跑的都是同一份 dist，逐个接线只会
制造 4 处可以各自忘记同步的重复。

**为何不沿用 sourceCommit / fingerprint 的"非 AST 路径写 null"惯例**：那条惯例的立论是
"不解析源码就不许凭空推导源码属性"——`spectra graph` 不读源码，所以它写 `sourceCommit: null` /
`fingerprint: null` 是诚实的。但 builder 身份**不是被分析对象的属性**，是执行者自己的属性：
`spectra graph` 这条链路同样是由某一版 dist 执行的，它完全知道自己是谁。让它写 `null` 不是"诚实
降级"，而是**主动丢弃一条它确实掌握的事实**——那反而是不诚实。因此四条链路一律写入实际盖章值。

---

## 6. 决策 4：byte-stable 逐条论证

护栏现状（已实读）：`normalizeGraphForWrite` 的 `stripTimestamps` 只固定 `generatedAt`；
既有 byte-stable 断言有三处——`tests/batch/graph-only-pipeline.test.ts:180`（同 fixture 连跑两次
graph.json **逐字节相等**）、`tests/e2e/feature-180-batch-repro.e2e.test.ts:173`（两次 full batch
原始 Buffer deepEqual）、`tests/e2e/feature-175-batch-incremental.e2e.test.ts:540`（full vs 无改动
增量 deepEqual）。

| # | 论点 | 论证 |
|---|---|---|
| 1 | 5 个字段全部是**构建期常量** | `commit` / `dirty` / `sourceDirty` / `distSha256` 由 `stampBuild` 在 build 那一刻算定后写死到磁盘（`scripts/lib/spectra-version-gate.mjs:68-90`）；`formatVersion` 是源码字面量。连跑两次之间没有 rebuild ⇒ 读到的是同一份文件的同一份内容 |
| 2 | 唯一的时间戳被显式排除 | build-meta 里只有 `builtAtIso` 一个墙钟字段，决策 1 已 MUST NOT 纳入。这是本决策的**唯一致命面**，由变异测试（§9 T-R4b）守护 |
| 3 | 不含路径 ⇒ 无机器相关差异 | 决策 1 已排除文件路径。跨机、跨 worktree、跨 tmpdir 产出的图在该字段上完全一致 |
| 4 | key 顺序确定 | 对象字面量书写顺序即 `JSON.stringify` 输出顺序（同 `computeCollectorFingerprint` 的既有惯例）。`parseGraphBuilderStamp` 同样按固定顺序重建对象，因此"解析后再序列化"也 byte-identical |
| 5 | `normalizeGraphForWrite` **无需新增任何处理** | 归一化面有三类：时间戳剥除（`builder` 无时间戳）、数组排序（`builder` 非数组）、运行态字段剥除（`builder` 是持久化 provenance，不是运行态）。**特别地：`builder` MUST NOT 被加进 `stripTimestamps` 的剥除面**——那会在恰恰最需要 provenance 的 batch / graph-only 两条链路上把它抹掉 |
| 6 | 缓存**不是** byte-stable 的必要条件，但仍然要做 | 同一进程内 meta 文件不变 ⇒ 不缓存也确定性相同。做 memoize 的真实理由有二：① 一次 run 内可能多次写盘（batch 主链写一次 + `community` 回写一次），若期间有人在另一个终端跑 `npm run build`，两次写盘会记下**不同**的 builder，产出自相矛盾的产物；② 省掉重复 I/O。缓存把"一次运行 = 一个 builder 身份"变成结构性保证 |
| 7 | 既有护栏自动覆盖回归 | 上述三处 byte-stable 断言无需修改即可捕获任何非确定性引入。另加一条定向断言（§9 T-R4a）：连跑两次的 `graph.graph.builder` deepEqual，使失败时能直接定位到本字段而不是"整个文件不一样" |
| 8 | pinned 护栏资产不受影响 | 已实读 `compareGraphOnlyStructure`（`scripts/regen-collector-fingerprint-fixtures.ts:160-195`）：只比 **node id multiset + edge multiset**，完全不碰 `graph.graph`。⇒ `expected-graph-only-graph.json` **不需要再生**（fix-report 只核了 micrograd fixture，遗漏了这份；此处补齐核实并给出结论） |

---

## 7. 决策 5：消费面（`spectra graph-quality`）

### 7.1 既有输出契约的实读结论

| 契约面 | 现状 | 加字段会怎样 |
|---|---|---|
| `--json` 顶层 | `graph-quality-report.schema.json` 顶层 `additionalProperties: false`；且 `tests/unit/contracts/graph-quality-report-schema.test.ts` 拿**真实 dist CLI 输出**过递归校验器，还有一条"注入未登记字段必须报违规"的灵敏度证明 | **立刻判非法**。要加须同步改 schema + 契约测试 + delta 文档 |
| `nextSteps` | `type: array of string`，无 `maxItems` / `pattern`；`scripts/lib/graph-quality-core.mjs` 对其做**文本前缀匹配**（F258 已如实登记这是脆弱文本契约） | 技术上可行，但见 §7.2 拒绝理由 |
| text 报告 | 断言只有 4 类：`toContain('[freshness] stale')`、`toContain('staleReasons: …')`、`toContain('[reason]')`、`not.toContain('[reason]')`（`tests/integration/graph-quality-cli.test.ts:474-493`）；**无 snapshot 测试** | 可安全新增行，前提是遵守 §7.3 的字面量禁令 |
| repo:check check id 清单 | `tests/integration/spec-drift-repo-check-regression.test.ts:113-121` 把新增 check id **精确钉死**为 7 项 | 新增任何 repo:check check 都会变红 ⇒ **不新增** |

### 7.2 裁定

**只改人读文本报告，加一行 advisory；`--json` / `--status` / schema / exit code / `overallVerdict` /
freshness 四态一律不动。**

`formatReportText` 在 `[freshness]` 行之后追加一行（`buildReport` 侧新增纯函数
`describeBuilderStamp(graph): string`，供单测直接打）：

```
[builder] <7位commit> (dirty=false, sourceDirty=false)  — 与 sourceCommit 一致
[builder] <7位commit> (dirty=true,  sourceDirty=true)   — 与 sourceCommit=<7位> 不一致：本图由与源码树不同版本的编译产物写出
[builder] unstamped — 图未记录 builder（旧图产物，或由未盖章 build / 源码直跑写出）
```

> ⚠️ **上述文案样例已被主线程裁决 D1/D2 取代**（原文保留，记录决策演进痕迹）。
> 新口径：advisory 的比对对象是**当前正在运行的 builder**（`getBuilderStamp()`），**不是**
> `sourceCommit`——后者是**被分析项目**的 commit，与 `builder.commit`（Spectra 自己 dist 的 commit）
> 跨仓库，不等是结构性恒真的，本样例的第 2 行对每个外部项目每次运行都恒为假陈述（已实证）。
> 同时 `distSha256`（前 12 位）MUST 出现在渲染里（D2），并由它单独判定"是不是同一份编译产物"；
> 记录侧分列 `unrecorded` / `unstamped` / `unrecognized` 三态。终态文案与七态表见
> `src/cli/commands/graph-quality.ts` 的 `describeBuilderStamp` 文档注释与 `implementation-notes.md`。

**为何不走 `nextSteps`**（三条，缺一不可）：
1. **语义错位**：`nextSteps` 的合同是"面向维护者的下一步**修复建议**"（SC-011）。builder 一致时
   没有任何要修的东西，塞一条进去是把 INFO 伪装成 action item。
2. **噪声稀释**：pass 场景下每次运行都会多一条，而 `nextSteps` 恰恰是靠"非空即有问题"被扫读的。
3. **加深已登记的技术债**：F258 已明确 `nextSteps` 文本前缀是脆弱机读契约（`plan.md:225` /
   `review-round-decisions.md` D-2），并主动承认新增 `[oracle-degraded]` 加深了这条依赖。再挂第三个
   token 会继续加深，而 builder 的机读需求**本来就不需要它**——见下条。

**机读需求由谁满足**：`graph.graph.builder` 本身就是结构化机读字段，任何消费者直接读 graph.json 即可。
`graph-quality` 只是**报告工具**，不是 builder 事实的传输通道；让它转发只会制造第二个可以漂移的副本。

### 7.3 实施期硬约束（避免扰动既有断言）

`[builder]` 行的文案 **MUST NOT** 出现下列四个方括号字面量：
`[source-commit]`、`[collector-fingerprint]`、`[collector-fingerprint-unrecorded]`、
`[collector-fingerprint-invalid]`。原因：`graph-quality-cli.test.ts` 里那段对 `ALL_STALE_REASONS`
逐个 `not.toContain('[<reason>]')` 的"错配防线"会对
**未命中场景**逐个断言 `not.toContain('[<reason>]')`——一旦 builder 行在某个 stale 场景里带上其中
任一字面量，那条防线立刻误红。提及 sourceCommit 时写成不带方括号的 `sourceCommit=<7位sha>`。

### 7.4 退回方案 B 的判据

出现下列任一情况即退回 fix-report 方案 B（**只加字段，不动 graph-quality**），并在 plan.md 与
commit message 记录理由：

- (B-1) `[builder]` 行导致 `graph-quality-cli.test.ts` / `graph-quality-adversarial.test.ts` /
  `graph-quality-lang-matrix.test.ts` 任一既有断言变红，且无法通过"改文案避开字面量"化解；
- (B-2) 实施中发现 advisory 需要读取 graph.json 以外的新信息源（说明它其实不是纯渲染，超出 fix 范围）；
  > ⚠️ **(B-2) 已被主线程裁决 D1 豁免**（原文保留）。D1 恰恰要求读 `getBuilderStamp()`（进程加载期
  > 常量，源自 `dist/.spectra-build-meta.json`）——该信息源正是本特性成立的前提，(B-2) 的立论
  > （"说明它其实不是纯渲染"）在此不适用。实际改动面仍限于 text 报告一行：`--json` / `--status` /
  > schema / exit code / `overallVerdict` / freshness 四态全未动，(B-1) / (B-3) 判据继续有效。
- (B-3) 任何为了展示 builder 而不得不改 `graph-quality-report.schema.json` 的方案出现——schema 一动
  就连带契约测试 + delta 文档 + `graph-quality-core.mjs`，改动面从 LOW 直接跳到 MEDIUM，与 fix 模式
  的"最小化变更范围"冲突。

按当前实读结论，(B-1)~(B-3) 均**不预期发生**（text 面无 snapshot、无字段级断言）。

---

## 8. 决策 6：`plugins/spec-driver/agents/implement.md` 改动

### 8.1 落点与内容

**唯一落点：第 5 节「进度追踪」**（当前只有两条 bullet：逐任务勾 checkbox、无法完成时记录原因）。
在其后追加子节，**不新增章节号、不改动其余 7 节任何一个字**：

```markdown
5. **进度追踪**
   - 每完成一个任务，立即更新 tasks.md 中的 checkbox
   - 如果任务无法完成（依赖缺失、规范不明确），记录原因并继续下一个任务

   **Phase 级进度落盘（默认约定）**

   每完成一个 Phase（不是每个任务），立即把进度快照**覆盖写入**
   `{feature_dir}/implementation-notes.md`。该文件是主线程与恢复方唯一能从磁盘无损读到的
   进度事实源——子代理 transcript 在断连后不可见，tasks.md 的 checkbox 只回答"哪些任务做完了"，
   不回答"下一步动哪个文件、有哪些已知偏差"。

   每次写入 MUST 包含以下四项（缺一不可，字段名保持逐字一致以便机器与人快速定位）：

   - **当前 Phase**：Phase 名 + 在整体 Phase 序列中的位置（如 `Phase 3 / 共 5`）
   - **已完成任务 ID**：本次会话累计完成的 task ID 全量列表（如 `T001-T014, T016`），
     与 tasks.md 的 checkbox 状态一致
   - **下一步**：下一个待执行 task ID + 它要动的具体文件路径
   - **已知偏差**：与 plan.md / tasks.md 不一致之处、`[E2E_DEFERRED]` 标记、
     未解决的失败与其定位结论；没有就显式写"无"，不要省略该项

   写入方式为**覆盖**而非追加（恢复方要的是当前状态，不是流水账）。该文件属于 feature 制品，
   随需求一并提交。
```

### 8.2 不得削弱的既有约束（实施期逐条自检）

| 既有面 | 位置 | 本次改动是否触及 |
|---|---|---|
| 委派硬约束（工具权限 / 严格按 tasks.md 执行 / 不修改 spec.md 与 plan.md / 不跳 Phase / 不过度工程） | §「工具权限」+ §「约束」 | **否**，一字不改 |
| F208 依从性判定（"MUST 在声称任何任务完成之前运行验证命令并提供实际输出"、禁止推测性表述表、完成声明模板） | §7 Layer 1-3 | **否**，一字不改 |
| goal_loop 接线 | frontmatter `tools` 中的 `mcp__plugin_spectra_spectra__impact` / `context` + preference-rules 生成块 | **否**，frontmatter 与生成块均不动 |
| 三层验证体系 | §7 | **否** |
| 改动后一致性自检 | §6 | **否** |

**新约定是 additive 的**：它只在既有"每任务勾 checkbox"之上加一层"每 Phase 落盘"，
不替换、不放宽任何一条既有要求。审查时若发现任何既有句子被改写或删除，即为越界，必须回退。

### 8.3 同步与提交

- 改后**必须** `npm run repo:sync` 重生成派生产物，再 `npm run repo:check` 确认零失败。
- `<!-- BEGIN preference-rules -->` 生成块由 `templates/preference-rules.md` 同步而来，本次改动
  **落在该块之外**，不会与 sync 冲突；但仍须跑 sync 以确保没有其他派生面被遗漏。
- 提交时**按 `git status` 实际产出的文件清单提交**，重点复核 `plugins/spec-driver/skills-codex/`
  与 `.codex/skills/` 两侧是否有连带变更（F186 wrapper body-sha256 门禁 / F238 model-literal 门禁）。
  **不要预设一定有或一定没有**——已实读确认全仓 `agents/implement.md` 只有一份（`plugins/spec-driver/agents/implement.md`），
  当前**未见**镜像副本；但 sync 链路是否会新建镜像应以实跑输出为准，而非以本规划的静态核实为准。

---

## 9. 决策 7：schemaVersion 不 bump + fixture 无需再生

### 9.1 schemaVersion 不 bump

沿用 **F217 决策 5**（`sourceCommit` 新增时确立）与 **F249**（`fingerprint` 新增时复用）的既定约定：
**纯可选新增字段、向后兼容 ⇒ 不 bump `schemaVersion`**。

代价核实：`graph-quality` 的 `MIN_SUPPORTED_SCHEMA_VERSION = '2.0'` 同时充当最低与最高边界
（FIX-7），bump 到 `2.1` 会让**所有现存 2.0 图**立刻被判 `schema-newer-than-supported` 或
`schema-too-old`——为一个 advisory 字段付出全量图作废的代价，与"最小化变更范围"直接冲突。
且四份 pinned 图 fixture（`micrograd-baseline-graph` / `graph-quality-{ts,java,go}-graph`）都写死
`schemaVersion: "2.0"`，bump 意味着四份全部再生。**不 bump。**

### 9.2 e2e pinned fixture 无需再生 —— 复核结论

fix-report 的结论**成立**，但其扫描面**不完整**，此处补齐：

| fixture | 用法（实读） | 是否需再生 |
|---|---|---|
| `tests/fixtures/micrograd-baseline-graph/graph.json` | 经 `installRelativizedBaseline`（`tests/e2e/helpers/stdio-client.ts:25`）**只读**装载，供 MCP / agent-context / lang-matrix / feature-180 等 e2e 消费；**无**"新建图 ↔ fixture 逐字节比对"用法 | **否** |
| `tests/fixtures/graph-quality-{ts,java,go}-graph/graph.json` | `graph-quality-lang-matrix.test.ts` 只读消费，断言六指标数值 | **否**（缺 `builder` ⇒ 走 `unstamped` 分支，不改任何指标与 verdict） |
| `tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json` | **fix-report 遗漏项**。已实读 `compareGraphOnlyStructure`（`scripts/regen-collector-fingerprint-fixtures.ts:160-195`）：只比 node id multiset + edge multiset，**完全不读 `graph.graph`**；另两条断言只取 `graph.graph.fingerprint` 做合法性与 `behaviorVersion` 比较 | **否** |
| `tests/fixtures/collector-fingerprint-guardrail/expected-module-graph.json` | b-track，`ModuleGraph` 投影，与 `GraphJSON.graph` 无关 | **否** |

**连带裁定：`BEHAVIOR_VERSION` 不 bump。** 本次改动不触碰任何采集管线扩展名面，也不属于
`BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES` 六类中的任何一类（ignore-dirs / gitignore 解释 /
大小写策略 / symlink / size guard / 采集失败降级），且不改动 guardrail fixture 内容。
（F259 曾因 fixture 增样而 bump——那是 fixture 本身变了；本次 fixture 一个字节都不动。）

---

## 10. 决策 8：红先行测试清单

> 纪律：下列每条用例 MUST 在实现前先写、先跑、**先看到它红**，并把红的输出记进 implementation-notes。

### P1 — 缺陷 1（builder stamp）

| ID | 文件 | 断言要点 | 实现前为何必红 |
|---|---|---|---|
| **T-R1a** | `src/panoramic/graph/builder-stamp.test.ts`（共置，与 `collector-fingerprint.test.ts` 同惯例） | 临时目录造 `<tmp>/dist/panoramic/graph/` + `<tmp>/dist/.spectra-build-meta.json`（内容用 `stampBuild` 的真实 7 字段形态），`resolveBuilderStamp('<tmp>/dist/panoramic/graph')` → 返回对象，`Object.keys(r).sort()` **精确等于** `['commit','dirty','distSha256','formatVersion','sourceDirty']` | 模块不存在 |
| **T-R1b** | 同上 | **零时间戳不变量**：`'builtAtIso' in r === false` 且 `'note' in r === false`，即便 meta 里两者都在。这是决策 4 第 2 条的直接守护 | 同上 |
| **T-R1c** | 同上 | **反例（最关键）**：造 `<tmp>/src/panoramic/graph/` **且** `<tmp>/dist/.spectra-build-meta.json` 存在 → `resolveBuilderStamp('<tmp>/src/panoramic/graph')` **必须返回 null**。这条钉死"只查祖先本身、不查 `<祖先>/dist`" | 同上 |
| **T-R1d** | 同上 | 有界性：meta 放在第 3 级祖先（超出 `MAX_ASCENT=2`）→ `null`；meta 畸形（非 JSON / `commit` 非 string / 缺 `distSha256`）→ `null` 且**不抛** | 同上 |
| **T-R1e** | 同上 | **深度不变量**：`assertDistBuilt()` 后，断言 `path.relative(<repo>/dist, path.dirname(<repo>/dist/panoramic/graph/builder-stamp.js)).split(path.sep).length === MAX_ASCENT`。模块一旦迁移，此断言先红，强制同步常量 | 同上 |
| **T-R2** | `src/panoramic/graph/graph-builder.test.ts`（若无则新建） | 直接调 `writeKnowledgeGraph(minimalGraph, tmpOutDir)` → 读回 JSON → `'builder' in parsed.graph === true`；vitest 跑 src ⇒ 值为 `null`（形态 (b) 的诚实降级）。同时断言注入发生在归一化之前不影响既有排序（nodes 仍按 id 有序） | 字段不存在 ⇒ `in` 为 false |

> ⚠️ **T-R2 的期望值已被实施期反转**（原文保留）。复审 C-2 把 `builderProvenance` 定为**调用方必传**、
> 省略时取 fail-safe 默认 `preserve-recorded`，因此"不传选项直接调 `writeKnowledgeGraph`"的产物
> **不含** `builder` 键。落地用例断言的正是相反值（`'builder' in parsed.graph === false`），
> 并另有一条显式传 `stamp-this-build` 的用例承担原 T-R2 的"键必存在"意图。

| **T-R3** | `tests/integration/builder-stamp-e2e.test.ts` | **真 dist 建图自述 builder**：`assertDistBuilt()` → 读 `dist/.spectra-build-meta.json` → 临时项目跑 `node dist/cli/index.js batch --mode graph-only` → 读产物 → 断言 `graph.graph.builder.commit === meta.commit` **且** `builder.distSha256 === meta.distSha256`。meta 不存在时（非 git 环境）断言 `builder === null`——**保持有断言，不 skip** | 产物无该字段 |
| **T-R4a** | `tests/batch/graph-only-pipeline.test.ts`（并入既有 byte-stable describe） | 连跑两次后除既有 Buffer 相等外，追加 `expect(second.graph.graph.builder).toEqual(first.graph.graph.builder)`，使非确定性引入时能直接定位到本字段 | — |
| **T-R4b** | **变异测试**（不入库，实施期一次性执行，结论记入 implementation-notes） | 临时把 `builtAtIso` 加回 stamp → `graph-only-pipeline.test.ts:180`（逐字节相等）与 `feature-180-batch-repro` T-010-4 **必须变红**。红则证明 byte-stable 护栏对本字段真的有守护力；不红说明护栏空转，须先修护栏 | — |

### P1 — 缺陷 1 消费面

| ID | 文件 | 断言要点 |
|---|---|---|
| **T-R5a** | `src/cli/commands/graph-quality.ts` 的纯函数单测（`tests/unit/graph-quality-builder-advisory.test.ts`） | `describeBuilderStamp` 三态：一致 / 不一致 / unstamped 各产出预期文案；**且三种文案都不含** §7.3 列的四个方括号字面量（用 `ALL_STALE_REASONS` 循环断言，与既有错配防线同构） |
| **T-R5b** | `tests/integration/graph-quality-cli.test.ts` | **"dist 滞后于源码"可控构造**：临时 git 仓 + 手写 graph.json，`graph.builder = { formatVersion:1, commit:'a'.repeat(40), dirty:false, sourceDirty:false, distSha256:'0'.repeat(64) }`、`sourceCommit = <真实 HEAD>` → text 模式 → stdout 含 `[builder]`、含 `aaaaaaa`、含"不一致"措辞。**不需要真的改源码不 build**——builder 值直接写进手工 graph.json 即可完全控制 |
| **T-R5c** | 同上 | **advisory 不改判定**：同一份图在"有 builder"与"删掉 builder"两种输入下，`exitCode`、`report.overallVerdict`、`report.freshness.state` **逐字相同** |
| **T-R5d** | 同上 | **`--json` 契约不回归**：两种输入的 `--json` 输出均过 `validateAgainstSchema` 且 `violations` 为空——直接证明我们没有把 builder 泄进 `--json` |

### P2 — 缺陷 2（implement.md）

| ID | 文件 | 断言要点 |
|---|---|---|
| **T-R6a** | `tests/unit/spec-driver-implement-notes-contract.test.ts` | 读 `plugins/spec-driver/agents/implement.md`，断言含 `implementation-notes.md` 字面量 + 四个必含字段名（`当前 Phase` / `已完成任务 ID` / `下一步` / `已知偏差`） |
| **T-R6b** | 同上 | **不削弱既有约束的回归防线**：断言下列既有字面量仍然存在——`MUST 在声称任何任务完成之前`、`禁止的推测性表述`、`完成声明模板`、`严格按 tasks.md 执行`、`不修改 spec.md 或 plan.md`、`Layer 3: 失败路径验证`。任何一条被误删即红 |
| **T-R6c** | 验证命令（非测试文件） | `npm run repo:sync` 后 `git status --porcelain` 的产出清单 + `npm run repo:check` 零失败 |

---

## 11. 实施顺序与验证

| 段 | 内容 | 验证 |
|---|---|---|
| P1-1 | 写红：T-R1a-e、T-R2、T-R5a → 全部确认红 | 记录红输出 |
| P1-2 | 实现 `builder-stamp.ts` + `graph-types.ts` 字段 + `graph-builder.ts` 注入 + barrel 导出 | T-R1/T-R2 转绿 |
| P1-3 | 写红 T-R3 / T-R5b-d → 实现 `graph-quality` advisory | 全绿 |
| P1-4 | T-R4a 追加 + T-R4b 变异测试一次性执行 | 变异必红，还原后必绿 |
| P2-1 | 写红 T-R6a/b → 改 `implement.md` → `repo:sync` | T-R6 全绿 |
| 收口 | `npx vitest run` + `npm run build` + `npm run repo:check` + `npm run release:check` | 四项零失败 |

**每 Phase 收尾按 CLAUDE.local.md 暂停期档位跑对抗审查**（Codex 配额耗尽 ⇒ 独立子代理异构对抗，
≥ 2 个切入角）。本次改动**不属于**门禁/判定器类（advisory-only、不改 exit code、不新增 repo:check
check），故无需在 commit message 标注"异构档位缺席"；但仍须走一般生产代码档位的对抗复审。

---

## 12. 明确不做的事

- 不把 builder 差异纳入 `evaluateFreshness` 的 stale 判据（fix-report 决策 2：dist 落后是开发期常态，
  纳入会让 `graph-quality` 天天红，反而摧毁现有 stale 信号的信噪比）
- 不新增任何 `repo:check` check（会撞 `spec-drift-repo-check-regression.test.ts` 的精确 id 清单）
- 不改 `graph-quality-report.schema.json` 及其契约测试
- 不 bump `schemaVersion`、不 bump `BEHAVIOR_VERSION`
- 不再生任何 pinned fixture
- 不改 `src/cli/version-meta.ts`（build-meta 的既有第一消费方，本次只是新增第二个消费方）
- 不逐调用方接线（四条写盘链路一行不改）
