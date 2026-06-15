/**
 * F190 T053 — SC-009 降级矩阵：库缺失/损坏/单库 逐条断言不崩溃
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildKb } from '../../src/scaffold-kb/index.js';
import { loadKbContext } from '../../src/kb-mcp/lib/kb-locator.js';

let workdir: string;
let vendorKb: string;
let projectKb: string;

beforeAll(async () => {
  workdir = mkdtempSync(join(tmpdir(), 'kb-degrade-'));
  const vDocs = join(workdir, 'vdocs');
  mkdirSync(vDocs, { recursive: true });
  writeFileSync(join(vDocs, 'a.md'), '# A\n\n厂商文档内容。\n');
  vendorKb = join(workdir, 'vkb');
  await buildKb({ noLlm: true, dirPath: vDocs, outputPath: vendorKb, builtAt: 'B' });

  const pDocs = join(workdir, 'pdocs');
  mkdirSync(pDocs, { recursive: true });
  writeFileSync(join(pDocs, 'p.md'), '# P\n\n项目文档内容。\n');
  projectKb = join(workdir, 'pkb');
  await buildKb({ noLlm: true, dirPath: pDocs, outputPath: projectKb, builtAt: 'B' });
});

afterAll(() => rmSync(workdir, { recursive: true, force: true }));

describe('SC-009 降级矩阵', () => {
  it('两库均不存在 → KB_NOT_FOUND', async () => {
    const r = await loadKbContext({ vendorKbPath: join(workdir, 'nope'), projectKbPath: join(workdir, 'nope2') });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('KB_NOT_FOUND');
  });

  it('厂商库不存在、仅项目库存在 → 仅查项目库（非错误）', async () => {
    const r = await loadKbContext({ vendorKbPath: join(workdir, 'nope'), projectKbPath: projectKb });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.context.sourcesAvailable).toEqual(['project']);
  });

  it('项目库不存在、厂商库存在 → 仅查厂商库', async () => {
    const r = await loadKbContext({ vendorKbPath: vendorKb });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.context.sourcesAvailable).toEqual(['vendor']);
  });

  it('chunks.sqlite 损坏 → KB_CORRUPT', async () => {
    const corruptKb = join(workdir, 'corrupt');
    mkdirSync(corruptKb, { recursive: true });
    writeFileSync(join(corruptKb, 'chunks.sqlite'), Buffer.from('这不是合法的 sqlite 文件'));
    const r = await loadKbContext({ vendorKbPath: corruptKb });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('KB_CORRUPT');
  });

  it('两库均存在 → 双库可用', async () => {
    const r = await loadKbContext({ vendorKbPath: vendorKb, projectKbPath: projectKb });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.context.sourcesAvailable.sort()).toEqual(['project', 'vendor']);
  });
});
