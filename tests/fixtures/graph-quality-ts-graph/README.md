# TS/JS pinned graph — 人工推导期望值（F217 T043）

## 来源

按 `specs/217-graph-quality-gates/plan.md` 决策 6 fixture SOP 生成：

1. 在仓库外 `mktemp -d` 创建临时目录，`cp -r tests/fixtures/graph-quality-ts/. <tmp>`（源码，不含 `.git`）
2. 执行 `node dist/cli/index.js batch <tmp> --mode graph-only --output-dir <tmp-out>`
3. 断言 `graph.sourceCommit === null`（临时目录无 `.git`，符合 CONSTRAINT-002 预期）
4. 冻结拷贝 `<tmp-out>/_meta/graph.json` 入库为本目录 `graph.json`

## 人工推导数值

源码 `tests/fixtures/graph-quality-ts/greeter-service.ts` + `greeter-service.test.ts`：
- 1 个 module 级自由函数：`formatGreeting`
- 1 个 class（2 个 method + 1 个 property）：`GreeterService`（`greet` / `buildMessage` / `lastMessage`）
- 1 个 interface：`GreetingOptions`（1 个 property `loud`）
- 1 个 type：`GreetingResult`

节点总数：**10**
- 2 个 module 节点：`greeter-service.ts`、`greeter-service.test.ts`
- 8 个 symbol 节点（`metadata.unifiedKind === 'symbol'`）：
  `formatGreeting`（exportKind=function）、`GreeterService`（exportKind=class）、
  `GreeterService.buildMessage`（memberKind=method）、`GreeterService.greet`（memberKind=method）、
  `GreeterService.lastMessage`（memberKind=property）、`GreetingOptions`（exportKind=interface）、
  `GreetingOptions.loud`（memberKind=property）、`GreetingResult`（exportKind=type）

边总数：**11**（1 条 depends-on + 2 条 calls + 8 条 contains）
- `depends-on`：`greeter-service.test.ts -> greeter-service.ts`（测试文件依赖被测模块）
- `calls`：`GreeterService.buildMessage -> formatGreeting`、`GreeterService.greet -> GreeterService.buildMessage`
  （满足决策 6"class 内方法间至少 1 条可被 AST 解析的调用关系"，`calls` 边非空）
- `contains`：8 条，每个 symbol 节点均有且仅有 1 条 contains 入边（module→顶层符号，或 class/interface→成员）

## 六指标预期值

| 指标 | 预期结果 | 推导依据 |
|---|---|---|
| duplicate-canonical-id | **pass** | 全部 id 均为 canonical `::` 格式，无重复三元组 |
| contains-coverage | **pass**，8/8 = 100% | 8 个 symbol 节点均有 contains 入边 |
| orphan-ratio | **pass**，超标 0/8 = 0% | 全部 8 个 symbol 节点因 contains 入边 degree ≥ 1，无 zero-degree 节点 |
| dangling-edge | **pass** | 全部 11 条边的 source/target 均指向图中存在的节点 |
| legacy-ignored | **pass** | 无遗留 `#` 节点；路径均不命中 `.gitignore` 或图生产者忽略目录合同 |
| freshness | **unknown-provenance** | `sourceCommit === null`（fixture 源自无 `.git` 的仓库外临时目录，CONSTRAINT-002 预期） |

`overallVerdict`：**pass**（五项结构指标全 pass，freshness 为 `unknown-provenance` 不触发 `stale` 降级）。
