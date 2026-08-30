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

边总数：**14**（1 条 depends-on + 5 条 calls + 8 条 contains，F272 ④ 重建，见下方"重建历史"）
- `depends-on`：`greeter-service.test.ts -> greeter-service.ts`（测试文件依赖被测模块）
- `calls`：5 条
  - `GreeterService.buildMessage -> formatGreeting`、`GreeterService.greet -> GreeterService.buildMessage`
    （满足决策 6"class 内方法间至少 1 条可被 AST 解析的调用关系"，`calls` 边非空）
  - `greeter-service.test.ts -> greeter-service.ts::formatGreeting`
  - `greeter-service.test.ts -> greeter-service.ts::GreeterService.greet`
  - `greeter-service.test.ts -> greeter-service.ts::GreeterService`
    （以上 3 条是测试文件对被测模块的直接调用边，由 F242/F260 调用边覆盖增强新增识别，
    是纯增益，不影响既有 2 条 class 内部 calls 边与全部 contains 边）
- `contains`：8 条，每个 symbol 节点均有且仅有 1 条 contains 入边（module→顶层符号，或 class/interface→成员）

## 重建历史

| 日期 | producer commit | 边总数 | calls | 变化原因 |
|---|---|---|---|---|
| F217 初建 | 见 `specs/217-graph-quality-gates/plan.md` | 11 | 2 | 初始人工推导 |
| F272 ④ 重建 | `f7a65aa9` + `npm run build` | 14 | 5 | F242/F260 调用边覆盖增强后 pinned 图静默陈旧（断言仍绿因为断言的是 pinned 文件自身），本卡覆盖重建为当前 builder 行为，新增 3 条测试文件→被测模块的 calls 边，无丢失边 |

## 六指标预期值

| 指标 | 预期结果 | 推导依据 |
|---|---|---|
| duplicate-canonical-id | **pass** | 全部 id 均为 canonical `::` 格式，无重复三元组 |
| contains-coverage | **pass**，8/8 = 100% | 8 个 symbol 节点均有 contains 入边 |
| orphan-ratio | **pass**，超标 0/8 = 0% | 全部 8 个 symbol 节点因 contains 入边 degree ≥ 1，无 zero-degree 节点 |
| dangling-edge | **pass** | 全部 14 条边的 source/target 均指向图中存在的节点 |
| legacy-ignored | **pass** | 无遗留 `#` 节点；路径均不命中 `.gitignore` 或图生产者忽略目录合同 |
| freshness | **unknown-provenance** | `sourceCommit === null`（fixture 源自无 `.git` 的仓库外临时目录，CONSTRAINT-002 预期） |

`overallVerdict`：**pass**（五项结构指标全 pass，freshness 为 `unknown-provenance` 不触发 `stale` 降级）。
