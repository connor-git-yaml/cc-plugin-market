# 问题修复报告 — F274 global-setup 跨 worktree 假新鲜盲区

## 问题描述

tests/global-setup.ts（F251 dist 单点构建守卫）的新鲜度判据存在跨 worktree 假新鲜盲区。sidecar（`node_modules/.cache/spectra/test-build-inputs.json`）只记录"构建输入 src 的内容指纹"，而各 worktree 的 `node_modules` 惯例是软链到主仓（共享同一 sidecar），`dist/` 却是 per-worktree 独立目录。当 worktree A 在 commit X 构建成功写入 sidecar 后，worktree B 若 checkout 到同一 commit X 但本地 dist 是旧 commit 构建的，`isDistFresh()`（tests/global-setup.ts:151）现算指纹==共享 sidecar 指纹 → 误判新鲜 → 跳过重建 → 在陈旧 dist 上跑测试。

**实证**：2026-08-31 在 worktree funny-driscoll-fc77bb 复现——HEAD=25992316，`dist/.spectra-build-meta.json` 显示 dist 构建自 125bfdb3（缺 F271 730d5213 的 lineRange 产出逻辑），global-setup 打印"dist/ 已是最新（输入指纹匹配），跳过 npm run build"，导致 `tests/integration/graph-quality-pinned-staleness.test.ts` 四语言全报 stale（差异全为 `nodes[*].metadata.lineRange`）+ f271-graph-recovery-hint / feature-180-error-envelope 共 6 个用例假红；`npm run build` 强制重建后全绿。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 6 个测试用例为何假红？ | 测试 spawn 的 dist CLI 是旧 commit（125bfdb3）的产物，缺 F271 的 lineRange 逻辑，输出与新 pinned 基线不一致 |
| Why 2 | 陈旧 dist 为何没被 globalSetup 重建？ | `isDistFresh()` 判 true：现算的 src 输入指纹 == sidecar 记录的指纹，且 `dist/cli/index.js` + build-meta 存在 |
| Why 3 | 输入指纹匹配为何不等于 dist 新鲜？ | sidecar 只见证"**某次**成功构建消费了这组输入"，不见证"**这个目录下的 dist** 就是那次构建的产物"——sidecar 与它见证的 dist 之间没有任何绑定字段 |
| Why 4 | 这个绑定缺失的设计假设为何不成立？ | F251 设计时隐含假设"sidecar 与 dist 一一同域"（同一进程先后写入、同一文件系统位置）。该假设被 worktree 惯例打破：`node_modules` 软链到主仓（sidecar 全 worktree 共享单实例），`dist/` 却 per-worktree 独立——一份 sidecar 对应 N 份互不相同的 dist |
| Why 5 | 为何未被现有机制捕获？ | F251 的对抗复审（C1 半成品 dist、W1 TOCTOU、I4 sidecar 迁址）全部围绕**单 worktree 单进程**时序推演；I4 把 sidecar 从 `dist/` 迁到 `node_modules/.cache/` 时论证了 npm 发布包污染与 `npm ci` 清空两条边界，恰恰没有推演"`node_modules` 是软链、`.cache/` 是共享的"这一本仓 worktree 惯例。测试面也无跨 worktree 场景（单仓测试结构性测不到） |

**Root Cause**: sidecar 见证的是"输入指纹"而非"输入指纹 ↔ 这份 dist 产物"的绑定关系；当 sidecar 因 `node_modules` 软链被多个 worktree 共享、而 dist per-worktree 独立时，A worktree 的构建见证被 B worktree 采信，B 的陈旧 dist 被误判新鲜。

**Root Cause Chain**: 6 用例假红 → 陈旧 dist 被 spawn → isDistFresh 误判 true → sidecar 无 dist 绑定字段 → "sidecar 与 dist 同域"隐含假设被 worktree 软链惯例打破 → I4 迁址复审未推演共享性 + 无跨 worktree 测试面

`[ROOT CAUSE REACHED at Why 4]`（Why 5 补测试盲区归因）

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| tests/global-setup.ts | L48 (TEST_INPUTS_SIDECAR)、L116-137 (schema/读写)、L151-156 (isDistFresh)、L204-214 (runBuild) | sidecar 无 dist 绑定 + 共享路径 | 本次修复主体（见修复策略） |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| tests/helpers/dist-cli-guard.ts | assertDistBuilt() | 只做 DIST_CLI + BUILD_META 存在性断言，不涉 sidecar | [安全] 不消费 sidecar，无共享态；新鲜度职责在 globalSetup，guard 只防"绕过 globalSetup" |
| scripts/lib/spectra-version-gate.mjs | stampBuild/hashDistTree | build-meta 落在 `dist/` 内（per-worktree），无共享 | [安全] meta 与 dist 同目录同生命周期，不存在跨 worktree 共享 |
| specs/251-.../verification-report.md | 陈述 F251 判据 | 文档描述旧判据 | [安全] 历史验证报告如实记录当时状态，不改写历史制品 |

### 同步更新清单

- 调用方: 无（sidecar 唯一消费方是 tests/global-setup.ts 自身）
- 测试: **新增**跨 worktree 假新鲜复现测试——伪造"陈旧 dist + 匹配的共享 sidecar"，断言守卫判不新鲜/触发重建
- 文档: tests/global-setup.ts 文件头"已知边界"注释需补跨 worktree 边界说明（该注释即 canonical 文档）
- 类型定义: TestInputsSidecar 接口 schemaVersion 升 2 + 新增字段

## 修复策略

### 方案 A（推荐）：sidecar 绑定 dist 内容指纹 + 按 PROJECT_ROOT 分键（双管齐下）

1. **dist 内容绑定**：sidecar schema 升 v2，新增 `distSha256` 字段。写入时机在 `runBuild()` 构建成功、输入指纹前后一致之后，用 `hashDistTree(dist)`（复用 scripts/lib/spectra-version-gate.mjs 既有实现，与 build-meta 的 `distSha256` 同一语义）**现算实际 dist 内容**落盘；`isDistFresh()` 检查时**重新现算**当前 dist 的 `hashDistTree` 与 sidecar 记录比对（不信任 build-meta 的转述——meta 在 stamp 失败场景下可能陈旧，现算才是诚实证据源；dist 现有 329 个 .js，现算开销数十 ms 量级，相对一次 `npm run build` 可忽略）。现算需 try/catch 包裹（沿用 W1 TOCTOU 处置：失败返回 null → 保守判不新鲜）。
2. **按 PROJECT_ROOT 分键**：sidecar 文件名改为 `test-build-inputs-<sha256(PROJECT_ROOT) 前 12 位>.json`，每个 worktree 独立见证文件。理由：若只做 dist 绑定而保持单文件共享，A/B 两 worktree 会互相覆写对方的见证（B 重建后写入自己的 distSha256，A 下次判不新鲜再重建再覆写……），在 tsc 输出存在任何非确定性时退化为跨 worktree 每次互相打回的重建 thrash；分键从根上消除共享，dist 绑定则守住"同一 worktree 内 dist 被替换/半成品"这一更强不变量。写入新文件时顺带 `rmSync(旧共享文件, { force: true })` 清理遗留（schemaVersion 校验本就会拒读 v1，删除仅为不留死文件）。

保持既有保守偏置不变：任何指纹现算失败 / sidecar 缺失 / schema 不匹配 / 字段缺失 → 判不新鲜 → 重建；C1 "先删后写"序列、W1 构建前后指纹一致才落盘、fail-loud/watch 容错语义全部保留。

### 方案 B（备选）：仅按 PROJECT_ROOT 分键，不做 dist 绑定

改动最小（只改文件名推导），恢复 F251 "sidecar 与 dist 同域"的原始隐含假设。缺点：假设靠路径约定维持而非证据绑定——同 worktree 内 dist 被外力替换/回退（如手动 cp 旧 dist、`git clean` 后残留恢复）仍不可见；与本仓"诚实证据源"门禁哲学（见证必须绑定被见证物本体）不符。不推荐。

## Spec 影响

- 需要更新的 spec: 无独立 spec 文件（F251 制品为历史 fix 记录，不回改）；canonical 行为文档即 tests/global-setup.ts 文件头注释，随实现同步更新。
