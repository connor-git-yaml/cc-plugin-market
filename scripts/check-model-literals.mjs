import process from 'node:process';
import { parseCommonProjectArgs } from '../plugins/spec-driver/scripts/lib/script-cli-args.mjs';
import { validateModelLiteralGate } from './lib/model-literal-gate-core.mjs';

// Feature 238（FR-310）：模型字面量 grep 门禁独立 CLI 直跑入口。
// 与 repo-check.mjs 同构（parseCommonProjectArgs + --json/文本双输出 + exit code）。

const args = parseCommonProjectArgs(process.argv.slice(2), { json: false });
const result = validateModelLiteralGate({ projectRoot: args.projectRoot });

if (args.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  const offenderLines = (result.checks[0]?.evidence?.offenders ?? []).map(
    (o) => `    ${o.file}:${o.line} — ${o.match}`,
  );
  process.stdout.write(
    [
      `[check-model-literals] status=${result.status}`,
      ...result.checks.map((check) => `- ${check.id}: ${check.status}`),
      ...(offenderLines.length > 0 ? ['', 'offenders:', ...offenderLines] : []),
      ...(result.warnings.length > 0 ? ['', 'warnings:', ...result.warnings.map((warning) => `  - ${warning}`)] : []),
      ...(result.errors.length > 0 ? ['', 'errors:', ...result.errors.map((error) => `  - ${error}`)] : []),
    ].join('\n') + '\n',
  );
}

if (result.status === 'fail') {
  process.exitCode = 1;
}
