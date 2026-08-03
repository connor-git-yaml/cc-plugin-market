/**
 * F249 T014：collector fingerprint 计算模块单测（TDD red 先行，实现见 T015）。
 *
 * 覆盖分工（tasks.md Phase 2）：
 * - **结构与 SSoT 推导**：`computeCollectorFingerprint()` 的三分量结构（FR-001）、五个
 *   `extensionSurface` 子分量与 `src/collector-surface.ts` 声明面逐字段一致（含 W-002 补记的
 *   `pythonSymbolScan`）、`genericAdapters` 为 java∪go 合并视图（决策 3）、各 `extensions`
 *   数组已排序（决策 6）。
 *   注意 SSoT 中 TSJS 面的声明顺序是 `.ts/.tsx/.js/.jsx`（**非**字典序），因此"断言指纹里
 *   是 `.js/.jsx/.ts/.tsx`"本身就是"排序确实被执行"的判据，而非恰好相等的巧合。
 * - **SC-001（bump 半段）**：仅 `behaviorVersion` 为旧值的指纹与当前指纹判为不等；端到端
 *   （旧图跑 freshness → 非 fresh）半段属 Phase 3（T021）。
 * - **SC-002（partial）**：用 `vi.doMock` 扰动 SSoT 常量（新增测试专用扩展名）后动态 import
 *   指纹模块 —— 断言对应管线子分量**自动**变化而非硬编码字面量镜像；顺带覆盖
 *   `mergeSurfaces` 语义分歧时 fail-loud 传播（决策 3）。完整段（用扩展前的指纹跑 freshness）属 Phase 3。
 * - **SC-013（partial）**：指纹 API 经既有 barrel `./index.js` 可访问且与深路径导入**同一引用**
 *   （W-06）；自身产出确定性半段（同进程重复调用深相等 + 返回值互相隔离，调用方改动不污染下次产出）。
 * - **SC-014**：(a) spawn 两个独立 node 子进程（固定 cwd / env / 入口脚本）各自序列化，
 *   byte-identical，并与进程内序列化一致；额外补一组 TZ/locale 不同的子进程对照，
 *   证明排序不走 locale 敏感路径（`Array.prototype.sort` 默认按 UTF-16 码元比较）。
 *   (b) 序列化形态结构断言：无时间戳、无绝对路径、无平台相关路径分隔符。
 * - **SC-016**：`BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES` 逐类覆盖 FR-004 六类条件。
 * - **FR-018 + C-001/W-005**：`isValidCollectorFingerprint` 六类畸形样本表格（类型错误 / 空对象 /
 *   `formatVersion≠1` / 缺子字段 / 嵌套字段类型错 / **key 集合不精确相等**），全部返回 `false`
 *   且不抛异常；另有 accessor 形态（含"首次合法二次抛错"的 stateful getter）一律归 invalid，
 *   以及 `parseCollectorFingerprint` 返回 plain snapshot 的物理独立性断言。
 * - **W-01**：`fingerprintsEqual` canonical 化后字段级深比较 —— 顶层键序打乱 + `extensions`
 *   数组乱序仍判 equal（并显式断言此时 `JSON.stringify` 字面不同，即裸字符串比较会误判）。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  BEHAVIOR_VERSION,
  BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES,
  computeCollectorFingerprint,
  fingerprintsEqual,
  isValidCollectorFingerprint,
  parseCollectorFingerprint,
  type CollectorFingerprint,
} from './collector-fingerprint.js';
import * as graphBarrel from './index.js';
import {
  GO_ADAPTER_SURFACE,
  JAVA_ADAPTER_SURFACE,
  MODULE_DERIVATION_SCAN_SURFACE,
  PY_WALK_SURFACE,
  PYTHON_SYMBOL_SCAN_SURFACE,
  TSJS_SKELETON_WALK_SURFACE,
} from '../../collector-surface.js';

/** 仓库根：从本文件位置推导（不依赖 `process.cwd()`，避免测试运行目录差异影响子进程实验）。 */
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const TSX_CLI = path.join(REPO_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const FINGERPRINT_MODULE = path.join(REPO_ROOT, 'src', 'panoramic', 'graph', 'collector-fingerprint.js');

/** SSoT 常量的 `Set` → 排序数组（构造期望值用，与被测实现无共享代码）。 */
function sortedExtensions(extensions: ReadonlySet<string>): string[] {
  return [...extensions].sort();
}

describe('computeCollectorFingerprint：三分量结构与 SSoT 推导（FR-001/FR-002/决策 3/决策 6）', () => {
  it('顶层是 formatVersion → extensionSurface → behaviorVersion 三分量，且书写顺序固定', () => {
    const fingerprint = computeCollectorFingerprint();

    expect(Object.keys(fingerprint)).toEqual(['formatVersion', 'extensionSurface', 'behaviorVersion']);
    expect(fingerprint.formatVersion).toBe(1);
    expect(fingerprint.behaviorVersion).toBe(BEHAVIOR_VERSION);
  });

  it('BEHAVIOR_VERSION 是正整数常量（可被显式 bump 的语义版本，FR-004）', () => {
    expect(typeof BEHAVIOR_VERSION).toBe('number');
    expect(Number.isInteger(BEHAVIOR_VERSION)).toBe(true);
    expect(BEHAVIOR_VERSION).toBeGreaterThanOrEqual(1);
  });

  it('extensionSurface 恰含五个子分量，键序固定（决策 3：genericAdapters 是 java+go 合并单条目）', () => {
    const { extensionSurface } = computeCollectorFingerprint();

    expect(Object.keys(extensionSurface)).toEqual([
      'tsjsSkeletonWalk',
      'pyWalk',
      'genericAdapters',
      'moduleDerivationScan',
      'pythonSymbolScan',
    ]);
  });

  it('五个子分量的 extensions/matchSemantics 与 SSoT 声明逐字段一致，且 extensions 已排序', () => {
    const { extensionSurface } = computeCollectorFingerprint();

    // TSJS：SSoT 声明序为 .ts/.tsx/.js/.jsx/.mjs/.cjs（后两个由 d27ba75 扩面引入），
    // 指纹里必须是字典序 —— 证明 sort 确实被执行
    expect(extensionSurface.tsjsSkeletonWalk).toEqual({
      extensions: ['.cjs', '.js', '.jsx', '.mjs', '.ts', '.tsx'],
      matchSemantics: 'case-sensitive',
    });
    expect(extensionSurface.tsjsSkeletonWalk.extensions).toEqual(
      sortedExtensions(TSJS_SKELETON_WALK_SURFACE.extensions),
    );

    expect(extensionSurface.pyWalk).toEqual({
      extensions: ['.py', '.pyi'],
      matchSemantics: 'case-sensitive',
    });
    expect(extensionSurface.pyWalk.extensions).toEqual(sortedExtensions(PY_WALK_SURFACE.extensions));

    // genericAdapters = java ∪ go（两者 matchSemantics 相同，合并不丢可辨识信息）
    expect(extensionSurface.genericAdapters).toEqual({
      extensions: ['.go', '.java'],
      matchSemantics: 'case-insensitive',
    });
    expect(extensionSurface.genericAdapters.extensions).toEqual(
      sortedExtensions(new Set([...JAVA_ADAPTER_SURFACE.extensions, ...GO_ADAPTER_SURFACE.extensions])),
    );

    expect(extensionSurface.moduleDerivationScan).toEqual({
      extensions: ['.cjs', '.cts', '.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx'],
      matchSemantics: 'case-insensitive',
    });
    expect(extensionSurface.moduleDerivationScan.extensions).toEqual(
      sortedExtensions(MODULE_DERIVATION_SCAN_SURFACE.extensions),
    );

    // W-002 补记的第六条管线。两条 key 独立存在、值自 F250 起相等；在集合相等期间，
    // 值层面**无法分辨接线错误**（`toSurfaceEntry` 每次新建对象，引用断言恒真故不设），
    // 接线正确性以 `collector-fingerprint.ts` 的
    // `pythonSymbolScan: toSurfaceEntry(PYTHON_SYMBOL_SCAN_SURFACE)` 源码为准；
    // 集合若再度分叉，下面的值断言将恢复分辨力。
    expect(extensionSurface.pythonSymbolScan).toEqual({
      extensions: ['.py', '.pyi'],
      matchSemantics: 'case-sensitive',
    });
    expect(extensionSurface.pythonSymbolScan.extensions).toEqual(
      sortedExtensions(PYTHON_SYMBOL_SCAN_SURFACE.extensions),
    );
  });

  it('自身产出确定性：同进程重复调用深相等且序列化一致（SC-013 partial / FR-017 同进程半段）', () => {
    const first = computeCollectorFingerprint();
    const second = computeCollectorFingerprint();

    expect(first).toEqual(second);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it('每次调用返回互相隔离的新对象：调用方改动返回值不污染下次产出', () => {
    const first = computeCollectorFingerprint();
    expect(first).not.toBe(computeCollectorFingerprint());

    first.extensionSurface.pyWalk.extensions.push('.injected');
    first.extensionSurface.tsjsSkeletonWalk.matchSemantics = 'case-insensitive';

    const later = computeCollectorFingerprint();
    expect(later.extensionSurface.pyWalk.extensions).toEqual(['.py', '.pyi']);
    expect(later.extensionSurface.tsjsSkeletonWalk.matchSemantics).toBe('case-sensitive');
    // SSoT 本身也未被污染
    expect([...PY_WALK_SURFACE.extensions]).toEqual(['.py', '.pyi']);
  });
});

describe('SC-001（bump 半段）：behaviorVersion 变化即指纹不同', () => {
  it('仅 behaviorVersion 为旧值的指纹与当前指纹判为不等，且差异只来自该字段', () => {
    const current = computeCollectorFingerprint();
    const beforeBump: CollectorFingerprint = {
      ...structuredClone(current),
      behaviorVersion: BEHAVIOR_VERSION - 1,
    };

    expect(fingerprintsEqual(beforeBump, current)).toBe(false);
    // 比较对称：谁作为 recorded 传入都不影响结论
    expect(fingerprintsEqual(current, beforeBump)).toBe(false);
    // 把 behaviorVersion 还原后完全相等 —— 证明不等确由 bump 引起，没有顺带改动其他分量
    expect({ ...beforeBump, behaviorVersion: current.behaviorVersion }).toEqual(current);
  });
});

describe('SC-002（partial）：SSoT 扩展面变化 → extensionSurface 子分量自动变化', () => {
  afterEach(() => {
    vi.doUnmock('../../collector-surface.js');
    vi.resetModules();
  });

  it('SSoT 的 pyWalk 面新增测试专用扩展名 → 仅 pyWalk 子分量变化（含重新排序），指纹整体判为不等', async () => {
    const baseline = computeCollectorFingerprint();

    vi.resetModules();
    vi.doMock('../../collector-surface.js', async () => {
      const actual = await vi.importActual<typeof import('../../collector-surface.js')>(
        '../../collector-surface.js',
      );
      return {
        ...actual,
        // 追加在末尾，且字典序应排到 `.py` 之前 —— 同时验证"新增即变化"与"变化后仍排序"
        PY_WALK_SURFACE: {
          extensions: new Set([...actual.PY_WALK_SURFACE.extensions, '.pxd']),
          matchSemantics: actual.PY_WALK_SURFACE.matchSemantics,
        },
      };
    });

    const perturbed = await import('./collector-fingerprint.js');
    const perturbedFingerprint = perturbed.computeCollectorFingerprint();

    expect(perturbedFingerprint.extensionSurface.pyWalk.extensions).toEqual(['.pxd', '.py', '.pyi']);
    // behaviorVersion 未动（SC-002 明确"不改动 behaviorVersion 分量"）
    expect(perturbedFingerprint.behaviorVersion).toBe(baseline.behaviorVersion);
    // 其余四个子分量保持不变 —— 变化面被精确定位到发生变更的那条管线
    expect(perturbedFingerprint.extensionSurface.tsjsSkeletonWalk).toEqual(
      baseline.extensionSurface.tsjsSkeletonWalk,
    );
    expect(perturbedFingerprint.extensionSurface.genericAdapters).toEqual(
      baseline.extensionSurface.genericAdapters,
    );
    expect(perturbedFingerprint.extensionSurface.moduleDerivationScan).toEqual(
      baseline.extensionSurface.moduleDerivationScan,
    );
    expect(perturbedFingerprint.extensionSurface.pythonSymbolScan).toEqual(
      baseline.extensionSurface.pythonSymbolScan,
    );
    // 整体判为不等：扩展面变化足以让 freshness 判定链看到差异（完整端到端半段见 T021）
    expect(perturbed.fingerprintsEqual(baseline, perturbedFingerprint)).toBe(false);
  });

  it('SSoT 的 java/go 面 matchSemantics 分歧 → mergeSurfaces 抛错并原样向上传播（决策 3 fail-loud）', async () => {
    vi.resetModules();
    vi.doMock('../../collector-surface.js', async () => {
      const actual = await vi.importActual<typeof import('../../collector-surface.js')>(
        '../../collector-surface.js',
      );
      return {
        ...actual,
        GO_ADAPTER_SURFACE: {
          extensions: actual.GO_ADAPTER_SURFACE.extensions,
          matchSemantics: 'case-sensitive' as const,
        },
      };
    });

    const perturbed = await import('./collector-fingerprint.js');
    expect(() => perturbed.computeCollectorFingerprint()).toThrow(/matchSemantics/);
  });
});

describe('SC-016：BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES 覆盖 FR-004 六类条件', () => {
  /** 六类条件 → 期望条目 id + 说明文案里必须出现的关键词（防"占位描述"式假覆盖）。 */
  const REQUIRED_CLASSES: ReadonlyArray<{ id: string; keyword: string | RegExp }> = [
    { id: 'ignore-dirs-pruning', keyword: 'ignore' },
    { id: 'gitignore-interpretation', keyword: '.gitignore' },
    { id: 'case-matching-strategy', keyword: '大小写' },
    { id: 'symlink-handling', keyword: /symlink|符号链接/ },
    { id: 'file-size-guard', keyword: /1\s?MB/i },
    { id: 'collection-failure-degradation', keyword: '降级' },
  ];

  it('是非空的结构化数组，每项含 id 与非空 description，且 id 无重复', () => {
    expect(Array.isArray(BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES)).toBe(true);
    expect(BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES.length).toBeGreaterThanOrEqual(
      REQUIRED_CLASSES.length,
    );

    for (const item of BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES) {
      expect(typeof item.id).toBe('string');
      expect(item.id.length).toBeGreaterThan(0);
      expect(typeof item.description).toBe('string');
      expect(item.description.trim().length).toBeGreaterThan(0);
    }

    const ids = BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(REQUIRED_CLASSES)('覆盖 $id 类条件，且说明文案确实描述该类', ({ id, keyword }) => {
    const entry = BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES.find((item) => item.id === id);

    expect(entry, `bump 责任清单缺少 ${id} 类条件（FR-004 六类必覆盖）`).toBeDefined();
    if (typeof keyword === 'string') {
      expect(entry?.description).toContain(keyword);
    } else {
      expect(entry?.description).toMatch(keyword);
    }
  });
});

describe('FR-018：isValidCollectorFingerprint 纯结构校验（畸形一律 false，且不抛异常）', () => {
  it('当前实现产出与其 JSON 往返结果均判为合法（正例）', () => {
    const fingerprint = computeCollectorFingerprint();

    expect(isValidCollectorFingerprint(fingerprint)).toBe(true);
    expect(isValidCollectorFingerprint(JSON.parse(JSON.stringify(fingerprint)))).toBe(true);
  });

  /** 构造合法基线的深拷贝，供逐类畸形改写。 */
  function mutableValid(): Record<string, unknown> {
    return JSON.parse(JSON.stringify(computeCollectorFingerprint())) as Record<string, unknown>;
  }

  function withoutKey(key: string): Record<string, unknown> {
    const value = mutableValid();
    delete value[key];
    return value;
  }

  function withSurfaceMutation(
    mutate: (surface: Record<string, unknown>) => void,
  ): Record<string, unknown> {
    const value = mutableValid();
    mutate(value.extensionSurface as Record<string, unknown>);
    return value;
  }

  const MALFORMED_CASES: ReadonlyArray<{ klass: string; label: string; value: unknown }> = [
    // 类 1：类型错误（非 object / 数组 / 原始值）
    { klass: '类型错误', label: 'null', value: null },
    { klass: '类型错误', label: 'undefined', value: undefined },
    { klass: '类型错误', label: '字符串', value: 'fingerprint' },
    { klass: '类型错误', label: '数字', value: 1 },
    { klass: '类型错误', label: '布尔', value: true },
    { klass: '类型错误', label: '数组', value: [] },
    { klass: '类型错误', label: '函数', value: () => 1 },
    // 类 2：空对象
    { klass: '空对象', label: '{}', value: {} },
    // 类 3：formatVersion 非当前受支持值
    { klass: 'formatVersion≠1', label: '0', value: { ...mutableValid(), formatVersion: 0 } },
    { klass: 'formatVersion≠1', label: '2（未来格式，不做兼容解析）', value: { ...mutableValid(), formatVersion: 2 } },
    { klass: 'formatVersion≠1', label: "字符串 '1'", value: { ...mutableValid(), formatVersion: '1' } },
    { klass: 'formatVersion≠1', label: 'null', value: { ...mutableValid(), formatVersion: null } },
    { klass: 'formatVersion≠1', label: '缺失', value: withoutKey('formatVersion') },
    // 类 4：缺必填子字段
    { klass: '缺子字段', label: '缺 extensionSurface', value: withoutKey('extensionSurface') },
    { klass: '缺子字段', label: '缺 behaviorVersion', value: withoutKey('behaviorVersion') },
    {
      klass: '缺子字段',
      label: 'extensionSurface 缺 pyWalk',
      value: withSurfaceMutation((surface) => {
        delete surface.pyWalk;
      }),
    },
    {
      klass: '缺子字段',
      label: 'extensionSurface 缺 moduleDerivationScan',
      value: withSurfaceMutation((surface) => {
        delete surface.moduleDerivationScan;
      }),
    },
    {
      klass: '缺子字段',
      label: 'pyWalk 缺 matchSemantics',
      value: withSurfaceMutation((surface) => {
        delete (surface.pyWalk as Record<string, unknown>).matchSemantics;
      }),
    },
    {
      klass: '缺子字段',
      label: 'pyWalk 缺 extensions',
      value: withSurfaceMutation((surface) => {
        delete (surface.pyWalk as Record<string, unknown>).extensions;
      }),
    },
    // 类 5：嵌套字段类型错误
    { klass: '嵌套类型错', label: 'extensionSurface 是字符串', value: { ...mutableValid(), extensionSurface: 'surface' } },
    { klass: '嵌套类型错', label: 'extensionSurface 是数组', value: { ...mutableValid(), extensionSurface: [] } },
    { klass: '嵌套类型错', label: 'extensionSurface 是 null', value: { ...mutableValid(), extensionSurface: null } },
    { klass: '嵌套类型错', label: 'behaviorVersion 是字符串', value: { ...mutableValid(), behaviorVersion: '1' } },
    { klass: '嵌套类型错', label: 'behaviorVersion 是 NaN', value: { ...mutableValid(), behaviorVersion: Number.NaN } },
    {
      klass: '嵌套类型错',
      label: 'tsjsSkeletonWalk.extensions 是字符串',
      value: withSurfaceMutation((surface) => {
        (surface.tsjsSkeletonWalk as Record<string, unknown>).extensions = '.ts';
      }),
    },
    {
      klass: '嵌套类型错',
      label: 'tsjsSkeletonWalk.extensions 含非字符串元素',
      value: withSurfaceMutation((surface) => {
        (surface.tsjsSkeletonWalk as Record<string, unknown>).extensions = ['.ts', 42];
      }),
    },
    {
      klass: '嵌套类型错',
      label: 'genericAdapters.matchSemantics 非法枚举值',
      value: withSurfaceMutation((surface) => {
        (surface.genericAdapters as Record<string, unknown>).matchSemantics = 'CASE-SENSITIVE';
      }),
    },
    {
      klass: '嵌套类型错',
      label: 'genericAdapters 是数组',
      value: withSurfaceMutation((surface) => {
        surface.genericAdapters = [];
      }),
    },
    // 类 6（C-001）：key 集合不精确等于已知集合 —— 多一个 key 同样 invalid。
    // 这是最危险的一类：它模拟"未来 producer 新增管线/字段却忘了 bump formatVersion"，
    // 宽容校验会判合法 → fingerprintsEqual 只比已知字段 → 判相等 → 过期图被判 fresh。
    {
      klass: 'key 集合不等',
      label: 'extensionSurface 多出一条未知管线 shadow',
      value: withSurfaceMutation((surface) => {
        surface.shadow = { extensions: ['.zig'], matchSemantics: 'case-sensitive' };
      }),
    },
    {
      klass: 'key 集合不等',
      label: 'extensionSurface 多出一个非管线字段（值为原始类型）',
      value: withSurfaceMutation((surface) => {
        surface.futureFlag = true;
      }),
    },
    {
      klass: 'key 集合不等',
      label: '顶层多出一个未知字段',
      value: { ...mutableValid(), futureTopLevelField: 'x' },
    },
    {
      klass: 'key 集合不等',
      label: '管线条目内多出一个未知字段',
      value: withSurfaceMutation((surface) => {
        (surface.pyWalk as Record<string, unknown>).caseFolding = 'nfc';
      }),
    },
    // 反面（同类里的"少一个 key"方向）已由上方"缺子字段"组覆盖，两个方向合起来即"精确相等"
  ];

  it.each(MALFORMED_CASES)('$klass / $label → 返回 false 且不抛异常', ({ value }) => {
    expect(() => isValidCollectorFingerprint(value)).not.toThrow();
    expect(isValidCollectorFingerprint(value)).toBe(false);
  });

  it('属性访问本身抛异常（getter 陷阱）时仍返回 false，不向上抛错', () => {
    const boobyTrapped = Object.defineProperty(
      { formatVersion: 1, behaviorVersion: 1 },
      'extensionSurface',
      {
        get() {
          throw new Error('boom：外部图产物字段可能是任意形态');
        },
        enumerable: true,
      },
    );

    expect(() => isValidCollectorFingerprint(boobyTrapped)).not.toThrow();
    expect(isValidCollectorFingerprint(boobyTrapped)).toBe(false);
  });

  // ── W-005：stateful accessor 一律归 invalid（而非"按第一次读到的值放行"）──

  it('首次读合法、二次读抛错的 stateful getter → 判 invalid，且 getter 一次都不会被调用', () => {
    const valid = computeCollectorFingerprint();
    let reads = 0;
    const stateful = Object.defineProperty(
      { formatVersion: 1, behaviorVersion: BEHAVIOR_VERSION },
      'extensionSurface',
      {
        get() {
          reads += 1;
          if (reads === 1) return valid.extensionSurface;
          throw new Error('boom：第二次读取抛错（校验与比较看到不同的值）');
        },
        enumerable: true,
        configurable: true,
      },
    );

    // 不抛异常、判 invalid：accessor 形态在"读它"之前就被拒（`JSON.parse` 永不产出 accessor）
    expect(() => isValidCollectorFingerprint(stateful)).not.toThrow();
    expect(isValidCollectorFingerprint(stateful)).toBe(false);
    expect(parseCollectorFingerprint(stateful)).toBeNull();
    // 关键：从未执行外部代码，因此"第一次合法、第二次抛错"这类不稳定性无从生效
    expect(reads).toBe(0);
  });

  it('每次读都返回等价合法值的 getter 同样判 invalid（判据是形态而非运气）', () => {
    const stable = Object.defineProperty(
      { formatVersion: 1, behaviorVersion: BEHAVIOR_VERSION },
      'extensionSurface',
      {
        get() {
          return computeCollectorFingerprint().extensionSurface;
        },
        enumerable: true,
        configurable: true,
      },
    );

    expect(isValidCollectorFingerprint(stable)).toBe(false);
  });

  it('管线条目层的 accessor 同样判 invalid（严格性覆盖全部三层，不止顶层）', () => {
    const value = JSON.parse(JSON.stringify(computeCollectorFingerprint())) as CollectorFingerprint;
    const surface = value.extensionSurface as unknown as Record<string, unknown>;
    Object.defineProperty(surface, 'pyWalk', {
      get() {
        return { extensions: ['.py', '.pyi'], matchSemantics: 'case-sensitive' };
      },
      enumerable: true,
      configurable: true,
    });

    expect(isValidCollectorFingerprint(value)).toBe(false);
  });
});

describe('W-005：parseCollectorFingerprint 返回自有 plain snapshot（单次求值收口）', () => {
  it('合法输入 → 返回与输入深相等、但物理独立的 snapshot（含嵌套对象与数组均为新引用）', () => {
    const recorded = JSON.parse(JSON.stringify(computeCollectorFingerprint())) as CollectorFingerprint;
    const snapshot = parseCollectorFingerprint(recorded);

    expect(snapshot).not.toBeNull();
    expect(snapshot).toEqual(recorded);
    expect(snapshot).not.toBe(recorded);
    expect(snapshot?.extensionSurface).not.toBe(recorded.extensionSurface);
    expect(snapshot?.extensionSurface.pyWalk).not.toBe(recorded.extensionSurface.pyWalk);
    expect(snapshot?.extensionSurface.pyWalk.extensions).not.toBe(
      recorded.extensionSurface.pyWalk.extensions,
    );
  });

  it('返回后改写原对象不影响 snapshot —— 比较阶段看到的就是校验阶段那份数据', () => {
    const recorded = JSON.parse(JSON.stringify(computeCollectorFingerprint())) as CollectorFingerprint;
    const snapshot = parseCollectorFingerprint(recorded);
    expect(snapshot).not.toBeNull();

    recorded.extensionSurface.pyWalk.extensions.push('.injected-after-parse');
    recorded.behaviorVersion = BEHAVIOR_VERSION + 99;

    expect(snapshot?.extensionSurface.pyWalk.extensions).toEqual(['.py', '.pyi']);
    expect(snapshot?.behaviorVersion).toBe(BEHAVIOR_VERSION);
    // snapshot 与当前实现仍判相等（若比较读的是被污染的原对象，这里会 false）
    expect(fingerprintsEqual(snapshot as CollectorFingerprint, computeCollectorFingerprint())).toBe(true);
  });

  it('snapshot 的键序与 computeCollectorFingerprint 一致（不继承 recorded 的字面键序）', () => {
    const shuffled = {
      behaviorVersion: BEHAVIOR_VERSION,
      extensionSurface: computeCollectorFingerprint().extensionSurface,
      formatVersion: 1,
    } as CollectorFingerprint;

    const snapshot = parseCollectorFingerprint(shuffled);
    expect(Object.keys(snapshot as object)).toEqual([
      'formatVersion',
      'extensionSurface',
      'behaviorVersion',
    ]);
    expect(Object.keys((snapshot as CollectorFingerprint).extensionSurface)).toEqual([
      'tsjsSkeletonWalk',
      'pyWalk',
      'genericAdapters',
      'moduleDerivationScan',
      'pythonSymbolScan',
    ]);
  });

  it('畸形输入 → null，且与 isValidCollectorFingerprint 的判定完全一致（同一实现的两个投影）', () => {
    for (const malformed of [null, undefined, {}, [], 'x', { formatVersion: 2 }]) {
      expect(parseCollectorFingerprint(malformed)).toBeNull();
      expect(isValidCollectorFingerprint(malformed)).toBe(false);
    }
  });
});

describe('W-01：fingerprintsEqual canonical 化后字段级深比较（非 JSON.stringify 字符串相等）', () => {
  /** 与 `computeCollectorFingerprint()` 语义等价、但键序与数组序被打乱的 recorded 形态。 */
  function shuffledEquivalent(): CollectorFingerprint {
    const current = computeCollectorFingerprint();
    const reversedEntry = (key: keyof CollectorFingerprint['extensionSurface']) => ({
      matchSemantics: current.extensionSurface[key].matchSemantics,
      extensions: [...current.extensionSurface[key].extensions].reverse(),
    });

    // 顶层与嵌套层键序均与实现书写顺序不同（模拟"他人写入的历史图产物"）
    return {
      behaviorVersion: current.behaviorVersion,
      extensionSurface: {
        pythonSymbolScan: reversedEntry('pythonSymbolScan'),
        moduleDerivationScan: reversedEntry('moduleDerivationScan'),
        genericAdapters: reversedEntry('genericAdapters'),
        pyWalk: reversedEntry('pyWalk'),
        tsjsSkeletonWalk: reversedEntry('tsjsSkeletonWalk'),
      },
      formatVersion: current.formatVersion,
    } as CollectorFingerprint;
  }

  it('顶层键序打乱 + extensions 数组乱序 → 判为 equal', () => {
    const current = computeCollectorFingerprint();
    const recorded = shuffledEquivalent();

    // 前置：此形态下裸字符串比较必然误判 —— 正是本用例要防的退化实现
    expect(JSON.stringify(recorded)).not.toBe(JSON.stringify(current));

    expect(fingerprintsEqual(recorded, current)).toBe(true);
    expect(fingerprintsEqual(current, recorded)).toBe(true);
  });

  it('自身与自身、以及 JSON 往返后的副本判为 equal', () => {
    const current = computeCollectorFingerprint();

    expect(fingerprintsEqual(current, current)).toBe(true);
    expect(fingerprintsEqual(JSON.parse(JSON.stringify(current)) as CollectorFingerprint, current)).toBe(
      true,
    );
  });

  it('canonical 化不改写入参（比较是纯函数，不会把排序副作用写回 recorded 对象）', () => {
    const recorded = shuffledEquivalent();
    const before = JSON.stringify(recorded);

    fingerprintsEqual(recorded, computeCollectorFingerprint());

    expect(JSON.stringify(recorded)).toBe(before);
  });

  const NOT_EQUAL_CASES: ReadonlyArray<{ label: string; mutate: (value: CollectorFingerprint) => void }> = [
    {
      label: 'behaviorVersion 不同',
      mutate: (value) => {
        value.behaviorVersion += 1;
      },
    },
    {
      label: 'formatVersion 不同',
      mutate: (value) => {
        (value as unknown as Record<string, unknown>).formatVersion = 2;
      },
    },
    {
      label: '某管线新增一个扩展名',
      mutate: (value) => {
        value.extensionSurface.pyWalk.extensions.push('.pxd');
      },
    },
    {
      label: '某管线移除一个扩展名',
      mutate: (value) => {
        value.extensionSurface.moduleDerivationScan.extensions =
          value.extensionSurface.moduleDerivationScan.extensions.filter((ext) => ext !== '.cts');
      },
    },
    {
      label: '某管线扩展名被替换（长度相同，内容不同）',
      mutate: (value) => {
        value.extensionSurface.tsjsSkeletonWalk.extensions = ['.js', '.jsx', '.ts', '.mts'];
      },
    },
    {
      label: '某管线 matchSemantics 翻转',
      mutate: (value) => {
        value.extensionSurface.tsjsSkeletonWalk.matchSemantics = 'case-insensitive';
      },
    },
    {
      label: '某管线扩展名出现重复项（多一份，实际集合不同）',
      mutate: (value) => {
        value.extensionSurface.pyWalk.extensions = ['.py', '.py', '.pyi'];
      },
    },
  ];

  it.each(NOT_EQUAL_CASES)('$label → 判为 not-equal', ({ mutate }) => {
    const current = computeCollectorFingerprint();
    const recorded = structuredClone(current);
    mutate(recorded);

    expect(fingerprintsEqual(recorded, current)).toBe(false);
    expect(fingerprintsEqual(current, recorded)).toBe(false);
  });
});

describe('SC-013（partial）：指纹 API 经既有 barrel 可访问且与深路径导入同引用（W-06）', () => {
  it('barrel 导出的函数/常量与深路径导入是同一引用', () => {
    expect(graphBarrel.computeCollectorFingerprint).toBe(computeCollectorFingerprint);
    expect(graphBarrel.isValidCollectorFingerprint).toBe(isValidCollectorFingerprint);
    expect(graphBarrel.parseCollectorFingerprint).toBe(parseCollectorFingerprint);
    expect(graphBarrel.fingerprintsEqual).toBe(fingerprintsEqual);
    expect(graphBarrel.BEHAVIOR_VERSION).toBe(BEHAVIOR_VERSION);
    expect(graphBarrel.BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES).toBe(
      BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES,
    );
  });

  it('经 barrel 调用的产出与深路径调用的产出深相等（同一实现，无第二份镜像）', () => {
    // 类型 re-export（`CollectorFingerprint`）由 `npm run build` 对 index.ts 的类型检查兜住；
    // 此处标注类型即可让退化（barrel 忘了 re-export 类型）在编译期暴露。
    const viaBarrel: graphBarrel.CollectorFingerprint = graphBarrel.computeCollectorFingerprint();

    expect(viaBarrel).toEqual(computeCollectorFingerprint());
    expect(graphBarrel.isValidCollectorFingerprint(viaBarrel)).toBe(true);
    expect(graphBarrel.fingerprintsEqual(viaBarrel, computeCollectorFingerprint())).toBe(true);
  });
});

describe('SC-014：序列化确定性（跨进程 byte-identical + 形态结构断言，FR-017）', () => {
  let tempDir = '';
  let entryScript = '';

  beforeAll(() => {
    expect(fs.existsSync(TSX_CLI), `缺少 tsx CLI（${TSX_CLI}）：跨进程探针无法执行`).toBe(true);

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f243-fingerprint-'));
    entryScript = path.join(tempDir, 'print-fingerprint.ts');
    // 固定入口脚本：两个子进程跑同一份文件，只序列化指纹本身、不掺入任何环境信息
    fs.writeFileSync(
      entryScript,
      [
        `import { computeCollectorFingerprint } from ${JSON.stringify(FINGERPRINT_MODULE)};`,
        'process.stdout.write(JSON.stringify(computeCollectorFingerprint()));',
        '',
      ].join('\n'),
      'utf-8',
    );
  });

  afterAll(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  /**
   * 在独立 node 子进程里计算并序列化指纹。
   *
   * env 显式重建（不继承 vitest 注入的 `NODE_OPTIONS`/覆盖率变量），保证两次运行输入一致；
   * cwd 固定为仓库根，排除"相对路径解析差异"这一变量。
   */
  function runInSubprocess(extraEnv: Record<string, string> = {}): string {
    const result = spawnSync(process.execPath, [TSX_CLI, entryScript], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      env: { PATH: process.env.PATH ?? '', TZ: 'UTC', LANG: 'C', ...extraEnv },
      timeout: 60_000,
    });

    expect(result.error, `子进程启动失败：${String(result.error)}`).toBeUndefined();
    expect(result.status, `子进程非零退出，stderr=${result.stderr}`).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
    return result.stdout;
  }

  it('(a) 两个独立子进程的序列化结果 byte-identical，且与进程内序列化一致', () => {
    const first = runInSubprocess();
    const second = runInSubprocess();

    expect(first).toBe(second);
    expect(first).toBe(JSON.stringify(computeCollectorFingerprint()));
  });

  it('(a+) TZ/locale 不同的子进程结果仍 byte-identical（排序不走 locale 敏感路径）', () => {
    const utc = runInSubprocess({ TZ: 'UTC', LANG: 'C' });
    // 土耳其语 locale 是大小写折叠/排序差异的经典陷阱，用作 locale 敏感性反例
    const tokyoTurkish = runInSubprocess({
      TZ: 'Asia/Tokyo',
      LANG: 'tr_TR.UTF-8',
      LC_ALL: 'tr_TR.UTF-8',
    });

    expect(tokyoTurkish).toBe(utc);
  });

  it('(b) 序列化形态不含时间戳/绝对路径/平台相关路径分隔符', () => {
    const serialized = JSON.stringify(computeCollectorFingerprint());

    // 全部为可打印 ASCII：排除不可见控制字符与本地化文本混入
    expect(serialized).toMatch(/^[\x20-\x7e]*$/);
    // 无路径分隔符（POSIX 与 Windows 两种形态）
    expect(serialized).not.toContain('/');
    expect(serialized).not.toContain('\\');
    // 无仓库/临时目录/家目录等环境绝对路径残留
    expect(serialized).not.toContain(REPO_ROOT);
    expect(serialized).not.toContain(os.tmpdir());
    expect(serialized).not.toContain(os.homedir());
    // 无时间戳形态：ISO 日期、epoch 毫秒级长数字、年份字面量
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(serialized).not.toMatch(/\d{2}:\d{2}:\d{2}/);
    expect(serialized).not.toMatch(/\d{10,}/);
    expect(serialized).not.toMatch(/\b(19|20)\d{2}\b/);
    // 唯一允许的数字是两个版本号字段；扩展名部分只含小写字母与点
    expect(serialized).toContain(`"formatVersion":1`);
    expect(serialized).toContain(`"behaviorVersion":${BEHAVIOR_VERSION}`);
  });
});
