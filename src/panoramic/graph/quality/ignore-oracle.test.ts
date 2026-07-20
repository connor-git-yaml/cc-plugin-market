/**
 * ignore-oracle 单测（F217 T011，P0 修正后）
 * 覆盖 FR-008 增补：
 * - 真实 import PY_SKELETON_IGNORE_DIRS / TSJS_SKELETON_IGNORE_DIRS，断言两常量
 *   ⊆ GRAPH_COLLECTOR_IGNORE_DIRS（图生产者 ignore 合同的单一事实源，定义于 ignore-oracle.ts）
 * - isIgnoredPath 对 .gitignore 命中路径与 GRAPH_COLLECTOR_IGNORE_DIRS 命中路径均返回 true
 * - P0 回归断言：specs/**\/contracts/*.ts 类路径不应被误判为 ignored
 *   （file-scanner.ts 的 BUILTIN_IGNORE_DIRS 含 'specs'/'examples' 是 spec 生成扫描器语义，
 *   与图生产者"specs/ 下真实源码需入图"的合同冲突——本仓库曾因此误报 551 个 ignored-path 节点）
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createIgnoreOracle, GRAPH_COLLECTOR_IGNORE_DIRS } from './ignore-oracle.js';
import { PY_SKELETON_IGNORE_DIRS, TSJS_SKELETON_IGNORE_DIRS } from '../../../batch/batch-orchestrator.js';

describe('ignore-oracle: 一致性单测', () => {
  it('PY_SKELETON_IGNORE_DIRS ⊆ GRAPH_COLLECTOR_IGNORE_DIRS', () => {
    for (const dir of PY_SKELETON_IGNORE_DIRS) {
      expect(
        GRAPH_COLLECTOR_IGNORE_DIRS.has(dir),
        `PY_SKELETON_IGNORE_DIRS 中的 "${dir}" 应在 GRAPH_COLLECTOR_IGNORE_DIRS 内`,
      ).toBe(true);
    }
  });

  it('TSJS_SKELETON_IGNORE_DIRS ⊆ GRAPH_COLLECTOR_IGNORE_DIRS', () => {
    for (const dir of TSJS_SKELETON_IGNORE_DIRS) {
      expect(
        GRAPH_COLLECTOR_IGNORE_DIRS.has(dir),
        `TSJS_SKELETON_IGNORE_DIRS 中的 "${dir}" 应在 GRAPH_COLLECTOR_IGNORE_DIRS 内`,
      ).toBe(true);
    }
  });

  // 反向说明：GRAPH_COLLECTOR_IGNORE_DIRS 允许是两者的真超集（union 语义），
  // 不要求恰好相等——未来某语言 collector 单独新增忽略目录，只需同步补充本集合，
  // 不强制另一语言也认识该目录。
});

describe('createIgnoreOracle', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ignore-oracle-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('.gitignore 命中路径返回 true', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), 'generated/\n*.stub.ts\n');
    const isIgnoredPath = createIgnoreOracle(tmpDir);

    expect(isIgnoredPath('generated/auto.ts')).toBe(true);
    expect(isIgnoredPath('pkg/foo.stub.ts')).toBe(true);
    expect(isIgnoredPath('pkg/core.ts')).toBe(false);
  });

  it('内置忽略目录命中路径返回 true（即使未在 .gitignore 中显式声明）', () => {
    const isIgnoredPath = createIgnoreOracle(tmpDir);

    expect(isIgnoredPath('dist/index.js')).toBe(true);
    expect(isIgnoredPath('.git/HEAD')).toBe(true);
    expect(isIgnoredPath('src/core/valid.ts')).toBe(false);
  });

  it('无 .gitignore 时仍能正常按内置目录判定', () => {
    const isIgnoredPath = createIgnoreOracle(tmpDir);
    expect(isIgnoredPath('coverage/report.html')).toBe(true);
    expect(isIgnoredPath('src/a.ts')).toBe(false);
  });

  it('P0 回归：specs/ 下真实源码路径不应被误判为 ignored（与图生产者合同对齐）', () => {
    const isIgnoredPath = createIgnoreOracle(tmpDir);
    expect(isIgnoredPath('specs/217-graph-quality-gates/contracts/graph-quality-report.schema.ts')).toBe(
      false,
    );
    expect(isIgnoredPath('examples/demo.ts')).toBe(false);
  });

  it('P0 回归：node_modules 等图生产者真正忽略的目录仍判定为 ignored', () => {
    const isIgnoredPath = createIgnoreOracle(tmpDir);
    expect(isIgnoredPath('node_modules/pkg/index.ts')).toBe(true);
  });

  // ============================================================
  // FIX-5（Codex WARNING）：按语言分派到对应生产者忽略集合，而非无差别 union。
  // 此前 union 判定会导致：Go 文件误判命中 .gradle（Java 目录）反而正确排除了
  // vendor（因为 vendor 在 union 里）；但也会让 tmp/venv 这类"仅某语言生产者
  // 排除"的目录误伤到不该排除的语言（如 PY 生产者不排 tmp，TSJS 生产者不排 venv）。
  // ============================================================
  describe('按语言分派（FIX-5）', () => {
    it('vendor/x.go → ignored（Go generic adapter defaultIgnoreDirs 含 vendor，此前假阴性）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir);
      expect(isIgnoredPath('vendor/x.go')).toBe(true);
    });

    it('.gradle/x.java → ignored（Java generic adapter defaultIgnoreDirs 含 .gradle）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir);
      expect(isIgnoredPath('.gradle/x.java')).toBe(true);
    });

    it('tmp/a.py → 不 ignored（PY collector 忽略集合不含 tmp，此前 union 误伤为假阳性）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir);
      expect(isIgnoredPath('tmp/a.py')).toBe(false);
    });

    it('venv/a.ts → 不 ignored（TSJS collector 忽略集合不含 venv，此前 union 误伤为假阳性）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir);
      expect(isIgnoredPath('venv/a.ts')).toBe(false);
    });

    it('venv/a.py → 仍 ignored（PY collector 忽略集合本身含 venv，语言分派不应破坏 PY 自身合同）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir);
      expect(isIgnoredPath('venv/a.py')).toBe(true);
    });

    it('tmp/a.ts → 仍 ignored（TSJS collector 忽略集合本身含 tmp，语言分派不应破坏 TSJS 自身合同）', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir);
      expect(isIgnoredPath('tmp/a.ts')).toBe(true);
    });

    it('未知扩展名（如 .rb）仍用 union 兜底（保守）：node_modules/x.rb → ignored', () => {
      const isIgnoredPath = createIgnoreOracle(tmpDir);
      expect(isIgnoredPath('node_modules/x.rb')).toBe(true);
    });
  });
});
