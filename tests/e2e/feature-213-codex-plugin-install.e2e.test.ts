/**
 * Feature 213（A1）— 真实 Codex CLI 安装 E2E（FR-010(b) 可选层）
 *
 * 条件语义（WARNING #11）：模块加载期探测 `which codex`，无 binary 时整个 describe
 * 经 describe.skipIf 全部 skip（CI 友好，exit 0）；本机具备 codex binary 时必跑。
 *
 * 全局状态安全（CRITICAL 修订）：marketplace 源用 mkdtemp fixture 副本（非真实 worktree），
 * marketplace name 改写为测试专属随机名；try/finally 逆序完整清理（plugin remove ×2 →
 * marketplace remove → rm 临时目录），单步失败不阻断后续清理，末尾对清理结果汇总断言。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 Feature 240 / Codex 对抗审查 W4：CODEX_HOME 隔离
 *
 * 原缺陷：子进程**继承外部 CODEX_HOME**（真实 codex 会据此操作自定义目录），
 * 而清理却**固定删除** `homedir()/.codex/plugins/cache/...`。于是在设了 CODEX_HOME
 * 的机器上，测试操作 A 目录、清理 B 目录：自定义目录 cache 残留，
 * 且 `rmSync(..., { force: true })` 对不存在的 B 目录**照样返回成功** ——
 * 清理链汇总断言全绿，实为**假绿**。
 *
 * 修法（"加不改"）：
 *   1. 子进程环境**显式**决定 CODEX_HOME，不再继承宿主机取值；
 *   2. 清理路径由**同一个生效 home** 派生，而非硬编码 homedir()；
 *   3. 覆盖两种情形——unset/default（保持原有默认路径断言逐字不变）与 custom（新增）。
 * ─────────────────────────────────────────────────────────────────────────────
 * 🔴 F281：真实家目录隔离 + cwd 独立
 *
 * 原缺陷（两条，同一根因：子进程继承了宿主机的 HOME 与 cwd）：
 *   a. unset 场景的"默认 ~/.codex"就是**用户真实的** Codex 家目录——每跑一次 e2e 就在真家目录里
 *      装两个插件再卸掉，测试变成了对用户状态的读写；
 *   b. `codex` 以仓根为 cwd 启动，而仓根可能有机器专属、未跟踪的项目级 `.codex/config.toml`
 *      （本机实况：`[mcp_servers.spectra] command = "node"` 覆盖了插件注册的 `command = "spectra"`），
 *      且 Codex 只对真家目录 config 里登记为 trusted 的项目加载项目级配置——于是同一条测试
 *      在主 checkout 必红、在 worktree 必绿，红绿取决于"在哪个目录跑"而不是被测代码。
 * 修法：两个场景都给子进程一个**临时 HOME**（默认场景的 `~/.codex` 因而落到 `<tmpHome>/.codex`，
 * 默认路径派生语义不变；trusted 登记为空，项目级配置天然不生效），并以 fixtureRoot 为 cwd；
 * 临时 HOME 随清理链回收；`rm plugins/cache/<market>` 是否删对目录的守卫改在删家目录**之前**取证
 * （否则整个家目录删掉后"cache 不存在"恒真，守卫空转）。
 * 临时目录一律在 `beforeAll` 里创建：`describe.skipIf` 跳过时 describe 体仍被求值、afterAll 不跑，
 * 若在收集期 mkdtemp，无 codex 的机器每跑一次全量就泄漏 5 个空目录（对抗复审 W-1 实测）。
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = resolve('.');

function hasCodexBinary(): boolean {
  try {
    execFileSync('which', ['codex'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const hasCodex = hasCodexBinary();

interface CleanupStep {
  label: string;
  status: number | null;
  stderr: string;
}

/**
 * 一个 CODEX_HOME 情形的 E2E 套件。
 *
 * @param label          场景名（用于 describe 标题）
 * @param makeCodexHome  返回该场景下要注入的 CODEX_HOME；`undefined` 表示显式 **unset**
 *                       （此时 codex 走默认 `~/.codex`，即原用例的语义）
 */
function defineScenario(label: string, makeCodexHome: () => string | undefined) {
  describe(`feature-213 codex plugin install e2e（${label}）`, () => {
    const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
    const market = `cc-plugin-market-e2e-${suffix}`;
    let fixtureRoot = '';
    // 🔴 F281：子进程的 HOME 是本场景专属的临时目录，真实家目录（含用户的 ~/.codex 与 trusted 登记）
    // 对 codex 不可见；默认场景的 `~/.codex` 因而落到 <isolatedHome>/.codex。
    let isolatedHome = '';
    // 🔴 W4 核心：生效的 Codex 家目录在此**唯一确定**，
    // 子进程环境与清理路径都从它派生 —— 二者不可能再指向不同目录。
    let injectedCodexHome: string | undefined;
    let effectiveCodexHome = '';
    let marketCachePath = '';

    // 临时目录只在套件真正执行时创建（skip 态零落盘，见头注释）
    beforeAll(() => {
      fixtureRoot = mkdtempSync(join(tmpdir(), 'codex-e2e-'));
      isolatedHome = mkdtempSync(join(tmpdir(), 'codex-e2e-home-'));
      injectedCodexHome = makeCodexHome();
      effectiveCodexHome = injectedCodexHome ?? join(isolatedHome, '.codex');
      marketCachePath = join(effectiveCodexHome, 'plugins', 'cache', market);
    });

    const cleanupResults: CleanupStep[] = [];
    let cleanedUp = false;
    /** `rm plugins/cache/<market>` 之后、删家目录之前取证：cache 是否真的没了（W4 守卫的取证点） */
    let cacheResidueAfterRm: boolean | null = null;

    /** 子进程环境：HOME 隔离到临时目录；CODEX_HOME 由场景**显式**决定，绝不继承宿主机取值 */
    function childEnv(): NodeJS.ProcessEnv {
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: isolatedHome };
      if (injectedCodexHome === undefined) {
        delete env['CODEX_HOME'];
      } else {
        env['CODEX_HOME'] = injectedCodexHome;
      }
      return env;
    }

    /**
     * cwd 固定为 fixture 目录：仓根的项目级 `.codex/config.toml`（机器专属、未跟踪）不得参与。
     * 这是双保险——HOME 隔离后 trusted 登记为空、项目级配置本就不加载（对抗复审 I-2 实测），
     * 但 cwd 独立让断言不依赖 Codex 的 trust 语义细节。timeout：同步 spawn 挂起时 vitest 的
     * testTimeout 打不断它，30s 硬上界让单步失败 loud 而非整场卡死。
     */
    function codex(args: string[]) {
      return spawnSync('codex', args, { encoding: 'utf-8', env: childEnv(), cwd: fixtureRoot, timeout: 30_000 });
    }

    // cleanedUp flag 只用于**跳过重复的 codex 卸载命令与 rm**（test finally + afterAll 两处都会调用），
    // 不用于跳过汇总断言——汇总断言在 afterAll 内独立、无条件执行（见下），保证清理失败可见。
    function cleanup() {
      if (cleanedUp) {
        return;
      }
      cleanedUp = true;
      // 逆序：先卸 plugin，再移除 marketplace，然后清缓存目录，最后删临时源目录；每步独立 try，失败不阻断后续
      const codexSteps: Array<[string, string[]]> = [
        [`remove spectra@${market}`, ['plugin', 'remove', `spectra@${market}`]],
        [`remove spec-driver@${market}`, ['plugin', 'remove', `spec-driver@${market}`]],
        [`marketplace remove ${market}`, ['plugin', 'marketplace', 'remove', market]],
      ];
      for (const [label2, args] of codexSteps) {
        try {
          const r = codex(args);
          cleanupResults.push({ label: label2, status: r.status, stderr: (r.stderr ?? '').trim() });
        } catch (error) {
          cleanupResults.push({ label: label2, status: null, stderr: error instanceof Error ? error.message : String(error) });
        }
      }
      // 实测行为：`codex plugin marketplace remove <name>` **不清除**
      // <CODEX_HOME>/plugins/cache/<name>/ 缓存目录（会残留 <name>/<plugin>/<version> 空壳），
      // 必须显式 rm 兜底，否则每跑一次 e2e 泄漏一个 cc-plugin-market-e2e-* 缓存目录。
      // 🔴 W4：路径基于 effectiveCodexHome，**不再**硬编码 homedir()。
      // 🔴 F281：cache 目录单独先删并立即取证（家目录整体删除之前），随后回收 fixture / 临时 CODEX_HOME / 临时 HOME。
      const rmSteps: Array<[string, string]> = [
        ['rm plugins/cache/<market>', marketCachePath],
        ['rm fixtureRoot', fixtureRoot],
        // 自定义场景下这个临时 CODEX_HOME 整体是本测试造的，必须一并回收；
        // default 场景下 injectedCodexHome 为 undefined，此步不存在（步数因此按场景计算）。
        ...(injectedCodexHome !== undefined
          ? ([['rm 临时 CODEX_HOME', injectedCodexHome]] as Array<[string, string]>)
          : []),
        ['rm 临时 HOME', isolatedHome],
      ];
      for (const [label2, target] of rmSteps) {
        try {
          rmSync(target, { recursive: true, force: true });
          cleanupResults.push({ label: label2, status: 0, stderr: '' });
        } catch (error) {
          cleanupResults.push({ label: label2, status: null, stderr: error instanceof Error ? error.message : String(error) });
        }
        if (target === marketCachePath) {
          cacheResidueAfterRm = existsSync(marketCachePath);
        }
      }
    }

    // afterAll 无条件执行：先兜底 cleanup（若 test 提前抛出未走到 finally 也能收口），
    // 再做清理链汇总断言——即便主测试断言失败、异常已抛出，此处仍会跑，使清理失败不被遮蔽。
    afterAll(() => {
      cleanup();
      // 3 步 codex 卸载 + 3 步 rm（default：cache / fixtureRoot / 临时 HOME）/ 4 步 rm（custom，多一个临时 CODEX_HOME）
      const expectedSteps = injectedCodexHome === undefined ? 6 : 7;
      expect(cleanupResults.length, `清理步数异常: ${JSON.stringify(cleanupResults)}`).toBe(
        expectedSteps,
      );
      expect(cleanupResults.every((r) => r.status === 0), `清理链有失败步: ${JSON.stringify(cleanupResults)}`).toBe(true);

      // 🔴 W4 反向守卫（F281 对抗复审 W-2 校正措辞）：本守卫保证的是「rm 步骤确实作用于 marketCachePath
      // 且删净」——`rmSync(force:true)` 对不存在的路径同样返回成功，故取证点必须在 cleanup 内、删整个
      // 临时家目录**之前**（否则恒真、守卫空转）。「操作 A 目录、清理 B 目录」的 A/B 分歧由安装期的正向检查
      // （下方 it 内「安装产物确实落在本场景生效的 CODEX_HOME 下」）承担，两道守卫缺一不可。
      expect(cacheResidueAfterRm, 'cache rm 步骤未执行，无法取证').not.toBeNull();
      expect(
        cacheResidueAfterRm,
        `cache 残留在 ${effectiveCodexHome}，说明清理路径与生效 CODEX_HOME 不一致`,
      ).toBe(false);
    });

    it('marketplace add → plugin add ×2 → list installed → mcp spectra 注册 → 完整清理', () => {
      try {
        // 1. fixture 副本（正式版本 manifest——依赖 T011 已 sync）
        cpSync(join(REPO_ROOT, 'plugins/spectra'), join(fixtureRoot, 'plugins/spectra'), { recursive: true });
        cpSync(join(REPO_ROOT, 'plugins/spec-driver'), join(fixtureRoot, 'plugins/spec-driver'), { recursive: true });
        const marketplaceSrc = JSON.parse(readFileSync(join(REPO_ROOT, '.agents/plugins/marketplace.json'), 'utf-8')) as { name: string };
        marketplaceSrc.name = market;
        const marketplaceDst = join(fixtureRoot, '.agents/plugins/marketplace.json');
        cpSync(join(REPO_ROOT, '.agents/plugins'), join(fixtureRoot, '.agents/plugins'), { recursive: true });
        writeFileSync(marketplaceDst, `${JSON.stringify(marketplaceSrc, null, 2)}\n`, 'utf-8');

        // 2. marketplace add（源指向 fixture 副本）
        const add = codex(['plugin', 'marketplace', 'add', fixtureRoot]);
        expect(add.status, `marketplace add 失败: ${add.stderr}`).toBe(0);

        // 3. plugin add ×2
        const addSpectra = codex(['plugin', 'add', `spectra@${market}`]);
        expect(addSpectra.status, `plugin add spectra 失败: ${addSpectra.stderr}`).toBe(0);
        const addSpecDriver = codex(['plugin', 'add', `spec-driver@${market}`]);
        expect(addSpecDriver.status, `plugin add spec-driver 失败: ${addSpecDriver.stderr}`).toBe(0);

        // 4. plugin list --json → 两 plugin installed
        const list = codex(['plugin', 'list', '--json']);
        expect(list.status).toBe(0);
        const listPayload = JSON.parse(list.stdout) as { installed: Array<{ name: string; marketplaceName: string; installed: boolean }> };
        const ours = listPayload.installed.filter((p) => p.marketplaceName === market);
        const names = ours.map((p) => p.name).sort();
        expect(names).toEqual(['spec-driver', 'spectra']);
        expect(ours.every((p) => p.installed === true)).toBe(true);

        // 5. mcp list --json → spectra server 已注册（stdio command=spectra）
        const mcp = codex(['mcp', 'list', '--json']);
        expect(mcp.status).toBe(0);
        const mcpPayload = JSON.parse(mcp.stdout) as Record<string, { name: string; transport?: { command?: string } }>;
        const spectraServer = Object.values(mcpPayload).find((s) => s.name === 'spectra');
        expect(spectraServer, 'spectra MCP server 未注册').toBeDefined();
        expect(spectraServer!.transport?.command).toBe('spectra');

        // 🔴 W4 新增：安装产物确实落在**本场景生效的** CODEX_HOME 下，
        // 而不是宿主机环境变量恰好指向的另一个目录。
        // 🔴 F281：默认场景下这也证明 codex 走的是临时 HOME 派生的 ~/.codex，而非用户真实家目录。
        expect(
          existsSync(marketCachePath),
          `未在 ${effectiveCodexHome} 下找到 marketplace cache，子进程实际用的可能是别的 CODEX_HOME`,
        ).toBe(true);
      } finally {
        // 即时兜底清理；清理链汇总断言在 afterAll 内独立执行（此处不 assert，避免遮蔽 + 顺序错）
        cleanup();
      }
    });
  });
}

describe.skipIf(!hasCodex)('feature-213 codex plugin install e2e', () => {
  // 情形 1：显式 unset CODEX_HOME → codex 走默认 ~/.codex（原用例语义，断言逐字保留；
  // F281 起 ~ 是隔离的临时 HOME，不再是用户真实家目录）
  defineScenario('CODEX_HOME unset → 默认 ~/.codex（HOME 隔离）', () => undefined);

  // 情形 2（W4 新增）：自定义 CODEX_HOME → 安装与清理都必须跟随到该目录
  defineScenario('自定义 CODEX_HOME', () => mkdtempSync(join(tmpdir(), 'codex-home-e2e-')));
});
