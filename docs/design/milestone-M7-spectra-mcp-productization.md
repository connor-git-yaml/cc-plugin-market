---
title: Milestone M7 — Spectra MCP 产品化 + 业界横向对比
status: planning (user decision 1.A confirmed — 完整 M7 scope)
created: 2026-05-25
estimated_weeks: 5-6
features_planned: F170a / F170c / F171 / F174 / F175 / F176
scope_decision: complete (vs minimal / extended) — 用户 confirmed 2026-05-25
amendment_2026-05-30: 新增 F170b（闭合 F170a CRITICAL：npm publish 4.2.0 未执行 + namespace guard + E2E 修复）+ F170d（已 ship，SC-002 8/10）；详见 M7-execution-blueprint.md
execution_blueprint: M7-execution-blueprint.md (workflow wf_00c688f4-3b9 产出)
stepback_revision: M7-stepback-revision.md (workflow wf_3b106574-ce7；用户拍板新增 F177-F180 + F176 6 处报告增强 + M8 旗舰 AST-anchored drift detection)
amendment_2026-06: F170-175 全 ship；step-back review 后新增 current-M7 收尾 F177(统一MCP契约+telemetry)/F178(纯函数去重)/F179(byte-stable+eval一致性)/F180(E2E协同补口)，执行顺序 F177→F178→F179→F180→F176
amendment_2026-06-07: F177/F178 已 ship（0 critical 落地）；第二轮 step-back（ship 后增量审查）→ F180 scope 扩为系统性 stdio E2E 补齐（3 项→~12 项）+ 新增 F181(import-resolver 单一权威收口)；执行顺序更新为 F179→F181→F180→F176
stepback_revision_2: M7-stepback-revision-2.md (workflow wf_ae80ea1c-3ec；F180 扩 scope + F181 新增 + F176 报告锚点 + M8 旗舰 prior art 三选)
related_design_doc: spectra-mcp-evolution.md
verification_principle: TDD + E2E per feature
gate: 每个 feature 必须有 E2E 用例验证用户场景才算 ship
---

# Milestone M7 — Spectra MCP 产品化 + 业界横向对比

## 0. Milestone 目标

承接 Stage 7b（F158-F169）已验证的 **C/A = 1.66× directional lift signal**，本 Milestone 解决 3 类问题：

1. **🚨 阻塞性 Bug** — Spectra MCP + Spec Driver "开箱即用" 真实环境 broken（namespace mismatch + npm 发布滞后 + 缺协同文档）
2. **⚡ 能力改进** — MCP 接口质量低于业界（tool description 弱 / response 缺 next-step / 缺 SWE-Bench scaffolding 类工具）
3. **🎯 易用性 + 性能** — batch 30 min 远低于业界 < 1min；symbol ID 严格匹配难用

**最终交付**：业界 SWE-Bench Verified 横向对比报告，对标 baseline Claude Code / Spec Driver / Spec Driver + Spectra MCP / SuperPowers / GStack。

---

## 1. Milestone 验收标准

| SC | 描述 | 验证手段 |
|----|------|---------|
| **M7-SC-001** | 所有 5 个 feature 全部 ship 到 master | git log + repo:check 全 pass |
| **M7-SC-002** | 每个 feature 都有专属 E2E 用例（不仅是 unit test） | tests/e2e/ 或 tests/integration/feature-17x.test.ts |
| **M7-SC-003** | 每个 feature 都覆盖**至少 1 个真实用户场景** | 用例命名格式 `用户故事: <场景> → <预期行为>` |
| **M7-SC-004** | Bug 类全修（namespace / npm 发布 / 缺协同 docs / tool description / response format） | F170a + F170c verify report |
| **M7-SC-005** | F176 SWE-Bench Verified 横向对比报告发布 | specs/176-... + PUBLISH-REPORT-M7.md |
| **M7-SC-006** | F176 测得 spec-driver-spectra cohort（修复后产品形态）vs baseline Claude Code 在 SWE-Bench Verified 上的 lift directional ≥ 1.5× | 实测 + verify-feature-176.mjs |
| **M7-SC-007** | TDD: 每个 feature 实施前必须先写 failing test，后写实现 | Phase 顺序检查（plan.md "TDD red phase" → "TDD green phase"）|

---

## 2. Feature 依赖图

```
F170a (修阻塞 Bug)  ← 必须先做，所有后续依赖
  │
  ├─→ F170c (Tool description + Response 优化)   ← MCP 调用率提升
  │     │
  │     ├─→ F171 (File navigation + Symbol fuzzy match)
  │     │     │
  │     │     └─→ F175 (batch incremental wrapper, 性能优化)
  │     │           │
  │     │           └─→ F176 (SWE-Bench Verified 5-cohort 横向对比 + 最终报告)
  │     │
  │     └─→ F174 (Symbol ID fuzzy match)
  │           │
  │           └─→ (汇入 F176)
  │
  └─→ ... 平行支线（如果有 owner 能力允许并行）
```

**关键路径**：F170a → F170c → F171 → F176（其他 feature 可在主路径上做并行优化）。

---

## 3. Feature 详细规划（含 TDD + E2E 要求）

### Feature 170a — 修复 Spectra + Spec Driver 协同部署（阻塞 Bug）

**预算**：~1 周 + ~$5 verify smoke
**Mode**: spec-driver-fix（4 阶段）

#### 3 个 Phase

##### Phase 1: NPM 发布同步（修 Gap 1）

- bump `spectra-cli` 到 `4.2.0`（含 Feature 155-169 全部代码）
- `npm publish` 更新 npm registry
- 更新 plugin marketplace（用户下次 `claude plugin update spectra` 自动拉新版）

##### Phase 2: Namespace 修复（修 Gap 2）

**决策**（用户 2026-05-27 修正 confirmed）：选 🅰️ **修 spec-driver sub-agent frontmatter**

⚠️ **决策修订记录**：2026-05-25 初版选 🅲，2026-05-27 用户重审用户体验后修正为 🅰，理由如下：

1. **用户体验关键差异**：
   - 🅰：用户 **2 步** 真·开箱即用（install plugin + 跑 spec-driver 直接 work）
   - 🅲：用户首次需 **5-6 步含 1 次重启**（install + 跑 → 提示 → Y → 生成 → 重启 → 再跑）

2. **eval 链路不受影响**（修正之前误判）：
   - F162-F169 eval cohort C (mcp-pull) 是 **driver 顶层** 调用 MCP（`scripts/eval-mcp-augmented.mjs::buildGroupCPrompt` 给 driver prompt 直接说 `mcp__spectra__*`）
   - **不走** spec-driver sub-agent
   - 改 sub-agent frontmatter 完全不影响 cohort C
   - F176 新 cohort 3 (`spec-driver-spectra-mcp`) 测产品真实部署形态，本就该用 plugin namespace

3. **Cohort 路径职责清晰**：

   | 路径 | namespace | 谁用 |
   |------|-----------|------|
   | Driver 顶层调用 | `mcp__spectra__*` (临时 .mcp.json 注入) | F162-169 eval cohort C |
   | Sub-agent 调用 | `mcp__plugin_spectra_spectra__*` (plugin namespace) | 产品 spec-driver workflow + F176 cohort 3 |

   两套不需要 namespace 一致，用途不同。

4. **🅱️ Anthropic 长期方向不变**：M7 内提 RFC 推动 plugin namespace control，未来 ship 后可简化（不阻塞 M7）。

实施细节：

1. **修改 5 个 spec-driver agent frontmatter**：
   ```diff
   # plan.md / implement.md / verify.md / spec-review.md / quality-review.md
   - tools: [Read, ..., mcp__spectra__context, mcp__spectra__impact]
   + tools: [Read, ..., mcp__plugin_spectra_spectra__context, mcp__plugin_spectra_spectra__impact]
   ```

2. **agent 文件清单**（具体改动列表）：

   | Agent 文件 | 原工具 | 新工具 |
   |-----------|--------|--------|
   | `plan.md` | `mcp__spectra__context`, `mcp__spectra__impact` | `mcp__plugin_spectra_spectra__context`, `mcp__plugin_spectra_spectra__impact` |
   | `implement.md` | `mcp__spectra__context`, `mcp__spectra__impact` | 同上 |
   | `verify.md` | `mcp__spectra__detect_changes`, `mcp__spectra__impact` | `mcp__plugin_spectra_spectra__detect_changes`, `mcp__plugin_spectra_spectra__impact` |
   | `spec-review.md` | `mcp__spectra__impact`, `mcp__spectra__context` | `mcp__plugin_spectra_spectra__impact`, `mcp__plugin_spectra_spectra__context` |
   | `quality-review.md` | 同上 | 同上 |

3. **bump spec-driver plugin 版本到 4.2.0**（与 spectra-cli 4.2.0 同步），让用户 `claude plugin update spec-driver` 拉到新 frontmatter。

4. **README 文档化（与 Phase 3 合并）**：明确说明 spec-driver sub-agent 依赖官方 spectra plugin（`plugin_spectra_spectra` namespace）；fork 用户需自改 frontmatter（合理 trade-off）。

5. **Fork 用户应急方案**：plugins/spec-driver/docs/customization.md 提供 frontmatter override 指引（让 fork 用户改成自己的 plugin namespace）。

6. **长期 follow-up**（不在 M7 范围）：
   - 向 Anthropic 提 RFC 要求 plugin.json 支持 `namespaceStrategy: "none"`
   - 一旦 ship，spec-driver sub-agent frontmatter 可改回简洁的 `mcp__spectra__*`

##### Phase 3: 文档化

- 加 README 说明 Spec Driver + Spectra MCP 协同部署
- 加 spec-driver-doc 模板提供 `.mcp.json` 配置

#### E2E 测试（必须覆盖）

```yaml
e2e_test_file: tests/e2e/feature-170a-spectra-spec-driver-integration.test.ts
test_scenarios:
  - name: "用户故事: 装两个 plugin 后 spec-driver 子代理能调到 mcp__spectra__context"
    steps:
      1. 模拟 npm registry 有新版 spectra-cli 4.2.0
      2. 安装 plugin 后启动 Claude Code session（模拟，或实测）
      3. 启动 spec-driver-fix workflow
      4. 调度 implement subagent
      5. assert: subagent 工具列表含 mcp__spectra__context（或选项 A 的 mcp__plugin_...）
      6. assert: subagent 真实调用 mcp__spectra__context 返回 success（非 tool-not-available）
    success_criteria: subagent 真实调用工具成功 = TRUE
    fallback: 若手动 e2e 在 host 跑，记录 verify-report.md 章节
  - name: "用户故事: spectra binary 4.2.0 暴露 agent-context tools"
    steps:
      1. npm install -g spectra-cli@4.2.0 (模拟或实测)
      2. spectra mcp-server (后台启动)
      3. MCP client 连接，调 tools/list
      4. assert: 工具列表含 impact / context / detect_changes
    success_criteria: 3 个工具暴露 = TRUE
```

#### TDD 顺序

1. 先写 E2E test（fails，因为没修复 ← red phase）
2. 实现修复（npm bump + namespace fix）
3. E2E test 通过（green phase）
4. Codex 阶段性对抗审查
5. push origin master

---

### Feature 170c — Tool description + Response 优化（接口质量改进）

**预算**：~1 周 + ~$2 verify
**Mode**: spec-driver-story（5 阶段）

#### 改动范围

修改 `src/mcp/agent-context-tools.ts` 的 3 个工具：

```typescript
// 改进前
server.tool('impact', '查询 symbol 改动的 blast radius ...', ImpactInputSchema, ...)

// 改进后（参考 Anthropic 推荐 100-300 字 + when-to-use + example）
server.tool('impact',
  `查询 symbol 改动的 blast radius — 反向 / 正向 BFS 遍历调用链，返回受影响 symbols。

  **使用时机（Use this tool when）**:
  - 即将修改某个 symbol，需要评估改动对哪些 caller 有影响
  - 重构前评估安全边界（depth=3-5 看 transitive 影响）
  - 决定 PR review 范围（先查 impact 再分模块 review）

  **典型调用链**:
  - 修代码前: detect_changes(diff) → 取 changedSymbols[0] → impact(target)
  - 评估测试覆盖: impact(target, direction=upstream) 看 test caller

  **Example**:
  Input: { target: "engine.py::Value.__add__", depth: 2 }
  Output: { affected: [..], summary: { directCallers: 5, riskTier: "medium" }, nextStepHint: "..." }`,
  ImpactInputSchema,
  ...
)
```

3 个工具同步加 ranking + next-step hint to response：

```typescript
interface ImpactResponse {
  // 既有字段保留
  affected: AffectedSymbol[];
  summary: { directCallers, transitive, riskTier };

  // 新增字段（M7 增强）
  topImpacted: TopImpactedItem[];  // 前 3-5 个 score 排序
  nextStepHint: string;             // "建议接下来调 context for {top.id}"
}
```

#### E2E 测试

```yaml
e2e_test_file: tests/e2e/feature-170c-mcp-driver-call-rate.test.ts
test_scenarios:
  - name: "用户故事: driver 看到改进后 description 主动调 impact ≥ 50% (vs F167 ~0%)"
    steps:
      1. 起 spectra MCP server 子进程
      2. spawn claude --print + mcp-config + 给一个 "需要查 caller" 的任务 prompt
      3. 收集 stream-json output 解析 mcp_tool_use 事件
      4. 跑 N=5 task × N=2 repeat = 10 runs
      5. assert: ≥ 5/10 runs 主动调用了 mcp__spectra__impact (without prompt force)
    success_criteria: impact 主动调用率 ≥ 50%
    baseline_reference: F167 实测 ~0% 主动调用率

  - name: "用户故事: detect_changes response 含 nextStepHint，driver chain 调用 context"
    steps:
      1. 跑 1 个真实 SWE-Bench-Lite cohort C run
      2. 解析 stream-json mcp call sequence
      3. assert: detect_changes 后 driver 调 context (≥ 1 次 chained)
    success_criteria: chained call rate ≥ 30%
    baseline_reference: F165 6/9 chained (~67%)

  - name: "用户故事: impact response 含 topImpacted ranking"
    steps:
      1. 直接调 handleImpact 单测
      2. 模拟大型 graph (n=50+ callers)
      3. assert: response.topImpacted.length ≤ 5
      4. assert: topImpacted[0].score 是最高
    success_criteria: ranking 正确
```

#### TDD 顺序

1. 先写 E2E test（验证 driver 主动调用率 ≥ 50%）—— fails
2. 改 tool description（添 Use when / examples）
3. 改 response format（加 topImpacted / nextStepHint）
4. E2E 再跑 → pass
5. Codex 阶段性对抗审查

---

### Feature 171 — File Navigation Tools（SWE-Bench scaffolding 补齐）

**预算**：~1 周 + ~$2 verify
**Mode**: spec-driver-feature（完整 5 阶段）

#### 新增工具

3 个新 MCP tools（参考 OpenHands / SWE-Agent 设计）：

```typescript
server.tool('view_file',
  `查看文件内容指定 line range（避免完整 Read 撑爆 context）。

  Use when:
  - impact / detect_changes 返回某个 symbol 后，想看其源码定义
  - 跑大文件时按段 view
  - mock 实现前先看 symbol 周围 code style

  Example: view_file({ path: "src/auth.ts", startLine: 100, endLine: 150 })`,
  ViewFileSchema, ...);

server.tool('search_in_file', ...)   // 文件内 pattern search
server.tool('list_directory', ...)   // 替代 ls
```

#### E2E 测试

```yaml
e2e_test_file: tests/e2e/feature-171-file-navigation.test.ts
test_scenarios:
  - name: "用户故事: driver 用 view_file 替代 Read 全文，token 减少 ≥ 50%"
    steps:
      1. 跑 2 个 SWE-Bench-Lite task：1 个用 cohort C (无 view_file)，1 个用 cohort C + view_file
      2. 解析 stream-json 计算 inputTokens
      3. assert: 含 view_file cohort 平均 inputTokens ≤ 50% of 无 view_file
    success_criteria: token 减少 ≥ 50%
    baseline_reference: F167 SC-005 单 run inputTokens

  - name: "用户故事: cohort C 加 file navigation 后 pass rate 提升 ≥ 5pp"
    steps:
      1. 跑 SWE-L003 (已知 cohort C 100% pass) + L004 (cohort C 33%)
      2. cohort C+nav × N=3 vs cohort C × N=3 对比
    success_criteria: pass rate delta ≥ 5pp
    baseline_reference: F169 cohort C 数据
```

---

### Feature 174 — Symbol ID Fuzzy Match

**预算**：~3-5 天 + ~$1 verify
**Mode**: spec-driver-story

#### 改动范围

修改 `mcp__spectra__context` 和 `mcp__spectra__impact` 的 symbolId 解析逻辑：

```typescript
// 改进前: 严格匹配 "file.py::Class.method"
function resolveSymbol(id: string): SymbolNode | null { ... }

// 改进后: fuzzy match (Levenshtein + path 后缀匹配)
function resolveSymbolFuzzy(query: string): SymbolNode[] {
  // 1. 严格匹配（保留兼容）
  // 2. 模糊路径匹配 (engine.py::Value.relu vs Value.relu)
  // 3. 部分名匹配 (Value.relu vs relu)
  // 4. 返回 top-3 候选 + 置信度
}
```

#### E2E 测试

```yaml
e2e_test_file: tests/e2e/feature-174-symbol-fuzzy-match.test.ts
test_scenarios:
  - name: "用户故事: driver 写错 symbol path (相对 vs 绝对) 仍能 resolve"
    inputs:
      - "Value.__add__"         (no path)
      - "engine.py::Value"       (no method)
      - "/abs/path/engine.py::Value.__add__"  (absolute)
      - "egnine.py::Value"       (typo)
    assertions:
      - "Value.__add__" → resolves to 1 candidate ≥ 0.9 confidence
      - 4 inputs 中 ≥ 3 resolve to expected symbol
    success_criteria: 12/15 (80%) 模糊查询正确 resolve

  - name: "用户故事: F165 cohort C detect_changes 返回 symbol id 后 driver 调 context 不再 'symbol-not-found'"
    baseline_reference: F165 1/9 runs 'symbol-not-found' error
    steps:
      1. 跑 F165 9 runs rerun (with fuzzy match)
      2. assert: 'symbol-not-found' 错误率 0/9
```

---

### Feature 175 — Batch Incremental Wrapper（性能优化）

**预算**：~1 周 + ~$2 verify
**Mode**: spec-driver-feature

#### 改动范围

把 Feature 156 已 ship 的 incremental indexing 接入 batch CLI tool：

```typescript
// 改进前: spectra batch 全量跑（30 min self-dogfood）
spectra.batch({ target, mode: 'full' })

// 改进后: 默认 incremental，仅 changed file 重 index
spectra.batch({ target, mode: 'incremental' })  // F156 incremental
spectra.batch({ target, mode: 'full' })          // 显式 full 时才全量
```

#### E2E 测试

```yaml
e2e_test_file: tests/e2e/feature-175-batch-incremental.test.ts
test_scenarios:
  - name: "用户故事: 改 1 个文件后 batch 增量更新 < 5 min (vs full 30 min)"
    steps:
      1. 先跑 full batch (30 min, 建立 baseline)
      2. 修改 1 个 src/ 文件（小改动）
      3. 跑 incremental batch
      4. assert: wall < 5 min
      5. assert: graph nodes/links 与 full 模式 byte-diff ≤ 10 nodes
    success_criteria: wall ≤ 5 min + 数据一致性

  - name: "用户故事: 无改动 incremental 跑批 < 30 sec (cache hit)"
    success_criteria: cache hit 模式 wall < 30 sec
```

---

### Feature 176 — SWE-Bench Verified Workflow 横向对比（最终交付）

**预算**：~1-2 周 + ~$30-50 实付（jury cost）+ 配额管理
**Mode**: spec-driver-feature

#### 实验设计

| Cohort | 配置 | 修复后产品形态 |
|--------|------|--------------|
| 1. `baseline-claude` | 裸 Claude Code（model=opus-4-7）| 既有 |
| 2. `spec-driver` | + Spec Driver workflow（plugin 4.1.0+）| F162 Phase 0 修复后 |
| 3. **`spec-driver-spectra-mcp`** | + Spec Driver + Spectra MCP（F170a 修复后真实开箱即用）| **F170a + F170c 修复后** |
| 4. `SuperPowers` | + SuperPowers framework | 既有 |
| 5. `GStack` | + GStack 23 skills | 既有 |

**数据集**：SWE-Bench Verified 子集（10 task，从 Anthropic 公布数字范围内取，确保可解性）
- 复用 SWE-Bench-Lite 设施（worktree / oracle / judge jury）但**数据集换 Verified**

**Sample size**: 5 cohort × 10 task × N=3 = 150 runs

**Driver / Judge**:
- driver: claude-opus-4-7（保持与 Stage 7b 一致）
- judge: claude-opus-4-7 + GLM + Kimi（3 judge majority）

#### E2E 测试（整个 Feature 即 E2E）

```yaml
e2e_test_file: tests/e2e/feature-176-swe-bench-verified-cross-cohort.test.ts
test_scenarios:
  - name: "用户故事: 跑 1 cohort × 1 task × N=1 smoke 全 5 cohort 都能 finalize"
    steps:
      1. 装 spectra plugin 4.2.0 + spec-driver 4.1.0 + 准备 SuperPowers / GStack wrapper
      2. 跑 5 cohort × 1 task × N=1 = 5 runs
      3. assert: 5/5 runs finalize (status='success', not 'broken')
      4. assert: cohort 3 (spec-driver-spectra-mcp) mcpToolCallCount > 0（确认 F170a 修复生效）
    success_criteria: 5/5 success + mcp 调用正常

  - name: "用户故事: F170c response next-step hint 让 cohort 3 比 cohort 2 多调 ≥ 1 chained mcp call (per task)"
    steps:
      1. 跑全量 150 runs (5 cohort × 10 task × N=3)
      2. 解析 cohort 2 vs cohort 3 的 mcp call sequence
      3. cohort 3 平均 mcp call count > cohort 2 (cohort 2 应该 0)
    success_criteria: cohort 3 平均 mcp_tool_calls ≥ 2/task

  - name: "用户故事: cohort 3 (spec-driver-spectra-mcp) vs cohort 1 (baseline) 在 Verified 上 directional lift ≥ 1.5×"
    steps:
      1. 计算 aggregate pass rate per cohort
      2. lift = cohort3.passRate / cohort1.passRate
      3. assert: lift ≥ 1.5
    success_criteria: lift ≥ 1.5×
    falsification_path: 若 lift < 1.5×，§10.6 写"M7 修复后 Spectra MCP 在 Verified 上 lift 不足 1.5×，需重新评估产品定位"

  - name: "用户故事: spec-driver-spectra-mcp 是否超越 SuperPowers / GStack"
    steps:
      1. cohort 3 aggregate vs cohort 4 / 5 aggregate
      2. 单独跑 fixture-level fixture-by-fixture 对比
    success_criteria: cohort 3 ≥ cohort 4 在 aggregate 上 (允许 fixture-level 互有胜负)
```

#### 最终交付

- `specs/176-swe-bench-verified-cross-cohort/` (完整 spec + verification)
- 更新 `specs/147-competitor-evaluation-platform/PUBLISH-REPORT.md` §11 增加 M7 章节
- 新建 `specs/147-.../PUBLISH-REPORT-M7.md` (M7 publish-grade 摘要)

---

## 4. TDD 流程约束（每个 Feature 必须遵守）

### TDD Red Phase (前置)

每个 Feature 启动后**第一个 commit** 必须是：

```
test(17x): E2E test scaffolding — RED phase (tests fail as expected)
```

包含：
- E2E test file 框架（用 vitest describe / it 写 skeleton）
- 所有 it block 标 `it.todo` 或写 expected-fail assertion
- 跑 `npx vitest run tests/e2e/feature-17x*` 应该全 fail（红）

### TDD Green Phase (核心)

实施 commit 后：

```
feat(17x): implement core logic — GREEN phase (E2E tests now pass)
```

要求：
- E2E test 全 pass
- 同时新增的 unit test 也全 pass
- 覆盖率 ≥ 95% per-file (沿用 Feature 150 约定)

### Refactor Phase (清理)

实施 + 测试通过后：

```
refactor(17x): clean up implementation while keeping tests green
```

可选，但鼓励做（清除 magic number / 抽函数 / 命名优化）。

---

## 5. E2E 用例设计原则（每个 Feature 必含）

### E2E vs Unit Test 区分

| 类型 | 范围 | 工具 | 何时用 |
|------|------|------|--------|
| Unit | 单函数 / 单 handler | vitest + mock | 内部逻辑验证 |
| Integration | 多模块协同 | vitest + 真实模块 | 模块组合验证 |
| **E2E (M7 强制)** | **真实用户场景全链路** | **vitest + 真实 LLM 调用 / 子进程** | **每个 Feature 必须有 ≥ 1 个** |

### E2E 用例命名格式（必须遵守）

```
用户故事: <谁> <做了什么> → <预期行为>

例:
- "用户故事: 装两个 plugin 后 spec-driver 子代理能调到 mcp__spectra__context"
- "用户故事: driver 看到改进后 description 主动调 impact ≥ 50%"
- "用户故事: 改 1 个文件后 batch 增量更新 < 5 min"
```

### E2E 数据来源（**真实场景**优先）

- 优先：真实 Claude Code 子进程跑批
- 其次：使用 Stage 7b 已捕获的 stream-json fixture（F167 / F169）
- 最后：合成 mock data（仅在前两者成本高时回退）

### E2E 跨 Feature 复用

- M7 SWE-Bench-Lite fixture（F158-F169）可复用
- M7 新 fixtures 加入 `tests/baseline/m7-fixtures/`
- 每个 Feature E2E 跑批数据写入 `specs/17x-*/verification/e2e-results.json`

---

## 6. Bug 类问题映射

| Bug ID | Feature | 描述 | E2E 验收 |
|--------|---------|------|---------|
| **Bug-1** Gap 1 npm 发布滞后 | F170a Phase 1 | spectra-cli@4.1.1 不含 Feature 155 | E2E: spectra binary 4.2.0 暴露 impact/context/detect_changes |
| **Bug-2** Gap 2 namespace mismatch | F170a Phase 2 | `mcp__spectra__*` vs `mcp__plugin_spectra_spectra__*` — 🅰 修 sub-agent frontmatter 对齐 plugin namespace | E2E: 装两个 plugin **零额外配置**，subagent 真实调用 success（2 步开箱即用）|
| **Bug-3** Gap 3 缺协同文档 | F170a Phase 3 | 用户不知道怎么 wire | docs review + smoke test |
| **Bug-4** Tool description 弱 | F170c | driver 不知道何时调 impact | E2E: 主动调用率 ≥ 50% |
| **Bug-5** Response 缺 next-step | F170c | driver chain 调用率低 | E2E: detect_changes → context chain rate ≥ 30% |
| **Bug-6** Symbol ID 严格匹配 | F174 | driver 写错 ID → 'symbol-not-found' | E2E: fuzzy match 80% 准确 |
| **Bug-7** batch 30 min 慢 | F175 | UX 差 | E2E: incremental 5 min |
| **Bug-8** 缺 file navigation | F171 | SWE-Bench scaffolding gap | E2E: token 减少 50% |

---

## 7. 时间线（含并行机会）

```
Week 1     F170a (修阻塞 Bug)                            [关键路径,串行]
Week 2     F170c (Tool desc + Response 优化)              [关键路径,串行]
Week 3     F171 (File nav)       ┐  F174 (Fuzzy match)    [可并行]
Week 4     F175 (batch incr)     ┘
Week 5-6   F176 (SWE-Bench Verified 横向对比 + Report)    [关键路径,串行]

合计: 5-6 周 + ~$50 实付 + ChatGPT Pro 配额 ~30-50% weekly
```

### 并行机会

- F171 / F174 可并行（写入路径不同：file nav vs symbol resolver）
- F175 不依赖 F171/F174（写入 batch wrapper，独立）

---

## 8. 资源估算

| Feature | 工程 (天) | LLM 实付 | 配额 |
|---------|---------:|---------:|------|
| F170a | 5 | ~$5 | 低 |
| F170c | 5 | ~$2 | 低 |
| F171 | 5 | ~$2 | 低 |
| F174 | 3 | ~$1 | 低 |
| F175 | 5 | ~$2 | 低 |
| F176 | 10 | **~$30-50** | **30-50% weekly** |
| **合计** | **~33 天** | **~$42-62** | **集中在 F176** |

---

## 9. 最终交付物

### 9.1 代码层
- 修复 npm spectra-cli@4.2.0 发布
- spec-driver agent frontmatter / spectra .mcp.json namespace 修复
- 3 个 agent-context tools 升级（description + response）
- 3+ 新 navigation / fuzzy tools
- batch incremental wrapper

### 9.2 测试层
- 每 Feature ≥ 1 个 E2E test file
- 每个 E2E 用例覆盖 1+ 用户场景
- 6 个 Feature × 2-4 E2E case = ~15-20 E2E 用例
- 现有单测继续 pass

### 9.3 文档 / 报告层
- 6 个 specs/17x-* 完整 spec + plan + tasks + verification
- 更新 `competitive-evaluation-report.md` §11 (M7 章节)
- 新建 `PUBLISH-REPORT-M7.md` (M7 publish-grade 摘要)
- 更新本 milestone 文档（M7 完成后改 status: shipped）

### 9.4 业界对比层（最终目标）
- 5 cohort 在 SWE-Bench Verified 横向对比数据
- 与 Anthropic / OpenAI 公布 Verified 数字直接可比的 baseline
- spec-driver-spectra-mcp vs SuperPowers vs GStack 横向 ranking
- C lift signal 修复后量化（目标 ≥ 1.5×）

---

## 10. 启动 Checklist

启动 M7 前必须确认：

- [ ] master HEAD ≥ 2e0f2d2（F169 ship）+ aeea81a（凭据策略文档）
- [ ] PUBLISH-REPORT.md 已 ship（M6 收尾）
- [ ] vitest 3708+ passing baseline
- [ ] npm registry / claude plugin marketplace 写访问权确认（F170a 需要 publish）
- [ ] ChatGPT Pro / Claude Max 订阅配额 ≥ 50% weekly（F176 需要）
- [ ] SuperPowers / GStack 启动 wrapper 设计文档（F176 准备）
- [ ] SWE-Bench Verified 子集选定 10 task（F176 准备）

---

## 11. 风险与权衡

| 风险 | 影响 | 缓解 |
|------|------|------|
| F170a Phase 2 namespace 修复方案选 🅰️ 后维护成本高 | spec-driver agent 分两套 namespace | 选 🅲️（项目级 .mcp.json + docs）作为统一方案 |
| F170c tool description 改进无效（driver 仍不主动调 impact）| F176 cohort 3 lift 不达 1.5× | 提前 pilot 1 task × 5 cohort 试水 |
| F176 SWE-Bench Verified 不允许大量并发跑（rate limit）| F176 延期 1-2 周 | 分日跑批 + 配额监控 |
| SuperPowers / GStack wrapper 实现复杂 | F176 延期 | 接受降级：只测 cohort 1-3，4/5 留作 follow-up |
| F175 incremental wrapper 引入 stale cache bug | 用户产品级回归 | 严格 E2E: incremental output 与 full byte-stable |

---

## 12. 与已有 design doc 的关系

- 本 M7 是 `docs/design/spectra-mcp-evolution.md` 路线的**收尾里程碑**
- M7 之前：F140-F169 共 30 个 feature ship（基础建设 + bug 修 + 数据验证）
- M7 之后：F177+ 进入新方向（embedding semantic search / AST pattern match / cross-language refactor 等新能力 — 不在 M7 范围）

---

## 13. 一句话定位

> M7 = **修阻塞 Bug + 接口质量提升 + 业界横向对比报告**。每个 Feature TDD + E2E，最终用 SWE-Bench Verified 5-cohort 横向对比的硬数据，与 Cursor / Aider / Claude Code 公布的官方 Verified 数字平起平坐，证明 Spec Driver + Spectra MCP 在真实编码任务上的**产品级 lift signal**。
