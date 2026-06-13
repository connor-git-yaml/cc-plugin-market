/**
 * Feature 187 — 从 fixture.swebenchMeta 合成 swebench harness 本地 dataset JSON（plan Decision 1 / FR-001-f）。
 *
 * fixture.swebenchMeta 缺 harness 必需的 version / environment_setup_commit（make_test_spec
 * 用 MAP_REPO_VERSION_TO_SPECS[repo][version] 硬查）→ 从官方 Lite dataset 按 instance_id 取完整行，
 * 同时**逐字段校验** failToPass/passToPass/testPatch/goldPatch == fixture（W1 不变量，Codex C-4）。
 * 不一致 → 标 fixture 级错误（不静默继续）。校验通过的官方行即为 harness 输入（语义官方对齐 + 与冻结 fixture 等价）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as crypto from 'node:crypto';

const DEFAULT_DATASET = 'SWE-bench/SWE-bench_Lite';

/** FAIL_TO_PASS/PASS_TO_PASS 可能是 JSON 字符串或数组 → 归一为排序后数组（顺序无关比较）。 */
export function normalizeTestList(v) {
  let arr = v;
  if (typeof v === 'string') {
    try { arr = JSON.parse(v); } catch { arr = []; }
  }
  return Array.isArray(arr) ? [...arr].map(String).sort() : [];
}

function eqSet(a, b) {
  const sa = normalizeTestList(a);
  const sb = normalizeTestList(b);
  return sa.length === sb.length && sa.every((x, i) => x === sb[i]);
}

/**
 * 校验官方行与 fixture.swebenchMeta 逐字段一致（W1）。返回不一致字段清单（空=一致）。
 */
export function diffOfficialVsFixture(officialRow, swebenchMeta) {
  const mismatches = [];
  if (!eqSet(officialRow.FAIL_TO_PASS, swebenchMeta.failToPass)) mismatches.push('failToPass');
  if (!eqSet(officialRow.PASS_TO_PASS, swebenchMeta.passToPass)) mismatches.push('passToPass');
  if (String(officialRow.test_patch || '').trim() !== String(swebenchMeta.testPatch || '').trim()) mismatches.push('testPatch');
  if (String(officialRow.patch || '').trim() !== String(swebenchMeta.goldPatch || '').trim()) mismatches.push('goldPatch');
  return mismatches;
}

/** 调 venv python 取官方行（datasets lib，首次下载后本地缓存）。 */
function fetchOfficialRows({ datasetName, instanceIds, venvPath }) {
  const py = path.join(venvPath, 'bin', 'python');
  const helper = path.join(path.dirname(new URL(import.meta.url).pathname), 'swebench_fetch_rows.py');
  const res = spawnSync(py, [helper, datasetName, ...instanceIds], { encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0) {
    throw new Error(`swebench_fetch_rows.py 失败 (status=${res.status}): ${res.stderr || res.stdout}`);
  }
  return JSON.parse(res.stdout);
}

/**
 * 从一组 fixture 合成本地 dataset JSON 文件。
 * @returns {{outPath: string, digest: string, rows: object[], mismatches: Array<{instanceId, fields}>}}
 */
export function buildLocalDataset({ fixturePaths, outPath, datasetName = DEFAULT_DATASET, venvPath = 'scripts/.swebench-venv' }) {
  const fixtures = fixturePaths.map((p) => ({ p, json: JSON.parse(fs.readFileSync(p, 'utf-8')) }));
  const metas = fixtures.map((f) => f.json.swebenchMeta);
  const instanceIds = metas.map((m) => m.instanceId);
  const official = fetchOfficialRows({ datasetName, instanceIds, venvPath });
  const byId = Object.fromEntries(official.map((r) => [r.instance_id, r]));

  const rows = [];
  const mismatches = [];
  for (const m of metas) {
    const row = byId[m.instanceId];
    if (!row) { mismatches.push({ instanceId: m.instanceId, fields: ['<missing-in-official>'] }); continue; }
    const fields = diffOfficialVsFixture(row, m);
    if (fields.length > 0) mismatches.push({ instanceId: m.instanceId, fields });
    rows.push(row); // 官方行（已校验等价 fixture）即 harness 输入
  }

  const content = JSON.stringify(rows);
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const tmp = `${outPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, content, 'utf-8');
    fs.renameSync(tmp, outPath);
  }
  const digest = crypto.createHash('sha256').update(content).digest('hex');
  return { outPath, digest, rows, mismatches };
}

// CLI：node swebench-dataset-build.mjs --fixture <path> [--fixture <path>...] --out <path>
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const fixturePaths = [];
  let outPath = null;
  let venvPath = 'scripts/.swebench-venv';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--fixture') fixturePaths.push(argv[++i]);
    else if (argv[i] === '--out') outPath = argv[++i];
    else if (argv[i] === '--venv') venvPath = argv[++i];
  }
  if (fixturePaths.length === 0 || !outPath) {
    console.error('usage: swebench-dataset-build.mjs --fixture <path>... --out <path> [--venv <dir>]');
    process.exit(2);
  }
  const r = buildLocalDataset({ fixturePaths, outPath, venvPath });
  if (r.mismatches.length > 0) {
    console.error(`⚠️ W1 字段不一致（fixture vs 官方）：${JSON.stringify(r.mismatches)}`);
    process.exit(1);
  }
  console.log(`本地 dataset 写入 ${r.outPath}（${r.rows.length} 行，digest=${r.digest.slice(0, 12)}）`);
}
