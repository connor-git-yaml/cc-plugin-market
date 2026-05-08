#!/usr/bin/env node
/**
 * Feature 153 — Go truth-set CLI（独立子进程入口）
 *
 * 目的：避免 web-tree-sitter ESM/CommonJS 双实例 Parser.init 冲突。
 *   verify-feature-153.mjs 主进程已经走 ESM dist 路径 init 过 Parser；
 *   再在同进程调 require('web-tree-sitter') 会得到不同实例（init 已失效）。
 *   把 truth-set 抽取放子进程跑，独立 require Parser，互不干扰。
 *
 * 用法：
 *   node scripts/go-truth-set-cli.mjs --source <go-project-root> [--ignore-dirs a,b,c]
 *
 * 输出：stdout 单行 JSON：
 *   { language: 'go', truthCalls: [...], warnings: [...] }
 *
 * 退出码：
 *   0 = 成功
 *   1 = source 路径不存在 / extractor 内部异常
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { extractGoCallSites } from './lib/go-call-extractor.mjs';

function parseArgs(argv) {
  const out = { excludeTestFiles: false };
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--source') out.source = argv[++i];
    else if (k === '--ignore-dirs') {
      out.ignoreDirs = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    } else if (k === '--exclude-test-files') {
      out.excludeTestFiles = true;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  if (!args.source || typeof args.source !== 'string') {
    console.error('用法: node scripts/go-truth-set-cli.mjs --source <go-project-root> [--ignore-dirs a,b,c] [--exclude-test-files]');
    process.exit(1);
  }
  const sourceRoot = path.resolve(args.source);
  if (!fs.existsSync(sourceRoot)) {
    console.error(`source 路径不存在: ${sourceRoot}`);
    process.exit(1);
  }
  const result = await extractGoCallSites({
    sourceRoot,
    ignoreDirs: args.ignoreDirs,
  });
  // post-filter: 排除 _test.go 文件（保持 mapper 端 / truth 端 scope 一致）
  if (args.excludeTestFiles) {
    result.truthCalls = result.truthCalls.filter((t) => !t.file.endsWith('_test.go'));
  }
  // 单行 JSON 输出 stdout（避免缓冲问题）
  process.stdout.write(JSON.stringify(result));
}

main().catch((err) => {
  console.error(`[go-truth-set-cli] error: ${err.stack ?? err.message}`);
  process.exit(1);
});
