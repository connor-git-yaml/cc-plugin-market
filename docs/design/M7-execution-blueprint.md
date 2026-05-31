---
title: M7 执行蓝图 — 剩余 Feature 设计 + 已 ship 对抗审查
status: active
created: 2026-05-30
source: workflow wf_00c688f4-3b9 (7 agent / 1.68M tokens / 26 min)
parent: milestone-M7-spectra-mcp-productization.md
decisions:
  - "1.A 新增 F170b 优先闭合 F170a CRITICAL (npm publish + 测试 gate + namespace guard)"
  - "2 蓝图落文档 + push origin master"
  - "3.A F176 GStack 找/装真正工作流框架"
---

# M7 执行蓝图

本文档是 workflow `wf_00c688f4-3b9` 的产出沉淀：4 个剩余 Feature (F171/F174/F175/F176) 的实现蓝图 + 3 个已 ship Feature (F170a/F170c/F170d) 的对抗审查结论。供后续每个 spec-driver feature 启动时直接引用，避免重复设计。

主线程综合判断在 §6。

---

## 0. 关键发现 — F170a 有真实 CRITICAL（已 verify）

| 问题 | 真相（已 verify） | 连锁影响 |
|------|------------------|---------|
| Bug-1 npm publish 未执行 | `npm view spectra-cli` 只有 `4.1.1`，`dist-tags.latest=4.1.1`，4.2.0 从未发布 | 用户 `npm i -g spectra-cli` 拿到缺 Feature 155 工具(impact/context/detect_changes)的旧 binary |
| publish 被 gate block | `prepublishOnly` 跑 `vitest`，存在预存失败测试 | "host shell 一条命令 publish" 不成立，需先修测试 gate |
| F170a verification over-claim | US-1 标 ✅ 仅凭"本地版本号 + dist 文件存在" | 真实标准是"已发布 binary 含工具"，本地版本号 ≠ 已发布 |

**威胁范围**：F171/174/175/176 所有"用户全局装 spectra 后 sub-agent 调 MCP"的验收，生产环境都建在 4.1.1 缺工具的 binary 上 —— 纸面绿、真机哑。**故新增 F170b 作为 M7 剩余路线的前置 gate（决策 1.A）。**

---

## 1. 新增 Feature 170b — 闭合 F170a CRITICAL（前置 gate）

**Mode**: spec-driver-fix（4 阶段）
**预算**: ~2-3 天 + npm publish 权限
**目标**: 把 F170a 的 npm publish CRITICAL 真正闭合，并补 namespace guard + 修 E2E always-green 逃逸。

### Phase 1: 查清 + 修 prepublishOnly 测试 gate
- 诊断"预存失败测试"真相：是 worktree 环境特有（tree-sitter WASM 限制）还是真 bug
- 若 worktree 特有 → 在 CI/干净环境跑应 pass，确认后可 publish
- 若真 bug → 先修复
- 决策：prepublishOnly 是否需放宽（如仅跑核心测试子集）或修复全部失败

### Phase 2: 真正 npm publish spectra-cli@4.2.0
- `npm publish` 后 `npm view spectra-cli versions` 确认含 4.2.0
- 验证 `npm i -g spectra-cli@4.2.0` 后 `spectra mcp-server` tools/list 含 impact/context/detect_changes

### Phase 3: 补 namespace 派生 guard（防 F162→170a 故障模式重演）
- repo:check 加一条：从 plugin.json name + .mcp.json server key 派生期望 namespace，校验 5 个 agent frontmatter 一致
- 把"人工拼对字符串"变成"从单一源派生 + 守护"

### Phase 4: 修 E2E always-green 逃逸
- 去掉 feature-170a E2E 第 186 行的 `if (!existsSync) return` early-return
- namespace 期望值从硬编码常量改为从 plugin.json + .mcp.json 派生

### E2E（M7 强制）
- 用户故事: npm registry 发布后 `npm i -g spectra-cli@4.2.0` 暴露 3 个 agent-context tools
- 用户故事: namespace guard 在 frontmatter 与 plugin 配置不一致时 fail-loud
- 用户故事: E2E 在文件缺失时 fail 而非 silent pass

---

## 2. Feature 171 — File Navigation MCP Tools（估时 5 天）

**Goal**: 为 Spectra MCP server 补齐 3 个对标 SWE-Agent/OpenHands 的文件导航工具 (view_file / search_in_file / list_directory)，让 driver 按 line range / pattern / 目录看文件（省 token）。

**Approach**: 新建独立模块 `src/mcp/file-nav-tools.ts`(registerFileNavTools)，完整复刻 agent-context-tools.ts 约定（ToolResult envelope / buildErrorResponse / PAYLOAD_CAP 截断 / Feature 158 telemetry）。纯计算逻辑抽到 `src/mcp/lib/file-nav-helpers.ts`（对标 response-helpers.ts，便于 95% 单测）。

3 个工具：
- `view_file(path, startLine?, endLine?, symbolId?)` → 带行号切片 + totalLines + 截断标志
- `search_in_file(path, pattern, isRegex?, maxMatches?, contextLines?)` → {line, text, before/after} 匹配列表
- `list_directory(path, depth?, includeHidden?)` → entries[{name,type,size}]

**核心风险**:
- 🔴 **路径安全是 LFI 漏洞红线**：仅 path.resolve + startsWith 不足以防 symlink 逃逸，必须 realpathSync 后校验在 projectRoot 内；越界返回 `path-outside-root`
- token 减少 ≥50% 的 E2E 在 sandbox 无真实 LLM，只能用 byte/estimateTokens 代理断言；真实对比需 HOST_E2E gate（对标 F170d）默认 skip
- search_in_file 用户正则 ReDoS → try/catch + maxMatches clamp
- telemetry recordAndReturn 跨模块复用需导出（与 F170c 同样漂移问题）

**关键 E2E 用户故事**:
- driver 用 view_file 按 line range 看文件 → token ≤ 全文 Read 的 50%
- driver 调 context 拿 symbol 后 view_file(symbolId) 直接定位定义行段
- driver 传越界路径 (../../etc/passwd) → 拒绝且不泄露 projectRoot 外内容
- 工具 description 满足 F170c 4 要素

**openQuestions**:
- list_directory 默认是否过滤 node_modules/dist？（SWE-Bench scaffolding 需看到三方代码，建议默认仅过滤 .git + includeIgnored 开关）
- view_file 是否写进 F170d preference-rules.md（R5 行）
- 是否 bump 版本 + 更新 server.ts "注册 N 工具" 注释
- view_file 无定位参数时默认行为（建议前 200 行 + truncated 标志，对标 OpenHands）

---

## 3. Feature 174 — Symbol ID Fuzzy Match（估时 4 天）

**Goal**: 把 impact/context 的 symbol id 解析从"严格匹配失败即 symbol-not-found"升级为"严格 + 分层 fuzzy（路径后缀/部分名/Levenshtein typo）+ 高置信度自动 resolve + top-3 候选"，把 F165 cohort C symbol-not-found 错误率 1/9 → 0。

**Approach**: 核心改动集中在 `src/knowledge-graph/query-helpers.ts`，新增纯函数 `resolveSymbolFuzzy(graphData, query, opts)`，分 4 层（命中即不降级）：
- (a) exact = 复用 canonicalizeSymbolId（confidence 1.0）
- (b) path-suffix：`engine.py::Value.relu` vs `micrograd/engine.py::Value.relu`（~0.9）
- (c) partial-name：`Value.__add__` / `relu`（0.7~0.85）
- (d) Levenshtein typo：`egnine.py` 拼写（0.5~0.75，DP 滚动数组，照搬 adr-evidence-verifier.ts:168 实现）

handler 接线：canonicalize not-found 时调 resolveSymbolFuzzy；autoResolved（唯一 ≥0.9 候选）→ 用该 id 继续 + warning `fuzzy-resolved`；否则返回结构化 fuzzyMatches top-3。

**核心风险**:
- 误自动 resolve：partial-name `relu` 多 module 同名误判 → autoResolved 仅唯一候选 + confidence ≥0.9 触发
- 🔴 **向后兼容 breaking**：`fuzzyMatches: string[]` → `Array<{id,confidence,matchKind}>` 破坏现有 C-102/C-206 单测 → 同 PR 更新
- E2E 文件命名：必须 `.e2e.test.ts` 后缀（vitest e2e project 只 include 该后缀，M7 doc 写的 .test.ts 跑不进）

**关键 E2E 用户故事**:
- driver 写 `Value.__add__`（无 path）→ fuzzy 唯一命中自动 resolve
- 4 变体（无 path/无 method/绝对路径/typo）≥ 3 个 resolve 正确
- F165 cohort C symbol 样本 → symbol-not-found 比例 0/9
- 完全不存在 symbol → 安全报错 + top-3 结构化候选

**openQuestions**:
- autoResolved 阈值 confidence ≥0.9 唯一候选是否接受？还是仅 exact + path-suffix 自动 resolve
- fuzzyMatches breaking change 是改旧测试还是另加 fuzzyCandidates 新字段
- top-N 候选数：M7 doc 写 3，现 handler 调 5，统一哪个
- E2E fixture symbol 样本来源（F165 无 captured JSON，用合成 micrograd 图还是补真实样本）
- fuzzy 是否接入 detect_changes（当前 symbol 来自 graph 内部不经 canonicalize，建议范围仅 impact/context）

---

## 4. Feature 175 — Batch Incremental Wrapper（估时 5 天）

**Goal**: 让 spectra batch 默认走增量（改 1 文件 < 5 min、无改动 cache hit < 30 sec），保留显式全量，增量产物与全量 byte-stable。

**🔑 关键发现（workflow 揭示的真实架构）**: 仓库里"增量"有两层且彼此未打通：
1. F156 `buildIncremental`(incremental.ts) 只增量重建 UnifiedGraph snapshot，**仅接 `spectra index` CLI，从未进 batch**
2. `runBatch` 已有 incremental 选项 + DeltaRegenerator（按 skeleton-hash 跳过未变 *.spec.md），但**非默认**，且 runBatch 内部做了 **3 次全量 AST 重扫**（buildModuleGraphForProject + collectPython/TsJsCodeSkeletons），完全不复用 F156 snapshot

因此 F175 要做 4 件事（而非"接一个新功能"）：
- A) batch 默认翻转为 incremental（CLI/MCP/config 三入口）—— DeltaRegenerator 已能跳过未变模块，直接拿下 cache-hit<30s + 改1文件<5min 主要收益
- B) 化解命名冲突：现 `mode`=BatchMode(full|reading|code-only) 是质量维度，与 M7 的 mode:incremental|full 正交 → 新增独立 regen 轴（`--full`/`--no-incremental`），**不污染 mode**
- C) incremental 路径复用 F156 snapshot 替代重复全量 AST 扫描（P2，正确性风险高）
- D) byte-stable：跳过的 spec 不被改写；风险在聚合层 generatedAt 时间戳 + graph 节点排序 → 归一化

**核心风险**:
- 🔴 **命名冲突高危**：直接把 'incremental' 塞进 mode 枚举会破坏 baseline-collect.mjs / MCP enum / parse-args
- 默认翻转兼容性：baseline-collect / eval / CI 行为改变，基线采集应显式 --full
- byte-stable 真实风险在聚合层（SnapshotWrapper.generatedAt / graph metadata / 非确定排序），M7 验收写 byte-diff ≤ 10 nodes 容差
- F156 snapshot 复用扫描口径差异（includeOnly /^src/ + tsconfig alias）→ 建议 P2 单独验证

**关键 E2E 用户故事**:
- 改 1 src 文件 → 仅重生成受影响模块 spec，未改模块 cache，wall 远低于全量
- 无改动再跑 → 全 cache hit，generateSpec 调用 0 次
- full vs (无改动)incremental 产物 byte-stable
- 显式 --full → 强制全量忽略 cache

**openQuestions**:
- regen 轴 CLI 命名：`--full` 还是 `--no-incremental`
- MCP batch tool incremental 默认翻 true 是否可接受（影响 SWE-Bench cohort 3）
- byte-stable 验收口径：严格 deepEqual（剥时间戳）还是 ≤10 nodes 容差
- 是否本 Feature 接入 F156 snapshot 复用（收益大但正确性风险高，建议拆 P2）
- baseline-collect / eval 是否同步加 --full 保证性能基线不被 cache 污染

---

## 5. Feature 176 — SWE-Bench Verified 5-cohort 横向对比（估时 11 天，M7 最终交付）

**Goal**: 在 SWE-Bench Verified 10-task 子集上以统一 scaffolding 横向对比 5 cohort，产出可与业界官方 Verified 数字并列的产品级 lift 报告。

**Approach**: 复用 Lite 设施、换数据集 + cohort 维度从 group(A/B/C) 泛化为 5-cohort tool 维度。新建 `scripts/eval-verified-cohorts.mjs`：
- 从 `tests/baseline/swe-bench-verified/fixtures/`（扩展 import 脚本生成 Verified split）加载 task
- 复用 prepareWorktree/runPrimaryOracle/captureProductMetrics
- cohort3(spec-driver-spectra-mcp) 注入临时 .mcp.json + 预建 graph + F170d 引导块
- SuperPowers/GStack 用 --plugin-dir
- 复用 eval-quota-store + parse-claude-stream-json
- driver=opus-4-7, stream-json, N=3
- 新建 verify-feature-176.mjs（泛化 verify-169 到 5-cohort）

**核心风险**:
- 🔴 **cohort3 lift 不达 1.5× 高概率**：F170c 实测 driver 0% 主动调 MCP，F170d guided 仅 50% → cohort3 即使引导也可能 lift<1.5×，直接威胁 M7-SC-006。缓解：强制 protocol(MUST-call) + F170d 引导块双管齐下 + spec 写 falsification path
- 🔴 **GStack 本机不是工作流框架**（已 verify：~/.claude/skills/gstack 是 QA browser skill）→ **决策 3.A：找/装真正的 GStack 工作流框架**
- SuperPowers --plugin-dir 路径漂移（findSuperPowersDir 找空目录 ~/.claude/plugins/installed/，实际在 ~/.claude/plugins/local/superpowers）→ wrapper 显式参数化 + preflight 断言
- 训练集泄漏 + oracle 口径：Verified goldPatch 可能在训练集内 → baseline 虚高；本设施用 ast-diff fuzzy(threshold 60) 非真实 failToPass/passToPass → 报告显式声明口径差异
- 150 runs 配额：opus driver 订阅边际 $0 但占 30-50% weekly；jury(SiliconFlow) 实付可能 $30-50

**关键 E2E 用户故事**:
- 5 cohort × 1 task × N=1 smoke → 5/5 finalize + cohort3 mcpToolCallCount>0
- 全量 150 runs → verify 算 cohort3/cohort1 lift（≥1.5 PASS / <1.5 FAIL+caveat）
- cohort3 vs SuperPowers/GStack aggregate ranking + fixture-level 互有胜负
- stop-loss 触发 → 优雅落 partial，verify 不 hard-fail

**openQuestions（F176 最关键产出，需用户拍板）**:
1. **GStack 接入**（决策 3.A：找/装真正工作流框架）—— 需确认 GStack 工作流框架来源 + plugin-dir 路径
2. SWE-Bench Verified 10-task 怎么选：repo 沿用 Lite 的 sympy/astropy/pytest（省 clone）还是扩 django/scikit-learn（需新 clone + build graph）？是否优先官方报告点名 pass 的 instance？
3. cohort3 用强制 protocol(MUST-call) 还是 F170d SHOULD 引导块？还是叠加？
4. Verified oracle：升级真实 failToPass/passToPass 测试 suite（贴官方但环境复杂）还是保 fuzzy + 声明口径差异？
5. 150 runs 是否跑 3-judge jury（功能 oracle 已是 SWE-Bench 标准，jury 是质量分产物，省 $30-50 vs 加质量维度）？
6. driver 锁 opus-4-7 还是允许升级（Lite 4 boundary task 暴露 ceiling）？
7. 报告形态：新建 PUBLISH-REPORT-M7.md + Lite §11 交叉引用，还是合并？
8. N=3 是否够 5-cohort ranking（per-cell ±1 pass 整票漂移）？关键 cohort(1 vs 3) 是否加 N？

---

## 6. 对抗审查结论（已 ship Feature）

### F170a — needs-fix（1 CRITICAL）
- **CRITICAL**: npm 4.2.0 未发布（见 §0，已 verify），US-1 验收 over-claim → **F170b 闭合**
- WARNING: customization.md fork namespace 连字符可能被 sanitize（应警告"从 logs 抄真实 tool 名"）
- WARNING: 5 agent frontmatter 硬编码 `mcp__plugin_spectra_spectra__*` 无 guard → CC 改前缀规则会静默全失效 → **F170b Phase 3 补 guard**
- WARNING: E2E always-green 逃逸（186 行 early-return）+ 循环论证（断言自己拍的常量）→ **F170b Phase 4 修**
- 回归风险：**中** — npm 未发布 + namespace 无 guard 是贯穿 F171/174/175/176 的 latent risk

### F170c — pass（5 info）
- response-helpers.ts branch 覆盖 **64.86% < 80% 门槛**（empty-list hint 分支盲点）→ **F171 动 generateNextStepHint 前必补**
- buildTopImpactedRanking depth=0 无防护（1/0=Infinity→null）；undefined-id 泄露进 hint；unknown-toolName 静默 fall-through（均非线上可触发，防御性加固）
- verification SC-005 over-claim：声称"9 子项全 PASS"实际 8 项（e deferred）+ 计数 9/9 实为 12/12
- 回归风险：**低** — 新字段全 optional，无 wire-level schema，无 aliasing。**共性建议：后续动 response-helpers 前先补 branch 覆盖回 80%**

### F170d — pass（2 warning + 6 info）
- SC-002 80% **不是 overclaim**（算术自洽，attempt=resolved=8/10 说明 driver 主动选择），但"prompt 引导导致 80%"因果未隔离（prompt 驱动 attempt vs --strict-mcp-config 驱动 resolve 叠加）
- **WARNING**: Primary 证据 JSON 被 gitignore 无法复核（建议作为一次性 verification artifact 入库或嵌报告附录）
- **WARNING**: --strict-mcp-config 因果未隔离 + 反事实证据已永久丢失（mcpCalls=0 真正机制至今未确证，是"加固非确认修复"）
- SC-009 over-call 0/6 真 PASS 但测试目标偏软（negative-control 关键词零重叠，未压测"语义接近但不该触发"边界）
- single-source template 守护实测稳固（改 template 立即漂移 fail，repo:check 双向守护）
- 回归风险：**中低** — **F176 cohort 3 不能直接依赖 80% 数字做强决策**（N=10 小样本 + task 分布敏感 + 因果未隔离）；spec 已预埋分支（fail 时用强制 protocol）

---

## 7. 推荐执行顺序

```
🔴 第 0 步 — F170b（前置 gate，~2-3 天）
   闭合 F170a CRITICAL：修测试 gate + npm publish 4.2.0 + namespace guard + 修 E2E
   ↓
🟡 第 1 步 — 能力 Feature（可多 worktree 并行）
   F171 file-nav (5d) ┐  写入路径 disjoint
   F174 fuzzy (4d)     ┼  （F171 动 response-helpers 前先补 F170c 覆盖盲点）
   F175 batch (5d)     ┘
   ↓
🟢 第 2 步 — F176 SWE-Bench Verified (11d, 需先拍板 8 个 openQuestions)
   决策 3.A：找/装真正 GStack 工作流框架
   ↓
   最终交付：PUBLISH-REPORT-M7.md 5-cohort 横向对比
```

**估时汇总**: F170b ~3d + F171 5d + F174 4d + F175 5d + F176 11d = **~28 工程日**（多 worktree 并行可压缩 §1 步到 ~5d wall）

---

## 8. workflow 元信息

- Run ID: `wf_00c688f4-3b9`
- 7 agent（4 design via Plan agent + 3 adversarial review）
- 1.68M subagent tokens / 358 tool uses / 26 min wall
- 中途 stall 自动重试（review:F170d 1273s 后 retry 成功）
- 完整 raw 产出已沉淀本文档；原始 transcript 在 session subagents/workflows/wf_00c688f4-3b9
