/**
 * EventSurfaceGenerator 单元测试
 * 覆盖 TS/JS inventory、Python 文本回退、状态附录、registry / barrel 集成
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { ProjectContext } from '../../src/panoramic/interfaces.js';
import { EventSurfaceGenerator } from '../../src/panoramic/event-surface-generator.js';
import { GeneratorRegistry, bootstrapGenerators } from '../../src/panoramic/generator-registry.js';

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'event-surface-test-'));
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

describe('EventSurfaceGenerator - TS/JS inventory', () => {
  let tmpDir: string;
  let generator: EventSurfaceGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new EventSurfaceGenerator();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('识别 emit/on 与 publish/subscribe/consume，并聚合 payload fields', async () => {
    writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'eventful-project' }),
    );

    writeFile(
      path.join(tmpDir, 'src', 'events.ts'),
      `
import { EventEmitter } from 'node:events';

const bus = new EventEmitter();
const broker = {
  publish(channel: string, payload: unknown) {
    return { channel, payload };
  },
  subscribe(channel: string, handler: (...args: unknown[]) => void) {
    return { channel, handler };
  },
};

const worker = {
  consume(channel: string, handler: (...args: unknown[]) => void) {
    return { channel, handler };
  },
};

export function publishTicketCreated(ticketId: string, actorId: string) {
  bus.emit('ticket.created', { ticketId, actorId });
}

export function registerTicketHandlers() {
  bus.on('ticket.created', handleTicketCreated);
  broker.publish('orders.created', { orderId: 'o-1', amount: 100 });
  broker.subscribe('orders.created', onOrderCreated);
  worker.consume('jobs.reconcile', reconcileJob);
}

function handleTicketCreated(payload: unknown) {
  return payload;
}

const onOrderCreated = (payload: unknown) => payload;

function reconcileJob(job: unknown) {
  return job;
}
      `.trim(),
    );

    const input = await generator.extract(createContext(tmpDir));
    expect(input.projectName).toBe('eventful-project');
    expect(input.sourceFiles).toEqual(['src/events.ts']);
    expect(input.occurrences.map((item) => `${item.channelName}:${item.role}:${item.methodName}`)).toEqual([
      'jobs.reconcile:subscriber:consume',
      'orders.created:publisher:publish',
      'orders.created:subscriber:subscribe',
      'ticket.created:publisher:emit',
      'ticket.created:subscriber:on',
    ]);

    const output = await generator.generate(input);
    expect(output.totalChannels).toBe(3);
    expect(output.totalPublishers).toBe(2);
    expect(output.totalSubscribers).toBe(3);

    const ticketChannel = output.channels.find((channel) => channel.channelName === 'ticket.created');
    expect(ticketChannel).toBeDefined();
    expect(ticketChannel!.kind).toBe('event');
    expect(ticketChannel!.messageFields).toEqual(['actorId', 'ticketId']);
    expect(ticketChannel!.payloadSamples).toEqual(['{ actorId, ticketId }']);
    expect(ticketChannel!.subscribers[0]!.payloadSummary).toBeUndefined();

    const ordersChannel = output.channels.find((channel) => channel.channelName === 'orders.created');
    expect(ordersChannel).toBeDefined();
    expect(ordersChannel!.kind).toBe('topic');
    expect(ordersChannel!.messageFields).toEqual(['amount', 'orderId']);

    const queueChannel = output.channels.find((channel) => channel.channelName === 'jobs.reconcile');
    expect(queueChannel).toBeDefined();
    expect(queueChannel!.kind).toBe('queue');
    expect(queueChannel!.publishers).toHaveLength(0);
    expect(queueChannel!.subscribers).toHaveLength(1);

    const markdown = generator.render(output);
    expect(markdown).toContain('# 事件面文档: eventful-project');
    expect(markdown).toContain('ticket.created');
    expect(markdown).toContain('orders.created');
    expect(markdown).toContain('jobs.reconcile');
    expect(markdown).toContain('Event Flow');
  });

  it('非对象 payload 回退为表达式摘要，不臆造字段', async () => {
    writeFile(
      path.join(tmpDir, 'src', 'publisher.ts'),
      `
const bus = {
  emit(channel: string, payload: unknown) {
    return { channel, payload };
  },
};

export function publishTicketUpdated(payload: Record<string, unknown>) {
  bus.emit('ticket.updated', payload);
}
      `.trim(),
    );

    const output = await generator.generate(await generator.extract(createContext(tmpDir)));
    const channel = output.channels.find((item) => item.channelName === 'ticket.updated');

    expect(channel).toBeDefined();
    expect(channel!.messageFields).toEqual([]);
    expect(channel!.payloadSamples).toEqual(['payload']);
  });
});

describe('EventSurfaceGenerator - Python 文本回退', () => {
  let tmpDir: string;
  let generator: EventSurfaceGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new EventSurfaceGenerator();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('无 TS/JS AST 时，仍能从 Python 文本模式提取 channel 与 payload fields', async () => {
    writeFile(
      path.join(tmpDir, 'worker.py'),
      `
def publish_user_created(user_id, email):
    bus.emit("user.created", {"user_id": user_id, "email": email})

def register_handlers():
    bus.on("user.created", handle_user_created)
      `.trim(),
    );

    const input = await generator.extract(createContext(tmpDir));
    const output = await generator.generate(input);
    const channel = output.channels.find((item) => item.channelName === 'user.created');

    expect(input.occurrences.map((item) => item.symbolName)).toEqual([
      'publish_user_created',
      'register_handlers',
    ]);
    expect(channel).toBeDefined();
    expect(channel!.messageFields).toEqual(['email', 'user_id']);
    expect(channel!.payloadSamples).toEqual(['{"user_id": user_id, "email": email}']);
    expect(channel!.publishers).toHaveLength(1);
    expect(channel!.subscribers).toHaveLength(1);
  });
});

describe('EventSurfaceGenerator - 状态附录', () => {
  let tmpDir: string;
  let generator: EventSurfaceGenerator;

  beforeEach(() => {
    tmpDir = createTempDir();
    generator = new EventSurfaceGenerator();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
  });

  it('状态命名模式会生成低置信状态附录', async () => {
    writeFile(
      path.join(tmpDir, 'src', 'ticket-lifecycle.ts'),
      `
const bus = {
  emit(channel: string, payload: unknown) {
    return { channel, payload };
  },
};

export function publishTicketLifecycle(ticketId: string) {
  bus.emit('ticket.opened', { ticketId });
  bus.emit('ticket.processing', { ticketId });
  bus.emit('ticket.closed', { ticketId });
}
      `.trim(),
    );

    const output = await generator.generate(await generator.extract(createContext(tmpDir)));

    expect(output.stateAppendixConfidence).toBe('low');
    expect(output.stateAppendixMermaid).toContain('stateDiagram-v2');
    expect(output.stateAppendixMermaid).toContain('ticket.opened');
    expect(output.stateAppendixMermaid).toContain('[推断]');

    const markdown = generator.render(output);
    expect(markdown).toContain('## 状态附录 [推断]');
    expect(markdown).toContain('置信度: `low`');
  });
});

describe('EventSurfaceGenerator - registry / exports 集成', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = createTempDir();
    GeneratorRegistry.resetInstance();
  });

  afterEach(() => {
    cleanupDir(tmpDir);
    GeneratorRegistry.resetInstance();
  });

  it('bootstrapGenerators 后可通过 event-surface id 查询，并按上下文发现/过滤', async () => {
    writeFile(
      path.join(tmpDir, 'src', 'app.ts'),
      `
const bus = {
  emit(channel: string, payload: unknown) {
    return { channel, payload };
  },
};

export function main() {
  bus.emit('audit.logged', { requestId: 'req-1' });
}
      `.trim(),
    );

    bootstrapGenerators();
    const registry = GeneratorRegistry.getInstance();
    const generator = registry.get('event-surface');

    expect(generator).toBeInstanceOf(EventSurfaceGenerator);

    const applicable = await registry.filterByContext(createContext(tmpDir));
    expect(applicable.some((item) => item.id === 'event-surface')).toBe(true);

    const emptyDir = createTempDir();
    try {
      writeFile(path.join(emptyDir, 'src', 'app.ts'), 'export const value = 1;\n');
      const notApplicable = await registry.filterByContext(createContext(emptyDir));
      expect(notApplicable.some((item) => item.id === 'event-surface')).toBe(false);
    } finally {
      cleanupDir(emptyDir);
    }
  });

  it('barrel 导出 EventSurfaceGenerator 及其类型', async () => {
    const panoramic = await import('../../src/panoramic/index.js');

    expect(panoramic.EventSurfaceGenerator).toBe(EventSurfaceGenerator);
    expect(typeof panoramic.GeneratorRegistry.getInstance).toBe('function');
  });
});
