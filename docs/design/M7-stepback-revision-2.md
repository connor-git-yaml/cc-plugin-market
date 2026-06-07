---
title: M7 Step-Back 修订（第二轮）— F177/F178 ship 后增量审查 → F180 扩 scope + F181 新增
status: confirmed (用户 2026-06-07 拍板：F180 扩为系统性 stdio 补齐 / F181 紧随 F179、walker→M8 / 评测锚点入 F176、其余→M8)
created: 2026-06-07
source: workflow wf_ae80ea1c-3ec (14 agent / 1.1M tokens / 14.4 min — 3 调研 + 4 审查 + 7 对抗验证)
parent: M7-stepback-revision.md (第一轮 wf_3b106574-ce7)
supersedes: 第一轮 §1 F180 的 scope（本文 §2 给出完整新 scope，取代之）；第一轮其余内容（F177/F178/F179 规格、M8 roadmap、竞品 landscape）继续有效
verdict: F177/F178 ship 质量高（0 critical）；F180 scope 被严重低估（10 项 F180 外 stdio 缺口，含 F177 核心 AC 的真实 stdio 验证）；新增 F181 import-resolver 单一权威收口；M8 旗舰浮现 3 个必对标 prior art
decisions:
  - "F180 = 扩为系统性 stdio E2E 补齐（原 3 项 + F177 契约 high×2 + medium 6 项，~4-5d）"
  - "F181 (refactor) import-resolver 单一权威收口，紧随 F179（同根 graph 一致性）"
  - "walker 目录遍历统一 → defer M8（与 runBatch 拆分打包代码健康度专项）"
  - "评测锚点 RepoGraph/RANGER 入 F176 报告；aider PageRank/Conductor/analyze gate → M8"
执行顺序: F179 → F181 → F180 → F176（F177/F178 已 ship）
---

# M7 Step-Back 修订（第二轮）

第一轮 step-back（`M7-stepback-revision.md`，wf_3b106574）是在 F177-F180 **设计前**做的；本轮是在 **F177/F178 已 ship 之后**做的增量审查（基于真实落地代码），主要回答三件事：

1. F177/F178 的实现是否真的把第一轮的设计落地干净（无回归 / 无新债）？
2. F180 的 E2E scope 在 ship 后是否仍然完整？
3. 竞品/范式有无新进展，需要调整 F176/M8 方向？

5 个 research/audit agent → 7 项 critical/warning 进对抗验证。主线程综合判断 + 用户拍板见 §7。

---

## 0. 总结论

| 维度 | 第二轮结论 |
|------|-----------|
| **F177/F178 落地质量** | ✅ **0 critical**。F177 仅 2 warning（均判定不值得独立立项）、F178 仅 3 info。第一轮"统一契约 + 纯函数去重"的设计被干净落地，无功能回归 |
| **F180 E2E scope** | 🔴 **被严重低估**：13 个真实缺口里第一轮 F180 只覆盖 3，**10 项在 F180 之外**。根因是全套 E2E 存在系统性「in-process 直调 handler vs 真实 stdio 子进程」鸿沟，**F177 的核心 AC（telemetry 落盘 + `{code}` envelope）恰恰只有进程内验证** |
| **新增重构债** | 架构扫描经对抗验证确认 1 个新真实重构项（import-resolver 双实现收口，原报 critical 已降级纠正）；另发现 walker 重复（→M8）；runBatch 单体（已在第一轮 M8 defer，确认真实）|
| **战略方向** | ✅ M7 路线再获强背书：RepoGraph(ICLR2025) 插件式 +30%、RANGER/CGM/CodeRAG/PKG 共识「graph 检索 > 纯 embedding RAG」、Sourcegraph 7.0 押注「code intelligence as MCP layer」、VSDD 验证 spec-driver 方法论。M8 旗舰 spec-drift 浮现 3 个必对标 prior art |

---

## 1. F177 / F178 ship 后审查（落地质量确认）

### F177（统一 MCP 响应契约 + telemetry 装饰器）— 0 critical / 2 warning

两条 warning 经对抗验证均判定 **isReal=true 但 worthFeature=false**（不值得独立立项），处置如下：

| warning | 验证结论 | 处置 |
|---------|---------|------|
| `withTelemetry` handler 形参声明为 `(args: unknown)`，11 个被包裹工具（graph 6 + server 5）改用 `args as {...}` 手写强转，切断了 MCP SDK `zodRawShape` 重载对回调入参的 Zod 类型推断（tsc 实测：schema 字段改名后旧名强转零编译错误、运行期静默拿 undefined）| 真实但局限：1 处签名 + 两文件 11 个相邻调用点、无行为变化（运行期 Zod 仍校验）| **技术债记录**：下次动 `telemetry.ts` 时顺带恢复泛型推断（如 `withTelemetry<TArgs>`），或在 F180 补 MCP 层 E2E 期间一并修。不单独立项 |
| F177 新增的 `graph-query-failed` 错误码（`runGraphTool` 第二个 try/catch，engine 加载成功后查询期异常分支）在 `tests/` 下**零覆盖**（`response-contract.test.ts` 只覆盖 graph-not-built / invalid-input，从未驱动该 catch）| 真实未夸大 | **并入 F180**（F180 §2-#5 graph stdio 错误 envelope 用例顺带覆盖）|

### F178（抽取共享纯函数）— 0 critical/warning，仅 3 info

`string-distance.ts` / `graph-builder` upsert / `normalizeProjectPath` 合并三处抽取干净，对抗审查未发现行为漂移；新增 byte-stable / upsert / string-distance 单测覆盖充分。**无需任何后续动作。**

---

## 2. F180 修订 — 系统性 stdio E2E 补齐（完整新 scope，取代第一轮 §1 F180）

> 决策：用户拍板「扩为系统性 stdio 补齐」。下表是 F180 的**单一权威 scope**，取代第一轮 `M7-stepback-revision.md` §1 中的 F180 三项描述。

**核心问题**：现有 9 个 E2E 几乎全在进程内直调 handler（`handleViewFile` / `registerFileNavTools` / `runBatch` / `resolveSymbolFuzzy` …），**没有经过真实 stdio 子进程 + JSON-RPC**。这意味着 schema 序列化漂移、错误 envelope 真实成形、env 落盘链路、namespace 前缀路由、跨工具 symbolId 契约——全是盲区。F177 刚迁移的两套核心契约（telemetry 落盘 + `{code}` 错误 envelope）尤其只有 FakeMcpServer 进程内验证。

实现基座：全部复用 `tests/integration/mcp-server-stdio.test.ts` 现成 transport + micrograd baseline gate。

| # | 用例（命名遵循「用户故事: …」）| 优先级 | 来源 |
|---|------|--------|------|
| 1 | graph 6 工具各 1 条 `client.callTool` 子进程用例（schema/序列化漂移）| high | 第一轮 |
| 2 | 工具链 chain：micrograd baseline 上 `detect_changes→impact→context→view_file` 全程真实 symbolId 透传，断言 `view_file` lineRange 与 `context` 一致（跨工具 symbolId 格式契约）| high | 第一轮 |
| 3 | symlink stdio：`view_file('../../../etc/passwd')` + tempRoot 内指向外的 symlink → `path-outside-root`（子进程 cwd/projectRoot 解析与 in-process 不同，W-4 暴露过）| high | 第一轮 |
| 4 | **F177 telemetry 真实 stdio 落盘**：子进程设 `SPECTRA_MCP_TELEMETRY_PATH` + `SPECTRA_MCP_RUN_ID`，`callTool` 后读 JSONL，断言恰写 1 行 + `toolName/runId/durationMs/requestSize/responseSize` 正确、错误调用含 `errorCode` | **high** | 第二轮（验 F177 AC-2/AC-3）|
| 5 | **F177 server 5 工具 stdio 错误 envelope**：`prepare/generate/batch/diff/panoramic-query` 对失败入参断言返回统一 `{code}`（internal-error/invalid-input）+ `isError=true` + 不泄露绝对路径/stack；**顺带覆盖 graph-query-failed**（F177 warning #2）| **high** | 第二轮（验 F177 `{code}` 迁移）|
| 6 | panoramic-query 4 operation stdio（cross-package/architecture-ir/overview/natural-language）：natural-language 缺 question 报 invalid-input、非 monorepo 报 invalid-input、成功返回 data（唯一多态工具零 e2e）| medium | 第二轮 |
| 7 | file-nav 3 工具 stdio（view_file 行段切片省 token + symbolId→lineRange + 越界拒绝在 JSON-RPC 链路成立；171 全 in-process）| medium | 第二轮 |
| 8 | `client.listTools()` 断言恰 **18** 工具集合，且各 `inputSchema`（必填/enum/默认）经 SDK 暴露与源码 Zod 一致（合并第一轮「tools/list ≥12→精确工具集」）| medium | 第二轮+第一轮 |
| 9 | batch 工具 MCP 路径：传 incremental/full/force 冲突组合，断言 `resolveRegenPlan` 在 MCP 路径正确解析（full 逃生口绕 cache）+ 返回 deltaReport + config fallback 合并（175 全 in-process 直调 runBatch）| medium | 第二轮 |
| 10 | 子代理 namespace 路由：带 `mcp__plugin_spectra_spectra__impact` 前缀经 stdio callTool，断言正确路由到底层 impact handler（170a 仅文件断言 frontmatter，无真实调用）| medium | 第二轮 |
| 11 | F174 fuzzy 经 stdio 端到端：传模糊 symbol（无 path 简短名 / typo / path-suffix）调 context/impact，断言 fuzzy resolve 在进程边界生效（warnings 含 fuzzy-resolved、resolvedFrom/resolvedTo 透传；174 全 mock + in-process）| medium | 第二轮 |
| 12 | full batch reproducibility（同 commit 两次 full → 归一化 deepEqual）| medium | 第一轮 |
| 13 | F170d driver preference sandbox 决策代理（stub driver 把"引导→选择"拉进 CI，真实 LLM 仍走 HOST_E2E）| low→可选 | 第一轮 |

**defer 到 M8**（low，非 stdio 系统补齐核心）：graph.json stale 自动失效（外部覆盖后 re-callTool 拿新图）、超大 payload 截断（PAYLOAD_CAP_BYTES + payload-truncated/too-large 在 JSON-RPC 下成立）。

**估时**：2-3d → **4-5d**（scope 从 3 项扩到 ~12 项；但 #1-3 与 #4-11 共用 transport + baseline，边际成本递减）。

---

## 3. F181（新增，refactor）— import-resolver 单一权威收口（紧随 F179）

> 决策：用户拍板「F181 紧随 F179」。两者同根（都关 graph 一致性 / import 链），F181 在 F179 byte-stable 闭合后立即做。

### 问题（架构扫描 critical → 对抗验证降级纠正）

`src/` 内存在两个同名 `resolveTsJsImport` 且行为分叉：

| 实现 | 返回 | 边界守卫 | 消费方 |
|------|------|---------|--------|
| `core/import-resolver.ts:115` | `string \| null`（绝对路径，处理 tsconfig path-alias + baseUrl）| ❌ 无 `isInsideProjectRoot` | AST 路径：`ast-analyzer.ts:417/458`、`tree-sitter-analyzer.ts:318`、`tree-sitter-fallback.ts:128/261`（均 import `./import-resolver.js`）|
| `knowledge-graph/import-resolver.ts:344` | `ResolveResult`（相对 POSIX 路径 + kind）| ✅ 强制 `isInsideProjectRoot` 防图污染 | batch 路径：`batch-orchestrator` → `collectTsJsCodeSkeletons`（import `../knowledge-graph/import-resolver`）|

### 🔴 对抗验证的两处关键纠正（执行 F181 时必须遵守）

1. **严重度降级**：原报"同一 import 在两路径解析出不同结果、直接威胁 graph.json 一致性"为 critical，**不成立**。实测：batch 唯一 kg 消费方 `collectTsJsCodeSkeletons` 里，`adapter.analyzeFile` 先用 core 解析，相对 import 已得绝对路径非空后 `if (imp.resolvedPath) return imp` 短路，**kg resolver 仅对 core 留空的 alias/baseUrl 兜底**——同一 graph 构建中每条 import 只由一个 resolver 解析，不存在双解析冲突。→ 这是**消除重复实现的可维护性 refactor，不是 graph 一致性 fix**。
2. **删除清单纠正**：原建议"删除 core 的 resolveTsJsImport/detectImportType/resolveImportsForFile（外部零消费）"，**严重错误**。实测：
   - `core/resolveTsJsImport` 有 **4 处生产消费（不可删）**
   - `core/resolveImportsForFile` 是**真死代码**（可删）
   - `core/detectImportType` 仅**文档注释引用**（确认无代码引用后可删）

### 方案

- 收口为**单一权威 resolver**：统一返回类型为 kg 的 `ResolveResult`（含 kind + projectRoot 边界守卫），把 core 三个 AST 消费方迁移到统一实现
- 删除确认的死代码：`resolveImportsForFile`（+ grep 全仓含 tests 确认后 `detectImportType`）；**保留 `resolveTsJsImport` 的核心解析能力**（path-alias + baseUrl 逻辑并入统一实现）
- 加**跨路径一致性测试**：同一 fixture 经 AST 路径与 batch 路径解析结果 byte-equal
- 验收守回归：跑 graph-accuracy baseline diff，确认收口后 graph.json 与收口前 byte-identical（复用 F179 的 byte-stable gate）

**估时**：~1.5-2d（多文件合约变更 refactor，非顺手 fix）。**Mode**: spec-driver-refactor（残留扫描阶段正好扫两套 resolver 全部调用点）。

---

## 4. F176 报告锚点增补（纯文案，零工程）

在第一轮 §2 的 6 处报告增强基础上，再加 2 条外部学术/业界锚点（来自第二轮调研，均标 internal-cohort-only 不声称绝对可比）：

| 增补 | 内容 | 来源 |
|------|------|------|
| RepoGraph 评测范式 | 引用 **RepoGraph (ICLR 2025)**「把 repo graph 作为可插拔 retrieval 模块插入 Agentless/SWE-agent，SWE-bench 平均 ~+30% 相对 success rate」作为「图上下文 vs 无图」的学术锚点——这正是 F176 cohort 对比（spec-driver-spectra-mcp vs baseline）在做的事，给 lift 数字一个外部范式背书 | spectra/emerging research |
| graph-RAG 共识背书 | 引用 **RANGER（graph+MCTS 检索）/ CGM（Alibaba，graph 注入 attention）/ CodeRAG（EMNLP 2025）/ PKG** 形成的「跨文件依赖任务上 graph 检索系统性超过纯 embedding RAG」共识，作为 Spectra 知识图谱路线的外部佐证 | emerging research |

> 注：第一轮已有的 Augment 70.6% / Anthropic -98.7% token / Serena peer 对比 / drift 定性栏 / Codex review 升级 / leakage 背景 6 处增强**继续有效**，本节是叠加。

---

## 5. M8 roadmap 增补（基于第二轮调研）

> 第一轮 `M7-stepback-revision.md` §3 的 M8 roadmap 继续有效，本节叠加新发现。

### 🚩 M8 旗舰 spec-drift detection — 3 个必对标 prior art（立项前必须吃透）

第二轮调研把旗舰从"概念"推进到"有明确 prior art 可对标"——立项时必须先吃透这三个，避免重造轮子并据此找差异化：

| prior art | 路线 | 对 M8 旗舰的意义 |
|-----------|------|----------------|
| **Fiberplane Drift**（开源 CLI）| tree-sitter AST 指纹 + git provenance，**点锚**（symbol 变即标 stale，入 CI）| 机制几乎重叠的**直接 prior art**；把 `drift.lock` schema + anchor 格式作为兼容性参考甚至 baseline 对照 |
| **Dusk Pituitary**（开源 Go）| 全 repo 矛盾 lint + MCP 暴露，**全仓**路线 | 与 Fiberplane 形成「点锚 vs 全仓」两条路线选择；与我们既有 MCP/panoramic 基建天然契合 |
| **OpenLore**（2026 新兴）| 代码库知识图 + OpenSpec 活规范 + drift 三态 | 给出「spec 实体映射到代码图节点 + drift 三态 + 图查询」的完整架构蓝图——**与 Spectra「既有图又有 spec」的独有资产最契合** |

**立项弹药**：
- **Meta 生产 coding-agent 误行为分类法**（2025-2026）给出 **Specification Drift ~30%** 的量化数据，可直接在 M8 spec.md 引用作为问题规模证据
- **AGENTbench (ETH Zurich, 138 真实任务)**：LLM 生成的 AGENTS.md/CLAUDE.md 上下文文件反而 -3%/+20%，给出 M8 反例边界——drift 检测应服务于「让 spec/context 保持精简且真实」而非自动生成更多内容（非目标）

### M8 新增候选（从 yes-m7 下沉 + yes-m8）

| 候选 | 内容 | 来源 |
|------|------|------|
| **walker 目录遍历统一**（refactor）| 抽取统一 walkDir helper（基于/扩展 `src/utils/file-scanner.ts` 权威实现），batch 3 walker（collectMdRecursive/walkPyFiles/walkTsJsFiles）+ panoramic walk*Files 共 17+ 调用点迁移，消除三套分叉的硬编码 ignore-dir。参数化：扩展名谓词 / ignore 来源（优先 `LanguageAdapterRegistry.getDefaultIgnoreDirs`）/ size-guard / 单文件失败回调。**与 runBatch 拆分打包成「batch 代码健康度专项」**| 架构扫描（对抗验证确认真实）|
| aider personalized PageRank（feature）| `god_nodes`/`graph_query` 引入「按查询上下文加权」的 personalization 参数，中心性排序随当前任务动态偏置（aider 已验证范式）。算法层小改、收益明确，但改 graph 引擎需独立 spec | spectra research |
| Spec Kit `/speckit.analyze` gate（feature）| implement 前对 spec+plan+tasks 做只读跨制品一致性检查（conflict/ambiguity/duplication/underspecification/coverage gap + orphan task/需求），插进 tasks→implement 之间作为新 gate，复用 orchestration.yaml gate 机制 | sdd research（Spec Kit 0.9.5）|
| VSDD traceability + 硬 gate（feature）| 把 codex 对抗审查 critical 升级为可配置硬阻塞 gate（复用 gate severity/hard_gate_modes）+ traceability 检查（diff 文件↔spec id 回链 + orphan 检测，与 analyze gate 合并实现）| sdd research |
| Conductor 条件路由（feature）| orchestration 引擎吸收「条件路由表达式（首个匹配胜出）+ script/human_gate 一等节点 + effective config 可视化」，渐进增强既有 orchestration-schema/resolver/CLI | sdd research（Microsoft Conductor）|
| Codanna RRF 混合检索（feature）| Reciprocal Rank Fusion 融合 FTS + 向量 + 图连通性 rerank，提升 search_in_file/context 检索精度 | spectra research |
| Augment 时间维度上下文（feature）| git commit 历史 + LLM diff 摘要纳入图（节点/边挂 commit 元数据 / 新增 temporal 查询），复用 detect_changes/diff 基建，从空间图扩展到时空图 | spectra research |
| live watching 增量索引（feature）| detect_changes 借鉴 chokidar 式 watch 触发增量重建而非全量 prepare | spectra research（Codanna/CodeGraphContext）|

### 战略观察项（watch，不立项但影响定位叙事）

- **Cline / Continue.dev 的 no-index 路线**（Continue 已 deprecated @Codebase）：随 context window 变大 + tool-calling 变强，预索引边际收益在简单场景下降。Spectra 反论点须立住——把图能力集中投放在「全局/跨包/blast-radius」这类 tool-driven 顺藤摸瓜打不过的硬场景，简单场景不强推重型图查询（呼应主线「保留 AST-only 静默降级」）。
- **Serena long-lived memory + 安全编辑原语**：Spectra 是否从只读理解工具进入「图引导的安全编辑」是 M8+ 战略岔路口，先观察 Serena 成熟度。

---

## 6. 修订后 M7 执行顺序与时间线

```
✅ 已 ship: F170a-e + F171 + F174 + F175 + F177 + F178

🟡 M7 收尾（剩余 4 项，串行为主）
   F179  graph.json 真 byte-stable + eval 一致性          (1d)
   F181  import-resolver 单一权威收口                      (1.5-2d)  ← 紧随 F179（同根 graph 一致性）
   F180  系统性 stdio E2E 补齐                             (4-5d)    ← scope 从 3 项扩到 ~12 项
   F176  SWE-Bench Verified 5-cohort + 报告锚点(RepoGraph/RANGER)  (11d)

合计 M7 收尾 ~7.5-9 工程日 + F176 11d
```

**依赖与并行**：
- F179 → F181 **串行**（F181 收口后须复用 F179 的 byte-stable gate 守回归；同碰 graph 一致性链）
- F180 在 F179+F181 之后（E2E 要验证收口/byte-stable 修复后的稳定行为，避免测到中间态）
- F176 最后（需 F177 telemetry 全覆盖 + F180 stdio 验证过的稳定 MCP 层）
- F181 与 F180 写入路径不同（resolver/AST 链 vs tests/），理论可并行，但 F180 #1-3 graph stdio 用例会读 graph.json，建议 F181 先 ship 以测稳定产物

---

## 7. 决策记录（用户 2026-06-07 拍板）

| 决策点 | workflow 发现 | 用户拍板 |
|--------|-------------|---------|
| **F180 scope** | 13 缺口，F180 原只覆盖 3，10 项在外（含 2 项 high 直接验 F177 核心 AC）| ✅ **扩为系统性 stdio 补齐**（原 3 + high×2 + medium 6，~4-5d）|
| **架构重构排期** | import-resolver 收口（critical→降级）+ walker 统一（17+ 调用点）两项真实 | ✅ **F181 import-resolver 紧随 F179；walker → M8** |
| **调研吸收归属** | yes-m7 6 项（多数实为报告锚点或需改生产代码）| ✅ **评测锚点(RepoGraph/RANGER) 入 F176；aider PageRank/Conductor/analyze gate → M8** |

**对抗验证的价值兑现**（本轮记录，供后续 step-back 复用方法论）：
- arch agent 报的 import-resolver **critical 被降级**为可维护性 refactor（实测短路逻辑使无双解析冲突）
- arch agent 报的「core/import-resolver 整文件死代码」warning **被直接证伪**（resolveTsJsImport 有 3 处生产消费）
- F177 两条 warning 经验证**均判定不值得独立立项**（避免为无行为变化的小债开 feature）

→ 若无对抗验证这一层，F181 极可能按错误删除清单删掉在用的 `resolveTsJsImport`，引入真实回归。这是「关键取舍在主线程收口、执行可分发」原则的又一次兑现。
