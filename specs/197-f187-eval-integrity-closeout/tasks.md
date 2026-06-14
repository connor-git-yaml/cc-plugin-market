---
feature: 197
artifact: tasks
mode: fix
status: ready
---

# Tasks: F197 评测设施公正性收口

**特性目录**: `specs/197-f187-eval-integrity-closeout/`
**依赖文档**: `fix-report.md`（根因 + Codex 处置）、`plan.md`（变更清单 + TDD 清单 + 实施顺序）
**缺陷清单**: C1（排名污染）、C2（freeze 不写 hash）、W1（数据集错配）、W2（promptSha256 仅 write-only）、W3（git 外锚未实现）、W4（W3 覆盖替代）+ CRITICAL（fixtureContentHash 无闭环）

**注意**：6 个缺陷存在合约耦合（preregistration-check 的新 export 被 freeze + cohort-batch 依赖），
**不可原子拆分**，在单 implement phase 内按依赖顺序完成。

---

## Phase 1: TDD — 先写失败测试

> **重要**：所有测试必须在实现之前写好，并确认当前 FAIL。确认 FAIL 是 TDD 的关键步骤。

**目的**：写出全部失败测试，确立验收基准，再进入实现 Phase。

**验证命令（每个测试写完后运行，确认 FAIL）**:
- `npx vitest run tests/unit/feature-187-classify-oracle.test.ts`
- `npx vitest run tests/unit/feature-176-preregistration.test.ts`
- `npx vitest run tests/unit/feature-187-freeze-block.test.ts`
- `npx vitest run tests/unit/feature-187-dataset-build.test.ts`（可选，W1 映射）

---

### T001 [C1] 写 C1 三交叉失败测试

**缺陷**: C1 — classify-oracle 排名污染（report.completed===true 被 OOM 启发式覆盖）
**文件**: `tests/unit/feature-187-classify-oracle.test.ts`
**操作**: 在现有 `CASES` 数组末尾追加三个交叉用例，一个 `it.each` 遍历：
- 用例 1：`{report:{completed:true,resolved:true}, logText:'Killed', phaseReached:'done'}` → 期望 classification=`'pass'`，failureSource=`'none'`
- 用例 2：`{report:{completed:true,resolved:true}, logText:'OOMKilled', harnessExitCode:137, phaseReached:'done'}` → 期望 classification=`'pass'`
- 用例 3：`{report:{completed:true,resolved:true}, harnessExitCode:137, phaseReached:'done', logText:''}` → 期望 classification=`'pass'`
- 用例 4（resolved===null fall through）：`{report:{completed:true,resolved:null}, harnessExitCode:0, phaseReached:'done', logText:''}` → 期望 classification **不是** `'pass'`
**验证（必须 FAIL）**: `npx vitest run tests/unit/feature-187-classify-oracle.test.ts`
**验收**: 3 个新 case 红灯（当前行序错误，resolved=true 会被 OOM 启发式短路 → 返回 fail）

---

### T002 [P] [W2] 写 W2 promptSha256 比对失败测试

**缺陷**: W2 — promptSha256 write-only，无解析+比对
**文件**: `tests/unit/feature-176-preregistration.test.ts`
**操作**: 追加以下 4 个测试 case（建议新 `describe('W2 promptSha256比对')` 块）：
- `computeDriverPromptSha256()` 确定性：同进程调两次结果相同 → `expect(a).toBe(b)`
- 喂不符 promptSha256 给 checkPreregistration → `ok=false`，reason 含 `'promptSha256'`（依赖 parsePreregistration 能解析 frontmatter 的 `promptSha256:` 行）
- prereg 无 `promptSha256` 字段，opts 传 promptSha256 → `ok=true`（向后兼容）
- prereg 有 `promptSha256`，opts 不传 → `ok=true`（只 present+live 才比对）
**验证（必须 FAIL）**: `npx vitest run tests/unit/feature-176-preregistration.test.ts`
**验收**: 比对失败用例报红（parsePreregistration 当前不解析 promptSha256）

---

### T003 [P] [W3] 写 W3 gitState 拦截失败测试

**缺陷**: W3 — FR-005-d 未实现（git 外锚）
**文件**: `tests/unit/feature-176-preregistration.test.ts`
**操作**: 追加 `describe('W3 gitState外锚')` 块：
- `trackedClean=false` → `ok=false`，reason 含 `'dirty'`（或含中文 `'未提交'`）
- `codeMatchesFrozen=false`（prereg 含 gitCommit）→ `ok=false`，reason 含 `'漂移'` 或 `'冻结'`
- 两者均 true → `ok=true`（不拦截）
- gitState 仅在 `swebench-execution` kind 生效：`opts.oracleKind='ast-diff', gitState={trackedClean:false}` → `ok=true`
**验证（必须 FAIL）**: `npx vitest run tests/unit/feature-176-preregistration.test.ts`
**验收**: git 拦截用例报红（checkPreregistration 当前无 gitState 逻辑）

---

### T004 [P] [CRITICAL] 写 fixtureContentHash 闭环失败测试

**缺陷**: CRITICAL — fixtureContentHash 无闭环比对（Codex 对抗审查升级）
**文件**: `tests/unit/feature-176-preregistration.test.ts`
**操作**: 追加 `describe('CRITICAL fixtureContentHash闭环')` 块：
- `computeFixtureContentHash(['t1'], dir)` fixture 内容改一字节 → live hash 变（两次 hash 不等）
- taskId 不变但 fixture JSON 内容换版 → checkPreregistration 比对拦截 → `ok=false`，reason 含 `'fixtureContentHash'`
- prereg 有 `fixtureContentHash`，opts 传不符 live hash → `ok=false`
- prereg 无 `fixtureContentHash`（旧格式向后兼容）→ `ok=true`
**验证（必须 FAIL）**: `npx vitest run tests/unit/feature-176-preregistration.test.ts`
**验收**: 比对拦截用例报红（computeFixtureContentHash 尚不存在）

---

### T005 [P] [C2] 写 C2 freeze 端到端三字段失败测试

**缺陷**: C2 — freeze 工具不写 oracleSpecHash/fixtureContentHash/promptSha256
**文件**: `tests/unit/feature-187-freeze-block.test.ts`
**操作**: 追加 `describe('C2 freeze端到端三字段')` 块：
- `freezeBlock(ids, {oracleSpecInput, fixtureContentHash:'x'.repeat(64), promptSha256:'y'.repeat(64)})` → block 含三字段
- `renderFrozenPrereg(block)` 产出 frontmatter 含 `oracleSpecHash` / `fixtureContentHash` / `promptSha256` / `schemaVersion`
- renderFrozenPrereg 后再 `parsePreregistration` → 三字段值与 block 一致（round-trip 不丢字段）
- 重跑 renderFrozenPrereg（相同 block）字段不丢
- freeze 端到端 → checkPreregistration(`oracleKind:'swebench-execution'`, `oracleSpecInput`=同一输入) → `ok=true`
**验证（必须 FAIL）**: `npx vitest run tests/unit/feature-187-freeze-block.test.ts`
**验收**: renderFrozenPrereg 当前不渲染扩展字段 → 测试报红

---

### T006 [P] [W1] 写 W1 datasetTagToHfId + 错配诊断失败测试

**缺陷**: W1 — Lite/Verified dataset 错配，fetchOfficialRows 无明确诊断
**文件**: `tests/unit/feature-187-dataset-build.test.ts`（新建）
**操作**: 新建测试文件，写以下 5 个用例：
- `datasetTagToHfId('lite')` → `'SWE-bench/SWE-bench_Lite'`
- `datasetTagToHfId('verified')` → `'SWE-bench/SWE-bench_Verified'`
- `datasetTagToHfId(null)` → `'SWE-bench/SWE-bench_Lite'`（默认，向后兼容）
- `datasetTagToHfId('unknown')` → throw（不静默回退）
- 数据集错配诊断：stub `fetchOfficialRows` 返回空数组 → `mismatches[0].reason` 含 `'数据集错配'` + dataset 名，`mismatches[0].failureSource === 'fixture'`
**验证（必须 FAIL）**: `npx vitest run tests/unit/feature-187-dataset-build.test.ts`
**验收**: datasetTagToHfId 不存在 → import 报错

---

## Phase 2: 实现（严格按合约依赖顺序 a→h）

> 合约依赖关系：
> - a（swebench-dataset-build.mjs）← d（swebench-oracle.mjs）← g（freeze-preregistration.mjs）← h（cohort-batch）
> - e（eval-task-runner.mjs）← f（preregistration-check.mjs）← g、h
> - c（classify-oracle.mjs）独立，无下游依赖
> - b（swebench_fetch_rows.py）依赖 a 的错配诊断语义，但不阻塞其他步骤

---

### T007 [W1] 实现 a：swebench-dataset-build.mjs 新增 datasetTagToHfId

**缺陷**: W1
**文件**: `scripts/lib/swebench-dataset-build.mjs`
**操作**:
1. 在 `DEFAULT_DATASET` 常量（行 14 附近）之后新增并 export `datasetTagToHfId(tag)` 映射函数：
   - `'lite'` 或 `null` → `'SWE-bench/SWE-bench_Lite'`
   - `'verified'` → `'SWE-bench/SWE-bench_Verified'`
   - 未知/其他 → `throw new Error('未知 dataset tag: ...')`
2. 在 `buildLocalDataset` 内，行 72 missing 实例诊断处，将 `mismatches.push` 升级为含 `failureSource: 'fixture'` + reason 含 `'数据集错配'` + dataset 名 + 缺失实例 id
**注意**: 此文件在 `SEMANTIC_MODULES`，修改后 oracleSpecHash 变更属设计预期
**验证**: `npx vitest run tests/unit/feature-187-dataset-build.test.ts`（目标：5 个用例全绿）

---

### T008 [P] [W1] 实现 b：swebench_fetch_rows.py 补 DATASET_MISMATCH 前缀

**缺陷**: W1（辅助）
**文件**: `scripts/lib/swebench_fetch_rows.py`
**操作**: 行 24 missing 实例 stderr 输出补充 `DATASET_MISMATCH:` 前缀：
```python
if missing:
    print(f"DATASET_MISMATCH: instance_id 不在 {dataset_name}: {sorted(missing)}", file=sys.stderr)
    return 1
```
**注意**: 此文件在 `SEMANTIC_MODULES`，修改后 oracleSpecHash 变更属设计预期。此步骤**不阻塞**其他实现步骤（T009 可并行）
**验证**: 目视确认 `scripts/lib/swebench_fetch_rows.py` 行 24 附近 stderr 输出含 `DATASET_MISMATCH:` 前缀

---

### T009 [P] [C1] 实现 c：classify-oracle.mjs 决策表行序修正

**缺陷**: C1
**文件**: `scripts/lib/classify-oracle.mjs`
**操作**: 在行 77（pre-test timeout 检查结束）与行 79（`isOOM/timedOut` 检查）之间插入：
```js
// C1 修正：report.completed===true 时无条件以 report 判（优先于启发式）
// resolved===null 时 fall through 到启发式/fallback，不强判
if (report && report.completed === true) {
  return report.resolved === true
    ? verdict('pass', 'none', 'harness completed + resolved（C1 report 优先）')
    : report.resolved === false
      ? verdict('fail', 'candidate', 'harness completed 但 resolved=false（C1 report 优先）')
      : null; // resolved===null → fall through（此 null 使外层自动 fall through）
}
```
行 84-88 原有 `if (report)` 块中 `completed===true` 的 pass/fail 两分支随之成为死代码可删；`completed===false` 分支**保留原位**（timeout × completed===false 仍判 candidate fail，不洗成 error）
**注意**: 此文件在 `SEMANTIC_MODULES`，oracleSpecHash 变更预期。此步骤**无下游合约依赖**，可与 T008 并行
**验证**: `npx vitest run tests/unit/feature-187-classify-oracle.test.ts`（目标：C1 三交叉 + 现有回归用例全绿）

---

### T010 [W1] 实现 d：swebench-oracle.mjs 透传 datasetName（依赖 T007）

**缺陷**: W1
**文件**: `scripts/lib/swebench-oracle.mjs`
**依赖**: T007（datasetTagToHfId 必须先存在）
**操作**: 行 123 附近：
1. 从 `swebench-dataset-build.mjs` import `datasetTagToHfId`
2. 在 `buildLocalDataset` 调用之前计算 `const datasetName = datasetTagToHfId(fixture.swebenchMeta?.dataset);`
3. 调用改为 `buildLocalDataset({ fixtures: [fixture], outPath: datasetPath, datasetName, venvPath: absVenv })`
**验证**: `npx vitest run tests/unit/feature-187-oracle-pipeline.test.ts`（如有）+ `npm run build`（类型检查）

---

### T011 [W2] 实现 e：eval-task-runner.mjs 新增 computeDriverPromptSha256 export

**缺陷**: W2
**文件**: `scripts/eval-task-runner.mjs`
**操作**: 仅在文件尾部追加（不改任何现有逻辑）：
```js
import * as crypto from 'node:crypto'; // 若已存在则复用，不重复 import

/**
 * W2：promptSha256 = sha256(buildDriverPrompt 函数源码字符串)。
 * buildDriverPrompt 措辞任何改动 → hash 变 → 预注册拦截。
 * 不改 buildDriverPrompt 本身（SC-013 golden 逐字守护）。
 */
export function computeDriverPromptSha256() {
  return crypto.createHash('sha256').update(buildDriverPrompt.toString()).digest('hex');
}
```
**零改约束**: `buildDriverPrompt` 函数体措辞、签名、行为**绝对不改**（SC-013 cohort golden 逐字一致）
**验证**: `npx vitest run tests/unit/feature-176-preregistration.test.ts`（T002 中 computeDriverPromptSha256 确定性用例变绿）+ `npm run build`

---

### T012 [W2/W3/CRITICAL] 实现 f：preregistration-check.mjs 三处修改（依赖 T011）

**缺陷**: W2 / W3 / CRITICAL
**文件**: `scripts/lib/preregistration-check.mjs`
**依赖**: T011（computeDriverPromptSha256 必须先 export，以便比对用例可测试）
**操作（按优先顺序）**:

**f-a：parsePreregistration 新增解析 `promptSha256` + `gitCommit`**（行 72-109 解析循环内）:
```js
let promptSha256 = null;
let gitCommit = null;
// 循环内增加：
const promptM = line.match(/^\s*promptSha256:\s*["']?([0-9a-fA-F]{64})["']?\s*$/);
if (promptM) promptSha256 = promptM[1].toLowerCase();
const gcM = line.match(/^\s*gitCommit:\s*["']?([0-9a-f]{7,40})["']?\s*$/);
if (gcM) gitCommit = gcM[1];
```
返回对象增加 `promptSha256`、`gitCommit` 字段（行 108 返回对象）

**f-b：新增并 export `computeFixtureContentHash(taskIds, fixturesDir)`**（CRITICAL）:
```js
/**
 * fixtureContentHash：taskIds 排序去重 → 逐文件读 <fixturesDir>/<id>.json 原始内容算 sha256
 * → stableStringify({id: sha}) → 整体 sha256。
 * 任一 fixture 内容变更 → hash 变 → 预注册拦截。
 */
export function computeFixtureContentHash(taskIds, fixturesDir) {
  const sorted = [...new Set(taskIds)].sort();
  const perFile = {};
  for (const id of sorted) {
    const raw = fs.readFileSync(path.join(fixturesDir, `${id}.json`), 'utf-8');
    perFile[id] = crypto.createHash('sha256').update(raw).digest('hex');
  }
  return crypto.createHash('sha256').update(stableStringify(perFile)).digest('hex');
}
```
确认文件顶部有 `import * as fs from 'node:fs'`、`import * as path from 'node:path'`、`import * as crypto from 'node:crypto'`、`import stableStringify from ...`（或等价）

**f-c：checkPreregistration 增三比对**（在 oracleSpecHash 比对之后，`swebench-execution` kind 分支内）:
```js
const { promptSha256: frozenPromptSha, gitCommit: frozenGitCommit, fixtureContentHash: frozenFCH } = parsed;
// W2：promptSha256 比对（present+live 才比对）
if (frozenPromptSha && opts.promptSha256 != null) {
  if (opts.promptSha256 !== frozenPromptSha) {
    return { ok: false, reason: `promptSha256 不符（prompt 模板已漂移）。frozen=${frozenPromptSha.slice(0,12)} live=${opts.promptSha256.slice(0,12)}`, ... };
  }
}
// CRITICAL：fixtureContentHash 比对
if (frozenFCH && opts.fixtureContentHash != null) {
  if (opts.fixtureContentHash !== frozenFCH) {
    return { ok: false, reason: `fixtureContentHash 不符（fixture 内容在冻结后换版）。frozen=${frozenFCH.slice(0,12)} live=${opts.fixtureContentHash.slice(0,12)}`, ... };
  }
}
// W3：gitState 比对（仅 swebench-execution kind）
if (opts.gitState) {
  if (!opts.gitState.trackedClean) {
    return { ok: false, reason: 'worktree 有未提交改动（git 外锚失效，拒绝跑批）', ... };
  }
  if (frozenGitCommit && opts.gitState.codeMatchesFrozen === false) {
    return { ok: false, reason: `代码自冻结 commit(${frozenGitCommit.slice(0,8)}) 起已漂移（git 外锚拦截）`, ... };
  }
}
```
**验证**: `npx vitest run tests/unit/feature-176-preregistration.test.ts`（目标：T002/T003/T004 全部用例变绿）

---

### T013 [C2] 实现 g：freeze-preregistration.mjs 四处修改（依赖 T007/T011/T012）

**缺陷**: C2 / W4
**文件**: `scripts/freeze-preregistration.mjs`
**依赖**: T007（datasetTagToHfId）、T011（computeDriverPromptSha256）、T012（computeFixtureContentHash）
**操作**:

**g-a：`main` 函数增加 CLI 选项解析**:
```js
const swebenchOracle = argv.includes('--swebench-oracle');
const manifestIdx = argv.indexOf('--manifest');
const manifestPath = manifestIdx >= 0 ? argv[manifestIdx + 1] : null;
```

**g-b：swebench 模式下计算三字段**（在 `freezeBlock(...)` 调用之前）:
```js
let oracleSpecInput = null;
let fixtureContentHash = null;
let promptSha256 = null;
if (swebenchOracle) {
  const { buildLiveOracleSpecInput, loadExperimentManifest } = await import('./swe-bench-verified-cohort-batch.mjs');
  const { computeDriverPromptSha256 } = await import('./eval-task-runner.mjs');
  const { computeFixtureContentHash } = await import('./lib/preregistration-check.mjs');
  const manifest = manifestPath ? loadExperimentManifest(manifestPath) : undefined;
  oracleSpecInput = buildLiveOracleSpecInput(manifest);
  fixtureContentHash = computeFixtureContentHash(taskIds, fixturesDir());
  promptSha256 = computeDriverPromptSha256();
}
const block = freezeBlock(taskIds, { seed: 176, oracleSpecInput, fixtureContentHash, promptSha256, gitCommit });
```

**g-c：`renderFrozenPrereg` 渲染扩展字段**（在现有 gitCommit 行之后、taskIds 之前插入，条件渲染）:
```js
...(block.oracleSpecHash     ? [`oracleSpecHash: ${block.oracleSpecHash}`]     : []),
...(block.fixtureContentHash ? [`fixtureContentHash: ${block.fixtureContentHash}`] : []),
...(block.promptSha256       ? [`promptSha256: ${block.promptSha256}`]         : []),
...(block.schemaVersion      ? [`schemaVersion: ${block.schemaVersion}`]       : []),
```

**g-d：`main` 包 try/catch**（W4 Codex 处置）:
```js
async function main() {
  try {
    // ... 现有逻辑 ...
  } catch (e) {
    if (/无法从 venv 读取 swebench 版本/.test(e.message)) {
      console.error('[freeze-prereg] ❌ swebench-execution 冻结需先 setup-swebench-venv.sh');
      process.exit(2);
    }
    console.error('[freeze-prereg] ❌ 冻结失败:', e.message);
    process.exit(1);
  }
}
```
**验证**: `npx vitest run tests/unit/feature-187-freeze-block.test.ts`（目标：T005 全部用例变绿）+ `npm run build`

---

### T014 [W2/W3/CRITICAL] 实现 h：cohort-batch entryValidation 注入 live 值（依赖 T011/T012）

**缺陷**: W2 / W3 / CRITICAL
**文件**: `scripts/swe-bench-verified-cohort-batch.mjs`
**依赖**: T011（computeDriverPromptSha256）、T012（computeFixtureContentHash，parsePreregistration 新字段）
**操作**: `entryValidation` 函数内，`swebenchOracle` 模式的 `preregOpts` 构造处（行 180 附近）注入三个 live 值：
```js
if (args.manifest?.swebenchOracle) {
  const { computeDriverPromptSha256 } = await import('./eval-task-runner.mjs');
  const { computeFixtureContentHash } = await import('./lib/preregistration-check.mjs');

  // W3：git 外锚状态计算
  const preregForGit = parsePreregistration(fs.readFileSync(PREREG, 'utf-8'));
  const frozenGitCommit = preregForGit.gitCommit;
  const preregRel = path.relative(PROJECT_ROOT, PREREG); // 必须相对路径，绝对路径致 :(exclude) 失效
  const diffCleanR = spawnSync('git', ['-C', PROJECT_ROOT, 'diff', '--quiet'], { encoding: 'utf-8' });
  const diffCachedR = spawnSync('git', ['-C', PROJECT_ROOT, 'diff', '--cached', '--quiet'], { encoding: 'utf-8' });
  const trackedClean = diffCleanR.status === 0 && diffCachedR.status === 0;
  let codeMatchesFrozen = true;
  if (frozenGitCommit) {
    const driftR = spawnSync('git', ['-C', PROJECT_ROOT, 'diff', frozenGitCommit, 'HEAD', '--', '.', `:(exclude)${preregRel}`], { encoding: 'utf-8' });
    codeMatchesFrozen = (driftR.stdout || '').trim() === '';
  }

  preregOpts = {
    oracleKind: 'swebench-execution',
    oracleSpecInput: buildLiveOracleSpecInput(args.manifest),
    promptSha256: computeDriverPromptSha256(),
    fixtureContentHash: computeFixtureContentHash(taskIds, fixturesDir()),
    gitState: { trackedClean, codeMatchesFrozen },
  };
}
```
**注意**: `preregRel` 必须用 `path.relative(PROJECT_ROOT, PREREG)`（Codex W2 处置：绝对路径致 `:(exclude)` pathspec 失效）
**验证**: `npm run build`（类型检查）+ 目视确认 preregOpts 构造逻辑完整

---

## Phase 3: 全量验证与回归护栏

**目的**: 确认全量测试零失败、类型检查通过、repo 同步检查通过、现有 swebench 正向单测不打红

---

### T015 全量测试零失败验证

**操作**: 运行全量测试套件
**命令**: `npx vitest run`
**验收标准**:
- 全量约 4477 个测试零失败
- 新增测试用例（T001-T006 写的失败测试）**全部变绿**
- 现有 `feature-187-freeze-block.test.ts` 中 swebench-execution + 仅 oracleSpecHash 的正向单测**保持绿色**（向后兼容核心验证点）
- 现有 timeout/OOM 路径回归用例保持绿色（C1 不改启发式语义，仅调行序）

---

### T016 [P] 类型检查零错误

**操作**: 运行 TypeScript 编译检查
**命令**: `npm run build`
**验收标准**:
- 零 TypeScript 类型错误
- 新增 export（`computeDriverPromptSha256`、`computeFixtureContentHash`、`datasetTagToHfId`）类型签名正确
- cohort-batch 注入新参数类型与 preregistration-check opts 类型匹配

---

### T017 [P] repo 同步检查

**操作**: 运行仓库一致性检查
**命令**: `npm run repo:check`
**验收标准**:
- 零同步错误
- 无受控 release 字段被意外手动修改
- 不入库文件（评测产物、venv、harness 日志）确认未被 `git add`

---

### T018 回归护栏目视确认

**操作**: 人工目视确认关键回归护栏
**检查清单**:
- [ ] `scripts/eval-task-runner.mjs` 中 `buildDriverPrompt` 函数体**无任何改动**（措辞、签名零变化）
- [ ] `scripts/lib/classify-oracle.mjs` 中 `spawnSync`/harness 调用链路**无改动**（仅行序调整，不改 docker 42s 通路）
- [ ] `computeDriverPromptSha256`、`computeFixtureContentHash`、`datasetTagToHfId` 均为**纯新增 export**（无修改现有函数）
- [ ] `scripts/swe-bench-verified-cohort-batch.mjs` importer 相关路径**零改动**（swebenchMeta.dataset 仅读不写）
- [ ] git status 确认无评测产物（`scripts/.swebench-venv/`、harness 日志）被 staged
- [ ] oracleSpecHash 变更预期：C1/W1 涉及 SEMANTIC_MODULES 文件，hash 改变属设计预期，旧 F176 prereg 不可复用于 swebench-execution 模式（F188 fresh-freeze 前确认）
**命令**: `git diff --stat HEAD` 目视确认改动范围符合预期

---

## 依赖与并行说明

### Phase 依赖关系

```
Phase 1（写失败测试）→ Phase 2（实现，严格 a→h 顺序）→ Phase 3（全量验证）
```

Phase 1 内 T002/T003/T004/T005/T006 可并行（不同测试文件，T001 独立），但 T001-T006 必须全部在 Phase 2 开始前完成。

### Phase 2 内部依赖链

```
T007（a: dataset-build, datasetTagToHfId）
  └─ T010（d: swebench-oracle, 透传 datasetName）

T011（e: eval-task-runner, computeDriverPromptSha256）
  └─ T012（f: preregistration-check, 三比对原语）
       ├─ T013（g: freeze-preregistration, 端到端三字段）
       └─ T014（h: cohort-batch, 注入 live 值）

T008（b: fetch_rows.py, DATASET_MISMATCH 前缀）— 可与 T009 并行，不阻塞后续
T009（c: classify-oracle, 行序修正）— 独立，可与 T008 并行
```

**可并行组**:
- `[T008, T009]`：均无下游合约依赖，可与 T007/T011 并行启动
- `[T013, T014]`：均依赖 T012 完成，但互相独立，T012 完成后可并行

### 合约耦合说明

| 上游 export | 被依赖方 |
|------------|---------|
| `datasetTagToHfId`（T007）| swebench-oracle.mjs（T010）、freeze-preregistration.mjs（T013 间接） |
| `computeDriverPromptSha256`（T011）| preregistration-check.mjs（T012 比对原语）、cohort-batch（T014）、freeze（T013） |
| `computeFixtureContentHash`（T012）| cohort-batch（T014）、freeze（T013） |
| `parsePreregistration` 新字段（T012）| cohort-batch（T014 读 gitCommit） |

---

## 任务总览

| 任务 | 阶段 | 缺陷 | 文件 | 可并行 |
|------|------|------|------|--------|
| T001 | 写测试 | C1 | feature-187-classify-oracle.test.ts | — |
| T002 | 写测试 | W2 | feature-176-preregistration.test.ts | [P] |
| T003 | 写测试 | W3 | feature-176-preregistration.test.ts | [P] |
| T004 | 写测试 | CRITICAL | feature-176-preregistration.test.ts | [P] |
| T005 | 写测试 | C2 | feature-187-freeze-block.test.ts | [P] |
| T006 | 写测试 | W1 | feature-187-dataset-build.test.ts | [P] |
| T007 | 实现 a | W1 | swebench-dataset-build.mjs | — |
| T008 | 实现 b | W1 辅助 | swebench_fetch_rows.py | [P] |
| T009 | 实现 c | C1 | classify-oracle.mjs | [P] |
| T010 | 实现 d | W1 | swebench-oracle.mjs | — (依赖 T007) |
| T011 | 实现 e | W2 | eval-task-runner.mjs | — |
| T012 | 实现 f | W2/W3/CRITICAL | preregistration-check.mjs | — (依赖 T011) |
| T013 | 实现 g | C2/W4 | freeze-preregistration.mjs | [P] (依赖 T007/T011/T012) |
| T014 | 实现 h | W2/W3/CRITICAL | swe-bench-verified-cohort-batch.mjs | [P] (依赖 T011/T012) |
| T015 | 验证 | 全量 | — | — |
| T016 | 验证 | 类型 | — | [P] |
| T017 | 验证 | repo | — | [P] |
| T018 | 验证 | 回归目视 | — | — |

**总计：18 个任务，覆盖 6 个缺陷（C1/C2/W1/W2/W3/W4）+ CRITICAL fixtureContentHash 闭环**

---

## 实施策略

**TDD 单 Phase 实现**（因合约耦合不可原子分割）:

1. 先完成 Phase 1（T001-T006）：写所有失败测试，逐一 `vitest run <file>` 确认红灯
2. 实现 Phase 2（T007→T008/T009→T010→T011→T012→T013/T014）：严格按依赖顺序，每步完成后运行对应测试
3. Phase 3（T015-T018）：全量验证，4 项检查全绿后提交
4. 提交前按 CLAUDE.local.md 约定运行 Codex 对抗审查（此为 implement phase 的 review 要求）
