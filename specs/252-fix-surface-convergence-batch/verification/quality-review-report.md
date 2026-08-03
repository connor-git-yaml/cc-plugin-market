# 代码质量审查报告（F252 fix 模式）

审查对象：11 文件改动（+97/-161，未提交），对照 `fix-report.md` + `plan.md` 声称逐行核对。

## 六维度评估

| 维度 | 评级 | 关键发现 |
|------|------|---------|
| 架构合理性 | GOOD | 判定权收口到 `surfaceMatchesFile`/`parseCollectorFingerprint` 单点，消除"提取扩展名再比对"的重复形态；`collector-extname.ts` 删除后模块依赖减少一条边，符合 plan 声称的"跨包影响 0" |
| 设计模式合理性 | GOOD | `surfaceHasExtension` 虽变成零生产消费方但作为 SSoT 公共 API 面保留并有测试锚定，未过度删除；未引入新抽象层 |
| 安全性 | N/A | 本批次不涉及外部输入、序列化、路径拼接的安全敏感路径，无新增风险面 |
| 性能 | GOOD | 见问题清单 INFO 项（`resolveAdapterForFile` 逐 adapter 构造 surface 对象），量级可忽略，非回归 |
| 可读性 | GOOD | 三处新注释均说明 why（形态失真根因、等价性论证、行为变化边界），无 PR 叙事腔，中文书写 |
| 可维护性 | GOOD | 新增 3 条 ignore-oracle 测试钉住唯一行为变化点；guardrail 测试用 `if...throw` 替代 `as never`，是真实 control-flow narrowing |

## 问题清单

| 严重程度 | 维度 | 位置 | 描述 | 修复建议 |
|---------|------|------|------|---------|
| INFO | 性能 | `src/batch/generic-language-skeleton-collector.ts:50-60`（`resolveAdapterForFile`） | 每次调用该函数（每个候选文件调用一次）都在 `for (const adapter of adapters)` 循环内新建一个 `CollectorPipelineSurface` 字面量对象，`adapters` 列表本身在整个 `collectGenericLanguageCodeSkeletons` 调用期间不变。量级为"文件数 × adapter 数"个临时小对象，属可忽略的微分配，非性能回归，但可进一步优化为在调用方按 adapter 预构造一次 surface 数组后传入 | 可选优化：把 `adapters.map(a => ({ extensions: a.extensions, matchSemantics: 'case-insensitive' }))` 提到 `collectGenericLanguageCodeSkeletons` 顶部构造一次，`resolveAdapterForFile` 改接收 `{ adapter, surface }[]`；非阻断项，可留待下次触碰此文件时顺手做 |
| INFO | 可维护性 | `src/panoramic/graph/quality/ignore-oracle.test.ts` 新增 3 例 | 负向断言（`vendor/.go`/`.gradle/.java` → false）的判别力依赖 `GoLanguageAdapter`/`JavaLanguageAdapter` 的 `defaultIgnoreDirs` 恰好包含 `vendor`/`.gradle` 且不在 `GRAPH_COLLECTOR_IGNORE_DIRS` union 内这一巧合前提；若未来这两个 adapter 的 `defaultIgnoreDirs` 变化（如把 `vendor`/`.gradle` 移出），测试会退化为"新旧实现同判 false"的空判别（仍能跑绿，但不再钉住本次修复的行为变化点）。文件顶部 L83-85 已有注释记录这一耦合前提，风险已被文档化，非隐藏缺陷 | 可选加固：在测试内直接断言前提本身（如 `expect(new GoLanguageAdapter().defaultIgnoreDirs.has('vendor')).toBe(true)` 且 `expect(GRAPH_COLLECTOR_IGNORE_DIRS.has('vendor')).toBe(false)`），让前提漂移时测试文件本身给出可诊断的失败信号而非静默失去判别力；非阻断项 |

无 CRITICAL、无 WARNING。

## 逐项核实记录（对照审查任务清单）

1. **改动最小且聚焦**：`git diff HEAD --stat` 确认 11 文件、+97/-161；全仓 grep `collector-extname|extractExtension|surfaceHasExtension` 确认无死代码残留、无遗留调试代码，`isValidCollectorFingerprint` 未使用的 import 也未残留（guardrail 测试仍使用它做双重覆盖，非死 import）。
2. **`surfaceMatchesFile` 三消费点的 surface 构造位置**：`ignore-oracle.ts` 直接引用模块级常量（无构造开销）；`generic-language-skeleton-collector.ts::walkFiles` 与 `file-scanner.ts::walkDir` 均在目录递归调用体的循环外构造一次 surface 再复用于内层 entries 循环，**不是**逐文件重复构造，与 plan 声称的"性能影响可忽略"一致；`resolveAdapterForFile` 见上表 INFO 项。`extensions` Set 均以只读引用透传（`ReadonlySet<string>`/直接复用同一 Set 对象），`surfaceMatchesFile` 内部只读 `.has()`，无变更点，无共享可变状态风险。
3. **删除 `collector-extname.ts` 的悬空引用检查**：`grep -rn "collector-extname"` 仅剩 `source-commit.ts` 的历史性注释（措辞已改为"此前引用……已退役并删除"，如实反映现状而非声称仍存在）；`extractExtension`/`surfaceHasExtension` 全仓无残留失效 import。F248 语义差异表知识（"纯点文件 `.ts` 该按 endsWith 而非 path.extname 判定"）已完整承接进 `collector-surface.ts` 的 `ExtensionMatchSemantics`/`surfaceMatchesFile` 文档注释，未随删除丢失。
4. **新增 ignore-oracle 测试守护力**：见上表 INFO 项——判据依赖两个 adapter 的 `defaultIgnoreDirs` 具体内容，非结构性不变量；当前已用注释记录耦合前提，属可接受的已知局限，非本次修复引入的缺陷。
5. **pinned-asset-loader 迁移**：`parseCollectorFingerprint` 经代码走读确认真实返回独立 plain snapshot（`extensions` 是新建 `string[]`，顶层对象是新建字面量），并非原对象引用透传，"防御性拷贝"表述属实；错误信息从 `isValidCollectorFingerprint === false` 改为 `parseCollectorFingerprint 返回 null`，诊断力不降级（原信息本就不含更多结构细节）。
6. **安全性/数据丢失/构建阻断**：未发现；`npx tsc --noEmit` 全量通过；跨模块一致性——`isValidCollectorFingerprint` 签名收紧后全仓仅 `pinned-asset-loader.ts` 一处依赖类型窄化能力且已同步迁移，构建期强类型信号确认无遗漏调用点。
7. **注释质量**：新增/改写注释均说明 why（形态失真根因、等价性论证、耦合前提），中文书写，无"本次修复""参考 PR"等叙事腔用语。

## 验证结果（本次审查同步跑）

- `npx vitest run` 针对本批次涉及文件（`ignore-oracle.test.ts` 20 例 / `guardrail` 20 例 / `generic-language-skeleton-collector.test.ts` 10 例 / `file-scanner.test.ts` 23 例 / `collector-surface.test.ts` 47 例）：**全部通过（120/120）**
- `npx tsc --noEmit -p tsconfig.json`：**零错误**

## 总体质量评级

**EXCELLENT**

评级依据：零 CRITICAL，零 WARNING，仅 2 条 INFO（均为可选优化/加固建议，非缺陷）；实现与 fix-report/plan 声称的等价性论证逐一核实属实，测试通过、构建零错误。

## 问题分级汇总

- CRITICAL: 0 个
- WARNING: 0 个
- INFO: 2 个
