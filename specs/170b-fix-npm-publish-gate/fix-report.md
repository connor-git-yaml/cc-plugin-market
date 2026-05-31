# F170b — 问题修复报告

## 问题描述

F170a 标记 follow-up 但从未执行 npm publish，npm registry 中 spectra-cli 仍为 4.1.1，
4.2.0（含 Feature 155 agent-context tools）从未对外可用。此外存在两个结构性防线缺失：
namespace guard 缺失（人工错改 frontmatter 无守护）和 E2E 逃逸（文件缺失时 silent pass）。

---

## 5-Why 根因追溯

### Bug-1: npm publish 从未执行

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 4.2.0 为何未发布？ | F170a 交付时将 npm publish 标为 "follow-up"，没有纳入交付门禁 |
| Why 2 | 为何被标 follow-up？ | 当时 worktree 环境运行 vitest 有 tree-sitter WASM 相关失败，prepublishOnly 会被 block |
| Why 3 | tree-sitter 为何失败？ | worktree 的 node_modules native module 路径与主工作区不完全兼容 |
| Why 4 | 为何没有绕过方案？ | 缺少"CI 验证通过后可跳过本地 vitest 直接 publish"的明确路径 |
| Why 5 | 为何未被发现？ | 验收标准只写"host shell 一条命令 publish"，没有 npm view 双确认作为 gate |

**Root Cause**: publish 被人工标 follow-up 且无自动 gate 强制执行，导致 4.2.0 永远停在"准备好了但没发"的状态。

**Root Cause Chain**: `用户装到旧 binary` → `npm registry 没有 4.2.0` → `publish 被标 follow-up` → `worktree vitest 阻塞` → `缺 CI-green → publish 路径` → `无 npm view gate`

**当前状态**：经 F170b 诊断，vitest 当前全部通过（318 passed, 0 failed），build 通过，
prepublishOnly 现在不会 block。主要障碍仅剩"无人执行 npm publish"。

---

### Bug-2: namespace 无 guard（F162→170a 故障重演风险）

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | agent frontmatter 如何被错改？ | 人工编辑，无工具守护 |
| Why 2 | 为何没有工具守护？ | repo:check 没有 namespace 一致性检查 |
| Why 3 | 为何 F170a 没加 guard？ | F170a 实施时只修改 agents 内容，repair 视角而非 prevent 视角 |
| Why 4 | namespace 为何是人工知识？ | plugin.json name + .mcp.json server key 派生关系从未工具化 |
| Why 5 | 未被捕获 | F170a 对抗审查标注了 Bug-2 Why-5 为缺失防线，但未落地 |

**Root Cause**: 单一源（plugin.json + .mcp.json）与 agent frontmatter 之间无自动一致性守护。
**派生公式**: `plugin.json name = "spectra"` + `.mcp.json server key = "spectra"` → `mcp__plugin_spectra_spectra__`

---

### Bug-3: E2E always-green 逃逸

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 为何文件缺失时 silent pass？ | 第 188 行 `if (!existsSync(docPath)) return;` 允许提前退出 |
| Why 2 | 为何有此 early-return？ | "未创建时跳过内容断言"注释说明是 TDD RED 时的临时妥协 |
| Why 3 | 为何 GREEN phase 没去掉？ | F170a GREEN phase 创建了文件但没同步移除保护逻辑 |
| Why 4 | CORRECT_NAMESPACE 为何硬编码？ | 常量在文件顶部定义，与 plugin 配置无派生关联 |
| Why 5 | 未被捕获 | F170a 验收只检查"28 tests pass"，没有审查逃逸路径 |

**Root Cause**: TDD RED phase 的 guard clause 在 GREEN phase 应移除但未移除。

---

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 问题 | 修复动作 |
|------|------|------|----------|
| `tests/e2e/feature-170a-...test.ts` | L188 | early-return 逃逸 | 改为正式 `expect(existsSync).toBe(true)` |
| `tests/e2e/feature-170a-...test.ts` | L35 | CORRECT_NAMESPACE 硬编码 | 从 plugin.json + .mcp.json 动态派生 |
| `scripts/repo-check.mjs` | 末尾 | 无 namespace guard | 新增 namespace-consistency 检查 |

### 类似模式（已评估）

| 文件 | 位置 | 评估结果 |
|------|------|----------|
| 其他 E2E 测试 early-return | — | 未发现类似模式 |
| repo:check 其他字段检查 | — | 安全，已有完整断言 |

### 同步更新清单

- 测试：新增 `tests/unit/repo-check-namespace-guard.test.ts`（TDD RED → GREEN）
- 代码：`scripts/repo-check.mjs` 新增 namespace-consistency 检查项
- E2E：修改第 188 行 + CORRECT_NAMESPACE 派生方式

---

## 修复策略

### 方案 A（推荐）— 分两步提交

**步骤 1：RED phase commit**
- 新增 `tests/unit/repo-check-namespace-guard.test.ts`（期望 repo-check 输出含 namespace guard，当前无此检查 → FAIL）
- 修改 E2E L188（去掉 early-return → 文件存在时仍 pass，删文件时会 FAIL）
- 修改 E2E CORRECT_NAMESPACE 改为派生（验证当前值正确 → 仍 PASS）

**步骤 2：GREEN phase commit**
- `scripts/repo-check.mjs` 新增 namespace-consistency 检查（让步骤 1 的新测试 pass）
- 同步更新 namespace guard 测试期望值

**npm publish（host shell，用户执行）**
- 前置：GREEN commit push 后，host shell 运行 `npm publish`
- 验证：`npm view spectra-cli versions` 含 4.2.0

### 方案 B（备选）— 一步提交
所有修改合并为一个 commit，跳过 TDD RED/GREEN 步骤分离。
弊端：失去 RED phase 作为基准的记录。

---

## Spec 影响

- 需要更新的 spec：无需更新（纯 guard + fix，无功能变更）
- 影响文件数：3（tests/e2e/..., tests/unit/..., scripts/repo-check.mjs）
- 影响模块数：2（tests, scripts）

---

## 当前环境状态确认

```
vitest:       318 passed, 0 failed ✅
build:        tsc 零错误 ✅  
repo:check:   44 pass ✅
release:check: pass ✅
prepublishOnly: 不再 block ✅
npm registry: spectra-cli@4.1.1（需 publish 4.2.0）⚠️
```
