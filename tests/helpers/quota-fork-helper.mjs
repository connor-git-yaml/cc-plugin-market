#!/usr/bin/env node
/**
 * Feature 162 — Quota fork helper for cross-process vitest cases.
 *
 * 用于 child_process.fork() 启动；通过 argv 接收参数，stdout 输出 JSON 结果。
 *
 * Argv: --store-path <path> --lock-path <path> --max-runs <N> --run-id <id>
 * Stdout: JSON { ok, runs, lockHeldMs, error? }
 * Exit: 0 = ok / 1 = failure
 *
 * Plan §2.3.8
 */

import { reserveQuota } from '../../scripts/lib/eval-quota-store.mjs';

function parseArgv(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const value = argv[i + 1];
      out[key] = value;
      i += 1;
    }
  }
  return out;
}

async function main() {
  const argv = parseArgv(process.argv.slice(2));
  const t0 = process.hrtime.bigint();
  try {
    const res = await reserveQuota({
      storePath: argv['store-path'],
      lockPath: argv['lock-path'],
      runId: argv['run-id'],
      maxRunsPerDay: Number(argv['max-runs']),
    });
    const lockHeldMs = Number(process.hrtime.bigint() - t0) / 1e6;
    process.stdout.write(
      JSON.stringify({ ok: res.reserved === true, runs: res.currentRuns, lockHeldMs, reason: res.reason }),
    );
    process.exit(res.reserved ? 0 : 2);
  } catch (err) {
    process.stdout.write(JSON.stringify({ ok: false, error: err.message }));
    process.exit(1);
  }
}

main();
