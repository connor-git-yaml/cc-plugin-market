/**
 * Feature 239 — `.worktreeinclude` 内容合同 + AGENTS byte budget 单元测试（T001）
 *
 * 覆盖：
 * - FR-001：安全公共子集的 8 类拒绝 reason + 1 类合法条目通过
 *   （absolute-path / dot-dot-segment / glob-char / negation-prefix /
 *     escape-char / trailing-slash / not-ignored / not-regular-file）
 * - FR-001(c)：路径存在时必须是常规文件；**路径不存在不视为违规**
 *   （干净 checkout 里 ignored 文件缺席是常态）
 * - FR-008：`AGENTS.md` 与 `AGENTS.override.md` 各自 ≤ 32768 bytes，按 max 不按 sum
 * - 决策 4（C7）：`not-ignored` 子检查在非 git 环境降级为 skip，不拖累整体族状态
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// @ts-expect-error — .mjs 无类型声明，运行时可解析
import * as core from '../../scripts/lib/worktree-local-state-core.mjs';

interface CheckResult {
  status: string;
  checks: Array<{ id: string; title: string; status: string; evidence: Record<string, unknown> }>;
  warnings: string[];
  errors: string[];
}

interface EntryVerdict {
  valid: boolean;
  reason?: string;
}

const AGENTS_BYTE_BUDGET: number = core.AGENTS_BYTE_BUDGET;
const parseWorktreeInclude = core.parseWorktreeInclude as (content: string) => string[];
const validateWorktreeIncludeEntry = core.validateWorktreeIncludeEntry as (
  entry: string,
  options: { projectRoot: string; gitAvailable: boolean },
) => EntryVerdict;
const validateWorktreeIncludeContract = core.validateWorktreeIncludeContract as (options: {
  projectRoot: string;
}) => CheckResult;
const validateAgentsByteBudget = core.validateAgentsByteBudget as (options: {
  projectRoot: string;
}) => CheckResult;
const validateWorktreeLocalState = core.validateWorktreeLocalState as (options: {
  projectRoot: string;
}) => CheckResult;

const REPO_ROOT = path.resolve(__dirname, '../..');

interface Fixture {
  root: string;
  cleanup: () => void;
}

/** 构造一个带 `.gitignore` 的最小 git 仓库，作为 ignored 前提的测试底座。 */
function setupGitFixture(gitignoreLines: string[] = ['.env*', 'ignored-dir/']): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worktreeinclude-fixture-'));
  execSync('git init -q', { cwd: root });
  execSync('git config user.email test@example.com', { cwd: root });
  execSync('git config user.name Test', { cwd: root });
  fs.writeFileSync(path.join(root, '.gitignore'), `${gitignoreLines.join('\n')}\n`);
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

/** 非 git 环境（用于验证 ignored 子检查降级为 skip）。 */
function setupPlainFixture(): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'worktreeinclude-plain-'));
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

describe('Feature 239 — .worktreeinclude 内容合同（FR-001）', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = setupGitFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  describe('8 类拒绝 reason', () => {
    it.each([
      ['absolute-path', '/etc/passwd'],
      ['dot-dot-segment', '../shared-secret'],
      ['glob-char', '*.env'],
      ['negation-prefix', '!keep.env'],
      ['escape-char', 'path\\to.env'],
      ['trailing-slash', '.env.local/'],
    ])('语法类拒绝：%s ← %s', (reason, entry) => {
      const result = validateWorktreeIncludeEntry(entry, {
        projectRoot: fixture.root,
        gitAvailable: true,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe(reason);
    });

    it('存在性类拒绝：not-ignored ← 未被 gitignore 收录的路径', () => {
      fs.writeFileSync(path.join(fixture.root, 'tracked.txt'), 'content');
      const result = validateWorktreeIncludeEntry('tracked.txt', {
        projectRoot: fixture.root,
        gitAvailable: true,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('not-ignored');
    });

    it('存在性类拒绝：not-regular-file ← 已 ignored 但实际是目录', () => {
      fs.mkdirSync(path.join(fixture.root, 'ignored-dir'));
      const result = validateWorktreeIncludeEntry('ignored-dir', {
        projectRoot: fixture.root,
        gitAvailable: true,
      });
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('not-regular-file');
    });

    it('语法类拒绝优先于存在性/ignored 类：尾斜杠目录条目判 trailing-slash 而非 not-regular-file', () => {
      // `.env.local/` 会通过 git check-ignore（`.env*` 命中），且尾斜杠使存在性检查失真，
      // 必须在任何存在性检查之前结构性拒绝。
      fs.mkdirSync(path.join(fixture.root, '.env.local'));
      const result = validateWorktreeIncludeEntry('.env.local/', {
        projectRoot: fixture.root,
        gitAvailable: true,
      });
      expect(result.reason).toBe('trailing-slash');
    });
  });

  describe('1 类合法条目通过', () => {
    it('已 ignored 的常规文件通过', () => {
      fs.writeFileSync(path.join(fixture.root, '.env.local'), 'SECRET=1');
      const result = validateWorktreeIncludeEntry('.env.local', {
        projectRoot: fixture.root,
        gitAvailable: true,
      });
      expect(result).toEqual({ valid: true });
    });

    it('FR-001(c)：路径不存在不视为违规（干净 checkout 里 ignored 文件缺席是常态）', () => {
      expect(fs.existsSync(path.join(fixture.root, '.env.local'))).toBe(false);
      const result = validateWorktreeIncludeEntry('.env.local', {
        projectRoot: fixture.root,
        gitAvailable: true,
      });
      expect(result.valid).toBe(true);
    });

    it('非 git 环境下 not-ignored 子检查降级跳过，合法语法条目仍通过', () => {
      const result = validateWorktreeIncludeEntry('.env.local', {
        projectRoot: fixture.root,
        gitAvailable: false,
      });
      expect(result.valid).toBe(true);
    });
  });

  describe('parseWorktreeInclude grammar（决策 4 五条）', () => {
    it('跳过空行与行首 # 注释，保留行内 #，接受无末行换行', () => {
      expect(parseWorktreeInclude('# comment\n\n.env.local\npath.env # inline')).toEqual([
        '.env.local',
        'path.env # inline',
      ]);
    });

    it('剥单个 BOM 与单个尾部 \\r，不做其他 trim', () => {
      expect(parseWorktreeInclude('﻿.env.local\r\n  spaced.env  \n')).toEqual([
        '.env.local',
        '  spaced.env  ',
      ]);
    });
  });

  describe('validateWorktreeIncludeContract', () => {
    it('本仓库真实 .worktreeinclude 满足合同（status=pass，零 errors）', () => {
      const result = validateWorktreeIncludeContract({ projectRoot: REPO_ROOT });
      expect(result.errors).toEqual([]);
      expect(result.status).toBe('pass');
    });

    it('本仓库真实 .worktreeinclude 的每一行都逐条通过条目校验', () => {
      const content = fs.readFileSync(path.join(REPO_ROOT, '.worktreeinclude'), 'utf-8');
      const entries = parseWorktreeInclude(content);
      expect(entries.length).toBeGreaterThan(0);
      for (const entry of entries) {
        expect(
          validateWorktreeIncludeEntry(entry, { projectRoot: REPO_ROOT, gitAvailable: true }),
        ).toEqual({ valid: true });
      }
    });

    it('.worktreeinclude 文件缺失 → fail（非 git 环境也不豁免）', () => {
      const plain = setupPlainFixture();
      try {
        const result = validateWorktreeIncludeContract({ projectRoot: plain.root });
        expect(result.status).toBe('fail');
        expect(result.errors.length).toBeGreaterThan(0);
      } finally {
        plain.cleanup();
      }
    });

    it('非法条目 → fail 且 error 文案含精确 reason', () => {
      fs.writeFileSync(path.join(fixture.root, '.worktreeinclude'), '../shared-secret\n');
      const result = validateWorktreeIncludeContract({ projectRoot: fixture.root });
      expect(result.status).toBe('fail');
      expect(result.errors.join('\n')).toContain('dot-dot-segment');
    });

    it('非 git 环境：ignored 子检查记为 skip（不进 warnings/errors，不拖累整体状态）', () => {
      const plain = setupPlainFixture();
      try {
        fs.writeFileSync(path.join(plain.root, '.worktreeinclude'), '.env.local\n');
        const result = validateWorktreeIncludeContract({ projectRoot: plain.root });
        expect(result.status).toBe('pass');
        expect(result.warnings).toEqual([]);
        expect(result.errors).toEqual([]);
        const skipped = result.checks.filter((check) => check.status === 'skip');
        expect(skipped.length).toBeGreaterThan(0);
        expect(JSON.stringify(skipped)).toContain('not-a-git-repo');
      } finally {
        plain.cleanup();
      }
    });
  });
});

describe('Feature 239 — AGENTS byte budget（FR-008）', () => {
  let fixture: Fixture;

  beforeEach(() => {
    fixture = setupPlainFixture();
  });

  afterEach(() => {
    fixture.cleanup();
  });

  it('预算常量为 Codex project_doc_max_bytes 默认值 32768', () => {
    expect(AGENTS_BYTE_BUDGET).toBe(32768);
  });

  it('本仓库 AGENTS.md 现状通过（当前基线 23346 bytes）', () => {
    const result = validateAgentsByteBudget({ projectRoot: REPO_ROOT });
    expect(result.errors).toEqual([]);
    expect(result.status).toBe('pass');
    expect(fs.statSync(path.join(REPO_ROOT, 'AGENTS.md')).size).toBeLessThanOrEqual(
      AGENTS_BYTE_BUDGET,
    );
  });

  it('人为构造超限 AGENTS.md → fail', () => {
    fs.writeFileSync(path.join(fixture.root, 'AGENTS.md'), 'x'.repeat(AGENTS_BYTE_BUDGET + 1));
    const result = validateAgentsByteBudget({ projectRoot: fixture.root });
    expect(result.status).toBe('fail');
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('按 max 不按 sum：两个文件各 20000 bytes（和超限）仍通过', () => {
    fs.writeFileSync(path.join(fixture.root, 'AGENTS.md'), 'x'.repeat(20000));
    fs.writeFileSync(path.join(fixture.root, 'AGENTS.override.md'), 'y'.repeat(20000));
    const result = validateAgentsByteBudget({ projectRoot: fixture.root });
    expect(result.status).toBe('pass');
    expect(result.errors).toEqual([]);
  });

  it('AGENTS.override.md 单独超限 → fail（不能因为只查了 AGENTS.md 就放过）', () => {
    fs.writeFileSync(path.join(fixture.root, 'AGENTS.md'), 'x'.repeat(100));
    fs.writeFileSync(
      path.join(fixture.root, 'AGENTS.override.md'),
      'y'.repeat(AGENTS_BYTE_BUDGET + 1),
    );
    const result = validateAgentsByteBudget({ projectRoot: fixture.root });
    expect(result.status).toBe('fail');
    expect(result.errors.join('\n')).toContain('AGENTS.override.md');
  });

  it('AGENTS.override.md 不存在时不参与判定（仅校验 AGENTS.md）', () => {
    fs.writeFileSync(path.join(fixture.root, 'AGENTS.md'), 'x'.repeat(100));
    const result = validateAgentsByteBudget({ projectRoot: fixture.root });
    expect(result.status).toBe('pass');
  });
});

describe('Feature 239 — validateWorktreeLocalState 聚合入口（批 4 repo:check 第 14 族复用）', () => {
  it('本仓库聚合结果为 pass，且同时包含两个子校验的 checks', () => {
    const result = validateWorktreeLocalState({ projectRoot: REPO_ROOT });
    expect(result.errors).toEqual([]);
    expect(result.status).toBe('pass');
    const ids = result.checks.map((check) => check.id);
    expect(ids.some((id) => id.includes('worktreeinclude'))).toBe(true);
    expect(ids.some((id) => id.includes('agents'))).toBe(true);
  });

  it('聚合结果保持三段式形状（status/checks/warnings/errors）', () => {
    const result = validateWorktreeLocalState({ projectRoot: REPO_ROOT });
    expect(Array.isArray(result.checks)).toBe(true);
    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
    expect(['pass', 'warn', 'skip', 'fail']).toContain(result.status);
  });
});
