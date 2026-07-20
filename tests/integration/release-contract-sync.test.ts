import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
// 动态从 release-contract.yaml 读期望版本，避免 release 升版后测试再次 stale
import { loadReleaseContract } from '../../scripts/lib/release-contract-core.mjs';

const REPO_ROOT = resolve('.');
const { contract: RELEASE_CONTRACT } = loadReleaseContract(REPO_ROOT);
const SPEC_DRIVER_VERSION: string = RELEASE_CONTRACT.products['spec-driver'].version;
const SPECTRA_VERSION: string = RELEASE_CONTRACT.products['spectra'].version;

function runNode(scriptPath: string, projectRoot: string) {
  try {
    const stdout = execFileSync('node', [scriptPath, '--project-root', projectRoot, '--json'], {
      cwd: projectRoot,
      encoding: 'utf-8',
      timeout: 20_000,
    });
    return { exitCode: 0, stdout };
  } catch (error) {
    const execError = error as { stdout?: string; stderr?: string; status?: number };
    return {
      exitCode: execError.status ?? 1,
      stdout: `${execError.stdout ?? ''}${execError.stderr ?? ''}`,
    };
  }
}

function copyFile(projectRoot: string, relativePath: string) {
  const targetPath = join(projectRoot, relativePath);
  mkdirSync(join(targetPath, '..'), { recursive: true });
  cpSync(join(REPO_ROOT, relativePath), targetPath);
}

function copyTree(projectRoot: string, relativePath: string) {
  const targetPath = join(projectRoot, relativePath);
  mkdirSync(join(targetPath, '..'), { recursive: true });
  cpSync(join(REPO_ROOT, relativePath), targetPath, { recursive: true });
}

describe('release contract sync', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'release-contract-'));

    copyTree(projectRoot, 'contracts');
    copyTree(projectRoot, 'scripts/lib');
    copyTree(projectRoot, 'plugins/spec-driver/scripts/lib');
    copyFile(projectRoot, 'scripts/sync-release-contracts.mjs');
    copyFile(projectRoot, 'scripts/validate-release-contracts.mjs');
    copyFile(projectRoot, 'README.md');
    copyFile(projectRoot, 'package.json');
    copyFile(projectRoot, 'package-lock.json');
    copyFile(projectRoot, '.claude-plugin/marketplace.json');
    copyFile(projectRoot, 'plugins/spectra/.claude-plugin/plugin.json');
    copyFile(projectRoot, 'plugins/spectra/.codex-plugin/plugin.json');
    copyFile(projectRoot, 'plugins/spectra/README.md');
    copyFile(projectRoot, 'plugins/spec-driver/.claude-plugin/plugin.json');
    copyFile(projectRoot, 'plugins/spec-driver/.codex-plugin/plugin.json');
    copyFile(projectRoot, 'plugins/spec-driver/README.md');
    copyFile(projectRoot, 'plugins/spec-driver/scripts/postinstall.sh');
    copyFile(projectRoot, 'specs/products/product-mapping.yaml');
    copyFile(projectRoot, 'specs/products/spectra/current-spec.md');
    copyFile(projectRoot, 'specs/products/spec-driver/current-spec.md');

    // Feature 213（T017）：validate-release-contracts.mjs 薄壳直调 codex-plugin-consistency 矩阵，
    // 该矩阵需读多份分发制品；隔离 fixture 若不补齐这些文件，矩阵会因文件缺失报 error，
    // 使既有 status==='pass' 断言假失败（plan §3.3 关联测试 fixture 缺口）。
    copyFile(projectRoot, 'plugins/spectra/.mcp.json');
    copyTree(projectRoot, 'plugins/spectra/skills');
    copyTree(projectRoot, 'plugins/spectra/contracts');
    copyTree(projectRoot, 'plugins/spec-driver/skills');
    copyTree(projectRoot, 'plugins/spec-driver/skills-codex');
    copyTree(projectRoot, 'plugins/spec-driver/contracts');
    copyFile(projectRoot, '.agents/plugins/marketplace.json');
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('sync 会把 release 相关版本与文案拉回合同值', () => {
    writeFileSync(
      join(projectRoot, 'plugins', 'spec-driver', '.claude-plugin', 'plugin.json'),
      JSON.stringify({
        name: 'spec-driver',
        version: '0.0.1',
        description: 'stale',
      }, null, 2),
      'utf-8',
    );

    const sync = runNode(join(projectRoot, 'scripts', 'sync-release-contracts.mjs'), projectRoot);
    expect(sync.exitCode).toBe(0);

    const validate = runNode(join(projectRoot, 'scripts', 'validate-release-contracts.mjs'), projectRoot);
    expect(validate.exitCode).toBe(0);

    const payload = JSON.parse(validate.stdout) as {
      status: string;
      errors: string[];
    };
    expect(payload.status).toBe('pass');
    expect(payload.errors).toEqual([]);

    expect(readFileSync(join(projectRoot, 'package.json'), 'utf-8'))
      .toContain(`"version": "${SPECTRA_VERSION}"`);
    expect(readFileSync(join(projectRoot, 'plugins', 'spec-driver', '.claude-plugin', 'plugin.json'), 'utf-8'))
      .toContain(`"version": "${SPEC_DRIVER_VERSION}"`);
    expect(readFileSync(join(projectRoot, 'plugins', 'spec-driver', 'README.md'), 'utf-8'))
      .toContain(`> 当前发布版本: v${SPEC_DRIVER_VERSION}`);
    expect(readFileSync(join(projectRoot, 'specs', 'products', 'spec-driver', 'current-spec.md'), 'utf-8'))
      .toContain(`> **发布版本**: v${SPEC_DRIVER_VERSION}`);
  });

  it('validator 会显式报告 release drift', () => {
    const packageJsonPath = join(projectRoot, 'package.json');
    writeFileSync(
      packageJsonPath,
      readFileSync(packageJsonPath, 'utf-8').replace(
        /"version": "[^"]+"/,
        '"version": "0.9.0"',
      ),
      'utf-8',
    );

    const validate = runNode(join(projectRoot, 'scripts', 'validate-release-contracts.mjs'), projectRoot);
    expect(validate.exitCode).toBe(1);

    const payload = JSON.parse(validate.stdout) as {
      status: string;
      errors: string[];
    };
    expect(payload.status).toBe('fail');
    expect(payload.errors.join('\n')).toContain('spectra package version');
  });

  describe('codexPluginManifestPath 同步与漂移', () => {
    const SPECTRA_DESCRIPTION: string = RELEASE_CONTRACT.products['spectra'].pluginDescription;
    const SPEC_DRIVER_DESCRIPTION: string = RELEASE_CONTRACT.products['spec-driver'].pluginDescription;
    const SPECTRA_CODEX_REL = ['plugins', 'spectra', '.codex-plugin', 'plugin.json'];
    const SPEC_DRIVER_CODEX_REL = ['plugins', 'spec-driver', '.codex-plugin', 'plugin.json'];

    it('sync 会把两份 codex manifest 的 version+description 4 字段全部拉回合同值', () => {
      // 同时破坏两份 manifest 的 version 与 description（共 4 个受控字段），
      // 确保测试真正覆盖两份 manifest——若 sync 遗漏任一份或任一字段，断言即失败
      const spectraCodexPath = join(projectRoot, ...SPECTRA_CODEX_REL);
      const specDriverCodexPath = join(projectRoot, ...SPEC_DRIVER_CODEX_REL);
      writeFileSync(
        spectraCodexPath,
        JSON.stringify({
          name: 'spectra',
          version: '0.0.1',
          description: 'stale-spectra-codex',
          skills: './skills/',
          mcpServers: './.mcp.json',
        }, null, 2),
        'utf-8',
      );
      writeFileSync(
        specDriverCodexPath,
        JSON.stringify({
          name: 'spec-driver',
          version: '0.0.2',
          description: 'stale-spec-driver-codex',
          skills: './skills-codex/',
        }, null, 2),
        'utf-8',
      );

      const sync = runNode(
        join(projectRoot, 'scripts', 'sync-release-contracts.mjs'), projectRoot,
      );
      expect(sync.exitCode).toBe(0);

      const spectraSynced = JSON.parse(readFileSync(spectraCodexPath, 'utf-8')) as {
        version: string;
        description: string;
      };
      expect(spectraSynced.version).toBe(SPECTRA_VERSION);
      expect(spectraSynced.description).toBe(SPECTRA_DESCRIPTION);

      const specDriverSynced = JSON.parse(readFileSync(specDriverCodexPath, 'utf-8')) as {
        version: string;
        description: string;
      };
      expect(specDriverSynced.version).toBe(SPEC_DRIVER_VERSION);
      expect(specDriverSynced.description).toBe(SPEC_DRIVER_DESCRIPTION);
    });

    it('validate 会检出 codex manifest 版本漂移（codex-plugin-version check fail）', () => {
      // 先 sync 到一致，再手工制造 version 漂移
      const preSync = runNode(
        join(projectRoot, 'scripts', 'sync-release-contracts.mjs'), projectRoot,
      );
      expect(preSync.exitCode).toBe(0);

      const spectraCodexPath = join(projectRoot, ...SPECTRA_CODEX_REL);
      const manifest = JSON.parse(readFileSync(spectraCodexPath, 'utf-8')) as {
        version: string;
      };
      manifest.version = '0.9.0';
      writeFileSync(spectraCodexPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

      const validate = runNode(
        join(projectRoot, 'scripts', 'validate-release-contracts.mjs'), projectRoot,
      );
      expect(validate.exitCode).toBe(1);

      const payload = JSON.parse(validate.stdout) as {
        status: string;
        checks: { id: string; status: string }[];
        errors: string[];
      };
      expect(payload.status).toBe('fail');
      const versionCheck = payload.checks.find((c) => c.id === 'codex-plugin-version:spectra');
      expect(versionCheck?.status).toBe('fail');
    });

    it('validate 会检出 codex manifest 文案漂移（codex-plugin-description check fail）', () => {
      // 独立负例：只破坏 description，锚定 codex-plugin-description 校验真实生效
      // （若删掉 description expectEqual，本用例即失败——version 用例无法覆盖此盲区）
      const preSync = runNode(
        join(projectRoot, 'scripts', 'sync-release-contracts.mjs'), projectRoot,
      );
      expect(preSync.exitCode).toBe(0);

      const specDriverCodexPath = join(projectRoot, ...SPEC_DRIVER_CODEX_REL);
      const manifest = JSON.parse(readFileSync(specDriverCodexPath, 'utf-8')) as {
        description: string;
      };
      manifest.description = 'tampered-description';
      writeFileSync(specDriverCodexPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

      const validate = runNode(
        join(projectRoot, 'scripts', 'validate-release-contracts.mjs'), projectRoot,
      );
      expect(validate.exitCode).toBe(1);

      const payload = JSON.parse(validate.stdout) as {
        status: string;
        checks: { id: string; status: string }[];
        errors: string[];
      };
      expect(payload.status).toBe('fail');
      const descCheck = payload.checks.find(
        (c) => c.id === 'codex-plugin-description:spec-driver',
      );
      expect(descCheck?.status).toBe('fail');
    });
  });

  // Feature 213（T017）：release:check 薄壳直调 codex-plugin-consistency 矩阵并扁平合并输出
  describe('codex-plugin-consistency 矩阵接入 release:check 薄壳', () => {
    it('validate-release-contracts.mjs --json 输出含 codex-plugin-consistency: 前缀条目且全 pass', () => {
      const validate = runNode(
        join(projectRoot, 'scripts', 'validate-release-contracts.mjs'), projectRoot,
      );
      expect(validate.exitCode).toBe(0);

      const payload = JSON.parse(validate.stdout) as {
        status: string;
        checks: { id: string; status: string }[];
        errors: string[];
      };
      const codexChecks = payload.checks.filter((c) => c.id.startsWith('codex-plugin-consistency:'));
      // 矩阵 12 条 check 全部经薄壳前缀合并进 checks[]
      expect(codexChecks.length).toBeGreaterThanOrEqual(12);
      expect(codexChecks.every((c) => c.status === 'pass')).toBe(true);
      // 具体锚点：manifest-exists / skills-reference / marketplace-entries 均在
      const ids = codexChecks.map((c) => c.id);
      expect(ids).toContain('codex-plugin-consistency:manifest-exists:spectra');
      expect(ids).toContain('codex-plugin-consistency:skills-reference:spec-driver');
      expect(ids).toContain('codex-plugin-consistency:marketplace-entries');
    });

    it('矩阵 error（manifest 含 hooks）→ 薄壳 exit 1，error 含 codex-plugin-consistency 前缀', () => {
      // 给 spectra codex manifest 注入 hooks 字段 → 矩阵 no-hooks-field:spectra fail
      const spectraCodexPath = join(projectRoot, 'plugins', 'spectra', '.codex-plugin', 'plugin.json');
      const manifest = JSON.parse(readFileSync(spectraCodexPath, 'utf-8')) as Record<string, unknown>;
      manifest.hooks = './hooks/hooks.json';
      writeFileSync(spectraCodexPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');

      const validate = runNode(
        join(projectRoot, 'scripts', 'validate-release-contracts.mjs'), projectRoot,
      );
      expect(validate.exitCode).toBe(1);

      const payload = JSON.parse(validate.stdout) as {
        status: string;
        checks: { id: string; status: string }[];
        errors: string[];
      };
      expect(payload.status).toBe('fail');
      expect(payload.errors.join('\n')).toContain('[codex-plugin-consistency]');
      const noHooks = payload.checks.find((c) => c.id === 'codex-plugin-consistency:no-hooks-field:spectra');
      expect(noHooks?.status).toBe('fail');
    });

    it('矩阵 warning-only（陈旧 waiver）→ 薄壳 exit 0（warning 不阻断 release:check）', () => {
      // 让契约 waiver 多覆盖一个非 gap skill → 矩阵产 warning、无 error → 薄壳 exit 0
      const contractPath = join(projectRoot, 'contracts', 'codex-plugin-consistency.yaml');
      const original = readFileSync(contractPath, 'utf-8');
      const patched = original.replace(
        '      - "spec-driver-refactor"',
        '      - "spec-driver-refactor"\n      - "spec-driver-implement"',
      );
      expect(patched).not.toBe(original);
      writeFileSync(contractPath, patched, 'utf-8');

      const validate = runNode(
        join(projectRoot, 'scripts', 'validate-release-contracts.mjs'), projectRoot,
      );
      // warning-only：无 matrix error → exit 0
      expect(validate.exitCode).toBe(0);

      const payload = JSON.parse(validate.stdout) as {
        status: string;
        checks: { id: string; status: string }[];
        errors: string[];
      };
      expect(payload.status).toBe('pass');
      // gap check 仍 pass（真实缺口仍被覆盖），无 codex error 混入
      const gapCheck = payload.checks.find((c) => c.id === 'codex-plugin-consistency:canonical-vs-codex-gap:spec-driver');
      expect(gapCheck?.status).toBe('pass');
      expect(payload.errors.some((e) => e.includes('[codex-plugin-consistency]'))).toBe(false);
    });
  });
});
