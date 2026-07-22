# 任务列表：F227 候选历史只读旁路 + judge 层兜底解析

**输入**：`specs/227-fix-compliance-candidate-disk-filter/plan.md`（**第四版，方案 D**）、`fix-report.md`
**模式**：fix（无 User Story 拆分；FR 覆盖对应既有 F208 FR-004/FR-005、F224、F225 的实现层判定顺序修复，不新增/变更对外 FR）
**测试框架**：`node:test` + `node:assert/strict`

> **版本说明**：本 tasks.md 基于 plan.md 第四版（方案 D）重写，取代基于第三版（方案 B′）生成的旧版本。**设计原则彻底反转**：状态机逐字不动，磁盘判据 100% 下沉到 judge 层。
>
> B′ → D 的根本变化（B′ 被否于三条 CRITICAL）：
> 1. CRITICAL 1：提名门禁与改名链耦合，真实三跳链会因中间态制品判定为"假"被提前拦截，错停在更早候选
> 2. CRITICAL 2：B′ 让原本因 ghost 覆写而被正确阻断的伪造 `mv` 场景反而命中 `trackedDir`，新增"改动前阻断、改后 fail-open"的输入集合
> 3. CRITICAL 3：`applyRename` 把任意 dst 写入 `trackedDir`，下一次提名对它调探针 → `readArtifactFile` 无根目录约束 → `../outside` 路径穿越读取
>
> 方案 D 的核心设计：
> - **core 层**：`resolveFeatureDirCandidate` **签名不变、不新增任何参数**；`scanArtifactPath`/`applyRename`/分段循环**逐字不改**；唯一新增是在 `syncCandidateFromTrackedDir` 的 `FIX_DIR_NAME_REGEX` 命中分支里插入 `candidates` 历史记录（move-to-end 去重）；返回值追加 `candidates` 字段
> - **judge 层**：新增 `usable(dir)` 判据；主候选 usable → 探针零调用、直接用；否则从 `candidates` 由后向前找第一个 usable；都没有 → 回落 `candidate.path`
> - **不再有**：探针参数、`typeof` 归一化、memoize、提名门禁、改名门禁——方案 B′ 的这些任务全部删除

## 格式：`[ID] [P?] 描述 + 文件路径`

- **[P]**：可并行（不同文件或同文件内互不依赖的独立 `describe`/`test` 块）
- 每个任务须给出验收方式

---

## Phase 0：基线捕获（Setup）

**目的**：在改动前固化"零改动前"的测试基线，供后续回归对比使用；不修改任何文件。

- [x] T001 记录改动前基线：运行 `node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`，记录通过用例总数与耗时（写入本地 scratch note，不入库）。
  **验收**：两个测试文件全部既有用例通过，记录下的通过数将作为 T012/T013 回归对比基线。

---

## Phase 1：测试先行（TDD——先写测试并确认失败）

**目的**：落地 plan.md「测试计划」的 4 组新增用例。此阶段结束时，`candidates` 字段相关用例（T002-T003）与 judge 层兜底用例（T005-T007）应因生产代码尚未改动而**全部失败**；T004（F224 强不变量组）应**已经通过**（因为它断言的是状态机现有行为，状态机在本次改动中逐字不变）。

**⚠️ 依赖**：T001 完成后开始。T002-T004 写入 `fix-compliance-core.test.mjs`；T005-T008 写入 `fix-compliance-judge-cli.test.mjs`；两组文件可并行编写。

### core 层 `candidates` 字段基本性质（对应测试计划新增用例 1）

- [x] T002 [P] 新增用例 1：`candidates` 字段基本性质。写入 `plugins/spec-driver/tests/fix-compliance-core.test.mjs`（新增 `describe('F227 candidates history - basic semantics', ...)` 块），覆盖：
  - 多次提名同一目录后重新提名另一目录 → `candidates` 顺序符合"移至末尾"语义（move-to-end，非首次出现顺序）
  - `path` 非 null 时，`assert.equal(cand.path, cand.candidates[cand.candidates.length - 1])`
  - 改名到非规范名（`ambiguous=true`）后，`candidates` 仍保留此前全部合法提名历史（不因转入 ambiguous 而清空）
  **验收**：改动前应失败（当前返回值不含 `candidates` 字段，`cand.candidates` 为 `undefined`）。

- [x] T003 [P] 补充断言：既有全部两参数调用形式的用例（158-673 行、1587-1885 行等）**零改动**——它们只读 `.path`/`.ambiguous`，新增字段不影响其通过；本任务是一个**核实性任务而非新增测试代码**，用 `git diff` 确认这些既有用例行未被修改。
  **验收**：`git diff plugins/spec-driver/tests/fix-compliance-core.test.mjs` 中除新增 `describe` 块外，既有断言零改动。

### F224 强不变量组（最高优先级——三轮否决的直接回归锚点）

- [x] T004 新增用例 2（**核心回归锚点，验证"状态机零改动"这一设计承诺**）：断言 F224 全部既有改名相关用例的 `path`/`ambiguous` 结果**与改动前逐字一致**。写入 `plugins/spec-driver/tests/fix-compliance-core.test.mjs`（新增 `describe('F227 state machine invariance - F224 rename semantics unchanged', ...)` 块），显式覆盖并逐条断言（不需要新增变体逻辑，只需要重跑既有断言并确认结果不变）：
  - `fix-compliance-core.test.mjs:1755` 三跳链 `tmp/stage-a → tmp/stage-b → specs/902-fix-final`
  - 单跳改名全部形态（`git mv`/裸 `mv`/`mv -f`/`git mv -f`）
  - option token 形态全部 7 种
  - 原地编辑准入（`sed -i`/`perl -i`）
  - 降级安全阀触发面收窄全部用例
  - ambiguous 可恢复的两跳/三跳链（含"改名链停在非规范中间态 → 仍为 ambiguous"用例）
  - mv 异常形态保守化全部 6 种跳过形态
  - 无关 mv 不改变候选
  **验收**：**由于本版状态机代码零改动，此用例组在改动前后均应通过**——这是本任务与 B′ 版本"改动前失败"测试任务的关键区别：本任务不是发现新缺陷的测试，而是**确认状态机未被触碰**的不变量证据。若实现阶段任何一条断言变红，必须视为 CRITICAL 缺陷（意味着 `scanArtifactPath`/`applyRename`/分段循环被意外改动）。

### judge 层兜底触发条件（对应测试计划新增用例 3）

- [x] T005 [P] 新增用例 3-a：主候选可用时兜底不介入（探针零调用）。写入 `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`（新增 `describe('F227 judge fallback - usable primary candidate', ...)` 块）。场景：主候选（磁盘上存在且含 `fix-report.md`）可用 → 断言兜底循环体未执行（可通过对 `candidates` 数组注入一个"若被访问则断言失败的哨兵"，或对 `readArtifactFile`/`usable` 判据加调用计数验证除主候选一次探针调用外无其他调用），判定结果与改动前逐字一致。
  **验收**：改动前该断言**不可验证**（当前生产代码没有 `usable()`/兜底循环，"零介入"这一目标行为无从体现，测试应在当前代码上因缺少可观察的兜底触发点而失败或需先被标记为待实现）；改动后必须转绿，且探针（除主候选一次）零调用是本用例的核心断言，不可省略。

- [x] T006 [P] 新增用例 3-b：主候选不可用 + 历史候选中存在可用者 → 解析到历史候选。同一 `describe` 块内追加，`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`。场景：`candidate.path` 对应目录在磁盘上不存在或存在但无 `fix-report.md`，`candidates` 历史中有一个仍然可用的更早候选 → 断言 `resolvedPath` 解析到该历史候选，判定基于它正常走完 `judgeCompliance`。
  **验收**：改动前应失败（当前生产代码无兜底逻辑，`resolvedPath` 概念不存在，判定仍基于不可用的 `candidate.path`，产生 `feature-dir` 缺失类误判）。

- [x] T007 [P] 新增用例 3-c：主候选不可用 + 历史候选也全不可用 → 完全回落现状。同一 `describe` 块内追加，`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`。场景：断言 `resolvedPath === candidate.path`（含 `null`），`featureDirUndetermined` 计算结果与改动前逐字一致（即改动前会判 `feature-dir` 缺失类判定或 F224 降级的场景，改动后结果不变）。
  **验收**：此用例应在改动前后均通过（回落路径本就等价于改动前行为）——用作"兜底逻辑不放宽无解场景"的正向锚点。

### Judge 层端到端（对应测试计划新增用例 4）

- [x] T008 新增用例 4a+4b（judge 层端到端）：沿用原有真实 transcript 复验设计（含降级方案）。写入 `plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`（新增 `describe('F227 real transcript re-verification', ...)` 块），覆盖：
  - **4a 关闭静默 fail-open**：完整 transcript（`--project-root` 指向本 worktree，`--transcript-path` 指向 `~/.claude/projects/-Users-connorlu-Desktop--workspace2-nosync-cc-plugin-market--claude-worktrees-priceless-taussig-d61d73/67720241-f20c-44af-856d-d1e976bcf3ef.jsonl`）→ 期望 `transcriptDiagnostics` 不再含 `feature-dir-unresolvable`，判定基于 `specs/225-fix-compound-command-hijack` 正常走完 `judgeCompliance`，`verdict.compliant` 为 `true`
  - **4b 关闭硬阻断假阴性**：截断到阻断时点的 transcript（`head -526`，测试内动态生成，不依赖预先落盘的 fixture）+ 当前 worktree 源码复验 → 断言不再因候选被合成路径覆写产生 `missing:["feature-dir","fix-report.md"]` 假阴性；若截断点确实缺委派证据，允许仍然阻断，但阻断原因必须可追溯到真实缺失（如委派计数为 0）
  - **若本机不存在该 transcript 路径（非本 worktree 环境），测试须优雅跳过（`t.skip`）而非失败**，避免测试套件依赖本机私有路径而不可移植
  **依赖**：T009-T011（生产代码实现）完成后此用例才能真正转绿；此处先写用例并确认在当前生产代码下复现已知缺陷。
  **验收**：改动前运行应观测到已知缺陷（4a 场景观测到 `feature-dir-unresolvable`；4b 场景观测到假阴性）；改动后应转为期望结果。

**检查点**：Phase 1 结束时，T002、T005、T006、T008 应在当前（未改动）生产代码上运行失败或复现已知缺陷；T003、T004、T007 应通过（不变量/回落锚点）。运行 `node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs` 确认上述失败模式符合预期后再进入 Phase 2。

---

## Phase 2：生产代码实现

**⚠️ 依赖**：Phase 1 全部测试任务完成（测试已写好并确认按预期失败）后开始。T009 是唯一的 core 层改动，须先于 T010（judge 层改动）完成；T011（JSDoc）可在 T009 之后任意时点插入。

### core 层：`candidates` 只读旁路（唯一新增点，`scanArtifactPath`/`applyRename` 零改动）

- [x] T009 在 `resolveFeatureDirCandidate` 中新增 `candidates` 数组与 `pushCandidateHistory` helper，插入点**唯一**为 `syncCandidateFromTrackedDir` 的 `FIX_DIR_NAME_REGEX` 命中分支（对应 plan.md 变更清单「变更 1」，原 L425-492）：
  ```js
  export function resolveFeatureDirCandidate(entries, anchorLineIndex) {
    // 函数签名不变，不新增任何参数
    let trackedDir = null;
    let candidate = null;
    let ambiguous = false;
    // F227 D：候选历史只读旁路——move-to-end 去重，仅供 judge 层"ambiguous 为假且主候选不可用时"
    // 兜底消费，不参与、不影响本函数内部任何状态转移判定（状态机逻辑与改动前逐字一致）。
    //
    // ⛔ 容器必须是保序 Map，**不得改回 `indexOf` + `splice` 的数组实现**：数组版每次提名一次线性扫描，
    // N 个互不相同的候选累计 O(N²)。实测数组版 N=20,000 → 3,034ms、N=40,000（1.26MB）→ 12,004ms，
    // Map 版两者均为个位数 ms。判定器跑在同步 Stop hook 里，几 MB 的合法 transcript 即可把门禁推到
    // 分钟级或宿主超时 → 门禁不可用或异常 fail-open。回归锚点见 T018。
    const candidateHistory = new Map();
    const pushCandidateHistory = (dir) => {
      candidateHistory.delete(dir); // 已存在则先移除，保证重新 set 落到末尾（move-to-end）
      candidateHistory.set(dir, true);
    };

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
    // scanArtifactPath、applyRename、分段循环：逐字不改
    ...
    return { path: candidate, ambiguous, candidates: Array.from(candidateHistory.keys()) };
  }
  ```
  文件：`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`。**`scanArtifactPath`、`applyRename`、分段循环（含 `hasBashWriteIndicator`/`splitCommandTextSegments` 调用顺序）在此任务中逐字不动，不新增任何判断、不接受任何探针参数。**
  **验收**：T002 转绿（`candidates` 顺序/move-to-end/ambiguous 后保留历史三项断言通过）；T004（F224 强不变量组）继续通过（因为状态机主体代码零改动）；`git diff` 核实 `scanArtifactPath`、`applyRename`、分段循环三处函数体逐字不变，仅 `syncCandidateFromTrackedDir` 内新增一行 `pushCandidateHistory(trackedDir);` 调用、函数顶部新增 `candidateHistory`/`pushCandidateHistory` 声明、返回语句新增 `candidates` 字段（由 `Array.from(candidateHistory.keys())` 产出，对外仍是数组，形状不变）。

### judge 层：主候选不可用时的只读兜底

- [x] T010 在 `fix-compliance-judge.mjs::evaluate()` 内、`resolveFeatureDirCandidate` 调用之后、`featureDirUndetermined` 计算之前插入兜底解析（对应 plan.md 变更清单「变更 2」，原 L127-140）：
  ```js
  const candidate = resolveFeatureDirCandidate(entries, anchor.anchorLineIndex);

  // F227 D：主候选磁盘不可用时的只读兜底——状态机（core 层）逐字不变，
  // 磁盘判据完全下沉到这里，且仅在 **ambiguous 为假** 且 candidate.path 不可用时才介入。
  // `candidate.ambiguous === false` 守卫不可删除、不可弱化（理由见本任务验收标准的禁止项）。
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
  其余 `evaluate()` 逻辑（`closure`、`executionRecords`、`judgeCompliance(...)` 调用、F224 收窄段 L164-178）**逐字不变**，原来读 `candidate.path` 的两处改读 `resolvedPath`。文件：`plugins/spec-driver/scripts/fix-compliance-judge.mjs`。
  **验收**：T005（主候选可用时探针零调用/兜底不介入）、T006（主候选不可用+历史可用→解析到历史候选）、T007（全不可用→完全回落）、T008（端到端）转绿；`fix-compliance-judge-cli.test.mjs` 既有全部用例（退出码矩阵、FR-010 反馈文本、FR-006 阻断计数集成）保持通过；核实"关键性质"——`usable(candidate.path)` 为真时循环体完全不执行，`resolvedPath === candidate.path`，`evaluate()` 剩余部分与改动前逐字等价。

  **⛔ 显式禁止项（不得删除或弱化 `candidate.ambiguous === false` 守卫）**：任何"简化"这条守卫的改动（删掉它、改成 `candidate.ambiguous !== undefined`、或把兜底提到守卫之外）都必须视为 CRITICAL 回归，不接受"看起来更通用"的理由。依据：
  - `ambiguous === true` 是 F224 的**合法降级通道**，改动前恒定 exit 0 放行（`featureDirUndetermined` → `feature-dir-unresolvable` 诊断 → `runHook` 见诊断即 exit 0）
  - 若允许该分支也兜底，被选中的历史候选可能 `usable`（有 `fix-report.md`）却不足以通过完整合规判定：本仓库 48 个含 `fix-report.md` 的历史 `NNN-fix-*` 目录中 **21 个缺 `verification/verification-report.md`**，任一被兜底选中即触发 `featureDirUndetermined` 由真变假 → 不再早退 → `compliant:false` → `routeBlock` → **exit 0 反转为 exit 2 误阻断**
  - 消融实验（只删这一个条件、跑 10 场景差分矩阵）已**精确复现 1 例 0→2 反转**，不是理论风险
  - 单调性不变量表述：兜底解析只允许把"改动前阻断"转为"改动后放行"，绝不允许反向；删掉守卫即违反该不变量

### JSDoc：三条已知限界

- [x] T011 在 `resolveFeatureDirCandidate` 函数头 JSDoc 中新增不变量说明，并在 core 层或 judge 层合适位置（`resolveFeatureDirCandidate` 头部注释，已知限界二/三涉及 judge 层行为可在 `evaluate()` 内联注释处呼应）写入**三条**已知限界（措辞不得声称已解决）：
  1. **`candidates` 不变量说明**：`candidates` 中每个元素都曾在某一时刻满足 `FIX_DIR_NAME_REGEX`；顺序 = 最近一次被合法提名的先后顺序（move-to-end，非首次出现顺序）；`path` 非 null 时 `path === candidates[candidates.length - 1]`；`path` 为 null 时 `candidates` 仍保留此前全部合法提名历史，供调用方按需兜底
  2. **已知限界一（必须原样写入 plan.md L180 的完整表述）**：「冒用已存在且制品齐全的历史特性目录：用户已明确知情并接受。这在改动前已存在（只需把该提名放在最后一条使其成为 last-writer-wins 的赢家）；方案 D 的效果是让它在**主候选不可用（且 `ambiguous === false`）**这一分支里对提名位置不再敏感——不需要是最后一条，只要曾被合法提名过就可能被兜底选中。真实案例（会话写入自己的目录）与该攻击构造（会话写入他人的目录）在 transcript 文本上完全同构，判定器原理上无法区分意图；彻底关闭需要"制品确由本次会话创建"的带外证据（mtime/git 状态），而这类证据在 commit/rebase/worktree 重新检出后会失准，代价超出本次修复范围」
  3. **已知限界二（必须原样写入 plan.md L181 的完整表述，须明确标注"改动前既有缺陷，方案 D 不引入、不修复、也不使其更易触发"）**：「F224 fail-open 降级通道可被 transcript 中伪造的 `mv` 文本触发：改动前既有缺陷（编排器已在未修改源码 + 磁盘零目录场景下独立复现），方案 D 不引入、不修复、也不使其更易触发——状态机零改动意味着可触发该降级通道的 transcript 输入集合与改动前逐字相同。已另开独立跟进项」
  4. **已知限界三（范围说明；**严禁**写成"F224 语义完全保住"式的夸大，也**严禁**写成"ambiguous 支也会兜底"）**：
     > **注（实现期修订）**：plan.md L182 原表述描述的是"在 `ambiguous === true` 的 F224 合法降级场景下也改走历史候选"。该行为在实现期被**否决并反转**——因为它会把 F224 的 exit 0 放行反转为 exit 2 误阻断（依据见 T010 的显式禁止项）。落地实现加了 `candidate.ambiguous === false` 守卫，`ambiguous === true` 支**兜底完全不介入、连探针都不调用**。本条限界按落地实现如实改写，**不得**按 plan.md 原文照抄。
     实际写入措辞要点：本次修复只覆盖"主候选被幽灵路径覆写、指向磁盘上不存在的目录"这一支（`ambiguous === false`）；由 transcript 中伪造/合成的 `mv` 文本导致 `ambiguous === true` 从而落入 F224 fail-open 的另一支**不在本次范围**（介入它必然引入新的误阻断），已另开独立跟进项。同时须写明单调性不变量：兜底解析只可能把"改动前阻断"转为"改动后放行"，绝不可能反向。
  文件：`plugins/spec-driver/scripts/lib/fix-compliance-core.mjs`（不变量说明 + 已知限界一、二写在此处 `resolveFeatureDirCandidate` 头部）；`plugins/spec-driver/scripts/fix-compliance-judge.mjs`（已知限界三就近写在 `evaluate()` 内新增兜底解析代码块的注释中，因为该限界描述的是兜底解析触发时的 judge 层行为差异）。
  **验收**：目视核对 JSDoc/注释文本与 plan.md L127-130（不变量）、L180（限界一）、L181（限界二）逐字一致（允许 Markdown 转注释所需的必要转义，不得删减或改写实质内容）；限界二必须出现"改动前既有缺陷""不引入、不修复"字样；限界三按上方实现期修订后的范围说明写入，**必须**出现"不在本次范围"与单调性不变量表述，**不得**出现"F224 语义完全保住"式夸大，也**不得**保留 plan.md L182 原文中"ambiguous 支会改走历史候选"的已被否决表述；`npm run build` 不受影响。

**检查点**：Phase 2 结束时，两处生产改动完成，`scanArtifactPath`/`applyRename`/分段循环逐字未变，`resolveFeatureDirCandidate` 返回值形状变为 `{ path, ambiguous, candidates }`（增字段不改形），`evaluate()` 在主候选可用时行为与改动前逐字等价。

---

## Phase 3：既有回归验证（零容忍改动）

**⚠️ 依赖**：Phase 2 完成后开始。

- [x] T012 [P] 运行并核实 `fix-compliance-core.test.mjs` 全部既有用例（含 codex C-2 六条反 Goodhart 硬化断言、F224 全部 describe 块：改名跟随/option token 形态/原地编辑准入/降级安全阀触发面收窄/多次改名混用/ambiguous 可恢复/mv 异常形态保守化/无关 mv 不改变候选、F225 同段共现全部用例）全部保持通过，**不修改任何既有断言的预期值**。命令：`node --test plugins/spec-driver/tests/fix-compliance-core.test.mjs`。
  **验收**：通过用例数 ≥ T001 记录的基线数（新增 T002-T004 后应为「基线 + N」，N 取决于用例内 `test()` 拆分粒度）；`git diff` 确认该文件内除新增 `describe` 块外无其他行变更，尤其 `fix-compliance-core.test.mjs:1755` 三跳链用例断言本身未被修改。

- [x] T013 [P] 运行并核实 `fix-compliance-judge-cli.test.mjs` 全部既有用例（退出码矩阵、FR-010 反馈文本、FR-006 阻断计数集成）保持通过，**不修改任何既有断言的预期值**。命令：`node --test plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`。
  **验收**：通过用例数 ≥ T001 记录的基线数（新增 T005-T008 后应增加）；`git diff` 确认该文件内除新增 `describe` 块外无其他行变更。

---

## Phase 4：真实 Transcript 端到端复验（人工确认，双表现覆盖）

**⚠️ 依赖**：Phase 2 完成后开始；可与 Phase 3 并行执行（不同验证维度，互不阻塞）。

- [x] T014 手动运行 plan.md「测试计划新增用例 4」给出的复验命令，逐条核实两种真实表现均已关闭：
  ```bash
  # 关闭静默 fail-open（完整 transcript）
  node plugins/spec-driver/scripts/fix-compliance-judge.mjs --mode report \
    --transcript-path ~/.claude/projects/-Users-connorlu-Desktop--workspace2-nosync-cc-plugin-market--claude-worktrees-priceless-taussig-d61d73/67720241-f20c-44af-856d-d1e976bcf3ef.jsonl \
    --project-root "$PWD"
  # 期望：transcriptDiagnostics 不含 feature-dir-unresolvable，verdict.compliant === true

  # 关闭硬阻断假阴性（截断到阻断时点）
  head -526 ~/.claude/projects/-Users-connorlu-Desktop--workspace2-nosync-cc-plugin-market--claude-worktrees-priceless-taussig-d61d73/67720241-f20c-44af-856d-d1e976bcf3ef.jsonl > /tmp/trunc526.jsonl
  node plugins/spec-driver/scripts/fix-compliance-judge.mjs --mode report \
    --transcript-path /tmp/trunc526.jsonl --project-root "$PWD"
  # 期望：不再因候选被合成路径覆写产生 missing:["feature-dir","fix-report.md"] 假阴性；
  #      若截断点确实缺委派证据，允许仍然阻断，但阻断原因必须是真实缺失（委派计数为 0）
  ```
  **验收**：两条命令输出均与上方期望一致；若本机不存在该 transcript 路径（非本 worktree 环境），本任务标注为"环境受限跳过"，改为核实 T008 自动化测试（含相同断言逻辑）已转绿作为等价证据。

---

## Phase 5：收尾验证（Polish）

**⚠️ 依赖**：Phase 3、Phase 4 全部完成后开始。

- [x] T015 运行 `npm run test:plugins`，确认零失败（含新增 4 组用例）。
  **验收**：命令退出码为 0，输出无 fail 项。

- [x] T016 运行 `npm run build`，确认零错误。
  **验收**：命令退出码为 0。

- [x] T017 运行 `npm run repo:check`，确认通过。
  **验收**：命令退出码为 0，无 CRITICAL/WARNING 阻断项（如有 INFO 级提示需在 verify 阶段记录处置结论）。

---

## Phase 6：实现期追加（评审发现的收尾修正）

**来源**：实现完成后的对抗审查/评审发现，不属于原 plan.md 变更清单，但属于同一改动面的必要收尾。

- [x] T018 新增候选历史容器复杂度回归锚点（防止把 Map 改回数组实现）。写入 `plugins/spec-driver/tests/fix-compliance-core.test.mjs`（新增 `describe('F227 candidate history complexity - anti-regression anchor', ...)` 块，**纯追加，不修改任何既有断言的预期值**）：单条 Bash tool_use 的 command 内放 20,000 个互不相同的合法候选（`specs/${100000 + i}-fix-a/fix-report.md`，前置 `echo x > /tmp/y ` 提供同段写指示符以满足 F225 判据），断言解析墙钟 < 2s，并同时断言 `candidates.length` / 首末位元素 / `path === candidates[candidates.length - 1]` / `ambiguous === false` 与小规模用例同形。
  **验收**：Map 实现下用例通过且耗时为个位数 ms；消融验证（临时把容器改回 `indexOf` + `splice` 数组实现）该用例必须变红。实测：Map 版 5.57ms 通过；数组版 2,996ms 失败（断言消息命中"退化为二次复杂度"）。阈值 2s 的选取依据写入用例上方注释（数组版 N=20,000 → 3,034ms、N=40,000 → 12,004ms；判定器跑在同步 Stop hook 内，退化会导致门禁超时/异常 fail-open）。

- [x] T019 修复真实 transcript 用例组对仓库运行态的污染。文件：`plugins/spec-driver/tests/fix-compliance-judge-cli.test.mjs`。
  问题：该组用例把真实 worktree（`REPO_ROOT`）当 `--project-root`，其中 hook 模式那条走 fail-open 分支会调 `tryAppendFailOpenEvent` → `appendAuditEvent`，**每跑一次测试就往真实仓库 `.specify/runs/YYYY-MM.jsonl` 追加一条伪造降级事件**（实测已累计 11 条）。虽被 gitignore 不入仓，但污染本地审计流水与 adoption-insights 统计，且违反该文件其余用例一律 tmp 隔离的约定。
  修法：新增 `stageIsolatedRoot()` helper，在 `tmp` 内构造隔离 project root 并最小化铺上 `specs/225-fix-compound-command-hijack/fix-report.md` + `verification/verification-report.md`；hook 模式那条改用该隔离 root。`--mode report` 的两条只读用例保留 `REPO_ROOT`（`runReport` 只调 `evaluate`，恒零落盘，已核实 `appendAuditEvent` 不在其调用链上）。**不得为规避污染删除任何断言。**
  同时在该组用例上方如实标注证据强度：截断实录那条只断言"不同时缺 `feature-dir`/`fix-report`"及 hook exit 0，若截断内容退化成非 fix 会话或 transcript 本身触发 fail-open，这两条断言仍会通过——它们是单调性护栏而非阳性覆盖，**核心回归覆盖来自合成的"幽灵覆写"用例**。
  **验收**：`git diff -U0 plugins/spec-driver/tests/ | grep -cE "^-[^-]"` 结果反映的删除行仅限被替换的 `--project-root` 参数行，零断言预期值改动；跑完整 `npm run test:plugins` 后 `.specify/runs/2026-07.jsonl` 行数不再因测试而增长。

---

## FR / 判据覆盖映射表

| 覆盖对象 | 对应任务 |
|---|---|
| plan.md 变更 1：`resolveFeatureDirCandidate` 新增 `candidates` 数组 + `pushCandidateHistory` helper（唯一插入点：`syncCandidateFromTrackedDir`） | T009 |
| plan.md 变更 1：`scanArtifactPath`/`applyRename`/分段循环**零改动** | T009（验收含 `git diff` 核实零改动）、T004（F224 强不变量组回归锚点）、T012（既有回归） |
| plan.md 变更 1：返回值新增 `candidates` 字段 | T009、T002 |
| plan.md 变更 2：`fix-compliance-judge.mjs::evaluate()` 新增 `usable()` 判据 + 兜底查找循环 | T010 |
| plan.md JSDoc：`candidates` 不变量说明 | T011 |
| plan.md JSDoc：已知限界一（冒用已存在合规目录） | T011 |
| plan.md JSDoc：已知限界二（F224 fail-open 可被伪造 mv 触发，既有缺陷不修复） | T011 |
| JSDoc：已知限界三（实现期修订为范围说明——`ambiguous === true` 支不在本次范围 + 单调性不变量；不得夸大为"完全保住"，也不得照抄 plan.md L182 已被否决的表述） | T011 |
| `candidate.ambiguous === false` 守卫不可删除/弱化（显式禁止项 + 消融证据） | T010 |
| 候选历史容器复杂度（Map 而非数组，O(N) 而非 O(N²)）回归锚点 | T009、T018 |
| 测试不得污染真实 worktree 运行态（`.specify/runs/*.jsonl`） | T019 |
| 测试计划新增用例 1（`candidates` 字段基本性质） | T002、T003 |
| 测试计划新增用例 2（F224 强不变量：状态机零改动） | T004 |
| 测试计划新增用例 3（judge 层兜底触发条件：主候选可用/不可用+有历史/不可用+无历史） | T005、T006、T007 |
| 测试计划新增用例 4（judge 层端到端，两种表现） | T008、T014 |
| 既有回归零容忍（`fix-compliance-core.test.mjs`） | T012 |
| 既有回归零容忍（`fix-compliance-judge-cli.test.mjs`） | T013 |
| 验证命令清单（`npm run test:plugins` / `build` / `repo:check`） | T015、T016、T017 |
| F208 FR-004/FR-005（fail-open 按维度收窄，逐字不变；`featureDirUndetermined` 改用 `resolvedPath` 计算） | T010、T013（回归确认） |
| F224 改名跟随/原地编辑准入/ambiguous 可恢复语义（`applyRename` 零改动） | T004、T009、T012 |
| F225 同段共现判据（逐字不变） | T012 |
| 三条 CRITICAL 收口对照（CRITICAL 1/2/3 均因状态机零改动 + 探针不接触 `applyRename` 而消失） | T009（core 层零改动）、T010（judge 层探针仅作用于 `candidate.path`/`candidates` 数组元素，两者均由 `FIX_DIR_NAME_REGEX` 产出不含 `..`） |
| Constitution XI「PASS with documented deviation」已知限界一（位置敏感→位置不敏感，仅 `ambiguous === false` 且主候选不可用的分支） | T011（JSDoc）、T006（对应测试场景） |

**覆盖率**：plan.md 全部 2 处生产改动（含"状态机零改动"这一负向约束）、4 组新增测试用例、2 处既有回归验证、三条已知限界的 JSDoc 写入、1 处真实 transcript 端到端复验、3 项收尾验证命令，共 100% 映射到任务列表。

---

## 依赖与执行顺序说明

### Phase 依赖关系

- **Phase 0（基线捕获）**：无依赖，最先执行
- **Phase 1（测试先行）**：依赖 Phase 0 完成 —— 阻塞 Phase 2
- **Phase 2（生产代码实现）**：依赖 Phase 1 全部测试任务写完并确认预期失败模式 —— 阻塞 Phase 3、Phase 4
- **Phase 3（既有回归验证）**：依赖 Phase 2 完成
- **Phase 4（真实 transcript 端到端复验）**：依赖 Phase 2 完成，可与 Phase 3 并行
- **Phase 5（收尾验证）**：依赖 Phase 3 与 Phase 4 均完成

### 任务间依赖

- T002、T003、T004 同写 `fix-compliance-core.test.mjs`，建议顺序提交避免合并冲突；**T004 是最高优先级任务**，应尽早完成以确认状态机不变量
- T005、T006、T007、T008 同写 `fix-compliance-judge-cli.test.mjs` 同一/相邻 `describe` 块，建议顺序编写（T005-T007 共享同一批 fixture helper，T008 共享 transcript 截断逻辑）
- T009 是唯一 core 层生产改动，完成后必须立即用 `git diff` 核实 `scanArtifactPath`/`applyRename`/分段循环三处零字节改动，再继续 T010
- T010 依赖 T009（judge 层消费 `candidate.candidates` 字段前 core 层需先产出该字段）
- T011（JSDoc）依赖 T009（core 层部分）与 T010（judge 层部分，已知限界三就近写在兜底解析代码块）均完成
- T012、T013 可并行（不同文件的既有回归验证）
- T014 依赖 T010（生产代码就绪），可与 T012/T013 并行
- T015/T016/T017 建议顺序执行（`test:plugins` → `build` → `repo:check`），任一失败需回到对应 Phase 修复后重跑本 Phase 全部三项

### 并行机会

- Phase 1 内 core 文件任务（T002-T004）与 judge-cli 文件任务（T005-T008）分属不同文件，可完全并行
- Phase 3 的 T012 与 T013 分属不同测试文件，可完全并行运行
- Phase 4 的 T014（人工复验）可与 Phase 3 的自动化回归并行执行，互不阻塞

### 推荐实现策略

**顺序单人实施**（本 fix 改动面小，LOW 风险，方案 D 相比 B′ 进一步收窄了 core 层回归面——`scanArtifactPath`/`applyRename`/分段循环三处逐字不变，不建议拆分并行团队）：

1. T001（基线）→ Phase 1 全部测试任务（T002-T008，写测试确认失败模式），**优先完成 T004（F224 强不变量组）**，它是验证"状态机零改动"这一设计承诺的核心证据，应在实现前后都保持通过
2. Phase 2 两处生产改动（T009→T010→T011），T009 完成后立即用 `git diff` 核实 `scanArtifactPath`/`applyRename`/分段循环零改动
3. Phase 3 回归验证 + Phase 4 端到端复验（可并行）
4. Phase 5 收尾三项验证命令
5. 按仓库约定，提交前对本次改动执行 Codex 对抗审查（不属于 tasks.md 任务范围，由编排流程另行触发），重点核实：(a) `candidates` 记录点是否真的唯一收敛在 `syncCandidateFromTrackedDir`；(b) judge 层 `usable()` 判据是否只作用于 `candidate.path`/`candidates` 数组元素，未引入新的路径穿越向量；(c) 已知限界三的措辞是否按实现期修订如实写入（`ambiguous === true` 支不在本次范围 + 单调性不变量），未被简化为"F224 语义完全保住"；(d) `candidate.ambiguous === false` 守卫是否仍在（删除即 CRITICAL）
