/**
 * F261 T008（红先行，T-R3）— 真 dist 建图产物必须自述 builder。
 *
 * 为什么必须走真实 `node dist/cli/index.js`：本机制的目标场景就是"生产建图跑的是 dist 编译
 * 产物"，而 vitest 跑 src 时定位算法**结构性**返回 null（决策 2 形态 b）。只在 src 侧断言，
 * 等于永远测不到唯一有值的那条路径。
 *
 * `dist/.spectra-build-meta.json` 不存在时（非 git 环境等）**不 skip**：改为断言 `builder`
 * 为 null——"没盖章就诚实写 null"同样是本次修复的合同的一部分，skip 会让它无人守护。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';
import { assertDistBuilt } from '../helpers/dist-cli-guard.js';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CLI_PATH = path.join(PROJECT_ROOT, 'dist', 'cli', 'index.js');
const BUILD_META_PATH = path.join(PROJECT_ROOT, 'dist', '.spectra-build-meta.json');

interface BuildMeta {
  commit: string;
  dirty: boolean;
  sourceDirty: boolean;
  distSha256: string;
}

function readBuildMeta(): BuildMeta | null {
  if (!fs.existsSync(BUILD_META_PATH)) return null;
  try {
    return JSON.parse(fs.readFileSync(BUILD_META_PATH, 'utf-8')) as BuildMeta;
  } catch {
    return null;
  }
}

describe('builder stamp E2E — 真 dist 建图产物自述 builder（F261 T-R3）', () => {
  let tmpDir: string;

  beforeAll(() => {
    assertDistBuilt();
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f261-builder-e2e-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('graph-only 产物的 graph.graph.builder 与 dist/.spectra-build-meta.json 同源', () => {
    execFileSync('git', ['init', '-q'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'f261-test@example.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'F261 Test'], { cwd: tmpDir });
    fs.writeFileSync(
      path.join(tmpDir, 'index.ts'),
      'export function hello(): number { return 1; }\n',
    );
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: tmpDir });

    const specsDir = path.join(tmpDir, 'specs');
    const batch = spawnSync(
      'node',
      [CLI_PATH, 'batch', tmpDir, '--mode', 'graph-only', '--output-dir', specsDir],
      { cwd: tmpDir, encoding: 'utf-8', timeout: 120_000 },
    );
    expect(batch.status).toBe(0);

    const graphPath = path.join(specsDir, '_meta', 'graph.json');
    expect(fs.existsSync(graphPath)).toBe(true);
    const graph = JSON.parse(fs.readFileSync(graphPath, 'utf-8')) as GraphJSON;

    // 字段必须存在（不是"有值才写"）
    expect('builder' in graph.graph).toBe(true);

    const meta = readBuildMeta();
    if (meta === null) {
      // 未盖章 build：诚实降级为 null（保持有断言，不 skip）
      expect(graph.graph.builder).toBeNull();
      return;
    }

    const builder = graph.graph.builder;
    expect(builder).not.toBeNull();
    expect(builder!.formatVersion).toBe(1);
    expect(builder!.commit).toBe(meta.commit);
    expect(builder!.distSha256).toBe(meta.distSha256);
    expect(builder!.dirty).toBe(meta.dirty);
    expect(builder!.sourceDirty).toBe(meta.sourceDirty);
    // 零时间戳 / 零路径不变量（byte-stable 与 portable 的合同面）
    expect(Object.keys(builder!).sort()).toEqual([
      'commit',
      'dirty',
      'distSha256',
      'formatVersion',
      'sourceDirty',
    ]);
  }, 120_000);

  /**
   * 第三轮 D5（欠账登记转覆盖）——「`builder` 非 null 且 byte-stable」此前**无任何测试覆盖**。
   *
   * 缺口来源：入库守护资产（`collector-fingerprint-guardrail` fixture / F220 charter 快照）
   * 恒为 `builder: null`（再生走 tsx/src 路径，见 F8 登记）；而唯一走真 dist 的本文件此前
   * 只跑一次、不比对两次产物 ⇒ "同一 dist 内写盘确定性"这一维在**有值**的情况下从未被断言。
   * 第一轮 T032 只有手工实跑记录，手工记录不会在回归时变红。
   *
   * `builder` 非 null 是硬断言而非条件跳过：`assertDistBuilt()`（beforeAll）已保证
   * `dist/.spectra-build-meta.json` 存在，此处若为 null 就是真回归。
   */
  it('D5：真 dist 连跑两次 graph-only → builder 非 null 且两份产物逐字节相同', () => {
    execFileSync('git', ['init', '-q'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'f261-test@example.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'F261 Test'], { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export function hello(): number { return 1; }\n');
    fs.writeFileSync(path.join(tmpDir, 'other.ts'), 'export function bye(): number { return 2; }\n');
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: tmpDir });

    /**
     * 跑一次 graph-only，返回 graph.json 的**原始字节**（不经 JSON 归一，byte 比对才有意义）。
     *
     * 输出目录刻意放在**被扫描项目之外**（对抗复审 I4）：若把 run1 的产物落进项目树内，run2 扫描到的
     * 文件集就与 run1 不同。当前 graph-only 的产物只有一个 `_meta/graph.json`（非源码扩展名、不入
     * 扫描）所以"恰好安全"，但那是**巧合而非结构**——一旦产物新增 `.ts/.md` 或扫描口径改成计文件数，
     * 这条用例会为一个与 builder 毫无关系的原因变红。
     */
    const outRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f261-builder-e2e-out-'));
    const runGraphOnly = (outDirName: string): Buffer => {
      const specsDir = path.join(outRoot, outDirName);
      const batch = spawnSync(
        'node',
        [CLI_PATH, 'batch', tmpDir, '--mode', 'graph-only', '--output-dir', specsDir],
        { cwd: tmpDir, encoding: 'utf-8', timeout: 120_000 },
      );
      expect(batch.status).toBe(0);
      return fs.readFileSync(path.join(specsDir, '_meta', 'graph.json'));
    };

    let first: Buffer;
    let second: Buffer;
    try {
      first = runGraphOnly('specs-run1');
      second = runGraphOnly('specs-run2');
    } finally {
      fs.rmSync(outRoot, { recursive: true, force: true });
    }

    const firstGraph = JSON.parse(first.toString('utf-8')) as GraphJSON;
    const secondGraph = JSON.parse(second.toString('utf-8')) as GraphJSON;

    // ① 非 null：dist 已盖章（assertDistBuilt 保证），生产链路必须把它写进图
    expect(firstGraph.graph.builder).not.toBeNull();
    expect(firstGraph.graph.builder).toBeDefined();
    expect(secondGraph.graph.builder).toEqual(firstGraph.graph.builder);

    // ② 与磁盘 build-meta 同源（排除"写了个自造的非 null 值"这种假通过）
    const meta = readBuildMeta();
    expect(meta).not.toBeNull();
    expect(firstGraph.graph.builder!.commit).toBe(meta!.commit);
    expect(firstGraph.graph.builder!.distSha256).toBe(meta!.distSha256);

    // ③ byte-stable：同一 dist 内连跑两次逐字节相同（写盘期非确定性一旦引入即变红）
    expect(second.equals(first)).toBe(true);
  }, 240_000);
});
