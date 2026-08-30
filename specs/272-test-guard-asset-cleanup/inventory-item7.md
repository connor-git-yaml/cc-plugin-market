# F272 ⑦ — 源码文本 grep 式测试与恒真断言清单

> 清点方式：只读子代理全仓扫描（`tests/`、`src/**/*.test.ts`、`plugins/**/*.test.mjs`、
> `scripts/**/*.test.*`，排除 `node_modules` / `dist`），主线程抽验。
> 清点日期 2026-08-31，基线 commit `f7a65aa9`。

## 判别红线

本仓有大量**正当**的文本合同守护——wrapper 同步、SKILL.md 片段同步、release contract
同步、生成产物一致性、分层/零 I-O 架构守卫、负向漂移守卫（`not.toContain('CODEX_HOME')`
这类）。这些读文本做 `toContain` **是设计如此，判「合理」**，不得计入虚化、不得删。

只标两类：
- **A 类**：被测对象是**可执行代码**、本可直接调用验行为，却退化成对源文件做正则/子串匹配
- **B 类**：**断言恒真**——无论实现对错都成立

## 主线程抽验记录

抽验 3 条 B2（条件恒假）类，结论与子代理逐字吻合：

| 抽验条目 | 实际代码 | 结论 |
|---|---|---|
| `tests/unit/god-node-analyzer.test.ts:111` | `if (godNodes.length >= 2) { expect(...degree).toBeGreaterThanOrEqual(...) }` —— 唯一断言被条件包住 | ✅ 属实 |
| `tests/unit/code-slice-extractor.test.ts:239` | `if (slices.length > 0)` 外套 + 内层 `A \|\| B` 析取，双重放水 | ✅ 属实 |
| `tests/extraction/image-extractor.test.ts:276` | `if (createMock.mock.calls.length > 0)` 包住断言，紧跟注释「即使未调用（降级），测试也通过」 | ✅ 属实（注释自认） |

---

## 本卡处置范围裁决

**清点总量：虚化 99 条**（A 类 64 条 / B 类 35 条），聚合到约 20 个文件。

一次性处置 99 条会把本卡从"清淤"变成"测试套件重写"，远超 story 模式规模。按**改动性质**
划线（不是按数量截断）：

| 类别 | 数量 | 本卡 | 理由 |
|---|---|---|---|
| **B 类（断言恒真）** | 35 | ✅ **就地修正** | 缺陷在断言本身，修法机械（前置一条 length 断言 / 收紧比较符 / 删除），每条可独立变异验证，不改变测试的设计意图 |
| **A 类（源码文本 grep）** | 64 | ⏭️ **移交后续卡** | 缺陷在测试**方式**，修法是"`vi.mock` + 真调用重写整个文件"——是重新设计测试，不是清淤。A1–A5 五个文件 44 条集中在 `batch-orchestrator.ts` / `batch-project-docs.ts` / `agent-context-tools.ts` 三个模块上，适合作为一张独立卡整体重写 |

**本清单本身是 ⑦ 的主交付物**：卡面写的是"清单化处置"，清单入库让 A 类 64 条从"没人知道
的隐性欠账"变成"有坐标、有处置建议的显性待办"，这是比多修 20 条更重要的产出。

---

## B 类（本卡处置，35 条）

> **计数单位说明（重要，避免下游再算错）**：本节所有「条」= **坐标条目**（一行
> `文件:行号` 或一个 `文件:行区间`），**不是**断言语句行数。B6 的 4 条坐标各覆盖一个
> `it` 块（块内有 3-4 行 `typeof` 断言），按坐标计为 4。
>
> 逐子类：B1 **3** + B2 **12** + B3 **3** + B4 **5** + B5 **3** + B6 **4** + B7 **5** = **35** ✅
>
> 其中 **3 条不由 ⑦ 处置**：
> - 2 条**随 ① 删除自动消失**（B2 的 `src/panoramic/qa/__tests__/rag-reranker.test.ts:131`、
>   B4 的 `src/panoramic/qa/__tests__/index.test.ts:191`）
> - 1 条**由批 A 顺带修回**（B4 的 `tests/panoramic/qa/index.test.ts:190`，`>= 0` → `> 0`，
>   与 ① 的移植处置同文件同批次）
>
> ⇒ **批 C-⑦ 实际处置 32 条**；32 + 1 + 2 = 35 ✅

### B1 纯占位 `expect(true).toBe(true)`（3 条）

| 位置 | 说明 | 处置 |
|---|---|---|
| `tests/unit/mcp/agent-context-tools-snapshots.test.ts:150` | 用例名自称"占位说明" | 删（覆盖已在 `agent-context-tools.test.ts`）|
| `tests/kb/ingester.test.ts:402` | 注释「此断言为文档性占位」 | 转 `it.todo`，或造 id 碰撞 fixture 验 llms-txt 优先 |
| `tests/e2e/feature-171-file-navigation.e2e.test.ts:129` | HOST_E2E gate 内占位 | 转 `it.todo`（默认 skip）|

### B2 条件恒假 / 条件放水 ⇒ 断言从不执行（12 条）★ 风险最高

实现退化时这些用例**静默变绿**——是本清单里唯一会"主动掩盖回归"的一类。

| 位置 | 问题 | 处置 |
|---|---|---|
| `tests/unit/god-node-analyzer.test.ts:111` | `if (godNodes.length >= 2)` 包住唯一断言 | 前置 `expect(godNodes.length).toBe(2)` |
| `tests/unit/surprising-edges.test.ts:80` | 双层 `if`（length≥2 且两条边都 find 到）| 拆两层 if，先钉死 `surprises.length` |
| `tests/panoramic/qa/rag-reranker.test.ts:115` | `if (rankedChunks.length>0)` 才验字段 shape | 先断言 length>0 |
| `tests/panoramic/qa/rag-reranker.test.ts:198` | 同上（nodeId 回退）| 同上 |
| `tests/panoramic/qa/rag-reranker.test.ts:216` | 同上；且 `uniqueNodeIds.size >= 1` 在 length≥2 前提下恒真 | 钉 length，`>=1` 改 `toBe(2)` |
| `tests/panoramic/product-ux-docs.test.ts:551` | `if (targetUsers.length>0)` + `if (dev && dev.description)` 两层 | 钉死 fixture 必产出 `开发者` |
| `tests/panoramic/product-ux-docs.test.ts:600` | `if (chineseEvidence.length>0)` 才验 nonChinese | 先断言 length>0 |
| `tests/unit/code-slice-extractor.test.ts:239` | `if (slices.length>0)` + `A \|\| B` 析取，双重放水 | 钉死 `slices.length===1` 且 `symbolName==='publicFunc'` |
| `tests/extraction/image-extractor.test.ts:276` | 注释直书「即使未调用（降级），测试也通过」| 前置 `expect(createMock).toHaveBeenCalled()` |
| `tests/panoramic/anchoring/chunker.test.ts:112` | `if (chunks.length>0)` 才验首 chunk startLine=1；上方 for 循环同样空转 | 先断言 `chunks.length === 2` |
| `tests/unit/batch-orchestrator-tsjs-resolve.test.ts:166` | `if (callSites!==undefined) expect(Array.isArray(...))`，两侧都恒真 | 删，或钉死 tree-sitter 路径下 callSites 必为数组 |
| ~~`src/panoramic/qa/__tests__/rag-reranker.test.ts:131`~~ | 与 `tests/panoramic/qa/` 副本重复 | **随 ① 删除该目录一并消失，无需单独处置** |

### B3 测试验证的是测试自己写的代码（3 条）

| 位置 | 说明 | 处置 |
|---|---|---|
| `tests/panoramic/community-persist.test.ts:40-50` | 注释「模拟 community.ts 的持久化逻辑」：测试自己写 `node.metadata['community']` 再断言字段存在 | 改调生产持久化函数；否则删 |
| `tests/panoramic/community-persist.test.ts:103-108` | 同上，外套 `if (community!==undefined)` 二次放水 | 同上 |
| `tests/unit/feature135-codex-followup.test.ts:103` | 「预写 adr-0001.md 后中和逻辑应保留原文件」全程未调用任何被测函数，只是 `writeFileSync` 后 `readFileSync` 断言等于自己刚写的内容 | 删或接上真实中和逻辑调用 |

### B4 数值恒真（5 条）

| 位置 | 说明 | 处置 |
|---|---|---|
| `tests/panoramic/html-exporter.test.ts:407` | `durationMs >= 0`，用例名就叫"大于等于 0" | 删，或断言字段类型 + 存在性 |
| `tests/panoramic/obsidian-exporter.test.ts:299` | 用例名写"大于 0"，断言写 `>= 0` | 收紧为 `> 0` 或删 |
| `tests/panoramic/qa/index.test.ts:190` | 同上 | 同上 |
| `tests/self-hosting/self-host.test.ts:62` | 注释「每个文件应有导出」，断言 `exports.length >= 0` | 改 `toBeGreaterThan(0)` |
| ~~`src/panoramic/qa/__tests__/index.test.ts:191`~~ | 与副本重复 | 随 ① 删除消失 |
| `tests/panoramic/qa/index.test.ts:185-191` | 整条 it「应包含 durationMs 字段（>= 0）」—— `>= 0` 对 number 恒真，且**同文件第 169 行 `expect(typeof result.durationMs).toBe('number')` 已覆盖存在性与类型** | **删除整条 it**（零覆盖损失）。⚠️ **不要收紧为 `> 0`**：全 mock 管线下 `Date.now() - t0` 确定性返回 0（批 A 实测连续 5 次全 0ms），收紧会造确定性红 |

> 说明：其余约 40 处 `toBeGreaterThanOrEqual(0)` 作用在 `indexOf()` 结果上（-1 会红），判**合理**，未列入。

### B5 `not.toThrow()` 但无 throw 路径（3 条）

| 位置 | 说明 | 处置 |
|---|---|---|
| `tests/panoramic/obsidian-exporter.test.ts:243` | `expect(() => page.content).not.toThrow()`；`buildGodNodePage` 已在 expect 之外执行完，闭包里只是属性读取 | 断言 `page.content` 的降级文案 |
| `tests/panoramic/html-exporter.test.ts:98` | `communityColor(0,1)` 纯 hsl 运算 | 断言返回色值 |
| `tests/panoramic/html-exporter.test.ts:102` | `communityColor(0,0)`，用例名说"回退处理"却不验回退值 | 断言回退色值 |

### B6 对静态 import 的对象做 `typeof === 'function'`（4 条坐标 / 4 文件）

tsc 已保证；`adapter` 是 `new XxxAdapter()` 静态构造、类型即 `LanguageAdapter`。

- `tests/adapters/java-adapter.test.ts:55-58`
- `tests/adapters/python-adapter.test.ts:65-68`
- `tests/adapters/go-adapter.test.ts:43-46`
- `tests/adapters/ts-js-adapter-equivalence.test.ts:111`

处置：整条 `it` 删除（同文件已有 `analyzeFile()` 真调用用例）。

> **对照（勿误删）**：`tests/panoramic/*-generator.test.ts` 里对 **dynamic import 的 barrel**
> 做 `typeof` 检查判**合理**（barrel 漏 re-export 会真红）。

### B7 用例名承诺 A、断言只验 B（5 条）

| 位置 | 名 vs 实 | 处置 |
|---|---|---|
| `tests/extraction/image-extractor.test.ts:161` | 名「节点 id 格式符合 `diagram:{相对路径}`」；断言 `toBeTruthy()` | 断言 `result.nodes[0].id` 匹配 `/^diagram:/` |
| `tests/extraction/image-extractor.test.ts:235` | 名「SVG 以文本方式处理（不跳过）」；断言 `toBeTruthy()` | 断言 nodes 非空且走文本分支 |
| `tests/extraction/extraction-pipeline.test.ts:168` | 名「Zod 验证失败的结果被丢弃」；断言 `toBeDefined()` | 断言 `result.results` 不含该 invalid node |
| `tests/panoramic/html-template.test.ts:96` | 名「options 正确合并默认值」；断言 `toBeTruthy()` | 断言默认阈值体现在输出 HTML |
| `tests/panoramic/qa/prompt-builder.test.ts:55` | 名「应返回 systemPrompt 和 userPrompt 字段」；两条 `toBeTruthy()` | 合并进下一条已有 `toContain('[来源：')` 的真断言 |

---

## A 类（移交后续卡，64 条）

> 每条都需要"`vi.mock` + 真调用"重写，属重新设计测试方式，不在本卡范围。
> **本节是移交清单，坐标已钉死，接卡者不需要重新扫描。**

| # | 文件 | 条数 | grep 的对象 | 建议改法 |
|---|---|---|---|---|
| A1 | `tests/unit/feature135-adr-guard-hyperedges-warning.test.ts` | 15（整文件）| `batch-project-docs.ts` / `batch-orchestrator.ts` / `parse-args.ts` / `batch.ts` 源码文本含 `enableAdr`、`--enable-adr` 等 | `parseArgs(['--enable-adr'])` 断返回值；`generateBatchProjectDocs({enableAdr:false})` 断 `docs/adr` 未产出。**最恶一条 L55**：用 `indexOf('if (options.enableAdr)') < indexOf('generateBatchAdrDocs(')` 比字符位置"证明"guard 包裹关系 |
| A2 | `tests/unit/feature135-codex-followup.test.ts` | 12 | `_PIPELINE_DISABLED.md`、`fs.existsSync(adrDir)`、`import fs from 'node:fs'` 等字面量 | L65「导入了 fs 和 path」是 tsc 已保证的事；L182 用 `lastIndexOf` 比位置证明"静默"。L153/162/167/173/182 合并为 1 条：mock logger + 捕获 stderr，跑 `runBatch` 断两条路径输出 |
| A3 | `tests/unit/mcp/agent-context-tools-snapshots.test.ts` | 10 | 读 `agent-context-tools.ts` 全文 `toContain('target:')` / `toContain('summary')` | L58/68 尤弱：裸子串在 800 行 TS 里必然命中，删光 handler 也绿。改跑真 handler 对 response 做 `Object.keys().sort()` 精确比对 |
| A4 | `tests/unit/batch-orchestrator-anchor-hyperedge-wiring.test.ts` | 9（整文件）| 正则匹配 `batch-orchestrator.ts` 的 import 与 `runAnchorIntegration(` 出现次数 | 文件头注释自认「真实 E2E 行为由 verification 阶段手动验证」= 承认不是守护。改 `vi.mock` doc-graph-builder 跑 `runBatch` 断集成函数被调用 + 参数 |
| A5 | `tests/unit/batch-orchestrator-reading-mode-wiring.test.ts` | 3（整文件）| 正则抠出 `READING_SKIP_IDS = new Set([...])` 字面量块再 toContain | 注释里已写明「改为 export const」——既已导出就该 `import { READING_SKIP_IDS }` 直接比集合 |
| A6 | `tests/unit/cli/helptext.test.ts` | 5（整文件）| 对 `src/cli/index.ts` 整文件 `not.toContain('无 LLM')` | 注释里写一句「无 LLM」就红，help 文本删光却可能绿。改 `runCli(['--help'])` 断 stdout（同仓 `cli-coldstart.test.ts` 已有 helper）|
| A7 | `tests/integration/graph-html-generation.test.ts` | 4（整文件）| `options.generateHtml ?? true`、`SMALL_GRAPH_THRESHOLD = 3` | `buildHtmlTemplate` 是纯函数，传 `nodeCount: 2/30` 直接验 banner。**与 ⑥ 联动**：该文件的 4 条 `it.todo` 同处 |
| A8 | `tests/integration/156-w1.2-v2.test.ts` | 2 | L144 名「解析失败的 .py 不进 module 节点」，实只 `content.includes('parseError')`；L205 `includes('DependencyGraph')===false` 验类型迁移 | L144 造语法错 .py fixture 跑 `buildModuleGraph`；L205 删（tsc 已保证）。**L97 判合理勿删**（分层约束）|
| A9 | `tests/e2e/feature-170a-spectra-spec-driver-integration.e2e.test.ts` | 2 | L102 `server.ts` 文本含 `registerAgentContextTools`；L118 读 dist 断 `toContain('impact')` | L118 近乎恒真（三个词在任意打包产物里必现）。改起 server 断 tool 列表。**L91 release-contract 版本钉死判合理**|
| A10 | `tests/unit/codex-home-scope-boundary.test.ts` | 2 | `toMatch(/path\.join\(\s*root,\s*'\.codex\/skills'/)` 断实现写法 | 同文件 L112 已示范用 `execFileSync` 真跑。**L83/L97 的 `not.toContain('CODEX_HOME')` 判合理勿删**（负向漂移守卫）|

---

## 明确判「合理」的（勿误删）

- **wrapper / SKILL.md 同步守护**：`plugins/spec-driver/tests/graph-consumption-*.test.mjs` 对
  `skills-codex/` 与 `.codex/skills/` 两份 wrapper 的 `includes(ADVISORY_COMMAND)`
- **release / schema 契约同步**：`fix-compliance-judge-cli.test.mjs:1588/2346/2571/2906`
  的「诊断码 ⊆ schema enum + 反向死码检查」；`feature-170a-*.e2e.test.ts:91` release-contract 版本钉死
- **分层 / 零 I-O / 无 import 架构守卫**：`module-derivation.test.ts:341`、
  `tasks-path-signal.test.mjs:228`、`spec-drift-no-llm-import.test.ts:151`、
  `156-w1.2-v2.test.ts:97`、`cli-coldstart.test.ts:110-119`
- **共享库复用合同**：`spec-driver-script-platform.test.ts:179-264`（7 组 import 来源 + 本地重复实现禁令）
- **反过拟合守卫**：`eval-entity-manifest.test.ts:81-88`（断言实现源码里**不含** manifest 实体名）
- **负向漂移守卫**：`codex-home-scope-boundary.test.ts:83/97`、
  `goal-loop-graph-consumption-integration.test.mjs:466`、`fix-compliance-judge-cli.test.mjs:1575`
- **正面样板**：`tests/unit/codex-runtime-doctor-redaction.test.ts:565-590` —— 自觉标注
  「静态信号非主判据 + 配套行为断言」，A 类改造时照抄这个结构
- 另抽查约 100 处 `not.toThrow()` / `expect(find(...)).toBeDefined()` 判合理
  （`find` 谓词有实义、被测函数确有 throw 路径）
