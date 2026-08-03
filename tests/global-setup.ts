/**
 * F251 — vitest globalSetup：dist/ 单点构建 + 测试执行期只读。
 *
 * 根因（详见 specs/251-fix-dist-race-test-isolation/fix-report.md）：此前 7 个文件 8 处
 * 测试各自在 `beforeAll` 里无条件/半条件 `npm run build`，与全量并行下 ~14 个 spawn dist
 * CLI 的测试文件产生「构建期与消费期」时间重叠——tsc 逐文件 emit 非原子，子进程可能读到
 * 半写产物，表现为偶发 JSON.parse 失败。
 *
 * 本文件把构建职责收拢到 vitest 的 globalSetup 阶段（单 vitest 进程内所有 worker fork
 * 之前的单进程串行执行一次，详见 plan.md 决策点 1 的源码核查）。7 个文件 8 处 beforeAll
 * 改为 `assertDistBuilt()`（见 tests/helpers/dist-cli-guard.ts）纯 fail-fast 存在性断言，
 * 不再触发任何构建。
 *
 * 已知边界（如实表述，不 over-claim）：
 * - 本方案在**单个 vitest 进程内**彻底消除竞写窗口（globalSetup 是该进程唯一的构建
 *   触发点）。若同一 worktree 上并发跑多个独立的 `vitest run` 进程（如两个终端同时跑），
 *   且两者的 globalSetup 恰好都判定 dist stale，仍存在跨进程的双 build 窗口——这与
 *   修复前「跑批全程 8 处 beforeAll 交错触发 build」相比，已把竞写窗口从「贯穿整个测试
 *   执行阶段」收敛到「仅在启动瞬间」，是已知且接受的残余风险：不用文件锁互斥的理由是，
 *   锁文件的 stale-lock 处理（进程崩溃后锁未释放）引入的失败面与「极少发生的跨进程
 *   并发 vitest run」这一场景相比不成比例。
 * - 内容指纹快照（sidecar）落在 `node_modules/.cache/`，`npm ci` 会清空 `node_modules`
 *   连带清掉 sidecar；同理 `npm run build && npx vitest run`（含 CI `ci.yml`、
 *   `prepublishOnly`）这类"先手动 build 一次、紧接着跑 vitest"的调用序列，因为 sidecar
 *   还不存在，globalSetup 会判不新鲜再重新触发一次 `npm run build`——是快照判据带来的
 *   确定性成本，多付一次构建。与修复前基线相比（CI 内 5 个文件 6 处 beforeAll 各自无条件
 *   build，其中 `cli-e2e.test.ts` 一个文件就占 2 处）仍净省 5 次构建，接受该成本，不为此
 *   额外引入基于 git commit/diff 的锚定回退证据链（超出本次 fix 的范围）。
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import type { GlobalSetupContext } from 'vitest/node';
// @ts-expect-error — .mjs 无类型声明，运行时可解析（沿用 graph-quality-core.test.ts 既有约定）
import { BUILD_INPUT_PATHS, BUILD_META_NAME } from '../scripts/lib/spectra-version-gate.mjs';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_CLI = join(PROJECT_ROOT, 'dist', 'cli', 'index.js');
const BUILD_META = join(PROJECT_ROOT, 'dist', BUILD_META_NAME as string);
// 内部对抗复审后修订（I4）：sidecar 从 `dist/.spectra-test-inputs.json` 迁到
// `node_modules/.cache/`。why：`dist/` 在 package.json 的 `files` 白名单内，
// `prepublishOnly` 会跑一次 vitest，若 sidecar 留在 `dist/` 里会被一并打进 npm 发布包
// （测试基础设施的内部状态不应该出现在发布产物里）。`.cache/` 天然不入包、不入库；
// `npm ci` 清空 `node_modules` 时 sidecar 随之消失，触发一次保守重建，方向正确。
// dist 本身的完整性判定不受影响——仍由 DIST_CLI + BUILD_META 的存在性单独锚定。
const TEST_INPUTS_SIDECAR = join(PROJECT_ROOT, 'node_modules', '.cache', 'spectra', 'test-build-inputs.json');

// BUILD_INPUT_PATHS（F176 版本门禁语义）只覆盖 tsc 自身输入；本判据要覆盖完整
// `npm run build` 流水线（prebuild + tsc + postbuild），额外补 prebuild/postbuild 脚本
// 本身——避免"改了内联/盖章逻辑但没碰 src"时判新鲜误跳过。
// 注：BUILD_INPUT_PATHS 含 F176 遗留的 `tsconfig.build.json`（本仓库实际不存在该文件），
// 下方 computeInputsFingerprint 对不存在路径直接跳过，无需在此特殊处理。
const FULL_BUILD_INPUT_PATHS: string[] = [
  ...(BUILD_INPUT_PATHS as string[]),
  'scripts/inline-d3.ts',
  'scripts/postbuild-stamp.mjs',
  'scripts/lib/spectra-version-gate.mjs',
];

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * 新鲜度判据：以「构建启动前」对全部输入文件内容算出的 sha256 指纹作为快照
 * （而非 mtime 比较——mtime 判据不论锚定哪个文件都无法处理"构建进行中发生 src 编辑"
 * 这一时序，也不免疫 tar/rsync/cp -p 等保留源 mtime 的复制方式造成的 mtime 倒退；
 * 详见 plan.md 决策点 2 第二轮修订记录）。
 *
 * 内部对抗复审后修订（W1，TOCTOU 防御）：本函数会遍历并读取上百个文件，遍历/读取窗口内
 * 文件被并发改动（如 `git checkout` 正在切换分支、另一进程正在 `rm`）或变得不可读，都会让
 * `readFileSync`/`statSync` 裸抛异常。若不处理，这个异常会直接打穿 `setup()`——非 watch
 * 模式下杀死整个测试运行，watch 模式下更是直接杀掉 watch 进程本身，属于用一种新的
 * flaky（指纹计算期间的竞态）替换掉旧的 flaky（dist 竞写），得不偿失。
 *
 * 处置：整体 try/catch，失败时 `console.warn` 说明原因并返回 `null`；调用方把 `null`
 * 一律当"无法证明新鲜"处理（保守偏置，触发重建）。取舍依据：读不到输入文件的内容，
 * 不代表 dist 已经新鲜——宁可多付一次构建成本，也不能在无法完成指纹计算的情况下继续
 * 假设"和上次一样"。真正持久性的错误（比如输入路径整体损坏）会在触发的 `npm run build`
 * 里自己 fail-loud 暴露出来，不需要本函数越俎代庖去区分"瞬时竞态"与"真实故障"。
 */
function computeInputsFingerprint(): string | null {
  try {
    const files: string[] = [];
    const visit = (abs: string): void => {
      if (!existsSync(abs)) return;
      const stat = statSync(abs);
      if (stat.isDirectory()) {
        for (const e of readdirSync(abs, { withFileTypes: true })) visit(join(abs, e.name));
      } else {
        files.push(abs);
      }
    };
    for (const rel of FULL_BUILD_INPUT_PATHS) visit(join(PROJECT_ROOT, rel));
    files.sort();

    const outer = createHash('sha256');
    for (const abs of files) {
      const rel = relative(PROJECT_ROOT, abs);
      const contentHash = sha256Hex(readFileSync(abs));
      outer.update(`${rel}\0${contentHash}`);
    }
    return outer.digest('hex');
  } catch (err) {
    console.warn(
      `[global-setup] 指纹计算失败（文件在遍历/读取窗口被并发改动（TOCTOU）或不可读），保守判定为不新鲜: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return null;
  }
}

interface TestInputsSidecar {
  schemaVersion: 1;
  inputsSha256: string;
}

/** 解析失败/schemaVersion 不匹配/字段缺失/文件不存在一律返回 null（保守偏置）。 */
function readSidecarFingerprint(): string | null {
  try {
    if (!existsSync(TEST_INPUTS_SIDECAR)) return null;
    const parsed = JSON.parse(readFileSync(TEST_INPUTS_SIDECAR, 'utf-8')) as Partial<TestInputsSidecar>;
    if (parsed.schemaVersion !== 1) return null;
    return typeof parsed.inputsSha256 === 'string' ? parsed.inputsSha256 : null;
  } catch {
    return null;
  }
}

function writeSidecar(inputsSha256: string): void {
  mkdirSync(dirname(TEST_INPUTS_SIDECAR), { recursive: true });
  const payload: TestInputsSidecar = { schemaVersion: 1, inputsSha256 };
  writeFileSync(TEST_INPUTS_SIDECAR, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
}

/**
 * fresh 判定需要 dist 入口 + build-meta + sidecar 三者同时具备，且 sidecar 记录的指纹与
 * 当前现算指纹一致。`currentFingerprint` 为 `null`（指纹计算失败）时直接判不新鲜——
 * 无法证明新鲜就不能采信。任何一环缺失/不匹配都判不新鲜（宁可多建，不可漏建）。
 *
 * 关于 build-meta：`stampBuild`（`scripts/postbuild-stamp.mjs` 调用）在非 git 环境
 * （无 `.git` 目录）会抛错，postbuild 脚本捕获后跳过盖章、不阻断 build——此时
 * `dist/.spectra-build-meta.json` 不会被刷新（若目录里有更早遗留的旧 meta 文件，它会
 * 原样保留在磁盘上，而非"从此恒缺失"）。但这不会导致误判新鲜：本判据的核心锚点是内容
 * 指纹而非 meta 本身的存在时间，旧 meta 配合"当前指纹与 sidecar 不匹配"仍会正确触发
 * 重建；meta 存在性检查只是防"入口文件在但构建从未走完/被中断"这一结构性怪态的兜底。
 */
function isDistFresh(currentFingerprint: string | null): boolean {
  if (currentFingerprint === null) return false;
  if (!existsSync(DIST_CLI) || !existsSync(BUILD_META)) return false;
  const sidecarFingerprint = readSidecarFingerprint();
  return sidecarFingerprint !== null && sidecarFingerprint === currentFingerprint;
}

/**
 * 内部对抗复审后修订（C1，delta 复审必修）：本仓库 `tsconfig.json` 未开 `noEmitOnError`，
 * 编译失败时 tsc 仍会把已成功的部分文件 emit 进 `dist/`。此前的实现是"先
 * `execFileSync` 再 `writeSidecar`"，这在下面这个序列里会产生一个静默假新鲜：
 *
 *   状态 S 成功构建（sidecar 记录 H(S)）→ 改成 S'（引入类型错误）→ build 失败但
 *   dist/ 已经被 tsc 写成了 compile(S') 的半成品 → 把 S' 回退回 S → 现算指纹 H(S)
 *   与 sidecar 里的 H(S) 相等 → `isDistFresh()` 判 true → 静默跑在"半成品 dist"上，
 *   测试全程不会有任何提示。
 *
 * 修法：`rmSync(sidecar, { force: true })` **必须在 `execFileSync` 之前**执行——构建
 * 一旦开始，旧快照立即失效；只有构建完整走完（`execFileSync` 未抛）才重新写入新快照。
 * 这样任何失败/中途被打断的构建（`execFileSync` 抛异常）都会让 sidecar 处于"不存在"
 * 状态，下一次运行现算指纹时 `existsSync(TEST_INPUTS_SIDECAR)` 为 false，
 * `readSidecarFingerprint()` 返回 null，`isDistFresh()` 恒为 false，无条件触发重建——
 * "构建整体失败/被打断"这一支路径的假新鲜窗口已被彻底堵死。
 *
 * 内部对抗复审后修订（W1 收尾）：上面这个修法仍留了一个更窄的残余窗口——如果构建**成功**
 * 走完，但 `execFileSync` 尚未返回期间有人对输入文件做了"编辑又精确回退"（编辑后的内容
 * 被 tsc 实际采样进了这次编译，随后在构建结束前又改回原样），`fingerprintBeforeBuild`
 * 里存的"构建开始前"快照与 tsc 真正采样到的瞬时内容并不是同一回事，此时直接写入
 * `fingerprintBeforeBuild` 仍可能让 sidecar 与 dist 实际内容不对应。另一条独立的触发
 * 路径是 prebuild 脚本（`scripts/inline-d3.ts`）会按需自改
 * `src/panoramic/exporters/html-template.ts`（把 d3-force bundle 内联进去）——该文件本身
 * 落在 `FULL_BUILD_INPUT_PATHS` 覆盖范围内，若这次构建恰好触发了 d3 版本升级的自改写，
 * "构建前"快照同样不等于"构建后"dist 真正对应的输入状态。
 *
 * 处置：build 成功后**重算一次**指纹（本机实测约 18ms，量级可忽略），只有
 * `fingerprintAfterBuild !== null && fingerprintAfterBuild === fingerprintBeforeBuild`
 * 才写入 sidecar；不相等（含 prebuild 自改场景）或重算失败（W1 TOCTOU）时保持"只删不写"
 * ——下次运行因 sidecar 缺失继续触发重建，直到某次构建前后指纹一致才收敛。这个收敛过程
 * 不会无限循环：prebuild 的自改写本身是幂等的（内容不变则跳过写入，见 `inline-d3.ts`
 * 实际日志"内容无变化，跳过写入"），一旦收敛，稳态下不会比原方案多付额外的重建次数。
 *
 * 如实表述该修法的理论地板（不 over-claim）：如果一次编辑与它的精确回退**完全发生在
 * 同一个构建窗口内**（构建前指纹与构建后指纹恰好都不受影响，但编译期间被 tsc 实际读到
 * 的瞬时内容与两端快照均不同），任何基于"构建前/构建后快照比较"的方案都无法探测到这类
 * 窗口——这是快照类判据的结构性理论下限，不是本次实现的疏漏，是已知且接受的边界。
 *
 * fail-loud 是有意决策：`execFileSync` 在 `npm run build`（tsc）编译失败时会抛异常，
 * 这里不 catch——异常应该冒泡穿透调用方，让首次（非 watch）的整个 vitest 运行在执行
 * 任何测试前直接失败并打印 tsc 错误。理由：如果编译失败时静默降级为"继续用旧 dist
 * 跑测试"，等于用一份不含最新改动的产物冒充"测试通过"的假绿，这正是本仓库门禁哲学
 * 要杜绝的行为（宁可整个 suite 不跑，也不能在编译不过的状态下产出看似正常的测试结果）。
 * watch 模式下的容错处理见 `setup()` 内 `onTestsRerun` 回调的 try/catch。
 */
function runBuild(fingerprintBeforeBuild: string | null): void {
  rmSync(TEST_INPUTS_SIDECAR, { force: true });
  execFileSync('npm', ['run', 'build'], { cwd: PROJECT_ROOT, stdio: 'inherit', timeout: 180_000 });
  // W1：只有构建后重算的指纹与构建前的快照完全一致才落盘 sidecar（见函数头注释）；
  // 不一致或重算失败（null）时保持"只删不写"，下次运行会因 sidecar 缺失继续重建。
  const fingerprintAfterBuild = computeInputsFingerprint();
  if (fingerprintAfterBuild !== null && fingerprintAfterBuild === fingerprintBeforeBuild) {
    writeSidecar(fingerprintAfterBuild);
  }
  console.log('[global-setup] npm run build 完成');
}

// 与 tests/helpers/dist-cli-guard.ts 使用同一字面量（两文件各自独立持有常量值，helper
// 不反向 import 本文件以避免测试基础设施内部循环耦合）。
const SKIP_ENV_VAR = 'SPECTRA_TEST_SKIP_DIST_BUILD';

export async function setup(project: GlobalSetupContext): Promise<void> {
  // F251 W5：部分测试套件（如 tests/integration/cross-project-isolation.test.ts，
  // 仅做 fixture-meta.json 契约层断言，未 spawn/import 任何 dist 产物）完全不消费 dist/，
  // 但根级 globalSetup 声明意味着它们每次运行也会被迫付一次构建判定/构建成本。
  // CI 的 fixture-isolation workflow 用 4-way matrix 重复跑同一套件，可通过此开关
  // 显式跳过，避免 4 个 job 各自空跑一次 `npm run build`。
  if (process.env[SKIP_ENV_VAR] === '1') {
    console.log(`[global-setup] ${SKIP_ENV_VAR}=1，本次运行不消费 dist/，跳过构建判定`);
    return;
  }

  const snapshot = computeInputsFingerprint();
  if (isDistFresh(snapshot)) {
    console.log('[global-setup] dist/ 已是最新（输入指纹匹配），跳过 npm run build');
  } else {
    console.log('[global-setup] dist/ 缺失或落后于构建输入，执行 npm run build ...');
    runBuild(snapshot);
  }

  // F251 W4：vitest watch 模式下，globalSetup 只在进程启动时跑一次，此后源码改动不会
  // 自动触发重建。`TestProject.onTestsRerun`（非 deprecated API，见
  // node_modules/vitest/dist/chunks/reporters.d.*.d.ts 对 TestProject 的类型定义）
  // 在每次 watch rerun 前触发，这里复用同一套指纹判据，让 watch 模式下的 dist 也能
  // 跟着源码改动自愈，而不是需要用户手动重启 watch。
  project.onTestsRerun(async () => {
    try {
      const rerunFingerprint = computeInputsFingerprint();
      if (isDistFresh(rerunFingerprint)) {
        console.log('[global-setup] watch rerun：dist/ 仍新鲜，跳过重建');
        return;
      }
      console.log('[global-setup] watch rerun：输入指纹已变化，重建 dist/ ...');
      runBuild(rerunFingerprint);
    } catch (err) {
      // F251 W3：watch 模式下的重建失败**不应该**杀掉整个 watch 会话——开发者在改代码
      // 过程中频繁出现"中间态编译不过"是正常现象，若因此杀会话，watch 模式就完全不可用。
      // 与非 watch 首次 setup 的 fail-loud 语义不同：这里吞掉异常放行本次 rerun，把
      // "dist 可能陈旧"的风险打醒目日志交给开发者自行判断；C1 的"先删后写"已保证失败
      // 构建必然留下无 sidecar 的痕迹，下次 rerun（或修好编译错误后的下次 rerun）会
      // 自动重新判定不新鲜并再次尝试重建，这就是"失败态自愈"，不需要额外记账机制。
      console.error(
        [
          '[global-setup] watch 重建失败：dist 可能陈旧，修复编译错误后下次 rerun 将自动重试',
          `[global-setup] ${err instanceof Error ? err.message : String(err)}`,
          '[global-setup] sidecar 保持失效/不匹配态，本次 rerun 继续放行',
        ].join('\n'),
      );
    }
  });
}
