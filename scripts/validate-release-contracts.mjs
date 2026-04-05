import process from 'node:process';
import { parseCommonProjectArgs } from '../plugins/spec-driver/scripts/lib/script-cli-args.mjs';
import { validateReleaseContract } from './lib/release-contract-core.mjs';

const args = parseCommonProjectArgs(process.argv.slice(2), { json: false });
const payload = validateReleaseContract(args.projectRoot);

if (args.json) {
  console.log(JSON.stringify(payload, null, 2));
} else if (payload.status === 'pass') {
  console.log(`Release contract valid (${payload.contractPath})`);
} else {
  console.error(`Release contract invalid (${payload.contractPath})`);
  for (const error of payload.errors) {
    console.error(`- ${error}`);
  }
}

if (payload.status !== 'pass') {
  process.exitCode = 1;
}
