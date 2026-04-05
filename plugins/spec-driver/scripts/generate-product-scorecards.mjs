#!/usr/bin/env node

import process from 'node:process';
import { parseCommonProjectArgs } from './lib/script-cli-args.mjs';
import { generateProductScorecards } from './lib/product-scorecard-core.mjs';

export { generateProductScorecards } from './lib/product-scorecard-core.mjs';

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseCommonProjectArgs(process.argv.slice(2));
  const result = generateProductScorecards({
    projectRoot: args.projectRoot,
  });

  if (args.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(
      [
        `✓ 生成 scorecard index: ${result.scorecardIndexPath}`,
        ...result.products.map((product) => `  - ${product.id}: ${product.markdownPath} (${product.status}, ${product.score}/100)`),
      ].join('\n') + '\n',
    );
  }
}
