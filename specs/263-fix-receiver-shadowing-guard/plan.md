# F263 修复规划 — receiver 类型定位本地导出分支缺失遮蔽守卫

## 摘要

`fix-report.md` 已定稿方案 A：`locateClassFile` 分支 (a)（本地导出路径）当前零守卫，
把「名字在本文件导出表里」误当成「调用点这个名字绑定到该导出符号」，在局部类 / 泛型形参 /
局部 const 等**词法遮蔽**形态下产出确定性假边。修复路径是把 mapper 侧已经算出的「纯遮蔽计数」
（`total===1`，不要求来自 import）surface 给分支 (a)，与分支 (b) 现有的 `soleImportBinding`
判据对称收紧。本规划只覆盖方案 A 的落地细节，架构决策与替代方案评估已在 fix-report.md 定稿，
不重复展开。

**影响面（已用 `mcp__plugin_spectra_spectra__impact` 核实）**：`resolveReceiverTypeCall` 唯一
调用方是 `call-resolver.ts`（riskTier: low，1 个直接 caller，0 个 transitive）。全仓
`receiverTypeSoleImportBinding` 命中 13 个文件，其中生产代码 4 个（`call-site.ts` /
`receiver-type-resolution.ts` / `typescript-receiver-env.ts` / `typescript-mapper.ts`）、
测试 2 个（`call-resolver.test.ts` / `typescript-mapper-callsite.test.ts`）、其余为 F260 历史
spec 文档与一个未接入 CI 的一次性验证脚本（详见「不做什么」）。改动面小、集中、无跨包影响。

## Codebase Reality Check

| 文件 | LOC | 本次改动量 | 已知 debt |
|------|-----|-----------|-----------|
| `src/knowledge-graph/receiver-type-resolution.ts` | 177 | ~6 行（1 处判据 + 1 处注释重写） | 无 TODO/FIXME；单一职责，无需前置 cleanup |
| `src/core/query-mappers/typescript-receiver-env.ts` | 651 | ~4 行（1 个接口字段 + 1 个方法 + 1 处 `bind()` 组装） | 无 TODO/FIXME；文件较大但改动点局部、不触发前置清理阈值（新增 < 50 行） |
| `src/core/query-mappers/typescript-mapper.ts` | 1405 | 1 行（`_mkCallSite` 内新增一次字段写入） | 无 TODO/FIXME；改动点在既有「三字段同源写入」代码块内 |
| `src/models/call-site.ts` | 103 | ~10 行（1 个 optional 字段 + doc comment） | 无 TODO/FIXME |

四个文件均未触发前置清理规则（无一超 500 LOC 且新增 > 50 行，无 ≥3 条相关 TODO，无重复逻辑）。
不新增 `[CLEANUP]` task。

## Impact Assessment

- **影响文件数**：直接修改 4 个生产文件 + 2 个测试文件；间接受影响（`resolveReceiverTypeCall`
  唯一 caller）1 个（`call-resolver.ts`，仅调用点不变的透传，无需改代码，只需在其既有测试套件
  重跑中确认零回归）。
- **跨包影响**：0（全部落在 `src/knowledge-graph` + `src/core/query-mappers` + `src/models` 同一
  「knowledge-graph 采集/解析」子域内，未跨越 `plugins/` / `scripts/` 等顶层边界）。
- **数据迁移**：无 schema breaking change——新增字段是 `optional()`，旧 baseline JSON 反序列化
  不受影响；不涉及配置格式或状态文件格式变更。
- **API/契约变更**：`CallSiteSchema` 新增一个可选字段，向后兼容；不修改任何公开 CLI / MCP /
  agent prompt 协议；`resolveReceiverTypeCall` 函数签名不变。
- **风险等级：LOW**（影响文件 6 个 < 10，跨包影响 0，无数据迁移，字段级新增而非契约变更）。
  按判定规则不强制分阶段，本规划仍拆成「mapper 侧 surface」→「resolver 侧消费」两个可独立验证的
  子步骤（见下方变更清单顺序），但不作为正式 Phase 门禁。

## 变更清单

### 1. `src/core/query-mappers/typescript-receiver-env.ts`

- **`ReceiverBinding` 接口**（现 L41-47）新增字段 `soleBinding: boolean`，doc comment：
  `/** 该类名在本文件恰好 1 个绑定点（不要求来自 import；纯遮蔽计数，供本地导出分支使用） */`。
  与既有 `soleImportBinding` 字段并列，两者语义在 doc comment 里显式对照区分。
- **`ReceiverTypeEnv` 接口**（现 L49-55）新增方法 `isSoleBinding(className: string): boolean`，
  doc comment：`/** 表 1 查询：纯遮蔽判据（恰好 1 个绑定点，不问来源）。 */`，与既有
  `isSoleImportBinding` 并列声明。
- **`buildReceiverTypeEnv` 返回对象**（现 L540-548）在 `isSoleImportBinding` 旁新增
  `isSoleBinding(className) { const slot = nameBindings.get(className); return slot !== undefined && slot.total === 1; }`
  —— 复用同一张表 1（`nameBindings`），不新增数据结构，只是对同一个 slot 取不同的判据组合。
- **`bind()` 私有函数**（现 L646-650）组装 `ReceiverBinding` 时同源新增
  `soleBinding: env.isSoleBinding(className)`，与既有 `soleImportBinding` 同一行同一处写入
  （保持「不存在半开组合」的不变量——两个字段永远一起产出或一起缺席）。

### 2. `src/models/call-site.ts`

- **`CallSiteSchema`**（现 L100 之后）新增：
  ```ts
  /**
   * `receiverType` 那个类名在**本文件内恰好 1 个绑定点**（不要求来自 import）— F263 新增。
   *
   * 与 `receiverTypeSoleImportBinding` 的区别：后者是 import 表可信度的**正向许可**语义
   * （`total===1 && fromImport===1`），只服务分支 (b)；本字段是**纯遮蔽计数**
   * （`total===1`，不问绑定来源），服务分支 (a)——「名字在本模块导出表里」这一路径要回答的
   * 不是「import 表能不能信」，而是「这个名字在调用点所在文件有没有被别的绑定遮蔽」。
   *
   * **`undefined` 按 `false` 处理**（fail-closed，与 `receiverTypeSoleImportBinding` 逐字
   * 对齐）：字段缺席只可能来自旧 baseline 或非 TS/JS mapper，此时遮蔽状态无从判断，必须拦住。
   * 与 `receiverType` / `receiverTypeSoleImportBinding` 由同一处（`typescript-mapper.ts`
   * `_mkCallSite`）同源产出，不存在「其余字段有值、本字段缺席」的半开组合。
   */
  receiverTypeSoleBinding: z.boolean().optional(),
  ```
  字段名定稿为 **`receiverTypeSoleBinding`**（理由见下）。

### 3. `src/core/query-mappers/typescript-mapper.ts`

- `_mkCallSite`（现 L1397-1401）在既有「F260：两个字段同源产出」代码块内新增第三行：
  ```ts
  if (receiver !== undefined) {
    cs.receiverType = receiver.receiverType;
    cs.receiverTypeSoleImportBinding = receiver.soleImportBinding;
    cs.receiverTypeSoleBinding = receiver.soleBinding;
  }
  ```
  三字段共享同一个 `if (receiver !== undefined)` 守卫，物理上不可能出现"部分字段有值"的组合，
  延续 F260 已确立的写入模式，不新增分支。

### 4. `src/knowledge-graph/receiver-type-resolution.ts`

- **`locateClassFile` doc comment**（现 L157-163）改写：删除「类名在 caller 自己的导出表里时，
  它指的必然是本模块那个符号」这句——fix-report 5-Why 已证明该假设在局部绑定遮蔽下不成立，
  必须删除而非保留加注。替换为：

  > 两条来源互斥，本模块导出优先于 import 表。但"名字在本模块导出表里"只回答"文件级导出
  > 可见性"，回答不了"调用点这个名字当前绑定到谁"——命中本地导出后仍必须查 `receiverTypeSoleBinding`
  > 确认该名字在本文件没有被局部绑定（局部类 / 泛型形参 / 局部 const 等）遮蔽；遮蔽或判据缺席
  > 一律整体弃权，不 fallthrough 到 import 分支（理由见下）。走 import 表则维持原有三道闸
  > （A1 + D1 + A2）。

- **`locateClassFile` 函数体**（现 L164-176）分支 (a) 由

  ```ts
  if (ctx.moduleSymbolIndex.get(cs.callerFile)?.has(receiverType)) return cs.callerFile;
  ```

  改为

  ```ts
  if (ctx.moduleSymbolIndex.get(cs.callerFile)?.has(receiverType)) {
    // 与分支 (b) 的 A1 判据对称：`undefined` 按「有遮蔽」处理（fail-closed）。
    // 命中本地导出但判为遮蔽时必须整体弃权（return null），不得 fallthrough 到
    // 下面的 import 分支——本模块确实有这个导出符号是真事实，但它不是调用点这个名字
    // 绑定的目标；把答案交给 import 表另一个可能存在的同名绑定，是在「已知本地答案不可信」
    // 的前提下伪造一个新的确定性来源，属于新造的一类假边（可能连到与调用点毫不相关的
    // 第三个文件），比"当前弃权、少一条边"更差。
    return cs.receiverTypeSoleBinding === true ? cs.callerFile : null;
  }
  ```

## 判据落点与控制流

- 判据落点单一：只改 `locateClassFile` 分支 (a) 这一处返回值。`resolveReceiverTypeCall` 主体
  （①-⑥ 六条件与门）与分支 (b) 完全不动。
- **控制流铁律**：分支 (a) 命中本地导出但 `receiverTypeSoleBinding !== true` 时，函数在
  `locateClassFile` 内部直接 `return null`，`resolveReceiverTypeCall` 的调用点
  （`const classFile = locateClassFile(...); if (classFile === null) return null;`，现 L139-140）
  据此整体弃权。**禁止**任何形式的"分支 (a) 未过闸 → 继续往下试探分支 (b)"逻辑——两条来源在
  函数体里本就是 `if...return` / 后续代码的互斥结构（原实现如此，本次不改变这个结构，只是让
  分支 (a) 的 `if` 内部多一层判断），fallthrough 需要额外新写代码把 (a) 的判定结果和 (b) 的判定
  结果拼起来，这是本次修复主动不做的事。
- **为什么 fallthrough 是新造假边面**：分支 (a) 判定「本模块有这个导出符号，但调用点这个名字
  被局部绑定遮蔽了」是一个确定性结论——不是"查不到"，而是"查到了但知道它不适用"。若把这个
  已知结论丢弃、转而去问 import 表"这个名字有没有唯一 import 绑定"，等于在同一个 `resolveOne`
  调用里对同一个 `receiverType` 问了两次不同的问题并采信后一个答案；import 表给出的答案与
  调用点实际绑定的局部符号毫无关系（大概率是另一个完全不相关的第三方类），产出的边比现状
  更具误导性（现状是"确定性假边连到本模块内某个同名类"，fallthrough 后是"确定性假边连到
  任意第三方模块的同名类"，误导半径更大）。

## fail-closed 语义

- `cs.receiverTypeSoleBinding === true`（严格 `true` 而非真值判断）— 与分支 (b) 现有
  `cs.receiverTypeSoleImportBinding !== true` 逐字对齐的保守优先原则：`undefined` / `false`
  一律按"有遮蔽"处理。
- 触发 `undefined` 的两种真实场景：
  1. **旧 baseline**：F263 之前产出的图数据反序列化后该字段不存在。
  2. **非 TS/JS mapper**：`receiverType` 本就只由 TS/JS mapper 产出（fix-report 已用 grep 核实
     `src/core/query-mappers/` 下只有 `typescript-mapper.ts:1399` 写该字段），但由于分支 (a)
     的判定在 `receiverType` 存在（条件 ①）之后才执行，理论上不会有"receiverType 有值但
     mapper 不是 TS/JS"的组合——此分支列出仅为完整性，实际生效路径是场景 1。
- 代价如实登记：旧 baseline 上分支 (a) 整体停摆（少出边，不出错边），直到重新跑一次采集补上
  新字段。这与 fix-report 对方案 A 的取舍描述一致，不重新论证。

## 红先行用例清单

### resolver 层（`tests/unit/knowledge-graph/call-resolver.test.ts`）

新增一个 `describe` 块，紧邻现有 F260 用例表之后：

1. **R13（假边 ①，须证伪）— 局部类遮蔽同名导出类，`receiverTypeSoleBinding=false` ⇒ 不出边**：
   构造 `callerTs` 导出 `class Task { run(){} }`；`callSite` 里
   `receiverType: 'Task'`, `receiverTypeSoleBinding: false`（模拟遮蔽事实已被 mapper 算出）。
   断言 `edges` 不含任何 `target` 以 `caller.ts::Task.` 开头的边，且整体 `toEqual([])`
   （六条件与门在分支 (a) 就整体弃权，不会 fallthrough 产生任何其他边）。
2. **R14（假边 ②，须证伪）— 泛型形参遮蔽同名导出类，同款断言**：同构 R13，用于覆盖
   fix-report 复现案例②的场景（`fixture` 层面等价，resolver 层只需 `receiverTypeSoleBinding=false`
   即可覆盖，不需要重建泛型 AST）。
3. **R15（对照真边，须保留）— 本模块导出命中且无遮蔽，`receiverTypeSoleBinding=true` ⇒ 照常
   出边**：与 R13 同一个 `callerTs`（导出 `class Task`），`callSite` 改为
   `receiverTypeSoleBinding: true`，断言产出
   `{ source: 'caller.ts::schedule', target: 'caller.ts::Task.run', relation: 'calls', confidence: 'medium', directional: true }`。
   这是本次修复**必须不能误伤**的正向路径——证明新判据只挡遮蔽形态，不挡真实的本地导出调用。
4. **R16（fail-closed 回归钉）— `receiverTypeSoleBinding` 字段缺席（模拟旧 baseline）⇒ 分支 (a)
   弃权，`toEqual([])`**：复用 R13 的 caller 与导出结构，`callSite` 里刻意不写
   `receiverTypeSoleBinding`，断言不出边——验证 `=== true` 严格比较而非 `!== false`。
5. **R17（禁止 fallthrough 回归钉）— 遮蔽 + 恰好同名 import 目标存在时，不得连到 import 目标**：
   构造 `x.ts` 导出同名 `Task` 且带另一方法 `otherMethod`；`caller.ts` 同时 `import { Task } from './x.js'`
   且自己也 `export class Task { run(){} }`（本地导出优先分支必然先命中）；`callSite` 设
   `receiverType: 'Task'`, `receiverTypeSoleBinding: false`,
   `receiverTypeSoleImportBinding: true`（import 侧判据刻意给 true，制造"若 fallthrough 会
   命中 x.ts"的陷阱）。断言 `edges` 中不存在任何 `target` 以 `x.ts::Task.` 开头的边，且整体
   `toEqual([])`——证明分支 (a) 判定遮蔽后是硬 `return null`，而不是把控制权交还给
   `resolveReceiverTypeCall` 主体去尝试 import 路径。

### mapper 层（`tests/unit/typescript-mapper-callsite.test.ts`）

紧邻现有 `M10` / `M10b` / `M10c` 用例（同一个 `describe('F260 P3 — 歧义弃权与 A1 绑定点计数（M8–M10c）')`
块）之后新增：

6. **M10d — 分支 (a) 的真实复现场景：局部类遮蔽同名导出类，`receiverTypeSoleBinding=false`
   （但 `receiverTypeSoleImportBinding` 语义不适用/无关）**：
   ```ts
   export class Task { run(): void {} }
   export function schedule(): void {
     class Task { run(): void {} }
     const t = new Task();
     t.run();
   }
   ```
   断言 `findCall(callSites, 'run', 't')?.receiverType === 'Task'` 且
   `receiverTypeSoleBinding === false`（`total===2`：外层导出声明 + 内层局部声明各计一次，
   与表 1 现有计数逻辑天然吻合，不需要新增任何 AST 遍历分支）。这条用例就是 fix-report
   案例①的最小复现，直接钉在 mapper 抽取层。
7. **M10e — 字段语义分歧样本（复用 M10c 子样本 2 的场景，指标不同）**：
   ```ts
   declare const Foo: unknown;
   export function use(p: Foo): void { p.m(); }
   ```
   断言 `receiverTypeSoleImportBinding === false`（非 import 来源，M10c 已覆盖）**且**
   `receiverTypeSoleBinding === true`（`total===1`，不问来源）——用一个已有场景实证两个字段
   的语义确实不同，防止未来有人把 `isSoleBinding` 误实现成 `isSoleImportBinding` 的别名。
8. **M10f — 正向保真：唯一绑定且来自 import 时两字段同为 true（不得因新字段引入而破坏既有
   `M1` 场景）**：复用 `M1` 的样本
   （`import { Foo } from './a.js'; const a = new Foo(); a.m();`），断言
   `receiverTypeSoleImportBinding === true` 且 `receiverTypeSoleBinding === true`——两字段在
   "唯一绑定 + 来自 import"这一交集场景下必须同时为 true，防止新增字段计算错误的绑定点集合。

### 端到端（graph-only pipeline，人工/CI 均可执行）

9. 复用 fix-report 已实证的 `scratchpad/repro` fixture（`a.ts` 案例①、`b.ts` 案例②、`c.ts`
   对照真边），本次修复后重跑 `node dist/cli/index.js batch --mode graph-only`，断言：
   - `src/a.ts::schedule -> src/a.ts::Task.run`（INFERRED，假边①）**不再出现**；
   - `src/b.ts::process -> src/b.ts::Handler.run`（INFERRED，假边②）**不再出现**；
   - `src/c.ts::driver -> src/c.ts::Real.go`（对照真边）**仍然出现**，tier 不变。
   此步骤在 implement 阶段作为收尾人工验证，不写成自动化测试（fixture 在 `scratchpad/`，非
   入库 fixture），但必须在 verify 阶段的交付报告里附实测结果。

### 双向覆盖检查

红先行用例清单覆盖矩阵：
- 假边不出边：R13、R14、M10d（3 条，resolver + mapper 双层）
- 对照真边仍出边：R15、M10f（2 条）
- fail-closed 边界：R16（字段缺席）
- 禁止 fallthrough：R17（唯一一条专门证伪"遮蔽后逃逸到 import 分支"的用例，也是本次修复
  最容易被实现错的一处）
- 字段语义分歧实证：M10e

## 回归风险评估

- **误伤真边的形态（已知取舍，如实登记，非本次引入的新问题）**：表 1 是**文件级**计数，
  不感知块级作用域。因此"函数 A 里有一个不相关的局部同名类 `X`、函数 B 里的 `new X().m()`
  实际指的是导出的 `X`"这种形态会被本次新增的判据**误伤弃权**（少一条真边）——因为文件级
  `total` 会数到 2（导出声明 + 函数 A 的局部声明），即使函数 B 里的调用点跟函数 A 的局部类
  毫无关系。这与 `typescript-receiver-env.ts` 文件头已登记的 R-8（"文件级环境歧义即弃权"）
  是同一款既定取舍，方向一致（纯 recall 损失，无 precision 风险），本次不重新论证、不试图
  做块级作用域收紧（那需要 resolver 侧拿到调用点所在函数体的局部符号表，改动面远超本卡，
  等价于 fix-report 已否决的方案 B）。
- **生产图验证口径**：修复后在 self-dogfood baseline 上重跑 `spectra batch --mode graph-only`，
  核对 `method` 节点的 calls 入边数保持 238（F260 验收口径，见 fix-report 与
  `specs/260-.../verification/` 制品）、method 覆盖率 236/517 不变——这两个数字锚定的是
  "本次判据只挡新构造的遮蔽反例，不影响生产代码库里已验证过的真实调用边集合"。若重跑后
  这两个数字发生变化，必须先定位是否命中了上面登记的"文件级误伤"取舍面，若是则符合预期
  不算回归；若数字下降幅度超出个位数级别，需要暂停并重新核实判据实现。
- **不会引入的风险**：字段是 `optional()`，不改变任何既有必填字段的语义；不修改
  `resolveReceiverTypeCall` 的六条件与门主体；不修改分支 (b)（import 路径）任何一行；
  不新增 AST 遍历逻辑（表 1 `nameBindings` 已有的计数机制原样复用）。

## 不做什么（明确排除项）

- **不改 `call-resolver.ts` Stage 1（L580-589 free 分支）与 Stage 2（L635 类启发式本地命中）**：
  fix-report 已确认两者是同根因假边家族（同款"本地导出表命中即出边、无作用域判据"），但修复
  需要作用域级 caller 环境（当前 mapper 只有文件级表），改动面远超本卡，已登记为残余风险
  **F263-R-3**，留作后续 Feature 候选，本次不动。
- **不 bump `BEHAVIOR_VERSION`**：fix-report「BEHAVIOR_VERSION / collector 指纹评估」章节已论证
  ——本次改的是边解析语义，不属于 `BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES` 六类"哪些文件被计入
  采集"维度中的任何一类，且有 F260（改动幅度更大的同类边语义变更）未 bump 的先例对齐。本规划
  不重复论证，不新增 bump。
- **不加 `fromImport===0` 额外收紧**：fix-report 已用探针实测证明
  `import { Foo } from './x'; export { Foo }` 形态下 `moduleSymbolIndex` 不含 re-export 产生的
  符号（节点派生与符号索引两侧同款跳过），分支 (a) 根本不会命中该形态，真正解析走分支 (b)
  并正确落地。加 `fromImport===0` 是无实证收益的额外收紧，违反"不自行添加未要求的优化"，
  不做。
- **不更新 `specs/src.spec.md`**：再生产物，按工程约定排除提交，且本次不新增/变更任何对外
  CLI / MCP 合同。
- **不更新 `specs/260-fix-instance-method-call-edges/verification/callsites-fingerprint.mjs`**：
  该脚本是 F260 交付时的一次性验证工件，未接入 `package.json` scripts 或 CI，其
  `EXCLUDED_FIELDS` 列表只影响历史验证轮次自身的字段级 diff 展示，不影响本次修复的正确性
  判定；若未来需要重跑该脚本核对 F263 前后的字段集合差异，届时按需临时更新，不在本次变更
  清单内。

## 验证方案

- 单元测试：`npx vitest run tests/unit/knowledge-graph/call-resolver.test.ts tests/unit/typescript-mapper-callsite.test.ts`，
  确认新增 9 条用例（R13-R17 + M10d-M10f）全绿，且既有全部用例（尤其 R4/R5/R8/R9/R9b/R10/R10b/R10c/R11/R12
  ——分支 (b) 与既有 fallthrough 语义）零回归。
- 全量测试：`npx vitest run` 零失败。
- 构建：`npm run build` 类型检查零错误（新增字段与方法在 `ReceiverBinding` / `ReceiverTypeEnv`
  / `CallSiteSchema` 三处接口定义同步，避免类型不匹配）。
- 端到端人工核验：见上方「红先行用例清单 §端到端」，implement 完成后在 `scratchpad/` 内复现
  fix-report 的三个 fixture（`a.ts`/`b.ts`/`c.ts`），跑 `graph-only` 模式确认两条假边消失、
  对照真边保留，并将结果写入 verify 阶段交付报告。
- 生产图回归口径：跑 self-dogfood baseline 全量采集，核对 method 入边数 238 / 覆盖率 236/517
  是否保持（允许因「回归风险评估」登记的文件级误伤取舍产生个位数级别的、可解释的下降）。

## Constitution Check

| 原则 | 适用性 | 评估 |
|------|--------|------|
| 只改 `src/**` 源码，不手改 `.codex/**` / `.claude/**` 包装产物 | 适用 | 通过——本规划全部改动落在 `src/knowledge-graph/`、`src/core/query-mappers/`、`src/models/` |
| `verification_policy.require_real_execution=true` | 适用 | 通过——验证方案含真实 `npx vitest run` / `npm run build` 执行，端到端核验用真实 `graph-only` 流水线（非纸面推演，延续 fix-report 已实证的复现方式） |
| 不自行添加未要求的优化 / 不超出 spec 范围 | 适用 | 通过——判据形态、字段命名均直接取自 fix-report 定稿方案 A；`fromImport===0` 额外收紧等衍生优化已在「不做什么」显式排除 |
| 简洁之道 / 零基思维 | 适用 | 通过——复用既有表 1 计数机制，不新增数据结构；`_mkCallSite` 沿用 F260 已确立的"多字段同源写入"模式，不新增分支结构 |

无 VIOLATION，无需豁免。
