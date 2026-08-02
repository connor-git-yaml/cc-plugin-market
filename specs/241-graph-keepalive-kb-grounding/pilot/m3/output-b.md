审查结论：**BLOCK**。完整读完 `batch2.diff` 全部 1918 行、17 个文件。发现 **2 个 CRITICAL、3 个 WARNING、1 个 INFO**。全程只读，未修改文件，未运行 `spectra graph/batch`、测试套件或 build。

## CRITICAL

### C1. `tool` 缺少运行时 allowlist，可绕过 redaction 将完整原始 query 落盘

文件：[nohit-recorder.ts:84](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/nohit-recorder.ts:84)、[nohit-recorder.ts:94](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/nohit-recorder.ts:94)、[nohit-recorder.test.ts:222](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/tests/kb/nohit-recorder.test.ts:222)

`rawQuery` 会 redaction，但 `input.tool` 被原样序列化。`NoHitTool` 只有 TypeScript 编译期约束；运行时允许任意值。测试甚至明确要求非法 `tool` 不抛，却没有断言它不落盘。

用内存 mock 截获 `appendFileSync`，未写文件：

```bash
node --experimental-test-module-mocks --import tsx -e '
import { mock } from "node:test";
let captured = "";
mock.module("node:fs", { namedExports: {
  appendFileSync(_p, data) { captured = String(data) },
  mkdirSync() {},
  readdirSync() { return [] },
  statSync() { return { mtimeMs: Date.now() } },
  unlinkSync() {}
}});
process.env.SPECTRA_KB_NOHIT_TELEMETRY = "virtual-dir";
const { recordNoHit } = await import("./src/scaffold-kb/nohit-recorder.ts");
const raw = "alice@example.com full raw query";
recordNoHit({ tool: raw, rawQuery: raw, dbPath: "/kb/chunks.sqlite" });
const parsed = JSON.parse(captured);
console.log(JSON.stringify({
  capturedTool: parsed.tool,
  terms: parsed.terms,
  redactionTags: parsed.redactionTags,
  rawAppearsInSerializedLine: captured.includes(raw)
}));
'
```

真实输出：

```json
{"capturedTool":"alice@example.com full raw query","terms":["EMAIL","full","raw","query"],"redactionTags":["EMAIL"],"rawAppearsInSerializedLine":true}
```

当前三个生产调用点确实传固定 literal，因此外部 query 暂时不能直接控制 `tool`；但导出的 recorder 边界和其“任何输入”的 total-function 合同没有守住绝对隐私红线。

建议处置：**立即修**。在读取/序列化任何字段前验证 input 是对象、`tool` 属于三值 allowlist、`rawQuery/dbPath` 是 string；非法输入必须直接 no-op，并新增“非法 tool 不发生 append”的测试。

---

### C2. daily 文件缺少文件类型/所有权保护：FIFO 可阻塞主链，symlink/hardlink 可把记录写到目录外

文件：[nohit-recorder.ts:58](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/nohit-recorder.ts:58)、[nohit-recorder.ts:102](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/nohit-recorder.ts:102)

`appendFileSync(join(dir, dailyName), ...)` 会跟随既有 symlink，并可能在打开 FIFO 时无限等待。`pruneExpired` 使用 `statSync` 跟随链接，无法阻止指向近期目标的 daily symlink。另因任意非空 env 都被当作目录，配置为 `.` 等通用目录时还会删除其中所有过期且名称匹配的文件。

该反例必须创建 FIFO/symlink，受本次只读约束禁止，故未执行。若允许，会运行：

```bash
d=$(mktemp -d)
mkfifo "$d/fifo"
ln -s "$d/fifo" "$d/nohit-$(date -u +%Y%m%d).jsonl"

SPECTRA_KB_NOHIT_TELEMETRY="$d" node --import tsx -e '
import("./src/scaffold-kb/nohit-recorder.ts").then(({recordNoHit}) => {
  recordNoHit({tool:"kb_search", rawQuery:"no hit", dbPath:"/kb/chunks.sqlite"});
  console.log("returned");
})
' &
pid=$!

sleep 1
kill -0 "$pid"
```

预期 `kill -0` 成功且没有 `returned`，证明查询被治理 append 阻塞。把 daily 链接改指向一个近期普通文件，则记录会追加到 telemetry 目录外。

建议处置：**立即修**。写前拒绝 symlink/FIFO/device，使用 `openSync` 的 `O_NOFOLLOW | O_APPEND | O_CREAT` 后对 fd 做 regular-file 校验；清理侧使用 `lstatSync`，并增加目录所有权标记或受管文件校验，避免在任意目录按文件名删除用户文件。

## WARNING

### W1. `dbPath` 在 recorder 的保护边界外求值；即使 telemetry 未开启也可能让检索抛错

文件：[kb-search.ts:85](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/kb-mcp/tools/kb-search.ts:85)、[kb-locator.ts:49](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/kb-mcp/lib/kb-locator.ts:49)，同形态还存在于 [kb-api-lookup.ts:95](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/kb-mcp/tools/kb-api-lookup.ts:95) 和 [scaffold-kb.ts:63](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/cli/commands/scaffold-kb.ts:63)

JavaScript 会先计算 `describeQueriedDbPaths(...)`，再进入 `recordNoHit` 的 try/catch 和关闭态提前返回。因此 total-function 保护没有包住完整治理挂点。

只读复现：

```bash
node --import tsx -e '
import("./src/kb-mcp/tools/kb-search.ts").then(({executeKbSearch}) => {
  delete process.env.SPECTRA_KB_NOHIT_TELEMETRY;
  const db = {pointer:0, checkRc(){}, close(){}, exec(){}};
  const stable = {
    vendor:{db,graph:null,entities:null,dbPath:"/kb/chunks.sqlite"},
    project:null,sourcesAvailable:["vendor"]
  };
  const poisoned = {
    vendor:{db,graph:null,entities:null,get dbPath(){throw new Error("governance-path-boom")}},
    project:null,sourcesAvailable:["vendor"]
  };
  const good = executeKbSearch(stable,{query:"zzz-no-hit"});
  let bad;
  try { bad={returned:executeKbSearch(poisoned,{query:"zzz-no-hit"})}; }
  catch (e) { bad={threw:String(e)}; }
  console.log(JSON.stringify({
    telemetryEnv:process.env.SPECTRA_KB_NOHIT_TELEMETRY ?? "<unset>",
    goodReturned:good.content.length>0,
    bad
  }));
})
'
```

真实输出：

```json
{"telemetryEnv":"<unset>","goodReturned":true,"bad":{"threw":"Error: governance-path-boom"}}
```

生产 loader 当前只生成普通 string，因此这是畸形内部 context 路径，不是普通 CLI 输入可达路径；但它证伪了“关闭态也绝不影响主链”的结构性保证。

建议处置：**立即修**。先检查 telemetry 是否开启，再惰性计算路径；或把路径计算 closure 放进 recorder 自身 try/catch。三处挂点都要增加关闭态异常 getter 回归测试。

---

### W2. 六类 redaction 存在结构性旁路，敏感片段会作为 term 落盘

文件：[query-redaction.ts:45](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/query-redaction.ts:45)、[tokenizer.ts:62](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/tokenizer.ts:62)、[nohit-recorder.ts:88](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/nohit-recorder.ts:88)

redaction 在 NFKC 规范化前执行，且多个规则大小写敏感、email 要求域名含点。随后 tokenizer 才做 NFKC，导致未命中的敏感形态以规范化 token 写出。

用内存 fs mock 真实走完整 recorder，未写文件，得到：

```json
[
  {"raw":"１２３４５６７８","terms":["12345678"],"tags":[]},
  {"raw":"https://api.example/x?TOKEN=abc123zz","terms":["https","api","example","x","apiexamplex","TOKEN","abc123zz"],"tags":[]},
  {"raw":"user@localhost","terms":["user","localhost","userlocalhost"],"tags":[]}
]
```

另直接验证：

```json
{"raw":"c:\\users\\Alice\\secret","redacted":"c:\\users\\Alice\\secret","tags":[]}
```

其中全角八位数字尤其明确：它属于连续数字形态，却因 normalize 顺序而绕过 `<DIGITS>`，最终磁盘 token 中出现规范化号码。

建议处置：**立即修**。先对原始输入做 NFKC，再应用 redaction；对 URL credential key、Bearer、Windows home 路径使用符合语义的 case-insensitive 规则。Unicode/internal email 的边界需要产品侧确认，但不应阻塞 NFKC 和大小写修复。

---

### W3. 存在 no-hit 文件但读取失败时，被静默报告为 `no-data` 且没有任何错误计数

文件：[coverage-gap.ts:71](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/coverage-gap.ts:71)、[coverage-gap.ts:138](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/coverage-gap.ts:138)、[coverage-gap.ts:170](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/coverage-gap.ts:170)

内存模拟目录中确有匹配文件，但 `readFileSync` 返回 `EACCES`：

```bash
node --experimental-test-module-mocks --import tsx -e '
import { mock } from "node:test";
mock.module("node:fs",{namedExports:{
  readdirSync(){return ["nohit-20260803.jsonl"]},
  readFileSync(){throw new Error("EACCES")}
}});
const {buildCoverageGapReport}=await import("./src/scaffold-kb/coverage-gap.ts");
console.log(JSON.stringify(buildCoverageGapReport({
  nohitDir:"virtual-dir", isCollectionEnabled:true
})));
'
```

真实输出：

```json
{"schemaVersion":1,"minOccurrenceThreshold":2,"status":"no-data","totalRecords":0,"skippedLines":0,"items":[]}
```

这会把“数据存在但不可读”误报为“尚无记录”，破坏三态输出的可信度。

建议处置：**需要产品侧决策**。至少增加 `readErrors/skippedFiles`；更稳妥的是新增 `data-unreadable`/degraded 状态。若暂不扩 schema，至少不能以零诊断的 `no-data` 返回。

## INFO

### I1. `coverage-gap` 静默接受缺值 flag 和未知 flag

文件：[parse-args.ts:768](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/cli/utils/parse-args.ts:768)

实际执行：

```text
["scaffold-kb","coverage-gap","--format"]
→ ok: true，scaffoldKbFormat 未定义，最终静默回落 markdown

["scaffold-kb","coverage-gap","--unknown"]
→ ok: true
```

而 `--format yaml` 会正确返回 `invalid_option`。根因是 `readFlag` 无法区分“flag 不存在”和“flag 存在但缺值”，且 scaffold-kb 分支没有 op-specific unknown-option 校验。

建议处置：**立即修（低优先级）**。缺值 flag 返回 `invalid_option`，并给 `coverage-gap` 建立允许参数集合。

## 工具使用反馈

本次未调用 Spectra/Spec Driver：用户明确禁止 `spectra graph/batch`，当前会话也没有可调用的 Spectra MCP namespace；仅将用户给出的 pre-batch 图结果作为方向性提示，没有把它当成新代码事实。只读 `rg/sed/nl/git` 与内存 mock 足以完成证伪。未产生流程或 MCP 准确性反馈。

## 已攻击、未发现问题

- 完整逐段读完 `batch2.diff` 全部 1918 行；包含 ignore/bootstrap、规格制品、7 个生产挂点/模块和 6 个相关测试文件，没有只读新增模块。
- 默认关闭专项：
  - env 未设置、`""`、纯空白均解析为 `null`。
  - 用会在任何 fs 调用时抛错的内存 mock 运行关闭态，真实结果为 `{"resolved":null,"fsCalls":0,"threw":false}`。
  - 全仓排除 diff 后，仅 [nohit-recorder.ts:47](/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/modest-ellis-e4f0fe/src/scaffold-kb/nohit-recorder.ts:47) 一处读取该 env。
  - `"0"`、`"false"`、 `"."` 会被视为开启；这符合“任意非空值就是目录”的现行合同，并非暗中默认开启。
- 主链 byte-equivalence 正常路径：
  - 内存模拟一次成功 append，对同一 `kb_search` no-hit 比较开关前后结果，真实输出为 `{"byteIdentical":true,"appends":1}`。
  - env 指向 `/dev/null`、写入路径失败时，`kb_search` 与 `kb_api_lookup` 的返回序列化结果均与关闭态相同，退出码均为 0。
  - 当前三个生产调用点的 `tool` 均为固定 literal，没有发现 query 参数直接流入 `tool` 的路径。
- 三个挂点逐路径检查：
  - `kb_search` 只在最终 `merged.length === 0` 调用；
  - `kb_api_lookup` 的 entity no-match 与 `document_fallback` no-hit 均覆盖；
  - `scaffold-kb query` 仅真实加载并检索后的零结果调用；
  - 参数校验失败、KB 不可用、关键词为空、有结果路径均不会记录。
- 正常输入落盘范围：
  - record 对象固定为 8 个合同字段，没有 `query` 或 `redactedQuery` 字段；
  - `dbPath` 只进入 SHA-256 截断 hash，正常调用未发现路径明文进入记录；
  - 单次 `appendFileSync` 写一条 JSON 加结尾换行，JSON.stringify 会转义 query 中的裸换行。
- 六类规则的文档精确形态均直接运行成功：
  - ASCII email → `EMAIL`
  - `user:pass@` URL → `URL_WITH_CRED`
  - `sk-` token → `TOKEN`
  - 20+ base64 → `HIGH_ENTROPY`
  - `/Users/<name>` → `HOME`
  - 8 位 ASCII 数字 → `DIGITS`
- placeholder 过滤逐项核对：`EMAIL/TOKEN/HOME/DIGITS/HIGH/ENTROPY/HIGHENTROPY/URL/WITH/CRED/URLWITHCRED` 均进入过滤集合；未发现 placeholder 自身进入 backlog。
- aggregation 真实内存 fixture 输出：
  - 四态依次为 `collection-disabled / no-data / no-gap-above-threshold / ok`；
  - 同一 hash 重复只增加 `occurrences`；
  - 两个不同 hash 才产生 `distinctQueries: 2`；
  - 损坏 JSON 行得到 `skippedLines: 1`，其他记录继续聚合。
- `collection-disabled` 在读目录前提前返回；历史文件存在时也不会被读取。
- 合法 CLI 路径可达：`coverage-gap`、`--format json`、`--format markdown` 均解析；`--format yaml` 正确拒绝。
- `.specify/kb-nohit/nohit-20260803.jsonl` 经 `git check-ignore -v` 实测命中根 `.gitignore:59`；bootstrap 清单也包含同一条目。
- `pruneExpired` 只按 `^nohit-\d{8}\.jsonl$` 作用，没有发现普通异名文件被清理；特殊文件与目录所有权风险已单列 C2。
- `git diff --check` 零输出，没有新增 whitespace error。
- 审查前后 `git status --short` 一致；本次未创建、修改、删除、暂存任何文件。

Codex session ID: 019fc433-96a0-7281-abeb-a323ed1169a9
Resume in Codex: codex resume 019fc433-96a0-7281-abeb-a323ed1169a9
