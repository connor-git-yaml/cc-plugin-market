/**
 * RuntimeTopologyGenerator 单元测试
 *
 * 覆盖：
 * - Compose + Dockerfile + .env 联合解析
 * - multi-stage Dockerfile 归一化
 * - GeneratorRegistry / barrel 导出集成
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProjectContext } from '../../src/panoramic/interfaces.js';
import { GeneratorRegistry, bootstrapGenerators } from '../../src/panoramic/generator-registry.js';
import { RuntimeTopologyGenerator } from '../../src/panoramic/runtime-topology-generator.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'runtime-topology-test-'));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

function createContext(projectRoot: string): ProjectContext {
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
    workspaceType: 'single',
    detectedLanguages: [],
    existingSpecs: [],
  };
}

describe('RuntimeTopologyGenerator - Compose + Dockerfile 联合解析', () => {
  let tmpDir: string;
  let generator: RuntimeTopologyGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new RuntimeTopologyGenerator();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('生成完整运行时拓扑，覆盖服务/镜像/容器/端口/卷/依赖/环境变量', async () => {
    writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'sample-runtime-project' }),
    );

    writeFile(
      path.join(tmpDir, 'docker-compose.yml'),
      `services:
  app:
    build:
      context: ./apps/api
      dockerfile: Dockerfile
      target: runner
    container_name: api-container
    env_file:
      - .env
      - apps/api/.env.service
    environment:
      APP_ENV: production
      PORT: "8080"
    ports:
      - 8080:8080
      - target: 9090
        published: 9090
        protocol: tcp
    volumes:
      - ./data:/var/lib/app:ro
      - type: volume
        source: shared-data
        target: /cache
    command: ["node", "server.js"]
    depends_on:
      db:
        condition: service_healthy
  db:
    image: postgres:15
    environment:
      POSTGRES_DB: app
    ports:
      - 5432:5432
`,
    );

    writeFile(
      path.join(tmpDir, '.env'),
      `DATABASE_URL=postgres://db:5432/app
PORT=7000
`,
    );

    writeFile(
      path.join(tmpDir, 'apps/api/.env.service'),
      `FEATURE_FLAG=enabled
PORT=7001
`,
    );

    writeFile(
      path.join(tmpDir, 'apps/api/Dockerfile'),
      `FROM node:20-alpine AS builder
WORKDIR /app
ENV NODE_ENV=build
COPY package.json .
RUN npm ci

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY --from=builder /app /app
EXPOSE 8080
VOLUME ["/cache"]
CMD ["node", "server.js"]
`,
    );

    const input = await generator.extract(createContext(tmpDir));
    const output = await generator.generate(input);
    const markdown = generator.render(output);

    expect(output.topology.services).toHaveLength(2);
    expect(output.topology.containers).toHaveLength(2);
    expect(output.topology.images).toHaveLength(2);
    expect(output.topology.stages).toHaveLength(2);

    const appService = output.topology.services.find((service) => service.name === 'app');
    expect(appService).toBeDefined();
    expect(appService!.containerName).toBe('api-container');
    expect(appService!.buildContext).toBe('apps/api');
    expect(appService!.dockerfilePath).toBe('apps/api/Dockerfile');
    expect(appService!.targetStage).toBe('runner');
    expect(appService!.stageNames).toEqual(['builder', 'runner']);
    expect(appService!.ports).toHaveLength(2);
    expect(appService!.volumes).toHaveLength(2);
    expect(appService!.dependsOn).toEqual([
      {
        service: 'db',
        sourceFile: 'docker-compose.yml',
        condition: 'service_healthy',
      },
    ]);

    const appEnv = new Map(appService!.environment.map((entry) => [entry.name, entry]));
    expect(appEnv.get('DATABASE_URL')!.value).toBe('postgres://db:5432/app');
    expect(appEnv.get('FEATURE_FLAG')!.value).toBe('enabled');
    expect(appEnv.get('PORT')!.value).toBe('8080');
    expect(appEnv.get('PORT')!.sourceKind).toBe('compose');

    const appContainer = output.topology.containers.find((container) => container.name === 'api-container');
    expect(appContainer).toBeDefined();
    expect(appContainer!.image).toBe('app:build');

    const runtimeStage = output.topology.stages.find((stage) => stage.name === 'runner');
    expect(runtimeStage).toBeDefined();
    expect(runtimeStage!.role).toBe('runtime');
    expect(runtimeStage!.copiesFrom).toEqual(['builder']);
    expect(runtimeStage!.exposedPorts).toEqual(['8080']);

    expect(markdown).toContain('# 运行时拓扑: sample-runtime-project');
    expect(markdown).toContain('api-container');
    expect(markdown).toContain('shared-data');
    expect(markdown).toContain('postgres:15');
  });
});

describe('RuntimeTopologyGenerator - multi-stage Dockerfile', () => {
  let tmpDir: string;
  let generator: RuntimeTopologyGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new RuntimeTopologyGenerator();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('Dockerfile-only 项目也能识别 build/runtime stages', async () => {
    writeFile(
      path.join(tmpDir, 'Dockerfile'),
      `FROM node:20-alpine AS deps
WORKDIR /app
RUN npm ci

FROM deps AS builder
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/dist /app/dist
CMD ["node", "dist/server.js"]
`,
    );

    const output = await generator.generate(await generator.extract(createContext(tmpDir)));

    expect(output.topology.services).toHaveLength(0);
    expect(output.topology.images).toHaveLength(1);
    expect(output.topology.images[0]!.name).toBe('Dockerfile');

    const stageRoles = new Map(output.topology.stages.map((stage) => [stage.name, stage.role]));
    expect(stageRoles.get('deps')).toBe('build');
    expect(stageRoles.get('builder')).toBe('build');
    expect(stageRoles.get('runtime')).toBe('runtime');

    const runtimeStage = output.topology.stages.find((stage) => stage.name === 'runtime');
    expect(runtimeStage!.copiesFrom).toEqual(['builder']);
    expect(runtimeStage!.command).toBe('node dist/server.js');
  });
});

describe('RuntimeTopologyGenerator - registry / exports 集成', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    GeneratorRegistry.resetInstance();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('bootstrapGenerators 后可通过 runtime-topology id 查询，并能按上下文发现', async () => {
    writeFile(
      path.join(tmpDir, 'compose.yaml'),
      `services:
  web:
    image: nginx:1.27
`,
    );

    bootstrapGenerators();
    const registry = GeneratorRegistry.getInstance();
    const generator = registry.get('runtime-topology');

    expect(generator).toBeInstanceOf(RuntimeTopologyGenerator);

    const filtered = await registry.filterByContext(createContext(tmpDir));
    expect(filtered.some((item) => item.id === 'runtime-topology')).toBe(true);
  });

  it('barrel 导出 RuntimeTopologyGenerator 和共享 helper', async () => {
    const panoramic = await import('../../src/panoramic/index.js');

    expect(panoramic.RuntimeTopologyGenerator).toBe(RuntimeTopologyGenerator);
    expect(typeof panoramic.summarizeRuntimeTopology).toBe('function');
    expect(typeof panoramic.mergeEnvironmentVariables).toBe('function');
  });
});
