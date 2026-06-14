---
feature: 199-fix-orchestration-schema-zod-degradation
mode: fix
phase: diagnose
status: draft
follow_up_of: ../198-fix-zod-graceful-degradation/
---

# 问题修复报告 — orchestration-schema zod 缺失优雅降级

> Feature 199 · fix 模式 · 诊断阶段由编排器（Opus）亲自执行
> F198 明确剥离出的同源 follow-up（F198 fix-report L46 / plan L22 已预告，复用 F198 已落地的 `load-zod.mjs`）

## 问题描述

`plugins/spec-driver/contracts/orchestration-schema.mjs` 顶层裸 `import { z } from 'zod'`（L19）在缺 `zod`（插件缓存目录无 `node_modules`）时于 **ESM 模块加载期**抛 `ERR_MODULE_NOT_FOUND` 硬崩，无法被运行时 try/catch 捕获。

实测触发链路：
- `lib/orchestration-resolver.mjs`（L21-26 import 三件套 schema + formatZodIssue）
- `lib/orchestrator.mjs`（L13 import orchestrationBaseSchema + formatZodIssue）
- → 最终 CLI `scripts/orchestrator-cli.mjs`（L15-17 同时消费 resolver + Orchestrator）间接触发
- → 缺 zod 时整个 orchestration 链路在加载期崩溃，`effective-orchestration` / `generate-template` / `validate-config` 等子命令全部不可用。

与 F198 的关系：F198（commit `39f0ce4`）已修 `scripts/lib/` 下 `project-profile-schema.mjs` + `config-schema.mjs` 两条同类链路，并**显式将本文件列为同源-超范围 follow-up**（F198 fix-report L46、plan L22）。本 fix 复用 F198 已落地的 `scripts/lib/load-zod.mjs`，把同一根因修复延伸到 orchestration 链路。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | orchestration 链路为何崩溃退出？ | 进程在脚本主体执行前抛 `ERR_MODULE_NOT_FOUND` |
| Why 2 | 为何在主体执行前抛错？ | `contracts/orchestration-schema.mjs` 顶层 `import { z } from 'zod'` 在**模块加载期静态解析**，不可被运行时 try/catch 捕获 |
| Why 3 | 为何解析失败？ | 插件缓存目录无 `node_modules`，Node 从脚本所在目录向上找不到 `zod` |
| Why 4 | 为何会运行在无依赖目录？ | 插件缓存不随仓库 `npm install`；安装态与开发态依赖供给方式不同（"运行环境总能解析 zod"的假设不成立） |
| Why 5 | 为何未被现有机制捕获？ | resolver/orchestrator 虽各有 fallback 体系（`generateFallbackConfig` / `isBaseInvalid`），但它们针对 **base YAML 损坏**、运行在**模块加载成功之后**；zod 缺失发生在更早的**模块加载期**，fallback 根本跑不到。且 F198 只覆盖了 `scripts/lib/` 同目录，本文件在 `contracts/`，被显式划出范围 → 同类盲区残留 |

**Root Cause**：`contracts/orchestration-schema.mjs` 采用**急切（eager）顶层静态 `import { z }`**，把"zod 必然可解析"作为硬前提；该前提在缺 `node_modules` 的安装态目录不成立。现有 orchestration fallback 体系运行在模块加载成功之后，无法兜住加载期硬崩 —— 与 F198 修复的两个 schema 模块**同根同源**。

**Root Cause Chain**：orchestration 链路崩溃 → 加载期抛 `ERR_MODULE_NOT_FOUND` → ESM 顶层 import 静态解析不可 catch → 缓存目录无 node_modules → 安装态依赖供给假设不成立 → 既有 fallback 在加载期之后跑不到 + F198 范围未覆盖 contracts/

## 影响范围扫描

### 同源问题（本 fix 范围内，需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `contracts/orchestration-schema.mjs` | L19 | 顶层 `import { z } from 'zod'` + 9 个顶层 `z.*` schema 求值 | 改经共享 `load-zod.mjs` 惰性加载；全部 schema 求值包进 `if (zodAvailable)` 守卫（`let + 末尾 export`），缺失时导出 `null` + `zodAvailable=false`，模块加载不崩 |
| `lib/orchestration-resolver.mjs` | L21-26 import；L212/L379/L422 三处 `.safeParse` | 消费三件套 schema | 缺 zod 时跳过三处 safeParse；best-effort 信任 plugin 自带 base（受信任），**跳过项目级 overrides**（用户输入无法校验时不信任），push `orchestration.zod-unavailable` warning |
| `lib/orchestrator.mjs` | L13 import；L62 `orchestrationBaseSchema.safeParse` | 消费 base schema | 缺 zod 时跳过 safeParse；best-effort 信任已解析 YAML（`parsed` 为纯对象则用之，否则退 `generateFallbackConfig`），log 一条 zod-unavailable warning |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `scripts/lib/project-profile-schema.mjs` / `config-schema.mjs` | — | 顶层 zod | **[已修]** F198 已落地降级，无需再动 |
| `contracts/` 其它 `.mjs` | — | — | **[安全]** 仅 `orchestration-schema.mjs` 一个 `.mjs`，其余为 `.yaml` / `.md`，无第三方裸 import |
| `lib/orchestrator.mjs` `loadAndValidateConfig` 外层 try/catch | L50-77 | `null.safeParse` 抛 TypeError 被吞 | **[需修-质量]** 缺 zod 时若仅靠外层 catch，会落到误导性日志（"Cannot read properties of null"）+ 错误地退化为 `generateFallbackConfig`（丢真实配置）；故加显式守卫，不靠"碰巧被 catch" |

> 全量扫描：`grep -rn "from 'zod'" plugins/spec-driver/{contracts,lib}/` 仅 `contracts/orchestration-schema.mjs` 一处顶层裸 import（resolver/orchestrator 都是经它间接依赖 zod，本身不直接 import zod）。无其它同类风险点。

### 同步更新清单

- **调用方**：`orchestration-resolver.mjs`（3 处 safeParse + import 增加 `zodAvailable`）、`orchestrator.mjs`（1 处 safeParse + import 增加 `zodAvailable`）
- **测试**（统一进 vitest 体系 `tests/unit` + `tests/integration`，对齐 F198；orchestration 原有 `node:test` 套件不在 `npx vitest run` 收集范围，但作为回归基线手动跑 `node --test`）：
  - 新增 `tests/unit/spec-driver-orchestration-schema.test.ts` — 守卫加载不抛 + zodAvailable 标志 + schema 在场/缺失态（同进程 `vi.resetModules` + `__resetZodCacheForTest` + 动态 import）
  - 新增 `tests/integration/spec-driver-orchestration-zod-degradation.test.ts` — 缺 zod 子进程端到端跑 `orchestrator-cli.mjs effective-orchestration fix --format json`（断言不崩 / 退出码 0 / 有效 JSON / 含 zod-unavailable warning / modes.fix 仍在）
  - 复用 F198 `load-zod.mjs` 测试（已存在，无需重写）
- **文档**：更新 Claude memory `project_spec_driver_plugin_cache_zod_missing`（标注 orchestration 链路亦已降级）

## 关键设计决策

### D1 — 复用 F198 `load-zod.mjs`，落点不迁移（保持 `scripts/lib/`）

**决策**：`contracts/orchestration-schema.mjs` 经相对路径 `../scripts/lib/load-zod.mjs` 引用 F198 已落地的共享 helper，**不**把 load-zod 迁移到新的"中性位置"。

**取舍**（这是 follow-up 须先决策的架构点，brief 已点名）：
- F198 plan L22 曾顾虑"共享 helper 落点在 `scripts/lib/`，被 `contracts/` 反向 import 不合理"。**本 fix 复核后否定该顾虑**，依据具体拓扑事实：`scripts/lib/` 在本插件**已是事实上的共享工具家** —— `scripts/lib/simple-yaml.mjs` 被运行时 `lib/orchestrator.mjs`（L11）与 `lib/orchestration-resolver.mjs`（L19）消费。即 `lib/ → scripts/lib/` 是既有既定方向，`contracts/ → scripts/lib/` 与之同构，**不是新引入的反向坏边**。
- `load-zod.mjs` 零内部依赖（仅 `node:module`），不可能与 contracts 成环。
- **最小化 blast radius**：迁移会扰动 F198 已发布的 2 个消费者（`config-schema.mjs` / `project-profile-schema.mjs`）+ 其测试的 import 路径，放大回归面 —— 与本 fix"blast radius 比 F198 大、务必全量回归"的谨慎要求相悖。保持落点 = 单一 helper（DRY），正是 F198 预期的"复用本 fix 的 load-zod.mjs 思路"。

**结论**：保持 `scripts/lib/load-zod.mjs` 不动，新增一个跨目录相对 import。该决策覆盖 F198 的初判，依据是"scripts/lib 实为共享家"这一具体事实。

### D2 — 降级语义：best-effort 信任 base + 跳过 overrides（非退化为 generateFallbackConfig）

**决策**：缺 zod 时跳过 schema 校验，**best-effort 信任 plugin 自带的 base orchestration.yaml**（受信任、随插件版本管控），**跳过项目级 overrides**（用户输入，无法校验时不信任），push 一条 `orchestration.zod-unavailable` warning。返回 `isFallback: true, isBaseInvalid: false`。

**取舍**：
- vs 退化为 `generateFallbackConfig()`：fallback 是**最小桩**（每个 mode 仅 2-6 个精简 phase），会**丢弃真实 orchestration.yaml 的完整编排**。但"zod 缺失" ≠ "配置损坏" —— base YAML 完好，只是无法校验。把完好配置换成最小桩是不必要的功能回退。best-effort 信任 base **保住真实编排**，仅放弃校验安全网。
- **与 F198 先例一致**：F198 `validateConfig` 对同类场景正是"跳过校验、best-effort 接受原样配置 + degraded 标志 + zod-unavailable warning"（config-schema.mjs L263-274），非退化为某个硬编码默认。本 fix 沿用同一语义，保持产品行为一致。
- **base 受信任、overrides 不受信任的非对称处理**：base 随插件发版、版本控制、有测试守护（zod 在场时 100% 通过校验），缺 zod 时信任它低风险；overrides 是项目级用户输入，无 zod 时无法施加 `.strict()` / enum 校验，贸然信任可能把畸形结构合并进 config，故保守跳过并在诊断中说明。
- **防御**：`rawBase` 必须是纯对象（`[object Object]`）才信任，否则视为 base 损坏退 `generateFallbackConfig` + `isBaseInvalid: true`（沿用既有 base-invalid 语义）。`isBaseInvalid: false` 保证 CLI `generate-template`（cli L354 检查 isBaseInvalid）不被误拒。

### D3 — 诊断对齐既有 orchestration-overrides diagnostics 模式

复用 resolver 既有 `createDiagnostic(level, code, message)`；code 用 `orchestration.zod-unavailable`，level=`warning`。CLI `cmdEffectiveOrchestration`（L290-294）已有"非 info 诊断写 stderr"+`--format json` 输出 `diagnostics` 数组的逻辑，新诊断天然经此面向用户呈现，无需改 CLI。

### D4 — `formatZodIssue` / `BASE_RESERVED_MODE_NAMES` 保持顶层导出（不进守卫）

`formatZodIssue`（纯函数，不触碰 `z`）与 `BASE_RESERVED_MODE_NAMES`（纯常量数组）不依赖 zod，保持顶层 `export`。缺 zod 时这两个导出仍可用（虽然 formatZodIssue 因 safeParse 被短路而不会被调用）。仅 9 个 `z.*` schema 求值进 `zodAvailable` 守卫。

## 修复策略

### 方案 A（推荐）：复用 F198 helper + 惰性 schema 守卫 + 两消费者降级分支

1. `contracts/orchestration-schema.mjs`：删 L19 顶层 `import { z }`，改 `import { loadZod } from '../scripts/lib/load-zod.mjs'`；`const { z, available: zodAvailable } = loadZod()`；9 个 schema 改 `let + if(zodAvailable) 赋值 + 末尾统一 export`，新增 `export { zodAvailable }`。
2. `lib/orchestration-resolver.mjs`：import 增 `zodAvailable`；步骤 1（load base）后、步骤 2（safeParse）前插入 zod 缺失短路分支（best-effort 信任 base / 跳过 overrides / push zod-unavailable / 返回 base-only）。
3. `lib/orchestrator.mjs`：import 增 `zodAvailable`；`loadAndValidateConfig` 解析 YAML 后、safeParse 前插入守卫（纯对象信任 parsed，否则 generateFallbackConfig）。
4. 补 2 个 vitest 测试文件（守卫加载 + 子进程端到端降级）。

**优点**：根因层修复（消灭加载期硬崩）；DRY（复用单一 helper）；全同步（零 async 涟漪）；zod 在场时逐字节不变（既有 68 个 orchestration node:test + 全量 vitest 必须全绿）；保住真实编排配置。

### 方案 B（备选）：把 load-zod 迁移到中性位置后再引用

把 `load-zod.mjs` 迁到（如）`lib/` 或新建 `shared/`，三个 schema 模块都改引新路径。**劣势**：扰动 F198 已发布消费者 + 测试，blast radius 显著放大，与"全量回归谨慎"目标相悖；架构收益有限（D1 已论证 `scripts/lib/` 实为共享家）。**不推荐**。

## Spec 影响

- **无需更新现有 spec**：本次为**新增降级路径**，不改变 zod 在场时的既有契约（resolver 返回 shape、orchestrator config 形状、CLI 输出结构均不变），仅在缺 zod 时多一条 warning 诊断并跳过 overrides。属纯增量健壮性增强，与 F198 同性质。
