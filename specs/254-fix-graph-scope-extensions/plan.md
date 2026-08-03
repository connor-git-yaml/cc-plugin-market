---
feature: 254-fix-graph-scope-extensions
mode: fix
based_on: fix-report.md 方案 A（图自述面优先 + SSoT 锚定 fallback + 跨语言合同测试）
status: draft
---

# 修复计划：图消费决策白名单扩面 + 图自述面优先消费

## 0. 范围与不做什么

- **只改**：`plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs`、
  `plugins/spec-driver/scripts/graph-consumption-cli.mjs`、
  `plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs`（新增一个泛化读取函数）、
  对应四份测试、新增一份跨语言合同测试。
- **不改**：F241 决策矩阵 13 行求值顺序/出口、EC-07（刷新后绝不重跑矩阵）、FR-010 快照校验、
  C-002"两处判据同一份面"原则本身（面的**内容**从静态变动态，但"两处只认一份面"的约束不变）、
  SKILL.md（CLI 参数形态不变，零改动）、F241/F249 已 ship 的 spec 文档。
- **不做**：不引入新的 CLI flag，不改变 `decide`/`annotate-caveat` 的调用方合同（B1-C6 审计闭包
  下限清单需要新增 `graph-bootstrap-status.mjs`？—— 见 §4 回归风险清单第 5 条，答案是"已在清单
  但需确认闭包解析能扫到新函数"，不是新增独立文件）。

## 1. 变更文件清单（精确到函数/常量级别）

### 1.1 `plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs`

新增一个泛化读取函数，`readEmbeddedSourceCommit` 薄壳化为它的投影，**返回形状与既有三态 reason
枚举逐字不变**（`file-missing` / `graph-too-large` / `parse-error`）：

```js
/**
 * 读取图内嵌元数据：sourceCommit + collector fingerprint（F254 泛化）。
 *
 * 泛化动机：F254 需要在图消费决策里同时用到 sourceCommit（既有）与 fingerprint.extensionSurface
 * （新增，推导动态覆盖面）。两者同源于同一份 graph.json，分别调用 readEmbeddedSourceCommit 与
 * 一个假想的 readEmbeddedFingerprint 会对 4.5MB 级别的图文件重复 stat + read + JSON.parse 两次。
 * 本函数一次读取、一次解析，两个消费方各取所需字段。
 *
 * @returns {{ ok: true, value: { sourceCommit: string|null, fingerprint: unknown } }
 *          | { ok: false, reason: 'file-missing'|'parse-error'|'graph-too-large' }}
 */
export function readEmbeddedGraphMeta(graphJsonPath) {
  let stats;
  try { stats = fs.statSync(graphJsonPath); } catch { return { ok: false, reason: 'file-missing' }; }
  if (stats.size > MAX_JSON_BYTES) return { ok: false, reason: 'graph-too-large' };
  let raw;
  try { raw = fs.readFileSync(graphJsonPath, 'utf-8'); } catch { return { ok: false, reason: 'file-missing' }; }
  try {
    const parsed = JSON.parse(raw);
    return {
      ok: true,
      value: {
        sourceCommit: parsed?.graph?.sourceCommit ?? null,
        fingerprint: parsed?.graph?.fingerprint ?? null,
      },
    };
  } catch { return { ok: false, reason: 'parse-error' }; }
}

/** 薄壳：既有调用方（buildStatusPayload 等）零改动，返回形状逐字不变。 */
export function readEmbeddedSourceCommit(graphJsonPath) {
  const meta = readEmbeddedGraphMeta(graphJsonPath);
  if (!meta.ok) return meta;
  return { ok: true, value: meta.value.sourceCommit };
}
```

`readEmbeddedGraphMeta` 加入 `export` 列表；仓根转发壳 `scripts/lib/graph-bootstrap-status.mjs`
是 `export *`（见文件头 F241/D8 迁移说明），自动带出新导出，无需改动。

### 1.2 `plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs`

**a) `GRAPH_SCOPE_EXTENSIONS`（L48-53）**：值改为图生产管线采集面全并集 12 扩展，语义从"白名单"
降格为"静态 fallback"，注释重写：

```js
/**
 * 图覆盖范围判据的**静态 fallback**（图产物无可信自述面时使用）。
 *
 * 值等于全部图生产管线采集面的并集（SSoT：`src/collector-surface.ts::ALL_PRODUCER_SURFACES`），
 * 覆盖 TSJS（含 .mjs/.cjs）、PY（含 .pyi）、Java、Go、module 派生扫描（含 .mts/.cts）六条管线。
 * 与 SSoT 的一致性由 `tests/unit/graph-scope-extensions-contract.test.ts` 守护（本文件零 import，
 * 不能引用 SSoT，只能靠外部合同测试锚定，而非靠"自身注释可信"）。
 *
 * **不再是"全仓唯一定义处"的权威白名单**：`coverageScope` 判据（CLI 侧）与 FR-006 的 caveat
 * 判据优先消费图自述的 collector fingerprint（`graph.fingerprint.extensionSurface`，F249）算出的
 * 动态面；只有图缺失/损坏/超限/无指纹/指纹结构畸形时才落回本常量。两处判据仍然"同一份面"
 * （C-002 不变）——只是这份面现在按调用时点可能是动态的，调用方必须显式传入
 * （`annotateImpactCaveat` 第 4 参 `scopeExtensions`），本常量仅作各消费点的默认值。
 */
export const GRAPH_SCOPE_EXTENSIONS = Object.freeze([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
  '.py', '.pyi',
  '.java', '.go',
]);
```

**b) `annotateImpactCaveat`（L396-408）**：新增第 4 个可选参数 `scopeExtensions`，默认值为
`GRAPH_SCOPE_EXTENSIONS`（保持零 import 硬合同——默认值引用的是**同文件内**的常量，不是外部
I/O）：

```js
export function annotateImpactCaveat(decision, impactResult, target, scopeExtensions = GRAPH_SCOPE_EXTENSIONS) {
  const annotated = { ...decision, caveats: [...(decision?.caveats ?? [])] };
  if (decision?.outcome !== 'consume-impact') return annotated;
  if (normalizeDirectCallers(impactResult) !== 0) return annotated;

  const extension = extensionOf(target);
  if (extension === null || !scopeExtensions.includes(extension)) return annotated;

  annotated.caveats.push(CAVEAT_CODES.COVERAGE_GAP_KNOWN_EXTRACTION_LIMIT);
  return annotated;
}
```

JSDoc 同步更新一句："`scopeExtensions` 缺省时使用静态 fallback；CLI 侧会传入图自述的动态面，
两处判据仍是同一份面（C-002）——只是现在这份面可能随图状态变化，而不是编译期常量"。

纯函数/零 import 硬合同**不受影响**：新参数是调用方传入的数据，不是本文件发起的 I/O。

### 1.3 `plugins/spec-driver/scripts/graph-consumption-cli.mjs`

**a) import 增补（L41）**：

```js
import { checkFreshness, readEmbeddedGraphMeta, readEmbeddedSourceCommit } from './lib/graph-bootstrap-status.mjs';
```

（`readEmbeddedSourceCommit` 仍保留——`readVerifiedSourceCommit` 与 `finalizeRefreshOutcome` 的
post-refresh 重读路径继续用它，那两处只需要 sourceCommit，不需要 fingerprint。）

**b) 新增纯函数 `deriveScopeExtensionsFromFingerprint`**（放在 `collectCoverageScope` 之前）：

```js
/** `graph.fingerprint.extensionSurface` 已知的五条管线 key（顺序与 collector-fingerprint.ts 对齐）。 */
const FINGERPRINT_SURFACE_KEYS = [
  'tsjsSkeletonWalk', 'pyWalk', 'genericAdapters', 'moduleDerivationScan', 'pythonSymbolScan',
];

/**
 * 从图内嵌的 collector fingerprint 推导覆盖范围判据用的扩展名并集。
 *
 * **只做"够不够安全地取出扩展名列表"的宽松结构核验，不做 collector-fingerprint.ts 那一整套
 * 版本演进/behaviorVersion 比较**：plugins/spec-driver/scripts 是零 dist 依赖的纯 .mjs（W1 硬约束，
 * 见 graph-bootstrap-status.mjs 文件头），不能 import `src/panoramic/graph/collector-fingerprint.ts`
 * 的编译产物。这里刻意重复一个 3 行的 `formatVersion` 门槛判断（而非整套 parseCollectorFingerprint
 * 逻辑）——这是"零 dist 依赖"边界下的必要重复，而非漂移风险：真正会漂移的版本演进/比较语义
 * 仍只有一份实现（TS 侧，服务 freshness 判定）；这里只解读"扩展名在哪"这一个维度。
 *
 * 结构严格核验（全有或全无，不做部分并集）：五条管线 key 必须**全部**存在且形状合法，任一环
 * 缺失/畸形立即返回 null 整体回落静态面——宁可用旧口径也不要用"凑出来的"部分并集，那正是
 * 本 fix 想避免的"扩面时悄悄漏一条管线"同类错误。
 *
 * @param {unknown} fingerprint `graph.json` 的 `graph.fingerprint` 字段，可能是 undefined/null/畸形对象
 * @returns {string[] | null} 排序后的扩展名并集（已是小写字面量，与 SSoT 声明一致）；
 *   无法可靠推导时返回 null
 */
function deriveScopeExtensionsFromFingerprint(fingerprint) {
  if (fingerprint === null || typeof fingerprint !== 'object' || Array.isArray(fingerprint)) return null;
  if (fingerprint.formatVersion !== 1) return null; // 未来格式演进：不认就回落，不猜测新形状

  const surface = fingerprint.extensionSurface;
  if (surface === null || typeof surface !== 'object' || Array.isArray(surface)) return null;

  const union = new Set();
  for (const key of FINGERPRINT_SURFACE_KEYS) {
    const entry = surface[key];
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return null;
    if (!Array.isArray(entry.extensions)) return null;
    for (const extension of entry.extensions) {
      if (typeof extension !== 'string' || extension.length === 0) return null;
      union.add(extension);
    }
  }
  return union.size > 0 ? [...union].sort() : null;
}
```

**c) `collectCoverageScope`（L217-226）**：新增 `scopeExtensions` 参数，去掉对模块级常量的隐式引用：

```js
function collectCoverageScope(files, scopeExtensions) {
  if (!Array.isArray(files) || files.length === 0) return 'in-graph-scope';
  const anyInScope = files.some((filePath) => {
    const dot = filePath.lastIndexOf('.');
    const slash = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
    if (dot <= slash) return false;
    return scopeExtensions.includes(filePath.slice(dot).toLowerCase());
  });
  return anyInScope ? 'in-graph-scope' : 'out-of-graph-scope';
}
```

**d) `collectGraphAvailability`（L195-208）**：改为一次性读取 meta，同时产出 availability 与
fingerprint：

```js
function collectGraphAvailability(graphJsonPath) {
  try {
    fs.lstatSync(graphJsonPath);
  } catch (error) {
    const missing = error !== null && typeof error === 'object' && error.code === 'ENOENT';
    return { graphAvailability: missing ? 'missing' : 'corrupt', graphSourceCommit: null, graphFingerprint: null };
  }

  const meta = readEmbeddedGraphMeta(graphJsonPath);
  const sourceCommit = meta.ok && typeof meta.value.sourceCommit === 'string' && meta.value.sourceCommit.length > 0
    ? meta.value.sourceCommit
    : null;
  return sourceCommit === null
    ? { graphAvailability: 'corrupt', graphSourceCommit: null, graphFingerprint: null }
    : { graphAvailability: 'present', graphSourceCommit: sourceCommit, graphFingerprint: meta.ok ? meta.value.fingerprint : null };
}
```

**e) `runDecide`（L384-394 附近）**：消费新字段，计算动态面与 `scopeExtensionsSource`：

```js
const { graphAvailability, graphSourceCommit, graphFingerprint } = collectGraphAvailability(graphJsonPath);
const derivedScopeExtensions = deriveScopeExtensionsFromFingerprint(graphFingerprint);
const scopeExtensions = derivedScopeExtensions ?? GRAPH_SCOPE_EXTENSIONS;
const scopeExtensionsSource = derivedScopeExtensions !== null ? 'graph-fingerprint' : 'static-fallback';

const freshnessVerdict = await checkFreshness(projectRoot, { graphJsonPath, spectraBin });
const inputs = {
  changeClass,
  graphAvailability,
  freshness: freshnessVerdict.state,
  coverageScope: collectCoverageScope(files, scopeExtensions),
  refreshPolicy,
};
```

`payload`（L463-489）与非 dry-run 审计事件（L443-461）各加一个字段
`scopeExtensionsSource: scopeExtensionsSource`（位置：`inputs` 之后、`changedFiles` 之前，
与其他"决策元信息"字段并列，不混进 `inputs` 五维——它不是矩阵输入维度，是可观测性字段）。

**f) `runAnnotateCaveat`（L539 附近）**：同样一次读取拿两个字段，推导注解时点的动态面：

```js
const graphMetaAtAnnotation = readEmbeddedGraphMeta(path.join(projectRoot, GRAPH_REL));
const graphSourceCommitAtAnnotation = graphMetaAtAnnotation.ok
  && typeof graphMetaAtAnnotation.value.sourceCommit === 'string'
  && graphMetaAtAnnotation.value.sourceCommit.length > 0
    ? graphMetaAtAnnotation.value.sourceCommit
    : null;
const derivedScopeExtensionsAtAnnotation = graphMetaAtAnnotation.ok
  ? deriveScopeExtensionsFromFingerprint(graphMetaAtAnnotation.value.fingerprint)
  : null;
const scopeExtensionsAtAnnotation = derivedScopeExtensionsAtAnnotation ?? GRAPH_SCOPE_EXTENSIONS;
const scopeExtensionsSourceAtAnnotation = derivedScopeExtensionsAtAnnotation !== null ? 'graph-fingerprint' : 'static-fallback';

const snapshotMatches = (decision.graphSourceCommit ?? null) === graphSourceCommitAtAnnotation;
const impactStatus = snapshotMatches ? impactStatusFlag : 'snapshot-mismatch';
const annotated = snapshotMatches
  ? annotateImpactCaveat(decision, impactStatus === 'completed' ? impactResult : null, target, scopeExtensionsAtAnnotation)
  : { ...decision, caveats: [] };

const event = {
  kind: 'caveat-annotation',
  schemaVersion: AUDIT_SCHEMA_VERSION,
  decisionId: decision.decisionId ?? null,
  ts: new Date().toISOString(),
  impactStatus,
  caveats: annotated.caveats,
  graphSourceCommitAtAnnotation,
  scopeExtensionsSource: scopeExtensionsSourceAtAnnotation,
};
```

**为什么 annotate-caveat 要独立重新推导，而不是复用 decide 输出里的 `scopeExtensionsSource`**：
`decide` 与 `annotate-caveat` 是两个独立进程（见文件头"两个子命令，不是一个"），中间隔着一次
真实 MCP `impact` 调用，图状态在这段时间可能变化。既有 FR-010 快照校验已经在处理"图变了"这件事
（`graphSourceCommit` 不一致 → `snapshot-mismatch` → caveats 清空）；覆盖面同理必须按注解时点
重新读图，而不是相信一个可能已经过期的 decide 阶段值——否则会出现"sourceCommit 校验过了、
但覆盖面判据仍是上一份图的"这类新的不一致窗口。

**g) `AUDIT_SCHEMA_VERSION`（L54）**：`2` → `3`（裁决理由见 §3）。

## 2. B1/B2 读取落点裁决：采用 B2

**裁决：采用 B2（`readEmbeddedGraphMeta` 泛化 + `readEmbeddedSourceCommit` 薄壳化）。**

理由：
1. **避免大图重复读取**：`collectGraphAvailability` 与 `runAnnotateCaveat` 都需要同时拿
   `sourceCommit` 与 `fingerprint`，B1（独立新函数二次读文件）会让这两处各自对同一个 `graph.json`
   `statSync` + `readFileSync` + `JSON.parse` 两遍——图产物可达 4.5MB 级别，这不是理论风险。
2. **契约零破坏**：`readEmbeddedSourceCommit` 的既有调用方（`buildStatusPayload` L207）不改一行
   代码；三态 reason 枚举（`file-missing`/`graph-too-large`/`parse-error`）逐字保留，
   `tests/unit/graph-bootstrap-status.test.ts` 的既有三态断言（L354-383）无需改动。
3. **架构收敛方向一致**：`graph-bootstrap-status.mjs` 本就是"图内嵌元数据读取"的 canonical 单点
   （文件头 F241/D8 迁移说明明确"本文件是唯一实现"），把 fingerprint 读取也收进这里，而不是让
   `graph-consumption-cli.mjs` 自己再开一个读文件的路径，符合既有的单一实现原则。
4. 唯一代价是 `collectGraphAvailability` 与 `runAnnotateCaveat` 内部各多几行局部解构，
   可忽略不计。

## 3. `scopeExtensionsSource` 字段兼容性论证与 `AUDIT_SCHEMA_VERSION` 裁决

### 3.1 additive 字段本身的兼容性

- **RG-006 硬约束**：审计事件是只写不读的观测产物（本文件头 L28 "本文件只对审计事件流做
  append，绝不 readFile 它"），生产代码路径没有任何消费方回读并按 schemaVersion 分支解析
  历史审计行；因此新增字段本身**不破坏任何生产逻辑**。
- **`decide` 输出的 JSON payload**（非 dry-run 时同时是 stdout 输出与写入磁盘的对象来源）目前
  唯一的消费方是调用方 agent（读取 `outcome`/`degradedReason`/`caveats` 等既有字段做流程分支）与
  测试的封闭键集断言（`DECIDE_OUTPUT_KEYS`）。新增字段对 agent 侧是纯 additive（多一个可忽略的
  观测字段），不影响既有分支逻辑。

### 3.2 是否需要 bump `AUDIT_SCHEMA_VERSION`（2 → 3）

**裁决：bump。**

理由：
- `schemaVersion` 字段存在的**唯一目的**就是让"事件/输出的形状发生了变化"这件事可被未来的
  消费方（哪怕今天还不存在）显式识别，而不是靠猜测或全量 diff 字段集合。"新增字段是 additive、
  不破坏现有读取逻辑"与"形状是否发生了变化"是两个独立问题——前者回答"要不要紧急处理"，
  后者回答"版本号该不该动"。`scopeExtensionsSource` 确实让 `decide` 输出与 `decision`/
  `caveat-annotation` 两类审计事件的字段集合发生了变化，如果这次不 bump，未来再有一次 additive
  变更时同样"觉得不必 bump"，版本号就会逐渐失去指示意义（"该 bump 却没 bump"的路径依赖）。
- 成本为零：本仓库内没有任何生产代码按 `schemaVersion === 2` 做条件分支（已用 Grep 核实，
  仅测试文件里硬编码断言 `2`，且这些断言在本次改动范围内一并更新）；不存在"旧版本消费方读到
  新 schemaVersion 会拒绝解析"的兼容性代价。
- 与"additive 字段不算破坏性变更"的一般 SemVer 直觉并不矛盾：`AUDIT_SCHEMA_VERSION` 不是
  发布合同版本号（那是 `contracts/release-contract.yaml` 管的），是一个内部形状指纹，bump 的
  代价只是"改一个数字常量 + 同步更新硬编码断言"，而不 bump 的代价是让这个字段逐渐变得不可信。

**受影响的测试断言（已在 §4/§5 的改动清单里）**：
- `graph-consumption-cli.test.mjs:1022` `assert.equal(event.schemaVersion, 2)` → `3`
- `graph-consumption-cli.test.mjs:1077` `assert.equal(annotations[0].schemaVersion, 2)` → `3`
- `graph-consumption-cli.mjs` 内 `export const AUDIT_SCHEMA_VERSION = 2` → `3`

## 4. 回归风险清单

| 风险点 | 判断 | 依据 |
|---|---|---|
| 13 行决策矩阵求值顺序/出口 | **不动** | 本次改动只影响 `coverageScope` 这一维**输入值的计算方式**（从静态常量改为动态推导），矩阵函数 `decideGraphConsumption` 本体零改动 |
| EC-07（刷新后绝不重跑矩阵） | **不动** | `finalizeAfterRefresh` 只读 `changeClass`/`graphAvailability`，本次改动不涉及该函数；`coverageScope` 在决策矩阵求值前一次性算好，刷新分支不会重新计算它 |
| FR-010 快照校验（`snapshotMatches`） | **不动，且与新增的覆盖面重推导语义一致** | 见 §1.3(f)：覆盖面重推导独立于快照校验，两者是并列的"注解时点必须用注解时点的图状态"防线，不互相依赖 |
| C-002"两处判据同一份面" | **原则不变，实现方式变** | 面从"编译期常量"变成"调用时点动态推导的值"，但仍然只有一个推导入口（`deriveScopeExtensionsFromFingerprint` + fallback 常量），`collectCoverageScope` 与 `annotateImpactCaveat` 在同一次 CLI 调用内消费同一个已算好的 `scopeExtensions` 变量，不会出现两处各自推导导致漂移 |
| B1-C6 审计闭包下限清单（`RG006_MINIMUM_AUDITED_FILES`） | **需确认，非破坏** | `graph-bootstrap-status.mjs` 已在下限清单内（L91 `FRESHNESS_AUTHORITY_FILE` 单独豁免机制已覆盖该文件），`resolveImportClosure` 是基于 import 语句的静态扫描，本次未新增新文件、只在已被扫描的两个文件间新增一个函数调用，闭包解析逻辑不受影响 |
| `readEmbeddedSourceCommit` 既有调用方 | **零影响** | `buildStatusPayload`（graph-bootstrap-status.mjs:207）、CLI 的 `readVerifiedSourceCommit` 包装、`tests/unit/graph-bootstrap-status.test.ts` 三态断言，均只依赖返回形状，薄壳化后逐字保持 |
| SC-005 既有场景：`.mjs` 改动预期判 `COVERAGE_GAP_OUT_OF_GRAPH_SCOPE` | **必须改（这正是本 fix 要修的行为）** | `graph-consumption-cli.test.mjs` 第 ~1256 行的 SC-005 场景（`writeGraph(root)` 无 fingerprint + `notes.mjs`）目前断言 `.mjs` 判 out-of-scope；修复后 `.mjs` 落在 12-ext 静态 fallback **与**任何真实 fingerprint 的并集内，恒为 in-scope。该测试用例必须换成一个真正落在 12-ext 并集之外的扩展名（如 `notes.md` / `README.txt`），语义仍是"验证 out-of-scope 出口可达"，只是触发文件从 `.mjs` 换成货真价实的范围外扩展名 |
| `graph-consumption-cli.test.mjs:1223` 范围外扩展名用例 | **必须改** | 用例列表含 `plugins/spec-driver/scripts/lib/goal-loop-core.mjs::foo`（`.mjs`），同上理由需替换为真正范围外的目标（如 `docs/design.md` 已在列表中可保留，`no-extension-at-all` 可保留，仅替换 `.mjs` 那一项） |
| `graph-consumption-decision.test.mjs:457-464` "目标不是 TS/JS 源" | **必须改** | 用例同样用 `.mjs` target 断言不注解；`.mjs` 现落在 fallback 内，需替换为真正范围外扩展名或改造成显式传入自定义 `scopeExtensions`（更贴合新参数化行为的用例） |
| `graph-consumption-decision.test.mjs:507-511` 白名单快照断言 | **必须改** | 断言"恰为四项"，需改为断言"恰为 12 项排序结果"+ 新增一条"该值与 SSoT 并集一致"的跨语言合同测试（不在本文件内做，因为本文件零 import，无法引用 SSoT） |
| `DECIDE_OUTPUT_KEYS` 封闭键集（cli test L94-118，三处 `deepEqual` 断言） | **必须改** | 新增 `scopeExtensionsSource` 键，按字母序插入并更新三处调用点（实为同一个常量，改一处生效） |
| `decision` 审计事件封闭键集（cli test L1014-1021） | **必须改** | 新增 `scopeExtensionsSource` 键 |
| `schemaVersion` 硬编码断言（cli test L1022, L1077） | **必须改** | `2` → `3`，见 §3.2 |
| 混合改动语义（"全部之外才 out-of-scope"） | **不变** | `collectCoverageScope` 的 `anyInScope` 逻辑本体不动，只是判据数组从固定常量变成参数 |
| 空变更清单 = in-graph-scope | **不变** | 同上，`files.length === 0` 早退分支不动 |
| Java/Go/`.py`/`.pyi` 首次真正被纳入覆盖范围 | **方向正确的行为变化，非风险** | fix-report"类似模式"表已评估：这些扩展此前因白名单失真被误判 out-of-scope，本次修复后按其真实采集面正确纳入 in-scope，是本 fix 的题中之义，不是意外副作用 |
| plugins 侧新增的 `formatVersion !== 1` 门槛判断与 TS 侧 `SUPPORTED_FORMAT_VERSION` 重复 | **接受的有界重复，非漂移风险** | 见 §1.3(b) 注释：zero-dist-dependency 边界下的必要重复，只复制"认不认这个格式版本"3 行判断，不复制整套版本比较/校验逻辑；真正易漂移的版本演进语义仍只有一份实现（TS 侧） |

## 5. 验证方案

### 5.1 既有测试更新（必须先改测试，再改实现，还是反过来均可，但提交前两者必须一致）

1. `plugins/spec-driver/tests/graph-consumption-decision.test.mjs`
   - L507-511：断言改为 `assert.deepEqual([...GRAPH_SCOPE_EXTENSIONS].sort(), ['.cjs', '.cts', '.go', '.java', '.js', '.jsx', '.mjs', '.mts', '.py', '.pyi', '.ts', '.tsx'])`；"全仓仅定义一处"的 grep 断言保留（`const definitions = ...`）。
   - L457-464：目标扩展名从 `.mjs` 换成真正范围外扩展名（如 `.md`），或新增一条明确使用第 4 参数
     `scopeExtensions` 覆盖默认值的用例（验证参数化行为本身，例如传入 `['.md']` 后 `.ts` target
     反而不注解）。
   - 新增用例组："annotateImpactCaveat 第 4 参 `scopeExtensions` 参数化"：默认值等价于不传参、
     显式传入自定义数组时判据切换、不修改入参数组（纯函数不变量）。

2. `plugins/spec-driver/tests/graph-consumption-cli.test.mjs`
   - SC-005 场景表（约 L1256）：`COVERAGE_GAP_OUT_OF_GRAPH_SCOPE` 场景的 `notes.mjs` 改为
     `notes.md`（或其他确定落在 12-ext 之外的扩展名），保持 `writeGraph(root)`（无 fingerprint，
     验证 fallback 路径）。
   - L1223-1236：范围外扩展名列表中的 `.mjs` 目标换成真正范围外扩展名。
   - `DECIDE_OUTPUT_KEYS`（L94-118）新增 `'scopeExtensionsSource'`，保持 `.sort()`。
   - decision 审计事件封闭键集（L1014-1021）新增 `'scopeExtensionsSource'`。
   - L1022、L1077 `schemaVersion` 断言 `2` → `3`。
   - 新增用例组："fingerprint 驱动的动态覆盖面"：
     a. 图无 fingerprint 字段（现有 `writeGraph` 形态）→ `scopeExtensionsSource: 'static-fallback'`。
     b. 图带合法 fingerprint 且 `extensionSurface` 不含某扩展（如自定义精简过的 fingerprint）→
        `.py` 改动按该 fingerprint 判 out-of-scope（验证"动态面优先于静态 fallback"，且能收窄
        而不只是扩大范围）。
     c. 图带合法 fingerprint 含 `.mjs` → `.mjs` 改动判 in-scope，`scopeExtensionsSource:
        'graph-fingerprint'`（这是本 fix 要修的核心场景的正面回归用例）。
     d. fingerprint 结构畸形（缺某个已知 key / `extensions` 不是数组 / `formatVersion` 非 1）→
        整体回落 `static-fallback`，不产出部分并集。
     e. `annotate-caveat` 独立进程重新推导覆盖面：decide 阶段与 annotate 阶段图状态不同
        （fingerprint 变化但 sourceCommit 未变——理论上不该发生，但验证函数按各自读取时点独立
        求值，不透传 decide 阶段的值）。

3. `plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs` 与
   `plugins/spec-driver/scripts/graph-consumption-cli.mjs`：按 §1 实现改动。

4. `plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs`：按 §1.1 新增
   `readEmbeddedGraphMeta`，`readEmbeddedSourceCommit` 薄壳化。

### 5.2 新增跨语言合同测试

新建 `tests/unit/graph-scope-extensions-contract.test.ts`（vitest，TS 侧，遵循
`tests/unit/graph-bootstrap-status.test.ts` 的 `.mjs` 动态 import 先例）：

```ts
import { describe, expect, it } from 'vitest';
import { ALL_PRODUCER_SURFACES } from '../../src/collector-surface';

describe('F254 跨语言合同：plugins 侧 fallback 白名单 ↔ SSoT 采集面并集', () => {
  it('GRAPH_SCOPE_EXTENSIONS 与 ALL_PRODUCER_SURFACES 的扩展名并集逐项一致', async () => {
    // @ts-expect-error — .mjs 无类型声明，运行时可解析（同 graph-bootstrap-status.test.ts 先例）
    const decisionModule = await import('../../plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs');
    const expected = new Set<string>();
    for (const surface of ALL_PRODUCER_SURFACES) {
      for (const extension of surface.extensions) expected.add(extension);
    }
    const actual = new Set(decisionModule.GRAPH_SCOPE_EXTENSIONS as string[]);
    expect([...actual].sort()).toEqual([...expected].sort());
  });
});
```

这条测试把"第七处镜像"永久钉死在 SSoT 上：未来任一侧扩面而忘了同步另一侧，本测试立刻红——
直接堵住本次 fix-report 的 Why 4/5（无跨侧同步机制、快照断言锁快照不锁一致性）。

### 5.3 运行验证清单（全部零失败）

```bash
npm run test:plugins      # Node test runner 跑 plugins 侧 .mjs 测试（含本次改动的 4 份文件）
npx vitest run             # TS 侧全量单测，含新增的跨语言合同测试
npm run build              # tsc 类型检查（本次 TS 侧新增测试文件需类型零错误）
npm run repo:check         # 仓库级同步/合同校验
```

新旧图双形态用例（已纳入 §5.1.2 新增用例组，非独立跑批步骤）：
- 旧图（无 `fingerprint` 字段，F249 之前生成的图产物形态）→ 全程走 static-fallback，
  行为与本 fix 之前**完全一致**（回归安全网：验证本次改动没有意外收紧或放宽旧图场景的判定）。
- 新图（含合法 `fingerprint`）→ 走 graph-fingerprint 动态面，`.mjs`/`.py`/`.java`/`.go` 等
  按图真实采集面正确判定 in/out-of-scope。

### 5.4 手动抽查（可选，非门禁）

用本仓库真实 `specs/_meta/graph.json`（若存在且带 F249 fingerprint）跑一次
`node plugins/spec-driver/scripts/graph-consumption-cli.mjs decide --project-root . --refresh-policy declined --dry-run`，
人工确认 `scopeExtensionsSource` 字段按图实际是否带 fingerprint 输出 `graph-fingerprint` 或
`static-fallback`，且 `.mjs` 类改动不再触发 `coverage-gap-out-of-graph-scope`。

## 6. 任务拆分建议（供 tasks 阶段细化）

1. **T1**：`graph-bootstrap-status.mjs` 新增 `readEmbeddedGraphMeta` + `readEmbeddedSourceCommit`
   薄壳化；补 `tests/unit/graph-bootstrap-status.test.ts` 的 `readEmbeddedGraphMeta` 专项用例
   （沿用既有三态 fixture，新增校验 `value.fingerprint` 字段透传）。
2. **T2**：`graph-consumption-decision.mjs` 更新 `GRAPH_SCOPE_EXTENSIONS` 值/注释 +
   `annotateImpactCaveat` 参数化；同步更新 `graph-consumption-decision.test.mjs`
   （白名单断言、目标扩展名用例、新增参数化用例组）。
3. **T3**：`graph-consumption-cli.mjs` 新增 `deriveScopeExtensionsFromFingerprint`、改造
   `collectCoverageScope`/`collectGraphAvailability`/`runDecide`/`runAnnotateCaveat`、
   `AUDIT_SCHEMA_VERSION` bump；同步更新 `graph-consumption-cli.test.mjs`（SC-005 场景、
   范围外扩展名用例、封闭键集、schemaVersion 断言、新增 fingerprint 驱动用例组）。
4. **T4**：新增 `tests/unit/graph-scope-extensions-contract.test.ts` 跨语言合同测试。
5. **T5**：全量验证（`npm run test:plugins` + `npx vitest run` + `npm run build` +
   `npm run repo:check`），零失败后按仓库约定跑 Codex 对抗审查（本地开发规则要求 plan 阶段
   commit 前先审）。

T1→T2/T3 有依赖（T3 需要 T1 的 `readEmbeddedGraphMeta` 导出），T2 与 T3 可并行（decision.mjs
与 cli.mjs 改动相对独立，只在"CLI 传参调用 annotateImpactCaveat 第 4 参"这一点耦合，建议先落
T2 的签名变更再做 T3），T4 依赖 T2 落地后的 `GRAPH_SCOPE_EXTENSIONS` 最终值。
