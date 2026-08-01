# Data Model: 判定器快照漂移信号

本 feature 无持久化存储，以下实体均为**运行期内存对象**，只在一次 `judge-snapshot-doctor.mjs` 调用的生命周期内存在，不写入任何文件（§7 除外——§7 是 FR-002b 守卫测试专用的测试期内存对象，同样不持久化，但不参与生产运行期 `checkJudgeSnapshotDrift` 流程）。

## 1. Judge File Set（判定器文件集合）

以代码内显式数组维护（`plugins/spec-driver/scripts/lib/judge-snapshot-core.mjs` 导出 `JUDGE_FILE_SET`），相对 `plugins/spec-driver/` 的路径：

```js
export const JUDGE_FILE_SET = [
  'scripts/fix-compliance-judge.mjs',
  'scripts/lib/fix-compliance-core.mjs',
  'scripts/lib/fix-compliance-execution-record.mjs',
  'scripts/lib/fix-compliance-io.mjs',
  'scripts/lib/simple-yaml.mjs',
  'scripts/record-workflow-run.mjs',
];
```

- **不变量**：与 FR-002b 守卫测试解析出的真实 import 闭包（从 `scripts/fix-compliance-judge.mjs` 出发、由 Node 官方 `vm.SourceTextModule` 静态 import specifier（`moduleRequests` / Node 20 回退 `dependencySpecifiers`）解析后的 BFS 结果，见 §7）完全相等，任一方变化而未同步会导致守卫测试失败。
- **fail-closed 前提**：该"完全相等"断言只有在守卫解析器对整条闭包上的每个文件都返回"可完全归类"（`ok:true`）时才有意义；只要闭包遍历中出现任一无法安全归类的引用（如检测到 dynamic import 调用），守卫测试本身直接判定失败（不比较数组是否相等），因为此时"真实闭包是什么"这件事本身已不可信，详见 §7。
- **来源**：仓库侧路径 = `plugins/spec-driver/<entry>`；快照侧路径 = `<snapshotPath>/<entry>`（`<snapshotPath>` 即已安装插件目录，其内部结构与仓库 `plugins/spec-driver/` 同构）。

## 2. Digest Result（单文件摘要结果，io 层输出）

```ts
type DigestResult =
  | { status: 'ok'; sha256: string }
  | { status: 'missing'; sha256: null }
  | { status: 'error'; sha256: null; errorCode?: string };
```

由 `judge-snapshot-io.mjs::computeSha256(absPath)` 产出，非抛出式：文件不存在 → `missing`；权限等其他读取失败 → `error`（附带 `err.code`，如 `EACCES`）；成功 → `ok` + 十六进制 sha256。

## 3. Snapshot Resolution Sources（FR-007 候选，io 层预取 + 校验）

### 3.1 `PluginRootValidation`（单个候选目录的校验结果）

```ts
type PluginRootValidation =
  | { kind: 'ok' }
  | { kind: 'invalid'; reason: 'dir-absent' | 'manifest-missing' | 'name-mismatch' }
  | { kind: 'error'; errorCode: string };
```

**manifest"有效"的精确定义**（`validatePluginRoot(dir)` 的判别顺序，供实现对齐）：

1. `dir` 不存在 → `{ kind:'invalid', reason:'dir-absent' }`（确定性负判定，可安全 fallback 到下一优先级来源）
2. `dir` 存在但 `.claude-plugin/plugin.json` 不存在（`ENOENT`）→ `{ kind:'invalid', reason:'manifest-missing' }`（同上，确定性负判定）
3. 读取 `dir` 或 `plugin.json` 过程中遇到非 `ENOENT` 的 I/O 错误（如 `EACCES`）→ `{ kind:'error', errorCode: err.code }`（**不确定性**判定，**不可**安全 fallback——见 §4 决策逻辑）
4. `plugin.json` 存在但 `JSON.parse` 失败 → `{ kind:'error', errorCode:'manifest-json-parse-error' }`（同上，不确定性判定，不可 fallback）
5. `plugin.json` 解析成功但 `name !== 'spec-driver'` → `{ kind:'invalid', reason:'name-mismatch' }`（确定性负判定，可安全 fallback）
6. 以上全部通过 → `{ kind:'ok' }`

**核心区分**：`invalid` = "确定这不是我们要找的东西"（可放心尝试下一优先级来源）；`error` = "我们不知道这是不是我们要找的东西"（必须停止 fallback，整体转为 `indeterminate`，不得静默当作"这里没有"而继续找别处比对）。

### 3.2 `PluginRootCandidate`（installed_plugins.json 单条 entry 解析结果）

```ts
interface PluginRootCandidate {
  path: string;                    // installed_plugins.json 条目原始 installPath（未 canonicalize）
  canonicalPath: string;            // fs.realpathSync(path) 解析 symlink + 规范化后的绝对路径；path 不可 realpath 时退化为 path.resolve(path)（不影响判定——此时 valid.kind 必然非 'ok'，不参与去重）
  scope: 'user' | 'project' | null; // 来自条目的 scope 元数据；条目不携带该字段时为 null（容忍 installed_plugins.json 当前 schema 可能缺失此字段）
  valid: PluginRootValidation;      // 对 path 调用 validatePluginRoot() 的结果
}
```

### 3.3 `SourceProbe`（单一来源探测结果，`claudePluginRoot`/`specDriverPath` 复用）

```ts
type SourceProbe =
  | { kind: 'unavailable' }                                             // 来源本身未提供输入：env var 未设置 / 文件不存在或内容为空
  | { kind: 'ok'; path: string; canonicalPath: string }                  // 来源提供路径且 validatePluginRoot() 判定 ok
  | { kind: 'invalid'; reason: 'dir-absent' | 'manifest-missing' | 'name-mismatch' } // 确定性负判定，可 fallback
  | { kind: 'error'; errorCode: string };                                // 不确定性判定，不可 fallback
```

- `claudePluginRoot`：由 `checkJudgeSnapshotDrift` 直接读取 `env.CLAUDE_PLUGIN_ROOT`（未设置 → `unavailable`），已设置时调用 `validatePluginRoot(dir)` 并映射为上述判别式。
- `specDriverPath`：由 `readSpecDriverPathFile(projectRoot)`（io 层函数）一体产出——文件不存在/内容为空 → `unavailable`；文件读取本身失败（如 `EACCES`）→ `error`；文件内容非空 → 对其指向路径调用 `validatePluginRoot()` 并映射为 ok/invalid/error。

### 3.4 `InstalledPluginsMetadataResult`（installed_plugins.json 整体读取结果）

```ts
type InstalledPluginsMetadataResult =
  | { kind: 'absent' }                                  // 文件不存在——确定性事实，允许继续 fallback
  | { kind: 'error'; errorCode: string }                 // 文件读取失败（如 EACCES）——不可 fallback
  | { kind: 'invalid'; reason: 'json-parse-error' }      // 内容不是合法 JSON——不可 fallback（文件"存在但读不懂"不等于"没有该文件"）
  | { kind: 'ok'; candidates: PluginRootCandidate[] };   // 合法 JSON；candidates 为 spec-driver@cc-plugin-market 对应 entries，长度可能为 0（文件可读但无该插件条目）
```

由 `readInstalledPluginsMetadata(claudeHome)` 产出；`kind:'ok'` 时对每条 entry 调用 `validatePluginRoot()` 填充 `PluginRootCandidate.valid`。

### 3.5 `SnapshotResolutionSources`（汇总，供 `resolveActiveSnapshot` 输入）

```ts
interface SnapshotResolutionSources {
  claudePluginRoot: SourceProbe;
  specDriverPath: SourceProbe;
  installedMetadata: InstalledPluginsMetadataResult;
}
```

### 3.6 Active 候选去重与优先级边界规则（W1，供实现与测试对齐）

- **canonicalize 先行**：任意两条候选路径比较"是否指向同一目录"前，必须先各自 `fs.realpathSync`（解析 symlink）+ `path.resolve`（相对转绝对、去尾斜杠）得到 `canonicalPath`；仅当 `canonicalPath` 不同才判定为歧义候选，指向同一 real path 的两条记录（如一条经 symlink 指向另一条）不算歧义。
- **先过滤 invalid/error 再判歧义**：判定 `installed_plugins.json` 内多条候选是否构成 `installed-plugins-metadata-ambiguous` 之前，先剔除 `valid.kind !== 'ok'` 的候选（一条 valid 一条 invalid 时，过滤后只剩 1 条，不算歧义，直接采用该条）；若过滤后剩余候选中出现 `valid.kind === 'error'` 的（即校验过程本身失败，而非确定性排除），该候选**不得**被静默丢弃到"歧义判定"环节之外——`readInstalledPluginsMetadata` 层面只要 candidates 中存在任意一条 `valid.kind==='error'`，视为该来源整体不可信，直接产出 `indeterminate/source-error`（不参与后续的"剩余候选计数"逻辑，因为"剩余几条"这个问题本身依赖于我们能否正确判定每一条，而 error 恰恰意味着判不了）。
- **scope 优先级**：若过滤（仅保留 `valid.kind==='ok'`）后的候选集中存在至少 1 条 `scope === 'project'`，则只保留 `scope === 'project'` 的候选参与后续 canonicalize 去重与计数（project scope 优先于 user scope 采信——项目显式绑定的安装版本更贴近该仓库实际生效版本）；若不存在任何 `project` scope 候选（全部为 `user` 或 `null`），则保留全部候选参与去重与计数，不引入进一步的未定义优先级判断。
- **manifest 有效定义**：见 §3.1 `validatePluginRoot` 判别顺序——目录存在 + `.claude-plugin/plugin.json` 可被 `JSON.parse` 成功解析 + 解析结果 `name === 'spec-driver'`。

## 4. Snapshot Resolution Result（FR-007 决策结果，core 层纯函数输出）

```ts
type SnapshotResolutionResult =
  | {
      snapshotPath: string;
      resolutionSource: 'claude-plugin-root' | 'spec-driver-path-file' | 'installed-plugins-metadata';
    }
  | {
      snapshotPath: null;
      resolutionSource: 'indeterminate';
      reason: 'source-error' | 'installed-plugins-metadata-ambiguous' | 'no-active-snapshot-resolvable';
      detail?: {
        source: 'claude-plugin-root' | 'spec-driver-path-file' | 'installed-plugins-metadata';
        errorCode?: string;
      };
    };
```

`resolveActiveSnapshot(sources)` 决策逻辑（按 FR-007 四步优先级，`kind:'error'`/`kind:'invalid'(json-parse-error)` 一律归为 `source-error` 大类且立即短路，不静默 fallback）：

1. `sources.claudePluginRoot`：
   - `kind==='ok'` → `{ snapshotPath: path, resolutionSource: 'claude-plugin-root' }`
   - `kind==='error'` → `{ ..., reason:'source-error', detail:{ source:'claude-plugin-root', errorCode } }`（立即返回，不再看后续来源）
   - `kind==='invalid'|'unavailable'` → 继续第 2 步
2. `sources.specDriverPath`：同构规则（`resolutionSource:'spec-driver-path-file'`，`detail.source:'spec-driver-path-file'`）
3. `sources.installedMetadata`：
   - `kind==='error'` → `{ ..., reason:'source-error', detail:{ source:'installed-plugins-metadata', errorCode } }`
   - `kind==='invalid'`（json-parse-error）→ `{ ..., reason:'source-error', detail:{ source:'installed-plugins-metadata', errorCode:'json-parse-error' } }`
   - `kind==='absent'` → 视为"该来源无候选"（确定性事实），继续第 4 步
   - `kind==='ok'`：按 §3.6 规则过滤/去重/计数：
     - 存在任意候选 `valid.kind==='error'` → `{ ..., reason:'source-error', detail:{ source:'installed-plugins-metadata', errorCode: 该候选.valid.errorCode } }`（取遇到的第一条 `error` 候选的 `errorCode`）
     - 过滤+去重后候选数 = 0 → 继续第 4 步
     - = 1 → `{ snapshotPath: canonicalPath, resolutionSource:'installed-plugins-metadata' }`
     - ≥ 2（不同 canonicalPath）→ `{ ..., reason:'installed-plugins-metadata-ambiguous' }`
4. 三路来源均未给出可用候选（均 `unavailable`/`invalid`/`absent`-且过滤后为空，且均未触发上述任一 `source-error` 短路）→ `{ ..., reason:'no-active-snapshot-resolvable' }`

- `reason` 仅在 `resolutionSource === 'indeterminate'` 时存在；`detail` 仅在 `reason==='source-error'` 时可能存在，标注是哪个来源、哪种底层错误导致的不确定性。
- **`checkJudgeSnapshotDrift` 编排层的进一步处理**（见 §6）：仅当 `reason==='no-active-snapshot-resolvable'` 时才需要额外查询 `scanInstalledSnapshotPresence(claudeHome)` 来判定最终是 `not-applicable` 还是 `indeterminate`；`reason` 为 `'source-error'` 或 `'installed-plugins-metadata-ambiguous'` 时**直接**转为最终 `indeterminate`，不得因为"本机恰好也没有其他快照"而被降级为 `not-applicable`——已确认的错误/歧义信息优先级高于"有没有快照"这一更弱的判定。

## 5. File Comparison Entry（单文件比对结果）

```ts
interface FileComparisonEntry {
  file: string;      // JUDGE_FILE_SET 中的相对路径
  status: 'match' | 'mismatch' | 'missingInRepo' | 'missingInSnapshot' | 'missingBoth' | 'indeterminate';
  side?: 'repo' | 'snapshot' | 'both';  // 仅 status==='indeterminate' 时存在：标注哪一侧触发了读取失败
  errorCode?: string;                    // 仅 status==='indeterminate' 时可能存在：触发失败一侧 DigestResult.errorCode
}
```

由 `judge-snapshot-core.mjs::compareFile(repoDigest, snapshotDigest)` 对每个文件产出（纯函数，输入是两侧 `DigestResult`，输出 `Omit<FileComparisonEntry, 'file'>`，由调用方补上 `file` 字段）。判定表覆盖 `repoDigest.status × snapshotDigest.status` 全部 3×3 = 9 种组合，无遗漏：

| repoDigest.status | snapshotDigest.status | `status` | `side` | `errorCode` |
|---|---|---|---|---|
| `error` | `error` | `indeterminate` | `both` | `repoDigest.errorCode`（两侧都有值时优先取 repo 侧，snapshot 侧 errorCode 视为次要信息） |
| `error` | 非 `error` | `indeterminate` | `repo` | `repoDigest.errorCode` |
| 非 `error` | `error` | `indeterminate` | `snapshot` | `snapshotDigest.errorCode` |
| `missing` | `missing` | `missingBoth` | — | — |
| `missing` | `ok` | `missingInRepo` | — | — |
| `ok` | `missing` | `missingInSnapshot` | — | — |
| `ok` | `ok`，sha256 相等 | `match` | — | — |
| `ok` | `ok`，sha256 不等 | `mismatch` | — | — |

**关于 W2 的修订**：此前版本把"两侧都缺同一文件"误判为 `missingInRepo`（字面意思是"repo 缺、snapshot 有"，与两侧都缺的事实矛盾）。现改为独立的 `missingBoth` 态，如实描述"两侧都不存在该文件"这一确定性事实（不是读取错误，不需要 `indeterminate`）；它仍会使 `aggregateStatus` 判定整体为 `drift`（因为 `missingBoth !== 'match'`），因为"判定器文件集合中某文件在两侧都不存在"本身就是需要开发者关注的异常状态。

## 6. Drift Check Result（顶层输出实体，Key Entities 对应）

`DriftCheckResult` 是一个判别式联合（discriminated union），按 `status`（及 `indeterminate` 态下的 `indeterminateKind`）区分 5 种互斥形状：

```ts
type DriftCheckResult =
  | {
      status: 'not-applicable';
      reason: 'repo-reference-missing' | 'no-installed-snapshot';
      snapshotPath: null;
      resolutionSource: null;
      files: [];
    }
  | {
      status: 'indeterminate';
      indeterminateKind: 'resolution';   // active 快照解析阶段即失败/歧义，尚未进入逐文件比对
      reason: 'source-error' | 'installed-plugins-metadata-ambiguous'
            | 'no-active-snapshot-resolvable' | 'installed-snapshot-scan-error';
      detail?: { source: 'claude-plugin-root' | 'spec-driver-path-file' | 'installed-plugins-metadata'; errorCode?: string };
      snapshotPath: null;
      resolutionSource: null;
      files: [];
    }
  | {
      status: 'indeterminate';
      indeterminateKind: 'comparison';   // active 快照已成功解析，但逐文件比对中至少 1 个文件读取失败
      reason: 'partial-file-read-failure';
      snapshotPath: string;              // 必须保留——已确定的快照目录，不因部分文件读取失败而清空
      resolutionSource: 'claude-plugin-root' | 'spec-driver-path-file' | 'installed-plugins-metadata';
      files: FileComparisonEntry[];      // 必须保留全部 6 条明细，含已确认的 match/mismatch/missing* 条目与触发失败的 indeterminate 条目
    }
  | {
      status: 'in-sync';
      snapshotPath: string;
      resolutionSource: 'claude-plugin-root' | 'spec-driver-path-file' | 'installed-plugins-metadata';
      files: FileComparisonEntry[];      // 6 条，全部 'match'
    }
  | {
      status: 'drift';
      snapshotPath: string;
      resolutionSource: 'claude-plugin-root' | 'spec-driver-path-file' | 'installed-plugins-metadata';
      files: FileComparisonEntry[];      // 6 条，至少 1 条非 'match' 且不含 'indeterminate'
    };
```

**关于 C3 的修订**：此前版本所有 `indeterminate` 一律 `snapshotPath:null`/`files:[]`，导致"active 解析失败"与"快照已定位、仅部分文件读取失败"这两种性质完全不同的场景被压缩成同一形状——后者本应保留已确认的比对明细（含已确认的 `mismatch`），却被整体清空。现拆分为 `resolution-indeterminate`（`indeterminateKind:'resolution'`，快照路径尚未确定，`files` 天然为空）与 `comparison-indeterminate`（`indeterminateKind:'comparison'`，快照路径已确定，`files` 必须携带全部明细），两者由 `indeterminateKind` 判别，互不混淆。

`checkJudgeSnapshotDrift()` 编排产出优先级（`indeterminate > drift > in-sync`，但 `comparison-indeterminate` 绝不隐藏已确认的 `files` 明细）：

```
1. repoRoot 下无 plugins/spec-driver/scripts/fix-compliance-judge.mjs
     → { status:'not-applicable', reason:'repo-reference-missing', snapshotPath:null, resolutionSource:null, files:[] }

2. result = resolveActiveSnapshot(sources)（见 §4）
   2a. result.resolutionSource !== 'indeterminate' → 转步骤 3
   2b. result.reason ∈ { 'source-error', 'installed-plugins-metadata-ambiguous' }
     → { status:'indeterminate', indeterminateKind:'resolution', reason: result.reason, detail: result.detail,
         snapshotPath:null, resolutionSource:null, files:[] }
     （不再查 scanInstalledSnapshotPresence——已有更明确的错误/歧义信息，禁止因其恰好与"无快照"共存而降级为 not-applicable）
   2c. result.reason === 'no-active-snapshot-resolvable'
     → presence = scanInstalledSnapshotPresence(claudeHome)
          'absent'  → { status:'not-applicable', reason:'no-installed-snapshot', snapshotPath:null, resolutionSource:null, files:[] }
          'present' → { status:'indeterminate', indeterminateKind:'resolution', reason:'no-active-snapshot-resolvable',
                        snapshotPath:null, resolutionSource:null, files:[] }
          'error'   → { status:'indeterminate', indeterminateKind:'resolution', reason:'installed-snapshot-scan-error',
                        snapshotPath:null, resolutionSource:null, files:[] }

3. 对 JUDGE_FILE_SET 逐文件 computeSha256(两侧) → compareFile(...) → files[]（见 §5）
4. agg = aggregateStatus(files)：any 'indeterminate' → 'indeterminate'；否则 any !== 'match' → 'drift'；否则 'in-sync'
   agg==='indeterminate' → { status:'indeterminate', indeterminateKind:'comparison', reason:'partial-file-read-failure',
                              snapshotPath: result.snapshotPath, resolutionSource: result.resolutionSource, files }
   agg==='drift'         → { status:'drift', snapshotPath: result.snapshotPath, resolutionSource: result.resolutionSource, files }
   agg==='in-sync'       → { status:'in-sync', snapshotPath: result.snapshotPath, resolutionSource: result.resolutionSource, files }
```

- 不包含任何"修复建议"字段（FR-011）。

## 7. Static Import Closure Result（FR-002b 守卫测试专用，非生产运行期消费）

**用途边界**：本节实体仅供 `plugins/spec-driver/tests/judge-file-set-guard.test.mjs`（对仓库真实入口跑 BFS）与 `plugins/spec-driver/tests/judge-file-set-guard-parser.test.mjs`（对 fixture 片段单独测试解析器本身）使用，**不**参与 `checkJudgeSnapshotDrift` 生产流程，**不**由 `judge-snapshot-doctor.mjs` CLI 消费。

### 7.1 解析器动机与架构转向（回应 C1–C4：放弃手写 tokenizer）

朴素的逐行 `import ... from` 正则在仓库真实文件上已被证实会静默腐化：仓库内已存在跨行 import（`fix-compliance-judge.mjs:23`）、specifier 行内注释（`fix-compliance-core.mjs:19`）、`export {…} from` re-export（`fix-compliance-core.mjs:1102`）。

早期尝试用"手写词法状态机 tokenizer（行/块注释 + 字符串 + 模板 + regex-vs-division 消歧）"替代正则，但经 codex 四轮对抗审查证明「手写 ESM 词法解析是无底洞」：控制语句后 regex、postfix `++`/`--` 后的除法、独立 CR / U+2028 / U+2029 / NBSP / BOM 空白、specifier 转义等词法边角层出不穷，每轮补漏又暴露新洞。

**架构转向（本轮）**：**静态 import 闭包完全交给 Node 官方词法解析**——`new vm.SourceTextModule(sourceText)` 的 import specifier 由 Node 内建解析给出，一次性根治上述全部边角，不再手写任何 ESM 词法处理。Node 自己就是 ESM 词法的 ground truth。specifier 列表按 Node 版本兼容读取：

- Node 22.20+ / 24.4+：`mod.moduleRequests`（`{ specifier }[]`），`.map(r => r.specifier)`；
- Node 20（CI 固定版本）：`mod.moduleRequests` 为 `undefined`，改用 `mod.dependencySpecifiers`（`string[]`，直接是 specifier 列表）。

两者均为 Node 内建解析结果，探测式回退 `const specs = mod.moduleRequests ? mod.moduleRequests.map(r => r.specifier) : mod.dependencySpecifiers;`，**不引入任何手写 tokenizer**。含 `import…from` / side-effect `import '<spec>'` / `export…from` re-export 全部形态。

**dynamic import → fail-closed（保守）**：静态 specifier 列表不枚举 dynamic import。守卫的立场收敛为——**只保证静态 import 闭包正确；dynamic import 是判定器当前不使用的形态**。用一个保守粗检扫描源码是否出现 dynamic import 调用（`import` 后跟 `(`，两者间允许 空白 / 块注释 `/*…*/` / 行注释 `//…\n` 任意间隔——合法 dynamic import 允许 `import/**/(…)` 与 `import// x\n(…)` 形态；排除 `import.meta` 与 static `import…from`），一旦命中即整体 fail-closed，提示人工确认 `JUDGE_FILE_SET`。当前 6 个判定器文件均无 dynamic import，故不触发。

- **已知限制（误报方向安全）**：粗检不区分代码上下文——字符串 / 注释 / 模板原文里出现的 `import(` 会被保守命中（误报），方向安全：宁可多要人工确认一眼，也绝不静默放行真实 dynamic import。诊断 snippet 指向正则**真实命中处**（由字符偏移换算行号），而非源码首个 `import` 出现行。

**flag 集成**：`vm.SourceTextModule` 需 `--experimental-vm-modules`，而 `npm run test:plugins`（`node --test`）默认不带此 flag。故用 **spawnSync 子进程隔离**：`import-closure-parser.mjs`（守卫测试 import 的模块）只做进程编排 + JSON 解析；真正的 vm 逻辑在 `tests/lib/import-closure-helper.mjs`，由 `spawnSync(process.execPath, ['--experimental-vm-modules', helper, ...])` 调起，输出 JSON 供测试读回断言。**spawnSync 带明确 `timeout`（10s，真实闭包约 24ms）+ `killSignal:'SIGKILL'`**：若 helper 因 bug silent hang（保持事件循环存活却不退出），到点被杀并把 `r.error`（含 `ETIMEDOUT` / `ENOENT` 等）正规化为 `ok:false`（fail-closed），避免 CI 静默卡死。不改 `test:plugins` 全局脚本。helper 与守卫解析器均零 npm 依赖（`vm` / `child_process` / `fs` / `path` 皆 node 内置）。

### 7.2 类型定义

```ts
interface UnsupportedModuleRef {
  file: string;     // 相对 plugins/spec-driver/ 的路径（extract 模式为空串，closure 模式为当前文件）
  line: number;      // 1-based 行号，供人工定位
  snippet: string;   // 原始源码行文本（或错误详情）
  kind: 'dynamic-import' | 'unrecognized-syntax';  // dynamic import 粗检命中 / 解析失败或读文件失败
}

type ModuleReferenceExtractionResult =
  | { ok: true; refs: string[] }                         // moduleRequests 给出的静态 import specifier（去重）
  | { ok: false; unsupported: UnsupportedModuleRef[] };  // 检测到 dynamic import 或解析失败 → 整体 fail-closed

type ImportClosureResult =
  | { ok: true; files: string[] }                        // BFS 遍历入口得到的绝对路径闭包（含入口自身）
  | { ok: false; unsupported: UnsupportedModuleRef[] };  // 闭包遍历中任一文件 fail-closed → 整体 fail-closed
```

### 7.3 `extractModuleReferences(sourceText)` 算法（单文件源码文本输入）

经由 helper 子进程执行：

1. **dynamic import 粗检**：正则 `(^|[^.\w$])import(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*\(` 扫描原始源码（间隔覆盖 空白 / 块注释 / 行注释）。命中 → `{ ok:false, unsupported:[{kind:'dynamic-import', ...}] }`（保守；对字符串/注释内的 `import(` 一并命中，误报无害；诊断行号取正则真实命中处的字符偏移）。
2. **静态 specifier = Node 权威**：`mod.moduleRequests ? mod.moduleRequests.map(r => r.specifier) : mod.dependencySpecifiers`（版本兼容：新 Node 用 `moduleRequests`，Node 20 用 `dependencySpecifiers`）。构造抛错（非法语法）→ `{ ok:false, unsupported:[{kind:'unrecognized-syntax', ...}] }`。
3. 否则 → `{ ok:true, refs: [...new Set(specifiers)] }`（去重）。

注释、字符串、模板、regex 等词法遮蔽由 Node 内部解析器完成，守卫不再自行处理——这是本轮消除 C1–C4 全部词法边角的根本手段。

### 7.4 `resolveStaticImportClosure(entryAbsPath)`（测试专用 BFS 辅助，非生产代码）

helper 子进程内 BFS：对每个相对 specifier（以 `./` 或 `../` 开头；忽略裸包名如 `node:*` 或第三方包）解析为绝对路径并加入待访问队列；任一文件出现 dynamic import 或解析/读取失败 → **整体 BFS 立即返回 `{ ok:false, unsupported }`**；全部访问完成 → 返回 `{ ok:true, files }`（绝对路径集合，含入口自身；测试侧再 `path.relative(PLUGIN_ROOT, …)` 归一化后与 `JUDGE_FILE_SET` 比对）。

**不变量**：`resolveStaticImportClosure(entry).files`（当 `ok:true`，归一化为相对路径后）MUST 与 `JUDGE_FILE_SET` 完全相等（`judge-file-set-guard.test.mjs` 断言）；返回 `ok:false` 时该测试同样判定 FAIL，提示"检测到 dynamic import / 未支持形态，静态闭包可能不完整，请人工确认 JUDGE_FILE_SET"——**不确定本身即视为守卫失败**，不允许静默放行到"数组比对相等"这一步。

### 7.5 独立 fixture 测试（回应 C1"不能只靠改 JUDGE_FILE_SET 看红证明解析器正确"）

`judge-file-set-guard-parser.test.mjs` 直接对 `extractModuleReferences` 喂入 `plugins/spec-driver/tests/fixtures/judge-file-set-guard/` 下的 5 类 fixture 源码片段，断言解析结果与预期一致：

1. **跨行 import**：`import { a, b, c } from\n  '../lib/foo.mjs';` → `refs` 含 `'../lib/foo.mjs'`
2. **specifier 行内含注释**：`import x from '../lib/foo.mjs'; // 提到 import '../fake.mjs' 的注释`→ `refs` 只含 `'../lib/foo.mjs'`，**不**含注释内提及的 `'../fake.mjs'`
3. **re-export**：`export { a, b } from '../lib/foo.mjs';` 与 `export * from '../lib/bar.mjs';` 各一例 → 均计入 `refs`
4. **side-effect import**：`import '../lib/side-effect.mjs';` → 计入 `refs`
5. **注释掉的伪 import**：整行处于 `//` 或 `/* */` 内的 `import '../not-a-real-dependency.mjs';` → 断言 `refs` 与 `unsupported` 均**不**包含该行任何内容（验证遮蔽正确生效，既不误判为边也不误判为 unsupported）

该测试独立于"对仓库真实 6 文件跑 BFS"的 `judge-file-set-guard.test.mjs`，防止"只靠改 `JUDGE_FILE_SET` 看红"这种间接验证掩盖解析器本身的实现 bug。
