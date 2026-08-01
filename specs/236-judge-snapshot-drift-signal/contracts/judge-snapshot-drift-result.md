# 合同：`checkJudgeSnapshotDrift()` 返回结构 与 核心函数接口

**定义位置**：`checkJudgeSnapshotDrift` 编排函数在 `plugins/spec-driver/scripts/judge-snapshot-doctor.mjs` 导出（供测试直接调用，不必经由子进程 spawn）；纯函数/IO 原语在 `plugins/spec-driver/scripts/lib/judge-snapshot-core.mjs` 与 `plugins/spec-driver/scripts/lib/judge-snapshot-io.mjs` 导出。

## 核心接口清单（对齐 spec.md 复杂度评估估算的"4 个内部函数接口"，实际调整为 3 个函数接口 + 1 个常量导出——见 plan.md Complexity Tracking 说明）

| 函数/常量 | 所在文件 | 性质 | 签名 |
|------|---------|------|------|
| `checkJudgeSnapshotDrift` | `judge-snapshot-doctor.mjs` | 编排（内含 I/O 调用） | `({ projectRoot: string, env?: object, claudeHome?: string }) => DriftCheckResult` |
| `resolveActiveSnapshot` | `lib/judge-snapshot-core.mjs` | 纯函数 | `(sources: SnapshotResolutionSources) => SnapshotResolutionResult` |
| `compareFile` / `aggregateStatus` | `lib/judge-snapshot-core.mjs` | 纯函数（一对协作函数） | `compareFile(repoDigest: DigestResult, snapshotDigest: DigestResult) => Omit<FileComparisonEntry, 'file'>`（即 `{ status, side?, errorCode? }`，由调用方补上 `file` 字段）；`aggregateStatus(files: FileComparisonEntry[]) => 'in-sync'\|'drift'\|'indeterminate'` |
| `JUDGE_FILE_SET` | `lib/judge-snapshot-core.mjs` | 常量导出（非函数） | `readonly string[]`（6 个相对路径；`Object.freeze` 防意外改写） |

（本表不含 FR-002b 守卫解析器的 `extractModuleReferences`/`resolveStaticImportClosure`——它们是**测试专用**基础设施，不构成生产运行期契约，详见文末"FR-002b 守卫解析器契约"独立小节。）

## I/O 原语签名（`lib/judge-snapshot-io.mjs`，供实现与单测精确对齐；不计入"核心接口清单"因其是被 `checkJudgeSnapshotDrift` 编排调用的实现细节，但签名精确性同等重要，故单列）

| 函数 | 签名 | 说明 |
|------|------|------|
| `computeSha256` | `(absPath: string) => DigestResult` | 见 data-model.md §2 |
| `validatePluginRoot` | `(dir: string) => PluginRootValidation` | 见 data-model.md §3.1；判别顺序：`dir` 不存在→`invalid(dir-absent)`；`plugin.json` 不存在→`invalid(manifest-missing)`；目录/manifest 读取 I/O 错误→`error(errorCode)`；`plugin.json` `JSON.parse` 失败→`error(errorCode:'manifest-json-parse-error')`；`name!=='spec-driver'`→`invalid(name-mismatch)`；否则→`ok` |
| `readSpecDriverPathFile` | `(projectRoot: string) => SourceProbe` | 读取 `.specify/.spec-driver-path` 内容并对其指向路径调用 `validatePluginRoot`，一体产出 `SourceProbe`；文件不存在/内容为空→`unavailable`；文件读取本身失败→`error` |
| `readInstalledPluginsMetadata` | `(claudeHome: string) => InstalledPluginsMetadataResult` | 见 data-model.md §3.4；`kind:'ok'` 时对每条 entry 调用 `validatePluginRoot` 填充 `PluginRootCandidate.valid`，并计算 `canonicalPath`（`fs.realpathSync` 失败时退化为 `path.resolve(path)`） |
| `scanInstalledSnapshotPresence` | `(claudeHome: string) => 'present' \| 'absent' \| 'error'` | 扫描 `<claudeHome>/plugins/cache/**/spec-driver/*/` 是否存在**任意**匹配目录（不要求该目录 `validatePluginRoot` 通过——仅判定"存在与否"这一更弱的事实）；扫描过程本身遇 I/O 错误（如无法读取 cache 根目录）→ `'error'`，**不得**与"目录结构不存在"混为一谈 |

> 命名变更说明：本轮修订将 `isValidPluginRoot(dir): boolean` 改为 `validatePluginRoot(dir): PluginRootValidation`；`readInstalledPluginsEntries(claudeHome): PluginRootCandidate[] | null` 改为 `readInstalledPluginsMetadata(claudeHome): InstalledPluginsMetadataResult`；`hasAnyInstalledSnapshot(claudeHome): boolean` 改为 `scanInstalledSnapshotPresence(claudeHome): 'present'|'absent'|'error'`。三者均从"布尔/null 坍缩"改为判别式联合，理由见 data-model.md §3、§4（C2 修订：absent/invalid/error 三种性质不同，不可互相坍缩，否则 EACCES/JSON 损坏会被误判为"确实没有"）。

## `DriftCheckResult` 判定优先级（供实现与测试对齐，详见 data-model.md §6；`indeterminate` 拆分为 `resolution`/`comparison` 两个互斥变体，见 data-model.md §6 类型定义）

```
1. repoRoot 下无 plugins/spec-driver/scripts/fix-compliance-judge.mjs
     → { status:'not-applicable', reason:'repo-reference-missing', snapshotPath:null, resolutionSource:null, files:[] }

2. result = resolveActiveSnapshot(sources)
   2a. result.resolutionSource !== 'indeterminate' → 转步骤 3（已解析成功）
   2b. result.reason ∈ { 'source-error', 'installed-plugins-metadata-ambiguous' }
     → { status:'indeterminate', indeterminateKind:'resolution', reason: result.reason, detail: result.detail,
         snapshotPath:null, resolutionSource:null, files:[] }
     （不查 scanInstalledSnapshotPresence——已有比"有没有快照"更明确的错误/歧义信息，不得因其恰好与"无快照"共存而降级为 not-applicable）
   2c. result.reason === 'no-active-snapshot-resolvable'
     → presence = scanInstalledSnapshotPresence(claudeHome)
          'absent'  → { status:'not-applicable', reason:'no-installed-snapshot', snapshotPath:null, resolutionSource:null, files:[] }
          'present' → { status:'indeterminate', indeterminateKind:'resolution', reason:'no-active-snapshot-resolvable',
                        snapshotPath:null, resolutionSource:null, files:[] }
          'error'   → { status:'indeterminate', indeterminateKind:'resolution', reason:'installed-snapshot-scan-error',
                        snapshotPath:null, resolutionSource:null, files:[] }

3. 对 JUDGE_FILE_SET 逐文件 computeSha256(两侧) → compareFile(...) → files[]（见 data-model.md §5，覆盖 3×3=9 种组合）
4. agg = aggregateStatus(files)：any 'indeterminate' → 'indeterminate'；否则 any !== 'match' → 'drift'；否则 'in-sync'
     agg==='indeterminate' → { status:'indeterminate', indeterminateKind:'comparison', reason:'partial-file-read-failure',
                                snapshotPath: result.snapshotPath, resolutionSource: result.resolutionSource, files }
                              （files 必须携带全部 6 条明细，含已确认的 mismatch/missing* 条目，不因存在读取失败而清空）
     agg==='drift'         → { status:'drift', snapshotPath: result.snapshotPath, resolutionSource: result.resolutionSource, files }
     agg==='in-sync'       → { status:'in-sync', snapshotPath: result.snapshotPath, resolutionSource: result.resolutionSource, files }
```

## 测试断言基准（tasks.md / implement 阶段对齐用）

| # | 输入场景 | 期望 `status` | 期望 `indeterminateKind` | 期望 `reason` | 期望 `files` 摘要 |
|---|---|---|---|---|---|
| 1 | `projectRoot` 非 spec-driver 仓库（无 `fix-compliance-judge.mjs`） | `not-applicable` | — | `repo-reference-missing` | `[]` |
| 2 | `claudeHome` 下无任何 `<market>/spec-driver/<version>/` 匹配目录（`scanInstalledSnapshotPresence` → `'absent'`） | `not-applicable` | — | `no-installed-snapshot` | `[]` |
| 3 | `CLAUDE_PLUGIN_ROOT` 指向存在的目录，但其 `.claude-plugin/plugin.json` 读取遇 `EACCES` | `indeterminate` | `resolution` | `source-error`（`detail:{source:'claude-plugin-root', errorCode:'EACCES'}`） | `[]` |
| 4 | 无 `CLAUDE_PLUGIN_ROOT`/`.specify/.spec-driver-path`，`installed_plugins.json` 中 `spec-driver@cc-plugin-market` 含 2 条**不同 canonicalPath**、均 `valid.kind==='ok'` 的候选 | `indeterminate` | `resolution` | `installed-plugins-metadata-ambiguous` | `[]` |
| 4b | 同上但 2 条候选的 `path` 不同、经 `realpathSync` 解析后 `canonicalPath` **相同**（一条是另一条的 symlink） | *不是* `indeterminate` | — | — | 视为单一候选，正常解析并进入比对 |
| 4c | 同上但 2 条候选中 1 条 `valid.kind==='invalid'`（如 `name-mismatch`）、1 条 `valid.kind==='ok'` | *不是* `indeterminate` | — | — | 过滤后剩 1 条合法候选，`resolutionSource:'installed-plugins-metadata'`，正常进入比对，不算歧义 |
| 5 | `installed_plugins.json` 缺失/损坏 + 无 `CLAUDE_PLUGIN_ROOT` + 无 `.specify/.spec-driver-path` + `claudeHome` 下存在 ≥1 个合法快照目录（`scanInstalledSnapshotPresence` → `'present'`） | `indeterminate` | `resolution` | `no-active-snapshot-resolvable` | `[]` |
| 6 | 同上但扫描 `claudeHome` 下 cache 目录本身遇 `EACCES`（`scanInstalledSnapshotPresence` → `'error'`） | `indeterminate` | `resolution` | `installed-snapshot-scan-error` | `[]` |
| 7 | 唯一候选解析成功 + 6 文件全部两侧 sha256 相等 | `in-sync` | — | 无 | 6 条 `match` |
| 8 | 唯一候选解析成功 + 1 文件不等、其余 5 文件相等（部分 match 部分 drift） | `drift` | — | 无 | 5 条 `match` + 1 条 `mismatch` |
| 9 | 唯一候选解析成功 + 快照侧缺失 1 个文件（如 `fix-compliance-execution-record.mjs`） | `drift` | — | 无 | 该项 `status:'missingInSnapshot'`，其余 `match` |
| 10 | 唯一候选解析成功 + 某文件**两侧都缺失**（`missingBoth`，W2 修订） | `drift` | — | 无 | 该项 `status:'missingBoth'`，其余 `match` |
| 11 | 唯一候选解析成功 + 仓库侧某文件读取遇 `EACCES`、其余 5 文件两侧相等 | `indeterminate` | `comparison` | `partial-file-read-failure` | 该项 `status:'indeterminate', side:'repo', errorCode:'EACCES'`，**其余 5 条 `match` 仍完整保留** |
| 12 | 唯一候选解析成功 + 1 文件 `mismatch` 与 1 文件读取 `EACCES` **混合出现**（mismatch+EACCES 混合） | `indeterminate` | `comparison` | `partial-file-read-failure` | `files` 中**同时**保留该 `mismatch` 条目（不被吞掉）与该 `indeterminate` 条目，其余 4 条 `match` |

> 场景 11/12 直接对应 C3 修订核心诉求：`comparison-indeterminate` 绝不能因为整体状态是 `indeterminate` 就清空/隐藏已经确认的 `mismatch`/`missing*` 明细。

## FR-002b 守卫解析器契约（测试专用，独立于 `DriftCheckResult` 主流程）

**定义位置**：`extractModuleReferences`/`resolveStaticImportClosure` 与 fixture 一起放在 `plugins/spec-driver/tests/`（`tests/lib/import-closure-parser.mjs` 做进程编排，`tests/lib/import-closure-helper.mjs` 承载 vm 逻辑，供 `judge-file-set-guard.test.mjs` 与 `judge-file-set-guard-parser.test.mjs` 共同 import），**不**从 `plugins/spec-driver/scripts/lib/` 生产目录导出——它不是生产运行期消费的契约，仅为守卫测试的自身实现细节。

| 函数 | 签名 | 说明 |
|------|------|------|
| `extractModuleReferences` | `(sourceText: string) => ModuleReferenceExtractionResult` | 见 data-model.md §7.3：静态 import specifier 由 Node 官方 `vm.SourceTextModule` 权威提取——版本兼容读取 `moduleRequests`（Node 22.20+/24.4+）或回退 `dependencySpecifiers`（Node 20），均含 `import...from`/`export...from`/side-effect `import`；检测到 dynamic import 调用（`import(` 粗检，间隔容忍空白/块注释/行注释）或解析失败 → 返回 `{ ok:false, unsupported }`，fail-closed。经 spawnSync 子进程执行（需 `--experimental-vm-modules`，带 timeout+SIGKILL 防 silent hang） |
| `resolveStaticImportClosure` | `(entryAbsPath: string) => ImportClosureResult` | 见 data-model.md §7.4：BFS 遍历入口的相对 import 静态闭包；任一文件 fail-closed → 整体立即 `{ ok:false, unsupported }` |

**不变量**：
- `resolveStaticImportClosure(entry).files === JUDGE_FILE_SET`（当 `ok:true`，归一化为相对路径后）是 `judge-file-set-guard.test.mjs` 的核心断言。
- `resolveStaticImportClosure` 返回 `ok:false` 时，该测试同样必须 FAIL（不确定本身即失败，不允许把"无法确认"静默当作"数组不相等"以外的通过路径）。
- **静态 import 闭包由 Node 官方解析（`moduleRequests` / Node 20 回退 `dependencySpecifiers`）权威保证**；dynamic import 一律 fail-closed（判定器不使用该形态，未来若引入需人工确认 `JUDGE_FILE_SET`）。旧承诺"字面量 dynamic import 计边"**撤销**——不再区分字面量/非字面量，凡检测到 dynamic import 调用一律 fail-closed。此为放弃手写 ESM 词法解析（codex 四轮 critical）后的统一收敛结论。
- `judge-file-set-guard-parser.test.mjs` 必须覆盖 data-model.md §7.5 列出的 5 类 fixture（跨行 import、specifier 行内注释、re-export、side-effect import、注释掉的伪 import），独立验证 `extractModuleReferences` 本身的正确性，不依赖"改 `JUDGE_FILE_SET` 看红"这一间接手段。
