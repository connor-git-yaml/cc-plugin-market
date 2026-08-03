# Verification Report: F252 collector-surface 同族深收敛批次三项修复

**特性分支**: `claude/funny-driscoll-fc77bb`
**验证日期**: 2026-08-04
**验证范围**: Layer 1 (Spec-Code 对齐，fix 模式精简版) + Layer 1.5 (验证铁律合规) + Layer 1.75/1.8/1.9 (深度检查/残留扫描/文档一致性) + Layer 2 (原生工具链，实际执行终态复核)

## 说明

本报告为主编排器点名要求的**终态复核**：4a（spec-review）子代理因工具集不含 Bash，未能实际执行三条验收命令，仅完成静态代码核验；本轮由验证闭环子代理实际执行 `npx vitest run`（全量）、`npm run build`、`npm run repo:check`，并补齐 T012-T014 的真实执行证据、抽查 T005 新增测试的断言方向。

## Layer 1: Spec-Code 对齐（fix 模式，按 tasks.md checkbox 统计）

### Task 完成度

| Task | 描述 | 状态 |
|------|------|------|
| T001 | ignore-oracle.ts 改 `surfaceMatchesFile` 四连 + 注释重写 | ✅ 已实现（4a 已核验） |
| T002 | generic-language-skeleton-collector.ts 两处收敛 | ✅ 已实现（4a 已核验） |
| T003 | file-scanner.ts 一处收敛 | ✅ 已实现（4a 已核验） |
| T004 | grep 前置确认 `extractExtension` 归零 | ✅ 已实现（本轮复核：全仓 grep 仍为零匹配，见下方 Layer 1.8） |
| T005 | ignore-oracle.test.ts 新增 3 条用例 | ✅ 已实现（本轮抽查断言方向，见下方"T005 抽查"） |
| T006 | `isValidCollectorFingerprint` 签名改 boolean | ✅ 已实现（4a 已核验） |
| T007 | pinned-asset-loader.ts 迁移 `parseCollectorFingerprint` | ✅ 已实现（4a 已核验） |
| T008 | guardrail 测试删除 `as never` | ✅ 已实现（4a 已核验） |
| T009 | 删除 collector-extname.ts + 测试 | ✅ 已实现（4a 已核验） |
| T010 | source-commit.ts 注释同步 | ✅ 已实现（4a 已核验） |
| T011 | collector-surface.ts 注释同步 | ✅ 已实现（4a 已核验） |
| T012 | `npx vitest run` 全量绿 | ✅ 已实现（本轮实际执行，见 Layer 2） |
| T013 | `npm run build` 零类型错误 | ✅ 已实现（本轮实际执行，见 Layer 2） |
| T014 | `npm run repo:check` 零漂移 | ✅ 已实现（本轮实际执行，见 Layer 2；预存 warn 非本批次引入） |
| T015 | 提交前 Codex 对抗审查 | ⬜ 未完成（checkbox 仍为 `[ ]`，按主编排器上下文说明将随后执行，非本轮验证闭环职责范围） |

### 覆盖率摘要

- **总 Task 数**: 15
- **已实现（checkbox 已勾选且证据确认）**: 14
- **未实现**: 1（T015，属主编排器随后阶段，非本次交付缺口）
- **覆盖率**: 14/15 ≈ 93.3%（T015 非代码实现缺口，而是流程门禁尚未触发）

### T005 抽查（对照 plan.md 声明的 3 条新增测试断言方向）

实读 `src/panoramic/graph/quality/ignore-oracle.test.ts` L152-166：

| 断言 | 期望 | 实际代码 | 核对结果 |
|------|------|----------|----------|
| `vendor/.go` | → false（不 ignored） | L155 `expect(isIgnoredPath('vendor/.go')).toBe(false)` | ✅ 方向一致 |
| `.gradle/.java` | → false（不 ignored） | L160 `expect(isIgnoredPath('.gradle/.java')).toBe(false)` | ✅ 方向一致 |
| `vendor/foo.go`（对照组，真实 Go 文件） | → true（仍 ignored） | L165 `expect(isIgnoredPath('vendor/foo.go')).toBe(true)` | ✅ 方向一致 |

三条断言方向与运行时上下文点名的期望（`vendor/.go→false`、`.gradle/.java→false`、`vendor/foo.go→true`）完全一致，且注释（L148-151, L152, L158, L163）清晰说明了行为变化点的判据边界。未发现"纸面完成但断言方向错误"的情况。

## Layer 1.5: 验证铁律合规

- **implement 阶段证据**：4b（quality-review）报告明确记录"本次审查同步跑"了 `npx vitest run`（120/120 通过，覆盖本批次 5 个受影响测试文件）与 `npx tsc --noEmit -p tsconfig.json`（零错误），属有效证据（具体命令 + 数字 + 结果）。
- **本轮补充证据**：验证闭环子代理本轮实际执行了全量 `npx vitest run`、`npm run build`、`npm run repo:check`（详见 Layer 2），退出码与输出摘要均为实测，非引用/推测。
- **推测性表述扫描**：4a/4b 报告中均无"should pass"/"看起来没问题"等推测性表述；4a 报告对 T012-T014 如实标注"无法验证（本子代理无 Bash 工具）"，属诚实降级声明，非违规。
- **状态**: **COMPLIANT**（本轮已补齐全部三条命令的真实执行证据）

## Layer 1.75: 深度检查

**a. 调用链完整性**：`ignore-oracle.ts::ignoreDirsForPath` → `surfaceMatchesFile`（collector-surface.ts）单点判定，无参数丢失或异常吞噬；`generic-language-skeleton-collector.ts::resolveAdapterForFile`/`walkFiles` 与 `file-scanner.ts::walkDir` 均直接调用同一 `surfaceMatchesFile`，调用链短且无中间层。

**b. 数据持久化验证**：本批次不涉及数据库/文件持久化写入，N/A。

**c. 配置贯穿验证**：本批次不涉及配置项传递，N/A。

## Layer 1.8: 残留扫描

本次改动涉及删除（`collector-extname.ts` + 其测试）与语义迁移（`extractExtension`/`surfaceHasExtension` → `surfaceMatchesFile`），执行残留扫描：

```
$ grep -rn "extractExtension\|collector-extname" src/ tests/
（无匹配）
```

- `src/`、`tests/` 中无 `extractExtension` 或 `collector-extname` 残留引用（生产代码与测试代码均已零引用）。
- `docs/`、`README.md`、`AGENTS.md`、`CLAUDE.md` 未搜索到相关引用（本批次未涉及面向这些文档的概念命名）。
- 旧文件 `src/panoramic/graph/collector-extname.ts` 与 `src/panoramic/graph/collector-extname.test.ts` 已物理删除（4a 报告 Glob 确认零匹配），无孤立文件残留。
- **结论**: 未发现残留（非 RESIDUAL_FOUND）。

## Layer 1.9: 文档一致性检查

本批次不构成架构级变更（未新增/删除模块边界、未修改公共接口签名的对外契约），仅为内部实现收敛 + 派生死代码清理。`source-commit.ts` L61-67 与 `collector-surface.ts` L160-170 的注释已按 T010/T011 同步更新为如实反映现状的表述（4a 报告已核实）。未发现需要额外更新的架构文档（Blueprint/README/ADR）引用已删除概念。

- **结论**: 未发现文档漂移（非 DOC_DRIFT）。

## Layer 2: 原生工具链验证（本轮实际执行）

### TypeScript/Node.js (npm)

**检测到**: package.json
**项目目录**: 根目录

| 验证项 | 命令 | 状态 | 详情 |
|--------|------|------|------|
| Build | `npm run build` | ✅ PASS | `tsc` 零类型错误；`[inline-d3] d3-force 3.0.0 内容无变化，跳过写入`；`postbuild:stamp` 正常盖章（commit=68eb7e5f dirty）；退出码 0 |
| Test | `npx vitest run`（全量） | ✅ PASS | **Test Files 515 passed \| 4 skipped (519)**；**Tests 6954 passed \| 18 skipped \| 21 todo (6993)**；Duration 62.93s；退出码 0。已知 flaky（watch-command / batch-orchestrator-incremental / community-analysis perf）本次全量并行跑批中**均未出现失败**，无需隔离重跑 |
| repo:check | `npm run repo:check` | ✅ PASS（含 1 项非阻断 warn） | 82 项 check 中 81 项 pass，1 项 warn：`graph-quality:freshness`（图 sourceCommit 停在 `8d25c264...`，与当前 HEAD `68eb7e5f...` 不一致；collector-fingerprint-unrecorded）；此 warn 与运行时上下文点名的"已知预存 warn"完全一致，属本批次前既有状态，非本次改动引入；退出码 0（`status=warn` 不构成脚本失败） |

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| Task Coverage（fix 模式） | 93.3%（14/15，唯一缺口 T015 属主编排器随后阶段） |
| Build Status | ✅ PASS（退出码 0，零类型错误） |
| Test Status | ✅ PASS（515 test files / 6954 tests 全通过，无失败无需隔离重跑） |
| repo:check Status | ✅ PASS（1 项已知非阻断 warn：graph-quality freshness，本批次前既有） |
| Layer 1.5 验证铁律合规 | ✅ COMPLIANT |
| Layer 1.8 残留扫描 | ✅ 无残留 |
| Layer 1.9 文档一致性 | ✅ 无漂移 |
| **Overall** | **✅ PASS — 三条验收命令实测零失败，T012-T014 终态复核通过** |

### [Spec 合规] 对 4a 报告结论的采信/异议

**采信**：4a 报告 T001-T011 的逐条静态核验结论（"已实现"+具体行号证据）经本轮抽查（T005 断言方向）交叉验证一致，予以采信。4a 报告如实标注 T012-T014"无法验证"（工具集限制）属诚实降级，非缺陷。

**补充**（非异议）：本轮已实际执行 T012-T014 的三条命令，全部通过，**填补了 4a 报告点名的 INFO 缺口**（"建议编排器提交前实际重跑三条命令做终态确认"）。T015（Codex 对抗审查）仍待主编排器随后执行，与 4a 报告的 WARNING 判定一致，非本轮验证闭环职责范围内的缺口。

**无异议**：未发现与 4a 报告结论相悖的证据。

### [代码质量] 对 4b 报告结论的采信/异议

**采信**：4b 报告"EXCELLENT"评级（0 CRITICAL / 0 WARNING / 2 INFO）经本轮全量验证交叉核实一致——4b 报告声称的 120/120 局部测试通过在本轮全量跑批（6954 通过）中未出现任何退化或新增失败，`npx tsc --noEmit` 零错误的结论在本轮 `npm run build` 全量构建中同样零错误复现。

**无异议**：2 条 INFO（`resolveAdapterForFile` 逐 adapter 构造 surface 的可忽略微分配、ignore-oracle 新测试对 adapter `defaultIgnoreDirs` 具体内容的耦合前提）均为可选优化/加固建议，非缺陷，本轮未发现需要升级为 WARNING/CRITICAL 的新证据。

### 需要修复的问题（如有）

无。三条验收命令全部实测通过，未发现回归、纸面完成或推测性表述问题。

### 未验证项（工具未安装）

无（本项目工具链 npm/tsc/vitest 均已安装可用）。

### 待办（非本轮验证闭环职责，交主编排器处理）

1. T015：提交前 Codex 对抗审查尚未执行（tasks.md checkbox 仍为 `[ ]`），需在 commit 前补跑，若发现 critical/warning 需修复后重跑 T012-T014（本报告的 Layer 2 结论仅对当前代码状态有效，若 T015 后有代码改动需重新验证）。
