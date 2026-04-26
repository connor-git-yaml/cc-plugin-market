import process from 'node:process';
import { parseCommonProjectArgs } from '../plugins/spec-driver/scripts/lib/script-cli-args.mjs';
import { validateRepository } from './lib/repo-maintenance-core.mjs';

const args = parseCommonProjectArgs(process.argv.slice(2), { json: false });
const result = await validateRepository(args.projectRoot);

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
