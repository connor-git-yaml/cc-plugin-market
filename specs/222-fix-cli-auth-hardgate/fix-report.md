# 问题修复报告 — CLI 零认证硬门吞掉 AST-only 降级

- **Feature**: 222-fix-cli-auth-hardgate
- **模式**: fix（快速问题修复）
- **基线 commit**: `23ffc8f`（已 rebase 到 origin/master）
- **诊断日期**: 2026-07-22

## 问题描述

`src/cli/commands/generate.ts:39` 与 `src/cli/commands/batch.ts:78`（非 `graph-only` 路径）在进入 orchestrator 之前先执行一道独立的 `checkAuth()` 硬门：零认证时直接 `printError` + `process.exitCode = API_ERROR` 并 `return`。

而真正的 "AST-only 静默降级" 实现在更底层的 `src/core/single-spec-orchestrator.ts:512-519`（`catch (LLMUnavailableError)` → `generateAstOnlyContent`），其触发依赖 `src/core/llm-client.ts:250-256` 的 `callLLM()` 在 `detectAuth().preferred` 为空时抛错。

两层判定谓词完全相同，导致 CLI 入口在"整机零认证"场景永远先一步硬退，orchestrator 的优雅降级分支经 CLI 入口**不可达**。这与产品事实源 `specs/products/spectra/current-spec.md` 的明确承诺相矛盾（详见"Spec 影响"）。

来源：`specs/221-fix-specgen-reexport-whitespace/verification/verification-report.md` 发现①（F221 验证过程中归档的既有行为，非 F221 引入）。

## 复现取证（实跑，非纸面推断）

构造真正的零认证隔离环境（`HOME` 指向空目录使 CLI 凭据不可见；`PATH` 仅含 node 软链 + `/usr/bin:/bin`，使 `which claude` / `which codex` 均落空；`ANTHROPIC_API_KEY` 已 unset）：

```
spectra auth-status
→ ✗ ANTHROPIC_API_KEY: 未设置 / ✗ Codex CLI: 未安装 / ✗ Claude CLI: 未安装
→ 未找到可用的认证方式
```

同一环境下四条命令的实测结果：

| 命令 | 结果 | exit |
|------|------|------|
| `spectra generate src/auth/auth-detector.ts` | ✗ 错误: 未找到可用的认证方式（零产出） | 2 |
| `spectra batch --mode full` | ✗ 错误: 未找到可用的认证方式（零产出） | 2 |
| `spectra diff specs/src.spec.md src` | ✗ 错误: 未找到可用的认证方式（零产出） | 2 |
| `spectra batch --mode graph-only`（对照组） | ✓ 5955 节点 / 7985 边 / 3.8s，正常产图 | 0 |

**反证降级分支功能完好**：在**完全相同**的零认证环境下绕过 CLI 层直调 `generateSpec()`（补 `bootstrapRuntime()` 初始化，不跳过 orchestrator 任何逻辑）：

```
specPath   : .../probe-out/auth-detector.spec.md
confidence : low
warnings   : ["LLM 不可用，已降级为 AST-only Spec"]
```

结论：降级路径**功能完好且零成本**（`callLLM` 在 `detectAuth()` 阶段短路，无任何网络请求），它不是坏的，只是被上游硬门屏蔽成了经 CLI 不可达的死路径。`graph-only` 对照组进一步证明"零认证可用"在同一 CLI 内已有先例。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 零认证下 `generate` 为何直接报错退出、不产出 AST-only spec？ | `generate.ts:39` 在调用 `generateSpec()` **之前**独立执行 `checkAuth()`，false 时 `printError` + `exitCode=API_ERROR` 并 `return`，从未进入 orchestrator |
| Why 2 | CLI 层为何要有这道独立的 `checkAuth()`？ | 「快速失败」设计：在昂贵的文件扫描 / AST 解析开始前就告知用户缺认证，避免跑完一堆活儿最后才失败。**该意图本身合理** |
| Why 3 | 这个快速失败为何会吞掉下游降级？ | `checkAuth()`（`error-handler.ts:36-48`）与 `callLLM()`（`llm-client.ts:250-256`）的判定谓词**完全相同**——都是 `detectAuth().preferred == null`。而下游降级的**触发条件恰好就是该谓词为真**。等价谓词在管线上游做成硬失败、下游做成软降级，上游必然先命中，下游分支即成死代码 |
| Why 4 | 两层为何用相同谓词却给出互斥语义？ | 「LLM 不可用」在本产品里其实有两种语义，代码里却只有一个谓词：**(a) 致命前置**——没认证就无法工作；**(b) 可降级条件**——没认证只是质量降档（AST-only），仍可交付。CLI 层按 (a) 实现、core 层按 (b) 实现。历史顺序上 CLI 的 `checkAuth` 早于降级能力落地，后续三处降级能力（`single-spec-orchestrator` 的 catch、`semantic-diff` 的 catch、`panoramic/llm-facade` 的 `isLLMAvailable`）分别加在各自下游，**没有人回头撤销上游的硬门** |
| Why 5 | 为何长期未被捕获？ | 测试盲区：单测直接调 `generateSpec()` / `detectDrift()`（绕过 CLI 层），CLI 层测试则在 mock `checkAuth` 返回 true 或有认证环境下跑，**没有任何一条 E2E 断言「整机零认证 → CLI 仍产出 AST-only spec」**。反而 `tests/unit/graph-only-cli.test.ts:146` 把当前硬退行为固化成了回归断言。F195 引入 `graph-only` 时明确绕过 `checkAuth`（`batch.ts:56-57` 有注释说明），说明团队已意识到"零认证可用"的价值，但只针对新增单点解决，未回溯审计既有硬门 |

**Root Cause**: 同一个认证谓词 `detectAuth().preferred == null` 在 CLI 层被实现为「致命前置」、在 core 层被实现为「可降级条件」，两个语义互斥的判定串联在同一管线上，上游硬门必然屏蔽下游降级。缺失的是一个明确的产品级决策——**哪些命令零认证时应降级可用、哪些应硬退**——以及把该决策收敛到单一判定点。

**Root Cause Chain**: 零认证 CLI 报错零产出 → `generate.ts:39` 硬门先于 orchestrator → 硬门谓词与降级触发谓词等价 → CLI 层与 core 层对「LLM 不可用」的产品语义判断不一致（致命 vs 可降级）→ 无单一事实源约束该语义 + 无零认证 E2E 断言兜底。

## 影响范围扫描

### 同源问题（共享相同根因）

全仓 `checkAuth()` 调用点共 **4 处**（不止任务描述提到的 2 处），逐一核实下游降级能力：

| 文件 | 位置 | 下游降级能力 | 分类 |
|------|------|-------------|------|
| `src/cli/commands/generate.ts` | L39 | ✅ `single-spec-orchestrator.ts:512-519` catch `LLMUnavailableError` → `generateAstOnlyContent` | **同源，需修** |
| `src/cli/commands/batch.ts` | L78 | ✅ `runBatch` → 每模块 `generateSpec`（`batch-orchestrator.ts:767/812`），复用同一降级 | **同源，需修** |
| `src/cli/commands/diff.ts` | L37 | ✅ `semantic-diff.ts:99-102` catch → return null（注释原文：「LLM 不可用时返回 null（不阻塞漂移检测）」）；且结构差异检测本身纯 AST | **同源，需修** |
| `src/cli/commands/watch.ts` | L91 | ✅ 下游 `runBatch({incremental:true})` → 同一 `generateSpec` 降级 | **同源，需修**（长驻进程，提示需去重，见下） |

### 类似模式（已核实，无需修复）

| 位置 | 模式 | 评估结果 |
|------|------|---------|
| `src/cli/commands/batch.ts:56-77` | `graph-only` 在 `checkAuth` 之前拦截 | **安全（正面样板）**：F195 有意为之，是本次修复要对齐的目标体验 |
| `src/panoramic/utils/llm-facade.ts:174-180` `isLLMAvailable()` | 下游按需静默跳过 LLM 增强（`llm-enricher.ts:163/240/304`） | **安全（正面样板）**：判定在真正需要 LLM 的点上做，不做入口硬门 |
| `src/cli/commands/auth-status.ts:18` | 直接调 `detectAuth()`/`verifyAuth()` | **安全**：该命令的职责就是报告认证状态，硬门语义正确 |
| `src/batch/batch-orchestrator.ts:625` | `detectAuth()` 仅用于探测 runtime（claude/codex）以选模型 | **安全**：不做通过/拒绝判定，探测失败默认 claude |

### 同步更新清单

- **测试（必改）**：`tests/unit/graph-only-cli.test.ts:146` — 「非 graph-only + checkAuth 失败 → API_ERROR」把当前硬退固化为回归断言，与修复直接冲突，必须按新语义重写
- **测试（必增）**：零认证 → CLI 仍产出 AST-only 的端到端断言（覆盖 generate / batch / diff 至少各一条），补上 Why 5 暴露的盲区
- **测试（核查）**：`tests/unit/error-handler.test.ts:34-47` — 若保持 `checkAuth()` 签名不变则不受影响；若改签名需同步
- **CLI 参数面**：`src/cli/utils/parse-args.ts` — 若引入逃生口 flag 需扩 `CLICommand` 类型与解析（注意 L1103 的取值型 flag 白名单仅对带值 flag 生效，布尔 flag 不需登记）
- **文档**：`README.md` / `docs/` 中关于认证前置条件的描述需与新行为对齐
- **产品 spec**：见下节

## 修复策略

### 方案 A（推荐）：入口硬门降级为提示，默认继续走 AST-only

对下游确有降级能力的 4 条命令，零认证时不再 `return`，改为打印**醒目提示**（说明本次产出为 AST-only 降档质量 + 如何启用 LLM），随后正常进入 orchestrator，由既有降级分支接管；同时提供 `--require-llm` 逃生口，供 CI 场景强制恢复硬退语义。

- **优点**：直接对齐产品事实源承诺（`current-spec.md` L54「诚实降级……静默降级路径」、FR-007、L321「AST-only 保底」）；零认证开箱可用，与 `graph-only` 体验一致；单一语义收敛在"提示 + 降级"，不再有互斥谓词
- **风险与缓解**：用户可能未注意提示而误以为拿到 LLM 增强产物 —— 但降级并非真"静默"：orchestrator 已 push `warnings: ['LLM 不可用，已降级为 AST-only Spec']`，`generate.ts:52-56` 会逐条打印，且 spec 产物 `confidence` 为 `low`。批量场景再叠加汇总提示即可
- **watch 特殊处理**：长驻进程会反复触发，提示需只在启动时打一次，避免刷屏

### 方案 B（备选）：保持硬退默认，新增 `--ast-only` 显式出口

零认证仍硬退，但用户可显式传 `--ast-only` 跳过 `checkAuth` 走降级。

- **优点**：默认行为零变更，回归风险最小；显式 opt-in 不会让人误拿降档产物
- **缺点**：不解决"开箱可用"（用户必须先撞一次错误、读文档、再重跑）；与 `current-spec.md` L54 的"静默降级"承诺仍有距离——降级从"保底机制"变成"需要用户知情才能用的功能"

**推荐 A**：根因是两层语义不一致，A 消除不一致，B 只是加了一条绕行道、把矛盾保留在原地。默认行为变更的回归风险由"同步更新清单"里的测试改写覆盖。

> 默认行为变更需在 GATE_DESIGN 由用户拍板确认（见下节 Spec 影响）。

## Spec 影响

产品事实源 `specs/products/spectra/current-spec.md` 已有明确承诺，当前 CLI 行为与之矛盾：

- L54：「**诚实降级**：在 LLM、解析器或上游制品不足时保留 AST-only / 目录图 / 占位说明等静默降级路径」
- L187：`FR-007 | LLM 失败或超时时重试并回退 AST-only | 006, 007 | 活跃`
- L321：「batch 支持 checkpoint、skip、force 与 AST-only 保底」

**判定**：这三条坐实本问题是**行为矛盾（真 bug）而非设计意图** —— 修复方向是让实现回归 spec 承诺，而非改 spec 迁就实现。

需要更新的 spec 文件：
- `specs/products/spectra/current-spec.md`：**无需改承诺本身**；若方案 A 引入 `--require-llm`，需在 FR-GROUP-7（分发、认证与横切关注点）补充该 flag 的语义
- 本 feature 的 `plan.md` / `tasks.md`：由 Phase 2 生成
