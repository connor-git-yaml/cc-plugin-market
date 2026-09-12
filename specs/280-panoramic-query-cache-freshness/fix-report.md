# F280 · panoramic-query 引擎缓存无失效判据 → MCP 同进程重建图后永远拿旧图；且不经 F266 诚实返回面

> 模式：spec-driver-fix（主线程实施 + 独立子代理对抗复审 + verify 子代理）。类别：一般生产代码（MCP 工具面），主线程自审 + 1 子代理对抗。来源：2026-09-12 架构审查 src C-1（主线程复核成立）。

## 1. 问题与证据

- `src/panoramic/qa/index.ts:39-58`（改前）：`engineCache = new Map<string, GraphQueryEngine>()`，key 仅 `graphPath\0root`，**无 mtime/size/TTL 失效**；唯一清理入口 `clearEngineCache` 生产零调用（仅测试）。
- 同进程另一套 `src/mcp/graph-tools.ts:37-80`（改前）：每次 stat graph.json 按 mtime+size 复合失效（F155 T-002）。两套判据不对称。
- 可复现链路：MCP `batch`（server.ts 同进程调 `buildAstGraphOnly`/`runBatch`）重建图 → `panoramic-query(natural-language)`（server.ts → `panoramic/query.ts` → `answerQuestion` → `getEngine`）继续用旧 engine 回答；且该工具的返回体没有 F266 的 freshness/coverage 标注——"诚实返回面"在此双重缺席。
- 5-Why 根因：同一事实（"内存 engine 是否落后磁盘 graph.json"）在两处各自实现，后加的一处（F5 natural-language）没有继承先有的失效判据；模块级可变单例 + 仅供测试的 reset 出口让问题在测试里不可见（测试每例 clearEngineCache）。

## 2. 修复（零基：一份共享缓存，两侧共用）

1. 新增 `src/panoramic/graph/engine-cache.ts`：`loadEngineCached(graphPath, projectRoot)`（每次 stat，mtime+size 复合失效，NUL 分隔 key）+ `clearEngineCache()`。graph.json 不存在时不由 stat 的 ENOENT 抢先，交给 `GraphQueryEngine.loadFromFile` 抛其用户可读错误（既有语义）。
2. `src/panoramic/qa/index.ts`：`getEngine` 改走共享缓存；`clearEngineCache` 改为共享缓存的别名导出（既有测试/调用面不变）。
3. `src/mcp/graph-tools.ts`：删除本地 `CachedEngineEntry`/Map，`getEngine` 改走共享缓存（取条目的 `.engine`），`reloadGraph()` 转发 `clearEngineCache()`；`getCachedGraphData` 改为 `existsSync` 前置后直接 `toGraphEvidence(loadEngineCached(...))`——元数据取自验证这份 engine 的那次 stat，不再另行 stat（此前 stat→getEngine 两步之间文件被重写会让元数据描述另一份文件）。
4. 图证据随回答带回（对抗复审 C-1 / W-1 / W-2 修补，见 §7）：`engine-cache.ts` 的 `loadEngineCached` 返回 `CachedEngine = { engine, graphPath, mtimeMs, sizeBytes }`（条目 = engine + 验证它的那次 stat），新增 `LoadedGraphEvidence` 类型 + `toGraphEvidence()`；`qa/index.ts` 在引擎加载成功后的三条 return 路径都带 `QnAAnswer.graphEvidence`（加载失败的 graph-insufficient 回退不带）；`panoramic/query.ts` ok 分支新增 `honestyInputs: { graph, resultsEmpty: citations.length === 0 }`（不进 `data`、不序列化）；`graph-honesty.ts::buildPanoramicQueryHonesty(projectRoot, inputs)` **只用传入的 inputs、不再自己加载图**（删除对 `graph-tools` 的 import，同时消掉 lib→tool 的反向依赖），`HonestyAnnotationParams.graph` 类型改为 `LoadedGraphEvidence`。
5. `src/mcp/server.ts` panoramic-query handler：`operation==='natural-language'` 时 `buildPanoramicQueryHonesty(projectRoot, result.honestyInputs)`，把 `honesty` 合并进返回 payload；其余三种 operation 不读 graph.json，不挂。工具描述 Output 补 `honesty`（I-3）。

## 3. 红先行

- `tests/unit/panoramic/engine-cache.test.ts`（5 例：复用 / size 变重载 / 同尺寸 mtime 变重载 / 不同 root 各自 engine / 缺文件走 loadFromFile 错误）——改前模块不存在 → 红。
- `tests/unit/mcp/panoramic-query-honesty.test.ts`（helper 级 5 例；engine-cache 单元 7 例；wiring 6 例，合计 18：无 inputs / 图缺席 → null；结果非空 → freshness 齐全、无 resolution；零图证据 → `resolutionOmitted`；标注绑定传入的图不重读盘）。
- `tests/unit/mcp/panoramic-query-honesty-wiring.test.ts`（handler 级 5 例，真实 server→query→qa→engine-cache 链路，只 mock LLM/embedding/debt/citation/prompt）——对抗复审后红先行实证：修补前 4 红（C-1 stale 图翻 isError；W-2 两条 `resolutionOmitted` 缺席；W-1 标注描述图 B）+ 1 绿（缓存收敛本体：同进程重建后第二问落到新图）；修补后 6/6 绿（含 delta 复审 W-B 补的 rag-only 用例）。
- 既有 `tests/unit/mcp/graph-tools-cache.test.ts`（stale detection 4 例）作为回归对照，迁移共享缓存后仍绿；`tests/panoramic/qa/index.test.ts`、`tests/unit/mcp-server.test.ts` 绿。

## 4. 影响范围与边界

- 消费方：graph-tools 六个图工具 + agent-context 三工具（经 getCachedGraphData→getEngine）+ qa answerQuestion。失效判据由"两套不对称"变为"一套"，语义不变（graph-tools 原口径）。
- 不做：其余三种 panoramic operation 的诚实标注（它们不读图）；F266 coverage 维度对 NL 回答不适用（无 symbol 起点）；QA 层把加载期 `graph-format-stale` 吞成 `graph-insufficient` 文案（既有 F5 行为，本卡只保证不因 honesty 附加而翻转成功状态；NL 路径的 stale 专属可执行文案留 M11 候选）。
- 已知限制（如实）：同 mtimeMs 且同 size 的重写不可见——与收敛前 graph-tools 口径一致，非本卡引入（对抗复审 I-1 实测两版一致）；`honestyCache` 无界属 F266 既有。
- 层级：panoramic/qa → panoramic/graph/engine-cache ✓；mcp → panoramic/graph ✓；graph-honesty 只 `import type` 自 panoramic/query（编译期擦除），不再 import graph-tools（原 lib→tool 反向依赖已消）。

## 5. 审查档位

一般生产代码：主线程自审 + 1 独立子代理对抗复审（切入角：缓存失效误伤面 / 标注合同一致面），结论见 verification/。Codex 暂停期。

## 6. 工具使用反馈（Dogfooding）

- Spectra MCP：未用——被改对象正是 MCP 图工具的缓存层，用它审自己构成循环取证；改动面由架构审查已给到 file:line。
- Spec Driver：主线程按 fix 骨架推进（用户要求本 session 内执行）。无实质工具反馈，不落账。

## 7. 对抗复审处置（2026-09-12，独立子代理，A/B 副本实跑）

| # | 档 | 发现 | 处置 |
|---|---|---|---|
| C-1 | CRITICAL | graph-format-stale 图上 handler 二次加载（`getCachedGraphData` 按 F193 FR-006 上抛）→ NL 结果从"成功 + graph-insufficient 文案"翻成 `internal-error`（FR-011 违反） | 修：honesty 只绑定 QA 随结果带回的图（`honestyInputs.graph`），不再二次加载；图缺席 → null 不挂；handler 级回归测试钉住 isError/code/fallbackMode |
| W-1 | WARNING | 答案来自图 A、标注描述图 B（LLM 窗口内图被重建） | 修：同上，`graphEvidence` 取自产出答案的那份 engine 条目；测试：LLM mock 内重写图 → `recordedSourceCommit` 仍为 A |
| W-2 | WARNING | `resultsEmpty:false` 硬编码，零 citation 回答无 `resolutionOmitted` | 修：`resultsEmpty = citations.length === 0` 由 caller 如实传参（F238）；测试覆盖 canned 零结果与 LLM 无引用两种形态 |
| I-1 | INFO | 同 mtimeMs+size 重写不可见（两版一致） | 登记为已知限制（§4） |
| I-2 | INFO | graph-tools.ts 头注释仍描述已删除的本地 Map | 修：注释清理 |
| I-3 | INFO | 描述 Output 与 drift 测试 TRUTH 未含 `honesty` | 修：两处补齐 |

修补后 **delta 对抗复审**（独立子代理，A/B 副本 13 种 graph.json 形态 + 20 条变异）：**0 CRITICAL**；三条合同（C-1 状态不翻转 / W-1 单源绑定 / W-2 零引用结构化缺席）实证成立；处置：

| # | 档 | 发现 | 处置 |
|---|---|---|---|
| W-A | WARNING | NaN 身份在 `query-helpers.ts buildAdjKey` 的字符串模板键上撞成 `"NaN::NaN"`——我写的「必然 miss」对一个被点名的消费方方向相反（潜伏，非生产可达） | 修：改为每次加载唯一的负数身份（`===` 与字符串键都必然 miss）；测试改钉「负且唯一 + 模板键不等」 |
| W-B | WARNING | rag-only 二级降级路径的 `graphEvidence` 无用例守（删掉仍 184/184 绿） | 修：wiring 补 rag-only 形态用例（2 节点 → `fallbackMode:'rag-only'` + `resolutionOmitted`） |
| I-1 | INFO | `resultsEmpty = citations.length===0` 是「零引用」不是严格「零图证据」（注释 over-claim，行为无假话） | 修：注释改口 |
| I-3 | INFO | 缺文件用例正则对 statSync ENOENT 同样匹配，钉不住「loadFromFile 抢先」 | 修：钉 loadFromFile 特有文案 |
| I-2 / I-4 / I-5 | INFO | stat/load 顺序与 getCachedGraphData 单步两条竞态不变量无测试；NL 守卫与 helper 双重编码；`graphEvidence` 持整图引用无机制约束序列化 | 登记（不在本卡扩面）：竞态不变量测试与 `enumerable:false` 候选进 M11 小清扫 |
