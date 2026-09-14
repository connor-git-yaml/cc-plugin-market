// sync-merge-engine：Functional Requirements 抽取必须认本仓 spec.md 的真实写法
// （`- **FR-001**: …` 加粗 ID）。红先行：修复前引擎对 190 份 spec 抽出 0 条 FR
// （product-mapping 已映射 93 份仍 activeFRCount=0），validation 却报 pass。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { syncMergeEngine } from '../scripts/sync-merge-engine.mjs';

function makeProject(frBlock) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-fr-'));
  const specDir = path.join(root, 'specs', '001-sample-feature');
  fs.mkdirSync(specDir, { recursive: true });
  fs.writeFileSync(
    path.join(specDir, 'spec.md'),
    [
      '# Feature Specification: Sample',
      '',
      '## User Scenarios & Testing *(mandatory)*',
      '',
      '### User Story 1 - 示例 (Priority: P1)',
      '',
      '用户做一件事。',
      '',
      '## Requirements *(mandatory)*',
      '',
      '### Functional Requirements',
      '',
      frBlock,
      '',
      '## Success Criteria *(mandatory)*',
      '',
      '- **SC-001**: 指标',
      '',
    ].join('\n'),
  );
  fs.mkdirSync(path.join(root, 'specs', 'products'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'specs', 'products', 'product-mapping.yaml'),
    ['products:', '  spectra:', '    description: "x"', '    specs:', '      - "001"', ''].join('\n'),
  );
  return root;
}

function frCount(root) {
  const r = syncMergeEngine({ projectRoot: root, dryRun: true });
  assert.equal(r.error, undefined, `引擎报错: ${r.error}`);
  return r.products.spectra.mergeSkeleton.mergeStats.activeFRCount;
}

test('加粗 ID（本仓真实写法 `- **FR-001**: …`）必须被抽取', () => {
  const root = makeProject(
    ['- **FR-001**: 系统 MUST 做 A', '- **FR-002**: 系统 SHOULD 做 B', '- **FR-003**：系统 MAY 做 C（全角冒号）'].join('\n'),
  );
  assert.equal(frCount(root), 3);
});

test('不加粗写法（`- FR-001: …`）仍被抽取（回归）', () => {
  const root = makeProject(['- FR-001: 系统 MUST 做 A', '- FR-002: 系统 SHOULD 做 B'].join('\n'));
  assert.equal(frCount(root), 2);
});

test('加粗与不加粗混写时逐条切分不粘连', () => {
  const root = makeProject(['- **FR-001**: 系统 MUST 做 A', '- FR-002: 系统 SHOULD 做 B', '- **FR-003**: 系统 MAY 做 C'].join('\n'));
  assert.equal(frCount(root), 3);
});
