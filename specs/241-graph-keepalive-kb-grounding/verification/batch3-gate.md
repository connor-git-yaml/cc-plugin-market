# F241 批 3 门禁记录（T065）

基线 `batch3=bc3bfb5`。全部命令在本 worktree 内实跑，输出如实抄录。

## 1. 工具链

| 门禁项 | 命令 | 结果 |
|---|---|---|
| KB 套件 | `npx vitest run tests/kb/` | **38 文件 / 511 测试 全 pass**（批 2 基线 35/415 → **+3 文件 / +96 测试**，纯增无减） |
| CLI 集成点名重跑（T-C5） | `npx vitest run tests/kb/cli-scaffold-kb.test.ts` | **26 passed (26)** |
| 全量 vitest | `npx vitest run` | `Test Files 496 passed \| 4 skipped (500)` / `Tests 6235 passed \| 18 skipped \| 21 todo (6274)`，EXIT=0（基线 493 passed / 6139 passed → +3 文件 / +96 测试，与 `tests/kb/` 净增完全对齐） |
| 插件 node:test | `node --test plugins/spec-driver/tests/*.mjs` | `tests 1272 / pass 1272 / fail 0` |
| 构建 | `npm run build`（tsc + postbuild） | EXIT=0，零类型错误 |
| 仓库校验 | `npm run repo:check` | **EXIT=0**，86 项全 pass |

## 2. RG-008 命令矩阵（T-W4 / P-W4）

四个只读 CLI 子命令各执行一次；对 `specs/_meta/graph.json` 与被查询的
`chunks.sqlite` 同时做 before/after SHA-256 比对。

| op | 命令 | 退出码 | `specs/_meta/graph.json` SHA-256 | `chunks.sqlite` SHA-256 |
|---|---|---|---|---|
| `coverage-gap` | `scaffold-kb coverage-gap --format json` | **0** | **SAME**（`ab931850e712f2e6…`） | **SAME**（`d5b8c002608fdc25…`） |
| `version` | `scaffold-kb version --package echarts --project-root <repo> --format json` | **0** | **SAME**（同上） | **SAME**（同上） |
| `status` | `scaffold-kb status --vendor-kb <kb> --format json` | **0** | **SAME**（同上） | **SAME**（同上） |
| `query` | `scaffold-kb query --requirement "错误码 ERR_X" --vendor-kb <kb> --format json` | **0** | **SAME**（同上） | **SAME**（同上） |

四项全 exit 0、两类产物 SHA-256 全部逐字节相同。

## 3. RG-009 缺 provenance 列故障注入

构造一份 F190 旧 schema 库（`chunk_meta` 无 `ingest_source_type` / `ingest_origin` /
`ingested_at` 三列），且 `built_at` 故意设为 **1 天前（很新）**，跑真实 CLI：

```
exit=0  sha_same=SAME
{"schemaCompat":"legacy-missing-provenance","freshness":"unknown",
 "activityAt":null,"activityAgeDays":null,"oldestBuiltAt":"(present)"}
```

- 退出码 0、库文件 SHA-256 不变（读路径零副作用）；
- **P-W4 钉死项端到端兑现**：`built_at` 再新也恒为 `freshness: "unknown"`，未回落 `current`；
- 可见性字段 `oldestBuiltAt` 仍如实输出（不参与判级）。

## 4. RG-005（KB 现有链零回归）

`git diff bc3bfb5 -- tests/ src/`：**614 insertions / 10 deletions**。

`tests/kb/kb-contract.test.ts`：**122 insertions / 1 deletion**，唯一被删的一行是

```
-      ['query_echoed', 'results', 'sources_queried', 'total_found', 'truncated'].sort(),
```

替换为同一列表 **加上** `'kb_status'`，仍是 `toEqual` **exact 相等**（未换成
`arrayContaining` 等超集匹配 → **断言强度不降**）。这一处修改是 FR-021「新增顶层字段」
的结构性后果，plan §4 的「既有快照断言天然不受影响」表述有误（见交付报告缺陷上报）。
同时**追加**了一条更严的反向断言：剥掉 `kb_status` 后剩余 key 集合与接线前 5 项逐字段相等，
且逐一断言其类型与取值。其余既有断言零改动。

`plugins/spec-driver/scripts/**`：本批**零改动**（`git status` 已核）。

## 5. continuous capture 台账同步

| 项 | 值 |
|---|---|
| `pilot/ledger.jsonl` 本批新增 | **4 行**（0 删除） |
| `pilot/mcp-call-log.md` 本批新增表行 | **4 行** |
| 新增 seq | `1-21` / `1-22` / `1-23` / `1-24` |
| seq 分段内单调且连续 | **true**（脚本重算，27 行全量核过） |
| 新增行 `timestamp` 均为合法 ISO 8601 | **true** |

---

# 第二轮：Codex 对抗审查整改后复跑（B3-C1 ~ B3-W3）

> 审查会话 codex `task-msccuu9b-5bu75q` 判「阻断提交」（5 CRITICAL / 4 WARNING）。
> 下表为**整改后**在同一 worktree 内的重跑，全部实跑输出如实抄录。上文第 1-5 节是整改前的记录，保留不删。

## 6. 工具链复跑

| 门禁项 | 命令 | 结果 |
|---|---|---|
| KB 套件 | `npx vitest run tests/kb/` | **38 文件 / 569 测试 全 pass**（整改前 511 → **+58**，纯增无减；批 2 基线 415） |
| CLI 集成点名重跑（T-C5） | `npx vitest run tests/kb/cli-scaffold-kb.test.ts` | **37 passed (37)**（整改前 26） |
| 全量 vitest | `npx vitest run` | `Test Files 496 passed \| 4 skipped (500)` / `Tests 6293 passed \| 18 skipped \| 21 todo (6332)`，EXIT=0（整改前 6235 → +58，与 `tests/kb/` 净增完全对齐） |
| 插件 node:test | `node --test plugins/spec-driver/tests/*.mjs` | `tests 1272 / pass 1272 / fail 0` |
| 构建 | `npm run build`（tsc + postbuild） | EXIT=0，零类型错误 |
| 仓库校验 | `npm run repo:check` | **EXIT=0**，86 项全 pass |

> **一次已排除的 flaky**：首轮全量跑出现 1 例
> `tests/integration/graph-quality-cli.test.ts > dirty 态验证 … exit 0`（收到 1）。
> 隔离重跑 `17 passed (17)`，随后全量复跑亦全绿；该用例在 tmpDir 内自建 git 仓 + spawn 真实 CLI，
> 属已登记的「满载下子进程 CLI 超时」形态，与本轮改动无关（本轮未触及 graph-quality 任何路径）。
> **不当作回归**，但如实记录。

## 7. RG-008 命令矩阵复跑（整改后）

`chunks.sqlite` 取 `plugins/demo-kb-zh/kb/chunks.sqlite`。

| op | 命令 | 退出码 | `specs/_meta/graph.json` | `chunks.sqlite` |
|---|---|---|---|---|
| `coverage-gap` | `scaffold-kb coverage-gap --format json` | **0** | **SAME** | **SAME** |
| `version` | `scaffold-kb version --package echarts --project-root . --format json` | **0** | **SAME** | **SAME** |
| `status` | `scaffold-kb status --vendor-kb plugins/demo-kb-zh/kb --format json` | **0** | **SAME** | **SAME** |
| `query` | `scaffold-kb query --requirement "错误码 ERR_X" --vendor-kb plugins/demo-kb-zh/kb --format json` | **0** | **SAME** | **SAME** |

- `specs/_meta/graph.json` SHA-256 = `ab931850e712f2e6bab7075836276b9decdee1daca05afdb1b60fc361454bcbe`（四次前后全同）
- `chunks.sqlite` SHA-256 = `2b6757b2e7e1a20380a4f2ed48df5ba1d35479d7b60b66d705d091f81fa6c736`（四次前后全同）
- 另在 vitest 层补了 B3-W2 要求的**对 CLI 实际读的那个文件路径**做 SHA 的用例：先断言输出的
  `dbPath` 就是被 hash 的那个文件（证明它确实被读到），再比 SHA，最后主动改一个字节断言 SHA 必变
  （证明该 hash 有分辨力）。原断言 hash 的是从未传进被测函数的旁路副本，近乎恒真。

## 8. RG-009 缺 provenance 列故障注入复跑

```
$ npx tsx <构造 F190 旧 schema 库，built_at 故意设为 1 天前>
legacy kb 就绪, built_at=2026-08-01T22:55:43.586Z（1 天前，很新）
$ node dist/cli/index.js scaffold-kb status --vendor-kb <legacy-kb> --format json
exit=0  sha=SAME
{'dbExists': True, 'schemaCompat': 'legacy-missing-provenance', 'freshness': 'unknown',
 'activityAt': None, 'activityAgeDays': None,
 'oldestBuiltAt': '2026-08-01T22:55:43.586Z', 'sourceVersions': ['1.0']}
```

退出码 0、库文件 SHA-256 不变；P-W4 钉死项端到端仍兑现（`built_at` 再新也恒 `unknown`）。
注意 `dbExists` 现在是 `true` —— 这正是 B3-C5 的修复结果（旧库能加载，只是 schema 老）。

## 9. RG-005 自验（Codex 的 parseArgs 对拍法）

收严范围必须严格限于 `STRICT_SCAFFOLD_KB_OPS`。用 **1068 条 argv 组合**（四个既有 op ×
22 个 flag × {缺值 / 6 种取值 / 重复 flag / 重复+走私 / 位置参数 / 未知 flag 夹带} + 组合形态）
做双向对拍：

```
cases=1068
A) batch3-base(bc3bfb5) ↔ HEAD（既有键投影）mismatches=0
B) 批3整改前 ↔ HEAD（全字段严格）      mismatches=0
哨兵1 version 走私串:        pre.ok=true  head.ok=false   （期望 true/false）✓
哨兵2 coverage-gap 重复 flag: pre.ok=true  head.ok=false   （期望 true/false）✓
哨兵3 build 重复 flag（宽松 op）: head.ok=true dir=a       （期望 true/a）  ✓
RG-005 PASS
```

- **A 向**投影掉批 3 新增的 `scaffoldKbPackage` / `scaffoldKbProjectRoot` 两个纯新增键
  （它们对既有 op 也会被填充，但那是批 3 的加字段，不是既有键的行为变化）；投影后零差异，
  与 Codex「既有四 CLI op 零行为变化」的判定一致。
- **B 向**是本轮整改的直接判据：全字段严格对拍零差异 —— 本轮对 `parse-args.ts` 的改动
  对既有四 op **一个字节的输出都没变**。
- 三个哨兵防「零差异是因为收严根本没生效」的假绿。

## 10. RG（其它）

| 项 | 结果 |
|---|---|
| `plugins/spec-driver/scripts/**` 对 `bc3bfb5` 的 diff | **空**（零改动） |
| 是否跑过 `spectra graph` / `spectra batch` | **否**（本仓根禁用，未触发） |
| `_generated` / suggestions 时间戳漂移 | **无**（本轮未执行 `repo:sync`；`git status` 无相关条目） |
| 工作树是否有计划外文件 | **无**（`git status` 逐条核对，全部属本 feature 制品或本轮改动） |

## 11. 整改条目落地状态

| # | 处置落点 | 状态 |
|---|---------|------|
| B3-C1 | pnpm 改**结构化 YAML 解析**（复用仓内 `parseYamlDocument`，**未引入新依赖**）：只认 `packages`/`snapshots` 段的真实映射键；`lockfileVersion` 缺失 / 段落非 mapping / 空文件 / 只有注释 → `parse-error`。yarn 加 `splitYarnBlocks` section 级块结构校验 + `isConcreteVersion` 版本形态校验 | ✅ 已修（+25 红转绿，五类用例齐；四份审查复现输入均已 CLI 端复验） |
| B3-C2 | `ageDaysExact`（浮点）作判级输入，`toDisplayDays` 单独取整；`classify` 签名改收未截断值；`buildKbStatusSubset` 同步 | ✅ 已修（+6 红转绿 + 4 条反向边界断言） |
| B3-C3 | 新增 `flagValueAt(argv, i)` 按**当前索引**取值；`checkScaffoldKbFlags` 用它推进并显式拒绝重复 flag；`readFlagEntry` 改为其薄封装（首次出现语义不变） | ✅ 已修（+7 红转绿 + 1068 条对拍确认既有四 op 零变化） |
| B3-C4 | `KbStatusSubset` 三键改 camelCase；四个测试文件期望同步；`kb-contract.test.ts` 补「子集键不得含下划线」回归钉子 | ✅ 已修（+7 红转绿） |
| B3-C5 | `LoadKbResult` 失败分支**纯附加** `unloadable: SourceKind[]`（既有 `ok`/`code` 语义零变更，RG-005）；`buildKbStatusReport` 增 `opts.dbExists`（缺省退回 `db !== null`）；`runStatus` 传入真实存在性 | ✅ 已修（+4 红转绿）。spec Key Entities #8 外科补一段 `dbExists` 与 `schemaCompat` 的独立性说明（`unreadable` 取值批 3 已在，未重复添加） |
| B3-W1 | `LockfileParseResult.ok` 增 `alternatives: string[]`；顶层 `node_modules/<pkg>` 唯一值直接用，无顶层时收集全部嵌套；resolver 侧不收敛条件改 `distinctLockfiles >= 2 \|\| distinctVersions >= 2`，`multiple-lockfiles` 改按**锁文件数**计 | ✅ 已修（+7 红转绿）。**未新增任何状态**：复用既有 `ambiguous` 五态之一，`VersionFlag` 五值不变 |
| B3-W2 | `parseLockfileVersion(input, io = DEFAULT_LOCKFILE_IO)` 注入缝 + 调用序列断言（超限时 read 次数为 0）；只读 SHA 改为对 CLI 实际读的文件路径做，并加「改一字节必变」的分辨力断言 | ✅ 已修（+5 红转绿）。**偏差说明**：未用 `vi.mock('node:fs')`——该测试文件自身要用真实 `node:fs` 写 fixture，全局 mock 会互相打架；改用显式注入缝，并补一条「不传 `io` 时读真实磁盘 fixture」的用例防止注入缝与生产路径漂移 |
| B3-W3 | tasks.md T061 表述改写为与已记录偏差一致（纯文档） | ✅ 已修 |
| B3-W4 | metrics-raw.md M-2 算术 | 由编排器自行修复，本轮未触碰 |

---

## ⚠️ 计数勘误（verify 阶段 D-1/D-2/D-3 独立复跑发现）

本文件上方记录的测试计数是**批 3 提交前的中途快照**，Codex 整改补测试后未刷新。终态（`27cb5a6`，verify 独立实跑）：

| 项 | 本文件原记 | 终态实测 |
|----|-----------|---------|
| 全量 vitest | 6235 passed | **6293 passed** |
| `tests/kb/` | 38 文件 / 511 | 38 文件 / **569** |
| `cli-scaffold-kb.test.ts` | 26 passed | **37 passed** |

方向安全（少报非多报，全绿）。教训：门禁计数应在该批**最后一次改动之后**采集，中途快照会让后续复核误判为回归。
