/**
 * T005：`scripts/lib/spec-drift-lock-io.mjs` 单测（FR-003 / FR-015，plan §8.1/§8.3）。
 *
 * 校验语义为**全字段精确校验**：FR-003 十项必需字段齐全 + 类型正确 + 无被禁字段，
 * 三者任一不满足即 lock-corrupt——漏校验会把"lock 文件坏了"误报成"代码漂移了"。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// @ts-expect-error —— .mjs 治理脚本无类型声明
import {
  readLock,
  writeLockAtomic,
  LOCK_SCHEMA_VERSION,
  createEmptyLock,
  REQUIRED_ANCHOR_FIELDS,
} from '../../scripts/lib/spec-drift-lock-io.mjs';

let tmpRoot: string;
let lockPath: string;

const validAnchor = () => ({
  id: 'a1',
  ref: 'src/foo.ts::bar',
  docPath: 'docs/x.md',
  line: 10,
  symbolId: 'src/foo.ts::bar',
  fingerprint: 'sha256:abc',
  fingerprintVersion: '1',
  normalizationProfile: 'source-slice-whitespace-v1',
  resolvedFrom: 'src/foo.ts::bar',
  matchKind: 'exact',
});

function writeRaw(content: string) {
  fs.writeFileSync(lockPath, content, 'utf8');
}

beforeEach(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-lock-'));
  lockPath = path.join(tmpRoot, '.specify', 'spec-drift.lock.json');
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

describe('readLock —— 非损坏边界', () => {
  it('(a) lock 文件不存在 → 非损坏，视为空锚，exists=false', () => {
    const r = readLock(lockPath);
    expect(r.corrupt).toBe(false);
    expect(r.exists).toBe(false);
    expect(r.anchors).toEqual([]);
  });

  it('(a2) createEmptyLock 产出 {schemaVersion, anchors:[]}', () => {
    expect(createEmptyLock()).toEqual({ schemaVersion: LOCK_SCHEMA_VERSION, anchors: [] });
  });

  it('(b) anchors 空数组 → 非损坏', () => {
    writeRaw(JSON.stringify(createEmptyLock()));
    const r = readLock(lockPath);
    expect(r.corrupt).toBe(false);
    expect(r.anchors).toEqual([]);
  });

  it('合法条目可正常读回', () => {
    writeRaw(JSON.stringify({ schemaVersion: LOCK_SCHEMA_VERSION, anchors: [validAnchor()] }));
    const r = readLock(lockPath);
    expect(r.corrupt).toBe(false);
    expect(r.anchors).toHaveLength(1);
    expect(r.anchors[0].id).toBe('a1');
  });
});

describe('writeLockAtomic', () => {
  it('(c) 原子写：写入后无残留 *.tmp-* 文件，且内容可读回', () => {
    writeLockAtomic(lockPath, { schemaVersion: LOCK_SCHEMA_VERSION, anchors: [validAnchor()] });
    const siblings = fs.readdirSync(path.dirname(lockPath));
    expect(siblings.filter((f) => f.includes('.tmp-'))).toEqual([]);
    expect(readLock(lockPath).anchors).toHaveLength(1);
  });

  it('(d) 检测到残留 *.tmp-* → readLock 判 lock-corrupt', () => {
    writeRaw(JSON.stringify(createEmptyLock()));
    fs.writeFileSync(`${lockPath}.tmp-123-456`, '{}', 'utf8');
    const r = readLock(lockPath);
    expect(r.corrupt).toBe(true);
    expect(r.reason).toMatch(/tmp/i);
  });

  it('(d2) 残留 *.tmp-* 时 writeLockAtomic 拒绝继续', () => {
    fs.writeFileSync(`${lockPath}.tmp-123-456`, '{}', 'utf8');
    expect(() => writeLockAtomic(lockPath, createEmptyLock())).toThrow(/tmp/i);
  });
});

describe('W-4 原子写真实性（"最终文件存在"不足以证明原子）', () => {
  // 只断言"最终文件存在 + 无残留 tmp"时，一个直接 writeFileSync(lockPath) 的
  // 非原子实现同样全绿——写到一半崩溃会留下截断的 lock。故必须断言
  // 「先写临时路径 → 再 rename 到目标」这一具体机制。
  it('先 writeFileSync 到 <lock>.tmp-* 再 renameSync 到目标（顺序与路径均断言）', () => {
    const writeSpy = vi.spyOn(fs, 'writeFileSync');
    const renameSpy = vi.spyOn(fs, 'renameSync');
    try {
      writeLockAtomic(lockPath, { schemaVersion: LOCK_SCHEMA_VERSION, anchors: [validAnchor()] });

      const lockWrites = writeSpy.mock.calls.filter(([target]) => String(target).startsWith(lockPath));
      expect(lockWrites).toHaveLength(1);
      const tmpPath = String(lockWrites[0]![0]);
      expect(tmpPath).toMatch(new RegExp(`^${lockPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.tmp-`));
      expect(tmpPath).not.toBe(lockPath);

      expect(renameSpy).toHaveBeenCalledTimes(1);
      expect(renameSpy.mock.calls[0]).toEqual([tmpPath, lockPath]);

      // 目标文件 MUST NOT 被直接写过一次（否则中途崩溃会留下截断内容）
      expect(writeSpy.mock.calls.some(([target]) => String(target) === lockPath)).toBe(false);

      // 顺序：write 必须发生在 rename 之前
      expect(writeSpy.mock.invocationCallOrder[0]!).toBeLessThan(renameSpy.mock.invocationCallOrder[0]!);
    } finally {
      writeSpy.mockRestore();
      renameSpy.mockRestore();
    }
  });

  it('rename 失败 → 临时文件残留，下次 readLock MUST 判 lock-corrupt 而非读到旧内容', () => {
    writeLockAtomic(lockPath, { schemaVersion: LOCK_SCHEMA_VERSION, anchors: [validAnchor()] });
    expect(readLock(lockPath).corrupt).toBe(false);

    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      throw new Error('EXDEV: cross-device link not permitted');
    });
    try {
      expect(() =>
        writeLockAtomic(lockPath, {
          schemaVersion: LOCK_SCHEMA_VERSION,
          anchors: [{ ...validAnchor(), id: 'a2' }],
        }),
      ).toThrow(/EXDEV/);
    } finally {
      renameSpy.mockRestore();
    }

    const residual = fs.readdirSync(path.dirname(lockPath)).filter((f) => f.includes('.tmp-'));
    expect(residual).toHaveLength(1);

    const after = readLock(lockPath);
    expect(after.corrupt).toBe(true);
    expect(after.reason).toMatch(/tmp/i);
    expect(after.anchors).toEqual([]);
  });
});

describe('readLock —— lock-corrupt 判定', () => {
  it('(e) 非法 JSON', () => {
    writeRaw('{ not json');
    const r = readLock(lockPath);
    expect(r.corrupt).toBe(true);
    expect(r.reason).toBeTruthy();
  });

  it('(f1) 顶层缺 schemaVersion', () => {
    writeRaw(JSON.stringify({ anchors: [] }));
    expect(readLock(lockPath).corrupt).toBe(true);
  });

  it('(f2) anchors 非数组', () => {
    writeRaw(JSON.stringify({ schemaVersion: LOCK_SCHEMA_VERSION, anchors: {} }));
    expect(readLock(lockPath).corrupt).toBe(true);
  });

  it('(f3) 顶层非对象', () => {
    writeRaw(JSON.stringify([]));
    expect(readLock(lockPath).corrupt).toBe(true);
  });

  it('(g) schemaVersion 与工具常量不兼容', () => {
    writeRaw(JSON.stringify({ schemaVersion: '999', anchors: [] }));
    const r = readLock(lockPath);
    expect(r.corrupt).toBe(true);
    expect(r.reason).toMatch(/schemaVersion/);
  });

  it('(h) 缺任一必需字段（十项逐项验证）', () => {
    expect(REQUIRED_ANCHOR_FIELDS).toHaveLength(10);
    for (const field of REQUIRED_ANCHOR_FIELDS) {
      const anchor: Record<string, unknown> = validAnchor();
      delete anchor[field];
      writeRaw(JSON.stringify({ schemaVersion: LOCK_SCHEMA_VERSION, anchors: [anchor] }));
      const r = readLock(lockPath);
      expect(r.corrupt, `缺字段 ${field} 应判 lock-corrupt`).toBe(true);
      expect(r.reason).toContain(field);
    }
  });

  it('(i) 字段类型不符（line 应为 number，其余应为 string）', () => {
    writeRaw(JSON.stringify({ schemaVersion: LOCK_SCHEMA_VERSION, anchors: [{ ...validAnchor(), line: '10' }] }));
    expect(readLock(lockPath).corrupt).toBe(true);

    writeRaw(JSON.stringify({ schemaVersion: LOCK_SCHEMA_VERSION, anchors: [{ ...validAnchor(), id: 42 }] }));
    expect(readLock(lockPath).corrupt).toBe(true);
  });

  it('(i2) 条目非对象', () => {
    writeRaw(JSON.stringify({ schemaVersion: LOCK_SCHEMA_VERSION, anchors: ['x'] }));
    expect(readLock(lockPath).corrupt).toBe(true);
  });

  it('(i3) line 非正整数（0 / 负数 / 小数）均判 lock-corrupt', () => {
    for (const line of [0, -1, 1.5]) {
      writeRaw(JSON.stringify({ schemaVersion: LOCK_SCHEMA_VERSION, anchors: [{ ...validAnchor(), line }] }));
      const r = readLock(lockPath);
      expect(r.corrupt, `line=${line}`).toBe(true);
      expect(r.reason).toContain('line');
    }
  });

  it('(i4) 字符串字段为空串 / 全空白 → lock-corrupt', () => {
    for (const value of ['', '   ']) {
      writeRaw(JSON.stringify({ schemaVersion: LOCK_SCHEMA_VERSION, anchors: [{ ...validAnchor(), symbolId: value }] }));
      expect(readLock(lockPath).corrupt, JSON.stringify(value)).toBe(true);
    }
  });

  it('(i5) anchor id 重复 → lock-corrupt（id 是 unlink/refresh 唯一主键，重复会批量误删）', () => {
    writeRaw(
      JSON.stringify({
        schemaVersion: LOCK_SCHEMA_VERSION,
        anchors: [validAnchor(), { ...validAnchor(), ref: 'src/other.ts::bar' }],
      }),
    );
    const r = readLock(lockPath);
    expect(r.corrupt).toBe(true);
    expect(r.reason).toMatch(/重复/);
  });

  it('(i6) writeLockAtomic 拒绝自产损坏 lock（重复 id / 非法 line 均不落盘）', () => {
    expect(() =>
      writeLockAtomic(lockPath, {
        schemaVersion: LOCK_SCHEMA_VERSION,
        anchors: [validAnchor(), validAnchor()],
      }),
    ).toThrow(/重复/);
    expect(() =>
      writeLockAtomic(lockPath, {
        schemaVersion: LOCK_SCHEMA_VERSION,
        anchors: [{ ...validAnchor(), line: -3 }],
      }),
    ).toThrow(/line/);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('(j) 含被禁字段 status/stale/fresh', () => {
    for (const banned of ['status', 'stale', 'fresh']) {
      writeRaw(
        JSON.stringify({
          schemaVersion: LOCK_SCHEMA_VERSION,
          anchors: [{ ...validAnchor(), [banned]: 'x' }],
        }),
      );
      const r = readLock(lockPath);
      expect(r.corrupt, `含被禁字段 ${banned} 应判 lock-corrupt`).toBe(true);
      expect(r.reason).toContain(banned);
    }
  });
});
