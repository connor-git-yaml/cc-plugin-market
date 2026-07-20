# Go pinned graph — 人工推导期望值（F217 T045）

## 来源

按 `specs/217-graph-quality-gates/plan.md` 决策 6 fixture SOP 生成：

1. 在仓库外 `mktemp -d` 创建临时目录，`cp -r tests/fixtures/graph-quality-go/. <tmp>`（源码 + `.gitignore`，不含 `.git`）
2. 执行 `node dist/cli/index.js batch <tmp> --mode graph-only --output-dir <tmp-out>`
3. 断言 `graph.sourceCommit === null`（临时目录无 `.git`，符合 CONSTRAINT-002 预期）
4. 冻结拷贝 `<tmp-out>/_meta/graph.json` 入库为本目录 `graph.json`

**注意（SOP 踩坑记录）**：同 Java fixture README——`cp -r <src>/* <dst>/` 不复制 `.gitignore`，
必须用 `cp -r <src>/. <dst>/`，否则 `generated/stub.go` 会被误纳入图。

## 人工推导数值

源码 `tests/fixtures/graph-quality-go/` 遵循决策 6 合同表（Go 行：≥1 package 级 func + ≥1 struct
含 ≥1 显式 receiver method + ≥1 interface + ≥1 type alias，receiver 必须显式声明避开降级边界）：
- `server.go`：package 级函数 `NewServer` + struct `Server`（2 个显式 receiver method：`Start` / `Stop`）
- `handler.go`：interface `Handler`（1 个 method：`Handle`）+ type alias `HandlerFunc`
- `syntax-error.go`：语法错误样本，仍可解析出 1 个有效函数 `ValidFunc`（验证单文件语法错误不影响整体产出）
- `server_test.go`：测试文件，1 个函数 `TestNewServer`
- 忽略样本（均不应入图）：`vendor/Generated.go`（GoLanguageAdapter.defaultIgnoreDirs 命中
  内置 `vendor/`）、`generated/stub.go`（`.gitignore` 命中）
- `internal/server/`：仓库预留的空目录（无 `.go` 文件），不产生任何节点，不影响计数

节点总数：**13**
- 4 个 module 节点：`server.go`、`handler.go`、`syntax-error.go`、`server_test.go`
- 9 个 symbol 节点（`metadata.unifiedKind === 'symbol'`）：
  `NewServer`（function）、`Server`（struct）、`Server.Start`（method）、`Server.Stop`（method）、
  `Handler`（interface）、`Handler.Handle`（method）、`HandlerFunc`（type）、
  `ValidFunc`（function）、`TestNewServer`（function）

边总数：**9**（全部为 `contains`；同 Java，决策 1 CONSTRAINT 范围裁剪 Java/Go 不做 import
resolution，故无 `depends-on`/`calls` 边）
- 每个 symbol 节点均有且仅有 1 条 contains 入边（module→顶层函数/类型，或 struct/interface→方法）

## 六指标预期值

| 指标 | 预期结果 | 推导依据 |
|---|---|---|
| duplicate-canonical-id | **pass** | 全部 id 均为 canonical `::` 格式，无重复三元组 |
| contains-coverage | **pass**，9/9 = 100% | 9 个 symbol 节点均有 contains 入边 |
| orphan-ratio | **pass**，超标 0/9 = 0% | 全部 9 个 symbol 节点因 contains 入边 degree ≥ 1，无 zero-degree 节点 |
| dangling-edge | **pass** | 全部 9 条边的 source/target 均指向图中存在的节点 |
| legacy-ignored | **pass** | 无遗留 `#` 节点；`vendor/Generated.go`/`generated/stub.go` 已在采集阶段被排除，
  未进入图，故图内无 ignored-path 节点可检出 |
| freshness | **unknown-provenance** | `sourceCommit === null`（fixture 源自无 `.git` 的仓库外临时目录，CONSTRAINT-002 预期） |

`overallVerdict`：**pass**（五项结构指标全 pass，freshness 为 `unknown-provenance` 不触发 `stale` 降级）。
