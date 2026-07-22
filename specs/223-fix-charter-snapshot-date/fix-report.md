# 问题修复报告 — F223 charter 快照烤死生成日期

> 缺陷位于 F220 交付的守护资产 `tests/e2e/f220-decomposition-charter.e2e.test.ts`，
> 但本次修复本身按 F223 立项交付。

- **特性编号**: 223（原编 F222，交付前 fetch 发现并行 session 的 F222 已抢先落地 master
  并占用 `specs/222-fix-cli-auth-hardgate`，故全量改号避免冲突）
- **模式**: fix（快速问题修复）
- **诊断日期**: 2026-07-22
- **诊断时基线**: `23ffc8f`（F221 tip）
- **实际交付基线**: `a7f85e2`（并行 F222 tip）—— 交付前 rebase 至此并重跑全量验证；
  该 commit 改过 `src/batch/batch-orchestrator.ts`，rebase 后 charter 12/12 复验通过，
  确认未触碰本快照冻结的可观测行为
- **交付 commit**: `26fe3a1`（已 ff push 到 origin/master）

## 问题描述

`tests/e2e/f220-decomposition-charter.e2e.test.ts` 的快照文件
`tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap` 内烤死了生成日期字面量
`2026/7/21`。系统日期推进到 2026-07-22 后，该文件 9 个用例确定性失败，隔离重跑仍红。

需求：修完后 `npx vitest run tests/e2e/f220-decomposition-charter.e2e.test.ts` 必须在**任意系统日期**下全绿。

背景：F221 验证期间发现并归档于 `specs/221-fix-specgen-reexport-whitespace/verification/verification-report.md`。

### 复现证据（2026-07-22 实跑）

```
 Snapshots  9 failed
 Test Files  1 failed (1)
      Tests  9 failed | 2 passed (11)
```

全部 9 个失败的 diff 变化行去 ANSI 后聚合，唯一差异即日期字面量、零其它漂移：

```
   9 - > 由 spectra v4.3.0 自动生成 | 2026/7/21
   9 + > 由 spectra v4.3.0 自动生成 | 2026/7/22
```

快照内 `2026/7/21` 恰好出现 9 次（`.snap` L286 / 739 / 1260 / 1804 / 2041 / 2546 / 3080 / 3509 / 4098），
与 9 个失败用例一一对应。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 表面症状为何发生？ | 快照期望 `2026/7/21`，实跑产出 `2026/7/22` —— README 首行的生成日期字面量被冻进了快照 |
| Why 2 | 该日期为何会进快照？ | `reportingArtifacts()`（测试 L258-277）有意把 `specs/README.md` **全文**纳入冻结（Codex G 审查 C2：抓 B7 搬迁的空文件化/参数断线）；README 首行由 `src/batch/batch-readme-generator.ts:49` 写入 `new Date().toLocaleDateString('zh-CN')` |
| Why 3 | 为何未被噪声清洗拦下？ | `scrubRuntimeNoise()`（测试 L167-177）的时间类规则只覆盖 ISO-8601 **完整**形态 `\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z`；zh-CN 本地化日期是 `YYYY/M/D`（斜杠分隔、无 T/Z、月日不补零），不匹配任何既有规则 |
| Why 4 | 为何漏了这一形态？ | 清洗清单是按"建立基线当天实跑产物里**观察到**的噪声"逐条枚举的（路径 / 40-hex SHA / ISO 时间戳 / durationMs / batchId / ms / s），而非按"所有非确定性来源"系统枚举。README 日期在建基线当天与快照同值，观察不到差异，因而未被识别为噪声 |
| Why 5 | 为何未被现有机制捕获？ | 守护层自检（场景10a，测试 L542-557）只校验快照 **key 集合**不增删，不校验快照**内容对时间的不变性**；CI 与本地也没有"改系统日期重跑"的时间旅行验证。于是这颗雷只能等真实跨日才引爆 |

**Root Cause**: 特征化快照把**随系统日期变化的本地化日期**当成稳定内容冻结 —— `scrubRuntimeNoise` 的时间清洗规则只覆盖 ISO-8601 完整形态，未覆盖 `toLocaleDateString('zh-CN')` 产出的 `YYYY/M/D` 形态。

**Root Cause Chain**:
9 用例跨日全红 → 快照期望日期与实跑日期不等 → README 全文（含首行日期）被纳入内容冻结 → `scrubRuntimeNoise` 时间规则只认 ISO-8601、不认本地化日期 → 清洗清单按"当天观察到的噪声"枚举而非按非确定性来源枚举 → 守护层只校验 key 集合、无时间不变性验证。

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `tests/e2e/f220-decomposition-charter.e2e.test.ts` | L167-177 `scrubRuntimeNoise` | 时间类清洗规则缺本地化日期形态 | 增加 `YYYY/M/D` → `<DATE>` 规则 |
| `tests/e2e/__snapshots__/f220-decomposition-charter.e2e.test.ts.snap` | 9 处日期字面量 | 已冻结的 `2026/7/21` | **外科式**替换为 `<DATE>`（严禁 `vitest -u`，理由见下） |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `src/panoramic/community/graph-report-generator.ts` | L49 | `new Date().toISOString().split('T')[0]` → `2026-07-22` 裸日期，同属"非 ISO 完整形态的活日期" | **安全（当前）**：community graph report 不在本 payload 内（快照中 `YYYY-MM-DD` 形态匹配数 = 0）。若未来被纳入冻结会重演同一根因 —— 记录为已知风险，本次**不改生产代码** |
| `src/batch/budget-gate.ts` | L147 / L163 | `generatedAt: new Date().toISOString()` | **安全**：完整 ISO 形态，已被既有 `<ISO-TS>` 规则覆盖。场景9 的 dry-run 报告纳入了快照，正因这条规则才未爆 |
| `tests/unit/graph/__snapshots__/graph-builder-bytestable.test.ts.snap` | L9 / L156 | `"generatedAt": "1970-01-01T00:00:00.000Z"` | **安全**：写盘期 `stripTimestamps` 固定 epoch，非活日期 |
| `tests/integration/__snapshots__/graph-mcp-snapshot.test.ts.snap` | 全文 | 日期字面量扫描 | **安全**：斜杠/短横日期形态匹配数均为 0 |

### 同步更新清单

- 调用方：无（`scrubRuntimeNoise` 为该测试文件私有 helper，无外部消费者）
- 测试：新增"任意系统日期下不变"的时间旅行验证（见修复策略方案 A 第 3 步）
- 文档：测试文件头部注释需说明新增的日期清洗规则与本次快照编辑的边界
- 生产代码：**不改**（`batch-readme-generator.ts` 的本地化日期是既有产品行为，非缺陷；改它属于未要求的行为变更）

## 方案证伪：冻结时钟路径不可行（关键发现）

用户给的三个候选方向里，「测试内冻结时钟（`vi.useFakeTimers` / `vi.setSystemTime`）」经证据检验**应当排除**：

- `src/batch/stages/artifact-reporting.ts:54` 用 `batch-summary-${Date.now()}.md` 命名产物
- 场景6 / 场景7 / 场景8 各跑**两轮** batch，快照因此冻结了**两条** `batch-summary-<TS>.md` 条目
  （`.snap` L2106+L2107、L2660+L2661、L3231+L3232）
- 一旦 `Date.now()` 被冻死，两轮产出**同名**文件 → 后轮覆盖前轮 → artifacts 清单从 2 条塌成 1 条
  → 反而制造**新的**快照失配，且是把真实调度行为一起改掉的"假修复"

同理，`batch-orchestrator.ts:534` 的 `batchId: \`batch-${Date.now()}\`` 也依赖时钟单调推进。

结论：冻结时钟会污染被测对象的可观测行为，与特征化测试"只冻结、不改变行为"的定位冲突。

## 修复策略

### 方案 A（推荐）：扩展噪声清洗 + 外科式快照替换

1. **测试侧**：在 `scrubRuntimeNoise` 的时间类规则中补一条本地化日期规则，
   把 `YYYY/M/D` 形态归一为 `<DATE>`，与既有 `<SHA>` / `<ISO-TS>` / `<MS>` / `<SEC>` / `batch-<TS>` 同一套结构化清洗风格。
2. **快照侧**：对 `.snap` 只做**定点**替换 —— 9 处 `2026/7/21` → `<DATE>`，
   **严禁 `vitest -u`**。理由：整体重录会把任何其它潜在漂移一并静默吸收；定点替换后测试若仍全绿，
   这份"全绿"本身就是"除日期外零漂移"的证据（与已聚合的 diff 证据互为交叉验证）。
3. **回归防线**：新增一条时间旅行验证，证明清洗结果对系统日期不敏感
   （对同一段含不同日期的文本执行清洗，断言输出恒等），把 Why 5 暴露的"无时间不变性验证"缺口补上。

**为何不是"生产代码改用固定格式"**：README 的本地化日期是面向用户的既有产品行为，与本 bug 无因果关系；
改产品输出去迁就测试属于本末倒置，且违反"不自行添加未要求的改动"。

### 方案 B（备选）：readme 降级为形状/hash 断言

把 `reportingArtifacts().readme` 从全文冻结改为 hash 或形状匹配。

**否决理由**：直接销毁 Codex G 审查 C2 明确要求的能力 —— README 全文冻结正是为了让 B7 搬迁的
"空文件化 / 参数断线（`moduleSpecs: []`）"现形。为躲一个日期而废掉整条内容合同，代价与收益严重失衡。

## Spec 影响

- 需要更新的 spec：**无需更新**。
  本次改动全部落在测试守护层（清洗规则 + 快照字面量），不触及任何产品行为面、公共 API 或生成产物合同；
  `src/**` 生产代码零改动。

## 备注：分支策略

本次在当前 worktree 分支 `claude/zen-aryabhata-95e0dc`（已 rebase 至 `origin/master` = `23ffc8f`）上作业，
不额外 `git checkout -b`：worktree 本身已提供隔离，交付路径同为 `git push origin HEAD:master` 的 ff 推送
（见 `docs/shared/agent-branch-sync-policy.md` 与 worktree 交付约定），额外切分支不增加隔离收益、反而制造
harness 分支错配风险。
