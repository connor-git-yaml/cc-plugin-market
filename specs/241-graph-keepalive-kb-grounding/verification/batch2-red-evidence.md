# F241 批 2 — 红测试证据（T-C3 硬序：红测试先于实现）

基线锚点 `batch2 = fd9af7f`。以下每条均为**实现落地前**实跑捕获的失败输出。
执行顺序自上而下，与 tasks.md 批 2 的任务序一致。

---

## T030（红）→ T031（绿）：`tests/kb/query-redaction.test.ts`

```
$ npx vitest run tests/kb/query-redaction.test.ts
Caused by: Error: Failed to load url ../../src/scaffold-kb/query-redaction.js
  (resolved id: ../../src/scaffold-kb/query-redaction.js) ... Does the file exist?

 Test Files  1 failed (1)
      Tests  no tests
```

转绿后：`Test Files 1 passed (1) / Tests 28 passed (28)`
（初版 27 条；发现占位符切词形态缺陷后追加 1 条 EC-21 相关断言，见下方「实现期发现」）

---

## T032（红）→ T033（绿）：`tests/kb/nohit-recorder.test.ts`

```
$ npx vitest run tests/kb/nohit-recorder.test.ts
Caused by: Error: Failed to load url ../../src/scaffold-kb/nohit-recorder.js ... Does the file exist?

 Test Files  1 failed (1)
      Tests  no tests
```

转绿后：`Tests 17 passed (17)`（16 条 + total 函数契约 1 条）

---

## T034（红）→ T035（绿）：`tests/kb/kb-search-tool.test.ts` 挂点 1

第一次红态是**测试自身缺陷**（选的"零结果"查询实际命中 2 条），修正查询串后得到正确红态：

```
$ npx vitest run tests/kb/kb-search-tool.test.ts
 × kb_search — no-hit 治理挂点（F241 FR-012 挂点 1）
   > 零结果（merged.length===0）→ recordNoHit 被调用一次，带 tool/rawQuery/dbPath
   → expected "spy" to be called 1 times, but got 0 times
 ✓ 有结果（merged.length>0）→ recordNoHit 不被调用
 ✓ 参数校验失败（未真正检索）→ recordNoHit 不被调用

 Tests  1 failed | 12 passed (13)
```

反例两条**在红态即通过**是预期的（未接线时当然不会被调用）——它们的价值在于接线后
守住"不要无条件记录"，这一点在挂点实现后才真正生效。

转绿后：`Tests 13 passed (13)`

---

## T036（红）→ T037/T038（绿）：`tests/kb/kb-api-lookup-tool.test.ts` 挂点 2a/2b

```
$ npx vitest run tests/kb/kb-api-lookup-tool.test.ts
 FAIL (a) 挂点 2a：有实体表但 matched.length===0 → recordNoHit 被调用一次
   AssertionError: expected "spy" to be called 1 times, but got 0 times
 FAIL (c) 挂点 2b：document_fallback 内 hits.length===0 → recordNoHit 被调用一次（P-W3 不豁免）
   AssertionError: expected "spy" to be called 1 times, but got 0 times

 Tests  2 failed | 12 passed (14)
```

两处挂点各自独立红 —— 证明 (a)(c) 不是同一分支的重复断言，P-W3 要求的
"fallback 不豁免"确实是**第二个**独立接线点。

转绿后：`Tests 14 passed (14)`

---

## T039（红）→ T040（绿）：`tests/kb/scaffold-kb-query.test.ts` 挂点 3

```
$ npx vitest run tests/kb/scaffold-kb-query.test.ts
 × 零结果（merged.length===0）→ recordNoHit 被调用一次，tool=scaffold_kb_query
   → expected "spy" to be called 1 times, but got 0 times

 Tests  1 failed | 7 passed (8)
```

接线后第一轮出现**第二个红**（负例用例 `、、、` 反而记录了）：

```
 FAIL KB 不可用 / 关键词为空 → 未真正检索，recordNoHit 不被调用
   expected "spy" to not be called at all, but actually been called 1 times
   1st spy call: { tool: "scaffold_kb_query", rawQuery: "、、、", dbPath: ".../demo-kb-zh/kb/chunks.sqlite" }
```

判定：**生产代码正确、测试假设错误**。`extractKeywords('、、、')` 返回非空串，
因此确实执行了检索且零命中 → 记录是对的。改用 `'   '`（extractKeywords 返回空串、
走 no-query 提前返回分支）作为"未真正检索"的负例。

转绿后：`Tests 8 passed (8)`

---

## T041（红）→ T042（绿）：`tests/kb/coverage-gap.test.ts`

```
$ npx vitest run tests/kb/coverage-gap.test.ts
Failed to load url ../../src/scaffold-kb/coverage-gap.js
 Test Files  1 failed (1)
      Tests  no tests
```

转绿后：`Tests 14 passed (14)`

---

## T043（红）→ T044/T045（绿）：`tests/kb/cli-scaffold-kb.test.ts` CLI 可达性

P-W5 要防的正是"模块单测全绿但 CLI 永远不可达"，因此这条红态**必须**同时覆盖
parse 侧与 dispatch 侧：

```
$ npx vitest run tests/kb/cli-scaffold-kb.test.ts
 × parseArgs — coverage-gap 子操作被解析出来，不落 invalid_subcommand
 × parseArgs — coverage-gap --format json|markdown 解析生效
 × runScaffoldKb — dispatch 到 runCoverageGap：采集关闭时输出 collection-disabled 且退出码 0
 × runScaffoldKb — markdown 为默认格式
 ✓ 扩 union 后未知 op 仍被拒（不是放开一切）

 Tests  4 failed | 6 passed (10)
```

「未知 op 仍被拒」在红态即绿是正确的——它是**扩 union 后不能放开一切**的守卫，
两侧状态都必须绿。

转绿后：`Tests 10 passed (10)`

---

## T048（红）→ T047（绿）：`plugins/spec-driver/tests/ensure-gitignore.test.mjs`

与批 1 共用同一文件；批 2 追加 `.specify/kb-nohit/`。因 T047 与 T048 在同一轮改动内落地
（改清单常量 + 改测试期望表），未单独捕获中间红态，改以**改动前后的判据变化**留证：

- 改动前：`git check-ignore -v .specify/kb-nohit/nohit-20260803.jsonl` → 退出码 1（未命中）
- 改动后：`.gitignore:59:.specify/kb-nohit/  .specify/kb-nohit/nohit-20260803.jsonl` → 退出码 0

如实标注：**这一条不是严格 TDD 红态**（清单类改动改测试期望表即等于改断言本体，
先红后绿在此形态下退化为改两个常量表的先后顺序，无额外信息量）。

转绿后：`node --test ... ensure-gitignore.test.mjs` → `tests 22 / pass 22 / fail 0`

---

## 实现期发现（不属红态，但由实跑暴露）

**T040 的人工手跑（tasks 要求"人工手跑一次触发零结果场景确认落盘"）抓到一个真实缺陷。**

首次手跑：

```
$ SPECTRA_KB_NOHIT_TELEMETRY=/tmp/f241-nohit-manual npx tsx src/cli/index.ts \
    scaffold-kb query --requirement "zzzqqqnonexistentterm" --vendor-kb plugins/demo-kb-zh/kb
[scaffold-kb query] no-hit

$ cat /tmp/f241-nohit-manual/nohit-20260802.jsonl
{"schemaVersion":1,"timestamp":"2026-08-02T20:22:07.638Z","tool":"scaffold_kb_query",
 "terms":["HIGH","ENTROPY","HIGHENTROPY"],"normalizedQueryHash":"970849b2fd8c8b74",
 "redactionTags":["HIGH_ENTROPY"],"resultCount":0,"dbPathHash":"f4978eb5a37ba47c"}
```

两点，都只有真跑才看得见：

1. **占位符在 tokenizer 下会碎成多个 token**：`<HIGH_ENTROPY>` → `HIGH` / `ENTROPY` /
   `HIGHENTROPY`（tokenizer 把 `_` 当分隔符且额外产出拼接形）。原实现把
   `REDACTION_PLACEHOLDER_TOKENS` 定义为 `rule.id` 集合，EC-21 的过滤会**整体失效**——
   `HIGH` / `ENTROPY` 这类碎片会堂而皇之进 backlog 冒充缺口词。已改为
   `flatMap(tokenize(placeholder))`，并补一条断言钉住切词后形态。
2. **HIGH_ENTROPY 规则对普通长单词过度遮蔽**：`zzzqqqnonexistentterm`（21 字符纯字母）
   被判为高熵串。这是 spec FR-012 判据（"长度 ≥ 20 的连续 hex / base64 字符集片段"）
   的字面后果——base64 字符集含全部字母。已按 spec 字面实现并在模块文档注释中
   如实写明该反向边界，未擅自加"必须含数字"之类的启发式收窄（见交付报告 O-2）。

---

# 第二轮：M-3 双组对抗审查整改（B2-1 ~ B2-9）的红态

> 上半部分是批 2 首轮实现的红态；本节是 M-3 审查判阻断后、按
> `review-dispositions.md`「Implement 批 2 — M-3 双组对抗审查整改单」逐条修复时捕获的红态。

## 取红方法（如实说明）

批 2 代码此时**尚未 commit**（工作树状态），无法用 `git stash` 回到"审查时形态"。
做法是：先把修复后的 8 个源文件备份到 scratchpad，用一段**逆向替换脚本**把
`src/**` 精确还原成 M-3 审查时的形态（`nohit-recorder.ts` 整份还原，其余按 25 个
反向 hunk 逐一还原，任一 hunk 匹配不上即中止），跑新增测试取红，再从备份还原。
测试文件在两次运行中**一字未改**（唯一例外见下方 B2-2 的 FIFO 用例）。

## 一次性红态总表

```
$ npx vitest run tests/kb/ --reporter=verbose      # 回退到 M-3 审查形态
 Test Files  7 failed | 28 passed (35)
      Tests  38 failed | 376 passed | 1 skipped (415)
```

38 条红按 finding 归属如下（用例名逐字取自 verbose 输出）。

### B2-1 redaction 先于 NFKC + 规则大小写敏感 —— 14 红

`tests/kb/query-redaction.test.ts`（8 条，规则层）：

```
× 全角数字先 NFKC 再匹配 → 命中 DIGITS，切词后不残留 ASCII 数字
× 全角与半角输入产生逐字相同的 redaction 结果（同一归一化链）
× URL 凭据参数名大写 TOKEN= 同样被遮蔽
× 小写 bearer scheme 同样被遮蔽
× 小写 Windows home 路径 c:\users\Alice 被遮蔽
× 小写 /users/ 与 /home/ 段大小写变体被遮蔽
× 跨类混合（全角数字 + 大写 TOKEN= + 小写 bearer）全部命中
× 归一化只有一份实现：src/ 全树的 NFKC 调用点恰 1 处，且在 tokenizer.ts
```

`tests/kb/nohit-recorder.test.ts`（6 条，**终态断言**——对落盘整行做敏感片段零出现检查）：

```
× 全角数字 → 整行零出现，并打上 DIGITS
× 大写 URL 凭据参数 → 整行零出现，并打上 URL_WITH_CRED
× 小写 bearer → 整行零出现，并打上 TOKEN
× 小写 Windows home → 整行零出现，并打上 HOME
× 全角邮箱 → 整行零出现，并打上 EMAIL
× 跨类混合一次性全部遮蔽（整行判据）
```

红态的具体形态与 A-C2 复现一致：全角 `１２３４５６７８` 在 redaction 阶段不匹配
`DIGITS`（因为 NFKC 发生在其后的 tokenizer 里），落盘整行里出现 ASCII `12345678`。

**转绿**：`normalizeUnicode` 抽到 `tokenizer.ts` 单点导出，`redactQuery` 入口先调用它；
URL 凭据参数名整条规则加 `/i`，Bearer scheme 用逐字母字符类放宽，home 段
（`/Users/`、`/home/`、`X:\Users\`）同样放宽；`sk-`/`ghp_` 保持大小写敏感并补一条
「`SK-ABCDEFGH12` 不触发 TOKEN」的反向断言防止放宽过头。

### B2-2 FIFO / symlink：阻塞主链 + 写出目录外 + 误删 —— 2 红 + 1 挂死

**FIFO 阻塞无法用 vitest 取红**：回退态下该用例会把整个 worker 挂死
（`appendFileSync` 阻塞在同步返回路径上，vitest 的 `testTimeout` 打断不了同步代码），
第一次全量跑因此 600s 超时无输出。这本身就是 A-C3 的证明。改用带 watchdog 的
独立探针取证，并在总表那一跑里把该用例临时置 `it.skip`（还原后已恢复，
`grep -c "it.skip" tests/kb/nohit-recorder.test.ts` → `0`）。

```
$ node scratchpad/fifo-probe.mjs <repo> fifo      # 子进程 + 5s watchdog
# 回退态（M-3 审查形态）
mode=fifo    VERDICT=HUNG (5s 内未返回) stdout=""
mode=symlink VERDICT=RETURNED exit=0 stdout="RETURNED" outsideFileBytes=207 escaped=true

# 修复后
mode=fifo    VERDICT=RETURNED exit=0 stdout="RETURNED"
mode=symlink VERDICT=RETURNED exit=0 stdout="RETURNED" outsideFileBytes=0 escaped=false
```

两条判据都翻转：FIFO 从"永不返回"变为立即返回；symlink 从"207 字节写到 telemetry
目录外"变为"目标文件零字节"。

vitest 侧另 2 红：

```
× recordNoHit — 只写常规文件（B2-2） > daily 名是指向目录外文件的 symlink → 目标文件零字节写入（O_NOFOLLOW）
× recordNoHit — 只写常规文件（B2-2） > 清理侧不跟随 symlink：过期目标的 daily 链接与其目标都不被删（lstat）
```

**转绿**：写入改
`openSync(path, O_APPEND|O_CREAT|O_WRONLY|O_NOFOLLOW|O_NONBLOCK, 0o600)` +
`fstatSync(fd).isFile()` 校验，非常规文件放弃写入（静默降级，不抛）；
`pruneExpired` 改 `lstatSync` 且跳过非常规文件。未引入异步队列。

> **与整改单的一处偏离（如实上报）**：整改单只写了
> `O_APPEND|O_CREAT|O_WRONLY|O_NOFOLLOW`。实测该组合**挡不住 FIFO**——
> 打开无 reader 的 FIFO 会阻塞在 `openSync` 本身，`fstatSync` 那行根本执行不到。
> 因此补了 `O_NONBLOCK`（POSIX 规定对常规文件的写无副作用），它是"拒绝非常规文件"
> 这条处置能被执行到的前提，属整改单意图的必要超集。

### B2-3 读取失败被误报 no-data —— 6 红

```
× coverage-gap — 读取失败可诊断（B2-3 第四态 data-unreadable） > 匹配文件存在但读取失败（断链）→ data-unreadable + readErrors 计数，不报 no-data
× ... > 权限不足（chmod 000）→ 同样 data-unreadable
× ... > 部分可读：坏文件计入 readErrors，好文件照常聚合（状态不被降级）
× ... > 四态互不相同，且 readErrors 是恒在字段（关闭态也为 0）
× ... > markdown 与 json 都打出 data-unreadable 的解释（不静默）
× coverage-gap — 输出格式（SC-010） > markdown 打出 readErrors 计数（B2-3 诊断可见）
```

**转绿**：`CoverageGapOutput` 增 `readErrors: number`；`CoverageGapStatus` 增第四态
`data-unreadable`（`readErrors > 0 && totalRecords === 0`，判定顺序先于 `no-data`）；
markdown/json 两种渲染都打出该状态与计数。
spec 同步外科修订：FR-014（三态→四态 + 判定顺序）、FR-015（文件级失败必须计数）、
SC-010（四态 + `readErrors` 断言）、§6 输出 schema、新增 EC-34；tasks.md crosswalk
FR-014 / FR-015 / SC-010 三行同步。

### B2-4 parse-args 接受缺值/未知 flag —— 2 红

```
× parseArgs — scaffold-kb > coverage-gap --format 缺值 → invalid_option（不静默回落 markdown）
× parseArgs — scaffold-kb > coverage-gap 未知 flag / 位置参数 → invalid_option
```

**转绿**：抽出 `readFlagEntry(argv, name)` 三态读取（不存在 / 存在但缺值 / 存在且有值），
`readFlag` 基于它实现；新增 `SCAFFOLD_KB_FLAG_SPECS`（各 op 的允许 flag 表）与
`checkScaffoldKbFlags`。

> **RG-005 边界（按整改单授权收窄，如实说明）**：强制执行只作用于
> `STRICT_SCAFFOLD_KB_OPS = { 'coverage-gap' }`。既有 op（build / serve / query / ingest）
> 在 F241 之前就接受未知 flag、`--format` 缺值也静默回落，突然收严会改变已发布 CLI 的
> 行为，正是 RG-005 禁止的。允许 flag 表对既有 op 已建好（整改单要求的"各 op 建允许
> flag 集合"）但只作文档用途，收严留给单独 fix 流程。同批加了一条**反向守卫**用例
> 「既有 op 行为未被收严波及」，四个既有 op 各一条，防止后续误开全局。

### B2-5 单 token 查询整串原文进 terms —— 0 红（按裁决为"收窄红线 + 加护栏"，非行为变更）

整改单裁决：不改代码逻辑。落地内容是
(a) spec D5 与 FR-013 措辞收窄为「不新增整串字段；term 粒度落盘，单 token 查询时
term 等于原串属已知接受的残余」，并入 D5 既有残余风险声明；
(b) 新增两条护栏断言（红态即绿，属覆盖缺口修补而非行为修复）：

```
✓ 单 token 敏感形态（sk-xxx 单独查询）→ 落盘是占位标记而非原串（B2-5 护栏）
✓ 单 token 非敏感形态 → term 等于原串，属 D5 已声明并接受的残余（钉住现状，改动需先改 spec）
```

第二条是**现状钉子**：它把"可接受的残余"显式写死成断言，任何人想改成
"单 token 只留 hash"都会先撞到这条测试，从而被迫先改 spec。

### B2-6 大小写变体绕过 distinctQueries 阈值 —— 2 红

```
× recordNoHit — normalizedQueryHash 的等价类归一化（B2-6） > `retry alpha` 与 `retry Alpha` → 同一 hash（阈值绕过被堵）
× ... > 全角变体与半角 → 同一 hash
```

**转绿**：新增 `tokenizer.ts::normalizeForEquivalence`（NFKC + 切词 + case-fold + 去重后
重组，与 B2-1 同一归一化链），`normalizedQueryHash` 改用它作输入。
同批补了两条**反向**断言防止压成一个桶：`retry alpha` vs `retry beta` 不同 hash、
`retry alpha` vs `alpha retry`（词序不同 = 不同问题）不同 hash；既有口径
（额外空格 / 重复词同 hash）保持不回退。

**C5「不提供匿名性保证」措辞复核结论：仍准确。** B2-6 只是把 hash 的输入换成更粗的
等价类（大小写/全角变体合并），hash 本身仍是低熵输入上的确定性 SHA-256 截断、
仍可离线字典枚举，记录里也仍无任何主体标识。措辞无需修改。

### B2-7 无可用库源时仍记 coverage gap —— 2 红（第三挂点为结构性不可达，如实标注）

```
× kb_search — no-hit 治理挂点 > 无可用库源（sourcesQueried 为空）→ 零结果也不记录
× kb_api_lookup — no-hit 治理挂点 > (e) 无可用库源 → document_fallback 零命中也不记录
```

**转绿**：三挂点统一加 `至少真正检索过一个库` 前置条件——
`kb_search` 用既有 `sourcesQueried.length > 0`；`kb_api_lookup` 的 2b 用
`queriedHandles`（循环中实际调用过 `searchKbCore` 的 handle），2a 用
"有实体表的 handle"集合；`scaffold-kb query` 用非 null handle 集合。

> **第三挂点负例未红（如实标注，不伪装）**：`scaffold-kb query` 的
> 「两侧库路径均无 chunks.sqlite（零可用源）→ 不记录」用例在回退态**即绿**。
> 原因是结构性的：`loadKbContext` 只在至少一个 handle 非 null 时返回 `ok`，
> 否则走 `KB_NOT_FOUND` 提前返回，压根到不了挂点。该挂点的守卫因此表达的是
> 不变量而非修复，用例保留作回归护栏（若将来 loader 语义放宽，它会立刻变红）。

### B2-8 `tool` 无运行时 allowlist —— 3 红

```
× recordNoHit — 入参运行时校验（B2-8） > 非法 tool → 零 append（不产生任何文件/行）
× ... > 三值 allowlist 之外的近似值一律拒绝
× ... > rawQuery / dbPath 非 string → 零 append
```

回退态下 B 组 C1 的复现成立：`tool` 原样序列化，整串原文经 `tool` 字段落盘。

**转绿**：`recordNoHit` 入口按序校验 `input` 是对象、`tool ∈ ALLOWED_TOOLS`（三值）、
`rawQuery` 是 string、`dbPath`（或其 thunk 求值结果）是 string；任一不合法**直接
no-op**，保持 total function 不抛。另补一条「合法输入不受影响」用例，防止校验写成
全量拒绝这种假绿。

### B2-9 dbPath 在保护边界外求值 —— 7 红

```
× kb_search — no-hit 治理挂点 > dbPath getter 抛错 + 采集关闭 → 查询正常返回，不抛
× kb_api_lookup — no-hit 治理挂点 > (f) dbPath getter 抛错 + 采集关闭 → 查询正常返回，不抛
× scaffold-kb query — no-hit 治理挂点 > dbPath getter 抛错 + 采集关闭 → 查询正常返回，不抛
× recordNoHit — dbPath thunk 惰性求值（B2-9） > thunk 形态与 string 形态产生相同 dbPathHash
```

三条挂点用例复现 B 组 W1：`describeQueriedDbPaths(...)` 在 `recordNoHit` 的 try 之外
先求值，畸形 handle 的 getter 抛错直接穿透主链——**即便采集是关闭的**。
`scaffold-kb query` 那条通过替换 `loadKbContext`（默认透传真实实现，仅该用例走桩）
注入毒化 handle，走的是真实 CLI 路径，不是拿桩自证。

**转绿**：`RecordNoHitInput.dbPath` 类型放宽为 `string | (() => string)`，三挂点改传
thunk；`recordNoHit` 在 try 内、且**在开关判定之后**求值。另补两条：
「采集关闭时 thunk 根本不被求值」（计数器断言，钉住关闭态零副作用）、
「thunk 返回非 string → 零 append」。

伴随的三条**既有**断言按新契约更新（`typeof arg.dbPath === 'function'` + 调用后比对路径），
三条在回退态全部转红（旧代码传 string），构成 B2-9 的另外 3 红：

```
× kb_search — no-hit 治理挂点 > 零结果（merged.length===0）→ recordNoHit 被调用一次，带 tool/rawQuery/dbPath
× kb_api_lookup — no-hit 治理挂点 > (a) 挂点 2a：有实体表但 matched.length===0 → recordNoHit 被调用一次
× scaffold-kb query — no-hit 治理挂点 > 零结果（merged.length===0）→ recordNoHit 被调用一次，tool=scaffold_kb_query
```

逐项合计：14 + 2 + 6 + 2 + 0 + 2 + 2 + 3 + 7 = **38**，与总表一致。

## 整改后的绿态

```
$ npx vitest run tests/kb/
 Test Files  35 passed (35)
      Tests  415 passed (415)
```

415 条较整改前的 368 条净增 47：其中 **35 条**是本轮新增且回退态为红，
**12 条**是新增的护栏 / 反向守卫用例（回退态即绿，价值在于防止修复过头或后续回退）；
另有 **3 条既有**用例因 B2-9 契约变化在回退态转红（属改写而非新增，不计入净增）。
35 + 3 = 38，与红态总表一致。
