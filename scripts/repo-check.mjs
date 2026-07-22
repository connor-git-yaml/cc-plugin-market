import process from 'node:process';
import { parseCommonProjectArgs } from '../plugins/spec-driver/scripts/lib/script-cli-args.mjs';
import { validateRepository } from './lib/repo-maintenance-core.mjs';

// F219：手动解析 --strict（不改共享 parseCommonProjectArgs——它位于 plugins/spec-driver/，
// 不在本 Feature 的写入面内）。strict 把 spec drift 的非 fresh 锚从 warning 提升为 error。
const strict = process.argv.slice(2).includes('--strict');
const args = parseCommonProjectArgs(process.argv.slice(2), { json: false });
const result = await validateRepository(args.projectRoot, { strict });

if (args.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(
    [
      `[repo-check] status=${result.status}`,
      ...result.checks.map((check) => `- ${check.id}: ${check.status}`),
      ...(result.warnings.length > 0 ? ['', 'warnings:', ...result.warnings.map((warning) => `  - ${warning}`)] : []),
      ...(result.errors.length > 0 ? ['', 'errors:', ...result.errors.map((error) => `  - ${error}`)] : []),
    ].join('\n') + '\n',
  );
}

if (result.status === 'fail') {
  process.exitCode = 1;
}
