结论：**BLOCKED**。发现 3 条 CRITICAL、4 条 WARNING、1 条 INFO。红线 1、2 可被证伪；红线 3（默认关闭）成立。

已完整读取 1918 行 diff、全部改动后源文件及相关测试；代码/测试文件 blob 与 diff 目标 hash 一致。未修改任何文件，未运行 `spectra graph/batch`。

## CRITICAL

### C1. 单 token 查询会把整串原文逐字写进 `terms`

1. 文件：[src/scaffold-kb/nohit-recorder.ts:88](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/nohit-recorder.ts:88)、[tokenizer.ts:47](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/tokenizer.ts:47)

2. 复现：

```bash
d=$(mktemp -d)
SPECTRA_KB_NOHIT_TELEMETRY="$d" node --import tsx --input-type=module -e \
'import {recordNoHit} from "./src/scaffold-kb/nohit-recorder.ts";
recordNoHit({tool:"kb_search",rawQuery:"ProjectFalcon",dbPath:"/kb/chunks.sqlite"})'
rg -nF '"terms":["ProjectFalcon"]' "$d"/nohit-*.jsonl
```

实际纯内存探针捕获到：

```json
{"terms":["ProjectFalcon"],"redactionTags":[]}
```

因此“落盘文件绝不出现整串原始查询”按字节定义不成立。测试只检查不存在 `query`/`redactedQuery` 字段，没有检查文件全文是否包含完整原串。

3. 建议：若红线是硬约束，需对 `terms.length === 1 && terms[0] === normalizedRaw` 单独处理，例如只留 hash；这会损失单 API 名称的 coverage 信号。若产品实际只要求“不增加整串字段”，应明确收窄红线并接受此泄露，而不能继续声称原串绝不出现。

### C2. redaction 先于 NFKC，且关键规则大小写敏感，可绕过结构性遮蔽

1. 文件：[src/scaffold-kb/query-redaction.ts:45](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/query-redaction.ts:45)、[tokenizer.ts:62](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/tokenizer.ts:62)、[nohit-recorder.ts:88](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/nohit-recorder.ts:88)

2. 复现输入：

```text
１２３４５６７８
https://api.example.com/?TOKEN=hunter2
authorization: bearer abcDEF123_xyz
```

纯内存实际结果：

```json
{"terms":["12345678"],"redactionTags":[]}
{"terms":["https","api","example","com","apiexamplecom","TOKEN","hunter2"],"redactionTags":[]}
{"terms":["authorization","bearer","abcDEF123","xyz","abcDEF123xyz"],"redactionTags":[]}
```

全角数字绕过 `DIGITS`，随后被 tokenizer 的 NFKC 恢复成敏感 ASCII 数字；大写凭据参数和小写 bearer 也未遮蔽。

3. 建议：先对输入执行 NFKC，再运行 redaction；凭据参数和认证 scheme 使用大小写不敏感匹配。补全角数字/邮箱/home 路径、`TOKEN=`、`bearer` 及跨类别混合测试，并断言最终序列化记录中敏感片段零出现。

### C3. 同步、未验证文件类型的追加可让主查询永久阻塞

1. 文件：[src/scaffold-kb/nohit-recorder.ts:102](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/nohit-recorder.ts:102)、[src/kb-mcp/tools/kb-search.ts:83](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/kb-mcp/tools/kb-search.ts:83)

2. 复现：

```bash
d=$(mktemp -d)
mkfifo "$d/nohit-$(date -u +%Y%m%d).jsonl"

SPECTRA_KB_NOHIT_TELEMETRY="$d" \
node --import tsx --input-type=module -e \
'import {executeKbSearch} from "./src/kb-mcp/tools/kb-search.ts";
console.log(executeKbSearch(
  {vendor:null,project:null,sourcesAvailable:[]},
  {query:"ProjectFalcon"}
))' &
pid=$!

sleep 1
kill -0 "$pid" && echo HUNG
kill "$pid"
```

`appendFileSync` 打开无 reader 的 FIFO 时会阻塞，`catch` 永远没有机会执行，查询没有结果也没有退出码。本环境依只读约束未创建 FIFO；但纯内存延迟注入已确认：让 `appendFileSync` 阻塞 300ms，`executeKbSearch` 返回同步延迟 301ms。

同一问题也允许预置 symlink 将遥测写进 `/dev/stdout` 或其他可写目标，污染 MCP stdio/CLI stdout。

3. 建议：把整个 mkdir/prune/append 链移出主查询返回路径，使用有界异步队列或独立 worker。至少以 `O_NOFOLLOW | O_NONBLOCK` 打开、`fstat` 确认为 regular file，并拒绝 FIFO、设备与 symlink；仅包 `try/catch` 不能提供“绝不影响主链路”的保证。

## WARNING

### W1. 大小写变体可绕过 `distinctQueries ≥ 2`

1. 文件：[src/scaffold-kb/nohit-recorder.ts:89](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/nohit-recorder.ts:89)、[coverage-gap.ts:157](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/coverage-gap.ts:157)

2. 输入 `retry alpha` 与 `retry Alpha` 得到不同 hash：

```text
4ad46c4b18f6be12
0cffb55b3d0cd946
```

共同 term `retry` 因而被计为 `distinctQueries: 2`，即使只是同一问题的大小写变体。

3. 建议：为 hash 引入与检索语义一致的 case-fold canonicalization；聚合 term 是否也大小写归一需同步定案并加测试。

### W2. 没有查询任何库时仍记录 coverage gap

1. 文件：[src/kb-mcp/tools/kb-search.ts:58](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/kb-mcp/tools/kb-search.ts:58)、[kb-search.ts:85](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/kb-mcp/tools/kb-search.ts:85)

2. 具体输入：context 只有 vendor，但请求 `source_filter: "project"`。实测响应为：

```json
{"results":[],"sources_queried":[]}
```

同时仍写入一条 `kb_search` no-hit 记录，`dbPathHash` 是空串 hash。此时是“无可用查询源”，不是文档 coverage gap。

3. 建议：仅在 `sourcesQueried.length > 0` 且至少一次 `searchKbCore` 真正执行后记录；无可用源应单独表达 availability 状态。

### W3. coverage-gap 接受缺值及未知参数

1. 文件：[src/cli/utils/parse-args.ts:768](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/cli/utils/parse-args.ts:768)

2. 复现：

```bash
node --import tsx --input-type=module -e \
'import {parseArgs} from "./src/cli/utils/parse-args.ts";
console.log(parseArgs(["scaffold-kb","coverage-gap","--format"]));
console.log(parseArgs(["scaffold-kb","coverage-gap","--unknown"]));'
```

两者均返回 `ok: true`；缺失 `--format` 值会静默回落 markdown。

3. 建议：按 operation 建立合法 flag 白名单；出现未知 flag 或带值 flag 缺值时返回 `invalid_option`。

### W4. 遥测文件不可读会被误报为 `no-data`

1. 文件：[src/scaffold-kb/coverage-gap.ts:71](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/coverage-gap.ts:71)、[coverage-gap.ts:140](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/coverage-gap.ts:140)

2. 复现：

```bash
d=$(mktemp -d)
ln -s /definitely/missing "$d/nohit-20260803.jsonl"
node --import tsx --input-type=module -e \
'import {buildCoverageGapReport} from "./src/scaffold-kb/coverage-gap.ts";
console.log(buildCoverageGapReport({nohitDir:process.argv[1],isCollectionEnabled:true}))' "$d"
```

匹配文件存在但读取失败时被直接 `continue`，最终是 `status: "no-data"`、`skippedLines: 0`，掩盖数据不可读。

3. 建议：增加 `skippedFiles/readErrors`，并提供 `partial`/`read-error` 状态；至少不得把读取失败解释为“尚无记录”。

## INFO

### I1. “不可逆 hash”实际是可字典枚举的稳定标识

1. 文件：[src/scaffold-kb/nohit-recorder.ts:28](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/nohit-recorder.ts:28)、[nohit-recorder.ts:53](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/nohit-recorder.ts:53)

2. 复现：

```bash
node --input-type=module -e \
'import {createHash} from "node:crypto";
console.log(createHash("sha256").update("/kb/chunks.sqlite").digest("hex").slice(0,16))'
```

输出 `ccfd271f713c36a1`，与实际记录一致。低熵路径可离线枚举，因此不是严格意义上的不可逆匿名化。

3. 建议：文案改为“稳定伪名标识”；若路径隐私要求更高，使用机器本地密钥的 HMAC。该项不违反当前“允许 hash”红线。

## 已尝试攻击但未发现问题的面

- 默认关闭成立：env 未设置、空串、纯空白三种输入均解析为 `null`；实际 mock 计数均为 **0 次 fs 调用**。
- 普通写失败不改响应：env 指向 `/dev/null` 时，`kb_search` 和 `kb_api_lookup` 与关闭状态的序列化响应均逐字节相同。
- 标准 ASCII 混合输入 `alice@example.com /Users/bob/w sk-... 13800138000` 正确得到 `EMAIL/TOKEN/HOME/DIGITS` 四个 tag，敏感片段未保留。
- 完全相同查询、额外空格和重复 term 会生成相同 hash；字面重复查询未突破阈值。
- `collection-disabled` 分支在读目录前提前返回；三种空态的显式状态分支及 placeholder token 过滤逻辑未发现串态问题。
- `.specify/kb-nohit/` 已同时进入根 `.gitignore` 与安装态自举清单；`git check-ignore` 实测命中。
- 常规文件的跨进程大行追加原子性**未确认**：只读环境无法运行实际并发写盘压力测试；当前测试也没有多个 no-hit writer 并发用例，不能据一次 `appendFileSync` 调用宣称所有文件系统上必然行原子。

工具使用反馈：本次未使用 Spectra/Spec Driver；用户约束明确禁止 `spectra graph/batch`，MCP 返回质量与准确性不适用。只读 Node 探针足以复现上述核心问题。

Codex session ID: 019fc432-0c30-7d02-9368-fbe55acd0ce5
Resume in Codex: codex resume 019fc432-0c30-7d02-9368-fbe55acd0ce5
