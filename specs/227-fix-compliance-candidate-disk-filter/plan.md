# 修复规划（F227）：候选历史只读旁路 + judge 层兜底解析

> **修订说明**：本 plan 为第四版，经三轮 Codex 对抗审查迭代。
> - **第一版 方案 A**（resolver 吐候选集合 + judge 侧无条件取最后存活者）：被 C2（集合求交论证在 last-writer-wins 基线下不成立）、C3（过滤后 0 回落分支在有其他存活候选时根本不触发，F224 降级语义未被保住）证伪，已否决。
> - **第二版 方案 C**（提名门禁 + 改名门禁，均以"目录是否存在"为判据，磁盘事实注入状态转移本身）：被硬伤 1（改名门禁直接打掉 F224 改名跟随的定义性前提——判定时点旧目录必然已不存在）、硬伤 2（概念错误，把"终态是否存在"当成"历史事件是否发生"的判据）证伪，已否决。
> - **第三版 方案 B′**（仅提名门禁，判据改为"制品是否存在"，"不得顶替真实候选"）：被三条 CRITICAL 证伪——CRITICAL 1（提名门禁与改名链仍有耦合，真实三跳改名会因中间态制品判定为"假"被门禁提前拦截，错停在更早的候选）、CRITICAL 2（B′ 反而让原本因 ghost 覆写而被正确阻断的伪造 `mv` 场景变成命中 `trackedDir`，产生新的"改动前阻断、改后 fail-open"输入集合）、CRITICAL 3（`applyRename` 把任意 dst 写入 `trackedDir`，下一次提名对其调用 `isReal` 时把该值喂给磁盘探针，而 `readArtifactFile` 无根目录约束，构成路径穿越读取）。三个已否决方案的**共同根因**：都试图把磁盘终态快照注入状态机内部的转移逻辑——文本描述的是历史事件序列，磁盘给的是终态快照，混进同一个状态机必然自相矛盾。已否决。
> - 本版落地编排器已核实、用户已拍板的**方案 D（状态机逐字不动，磁盘只在消费端兜底）**：`resolveFeatureDirCandidate` 不接受任何探针参数，状态转移代码零改动；唯一新增是把状态机已经产生的历史序列以只读方式暴露为 `candidates` 字段；磁盘判据完全下沉到 `fix-compliance-judge.mjs`，且仅在主候选（`candidate.path`，与改动前逐字一致的计算结果）不可用时才介入兜底查找，不影响主候选可用的绝大多数场景。
> - **Phase 4a spec-review 回填修正**：实现阶段发现方案 D 的原始兜底条件（仅 `!usable(resolvedPath)`）存在正确性缺陷——会把 F224 合法降级（`ambiguous === true`，今天 exit 0 fail-open）反转成 exit 2 误阻断。已实测量化并补齐 `candidate.ambiguous === false` 守卫，详见「变更 2」「单调性不变量」「已知限界」三节。此为实现阶段发现的必要修正，非重新推翻方案 D。

## 概要（Summary）

`resolveFeatureDirCandidate`（core 层，纯函数）是一个 last-writer-wins 单值状态机：每次合法提名（Write/Edit 命中制品路径，或 Bash 同段共现写指示符 + artifact 路径）与每次改名跟随都会无条件覆写 `trackedDir`/`candidate`/`ambiguous`。会话自身写下的 fixture/repro 文本（形如 `echo body > specs/300-fix-real/fix-report.md`）能覆写真实候选；文本里的合成 `mv`（如残留尾字符 `specs/301-fix-new')`）还会把候选带到一个物理上不存在的非规范名目录，触发 `ambiguous`。

**同一根因有两种真实表现**（均已用实际二进制复现，详见 fix-report.md「同一根因的两种表现」表）：
- 插件缓存 4.3.0（不含 F224/F225，hook 实际挂载版本）：阻断时点判 `missing:["feature-dir","fix-report.md"]` → **exit 2 硬阻断**，即用户实际遭遇的现象
- 当前 worktree 源码（含 F224/F225，即将发布版本）：同一 transcript 判 `feature-dir-unresolvable` → **exit 0 静默 fail-open**（F224 降级通道接住）——门禁对坍塌会话同样会静默失效，是更隐蔽的失效模式

**修复方案（方案 D）核心洞察**：三次否决共同暴露的问题是"把磁盘终态快照当成参与状态转移判定的输入"——无论注入点在提名还是改名，都会让"历史上发生过什么"这个纯文本问题掺入"当前磁盘长什么样"这个末态问题，两者语义不可通约。方案 D 彻底切断这个耦合：

1. **状态机（`scanArtifactPath`/`applyRename`/`syncCandidateFromTrackedDir`/分段循环）逐字不改**，不接受任何探针参数，`path`/`ambiguous` 的计算结果与改动前逐字相同
2. **唯一新增**：返回值追加只读的 `candidates` 字段——锚点后全部曾满足 `FIX_DIR_NAME_REGEX` 的合法候选历史，保序、move-to-end 去重（同一目录重新命中时移到末尾）。这是对状态机已产生序列的旁路记录，**不参与、不影响**任何状态转移判定
3. `fix-compliance-judge.mjs::evaluate()` 在磁盘核验环节新增**兜底解析**：仅当 `candidate.ambiguous === false` 且主候选 `candidate.path` 不可用（不存在或缺 `fix-report.md`）时，才从 `candidates` 历史里由后向前找第一个可用的作为 `resolvedPath`；`ambiguous === true`（F224 降级场景）时兜底完全不介入；仍找不到可用候选则完全回落现状（`resolvedPath = candidate.path`）

**与已否决的方案 A 的本质区别**：方案 A 无条件取"候选集合里最后存活者"；方案 D 只在**主候选（改动前逐字一致的计算结果）不可用、且不处于 F224 降级态**时才触发兜底查找——主候选可用的场景（绝大多数正常调用）与 F224 合法降级场景（`ambiguous === true`）都行为不变，磁盘事实只在"状态机已经判定为普通目录缺失"这一个更窄的分支里介入。

## 技术上下文

- **语言**：Node.js ESM（`.mjs`），零运行时依赖（spec-driver Constitution X）
- **改动文件**：2 个生产文件，0 个新文件
- **纯函数边界更严格**：`resolveFeatureDirCandidate` **不新增任何参数**（不是依赖注入，是彻底不接受磁盘信号），比第三版的"探针依赖注入"更进一步地维持 research.md D3 分层契约——core 层从"可被注入探针的纯函数"退回到"完全不知道磁盘存在"的纯函数，磁盘判据 100% 收拢在 judge 层
- **不确定项**：无（fix-report.md 已完成三轮 Codex 对抗审查处置 + Phase 4a 回填修正；本 plan 不含 `NEEDS CLARIFICATION`）

## Codebase Reality Check

| 文件 | LOC | 导出函数/公开接口 | 已知 debt |
|------|-----|------|-----------|
| `plugins/spec-driver/scripts/lib/fix-compliance-core.mjs` | 758 | `resolveFeatureDirCandidate`、`parseRenameOperands`、`extractDelegationsAfter`、`classifyClosureForm`、`judgeCompliance` 等（core 纯函数集） | 0 TODO/FIXME/HACK。`checkArtifactSection`（L569-583）占位符残留检测的同族缺陷、F224 fail-open 降级通道可被伪造 `mv` 触发（详见"已知限界"）均已记录为独立 follow-up，**不在本次修复范围** |
| `plugins/spec-driver/scripts/fix-compliance-judge.mjs` | 450 | `parseArgs`、`buildFeedbackText`、`evaluate`（内部）、`main` | 0 TODO/FIXME/HACK |

**前置清理判定**：本次预计净增量：
- `fix-compliance-core.mjs`：`resolveFeatureDirCandidate` 新增 `candidates` 数组 + move-to-end 去重 helper（在唯一的 `syncCandidateFromTrackedDir` 汇合点里插入一行调用），预计 **+8～12 行**；`scanArtifactPath`/`applyRename` 的转移逻辑**零改动**
- `fix-compliance-judge.mjs`：`evaluate()` 内新增 `usable()` 判据 + 兜底查找循环（含 `ambiguous === false` 守卫），预计 **+12～18 行**

均远低于"LOC > 500 且新增 > 50 行"的前置 cleanup 触发线。**不触发前置 cleanup task**，无 `[CLEANUP]` 任务。

## Impact Assessment

- **直接修改文件**：2 个（`fix-compliance-core.mjs`、`fix-compliance-judge.mjs`），均位于 `plugins/spec-driver/scripts/` 内
- **间接受影响（调用方）**：Grep 核实全仓 `resolveFeatureDirCandidate` 引用（Spectra MCP `impact` 对该 `.mjs` symbol 返回 `symbol-not-found`——该脚本族未纳入当前图谱，按偏好规则降级 Grep fallback）。生产消费方**唯一**为 `fix-compliance-judge.mjs`；`fix-compliance-io.mjs`/`scripts/dev/spike-fix-compliance-e2e.mjs` 仅 JSDoc 注释提及，无 import。测试文件 `fix-compliance-core.test.mjs`（1903 行）、`fix-compliance-judge-cli.test.mjs`（913 行）需新增用例
- **状态机零改动带来的回归面收敛**：`scanArtifactPath`/`applyRename`/`syncCandidateFromTrackedDir`（除新增一行 `candidates` 记录调用外）/分段循环全部逐字未改——F224 全部改名相关 describe 块（目录改名跟随、option token 形态、原地编辑准入、多次改名/混用叠加取最终态、ambiguous 可恢复、mv 异常形态保守化、无关 mv 不改变候选）与 F225 同段共现全部用例在**结构上**不可能因本次改动而回归
- **跨包影响**：无——改动完全限于 `plugins/spec-driver/` 单包内
- **数据迁移**：无
- **API/契约变更**：`resolveFeatureDirCandidate` 新增 `candidates` 字段（增字段不改形，`path`/`ambiguous` 逐字不变）；`evaluate()` 的最终返回形状不变，下游 `main()`/`routeBlock`/`releaseDegraded` 零改动
- **风险等级**：**LOW**（影响文件 2 个直接 + 2 个测试文件，无跨包影响，无数据迁移，`path`/`ambiguous` 计算逻辑零变更）——不要求分阶段实现
- **范围外说明（不在本次修复，仅记录避免误认为遗漏）**：
  1. `parseRenameOperands` 吞尾字符 `')` 的词法层解析宽范（第一轮审查 W1）——本次不修，真实案例已由 judge 层兜底在下游兜住
  2. `checkArtifactSection`（L569-583）占位符残留检测的两个叠加缺陷——已另记为独立 follow-up
  3. 插件分发漂移（hook 实际挂载的插件缓存 4.3.0 与 worktree 源码 hash 不同，缓存版不含 F224/F225）——发布/同步流程问题，不属于本次判定逻辑修复范围
  4. **F224 fail-open 降级通道可被 transcript 中伪造的 `mv` 文本触发**（第二轮审查方发现，编排器已独立复现）：这是**改动前就已存在**的独立缺陷，状态机零改动意味着可触发该通道的 transcript 输入集合与改动前逐字相同，方案 D 不引入、不修复、也不使其更易触发。已另开独立跟进项

## Constitution Check

| 原则 | 适用性 | 评估 | 说明 |
|------|-------|------|------|
| I. 双语文档规范 | 适用 | PASS | 本 plan 及后续 diff 注释均中文散文 + 英文标识符 |
| II. Spec-Driven Development | 适用 | PASS | 经由 fix 模式全流程，本次 plan 已按三轮 Codex 对抗审查反馈迭代到第四版，并在 Phase 4a spec-review 后回填一处实现阶段发现的正确性修正 |
| III. YAGNI | 适用 | PASS | `candidates` 是对既有状态机内部序列的直接暴露，无新配置项、无新组件；方案 A/C/B′ 均已在 fix-report.md 中被否决并记录理由 |
| IV. 诚实标注不确定性 | 适用 | PASS | 已知限界三条如实标注，含 Phase 4a 回填修正的量化风险面（48 个历史目录中 21 个缺 verification-report.md）与本次修复的精确覆盖范围（仅 `ambiguous === false` 支），不夸大为"F224 语义完全保住" |
| IX. Prompt 编排 + Harness 强制 | 适用 | PASS | 改动限于 Harness 层（Hooks 挂载的 judge CLI 与其纯函数依赖） |
| X. 零运行时依赖 | 适用 | PASS | 不新增任何 npm 依赖 |
| XI. 质量门控不可绕过 | 适用 | **PASS with documented deviation** | 方案 D 在"`ambiguous === false` 且主候选不可用"这一分支内确实制造了"阻断 → 放行"的结果转变：冒用已存在且制品齐全的历史特性目录，从改动前的"必须是 transcript 中最后一条提名才能生效（位置敏感）"变为"只要曾被合法提名过、且主候选不可用，就能被兜底选中（位置不敏感）"。这是有意识的、用户已明确知情并接受的偏离，详见下方"单调性不变量"与"已知限界"，而非声称"不放宽" |
| XII. 验证铁律 | 适用 | PASS | 验证计划含两种表现（硬阻断二进制 + 静默 fail-open 二进制）的双重复验 + F224 全部既有改名用例的"状态机零改动"强不变量显式断言 + `ambiguous === false` 守卫的消融回归 |
| XIII. 向后兼容 | 适用 | PASS | `candidates` 为增字段，`path`/`ambiguous` 逐字不变；主候选可用或处于 F224 降级态时 `evaluate()` 行为与改动前逐字一致 |
| XIV. 可观测性与架构守护 | 适用 | PASS | 无删除/重命名；无新循环依赖；已知限界与单调性论证均写入 JSDoc 供后续可追溯 |

无 VIOLATION，无需豁免（豁免形式为"PASS with documented deviation"，理由已充分记录）。

## 变更清单

### 变更 1：`fix-compliance-core.mjs::resolveFeatureDirCandidate`（L425-492）

**函数签名不变**（不新增任何参数）：

```js
export function resolveFeatureDirCandidate(entries, anchorLineIndex) {
```

**新增内部状态与 helper**（紧邻既有 `trackedDir`/`candidate`/`ambiguous` 声明处）：

```js
let trackedDir = null;
let candidate = null;
let ambiguous = false;
// F227 D：候选历史只读旁路——move-to-end 去重，仅供 judge 层"主候选不可用时"兜底消费，
// 不参与、不影响本函数内部任何状态转移判定（状态机逻辑与改动前逐字一致）。
const candidates = [];
const pushCandidateHistory = (dir) => {
  const idx = candidates.indexOf(dir);
  if (idx !== -1) candidates.splice(idx, 1);
  candidates.push(dir);
};
```

**`syncCandidateFromTrackedDir` 唯一插入点**（原 L436-446，这是 `scanArtifactPath` 与 `applyRename` 共用的唯一汇合点，无需在两处转移入口分别改动）：

```js
const syncCandidateFromTrackedDir = () => {
  if (trackedDir !== null && FIX_DIR_NAME_REGEX.test(trackedDir)) {
    candidate = trackedDir;
    ambiguous = false;
    pushCandidateHistory(trackedDir); // F227 D：只在合法命名时记入候选历史
  } else {
    candidate = null;
    ambiguous = true;
  }
};
```

**`scanArtifactPath`、`applyRename`、分段循环逐字不改**（原 L448-490 全部保留，不新增任何判断、不接受任何探针）。

**返回值**：

```js
return { path: candidate, ambiguous, candidates };
```

**不变量**（写入 JSDoc）：
- `candidates` 中每个元素都曾在某一时刻满足 `FIX_DIR_NAME_REGEX`
- 顺序 = 最近一次被合法提名的先后顺序（move-to-end，非首次出现顺序）
- `path` 非 null 时，`path === candidates[candidates.length - 1]`
- `path` 为 null 时，`candidates` 仍保留此前全部合法提名历史，供调用方按需兜底

### 变更 2：`fix-compliance-judge.mjs::evaluate()`（L127-140）

**修改点**：在 `resolveFeatureDirCandidate` 调用之后、`featureDirUndetermined` 计算之前插入兜底解析：

```js
const candidate = resolveFeatureDirCandidate(entries, anchor.anchorLineIndex);

// F227 D：主候选磁盘不可用时的只读兜底——状态机（core 层）逐字不变，
// 磁盘判据完全下沉到这里，且仅在 candidate.ambiguous === false 且 candidate.path 不可用时才介入。
const usable = (dir) => dir !== null && readArtifactFile(projectRoot, `${dir}/fix-report.md`).exists;
let resolvedPath = candidate.path;
if (candidate.ambiguous === false && !usable(resolvedPath)) {
  const history = Array.isArray(candidate.candidates) ? candidate.candidates : [];
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (usable(history[i])) {
      resolvedPath = history[i];
      break;
    }
  }
  // 循环内一个都没命中 → resolvedPath 保持初值 candidate.path（含 null）：完全回落现状
}

const featureDirUndetermined = resolvedPath === null && candidate.ambiguous === true;

const delegations = extractDelegationsAfter(entries, anchor.anchorLineIndex);
const featureDirCheck = checkFeatureDirOnDisk(projectRoot, resolvedPath);
const fixReport = resolvedPath
  ? readArtifactFile(projectRoot, `${resolvedPath}/fix-report.md`)
  : { exists: false, content: null, nonEmpty: false };
const verificationReport = resolvedPath
  ? readArtifactFile(projectRoot, `${resolvedPath}/verification/verification-report.md`)
  : { exists: false, content: null, nonEmpty: false };
```

**为何必须保留 `candidate.ambiguous === false` 守卫**（Phase 4a spec-review 回填修正，源自实现阶段的量化实测）：若省略该条件（原始版本只有 `!usable(resolvedPath)`），F224 合法降级场景（`ambiguous === true`，改动前是 exit 0 fail-open）会被兜底逻辑反转成 exit 2 阻断，即**新增误阻断**——这与方案 D 的设计初衷（只把阻断转放行、不能反向）直接矛盾。风险面已实测量化：本仓库 48 个含 `fix-report.md` 的历史 `NNN-fix-*` 目录中 **21 个缺 `verification-report.md`**，只要其中任一被兜底误选中即会触发这种反转。消融实验（只删除 `candidate.ambiguous === false &&` 这一个条件，跑 10 场景改动前/改动后退出码差分矩阵）精确复现 1 例 `0 → 2` 反转，证明该守卫既必要又充分。

其余 `evaluate()` 逻辑（`closure`、`executionRecords`、`judgeCompliance(...)` 调用、F224 收窄段 L164-178）**逐字不变**，只是原来读 `candidate.path` 的两处改读 `resolvedPath`。

**关键性质**：`candidate.ambiguous === true`（F224 降级态）或 `usable(candidate.path)` 为真（主候选可用）时，循环体完全不执行，`resolvedPath === candidate.path`，`evaluate()` 剩余部分与改动前**逐字等价**——这是与已否决方案 A（无条件取候选集合最后存活者）的本质区别，详见下方"单调性不变量"。

## 单调性不变量

方案 D 的核心安全性质可归纳为一句话：**兜底只可能把改动前的阻断转为放行，绝不可能把放行转为阻断。** 三分支论证：

- `ambiguous === true` → 兜底完全不介入（`candidate.ambiguous === false && !usable(resolvedPath)` 的短路求值使 `usable()` 一次都不被调用，可由探针调用计数机械观测），F224 fail-open（exit 0）逐字保持
- `ambiguous === false` 且主候选可用 → `!usable(resolvedPath)` 为假，兜底不触发，与改动前逐字一致
- `ambiguous === false` 且主候选不可用 → 改动前必然是「特性目录/诊断报告缺失」类 exit 2 阻断；兜底后要么仍阻断（原因可能不同，仍是 exit 2），要么转为放行

## 三条 CRITICAL 收口对照（逐条对应）

| CRITICAL | 方案 D 下为何消失 |
|------|------|
| CRITICAL 1（提名门禁与改名链耦合，三跳链错停在更早候选） | 状态机（含 `applyRename` 三跳链跟随）逐字未改 → 照常解析到 `specs/902-fix-final` → 该值是 `candidate.path` 且磁盘上真实存在（真实改名产生的真实目录）→ `usable(candidate.path)=true` → 兜底循环完全不触发 → 结果与改动前逐字一致 |
| CRITICAL 2（B′ 让原本因 ghost 覆写而被正确阻断的伪造 `mv` 场景变成新的 fail-open 输入） | 状态机零改动 → ghost 照常覆写候选、伪造 `mv` 照常因 `src !== trackedDir` 被忽略 → `candidate.path`/`ambiguous` 的取值与改动前逐字相同 → 不新增任何"改动前阻断、改后 fail-open"的输入 |
| CRITICAL 3（`applyRename` 任意 dst 被喂进磁盘探针，`readArtifactFile` 无根目录约束，构成路径穿越读取） | `applyRename` 完全不接触任何探针（本版方案 core 层压根不存在探针参数）；judge 层的 `usable()` 只作用于 `candidate.path` 与 `candidates` 数组元素，两者都由 `ARTIFACT_PATH_REGEX`/`FIX_DIR_NAME_REGEX` 产出，形如 `specs/NNN-fix-<name>`，不含 `..`；改名 dst 若不满足 `FIX_DIR_NAME_REGEX` 则 `candidate=null` 且**不会**被 `pushCandidateHistory` 记入 `candidates`（只在合法命名分支才记入）——路径穿越向量彻底关闭，不依赖任何"事后过滤"技巧 |

## 已知限界（写入 JSDoc，措辞不得声称已解决）

1. **冒用已存在且制品齐全的历史特性目录**：用户已明确知情并接受。这在改动前已存在（只需把该提名放在最后一条使其成为 last-writer-wins 的赢家）；方案 D 的效果是让它在**`ambiguous === false` 且主候选不可用**这一分支里对提名位置不再敏感——不需要是最后一条，只要曾被合法提名过就可能被兜底选中。真实案例（会话写入自己的目录）与该攻击构造（会话写入他人的目录）在 transcript 文本上完全同构，判定器原理上无法区分意图；彻底关闭需要"制品确由本次会话创建"的带外证据（mtime/git 状态），而这类证据在 commit/rebase/worktree 重新检出后会失准，代价超出本次修复范围
2. **F224 fail-open 降级通道可被 transcript 中伪造的 `mv` 文本触发**：改动前既有缺陷（编排器已在未修改源码 + 磁盘零目录场景下独立复现），方案 D **不引入、不修复、也不使其更易触发**——状态机零改动意味着可触发该降级通道的 transcript 输入集合与改动前逐字相同。已另开独立跟进项
3. **本次修复的范围（Phase 4a 回填修正，替换已被证伪的旧表述）**：只覆盖「主候选被幽灵路径覆写、指向磁盘上不存在的目录」这一支（`candidate.ambiguous === false`）。由 transcript 中伪造的 `mv` 文本导致 `candidate.ambiguous === true` 从而落入 F224 fail-open 的另一支**不在本次范围**——介入它必然引入新的误阻断（见上方"为何必须保留 `ambiguous === false` 守卫"与"单调性不变量"两节的实测论证），属独立取舍。**旧表述已被证伪并删除**：原第三版曾表述为"F224 合法降级场景下退出码不变、只改变放行理由与审计记录"，实现阶段的量化实测（21/48 历史目录缺 verification-report.md）证明该表述不成立——若不加 `ambiguous === false` 守卫，该场景会真实反转为新增的 exit 2 误阻断，而非"结果等价"

## 测试计划

### 新增用例 1（core 层，`candidates` 字段基本性质）：`fix-compliance-core.test.mjs`

- 多次提名同一目录后重新提名另一目录 → `candidates` 顺序符合"移至末尾"语义（非首次出现顺序）
- `path` 非 null 时，`assert.equal(cand.path, cand.candidates[cand.candidates.length - 1])`
- 改名到非规范名（`ambiguous=true`）后，`candidates` 仍保留此前全部合法提名历史（不因转入 ambiguous 而清空）
- **既有全部两参数调用形式的用例（158-673 行、1587-1885 行等）零改动**——它们只读 `.path`/`.ambiguous`，新增字段不影响其通过

### 新增用例 2（core 层，F224 强不变量：状态机零改动）：`fix-compliance-core.test.mjs`

**这是三轮否决教训的直接回归锚点**：断言 F224 全部既有改名相关用例（含 `fix-compliance-core.test.mjs:1755` 三跳链 `tmp/stage-a → tmp/stage-b → specs/902-fix-final`、单跳改名全部形态、option token 形态全部 7 种、原地编辑准入、降级安全阀触发面收窄全部用例、ambiguous 可恢复的两跳/三跳链、mv 异常形态保守化全部 6 种跳过形态、无关 mv 不改变候选）的 `path`/`ambiguous` 结果**与改动前逐字一致**——由于本版状态机代码零改动，这组既有断言本身就是最强证据，不需要新增变体，只要求它们在实现后依然全部原样通过

### 新增用例 3（judge 层，兜底触发条件）：`fix-compliance-judge-cli.test.mjs`

- 主候选可用（磁盘上存在且含 `fix-report.md`）→ 断言兜底逻辑不介入（可通过对 `candidates` 数组注入一个"如果被访问就会导致断言失败的哨兵"或等价手段验证循环体未执行），判定与改动前一致
- 主候选不可用（`candidate.path` 对应目录在磁盘上不存在，或存在但无 `fix-report.md`）+ `candidates` 历史中有一个仍然可用的更早候选 + `candidate.ambiguous === false` → 断言 `resolvedPath` 解析到该历史候选，判定基于它正常走完
- 主候选不可用 + `candidates` 历史中也没有任何可用候选 → 断言完全回落现状（`resolvedPath === candidate.path`，含 `null`），`featureDirUndetermined` 计算结果与改动前逐字一致
- **`ambiguous === false` 守卫消融回归（Phase 4a 新增，必须显式覆盖）**：构造 `candidate.ambiguous === true` 且 `candidates` 历史中存在可用候选的场景 → 断言兜底不触发（`usable()` 对历史候选零调用），判定仍走 F224 fail-open（exit 0），**不得**被误反转为 exit 2

### 新增用例 4（judge 层端到端）：`fix-compliance-judge-cli.test.mjs`

- 真实 transcript 复验（`--project-root` 指向本 worktree）：

```bash
node plugins/spec-driver/scripts/fix-compliance-judge.mjs --mode report \
  --transcript-path /Users/connorlu/.claude/projects/-Users-connorlu-Desktop--workspace2-nosync-cc-plugin-market--claude-worktrees-priceless-taussig-d61d73/67720241-f20c-44af-856d-d1e976bcf3ef.jsonl \
  --project-root "$PWD"
```

  期望：`transcriptDiagnostics` 不再含 `feature-dir-unresolvable`，判定基于 `specs/225-fix-compound-command-hijack` 正常走完 `judgeCompliance`，`verdict.compliant` 为 `true`

- 补充覆盖"硬阻断"表现：用截断到阻断时点的 transcript（`head -526`）+ 当前 worktree 源码复验，断言判定不再因候选被合成路径覆写而产生 `missing:["feature-dir","fix-report.md"]` 这类假阴性

### 既有回归（零容忍改动）

- `fix-compliance-core.test.mjs` 全部既有用例（含 codex C-2 六条反 Goodhart 硬化断言、F224 全部 describe 块、F225 同段共现全部用例）必须全部保持通过，**不修改任何既有断言的预期值**
- `fix-compliance-judge-cli.test.mjs` 全部既有用例（退出码矩阵、FR-010 反馈文本、FR-006 阻断计数集成）必须全部保持通过

### 验证命令清单

```bash
npm run test:plugins        # 零失败（含新增 4 组用例）
npm run build                # 零错误
npm run repo:check           # 通过
```

## 风险评估

| 风险 | 等级 | 缓解 |
|------|------|------|
| `candidates` 数组在病态大 transcript 下增长导致兜底循环变慢 | LOW | 兜底循环只在 `ambiguous === false` 且主候选不可用时才执行，调用次数上界 = `candidates` 长度（不同合法命名目录数，受 20MB transcript 体积上限间接约束）；`ambiguous === true` 或主候选可用（绝大多数场景）时循环完全不执行 |
| **已知限界一·有意接受**：冒用已存在且制品齐全的历史特性目录，从位置敏感变为位置不敏感（仅在 `ambiguous === false` 且主候选不可用分支） | 已知、用户已明确接受 | 详见"已知限界"节；委派计数判据仍能拦住零委派的真坍塌；implement 阶段必须把此限界原样写入 JSDoc，不得表述为"已解决" |
| **已知限界二·既有缺陷**：F224 fail-open 降级通道可被伪造 `mv` 文本触发 | 已知、改动前已存在、本次不引入不修复 | 已另开独立跟进项；状态机零改动 → 可触发输入集合与改动前逐字相同 |
| **Phase 4a 已修正的风险**：兜底条件缺失 `ambiguous === false` 守卫会把 F224 合法降级反转为新增误阻断 | 已修正（不再是残留风险，列此行供审计追溯） | 已实测量化（48 个历史目录中 21 个缺 verification-report.md）+ 消融实验精确复现 1 例反转，已在「变更 2」补齐守卫；测试计划新增例 3 的消融回归用例防止未来回退 |
| `parseRenameOperands` 吞尾字符 `')` 的词法层解析宽松（第一轮审查 W1） | LOW，已知、有意不在本次范围 | 真实案例已由 judge 层兜底解析在下游兜住；收紧词法层留作独立 Feature |
| 插件分发漂移（hook 挂载缓存 4.3.0 落后于本次修复） | LOW，范围外 | 本次修复完成并交付 master 后，需经正常发布/同步流程使缓存版本追上 |
| `checkArtifactSection` 占位符残留检测的同族缺陷 | LOW，范围外 | fix-report.md 已记录为独立 follow-up；本次不修 |

## Complexity Tracking（偏离简单方案的决策）

| 决策 | 理由 | 拒绝的更简单方案 |
|------|------|------|
| 状态机逐字不改，磁盘判据完全下沉 judge 层（方案 D）而非探针注入状态机内部（方案 B′/C） | 三轮审查共同暴露：把磁盘终态快照注入状态机内部转移逻辑必然自相矛盾（文本历史序列 vs 磁盘终态快照，语义不可通约）。方案 D 让 core 保持"完全不知道磁盘存在"的最强纯函数边界，把全部磁盘判据集中到 judge 层一处 | 方案 B′：`artifactExists` 依赖注入到 `scanArtifactPath`——已否决，CRITICAL 1/2/3 均因磁盘信号混入状态转移逻辑而产生 |
| 兜底逻辑"仅 `ambiguous === false` 且主候选不可用时才触发"而非"无条件取候选集合最后存活者" | 若无条件取最后存活者（方案 A 原设计），主候选可用或处于 F224 降级态时的场景也会被兜底逻辑改写判定依据，扩大了改动的行为影响面；实现阶段量化实测证明省略 `ambiguous === false` 守卫会把 F224 合法降级反转为新增误阻断（21/48 历史目录缺 verification-report.md）。补齐守卫后，行为差异严格限定在"改动前会判定为普通目录缺失（非 F224 降级态）"这一个更窄的分支内 | 方案 A：无条件取候选集合最后存活者——已否决，被 C2/C3 证伪；本方案早期实现（缺 `ambiguous === false` 守卫）——已被 Phase 4a 量化实测证伪，已回填修正 |
| `candidates` 记录点收敛到 `syncCandidateFromTrackedDir` 单一汇合点，不在 `scanArtifactPath`/`applyRename` 分别插入 | `syncCandidateFromTrackedDir` 是两条转移路径唯一共用的状态同步函数，在此插入一行记录调用即可覆盖全部合法命中场景，且保证状态机主体代码（含分段循环、判据条件）逐字不改，改动面最小化 | 在 `scanArtifactPath`/`applyRename` 内各自维护候选历史——已否决，会在两处分别引入代码、增加与状态机主体代码耦合的改动面 |
| 不引入"制品确由本次会话创建"的带外证据（mtime/git 状态）来关闭已知限界一 | 真实案例与冒用攻击在 transcript 文本上完全同构，候选选择规则原理上无法区分；带外证据本身在 commit/rebase/worktree 重新检出后会失准，引入新的误判面 | 用文件 mtime 或 git 状态判断"制品是否本次会话新建"——已评估并否决 |
| 不在本次顺带修复"F224 fail-open 降级通道可被伪造 mv 触发"（已知限界二） | 这是与本次改动正交的独立缺陷，改动前已存在；顺带修复会扩大本次改动范围、混淆两个不同问题的验证面 | 在本次一并加固降级通道的触发条件——已否决，超出本次修复范围，另开独立跟进项 |

## Spec 影响

无需更新 spec：本次是既有 FR（F208 FR-004/FR-005、F224、F225）实现层判定顺序缺陷的修复，不新增/变更对外行为契约；`candidates` 为向后兼容的增字段，`ambiguous === true` 或主候选可用时 `evaluate()` 行为逐字不变。
