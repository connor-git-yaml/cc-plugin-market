#!/usr/bin/env node

import process from 'node:process';
import { parseCommonProjectArgs } from './lib/script-cli-args.mjs';
import { isInvokedDirectly } from './lib/is-invoked-directly.mjs';
import { generateProductQualityReports } from './lib/product-quality-core.mjs';

export { generateProductQualityReports } from './lib/product-quality-core.mjs';

if (isInvokedDirectly(import.meta.url)) {
  const args = parseCommonProjectArgs(process.argv.slice(2));
  const result = generateProductQualityReports(args);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`已生成 ${result.products.length} 份产品 quality report\n`);
  }
}
