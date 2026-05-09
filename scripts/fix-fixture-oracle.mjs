#!/usr/bin/env node
/**
 * Feature 158 Codex review fix: 修复 10 个 fixture 的 oracle 字段
 *
 * 原问题（Codex CRITICAL）：
 *   C1 — oracle.checks[] 用相对路径，但 runner 在 worktree cwd 执行；找不到脚本/expected diff
 *   C2 — oracle.checks[] 是 object 数组，但 runPrimaryOracle 的 ast-diff 分支按 string 命令执行（schema 不匹配）
 *
 * 修复策略：
 *   1. checks[] 改为 string 数组（每条 string 是一个 bash 命令）
 *   2. 命令开头 `EVAL_REPO_ROOT=$(git -C "$(node -e 'console.log(require(\"path\").resolve(__dirname,\"../..\"))' --input-type=module 2>/dev/null || pwd)" rev-parse --show-toplevel 2>/dev/null || pwd)` —— 但 worktree 是 sympy 等，git rev-parse 会指向 sympy 不是本仓库
 *   3. 实际 SOLUTION：fixture 中存"环境变量占位符"，由 eval-mcp-augmented.mjs 在调用 runPrimaryOracle 前替换为绝对路径
 *      - <SPECTRA_REPO_ROOT> → cc-plugin-market 仓库绝对路径
 *      - 这样 fixture 本身保持 portable（不嵌入用户特定路径），但运行时被替换
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '..', 'tests', 'baseline', 'swe-bench-lite', 'fixtures');

const files = fs.readdirSync(FIXTURES_DIR).filter((n) => /^SWE-L\d+.*\.json$/.test(n));

for (const f of files) {
  const fp = path.join(FIXTURES_DIR, f);
  const data = JSON.parse(fs.readFileSync(fp, 'utf-8'));
  const goldpatchFile = f.replace(/\.json$/, '.goldpatch.diff');
  const taskId = data.taskId;
  // 改为 string 数组（修 C2 schema 不匹配 runPrimaryOracle ast-diff 分支契约）
  // 用 <SPECTRA_REPO_ROOT> 占位符（修 C1 路径解析），由 eval-mcp-augmented.mjs 在 runPrimaryOracle 之前替换
  data.primaryOracle = {
    kind: 'ast-diff',
    checks: [
      `git diff HEAD > /tmp/${taskId}.actual.diff && node "<SPECTRA_REPO_ROOT>/scripts/eval-diff-fuzzy-match.mjs" --expected "<SPECTRA_REPO_ROOT>/tests/baseline/swe-bench-lite/fixtures/${goldpatchFile}" --actual /tmp/${taskId}.actual.diff --threshold 60 ; rc=$? ; rm -f /tmp/${taskId}.actual.diff ; exit $rc`,
    ],
  };
  fs.writeFileSync(fp, JSON.stringify(data, null, 2) + '\n');
  console.log('fixed', f);
}
console.log(`done: ${files.length} fixtures`);
