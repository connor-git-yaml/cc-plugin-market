# Feature 153 — 验证报告

**Feature Branch**: `claude/nervous-herschel-832b94`
**Verification Run**: 2026-05-09 00:43 (本地时间)
**Spec**: [spec.md](../spec.md) (Codex 6 轮 review GATE_DESIGN PASS)
**Plan**: [plan.md](../plan.md) (Codex 3 轮 review GATE_TASKS PASS)
**Tasks**: [tasks.md](../tasks.md)

---

## 验收结果总览

| Success Criteria | 阈值 | 实测中位数 | 状态 |
|------------------|------|-----------|------|
| **SC-1** Go callSites 填充率（在 truth-with-calls 文件上） | ≥ 95% | **100.0%** (12/12) | ✅ PASS |
| **SC-2a** Go call edges precision（label-only） | ≥ 70% | **99.9%** | ✅ PASS |
| **SC-2b** Go call edges recall（label-only） | ≥ 30% | **89.3%** | ✅ PASS |
| **SC-3** 现有单测无回归 | 全量 PASS | **3175 passed** + 3 skipped + 20 todo | ✅ PASS |
| **SC-4** Build / lint 无报错 | 0 错误 | **0 errors** | ✅ PASS |
| **SC-5** verification-report 已交付 | 含实测数字 | （本文件）| ✅ PASS |

---

## 测试详情

### SC-1 — callSites 填充率

| 指标 | 数值 |
|------|------|
| Go 文件总数（GORM 顶层 scope，排除 `_test.go`） | 14 |
| Mapper 端有 callSites 的文件 | 12 |
| Truth 端有 calls 的文件 | 12 |
| **fillRate (over truth-with-calls)** | **100.0%** (12/12) ✅ |
| fillRate (over all .go) | 85.7% (12/14) — 含 type-only 文件 |
| 总 callSites 数 | 1496 |

**fillRate 分母选择说明**：

GORM 顶层包 14 个 .go 文件中，2 个是纯类型定义文件（`model.go` 仅定义 `gorm.Model` struct；`interfaces.go` 仅定义 Dialector / Plugin / ParamsFilter 等 interface，无任何 `call_expression`）。truth-set extractor 对这两个文件输出 0 truthCalls，mapper 也理应输出 0 callSites。

SC-1 spec 意图是"mapper 不应该漏抽"——分母用"truth 端有 calls 的文件数"才能反映这个意图。`fillRate = 100%` 表明 mapper 在所有 truth-with-calls 文件上都成功抽到 callSites，0 漏抽。

`fillRateOverAll` 字段（85.7%）作为额外可观测信息保留，方便后续分析。

### SC-2 — call edges precision/recall（label-only）

**Matching 策略**：caller (`<relPath>:<callerContext>`) + callee 名二元组 IoU。

| Run | precision | recall |
|-----|-----------|--------|
| 1 | 99.9% | 89.3% |
| 2 | 99.9% | 89.3% |
| 3 | 99.9% | 89.3% |
| **中位数** | **99.9%** | **89.3%** |

**结果分析**：

- precision 99.9% 接近完美 — mapper 抽出的每条 calls 边的 callee 名几乎都在 truth-set 中（极少假阳）
- recall 89.3% 大幅超过 30% 阈值 — mapper 几乎 captured 所有 truth-set 中的 call 关系
- N=3 重测无方差（mapper / extractor 都是确定性 AST walk）

**Sample 命中示例**（前 10 条）：

```
association.go:DB.Association||Parse
association.go:DB.Association||ValueOf
association.go:DB.Association||Kind
association.go:DB.Association||Elem
association.go:Association.Find||Find
association.go:Association.Find||buildCondition
association.go:Association.Append||len
association.go:Association.Append||Replace
association.go:Association.Append||saveAssociation
association.go:Association.Replace||append
```

### SC-3 — 全量单测无回归

```
npx vitest run
Test Files  277 passed | 2 skipped (279)
Tests       3175 passed | 3 skipped | 20 todo (3198)
Duration    ~20s
```

新增测试：20 个（在 [tests/unit/go-mapper-callsite.test.ts](../../../tests/unit/go-mapper-callsite.test.ts)）

- 5 核心场景（FR-8 必须）
- 8 边界用例（reflect / nested selector / parenthesized × 2 / 大文件 / defer-go / 嵌套指针 / dot import / blank import）
- 3 adapter 透传守门
- 4 栈协议 + phantom 防御补强（closure 嵌套 / method-后回到-free / hasError 防御）

启动当下 master 基线测试（3155）无破坏。

### SC-4 — Build / lint

```
npm run build
> tsc
（0 errors）
```

### NFR-1 性能 — wallMs 实测

GORM 顶层 14 个 .go 文件 mapper.extractCallSites 总耗时：**56 ms**

远低于 NFR-1 spec 阈值（30 秒含 dist load + buildUnifiedGraph + N=3 truth-set 重测）。

---

## UnifiedGraph 输出数据

| 字段 | 数值 |
|------|------|
| nodes 总数 | 441 |
| calls 边总数 | 1330 |
| depends-on 边总数 | 0 (Go imports 全部 resolvedPath=null，符合 spec 设计：本 Feature 不实现 Go module path 解析) |

**confidence 分布**（说明性，非验收门槛）：
- 实测验证 cross-module 调用全部落 Stage 4 low（与 spec.md 设计一致）
- 同模块 free function call 走 Stage 1 high
- receiver method call (`s.X()`) 走 Stage 2 高/中（callerContext-based className 命中）

---

## 已知 gap（接受降级）

按 spec.md "明确不做（Out of Scope）" 接受以下行为，不影响验收：

| Gap | 接受降级原因 |
|-----|-------------|
| Go imports `resolvedPath=null` → cross-module 全部 Stage 4 low | 不实现 Go module resolver；label-only matching 不受 confidence 影响，precision/recall 仍正常 |
| dot import (`import . "fmt"`) → bare callee 走 Stage 1 free | EC-Go-4 接受降级；GORM 不用 dot import |
| 复杂表达式 callee（`m["key"]()` / `maker()()`）→ unresolved low | EC-Go-9；本 Feature 不实现复杂表达式追踪 |
| 不接 batch-orchestrator → `_meta/graph.json` 暂不含 Go calls | spec Out of Scope 显式声明，留给后续 Feature |

---

## Codex 阶段性对抗审查记录

| Phase | 轮次 | CRITICAL 项 | WARNING 项 | 结果 |
|-------|------|-----------|-----------|------|
| spec | 6 | 4+3+3+2+1 → 全部修复 | 7+2+0+0+1 → 全部修复 | GATE_DESIGN PASS |
| plan + tasks | 3 | 1 (J: verify schema) → 修复 | 5 (B/D/F/G/I) → 全部修复 | GATE_TASKS PASS |
| implement | 1 | 1 (phantom call 范围) → 与 extractor oracle 1:1 对齐设计选择，case 16 测试覆盖 | 4 (size guard / adapter 测试 / dot import / 栈协议) → case 14/15 + adapter 透传 case 1-3 修复 | 已 commit |
| verify | 0 | — | — | 待跑（本文档生成完成后跑） |

---

## 文件改动清单

| 文件 | 状态 | 行数变化 |
|------|------|---------|
| [src/core/query-mappers/go-mapper.ts](../../../src/core/query-mappers/go-mapper.ts) | M | +476 行（567 → 1043） |
| [src/adapters/go-adapter.ts](../../../src/adapters/go-adapter.ts) | M | +1 行（85 → 87） |
| [tests/unit/go-mapper-callsite.test.ts](../../../tests/unit/go-mapper-callsite.test.ts) | + | 401 行（20 个测试） |
| [scripts/verify-feature-153.mjs](../../../scripts/verify-feature-153.mjs) | + | ~340 行 |
| [scripts/go-truth-set-cli.mjs](../../../scripts/go-truth-set-cli.mjs) | + | 60 行（避免 web-tree-sitter ESM/CommonJS 双实例 Parser.init 冲突的子进程入口） |
| [specs/153-go-callsites-language-adapter/spec.md](../spec.md) | + | 440 行（设计文档）|
| [specs/153-go-callsites-language-adapter/plan.md](../plan.md) | + | 704 行（设计文档）|
| [specs/153-go-callsites-language-adapter/tasks.md](../tasks.md) | + | 501 行（设计文档）|
| [specs/153-go-callsites-language-adapter/verification/verification-report.md](verification-report.md) | + | （本文件）|

**总计**: 4 个源码 / 测试 / 脚本文件 + 4 个设计 / 验证文档 + 1 个本报告 = 9 个文件，~3000 行新增。

---

## 推荐下一步

1. **本 Feature 已可 commit / push**：所有 SC 全 PASS，可进入"push 前 deliverable report"流程
2. **后续 Feature 建议**:
   - 补 batch-orchestrator `collectGoCodeSkeletons` 集成 + Go module path resolver（让 `_meta/graph.json` 真正含 Go calls 边）
   - Feature 154 (Java) / 155 (Agent-Context MCP) / 156 (incremental + sqlite) 按 design doc 路线推进
