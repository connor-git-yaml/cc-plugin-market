# Implementation Plan: Graph Collector Fingerprint（图产物版本化）

**Branch**: `claude/recursing-margulis-b79caa` | **Date**: 2026-08-03 | **Spec**: [spec.md](./spec.md)
**Input**: `specs/249-graph-collector-fingerprint/spec.md`（19 FR / 20 SC / 10 EC，四轮 Codex 对抗审查收敛）、`specs/249-graph-collector-fingerprint/codebase-context.md`（v4）

**Plan 审查回写（第一轮）**：Codex plan 阶段对抗审查裁定打回 7 CRITICAL + 9 WARNING + 3 INFO，编排器逐条裁决后本版本已全部处置——核心变更：6 Phase 重构为 5 Phase（消灭 Phase 间 fail-closed 断裂中间态）；SC-005 oracle 形态与 FR-002 #4 seam 命名重新校准（同步回写 spec.md 两处 + 背景说明一行 + 已知残余绕过面一行）；SC→测试映射全部落到 vitest include glob 可达的真实文件路径（消灭 zero-execution 风险）；再生脚本拒绝判据一度被扩展出额外例外分支（第二轮已否决、回归二元判据，理由见 Complexity Tracking「已否决方案记录」）；指纹比较由 `JSON.stringify` 字符串相等改为 canonical 结构化深比较。

**Plan 审查回写（第二轮）**：Codex plan 阶段第二轮对抗审查再打回一批发现，编排器逐条裁决后本版本核心变更如下（均已落实到下方各节，**被否决的判据方案不在正文任何位置保留残留**）：

1. **拒绝判据回归 spec FR-005(e) 原文的二元判据**（撤销第一轮引入的额外例外分支，理由见 Complexity Tracking「已否决方案记录」）；`fixtureInputHash` 降格为**纯诊断字段**，仅用于拒绝时的错误文案分流，**不参与放行判定**；fixture 基线变更（含护栏样本扩充/修改）同样须 bump `behaviorVersion` 声明后才能放行——第一轮 quickstart 中"fixture 扩充自动放行"的第三类演示已删除。
2. **`fixtureInputHash` 哈希编码修复**（第一轮实测暴露的拼接歧义碰撞反例）：由"排序路径与原始字节整体拼接后 hash"改为"逐文件 `sha256(内容)` → 按路径排序的 `[{path, contentSha256}]` canonical JSON → 整体 `sha256`"，长度固定消除歧义。
3. **再生脚本前置一致性校验补齐**：两份 pinned 资产的 `fingerprint` **与** `fixtureInputHash` 均须结构合法且彼此相等，缺一不通过。
4. **Phase 绿名单与验证命令修正**：Phase 1 移除 SC-002（依赖 Phase 2 才存在的指纹模块）；Phase 2 的 SC-013 降级为 partial；Phase 3 定向验证命令补齐 SC-011/SC-012 对应的既有测试文件路径。
5. **SC-010 落地为可执行的扰动注入测试组**（Phase 4 新增三件套自动化证明），quickstart 手工演示降级为辅助说明。
6. **双资产写盘由"临时文件+全部 rename"改为"备份+回滚"方案**，swap 逻辑提取为可注入 `fs` 的独立导出函数并单测覆盖"第二次 rename 失败后回滚"场景。
7. **Phase 5 Closure 时序精确化**，并显式标注"commit 后 HEAD 前进、本地图转 stale"是本仓既有稳态非缺陷。
8. **registry 生命周期统一为 reset-to-empty**（对齐 `tests/unit/batch-orchestrator.test.ts:71` 既有惯例，不做"重新标准 bootstrap"）。
9. **Technical Context 关于 `node:crypto` 的表述更正**为"用于 `fixtureInputHash` 诊断字段计算"。
10. **pinned 包装消费约束固化**：新消费者 MUST 经 typed loader 解包，禁止把包装文件直接传给要求裸 `GraphJSON`/`ModuleGraph` 的入口。

**Plan 审查回写（第三轮，本版本）**：Codex plan 阶段第三轮对抗审查打回 1 项 CRITICAL + 2 项 WARNING + 1 项 INFO，均为记账级修订（无设计变更），编排器逐条处置：

1. **Phase 绿名单因果修正（CRITICAL）**：Phase 2 的 SC-002 降级为 partial——仅保留"新增扩展名后 `extensionSurface` 子分量自动变化"半段，"用扩展前的图对扩展后版本运行 freshness 判定、结果非 `fresh`"半段移入 Phase 3 完整声明（该半段依赖 Phase 3 才完整落地的 `evaluateFreshness` 三参签名与判定链路，Phase 2 尚不具备该链路）；Phase 1 的 SC-004 降级为 partial——仅保留 dirty/fresh 现状回归半段（含既有 C-04 两条用例，与指纹无关），"fingerprint、sourceCommit 均一致时 100% fresh"的完整语义移入 Phase 3 完整声明。复查 Phase 1/2 绿名单其余条目（SC-005/SC-008/SC-015/SC-001/SC-013/SC-014/SC-016）均已按本 Phase 实际可交付范围正确scope（SC-005/SC-001/SC-013 已在此前版本以 partial 标注、SC-008/SC-015/SC-014/SC-016 不依赖 Phase 3 才落地的判定链路，本身即可在各自所在 Phase 完整达成），未发现其他同类"端到端 SC 提前判绿"残留。
2. **SC-005 a1 清单补 #3（WARNING）**：运行时引用同一性（`===`）oracle 清单补入 `new JavaLanguageAdapter().extensions === JAVA_ADAPTER_SURFACE.extensions`（`GoLanguageAdapter`/`GO_ADAPTER_SURFACE` 同理）——adapter 实例字段直接持有 SSoT 导出引用，此前 a1 清单仅列举 #4/#7 未显式列举 #3；spec.md SC-005 同步外科修订。
3. **quickstart 扰动示例修正（WARNING）**：`module.label` 非真实字段（`ModuleNode`/`ModuleEdge` 均无该字段），演示改为编辑 `expected-module-graph.json` 的 `moduleGraph.edges` 数组（去一项）或 `modules[].source` 值；同时删除"仅新增扩展名后双轨至少一轨变红"这一无合同保证的预期措辞，放行演示的验收点只保留"再生脚本放行 + pinned 指纹更新"。
4. **已否决判据的历史措辞收敛（INFO）**：全篇散落的被否决判据公式与过渡叙述收敛为 Complexity Tracking 中一条「已否决方案记录」（见该节），其余位置仅保留二元判据的当前表述，不再重复展开该历史。

详见下方各节及末尾"实施顺序"。

## Summary

在图产物 metadata 中新增结构化 `CollectorFingerprint` 字段（`formatVersion` + `extensionSurface` + `behaviorVersion`），`evaluateFreshness` 判定重排为五级优先级并新增 `staleReasons` 判别数组；采集面单一事实源收敛落位为零依赖叶子模块 `src/collector-surface.ts`，供 5 条采集管线（tsjsSkeletonWalk/pyWalk/pythonSymbolScan/genericAdapters/moduleDerivationScan）自身及 `#4/#5/#6` 三处消费方引用；新建双轨（graph-only 重建对比 + module producer 直接探针）重建-对比护栏作为 `behaviorVersion` bump 纪律的软提示机制；`graph-quality` CLI / `repo:check` 第 12 族 / `bootstrap-status` 三个消费面做 reason-aware 文案改造。技术路线不引入新运行时依赖（`node:crypto`/`node:path`/`node:fs` 内建足够），指纹本身以确定性构造的 JSON 对象而非哈希值承载（对象字段顺序固定 + 各扩展名数组预排序）；两份指纹之间的相等性比较采用 canonical 结构化深比较（而非 `JSON.stringify` 字符串相等，见"关键架构决策"决策 6）。（W-002 实现期补记，2026-08-03）

## Technical Context

**Language/Version**: TypeScript 5.x（编译到 CommonJS/ESM 双目标，沿用现有 `dist/` 构建）+ Node.js 20.x+
**Primary Dependencies**: 零新增；`node:crypto`（**Q8 更正**：用于再生脚本 `fixtureInputHash` 诊断字段的 `sha256` 计算，仅测试/脚本路径使用；生产代码路径的指纹比较仍为纯对象结构比较、不引入哈希，见决策 6/W-01）、`node:fs`、`node:path`、`node:child_process`（既有 git 交互）、`ts-morph`（本仓库既有依赖 `^24.0.0`，供 SC-005/SC-015 静态 import 边界 oracle 使用）
**Storage**: 图产物 `specs/_meta/graph.json`（JSON 文件），`CollectorFingerprint` 作为 `graph.graph` 顶层可选新增字段，不新建存储介质
**Testing**: vitest（单测 + 护栏双轨测试），无新增测试框架
**Target Platform**: 与现有 spectra CLI 一致（macOS / Linux / CI Node 20+）
**Project Type**: single（`src/` 主代码库，本需求不引入前后端拆分）
**Performance Goals**（T050 实测回写，N=3 取中位数，本 fixture 9 个叶子文件规模；测量环境 = 本机 macOS / Node 24.14.0，`npx tsx` 单进程内连跑，每次重新 `mkdtempSync` 复制 fixture）：**a-track（`buildAstGraphOnly` 重建）中位数 16.6ms**、**b-track（`buildModuleGraphForProject` + 规范化）中位数 2.5ms**（两轨分别报告，不合并为单一数字）。首次迭代含模块加载/ts-morph 冷启动开销（a-track ≈ 80ms、b-track ≈ 6.6ms），第 2/3 次迭代即收敛到上述中位数附近；三次独立进程复测（16.6/16.0/16.6ms 与 2.5/2.7/2.7ms）表明该数字稳定。**MUST NOT 复用 self-dogfood 规模的 graph-only ~3s 数据**——本 fixture 比本仓库小两个数量级。`computeCollectorFingerprint()` 本身零 I/O，预算 <10ms，实测中位数 <0.01ms（三次复测均为 0.00–0.01ms），预算达成且余量三个数量级
**Constraints**: 零依赖叶子模块约束（FR-019）；确定性序列化跨进程 byte-identical（FR-017）；不 bump 图 schemaVersion（延续 F217 决策 5）
**Scale/Scope**: 影响文件 **46** 个（**26 新增 + 20 修改**，见下方文件级改动清单——**Codex tasks 阶段审查修正**：此前"32（18 新增 + 14 修改）"与"第一轮回写后 30（16 新增 + 14 修改）"两版声明均未将 `tests/fixtures/collector-fingerprint-guardrail/src/{ts,py,java,go,module-only}/...` 这一 fixture 目录展开到叶子文件计数——按 Project Structure 实际条目逐一展开（该目录下共 9 个叶子文件：`ts/foo.ts,foo.tsx,bar.js,bar.jsx`、`py/mod.py,mod.pyi`、`java/Foo.JAVA`、`go/main.go`、`module-only/entry.mjs`），且此前"14 修改"的计数遗漏了实际 Project Structure 中已列出的若干 `[修改]` 条目，逐一核对后精确重算为 26 新增 + 20 修改）；跨 `src/`（主代码）、`scripts/lib/`（repo:check 工具）、`scripts/`（再生脚本本体）、`specs/217-*/contracts/`（schema 契约）、`tests/`（新护栏 fixture/helper）、`package.json`（npm script 登记）六个目录簇

## Codebase Reality Check

以下为本次将被修改/新建交互的现有目标文件实测数据（master@264338b）：

| 文件 | LOC | 关键方法/接口数 | 已知 debt |
|------|-----|----------------|-----------|
| `src/panoramic/graph/source-commit.ts` | 204 | `resolveSourceCommit` / `getDirtySourceExtensions` / `getDirtySourceFiles` / `evaluateFreshness` / `parsePorcelainZPaths` | 无 TODO/FIXME；`getDirtySourceExtensions` 直接实例化 Java/Go adapter，是本次要移除的耦合点 |
| `src/panoramic/graph/source-commit.test.ts` | 279 | 覆盖三态 mock + 真实临时 git 仓库场景 | 无 |
| `src/panoramic/graph/quality/quality-types.ts` | 176 | 纯类型模块，`GraphFreshnessVerdict`/`GraphQualityReport` 等 6 类型 | 无 |
| `src/panoramic/graph/quality/ignore-oracle.ts` | 148 | `createIgnoreOracle`/`ignoreDirsForPath`/`javaIgnoreDirs`/`goIgnoreDirs` | 无；`TSJS_EXTENSIONS`/`PY_EXTENSIONS` 是本次要收敛的镜像点 |
| `src/panoramic/cache/cache-key-builder.ts` | 144 | `scanSourceFiles`/`resolveInputFiles`/`buildGeneratorCacheKey` | 无；`INCLUDED_EXTENSIONS` 含待收敛的代码子集 |
| `src/adapters/java-adapter.ts` | 94 | `extensions`/`defaultIgnoreDirs`/`analyzeFile`/`getTestPatterns` | 无 |
| `src/adapters/go-adapter.ts` | 87 | 同上 | 无 |
| `src/adapters/ts-js-adapter.ts` | 241 | `extensions`（×8 硬编码）/`analyzeFile`/`buildModuleGraph` | 无；`.extensions` 字面量是 #7/#8 镜像对的一端 |
| `src/knowledge-graph/module-derivation.ts` | 504 | `buildModuleGraphForProject`/`deriveModuleGraph`/`findMonorepoPackageTsConfigDirs` | 无 TODO；504 行踩线 500 阈值，但本次改动 <10 行（fallback 常量替换），不触发前置清理规则 |
| `src/batch/stages/source-discovery.ts` | 582 | `walkTsJsFiles`/`walkPyFiles`/`collectTsJsCodeSkeletons`/`collectPythonCodeSkeletons` | 无 TODO；582 行 >500 阈值，但本次改动仅两处 endsWith 判定条件替换（预估 <20 新增行），不触发前置清理任务 |
| `src/batch/stages/graph-assembly.ts` | 321 | `buildAstGraphOnly`/`selectPrimaryModuleGraph` | 无 |
| `src/batch/batch-orchestrator.ts` | 1763 | 单一 `runBatch` 主链 + 多个 seam 抽取函数（F220 已拆分五段） | 该文件是 M9 轨道 D 登记的既有重构对象（跨 milestone 议题），但本次改动仅在写盘前插入 1 行 `fingerprint` 赋值（紧邻既有 `sourceCommit` 赋值），新增 <5 行，不在本需求范围内触发额外拆分 |
| `src/cli/commands/graph.ts` | — | `spectra graph` 命令 handler | 无；F217 先例已在此处写 `sourceCommit = null` |
| `src/cli/commands/graph-quality.ts` | 471 | `buildReport`/`buildNextSteps`/`computeOverallVerdict`/`formatReportText`/`validateGraphJsonShape` | 无 |
| `src/panoramic/graph/graph-types.ts` | — | `GraphJSON` 类型定义 | 无；`graph.sourceCommit?: string \| null` 紧邻新增 `fingerprint` 字段 |
| `src/panoramic/graph/index.ts` | 16 | graph 模块统一导出 barrel（`buildKnowledgeGraph`/`GraphQueryEngine` 等既有 re-export） | 无；本次新增指纹 API re-export（W-06），既有导出面不变 |
| `scripts/lib/graph-quality-core.mjs` | 237 | `validateGraphQuality`/`createCheck` | 无 |
| `scripts/lib/graph-bootstrap-status.mjs` | 590 | `checkFreshness`/`buildStatusPayload`/`writeBootstrapStatus`/`runBoundedProcess` | 无 TODO；590 行 >500，但本次改动仅在 `checkFreshness` 透传对象新增 1 个可选字段，<5 行，不触发前置清理 |
| `specs/217-graph-quality-gates/contracts/graph-quality-report.schema.json` | 213 | JSON Schema，`additionalProperties: false` | 无；本次需新增 `staleReasons` 字段定义 |
| `package.json` | — | `scripts` 字段 | 无；本次新增 `fixtures:regen:collector-fingerprint` 一条 npm script（P12），不改动其他既有 script |

**前置清理判定结论**：全部目标文件均不满足"LOC > 500 且新增 > 50 行"的强制前置清理阈值（`batch-orchestrator.ts`/`source-discovery.ts`/`graph-bootstrap-status.mjs`/`module-derivation.ts` 均单文件超线但本次新增行数很小），且均无与本次变更相关的 ≥3 条 TODO/FIXME 标记或 ≥30 行重复逻辑。**不新增 `[CLEANUP]` 前置任务**。

## Impact Assessment

- **影响文件数**：46（26 新增 + 20 修改，见下方文件级改动清单）——超过 20 文件阈值。
- **跨包影响**：2（`src/` 主代码 ↔ `scripts/lib/` repo:check 工具脚本 ↔ `specs/217-*/contracts/` schema 契约文件；`tests/` 新护栏资产不计入生产代码边界穿越）。
- **数据迁移**：无图自身 schema 迁移（`fingerprint` 为可选新增字段，延续 F217 决策 5，不 bump `schemaVersion`）；但**存在 `--json` 输出契约变更**（`graph-quality-report.schema.json` 新增 `staleReasons` 字段定义）。
- **API/契约变更**：是——`evaluateFreshness()` 签名新增第三参数（`recordedFingerprint`）、`GraphFreshnessVerdict` 类型新增 `staleReasons` 字段、`graph-quality-report.schema.json` 契约升级、`getDirtySourceExtensions()` 导出函数被移除（见下方判定逻辑重排一节的显式决策）。
- **风险等级**：**HIGH**（影响文件 > 20 且修改公共契约，两条独立触发条件均命中 HIGH 判定规则）。

**HIGH 风险强制分阶段**：本计划将实现拆分为 5 个可独立验证的 Phase（见"实施顺序"一节），每个 Phase 有明确的 `npx vitest run <范围>` + `npm run build` 验证点。Phase 1/2/4/5 可在前一 Phase 验证通过后独立提交；**Phase 3 是不可拆分的原子兼容 Phase**（判定逻辑重排 + 三写入点 + 消费方改造 + schema 升级必须同一提交落地）——这是对 Codex plan 审查 C-01 的直接处置：原 6-Phase 方案把"签名扩展"（原 Phase 3）、"写入点"（原 Phase 4）、"消费方改造"（原 Phase 5）拆成三个独立可提交 Phase，会在中间产生"`evaluateFreshness` 已接受第三参数但无任何写入点产出该参数、CLI/repo:check 尚未消费新字段"的 fail-closed 断裂态；本版本把这三者合并为单一 Phase 3 消灭该断裂。

## Constitution Check

*GATE: 必须在进入实现前通过；下表逐条评估适用性。*

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| I. 双语文档规范 | 适用 | 通过 | 本计划及后续制品均中文散文 + 英文标识符 |
| II. Spec-Driven Development | 适用 | 通过 | 经 spec → plan 标准流程，不直接改源码 |
| III. YAGNI / 奥卡姆剃刀 | 适用 | 通过 | FR-015（自动重建）/FR-016（多版本兼容解析）已在 spec 显式移除；本计划未新增额外抽象层——SSoT 模块与指纹计算模块分离是唯一的结构决策，理由见下方 Complexity Tracking |
| IV. 诚实标注不确定性 | 适用 | 通过 | b-track 规范化投影的具体字段清单（ModuleGraph 是否还有其他易变字段）标注为"tasks 阶段实测确认"，不假装已穷尽；Phase 3 结束时本仓自身图仍无 fingerprint 导致 `repo:check` 出现过渡态 warn，已在"实施顺序"显式声明为预期而非回归 |
| V. AST 精确性优先 | 适用 | 通过 | `extensionSurface` 分量完全来自静态声明（Set 字面量），不经 LLM；`behaviorVersion` 是显式维护者声明，非推断值 |
| VI. 混合分析流水线 | 不适用 | N/A | 本需求不涉及 LLM prompt 组装环节 |
| VII. 只读安全性 | 适用 | 通过 | 仍只读源码、只写 `specs/_meta/graph.json`（既有写入点），未新增对源文件的写操作 |
| VIII. 纯 Node.js 生态 | 适用 | 通过 | 零新增 npm 依赖，`src/collector-surface.ts` 仅用 `node:path` |
| XI. 质量门控不可绕过 | 适用 | 通过 | 双轨护栏接入 vitest 套件（`npx vitest run` 覆盖），`repo:check` 第 12 族同步升级 |
| XII. 验证铁律 | 适用 | 通过 | 每 Phase 均要求实际命令输出而非推测性声明 |
| XIII. 向后兼容 | 适用 | 通过 | 旧图缺 `fingerprint` 走 FR-010 诚实降级路径，非崩溃非误判 fresh；`--json` 契约新增字段为 additive |
| XIV. 可观测性与架构守护 | 适用 | 通过 | 单文件行数：本次无新文件超 300 行；`source-commit.ts` 移除对 `adapters/` 的直接依赖，净减少耦合；`getDirtySourceExtensions()` 移除属显式重命名/移除，verify 阶段需扫描旧名称残留（tests + 消费方） |

**结论**：无 VIOLATION，Constitution Check 通过。

## Project Structure

### Documentation (this feature)

```text
specs/249-graph-collector-fingerprint/
├── spec.md                # 已存在（四轮审查收敛 + Plan 阶段两轮审查回写共计四处外科修订）
├── codebase-context.md    # 已存在（v4）
├── plan.md                # 本文件
├── research.md            # Phase 0 产出（补充 spec 未定案的三处纯技术决策）
├── data-model.md           # Phase 1 产出
├── quickstart.md           # Phase 1 产出
├── contracts/
│   └── graph-quality-report-schema-delta.md   # schema 变更点摘要（指向既有 217 契约文件的 diff）
└── tasks.md                # 后续 /spec-driver.tasks 产出（不在本次范围）
```

### Source Code（受影响范围，按现有仓库结构标注新建/修改）

```text
src/
├── collector-surface.ts                         # [新建] 零依赖叶子 SSoT
├── adapters/
│   ├── java-adapter.ts                           # [修改] extensions 引用 SSoT
│   ├── go-adapter.ts                             # [修改] extensions 引用 SSoT
│   └── ts-js-adapter.ts                           # [修改] extensions（×8）引用 SSoT
├── batch/
│   ├── batch-orchestrator.ts                      # [修改] 写入 fingerprint（主链）
│   └── stages/
│       ├── source-discovery.ts                    # [修改] walkTsJsFiles/walkPyFiles 引用 SSoT
│       └── graph-assembly.ts                       # [修改] 写入 fingerprint（graph-only）
├── knowledge-graph/
│   └── module-derivation.ts                       # [修改] #8 fallback 引用 SSoT
├── cli/commands/
│   ├── graph.ts                                    # [修改] fingerprint 写 null
│   └── graph-quality.ts                            # [修改] reason-aware 文案 + 报告透传
└── panoramic/
    ├── cache/cache-key-builder.ts                   # [修改] INCLUDED_EXTENSIONS 代码子集引用 SSoT
    └── graph/
        ├── index.ts                                 # [修改] 既有 barrel，新增指纹 API re-export（W-06）
        ├── graph-types.ts                           # [修改] GraphJSON.graph 新增 fingerprint 字段
        ├── source-commit.ts                          # [修改] evaluateFreshness 重排 + 移除 adapter 直连
        ├── source-commit.test.ts                     # [修改] 扩展场景 + C-04 既有用例语义翻转
        ├── collector-fingerprint.ts                   # [新建] CollectorFingerprint 类型/计算/校验/canonical 比较
        ├── collector-fingerprint.test.ts               # [新建]
        └── quality/
            ├── quality-types.ts                        # [修改] GraphFreshnessVerdict 新增 staleReasons
            └── ignore-oracle.ts                         # [修改] TSJS_EXTENSIONS/PY_EXTENSIONS 引用 SSoT

scripts/
├── lib/
│   ├── graph-quality-core.mjs                        # [修改] reason-aware warning 文案 + evidence 透传
│   ├── graph-bootstrap-status.mjs                     # [修改] staleReasons 透传
│   └── collector-fingerprint-regen-predicate.mjs       # [新建] 再生脚本二元拒绝判据纯函数（P16，Q1）
└── regen-collector-fingerprint-fixtures.ts             # [新建] 双轨再生脚本（tsx 直跑，支持 --fixture-root 覆盖；内含可注入 fs 的 swapPinnedAssets 导出函数供单测直接 import，Q5）

tests/
├── helpers/
│   ├── module-graph-snapshot-normalize.ts              # [新建] b-track 规范化投影共享工具
│   ├── bootstrap-guardrail-registry.ts                  # [新建] registry 生命周期 helper，护栏测试与再生脚本共用（P9，Q7 统一 reset-to-empty）
│   └── pinned-asset-loader.ts                            # [新建] typed loader（loadPinnedGraphOnlyAsset/loadPinnedModuleGraphAsset），新消费者 MUST 经此解包，禁止裸包装文件直传（Q9）
├── unit/
│   ├── collector-surface.test.ts                        # [新建]（原计划误放 src/collector-surface.test.ts，
│   │                                                     #   该路径不被任一 vitest project include glob 覆盖，
│   │                                                     #   属 zero-execution；本版本迁移到 tests/unit/ 下）
│   ├── collector-fingerprint-regen-predicate.test.ts     # [新建] 二元判据真值表（2×2=4）+ fixtureInputHash 诊断分流独立用例（P16，Q1）
│   ├── pinned-asset-swap.test.ts                        # [新建] 备份/回滚单测，含"第二次 rename 失败"回滚断言（Q5）
│   ├── guardrail/
│   │   └── collector-fingerprint-guardrail.test.ts      # [新建] 双轨护栏 vitest 测试 + 扰动注入测试组（Q4）
│   └── contracts/
│       └── graph-quality-report-schema.test.ts           # [新建] schema 契约测试
├── integration/
│   └── collector-fingerprint-regen-script.test.ts        # [新建] 脚本级子进程实跑测试（P16）
└── fixtures/
    └── collector-fingerprint-guardrail/                   # [新建] hermetic 多语言样本 + 两份 pinned 资产
        ├── README.md                                       # 含大小写碰撞禁止事项（P17）
        ├── src/{ts,py,java,go,module-only}/...
        ├── expected-graph-only-graph.json                   # { fixtureInputHash, graph: GraphJSON }
        └── expected-module-graph.json                        # { fixtureInputHash, fingerprint, moduleGraph }

specs/217-graph-quality-gates/contracts/
└── graph-quality-report.schema.json                     # [修改] GraphFreshnessVerdict 新增 staleReasons

package.json                                              # [修改] 新增 npm script fixtures:regen:collector-fingerprint（P12）
```

**Structure Decision**：单项目结构（`src/` 主代码库），不引入前后端拆分。SSoT 落位为 `src/collector-surface.ts`（**而非** `src/models/collector-surface.ts`）——理由见下方"关键架构决策"第一条。

## 关键架构决策

### 决策 1：SSoT 落位 `src/collector-surface.ts`（顶层单文件，非 `models/` 目录）

`src/models/*.ts` 现有文件（`code-skeleton.ts`/`module-spec.ts`/`drift-item.ts`/`call-site.ts`）**全部 import `zod`**（用于 Schema 定义），是"数据结构 Schema 层"而非"零依赖叶子层"——把新 SSoT 放进 `models/` 会造成"同目录文件混合零依赖与 zod 依赖"的语义混淆，且未来若 `models/` 目录整体被当作 zod schema 边界重构，SSoT 会被误纳入。`src/` 顶层已有先例（`runtime-bootstrap.ts` 是顶层单文件模块），因此选择 `src/collector-surface.ts` 作为独立、语义清晰的零依赖叶子模块，被 `adapters/`、`batch/stages/`、`panoramic/graph/`、`panoramic/cache/` 等各层以相对路径单向引用，本身零 import（除类型标注用 `ReadonlySet`/`node:path` 无需 import，仅字符串常量与类型定义）。**此为设计层面的目录语义边界清晰化决策，而非技术上"不能"把 SSoT 放进 `models/` 目录**——`models/` 内文件运行时仍可正常 import 零依赖模块，不存在编译期或运行时障碍；选择顶层独立文件纯粹是为长期可维护性划清边界，避免未来对 `models/` 的批量重构误伤本模块。

### 决策 2：依赖方向 = adapters 消费 SSoT，SSoT 不感知 adapter

`JavaLanguageAdapter`/`GoLanguageAdapter`/`TsJsLanguageAdapter` 的 `readonly extensions` 字段改为从 `collector-surface.ts` 导入对应常量赋值（如 `readonly extensions = JAVA_ADAPTER_SURFACE.extensions`）。`collector-surface.ts` 本身**不 import 任何 adapter 类**，只以字面量声明各管线的扩展名集合——这既满足 FR-019 的零依赖约束，也让 `source-commit.ts` 的 `getDirtySourceExtensions`（#4）替换实现不再需要 `new JavaLanguageAdapter()` 实例化（移除 `source-commit.ts` 对 `adapters/` 层的依赖，是本次改动的一个正向副产品）。`module-derivation.ts`（#8）的 registry-fallback 分支同样从硬编码 ×8 字面量改为引用 `MODULE_DERIVATION_SCAN_SURFACE.extensions`，与 `ts-js-adapter.ts`（#7）的 `.extensions` 字段引用同一常量，彻底消除 #7/#8 镜像对。

### 决策 3：`genericAdapters` 是单一合并条目，`extensionSurface` 恰好 4 个顶层 key

依据 spec Key Entities 的明确列举（"按采集管线 `tsjsSkeletonWalk` / `pyWalk` / `genericAdapters` / `moduleDerivationScan` 分别记录"），`genericAdapters` 在指纹层面是 Java+Go 的合并视图（两者 `matchSemantics` 相同，均为 `case-insensitive`，合并不损失可辨识信息）。但 `collector-surface.ts` 内部仍分别导出 `JAVA_ADAPTER_SURFACE`/`GO_ADAPTER_SURFACE` 两个独立常量（供各自 adapter 类引用其专属扩展名），指纹计算模块通过 `mergeSurfaces(JAVA_ADAPTER_SURFACE, GO_ADAPTER_SURFACE)` 在计算时合并，不额外维护第三份硬编码字面量。`mergeSurfaces(a, b)` 是纯函数，**MUST 显式断言两个输入的 `matchSemantics` 相同**——不同则 `throw`（而非静默选其一或强行合并），确保未来若 Java/Go 匹配语义出现分歧时能在指纹计算阶段第一时间暴露，而非静默产出语义错误的合并结果（P17/I-02）。

**[实现期审查补记 · W-002/W-004 · 2026-08-03 落账]** 本决策的「4 个顶层 key」在实现期审查中被修正为 **5 个**：新增 `pythonSymbolScan`（`adapters/python-adapter.ts::scanPyFiles`，仅 `.py`、大小写敏感 `endsWith`），理由与失配处置见 spec FR-002 同日补记。同时 `surfaceMatchesFile` 取代「调用方自行提取扩展名 + 查表」成为文件级判定的唯一入口：两族生产者的匹配**形态**不同（endsWith 族 vs `path.extname().toLowerCase()` 族），提取口径属于管线语义的一部分，留在调用方会产生形态失真（纯点文件 `src/.go` 被误判命中 → dirty 误报）。相应地 SSoT 允许 import `node:path`（FR-019 明确「仅允许依赖 Node 内建模块」），以复用与生产者同一个 `path.extname`。

### 决策 4：`getDirtySourceExtensions(): ReadonlySet<string>` 被移除，替换为逐管线谓词 + 公开 seam

现有 `getDirtySourceExtensions()` 返回单一扁平 `Set<string>`，其契约（`.has(ext)`）无法表达"TSJS/PY 用大小写敏感 `endsWith` 判定、Java/Go/moduleDerivationScan 用大小写不敏感 `extname().toLowerCase()` 判定"这一混合语义（FR-003 的核心要求）。若强行用一个大小写不敏感的扁平 Set 兜底，会重新引入 FIX-4 曾经修复过的"`.TS` 被误判为触发 dirty"问题。因此本计划将其替换为：(a) 一个公开导出的 seam 常量 `export const DIRTY_SOURCE_SURFACES = ALL_PRODUCER_SURFACES`（`collector-surface.ts` 内对 `ALL_PRODUCER_SURFACES` 的直接 re-export，供 SC-005 的"运行时引用同一性 `===`"断言消费）；(b) `source-commit.ts` 内部消费该 seam 的谓词函数（非公开导出）：对每个待判定文件路径，遍历 `DIRTY_SOURCE_SURFACES`（5 个管线：tsjsSkeletonWalk / pyWalk / javaAdapter / goAdapter / moduleDerivationScan），按各自 `matchSemantics` 分别做扩展名比较，任一命中即判定该文件属于 dirty 判定范围（SC-008 的三类样本 `.pyi`/`Foo.JAVA`/`foo.MJS` 均由此谓词覆盖）。

**C-04 处置（既有测试语义翻转 + 反例）**：`source-commit.test.ts:272` 附近现有用例（"未提交改动仅涉及大写 `.TS` 扩展名文件 → 不触发 dirty"）建立于收敛前"仅 tsjsSkeletonWalk 单管线大小写敏感判定"的旧语义；收敛后 dirty 判定面是五管线并集，`moduleDerivationScan` 管线大小写不敏感（覆盖 `.ts` 等 8 扩展，经 `toLowerCase()` 归一化），`legacy.TS` 会被 `moduleDerivationScan` 面命中而判定 dirty——即使 `tsjsSkeletonWalk` 本身仍不识别该文件。该既有用例 **MUST 按新语义翻转为断言 `dirty`**（而非 `fresh`），断言理由改为"因 `moduleDerivationScan` 大小写不敏感面命中"而非"生产者不扫描 `.TS`"。为证明这不是全局大小写不敏感化（而是逐管线语义各自保真后的并集），**新增反例用例**：未提交改动仅涉及 `foo.PY`（大写扩展名）不触发 dirty——因为 `pyWalk`（`.py`/`.pyi`，大小写敏感）与 `moduleDerivationScan`（仅覆盖 ts/js 家族扩展，不含 `.py`）均不命中，`.PY` 落在所有管线的匹配面之外，保持 `fresh`。两用例并存，精确证明"逐管线语义各自保真"而非"放宽为全局大小写不敏感"。

`source-commit.test.ts` 中依赖 `getDirtySourceExtensions` 的既有防漂移测试同步移除，替换为直接对 SC-008 三类样本跑 `evaluateFreshness` 端到端断言（真实临时 git 仓库，与既有测试风格一致），且新增 `collector-surface.test.ts` 内的结构引用测试（SC-005a1）覆盖"消费方持有 SSoT 导出引用"这一断言点——两者互补，覆盖面不降级反而更贴近真实行为。

### 决策 5：`computeCollectorFingerprint()` 与 SSoT 分离到 `collector-fingerprint.ts`，经既有 barrel 对外暴露

`FR-019` 的零依赖约束只针对"采集面单一事实源"本身，不要求指纹计算函数也零依赖。指纹计算（`computeCollectorFingerprint`/`isValidCollectorFingerprint`/`fingerprintsEqual`/`BEHAVIOR_VERSION`/`BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES`）落位 `src/panoramic/graph/collector-fingerprint.ts`，与 `source-commit.ts`（freshness 判定消费方）同层，语义上更贴近"图 provenance/freshness"这一既有职责边界，而不是与"采集面扩展名声明"混在一个文件里——避免把纯数据声明（SSoT）与带有版本演进语义的判断逻辑（指纹计算/校验）耦合进同一文件，符合"职责单一"的代码质量约定。该文件 import `collector-surface.ts`，不违反任何依赖方向约束。

`src/panoramic/graph/index.ts`（既有 barrel，非新建文件，见 Project Structure）**MUST 同步新增**对 `computeCollectorFingerprint`/`isValidCollectorFingerprint`/`BEHAVIOR_VERSION`/`BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES` 及 `CollectorFingerprint` 类型的 re-export（W-06）——SC-013 的"公共导出可访问"验收 MUST 覆盖从该 barrel 路径 import，而非仅验证 `collector-fingerprint.ts` 内部文件路径直连 import 可行；barrel 是本模块既有对外访问惯例（`buildKnowledgeGraph`/`GraphQueryEngine` 均经此导出），指纹 API 理应保持一致的消费入口。

### 决策 6：CollectorFingerprint 以确定性构造对象承载，比较采用 canonical 结构化深比较

`computeCollectorFingerprint()` 返回的对象字段顺序在源码中固定书写（`formatVersion` → `extensionSurface.{tsjsSkeletonWalk,pyWalk,genericAdapters,moduleDerivationScan}` → `behaviorVersion`），每个管线的 `extensions` 数组在构造时 `[...set].sort()`。这使得该函数自身的产出满足 FR-017 的确定性要求（同一输入跨进程/跨平台 byte-identical），无需引入 `node:crypto` 哈希层——`JSON.stringify(computeCollectorFingerprint())` 天然产出确定性字符串，供 SC-014 的"序列化输出确定性"验收使用。

**W-01 处置（canonical 化）**：比较两份指纹是否语义相等时，MUST 先各自重建 canonical 结构（固定键序 + 各 `extensions` 数组排序）再逐字段深比较（`fingerprintsEqual(a, b): boolean`，落位 `collector-fingerprint.ts`），**不再直接依赖 `JSON.stringify` 字符串相等**——`recordedFingerprint` 来自 `JSON.parse` 后的外部图产物字段，其字面键序/数组元素排列不受本模块控制（同一逻辑内容可能因图产物写入时机、写入方版本等因素呈现不同字面 JSON 键序，尽管 `computeCollectorFingerprint()` 自身产出是确定性的，`recordedFingerprint` 作为"他人写入的历史数据"不能假设其字面 JSON 与当前实现的书写顺序一致）。`JSON.stringify` 保留且仅用于 SC-014 这一独立验收点（验证 `computeCollectorFingerprint()` 自身产出的序列化结果跨进程 byte-identical），不再作为"两份指纹是否语义相等"的比较手段。

**注（Q1 边界澄清）**：本决策的 canonical 比较适用于 `evaluateFreshness` 判定链路与再生脚本的"当前指纹 vs pinned 指纹"比较；再生脚本额外使用的 `fixtureInputHash` 是完全独立的诊断字段（对象覆盖面是 fixture 源文件内容，不是指纹结构），二者不共用同一比较函数，详见"护栏双轨设计"一节。

### 决策 7：b-track 规范化投影 + 双轨再生脚本用 `tsx` 直跑（非 dist CLI 子进程）

`ModuleGraph`（`buildModuleGraphForProject` 产出）含 `projectRoot`（绝对路径，随临时目录变化）与 `analyzedAt`（`new Date().toISOString()` 实时戳）两个已确认的易变字段，两者均不受现有 `src/knowledge-graph/relativize.ts`（面向 `GraphJSON` 节点 ID 的相对化机制）覆盖——后者与 `ModuleGraph` 是不同的数据结构。新增 `tests/helpers/module-graph-snapshot-normalize.ts`（纯函数 `normalizeModuleGraphSnapshot(graph): NormalizedSnapshot`，将 `projectRoot` 替换为固定占位符 `<PROJECT_ROOT>`、`analyzedAt` 替换为固定 epoch 常量，**保留** `modules[].language` 等其余语义字段不剥除）供 b-track 护栏测试与再生脚本共同 import。`modules[].source` / `edges[].from|to` / `mermaidSource` 是否也含绝对路径残留，本计划标注为**待 tasks 阶段实测确认**（`scanFiles` 返回的路径按现有代码阅读应为相对路径，但未在真实临时目录场景下逐字段验证，诚实标注为不确定项）。

再生脚本 `scripts/regen-collector-fingerprint-fixtures.ts` 用 `tsx` 直接运行（复用本仓库既有先例 `package.json` 的 `"prebuild": "tsx scripts/inline-d3.ts"`），直接 `import` 项目 TS 源码调用 `buildAstGraphOnly`/`buildModuleGraphForProject`/`computeCollectorFingerprint`，不依赖 `dist/` 构建产物，也不 spawn CLI 子进程——比照抬 dist CLI 子进程方式（`graph-quality-core.mjs` 的既有模式）更轻量，且消除"必须先 `npm run build` 才能重跑护栏"的前置门槛。vitest 护栏测试文件同样直接 `import` 源码（vitest 原生支持 TS），与再生脚本共用同一份 `normalizeModuleGraphSnapshot`（决策 7）、`bootstrap-guardrail-registry.ts`（决策 8）与 `pinned-asset-loader.ts`（决策 9）三个工具，确保"比较逻辑"与"生成逻辑"不出现第二份镜像实现。脚本接受可选 `--fixture-root <path>` 参数覆盖入库 fixture 路径（默认指向 `tests/fixtures/collector-fingerprint-guardrail/`），用于支持 P16 的脚本级测试在临时副本上实跑而不污染入库资产。

### 决策 8：registry 生命周期显式管理，主用例/fallback 用例统一 reset-to-empty（Q7 更正，对齐既有惯例）

护栏测试与再生脚本共用同一份 `tests/helpers/bootstrap-guardrail-registry.ts` helper：**主用例**（验证 #7 ts-js adapter 路径）在 `beforeEach` 中显式调用 `LanguageAdapterRegistry.resetInstance()`（本仓库既有 test-only API，`src/adapters/language-adapter-registry.ts:44`，非新增/非假设）后重新 `register()` 所需 adapter；**fallback 用例**（验证 #8 `module-derivation.ts` 的空 registry fallback 分支）在独立 `beforeEach` 中同样调用 `resetInstance()` 但不注册任何 adapter；**两类用例均在 `afterEach` 中调用 `resetInstance()` 将 registry 重置为空（reset-to-empty）**——**不做"重新完成一次标准 bootstrap"**（第一轮版本的表述有误，已更正）：对齐本仓库既有惯例 `tests/unit/batch-orchestrator.test.ts:71` 的实现——该文件 `beforeEach` 负责为下一个用例重新建立所需状态（`resetInstance()` + `bootstrapAdapters()`），`afterEach` 只负责 `resetInstance()` 清空，不预先猜测下一个用例需要什么样的 bootstrap 状态，避免"猜测下一用例需求"式的隐藏耦合。

**再生脚本侧（非 vitest 环境）**：`scripts/regen-collector-fingerprint-fixtures.ts` 需要自行 bootstrap registry 才能调用 `buildModuleGraphForProject`；该 bootstrap 调用 **MUST** 包裹在 `try/finally` 中，`finally` 块调用同一份 `resetInstance()` 收尾——保证脚本执行完毕后不残留进程级单例状态（脚本进程通常执行完即退出，但显式清理是良好实践，也便于未来该脚本被其他脚本 `import` 复用时不产生隐藏状态泄漏）。`bootstrap-guardrail-registry.ts` 导出的 bootstrap helper 函数**同时被护栏测试与再生脚本调用**（同一份实现，非两份镜像），确保两者对"registry 应处于什么状态才能正确产出 #7/#8 覆盖"的理解始终一致，不会因脚本与测试各自维护一份 bootstrap 逻辑而在未来产生行为分歧。

### 决策 9：pinned 资产消费入口收窄为 typed loader（Q9 处置）

`tests/fixtures/collector-fingerprint-guardrail/expected-graph-only-graph.json`/`expected-module-graph.json` 的外层包装（`{fixtureInputHash, ...}`，见"护栏双轨设计"）会让任何直接 `JSON.parse` 读取该文件的新消费者，若不熟悉包装层，容易误把整份文件当作裸 `GraphJSON`/`ModuleGraph` 传给下游比较器/API（类型层面 `GraphJSON` 接口不含 `fixtureInputHash` 字段，运行时不会报类型错，但语义错误——`.graph`/`.moduleGraph` 嵌套一层未解包）。为此新建 `tests/helpers/pinned-asset-loader.ts`，导出：

```ts
function loadPinnedGraphOnlyAsset(path: string): { fixtureInputHash: string; graph: GraphJSON };
function loadPinnedModuleGraphAsset(path: string): {
  fixtureInputHash: string;
  fingerprint: CollectorFingerprint;
  moduleGraph: NormalizedModuleGraphSnapshot;
};
```

两个函数内部各自校验顶层结构含 `fixtureInputHash: string` 字段（及各自的 `graph`/`fingerprint`+`moduleGraph`），缺失即抛错而非静默返回 `undefined`——作为读取这两份 pinned 资产的**唯一**入口。双轨护栏测试、扰动注入测试组、再生脚本前置一致性校验（P11）**MUST** 都改为调用这两个 loader，而非各自手写 `JSON.parse` + 手动取字段访问路径。未来任何新增消费方同理，**MUST NOT** 把包装文件直接传给要求裸 `GraphJSON`/`ModuleGraph`/`NormalizedModuleGraphSnapshot` 的入口。

## 判定逻辑重排（FR-009 五级优先级）

`evaluateFreshness` 签名扩展为 `evaluateFreshness(recordedSourceCommit: string | null | undefined, projectRoot: string, recordedFingerprint?: unknown): GraphFreshnessVerdict`（新增第三参数，`unknown` 类型因其来源于 `JSON.parse` 后的图产物字段，可能是任意畸形值，交由内部 `isValidCollectorFingerprint` 收口）。

五级优先级实现顺序：

1. `recordedSourceCommit == null` → `unknown-provenance`（不变）
2. `resolveSourceCommit(projectRoot) === null` → `unknown-provenance`（不变，SC-017 回归 oracle 锁定此步骤先于指纹判定生效）
3. **聚合 stale 判定**（新增）：按固定顺序构造 `staleReasons: FreshnessStaleReason[]`——
   - `recordedSourceCommit !== currentHead` → push `'source-commit'`
   - `recordedFingerprint == null` → push `'collector-fingerprint-unrecorded'`（FR-010）
   - 否则若 `!isValidCollectorFingerprint(recordedFingerprint)` → push `'collector-fingerprint-invalid'`（FR-018）
   - 否则若 `!fingerprintsEqual(recordedFingerprint, computeCollectorFingerprint())`（canonical 结构化深比较，非 `JSON.stringify` 字符串相等，见决策 6/W-01）→ push `'collector-fingerprint'`
   - `staleReasons.length > 0` → 返回 `{ state: 'stale', staleReasons, ... }`（数组按上述固定 push 顺序天然确定性，不依赖对象键遍历，满足 SC-007/SC-009 的顺序稳定性要求）
4. dirty 判定（沿用现有 `getDirtySourceFiles`，内部扩展名谓词按决策 4 替换）
5. 否则 `fresh`

`GraphFreshnessVerdict`（`quality-types.ts`）新增：

```ts
export type FreshnessStaleReason =
  | 'source-commit'
  | 'collector-fingerprint'
  | 'collector-fingerprint-unrecorded'
  | 'collector-fingerprint-invalid';

// GraphFreshnessVerdict 新增字段：
staleReasons?: FreshnessStaleReason[];
```

`isValidCollectorFingerprint(value: unknown): value is CollectorFingerprint`（`collector-fingerprint.ts`）是纯结构校验函数，逐层校验：`value` 为非空 object → `formatVersion === 1` → `extensionSurface` 含恰好 4 个预期 key、每个 key 的值含 `extensions: string[]` 与 `matchSemantics` 为 `'case-sensitive' | 'case-insensitive'` 之一 → `behaviorVersion` 为 `number`。任一环节不满足即返回 `false`，全程 `try/catch` 包裹属性访问（不假设嵌套字段存在，避免对 `{}` 或类型错误输入抛未捕获异常，FR-018 硬性要求）。`fingerprintsEqual(a: CollectorFingerprint, b: CollectorFingerprint): boolean`（同文件）先各自重建 canonical 结构再逐字段比较，供本步骤与再生脚本的前置一致性校验（P11）共同消费。

## 护栏双轨设计

### Hermetic fixture 内容清单（`tests/fixtures/collector-fingerprint-guardrail/`）

```text
src/
├── ts/foo.ts, foo.tsx, bar.js, bar.jsx      # #1 tsjsSkeletonWalk 四扩展
├── py/mod.py, mod.pyi                        # #2 pyWalk 两扩展
├── java/Foo.JAVA                              # #3 genericAdapters 大小写变体样本
├── go/main.go                                 # #3 genericAdapters go 扩展
└── module-only/entry.mjs                       # #7/#8 moduleDerivationScan 专属扩展
```

`src/` 子目录是必需的（`buildModuleGraphForProject` 优先扫描 `<root>/src`，若不存在才回退扫全仓根目录——与生产逻辑对齐，见 `module-derivation.ts:357-358`）。

**`module-only/entry.mjs` 内容钉死**（P10）：

```js
import { foo } from '../ts/foo.ts';
export { foo };
```

选择显式带 `.ts` 扩展名的相对路径 import，是为确保该导入能被 `resolveTsJsImport` 的"相对路径"分支（`src/core/import-resolver.ts:264-286`）直接命中——`tryFilePathVariants(base)` 对精确路径优先做 `fs.existsSync` 判定，`base = path.resolve(dirname(entry.mjs), '../ts/foo.ts')` 恰好指向真实存在的 `foo.ts`，第一候选即命中，不依赖扩展名推断歧义或 tsconfig paths alias，解析路径是本仓库既有代码的既定行为而非新假设。

`tests/fixtures/collector-fingerprint-guardrail/README.md` **MUST 追加禁止事项**（P17/I-03）：同目录下禁止新增与既有大小写变体样本（如 `Foo.JAVA`）仅大小写不同的文件（如 `foo.java`）——macOS/Windows 默认文件系统大小写不敏感（case-preserving、非 case-sensitive），两者会被物理系统判定为同一文件，静默覆盖导致 fixture 内容与预期不符，且该错误在 Linux CI 上不可复现（Linux 默认文件系统大小写敏感），构成隐蔽的跨平台不一致风险。

### 两份 pinned 期望资产

- `expected-graph-only-graph.json`：`{ fixtureInputHash: string, graph: GraphJSON }`——`graph` 是对 fixture 跑 `buildAstGraphOnly` 的产物（现有 `writeKnowledgeGraph(..., {stripTimestamps:true})` 已保证 `generatedAt`=epoch；fixture 无 `.git` 故 `sourceCommit=null`，与既有 micrograd fixture 惯例一致），`graph.graph.fingerprint` 含本需求新增字段（记录生成时的 `computeCollectorFingerprint()` 结果）；`fixtureInputHash` 见下方"再生脚本"一节定义。
- `expected-module-graph.json`：`{ fixtureInputHash: string, fingerprint: CollectorFingerprint, moduleGraph: NormalizedModuleGraphSnapshot }`——`moduleGraph` 是对 fixture 跑 `buildModuleGraphForProject` 的产物经 `normalizeModuleGraphSnapshot` 规范化投影后落盘（`ModuleGraph`/`ModuleGraphSchema` 生产 schema 本身不新增字段，避免波及 17 个既有消费方，见 codebase-context.md 对 `ModuleGraph` 消费面的描述）。

两份资产统一采用外层 `{ fixtureInputHash, ... }` 包装（P7/P11），即使这让 `expected-graph-only-graph.json` 不再是"裸的、可直接当作合法生产 `GraphJSON` 使用"的文件——这是有意的取舍：`fixtureInputHash` 必须与两份资产各自记录的 `fingerprint`（前者内嵌于 `graph.graph.fingerprint`，后者顶层 `fingerprint`）一并被再生脚本的前置一致性校验（P11）读取比较，统一包装层比"仅一份有包装、另一份靠 sidecar 文件传递哈希"更简单、不引入第三份资产文件。

**消费约束（Q9，见决策 9）**：所有新消费者读取任一份 pinned 资产 **MUST** 经 `tests/helpers/pinned-asset-loader.ts` 提供的 typed loader 解包，**MUST NOT** 把包装文件（`{fixtureInputHash, ...}`）直接传给任何要求裸 `GraphJSON`/`ModuleGraph`/`NormalizedModuleGraphSnapshot` 的入口——两个 loader 是护栏测试、扰动注入测试组、再生脚本共用的唯一解包入口，避免各处重复手写字段访问路径而遗漏 `fixtureInputHash` 诊断字段的同步读取。

### 双轨 vitest 护栏测试（`tests/unit/guardrail/collector-fingerprint-guardrail.test.ts`）

- **a-track**：`beforeAll` 用 `fs.mkdtempSync` 复制 fixture `src/` 到临时目录 → 调用 `buildAstGraphOnly(tmpDir)` → 用与既有 `graph-semantic-diff.mjs` 不同的**新写**严格结构相等比较（节点 id 集合 + 边 multiset 完全相等，不是"允许清单"式宽松比较——本护栏的目的是"任何未预期差异都必须变红"，与 F214 时代 allowlist 式diff 的设计目标相反，因此不复用 `graph-semantic-diff.mjs`）与（经 `loadPinnedGraphOnlyAsset` 解包的）`expected-graph-only-graph.json` 的 `graph` 比对；额外单独断言 `pinned.graph.graph.fingerprint.behaviorVersion === BEHAVIOR_VERSION`（版本相等断言，FR-005(c)）。
- **b-track**：同一临时目录调用 `buildModuleGraphForProject(tmpDir)` → `normalizeModuleGraphSnapshot` 规范化 → 与（经 `loadPinnedModuleGraphAsset` 解包的）`expected-module-graph.json` 的 `moduleGraph` 深度相等比较；同样断言 `behaviorVersion` 相等。断言 MUST 精确化为 `moduleGraph.modules.length > 0`、`moduleGraph.edges.length > 0` **且**存在一条 `from` 端点为 `entry.mjs` 对应 module id、`to` 端点为 `foo.ts` 对应 module id 的边（P10）——禁止仅断言"非空"（非空断言无法抓住"边数对但端点错"这类假绿）。
- 两 track 均使用独立临时目录（不共享全局 `LanguageAdapterRegistry` 状态污染，见决策 8/"registry 状态隔离"一节）。

### 扰动注入测试组（Phase 4 新增，落地 SC-010(a)，Q4/Q10 处置）

同一测试文件在双轨基础比对用例之外，新增**扰动注入**用例组，构成 SC-010(a) 的三件套自动化证明（详见 spec.md SC-010 校准）：

1. **比较器灵敏度证明**——对 a-track 的真实重建产物（`buildAstGraphOnly` 输出）注入一次语义扰动（如删除一条边、或篡改某节点 `id` 字符串），断言与 pinned graph-only 期望图的严格结构比较器（节点 id 集合 + 边 multiset 完全相等）**必然报不一致**；对 b-track 的真实重建产物（`normalizeModuleGraphSnapshot` 后的投影）同理注入扰动（如删除一个 module 或篡改一条边端点），断言与 pinned 期望 module graph 的深度相等比较**必然报不一致**。此用例组不依赖真实制造一次"behaviorVersion 未 bump 的行为变更"，而是直接证明比较器本身具备检出能力（护栏灵敏度的独立证明，覆盖"比较器逻辑本身写错、永远判一致"这类假绿）。
2. **真实重建绿路径证明**——不注入任何扰动时，a-track/b-track 各自的真实重建产物与 pinned 期望资产比对**必然一致**（已由既有双轨基础用例覆盖，此处交叉引用而非重复实现），证明链路本身处于活性状态，排除"比较器逻辑永远报不一致"的退化假阳性（与 1 互补，缺一不可：只证明"能报错"不能排除"永远报错"，只证明"能通过"不能排除"永远通过"）。
3. **拒绝纯函数真值表**——`tests/unit/collector-fingerprint-regen-predicate.test.ts` 覆盖二元判据 `shouldRejectRegen({ contentMismatch, fingerprintUnchanged })` 的 2×2=4 组合真值表（见"再生脚本"一节），另有独立用例覆盖 `fixtureInputHash` 诊断文案分流（不计入判定真值表，单独测）。

三者合计构成 SC-010(a) 的自动化证明；fixture 未覆盖的语法结构/降级路径的检出边界，由 spec.md「已知残余绕过面」的"fixture 覆盖边界"一条兜底如实标注，不在此测试组内强行扩大证明范围。**quickstart 中的手工演示（拒绝/放行各一个）降级为辅助说明**，用于人工快速直觉验证，不构成 SC-010 的验收证据本体（Q10 处置，避免"改 pinned = 验收 SC-010"的误导，见 quickstart.md 修订）。

### 再生脚本 `scripts/regen-collector-fingerprint-fixtures.ts`

`fixtureInputHash` 定义（**Q1 哈希编码修复**——第一轮实测暴露"路径+原始字节整体拼接"的长度歧义碰撞面，例如两个文件内容分别为 `"ab"`/`"c"` 与 `"a"`/`"bc"` 时，朴素拼接结果可能相同）：对 fixture `src/` 下全部文件，先按相对 POSIX 路径逐个计算 `sha256(文件原始字节内容)`（每个摘要固定 64 hex 字符，消除长度歧义）；再构造 `[{ path, contentSha256 }]` 数组、按 `path` 升序排序；将该数组做 canonical JSON 序列化（固定键序 `path` → `contentSha256`，无额外空白）；最终对该 JSON 字符串整体喂入 `node:crypto` `createHash('sha256')`，取十六进制摘要——纯函数、跨平台确定性（路径统一转 POSIX 分隔符消除平台差异；JSON 字符串的结构化转义天然消除拼接歧义，无需额外分隔符设计）。

流程：

① 计算 fixture `src/` 当前 `fixtureInputHash`。

② **前置一致性校验（P11，Q1 补齐）**：读取两份现有 pinned 资产（经 `pinned-asset-loader.ts` 的 typed loader 解包），分别校验其 `fingerprint`/`graph.graph.fingerprint` 结构合法（`isValidCollectorFingerprint`）**且**彼此 `fingerprintsEqual` 相等，**同时**校验两份资产各自记录的 `fixtureInputHash` 字段彼此相等——三项校验（指纹结构合法、指纹彼此相等、`fixtureInputHash` 彼此相等）任一不满足（结构畸形，或两份资产记录的指纹/输入哈希彼此不一致）即报错退出（"pinned 资产内部不一致，可能被手工绕过脚本直接编辑，请人工核查后重新生成"），不进入后续重建流程。

③ 分别在临时目录重建 a-track/b-track 产物，计算当前 `computeCollectorFingerprint()`。

④ **二元拒绝判据**（Q1 处置，历史见 Complexity Tracking「已否决方案记录」；不保留 `fixtureInputHash` 例外分支）——提取为纯函数 `shouldRejectRegen({ contentMismatch, fingerprintUnchanged }): boolean`，落位 `scripts/lib/collector-fingerprint-regen-predicate.mjs`，逐轨独立求值：

```
contentMismatch ∧ fingerprintUnchanged  → 拒绝（非零 exit code）
!contentMismatch                        → 放行（内容一致，无需更新）
!fingerprintUnchanged                   → 放行（指纹已变化，行为变更已声明）
```

任一轨触发拒绝，两份 pinned 资产**均不落盘**。

`fixtureInputHash` 在此判据中**不参与放行判定**（Q1 降格为纯诊断字段），只用于拒绝时的**错误文案分流**——脚本在拒绝退出前读取当前 `fixtureInputHash` 与 pinned 记录值是否相等，据此二选一打印：

- **`inputHashUnchanged`（fixture 未变）**：`"检测到指纹不可见的行为变更：先 bump behaviorVersion 再跑再生"`（producer 行为漂移场景）。
- **`inputHashChanged`（fixture 已变）**：`"检测到 fixture 基线变更（护栏样本扩充/修改）但指纹未随之变化：这等同行为面变化，请 bump behaviorVersion 声明基线变化后再跑再生"`（fixture 基线变更场景——**Q1 新定义**：fixture 输入变化不再是自动放行的合法路径，而是同样需要 bump 纪律覆盖的行为面变化，因为二元判据不再有 `fixtureInputHash` 例外分支，`contentMismatch ∧ fingerprintUnchanged` 在纯 fixture 扩充场景下同样为真，会被同一判据拦下）。

组合场景（fixture 输入与行为逻辑同时变化）同理由二元判据 + bump 纪律覆盖：只要 `behaviorVersion` 已显式 bump（`fingerprintUnchanged` 为假），无论 fixture 是否同时变化，判据均放行——这是 spec.md「已知残余绕过面」"组合变更残余面"一条已接受的残余（指纹一旦因扩展面变化而自动不同，无法单独判定内容变化是否全部由扩展面变化解释），本次修订不改变该残余的接受范围，只是把"fixture 单独扩充"从"自动放行"移正为"同样需要 bump"。

⑤ 放行时的**双资产写盘：备份 + 回滚方案**（Q5 处置，替代第一轮"临时文件 + 全部 rename"方案）：

1. 先将两份现有正式 pinned 文件分别备份为 `<filename>.bak`（`fs.copyFileSync` 或等价操作，两份均备份成功才进入下一步）。
2. 依次先写临时文件 `<filename>.tmp-<pid>`、再 `fs.renameSync` 用新内容覆盖两份正式 pinned 文件（避免半写状态）。
3. 两份均成功覆盖后，删除两份 `.bak` 备份文件，流程结束（放行成功）。
4. **任一步骤失败**（备份失败/临时文件写入失败/rename 失败）：按逆序回滚——已完成 rename 的文件从对应 `.bak` 还原（`fs.renameSync(bak, original)` 或等价操作），未完成 rename 的文件保持原状不动，最终清理残留的 `.tmp-*`/`.bak` 文件。**进程崩溃窗口的残余**（如脚本在步骤 2 与步骤 3 之间被强制杀死，`.bak` 文件残留在磁盘）如实标注为已知限制——本脚本是开发者手动触发的本地 dev 脚本（非 CI 自动化关键路径），该窗口内的残余可接受，人工重跑脚本或手工清理 `.bak` 即可恢复。

该 swap 逻辑（备份 → 覆盖 → 清理 / 回滚）提取为 `scripts/regen-collector-fingerprint-fixtures.ts` 文件内**可注入 `fs` 的独立导出函数**（不新增独立 lib 文件，方便测试直接 `import`），签名形如 `export async function swapPinnedAssets(pairs: Array<{ path: string; content: string }>, fsImpl: PinnedAssetFsLike = fs): Promise<void>`（`fsImpl` 参数默认使用真实 `node:fs`，测试注入 mock 实现）。`tests/unit/pinned-asset-swap.test.ts` 单测注入"第二次 `rename` 失败"的 mock `fsImpl`，断言：(a) 已完成的第一份 rename 被回滚（内容还原为回滚前的原始字节）；(b) 两份正式 pinned 资产的最终字节内容与调用前完全一致；(c) 不残留 `.tmp-*` 文件。脚本级测试（`tests/integration/collector-fingerprint-regen-script.test.ts`）保留"拒绝路径下两份 pinned 资产字节内容不变"的既有断言（P16 既定要求，不因写盘方案调整而削弱）。

npm script 入口：`npm run fixtures:regen:collector-fingerprint`（= `npx tsx scripts/regen-collector-fingerprint-fixtures.ts`，P12）；脚本另支持 `--fixture-root <path>` 参数用于测试隔离（决策 7）。

## 消费方改造

| 消费方 | 改动点 | 对应 FR |
|--------|--------|---------|
| `src/cli/commands/graph-quality.ts` | `buildReport` 内 `evaluateFreshness` 调用新增第三参数传入 `graph.graph.fingerprint`；`buildNextSteps` 新增按 `staleReasons` 分支的文案（区分 `source-commit`/`collector-fingerprint`/`collector-fingerprint-unrecorded`/`collector-fingerprint-invalid`）；`formatReportText` 的 `[freshness]` 行追加 `staleReasons` 展示；`computeOverallVerdict` 不变（`stale` 已映射 `pass-with-warnings`，指纹型 stale 复用同一路径，天然满足 FR-011 的"不低于 sourceCommit 同级"） | FR-011/FR-013 |
| `scripts/lib/graph-quality-core.mjs` | `freshness` check 段落的 warning 文案改为按 `report.freshness.staleReasons` 拼接具体原因描述，而非固定"sourceCommit 不一致"字样；`createCheck('freshness', ...)` 的 `evidence` 对象同步新增 `staleReasons: report.freshness.staleReasons ?? []` 字段透传（C-05：文案与 evidence 两处均须透传，不能只改人读文案而漏结构化字段） | FR-012/FR-013 |
| `scripts/lib/graph-bootstrap-status.mjs` | `checkFreshness` 返回对象新增 `staleReasons: freshness.staleReasons ?? []` 透传字段；`FRESHNESS_STATES`/`ACCEPTED_FRESHNESS_EXIT_CODES` 不变（状态枚举本身未变） | FR-013 |
| `specs/217-graph-quality-gates/contracts/graph-quality-report.schema.json` | `$defs.GraphFreshnessVerdict.properties` 新增 `staleReasons`（`type: array, items: {type: string, enum: [...]}`），`required` 不含它（可选字段，向后兼容） | FR-009 |
| `tests/unit/contracts/graph-quality-report-schema.test.ts`（新建） | 手写结构校验（无 `ajv` 依赖，符合零新增依赖约束）：读取 schema.json，对照实际 `GraphQualityReport` 样例对象逐层核对 `required`/`additionalProperties`/`enum` 约束是否被遵守，覆盖 SC-009 五类样本 | FR-009 |

## 测试矩阵（20 条 SC → 落点，均为 vitest include glob 可达的真实路径）

| SC | 测试文件 | 用例要点 |
|----|---------|---------|
| SC-001 | `src/panoramic/graph/collector-fingerprint.test.ts`（bump 半段，Phase 2 后可绿）+ `src/panoramic/graph/source-commit.test.ts`（freshness 判定半段，Phase 3 后完整生效） | bump `BEHAVIOR_VERSION` 前后指纹不同；旧指纹对新版本判非 fresh |
| SC-002 | `src/panoramic/graph/collector-fingerprint.test.ts`（**Phase 2** 落地 partial：仅 `extensionSurface` 子分量自动变化半段，Q3 处置：不在 Phase 1 绿名单）+ `src/panoramic/graph/source-commit.test.ts`（**Phase 3** 落地完整段：freshness 判定半段，需 `evaluateFreshness` 三参签名与判定链路完整生效，第三轮审查回写处置） | Phase 2：新增测试专用扩展名后 `extensionSurface` 子分量自动变化；Phase 3：用扩展前记录的指纹对扩展后版本运行 freshness 判定，结果非 `fresh` |
| SC-003 | `src/panoramic/graph/source-commit.test.ts` | `recordedSourceCommit`/`currentHead` 均非空、fingerprint=`undefined` → 100% stale + `collector-fingerprint-unrecorded` |
| SC-003b | `src/panoramic/graph/source-commit.test.ts` | `recordedSourceCommit` 缺失 → 100% `unknown-provenance`，不受 fingerprint 状态影响 |
| SC-003c | `src/panoramic/graph/source-commit.test.ts` | fingerprint=`null` + `recordedSourceCommit` 非 null → `collector-fingerprint-unrecorded`，非 fresh、不抛异常 |
| SC-004 | `src/panoramic/graph/source-commit.test.ts`（**Phase 1** 落地 partial：dirty/fresh 现状回归半段，不含指纹一致场景 + **Phase 3** 落地完整段：指纹一致场景 fresh，第三轮审查回写处置） | Phase 1：含既有 `.TS`（翻转为 dirty，见决策 4）与新增 `.PY`（保持 fresh 反例）两条 C-04 用例；Phase 3：fingerprint、sourceCommit 均一致场景 100% fresh（SC-004 完整达成） |
| SC-005 | `tests/unit/collector-surface.test.ts`（原计划误放 `src/collector-surface.test.ts`，该路径不被任一 vitest project include glob 覆盖，属 zero-execution，本版本迁移） | (a1) 公开 seam 处运行时引用同一性 `===`（覆盖 #7 `ts-js-adapter.ts`、#4 `DIRTY_SOURCE_SURFACES` re-export 本身、**#3** `new JavaLanguageAdapter().extensions === JAVA_ADAPTER_SURFACE.extensions`（`GoLanguageAdapter`/`GO_ADAPTER_SURFACE` 同理，第三轮审查回写补齐——原 a1 清单遗漏 #3）；(a2) 私有函数管线/无公开 seam 落点处 ts-morph AST import 断言 + 无本地扩展名字面量重声明 oracle（覆盖 #1 `walkTsJsFiles`、#2 `walkPyFiles`、#5 `ignore-oracle.ts`、#6 `cache-key-builder.ts`、**#4 `source-commit.ts` 内部消费谓词**（与 a1 对 `DIRTY_SOURCE_SURFACES` 导出本身的断言构成双重覆盖）、**#8 `module-derivation.ts` fallback**（值被赋给函数局部变量，无外部可持有的运行时 seam，改用 AST oracle，Q2.3 由 a1 移正到此处）；(b) 行为探针：临时目录多扩展名+大小写变体样本实跑各管线 walk/scan，抓住"引用/AST 校验通过但运行时行为未对齐"的假绿，对 #8 fallback 分支单独覆盖此探针 |
| SC-006 | 人工审查（记录于 verification 阶段） | 见下方标注 |
| SC-007 | `src/panoramic/graph/source-commit.test.ts` | commit 一致+fingerprint mismatch+工作树脏 → stale 非 dirty；多次运行 `staleReasons` 顺序一致 |
| SC-008 | `src/panoramic/graph/source-commit.test.ts` | `.pyi`/`Foo.JAVA`/`foo.MJS` 未提交改动均触发 dirty |
| SC-009 | `tests/integration/graph-quality-cli.test.ts` + `tests/unit/graph-quality-core.test.ts` + `tests/unit/graph-bootstrap-status.test.ts` + `tests/unit/contracts/graph-quality-report-schema.test.ts` | 五类样本（含多原因并存）在四个消费面文案**与 evidence**均准确、顺序稳定 |
| SC-010 | `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts`（含扰动注入测试组，Q4）+ `tests/unit/collector-fingerprint-regen-predicate.test.ts`（二元判据真值表 + `fixtureInputHash` 诊断分流独立用例）+ `tests/integration/collector-fingerprint-regen-script.test.ts` + `tests/unit/pinned-asset-swap.test.ts` | (a) 比较器灵敏度（扰动注入必红）+ 真实重建绿路径（活性证明）+ 拒绝纯函数真值表三件套（见"护栏双轨设计"扰动注入测试组）；(b) 再生脚本二元判据拒绝机制生效——纯函数真值表覆盖 + 脚本级子进程在临时副本上实跑验证非零退出/文案/字节不变 + 写盘回滚单测验证失败注入后字节不变 |
| SC-011 | `tests/unit/batch-orchestrator.test.ts` + `tests/batch/graph-only-pipeline.test.ts` | batch 主链与 graph-only 写入路径产出图均含合法 fingerprint；与 `collector-fingerprint.test.ts` 交叉断言 byte-identical |
| SC-012 | `tests/integration/graph-command-sourcecommit.test.ts` | `spectra graph` 命令产出 fingerprint=null |
| SC-013 | `src/panoramic/graph/collector-fingerprint.test.ts`（**Phase 2** 落地 partial：公共导出可访问性 + 自身产出确定性半段）+ `tests/unit/batch-orchestrator.test.ts` / `tests/batch/graph-only-pipeline.test.ts`（**Phase 3** 落地完整段：写入点存在后才能做的 byte-identical 交叉断言，Q3 处置） | Phase 2：可被外部模块 import（含从 barrel `index.ts`）+ 自身产出确定性；Phase 3：与 batch 主链、graph-only 写入路径实际写入图 metadata 的指纹值 byte-identical |
| SC-014 | `src/panoramic/graph/collector-fingerprint.test.ts` | (a) 两个独立 node 子进程 spawn 对比 `JSON.stringify` 序列化输出 byte-identical；(b) 序列化结构断言不含时间戳/绝对路径 |
| SC-015 | `tests/unit/collector-surface.test.ts` | ts-morph 静态解析 `collector-surface.ts` 源文件 import 声明 ⊆ Node 内建模块集合 |
| SC-016 | `src/panoramic/graph/collector-fingerprint.test.ts` | `BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES` 覆盖 FR-004 六类条件 |
| SC-017 | `src/panoramic/graph/source-commit.test.ts` | 非 git 仓库场景，fingerprint 任意状态均不改变 `unknown-provenance` 短路结果 |
| SC-018 | `tests/integration/graph-quality-cli.test.ts`（:200 既有 1.0 用例，断言维持不变） | schemaVersion=1.0 fixture 100% `schema-too-old`，不进入 freshness 分支 |

**SC-006 标注**：属人工审查项（"经人工审查确认告警级别不低于 sourceCommit 型 stale"），不产出自动化断言；在 verification 阶段由人工核对 `buildNextSteps`/`graph-quality-core.mjs` warning 文案的严重度措辞后记录结论，不在本计划的自动化测试矩阵中强行编造断言。

## 风险与回滚

### R4 十项防守逐一落位

| R4 防守项 | 落位方案 |
|-----------|---------|
| 1. SC-015 静态依赖 oracle 语法覆盖 | `tests/unit/collector-surface.test.ts` 用 TypeScript 编译器 API（`ts-morph`，本仓库 `package.json` 已确认依赖 `^24.0.0`，无需新增）解析源文件顶层 `import`/`export ... from`/`require(`/动态 `import(` 语句，断言模块说明符集合 ⊆ `node:module` 的 `builtinModules`（含 `node:` 前缀与裸名两种形态）——不使用正则兜底（W-07/P14，正则解析 import 语句在字符串字面量/注释场景下不可靠，与 ts-morph 已确认可用的既有依赖相比无收益） |
| 2. SC-017 前置条件 | `source-commit.test.ts` 新增用例：真实临时非 git 目录（或 mock `execFileSync` 抛错）+ 固定非空 `recordedSourceCommit='abc123'` + fingerprint 分别为合法/`undefined`/畸形三种输入，断言三者结果均为 `unknown-provenance` |
| 3. #4/#5/#6 双面校验 | 结构引用断言（`===`）之外，`collector-surface.test.ts` 额外对每条管线在临时目录放置样本文件后实跑该管线真实函数（`walkTsJsFiles`/`walkPyFiles`/`createIgnoreOracle`/cache 扫描/`generic-language-skeleton-collector` walk），断言采集结果与 SSoT 声明面一致 |
| 4. b-track ModuleGraph 规范化投影 + fixture 断言精确化 | 见"关键架构决策"决策 7；`normalizeModuleGraphSnapshot` 落位 `tests/helpers/`，fingerprint 记录在 pinned 资产包装层，不扩散进生产 `ModuleGraphSchema`；`module-only/entry.mjs` 内容钉死（见"护栏双轨设计"），b-track 断言精确到 `modules.length > 0`/`edges.length > 0` 且存在指定端点的边，不满足于"非空"（P10） |
| 5. registry 状态隔离 | 见"关键架构决策"决策 8（**Q7 更新**）：护栏测试与再生脚本共用 `tests/helpers/bootstrap-guardrail-registry.ts`；主用例 `beforeEach` 中 `LanguageAdapterRegistry.resetInstance()`（既有 test-only API）后重新注册 ts-js adapter 覆盖 #7 路径，fallback 用例 `beforeEach` 中 `resetInstance()` 后不注册覆盖 #8 路径，**两者均在 `afterEach` 中调用 `resetInstance()` reset-to-empty**（对齐 `tests/unit/batch-orchestrator.test.ts:71` 既有惯例，不做"重新标准 bootstrap"）；再生脚本自身 bootstrap 调用包裹在 `try/finally` 中、`finally` 同样 `resetInstance()` 收尾；两 track 使用互不共享的独立临时目录（P9） |
| 6. 再生脚本双资产写盘 | **Q5 处置**：由"临时文件+全部 rename"改为"备份（`.bak`）→ 覆盖（临时文件+rename）→ 清理"三段式，任一环节失败按逆序回滚（已完成 rename 的文件从 `.bak` 还原），进程崩溃窗口残余如实标注为 dev 脚本可接受的已知限制；swap 逻辑提取为 `scripts/regen-collector-fingerprint-fixtures.ts` 内部可注入 `fs` 的独立导出函数 `swapPinnedAssets`（非新增独立 lib 文件，方便测试直接 import），`tests/unit/pinned-asset-swap.test.ts` 单测注入"第二次 rename 失败"断言回滚后两份正式资产字节内容与调用前完全一致、且不残留 `.tmp-*` 文件（P15） |
| 7. staleReasons 全消费面同步 | 见"消费方改造"表格，五处（类型定义/schema/契约测试/CLI 文本+JSON/repo:check 文案+evidence/bootstrap-status）逐一列出，无遗漏（C-05：repo:check 侧文案与 evidence 均需透传） |
| 8. 确定性测试环境钉死 | SC-014a 的双子进程测试固定 `cwd`（临时目录的同一路径字符串传给两个子进程）、固定 `env`（`{ ...process.env }` 快照，不受父进程后续变化影响）、固定入口脚本（同一份 `-e` 求值代码或同一临时 `.mjs` 文件）；护栏重建耗时预算留空待 tasks 阶段用本 fixture 实测填入，不预先编造数字 |
| 9. 再生脚本拒绝判据可测性 | **Q1 处置**：二元判据（内容不一致 ∧ 指纹相等）提取为纯函数 `shouldRejectRegen()`（落位 `scripts/lib/collector-fingerprint-regen-predicate.mjs`），`tests/unit/collector-fingerprint-regen-predicate.test.ts` 覆盖 2×2=4 组合真值表；`fixtureInputHash` 降格为诊断字段，其分流逻辑（拒绝场景下选择哪条错误文案）由**独立用例单独测**（不计入判定真值表）；`tests/integration/collector-fingerprint-regen-script.test.ts` 在临时副本上实跑脚本本体（`--fixture-root` 参数支持隔离），断言拒绝场景下非零退出码、stderr 含对应文案（按 `fixtureInputHash` 状态区分两种文案）、两份 pinned 资产文件字节内容不变（P16） |
| 10. 指纹比较 canonical 化 | `isValidCollectorFingerprint` 校验通过后，`fingerprintsEqual()` 先重建 canonical 结构（固定键序 + 各 `extensions` 数组排序）再逐字段深比较，不依赖 `JSON.stringify` 字符串相等（`recordedFingerprint` 来自外部 `JSON.parse`，字面键序不受本模块控制）；`JSON.stringify` 仅保留用于 SC-014 的序列化输出确定性验收（W-01） |

### graph.json fixture（`tests/fixtures/micrograd-baseline-graph`）是否受影响

**结论：不重新生成**。理由：
1. `fingerprint` 是可选新增字段，现有 6 个消费该 fixture 的测试文件（4 E2E + 2 集成）均不断言 `graph.graph.fingerprint` 的存在性或值，`fingerprint` 缺失时这些测试的既有断言路径不受影响。
2. 若强行重生成，该 fixture 的 producer 会变为"含 F249 改动的 dist"，其 README 的 provenance 记录需再次更新（producer commit 链），且 33 节点/38 边计数预期不变（F249 不改变节点/边生成逻辑，只新增 metadata 字段）——重生成收益为零、维护成本非零，故不做。
3. 若未来某个消费测试新增"graph.json 必须含 fingerprint"式断言（例如验证 CLI 端到端读取该 fixture 时不判定 `collector-fingerprint-unrecorded`），则需要在**那个新增断言的需求**里显式重生成，而非在本次机制性需求里预先重生成一个当前无人消费的字段。

## 实施顺序（5 Phase，对应 HIGH 风险强制分阶段要求；由 Codex plan 审查 C-01/C-06 裁决后由 6 Phase 重构而来；Q3/Q4/Q5/Q6 于第二轮回写中修正绿名单、验证命令与写盘方案；第三轮回写进一步校准 SC-002/SC-004 的 partial/完整声明边界，保证任何 SC 只在其全部依赖实现落地的 Phase 才声明完整绿）

| Phase | 内容 | 独立验证点 | SC 绿名单 |
|-------|------|-----------|-----------|
| **Phase 1：SSoT 收敛 + dirty 判定语义翻转** | 新建 `src/collector-surface.ts`（含公开 seam `DIRTY_SOURCE_SURFACES`）；改造 #1/#2/#3/#7/#8 五处生产者引用；改造 #4/#5/#6 三处消费方引用（#4 `getDirtySourceExtensions` 移除，替换为消费 `DIRTY_SOURCE_SURFACES` 的逐管线谓词）；`source-commit.test.ts:272` 附近既有 `.TS→fresh` 用例按决策 4 翻转为 `.TS→dirty`，新增 `.PY→fresh` 反例 | `npx vitest run tests/unit/collector-surface.test.ts src/panoramic/graph/source-commit.test.ts src/panoramic/graph/quality/ignore-oracle.test.ts` + `npm run build` 零错误 | **SC-004（partial：仅 dirty/fresh 现状回归半段，含 C-04 两条用例；"fingerprint 一致场景 fresh"的完整语义依赖 Phase 3 才完整生效的判定链路，移入 Phase 3 完整声明，第三轮审查回写处置）**/ SC-005（a1/a2/b 中不依赖指纹的部分）/ SC-008 / SC-015（**Q3 处置**：SC-002 已移出本 Phase——该 SC 依赖 Phase 2 才新建的 `collector-fingerprint.ts`，Phase 1 尚不存在该模块，不可能在此绿） |
| **Phase 2：指纹计算模块 + barrel re-export** | 新建 `src/panoramic/graph/collector-fingerprint.ts`（类型 + `computeCollectorFingerprint` + `isValidCollectorFingerprint` + `fingerprintsEqual` + `BEHAVIOR_VERSION`/`BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES`）；`src/panoramic/graph/index.ts`（既有 barrel）新增指纹 API re-export（W-06） | `npx vitest run src/panoramic/graph/collector-fingerprint.test.ts`（含一条从 barrel `index.ts` import 可访问的用例） + `npm run build` | SC-001（bump 半段）/ **SC-002（partial：仅"新增扩展名后 `extensionSurface` 子分量自动变化"半段，Q3 移入本 Phase，测试文件 `collector-fingerprint.test.ts` 在本 Phase 首次存在；"用扩展前的图对扩展后版本运行 freshness 判定、结果非 fresh"半段依赖 Phase 3 才完整落地的 `evaluateFreshness` 三参签名与判定链路，移入 Phase 3 完整声明，本 Phase 不声称完整达成，第三轮审查回写处置）**/ **SC-013（partial：导出可访问性 + 自身产出确定性半段，Q3 处置——完整 byte-identical 交叉断言需 Phase 3 的两条写入点落地后才可执行，本 Phase 不声称完整达成）**/ SC-014 / SC-016 |
| **Phase 3（原子兼容 Phase，多数任务不可拆分提交）：判定重排 + 三写入点 + 消费方改造 + schema 升级** | `evaluateFreshness` 五级优先级重排 + `staleReasons`（指纹比较用 `fingerprintsEqual`）；三写入点（`batch-orchestrator.ts`/`graph-assembly.ts`/`graph.ts`）+ `graph-types.ts` 新增 `fingerprint` 字段；`graph-quality.ts` CLI 文案/nextSteps 按 `staleReasons` 分支；`graph-quality-core.mjs` warning 文案**与 evidence** 均透传 `staleReasons`；`graph-bootstrap-status.mjs` 透传 `staleReasons`；`graph-quality-report.schema.json` 升级 + 契约测试；既有 `graph-quality-cli.test.ts:112`/`:125` 等期待 `fresh`/`pass` 的用例全部更新为传入合法当前 fingerprint（否则因 FR-010 归入 `collector-fingerprint-unrecorded` 而不再是 `fresh`）；**tasks 阶段审查裁决**：SC-018 回归 oracle 验证任务（既有行为无耦合）移出原子提交范围、可独立提交，其余判定重排/写入点/消费方改造任务仍须同一提交落地 | `npx vitest run src/panoramic/graph/source-commit.test.ts tests/unit/graph-quality-core.test.ts tests/unit/graph-bootstrap-status.test.ts tests/integration/graph-quality-cli.test.ts tests/unit/contracts/graph-quality-report-schema.test.ts tests/unit/batch-orchestrator.test.ts tests/batch/graph-only-pipeline.test.ts tests/integration/graph-command-sourcecommit.test.ts`（**Q3 补齐**：后三个文件对应 SC-011/SC-012/SC-013 完整段，第一轮版本遗漏） + `npm run build`。**如实声明**：本 Phase 结束后本仓自身 `specs/_meta/graph.json` 仍无 `fingerprint` 字段（未重建），`npm run repo:check` 会出现 freshness warn（`source-commit` + `collector-fingerprint-unrecorded` 双原因）——**这是预期过渡态**，由 Phase 5 Closure 消解，MUST NOT 声称"与改动前一致" | SC-001（完整）/ **SC-002（完整：补齐"用扩展前的图对扩展后版本运行 freshness 判定、结果非 fresh"的 freshness 判定半段，需本 Phase 完整落地的三参 `evaluateFreshness` 判定链路，第三轮审查回写处置）**/ SC-003 / SC-003b / SC-003c / **SC-004（完整：补齐"fingerprint、sourceCommit 均一致场景 100% fresh"完整语义，第三轮审查回写处置——Phase 1 只声明 dirty/fresh 现状回归半段）**/ SC-006（人工）/ SC-007 / SC-009 / SC-011 / SC-012 / **SC-013（完整：与两条写入路径 byte-identical 交叉断言，Q3 处置）**/ SC-017 / SC-018 |
| **Phase 4：护栏资产 + 扰动注入测试组** | hermetic fixture（含精确 `entry.mjs` 内容 + README 案例边界警示）+ 两份统一包装的 pinned 资产（`{fixtureInputHash, ...}`，经 typed loader 消费，Q9）+ 双轨 vitest 护栏测试（registry 生命周期 reset-to-empty，断言精确到边端点）+ **扰动注入测试组**（Q4/SC-010(a) 三件套自动化证明：比较器灵敏度 + 真实重建绿路径 + 拒绝纯函数真值表）+ 再生脚本（**二元判据**（Q1）+ 前置一致性校验（指纹与 `fixtureInputHash` 双重，Q1）+ 备份/回滚写盘（Q5）+ 拒绝判据纯函数化 + 诊断文案分流）+ npm script `fixtures:regen:collector-fingerprint`。**tasks 阶段审查裁决（依赖边界细化）**：本 Phase 内 fixture 源码/normalize helper/registry helper/typed loader/纯判据函数等准备类任务不依赖 Phase 3、可与之并行；种子资产生成起的产物生成/护栏运行类任务依赖 Phase 3 原子组收口（`fingerprint` 写入点与字段类型须已在最终形态） | `npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts tests/unit/collector-fingerprint-regen-predicate.test.ts tests/integration/collector-fingerprint-regen-script.test.ts tests/unit/pinned-asset-swap.test.ts`；手动跑 quickstart 两个演示（拒绝/放行）作**辅助**直觉验证（Q10：不构成 SC-010 验收证据本体，验收证据是左侧列出的自动化测试） | SC-005（b 完整）/ SC-010（三件套自动化证明 + 二元判据真值表达成，非仅手工演示） |
| **Phase 5：Closure（处置 C-06，Q6 时序精确化）** | 执行序：①确认 Phase 1-4 全部源码改动已完成且测试全绿 → ②`npm run build` → ③`node dist/cli/index.js batch . --mode graph-only`（重建本仓图，落 fingerprint 到 `specs/_meta/graph.json`）→ ④全量 `npx vitest run` + `npm run build` + `npm run repo:check`（此时 freshness check 应恢复 `pass`，不再出现 Phase 3 声明的过渡态 unrecorded/stale warn）→ ⑤最终 commit | 核对最终图 `specs/_meta/graph.json` 含当前 `computeCollectorFingerprint()` 结果，`npm run repo:check` 的 freshness check 从 Phase 3 声明的过渡态 warn 恢复 `pass`；全量测试与构建零失败/零错误。**显式注明（Q6）**：本 Phase 完成 commit 后，HEAD 前进、本地图转 source-commit stale warn 是本仓既有稳态（`specs/_meta/` 已 `.gitignore`，图文件本身非 tracked 变更；下次开发会话重建即净），**非 F249 缺陷**，不需要也不应该为此在本 Phase 内额外补一次"commit 后再重建"的循环 | 收口：确认 Phase 1-4 全部 SC 在本仓自身语境下仍成立（非仅 fixture 语境） |

每个 Phase 结束后运行一次全量 `npx vitest run` + `npm run build` + `npm run repo:check`。Phase 1-2 预期 `repo:check` 结果与改动前一致（尚未触达新判定逻辑）；**Phase 3 结束时 `repo:check` 的 freshness 检查预期出现 warn**（本仓自身图尚无 fingerprint，见 Phase 3 验证点的过渡态声明），这是本次改动生效的直接证据而非回归；Phase 4 该 warn 依旧存在（护栏资产不改变本仓自身图状态）；**Phase 5 Closure 重建本仓图后该 warn 消解**，`repo:check` 恢复全绿（commit 后因 HEAD 前进再次出现的 source-commit 型 warn 是既有稳态，见 Phase 5 内容列的显式注明，不视为回归）。

## Complexity Tracking

| 偏离 | 为何需要 | 拒绝的更简单替代方案 |
|------|---------|---------------------|
| SSoT（`collector-surface.ts`）与指纹计算（`collector-fingerprint.ts`）拆两个文件而非合一 | SSoT 需满足零依赖叶子约束（FR-019），指纹计算逻辑（校验/版本演进语义）天然会引入 `CollectorFingerprint` 类型与后续可能的 `node:crypto`/序列化辅助——把两者合一会让"零依赖"这条硬约束的验证面（SC-015 的静态 import 扫描）意外扩大到整个指纹计算逻辑，增加未来维护者不慎在指纹计算里加一行 `import` 就破坏 FR-019 的风险 | 合并为单文件：被拒绝——会让 SC-015 的静态扫描断言覆盖面模糊化（"这个文件到底哪部分必须零依赖"），且未来指纹格式演进（尽管本迭代 FR-016 已 YAGNI 掉多版本兼容）若要加逻辑，会被迫在同一文件里权衡"能不能 import"，增加认知负担 |
| 双轨（a-track + b-track）护栏而非单轨 | R3 对抗审查已证实单轨（仅 graph-only 重建对比）存在护栏盲区（`moduleDerivationScan` 仅 full batch 消费，graph-only 链路不执行该管线） | 单轨：已被 spec 自身的 R3 审查证伪，非本计划引入的新复杂度，延续 spec 已定案决策 |
| Phase 3 合并三个原本独立的子改动（判定重排/写入点/消费方改造）为单一原子 Phase | Codex plan 审查 C-01 指出原 6-Phase 方案会在 Phase 3→4→5 之间产生"新签名已生效但无人写入/无人消费"的中间态断裂，任一断裂点若被误当独立提交点会让仓库处于逻辑不一致（非编译错误，但行为矛盾）的状态 | 保持三个独立 Phase：被拒绝——三者任一单独存在都不具备"完整可验证的行为闭环"（如"写入点已加但消费方未改文案"无法验证 reason-aware 行为是否正确），拆分只是形式上更细粒度，未换来真实的独立验证价值 |
| **[已否决方案记录]** 三元判据——再生脚本拒绝判据额外设 `fixtureInputHash` 未变例外分支（即 `fixtureInputHash` 参与放行判定），已被 Plan R2 审查否决，回归 spec FR-005(e) 原文的二元判据（`内容不一致 ∧ 指纹相等 → 拒绝`，无例外分支）；**本记录为全文唯一保留的三元判据历史说明，其余位置只保留二元判据的当前表述，此记录防止未来重新引入** | 否决理由三项，任一独立成立即否决：①**编码可构造碰撞**——`fixtureInputHash` 的哈希编码本身（第一轮"排序路径+原始字节整体拼接"版本）存在可构造的长度歧义碰撞面，依赖一个可被构造碰撞的诊断字段去充当放行判据的例外分支，会把攻击面引入本应只做"内容 ∧ 指纹"两维判断的核心安全判据；②**"行为+fixture 同时变"绕过**——三元判据下"fixture 单独扩充"自动放行，但 fixture 是护栏所验证的行为契约基线，其扩充/修改理应与抽取逻辑本身变化同等对待，都需要 bump 纪律留痕，三元例外分支会让这类真实行为面变化绕过纪律；③**与 spec FR-005(e) 二元 MUST 冲突**——spec 原文将拒绝判据定义为二元 MUST，三元例外分支属于对该 MUST 的隐性放宽，需要显式豁免论证才能维持，而该豁免未通过 R2 审查 | 保留三元判据：被拒绝——上述三项理由任一均足以否决，且判据真值表从 2² 膨胀到 2³，测试矩阵与文案分支同步膨胀，是不必要的复杂度增加，故方向性撤回回归二元 |
| 双资产写盘用"备份+回滚"而非"纯 rename 无回滚" | rename 系统调用本身是原子的，但"两份文件的 rename"这一复合操作不是原子的——第一份 rename 成功、第二份失败时，若无备份，无法把第一份还原到与第二份一致的旧状态，会留下"一份新一份旧"的不一致 pinned 资产对（两份资产的 `fixtureInputHash`/`fingerprint` 理应彼此一致，见前置一致性校验 P11，不一致状态会在下次运行时触发误报） | 纯 rename 无回滚：被拒绝——无法处理"第二份 rename 失败"这一失败模式，会产出不一致的 pinned 资产对，且下次运行前置一致性校验会因此报错阻塞，代价高于备份/回滚方案增加的少量实现复杂度 |
