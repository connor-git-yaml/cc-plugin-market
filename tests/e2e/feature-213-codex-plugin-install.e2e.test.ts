/**
 * Feature 213（A1）— 真实 Codex CLI 安装 E2E（FR-010(b) 可选层）
 *
 * 条件语义（WARNING #11）：模块加载期探测 `which codex`，无 binary 时整个 describe
 * 经 describe.skipIf 全部 skip（CI 友好，exit 0）；本机具备 codex binary 时必跑。
 *
 * 全局状态安全（CRITICAL 修订）：marketplace 源用 mkdtemp fixture 副本（非真实 worktree），
 * marketplace name 改写为测试专属随机名；try/finally 逆序完整清理（plugin remove ×2 →
 * marketplace remove → rm 临时目录），单步失败不阻断后续清理，末尾对清理结果汇总断言。
 */
import { afterAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';

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

describe.skipIf(!hasCodex)('feature-213 codex plugin install e2e', () => {
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
  const market = `cc-plugin-market-e2e-${suffix}`;
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'codex-e2e-'));
  const cleanupResults: CleanupStep[] = [];
  let cleanedUp = false;

  function codex(args: string[]) {
    return spawnSync('codex', args, { encoding: 'utf-8' });
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
    for (const [label, args] of codexSteps) {
      try {
        const r = codex(args);
        cleanupResults.push({ label, status: r.status, stderr: (r.stderr ?? '').trim() });
      } catch (error) {
        cleanupResults.push({ label, status: null, stderr: error instanceof Error ? error.message : String(error) });
      }
    }
    // 实测行为：`codex plugin marketplace remove <name>` **不清除**
    // ~/.codex/plugins/cache/<name>/ 缓存目录（会残留 <name>/<plugin>/<version> 空壳），
    // 必须显式 rm 兜底，否则每跑一次 e2e 泄漏一个 cc-plugin-market-e2e-* 缓存目录。
    // 顺序上先清缓存目录（属被安装制品）再删 fixture 源目录。
    const rmSteps: Array<[string, string]> = [
      ['rm plugins/cache/<market>', join(homedir(), '.codex', 'plugins', 'cache', market)],
      ['rm fixtureRoot', fixtureRoot],
    ];
    for (const [label, target] of rmSteps) {
      try {
        rmSync(target, { recursive: true, force: true });
        cleanupResults.push({ label, status: 0, stderr: '' });
      } catch (error) {
        cleanupResults.push({ label, status: null, stderr: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  // afterAll 无条件执行：先兜底 cleanup（若 test 提前抛出未走到 finally 也能收口），
  // 再做清理链汇总断言——即便主测试断言失败、异常已抛出，此处仍会跑，使清理失败不被遮蔽。
  afterAll(() => {
    cleanup();
    expect(cleanupResults.length, `清理步数异常: ${JSON.stringify(cleanupResults)}`).toBe(5);
    expect(cleanupResults.every((r) => r.status === 0), `清理链有失败步: ${JSON.stringify(cleanupResults)}`).toBe(true);
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
    } finally {
      // 即时兜底清理；清理链汇总断言在 afterAll 内独立执行（此处不 assert，避免遮蔽 + 顺序错）
      cleanup();
    }
  });
});
