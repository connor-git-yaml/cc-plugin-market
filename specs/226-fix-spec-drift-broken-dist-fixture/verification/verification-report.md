# Verification Report: fix-spec-drift-broken-dist-fixture

**特性目录**: `specs/226-fix-spec-drift-broken-dist-fixture`
**模式**: fix（轻量验证路径，4a/4b 并入本报告）
**验证日期**: 2026-07-22
**验证范围**: Layer 1（Fix-Report 对齐，spec.md 不适用于 fix 模式）+ Layer 1.5（验证铁律）+ Layer 2（原生工具链）+ 合并审查清单 + 对抗视角

## Layer 1: Fix-Report 对齐

fix 模式无独立 spec.md；对齐基准为 `fix-report.md` 的根因链与"方案 A（推荐）"。

| 修复动作 | 根因对应 | 状态 | 说明 |
|---------|---------|------|------|
| 新建 `broken-dist/dist/core/ast-analyzer.js`（语法非法 ES module） | Why3/Why4：fixture 从未入库 | ✅ 已实现 | 内容 `export const = ;;;`，与 `spec-drift-dist-loader.test.ts` 的 broken-syntax.js 口径一致；文件头有醒目中文"请勿修好"注释 |
| `.gitignore` 加 `!tests/fixtures/spec-drift/graph-unavailable/broken-dist/dist/` | Why4：顶层 `dist/` 规则任意层级吞掉子树 | ✅ 已实现 | 独立验证 `git check-ignore` 不再命中，`git add --dry-run` 成功列出该文件 |
| `spec-drift-core-validate.test.ts` 加 30000ms 显式 timeout | 非缺陷项：冷缓存假红 | ✅ 已实现 | 仅放宽用例级 timeout 参数，**未改动任何 `expect` 断言** |

覆盖率：3/3 修复动作已落地且与 fix-report 描述一致。**未发现 fix-report 未覆盖的行为变化**。

### 「诊断期修正」块核实

fix-report.md 41-47 行如实记录了初稿 `git check-ignore` 核验路径写错（漏了一层 `dist/`）导致误判"未被 gitignore 排除"的事实，并补充了教训。经比对，该修正块与本次改动动机（必须加 `.gitignore` 放行规则）逻辑自洽，**未发现虚构或美化**。

## Layer 1.5: 验证铁律合规

- **状态**: COMPLIANT
- 主编排器上文列出的证据（41/41 pass、check-ignore exit 1、git add --dry-run 成功）均包含具体命令 + 可复核结果，非推测性表述
- 本报告已独立重跑全部关键命令（见下），退出码与输出与主编排器声明一致
- 缺失验证类型：无
- 检测到的推测性表述：无

## Layer 1.75/1.8/1.9

- **调用链完整性**：不适用（本次未改动生产代码调用链，仅测试 fixture + gitignore + timeout 参数）
- **数据持久化**：不适用
- **配置贯穿**：不适用
- **残留扫描**：不适用（无删除/重命名）
- **文档一致性**：README.md（`graph-unavailable/README.md`）已提前声明 `broken-dist/` 语义，本次修复使其与实际文件系统状态一致，无需再改文档

## Layer 2: 原生工具链（独立实跑复核）

**检测到**: package.json（npm）+ TypeScript（tsc）
**项目目录**: 仓库根目录

| 验证项 | 命令 | 状态 | 详情 |
|--------|------|------|------|
| 目标测试 | `npx vitest run tests/unit/spec-drift-check.test.ts tests/unit/spec-drift-core-validate.test.ts tests/unit/spec-drift-dist-loader.test.ts` | ✅ PASS 41/41 | 3 files, 12.14s；含目标用例"dist 存在但加载失败 → dist-load-failed"及原冷缓存假红用例均绿 |
| gitignore 放行验证 | `git check-ignore -v tests/fixtures/.../ast-analyzer.js` | ✅ PASS（exit 1，未被忽略） | 修复前应命中 `.gitignore:6:dist/`；修复后无匹配 |
| add 可入库验证 | `git add --dry-run tests/fixtures/.../broken-dist/` | ✅ PASS | 输出 `add 'tests/fixtures/spec-drift/graph-unavailable/broken-dist/dist/core/ast-analyzer.js'` |
| 全局 excludesFile 冲突排查 | `git config core.excludesFile` + `.git/info/exclude` | ✅ PASS | 全局 gitignore 与 info/exclude 均无额外 `dist` 规则，排除"CI 环境下再次被吞"的顾虑 |
| Build | `npm run build` | ✅ PASS | tsc 编译 + postbuild-stamp 正常，无新增错误 |
| Lint | `npm run lint` | ✅ PASS | `tsc --noEmit` 零错误 |
| repo:check | `npm run repo:check` | ⚠️ 1 项既有 warning（与本次改动无关） | 78 项检查全部 pass，唯一 warning 为 `graph-quality:freshness`（图产物 sourceCommit 与当前 HEAD 不一致，worktree 常见陈旧图现象，见 memory 记录），`spec-drift:anchors-status: pass` 未受影响；**未触发任何 `.gitignore` 相关新增告警** |

## 合并审查清单

```
[Spec 合规]
- 修复是否与 fix-report 根因一致                          → PASS（根因=fixture 被 .gitignore 吞掉，三处改动逐一对应）
- 是否引入 fix-report 未覆盖的行为变化（timeout 是否放宽断言）→ PASS（timeout 参数与 expect 断言无关，diff 中断言逐行未改；30s 上限仅放宽执行时间，未放宽判定条件）
- 「诊断期修正」块是否如实记录 check-ignore 路径写错          → PASS（已核实，逻辑自洽）

[代码质量]
- fixture 内容是否会被后人误当手误"修好"                    → PASS（文件头有"【故意语法非法 —— 请勿"修好"它】"醒目中文注释 + 与既有 broken-syntax.js 口径对齐说明）
- .gitignore 放行规则是否最小必要、注释是否说明 why          → PASS（规则精确到完整目标目录路径，非通配符，注释解释了根因与"先放行目录本身"的 git 约束）
- timeout 值是否合理、是否掩盖了真实的性能退化               → PASS（30s 相对实测冷缓存 ~5s 有约 6 倍余量，非"无限大"掩盖；若真退化到 20s+ 该用例仍会告警，见对抗视角 2）
- 是否改动了任何生产代码或测试断言语义                       → PASS（否，diff 仅涉及 fixture 新文件 + gitignore 放行规则 + 一处 timeout 参数）
```

## 对抗视角

1. **"fixture 现在真的能入库"是否被 `git add --dry-run` 成功充分证明？**
   独立复核认为**基本充分但非绝对**：`--dry-run` 精确复现了 `git add` 的路径遍历+ignore 判定逻辑，且额外核实了（a）无全局 `core.excludesFile` 冲突、（b）无 `.git/info/exclude` 冲突、（c）`git check-ignore -v` 对完整目标路径给出 exit 1（未忽略）。三方交叉验证后风险很低。唯一未覆盖的场景是"CI 环境使用不同的 git 版本对 `!` 否定模式解析行为不同"——这是理论边界（git 否定模式语义自 2.x 起稳定，实践中不构成实质风险），不构成 blocker。
   *(过程中发现一个良性怪癖：`git check-ignore <dir>`（无 -v）exit 1，但加 `-v` 对同一目录路径 exit 0——这是 git 2.53.0 对目录参数在 verbose 模式下报告"匹配到的否定规则"时退出码语义不一致的已知怪癖，不影响文件级判定结果，`git add --dry-run` 与 `git status` 的实际结果均确认未被忽略。)*

2. **加 30s timeout 是否掩盖真实问题？将来退化到 20s 是否还能告警？**
   不掩盖。fix-report 已用 `--testTimeout=60000` 实测隔离出真实耗时 700ms（热缓存）vs 冷缓存首跑，30s 相对 700ms 有 40+ 倍余量、相对已观测的 ~5s 冷缓存有 6 倍余量。若未来真实退化到 20s，用例仍会在 30s 内通过并且肉眼可见 vitest 输出的耗时数字（如本次复核输出中 `2815ms`），不是静默通过；只有退化超过 30s 才会失败告警。**结论**：30s 是"消除已知良性抖动"与"保留退化探测"之间的合理平衡点，非无限放宽。

3. **放行 `broken-dist/dist/` 是否会意外让其它构建产物混入版本库？**
   不会。`.gitignore` 新增规则是**完整绝对路径字面匹配**（`!tests/fixtures/spec-drift/graph-unavailable/broken-dist/dist/`），不含通配符 `*`，仅精确放行这一个目录，不影响仓库任何其它 `dist/` 目录（含顶层构建产物 `dist/`、`plugins/*/dist/` 等）。已用 `npm run build` 复核构建产物本身未受影响，`npm run repo:check` 的受控文件检查族全 pass。

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| Fix-Report 对齐 | 3/3 修复动作落地，根因链自洽 |
| 验证铁律合规 | ✅ COMPLIANT |
| Build Status | ✅ PASS |
| Lint Status | ✅ PASS |
| Test Status | ✅ PASS (41/41) |
| repo:check | ⚠️ 1 项既有 warning（图陈旧，无关本次改动） |
| **Overall** | **✅ READY** |

### 需要修复的问题（如有）

无。

### 未验证项（工具未安装）

无（build/lint/test/repo:check 全部工具已安装并实跑）。

### 判定

**READY**（可交付进入下一阶段 / commit）。
