/**
 * batch 编排路径基准集成测试
 * 验证 runBatch(projectRoot) 在 cwd 不同场景下仍写入到 projectRoot 下的输出目录
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { runBatch } from '../../src/batch/batch-orchestrator.js';
import { buildGraph } from '../../src/graph/dependency-graph.js';
import { groupFilesToModules } from '../../src/batch/module-grouper.js';

describe('runBatch 路径基准', () => {
  let projectRoot: string;
  let isolatedCwd: string;
  let previousCwd: string;

  beforeEach(() => {
    previousCwd = process.cwd();
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-path-project-'));
    isolatedCwd = fs.mkdtempSync(path.join(os.tmpdir(), 'batch-path-cwd-'));

    fs.mkdirSync(path.join(projectRoot, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(projectRoot, 'src', 'entry.ts'),
      `
export function greet(name: string): string {
  return \`hello \${name}\`;
}
`.trim(),
      'utf-8',
    );
    fs.writeFileSync(
      path.join(projectRoot, 'tsconfig.json'),
      JSON.stringify(
        {
          compilerOptions: {
            target: 'ES2022',
            module: 'NodeNext',
          },
        },
        null,
        2,
      ),
      'utf-8',
    );
  });

  afterEach(() => {
    process.chdir(previousCwd);
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(isolatedCwd, { recursive: true, force: true });
  });

  it('cwd 与 projectRoot 不同时，输出仍写入 projectRoot/specs', async () => {
    const graph = await buildGraph(projectRoot);
    const grouped = groupFilesToModules(graph);
    const outputDir = path.join(projectRoot, 'specs');
    fs.mkdirSync(outputDir, { recursive: true });

    // 预创建每个模块的 spec，确保 runBatch 走 skip 分支（不触发 LLM 调用）
    for (const moduleName of grouped.moduleOrder) {
      fs.writeFileSync(
        path.join(outputDir, `${moduleName}.spec.md`),
        `# prebuilt ${moduleName}\n`,
        'utf-8',
      );
    }

    process.chdir(isolatedCwd);
    const result = await runBatch(projectRoot, { force: false });

    expect(result.totalModules).toBeGreaterThan(0);
    expect(result.failed).toHaveLength(0);
    expect(result.skipped).toHaveLength(result.totalModules);

    // 摘要与索引都应位于 projectRoot 下，而非当前 cwd
    expect(fs.existsSync(path.join(projectRoot, result.summaryLogPath))).toBe(true);
    expect(fs.existsSync(path.join(isolatedCwd, result.summaryLogPath))).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, 'specs', '_index.spec.md'))).toBe(true);
    expect(fs.existsSync(path.join(isolatedCwd, 'specs', '_index.spec.md'))).toBe(false);
  });

  it('outputDir 为相对路径时，基准应仍然是 projectRoot', async () => {
    const graph = await buildGraph(projectRoot);
    const grouped = groupFilesToModules(graph);
    const customOutDir = path.join(projectRoot, 'custom-specs');
    fs.mkdirSync(customOutDir, { recursive: true });

    for (const moduleName of grouped.moduleOrder) {
      fs.writeFileSync(
        path.join(customOutDir, `${moduleName}.spec.md`),
        `# prebuilt ${moduleName}\n`,
        'utf-8',
      );
    }

    process.chdir(isolatedCwd);
    const result = await runBatch(projectRoot, {
      force: false,
      outputDir: 'custom-specs',
    });

    expect(result.failed).toHaveLength(0);
    expect(result.skipped).toHaveLength(result.totalModules);
    expect(result.summaryLogPath.startsWith('custom-specs/')).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, result.summaryLogPath))).toBe(true);
    expect(fs.existsSync(path.join(projectRoot, 'custom-specs', '_index.spec.md'))).toBe(true);
    expect(fs.existsSync(path.join(isolatedCwd, 'custom-specs', '_index.spec.md'))).toBe(false);
  });
});
