# Feature Specification: 簇④ 引擎 / CLI 小补合集（M11 卡 C）

**Feature Branch**: `master`（`/goal` 授权下主线程直接实现；story 模式的制品按最小集补齐）
**Created**: 2026-09-15
**Status**: shipped

## 需求来源

M11 §9.3 卡 C：簇④ 的 14 项小补（`docs/design/dogfooding-feedback-ledger.md` 2026-09-14 两轮 milestone-next 流转）。

## 功能需求

- **FR-001**: `get-phases` 输出补 `gates_before` / `gates_after`（并带 resolver `diagnostics`，对抗审查 W-5）。
- **FR-002**: `AGENTS_CANDIDATES` 从 `scripts/lib/worktree-local-state-core.mjs` 导出并冻结，`agents-byte-budget` 三态 evidence 都带 `candidates`；story / feature SKILL 加「守护项口径从源码现取」。
- **FR-003**: `check-fr-matrix.mjs constitution`：Constitution 引用 ⊆ 矩阵已登记集合；章节缺席 `passed:false` + `sectionMissing`；标题容忍 `N. ` 前缀与装饰；fenced code / 行内代码 / 引用块不算引用。
- **FR-004**: `check-fr-matrix.mjs verify-gaps`：spec FR − Phase 已认领 − 约束型 = 补登清单；认领列语义（移交 / 裁剪 / —）；首格多编号（区间 / 链接 / 斜线 / 逗号 / 反引号）；只认第一张表；`specEmpty` / `claimColumnMissing` 显式标记。
- **FR-005**: 第 6 个共享块 `templates/gate-class-mandatory-upgrade.md`（(ii) 门禁类升格条款 + 换算式）注入 plan.md + 4 份 SKILL；parity 测试机械对拍 13 条路径。
- **FR-006**: `yamlScalar` 对裸写会被标准 YAML 读成非 string 的字符串加引号（整数 / 小数 / 指数 / 前导零 / 十六进制 / 八进制 / 二进制 / inf / nan / 布尔别名 / null / 时间戳），普通标识符不加。
- **FR-007**: `agents/verify.md` 分层索引（定义层 / 流程层）。
- **FR-008**: `templates/gate-design-convergence-loop.md` 共享制品的类别判定三条规则。
- **FR-009**: sync 引擎 fix-report 消费通道（无 spec.md / spec.md 占位 + fix-report.md ⇒ `artifact:'fix-report'`，`fixReports[]`）；同编号既有实质 spec.md 时 fix-report 通道跳过（对抗审查 C-1）。
- **FR-010**: `--preflight` 只数不写，分母与 Phase 5 同源（W-1）。
- **FR-011**: `--lint` 四类写法告警 + 同编号多目录 ⇒ 结构化 findings + exit 1（json / 非 json 两路）；`fr-floor` 用独立扫描器（C-2）。
- **FR-012**: 三套 `parseProductMapping` 收敛到 canonical；`spec-directory-index.mjs` 共享编号索引（tie-break 字典序首个）。
- **FR-013**: mapping 写回改 in-place 补丁（目标 key 任意尾部形态视为已存在，C-3）。
- **FR-014**: 40 处 `@ts-expect-error`（TS2578）删除（对抗审查 W-9 校正：42 → 40；`typecheck:tests:full` 1071 → 1031，零真错误浮现）。

## 边界 / 已知限界（登记，不在本卡修）

- 占位判据是三个模板字面量（H1 的 FEATURE NAME 占位、分支名占位、样板 FR 正文开头），模板改写超出这三处仍会被当真 spec；反过来，**正文里逐字引用这些字面量的文档也会被判成占位**（本文件首版就因此被引擎剔出活文档——判据须改为只看结构位置，见 M11 修订稿 A11）。
- 同目录既有实质 spec.md 又有 fix-report.md 时，fix-report 的行为变化不进活文档（设计如此）。
- `--lint` 不对占位目录产 finding（只在 preflight / stats 指名）。
