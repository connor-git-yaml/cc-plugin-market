# F189 Prototype —— AST-anchored Spec Drift Detection

立项最小闭环原型（**只读复用生产资产，不并入 master，不改任何 `src/` 代码**）。验证两条路线：
- **点锚（Fiberplane Drift 式）**：逐条 spec 引用 → 锚定 symbol id → symbol 级指纹 → 变化标 stale
- **全仓（OpenLore 式）最小 demo**：改动文件集 × spec→Source files 映射 → gap/uncovered/stale-ref

## 跑法

```bash
# 端到端 demo（11 个验收场景，全过 → exit 0）
npx tsx specs/189-ast-anchored-spec-drift-detection/prototype/demo.ts
```

实测输出：`合计 17 场景，17 通过，0 失败。`，退出码 0（含 5 个变体命中守护 + 1 个行号平移场景）。

## 覆盖的验收场景

| 场景 | spec 锚点 | 结果 |
|------|----------|------|
| 裸名 `add` 解析 + symbol 级指纹 + matchKind | US1-AC1 | ✅ |
| 多候选 `helper` → ambiguous + top-3（不误绑） | US1-AC2 | ✅ |
| `add` 函数体变 → **stale**（exit 1，expected≠actual） | US2-AC1 | ✅ |
| `add` 仅缩进/空行重排 → **fresh**（逐行空白不敏感，保留换行） | US2-AC2 | ✅ |
| 改 `multiply`、`add` 不变 → `add` **fresh**（symbol 级不连累） | US2-AC3 | ✅ |
| `add` 前插入新 export、行号下移、内容不变 → `add` **fresh**（按名重解析 span） | US2-AC3+ | ✅ |
| 删 `add` → **orphaned**（exit 1，区别 stale） | US2-AC4 | ✅ |
| graph 不可用 → **graph-unavailable**（exit 2，非静默 0） | FR-010 | ✅ |
| 改文件/spec 未改 → **gap** | US4-AC1 | ✅ |
| 改文件无映射 → **uncovered** | US4-AC2 | ✅ |
| spec 映射死文件 → **stale-ref** | US4-AC3 | ✅ |
| 5×变体命中守护（防 `.replace` 静默 no-op 致假 PASS） | — | ✅ |

## 架构（全部只读复用 `src/`）

```
demo.ts                         端到端验收 runner（tmpdir 操作，不碰仓库）
src/
  resolve.ts      → 复用 canonicalizeSymbolId / resolveSymbolFuzzy (F174) + analyzeFiles
  fingerprint.ts  → 复用 analyzeFiles 取 ExportSymbol.startLine/endLine，切片 + 逐行空白归一化(保留换行) + SHA-256
  point-anchor.ts → link 建锚 + check 验锚（fresh/stale/orphaned/ambiguous/unresolved/
                    fingerprint-unavailable/graph-unavailable）
  whole-repo.ts   → gap/uncovered/stale-ref 分类（demo 级，不接真实 git diff）
  types.ts        → Anchor / DriftReport / WholeRepoReport
fixtures/sample/math.ts         锚定 fixture（两个 top-level export）
```

> 关键不变量：check 按 symbol **名字**重新分析定位 span（不依赖 lock 存的旧行号），故同文件他处增删行导致行号平移**不影响**指纹——这是 symbol 级「不连累」的实现根据。

## lock 制品形态（点锚，参照 Fiberplane `drift.lock`）

```jsonc
{
  "ref": "add", "docPath": "specs/189/spec.md", "line": 42,
  "symbolId": "math.ts::add", "resolvedFrom": "add", "matchKind": "partial-name",
  "fingerprint": "fb598ade…", "status": "fresh"
}
```

## repo:check 集成草案（M9-B，本期**不接线**）

现有 `scripts/repo-check.mjs` 调 `validateRepository(projectRoot)` 返回 `{status, checks:[{id,status}], warnings, errors}`，`status==='fail'` → exit 1。

M9-B 集成方式（草案，不在本期实现，**不改** `package.json` / `repo-maintenance-core.mjs`）：

1. 在 `validateRepository` 增子 check：`{ id: 'spec-drift', status }`
2. **退出码映射的两种语境**（spec US3 / FR-005）：
   - **standalone CLI**（CI gate 用）：stale/orphaned → exit 1；graph-unavailable/fingerprint-unavailable（无法验证）→ exit 2；全 fresh → 0
   - **挂入 repo:check**：stale/orphaned → 进 `warnings`（贡献 warning，**不**让 `status='fail'`，避免 drift 阻断提交）；仅 lock 损坏/`--strict` → fail
3. 建议 gate 严重度：`spec-drift` 默认 **warning 级**（drift 是提示信号，非硬门禁）

## 本期已知局限（登记给 M9，已在 spec/decision 记录）

- **指纹粒度**：symbol 级源切片 + 逐行空白归一化（保留换行）→ 已达成「缩进/行内空白/空行不敏感」；刻意保留换行以避免 `return\n1` 这类 ASI 语义漏报；**未**达成「跨行重排 / 注释 / 字面值 / 完整 normalized-AST 不敏感」（M9-C）
- **member 锚点**：`Class.method` 回退到 Class span（MemberInfo 无 startLine/endLine）；demo 用 top-level 函数
- **rename-follow**：symbol 重命名统一标 orphaned，不跟随（M9-D）
- **引用抽取**：用显式 JSON fixture 输入，不从 Markdown 正文自动抽取（ship 前 follow-up）
- **全仓路线**：仅 demo 级分类，不接真实 git diff、不建生产分类引擎（M9-E）
