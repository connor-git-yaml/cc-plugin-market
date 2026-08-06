# 问题修复报告 · F259 调用图确定性假边收口 + collector 指纹护栏 py 侧盲区补齐

> 审查档位声明：Codex 配额耗尽期，按 `CLAUDE.local.md` 顶部暂停节执行「独立子代理异构对抗 ≥2 切入角」，
> commit 须显式标注「Codex 审查暂停，异构档位缺席」。

## 问题描述

同批审查确认的两处图正确性缺陷，共同点是**当前测试全绿但守护力有洞**：

1. **缺陷 1（确定性假边）**：`src/knowledge-graph/call-resolver.ts` 的 moduleSpecifier 兜底别名
   只对 `dynamic` 上了闸，`commonjs-require` 走同一路径无闸 → `require('./dep.js')` 会把别名 `js`
   写成 `dep.ts`，覆盖同名静态绑定 `import { js } from './lit.js'`，产出两端都是真实节点的假边。
2. **缺陷 2（护栏盲区）**：`tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` 的 a-track
   对整条 `#2 pyWalk` 管线零独占覆盖 —— 该管线整体失效时护栏仍 20/20 全绿，导致
   `BEHAVIOR_VERSION` bump 纪律在 py 侧完全失灵。

## 5-Why 根因追溯

### 缺陷 1

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 假边 `caller.ts::go → dep.ts::js` 为何产生？ | `aliasToTarget` 里 `js` 被解析到 `dep.ts`，Stage 3 据此产出 medium 边 |
| Why 2 | `js` 为何指向 `dep.ts`？ | `registerSpecifierFallback` 对 `require('./dep.js')` 算出 `lastSeg='js'` 并**无条件 `set()`** 覆盖了先写入的静态绑定 `js→lit.ts` |
| Why 3 | 为何会走到兜底？ | `hasBindingNames(imp)` 对每个 require 条目**恒为 false** —— `ast-analyzer.ts:543` 只对 `kind === 'dynamic'` 抽绑定名，require 分支按 F242 Non-Goals 不动 |
| Why 4 | 为何 F242 的闸没覆盖它？ | F242 的闸建在 `buildImportIndex` 第一遍的 `if (imp.importType === 'dynamic') continue;` —— 判据用的是**具体 importType 值**而非「specifier 是路径字面量」这一真正的前提。`commonjs-require` 与 dynamic 共享同一前提却不在名单内 |
| Why 5 | 为何未被现有机制捕获？ | 兜底成立的前提（"moduleSpecifier 最后一段就是源码里的调用名"）只在 Python `import X` 下成立，但该前提**从未被断言化**；且构成假边需要"同名 collision"（`js` 既是路径扩展名又是某个静态导入名），既有测试无此形态样本 |

**Root Cause**：兜底别名的**成立前提是"specifier 是点分模块名"（Python 语义）**，而闸的判据写成了
「importType ≠ dynamic」这一**具体值枚举**。TS/JS 的 `require()` specifier 是**路径字面量**，`lastSeg`
恒为文件扩展名（`js`/`mjs`/`json`…），既无意义又会无条件覆写同名静态绑定。

**Root Cause Chain**：假边 → `js` 别名被覆写 → require 恒无绑定名恒进兜底 → 闸按 importType 枚举而非
按「specifier 形态」判定 → 兜底前提未断言化 + 无同名 collision 样本。

### 缺陷 2

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 关掉整条 `#2 pyWalk` 为何护栏不红？ | a-track 比较的节点 multiset 中，py 相关节点在关掉 `#2` 后**仍然存在** |
| Why 2 | 节点为何仍存在？ | `graph-assembly.ts` 步骤 3 的 `#11 pythonSymbolScan`（`PythonLanguageAdapter.extractSymbolNodes`）对同一 `.py`/`.pyi` 产出**等值的 module + component 节点** |
| Why 3 | 为何等值节点能完全掩码？ | `buildKnowledgeGraph` 按 id 合并去重，两条生产者的输出在**节点面**完全重合；而 fixture 的 py 样本（`def mod_fn(): return 1`）**不产生任何 import / callSite**，`#2` 唯一能独占贡献的边面因此是空的 |
| Why 4 | fixture 为何是这种形态？ | F249 建 fixture 时按「每条管线一个扩展名样本」设计，覆盖意图停在**扩展名维度**，没有针对「两条管线输出是否可区分」做设计 |
| Why 5 | 为何未被捕获？ | 护栏自身的守护力从未被**变异测试**验证过 —— 那条名为"护栏输入面未被悄悄缩小"的用例断言的是节点 id 存在性，而节点 id 恰是两条管线的重合面，用例名与实际守护力不符 |

**Root Cause**：`#2 pyWalk` 与 `#11 pythonSymbolScan` 在 fixture 的现有样本上**输出等值**，去重后
护栏对任一单侧生产者完全不敏感；两套剪枝集（`PY_SKELETON_IGNORE_DIRS` vs `scanPyFiles` 的
`ignoreNames`）不同却互为掩码。

**Root Cause Chain**：改 py 采集行为不 bump BEHAVIOR_VERSION 也不红 → 护栏对 `#2` 零独占覆盖 →
两生产者节点面等值 + fixture py 样本无 import/callSite → fixture 覆盖意图只做到扩展名维度 →
护栏守护力从未经变异测试验证。

## 实证证据（本次编排器亲自复现，非转述）

### 缺陷 1 探针（全新临时工程 + `collectTsJsCodeSkeletons` → `buildImportIndex` → `buildUnifiedGraph`）

输入（`src/caller.ts`）：

```ts
import { js } from './lit.js';
const dep = require('./dep.js');
export function go(): string { return js() + String(dep.helper()); }
```

实测输出：

- `imports[1].importType === 'commonjs-require'`，且**无任何绑定名字段**（证实 Why 3）
- `aliasToTarget = [["js", ".../src/dep.ts"], ["./dep.js", ".../src/dep.ts"]]` —— 静态绑定 `js→lit.ts` 被覆写
- 产出边：`src/caller.ts::go → src/dep.ts::js [calls, medium]` —— **两端都是真实节点**，
  `graph-builder.ts` 的悬空端点过滤拦不住 → 确定性进入图
- 附带观察：`dep.helper()` **未产生任何边**（`dep` 这个真实绑定名根本没进索引）。
  即 require 的 lastSeg 兜底对调用边覆盖率**没有正贡献**，只有假边负贡献。

### 缺陷 2 探针 C（决定性）

- 基线：`npx vitest run tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` → **20 passed**
- 变异：`graph-assembly.ts` 中把 `pythonSkeletons` 从 `codeSkeletons` 合并里整体剔除
- 结果：**仍然 20 passed** ← 整条 `#2 pyWalk` 管线可被完全删除而护栏无感
- 佐证：pinned 图中 py 相关节点为
  `src/py/mod.py`、`src/py/mod.py::mod_fn`、`src/py/mod.pyi`、`src/py/mod.pyi::mod_fn` ——
  全部可由 `#11 pythonSymbolScan` 单独产出

## 影响范围扫描

### 同源问题（需同步修复）

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `src/knowledge-graph/call-resolver.ts` | `buildImportIndex` 第一遍无绑定名分支 + `registerSpecifierFallback` | 兜底别名闸按 importType 枚举 | 改为按「兜底前提是否成立」判定；至少不得覆写已有静态绑定 |
| `tests/unit/guardrail/collector-fingerprint-guardrail.test.ts` | a-track py 断言 | 断言落在两生产者重合面 | 增加 `#2` 独占可见的断言（或对两生产者分别做行为探针） |
| `tests/fixtures/collector-fingerprint-guardrail/src/py/` | 样本形态 | 无 import / callSite → `#2` 无独占输出 | 增补能产出 `#2` 独占输出的 py 样本（py→py 依赖 / 调用） |
| `tests/fixtures/collector-fingerprint-guardrail/README.md` | 覆盖表 | 把 `mod.py`/`mod.pyi` 记为覆盖 `#2 pyWalk`（探针 C 证伪） | 按实际覆盖修正记账 |

### 类似模式（需评估）

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `src/knowledge-graph/call-resolver.ts` | Python 采集路径的无绑定名条目 | 同样走 `registerSpecifierFallback` | **需保留**：`import numpy` 的 lastSeg 确实是调用名，是该兜底的唯一正当场景 |
| `src/knowledge-graph/call-resolver.ts` | 第二遍 dynamic 候选写入 | 已有「歧义即弃权 + 静态获胜」闸 | 安全，作为缺陷 1 修复的同级参照 |
| `tests/fixtures/collector-fingerprint-guardrail/src/java`、`src/go` | `#3 genericAdapters` 是否同样存在掩码 | 与 `#11` 无重合生产者 | 需在实现阶段用同款变异探针确认（对照组 D 已证 tsjs 侧守得住） |

### 同步更新清单

- 调用方：`buildImportIndex` 的下游（`resolveOne` / Stage 2/3）——修复只减别名不加语义，无签名变化
- 测试：缺陷 1 需新增假边红用例（require + 同名静态绑定）；缺陷 2 需新增/改造 py 侧变异可红用例
- Fixture：pinned 资产 `expected-graph-only-graph.json` / `expected-module-graph.json` 因 fixture 增样
  必须经 `npm run fixtures:regen:collector-fingerprint` 再生（**禁手工编辑**）
- 文档：fixture README 覆盖表 + 用例名

## 修复策略

### 方案 A（推荐）

- **缺陷 1**：把兜底闸的判据从「importType 枚举」改为「兜底前提是否成立」。具体地，
  `commonjs-require` 与 `dynamic` 同属「specifier 是路径字面量」，**不注册 `lastSeg` 别名**；
  是否保留整串 `moduleSpecifier` 别名由实现阶段按「是否可能成为调用名」判定。
  同时给 `registerSpecifierFallback` 的写入加「不覆写已有静态绑定」的防御（双保险）。
  **不得取消 require 的 depends-on 边**——F242 目标是覆盖率，修的是"覆盖静态绑定"。
- **缺陷 2**：给 fixture 增补能产出 `#2` **独占输出**的 py 样本（带真实 py→py import 与 callSite，
  `extractSymbolNodes` 产不出 `calls`/`depends-on` 边），并把 a-track 断言从「节点 id 存在」
  升级为「`#2` 独占的边/字段存在」；修正 README 覆盖表与那条名不副实的用例名。

### 方案 B（备选）

- 缺陷 1：仅加「不覆写已有绑定」的防御，保留 lastSeg 注册。
  缺点：仍会为 TS require 注入 `js`/`json` 这类垃圾别名，只是不再覆盖；一旦某文件**只有** require
  没有同名静态绑定，`js()` 调用仍会被错误解析。**不推荐**。
- 缺陷 2：不动 fixture，改为对 `collectPythonCodeSkeletons` 与 `extractSymbolNodes` 分别做行为探针
  用例（直接断言两条管线各自的输出面）。缺点：绕开了端到端护栏，`graph-assembly` 的接线断了仍不红。
  可作为**补充**而非替代。

## 验证策略（红用例先行）

1. 缺陷 1：先写复刻上述探针的红用例（断言 `aliasToTarget` 不含被覆写项、图中无 `::js` 类假边）
2. 缺陷 2：先证明新护栏在探针 C（`pythonSkeletons` 置空）下**变红**，并对 A/B 单侧改剪枝至少一轨红
3. 变异矩阵：对 py 侧 5 个 bump 维度（ignore-dirs-pruning / gitignore-interpretation /
   symlink-handling / file-size-guard / collection-failure-degradation）逐个做变异，确认可红
4. 回归：本仓 `graph-only` 重建后**逐边 diff**，证明减少的边全是假边；图质量门六指标不回落
5. 全量：`npx vitest run` + `npm run test:plugins` + `npm run build` + `npm run repo:check` + `npm run release:check`

## Spec 影响

- 需要更新的 spec：`specs/249-graph-collector-fingerprint/` 的 FR-005(c) 相关验收记账（护栏实际守护面
  与纸面承诺不符，须据实修订或补记）；其余无需更新。
