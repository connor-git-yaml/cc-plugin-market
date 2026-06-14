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
    // F197 C2：swebench-execution 冻结的扩展字段（仅 block 含该字段时渲染，向后兼容非 swebench 冻结）。
    // 条件渲染保证"复跑 freeze 不丢字段"（block 已含字段即输出）。
    ...(block.oracleSpecHash ? [`oracleSpecHash: ${block.oracleSpecHash}`] : []),
    ...(block.fixtureContentHash ? [`fixtureContentHash: ${block.fixtureContentHash}`] : []),
    ...(block.promptSha256 ? [`promptSha256: ${block.promptSha256}`] : []),
    ...(block.schemaVersion ? [`schemaVersion: ${block.schemaVersion}`] : []),
    `frozenAtIso: ${new Date().toISOString()}`,
    'taskIds:',
    ...block.taskIds.map((id) => `  - ${id}`),
    '---',
  ].join('\n');
  return `${fm}\n${body}`;
}

async function main() {
  try {
    const argv = process.argv.slice(2);
    const dryRun = argv.includes('--dry-run');
    const idsFlag = argv.indexOf('--task-ids');
    const taskIds = idsFlag >= 0
      ? argv[idsFlag + 1].split(',').map((s) => s.trim()).filter(Boolean)
      : listFixtureTaskIds();
    // F197 C2：swebench-execution 冻结模式 —— 额外算 oracleSpecHash / fixtureContentHash / promptSha256
    const swebenchOracle = argv.includes('--swebench-oracle');
    const manifestIdx = argv.indexOf('--manifest');
    const manifestPath = manifestIdx >= 0 ? argv[manifestIdx + 1] : null;

    if (taskIds.length === 0) {
      console.error('[freeze-prereg] 无 task：先跑 Verified importer（runbook 4a）或 --task-ids 指定');
      process.exit(2);
    }
    if (taskIds.length < 10) {
      console.error(`[freeze-prereg] ⚠️ 仅 ${taskIds.length} 个 task（目标 10）；不足时报告须在显著性章节标注`);
    }

    const head = spawnSync('git', ['-C', PROJECT_ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf-8' });
    const gitCommit = (head.stdout ?? 'unknown').trim();

    // F197 C2：swebench 模式复用 cohort-batch 的 buildLiveOracleSpecInput 算 oracleSpecInput，
    // 保证 freeze↔check 口径逐字一致（杜绝算法分叉致永久 mismatch）。无 venv 时 throw → 下方 catch。
    let oracleSpecInput = null;
    let fixtureContentHash = null;
    let promptSha256 = null;
    if (swebenchOracle) {
      const { buildLiveOracleSpecInput, loadExperimentManifest } = await import('./swe-bench-verified-cohort-batch.mjs');
      const { computeDriverPromptSha256 } = await import('./eval-task-runner.mjs');
      const { computeFixtureContentHash } = await import('./lib/preregistration-check.mjs');
      const manifest = manifestPath ? loadExperimentManifest(manifestPath) : undefined;
      oracleSpecInput = buildLiveOracleSpecInput(manifest);
      fixtureContentHash = computeFixtureContentHash(taskIds, fixturesDir());
      promptSha256 = computeDriverPromptSha256();
    }
    const block = freezeBlock(taskIds, { seed: 176, gitCommit, oracleSpecInput, fixtureContentHash, promptSha256 });
    const next = renderFrozenPrereg(fs.readFileSync(PREREG, 'utf-8'), block, gitCommit);

    if (dryRun) {
      console.log(next.split('\n').slice(0, 24).join('\n'));
      console.error(`[freeze-prereg] --dry-run：未写盘（${taskIds.length} task, hash=${block.taskSetHash.slice(0, 12)}…）`);
      return;
    }
    fs.writeFileSync(PREREG, next, 'utf-8');
    console.error(`[freeze-prereg] ✅ 已冻结：${taskIds.length} task, hash=${block.taskSetHash.slice(0, 12)}…, commit=${gitCommit.slice(0, 8)}${swebenchOracle ? '（swebench-execution：oracleSpecHash+fixtureContentHash+promptSha256 已冻结）' : ''}`);
    console.error('[freeze-prereg] 下一步：git add + commit preregistration.md（git 历史=anti-tamper 锚），然后跑 batch --smoke');
  } catch (e) {
    // W4 Codex 处置：无 venv 时 buildLiveOracleSpecInput throw，给可读错误 + exit 2，不裸崩
    if (/无法从 venv 读取 swebench 版本/.test(e.message)) {
      console.error('[freeze-prereg] ❌ swebench-execution 冻结需先 bash scripts/setup-swebench-venv.sh');
      process.exit(2);
    }
    console.error('[freeze-prereg] ❌ 冻结失败:', e.message);
    process.exit(1);
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) main();
