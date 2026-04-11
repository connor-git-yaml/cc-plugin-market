/**
 * 目录分类器
 * 基于三信号组合（目录名模式 + 文件内容特征 + Import 反向引用）
 * 对目录进行分类：source / test / example / vendor / config / docs
 * 支持用户通过项目配置覆盖自动分类结果（FR-005, FR-006, FR-013）
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================================================
// 类型定义
// ============================================================

/**
 * 目录分类枚举
 * source：核心源码目录（生成 spec 的目标）
 * test：测试目录
 * example：示例/演示代码
 * vendor：第三方依赖或打包产物
 * config：配置文件目录
 * docs：文档目录
 */
export type DirectoryCategory = 'source' | 'test' | 'example' | 'vendor' | 'config' | 'docs';

/**
 * 目录分类结果
 */
export interface DirectoryClassification {
  /** 目录路径（相对于项目根或绝对路径） */
  dirPath: string;
  /** 分类结果 */
  category: DirectoryCategory;
  /** 分类置信度（0-1） */
  confidence: number;
  /** 分类依据（用于调试和审计） */
  signals: DirectorySignal[];
  /** 是否为用户覆盖（user override） */
  isUserOverride: boolean;
}

/**
 * 分类信号（单个证据）
 */
export interface DirectorySignal {
  /** 信号类型 */
  type: 'name_pattern' | 'content_feature' | 'import_reference';
  /** 信号指向的分类 */
  suggestedCategory: DirectoryCategory;
  /** 信号权重（0-1） */
  weight: number;
  /** 信号描述 */
  description: string;
}

/**
 * 目录分类选项
 */
export interface DirectoryClassifierOptions {
  /**
   * 用户显式排除的目录（优先级最高，强制分类为非 source）
   * 支持精确目录名或 glob 前缀
   */
  excludeDirs?: string[];
  /**
   * 用户显式包含的目录（即使被自动排除，也强制分类为 source）
   */
  includeDirs?: string[];
  /**
   * 最低置信度阈值（低于此值时保守地归为 source）
   * 默认 0.6
   */
  minConfidence?: number;
}

// ============================================================
// 目录名称模式
// ============================================================

/** 测试目录名称模式（高权重） */
const TEST_DIR_PATTERNS = [
  'test', 'tests', '__tests__', 'spec', 'specs', '__spec__',
  'e2e', 'integration', 'unit', 'jest', 'mocha', 'pytest',
];

/** 示例/演示目录名称模式（高权重） */
const EXAMPLE_DIR_PATTERNS = [
  'example', 'examples', 'demo', 'demos', 'sample', 'samples',
  'worked', 'worked-example', 'worked-examples', 'tutorial', 'tutorials',
  'playground', 'sandbox',
];

/** vendor/第三方目录名称模式（高权重） */
const VENDOR_DIR_PATTERNS = [
  'vendor', 'vendors', 'third_party', 'third-party', 'thirdparty',
  'node_modules', '__pycache__', '.venv', 'venv', 'env',
  'site-packages', 'dist', 'build', 'out', '.next', '.nuxt',
  'generated', 'gen', 'dist-cjs', 'dist-esm',
];

/** 配置目录名称模式（中权重） */
const CONFIG_DIR_PATTERNS = [
  'config', 'configs', 'conf', 'settings', 'configuration',
  '.github', '.circleci', '.jenkins',
];

/** 文档目录名称模式（中权重） */
const DOCS_DIR_PATTERNS = [
  'docs', 'doc', 'documentation', 'wiki', 'pages', 'website',
  'gh-pages', 'site', 'manual',
];

/** fixtures/测试数据目录名称模式（高权重） */
const FIXTURE_DIR_PATTERNS = [
  'fixtures', '__fixtures__', 'testdata', 'test-fixtures',
  'testfiles', 'test-data', 'snapshots', '__snapshots__',
];

// ============================================================
// 辅助函数
// ============================================================

/**
 * 根据目录名称判断分类信号
 * 返回置信度最高的信号（若无匹配则返回 null）
 */
function getNamePatternSignal(dirName: string): DirectorySignal | null {
  const lowerName = dirName.toLowerCase().replace(/[-_.]/g, '');

  // 优先级：vendor > example/fixture > test > config > docs
  const checks: Array<{ patterns: string[]; category: DirectoryCategory; weight: number }> = [
    { patterns: VENDOR_DIR_PATTERNS, category: 'vendor', weight: 0.9 },
    { patterns: EXAMPLE_DIR_PATTERNS, category: 'example', weight: 0.85 },
    { patterns: FIXTURE_DIR_PATTERNS, category: 'test', weight: 0.85 },
    { patterns: TEST_DIR_PATTERNS, category: 'test', weight: 0.8 },
    { patterns: DOCS_DIR_PATTERNS, category: 'docs', weight: 0.75 },
    { patterns: CONFIG_DIR_PATTERNS, category: 'config', weight: 0.7 },
  ];

  for (const { patterns, category, weight } of checks) {
    for (const pattern of patterns) {
      const normalizedPattern = pattern.replace(/[-_.]/g, '');
      if (lowerName === normalizedPattern || lowerName.startsWith(normalizedPattern)) {
        return {
          type: 'name_pattern',
          suggestedCategory: category,
          weight,
          description: `目录名 "${dirName}" 匹配 ${category} 模式 "${pattern}"`,
        };
      }
    }
  }

  return null;
}

/**
 * 检测目录内是否含有 minified/打包产物（vendor 信号）
 * 采样检测：只读前 3 个文件
 */
function getContentFeatureSignal(dirPath: string): DirectorySignal | null {
  try {
    const entries = fs.readdirSync(dirPath).slice(0, 10);
    let minifiedCount = 0;
    let checkedCount = 0;

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry);
      try {
        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;

        // 只检测 JS/CSS 文件
        if (!/\.(js|css|mjs|cjs)$/.test(entry)) continue;

        // 采样：只读前 2KB
        const fd = fs.openSync(fullPath, 'r');
        const buf = Buffer.alloc(2048);
        const bytesRead = fs.readSync(fd, buf, 0, 2048, 0);
        fs.closeSync(fd);

        const content = buf.toString('utf-8', 0, bytesRead);
        const lines = content.split('\n').filter((l) => l.length > 0);

        if (lines.length > 0) {
          const longLineCount = lines.filter((l) => l.length > 500).length;
          if (longLineCount / lines.length > 0.5) {
            minifiedCount++;
          }
          checkedCount++;
        }

        if (checkedCount >= 3) break;
      } catch {
        // 单文件读取失败时跳过
      }
    }

    if (checkedCount > 0 && minifiedCount / checkedCount > 0.5) {
      return {
        type: 'content_feature',
        suggestedCategory: 'vendor',
        weight: 0.85,
        description: `目录 "${path.basename(dirPath)}" 含 ${minifiedCount}/${checkedCount} 个 minified 文件`,
      };
    }
  } catch {
    // 目录读取失败时跳过
  }

  return null;
}

/**
 * 根据 Import 反向引用判断是否为核心源码目录
 * 如果该目录被其他目录的文件 import，则为 source 的强信号
 *
 * @param dirPath - 目标目录路径（相对路径）
 * @param importingFiles - 所有导入了该目录模块的文件路径集合
 */
function getImportReferenceSignal(
  dirPath: string,
  importingFiles: Set<string>,
): DirectorySignal | null {
  if (importingFiles.size === 0) return null;

  // 被多处导入 → 强 source 信号
  const weight = Math.min(0.95, 0.6 + importingFiles.size * 0.05);
  return {
    type: 'import_reference',
    suggestedCategory: 'source',
    weight,
    description: `目录 "${path.basename(dirPath)}" 被 ${importingFiles.size} 个外部文件 import`,
  };
}

/**
 * 综合多信号，计算最终分类结果
 * 规则：
 * 1. import_reference（source 信号）可以覆盖名称判定（除非权重差距 > 0.3）
 * 2. 同类别信号权重叠加
 * 3. 最高权重类别获胜
 */
function aggregateSignals(
  signals: DirectorySignal[],
  defaultCategory: DirectoryCategory = 'source',
): { category: DirectoryCategory; confidence: number } {
  if (signals.length === 0) {
    return { category: defaultCategory, confidence: 0.5 };
  }

  // 按类别聚合权重（取最大值，而非求和，避免多弱信号压倒强信号）
  const categoryWeights = new Map<DirectoryCategory, number>();
  for (const signal of signals) {
    const current = categoryWeights.get(signal.suggestedCategory) ?? 0;
    categoryWeights.set(signal.suggestedCategory, Math.max(current, signal.weight));
  }

  // 找最高权重类别
  let bestCategory: DirectoryCategory = defaultCategory;
  let bestWeight = 0;

  for (const [cat, weight] of categoryWeights) {
    if (weight > bestWeight) {
      bestWeight = weight;
      bestCategory = cat;
    }
  }

  return { category: bestCategory, confidence: bestWeight };
}

// ============================================================
// 核心 API
// ============================================================

/**
 * 对单个目录进行分类
 *
 * @param dirPath - 目录路径
 * @param importingFiles - 外部文件对该目录的 import 引用集合（用于 import 信号）
 * @param options - 分类选项（用户覆盖等）
 * @returns 目录分类结果
 */
export function classifyDirectory(
  dirPath: string,
  importingFiles: Set<string> = new Set(),
  options: DirectoryClassifierOptions = {},
): DirectoryClassification {
  const dirName = path.basename(dirPath);
  const { excludeDirs = [], includeDirs = [], minConfidence = 0.6 } = options;

  // 目录规则匹配辅助函数
  const matchesDirRule = (dp: string, dn: string, rule: string): boolean =>
    dp.endsWith(rule) || dn === rule || dp.includes(`/${rule}/`) || dp.includes(`\\${rule}\\`);

  // 用户 includeDirs 优先级最高：强制 source（即使同时出现在 excludeDirs 中）
  if (includeDirs.some((d) => matchesDirRule(dirPath, dirName, d))) {
    return {
      dirPath,
      category: 'source',
      confidence: 1.0,
      signals: [{ type: 'name_pattern', suggestedCategory: 'source', weight: 1.0, description: '用户配置 includeDirs 强制包含' }],
      isUserOverride: true,
    };
  }

  // 用户 excludeDirs：强制非 source（includeDirs 之后检查）
  if (excludeDirs.some((d) => matchesDirRule(dirPath, dirName, d))) {
    return {
      dirPath,
      category: 'example',
      confidence: 1.0,
      signals: [{ type: 'name_pattern', suggestedCategory: 'example', weight: 1.0, description: '用户配置 excludeDirs 强制排除' }],
      isUserOverride: true,
    };
  }

  // 收集信号
  const signals: DirectorySignal[] = [];

  // 信号 1：目录名模式
  const nameSignal = getNamePatternSignal(dirName);
  if (nameSignal) signals.push(nameSignal);

  // 信号 2：文件内容特征（仅对可访问目录）
  if (fs.existsSync(dirPath)) {
    const contentSignal = getContentFeatureSignal(dirPath);
    if (contentSignal) signals.push(contentSignal);
  }

  // 信号 3：Import 反向引用
  const importSignal = getImportReferenceSignal(dirPath, importingFiles);
  if (importSignal) signals.push(importSignal);

  // 综合信号
  const { category, confidence } = aggregateSignals(signals);

  // 置信度低于阈值时保守归为 source
  const finalCategory = confidence >= minConfidence ? category : 'source';

  return {
    dirPath,
    category: finalCategory,
    confidence,
    signals,
    isUserOverride: false,
  };
}

/**
 * 批量对目录列表进行分类
 *
 * @param dirPaths - 目录路径数组
 * @param importGraphEdges - 模块间 import 边（{from: 导入方文件路径, to: 被导入目录路径}）
 * @param options - 分类选项
 * @returns 每个目录的分类结果
 */
export function classifyDirectories(
  dirPaths: string[],
  importGraphEdges: Array<{ from: string; to: string }> = [],
  options: DirectoryClassifierOptions = {},
): DirectoryClassification[] {
  // 构建 dirPath → 导入该目录的外部文件集合
  // 优化：先对每条 edge 确定属于哪个目录，避免 O(m²*n) 嵌套遍历
  const importerMap = new Map<string, Set<string>>();
  for (const dirPath of dirPaths) {
    importerMap.set(dirPath, new Set());
  }

  // 按路径长度降序排列，确保最深匹配优先（子目录优先于父目录）
  const sortedDirs = [...dirPaths].sort((a, b) => b.length - a.length);

  for (const edge of importGraphEdges) {
    if (!edge.from || !edge.to) continue;
    // 找到 edge.to 所属的目录（O(k) 其中 k = 目录数）
    const targetDir = sortedDirs.find(d => edge.to.startsWith(d));
    if (targetDir && !edge.from.startsWith(targetDir)) {
      importerMap.get(targetDir)?.add(edge.from);
    }
  }

  return dirPaths.map((dirPath) =>
    classifyDirectory(dirPath, importerMap.get(dirPath) ?? new Set(), options)
  );
}
