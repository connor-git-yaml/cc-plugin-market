/**
 * Feature 152 — Python Import Path 智能解析
 *
 * 提供 Python 的 import 路径解析能力，供 batch-orchestrator 的
 * collectPythonCodeSkeletons（P3）调用。
 *
 * Feature 181 收口说明：
 * - TypeScript/JavaScript 的 resolveTsJsImport + tsconfig loader（findNearestTsConfig /
 *   buildTsConfigContext）+ 共享类型/辅助（ResolveResult / toPosix / isInsideProjectRoot）
 *   已收口到单一权威 `core/import-resolver.ts`。本模块仅保留 Python 解析，
 *   并下行 import 上述共享件（knowledge-graph → core，层级方向干净）。
 *
 * 设计原则：
 * - 纯函数（pure function），无状态，零新 npm 依赖（CL-01）
 * - 所有 resolvedPath 输出为相对 projectRoot 的 POSIX 路径（W-5 修复）
 * - 解析失败时返回 { resolvedPath: null, kind: 'unresolved' }，不抛异常（FR-2.4）
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  type ResolveResult,
  toPosix,
  isInsideProjectRoot,
} from '../core/import-resolver.js';

// ResolveResult 由 core/import-resolver 收口导出；此处 re-export 保持下游 import 路径兼容
export type { ResolveResult };

// ───────────────────────────────────────────────────────────
// 常量
// ───────────────────────────────────────────────────────────

/**
 * Python 标准库内置模块集合（plan §5.1 完整列表）。
 * 调用 resolvePythonImport 时，topModule 在此集合内则返回 external。
 */
const PYTHON_BUILTINS: ReadonlySet<string> = new Set([
  'os',
  'sys',
  're',
  'io',
  'json',
  'math',
  'time',
  'datetime',
  'collections',
  'itertools',
  'functools',
  'pathlib',
  'typing',
  'abc',
  'copy',
  'string',
  'struct',
  'socket',
  'threading',
  'subprocess',
  'logging',
  'unittest',
  'hashlib',
  'base64',
  'random',
  'operator',
  'contextlib',
  'weakref',
  'inspect',
  'ast',
  'dis',
  'gc',
  'importlib',
  'types',
  'enum',
  'dataclasses',
  'warnings',
  'traceback',
  'pprint',
  'heapq',
  'bisect',
  'array',
  'queue',
  'shutil',
  'glob',
  'fnmatch',
  'tempfile',
  'pickle',
  'csv',
  'html',
  'http',
  'urllib',
  'email',
  'xml',
  'sqlite3',
  'zlib',
  'gzip',
  'tarfile',
  'zipfile',
  'argparse',
  'textwrap',
  'decimal',
  'fractions',
  'statistics',
  'cmath',
  'secrets',
  'uuid',
  'platform',
  'signal',
  'mmap',
  'concurrent',
  'asyncio',
  'select',
  'ssl',
  'configparser',
  'tomllib',
  'gettext',
  'locale',
  'curses',
  'readline',
  'rlcompleter',
]);

// ───────────────────────────────────────────────────────────
// 内部辅助函数
// ───────────────────────────────────────────────────────────

/**
 * 统计字符串前缀中 '.' 的个数（用于 Python 相对 import level 计算）。
 */
function countLeadingDots(moduleSpec: string): number {
  let count = 0;
  for (const ch of moduleSpec) {
    if (ch === '.') count++;
    else break;
  }
  return count;
}

// ───────────────────────────────────────────────────────────
// Public API — resolvePythonImport
// ───────────────────────────────────────────────────────────

/**
 * 解析 Python import 路径。
 *
 * 支持 5 种场景（plan §5.1）：
 * 1. 绝对包路径（`pkg.engine` → `pkg/engine.py`）
 * 2. `__init__.py` 兜底（包目录 import）
 * 3. 相对 import（level ≥ 1，PEP 328：上溯 level-1 级目录）
 * 4. 祖先包 import（from .. import X）
 * 5. Python stdlib 内置模块返回 external
 *
 * C-1 修复说明：moduleSpec="." 时 stripped 为空，resolver 仅返回 __init__.py；
 * collect 层须把 "from . import nn" 拆解为 resolvePythonImport(".nn", callerFile, root)。
 *
 * @param moduleSpec - import 说明符（如 "micrograd.engine"、".nn"、"..pkg"）
 * @param callerFile  - 调用方文件的绝对路径
 * @param projectRoot - 项目根目录绝对路径
 * @returns ResolveResult（resolvedPath 为相对 projectRoot 的 POSIX 路径）
 */
export function resolvePythonImport(
  moduleSpec: string,
  callerFile: string,
  projectRoot: string,
): ResolveResult {
  const level = countLeadingDots(moduleSpec);
  const stripped = moduleSpec.slice(level); // 去掉前导点

  if (level > 0) {
    // PEP 328：from .X import Y → level=1，上溯 (level-1)=0 级，baseDir = callerFile 所在目录
    // from ..X import Y → level=2，上溯 1 级
    let baseDir = path.dirname(callerFile);
    for (let i = 0; i < level - 1; i++) {
      const parent = path.dirname(baseDir);
      // C-5 修复：检查越界，使用 isInsideProjectRoot 而非字典序
      if (!isInsideProjectRoot(baseDir, projectRoot) && baseDir !== projectRoot) {
        return { resolvedPath: null, kind: 'unresolved' };
      }
      baseDir = parent;
      // 上溯后再检查是否越界
      if (!isInsideProjectRoot(baseDir, projectRoot) && baseDir !== projectRoot) {
        return { resolvedPath: null, kind: 'unresolved' };
      }
    }

    // C-1 修复：stripped 为空时，仅返回 baseDir/__init__.py（包级 import）
    if (stripped === '') {
      const candidate = path.join(baseDir, '__init__.py');
      if (fs.existsSync(candidate)) {
        return {
          resolvedPath: toPosix(path.relative(projectRoot, candidate)),
          kind: 'relative-sibling',
        };
      }
      return { resolvedPath: null, kind: 'unresolved' };
    }

    // `from .submodule import X` 或 `from ..pkg import X`
    const parts = stripped.split('.');
    const candidate1 = path.join(baseDir, ...parts) + '.py';
    const candidate2 = path.join(baseDir, ...parts, '__init__.py');

    for (const candidate of [candidate1, candidate2]) {
      if (fs.existsSync(candidate)) {
        return {
          resolvedPath: toPosix(path.relative(projectRoot, candidate)),
          kind: 'relative-sibling',
        };
      }
    }
    return { resolvedPath: null, kind: 'unresolved' };
  }

  // 绝对 import（无前导点）
  const topModule = moduleSpec.split('.')[0] ?? '';

  // Python stdlib 内置模块
  if (PYTHON_BUILTINS.has(topModule)) {
    return { resolvedPath: null, kind: 'external' };
  }

  // dotted path → 文件路径
  const parts = moduleSpec.split('.');
  const candidate1 = path.join(projectRoot, ...parts) + '.py'; // pkg/engine.py
  const candidate2 = path.join(projectRoot, ...parts, '__init__.py'); // pkg/engine/__init__.py

  for (const candidate of [candidate1, candidate2]) {
    if (fs.existsSync(candidate)) {
      const kind = candidate.endsWith('__init__.py') ? 'package-init' : 'module';
      // W-5 修复：Python absolute import 命中分支也必须 POSIX 化
      return {
        resolvedPath: toPosix(path.relative(projectRoot, candidate)),
        kind,
      };
    }
  }

  return { resolvedPath: null, kind: 'unresolved' };
}
