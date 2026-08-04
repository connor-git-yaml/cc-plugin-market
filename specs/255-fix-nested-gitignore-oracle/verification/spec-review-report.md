# Phase 4a Spec 合规审查报告（子代理产出，主编排器落盘）

**总结论：PASS**（合规，1 WARNING / 1 INFO / 0 CRITICAL）

说明：本特性为 fix 模式，`spec.md` 是未填写的空模板，不承载本卡需求；事实源 = `fix-report.md`（5-Why + 方案 A 合同）+ `plan.md`（5 项变更清单 + 回归风险评估 + 测试规划）。

## 与 plan.md 变更清单逐项核对

| # | 内容 | 状态 | 证据 |
|---|------|------|------|
| 1 | `createGitignoreFilter(projectRoot, walkBase=projectRoot)` 新增 git 模式分支 | ✓ | `src/utils/file-scanner.ts:207-284`：`readGitIgnoredIndex`（`git ls-files --others --ignored --exclude-standard --directory -z`）+ `createGitIgnoredLookup` 精确文件集合+目录前缀查找，`console.warn` 诊断分支（L280-282）逐字命中方案 A |
| 2 | `scanFiles` 内部改传 `(projectRoot, resolvedDir)` | ✓ | `file-scanner.ts:449`，注释准确复述 F194 基准错位怪癖修法 |
| 3 | `BEHAVIOR_VERSION` 1→2 | ✓ | `collector-fingerprint.ts:87`；责任清单结构未动；下游测试无硬编码字面量 `1` 断言（全部符号引用） |
| 4 | pinned fixture 再生 | ✓ | 两份资产 `behaviorVersion` 均为 `2` |
| 5 | 注释矫正（无行为变化） | ✓ | file-scanner 头部/L244-265、`ignore-oracle.ts:150`、`python-adapter.ts:142-144`、`source-discovery.ts:265-266/423-424`；全仓 grep 旧表述零残留 |

改动面精确匹配 7 个 F255 相关文件，无清单外文件被触碰；`src/watcher/file-watcher.ts`（登记"本次不修"）确认未改动。

## 回归风险评估核对

- §1 非 git 回退字节级不变性：`parseGitignore`（L146-188）与修复前逐字节相同，仅作为 fallback 分支复用（非重写）
- §2 真实仓库调用点行为：只读审查无法实跑，留待 T016（见 WARNING）
- §4 TS 契约：`walkBase` 可选参数，4 处既有单参调用点签名未动，"零代码改动"承诺属实

## 测试规划核对

plan 测试规划 6 组用例全部落地：嵌套 .gitignore（file-scanner.test.ts:389-400）、tracked 豁免（402-414）、非 git 回退等价（339-365）、walkBase（429-442，含基准错位对照组）、git 失败诊断（444-455，实现方式优于计划：真实失败路径替代 mock，[INFO] 合理改进）、跨侧一致性 A/B/C（tests/integration/gitignore-collector-freshness-consistency.test.ts，真实 git init、用例 B 双向同向断言）。额外"整目录忽略"用例（416-427）带伪前缀边界断言，属合同加固。

## 问题分级汇总

- **CRITICAL**: 0
- **WARNING**: 1 — tasks.md 的 T016（全量 vitest）/T017（repo:check）/T018（对抗审查）checkbox 未勾选，Phase 5 收尾待主编排器执行并留证（fixture 再生顺序敏感性代码证据正确，但需执行记录佐证）
- **INFO**: 1 — T012 用例实现方式与 plan 文字不完全一致（真实失败路径替代 mock），合理改进无需处置

## 结论

代码改动与 fix-report 根因链、方案 A 合同五要点、plan 五项变更清单、测试规划全部逐条对应，无偏离、无缩水、无清单外行为变化。唯一待办为 T016-T018 收尾验证留证。
