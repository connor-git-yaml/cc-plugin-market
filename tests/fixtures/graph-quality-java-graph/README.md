# Java pinned graph — 人工推导期望值（F217 T044）

## 来源

按 `specs/217-graph-quality-gates/plan.md` 决策 6 fixture SOP 生成：

1. 在仓库外 `mktemp -d` 创建临时目录，`cp -r tests/fixtures/graph-quality-java/. <tmp>`（源码 + `.gitignore`，不含 `.git`）
2. 执行 `node dist/cli/index.js batch <tmp> --mode graph-only --output-dir <tmp-out>`
3. 断言 `graph.sourceCommit === null`（临时目录无 `.git`，符合 CONSTRAINT-002 预期）
4. 冻结拷贝 `<tmp-out>/_meta/graph.json` 入库为本目录 `graph.json`

**注意（SOP 踩坑记录）**：`cp -r <src>/* <dst>/` 在 bash 下不会复制点前缀文件（`.gitignore`），
必须用 `cp -r <src>/. <dst>/`，否则 `.gitignore` 命中样本（`generated/StubOnly.java`）会被
误纳入图（曾在生成本 fixture 时实测复现该问题，修正拷贝命令后确认 `generated/`/`build/`
两个忽略样本均被正确排除）。

## 人工推导数值

源码 `tests/fixtures/graph-quality-java/` 遵循决策 6 合同表（Java 行：≥1 class 含 ≥2 method +
≥1 interface + ≥1 enum，无自由函数）：
- `Service.java`：class `Service`（3 method：`Service` 构造函数 + `getName` + `setName`）
- `Processor.java`：interface `Processor`（2 method：`process` + `getLabel`）
- `Status.java`：enum `Status`（无展开成员节点，enum 本身即 1 个 symbol 节点）
- `Broken.java`：class `Broken`（语法错误样本，仍可解析出 2 method：`broken` + `valid`，
  验证单文件语法错误不影响整体产出）
- `ServiceTest.java`：测试文件，class `ServiceTest`（1 method：`testGetName`）
- 忽略样本（均不应入图）：`build/Generated.java`（内置忽略目录 `build/`，
  JavaLanguageAdapter.defaultIgnoreDirs 命中）、`generated/StubOnly.java`（`.gitignore` 命中）

节点总数：**18**
- 5 个 module 节点：`Service.java`、`Processor.java`、`Status.java`、`Broken.java`、`ServiceTest.java`
- 13 个 symbol 节点（`metadata.unifiedKind === 'symbol'`）：
  `Broken`（class）、`Broken.broken`（method）、`Broken.valid`（method）、
  `Processor`（interface）、`Processor.getLabel`（method）、`Processor.process`（method）、
  `Service`（class）、`Service.getName`（method）、`Service.Service`（constructor）、`Service.setName`（method）、
  `Status`（enum）、`ServiceTest`（class）、`ServiceTest.testGetName`（method）

边总数：**13**（全部为 `contains`；决策 1 CONSTRAINT 范围裁剪明确 Java/Go 不做 import
resolution，故无 `depends-on`/`calls` 边）
- 每个 symbol 节点均有且仅有 1 条 contains 入边（module→顶层类型，或 class/interface→成员）

## 六指标预期值

| 指标 | 预期结果 | 推导依据 |
|---|---|---|
| duplicate-canonical-id | **pass** | 全部 id 均为 canonical `::` 格式，无重复三元组 |
| contains-coverage | **pass**，13/13 = 100% | 13 个 symbol 节点均有 contains 入边 |
| orphan-ratio | **pass**，超标 0/13 = 0% | 全部 13 个 symbol 节点因 contains 入边 degree ≥ 1，无 zero-degree 节点 |
| dangling-edge | **pass** | 全部 13 条边的 source/target 均指向图中存在的节点 |
| legacy-ignored | **pass** | 无遗留 `#` 节点；`build/Generated.java`/`generated/StubOnly.java` 已在采集阶段被
  ignore-oracle 正确排除，未进入图，故图内无 ignored-path 节点可检出 |
| freshness | **unknown-provenance** | `sourceCommit === null`（fixture 源自无 `.git` 的仓库外临时目录，CONSTRAINT-002 预期） |

`overallVerdict`：**pass**（五项结构指标全 pass，freshness 为 `unknown-provenance` 不触发 `stale` 降级）。
