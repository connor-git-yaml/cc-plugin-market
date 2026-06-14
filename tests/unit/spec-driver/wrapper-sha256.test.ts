/**
 * F186 T2 — wrapper body sha256 指纹校验
 *
 * 覆盖 4 部分：
 *   - helper 单测：extractWrapperBody（frontmatter 剥除 + 9 条替换）+ computeWrapperBodySha256
 *   - 用例 1（漂移）：改 source 一行 → validateWrapperSources status=fail（sha 不匹配）
 *   - 用例 2（正常）：install 后立即校验 → status=pass
 *   - 用例 3（缺 sha）：删掉 wrapper 的 Source SHA256 行 → status=fail（FINAL CRITICAL-2：缺即 fail）
 *
 * 策略：把 plugin 树 + .claude-plugin copy 到临时 project，跑 codex-skills.sh install
 * 生成带 sha 的 8 个 wrapper，再对临时 project 调 validateWrapperSources。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { appendFileSync, cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  extractWrapperBody,
  computeWrapperBodySha256,
} from '../../../plugins/spec-driver/scripts/lib/extract-wrapper-body.mjs';
import { validateWrapperSources } from '../../../plugins/spec-driver/scripts/validate-wrapper-sources.mjs';

const REPO_ROOT = resolve('.');

function runInstall(projectRoot: string): void {
  execFileSync(
    'bash',
    [join(projectRoot, 'plugins', 'spec-driver', 'scripts', 'codex-skills.sh'), 'install'],
    { cwd: projectRoot, encoding: 'utf-8', timeout: 30_000, env: { ...process.env, CODEX_SKILL_PROJECT_ROOT: projectRoot } },
  );
}

function copyRequiredTree(projectRoot: string): void {
  mkdirSync(join(projectRoot, 'plugins'), { recursive: true });
  cpSync(join(REPO_ROOT, 'plugins', 'spec-driver'), join(projectRoot, 'plugins', 'spec-driver'), {
    recursive: true,
  });
  cpSync(join(REPO_ROOT, '.claude-plugin'), join(projectRoot, '.claude-plugin'), { recursive: true });
}

describe('F186 T2 — extract-wrapper-body helper', () => {
  it('extractWrapperBody 剥除 frontmatter 且应用 runtime text 替换', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wrapper-helper-'));
    const src = join(tmp, 'SKILL.md');
    writeFileSync(
      src,
      [
        '---',
        'name: demo',
        'model: opus',
        '---',
        '',
        '# Body 标题',
        '执行 /spec-driver:spec-driver-feature 流程。',
        '使用 Claude Code 的 Task tool 委派。',
      ].join('\n'),
      'utf-8',
    );
    const body = extractWrapperBody(src);
    // frontmatter 已剥除
    expect(body).not.toContain('name: demo');
    expect(body).not.toContain('model: opus');
    // 9 条替换生效
    expect(body).toContain('$spec-driver-feature');
    expect(body).not.toContain('/spec-driver:spec-driver-feature');
    expect(body).toContain('Task tool（Codex 下按内联子代理执行）');
    expect(body).not.toContain('Claude Code 的 Task tool');
    rmSync(tmp, { recursive: true, force: true });
  });

  it('computeWrapperBodySha256 = sha256(extractWrapperBody) 且稳定', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wrapper-helper-sha-'));
    const src = join(tmp, 'SKILL.md');
    writeFileSync(src, '---\nname: x\n---\n\nhello body\n', 'utf-8');
    const expected = createHash('sha256').update(extractWrapperBody(src), 'utf-8').digest('hex');
    expect(computeWrapperBodySha256(src)).toBe(expected);
    // 同源稳定
    expect(computeWrapperBodySha256(src)).toBe(computeWrapperBodySha256(src));
    rmSync(tmp, { recursive: true, force: true });
  });

  it('source 改一行 → sha 改变', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'wrapper-helper-drift-'));
    const src = join(tmp, 'SKILL.md');
    writeFileSync(src, '---\nname: x\n---\n\nline A\n', 'utf-8');
    const sha1 = computeWrapperBodySha256(src);
    writeFileSync(src, '---\nname: x\n---\n\nline B\n', 'utf-8');
    const sha2 = computeWrapperBodySha256(src);
    expect(sha1).not.toBe(sha2);
    rmSync(tmp, { recursive: true, force: true });
  });
});

describe('F186 T2 — validateWrapperSources body sha256 门禁', () => {
  let projectRoot: string;

  beforeEach(() => {
    projectRoot = mkdtempSync(join(tmpdir(), 'wrapper-sha256-'));
    copyRequiredTree(projectRoot);
    runInstall(projectRoot);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
  });

  it('用例 2（正常）：install 后立即校验 → pass，且 codex-wrapper-markers pass', () => {
    const result = validateWrapperSources({ projectRoot });
    expect(result.status).toBe('pass');
    const markers = result.checks.find((c: { id: string }) => c.id === 'codex-wrapper-markers');
    expect(markers?.status).toBe('pass');
  });

  it('用例 1（漂移）：改 source 一行 → fail（sha 不匹配）', () => {
    const sourcePath = join(
      projectRoot,
      'plugins',
      'spec-driver',
      'skills',
      'spec-driver-feature',
      'SKILL.md',
    );
    appendFileSync(sourcePath, '\n<!-- F186 drift probe -->\n', 'utf-8');
    const result = validateWrapperSources({ projectRoot });
    expect(result.status).toBe('fail');
    expect(result.errors.join('\n')).toContain('sha256 不匹配');
  });

  it('用例 3（缺 sha）：删 wrapper 的 Source SHA256 行 → fail', () => {
    const wrapperPath = join(
      projectRoot,
      '.codex',
      'skills',
      'spec-driver-doc',
      'SKILL.md',
    );
    const content = readFileSync(wrapperPath, 'utf-8')
      .split('\n')
      .filter((line) => !line.startsWith('- Source SHA256:'))
      .join('\n');
    writeFileSync(wrapperPath, content, 'utf-8');

    const result = validateWrapperSources({ projectRoot });
    expect(result.status).toBe('fail');
    expect(result.errors.join('\n')).toContain('Source SHA256');
  });
});
