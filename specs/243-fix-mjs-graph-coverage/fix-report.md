# 问题修复报告

## 问题描述

仓库 `plugins/` 下全部 84 个 `.mjs` 文件（spec-driver 插件的所有脚本与 core 纯函数）结构性不在 Spectra 知识图谱内，对它们查 `impact` / `context` 一律 `symbol-not-found` 且 `fuzzyMatches` 为空，插件侧 caller analysis 长期只能退回 Grep。

- M9 §7.5.4（`docs/design/milestone-M9-codex-trusted-live-graph.md:254`）将其登记为「覆盖面盲区」：B 轨把 `src/**` 的 contains 覆盖打到 100%、孤立率 1.9%，但 `plugins/**` 这条与 Spec Driver 自身演进强相关的代码树整体在图外。
- F241（B/E 轨收口）完成评估后显式登记 out-of-scope，由本任务（F243）承接。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 对 plugins/*.mjs 的 symbol 查 impact/context 为何 symbol-not-found？ | 知识图谱中不存在这些文件对应的 module/symbol 节点 |
| Why 2 | 图中为何没有这些节点？ | batch 建图的源发现阶段 `collectTsJsCodeSkeletons` 未把 `.mjs` 文件列入扫描结果 |
| Why 3 | 源发现为何漏掉 `.mjs`？ | `walkTsJsFiles`（`src/batch/stages/source-discovery.ts:509-514`）扩展名白名单只收 `.ts/.tsx/.js/.jsx`，不含 `.mjs/.cjs` |
| Why 4 | 白名单为何与实际支持面脱节？ | `TsJsLanguageAdapter.extensions`（`src/adapters/ts-js-adapter.ts:41-43`）早已声明支持 `.ts/.tsx/.js/.jsx/.mjs/.cjs/.mts/.cts`（8 扩展），且 `import-resolver.ts` 的 `TS_EXTENSIONS`（L91）与 `module-derivation.ts:352-354` 消费面也均含 `.mjs/.cjs`；但 Feature 152 引入的 batch collector walk 白名单独立硬编码为 4 扩展，此后 adapter 声明面扩充时 walk 未同步——**walk 扫描面与 adapter 声明面脱节** |
| Why 5 | 脱节为何未被现有机制捕获？ | F217 图质量门六指标只度量「图内节点」的质量（orphan/contains/dangling），不度量「应入图而未入图」的覆盖缺口；且 `source-commit.ts` FIX-4 与 `ignore-oracle.ts` 的镜像常量是「镜像 collector 实际扫描面」的设计（有防漂移测试守护镜像一致性，但镜像的就是残缺的 4 扩展面），一致性测试反而固化了盲区 |

**Root Cause**: batch collector 的 `walkTsJsFiles` 扩展名白名单（4 扩展硬编码）与 `TsJsLanguageAdapter.extensions` 声明面（8 扩展）脱节，`.mjs/.cjs` 在源发现层被静默排除，且质量门只测图内质量、不测覆盖缺口，脱节长期不可见。

**Root Cause Chain**: impact/context symbol-not-found → 图内无节点 → collectTsJsCodeSkeletons 未收 .mjs → walkTsJsFiles 白名单缺 .mjs/.cjs → walk 面与 adapter 声明面脱节（F152 引入后未随 adapter 扩充同步）→ 质量门无覆盖缺口检测 + 镜像测试固化残缺面

`[ROOT CAUSE REACHED at Why 4]`（Why 5 说明为何长期未被捕获）

## 已验证的前提（降低修复风险）

| 前提 | 证据 |
|------|------|
| 适配器可解析 .mjs | tsx 直调 `TsJsLanguageAdapter().analyzeFile('plugins/spec-driver/scripts/lib/goal-loop-core.mjs')` → exports: 18, callSites: 100（briefing 实测） |
| import 边可建立 | 插件内 import 全部带显式 `.mjs` 后缀（如 `from './simple-yaml.mjs'`）；`tryFilePathVariants`（import-resolver.ts:170-200）步骤 2「直接命中」可解析，且 `TS_EXTENSIONS`（L91）已含 `.mjs/.cjs` |
| 语言判定正确 | `ast-analyzer.ts:96 getLanguage`：`.mjs` 不匹配 `.ts/.tsx` → 'javascript'，语义正确 |
| 非目录/gitignore 排除 | `plugins/` 不在 `TSJS_SKELETON_IGNORE_DIRS`（source-discovery.ts:385-389），`git check-ignore` 无命中 |
| 图产物不入库 | `specs/_meta/graph.json` 不被 git track（4.4MB 本地产物），重建不产生 git diff |
| 真实纳入面 = 197 .mjs + 3 .cjs（非仅 84） | `git ls-files '*.mjs'` = 197（scripts/ 105、plugins/ 84、tests/ 4、specs/ 4），`*.cjs` = 3（scripts/lifecycle-runner.cjs + 2 个 tests/fixtures）；全部 git 管辖零 gitignore 命中。修复按扩展名维度生效，scripts/ 等同向纳入属预期增值；fixture .mjs/.cjs 入图与现状 .ts fixture（tests/、specs/ 下 .ts 已入图）行为一致 |
| before 基线（rebase 至 `264338b` 后重测）| 节点 6102 / 边 9438 / mjs 节点 0；六指标：contains 5101/5101=100%、orphan offending 0、dangling 0（`verification/before-graph-quality.json`）。**旧底座（@2e3a4cd）的 6097 / 8065 已作废** —— 并行交付的 `242-fix-callsite-syntax-coverage`（calls 边 926→2287）改变了边基数，旧数字不可复现；完整 before/after 与差集归因见 `verification/node-edge-totals.json` |
| orphan 风险可控 | orphan 定义 = degree 0 **含 contains 边**（orphan-check.ts）；`deriveContainsEdges` 语言无关，.mjs symbol 将获得 module→symbol contains 边 → 非 orphan；独立 CLI 入口脚本的 module 节点因 contains 出边 + import 出边 degree>0 |

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/batch/stages/source-discovery.ts` | L509-514 | `walkTsJsFiles` endsWith 白名单（4 扩展） | 加 `.mjs`/`.cjs`，同步更新 L392/L481 docstring |
| `src/panoramic/graph/source-commit.ts` | L36 | `TSJS_COLLECTOR_EXTENSIONS`（FIX-4：显式镜像 walkTsJsFiles 判定面，防漂移测试在 source-commit.test.ts） | 同步加 `.mjs`/`.cjs`（freshness dirty 判定面跟随扫描面） |
| `src/panoramic/graph/quality/ignore-oracle.ts` | L112 | `TSJS_EXTENSIONS`（按扩展名选择 TSJS ignore-dirs oracle 判定面） | 同步加 `.mjs`/`.cjs`（否则 .mjs 节点不被 oracle 覆盖，ignored 检查漏检） |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `src/adapters/ts-js-adapter.ts` | L169-175 | `extractComments` scriptKind 推断（.mjs → fallback ScriptKind.TS） | 安全：TS 语法为 JS 超集，注释提取不受影响，不改（改动属 .mts/.cts 扩面议题） |
| `src/core/ast-analyzer.ts` | L96 | `getLanguage`（.mjs → 'javascript'） | 安全：语义正确，无需修复 |
| `src/knowledge-graph/module-derivation.ts` | L352-354 | 消费 `adapter.extensions`（8 扩展）+ 兜底常量 | 安全：已含 .mjs/.cjs，无需修复 |
| `src/core/import-resolver.ts` | L91 | `TS_EXTENSIONS`（6 扩展含 .mjs/.cjs） | 安全：已支持，无需修复 |
| `src/panoramic/generators/data-model-generator.ts` | L616 | 数据模型生成器只收 .ts/.tsx | 安全：panoramic LLM 数据模型面，独立特性域，与 graph 覆盖无关，不动 |
| `src/diff/drift-orchestrator.ts` | L241 | drift 源路径 `.ts` 后缀启发式 | 安全：spec drift 定位启发式，独立特性域，不动 |

### 同步更新清单

- 调用方: 无（三处均为常量/白名单，消费方签名不变）
- 测试:
  - `source-commit.test.ts` 一致性断言（防漂移测试按新 6 扩展面更新——按其设计意图更新，非放宽）
  - `ignore-oracle.test.ts` 若有扩展名面断言则同步
  - source-discovery / batch collector 相关测试：新增 `.mjs/.cjs` 收集回归断言（同一提交内包含）
  - 全量 vitest 中依赖图形态/节点数的断言（graph e2e 用 in-repo pinned fixture〔F215〕，micrograd 是 Python 项目不受影响；self-dogfood 图相关断言需实测暴露）
- 文档: `walkTsJsFiles` / `collectTsJsCodeSkeletons` docstring 扩展名清单；M9 §7.5.4 盲区条目落账（修复后状态更新）
- 验证面: 修复前后各重建图（graph-only），`spectra graph-quality --json` 六指标对比；全量 `npx vitest run`；`npm run build`；`npm run repo:check`

## 修复策略

### 方案 A（推荐）：三处白名单/镜像同步加 `.mjs`/`.cjs`

- `walkTsJsFiles` 白名单、`TSJS_COLLECTOR_EXTENSIONS`、`ignore-oracle TSJS_EXTENSIONS` 三处同步加 `.mjs`/`.cjs`，保持「镜像 collector 实际扫描面」的既有设计（FIX-4 决策与其防漂移测试继续成立）
- **显式不加 `.mts`/`.cts`**：TS 变体需要 `getLanguage`/`extractComments` scriptKind 适配（当前会被误判 javascript/错误 ScriptKind），仓库零存量、无用户诉求；登记为已知残留（walk 面与 adapter 声明面仍差 .mts/.cts，待有真实需求时连同语言判定一起补）
- 图重建后按六指标对比判断：新增节点/边应全部来自 plugins/**（84 文件）与其内部 import/contains 边；orphan/contains/dangling 指标不应劣化
- 若 orphan-ratio 意外超标：优先核对 contains 推导对 .mjs 是否生效（预期生效），而非直接调门禁口径

### 方案 B（备选）：walk 直接消费 `TsJsLanguageAdapter.extensions`（8 扩展声明面对齐）

- 消除「镜像脱节」根因本身，但引入 `.mts/.cts` 需同步修 `getLanguage` + scriptKind 推断，且 `source-commit.ts` FIX-4 是有意「镜像实际扫描面而非声明面」的已裁决设计（有测试守护）；改动面超出本问题域（84 个 .mjs 不可查），违反最小化变更原则。不推荐本次做。

## Spec 影响

- `specs/products/spectra/current-spec.md`: 无扩展名合同命中，无需更新
- `specs/src.spec.md`: 生成产物，不手改（若批量再生产生噪声按惯例还原）
- `docs/design/milestone-M9-codex-trusted-live-graph.md` §7.5.4: 盲区条目在验证通过后落账为已修复（本 fix commit 内更新该条目状态）

## 范围检测

受影响源文件 3 个 + 测试文件若干（<10 个文件），涉及模块 3 个（batch/stages、panoramic/graph、panoramic/graph/quality），未超过 fix 模式阈值（>10 文件或 >3 模块），继续 fix 模式。
