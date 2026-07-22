/**
 * `scripts/lib/spec-drift-paths.mjs` 单测（W-7 symlink 逃逸闭合）。
 *
 * 词法 containment 不足以保证安全：本仓 worktree 的 `node_modules` 本身就是
 * 指向主仓库的软链，`node_modules/x.ts` 词法在 projectRoot 内但实际读的是工作树之外。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// @ts-expect-error —— .mjs 治理脚本无类型声明
import { resolveWithinProject } from '../../scripts/lib/spec-drift-paths.mjs';

type Resolved = { ok: boolean; absPath?: string; reason?: string };

let tmpRoot: string;
let projectRoot: string;
let outsideDir: string;

beforeAll(() => {
  tmpRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'drift-paths-')));
  projectRoot = path.join(tmpRoot, 'project');
  outsideDir = path.join(tmpRoot, 'outside');
  fs.mkdirSync(projectRoot, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });

  fs.writeFileSync(path.join(projectRoot, 'inside.ts'), 'export const a = 1;\n', 'utf8');
  fs.writeFileSync(path.join(outsideDir, 'secret.ts'), 'export const b = 2;\n', 'utf8');

  // 单文件软链 + 目录软链两种逃逸形态
  fs.symlinkSync(path.join(outsideDir, 'secret.ts'), path.join(projectRoot, 'escaped.ts'));
  fs.symlinkSync(outsideDir, path.join(projectRoot, 'linked-dir'), 'dir');
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('resolveWithinProject —— 词法 containment', () => {
  it('项目内普通相对路径通过', () => {
    const r = resolveWithinProject(projectRoot, 'inside.ts') as Resolved;
    expect(r.ok).toBe(true);
    expect(r.absPath).toBe(path.join(projectRoot, 'inside.ts'));
  });

  it('`../` 逃逸被拒', () => {
    const r = resolveWithinProject(projectRoot, '../outside/secret.ts') as Resolved;
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/逃逸/);
  });

  it('绝对路径被拒', () => {
    const r = resolveWithinProject(projectRoot, path.join(outsideDir, 'secret.ts')) as Resolved;
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/绝对路径/);
  });

  it('不存在的项目内路径仍按词法放行（交给下游判 orphaned）', () => {
    const r = resolveWithinProject(projectRoot, 'not-created-yet.ts') as Resolved;
    expect(r.ok).toBe(true);
  });
});

describe('resolveWithinProject —— symlink 逃逸（W-7）', () => {
  it('指向项目外文件的软链被拒（realpath containment）', () => {
    const r = resolveWithinProject(projectRoot, 'escaped.ts') as Resolved;
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/symlink/);
  });

  it('穿过指向项目外目录的软链同样被拒', () => {
    const r = resolveWithinProject(projectRoot, 'linked-dir/secret.ts') as Resolved;
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/symlink/);
  });

  it('指向项目内文件的软链仍然放行（不误伤合法软链）', () => {
    const linkPath = path.join(projectRoot, 'alias.ts');
    if (!fs.existsSync(linkPath)) fs.symlinkSync(path.join(projectRoot, 'inside.ts'), linkPath);
    const r = resolveWithinProject(projectRoot, 'alias.ts') as Resolved;
    expect(r.ok).toBe(true);
  });
});
