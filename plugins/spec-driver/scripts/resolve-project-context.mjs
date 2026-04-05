#!/usr/bin/env node

import process from 'node:process';
import { resolveProjectContext } from './lib/project-profile-resolver.mjs';

function parseArgs(argv) {
  const args = {
    projectRoot: process.cwd(),
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--project-root') {
      const value = argv[index + 1];
      if (value) {
        args.projectRoot = value;
        index += 1;
      }
      continue;
    }
    if (arg === '--json') {
      args.json = true;
    }
  }

  return args;
}

function formatText(result) {
  const lines = [];
  lines.push(`# Project Context Resolve Result`);
  lines.push(`- usedSource: ${result.source.usedSource}`);
  lines.push(`- usedPath: ${result.source.usedPath ?? 'none'}`);
  lines.push(`- projectContextBlock:`);
  for (const line of result.projectContextBlock.split('\n')) {
    lines.push(`  ${line}`);
  }
  lines.push(`- onlineResearch: required=${result.onlineResearch.required}, min=${result.onlineResearch.minPoints}, max=${result.onlineResearch.maxPoints}`);
  if (result.diagnostics.length > 0) {
    lines.push(`- diagnostics:`);
    for (const diagnostic of result.diagnostics) {
      lines.push(`  - [${diagnostic.level}] ${diagnostic.code}: ${diagnostic.message}`);
    }
  }
  return lines.join('\n');
}

const args = parseArgs(process.argv.slice(2));
const result = resolveProjectContext({ projectRoot: args.projectRoot });

if (args.json) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} else {
  process.stdout.write(`${formatText(result)}\n`);
}
