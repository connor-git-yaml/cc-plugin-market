/**
 * F194 — collectPythonCodeSkeletons / collectTsJsCodeSkeletons 遵循 .gitignore
 *
 * 验证 batch 层两条自写 walk（walkPyFiles / walkTsJsFiles）叠加 .gitignore 过滤层后，
 * 被 .gitignore 的源文件不再进入 CodeSkeleton Map（不污染 UnifiedGraph 节点 / callSites）。
 *
 * 断言原则（正负配对，防空 Map 假绿）：
 * - collect* 真实调用 adapter 解析，单文件失败被吞 → 必须用"keep 文件存在"正向断言验证解析链路真实工作
 * - 同时用"ignored 文件不存在"负向断言验证过滤生效
 *
 * fixture 写入真实可解析源文件（不 mock adapter）；macOS /tmp 是 /private/tmp symlink，
 * Map key 为绝对路径，统一用 fs.realpathSync(tmpDir) 计算相对路径基准避免误判。
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  collectPythonCodeSkeletons,
  collectTsJsCodeSkeletons,
} from '../../src/batch/batch-orchestrator.js';

// 跨 it 的 cleanup registry（afterEach splice 清空保证用例间隔离），非测试状态共享
const tmpDirs: string[] = [];

/** 创建临时目录并写入文件（自动创建父目录）；返回 realpath 解析后的根 */
function createFixture(files: Record<string, string>): string {
  const tmpDir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'f193-batch-')));
  tmpDirs.push(tmpDir);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(tmpDir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf-8');
  }
  return tmpDir;
}

/** 将 Map（key=绝对路径）转换为相对 root 的 POSIX 路径集合 */
function relPathSet(map: Map<string, unknown>, root: string): Set<string> {
  const set = new Set<string>();
  for (const absPath of map.keys()) {
    set.add(path.relative(root, absPath).split(path.sep).join('/'));
  }
  return set;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe('collectPythonCodeSkeletons 遵循 .gitignore (F194)', () => {
  it('T-PY-GITIGNORE-01: 目录模式 generated/ → 含 keep .py，不含该目录下 .py/.pyi', async () => {
    const root = createFixture({
      '.gitignore': 'generated/\n',
      'pkg/core.py': 'def f(): pass\n',
      'generated/auto_stub.py': 'def g(): pass\n',
      'generated/types.pyi': 'def h() -> int: ...\n',
    });

    const map = await collectPythonCodeSkeletons(root);
    const rels = relPathSet(map, root);

    // 正向：keep 文件真实解析进 Map
    expect(rels.has('pkg/core.py')).toBe(true);
    // 负向：被忽略目录下 .py / .pyi 不进 Map
    expect(rels.has('generated/auto_stub.py')).toBe(false);
    expect(rels.has('generated/types.pyi')).toBe(false);
  });

  it('T-PY-GITIGNORE-02: 通配模式 *.stub.py → 含 keep 文件，命中文件不进 Map', async () => {
    const root = createFixture({
      '.gitignore': '*.stub.py\n',
      'core.py': 'def f(): pass\n',
      'foo.stub.py': 'def g(): pass\n',
    });

    const map = await collectPythonCodeSkeletons(root);
    const rels = relPathSet(map, root);

    expect(rels.has('core.py')).toBe(true);
    expect(rels.has('foo.stub.py')).toBe(false);
  });

  it('T-PY-GITIGNORE-03: 目录剪枝优先于 negation —— generated/ + !generated/keep.py 时 keep.py 仍被剪掉', async () => {
    // 锁定"目录被提前剪枝"分支（Codex Phase 3 审查 W2）：
    // 若实现退化为只做文件级过滤（删掉目录剪枝），keep.py 会被 negation
    // 最后匹配优先放进结果 → 本用例失败。与 file-scanner walkDir 及 git 语义一致。
    const root = createFixture({
      '.gitignore': 'generated/\n!generated/keep.py\n',
      'pkg/core.py': 'def f(): pass\n',
      'generated/keep.py': 'def keep(): pass\n',
      'generated/auto_stub.py': 'def g(): pass\n',
    });

    const map = await collectPythonCodeSkeletons(root);
    const rels = relPathSet(map, root);

    expect(rels.has('pkg/core.py')).toBe(true);
    expect(rels.has('generated/keep.py')).toBe(false);
    expect(rels.has('generated/auto_stub.py')).toBe(false);
  });
});

describe('collectTsJsCodeSkeletons 遵循 .gitignore (F194)', () => {
  it('T-TSJS-GITIGNORE-01: 目录模式 generated/ → 含 keep .ts，不含该目录下 .ts/.tsx/.js', async () => {
    const root = createFixture({
      '.gitignore': 'generated/\n',
      'src/core.ts': 'export const core = 1;\n',
      'generated/auto.ts': 'export const auto = 2;\n',
      'generated/widget.tsx': 'export const W = () => null;\n',
      'generated/legacy.js': 'module.exports = 3;\n',
    });

    const map = await collectTsJsCodeSkeletons(root);
    const rels = relPathSet(map, root);

    // 正向：keep 文件真实解析进 Map
    expect(rels.has('src/core.ts')).toBe(true);
    // 负向：被忽略目录下 .ts/.tsx/.js 不进 Map
    expect(rels.has('generated/auto.ts')).toBe(false);
    expect(rels.has('generated/widget.tsx')).toBe(false);
    expect(rels.has('generated/legacy.js')).toBe(false);
  });

  it('T-TSJS-GITIGNORE-02: 无 .gitignore → 行为无回归（全部可解析文件都在 Map 中）', async () => {
    const root = createFixture({
      'src/core.ts': 'export const core = 1;\n',
      'generated/auto.ts': 'export const auto = 2;\n',
    });

    const map = await collectTsJsCodeSkeletons(root);
    const rels = relPathSet(map, root);

    expect(rels.has('src/core.ts')).toBe(true);
    expect(rels.has('generated/auto.ts')).toBe(true);
  });

  it('T-TSJS-GITIGNORE-03: 目录剪枝优先于 negation —— generated/ + !generated/keep.ts 时 keep.ts 仍被剪掉', async () => {
    // 同 T-PY-GITIGNORE-03：锁定 walkTsJsFiles 的目录剪枝分支（Codex Phase 3 审查 W2）
    const root = createFixture({
      '.gitignore': 'generated/\n!generated/keep.ts\n',
      'src/core.ts': 'export const core = 1;\n',
      'generated/keep.ts': 'export const keep = 2;\n',
      'generated/auto.ts': 'export const auto = 3;\n',
    });

    const map = await collectTsJsCodeSkeletons(root);
    const rels = relPathSet(map, root);

    expect(rels.has('src/core.ts')).toBe(true);
    expect(rels.has('generated/keep.ts')).toBe(false);
    expect(rels.has('generated/auto.ts')).toBe(false);
  });
});
