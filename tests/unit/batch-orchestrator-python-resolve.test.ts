/**
 * Feature 152 T-018 — collectPythonCodeSkeletons + import-resolver 集成测试
 *
 * 验证 T-017 的 resolvePythonImport 替换：
 * 1. 绝对包路径（from pkg.engine import Value）→ resolvedPath 为绝对路径
 * 2. C-1 from . import nn 形态（裸相对 import 拆解）→ 每个 namedImport 独立解析
 * 3. basename 冲突场景（a/utils.py + b/utils.py）→ 各自独立解析，不混淆
 *
 * 约束：
 * - 构造真实 tmpDir fixture（fs.mkdtempSync），测试完成后清理
 * - Map key 为绝对路径（path.isAbsolute）
 * - resolvedPath 为绝对路径（与 Map key 格式对齐，EC-10）
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

// 被测函数通过动态 import 引用，避免 ts-morph 在模块加载时副作用
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CollectFn = (projectRoot: string) => Promise<Map<string, any>>;

async function getCollectFn(): Promise<CollectFn> {
  // 直接 import batch-orchestrator（函数未 export，通过 vitest 测试内部函数的方式：
  // 调用 batch-orchestrator 暴露的辅助，或者通过测试 fixture 驱动完整流程）
  // collectPythonCodeSkeletons 是私有函数，需要通过 vitest 的 module internals 测试
  // 方案：通过 vitest importOriginal 获取内部函数
  const mod = await import('../../src/batch/batch-orchestrator.js');
  // collectPythonCodeSkeletons 未 export → 使用间接方式验证
  // 实际策略：在 batch-orchestrator.ts 中 export 该函数（仅测试用），
  // 或直接测试其副作用（通过 collectSkeletons 的上层调用）
  // 当前选择：通过直接测试已知 export 的 walkTsJsFiles 替代品（Python 版未 export）
  // 折衷方案：直接测试 collectPythonCodeSkeletons 需要 export，
  // 按任务约束"不修改其他文件"，在 batch-orchestrator.ts 中 export collectPythonCodeSkeletons
  // → 参见 T-018 说明：可 export 供测试用
  const fn = (mod as Record<string, unknown>)['collectPythonCodeSkeletons'] as CollectFn | undefined;
  if (!fn) {
    throw new Error('collectPythonCodeSkeletons 未 export，请在 batch-orchestrator.ts 中导出');
  }
  return fn;
}

// 工具函数：创建临时目录并写入文件
function createFixture(files: Record<string, string>): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spectra-py-resolve-'));
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = path.join(tmpDir, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf-8');
  }
  return tmpDir;
}

const tmpDirs: string[] = [];

afterEach(() => {
  // 清理所有临时目录
  for (const dir of tmpDirs) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // 忽略清理错误
    }
  }
  tmpDirs.length = 0;
});

describe('collectPythonCodeSkeletons + import-resolver 集成 (T-017/T-018)', () => {
  it('Case 1：绝对包路径 from pkg.engine import Value → resolvedPath 为绝对路径', async () => {
    const collect = await getCollectFn();

    // micrograd-like fixture：pkg/__init__.py + pkg/engine.py + main.py
    const tmpDir = createFixture({
      'pkg/__init__.py': '# pkg init\n',
      'pkg/engine.py': `
class Value:
    def __init__(self, data):
        self.data = data
`,
      'main.py': `
from pkg.engine import Value

def run():
    v = Value(1.0)
`,
    });
    tmpDirs.push(tmpDir);

    const result = await collect(tmpDir);

    // main.py 应在结果中
    const mainPath = path.join(tmpDir, 'main.py');
    expect(result.has(mainPath)).toBe(true);

    const skeleton = result.get(mainPath);
    expect(skeleton).toBeDefined();

    // 找到 pkg.engine import
    const pkgEngineImp = (skeleton.imports as Array<{ moduleSpecifier: string; resolvedPath: string | null }>)
      .find((imp) => imp.moduleSpecifier === 'pkg.engine');
    expect(pkgEngineImp).toBeDefined();

    // resolvedPath 应为绝对路径（EC-10）
    expect(pkgEngineImp?.resolvedPath).not.toBeNull();
    expect(path.isAbsolute(pkgEngineImp!.resolvedPath!)).toBe(true);
    // resolvedPath 应指向 pkg/engine.py
    expect(pkgEngineImp?.resolvedPath).toBe(path.join(tmpDir, 'pkg', 'engine.py'));

    // Map key 也是绝对路径
    expect(path.isAbsolute(mainPath)).toBe(true);
  });

  it('Case 2：C-1 from . import nn 形态 → 每个 namedImport 独立解析', async () => {
    const collect = await getCollectFn();

    // micrograd-like fixture：micrograd/ 包结构
    const tmpDir = createFixture({
      'micrograd/__init__.py': `
from . import engine
from . import nn
`,
      'micrograd/engine.py': `
class Value:
    pass
`,
      'micrograd/nn.py': `
class MLP:
    pass
`,
    });
    tmpDirs.push(tmpDir);

    const result = await collect(tmpDir);

    const initPath = path.join(tmpDir, 'micrograd', '__init__.py');
    expect(result.has(initPath)).toBe(true);

    const skeleton = result.get(initPath);
    const imports = skeleton.imports as Array<{ moduleSpecifier: string; resolvedPath: string | null }>;

    // 解析 "from . import engine" → moduleSpecifier='.engine'（C-1 拆解后）
    const engineImp = imports.find((imp) => imp.moduleSpecifier === '.engine');
    expect(engineImp).toBeDefined();
    expect(engineImp?.resolvedPath).not.toBeNull();
    expect(path.isAbsolute(engineImp!.resolvedPath!)).toBe(true);
    expect(engineImp?.resolvedPath).toBe(path.join(tmpDir, 'micrograd', 'engine.py'));

    // 解析 "from . import nn" → moduleSpecifier='.nn'
    const nnImp = imports.find((imp) => imp.moduleSpecifier === '.nn');
    expect(nnImp).toBeDefined();
    expect(nnImp?.resolvedPath).not.toBeNull();
    expect(path.isAbsolute(nnImp!.resolvedPath!)).toBe(true);
    expect(nnImp?.resolvedPath).toBe(path.join(tmpDir, 'micrograd', 'nn.py'));
  });

  it('Case 3：basename 冲突 a/utils.py + b/utils.py → 各自独立解析，不混淆', async () => {
    const collect = await getCollectFn();

    // a/utils.py 和 b/utils.py 同名，a/main.py 导入 a/utils.py，b/main.py 导入 b/utils.py
    const tmpDir = createFixture({
      'a/__init__.py': '',
      'a/utils.py': `
def helper_a():
    return "a"
`,
      'a/main.py': `
from .utils import helper_a

def run():
    helper_a()
`,
      'b/__init__.py': '',
      'b/utils.py': `
def helper_b():
    return "b"
`,
      'b/main.py': `
from .utils import helper_b

def run():
    helper_b()
`,
    });
    tmpDirs.push(tmpDir);

    const result = await collect(tmpDir);

    const aMainPath = path.join(tmpDir, 'a', 'main.py');
    const bMainPath = path.join(tmpDir, 'b', 'main.py');

    expect(result.has(aMainPath)).toBe(true);
    expect(result.has(bMainPath)).toBe(true);

    const aImports = (result.get(aMainPath).imports as Array<{ moduleSpecifier: string; resolvedPath: string | null }>);
    const bImports = (result.get(bMainPath).imports as Array<{ moduleSpecifier: string; resolvedPath: string | null }>);

    // a/main.py 的 .utils 应解析到 a/utils.py
    const aUtilsImp = aImports.find((imp) => imp.moduleSpecifier.includes('utils'));
    expect(aUtilsImp?.resolvedPath).toBe(path.join(tmpDir, 'a', 'utils.py'));

    // b/main.py 的 .utils 应解析到 b/utils.py（不能混淆到 a/utils.py）
    const bUtilsImp = bImports.find((imp) => imp.moduleSpecifier.includes('utils'));
    expect(bUtilsImp?.resolvedPath).toBe(path.join(tmpDir, 'b', 'utils.py'));

    // 两者解析结果不同（冲突场景正确区分）
    expect(aUtilsImp?.resolvedPath).not.toBe(bUtilsImp?.resolvedPath);
  });

  // ─── Codex P3+P4 复审补测 ─────────────────────────

  it('Codex C-1 修复：单语句 from . import a, b → 拆解后每条 namedImports 仅含本次拆出的 name', async () => {
    const collect = await getCollectFn();
    // 关键场景：**单 import 语句**多 namedImport，验证拆解后 namedImports 不污染
    // 这是 PythonMapper 实际的输出形态：tree-sitter parse `from . import engine, nn`
    // 产出 1 条 ImportReference（moduleSpecifier='.', namedImports=['engine','nn']）
    const tmpDir = createFixture({
      'micrograd/__init__.py': `from . import engine, nn`,
      'micrograd/engine.py': `class Value:\n    pass`,
      'micrograd/nn.py': `class MLP:\n    pass`,
    });
    tmpDirs.push(tmpDir);

    const result = await collect(tmpDir);
    const initPath = path.join(tmpDir, 'micrograd', '__init__.py');
    const skeleton = result.get(initPath);
    const imports = skeleton.imports as Array<{
      moduleSpecifier: string;
      namedImports?: string[];
      resolvedPath: string | null;
    }>;

    // 拆解后应有 2 条独立 import 记录（不是 1 条含 namedImports=['engine','nn']）
    const engineImp = imports.find((i) => i.moduleSpecifier === '.engine');
    const nnImp = imports.find((i) => i.moduleSpecifier === '.nn');

    expect(engineImp).toBeDefined();
    expect(nnImp).toBeDefined();

    // 关键 C-1 修复断言：每条记录的 namedImports 仅含本次拆出的 name
    // （而不是 ['engine','nn']，否则 buildImportIndex 会把 'engine' 和 'nn' 都映射到同一个 resolvedPath）
    expect(engineImp?.namedImports).toEqual(['engine']);
    expect(nnImp?.namedImports).toEqual(['nn']);

    // resolvedPath 各自正确指向不同文件
    expect(engineImp?.resolvedPath).toBe(path.join(tmpDir, 'micrograd', 'engine.py'));
    expect(nnImp?.resolvedPath).toBe(path.join(tmpDir, 'micrograd', 'nn.py'));
  });

  it('Codex C-2 修复：调用方传相对路径 projectRoot → Map key 与 resolvedPath 形态一致（绝对路径）', async () => {
    const collect = await getCollectFn();
    const tmpDir = createFixture({
      'pkg/__init__.py': '',
      'pkg/engine.py': `class Value: pass`,
      'pkg/main.py': `from pkg.engine import Value`,
    });
    tmpDirs.push(tmpDir);

    // 关键：传相对路径（虽然 mkdtempSync 给的是绝对，但模拟调用方传相对）
    // 用 process.cwd 计算相对路径
    const relativeTmpDir = path.relative(process.cwd(), tmpDir);
    const result = await collect(relativeTmpDir);

    // collect 内 resolvedProjectRoot = path.resolve(relativeTmpDir) → 绝对路径
    // 因此 Map key 和 resolvedPath 都应该是绝对路径，形态一致
    const allKeys = Array.from(result.keys());
    expect(allKeys.length).toBeGreaterThan(0);
    for (const key of allKeys) {
      expect(path.isAbsolute(key)).toBe(true);
    }

    // 找到 main.py 的 import，断言其 resolvedPath 也是绝对路径，且与 Map key 形态对齐
    const mainPath = path.resolve(tmpDir, 'pkg', 'main.py');
    const mainSkeleton = result.get(mainPath);
    expect(mainSkeleton).toBeDefined();
    const imp = mainSkeleton.imports[0];
    expect(imp.resolvedPath).not.toBeNull();
    expect(path.isAbsolute(imp.resolvedPath as string)).toBe(true);
  });
});
