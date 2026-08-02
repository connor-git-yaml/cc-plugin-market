# F241 批 3 — 红态证据（TDD 硬序留痕）

基线：`bc3bfb5`（批 2 commit）。批 2 后 `tests/kb/` 基线 = **35 文件 / 415 测试全 pass**。

每个模块的红测试都在实现之前落盘并跑出**非零失败**，下表逐条给出当次实跑输出摘要。

| 任务 | 红测试文件 | 取红命令 | 红态输出（实跑） |
|---|---|---|---|
| T051 | `tests/kb/lockfile-parser.test.ts`（新建） | `npx vitest run tests/kb/lockfile-parser.test.ts` | `Error: Cannot find module '../../src/scaffold-kb/lockfile-parser.js'` → `Test Files 1 failed (1) / Tests no tests` |
| T053 | `tests/kb/version-resolver.test.ts`（新建） | `npx vitest run tests/kb/version-resolver.test.ts` | `Failed to load url ../../src/scaffold-kb/version-resolver.js` → `Test Files 1 failed (1) / Tests no tests` |
| T055 | `tests/kb/kb-status.test.ts`（新建） | `npx vitest run tests/kb/kb-status.test.ts` | `Failed to load url ../../src/scaffold-kb/kb-status.js` → `Test Files 1 failed (1) / Tests no tests` |
| T057 | `tests/kb/cli-scaffold-kb.test.ts`（改，追加） | `npx vitest run tests/kb/cli-scaffold-kb.test.ts` | `Tests 11 failed \| 15 passed (26)`；失败信号为 `parseArgs 应通过: scaffold-kb status --vendor-kb ...: expected false to be true`（union 未扩 → `invalid_subcommand`） |
| T061 | `tests/kb/kb-contract.test.ts`（改，追加） | `npx vitest run tests/kb/kb-contract.test.ts` | `Tests 7 failed \| 6 passed (13)` |
| T062 | `tests/kb/kb-search-tool.test.ts` + `kb-api-lookup-tool.test.ts`（改，追加） | `npx vitest run tests/kb/kb-search-tool.test.ts tests/kb/kb-api-lookup-tool.test.ts` | `Tests 9 failed \| 33 passed (42)` |

## 转绿点

| 任务 | 转绿命令 | 绿态输出 |
|---|---|---|
| T052 | `npx vitest run tests/kb/lockfile-parser.test.ts` | `24 passed (24)` |
| T054 | `npx vitest run tests/kb/version-resolver.test.ts` | `18 passed (18)` |
| T056 | `npx vitest run tests/kb/kb-status.test.ts` | `22 passed (22)` |
| T058+T059 | `npx vitest run tests/kb/cli-scaffold-kb.test.ts` | `26 passed (26)` |
| T063+T064 | `npx vitest run tests/kb/kb-contract.test.ts tests/kb/kb-search-tool.test.ts tests/kb/kb-api-lookup-tool.test.ts` | `55 passed (55)` |

## T061 的一处**必要偏差**（RG-005 判读，须显式记录）

`tests/kb/kb-contract.test.ts:43-45` 的既有断言是 **exact key-set 相等**：

```ts
expect(Object.keys(out).sort()).toEqual(
  ['query_echoed', 'results', 'sources_queried', 'total_found', 'truncated'].sort(),
);
```

FR-021 要求 `kb_status` 作为**新增顶层字段**进入 `kb_search` 成功 payload，因此这条断言
**结构性地必然要改**——plan §4 写的「`kb-contract.test.ts` 的既有快照断言因此天然不受影响」
**与事实不符**（详见交付报告的缺陷上报）。

处置：把 `'kb_status'` 加进期望集，**保持 exact 相等**（**没有**换成 `arrayContaining` /
`objectContaining` 之类的超集匹配）。判据：

- 改后断言强度**不降**——多一个字段或少一个字段仍然会红；
- 既有 5 个 key 一个不少、名称/类型/层级零变更；
- 另**追加**一条独立断言 `既有字段名称/类型/层级零变更`：把 `kb_status` 从 payload 剥掉之后，
  剩余 key 集合与接线前的 5 项**逐字段**相等，且 `total_found`/`results`/`truncated`/
  `query_echoed`/`sources_queried` 的类型与取值逐一断言。

也就是说：唯一被修改的既有断言是「加了一个新字段名到 exact 集合」，且同时补了一条更严的
反向断言把"既有部分未变"单独钉住。除此之外 `kb-contract.test.ts` 的既有断言**零改动**。

> B3-W3 已把 tasks.md T061 的表述改写为与本节一致（原文「不修改任何既有断言期望值」与事实不符）。

---

# 第二节：批 3 Codex 对抗审查整改（B3-C1 ~ B3-W3）的红态证据

> 审查会话：codex `task-msccuu9b-5bu75q`（5 CRITICAL / 4 WARNING，结论「阻断提交」）。
> 整改遵循同一硬序：**先落红测试 → 跑出非零失败 → 再改实现 → 复跑转绿**。

## 1. 模块层红态（一次跑批，35 条同时红）

```
$ npx vitest run tests/kb/lockfile-parser.test.ts tests/kb/version-resolver.test.ts tests/kb/kb-status.test.ts
Test Files  3 failed (3)
      Tests  35 failed | 76 passed (111)
```

失败按整改条目归组（逐条为审查原文给出的复现输入）：

| 条目 | 红测试（新增 describe） | 红态失败信号（实跑摘录） |
|---|---|---|
| B3-C1 pnpm | `lockfile-parser — pnpm 结构化 YAML 解析（B3-C1）` | 锚点 `/echarts@5.4.3: &e` → `expected { ok: false, reason: 'package-not-found' } to match { ok: true, version: '5.4.3' }`；block scalar 伪键 `echarts@9.9.9` → `expected false to be true`（被误采信）；空文件 / 只有注释 / 缺 `lockfileVersion` / `packages` 非 mapping → `expected 'package-not-found' to be 'parse-error'` |
| B3-C1 yarn | `lockfile-parser — yarn 结构校验（B3-C1）` | `version [unterminated` → `expected true to be false`（被当成功版本 `[unterminated`）；`version "latest"` 同；空文件 / 只有注释头 / 顶格垃圾行 → `expected 'package-not-found' to be 'parse-error'` |
| B3-W1 | `lockfile-parser — package-lock 嵌套安装位置歧义（B3-W1）` | `r.alternatives` 未定义 → `expected undefined to deeply equal []` |
| B3-W1（传导） | `version-resolver — 单 lockfile 内嵌套安装位置歧义（B3-W1）` | `expected { status: 'lockfile', version: '5.4.3' } to deeply equal { status: 'ambiguous', version: null }`（静默取了遍历首项） |
| B3-C1（传导） | `version-resolver — 损坏 lockfile 与「包不在锁里」不同流（B3-C1）` | 空 pnpm-lock → `expected [] to deeply equal [ObjectContaining{ detail: StringContaining "parse-error" }]`；损坏 yarn → `expected [ '[unterminated' ] to not include '[unterminated'` |
| B3-C2 | `kb-status — 阈值判级不先截断（B3-C2）` | 30.5 天 → `expected 'current' to be 'aging'`；90.5 天 → `expected 'aging' to be 'stale'`（先 `Math.floor` 再比阈值，两个边界各错一档） |
| B3-C4 | `kb-status — MCP 子集聚合（FR-021）`（既有 6 条改期望） | `expected { activity_age_days: 2, source_versions: [...] } to deeply equal { activityAgeDays: 2, sourceVersions: [...] }` |
| B3-C5 | `kb-status — 存在性与可加载性是两个独立信号（B3-C5）` | `buildKbStatusReport(null, { dbExists: true })` → `expected false to be true`（签名尚无该入参） |
| B3-W2 | `lockfile-parser — 先 stat 后 read 的调用序列（B3-W2 / EC-28）` | 注入 IO 未被采纳 → `expected [] to deeply equal [ 'stat:/virtual/...' ]` |

## 2. CLI 层红态（单独取红，5 条）

模块层修完后，把 CLI 侧两处修复**临时逆向撤销**（`checkScaffoldKbFlags` 退回 `indexOf`、
`runStatus` 不传 `dbExists`）再跑，确认这 5 条确实由该修复负责、不是被别处顺带带绿的：

```
$ npx vitest run tests/kb/cli-scaffold-kb.test.ts        # 仅撤销 B3-C3 / B3-C5 两处修复
FAIL  parseArgs — 严格 op 的重复 flag 走私（B3-C3） > Codex 实测复现串：`--package typescript --package --evil --format json` 必须被拒
FAIL  parseArgs — 严格 op 的重复 flag 走私（B3-C3） > 重复 flag 本身即被拒（即便两次都带合法值）
FAIL  parseArgs — 严格 op 的重复 flag 走私（B3-C3） > 第二次出现缺值也不得靠首次出现「借」到值
FAIL  parseArgs — 严格 op 的重复 flag 走私（B3-C3） > 未知 flag 藏在重复 flag 之后仍被抓到（走私路径整体封死）
FAIL  parse → runScaffoldKb 全链 > status：库文件在但打不开（损坏）→ dbExists **true** + schemaCompat unreadable（B3-C5）
      Tests  5 failed | 32 passed (37)
```

## 3. 转绿点

| 条目 | 转绿命令 | 绿态输出 |
|---|---|---|
| B3-C1 / B3-W1 / B3-W2 | `npx vitest run tests/kb/lockfile-parser.test.ts` | `49 passed (49)`（整改前 24） |
| B3-W1 / B3-C1 传导 | `npx vitest run tests/kb/version-resolver.test.ts` | `26 passed (26)`（整改前 18） |
| B3-C2 / B3-C4 / B3-C5 | `npx vitest run tests/kb/kb-status.test.ts` | `36 passed (36)`（整改前 22） |
| B3-C3 / B3-C5 / B3-W2 | `npx vitest run tests/kb/cli-scaffold-kb.test.ts` | `37 passed (37)`（整改前 26） |
| B3-C4（契约面） | `npx vitest run tests/kb/kb-contract.test.ts tests/kb/kb-search-tool.test.ts tests/kb/kb-api-lookup-tool.test.ts` | `55 passed (55)` |
| 全套件 | `npx vitest run tests/kb/` | `38 文件 / 569 passed`（整改前 511，**+58**） |

## 4. 防假绿的反向断言（每条整改都配一条"改坏了会红"的哨兵）

| 条目 | 反向哨兵 |
|---|---|
| B3-C1 pnpm | 同一份带 block scalar 伪键的文件里，**真实结构位置**的 `vue@3.4.21` 仍必须读得到——排除"整个文件读不了"糊过去 |
| B3-C1 yarn | 合法 berry lockfile（`__metadata` 块 + 嵌套 `dependencies`）+ 预发布版本 `5.4.3-beta.1+build.7` 必须仍解析成功——结构校验不得误伤 |
| B3-C1 区分度 | 「包确实不在合法 pnpm-lock 里」必须落 `package-not-found` 且 `candidates` 为空——证明 `parse-error` 不是无差别兜底 |
| B3-C2 | 反向四组 `30 / 29.99 / 90 / 89.99` 天必须仍是 `current / current / aging / aging`——边界是「超过」不是「达到」，不得反向误伤 |
| B3-C3 | 既有四 op（build/serve/query/ingest）重复 flag 仍取首次出现且不报错；未知 flag 与缺值仍放行（RG-005） |
| B3-C5 | 不传 `dbExists` 时沿用旧默认 `db !== null`；「目录里没有 `chunks.sqlite`」仍是 `dbExists: false`，与损坏态可区分 |
| B3-W1 | 嵌套版本**一致**时仍收敛为 `lockfile` 单值（不因"键有多个"就装作不知道）；顶层安装位置存在时直接采用 |
| B3-W2 | 默认 IO 走真实 `node:fs` 的用例（不传 `io` 读磁盘 fixture）——注入缝不得与生产路径漂移 |
| B3-W2（只读） | SHA 断言后**主动改一个字节**并断言 SHA 必变——证明该 hash 有分辨力，"前后相同"不是恒真 |
