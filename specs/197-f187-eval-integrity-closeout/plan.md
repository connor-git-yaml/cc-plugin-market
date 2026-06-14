---
feature: 197
artifact: plan
mode: fix
status: ready
---

# 修复计划 — F197 评测设施公正性收口

> 本计划基于 `fix-report.md` 已定稿的根因 + 修复策略生成，不重新推导根因。
> 6 个缺陷（2 critical + 4 warning）全部"休眠"——仅在 `manifest.swebenchOracle=true` 路径触发；
> F188 跑批前必须全修，否则竞品完成率排名不可信。

---

## 1. Codebase Reality Check

| 文件 | LOC | 相关方法数 | 已知 debt |
|------|-----|-----------|----------|
| `scripts/lib/classify-oracle.mjs` | 121 | 3（`classifySwebenchResult`、`classifyRunForRanking`、`verdict`） | 行 79 与行 84 决策顺序错误（C1 根因），无其他 debt |
| `scripts/lib/swebench-oracle.mjs` | ~180 | 2（`runSwebenchInstance`、`readHarnessArtifacts`） | 行 123 `buildLocalDataset` 不传 `datasetName`（W1 根因） |
| `scripts/lib/swebench-dataset-build.mjs` | 111 | 3（`buildLocalDataset`、`fetchOfficialRows`、`diffOfficialVsFixture`） | 缺 `datasetTagToHfId` 映射函数；行 14 硬编码 Lite（W1 根因） |
| `scripts/lib/swebench_fetch_rows.py` | 48 | 1（`main`） | 行 24 missing 实例仅 stderr 输出，无法区分"数据集错配"与"真 infra"（W1 辅助） |
| `scripts/eval-task-runner.mjs` | ~1050 | `buildDriverPrompt`（行 171）等约 15 个 export | 仅新增 `computeDriverPromptSha256` export，零改现有逻辑 |
| `scripts/lib/preregistration-check.mjs` | 196 | 5（`parsePreregistration`、`checkPreregistration`、`freezeBlock` 等） | `parsePreregistration` 不解析 `promptSha256` / `gitCommit`（W2/W3 根因）；`checkPreregistration` 缺比对逻辑；`computeFixtureContentHash` 尚不存在（CRITICAL） |
| `scripts/freeze-preregistration.mjs` | 89 | 3（`renderFrozenPrereg`、`listFixtureTaskIds`、`main`） | 行 39-53 `renderFrozenPrereg` 硬编码 frontmatter 字段，无法渲染 `oracleSpecHash` 等扩展字段（C2 根因）；`main` 无 try/catch（W4） |
| `scripts/swe-bench-verified-cohort-batch.mjs` | ~350 | `entryValidation`（行 161）、`buildLiveOracleSpecInput`（行 97）等 | 行 180 `checkPreregistration` 调用不注入 `promptSha256` / `fixtureContentHash` / `gitState`（W2/W3/CRITICAL 根因） |

**前置清理规则评估**：所有目标文件 LOC < 500，无需前置 cleanup task。

---

## 2. Impact Assessment

| 维度 | 评估 |
|------|------|
| 直接修改文件数 | 8 |
| 间接受影响（调用方） | `cohort-batch` 已在修改列表；7 处 `runPrimaryOracle` 调用方零迁移（C1 不改签名） |
| 跨包影响 | 均在 `scripts/` 目录内，不跨越顶层边界 |
| 数据迁移 | 无 schema 变更；`renderFrozenPrereg` 新增字段渲染仅在 `--swebench-oracle` 开关时生效（向后兼容） |
| API / 契约变更 | `parsePreregistration` 新增解析字段（向后兼容）；`checkPreregistration` opts 新增可选参数；`computeDriverPromptSha256` 新增 export（零破坏） |
| oracleSpecHash 变更 | C1/W1 改动 `SEMANTIC_MODULES` 中的文件 → oracleSpecHash 变更（**设计预期**，不是回归） |

**风险等级：LOW**

- 影响文件 8 个，均在 `scripts/` 单一顶层目录内
- 所有变更仅在 `swebenchOracle=true` 路径激活（gated off）
- 新校验字段均"present-and-live-provided 才比对"（向后兼容）
- 不改 docker 执行路径、不改 `buildDriverPrompt` 措辞

---

## 3. 变更清单（按文件）

### 3.1 `scripts/lib/classify-oracle.mjs` — C1

**改什么**：把 `report.completed===true` 的 true/false 双分支上移到行 79 的 `timeout/OOM/killed` 启发式**之前**（行 78-81 之间插入）。

**为什么**：现有行序是行 79 先短路返回，行 84 才判 report。导致 `{resolved=true} × {log 含 "Killed"/exit137}` 被误判 `fail/candidate`（isOOM=true 触发，PASS 被洗成 fail，排名污染）。

**关键落点**：
- 在行 77（pre-test timeout 检查结束）和行 79（`isOOM/timedOut` 检查）**之间**插入：
  ```js
  // 行 7.5（C1 修正）：report.completed===true 时无条件以 report 判
  // 必须先于行 8 启发式 —— log 含 "Killed" 与 resolved=true 并存时信 report
  if (report && report.completed === true) {
    return report.resolved === true
      ? verdict('pass', 'none', 'harness completed + resolved（C1 report 优先）')
      : verdict('fail', 'candidate', 'harness completed 但 resolved=false（C1 report 优先）');
  }
  // resolved===null 时 fall through 到行 8 启发式
  ```
- 行 84-88 原有 `if (report)` 块中的 `completed===true` 两分支随之成为死代码，可删；`completed===false` 分支**保留**（行 87 位置不变）。
- 行 1-7（exit125/126/127/139/BuildImageError/ImagePullError/patch-apply/pytest-exit5/pre-test-timeout）**留在 report 块之前**——这些是 report 不可信的硬 infra 前置。

**注意**：`resolved===null`（report 存在但 resolved 未定）须 fall through，不强判；原 Codex W1 处置已在设计中体现（显式 true/false 双分支，null 路径不被覆盖）。

---

### 3.2 `scripts/lib/swebench-oracle.mjs` — W1

**改什么**：行 123 `buildLocalDataset({ fixtures: [fixture], outPath: datasetPath, venvPath: absVenv })` 补传 `datasetName`，值从 `fixture.swebenchMeta.dataset` 经 `datasetTagToHfId` 映射而来。

**为什么**：不传 `datasetName` 时 `buildLocalDataset` 默认 `SWE-bench/SWE-bench_Lite`，Verified cohort 8/10 实例不在 Lite → fetch exit 1 → catch 静默返回 `error/infra` → 剔分母（违反 FR-A-002b）。

**关键落点（行 123 附近）**：
```js
// 从 fixture.swebenchMeta.dataset 映射 HF dataset id（W1）
const datasetName = datasetTagToHfId(fixture.swebenchMeta?.dataset);
built = buildLocalDataset({ fixtures: [fixture], outPath: datasetPath, datasetName, venvPath: absVenv });
```
`datasetTagToHfId` 定义在 `swebench-dataset-build.mjs`（见 3.3），从该文件 import。

---

### 3.3 `scripts/lib/swebench-dataset-build.mjs` — W1

**改什么**：
1. 新增并 export `datasetTagToHfId(tag)` 映射函数：
   - `'lite'` → `'SWE-bench/SWE-bench_Lite'`
   - `'verified'` → `'SWE-bench/SWE-bench_Verified'`
   - 未知/缺失 → 抛出明确错误（不静默回退 Lite）
2. 在 `buildLocalDataset` 内，当 `fetchOfficialRows` 返回缺失实例时（行 72，`<missing-in-official>`），将 `mismatches` 中的 reason 升级为包含 dataset 名的**数据集错配**诊断：`failureSource: 'fixture'`，reason 含 `"数据集错配"` + dataset 名 + 缺失实例 id，区别于真 infra 故障。

**为什么**：Verified 映射是单一来源，放在 `swebench-dataset-build.mjs` 供 oracle 和 freeze 共用，杜绝算法分叉。数据集错配是 fixture 级配置错误（应修 fixture 标签），不应笼统归 infra/error 并静默剔分母。

**关键落点（行 14 附近 + 新增函数）**：
```js
const DEFAULT_DATASET = 'SWE-bench/SWE-bench_Lite'; // 保留，CLI 默认路径用

/** 从 fixture.swebenchMeta.dataset 标签映射 HF dataset id（W1 单一来源）。 */
export function datasetTagToHfId(tag) {
  if (tag === 'lite' || tag == null) return 'SWE-bench/SWE-bench_Lite';
  if (tag === 'verified') return 'SWE-bench/SWE-bench_Verified';
  throw new Error(`未知 dataset tag: ${JSON.stringify(tag)}（支持 lite / verified）`);
}
```

行 72 missing 诊断：
```js
if (!row) {
  mismatches.push({
    instanceId: m.instanceId,
    fields: ['<missing-in-official>'],
    failureSource: 'fixture',
    reason: `数据集错配：实例 ${m.instanceId} 不在 ${datasetName}（检查 fixture.swebenchMeta.dataset 标签）`,
  });
  continue;
}
```

---

### 3.4 `scripts/lib/swebench_fetch_rows.py` — W1（辅助）

**改什么**：行 24 的 missing 实例错误输出补充数据集错配标志，使上层可识别为 fixture 级配置错误而非 infra：
```python
if missing:
    print(f"DATASET_MISMATCH: instance_id 不在 {dataset_name}: {sorted(missing)}", file=sys.stderr)
    return 1
```

**为什么**：Python 脚本的 stderr 内容由 `fetchOfficialRows` 拼入错误消息，最终出现在 oracle 的 reason 字段里。加 `DATASET_MISMATCH:` 前缀让 JS 层 catch 时可做精确 reason 拼写，配合 3.3 的诊断形成完整错配归因链路。

**注意**：此文件在 `SEMANTIC_MODULES` 内，任何修改会改 `oracleSpecHash`（预期）。

---

### 3.5 `scripts/eval-task-runner.mjs` — W2

**改什么**：仅在文件尾部（`buildDriverPrompt` 函数之后）新增一个 export：
```js
import * as crypto from 'node:crypto'; // 若文件已 import 则复用

/** W2：promptSha256 = sha256(buildDriverPrompt 函数源码)，供预注册冻结+比对。 */
export function computeDriverPromptSha256() {
  return crypto.createHash('sha256').update(buildDriverPrompt.toString()).digest('hex');
}
```

**为什么**：freeze 工具和 cohort-batch 需要一个"prompt 模板指纹"，与 `buildDriverPrompt` 同源保证一致性。`toString()` 在 Node.js ESM 中返回函数源码字符串，任何措辞改动都会改变 hash。`cohort-registry.mjs` 已有 side-effect-free import `buildDriverPrompt` 的先例，安全性已验证。

**零改约束**：`buildDriverPrompt` 函数体措辞、签名、行为**不得有任何改动**（SC-013 golden 测试逐字守护）。

---

### 3.6 `scripts/lib/preregistration-check.mjs` — W2 / W3 / CRITICAL

**改什么（按优先顺序）**：

**a. `parsePreregistration`（行 72-109）— 新增解析 `promptSha256` 和 `gitCommit`**：
在现有逐行解析循环中增加两个匹配项（与 `oracleSpecHash` 同款正则结构）：
```js
let promptSha256 = null;
let gitCommit = null;
// 在循环内：
const promptM = line.match(/^\s*promptSha256:\s*["']?([0-9a-fA-F]{64})["']?\s*$/);
if (promptM) promptSha256 = promptM[1].toLowerCase();
const gcM = line.match(/^\s*gitCommit:\s*["']?([0-9a-f]{7,40})["']?\s*$/);
if (gcM) gitCommit = gcM[1];
```
返回值增加 `promptSha256`、`gitCommit` 字段（行 108 返回对象）。

**b. 新增 `computeFixtureContentHash(taskIds, fixturesDir)`（CRITICAL 响应）**：
```js
/**
 * fixtureContentHash：对 taskIds 排序后，逐个读 fixturesDir/<id>.json 原始内容
 * 算 sha256，stableStringify({id: sha}) → sha256。任一 fixture 内容变更 → hash 变。
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

**c. `checkPreregistration`（行 126-170）— 增加三个比对（present-and-live-provided 才比对）**：

在 oracleSpecHash 比对之后（行 165 之后），`opts.oracleKind === 'swebench-execution'` 分支内增加：

```js
// W2：promptSha256 比对
const { promptSha256: frozenPromptSha, gitCommit: frozenGitCommit, fixtureContentHash: frozenFCH } = parsed;
if (frozenPromptSha && opts.promptSha256 != null) {
  if (opts.promptSha256 !== frozenPromptSha) {
    return { ok: false, reason: `promptSha256 不符（prompt 模板已漂移）。frozen=${frozenPromptSha.slice(0,12)} live=${opts.promptSha256.slice(0,12)}`, expectedHash: hash, actualHash };
  }
}
// CRITICAL：fixtureContentHash 比对
if (frozenFCH && opts.fixtureContentHash != null) {
  if (opts.fixtureContentHash !== frozenFCH) {
    return { ok: false, reason: `fixtureContentHash 不符（fixture 内容在冻结后换版）。frozen=${frozenFCH.slice(0,12)} live=${opts.fixtureContentHash.slice(0,12)}`, expectedHash: hash, actualHash };
  }
}
// W3：gitState 比对
if (opts.gitState) {
  if (!opts.gitState.trackedClean) {
    return { ok: false, reason: 'worktree 有未提交改动（git 外锚失效，拒绝跑批）', expectedHash: hash, actualHash };
  }
  if (frozenGitCommit && opts.gitState.codeMatchesFrozen === false) {
    return { ok: false, reason: `代码自冻结 commit(${frozenGitCommit.slice(0,8)}) 起已漂移（git 外锚拦截）`, expectedHash: hash, actualHash };
  }
}
```

**注意**：`parsePreregistration` 的解构从 `const { hash, frozen, taskIds, oracleSpecHash }` 扩展为含新字段（行 131）。

---

### 3.7 `scripts/freeze-preregistration.mjs` — C2

**改什么**：

**a. 增加 `--swebench-oracle` 和 `--manifest` CLI 选项解析（`main` 函数）**：
```js
const swebenchOracle = argv.includes('--swebench-oracle');
const manifestIdx = argv.indexOf('--manifest');
const manifestPath = manifestIdx >= 0 ? argv[manifestIdx + 1] : null;
```

**b. swebench 模式下计算三字段**：
在 `main` 的 `const block = freezeBlock(...)` 之前：
```js
let oracleSpecInput = null;
let fixtureContentHash = null;
let promptSha256 = null;
if (swebenchOracle) {
  // 复用 cohort-batch 的 buildLiveOracleSpecInput 保证 freeze↔check 口径逐字一致
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

**c. `renderFrozenPrereg` 渲染扩展字段（仅当 block 含该字段时输出）**：
```js
// 在现有 fm 数组的 gitCommit 行之后、taskIds 之前插入：
...(block.oracleSpecHash  ? [`oracleSpecHash: ${block.oracleSpecHash}`]  : []),
...(block.fixtureContentHash ? [`fixtureContentHash: ${block.fixtureContentHash}`] : []),
...(block.promptSha256    ? [`promptSha256: ${block.promptSha256}`]    : []),
...(block.schemaVersion   ? [`schemaVersion: ${block.schemaVersion}`]  : []),
```

**d. `main` 包 try/catch**（W4 Codex 处置）：
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

**注意**：`renderFrozenPrereg` 增加 `schemaVersion` 字段渲染后，**重复跑 freeze 不丢字段**（条件渲染，block 已含字段即渲染）。

---

### 3.8 `scripts/swe-bench-verified-cohort-batch.mjs` — W2 / W3 / CRITICAL

**改什么**：`entryValidation` 函数内，`swebenchOracle` 模式的 `preregOpts` 构造处（行 180）注入三个 live 值：

```js
if (args.manifest?.swebenchOracle) {
  const { computeDriverPromptSha256 } = await import('./eval-task-runner.mjs');  // 静态 import 已有时直接用
  const { computeFixtureContentHash } = await import('./lib/preregistration-check.mjs');

  // W3：git 外锚状态（trackedClean + codeMatchesFrozen）
  const preregForGit = parsePreregistration(fs.readFileSync(PREREG, 'utf-8'));
  const frozenGitCommit = preregForGit.gitCommit;
  const preregRel = path.relative(PROJECT_ROOT, PREREG);
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

**为什么**：W2/W3/CRITICAL 的 lib 侧（preregistration-check.mjs）只提供解析+比对原语；真正的 live 值计算（git 状态、prompt hash、fixture hash）必须在运行入口（entryValidation）侧注入，保持 lib 轻量可测。

**注意**：`preregRel` 须用 `path.relative(PROJECT_ROOT, PREREG)` 而非绝对路径（Codex W2 处置：绝对路径致 `:(exclude)` pathspec 失效）。

---

## 4. TDD 测试清单

### 4.1 C1 三交叉用例（`tests/unit/feature-187-classify-oracle.test.ts`）

| 测试描述 | 输入 | 期望 classification | 期望 failureSource |
|---------|------|--------------------|--------------------|
| `resolved=true × log 含 "Killed"` | `{report:{completed:true,resolved:true}, logText:'Killed', phaseReached:'done'}` | `pass` | `none` |
| `resolved=true × log 含 "OOMKilled"` | `{report:{completed:true,resolved:true}, logText:'OOMKilled', phaseReached:'done', harnessExitCode:137}` | `pass` | `none` |
| `resolved=true × harnessExitCode=137` | `{report:{completed:true,resolved:true}, harnessExitCode:137, phaseReached:'done', logText:''}` | `pass` | `none` |
| `resolved===null fall through（不强判）` | `{report:{completed:true,resolved:null}, harnessExitCode:0, phaseReached:'done', logText:''}` | 非 `pass`（fallback） | 任意 |
| 现有 `exit0 resolved=true`（不回归）| `{harnessExitCode:0, phaseReached:'done', report:{completed:true,resolved:true}, logText:''}` | `pass` | `none` |
| 现有 timeout/OOM 路径（不回归）| `{timedOut:true, phaseReached:'test_exec', logText:'', report:null}` | `fail` | `candidate` |

**测试策略**：在现有 `CASES` 数组末尾追加三交叉行，一个 `it.each` 遍历即可。

---

### 4.2 W1 映射+错配诊断（`tests/unit/feature-187-oracle-pipeline.test.ts` 或新增 `feature-187-dataset-build.test.ts`）

| 测试描述 | 输入 | 期望 |
|---------|------|------|
| `datasetTagToHfId('lite')` | `'lite'` | `'SWE-bench/SWE-bench_Lite'` |
| `datasetTagToHfId('verified')` | `'verified'` | `'SWE-bench/SWE-bench_Verified'` |
| `datasetTagToHfId(null)` | `null` | `'SWE-bench/SWE-bench_Lite'`（默认） |
| `datasetTagToHfId('unknown')` | `'unknown'` | throw（不静默回退） |
| 数据集错配诊断（stub fetch 返回 missing）| `buildLocalDataset` stub `fetchOfficialRows` 返回空数组 | `mismatches[0].reason` 含 `"数据集错配"` + dataset 名 + `failureSource:'fixture'` |

---

### 4.3 W2 promptSha256 比对（`tests/unit/feature-176-preregistration.test.ts`）

| 测试描述 | 期望 |
|---------|------|
| `computeDriverPromptSha256()` 确定性：同进程调两次结果相同 | 两次相等 |
| 模拟"改一字节 buildDriverPrompt"：喂不符 `promptSha256` 给 `checkPreregistration` | `ok=false`，reason 含 `promptSha256` |
| prereg 无 `promptSha256` 字段，opts 传 `promptSha256` | `ok=true`（向后兼容，仅 present 才比对） |
| prereg 有 `promptSha256`，opts 不传 | `ok=true`（仅 live 也传时才比对） |

**实现提示**：`parsePreregistration` 需能解析 frontmatter 中的 `promptSha256: <hex>` 行。

---

### 4.4 W3 gitState 拦截（`tests/unit/feature-176-preregistration.test.ts`）

| 测试描述 | gitState 输入 | 期望 |
|---------|--------------|------|
| `trackedClean=false` | `{trackedClean:false, codeMatchesFrozen:true}` | `ok=false`，reason 含 `dirty worktree` |
| `codeMatchesFrozen=false`（prereg 含 gitCommit）| `{trackedClean:true, codeMatchesFrozen:false}` | `ok=false`，reason 含 `代码自冻结` 或 `漂移` |
| 两者均 true | `{trackedClean:true, codeMatchesFrozen:true}` | `ok=true`（不拦截） |
| gitState 仅在 `swebench-execution` kind 生效 | `opts.oracleKind='ast-diff', gitState={trackedClean:false}` | `ok=true`（非 swebench 路径不校验 git） |

---

### 4.5 C2 freeze 端到端产三字段（`tests/unit/feature-187-freeze-block.test.ts`）

| 测试描述 | 期望 |
|---------|------|
| `freezeBlock(ids, {oracleSpecInput, fixtureContentHash:'x'.repeat(64), promptSha256:'y'.repeat(64)})` | block 含三字段，parsePreregistration 能解析 `renderFrozenPrereg` 产出 |
| `renderFrozenPrereg` 产物 frontmatter 含 `oracleSpecHash` / `fixtureContentHash` / `promptSha256` / `schemaVersion` | 四个字段均存在 |
| `renderFrozenPrereg` 后 `parsePreregistration` 解析 → `oracleSpecHash`/`fixtureContentHash`/`promptSha256` 字段不丢 | 与 block 值一致 |
| 重跑 `renderFrozenPrereg`（相同 block 再次渲染）字段不丢 | 仍含四字段 |
| freeze 端到端 → `checkPreregistration(oracleKind:'swebench-execution', oracleSpecInput=同一输入)` → ok | `ok=true` |

---

### 4.6 CRITICAL fixtureContentHash 换版被拦（`tests/unit/feature-176-preregistration.test.ts`）

| 测试描述 | 期望 |
|---------|------|
| `computeFixtureContentHash(['t1'], dir)` — fixture 内容改一字节 → live hash 变 | 两次 hash 不等 |
| taskId 不变但 fixture JSON 内容换版 → `checkPreregistration` 比对拦截 | `ok=false`，reason 含 `fixtureContentHash` |
| prereg 有 `fixtureContentHash`，opts 传不符 live hash | `ok=false` |
| prereg 无 `fixtureContentHash`（旧格式向后兼容）| `ok=true`（不拦截） |

---

## 5. 回归护栏 Checklist

- [ ] **不改 oracle 执行本体**：C1 仅调决策表行序，不改 `spawnSync`/harness 调用链路；docker 42s 通路不变（`runSwebenchInstance` 主体零改）
- [ ] **不改 `buildDriverPrompt` 措辞**：`eval-task-runner.mjs` 仅新增 `computeDriverPromptSha256` export，函数体和签名不动（SC-013 golden 逐字一致）
- [ ] **新校验全部向后兼容**：`promptSha256`/`fixtureContentHash`/`gitState` 均"prereg 有该字段 且 opts 传 live 才比对"，缺任一则放行；现有 `feature-187-freeze-block.test.ts` 中 swebench-execution + 仅 oracleSpecHash 的正向单测必须保持绿色
- [ ] **全量 4477 测零回归**：`npx vitest run` 在 implement 完成后必须零失败
- [ ] **importer 零改动**：`swebenchMeta.dataset` 字段由 importer 写入，本次修复仅读该字段，不动 importer
- [ ] **评测产物不入库**：`scripts/.swebench-venv/`、harness 日志、oracle 产物均 `.gitignore`，不进 git

---

## 6. oracleSpecHash 变更说明

C1（`classify-oracle.mjs`）、W1（`swebench-dataset-build.mjs`、`swebench_fetch_rows.py`）改动的文件全部在 `SEMANTIC_MODULES` 列表内，**这些文件的内容变更会导致 `oracleSpecHash` 改变，属设计预期**：

- 判分语义改变 → hash 必须变，这正是"冻结 oracle 语义"的机制目标
- 旧的 F176 `preregistration.md`（无 `oracleSpecHash` 字段）不可复用于 swebench-execution 模式
- F188 跑批前：用扩展后的 freeze 工具（本次 C2 修复）执行 fresh-freeze，自动捕获新语义 hash

---

## 7. 实施顺序建议

**原则**：TDD 先行；6 个缺陷合约耦合不可原子拆分，在单 implement phase 内完成。

```
1. 写失败测试（TDD 第一步）
   - feature-187-classify-oracle.test.ts：C1 三交叉用例（3 个新 case）→ 预期当前 FAIL
   - feature-176-preregistration.test.ts：W2 promptSha256、W3 gitState、CRITICAL fixtureContentHash 比对 → 预期 FAIL
   - feature-187-freeze-block.test.ts：C2 端到端三字段渲染 → 预期 FAIL
   - （可选）feature-187-dataset-build.test.ts：W1 映射+错配诊断 → 预期 FAIL

2. 实现（严格按合约依赖顺序）
   a. swebench-dataset-build.mjs：新增 datasetTagToHfId（W1 依赖基础）
   b. swebench_fetch_rows.py：DATASET_MISMATCH 前缀（W1 辅助）
   c. classify-oracle.mjs：C1 report 块上移（独立，无下游依赖）
   d. swebench-oracle.mjs：透传 datasetName（依赖 a）
   e. eval-task-runner.mjs：新增 computeDriverPromptSha256 export（W2 基础）
   f. preregistration-check.mjs：parsePreregistration 新增字段 + computeFixtureContentHash + checkPreregistration 三比对（依赖 e）
   g. freeze-preregistration.mjs：--swebench-oracle 开关 + renderFrozenPrereg 扩展 + try/catch（依赖 a/e/f）
   h. swe-bench-verified-cohort-batch.mjs：entryValidation 注入 live 值（依赖 e/f/a）

3. 验证
   - `npx vitest run`：全量 4477 测零失败
   - `npm run build`：类型检查零错误
   - `npm run repo:check`：repo 同步检查
   - 目视确认现有 feature-187-freeze-block.test.ts 正向单测（swebench-execution + 仅 oracleSpecHash）保持绿色
```

---

## 8. 与诊断报告的差异说明

**C1 当前状态核实**（规划时发现）：

阅读 `classify-oracle.mjs` HEAD=09f90ac 实际内容，发现行 79-88 的决策顺序为：
- 行 79：`if ((timedOut || killed || isOOM) && reachedTestExec(...))` → fail/candidate
- 行 84：`if (report) { ... resolved===true → pass ... }`

**这正是 C1 的 bug 所在**（report 块在启发式之后），与 fix-report 诊断完全一致。fix-report 的描述是正确的，C1 **尚未修复**。

行 66-71 的"行 5（Codex C1 修正）"注释是针对 patch-apply 行的注释，与本次 C1 修复的"report 权威上移"无关——勿混淆。

fix-report 中描述的当前修复目标（把 `completed===true` 块上移到行 79 之前）与实际代码状态完全吻合，计划按 fix-report 执行。

---

## 9. Codex 规划审查处置（Phase 2，3C+6W）

codex 对 plan/tasks 对抗审查，逐条处置。**以下为 implement 阶段权威修正，覆盖 §1-§7 中与之冲突的描述。**

### 🔴 CRITICAL（必须按此实现，否则编译失败/引回归）

**[C-1] C1 落地禁用三元/return null，必须显式 true/false + fall through**
classifySwebenchResult 调用方（swebench-oracle.mjs:165-180）直接读 `verdict.classification`，返回 null 会崩。
正确落地（在 classify-oracle.mjs 行 7 pre-test timeout :75-77 之后、行 8 :79 之前插入）：
```js
// C1：harness report 权威优先于 timeout/OOM 启发式（仅 completed===true 的确定判定）
if (report && report.completed === true) {
  if (report.resolved === true) return verdict('pass', 'none', 'harness completed + resolved（权威优先于启发式）');
  if (report.resolved === false) return verdict('fail', 'candidate', 'harness completed 但 resolved=false（权威优先于启发式）');
  // resolved 非 true/false（null/undefined）：不 return，fall through 到下方启发式/fallback
}
```
原行 84-88 的 `if (report)` 块：删除 completed===true 的两分支（已上移成死代码），**保留 completed===false → error/infra**。

**[C-2] W1 missing 路径修复需贯通三层，并产可区分的"数据集错配"诊断**
W1 双层修复：
1. **主修复（消除静默剔除）**：swebench-oracle.mjs:123 传 `datasetName: datasetTagToHfId(fixture.swebenchMeta.dataset)`。verified 实例从 Verified dataset 取 → 找得到 → 不再 error。
2. **次级诊断（实例确不在其标签 dataset 时可区分于真 infra）**：当前 swebench_fetch_rows.py:23-25 missing→exit 1 → fetchOfficialRows:48-50 throw → swebench-oracle.mjs:124-128 catch 归 error/**infra**。修正：
   - swebench_fetch_rows.py：missing 时 stderr 加稳定机读标记，如 `DATASET_MISMATCH: instance_id 不在 <dataset>: [...]`，仍 exit 1。
   - swebench-oracle.mjs catch（:124-128）：若 `e.message` 命中 `DATASET_MISMATCH`/"不在" → `failureSource:'fixture'` + reason 前缀"数据集错配（W1）"；否则保持 infra。
   - 注：buildLocalDataset 单实例调用时整批 fetch fail 即 throw，到不了 :72 per-row mismatches 分支——故诊断落点在 catch，不在 per-row 循环。

**[C-3] cohort-batch 用静态 import，entryValidation 保持 sync（禁 await import）**
entryValidation（:161）是 sync，main（:432）已 async 但 :434 同步调用 entryValidation。注入 live promptSha256 **不得**改 entryValidation 为 async。
正确做法：cohort-batch 顶部静态 import（与 cohort-registry.mjs 既有 side-effect-free 先例一致）：
```js
import { computeDriverPromptSha256 } from './eval-task-runner.mjs';
```
entryValidation 内同步调用 `computeDriverPromptSha256()`。

### 🟡 WARNING

- **[W-1]** W2/CRITICAL 测试必须让 prereg **同时含 oracleSpecHash + opts.oracleKind='swebench-execution'**，否则被 :157 缺-oracleSpecHash hard-fail 提前拦截，测不到 promptSha256/fixtureContentHash 真实比对路径。
- **[W-2]** cohort-batch 注入逻辑要可单测：把 gitState 计算抽成 **exported 纯函数** `computePreregGitState({ projectRoot, preregRel, frozenGitCommit, gitRun })`（gitRun 默认 spawnSync 包装，测试注入 fake），返回 `{ trackedClean, codeMatchesFrozen, head }`。entryValidation 调它。补该函数单测（注入 fake gitRun 覆盖 clean/dirty/drift）。
- **[W-3]** codeMatchesFrozen 判定必须 **git exit 0 且 stdout 为空** 才算 match；frozen commit 不存在/歧义/git 报错（exit≠0）→ 视为 **NOT match → 拦截**（不可因 stdout 空而误放行）。
- **[W-4]** buildLocalDataset 要可单测：增 `opts.fetchRows` 注入（默认 fetchOfficialRows），测试注入 fake 返回 missing/mismatch，免跑真 venv/Python。
- **[W-5]** 同步更新 specs/176-swe-bench-verified-cross-cohort/verification/host-runbook.md:80-81 的 freeze 命令为新 `--swebench-oracle`（+ 必要 --manifest）形态，并注明无 venv 会失败、旧 prereg 不可复用于 swebench。
- **[W-6]** W2 测试要断言 `computeDriverPromptSha256() === sha256(buildDriverPrompt.toString())`（钉死定义），并断言改 buildDriverPrompt 源一字节 → hash 变（用独立 fixture 函数模拟，不真改生产 buildDriverPrompt）。

### ℹ️ INFO
- [I-1] cohort-batch 实为 512 行（plan §1 写 ~350，仅影响面描述偏小，落点行号 :161/:181 正确，不影响实现）。
- [I-2] feature-187-freeze-block.test.ts:76 用 `computeOracleSpecHash(BASE_SPEC)` 动态算期望值，W1 改 SEMANTIC_MODULES **不会**打红硬编码 hash（无硬编码）。风险仅在旧 prereg/runbook（见 W-5）。
