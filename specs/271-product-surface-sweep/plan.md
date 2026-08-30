# Implementation Plan: F271 产品表面一致性清扫

**Branch**: `271-product-surface-sweep` | **Date**: 2026-08-31 | **Spec**: [spec.md](./spec.md)
**Input**: `specs/271-product-surface-sweep/spec.md`（已过 GATE_DESIGN，28 FR / 6 US / 三项裁决已固化）+ `research/precheck-ledger.md`（逐条证据锚）
**基线**: `f7a65aa9`

---

## Summary

本次改动是一次**表面清扫（surface sweep）**：不新增能力，只修复"承诺 vs 实现"之间的偏差。核心是 User Story 1 的 lineRange 死功能修活（4 个写入点，横跨 3 个模块），其余 5 个 User Story 均为诚实化文案 / 精确错误码 / 文档纠偏的低风险定点修改。技术方案不引入新抽象、新依赖、新配置项，严格复用仓库已有的错误码体系（`tool-response.ts`）与归一化管线（`graph-builder.ts`）。

---

## Technical Context

**Language/Version**: TypeScript 5.x（`src/`），Markdown/YAML（文档类改动）
**Primary Dependencies**: 无新增；复用 `zod`（既有 schema）、Node 内置 `fs`/`path`
**Storage**: `specs/_meta/graph.json`（新增可选字段 `metadata.lineRange`，向后兼容）
**Testing**: vitest（单测追加到既有同名/同目录测试文件，禁止改动 `vitest.config.ts`）
**Target Platform**: Node.js ≥ 20.x（与仓库既有一致）
**Project Type**: single（本仓库既有结构，不新增顶层目录）
**Performance Goals**: 无新增性能目标；lineRange 字段来自已解析的 AST span，零额外解析开销
**Constraints**: byte-stable（SC-001）；不破坏 `response-contract.test.ts` 既有断言（FR-017）；不新增 `path-outside-root` 校验（FR-014 明确排除）
**Scale/Scope**: 8 个代码模块的定点修改 + 约 12 处文档/文案修正，无新增独立组件

---

## Constitution Check

*GATE: 已通过设计阶段评估（本卡在 spec.md 复杂度评估中判定为 MEDIUM，无 HIGH 信号）。*

| 原则 | 适用性 | 评估 | 说明 |
|------|--------|------|------|
| I. 双语文档规范 | 适用 | ✅ 通过 | plan/tasks 正文中文，代码标识符英文 |
| II. Spec-Driven Development | 适用 | ✅ 通过 | 经 spec.md → plan.md → tasks.md 标准链路，不直接改源码 |
| III. YAGNI | 适用 | ✅ 通过 | lineRange 不引入共享类型抽象（`LineRange` interface），沿用既有 4 处内联 `{start,end}` 字面量风格；graph_hyperedges 诚实化不新增 engine 方法，仅在 handler 层追加纯函数 |
| IV. 诚实标注不确定性 | 适用（核心） | ✅ 通过 | class member 节点诚实缺席 lineRange（FR-002）；graph_community/graph_hyperedges 诚实区分"无数据"与"未命中"（FR-008/FR-011）；退出码语义表如实标注已知例外（FR-023） |
| V. AST 精确性优先 | 适用 | ✅ 通过 | lineRange 完全来自 `ts-morph`/Python AST 已提取的 `startLine`/`endLine`，无 LLM 参与 |
| VI. 混合分析流水线 | 不适用 | — | 本次改动不涉及 LLM 生成阶段 |
| VII. 只读安全性 | 适用 | ✅ 通过 | 写操作仍限于 `specs/`；不新增对源文件的写入 |
| VIII. 纯 Node.js 生态 | 适用 | ✅ 通过 | 无新依赖 |
| XIV. 可观测性与架构守护 | 适用 | ✅ 通过 | 4 个写入点的顺序与白名单遗漏风险已在下文架构决策中显式追踪 |

**结论**：无 VIOLATION，无需 Complexity Tracking 豁免条目。

---

## Codebase Reality Check

| 目标文件 | LOC（当前） | 相关方法/接口数 | 已知 debt |
|---|---|---|---|
| `src/knowledge-graph/index.ts` | ~260 行区间内定位（`deriveNodesFromSkeletons`） | 1 个函数改动 | 无超长函数信号 |
| `src/panoramic/graph/graph-builder.ts` | 846+ 行（全文件） | 2 个分支（:383-390, :399-412）+ `normalizeGraphForWrite`（:814-846） | 无 TODO/FIXME 命中；已有大量 F214/F217/F259 决策注释，改动需延续既有注释风格避免断代 |
| `src/adapters/python-adapter.ts` | ~270+ 行区间内定位（`extractSymbolNodes`） | 1 个循环体改动 | 无 |
| `src/mcp/server.ts` | ~360+ 行（含全部工具注册） | `prepare` 1 个 handler | 无 |
| `src/panoramic/graph/graph-query.ts` | 800+ 行 | `getCommunity`（1 处）、`assertGraphFormatNotStale`（2 处消息） | 无 |
| `src/mcp/graph-tools.ts` | 447 行 | `graph_community` description（1 处）、`graph_hyperedges` handler（1 处） | 无 |
| `src/mcp/file-nav-tools.ts` | 380+ 行 | `resolveSymbolRange` 内 1 处消息 | 无 |
| `src/mcp/agent-context-tools.ts` | 500+ 行 | `getCachedGraphOrError` 内 1 处消息 | 无 |
| `src/cli/commands/index.ts` | 260+ 行 | `runIndexCommand` 内 1 处退出码 | 无 |
| `src/cli/commands/graph-quality.ts` | 875+ 行 | 5 处提示措辞（1 处）+ `exitCodeFor`（不改，仅标注） | 无 |

**前置清理判定**：均不满足"LOC>500 且新增>50 行"或">3 个相关 TODO"或"代码重复 2+ 处"任一前置清理触发条件（`graph-builder.ts` 虽 846 行，但本次每处改动均 < 10 行局部追加）。**不新增 `[CLEANUP]` 前置任务**。

---

## Impact Assessment

- **影响文件数**：直接修改约 8 个代码模块 + 约 10 个文档文件（README.md、`plugins/spectra/README.md`、`docs/spectra-cli-reference.md`、4 个 SKILL.md 及镜像、`contracts/release-contract.yaml`）+ 对应新增/追加单测约 8 个测试文件。总计 < 20，**不构成跨包影响的量级阈值**。
- **跨包影响**：0（全部改动落在 `src/`、根 `README.md`/`docs/`、`plugins/spectra/README.md`、`skills/`、`src/skills-global/`、`contracts/`；不触碰 `plugins/spec-driver/`）。
- **数据迁移**：无 schema 破坏性变更——`GraphNode.metadata.lineRange` 是新增可选字段，旧图（无该字段）仍可被现有消费代码正常解析（`md['lineRange'] as {...} | undefined` 已是可选读取）。
- **API/契约变更**：
  - `prepare` 工具错误响应新增 `file-not-found` 分支（FR-014）——经实证 `response-contract.test.ts` 零断言变更（见 spec"合同影响分析"节），属于**新增分支不改变既有契约**。
  - `spectra index` 目标路径不存在场景退出码 2→1（FR-022）——这是一个**行为变更**，但影响面收窄：唯一消费方是脚本化调用 `spectra index` 并依赖退出码 2 语义的下游（未发现仓内此类依赖，`tests/integration/156-w2-spectra-index.test.ts` 未覆盖该分支）。
  - `graph_community`/`graph_hyperedges` 空结果 `message` 文案变更——保持 `isError` 语义不变（仍为 success 响应），不破坏 `tests/e2e/feature-180-graph-tools.e2e.test.ts` 的结构性断言（该测试仅断言 `isError !== true` 与 `nodes` 是数组，不断言 `message` 内容）。
- **风险等级**：**LOW**（影响文件 < 10 个核心代码模块，无跨包影响，无数据迁移，仅 1 处退出码语义的行为变更且已确认无仓内测试/脚本依赖旧值）。
- **是否强制分阶段**：不适用（LOW 风险，不触发 HIGH 风险的强制分阶段规则）。但考虑到 lineRange 生产链天然是"4 处缺一不可"的强耦合改动，implement 阶段内部仍应遵循**先产出侧、后消费验证**的顺序（见下文架构决策），避免中间态误判为"已修好"。

---

## 架构决策

> **实现阶段修订（2026-08-31，裁决回写）**：决策 1 的「不引入共享 `LineRange` 类型抽象、沿用 4 处内联字面量」在对抗审查修复轮被推翻——两角异构审查实证了同名符号撞 id first-wins 会让 lineRange 指向被遮蔽死定义 / TS overload 丢函数体（角1 C1/C2），修法（span 并集 + `[REGEX] ` 退化门控 + 三处对称校验）需要单一事实源，遂新增 `src/knowledge-graph/line-range.ts`（4 个纯函数）。这是被证伪驱动的升级而非范围蔓延；完整链路见 `verification/adversarial-review.md` 与 `verification/implement-notes.md`「对抗审查修复轮」节。Constitution Check 表中「YAGNI ✅ 不引入共享类型抽象」一行以本批注为准。

**总体顺序**（生产 → 传递 → 验证，避免中间态误判）：

```
① knowledge-graph/index.ts（TS/JS 主路径生产）
   ↓
② python-adapter.ts（Python 第四路生产，与①同优先级，二者互不依赖，可并行实现）
   ↓
③ graph-builder.ts:399-412（新节点构造分支，透传①②写入的 lineRange）
   ↓
④ graph-builder.ts:383-390（已有节点补齐分支，透传同上）
   ↓
消费侧验证（file-nav-tools.ts / agent-context-tools.ts 无需改动，仅验证死代码分支被真实触发）
```

**为什么①②先于③④**：③④是纯粹的"透传管道"，若先写透传逻辑但生产侧未产出字段，透传代码看起来"改对了"但无法用真实数据验证（会产生"改完但没生效"的假阳性）。反之，先把①②的生产逻辑写完并跑一次 `graph-only`，此时 activity 图里 lineRange 仍会因③④未透传而缺失——这个"仍然缺失"的中间态本身就是③④必要性的活证据，符合诚实验证原则。

#### ① `src/knowledge-graph/index.ts:230-260`（`deriveNodesFromSkeletons`）

在 `for (const exp of sk.exports)` 循环体内，`push({ ... })` 的 `metadata` 字段追加 `lineRange`：

```ts
metadata: { exportKind: exp.kind, lineRange: { start: exp.startLine, end: exp.endLine } },
```

`exp.startLine`/`exp.endLine` 是 `ExportSymbolSchema`（`code-skeleton.ts:85-105`）的**必填**字段，无需判空。

在 `for (const m of exp.members)` 循环体内（member 节点），**不改动**——保持 `metadata: { memberKind: m.kind }` 原样，不产出 `lineRange`（FR-002 诚实缺席，`MemberInfoSchema` 无行号字段，禁止用 class span 兜底）。

#### ② `src/adapters/python-adapter.ts:262-265`（`extractSymbolNodes` 第四路）

在 `nodes.push({ id: symbolId, ... })` 的 `metadata` 追加：

```ts
metadata: {
  symbolKind: symbol.kind,
  signature: symbol.signature ?? undefined,
  lineRange: { start: symbol.startLine, end: symbol.endLine },
},
```

`symbol` 即遍历 `skeleton.exports` 得到的 `ExportSymbol`，字段同①必填可用。

#### ③ `src/panoramic/graph/graph-builder.ts:399-412`（新节点构造分支）

在 :367-372 附近（与 `exportKind`/`memberKind` 提取并列处）新增：

```ts
const lineRangeRaw = ugNode.metadata?.['lineRange'];
const lineRange = (lineRangeRaw && typeof lineRangeRaw === 'object'
  && typeof (lineRangeRaw as Record<string, unknown>)['start'] === 'number'
  && typeof (lineRangeRaw as Record<string, unknown>)['end'] === 'number')
  ? (lineRangeRaw as { start: number; end: number })
  : undefined;
```

`nodeMap.set(...)` 的 `metadata` 对象追加一行：

```ts
...(lineRange !== undefined ? { lineRange } : {}),
```

放在 `exportKind`/`memberKind` 展开之后，保持既有 key 顺序追加惯例（不影响 byte-stable，因为同一份代码每次运行的插入顺序恒定）。

#### ④ `src/panoramic/graph/graph-builder.ts:383-390`（已有节点补齐分支）

复用③已提取的 `lineRange` 变量（同一次循环迭代内，`lineRange` 已在 `if (existing)` 判断之前算好），在 `existing.metadata = { ...existing.metadata, ... }` 的展开列表追加：

```ts
...(lineRange !== undefined ? { lineRange } : {}),
```

注意注释需延续既有风格说明"为什么这是新增 key、不会覆盖 extraction 侧字段"（比照 :380-382 已有注释模式）。

#### Key 命名铁律（FR-003）

全部 4 处必须写 `{ start, end }`，**禁止**写成 `{ startLine, endLine }`——消费侧 `file-nav-tools.ts:107`、`agent-context-tools.ts:473` 已固定读 `.start`/`.end`。

### 决策 2：member 节点诚实缺席的实现位置

**唯一需要"不做什么"的地方就是①的 member 循环分支**——不新增任何显式的"跳过"逻辑或注释外的运行时判断，因为"不写字段"本身就是诚实缺席的实现（无需 `if (false)` 之类的防御性占位）。验证方式是**新增单测断言 member 节点的 `metadata` 不含 `lineRange` key**（而非仅断言 `undefined`，因为 `{lineRange: undefined}` 与"key 不存在"在 `Object.keys()`/`JSON.stringify` 语义上不同，后者才是"诚实缺席"的准确表达——`JSON.stringify` 会自动丢弃 value 为 `undefined` 的 key，因此当前用条件展开写法天然满足这一点，无需额外处理）。

### 决策 3：graph_community / graph_hyperedges 诚实化的最小实现面

**graph_community**（`src/panoramic/graph/graph-query.ts:741-757`，`getCommunity` 方法）：

不改变返回值结构（仍是 success 响应、`nodes: []`、`cohesion: null`），只改 `message` 的生成逻辑——遍历节点时额外统计"图中是否存在任意 `metadata.community` 值"：

```ts
let anyCommunityDataExists = false;
for (const node of this.nodeMap.values()) {
  if (node.metadata['community'] !== undefined) anyCommunityDataExists = true;
  if (node.metadata['community'] === communityId) communityNodes.push(node);
}
if (communityNodes.length === 0) {
  return {
    communityId,
    nodes: [],
    cohesion: null,
    message: anyCommunityDataExists
      ? `未找到社区 ID「${communityId}」：图中存在其他社区数据，请检查 ID 是否正确（数字字符串，如 "0"）`
      : '本图不包含任何社区划分数据（尚未运行 `spectra community`）。请先运行该命令生成社区划分后再查询。',
  };
}
```

**为什么不引入新的 error code**：`graph_community` 当前是"成功响应携带诊断性 message"的既有设计（`tests/e2e/feature-180-graph-tools.e2e.test.ts:190` 断言 `isError` 不为 `true`），改为 error 响应属于契约变更，超出"诚实化文案"这一低风险定位，且 spec 裁决 A 明确"不修活、不下架"，只做诚实化文案。

**graph_hyperedges**（`src/mcp/graph-tools.ts:389-415`，`graph_hyperedges` handler）：

不改 `GraphQueryEngine.getHyperedges()` 方法签名（YAGNI，避免新增 engine 方法），在 handler 内对空结果追加纯函数计算的 `message` 字段：

```ts
function describeEmptyHyperedges(filtered: boolean): string {
  return filtered
    ? '过滤条件（label/node_id）未匹配到任何超边；若怀疑本图完全没有超边数据，请去掉过滤参数重试。'
    : '本图不包含超边数据：hyperedges 仅在 full mode 且显式 opt-in（--hyperedges 或 SPECTRA_HYPEREDGES_ENABLED=true）且存在 projectDocs 三者同时满足时生成。';
}
```

该函数导出为模块级纯函数（`export function describeEmptyHyperedges`），便于直接单测而不必驱动完整 MCP handler。handler 内 `hyperedges.length === 0` 时把 `message: describeEmptyHyperedges(filtered)` 加入返回对象。

### 决策 4：`prepare` 前置校验的实现位置（FR-014）

在 `src/mcp/server.ts` 的 `prepare` 工具 handler 内（:109-138 区间），于 `const result = await prepareContext(...)` **之前**插入存在性校验，复用已导入的 `statSync`/`resolve`：

```ts
const resolvedTarget = resolve(targetPath);
try {
  statSync(resolvedTarget);
} catch {
  return buildErrorResponse(
    'file-not-found',
    `目标路径不存在: ${targetPath}`,
    '请检查 targetPath 是否正确（支持绝对路径或相对于当前工作目录的相对路径）',
  );
}
```

**不复用 `resolveSafePath`**（`file-nav-helpers.ts`）——该函数强制根内边界（返回 `path-outside-root`），会给 `prepare` 引入历史上不存在的限制，FR-014 明确 MUST NOT 新增该校验。这里刻意使用"更弱"的 `statSync` 校验，仅解决"存在性"这一个诊断维度。

**为什么不改 `telemetry.ts:134-142`**：那是顶层未预期异常的脱敏安全网（withTelemetry 装饰器），本改动是在到达该 catch 之前就短路返回，两者是"前置校验"与"兜底安全网"的分层关系，互不冲突（FR-015 保持不变）。

---

## Open Questions 裁决（spec 阶段遗留，本 plan 阶段拍板）

### Q1：pinned e2e fixture 是否按 F214/F215 约定重新生成

**裁决：不重新生成。**

**理由**：
1. `tests/fixtures/micrograd-baseline-graph/graph.json` 等 pinned fixture 是**测试输入**（F215 解耦后消费测试用它模拟"已有图"这一前置状态），而非生产输出的断言基线。重新生成不会让任何现有测试变红或变绿，纯粹是"是否顺带获得端到端覆盖"的成本收益判断。
2. 重新生成 fixture 会牵连 `tests/integration/agent-context-real-graph.test.ts`、`tests/integration/mcp-server-stdio.test.ts`、`tests/integration/graph-quality-lang-matrix.test.ts`、`tests/e2e/helpers/stdio-client.ts` 等消费方——这些测试当前对 fixture 的节点数量、边数量等做精确断言（F215 pinned 的设计目的就是保证这些数字不随生产代码变化而漂移）。重新生成会迫使这些断言全部重新核对，验证面从"US1 一个 FR 链路"扩散到"至少 4 个不相关测试文件的断言重写"，与 spec 复杂度评估的 MEDIUM 定位及"表面清扫"低风险定位相悖。
3. 已有等价覆盖手段：
   - **新增单测**（构造最小 `CodeSkeleton` → 调 `deriveNodesFromSkeletons`/`buildUnifiedGraph` → 断言 `metadata.lineRange` 形状与数值），直接覆盖 FR-001~004 的生产与传递逻辑，且比 e2e 更精确（e2e 只能断言"字段存在"，单测可以断言"值等于源码中构造的确切行号"）。
   - **外部语料 A/B**（`karpathy/micrograd` baseline，改动前后各建图一次），同时满足 FR-005（Python 第四路验证盲区，本仓活图 `sourceTag='extraction'` 的 symbol 节点数为 0）与"图解析类改动验收须带外部语料 A/B"的仓库口径，一次跑批满足两项要求。

**推论（写入验收，供 implement/verify 阶段核对）**：lineRange 在 pinned fixture 中的缺席**不构成测试红**——所有消费这些 fixture 的现有测试均未对 `metadata.lineRange` 做任何断言（正向或负向）。implement 阶段的负面校验义务：**不得**为了"让 pinned fixture 看起来支持新字段"而顺手改动这些 fixture 文件（改了反而会触发 F215 pinned 断言连锁反应，越权）。

### Q2：退出码语义表落点

**裁决：落在 `docs/spectra-cli-reference.md`，新增独立章节 `## Exit Codes`（放在文档末尾或 Troubleshooting 附近）。**

**理由**：
1. 该文档本卡本身就要修改（FR-024 `--output-dir` 修正、FR-025/026 补齐子命令、FR-027 工具计数），退出码语义表与这些内容同属"CLI 使用者查阅参考"的同一心智模型，放在同一份文档避免用户需要在两份文档间跳转。
2. 内容量级仅 6-7 行表格 + 1 条已知例外说明，独立开一份 `docs/spectra-exit-codes.md` 属于"以后可能需要更多退出码文档"的假设性抽象，违反 Constitution 原则 III（YAGNI）——三行表格不需要单独文件。
3. `README.md` 顶层文档面向"5 分钟上手"读者，退出码属于进阶排障信息，不适合放在 README（保持 README 精简）。

**表格内容**（供 implement 阶段直接落地，7 行）：

| # | 退出码 | 语义 | 代码位置 |
|---|---|---|---|
| 1 | 2 | LLM/API 错误 | `error-handler.ts:15`（`API_ERROR`），用于 :100 |
| 2 | 2 | 未分类错误兜底 | `error-handler.ts:113` |
| 3 | 2（不固定，视具体 catch 而定） | 顶层未捕获致命错误 | `cli/index.ts:240` |
| 4 | 1 | 目标路径不存在（`TARGET_ERROR`） | `error-handler.ts:13`；`prepare.ts:40`、`diff.ts:28,33`、`index.ts:101`（本次由 2 改为 1，FR-022） |
| 5 | 2 | 索引执行失败（`spectra index` 全量/增量） | `index.ts:193,257` |
| 6 | 2 | 成功但有残缺（部分源失败，已落成功部分） | `scaffold-kb.ts:251` |
| 7 | **2**（`cannot-assess`）/ **1**（`fail-strong-invariant`，⚠️ 已知例外：方向与上述"1=目标错误/2=致命"约定相反，因 F266 测试固化 + 独立语义域，本次不修改） | `graph-quality` 专属判定 | `graph-quality.ts:870-873` |

---

## 验证策略

### Level 0（纯文档）

以下文件的改动为纯文本核对，无需运行时验证：`README.md`、`plugins/spectra/README.md`、`docs/spectra-cli-reference.md`、`skills/*/SKILL.md`、`src/skills-global/*/SKILL.md`、`plugins/spectra/skills/*/SKILL.md`、`contracts/release-contract.yaml`。验证方式：逐条对照 spec 的 Acceptance Scenario 目视核对 + 全仓 grep 确认旧文案（如 `"c-0"`、`--output ` 非 `--output-dir`、`17 MCP tools`、`spectra index` 误导性提及）清零。

### Level 1（单元测试，需同一提交内新增测试）

| 改动 | 新增/追加测试文件 | 断言要点 |
|---|---|---|
| 决策 1①（knowledge-graph） | `tests/unit/knowledge-graph/module-derivation.test.ts` | symbol 节点 `metadata.lineRange = {start, end}` 值等于构造 fixture 中的 `startLine`/`endLine`；member 节点 `metadata` 不含 `lineRange` key（`expect('lineRange' in node.metadata).toBe(false)`） |
| 决策 1②（python-adapter） | `tests/adapters/python-adapter.test.ts` | 追加用例：构造含具名函数的 Python fixture，断言 `extractSymbolNodes` 产出节点的 `metadata.lineRange` |
| 决策 1③④（graph-builder） | `src/panoramic/graph/graph-builder.test.ts` | 构造含 `metadata.lineRange` 的 `UnifiedNode`，分别验证"新节点"与"已有节点补齐"两条路径都透传该字段到 `GraphNode.metadata` |
| 决策 3（graph_community） | 新增 `tests/panoramic/graph-query-community-honesty.test.ts` | 场景 A：图中无任何 `metadata.community` → message 含"未运行"；场景 B：图中有其他社区但查询 ID 未命中 → message 含"未找到社区 ID"且不含"未运行" |
| 决策 3（graph_hyperedges） | 追加 `tests/panoramic/graph-tools-v2.test.ts` | 导出的 `describeEmptyHyperedges(filtered)` 纯函数：`filtered=false` 与 `filtered=true` 两种输入对应的文案关键词 |
| 决策 4（prepare 前置校验） | 追加 `tests/unit/mcp/response-contract.test.ts`（既有 `it` 块之后，紧邻 :157-163 的 prepare 用例） | 新增 1 个 `it`：`targetPath` 为 `join(emptyRoot, 'does-not-exist')` → `code === 'file-not-found'` 且 message 含该路径；**不修改**既有 `it('prepare 顶层异常错误响应含 code（internal-error）')` 用例 |
| FR-013（graph-not-built 措辞统一） | 新增 `tests/unit/mcp/graph-not-built-messaging.test.ts`（或追加到 `file-nav-tools.test.ts`） | 触发 5 处 stale 消息，断言均不含 `'spectra index'` 子串，且含 `'graph-only'` |
| FR-022（index.ts 退出码） | 追加 `tests/integration/156-w2-spectra-index.test.ts` | 新增用例：`projectRoot` 指向不存在目录 → `process.exitCode === 1`（当前无此分支的测试覆盖，需新增而非修改既有断言） |

**测试放置原则**：优先追加到已存在的同模块测试文件（`module-derivation.test.ts`、`graph-builder.test.ts`、`python-adapter.test.ts`、`response-contract.test.ts`、`graph-tools-v2.test.ts`、`156-w2-spectra-index.test.ts`），仅在确无同类既有文件时新建（`graph-query-community-honesty.test.ts`、`graph-not-built-messaging.test.ts`）。**不修改任何既有断言的期望值**，只新增 `it`/`describe` 块。

### byte-stable 验证（SC-001，本仓自图）

```bash
npm run build
node dist/cli/index.js batch --mode graph-only
sha256sum specs/_meta/graph.json > /tmp/f271-run1.sha256
node dist/cli/index.js batch --mode graph-only
sha256sum specs/_meta/graph.json > /tmp/f271-run2.sha256
diff /tmp/f271-run1.sha256 /tmp/f271-run2.sha256 && echo "BYTE-STABLE: PASS" || echo "BYTE-STABLE: FAIL"
```

⚠️ 执行前提（F251/F259 教训）：若此前删过 `dist/`，必须先 `npm run build` 生成全新 dist 再跑上述两次 batch——两次 batch 必须用**同一份 build 产物**，不能中途重新 build（避免把"代码差异"和"build 差异"混为一谈）。

### 外部语料 A/B（覆盖 FR-005 验证盲区 + 图解析类改动仓库口径）

```bash
# 1. 确保 micrograd baseline 已 clone（若无）
[ -d ~/.spectra-baselines/karpathy/micrograd ] || bash scripts/baselines/clone-baseline-projects.sh

# 2. 改动前：checkout 到基线 commit f7a65aa9 建一次图（作为 before）
git stash  # 或用 worktree 快照，保证改动前代码状态
node dist/cli/index.js batch --mode graph-only --project-root ~/.spectra-baselines/karpathy/micrograd
cp ~/.spectra-baselines/karpathy/micrograd/specs/_meta/graph.json /tmp/f271-micrograd-before.json
git stash pop

# 3. 改动后：重新 build + 建图（作为 after）
npm run build
node dist/cli/index.js batch --mode graph-only --project-root ~/.spectra-baselines/karpathy/micrograd
cp ~/.spectra-baselines/karpathy/micrograd/specs/_meta/graph.json /tmp/f271-micrograd-after.json

# 4. diff 限定：只应新增 lineRange 字段，节点/边数量零变化
node -e "
const before = require('/tmp/f271-micrograd-before.json');
const after = require('/tmp/f271-micrograd-after.json');
console.log('nodes:', before.nodes.length, '->', after.nodes.length);
console.log('links:', before.links.length, '->', after.links.length);
const lineRangeCount = after.nodes.filter(n => n.metadata && n.metadata.lineRange).length;
console.log('nodes with lineRange (after):', lineRangeCount);
"
```

**验收标准**：`nodes.length`/`links.length` before/after 完全相等；`after` 中 `lineRange` 出现数 > 0（证明 Python 第四路确实产出该字段，闭环 FR-005 的验证盲区）。

### Level 2（集成/e2e，不新增，仅确认既有不回归）

`npx vitest run tests/e2e/feature-180-graph-tools.e2e.test.ts` 与 `tests/unit/mcp/response-contract.test.ts` 全量跑通即视为契约面无回归（这两个文件覆盖了本次改动触碰的全部 MCP 工具契约面）。

---

## 改动文件清单（供 implement 阶段 `git add` 显式路径）

### 代码文件

```
src/knowledge-graph/index.ts
src/adapters/python-adapter.ts
src/panoramic/graph/graph-builder.ts
src/panoramic/graph/graph-query.ts
src/mcp/graph-tools.ts
src/mcp/server.ts
src/mcp/file-nav-tools.ts
src/mcp/agent-context-tools.ts
src/cli/commands/graph-quality.ts
src/cli/commands/index.ts
```

### 测试文件（新增/追加）

```
tests/unit/knowledge-graph/module-derivation.test.ts
tests/adapters/python-adapter.test.ts
src/panoramic/graph/graph-builder.test.ts
tests/panoramic/graph-query-community-honesty.test.ts   # 新建
tests/panoramic/graph-tools-v2.test.ts
tests/unit/mcp/response-contract.test.ts
tests/unit/mcp/graph-not-built-messaging.test.ts        # 新建
tests/integration/156-w2-spectra-index.test.ts
```

### 文档文件

```
README.md
plugins/spectra/README.md
docs/spectra-cli-reference.md
skills/spectra-batch/SKILL.md
skills/spectra/SKILL.md
src/skills-global/spectra-batch/SKILL.md
src/skills-global/spectra/SKILL.md
plugins/spectra/skills/spectra-batch/SKILL.md
plugins/spectra/skills/spectra/SKILL.md
contracts/release-contract.yaml
```

**禁止**：`git add -A`。implement 阶段每个 commit 必须显式列出上述路径子集。

---

## 风险与回滚

### BEHAVIOR_VERSION 裁决：**不 bump**

`src/panoramic/graph/collector-fingerprint.ts:105-135` 定义的 `BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES` 六类条件是：`ignore-dirs-pruning`（忽略目录剪枝）、`gitignore-interpretation`（.gitignore 解释）、`case-matching-strategy`（大小写匹配）、`symlink-handling`（symlink 处理）、`file-size-guard`（文件大小阈值）、`collection-failure-degradation`（采集失败降级）。这六类全部回答"**哪些文件/内容被纳入采集**"这一问题。

lineRange 字段的新增不改变任何一类：它不影响文件遍历范围、不影响 gitignore 判定、不影响大小写匹配、不涉及 symlink、不涉及文件大小阈值、不涉及采集失败降级策略——它只是对**已经被采集的 symbol 节点**追加一个从已解析 AST span 直接读取的元数据字段。既有图（无 lineRange）与新图（有 lineRange）代表的是同一份"采集面"，只是元数据更丰富，不构成 F259/F252 先例中"采集口径变化导致旧图语义作废"的情形。

**结论**：不修改 `BEHAVIOR_VERSION` 常量，不新增 bump 记录条目。

### charter/守护快照影响排查

- `tests/e2e/f220-decomposition-charter.e2e.test.ts`：与 batch-orchestrator 五段拆分（F220）相关，不涉及 graph metadata key 枚举，**不受影响**。
- `tests/integration/builder-stamp-e2e.test.ts`：与 builder 戳（F261/M10 裁决"builder 戳只可见不判定"）相关，不涉及 lineRange，**不受影响**。
- `normalizeGraphForWrite`（`graph-builder.ts:814-846`）的 `RUNTIME_NODE_METADATA_FIELDS = ['currentRun']` 剥除清单**不包含** `lineRange`，字段会被正常持久化写盘，不会被误剥（已在决策 1 中确认）。

### 回滚策略

本次改动无数据库/schema 迁移，无破坏性 API 变更（唯一行为变更 FR-022 退出码，影响面已确认为空）。若 byte-stable 验证或外部语料 A/B 发现回归，回滚粒度为**单个写入点**（4 个 lineRange 写入点相互独立，可单独 revert 而不影响其余 3 个），不需要整体回滚。

---

## Project Structure

### Documentation（本 feature）

```text
specs/271-product-surface-sweep/
├── spec.md
├── plan.md              # 本文件
├── tasks.md             # 下一步产出
└── research/
    └── precheck-ledger.md
```

### Source Code（无新增目录，定点修改既有文件，见"改动文件清单"）

**Structure Decision**：不新增独立模块/组件，全部改动落在既有目录结构内（`src/knowledge-graph/`、`src/panoramic/graph/`、`src/adapters/`、`src/mcp/`、`src/cli/commands/`）。

## Complexity Tracking

无需填写——Constitution Check 无 VIOLATION。
