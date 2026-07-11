# 问题修复报告 — F209 dataset-build 单测 venv 环境耦合 flaky

## 问题描述

`tests/unit/feature-187-dataset-build.test.ts` 用例"单一一致标签 → 通过标签推导守卫...继续走 fetch"(L105-113)在存在 `scripts/.swebench-venv`(gitignore 本地产物,跑过 `setup-swebench-venv.sh` 的机器)的环境中 flaky:

- 全量 vitest 并行下:用例真调 venv python + HF datasets 库,超 unit project 默认 5000ms 超时失败
- 隔离跑:4.1-4.2s 险过(报告 worktree unruffled-rosalind-5150e5 实测 4.2s;本 worktree heuristic-dirac 复现 4125ms)

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 全量并行下为何超时失败? | 用例 spawnSync 真跑 CLI → CLI 真调 venv python + HF datasets 加载 SWE-bench_Verified,隔离跑即 4.1s,并行 CPU 争抢下突破 5000ms |
| Why 2 | 为何会真调 venv python? | 测试的 spawnSync 未传 `--venv` 参数,CLI 落到默认 `venvPath='scripts/.swebench-venv'`(相对 cwd=仓库根),本机存在该 venv 时即真跑 |
| Why 3 | 为何测试没注入 venv 路径? | 用例编写时把"本机不存在 venv → fetch 阶段 python ENOENT 快速失败"当成不变量(L108 注释),依赖 gitignore 本地状态制造失败路径,而非显式注入 |
| Why 4 | 该假设为何不成立? | venv 是 `setup-swebench-venv.sh` 的合法本地产物,跑过评测(如 F206 校准)的开发机必然存在;F197 实现时(commit 1c1f434)环境恰好无 venv,"TDD 全量绿"掩盖了环境耦合 |
| Why 5 | 为何未被现有机制捕获? | (a) unit project 无显式 testTimeout,vitest projects 不继承根级 30s 配置,落到默认 5000ms,4.1s"险过"使隔离跑不报错;(b) CI 无 venv,永远走快速失败路径,盲区仅在跑过评测的开发机全量并行时暴露;(c) 文件头注释声称"注入 fetchRows(W-4)免跑真 venv/Python",但该注入只覆盖库函数用例,CLI spawnSync 子进程用例无法注入 fetchRows,而 CLI 已有的 `--venv` 注入点未被使用 |

**Root Cause**: CLI 集成用例依赖"本机不存在 `scripts/.swebench-venv`"这一环境假设制造 fetch 失败路径,该假设在跑过评测的开发机上不成立 → 测试真调 python + HF,非确定性(依赖本机状态 + 网络/HF 缓存) + 并行超时 flaky。

**Root Cause Chain**: 并行超时失败 → 真调 venv python + HF → spawnSync 未传 `--venv` 落默认路径 → 环境假设"无 venv"写死进测试 → venv 是合法本地产物随机器漂移 → 5000ms 默认超时 + CI 无 venv 双重掩盖。

`[ROOT CAUSE REACHED at Why 5]`

## 影响范围扫描

### 同源问题(需同步修复)

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| tests/unit/feature-187-dataset-build.test.ts | L105-113 | spawnSync 跑 CLI 未传 `--venv`,走到 fetch 阶段 | 追加 `--venv <不存在路径>` + 同步修正 L108 注释 |

### 类似模式(需评估)

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| tests/unit/feature-187-dataset-build.test.ts | L88-95(混合标签) | spawnSync 跑 CLI 未传 `--venv` | [安全] 守卫在 fetch 前 exit 2(CLI L133),不碰 venv |
| tests/unit/feature-187-dataset-build.test.ts | L97-103(未知标签) | spawnSync 跑 CLI 未传 `--venv` | [安全] 同上,exit 2 在 CLI L140,不碰 venv |
| scripts/swe-bench-verified-cohort-batch.mjs 等 | — | 生产脚本引用默认 venv | [安全] 生产用途本就需要真 venv,非测试 |

grep 全 tests/ 确认:仅此一个测试文件引用 swebench-dataset-build CLI。

### 同步更新清单

- 调用方: 无(仅测试自身)
- 测试: 修改 L109 spawnSync 参数 + L108 注释
- 文档: 无
- 类型定义: 无

## 修复策略

### 方案 A(推荐): 测试注入不存在的 `--venv` 路径

CLI 已支持 `--venv <dir>` 参数(scripts/lib/swebench-dataset-build.mjs L121,F187 原生能力)。测试给 spawnSync 追加 `--venv path.join(dir, 'nonexistent-venv')`(挂在 mkdtemp 临时目录下,保证任何机器上必然不存在,优于硬编码 `/nonexistent`)。

**已实测验证**(本 worktree,scratchpad 手跑 CLI):
- 耗时 0.026s(原 4.1s,≈160x 加速),确定性快速失败
- exit=1(python ENOENT → `fetchOfficialRows` throw → uncaught → 非 0)→ `expect(res.status).not.toBe(0)` ✓
- stderr 为 `swebench_fetch_rows.py 失败 (status=null)`,不含"dataset 标签不一致"/"未知 dataset tag" → 两个反向断言 ✓
- 错误来自 fetch 阶段 = W-1 标签守卫已放行 → 测试目的(只验证守卫不拦、不验证 fetch 成败)不变

零源码改动,变更面 1 个测试文件 2 行。

### 方案 B(备选): CLI 增加 `SWEBENCH_VENV` 环境变量支持

用户原始建议之一("注入 env SWEBENCH_VENV=/nonexistent 或等效参数")。缺点:需改生产源码给 CLI 加冗余注入通道(`--venv` 参数已存在且等效),违背"不加未要求功能"约定。用户建议中"或等效参数"即指向方案 A。

### 方案 C(备选): mock fetch

CLI 在子进程中运行,测试进程无法直接 mock;需给 CLI 加 mock 开关,同样扩大生产面。库函数级 fetchRows 注入(W-4)已存在且已覆盖库用例,CLI 用例的价值恰在真跑 CLI 入口,不宜 mock 掉。

## Spec 影响

- 需要更新的 spec: **无需更新**。本修复不改变 W-1 守卫行为语义(datasetTagToHfId 映射、混合标签禁止、未知标签报错均不动),仅改测试的失败路径注入方式。F197 制品(specs/197-f187-eval-integrity-closeout/)为历史流程记录,不回改。

## 范围检测

受影响文件 1 个 / 模块 1 个 → 远低于 fix 模式上限(10 文件/3 模块),继续 fix 模式。
