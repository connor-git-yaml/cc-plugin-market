# Verification Report: 209-fix-dataset-build-test-venv-flaky

**特性分支**: `209-fix-dataset-build-test-venv-flaky`
**验证日期**: 2026-07-11
**验证范围**: Layer 1 (Spec-Code 对齐) + Layer 1.5 (验证证据) + Layer 2 (原生工具链)

## 改动本体核查

```
git status --short
 M tests/unit/feature-187-dataset-build.test.ts
?? specs/209-fix-dataset-build-test-venv-flaky/
```

- 改动仅限 `tests/unit/feature-187-dataset-build.test.ts`，`specs/209-*` 为本次 spec-driver 流程制品目录（预期存在，非污染）
- `git diff` 核查：仅"单一一致标签"用例内新增局部变量 `venvPath = path.join(dir, 'nonexistent-venv')`、`spawnSync` 参数数组追加 `'--venv', venvPath`、以及 2 处注释调整（"无 venv" → "venv 不存在/显式注入不存在的 --venv 路径"）；三处断言语句原样未动；无生产源码改动
- 环境条件确认：`ls scripts/.swebench-venv/bin/python` → 文件存在，证明本机确实持有会触发原 flaky 条件的真实 venv（`res.status` 判定测试若走真实 venv 会进入耗时更长的 HF fetch 路径，而非 `--venv` 不存在时的快速失败路径）

## Layer 1: Spec-Code 对齐

本次为 fix 模式（单一缺陷修复），无独立 FR 编号体系，对齐目标即 fix-report.md 中定义的修复目标：消除 `tests/unit/feature-187-dataset-build.test.ts`"单一一致标签"用例对本机 `scripts/.swebench-venv` 环境状态的隐式依赖，根治全量并行下的超时 flaky。

| 修复目标 | 状态 | 证据 |
|---------|------|------|
| 消除测试对本机 venv 环境状态的依赖 | ✅ 已实现 | `git diff` 确认改动为显式注入不存在的 `--venv` 路径，测试路径不再依赖 `scripts/.swebench-venv` 是否存在 |
| 隔离跑功能正确 + 耗时降级 | ✅ 已实现 | 见 Layer 2 T002 结果 |
| 全量并行零回归 + flaky 消除 | ✅ 已实现 | 见 Layer 2 T003 结果 |
| 构建零错误 | ✅ 已实现 | 见 Layer 2 T004 结果 |

## Layer 1.5: 验证铁律合规

implement 子代理声称的隔离跑（9 用例过、目标用例 22ms）、全量跑（428 files / 5067 tests passed）、build 零错误，均已由本次验证子代理**独立重跑复核**（非引用，非推测性表述），命令、退出码、输出详见下方 Layer 2。状态：**COMPLIANT**。

## Layer 2: 原生工具链验证（TypeScript / Node.js, npm）

**检测到**: `package.json`（npm，非 monorepo）

### T001 改动本体（对应 tasks.md T001）

- 命令：`git diff tests/unit/feature-187-dataset-build.test.ts` + `git status --short`
- 退出码：0（git diff/status 均正常输出，非错误退出）
- 结果：改动仅限单文件单用例范围，符合验收标准

### T002 隔离跑目标测试文件（对应 tasks.md T002）

- 命令：`npx vitest run tests/unit/feature-187-dataset-build.test.ts --project unit --reporter=verbose`
- 退出码：0
- 结果：**Test Files 1 passed (1) / Tests 9 passed (9)**，总耗时 221ms
  - 目标用例"单一一致标签 → 通过标签推导守卫（不报标签错），继续走 fetch（datasetName 已透传，非默认 Lite 由 datasetTagToHfId 保证）"实测 **20ms**（原基线 ~4100ms，降幅 >99%），远低于验收标准 <200ms
  - 其余 8 用例（datasetTagToHfId 4 项 + buildLocalDataset 2 项 + CLI 标签守卫另 2 项）均通过，耗时 0-21ms
- 判定：达标（tasks.md T002 声称"8 个 it 零失败"实为 9 个 it，属笔误，不影响判定；全部通过为事实）

### T003 全量单测跑（对应 tasks.md T003）

- 命令：`npx vitest run`
- 退出码：0
- 结果：**Test Files 428 passed | 4 skipped (432) / Tests 5067 passed | 18 skipped | 21 todo (5106)**，总耗时 36.24s
- 本次全量运行中，已知的既有 flaky 用例（watch-command.test.ts / batch-orchestrator-incremental.test.ts / community-analysis 5000 节点 perf）均未触发失败，本次是全绿一次通过，无需额外隔离重跑澄清
- 目标测试文件 `tests/unit/feature-187-dataset-build.test.ts` 在本次全量并行运行中随其他 428 文件一并通过，未见超时迹象
- 判定：达标（零失败，flaky 未复现）

### T004 构建校验（对应 tasks.md T004）

- 命令：`npm run build`
- 退出码：0
- 结果：`tsc` 类型检查零错误，`postbuild-stamp` 正常盖章（commit=d3cf1a92 dirty，dirty 因本次改动未提交，符合预期）
- 判定：达标

### 汇总表

| 验证项 | 命令 | 状态 | 详情 |
|--------|------|------|------|
| Build | `npm run build` | ✅ PASS | tsc 零错误，exit 0 |
| Test（隔离） | `npx vitest run tests/unit/feature-187-dataset-build.test.ts` | ✅ 9/9 passed | 目标用例 20ms，exit 0 |
| Test（全量） | `npx vitest run` | ✅ 5067/5067 passed（18 skipped, 21 todo） | 428 files passed，exit 0 |
| Lint | 未在 config.verification 要求范围内 | ⏭️ 未执行 | 本次 fix 未要求 lint 门禁 |

## tasks.md 逐任务证据核查表

| 任务 | 声称 | 独立复核证据 | 判定 |
|------|------|-------------|------|
| T001 | 注入不存在的 `--venv` 路径，git diff 限定范围 | `git diff` 亲测确认：新增 `venvPath` 变量 + `--venv` 参数 + 2 处注释调整，无生产代码改动 | ✅ 有证据支撑 |
| T002 | 隔离跑全过，耗时降至毫秒级 | `npx vitest run ... --reporter=verbose` 亲测：9/9 passed，目标用例 20ms | ✅ 有证据支撑（用例数 9 而非文档描述的 8，属文档笔误，不影响功能判定） |
| T003 | 全量跑零失败，flaky 已消除 | `npx vitest run` 亲测：428 files passed / 5067 tests passed，零失败，一次性全绿 | ✅ 有证据支撑 |
| T004 | 构建零类型错误 | `npm run build` 亲测：exit 0，tsc 无报错输出 | ✅ 有证据支撑 |

implement 子代理声称的数字（隔离 9 用例全过、目标用例 22ms、全量 428 files/5067 tests passed 零失败、build 零错误）与本次独立复核实测数字**高度一致**（目标用例 20ms vs 22ms 属正常抖动范围内，其余完全一致）。

## 修复目标达成判定

fix-report.md"修复策略-方案 A"声称：将测试改为显式注入不存在的 `--venv` 路径，使其不再依赖本机是否存在 `scripts/.swebench-venv`，从而消除因真实 venv 触发的耗时 HF fetch 路径导致的超时 flaky。

本次验证在**本机确实存在 `scripts/.swebench-venv`（原 flaky 触发条件成立）**的前提下：
- 隔离跑目标用例仅需 20ms（远低于 5000ms 默认超时及 tasks.md 200ms 验收线）
- 全量并行跑一次性全绿，无超时迹象
- 构建零错误，无回归

结论：**修复目标已达成**。测试改为显式传入不存在的临时 `--venv` 路径后，行为不再受本机是否安装 `scripts/.swebench-venv` 影响，flaky 的环境耦合根因已被消除。

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| 改动范围 | ✅ 限定单文件单用例，无污染 |
| Build Status | ✅ PASS |
| Test Status（隔离） | ✅ PASS (9/9) |
| Test Status（全量） | ✅ PASS (5067/5067, 18 skipped, 21 todo) |
| 修复目标达成 | ✅ 达成 |
| **Overall** | **✅ READY FOR REVIEW** |

### CRITICAL / WARNING / INFO

- **CRITICAL**: 0 条
- **WARNING**: 0 条
- **INFO**: 1 条 — tasks.md T002 验收标准描述"8 个 it"，实际用例数为 9 个（4 describe 块合计 9 it），属文档计数笔误，不影响功能判定，建议后续同步修正文档但不阻断本次交付

### 未验证项

- 无（本次 fix 范围内 lint 非门禁要求，未执行；build/test 均已独立复核）
