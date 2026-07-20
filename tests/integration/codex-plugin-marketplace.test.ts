import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

// Feature 213（T018）— Codex marketplace catalog 结构性验证 + fresh-clone 物化验证
// marketplace.json 内容由 T002 落地并已 commit 至本 feature 分支；本测试为纯验证。

const REPO_ROOT = resolve('.');
const MARKETPLACE_PATH = join(REPO_ROOT, '.agents/plugins/marketplace.json');

interface MarketplacePlugin {
  name: string;
  source: { source: string; path: string };
  policy: { installation: string; authentication: string };
  category: string;
}
interface Marketplace {
  name: string;
  interface: { displayName: string };
  plugins: MarketplacePlugin[];
}

function loadMarketplace(): Marketplace {
  return JSON.parse(readFileSync(MARKETPLACE_PATH, 'utf-8')) as Marketplace;
}

// 收集期（collection-time）判定，用于 describe.skipIf——避免运行期 early-return 造成"假 passed"。
// 当前 HEAD commit SHA：fresh-clone 后按 SHA checkout（detached HEAD 安全，
// 不依赖 branch 名在全新 clone 中存在，兼容 CI detached-HEAD 环境）。
const HEAD_SHA: string = (() => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf-8' }).trim();
  } catch {
    return '';
  }
})();
// marketplace.json 是否已 commit 进 HEAD tree（T002 已落地即为 true）
const MARKETPLACE_TRACKED_IN_HEAD: boolean = (() => {
  try {
    execFileSync('git', ['cat-file', '-e', 'HEAD:.agents/plugins/marketplace.json'], { cwd: REPO_ROOT, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
})();

describe('codex marketplace catalog', () => {
  it('顶层 schema：name / interface.displayName 齐全且类型正确', () => {
    const m = loadMarketplace();
    expect(typeof m.name).toBe('string');
    expect(m.name.length).toBeGreaterThan(0);
    expect(typeof m.interface?.displayName).toBe('string');
    expect(m.interface.displayName.length).toBeGreaterThan(0);
  });

  it('plugins 恰含 spectra / spec-driver 两条，每条 source/policy/category 字段完整且类型正确', () => {
    const m = loadMarketplace();
    expect(Array.isArray(m.plugins)).toBe(true);
    expect(m.plugins).toHaveLength(2);

    const byName = new Map(m.plugins.map((p) => [p.name, p]));
    for (const name of ['spectra', 'spec-driver']) {
      const p = byName.get(name);
      expect(p, `缺 marketplace 条目 ${name}`).toBeDefined();
      expect(typeof p!.source.path).toBe('string');
      expect(p!.source.source).toBe('local');
      expect(p!.policy.installation).toBe('AVAILABLE');
      expect(p!.policy.authentication).toBe('ON_INSTALL');
      expect(typeof p!.category).toBe('string');
      expect(p!.category.length).toBeGreaterThan(0);
    }
  });

  it('每条 source.path 解析后目录存在且含 .codex-plugin/plugin.json', () => {
    const m = loadMarketplace();
    for (const p of m.plugins) {
      const pluginDir = resolve(REPO_ROOT, p.source.path.replace(/^\.\/+/, ''));
      expect(existsSync(pluginDir), `${p.name} 目录不存在`).toBe(true);
      const manifest = join(pluginDir, '.codex-plugin', 'plugin.json');
      expect(existsSync(manifest), `${p.name} 缺 .codex-plugin/plugin.json`).toBe(true);
    }
  });

  // 前置未满足（marketplace.json 未 commit 进 HEAD）→ 收集期 skip，不进入运行期 early-return 假 passed
  describe.skipIf(!MARKETPLACE_TRACKED_IN_HEAD)('fresh-clone 物化验证（SC-006）', () => {
    let tmpdirPath: string | undefined;

    afterEach(() => {
      if (tmpdirPath) {
        rmSync(tmpdirPath, { recursive: true, force: true });
        tmpdirPath = undefined;
      }
    });

    it('tracked marketplace.json 随 clone 物化，未 track 的 .agents/skills 不物化', () => {
      tmpdirPath = mkdtempSync(join(tmpdir(), 'codex-marketplace-clone-'));
      const clonePath = join(tmpdirPath, 'clone');
      // 本地 clone（含全部对象），再按 commit SHA checkout——不用 --branch <名>，
      // 兼容 CI detached-HEAD（branch 名可能不存在于全新 clone）。
      execFileSync('git', ['clone', REPO_ROOT, clonePath], { stdio: 'pipe' });
      execFileSync('git', ['checkout', HEAD_SHA], { cwd: clonePath, stdio: 'pipe' });

      // tracked 文件随 clone 物化
      expect(existsSync(join(clonePath, '.agents/plugins/marketplace.json'))).toBe(true);
      // 未 track 的 worktree-local symlink 目标不物化（全新 clone 无 worktree symlink 机制）
      expect(existsSync(join(clonePath, '.agents/skills'))).toBe(false);
      // 两份 codex manifest 也随 clone 物化
      expect(existsSync(join(clonePath, 'plugins/spectra/.codex-plugin/plugin.json'))).toBe(true);
      expect(existsSync(join(clonePath, 'plugins/spec-driver/.codex-plugin/plugin.json'))).toBe(true);
    });
  });
});
