# F284 独立验证报告（T008）

## 1. 元信息

| 项 | 值 |
|---|---|
| Worktree | `.claude/worktrees/f284-collector-ignore-ssot` |
| 分支 | `284-collector-ignore-ssot-guardrail-edges` |
| HEAD | `27178b1589a1207606e7b7465a87e0c9fbdfacb7`（已 rebase 到 `origin/master` `93b49956`） |
| 日期 | 2026-09-13 |
| 执行者 | verify 子代理（claude-sonnet-5，独立会话，无先验实现记忆） |
| 验证方式 | 逐条对照声称 + 亲跑指定套件 + 7 组变异测试（改 → 跑 → 记录 → `git checkout --` 复原） |
| 环境注记 | 本次会话的系统级 Primary working directory 被设为另一 worktree（`f286-p1k-handoff`），与任务书指定的 F284 worktree 不一致；已用 `git -C <F284路径>` 与绝对路径核实该路径存在、分支/HEAD/rebase 状态与任务书描述完全一致后，全程在该路径下操作，未触碰主仓库或其他 worktree |

## 2. 声称核对表（§A）

| # | 声称 | 判定 | 证据 |
|---|---|---|---|
| A1 | SSoT：`collector-surface.ts` 六面（`TSJS_SKELETON_WALK_SURFACE`/`PY_WALK_SURFACE`/`JAVA_ADAPTER_SURFACE`/`GO_ADAPTER_SURFACE`/`MODULE_DERIVATION_SCAN_SURFACE`/`PYTHON_SYMBOL_SCAN_SURFACE`）+ 两个适配器声明集（`PYTHON_ADAPTER_DECLARED_IGNORE_DIRS`/`TSJS_ADAPTER_DECLARED_IGNORE_DIRS`）都带 `ignoreDirs` | **证实** | 通读 `src/collector-surface.ts` 全文（350 行）：接口新增 `ignoreDirs: ReadonlySet<string>`（:56），八个常量字面量（:64-149）逐一赋给六面（:164-242）与两个导出声明集；`mergeSurfaces` 对 `ignoreDirs` 取并集（:348） |
| A2 | 消费方无第二份字面量（`grep "IGNORE_DIRS.*= new Set(\['" src` 只应命中 collector-surface.ts） | **证实（带注记）** | 朴素 grep 实际额外命中 `ignore-oracle.ts` 两处：① `GRAPH_COLLECTOR_IGNORE_DIRS`（:64）——读内容后确认是 `...TSJS_SKELETON_WALK_SURFACE.ignoreDirs, ...PY_WALK_SURFACE.ignoreDirs` 的**派生 spread 表达式**，不是字面量；② `GENERIC_UNIVERSAL_IGNORE_DIRS = new Set(['node_modules', '.git'])`（:101）——是 fix-report §4 与 `collector-surface-ignore-dirs.test.ts:100-104` 都显式登记、并用正则从扫描文本里排除掉的**已知残留**（oracle 对 java/go **文件级**判定的补集，非目录剪枝 SSoT 的第二份）。本仓库测试自己用的正则 `/IGNORE_DIRS\s*(?::\s*ReadonlySet<string>)?\s*=\s*new Set\(\[\s*(?:\/\/[^\n]*\n\s*)*'/`（要求 `new Set([` 后紧跟引号）比任务书给出的朴素 grep 更精确，能正确排开 spread 表达式；朴素 grep 只是核对手段本身粗糙，不构成实现缺陷 |
| A3 | 六个消费方口径零行为变化，且方向性登记（generic walk 对 `node_modules/` 下 java/go **会**剪；oracle `.py` 无 #11 分派）如实 | **证实** | 逐文件 `git diff HEAD^ HEAD` 核对：`java-adapter.ts`/`go-adapter.ts`/`ts-js-adapter.ts`/`python-adapter.ts`（`defaultIgnoreDirs` 与 `scanPyFiles` 的 `ignoreNames`）/`file-scanner.ts`（`UNIVERSAL_IGNORE_DIRS`）/`source-discovery.ts`（`PY_SKELETON_IGNORE_DIRS`/`TSJS_SKELETON_IGNORE_DIRS`）/`ignore-oracle.ts`（`GRAPH_COLLECTOR_IGNORE_DIRS`/`TSJS_IGNORE_DIRS`/`PY_IGNORE_DIRS`/`javaIgnoreDirs`/`goIgnoreDirs`）——旧字面量与新引用指向的 SSoT 集合逐项相同（如 `GRAPH_COLLECTOR_IGNORE_DIRS` 旧字面量 18 项 = 新 `TSJS∪PY` 派生集 18 项，含 `.venv`/`venv`）。两条方向性登记分别由行为哨兵测试钉住：`oracle.isIgnored('node_modules/x.java') === true` 与 `oracle.isIgnored('.mypy_cache/x.py') === false` / `oracle.isIgnored('coverage/x.py') === true`（`collector-surface-ignore-dirs-behavior.test.ts:87-92`，已亲跑通过）。另确认 I-2 登记属实：`scanPyFiles` 确实改为直接读 `PYTHON_SYMBOL_SCAN_SURFACE.ignoreDirs`、不再读 `this.defaultIgnoreDirs`，注释诚实披露"实例覆盖通道失效（仓内无覆盖者）" |
| A4 | 护栏比较器七维：`compareEdgeAttributes`/`compareNodeTopLevelKeys`/`compareGraphTopLevel` 比较 rebuilt vs pinned；计数不等组跳过；hyperedges 非数组单列签名；`printMetadataDimensionGuidance` 前缀表扩到五维 | **证实** | 通读 `scripts/regen-collector-fingerprint-fixtures.ts:645-825`：`compareEdgeAttributes(rebuilt, pinned)`（:676）与 `compareNodeTopLevelKeys(rebuilt, pinned)`（:705）参数顺序确认方向；`if (leftEdges.length !== rightEdges.length) continue;`（:686）确认跳过；`compareGraphTopLevel` 的 `hyperedgesOf` 对非数组返回 `{kind:'non-array', type: raw===null?'null':typeof raw}` 单独签名（:750-753）；`PRODUCER_FIELD_DIMENSION_PREFIXES`（:149）= `['metadata ', '节点顶层 key 集合', '边属性', '图顶层 key 集合', 'hyperedges ']`，五项 |
| A5 | 真实再生脚本在 pinned 资产上零假红（exit 0、无需更新、两份资产字节不变） | **证实** | 亲跑 `npm run fixtures:regen:collector-fingerprint`：输出 `[regen] 双轨重建内容、指纹与 fixtureInputHash 均一致，无需更新（未写盘）。`，`echo $?` via 命令链确认 `EXIT_CODE=0`；跑前/跑后 `shasum -a 256` 两份 pinned 资产完全一致；`git status --short` 全程无输出 |
| A6 | A/B 证明力如实（对本改动近似空转，逐名等价主证据换成行为哨兵测试） | **证实（附一处文档格式缺陷，见 §5）** | `verification/external-corpus-ab.md` 含完整的"证明力如实（对抗复审 W4）"段落，措辞与 fix-report §4.1 一致；`external-corpus-ab.sh` 第 15 行 `delete meta.fingerprint;`（不是 `collectorFingerprint`），与 fix-report I-7 更正一致 |
| A7 | 账本：F284 待处理条目存在 | **证实** | `docs/design/dogfooding-feedback-ledger.md:27-34`：`### F284 · 2026-09-13` / `状态：待处理（1 条）`，内容与流程反馈相符 |

## 3. 套件结果（§B）

亲跑（mutation 前后各一次，结果一致）：

```
npx vitest run tests/unit/collector-surface-ignore-dirs.test.ts \
  tests/unit/collector-surface-ignore-dirs-behavior.test.ts \
  tests/unit/guardrail/collector-fingerprint-guardrail.test.ts \
  tests/integration/collector-fingerprint-regen-script.test.ts \
  src/panoramic/graph/quality/ignore-oracle.test.ts \
  tests/adapters/python-adapter.test.ts \
  tests/unit/file-scanner.test.ts
```

结果：**Test Files 7 passed (7)；Tests 201 passed (201)**，零失败。（跑前 stderr 出现的 `git 仓库内忽略清单预取失败，已降级为仅根 .gitignore 近似过滤` 等告警是 `collector-surface-ignore-dirs-behavior.test.ts` 用 `mkdtempSync` 建临时目录后不在 git 仓库内的预期降级路径提示，非测试失败。）

注：`tasks.md` T005 声称的定向套件还包含 source-discovery / python-adapter / F220 导出面 / regen-predicate 等测试文件，超出本次任务书 §B 指定的 7 个文件范围，未独立重跑；标记文件 `f284-gate.done` 已出现，说明 T009 全量门禁已在别处执行完毕，该范围由 T009 覆盖。

## 4. 变异矩阵（§C）

7 组变异全部执行：每组"改动 → 跑指定测试 → 记录 → `git checkout -- <file>` 复原 → `git status --short`/`git diff --stat` 确认干净"。全程无需等待门禁标记（`f284-gate.done` 在检查时已存在），未发现并发 vitest 进程。

| # | 变异 | 预期 | 实测结果 | 判定 |
|---|---|---|---|---|
| 1 | `ignore-oracle.ts::javaIgnoreDirs()` 去掉 `GENERIC_UNIVERSAL_IGNORE_DIRS` 并集 | behavior 测试 oracle 用例红 | `collector-surface-ignore-dirs-behavior.test.ts` 1 failed：`Probe.java` 的 `.git`/`node_modules` 两名从 `true`→`false` | **CAUGHT** |
| 2 | `python-adapter.ts::scanPyFiles` 的 `ignoreNames` 改成 `new Set([...PYTHON_SYMBOL_SCAN_SURFACE.ignoreDirs, 'src'])` | behavior #11 用例红 | 同文件 1 failed：`src` 从 `true`（应被采集）→ `false` | **CAUGHT** |
| 3 | `file-scanner.ts` 派生通用忽略集时过滤掉 `'specs'` | behavior #7/#8 用例红 | 同文件 1 failed：`specs` 从 `true`→`false` | **CAUGHT** |
| 4 | `compareEdgeAttributes` 改成只比 `Object.keys(attrs).sort()`（key-only） | guardrail confidenceScore 用例红 + 集成 (f) 红 | **3 个测试红**（比预期更广）：guardrail 的 confidenceScore-only 用例、guardrail 的 confidence+evidenceText 用例（W-1 修复前两条值级用例都被 key-only 掩盖）、集成 (f) | **CAUGHT（强于预期）** |
| 5 | `PRODUCER_FIELD_DIMENSION_PREFIXES` 去掉 `'边属性'` | 集成 (f) 红 | 集成 (f) 1 failed，精确命中 `expect(run.stderr).toContain('上述差异含 **边属性** 维度')` 这一行；比较器本体判定（`边属性不一致（confidenceScore: ...)`）与拒绝/退出码均未受影响，只是指引文案缺失 | **CAUGHT（精确符合预期）** |
| 6 | `compareGraphTopLevel` 的 `hyperedgesOf` 退回"非数组一律折成 `[]`"（W-5a 修复前形态） | guardrail W-5a 用例红 | guardrail 1 failed：`{}`/`null` 与空数组 `[]` 折叠为同一签名，`comparison.mismatch` 从 `true`→`false` | **CAUGHT（精确符合预期）** |
| 7 | `compareNodeTopLevelKeys` 把"重建新增/重建缺失"两个数组对调 | 正反两条用例中至少一条红 | **2 个测试均红**（比预期更广）：正向与反向（W-6）用例的完整行断言均不匹配对调后的文案 | **CAUGHT（强于预期）** |

**变异测试结论：7/7 全部被现有守卫捕获，0 例逃逸。** 未发现"变异全绿"的守护缺口。每次变异后立即用 `git checkout -- <file>` 复原并用 `git diff --stat`/`git status --short` 确认零残留；全部变异结束后，末尾复跑一次完整 §B 套件（7 文件 / 201 测试仍全绿）与 `git rev-parse HEAD` 确认未偏离 `27178b15`。

## 5. Over-claim / 缺口清单

| 严重度 | 内容 |
|---|---|
| INFO | `verification/external-corpus-ab.md` 存在 Markdown 格式缺陷：self-dogfood 行（第 19 行 `\| self-dogfood \| #1 + #7/#8 \| 7824 / 13349 \| 7824 / 13349 \| 逐字节相同 \|`）被两个空行 + 两段散文（"结论：…"、"证明力如实…"）与真正的表格主体（第 9-13 行，GORM/HikariCP/micrograd 三行）隔开。按 GFM 语法，表格在空行处已终止，该行渲染时不会显示为表格第 4 行，而是一段孤立的、以 `\|` 开头结尾的纯文本。数据本身真实存在于文件中（可核对到 7824/13349 两侧相同），不影响验证结论的实质真实性，但"四条语料同表可读"这一呈现意图未达成，属于文档产物的排版缺陷，非功能缺陷。建议后续把该行挪回表格主体紧跟在 micrograd 行之后。 |
| INFO | 本任务书 §A 给出的核对命令（朴素 `grep "IGNORE_DIRS.*= new Set(\['"`）比代码库自己在 `collector-surface-ignore-dirs.test.ts:108` 用的正则粗糙，会把派生 spread 表达式误判为候选第二字面量，需要人工读代码澄清。已在 A2 行注记，不计入实现方缺陷，仅供未来同类核对任务参考更精确的判据写法。 |
| INFO | `tasks.md` T005 声称覆盖的定向套件（source-discovery / F220 导出面 / regen-predicate 等测试文件）超出本任务书 §B 指定范围，未被本次独立复核直接重跑；已有 `f284-gate.done` 标记佐证 T009 全量门禁已在别处跑过，风险由 T009 兜底，非本报告缺口。 |

**未发现 CRITICAL 或 WARNING 级问题。** 所有声称经独立复核（源码通读 + diff 比对 + 亲跑测试 + 亲跑真实再生脚本 + 7 组变异测试）均属实，方向性登记（残留、既有假警报面、A/B 空转、护栏未覆盖面）均如实且有测试或文档佐证，未发现被掩盖或夸大的情况。

## 6. 结论

**PASS**

零 CRITICAL、零 WARNING、3 条 INFO（均为文档呈现或核对方法层面的轻量注记，不构成阻断项）。SSoT 化的零行为变化声称、护栏比较器三新维度的检测力声称、真实再生脚本零假红声称，均通过独立的源码通读、diff 比对、亲跑套件与 7 组变异测试得到证实，变异测试 0 例逃逸。

## 7. 工具使用反馈（Dogfooding）

- **Spectra MCP**：本次验证未使用。原因：任务是对一组已明确列出文件路径的 diff 做逐行核对（`git show --stat` / `git diff HEAD^ HEAD -- <file>` 已给出精确改动面），以及对既有测试文件做定点阅读，不需要跨文件的依赖 / 影响面 / symbol 定位查询；`grep`/`git diff`/`Read` 已是更直接的工具。这与 fix-report §6 的自评一致（"12 处字面量靠 `rg` 普查更直接；impact 对常量引用面无增益"）。
- **Spec Driver 流程**：未调用编排器 skill——本任务书本身就是 spec-driver-fix 流程里 T008（verify 子代理）的直接派发，产物路径、验证范围、变异清单均已在任务书里给全，不需要再走 `/spec-driver` 的 phase 编排。
- **流程顺畅度**：任务书给出的"等待 `f284-gate.done` 标记文件"步骤在实际执行时标记已存在（无需等待），流程本身设计合理（先做只读 §A 再等标记做变异 §C 的顺序安排是对的，避免了变异阶段与全量门禁并发写同一批源文件）。变异测试环节沿用任务书建议的"直接改已提交文件 + `git checkout --` 复原"方式（而非账本里 F284 自己那条反馈提到的"整仓 rsync 副本 + 独立 vitest config"重量级方案）——因为本次变异集只有 7 组、单文件单行改动、顺序执行，"每次改动触发 tsc 重建"的成本（约 40 秒/次）可接受，未构成实际阻塞；重量级方案更适合大批量（十几组以上）并行变异场景。此点补充性观察，不构成新反馈条目，不落账。
- **MCP 可用性 / 返回信息 / 结果准确性**：均无异常，本条无实质发现。

## 附：最终状态

```
$ git status --short
（无输出，工作区干净）
$ git rev-parse HEAD
27178b1589a1207606e7b7465a87e0c9fbdfacb7
```
