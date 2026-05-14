# 问题修复报告

> Feature: 163
> Mode: fix（快速修复）
> Generated: 2026-05-15
> 关联: Feature 162 Pilot 27 Cohort C prepareWorktree 全失

## 问题描述

Feature 162 Pilot 27 实测（commit 86693e6）中，Cohort C（mcp-pull）9 个 runs 全部 prepareWorktree fail，pass rate = 0/9 = 0%。
Cohort A（bare）= 3/9 = 33.3%，Cohort B（spec-push）= 1/9 = 11.1%，均正常跑完。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | Cohort C 跑批时 9/9 runs 全部立即失败（wallMs=0）？ | `eval-mcp-augmented.mjs` EC-13 错误：`dist/cli/index.js 不存在；请先运行 npm run build` |
| Why 2 | dist/cli/index.js 为何不存在？ | `npm run build` 从未在 pilot 27 启动前执行；worktree 初始状态无 dist/ 目录 |
| Why 3 | 为何无 dist/cli/index.js 只影响 Cohort C，不影响 A/B？ | Cohort C（mcp-pull）需要在 sub-agent worktree 内启动本地 MCP server，入口即 dist/cli/index.js；A/B 不启动本地 MCP server |
| Why 4 | 为何 pilot 启动前没有执行 npm run build？ | plan.md 缺少 §0.x 启动前置 section；operator（用户/自动化流程）无从得知这是硬前置 |
| Why 5 | 为何 pilot-27-batch.sh 也没有内置 build 检查？ | 脚本设计时假设"operator 已完成环境准备"，未加 EC-13 guard；属 spec gap 未转化为 defensive check |

[ROOT CAUSE REACHED at Why 4]

**Root Cause**: `plan.md` 缺少 §0.x 启动前置文档，导致 operator 在 Cohort C 跑批前遗漏 `npm run build` 这一硬前置。

**Root Cause Chain**: Cohort C 全 fail → EC-13 dist/cli/index.js 不存在 → npm run build 从未运行 → plan.md 无启动前置 section → operator 无 prompt → spec gap

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `specs/162-codex-driver-glm-judge-eval/plan.md` | §0 之前 | 缺 §0.x 启动前置 | 新增 §0.6（或 §0.5）包含 3 个前置 step |
| `scripts/baselines/clone-swe-bench-upstream.sh` | clone_repo() 函数 | 仅检 dir 存在，不校验 git 完整性 | 加 `git rev-parse --git-dir` 校验 + origin URL match + 中断残留自动 rm -rf（item_count < 10 安全限）|

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `scripts/pilot-27-batch.sh` | 启动前 | 无 build 检查 | 类似但不入库（运行时脚本）；可加 guard 但不阻塞本次修复 |

### 同步更新清单

- **文档**: `specs/162-codex-driver-glm-judge-eval/plan.md` §0.x（直接修改 Feature 162 plan）
- **脚本**: `scripts/baselines/clone-swe-bench-upstream.sh` idempotency（改 clone_repo 函数）
- **测试**: 对 clone 脚本新增幂等校验的单测（if any）
- **运行**: 修复后须 `npm run build` + 重跑 Pilot 27 完整 27 runs 验证 Cohort C ≥ 80%

## 修复策略

### 方案 A（推荐）—— 最小化双修复

1. **plan.md §0.6 新增**：在 §0.3（顺带歧义决议）之后插入 §0.6 启动前置 section，包含：
   - step 1: `bash scripts/baselines/clone-swe-bench-upstream.sh`（如未 clone；已存在幂等跳过）
   - step 2: `npm run build`（必须；cohort C dist/cli/index.js 硬依赖）
   - step 3: `claude plugin update spec-driver`（plugin 4.1.0 cache 加载）+ 提醒重启 IDE
2. **clone script 幂等校验升级**：改 clone_repo() 仅检 dir 存在 → 额外校验 `.git/config` 可读（防空目录）+ `git remote get-url origin` 返回期望 URL（防误 clone）+ 检测残留（size 过小或无 .git/HEAD）时自动 `rm -rf` 重 clone

### 方案 B（备选）—— 更激进的脚本防御

在 pilot-27-batch.sh 加 build guard：检查 dist/cli/index.js 存在，不存在则自动 `npm run build`。
**缺点**：增加脚本耦合，且 pilot-27-batch.sh 已是运行时产物不入库测试，方案 A 更干净。

## Spec 影响

- 需要更新的 spec: `specs/162-codex-driver-glm-judge-eval/plan.md`（直接修改 Feature 162 plan）
- 不新增 spec 文件（Feature 163 仅用作修复追踪目录）
- `scripts/baselines/clone-swe-bench-upstream.sh`：代码改动，无对应 spec 需更新

## 已知前置条件（pilot 重跑前须满足）

- [x] `~/.spectra-baselines/pytest` / `astropy` / `sympy` 已存在（✓ 已 clone）
- [ ] `dist/cli/index.js` 存在（需 `npm run build`）
- [ ] Plugin 4.1.0 已更新（`claude plugin update spec-driver`）
- [x] `SILICONFLOW_API_KEY` 已设（pilot A/B 正常跑完，说明已有）
