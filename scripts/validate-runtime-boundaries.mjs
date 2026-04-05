import process from 'node:process';
import { parseCommonProjectArgs } from '../plugins/spec-driver/scripts/lib/script-cli-args.mjs';
import { validateRuntimeBoundaries } from './lib/runtime-boundary-core.mjs';

const args = parseCommonProjectArgs(process.argv.slice(2), { json: false });
const result = validateRuntimeBoundaries({ projectRoot: args.projectRoot });

if (args.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else if (result.status === 'pass') {
  process.stdout.write(`Runtime boundaries valid (${result.contractPath})\n`);
} else {
  process.stderr.write(`Runtime boundaries ${result.status} (${result.contractPath})\n`);
  for (const warning of result.warnings) {
    process.stderr.write(`- warning: ${warning}\n`);
  }
  for (const error of result.errors) {
    process.stderr.write(`- error: ${error}\n`);
  }
}

if (result.status === 'fail') {
  process.exitCode = 1;
}
