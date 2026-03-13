#!/usr/bin/env node

const { existsSync } = require('node:fs');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const lifecycleName = process.argv[2];

if (!lifecycleName) {
  console.error('reverse-spec: missing lifecycle script name');
  process.exit(1);
}

const targetScript = resolve(__dirname, '..', 'dist', 'scripts', `${lifecycleName}.js`);

if (!existsSync(targetScript)) {
  console.log(
    `reverse-spec: skip ${lifecycleName}, build output not found at dist/scripts/${lifecycleName}.js`,
  );
  process.exit(0);
}

const result = spawnSync(process.execPath, [targetScript], {
  stdio: 'inherit',
  env: process.env,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 0);
