---
feature: 254-fix-graph-scope-extensions
mode: fix
based_on: plan.md §6 任务拆分建议（T1-T5）
status: ready
---

# 任务清单：图消费决策白名单扩面 + 图自述面优先消费

> fix 模式无任务确认门，本清单生成后直接进入实现。每个任务的"完成判据"必须实测通过才可推进到下一个任务。

## 依赖关系总览

```
T1（graph-bootstrap-status.mjs 泛化读取）
 └─→ T3（cli.mjs 消费 readEmbeddedGraphMeta，依赖 T1 导出）

T2（decision.mjs 静态白名单 + 参数化）——与 T1 相对独立，可并行
 └─→ T3（cli.mjs 调用 annotateImpactCaveat 第 4 参，依赖 T2 的新签名）
 └─→ T4（跨语言合同测试依赖 T2 落地后的 GRAPH_SCOPE_EXTENSIONS 最终值）

T1, T2 可并行开工；T3 必须等 T1 与 T2 都完成；T4 必须等 T2 完成（不依赖 T3）；
T5 必须等 T1-T4 全部完成。
```

---

## T1 — `graph-bootstrap-status.mjs` 新增泛化读取函数 `readEmbeddedGraphMeta`

**目标文件**：
- `plugins/spec-driver/scripts/lib/graph-bootstrap-status.mjs`（canonical 实现，改动落点）
- `scripts/lib/graph-bootstrap-status.mjs`（仓根转发壳，确认新导出自动带出，见下方第 3 点）
- `tests/unit/graph-bootstrap-status.test.ts`（vitest，TS 侧，动态 import 仓根转发壳；新增用例落这里，**不是** `test:plugins` 覆盖范围）

**具体改动**（引用 plan.md §1.1）：
1. 新增导出函数 `readEmbeddedGraphMeta(graphJsonPath)`：
   - 复用既有的 `MAX_JSON_BYTES` 尺寸保护、`fs.statSync`/`fs.readFileSync`/`JSON.parse` 读取路径（与现有 `readEmbeddedSourceCommit` 同源，不新增第二套 I/O 实现）。
   - 三态失败分支逐字复用既有 reason 枚举：`file-missing`（stat 或 read 失败）、`graph-too-large`（size > MAX_JSON_BYTES）、`parse-error`（JSON.parse 失败）。
   - 成功时返回 `{ ok: true, value: { sourceCommit: parsed?.graph?.sourceCommit ?? null, fingerprint: parsed?.graph?.fingerprint ?? null } }`。
2. 将既有 `readEmbeddedSourceCommit(graphJsonPath)` 薄壳化为 `readEmbeddedGraphMeta` 的投影：
   - 成功时返回 `{ ok: true, value: meta.value.sourceCommit }`；
   - 失败时原样透传 `meta`（`{ ok: false, reason }`）。
   - **返回形状必须逐字保持不变**——不改变既有调用方（`buildStatusPayload`）的消费逻辑。
3. 确认仓根转发壳 `scripts/lib/graph-bootstrap-status.mjs` 的导出形式：若为 `export *` 会自动带出 `readEmbeddedGraphMeta`，无需改动；若是显式具名 re-export 列表，需补上 `readEmbeddedGraphMeta` 具名导出（先 `Read` 该文件确认实际形式，不要假设）。
4. 另有一份 `plugins/spec-driver/tests/graph-bootstrap-status-shim.test.mjs`（Node test runner，`npm run test:plugins` 覆盖）专职验证转发壳的"被当 CLI 直接执行"语义（`invokedDirectly` 判定），本次改动不触碰该文件覆盖的行为，**不需要**在此新增用例，但完成判据仍需确认该文件保持全绿（回归安全网）。

**新增测试用例**（写入 `tests/unit/graph-bootstrap-status.test.ts`，同批次提交，覆盖既有三态 fixture 之外的新增校验点）：
- 沿用既有三态 fixture（file-missing / graph-too-large / parse-error），补一条断言：`readEmbeddedGraphMeta` 在这三种失败态下返回值与既有 `readEmbeddedSourceCommit` 的失败态逐字相同（reason 字段）。
- 新增正常态用例：图内嵌 `graph.fingerprint` 字段存在时，`readEmbeddedGraphMeta` 的 `value.fingerprint` 与源 JSON 的 `graph.fingerprint` 深度相等；图内无 `fingerprint` 字段时，`value.fingerprint` 为 `null`。
- 新增薄壳验证用例：对同一个 fixture 文件分别调用 `readEmbeddedSourceCommit` 与 `readEmbeddedGraphMeta`，断言 `readEmbeddedSourceCommit(path)` 的返回值等于 `readEmbeddedGraphMeta(path)` 投影出 `sourceCommit` 后的结构（即薄壳没有改变既有行为）。

**完成判据**：
```bash
npx vitest run tests/unit/graph-bootstrap-status.test.ts
npm run test:plugins
```
两者零失败；`test:plugins` 中的 `graph-bootstrap-status-shim.test.mjs` 保持全绿（回归安全网，验证薄壳化未破坏 CLI 直调语义）。

---

## T2 [P] — `graph-consumption-decision.mjs` 静态白名单扩面 + `annotateImpactCaveat` 参数化

**依赖**：无前置（可与 T1 并行开工）。

**目标文件**：
- `plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs`（实现）
- `plugins/spec-driver/tests/graph-consumption-decision.test.mjs`（同批次更新，Node test runner）

**具体改动**（引用 plan.md §1.2）：
1. `GRAPH_SCOPE_EXTENSIONS`（原 L48-53）：值从 4 扩展改为 12 扩展全并集：
   ```js
   export const GRAPH_SCOPE_EXTENSIONS = Object.freeze([
     '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts',
     '.py', '.pyi',
     '.java', '.go',
   ]);
   ```
   按 plan.md §1.2(a) 原文重写上方 JSDoc 注释：声明"静态 fallback"语义、SSoT 锚点（`src/collector-surface.ts::ALL_PRODUCER_SURFACES`）、一致性由 `tests/unit/graph-scope-extensions-contract.test.ts`（T4）守护、本文件零 import 的硬合同不变。
2. `annotateImpactCaveat`（原 L396-408）：新增第 4 个可选参数 `scopeExtensions`，默认值 `GRAPH_SCOPE_EXTENSIONS`：
   ```js
   export function annotateImpactCaveat(decision, impactResult, target, scopeExtensions = GRAPH_SCOPE_EXTENSIONS) {
     const annotated = { ...decision, caveats: [...(decision?.caveats ?? [])] };
     if (decision?.outcome !== 'consume-impact') return annotated;
     if (normalizeDirectCallers(impactResult) !== 0) return annotated;
     const extension = extensionOf(target);
     if (extension === null || !scopeExtensions.includes(extension)) return annotated;
     annotated.caveats.push(CAVEAT_CODES.COVERAGE_GAP_KNOWN_EXTRACTION_LIMIT);
     return annotated;
   }
   ```
   JSDoc 补一句：`scopeExtensions` 缺省时用静态 fallback，CLI 侧会传入图自述动态面。
   **不改动**：函数零 import 硬合同（新参数是调用方传入的数据，不是本文件发起的 I/O）、决策矩阵 13 行求值顺序/出口、EC-07。

**同批次测试更新**（引用 plan.md §5.1.1）：
1. L507-511 白名单快照断言：改为
   ```js
   assert.deepEqual([...GRAPH_SCOPE_EXTENSIONS].sort(),
     ['.cjs', '.cts', '.go', '.java', '.js', '.jsx', '.mjs', '.mts', '.py', '.pyi', '.ts', '.tsx']);
   ```
   "全仓仅定义一处"的 grep 断言保留不动。
2. L457-464"目标不是 TS/JS 源"用例：目标扩展名从 `.mjs` 换成真正范围外扩展名（如 `.md`），验证 out-of-scope 拒绝注解出口仍可达。
3. 新增用例组"annotateImpactCaveat 第 4 参 `scopeExtensions` 参数化"：
   - 不传第 4 参时行为等价于显式传入 `GRAPH_SCOPE_EXTENSIONS`；
   - 显式传入自定义数组（如 `['.md']`）后，`.ts` target 反而不注解（验证参数切换判据的实际生效）；
   - 纯函数不变量：调用后传入的 `scopeExtensions` 数组本身未被修改（无原地 mutate）。

**完成判据**：
```bash
npm run test:plugins
```
零失败，且 `graph-consumption-decision.test.mjs` 内白名单快照断言、目标扩展名用例、新增参数化用例组全部通过。

---

## T3 — `graph-consumption-cli.mjs` 图自述面优先消费改造

**依赖**：T1（需要 `readEmbeddedGraphMeta` 已导出）与 T2（需要 `annotateImpactCaveat` 新签名、`GRAPH_SCOPE_EXTENSIONS` 新值）均完成后开工。

**目标文件**：
- `plugins/spec-driver/scripts/graph-consumption-cli.mjs`（实现）
- `plugins/spec-driver/tests/graph-consumption-cli.test.mjs`（同批次更新，Node test runner）

**具体改动**（引用 plan.md §1.3）：
1. import 增补（原 L41）：
   ```js
   import { checkFreshness, readEmbeddedGraphMeta, readEmbeddedSourceCommit } from './lib/graph-bootstrap-status.mjs';
   ```
   `readEmbeddedSourceCommit` 保留原有调用点不动（`readVerifiedSourceCommit`、`finalizeRefreshOutcome` post-refresh 重读路径）。
2. 新增纯函数 `deriveScopeExtensionsFromFingerprint(fingerprint)`（放在 `collectCoverageScope` 之前）：
   - 常量 `FINGERPRINT_SURFACE_KEYS = ['tsjsSkeletonWalk', 'pyWalk', 'genericAdapters', 'moduleDerivationScan', 'pythonSymbolScan']`。
   - 结构严格核验：`fingerprint` 非 object / 是数组 → `null`；`fingerprint.formatVersion !== 1` → `null`；`extensionSurface` 非 object / 是数组 → `null`；五条管线 key 中**任一**缺失/畸形（非 object、是数组、`extensions` 非数组、`extensions` 元素非字符串或空串）→ 立即返回 `null`（全有或全无，不做部分并集）；全部合法时返回 `[...union].sort()`（`union.size === 0` 也返回 `null`）。
   - 严格按 plan.md 给出的实现逐行落地，不自行简化结构核验条件。
3. `collectCoverageScope(files, scopeExtensions)`：去掉对模块级常量的隐式引用，改为显式参数；函数体逻辑（`anyInScope` 判据、空数组早退）不变。
4. `collectGraphAvailability(graphJsonPath)`：改为调用 `readEmbeddedGraphMeta` 一次性读取，返回值新增 `graphFingerprint` 字段；`sourceCommit` 判空逻辑与既有 `graphAvailability` 三态（missing/corrupt/present）判定不变。
5. `runDecide`：
   - 消费 `collectGraphAvailability` 新增的 `graphFingerprint`，调用 `deriveScopeExtensionsFromFingerprint` 得到 `derivedScopeExtensions`；
   - `scopeExtensions = derivedScopeExtensions ?? GRAPH_SCOPE_EXTENSIONS`；
   - `scopeExtensionsSource = derivedScopeExtensions !== null ? 'graph-fingerprint' : 'static-fallback'`；
   - `collectCoverageScope(files, scopeExtensions)` 替换原来的隐式常量调用；
   - `payload` 与非 dry-run 审计事件各新增字段 `scopeExtensionsSource`（位置：`inputs` 之后、`changedFiles` 之前，作为决策元信息字段，不混入 `inputs` 五维）。
6. `runAnnotateCaveat`：
   - 独立重新调用 `readEmbeddedGraphMeta(path.join(projectRoot, GRAPH_REL))` 读取"注解时点"的图状态（不复用 decide 阶段的值，理由见 plan.md §1.3(f) 末段——decide 与 annotate-caveat 是两个独立进程，中间隔一次真实 impact 调用）；
   - 推导 `graphSourceCommitAtAnnotation`、`derivedScopeExtensionsAtAnnotation`、`scopeExtensionsAtAnnotation`、`scopeExtensionsSourceAtAnnotation`；
   - `annotateImpactCaveat` 调用点传入第 4 参 `scopeExtensionsAtAnnotation`；
   - 审计事件（`kind: 'caveat-annotation'`）新增字段 `scopeExtensionsSource: scopeExtensionsSourceAtAnnotation`；
   - **不改动**：`snapshotMatches` 快照校验逻辑（FR-010）、`impactStatus` 判定分支。
7. `AUDIT_SCHEMA_VERSION`：`2` → `3`。

**同批次测试更新**（引用 plan.md §5.1.2）：
1. SC-005 场景（约 L1256）：`notes.mjs` → `notes.md`（或其他确定落在 12-ext 之外的扩展名），保持 `writeGraph(root)`（无 fingerprint，验证 fallback 路径），断言仍为 `COVERAGE_GAP_OUT_OF_GRAPH_SCOPE`。
2. L1223-1236 范围外扩展名列表：`.mjs` 目标换成真正范围外扩展名，其余保留（`docs/design.md`、`no-extension-at-all` 等）。
3. `DECIDE_OUTPUT_KEYS`（L94-118，三处 `deepEqual` 调用点，实为同一常量改一处生效）：新增 `'scopeExtensionsSource'`，保持按字母序 `.sort()` 插入。
4. decision 审计事件封闭键集（L1014-1021）：新增 `'scopeExtensionsSource'`。
5. L1022、L1077 `schemaVersion` 硬编码断言：`2` → `3`。
6. 新增用例组"fingerprint 驱动的动态覆盖面"（五个子场景，逐一落地）：
   - a. 图无 `fingerprint` 字段（现有 `writeGraph` 形态）→ `scopeExtensionsSource: 'static-fallback'`；
   - b. 图带合法 fingerprint 且 `extensionSurface` 不含某扩展（自定义精简过的 fingerprint）→ `.py` 改动按该 fingerprint 判 `out-of-scope`（验证动态面能收窄而非只扩大）；
   - c. 图带合法 fingerprint 含 `.mjs` → `.mjs` 改动判 `in-scope`，`scopeExtensionsSource: 'graph-fingerprint'`（本 fix 要修的核心场景正面回归用例）；
   - d. fingerprint 结构畸形（缺某已知 key / `extensions` 非数组 / `formatVersion` 非 1）→ 整体回落 `static-fallback`，不产出部分并集；
   - e. `annotate-caveat` 独立进程重新推导覆盖面：验证函数按各自读取时点独立求值，不透传 decide 阶段的值。
7. 新旧图双形态回归用例（引用 plan.md §5.3）：旧图（无 `fingerprint`）→ 全程走 static-fallback，行为与本 fix 之前完全一致；新图（含合法 `fingerprint`）→ 走 graph-fingerprint 动态面。

**完成判据**：
```bash
npm run test:plugins
```
零失败，且上述 6 项测试更新 + 双形态回归用例全部通过。

---

## T4 [P] — 新增跨语言合同测试

**依赖**：T2 完成后开工（依赖 `GRAPH_SCOPE_EXTENSIONS` 最终值已落地）；不依赖 T3，可与 T3 并行。

**目标文件**：
- `tests/unit/graph-scope-extensions-contract.test.ts`（新建）

**具体改动**（引用 plan.md §5.2，严格按给出实现落地）：
```ts
import { describe, expect, it } from 'vitest';
import { ALL_PRODUCER_SURFACES } from '../../src/collector-surface';

describe('F254 跨语言合同：plugins 侧 fallback 白名单 ↔ SSoT 采集面并集', () => {
  it('GRAPH_SCOPE_EXTENSIONS 与 ALL_PRODUCER_SURFACES 的扩展名并集逐项一致', async () => {
    // @ts-expect-error — .mjs 无类型声明，运行时可解析（同 graph-bootstrap-status.test.ts 先例）
    const decisionModule = await import('../../plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs');
    const expected = new Set<string>();
    for (const surface of ALL_PRODUCER_SURFACES) {
      for (const extension of surface.extensions) expected.add(extension);
    }
    const actual = new Set(decisionModule.GRAPH_SCOPE_EXTENSIONS as string[]);
    expect([...actual].sort()).toEqual([...expected].sort());
  });
});
```
- 先用 `Read`/`Grep` 核实 `src/collector-surface.ts` 的实际导出名（`ALL_PRODUCER_SURFACES`）与每个 surface 条目上扩展名字段的实际字段名（`extensions` 还是其他命名），以及从 `tests/unit/` 到 `src/collector-surface` 与 `plugins/spec-driver/scripts/lib/graph-consumption-decision.mjs` 的相对路径是否与片段一致——不要盲抄 plan 片段，需对照源码实际导出核实后落地，路径或字段名不符时以源码为准调整测试代码。
- 沿用 `tests/unit/graph-bootstrap-status.test.ts` 里 `.mjs` 动态 import 的 `@ts-expect-error` 先例写法（该文件 L21-22）。

**完成判据**：
```bash
npx vitest run tests/unit/graph-scope-extensions-contract.test.ts
npm run build
```
新测试通过，且 `tsc` 类型检查零错误（`@ts-expect-error` 注释位置准确，不多不少）。

---

## T5 — 全量验证收尾（依赖 T1-T4 全部完成）

**依赖**：T1、T2、T3、T4 全部完成。

**动作**：
1. 运行全量验证命令，全部零失败：
   ```bash
   npm run test:plugins
   npx vitest run
   npm run build
   npm run repo:check
   ```
2. （可选，非门禁）手动抽查：若本仓库 `specs/_meta/graph.json` 存在且带 F249 fingerprint，跑
   ```bash
   node plugins/spec-driver/scripts/graph-consumption-cli.mjs decide --project-root . --refresh-policy declined --dry-run
   ```
   人工确认 `scopeExtensionsSource` 字段按图实际状态正确输出，且 `.mjs` 类改动不再触发 `coverage-gap-out-of-graph-scope`。
3. 按本地开发规则（CLAUDE.local.md），全量验证通过后、commit 前，通过 Agent tool 启动 `codex:codex-rescue` 子代理执行对抗性审查（对本次改动的四份实现文件 + 五份测试文件），处置方式：
   - critical / warning 中的真实 bug / 设计缺陷 / 边界遗漏 → 立即修复并重新执行第 1 步全量验证；
   - 风格偏好 / 过度抽象建议 → 记录在 commit message 备注，不阻塞提交。
4. 全量验证 + Codex 审查处置完毕后方可 commit。

**完成判据**：上述 4 条命令全部零失败退出码，且 Codex 对抗审查的 critical/warning 项已全部处置（修复或明确记录为风格建议）。

---

## FR/回归风险覆盖映射

| plan.md 回归风险清单条目 | 覆盖任务 |
|---|---|
| 13 行决策矩阵求值顺序/出口不动 | T2（仅改常量与新增可选参数，不碰矩阵函数本体） |
| EC-07 刷新后绝不重跑矩阵 | T3（`finalizeAfterRefresh` 零改动，本次改动范围未涉及） |
| FR-010 快照校验（`snapshotMatches`）不动 | T3（`runAnnotateCaveat` 改动与快照校验并列，不互相依赖） |
| C-002"两处判据同一份面"原则不变 | T2 + T3（`collectCoverageScope` 与 `annotateImpactCaveat` 在同一次 CLI 调用内消费同一个已算好的 `scopeExtensions`） |
| B1-C6 审计闭包下限清单 | T1（`graph-bootstrap-status.mjs` 已在清单内，本次仅新增函数，非新增文件） |
| `readEmbeddedSourceCommit` 既有调用方零影响 | T1（薄壳化，返回形状逐字保持） |
| SC-005 场景语义修正（`.mjs` 不再判 out-of-scope） | T3 |
| `DECIDE_OUTPUT_KEYS` / 审计事件封闭键集新增字段 | T3 |
| `AUDIT_SCHEMA_VERSION` 2→3 | T3 |
| 跨语言一致性合同锚定 | T4 |
| 全量回归零失败 | T5 |

## 执行摘要

**阶段**: 任务分解
**状态**: 成功
**产出制品**: specs/254-fix-graph-scope-extensions/tasks.md
**关键发现**: 生成 5 个任务（T1-T5），覆盖 plan.md §1 全部函数级改动点与 §4 回归风险清单；T1/T2 可并行，T3 依赖二者，T4 依赖 T2 且可与 T3 并行，T5 全量验证收尾；纠正了 T1 目标测试文件路径（实际是 vitest 侧 `tests/unit/graph-bootstrap-status.test.ts`，而非 plugins 侧 `.mjs`，已用 Glob 核实修正）
**后续建议**: 建议实现顺序 T1 与 T2 并行开工 → T3（等待 T1+T2）与 T4（等待 T2）并行 → T5 收尾；T5 完成后按本地约定执行 Codex 对抗审查再 commit
