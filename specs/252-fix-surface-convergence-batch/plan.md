# 修复计划

**关联制品**：`fix-report.md`（方案 A：三项一次收敛 + 派生死代码清理）
**模式**：fix（精简计划，不做完整架构设计）

## 摘要

本批次收敛 collector-surface 同族三处残留形态失真：

1. `ignore-oracle.ts` 的忽略集分派从"提取扩展名再逐面比对"改为直接把整文件路径交给 `surfaceMatchesFile` 判定（**唯一行为变化点**：大小写不敏感族的纯 dotfile 从误分派改为 union 兜底）。
2. `generic-language-skeleton-collector.ts` 两处 + `file-scanner.ts` 一处 `path.extname().toLowerCase()` 收敛为消费 `collector-surface.ts` 的公共 matcher（**零行为变化**，逐字等价）。
3. `isValidCollectorFingerprint` 类型谓词收紧为纯 `boolean`，强制 `pinned-asset-loader.ts` 改经 `parseCollectorFingerprint` 消费 snapshot，guardrail 测试删除 `as never`。
4. 派生清理：`collector-extname.ts` + 其测试随第 1 项迁移后零生产消费方，删除；`source-commit.ts`/`collector-surface.ts` 两处注释同步。

不涉及 spec 变更、不涉及 schema/数据格式变更、不涉及跨包边界扩张——全部改动落在既有 `panoramic/graph`、`batch`、`utils` 三个模块内部实现细节，公开导出面（除 `isValidCollectorFingerprint` 返回类型窄化）不变。

## Impact Assessment（精简版）

- **影响文件数**：7 个生产文件改动（ignore-oracle.ts / generic-language-skeleton-collector.ts / file-scanner.ts / collector-fingerprint.ts / pinned-asset-loader.ts / source-commit.ts 注释 / collector-surface.ts 注释）+ 1 个测试文件改动（guardrail test）+ 1 处新增测试（ignore-oracle.test.ts）+ 2 个文件删除（collector-extname.ts + 其测试）。
- **跨包影响**：0（全部落在 `src/panoramic/graph`、`src/batch`、`src/utils`、`tests/` 内部，无新增跨顶层目录依赖；`ignore-oracle.ts` 删除对 `collector-extname.ts` 的 import 反而**减少**一条模块间依赖）。
- **数据迁移**：无（不改任何持久化 schema、图产物字段、指纹格式）。
- **API/契约变更**：`isValidCollectorFingerprint` 签名从 `value is CollectorFingerprint` 改为 `boolean`——类型层面收紧（收窄了"调用方可依赖类型系统自动窄化"的假设），语义不变（true/false 判定逻辑零改动，内部实现`return parseCollectorFingerprint(value) !== null`本身未改）。经 grep 确认全仓生产代码零依赖该类型窄化能力（`source-commit.ts` 早已直接用 `parseCollectorFingerprint`），故不构成破坏性契约变更。
- **风险等级：LOW**（影响文件 < 10，无跨包影响，无数据迁移，公开契约实质不变）。因此不强制分阶段实现，单一阶段一次性交付即可。

## 变更清单（按文件）

### 变更 1：`src/panoramic/graph/quality/ignore-oracle.ts`（唯一有意行为变化）

**位置**：L30/L36（import）+ L120-143（`ignoreDirsForPath` 函数体与其上方注释块）

- 删除 `import { extractExtension } from '../collector-extname.js';`
- `surfaceHasExtension` 从 import 列表中移除，改为 import `surfaceMatchesFile`：
  ```ts
  import {
    GO_ADAPTER_SURFACE,
    JAVA_ADAPTER_SURFACE,
    PY_WALK_SURFACE,
    TSJS_SKELETON_WALK_SURFACE,
    surfaceMatchesFile,
  } from '../../../collector-surface.js';
  ```
- `ignoreDirsForPath` 函数体：
  ```ts
  function ignoreDirsForPath(relativePath: string): ReadonlySet<string> {
    if (surfaceMatchesFile(TSJS_SKELETON_WALK_SURFACE, relativePath)) return TSJS_IGNORE_DIRS;
    if (surfaceMatchesFile(PY_WALK_SURFACE, relativePath)) return PY_IGNORE_DIRS;
    if (surfaceMatchesFile(JAVA_ADAPTER_SURFACE, relativePath)) return javaIgnoreDirs();
    if (surfaceMatchesFile(GO_ADAPTER_SURFACE, relativePath)) return goIgnoreDirs();
    return GRAPH_COLLECTOR_IGNORE_DIRS;
  }
  ```
- 函数上方注释块（原"扩展名提取消费 F248 的共享 `extractExtension`……本函数是"手上只有扩展名"的分派型消费方，因此用 `surfaceHasExtension` 而非 `surfaceMatchesFile`"一段）需按 W-004 合同整段重写，交代：
  - `ignoreDirsForPath` 手上持有的是完整相对路径（调用方 `createIgnoreOracle` 传入 `relativePath`），不再需要先自行提取扩展名，因此改用 `surfaceMatchesFile`；
  - **行为变化点**：大小写不敏感族（Java/Go）纯 dotfile 路径（如 `vendor/.go`）此前经 `extractExtension` 全字符串搜索会误提取出 `.go` 命中 Java/Go 忽略集合分派，而 generic collector 的真实生产者用 `path.extname().toLowerCase()`（对纯 dotfile 返回空串）根本不会采集这类文件——旧行为是分派到了一个生产者从不采集的文件类别对应的忽略集合，属 W-004 型形态失真；`surfaceMatchesFile` 的 case-insensitive 分支与生产者一致，此类路径改走 union 兜底（`GRAPH_COLLECTOR_IGNORE_DIRS`）；
  - 大小写敏感族（TSJS/PY）零变化：对每个扩展名 `e`，"提取子串 === e" 与 "`relativePath.endsWith(e)`" 严格等价，`surfaceMatchesFile` 的 case-sensitive 分支对完整路径直接 `endsWith` 与旧实现逐一比对结果恒同。

### 变更 2a：`src/batch/generic-language-skeleton-collector.ts`（零行为变化）

**位置**：L44-53（`resolveAdapterForFile`）+ L58-91（`walkFiles`）

- 新增 import：
  ```ts
  import { surfaceMatchesFile, type CollectorPipelineSurface } from '../collector-surface.js';
  ```
- `resolveAdapterForFile`：逐 adapter 构造 case-insensitive surface 后判定，移除 `path.extname` 提取：
  ```ts
  function resolveAdapterForFile(
    filePath: string,
    adapters: readonly LanguageAdapter[],
  ): LanguageAdapter | null {
    for (const adapter of adapters) {
      const surface: CollectorPipelineSurface = {
        extensions: adapter.extensions,
        matchSemantics: 'case-insensitive',
      };
      if (surfaceMatchesFile(surface, filePath)) return adapter;
    }
    return null;
  }
  ```
- `walkFiles`：把入参 `extensions: ReadonlySet<string>` 在函数体首行包成 surface（保持函数签名不变，最小化调用点改动），判定行替换：
  ```ts
  function walkFiles(
    dir: string,
    baseDir: string,
    extensions: ReadonlySet<string>,
    adapterIgnoreDirs: ReadonlySet<string>,
    isIgnored: (relativePath: string) => boolean,
    out: string[],
  ): void {
    // ...既有 entries 读取逻辑不变...
    const surface: CollectorPipelineSurface = { extensions, matchSemantics: 'case-insensitive' };
    for (const entry of entries) {
      // ...目录分支不变...
      if (!entry.isFile()) continue;
      if (!surfaceMatchesFile(surface, entry.name)) continue;
      if (isIgnored(relativePath)) continue;
      out.push(fullPath);
    }
  }
  ```
  （`surface` 对象在每层目录递归调用时各自构造一次，非逐文件构造，性能影响可忽略；不改变函数签名意味着 L81 递归调用与 L113 初始调用两处站内调用点均无需改动。）
- **等价性论证**：`surfaceMatchesFile` 的 case-insensitive 分支为 `surface.extensions.has(path.extname(filePathOrName).toLowerCase())`，与两处原判定式 `extensions.has(path.extname(x).toLowerCase())` / `adapter.extensions.has(path.extname(filePath).toLowerCase())` 逐字符相同，零行为变化，无需新增测试。

### 变更 2b：`src/utils/file-scanner.ts`（零行为变化）

**位置**：L253-263（`walkDir` 签名）+ L296-299（判定行）+ L337 起 `scanFiles` 内 `supportedExtensions` 构造处

- 新增 import：`import { surfaceMatchesFile, type CollectorPipelineSurface } from '../collector-surface.js';`
- `walkDir` 签名不变（仍接收 `supportedExtensions: Set<string>`），函数体内在循环前构造一次 surface：
  ```ts
  function walkDir(
    dir: string,
    baseDir: string,
    isIgnored: (relativePath: string) => boolean,
    supportedExtensions: Set<string>,
    ignoreDirs: Set<string>,
    results: string[],
    stats: { totalScanned: number; ignored: number },
    unsupported: Map<string, number>,
    languageStats: Map<string, LanguageFileStat>,
  ): void {
    // ...
    const surface: CollectorPipelineSurface = {
      extensions: supportedExtensions,
      matchSemantics: 'case-insensitive',
    };
    for (const entry of entries) {
      // ...
      } else if (entry.isFile()) {
        stats.totalScanned++;
        const ext = path.extname(entry.name).toLowerCase(); // 保留：L308/L315/L322 languageStats/unsupported 统计仍需
        if (surfaceMatchesFile(surface, entry.name)) {
          results.push(relativePath);
          // ...languageStats 累加逻辑不变，仍用 ext...
        } else {
          stats.ignored++;
          if (ext) unsupported.set(ext, (unsupported.get(ext) ?? 0) + 1);
        }
      }
    }
  }
  ```
- `ext` 变量的计算保留在原位（供 languageStats 分组键与 unsupportedExtensions 统计使用），只有 `if (supportedExtensions.has(ext))` 这一判定行被替换为 `if (surfaceMatchesFile(surface, entry.name))`。
- **等价性论证**：`surfaceMatchesFile` case-insensitive 分支即 `surface.extensions.has(path.extname(entry.name).toLowerCase())`，与原判定式 `supportedExtensions.has(path.extname(entry.name).toLowerCase())` 逐字符相同（`surface.extensions` 与 `supportedExtensions` 是同一个 Set 引用），零行为变化，无需新增测试。

### 变更 3：`src/panoramic/graph/collector-fingerprint.ts`（类型收紧）

**位置**：L331-333

```ts
export function isValidCollectorFingerprint(value: unknown): boolean {
  return parseCollectorFingerprint(value) !== null;
}
```

函数体逻辑不变（仅签名返回类型从 `value is CollectorFingerprint` 改为 `boolean`）。上方文档注释（L325-330）已是"布尔投影"表述，无需改写。

### 变更 4：`tests/helpers/pinned-asset-loader.ts`（消费方迁移，唯一收窄依赖方）

**位置**：L14-15（import）+ L97-124（`loadPinnedModuleGraphAsset`）

- import 调整：把 `isValidCollectorFingerprint` 换成 `parseCollectorFingerprint`：
  ```ts
  import { parseCollectorFingerprint } from '../../src/panoramic/graph/collector-fingerprint.js';
  ```
  （`CollectorFingerprint` 类型 import 保留，供 `PinnedModuleGraphAsset` 接口标注。）
- 函数体：
  ```ts
  export function loadPinnedModuleGraphAsset(assetPath: string): PinnedModuleGraphAsset {
    const parsed = requireFixtureInputHash(readJson(assetPath), assetPath);

    const fingerprint = parseCollectorFingerprint(parsed['fingerprint']);
    if (fingerprint === null) {
      throw new Error(
        `pinned 资产的 fingerprint 结构非法（parseCollectorFingerprint 返回 null）: ${assetPath}`,
      );
    }

    const moduleGraph = parsed['moduleGraph'];
    if (
      !isPlainObject(moduleGraph) ||
      !Array.isArray(moduleGraph['modules']) ||
      !Array.isArray(moduleGraph['edges'])
    ) {
      throw new Error(
        `pinned 资产缺少 moduleGraph（应含 modules[]/edges[] 的规范化投影）: ${assetPath}` +
          '——注意本文件是 { fixtureInputHash, fingerprint, moduleGraph } 包装，不是裸 ModuleGraph',
      );
    }

    return {
      fixtureInputHash: parsed['fixtureInputHash'] as string,
      fingerprint,
      moduleGraph: moduleGraph as unknown as NormalizedModuleGraphSnapshot,
    };
  }
  ```
- 该函数上方文档注释（原"这里额外跑 `isValidCollectorFingerprint`……"一段）同步改为"这里额外跑 `parseCollectorFingerprint`……额外获得外部 JSON 防御性拷贝收益"的表述。
- **行为收益**：`fingerprint` 字段此前是原始 `parsed['fingerprint']` 引用（未经拷贝），改为 `parseCollectorFingerprint` 返回的 snapshot 后，下游消费（`fingerprintsEqual(pinnedModuleGraph.fingerprint, ...)`）拿到的是与外部 JSON 对象物理独立的深拷贝，规避潜在的"外部文件对象被后续代码意外修改"风险，行为对现有测试断言（结构相等）无影响。

### 变更 5：`tests/unit/guardrail/collector-fingerprint-guardrail.test.ts`（清理 `as never`）

**位置**：L33-38（import）+ L132-144（唯一 `as never` 用例）

- import 追加 `parseCollectorFingerprint`：
  ```ts
  import {
    BEHAVIOR_VERSION,
    computeCollectorFingerprint,
    fingerprintsEqual,
    isValidCollectorFingerprint,
    parseCollectorFingerprint,
  } from '../../../src/panoramic/graph/collector-fingerprint.js';
  ```
- 用例体替换为经真实 control-flow narrowing（`if...throw`）获得强类型 snapshot，而非类型断言绕过：
  ```ts
  it('pinned 与重建产物均记录合法指纹，且 behaviorVersion 等于当前 BEHAVIOR_VERSION（FR-005(c)）', () => {
    const pinnedFingerprint = pinnedGraphOnly.graph.graph.fingerprint;
    const rebuiltFingerprint = rebuiltGraph.graph.fingerprint;

    expect(isValidCollectorFingerprint(pinnedFingerprint)).toBe(true);
    expect(isValidCollectorFingerprint(rebuiltFingerprint)).toBe(true);
    expect(pinnedFingerprint?.behaviorVersion).toBe(BEHAVIOR_VERSION);
    expect(rebuiltFingerprint?.behaviorVersion).toBe(BEHAVIOR_VERSION);

    // F252：isValidCollectorFingerprint 收紧为纯 boolean 后不再是类型谓词，`as never` 类型断言
    // 绕过已不是合适写法——改经 parseCollectorFingerprint 拿到强类型 snapshot（if-throw 是真实
    // control-flow narrowing，非 expect() 内的伪窄化）。
    const pinnedSnapshot = parseCollectorFingerprint(pinnedFingerprint);
    if (pinnedSnapshot === null) {
      throw new Error('pinned fingerprint 应合法（上一行 isValidCollectorFingerprint 已确认为 true）');
    }
    // pinned 记录的指纹与当前代码状态语义相等——不等就说明 pinned 过期，护栏本身失去参照
    expect(fingerprintsEqual(pinnedSnapshot, computeCollectorFingerprint())).toBe(true);
  });
  ```

### 变更 6：派生清理（删除）

- 删除 `src/panoramic/graph/collector-extname.ts`
- 删除 `src/panoramic/graph/collector-extname.test.ts`
- 依据：`source-commit.ts` 已于 F249 完全迁移到 `surfaceMatchesFile`，`ignore-oracle.ts` 经变更 1 迁移后，全仓 `extractExtension` 生产消费方归零（本计划变更 1 生效后须重新 grep 确认 `extractExtension` 仅剩其自身模块与已删除的测试文件引用，方可执行删除）。

### 变更 7：注释同步（无行为影响）

- `src/panoramic/graph/source-commit.ts` L61-65：把"其共享叶子仍由 `ignore-oracle.ts` 这一分派型消费方使用，未被孤立"改为"其共享叶子 `collector-extname.ts` 此前仍由 `ignore-oracle.ts` 引用，该消费方已在 F252 迁移至 `surfaceMatchesFile`（因其实际手上持有完整文件路径而非仅扩展名），`collector-extname.ts` 随之零消费方退役并删除"一类表述，历史事实（F248 达成"消除双实现"意图）保留不改写。
- `src/collector-surface.ts` L160-164（`surfaceHasExtension` 文档注释"适用边界（W-004）"段）：把"供手上只有扩展名、没有文件名的分派型消费方使用（如 `ignore-oracle.ts` 按扩展名选忽略目录集合）"的例子改为如实记账——`ignore-oracle.ts` 已于 F252 迁移到 `surfaceMatchesFile`，`surfaceHasExtension` 目前**零生产消费方**，作为 SSoT 公共 API 面的合法组成部分保留（供未来"确实只掌握扩展名字符串"的消费方使用），并继续被 `tests/unit/collector-surface.test.ts` 的真值表测试锚定。函数本体（L169-177）不改。

## 新增测试

**文件**：`src/panoramic/graph/quality/ignore-oracle.test.ts`（现有 `按语言分派（FIX-5）` describe 块内追加，紧邻既有"未知扩展名兜底"用例）

钉住变更 1 的唯一行为变化点——大小写不敏感族纯 dotfile 从误分派改为 union 兜底。选取判据：路径首段目录命中该语言 adapter **专属**（非 union）忽略目录，若仍走旧误分派逻辑会判 `true`，走新 union 兜底逻辑则判 `false`（因该目录不在 `GRAPH_COLLECTOR_IGNORE_DIRS` 内）：

```ts
it('vendor/.go → 不 ignored（纯 dotfile 不再误分派到 Go 专属忽略集合，F252 行为变化点）', () => {
  const isIgnoredPath = createIgnoreOracle(tmpDir);
  // 'vendor' 只在 GoLanguageAdapter.defaultIgnoreDirs 里，不在 GRAPH_COLLECTOR_IGNORE_DIRS union 内；
  // generic collector 的 path.extname('.go') === ''，根本不会采集这个文件，误分派会让 union 兜底
  // 之外的目录被错误命中。
  expect(isIgnoredPath('vendor/.go')).toBe(false);
});

it('.gradle/.java → 不 ignored（纯 dotfile 不再误分派到 Java 专属忽略集合，F252 行为变化点）', () => {
  const isIgnoredPath = createIgnoreOracle(tmpDir);
  // '.gradle' 只在 JavaLanguageAdapter.defaultIgnoreDirs 里，不在 union 内，理由同上。
  expect(isIgnoredPath('.gradle/.java')).toBe(false);
});

it('vendor/foo.go（真实 Go 文件，非纯 dotfile）→ 仍 ignored（case-insensitive 族非 dotfile 场景零变化）', () => {
  const isIgnoredPath = createIgnoreOracle(tmpDir);
  expect(isIgnoredPath('vendor/foo.go')).toBe(true);
});
```

第三条用例作为对照组，锚定"非纯 dotfile 场景零变化"——防止未来有人把行为变化点误扩大到整个 case-insensitive 族。

其余现有测试（`ignore-oracle.test.ts` 全部既有用例、`collector-surface.test.ts`、`collector-fingerprint.test.ts`、`generic-language-skeleton-collector.test.ts`、`tests/unit/file-scanner.test.ts`、`tests/unit/batch-orchestrator.test.ts`、`tests/panoramic/community-persist.test.ts`、`tests/batch/graph-only-pipeline.test.ts`）均为守护现状行为，不需要修改，作为回归护栏保持原样运行。

## 回归风险评估

| 风险点 | 评估 | 缓解 |
|--------|------|------|
| 变更 1 的行为变化面被低估 | 低——已逐管线论证 case-sensitive 族零变化，只有 case-insensitive 族的纯 dotfile 子集受影响；该子集本身是极端边界值（生产者从不采集这类文件） | 新增 3 条测试（2 条钉行为变化 + 1 条对照组零变化） |
| 变更 2a/2b 引入非预期差异 | 低——两处改动均为逐字符等价的表达式替换，无逻辑分支变化 | 保持既有测试套件全量跑通即为充分验证，不额外增测 |
| 变更 3 的类型收紧影响未预见的调用方 | 低——已全仓 grep 确认唯一收窄依赖方是 `pinned-asset-loader.ts`，其余 6 处调用点均为纯布尔用法 | `npm run build` 的 TS 编译期检查会在遗漏任何依赖类型窄化的调用点时报错，属于强类型信号 |
| 删除 `collector-extname.ts` 造成隐藏消费方失联 | 低——`extractExtension` 当前仅 2 个引用点（`ignore-oracle.ts` 生产代码 + 自身测试），变更 1 落地后归零 | 删除前重新 `grep -r "extractExtension\|collector-extname" src/ tests/` 确认零残留引用；`npm run build` 会在有遗漏 import 时直接报模块找不到 |
| guardrail 测试改写引入假阳性（`if...throw` 分支从未被覆盖到） | 低——`pinnedSnapshot === null` 分支只在 pinned 资产本身损坏时触发，且上一行 `isValidCollectorFingerprint` 断言已确保为 `true`，两者共享同一 `parseCollectorFingerprint` 实现，逻辑上不可能出现"isValid 为 true 但 parse 为 null"的分歧 | 保留原有 `isValidCollectorFingerprint` 断言不删，形成双重覆盖 |

**综合风险等级：LOW**（与 Impact Assessment 一致），无需分阶段实现。

## 验证方案

1. `npx vitest run` 全量——重点关注：
   - `src/panoramic/graph/quality/ignore-oracle.test.ts`（含新增 3 条用例）
   - `src/panoramic/graph/collector-fingerprint.test.ts`
   - `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts`
   - `src/batch/generic-language-skeleton-collector.test.ts`
   - `tests/unit/file-scanner.test.ts`
   - `tests/unit/collector-surface.test.ts`
   - 确认 `src/panoramic/graph/collector-extname.test.ts` 已随源文件一并删除（不再出现在测试清单中）
2. `npm run build`——确认：
   - `isValidCollectorFingerprint` 签名收紧后全仓类型检查零错误（唯一收窄依赖方 `pinned-asset-loader.ts` 已迁移）
   - 删除 `collector-extname.ts` 后无遗留 import 报错
3. `npm run repo:check`——确认源码/包装层/共享片段同步链路无漂移（本批次不触及 contract/wrapper，预期零新增问题）
4. 全部命令零失败方可提交；提交前按仓库约定跑 Codex 对抗审查。

## 范围外确认（不动，与 fix-report 一致）

- `src/adapters/language-adapter-registry.ts::getAdapter`（L87）——与 `resolveAdapterForFile` 同族但服务跨语言通用分派场景，收敛属并行会话 task_a1d4081f（大小写预存缺口）同域，本次不动避免撞车。
- `src/adapters/ts-js-adapter.ts`（L77）、`src/panoramic/cache/cache-key-builder.ts`（L88）——均为已评估的合法通用用法，非采集面判定，不动。
- F249 的 `specs/249-graph-collector-fingerprint/` 历史文档不改写；本批次制品自有 `specs/252-fix-surface-convergence-batch/`。
