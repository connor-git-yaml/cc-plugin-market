#!/usr/bin/env node
/**
 * Feature 176 — 预注册一键冻结（runbook 步骤 4c 自动化；spec FR-A-002b）。
 *
 * 扫描 Verified fixtures 目录取 task id（或 --task-ids 显式指定），算 taskSetHash，
 * 原地改写 specs/176/.../verification/preregistration.md 的 frontmatter
 * （taskIds / taskSetHash / count / frozen: true / gitCommit / seed / filterRule 摘要）。
 *
 * 用法（host，在 import + oracle smoke 通过后）：
 *   node scripts/freeze-preregistration.mjs                  # 扫 fixtures 目录全部 task
 *   node scripts/freeze-preregistration.mjs --task-ids a,b,c # 显式指定（如剔除 oracle smoke 不过的）
 *   node scripts/freeze-preregistration.mjs --dry-run        # 只打印将写入的 frontmatter
 *
 * 冻结后请 git commit preregistration.md（git 历史 = anti-tamper 锚）。
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PROJECT_ROOT, fixturesDir } from './lib/swe-bench-verified-paths.mjs';
import { computeTaskSetHash, freezeBlock } from './lib/preregistration-check.mjs';

const PREREG = path.join(PROJECT_ROOT, 'specs/176-swe-bench-verified-cross-cohort/verification/preregistration.md');

export function listFixtureTaskIds(dir = fixturesDir()) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((n) => n.endsWith('.json') && !n.startsWith('_'))
    .map((n) => n.replace(/\.json$/, ''))
    .sort();
}

/** 用冻结块改写 preregistration.md frontmatter（保留正文不动）。 */
export function renderFrozenPrereg(mdText, block, gitCommit) {
  const m = String(mdText).replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) throw new Error('preregistration.md 缺 frontmatter');
  const body = m[2];
  const fm = [
    '---',
    'feature: 176',
    'artifact: preregistration',
    'frozen: true',
    `taskSetHash: ${block.taskSetHash}`,
    `seed: ${block.seed}`,
    `count: ${block.count}`,
    `gitCommit: ${gitCommit}`,
    `frozenAtIso: ${new Date().toISOString()}`,
    'taskIds:',
    ...block.taskIds.map((id) => `  - ${id}`),
    '---',
  ].join('\n');
  return `${fm}\n${body}`;
}

function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes('--dry-run');
  const idsFlag = argv.indexOf('--task-ids');
  const taskIds = idsFlag >= 0
    ? argv[idsFlag + 1].split(',').map((s) => s.trim()).filter(Boolean)
    : listFixtureTaskIds();

  if (taskIds.length === 0) {
    console.error('[freeze-prereg] 无 task：先跑 Verified importer（runbook 4a）或 --task-ids 指定');
    process.exit(2);
  }
  if (taskIds.length < 10) {
    console.error(`[freeze-prereg] ⚠️ 仅 ${taskIds.length} 个 task（目标 10）；不足时报告须在显著性章节标注`);
  }

  const head = spawnSync('git', ['-C', PROJECT_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf-8' });
  const gitCommit = (head.stdout ?? 'unknown').trim();
  const block = freezeBlock(taskIds, { seed: 176 });
  const next = renderFrozenPrereg(fs.readFileSync(PREREG, 'utf-8'), block, gitCommit);

  if (dryRun) {
    console.log(next.split('\n').slice(0, 20).join('\n'));
    console.error(`[freeze-prereg] --dry-run：未写盘（${taskIds.length} task, hash=${block.taskSetHash.slice(0, 12)}…）`);
    return;
  }
  fs.writeFileSync(PREREG, next, 'utf-8');
  console.error(`[freeze-prereg] ✅ 已冻结：${taskIds.length} task, hash=${block.taskSetHash.slice(0, 12)}…, commit=${gitCommit.slice(0, 8)}`);
  console.error('[freeze-prereg] 下一步：git add + commit preregistration.md（git 历史=anti-tamper 锚），然后跑 batch --smoke');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main();
