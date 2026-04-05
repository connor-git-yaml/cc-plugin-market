#!/usr/bin/env node

import process from 'node:process';
import { parseCommonProjectArgs } from './lib/script-cli-args.mjs';
import { generateProductQualityReports } from './lib/product-quality-core.mjs';

export { generateProductQualityReports } from './lib/product-quality-core.mjs';

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseCommonProjectArgs(process.argv.slice(2));
  const result = generateProductQualityReports(args);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`已生成 ${result.products.length} 份产品 quality report\n`);
  }
}
