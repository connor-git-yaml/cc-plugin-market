/**
 * ArchitectureOverviewGenerator 单元测试
 *
 * 覆盖：
 * - 043 + 040 + 041 联合组合输出
 * - 缺失运行时输入时的降级行为
 * - GeneratorRegistry / barrel export 集成
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProjectContext } from '../../src/panoramic/interfaces.js';
import * as panoramic from '../../src/panoramic/index.js';
import { GeneratorRegistry, bootstrapGenerators } from '../../src/panoramic/generator-registry.js';
import { ArchitectureOverviewGenerator } from '../../src/panoramic/architecture-overview-generator.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-overview-test-'));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function createContext(projectRoot: string, workspaceType: 'single' | 'monorepo'): ProjectContext {
  const configFiles = new Map<string, string>();

  for (const entry of fs.readdirSync(projectRoot, { withFileTypes: true })) {
    if (entry.isFile()) {
      configFiles.set(entry.name, path.join(projectRoot, entry.name));
    }
  }

  return {
    projectRoot,
    configFiles,
    packageManager: 'unknown',
    workspaceType,
    detectedLanguages: [],
    existingSpecs: [],
  };
}

function setupCompositeFixture(projectRoot: string): void {
  writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'architecture-overview-sample',
        workspaces: ['apps/*', 'packages/*'],
      },
      null,
      2,
    ),
  );

  writeFile(
    path.join(projectRoot, 'docker-compose.yml'),
    `services:
  gateway:
    build:
      context: ./apps/api
      dockerfile: Dockerfile
      target: runner
    container_name: gateway-container
    ports:
      - 8080:8080
    depends_on:
      db:
        condition: service_started
  db:
    image: postgres:15
    environment:
      POSTGRES_DB: app
`,
  );

  writeFile(
    path.join(projectRoot, 'apps/api/Dockerfile'),
    `FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json .
RUN npm ci

FROM node:20-alpine AS runner
WORKDIR /app
COPY --from=builder /app /app
EXPOSE 8080
CMD ["node", "server.js"]
`,
  );

  writeFile(
    path.join(projectRoot, 'apps/api/package.json'),
    JSON.stringify(
      {
        name: '@repo/api',
        description: 'HTTP API service',
        dependencies: {
          '@repo/core': 'workspace:*',
        },
      },
      null,
      2,
    ),
  );

  writeFile(
    path.join(projectRoot, 'apps/web/package.json'),
    JSON.stringify(
      {
        name: '@repo/web',
        description: 'Frontend application',
        dependencies: {
          '@repo/core': 'workspace:*',
        },
      },
      null,
      2,
    ),
  );

  writeFile(
    path.join(projectRoot, 'packages/core/package.json'),
    JSON.stringify(
      {
        name: '@repo/core',
        description: 'Shared domain utilities',
      },
      null,
      2,
    ),
  );
}

function setupWorkspaceOnlyFixture(projectRoot: string): void {
  writeFile(
    path.join(projectRoot, 'package.json'),
    JSON.stringify(
      {
        name: 'workspace-only-sample',
        workspaces: ['apps/*', 'packages/*'],
      },
      null,
      2,
    ),
  );

  writeFile(
    path.join(projectRoot, 'apps/web/package.json'),
    JSON.stringify(
      {
        name: '@repo/web',
        dependencies: {
          '@repo/core': 'workspace:*',
        },
      },
      null,
      2,
    ),
  );

  writeFile(
    path.join(projectRoot, 'packages/core/package.json'),
    JSON.stringify(
      {
        name: '@repo/core',
      },
      null,
      2,
    ),
  );
}

describe('ArchitectureOverviewGenerator - composite overview', () => {
  let tmpDir: string;
  let generator: ArchitectureOverviewGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new ArchitectureOverviewGenerator();
    setupCompositeFixture(tmpDir);
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('组合 043 + 040 + 041 输出，生成系统上下文 / 部署 / 分层视图', async () => {
    const output = await generator.generate(await generator.extract(createContext(tmpDir, 'monorepo')));
    const markdown = generator.render(output);

    expect(output.model.sections).toHaveLength(3);
    expect(output.systemContext?.available).toBe(true);
    expect(output.deploymentView?.available).toBe(true);
    expect(output.layeredView?.available).toBe(true);
    expect(output.model.moduleSummaries).toHaveLength(3);
    expect(output.model.deploymentUnits).toHaveLength(2);

    expect(output.systemContext?.nodes.some((node) => node.id === 'service:gateway')).toBe(true);
    expect(output.systemContext?.nodes.some((node) => node.id === 'group:apps')).toBe(true);
    expect(output.deploymentView?.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'service:gateway',
          to: 'service:db',
          relation: 'depends-on',
        }),
        expect.objectContaining({
          from: 'service:gateway',
          to: 'container:gateway-container',
          relation: 'deploys',
        }),
      ]),
    );
    expect(output.layeredView?.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          from: 'package:@repo/api',
          to: 'package:@repo/core',
          relation: 'depends-on',
        }),
        expect.objectContaining({
          from: 'package:@repo/web',
          to: 'package:@repo/core',
          relation: 'depends-on',
        }),
      ]),
    );
    expect(output.model.sections.flatMap((section) => section.edges).every((edge) => edge.evidence.length > 0)).toBe(true);

    expect(markdown).toContain('# 架构概览: architecture-overview-sample');
    expect(markdown).toContain('## 系统上下文视图');
    expect(markdown).toContain('## 部署视图');
    expect(markdown).toContain('## 分层视图');
    expect(markdown).toContain('## 模块职责摘要');
    expect((markdown.match(/```mermaid/g) ?? [])).toHaveLength(3);
  });
});

describe('ArchitectureOverviewGenerator - graceful degradation', () => {
  let tmpDir: string;
  let generator: ArchitectureOverviewGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new ArchitectureOverviewGenerator();
    setupWorkspaceOnlyFixture(tmpDir);
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('缺少 runtime topology 时仍生成系统上下文和分层视图，并标注部署视图降级', async () => {
    const output = await generator.generate(await generator.extract(createContext(tmpDir, 'monorepo')));
    const markdown = generator.render(output);

    expect(output.systemContext?.available).toBe(true);
    expect(output.deploymentView?.available).toBe(false);
    expect(output.layeredView?.available).toBe(true);
    expect(output.warnings.some((warning) => warning.includes('部署视图已降级'))).toBe(true);
    expect(output.model.moduleSummaries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          packageName: '@repo/core',
          responsibility: expect.stringContaining('[推断]'),
        }),
      ]),
    );
    expect(markdown).toContain('当前版块不可用');
    expect(markdown).toContain('未检测到 Compose / Dockerfile 运行时信号');
  });
});

describe('ArchitectureOverviewGenerator - registry / exports 集成', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    setupWorkspaceOnlyFixture(tmpDir);
    GeneratorRegistry.resetInstance();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('bootstrapGenerators 后可通过 architecture-overview id 查询，并能按上下文发现', async () => {
    bootstrapGenerators();
    const registry = GeneratorRegistry.getInstance();
    const generator = registry.get('architecture-overview');

    expect(generator).toBeInstanceOf(ArchitectureOverviewGenerator);

    const filtered = await registry.filterByContext(createContext(tmpDir, 'monorepo'));
    expect(filtered.some((item) => item.id === 'architecture-overview')).toBe(true);
  });

  it('barrel export 导出 generator 与共享 helper', () => {
    expect(panoramic.ArchitectureOverviewGenerator).toBe(ArchitectureOverviewGenerator);
    expect(typeof panoramic.summarizeArchitectureOverview).toBe('function');
    expect(typeof panoramic.createArchitectureEvidence).toBe('function');
  });
});
