import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProjectContext } from '../../src/panoramic/interfaces.js';
import * as panoramic from '../../src/panoramic/index.js';
import { ArchitectureIRGenerator } from '../../src/panoramic/architecture-ir-generator.js';
import { GeneratorRegistry, bootstrapGenerators } from '../../src/panoramic/generator-registry.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'architecture-ir-test-'));
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
        name: 'architecture-ir-sample',
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

describe('ArchitectureIRGenerator', () => {
  let tmpDir: string;
  let generator: ArchitectureIRGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new ArchitectureIRGenerator();
    setupCompositeFixture(tmpDir);
  });

  afterEach(() => {
    cleanupDir(tmpDir);
    GeneratorRegistry.resetInstance();
  });

  it('基于现有 panoramic 输出生成 IR、Structurizr DSL 与 Mermaid 互通结果', async () => {
    const output = await generator.generate(await generator.extract(createContext(tmpDir, 'monorepo')));
    const markdown = generator.render(output);

    expect(output.ir.views).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'system-context', available: true }),
        expect.objectContaining({ kind: 'deployment', available: true }),
        expect.objectContaining({ kind: 'component', available: true }),
      ]),
    );
    expect(output.exports.structurizrDsl).toContain('workspace "architecture-ir-sample Architecture"');
    expect(output.exports.structurizrDsl).toContain('deploymentEnvironment "runtime"');
    expect(output.exports.structurizrDsl).toContain('component "@repo/api"');
    expect(output.exports.mermaid.sections.map((section) => section.kind)).toEqual(
      expect.arrayContaining(['system-context', 'deployment', 'layered']),
    );
    expect(output.exports.mermaid.combinedDiagram).toContain('%% deployment');
    expect(markdown).toContain('# Architecture IR: architecture-ir-sample');
    expect(markdown).toContain('## Structurizr DSL');
  });

  it('bootstrapGenerators 后可通过 architecture-ir id 查询，barrel export 可见', async () => {
    bootstrapGenerators();

    const registry = GeneratorRegistry.getInstance();
    const registered = registry.get('architecture-ir');
    expect(registered).toBeDefined();
    expect(registered).toBeInstanceOf(ArchitectureIRGenerator);

    expect(typeof panoramic.ArchitectureIRGenerator).toBe('function');

    const filtered = await registry.filterByContext(createContext(tmpDir, 'monorepo'));
    expect(filtered.some((item) => item.id === 'architecture-ir')).toBe(true);
  });
});
