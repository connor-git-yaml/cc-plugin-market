/**
 * writeAtomicJson 单元测试
 * 覆盖正常写入、目录自动创建、JSON 缩进、.tmp 残留覆盖
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { writeAtomicJson } from '../../src/utils/atomic-write.js';

/** 创建临时目录 */
function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-write-test-'));
}

/** 递归删除目录 */
function removeTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('writeAtomicJson', () => {
  const tmpDirs: string[] = [];

  afterEach(() => {
    for (const dir of tmpDirs) {
      removeTmpDir(dir);
    }
    tmpDirs.length = 0;
  });

  it('正常写入后内容正确', () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'test.json');
    const data = { key: 'value', num: 42 };

    writeAtomicJson(filePath, data);

    const content = fs.readFileSync(filePath, 'utf-8');
    expect(JSON.parse(content)).toEqual(data);
  });

  it('目录不存在时自动创建', () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'nested', 'deep', 'test.json');
    const data = { nested: true };

    writeAtomicJson(filePath, data);

    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(JSON.parse(content)).toEqual(data);
  });

  it('JSON 使用 2 空格缩进', () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'indent.json');
    const data = { a: { b: 1 } };

    writeAtomicJson(filePath, data);

    const content = fs.readFileSync(filePath, 'utf-8');
    // 验证 2 空格缩进
    expect(content).toBe(JSON.stringify(data, null, 2));
  });

  it('.tmp 残留场景：已存在的 .tmp 文件被覆盖', () => {
    const tmpDir = createTmpDir();
    tmpDirs.push(tmpDir);
    const filePath = path.join(tmpDir, 'overwrite.json');
    const tmpPath = `${filePath}.tmp`;

    // 模拟残留 .tmp
    fs.writeFileSync(tmpPath, '{"old": true}', 'utf-8');

    const data = { new: true };
    writeAtomicJson(filePath, data);

    // 最终文件正确
    const content = fs.readFileSync(filePath, 'utf-8');
    expect(JSON.parse(content)).toEqual(data);
    // .tmp 不再存在（被 rename 掉了）
    expect(fs.existsSync(tmpPath)).toBe(false);
  });
});
