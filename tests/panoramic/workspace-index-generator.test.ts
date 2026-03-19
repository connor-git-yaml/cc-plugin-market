/**
 * WorkspaceIndexGenerator 单元测试
 * 覆盖 isApplicable、extract（npm/pnpm/uv）、generate（Mermaid 依赖图）、
 * render（Handlebars 模板渲染）、edge cases、注册集成
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ProjectContext } from '../../src/panoramic/interfaces.js';
import {
  WorkspaceIndexGenerator,
  _parsePnpmWorkspaceYaml,
  _parseUvWorkspaceToml,
  _detectLanguage,
  _sanitizeMermaidId,
  _buildMermaidDiagram,
  _expandGlobPatterns,
} from '../../src/panoramic/workspace-index-generator.js';
import type {
  WorkspacePackageInfo,
  WorkspaceInput,
  WorkspaceOutput,
} from '../../src/panoramic/workspace-index-generator.js';
import { GeneratorRegistry, bootstrapGenerators } from '../../src/panoramic/generator-registry.js';

// ============================================================
// 辅助函数
// ============================================================

/** 创建临时目录 */
function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'ws-index-test-'));
}

/** 清理临时目录 */
function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/** 构建最小 ProjectContext */
function createContext(
  projectRoot: string,
  overrides: Partial<ProjectContext> = {},
): ProjectContext {
  return {
    projectRoot,
    configFiles: new Map(),
    packageManager: 'unknown',
    workspaceType: 'single',
    detectedLanguages: [],
    existingSpecs: [],
    ...overrides,
  };
}

/** 写入文件并确保目录存在 */
function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

// ============================================================
// Phase 2: 工具函数单元测试
// ============================================================

describe('parsePnpmWorkspaceYaml', () => {
  it('解析标准 pnpm-workspace.yaml', () => {
    const content = `packages:
  - "packages/*"
  - "apps/*"
`;
    expect(_parsePnpmWorkspaceYaml(content)).toEqual(['packages/*', 'apps/*']);
  });

  it('解析无引号的条目', () => {
    const content = `packages:
  - packages/*
  - apps/*
`;
    expect(_parsePnpmWorkspaceYaml(content)).toEqual(['packages/*', 'apps/*']);
  });

  it('解析单引号条目', () => {
    const content = `packages:
  - 'packages/*'
`;
    expect(_parsePnpmWorkspaceYaml(content)).toEqual(['packages/*']);
  });

  it('空内容返回空列表', () => {
    expect(_parsePnpmWorkspaceYaml('')).toEqual([]);
  });

  it('无 packages 字段返回空列表', () => {
    expect(_parsePnpmWorkspaceYaml('# comment only\n')).toEqual([]);
  });
});

describe('parseUvWorkspaceToml', () => {
  it('解析标准 [tool.uv.workspace] 段', () => {
    const content = `[tool.uv.workspace]
members = [
  "packages/core",
  "apps/gateway",
]
`;
    expect(_parseUvWorkspaceToml(content)).toEqual(['packages/core', 'apps/gateway']);
  });

  it('空 members 返回空列表', () => {
    const content = `[tool.uv.workspace]
members = []
`;
    expect(_parseUvWorkspaceToml(content)).toEqual([]);
  });

  it('无 [tool.uv.workspace] 段返回空列表', () => {
    const content = `[project]
name = "test"
`;
    expect(_parseUvWorkspaceToml(content)).toEqual([]);
  });

  it('解析单引号 members', () => {
    const content = `[tool.uv.workspace]
members = ['packages/core', 'apps/web']
`;
    expect(_parseUvWorkspaceToml(content)).toEqual(['packages/core', 'apps/web']);
  });
});

describe('detectLanguage', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('tsconfig.json 推断为 TypeScript', () => {
    writeFile(path.join(tmpDir, 'tsconfig.json'), '{}');
    writeFile(path.join(tmpDir, 'package.json'), '{}');
    expect(_detectLanguage(tmpDir)).toBe('TypeScript');
  });

  it('仅 package.json 推断为 JavaScript', () => {
    writeFile(path.join(tmpDir, 'package.json'), '{}');
    expect(_detectLanguage(tmpDir)).toBe('JavaScript');
  });

  it('pyproject.toml 推断为 Python', () => {
    writeFile(path.join(tmpDir, 'pyproject.toml'), '[project]');
    expect(_detectLanguage(tmpDir)).toBe('Python');
  });

  it('空目录推断为 Unknown', () => {
    expect(_detectLanguage(tmpDir)).toBe('Unknown');
  });

  it('不存在的目录返回 Unknown', () => {
    expect(_detectLanguage(path.join(tmpDir, 'nonexistent'))).toBe('Unknown');
  });
});

describe('sanitizeMermaidId', () => {
  it('替换 @ 和 / 为 _', () => {
    expect(_sanitizeMermaidId('@scope/package')).toBe('_scope_package');
  });

  it('替换 - 和 . 为 _', () => {
    expect(_sanitizeMermaidId('my-package.core')).toBe('my_package_core');
  });

  it('纯字母数字不变', () => {
    expect(_sanitizeMermaidId('core')).toBe('core');
  });
});

describe('expandGlobPatterns', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('展开 * 通配符', () => {
    fs.mkdirSync(path.join(tmpDir, 'packages', 'core'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'packages', 'utils'), { recursive: true });

    const result = _expandGlobPatterns(tmpDir, ['packages/*']);
    expect(result).toHaveLength(2);
    expect(result.map(p => path.basename(p)).sort()).toEqual(['core', 'utils']);
  });

  it('精确路径直接返回', () => {
    fs.mkdirSync(path.join(tmpDir, 'packages', 'core'), { recursive: true });

    const result = _expandGlobPatterns(tmpDir, ['packages/core']);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(path.join(tmpDir, 'packages', 'core'));
  });

  it('不存在的目录静默跳过', () => {
    const result = _expandGlobPatterns(tmpDir, ['nonexistent/*']);
    expect(result).toEqual([]);
  });

  it('不存在的精确路径静默跳过', () => {
    const result = _expandGlobPatterns(tmpDir, ['packages/nonexistent']);
    expect(result).toEqual([]);
  });

  it('跳过隐藏目录', () => {
    fs.mkdirSync(path.join(tmpDir, 'packages', '.hidden'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'packages', 'visible'), { recursive: true });

    const result = _expandGlobPatterns(tmpDir, ['packages/*']);
    expect(result).toHaveLength(1);
    expect(path.basename(result[0]!)).toBe('visible');
  });
});

// ============================================================
// Phase 3: US1 - npm/pnpm workspace extract 测试（T009-T011）
// ============================================================

describe('WorkspaceIndexGenerator - npm workspace extract (T009)', () => {
  let tmpDir: string;
  let generator: WorkspaceIndexGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new WorkspaceIndexGenerator();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('npm workspace: 3 个子包 extract 返回 workspaceType=npm 且 packages 长度为 3', async () => {
    // 根 package.json
    writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-mono',
        workspaces: ['packages/*'],
      }),
    );

    // 子包
    for (const name of ['core', 'utils', 'cli']) {
      writeFile(
        path.join(tmpDir, 'packages', name, 'package.json'),
        JSON.stringify({ name: `@test/${name}`, description: `${name} package` }),
      );
    }

    const context = createContext(tmpDir, { workspaceType: 'monorepo' });
    const input = await generator.extract(context);

    expect(input.workspaceType).toBe('npm');
    expect(input.packages).toHaveLength(3);
    expect(input.projectName).toBe('test-mono');
  });
});

describe('WorkspaceIndexGenerator - pnpm workspace extract (T010)', () => {
  let tmpDir: string;
  let generator: WorkspaceIndexGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new WorkspaceIndexGenerator();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('pnpm workspace: 多层级正确分组', async () => {
    // pnpm-workspace.yaml
    writeFile(
      path.join(tmpDir, 'pnpm-workspace.yaml'),
      `packages:
  - "packages/*"
  - "apps/*"
`,
    );

    writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'pnpm-mono' }),
    );

    // packages 层级
    writeFile(
      path.join(tmpDir, 'packages', 'core', 'package.json'),
      JSON.stringify({ name: '@pnpm/core', description: 'Core lib' }),
    );
    writeFile(
      path.join(tmpDir, 'packages', 'utils', 'package.json'),
      JSON.stringify({ name: '@pnpm/utils', description: 'Utils' }),
    );

    // apps 层级
    writeFile(
      path.join(tmpDir, 'apps', 'web', 'package.json'),
      JSON.stringify({ name: '@pnpm/web', description: 'Web app' }),
    );

    const context = createContext(tmpDir, { workspaceType: 'monorepo' });
    const input = await generator.extract(context);

    expect(input.workspaceType).toBe('pnpm');
    expect(input.packages).toHaveLength(3);
    expect(input.projectName).toBe('pnpm-mono');

    const packagesGroup = input.packages.filter((p) => p.path.startsWith('packages/'));
    const appsGroup = input.packages.filter((p) => p.path.startsWith('apps/'));
    expect(packagesGroup).toHaveLength(2);
    expect(appsGroup).toHaveLength(1);
  });
});

describe('WorkspaceIndexGenerator - 内部依赖提取 (T011)', () => {
  let tmpDir: string;
  let generator: WorkspaceIndexGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new WorkspaceIndexGenerator();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('子包 A 依赖子包 B，提取内部依赖', async () => {
    writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'test-mono',
        workspaces: ['packages/*'],
      }),
    );

    writeFile(
      path.join(tmpDir, 'packages', 'core', 'package.json'),
      JSON.stringify({ name: '@test/core', description: 'Core' }),
    );

    writeFile(
      path.join(tmpDir, 'packages', 'app', 'package.json'),
      JSON.stringify({
        name: '@test/app',
        description: 'App',
        dependencies: {
          '@test/core': 'workspace:*',
          'external-lib': '^1.0.0',
        },
      }),
    );

    const context = createContext(tmpDir, { workspaceType: 'monorepo' });
    const input = await generator.extract(context);

    const appPkg = input.packages.find((p) => p.name === '@test/app');
    expect(appPkg).toBeDefined();
    expect(appPkg!.dependencies).toContain('@test/core');
    expect(appPkg!.dependencies).not.toContain('external-lib');
  });
});

// ============================================================
// Phase 4: US2 - uv workspace extract 测试（T017-T019）
// ============================================================

describe('WorkspaceIndexGenerator - uv workspace extract (T017)', () => {
  let tmpDir: string;
  let generator: WorkspaceIndexGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new WorkspaceIndexGenerator();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('uv workspace: 两个子包 extract 返回 workspaceType=uv', async () => {
    // 根 pyproject.toml
    writeFile(
      path.join(tmpDir, 'pyproject.toml'),
      `[project]
name = "uv-mono"

[tool.uv.workspace]
members = [
  "packages/core",
  "apps/gateway",
]
`,
    );

    // 子包 pyproject.toml
    writeFile(
      path.join(tmpDir, 'packages', 'core', 'pyproject.toml'),
      `[project]
name = "uv-core"
description = "Core library"
dependencies = []
`,
    );

    writeFile(
      path.join(tmpDir, 'apps', 'gateway', 'pyproject.toml'),
      `[project]
name = "uv-gateway"
description = "API gateway"
dependencies = [
  "uv-core>=0.1.0",
]
`,
    );

    const context = createContext(tmpDir, { workspaceType: 'monorepo' });
    const input = await generator.extract(context);

    expect(input.workspaceType).toBe('uv');
    expect(input.packages).toHaveLength(2);
    expect(input.projectName).toBe('uv-mono');
  });
});

describe('WorkspaceIndexGenerator - uv 子包元信息提取 (T018)', () => {
  let tmpDir: string;
  let generator: WorkspaceIndexGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new WorkspaceIndexGenerator();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('正确提取 name、description、dependencies', async () => {
    writeFile(
      path.join(tmpDir, 'pyproject.toml'),
      `[project]
name = "uv-mono"

[tool.uv.workspace]
members = ["packages/core", "packages/api"]
`,
    );

    writeFile(
      path.join(tmpDir, 'packages', 'core', 'pyproject.toml'),
      `[project]
name = "uv-core"
description = "Core library"
dependencies = []
`,
    );

    writeFile(
      path.join(tmpDir, 'packages', 'api', 'pyproject.toml'),
      `[project]
name = "uv-api"
description = "API layer"
dependencies = [
  "uv-core>=0.1.0",
  "fastapi>=0.100.0",
]
`,
    );

    const context = createContext(tmpDir, { workspaceType: 'monorepo' });
    const input = await generator.extract(context);

    const corePkg = input.packages.find((p) => p.name === 'uv-core');
    expect(corePkg).toBeDefined();
    expect(corePkg!.description).toBe('Core library');
    expect(corePkg!.language).toBe('Python');

    const apiPkg = input.packages.find((p) => p.name === 'uv-api');
    expect(apiPkg).toBeDefined();
    expect(apiPkg!.description).toBe('API layer');
    // uv-core 是 workspace 内部依赖
    expect(apiPkg!.dependencies).toContain('uv-core');
    // fastapi 是外部依赖，不应包含
    expect(apiPkg!.dependencies).not.toContain('fastapi');
  });
});

describe('WorkspaceIndexGenerator - uv 精确路径 (T019)', () => {
  let tmpDir: string;
  let generator: WorkspaceIndexGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new WorkspaceIndexGenerator();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('members 使用精确路径（非 glob）正确定位', async () => {
    writeFile(
      path.join(tmpDir, 'pyproject.toml'),
      `[project]
name = "uv-exact"

[tool.uv.workspace]
members = ["lib/alpha", "lib/beta"]
`,
    );

    writeFile(
      path.join(tmpDir, 'lib', 'alpha', 'pyproject.toml'),
      `[project]
name = "alpha"
description = "Alpha module"
dependencies = []
`,
    );

    writeFile(
      path.join(tmpDir, 'lib', 'beta', 'pyproject.toml'),
      `[project]
name = "beta"
description = "Beta module"
dependencies = ["alpha>=0.1.0"]
`,
    );

    const context = createContext(tmpDir, { workspaceType: 'monorepo' });
    const input = await generator.extract(context);

    expect(input.packages).toHaveLength(2);
    expect(input.packages.map((p) => p.name).sort()).toEqual(['alpha', 'beta']);
  });
});

// ============================================================
// Phase 5: US3 - isApplicable 测试（T023-T024）
// ============================================================

describe('WorkspaceIndexGenerator - isApplicable (T023-T024)', () => {
  let generator: WorkspaceIndexGenerator;

  beforeEach(() => {
    generator = new WorkspaceIndexGenerator();
  });

  it('workspaceType=monorepo 时返回 true (T023)', () => {
    const context = createContext('/tmp/fake', { workspaceType: 'monorepo' });
    expect(generator.isApplicable(context)).toBe(true);
  });

  it('workspaceType=single 时返回 false (T024)', () => {
    const context = createContext('/tmp/fake', { workspaceType: 'single' });
    expect(generator.isApplicable(context)).toBe(false);
  });
});

// ============================================================
// Phase 6: US4 - Mermaid 依赖图测试（T026-T029）
// ============================================================

describe('buildMermaidDiagram (T026-T029)', () => {
  it('A->B, B->C 生成正确边 (T026)', () => {
    const packages: WorkspacePackageInfo[] = [
      { name: 'A', path: 'packages/A', description: '', language: 'TypeScript', dependencies: ['B'] },
      { name: 'B', path: 'packages/B', description: '', language: 'TypeScript', dependencies: ['C'] },
      { name: 'C', path: 'packages/C', description: '', language: 'TypeScript', dependencies: [] },
    ];

    const diagram = _buildMermaidDiagram(packages);
    expect(diagram).toContain('graph TD');
    expect(diagram).toContain('A --> B');
    expect(diagram).toContain('B --> C');
  });

  it('无内部依赖时仅含节点和注释 (T027)', () => {
    const packages: WorkspacePackageInfo[] = [
      { name: 'X', path: 'packages/X', description: '', language: 'TypeScript', dependencies: [] },
      { name: 'Y', path: 'packages/Y', description: '', language: 'TypeScript', dependencies: [] },
    ];

    const diagram = _buildMermaidDiagram(packages);
    expect(diagram).toContain('graph TD');
    expect(diagram).toContain('X["X"]');
    expect(diagram).toContain('Y["Y"]');
    expect(diagram).toContain('%% 无内部依赖');
    expect(diagram).not.toContain('-->');
  });

  it('@scope/package 特殊字符转义 (T028)', () => {
    const packages: WorkspacePackageInfo[] = [
      {
        name: '@scope/package',
        path: 'packages/pkg',
        description: '',
        language: 'TypeScript',
        dependencies: ['@scope/core'],
      },
      { name: '@scope/core', path: 'packages/core', description: '', language: 'TypeScript', dependencies: [] },
    ];

    const diagram = _buildMermaidDiagram(packages);
    expect(diagram).toContain('_scope_package');
    expect(diagram).toContain('_scope_core');
    // 不应包含原始的 @ 或 / 在节点 ID 中
    expect(diagram).not.toMatch(/@scope\/package.*-->/);
  });

  it('循环依赖如实呈现 (T029)', () => {
    const packages: WorkspacePackageInfo[] = [
      { name: 'A', path: 'packages/A', description: '', language: 'TypeScript', dependencies: ['B'] },
      { name: 'B', path: 'packages/B', description: '', language: 'TypeScript', dependencies: ['A'] },
    ];

    const diagram = _buildMermaidDiagram(packages);
    expect(diagram).toContain('A --> B');
    expect(diagram).toContain('B --> A');
  });
});

// ============================================================
// Phase 7: US5 - render 测试（T032-T033）
// ============================================================

describe('WorkspaceIndexGenerator - render (T032-T033)', () => {
  let generator: WorkspaceIndexGenerator;

  beforeEach(() => {
    generator = new WorkspaceIndexGenerator();
  });

  it('渲染包含标题、日期、子包表格和 Mermaid 代码块 (T032)', () => {
    const output: WorkspaceOutput = {
      title: 'Workspace 架构索引: test-project',
      projectName: 'test-project',
      generatedAt: '2026-03-19',
      packages: [
        { name: 'core', path: 'packages/core', description: 'Core lib', language: 'TypeScript', dependencies: [] },
        { name: 'utils', path: 'packages/utils', description: 'Utilities', language: 'TypeScript', dependencies: ['core'] },
        { name: 'app', path: 'apps/app', description: 'Main app', language: 'TypeScript', dependencies: ['core', 'utils'] },
      ],
      dependencyDiagram: 'graph TD\n    core["core"]\n    utils["utils"]\n    app["app"]\n    utils --> core\n    app --> core\n    app --> utils',
      totalPackages: 3,
      groups: [
        {
          name: 'apps',
          packages: [
            { name: 'app', path: 'apps/app', description: 'Main app', language: 'TypeScript', dependencies: ['core', 'utils'] },
          ],
        },
        {
          name: 'packages',
          packages: [
            { name: 'core', path: 'packages/core', description: 'Core lib', language: 'TypeScript', dependencies: [] },
            { name: 'utils', path: 'packages/utils', description: 'Utilities', language: 'TypeScript', dependencies: ['core'] },
          ],
        },
      ],
    };

    const markdown = generator.render(output);

    // 标题
    expect(markdown).toContain('Workspace 架构索引: test-project');
    // 日期
    expect(markdown).toContain('2026-03-19');
    // 子包总数
    expect(markdown).toContain('3');
    // 表格列
    expect(markdown).toContain('| 名称 | 路径 | 描述 | 语言 |');
    // 子包条目
    expect(markdown).toContain('core');
    expect(markdown).toContain('`packages/core`');
    expect(markdown).toContain('Core lib');
    // Mermaid 代码块
    expect(markdown).toContain('```mermaid');
    expect(markdown).toContain('graph TD');
  });

  it('按分组展示 packages 和 apps (T033)', () => {
    const output: WorkspaceOutput = {
      title: 'Workspace 架构索引: grouped',
      projectName: 'grouped',
      generatedAt: '2026-03-19',
      packages: [
        { name: 'core', path: 'packages/core', description: '', language: 'TypeScript', dependencies: [] },
        { name: 'web', path: 'apps/web', description: '', language: 'TypeScript', dependencies: [] },
      ],
      dependencyDiagram: 'graph TD\n    core["core"]\n    web["web"]\n    %% 无内部依赖',
      totalPackages: 2,
      groups: [
        { name: 'packages', packages: [{ name: 'core', path: 'packages/core', description: '', language: 'TypeScript', dependencies: [] }] },
        { name: 'apps', packages: [{ name: 'web', path: 'apps/web', description: '', language: 'TypeScript', dependencies: [] }] },
      ],
    };

    const markdown = generator.render(output);

    // 验证两个分组标题都存在
    expect(markdown).toContain('## packages');
    expect(markdown).toContain('## apps');
  });
});

// ============================================================
// Phase 8: 注册测试（T038）
// ============================================================

describe('WorkspaceIndexGenerator - 注册集成 (T038)', () => {
  beforeEach(() => {
    GeneratorRegistry.resetInstance();
  });

  afterEach(() => {
    GeneratorRegistry.resetInstance();
  });

  it('bootstrapGenerators 后可通过 workspace-index id 查询', () => {
    bootstrapGenerators();
    const registry = GeneratorRegistry.getInstance();
    const generator = registry.get('workspace-index');

    expect(generator).toBeDefined();
    expect(generator!.id).toBe('workspace-index');
    expect(generator).toBeInstanceOf(WorkspaceIndexGenerator);
  });
});

// ============================================================
// Phase 9: Edge Cases 测试（T039-T044）
// ============================================================

describe('WorkspaceIndexGenerator - Edge Cases', () => {
  let tmpDir: string;
  let generator: WorkspaceIndexGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new WorkspaceIndexGenerator();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('glob 匹配到空目录（无 package.json）静默跳过 (T039)', async () => {
    writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', workspaces: ['packages/*'] }),
    );

    // 创建空目录
    fs.mkdirSync(path.join(tmpDir, 'packages', 'empty'), { recursive: true });

    // 创建有 package.json 的目录
    writeFile(
      path.join(tmpDir, 'packages', 'valid', 'package.json'),
      JSON.stringify({ name: 'valid-pkg' }),
    );

    const context = createContext(tmpDir, { workspaceType: 'monorepo' });
    const input = await generator.extract(context);

    expect(input.packages).toHaveLength(1);
    expect(input.packages[0]!.name).toBe('valid-pkg');
  });

  it('子包 package.json 格式异常（非法 JSON）警告并跳过 (T040)', async () => {
    writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', workspaces: ['packages/*'] }),
    );

    // 非法 JSON
    writeFile(path.join(tmpDir, 'packages', 'bad', 'package.json'), '{invalid json');

    // 正常 package.json
    writeFile(
      path.join(tmpDir, 'packages', 'good', 'package.json'),
      JSON.stringify({ name: 'good-pkg' }),
    );

    const context = createContext(tmpDir, { workspaceType: 'monorepo' });
    const input = await generator.extract(context);

    // 仅 good-pkg 被提取
    expect(input.packages).toHaveLength(1);
    expect(input.packages[0]!.name).toBe('good-pkg');
  });

  it('workspace 配置文件不可读时返回空 packages 列表 (T041)', async () => {
    // 仅创建空目录，无任何配置文件
    const context = createContext(tmpDir, { workspaceType: 'monorepo' });
    const input = await generator.extract(context);

    expect(input.packages).toEqual([]);
  });

  it('pnpm-workspace.yaml 为空或无 packages 字段返回空列表 (T042)', async () => {
    writeFile(path.join(tmpDir, 'pnpm-workspace.yaml'), '');

    const context = createContext(tmpDir, { workspaceType: 'monorepo' });
    const input = await generator.extract(context);

    expect(input.packages).toEqual([]);
  });

  it('pyproject.toml members 为空数组返回空列表 (T043)', async () => {
    writeFile(
      path.join(tmpDir, 'pyproject.toml'),
      `[project]
name = "empty-uv"

[tool.uv.workspace]
members = []
`,
    );

    const context = createContext(tmpDir, { workspaceType: 'monorepo' });
    const input = await generator.extract(context);

    expect(input.packages).toEqual([]);
  });

  it('glob 目标目录不存在静默跳过 (T044)', async () => {
    writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test', workspaces: ['nonexistent/*'] }),
    );

    const context = createContext(tmpDir, { workspaceType: 'monorepo' });
    const input = await generator.extract(context);

    expect(input.packages).toEqual([]);
  });
});

// ============================================================
// 全生命周期 e2e 测试
// ============================================================

describe('WorkspaceIndexGenerator - 全生命周期 e2e', () => {
  let tmpDir: string;
  let generator: WorkspaceIndexGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new WorkspaceIndexGenerator();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('npm workspace 完整生命周期: isApplicable -> extract -> generate -> render', async () => {
    // 构造 npm workspace 项目
    writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'e2e-mono',
        workspaces: ['packages/*'],
      }),
    );

    writeFile(
      path.join(tmpDir, 'packages', 'core', 'package.json'),
      JSON.stringify({ name: '@e2e/core', description: 'Core module' }),
    );
    writeFile(
      path.join(tmpDir, 'packages', 'core', 'tsconfig.json'),
      '{}',
    );

    writeFile(
      path.join(tmpDir, 'packages', 'api', 'package.json'),
      JSON.stringify({
        name: '@e2e/api',
        description: 'API module',
        dependencies: { '@e2e/core': 'workspace:*' },
      }),
    );
    writeFile(
      path.join(tmpDir, 'packages', 'api', 'tsconfig.json'),
      '{}',
    );

    const context = createContext(tmpDir, { workspaceType: 'monorepo' });

    // isApplicable
    expect(generator.isApplicable(context)).toBe(true);

    // extract
    const input = await generator.extract(context);
    expect(input.workspaceType).toBe('npm');
    expect(input.packages).toHaveLength(2);

    // generate
    const output = await generator.generate(input);
    expect(output.title).toContain('e2e-mono');
    expect(output.totalPackages).toBe(2);
    expect(output.groups.length).toBeGreaterThanOrEqual(1);
    expect(output.dependencyDiagram).toContain('graph TD');
    expect(output.dependencyDiagram).toContain('-->');

    // render
    const markdown = generator.render(output);
    expect(markdown).toContain('e2e-mono');
    expect(markdown).toContain('```mermaid');
    expect(markdown).toContain('@e2e/core');
    expect(markdown).toContain('@e2e/api');
  });
});
