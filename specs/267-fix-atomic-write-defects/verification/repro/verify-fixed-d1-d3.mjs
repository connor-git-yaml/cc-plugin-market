/**
 * F267 — D1 / D2 / D3 的**修复后**验证脚本。
 *
 * 为什么需要它：`d1-d2-symlink-mode.mjs` 与 `d3-concurrent-tmp.mjs` 内联了一份**冻结的旧实现**
 * 副本（"复刻当前 writeAtomicJson"）。它们是缺陷的**演示器**，不是修复的**验证器**——无论源码
 * 改成什么样，重跑它们都只会重现旧行为。冻结副本作为基线证据有价值（不随源码漂移），故原样保留，
 * 由本文件对**真实构建产物** `dist/utils/atomic-write.js` 跑同一组场景。
 *
 * 用法（需先 `npm run build`）：
 *   REPO=$(git rev-parse --show-toplevel) node "$REPO/specs/267-fix-atomic-write-defects/verification/repro/verify-fixed-d1-d3.mjs"
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const repo = process.env.REPO;
if (!repo) throw new Error('需要设置 REPO 环境变量指向仓库根目录');
const moduleUrl = new URL(`file://${path.join(repo, 'dist', 'utils', 'atomic-write.js')}`).href;
const { writeAtomicJson } = await import(moduleUrl);

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'f267-verify-'));

// ── D1 软链跟随 ──────────────────────────────────────────────────────────────
const realFile = path.join(sandbox, 'real-settings.json');
const link = path.join(sandbox, 'link-settings.json');
fs.writeFileSync(realFile, JSON.stringify({ origin: 'dotfiles' }, null, 2));
fs.symlinkSync(realFile, link);
// 🔴 必须传 `followSymlinks: true`：对抗审查后跟随改为 opt-in（默认 false 是安全侧）。
// 不传的话这一段对任何实现都输出"未跟随"，是条断不出结果的死路径——本脚本此前就有这个缺陷。
writeAtomicJson(
  link,
  { hooks: { PreToolUse: [{ matcher: 'Glob|Grep', command: 'bash x.sh' }] } },
  { followSymlinks: true },
);
console.log('D1 AFTER isSymlink =', fs.lstatSync(link).isSymbolicLink(), '(期望 true)');
console.log('D1 AFTER 真实文件收到更新 =', fs.readFileSync(realFile, 'utf-8').includes('PreToolUse'), '(期望 true)');

// ── D2 mode 保全 ─────────────────────────────────────────────────────────────
const permFile = path.join(sandbox, 'perm.json');
fs.writeFileSync(permFile, '{}');
fs.chmodSync(permFile, 0o600);
writeAtomicJson(permFile, { a: 1 });
console.log('D2 AFTER mode =', (fs.statSync(permFile).mode & 0o7777).toString(8), '(期望 600)');

const freshFile = path.join(sandbox, 'fresh.json');
writeAtomicJson(freshFile, { a: 1 });
console.log('D2 新建 mode =', (fs.statSync(freshFile).mode & 0o7777).toString(8), '(期望 600)');

// ── D3 双进程并发 ────────────────────────────────────────────────────────────
const worker = path.join(sandbox, 'worker.mjs');
fs.writeFileSync(
  worker,
  [
    'const [url, target, tag, rounds] = process.argv.slice(2);',
    'const { writeAtomicJson } = await import(url);',
    'for (let i = 0; i < Number(rounds); i += 1) {',
    '  try { writeAtomicJson(target, { writer: tag, round: i, filler: tag.repeat(2048) }); }',
    "  catch (e) { process.stdout.write(`WRITE-ERR ${e && e.code ? e.code : 'UNKNOWN'}\\n`); }",
    '}',
    '',
  ].join('\n'),
  'utf-8',
);
const raceTarget = path.join(sandbox, 'race.json');
const launch = (tag) => `node '${worker}' '${moduleUrl}' '${raceTarget}' '${tag}' 40`;
const race = spawnSync('bash', ['-c', `${launch('A')} & ${launch('B')} & wait`], { encoding: 'utf-8' });
const enoentCount = (race.stdout.match(/WRITE-ERR ENOENT/g) ?? []).length;
console.log('D3 ENOENT 次数 =', enoentCount, '(期望 0；修复前基线 3-7 次)');
const finalDoc = JSON.parse(fs.readFileSync(raceTarget, 'utf-8'));
console.log(
  'D3 最终文件是某一方的完整 payload =',
  ['A', 'B'].includes(finalDoc.writer) && finalDoc.filler === finalDoc.writer.repeat(2048),
  '(期望 true)',
);
console.log(
  'D3 tmp 残渣 =',
  fs.readdirSync(sandbox).filter((n) => n.includes('.tmp')).length,
  '(期望 0)',
);

fs.rmSync(sandbox, { recursive: true, force: true });
