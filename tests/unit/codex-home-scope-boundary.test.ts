/**
 * Feature 240 / T011（SC-011）：仓库内 `.codex/` 路径未被误改 —— 负向回归（🔴 最高风险项）
 *
 * 背景（_grounding.md §9.2 / plan.md §7.3）：`.codex` 这个字符串在本仓库承担**两种语义相反**的角色：
 *   (a) 全局 Codex 家目录 `~/.codex` —— 以家目录为基，MUST 走 resolveCodexHome helper；
 *   (b) 仓库内 `.codex/` 目录 —— 以仓库根 / process.cwd() 为基，MUST NOT 走 helper。
 *
 * 其中 `resolveTargetDir` 更是**同一个函数、同一个 rootDir 变量、两个分支语义相反**。
 * 把 `.codex` 全量替换为 helper 会让 project 模式指向 CODEX_HOME，破坏项目级安装；
 * 而仓库内 `.codex/skills/` 是**真实存在的 F238 wrapper 产物目录**（9 个 spec-driver 系列 SKILL.md），
 * 受 wrapper body-sha256 门禁保护 —— 误改会**同时**打断 npm run repo:check 与 F238 门禁链路。
 *
 * 本文件是防止未来引入该回归的钉死断言：在**设置了自定义 CODEX_HOME 的环境下**，
 * 逐条断言这 4 个路径点的解析结果仍以仓库根 / cwd 为基，且与未设置时逐字节相同。
 */

import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveTargetDir } from '../../src/installer/skill-installer.js';

const repoFile = (rel: string) => fileURLToPath(new URL(`../../${rel}`, import.meta.url));

const CUSTOM_CODEX_HOME = '/tmp/f240-custom-codex-home';

/** 在自定义 CODEX_HOME 下执行 fn，执行后还原环境 */
function withCustomCodexHome<T>(fn: () => T): T {
  const original = process.env['CODEX_HOME'];
  process.env['CODEX_HOME'] = CUSTOM_CODEX_HOME;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env['CODEX_HOME'];
    else process.env['CODEX_HOME'] = original;
  }
}

/** 在确保 CODEX_HOME 未设置的环境下执行 fn */
function withoutCodexHome<T>(fn: () => T): T {
  const original = process.env['CODEX_HOME'];
  delete process.env['CODEX_HOME'];
  try {
    return fn();
  } finally {
    if (original !== undefined) process.env['CODEX_HOME'] = original;
  }
}

describe('边界点 1/4 — skill-installer.ts 的 project 分支（cwd 为基）', () => {
  it('project + codex：设置自定义 CODEX_HOME 前后逐字节相同，且仍以 cwd 为基', () => {
    const withEnv = withCustomCodexHome(() => resolveTargetDir('project', 'codex'));
    const withoutEnv = withoutCodexHome(() => resolveTargetDir('project', 'codex'));

    expect(withEnv).toBe(withoutEnv);
    expect(withEnv).toBe(join(process.cwd(), '.codex', 'skills'));
    expect(withEnv.startsWith(CUSTOM_CODEX_HOME)).toBe(false);
  });

  it('project + claude：同样不受 CODEX_HOME 影响', () => {
    const withEnv = withCustomCodexHome(() => resolveTargetDir('project', 'claude'));
    expect(withEnv).toBe(join(process.cwd(), '.claude', 'skills'));
  });

  it('global + claude：Claude 全局分支不得被 CODEX_HOME 劫持（只有 codex 全局分支走 helper）', () => {
    const withEnv = withCustomCodexHome(() => resolveTargetDir('global', 'claude'));
    const withoutEnv = withoutCodexHome(() => resolveTargetDir('global', 'claude'));

    expect(withEnv).toBe(withoutEnv);
    expect(withEnv).toBe(join(homedir(), '.claude', 'skills'));
  });
});

describe('边界点 2/4 — validate-orchestrator-models.mjs 的 .codex/skills（仓库根为基）', () => {
  const source = readFileSync(repoFile('plugins/spec-driver/scripts/validate-orchestrator-models.mjs'), 'utf-8');

  it('仍以传入的 root 参数为基拼接 .codex/skills', () => {
    expect(source).toMatch(/path\.join\(\s*root,\s*'\.codex\/skills'/);
  });

  it('全文件零命中 CODEX_HOME / codex-home helper（证明未被误迁移）', () => {
    expect(source).not.toContain('CODEX_HOME');
    expect(source).not.toContain('resolveCodexHome');
    expect(source).not.toContain('codex-home');
  });
});

describe('边界点 3/4 — sync-delegation-contract.mjs 的 .codex/skills（仓库根为基）', () => {
  const source = readFileSync(repoFile('plugins/spec-driver/scripts/sync-delegation-contract.mjs'), 'utf-8');

  it('仍以传入的 root 参数为基拼接 .codex/skills', () => {
    expect(source).toMatch(/path\.join\(\s*root,\s*'\.codex\/skills'/);
  });

  it('全文件零命中 CODEX_HOME / codex-home helper（证明未被误迁移）', () => {
    expect(source).not.toContain('CODEX_HOME');
    expect(source).not.toContain('resolveCodexHome');
    expect(source).not.toContain('codex-home');
  });
});

describe('边界点 4/4 — codex-skills.sh 的 project 模式（PROJECT_ROOT 为基）', () => {
  const script = repoFile('plugins/spec-driver/scripts/codex-skills.sh');
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('project 模式即使设置了 CODEX_HOME，目标仍是 PROJECT_ROOT/.codex/skills，且不误删 CODEX_HOME 下的同名目录', () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'f240-proj-'));
    const codexHome = mkdtempSync(join(tmpdir(), 'f240-cxhome-'));
    const fakeHome = mkdtempSync(join(tmpdir(), 'f240-home-'));
    tmpDirs.push(projectRoot, codexHome, fakeHome);

    // 项目内目标：应被 project 模式的 remove 删除
    const projectSkill = join(projectRoot, '.codex', 'skills', 'spec-driver-feature');
    mkdirSync(projectSkill, { recursive: true });
    writeFileSync(join(projectSkill, 'SKILL.md'), '# probe\n');

    // 诱饵：CODEX_HOME 下的同名目录，project 模式 MUST NOT 触碰
    const decoySkill = join(codexHome, 'skills', 'spec-driver-feature');
    mkdirSync(decoySkill, { recursive: true });
    writeFileSync(join(decoySkill, 'SKILL.md'), '# decoy\n');

    const stdout = execFileSync('bash', [script, 'remove'], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        CODEX_SKILL_PROJECT_ROOT: projectRoot,
        CODEX_HOME: codexHome,
        HOME: fakeHome,
      },
    });

    // 目标解析到项目根
    expect(stdout).toContain(join(projectRoot, '.codex', 'skills', 'spec-driver-feature'));
    expect(existsSync(projectSkill)).toBe(false);
    // 🔴 诱饵完好：project 模式绝不受 CODEX_HOME 影响
    expect(existsSync(decoySkill)).toBe(true);
    expect(stdout).not.toContain(codexHome);
  });

  it('project 分支源码仍以 $PROJECT_ROOT 为基（逐字面量钉死）', () => {
    const source = readFileSync(script, 'utf-8');
    expect(source).toContain('TARGET_DIR="$PROJECT_ROOT/.codex/skills"');
  });
});
