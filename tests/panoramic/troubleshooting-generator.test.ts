/**
 * TroubleshootingGenerator 单元测试
 * 覆盖 grounded troubleshooting entries、配置约束、explanation 证据链、registry / barrel 集成
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProjectContext } from '../../src/panoramic/interfaces.js';
import { TroubleshootingGenerator } from '../../src/panoramic/troubleshooting-generator.js';
import { GeneratorRegistry, bootstrapGenerators } from '../../src/panoramic/generator-registry.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'troubleshooting-test-'));
}

function cleanupDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
}

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

describe('TroubleshootingGenerator - grounded troubleshooting entries', () => {
  let tmpDir: string;
  let generator: TroubleshootingGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new TroubleshootingGenerator();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('混合 fixture 生成至少 5 条 grounded troubleshooting entries', async () => {
    writeFile(path.join(tmpDir, 'package.json'), JSON.stringify({ name: 'troubleshooting-project' }));
    writeFile(
      path.join(tmpDir, '.env.example'),
      `
DATABASE_URL=postgres://localhost/app
REDIS_URL=redis://localhost:6379
LOG_LEVEL=info
      `.trim(),
    );

    writeFile(
      path.join(tmpDir, 'src', 'config.ts'),
      `
export function validateConfig() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!process.env.REDIS_URL) throw new Error('REDIS_URL is required');

  const level = process.env.LOG_LEVEL;
  if (level && !['debug', 'info', 'warn'].includes(level)) {
    throw new Error('LOG_LEVEL is invalid');
  }
}
      `.trim(),
    );

    writeFile(
      path.join(tmpDir, 'src', 'broker.ts'),
      `
export async function connectBroker() {
  logger.error('Broker unavailable');
  await retryConnection();
}

async function retryConnection() {
  return 'retry';
}
      `.trim(),
    );

    writeFile(
      path.join(tmpDir, 'src', 'snapshot.ts'),
      `
export function restoreSnapshot(snapshot?: object) {
  if (!snapshot) {
    console.error('Snapshot missing');
    return fallbackToCache();
  }
  return snapshot;
}

function fallbackToCache() {
  return { source: 'cache' };
}
      `.trim(),
    );

    const output = await generator.generate(await generator.extract(createContext(tmpDir)));

    expect(output.projectName).toBe('troubleshooting-project');
    expect(output.totalEntries).toBeGreaterThanOrEqual(5);

    const titles = output.entries.map((entry) => entry.title);
    expect(titles).toContain('配置约束: DATABASE_URL');
    expect(titles).toContain('配置约束: REDIS_URL');
    expect(titles).toContain('配置约束: LOG_LEVEL');
    expect(titles).toContain('故障: Broker unavailable');
    expect(titles).toContain('故障: Snapshot missing');

    const databaseEntry = output.entries.find((entry) => entry.title === '配置约束: DATABASE_URL');
    expect(databaseEntry).toBeDefined();
    expect(databaseEntry!.symptom).toContain('DATABASE_URL is required');
    expect(databaseEntry!.configKeys).toEqual(['DATABASE_URL']);
    expect(databaseEntry!.relatedLocations.some((location) => location.sourceFile === '.env.example')).toBe(true);

    const brokerEntry = output.entries.find((entry) => entry.title === '故障: Broker unavailable');
    expect(brokerEntry).toBeDefined();
    expect(brokerEntry!.recoverySteps.some((step) => step.includes('重试'))).toBe(true);

    const snapshotEntry = output.entries.find((entry) => entry.title === '故障: Snapshot missing');
    expect(snapshotEntry).toBeDefined();
    expect(snapshotEntry!.recoverySteps.some((step) => step.includes('回退') || step.includes('缓存'))).toBe(true);

    const markdown = generator.render(output);
    expect(markdown).toContain('# 故障排查 / 原理说明: troubleshooting-project');
    expect(markdown).toContain('## Troubleshooting Inventory');
    expect(markdown).toContain('## Explanation');
  });

  it('重复配置键会被合并而不是重复输出', async () => {
    writeFile(
      path.join(tmpDir, 'src', 'config.ts'),
      `
export function validatePrimary() {
  if (!process.env.API_TOKEN) throw new Error('API_TOKEN is required');
}

export function validateSecondary() {
  if (!process.env.API_TOKEN) throw new Error('API_TOKEN is required');
}
      `.trim(),
    );

    const output = await generator.generate(await generator.extract(createContext(tmpDir)));
    const tokenEntries = output.entries.filter((entry) => entry.title === '配置约束: API_TOKEN');

    expect(tokenEntries).toHaveLength(1);
    expect(tokenEntries[0]!.relatedLocations).toHaveLength(2);
  });
});

describe('TroubleshootingGenerator - explanation evidence', () => {
  let tmpDir: string;
  let generator: TroubleshootingGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new TroubleshootingGenerator();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('retry / fallback 证据会触发 explanation 段落', async () => {
    writeFile(
      path.join(tmpDir, 'src', 'worker.ts'),
      `
export async function boot() {
  if (!process.env.BROKER_URL) throw new Error('BROKER_URL is required');
  logger.error('Broker unavailable');
  await reconnectBroker();
  return fallbackToCache();
}
      `.trim(),
    );

    const output = await generator.generate(await generator.extract(createContext(tmpDir)));
    const explanationTitles = output.explanations.map((entry) => entry.title);

    expect(explanationTitles).toContain('配置校验策略');
    expect(explanationTitles).toContain('瞬时故障恢复路径');
    expect(explanationTitles).toContain('降级与回退策略');
  });

  it('条目不足 5 条时输出 warning 而不是失败', async () => {
    writeFile(
      path.join(tmpDir, 'src', 'app.ts'),
      `
export function boot() {
  throw new Error('Only one issue');
}
      `.trim(),
    );

    const output = await generator.generate(await generator.extract(createContext(tmpDir)));

    expect(output.totalEntries).toBe(1);
    expect(output.warnings.some((warning) => warning.includes('低于蓝图建议的 5 条'))).toBe(true);
  });
});

describe('TroubleshootingGenerator - registry / exports 集成', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    GeneratorRegistry.resetInstance();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
    GeneratorRegistry.resetInstance();
  });

  it('bootstrapGenerators 后可通过 troubleshooting id 查询，并按上下文发现/过滤', async () => {
    writeFile(
      path.join(tmpDir, 'src', 'app.ts'),
      `
export function boot() {
  if (!process.env.API_URL) throw new Error('API_URL is required');
}
      `.trim(),
    );

    bootstrapGenerators();
    const registry = GeneratorRegistry.getInstance();
    const generator = registry.get('troubleshooting');

    expect(generator).toBeInstanceOf(TroubleshootingGenerator);

    const applicable = await registry.filterByContext(createContext(tmpDir));
    expect(applicable.some((item) => item.id === 'troubleshooting')).toBe(true);

    const emptyDir = createTempDir();
    try {
      writeFile(path.join(emptyDir, 'src', 'app.ts'), 'export const value = 1;\n');
      const notApplicable = await registry.filterByContext(createContext(emptyDir));
      expect(notApplicable.some((item) => item.id === 'troubleshooting')).toBe(false);
    } finally {
      cleanupDir(emptyDir);
    }
  });

  it('barrel 导出 TroubleshootingGenerator 和相关类型', async () => {
    const panoramic = await import('../../src/panoramic/index.js');

    expect(panoramic.TroubleshootingGenerator).toBe(TroubleshootingGenerator);
    expect(typeof panoramic.GeneratorRegistry.getInstance).toBe('function');
  });
});
