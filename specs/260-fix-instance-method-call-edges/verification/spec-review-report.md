# Spec 合规审查报告 — F260（fix 模式 Phase 4a）

> 审查代理会话未授予 Write 工具，本文件由主编排器按其返回全文落盘（内容未改动，仅补此说明行）。

**总体结论：PASS（0 CRITICAL / 5 WARNING / 2 INFO）** — 实现与 fix-report 根因、plan 方案 A 及十轮裁决一致，未发现方案偏离、假边闸门放宽或清单外功能。WARNING 全部集中在**制品/登记面**（tasks 状态、fix-report 措辞、两条收尾任务无产物），不涉及代码正确性。

---

## 1. 修复是否与 fix-report 根因一致 —— PASS

根因（TS/JS 接收者类型推断整环缺失）与实现两端一一对应，源码核对而非转述：

| 根因环节 | 实现落点 | 核对结论 |
|---|---|---|
| 接收者表达式原始文本当 qualifier | `src/core/query-mappers/typescript-receiver-env.ts`（两张表：类名绑定点计数表 + 接收者名→类名环境） | 存在，纯函数、输入 `Parser.Tree` |
| 一遍式导致弃权只对后续生效（H4） | `typescript-mapper.ts:973-981`：`buildReceiverTypeEnv(tree)` 先建环境，`try/finally` 复位 `_receiverEnv` | 两遍式成立 |
| resolver 无消费分支 | `src/knowledge-graph/receiver-type-resolution.ts::resolveReceiverTypeCall`，`call-resolver.ts:599-605` 调用 | 存在 |
| 方案 B（ts-morph TypeChecker） | 全仓无引入 | 未偏离方案 A |

新分支只决定 target 与 tier，`resolveSourceId` 仍在 `resolveOne` 顶部一次性计算（`call-resolver.ts:576`），F242 三级归属回退链未被触碰 —— 与 fix-report §5「二者在 resolveOne 内正交」一致。

## 2. 是否引入 plan 未覆盖的行为变化 —— PASS（含一项方法学限制，见 INFO-2）

`git status` 的改动文件集与 plan §5 变更清单文件集**完全吻合**：

- 源码 6 改 + 2 新建 = 变更 #1–#12 的全部落点，**无第 9 个源文件**。
- 测试 4 改：`typescript-mapper-callsite.test.ts` / `call-resolver.test.ts`（#13/#14）+ `ast-analyzer.test.ts` / `tree-sitter-fallback.test.ts`（由 plan §13 W-C 裁决显式授权，实测内容确为 W-C1/W-C1b/W-C1c 与 W-C2-anchor，无夹带）。
- 明确不改清单核对：`resolveCalls` / `buildUnifiedGraph` 签名未变；`python/java/go-mapper` 未出现在改动集；`graph-builder` 第五路 dedup 未改。
- 未发现顺手重构：既有 `bracketAwareSplit` / `stripGenericParams` 的改动（支持 `<`）是变更 #12 明写项。

## 3. plan 定稿判据的抽查核对 —— 全部 PASS（源码级，非转述）

| 判据 | 源码位置 | 核对结论 |
|---|---|---|
| **A1**（绑定点 ≥2 拦 / =1 非 import 拦 / =0 fail-closed） | `typescript-receiver-env.ts:542-546` `slot.total === 1 && slot.fromImport === 1` | 正向许可语义，三档全拦 ✅ |
| **A2**（default import 弃权） | `receiver-type-resolution.ts:173` `defaultImportAliases.has(...)` → null | ✅（R10c 用例在库） |
| **A3**（宿主分桶 + 弃权面） | `classBucketName`（匿名类 / 带 extends / **类表达式 W-A** 弃权）、`memberHostBucket`（parent 非 `class_body` 弃权）、`resolveThisHostBucket`（普通 function / 静态块 / **static 方法 M2** 弃权），键形态 `ClassName#x` | ✅ 注册侧与查表侧同源分桶 |
| **A4 / W-B** | `assignment_expression` + `augmented_assignment_expression`，左值白名单；`for_in_statement` 走**同一张**白名单（P5b-3） | ✅ 两个入口对称 |
| **A5**（类型形状） | `classNameFromTypeAnnotation`：仅 `type_identifier` / `generic_type.name`，其余一律 null | ✅ 白名单式（强于 plan 的黑名单枚举） |
| **A6**（同一 export 条目） | `receiver-type-resolution.ts:142-144`：`exportByName`（**first-write-wins**，对齐 `deriveNodesFromSkeletons`）取条目 → 查 `entry.kind==='class'` → 查**该条目自己的** `entry.members`；注释显式说明"刻意不复用 last-write-wins 的 `classMemberIndex`" | ✅ R-12 陷阱已规避 |
| **A7**（L379 收窄） | `call-resolver.ts:458` `isTsJs ? exp.kind !== 'class' : (原判据)` | ✅ 非 ts/js 分支逐字保留 |
| **A8 撤回** | 全仓 grep `typeOnlyAliases` = **0 命中**；R9b 回归钉在库（`call-resolver.test.ts:2525`） | ✅ 未偷偷加回 type-only 弃权 |
| **D2b 六条件与门** | ①`!receiverType→null` ②`suppressedDynamicAliases` ③`locateClassFile` ④`kind==='class'` ⑤`members.has` ⑥`confidence:'medium'`；任一不成立 `return null`，不产 `?::` 占位 | ✅ 与门语义完整 |
| **H5 拦截前置** | `receiver-type-resolution.ts:135` 的抑制检查在 `locateClassFile`（内含本模块导出查找）**之前** | ✅ 顺序正确 |
| **H7 new 走 AST** | `classNameFromNewExpression`：`childForFieldName('constructor')` 且强制 `type === 'identifier'`；全文件无 `/new\s+/` 类正则 | ✅ |
| 分支插入位置 | `call-resolver.ts:595-605`，Stage 1 之后、Stage 2 之前 | ✅ |
| **B7 语言分流** | `call-resolver.ts:451` 正向 `sk.language === 'typescript' \|\| 'javascript'` | ✅ 无反向判据 |
| §2.3 增量预算 | `call-resolver.ts` 直接接线净 +18（p4-attribution §11 有 `diff -u` 实测）；`typescript-mapper.ts` 走成员字段 `_receiverEnv` 压增量 | ✅（累计口径争议见 WARNING-4，另见 4b-Q1 与 plan §17 裁决） |

## 4. 验收断言 ↔ 实测记录 —— 全部有对应记录

| fix-report §6 / plan §7.1 口径 | 承诺值 | 实测 | 出处 |
|---|---|---|---|
| method 覆盖率下限（B3） | ≥ `max(40.0%, U×0.75)` = **40.0%**（U=45.6） | **45.6%（236/517）** | `coverage-P5.json`、`structural-upper-bound-P4.json` |
| gapRatio 收敛 | ≤ **2.3** | **1.96**（function 89.4%） | `coverage-P5.json` |
| 硬断言 1（impact upstream 含两 caller） | 必须同时命中 | `affected=30`，`batch-orchestrator`/`graph-assembly` 均 depth=1 命中 | p5-attribution §3.6；前置复核 (a)(b) 见 `structural-upper-bound-P4.json.acceptancePrecheck` |
| 断言 2（interface-target = 0） | 0 | 新增边 0 违规；全图 `interface` 节点 **580 个入边恒 0** | p5-attribution §3.2 |
| 断言 3（无悬空新增边） | 0 | 0 | `edge-diff-P4b-to-P5.json` |
| 抽样 ≥20 条人工核对 | ≥20 | **28 条**（P4b 换种子重抽 22 + 6 条 new-endpoint）+ P5 **4 条全量** | p4b-attribution §3.3/§6、p5-attribution §3.2 |
| 六指标不劣于 P0 | 不劣 | overallVerdict pass，逐项持平 | `P5-graph-quality.json` |

正向信号：实测覆盖率 45.6% **恰好等于**收紧口径下的结构上界 U，说明六道弃权之外的可达面已被吃满，不存在"过绿"或"没吃到"的中间态。

## 5. 是否需要同步更新 spec —— 结论成立，但 fix-report 的理由是错的（WARNING-1）

`specs/src.spec.md` **是 tracked 文件**：`.gitignore:78` 只忽略 `specs/_meta/`。fix-report §8 的括注「按工程约定排除提交」不成立。但**结论本身仍成立**：全文仅 3 处提及 call-resolver 且均为清单式条目，无 qualifier / receiver / 解析语义描述；条目在 F260 前即已陈旧。**无既有 spec 需因本次改动更新**。

## 问题清单

| # | 级别 | 问题 | 建议 |
|---|---|---|---|
| W1 | WARNING | fix-report §8 措辞与 `.gitignore:78` 矛盾 | 改为事实口径 |
| W2 | WARNING | `tasks.md` 完成状态滞后（T016–T023 / T033 / T035–T043 未勾）；P5b 无任务条目 | 补记 + 同步勾选 |
| W3 | WARNING | T040（不回退清单书面核对）/ T043（R-7 落 commit message）无对应制品 | T040 补书面确认；T043 在 commit message 补一句 |
| W4 | WARNING | p4-attribution §11 的预算请示在 §14/§15/§16 无回应 | 判非违规，建议编排器补显式裁决（→ 已由 plan §17 落账） |
| W5 | WARNING | D1 路径 4（正则兜底）实测**结构性不可达**（sanitizer 先挖空 import），`buildNamedImportBindings` 在该路径是死代码；能力边界只在测试注释未回流 plan §9 | plan §9 补 R 编号（→ 已由 plan §17 落账） |
| I1 | INFO | `p4-sample-audit.md` / `p5-full-audit.md` 未按该名落盘，内容在 attribution 内 | tasks 备注指向实际落点 |
| I2 | INFO | 本审查无 Bash 权限，未跑行级 diff；结论基于文件集吻合 + 逐文件阅读 + attribution 的 diff 记录 | 4c 顺手跑 `git diff HEAD --stat` 闭合 |

## 给 4c 的两条移交

1. p5-attribution §4 记录 `npx vitest run` 退出码 1（5 文件失败隔离全绿、与改动面零交集、含 memory 预存 flaky）。请 4c 独立复跑并给出自己的判定，不要采信转述。
2. `npm run repo:check` 的 1 条 warning（图产物 stale）源于按硬约束未重建仓库图，属 R-7 预期现象。

## 未发现的问题（显式记录）

- 过度实现：无。全部新增公共 API 均落到 §5 变更清单条目。
- 判据放宽：无。抽查 10 条判据零松动；A1 计数式 / A6 拒绝复用 last-write-wins 索引 / M2/M3/W-A/W-B 均为**收紧**方向。
- P5 特性本仓图足迹 = 0 条边：plan §16-2 已裁决接受（如实记录而非隐瞒），R-17 在册。
