/**
 * F272 ④ T-B09：四语言 pinned graph 陈旧检测（US3 / FR-004 / 决策 2）。
 *
 * 与 `graph-quality-lang-matrix.test.ts` 的区别（两种不同失败语义，见 plan.md 决策 2）：
 * lang-matrix 断言的是"pinned 文件自身的手推数值是否正确"（fixture-value 正确性）；
 * 本文件断言的是"pinned 文件是否仍代表当前 builder 的行为"（fixture-freshness）——
 * 前者红了说明 README 手推错了或 fixture 被误改，后者红了说明 builder 行为变了但没人同步
 * fixture。这是本仓 F272 之前**从未存在过**的检查：④ 实证 TS/JS pinned 图曾静默陈旧
 * （F242/F260 调用边覆盖增强后，实际边数已从 11 涨到 14，但 lang-matrix 断言仍绿——
 * 因为它断言的是 pinned 文件自身，不是重建结果）。
 *
 * 语言 → 数据源分类是结构性事实（这份 fixture 的源码放在仓内还是外部 clone），与"运行时
 * 是否可验证"解耦：TS/JS、Java、Go 源在仓内，任何环境都必须能重建并验证零差异，不允许
 * 因任何原因降级为 skip；Python（micrograd）源依赖外部 clone
 * `~/.spectra-baselines/micrograd`（或 `SPECTRA_BASELINE_HOME` 覆盖），运行时动态探测：
 * clone 不存在 → 诚实报告"无法验证"并给出具体缺失路径（不是空泛的"跳过"）；clone 存在
 * → 真的重建对比（F266 教训：不能因为"暂时测不了"就伪装成固定结论，硬编码"Python 恒
 * unverifiable" 在已 clone baseline 的开发机上是诚实性倒退）。
 *
 * 比较逻辑（异构对抗审查 F272 缺陷 1 后重写，MUST NOT 再退回窄比较）：早期版本复用
 * `scripts/regen-collector-fingerprint-fixtures.ts` 导出的 `compareGraphOnlyStructure`——
 * 但那个比较器只看节点 id multiset 与边 `source|relation|target` multiset，`kind`/`label`/
 * `metadata`/`confidence` 等属性字段、以及 `graph.fingerprint`（F249 采集面指纹）/
 * `graph.nodeCount`/`graph.edgeCount` 等 `graph.*` 元数据字段全部不参与比较——这恰恰是
 * pinned 资产陈旧的核心信号（F249 指纹形状演进却没人重生成 fixture 正是本类问题的典型
 * 触发面）。本文件改为**全字段深比较**（`compareGraphDeep`），唯一排除 `graph.builder`：
 * 该字段跟踪宿主仓库/dist 构建戳（`commit`/`dirty`/`sourceDirty`/`distSha256`，F261 引入），
 * 每次 commit 或本地重建 dist 都会变化，与"这份 pinned 是否代表当前 builder **行为**"无关——
 * 这正是 F261 D1「builder 戳只可见不判定」不变量在本守卫里的体现。经实测同一 fixture 连续
 * 两次 `graph-only` 重建，节点/边数组顺序稳定、内容逐字节一致（JSON 归一化后 diff 为空），
 * 因此可以直接按数组下标做深比较，不需要为 nodes/links 额外做 multiset 归一化。
 *
 * 之所以在本文件内自行实现深比较，而不是从 `regen-collector-fingerprint-fixtures.ts` 里
 * 导出并复用其内部的 `collectDeepDifferences`：那个脚本是 F249 双轨护栏的**唯一**写盘入口
 * （见其文件头注释），职责边界清楚，不应为了给本文件复用一个私有函数而改变其导出面；
 * 两处深比较算法结构相同（数组按下标递归、对象按键集合并递归、叶子值 `!==` 判定 + 字段路径
 * 标注），保持独立实现的维护成本远低于跨职责耦合的风险。该脚本本身已有 `invokedDirectly()`
 * 守卫，import 时不触发 CLI 主流程，可安全在 vitest 测试里 import（`tests/unit/
 * pinned-asset-swap.test.ts` 已有先例）；本文件目前只 import 其 `runGraphOnlyBatch` 之外的
 * CLI 子进程重建逻辑保持独立，不再 import 该脚本的比较器。
 */
import { describe, expect, it, beforeAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { assertDistBuilt } from '../helpers/dist-cli-guard.js';
import type { GraphJSON } from '../../src/panoramic/graph/graph-types.js';

const CLI_PATH = path.resolve('dist/cli/index.js');

/**
 * 语言 → 数据源声明（单一事实源，异构对抗审查 F272 缺陷 4 后重写）。
 *
 * 早期版本把"分类表"（`FIXTURE_SOURCE_CLASSIFICATION`）与"describe.each 的数据源"
 * 分成两份硬编码字面量，二者从不互相校验，也不对照磁盘实际存在的 pinned 资产——新增一份
 * pinned fixture 却忘了同步这两处，不会有任何测试变红（自指恒真式：只断言这两份手写列表
 * 彼此一致，从未验证它们与磁盘状态一致）。本版本改为单一声明表 `FIXTURE_SOURCE_DECLARATIONS`
 * 同时承担分类 + describe.each 数据源两个角色，并新增一条断言：磁盘上枚举到的每一份
 * `tests/fixtures/*-graph/graph.json`（或 `*-baseline-graph/graph.json`）pinned 资产
 * MUST 都能在本表中找到对应条目——新增 fixture 目录却忘了声明，这条断言会当场失败，
 * 这才是文件头注释"逼迫维护者显式声明"想要的机制。
 */
interface FixtureSourceDeclaration {
  language: string;
  classification: 'in-repo' | 'external-clone';
  /** pinned `graph.json` 所在目录，相对仓库根（不含文件名）。 */
  pinnedDir: string;
  /** `classification === 'in-repo'` 时必填：待重建的源码目录，相对仓库根。 */
  sourceDir?: string;
}

const FIXTURE_SOURCE_DECLARATIONS: FixtureSourceDeclaration[] = [
  {
    language: 'TS/JS',
    classification: 'in-repo',
    pinnedDir: 'tests/fixtures/graph-quality-ts-graph',
    sourceDir: 'tests/fixtures/graph-quality-ts',
  },
  {
    language: 'Java',
    classification: 'in-repo',
    pinnedDir: 'tests/fixtures/graph-quality-java-graph',
    sourceDir: 'tests/fixtures/graph-quality-java',
  },
  {
    language: 'Go',
    classification: 'in-repo',
    pinnedDir: 'tests/fixtures/graph-quality-go-graph',
    sourceDir: 'tests/fixtures/graph-quality-go',
  },
  {
    language: 'Python',
    classification: 'external-clone',
    pinnedDir: 'tests/fixtures/micrograd-baseline-graph',
  },
];

const EXTERNAL_CLONE_LANGUAGES = FIXTURE_SOURCE_DECLARATIONS.filter(
  (declaration) => declaration.classification === 'external-clone',
).map((declaration) => declaration.language);

/**
 * 磁盘枚举：`tests/fixtures/` 下每一个直接子目录，若其内恰好存在一份 `graph.json`，
 * 即视为一份"pinned graph 资产"（相对仓库根路径，含目录名不含文件名）。
 *
 * 只匹配文件名精确为 `graph.json`：`tests/fixtures/collector-fingerprint-guardrail/` 下的
 * 两份资产文件名是 `expected-graph-only-graph.json`/`expected-module-graph.json`，
 * 不叫 `graph.json`，天然被排除——它们是 F249 双轨护栏链路的资产，不是本文件要盯的
 * "语言 pinned graph"家族，不需要额外的目录名黑名单。
 */
function enumeratePinnedGraphDirs(): string[] {
  const fixturesRoot = path.resolve('tests/fixtures');
  const repoRoot = path.resolve('.');
  const dirs: string[] = [];
  for (const entry of fs.readdirSync(fixturesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(fixturesRoot, entry.name, 'graph.json');
    if (fs.existsSync(candidate)) {
      dirs.push(path.relative(repoRoot, path.join(fixturesRoot, entry.name)).split(path.sep).join('/'));
    }
  }
  return dirs.sort();
}

interface PinnedStalenessResult {
  language: string;
  classification: 'in-repo' | 'external-clone';
  status: 'verified' | 'stale' | 'unverifiable:external-source';
  pinnedPath: string;
  differences: string[];
  unverifiableReason?: string;
}

function runGraphOnlyBatch(sourceDir: string, outputDir: string): void {
  execFileSync('node', [CLI_PATH, 'batch', sourceDir, '--mode', 'graph-only', '--output-dir', outputDir], {
    encoding: 'utf-8',
    timeout: 60_000,
  });
}

/** 把目录内容（含点前缀文件，如 `.gitignore`）复制到临时目录——`fs.cpSync` 默认即包含点前缀条目。 */
function stageIntoTemp(sourceDir: string, prefix: string): string {
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.cpSync(sourceDir, staged, { recursive: true });
  return staged;
}

/**
 * pinned 资产全字段深比较字段路径排除表。仅 `graph.builder` 一条：见文件头注释
 * （F261 D1「builder 戳只可见不判定」——该字段跟踪的是宿主仓库/dist 构建戳而非采集行为）。
 */
const DEEP_COMPARE_EXCLUDED_PATHS = new Set<string>(['graph.builder']);

/**
 * 递归差异收集：数组按下标逐一比较（已实测同一 fixture 连续两次 graph-only 重建顺序稳定），
 * 对象按键并集排序后逐一比较，叶子值用 `!==` 判定。差异文案含完整字段路径，便于直接定位
 * 是哪个字段漂移了（如 `graph.fingerprint.behaviorVersion: 值不一致（重建 3 vs pinned 999）`）。
 */
function collectPinnedGraphDifferences(
  left: unknown,
  right: unknown,
  pathLabel: string,
  differences: string[],
): void {
  if (DEEP_COMPARE_EXCLUDED_PATHS.has(pathLabel)) return;

  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right)) {
      differences.push(`${pathLabel}: 一侧是数组另一侧不是`);
      return;
    }
    if (left.length !== right.length) {
      differences.push(`${pathLabel}: 数组长度不一致（重建 ${left.length} vs pinned ${right.length}）`);
    }
    for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
      collectPinnedGraphDifferences(left[index], right[index], `${pathLabel}[${index}]`, differences);
    }
    return;
  }

  const leftIsObject = typeof left === 'object' && left !== null;
  const rightIsObject = typeof right === 'object' && right !== null;
  if (leftIsObject || rightIsObject) {
    if (!leftIsObject || !rightIsObject) {
      differences.push(`${pathLabel}: 一侧是对象另一侧不是`);
      return;
    }
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(leftRecord), ...Object.keys(rightRecord)])].sort();
    for (const key of keys) {
      const childPath = pathLabel === '' ? key : `${pathLabel}.${key}`;
      collectPinnedGraphDifferences(leftRecord[key], rightRecord[key], childPath, differences);
    }
    return;
  }

  if (left !== right) {
    differences.push(`${pathLabel}: 值不一致（重建 ${JSON.stringify(left)} vs pinned ${JSON.stringify(right)}）`);
  }
}

function compareGraphDeep(rebuilt: GraphJSON, pinned: GraphJSON): { mismatch: boolean; differences: string[] } {
  const differences: string[] = [];
  collectPinnedGraphDifferences(rebuilt as unknown, pinned as unknown, '', differences);
  return { mismatch: differences.length > 0, differences };
}

/** in-repo 语言：无条件重建 + 全字段深比较（`compareGraphDeep`，排除 `graph.builder`）。 */
function verifyInRepoLanguage(language: string, sourceDir: string, pinnedPath: string): PinnedStalenessResult {
  const staged = stageIntoTemp(sourceDir, `f272-pinned-staleness-${language.replace(/[^a-z0-9]/gi, '-')}-`);
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f272-pinned-staleness-out-'));
  try {
    runGraphOnlyBatch(staged, outputDir);
    const rebuilt = JSON.parse(
      fs.readFileSync(path.join(outputDir, '_meta', 'graph.json'), 'utf-8'),
    ) as GraphJSON;
    const pinned = JSON.parse(fs.readFileSync(pinnedPath, 'utf-8')) as GraphJSON;
    const comparison = compareGraphDeep(rebuilt, pinned);
    return {
      language,
      classification: 'in-repo',
      status: comparison.mismatch ? 'stale' : 'verified',
      pinnedPath,
      differences: comparison.differences,
    };
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

/**
 * Python（external-clone）：运行时动态探测源 clone 是否存在。
 *
 * 不存在 → `unverifiable:external-source`，reason 含具体探测路径；
 * 存在 → 真的重建 + 对比（不硬编码"恒不可验证"）。
 */
function verifyPythonLanguage(pinnedPath: string): PinnedStalenessResult {
  const baselineHome = process.env.SPECTRA_BASELINE_HOME ?? path.join(os.homedir(), '.spectra-baselines');
  const sourceDir = path.join(baselineHome, 'micrograd');

  if (!fs.existsSync(sourceDir)) {
    return {
      language: 'Python',
      classification: 'external-clone',
      status: 'unverifiable:external-source',
      pinnedPath,
      differences: [],
      unverifiableReason:
        `外部源 clone 不存在: ${sourceDir}（可设置 SPECTRA_BASELINE_HOME 环境变量覆盖家目录，` +
        '或参照 scripts/baselines/clone-baseline-projects.sh 手动 clone micrograd 后重跑）',
    };
  }

  // rsync 语义等价：剔除 specs/、Users/、.git 等非源码杂质目录（与
  // tests/fixtures/micrograd-baseline-graph/README.md 的生成命令一致）。
  const staged = fs.mkdtempSync(path.join(os.tmpdir(), 'f272-pinned-staleness-python-'));
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'f272-pinned-staleness-python-out-'));
  try {
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      if (entry.name === '.git' || entry.name === 'specs' || entry.name === 'Users') continue;
      fs.cpSync(path.join(sourceDir, entry.name), path.join(staged, entry.name), { recursive: true });
    }
    runGraphOnlyBatch(staged, outputDir);
    const rebuilt = JSON.parse(
      fs.readFileSync(path.join(outputDir, '_meta', 'graph.json'), 'utf-8'),
    ) as GraphJSON;
    const pinned = JSON.parse(fs.readFileSync(pinnedPath, 'utf-8')) as GraphJSON;
    const comparison = compareGraphDeep(rebuilt, pinned);
    return {
      language: 'Python',
      classification: 'external-clone',
      status: comparison.mismatch ? 'stale' : 'verified',
      pinnedPath,
      differences: comparison.differences,
    };
  } finally {
    fs.rmSync(staged, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
}

const IN_REPO_DECLARATIONS = FIXTURE_SOURCE_DECLARATIONS.filter(
  (declaration): declaration is FixtureSourceDeclaration & { sourceDir: string } =>
    declaration.classification === 'in-repo',
);

const PYTHON_DECLARATION = FIXTURE_SOURCE_DECLARATIONS.find((declaration) => declaration.language === 'Python');
if (PYTHON_DECLARATION === undefined) {
  throw new Error('FIXTURE_SOURCE_DECLARATIONS 缺少 Python 声明条目（不应发生，声明表被意外改动）');
}
const PYTHON_PINNED_PATH = path.resolve(PYTHON_DECLARATION.pinnedDir, 'graph.json');

describe('pinned graph 陈旧检测（F272 ④，四语言逐资产核验状态表）', () => {
  beforeAll(() => {
    assertDistBuilt();
  });

  it('磁盘枚举到的每一份 pinned graph 资产都必须在分类声明表中有对应条目（防止新增 fixture 忘记声明）', () => {
    const diskPinnedDirs = enumeratePinnedGraphDirs();
    const declaredPinnedDirs = FIXTURE_SOURCE_DECLARATIONS.map((declaration) => declaration.pinnedDir).sort();
    expect(diskPinnedDirs).toEqual(declaredPinnedDirs);
  });

  it('external-clone 集合恒等于 [\'Python\']（防止未核验集合悄悄变大）', () => {
    expect(EXTERNAL_CLONE_LANGUAGES).toEqual(['Python']);
  });

  describe.each(
    IN_REPO_DECLARATIONS.map((declaration) => ({
      language: declaration.language,
      sourceDir: path.resolve(declaration.sourceDir),
      pinnedPath: path.resolve(declaration.pinnedDir, 'graph.json'),
    })),
  )('$language（in-repo，无条件重建，不允许因任何原因降级为 skip）', ({ language, sourceDir, pinnedPath }) => {
    it('重建产物与 pinned 全字段深比较一致（零差异，排除 graph.builder）', () => {
      const result = verifyInRepoLanguage(language, sourceDir, pinnedPath);
      if (result.status !== 'verified') {
        // 显式打印差异，失败信息不能只说"不一致"——要能直接定位是哪个字段/哪条边漂移了
        // eslint-disable-next-line no-console
        console.error(`[pinned-staleness] ${language} 差异明细:\n${result.differences.join('\n')}`);
      }
      expect(result.status).toBe('verified');
      expect(result.differences).toEqual([]);
    });
  });

  describe('Python（external-clone，动态探测 ~/.spectra-baselines/micrograd 或 SPECTRA_BASELINE_HOME 覆盖）', () => {
    it('clone 存在则真实重建对比，不存在则诚实报告具体缺失路径（不允许硬编码恒不可验证）', () => {
      const result = verifyPythonLanguage(PYTHON_PINNED_PATH);

      if (result.status === 'unverifiable:external-source') {
        // 诚实的"无法验证"结论，不判定为失败——但必须给出具体缺失路径，且这条路径必须在
        // CI 日志里可见（F272 异构对抗审查缺陷 5：早期版本只断言不打印，CI 上这份 Python
        // fixture 从未被真的验证过，却没有任何输出提示"这一份没验"，与 F266「诚实缺席优于
        // 静默跳过」的要求矛盾）。
        // eslint-disable-next-line no-console
        console.warn(`[pinned-staleness] Python 未核验（诚实缺席，非静默跳过）: ${result.unverifiableReason}`);
        expect(result.unverifiableReason).toBeDefined();
        // 断言与被测函数（verifyPythonLanguage）同源计算期望路径，而不是硬编码
        // `os.homedir()`——被测函数支持 `SPECTRA_BASELINE_HOME` 覆盖家目录（文档化行为，
        // 见 scripts/baselines/clone-baseline-projects.sh 与本文件头注释），若断言侧写死
        // `os.homedir()`，在设置了 SPECTRA_BASELINE_HOME 的环境（含 CI）下用文档支持的方式
        // 配置反而会让这条断言假红。
        const expectedBaselineHome = process.env.SPECTRA_BASELINE_HOME ?? path.join(os.homedir(), '.spectra-baselines');
        expect(result.unverifiableReason).toContain(path.join(expectedBaselineHome, 'micrograd'));
        return;
      }

      // clone 存在 → 真实执行了重建对比：stale 时打印具体差异并 MUST 失败，不允许静默通过
      if (result.status === 'stale') {
        // eslint-disable-next-line no-console
        console.error(`[pinned-staleness] Python 差异明细:\n${result.differences.join('\n')}`);
      }
      expect(result.status).toBe('verified');
      expect(result.differences).toEqual([]);
    });
  });
});
