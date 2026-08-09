#!/usr/bin/env node
/**
 * F260 callSites 产物指纹重算器（plan §5 变更 #16 / tasks T003；B1 裁决的 P3 主锚点）。
 *
 * 用法：
 *   node callsites-fingerprint.mjs <before.json> <after.json> [--json] [--limit N] [--position-free]
 *   node callsites-fingerprint.mjs --digest <callsites.json>   # 每文件一行 sha256 + 全局 sha256
 *   node callsites-fingerprint.mjs --self-test
 *
 * ## `--digest`（裁决 P2-4 的入库形态）
 *
 * `callsites-P*.json` 单份 22 MB，裁决 P2-4 定稿不入库。但「指纹到底是什么」必须留痕可复核，
 * 故提供压缩摘要：**每个 callerFile 一行 sha256**（对该文件全部 callSite 的指纹键排序后取哈希）
 * 加一个全局 sha256。摘要体积 ~100 KB，可入库，且足以定位「哪个文件的抽取产出变了」。
 *
 * 注意：per-file 摘要**排序**后再哈希，与主比较口径（多重集）一致；同一输入两次运行 byte-stable。
 *
 * ## 为什么 P3 的锚点不是边集 diff（B1）
 *
 * 审查实测：破坏全仓 61,934 个 `calleeQualifier` 只有 79 条在边集可见（捕获率 0.13%），
 * 破坏 `calleeKind` 的盲区达 99.64%。成因是 46.3% 的 callSite 直接 `return null`、
 * 45.4% 出边后被悬空丢弃，存活的 8.3% 还要经 2.65:1 塌缩。因此「抽取层有没有动到既有
 * callSite 产出」必须在 callSites 这一层直接比，边集只能当辅助信号。
 *
 * ## 指纹比较键
 *
 * `callerFile | line | column | calleeName | calleeKind | calleeQualifier | callerContext |
 *  enclosingNamedContext` 的**多重集**（同一位置可能有多条 callSite，去重会掩盖增删）+ 总条数。
 *
 * **显式排除**新增字段 `receiverType` / `receiverTypeSoleImportBinding`：它们是 P3 的预期
 * 新增产出，参与比较会把正常新增误判成指纹漂移，让这个锚点失去判别力。排除清单写死在
 * `EXCLUDED_FIELDS`，比较键是白名单式的（只取 FINGERPRINT_FIELDS），新字段默认不参与。
 */
import fs from 'node:fs';
import crypto from 'node:crypto';

/** 参与指纹的字段（白名单：新增字段默认不参与）。 */
const FINGERPRINT_FIELDS = [
  'callerFile',
  'line',
  'column',
  'calleeName',
  'calleeKind',
  'calleeQualifier',
  'callerContext',
  'enclosingNamedContext',
];

/**
 * 位置无关口径（`--position-free`）：把 `line` / `column` 从比较键剔掉。
 *
 * 主口径把「新代码插进文件导致既有调用点**行号位移**」也算成差异，而位移与抽取语义无关。
 * 位置无关口径专门回答另一个问题：**既有调用点的抽取产出本身有没有变**。
 * 该口径下的 `removedCount > 0` 才是真正意义上的「抽取层动到了既有产出」。
 *
 * 两个口径都要看：主口径给出全量差异面，位置无关口径给出其中的**语义**部分；
 * 只看位置无关口径会漏掉「同一条调用点被挪到别处」这类仍需人工确认的变化。
 */
const POSITION_FREE_FIELDS = FINGERPRINT_FIELDS.filter((f) => f !== 'line' && f !== 'column');

/** 显式排除的字段（P3 预期新增产出；仅用于文档化与 self-test 断言）。 */
const EXCLUDED_FIELDS = ['receiverType', 'receiverTypeSoleImportBinding'];

const SEP = '\x00';

function fingerprintKey(cs, fields = FINGERPRINT_FIELDS) {
  return fields.map((f) => (cs[f] === undefined || cs[f] === null ? '' : String(cs[f]))).join(SEP);
}

function readCallSites(fileOrObj) {
  const raw = typeof fileOrObj === 'string' ? JSON.parse(fs.readFileSync(fileOrObj, 'utf8')) : fileOrObj;
  const list = Array.isArray(raw) ? raw : raw.callSites;
  if (!Array.isArray(list)) throw new Error('输入不含 callSites 数组');
  return list;
}

function countMultiset(list, fields) {
  const m = new Map();
  for (const cs of list) {
    const k = fingerprintKey(cs, fields);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

export function compareFingerprints(beforeList, afterList, options = {}) {
  const fields = options.positionFree ? POSITION_FREE_FIELDS : FINGERPRINT_FIELDS;
  const before = countMultiset(beforeList, fields);
  const after = countMultiset(afterList, fields);
  const onlyInAfter = [];
  const onlyInBefore = [];
  for (const [k, n] of after) {
    const delta = n - (before.get(k) ?? 0);
    if (delta > 0) onlyInAfter.push({ n: delta, fields: decode(k, fields) });
  }
  for (const [k, n] of before) {
    const delta = n - (after.get(k) ?? 0);
    if (delta > 0) onlyInBefore.push({ n: delta, fields: decode(k, fields) });
  }
  const addedCount = onlyInAfter.reduce((s, x) => s + x.n, 0);
  const removedCount = onlyInBefore.reduce((s, x) => s + x.n, 0);
  const zeroDiff = addedCount === 0 && removedCount === 0 && beforeList.length === afterList.length;
  return {
    beforeTotal: beforeList.length,
    afterTotal: afterList.length,
    distinctKeysBefore: before.size,
    distinctKeysAfter: after.size,
    addedCount,
    removedCount,
    zeroDiff,
    verdict: zeroDiff ? '指纹零差' : '指纹非零',
    positionFree: Boolean(options.positionFree),
    fingerprintFields: fields,
    excludedFields: EXCLUDED_FIELDS,
    lists: { onlyInAfter, onlyInBefore },
  };
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * 压缩摘要（裁决 P2-4）：每 callerFile 一行 sha256 + 全局 sha256。
 *
 * 全局 sha256 取的是「`<file> <sha>` 行按文件名排序后拼接」的哈希 —— 与逐文件摘要同源，
 * 避免出现「全局对得上但逐文件对不上」这种自相矛盾的产物。
 */
export function digestCallSites(list) {
  const byFile = new Map();
  for (const cs of list) {
    const f = cs.callerFile ?? '';
    if (!byFile.has(f)) byFile.set(f, []);
    byFile.get(f).push(fingerprintKey(cs));
  }
  const files = {};
  const lines = [];
  for (const f of [...byFile.keys()].sort()) {
    const keys = byFile.get(f).slice().sort();
    const h = sha256(keys.join('\n'));
    files[f] = { n: keys.length, sha256: h };
    lines.push(`${f} ${h}`);
  }
  return {
    total: list.length,
    fileCount: lines.length,
    fingerprintFields: FINGERPRINT_FIELDS,
    excludedFields: EXCLUDED_FIELDS,
    globalSha256: sha256(lines.join('\n')),
    files,
  };
}

function decode(k, fields = FINGERPRINT_FIELDS) {
  const parts = k.split(SEP);
  return Object.fromEntries(fields.map((f, i) => [f, parts[i]]));
}

// ───────────────────────────────────────────────────────────
// self-test（T003 验收）
// ───────────────────────────────────────────────────────────

function selfTest() {
  const base = [
    { callerFile: 'a.ts', line: 3, column: 4, calleeName: 'run', calleeKind: 'member', calleeQualifier: 'x', callerContext: 'main' },
    { callerFile: 'a.ts', line: 9, column: 1, calleeName: 'load', calleeKind: 'free' },
  ];
  const clone = () => JSON.parse(JSON.stringify(base));
  const results = [];
  const assert = (name, cond, extra = '') => results.push({ name, pass: Boolean(cond), extra });

  const r1 = compareFingerprints(clone(), clone());
  assert('相同输入零差', r1.zeroDiff === true, r1.verdict);

  // 仅新增字段变化 → 零差
  const withNew = clone().map((cs) => ({ ...cs, receiverType: 'Foo', receiverTypeSoleImportBinding: true }));
  const r2 = compareFingerprints(clone(), withNew);
  assert('仅新增字段变化零差', r2.zeroDiff === true, r2.verdict);

  // 指纹字段逐个变化 → 非零
  for (const f of FINGERPRINT_FIELDS) {
    const mutated = clone();
    const target = f === 'calleeKind' ? 'free' : f === 'line' || f === 'column' ? 999 : 'MUTATED';
    mutated[0][f] = target;
    const r = compareFingerprints(clone(), mutated);
    assert(`指纹字段 ${f} 变化被识别`, r.zeroDiff === false, r.verdict);
  }

  // 多重集：同键两条 → 一条应报减少 1
  const dup = [...clone(), clone()[0]];
  const r3 = compareFingerprints(dup, clone());
  assert('多重集计数（同键重复）', r3.zeroDiff === false && r3.removedCount === 1, `removed=${r3.removedCount}`);

  // 条数相同但内容互换位置（顺序无关）→ 零差
  const reordered = clone().reverse();
  const r4 = compareFingerprints(clone(), reordered);
  assert('顺序无关', r4.zeroDiff === true, r4.verdict);

  // --position-free：行号位移不算差异，但语义字段变化仍算
  const shifted = clone();
  shifted[0].line = 999;
  shifted[0].column = 77;
  const rp1 = compareFingerprints(clone(), shifted);
  const rp2 = compareFingerprints(clone(), shifted, { positionFree: true });
  assert('主口径把行号位移算成差异', rp1.zeroDiff === false, rp1.verdict);
  assert('位置无关口径忽略行号位移', rp2.zeroDiff === true, rp2.verdict);
  const shiftedAndRenamed = clone();
  shiftedAndRenamed[0].line = 999;
  shiftedAndRenamed[0].calleeName = 'MUTATED';
  const rp3 = compareFingerprints(clone(), shiftedAndRenamed, { positionFree: true });
  assert('位置无关口径仍识别语义字段变化', rp3.zeroDiff === false && rp3.removedCount === 1, rp3.verdict);

  // --digest：同输入稳定、跨输入可判别、且不受新增字段影响
  const d1 = digestCallSites(clone());
  const d2 = digestCallSites(clone().reverse());
  assert('digest 顺序无关且可复现', d1.globalSha256 === d2.globalSha256, d1.globalSha256.slice(0, 12));
  const d3 = digestCallSites(withNew);
  assert('digest 不受新增字段影响', d1.globalSha256 === d3.globalSha256, d3.globalSha256.slice(0, 12));
  const mutatedForDigest = clone();
  mutatedForDigest[0].calleeName = 'MUTATED';
  const d4 = digestCallSites(mutatedForDigest);
  assert('digest 能识别指纹字段变化', d1.globalSha256 !== d4.globalSha256, d4.globalSha256.slice(0, 12));
  assert('digest 逐文件粒度可定位', d1.files['a.ts'] !== undefined && d1.files['a.ts'].n === 2, JSON.stringify(d1.files));

  const failed = results.filter((r) => !r.pass);
  for (const r of results) console.log(`${r.pass ? '✓' : '✗'} ${r.name}${r.extra ? ` — ${r.extra}` : ''}`);
  console.log(`\nself-test: ${results.length - failed.length}/${results.length} 通过`);
  return failed.length === 0 ? 0 : 1;
}

// ───────────────────────────────────────────────────────────
// CLI
// ───────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) process.exit(selfTest());
  const digestIdx = argv.indexOf('--digest');
  if (digestIdx >= 0) {
    const file = argv[digestIdx + 1];
    if (!file) {
      console.error('用法: node callsites-fingerprint.mjs --digest <callsites.json>');
      process.exit(2);
    }
    console.log(JSON.stringify(digestCallSites(readCallSites(file)), null, 2));
    return;
  }
  const json = argv.includes('--json');
  const limitIdx = argv.indexOf('--limit');
  const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : 40;
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--limit');
  const [beforeFile, afterFile] = positional;
  if (!beforeFile || !afterFile) {
    console.error('用法: node callsites-fingerprint.mjs <before.json> <after.json> [--json] [--limit N]');
    process.exit(2);
  }
  const positionFree = argv.includes('--position-free');
  const result = compareFingerprints(readCallSites(beforeFile), readCallSites(afterFile), { positionFree });
  if (!json) {
    console.log(`# F260 callSites 指纹比较\n`);
    console.log(`before: ${beforeFile}  (${result.beforeTotal} 条 / ${result.distinctKeysBefore} 唯一键)`);
    console.log(`after : ${afterFile}  (${result.afterTotal} 条 / ${result.distinctKeysAfter} 唯一键)`);
    console.log(`\n口径: ${positionFree ? '位置无关（剔除 line/column）' : '主口径（含 line/column）'}`);
    console.log(`指纹字段: ${result.fingerprintFields.join(' | ')}`);
    console.log(`排除字段: ${EXCLUDED_FIELDS.join(', ')}`);
    console.log(`\n新增 ${result.addedCount} / 减少 ${result.removedCount}`);
    const dump = (title, arr) => {
      if (arr.length === 0) return;
      console.log(`\n## ${title}（${arr.length} 组，最多列 ${limit}）`);
      for (const x of arr.slice(0, limit)) console.log('  ' + JSON.stringify(x));
      if (arr.length > limit) console.log(`  … 其余 ${arr.length - limit} 组见 --json`);
    };
    dump('仅出现在 after', result.lists.onlyInAfter);
    dump('仅出现在 before', result.lists.onlyInBefore);
    console.log(`\n结论: ${result.verdict}`);
    console.log('\n--- JSON ---');
  }
  console.log(JSON.stringify({ ...result, lists: json ? result.lists : undefined }, null, 2));
  // 用 exitCode 而非 process.exit()：后者会截断尚未 flush 的 stdout，
  // 管道消费方（`| node -e ...`）会拿到半截 JSON 而误判成产物损坏。
  process.exitCode = result.zeroDiff ? 0 : 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main();
