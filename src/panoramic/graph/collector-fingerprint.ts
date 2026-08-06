/**
 * F249 collector fingerprint：图产物"采集器行为身份"的计算、结构校验与语义比较。
 *
 * 为什么与 `src/collector-surface.ts`（SSoT）分文件（plan 决策 5）：SSoT 是零依赖的纯数据
 * 声明（FR-019），本模块则承载带版本演进语义的判断逻辑（推导 / 校验 / 比较）。合在一起会让
 * "改一个扩展名"与"改一版判定语义"落在同一文件里，评审时无法区分两类风险。本模块落在
 * `panoramic/graph/` 与 `source-commit.ts`（freshness 判定的唯一消费方）同层，公共 API 经既有
 * barrel `./index.ts` 暴露（FR-008/W-06）。
 *
 * 指纹为何是**确定性构造的对象**而非哈希值（plan 决策 6）：诊断时需要能直接读出"哪条管线的
 * 采集面变了"；哈希只能回答"变了没变"。确定性由两条纪律保证——字段书写顺序固定 + 各
 * `extensions` 数组构造时排序，因此 `JSON.stringify(computeCollectorFingerprint())` 跨进程、
 * 跨平台 byte-identical（FR-017）。
 *
 * 两份指纹**是否语义相等**一律走 `fingerprintsEqual()`（canonical 化后字段级深比较），
 * **MUST NOT** 用 `JSON.stringify` 字符串相等替代：`recordedFingerprint` 来自 `JSON.parse` 后的
 * 外部图产物字段，其字面键序与数组元素排列不受本模块控制（W-01）。
 */
import {
  GO_ADAPTER_SURFACE,
  JAVA_ADAPTER_SURFACE,
  MODULE_DERIVATION_SCAN_SURFACE,
  PY_WALK_SURFACE,
  PYTHON_SYMBOL_SCAN_SURFACE,
  TSJS_SKELETON_WALK_SURFACE,
  mergeSurfaces,
  type CollectorPipelineSurface,
  type ExtensionMatchSemantics,
} from '../../collector-surface.js';

/** 单条采集管线在指纹中的投影：排序后的扩展名数组 + 匹配语义。 */
export interface CollectorExtensionSurfaceEntry {
  /** 已按 UTF-16 码元升序排序（`Array.prototype.sort` 默认序，locale 无关）。 */
  extensions: string[];
  matchSemantics: ExtensionMatchSemantics;
}

/**
 * 指纹的采集面分量：五条管线各一条目（`genericAdapters` 覆盖 java+go 两条 SSoT 常量）。
 *
 * `genericAdapters` 是 java/go 两个 SSoT 常量的合并视图（决策 3）——二者 `matchSemantics` 相同，
 * 合并不丢失可辨识信息；若未来出现分歧，`mergeSurfaces` 会 throw 而非静默产出错误分量。
 *
 * `pythonSymbolScan` 是实现期审查（W-002，2026-08-03）补记的第六条生产管线（`scanPyFiles`），
 * 与 `pyWalk`（`walkPyFiles`）**刻意分列**：两者分列是为了保留各自管线身份与指纹 key 的独立
 * 稳定性，其扩展名集合自 F250 起趋于一致（同为 `.py`+`.pyi`），但仍作为两个独立指纹分量分别
 * 追踪，以便未来任一管线单独变化时能被独立感知。合并成单一条目会永久丢失这种可辨识性。
 */
export interface CollectorExtensionSurface {
  tsjsSkeletonWalk: CollectorExtensionSurfaceEntry;
  pyWalk: CollectorExtensionSurfaceEntry;
  genericAdapters: CollectorExtensionSurfaceEntry;
  moduleDerivationScan: CollectorExtensionSurfaceEntry;
  pythonSymbolScan: CollectorExtensionSurfaceEntry;
}

/** 图产物 `graph.graph.fingerprint` 的结构（FR-001 三分量）。 */
export interface CollectorFingerprint {
  /** 固定值 1：未来格式演进的判别锚点；本迭代不做多版本兼容解析（FR-016）。 */
  formatVersion: 1;
  extensionSurface: CollectorExtensionSurface;
  /** 维护者显式声明的行为版本；结构以外的采集行为变化靠手动 bump 体现（FR-004）。 */
  behaviorVersion: number;
}

/** bump 责任清单的单项（机器可读，供 SC-016 直接断言）。 */
export interface BehaviorVersionBumpResponsibility {
  /** 稳定标识（测试断言锚点，改名等同于改契约）。 */
  id: string;
  /** 人读说明：该类变化为什么落在 behaviorVersion 而非 extensionSurface 维度。 */
  description: string;
}

/** 当前唯一受支持的指纹格式版本。未知值不做兼容解析，直接归 invalid（FR-018）。 */
const SUPPORTED_FORMAT_VERSION = 1;

/**
 * 采集行为版本。**改动下列 `BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES` 覆盖的任一行为时 MUST +1。**
 *
 * 为什么不能自动推导："抽取逻辑是否发生了值得让既有图作废的变化"是语义判断而非结构信号
 * （FR-004）。护栏（FR-005 双轨重建对比）只能在忘记 bump 时给出软提示，不替代该判断。
 *
 * bump 记录：
 * - 2 ← 1（F255，`gitignore-interpretation`）：采集侧忽略判定从"手写根 `.gitignore` 近似解析"
 *   改为消费 `git ls-files --others --ignored --directory` 的在盘枚举（含嵌套 `.gitignore`、
 *   `.git/info/exclude`、全局 excludesFile 与 tracked 豁免），既有图产物的采集面口径已变，
 *   必须整体归 stale 后重建。（F258 措辞收口：此处原写"以 git 本体为事实源"，那句把两个回答
 *   不同问题的 git 命令混为一谈，盲区见 `src/utils/gitignore-oracle.ts` 文件头。）
 * - 3 ← 2（F259）：`collector-fingerprint-guardrail` fixture 基线扩充（新增
 *   `src/py/producer.py`/`consumer.py`，补齐 `#2 pyWalk` 管线对 depends-on/calls 边的独占
 *   覆盖样本，修补探针 C 证实的护栏盲区）。**非**采集器代码行为变化（六类 responsibility 均不
 *   适用，本身不改 `extensionSurface`）——是 fixture 本身作为"护栏验证的行为契约基线"，
 *   其内容变更依 `shouldRejectRegen` 判据的既定设计同样需要 bump 留痕，见
 *   `scripts/lib/collector-fingerprint-regen-predicate.mjs` 顶部 Q1 处置说明。
 */
export const BEHAVIOR_VERSION = 3;

/**
 * `BEHAVIOR_VERSION` 的 bump 责任范围（FR-004 六类条件）。
 *
 * 这份清单是**权威定义**而非注释复述：SC-016 直接 import 本常量逐类断言，因此"只改注释、
 * 忘了改清单"不会静默通过。`extensionSurface` 已自动覆盖"采集哪些扩展名"这一维度，本清单
 * 覆盖的是同样影响"哪些文件被计入"、但不体现在扩展名上的行为维度。
 */
export const BEHAVIOR_VERSION_BUMP_RESPONSIBILITIES: readonly BehaviorVersionBumpResponsibility[] = [
  {
    id: 'ignore-dirs-pruning',
    description:
      'ignore dirs 剪枝规则变化：增删被跳过的目录名、或改变剪枝时机（如从"进入后过滤"改为"遍历前剪枝"），都会改变被采集的文件集合',
  },
  {
    id: 'gitignore-interpretation',
    description:
      '.gitignore 规则解释变化：是否读取 .gitignore、negation/目录级模式的解释方式、多级 .gitignore 的叠加顺序变化',
  },
  {
    id: 'case-matching-strategy',
    description:
      '大小写匹配策略变化：某条管线从大小写敏感改为不敏感（或反向）。扩展名集合本身的增删由 extensionSurface 自动反映，但匹配语义的实现口径变化需在此声明',
  },
  {
    id: 'symlink-handling',
    description:
      'symlink 处理策略变化：是否跟随符号链接、是否按 realpath 去重、环路防护策略变化，都会改变实际被采集的文件集合',
  },
  {
    id: 'file-size-guard',
    description: '单文件 1MB size guard 调整：阈值上调/下调或改为按行数/字节以外的口径判定',
  },
  {
    id: 'collection-failure-degradation',
    description:
      '采集失败降级策略变化：单文件解析失败时跳过还是中止、是否记为部分成功、降级后是否仍写入图产物',
  },
];

/** `extensionSurface` 的固定 key 顺序：构造、校验、比较三处共用同一份顺序声明。 */
const EXTENSION_SURFACE_KEYS = [
  'tsjsSkeletonWalk',
  'pyWalk',
  'genericAdapters',
  'moduleDerivationScan',
  'pythonSymbolScan',
] as const satisfies readonly (keyof CollectorExtensionSurface)[];

/** 指纹顶层的完整 key 集合（严格校验用；与 `CollectorFingerprint` 字段一一对应）。 */
const FINGERPRINT_TOP_LEVEL_KEYS = [
  'formatVersion',
  'extensionSurface',
  'behaviorVersion',
] as const satisfies readonly (keyof CollectorFingerprint)[];

/** 单条管线条目的完整 key 集合（严格校验用）。 */
const SURFACE_ENTRY_KEYS = [
  'extensions',
  'matchSemantics',
] as const satisfies readonly (keyof CollectorExtensionSurfaceEntry)[];

/** 合法的匹配语义取值（与 SSoT 的 `ExtensionMatchSemantics` 对齐，供结构校验枚举判定）。 */
const VALID_MATCH_SEMANTICS: readonly string[] = ['case-sensitive', 'case-insensitive'];

/**
 * SSoT 的 `CollectorPipelineSurface` → 指纹条目。
 *
 * `[...set].sort()` 用默认比较器（UTF-16 码元序），**不用** `localeCompare`——后者随 locale
 * 变化，会破坏 FR-017 的跨环境 byte-identical 要求。
 */
function toSurfaceEntry(surface: CollectorPipelineSurface): CollectorExtensionSurfaceEntry {
  return {
    extensions: [...surface.extensions].sort(),
    matchSemantics: surface.matchSemantics,
  };
}

/**
 * 计算当前代码状态下的 collector fingerprint（FR-001/FR-008）。
 *
 * 每次调用返回全新对象（含全新数组），调用方可自由改写而不污染 SSoT 或后续调用。
 * 字段书写顺序即序列化顺序，MUST NOT 为"代码整洁"重排（FR-017 的确定性依赖此顺序）。
 */
export function computeCollectorFingerprint(): CollectorFingerprint {
  return {
    formatVersion: SUPPORTED_FORMAT_VERSION,
    extensionSurface: {
      tsjsSkeletonWalk: toSurfaceEntry(TSJS_SKELETON_WALK_SURFACE),
      pyWalk: toSurfaceEntry(PY_WALK_SURFACE),
      // 合并语义不一致时 mergeSurfaces 抛错，本函数不 catch：指纹阶段立刻暴露胜过静默产出错误分量
      genericAdapters: toSurfaceEntry(mergeSurfaces(JAVA_ADAPTER_SURFACE, GO_ADAPTER_SURFACE)),
      moduleDerivationScan: toSurfaceEntry(MODULE_DERIVATION_SCAN_SURFACE),
      pythonSymbolScan: toSurfaceEntry(PYTHON_SYMBOL_SCAN_SURFACE),
    },
    behaviorVersion: BEHAVIOR_VERSION,
  };
}

/** 非 null、非数组的普通对象判定（数组也是 object，必须显式排除）。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 读取一个**纯数据 own property**；不存在、非 own、或是 accessor（getter/setter）一律判失败。
 *
 * 为什么连"合法的 getter"也拒（W-005）：本函数的入参形态合同是"`JSON.parse` 产出的纯数据"，
 * 而 `JSON.parse` 永远不会产出 accessor。反过来说，带 accessor 的对象意味着**每次读取都可能
 * 返回不同值或抛错**——校验读到的值与后续比较读到的值可以不是同一个东西（TOCTOU）。
 * 与其试图"读一次就够"（下游任何一次重读都会重新打开这个洞），不如直接把"非纯数据"归为畸形：
 * 判定确定、单次求值、且不依赖调用链上每个人都记得别重读。
 *
 * 同理不用 `structuredClone`/`JSON.parse(JSON.stringify(...))` 做快照：那两者都会**调用** getter
 * （执行外部代码、可抛错、可返回不稳定值），只是把问题藏得更深。
 */
function readDataProperty(
  target: object,
  key: string | number,
): { ok: true; value: unknown } | { ok: false } {
  const descriptor = Object.getOwnPropertyDescriptor(target, String(key));
  if (descriptor === undefined || !('value' in descriptor)) {
    return { ok: false };
  }
  return { ok: true, value: descriptor.value };
}

/**
 * own **enumerable** data key 集合（供严格 key 集合比较）。
 *
 * 边界（刻意，非遗漏）：不枚举原型链 key，也不枚举 non-enumerable own key。判定口径对齐 JSON
 * 语义——`JSON.parse` 只产出 enumerable own data property，`JSON.stringify` 也只序列化这一类；
 * 一个 non-enumerable 的额外字段既不可能来自图产物，也不参与指纹的序列化身份。
 */
function ownDataKeysOf(target: object): string[] {
  return Object.keys(target).filter((key) => {
    const descriptor = Object.getOwnPropertyDescriptor(target, key);
    return descriptor !== undefined && 'value' in descriptor;
  });
}

/** key 集合精确相等判定（顺序无关，多一个/少一个都算不等）。 */
function keySetEquals(actual: readonly string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false;
  const actualSet = new Set(actual);
  return actualSet.size === expected.length && expected.every((key) => actualSet.has(key));
}

/** 解析单条管线条目为 plain snapshot；任一环不合规返回 null。 */
function parseSurfaceEntry(value: unknown): CollectorExtensionSurfaceEntry | null {
  if (!isPlainObject(value)) return null;
  // 严格 key 集合：条目层多出未知字段同样归 invalid（理由同顶层，见 parseCollectorFingerprint）
  if (!keySetEquals(ownDataKeysOf(value), SURFACE_ENTRY_KEYS)) return null;

  const rawExtensions = readDataProperty(value, 'extensions');
  const rawSemantics = readDataProperty(value, 'matchSemantics');
  if (!rawExtensions.ok || !rawSemantics.ok) return null;
  if (!Array.isArray(rawExtensions.value)) return null;
  if (typeof rawSemantics.value !== 'string' || !VALID_MATCH_SEMANTICS.includes(rawSemantics.value)) {
    return null;
  }

  const extensions: string[] = [];
  for (let index = 0; index < rawExtensions.value.length; index += 1) {
    const element = readDataProperty(rawExtensions.value, index);
    if (!element.ok || typeof element.value !== 'string') return null;
    extensions.push(element.value);
  }

  return {
    extensions,
    matchSemantics: rawSemantics.value as ExtensionMatchSemantics,
  };
}

/**
 * 把 `recordedFingerprint` 解析为**自有的 plain snapshot**；不合规返回 `null`（FR-018/W-005）。
 *
 * 这是本模块唯一的结构收口：`isValidCollectorFingerprint` 是它的布尔投影，`evaluateFreshness`
 * 则拿返回的 snapshot 去比较——**绝不**再回头访问原对象。这样"校验时看到的指纹"与"比较时看到的
 * 指纹"在物理上就是同一份数据，不存在两次读取之间被改写的窗口。
 *
 * 语义边界：
 * - 只判**结构**，不判"内容是否与当前代码一致"——后者是 `fingerprintsEqual` 的职责。
 * - `formatVersion` 非 1（含缺失、字符串 `'1'`、未来的 2）一律 `null`：本迭代不做多版本
 *   兼容解析（FR-016），"无法识别"是一个可判定的诊断结果（→ `collector-fingerprint-invalid`）。
 * - `behaviorVersion` 要求有限数值：JSON 无法编码 `NaN`/`Infinity`，出现即说明该值不是从图产物
 *   正常反序列化而来，按畸形处理。
 * - **严格 key 集合（C-001，推翻此前"未知 key 宽容"的裁决）**：顶层、`extensionSurface`、
 *   每条管线条目三层的 own key 集合都必须**精确等于**已知集合，多一个 key 同样归 invalid。
 *   原宽容口径的问题不在"是否礼貌"，而在于它恰好为**最危险的那类失误**开了通道：未来某个
 *   producer 新增一条管线（或给条目加字段）却忘了 bump `formatVersion`，宽容校验会判"合法"，
 *   而 `fingerprintsEqual` 只比较本版本已知字段 → 新旧指纹判"相等" → 一张实际已过期的图被判
 *   **fresh**。严格集合把这种失误变成一条明确的 `collector-fingerprint-invalid`（保守、可诊断），
 *   代价仅是"演进格式时必须同时 bump formatVersion"——而这本来就是 `formatVersion` 的用途。
 * - 入参来自外部 `JSON.parse`，理论上可能是 Proxy 等抛错形态，因此整体包**单个** `try/catch`
 *   兜底——FR-018 明确要求判定过程 MUST NOT 抛出未捕获异常。
 */
export function parseCollectorFingerprint(value: unknown): CollectorFingerprint | null {
  try {
    if (!isPlainObject(value)) return null;
    if (!keySetEquals(ownDataKeysOf(value), FINGERPRINT_TOP_LEVEL_KEYS)) return null;

    const rawFormatVersion = readDataProperty(value, 'formatVersion');
    const rawBehaviorVersion = readDataProperty(value, 'behaviorVersion');
    const rawSurface = readDataProperty(value, 'extensionSurface');
    if (!rawFormatVersion.ok || !rawBehaviorVersion.ok || !rawSurface.ok) return null;

    if (rawFormatVersion.value !== SUPPORTED_FORMAT_VERSION) return null;
    if (typeof rawBehaviorVersion.value !== 'number' || !Number.isFinite(rawBehaviorVersion.value)) {
      return null;
    }
    if (!isPlainObject(rawSurface.value)) return null;
    if (!keySetEquals(ownDataKeysOf(rawSurface.value), EXTENSION_SURFACE_KEYS)) return null;

    // 逐管线解析成 plain snapshot；字段书写顺序固定（同 computeCollectorFingerprint）
    const entries = {} as Record<(typeof EXTENSION_SURFACE_KEYS)[number], CollectorExtensionSurfaceEntry>;
    for (const key of EXTENSION_SURFACE_KEYS) {
      const rawEntry = readDataProperty(rawSurface.value, key);
      if (!rawEntry.ok) return null;
      const entry = parseSurfaceEntry(rawEntry.value);
      if (entry === null) return null;
      entries[key] = entry;
    }

    return {
      formatVersion: SUPPORTED_FORMAT_VERSION,
      extensionSurface: {
        tsjsSkeletonWalk: entries.tsjsSkeletonWalk,
        pyWalk: entries.pyWalk,
        genericAdapters: entries.genericAdapters,
        moduleDerivationScan: entries.moduleDerivationScan,
        pythonSymbolScan: entries.pythonSymbolScan,
      },
      behaviorVersion: rawBehaviorVersion.value,
    };
  } catch {
    // 属性访问自身抛错（Proxy 陷阱等）：归为畸形，不向上传播
    return null;
  }
}

/**
 * `parseCollectorFingerprint` 的布尔投影（FR-018）：只需要"是否合法"时用它。
 *
 * 需要拿指纹继续做比较的调用方 MUST 用 `parseCollectorFingerprint` 并消费其返回的 snapshot，
 * **不要** `isValid...` 之后再拿原对象去比较——那正是 W-005 修掉的二次读取模式。
 */
export function isValidCollectorFingerprint(value: unknown): boolean {
  return parseCollectorFingerprint(value) !== null;
}

/** 重建单条条目的 canonical 形态（固定键序 + 数组排序），不改写入参。 */
function canonicalizeEntry(entry: CollectorExtensionSurfaceEntry): CollectorExtensionSurfaceEntry {
  return {
    extensions: [...entry.extensions].sort(),
    matchSemantics: entry.matchSemantics,
  };
}

/** 重建整份指纹的 canonical 形态：比较前把"字面书写差异"这一维度彻底消掉。 */
function canonicalizeFingerprint(fingerprint: CollectorFingerprint): CollectorFingerprint {
  return {
    formatVersion: fingerprint.formatVersion,
    extensionSurface: {
      tsjsSkeletonWalk: canonicalizeEntry(fingerprint.extensionSurface.tsjsSkeletonWalk),
      pyWalk: canonicalizeEntry(fingerprint.extensionSurface.pyWalk),
      genericAdapters: canonicalizeEntry(fingerprint.extensionSurface.genericAdapters),
      moduleDerivationScan: canonicalizeEntry(fingerprint.extensionSurface.moduleDerivationScan),
      pythonSymbolScan: canonicalizeEntry(fingerprint.extensionSurface.pythonSymbolScan),
    },
    behaviorVersion: fingerprint.behaviorVersion,
  };
}

/**
 * 两份指纹是否语义相等（W-01：canonical 化后逐字段深比较，非 `JSON.stringify` 字符串相等）。
 *
 * 调用约定：`a` 通常来自 `parseCollectorFingerprint(recordedFingerprint)` 的返回 snapshot，
 * 调用前 MUST 先经该函数收口——本函数假定两侧结构已合法，只回答"内容是否一致"，且
 * **MUST NOT** 拿未经解析的外部对象直接传入（W-005：会重新引入"校验读一次、比较读另一次"）。
 * 比较对称且为纯函数：不改写任一入参（canonical 化在副本上进行）。
 */
export function fingerprintsEqual(a: CollectorFingerprint, b: CollectorFingerprint): boolean {
  const left = canonicalizeFingerprint(a);
  const right = canonicalizeFingerprint(b);

  if (left.formatVersion !== right.formatVersion) {
    return false;
  }
  if (left.behaviorVersion !== right.behaviorVersion) {
    return false;
  }
  return EXTENSION_SURFACE_KEYS.every((key) =>
    surfaceEntriesEqual(left.extensionSurface[key], right.extensionSurface[key]),
  );
}

/** canonical 化之后的条目比较：匹配语义相同 + 扩展名数组逐位相同。 */
function surfaceEntriesEqual(
  left: CollectorExtensionSurfaceEntry,
  right: CollectorExtensionSurfaceEntry,
): boolean {
  if (left.matchSemantics !== right.matchSemantics) {
    return false;
  }
  if (left.extensions.length !== right.extensions.length) {
    return false;
  }
  return left.extensions.every((extension, index) => extension === right.extensions[index]);
}
