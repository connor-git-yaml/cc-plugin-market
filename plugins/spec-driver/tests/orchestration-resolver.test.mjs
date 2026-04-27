/**
 * orchestration-resolver.test.mjs
 * Feature 133 — orchestration overrides resolver 测试矩阵
 *
 * 测试组：
 *   T1: 合并测试（≥6 用例）
 *   T2: 降级路径测试（≥5 用例 + anchor 边界 = ≥6 用例）
 *   T3: CLI dry-run 输出测试（≥4 用例）
 *   T4: base Zod 兼容性回归测试（≥3 用例）
 *
 * 运行方式: node --test plugins/spec-driver/tests/orchestration-resolver.test.mjs
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { resolveOrchestrationConfig } from '../lib/orchestration-resolver.mjs';
import { orchestrationBaseSchema, orchestrationMergedSchema } from '../contracts/orchestration-schema.mjs';
import { Orchestrator } from '../lib/orchestrator.mjs';
import { parseYamlDocument } from '../scripts/lib/simple-yaml.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, 'fixtures', 'orchestration');
const CLI_PATH = path.join(__dirname, '..', 'scripts', 'orchestrator-cli.mjs');

/**
 * 创建临时项目目录，可选地写入 .specify/orchestration-overrides.yaml
 * @param {string|null} fixtureFileName - fixture 文件名（null 则不创建 overrides）
 * @returns {string} 临时目录路径
 */
function createTempProjectDir(fixtureFileName = null) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'orch-test-'));
  if (fixtureFileName) {
    const specifyDir = path.join(tmpDir, '.specify');
    fs.mkdirSync(specifyDir, { recursive: true });
    const src = path.join(FIXTURES_DIR, fixtureFileName);
    const dst = path.join(specifyDir, 'orchestration-overrides.yaml');
    fs.copyFileSync(src, dst);
  }
  return tmpDir;
}

/**
 * 清理临时目录
 * @param {string} tmpDir
 */
function cleanupTempDir(tmpDir) {
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // 忽略清理失败
  }
}

const silentLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

// ═════════════════════════════════════════════════════════════
// T1 — 合并测试组（≥6 用例）
// ═════════════════════════════════════════════════════════════

describe('T1 合并测试', () => {
  it('T1-1: 仅 base（无 overrides）→ fieldSources 全部标记为 base，isFallback=false', async () => {
    const tmpDir = createTempProjectDir(null);
    try {
      const result = await resolveOrchestrationConfig({ projectRoot: tmpDir });
      assert.equal(result.isFallback, false, 'isFallback 应为 false');
      assert.equal(result.diagnostics.length, 0, '无 overrides 时不应有 diagnostic');
      // 所有 fieldSources 值都应为 'base'
      const sources = Object.values(result.fieldSources);
      assert.ok(sources.length > 0, 'fieldSources 不应为空');
      assert.ok(
        sources.every(s => s === 'base'),
        `所有 fieldSources 应为 'base'，实际: ${JSON.stringify(result.fieldSources)}`,
      );
    } finally {
      cleanupTempDir(tmpDir);
    }
  });

  it('T1-2: fix mode 整段替换 → mergedConfig.modes.fix === overrides 定义（2 phases）', async () => {
    const tmpDir = createTempProjectDir('valid-overrides-mode-fix.yaml');
    try {
      const result = await resolveOrchestrationConfig({ projectRoot: tmpDir });
      assert.equal(result.isFallback, false, 'isFallback 应为 false（合法 overrides）');
      const fixPhases = result.mergedConfig.modes?.fix?.phases || [];
      assert.equal(fixPhases.length, 2, `fix mode 应有 2 个 phases（整段替换），实际: ${fixPhases.length}`);
      // 确认整段替换：overrides 中定义了 id=1 和 id=2
      assert.equal(fixPhases[0].id, '1', 'phase[0].id 应为 "1"');
      assert.equal(fixPhases[1].id, '2', 'phase[1].id 应为 "2"');
    } finally {
      cleanupTempDir(tmpDir);
    }
  });

  it('T1-3: 覆盖 GATE_DESIGN.default_behavior → 字段级合并，其余字段保留 base', async () => {
    const tmpDir = createTempProjectDir('valid-overrides-gate.yaml');
    try {
      const result = await resolveOrchestrationConfig({ projectRoot: tmpDir });
      assert.equal(result.isFallback, false, 'isFallback 应为 false');
      // 被 overrides 覆盖的字段
      assert.equal(result.mergedConfig.gates?.GATE_DESIGN?.default_behavior, 'auto', 'GATE_DESIGN.default_behavior 应被覆盖为 auto');
      // 未覆盖的字段应保留 base 值
      assert.equal(result.mergedConfig.gates?.GATE_DESIGN?.severity, 'critical', '未覆盖的 severity 应保留 base 值 critical');
      assert.ok(
        Array.isArray(result.mergedConfig.gates?.GATE_DESIGN?.hard_gate_modes),
        'hard_gate_modes 应仍存在（来自 base）',
      );
    } finally {
      cleanupTempDir(tmpDir);
    }
  });

  it('T1-4: parallel_scheduling 标量覆盖 → max_concurrent_tasks 被更新为 3', async () => {
    const tmpDir = createTempProjectDir('valid-overrides-parallel-scheduling.yaml');
    try {
      const result = await resolveOrchestrationConfig({ projectRoot: tmpDir });
      assert.equal(result.isFallback, false, 'isFallback 应为 false');
      assert.equal(result.mergedConfig.parallel_scheduling?.max_concurrent_tasks, 3, 'max_concurrent_tasks 应被覆盖为 3');
      // 未覆盖的字段应保留 base 值
      assert.equal(result.mergedConfig.parallel_scheduling?.fallback_to_serial_on_failure, true, '未覆盖字段应保留 base 值');
    } finally {
      cleanupTempDir(tmpDir);
    }
  });

  it('T1-5: fieldSources 两级标记正确（Mode 级 + Gate 级）', async () => {
    const tmpDir = createTempProjectDir('valid-overrides-mode-fix.yaml');
    try {
      const result = await resolveOrchestrationConfig({ projectRoot: tmpDir });
      // modes.fix 应被标记为 overrides
      assert.equal(result.fieldSources['modes.fix'], 'overrides', 'modes.fix 应标记为 overrides');
      // modes.feature 应仍标记为 base
      assert.equal(result.fieldSources['modes.feature'], 'base', 'modes.feature 应标记为 base');
      // GATE_DESIGN.default_behavior 应被标记为 overrides
      assert.equal(result.fieldSources['gates.GATE_DESIGN.default_behavior'], 'overrides', 'GATE_DESIGN.default_behavior 应标记为 overrides');
    } finally {
      cleanupTempDir(tmpDir);
    }
  });

  it('T1-6: mergedConfig 通过 orchestrationMergedSchema 校验', async () => {
    const tmpDir = createTempProjectDir('valid-overrides-mode-fix.yaml');
    try {
      const result = await resolveOrchestrationConfig({ projectRoot: tmpDir });
      const parseResult = orchestrationMergedSchema.safeParse(result.mergedConfig);
      assert.equal(
        parseResult.success, true,
        `mergedConfig 应通过 orchestrationMergedSchema 校验，失败原因: ${JSON.stringify(parseResult.error?.issues)}`,
      );
    } finally {
      cleanupTempDir(tmpDir);
    }
  });

  it('T1-Z: _loadOverrides 抛错 → loader-error diagnostic（不复用 parse-error）', async () => {
    const result = await resolveOrchestrationConfig({
      projectRoot: '/nonexistent',
      _loadOverrides: () => { throw new Error('Custom loader failure'); },
    });
    const loaderErrorDiag = result.diagnostics.find(d => d.code === 'orchestration-overrides.loader-error');
    assert.ok(loaderErrorDiag, '应有 loader-error diagnostic，实际 diagnostics: ' + JSON.stringify(result.diagnostics));
    assert.match(loaderErrorDiag.message, /loader 失败/, 'message 应指明 loader 失败');
    assert.doesNotMatch(loaderErrorDiag.message, /YAML 解析失败/, 'message 不应再写 YAML 解析失败');
    // 行为不变：触发降级
    assert.equal(result.isFallback, true);
    // 不再有 parse-error
    const parseErrorDiag = result.diagnostics.find(d => d.code === 'orchestration-overrides.parse-error');
    assert.equal(parseErrorDiag, undefined, '不应再有 parse-error');
  });

  it('T1-Y: _loadOverrides 返非纯对象 → loader-error diagnostic（fix/139）', async () => {
    // 覆盖典型非纯对象类型；含 truthy 但 typeof === 'object' 的 Array/Date/Map/Set
    // 验证守卫 Object.prototype.toString.call() === '[object Object]' 精确排除这些类型
    const cases = [
      { value: null,            typeName: 'null' },
      { value: undefined,       typeName: 'Undefined' },
      { value: 42,              typeName: 'Number' },
      { value: 'string',        typeName: 'String' },
      { value: false,           typeName: 'Boolean' },
      { value: [],              typeName: 'Array' },
      { value: [1, 2, 3],       typeName: 'Array' },
      { value: new Date(),      typeName: 'Date' },
      { value: new Map(),       typeName: 'Map' },
      { value: new Set(),       typeName: 'Set' },
    ];
    for (const { value, typeName } of cases) {
      const result = await resolveOrchestrationConfig({
        projectRoot: '/nonexistent',
        _loadOverrides: () => value,
      });
      const loaderErrorDiag = result.diagnostics.find(d => d.code === 'orchestration-overrides.loader-error');
      assert.ok(loaderErrorDiag,
        `_loadOverrides 返 ${typeName} 应触发 loader-error，实际 diagnostics: ${JSON.stringify(result.diagnostics)}`);
      assert.match(loaderErrorDiag.message, /返回非纯对象/,
        `message 应指明"返回非纯对象"（${typeName}）`);
      assert.match(loaderErrorDiag.message, new RegExp(`（${typeName}）`),
        `message 应含具体类型名 "${typeName}"，实际 message: ${loaderErrorDiag.message}`);
      assert.equal(result.isFallback, true, `非纯对象返回应触发降级（${typeName}）`);
      // 不应误判为 schema-fallback（Codex 角度 3+4 修复点）
      const schemaFallback = result.diagnostics.find(d => d.code === 'orchestration-overrides.schema-fallback');
      assert.equal(schemaFallback, undefined, `${typeName} 不应被误判为 schema-fallback`);
    }
  });

  it('T1-Y-precision: 注入返空对象 {} → 不触发 loader-error，进入正常 schema 校验路径', async () => {
    // 类型守卫精确性回归：`typeof rawOverrides !== 'object'` 不应误判合法的空对象
    // 注：simple-yaml 对 comment-only 和空文件都解析为 {} 而非 null，因此文件路径下
    // 这个边界由 schema-fallback（缺 version）兜底，不会落到 loader-error 分支
    const result = await resolveOrchestrationConfig({
      projectRoot: '/nonexistent',
      _loadOverrides: () => ({}),  // 合法空对象
    });
    const loaderErrorDiag = result.diagnostics.find(d => d.code === 'orchestration-overrides.loader-error');
    assert.equal(loaderErrorDiag, undefined,
      '注入返空对象 {} 不应触发 loader-error（{} 是合法对象，由 schema 校验进一步处理）');
    // {} 缺 version 字段 → schema-fallback 兜底（行为符合 fix(135) 设计）
    const schemaFallback = result.diagnostics.find(d => d.code === 'orchestration-overrides.schema-fallback');
    assert.ok(schemaFallback, '{} 缺 version 应触发 schema-fallback 而非 loader-error');
  });
});

// ═════════════════════════════════════════════════════════════
// T2 — 降级路径测试组（≥5 用例 + anchor 用例 = ≥6 用例）
// ═════════════════════════════════════════════════════════════

describe('T2 降级路径测试', () => {
  it('T2-1: overrides 不存在 → 无 diagnostic，isFallback=false，直接返回 base', async () => {
    const tmpDir = createTempProjectDir(null);
    try {
      const result = await resolveOrchestrationConfig({ projectRoot: tmpDir });
      assert.equal(result.isFallback, false, 'overrides 不存在时 isFallback 应为 false');
      assert.equal(result.diagnostics.length, 0, 'overrides 不存在时 diagnostics 应为空');
      assert.equal(result.isBaseInvalid, false, 'isBaseInvalid 应为 false');
    } finally {
      cleanupTempDir(tmpDir);
    }
  });

  it('T2-2: 不合法 YAML 内容 → isFallback=true（simple-yaml 宽松解析后 schema 校验失败降级）', async () => {
    // 注意：simple-yaml 是宽松解析器，不会对语法错误抛出 parse-error；
    // 不合法内容会被宽松解析后因 Zod schema 校验失败触发 schema-fallback 降级。
    // 真正触发 parse-error 的场景需要 fs.readFileSync 抛错（T2-5 已覆盖）。
    const tmpDir = createTempProjectDir('invalid-yaml-syntax.yaml');
    try {
      const result = await resolveOrchestrationConfig({ projectRoot: tmpDir });
      assert.equal(result.isFallback, true, '不合法 YAML 内容应触发 isFallback=true');
      // 根据 simple-yaml 的宽松解析行为，可能触发 schema-fallback 或 parse-error
      const hasAnyFallbackDiag = result.diagnostics.some(d =>
        d.code === 'orchestration-overrides.parse-error' ||
        d.code === 'orchestration-overrides.schema-fallback',
      );
      assert.ok(hasAnyFallbackDiag, `diagnostics 中应包含 parse-error 或 schema-fallback，实际: ${JSON.stringify(result.diagnostics)}`);
      assert.equal(result.isBaseInvalid, false, 'base config 本身未受影响');
    } finally {
      cleanupTempDir(tmpDir);
    }
  });

  it('T2-3: 非 reserved mode 名 fxi → schema-fallback warning + isFallback=true', async () => {
    const tmpDir = createTempProjectDir('invalid-schema-bad-mode.yaml');
    try {
      const result = await resolveOrchestrationConfig({ projectRoot: tmpDir });
      assert.equal(result.isFallback, true, 'schema 校验失败时 isFallback 应为 true');
      const schemaFallbackDiag = result.diagnostics.find(d => d.code === 'orchestration-overrides.schema-fallback');
      assert.ok(schemaFallbackDiag, 'diagnostics 中应包含 schema-fallback');
      assert.equal(schemaFallbackDiag.level, 'warning', 'schema-fallback 的 level 应为 warning');
    } finally {
      cleanupTempDir(tmpDir);
    }
  });

  it('T2-4: version 不一致 → version-mismatch warning + isFallback=true', async () => {
    const tmpDir = createTempProjectDir('version-mismatch-overrides.yaml');
    try {
      const result = await resolveOrchestrationConfig({ projectRoot: tmpDir });
      assert.equal(result.isFallback, true, 'version 不一致时 isFallback 应为 true');
      const versionDiag = result.diagnostics.find(d => d.code === 'orchestration-overrides.version-mismatch');
      assert.ok(versionDiag, 'diagnostics 中应包含 version-mismatch');
      assert.equal(versionDiag.level, 'warning', 'version-mismatch 的 level 应为 warning');
      // 确认不是 schema-fallback（AC-022 要求专属 code）
      const schemaFallback = result.diagnostics.find(d => d.code === 'orchestration-overrides.schema-fallback');
      assert.equal(schemaFallback, undefined, 'version-mismatch 场景不应触发 schema-fallback');
    } finally {
      cleanupTempDir(tmpDir);
    }
  });

  it('T2-5: _loadBase 注入抛异常 → base-invalid error + isBaseInvalid=true', async () => {
    // 通过 _loadBase 注入抛错函数，模拟 base 不可读场景（D-PLAN-4）
    const failingLoadBase = async () => {
      throw new Error('模拟 base 文件读取失败');
    };
    const result = await resolveOrchestrationConfig({
      projectRoot: '/tmp/any-dir',
      _loadBase: failingLoadBase,
    });
    assert.equal(result.isBaseInvalid, true, 'base 不可读时 isBaseInvalid 应为 true');
    assert.equal(result.isFallback, true, 'base 不可读时 isFallback 应为 true');
    const baseInvalidDiag = result.diagnostics.find(d => d.code === 'orchestration.base-invalid');
    assert.ok(baseInvalidDiag, 'diagnostics 中应包含 base-invalid');
    assert.equal(baseInvalidDiag.level, 'error', 'base-invalid 的 level 应为 error');
  });

  it('T2-6: parallel_groups strip → unsupported-field warning + 其余 gate 字段仍然生效（AC-023）', async () => {
    const tmpDir = createTempProjectDir('overrides-with-parallel-groups.yaml');
    try {
      const result = await resolveOrchestrationConfig({ projectRoot: tmpDir });
      // 有 unsupported-field warning
      const unsupportedDiag = result.diagnostics.find(d => d.code === 'orchestration-overrides.unsupported-field');
      assert.ok(unsupportedDiag, 'diagnostics 中应包含 unsupported-field');
      // 合法 gate 覆盖仍然生效（AC-023）
      assert.equal(result.isFallback, false, '仅 parallel_groups 被 strip，其余合法字段应生效');
      assert.equal(result.mergedConfig.gates?.GATE_DESIGN?.default_behavior, 'auto', 'GATE_DESIGN.default_behavior 应仍被覆盖为 auto');
    } finally {
      cleanupTempDir(tmpDir);
    }
  });

  it('T2-7: YAML anchor & merge key 边界用例 → simple-yaml 静默接受 anchor 但 schema 校验失败 → schema-fallback + 降级到 base', async () => {
    const tmpDir = createTempProjectDir('invalid-anchor.yaml');
    try {
      const result = await resolveOrchestrationConfig({ projectRoot: tmpDir });
      // simple-yaml 不报 parse-error，但 schema 校验失败
      const parseDiag = result.diagnostics.find(d => d.code === 'orchestration-overrides.parse-error');
      const schemaFallbackDiag = result.diagnostics.find(d => d.code === 'orchestration-overrides.schema-fallback');
      // anchor 被 simple-yaml 当普通字符串处理，schema 校验失败
      assert.ok(
        parseDiag || schemaFallbackDiag,
        '含 anchor 的 overrides 应触发 parse-error 或 schema-fallback diagnostic',
      );
      assert.equal(result.isFallback, true, '含 anchor 的 overrides 应降级到 base');
      // 验证返回的是合法 base config（有 8 个 mode）
      const modeCount = Object.keys(result.mergedConfig.modes || {}).length;
      assert.ok(modeCount >= 8, `降级后应有 ≥8 个 mode（base config），实际: ${modeCount}`);
    } finally {
      cleanupTempDir(tmpDir);
    }
  });

  it('T2-X: phase 字段缺失 → schema-fallback message 含 generate-template hint', async () => {
    const overridesYaml = `
version: "1.0"
modes:
  fix:
    phases:
      - id: "1"
        name: diagnose
`;  // 缺 display_name/agent/agent_mode 等必填字段
    const result = await resolveOrchestrationConfig({
      projectRoot: '/nonexistent',
      _loadOverrides: () => parseYamlDocument(overridesYaml),
    });
    const schemaFallback = result.diagnostics.find(d => d.code === 'orchestration-overrides.schema-fallback');
    assert.ok(schemaFallback, '应有 schema-fallback diagnostic');
    assert.match(schemaFallback.message, /hint: 运行 `orchestrator-cli generate-template fix`/,
      'message 末尾应有针对 fix mode 的 hint');
    // fix(139)：单 mode 命中时也输出 "命中 mode: fix" 后缀
    assert.match(schemaFallback.message, /命中 mode: fix/,
      '单 mode 命中时 hint 应含"命中 mode: fix"');
  });

  it('T2-Z: 多 mode 同时缺字段 → hint 枚举所有命中 mode（fix/139）', async () => {
    const overridesYaml = `
version: "1.0"
modes:
  fix:
    phases:
      - id: "1"
        name: diagnose
  story:
    phases:
      - id: "1"
        name: specify
`;  // fix 和 story 都缺 display_name/agent/agent_mode 等必填字段
    const result = await resolveOrchestrationConfig({
      projectRoot: '/nonexistent',
      _loadOverrides: () => parseYamlDocument(overridesYaml),
    });
    const schemaFallback = result.diagnostics.find(d => d.code === 'orchestration-overrides.schema-fallback');
    assert.ok(schemaFallback, '应有 schema-fallback diagnostic');
    // hint 应同时含 fix 和 story（去重 + 排序）
    assert.match(schemaFallback.message, /命中 mode: fix \/ story/,
      'hint 应枚举所有命中的 mode 名（fix / story）');
    // example 应取首个（按字典序 fix 在前）
    assert.match(schemaFallback.message, /generate-template fix/,
      'hint 中的 generate-template 示例应取字典序首个 mode（fix）');
  });

  it('T2-Y: mode 名 typo → schema-fallback message 不附 hint', async () => {
    const overridesYaml = `
version: "1.0"
modes:
  feauture:
    phases: []
`;
    const result = await resolveOrchestrationConfig({
      projectRoot: '/nonexistent',
      _loadOverrides: () => parseYamlDocument(overridesYaml),
    });
    const schemaFallback = result.diagnostics.find(d => d.code === 'orchestration-overrides.schema-fallback');
    assert.ok(schemaFallback, '应有 schema-fallback diagnostic');
    assert.doesNotMatch(schemaFallback.message, /generate-template/,
      'mode typo 错误不应附 generate-template hint');
  });
});

// ═════════════════════════════════════════════════════════════
// T4 — base Zod 兼容性回归测试组（≥3 用例）
// ═════════════════════════════════════════════════════════════

describe('T4 base Zod 兼容性回归测试', () => {
  it('T4-1: 现有 orchestration.yaml 通过 orchestrationBaseSchema.safeParse（8 mode + 6 gate + 3 group）', async () => {
    const result = await resolveOrchestrationConfig({ projectRoot: '/tmp/no-overrides' });
    // 使用 resolver 的 base config（已通过 Zod 校验）
    const mergedConfig = result.mergedConfig;
    const parseResult = orchestrationBaseSchema.safeParse(mergedConfig);
    assert.equal(
      parseResult.success, true,
      `orchestration.yaml 应通过 orchestrationBaseSchema 校验，失败原因: ${JSON.stringify(parseResult.error?.issues?.slice(0, 3))}`,
    );
    // 验证 8 个 mode
    const modes = Object.keys(mergedConfig.modes || {});
    assert.ok(modes.includes('feature'), 'feature mode 应存在');
    assert.ok(modes.includes('story'), 'story mode 应存在');
    assert.ok(modes.includes('implement'), 'implement mode 应存在');
    assert.ok(modes.includes('fix'), 'fix mode 应存在');
    assert.ok(modes.includes('resume'), 'resume mode 应存在');
    assert.ok(modes.includes('sync'), 'sync mode 应存在');
    assert.ok(modes.includes('doc'), 'doc mode 应存在');
    assert.ok(modes.includes('refactor'), 'refactor mode 应存在');
    assert.equal(modes.length, 8, '应有恰好 8 个 mode');
    // 验证 6 个 gate
    const gates = Object.keys(mergedConfig.gates || {});
    assert.equal(gates.length, 6, `应有 6 个 gate，实际: ${gates.join(', ')}`);
    // 验证 3 个 parallel_group
    const groups = Object.keys(mergedConfig.parallel_groups || {});
    assert.equal(groups.length, 3, `应有 3 个 parallel_group，实际: ${groups.join(', ')}`);
  });

  it('T4-2: 无 overrides 时 Orchestrator.getPhases("feature") 返回 ≥10 个 phase（与迁移前行为一致）', async () => {
    // 无 overrides 时，resolver 返回 base config
    const resolverResult = await resolveOrchestrationConfig({ projectRoot: '/tmp/no-overrides' });
    // 通过 preloadedConfig 注入（D-PLAN-6 路径）
    const orch = new Orchestrator({}, 'feature', { logger: silentLogger }, { preloadedConfig: resolverResult.mergedConfig });
    const phases = orch.getPhases();
    assert.ok(phases.length >= 10, `feature 模式应有 ≥10 个 phase，实际: ${phases.length}`);
  });

  it('T4-3: orchestrationBaseSchema 校验失败场景（_loadBase 注入损坏数据）→ base-invalid error', async () => {
    // 注入一个返回损坏数据的 loadBase（modes 缺失）
    const corruptLoadBase = async () => ({
      version: '1.0',
      // 故意缺少 modes 字段
      gates: {},
      parallel_scheduling: { max_concurrent_tasks: 2 },
      parallel_groups: {},
    });
    const result = await resolveOrchestrationConfig({
      projectRoot: '/tmp/any-dir',
      _loadBase: corruptLoadBase,
    });
    assert.equal(result.isBaseInvalid, true, '损坏的 base 应触发 isBaseInvalid=true');
    assert.equal(result.isFallback, true, '损坏的 base 应触发 isFallback=true');
    const baseInvalidDiag = result.diagnostics.find(d => d.code === 'orchestration.base-invalid');
    assert.ok(baseInvalidDiag, 'diagnostics 中应包含 base-invalid');
  });
});

// ═════════════════════════════════════════════════════════════
// T3 — CLI dry-run 输出测试组（≥4 用例）
// ═════════════════════════════════════════════════════════════

describe('T3 CLI dry-run 输出测试', () => {
  /**
   * 运行 CLI 命令并返回 stdout/stderr/exitCode
   * @param {string[]} cliArgs
   * @param {string} [cwd]
   * @returns {{ stdout: string, stderr: string, exitCode: number }}
   */
  function runCli(cliArgs, cwd = process.cwd()) {
    const r = spawnSync('node', [CLI_PATH, ...cliArgs], {
      cwd,
      encoding: 'utf-8',
      timeout: 10000,
    });
    return {
      stdout: r.stdout || '',
      stderr: r.stderr || '',
      exitCode: r.status ?? 1,
    };
  }

  it('T3-1: --format yaml 默认输出（无 fieldSources，纯 config YAML）', () => {
    const r = runCli(['effective-orchestration', 'feature']);
    assert.equal(r.exitCode, 0, `CLI 应以 0 退出，stderr: ${r.stderr}`);
    assert.ok(r.stdout.includes('version:'), 'yaml 输出应包含 version:');
    assert.ok(r.stdout.includes('modes:'), 'yaml 输出应包含 modes:');
    assert.ok(r.stdout.includes('gates:'), 'yaml 输出应包含 gates:');
    // 默认 yaml 不含 fieldSources 键
    assert.ok(!r.stdout.includes('"fieldSources"'), '默认 yaml 输出不应含 fieldSources JSON 键');
  });

  it('T3-2: --format json 输出含 config/fieldSources/diagnostics 结构体', () => {
    const r = runCli(['effective-orchestration', 'feature', '--format', 'json']);
    assert.equal(r.exitCode, 0, `CLI 应以 0 退出，stderr: ${r.stderr}`);
    let parsed;
    try {
      parsed = JSON.parse(r.stdout);
    } catch (e) {
      assert.fail(`--format json 输出应是合法 JSON，解析失败: ${e.message}，输出: ${r.stdout.slice(0, 200)}`);
    }
    assert.ok('config' in parsed, 'json 输出应含 config 键');
    assert.ok('fieldSources' in parsed, 'json 输出应含 fieldSources 键');
    assert.ok('diagnostics' in parsed, 'json 输出应含 diagnostics 键');
    assert.ok(typeof parsed.config === 'object', 'config 应为对象');
    assert.ok(Array.isArray(parsed.diagnostics), 'diagnostics 应为数组');
  });

  it('T3-3: --annotate 输出含 # source: base|overrides 注释', () => {
    // 使用带有 overrides 的临时目录
    const tmpDir = createTempProjectDir('valid-overrides-gate.yaml');
    try {
      const r = runCli(['effective-orchestration', 'feature', '--annotate', '--project-root', tmpDir]);
      assert.equal(r.exitCode, 0, `CLI 应以 0 退出，stderr: ${r.stderr}`);
      assert.ok(r.stdout.includes('# source:'), `--annotate 输出应含 # source: 注释，实际输出: ${r.stdout.slice(0, 300)}`);
      assert.ok(
        r.stdout.includes('# source: base') || r.stdout.includes('# source: overrides'),
        '注释应为 base 或 overrides',
      );
    } finally {
      cleanupTempDir(tmpDir);
    }
  });

  it('T3-4: --diff 仅显示变更字段，modes.feature 不出现（未被覆盖）', () => {
    // 使用覆盖 fix mode 的临时目录
    const tmpDir = createTempProjectDir('valid-overrides-mode-fix.yaml');
    try {
      const r = runCli(['effective-orchestration', 'fix', '--diff', '--project-root', tmpDir]);
      assert.equal(r.exitCode, 0, `CLI 应以 0 退出，stderr: ${r.stderr}`);
      // 输出不是 "no diff" 提示
      assert.ok(!r.stdout.includes('(no diff:'), `--diff 有 overrides 时不应输出 no-diff 提示，实际: ${r.stdout}`);
      // 含 modes.fix（被覆盖）
      assert.ok(r.stdout.includes('modes.fix'), `--diff 应包含 modes.fix 变更，实际: ${r.stdout}`);
      // 不含 modes.feature（未被覆盖）
      assert.ok(!r.stdout.includes('modes.feature'), `--diff 不应包含未变更的 modes.feature，实际: ${r.stdout}`);
    } finally {
      cleanupTempDir(tmpDir);
    }
  });

  it('T3-5: --annotate + --format json → stderr info 提示 + 输出合法 JSON（CL-004 决策）', () => {
    const r = runCli(['effective-orchestration', 'feature', '--annotate', '--format', 'json']);
    assert.equal(r.exitCode, 0, `CLI 应以 0 退出，stderr: ${r.stderr}`);
    // stderr 应有 info 提示
    assert.ok(r.stderr.includes('--annotate'), `stderr 应提示 --annotate 被忽略，实际: ${r.stderr}`);
    // stdout 应仍是合法 JSON
    let parsed;
    try {
      parsed = JSON.parse(r.stdout);
    } catch (e) {
      assert.fail(`--annotate + --format json 时 stdout 仍应是合法 JSON，错误: ${e.message}`);
    }
    assert.ok('config' in parsed, 'json 输出应含 config 键');
  });

  it('T3-6: 不存在的 mode → exitCode===1 且 stderr 含错误信息（FR-011）', () => {
    // 使用不存在的 mode 名验证 CLI 正确报错并以退出码 1 退出
    const r = runCli(['effective-orchestration', 'nonexistent-mode']);
    assert.equal(r.exitCode, 1, `不存在的 mode 应以退出码 1 退出，实际: ${r.exitCode}`);
    // stderr 应包含 mode 不存在的错误信息
    assert.ok(
      r.stderr.includes('nonexistent-mode') || r.stderr.includes('不存在'),
      `stderr 应包含 mode 名称或错误描述，实际: ${r.stderr}`,
    );
    // stderr 应包含合法 mode 列表（spec FR-011 要求）
    assert.ok(
      r.stderr.includes('feature') || r.stderr.includes('合法值'),
      `stderr 应包含合法 mode 列表，实际: ${r.stderr}`,
    );
  });

  it('T3-Y: generate-template fix → 输出含 version/modes.fix/所有 phase 字段', () => {
    const r = runCli(['generate-template', 'fix']);
    assert.equal(r.exitCode, 0, `exit 0，stderr: ${r.stderr}`);
    assert.match(r.stdout, /^# 由 orchestrator-cli generate-template 生成/, '输出应以注释行开头');
    assert.match(r.stdout, /version:/, '应含 version');
    assert.match(r.stdout, /modes:/, '应含 modes');
    assert.match(r.stdout, /\bfix:/, '应含 fix mode');
    // 验证所有 phase 必填字段都被输出
    for (const field of ['id:', 'name:', 'display_name:', 'agent:', 'agent_mode:', 'gates_before:', 'gates_after:', 'conditional:', 'skip_if_exists:', 'is_critical:']) {
      assert.match(r.stdout, new RegExp(field), `输出应含 phase 字段 ${field}`);
    }
  });

  it('T3-Z: generate-template invalidmode → exit 1 + stderr 含合法 mode 列表', () => {
    const r = runCli(['generate-template', 'invalidmode']);
    assert.equal(r.exitCode, 1, '非法 mode 应 exit 1');
    assert.match(r.stderr, /invalidmode.*不存在|"mode "invalidmode" 不存在/, 'stderr 应说明 mode 不存在');
    assert.match(r.stderr, /feature|fix|story/, 'stderr 应含合法 mode 列表');
  });

  it('T3-X: GATE_VERIFY.default_behavior: skip override → 合并成功，无 base-invalid，source=overrides', async () => {
    const overridesYaml = `
version: "1.0"
gates:
  GATE_VERIFY:
    default_behavior: skip
    severity: non_critical
`;
    const result = await resolveOrchestrationConfig({
      projectRoot: '/nonexistent',
      _loadOverrides: () => parseYamlDocument(overridesYaml),
    });
    // 合并应成功（无 base-invalid diagnostic）
    const baseInvalidDiags = result.diagnostics.filter(d => d.code === 'orchestration.base-invalid');
    assert.equal(baseInvalidDiags.length, 0, `不应有 base-invalid diagnostic，实际: ${JSON.stringify(baseInvalidDiags)}`);
    // skip 应正确反映在 mergedConfig 中
    assert.equal(
      result.mergedConfig.gates.GATE_VERIFY.default_behavior,
      'skip',
      `GATE_VERIFY.default_behavior 应为 skip，实际: ${result.mergedConfig.gates.GATE_VERIFY.default_behavior}`,
    );
    // source 应标注为 overrides
    assert.equal(
      result.fieldSources['gates.GATE_VERIFY.default_behavior'],
      'overrides',
      `fieldSources 应标注 source=overrides`,
    );
    // isFallback 应为 false
    assert.equal(result.isFallback, false, '不应降级');
  });

  it('T3-V: generate-template feature → 17 phases 全部输出且无空行错位', () => {
    const r = runCli(['generate-template', 'feature']);
    assert.equal(r.exitCode, 0, `exit 0，stderr: ${r.stderr}`);

    // 计数 phase 元素（每个以 "      - id:" 开头）
    const phaseCount = (r.stdout.match(/^      - id: /gm) || []).length;
    assert.ok(phaseCount >= 15, `feature mode 应输出 >= 15 个 phase，实际 ${phaseCount}`);

    // 验证 phases: 紧跟首个 phase 无多余空行（修复 Fix 2 之后）
    assert.match(r.stdout, /phases:\n      - id: "0"/,
      `phases: 后应直接接首个 phase（无空行），实际输出片段: ${r.stdout.match(/phases:[^]{0,200}/)?.[0]}`);

    // 验证 phase 间确实有空行
    assert.match(r.stdout, /is_critical: (true|false)\n\n      - id:/,
      'phase 之间应有空行分隔');
  });

  it('T3-W: generate-template fix 输出经 effective-orchestration 回读应零 fallback diagnostic（roundtrip）', () => {
    // 1. 跑 generate-template，拿到 stdout
    const gen = runCli(['generate-template', 'fix']);
    assert.equal(gen.exitCode, 0, `generate-template 应 exit 0，stderr: ${gen.stderr}`);

    // 2. 写到 tmp dir 的 .specify/orchestration-overrides.yaml
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-roundtrip-'));
    fs.mkdirSync(path.join(tmpRoot, '.specify'));
    fs.writeFileSync(path.join(tmpRoot, '.specify', 'orchestration-overrides.yaml'), gen.stdout);

    try {
      // 3. 跑 effective-orchestration --format json，解析 diagnostics
      const eff = runCli(['effective-orchestration', 'fix', '--format', 'json', '--project-root', tmpRoot]);
      assert.equal(eff.exitCode, 0, `effective-orchestration 应 exit 0，stderr: ${eff.stderr}`);
      const result = JSON.parse(eff.stdout);
      const fallbackDiags = (result.diagnostics || []).filter((d) =>
        d.level === 'warning' || d.level === 'error',
      );
      assert.equal(fallbackDiags.length, 0,
        `roundtrip 不应触发任何 warning/error diagnostic，实际: ${JSON.stringify(fallbackDiags)}`,
      );
    } finally {
      // 清理 tmp dir
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
