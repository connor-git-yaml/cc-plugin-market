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

  it('CRITICAL-1：helper 脚本路径含空格/非 ASCII 时直接执行仍产出非空 body + 64 位 sha', () => {
    // 复现「安装路径含空格/非 ASCII → isDirectExecution 误判 → main() 不跑 → 空 stdout 退出码 0」回归。
    // 把 helper copy 到含空格 + 非 ASCII 的临时目录，以子进程方式 `node extract-wrapper-body.mjs <src>` 调用。
    const tmp = mkdtempSync(join(tmpdir(), 'wrapper-spacepath-'));
    const weirdDir = join(tmp, '有 空格 dir', 'lib');
    mkdirSync(weirdDir, { recursive: true });
    const helperCopy = join(weirdDir, 'extract-wrapper-body.mjs');
    cpSync(
      join(REPO_ROOT, 'plugins', 'spec-driver', 'scripts', 'lib', 'extract-wrapper-body.mjs'),
      helperCopy,
    );
    const src = join(tmp, 'SKILL.md');
    writeFileSync(src, '---\nname: x\nmodel: opus\n---\n\n# 标题\n正文 body 行\n', 'utf-8');

    // body 输出非空
    const bodyOut = execFileSync('node', [helperCopy, src], { encoding: 'utf-8', timeout: 30_000 });
    expect(bodyOut.length).toBeGreaterThan(0);
    expect(bodyOut).toContain('正文 body 行');
    expect(bodyOut).not.toContain('name: x');

    // sha 输出为 64 位十六进制，且与 in-process computeWrapperBodySha256 一致
    const shaOut = execFileSync('node', [helperCopy, src, '--sha256'], {
      encoding: 'utf-8',
      timeout: 30_000,
    });
    expect(shaOut).toMatch(/^[0-9a-f]{64}$/);
    expect(shaOut).toBe(computeWrapperBodySha256(src));

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

  it('WARNING-1：source 无尾换行 → helper body 仍以单个 \\n 收尾（对齐 awk ORS）', () => {
    // awk 对每条 print 的记录补 ORS=\n，故即便 source 末尾无 \n，提取出的 body 也应以 \n 收尾。
    const tmp = mkdtempSync(join(tmpdir(), 'wrapper-noeol-'));
    const withEol = join(tmp, 'with.md');
    const noEol = join(tmp, 'no.md');
    writeFileSync(withEol, '---\nname: x\n---\n\nline A\nlast line\n', 'utf-8');
    writeFileSync(noEol, '---\nname: x\n---\n\nline A\nlast line', 'utf-8'); // 无尾换行
    const bodyWith = extractWrapperBody(withEol);
    const bodyNo = extractWrapperBody(noEol);
    // 尾换行被规范化：两者 body 完全一致（sha 相等）
    expect(bodyNo.endsWith('\n')).toBe(true);
    expect(bodyNo).toBe(bodyWith);
    expect(computeWrapperBodySha256(noEol)).toBe(computeWrapperBodySha256(withEol));
    rmSync(tmp, { recursive: true, force: true });
  });

  it('WARNING-1：CRLF source → frontmatter 正确剥除且 body 与 LF 版逐字节一致', () => {
    // CRLF 文件的 "---\r" 不等于 "---"，旧实现会导致 frontmatter 完全不剥除；
    // 规范化 \r\n→\n 后应与等价 LF 文件 sha 相等。
    const tmp = mkdtempSync(join(tmpdir(), 'wrapper-crlf-'));
    const lf = join(tmp, 'lf.md');
    const crlf = join(tmp, 'crlf.md');
    const lines = ['---', 'name: x', 'model: opus', '---', '', '# 标题', '正文行'];
    writeFileSync(lf, lines.join('\n') + '\n', 'utf-8');
    writeFileSync(crlf, lines.join('\r\n') + '\r\n', 'utf-8');
    const bodyCrlf = extractWrapperBody(crlf);
    // frontmatter 已剥除
    expect(bodyCrlf).not.toContain('name: x');
    expect(bodyCrlf).not.toContain('model: opus');
    // 正文保留且无残留 \r
    expect(bodyCrlf).toContain('正文行');
    expect(bodyCrlf).not.toContain('\r');
    // 与 LF 版逐字节一致
    expect(computeWrapperBodySha256(crlf)).toBe(computeWrapperBodySha256(lf));
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
