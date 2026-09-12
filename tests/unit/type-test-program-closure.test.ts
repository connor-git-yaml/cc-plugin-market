/**
 * F280 后续（CI 红修复）：tests/type-tests 的 exactOptionalPropertyTypes 程序闭包守卫。
 *
 * 根因：`src/mcp/lib/graph-honesty.ts`（被 170c 类型测试经 response-helpers 间接引用）加了两条 `import type`，
 * 分别指向 `panoramic/query.ts`（值依赖三个 generator）与 `panoramic/graph/engine-cache.ts`（值依赖 graph-query）——
 * type-only import 照样把被引模块**整个**纳入程序，严格程序从 10 文件膨胀到 96 文件、暴露 64 处
 * exactOptionalPropertyTypes 错误，CI「Type Check Tests」自 9362f1a8 起红。本测试把闭包大小与禁入目录钉死：
 * 类型测试只该看见纯类型模块与它们的叶子依赖。
 *
 * 运行：npx vitest run tests/unit/type-test-program-closure.test.ts
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function listProgramFiles(tsconfig: string): string[] {
  const res = spawnSync('npx', ['tsc', '-p', tsconfig, '--noEmit', '--listFiles'], { cwd: repoRoot, encoding: 'utf-8' });
  // tsc 把诊断也写到 stdout：只取以 / 开头的文件行，并剔除 node_modules
  return res.stdout
    .split('\n')
    .filter((line) => line.startsWith('/') && !line.includes('/node_modules/'))
    .map((line) => path.relative(repoRoot, line.trim()));
}

describe('tests/type-tests 严格程序闭包守卫', () => {
  it('170c 类型测试的程序 ≤ 24 个仓内文件，且不含 generators / debt-scanner / core / batch / adapters 等值依赖重镇', () => {
    const files = listProgramFiles('tests/type-tests/tsconfig.json');
    expect(files.length, `程序闭包膨胀：\n${files.join('\n')}`).toBeLessThanOrEqual(24);
    const forbidden = files.filter((f) =>
      /^src\/(panoramic\/generators|panoramic\/builders|debt-scanner|core|batch|adapters|knowledge-graph|panoramic\/query\.ts|panoramic\/graph\/graph-query\.ts|panoramic\/graph\/engine-cache\.ts)/.test(f),
    );
    expect(forbidden, `type-only import 拖进了值依赖模块：\n${forbidden.join('\n')}`).toEqual([]);
    expect(files).toContain('src/mcp/lib/graph-honesty.ts');
  }, 120_000);
});
