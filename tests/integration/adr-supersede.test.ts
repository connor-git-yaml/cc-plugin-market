/**
 * Feature 140 T44 — ADR migration（旧 ADR supersede + anti-regression）集成测试
 *
 * 覆盖 spec FR-006：v4.1.0 升级时旧 ADR 自动追加 supersede notice。
 *
 * **关键 anti-regression 断言**（修复 Codex review finding 1 防止复现）：
 * 新生成的 proposed/accepted 状态 ADR 在 migrate 后**绝不能**被改成 superseded。
 * 这是 spec T43/T44 强制要求的最高优先级断言。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { migrateOldAdrs } from '../../src/panoramic/pipelines/adr-migration.js';

let tmpDir: string;
let adrDir: string;
beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-supersede-'));
  adrDir = path.join(tmpDir, 'docs', 'adr');
  fs.mkdirSync(adrDir, { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeAdr(name: string, frontmatter: string, body = '# ADR Body\n'): string {
  const filePath = path.join(adrDir, name);
  const content = `---\n${frontmatter}\n---\n${body}`;
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

function readFrontmatter(filePath: string): Record<string, string> {
  const content = fs.readFileSync(filePath, 'utf-8');
  const match = /^---\n([\s\S]*?)\n---\n/.exec(content);
  if (!match) return {};
  const fields: Record<string, string> = {};
  for (const line of match[1]!.split('\n')) {
    const m = /^(\w+)\s*:\s*(.*)$/.exec(line.trim());
    if (m) fields[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '');
  }
  return fields;
}

describe('migrateOldAdrs — Feature 140 FR-006', () => {
  it('case 1: 旧 ADR (无 generatedByModel + status=accepted) → status 改为 superseded + supersededAt 追加', () => {
    const oldPath = writeAdr('adr-001-legacy.md', 'status: accepted\ntitle: 旧 ADR');
    const result = migrateOldAdrs(adrDir, new Set());

    expect(result.superseded).toBe(1);
    expect(result.supersededFiles).toContain(oldPath);

    const fm = readFrontmatter(oldPath);
    expect(fm.status).toBe('superseded');
    expect(fm.supersededAt).toBe('4.1.0');
  });

  it('case 2 (KEY ANTI-REGRESSION): 新生成 ADR 在 currentBatchAdrPaths 中 → 不被 supersede', () => {
    // 模拟当前批次新产出的 ADR（无 generatedByModel 但在 currentBatchAdrPaths）
    const newPath = writeAdr('adr-001-new.md', 'status: proposed\ntitle: 当前批次 ADR');
    // 旧 ADR
    const oldPath = writeAdr('adr-002-legacy.md', 'status: accepted\ntitle: 旧 ADR');

    // 把 newPath 加入当前批次集合（即便没 generatedByModel）
    const currentBatch = new Set([newPath]);
    const result = migrateOldAdrs(adrDir, currentBatch);

    expect(result.superseded).toBe(1);
    expect(result.skippedCurrentBatch).toBe(1);
    expect(result.supersededFiles).toContain(oldPath);
    expect(result.supersededFiles).not.toContain(newPath); // 关键

    // 关键 anti-regression 断言：新 ADR 状态保持不变
    const newFm = readFrontmatter(newPath);
    expect(newFm.status).toBe('proposed');
    expect(newFm.supersededAt).toBeUndefined();

    const oldFm = readFrontmatter(oldPath);
    expect(oldFm.status).toBe('superseded');
  });

  it('case 3: ADR 已含 generatedByModel 字段 → 视为 v4.1+ 新格式，不 supersede', () => {
    const newPath = writeAdr(
      'adr-001-v41.md',
      'status: accepted\ntitle: v4.1 ADR\ngeneratedByModel:\n  map: claude-sonnet-4-6\n  reduce: claude-opus-4-7',
    );
    const result = migrateOldAdrs(adrDir, new Set());

    expect(result.skippedNewFormat).toBe(1);
    expect(result.superseded).toBe(0);

    const fm = readFrontmatter(newPath);
    expect(fm.status).toBe('accepted'); // 保持不变
  });

  it('case 4: ADR 已是 superseded 状态 → 不重复处理', () => {
    writeAdr('adr-001-old.md', 'status: superseded\ntitle: 已废弃');
    const result = migrateOldAdrs(adrDir, new Set());

    expect(result.alreadySuperseded).toBe(1);
    expect(result.superseded).toBe(0);
  });

  it('case 5: index.md / _PIPELINE_*.md / _TEMP.md 等 meta 文件被跳过', () => {
    writeAdr('index.md', 'status: accepted\ntitle: index');
    writeAdr('_PIPELINE_DISABLED.md', 'status: accepted\ntitle: meta');
    writeAdr('_PIPELINE_FAILED.md', 'status: accepted\ntitle: meta2');
    const realOld = writeAdr('adr-001-real.md', 'status: accepted\ntitle: real');

    const result = migrateOldAdrs(adrDir, new Set());

    // index.md 和 _* 都跳过；只 adr-001-real 进入处理
    expect(result.totalFiles).toBe(1);
    expect(result.superseded).toBe(1);
    expect(result.supersededFiles).toContain(realOld);
  });

  it('case 6: 文件无 frontmatter → 跳过（不报错）', () => {
    const noFm = path.join(adrDir, 'adr-001-broken.md');
    fs.writeFileSync(noFm, '# Just markdown\n\nNo frontmatter here.', 'utf-8');

    const result = migrateOldAdrs(adrDir, new Set());

    expect(result.skippedParseError).toBe(1);
    expect(result.superseded).toBe(0);
  });

  it('case 7: adrDir 不存在 → 返回空结果，不抛错', () => {
    const result = migrateOldAdrs(path.join(tmpDir, 'nonexistent'), new Set());
    expect(result.totalFiles).toBe(0);
    expect(result.superseded).toBe(0);
  });

  it('case 7b: generatedByModel 字段有但值为空 / 损坏 → 仍 supersede（修复 Codex W-4）', () => {
    // generatedByModel 字段存在但值为空字符串（不合规）
    const path1 = writeAdr('adr-001-empty.md', 'status: accepted\ntitle: 有空 generatedByModel\ngeneratedByModel:');
    // generatedByModel 字段值是空对象 {}
    const path2 = writeAdr('adr-002-emptyobj.md', 'status: accepted\ntitle: 空对象\ngeneratedByModel: {}');
    // 合规的嵌套对象（含 map / reduce 子字段）— 视为新格式跳过
    const path3 = writeAdr(
      'adr-003-valid.md',
      'status: accepted\ntitle: 合规\ngeneratedByModel:\n  map: claude-sonnet-4-6\n  reduce: claude-opus-4-7',
    );

    const result = migrateOldAdrs(adrDir, new Set());

    // path1 (空值)、path2 (空对象) 应该被视为缺失字段，进入 supersede
    // path3 (合规) 视为新格式，跳过
    expect(result.superseded).toBe(2);
    expect(result.skippedNewFormat).toBe(1);
    expect(result.supersededFiles).toContain(path1);
    expect(result.supersededFiles).toContain(path2);
    expect(result.supersededFiles).not.toContain(path3);
  });

  it('case 8 (KEY ANTI-REGRESSION 加强版): 多个旧 ADR + 多个新 ADR 混合 → 各自正确处理', () => {
    // 3 个新 ADR + 2 个旧 ADR + 1 个已 superseded
    const new1 = writeAdr('adr-001-new.md', 'status: proposed\ntitle: 新 1');
    const new2 = writeAdr('adr-002-new.md', 'status: accepted\ntitle: 新 2');
    const new3 = writeAdr('adr-003-new.md', 'status: proposed\ntitle: 新 3');
    const old1 = writeAdr('adr-100-old.md', 'status: accepted\ntitle: 旧 1');
    const old2 = writeAdr('adr-101-old.md', 'status: accepted\ntitle: 旧 2');
    writeAdr('adr-200-already.md', 'status: superseded\ntitle: 已废弃');

    const currentBatch = new Set([new1, new2, new3]);
    const result = migrateOldAdrs(adrDir, currentBatch);

    // 总文件 6，old1+old2 应被 supersede（2），3 个新 ADR 跳过 currentBatch，1 个已 superseded
    expect(result.totalFiles).toBe(6);
    expect(result.superseded).toBe(2);
    expect(result.skippedCurrentBatch).toBe(3);
    expect(result.alreadySuperseded).toBe(1);

    // anti-regression：3 个新 ADR 的 status 全部保持原状
    expect(readFrontmatter(new1).status).toBe('proposed');
    expect(readFrontmatter(new2).status).toBe('accepted');
    expect(readFrontmatter(new3).status).toBe('proposed');
    expect(readFrontmatter(new1).supersededAt).toBeUndefined();
    expect(readFrontmatter(new2).supersededAt).toBeUndefined();
    expect(readFrontmatter(new3).supersededAt).toBeUndefined();

    // 旧 ADR 被正确 supersede
    expect(readFrontmatter(old1).status).toBe('superseded');
    expect(readFrontmatter(old2).status).toBe('superseded');
    expect(readFrontmatter(old1).supersededAt).toBe('4.1.0');
    expect(readFrontmatter(old2).supersededAt).toBe('4.1.0');
  });
});
