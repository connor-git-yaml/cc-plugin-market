// sync-merge-engine：FR 身份键 = (sourceSpec, id)、真实写法全形态抽取、中文标题路由、
// 候选未抽取 warning、写回保留注释头。红先行依据：2026-09-14 对抗审查 C-1/C-2/W-1~W-5；
// 第二轮 delta 审查 C-1（多标题覆盖）/ C-2（同 spec 重复编号静默处置）/ C-3（大写后缀）/ W-1/W-2/W-4/W-5。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncMergeEngine, parseSpecContent } from '../scripts/sync-merge-engine.mjs';
import { extractSpecId } from '../scripts/lib/sync-product-mapping.mjs';
import { validateMergeResult } from '../scripts/lib/sync-validator.mjs';
import { executeMerge } from '../scripts/lib/sync-merge-strategy.mjs';
import { resolveConflicts } from '../scripts/lib/sync-conflict-resolver.mjs';

function makeProject(specs, mappingText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-id-'));
  for (const { dir, body } of specs) {
    const specDir = path.join(root, 'specs', dir);
    fs.mkdirSync(specDir, { recursive: true });
    fs.writeFileSync(path.join(specDir, 'spec.md'), body);
  }
  fs.mkdirSync(path.join(root, 'specs', 'products'), { recursive: true });
  fs.writeFileSync(path.join(root, 'specs', 'products', 'product-mapping.yaml'), mappingText);
  return root;
}
const mapping = (ids, product = 'spectra') =>
  ['products:', `  ${product}:`, '    description: "x"', '    specs:', ...ids.map((i) => `      - "${i}"`), ''].join('\n');
const specDoc = (frBlock, { reqHeading = '## Requirements *(mandatory)*', usHeading = '## User Scenarios & Testing *(mandatory)*' } = {}) =>
  ['# Feature Specification: Sample', '', usHeading, '', '### User Story 1 - 示例 (Priority: P1)', '', '用户做一件事。', '',
   reqHeading, '', '### Functional Requirements', '', frBlock, '', '## Success Criteria *(mandatory)*', '', '- **SC-001**: 指标', ''].join('\n');
const run = (root) => {
  const r = syncMergeEngine({ projectRoot: root, dryRun: true });
  assert.equal(r.error, undefined, `引擎报错: ${r.error}`);
  return r;
};
const frsOf = (r, product = 'spectra') => r.products[product].mergeSkeleton.chapters['5'].functionalRequirements;

test('全仓真实写法（2026-09-14 统计的 9 种形态 + 无冒号 + 粗体短标题 + 有序列表）逐条抽取，描述完整', () => {
  const block = [
    '- **FR-001**: A 形态 加粗冒号',
    '- **FR-002** `[必须]`：C 形态 反引号注解 全角冒号',
    '- **FR-003**（MUST · [必须]）：D 形态 括号注解',
    '- **FR-004（决策纯函数）** `[必须]`：E 形态 括号在粗体内',
    '- **FR-005** [必须]: F 形态 方括号注解',
    '- **FR-006 [MUST]**: G 形态 方括号在粗体内',
    '- **FR-007a**: I 形态 字母后缀',
    '- FR-008（说明）: K 形态 裸 ID 带括号',
    '- **FR-009-x**: Z 形态 短横后缀',
    '- **FR-010** 无冒号形态 直接接正文 MUST 做事',
    '- **FR-011 两级互斥**：粗体短标题形态 正文',
    '1. **FR-012**: 有序列表形态',
  ].join('\n');
  const r = run(makeProject([{ dir: '001-sample', body: specDoc(block) }], mapping(['001'])));
  const frs = frsOf(r);
  const byId = Object.fromEntries(frs.map((f) => [f.id, f.description]));
  assert.equal(frs.length, 12, `抽出 ${frs.length}: ${frs.map((f) => f.id).join(',')}`);
  assert.equal(byId['FR-001'], 'A 形态 加粗冒号');
  assert.equal(byId['FR-002'], 'C 形态 反引号注解 全角冒号');
  assert.equal(byId['FR-003'], 'D 形态 括号注解');
  assert.equal(byId['FR-004'], '（决策纯函数） E 形态 括号在粗体内'); // 实质性括号短标题保留为前缀
  assert.equal(byId['FR-005'], 'F 形态 方括号注解');
  assert.equal(byId['FR-006'], 'G 形态 方括号在粗体内');
  assert.equal(byId['FR-007a'], 'I 形态 字母后缀');
  assert.equal(byId['FR-008'], '（说明） K 形态 裸 ID 带括号');
  assert.equal(byId['FR-009-x'], 'Z 形态 短横后缀');
  assert.equal(byId['FR-010'], '无冒号形态 直接接正文 MUST 做事');
  assert.equal(byId['FR-011'], '两级互斥：粗体短标题形态 正文');
  assert.equal(byId['FR-012'], '有序列表形态');
  assert.equal(r.warnings.filter((w) => w.includes('候选')).length, 0, '全部识别时不得有候选 warning');
});

test('多行描述保持完整；行中出现的 **FR-** 引用不切分；level 取自注解或正文', () => {
  const block = ['- **FR-001** `[必须]`：第一行', '  续行提到 **FR-003** 但不在行首 bullet 位置', '  第三行', '- **FR-002**: 系统 SHOULD 做 B'].join('\n');
  const frs = frsOf(run(makeProject([{ dir: '001-s', body: specDoc(block) }], mapping(['001']))));
  assert.equal(frs.length, 2);
  assert.equal(frs[0].description, '第一行\n  续行提到 **FR-003** 但不在行首 bullet 位置\n  第三行');
  assert.equal(frs[1].description, '系统 SHOULD 做 B');
  // level 只在解析层存在（骨架不携带）：注解无英文强度词 → null；正文含 SHOULD → SHOULD
  const root = makeProject([{ dir: '001-s', body: specDoc(block) }], mapping(['001']));
  const parsed = parseSpecContent(path.join(root, 'specs', '001-s', 'spec.md'));
  assert.deepEqual(parsed.requirements.map((f) => [f.id, f.level]), [['FR-001', null], ['FR-002', 'SHOULD']]);
});

test('身份键 = (sourceSpec, id)：INITIAL/FEATURE/FIX/REFACTOR/ENHANCEMENT 五份 spec 的 FR-001 全部保留、互不覆盖、零 superseded、零冲突', () => {
  const specs = [
    { dir: '001-core', body: specDoc('- **FR-001**: 一号 INITIAL 的需求') },
    { dir: '002-add-feature', body: specDoc('- **FR-001**: 二号 FEATURE 的需求') },
    { dir: '003-fix-something', body: specDoc('- **FR-001**: 三号 FIX 的需求') },
    { dir: '004-refactor-thing', body: specDoc('- **FR-001**: 四号 REFACTOR 的需求') },
    { dir: '005-enhance-x', body: specDoc('- **FR-001**: 五号 ENHANCEMENT 的需求') },
  ];
  const r = run(makeProject(specs, mapping(['001', '002', '003', '004', '005'])));
  const types = r.products.spectra.timeline.entries.map((e) => e.type);
  assert.deepEqual(types, ['INITIAL', 'FEATURE', 'FIX', 'REFACTOR', 'ENHANCEMENT'], `timeline 类型: ${types}`);
  const frs = frsOf(r);
  assert.equal(frs.length, 5);
  assert.deepEqual(frs.map((f) => f.sourceSpec), ['001', '002', '003', '004', '005']);
  assert.deepEqual(frs.map((f) => f.status), ['active', 'active', 'active', 'active', 'active']);
  assert.deepEqual(frs.map((f) => f.description), ['一号 INITIAL 的需求', '二号 FEATURE 的需求', '三号 FIX 的需求', '四号 REFACTOR 的需求', '五号 ENHANCEMENT 的需求']);
  assert.equal(r.products.spectra.conflicts.length, 0);
  assert.equal(r.products.spectra.mergeSkeleton.mergeStats.supersededFRCount, 0);
  assert.equal(r.validation.allPassed, true);
});

test('同一 spec 内重复编号是同一条需求的再次陈述：按出现顺序并入首条描述、warning 登记、不进冲突账', () => {
  const r = run(makeProject([{ dir: '001-s', body: specDoc('- **FR-001**: 第一次\n- **FR-001**: 第二次（重复编号）') }], mapping(['001'])));
  const frs = frsOf(r).filter((f) => f.id === 'FR-001');
  assert.equal(frs.length, 1);
  assert.equal(frs[0].description, '第一次\n\n第二次（重复编号）');
  assert.equal(frs[0].status, 'active');
  assert.equal(r.products.spectra.conflicts.length, 0);
  assert.match(r.warnings.find((w) => w.includes('spec 001')) ?? '', /1 个 FR 编号重复出现，已按出现顺序并入首条描述（FR-001 ×2）/);
});

test('标题写法（H3/H4）是一等条目：编号取标题起始处，「扩展 F190 FR-014」不成条目；描述 = 标题余文 + 标题下正文；标题中段的编号是引用', () => {
  const body = specDoc(['### FR-016：新解析依赖约束 [必须]（扩展 F190 FR-014）', '正文 A', '', '#### FR-017：产物隔离约束（扩展 F190 FR-013）', '正文 B', '', '### FR-017A [必须] 大写后缀的 H3 条目', '正文 C', '', '### 澄清 2: FR-006 并行调度失败的检测机制', '这是引用，不是条目', '', '- **FR-018**: 同节内混写的列表条目'].join('\n'));
  const frs = frsOf(run(makeProject([{ dir: '001-s', body }], mapping(['001']))));
  assert.deepEqual(frs.map((f) => f.id), ['FR-016', 'FR-017', 'FR-017A', 'FR-018']);
  // 标题中段的 `[必须]` 不在行首注解位置，按正文保留
  assert.equal(frs[0].description, '新解析依赖约束 [必须]（扩展 F190 FR-014）\n正文 A');
  assert.equal(frs[2].description, '大写后缀的 H3 条目\n正文 C');
});

test('中文模板标题（## 需求 / ## 用户场景与测试）也路由：INITIAL 下界不再恒为 0', () => {
  const body = specDoc('- **FR-001**：中文标题下的需求\n- **FR-002**：第二条', { reqHeading: '## 需求 *（必填）*', usHeading: '## 用户场景与测试 *（必填）*' });
  const r = run(makeProject([{ dir: '001-s', body }], mapping(['001'])));
  assert.equal(frsOf(r).length, 2);
  assert.equal(r.products.spectra.mergeSkeleton.chapters['3'].userStories.length, 1);
  const frCount = r.validation.reports[0].checks.find((c) => c.name === 'fr-count');
  assert.deepEqual([frCount.data.extractedFRCount, frCount.data.skeletonFRCount, frCount.passed], [2, 2, true]);
});

test('陌生写法（表格行）不静默消失：候选 > 抽取 时 warnings 指名 spec 与条数', () => {
  const body = specDoc(['| ID | 描述 |', '|---|---|', '| FR-001 | 表格形态一 |', '| FR-002 | 表格形态二 |'].join('\n'));
  const r = run(makeProject([{ dir: '001-s', body }], mapping(['001'])));
  assert.equal(frsOf(r).length, 0);
  const w = r.warnings.find((x) => x.includes('spec 001') && x.includes('候选'));
  assert.ok(w, `warnings: ${JSON.stringify(r.warnings)}`);
  assert.match(w, /2 个 FR 编号出现在候选行但未抽取（FR-001, FR-002）/);
});

test('写回：语义无变化不写文件；语义有变化时写回但保留原注释头', () => {
  const header = '# 产品→功能 spec 映射\n# 手动添加的条目在重跑 sync 时不会被覆盖\n# 未纳入正式映射: 099-x（占位）\n\n';
  const root = makeProject([{ dir: '001-s', body: specDoc('- **FR-001**: a') }], header + mapping(['001']));
  const p = path.join(root, 'specs', 'products', 'product-mapping.yaml');
  const before = fs.readFileSync(p, 'utf-8');
  syncMergeEngine({ projectRoot: root, dryRun: false });
  assert.equal(fs.readFileSync(p, 'utf-8'), before, '语义无变化时不得改写文件（注释头不得丢）');
  // 触发语义变化：产品名可修正（spec-driverdriver → spec-driver）
  fs.writeFileSync(p, header + mapping(['001'], 'spec-driverdriver'));
  syncMergeEngine({ projectRoot: root, dryRun: false });
  const after = fs.readFileSync(p, 'utf-8');
  assert.ok(after.startsWith(header), `注释头必须保留，实际开头: ${JSON.stringify(after.slice(0, 60))}`);
  assert.match(after, /^\s+spec-driver:\s*$/m);
  assert.doesNotMatch(after, /spec-driverdriver/);
});

// ── 第二轮 delta 审查（2026-09-14）──

const multiDoc = (...sections) => ['# Feature Specification: Multi', '', '## User Scenarios & Testing', '', '### User Story 1 - 示例 (Priority: P1)', '', '正文', '', ...sections.flatMap((x) => [x, '']), '## Success Criteria', '', '- **SC-001**: 指标', ''].join('\n');

test('C-1 多个需求类 H2：功能需求之后的 `## 非功能需求` / `## 需求模糊点说明` 不再覆盖前面抽出的 FR；两个功能需求节则累加', () => {
  const body = multiDoc(
    '## 功能需求（Functional Requirements）\n\n- **FR-001**: 一\n- **FR-002**: 二\n- **FR-003**: 三',
    '## 非功能需求（Non-Functional Requirements）\n\n- **NFR-001**: 性能\n- **NFR-002**: 兼容',
    '## 需求模糊点说明\n\n- FR-002 的含义待澄清（这是说明，不是条目）',
  );
  const r = run(makeProject([{ dir: '001-s', body }], mapping(['001'])));
  assert.deepEqual(frsOf(r).map((f) => f.id), ['FR-001', 'FR-002', 'FR-003']);
  assert.equal(r.products.spectra.conflicts.length, 0, '模糊点说明里的 FR-002 不得成为重复条目');
  assert.equal(r.warnings.filter((w) => w.includes('候选')).length, 0);

  const two = multiDoc('## 需求 *(mandatory)*\n\n- **FR-001**: 甲\n- **FR-002**: 乙', '## 功能需求\n\n- **FR-003**: 丙');
  const r2 = run(makeProject([{ dir: '001-s', body: two }], mapping(['001'])));
  assert.deepEqual(frsOf(r2).map((f) => f.id), ['FR-001', 'FR-002', 'FR-003']);
});

test('C-1 护栏可见性：功能需求节只有表格行、其后跟 `## 非功能需求` 时，候选计数不再被清零，warning 照常发出', () => {
  const body = multiDoc('## 功能需求\n\n| ID | 描述 |\n|---|---|\n| FR-001 | 表格一 |\n| FR-002 | 表格二 |', '## 非功能需求\n\n- **NFR-001**: 性能');
  const r = run(makeProject([{ dir: '001-s', body }], mapping(['001'])));
  assert.equal(frsOf(r).length, 0);
  const w = r.warnings.find((x) => x.includes('spec 001') && x.includes('候选'));
  assert.ok(w, `warnings: ${JSON.stringify(r.warnings)}`);
  assert.match(w, /2 个 FR 编号出现在候选行但未抽取（FR-001, FR-002）/);
});

test('C-2 缩进的裸编号续行是上一条的正文，不成条目、不进候选；handler 层对同 (spec, id) 一律追加、由冲突解决器首条胜出可见裁决', () => {
  const cont = specDoc(['- **FR-013**: hook 必须捕获全部内部异常', '  FR-013 fail-open 之外的**第三条**非阻断路径，其非豁免性由两道闸门保证'].join('\n'));
  const rc = run(makeProject([{ dir: '001-core', body: specDoc('- **FR-001**: 基线') }, { dir: '003-fix-x', body: cont }], mapping(['001', '003'])));
  const fix = frsOf(rc).filter((f) => f.sourceSpec === '003');
  assert.equal(fix.length, 1);
  assert.equal(fix[0].description, 'hook 必须捕获全部内部异常\n  FR-013 fail-open 之外的**第三条**非阻断路径，其非豁免性由两道闸门保证');
  assert.equal(rc.products.spectra.conflicts.length, 0);
  assert.equal(rc.warnings.filter((w) => w.includes('候选')).length, 0, '缩进续行不得触发候选 warning');

  // 解析层已把同 spec 重复编号并成一条；handler 层若再收到同 (spec, id) 两条（防御面），必须两条都进骨架，
  // 由 resolveConflicts 首条胜出并登记——不得静默跳过 / 覆盖 / 追加描述（第二轮 C-2）
  for (const type of ['FEATURE', 'FIX', 'REFACTOR', 'ENHANCEMENT']) {
    const timeline = { productId: 'spectra', entries: [{ specId: '001', dirName: '001-core', type: 'INITIAL' }, { specId: '009', dirName: '009-x', type }] };
    const parsed = { '001': { requirements: [{ id: 'FR-001', description: '基线' }], userStories: [] }, '009': { requirements: [{ id: 'FR-007', description: '第一次' }, { id: 'FR-007', description: '第二次' }], userStories: [] } };
    const skeleton = executeMerge(timeline, parsed);
    const dup = skeleton.chapters['5'].functionalRequirements.filter((f) => f.sourceSpec === '009' && f.id === 'FR-007');
    assert.equal(dup.length, 2, `${type}: 两条都应进骨架`);
    assert.deepEqual(dup.map((f) => f.description), ['第一次', '第二次'], `${type}: 描述不得被覆盖或追加`);
    const { skeleton: resolved, conflicts } = resolveConflicts(skeleton);
    const after = resolved.chapters['5'].functionalRequirements.filter((f) => f.sourceSpec === '009' && f.id === 'FR-007');
    assert.deepEqual(after.map((f) => f.status), ['active', 'superseded'], `${type}: 首条胜出`);
    assert.equal(conflicts.length, 1, `${type}: 冲突必须登记`);
    assert.equal(conflicts[0].subject, '009::FR-007');
  }
});

test('C-3 大写后缀与行首粗体段落形态：FR-003A 是独立条目、FR-007-A 不截断成 FR-007、`**FR-001**: …` 段落写法可抽取', () => {
  const body = specDoc(['**FR-001**: 段落形态（无 bullet）', '', '- **FR-003**: 三', '- **FR-003A**: 大写字母后缀', '', '**FR-007**: 真七号', '', '**FR-007-A** [必须] 大写短横后缀 MUST 做事'].join('\n'));
  const r = run(makeProject([{ dir: '001-s', body }], mapping(['001'])));
  const frs = frsOf(r);
  assert.deepEqual(frs.map((f) => f.id), ['FR-001', 'FR-003', 'FR-003A', 'FR-007', 'FR-007-A']);
  const byId = Object.fromEntries(frs.map((f) => [f.id, f]));
  assert.equal(byId['FR-003A'].description, '大写字母后缀');
  assert.equal(byId['FR-007-A'].description, '大写短横后缀 MUST 做事');
  assert.equal(byId['FR-007'].description, '真七号');
  const parsed = parseSpecContent(path.join(makeProject([{ dir: '001-s', body }], mapping(['001'])), 'specs', '001-s', 'spec.md'));
  assert.equal(parsed.requirements.find((f) => f.id === 'FR-007-A').level, 'MUST');
  assert.equal(r.products.spectra.conflicts.length, 0);
  assert.equal(r.warnings.filter((w) => w.includes('候选')).length, 0);
});

test('W-2 fenced code 里的示例条目不抽取、不进候选，代码块整体归入上一条描述', () => {
  const body = specDoc(['- **FR-001**: 真需求，示例如下', '', '  ```markdown', '  - **FR-901**: 这是文档里的示例条目', '  - **FR-902**: 第二个示例', '  ```', '', '- **FR-002**: 二'].join('\n'));
  const r = run(makeProject([{ dir: '001-s', body }], mapping(['001'])));
  const frs = frsOf(r);
  assert.deepEqual(frs.map((f) => f.id), ['FR-001', 'FR-002']);
  assert.ok(frs[0].description.includes('FR-901') && frs[0].description.includes('```'), `代码块应留在描述里: ${frs[0].description}`);
  assert.equal(r.warnings.filter((w) => w.includes('候选')).length, 0);
});

test('W-1 候选宽判据：四位编号 / 反引号包裹 ID / 行首裸编号段落 都进候选（warning 兜住）；`+` bullet 是条目', () => {
  const body = specDoc(['- FR-0012 四位数字', '- `FR-002` 反引号包裹', 'FR-004: 行首裸编号段落', '+ FR-003 plus bullet'].join('\n'));
  const r = run(makeProject([{ dir: '001-s', body }], mapping(['001'])));
  assert.deepEqual(frsOf(r).map((f) => f.id), ['FR-003']);
  const w = r.warnings.find((x) => x.includes('spec 001') && x.includes('候选'));
  assert.ok(w, `warnings: ${JSON.stringify(r.warnings)}`);
  assert.match(w, /3 个 FR 编号出现在候选行但未抽取（FR-0012, FR-002, FR-004）/);
});

test('W-4 写回：CRLF 文件的注释头（含空行之后的注释）也完整保留', () => {
  const header = '# 产品映射\r\n# 手动条目不覆盖\r\n\r\n# 空行之后的注释\r\n# 第四行\r\n';
  const root = makeProject([{ dir: '001-s', body: specDoc('- **FR-001**: a') }], header + mapping(['001'], 'spec-driverdriver'));
  const p = path.join(root, 'specs', 'products', 'product-mapping.yaml');
  syncMergeEngine({ projectRoot: root, dryRun: false });
  const after = fs.readFileSync(p, 'utf-8');
  assert.ok(after.startsWith(header), `注释头必须整段保留，实际开头: ${JSON.stringify(after.slice(0, 80))}`);
  assert.doesNotMatch(after, /spec-driverdriver/);
});

test('W-5 `边界条件（Edge Cases）` 不再路由进 constraints；多个约束节累加而非覆盖', () => {
  const root = makeProject([{ dir: '001-s', body: multiDoc('## 5. 约束条件\n\n真正的约束 A', '## 7. 边界条件（Edge Cases）\n\n**EC-1 边界情况**', '## Constraints\n\n约束 B', '## Scope Boundaries\n\n### In Scope\n\n范围 C', '## 边界场景（Edge Cases）\n\n用例 D', '## 约束与边界\n\n约束 E') }], mapping(['001']));
  const parsed = parseSpecContent(path.join(root, 'specs', '001-s', 'spec.md'));
  // 英文 Scope Boundaries 与中文「约束与边界」是约束；「边界条件 / 边界场景（Edge Cases）」不是（角 B 审查 C-B2：此前误删英文 boundary）
  assert.equal(parsed.constraints, '真正的约束 A\n\n约束 B\n\n### In Scope\n\n范围 C\n\n约束 E');
});

test('子编号 spec（094-01 / 094-02）是各自独立的身份：目录侧与 mapping 侧同一口径，不再坍缩成 094 互相覆盖', () => {
  assert.deepEqual(['094-02-panoramic-dir-restructure', '094-02', '001-reverse-spec-v2', '123-2024-report', 'products', '12-x'].map(extractSpecId), ['094-02', '094-02', '001', '123', null, null]);
  const specs = [
    { dir: '001-core', body: specDoc('- **FR-001**: 基线') },
    { dir: '094-01-alpha', body: specDoc('- **FR-001**: 094-01 的需求') },
    { dir: '094-02-beta', body: specDoc('- **FR-001**: 094-02 的需求') },
    { dir: '123-2024-report', body: specDoc('- **FR-001**: 名称里带数字段的 spec') },
  ];
  // mapping 同时用「纯编号」与「完整目录名」两种写法
  const r = run(makeProject(specs, mapping(['001', '094-01', '094-02-beta', '123'])));
  assert.deepEqual(r.products.spectra.timeline.entries.map((e) => e.specId), ['001', '094-01', '094-02', '123']);
  const frs = frsOf(r);
  assert.deepEqual(frs.map((f) => [f.sourceSpec, f.description]), [['001', '基线'], ['094-01', '094-01 的需求'], ['094-02', '094-02 的需求'], ['123', '名称里带数字段的 spec']]);
  assert.equal(r.products.spectra.conflicts.length, 0);
  assert.equal(r.unmappedSpecs.length, 0);
  assert.equal(r.products.spectra.timeline.warnings.length, 0, `不得再报「编号 094 重复」: ${r.products.spectra.timeline.warnings}`);
  // 只登记 094-01 时，094-02 以自己的编号被报为未映射
  const r2 = run(makeProject(specs, mapping(['001', '094-01', '123'])));
  assert.deepEqual(r2.unmappedSpecs.map((s) => s.specId), ['094-02']);
});

test('编号形态：FR-1 / FR-10 / FR-A-001 / FR-A01 / FR-026-01 都是条目（各自保留原编号），四位编号只进候选', () => {
  // 四位编号那行放在首条之前：它不是条目，若放在某条之后会按续行并入该条描述（状态机既定行为）
  const body = specDoc(['- FR-0012 四位数字只进候选', '- FR-1: 一位数字', '- FR-10: 两位数字', '- **FR-A-001**：字母分组带短横', '- **FR-B01** `[必须]`：字母分组无短横', '- **FR-026-01**: 编号带子号'].join('\n'));
  const r = run(makeProject([{ dir: '001-s', body }], mapping(['001'])));
  assert.deepEqual(frsOf(r).map((f) => [f.id, f.description]), [['FR-1', '一位数字'], ['FR-10', '两位数字'], ['FR-A-001', '字母分组带短横'], ['FR-B01', '字母分组无短横'], ['FR-026-01', '编号带子号']]);
  const w = r.warnings.find((x) => x.includes('spec 001') && x.includes('候选'));
  assert.match(w, /1 个 FR 编号出现在候选行但未抽取（FR-0012）/);
});

test('追溯表 / 状态表重复引用已抽取的编号不再误报；只有候选编号确实未抽取时才 warning', () => {
  const body = specDoc(['- **FR-001**: 一', '- **FR-002**: 二', '', '| FR | US |', '|---|---|', '| FR-001, FR-002 | US-1 |', '| FR-002 | US-2 |'].join('\n'));
  const r = run(makeProject([{ dir: '001-s', body }], mapping(['001'])));
  assert.equal(frsOf(r).length, 2);
  assert.equal(r.warnings.filter((w) => w.includes('候选')).length, 0, `表格只引用已抽取编号时不得 warning: ${JSON.stringify(r.warnings)}`);
  const body2 = specDoc(['- **FR-001**: 一', '', '| FR | US |', '|---|---|', '| FR-003 | 只出现在表里 |'].join('\n'));
  const w = run(makeProject([{ dir: '001-s', body: body2 }], mapping(['001']))).warnings.find((x) => x.includes('候选'));
  assert.match(w, /1 个 FR 编号出现在候选行但未抽取（FR-003）/);
});

test('整份 spec 没有需求类 H2 时，写在别处的 FR 条目以「未找到需求类 H2」warning 可见，而不是整体静默消失', () => {
  const body = ['# Feature Specification: NoReq', '', '## 2. 接口定义', '', '- **FR-001**: 写在接口定义章下', '- **FR-002**: 第二条', '', '## 5. 约束条件', '', '约束'].join('\n');
  const r = run(makeProject([{ dir: '001-core', body: specDoc('- **FR-001**: 基线') }, { dir: '002-noreq', body }], mapping(['001', '002'])));
  assert.equal(frsOf(r).filter((f) => f.sourceSpec === '002').length, 0);
  const w = r.warnings.find((x) => x.includes('spec 002'));
  assert.ok(w, `warnings: ${JSON.stringify(r.warnings)}`);
  assert.match(w, /未找到需求类 H2；需求类 H2 之外有 2 条 FR 条目写法未纳入抽取（「## 2. 接口定义」: FR-001, FR-002）/);
  // 有需求类 H2 的 spec 不受这条兜底影响：正文里的 `F171 FR-014` 这类行内引用不是候选
  const ok = specDoc('- **FR-001**: 见 F171 FR-014 的惯例');
  assert.equal(run(makeProject([{ dir: '001-s', body: ok }], mapping(['001']))).warnings.filter((x) => x.includes('候选')).length, 0);
});

test('点分子编号是独立条目（FR-1 / FR-1.1 / FR-3.1.1 互不撞号）；区间标签 `FR-001 ~ FR-005` 是分组不是条目；`FR-9 — 6 个…` 的破折号不是区间', () => {
  const body = specDoc(['### FR-1 分组需求 [必须]', '', '**FR-1.1**：子需求一', '', '**FR-1.2**：子需求二', '', '- **FR-3.1.1**：三级子编号', '', '#### FR-001 ~ FR-005: Evidence-Backed Mapping（对应 Story 1）', '', '- **FR-001**: 一', '- **FR-002**: 二', '', '#### FR-9 — 6 个 graph MCP tools 数据源切换 *(必须)*', '正文九'].join('\n'));
  const r = run(makeProject([{ dir: '001-s', body }], mapping(['001'])));
  assert.deepEqual(frsOf(r).map((f) => f.id), ['FR-1', 'FR-1.1', 'FR-1.2', 'FR-3.1.1', 'FR-001', 'FR-002', 'FR-9']);
  assert.equal(frsOf(r).find((f) => f.id === 'FR-9').description, '6 个 graph MCP tools 数据源切换 *(必须)*\n正文九');
  assert.equal(r.products.spectra.conflicts.length, 0, JSON.stringify(r.products.spectra.conflicts));
  assert.equal(r.warnings.filter((w) => w.includes('候选')).length, 0, JSON.stringify(r.warnings));
});

// ── 第三轮 delta 审查（角 A 静默丢失 / 角 B 误抽）──

test('C-1 需求类 H2 之外的 FR 条目写法（Clarifications 下的新增需求与「修正」行）不抽取但必须可见，含已抽取编号的修正行', () => {
  const body = ['# Feature Specification: 032', '', '## Requirements', '', '- **FR-001**: 一', '- **FR-008**: 旧路径', '', '## Success Criteria', '', '- **SC-001**: x', '', '## Clarifications', '', '### 新增需求（基于澄清）', '', '- **FR-020**: 新增', '- **FR-021**: 新增二', '- **FR-008 修正**: 实际路径为 …', '', '| FR-001 | 表格引用不算 |'].join('\n');
  const r = run(makeProject([{ dir: '032-s', body }], mapping(['032'])));
  assert.deepEqual(frsOf(r).map((f) => f.id), ['FR-001', 'FR-008']);
  const w = r.warnings.find((x) => x.includes('spec 032') && x.includes('之外'));
  assert.ok(w, `warnings: ${JSON.stringify(r.warnings)}`);
  assert.match(w, /需求类 H2 之外有 3 条 FR 条目写法未纳入抽取（「## Clarifications」: FR-020, FR-021, FR-008）/);
  assert.doesNotMatch(w, /未找到需求类 H2/);
  assert.equal(r.warnings.filter((x) => x.includes('未抽出任何')).length, 0);
});

test('W-2 H2 位的 FR 条目（`## FR-002：…`）不抽取但进「之外」warning', () => {
  const body = specDoc('- **FR-001**: 一') + '\n## FR-002：写成 H2 的需求\n\n正文\n';
  const r = run(makeProject([{ dir: '001-s', body }], mapping(['001'])));
  assert.deepEqual(frsOf(r).map((f) => f.id), ['FR-001']);
  assert.match(r.warnings.find((x) => x.includes('之外')) ?? '', /「## FR-002：写成 H2 的需求」: FR-002/);
});

test('C-2 同名重复 H2 不再后者覆盖前者：两段 `## 功能需求` 都累加', () => {
  const body = multiDoc('## 功能需求\n\n- **FR-001**: 一\n- **FR-002**: 二', '## 功能需求\n\n- **FR-003**: 三');
  const r = run(makeProject([{ dir: '001-s', body }], mapping(['001'])));
  assert.deepEqual(frsOf(r).map((f) => f.id), ['FR-001', 'FR-002', 'FR-003']);
  assert.equal(r.warnings.filter((w) => w.includes('spec 001')).length, 0);
});

test('W-1 fenced code 里的 `## ` 不切断需求节：代码块之后的条目仍被抽取', () => {
  const body = specDoc(['- **FR-001**: 一，示例：', '', '```md', '## 示例标题（在代码块里）', '- **FR-901**: 示例', '```', '', '- **FR-002**: 二', '- **FR-003**: 三'].join('\n'));
  const r = run(makeProject([{ dir: '001-s', body }], mapping(['001'])));
  assert.deepEqual(frsOf(r).map((f) => f.id), ['FR-001', 'FR-002', 'FR-003']);
  assert.equal(r.warnings.filter((w) => w.includes('spec 001')).length, 0);
});

test('C-3 字母后缀 spec 目录（170c-*）是合法编号：被扫描、可映射、未映射时以 170c 报出', () => {
  assert.deepEqual(['170c-mcp-tool-description-response', '170c', '170-plain', '123abc-x', '1234-foo'].map(extractSpecId), ['170c', '170c', '170', null, null]);
  const specs = [{ dir: '001-core', body: specDoc('- **FR-001**: 基线') }, { dir: '170c-mcp', body: specDoc('- **FR-001**: 170c 的需求') }, { dir: '170d-driver', body: specDoc('- **FR-001**: 170d 的需求') }];
  const r = run(makeProject(specs, mapping(['001', '170c'])));
  assert.deepEqual(frsOf(r).map((f) => f.sourceSpec), ['001', '170c']);
  assert.deepEqual(r.unmappedSpecs.map((s) => s.specId), ['170d']);
});

test('W-5 / W-6 映射到产品却抽不出任何 FR 的 spec 有提示；mapping 里悬空的编号有提示', () => {
  const prose = ['# Feature Specification: Prose', '', '## Requirements', '', '系统必须做 A，并且应当做 B（散文，没有编号）。', ''].join('\n');
  const root = makeProject([{ dir: '001-core', body: specDoc('- **FR-001**: 基线') }, { dir: '002-prose', body: prose }], mapping(['001', '002', '094-05', '024', '030']));
  // 024：只有 blueprint.md（有意登记进变更历史，不算悬空）；030：目录在但既无 spec.md 也无 blueprint.md
  fs.mkdirSync(path.join(root, 'specs', '024-multilang-blueprint')); fs.writeFileSync(path.join(root, 'specs', '024-multilang-blueprint', 'blueprint.md'), '# bp');
  fs.mkdirSync(path.join(root, 'specs', '030-empty-dir'));
  const r = run(root);
  assert.match(r.warnings.find((x) => x.includes('spec 002')) ?? '', /未抽出任何 FR/);
  assert.match(r.warnings.find((x) => x.includes('094-05')) ?? '', /映射条目 094-05 在 specs\/ 下没有对应目录/);
  assert.match(r.warnings.find((x) => x.includes('030')) ?? '', /映射条目 030 的目录 030-empty-dir 既无 spec\.md 也无 blueprint\.md/);
  assert.equal(r.warnings.filter((x) => x.includes('024')).length, 0, `blueprint 条目不得报悬空: ${JSON.stringify(r.warnings)}`);
  assert.equal(r.warnings.filter((x) => x.includes('spec 001')).length, 0);
});

test('C-4 fr-count 是合并守恒：骨架 FR 总数 == 各 spec 抽取条数之和；handler 丢条目或重复合并时判 fail', () => {
  const r = run(makeProject([{ dir: '001-core', body: specDoc('- **FR-001**: 一\n- **FR-002**: 二') }, { dir: '002-f', body: specDoc('- **FR-001**: 三') }], mapping(['001', '002'])));
  const check = r.validation.reports[0].checks.find((c) => c.name === 'fr-count');
  assert.deepEqual([check.passed, check.data.extractedFRCount, check.data.skeletonFRCount, check.data.activeFRCount], [true, 3, 3, 3]);
  // 直接喂一个少了一条的骨架：外部基线（parsedSpecs）不随骨架同步缩水
  const skeleton = r.products.spectra.mergeSkeleton;
  const lossy = JSON.parse(JSON.stringify(skeleton));
  lossy.chapters['5'].functionalRequirements.pop();
  const parsed = { '001': { requirements: [{ id: 'FR-001' }, { id: 'FR-002' }] }, '002': { requirements: [{ id: 'FR-001' }] } };
  const report = validateMergeResult(lossy, r.products.spectra.timeline, parsed);
  const lossyCheck = report.checks.find((c) => c.name === 'fr-count');
  assert.equal(lossyCheck.passed, false);
  assert.equal(report.passed, false);
  assert.match(lossyCheck.detail, /合并丢失或重复合并/);
  // 全丢（抽取 0 → 骨架 0）不再是「0 >= 0」式的自证通过：基线 3 条 vs 骨架 0 条 → fail
  const empty = JSON.parse(JSON.stringify(skeleton));
  empty.chapters['5'].functionalRequirements = [];
  assert.equal(validateMergeResult(empty, r.products.spectra.timeline, parsed).passed, false);
});

// ── 第三轮 delta 审查（角 B 误抽 / 污染 / 写回）──

test('W-B1 157 形态：YAGNI 移除记录 `- FR-004（…）：… [YAGNI-移除]` 并入 FR-004 描述而不是判成第二条需求；不产生冲突', () => {
  const body = specDoc(['- **FR-004（W-3 修复）**：真需求 MAY 做事 `[可选]`', '- **FR-005**: 五', '', '### YAGNI 必要性检验汇总', '', '| FR-004 | type-only | `[可选]` |', '', '**YAGNI-移除条件**：', '- FR-004（type-only import 追踪）：R-1-A 调研确认 = 0 false-negative → 标 [YAGNI-移除]，从本版本移除', '- FR-005（动态 import 容错）：同上 → 标 [YAGNI-移除]'].join('\n'));
  const r = run(makeProject([{ dir: '157-fix-x', body }], mapping(['157'])));
  const frs = frsOf(r);
  assert.deepEqual(frs.map((f) => [f.id, f.status]), [['FR-004', 'active'], ['FR-005', 'active']]);
  assert.equal(frs[0].description, '（W-3 修复） 真需求 MAY 做事 `[可选]`\n\n（type-only import 追踪） R-1-A 调研确认 = 0 false-negative → 标 [YAGNI-移除]，从本版本移除');
  assert.equal(r.products.spectra.conflicts.length, 0);
  assert.match(r.warnings.find((w) => w.includes('spec 157')) ?? '', /2 个 FR 编号重复出现，已按出现顺序并入首条描述（FR-004 ×2, FR-005 ×2）/);
});

test('W-B2 行首注解只剥纯强度标记；短标题 / 溯源标签 / 语义限定保留为描述前缀', () => {
  const block = ['- **FR-001**（离线重判）：`oracle_error` 离线重判', '- **FR-002** [Story 1, 3]: 溯源标签', '- **FR-003** `[Non-goal]`：不在本卡范围', '- **FR-004**（monorepo nearest-config 选择规则，C-3 修复）：当存在多个 tsconfig', '- **FR-005** [MUST NOT]: 否定强度也是注解', '- **FR-006** [必须] [Story 2]: 注解与标签并列时只剥注解', '- **FR-007** `[可选]`（决策纯函数）：反引号注解在前'].join('\n');
  const frs = frsOf(run(makeProject([{ dir: '001-s', body: specDoc(block) }], mapping(['001']))));
  assert.deepEqual(frs.map((f) => f.description), [
    '（离线重判） `oracle_error` 离线重判',
    '[Story 1, 3] 溯源标签',
    '`[Non-goal]` 不在本卡范围',
    '（monorepo nearest-config 选择规则，C-3 修复） 当存在多个 tsconfig',
    '否定强度也是注解',
    '[Story 2] 注解与标签并列时只剥注解',
    '（决策纯函数） 反引号注解在前',
  ]);
});

test('W-B4 / W-B7 mapping 条目不带引号（YAML 数字）也是编号；`1234-foo` 不是 `123`', () => {
  const yaml = ['products:', '  spectra:', '    description: "x"', '    specs:', '      - 1', '      - 94', '      - "1234-foo"', ''].join('\n');
  const specs = [{ dir: '001-core', body: specDoc('- **FR-001**: 一') }, { dir: '094-x', body: specDoc('- **FR-001**: 九四') }, { dir: '123-real', body: specDoc('- **FR-001**: 一二三') }];
  const r = run(makeProject(specs, yaml));
  assert.deepEqual(r.products.spectra.timeline.entries.map((e) => e.specId), ['001', '094']);
  assert.deepEqual(r.unmappedSpecs.map((s) => s.specId), ['123']);
  assert.match(r.warnings.find((w) => w.includes('1234-foo')) ?? '', /映射条目 1234-foo 在 specs\/ 下没有对应目录/);
});

test('W-B5 写回：BOM 与 YAML 文档分隔符 `---` 之后的注释头保留；CRLF 文件写回后行尾不混用', () => {
  const header = '﻿---\r\n# 产品映射\r\n\r\n# 空行后的注释\r\n';
  const root = makeProject([{ dir: '001-s', body: specDoc('- **FR-001**: a') }], header + mapping(['001'], 'spec-driverdriver').replace(/\n/g, '\r\n'));
  const p = path.join(root, 'specs', 'products', 'product-mapping.yaml');
  syncMergeEngine({ projectRoot: root, dryRun: false });
  const after = fs.readFileSync(p, 'utf-8');
  assert.ok(after.startsWith(header), `注释头（含 BOM 与 ---）必须保留: ${JSON.stringify(after.slice(0, 60))}`);
  assert.doesNotMatch(after, /spec-driverdriver/);
  assert.equal(after.split('\r\n').length - 1, after.split('\n').length - 1, '不得出现裸 \\n 与 \\r\\n 混用');
});

test('W-B8 同一编号多个含 spec.md 的目录：warning 指名目录（parsedSpecs 按编号索引会互相覆盖）', () => {
  const r = run(makeProject([{ dir: '001-core', body: specDoc('- **FR-001**: 基线') }, { dir: '112-a', body: specDoc('- **FR-001**: A') }, { dir: '112-b', body: specDoc('- **FR-001**: B') }], mapping(['001', '112'])));
  assert.match(r.warnings.find((w) => w.includes('编号 112')) ?? '', /编号 112 有 2 个含 spec\.md 的目录（112-a, 112-b）/);
});
