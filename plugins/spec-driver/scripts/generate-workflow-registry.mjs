#!/usr/bin/env node

import process from 'node:process';
import { parseCommonProjectArgs } from './lib/script-cli-args.mjs';
import { isInvokedDirectly } from './lib/is-invoked-directly.mjs';
import {
  generateWorkflowRegistry,
  printWorkflowRegistryResult,
} from './lib/workflow-registry-core.mjs';

export { generateWorkflowRegistry } from './lib/workflow-registry-core.mjs';

if (isInvokedDirectly(import.meta.url)) {
  const args = parseCommonProjectArgs(process.argv.slice(2));
  const result = generateWorkflowRegistry(args);
  printWorkflowRegistryResult(result, args.json);
}
