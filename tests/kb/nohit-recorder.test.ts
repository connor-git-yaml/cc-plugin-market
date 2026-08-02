/**
 * F241 T032 — no-hit 记录器（FR-013 / FR-014 / SC-009 / EC-19 / EC-20）
 *
 * 覆盖：落盘键集合恰 8 键（无整串字段）/ 30 天滚动清理 / 只读目录静默降级 /
 *       同一查询两次 hash 相同 / env 未设或为空 → 零 I/O（P-W3）。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync, mkdirSync, rmSync, readdirSync, readFileSync, writeFileSync,
  utimesSync, chmodSync, symlinkSync, lstatSync, existsSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// node:fs 透传包装：仅用于「env 未设 → 全程零 I/O」的调用计数断言（P-W3）
const { fsCalls } = vi.hoisted(() => ({ fsCalls: { count: 0 } }));
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const counted = <T extends (...args: never[]) => unknown>(fn: T): T =>
    ((...args: Parameters<T>) => {
      fsCalls.count++;
      return fn(...args);
    }) as unknown as T;
  return {
    ...actual,
    mkdirSync: counted(actual.mkdirSync),
    appendFileSync: counted(actual.appendFileSync),
    writeFileSync: counted(actual.writeFileSync),
    readdirSync: counted(actual.readdirSync),
    statSync: counted(actual.statSync),
    lstatSync: counted(actual.lstatSync),
    unlinkSync: counted(actual.unlinkSync),
    existsSync: counted(actual.existsSync),
    // B2-2 后写入走 openSync/fstatSync/writeSync/closeSync —— 一并计数，
    // 否则「默认关闭零 I/O」断言会因为漏计新调用而变成空断言
    openSync: counted(actual.openSync),
    fstatSync: counted(actual.fstatSync),
    writeSync: counted(actual.writeSync),
    closeSync: counted(actual.closeSync),
  };
});

const { recordNoHit, resolveNoHitTelemetryDir } = await import('../../src/scaffold-kb/nohit-recorder.js');
const { NOHIT_RETENTION_DAYS } = await import('../../src/scaffold-kb/governance-constants.js');

const ENV_KEY = 'SPECTRA_KB_NOHIT_TELEMETRY';
let dir: string;
let savedEnv: string | undefined;

beforeEach(() => {
  savedEnv = process.env[ENV_KEY];
  dir = mkdtempSync(join(tmpdir(), 'nohit-'));
  process.env[ENV_KEY] = dir;
});

afterEach(() => {
  if (savedEnv === undefined) delete process.env[ENV_KEY];
  else process.env[ENV_KEY] = savedEnv;
  try {
    chmodSync(dir, 0o755);
  } catch {
    /* ignore */
  }
  rmSync(dir, { recursive: true, force: true });
});

/** 读出目录下所有 jsonl 行，解析为对象 */
function readRecords(d: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const f of readdirSync(d)) {
    const text = readFileSync(join(d, f), 'utf-8');
    for (const line of text.split('\n')) {
      if (line.trim().length > 0) out.push(JSON.parse(line) as Record<string, unknown>);
    }
  }
  return out;
}

describe('resolveNoHitTelemetryDir — 单一 env 开关（FR-014 / P-W3）', () => {
  it('env 设为目录路径 → 返回该路径', () => {
    expect(resolveNoHitTelemetryDir()).toBe(dir);
  });

  it('env 未设置 → null', () => {
    delete process.env[ENV_KEY];
    expect(resolveNoHitTelemetryDir()).toBeNull();
  });

  it('env 为空字符串 / 纯空白 → null（等同未设置）', () => {
    process.env[ENV_KEY] = '';
    expect(resolveNoHitTelemetryDir()).toBeNull();
    process.env[ENV_KEY] = '   ';
    expect(resolveNoHitTelemetryDir()).toBeNull();
  });
});

describe('recordNoHit — 默认关闭时全程零 I/O（P-W3）', () => {
  it('env 未设置 → 不写盘且不触碰任何 fs 调用', () => {
    delete process.env[ENV_KEY];
    const before = fsCalls.count;
    recordNoHit({ tool: 'kb_search', rawQuery: '错误码 E01', dbPath: '/x/chunks.sqlite' });
    expect(fsCalls.count - before).toBe(0);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('env 为空字符串 → 同样零 I/O', () => {
    process.env[ENV_KEY] = '';
    const before = fsCalls.count;
    recordNoHit({ tool: 'kb_api_lookup', rawQuery: 'sdk.Init', dbPath: '/x/chunks.sqlite' });
    expect(fsCalls.count - before).toBe(0);
  });
});

describe('recordNoHit — 落盘范围（FR-013 / SC-009）', () => {
  it('落盘对象键集合恰为 8 个规定字段，无任何整串字段', () => {
    recordNoHit({ tool: 'kb_search', rawQuery: '鉴权失败 ERR_AUTH', dbPath: '/kb/chunks.sqlite' });
    const records = readRecords(dir);
    expect(records.length).toBe(1);
    expect(Object.keys(records[0]!).sort()).toEqual([
      'dbPathHash',
      'normalizedQueryHash',
      'redactionTags',
      'resultCount',
      'schemaVersion',
      'terms',
      'timestamp',
      'tool',
    ]);
    expect(records[0]!['redactedQuery']).toBeUndefined();
    expect(records[0]!['query']).toBeUndefined();
    expect(records[0]!['resultCount']).toBe(0);
    expect(records[0]!['schemaVersion']).toBe(1);
    expect(records[0]!['tool']).toBe('kb_search');
    expect(typeof records[0]!['timestamp']).toBe('string');
  });

  it('文件名为 nohit-<YYYYMMDD>.jsonl，单行完整写入（行内无裸换行，EC-19）', () => {
    recordNoHit({ tool: 'scaffold_kb_query', rawQuery: '多行\n查询 词', dbPath: '/kb/chunks.sqlite' });
    const files = readdirSync(dir);
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^nohit-\d{8}\.jsonl$/);
    const text = readFileSync(join(dir, files[0]!), 'utf-8');
    expect(text.endsWith('\n')).toBe(true);
    expect(text.trimEnd().split('\n').length).toBe(1);
  });

  it('敏感片段零出现，redactionTags 标出类型（SC-009 a/b）', () => {
    recordNoHit({
      tool: 'kb_search',
      rawQuery: 'alice@example.com 用 sk-abcdef123456 在 /Users/bob/w 查 13800138000',
      dbPath: '/kb/chunks.sqlite',
    });
    const text = readFileSync(join(dir, readdirSync(dir)[0]!), 'utf-8');
    for (const secret of ['alice@example.com', 'sk-abcdef123456', '/Users/bob', '13800138000']) {
      expect(text).not.toContain(secret);
    }
    const tags = readRecords(dir)[0]!['redactionTags'] as string[];
    expect(tags.sort()).toEqual(['DIGITS', 'EMAIL', 'HOME', 'TOKEN']);
  });

  it('terms 为 tokenizer 切词去重结果（无重复项、非空）', () => {
    recordNoHit({ tool: 'kb_search', rawQuery: '错误码 错误码 retry', dbPath: '/kb/chunks.sqlite' });
    const terms = readRecords(dir)[0]!['terms'] as string[];
    expect(terms.length).toBeGreaterThan(0);
    expect(new Set(terms).size).toBe(terms.length);
    expect(terms).toContain('retry');
  });

  it('dbPathHash 不泄露原路径，不同库 hash 不同', () => {
    recordNoHit({ tool: 'kb_search', rawQuery: 'q1', dbPath: '/vendor/kb/chunks.sqlite' });
    recordNoHit({ tool: 'kb_search', rawQuery: 'q2', dbPath: '/project/kb/chunks.sqlite' });
    const records = readRecords(dir);
    const text = readFileSync(join(dir, readdirSync(dir)[0]!), 'utf-8');
    expect(text).not.toContain('/vendor/kb/chunks.sqlite');
    expect(records[0]!['dbPathHash']).not.toBe(records[1]!['dbPathHash']);
  });

  it('同一查询串两次 → normalizedQueryHash 相同；不同查询 → 不同', () => {
    recordNoHit({ tool: 'kb_search', rawQuery: '限流 429 处理', dbPath: '/kb/chunks.sqlite' });
    recordNoHit({ tool: 'kb_api_lookup', rawQuery: '限流 429 处理', dbPath: '/kb/chunks.sqlite' });
    recordNoHit({ tool: 'kb_search', rawQuery: '完全不同的问题', dbPath: '/kb/chunks.sqlite' });
    const records = readRecords(dir);
    expect(records.length).toBe(3);
    expect(records[0]!['normalizedQueryHash']).toBe(records[1]!['normalizedQueryHash']);
    expect(records[0]!['normalizedQueryHash']).not.toBe(records[2]!['normalizedQueryHash']);
  });
});

describe('recordNoHit — 30 天滚动清理（FR-013）', () => {
  it('超过保留期的同目录文件在写入时被清理，当日文件保留', () => {
    const stale = join(dir, 'nohit-20200101.jsonl');
    writeFileSync(stale, '{"schemaVersion":1}\n');
    const old = Date.now() / 1000 - (NOHIT_RETENTION_DAYS + 10) * 86400;
    utimesSync(stale, old, old);

    const fresh = join(dir, 'nohit-20200102.jsonl');
    writeFileSync(fresh, '{"schemaVersion":1}\n');

    recordNoHit({ tool: 'kb_search', rawQuery: '清理测试', dbPath: '/kb/chunks.sqlite' });

    const files = readdirSync(dir);
    expect(files).not.toContain('nohit-20200101.jsonl');
    expect(files).toContain('nohit-20200102.jsonl'); // mtime 是刚写的，未超期 → 保留
    expect(files.some((f) => /^nohit-\d{8}\.jsonl$/.test(f) && f !== 'nohit-20200102.jsonl')).toBe(true);
  });

  it('不清理非 no-hit 命名的无关文件', () => {
    const other = join(dir, 'unrelated.log');
    writeFileSync(other, 'x');
    const old = Date.now() / 1000 - (NOHIT_RETENTION_DAYS + 10) * 86400;
    utimesSync(other, old, old);
    recordNoHit({ tool: 'kb_search', rawQuery: '清理边界', dbPath: '/kb/chunks.sqlite' });
    expect(readdirSync(dir)).toContain('unrelated.log');
  });
});

describe('recordNoHit — 故障静默降级（EC-20 / RG-009）', () => {
  it('目录只读 → 不抛异常、不产生记录', () => {
    chmodSync(dir, 0o555);
    expect(() => recordNoHit({ tool: 'kb_search', rawQuery: '只读目录', dbPath: '/kb/chunks.sqlite' })).not.toThrow();
    chmodSync(dir, 0o755);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('env 指向被普通文件占位的路径 → 不抛异常', () => {
    const blocked = join(dir, 'blocked');
    writeFileSync(blocked, 'not a dir');
    process.env[ENV_KEY] = blocked;
    expect(() => recordNoHit({ tool: 'kb_search', rawQuery: '占位文件', dbPath: '/kb/chunks.sqlite' })).not.toThrow();
  });

  it('total 函数契约：非法输入（null/非串 rawQuery、非法 tool）也不抛', () => {
    const bad = [
      { tool: 'kb_search', rawQuery: null, dbPath: '/kb' },
      { tool: 'kb_search', rawQuery: 123, dbPath: null },
      { tool: 'bogus_tool', rawQuery: 'x', dbPath: '/kb' },
      {},
      null,
    ];
    for (const b of bad) {
      expect(() => recordNoHit(b as never)).not.toThrow();
    }
  });

  it('目录不存在 → 懒建目录后正常写入（调用方不必自行 mkdir）', () => {
    const nested = join(dir, 'a', 'b');
    process.env[ENV_KEY] = nested;
    recordNoHit({ tool: 'kb_search', rawQuery: '懒建目录', dbPath: '/kb/chunks.sqlite' });
    expect(readRecords(nested).length).toBe(1);
    mkdirSync(nested, { recursive: true });
  });
});

/** 今日 daily 文件名（与 recorder 的命名口径一致） */
function todayDailyName(): string {
  return `nohit-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.jsonl`;
}

/**
 * F241 B2-1（M-3 A-C2 / B-W2）——**终态断言**：对最终序列化的整行做敏感片段零出现检查。
 *
 * 逐字段断言看不出这类绕过：redaction 在 NFKC 之前跑，全角敏感串一路"合规"地
 * 穿到落盘侧才被 tokenizer 还原成 ASCII。所以判据必须落在磁盘上的那一行文本上。
 */
describe('recordNoHit — 落盘整行敏感片段零出现（B2-1 终态断言）', () => {
  const cases: Array<{ name: string; raw: string; secrets: string[]; tag: string }> = [
    { name: '全角数字', raw: '工单 １２３４５６７８ 查不到', secrets: ['12345678', '１２３４５６７８'], tag: 'DIGITS' },
    { name: '大写 URL 凭据参数', raw: 'https://api.example.com/?TOKEN=hunter2 报错', secrets: ['hunter2', 'TOKEN=hunter2'], tag: 'URL_WITH_CRED' },
    { name: '小写 bearer', raw: 'authorization: bearer abcDEF123_xyz', secrets: ['abcDEF123', 'abcDEF123_xyz'], tag: 'TOKEN' },
    { name: '小写 Windows home', raw: '路径 c:\\users\\Alice\\secret', secrets: ['Alice', 'c:\\users\\Alice'], tag: 'HOME' },
    { name: '全角邮箱', raw: '联系 ａｌｉｃｅ@ｅｘａｍｐｌｅ.ｃｏｍ', secrets: ['alice@example.com', 'ａｌｉｃｅ'], tag: 'EMAIL' },
  ];

  for (const c of cases) {
    it(`${c.name} → 整行零出现，并打上 ${c.tag}`, () => {
      recordNoHit({ tool: 'kb_search', rawQuery: c.raw, dbPath: '/kb/chunks.sqlite' });
      const line = readFileSync(join(dir, readdirSync(dir)[0]!), 'utf-8');
      for (const secret of c.secrets) expect(line).not.toContain(secret);
      expect((readRecords(dir)[0]!['redactionTags'] as string[])).toContain(c.tag);
    });
  }

  it('跨类混合一次性全部遮蔽（整行判据）', () => {
    const raw = '１２３４５６７８ https://a.example.com/?Api_Key=zz9secret bearer abcDEF123 c:\\users\\Bob\\x';
    recordNoHit({ tool: 'kb_search', rawQuery: raw, dbPath: '/kb/chunks.sqlite' });
    const line = readFileSync(join(dir, readdirSync(dir)[0]!), 'utf-8');
    for (const secret of ['12345678', 'zz9secret', 'abcDEF123', 'Bob']) {
      expect(line).not.toContain(secret);
    }
  });

  // B2-5：单 token 形态的落盘口径（spec D5 已收窄为「不新增整串字段」，此处钉住护栏与残余）
  it('单 token 敏感形态（sk-xxx 单独查询）→ 落盘是占位标记而非原串（B2-5 护栏）', () => {
    recordNoHit({ tool: 'kb_search', rawQuery: 'sk-abcdef123456', dbPath: '/kb/chunks.sqlite' });
    const line = readFileSync(join(dir, readdirSync(dir)[0]!), 'utf-8');
    expect(line).not.toContain('sk-abcdef123456');
    expect(readRecords(dir)[0]!['terms']).toEqual(['TOKEN']);
  });

  it('单 token 非敏感形态 → term 等于原串，属 D5 已声明并接受的残余（钉住现状，改动需先改 spec）', () => {
    recordNoHit({ tool: 'kb_search', rawQuery: 'ProjectFalcon', dbPath: '/kb/chunks.sqlite' });
    expect(readRecords(dir)[0]!['terms']).toEqual(['ProjectFalcon']);
    // 但仍不得出现「整串字段」——红线是"不新增整串字段"，不是"term 必不等于原串"
    expect(readRecords(dir)[0]!['query']).toBeUndefined();
    expect(readRecords(dir)[0]!['redactedQuery']).toBeUndefined();
  });
});

/**
 * F241 B2-6（M-3 A-W1）——大小写/全角变体必须收敛为同一 `normalizedQueryHash`，
 * 否则同一个问题换个大小写问两遍就能把共同 term 顶过 `distinctQueries` 阈值。
 */
describe('recordNoHit — normalizedQueryHash 的等价类归一化（B2-6）', () => {
  function hashOf(raw: string): string {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    recordNoHit({ tool: 'kb_search', rawQuery: raw, dbPath: '/kb/chunks.sqlite' });
    return readRecords(dir)[0]!['normalizedQueryHash'] as string;
  }

  it('`retry alpha` 与 `retry Alpha` → 同一 hash（阈值绕过被堵）', () => {
    expect(hashOf('retry alpha')).toBe(hashOf('retry Alpha'));
    expect(hashOf('RETRY ALPHA')).toBe(hashOf('retry alpha'));
  });

  it('全角变体与半角 → 同一 hash', () => {
    expect(hashOf('ＲＥＴＲＹ ａｌｐｈａ')).toBe(hashOf('retry alpha'));
  });

  it('额外空格与重复词 → 同一 hash（既有口径不回退）', () => {
    expect(hashOf('retry   alpha  retry')).toBe(hashOf('retry alpha'));
  });

  it('真正不同的问题仍是不同 hash（不是把所有查询压成一个桶）', () => {
    expect(hashOf('retry alpha')).not.toBe(hashOf('retry beta'));
    expect(hashOf('retry alpha')).not.toBe(hashOf('alpha retry')); // 词序不同 = 不同问题
  });
});

/**
 * F241 B2-2（M-3 A-C3 / B-C2）——非常规文件（FIFO / symlink）既不能阻塞主链，
 * 也不能把治理记录写到目录外，更不能让清理逻辑碰目录外的文件。
 */
describe('recordNoHit — 只写常规文件（B2-2）', () => {
  it('daily 名被 FIFO 占位 → 不写入、不抛异常、立即返回（不阻塞主链）', () => {
    const fifo = join(dir, todayDailyName());
    try {
      execFileSync('mkfifo', [fifo]);
    } catch {
      return; // 平台不支持 mkfifo：跳过（本仓 CI 为 macOS/Linux，实际不会走到）
    }
    const started = Date.now();
    expect(() => recordNoHit({ tool: 'kb_search', rawQuery: 'fifo 占位', dbPath: '/kb/chunks.sqlite' })).not.toThrow();
    expect(Date.now() - started).toBeLessThan(2000); // 阻塞的话这里根本回不来
    expect(lstatSync(fifo).isFIFO()).toBe(true); // 仍是 FIFO，未被替换
  });

  it('daily 名是指向目录外文件的 symlink → 目标文件零字节写入（O_NOFOLLOW）', () => {
    const outside = join(dir, '..', `f241-outside-${process.pid}.txt`);
    writeFileSync(outside, '');
    try {
      symlinkSync(outside, join(dir, todayDailyName()));
      expect(() => recordNoHit({ tool: 'kb_search', rawQuery: 'symlink 逃逸', dbPath: '/kb/chunks.sqlite' })).not.toThrow();
      expect(readFileSync(outside, 'utf-8')).toBe('');
    } finally {
      rmSync(outside, { force: true });
    }
  });

  it('清理侧不跟随 symlink：过期目标的 daily 链接与其目标都不被删（lstat）', () => {
    const outside = join(dir, '..', `f241-prune-target-${process.pid}.txt`);
    writeFileSync(outside, 'user data');
    const old = Date.now() / 1000 - (NOHIT_RETENTION_DAYS + 10) * 86400;
    utimesSync(outside, old, old);
    const link = join(dir, 'nohit-20200101.jsonl');
    try {
      symlinkSync(outside, link);
      recordNoHit({ tool: 'kb_search', rawQuery: '清理不跟随链接', dbPath: '/kb/chunks.sqlite' });
      expect(lstatSync(link).isSymbolicLink()).toBe(true); // 链接自身未被 unlink
      expect(existsSync(outside)).toBe(true);
      expect(readFileSync(outside, 'utf-8')).toBe('user data');
    } finally {
      rmSync(outside, { force: true });
    }
  });
});

/**
 * F241 B2-8（M-3 B-C1）——`tool` 的运行时 allowlist：导出边界不能只靠编译期类型。
 */
describe('recordNoHit — 入参运行时校验（B2-8）', () => {
  it('非法 tool → 零 append（不产生任何文件/行）', () => {
    const raw = 'alice@example.com full raw query';
    recordNoHit({ tool: raw, rawQuery: raw, dbPath: '/kb/chunks.sqlite' } as never);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('三值 allowlist 之外的近似值一律拒绝', () => {
    for (const tool of ['kb_Search', 'kb_search ', 'scaffold-kb-query', '', null, 123, {}]) {
      recordNoHit({ tool, rawQuery: 'x', dbPath: '/kb' } as never);
    }
    expect(readdirSync(dir)).toEqual([]);
  });

  it('rawQuery / dbPath 非 string → 零 append', () => {
    recordNoHit({ tool: 'kb_search', rawQuery: 123, dbPath: '/kb' } as never);
    recordNoHit({ tool: 'kb_search', rawQuery: 'x', dbPath: null } as never);
    recordNoHit({ tool: 'kb_search', rawQuery: 'x', dbPath: 42 } as never);
    expect(readdirSync(dir)).toEqual([]);
  });

  it('合法输入不受影响（校验不是全量拒绝）', () => {
    for (const tool of ['kb_search', 'kb_api_lookup', 'scaffold_kb_query'] as const) {
      recordNoHit({ tool, rawQuery: '正常查询', dbPath: '/kb/chunks.sqlite' });
    }
    expect(readRecords(dir).length).toBe(3);
  });
});

/**
 * F241 B2-9（M-3 B-W1）——dbPath 惰性求值：路径计算必须落在 recorder 的保护边界内。
 */
describe('recordNoHit — dbPath thunk 惰性求值（B2-9）', () => {
  it('thunk 形态与 string 形态产生相同 dbPathHash', () => {
    recordNoHit({ tool: 'kb_search', rawQuery: 'q', dbPath: '/kb/chunks.sqlite' });
    recordNoHit({ tool: 'kb_search', rawQuery: 'q', dbPath: () => '/kb/chunks.sqlite' });
    const records = readRecords(dir);
    expect(records.length).toBe(2);
    expect(records[0]!['dbPathHash']).toBe(records[1]!['dbPathHash']);
  });

  it('thunk 抛错 → 不抛到调用方、不落半条记录', () => {
    expect(() =>
      recordNoHit({
        tool: 'kb_search',
        rawQuery: 'q',
        dbPath: () => {
          throw new Error('governance-path-boom');
        },
      }),
    ).not.toThrow();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('采集关闭时 thunk 根本不被求值（关闭态零副作用）', () => {
    delete process.env[ENV_KEY];
    let calls = 0;
    recordNoHit({
      tool: 'kb_search',
      rawQuery: 'q',
      dbPath: () => {
        calls += 1;
        throw new Error('should never be evaluated');
      },
    });
    expect(calls).toBe(0);
  });

  it('thunk 返回非 string → 零 append', () => {
    recordNoHit({ tool: 'kb_search', rawQuery: 'q', dbPath: (() => 42) as never });
    expect(readdirSync(dir)).toEqual([]);
  });
});
