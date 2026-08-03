/**
 * F249 T029 — `graph-quality-report.schema.json` 契约测试（`--json` 输出契约）。
 *
 * 两件事：
 * ① **契约本体**：schema 已登记 `staleReasons`（`items.enum` 恰为四值、不进 `required`、
 *    `additionalProperties: false` 沿用不变）——这条硬校验是本需求最大的契约风险点：
 *    `$defs.GraphFreshnessVerdict` 是 `additionalProperties: false`，未登记就会让所有携带
 *    `staleReasons` 的真实输出变成"非法输出"。
 * ② **真实输出过校验**：拿 SC-009 五类场景经**真实 dist CLI `--json`** 产出的报告对象，
 *    过递归校验器逐层校验。用真实输出而非手搓对象的理由：手搓对象只能证明"我以为的形状合法"，
 *    证不了"CLI 实际吐出的东西合法"——两者的差异（如 `JSON.stringify` 丢弃 undefined 字段、
 *    某个字段忘了透传）正是契约测试要抓的东西。
 *
 * 递归校验器（`tests/helpers/json-schema-subset-validator.ts`）自身在本文件末尾有独立
 * 五要素正反例覆盖——否则"校验器什么都不校验"会让上面两件事一起变成空转。
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { resolve } from 'node:path';
import { validateAgainstSchema } from '../../helpers/json-schema-subset-validator.js';
import {
  ALL_STALE_REASONS,
  SC009_STALE_SCENARIOS,
  baseFreshnessGraph,
} from '../../helpers/freshness-stale-scenarios.js';
import type { GraphJSON } from '../../../src/panoramic/graph/graph-types.js';

const CLI_PATH = resolve('dist/cli/index.js');
const SCHEMA_PATH = resolve(
  'specs/217-graph-quality-gates/contracts/graph-quality-report.schema.json',
);

type JsonSchema = Record<string, unknown>;

function loadSchema(): JsonSchema {
  return JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8')) as JsonSchema;
}

/** 取 `$defs.GraphFreshnessVerdict` 节点（多处断言复用）。 */
function freshnessVerdictDef(schema: JsonSchema): JsonSchema {
  const defs = schema['$defs'] as Record<string, JsonSchema>;
  return defs['GraphFreshnessVerdict'] as JsonSchema;
}

describe('graph-quality-report.schema.json — staleReasons 契约登记（F249 FR-009）', () => {
  it('$defs.GraphFreshnessVerdict.properties 已登记 staleReasons', () => {
    const properties = freshnessVerdictDef(loadSchema())['properties'] as Record<string, JsonSchema>;
    expect(Object.keys(properties)).toContain('staleReasons');
  });

  it('staleReasons 为 array，items.enum 恰为四个原因值（与 FreshnessStaleReason 联合类型对齐）', () => {
    const properties = freshnessVerdictDef(loadSchema())['properties'] as Record<string, JsonSchema>;
    const staleReasons = properties['staleReasons'] as JsonSchema;
    expect(staleReasons['type']).toBe('array');
    const items = staleReasons['items'] as JsonSchema;
    expect(items['type']).toBe('string');
    expect(items['enum']).toEqual([
      'source-commit',
      'collector-fingerprint',
      'collector-fingerprint-unrecorded',
      'collector-fingerprint-invalid',
    ]);
  });

  it('schema 的 enum 集合与运行时 ALL_STALE_REASONS 完全一致（防两处取值域漂移）', () => {
    const properties = freshnessVerdictDef(loadSchema())['properties'] as Record<string, JsonSchema>;
    const items = (properties['staleReasons'] as JsonSchema)['items'] as JsonSchema;
    expect(items['enum']).toEqual([...ALL_STALE_REASONS]);
  });

  it('staleReasons 是可选字段：不出现在 required（state!==stale 时字段缺席）', () => {
    const def = freshnessVerdictDef(loadSchema());
    expect(def['required']).toEqual(['state', 'recordedSourceCommit', 'currentHead']);
  });

  it('additionalProperties:false 沿用不变；state 枚举本身未新增值', () => {
    const def = freshnessVerdictDef(loadSchema());
    expect(def['additionalProperties']).toBe(false);
    const properties = def['properties'] as Record<string, JsonSchema>;
    expect((properties['state'] as JsonSchema)['enum']).toEqual([
      'fresh',
      'dirty',
      'stale',
      'unknown-provenance',
    ]);
  });
});

describe('真实 CLI --json 输出过递归 schema 校验（SC-009 五类样本）', () => {
  beforeAll(() => {
    // 与 graph-quality-cli.test.ts / graph-quality-core.test.ts 同一惯例：dist 必须含本次改动，
    // 否则校验的是旧编译产物的输出（假绿）。构建成本实测约 2s。
    execFileSync('npm', ['run', 'build'], { encoding: 'utf-8', timeout: 120_000 });
  }, 120_000);

  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'graph-quality-schema-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function initGitRepoWithCommit(dir: string): string {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['config', 'user.email', 'f243-schema@example.com'], { cwd: dir });
    execFileSync('git', ['config', 'user.name', 'F249 Schema Test'], { cwd: dir });
    fs.writeFileSync(path.join(dir, 'README.md'), '# f243 schema fixture\n');
    execFileSync('git', ['add', '.'], { cwd: dir });
    execFileSync('git', ['commit', '-q', '-m', 'initial'], { cwd: dir });
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: dir, encoding: 'utf-8' }).trim();
  }

  /** 落盘场景图 → 跑真实 dist CLI `--json` → 返回解析后的报告对象。 */
  function runRealCliJson(buildGraph: (head: string) => GraphJSON): Record<string, unknown> {
    const sha = initGitRepoWithCommit(tmpDir);
    const graphPath = path.join(tmpDir, 'specs', '_meta', 'graph.json');
    fs.mkdirSync(path.dirname(graphPath), { recursive: true });
    fs.writeFileSync(graphPath, JSON.stringify(buildGraph(sha), null, 2), 'utf-8');

    let stdout: string;
    try {
      stdout = execFileSync('node', [CLI_PATH, 'graph-quality', '--graph', graphPath, '--json'], {
        encoding: 'utf-8',
        timeout: 30_000,
        cwd: tmpDir,
      });
    } catch (err: unknown) {
      // exit 1/2 场景 CLI 仍先输出完整 JSON（既有契约），取 stdout 继续
      stdout = (err as { stdout?: string }).stdout ?? '';
    }
    return JSON.parse(stdout) as Record<string, unknown>;
  }

  for (const scenario of SC009_STALE_SCENARIOS) {
    it(`${scenario.id}（${scenario.label}）的真实 --json 输出逐层符合 schema`, () => {
      const report = runRealCliJson(scenario.buildGraph);
      const schema = loadSchema();

      // 先确认拿到的确实是本场景的输出（否则可能在校验一个无关报告）
      const freshness = report['freshness'] as Record<string, unknown>;
      expect(freshness['state']).toBe('stale');
      expect(freshness['staleReasons']).toEqual(scenario.expectedStaleReasons);

      const result = validateAgainstSchema(report, schema);
      expect(result.violations).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it(`${scenario.id}：staleReasons 每个元素均 ∈ schema 声明的 enum 集合`, () => {
      const report = runRealCliJson(scenario.buildGraph);
      const properties = freshnessVerdictDef(loadSchema())['properties'] as Record<
        string,
        JsonSchema
      >;
      const allowed = ((properties['staleReasons'] as JsonSchema)['items'] as JsonSchema)[
        'enum'
      ] as string[];

      const freshness = report['freshness'] as Record<string, unknown>;
      const reasons = freshness['staleReasons'] as string[];
      expect(reasons.length).toBeGreaterThan(0);
      for (const reason of reasons) {
        expect(allowed).toContain(reason);
      }
    });
  }

  it('fresh 态真实输出同样符合 schema（staleReasons 缺席不违反 required）', () => {
    const report = runRealCliJson((head) => baseFreshnessGraph({ sourceCommit: head }));
    const freshness = report['freshness'] as Record<string, unknown>;
    expect(freshness['state']).toBe('fresh');
    expect('staleReasons' in freshness).toBe(false);

    const result = validateAgainstSchema(report, loadSchema());
    expect(result.violations).toEqual([]);
  });

  it('cannot-assess 真实输出（schemaVersion 1.0）同样符合 schema', () => {
    const report = runRealCliJson((head) => {
      const graph = baseFreshnessGraph({ schemaVersion: '1.0', sourceCommit: head });
      return graph;
    });
    expect(report['overallVerdict']).toBe('cannot-assess');

    const result = validateAgainstSchema(report, loadSchema());
    expect(result.violations).toEqual([]);
  });

  it('灵敏度证明：真实输出注入一个未登记字段后，递归校验器必然报违规（否则上面的绿是空转）', () => {
    const report = runRealCliJson(SC009_STALE_SCENARIOS[0]!.buildGraph);
    const freshness = report['freshness'] as Record<string, unknown>;
    freshness['someUnregisteredField'] = 'x';

    const result = validateAgainstSchema(report, loadSchema());
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.message.includes('someUnregisteredField'))).toBe(true);
    // 定位到嵌套层而非顶层——证明校验器确实递归进了 $ref 指向的 $defs
    expect(result.violations.some((v) => v.path === '/freshness')).toBe(true);
  });

  it('灵敏度证明：把 staleReasons 篡改为 enum 外的值后必然报违规', () => {
    const report = runRealCliJson(SC009_STALE_SCENARIOS[0]!.buildGraph);
    const freshness = report['freshness'] as Record<string, unknown>;
    freshness['staleReasons'] = ['totally-made-up-reason'];

    const result = validateAgainstSchema(report, loadSchema());
    expect(result.valid).toBe(false);
    expect(result.violations.some((v) => v.path === '/freshness/staleReasons/0')).toBe(true);
  });
});

// ============================================================
// 递归校验器自身的五要素正反例覆盖（T029 要求）
//
// 没有这一节，上面所有"符合 schema"的绿都可能只是因为校验器什么都不校验。
// ============================================================

describe('json-schema-subset-validator：五要素各一条正反例', () => {
  it('type：正例通过 / 反例报违规', () => {
    const schema = { type: 'object', properties: { n: { type: 'integer' } } };
    expect(validateAgainstSchema({ n: 1 }, schema).valid).toBe(true);
    const bad = validateAgainstSchema({ n: 1.5 }, schema);
    expect(bad.valid).toBe(false);
    expect(bad.violations[0]?.path).toBe('/n');
  });

  it('type 联合数组（如 ["string","null"]）：两支均通过 / 第三种类型报违规', () => {
    const schema = { type: 'object', properties: { v: { type: ['string', 'null'] } } };
    expect(validateAgainstSchema({ v: 'x' }, schema).valid).toBe(true);
    expect(validateAgainstSchema({ v: null }, schema).valid).toBe(true);
    expect(validateAgainstSchema({ v: 7 }, schema).valid).toBe(false);
  });

  it('required：字段齐备通过 / 缺字段报违规', () => {
    const schema = { type: 'object', required: ['a', 'b'], properties: { a: {}, b: {} } };
    expect(validateAgainstSchema({ a: 1, b: 2 }, schema).valid).toBe(true);
    const bad = validateAgainstSchema({ a: 1 }, schema);
    expect(bad.valid).toBe(false);
    expect(bad.violations[0]?.message).toContain('b');
  });

  it('additionalProperties:false：仅登记字段通过 / 多出字段报违规', () => {
    const schema = { type: 'object', additionalProperties: false, properties: { a: {} } };
    expect(validateAgainstSchema({ a: 1 }, schema).valid).toBe(true);
    expect(validateAgainstSchema({ a: 1, z: 2 }, schema).valid).toBe(false);
  });

  it('items：元素全合法通过 / 任一元素非法报违规（定位到下标）', () => {
    const schema = { type: 'array', items: { type: 'string' } };
    expect(validateAgainstSchema(['a', 'b'], schema).valid).toBe(true);
    const bad = validateAgainstSchema(['a', 3], schema);
    expect(bad.valid).toBe(false);
    expect(bad.violations[0]?.path).toBe('/1');
  });

  it('enum：取值域内通过 / 域外报违规', () => {
    const schema = { type: 'string', enum: ['x', 'y'] };
    expect(validateAgainstSchema('x', schema).valid).toBe(true);
    expect(validateAgainstSchema('z', schema).valid).toBe(false);
  });

  it('$ref：递归进本地 $defs，嵌套层的 additionalProperties 同样生效', () => {
    const schema = {
      type: 'object',
      properties: { child: { $ref: '#/$defs/Child' } },
      $defs: {
        Child: { type: 'object', additionalProperties: false, properties: { ok: { type: 'string' } } },
      },
    };
    expect(validateAgainstSchema({ child: { ok: 's' } }, schema).valid).toBe(true);
    const bad = validateAgainstSchema({ child: { ok: 's', extra: 1 } }, schema);
    expect(bad.valid).toBe(false);
    expect(bad.violations[0]?.path).toBe('/child');
  });

  it('可选字段缺席不报违规（区别于 required 缺失）', () => {
    const schema = {
      type: 'object',
      required: ['a'],
      additionalProperties: false,
      properties: { a: { type: 'string' }, optional: { type: 'array', items: { type: 'string' } } },
    };
    expect(validateAgainstSchema({ a: 'x' }, schema).valid).toBe(true);
  });

  // ── W-006：own-property 判定（原型链名字不得被当成"已登记"或"已存在"）──

  it.each(['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'])(
    'additionalProperties:false 必须拒绝名为 %s 的未登记字段（`in` 会命中 Object.prototype）',
    (injectedKey) => {
      const schema = { type: 'object', additionalProperties: false, properties: { a: {} } };
      // 用 defineProperty 而非字面量：`__proto__` 在对象字面量里会被当成原型设置而不是普通 key
      const instance: Record<string, unknown> = { a: 1 };
      Object.defineProperty(instance, injectedKey, {
        value: 'injected',
        enumerable: true,
        configurable: true,
        writable: true,
      });

      const result = validateAgainstSchema(instance, schema);
      expect(result.valid).toBe(false);
      expect(result.violations.map((violation) => violation.message).join('\n')).toContain(injectedKey);
    },
  );

  it.each(['constructor', 'toString'])(
    'required 缺失名为 %s 的字段必须报违规（`in` 会误判为已存在）',
    (requiredKey) => {
      const schema = { type: 'object', required: [requiredKey], properties: { [requiredKey]: {} } };

      const result = validateAgainstSchema({}, schema);
      expect(result.valid).toBe(false);
      expect(result.violations[0]?.message).toContain(requiredKey);
    },
  );

  it('原型链上的同名字段不会被当作实例字段递归校验（只看 own property）', () => {
    // 反面活性：真的把 `toString` 作为 own 字段且类型不符时，仍必须报违规
    const schema = { type: 'object', properties: { toString: { type: 'string' } } };
    expect(validateAgainstSchema({}, schema).valid).toBe(true); // 未提供 → 可选字段缺席
    expect(validateAgainstSchema({ toString: 42 }, schema).valid).toBe(false); // 提供了但类型错
  });
});
