/**
 * F261 T007 / 第三轮 D1+D2（红先行）— `describeBuilderStamp` 的**六态**文案单测。
 *
 * ## 第三轮语义变更（主线程裁决 D1）：比对对象从 `sourceCommit` 换成「当前正在运行的 builder」
 *
 * 前两轮把图记录的 `builder.commit` 与 `graph.graph.sourceCommit` 比对。这两个值分属**两个不同
 * 仓库**——前者是 Spectra 自己 dist 的 build commit，后者是**被分析项目**的 commit——除自举外
 * **不等是结构性恒真的**。真 dist 实证（第三轮修复前，外部临时项目）：
 *
 * ```
 * [builder] 0d3e385 (…) — 与 sourceCommit=eceb956 不一致：本图由与源码树不同版本的编译产物写出
 * ```
 *
 * 这张图恰恰就是**当前这一版 dist** 刚刚建出来的，该句为假；且把 `builder.distSha256` 改成任意
 * 其它值，输出**逐字不变** ⇒ 判据对真正的事故形态完全失明。
 *
 * 新语义回答的是「**这张图是不是由你现在跑的这一版 spectra 建的**」——对任何被分析项目都良定义，
 * 且恰好就是 fix-report 那起事故（陈旧 dist 建的基线图在新 dist 下被使用）的形状。
 *
 * 比对是**整份 stamp 的字段级比较**而非只比 commit：在**未提交的分支**上 `builder.commit` 恒等于
 * HEAD，无论 dist 落后源码多少次编辑 ⇒「同 commit 内 dist 落后」这一**主形态**只有 `distSha256`
 * 这一维能分辨（D2）。
 *
 * ## 第二组断言（错配防线）
 *
 * 与 `graph-quality-cli.test.ts` 的"未命中 stale reason 逐个 `not.toContain`"同构：builder
 * advisory 行只要带上任一方括号字面量，那条防线就会在某个 stale 场景里误红（plan §7.3）。
 */
import { describe, it, expect } from 'vitest';
import { describeBuilderStamp } from '../../src/cli/commands/graph-quality.js';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';
import type { GraphBuilderStamp } from '../../src/panoramic/graph/builder-stamp.js';
import { ALL_STALE_REASONS, baseFreshnessGraph } from '../helpers/freshness-stale-scenarios.js';

const COMMIT_A = 'a'.repeat(40);
const COMMIT_B = 'b'.repeat(40);
const DIST_0 = '0'.repeat(64);
const DIST_1 = '1'.repeat(64);
const DIST_2 = '2'.repeat(64);

/** 「当前正在运行的 builder」的代表值（测试通过第二入参注入，不依赖进程真实 dist）。 */
function currentStamp(overrides: Partial<GraphBuilderStamp> = {}): GraphBuilderStamp {
  return {
    formatVersion: 1,
    commit: COMMIT_A,
    dirty: false,
    sourceDirty: false,
    distSha256: DIST_0,
    ...overrides,
  };
}

/** 图里记录的 builder（默认与 current 全字段相等）。 */
const recordedStamp = currentStamp;

function graphWith(overrides: Partial<GraphJSON['graph']>): GraphJSON {
  return baseFreshnessGraph(overrides);
}

describe('describeBuilderStamp — 与「当前运行的 builder」比对（D1）', () => {
  it('D1-1 全字段相等 → 明说「由当前运行的 build 写出」，且渲染 commit 7 位与 dist 前 12 位', () => {
    const text = describeBuilderStamp(
      graphWith({ builder: recordedStamp() }),
      currentStamp(),
    );

    expect(text).toContain('[builder]');
    expect(text).toContain('aaaaaaa');
    expect(text).toContain(DIST_0.slice(0, 12));
    expect(text).toContain('由当前运行的 build 写出');
    expect(text).not.toContain('不是同一个 build');
  });

  /**
   * 判别文案的**互斥**断言（对抗复审 W3）——W3 实证：把 delta 描述函数整体替换成常量、甚至替换成
   * 空串，原来那批断言**全绿**（变异存活）。根因是断言锚在 `'dist'` / `'不是同一个 build'` 这类
   * **所有分支共有**的子串上，四个分支各自的判别文案一个字都没被钉。
   *
   * 修法：每个分支断言其**独有**子串，并交叉断言其余分支的独有子串 `not.toContain`。
   */
  const DISCRIMINATORS = {
    sameBuild: '由当前运行的 build 写出',
    sameProductMetaDelta: '仅盖章元数据有出入',
    distDrift: '同一 commit 下 dist 内容不同',
    bothDiffer: 'commit 与 dist 内容两维都不同',
    cannotCompare: '当前进程未找到 build 盖章',
  } as const;

  /** 断言 `text` 命中且仅命中 `expected` 这一条判别文案。 */
  function expectOnly(text: string, expected: keyof typeof DISCRIMINATORS): void {
    expect(text).toContain(DISCRIMINATORS[expected]);
    for (const [key, literal] of Object.entries(DISCRIMINATORS)) {
      if (key !== expected) expect(text).not.toContain(literal);
    }
  }

  it('D1-2 commit 相同、仅 distSha256 不同 → 判「不是同一个 build」并点名 dist 漂移这一维', () => {
    const text = describeBuilderStamp(
      graphWith({ builder: recordedStamp({ distSha256: DIST_1 }) }),
      currentStamp({ distSha256: DIST_0 }),
    );

    expect(text).toContain('不是同一个 build');
    expectOnly(text, 'distDrift');
    // 两侧 dist 都要出现，读者才能判断哪一份是旧的
    expect(text).toContain(DIST_1.slice(0, 12));
    expect(text).toContain(DIST_0.slice(0, 12));
  });

  it('D1-3 commit 与 dist 均不同 → 两侧 commit 7 位都出现，并点名"两维都不同"', () => {
    const text = describeBuilderStamp(
      graphWith({ builder: recordedStamp({ commit: COMMIT_B, distSha256: DIST_1 }) }),
      currentStamp(),
    );

    expect(text).toContain('bbbbbbb');
    expect(text).toContain('aaaaaaa');
    expect(text).toContain('不是同一个 build');
    expectOnly(text, 'bothDiffer');
  });

  /**
   * 对抗复审 W4：`stampBuild` 的 `dirty` 取整树 `git status --porcelain`，与 dist 内容毫无关系
   * ——碰任何一个无关文件后重建，`distSha256` 不变而 `dirty` 翻转。若让它主导结论，此前建的所有
   * 图会一律被标"不是同一个 build" ⇒ 天天红 → 被当噪声忽略，正是本机制要避免的失效模式。
   * 结论必须由 `distSha256`（执行的编译产物是不是同一份）判定，元数据差异降级为括注。
   */
  it('W4：dist 相同、仅 dirty/sourceDirty 不同 → 不得以「不是同一个 build」领读，但差异必须仍可见', () => {
    const text = describeBuilderStamp(
      graphWith({ builder: recordedStamp({ dirty: true }) }),
      currentStamp({ dirty: false }),
    );

    expect(text).not.toContain('不是同一个 build');
    expectOnly(text, 'sameProductMetaDelta');
    expect(text).toContain('工作树状态不同');
    // 两侧的 dirty 取值仍要出现在行内（降级为括注 ≠ 抹掉信息）。
    // 断言必须带"图 / 当前"前缀——裸 `dirty=false` 是 `sourceDirty=false` 的子串，会被蒙混过关。
    expect(text).toContain('图 dirty=true');
    expect(text).toContain('当前 dirty=false');
  });

  /**
   * 对抗复审 W1：`COMMIT_VALUE_PATTERN` 刻意允许 7 位 short-sha 记账。裸 `!==` 会让
   * "图记 `aaaaaaa`、当前记 40 位 `aaa…`" 判成"commit 不同"，而展示层两侧都截到 7 位
   * ⇒ **同一行里两个渲染值逐字相同、结论却说不同**，是一句读者能当场证伪的话。
   */
  it('W1：图用 short-sha 记账（当前 commit 的 7 位前缀）+ dist 相同 → 不得断言 commit 不同', () => {
    const text = describeBuilderStamp(
      graphWith({ builder: recordedStamp({ commit: COMMIT_A.slice(0, 7) }) }),
      currentStamp(),
    );

    expect(text).not.toContain('不是同一个 build');
    expect(text).not.toContain('盖章 commit 不同');
    expectOnly(text, 'sameProductMetaDelta');
    expect(text).toContain('记法长度不同');
  });

  it('W1 对照：前缀不相容的短 sha → 仍如实报「盖章 commit 不同」', () => {
    const text = describeBuilderStamp(
      graphWith({ builder: recordedStamp({ commit: COMMIT_B.slice(0, 7) }) }),
      currentStamp(),
    );

    expectOnly(text, 'sameProductMetaDelta');
    expect(text).toContain('盖章 commit 不同');
    expect(text).not.toContain('记法长度不同');
  });

  /**
   * 对抗复审 W2：`currentBuilder === null` 同样会在**真编译 dist** 上触发——`npx tsc` /
   * IDE build task / `npm run build --ignore-scripts` 都不触发 `postbuild-stamp.mjs`，
   * 首次这样构建的树上 build-meta 从来就不存在。把成因写死成"源码直跑"就是一句假陈述。
   */
  it('D1-6 当前找不到盖章（current=null）→ 「无法比对」，且成因不写死为源码直跑', () => {
    const text = describeBuilderStamp(graphWith({ builder: recordedStamp() }), null);

    expect(text).toContain('[builder]');
    expect(text).toContain('aaaaaaa');
    expectOnly(text, 'cannotCompare');
    expect(text).toContain('源码直跑');
    expect(text).toContain('.spectra-build-meta.json');
  });
});

describe('describeBuilderStamp — 记录侧三种缺席/不可用形态必须分列（D1-3 条）', () => {
  it('键整体缺失（旧图产物）→ unrecorded，措辞点明「本字段上线前写出」', () => {
    const graph = graphWith({});
    delete (graph.graph as { builder?: unknown }).builder;

    const text = describeBuilderStamp(graph, currentStamp());

    expect(text).toContain('unrecorded');
    expect(text).toContain('上线前');
    expect(text).not.toContain('unstamped');
    expect(text).not.toContain('unrecognized');
  });

  it('显式 null → unstamped，措辞点明「未盖章 build / 源码直跑写出」', () => {
    const text = describeBuilderStamp(graphWith({ builder: null }), currentStamp());

    expect(text).toContain('unstamped');
    expect(text).toContain('未盖章');
    expect(text).not.toContain('unrecorded');
    expect(text).not.toContain('unrecognized');
  });

  it('存在但不可解析（更新版本 formatVersion）→ unrecognized，MUST NOT 塌进 unstamped', () => {
    const text = describeBuilderStamp(
      graphWith({
        builder: { formatVersion: 2, commit: COMMIT_A } as unknown as GraphBuilderStamp,
      }),
      currentStamp(),
    );

    expect(text).toContain('unrecognized');
    expect(text).toContain('不可识别');
    expect(text).not.toContain('unstamped');
    expect(text).not.toContain('unrecorded');
  });

  /**
   * `'builder' in graph.graph` 的前置条件：`graph.graph` 必须是对象。CLI 侧
   * `validateGraphJsonShape` 只保证 `typeof === 'object'`（数组照样过），而本函数是导出的。
   * 一次抛出就是 exit 2 —— advisory 反过来当门禁，正是第二轮 F1 那条已被实证的失效形态。
   */
  it('graph.graph 为 null / 数组 / 字符串等畸形形态 → 不抛，归入 unrecorded', () => {
    for (const bogus of [null, [], 'x', 0, undefined]) {
      const graph = graphWith({});
      (graph as { graph: unknown }).graph = bogus;
      expect(() => describeBuilderStamp(graph, currentStamp())).not.toThrow();
      expect(describeBuilderStamp(graph, currentStamp())).toContain('unrecorded');
    }
  });

  /**
   * 对抗复审 B-W1（第四轮）：上一版只折叠了**内层** `graph.graph`，函数第一条语句 `graph.graph`
   * 在 `graph` 自身为 `null` / `undefined` 时就已经抛了——17 组敌意输入里正是这 2 组穿透。
   * 本函数的 JSDoc 与 `short()` 注释都把"不抛"声明成**不依赖调用方**的纵深防御，只挡内层
   * 等于这条不变量按其自身口径没成立。
   */
  it('B-W1：外层 graph 自身为 null / undefined / 标量时 → 不抛，归入 unrecorded', () => {
    for (const bogus of [null, undefined, 'x', 0, false, []]) {
      expect(() =>
        describeBuilderStamp(bogus as unknown as GraphJSON, currentStamp()),
      ).not.toThrow();
      expect(describeBuilderStamp(bogus as unknown as GraphJSON, currentStamp())).toContain(
        'unrecorded',
      );
    }
  });

  /**
   * 对抗复审 I-3：`in` 走原型链。污染 `Object.prototype.builder` 后，一张**本无该键**的图会被
   * 判成"有记录"，advisory 会拿污染值当成图自己的 provenance 渲染出来。
   */
  it('I-3：Object.prototype 被污染时，无 builder 键的图仍判 unrecorded（不认原型链上的记录）', () => {
    const proto = Object.prototype as unknown as Record<string, unknown>;
    proto['builder'] = recordedStamp({ commit: 'f'.repeat(40) });
    try {
      const graph = graphWith({});
      delete (graph.graph as { builder?: unknown }).builder;

      const text = describeBuilderStamp(graph, currentStamp());

      expect(text).toContain('unrecorded');
      expect(text).not.toContain('fffffff');
    } finally {
      delete proto['builder'];
    }
  });

  it('三态文案两两不同（合并成一句即回归）', () => {
    const missing = graphWith({});
    delete (missing.graph as { builder?: unknown }).builder;
    const texts = [
      describeBuilderStamp(missing, currentStamp()),
      describeBuilderStamp(graphWith({ builder: null }), currentStamp()),
      describeBuilderStamp(
        graphWith({ builder: { formatVersion: 9 } as unknown as GraphBuilderStamp }),
        currentStamp(),
      ),
    ];

    expect(new Set(texts).size).toBe(3);
  });
});

describe('describeBuilderStamp — distSha256 必须可见（D2）', () => {
  /**
   * D2 的核心判据：在**未提交的 feature 分支**上 `builder.commit` 恒等于 HEAD，无论 dist 落后
   * 源码多少次编辑。修复前，仅 `distSha256` 不同的两份 stamp 渲染出的文案**逐字相同**（真 dist
   * 实证），即"同 commit 内 dist 落后"这一主形态在人读面完全不可见。
   */
  it('两份仅 distSha256 不同的记录 → 渲染文案必须不同', () => {
    const a = describeBuilderStamp(
      graphWith({ builder: recordedStamp({ distSha256: DIST_1 }) }),
      currentStamp(),
    );
    const b = describeBuilderStamp(
      graphWith({ builder: recordedStamp({ distSha256: DIST_2 }) }),
      currentStamp(),
    );

    expect(a).not.toBe(b);
    expect(a).toContain('111111111111');
    expect(b).toContain('222222222222');
  });

  it('dist 渲染截到 12 位（不外泄全长，也不短于 12 位）', () => {
    const text = describeBuilderStamp(
      graphWith({ builder: recordedStamp({ distSha256: DIST_1 }) }),
      currentStamp({ distSha256: DIST_1 }),
    );

    expect(text).toContain(DIST_1.slice(0, 12));
    expect(text).not.toContain(DIST_1);
  });

  /**
   * D2 后半条：`sourceDirty === true` 时**禁止**使用「一致」二字——脏工作树 build 的 commit
   * 本就不构成可复现身份。
   */
  it('sourceDirty=true 的同一 build → 不得出现「一致」二字，且必须点出脏工作树', () => {
    const text = describeBuilderStamp(
      graphWith({ builder: recordedStamp({ dirty: true, sourceDirty: true }) }),
      currentStamp({ dirty: true, sourceDirty: true }),
    );

    expect(text).not.toContain('一致');
    expect(text).toContain('脏工作树');
    expect(text).toContain('不构成可复现身份');
  });

  it('不等态里只有一侧 sourceDirty=true → 措辞为「至少一侧」，不指代不明地说「该 build」', () => {
    const text = describeBuilderStamp(
      graphWith({ builder: recordedStamp({ distSha256: DIST_1, sourceDirty: true }) }),
      currentStamp({ sourceDirty: false }),
    );

    expect(text).not.toContain('一致');
    expect(text).toContain('至少一侧 build 出自脏工作树');
  });

  it('两侧 sourceDirty 均为 false → 不追加脏工作树提示（零噪声）', () => {
    const text = describeBuilderStamp(
      graphWith({ builder: recordedStamp() }),
      currentStamp(),
    );

    expect(text).not.toContain('脏工作树');
  });

  it('F7：两个 dirty 标志必须显式标出"build 时"的时间参照系', () => {
    const text = describeBuilderStamp(
      graphWith({ builder: recordedStamp({ dirty: true }) }),
      currentStamp({ dirty: true }),
    );

    expect(text).toContain('build 时');
    expect(text).toContain('dirty=true');
    expect(text).toContain('sourceDirty=false');
  });
});

describe('describeBuilderStamp — 值域闸口仍对消费侧生效（F3 留存）', () => {
  it('commit 含 ANSI 控制字符 → 走 unrecognized，输出零控制字符', () => {
    const esc = String.fromCharCode(27);
    const text = describeBuilderStamp(
      graphWith({ builder: recordedStamp({ commit: `${esc}[2J${esc}[H` }) }),
      currentStamp(),
    );

    expect(text).toContain('unrecognized');
    expect(new RegExp('[\\u0000-\\u001f\\u007f]').test(text)).toBe(false);
  });

  it('commit 为绝对路径 + 时间戳 / distSha256 为路径 → unrecognized，值不外泄', () => {
    const text = describeBuilderStamp(
      graphWith({
        builder: recordedStamp({
          commit: '/Users/alice/secret @ 2026-08-08T09:00:00Z',
          distSha256: '/abs/path/to/dist',
        }),
      }),
      currentStamp(),
    );

    expect(text).toContain('unrecognized');
    expect(text).not.toContain('/Users/alice');
    expect(text).not.toContain('2026-08-08');
  });

  /**
   * D6 配套不变量（第四轮主线程裁决）—— **`unrecognized` 态的输出 MUST 与 recorded 内容无关**。
   *
   * 第四轮把写盘侧的保留通道从"不可解析就 collapse 成 null"改成"原样不动"，磁盘上因此**会**
   * 长期存在我们读不懂的 builder 值（这正是前向兼容要的）。于是"控制字符 / 绝对路径 / 时间戳
   * 不进终端"这条不变量**完全落到消费侧**——写盘时销毁证据不再是它的第二道保险。
   *
   * 上面两条用例只钉了两组具体值，属于"举例式"守护：把渲染改成回显 recorded 的**其它**字段
   * （或整份 `JSON.stringify`）仍可能存活。这里改用**恒定性**断言：任意敌意输入下输出必须是
   * 同一个常量串，任何形式的回显都会让它变红。
   */
  it('D6：unrecognized 输出恒为同一常量串，与 recorded 内容完全无关（禁止任何回显）', () => {
    const esc = String.fromCharCode(27);
    const hostileRecords: unknown[] = [
      { formatVersion: 2, secret: '/Users/alice/private', builtAtIso: '2026-08-08T09:00:00Z' },
      { formatVersion: 1, commit: `${esc}[2J${esc}[H`, dirty: 1, sourceDirty: null, distSha256: 5 },
      { formatVersion: 99, [`${esc}[31mkey`]: 'v' },
      { formatVersion: 2, nested: { deep: { path: 'C:\\Users\\bob\\dist' } } },
      'future-opaque-token',
      [1, 2, 3],
      42,
      true,
    ];

    const outputs = hostileRecords.map((builder) =>
      describeBuilderStamp(graphWith({ builder: builder as GraphBuilderStamp }), currentStamp()),
    );

    expect(new Set(outputs).size).toBe(1);
    expect(outputs[0]).toContain('unrecognized');
    for (const text of outputs) {
      expect(new RegExp('[\\u0000-\\u001f\\u007f]').test(text)).toBe(false);
      for (const leak of ['/Users/alice', 'C:\\Users', '2026-08-08', 'future-opaque-token', 'secret']) {
        expect(text).not.toContain(leak);
      }
    }
  });
});

describe('describeBuilderStamp — sourceCommit 已不再是输入（D1 顺带面）', () => {
  /**
   * 第二轮 F1 的失效面（`short()` 对非字符串 `sourceCommit` 直接 `.slice` ⇒ 整条 graph-quality
   * 崩成 exit 2）随比对对象更换而**结构性消失**。类型守卫本身按裁决**保留**为防御纵深，这里改为
   * 从外部可观测的角度钉住更强的性质：**advisory 输出与 `sourceCommit` 完全无关**。
   */
  it('五种 sourceCommit 取值下文案逐字相同，且一律不抛', () => {
    const variants: unknown[] = [COMMIT_A, COMMIT_B, null, 123, { nested: true }];
    const texts = variants.map((value) => {
      const graph = graphWith({ builder: recordedStamp() });
      (graph.graph as { sourceCommit?: unknown }).sourceCommit = value;
      expect(() => describeBuilderStamp(graph, currentStamp())).not.toThrow();
      return describeBuilderStamp(graph, currentStamp());
    });
    const missing = graphWith({ builder: recordedStamp() });
    delete (missing.graph as { sourceCommit?: unknown }).sourceCommit;
    texts.push(describeBuilderStamp(missing, currentStamp()));

    expect(new Set(texts).size).toBe(1);
  });

  it('文案不再提及 sourceCommit（跨仓恒不等的假陈述已移除）', () => {
    const text = describeBuilderStamp(
      graphWith({ sourceCommit: COMMIT_B, builder: recordedStamp() }),
      currentStamp(),
    );

    expect(text).not.toContain('sourceCommit');
    expect(text).not.toContain('源码树');
  });
});

describe('describeBuilderStamp — 文案不得撞 stale reason 方括号字面量（plan §7.3）', () => {
  const missingKeyGraph = graphWith({});
  delete (missingKeyGraph.graph as { builder?: unknown }).builder;

  const texts = [
    // 六态全覆盖
    describeBuilderStamp(graphWith({ builder: recordedStamp() }), currentStamp()),
    describeBuilderStamp(
      graphWith({ builder: recordedStamp({ distSha256: DIST_1 }) }),
      currentStamp(),
    ),
    describeBuilderStamp(graphWith({ builder: recordedStamp() }), null),
    describeBuilderStamp(missingKeyGraph, currentStamp()),
    describeBuilderStamp(graphWith({ builder: null }), currentStamp()),
    describeBuilderStamp(
      graphWith({ builder: { formatVersion: 9 } as unknown as GraphBuilderStamp }),
      currentStamp(),
    ),
  ];

  for (const reason of ALL_STALE_REASONS) {
    it(`六态文案均不含 [${reason}]`, () => {
      for (const text of texts) {
        expect(text).not.toContain(`[${reason}]`);
      }
    });
  }

  it('六态文案均为单行（advisory 只占 [freshness] 之后的一行）', () => {
    for (const text of texts) {
      expect(text.includes('\n')).toBe(false);
    }
  });
});
