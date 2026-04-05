import process from 'node:process';
import { parseCommonProjectArgs } from '../plugins/spec-driver/scripts/lib/script-cli-args.mjs';
import { syncReleaseContract } from './lib/release-contract-core.mjs';

const args = parseCommonProjectArgs(process.argv.slice(2));
const payload = syncReleaseContract(args.projectRoot);

if (args.json) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  console.log(`Synced release contract from ${payload.contractPath}`);
  for (const targetPath of payload.touchedPaths) {
    console.log(`- ${targetPath}`);
  }
}
