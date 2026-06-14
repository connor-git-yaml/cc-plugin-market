#!/usr/bin/env node
/**
 * F191 kb-prequery — spec-driver 编排器在 specify 阶段前的 KB 预查（确定性脚本）。
 *
 * 读 resolved knowledge_sources → bin 发现 + 能力探测 → shell out `spectra scaffold-kb query`
 * → 注入块透传 stdout。退出**始终 0**（不阻断 spec-driver 流程）；降级原因写 stderr。
 * keyword 提取 / 检索 / 格式化 / 字符 cap 全在 spectra query 侧（本脚本只薄编排）。
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROBE_SENTINEL = 'scaffold-kb-query:1';
const SPAWN_TIMEOUT_MS = 10_000;
const MAX_BUFFER = 4 * 1024 * 1024;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--requirement') out.requirement = argv[++i];
    else if (argv[i] === '--project-root') out.projectRoot = argv[++i];
  }
  return out;
}

function diag(reason) {
  process.stderr.write(`[kb-prequery] ${reason}\n`);
}

/** 经 resolve-project-context.mjs --json 读取 resolvedProfile.knowledgeSources */
function resolveKnowledgeSources(projectRoot) {
  const resolver = join(__dirname, 'resolve-project-context.mjs');
  const r = spawnSync('node', [resolver, '--project-root', projectRoot, '--json'], {
    encoding: 'utf-8',
    timeout: SPAWN_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });
  if (r.status !== 0 || typeof r.stdout !== 'string') return null;
  try {
    return JSON.parse(r.stdout).resolvedProfile?.knowledgeSources ?? null;
  } catch {
    return null;
  }
}

/** bin 发现（覆盖优先）：$SPECTRA_BIN → 项目 node_modules/.bin → PATH */
function discoverSpectraBin(projectRoot) {
  const envBin = process.env['SPECTRA_BIN'];
  if (envBin && existsSync(envBin)) return envBin;
  const local = join(projectRoot, 'node_modules', '.bin', 'spectra');
  if (existsSync(local)) return local;
  return 'spectra'; // 交给 PATH；不存在则 spawnSync ENOENT
}

/**
 * 能力探测：区分 ok / missing（bin 不存在 ENOENT）/ too-old（能跑但无 sentinel = 旧版无 query）。
 * 修 Codex W2：原实现全归 spectra-unavailable，无法区分缺 bin 与旧版。
 */
function probeBin(bin) {
  const r = spawnSync(bin, ['scaffold-kb', 'query', '--probe'], {
    encoding: 'utf-8',
    timeout: SPAWN_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });
  if (r.error && r.error.code === 'ENOENT') return 'missing';
  if (r.status === 0 && typeof r.stdout === 'string' && r.stdout.includes(PROBE_SENTINEL)) return 'ok';
  return 'too-old';
}

function main() {
  const { requirement, projectRoot = process.cwd() } = parseArgs(process.argv.slice(2));
  if (!requirement) {
    diag('no-requirement');
    return;
  }

  const ks = resolveKnowledgeSources(projectRoot);
  if (!ks || ks.enabled !== true || !ks.vendorKb) {
    diag('disabled-or-unconfigured');
    return;
  }

  const bin = discoverSpectraBin(projectRoot);
  const probeResult = probeBin(bin);
  if (probeResult === 'missing') {
    diag(`spectra-unavailable (bin=${bin}; 未安装 spectra)`);
    return;
  }
  if (probeResult === 'too-old') {
    diag(`spectra-too-old (bin=${bin}; 版本过旧，无 scaffold-kb query 子命令)`);
    return;
  }

  const args = [
    'scaffold-kb', 'query',
    '--requirement', requirement,
    '--vendor-kb', ks.vendorKb,
    '--top-k', String(ks.topK ?? 3),
    '--max-inject-chars', String(ks.maxInjectChars ?? 6000),
    '--format', 'markdown',
  ];
  if (ks.projectKb) args.push('--project-kb', ks.projectKb);

  const q = spawnSync(bin, args, {
    encoding: 'utf-8',
    timeout: SPAWN_TIMEOUT_MS,
    maxBuffer: MAX_BUFFER,
  });
  if (q.status !== 0) {
    diag(`query-failed (status=${q.status}): ${(q.stderr ?? '').trim()}`);
    return;
  }
  const block = (q.stdout ?? '').trim();
  if (block.length === 0) {
    // 透传 query 自身的结构化降级原因（kb-missing / no-hit / no-query），不再一律标 no-hit（修 Codex W2）
    diag(`no-injection: ${(q.stderr ?? 'no-hit').trim()}`);
    return;
  }
  process.stdout.write(`${block}\n`);
}

main();
