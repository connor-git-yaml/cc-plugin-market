# 修复规划：blockCount 补救成功重置

**模式**: fix（精简规划，非完整架构设计）
**特性目录**: `specs/211-fix-block-count-reset`
**前序制品**: `fix-report.md`（5-Why 根因 + 影响范围扫描 + 方案 A 推荐，已读）
**采用方案**: 方案 A——compliant 分支调用 `resetBlockState` 删除两级状态文件（回到"从未阻断"初始态）

---

## 1. Codebase Reality Check（精简版）

| 文件 | LOC（改前） | 相关函数数 | 已知 debt |
|------|------|------|------|
| `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs` | 311 | 11 个导出函数 | 无 TODO/FIXME/HACK；BlockCountState 组（§L202-311）结构清晰，`primaryStatePath`/`tmpStatePath`/`sanitizeSessionId` 均已存在可直接复用 |
| `plugins/spec-driver/scripts/fix-compliance-judge.mjs` | 410 | `runHook`/`routeBlock`/`releaseDegraded` 等 8 个函数 | 无 TODO/FIXME/HACK；`runHook` 单函数 76 行，compliant 分支为单行 `if` |

两文件均远低于 500 LOC 前置清理阈值，新增改动预计 io.mjs +18 行 / judge.mjs +4 行，**不触发前置 cleanup task**。

## 2. Impact Assessment（精简版）

- **直接改动文件**：2（`fix-compliance-io.mjs` 新增 1 个导出函数；`fix-compliance-judge.mjs` compliant 分支接入 1 处调用点）
- **调用方**：0（judge.mjs 是 hook 唯一生产入口，无其他调用方需要同步；已在 fix-report.md 影响范围扫描中核实）
- **跨包影响**：无，改动限于 `plugins/spec-driver/**`（C-002 约束）
- **数据迁移**：无（BlockCountState 文件格式不变，仅新增"删除"这一种操作，不改变 schema）
- **API/契约变更**：无对外契约变更；`resetBlockState` 是 io 层内部新增导出，不改变 `fix-compliance-judge-cli.md` 契约中已定义的退出码矩阵（compliant 分支恒 exit 0 不变，仅新增内部副作用）
- **风险等级**：**LOW**（影响文件 2 < 10，无跨包影响，无数据迁移，无公共 API 契约变更）→ 不要求分阶段实现，单一 patch 即可

## 3. 变更清单（文件级，含函数签名）

### 3.1 `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs`

在 BlockCountState 组末尾（`saveBlockState` 定义之后，L310 之后）新增：

```js
/**
 * 重置阻断计数状态（FR-006 增补：补救成功后的清零转移）。
 * 删除两级存储（主路径 + tmpdir 回落）中该 session 对应的状态文件，
 * 与"从未被阻断"状态同构——blockCount 与 degradedRecorded 一并归位，无字段级歧义。
 * 尽力而为、非抛出式：文件不存在（本就未阻断过）或删除失败均静默忽略，
 * 不产生可失败传播的下游（与 sweep 同为旁路维护语义，不同于 saveBlockState 需暴露
 * state-storage-unavailable 诊断——reset 失败的最坏后果只是"旧计数残留"，
 * 不影响本次放行判定，无需诊断落盘）。
 * @param {string} projectRoot
 * @param {string} sessionId
 * @returns {void}
 */
export function resetBlockState(projectRoot, sessionId) {
  const sanitizedId = sanitizeSessionId(sessionId);
  for (const filePath of [primaryStatePath(projectRoot, sanitizedId), tmpStatePath(sanitizedId)]) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      // 文件不存在 / 不可删 → 忽略（两级都尝试，缺一级不影响另一级清除）
    }
  }
}
```

- 直接复用既有私有函数 `primaryStatePath`/`tmpStatePath`/`sanitizeSessionId`，无新增依赖。
- 两级都无条件尝试删除（不因主路径删除失败就跳过 tmpdir），这是 fix-report 影响范围扫描明确要求的关键点："重置必须两级都清"——否则 load 会回落读到 tmpdir 残留的旧计数，清零失效。

### 3.2 `plugins/spec-driver/scripts/fix-compliance-judge.mjs`

- import 列表（L39-41）新增 `resetBlockState`。
- `runHook` 函数（现 L326-328）：

```js
// 非 fix 会话 → 零接触放行（US5：健康路径不产生任何落盘）
if (!result.isFix || !result.verdict) return 0;
// 合规 → 重置阻断状态（补救成功清零转移，FR-006 增补）后静默放行
if (result.verdict.compliant) {
  resetBlockState(projectRoot, payload.session_id);
  return 0;
}
```

- **不区分 `enforcement`（block/warn）无条件调用**：该分支本身只在 `!result.isFix` 判定之后、`off` 已在函数入口短路，故 compliant 分支只会在 `isFix===true` 且 `enforcement` 为 `block` 或 `warn` 时触达。`warn` 档从不调用 `saveBlockState`（不 bump 计数，见 `runHook` 现 L332-338），故其 session 的状态文件本就不存在，`resetBlockState` 对其而言是两次 `ENOENT` 快速失败的空操作，成本可忽略。用一次无条件调用换取"配置在同一会话内从 block 切换到 warn 又切回"这种边缘时序下也不会有陈旧计数残留的健壮性，比额外加 `if (result.enforcement === 'block')` 分支更简单且无实质代价——评估后选择无条件调用。

## 4. 回归风险评估

| 场景 | 论证 |
|------|------|
| headless 单次判定路径（评测主战场） | 评测 harness 每次 run 为独立会话（session_id 唯一），从未走到 compliant 之后又坍塌的场景；`resetBlockState` 在此路径下等价于对不存在的文件调用两次 `unlink`（ENOENT 立即返回），不改变任何既有断言（退出码矩阵测试 `compliant → exit 0，静默`、`stderr.trim()===''` 均不受影响，因为 reset 发生在 `return 0` 之前且不写 stderr/stdout） |
| `warn` 档 | 不受影响：`warn` 从不 bump 计数，`resetBlockState` 对其恒为空操作（两文件均不存在） |
| `off` 档 | 不受影响：`off` 在 `runHook` 入口即短路 `return 0`，永不进入 compliant 分支 |
| `record/adoption` 等其他 4 个 SKILL 调用方 | 零接触：`resetBlockState` 只在 `fix-compliance-judge.mjs` 内部调用，不改变 `record-workflow-run.mjs` 的公共接口（FR-014 向后兼容边界不受触碰） |
| 性能（C-003 p95 < 100ms） | compliant 路径新增开销 = 两次 `fs.unlinkSync` 调用。健康路径（从未阻断）两次调用均为 `ENOENT` 快速失败（无实际 I/O 写入，仅一次 `stat` 级别的文件系统查找），实测量级为微秒级，相对于既有 transcript 读取 + judgeCompliance 遍历判定的既有开销（该开销已验证达标 p95<100ms）可忽略不计，不构成回归风险 |
| 既有阻断有界化行为（连续 3 次不合规 → 第 3 次降级） | 不回归：`resetBlockState` 只在 `verdict.compliant===true` 时调用，`routeBlock`/`releaseDegraded` 路径未改动一行代码 |

## 5. 测试方案

### 5.1 落点选择依据

- 融入既有两个测试文件（不新建文件）：
  - `fix-compliance-io.test.mjs` 新增 `describe('resetBlockState：...')` 区块，紧跟既有 `loadBlockState / saveBlockState` 区块之后——延续该文件"每个 io 导出函数一个 describe"的组织惯例，单测粒度直接调用 `resetBlockState` + `loadBlockState`/`saveBlockState` 断言磁盘态，无需起子进程。
  - `fix-compliance-judge-cli.test.mjs` 在既有 `describe('阻断有界化（FR-006）', ...)` 区块内追加用例（不新开 describe）——因为这是端到端交互式序列（多次 `runCli` 调用同一 `sessionId`），语义上属于"阻断有界化"整体行为的补充场景，复用该区块已有的 `readRunsEvents()` 辅助函数与 `collapsedTranscript()`/`compliantTranscript()` fixture 构造器，无需重复造轮子。
- 判据形态严格对齐 F208 既有 fixture 惯例（非 F207 分支的旧形态）：锚点用 `SKILL_EXPANSION_LINE('fix')`（"Base directory for this skill" 注入头），会话键用 payload `session_id`；`compliantTranscript()` 已封装"落盘真实 fix-report.md + verification-report.md + implement/verify 两次委派"的合规收口构造，直接复用无需改造。

### 5.2 新增用例清单

**a) io 层单元测试（`fix-compliance-io.test.mjs`）**

```js
describe('resetBlockState：补救成功清零（两级存储均清）', () => {
  it('删除主路径状态文件，load 回到初始态', () => { ... });
  it('主路径不可写、状态已降级写入 tmpdir 时，重置后 tmpdir 残留同样被清除', () => { ... });
  it('文件不存在（从未阻断过的 session）→ 不抛出', () => { ... });
});
```

对应 fix-report 同步更新清单第 (c) 项——两级存储都被清、tmpdir 回落不复活旧计数。

**b) CLI 端到端交互式序列（`fix-compliance-judge-cli.test.mjs`，追加进现有 `阻断有界化（FR-006）` describe）**

```js
it('补救成功清零：阻断×2 → compliant 收口 → 额度恢复，再次不合规从第 1 次重新计数', () => {
  // bad ×2(exit2,exit2) → good(exit0,静默) → bad ×3(exit2,exit2,exit0+GATE-DEGRADED)
  // 断言重置后进入新一轮完整的 2→2→降级 周期，而非直接沿用旧计数触发 3 次即降级
});

it('降级放行后补救成功：degradedRecorded 随重置归位，同一 session 可再次产生新的降级终态事件', () => {
  // bad ×3 → 第 3 次降级(exit0+GATE-DEGRADED，产生1条 workflow-run-summary)
  // → good(compliant,exit0) → bad ×3 → 应再次降级并产生第 2 条 workflow-run-summary
  // （证伪"旧 degradedRecorded 幂等标记吞掉第二轮终态事件"）
});
```

对应 fix-report 同步更新清单第 (a) 额度恢复、(d) degradedRecorded 归位两项。既有用例（`连续 3 次同 session：1/2 次 exit 2、第 3 次 exit 0`、`第 4 次同 session 不再新增 workflow-run-summary`、`不同 session 计数互不干扰`、`state-storage-unavailable`）保持不动、原样重跑，验证 fix-report 同步更新清单第 (b) 项"始终不补救 → 既有行为不回归"。

### 5.3 验证方式

- `node --test plugins/spec-driver/tests/fix-compliance-io.test.mjs`
- `node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`
- 全量 `npx vitest run`（确认无跨文件回归；本仓库 node:test 与 vitest 并存，CI 门槛以现有约定为准）

## 6. Spec 增补方案

**目标文件**：`specs/208-fix-mode-process-compliance/spec.md`
**位置**：FR-006 段落（现 L158）末句 `**[必须]**` 之前插入一句：

> 原文：`...并发的多个 fix 会话不得共享同一份计数或降级状态。**[必须]**——去掉有界化设计...`
>
> 增补后：`...并发的多个 fix 会话不得共享同一份计数或降级状态。同一会话内合规收口成功时，阻断计数重置（中间停顿消耗的额度随补救成功自愈）。**[必须]**——去掉有界化设计...`

由 implement 阶段随代码改动在同一 commit 内同步编辑该行；不新增 FR 编号（属于既有 FR-006 语义的边界补充，非新增需求）。

## 7. 明确不做的事（YAGNI 边界）

- **不加锁**：`resetBlockState` 与 `saveBlockState`/`loadBlockState` 一样是单进程内单次 hook 调用的尽力而为文件操作，不引入文件锁或原子性保障（与既有 io.mjs 全部读写函数的并发模型一致，同一 session 天然不会有并发 Stop hook 调用）。
- **不改判定逻辑**：`judgeCompliance`（core.mjs）与 `routeBlock`/`releaseDegraded`（judge.mjs）零改动，本次修复只在"已判定为 compliant 之后"追加一个状态清理副作用，不触碰任何判定分支。
- **不动 core.mjs 纯函数**：`resetBlockState` 落点选择 io.mjs 而非 core.mjs——核实 core.mjs 全部 9 个导出函数（`fix-compliance-core.mjs` L102-441）均为零 `fs`/`path` 依赖的纯函数（无 `import fs`），这是该文件明确的分层契约（"I/O 编排层 vs 判定纯函数层"，judge.mjs 头注释）。`resetBlockState` 本质是文件删除操作，属于 I/O 边界，必须落在 io.mjs，与 `loadBlockState`/`saveBlockState` 同组，不存在"更适合放 core"的候选可能——core.mjs 不做任何磁盘操作是硬性分层约束。
- **不扩大到 warn 档的差异化处理**：见 §3.2 末尾论证，无条件调用比按 enforcement 分支更简单且无实质代价，不额外引入分支复杂度。
- **不新建测试文件**：复用现有两个测试文件的既有 describe 组织，不为一个新增函数单独起文件（体量不够，见 §5.1）。
- **不改动 `record-workflow-run.mjs`**：FR-014 向后兼容边界不受本次改动触碰，终态事件的写入逻辑（`releaseDegraded` 内部）未改动一行。

## 8. 约束遵循确认

- 改动仅落 `plugins/spec-driver/scripts/lib/fix-compliance-io.mjs` + `plugins/spec-driver/scripts/fix-compliance-judge.mjs` + 两个测试文件 + `specs/208-fix-mode-process-compliance/spec.md`，全部在 `plugins/spec-driver/**` + `specs/` 范围内（C-002）。
- 判定路径零 LLM/零委派：`resetBlockState` 是纯本地 `fs.unlinkSync` 操作，不引入任何 LLM 调用或子代理委派（C-003）。
- 未触碰 `scripts/eval-*.mjs`、`scripts/lib/**` 之外的评测 harness 红线文件（C-001 无关，本次改动不涉及评测 harness 本体，但仍确认未误触）。
