/**
 * sync-merge-engine-m11c.test.mjs — M11 簇④ 引擎四项小补：
 *   9  fix-report 消费通道：只有 fix-report.md（或 spec.md 仍是模板占位）的目录进时间线（FIX）与 fixReports，不再被判悬空 / 零 FR
 *   10 派发前机械对拍：--preflight 输出 mapping 条目数 / 扫描数 / 未映射数，不写任何文件
 *   11 fr-count 绝对下界：抽取条数 ≥ 需求节里独立行扫描到的编号数（fr-floor）；--lint 把四类写法告警变成 exit 1
 *   13 mapping 写回改 in-place 补丁：产品名修正只改 key 行，注释 / name / owner / 行内注释全保留
 *
 * 运行方式: node --test plugins/spec-driver/tests/sync-merge-engine-m11c.test.mjs
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { syncMergeEngine, parseFixReportContent } from '../scripts/sync-merge-engine.mjs';
import { validateMergeResult } from '../scripts/lib/sync-validator.mjs';
import { patchProductMappingText, detectUnmappedSpecs } from '../scripts/lib/sync-product-mapping.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = path.join(__dirname, '..', 'scripts', 'sync-merge-engine.mjs');

const SPEC_OK = '# 001 Core\n\n## 功能需求\n\n- **FR-001**: 一\n- **FR-002**: 二\n';
const FIX_REPORT = `# F102 问题修复报告 — 导出路径含空格时崩溃

## 问题描述

导出路径含空格时 CLI 抛 ENOENT。

第二段补充。

## 5-Why 根因追溯

| 层级 | 问题 | 发现 |
|---|---|---|
| Why 1 | 为何 | 因为 |

**Root Cause**：路径未 quote。

## 修复策略

改用 execFile 传数组参数。

## Spec 影响

FR-007 的核验方式补一条含空格路径的用例；行为变化：导出不再要求路径无空格。
`;
const PLACEHOLDER_SPEC = '# Feature Specification: [FEATURE NAME]\n\n**Feature Branch**: `[###-feature-name]`\n\n## User Scenarios & Testing *(mandatory)*\n';

function makeProject({ mapping, dirs }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-m11c-'));
  fs.mkdirSync(path.join(root, 'specs', 'products'), { recursive: true });
  if (mapping !== undefined) fs.writeFileSync(path.join(root, 'specs', 'products', 'product-mapping.yaml'), mapping);
  for (const [dirName, files] of Object.entries(dirs)) {
    fs.mkdirSync(path.join(root, 'specs', dirName), { recursive: true });
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(root, 'specs', dirName, name), content);
  }
  return root;
}

const MAPPING = 'products:\n  demo:\n    description: "demo"\n    specs:\n      - "001"\n      - "102"\n      - "103"\n';

test('第 9 项 · fix-report 通道：只有 fix-report.md 的目录进时间线（FIX）与 fixReports，不报悬空 / 零 FR，守恒与覆盖校验仍通过', () => {
  const root = makeProject({ mapping: MAPPING, dirs: {
    '001-core': { 'spec.md': SPEC_OK },
    '102-fix-export-path': { 'fix-report.md': FIX_REPORT },
    '103-fix-placeholder': { 'spec.md': PLACEHOLDER_SPEC, 'fix-report.md': FIX_REPORT.replace('F102', 'F103') },
  } });
  const r = syncMergeEngine({ projectRoot: root, dryRun: true });
  const demo = r.products.demo;
  assert.deepEqual(demo.timeline.entries.map((e) => [e.specId, e.type, e.artifact]), [['001', 'INITIAL', 'spec'], ['102', 'FIX', 'fix-report'], ['103', 'FIX', 'fix-report']]);
  assert.equal(demo.fixReports.length, 2);
  assert.match(demo.fixReports[0].title, /导出路径含空格时崩溃/);
  assert.match(demo.fixReports[0].problem, /ENOENT/);
  assert.match(demo.fixReports[0].strategy, /execFile/);
  assert.match(demo.fixReports[0].specImpact, /FR-007/);
  assert.match(demo.fixReports[0].rootCause, /未 quote/);
  assert.equal(r.warnings.filter((w) => /102|103/.test(w)).length, 0, JSON.stringify(r.warnings));
  assert.equal(demo.validation.passed, true, JSON.stringify(demo.validation));
  assert.equal(demo.mergeSkeleton.mergeStats.activeFRCount, 2);
  assert.ok(demo.mergeSkeleton.chapters['12'].sourceSpecs.includes('102'));
  assert.equal(r.stats.totalFixReports, 2);
});

test('第 9 项 · 未映射的 fix-report 目录进 unmappedSpecs 并带 artifact 标记（供 sync 子代理归属）', () => {
  const root = makeProject({ mapping: 'products:\n  demo:\n    description: "demo"\n    specs:\n      - "001"\n', dirs: {
    '001-core': { 'spec.md': SPEC_OK },
    '102-fix-export-path': { 'fix-report.md': FIX_REPORT },
  } });
  const r = syncMergeEngine({ projectRoot: root, dryRun: true });
  assert.deepEqual(r.unmappedSpecs.map((s) => [s.specId, s.artifact]), [['102', 'fix-report']]);
  assert.deepEqual(detectUnmappedSpecs({ products: {} }, [{ id: '9', dirName: '9-x', title: 't', summary: null, artifact: 'fix-report' }])[0].artifact, 'fix-report');
});

test('第 9 项 · parseFixReportContent 缺节时字段为 null，不抛错', () => {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'fr-')), 'fix-report.md');
  fs.writeFileSync(p, '# 只有标题\n\n## 问题描述\n\n只有问题。\n');
  const parsed = parseFixReportContent(p);
  assert.equal(parsed.title, '只有标题');
  assert.match(parsed.fixReport.problem, /只有问题/);
  assert.equal(parsed.fixReport.strategy, null);
  assert.equal(parsed.fixReport.specImpact, null);
  assert.deepEqual(parsed.requirements, []);
});

test('第 10 项 · --preflight：输出 mapping 条目数 / 扫描数 / 未映射数 / 缺目录，不写任何文件', () => {
  const root = makeProject({ mapping: 'products:\n  demo:\n    description: "demo"\n    specs:\n      - "001"\n      - "102"\n      - "024"\n      - "555"\n', dirs: {
    '001-core': { 'spec.md': SPEC_OK },
    '102-fix-export-path': { 'fix-report.md': FIX_REPORT },
    '024-blueprint-only': { 'blueprint.md': '# bp' },
    '200-orphan': { 'spec.md': SPEC_OK.replace('001', '200') },
    '201-placeholder-only': { 'spec.md': PLACEHOLDER_SPEC },
  } });
  const before = fs.readdirSync(path.join(root, 'specs', 'products'));
  const r = syncMergeEngine({ projectRoot: root, preflight: true });
  assert.equal(r.preflight, true);
  assert.deepEqual(r.scanned, { specCount: 2, fixReportCount: 1, placeholderOnlyCount: 1, total: 3, placeholderOnly: ['201-placeholder-only'], duplicateIds: [], shadowedFixReports: [] });
  // demo 映射了 001 / 102 / 024 / 555：001 是 spec、102 是 fix-report、024 只有 blueprint（有意登记，不算缺）、555 无目录；200 未映射不计入本产品
  assert.deepEqual(r.products.demo, { mappedCount: 4, entryCount: 2, scannedCount: 1, fixReportCount: 1, duplicateMappedIds: [], blueprintOnly: ['024'], missing: ['555'] });
  assert.deepEqual(r.unmapped, ['200']);
  assert.deepEqual(fs.readdirSync(path.join(root, 'specs', 'products')), before);
  const cli = spawnSync(process.execPath, [ENGINE, '--project-root', root, '--preflight', '--json'], { encoding: 'utf-8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).products.demo.mappedCount, 4);
});

test('第 11 项 · fr-floor：抽取条数 < 需求节独立行扫描到的编号数即失败（守卫取数路径独立于抽取器）', () => {
  const skeleton = { productId: 'demo', chapters: {}, mergeStats: { activeFRCount: 1 } };
  for (let num = 1; num <= 14; num += 1) skeleton.chapters[String(num)] = { functionalRequirements: [], sourceSpecs: [] };
  skeleton.chapters['5'].functionalRequirements.push({ id: 'FR-001', sourceSpec: '001', status: 'active' });
  skeleton.chapters['12'].sourceSpecs.push('001');
  const timeline = { productId: 'demo', entries: [{ specId: '001', type: 'INITIAL', artifact: 'spec' }] };
  const tampered = { '001': { requirements: [{ id: 'FR-001' }], frEntryIdsInRequirements: new Set(['FR-001', 'FR-002']) } };
  const report = validateMergeResult(skeleton, timeline, tampered);
  const floor = report.checks.find((c) => c.name === 'fr-floor');
  assert.ok(floor, JSON.stringify(report.checks.map((c) => c.name)));
  assert.equal(floor.passed, false);
  assert.match(floor.detail, /001/);
  const consistent = validateMergeResult(skeleton, timeline, { '001': { requirements: [{ id: 'FR-001' }], frEntryIdsInRequirements: new Set(['FR-001']) } });
  assert.equal(consistent.checks.find((c) => c.name === 'fr-floor').passed, true);
});

test('第 11 项 · 真实 spec 跑引擎：fr-floor 通过且 data 带 entryIdCount == extractedFRCount', () => {
  const root = makeProject({ mapping: 'products:\n  demo:\n    description: "demo"\n    specs:\n      - "001"\n', dirs: { '001-core': { 'spec.md': SPEC_OK } } });
  const r = syncMergeEngine({ projectRoot: root, dryRun: true });
  const floor = r.products.demo.validation.checks.find((c) => c.name === 'fr-floor');
  assert.equal(floor.passed, true);
  assert.equal(floor.data.entryIdCount, 2);
  assert.equal(floor.data.extractedFRCount, 2);
});

test('第 11 项 · --lint：写法告警（表格行候选未抽取 / 需求节之外的条目）变成结构化 findings 与 exit 1；干净项目 exit 0；lint 不写文件', () => {
  const dirty = makeProject({ mapping: 'products:\n  demo:\n    description: "demo"\n    specs:\n      - "001"\n      - "002"\n', dirs: {
    '001-core': { 'spec.md': '# 001\n\n## 功能需求\n\n| ID | 描述 |\n|---|---|\n| FR-001 | 表格行 |\n' },
    '002-outside': { 'spec.md': '# 002\n\n## 功能需求\n\n- **FR-001**: 一\n\n## Clarifications\n\n- **FR-002**: 写在需求节之外\n' },
  } });
  const r = syncMergeEngine({ projectRoot: dirty, lint: true });
  assert.equal(r.lint.passed, false);
  // 表格行 spec 同时命中「候选未抽取」与「零 FR」（两条告警此前就并存，lint 如实保留两条）
  assert.deepEqual(r.lint.findings.map((f) => [f.specId, f.kind]).sort(), [['001', 'candidate-not-extracted'], ['001', 'zero-fr'], ['002', 'entries-outside-requirements']]);
  const cli = spawnSync(process.execPath, [ENGINE, '--project-root', dirty, '--lint', '--json'], { encoding: 'utf-8' });
  assert.equal(cli.status, 1, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).lint.passed, false);

  const clean = makeProject({ mapping: 'products:\n  demo:\n    description: "demo"\n    specs:\n      - "001"\n', dirs: { '001-core': { 'spec.md': SPEC_OK } } });
  const ok = spawnSync(process.execPath, [ENGINE, '--project-root', clean, '--lint', '--json'], { encoding: 'utf-8' });
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).lint.passed, true);
});

test('第 13 项 · 写回改 in-place 补丁：产品名修正只改 key 行，注释头 / name / owner / 行内注释 / 顶层键全保留', () => {
  const mappingText = [
    '# 头注释',
    '# 未纳入正式映射: 999-foo（原因）',
    'schemaVersion: 1',
    'products:',
    '  spec-driverdriver:',
    '    name: "Spec Driver"',
    '    owner: "team-a"',
    '    description: "d"',
    '    specs:',
    '      - "001" # 行内注释',
    '',
  ].join('\n');
  const root = makeProject({ mapping: mappingText, dirs: { '001-core': { 'spec.md': SPEC_OK } } });
  const r = syncMergeEngine({ projectRoot: root });
  assert.ok(r.products['spec-driver'], Object.keys(r.products).join(','));
  const after = fs.readFileSync(path.join(root, 'specs', 'products', 'product-mapping.yaml'), 'utf-8');
  assert.equal(after, mappingText.replace('  spec-driverdriver:', '  spec-driver:'));
});

test('第 13 项 · patchProductMappingText：目标 key 已存在（需要合并条目）时不做 in-place，返回 applied:false 交引擎整体序列化并告警', () => {
  const text = 'products:\n  spec-driverdriver:\n    specs:\n      - "001"\n  spec-driver:\n    specs:\n      - "002"\n';
  const r = patchProductMappingText(text, [{ from: 'spec-driverdriver', to: 'spec-driver' }]);
  assert.equal(r.applied, false);
  assert.match(r.reason, /spec-driver/);
  const ok = patchProductMappingText('products:\n  spec-driverdriver:\n    specs: []\n', [{ from: 'spec-driverdriver', to: 'spec-driver' }]);
  assert.equal(ok.applied, true);
  assert.equal(ok.text, 'products:\n  spec-driver:\n    specs: []\n');
  const root = makeProject({ mapping: text, dirs: { '001-core': { 'spec.md': SPEC_OK }, '002-two': { 'spec.md': SPEC_OK.replace('001', '002') } } });
  const engine = syncMergeEngine({ projectRoot: root });
  assert.ok(engine.warnings.some((w) => /整体序列化/.test(w)), JSON.stringify(engine.warnings));
  assert.match(fs.readFileSync(path.join(root, 'specs', 'products', 'product-mapping.yaml'), 'utf-8'), /spec-driver:\n/);
});

// ════════════════════════════════════════
// M11 卡 C · 两轮异构对抗审查后的回归钉（C-1 / C-2 / C-3 / W-1 / W-3 / W-4 / W-5 / W-6 + 存活变异体 M5 / M11 / M13 / M15 / M16 / M17 / M19）
// ════════════════════════════════════════
import { indexSpecDirectories, resolveSpecDirName } from '../scripts/lib/spec-directory-index.mjs';
import { scanRequirementEntryIds } from '../scripts/lib/sync-fr-floor.mjs';

const MAPPING_DEMO = 'products:\n  demo:\n    description: "demo"\n    specs:\n      - "001"\n      - "133"\n';

test('C-1 · 同编号既有实质 spec.md 目录又有 fix-report 目录：fix-report 通道跳过、FR 不双计、零冲突，warning + lint finding 指名（字典序两个方向都成立）', () => {
  for (const [specDir, fixDir] of [['133-orchestration-overrides', '133-fix-postmortem'], ['133-a-real-spec', '133-b-fix']]) {
    const root = makeProject({ mapping: MAPPING_DEMO, dirs: {
      '001-core': { 'spec.md': SPEC_OK },
      [specDir]: { 'spec.md': '# 133 Real\n\n## 功能需求\n\n- **FR-001**: 甲\n- **FR-002**: 乙\n' },
      [fixDir]: { 'fix-report.md': FIX_REPORT },
    } });
    const r = syncMergeEngine({ projectRoot: root, dryRun: true, lint: true });
    const demo = r.products.demo;
    assert.equal(demo.mergeSkeleton.mergeStats.activeFRCount, 4, `${specDir}+${fixDir}: 2 + 2 条，不得双计`);
    assert.equal(demo.mergeSkeleton.chapters['5'].functionalRequirements.filter((fr) => fr.sourceSpec === '133').length, 2);
    assert.equal(r.stats.totalConflicts, 0, '同编号 fix-report 不得制造 superseded 冲突');
    assert.equal(demo.timeline.entries.filter((e) => e.specId === '133').length, 1, '133 只有一条时间线条目');
    assert.deepEqual(demo.fixReports, [], '被跳过的 fix-report 不进 fixReports');
    assert.equal(r.stats.shadowedFixReports, 1);
    assert.ok(r.warnings.some((w) => w.includes(`fix-report 目录 ${fixDir} 与实质 spec.md 目录 ${specDir} 同编号`)), JSON.stringify(r.warnings));
    assert.ok(r.lint.findings.some((f) => f.specId === '133' && f.kind === 'duplicate-dirs' && f.productId === null), JSON.stringify(r.lint.findings));
    assert.equal(demo.validation.checks.find((c) => c.name === 'fr-floor').passed, true);
  }
});

test('W-5 · 同编号两个实质 spec.md 目录升为 lint finding（exit 1）；两个 fix-report 目录只 warning 不进 findings', () => {
  const dup = makeProject({ mapping: MAPPING_DEMO, dirs: {
    '001-core': { 'spec.md': SPEC_OK },
    '133-a': { 'spec.md': '# A\n\n## 功能需求\n\n- **FR-001**: 甲\n' },
    '133-b': { 'spec.md': '# B\n\n## 功能需求\n\n- **FR-001**: 乙\n' },
  } });
  const r = syncMergeEngine({ projectRoot: dup, lint: true });
  assert.ok(r.lint.findings.some((f) => f.kind === 'duplicate-dirs' && f.specId === '133'));
  assert.equal(spawnSync(process.execPath, [ENGINE, '--project-root', dup, '--lint'], { encoding: 'utf-8' }).status, 1, 'M13：非 json 路径也要 exit 1');
  const fixes = makeProject({ mapping: MAPPING_DEMO, dirs: {
    '001-core': { 'spec.md': SPEC_OK },
    '133-fix-a': { 'fix-report.md': FIX_REPORT },
    '133-fix-b': { 'fix-report.md': FIX_REPORT },
  } });
  const r2 = syncMergeEngine({ projectRoot: fixes, lint: true });
  assert.ok(r2.warnings.some((w) => w.includes('编号 133 有 2 个 fix-report 目录')));
  assert.equal(r2.lint.findings.filter((f) => f.kind === 'duplicate-dirs').length, 0);
  assert.equal(r2.products.demo.timeline.entries.filter((e) => e.specId === '133').length, 2);
});

test('W-1 · --preflight 的分母与 Phase 5 同源：同编号多条目、mapping 重复编号、fix-report 通道都按实际条目计', () => {
  const root = makeProject({ mapping: 'products:\n  demo:\n    description: "demo"\n    specs:\n      - "001"\n      - "001"\n      - "112"\n', dirs: {
    '001-core': { 'spec.md': SPEC_OK },
    '112-fix-a': { 'fix-report.md': FIX_REPORT },
    '112-fix-b': { 'fix-report.md': FIX_REPORT },
  } });
  const pre = syncMergeEngine({ projectRoot: root, preflight: true });
  const full = syncMergeEngine({ projectRoot: root, dryRun: true });
  assert.equal(pre.products.demo.entryCount, full.products.demo.timeline.entries.length, 'preflight entryCount == Phase 5 时间线条目数');
  assert.deepEqual([pre.products.demo.mappedCount, pre.products.demo.scannedCount, pre.products.demo.fixReportCount], [2, 1, 2]);
  assert.deepEqual(pre.products.demo.duplicateMappedIds, ['001']);
  assert.deepEqual(pre.scanned.duplicateIds, ['112']);
  assert.equal(pre.scanned.total, full.stats.totalSpecs + full.stats.totalFixReportDirs);
});

test('W-3 / M5 · 占位判据三个字面量各自独立触发：只改 H1 的半填模板、只剩分支占位、只剩样板 FR 正文都判占位', () => {
  const variants = {
    '201-h1-changed': PLACEHOLDER_SPEC.replace('[FEATURE NAME]', '真标题'),
    '202-branch-only': '# 真标题\n\n**Feature Branch**: `[###-feature-name]`\n\n## 功能需求\n\n- **FR-001**: 真需求\n',
    '203-sample-fr': '# 真标题\n\n## 功能需求\n\n- **FR-001**: System MUST [specific capability, e.g., "allow users to create accounts"]\n',
  };
  const root = makeProject({ mapping: 'products:\n  demo:\n    description: "demo"\n    specs:\n      - "201"\n      - "202"\n      - "203"\n', dirs: Object.fromEntries(Object.entries(variants).map(([dir, spec]) => [dir, { 'spec.md': spec, 'fix-report.md': FIX_REPORT }])) });
  const r = syncMergeEngine({ projectRoot: root, dryRun: true });
  assert.equal(r.products.demo.fixReports.length, 3, '三种占位形态都走 fix-report 通道');
  assert.equal(r.products.demo.mergeSkeleton.mergeStats.activeFRCount, 0, '样板 FR 不进活文档');
});

test('W-4 / M19 · 占位且无 fix-report 的目录：dry-run stats 指名目录，映射悬空文案说明是占位', () => {
  const root = makeProject({ mapping: 'products:\n  demo:\n    description: "demo"\n    specs:\n      - "001"\n      - "201"\n', dirs: {
    '001-core': { 'spec.md': SPEC_OK },
    '201-placeholder-only': { 'spec.md': PLACEHOLDER_SPEC },
  } });
  const r = syncMergeEngine({ projectRoot: root, dryRun: true });
  assert.equal(r.stats.placeholderOnlySpecs, 1);
  assert.deepEqual(r.stats.placeholderOnlyDirs, ['201-placeholder-only']);
  assert.equal(r.stats.totalSpecs, 1, 'W-6：totalSpecs 保持「有实质 spec.md 的目录数」');
  assert.ok(r.warnings.some((w) => w.includes('201-placeholder-only 的 spec.md 仍是模板占位且无 fix-report.md')), JSON.stringify(r.warnings));
});

test('C-2 · fr-floor 独立扫描器：与抽取器约定相同的三种条目形态各自计数；围栏 / 区间标签 / 缩进续行 / 表格行 / 反引号不算', () => {
  const doc = [
    '- **FR-001**: 列表位', '* FR-002 星号列表', '1. **FR-003** 有序列表', '### FR-004 标题位', '**FR-005**：行首粗体段落',
    '  FR-006 缩进的裸编号是续行', '#### FR-007 ~ FR-009: 区间标签', '| FR-010 | 表格行 |', '`FR-011` 反引号',
    '```', '- **FR-012**: 围栏里的示例', '```', '- **FR-001**: 重复编号只算一次',
  ].join('\n');
  assert.deepEqual([...scanRequirementEntryIds(doc)].sort(), ['FR-001', 'FR-002', 'FR-003', 'FR-004', 'FR-005']);
  // 与真实抽取器在这些形态上一致（同一份约定、两套实现）
  const root = makeProject({ mapping: 'products:\n  demo:\n    description: "demo"\n    specs:\n      - "001"\n', dirs: { '001-core': { 'spec.md': `# 001\n\n## 功能需求\n\n${doc}\n` } } });
  const r = syncMergeEngine({ projectRoot: root, dryRun: true });
  const floor = r.products.demo.validation.checks.find((c) => c.name === 'fr-floor');
  assert.deepEqual([floor.passed, floor.data.entryIdCount, floor.data.extractedFRCount], [true, 5, 5]);
});

test('C-3 / M11 · patchProductMappingText：目标 key 以标量 / 空容器形态存在也算已存在（退化整体序列化）；from 行出现两次不定位', () => {
  for (const existing of ['  spec-driver: ~\n', '  spec-driver: {}\n', '  spec-driver: ""\n']) {
    const text = `products:\n  spec-driverdriver:\n    description: "老名字"\n    specs:\n      - "001"\n${existing}`;
    const r = patchProductMappingText(text, [{ from: 'spec-driverdriver', to: 'spec-driver' }]);
    assert.equal(r.applied, false, existing);
    assert.match(r.reason, /同时存在/);
  }
  const twice = 'products:\n  old-name:\n    specs:\n      - "001"\nother:\n  old-name:\n    specs: []\n';
  const r2 = patchProductMappingText(twice, [{ from: 'old-name', to: 'new-name' }]);
  assert.equal(r2.applied, false);
  assert.match(r2.reason, /出现 2 次/);
});

test('M15 · --lint / --preflight 隐含 dry-run：mapping 产品名需要修正时文件仍逐字节不变', () => {
  const mapping = '# 注释头\nproducts:\n  spec-driverdriver:\n    description: "老名字"\n    specs:\n      - "001"\n';
  const root = makeProject({ mapping, dirs: { '001-core': { 'spec.md': SPEC_OK } } });
  const mappingPath = path.join(root, 'specs', 'products', 'product-mapping.yaml');
  for (const flag of ['--lint', '--preflight']) {
    spawnSync(process.execPath, [ENGINE, '--project-root', root, flag, '--json'], { encoding: 'utf-8' });
    assert.equal(fs.readFileSync(mappingPath, 'utf-8'), mapping, `${flag} 不得写回 mapping`);
  }
  const written = syncMergeEngine({ projectRoot: root, dryRun: false });
  assert.ok(written.warnings.length >= 0);
  assert.notEqual(fs.readFileSync(mappingPath, 'utf-8'), mapping, '对照：常规写回会修正产品名');
});

test('M16 / M17 · 同编号多目录的 tie-break 钉死为字典序首个（indexSpecDirectories / resolveSpecDirName）', () => {
  const root = makeProject({ mapping: undefined, dirs: { '112-zeta': { 'spec.md': SPEC_OK }, '112-alpha': { 'spec.md': SPEC_OK }, '113-only': { 'spec.md': SPEC_OK } } });
  const specsDir = path.join(root, 'specs');
  const index = indexSpecDirectories(specsDir);
  assert.deepEqual(index.get('112'), ['112-alpha', '112-zeta']);
  assert.equal(resolveSpecDirName(specsDir, '112', index).dirName, '112-alpha');
  assert.equal(resolveSpecDirName(specsDir, '112-zeta', index).dirName, '112-zeta', '完整目录名在场时按名取');
  assert.equal(resolveSpecDirName(specsDir, '999', index).dirName, null);
});

test('I-3 · fix-report 字段截断带标记', () => {
  const long = `# F999 报告\n## 问题描述\n${'甲'.repeat(1600)}\n## 修复策略\n短\n`;
  const root = makeProject({ mapping: undefined, dirs: { '999-fix-long': { 'fix-report.md': long } } });
  const parsed = parseFixReportContent(path.join(root, 'specs', '999-fix-long', 'fix-report.md'));
  assert.match(parsed.fixReport.problem, /…\[截断，原文 1600 字符\]$/);
  assert.equal(parsed.fixReport.strategy, '短');
});
