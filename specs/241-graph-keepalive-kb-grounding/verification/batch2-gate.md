# F241 批 2 门禁（T049）执行记录

基线锚点 `batch2 = fd9af7f`（`git rev-parse HEAD`，trace.md `[04:04:18]` 行）。
以下命令全部在 worktree `modest-ellis-e4f0fe` 内实跑，输出为原样摘录。

---

## 1. 测试套件

| 命令 | 结果 |
|------|------|
| `npx vitest run tests/kb/` | **35 files / 368 tests passed**（基线 32/293 → 净增 3 文件 / 75 用例） |
| `npx vitest run tests/kb/cli-scaffold-kb.test.ts`（T-C5 点名重跑） | **10 passed**（批 2 前为 6） |
| `node --test plugins/spec-driver/tests/ensure-gitignore.test.mjs`（T-C5 批 2 重跑） | **tests 22 / pass 22 / fail 0** |

```
$ npx vitest run tests/kb/
 Test Files  35 passed (35)
      Tests  368 passed (368)
   Duration  913ms
```

```
$ node --test plugins/spec-driver/tests/ensure-gitignore.test.mjs
▶ F241 FR-024 / SC-020 新增数据路径双段 check-ignore
  ✔ 第一段：本开发仓库内直查，路径确被忽略
  ✔ 第二段：插件拷入临时全新 git repo，跑自举脚本后路径确被忽略
  ✔ 自举清单与开发仓库根 .gitignore 两处内容一致
ℹ tests 22 / pass 22 / fail 0
```

关于「6 条断言」：批 1 的 T026 已把该文件的断言口径从写死数字改为**从条目表长派生**
（`ENTRY_COUNT = EXPECTED_ENTRIES.length`），批 2 沿用该口径，把 `.specify/kb-nohit/`
加入 `EXPECTED_ENTRIES`（现 6 条固定条目）与双段探测路径表 `F241_DATA_PATHS`（现 2 条路径）。
没有在注释里写死"6"，避免下一次扩充又要逐处改数字。

## 2. 构建与仓库校验

| 命令 | 结果 |
|------|------|
| `npm run build` | 退出码 0，`tsc` 零错误（`[postbuild:stamp] 盖章: commit=fd9af7f3 (dirty)`） |
| `npm run repo:check` | **EXIT=0**，86 项全 pass，0 fail / 0 warn |

repo:check 中与本批直接相关的族：`graph-quality:*` 六项全 pass（含 `freshness: pass`）、
`spec-drift:anchors-status: pass`、`worktree-local-state:*` 四项 pass。

## 3. RG 抽查（对 `git diff fd9af7f -- <paths>`）

### RG-005 — `kb-contract.test.ts` 既有断言未被放宽

```
$ git diff fd9af7f -- tests/kb/kb-contract.test.ts | wc -l
0
```

**0 行改动**，因此不存在"放宽"的可能。人工复核了本批对 `kb-contract.test.ts` 依赖的
上游改动是否会间接放宽它：唯一相关改动是给 `KbHandle` 增加**必填** `dbPath: string`
（新增字段，非放宽），且 `kb-contract.test.ts` 经 `loadKbContext` 构造 ctx、不写 handle 字面量，
契约断言集合完全未动。

其余 3 个既有 kb 测试文件的改动均为**纯追加**：

| 文件 | 改动性质 |
|------|----------|
| `tests/kb/kb-search-tool.test.ts` | 追加 spy mock + 3 条挂点用例；既有 12 条一字未改 |
| `tests/kb/kb-api-lookup-tool.test.ts` | 追加 spy mock + 5 条挂点用例；`handle()` fixture 加 `dbPath` 字段（KbHandle 新必填字段，非断言放宽） |
| `tests/kb/scaffold-kb-query.test.ts` | 追加 spy mock + 3 条挂点用例；既有 5 条一字未改 |
| `tests/kb/cli-scaffold-kb.test.ts` | 追加 3 条 parse 用例 + 1 个 dispatch describe（2 条）；既有 4 条一字未改 |

### RG-009 — 治理层故障不改变主链路（T-C5 扩展：只读 + 缺列两类）

探针做法：同一个 `KbContext` 上跑「零命中查询 + 有命中查询」各一次，把两次
`executeKbSearch` 的完整返回体拼成一个 JSON 做 **SHA-256 逐字节比对**，
并劫持 `process.stdout/stderr.write` 收集治理层是否漏出任何噪声。

```
| 场景 | results SHA-256 | 与基线逐字节相同 | stdout/stderr 噪声 |
|------|-----------------|------------------|--------------------|
| baseline / 采集关闭 | bd15e12844dedab1… | ✅ 是 | (空) |
| 故障 A / no-hit 目录只读 (0o555) | bd15e12844dedab1… | ✅ 是 | (空) |
| 故障 B / 既有记录缺列损坏 + 清理目标是目录（unlink 必失败） | bd15e12844dedab1… | ✅ 是 | (空) |
| 故障 C / env 指向被普通文件占位的路径 | bd15e12844dedab1… | ✅ 是 | (空) |

RG-009 判定: results 全一致=true / 治理层零输出=true
PROBE_EXIT=0
```

四个场景 SHA-256 完全相同；探针进程退出码 0；`executeKbSearch` 返回体中 `isError`
始终 undefined。探针脚本为一次性产物，跑完即删（不入库、不留在工作树）。

**「缺列」的口径说明（如实标注）**：批 2 的治理层不读写任何数据库列，只写 JSONL。
故把 T049 的「缺列」映射为**最贴近的同类故障**——目录内既有记录缺字段 / 类型不符 /
整行损坏（故障 B 的前半），并额外叠加一个"清理目标是目录、`unlinkSync` 必然失败"的
写入期故障（故障 B 的后半）。DB 侧真正的缺列（`PRAGMA table_info` 无 provenance 列）
属 EC-17 / FR-020，是**批 3** 的判据，不在本批范围内。

## 4. continuous capture 台账同步检查

```
$ git diff fd9af7f -- .../pilot/ledger.jsonl | grep -c '^+{'        → 5
$ git diff fd9af7f -- .../pilot/mcp-call-log.md | grep -cE '^\+\| 1-1[1-9]' → 5
```

条目数一致（各 5 条：`1-11` … `1-15`）。seq 单调性校验：

```
['0-1','0-2','0-3','1-1'…'1-10','1-11','1-12','1-13','1-14','1-15']
monotonic: True
```

## 5. 门禁结论

**PASS**。测试 / 构建 / repo:check / RG-005 / RG-009 / 台账同步六项全部满足，
无降级项、无 `[E2E_DEFERRED]`。

---

# 整改后复跑（M-3 双组对抗审查 B2-1 ~ B2-9 全部落地）

M-3 A/B 两组均判阻断（9 条真 finding / 0 误报），批 2 首轮门禁作废。
以下为按 `review-dispositions.md`「Implement 批 2 — M-3 双组对抗审查整改单」
逐条修复后的**整改后门禁全表**。红态逐条证据见 `batch2-red-evidence.md` 第二节。

## 1. 测试与构建（全部在 worktree `modest-ellis-e4f0fe` 内实跑）

| # | 命令 | 结果 | 与门禁要求对照 |
|---|------|------|----------------|
| 1 | `npx vitest run tests/kb/` | **35 files / 415 tests passed**，EXIT=0 | ≥ 批 2 门禁记录的 368 ✅（净增 47） |
| 2 | `npx vitest run`（全量） | **493 passed / 4 skipped (497 files)；6139 passed / 18 skipped / 21 todo (6178)**，EXIT=0 | 基线 490 文件 / 6017 用例 → 全绿且更多 ✅ |
| 3 | `node --test plugins/spec-driver/tests/*.mjs` | **tests 1272 / pass 1272 / fail 0 / skipped 0**，EXIT=0 | 与 1272 基线逐数相同（本批未动插件侧）✅ |
| 4 | `npm run build` | EXIT=0，`tsc` 零错误（`[postbuild:stamp] 盖章: commit=fd9af7f3 (dirty)`） | 零错误 ✅ |
| 5 | `npx tsc --noEmit -p tsconfig.json` | EXIT=0 | 类型零错误 ✅ |
| 6 | `npm run repo:check` | **EXIT=0**，86 项 pass / 0 fail / 0 warn | exit 0 ✅ |

```
$ npx vitest run tests/kb/
 Test Files  35 passed (35)
      Tests  415 passed (415)

$ npx vitest run
 Test Files  493 passed | 4 skipped (497)
      Tests  6139 passed | 18 skipped | 21 todo (6178)

$ node --test plugins/spec-driver/tests/*.mjs
ℹ tests 1272
ℹ pass 1272
ℹ fail 0

$ npm run repo:check   → EXIT=0（86 pass / 0 fail / 0 warn）
```

`repo:check` 中与本批相关的族全 pass：`graph-quality:*` 六项（含 `freshness`）、
`spec-drift:anchors-status`、`worktree-local-state:*` 四项、`model-literal-gate`。

## 2. RG 复核（对 batch2-base `fd9af7f`）

### RG-005 — `kb-contract.test.ts` 零 diff

```
$ git diff fd9af7f -- tests/kb/kb-contract.test.ts | wc -l
0
```

整改轮同样 **0 行改动**。整改引入的两处对既有测试的改写都不在该文件，且都是
**收紧或按新契约更新**，不是放宽：

| 文件 | 改写 | 性质 |
|------|------|------|
| `kb-search-tool.test.ts` / `kb-api-lookup-tool.test.ts` / `scaffold-kb-query.test.ts` | `dbPath` 断言由 `typeof === 'string'` 改为 `typeof === 'function'` + 调用后比对路径值 | 按 B2-9 新契约更新；断言强度不降（仍校验最终路径值） |
| `cli-scaffold-kb.test.ts` | `coverage-gap --dry-run` 用例改为 `coverage-gap`（`--dry-run` 已被 B2-4 allowlist 拒绝） | 该 flag 对 coverage-gap 本就无语义；同批新增「未知 flag → invalid_option」把它转为**拒绝**断言 |

### RG-005 专项 — 既有 op 行为未被 B2-4 收严波及

B2-4 的收严只作用于 `STRICT_SCAFFOLD_KB_OPS = { 'coverage-gap' }`。新增一条反向守卫用例
（`既有 op（build/serve/query/ingest）行为未被收严波及`）对四个既有 op 各跑一条
含未知 flag / 缺值 flag 的命令行，断言仍 `ok: true`：

```
scaffold-kb build  --dir docs --unknown-legacy-flag              → ok
scaffold-kb query  --requirement x --vendor-kb /p/kb --format    → ok（--format 缺值仍静默回落）
scaffold-kb serve  --vendor-kb /p/kb --whatever                  → ok
scaffold-kb ingest --url https://x/y --bogus                     → ok
```

### RG-009 — 治理层故障不改变主链路（整改后重测）

首轮的四场景 SHA-256 逐字节比对结论不变；整改额外新增两类故障面并全部通过：

| 场景 | 判据 | 结果 |
|------|------|------|
| daily 名被 FIFO 占位 | 子进程 + 5s watchdog，是否返回 | `VERDICT=RETURNED exit=0`（回退态为 `HUNG`）|
| daily 名是指向目录外文件的 symlink | 目标文件字节数 | `outsideFileBytes=0 escaped=false`（回退态 `207 / true`）|
| `dbPath` getter 抛错 + 采集关闭 | 三挂点查询是否正常返回 | 三挂点均正常返回，零抛出 |
| `tool` 非法 / `rawQuery` 非 string | 目录内是否产生文件 | 零 append |

### RG（改动面）— `plugins/**` 与 `pilot/**` 之外无意外改动

```
$ git status --short
 M .gitignore
 M plugins/spec-driver/scripts/lib/ensure-gitignore.sh      ← 批 2 首轮既有改动，整改轮未再触碰
 M plugins/spec-driver/tests/ensure-gitignore.test.mjs      ← 同上
 M specs/241-graph-keepalive-kb-grounding/{spec,tasks,trace,review-dispositions}.md
 M specs/241-graph-keepalive-kb-grounding/pilot/{ledger.jsonl,mcp-call-log.md}
 M src/cli/{index.ts,commands/scaffold-kb.ts,utils/parse-args.ts}
 M src/kb-mcp/{lib/kb-locator.ts,tools/kb-api-lookup.ts,tools/kb-search.ts}
 A src/scaffold-kb/{coverage-gap,governance-constants,nohit-recorder,query-redaction}.ts
 M src/scaffold-kb/tokenizer.ts
 M tests/kb/{cli-scaffold-kb,kb-api-lookup-tool,kb-search-tool,scaffold-kb-query}.test.ts
 A tests/kb/{coverage-gap,nohit-recorder,query-redaction}.test.ts
?? specs/241-graph-keepalive-kb-grounding/pilot/m3/
?? specs/241-graph-keepalive-kb-grounding/verification/batch2-{gate,red-evidence}.md
```

整改轮对 `plugins/spec-driver/scripts/**` **零改动**（该目录下的两处 diff 属批 2 首轮
`.specify/kb-nohit/` 清单落地，本轮未再触碰）。`src/scaffold-kb/tokenizer.ts` 是本轮
**新增**的改动面（B2-1 要求归一化单点化）——它是 F190 既有模块，改动为**纯提取重构**：
把 `.normalize('NFKC')` 抽成导出的 `normalizeUnicode`，`tokenize` 行为逐字不变，
另加一个**新增**函数 `normalizeForEquivalence`。用 Spectra `impact` 核对上游面
（`directCallers:4 / transitive:7`，含 `buildChunksDbBytes` 写入链与 `searchKbCore`
检索链），这些消费方全部被全量 6139 用例覆盖且零失败。

### repo:sync 时间戳漂移

本轮未跑 `npm run repo:sync`（无 source-of-truth / wrapper / 生成产物改动），
故无 `specs/products/_generated/**` 与 `.specify/project-context.suggestions.*` 漂移。

## 3. continuous capture 台账同步检查（T-C4）

```
$ node specs/241-graph-keepalive-kb-grounding/pilot/ledger-schema-check.mjs
ledger schema 校验通过：23 行，predicted-impact-set.md 存在   （EXIT=0）
```

本轮新增 1 次 MCP 调用（`1-20`，`impact` on `tokenizer.ts::tokenize`），已当下双写
`pilot/ledger.jsonl` 与 `pilot/mcp-call-log.md`，`seq` 单调（… 1-19 → 1-20）。

## 4. 整改后门禁结论

**PASS**。9 条 finding 全部落地（B2-5 按裁决为 spec 收窄 + 护栏，非行为变更），
六项收尾命令全绿，无降级项、无 `[E2E_DEFERRED]`。

**如实标注的两处与整改单的偏差**（详见 `batch2-red-evidence.md`）：

1. **B2-2 打开标志位是整改单的超集**：额外加了 `O_NONBLOCK`。整改单给的
   `O_APPEND|O_CREAT|O_WRONLY|O_NOFOLLOW` 实测挡不住 FIFO——打开无 reader 的 FIFO
   会阻塞在 `openSync` 本身，`fstatSync(fd).isFile()` 那行根本执行不到。
   `O_NONBLOCK` 是该处置能被执行到的前提，POSIX 规定其对常规文件的写无副作用。
2. **B2-7 第三挂点负例回退态即绿**：`scaffold-kb query` 的「零可用源」在结构上不可达
   （`loadKbContext` 零 handle 时返回 `KB_NOT_FOUND` 提前返回，到不了挂点）。
   该挂点的前置条件表达的是不变量而非修复，用例保留作回归护栏。
