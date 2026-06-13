# Verification Report: F196 MCP description Output 字段名防漂移守护

**特性分支**: `claude/elated-shockley-5115f0`
**验证日期**: 2026-06-13
**验证范围**: Layer 1 (Spec-Code 对齐) + Layer 1.5 (验证铁律合规) + Layer 1.75 (深度检查) + Layer 1.8 (残留扫描) + Layer 1.9 (文档一致性) + Layer 2 (原生工具链)
**验证者**: 验证闭环子代理（独立复跑）

---

## Layer 1: Spec-Code 对齐（FR 覆盖率）

fix 模式无传统 spec.md，FR 来源取自 fix-report.md 验收标准（6 条 AC）与 tasks.md（6 个 Task）。

### 功能需求对齐

| AC | 描述 | 状态 | 对应 Task | 证据 |
|----|------|------|----------|------|
| AC-1 | 新测试复现 F184 那 4 类漂移（D-01~D-04 各 flag 对应越界字段） | ✅ 已实现 | T005 | Suite 3 全部 4 个 it 独立通过（vitest 输出 16 passed） |
| AC-2 | 不引入脆弱"全字段列全"约束（子集 ⊆ 语义） | ✅ 已实现 | T004 | Suite 2 动态遍历，仅断言 extract(desc) ⊆ TRUTH；TRUTH 未枚举 BatchResult 全部 20+ 字段 |
| AC-3 | checker 跑当前真实 11 个 description 全绿（Suite 2 动态遍历） | ✅ 已实现 | T004 | Suite 2 单个 it 内循环 11 工具，全无越界字段，problems 数组为空 |
| AC-4 | 不误报合法嵌套（Suite 4 FP-01~FP-03） | ✅ 已实现 | T005 | Suite 4 全部 3 个 it 通过；嵌套数组 [{line,text}] 仅收顶层 matches |
| AC-5 | 现有 vitest + build + repo:check 零回归 | ✅ 已实现 | T006 | 见 Layer 2 命令输出（build exit 0，lint exit 0，repo:check exit 0）；全量 4358 passed / 0 failed（引用主编排器背景） |
| AC-6 | C2 known-gap 文档化 | ✅ 已实现 | T001 | 测试文件第 14-24 行 KNOWN SCOPE LIMITATION (C2) 注释块完整；plan.md §Known Gap 独立章节 |

### 覆盖率摘要

- **总 AC 数**: 6
- **已实现**: 6
- **未实现**: 0
- **部分实现**: 0
- **覆盖率**: 100%

---

## Layer 1.5: 验证铁律合规

**状态**: COMPLIANT（含补充独立复跑证据）

主编排器声明已跑 4358/0、build/lint/repo:check exit 0，属于有效验证（含具体命令 + 结果），非推测性表述。

本验证子代理独立复跑结果：

```
# 命令 1: 交付物自身（独立复跑）
$ npx vitest run tests/unit/mcp/description-output-drift.test.ts

 ✓ |unit| tests/unit/mcp/description-output-drift.test.ts (16 tests) 3ms

 Test Files  1 passed (1)
      Tests  16 passed (16)
   Start at  15:51:37
   Duration  872ms

# 命令 2: build（verification_policy 必需）
$ npm run build
> spectra-cli@4.2.0 prebuild
> tsx scripts/inline-d3.ts
[inline-d3] d3-force 3.0.0 内容无变化，跳过写入
> spectra-cli@4.2.0 build
> tsc
EXIT: 0

# 命令 3: lint（verification_policy 必需）
$ npm run lint
> spectra-cli@4.2.0 lint
> tsc --noEmit
EXIT: 0

# 命令 4: repo:check
$ npm run repo:check
（最后 20 行均为 pass，无 FAIL/ERROR）
EXIT: 0
```

- 缺失验证类型: 无
- 检测到的推测性表述: 无

---

## Layer 1.75: 深度检查

### a. 调用链完整性

检查路径：`createMcpServer()` → tool description 注册 → `vi.mock` mock 捕获 → `hoisted.captured` → `getOutputTools()` → `checkSubset()` → `extractOutputTopLevelKeys()`。

逐环确认：
- `createMcpServer()` 调用在 `beforeAll` 中，位于 mock 建立之后——顺序正确，不存在 mock 未生效就调用的时序问题
- `hoisted.captured` 在 `beforeAll` 入口 `.length = 0` 重置——Suite 2/5 的 `getOutputTools()` 调用在 `beforeAll` 之后执行（test body 内），不在 describe collection 期——注释（第 243-244 行）明确解释了为何不用 `it.each(getOutputTools())`
- `checkSubset` 找不到 TRUTH 条目时抛出 Error（第 189 行），不静默通过——防御性正确
- Suite 2 额外断言 `keys.length > 0`（第 258-261 行），防止 `Output:` 存在但 extractor 返回空集时 subset 恒真（vacuous pass 防御）

结论：调用链无断点，参数传递完整，无异常被吞。

### b. 数据持久化验证

本 fix 纯新增测试文件，无数据库写入，不适用。

### c. 配置贯穿验证

无新增配置项，不适用。

---

## Layer 1.8: 残留扫描

本次改动为**纯新增**（0 个文件被删除/重命名），无需残留扫描。

结论：RESIDUAL_FOUND = false，N/A。

---

## Layer 1.9: 文档一致性检查

本次改动为测试文件新增，不涉及架构级变更（无新增/删除模块、无修改公共接口）。

结论：DOC_DRIFT = false，N/A。

---

## Layer 1-extra: C1/C2 边界诚实性核查

这是 Codex 反复要求的诚实性红线，独立逐条核查。

### C1（producer-rename 闭合范围）

**声明**（plan.md + 测试文件第 124-133 行）：
- `diff` 工具：`Object.keys(DriftReportSchema.shape)` 运行时派生，producer 改名 → schema .shape 自动变 → subset 失败。这是唯一被 CI（`npx vitest run`）真正强制的 producer-rename 闭合。
- `prepare`/`batch`：`as const satisfies readonly (keyof T)[]` 是编译期断言，但根 tsconfig（`tsconfig.json` line 44: `"tests"` 在 exclude 中）不 type-check 本测试文件，故该守护在 CI 里**休眠**，仅 IDE/手动 tsc 时生效。测试文件注释明确标注"latent 防御 + 自文档化"。
- 8 个 cited 手写工具：only 可靠捕获 description 侧打错字，不可靠捕获 producer 侧改名。

核查结论：**声明诚实，无 over-claim**。tsconfig exclude 已独立确认（tsconfig.json line 41-50，`"tests"` 显式排除）。`satisfies` 守护确实在 CI 休眠，与声明一致。

### C2（嵌套 shape out-of-scope）

**声明**（测试文件第 14-24 行 KNOWN SCOPE LIMITATION 注释）：
- 本守护仅校验顶层字段名存在性
- 不校验嵌套字段名、值类型、字段顺序、可选性语义
- 绿灯通过 ≠ 合约完全安全

核查结论：**声明诚实，边界清晰**。Suite 4 FP-01/FP-02 明确测试了嵌套不被误判，但也反过来证明了嵌套 shape 正确性不在检查范围——`{ matches: [{line: "wrong_name"}] }` 中 `wrong_name` 不会被 flag。这是设计选择，有充分理由（避免脆弱过度抽象），且已文档化。

### 套路测试计数核查

tasks.md T006 操作 1 声明"Suite 1-5 共 26 个测试用例"。实际 vitest 输出 16 tests。差异分析：
- Suite 1：6 个 it（E-01~E-06）= 6
- Suite 2：1 个 it（动态遍历 11 工具，但 vitest 计为 1）= 1
- Suite 3：4 个 it（D-01~D-04）= 4
- Suite 4：3 个 it（FP-01~FP-03）= 3
- Suite 5：2 个 it（C-01~C-02）= 2
- **合计：16 个 it**

tasks.md 的"26 个测试用例"是误算——Suite 2 将 11 工具的遍历合并为 1 个 it（注释第 243 行说明原因），而非 11 个 `it.each`。这是实现层面的合理选择（技术原因见注释），而非测试覆盖缺失。**实际 16 tests 覆盖了所有 plan 要求的断言逻辑**，tasks.md 数字与实现不一致属轻微文档误差，不影响守护有效性。

---

## Layer 2: 原生工具链验证

### TypeScript / Node.js（npm）

**检测到**: `package.json` + `tsconfig.json`
**项目目录**: `/Users/connorlu/Desktop/.workspace2.nosync/cc-plugin-market/.claude/worktrees/elated-shockley-5115f0`

| 验证项 | 命令 | 状态 | 详情 |
|--------|------|------|------|
| Build | `npm run build` | ✅ PASS | tsc 零类型错误；EXIT 0；prebuild inline-d3 跳过（内容无变化） |
| Lint | `npm run lint` | ✅ PASS | `tsc --noEmit`；EXIT 0；零错误零警告 |
| Test（交付物） | `npx vitest run tests/unit/mcp/description-output-drift.test.ts` | ✅ 16/16 PASS | 1 test file passed；Duration 872ms；all 5 suites green |
| Test（仓库级） | `npx vitest run`（主编排器背景）| ✅ 4358/0 | 引用主编排器已跑结果；flaky init-e2e 已确认与本改动无关 |
| Repo Check | `npm run repo:check` | ✅ PASS | 全部 check 条目 pass；EXIT 0 |

---

## 6 条 AC 逐条证据表

| AC | 状态 | 直接证据 |
|----|------|---------|
| AC-1 D-01~D-04 漂移复现 | ✅ PASS | Suite 3 4 个 it：`expect(offending).toContain('skeleton')` / `'generated'` + `'graphPath'` / `'drifts'` + `'newBehaviors'` + `'staleItems'` / `'graph'` + `'overview'`；vitest 16 tests 全绿 |
| AC-2 子集 ⊆ 语义（不全字段）| ✅ PASS | TRUTH 中 batch 只列 4 个字段（BatchResult 有 20+）；Suite 2 使用 `extract(desc) ⊆ TRUTH` 而非等号断言 |
| AC-3 11 个工具当前全绿 | ✅ PASS | Suite 2 单 it 内循环 11 工具，`problems[]` 为空；Suite 5 C-01 确认动态发现工具数 > 0 且全在 TRUTH；C-02 确认 TRUTH 无 stale 条目 |
| AC-4 合法嵌套不误报 | ✅ PASS | FP-01 `matches:[{line,text,...}]` → checkSubset 返回 `[]`；FP-02 `lines:{a,b}` → `[]`；FP-03 真实 panoramic-query description（含尾随中文）→ `[]` |
| AC-5 零回归 | ✅ PASS | build exit 0；lint exit 0；repo:check exit 0；全量 4358/0（引用）；新增文件零源码改动 |
| AC-6 C2 文档化 | ✅ PASS | 测试文件第 14-24 行 KNOWN SCOPE LIMITATION (C2) 注释块；plan.md §Known Gap 独立章节；plan.md C1 残留（诚实收窄）章节 |

---

## Summary

### 总体结果

| 维度 | 状态 |
|------|------|
| FR 覆盖 | 100%（6/6 AC） |
| Build Status | ✅ PASS（exit 0） |
| Lint Status | ✅ PASS（exit 0） |
| Test Status（交付物）| ✅ 16/16 PASS |
| Test Status（仓库级）| ✅ 4358/0（引用主编排器；独立快检 16/16 佐证） |
| Repo Check | ✅ PASS（exit 0） |
| 验证铁律合规 | ✅ COMPLIANT |
| C1/C2 边界诚实性 | ✅ 无 over-claim（独立核查通过） |
| **Overall** | **✅ READY FOR REVIEW** |

### 发现（INFO 级别）

1. **tasks.md 测试用例数字误差（INFO）**: T006 操作 1 写"共 26 个测试用例"，实际 vitest 统计 16 个 it。原因是 Suite 2 将 11 工具遍历合并为 1 个 it（有技术原因，注释已说明）。不影响守护覆盖，属文档层面的轻微误差。无需修复。

### CRITICAL / WARNING 数

- CRITICAL：0
- WARNING：0
- INFO：1（tasks.md 测试数字轻微误差，不影响交付质量）

