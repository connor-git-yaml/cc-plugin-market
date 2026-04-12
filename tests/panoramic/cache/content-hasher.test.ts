/**
 * ContentHasher 单元测试
 * 覆盖哈希一致性、.md frontmatter 跳过边界规则、hashFiles 顺序无关性
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { ContentHasherImpl } from '../../../src/panoramic/cache/content-hasher.js';

/** 创建临时目录 */
function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'content-hasher-test-'));
}

/** 递归删除目录 */
function removeTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('ContentHasherImpl', () => {
  const tmpDirs: string[] = [];
  const hasher = new ContentHasherImpl();

  afterEach(() => {
    for (const dir of tmpDirs) {
      removeTmpDir(dir);
    }
    tmpDirs.length = 0;
  });

  describe('hashFile', () => {
    it('相同内容 hash 相同', async () => {
      const tmpDir = createTmpDir();
      tmpDirs.push(tmpDir);
      const file1 = path.join(tmpDir, 'a.ts');
      const file2 = path.join(tmpDir, 'b.ts');
      fs.writeFileSync(file1, 'const x = 1;');
      fs.writeFileSync(file2, 'const x = 1;');

      // 不同路径的相同内容会产生不同 hash（因为 hash 包含 filePath）
      const hash1 = await hasher.hashFile(file1);
      const hash2 = await hasher.hashFile(file2);
      expect(hash1).not.toBe(hash2);

      // 相同路径的相同文件 hash 一致
      const hash1Again = await hasher.hashFile(file1);
      expect(hash1).toBe(hash1Again);
    });

    it('.md frontmatter 修改不影响 hash（正文相同）', async () => {
      const tmpDir = createTmpDir();
      tmpDirs.push(tmpDir);
      const mdFile = path.join(tmpDir, 'doc.md');

      // 写入带 frontmatter 的文件
      fs.writeFileSync(mdFile, '---\ntitle: v1\nupdated: 2024-01-01\n---\n# Hello\nBody text');
      const hash1 = await hasher.hashFile(mdFile);

      // 修改 frontmatter，正文不变
      fs.writeFileSync(mdFile, '---\ntitle: v2\nupdated: 2026-04-12\n---\n# Hello\nBody text');
      const hash2 = await hasher.hashFile(mdFile);

      expect(hash1).toBe(hash2);
    });

    it('.md 正文变化后 hash 变化', async () => {
      const tmpDir = createTmpDir();
      tmpDirs.push(tmpDir);
      const mdFile = path.join(tmpDir, 'doc.md');

      fs.writeFileSync(mdFile, '---\ntitle: test\n---\n# Hello\nBody text v1');
      const hash1 = await hasher.hashFile(mdFile);

      fs.writeFileSync(mdFile, '---\ntitle: test\n---\n# Hello\nBody text v2');
      const hash2 = await hasher.hashFile(mdFile);

      expect(hash1).not.toBe(hash2);
    });

    it('无 frontmatter 的 .md 哈希全文', async () => {
      const tmpDir = createTmpDir();
      tmpDirs.push(tmpDir);
      const mdFile = path.join(tmpDir, 'no-fm.md');

      fs.writeFileSync(mdFile, '# No frontmatter\nJust content');
      const hash1 = await hasher.hashFile(mdFile);

      // 修改内容后 hash 应变化
      fs.writeFileSync(mdFile, '# No frontmatter\nJust content modified');
      const hash2 = await hasher.hashFile(mdFile);

      expect(hash1).not.toBe(hash2);
    });

    it('未闭合 frontmatter 降级哈希全文', async () => {
      const tmpDir = createTmpDir();
      tmpDirs.push(tmpDir);
      const mdFile = path.join(tmpDir, 'unclosed.md');

      // 创建超过 50 行但无闭合 --- 的文件
      const lines = ['---', 'title: test'];
      for (let i = 0; i < 55; i++) {
        lines.push(`line${i}: value`);
      }
      lines.push('# Content');
      fs.writeFileSync(mdFile, lines.join('\n'));
      const hash1 = await hasher.hashFile(mdFile);

      // 修改 frontmatter 区域（因为是全文 hash，应该变化）
      lines[1] = 'title: changed';
      fs.writeFileSync(mdFile, lines.join('\n'));
      const hash2 = await hasher.hashFile(mdFile);

      expect(hash1).not.toBe(hash2);
    });

    it('正文含 --- 水平线不误判为 frontmatter 闭合', async () => {
      const tmpDir = createTmpDir();
      tmpDirs.push(tmpDir);
      const mdFile = path.join(tmpDir, 'with-hr.md');

      // frontmatter 闭合在第 3 行，正文中的 --- 水平线不应影响 hash
      fs.writeFileSync(mdFile, '---\ntitle: test\n---\n# Heading\n\n---\n\nMore content');
      const hash1 = await hasher.hashFile(mdFile);

      // 修改 frontmatter 但不改正文（含 ---）
      fs.writeFileSync(mdFile, '---\ntitle: changed\n---\n# Heading\n\n---\n\nMore content');
      const hash2 = await hasher.hashFile(mdFile);

      // frontmatter 变化不影响 hash
      expect(hash1).toBe(hash2);
    });
  });

  describe('hashFiles', () => {
    it('对入参顺序不敏感（同集合不同顺序结果相同）', async () => {
      const tmpDir = createTmpDir();
      tmpDirs.push(tmpDir);
      const file1 = path.join(tmpDir, 'x.ts');
      const file2 = path.join(tmpDir, 'y.ts');
      const file3 = path.join(tmpDir, 'z.ts');
      fs.writeFileSync(file1, 'export const x = 1;');
      fs.writeFileSync(file2, 'export const y = 2;');
      fs.writeFileSync(file3, 'export const z = 3;');

      const hash1 = await hasher.hashFiles([file1, file2, file3]);
      const hash2 = await hasher.hashFiles([file3, file1, file2]);
      const hash3 = await hasher.hashFiles([file2, file3, file1]);

      expect(hash1).toBe(hash2);
      expect(hash2).toBe(hash3);
    });
  });

  describe('hashContent', () => {
    it('相同内容返回相同 hash', () => {
      const hash1 = hasher.hashContent('test content');
      const hash2 = hasher.hashContent('test content');
      expect(hash1).toBe(hash2);
    });

    it('不同内容返回不同 hash', () => {
      const hash1 = hasher.hashContent('content a');
      const hash2 = hasher.hashContent('content b');
      expect(hash1).not.toBe(hash2);
    });
  });
});
