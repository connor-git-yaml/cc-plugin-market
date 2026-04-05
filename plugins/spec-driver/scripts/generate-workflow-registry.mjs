#!/usr/bin/env node

import process from 'node:process';
import { parseCommonProjectArgs } from './lib/script-cli-args.mjs';
import {
  generateWorkflowRegistry,
  printWorkflowRegistryResult,
} from './lib/workflow-registry-core.mjs';

export { generateWorkflowRegistry } from './lib/workflow-registry-core.mjs';

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseCommonProjectArgs(process.argv.slice(2));
  const result = generateWorkflowRegistry(args);
  printWorkflowRegistryResult(result, args.json);
}
