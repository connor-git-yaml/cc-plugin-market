# 问题修复报告

## 问题描述

F208 fix-compliance 机制(v4.3.0,d65bd78)的 C5 边界缺陷:`fix-compliance-judge.mjs`
的 compliant 放行分支不清零 blockCount。交互式 fix 会话中间停顿(如向用户提问时制品
尚未齐备)会消耗阻断额度且永不恢复——同一会话(session_id 键)后续的真实仪式坍塌
一次都不会被阻断,`routeBlock` 读到 `count >= BLOCK_LIMIT(2)` 直接降级放行。

**发现来源**:F207 平行线 plan 阶段 codex 对抗审查 C5 项(裁决=补救成功清零);
F207 abandon 后对 master F208 实现的双向 diff 实锤(memory
project_f207_fix_compliance_spec_done)。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|------|------|------|
| Why 1 | 后续真坍塌为何不被阻断? | `routeBlock` 读 `blockCount >= 2` 直接走 `releaseDegraded`(judge.mjs routeBlock 尾支) |
| Why 2 | 计数为何已达上限? | 交互式 Stop **每轮触发**且不区分"中间停顿"与"最终收口";停顿轮次制品未齐 → 判 non-compliant → bump |
| Why 3 | 额度为何不恢复? | judge 主入口 compliant 分支 `if (result.verdict.compliant) return 0;` **未重置状态**——计数生命周期只有"递增"与"TTL 过期",缺"补救成功清零" |
| Why 4 | 设计为何遗漏此语义? | F208 设计主战场是 headless 评测(单次终态 Stop,一会话一判),交互式多轮 Stop 的计数语义未纳入;R1 类风险仅以"上限 2 次兜底"缓解 |
| Why 5 | 为何未被测试/评测捕获? | 慢验 N=6 全 headless(不产生多轮 Stop);单测无"阻断→补救成功→再收口"的交互式序列用例 |

**Root Cause**: 阻断计数状态机缺少 compliant 时的重置转移——设计只覆盖了单调递增
(bump)与时间过期(TTL sweep)两种转移。`[ROOT CAUSE REACHED at Why 3]`

**Root Cause Chain**: 真坍塌零阻断 → count 已达上限直接降级 → 中间停顿消耗额度 →
compliant 分支不清零 → 设计聚焦 headless 单次判定 → 测试/评测无交互式序列覆盖

## 影响范围扫描

### 同源问题(需同步修复)

| 文件 | 位置 | 模式 | 修复动作 |
|------|------|------|----------|
| `plugins/spec-driver/scripts/fix-compliance-judge.mjs` | 主入口 compliant 分支(`if (result.verdict.compliant) return 0;`) | 放行未重置状态 | 放行前重置该 session 阻断状态 |

### 类似模式(需评估)

| 文件 | 位置 | 模式 | 评估结果 |
|------|------|------|----------|
| `fix-compliance-io.mjs` 两级存储(项目 `.specify/runs` 主路径 + tmpdir 回落) | `loadBlockState` "主路径优先,回落 tmpdir" | **需修复**:重置若只删主路径,load 会回落读 tmpdir 旧计数 → 清零失效。重置必须**两级都清** |
| `degradedRecorded` 幂等标记 | `releaseDegraded` 置 true 后无重置路径 | **需修复**:补救成功后若只清 blockCount 不清此标记,会话后续再次降级时终态事件被幂等标记吞掉(只剩轻量审计)。随状态一起重置(删文件=两字段同归初始态) |
| warn 档(`enforcement=warn`) | 不 bump 计数,仅审计 | `[安全]` 不受影响 |
| off 档 | 配置短路先于判定 | `[安全]` 不受影响 |
| headless 评测路径 | 单次终态 Stop | `[安全]` 修复只增加 compliant 分支动作,单次判定行为不变 |

### 同步更新清单

- 调用方: 无(judge 是 hook 唯一入口;bash 薄壳不感知状态)
- 测试: `plugins/spec-driver/tests/` 新增交互式序列用例——(a) 阻断×2 → 补救 compliant
  → 再次不合规,应**重新从第 1 次阻断开始**(额度已恢复);(b) 始终不补救 → 第 3 次
  降级(既有行为不回归);(c) 两级存储都被清(tmpdir 回落不复活旧计数);(d)
  degradedRecorded 随重置归位。可改造 F207 分支(claude/charming-aryabhata-33874c)
  的 interactive-recover/interactive-collapse fixture,**须适配 F208 判据形态**
  (锚点=`Base directory for this skill` 注入头;会话键=payload `session_id`)
- 文档: F208 spec 的 FR-006(阻断有界化)增补"补救成功重置"语义一句(fix 模式下同步)

## 修复策略

### 方案 A(推荐):compliant 分支删除状态文件(回初始态)

judge 主入口 compliant 分支调用 io 新增的 `resetBlockState(projectRoot, sessionId)`:
删除**两级存储**(项目主路径 + tmpdir 回落)的状态文件,失败忽略(与 sweep 同为
尽力而为的旁路维护,不影响放行)。删除 = 与"从未被阻断"状态同构,blockCount 与
degradedRecorded 一并归位,无字段级歧义。

### 方案 B(备选):saveBlockState 写零值

写 `{blockCount:0, degradedRecorded:false}`。缺点:文件残留至 TTL;"存在但为零"与
"从未阻断"两种状态并存,增加审计歧义;且仍要写两级或接受回落不一致。不推荐。

## Spec 影响

- 需要更新的 spec: `specs/208-fix-mode-process-compliance/spec.md` FR-006 增补一句
  "同一会话内合规收口成功时,阻断计数重置(中间停顿消耗的额度随补救成功自愈)"
  (由 implement 阶段随代码同步;若 F208 spec 结构不便增补则在本 fix 记录中说明)
