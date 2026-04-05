import process from 'node:process';
import { parseCommonProjectArgs } from '../plugins/spec-driver/scripts/lib/script-cli-args.mjs';
import { syncRepository } from './lib/repo-maintenance-core.mjs';

const args = parseCommonProjectArgs(process.argv.slice(2), { json: false });
const result = syncRepository(args.projectRoot);

if (args.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(
    [
      '[repo-sync] completed',
      ...result.steps.map((step) => `- ${step.id}: ${step.title}`),
    ].join('\n') + '\n',
  );
}
