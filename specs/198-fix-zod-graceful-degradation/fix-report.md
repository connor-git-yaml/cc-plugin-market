# 问题修复报告 — spec-driver 脚本 zod 缺失优雅降级

> Feature 198 · fix 模式 · 诊断阶段由编排器（Opus）亲自执行

## 问题描述

spec-driver 插件缓存脚本在 `zod` 缺失时直接抛 `ERR_MODULE_NOT_FOUND` 崩溃，而非优雅降级。

实测触发路径：在缺 `node_modules` 的插件缓存目录（如 `~/.claude/plugins/cache/cc-plugin-market/spec-driver/<ver>/`）下运行
`node scripts/resolve-project-context.mjs --project-root . --json`
→ `lib/project-profile-resolver.mjs` → `lib/project-profile-schema.mjs` 顶层裸 `import { z } from 'zod'`
→ 整个 resolver 在**模块加载期**抛错退出，下游 spec-driver fix/feature 流程的 project-context 注入静默丢失（只能靠人手读 yaml）。

历史实测：F182 流程（2026-06-13）踩到，记录于 Claude memory `project_spec_driver_plugin_cache_zod_missing`。当前 4.2.1 缓存恰好已 vendoring zod（不再复现），但**架构脆弱性仍在**：任何缺 zod 的安装/未来缓存都会崩。本 fix 以"模拟 zod 缺失"作为可靠复现手段（`createRequire` 从无 `node_modules` 路径 `require('zod')` → 可捕获的 `MODULE_NOT_FOUND`）。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | resolver 为何崩溃退出？ | 进程在脚本主体执行前就抛 `ERR_MODULE_NOT_FOUND` |
| Why 2 | 为何在主体执行前抛错？ | ESM 顶层 `import { z } from 'zod'` 在**模块加载期静态解析**，无法被运行时 try/catch 捕获 |
| Why 3 | 为何解析失败？ | 插件缓存目录无 `node_modules`，Node 从脚本所在目录向上找不到 `zod` |
| Why 4 | 为何会运行在无依赖目录？ | 插件缓存不随仓库 `npm install`；安装态与开发态依赖供给方式不同（设计假设"运行环境总能解析 zod"不成立） |
| Why 5 | 为何未被现有机制捕获？ | zod 仅作 schema 安全网，调用方无降级分支；既有测试都在有 `node_modules` 的仓库内跑，从未覆盖"缺 zod"路径（测试盲区） |

**Root Cause**：依赖 zod 的脚本采用**急切（eager）顶层静态 `import`**，把"zod 必然可解析"作为硬前提；该前提在缺 `node_modules` 的安装态目录不成立，且没有任何运行时降级分支或诊断，导致**模块加载期硬崩**。

**Root Cause Chain**：resolver 崩溃 → 加载期抛 `ERR_MODULE_NOT_FOUND` → ESM 顶层 import 静态解析不可 catch → 缓存目录无 node_modules → 安装态依赖供给假设不成立 → 调用方无降级分支 + 测试无缺 zod 覆盖

## 影响范围扫描

### 同源问题（本 fix 范围内，需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `plugins/spec-driver/scripts/lib/project-profile-schema.mjs` | L1 | 顶层 `import { z } from 'zod'` | 改为经共享 helper 惰性加载；zod 缺失时 schema 构建可跳过 |
| `plugins/spec-driver/scripts/lib/project-profile-resolver.mjs` | L4-9, L72, L613 | 消费 `referenceEntrySchema` / `resolvedProjectProfileSchema` 的 `.safeParse` | zod 缺失时跳过 schema 校验（手写 path‖url 校验 + 信任手写 normalize），push `project-context.zod-unavailable` 降级诊断 |
| `plugins/spec-driver/scripts/resolve-project-context.mjs` | 全脚本（CLI 入口） | 间接依赖上述 schema | 降级后仍输出有效结构化 JSON + 可读 warning，退出码 0 |
| `plugins/spec-driver/scripts/lib/config-schema.mjs` | L14 | 顶层 `import { z } from 'zod'` | 同 helper 惰性加载；`validateConfig` 在 zod 缺失时降级为"跳过校验、best-effort 接受 config" + `config.zod-unavailable` 诊断 |
| `plugins/spec-driver/scripts/validate-config.mjs` | CLI 入口 | 消费 `validateConfig` | 降级路径返回结构化结果而非崩溃；`resolveEffectiveConfig` 纯 JS 不受影响 |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `plugins/spec-driver/contracts/orchestration-schema.mjs` | L21 | 顶层 `import { z } from 'zod'` | **[同源-超范围]** 经 `lib/orchestration-resolver.mjs` / `lib/orchestrator.mjs` → CLI `orchestrator-cli.mjs`，同样会在缺 zod 时加载期崩溃；当前**无**降级分支。但：(1) 用户本次显式将范围限定在"`scripts/lib` 同目录"，该文件在 `contracts/`；(2) orchestration schema 是**编排校验核心**（非安全网），降级 blast radius 更大、与 orchestration 合约链耦合更深；(3) 共享 helper 自然落点 `scripts/lib/`，被 `contracts/` 反向 import 不合理。→ **本 fix 不纳入**，作为同类 follow-up 上报（届时可复用本 fix 的 `load-zod.mjs` 思路） |

> 同目录裸 import 全量扫描：`grep -rE "^import .* from '[^.]"`（排除 `node:`）在 `scripts/` 下**仅** `project-profile-schema.mjs` 与 `config-schema.mjs` 两处第三方裸 import，无其它同类风险点。

### 同步更新清单

- **调用方**：`project-profile-resolver.mjs`（2 处 zod 用法）、`validate-config.mjs`（`validateConfig`）
- **测试**：
  - 扩展 `tests/integration/spec-driver-project-context-resolver.test.ts` — 新增"强制缺 zod → 降级路径"端到端用例（子进程 + 测试 seam 环境变量）
  - 扩展 `tests/unit/spec-driver-config.test.ts` — 新增"validateConfig 缺 zod 降级"用例
  - 新增 `load-zod` helper 单测（可注入失败 require，验证 `{ available:false, error }` 语义 + memoize）
- **文档**：修复落地后更新/删除 Claude memory `project_spec_driver_plugin_cache_zod_missing`

## 修复策略

### 方案 A（推荐）：共享同步 zod 加载 helper + 惰性 schema + 降级诊断

1. 新增 `plugins/spec-driver/scripts/lib/load-zod.mjs`：
   - 用 `createRequire(import.meta.url)` + `require('zod')` 在 try/catch 中**同步**加载（zod 自带 CJS，可 `require`），保持现有同步调用链不变（无 async 涟漪）
   - 导出 memoized `loadZod()` → `{ z, available, error }`；提供测试 seam（环境变量强制缺失 + `__resetZodCacheForTest`）
2. `project-profile-schema.mjs` / `config-schema.mjs` 改为经 helper 惰性构建 schema：zod 在 → 构建真实 schema；不在 → 导出 `null` + `zodAvailable=false`，模块加载不崩。
3. 调用方降级分支：
   - resolver：zod 缺失时跳过两处 `.safeParse`（reference 用手写 `path‖url` 校验；normalized 本就手写构建，信任放行），push `project-context.zod-unavailable`（level=warning，含"缺 zod + 建议 `npm i` / 从仓内源运行"可读信息）
   - `validateConfig`：zod 缺失时 `{ success:true, data: <best-effort 原样>, degraded:true, diagnostics:[config.zod-unavailable] }`
4. 诊断沿用既有 `project-context.*` / `config.*` 命名与 `{ level, code, message }` 结构（对齐 orchestration-overrides diagnostics 模式）。

**优点**：根因层修复（消灭"加载期硬崩"），DRY（单一 helper），全同步（零 async 涟漪），既有正常路径零行为变化（zod 在场时与现状完全一致）。

### 方案 B（备选）：每个 schema 模块各自 try/catch 动态 import

每个文件独立 `await import('zod')` 包 try/catch。**劣势**：动态 import 是 async，会把 `resolveProjectContext` / `validateConfig` 及两个 CLI 入口全部染成 async（涟漪扩散）；且两处重复降级逻辑，违反 DRY。**不推荐**。

## Spec 影响

- **无需更新现有 spec**：本次为**新增降级路径**，不改变 zod 在场时的既有契约字段与输出结构（`schemaVersion` / `diagnostics` 形状均不变，只是缺 zod 时多一条 warning 诊断）。属纯增量健壮性增强。
