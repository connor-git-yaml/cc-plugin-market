/**
 * F274 — global-setup 跨 worktree 假新鲜盲区回归测试。
 *
 * 详见 specs/274-fix-global-setup-cross-worktree-freshness/fix-report.md：
 * sidecar 落在 `node_modules/.cache/`，而本仓库多 worktree 惯例是 `node_modules`
 * 软链到主仓（sidecar 物理共享）、`dist/` 却 per-worktree 独立，导致 worktree A
 * 的构建见证被 worktree B 误采信、B 的陈旧 dist 被判新鲜。
 *
 * 本文件全程只操作 `mkdtempSync` 创建的临时目录，通过参数化函数的显式路径覆盖
 * 完全隔离，不触碰本 worktree 真实的 `dist/` 与 `node_modules/.cache/`。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeDistFingerprint,
  readSidecar,
  writeSidecar,
  isDistFresh,
  deriveSidecarPath,
  TEST_INPUTS_SIDECAR,
} from '../global-setup';

describe('global-setup 跨 worktree 假新鲜盲区回归测试（F274）', () => {
  let tmpRoot: string;
  let distDir: string;
  let distCli: string;
  let buildMeta: string;
  let sidecarPath: string;

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'spectra-f274-'));
    distDir = join(tmpRoot, 'dist');
    mkdirSync(join(distDir, 'cli'), { recursive: true });
    distCli = join(distDir, 'cli', 'index.js');
    buildMeta = join(distDir, '.spectra-build-meta.json');
    writeFileSync(distCli, 'console.log(1);\n');
    writeFileSync(buildMeta, '{}');
    sidecarPath = join(tmpRoot, 'sidecar.json');
  });

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('复现 bug：inputsSha256 匹配但 dist 实际内容与 sidecar 绑定不同时判不新鲜', () => {
    const inputsFingerprint = 'fake-inputs-hash-shared-across-worktrees';
    const distHashAtWorktreeA = computeDistFingerprint(distDir);
    expect(distHashAtWorktreeA).not.toBeNull();
    writeSidecar(inputsFingerprint, distHashAtWorktreeA as string, sidecarPath);

    // 模拟 worktree B：checkout 到同一 commit（同 inputsFingerprint），
    // 但本地 dist 是另一次构建（内容不同）的陈旧产物。
    writeFileSync(distCli, 'console.log(2); // stale build from an older commit\n');

    const fresh = isDistFresh(inputsFingerprint, { distCli, buildMeta, sidecarPath, distDir });
    expect(fresh).toBe(false); // 修复前的旧逻辑只比对 inputsSha256，会误判 true
  });

  it('同 worktree 内 dist 与 sidecar 绑定一致时判新鲜（正常路径不受影响）', () => {
    const inputsFingerprint = 'fake-inputs-hash';
    const distHash = computeDistFingerprint(distDir);
    expect(distHash).not.toBeNull();
    writeSidecar(inputsFingerprint, distHash as string, sidecarPath);
    expect(isDistFresh(inputsFingerprint, { distCli, buildMeta, sidecarPath, distDir })).toBe(true);
  });

  it('旧 schemaVersion 1 sidecar（无 distSha256）一律判不新鲜，强制重建', () => {
    writeFileSync(sidecarPath, JSON.stringify({ schemaVersion: 1, inputsSha256: 'x' }));
    expect(readSidecar(sidecarPath)).toBeNull();
    expect(isDistFresh('x', { distCli, buildMeta, sidecarPath, distDir })).toBe(false);
  });

  it('deriveSidecarPath 按 PROJECT_ROOT 分键，不同 worktree 产生不同文件名', () => {
    const pathA = deriveSidecarPath('/Users/x/worktree-a');
    const pathB = deriveSidecarPath('/Users/x/worktree-b');
    expect(pathA).not.toBe(pathB);
  });

  it('dist 目录为空/不存在时 computeDistFingerprint 仍返回确定性结果，不抛异常', () => {
    rmSync(distDir, { recursive: true, force: true });
    expect(() => computeDistFingerprint(distDir)).not.toThrow();
  });
});

/**
 * 生产接线守护（对抗审查 R2）：上面那组用例全部通过显式 `sidecarPath` 参数验证纯函数
 * 行为，因此把 `TEST_INPUTS_SIDECAR = deriveSidecarPath(PROJECT_ROOT)` 这行回退成
 * F274 之前的固定共享名，它们依然 5/5 全绿——真正承重的那行接线处于无守护状态。
 * 本组用例直接钉住该常量：一旦生产默认路径不再按 PROJECT_ROOT 分键，必须转红。
 *
 * repoRoot 由本测试文件自身的 `import.meta.url` 独立推导（tests/integration/ 上两级），
 * 与 global-setup 内 PROJECT_ROOT 的推导方式同构但不共享实现——避免"两边同时错"时
 * 断言依然自洽。
 */
describe('生产 sidecar 默认路径接线（F274 R2）', () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

  it('TEST_INPUTS_SIDECAR 必须等于 deriveSidecarPath(repoRoot)（按 worktree 分键，非固定共享名）', () => {
    expect(TEST_INPUTS_SIDECAR).toBe(deriveSidecarPath(repoRoot));
  });

  it('默认 sidecar 落在 node_modules/.cache/spectra 下且文件名带 12 位 root 分键', () => {
    // 绝不能是 F274 之前的固定共享名 test-build-inputs.json。
    expect(basename(TEST_INPUTS_SIDECAR)).toMatch(/^test-build-inputs-[0-9a-f]{12}\.json$/);
    expect(dirname(TEST_INPUTS_SIDECAR).endsWith(join('node_modules', '.cache', 'spectra'))).toBe(true);
  });
});
