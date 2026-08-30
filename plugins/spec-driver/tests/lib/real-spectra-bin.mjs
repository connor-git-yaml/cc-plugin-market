/**
 * real-spectra-bin.mjs
 * Feature 268 — 「真实 spectra CLI」的两级解析回退链
 *
 * F241 的三条集成用例（graph-refresh-executor.test.mjs / graph-consumption-cli.test.mjs Part 4）
 * 刻意不注入 fake，靠真实 spectra CLI 取证「刷新链证据不得 mock」。但它们把「真实 spectra」
 * 唯一收窄成「PATH 上的全局 `spectra` 命令」——这是宿主机属性，不是仓库不变量：GitHub Actions
 * runner 只跑 `npm ci`，从不 `npm link` 本仓 CLI，PATH 探针必 ENOENT，CI 因此自用例落地起恒红
 * （详见 specs/268-fix-ci-spectra-bin-fallback/fix-report.md 的 5-Why）。
 *
 * 本模块把「真实 spectra」的解析来源从「PATH 全局安装」扩展为「PATH 全局安装 ∨ 仓内构建产物
 * `dist/cli/index.js`」——后者同样是 `tsc` 编译出的本仓真实 CLI，CI 自己的「Build Knowledge
 * Graph」步骤（Test 步骤之前）就用它跑 `node dist/cli/index.js batch --mode graph-only` 建图。
 * CI（无全局安装）由此转绿，且测的是当前源码构建；开发机有全局安装时仍走第一级锚定全局版
 * （与改动前行为一致）。本解析链**不做**版本新鲜度与真伪鉴别——两级都只判「真实 spectra CLI
 * 能在有界时间内起来应答」，探针挡不住行为陈旧或被替换的产物（残余风险登记见
 * specs/268-fix-ci-spectra-bin-fallback/fix-report.md）。
 *
 * 两级解析链：
 *   1. PATH 探针 `spawnSync('spectra', ['--version'])` 成功 → 返回 `'spectra'`
 *      （一级判定条件与消费值不变；新增 30s 有界超时——`--version` 超过预算时与改动前行为分歧：
 *      旧=无界等待，新=判失败落二级）
 *   2. `<repoRoot>/dist/cli/index.js` 存在 → 生成一次性 `#!/bin/sh` wrapper 转发给
 *      `node <dist绝对路径> "$@"`，对 wrapper 复跑 `--version` 探针复验可起性（防 dist 缺模块/
 *      加载期崩溃的假可用；非真伪鉴别）通过后返回 wrapper 绝对路径
 *
 * 两级皆失败返回 `null`——不在此处抛错，也不在模块加载期做任何 spawn（只在被调用时才探测）：
 * 失败归属必须留在调用方各 `it()` 内部，让它们保持原有的响亮 `assert.fail` 语义，绝不 skip、
 * 绝不用假二进制冒充。
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// tests/lib → tests → spec-driver → plugins → repoRoot，共 4 级
const DEFAULT_REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');

const TMP_BASE = process.env.TEST_TMPDIR || os.tmpdir();

/**
 * 探针有界超时（ms）：防挂起二进制无界阻塞同步 spawn 死锁整个 node:test 进程。
 * 30s（非 10s）：本仓 tests/integration/cli-e2e.test.ts 的同型 `--version` 10s 探针已被实证
 * 满载可穿透（预存 flaky 账），10s 穿透在本解析链的后果是静默从一级切到二级（两级可能是不同
 * 版本的 CLI）；抬到 30s 与真实成本（实测 `--version` ~640ms）拉开量级。
 */
const PROBE_TIMEOUT_MS = 30_000;

/**
 * 按 repoRoot（绝对路径）分 key 的进程内 memoize，**只缓存成功结果**
 * （`'spectra'` 或 wrapper 绝对路径）。两级皆失败时不写缓存：
 *   a. 满载下 spawnSync 可能瞬时 EAGAIN，缓存 null 会把一次瞬时失败毒化成
 *      同文件全部集成用例红——改动前各 it() 独立探测无此耦合；
 *   b. 原实现无视 repoRoot 入参、首调用赢者通吃，参数语义是骗人的。
 * 失败不缓存：瞬时失败给后续用例重试机会。
 */
const cachedByRoot = new Map();

/** 生成 POSIX sh 单引号转义字面量：`'...'\''...'` 形态，防含 shell 元字符路径命令注入。 */
function shQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

/** 已生成的 wrapper 临时目录清单，供进程退出时逐个清理（best-effort）。 */
const wrapperDirs = [];

process.once('exit', () => {
  for (const dir of wrapperDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort：进程退出阶段，清理失败不影响测试结论
    }
  }
});

/**
 * 有界探针：验证进程能起且预算内正常应答 `--version`。
 * 超时时 `spawnSync` 置 `error=ETIMEDOUT` / `status=null`，与既有
 * `!result.error && result.status === 0` 判假条件天然兼容，无需额外分支。
 *
 * `killSignal: 'SIGKILL'`（非默认 SIGTERM）：默认信号可被子进程忽略——忽略 SIGTERM 的挂起
 * 二进制在 `timeout=10s` 下实测 60.4s 才返回（上界=子进程自灭时刻，实为无界），SIGKILL 下
 * 10.0s 精确闭合。同坑 canonical `graph-bootstrap-status.mjs` L506-508 已登记过并因此弃用
 * `spawnSync(timeout)`；探针场景无待刷盘状态，可直接 SIGKILL，不需要该模块的优雅终止路径。
 */
function probeVersion(bin) {
  const result = spawnSync(bin, ['--version'], {
    encoding: 'utf-8',
    timeout: PROBE_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  return !result.error && result.status === 0;
}

/**
 * 解析出一个可直接 spawn 的「真实 spectra CLI」路径；两级皆失败返回 `null`。
 *
 * 同一 repoRoot 在进程内只解析一次成功结果（后续调用直接命中 memoize），
 * 与 F241 设计的「每条集成用例都应观测同一次真实环境探测结果」一致；
 * 失败结果不缓存（见 cachedByRoot 注释）。
 *
 * @param {{ repoRoot?: string }} [options] repoRoot 仅影响第二级 dist 定位；第一级 PATH
 *   命中时解析结果与 repoRoot 无关。
 * @returns {string | null}
 */
export function resolveRealSpectraBin({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
  if (cachedByRoot.has(repoRoot)) return cachedByRoot.get(repoRoot);

  // 第一级：PATH 上的全局安装（开发机常态，今日逐字节行为）
  if (probeVersion('spectra')) {
    cachedByRoot.set(repoRoot, 'spectra');
    return 'spectra';
  }

  // 第二级：仓内构建产物（CI 的 Build 步骤 / 本地 `npm run build` 后必产出）
  const distEntry = path.join(repoRoot, 'dist', 'cli', 'index.js');
  if (fs.existsSync(distEntry)) {
    const wrapperDir = fs.mkdtempSync(path.join(TMP_BASE, 'real-spectra-bin-'));
    wrapperDirs.push(wrapperDir);
    const wrapperPath = path.join(wrapperDir, 'spectra');
    // 单引号转义 execPath/distEntry：双引号内 `$`/反引号/`$( )` 在 sh 中活性，
    // 含 shell 元字符的 checkout 路径会命令注入或静默破裂成错误归因。
    const script = `#!/bin/sh\nexec ${shQuote(process.execPath)} ${shQuote(distEntry)} "$@"\n`;
    fs.writeFileSync(wrapperPath, script, { mode: 0o755 });

    // 对 wrapper 复验可起性，防「dist 缺模块/加载期崩溃」被误判为真可用
    if (probeVersion(wrapperPath)) {
      cachedByRoot.set(repoRoot, wrapperPath);
      return wrapperPath;
    }
  }

  // 两级皆失败：不抛错、不缓存，交回调用方在各 it() 内响亮 assert.fail
  return null;
}
