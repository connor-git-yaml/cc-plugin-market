/**
 * Spec Driver Codex skills 安装脚本集成测试
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import {
  mkdtempSync,
  rmSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  readdirSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { validateWrapperSources } from '../../plugins/spec-driver/scripts/validate-wrapper-sources.mjs';
import { extractWrapperBody } from '../../plugins/spec-driver/scripts/lib/extract-wrapper-body.mjs';

const REPO_ROOT = resolve('.');
const SCRIPT_PATH = resolve('plugins/spec-driver/scripts/codex-skills.sh');

// Feature 238（T1.3）：9 个 Spec Driver Codex 适配 skill id（与 wrapper-source-of-truth.yaml entries 对齐，
// spec-driver-refactor 的 wrapper 缺口已补齐，FR-101/105）
const SPEC_DRIVER_SKILLS = [
  'spec-driver-constitution',
  'spec-driver-feature',
  'spec-driver-implement',
  'spec-driver-story',
  'spec-driver-fix',
  'spec-driver-resume',
  'spec-driver-sync',
  'spec-driver-doc',
  'spec-driver-refactor',
];

// 真实仓库内 tracked 的 Codex 分发目录（无 flag 守护用例锚定其零变化）
const REPO_SKILLS_CODEX = resolve('plugins/spec-driver/skills-codex');

// 计算目录确定性快照：不存在返回 '<absent>'，存在则递归拼接 sorted 相对路径 + 内容
function snapshotDir(dir: string): string {
  if (!existsSync(dir)) {
    return '<absent>';
  }
  const entries: string[] = [];
  const walk = (current: string, rel: string): void => {
    for (const name of readdirSync(current).sort()) {
      const full = join(current, name);
      const relPath = rel ? `${rel}/${name}` : name;
      if (statSync(full).isDirectory()) {
        walk(full, relPath);
      } else {
        entries.push(`${relPath}\n${readFileSync(full, 'utf-8')}`);
      }
    }
  };
  walk(dir, '');
  return entries.join('\n---ENTRY---\n');
}

// 在 tempDir 内建立 plugins/spec-driver 的 fixture 副本（$PLUGIN_DIR 由脚本物理位置派生，
// 用副本脚本可让 skills-codex/ 落在 tempDir 内而非真实仓库）
function copyPluginFixture(root: string): string {
  mkdirSync(join(root, 'plugins'), { recursive: true });
  cpSync(resolve('plugins/spec-driver'), join(root, 'plugins', 'spec-driver'), {
    recursive: true,
  });
  return join(root, 'plugins', 'spec-driver', 'scripts', 'codex-skills.sh');
}

// 运行任意路径脚本（catch 非零退出，用于 TDD 红用例断言 exitCode）
function runFixtureScript(
  scriptPath: string,
  args: string[],
  root: string,
): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync('bash', [scriptPath, ...args], {
      encoding: 'utf-8',
      timeout: 20_000,
      cwd: root,
      env: {
        ...process.env,
        HOME: process.env['HOME'],
        CODEX_SKILL_PROJECT_ROOT: root,
      },
    });
    return { stdout, exitCode: 0 };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (error.stdout ?? '') + (error.stderr ?? ''),
      exitCode: error.status ?? 1,
    };
  }
}

function runScript(
  args: string[],
  options?: { cwd?: string; home?: string },
): { stdout: string; exitCode: number } {
  try {
    const stdout = execFileSync('bash', [SCRIPT_PATH, ...args], {
      encoding: 'utf-8',
      timeout: 10_000,
      cwd: options?.cwd ?? process.cwd(),
      env: {
        ...process.env,
        HOME: options?.home ?? process.env['HOME'],
      },
    });
    return { stdout, exitCode: 0 };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (error.stdout ?? '') + (error.stderr ?? ''),
      exitCode: error.status ?? 1,
    };
  }
}

// Feature 238（Slice 3/W4 修订）：受控 PATH 手法 —— tempDir/bin 内只含脚本实际调用面
// 所需系统命令的 symlink + fake `codex`，测试时 env.PATH **完全替换**为该目录（非追加式），
// 防止装机上真实 `codex`/系统工具版本差异抢先命中导致假失败。
//
// codex-skills.sh 与 detect-codex-capability.mjs 实际调用面核实结果：
// bash（脚本自身解释器）、node（extract-wrapper-body.mjs ×2 + detect-codex-capability.mjs）、
// dirname（$SCRIPT_DIR/$PLUGIN_DIR/sidecar_path 派生）、mkdir（write_wrapper 建目录）、
// awk（write_frontmatter）、cat（heredoc 生成 adapter/contract 段）、rm/cp（--sync-plugin-distribution
// 分支，本文件部分用例会触发）。cd/pwd/local/printf 均为 bash 内建，无需额外 symlink。
// project 模式借由测试统一显式传 CODEX_SKILL_PROJECT_ROOT，跳过 `git rev-parse` 分支，故不需要 git。
const CONTROLLED_BIN_COMMANDS = ['bash', 'node', 'dirname', 'mkdir', 'awk', 'cat', 'rm', 'cp'] as const;

// 少量对 shell/Node 运行时稳定性有意义、与"codex 版本抢先命中"风险无关的环境变量原样透传，
// 其余全部清空——PATH 本身严格只指向受控 bin 目录（不含真实系统 PATH 任何片段）。
const ENV_PASSTHROUGH_KEYS = ['LANG', 'LC_ALL', 'TMPDIR', 'TERM'] as const;

function resolveSystemBinary(name: string): string {
  const out = execFileSync('bash', ['-c', `command -v ${name}`], { encoding: 'utf-8' }).trim();
  if (!out) {
    throw new Error(`resolveSystemBinary: 无法定位系统命令 ${name}`);
  }
  return out;
}

function buildControlledBin(binDir: string): void {
  mkdirSync(binDir, { recursive: true });
  for (const cmd of CONTROLLED_BIN_COMMANDS) {
    symlinkSync(resolveSystemBinary(cmd), join(binDir, cmd));
  }
}

type FakeCodexMode = 'native' | 'effective-false' | 'command-failed';

// fake `codex` 按参数分类记录调用（Tasks 审查轮 C1 修订）：`features list` 与 `--version`
// 各自独立追加一行带标签的日志到 callLogPath，供调用方分别核算各自的调用次数，
// 不合并计数——避免任一子调用被重复触发的回归被"总计数=N"这种粗粒度断言掩盖。
function writeFakeCodex(binDir: string, mode: FakeCodexMode, callLogPath: string): void {
  const featuresBody =
    mode === 'command-failed'
      ? '  exit 1'
      : mode === 'effective-false'
        ? '  echo "multi_agent   stable   false"\n  exit 0'
        : '  echo "multi_agent   stable   true"\n  exit 0';
  const versionBody = mode === 'command-failed' ? '  exit 1' : '  echo "codex-cli 9.9.9 (fake)"\n  exit 0';

  const script = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    `CALL_LOG="${callLogPath}"`,
    'if [[ "${1:-}" == "features" && "${2:-}" == "list" ]]; then',
    '  echo "features-list" >> "$CALL_LOG"',
    featuresBody,
    'elif [[ "${1:-}" == "--version" ]]; then',
    '  echo "version" >> "$CALL_LOG"',
    versionBody,
    'else',
    '  exit 1',
    'fi',
    '',
  ].join('\n');
  writeFileSync(join(binDir, 'codex'), script, { mode: 0o755 });
}

function runWithControlledPath(
  scriptPath: string,
  args: string[],
  opts: { root: string; binDir: string },
): { stdout: string; exitCode: number } {
  const bashBin = join(opts.binDir, 'bash');
  const passthroughEnv: Record<string, string> = {};
  for (const key of ENV_PASSTHROUGH_KEYS) {
    const value = process.env[key];
    if (value !== undefined) passthroughEnv[key] = value;
  }
  try {
    const stdout = execFileSync(bashBin, [scriptPath, ...args], {
      encoding: 'utf-8',
      timeout: 20_000,
      cwd: opts.root,
      env: {
        ...passthroughEnv,
        PATH: opts.binDir,
        HOME: opts.root,
        CODEX_SKILL_PROJECT_ROOT: opts.root,
      },
    });
    return { stdout, exitCode: 0 };
  } catch (err: unknown) {
    const error = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (error.stdout ?? '') + (error.stderr ?? ''),
      exitCode: error.status ?? 1,
    };
  }
}

function collectFileNames(dir: string): string[] {
  const names: string[] = [];
  const walk = (current: string): void => {
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        names.push(name);
      }
    }
  };
  walk(dir);
  return names;
}

describe('Spec Driver Codex skills script', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'spec-driver-codex-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('project 安装并移除 codex 包装技能', () => {
    const install = runScript(['install'], { cwd: tempDir });
    expect(install.exitCode).toBe(0);
    expect(install.stdout).toContain('安装完成');

    expect(
      existsSync(
        join(tempDir, '.codex', 'skills', 'spec-driver-feature', 'SKILL.md'),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(tempDir, '.codex', 'skills', 'spec-driver-implement', 'SKILL.md'),
      ),
    ).toBe(true);
    expect(
      existsSync(join(tempDir, '.codex', 'skills', 'spec-driver-doc', 'SKILL.md')),
    ).toBe(true);
    expect(
      existsSync(
        join(tempDir, '.codex', 'skills', 'spec-driver-constitution', 'SKILL.md'),
      ),
    ).toBe(true);
    // Feature 238（T1.3/FR-105）：spec-driver-refactor 的 Codex wrapper 与其余 8 个路径完全一致
    expect(
      existsSync(join(tempDir, '.codex', 'skills', 'spec-driver-refactor', 'SKILL.md')),
    ).toBe(true);

    const storyWrapper = readFileSync(
      join(tempDir, '.codex', 'skills', 'spec-driver-story', 'SKILL.md'),
      'utf-8',
    );
    expect(storyWrapper).toContain('description: "快速需求实现');
    expect(storyWrapper).toContain('## Wrapper Source Contract');
    expect(storyWrapper).toContain('## Codex Runtime Adapter');
    expect(storyWrapper).toContain('Canonical source: `$PLUGIN_DIR/skills/spec-driver-story/SKILL.md`');
    expect(storyWrapper).toContain('Generated by: `bash $PLUGIN_DIR/scripts/codex-skills.sh install`');
    expect(storyWrapper).toContain('Contract: `$PLUGIN_DIR/contracts/wrapper-source-of-truth.yaml`');
    expect(storyWrapper).toContain('do not edit this wrapper directly');
    expect(storyWrapper).toContain('$spec-driver-story <需求描述>');
    expect(storyWrapper).toContain('model_compat.defaults.codex');
    expect(storyWrapper).toContain('opus/sonnet');
    expect(storyWrapper).toContain('.specify/project-context.yaml');
    expect(storyWrapper).toContain('resolve-project-context.mjs');
    expect(storyWrapper).toContain('canonical source');
    expect(storyWrapper).toContain('legacy fallback');
    expect(storyWrapper).toContain('架构合理性');
    expect(storyWrapper).toContain('可读性');

    const implementWrapper = readFileSync(
      join(tempDir, '.codex', 'skills', 'spec-driver-implement', 'SKILL.md'),
      'utf-8',
    );
    expect(implementWrapper).toContain('description: "成熟 Spec 实施');
    expect(implementWrapper).toContain('## Wrapper Source Contract');
    expect(implementWrapper).toContain('Canonical source: `$PLUGIN_DIR/skills/spec-driver-implement/SKILL.md`');
    expect(implementWrapper).toContain('$spec-driver-implement [<feature-dir-or-id>]');
    expect(implementWrapper).toContain('成熟 `spec.md + plan.md` 的聚焦实施');
    expect(implementWrapper).toContain('Spec / Plan 合同检查（Implement 首要前置 gate）');
    expect(implementWrapper).toContain('[CONTRACT_CHECK] READY|BLOCKED');
    expect(implementWrapper).toContain('resolve-project-context.mjs');
    expect(implementWrapper).toContain('.specify/project-context.yaml');
    expect(implementWrapper).toContain('.specify/project-context.suggestions.yaml');
    expect(implementWrapper).toContain('advisory-only');
    expect(implementWrapper).toContain('架构合理性');
    expect(implementWrapper).toContain('可读性');

    const constitutionWrapper = readFileSync(
      join(tempDir, '.codex', 'skills', 'spec-driver-constitution', 'SKILL.md'),
      'utf-8',
    );
    expect(constitutionWrapper).toContain('$spec-driver-constitution [原则更新说明]');
    expect(constitutionWrapper).toContain('.specify/memory/constitution.md');

    // Feature 238（T1.3/FR-101/105）：refactor wrapper 正文命令别名替换与其余 8 个路径完全一致。
    // 断言对象是 extractWrapperBody 产出的"正文"（不含 Codex Runtime Adapter 说明段——
    // 该段固定文案 `命令别名：正文中的 /spec-driver:X 在 Codex 中等价于 $Y` 出于文档目的
    // 必然同时含两种记号，不属于替换范围，与 wrapper-sha256.test.ts 的既有断言口径一致）
    const refactorSourcePath = join(
      REPO_ROOT,
      'plugins',
      'spec-driver',
      'skills',
      'spec-driver-refactor',
      'SKILL.md',
    );
    const refactorBody = extractWrapperBody(refactorSourcePath);
    expect(refactorBody).toContain('$spec-driver-refactor');
    expect(refactorBody).not.toContain('/spec-driver:spec-driver-refactor');

    const refactorWrapper = readFileSync(
      join(tempDir, '.codex', 'skills', 'spec-driver-refactor', 'SKILL.md'),
      'utf-8',
    );
    expect(refactorWrapper).toContain('$spec-driver-refactor');

    const remove = runScript(['remove'], { cwd: tempDir });
    expect(remove.exitCode).toBe(0);
    expect(remove.stdout).toContain('已移除');
    expect(
      existsSync(join(tempDir, '.codex', 'skills', 'spec-driver-feature')),
    ).toBe(false);
    // Feature 238（Tasks 审查轮 W11）：补齐 spec-driver-refactor 的 remove 路径覆盖
    // （此前仅覆盖其余 8 个 wrapper 的 remove 断言，该 skill 从未被验证过会被 remove 清理）
    expect(
      existsSync(join(tempDir, '.codex', 'skills', 'spec-driver-refactor')),
    ).toBe(false);
  });

  it('global 模式写入 HOME/.codex/skills（隔离 HOME）', () => {
    const fakeHome = join(tempDir, 'fake-home');
    const result = runScript(['install', '--global'], {
      cwd: tempDir,
      home: fakeHome,
    });

    expect(result.exitCode).toBe(0);
    expect(
      existsSync(join(fakeHome, '.codex', 'skills', 'spec-driver-sync', 'SKILL.md')),
    ).toBe(true);
    expect(
      existsSync(join(fakeHome, '.codex', 'skills', 'spec-driver-implement', 'SKILL.md')),
    ).toBe(true);
    expect(
      existsSync(
        join(fakeHome, '.codex', 'skills', 'spec-driver-constitution', 'SKILL.md'),
      ),
    ).toBe(true);

    const wrapperContent = readFileSync(
      join(fakeHome, '.codex', 'skills', 'spec-driver-feature', 'SKILL.md'),
      'utf-8',
    );
    expect(wrapperContent).toContain('description: "执行 Spec-Driven Development 完整研发流程');
    expect(wrapperContent).toContain('## Wrapper Source Contract');
    expect(wrapperContent).toContain('## Codex Runtime Adapter');
    expect(wrapperContent).toContain('$PLUGIN_DIR/skills/spec-driver-feature/SKILL.md');
    expect(wrapperContent).toContain('$PLUGIN_DIR/contracts/wrapper-source-of-truth.yaml');
    expect(wrapperContent).toContain('$spec-driver-feature <需求描述>');
    expect(wrapperContent).toContain('# Spec Driver — 自治研发编排器');
    // Feature SKILL.md 在 Feature 089 编排拆分后不再包含 suggestions/审查维度等引用
    // 这些内容已拆分到独立的 agent prompt 中，不再内嵌于 SKILL.md
    expect(wrapperContent).not.toContain(
      resolve('plugins/spec-driver/skills/spec-driver-feature/SKILL.md'),
    );
  });

  it('project 模式在 git 子目录执行时安装到 git 根目录', () => {
    const repoRoot = join(tempDir, 'repo');
    mkdirSync(repoRoot, { recursive: true });
    execFileSync('git', ['init'], { cwd: repoRoot, encoding: 'utf-8' });
    const nestedCwd = join(repoRoot, 'apps', 'web');
    mkdirSync(nestedCwd, { recursive: true });

    const result = runScript(['install'], { cwd: nestedCwd });
    expect(result.exitCode).toBe(0);
    expect(
      existsSync(join(repoRoot, '.codex', 'skills', 'spec-driver-feature', 'SKILL.md')),
    ).toBe(true);
  });

  // Feature 213 T003：opt-in 双写机制（一红两绿）
  describe('Feature 213 — --sync-plugin-distribution opt-in 双写', () => {
    it('[红] install --sync-plugin-distribution 生成 skills-codex/ 9 目录且与 .codex/skills 字节相同', () => {
      const fixtureScript = copyPluginFixture(tempDir);
      const install = runFixtureScript(
        fixtureScript,
        ['install', '--sync-plugin-distribution'],
        tempDir,
      );
      // 实现前：脚本无该 flag → 未知参数 exit 1 → 本断言失败（红）
      expect(install.exitCode).toBe(0);

      const distDir = join(tempDir, 'plugins', 'spec-driver', 'skills-codex');
      const codexDir = join(tempDir, '.codex', 'skills');
      expect(existsSync(distDir)).toBe(true);
      expect(readdirSync(distDir).filter((n) => statSync(join(distDir, n)).isDirectory()).sort())
        .toHaveLength(9);
      for (const skill of SPEC_DRIVER_SKILLS) {
        const distFile = join(distDir, skill, 'SKILL.md');
        const codexFile = join(codexDir, skill, 'SKILL.md');
        expect(existsSync(distFile)).toBe(true);
        expect(existsSync(codexFile)).toBe(true);
        // copy-after-generate 保证逐字节相同（Buffer 相等）
        expect(readFileSync(distFile).equals(readFileSync(codexFile))).toBe(true);
      }
    });

    // sentinel 不在 SKILLS 列表内：任何 rm -rf 重建（哪怕字节相同重写）都会丢掉它，
    // 故 sentinel 存活是比"快照字节相同"更强的守护（防"删了又重建相同字节"骗过快照）。
    it('[绿a·characterization] 无 flag 的 install 不触碰 distribution 目录（sentinel 存活 + 真实仓库快照不变）', () => {
      const fixtureScript = copyPluginFixture(tempDir);
      const distDir = join(tempDir, 'plugins', 'spec-driver', 'skills-codex');
      mkdirSync(distDir, { recursive: true });
      const sentinel = join(distDir, '.sentinel-do-not-touch');
      writeFileSync(sentinel, 'SENTINEL');

      const repoBefore = snapshotDir(REPO_SKILLS_CODEX);
      const install = runFixtureScript(fixtureScript, ['install'], tempDir);
      expect(install.exitCode).toBe(0);

      // sentinel 存活（若 sync_plugin_distribution_copy 的 rm -rf 误触发会删掉它）
      expect(existsSync(sentinel)).toBe(true);
      expect(readFileSync(sentinel, 'utf-8')).toBe('SENTINEL');
      // 第二道防线：真实仓库 skills-codex 快照不变
      expect(snapshotDir(REPO_SKILLS_CODEX)).toBe(repoBefore);
    });

    it('[绿b·characterization] remove 不触碰 distribution 目录（sentinel 存活 + 真实仓库快照不变）', () => {
      const fixtureScript = copyPluginFixture(tempDir);
      const distDir = join(tempDir, 'plugins', 'spec-driver', 'skills-codex');
      mkdirSync(distDir, { recursive: true });
      const sentinel = join(distDir, '.sentinel-do-not-touch');
      writeFileSync(sentinel, 'SENTINEL');

      const repoBefore = snapshotDir(REPO_SKILLS_CODEX);
      runFixtureScript(fixtureScript, ['install'], tempDir);
      const remove = runFixtureScript(fixtureScript, ['remove'], tempDir);
      expect(remove.exitCode).toBe(0);

      expect(existsSync(sentinel)).toBe(true);
      expect(readFileSync(sentinel, 'utf-8')).toBe('SENTINEL');
      expect(snapshotDir(REPO_SKILLS_CODEX)).toBe(repoBefore);
    });
  });

  // Feature 238（T1.3/Tasks 审查轮 W11）：spec-driver-refactor 的 frontmatter/SHA 一致性行为
  // 与其余 8 个 wrapper 完全一致——复用既有 validateWrapperSources helper（wrapper-sha256.test.ts
  // 已用手法），不写平行断言逻辑。
  describe('Feature 238 — refactor wrapper frontmatter/SHA 校验与其余 8 个一致', () => {
    it('install 后 validateWrapperSources：9 个 wrapper（含 spec-driver-refactor）markers + sha256 全部 pass', () => {
      const projectRoot = mkdtempSync(join(tmpdir(), 'spec-driver-codex-wrapper-sha-'));
      try {
        mkdirSync(join(projectRoot, 'plugins'), { recursive: true });
        cpSync(join(REPO_ROOT, 'plugins', 'spec-driver'), join(projectRoot, 'plugins', 'spec-driver'), {
          recursive: true,
        });
        cpSync(join(REPO_ROOT, '.claude-plugin'), join(projectRoot, '.claude-plugin'), { recursive: true });

        execFileSync(
          'bash',
          [join(projectRoot, 'plugins', 'spec-driver', 'scripts', 'codex-skills.sh'), 'install'],
          {
            cwd: projectRoot,
            encoding: 'utf-8',
            timeout: 30_000,
            env: { ...process.env, CODEX_SKILL_PROJECT_ROOT: projectRoot },
          },
        );

        const result = validateWrapperSources({ projectRoot }) as {
          status: string;
          checks: Array<{ id: string; status: string; evidence: Record<string, unknown> }>;
        };
        expect(result.status).toBe('pass');
        const markers = result.checks.find((c) => c.id === 'codex-wrapper-markers');
        expect(markers?.status).toBe('pass');
        // checkedCount === 9 机械验证 refactor 与其余 8 个一并被同一套 marker/sha256 校验覆盖，
        // 不存在只覆盖 8 个的验证盲区
        expect((markers?.evidence as { checkedCount: number }).checkedCount).toBe(9);
        expect((markers?.evidence as { missingFiles: string[] }).missingFiles).toEqual([]);
        expect((markers?.evidence as { shaMismatches: unknown[] }).shaMismatches).toEqual([]);
      } finally {
        rmSync(projectRoot, { recursive: true, force: true });
      }
    });
  });

  // Feature 238（Slice 3/US-2/FR-201~209/301）：capability 探测 install-time 接线 + sidecar
  // + capability-neutral 文案。全部用例走「受控 PATH」（见文件顶部 helper），避免装机真实
  // codex/系统工具版本差异污染断言。
  describe('Feature 238 — capability 探测与 sidecar 接线', () => {
    const SAMPLE_SKILL = 'spec-driver-implement';

    function setupControlledInstall(root: string): { scriptPath: string; binDir: string } {
      const scriptPath = copyPluginFixture(root);
      const binDir = join(root, 'ctrl-bin');
      buildControlledBin(binDir);
      return { scriptPath, binDir };
    }

    it('[T3.1/T3.2] native codex → sidecar 记录 native 且 wrapper 正文 capability-neutral；features list / --version 单次 install 内各恰好调用 1 次', () => {
      const { scriptPath, binDir } = setupControlledInstall(tempDir);
      const callLog = join(tempDir, 'codex-calls.log');
      writeFakeCodex(binDir, 'native', callLog);

      const install = runWithControlledPath(scriptPath, ['install'], { root: tempDir, binDir });
      expect(install.exitCode).toBe(0);

      const sidecarPath = join(tempDir, '.codex', 'spec-driver-capability.md');
      expect(existsSync(sidecarPath)).toBe(true);
      const sidecarContent = readFileSync(sidecarPath, 'utf-8');
      expect(sidecarContent).toContain('Subagent Capability: native');

      // capability-neutral：wrapper 正文永远不含探测结果行
      for (const skill of SPEC_DRIVER_SKILLS) {
        const wrapper = readFileSync(join(tempDir, '.codex', 'skills', skill, 'SKILL.md'), 'utf-8');
        expect(wrapper).not.toContain('Subagent Capability');
      }

      // T3.2（Tasks 审查轮 C1 修订）：features list 与 --version 各自独立计数，各恰好 1 次
      const callLines = readFileSync(callLog, 'utf-8').trim().split('\n').filter(Boolean);
      expect(callLines.filter((line) => line === 'features-list')).toHaveLength(1);
      expect(callLines.filter((line) => line === 'version')).toHaveLength(1);
    });

    it('[T3.1b] FR-204 三份产物中性指针一致性：.codex/skills 与 skills-codex 镜像均含中性指针文案、均不含具体 capability 结果值字面量', () => {
      const { scriptPath, binDir } = setupControlledInstall(tempDir);
      writeFakeCodex(binDir, 'native', join(tempDir, 'codex-calls.log'));
      const install = runWithControlledPath(scriptPath, ['install', '--sync-plugin-distribution'], {
        root: tempDir,
        binDir,
      });
      expect(install.exitCode).toBe(0);

      const neutralPointer = '.codex/spec-driver-capability.md';

      for (const distPath of [
        join(tempDir, '.codex', 'skills', SAMPLE_SKILL, 'SKILL.md'),
        join(tempDir, 'plugins', 'spec-driver', 'skills-codex', SAMPLE_SKILL, 'SKILL.md'),
      ]) {
        const content = readFileSync(distPath, 'utf-8');
        expect(content).toContain(neutralPointer);
        expect(content).not.toContain('Subagent Capability: native');
        expect(content).not.toMatch(/Subagent Capability: degraded/);
      }
    });

    it('[T3.3] 受控 PATH 内不含任何 codex 可执行文件 → sidecar degraded(reason=binary-missing)，install 整体 exit 0（FR-202/206，E1）', () => {
      const { scriptPath, binDir } = setupControlledInstall(tempDir);
      // 有意不写入 fake codex —— 受控 PATH 内完全不存在该可执行文件（区别于"追加式 PATH 里没有"）

      const install = runWithControlledPath(scriptPath, ['install'], { root: tempDir, binDir });
      expect(install.exitCode).toBe(0);

      const sidecarContent = readFileSync(join(tempDir, '.codex', 'spec-driver-capability.md'), 'utf-8');
      expect(sidecarContent).toContain('Subagent Capability: degraded(reason=binary-missing)');
    });

    it('[T3.4] fake codex exit 1 → sidecar degraded(reason=command-failed)', () => {
      const { scriptPath, binDir } = setupControlledInstall(tempDir);
      writeFakeCodex(binDir, 'command-failed', join(tempDir, 'codex-calls.log'));

      const install = runWithControlledPath(scriptPath, ['install'], { root: tempDir, binDir });
      expect(install.exitCode).toBe(0);

      const sidecarContent = readFileSync(join(tempDir, '.codex', 'spec-driver-capability.md'), 'utf-8');
      expect(sidecarContent).toContain('Subagent Capability: degraded(reason=command-failed)');
    });

    it('[T3.5] 连续两次 install，第二次 fake codex 返回 effective=false → sidecar 内容随第二次刷新（FR-208）', () => {
      const { scriptPath, binDir } = setupControlledInstall(tempDir);
      const callLog = join(tempDir, 'codex-calls.log');
      const sidecarPath = join(tempDir, '.codex', 'spec-driver-capability.md');

      writeFakeCodex(binDir, 'native', callLog);
      const first = runWithControlledPath(scriptPath, ['install'], { root: tempDir, binDir });
      expect(first.exitCode).toBe(0);
      expect(readFileSync(sidecarPath, 'utf-8')).toContain('Subagent Capability: native');

      writeFakeCodex(binDir, 'effective-false', callLog);
      const second = runWithControlledPath(scriptPath, ['install'], { root: tempDir, binDir });
      expect(second.exitCode).toBe(0);
      expect(readFileSync(sidecarPath, 'utf-8')).toContain(
        'Subagent Capability: degraded(reason=effective-false)',
      );
    });

    it('[T3.6] sidecar 三要素完整性 + 隔离边界：tracked 产物与 npm pack 产物列表均不含 sidecar 文件（FR-206/207）', () => {
      const { scriptPath, binDir } = setupControlledInstall(tempDir);
      writeFakeCodex(binDir, 'native', join(tempDir, 'codex-calls.log'));
      const install = runWithControlledPath(scriptPath, ['install'], { root: tempDir, binDir });
      expect(install.exitCode).toBe(0);

      const sidecarContent = readFileSync(join(tempDir, '.codex', 'spec-driver-capability.md'), 'utf-8');
      // 三要素：capability 行 + ISO 8601 时间戳行 + codex --version 结果行
      expect(sidecarContent).toMatch(/Subagent Capability: (native|degraded\(reason=[a-z-]+\))/);
      expect(sidecarContent).toMatch(/Detected At: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/);
      expect(sidecarContent).toContain('Codex Version:');
      expect(sidecarContent).toContain('9.9.9');

      // 隔离边界：sidecar 文件名不应出现在任一 tracked 分发树内
      expect(collectFileNames(join(tempDir, '.codex', 'skills'))).not.toContain(
        'spec-driver-capability.md',
      );
      expect(collectFileNames(REPO_SKILLS_CODEX)).not.toContain('spec-driver-capability.md');

      // 隔离边界：npm 发布包产物列表不含 sidecar 文件
      const packOutput = execFileSync('npm', ['pack', '--dry-run', '--json'], {
        encoding: 'utf-8',
        cwd: REPO_ROOT,
        timeout: 60_000,
      });
      const packInfo = JSON.parse(packOutput) as Array<{ files: Array<{ path: string }> }>;
      const allPackedPaths = packInfo.flatMap((entry) => entry.files.map((f) => f.path));
      expect(allPackedPaths.some((p) => p.endsWith('spec-driver-capability.md'))).toBe(false);
    });

    it('[T3.7b] write_codex_adapter() 的"模型兼容"行不含具体 gpt-5 字面量、含"由 Codex CLI"字样（FR-301 前置）', () => {
      const { scriptPath, binDir } = setupControlledInstall(tempDir);
      writeFakeCodex(binDir, 'native', join(tempDir, 'codex-calls.log'));
      const install = runWithControlledPath(scriptPath, ['install'], { root: tempDir, binDir });
      expect(install.exitCode).toBe(0);

      const wrapper = readFileSync(join(tempDir, '.codex', 'skills', SAMPLE_SKILL, 'SKILL.md'), 'utf-8');
      const modelLine = wrapper.split('\n').find((line) => line.includes('模型兼容'));
      expect(modelLine).toBeDefined();
      expect(modelLine).not.toMatch(/gpt-5/);
      expect(modelLine).toContain('由 Codex CLI');
    });
  });
});
