# 问题修复报告 — Feature 183 graph 一致性收口 + 可观测性 + code-only 帮助文本校正

> 模式：spec-driver-fix ｜ 分支：claude/vigorous-black-97af11（独立 worktree）｜ 诊断模型：opus
> 基线 HEAD：85bf57e（≥ 要求，已 git fetch origin master 确认）

## 问题描述

M8 轨道 A，承接 F193（已 ship）。四项独立但同主题的问题：

1. **graph 写盘形态不一致**：`writeKnowledgeGraph` 的 3 个写盘点只有 batch 路径做了归一化（排序 + 剥 currentRun + stripTimestamps），CLI `graph` / `community` 两路直接写盘 → 含运行态泄漏 + 非字典序。同一 `specs/_meta/graph.json` 跑过 batch vs 跑过 graph/community 后形态漂移。
2. **buildTsConfigContext 双静默**：`core/import-resolver.ts` 两个失败分支（`configFile.error` 与 `catch`）零日志 → monorepo 子包 tsconfig 损坏时 alias/baseUrl 边静默蒸发，无任何信号。
3. **增量传播双口径 + .d.ts 零传播**：module-derivation 用 root-only tsconfig，batch 用 per-file nearest；手写 `.d.ts` 入边全 external → 改它零传播。F181 已 defer "nearest 统一"。
4. **【B1】CLI 帮助文本误导**：`cli/index.ts` 与 `batch.ts` 称 code-only「纯 AST，< 30s，无 LLM，最快」——实际 code-only 仍对每模块调 sonnet spec-gen LLM（仅跳 enrichment），自用仓 ~250 .ts 实测 27min。诚实问题（F193 perf-profiling 坐实）。

## 与 F193 的协调（影响分析已完成）

读取 `graph-builder.ts:514-610`（F193 改后现状）确认：

- `writeKnowledgeGraph(graphJson, outputDir)`（L514）当前**只做** portable 守卫扫描（`scanGraphPortabilityViolations` L519，warning + 计数，不转换）+ `writeAtomicJson`。**不调用** `normalizeGraphForWrite`。
- `normalizeGraphForWrite(graphJson, options?)`（L641）已存在（F175），做：stripTimestamps（可选，generatedAt→epoch）+ 剥 currentRun（`RUNTIME_NODE_METADATA_FIELDS`，**无条件**）+ nodes/links/hyperedges 字典序排序。**in-place 幂等**。
- 当前唯一调用方是 `batch-orchestrator.ts:1628`（`{stripTimestamps:true}`），紧接着 `writeKnowledgeGraph`（L1631）。
- F193 守卫与本 feature 归一化**正交不冲突**：守卫只计数 path-like 绝对路径泄漏，归一化只排序 + 剥运行态字段。叠加无副作用。

**结论**：把 `normalizeGraphForWrite` 内聚进 `writeKnowledgeGraph`（守卫扫描在前、归一化在后），CLI 两路自动获得 batch 同款形态，且 batch 的显式 pre-call 保持不变（双重归一化幂等无害）→ **batch-orchestrator.ts 零改动**，满足 F182 护栏。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | graph/community 写盘形态为何与 batch 不同？ | 这两路直接调 `writeKnowledgeGraph`，未经 `normalizeGraphForWrite` |
| Why 2 | 为何只有 batch 经过归一化？ | F175/F179 把归一化做成 batch-orchestrator 的**显式前置调用**，而非写盘函数内聚能力 |
| Why 3 | 为何归一化没内聚进写盘函数？ | F175 设计时归一化目标是"batch byte-stable gate"，作用域被框定为 batch；写盘函数被当作纯 I/O |
| Why 4 | 为何作用域框定为 batch 是错的？ | `writeKnowledgeGraph` 是 3 路共享出口，"归一化是写盘前置不变量"而非"batch 私有步骤"——抽象层级放错 |
| Why 5 | 为何未被现有机制捕获？ | byte-stable gate（F179/F180）只测 batch 单路可复现，**无跨写盘点形态一致性断言**——测试盲区 |

**Root Cause**：归一化不变量被实现成 batch-orchestrator 的局部步骤而非 `writeKnowledgeGraph` 的内聚契约，导致另外两个共享同一出口的写盘点绕过它；缺少跨写盘点一致性回归测试使其长期隐形。

**Root Cause Chain**：graph/community 形态漂移 → 直接调写盘函数 → 归一化是 batch 私有前置 → 归一化作用域框错（应是写盘不变量）→ 抽象层级放错 + 跨路一致性测试盲区。

（问题 2/3/4 是同一主题"静默/误导"的并列根因，非同一链条：#2 = 失败分支无 observability；#3 = 双口径是 F181 已知 defer；#4 = 文档随实现漂移未更新。）

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/panoramic/graph/graph-builder.ts` | L514 `writeKnowledgeGraph` | 写盘函数缺归一化内聚 | 加可选 `NormalizeGraphOptions` 形参，内部 `normalizeGraphForWrite` 后再 guard-scan + 写盘 |
| `src/cli/commands/graph.ts` | L198 | 直接写盘无归一化 | 自动受益（无需改调用——内聚后默认归一化）；可显式传 options |
| `src/cli/commands/community.ts` | L99 | 直接写盘无归一化 | 自动受益（同上） |
| `src/core/import-resolver.ts` | L443-445 / L464-466 `buildTsConfigContext` | 双静默 return null | 加 `logger.warn`（configPath + error 摘要）+ negative cache 限频 |
| `src/cli/index.ts` | L99 | code-only 帮助文本「纯 AST，< 30s，无 LLM，最快」误导 | 校正为准确描述（仍调 spec-gen LLM、仅跳 enrichment；<30s 仅极小项目成立） |
| `src/cli/commands/batch.ts` | L73-74 | reading 模式 TTY hint 引导用户「最快 < 30s 用 code-only」误导 | 校正 hint 文案 |

### 类似模式（已评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `src/batch/batch-orchestrator.ts` | L1628 显式 `normalizeGraphForWrite` | 写盘前归一化 | **安全/零改动**：内聚后双重归一化幂等；F182 护栏要求零改动，保持 |
| `src/batch/delta-regenerator.ts` | `DeltaReport`（L34） | 问题 #3 拟加 warn 字段 | **F182 护栏冻结文件**——禁止改 `DeltaReport` 接口（见下方决策 D-3） |
| `community.ts` loadGraph→写回 | L61-99 | 读现存 graph → 改 metadata → 写回 | 内聚归一化后写回自动排序；若源自 batch（epoch）则默认不传 stripTimestamps，generatedAt 原样保留（不破坏 byte-stable） |

### 同步更新清单

- 调用方：`graph.ts:198` / `community.ts:99` **无需改签名**（内聚后默认归一化）；`batch-orchestrator.ts` **保持零改动**。
- 测试：**新增**跨写盘点形态一致性回归测试（graph/community/batch 写盘后 nodes 字典序 + 无 currentRun 残留）；buildTsConfigContext warn 单测（损坏 tsconfig → 触发 warn + negative cache 限频）；帮助文本快照/断言（不含「无 LLM」字样）。
- 文档：问题 #3 双口径 + .d.ts 零传播限制写入 spec.md「已知限制」节。

## 关键设计决策（用户已拍板 2026-06-13）

> D-2 = 选项「默认保留真实时间」；D-3 = 选项「logger.warn + 文档」。下方原始分析保留。

## 关键设计决策明细

- **D-1（归一化内聚顺序）**：`writeKnowledgeGraph` 内 **先 guard-scan 后 normalize 再写盘**（prompt 明确"守卫查绝对路径在前、归一化排序在后"）。两步正交，写出字节相同；顺序仅影响 warning 取样针对 pre-sort 图（无语义差）。
- **D-2（stripTimestamps 默认值）**：`writeKnowledgeGraph` 新增可选 `NormalizeGraphOptions`，**默认 `stripTimestamps:false`**（对齐 prompt"stripTimestamps 按需传"）。效果：batch 仍 epoch（byte-stable）；`community` 重写 batch 产物时不碰 generatedAt → epoch 保留；独立 `spectra graph` 全新构建保留真实 generatedAt（用户需要生成时间信息）。⚠️ 回归测试断言"形态一致"= **结构一致（排序 + 无 currentRun）**，不含 generatedAt 逐字节相等。此点为用户可见行为，GATE_DESIGN 复核。
- **D-3（问题 #3 改 DeltaReport → 改用 logger.warn）**：`DeltaReport` 定义在 `delta-regenerator.ts`（F182 零改动护栏文件）。**禁止**给其加 warn 字段。改为：在**非护栏文件** `module-derivation.ts`（已 import logger）检测到 root 下存在多个 tsconfig（monorepo per-package）或手写 .d.ts 节点入边全 external 时 `logger.warn` 提示双口径风险 + 文档化。护栏优先级高于 prompt 字面"DeltaReport warn"。**或**视成本仅文档化（prompt 允许 defer）——GATE_DESIGN 拍板。
- **D-4（B1 越界红线）**：本 feature **只改 code-only 描述**，不新增「graph-only 零 LLM」行（归后续 F195）。

## 修复策略

### 方案 A（推荐）

1. **#1 归一化内聚**：`writeKnowledgeGraph` 签名加可选 `options?: NormalizeGraphOptions`；函数体顺序 = guard-scan（保留 F193）→ `normalizeGraphForWrite(graphJson, options)` → `writeAtomicJson`。graph/community 调用点不改。batch 保持零改动。
2. **#2 tsconfig warn**：`buildTsConfigContext` 两失败分支加 `logger.warn`（namespace `import-resolver`，含 configPath + error 摘要）；模块级 `Set<string>` negative cache，同一 configPath 只 warn 一次（限频）。
3. **#3 双口径**：按 D-3，logger.warn（非护栏文件）+ spec.md 文档化；不碰 DeltaReport。
4. **#4 帮助文本**：`cli/index.ts:99` 改为准确描述；`batch.ts:73-74` TTY hint 校正。不新增 graph-only 行。
5. **回归测试**：新增跨写盘点一致性测试 + tsconfig warn 测试 + 帮助文本断言。

### 方案 B（备选）

`writeKnowledgeGraph` 默认 `stripTimestamps:true`（三路全 epoch，真·byte-identical）。**否决理由**：独立 `spectra graph` 用户失去真实生成时间；改变 graph CLI 既有行为；prompt 明确"按需传"暗示默认 false。

## 回归护栏（验证清单）

- F182 三护栏文件（delta-regenerator/regen-plan/batch-orchestrator）**零改动**（git diff 确认）。
- F193 portable 守卫 + 加载期 stale 检测零回归；跨 worktree byte 一致测试零回归。
- graph.json byte-stable gate（F179/F180）全绿；F180 的 44 stdio E2E 零回归。
- 现有 4300+ vitest + build + repo:check 57 项全绿。
- 新增跨写盘点形态一致性回归测试通过。

## Codex 对抗审查处置（Phase 1 诊断，2026-06-13）

> 结论：CRITICAL 1 / WARNING 3 / INFO 4。全部处置如下（无 over-claim 保留）。

| # | 档位 | Codex 发现 | 处置 |
|---|------|-----------|------|
| C-1 | CRITICAL | D-3 的「.d.ts 入边全 external」检测放 module-derivation 层不可行：resolver 已把 .d.ts 折叠成 external/null（`import-resolver.ts:120-125`/`250-263`），`ImportReference`（`code-skeleton.ts:117-131`）不保留 resolveKind/reason，派生层无法区分手写 .d.ts external vs npm external | **接受，重设计 D-3**。拆两半：① **可行半**＝monorepo 多 tsconfig 双口径 → module-derivation 自包含 fs 扫描（root 下存在非 root tsconfig.json）→ `logger.warn`，运行时落地；② **不可行半**＝手写 .d.ts 零传播 → **仅文档化**（可靠检测需在 resolver/analyzer 层给 ImportReference 加 resolveKind，属数据模型手术，超出 fix 作用域、会扩大改动面）。不在丢失上下文的派生层硬塞假告警 |
| W-1 | WARNING | 「三写盘点形态一致」覆盖不足：`hyperedge.nodes` 成员顺序 + `metadata` key 顺序未归一化（`normalizeGraphForWrite` 只排外层数组 L663-671） | **接受，明确作用域边界**。F183 目标＝三路**共用同一 normalize 出口**故形态一致；非「把 normalize 做成 byte-identical」。不新增 `hyperedge.nodes.sort()`／稳定 key 序列化——那会改 batch 落盘字节、危及 F179/F180 byte-stable gate + 44 stdio E2E，且超出本 fix 作用域。回归测试只断言 normalize 的**既有契约**（nodes 按 id 排序 + links 排序 + 无 currentRun）在三路一致；spec 明记 hyperedge.nodes/metadata-key 顺序不在 F183 归一化契约内 |
| W-2 | WARNING | `stripTimestamps:false` 当前安全但无防回归测试钉住（`graph-builder-normalize.test.ts:89-94` 只测 true 改时间戳，未锁 false 必须保留既有 epoch） | **接受，补测试**。新增「batch 写 epoch graph → `writeKnowledgeGraph` 默认 options → epoch 不变」回归用例 |
| W-3 | WARNING | negative cache 语义不清：缓存「失败结果」会让同进程 tsconfig 恢复后仍按 null 处理 | **接受，spec 明确**：Set **只缓存已 warn 的 configPath（限频 warning emission）**，`buildTsConfigContext` **始终尝试解析**（失败仍 return null，行为不变），cache **绝不**跳过解析。key＝configPath（mtime-keying 对一个 warn 限频器属过度设计） |
| I-1 | INFO | scan-before-normalize 当前不失真（scan 只看 path-like，normalize 不改路径字段） | 接受。保持 guard-scan 在前；注释标注「若未来 normalize 增路径转换需重排顺序」 |
| I-2 | INFO | community 重写保留 epoch 但内容必变（加 metadata.community），不应称 byte-identical | 接受。测试口径＝「epoch 保留 + 排序 + 无 currentRun」，不声称 byte-identical |
| I-3 | INFO | 可选第三参源码兼容，未见 `Parameters<typeof writeKnowledgeGraph>` 断言 | 接受。implement 后必跑 `npm run build` |
| I-4 | INFO | `tests/panoramic/graph-persistence.test.ts`（直接调 writeKnowledgeGraph）漏列回归清单 | 接受，补入回归护栏验证清单 |

**D-3 修订后定义**：module-derivation.ts 检测 root 下存在 ≥1 个**非 root** tsconfig.json（monorepo per-package 信号）时 `logger.warn` 提示「root-only tsconfig 与 batch per-file nearest 双口径，子包 alias 可能漏解析」；手写 .d.ts 零传播仅写入 spec「已知限制」节。两者均**不碰 F182 护栏文件**。

## Codex 对抗审查处置（Phase 2 plan+tasks，2026-06-13）

> 结论：CRITICAL 2 / WARNING 2 / INFO 2，全部聚焦实现可行性。处置如下（已回写 tasks.md）。

| # | 档位 | Codex 发现 | 处置 |
|---|------|-----------|------|
| C-1 | CRITICAL | T009 测试：logger 是模块级私有实例，`vi.spyOn` 无法 spy；catch 分支（L464）需 ts host 真 throw（parseJsonConfigFileContent 通常只返回 diagnostics 不 throw） | **接受**。logger 断言改 spy `process.stderr.write`（logger 写 stderr，默认 warn 级别即输出）；warn+dedup 核心逻辑用可靠触发的 `configFile.error` 分支（语法损坏 tsconfig）测；catch 分支用 `vi.mock('ts-morph')` 令 readConfigFile throw 做定向覆盖。已写入 implement 指令 |
| C-2 | CRITICAL | T013/T014 全局 mock `fs.readdirSync` 会污染 `scanFiles`（它用 `readdirSync(dir,{withFileTypes:true})` 期待 Dirent[]，mock 返回 string[] 致 scanFiles 崩溃→假绿/假红） | **接受，改进设计**。monorepo 探测抽为**纯 helper** `collectNonRootTsConfigNames(fileNames: string[]): string[]`（导出），T013 直接单测纯函数**零 fs mock**；buildModuleGraph 仅 `fs.readdirSync(resolvedRoot)`（无 withFileTypes→string[]）+ helper + warn。彻底回避 scanFiles 污染 |
| W-1 | WARNING | T017「小项目约 5min」无评测支撑（证据仅支持 ~27min 自用仓 / <30s 极端极小），且与同任务「禁止未验证耗时数字」自相矛盾 | **接受**。帮助文本改纯定性，删「约 5min」。已回写 T017 |
| W-2 | WARNING | T-01「三路一致」over-claim：unit 测试只测共用出口 writeKnowledgeGraph，非 graph/community/batch 三条端到端路径 | **接受**。测试更名为「shared write boundary applies normalization」；另加轻量静态断言确认三调用点均路由到同一 writeKnowledgeGraph 导出（诚实建立「共用出口→一致」）。已回写 T002 |
| I-1 | INFO | T005 排序断言失败风险不成立：graph-persistence.test.ts 无 order-sensitive 断言 | 接受。T005 降级为「确认无 order-sensitive 断言，无需改」 |
| I-2 | INFO | 写盘调用方无遗漏：src/ 恰 3 处运行时调用 + index.ts 仅 re-export | 接受，无动作 |

## Spec 影响

- 需要更新的 spec：本 feature 新建 `specs/183-.../spec.md`（含「已知限制」节记录 #3 双口径）。产品级 current-spec 不在本 fix 范围（sync 流程负责）。
