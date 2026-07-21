// F220 G1：graph-only 冻结基线自校验门（Codex G 审查 W4 修复：脚本自身即失败门）
//
// 用法（仓库根目录）：npx tsx specs/220-batch-orchestrator-decomposition/g1-freeze.mts
//   1. 校验外部 target（~/.spectra-baselines/micrograd）HEAD 未漂移
//   2. 重跑 buildAstGraphOnly 到临时目录
//   3. 与入库冻结产物 frozen-micrograd-graph.json 逐字节比对
//   任一步不符 → 非零退出（可直接接入批次验证链，无需人工 cmp/shasum）
//
// 拆前冻结事实（2026-07-21 采集）：
//   target HEAD = c911406e5ace8742e5841a7e0df113ecb5d54685
//   metrics     = 33 nodes / 37 edges / 7 calls / 2 depends-on / 5 python symbols
//   SHA-256     = db854b853a6af800940a56401c833588c8ba77b273b5f8e6b1103bc9e4946cb8
import { buildAstGraphOnly } from '../../src/batch/batch-orchestrator.js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const EXPECTED_HEAD = 'c911406e5ace8742e5841a7e0df113ecb5d54685';
const EXPECTED_SHA256 = 'db854b853a6af800940a56401c833588c8ba77b273b5f8e6b1103bc9e4946cb8';

const featureDir = dirname(fileURLToPath(import.meta.url));
const frozenPath = join(featureDir, 'frozen-micrograd-graph.json');
const target = process.env['HOME'] + '/.spectra-baselines/micrograd';

// 1. target HEAD 校验（外部 clone 漂移 → 比对失去意义，直接失败）
const head = execFileSync('git', ['-C', target, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
if (head !== EXPECTED_HEAD) {
  console.error(`[G1] FAIL: micrograd HEAD 漂移 expected=${EXPECTED_HEAD} actual=${head}`);
  process.exit(1);
}

// 2. 重跑 graph-only
const outDir = mkdtempSync(join(tmpdir(), 'f220-g1-'));
try {
  const r = await buildAstGraphOnly(target, { outputDir: outDir });
  const actual = readFileSync(r.graphPath, 'utf-8');
  const frozen = readFileSync(frozenPath, 'utf-8');
  const actualSha = createHash('sha256').update(actual, 'utf-8').digest('hex');

  // 3. 冻结产物自身完整性 + 本次输出逐字节比对
  const frozenSha = createHash('sha256').update(frozen, 'utf-8').digest('hex');
  if (frozenSha !== EXPECTED_SHA256) {
    console.error(`[G1] FAIL: 入库冻结文件被改动 expected=${EXPECTED_SHA256} actual=${frozenSha}`);
    process.exit(1);
  }
  if (actual !== frozen) {
    console.error(`[G1] FAIL: graph-only 输出相对冻结基线漂移 (sha=${actualSha})`);
    console.error(`[G1] 排查：diff <(cat ${frozenPath}) <本次输出>`);
    process.exit(1);
  }
  console.log(`[G1] PASS: byte-identical to frozen baseline (${r.nodeCount} nodes / ${r.edgeCount} edges, sha=${actualSha.slice(0, 16)}…)`);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
