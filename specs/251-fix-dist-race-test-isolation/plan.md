# 修复实施计划：dist/ 并发竞写导致测试假红（F251）

**Feature**: `251-fix-dist-race-test-isolation` | **Mode**: fix | **Date**: 2026-08-04
**依据**: [fix-report.md](./fix-report.md)（5-Why 根因 + 方案 A/B/C，推荐方案 A）
**采用方案**: 方案 A — vitest `globalSetup` 单点构建 + 测试执行期 dist 只读

## 摘要

把 `dist/` 的构建职责从「N 个测试文件各自 `beforeAll` 无条件/半条件 `npm run build`」收拢到「vitest `globalSetup` 在所有 worker fork 之前的单进程阶段执行一次」，从时间上消除构建期与消费期的重叠，同时闭合指纹双底座错位窗口。新增一个带保守偏置新鲜度判据的 globalSetup 脚本 + 一个共享 fail-fast 断言 helper，替换全部旧 build 调用点。

## 对 fix-report 影响范围扫描的修正（重要）

fix-report「影响范围扫描」表格只列出 **5 处**同源问题，但对 `tests/` 全目录用更宽正则重新 grep 后，实际发现 **8 处**（分布在 7 个文件）需要替换的 beforeAll 无条件/半条件 build 调用点。遗漏的 3 处必须在本次修复中一并处理，否则残留的竞写源头会让方案 A 失效（只要还有一个文件在测试执行期写 dist，竞写窗口就没有真正消除）：

| # | 文件 | 行号 | 模式 | fix-report 是否已覆盖 |
|---|------|------|------|----------------------|
| 1 | `tests/unit/graph-quality-core.test.ts` | L83-86 | 无条件 build | 是 |
| 2 | `tests/integration/cli-e2e.test.ts`（第一个 describe） | L31-38 | 无条件 build | 是 |
| 3 | `tests/integration/cli-e2e.test.ts`（"CLI 零认证隔离端到端测试"describe） | L138-139 | 无条件 build | 是 |
| 4 | `tests/integration/init-e2e.test.ts` | L41-48 | 无条件 build | 是 |
| 5 | `tests/integration/graph-quality-cli.test.ts` | L94-98 | 无条件 build | 是 |
| 6 | `tests/unit/contracts/graph-quality-report-schema.test.ts` | L92-97 | 无条件 build | **否（新发现）** |
| 7 | `tests/integration/graph-quality-adversarial.test.ts` | L55-60 | 半条件（`!existsSync(CLI_PATH)` 才 build，无新鲜度判断） | **否（新发现）** |
| 8 | `tests/integration/graph-quality-lang-matrix.test.ts` | L54-60 | 同上（半条件） | **否（新发现）** |

`#7`/`#8` 属于「只判存在不判新鲜」模式——dist 存在但落后于源码时不会重建，这是与本次竞写 bug 相独立的潜伏新鲜度缺口。globalSetup 落地后一并被修复（副作用，非本次目标但值得记录）。

## 决策点

### 1. globalSetup 脚本位置与声明层级

**位置**：新增 `tests/global-setup.ts`（TypeScript，与 `tests/helpers/*.ts` 同级，vitest 用 vite-node 直接转译执行，不受根 `tsconfig.json` 的 `exclude: ["tests"]` 影响——现有全部测试文件已是同样的执行方式）。

**声明层级：根级 `test.globalSetup`，与 `projects: [...]` 同级**（不放进任何单个 project 条目）。依据来自对 `node_modules/vitest` 源码的实测核查（非推测）：

- `node_modules/vitest/dist/chunks/reporters.d.BFLkQcL6.d.ts:2334` 定义的 `NonProjectOptions` 联合类型**不包含** `globalSetup`——即 `globalSetup` 在类型层面属于 `ProjectConfig` 的合法字段，理论上可以写进 `projects[]` 的某个条目（这点与 F235 记录的 `maxWorkers`/`minWorkers` 不同，后两者在 `NonProjectOptions` 列表里）。
- 但 `TestProject.initializeGlobalSetup` 的调用路径（`cli-api.BkDphVBG.js:9720-9725`）：
  ```js
  async initializeGlobalSetup(paths) {
    const projects = new Set(paths.map((spec) => spec.project));
    const coreProject = this.getRootProject();
    if (!projects.has(coreProject)) projects.add(coreProject);
    for (const project of projects) await project._initializeGlobalSetup();
  }
  ```
  **无论本次实际匹配到哪些 project 的测试文件，`coreProject`（持有根级 `test.*` 配置的"root/core project"，`getRootProject()` 定义见 `cli-api.BkDphVBG.js:9380`）永远被加入待初始化集合。** `_initializeGlobalSetup()`（`cli-api.BkDphVBG.js:7070-7079`）内部用 `if (this._globalSetups) return;` 做单实例幂等守卫，读取的是 `this.config.globalSetup`——根级声明只会被 `coreProject` 读到并执行一次。
- 结论：**根级声明的 `globalSetup` 在任意调用形态下（全量 `vitest run`、`--project unit`、单文件 `vitest run tests/unit/xxx.test.ts`、`npm run test:integration` 等）都恰好执行一次，且先于所有 worker fork**——这正是消除竞写窗口所需要的"单点、先于消费期"语义。

**曾考虑但拒绝的替代方案**：把 `globalSetup` 分别声明在 `unit`/`integration` 两个 project 条目里（本次全部 8 处 build 调用点都落在这两个 project），可以让 `--project golden-master`/`--project e2e`/`--project self-hosting` 单独跑时不用付构建代价。拒绝理由：
  - 该写法要求两个 project 各自独立触发 `_initializeGlobalSetup()`（每个 project 实例有独立的 `_globalSetups` 状态），若两者都命中会执行两次 setup 调用——虽然第二次会被本方案的新鲜度判据短路成本极低，但引入了"同一 globalSetup 文件在同次运行中被调用 N 次"的心智负担；
  - 更重要的是**脆弱性**：未来若第 9 个消费 dist CLI 的测试文件加进 `golden-master`/`e2e`/`self-hosting` 项目，必须记得同步在该 project 条目里补声明 `globalSetup`，否则该 project 单独跑时静默拿到陈旧/缺失的 dist——这是一个容易被忘记且没有任何门禁会提醒的隐患；根级声明天然穷举，不存在这个遗漏面。
  - 代价可接受：根级声明意味着即使某次调用只涉及从不消费 dist CLI 的纯单元测试文件，也会跑一次新鲜度判定（见决策点 2，判定本身是毫秒级的 mtime 扫描，真正付构建代价仅当源码确实比 dist 新）。

### 2. 新鲜度判据（保守偏置：判据不确定/比较失败 → 一律重建）

**不采用"globalSetup 无条件重建"**：本仓库 `tsconfig.json` 未开 `incremental`，`npm run build`（prebuild tsx + tsc 全量 + postbuild）单次成本官方注释里有两种口径——`cli-e2e.test.ts` 注释称冷缓存"常超 10s"，`graph-quality-report-schema.test.ts` 注释称"实测约 2s"，fix-report Why 3 给出"10-30s"——无论取哪个口径，都远高于一次 mtime 扫描（对 `src/**` 几百个文件做 `statSync`，本机量级为几十毫秒）。给定：
  - 迭代开发时会反复对同一份未变更 dist 跑单文件/子集测试（本次修复本身在验证阶段就要"满载全量复跑 ≥3 轮"，如果每轮都无条件全量 `tsc`，验证本身的墙钟成本会显著上升）；
  - fix-report 明确要求修法不能只是"删 build"，必须保留"保证 dist 新鲜"的职责（放大项：指纹双底座错位）；

  两者结合，新鲜度判据是低风险高收益的选择，不属于过度设计。

**判据实现**（写入 `tests/global-setup.ts`，供 implement 阶段照此实现）：

```ts
// tests/global-setup.ts（伪代码骨架，implement 阶段落地）
import { existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
// @ts-expect-error — .mjs 无类型声明，运行时可解析（现有约定，如 graph-quality-core.test.ts）
import { BUILD_INPUT_PATHS } from '../scripts/lib/spectra-version-gate.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_CLI = join(PROJECT_ROOT, 'dist', 'cli', 'index.js');

// BUILD_INPUT_PATHS（F176 版本门禁语义）只覆盖 tsc 自身输入；
// 本判据要覆盖完整 `npm run build` 流水线（prebuild + tsc + postbuild），
// 额外补 prebuild/postbuild 脚本本身——避免"改了内联/盖章逻辑但没碰 src"时判新鲜误跳过。
const FULL_BUILD_INPUT_PATHS = [
  ...BUILD_INPUT_PATHS, // ['src', 'tsconfig.json', 'tsconfig.build.json', 'package.json', 'package-lock.json']
  'scripts/inline-d3.ts',
  'scripts/postbuild-stamp.mjs',
  'scripts/lib/spectra-version-gate.mjs',
];

function newestMtimeMs(relPaths: string[]): number {
  let newest = 0;
  const visit = (abs: string) => {
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      for (const e of readdirSync(abs, { withFileTypes: true })) visit(join(abs, e.name));
    } else {
      newest = Math.max(newest, stat.mtimeMs);
    }
  };
  for (const rel of relPaths) {
    const abs = join(PROJECT_ROOT, rel);
    if (existsSync(abs)) visit(abs);
  }
  return newest;
}

function isDistFresh(): boolean {
  if (!existsSync(DIST_CLI)) return false; // 缺失 → 必建
  try {
    const distMtime = statSync(DIST_CLI).mtimeMs;
    return newestMtimeMs(FULL_BUILD_INPUT_PATHS) <= distMtime; // 保守偏置：严格 <=，等于也算新鲜
  } catch {
    return false; // 比较失败（任何异常）→ 视为不新鲜，走重建分支
  }
}

export async function setup(): Promise<void> {
  if (isDistFresh()) {
    console.log('[global-setup] dist/ 已是最新，跳过 npm run build');
    return;
  }
  console.log('[global-setup] dist/ 缺失或落后于构建输入，执行 npm run build ...');
  execFileSync('npm', ['run', 'build'], { cwd: PROJECT_ROOT, stdio: 'inherit', timeout: 180_000 });
  console.log('[global-setup] npm run build 完成');
}
```

**修订记录（4a/4b 审查后修订）**：上述伪代码用 `dist/cli/index.js` 的 mtime 作为「已完整构建」的代理指标，经对抗审查发现缺陷——本仓库 `tsconfig.json` 未开 `noEmitOnError`，若上次 `npm run build` 中途被打断（Ctrl-C / OOM kill 等），入口文件可能已 emit 而其余模块未完成、postbuild 更未跑，此时入口文件 mtime 仍会被判定为「新鲜」，导致长期跳过重建、测试跑在半写 dist 上——且相对旧设计（每个 `beforeAll` 无条件重建）反而丧失了自愈能力，这是本次修复不应引入的新回归面。

修法：新鲜度锚点改为 `dist/.spectra-build-meta.json`（`BUILD_META_NAME`，`scripts/postbuild-stamp.mjs` → `stampBuild` 在 `npm run build` 流水线**最后一步**写入）——`fresh` 判定改为 `existsSync(DIST_CLI) && existsSync(META) && statSync(META).mtimeMs >= newestMtimeMs(FULL_BUILD_INPUT_PATHS)`。build-meta 是整条流水线（prebuild + tsc + postbuild）最后落盘的产物，只有全部步骤走完才会存在/被刷新，锚定它等价于锚定「构建完整结束」这一事件本身，不再受 tsc 逐文件 emit 顺序的影响。仍保留 `existsSync(DIST_CLI)` 校验（meta 在但入口文件被手动删除的怪态也要判不新鲜）。`stampBuild` 在非 git 环境会跳过盖章（meta 恒缺失），此时 `isDistFresh()` 恒返回 false、每次都重建——这是可接受的保守偏置：非 git 环境本就无法验证构建完整性，宁可多付一次构建成本也不能悄悄采信无法证实完整性的 dist。implement 阶段已按此修订落地（见 `tests/global-setup.ts` 实现）。

**修订记录（内部对抗复审后修订，第二轮）**：4a/4b 那一轮把锚点从 `dist/cli/index.js` mtime 换成了 `dist/.spectra-build-meta.json` mtime，但内部对抗复审（Codex 配额烧穿期间的降级替代）抓到一个 mtime 判据本身的结构性漏洞（C1）：**任何** mtime 比较（不论锚定哪个文件）都无法处理"构建进行中发生 src 编辑"这一时序——tsc 编译窗口是秒级的，若编辑发生在 build 开始之后、meta 落盘之前，该编辑的 mtime 必然早于稍后才写入的 meta mtime，此后的比较会误判为"dist 已覆盖这次编辑"，实际上 dist 里根本不含它，且后续不会有任何告警，直到出现一次发生在构建完成之后的独立编辑才会被侦测到。此外 mtime 判据还有同根的旁路问题：`tar -x` / `rsync -t` / `cp -p` 等保留源 mtime 的复制方式会造成 mtime 倒退，同样能造出「明明源码更新了，mtime 却比 dist 旧」的漏建假象。

处置：新鲜度判据从"任何形式的 mtime 比较"整体换成**输入内容指纹**——`computeInputsFingerprint()` 在 `tests/global-setup.ts` 内自持实现（不改 `scripts/lib/*`），遍历 `FULL_BUILD_INPUT_PATHS` 全部文件（递归目录、跳过不存在项，含 F176 遗留的 `tsconfig.build.json` 死条目），按排序后的相对路径逐个把 `path + '\0' + sha256(content)` 喂入一个总 sha256，产出十六进制指纹。`setup()` 流程改为：**构建前**先算一次快照 `snapshot`；若 `existsSync(DIST_CLI) && existsSync(BUILD_META) && sidecar 存在且可解析 && sidecar.inputsSha256 === snapshot` 则跳过；否则触发 build，build 成功后把 `{ schemaVersion: 1, inputsSha256: snapshot }`（注意是**构建前**算的那份快照，不是构建后重算）写入测试基础设施自有的 sidecar `dist/.spectra-test-inputs.json`（不动 `stampBuild`/postbuild 链路；`dist/` 本就 gitignored）。关键语义：sidecar 落盘的是"决定要构建那一刻"的输入快照——如果构建期间又有新编辑，那次编辑不会被这份快照覆盖，下次运行现算指纹时会与快照不同，从而正确触发下一轮重建，彻底堵死 C1 描述的窗口；同时内容指纹完全不依赖任何文件系统时间戳，天然免疫 mtime 倒退问题。`newestMtimeMs()` 函数随 mtime 判据一并删除，不留死代码。

本轮同时处置的次要发现（W2-W5）：
- **W2（注释 over-claim）**：头注释「从时间上彻底消除竞写窗口」改为如实表述——保证仅限**单个 vitest 进程内**；同一 worktree 上并发跑多个独立 `vitest run` 进程且恰好都判定 dist stale 时仍有跨进程双 build 窗口，是已知且接受的残余风险（相比修复前"贯穿整个测试执行阶段"的竞写已收敛到"仅启动瞬间"；不加文件锁的理由是 stale-lock 处理引入的失败面与该场景发生概率不成比例）。
- **W3（fail-loud 落注释）**：`runBuild()` 内 `execFileSync` 抛错时不 catch，让异常冒泡锁死整个测试运行——这是有意决策，写入函数头注释：编译失败时静默降级为"继续用旧 dist 跑测试"等价于用不含最新改动的产物冒充测试通过的假绿，违背本仓门禁哲学。
- **W4（watch 模式接线）**：核实 vitest 3.2.4 源码（`node_modules/vitest/dist/chunks/reporters.d.*.d.ts` 对 `TestProject` 的类型定义，`GlobalSetupContext = TestProject`）确认 `onTestsRerun(cb): void` 是非 deprecated 的公开 API，`setup(project)` 的 `project` 参数即可调用。已接线：watch rerun 前复用同一套指纹判据与 `runBuild()`，指纹不匹配则重建，不再是"文档记忆式"的猜测接口。
- **W5（CI fixture-isolation 白跑 build）**：核实 `tests/integration/cross-project-isolation.test.ts`（grep 确认）不 spawn/import 任何 dist 产物，只做 `fixture-meta.json` 契约层断言——加环境开关 `SPECTRA_TEST_SKIP_DIST_BUILD=1`，`setup()` 检测到即打印原因并直接 return；`.github/workflows/fixture-isolation.yml` 的对应 vitest 步骤加此 env（4 个 matrix job 各自跳过一次空耗的 `npm run build`）。
- **I1+I2（dist-cli-guard 路径锚定 + meta 校验）**：`tests/helpers/dist-cli-guard.ts` 路径锚定从 `resolve(process.cwd())` 改为 `import.meta.url` 推导仓库根（与 `tests/global-setup.ts` 同构，不依赖调用方 cwd）；`assertDistBuilt()` 同时校验 `BUILD_META`（从 `spectra-version-gate.mjs` 导入 `BUILD_META_NAME`），meta 缺失时的错误文案改为提示"构建不完整/被中断"。
- **I4（非 git 环境注释修正）**：「meta 恒缺失」的说法不准确——历史遗留的旧 meta 文件可能仍在磁盘上，只是不会被刷新。改写为：非 git 环境下 `stampBuild` 跳过盖章 → meta 不刷新（但不代表不存在）；配合内容指纹判据，指纹不匹配即触发重建，残留的旧 meta 不会导致误判 fresh。

**修订记录（delta 复审后修订，第三轮）**：第二轮把 mtime 判据整体换成了内容指纹快照，但 delta 复审（Codex 配额烧穿期间的降级替代）抓到该实现里的一个新 CRITICAL（C1）：`runBuild()` 当时的顺序是"先 `execFileSync` 再 `writeSidecar`"，而本仓库 `tsconfig.json` 未开 `noEmitOnError`——编译失败时 tsc 仍会把已经成功编译的部分文件 emit 进 `dist/`。这会造出一个静默假新鲜序列：状态 S 成功构建（sidecar 记录 `H(S)`）→ 改成 S'（引入类型错误）→ `npm run build` 失败但 `dist/` 已经被写成 `compile(S')` 的半成品 → 把 S' 回退回 S → 现算指纹 `H(S)` 与 sidecar 里的 `H(S)` 相等 → `isDistFresh()` 判 true → 全程静默跑在这份半成品 dist 上，没有任何提示。

处置（C1，必修）：`runBuild()` 改为 `rmSync(sidecar, { force: true })` **在 `execFileSync` 之前**执行——构建一旦开始，旧快照立即失效；只有构建完整走完（`execFileSync` 未抛）才重新写入新快照。这样任何失败/中途被打断的构建都会让 sidecar 处于"不存在"状态，下一次运行现算指纹时 `readSidecarFingerprint()` 因文件缺失返回 `null`，`isDistFresh()` 恒为 `false`，无条件触发重建——用"构建失败必须留下无 sidecar 的痕迹"把假新鲜的窗口彻底堵死。

本轮同时处置的次要发现（W1-W4、I 系）：
- **W1（指纹计算 TOCTOU 防御）**：`computeInputsFingerprint()` 会遍历/读取上百个文件，此前全程无 try/catch——遍历窗口内文件被并发操作删除/替换（如另一进程正在 `git checkout`）会让 `readFileSync`/`statSync` 裸抛异常，打穿 `setup()`（watch 模式下更是直接杀死 watch 进程）。改为签名返回 `string | null`：整体 try/catch，异常时 `console.warn` 说明原因并返回 `null`；`isDistFresh(null)` 恒为 `false`；`runBuild()` 收到 `null` 时只删旧 sidecar、不写新 sidecar，保持"下次无条件重建"的保守语义。取舍：读不到输入内容不代表 dist 已经新鲜，宁可多付一次构建成本，也不用一种新的竞态 flaky 替换掉旧的构建竞写 flaky；真正持久性的错误交给触发的 `npm run build` 自己 fail-loud 暴露。
- **W2（SKIP 开关自我强制）**：`tests/helpers/dist-cli-guard.ts` 的 `assertDistBuilt()` 开头新增：若检测到 `SPECTRA_TEST_SKIP_DIST_BUILD=1` 直接 throw，说明该开关的契约是"本次运行完全不消费 dist/"，但调用 `assertDistBuilt()` 这个动作本身就是在声明"我是 dist 的消费方"——两者矛盾（零误报：真正不消费 dist 的测试文件从不会走到这个调用点，不会被此检查误伤）。`SKIP_ENV_VAR` 常量值在两个文件里各自用字面量持有，不做反向 import（避免测试基础设施内部循环耦合）。
- **W3（watch 重建失败不再杀会话）**：`onTestsRerun` 回调整体包 try/catch——重建失败时打印醒目多行日志（dist 可能陈旧、修复编译错误后下次 rerun 自动重试、sidecar 已失效）后吞掉异常放行本次 rerun，不杀 watch 进程。理由：watch 模式下频繁出现"中间态编译不过"是正常开发节奏，若因此杀会话会让 watch 模式整体不可用；C1 的"先删后写"已保证失败态必然自愈（下次 rerun 会因 sidecar 缺失重新判定不新鲜）。非 watch 首次 `setup()` 的 fail-loud 语义不受影响，两者场景不同：首次运行失败意味着"从一开始就没有可用的 dist"，理应直接失败；watch rerun 失败意味着"之前跑过的 dist 还在，只是这一轮改动编译不过"，是两种不同严重程度的状态。
- **W4（成本对比裁决，文档化不加机制）**：头注释「已知边界」补充：`npm run build && npx vitest run`（含 CI `ci.yml`、`prepublishOnly`）这类先手动 build 一次再跑 vitest 的调用序列，因为 sidecar 还不存在会让 globalSetup 多付一次构建判定/重建。裁决：接受该成本，不引入基于 git commit/diff 的锚定回退证据链——与修复前基线（CI 内 5 处 `beforeAll` 各自无条件 build）相比仍净省 4 次构建，超出本次 fix 范围的进一步优化留待未来独立评估。
- **I4（sidecar 迁出 dist/）**：`TEST_INPUTS_SIDECAR` 从 `dist/.spectra-test-inputs.json` 迁到 `node_modules/.cache/spectra/test-build-inputs.json`（`writeSidecar` 前 `mkdirSync(..., { recursive: true })`）。why：`dist/` 在 `package.json` 的 `files` 白名单内，`prepublishOnly` 跑的 vitest 会让 sidecar 被一并打进 npm 发布包；`.cache/` 天然不入包不入库；`npm ci` 清空 `node_modules` 时 sidecar 随之消失，触发一次保守重建，方向正确；dist 完整性判定不受影响（仍由 `DIST_CLI` + `BUILD_META` 独立锚定）。
- **I1（死代码清理）**：`isDistFresh()` 外层 try/catch 是死代码——`readSidecarFingerprint()` 自带 catch、`existsSync()` 不抛异常——已删除。
- **I2（sidecar schemaVersion 校验）**：`readSidecarFingerprint()` 新增 `parsed.schemaVersion !== 1` 时返回 `null` 的显式校验，不再只看 `inputsSha256` 字段类型。
- **I6（日志去重）**：「dist/ 缺失或落后于构建输入，执行 npm run build ...」这行日志从 `runBuild()` 内上提到两个调用方各自措辞——首次 `setup()` 沿用原文案；watch 分支改用「watch rerun：输入指纹已变化，重建 dist/ ...」单条，不再重复打印两条相似日志。
- **I7（注释精确化）**：头注释「5(8) 处」改为「7 个文件 8 处」，与实际替换范围（Phase 2 的 T004-T011）一致。

vitest.config.ts 改动（根级 `test.*`，与 `projects` 同级，紧邻 `maxWorkers` 声明之后即可）：

```ts
test: {
  // ...既有字段...
  globalSetup: './tests/global-setup.ts',
  projects: [ /* 不变 */ ],
}
```

不直接改 `scripts/lib/spectra-version-gate.mjs`（该模块被 SWE-bench 评测/版本门禁多处引用，属于评测关键路径），只 `import` 其已导出的 `BUILD_INPUT_PATHS` 常量，不新增/修改该文件的任何导出，保持其 blast radius 不变。

### 3. 5(8) 处 beforeAll 的统一替换形态

新增共享 helper `tests/helpers/dist-cli-guard.ts`：

```ts
// tests/helpers/dist-cli-guard.ts
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const DIST_CLI = resolve('dist/cli/index.js');

/**
 * F251：dist/ 的构建职责已收拢到 vitest globalSetup（tests/global-setup.ts），
 * 测试执行期任何测试文件都不应再触发 `npm run build`——并发写同一份 dist 会让
 * spawn 的 dist CLI 子进程读到半写产物（F251 根因）。本函数只做 fail-fast
 * 存在性断言：dist 缺失说明 globalSetup 未执行/被绕过，此时应提示排查配置，
 * 而不是在测试进程内静默补建（那样又会重新引入竞写面）。
 */
export function assertDistBuilt(): void {
  if (!existsSync(DIST_CLI)) {
    throw new Error(
      [
        'dist/cli/index.js 不存在。',
        'dist 构建已收拢到 vitest globalSetup（tests/global-setup.ts），应在测试执行前自动完成。请检查：',
        '  1. 是否绕过了 vitest 的 globalSetup 机制运行测试（如直接用 node --test）；',
        '  2. vitest.config.ts 根级 test.globalSetup 是否被覆盖/移除；',
        '  3. globalSetup 是否因 npm run build 失败而提前退出（查看本次运行开头的 [global-setup] 日志）。',
        '临时手动修复：npm run build',
      ].join('\n'),
    );
  }
}
```

8 处调用点统一替换为：

```ts
beforeAll(() => {
  assertDistBuilt();
});
```

（去掉原有的 `120_000`/`60_000` 显式 hook 超时第二参数——`assertDistBuilt()` 是同步 `existsSync`，毫秒级，各 project 的默认 `testTimeout` 已足够覆盖，不需要为一个不再执行构建的钩子保留分钟级超时。）

逐文件替换范围：
- `tests/unit/graph-quality-core.test.ts` L83-86 → 单行替换
- `tests/integration/cli-e2e.test.ts` L31-38（第一处）→ 单行替换
- `tests/integration/cli-e2e.test.ts` L138-153（第二处，`beforeAll` 内除 build 调用外还有 fixture/env 初始化逻辑）→ **只删除第 139 行 `execFileSync('npm', ['run', 'build'], ...)`，在其原位置插入 `assertDistBuilt();`，其余 fixtureDir/fakeHome/fakeBin/zeroAuthEnv 初始化逻辑保持不变**（这些逻辑与 build 无关，不属于本次修复范围）
- `tests/integration/init-e2e.test.ts` L41-48 → 单行替换
- `tests/integration/graph-quality-cli.test.ts` L94-98 → 单行替换
- `tests/unit/contracts/graph-quality-report-schema.test.ts` L92-97 → 单行替换
- `tests/integration/graph-quality-adversarial.test.ts` L55-60 → 单行替换（同时修复其"只判存在不判新鲜"的潜伏缺口，副作用）
- `tests/integration/graph-quality-lang-matrix.test.ts` L54-60 → 单行替换（同上，且紧邻的 `GRAPH_PATH` pinned fixture 存在性检查 `beforeAll` 保持不动）

8 处文件顶部均已 `import { execFileSync } from 'node:child_process'`（或与 `spawnSync` 同时导入），且均在文件内其他位置（gitConfig / runCLI / initGitRepoWithCommit 等 helper）继续使用 `execFileSync`——逐文件核实完毕，**无需删除任何现有 import**，新增 `import { assertDistBuilt } from '../helpers/dist-cli-guard.js'`（或按各文件相对路径调整；`tests/unit/contracts/` 下需 `'../../helpers/dist-cli-guard.js'`）。

### 4. 单文件运行 / `--project` 过滤 / CI 冷缓存下的行为核对

依据决策点 1 的源码核查结论逐一核对：

| 场景 | 行为 |
|------|------|
| `npx vitest run`（全量） | globalSetup 执行一次，早于任意 worker fork；新鲜则跳过构建，否则构建一次 |
| `npx vitest run --project unit` / `--project integration` | 同上——`coreProject` 恒被加入 `initializeGlobalSetup` 的待初始化集合，与 `--project` 过滤无关 |
| `npx vitest run tests/unit/graph-quality-core.test.ts`（单文件） | 同上；即使该文件本身不再触发 build，globalSetup 仍会先跑一次新鲜度判定 |
| `npm run test:e2e` / `--project golden-master` / `--project self-hosting`（不含本次 8 处文件所在 project） | globalSetup 仍会执行（根级声明穷举所有调用形态），保证这些 project 里的 dist 消费者也拿到新鲜 dist——比修复前更安全（修复前它们完全依赖"恰好同批跑了某个 builder 文件"这一偶然条件） |
| CI 冷缓存（`npm ci` 后首次 `npx vitest run`，dist 不存在） | `isDistFresh()` 因 `existsSync(DIST_CLI)` 为 false 直接判定不新鲜 → 触发一次 `npm run build`，`timeout: 180_000` 覆盖 fix-report 提到的最坏 10-30s 口径并留有余量 |

**已知且接受的行为变化（非缺陷，需在验证阶段确认符合预期）**：根级声明意味着**任何**一次 vitest 调用都会先付一次新鲜度判定成本，即使该次调用只涉及与 dist CLI 完全无关的纯单元测试文件。修复前，只有恰好命中原 5/8 处 builder 文件的调用才会触发 build。这是 vitest globalSetup 机制本身"全局、无法按匹配文件精细化触发"的架构约束（决策点 1 已排除按 project 精细化声明的方案），不是本次修复可以绕开的实现细节。因为判定本身极快（毫秒级 mtime 扫描）、且只有源码真正比 dist 新时才会付构建代价，预期对开发者日常体验的影响可接受。

### 5. 回归风险清单

| 风险 | 分析 | 处置 |
|------|------|------|
| `graph-quality-cli.test.ts` / `graph-quality-core.test.ts` 等注释里的"先红"TDD 语义（新命令实现前 dist 不含该命令，构建失败会让测试观测到失败而非误报通过） | 新鲜度判据以 mtime 比较为准：新增/修改 `src/` 下任意文件后，其 mtime 必然新于上一次构建产物的 mtime，`isDistFresh()` 会判定为 false 并触发重建——语义与"每次强制 build"等价，未被弱化 | 验证阶段用一次"改动 src 后跑受影响测试"的场景手动确认（见验证方案第 4 项） |
| `graph-quality-adversarial.test.ts` / `graph-quality-lang-matrix.test.ts` 原有"只判存在"逻辑被替换为"assert 已构建"后，是否有测试隐式依赖"dist 缺失时自动补建"的行为 | 两文件内后续用例均直接消费已构建的 dist CLI，未见对"beforeAll 触发 build"这一副作用本身的断言 | 全量跑通即可确认，无需额外用例 |
| `tests/e2e/helpers/stdio-client.ts`、`mcp-server-stdio.test.ts`、`cli-coldstart.test.ts` 等既有"dist 缺失 → skip"分支 | globalSetup 落地后，只要 `npm run build` 未失败，这些分支在正常全量/单独 project 调用下都不会再触发（dist 恒已构建）；分支保留作防御（fix-report 已定性为"安全，近乎死代码"），本次不删除 | 不改动这些文件 |
| `cli-e2e.test.ts` 第二个 describe（"CLI 零认证隔离端到端测试"）beforeAll 内 fixture 初始化逻辑与 build 调用顺序耦合 | 替换后 `assertDistBuilt()` 仍在 `fixtureDir = mkdtempSync(...)` 之前执行，顺序不变，只是不再执行子进程 build；无副作用差异 | 保持代码物理位置，只替换 build 那一行 |
| globalSetup 本身失败（如 `npm run build` 因真实编译错误退出非 0） | `execFileSync` 默认在非 0 退出码时抛异常，异常从 `setup()` 冒泡到 vitest 的 `initializeGlobalSetup` 调用点，整个测试运行会在执行任何测试前直接失败并打印 tsc 错误——比修复前"某个 builder 文件的 beforeAll 抛错，仅该 describe 块失败，其余测试仍可能跑在陈旧 dist 上"更早、更清晰地暴露问题 | 验证阶段确认错误信息包含可定位的 tsc 输出（`stdio: 'inherit'` 已保证） |
| 新增文件 `tests/global-setup.ts` 不在根 `tsconfig.json` 的 `include` 范围内（`exclude` 含 `"tests"`） | 与仓库内其余全部 `tests/**/*.ts` 文件现状一致——不参与 `npm run lint`（`tsc --noEmit`）检查，仅由 vitest 自身的 vite-node 转译执行，无编译期类型门禁缺口新增 | 不需要修改 tsconfig |
| `BUILD_INPUT_PATHS` 是从 `.mjs` 文件（无类型声明）导入 | 沿用仓库既有约定（如 `graph-quality-core.test.ts` L23-24 对同类 `.mjs` import 的 `@ts-expect-error` 处理），非新模式 | 无需额外处理 |

### 6. 验证方案

1. `npm run build` 手动跑一次确认基线可编译（排除本次改动前就存在的编译错误干扰判断）。
2. `npx vitest run` 全量跑一次，零失败；观察 `[global-setup]` 日志确认只打印一次"执行 npm run build"或"跳过构建"（而非每个 project 重复打印）。
3. **满载全量复跑 ≥3 轮**（不清 dist、不改动任何源文件，模拟 fix-report 复现条件的"全量并行"场景）：`for i in 1 2 3; do npx vitest run; done` 全部零失败、零偶发——对照 fix-report 的原始复现形态（"F250 交付期两次全量跑各复现 1 次"），3 轮零偶发是本次判定"竞写已消除"的直接证据。
4. TDD 语义回归确认：临时 touch 一个 `src/` 下文件（如 `touch src/cli/index.ts`）后单独跑 `npx vitest run tests/unit/graph-quality-core.test.ts`，确认 `[global-setup]` 日志显示"执行 npm run build"（证明新鲜度判据未被弱化为"无条件跳过"）。
5. 变异验证（对应 fix-report 验证要求）：`grep -rn "run.*build" tests/` 确认 tests/ 目录下不再有任何测试文件在测试执行期调用 `npm run build`（`tests/global-setup.ts` 本身除外——它不是"测试文件"，且执行时机在测试执行期之前，需在 grep 结果里人工甄别排除）。
6. `npm run repo:check` 与既有覆盖率门槛（80%/95%）不受影响，作为兜底回归确认（本次改动不触及生产代码 `src/`，覆盖率数字不应变化）。

## Constitution Check

无 `.specify/memory/constitution.md` 专属条款与本次改动冲突（改动范围限定在 `tests/` 测试基础设施 + `vitest.config.ts` 配置，不触及生产代码 `src/`、不改变任何公共 API/CLI 契约、不涉及数据迁移）。遵循仓库既有约定：
- 共置 helper 放 `tests/helpers/`（已有先例：`tests/helpers/freshness-stale-scenarios.ts` 等）
- 中文注释说明 why（新鲜度判据的取舍论证、根级 vs per-project 声明的拒绝理由）
- 不修改 `scripts/lib/spectra-version-gate.mjs`（评测关键路径模块），只消费其导出常量

## Impact Assessment（精简版，fix 模式）

- **影响文件数**：9（新增 `tests/global-setup.ts` + `tests/helpers/dist-cli-guard.ts`，修改 `vitest.config.ts` + 7 个测试文件）
- **跨包影响**：无（全部改动限定在 `tests/` 与仓库根 `vitest.config.ts`，不跨越 `src/`、`plugins/`、`scripts/` 生产代码边界；`scripts/lib/spectra-version-gate.mjs` 只被导入消费，不修改）
- **数据迁移**：无
- **API/契约变更**：无（不改变任何生产代码的对外行为、CLI 契约或 MCP 工具契约）
- **风险等级**：**LOW**（影响文件数 9 < 20 阈值线附近但均为测试基础设施；无跨包影响；无数据迁移；无契约变更）——不触发 HIGH 强制分阶段要求，采用单阶段实施即可

## Complexity Tracking

无 Constitution 违规项，本表无需填写。
