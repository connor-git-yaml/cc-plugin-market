/**
 * buildProjectContext 单元测试
 * 覆盖包管理器检测、workspace 类型识别、多语言检测、配置文件扫描、
 * spec 文件发现和集成组装六个测试组，外加向后兼容性验证。
 */
import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  ProjectContextSchema,
} from '../../src/panoramic/interfaces.js';
import { buildProjectContext } from '../../src/panoramic/project-context.js';
import { bootstrapAdapters, LanguageAdapterRegistry } from '../../src/adapters/index.js';

// ============================================================
// 辅助函数
// ============================================================

/** 创建临时目录 */
function createTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'project-context-test-'));
}

/** 递归删除目录 */
function removeTmpDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ============================================================
// Schema 向后兼容性 (T004)
// ============================================================

describe('Schema 向后兼容性', () => {
  it('仅传入 projectRoot + configFiles 的 parse 调用成功', () => {
    const result = ProjectContextSchema.parse({
      projectRoot: '/tmp/test-project',
      configFiles: new Map(),
    });
    expect(result.projectRoot).toBe('/tmp/test-project');
    expect(result.configFiles.size).toBe(0);
  });

  it('新增字段使用默认值填充', () => {
    const result = ProjectContextSchema.parse({
      projectRoot: '/tmp/test-project',
      configFiles: new Map(),
    });
    expect(result.packageManager).toBe('unknown');
    expect(result.workspaceType).toBe('single');
    expect(result.detectedLanguages).toEqual([]);
    expect(result.existingSpecs).toEqual([]);
  });

  it('显式传入新增字段可覆盖默认值', () => {
    const result = ProjectContextSchema.parse({
      projectRoot: '/tmp/test-project',
      configFiles: new Map(),
      packageManager: 'npm',
      workspaceType: 'monorepo',
      detectedLanguages: ['ts-js', 'python'],
      existingSpecs: ['/tmp/test-project/specs/a.spec.md'],
    });
    expect(result.packageManager).toBe('npm');
    expect(result.workspaceType).toBe('monorepo');
    expect(result.detectedLanguages).toEqual(['ts-js', 'python']);
    expect(result.existingSpecs).toHaveLength(1);
  });
});

// ============================================================
// detectPackageManager (T009)
// ============================================================

describe('detectPackageManager', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) removeTmpDir(tmpDir);
  });

  it('package-lock.json -> npm', async () => {
    tmpDir = createTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.packageManager).toBe('npm');
  });

  it('pnpm-lock.yaml -> pnpm', async () => {
    tmpDir = createTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.packageManager).toBe('pnpm');
  });

  it('uv.lock -> uv', async () => {
    tmpDir = createTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'uv.lock'), '');
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.packageManager).toBe('uv');
  });

  it('多 lock 文件共存按优先级选择（pnpm > npm）', async () => {
    tmpDir = createTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'pnpm-lock.yaml'), '');
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.packageManager).toBe('pnpm');
  });

  it('无 lock 文件返回 unknown', async () => {
    tmpDir = createTmpDir();
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.packageManager).toBe('unknown');
  });
});

// ============================================================
// detectWorkspaceType (T012)
// ============================================================

describe('detectWorkspaceType', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) removeTmpDir(tmpDir);
  });

  it('package.json 含 workspaces 字段 -> monorepo', async () => {
    tmpDir = createTmpDir();
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', workspaces: ['packages/*'] }),
    );
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.workspaceType).toBe('monorepo');
  });

  it('pnpm-workspace.yaml 存在 -> monorepo', async () => {
    tmpDir = createTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), 'packages:\n  - "packages/*"');
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.workspaceType).toBe('monorepo');
  });

  it('pyproject.toml 含 [tool.uv.workspace] 段 -> monorepo', async () => {
    tmpDir = createTmpDir();
    fs.writeFileSync(
      path.join(tmpDir, 'pyproject.toml'),
      '[project]\nname = "test"\n\n[tool.uv.workspace]\nmembers = ["packages/*"]\n',
    );
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.workspaceType).toBe('monorepo');
  });

  it('lerna.json 存在 -> monorepo', async () => {
    tmpDir = createTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'lerna.json'), '{}');
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.workspaceType).toBe('monorepo');
  });

  it('仅有无 workspaces 的 package.json -> single', async () => {
    tmpDir = createTmpDir();
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test' }),
    );
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.workspaceType).toBe('single');
  });

  it('package.json 为非法 JSON 时降级为 single', async () => {
    tmpDir = createTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'package.json'), 'not valid json {{{');
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.workspaceType).toBe('single');
  });
});

// ============================================================
// detectLanguages (T015)
// ============================================================

describe('detectLanguages', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) removeTmpDir(tmpDir);
    LanguageAdapterRegistry.resetInstance();
  });

  it('TypeScript + Python 文件共存——检测到两种语言', async () => {
    tmpDir = createTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const x = 1;');
    fs.writeFileSync(path.join(tmpDir, 'main.py'), 'x = 1');
    bootstrapAdapters();
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.detectedLanguages).toContain('ts-js');
    expect(ctx.detectedLanguages).toContain('python');
  });

  it('Registry 未初始化时返回空数组', async () => {
    tmpDir = createTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const x = 1;');
    // 不调用 bootstrapAdapters()，Registry 为空
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.detectedLanguages).toEqual([]);
  });

  it('无已知语言文件返回空数组', async () => {
    tmpDir = createTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'readme.txt'), 'hello');
    bootstrapAdapters();
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.detectedLanguages).toEqual([]);
  });
});

// ============================================================
// scanConfigFiles (T018)
// ============================================================

describe('scanConfigFiles', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) removeTmpDir(tmpDir);
  });

  it('package.json + tsconfig.json 存在时 Map 包含两个条目', async () => {
    tmpDir = createTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'package.json'), '{}');
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.json'), '{}');
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.configFiles.has('package.json')).toBe(true);
    expect(ctx.configFiles.has('tsconfig.json')).toBe(true);
    // value 为绝对路径
    expect(ctx.configFiles.get('package.json')).toBe(path.join(tmpDir, 'package.json'));
    expect(ctx.configFiles.get('tsconfig.json')).toBe(path.join(tmpDir, 'tsconfig.json'));
  });

  it('tsconfig.build.json 被 tsconfig.*.json 通配匹配', async () => {
    tmpDir = createTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'tsconfig.build.json'), '{}');
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.configFiles.has('tsconfig.build.json')).toBe(true);
  });

  it('无已知配置文件时返回空 Map', async () => {
    tmpDir = createTmpDir();
    fs.writeFileSync(path.join(tmpDir, 'random.txt'), 'hello');
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.configFiles.size).toBe(0);
  });
});

// ============================================================
// discoverExistingSpecs (T021)
// ============================================================

describe('discoverExistingSpecs', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) removeTmpDir(tmpDir);
  });

  it('specs/ 目录含 .spec.md 文件时返回绝对路径数组', async () => {
    tmpDir = createTmpDir();
    const specsDir = path.join(tmpDir, 'specs', 'feature-a');
    fs.mkdirSync(specsDir, { recursive: true });
    fs.writeFileSync(path.join(specsDir, 'module.spec.md'), '# Spec');
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.existingSpecs).toHaveLength(1);
    expect(ctx.existingSpecs[0]).toBe(path.join(specsDir, 'module.spec.md'));
  });

  it('specs/ 目录不存在时返回空数组', async () => {
    tmpDir = createTmpDir();
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.existingSpecs).toEqual([]);
  });

  it('specs/ 目录为空时返回空数组', async () => {
    tmpDir = createTmpDir();
    fs.mkdirSync(path.join(tmpDir, 'specs'));
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.existingSpecs).toEqual([]);
  });
});

// ============================================================
// buildProjectContext 集成 (T024)
// ============================================================

describe('buildProjectContext 集成', () => {
  let tmpDir: string;

  afterEach(() => {
    if (tmpDir) removeTmpDir(tmpDir);
    LanguageAdapterRegistry.resetInstance();
  });

  it('projectRoot 不存在时抛出包含路径的 Error', async () => {
    const nonExistent = path.join(os.tmpdir(), 'non-existent-' + Date.now());
    await expect(buildProjectContext(nonExistent)).rejects.toThrow(nonExistent);
  });

  it('projectRoot 是文件而非目录时抛出 Error', async () => {
    tmpDir = createTmpDir();
    const filePath = path.join(tmpDir, 'file.txt');
    fs.writeFileSync(filePath, 'hello');
    await expect(buildProjectContext(filePath)).rejects.toThrow('不是目录');
  });

  it('标准项目返回完整 ProjectContext 对象', async () => {
    tmpDir = createTmpDir();
    // 创建标准 Node.js 项目结构
    fs.writeFileSync(path.join(tmpDir, 'package-lock.json'), '{}');
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-project' }),
    );
    fs.writeFileSync(path.join(tmpDir, 'index.ts'), 'export const x = 1;');

    bootstrapAdapters();
    const ctx = await buildProjectContext(tmpDir);

    // 验证各字段
    expect(ctx.packageManager).toBe('npm');
    expect(ctx.workspaceType).toBe('single');
    expect(ctx.configFiles.has('package.json')).toBe(true);
    expect(ctx.detectedLanguages).toContain('ts-js');

    // 通过 Schema 验证
    const validated = ProjectContextSchema.parse(ctx);
    expect(validated.projectRoot).toBe(tmpDir);
  });

  it('空目录返回全默认值对象', async () => {
    tmpDir = createTmpDir();
    const ctx = await buildProjectContext(tmpDir);
    expect(ctx.projectRoot).toBe(tmpDir);
    expect(ctx.packageManager).toBe('unknown');
    expect(ctx.workspaceType).toBe('single');
    expect(ctx.detectedLanguages).toEqual([]);
    expect(ctx.existingSpecs).toEqual([]);
    expect(ctx.configFiles.size).toBe(0);
  });
});
